const { hostname } = require('node:os');
const { randomUUID } = require('node:crypto');
const {
  CloudWatchLogsClient, CreateLogStreamCommand, PutLogEventsCommand,
} = require('@aws-sdk/client-cloudwatch-logs');

function createLogger(config) {
  const { logGroup: logGroupName } = config;
  const logStreamName = `${hostname()}/${randomUUID()}`;
  const client = logGroupName && new CloudWatchLogsClient(config.aws);
  const buffer = [];
  let flushing;
  let streamReady = false;

  function log(entry) {
    const timestamp = Date.now();
    const message = JSON.stringify({ timestamp: new Date(timestamp).toISOString(), ...entry });
    console.log(message);
    if (client && buffer.length < 1_000) buffer.push({ timestamp, message });
  }

  function flush() {
    if (!client || flushing || !buffer.length) return flushing;
    const send = command => client.send(command, { abortSignal: AbortSignal.timeout(3_000) });
    flushing = (async () => {
      if (!streamReady) {
        try {
          await send(new CreateLogStreamCommand({ logGroupName, logStreamName }));
        } catch (error) {
          if (error.name !== 'ResourceAlreadyExistsException') throw error;
        }
        streamReady = true;
      }
      const logEvents = buffer.splice(0, 100);
      await send(new PutLogEventsCommand({ logGroupName, logStreamName, logEvents }));
    })().catch(error => {
      console.error(JSON.stringify({ event: 'cloudwatch_delivery_failed', errorCode: error.name }));
    }).finally(() => { flushing = undefined; });
    return flushing;
  }

  const timer = client && setInterval(flush, 2_000);
  return {
    log,
    async close() {
      clearInterval(timer);
      await flushing;
      await flush();
      client?.destroy();
    },
  };
}

module.exports = { createLogger };
