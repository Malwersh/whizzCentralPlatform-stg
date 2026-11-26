const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {firebaseBinding, apnsBinding} = require('../src/utils/notification-provider-bindings');

const arn = 'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/';
const env = {
  STAGE: 'production',
  AWS_REGION: 'us-east-1',
  FIREBASE_ADMIN_SA_SECRET_ID: arn + 'firebase/admin-service-account-Ab12Cd',
  FIREBASE_PRODUCTION_PROJECT_ID: 'wizz-business-app',
  FIREBASE_PRODUCTION_SERVICE_ACCOUNT_EMAIL: 'wizz-production-notifications@wizz-business-app.iam.gserviceaccount.com',
  APNS_AUTH_KEY_SECRET_ID: arn + 'apns/auth-key-Ab12Cd',
  APNS_PRODUCTION_TEAM_ID: 'ABC1234567',
  LIVE_ACTIVITY_BUNDLE_ID: 'com.wiz.wizuserapp'
};

test('production messaging uses the shared Firebase project with its own configured principal', () => {
  assert.equal(firebaseBinding(env).projectId, env.FIREBASE_PRODUCTION_PROJECT_ID);
  assert.equal(firebaseBinding(env).serviceAccountEmail, env.FIREBASE_PRODUCTION_SERVICE_ACCOUNT_EMAIL);
  for (const change of [
    {FIREBASE_ADMIN_SA_SECRET_ID: 'wizz/staging/firebase/admin-service-account'},
    {FIREBASE_ADMIN_SA_SECRET_ID: env.FIREBASE_ADMIN_SA_SECRET_ID.replace('746727375268', '699561669180')},
    {FIREBASE_PRODUCTION_PROJECT_ID: 'another-project'},
    {FIREBASE_PRODUCTION_PROJECT_ID: undefined},
    {FIREBASE_PRODUCTION_SERVICE_ACCOUNT_EMAIL: undefined},
    {FIREBASE_PRODUCTION_SERVICE_ACCOUNT_EMAIL: 'notification@another-project.iam.gserviceaccount.com'},
    {ENVIRONMENT: 'staging'}
  ]) assert.throws(() => firebaseBinding({...env, ...change}), /NOT_CONFIGURED/);
});

test('production Live Activity uses APNs production and an explicit bundle', () => {
  const production = apnsBinding(env);
  assert.equal(production.host, 'api.push.apple.com');
  assert.equal(production.fallbackHost, undefined);
  assert.equal(production.bundleId, env.LIVE_ACTIVITY_BUNDLE_ID);
  for (const change of [
    {APNS_FALLBACK_HOST: 'api.sandbox.push.apple.com'},
    {APNS_HOST: 'api.sandbox.push.apple.com'},
    {APNS_PRODUCTION_TEAM_ID: undefined},
    {LIVE_ACTIVITY_BUNDLE_ID: undefined},
    {APNS_AUTH_KEY_SECRET_ID: 'wizz/staging/apns/auth-key'}
  ]) assert.throws(() => apnsBinding({...env, ...change}), /APNS_PRODUCTION_NOT_CONFIGURED/);
  assert.equal(apnsBinding({STAGE: 'staging'}).fallbackHost, 'api.sandbox.push.apple.com');
});

test('production initializes its own Firebase app and rejects a mismatched service account', async () => {
  const module = {exports: {}};
  const source = fs.readFileSync(require.resolve('../src/utils/firebase'), 'utf8');
  const stagingApp = {options: {projectId: 'wizz-business-app'}};
  const calls = [];
  let serviceAccount = {type: 'service_account', project_id: 'another-project'};
  vm.runInNewContext(source, {
    module,
    require(name) {
      switch (name) {
        case 'firebase-admin':
          return {
            apps: [stagingApp],
            credential: {cert: account => account},
            initializeApp(options, appName) {
              calls.push({options, appName});
              return {options};
            }
          };
        case './secrets':
          return {async getSecretJson(secretId) {
            assert.equal(secretId, env.FIREBASE_ADMIN_SA_SECRET_ID);
            return serviceAccount;
          }};
        case './notification-provider-bindings':
          return {firebaseBinding: () => firebaseBinding(env)};
        default:
          throw Error(name);
      }
    }
  });
  const {getFirebaseApp} = module.exports;
  await assert.rejects(getFirebaseApp(), /FIREBASE_PRODUCTION_PROJECT_MISMATCH/);
  serviceAccount = {...serviceAccount, project_id: env.FIREBASE_PRODUCTION_PROJECT_ID,
    client_email: 'staging-notifier@wizz-business-app.iam.gserviceaccount.com'};
  await assert.rejects(getFirebaseApp(), /FIREBASE_PRODUCTION_PROJECT_MISMATCH/);
  assert.equal(calls.length, 0);
  serviceAccount.client_email = env.FIREBASE_PRODUCTION_SERVICE_ACCOUNT_EMAIL;
  assert.equal((await getFirebaseApp()).options.projectId, env.FIREBASE_PRODUCTION_PROJECT_ID);
  assert.equal(calls[0].appName, 'wizz-production-notifications');
  await getFirebaseApp();
  assert.equal(calls.length, 1);
});
