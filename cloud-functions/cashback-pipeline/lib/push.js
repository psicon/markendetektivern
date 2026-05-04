/**
 * FCM push helper for cashback events.
 *
 * Phase 2 v1: console-logs the payload. Phase 2.1 (after the app adds
 * @react-native-firebase/messaging + dev-client rebuild) wires this to
 * admin.messaging() with proper token cleanup.
 *
 * Token storage convention (from CASHBACK_ARCHITECTURE.md §3):
 *   /users/{uid}/fcmTokens/{tokenId} = { token, platform, addedAt }
 */

'use strict';

const admin = require('firebase-admin');

async function getUserTokens(uid) {
  try {
    const snap = await admin.firestore().collection(`users/${uid}/fcmTokens`).get();
    return snap.docs.map((d) => d.data().token).filter(Boolean);
  } catch (e) {
    console.warn('[cashback.push] getUserTokens failed', { uid, err: e.message });
    return [];
  }
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
  const tokens = await getUserTokens(uid);
  if (!tokens.length) {
    console.log('[cashback.push] no FCM tokens — skipping', { uid });
    return { sent: 0, skipped: true };
  }

  const message = {
    notification: { title: payload.title, body: payload.body },
    data: {
      cashbackId: String(payload.cashbackId),
      deepLink: payload.deepLink || `markendetektivern://cashback/pending/${payload.cashbackId}`,
      kind: 'cashback_ready',
    },
  };

  // Phase 2.1: wire admin.messaging().sendEachForMulticast({ tokens, ...message })
  // Until then, log so the rest of the pipeline can be tested without
  // dev-client rebuild.
  console.log('[cashback.push] would send', {
    uid,
    tokens: tokens.length,
    title: message.notification.title,
  });

  return { sent: 0, stub: true };
}

module.exports = { sendCashbackReady };
