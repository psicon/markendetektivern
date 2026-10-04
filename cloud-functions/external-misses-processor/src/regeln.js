/**
 * Regeln des Prozessors für unbekannte Barcodes — reine Funktionen, keine
 * Seiteneffekte, kein Firestore. Die Abläufe mit Firestore stehen in
 * src/lauf.js und rufen nur diese Entscheidungen auf.
 *
 * Grundsatz (CLAUDE.md): Gesucht wird NUR per EAN, nie per Name. Ein
 * Fremddienst-Fehler ist nie ein „nichts gefunden": 503, Netz- und
 * Zeitfehler bleiben offen (nach MAX_ERRORS → 'error', nie 'no-data').
 *
 * Fehler werden getrennt (Prüfrunde 04.10.2026). Bis dahin zählte jeder
 * Fehler gegen den Barcode, und der Fall kam mit unverändertem Rang sofort
 * wieder dran: beim 10-Minuten-Takt stand der meistgescannte Barcode nach
 * ~50 Minuten Ausfall (KI, Serper, falscher Schlüssel) für die ganze
 * Wiederöffnungsfrist auf 'error'.
 *   • dienstweit (KI, Suche, Schlüssel, Ausrollen, scrapeEan nicht
 *     erreichbar, Zeitüberschreitung): zählt NICHT gegen den Barcode
 *     (errorCount); folgen zwei solche Fehler aufeinander, pausiert der
 *     Prozessor mit wachsender Pause (pauseNachDienstAusfall).
 *   • am Barcode (alle Shopseiten dieses Barcodes gesperrt, Lauf abgestürzt):
 *     zählt gegen den Barcode, nach MAX_ERRORS → 'error'. Sind die Shopseiten
 *     ZWEIMAL IN FOLGE gesperrt (fetch_unavailable, mindestens 6 h
 *     auseinander), endet der Zyklus schon dann ('error', errorGrund
 *     'abruf_gesperrt', Prüfrunde 2): Shops wie
 *     saturn, skroutz, kaufland sperren dauerhaft, und jede Wiederholung
 *     kostete eine Serper-Suche und einen Platz im Tagesdeckel. So beendete
 *     Fälle öffnet die Abfrage erst nach der normalen Frist wieder
 *     (external-product-lookup lib/abrufPlan.js FEHLER_AM_BARCODE).
 *   • jeder Fehler: der Fall wartet vor dem nächsten Versuch
 *     (naechsterVersuchAb, wachsend) — die Versuche verteilen sich über
 *     Stunden statt Minuten, ein vorübergehendes 429 klingt ab.
 *   • Sicherheitsnetz: nach MAX_FEHLER_IN_FOLGE Fehlern gleich welcher Art
 *     'error' — ein Barcode, an dem scrapeEan jedes Mal mit einem
 *     „dienstweiten" Code scheitert, während andere durchlaufen, kostete
 *     sonst für immer eine Suche am Tag.
 */

/** Nach so vielen Fehlern AM BARCODE in Folge wird ein Fall 'error'. */
const MAX_ERRORS = 5;
/** Nach so vielen gesperrten Abrufen (fetch_unavailable am Barcode) in Folge ebenfalls. */
const MAX_ABRUF_GESPERRT = 2;
/**
 * Mindestwartezeit nach einem gesperrten Abruf. Auch ein Apify-Ausfall
 * (Zeitlimit, 5xx, leere Antwort — je Seite, src/fetcher.js im
 * nutrition-scraper) kommt als fetch_unavailable am Barcode an; mit 30 min
 * Abstand schlösse schon ein zweistündiger Ausfall die betroffenen Barcodes
 * bis zur Auffrischfrist. Erst wer auch 6 h später noch gesperrt ist, gilt
 * als dauerhaft gesperrt.
 */
