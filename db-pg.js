/* Postgres connection pool for svs-booking (catalog/shop) */
const { Pool } = require('pg');
let pool = null;

function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL не задан');
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('neon.tech') ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (err) => console.error('[pg pool error]', err.message));
  return pool;
}

async function query(text, params) { return getPool().query(text, params); }
function isEnabled() { return !!process.env.DATABASE_URL; }

module.exports = { query, isEnabled, getPool };
