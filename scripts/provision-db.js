const { readFile } = require('node:fs/promises');
const { escapeLiteral } = require('pg');
const { createPool, transaction } = require('../src/db/pool');
const { migrate } = require('./migrate');

async function provision() {
  const { masterPassword, runtimePassword } = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const port = Number(process.argv[3]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid RDS port.');
  const pool = createPool(`postgresql://habits_admin:${encodeURIComponent(masterPassword)}@floci:${port}/habittracker`);
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await pool.query('SELECT 1');
        break;
      } catch (error) {
        if (attempt >= 20) throw error;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
    await migrate(pool);
    await transaction(pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(3001, 1)');
      const role = await db.query(`SELECT 1 FROM pg_roles WHERE rolname = 'habits_service'`);
      if (!role.rowCount) await db.query('CREATE ROLE habits_service LOGIN');
      await db.query(`ALTER ROLE habits_service PASSWORD ${escapeLiteral(runtimePassword)}`);
      await db.query('GRANT CONNECT ON DATABASE habittracker TO habits_service');
      await db.query('GRANT USAGE ON SCHEMA habits TO habits_service');
      await db.query('GRANT SELECT ON habits.schema_migrations TO habits_service');
      await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON habits.habits_habits, habits.habits_tags,
        habits.habits_templates, habits.habits_outbox TO habits_service`);
    });
  } finally {
    await pool.end();
  }
}

provision().catch(error => {
  console.error('PostgreSQL provisioning failed:', error.code || error.name);
  process.exitCode = 1;
});
