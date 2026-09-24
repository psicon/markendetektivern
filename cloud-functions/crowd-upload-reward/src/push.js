'use strict';

/**
 * Push, wenn eine Produktfoto-Einreichung VERGÜTET wurde (ClickUp 12487v2akvp).
 *
 * ═══ Wann diese Nachricht rausgeht — und wann ausdrücklich nicht ═══
 *
 * Nur bei einer echten Buchung (`credited > 0`). Eine ABLEHNUNG meldet sich
 * NICHT von selbst (Entscheidung Patrick, 20.09.2026): der Grund steht in der
 * Liste der Einreichungen (`app/product-submit/index.tsx`, Texte in
 * `lib/utils/productSubmissionCopy.ts`) und wird dort gelesen, wenn der
 * Nutzer von sich aus nachsieht. Eine Push-Nachricht über eine Absage holt
 * jemanden in die App, um ihm etwas Unerfreuliches zu zeigen — die
 * Gutschrift dagegen ist der Moment, der zum Weitermachen einlädt.
 *
 * ⚠ KOPIE von cloud-functions/cashback-pipeline/lib/push.js (sendCashbackReady).
 * Die Codebases teilen keinen Code. Bei Änderungen an Tokenlesung, Abbestellung
 * oder Payload BEIDE nachziehen — gleiche Drift-Falle wie `extractEans` und
 * `targeting.js` (CLAUDE.md).
 *
 * Unterschiede zum Original, jeder mit Grund:
 *  - `kind: 'crowd_reward'` statt 'cashback_ready' (Konversions-Auswertung trennbar)
 *  - Deep-Link auf `/product-submit` statt `cashback/pending/…`
 *  - `crowdUploadId` statt `cashbackId` in data + push_log
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const { logger } = require('firebase-functions');
const { pushErlaubt } = require('./pushPolicy');
const { EINREICHUNGEN_LINK } = require('./pushLinks');

/**
 * Ziel des Taps: die Liste der eigenen Einreichungen. Der Pfad liegt in
 * `pushLinks.js`, weil der Vertragstest der App ihn dort ohne firebase-admin
 * laden kann — siehe die Begründung in jener Datei.
 */
const DEEP_LINK = EINREICHUNGEN_LINK;

/**
 * Android-Kanal. MUSS `cashback` sein: die App legt genau zwei Kanäle an
 * (`default` und `cashback`, pushNotificationService.androidKanaeleAnlegen).
 * Ein Kanal, den das Gerät nicht kennt, führt auf Android 8+ dazu, dass die
 * Nachricht gar nicht erscheint — ein eigener Name wäre also kein Feinschliff,
 * sondern ein stiller Totalausfall.
 */
const ANDROID_KANAL = 'cashback';

/** „15" → „0,15 €" — deutsche Schreibweise wie überall in der App (CLAUDE.md). */
function betragText(cents) {
  const zahl = Number(cents) || 0;
  return `${(zahl / 100).toFixed(2).replace('.', ',')} €`;
}

/**
 * Titel und Text. Positiver Ton, Betrag ausdrücklich genannt (CLAUDE.md:
 * „nie Frustration hervorrufen").
 *
 * Bewusst NICHT behauptet: dass das Produkt „jetzt im Katalog" ist. Die
 * Freigabe bucht Geld, sie sagt nichts über die Aufnahme in den Katalog —
 * ein Versprechen, das der Vorgang nicht einlöst, gehört nicht in die
 * Nachricht.
 */
function nachricht(cents) {
  return {
    title: `${betragText(cents)} sind da`,
    body: 'Deine Produkt-Einreichung ist freigegeben — der Betrag liegt in deinem Guthaben.',
  };
}

/**
 * Token EINES Nutzers — und nur, wenn er Nachrichten überhaupt will.
 *
 * Die Abbestellung wird HIER geprüft, nicht beim Aufrufer: das ist der
 * einzige Ort, an dem Empfänger entstehen. Beide Lesungen laufen parallel;
 * die Nutzer-Abfrage hat ihr eigenes catch, damit ein Firestore-Fehler nicht
 * wie eine Abbestellung wirkt.
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
          logger.warn('[crowd-reward.push] Nutzerdokument nicht lesbar — wird gesendet', {
            uid,
            err: e.message,
          });
          return null;
        }),
      admin.firestore().collection(`users/${uid}/fcmTokens`).get(),
    ]);

    const urteil = pushErlaubt(nutzerDaten);
    if (!urteil.erlaubt) {
      logger.info('[crowd-reward.push] abbestellt — kein Versand', { uid, grund: urteil.grund });
      return [];
    }

    return snap.docs
      .map((d) => ({ docId: d.id, token: String(d.get('token') || '') }))
      .filter((x) => x.token);
  } catch (e) {
    logger.warn('[crowd-reward.push] getUserTokens fehlgeschlagen', { uid, err: e.message });
    return [];
  }
}

const UNGUELTIGE_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'messaging/mismatched-credential',
]);

async function ungueltigeTokenEntfernen(uid, entries, results) {
  const alt = [];
  results.forEach((r, idx) => {
    const code = r && r.error && r.error.code;
    if (!r.success && code && UNGUELTIGE_CODES.has(code)) alt.push(entries[idx]);
  });
  if (!alt.length) return;
  const batch = admin.firestore().batch();
  for (const s of alt) batch.delete(admin.firestore().doc(`users/${uid}/fcmTokens/${s.docId}`));
  await batch
    .commit()
    .catch((e) => logger.warn('[crowd-reward.push] Aufräumen fehlgeschlagen', { uid, err: e.message }));
  logger.info('[crowd-reward.push] ungültige Token entfernt', { uid, count: alt.length });
}

/**
 * Genau EIN Push je Einreichung — der Merker wird VOR dem Senden gesetzt.
 *
 * Firestore-Trigger sind at-least-once. Der Hauptschutz ist zwar schon der
 * Ledger-Check ganz oben in index.js (eine Redelivery steigt dort aus, bevor
 * sie hier ankommt), aber zwei Zustellungen können sich überlappen, bevor der
 * erste Lauf sein Ledger-Dokument geschrieben hat.
 *
 * Die Reihenfolge ist Absicht: erst beanspruchen, dann senden. Stürzt der Lauf
 * dazwischen ab, fehlt eine Nachricht — schickt man umgekehrt zuerst, bekommt
 * jemand sie zweimal. Bei einer Gutschrift, die im Guthaben ohnehin sichtbar
 * ist, ist die fehlende Nachricht der kleinere Schaden. Aus demselben Grund
 * gilt ein Transaktionsfehler als „nicht beanspruchen" (kein Versand).
 */
