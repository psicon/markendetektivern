'use strict';
/**
 * Produktsuche im Tagesbericht — eine Zeile aus den Tageszählern der
 * Hintergrundsuche für unbekannte Barcodes (external-misses-processor →
 * nutrition-scraper scrapeEan).
 *
 * WARUM IM BERICHT (CLAUDE.md, Vorfall 18.08.–01.10.2026): Die Suche lief sechs
 * Wochen mit leerem KI-Guthaben, meldete „nichts gefunden" und schloss 5.301
 * Barcodes dauerhaft als 'no-data' ab, während Serper und Apify weiter bezahlt
 * wurden. Gefunden hat es nur das Funktionsinventar. Serper ist Prepaid — läuft
 * das Guthaben leer, hält die Suche an (serperMindestGuthaben), und auch das
 * soll jemand am selben Morgen sehen.
 *
 * QUELLEN (beide schreibt NUR der Server bzw. Patrick in der Console;
 * Firestore-Regeln: finale deny-all, kein Client-Zugriff):
 *   _meta/produktsuche_tage/tage/{YYYY-MM-DD}  Tageszähler je Kalendertag
 *     (Europe/Berlin), geschrieben vom Prozessor per increment:
 *     { bearbeitet, gefunden, keineDaten, fehler, uebersprungen, serperRest,
 *       angehalten, kostenSchaetzungUsd, kandidatenKnapp }
 *     kandidatenKnapp: Läufe, die oben in der Reihenfolge nur nach einem
 *     Fehler wartende Fälle fanden (Prüfrunde 3, external-misses-processor
 *     src/lauf.js holeKandidaten) — die Suche bezahlte dann nichts, obwohl
 *     Barcodes offen waren.
 *   _meta/produktsuche                        Schalter und Grenzen
 * Pfade, Feldnamen und Standardwerte stehen in
 * cloud-functions/external-misses-processor/src/konfig.js. Die Codebases teilen
 * keinen Code — ändert sich dort etwas, hier nachziehen (wie bei targeting.js).
 *
 * Der Bericht läuft um 08:00; gezeigt wird deshalb der VORTAG (voller Tag),
 * Guthaben und Anhalte-Grund aber vom neuesten Stand (heute, falls schon ein
 * Lauf war). Ein Lesefehler kostet den Bericht nicht: `unlesbar: true`.
 */

const TAGE_SAMMLUNG = '_meta/produktsuche_tage/tage';
const KONFIG_PFAD = '_meta/produktsuche';
const MISSES = 'external_lookup_misses';
const TAG_MS = 24 * 60 * 60 * 1000;

// Kopie der Standardwerte, Obergrenzen und Halte-Werte aus
// external-misses-processor/src/konfig.js (nur die Felder, die der Bericht braucht).
const STANDARD = Object.freeze({ aktiv: true, proLauf: 1, tagesDeckel: 120, serperMindestGuthaben: 1000 });
const GRENZEN = Object.freeze({ proLauf: 20, tagesDeckel: 5000, serperMindestGuthaben: 1_000_000 });
const BEI_UNGUELTIG = Object.freeze({ proLauf: 0, tagesDeckel: 0, serperMindestGuthaben: GRENZEN.serperMindestGuthaben });

/** Ab diesem Vielfachen der Mindestgrenze warnt der Bericht vorab. Mit den
 *  Standardwerten: unter 3.000 Suchen — bei ~120 Suchen am Tag gut zwei
 *  Wochen, bevor die Suche anhält. Genug Zeit zum Nachkaufen. */
const SERPER_KNAPP_FAKTOR = 3;

const berlinTag = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const zahl = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const zahlOderNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const deutsch = (n) => Number(n).toLocaleString('de-DE');

/** Lesbare Texte für den Anhalte-Grund des Prozessors (`angehalten` am
 *  Tageszähler, geschrieben von external-misses-processor/src/lauf.js).
 *  Unbekannte Codes erscheinen als Code. */
