/**
 * Reine Entscheidungen der Nachpflege Oktober 2026 — was an einem bestehenden
 * Dokument nachgetragen wird. Keine Seiteneffekte, kein Firestore; das Lesen
 * und Schreiben macht scripts/nachpflege-2026-10.js.
 *
 * Grundsatz: NUR ergänzen, was fehlt. Ein Feld, das der neue Code schon
 * geschrieben hat (storedAt, fetchedAt, scanTage …), wird nie überschrieben —
 * dadurch ist jeder weitere Lauf gefahrlos, auch nach dem Ausrollen.
 *
 * Zeitpunkte gehen als Millisekunden hinein und heraus; Timestamps baut das
 * Skript.
 */

'use strict';

// Dieselben Regeln wie der laufende Code — eine Quelle: Platzhalter-Namen und
// Quellengruppen (normalizers), Namensrettung aus raw (speichern, der eine
// Schreibweg), Rang der Warteschlange (abrufPlan), Berliner Kalendertag (zeit).
const { echterName, quellenGruppe } = require('../lib/normalizers');
const { nameAusRohdaten } = require('../lib/speichern');
const { rangFuer } = require('../lib/abrufPlan');
const { berlinTag, zuMs } = require('../lib/zeit');
const { rohdatenAusSuche, altbestandAbgelehnt } = require('../lib/rohablage');

/** Woher der Datenstand (`fetchedAt`) kommt — dieselben Werte, die
 *  lib/speichern.js schreibt und lib/abrufPlan.js liest. */
const QUELLE = Object.freeze({
  OPENFOOD_API: 'openfood_api',
  NUTRITIONSCRAPE: 'nutritionscrape',
  REWE_PIPELINE: 'rewe_pipeline',
});

/** Offene Fälle der Warteschlange — nur sie brauchen einen Rang. */
const OFFENE_STATUS = new Set(['pending', 'processing']);

/**
 * Kam der Inhalt aus der Hintergrundsuche (nutritionscrape)? Dieselbe Regel
 * wie der laufende Code (lib/rohablage.js rohdatenAusSuche): `raw` ist die
 * mitkopierte Quelle und kann Felder mehrerer Quellen tragen; die REWE-
 * Pipeline erkennt man an ihren eigenen Feldern — die gewinnen.
 */
const ausNutritionscrape = rohdatenAusSuche;

/**
 * Trägt das Dokument Altbestand der Suche, der sich ohne Netz als fremd
 * erkennen lässt (lib/rohablage.js altbestandAbgelehnt)? Dann rettet die
 * Nachpflege den Namen NICHT (Prüfrunde 2): „Weizenbrötchen" über den
 * Zutaten eines Hygienereinigers (20006204) machte die fremden Daten nur
 * glaubwürdiger. Das Entfernen samt Namensrettung erledigt die Abfrage beim
 * nächsten Scan in EINEM Schreibvorgang (index.js lookupByEAN).
 * @returns {string|null} Grund
 */
function abgelehnterAltbestand(d) {
  const raw = d.raw;
  if (!d.ean || !ausNutritionscrape(raw)) return null;
  const r = altbestandAbgelehnt({ ...raw, scrapedAt: raw.scrapedAtMs, fetchedAt: raw.fetchedAtMs }, d.ean);
  return r ? r.grund : null;
}

/**
 * Datenstand eines Bestands-Dokuments (Vertrag 04.10.2026, Teil 2):
 *  - OpenFoodFacts-API (`source` 'openfood'): Abrufzeit. Bis heute schrieb
 *    writeThrough direkt nach dem Abruf und setzte dabei cachedAt; eine
 *    spätere Kopie aus einer anderen Quelle hätte `source` geändert. cachedAt
 *    ist dort also die Abrufzeit.
 *  - nutritionscrape (Shops, auch die openfoodfacts-Webseite): `fetchedAt` der
 *    mitkopierten Quelle, sonst ihr `scrapedAt` — das sprang bei jedem
 *    Zusammenführen auf „jetzt" und ist darum nur eine Schätzung.
 *  - REWE-Pipeline (reweapify/scraped_products): unbekannt (null). Diese Daten
 *    frischt die Produktsuche nicht bezahlt auf.
 *
 * @param {{source:string|null, cachedAtMs:number|null, raw:object|null}} d
 *   raw.scrapedAtMs / raw.fetchedAtMs bereits in Millisekunden
 * @returns {{fetchedAtMs:number|null, geschaetzt:boolean, quelle:string|null}}
 *   quelle null: nicht zuzuordnen (heute kein Fall) — dann kein fetchedAtQuelle.
 */
