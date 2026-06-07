/* ═══════════════════════════════════════════════════════════════════
   Raywell Shop API
   GET  /api/shop/products          → список опубликованных SKU
   GET  /api/shop/products/:sku     → один товар
   POST /api/shop/orders            → создать заказ (черновик, без оплаты)
   GET  /api/shop/orders/:orderId   → статус заказа
   POST /api/webhooks/beautypro     → приём вебхуков BeautyPro
   ═══════════════════════════════════════════════════════════════════ */
const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/client.js');
const { handleWebhook, upsertClientProfile } = require('../worker/crm-sync.js');

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────
function dbProductToPublic(row, isWholesale = false) {
  if (!row) return null;
  return {
    sku: row.sku,
    name: row.name,
    category: row.category,
    brand: row.brand,
    description: row.description,
    price: isWholesale && row.price_wholesale_uah
      ? row.price_wholesale_uah / 100
      : row.price_uah / 100,
    inStock: row.stock_quantity > 0,
    stockQty: row.stock_quantity,
    image: row.image_url || null,
    meta: row.metadata_json ? JSON.parse(row.metadata_json) : {},
  };
}

function normPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return '+38' + digits;
  if (digits.length === 12 && digits.startsWith('380')) return '+' + digits;
  if (digits.length === 11 && digits.startsWith('80')) return '+3' + digits;
  return raw.startsWith('+') ? raw : null;
}

// ── GET /api/shop/products ─────────────────────────────────────────
router.get('/products', (req, res) => {
  try {
    const isWholesale = req.query.wholesale === '1';
    const rows = getDb().prepare(`
      SELECT * FROM shop_products_cache
       WHERE is_active = 1 AND is_published = 1
       ORDER BY category, name
    `).all();
    res.json({ products: rows.map(r => dbProductToPublic(r, isWholesale)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/shop/products/:sku ────────────────────────────────────
router.get('/products/:sku', (req, res) => {
  try {
    const isWholesale = req.query.wholesale === '1';
    const row = getDb().prepare(`
      SELECT * FROM shop_products_cache
       WHERE sku = ? AND is_active = 1
    `).get(req.params.sku);
    if (!row) return res.status(404).json({ error: 'Не знайдено' });
    res.json({ product: dbProductToPublic(row, isWholesale) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/shop/orders ─ создать заказ (без оплаты) ─────────────
router.post('/orders', (req, res) => {
  try {
    const { phone, email, firstName, lastName, items, delivery, notes } = req.body;
    const normalizedPhone = normPhone(phone);
    if (!normalizedPhone) return res.status(400).json({ error: 'Невірний телефон' });
    if (!items || !items.length) return res.status(400).json({ error: 'Порожня корзина' });

    const db = getDb();
    upsertClientProfile({
      phone: normalizedPhone, firstName, lastName, email,
    });

    // Загружаем продукты с server-side ценами (не доверяем клиенту)
    const skus = items.map(i => i.sku);
    const placeholders = skus.map(() => '?').join(',');
    const products = db.prepare(`
      SELECT sku, name, price_uah, stock_quantity, is_active, is_published
        FROM shop_products_cache WHERE sku IN (${placeholders})
    `).all(...skus);
    const bySku = Object.fromEntries(products.map(p => [p.sku, p]));

    let subtotal = 0;
    const lineItems = [];
    for (const it of items) {
      const p = bySku[it.sku];
      if (!p || !p.is_active || !p.is_published) {
        return res.status(400).json({ error: `Товар ${it.sku} недоступний` });
      }
      const qty = Math.max(1, Math.min(99, parseInt(it.qty || 1, 10)));
      if (p.stock_quantity < qty) {
        return res.status(400).json({ error: `${p.name}: на складі лише ${p.stock_quantity}` });
      }
      const lineTotal = p.price_uah * qty;
      subtotal += lineTotal;
      lineItems.push({
        sku: p.sku, name: p.name, qty, unit: p.price_uah, subtotal: lineTotal,
      });
    }

    const deliveryCost = (delivery?.method === 'nova_poshta') ? 8000 : 0; // 80₴ заглушка
    const total = subtotal + deliveryCost;
    const orderId = 'ord_' + crypto.randomBytes(8).toString('hex');

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO shop_orders
          (order_id, client_phone, client_email, delivery_method, delivery_address,
           delivery_cost_uah, subtotal_uah, total_uah, payment_method, payment_status,
           fulfillment_status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mono', 'pending', 'new', ?)
      `).run(
        orderId, normalizedPhone, email || null,
        delivery?.method || null, delivery?.address || null,
        deliveryCost, subtotal, total, notes || null
      );
      const itemStmt = db.prepare(`
        INSERT INTO shop_order_items (order_id, sku, product_name, quantity, unit_price_uah, subtotal_uah)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const li of lineItems) {
        itemStmt.run(orderId, li.sku, li.name, li.qty, li.unit, li.subtotal);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    res.json({
      orderId,
      subtotal: subtotal / 100,
      delivery: deliveryCost / 100,
      total: total / 100,
      items: lineItems.map(li => ({ sku: li.sku, name: li.name, qty: li.qty, subtotal: li.subtotal / 100 })),
      paymentStatus: 'pending',
      paymentUrl: null, // будет после интеграции Mono
    });
  } catch (e) {
    console.error('[shop/orders] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/shop/orders/:orderId ──────────────────────────────────
router.get('/orders/:orderId', (req, res) => {
  try {
    const db = getDb();
    const order = db.prepare(`SELECT * FROM shop_orders WHERE order_id = ?`).get(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Замовлення не знайдено' });
    const items = db.prepare(`SELECT * FROM shop_order_items WHERE order_id = ?`).all(req.params.orderId);
    res.json({
      orderId: order.order_id,
      total: order.total_uah / 100,
      paymentStatus: order.payment_status,
      fulfillmentStatus: order.fulfillment_status,
      items: items.map(i => ({ sku: i.sku, name: i.product_name, qty: i.quantity, subtotal: i.subtotal_uah / 100 })),
      createdAt: order.created_at,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
