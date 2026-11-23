const { Pool, types } = require('pg');

types.setTypeParser(1082, value => value);

function createPool(connectionString) {
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5_000, statement_timeout: 8_000 });
  pool.on('error', error => console.error(JSON.stringify({ event: 'database_error', errorCode: error.code || error.name })));
  return pool;
}

async function transaction(pool, operation) {
  const client = await pool.connect();
  let releaseError;
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      releaseError = rollbackError;
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

module.exports = { createPool, transaction };
