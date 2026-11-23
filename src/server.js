const { once } = require('node:events');
const { createApp } = require('./app');
const { loadConfig } = require('./config');
const { createPool } = require('./db/pool');
const { createIntegrations } = require('./integrations/services');
const { createLogger } = require('./integrations/logger');
const { createHabitService } = require('./services/habits');
const { createTemplateService } = require('./services/templates');
const { startWorker } = require('./services/worker');

async function start() {
  const config = await loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    await pool.query('SELECT 1 FROM habits.schema_migrations LIMIT 1');
  } catch (error) {
    await pool.end();
    throw error;
  }

  const logger = createLogger(config);
  const integrations = createIntegrations(config);
  const habits = createHabitService(pool, integrations);
  const templates = createTemplateService(pool);
  const app = createApp({ pool, config, habits, templates, log: logger.log });
  const server = app.listen(config.port);
  try {
    await once(server, 'listening');
  } catch (error) {
    await pool.end();
    await logger.close();
    throw error;
  }
  const stopWorker = startWorker(pool, habits, integrations, logger.log);
  logger.log({ event: 'service_started', port: config.port });

  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    const closed = new Promise(resolve => server.close(resolve));
    await Promise.all([stopWorker(), closed]);
    await pool.end();
    await logger.close();
  }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

start().catch(error => {
  const reason = error.message.startsWith('Set ') ? error.message : error.code || error.name;
  console.error(JSON.stringify({ event: 'startup_failed', reason }));
  process.exitCode = 1;
});
