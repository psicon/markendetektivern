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
 * ═══ Wer die Sperre liest (jede Verweigerung braucht einen LESER) ═══
 *
 *  - Bons: syncLedgerForReceipt (index.js) IN der Ledger-Transaktion. Keine
 *    neue Gutschrift → Status `no_reward`, Grund `konto_gesperrt`; der Bon
 *    bleibt gespeichert. Gilt für processCashback UND resolveCashbackReview
 *    (Prüfkonsole, Bon-Runde) — beide buchen nur über diese Funktion.
 *  - Auszahlung: requestPayout (in der Abbuchungs-Transaktion; 403
 *    `konto_gesperrt`, Lesefehler 503 `sperre_unpruefbar`) und processPayout
 *    (vor der Tremendous-Bestellung; Rückbuchung + `failed`).
 *  - Produktfotos: crowd-upload-reward, KOPIE dieser Datei
 *    (cloud-functions/crowd-upload-reward/src/kontoSperre.js).
 *  - Freigabe offener Produktfotos: Morgenrunde/Prüfkonsole (review-console).
 *  - Umfragen: survey-reward liest die Sperre NICHT. Dort liegt seit Juni ein
 *    nie ausgerollter Stand (7d8e91b); ein Deploy nur für die Sperre würde ihn
 *    ungeprüft mitnehmen. Schutz ist die Auszahlungssperre: gutgeschriebene
 *    Umfrage-Taler eines gesperrten Kontos lassen sich nicht auszahlen.
 *  - OFFEN: Gast-Übernahme Stufe 2 (Umbuchung Gast → Zielkonto) muss die
 *    Sperre BEIDER Konten prüfen, bevor sie gebaut wird.
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