function datenstandVon(d) {
  const raw = d.raw || {};
  // Zuerst: der letzte Schreiber war die OFF-API (auch wenn raw noch Felder
  // einer früheren Such-Kopie trägt — writeThrough setzte `source` mit).
  if (d.source === 'openfood') return { fetchedAtMs: d.cachedAtMs, geschaetzt: d.cachedAtMs == null, quelle: QUELLE.OPENFOOD_API };
  if (ausNutritionscrape(raw)) {
    if (raw.fetchedAtMs != null) return { fetchedAtMs: raw.fetchedAtMs, geschaetzt: false, quelle: QUELLE.NUTRITIONSCRAPE };
    if (raw.scrapedAtMs != null) return { fetchedAtMs: raw.scrapedAtMs, geschaetzt: true, quelle: QUELLE.NUTRITIONSCRAPE };
    return { fetchedAtMs: d.cachedAtMs, geschaetzt: true, quelle: QUELLE.NUTRITIONSCRAPE };
  }
  const gruppe = quellenGruppe(d.source);
  if (gruppe === 'rewe') return { fetchedAtMs: null, geschaetzt: false, quelle: QUELLE.REWE_PIPELINE };
  // Weder REWE noch OFF-API noch erkennbar aus der Suche (heute: kein Fall).
  return { fetchedAtMs: d.cachedAtMs, geschaetzt: true, quelle: null };
}

/**
 * Was an einem external_products-Dokument nachzutragen ist.
 *
 * @param {object} d
 * @param {string|null} d.source
 * @param {number|null} d.cachedAtMs
 * @param {number} d.createTimeMs      Anlagezeit des Dokuments (= storedAt)
 * @param {boolean} d.hatStoredAt
 * @param {boolean} d.hatFetchedAt     Feld vorhanden (auch als null)
 * @param {*} d.productName
 * @param {object|null} d.raw          { product_name, generic_name, scrapedSource, scrapedAtMs, fetchedAtMs, merchant_company, price_current, thumbnails }
 * @param {string|null} d.ean          Dokument-ID (für die Prüfung auf fremden Altbestand)
 * @returns {{ setzen: object, quelle: string|null, geschaetzt: boolean,
 *             nameRepariert: {alt:string, neu:string}|null, platzhalterOhneErsatz: boolean,
 *             altbestandAbgelehnt: string|null }}
 *   setzen: storedAtMs?, fetchedAtMs? (auch null), fetchedAtQuelle?, fetchedAtGeschaetzt?,
 *           productName? + nameQuelle? ('openfood' → feldQuellen.name, wie fuehreZusammen)
 */
function planeProdukt(d) {
  const setzen = {};
  if (!d.hatStoredAt && d.createTimeMs != null) setzen.storedAtMs = d.createTimeMs;

  let quelle = null;
  let geschaetzt = false;
  if (!d.hatFetchedAt) {
    const s = datenstandVon(d);
    quelle = s.quelle;
    geschaetzt = s.geschaetzt;
    setzen.fetchedAtMs = s.fetchedAtMs;
    if (s.quelle) setzen.fetchedAtQuelle = s.quelle;
    if (s.geschaetzt && s.fetchedAtMs != null) setzen.fetchedAtGeschaetzt = true;
  }

  // Name: Platzhalter ('Produkt'/'Unbekannt') über einem echten OFF-Namen.
  // Der echte Name steht noch in raw.product_name (merge:true behielt ihn).
  // Gerettet wird genau wie im Schreibweg (speichern.nameAusRohdaten), samt
  // Herkunft: der Name stammt von OpenFoodFacts, nicht von `source`.
  let nameRepariert = null;
  let platzhalterOhneErsatz = false;
  const abgelehnt = abgelehnterAltbestand(d);
  const istPlatzhalter = typeof d.productName === 'string' && d.productName.trim() !== '' && echterName(d.productName) === null;
  if (istPlatzhalter && !abgelehnt) {
    const neu = nameAusRohdaten(d.raw);
    if (neu) {
      setzen.productName = neu;
      setzen.nameQuelle = 'openfood';
      nameRepariert = { alt: d.productName, neu };
    } else platzhalterOhneErsatz = true;
  }
  return { setzen, quelle, geschaetzt, nameRepariert, platzhalterOhneErsatz, altbestandAbgelehnt: abgelehnt };
}

/**
 * Untergrenze der verschiedenen Scan-Tage (Europe/Berlin) aus erstem und
 * letztem Scan: 2, wenn sie auf verschiedene Tage fallen, sonst 1.
 *
 * Warum keine Schätzung aus hitCount: gemessen 04.10.2026 an 7.974 Barcodes,
 * deren ganze Geschichte im 30-Tage-Fenster der Abfrage-Logs liegt — die
 * Untergrenze stimmt bei 96,0 %, ist nie zu hoch und im Mittel 0,049 Tage
 * daneben. hitCount/2 lag 64× zu hoch (Mittel 0,056), hitCount 385× (0,105):
 * Scanner und Detailseite zählen beide, mal einmal, mal zweimal je Scan.
 */
function scanTageUntergrenze(firstMs, lastMs) {
  if (firstMs == null || lastMs == null) return 1;
  return berlinTag(firstMs) === berlinTag(lastMs) ? 1 : 2;
}

/**
 * Was an einem Fall der Warteschlange nachzutragen ist (nur offene Fälle).
 *
 * @param {object} d
 * @param {string|null} d.status
 * @param {number|null} d.firstSeenMs
 * @param {number|null} d.lastSeenMs
 * @param {number|null} d.createTimeMs
 * @param {number|null|undefined} d.scanTage        vorhandener Wert (sonst undefined)
 * @param {string|null|undefined} d.letzterScanTag
 * @param {number|null|undefined} d.rang
 * @returns {{ offen: boolean, setzen: object, zeitAusAnlage: boolean, scanTage: number|null, rang: number|null }}
 */
