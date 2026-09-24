'use strict';

/**
 * „Ka-ching!"-Nachricht, wenn Produktfoto-Einreichungen VERGÜTET wurden
 * (ClickUp 12487v2akvp, Texte: Entscheidung Patrick 24.09.2026).
 *
 * ═══ Wann diese Nachricht rausgeht — und wann ausdrücklich nicht ═══
 *
 * Nur bei einer echten Buchung (`credited > 0`). Eine ABLEHNUNG meldet sich
 * NICHT von selbst (Entscheidung Patrick, 20.09.2026): der Grund steht in der
 * Liste der Einreichungen (`app/product-submit/index.tsx`) und wird dort
 * gelesen, wenn der Nutzer von sich aus nachsieht.
 *
 * ═══ Warum gesammelt wird statt sofort gesendet ═══
 *
 * Die Prüfkonsole gibt Einreichungen stapelweise frei (bis 100 auf einmal).
 * Jede Freigabe löst diesen Trigger einzeln aus — ohne Sammeln bekäme jemand
 * mit zehn freigegebenen Einreichungen zehn Nachrichten in einer Minute. Das
 * treibt Leute zum Abbestellen, egal wie gut der Text ist. Deshalb:
 *   1. Der Trigger legt die Buchung nur in einen Sammler je Nutzer
 *      (`crowd_push_sammler/{uid}`: Summe, Anzahl, Zeitpunkt der letzten,
 *      und ob eine der Buchungen die Auszahlungsschwelle überschritten hat).
 *   2. Ein Zeitplan-Lauf je Minute verschickt jeden Sammler, bei dem seit
 *      RUHE_MS keine Freigabe mehr dazukam — als EINE Nachricht mit der Summe.
 * Not-Aus ohne Deploy: `cashback_config/v1.crowdPushAus = true` — der Lauf
 * verschickt dann nichts, die Sammler bleiben liegen und gehen nach dem
 * Zurückschalten gesammelt raus. Härtere Variante: den Scheduler-Job
 * `firebase-schedule-sendeGesammelteGutschriften-europe-west1` pausieren.
 * Das Geld berührt beides nicht.
 * Nebeneffekt, der gewollt ist: aus dreimal „+0,16 €" wird einmal „+0,48 €".
 * Preis: die Nachricht kommt ein bis zwei Minuten nach der Freigabe statt
 * sofort. Für eine Gutschrift ist das egal.
 *
 * `crowd_push_sammler` hat keinen Block in firestore.rules — der
 * abschließende deny-all hält Clients draußen, nur das Admin-SDK schreibt.
 *
 * ⚠ KOPIE von cloud-functions/cashback-pipeline/lib/push.js (Tokenlesung,
 * Abbestellung, Payload) und lib/pushTexte.js (Ka-ching-Texte). Die Codebases
 * teilen keinen Code. Bei Änderungen BEIDE nachziehen — gleiche Drift-Falle
 * wie `extractEans` und `targeting.js` (CLAUDE.md).
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

/** Sammlung der noch nicht verschickten Gutschriften, ein Dokument je Nutzer. */
const SAMMLER = 'crowd_push_sammler';

/** So lange muss es nach der letzten Freigabe eines Nutzers still sein. */
const RUHE_MS = 60 * 1000;

/** Auszahlungsschwelle, falls `cashback_config/v1` nicht lesbar ist. */
const SCHWELLE_STANDARD = 1000;

/** „16" → „0,16 €" — deutsche Schreibweise wie überall in der App (CLAUDE.md). */
function betragText(cents) {
  const zahl = Number(cents) || 0;
  return `${(zahl / 100).toFixed(2).replace('.', ',')} €`;
}

/**
 * Hat genau diese Gutschrift das Guthaben über die Auszahlungsschwelle
 * gehoben? Nur dann gibt es den Zahltag-Text — wer schon vorher darüber lag,
 * bekommt die normale Nachricht, sonst würde jede weitere Gutschrift erneut
 * „jetzt auszahlbar" feiern.
 *
 * Aufgerufen beim VORMERKEN, mit dem Guthaben vor und nach genau dieser
 * Buchung — beide Werte liefert die Buchungs-Transaktion als Rückgabe mit,
 * ohne dass sich an ihrem Schreibweg etwas ändert.
 */
function auszahlbarGeworden(guthabenNachher, cents, schwelle) {
  const nachher = Number(guthabenNachher);
  const betrag = Number(cents);
  const grenze = Number(schwelle);
  if (!Number.isFinite(nachher) || !Number.isFinite(betrag) || !(grenze > 0)) return false;
  const vorher = nachher - betrag;
  return vorher < grenze && nachher >= grenze;
}

