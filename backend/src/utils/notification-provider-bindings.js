const PRODUCTION_APNS_HOST = 'api.push.apple.com';
const SECRET_PREFIX = 'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/';
const SHARED_FIREBASE_PROJECT = 'wizz-business-app';

function isProduction(env) {
  const stages = [env.ENVIRONMENT, env.PLATFORM_ENVIRONMENT, env.STAGE].filter(Boolean);
  const production = stages.some(stage => ['production', 'prod'].includes(stage));
  if (production && (env.AWS_REGION !== 'us-east-1' ||
      stages.some(stage => !['production', 'prod'].includes(stage)))) {
    throw new Error('NOTIFICATION_ENVIRONMENT_NOT_CONFIGURED');
  }
  return production;
}

function productionSecret(arn, path) {
  const prefix = SECRET_PREFIX + path + '-';
  return typeof arn === 'string' && arn.startsWith(prefix) && /^[A-Za-z0-9]{6}$/.test(arn.slice(prefix.length));
}

function firebaseBinding(env = process.env) {
  const secretId = env.FIREBASE_ADMIN_SA_SECRET_ID;
  if (!isProduction(env)) return { secretId };
  const projectId = env.FIREBASE_PRODUCTION_PROJECT_ID;
  const serviceAccountEmail = env.FIREBASE_PRODUCTION_SERVICE_ACCOUNT_EMAIL;
  if (!productionSecret(secretId, 'firebase/admin-service-account') ||
      projectId !== SHARED_FIREBASE_PROJECT ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@wizz-business-app\.iam\.gserviceaccount\.com$/.test(serviceAccountEmail ?? '')) {
    throw new Error('FIREBASE_PRODUCTION_NOT_CONFIGURED');
  }
  return { secretId, projectId, serviceAccountEmail, appName: 'wizz-production-notifications' };
}

function apnsBinding(env = process.env) {
  const secretId = env.APNS_AUTH_KEY_SECRET_ID;
  if (!isProduction(env)) return {
    secretId, host: env.APNS_HOST || PRODUCTION_APNS_HOST,
    fallbackHost: env.APNS_FALLBACK_HOST || 'api.sandbox.push.apple.com',
    bundleId: env.LIVE_ACTIVITY_BUNDLE_ID || 'com.wiz.wizuserapp'
  };
  const teamId = env.APNS_PRODUCTION_TEAM_ID;
  const bundleId = env.LIVE_ACTIVITY_BUNDLE_ID;
  if (!productionSecret(secretId, 'apns/auth-key') || !/^[A-Z0-9]{10}$/.test(teamId ?? '') ||
      !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleId ?? '') ||
      (env.APNS_HOST && env.APNS_HOST !== PRODUCTION_APNS_HOST) || env.APNS_FALLBACK_HOST) {
    throw new Error('APNS_PRODUCTION_NOT_CONFIGURED');
  }
  return { secretId, teamId, bundleId, host: PRODUCTION_APNS_HOST };
}

module.exports = { firebaseBinding, apnsBinding, isProduction };
