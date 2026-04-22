import { verifyFirebaseToken, admin } from '../config/firebase.js';
import { ApiError } from '../utils/ApiError.js';

export class FirebaseService {

  /**
   * Verifies a Firebase ID Token and extracts structured auth info.
   * Works for BOTH phone auth and Google/Apple sign-in via Firebase.
   */
  static async verifyAndExtract(firebaseIdToken) {
    const decoded = await verifyFirebaseToken(firebaseIdToken);

    const provider = decoded.firebase?.sign_in_provider; 
    // Values: 'phone', 'google.com', 'apple.com'

    return {
      uid:      decoded.uid,
      phone:    decoded.phone_number   || null,
      email:    decoded.email          || null,
      name:     decoded.name           || null,
      picture:  decoded.picture        || null,
      provider: provider,              // 'phone' | 'google.com' | 'apple.com'
      isPhoneVerified: provider === 'phone',
      isEmailVerified: decoded.email_verified || false,
    };
  }

  /**
   * Revoke Firebase tokens for a user (on account ban/logout all devices).
   */
  static async revokeTokens(firebaseUid) {
    await admin.auth().revokeRefreshTokens(firebaseUid);
  }

  /**
   * Delete a Firebase user (on account deletion).
   */
  static async deleteFirebaseUser(firebaseUid) {
    await admin.auth().deleteUser(firebaseUid);
  }
}