function planeMiss(d) {
  if (!OFFENE_STATUS.has(d.status)) return { offen: false, setzen: {}, zeitAusAnlage: false, scanTage: null, rang: null };
  const lastSeenMs = d.lastSeenMs ?? d.firstSeenMs ?? d.createTimeMs ?? null;
  const zeitAusAnlage = d.lastSeenMs == null && d.firstSeenMs == null;
  const setzen = {};
  const hatZahl = (v) => typeof v === 'number' && Number.isFinite(v);

  let scanTage = hatZahl(d.scanTage) ? d.scanTage : null;
  if (scanTage == null) {
    scanTage = scanTageUntergrenze(d.firstSeenMs ?? lastSeenMs, lastSeenMs);
    setzen.scanTage = scanTage;
    setzen.scanTageGeschaetzt = true;
  }
  if (typeof d.letzterScanTag !== 'string' && lastSeenMs != null) setzen.letzterScanTag = berlinTag(lastSeenMs);
  let rang = hatZahl(d.rang) ? d.rang : null;
  if (rang == null && lastSeenMs != null) {
    rang = rangFuer(scanTage, lastSeenMs);
    setzen.rang = rang;
  }
  return { offen: true, setzen, zeitAusAnlage, scanTage, rang };
}

/* ─────────────────────────── Dokument ↔ Plan ─────────────────────────── */

/** Eingabe für planeProdukt aus den gelesenen Daten eines external_products-Dokuments. */
function sichtProdukt(x, createTimeMs, ean = null) {
  const d = x || {};
  const raw = d.raw && typeof d.raw === 'object' ? d.raw : null;
  return {
    ean: ean ?? (typeof d.ean === 'string' ? d.ean : null),
    source: typeof d.source === 'string' ? d.source : null,
    cachedAtMs: zuMs(d.cachedAt),
    createTimeMs: createTimeMs ?? null,
    hatStoredAt: d.storedAt !== undefined,
    hatFetchedAt: d.fetchedAt !== undefined,
    productName: d.productName,
    raw: raw && {
      product_name: raw.product_name,
      generic_name: raw.generic_name,
      scrapedSource: raw.scrapedSource,
      scrapedAtMs: zuMs(raw.scrapedAt),
      fetchedAtMs: zuMs(raw.fetchedAt),
      merchant_company: raw.merchant_company,
      price_current: raw.price_current,
      thumbnails: raw.thumbnails,
      sourceShop: raw.sourceShop,
      scrapedUrl: raw.scrapedUrl,
      sourceUrl: raw.sourceUrl,
    },
  };
}

/** Eingabe für planeMiss aus den gelesenen Daten eines external_lookup_misses-Dokuments. */
function sichtMiss(x, createTimeMs) {
  const d = x || {};
  return {
    status: typeof d.status === 'string' ? d.status : null,
    firstSeenMs: zuMs(d.firstSeenAt),
    lastSeenMs: zuMs(d.lastSeenAt),
    processedMs: zuMs(d.processedAt),
    createTimeMs: createTimeMs ?? null,
    scanTage: d.scanTage,
    letzterScanTag: d.letzterScanTag,
    rang: d.rang,
  };
}

/**
 * Plan → Felder für das Firestore-update. Leeres Objekt = nichts zu tun.
 * @param {'produkte'|'misses'} teil
 * @param {object} setzen         aus planeProdukt / planeMiss
 * @param {(ms:number) => *} zeitstempel   baut den Timestamp (Skript: Timestamp.fromMillis)
 */
function felderZumSchreiben(teil, setzen, zeitstempel) {
  const u = {};
  if (teil === 'produkte') {
    if (setzen.storedAtMs != null) u.storedAt = zeitstempel(setzen.storedAtMs);
    if ('fetchedAtMs' in setzen) {
      u.fetchedAt = setzen.fetchedAtMs == null ? null : zeitstempel(setzen.fetchedAtMs);
      u.fetchedAtQuelle = setzen.fetchedAtQuelle;
      if (setzen.fetchedAtGeschaetzt) u.fetchedAtGeschaetzt = true;
    }
    if (setzen.productName) u.productName = setzen.productName;
    // Nur der eine Eintrag; fehlende Gruppen leitet speichern.bisherigeQuellen
    // weiter aus `source` ab.
    if (setzen.nameQuelle) u['feldQuellen.name'] = setzen.nameQuelle;
  } else {
    for (const k of ['scanTage', 'scanTageGeschaetzt', 'letzterScanTag', 'rang']) if (k in setzen) u[k] = setzen[k];
  }
  return u;
}

module.exports = {
  QUELLE,
  OFFENE_STATUS,
  ausNutritionscrape,
  datenstandVon,
  planeProdukt,
  scanTageUntergrenze,
  planeMiss,
  sichtProdukt,
  sichtMiss,
  felderZumSchreiben,
};
