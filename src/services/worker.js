const { transaction } = require('../db/pool');
const outbox = require('../repositories/outbox');

function startWorker(pool, habits, integrations, log) {
  let active;
  let nextReconciliation = 0;
  const run = async () => {
    if (Date.now() >= nextReconciliation) {
      await habits.resumeExpired();
      nextReconciliation = Date.now() + 15_000;
    }
    if (!integrations.targets.length) return;
    await transaction(pool, async db => {
      const job = await outbox.next(db, integrations.targets);
      if (!job) return;
      let status;
      try {
        status = await integrations.deliver(job);
      } catch {
        status = null;
      }
      if ((status >= 200 && status < 300) || (job.target === 'streaks' && job.payload.deleted && status === 404)) {
        await outbox.done(db, job);
        return;
      }
      const failed = status >= 400 && status < 500 && ![408, 429].includes(status);
      await outbox.retry(db, job, failed);
      log({ event: 'integration_delivery_failed', requestId: job.requestId, target: job.target, status, retry: !failed });
    });
  };

  const tick = () => {
    if (active) return;
    active = run().catch(error => {
      log({ event: 'background_worker_error', errorCode: error.code || error.name });
    }).finally(() => { active = undefined; });
  };
  const timer = setInterval(tick, 750);
  tick();
  return async () => {
    clearInterval(timer);
    await active;
  };
}

module.exports = { startWorker };
