/**
 * EAN → URL(s) Resolver mit Shop-Priorität.
 *
 * Suche IMMER per GTIN (EAN), niemals per Produkt-Name. User-Vorgabe
 * 2026-05-17.
 *
 * Reihenfolge (1. Treffer wins):
 *   1. Direct-URL-Patterns für Shops die deterministische EAN-URLs
 *      haben (codecheck, product-search.net)
 *   2. Serper.dev Google-Search über EAN. Resultate werden nach
 *      unseren 11 Shop-Domains GEFILTERT und gemäß `SHOPS`-Prio aus
 *      `domains.js` SORTIERT (codecheck > product-search > metro >
 *      globus > mein-aldi > knuspr > mytime > liefershop > gurkerl
 *      > interspar > roksh).
 *
 * Historie: Vorher Vertex AI Search, das aber den Google-Snippet-
 * Index nutzt der EANs nicht als searchable Text führt → 0 Treffer.
 * Serper macht echte google.com-Searches und liefert was der User
 * auch im Browser sieht.
 *
 * Wenn Serper nicht konfiguriert ist (API-Key fehlt), wird nur
 * Direct-URL-Pfad genutzt. Codecheck allein deckt einen großen
 * Teil ab.
 */

const {
  getShopsInPriorityOrder,
  findShopByUrl,
  getShopPriority,
  isBlacklisted,
  loadAutoLists,
  SHOPS,
} = require('./domains');
const { searchByEan } = require('./serperSearch');
const { kandidatErlaubt } = require('./anfrage');
const admin = require('firebase-admin');

/** Stage 1: Direct URL patterns für Shops MIT direct URL und
 *  OHNE skipDirectStage1 flag. Returnt eine Liste in
 *  Prio-Reihenfolge. */
function resolveDirectUrls(ean) {
  if (!ean) return [];
  const urls = [];
  for (const shop of getShopsInPriorityOrder()) {
    if (shop.skipDirectStage1) continue;
    if (typeof shop.directUrl === 'function') {
      try {
        const u = shop.directUrl(ean);
        if (typeof u === 'string' && u.startsWith('http')) {
          urls.push({
            url: u,
            source: 'direct',
            shop: shop.name,
            requiresJS: !!shop.requiresJS,
            noPriceTrust: !!shop.noPriceTrust,
            priceOnly: !!shop.priceOnly,
          });
        }
      } catch (e) {
        console.warn(`[resolver] ${shop.name}.directUrl threw:`, e?.message);
      }
    }
  }
  return urls;
}

/** Stage 3: Fallback Direct URLs für Shops MIT directUrl UND
 *  skipDirectStage1=true (codecheck, openfoodfacts). Diese werden
 *  als ALLERLETZTE Kandidaten angehängt, damit echte Shop-Daten
 *  via Serper zuerst dran kommen. Falls aber gar nichts gefunden
 *  wird, ist hier der Final-Fallback. */
function resolveFallbackDirectUrls(ean) {
  if (!ean) return [];
  const urls = [];
  for (const shop of getShopsInPriorityOrder()) {
    if (!shop.skipDirectStage1) continue;
    if (typeof shop.directUrl === 'function') {
      try {
        const u = shop.directUrl(ean);
        if (typeof u === 'string' && u.startsWith('http')) {
          urls.push({
            url: u,
            source: 'fallback',
            shop: shop.name,
            requiresJS: !!shop.requiresJS,
            noPriceTrust: !!shop.noPriceTrust,
            priceOnly: !!shop.priceOnly,
          });
        }
      } catch (e) {
        console.warn(`[resolver] ${shop.name}.directUrl threw:`, e?.message);
      }
    }
  }
  return urls;
}

/** Ordnet EINE Adresse ein (Serper-Treffer oder bevorzugteUrl):
 *   - Blacklisted (statisch oder Auto-Demote): null
 *   - Whitelisted Shops: Prio nach SHOPS-Order (0..N)
 *   - Auto-Promoted (Telemetrie): Prio aus der Telemetrie
 *   - Unknown: Prio 2000 (= NACH Whitelist, VOR priceOnly), mit
 *     `requiresQualityCheck=true` (EAN+Keyword in der Seite prüfen, bevor
 *     Token verbrannt werden) und `noPriceTrust=true` (User-Vorgabe
 *     2026-05-19: "Preis nur von offiziellen und bekannten Shops"). */
