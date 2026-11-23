const { readFile, readdir } = require('node:fs/promises');
const { join } = require('node:path');
const { createPool, transaction } = require('../src/db/pool');

async function migrate(pool) {
  const dir = join(__dirname, '..', 'migrations');
  const files = (await readdir(dir)).filter(name => /^\d+_.*\.sql$/.test(name)).sort();
  await transaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(3001, 1)');
    await db.query('CREATE SCHEMA IF NOT EXISTS habits');
    await db.query(`CREATE TABLE IF NOT EXISTS habits.schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await db.query('SELECT name FROM habits.schema_migrations');
    const applied = new Set(rows.map(row => row.name));
    for (const name of files) {
      if (applied.has(name)) continue;
      await db.query(await readFile(join(dir, name), 'utf8'));
      await db.query('INSERT INTO habits.schema_migrations (name) VALUES ($1)', [name]);
    }
  });
}

if (require.main === module) {
  const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  if (!url) {
    console.error('Set DATABASE_URL_DIRECT or DATABASE_URL before running migrations.');
    process.exitCode = 1;
  } else {
    const pool = createPool(url);
    migrate(pool).then(() => console.log('Habits migrations applied.')).catch(error => {
      console.error('Habits migration failed:', error.code || error.name);
      process.exitCode = 1;
    }).finally(() => pool.end());
  }
}

module.exports = { migrate };
