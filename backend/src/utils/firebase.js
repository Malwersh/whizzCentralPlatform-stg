const admin = require('firebase-admin');
const { getSecretJson } = require('./secrets');
const { firebaseBinding } = require('./notification-provider-bindings');

let appPromise = null;

async function getFirebaseApp() {
  if (appPromise) return appPromise;

  appPromise = (async () => {
    const { secretId, projectId, serviceAccountEmail, appName } = firebaseBinding();
    if (!appName && admin.apps && admin.apps.length > 0) {
      return admin.apps[0];
    }

    if (!secretId) throw new Error('Missing FIREBASE_ADMIN_SA_SECRET_ID');

    const serviceAccount = await getSecretJson(secretId);
    if (projectId && (serviceAccount?.project_id !== projectId || serviceAccount.type !== 'service_account' ||
        serviceAccount.client_email !== serviceAccountEmail)) {
      throw new Error('FIREBASE_PRODUCTION_PROJECT_MISMATCH');
    }
    const options = { credential: admin.credential.cert(serviceAccount) };
    if (projectId) options.projectId = projectId;
    return appName ? admin.initializeApp(options, appName) : admin.initializeApp(options);
  })().catch(error => {
    appPromise = null;
    throw error;
  });

  return appPromise;
}

async function getMessaging() {
  const app = await getFirebaseApp();
  return app.messaging();
}

module.exports = {
  getFirebaseApp,
  getMessaging
};
