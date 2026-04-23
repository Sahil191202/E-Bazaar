import admin from 'firebase-admin';
import logger from '../utils/logger.js';

let firebaseApp;

export const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    logger.info('✅ Firebase Admin initialized');
    return firebaseApp;
  } catch (err) {
    logger.error('Firebase init failed:', err.message);
    process.exit(1);
  }
};

export const verifyFirebaseToken = async (idToken) => {
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded;
  } catch (err) {
    throw new Error(`Firebase token invalid: ${err.message}`);
  }
};

export { admin };