function annotiereUrl(link, auto, quelle = 'serper') {
  let host;
  try {
    host = new URL(link).host;
  } catch {
    return null;
  }
  const hostBare = host.replace(/^www\./, '');
  // Schritt 1: Static-Blacklist → komplett raus
  if (isBlacklisted(host)) return null;
  // Schritt 2: Auto-Demote-Blacklist → komplett raus
  if (auto.blacklist.has(hostBare)) return null;
  // Schritt 3: Static-Whitelist (manuelle SHOPS-Liste)
  const shop = findShopByUrl(link);
  if (shop) {
    // priceOnly-Shops bekommen Prio 3000+ (NACH unknown) damit sie
    // nur greifen wenn echte Shops + DBs nichts geliefert haben.
    // noPriceTrust ist eine reine Trust-Annotation (Prio unverändert).
    const basePrio = getShopPriority(shop.name);
    return {
      url: link,
      source: quelle,
      shop: shop.name,
      requiresJS: !!shop.requiresJS,
      requiresQualityCheck: false,
      noPriceTrust: !!shop.noPriceTrust,
      priceOnly: !!shop.priceOnly,
      priority: shop.priceOnly ? 3000 + basePrio : basePrio,
    };
  }
  // Schritt 4: Auto-Promoted (Telemetrie successCount>=3, avgConf>=0.7)
  if (auto.whitelist.has(hostBare)) {
    return {
      url: link,
      source: quelle === 'serper' ? 'serper-auto' : quelle,
      shop: hostBare,
      requiresJS: false,
      requiresQualityCheck: false, // auto-promoted = trust
      noPriceTrust: false,
      priceOnly: false,
      priority: auto.whitelist.get(hostBare), // prio aus telemetrie
    };
  }
  // Schritt 5: Unknown → durchlassen mit Quality-Check-Flag.
  return {
    url: link,
    source: quelle === 'serper' ? 'serper-unknown' : quelle,
    shop: hostBare,
    requiresJS: false,
    requiresQualityCheck: true,
    noPriceTrust: true,
    priceOnly: false,
    priority: 2000,
  };
}

async function ladeAutoListen() {
  const db = admin.firestore();
  return loadAutoLists(db).catch(() => ({ whitelist: new Map(), blacklist: new Set() }));
}

function ohnePrio({ url, source, shop, requiresJS, requiresQualityCheck, noPriceTrust, priceOnly }) {
  return { url, source, shop, requiresJS, requiresQualityCheck, noPriceTrust, priceOnly };
}

/** Stage 2: Serper.dev Google-Search per EAN, Treffer nach annotiereUrl
 *  eingeordnet und sortiert. */
async function resolveSerper(ean, { apiKey, verbrauch = null } = {}) {
  if (!ean || !apiKey) return [];
  const hits = await searchByEan({ ean, apiKey });
  if (verbrauch) verbrauch.serperSuchen = (verbrauch.serperSuchen || 0) + 1;
  if (hits.length === 0) return [];

  // Lade Auto-Whitelist + Auto-Blacklist (5min cached)
  const auto = await ladeAutoListen();
  const annotated = hits.map((h) => annotiereUrl(h.link, auto)).filter(Boolean);
  annotated.sort((a, b) => a.priority - b.priority);
  return annotated.map(ohnePrio);
}

/** Kandidat für eine bekannte Adresse (bevorzugteUrl beim Auffrischen,
 *  scrapeSingleUrl) — dieselbe Einordnung wie ein Serper-Treffer, ohne Suche.
 *  null, wenn die Adresse ungültig, gesperrt oder im Auftrag nicht erlaubt ist. */
async function kandidatFuerUrl(url, { filter = {} } = {}) {
  if (!url || !kandidatErlaubt(url, filter)) return null;
  const auto = await ladeAutoListen();
  const k = annotiereUrl(url, auto, 'bevorzugt');
  return k ? ohnePrio(k) : null;
}

/** Hauptfunktion. Sammelt URL-Kandidaten in Prio-Reihenfolge.
 *  Dedupliziert. `ohneOpenFoodFacts`/`nurDomains` filtern alle drei Stufen
 *  (src/anfrage.js); ohne sie bleibt das Verhalten wie bisher (scrapeBatch). */
async function resolveCandidates(eans, { serper, ohneOpenFoodFacts = false, nurDomains = null, verbrauch = null } = {}) {
  if (!Array.isArray(eans) || eans.length === 0) return [];
  const filter = { ohneOpenFoodFacts, nurDomains };
  const seen = new Set();
  const out = [];
  const add = (entry) => {
    if (!entry?.url) return;
    if (seen.has(entry.url)) return;
    if (!kandidatErlaubt(entry.url, filter)) return;
    seen.add(entry.url);
    out.push(entry);
  };

  for (const ean of eans) {
    // Stage 1: Direct URLs für Shops MIT direct URL und OHNE skip-Flag
    // (aktuell: keine, alle haben skip oder kein direct)
    for (const entry of resolveDirectUrls(ean)) add(entry);

    // Stage 2: Serper Google-Search → echte Shop-Treffer, sortiert
    // nach Prio-Liste (Globus, Kaufland, etc. zuerst, OF als #21,
    // DE-LM-DBs danach, codecheck als letztes)
    if (serper?.apiKey) {
      const hits = await resolveSerper(ean, { apiKey: serper.apiKey, verbrauch });
      for (const entry of hits) add(entry);
    }

    // Stage 3: Fallback Direct URLs (codecheck + OpenFoodFacts) —
    // werden nur probiert wenn Serper-Hits aus Stage 2 alle failen
    // (im scraper-Loop). Reihenfolge gemäß SHOPS-Prio.
    for (const entry of resolveFallbackDirectUrls(ean)) add(entry);
  }

  return out;
}

module.exports = {
  resolveDirectUrls,
  resolveSerper,
  resolveCandidates,
  kandidatFuerUrl,
  annotiereUrl,
  SHOPS,
};
