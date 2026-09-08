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

const crypto = require('crypto');
const admin = require('firebase-admin');
const { logger } = require('firebase-functions');
const { pushErlaubt } = require('./pushPolicy');

/**
 * Token EINES Nutzers — und zwar nur, wenn er Nachrichten überhaupt will.
 *
 * Die Abbestellung (86cbfdq5j) wird hier geprüft, nicht beim Aufrufer: das
 * ist der einzige Ort, an dem Empfänger entstehen. Wer künftig einen
 * zweiten Sendeweg baut und diese Funktion nutzt, erbt die Regel
 * automatisch — genau das hat bisher gefehlt.
 *
 * Beide Lesungen laufen parallel; die Nutzer-Abfrage kostet einen Read je
 * Push und hat ihr EIGENES catch: scheitert sie, wird gesendet. Ein
 * Firestore-Fehler darf nicht wie eine Abbestellung wirken.
 */
async function getUserTokens(uid) {
  try {
    const [nutzerDaten, snap] = await Promise.all([
      admin
        .firestore()
        .doc(`users/${uid}`)
        .get()
        .then((d) => (d.exists ? d.data() : null))
        .catch((e) => {
          logger.warn('[cashback.push] Nutzerdokument nicht lesbar — wird gesendet', {
            uid,
            err: e.message,
          });
          return null;
        }),
      admin.firestore().collection(`users/${uid}/fcmTokens`).get(),
    ]);

    const urteil = pushErlaubt(nutzerDaten);
    if (!urteil.erlaubt) {
      logger.info('[cashback.push] abbestellt — kein Versand', { uid, grund: urteil.grund });
      return [];
    }

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
  // 86cb22c0m: eindeutige Push-ID für Konversions-Tracking. Wandert (a) in
  // die data-Payload (der Client protokolliert den Tap als
  // users/{uid}/push_events/{pushId}) und (b) ins Send-Log push_log/{pushId}
  // (admin-only). Auswertung „wer hat nach Push X gehandelt": push_log ×
  // push_events × receipts/crowd_uploads über uid + Zeitfenster joinen.
  const pushId = `p_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const deepLink = payload.deepLink || `markendetektivern://cashback/pending/${payload.cashbackId}`;
  const message = {
    notification: { title: payload.title, body: payload.body },
    data: {
      cashbackId: String(payload.cashbackId),
      deepLink,
      kind: 'cashback_ready',
      pushId,
    },
    apns: {
      payload: {
        // KEIN `badge` hier. Bis 08.09.2026 stand an dieser Stelle
        // `badge: 1` — hart, absolut, ohne Gegenstück. APNs setzt diesen
        // Wert, es zählt nichts hoch: der Server schrieb 1, und niemand
        // schrieb je 0 zurück. Die rote Eins blieb deshalb für immer am
        // App-Symbol kleben — Wegwischen, Neustart, Ausloggen half nichts,
        // weil der Wert Gerätezustand ist und nicht an den Einträgen in
        // der Mitteilungszentrale hängt. Eine 1★-Rezension (07.09.2026)
        // hat genau danach gefragt.
        //
        // Eine feste 1 hatte ohnehin keinen Informationswert. Kommt später
        // eine echte Zahl (etwa offene Bons), gehört sie hierher — dann
        // aber zusammen mit der Stelle, die sie wieder auf 0 setzt. Das
        // Zurücksetzen macht seit 86cbfdq5j der Client
        // (PushNotificationProvider, bei jedem Wechsel in den Vordergrund).
        aps: { sound: 'default' },
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

  // Send-Log (86cb22c0m) — admin-only Collection (kein Rules-Block nötig,
  // der Whitelist-deny-all deckt sie). Basis der Konversions-Auswertung.
  await admin
    .firestore()
    .doc(`push_log/${pushId}`)
    .set({
      pushId,
      uid,
      kind: 'cashback_ready',
      cashbackId: String(payload.cashbackId),
      deepLink,
      title: payload.title,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      tokens: tokens.length,
      success: response.successCount,
      failure: response.failureCount,
    })
    .catch((e) => logger.warn('[cashback.push] push_log write failed', { pushId, err: e.message }));

  logger.info('[cashback.push] sent', {
    uid,
    pushId,
    cashbackId: payload.cashbackId,
    tokens: tokens.length,
    success: response.successCount,
    failure: response.failureCount,
  });

  return { sent: response.successCount, failed: response.failureCount, pushId };
}

module.exports = { sendCashbackReady };