const ABRUF_GESPERRT_WARTEN_MS = 6 * 60 * 60 * 1000;
/** Nach so vielen Fehlern jeder Art in Folge ebenfalls 'error' (siehe oben). */
const MAX_FEHLER_IN_FOLGE = 12;
/** Wartezeit nach dem n-ten Fehler in Folge: 30 min · 2^(n-1), höchstens 24 h. */
const WARTEN_BASIS_MS = 30 * 60 * 1000;
const WARTEN_MAX_MS = 24 * 60 * 60 * 1000;
/** Pause nach dem n-ten dienstweiten Fehler in Folge (ab n = 2): 30 min · 2^(n-2), höchstens 6 h. */
const PAUSE_BASIS_MS = 30 * 60 * 1000;
const PAUSE_MAX_MS = 6 * 60 * 60 * 1000;

/**
 * Fehlercodes, die nicht am Barcode liegen. Codes aus ordneErgebnisZu bzw.
 * `result` der 503-Antwort von scrapeEan (nutrition-scraper src/fehler.js).
 * Am Barcode liegen: fetch_unavailable (jede Seite dieses Barcodes gesperrt)
 * und anspruch_verloren (Lauf abgestürzt). Ausnahme: fetch_unavailable MIT
 * extractErrors > 0 in der Antwort ist ein Apify-Konto-/Kontingentfehler
 * (src/fehler.js im nutrition-scraper: derselbe Code) — dienstweit.
 *
 * Zeitüberschreitungen (zeitlimit = Frist von scrapeEan, zeitlimit_aufruf =
 * Abbruch nach 240 s) sind dienstweit (Prüfrunde 2): sie entstehen, wenn die
 * KI hängt (28.09.–02.10.2026 beantwortete Vertex Anfragen minutenlang
 * nicht) oder Apify langsam rendert. Am Barcode gezählt, lief der Prozessor
 * bei einem Hänger im vollen Takt weiter und setzte die meistgescannten
 * Barcodes nacheinander auf 'error'. Ein Barcode, der bei JEDEM Versuch
 * hängt, endet über MAX_FEHLER_IN_FOLGE.
 */
const DIENSTWEITE_FEHLER = new Set([
  'nicht_autorisiert', 'http_400', 'http_403', 'http_404', 'unerwartetes_ergebnis',
  'extract_unavailable', 'search_unavailable', 'infrastruktur', 'nicht_verfuegbar', 'netz',
  'zeitlimit', 'zeitlimit_aufruf',
]);

function istDienstweit(code) {
  return DIENSTWEITE_FEHLER.has(code) || /^http_5\d\d$/.test(String(code || ''));
}

/** Wartezeit vor dem nächsten Versuch nach `fehlerInFolge` Fehlern. */
function wartezeitMs(fehlerInFolge) {
  const n = Math.max(1, Number(fehlerInFolge) || 1);
  return Math.min(WARTEN_BASIS_MS * 2 ** (n - 1), WARTEN_MAX_MS);
}

/** Pause des Prozessors nach `dienstAusfallInFolge` dienstweiten Fehlern
 *  in Folge; 0 = keine Pause (ein einzelner kann an einem Barcode liegen). */
function pauseNachDienstAusfall(dienstAusfallInFolge) {
  const n = Number(dienstAusfallInFolge) || 0;
  if (n < 2) return 0;
  return Math.min(PAUSE_BASIS_MS * 2 ** (n - 2), PAUSE_MAX_MS);
}

/**
 * Folgen eines Fehlers für den Fall.
 * errorGrund (nur bei 'error'): 'am_barcode' (MAX_ERRORS Fehler am Barcode),
 * 'abruf_gesperrt' (MAX_ABRUF_GESPERRT gesperrte Abrufe in Folge) oder
 * 'in_folge' (MAX_FEHLER_IN_FOLGE Fehler jeder Art). Die Abfrage öffnet die
 * ersten beiden erst nach der normalen Frist wieder, 'in_folge' nach 7 Tagen.
 * @returns {{ status: 'pending'|'error', errorGrund: string|null, dienstweit: boolean,
 *   errorCountPlus: 0|1, fehlerInFolge: number, abrufGesperrtInFolge: number, wartenMs: number }}
 */
