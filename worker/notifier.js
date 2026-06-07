/* ═══════════════════════════════════════════════════════
   Notifier worker — Спринт 3
   Раз на хвилину: читає pending notifications, шле через Telegram.
   Шукає telegram_chat_id у scheduled_notifications;
   якщо немає (більшість записів через /direct) — пропускає з status=skipped,
   бо клієнт не лінкував чат.
   Інтегрується в booking-server: require('./worker/notifier').start()
   ═══════════════════════════════════════════════════════ */
const https = require('https');
const db = require('../db/client');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TICK_MS = 60 * 1000;

function tg(method, body) {
  return new Promise((resolve, reject) => {
    if (!BOT_TOKEN) return reject(new Error('TELEGRAM_BOT_TOKEN відсутній'));
    const data = JSON.stringify(body);
    const req = https.request({
      method: 'POST', hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(buf);
          if (!parsed.ok) return reject(new Error(parsed.description || 'Telegram error'));
          resolve(parsed.result);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function formatRussian(payload) {
  const start = new Date(payload.start_at);
  const dd = String(start.getDate()).padStart(2,'0');
  const mm = String(start.getMonth()+1).padStart(2,'0');
  const hh = String(start.getHours()).padStart(2,'0');
  const min = String(start.getMinutes()).padStart(2,'0');
  return { d: `${dd}.${mm}`, t: `${hh}:${min}` };
}

function buildMessage(event, payload) {
  const { d, t } = formatRussian(payload);
  const svc = payload.service_name || 'послуга';
  const master = payload.master_name ? ' до майстра <b>' + payload.master_name + '</b>' : '';
  if (event === 'reminder_24h') {
    return `🔔 Нагадування\n\nЗавтра <b>${d} о ${t}</b> чекаємо вас у SVS Beauty Space на <b>${svc}</b>${master}.\n\nЯкщо плани змінились, скасуйте за 2 години до візиту, щоб слот зайняв інший клієнт.`;
  }
  if (event === 'reminder_2h') {
    return `⏰ За 2 години\n\nСьогодні о <b>${t}</b> чекаємо вас на <b>${svc}</b>${master}.\nАдреса: вул. Героїв Сумщини, 1. Будемо раді!`;
  }
  return `Нагадування про запис ${d} ${t}`;
}

async function tick() {
  let pending;
  try { pending = db.getPendingNotifications(20); }
  catch (e) { console.error('[notifier] db read:', e.message); return; }
  if (!pending.length) return;

  for (const n of pending) {
    try {
      const payload = JSON.parse(n.payload_json || '{}');
      // Без chat_id Telegram-сповіщення відправити неможливо.
      // Для /direct записів chat_id ставиться лише після того як клієнт натисне deep-link.
      // Помічаємо як skipped щоб не крутився цикл вічно.
      if (!n.telegram_chat_id) {
        db.getDb().prepare(`UPDATE scheduled_notifications SET status='skipped', last_error='no_chat_id' WHERE id=?`).run(n.id);
        continue;
      }
      const text = buildMessage(n.event, payload);
      await tg('sendMessage', { chat_id: n.telegram_chat_id, text, parse_mode: 'HTML' });
      db.markNotificationSent(n.id);
      console.log(`[notifier] sent ${n.event} → ${n.telegram_chat_id}`);
    } catch (e) {
      db.markNotificationFailed(n.id, String(e.message).slice(0, 200));
      console.error(`[notifier] fail id=${n.id}:`, e.message);
    }
  }
}

function start() {
  if (!BOT_TOKEN) {
    console.warn('[notifier] вимкнено — TELEGRAM_BOT_TOKEN відсутній');
    return;
  }
  console.log(`[notifier] стартую, тік раз на ${TICK_MS/1000}c`);
  setTimeout(tick, 5000);                // перший тік через 5с після старту
  setInterval(tick, TICK_MS);
}

module.exports = { start, tick };
