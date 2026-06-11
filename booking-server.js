/* ═══════════════════════════════════════════════════════
   SVS Booking — Standalone MVP server
   Минимальные зависимости: только express
   Запуск: node booking-server.js
   ═══════════════════════════════════════════════════════ */
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const https = require('https');
const bookingRoutes = require('./routes/booking');

const app = express();
const PORT = process.env.PORT || 3001;
const HTTPS_PORT = process.env.HTTPS_PORT || 8443;

// CORS — открытый для теста
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '1mb' }));
const path = require('path');
app.use('/admin', express.static(path.join(__dirname, 'public')));
// Витрина Raywell — отдаём shop.html по чистому URL /shop
app.get('/shop', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop.html')));
app.use('/shop-assets', express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.json({ ok: true, service: 'svs-booking', time: new Date().toISOString() }));
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
// alias — ecosystem_health ищет /health
app.get('/health', (req, res) => res.json({ ok: true, service: 'svs-booking', time: new Date().toISOString() }));

app.use('/api/booking', bookingRoutes);
app.use('/api/admin', require('./routes/admin'));
// CRM-layer (путь C) — магазин Raywell + вебхуки BeautyPro
app.use('/api/shop', require('./routes/shop'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/internal', require('./routes/internal'));

app.use((err, req, res, next) => {
  console.error('[svs-booking]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

// HTTP (для локальных health-check)
app.listen(PORT, '0.0.0.0', () => {
  console.log('[svs-booking] HTTP on http://0.0.0.0:' + PORT);
});

// HTTPS (для Telegram webhook)
const sslDir = require('path').join(__dirname, 'ssl');
if (fs.existsSync(sslDir + '/key.pem') && fs.existsSync(sslDir + '/cert.pem')) {
  const sslOpts = {
    key: fs.readFileSync(sslDir + '/key.pem'),
    cert: fs.readFileSync(sslDir + '/cert.pem'),
  };
  https.createServer(sslOpts, app).listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log('[svs-booking] HTTPS on https://0.0.0.0:' + HTTPS_PORT);
  });
} else {
  console.warn('[svs-booking] SSL certs not found, HTTPS disabled');
}

// Спринт 3 — фоновий воркер нагадувань
try { require('./worker/notifier').start(); }
catch (e) { console.error('[svs-booking] notifier start:', e.message); }

// Keep-alive: Render free tier засыпает после 15 мин без входящего трафика.
// Каждые 10 мин пингуем свой публичный URL (входящий запрос = не спим)
// и shop-api (взаимное пробуждение). Полностью автономно.
if (process.env.RENDER || process.env.RENDER_EXTERNAL_URL) {
  const KEEPALIVE_URLS = [
    process.env.RENDER_EXTERNAL_URL || 'https://svs-booking-api.onrender.com',
    'https://svs-shop-api.onrender.com',
  ];
  setInterval(() => {
    for (const base of KEEPALIVE_URLS) {
      fetch(base.replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(60000) })
        .catch(() => {}); // молча — это просто пинг
    }
  }, 10 * 60 * 1000).unref();
  console.log('[svs-booking] keep-alive pings enabled (10 min)');
}
