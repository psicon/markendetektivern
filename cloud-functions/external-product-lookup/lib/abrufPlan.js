/**
 * Wann muss ein Barcode (neu) gesucht werden? — Entscheidung für
 * external_lookup_misses/{ean} (Produktsuche, 04.10.2026).
 *
 * ──────────────────────────────────────────────────────────────────────
 * WARUM
 * ──────────────────────────────────────────────────────────────────────
 * Patrick, 04.10.2026: „Wenn der Timestamp älter ist als 2 Monate, soll es
 * auch aktualisiert werden, wenn dieses Produkt wieder hochkommt."
 * Bis dahin setzte recordMiss den Status nur beim allerersten Anlegen.
 * Abgeschlossene Fälle (gefunden / keine Daten) öffnete nie wieder jemand —
 * 341 gefundene und 584 datenlose Fälle wurden danach erneut gescannt, ohne
 * dass etwas passierte. Außerdem zählten Scanner UND Detailseite denselben
 * Scan doppelt (9.758 Einträge mit hitCount 2 binnen einer Sekunde), und
 * wann zuletzt gescannt wurde, floss nicht in die Reihenfolge ein.
 *
 * ──────────────────────────────────────────────────────────────────────
 * REGELN (Schnittstellen-Vertrag Teil 3)
 * ──────────────────────────────────────────────────────────────────────
 * „Kommt wieder hoch" = jeder Aufruf von resolveExternalProduct.
 *   • kein Eintrag:   keine Daten → pending/neu; nur OpenFoodFacts →
 *                     pending/nur_openfood; Daten aus der bezahlten Suche
 *                     älter als die Frist → pending/auffrischen; sonst nichts.
 *   • pending:        bleibt; grund wird aus der aktuellen Lage nachgeführt
 *                     (außer 'auffrischen', das bleibt).
 *   • processing:     bleibt (nur Zähler).
 *   • abgeschlossen   (resolved/no-data/error/uebersprungen, außer
 *                     uebersprungenGrund im_katalog/ungueltige_ean):
 *                     letzter Versuch älter als die Frist UND gezeigt werden
 *                     keine REWE-Pipeline-Daten → pending/auffrischen.
 *                     REWE wird nicht bezahlt aufgefrischt (eigene Pipeline;
 *                     offene Frage an Patrick). Bezahlt GEFUNDENE Daten von
 *                     rewe.de (nutritionscrape) sind keine Pipeline-Daten und
 *                     werden normal aufgefrischt.
 *                     'error' nach Fehlern jeder Art in Folge (errorGrund
 *                     'in_folge' oder fehlend) öffnet schon nach
 *                     FEHLER_FRIST_TAGEN wieder (Prüfrunde 04.10.2026) — sonst
 *                     läge gerade der meistgescannte Barcode nach einem
 *                     längeren Ausfall zwei Monate still. 'error' AM BARCODE
 *                     (errorGrund 'am_barcode' oder 'abruf_gesperrt': jede
 *                     Shopseite dieses Barcodes gesperrt) erst nach der
 *                     normalen Frist (Prüfrunde 2): die Shops sperren
 *                     dauerhaft, jeder Wiederholungszyklus kostete Serper-
 *                     Suchen und Plätze im Tagesdeckel.
 *   • Fremder Altbestand erkannt (lage.altbestandAbgelehnt, Prüfrunde 2:
 *     die Abfrage hat ihn entfernt oder nicht übernommen): der frühere „Fund"
 *     gehörte zu einem anderen Produkt. Der Fall wird EINMAL sofort wieder
 *     geöffnet (Merker altbestandVerworfenAm; außer processing, manuell
 *     skipped und REWE-Daten), processedSource/processedResult gelöscht —
 *     sonst bliebe er bis zu zwei Monate 'resolved', und der Prozessor hielte
 *     die fremden Rohdaten für einen früheren Fund (nie 'no-data').
 *   • Doppelzählungs-Sperre: binnen 2 Minuten nach lastSeenAt werden weder
 *     hitCount noch scanTage erhöht.
 *   • rang = scanTage * 1e13 + lastSeenAt (ms) — höher = früher dran: wer an
 *     mehr verschiedenen Tagen gescannt wurde, zuerst; bei Gleichstand der
 *     zuletzt gescannte.
 *   • Konnte die Abfrage eine eigene Ablage nicht lesen (reweapify,
 *     nutritionscrape, scraped_products), ist „nichts gefunden" keine
 *     Aussage: lage.daten 'unbekannt' legt nichts an und ändert keinen
 *     Status, es wird nur gezählt. War NUR OpenFoodFacts nicht erreichbar,
 *     gilt 'keine' (Prüfrunde 2): der Prozessor sucht ohnehin ohne
 *     OpenFoodFacts, ein offener Eintrag ist keine negative Speicherung —
 *     und ohne ihn nähme die Suche während eines OFF-Ausfalls still keine
 *     neuen Barcodes an, obwohl die App „wir nehmen es auf" verspricht.
 *   • Frist unbekannt (auffrischenNachTagen null: _meta/produktsuche war
 *     nicht lesbar, lib/konfiguration.js): nichts wird wegen seines ALTERS
 *     geöffnet oder aufgefrischt — nur, was bei JEDER Frist gälte (neu,
 *     nur_openfood, fremder Altbestand, nie versucht, 'error' in Folge).
 *     Der Standard 60 hätte bei einer bewusst längeren Frist abgeschlossene
 *     Fälle in die bezahlte Suche geschickt (Schlussprüfung 04.10.2026).
 *
 * Rein: kein Firestore, keine Uhr. Zeitpunkte als Date hinaus, LOESCHEN
 * für zu entfernende Felder (die Schreibschicht macht FieldValue.delete()).
 */