/**
 * Titel und Text. Freigegeben von Patrick (24.09.2026) nach drei Runden:
 * das GELD gehört in die Überschrift, mit „Ka-ching" und Emoji — das ist, was
 * motiviert. Die Detektiv-Sprache kommt in die zweite Zeile.
 *
 * Ob es der Zahltag-Text wird, steht schon bei der BUCHUNG fest
 * (`schwelleUeberschritten`), nicht erst beim Senden: der Sammler wartet bis
 * zu zwei Minuten, und eine Bon-Gutschrift in diesem Fenster würde ein
 * Nachrechnen zum Sendezeitpunkt verfälschen — mal zwei Zahltage, mal keiner.
 * `guthabenNachher` ist nur noch der angezeigte Betrag.
 *
 * Bewusst NICHT behauptet: dass das Produkt „jetzt im Katalog" ist. Die
 * Freigabe bucht Geld, über die Aufnahme in den Katalog sagt sie nichts.
 */
function nachricht({ cents, guthabenNachher, schwelleUeberschritten }) {
  if (schwelleUeberschritten && Number.isFinite(Number(guthabenNachher))) {
    return {
      title: `Ka-ching! 🎉 ${betragText(guthabenNachher)} zum Auszahlen`,
      body: 'Deine Produktfotos sind freigegeben – dein Guthaben kannst du dir jetzt auszahlen lassen.',
    };
  }
  return {
    title: `Ka-ching! 💰 +${betragText(cents)} für dich`,
    body: 'Deine Produktfotos sind freigegeben. Starke Detektivarbeit!',
  };
}

/**
 * Token und Nutzerdaten EINES Nutzers — Token nur, wenn er Nachrichten will.
 *
 * Die Abbestellung wird HIER geprüft, nicht beim Aufrufer: das ist der
 * einzige Ort, an dem Empfänger entstehen. Beide Lesungen laufen parallel;
 * die Nutzer-Abfrage hat ihr eigenes catch, damit ein Firestore-Fehler nicht
 * wie eine Abbestellung wirkt. Die Nutzerdaten werden mit zurückgegeben,
 * weil der Text das aktuelle Guthaben braucht — ohne zweite Lesung.
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
      return { entries: [], nutzerDaten };
    }

    const entries = snap.docs
      .map((d) => ({ docId: d.id, token: String(d.get('token') || '') }))
      .filter((x) => x.token);
    return { entries, nutzerDaten };
  } catch (e) {
    logger.warn('[crowd-reward.push] Empfänger nicht lesbar', { uid, err: e.message });
    return { entries: [], nutzerDaten: null };
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
 * Legt eine Gutschrift in den Sammler des Nutzers. Aufgerufen vom Trigger,
 * direkt nach der Buchung. Wirft NIE — das Geld ist gebucht, eine misslungene
 * Vormerkung darf keine erneute Zustellung des Triggers auslösen.
 *
 * Genau einmal je Einreichung, ohne Sperre auf dem Sammler:
 *   1. Eine Transaktion NUR auf dem eigenen Upload-Dokument setzt den Merker
 *      `rewardPushSentAt`. Jede Einreichung hat ihr eigenes Dokument, es gibt
 *      also keine Konkurrenz; eine zweite Zustellung findet den Merker und
 *      zählt nicht doppelt — auch Tage später noch.
 *   2. Danach wird der Sammler BLIND erhöht (Inkrement ohne Lesen). Blinde
 *      Schreibvorgänge brechen nicht an Lesesperren ab — eine Transaktion auf
 *      dem gemeinsamen Sammler-Dokument hätte bei vielen gleichzeitigen
 *      Freigaben desselben Nutzers nach fünf Versuchen aufgegeben, und die
 *      Freigabe hätte in der Summe gefehlt.
 * Bricht der Lauf zwischen 1. und 2. ab, fehlt diese Gutschrift in der
 * Nachricht (das Geld nicht). Umgekehrt würde doppelt gezählt; die fehlende
 * ist der kleinere Schaden. Der Name `rewardPushSentAt` stammt aus der ersten
 * Fassung, die sofort sendete — er bleibt, damit schon markierte Dokumente
 * nicht noch einmal vorgemerkt werden.
 *
 * @param {object} p
 * @param {number} [p.guthabenVorher]   Guthaben vor dieser Buchung (Cent)
 * @param {number} [p.guthabenNachher]  Guthaben nach dieser Buchung (Cent)
 * @returns {Promise<boolean>} true, wenn vorgemerkt
 */
