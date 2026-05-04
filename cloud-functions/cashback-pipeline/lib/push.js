/**
 * FCM push helper for cashback events.
 *
 * Reads /users/{uid}/fcmTokens/* (one doc per device, written by the
 * app's lib/services/fcmTokenService.ts), fans out the message via
 * admin.messaging().sendEachForMulticast, and prunes any tokens the
 * server reports as invalid / unregistered.
 *
 * Token storage convention:
 *   /users/{uid}/fcmTokens/{tokenId}
 *     {
 *       token: '...',
 *       platform: 'ios' | 'android',
 *       addedAt, lastSeenAt
 *     }
 */

'use strict';

const admin = require('firebase-admin');
const { logger } = require('firebase-functions');

async function getUserTokens(uid) {
  try {
    const snap = await admin.firestore().collection(`users/${uid}/fcmTokens`).get();
    return snap.docs.map((d) => ({
      docId: d.id,
      token: String(d.get('token') || ''),
    })).filter((x) => x.token);
  } catch (e) {
    logger.warn('[cashback.push] getUserTokens failed', { uid, err: e.message });
    return [];
  }
}

const INVALID_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'messaging/mismatched-credential',
]);

async function pruneInvalidTokens(uid, entries, results) {
  const stale = [];
  results.forEach((r, idx) => {
    if (!r.success) {
      const code = r.error?.code;
      if (code && INVALID_CODES.has(code)) {
        stale.push(entries[idx]);
      }
    }
  });
  if (!stale.length) return;
  const batch = admin.firestore().batch();
  for (const s of stale) {
    batch.delete(admin.firestore().doc(`users/${uid}/fcmTokens/${s.docId}`));
  }
  await batch.commit().catch((e) =>
    logger.warn('[cashback.push] prune-failed', { uid, err: e.message }),
  );
  logger.info('[cashback.push] pruned-stale-tokens', { uid, count: stale.length });
}

/**
 * Send a "cashback ready" push.
 *
 * @param {string} uid
 * @param {object} payload
 * @param {string} payload.title
 * @param {string} payload.body
 * @param {string} payload.cashbackId
 * @param {string} [payload.deepLink]
 */
async function sendCashbackReady(uid, payload) {
  const entries = await getUserTokens(uid);
  if (!entries.length) {
    logger.info('[cashback.push] no FCM tokens', { uid });
    return { sent: 0, skipped: true };
  }

  const tokens = entries.map((e) => e.token);
  const message = {
    notification: { title: payload.title, body: payload.body },
    data: {
      cashbackId: String(payload.cashbackId),
      deepLink: payload.deepLink || `markendetektivern://cashback/pending/${payload.cashbackId}`,
      kind: 'cashback_ready',
    },
    apns: {
      payload: {
        aps: { sound: 'default', badge: 1 },
      },
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'cashback',
        sound: 'default',
      },
    },
  };

  let response;
  try {
    response = await admin.messaging().sendEachForMulticast({ tokens, ...message });
  } catch (e) {
    logger.error('[cashback.push] sendEachForMulticast threw', { uid, err: e.message });
    return { sent: 0, error: e.message };
  }

  await pruneInvalidTokens(uid, entries, response.responses);

  logger.info('[cashback.push] sent', {
    uid,
    cashbackId: payload.cashbackId,
    tokens: tokens.length,
    success: response.successCount,
    failure: response.failureCount,
  });

  return { sent: response.successCount, failed: response.failureCount };
}

module.exports = { sendCashbackReady };
