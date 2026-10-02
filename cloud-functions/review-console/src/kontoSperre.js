'use strict';
/**
 * Gesperrte Konten (Entscheidung Patrick 02.10.2026: „Ja, dann sperr die Konten").
 *
 * Anlass: zwei Konten mit Fotos von zu Hause, einem Produkt für alle Märkte und
 * falschen EANs (vermutlich eine Person). Ab der Sperre gibt es für sie keine
 * neuen Gutschriften und keine Auszahlung; offene Produktfotos geben weder die
 * Morgenrunde noch die Prüfkonsole frei. Die Morgenrunde lässt sie STUMM
 * liegen (keine Ablehnung — die wäre endgültig und für den Nutzer sichtbar,
 * siehe fotoRundeRegeln.entscheideFall). Bereits Gebuchtes wird NICHT
 * zurückgebucht.
 *
 * Quelle der Wahrheit ist `cashback_sperren/{uid}` = { gesperrt: true, seit,
 * grund, quelle } — server-only: kein Rules-Block, die abschließende
 * deny-all-Regel in firestore.rules sperrt Clients aus. Geschrieben wird es
 * per Admin-SDK; die Gutschrift-/Auszahlungsseite liest dieselbe Collection.
 *
 * Semantik (gleich für Runde und Konsole):
 *  - kein Dokument, oder `gesperrt === false` → nicht gesperrt (aufgehoben),
 *  - `gesperrt === true` → gesperrt,
 *  - jeder andere Inhalt → `unbekannt`,
 *  - Lesefehler → `unbekannt`.
 * `unbekannt` heißt: keine Freigabe (fail-closed für die Freigabe), aber auch
 * keine Ablehnung — ein Infrastrukturfehler oder ein unklarer Eintrag ist nie
 * ein Urteil über die Einreichung. Der Fall bleibt liegen.
 */
const logger = require('firebase-functions/logger');

const SPERREN = 'cashback_sperren';

/** @returns {'gesperrt'|'unbekannt'|null} */
function sperreAusDaten(daten) {
  if (daten === undefined || daten === null) return null;
  if (daten.gesperrt === true) return 'gesperrt';
  if (daten.gesperrt === false) return null;
  return 'unbekannt';
}

/**
 * @param {Map<string, object>|null} sperren  aus ladeSperren; null = Lesen gescheitert
 * @param {string|null} uid
 * @returns {'gesperrt'|'unbekannt'|null}
 */
function kontoSperreVon(sperren, uid) {
  if (sperren == null) return 'unbekannt';
  if (!uid) return null;
  return sperreAusDaten(sperren.get(uid));
}

/**
 * Alle Einträge auf einmal (die Collection ist klein). Gibt `null` zurück,
 * wenn das Lesen scheitert — der Aufrufer behandelt dann jedes Konto als
 * `unbekannt`.
 * @returns {Promise<Map<string, object>|null>}
 */
async function ladeSperren(db) {
  try {
    const snap = await db.collection(SPERREN).get();
    return new Map(snap.docs.map((d) => [d.id, d.data() || {}]));
  } catch (e) {
    logger.warn('cashback_sperren nicht lesbar — keine Freigaben ohne Sperr-Prüfung', { fehler: String(e && e.message).slice(0, 160) });
    return null;
  }
}

module.exports = { SPERREN, sperreAusDaten, kontoSperreVon, ladeSperren };
