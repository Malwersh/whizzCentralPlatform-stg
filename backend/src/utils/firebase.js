const admin = require('firebase-admin');
const { getSecretJson } = require('./secrets');

let appPromise = null;

async function getFirebaseApp() {
  if (appPromise) return appPromise;

  appPromise = (async () => {
    if (admin.apps && admin.apps.length > 0) {
      return admin.apps[0];
    }

    const secretId = process.env.FIREBASE_ADMIN_SA_SECRET_ID;
    if (!secretId) throw new Error('Missing FIREBASE_ADMIN_SA_SECRET_ID');

    const serviceAccount = await getSecretJson(secretId);

    const app = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    return app;
  })();

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
