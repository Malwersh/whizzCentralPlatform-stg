const { CognitoJwtVerifier } = require('aws-jwt-verify');

const COGNITO_REGION = process.env.COGNITO_REGION || 'us-east-1';

const pools = {
  central: {
    userPoolId: process.env.CENTRAL_PLATFORM_USER_POOL_ID,
    clientId: process.env.CENTRAL_PLATFORM_CLIENT_ID
  },
  users: {
    userPoolId: process.env.USERS_USER_POOL_ID,
    clientId: process.env.USERS_CLIENT_ID
  },
  merchants: {
    userPoolId: process.env.MERCHANTS_USER_POOL_ID,
    clientId: process.env.MERCHANTS_CLIENT_ID
  },
  drivers: {
    userPoolId: process.env.DRIVERS_USER_POOL_ID,
    clientId: process.env.DRIVERS_CLIENT_ID
  }
};

const verifierCache = new Map();

function getVerifier({ userPoolId, clientId, tokenUse }) {
  if (!userPoolId) return null;
  const cacheKey = `${userPoolId}:${clientId || ''}:${tokenUse}`;
  if (verifierCache.has(cacheKey)) return verifierCache.get(cacheKey);

  const verifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse,
    clientId: tokenUse === 'id' ? clientId : null
  });

  verifierCache.set(cacheKey, verifier);
  return verifier;
}

function extractBearerToken(event) {
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  return token || null;
}

async function verifyJwtForPool(token, pool) {
  if (!pool?.userPoolId) return null;

  // First try ID token (common in these apps)
  if (pool.clientId) {
    const idVerifier = getVerifier({ userPoolId: pool.userPoolId, clientId: pool.clientId, tokenUse: 'id' });
    try {
      return await idVerifier.verify(token, { region: COGNITO_REGION });
    } catch (e) {
      // continue
    }
  }

  // Then try access token
  const accessVerifier = getVerifier({ userPoolId: pool.userPoolId, clientId: pool.clientId, tokenUse: 'access' });
  try {
    return await accessVerifier.verify(token, { region: COGNITO_REGION });
  } catch (e) {
    return null;
  }
}

async function verifyJwtMulti(event, userTypeHint) {
  const token = extractBearerToken(event);
  if (!token) throw new Error('Missing Authorization token');

  const order = [];
  if (userTypeHint === 'support' || userTypeHint === 'agent' || userTypeHint === 'central') {
    order.push('central');
  } else if (userTypeHint === 'user' || userTypeHint === 'users') {
    order.push('users');
  } else if (userTypeHint === 'merchant') {
    order.push('merchants');
  } else if (userTypeHint === 'driver') {
    order.push('drivers');
  }

  // Fallback: try all configured pools
  for (const key of ['central', 'users', 'merchants', 'drivers']) {
    if (!order.includes(key)) order.push(key);
  }

  for (const key of order) {
    const payload = await verifyJwtForPool(token, pools[key]);
    if (payload) return { payload, pool: key };
  }

  throw new Error('Invalid token');
}

module.exports = {
  extractBearerToken,
  verifyJwtMulti
};
