/* ═══════════════════════════════════════════════════════════════════
   CRM Sync Worker — путь C из CRM-research
   Принимает вебхуки BeautyPro → пишет в нашу БД → начисляет баллы.
   Идемпотентно (дедуп через beautypro_webhook_log).
   ═══════════════════════════════════════════════════════════════════ */
const { getDb } = require('../db/client.js');

// Конфиг программы лояльности (можно вынести в settings)
const LOYALTY = {
  // 5% от суммы услуги в копейках → баллы 1:1 (1 балл = 1 копейка)
  pointsPerVisitPercent: 5,
  // Магазин Raywell: 3% обратно баллами
  pointsPerShopPercent: 3,
  // Тиры по lifetime-баллам (в копейках)
  tiers: [
    { name: 'bronze', minLifetime: 0 },
    { name: 'silver', minLifetime: 500_00 }, // 500₴
    { name: 'gold',   minLifetime: 2000_00 },
    { name: 'vip',    minLifetime: 5000_00 },
  ],
};

// ── Helpers ────────────────────────────────────────────────────────
function logWebhook({ type, entityId, payload, signatureValid }) {
  const db = getDb();
  // Дедуп: если уже видели обработанный успешно такой же entity того же типа — пропускаем
  if (entityId) {
    const existing = db.prepare(`
      SELECT id FROM beautypro_webhook_log
       WHERE webhook_type = ? AND bp_entity_id = ? AND processed = 1 AND process_error IS NULL
       LIMIT 1
    `).get(type, entityId);
    if (existing) return null;
  }
  const r = db.prepare(`
    INSERT INTO beautypro_webhook_log
      (webhook_type, bp_entity_id, payload_json, signature_valid)
    VALUES (?, ?, ?, ?)
  `).run(type, entityId || null, JSON.stringify(payload), signatureValid ? 1 : 0);
  return r.lastInsertRowid;
}

function markProcessed(id, error = null) {
  const db = getDb();
  db.prepare(`
    UPDATE beautypro_webhook_log
       SET processed = 1, processed_at = datetime('now'), process_error = ?
     WHERE id = ?
  `).run(error, id);
}

function upsertClientProfile({ phone, bpClientId, firstName, lastName, email, birthday }) {
  if (!phone) return null;
  const db = getDb();
  db.prepare(`
    INSERT INTO clients_profile (client_phone, bp_client_id, first_name, last_name, email, birthday)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_phone) DO UPDATE SET
      bp_client_id = COALESCE(excluded.bp_client_id, clients_profile.bp_client_id),
      first_name   = COALESCE(excluded.first_name, clients_profile.first_name),
      last_name    = COALESCE(excluded.last_name, clients_profile.last_name),
      email        = COALESCE(excluded.email, clients_profile.email),
      birthday     = COALESCE(excluded.birthday, clients_profile.birthday)
  `).run(phone, bpClientId || null, firstName || null, lastName || null, email || null, birthday || null);
  // гарантируем loyalty_accounts
  db.prepare(`
    INSERT OR IGNORE INTO loyalty_accounts (client_phone) VALUES (?)
  `).run(phone);
  return phone;
}

function pickTier(lifetimePoints) {
  let tier = 'bronze';
  for (const t of LOYALTY.tiers) {
    if (lifetimePoints >= t.minLifetime) tier = t.name;
  }
  return tier;
}

function awardPoints({ phone, delta, reason, sourceId, description }) {
  if (!phone || !delta) return null;
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT OR IGNORE INTO loyalty_accounts (client_phone) VALUES (?)`).run(phone);
    const acc = db.prepare(`SELECT points_balance, points_lifetime FROM loyalty_accounts WHERE client_phone = ?`).get(phone);
    const newBalance = acc.points_balance + delta;
    const newLifetime = delta > 0 ? acc.points_lifetime + delta : acc.points_lifetime;
    const tier = pickTier(newLifetime);
    db.prepare(`
      UPDATE loyalty_accounts
         SET points_balance = ?, points_lifetime = ?, tier = ?, tier_updated_at = datetime('now')
       WHERE client_phone = ?
    `).run(newBalance, newLifetime, tier, phone);
    db.prepare(`
      INSERT INTO loyalty_transactions
        (client_phone, delta, reason, source_id, description, balance_after)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(phone, delta, reason, sourceId || null, description || null, newBalance);
    db.exec('COMMIT');
    return { balance: newBalance, lifetime: newLifetime, tier };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ── Обработчики типов вебхуков ─────────────────────────────────────
const HANDLERS = {
  'sale.created': (payload) => {
    // BeautyPro вебхук о новой продаже → начислить баллы
    const phone = payload.client?.phone;
    const totalKopecks = Math.round((payload.total || 0) * 100);
    if (!phone || totalKopecks <= 0) return { skipped: 'no phone or zero total' };
    upsertClientProfile({
      phone,
      bpClientId: payload.client?.id,
      firstName: payload.client?.firstname,
      lastName: payload.client?.lastname,
    });
    const delta = Math.floor(totalKopecks * LOYALTY.pointsPerVisitPercent / 100);
    return awardPoints({
      phone, delta, reason: 'visit', sourceId: payload.id,
      description: `Візит на ${(totalKopecks/100).toFixed(2)}₴`,
    });
  },

  'appointment.completed': (payload) => {
    // Запись завершена → опционально пометить визит
    const phone = payload.client?.phone;
    if (!phone) return { skipped: 'no phone' };
    const db = getDb();
    db.prepare(`
      UPDATE clients_profile
         SET total_visits = total_visits + 1,
             last_visit_at = datetime('now')
       WHERE client_phone = ?
    `).run(phone);
    return { ok: true };
  },

  'client.updated': (payload) => {
    return upsertClientProfile({
      phone: payload.phone,
      bpClientId: payload.id,
      firstName: payload.firstname,
      lastName: payload.lastname,
      email: payload.email,
      birthday: payload.birthday,
    });
  },
};

// ── Главная точка входа: вызывается из routes/webhooks/beautypro.js ──
function handleWebhook({ type, payload, signatureValid = false }) {
  const entityId = payload?.id || null;
  const logId = logWebhook({ type, entityId, payload, signatureValid });
  if (!logId) return { duplicate: true };

  const handler = HANDLERS[type];
  if (!handler) {
    markProcessed(logId, `no handler for ${type}`);
    return { unhandled: true };
  }

  try {
    const result = handler(payload);
    markProcessed(logId);
    return { ok: true, result };
  } catch (e) {
    markProcessed(logId, e.message);
    return { error: e.message };
  }
}

module.exports = {
  handleWebhook,
  awardPoints,
  upsertClientProfile,
  pickTier,
  LOYALTY,
};