function fehlerFolgen({ code, vorher, dienstweit: erzwungen = null }) {
  const v = vorher || {};
  const dienstweit = typeof erzwungen === 'boolean' ? erzwungen : istDienstweit(code);
  const errorCount = (Number(v.errorCount) || 0) + (dienstweit ? 0 : 1);
  const fehlerInFolge = (Number(v.fehlerInFolge) || 0) + 1;
  const abrufGesperrtInFolge = code === 'fetch_unavailable' && !dienstweit ? (Number(v.abrufGesperrtInFolge) || 0) + 1 : 0;
  let errorGrund = null;
  if (errorCount >= MAX_ERRORS) errorGrund = 'am_barcode';
  else if (abrufGesperrtInFolge >= MAX_ABRUF_GESPERRT) errorGrund = 'abruf_gesperrt';
  else if (fehlerInFolge >= MAX_FEHLER_IN_FOLGE) errorGrund = 'in_folge';
  const wartenMs = abrufGesperrtInFolge > 0
    ? Math.max(wartezeitMs(fehlerInFolge), ABRUF_GESPERRT_WARTEN_MS)
    : wartezeitMs(fehlerInFolge);
  return {
    status: errorGrund ? 'error' : 'pending',
    errorGrund,
    dienstweit,
    errorCountPlus: dienstweit ? 0 : 1,
    fehlerInFolge,
    abrufGesperrtInFolge,
    wartenMs,
  };
}

/**
 * Deutsche Handelsketten für RCN-8-Codes (8-stellig, beginnt mit 2 oder 0).
 * Diese Nummern vergibt jeder Händler selbst (z. B. Lidl 20003180 „Golden
 * Puffs"; bei Lidl, Penny und Norma fest gedruckte Eigenmarken-Barcodes, siehe
 * review-console/src/werte.js), derselbe Code meint bei einem anderen Händler
 * ein anderes Produkt. Eine Seite eines beliebigen Shops wäre deshalb kein
 * Beleg — gesucht wird nur bei den Händlern, die solche Codes in Deutschland
 * ausgeben.
 * Schreibweise: Domain ohne „www."; scrapeEan lässt einen Kandidaten zu,
 * wenn sein Host gleich der Domain ist oder auf „.<domain>" endet.
 */
const RCN8_DOMAINS = Object.freeze([
  'lidl.de',
  'kaufland.de',
  'aldi-nord.de',
  'aldi-sued.de',
  'mein-aldi.de',
  'penny.de',
  'netto-online.de',
  'netto.de',
  'norma-online.de',
  'rewe.de',
  'edeka.de',
  'edeka24.de',
  'marktkauf.de',
  'globus.de',
  'tegut.de',
  'mytime.de',
  'dm.de',
  'rossmann.de',
  'mueller.de',
  'budni.de',
]);

/** Katalog-Prüfung: dieselben Felder wie `extractEans`
 *  (lib/utils/productNutrition.ts; Kopien in nutrition-backfill und
 *  nutrition-scraper). Ändert sich dort die Feldliste → hier nachziehen. */
const KATALOG_SAMMLUNGEN = Object.freeze(['produkte', 'markenProdukte']);
const KATALOG_LISTENFELDER = Object.freeze(['EANs', 'eans']);
const KATALOG_EINZELFELDER = Object.freeze(['EAN', 'ean', 'gtin', 'GTIN', 'moreInformation.EAN']);

const GTIN_LAENGEN = [8, 12, 13, 14];

function istZiffernfolge(s) {
  return typeof s === 'string' && /^\d+$/.test(s);
}

/**
 * Gültige GTIN: nur Ziffern, Länge 8/12/13/14, GS1-Prüfziffer stimmt
 * (Modulo 10, Gewichte 3/1 von rechts), nicht nur Nullen (die Prüfziffer
 * von „00000000" stimmt, ein Produkt ist das nie).
 */
