/* SQLite stub — auth/payments use this but they're not critical on Render */
const handler = {
  get(_, prop) {
    return (...args) => {
      console.warn(`[db-stub] SQLite not available. Called: ${prop}`);
      return { changes: 0, lastInsertRowid: 0 };
    };
  }
};
module.exports = new Proxy({}, handler);
