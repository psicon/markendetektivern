/**
 * Konfiguration der Produktsuche: _meta/produktsuche (nur Server schreibt;
 * finale deny-all-Regel in firestore.rules).
 *
 * Standardwerte stehen im Code und gelten, wenn das Dokument oder ein Feld
 * fehlt oder ungültig ist (Vertrag Teil 4). Diese Codebase liest davon:
 *   • auffrischenNachTagen — Frist für „älter als 2 Monate" (Patrick 04.10.)
 *   • shopBilder           — Bilder von Shopseiten anzeigen? Patrick 04.10.:
 *                            „ja“ → im Konfig-Dokument true; der Standard im
 *                            Code bleibt false (fehlt das Dokument, nichts
 *                            Unerwartetes).
 *                            AUSSCHALTEN wirkt beim nächsten Schreiben jedes
 *                            Dokuments (lib/speichern.js entfernt Bilder mit
 *                            bildVonShop); vollständig erst nach einem Lauf
 *                            von scripts/shopbilder-entfernen.js.
 * Die übrigen Felder steuert der external-misses-processor; sie stehen hier,
 * damit beide Codebases dieselben Standardwerte kennen. Bei Änderungen die
 * Kopie dort nachziehen (Codebases teilen keinen Code).
 *
 * Lesefehler ≠ fehlendes Dokument (Schlussprüfung 04.10.2026): Ist das
 * Dokument nicht lesbar, sind die beiden Felder, nach denen diese Codebase
 * Daten ÄNDERT, unbekannt (null) — nicht der Standard:
 *   • shopBilder null → kein neues Shopbild übernehmen, aber auch keins
 *     entfernen (der Standard false hätte bei jedem Schreiben in dieser
 *     Anfrage gespeicherte Shopbilder gelöscht und Dokumente, die nur über
 *     ihr Bild anzeigbar sind, ganz).
 *   • auffrischenNachTagen null → nichts wegen seines ALTERS neu öffnen oder
 *     auffrischen (der Standard 60 hätte bei einer bewusst längeren Frist
 *     abgeschlossene Fälle in die bezahlte Suche geschickt); lib/abrufPlan.js
 *     handelt dann nur, wo das Ergebnis von der Frist nicht abhängt.
 * Ein Infrastrukturfehler ist keine Aussage über Daten (CLAUDE.md).
 */

'use strict';

const STANDARD = Object.freeze({
  aktiv: true,
  proLauf: 1,
  tagesDeckel: 120,
  auffrischenNachTagen: 60,
  serperMindestGuthaben: 1000,
  shopBilder: false,
});

// Dieselben Grenzen wie external-misses-processor/src/konfig.js (GRENZEN):
// dasselbe Dokument muss in beiden Codebases dasselbe bedeuten.
const GRENZEN = Object.freeze({
  proLauf: 20,
  tagesDeckel: 5000,
  auffrischenNachTagen: 3650,
  serperMindestGuthaben: 1_000_000,
});
const MINIMUM = Object.freeze({ proLauf: 0, tagesDeckel: 0, auffrischenNachTagen: 1, serperMindestGuthaben: 0 });
// Wert bei einem ungültigen Eintrag — wie BEI_UNGUELTIG im Prozessor: die
// Geld-Grenzen halten an, auffrischenNachTagen fällt auf den Standard.
const BEI_UNGUELTIG = Object.freeze({
  proLauf: 0,
  tagesDeckel: 0,
  serperMindestGuthaben: GRENZEN.serperMindestGuthaben,
  auffrischenNachTagen: STANDARD.auffrischenNachTagen,
});

/**
 * Zahl oder reine Ziffern als Text (die Firebase-Console legt neue Felder als
 * Text an, Prüfrunde 2): ganze Zahl ≥ Minimum, über der Grenze gekappt;
 * fehlend → Standard, ungültig → BEI_UNGUELTIG.
 */
function ganzeZahl(feld, roh) {
  if (roh === undefined) return STANDARD[feld];
  const v = typeof roh === 'string' && /^\s*\d+\s*$/.test(roh) ? Number(roh.trim()) : roh;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < MINIMUM[feld]) return BEI_UNGUELTIG[feld];
  return Math.min(v, GRENZEN[feld]);
}