function istGueltigeGtin(code) {
  if (!istZiffernfolge(code) || !GTIN_LAENGEN.includes(code.length)) return false;
  if (/^0+$/.test(code)) return false;
  const ziffern = code.split('').map(Number);
  const pruef = ziffern.pop();
  let summe = 0;
  for (let i = ziffern.length - 1, gewicht = 3; i >= 0; i -= 1, gewicht = 4 - gewicht) {
    summe += ziffern[i] * gewicht;
  }
  return (10 - (summe % 10)) % 10 === pruef;
}

/**
 * 13-stellige Schreibweise einer GTIN-12/13/14 (UPC-A bekommt eine führende
 * 0, GTIN-14 verliert eine führende 0). null, wenn es keine gibt (GTIN-8,
 * GTIN-14 mit Packungsindikator 1–9).
 */
function als13Stellen(code) {
  if (!istZiffernfolge(code)) return null;
  if (code.length === 13) return code;
  if (code.length === 12) return `0${code}`;
  if (code.length === 14 && code[0] === '0') return code.slice(1);
  return null;
}

/**
 * Händler-interner Code (Waage/Laden, GS1 „Restricted Circulation Number"):
 * 13-stellig mit Präfix 20–29, 02 oder 04. Dieselbe Nummer in anderer
 * Schreibweise zählt mit: UPC-A „2…"/„4…" (12-stellig, Android) ist dasselbe
 * wie EAN-13 „02…"/„04…" (iOS meldet UPC-A mit führender 0). GS1 vergibt
 * 020–029, 040–049 und 200–299 nie an Hersteller — solche Codes gelten nur in
 * einem Markt, eine bezahlte Suche fände bestenfalls ein fremdes Produkt.
 * Gleiche Abgrenzung wie `istHandelsCode` in review-console/src/werte.js
 * (Codebases teilen keinen Code — bei Änderungen beide nachziehen).
 * Lose Ware selbst wird angenommen (Entscheidung 20.09.2026); hier geht es nur
 * darum, für solche Nummern kein Geld auszugeben.
 */
function istLadencode(code) {
  if (!istGueltigeGtin(code)) return false;
  const k13 = als13Stellen(code);
  if (!k13) return false;
  return /^(2|02|04)/.test(k13);
}

/** RCN-8: 8-stellige, gültige GTIN mit führender 2 oder 0 (händlereigene
 *  Kurznummer nach GS1). */
function istRcn8(code) {
  return istGueltigeGtin(code) && code.length === 8 && (code[0] === '2' || code[0] === '0');
}

/**
 * Entscheidung VOR jedem bezahlten Schritt, nur aus der Nummer selbst.
 * @returns {{ art: 'ueberspringen', grund: 'ungueltige_ean'|'ladencode' }
 *         | { art: 'suchen', nurDomains?: string[] }}
 */
function vorabEntscheidung(ean) {
  const code = String(ean == null ? '' : ean);
  if (!istGueltigeGtin(code)) return { art: 'ueberspringen', grund: 'ungueltige_ean' };
  if (istLadencode(code)) return { art: 'ueberspringen', grund: 'ladencode' };
  if (istRcn8(code)) return { art: 'suchen', nurDomains: [...RCN8_DOMAINS] };
  return { art: 'suchen' };
}

/**
 * Alle Schreibweisen einer gültigen GTIN, unter denen der Katalog sie führen
 * könnte: 8–14 Stellen (nur führende Nullen verschieden, wie `eanVarianten`
 * in review-console/src/werte.js und external-product-lookup/lib/katalog.js —
 * beide Seiten müssen „steht im Katalog" gleich entscheiden) plus die Zahl
 * ohne führende Nullen (Altdaten mit EAN als Zahl). Leer bei ungültiger GTIN.
 */
function katalogVarianten(ean) {
  const code = String(ean == null ? '' : ean);
  if (!istGueltigeGtin(code)) return [];
  const v14 = code.padStart(14, '0');
  const werte = [];
  for (let laenge = 14; laenge >= 8; laenge -= 1) {
    const vorne = v14.slice(0, 14 - laenge);
    if (/^0*$/.test(vorne)) werte.push(v14.slice(14 - laenge));
  }
  const alsZahl = Number(v14);
  if (Number.isSafeInteger(alsZahl) && alsZahl > 0) werte.push(alsZahl);
  return [...new Set(werte)];
}

