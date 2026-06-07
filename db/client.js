/* ═══════════════════════════════════════════════════════
   SVS Booking — PostgreSQL client (Render-compatible)
   Замінює SQLite — працює з Neon PostgreSQL.
   ═══════════════════════════════════════════════════════ */
const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon') ? { rejectUnauthorized: false } : false,
  max: 5,
});

// Init tables on first call
let _initialized = false;
async function ensureTables() {
  if (_initialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cancel_tokens (
      token TEXT PRIMARY KEY,
      appointment_id TEXT NOT NULL,
      client_phone TEXT NOT NULL,
      service_id TEXT NOT NULL,
      service_name TEXT,
      master_id TEXT NOT NULL,
      master_name TEXT,
      start_at TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      used_action TEXT,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      client_phone TEXT NOT NULL,
      appointment_id TEXT,
      response_body TEXT,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scheduled_notifications (
      id SERIAL PRIMARY KEY,
      appointment_id TEXT NOT NULL,
      cancel_token TEXT,
      client_phone TEXT NOT NULL,
      telegram_chat_id TEXT,
      event TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ NOT NULL,
      payload_json TEXT NOT NULL,
      sent_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS blacklist (
      client_phone TEXT PRIMARY KEY,
      reason TEXT,
      blocks_booking INTEGER NOT NULL DEFAULT 1,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      added_by TEXT
    );
    CREATE TABLE IF NOT EXISTS appointments_log (
      appointment_id TEXT PRIMARY KEY,
      company_id TEXT,
      client_phone TEXT NOT NULL,
      client_name TEXT,
      service_id TEXT NOT NULL,
      service_name TEXT,
      master_id TEXT NOT NULL,
      master_name TEXT,
      start_at TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      status TEXT NOT NULL,
      source TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  _initialized = true;
}

// Auto-init on load
ensureTables().catch(e => console.error('[db/client] init:', e.message));

// ── Sync wrapper for pg (mimics SQLite sync API via async) ──
// Routes use require() inline, so we provide async-compatible functions

function getDb() {
  return pool; // For direct queries if needed
}

async function createCancelToken(data) {
  await ensureTables();
  const token = crypto.randomBytes(16).toString('hex');
  await pool.query(`
    INSERT INTO cancel_tokens
      (token, appointment_id, client_phone, service_id, service_name,
       master_id, master_name, start_at, duration_min)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `, [token, String(data.appointment_id), String(data.client_phone),
      String(data.service_id), data.service_name || null,
      String(data.master_id), data.master_name || null,
      String(data.start_at), Number(data.duration_min) || 60]);
  return token;
}

async function getCancelToken(token) {
  await ensureTables();
  const { rows } = await pool.query('SELECT * FROM cancel_tokens WHERE token = $1', [token]);
  return rows[0] || null;
}

async function consumeCancelToken(token, action) {
  await ensureTables();
  const { rowCount } = await pool.query(`
    UPDATE cancel_tokens SET status = 'used', used_action = $1, used_at = NOW()
    WHERE token = $2 AND status = 'active'
  `, [String(action), token]);
  return rowCount > 0;
}

async function tryClaimIdempotency(key, clientPhone) {
  await ensureTables();
  await pool.query("DELETE FROM idempotency_keys WHERE expires_at < NOW()");
  const { rows } = await pool.query('SELECT * FROM idempotency_keys WHERE key = $1', [key]);
  if (rows[0]) return { claimed: false, existing: rows[0] };
  try {
    await pool.query(`
      INSERT INTO idempotency_keys (key, client_phone, status, expires_at)
      VALUES ($1, $2, 'pending', NOW() + INTERVAL '10 minutes')
    `, [String(key), String(clientPhone)]);
    return { claimed: true };
  } catch (e) {
    const { rows: r2 } = await pool.query('SELECT * FROM idempotency_keys WHERE key = $1', [key]);
    return { claimed: false, existing: r2[0] };
  }
}

async function completeIdempotency(key, appointmentId, responseBody) {
  await ensureTables();
  await pool.query(`
    UPDATE idempotency_keys SET status = 'success', appointment_id = $1, response_body = $2
    WHERE key = $3
  `, [String(appointmentId), JSON.stringify(responseBody), String(key)]);
}

async function failIdempotency(key, errMsg) {
  await ensureTables();
  await pool.query(`
    UPDATE idempotency_keys SET status = 'failed', response_body = $1 WHERE key = $2
  `, [JSON.stringify({ error: errMsg }), String(key)]);
}

async function logAppointment(data) {
  await ensureTables();
  await pool.query(`
    INSERT INTO appointments_log
      (appointment_id, company_id, client_phone, client_name,
       service_id, service_name, master_id, master_name,
       start_at, duration_min, status, source, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
    ON CONFLICT (appointment_id) DO UPDATE SET
      status = EXCLUDED.status, updated_at = NOW()
  `, [String(data.appointment_id), data.company_id || null,
      String(data.client_phone), data.client_name || null,
      String(data.service_id), data.service_name || null,
      String(data.master_id), data.master_name || null,
      String(data.start_at), Number(data.duration_min) || 60,
      data.status || 'active', data.source || 'widget']);
}

async function updateAppointmentStatus(appointmentId, status) {
  await ensureTables();
  await pool.query(`
    UPDATE appointments_log SET status = $1, updated_at = NOW() WHERE appointment_id = $2
  `, [status, String(appointmentId)]);
}

async function isBlacklisted(phone) {
  await ensureTables();
  const { rows } = await pool.query(
    'SELECT 1 FROM blacklist WHERE client_phone = $1 AND blocks_booking = 1', [String(phone)]);
  return rows.length > 0;
}

async function addToBlacklist({ phone, reason, added_by }) {
  await ensureTables();
  await pool.query(`
    INSERT INTO blacklist (client_phone, reason, blocks_booking, added_at, added_by)
    VALUES ($1,$2,1,NOW(),$3)
    ON CONFLICT (client_phone) DO UPDATE SET reason = EXCLUDED.reason, added_at = NOW()
  `, [String(phone), reason || null, added_by || 'admin']);
}

async function removeFromBlacklist(phone) {
  await ensureTables();
  await pool.query('DELETE FROM blacklist WHERE client_phone = $1', [String(phone)]);
}

async function listBlacklist() {
  await ensureTables();
  const { rows } = await pool.query(
    'SELECT client_phone, reason, blocks_booking, added_at, added_by FROM blacklist ORDER BY added_at DESC');
  return rows;
}

async function scheduleNotification(data) {
  await ensureTables();
  const { rows } = await pool.query(`
    INSERT INTO scheduled_notifications
      (appointment_id, cancel_token, client_phone, telegram_chat_id,
       event, scheduled_at, payload_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
  `, [String(data.appointment_id), data.cancel_token || null,
      String(data.client_phone), data.telegram_chat_id || null,
      String(data.event), String(data.scheduled_at),
      JSON.stringify(data.payload || {})]);
  return rows[0].id;
}

async function getPendingNotifications(limit = 50) {
  await ensureTables();
  const { rows } = await pool.query(`
    SELECT * FROM scheduled_notifications
    WHERE sent_at IS NULL AND status = 'pending' AND scheduled_at <= NOW()
    ORDER BY scheduled_at LIMIT $1
  `, [limit]);
  return rows;
}

async function markNotificationSent(id) {
  await ensureTables();
  await pool.query(`
    UPDATE scheduled_notifications SET sent_at = NOW(), status = 'sent' WHERE id = $1
  `, [id]);
}

async function markNotificationFailed(id, errMsg) {
  await ensureTables();
  await pool.query(`
    UPDATE scheduled_notifications
    SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
        attempts = attempts + 1, last_error = $1
    WHERE id = $2
  `, [errMsg, id]);
}

module.exports = {
  getDb,
  createCancelToken, getCancelToken, consumeCancelToken,
  tryClaimIdempotency, completeIdempotency, failIdempotency,
  logAppointment, updateAppointmentStatus,
  isBlacklisted, addToBlacklist, removeFromBlacklist, listBlacklist,
  scheduleNotification, getPendingNotifications,
  markNotificationSent, markNotificationFailed,
};