const ANGEHALTEN_TEXT = {
  serper_guthaben: 'Serper-Guthaben unter der Mindestgrenze',
  serper_guthaben_unbekannt: 'Serper-Guthaben nicht abrufbar',
  tagesdeckel: 'Tagesdeckel erreicht',
  aus: 'Schalter aus',
  // Zwei dienstweite Fehler in Folge (KI, Suche, Schlüssel, Ausrollen) —
  // der Prozessor pausiert mit wachsender Pause (external-misses-processor
  // src/regeln.js pauseNachDienstAusfall).
  dienst_ausfall: 'Dienst ausgefallen (KI, Suche oder Schlüssel), Pause',
  // Ungültiger Wert in _meta/produktsuche an einer Geld-Grenze (Prüfrunde 2):
  // der Prozessor hält an, statt still mit dem höheren Standard zu bezahlen.
  konfig_ungueltig: 'ungültiger Wert in _meta/produktsuche',
};
/** Halte-Gründe, die gewollt sind und keine Warnung wert: der Tagesdeckel ist
 *  bei großem Rückstand Normalbetrieb, „aus" hat jemand bewusst gesetzt. */
const HALT_OHNE_WARNUNG = new Set(['tagesdeckel', 'aus']);

/**
 * Schalter wie im Prozessor (konfig.normalisiereKonfig): `aktiv` hält an,
 * sobald das Feld gesetzt und nicht `true` ist; Zahlen als Zahl oder reine
 * Ziffern im Text (die Console legt Felder als Text an), nicht-negativ und
 * ganz, über der Obergrenze gekappt. Ein ungültiger Wert hält an (Halte-Wert)
 * und steht in `ungueltig` — der Bericht meldet das rot, ohne auf den
 * nächsten Lauf des Prozessors zu warten.
 */
function konfigAus(roh) {
  const d = roh && typeof roh === 'object' ? roh : {};
  const ungueltig = [];
  const ganz = (feld) => {
    const eintrag = d[feld];
    if (eintrag === undefined) return STANDARD[feld];
    const v = typeof eintrag === 'string' && /^\s*\d+\s*$/.test(eintrag) ? Number(eintrag.trim()) : eintrag;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return Math.min(v, GRENZEN[feld]);
    ungueltig.push(feld);
    return BEI_UNGUELTIG[feld];
  };
  if (d.aktiv !== undefined && typeof d.aktiv !== 'boolean') ungueltig.push('aktiv');
  return {
    aktiv: d.aktiv === undefined ? STANDARD.aktiv : d.aktiv === true,
    proLauf: ganz('proLauf'),
    tagesDeckel: ganz('tagesDeckel'),
    serperMindestGuthaben: ganz('serperMindestGuthaben'),
    ungueltig,
  };
}

/** Zahlen eines Tageszählers; null, wenn es für den Tag keinen gibt. */
function tagesZahlen(roh) {
  if (!roh || typeof roh !== 'object') return null;
  return {
    bearbeitet: zahl(roh.bearbeitet),
    gefunden: zahl(roh.gefunden),
    keineDaten: zahl(roh.keineDaten),
    fehler: zahl(roh.fehler),
    uebersprungen: zahl(roh.uebersprungen),
    serperRest: zahlOderNull(roh.serperRest),
    angehalten: typeof roh.angehalten === 'string' && roh.angehalten ? roh.angehalten : null,
    kostenSchaetzungUsd: zahlOderNull(roh.kostenSchaetzungUsd),
    kandidatenKnapp: zahl(roh.kandidatenKnapp),
  };
}

/** Suchen, für die bezahlt wurde und die ein Ergebnis hatten (Treffer, nichts
 *  gefunden, Fremddienst-Fehler). Übersprungene kosten nichts. */
const bezahltVon = (z) => (z ? z.gefunden + z.keineDaten + z.fehler : 0);

/**
 * Die Zeile für Bericht, Dashboard und Morgen-Chat.
 * @returns {string}
 */
function zeileVon({ gestern, konfig, serperRest, angehalten }) {
  const teile = [];
  if (!konfig.aktiv) teile.push('ausgeschaltet');
  if (gestern) {
    teile.push(`${deutsch(gestern.bearbeitet)} bearbeitet, ${deutsch(gestern.gefunden)} gefunden, ${deutsch(gestern.keineDaten)} ohne Daten, ${deutsch(gestern.uebersprungen)} übersprungen, ${deutsch(gestern.fehler)} Fehler`);
    if (gestern.kostenSchaetzungUsd != null) teile.push(`≈ ${gestern.kostenSchaetzungUsd.toFixed(2).replace('.', ',')} $`);
  } else teile.push('keine Zahlen (nicht gelaufen)');
  if (serperRest != null) teile.push(`Serper-Rest ${deutsch(serperRest)}`);
  if (angehalten) teile.push(`angehalten: ${ANGEHALTEN_TEXT[angehalten] || angehalten}`);
  return `Produktsuche gestern: ${teile.join(' · ')}`;
}