'use strict';

const { LOESCHEN, istAnzeigbar, offWebseitenQuelle } = require('./speichern');
const { quellenGruppe } = require('./normalizers');
const { TAG_MS, zuMs, berlinTag } = require('./zeit');

const DOPPEL_SPERRE_MS = 2 * 60 * 1000;
const RANG_FAKTOR = 1e13; // > jede Zeit in ms bis zum Jahr 2286
const FEHLER_FRIST_TAGEN = 7;
// 'error'-Gründe des Prozessors (external-misses-processor src/regeln.js
// fehlerFolgen), die am Barcode liegen → Wiederöffnen erst nach der normalen
// Frist. Kopie der Werte — Codebases teilen keinen Code.
const FEHLER_AM_BARCODE = new Set(['am_barcode', 'abruf_gesperrt']);
// Felder des Prozessors, die zu einem Versuchszyklus gehören (Fehlerzählung,
// Wartezeit, Sperrgrund, Anspruch) — beim Wiederöffnen weg.
const ZYKLUS_FELDER = ['errorCount', 'fehlerInFolge', 'abrufGesperrtInFolge', 'naechsterVersuchAb', 'letzterFehlerCode', 'errorGrund', 'uebersprungenGrund', 'lockAt', 'lockId'];

const ABGESCHLOSSEN = new Set(['resolved', 'no-data', 'error', 'uebersprungen']);
// Diese Gründe ändern sich nicht mit der Zeit — nie wieder öffnen.
const NIE_WIEDER_OEFFNEN = new Set(['im_katalog', 'ungueltige_ean']);

/**
 * Frist in ms; Infinity, wenn sie unbekannt ist (null nach einem Lesefehler,
 * oder kein gültiger Wert) — dann ist nichts „älter als die Frist".
 */
function fristMs(auffrischenNachTagen) {
  return typeof auffrischenNachTagen === 'number' && Number.isFinite(auffrischenNachTagen) && auffrischenNachTagen > 0
    ? auffrischenNachTagen * TAG_MS
    : Infinity;
}

/** Reihenfolge-Schlüssel des Prozessors (orderBy rang desc). */
function rangFuer(scanTage, lastSeenMs) {
  return scanTage * RANG_FAKTOR + lastSeenMs;
}

/**
 * Grund, der sich aus der Lage ergibt (für offene Einträge). null = aus der
 * Lage nicht ableitbar (eigene Ablage nicht lesbar, oder REWE-Daten, die nicht
 * bezahlt aufgefrischt werden) → bisherigen Grund behalten.
 */