/**
 * Gespeicherte Werte prüfen und mit den Standardwerten auffüllen — dieselben
 * Regeln wie `normalisiereKonfig` im Prozessor (ohne Warnungen):
 *   • aktiv: gesetzt und nicht genau true → aus (ein bewusst angefasster
 *     Schalter darf durch einen Tippfehler kein Geld ausgeben)
 *   • Zahlen: ganze Zahlen (auch als Ziffern-Text) ≥ Minimum, über der Grenze
 *     gekappt; ungültig → Halte-Wert bei den Geld-Grenzen, Standard bei
 *     auffrischenNachTagen (0,5 hieße „jeder Scan öffnet neu" — Standard 60)
 *   • shopBilder: nur ein ausdrückliches true schaltet frei, nur false
 *     schaltet ab; ein ungültiger Wert gilt als unbekannt (null)
 */
function mitStandard(daten) {
  const d = daten && typeof daten === 'object' ? daten : {};
  return {
    aktiv: d.aktiv === undefined ? STANDARD.aktiv : d.aktiv === true,
    proLauf: ganzeZahl('proLauf', d.proLauf),
    tagesDeckel: ganzeZahl('tagesDeckel', d.tagesDeckel),
    auffrischenNachTagen: ganzeZahl('auffrischenNachTagen', d.auffrischenNachTagen),
    serperMindestGuthaben: ganzeZahl('serperMindestGuthaben', d.serperMindestGuthaben),
    // Ungültiger Wert (z. B. Text 'true') = unbekannt (null): nichts übernehmen,
    // nichts entfernen — ein Tippfehler darf keine Shopbilder löschen.
    shopBilder: typeof d.shopBilder === 'boolean' ? d.shopBilder
      : d.shopBilder === undefined ? STANDARD.shopBilder : null,
  };
}

/**
 * Shopbild-Schalter für den Schreibweg (lib/speichern.js, lib/rohablage.js):
 * true / false wie gelesen, sonst undefined (unbekannt — nichts übernehmen,
 * nichts entfernen). Nie `=== true` daraus machen: das wandelt „unbekannt"
 * in „aus" und löscht gespeicherte Shopbilder.
 */
function shopBildSchalter(konfig) {
  const v = konfig && konfig.shopBilder;
  return v === true || v === false ? v : undefined;
}

const CACHE_MS = 5 * 60 * 1000;
let zwischenspeicher = null; // { wert, bisMs }

/**
 * Wert nach einem Lesefehler: Standardwerte für das, was nur gelesen wird,
 * null (unbekannt) für shopBilder und auffrischenNachTagen (Kopfkommentar).
 */
function beiLesefehler() {
  return { ...mitStandard(null), shopBilder: null, auffrischenNachTagen: null };
}

/**
 * Liest _meta/produktsuche, je Instanz höchstens alle 5 Minuten. Ein
 * Lesefehler gibt beiLesefehler() zurück (die Abfrage soll dem Nutzer
 * trotzdem antworten, aber nichts auf eine Vermutung hin ändern) und wird
 * nicht zwischengespeichert.
 */
async function ladeKonfiguration(db, jetztMs, warnen) {
  if (zwischenspeicher && zwischenspeicher.bisMs > jetztMs) return zwischenspeicher.wert;
  try {
    const snap = await db.doc('_meta/produktsuche').get();
    const wert = mitStandard(snap.exists ? snap.data() : null);
    zwischenspeicher = { wert, bisMs: jetztMs + CACHE_MS };
    return wert;
  } catch (e) {
    if (typeof warnen === 'function') warnen(e);
    return beiLesefehler();
  }
}

/** Nur für Tests: Zwischenspeicher leeren. */
function _zuruecksetzen() {
  zwischenspeicher = null;
}

module.exports = { STANDARD, mitStandard, beiLesefehler, shopBildSchalter, ladeKonfiguration, _zuruecksetzen };