/**
 * Reine Zusammenfassung für `ops_tagesberichte.produktsuche`.
 * @param {object} e
 * @param {number} e.jetzt
 * @param {object|null} e.gesternRoh   Tageszähler des Vortags (oder null)
 * @param {object|null} e.heuteRoh     Tageszähler von heute bis zum Bericht (oder null)
 * @param {object|null} e.konfigRoh    _meta/produktsuche (oder null)
 * @param {number|null} e.wartend      offene Barcodes (status 'pending'), null = nicht gezählt
 */
function produktsucheLage({ jetzt, gesternRoh, heuteRoh, konfigRoh, wartend = null }) {
  const konfig = konfigAus(konfigRoh);
  const gestern = tagesZahlen(gesternRoh);
  const heute = tagesZahlen(heuteRoh);
  // Neuester Stand: der heutige Zähler, sobald heute ein Lauf war. Ein Lauf
  // ohne Kontoabfrage (serperRest fehlt) erbt das Guthaben vom Vortag.
  const serperRest = heute?.serperRest ?? gestern?.serperRest ?? null;
  // Ein ungültiger Wert in der Konfiguration hält jetzt an — unabhängig davon,
  // ob der Prozessor seit der Änderung schon gelaufen ist.
  const angehalten = konfig.ungueltig.length > 0
    ? 'konfig_ungueltig'
    : heute ? heute.angehalten : gestern?.angehalten ?? null;
  const lage = {
    tag: berlinTag(jetzt - TAG_MS),
    gestern,
    heute,
    serperRest,
    angehalten,
    aktiv: konfig.aktiv,
    pausiert: konfig.proLauf === 0 || konfig.tagesDeckel === 0,
    tagesDeckel: konfig.tagesDeckel,
    serperMindestGuthaben: konfig.serperMindestGuthaben,
    ungueltigeFelder: konfig.ungueltig,
    wartend: zahlOderNull(wartend),
    unlesbar: false,
  };
  // Klartext für Dashboard und Morgen-Chat; der Tagesdeckel ist Normalbetrieb.
  lage.zustand = angehalten === 'konfig_ungueltig' ? `angehalten: ${ANGEHALTEN_TEXT.konfig_ungueltig} (${konfig.ungueltig.join(', ')})`
    : !konfig.aktiv ? 'ausgeschaltet'
      : angehalten && !HALT_OHNE_WARNUNG.has(angehalten) ? `angehalten: ${ANGEHALTEN_TEXT[angehalten] || angehalten}`
        : lage.pausiert ? 'pausiert (proLauf oder tagesDeckel 0)' : 'läuft';
  lage.zeile = zeileVon({ gestern, konfig, serperRest, angehalten });
  return lage;
}

/**
 * Liest Tageszähler (gestern, heute), Schalter und die Zahl wartender
 * Barcodes. Wirft nie — ein Lesefehler wird `{ unlesbar: true }`.
 * Kosten: 3 Dokument-Lesevorgänge + eine count()-Abfrage (1 Lesevorgang je
 * angefangene 1.000 Indexeinträge, bei ~19.000 offenen also ~19).
 */
async function ladeProduktsuche(db, jetzt, logger = null) {
  try {
    const [gestern, heute, konfig, wartend] = await Promise.all([
      db.doc(`${TAGE_SAMMLUNG}/${berlinTag(jetzt - TAG_MS)}`).get(),
      db.doc(`${TAGE_SAMMLUNG}/${berlinTag(jetzt)}`).get(),
      db.doc(KONFIG_PFAD).get(),
      db.collection(MISSES).where('status', '==', 'pending').count().get(),
    ]);
    return produktsucheLage({
      jetzt,
      gesternRoh: gestern.exists ? gestern.data() : null,
      heuteRoh: heute.exists ? heute.data() : null,
      konfigRoh: konfig.exists ? konfig.data() : null,
      wartend: wartend.data().count,
    });
  } catch (e) {
    if (logger) logger.warn('Produktsuche-Zahlen nicht lesbar', { fehler: String(e && e.message).slice(0, 160) });
    return { unlesbar: true, zeile: 'Produktsuche: Zahlen nicht lesbar' };
  }
}

module.exports = {
  produktsucheLage, ladeProduktsuche, konfigAus, tagesZahlen, bezahltVon,
  ANGEHALTEN_TEXT, HALT_OHNE_WARNUNG, SERPER_KNAPP_FAKTOR, TAGE_SAMMLUNG, KONFIG_PFAD,
};
