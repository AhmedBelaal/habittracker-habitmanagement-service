const fs = require('node:fs');
const { randomBytes } = require('node:crypto');

const directory = '.local';
const configFile = `${directory}/floci-db.json`;
const [operation, port] = process.argv.slice(2);
const random = () => randomBytes(24).toString('hex');

fs.mkdirSync(directory, { recursive: true });
if (!fs.existsSync(configFile)) {
  const generated = {
    masterPassword: random(), runtimePassword: random(), internalToken: random(), legacyInboundKey: random(),
  };
  fs.writeFileSync(configFile, JSON.stringify(generated, null, 2), { flag: 'wx', mode: 0o600 });
}
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

if (operation === 'iam') {
  const [, , , secretArn, keyArn, logArn] = process.argv;
  if ([secretArn, keyArn, logArn].some(value => !value?.startsWith('arn:aws:'))) throw new Error('Expected service resource ARNs.');
  const policy = {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: 'secretsmanager:GetSecretValue', Resource: secretArn },
      { Effect: 'Allow', Action: 'kms:Decrypt', Resource: keyArn },
      { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: `${logArn.replace(/:\*$/, '')}:log-stream:*` },
    ],
  };
  fs.writeFileSync(`${directory}/iam-policy.json`, JSON.stringify(policy));
} else if (operation === 'rds' || operation === 'secret') {
  const input = operation === 'rds' ? {
    DBInstanceIdentifier: 'habittracker', DBInstanceClass: 'db.t3.micro', Engine: 'postgres',
    AllocatedStorage: 20, DBName: 'habittracker', MasterUsername: 'habits_admin',
    MasterUserPassword: config.masterPassword, Port: 7001, PubliclyAccessible: false, StorageEncrypted: true,
  } : {
    DATABASE_URL: `postgresql://habits_service:${config.runtimePassword}@floci:${port}/habittracker`,
    INTERNAL_TOKEN: process.env.INTERNAL_TOKEN || config.internalToken,
    LEGACY_INBOUND_KEY: process.env.LEGACY_INBOUND_KEY || config.legacyInboundKey,
    ...(process.env.SERVICE_B_KEY && { SERVICE_B_KEY: process.env.SERVICE_B_KEY }),
  };
  fs.writeFileSync(`${directory}/${operation}.json`, JSON.stringify(input), { mode: 0o600 });
} else {
  throw new Error('Use rds, secret or iam.');
}
