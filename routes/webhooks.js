/* ═══════════════════════════════════════════════════════════════════
   Webhooks router
   POST /api/webhooks/beautypro → приём событий BeautyPro
   ═══════════════════════════════════════════════════════════════════ */
const express = require('express');
const { handleWebhook } = require('../worker/crm-sync.js');

const router = express.Router();

// ── BeautyPro вебхук ───────────────────────────────────────────────
// Принимает {type, payload}. TODO: HMAC-подпись после регистрации в BeautyPro
router.post('/beautypro', (req, res) => {
  try {
    const { type, payload } = req.body || {};
    if (!type || !payload) return res.status(400).json({ error: 'type+payload required' });
    // Когда BeautyPro подпишет — добавим verifyHmac(req)
    const signatureValid = true;
    const result = handleWebhook({ type, payload, signatureValid });
    res.json(result);
  } catch (e) {
    console.error('[webhook/beautypro] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Health-check для самого роута
router.get('/health', (req, res) => res.json({ ok: true, router: 'webhooks' }));

module.exports = router;
