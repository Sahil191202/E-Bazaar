import { admin }  from '../config/firebase.js';
import { User }   from '../models/User.js';
import logger     from '../utils/logger.js';

export class FCMService {

  // ─── Send to a single user (all their devices) ───────────────────────────
  static async sendToUser(userId, { title, body, data = {}, imageUrl = null }) {
    try {
      const user = await User.findById(userId).select('fcmTokens').lean();
      if (!user?.fcmTokens?.length) return;

      const tokens = user.fcmTokens.map((t) => t.token);
      if (!tokens.length) return;

      const message = {
        notification: {
          title,
          body,
          ...(imageUrl && { imageUrl }),
        },
        data: Object.fromEntries(
          // FCM data values must all be strings
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        android: {
          priority: 'high',
          notification: {
            sound:       'default',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
            channelId:   'default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
        tokens,
      };

      const response = await admin.messaging().sendEachForMulticast(message);

      // Clean up invalid/expired tokens
      if (response.failureCount > 0) {
        const expiredTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const code = resp.error?.code;
            if (
              code === 'messaging/invalid-registration-token' ||
              code === 'messaging/registration-token-not-registered'
            ) {
              expiredTokens.push(tokens[idx]);
            }
          }
        });

        if (expiredTokens.length) {
          await User.findByIdAndUpdate(userId, {
            $pull: { fcmTokens: { token: { $in: expiredTokens } } },
          });
          logger.info(`Removed ${expiredTokens.length} expired FCM tokens for user ${userId}`);
        }
      }

      return response;
    } catch (err) {
      logger.error(`FCM sendToUser error for ${userId}:`, err.message);
    }
  }

  // ─── Send to a topic (e.g. all vendors, all agents) ───────────────────────
  static async sendToTopic(topic, { title, body, data = {} }) {
    try {
      const message = {
        notification: { title, body },
        data: Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
        android:  { priority: 'high' },
        apns:     { payload: { aps: { sound: 'default' } } },
        topic,
      };

      const response = await admin.messaging().send(message);
      logger.info(`FCM topic "${topic}" sent: ${response}`);
      return response;
    } catch (err) {
      logger.error(`FCM sendToTopic error for "${topic}":`, err.message);
    }
  }

  // ─── Send to multiple users (batch) ──────────────────────────────────────
  static async sendBatch(userIds, payload) {
    // Process in chunks of 100 to avoid overwhelming the system
    const chunkSize = 100;
    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);
      await Promise.allSettled(chunk.map((id) => this.sendToUser(id, payload)));
    }
  }

  // ─── Register FCM token for a user/device ────────────────────────────────
  static async registerToken(userId, token, platform) {
    if (!token || !platform) return;

    await User.findByIdAndUpdate(userId, {
      // Remove token from any position first (avoid duplicates)
      $pull: { fcmTokens: { token } },
    });

    await User.findByIdAndUpdate(userId, {
      $push: {
        fcmTokens: {
          $each: [{ token, platform }],
          $slice: -5, // Keep max 5 devices per user
        },
      },
    });
  }

  // ─── Unregister FCM token (on logout) ────────────────────────────────────
  static async unregisterToken(userId, token) {
    await User.findByIdAndUpdate(userId, {
      $pull: { fcmTokens: { token } },
    });
  }
}