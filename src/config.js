const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

function required(values, name) {
  if (typeof values[name] !== 'string' || !values[name].trim()) throw new Error(`Set ${name}.`);
  return values[name];
}

function serviceUrl(values, name) {
  if (!values[name]) return undefined;
  const url = new URL(values[name]);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(`Set ${name} to a service origin.`);
  }
  return url.origin;
}

async function loadConfig(env = process.env) {
  const aws = { region: env.AWS_REGION || 'us-east-1', ...(env.AWS_ENDPOINT_URL && { endpoint: env.AWS_ENDPOINT_URL }) };
  let values = env;
  if (env.SERVICE_SECRET_ID) {
    const client = new SecretsManagerClient(aws);
    try {
      const response = await client.send(new GetSecretValueCommand({ SecretId: env.SERVICE_SECRET_ID }), {
        abortSignal: AbortSignal.timeout(10_000),
      });
      values = { ...env, ...JSON.parse(response.SecretString) };
    } finally {
      client.destroy();
    }
  }
  const streaksUrl = serviceUrl(env, 'SERVICE_B_URL');
  const streaksProtocol = env.SERVICE_B_API || 'contract';
  if (!['legacy', 'contract'].includes(streaksProtocol)) throw new Error('Set SERVICE_B_API to legacy or contract.');
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set PORT to a valid TCP port.');
  return {
    port,
    databaseUrl: required(values, 'DATABASE_URL'),
    internalToken: required(values, 'INTERNAL_TOKEN'),
    legacyInboundKey: values.LEGACY_INBOUND_KEY,
    streaksUrl, streaksProtocol,
    streaksKey: streaksUrl && streaksProtocol === 'legacy' ? required(values, 'SERVICE_B_KEY') : undefined,
    timeUrl: serviceUrl(env, 'SERVICE_C_URL'),
    aws, logGroup: env.CLOUDWATCH_LOG_GROUP,
  };
}

module.exports = { loadConfig };
