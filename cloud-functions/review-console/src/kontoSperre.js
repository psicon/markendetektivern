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
 * Semantik (gleich für Runde und Konsole — und seit Prüfrunde 2, 02.10.2026,
 * auch gleich mit der Gutschrift-Seite, cashback-pipeline/lib/kontoSperre.js
 * `istGesperrt`):
 *  - kein Dokument, oder `gesperrt === false` → nicht gesperrt (aufgehoben),
 *  - jedes andere vorhandene Dokument → gesperrt (auch ohne Feld oder mit
 *    `gesperrt: 'ja'`): wer ein Sperr-Dokument anlegt, meint eine Sperre.
 *    Bis zur Prüfrunde 2 hieß ein unklarer Eintrag hier `unbekannt` (Fall
 *    wurde angesehen und konnte sichtbar abgelehnt werden), auf der
 *    Gutschrift-Seite „gesperrt" — dieselbe Eingabe mit zwei Bedeutungen.
 *  - Lesefehler → `unbekannt`.
 * `unbekannt` heißt: keine Freigabe (fail-closed für die Freigabe), aber auch
 * keine Ablehnung — ein Infrastrukturfehler ist nie ein Urteil über die
 * Einreichung. Der Fall bleibt liegen.
 */
const logger = require('firebase-functions/logger');

const SPERREN = 'cashback_sperren';

/**
 * Urteil aus einem gelesenen Dokument (`data()`); undefined/null = kein Dokument.
 * Liefert nie 'unbekannt' — das gibt es nur bei einem Lesefehler (kontoSperreVon,
 * bzw. der Aufrufer fängt den Fehler).
 * @returns {'gesperrt'|null}
 */
function sperreAusDaten(daten) {
  if (daten === undefined || daten === null) return null;
  if (typeof daten === 'object' && daten.gesperrt === false) return null;
  return 'gesperrt';
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
