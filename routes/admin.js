/* ═══════════════════════════════════════════════════════
   Admin Routes — Спринт 4 (PostgreSQL)
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

router.get('/blacklist', async (req, res) => {
  try { res.json(await db.listBlacklist()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/blacklist', async (req, res) => {
  try {
    const { phone, reason } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length < 10) return res.status(400).json({ error: 'invalid phone' });
    const formatted = '+' + digits;
    await db.addToBlacklist({ phone: formatted, reason, added_by: req.header('x-admin-user') || 'admin' });
    res.json({ ok: true, phone: formatted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/blacklist/:phone', async (req, res) => {
  try {
    const digits = String(req.params.phone).replace(/\D/g, '');
    const formatted = '+' + digits;
    await db.removeFromBlacklist(formatted);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/stats', async (req, res) => {
  try {
    const pool = db.getDb();
    const queries = [
      pool.query('SELECT COUNT(*) c FROM appointments_log'),
      pool.query("SELECT COUNT(*) c FROM appointments_log WHERE status='active'"),
      pool.query("SELECT COUNT(*) c FROM appointments_log WHERE status='cancelled'"),
      pool.query('SELECT COUNT(*) c FROM blacklist'),
      pool.query("SELECT COUNT(*) c FROM scheduled_notifications WHERE status='pending'"),
      pool.query("SELECT COUNT(*) c FROM scheduled_notifications WHERE status='sent'"),
      pool.query("SELECT COUNT(*) c FROM scheduled_notifications WHERE status='skipped'"),
    ];
    const [total, active, cancelled, bl, pending, sent, skipped] = await Promise.all(queries);
    res.json({
      appointments_total: +total.rows[0].c,
      appointments_active: +active.rows[0].c,
      appointments_cancelled: +cancelled.rows[0].c,
      blacklist: +bl.rows[0].c,
      notifications_pending: +pending.rows[0].c,
      notifications_sent: +sent.rows[0].c,
      notifications_skipped: +skipped.rows[0].c,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