function grundAusLage(lage) {
  if (lage.daten === 'keine') return 'neu';
  if (lage.daten === 'nur_openfood') return 'nur_openfood';
  if (lage.daten === 'vorhanden' && !lage.reweDaten) return 'auffrischen';
  return null;
}

/**
 * Wann wurde zuletzt BEZAHLT gesucht? Der jüngste von: Verarbeitung durch den
 * Prozessor, letzter Auffrischversuch, Datenstand der bezahlt gefundenen
 * Daten. OpenFoodFacts zählt nicht — dessen Daten frischt die Abfrage selbst
 * kostenlos auf; sonst würde ein frisch geholter OFF-Stand die bezahlte Suche
 * nach besseren Daten für immer verhindern.
 */
function letzterVersuchMs(alt, lage) {
  const kandidaten = [zuMs(alt.processedAt), zuMs(alt.refreshVersuchtAm), lage.bezahlterStandMs]
    .filter((v) => typeof v === 'number' && Number.isFinite(v));
  return kandidaten.length ? Math.max(...kandidaten) : null;
}

/**
 * @param {object} p
 * @param {string} p.ean       normalisierte EAN (Doc-Id)
 * @param {object|null} p.alt  external_lookup_misses-Dokument oder null
 * @param {object} p.lage
 *   daten            'keine' | 'nur_openfood' | 'vorhanden' | 'unbekannt'
 *   reweDaten        true, wenn die gezeigten Daten aus der REWE-Pipeline stammen
 *   bezahlterStandMs Datenstand der bezahlt gesuchten Daten (nutritionscrape) oder null
 *   triedSources     Liste der probierten Quellen (Debug)
 *   bestSource       beste Quelle mit Daten oder null
 *   erzwingen        true nur bei Admin-force: sofort auffrischen
 *   altbestandAbgelehnt true: diese Abfrage hat fremden Altbestand erkannt
 * @param {number} p.jetztMs
 * @param {number|null} p.auffrischenNachTagen  null = unbekannt (Kopfkommentar)
 * @returns {{aktion:'nichts'|'anlegen'|'aktualisieren', felder:object, uebergang:string|null}}
 */
