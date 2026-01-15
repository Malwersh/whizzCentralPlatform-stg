const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });

const cache = new Map();

async function getSecretString(secretId) {
  if (!secretId) throw new Error('Missing secretId');
  if (cache.has(secretId)) return cache.get(secretId);

  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: secretId }));

  let secretString = result.SecretString;
  if (!secretString && result.SecretBinary) {
    secretString = Buffer.from(result.SecretBinary, 'base64').toString('utf8');
  }

  if (!secretString) throw new Error(`Secret ${secretId} has no SecretString/SecretBinary`);

  cache.set(secretId, secretString);
  return secretString;
}

async function getSecretJson(secretId) {
  const secretString = await getSecretString(secretId);
  try {
    return JSON.parse(secretString);
  } catch (e) {
    throw new Error(`Secret ${secretId} is not valid JSON`);
  }
}

module.exports = {
  getSecretString,
  getSecretJson
};
