/* ═══════════════════════════════════════════════════════
   SVS Booking-API — Internal Relay

   Прокси для отправки TG-сообщений ОТ svs-shop-api.
   svs-shop-api не имеет TELEGRAM_BOT_TOKEN на Render,
   но booking-api имеет — поэтому shop-api делает HTTP
   запрос сюда, мы шлём в TG.

   Безопасность:
   1. Шлём ТОЛЬКО юзерам которые УЖЕ есть в users.telegram_id
      (нельзя заспамить произвольный chat_id)
   2. Rate limit: 5 запросов/мин на один phone
   3. Логируем в audit_log
   ═══════════════════════════════════════════════════════ */
const express = require('express');
const { query } = require('../db-pg');
const router = express.Router();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 5;
const rateMap = new Map(); // phone → [timestamps]

function checkRate(key) {
  const now = Date.now();
  const arr = (rateMap.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) return false;
  arr.push(now);
  rateMap.set(key, arr);
  return true;
}

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

async function tgSend(chatId, text) {
  if (!BOT_TOKEN) throw new Error('no-bot-token-on-booking-api');
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`tg-api: ${j.description || r.status}`);
  return j;
}

// POST /api/internal/tg-send-by-phone { phone, text }
// Только для зарегистрированных юзеров. Шлёт в их telegram_id.
router.post('/tg-send-by-phone', async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const text = String(req.body?.text || '').slice(0, 4000);
    if (!phone || !text) return res.status(400).json({ error: 'phone-and-text-required' });

    if (!checkRate(phone)) {
      return res.status(429).json({ error: 'too-many-requests' });
    }

    // Ищем юзера в users таблице (та же Neon БД)
    const u = await query(
      `SELECT id, telegram_id, display_name, is_active FROM users WHERE phone = $1 LIMIT 1`,
      [phone]
    );
    if (!u.rowCount) {
      // Не раскрываем что юзера нет — но не шлём
      return res.status(404).json({ error: 'user-not-found' });
    }
    const user = u.rows[0];
    if (!user.is_active) return res.status(403).json({ error: 'user-disabled' });
    if (!user.telegram_id) return res.status(400).json({ error: 'no-telegram-linked' });

    try {
      await tgSend(user.telegram_id, text);
    } catch (e) {
      console.error('[internal/tg-send]', e.message);
      return res.status(503).json({ error: 'tg-send-failed', detail: e.message });
    }

    // Audit (best-effort)
    try {
      await query(
        `INSERT INTO audit_log (user_id, user_label, action, entity, entity_id, ip, meta)
         VALUES ($1, $2, 'internal.tg-send', 'user', $3, $4, $5)`,
        [user.id, user.display_name, user.id, (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(), JSON.stringify({ text_len: text.length, via: 'booking-api-relay' })]
      );
    } catch {}

    res.json({ ok: true });
  } catch (e) {
    console.error('[internal/tg-send-by-phone]', e);
    res.status(500).json({ error: 'internal', detail: e.message });
  }
});

// GET /api/internal/health
router.get('/health', (req, res) => {
  res.json({ ok: true, has_bot_token: !!BOT_TOKEN });
});

module.exports = router;
