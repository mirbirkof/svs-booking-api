/* Shop routes — stub for Render (shop logic lives in svs-shop-api) */
const express = require('express');
const router = express.Router();

router.get('/products', (req, res) => res.json({ items: [], note: 'Use svs-shop-api for catalog' }));
router.get('/products/:sku', (req, res) => res.status(404).json({ error: 'Use svs-shop-api' }));
router.post('/orders', (req, res) => res.status(501).json({ error: 'Use svs-shop-api' }));
router.get('/orders/:id', (req, res) => res.status(501).json({ error: 'Use svs-shop-api' }));

module.exports = router;