/**
 * Darf dieser Lauf den Fall beanspruchen (= eine bezahlte Suche beginnen)?
 * Wird IN der Transaktion mit frisch gelesenem Fall, Tageszähler und
 * Konfiguration aufgerufen.
 * `halt: true` heißt: auch keinen weiteren Fall in diesem Lauf.
 */
function beanspruchenUrteil({ status, konfig, tagBearbeitet, naechsterVersuchAbMs = null, jetztMs = null }) {
  if (konfig && Array.isArray(konfig.ungueltig) && konfig.ungueltig.length > 0) {
    return { ok: false, grund: 'konfig_ungueltig', halt: true };
  }
  if (!konfig || konfig.aktiv !== true) return { ok: false, grund: 'aus', halt: true };
  const bearbeitet = Number(tagBearbeitet) || 0;
  if (bearbeitet >= konfig.tagesDeckel) return { ok: false, grund: 'tagesdeckel', halt: true };
  if (status !== 'pending') return { ok: false, grund: 'nicht_pending', halt: false };
  if (wartet(naechsterVersuchAbMs, jetztMs)) return { ok: false, grund: 'wartet', halt: false };
  return { ok: true };
}

/** Wartet der Fall noch auf seinen nächsten Versuch (naechsterVersuchAb)? */
function wartet(naechsterVersuchAbMs, jetztMs) {
  return typeof naechsterVersuchAbMs === 'number' && typeof jetztMs === 'number' && naechsterVersuchAbMs > jetztMs;
}

/**
 * Serper-Guthaben gegen die Mindestgrenze. Unbekanntes Guthaben (Abfrage
 * gescheitert, kein Schlüssel) hält ebenfalls an: Die Grenze ist eine
 * Geld-Sicherung, und eine Sicherung, die bei einem Lesefehler still
 * durchlässt, sichert nichts (CLAUDE.md, „Ein Schalter, der nichts abschaltet").
 */
function serperUrteil(guthaben, mindestGuthaben) {
  if (typeof guthaben !== 'number' || !Number.isFinite(guthaben)) {
    return { ok: false, grund: 'serper_guthaben_unbekannt' };
  }
  if (guthaben < mindestGuthaben) return { ok: false, grund: 'serper_guthaben' };
  return { ok: true };
}

/** Gab es für diesen Fall schon einmal einen Fund? Dann liegen Daten vor,
 *  und ein Lauf ohne neuen Fund darf ihn nicht auf 'no-data' setzen.
 *
 *  `rohdatenVorhanden` setzt der Ablauf (src/lauf.js) bei Auffrischungen aus
 *  nutritionscrape/{ean}: Einen Fall 'auffrischen' legt die Abfrage auch
 *  NEU an, wenn bezahlt gefundene Daten älter als die Frist sind, aber noch
 *  kein Fall existiert (lib/abrufPlan.js in external-product-lookup) — dann
 *  fehlen processedSource/processedResult, die Daten gibt es trotzdem. Ein
 *  „keine Daten" wäre dort eine falsche inhaltliche Aussage. */
function hatFruehererFund(vorher) {
  const v = vorher || {};
  if (v.rohdatenVorhanden === true) return true;
  if (typeof v.processedSource === 'string' && v.processedSource.length > 0) return true;
  return v.processedResult === 'ok' || v.processedResult === 'auffrischen_ohne_fund';
}

/** Trägt ein nutritionscrape-Dokument Daten aus einem früheren Fund? Dieselbe
 *  Regel wie `hatDaten` im nutrition-scraper (src/zusammenfuehren.js):
 *  Fehlversuch-Marker aus scrapeBatch (_failed ohne Daten) zählen nicht.
 *  Ebenso nicht (Prüfrunde 3): ungeprüfter Altbestand von einer
 *  OpenFoodFacts-Seite (ohne fetchedAt). Die Abfrage übernimmt ihn nie
 *  (external-product-lookup lib/rohablage.js istOffWebseitenAltbestand) —
 *  OpenFoodFacts-Daten liefert die kostenlose API, die bezahlte Suche läuft
 *  ohne OpenFoodFacts. Als „früherer Fund" hielte er einen Fall, dessen
 *  bezahlte Suche nichts findet, für immer auf 'resolved'. */
