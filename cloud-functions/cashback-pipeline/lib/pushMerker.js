'use strict';

/**
 * Höchstens EINE „Ka-ching!"-Nachricht je Bon (Push-Prüfung 24.09.2026).
 *
 * Vorher hing die Frage „schon gemeldet?" an einem Wert, der VOR der Buchung
 * gelesen wurde (`alreadyCredited`) bzw. an `credited > 0` im Resolver. Zwei
 * gleichzeitige Läufe oder zwei gleichzeitige Freigaben sahen beide „noch
 * nicht gebucht" und schickten beide — eine Buchung, zwei Nachrichten. Und ein
 * Review-Bon mit schon bestehender Gutschrift bekam bei der Freigabe eine
 * Nachricht, obwohl nichts neu gebucht wurde.
 *
 * Jetzt: Der Aufrufer schickt nur, wenn SEINE Ledger-Transaktion frisch
 * gebucht hat (`frischGebucht`). Zusätzlich setzt diese Funktion in einer
 * Transaktion den Merker `gutschriftPushAt` am Bon — derselbe Mechanismus wie
 * `rewardPushSentAt` bei den Produktfotos. Wer ihn schon vorfindet, schickt
 * nicht. Das hält auch über Storno und erneute Gutschrift hinweg: wer für
 * diesen Bon schon „Ka-ching!" bekam, bekommt es kein zweites Mal.
 *
 * Merker zuerst, dann senden: bricht der Versand danach ab, fehlt eine
 * Nachricht; umgekehrt käme sie doppelt. Bei Geld, das ohnehin im Guthaben
 * steht, ist die fehlende der kleinere Schaden. Aus demselben Grund gilt ein
 * Fehler beim Setzen des Merkers als „nicht senden".
 *
 * `db` und `FieldValue` werden übergeben, damit die Funktion testbar ist.
 *
 * @returns {Promise<{darf: boolean, grund: 'frei'|'schon_gemeldet'|'kein_bon'|'fehler', fehler?: string}>}
 */
async function gutschriftPushBeanspruchen({ db, FieldValue, cashbackId, cents }) {
  if (!cashbackId) return { darf: false, grund: 'kein_bon' };
  const ref = db.collection('receipts').doc(String(cashbackId));
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { darf: false, grund: 'kein_bon' };
      if (snap.get('gutschriftPushAt')) return { darf: false, grund: 'schon_gemeldet' };
      tx.update(ref, {
        gutschriftPushAt: FieldValue.serverTimestamp(),
        gutschriftPushCents: Number(cents) || 0,
      });
      return { darf: true, grund: 'frei' };
    });
  } catch (e) {
    return { darf: false, grund: 'fehler', fehler: e.message };
  }
}

module.exports = { gutschriftPushBeanspruchen };
