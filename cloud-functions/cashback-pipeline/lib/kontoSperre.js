'use strict';

/**
 * Kontosperre auf der Geld-Seite.
 *
 * Entscheidung Patrick 02.10.2026 („Ja, dann sperr die Konten"): Konten, die
 * mit erfundenen Einreichungen Geld holen (Fotos zu Hause, ein Produkt für
 * alle Märkte, falsche EANs), bekommen ab der Sperre KEINE neue Gutschrift und
 * KEINE Auszahlung mehr. Bereits Gebuchtes wird NICHT zurückgebucht, schon
 * Ausgezahltes nicht zurückgefordert („Nein, halb so wild").
 *
 * ═══ Datenmodell ═══
 *
 *   cashback_sperren/{uid} = { gesperrt: true, seit: Timestamp, grund: string, quelle: string }
 *
 * Server-only. firestore.rules hat für diese Sammlung KEINEN Block, es greift
 * das finale `match /{document=**} { allow read, write: if false }`; der
 * Rules-Test „Kontosperre" hält das fest. Bewusst NICHT unter users/{uid}/…:
 * dort dürfte der Nutzer über den Subcollection-Fallback mitlesen — und eine
 * Sperre, die der Betroffene sieht, lädt zum Ausweichen auf ein neues Konto ein.
 * Der Grund-Code `konto_gesperrt` steht zwar an eigenen, für den Nutzer
 * lesbaren Dokumenten (Bon-Spiegel, Einreichung, Auszahlung); die App zeigt
 * ihn aber nirgends an (Bon: „gespeichert", Auszahlung: „fehlgeschlagen —
 * zurückgebucht"). Grund und Quelle der Sperre bleiben server-only.
 *
 * ═══ Wann ist ein Konto gesperrt? ═══
 *
 * Ein vorhandenes Dokument sperrt, solange `gesperrt` nicht ausdrücklich
 * `false` ist. Aufheben heißt `gesperrt: false` setzen (die Historie bleibt
 * stehen) oder das Dokument löschen. Die Richtung ist Absicht: auf dem
 * Geldpfad soll ein vertipptes oder vergessenes Feld im Zweifel sperren statt
 * still durchzuwinken. Wer sperrt, schreibt trotzdem `gesperrt: true` — dann
 * sind sich alle Leser einig, auch solche, die nur auf `=== true` prüfen.
 *
 * Die Freigabe-Seite (review-console/src/kontoSperre.js, Zweig
 * claude/dubletten-woche) liest dreiwertig: kein Dokument / `false` → frei,
 * `true` → gesperrt, alles andere und Lesefehler → `unbekannt` (Fall bleibt
 * liegen, wird weder freigegeben noch abgelehnt). Für den unklaren Eintrag
 * heißt das hier „keine Gutschrift", dort „keine Freigabe" — beide Seiten
 * bewegen in diesem Fall kein Geld. Abgestimmt in der Prüfrunde 02.10.2026.
 *
 * ═══ Wer die Sperre liest (jede Verweigerung braucht einen LESER) ═══
 *
 *  - Bons: syncLedgerForReceipt (index.js) IN der Ledger-Transaktion. Keine
 *    neue Gutschrift → Status `no_reward`, Grund `konto_gesperrt`; der Bon
 *    bleibt gespeichert. Gilt für processCashback UND resolveCashbackReview
 *    (Prüfkonsole, Bon-Runde) — beide buchen nur über diese Funktion.
 *  - Auszahlung: requestPayout (in der Abbuchungs-Transaktion; 403
 *    `konto_gesperrt`, Lesefehler 503 `sperre_unpruefbar`) und processPayout
 *    (im Anspruch vor der Tremendous-Bestellung; Rückbuchung + `failed`).
 *  - Produktfotos: crowd-upload-reward, KOPIE dieser Datei
 *    (cloud-functions/crowd-upload-reward/src/kontoSperre.js).
 *  - Umfragen: survey-reward, KOPIE dieser Datei
 *    (cloud-functions/survey-reward/src/kontoSperre.js), in der Ledger-
 *    Transaktion. Der Deploy dafür nimmt 7d8e91b mit (Zeitfenster der Umfrage
 *    wird geprüft) — in der Prüfrunde 02.10.2026 gelesen: nur zusätzliche
 *    Gründe, NICHT zu zahlen, keiner, mehr zu zahlen.
 *  - Freigabe offener Produktfotos: Morgenrunde/Prüfkonsole (review-console,
 *    Teil A). Erst wenn auch dieser Leser live ist, die Sperre anlegen —
 *    sonst gibt die Morgenrunde Fotos frei, die nichts mehr bringen, und die
 *    App meldet „Vergütung liegt in deinem Guthaben". Das Skript
 *    `.konto-sperre-0210.js` prüft das am ausgerollten Code.
 *  - OFFEN: Gast-Übernahme Stufe 2 (Umbuchung Gast → Zielkonto) muss die
 *    Sperre BEIDER Konten prüfen, bevor sie gebaut wird.
 *  - Ops-Skripte, die direkt ins Ledger schreiben, umgehen die Sperre. Wer so
 *    ein Skript schreibt, liest sie selbst.
 *
 * Die Sperre gilt je uid. Ein neues Konto derselben Person ist nicht gesperrt.
 *
 * ═══ Lesefehler ═══
 *
 * Ein Fehler beim Lesen der Sperre ist keine Aussage über den Nutzer — er darf
 * aber auch keine Gutschrift und keine Auszahlung auslösen. Gelesen wird
 * deshalb, wo es geht, IN der Transaktion, die das Geld bewegt: scheitert der
 * Lesevorgang, scheitert die ganze Buchung und läuft in den Wiederholungsweg
 * des Aufrufers (nie in eine Ablehnung). Die Auszahlung bleibt bei einem
 * Lesefehler zu und meldet einen wiederholbaren Fehler.
 * Ausnahme Umfragen: survey-reward hat (seit jeher, für jeden Fehler in der
 * Ledger-Transaktion) keinen Wiederholungsweg — dort bleibt die Antwort
 * gespeichert, der Taler fällt bei einem Lesefehler aus.
 */