function planeAbruf({ ean, alt, lage, jetztMs, auffrischenNachTagen }) {
  const frist = fristMs(auffrischenNachTagen);
  const jetzt = new Date(jetztMs);
  const heute = berlinTag(jetztMs);
  const erzwingen = lage.erzwingen === true;

  // ── Noch kein Eintrag ─────────────────────────────────────────────
  if (!alt) {
    let grund = null;
    if (lage.daten === 'keine') grund = 'neu';
    else if (lage.daten === 'nur_openfood') grund = 'nur_openfood';
    else if (lage.daten === 'vorhanden') {
      // Gute Daten: nur auffrischen, wenn der bezahlt gesuchte Stand älter als
      // die Frist ist (fehlender Stand ist weder „frisch" noch „alt" → nichts).
      const stand = lage.bezahlterStandMs;
      const veraltet = typeof stand === 'number' && jetztMs - stand > frist;
      if (erzwingen || (veraltet && !lage.reweDaten)) grund = 'auffrischen';
      else if (lage.altbestandAbgelehnt === true) grund = grundAusLage(lage);
    }
    if (!grund) return { aktion: 'nichts', felder: {}, uebergang: null };
    return {
      aktion: 'anlegen',
      uebergang: `neu→pending/${grund}`,
      felder: {
        ean,
        status: 'pending',
        grund,
        ...(lage.altbestandAbgelehnt === true ? { altbestandVerworfenAm: jetzt } : {}),
        firstSeenAt: jetzt,
        lastSeenAt: jetzt,
        hitCount: 1,
        scanTage: 1,
        letzterScanTag: heute,
        rang: rangFuer(1, jetztMs),
        triedSources: lage.triedSources || [],
        bestSource: lage.bestSource ?? null,
      },
    };
  }

  // ── Eintrag vorhanden ─────────────────────────────────────────────
  const felder = {};
  const zuletztMs = zuMs(alt.lastSeenAt);
  const gesperrt = zuletztMs !== null && jetztMs - zuletztMs >= 0 && jetztMs - zuletztMs < DOPPEL_SPERRE_MS;

  const altTag = typeof alt.letzterScanTag === 'string'
    ? alt.letzterScanTag
    : zuletztMs !== null
      ? berlinTag(zuletztMs)
      : null;
  const altTage = Number.isFinite(alt.scanTage) && alt.scanTage > 0 ? alt.scanTage : 1;
  let scanTage = altTage;
  let lastSeenMs = zuletztMs ?? jetztMs;

  if (!gesperrt) {
    scanTage = altTag === heute ? altTage : altTage + 1;
    lastSeenMs = jetztMs;
    felder.lastSeenAt = jetzt;
    felder.hitCount = (Number.isFinite(alt.hitCount) ? alt.hitCount : 0) + 1;
    if (scanTage !== alt.scanTage) felder.scanTage = scanTage;
    if (heute !== alt.letzterScanTag) felder.letzterScanTag = heute;
    if (lage.daten !== 'unbekannt') {
      // Aus frischem Speicher bedient = nichts probiert → die letzte
      // Debug-Liste stehen lassen statt sie mit [] zu überschreiben.
      if (Array.isArray(lage.triedSources) && lage.triedSources.length > 0) {
        felder.triedSources = lage.triedSources;
      }
      felder.bestSource = lage.bestSource ?? null;
    }
  }
  const rang = rangFuer(scanTage, lastSeenMs);
  if (rang !== alt.rang) felder.rang = rang;

  // ── Status ────────────────────────────────────────────────────────
  let uebergang = null;
  const status = alt.status;
  const neuerGrund = lage.altbestandAbgelehnt === true && alt.altbestandVerworfenAm == null ? grundAusLage(lage) : null;
  const oeffenbar = status === 'pending' || status == null || ABGESCHLOSSEN.has(status);
  if (neuerGrund && oeffenbar && !NIE_WIEDER_OEFFNEN.has(alt.uebersprungenGrund)) {
    // Fremder Altbestand erkannt → einmal neuer Versuchszyklus ohne den alten „Fund".
    felder.status = 'pending';
    felder.grund = neuerGrund;
    felder.wiedergeoeffnetAm = jetzt;
    felder.altbestandVerworfenAm = jetzt;
    for (const f of [...ZYKLUS_FELDER, 'processedSource', 'processedResult']) if (alt[f] !== undefined) felder[f] = LOESCHEN;
    uebergang = `${status ?? 'ohne'}→pending/${neuerGrund} (fremder Altbestand entfernt)`;
  } else if (status === 'pending') {
    const grund = alt.grund === 'auffrischen' ? 'auffrischen' : grundAusLage(lage) ?? alt.grund ?? null;
    if (grund && grund !== alt.grund) felder.grund = grund;
  } else if (ABGESCHLOSSEN.has(status) && !NIE_WIEDER_OEFFNEN.has(alt.uebersprungenGrund)) {
    const versuch = letzterVersuchMs(alt, lage);
    const fristFall = status === 'error' && !FEHLER_AM_BARCODE.has(alt.errorGrund) ? FEHLER_FRIST_TAGEN * TAG_MS : frist;
    const faellig = versuch === null || jetztMs - versuch > fristFall;
    if (erzwingen || (faellig && !lage.reweDaten)) {
      felder.status = 'pending';
      felder.grund = 'auffrischen';
      felder.wiedergeoeffnetAm = jetzt;
      // Neuer Versuchszyklus: alte Fehlerzählung, Wartezeit und Sperrgrund
      // gelten nicht mehr.
      for (const f of ZYKLUS_FELDER) if (alt[f] !== undefined) felder[f] = LOESCHEN;
      uebergang = `${status}→pending/auffrischen`;
    }
  } else if (status === undefined || status === null) {
    // Altbestand ohne Status: behandeln wie einen offenen Eintrag.
    felder.status = 'pending';
    felder.grund = grundAusLage(lage) ?? 'neu';
    uebergang = 'ohne→pending';
  }
  // processing, skipped (manuell) und Unbekanntes: Status bleibt.

  if (Object.keys(felder).length === 0) return { aktion: 'nichts', felder: {}, uebergang: null };
  return { aktion: 'aktualisieren', felder, uebergang };
}

