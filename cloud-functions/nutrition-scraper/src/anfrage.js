/**
 * scrapeEan: Anfrage lesen, Kandidaten filtern, Ergebnis entscheiden —
 * reine Funktionen ohne Netz und Firestore.
 *
 * Parameter (POST-Body als JSON oder Query-String):
 *   ean               Pflicht
 *   productName       Hinweis für die KI (nie Suchbegriff — Suche nur per EAN)
 *   productPath       Katalogprodukt, falls bekannt
 *   ohneOpenFoodFacts true → openfoodfacts.*-Seiten überspringen. Der
 *                     external-misses-processor setzt das immer: dieselben
 *                     Daten liefert die OpenFoodFacts-API kostenlos (49 von
 *                     132 bezahlten Funden seit 02.10. kamen von dort).
 *                     scrapeBatch (Katalog) ruft ohne → unverändert.
 *   nurDomains        Liste → nur Seiten dieser Domains (Händler-interne
 *                     8-stellige Codes, die je Kette etwas anderes meinen).
 *   bevorzugteUrl     zuerst diese Seite, ohne Serper-Suche; nur wenn sie
 *                     nichts Belegtes liefert, die volle Suche.
 *   auffrischen       true → ein gültiger neuer Preis ersetzt den alten
 *                     (nur der Prozessor setzt das).
 */

'use strict';

const { FetchUnavailableError } = require('./fehler');

function wahr(v) {
  return v === true || v === 1 || (typeof v === 'string' && ['1', 'true', 'ja'].includes(v.trim().toLowerCase()));
}

function normalisiereDomain(d) {
  if (typeof d !== 'string') return null;
  let s = d.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

function leseUrl(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return ['http:', 'https:'].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * @returns {{ fehler?: string, ean?: string, productName?: string|null,
 *   productPath?: string|null, ohneOpenFoodFacts?: boolean,
 *   nurDomains?: string[]|null, bevorzugteUrl?: string|null,
 *   auffrischen?: boolean, hinweise?: string[] }}
 */
function leseScrapeParameter(roh) {
  const r = roh || {};
  const ean = r.ean == null ? '' : String(r.ean).trim();
  if (!ean) return { fehler: 'Missing ean param' };

  const hinweise = [];
  let nurDomains = null;
  if (r.nurDomains != null && r.nurDomains !== '') {
    const liste = Array.isArray(r.nurDomains) ? r.nurDomains : String(r.nurDomains).split(',');
    nurDomains = [...new Set(liste.map(normalisiereDomain).filter(Boolean))];
    // Eine leere Liste hieße „alle Domains“ — genau das soll der Parameter
    // verhindern. Lieber laut scheitern als still teuer suchen.
    if (nurDomains.length === 0) return { fehler: 'nurDomains enthält keine gültige Domain' };
  }

  let bevorzugteUrl = null;
  if (r.bevorzugteUrl != null && r.bevorzugteUrl !== '') {
    bevorzugteUrl = leseUrl(r.bevorzugteUrl);
    // Eine kaputte gespeicherte Adresse ist kein Grund, die Auffrischung
    // scheitern zu lassen — dann eben die volle Suche.
    if (!bevorzugteUrl) hinweise.push('bevorzugteUrl ungültig, volle Suche');
  }

  return {
    ean,
    productName: typeof r.productName === 'string' && r.productName.trim() ? r.productName.trim() : null,
    productPath: typeof r.productPath === 'string' && r.productPath.trim() ? r.productPath.trim() : null,
    ohneOpenFoodFacts: wahr(r.ohneOpenFoodFacts),
    nurDomains,
    bevorzugteUrl,
    auffrischen: wahr(r.auffrischen),
    hinweise,
  };
}

/** Darf diese Seite im aktuellen Auftrag geholt werden? */
function kandidatErlaubt(url, { ohneOpenFoodFacts = false, nurDomains = null } = {}) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  if (ohneOpenFoodFacts && (host === 'openfoodfacts.org' || host.endsWith('.openfoodfacts.org'))) return false;
  if (Array.isArray(nurDomains)) {
    return nurDomains.some((d) => host === d || host.endsWith(`.${d}`));
  }
  return true;
}

function neuerVerbrauch() {
  return {
    serperSuchen: 0,
    seitenAbrufe: 0,
    apifyAbrufe: 0,
    kiAufrufe: 0,
    tokensEin: 0,
    tokensAus: 0,
    tokensDenken: 0,
  };
}

/** Rückfall-Adresse, die für JEDE EAN angehängt wird (src/resolver.js
 *  resolveFallbackDirectUrls / resolveDirectUrls) — kein Beleg, dass es zu
 *  dieser EAN überhaupt eine Seite gibt. Ihre Antwort (Codecheck-Suchseite,
 *  404) sagt über das Produkt nichts. */
function istRatekandidat(k) {
  return !!k && (k.source === 'fallback' || k.source === 'direct');
}

/**
 * Ergebnis, wenn KEIN Kandidat Daten lieferte.
 *   • ein KI-/Apify-Konto-Ausfall oder abgelaufene Frist → 503 (wie bisher)
 *   • keine Kandidaten                                   → 200 no_urls
 *   • es gab belegte Kandidaten (Serper-Treffer, bevorzugte Seite), und
 *     KEINER davon antwortete — nur Abruffehler           → 503 fetch_unavailable,
 *     auch wenn eine Rückfall-Adresse (Codecheck) antwortete: deren Suchseite
 *     sagt über das Produkt nichts (Prüfrunde 2)
 *   • keine belegten Kandidaten, nur Rückfall-Adressen, keine beantwortet
 *                                                        → 503 fetch_unavailable
 *   • sonst                                              → 200 all_failed
 * „Beantwortet“ heißt: der Kandidat lieferte eine Seite oder ein klares „gibt
 * es nicht“ (404, robots.txt) — also eine Aussage, keinen Ausfall. Ohne die
 * belegte-Zähler (ältere Aufrufer) gilt die Regel über alle Kandidaten.
 */
function entscheideErgebnis({
  kandidaten = 0,
  infraFehler = 0,
  letzterFehlerCode = null,
  zeitlimit = false,
  abrufFehler = 0,
  beantwortet = 0,
  belegteKandidaten = null,
  belegteAbrufFehler = 0,
  belegteBeantwortet = 0,
} = {}) {
  if (infraFehler > 0 || zeitlimit) {
    return { http: 503, result: infraFehler > 0 ? letzterFehlerCode || 'infrastruktur' : 'zeitlimit' };
  }
  if (kandidaten === 0) return { http: 200, result: 'no_urls' };
  const nurAbruffehler = (antworten, fehler) => antworten === 0 && fehler > 0;
  const gesperrt = typeof belegteKandidaten === 'number' && belegteKandidaten > 0
    ? nurAbruffehler(belegteBeantwortet, belegteAbrufFehler)
    : nurAbruffehler(beantwortet, abrufFehler);
  if (gesperrt) {
    const fehler = new FetchUnavailableError(`Alle ${abrufFehler} Seitenabrufe gescheitert (403/429/5xx/Zeitlimit)`);
    return { http: 503, result: fehler.code, fehler: fehler.message };
  }
  return { http: 200, result: 'all_failed' };
}

module.exports = {
  leseScrapeParameter,
  kandidatErlaubt,
  normalisiereDomain,
  neuerVerbrauch,
  istRatekandidat,
  entscheideErgebnis,
};