async function zurSammlungHinzufuegen({ uploadRef, uploadId, uid, cents, guthabenVorher, guthabenNachher }) {
  if (!(Number(cents) > 0) || !uid) return false;
  try {
    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;

    const beansprucht = await db.runTransaction(async (tx) => {
      const upload = await tx.get(uploadRef);
      if (upload.get('rewardPushSentAt')) return false;
      tx.set(uploadRef, { rewardPushSentAt: FieldValue.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!beansprucht) return false;

    const eintrag = {
      uid,
      cents: FieldValue.increment(Number(cents)),
      anzahl: FieldValue.increment(1),
      uploadIds: FieldValue.arrayUnion(String(uploadId)),
      letzteAt: FieldValue.serverTimestamp(),
    };
    // Nur setzen, nie zurücksetzen: hat EINE Buchung des Bündels die Schwelle
    // überschritten, ist es für die ganze Nachricht der Zahltag.
    const vorher = Number(guthabenVorher);
    const nachher = Number(guthabenNachher);
    if (Number.isFinite(vorher) && Number.isFinite(nachher)) {
      const schwelle = await schwelleLesen();
      if (auszahlbarGeworden(nachher, nachher - vorher, schwelle)) eintrag.schwelleUeberschritten = true;
    }
    await db.collection(SAMMLER).doc(uid).set(eintrag, { merge: true });
    return true;
  } catch (e) {
    logger.error('[crowd-reward.push] Vormerkung fehlgeschlagen — Buchung bleibt unberührt', {
      uploadId,
      uid,
      err: e.message,
    });
    return false;
  }
}

/** Auszahlungsschwelle aus der Konfiguration. */
async function schwelleLesen() {
  try {
    const snap = await admin.firestore().doc('cashback_config/v1').get();
    const wert = Number(snap.exists ? snap.get('payoutThresholdCents') : NaN);
    return Number.isFinite(wert) && wert > 0 ? wert : SCHWELLE_STANDARD;
  } catch (e) {
    logger.warn('[crowd-reward.push] Konfiguration nicht lesbar — Standardschwelle', { err: e.message });
    return SCHWELLE_STANDARD;
  }
}

/**
 * Not-Aus: `cashback_config/v1.crowdPushAus === true`. Ein Lesefehler zählt
 * NICHT als „aus" — sonst schaltete ein Firestore-Aussetzer die Nachrichten ab.
 */
async function versandAbgeschaltet() {
  try {
    const snap = await admin.firestore().doc('cashback_config/v1').get();
    return snap.exists && snap.get('crowdPushAus') === true;
  } catch (e) {
    logger.warn('[crowd-reward.push] Not-Aus nicht lesbar — Versand läuft', { err: e.message });
    return false;
  }
}

/**
 * Nimmt einen reifen Sammler an sich: liest und LÖSCHT ihn in einer
 * Transaktion, bevor gesendet wird. Kam seit der Abfrage eine weitere
 * Freigabe dazu, ist er nicht mehr reif — dann bleibt er liegen und wird im
 * nächsten Lauf mit der neuen Summe verschickt.
 *
 * Erst löschen, dann senden: stürzt der Lauf dazwischen ab, fehlt eine
 * Nachricht; umgekehrt bekäme jemand sie zweimal. Bei einer Gutschrift, die
 * im Guthaben ohnehin steht, ist die fehlende der kleinere Schaden.
 */
async function sammlerAbholen(ref, grenzeMs) {
  return admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const d = snap.data();
    const letzte = d.letzteAt && typeof d.letzteAt.toMillis === 'function' ? d.letzteAt.toMillis() : 0;
    if (letzte > grenzeMs) return null; // inzwischen neue Freigabe — nächster Lauf
    tx.delete(ref);
    return d;
  });
}

/** Schickt EINE Nachricht für die gesammelten Gutschriften eines Nutzers. */
async function sendeAnNutzer(uid, { cents, anzahl, uploadIds, schwelleUeberschritten }) {
  const { entries, nutzerDaten } = await getUserTokens(uid);
  if (!entries.length) {
    logger.info('[crowd-reward.push] keine Token / abbestellt', { uid, anzahl });
    return { sent: 0, skipped: 'keine_empfaenger' };
  }

  const tokens = entries.map((e) => e.token);
  // Eindeutige Push-ID fürs Konversions-Tracking: wandert in die data-Payload
  // (der Client protokolliert den Tap als users/{uid}/push_events/{pushId})
  // und ins Send-Log push_log/{pushId}.
  const pushId = `p_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  const guthabenNachher = nutzerDaten ? nutzerDaten.cashback_balance_cents : undefined;
  const { title, body } = nachricht({ cents, guthabenNachher, schwelleUeberschritten });

  const message = {
    notification: { title, body },
    data: {
      // Nur die Anzahl, nicht alle IDs: FCM begrenzt die Nutzlast auf 4 KB,
      // und bis zu 100 IDs würden das sprengen. Die vollständige Liste steht
      // im push_log.
      anzahl: String(anzahl),
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
    logger.error('[crowd-reward.push] Versand fehlgeschlagen', { uid, anzahl, err: e.message });
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
      crowdUploadIds: (uploadIds || []).map(String),
      anzahl: Number(anzahl),
      cents: Number(cents),
      deepLink: DEEP_LINK,
      title,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      tokens: tokens.length,
      success: response.successCount,
      failure: response.failureCount,
    })
    .catch((e) => logger.warn('[crowd-reward.push] push_log nicht geschrieben', { pushId, err: e.message }));

  logger.info('[crowd-reward.push] verschickt', {
    uid,
    pushId,
    cents,
    anzahl,
    tokens: tokens.length,
    success: response.successCount,
    failure: response.failureCount,
  });
  return { sent: response.successCount, failed: response.failureCount, pushId };
}

/**
 * Zeitplan-Lauf: verschickt alle Sammler, bei denen seit RUHE_MS nichts mehr
 * dazukam. Wirft nie; ein Fehler bei einem Nutzer hält die anderen nicht auf.
 *
 * Kosten: ein Lesevorgang je Lauf, wenn nichts ansteht (Firestore berechnet
 * auch eine leere Abfrage mit einem Read) — bei einem Lauf je Minute rund
 * 43.000 Reads im Monat, also wenige Cent.
 *
 * @param {object} [opts]
 * @param {number} [opts.jetztMs]  für Tests
 * @param {number} [opts.ruheMs]
 */
async function gesammelteSenden(opts = {}) {
  const jetztMs = Number.isFinite(opts.jetztMs) ? opts.jetztMs : Date.now();
  const ruheMs = Number.isFinite(opts.ruheMs) ? opts.ruheMs : RUHE_MS;
  const grenzeMs = jetztMs - ruheMs;
  const ergebnis = { reif: 0, gesendet: 0, fehler: 0 };

  let snap;
  try {
    snap = await admin
      .firestore()
      .collection(SAMMLER)
      .where('letzteAt', '<=', admin.firestore.Timestamp.fromMillis(grenzeMs))
      .limit(200)
      .get();
  } catch (e) {
    logger.error('[crowd-reward.push] Sammler nicht abfragbar', { err: e.message });
    return ergebnis;
  }
  if (snap.empty) return ergebnis;

  // Not-Aus erst prüfen, wenn es etwas zu tun gibt — das spart den Lesevorgang
  // in den vielen Läufen, in denen nichts ansteht.
  if (await versandAbgeschaltet()) {
    logger.warn('[crowd-reward.push] Not-Aus aktiv — nichts verschickt', { anstehend: snap.size });
    return { ...ergebnis, abgeschaltet: true };
  }

  // In kleinen Gruppen parallel: seriell passten 200 Nutzer nicht sicher in
  // das Zeitlimit, voll parallel wäre ein unnötiger Lastspitzen-Schub.
  const GRUPPE = 10;
  for (let i = 0; i < snap.docs.length; i += GRUPPE) {
    await Promise.all(
      snap.docs.slice(i, i + GRUPPE).map(async (doc) => {
        try {
          const d = await sammlerAbholen(doc.ref, grenzeMs);
          if (!d) return;
          ergebnis.reif += 1;
          const r = await sendeAnNutzer(d.uid || doc.id, d);
          if (r.sent > 0) ergebnis.gesendet += 1;
        } catch (e) {
          ergebnis.fehler += 1;
          logger.error('[crowd-reward.push] Sammler nicht verschickt', { uid: doc.id, err: e.message });
        }
      }),
    );
  }
  logger.info('[crowd-reward.push] Zeitplan-Lauf', ergebnis);
  return ergebnis;
}

module.exports = {
  zurSammlungHinzufuegen,
  gesammelteSenden,
  nachricht,
  betragText,
  auszahlbarGeworden,
  DEEP_LINK,
  ANDROID_KANAL,
  SAMMLER,
  RUHE_MS,
};