/**
 * Lage für planeAbruf aus dem Produkt, das die Abfrage am Ende zeigt.
 * @param {object|null} produkt  external_products-Dokument (gespeichert/zusammengeführt)
 * @param {{fehler:boolean, tried:string[], erzwingen:boolean}} p
 *   fehler: eine eigene Ablage war nicht lesbar (reweapify, nutritionscrape,
 *   scraped_products) — dann ist „nichts gefunden" keine Aussage. Ein Ausfall
 *   von OpenFoodFacts allein gehört NICHT hierher (Kopfkommentar).
 */
function lageAusProdukt(produkt, { fehler = false, tried = [], erzwingen = false, altbestandAbgelehnt = false } = {}) {
  if (!produkt || !istAnzeigbar(produkt)) {
    return {
      daten: fehler ? 'unbekannt' : 'keine',
      reweDaten: false,
      bezahlterStandMs: null,
      triedSources: tried,
      bestSource: null,
      erzwingen,
      altbestandAbgelehnt,
    };
  }
  const gruppe = quellenGruppe(produkt.source);
  return {
    daten: gruppe === 'openfood' ? 'nur_openfood' : 'vorhanden',
    // REWE-PIPELINE-Daten (nicht bezahlt auffrischen): ausdrücklich so
    // markiert, oder Quelle rewe ohne Markierung (Altbestand). Ein bezahlter
    // Fund auf rewe.de heißt ebenfalls source 'rewe', trägt aber
    // fetchedAtQuelle 'nutritionscrape' — für ihn gibt es keine Pipeline.
    reweDaten: produkt.fetchedAtQuelle === 'rewe_pipeline' || (gruppe === 'rewe' && produkt.fetchedAtQuelle !== 'nutritionscrape'),
    bezahlterStandMs: produkt.fetchedAtQuelle === 'nutritionscrape' ? zuMs(produkt.fetchedAt) : null,
    triedSources: tried,
    bestSource: produkt.source ?? null,
    erzwingen,
    altbestandAbgelehnt,
  };
}

/**
 * OpenFoodFacts-Daten kostenlos neu von der API holen? Ja, wenn der Datenstand
 * (fetchedAt; Altbestand ohne fetchedAt: cachedAt — bei reinen OFF-Dokumenten
 * die Abrufzeit) älter als die Frist ist UND seit dem letzten Versuch
 * (openfoodVersuchtAm) die Frist vergangen ist — höchstens einmal je Frist.
 *
 * Außerdem einmal sofort, wenn das Dokument Daten der OpenFoodFacts-WEBSEITE
 * trägt, die noch nie gegen die API geprüft wurden (Prüfrunde 2): diesen
 * Altbestand las die Suche vor dem 04.10.2026 ohne EAN-Beleg (etwa die Seite
 * von 4316268436137 als Quelle für 4000540031874), und die bezahlte
 * Auffrischung erreicht ihn nie (sie schließt OpenFoodFacts aus). Kennt die
 * API die EAN, gewinnen ihre Daten; kennt sie sie nicht, gehörte die Seite
 * zu einem anderen Code (index.js tryOpenFood entfernt sie).
 */
function openfoodAuffrischenFaellig(doc, jetztMs, auffrischenNachTagen) {
  if (!doc) return false;
  const versuch = zuMs(doc.openfoodVersuchtAm);
  if (versuch === null && offWebseitenQuelle(doc)) return true;
  if (quellenGruppe(doc.source) !== 'openfood') return false;
  // Frist unbekannt (null) → Infinity: dann nur, wenn noch nie ein Stand und
  // nie ein Versuch vermerkt ist (das gälte bei jeder Frist).
  const frist = fristMs(auffrischenNachTagen);
  const stand = zuMs(doc.fetchedAt) ?? zuMs(doc.cachedAt) ?? zuMs(doc.storedAt);
  const standAlt = stand === null || jetztMs - stand > frist;
  const versuchAlt = versuch === null || jetztMs - versuch > frist;
  return standAlt && versuchAlt;
}

module.exports = {
  DOPPEL_SPERRE_MS,
  fristMs,
  RANG_FAKTOR,
  FEHLER_FRIST_TAGEN,
  FEHLER_AM_BARCODE,
  rangFuer,
  grundAusLage,
  letzterVersuchMs,
  planeAbruf,
  lageAusProdukt,
  openfoodAuffrischenFaellig,
};