function rohdatenVorhanden(scrapeDaten) {
  const d = scrapeDaten || {};
  if (!(d.scrapedSource || d.scrapedAt)) return false;
  return !istOffWebseitenAltbestand(d);
}

/** Host einer Adresse (ohne „www.") oder null. */
function hostVon(adresse) {
  if (typeof adresse !== 'string' || !adresse.trim()) return null;
  const a = adresse.trim();
  try {
    return new URL(/^https?:\/\//i.test(a) ? a : `https://${a}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Ungeprüfter Altbestand (vor dem 04.10.2026, ohne fetchedAt) einer
 * OpenFoodFacts-/OpenBeautyFacts-Seite? Kopie der Regel aus
 * external-product-lookup lib/rohablage.js istOffWebseitenAltbestand —
 * Codebases teilen keinen Code; ändert sich dort etwas, hier nachziehen.
 */
function istOffWebseitenAltbestand(scrapeDaten) {
  const d = scrapeDaten || {};
  if (!(d.scrapedSource || d.scrapedAt) || d.fetchedAt != null) return false;
  const shop = typeof d.sourceShop === 'string' ? d.sourceShop.trim().toLowerCase() : '';
  const host = hostVon(d.scrapedUrl) || hostVon(d.sourceUrl) || (shop.includes('.') ? hostVon(shop) : null);
  if (host && /(^|\.)open(food|beauty|petfood|products)facts\.org$/.test(host)) return true;
  // sourceShop als Name ('openfoodfacts'): wie quelleAusShop + quellenGruppe dort.
  if (/(^|[.-])(rewe|metro)([.-]|$)/.test(shop) || shop.includes('globus')) return false;
  return (shop.split('.')[0] || '').includes('openfood');
}

// Der Fund kann schon vor dem Vermerk des Abbruchs gespeichert worden sein
// (scrapeEan schreibt, während der Prozessor noch auf die Antwort wartet):
// ein Fund ab „Abbruch minus Aufrufdauer" zählt.
const ABBRUCH_VORLAUF_MS = 5 * 60 * 1000;

/**
 * Liegt seit dem abgebrochenen Versuch ein Fund vor? Bricht der Prozessor
 * scrapeEan nach 240 s ab (oder reißt die Verbindung), läuft scrapeEan
 * weiter und speichert einen Fund trotzdem. Dann nicht noch einmal bezahlen
 * (Prüfrunde 04.10.2026: 1 von 393 Aufrufen seit 01.10. über 240 s).
 * @param {{letzterFehlerCode?:string, processedAtMs?:number|null}} fall
 * @param {number|null} fundStandMs  fetchedAt von nutritionscrape/{ean} in ms
 */
function fundNachAbbruch({ letzterFehlerCode, processedAtMs }, fundStandMs) {
  if (letzterFehlerCode !== 'zeitlimit_aufruf' && letzterFehlerCode !== 'netz') return false;
  return typeof fundStandMs === 'number' && typeof processedAtMs === 'number'
    && fundStandMs > processedAtMs - ABBRUCH_VORLAUF_MS;
}

/** Gespeicherte Quellseite für die Auffrischung — nur echte http(s)-Adressen
 *  und nie openfoodfacts (deren Daten holt die Abfrage kostenlos per API). */
function waehleBevorzugteUrl(scrapeDaten) {
  const d = scrapeDaten || {};
  const roh = typeof d.sourceUrl === 'string' && d.sourceUrl ? d.sourceUrl : d.scrapedUrl;
  if (typeof roh !== 'string' || !roh) return null;
  let url;
  try {
    url = new URL(roh);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (/(^|\.)openfoodfacts\./i.test(url.hostname)) return null;
  return url.toString();
}

/**
 * Anfrage an scrapeEan (ohne Schlüssel — den setzt der Aufrufer dazu).
 * OpenFoodFacts-Seiten werden im bezahlten Ablauf immer übersprungen: deren
 * Daten liefert die kostenlose API, die die Abfrage ohnehin nutzt.
 */
function scrapeAnfrage({ ean, vorab, grund, bevorzugteUrl }) {
  const anfrage = { ean: String(ean), ohneOpenFoodFacts: true };
  if (vorab && Array.isArray(vorab.nurDomains) && vorab.nurDomains.length > 0) {
    anfrage.nurDomains = [...vorab.nurDomains];
  }
  if (grund === 'auffrischen') {
    anfrage.auffrischen = true;
    if (bevorzugteUrl) anfrage.bevorzugteUrl = bevorzugteUrl;
  }
  return anfrage;
}

/**
 * Ordnet die Antwort von scrapeEan einem Ergebnis zu.
 *
 * @param {object} p
 * @param {{ httpStatus?: number, body?: object, netzFehler?: string, zeitlimit?: boolean }} p.antwort
 * @param {object} p.vorher         Daten des Falls VOR der Beanspruchung
 * @returns {{
 *   art: 'fund'|'kein_fund'|'fehler',
 *   status: string,
 *   processedResult?: string,
 *   processedSource?: string,
 *   fehlerCode?: string,
 *   fehlerText?: string,
 *   zaehler: 'gefunden'|'keineDaten'|'fehler',
 *   kostenAngefallen: boolean,
 *   laufAbbrechen: boolean,
 * }}
 */
function ordneErgebnisZu({ antwort, vorher }) {
  const a = antwort || {};
  const fehler = (fehlerCode, fehlerText, kostenAngefallen, dienstweit = null) => {
    const f = fehlerFolgen({ code: fehlerCode, vorher, dienstweit });
    return {
      art: 'fehler',
      status: f.status,
      errorGrund: f.errorGrund,
      fehlerCode,
      fehlerText: String(fehlerText || fehlerCode).slice(0, 500),
      zaehler: 'fehler',
      kostenAngefallen,
      dienstweit: f.dienstweit,
      errorCountPlus: f.errorCountPlus,
      fehlerInFolge: f.fehlerInFolge,
      abrufGesperrtInFolge: f.abrufGesperrtInFolge,
      wartenMs: f.wartenMs,
      // Nach einem dienstweiten Fehler keinen weiteren Fall in diesem Lauf:
      // jeder weitere Aufruf kostete trotzdem eine Serper-Suche.
      laufAbbrechen: f.dienstweit,
    };
  };

  if (a.netzFehler !== undefined || a.zeitlimit) {
    // Abbruch nach 240 s oder Netzfehler: scrapeEan hat womöglich schon gesucht.
    return fehler(a.zeitlimit ? 'zeitlimit_aufruf' : 'netz', a.netzFehler, true);
  }

  const status = a.httpStatus;
  const body = a.body && typeof a.body === 'object' ? a.body : {};
  if (status === 200) {
    if (body.result === 'ok') {
      return {
        art: 'fund',
        status: 'resolved',
        processedResult: 'ok',
        processedSource: typeof body.successShop === 'string' && body.successShop ? body.successShop : 'scraper',
        zaehler: 'gefunden',
        kostenAngefallen: true,
        laufAbbrechen: false,
      };
    }
    if (body.result === 'all_failed' || body.result === 'no_urls') {
      if (body.altdatenWiderlegt === true) {
        // Die gespeicherte Quellseite widerlegt die alten (ungeprüften) Daten
        // — scrapeEan hat sie entfernt. Einen früheren Fund gibt es nicht mehr.
        return {
          art: 'kein_fund',
          status: 'no-data',
          processedResult: 'quelle_widerlegt',
          processedSourceLoeschen: true,
          zaehler: 'keineDaten',
          kostenAngefallen: true,
          laufAbbrechen: false,
        };
      }
      // Inhaltliche Aussage („die Suche lief und fand nichts"). Lag schon
      // ein früherer Fund vor, bleiben dessen Daten und der Fall 'resolved'.
      const frueher = hatFruehererFund(vorher);
      return {
        art: 'kein_fund',
        status: frueher ? 'resolved' : 'no-data',
        processedResult: frueher ? 'auffrischen_ohne_fund' : body.result,
        zaehler: 'keineDaten',
        kostenAngefallen: true,
        laufAbbrechen: false,
      };
    }
    return fehler('unerwartetes_ergebnis', `unerwartetes scrapeEan-Ergebnis: ${JSON.stringify(body.result)}`, true);
  }
  if (status === 503) {
    const code = typeof body.result === 'string' && body.result ? body.result : 'nicht_verfuegbar';
    // fetch_unavailable nach einem Infrastrukturfehler (extractErrors) heißt
    // Apify-Konto/-Kontingent, nicht „alle Seiten dieses Barcodes gesperrt".
    const apifyKonto = code === 'fetch_unavailable' && Number(body.extractErrors) > 0 ? true : null;
    return fehler(code, `scrapeEan 503 ${code}${body.error ? `: ${body.error}` : ''}`, true, apifyKonto);
  }
  if (status === 401) return fehler('nicht_autorisiert', 'scrapeEan 401 — Schlüssel abgelehnt', false);
  if (status === 400 || status === 403 || status === 404) {
    return fehler(`http_${status}`, `scrapeEan ${status}`, false);
  }
  return fehler(`http_${status}`, `scrapeEan ${status}${a.text ? `: ${String(a.text).slice(0, 200)}` : ''}`, true);
}

/**
 * Reihenfolge der Kandidaten: zuerst nach `rang` (absteigend), danach Fälle
 * ohne `rang` aus der Abfrage nach hitCount. Firestore lässt bei
 * orderBy('rang') jedes Dokument ohne dieses Feld still weg — ohne die
 * zweite Abfrage wären solche Fälle unsichtbar. Scheitert die Abfrage nach
 * rang (Index fehlt), gilt allein die Reihenfolge nach hitCount.
 *
 * @param {{ nachRang: Array<{id:string,data:object}>|null,
 *           nachHitCount: Array<{id:string,data:object}>|null,
 *           grenze: number }} p   null = Abfrage gescheitert
 */
function waehleKandidaten({ nachRang, nachHitCount, grenze }) {
  const hatRang = (k) => typeof (k.data || {}).rang === 'number' && Number.isFinite(k.data.rang);
  const liste = [];
  const gesehen = new Set();
  const nimm = (k) => {
    if (!k || gesehen.has(k.id)) return;
    gesehen.add(k.id);
    liste.push(k);
  };
  if (nachRang) {
    nachRang.forEach(nimm);
    (nachHitCount || []).filter((k) => !hatRang(k)).forEach(nimm);
  } else {
    (nachHitCount || []).forEach(nimm);
  }
  return liste.slice(0, Math.max(0, grenze));
}

module.exports = {
  MAX_ERRORS,
  MAX_FEHLER_IN_FOLGE,
  MAX_ABRUF_GESPERRT,
  ABRUF_GESPERRT_WARTEN_MS,
  RCN8_DOMAINS,
  KATALOG_SAMMLUNGEN,
  KATALOG_LISTENFELDER,
  KATALOG_EINZELFELDER,
  istGueltigeGtin,
  istLadencode,
  istRcn8,
  vorabEntscheidung,
  katalogVarianten,
  beanspruchenUrteil,
  wartet,
  serperUrteil,
  istDienstweit,
  wartezeitMs,
  pauseNachDienstAusfall,
  fehlerFolgen,
  hatFruehererFund,
  rohdatenVorhanden,
  istOffWebseitenAltbestand,
  fundNachAbbruch,
  waehleBevorzugteUrl,
  scrapeAnfrage,
  ordneErgebnisZu,
  waehleKandidaten,
};