const SPERREN_SAMMLUNG = 'cashback_sperren';
/** Grund-Code am Bon / an der Einreichung / an der Auszahlung. */
const GRUND_KONTO_GESPERRT = 'konto_gesperrt';
/** Sperre nicht lesbar — nur auf dem Auszahlungsweg sichtbar (503 bzw. failed). */
const GRUND_SPERRE_UNPRUEFBAR = 'sperre_unpruefbar';

/** Dokument-Referenz der Sperre. Wirft ohne uid — ein leerer Schlüssel ist ein Programmierfehler. */
function sperreRef(db, uid) {
  if (typeof uid !== 'string' || uid.length === 0) {
    throw new Error('kontoSperre: uid fehlt');
  }
  return db.collection(SPERREN_SAMMLUNG).doc(uid);
}

/**
 * Urteil aus einem gelesenen Dokument (DocumentSnapshot oder Attrappe).
 * Fehlt das Dokument → nicht gesperrt. Vorhanden → gesperrt, außer
 * `gesperrt === false` (siehe oben).
 */
function istGesperrt(snap) {
  if (!snap || !snap.exists) return false;
  const daten = typeof snap.data === 'function' ? snap.data() : null;
  return !(daten && daten.gesperrt === false);
}

/**
 * Außerhalb einer Transaktion lesen. Wirft bei einem Lesefehler — der
 * Aufrufer entscheidet, wie er damit umgeht (siehe „Lesefehler").
 */
async function sperreLesen(db, uid) {
  return istGesperrt(await sperreRef(db, uid).get());
}

module.exports = {
  SPERREN_SAMMLUNG,
  GRUND_KONTO_GESPERRT,
  GRUND_SPERRE_UNPRUEFBAR,
  sperreRef,
  istGesperrt,
  sperreLesen,
};
