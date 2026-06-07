/* ═══════════════════════════════════════════════════════
   Admin Routes — Спринт 4
   Захищено заголовком X-Admin-Token (env: ADMIN_TOKEN)
   GET    /api/admin/blacklist        — список
   POST   /api/admin/blacklist        — додати { phone, reason }
   DELETE /api/admin/blacklist/:phone — видалити
   GET    /api/admin/stats            — кількості (для дашборду)
   ═══════════════════════════════════════════════════════ */
const express = require('express');
const router = express.Router();
const db = require('../db/client');

router.use((req, res, next) => {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ error: 'ADMIN_TOKEN not configured' });
  const got = req.header('x-admin-token');
  if (got !== expected) return res.status(401).json({ error: 'unauthorized' });
  next();
});

router.get('/blacklist', (req, res) => {
  try { res.json(db.listBlacklist()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/blacklist', (req, res) => {
  try {
    const { phone, reason } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length < 10) return res.status(400).json({ error: 'invalid phone' });
    const formatted = '+' + digits;
    db.addToBlacklist({ phone: formatted, reason, added_by: req.header('x-admin-user') || 'admin' });
    res.json({ ok: true, phone: formatted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/blacklist/:phone', (req, res) => {
  try {
    const digits = String(req.params.phone).replace(/\D/g, '');
    const formatted = '+' + digits;
    const r = db.removeFromBlacklist(formatted);
    res.json({ ok: true, removed: r.changes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/stats', (req, res) => {
  try {
    const d = db.getDb();
    const stats = {
      appointments_total: d.prepare('SELECT COUNT(*) c FROM appointments_log').get().c,
      appointments_active: d.prepare("SELECT COUNT(*) c FROM appointments_log WHERE status='active'").get().c,
      appointments_cancelled: d.prepare("SELECT COUNT(*) c FROM appointments_log WHERE status='cancelled'").get().c,
      blacklist: d.prepare('SELECT COUNT(*) c FROM blacklist').get().c,
      notifications_pending: d.prepare("SELECT COUNT(*) c FROM scheduled_notifications WHERE status='pending'").get().c,
      notifications_sent: d.prepare("SELECT COUNT(*) c FROM scheduled_notifications WHERE status='sent'").get().c,
      notifications_skipped: d.prepare("SELECT COUNT(*) c FROM scheduled_notifications WHERE status='skipped'").get().c,
    };
    res.json(stats);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
