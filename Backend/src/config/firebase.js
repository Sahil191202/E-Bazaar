import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let firebaseApp;

export const initFirebase = () => {
  if (firebaseApp) return firebaseApp;

  try {
    // Option A: Service account JSON file (recommended for local dev)
    // Place your Firebase service account JSON at project root
    const serviceAccount = JSON.parse(
      readFileSync(join(__dirname, '../../firebase-service-account.json'), 'utf8')
    );

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    // Option B: Environment variable (recommended for production)
    // const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    // firebaseApp = admin.initializeApp({
    //   credential: admin.credential.cert(serviceAccount),
    // });

    logger.info('✅ Firebase Admin initialized');
    return firebaseApp;
  } catch (err) {
    logger.error('Firebase init failed:', err.message);
    process.exit(1);
  }
};

// Verify any Firebase ID token (phone auth OR Google OAuth via Firebase)
export const verifyFirebaseToken = async (idToken) => {
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded; 
    // decoded contains: uid, phone_number, email, name, picture, firebase.sign_in_provider
  } catch (err) {
    throw new Error(`Firebase token invalid: ${err.message}`);
  }
};

export { admin };