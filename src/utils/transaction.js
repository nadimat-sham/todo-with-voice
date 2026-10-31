const pool = require("../config/db");

// Runs fn(conn) inside a transaction on one pooled connection: commits if fn
// resolves, rolls back if it throws, and always releases the connection.
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Thrown inside a transaction to abort it with a specific HTTP response.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { withTransaction, HttpError };