async function pushBeanspruchen(uploadRef) {
  try {
    return await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(uploadRef);
      if (snap.get('rewardPushSentAt')) return false;
      tx.set(
        uploadRef,
        { rewardPushSentAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
      return true;
    });
  } catch (e) {
    logger.warn('[crowd-reward.push] Merker nicht setzbar — kein Versand', {
      err: e.message,
    });
    return false;
  }
}

/**
 * Verschickt die Gutschrift-Nachricht. Wirft NIE — das Geld ist zu diesem
 * Zeitpunkt längst gebucht, ein Fehler beim Benachrichtigen darf den Trigger
 * nicht in eine erneute Zustellung schicken.
 *
 * @param {object} opts
 * @param {FirebaseFirestore.DocumentReference} opts.uploadRef
 * @param {string} opts.uploadId
 * @param {string} opts.uid
 * @param {number} opts.cents  gebuchter Betrag, > 0
 */
async function sendeVerguetungPush({ uploadRef, uploadId, uid, cents }) {
  try {
    if (!(Number(cents) > 0)) return { sent: 0, skipped: 'nichts_gebucht' };

    const entries = await getUserTokens(uid);
    if (!entries.length) {
      logger.info('[crowd-reward.push] keine Token / abbestellt', { uid, uploadId });
      return { sent: 0, skipped: 'keine_empfaenger' };
    }

    if (!(await pushBeanspruchen(uploadRef))) {
      logger.info('[crowd-reward.push] bereits verschickt — kein zweiter Versand', { uploadId, uid });
      return { sent: 0, skipped: 'schon_verschickt' };
    }

    const tokens = entries.map((e) => e.token);
    // Eindeutige Push-ID fürs Konversions-Tracking: wandert in die data-Payload
    // (der Client protokolliert den Tap als users/{uid}/push_events/{pushId})
    // und ins Send-Log push_log/{pushId}.
    const pushId = `p_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const { title, body } = nachricht(cents);

    const message = {
      notification: { title, body },
      data: {
        crowdUploadId: String(uploadId),
        deepLink: DEEP_LINK,
        kind: 'crowd_reward',
        pushId,
      },
      apns: {
        // KEIN `badge`. Ein hart gesetztes `badge: 1` hat am 07.09.2026 eine
        // 1★-Rezension gekostet: APNs SETZT diesen Wert, es zählt nichts hoch,
        // und niemand schrieb je 0 zurück — die rote Eins blieb für immer am
        // App-Symbol. Siehe denselben Kommentar im Original.
        payload: { aps: { sound: 'default' } },
      },
      android: {
        priority: 'high',
        notification: { channelId: ANDROID_KANAL, sound: 'default' },
      },
    };

    let response;
    try {
      response = await admin.messaging().sendEachForMulticast({ tokens, ...message });
    } catch (e) {
      logger.error('[crowd-reward.push] Versand fehlgeschlagen', { uid, uploadId, err: e.message });
      return { sent: 0, error: e.message };
    }

    await ungueltigeTokenEntfernen(uid, entries, response.responses);

    await admin
      .firestore()
      .doc(`push_log/${pushId}`)
      .set({
        pushId,
        uid,
        kind: 'crowd_reward',
        crowdUploadId: String(uploadId),
        deepLink: DEEP_LINK,
        title,
        cents: Number(cents),
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        tokens: tokens.length,
        success: response.successCount,
        failure: response.failureCount,
      })
      .catch((e) =>
        logger.warn('[crowd-reward.push] push_log nicht geschrieben', { pushId, err: e.message }),
      );

    logger.info('[crowd-reward.push] verschickt', {
      uid,
      uploadId,
      pushId,
      cents,
      tokens: tokens.length,
      success: response.successCount,
      failure: response.failureCount,
    });

    return { sent: response.successCount, failed: response.failureCount, pushId };
  } catch (e) {
    logger.error('[crowd-reward.push] unerwarteter Fehler — Buchung bleibt unberührt', {
      uploadId,
      uid,
      err: e.message,
    });
    return { sent: 0, error: e.message };
  }
}

module.exports = { sendeVerguetungPush, betragText, nachricht, DEEP_LINK, ANDROID_KANAL };
