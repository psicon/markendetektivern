/**
 * Domain-Konfiguration für den Scraper-Resolver.
 *
 * Priorität — basierend auf 250-EAN-Audit (2026-05-17) +
 * User-Vorgaben:
 *
 *   Tier 1: Echte Shops — frische Produkt-Daten ZUERST
 *   Tier 2: OpenFoodFacts — wenn kein Shop hat, OFF als Backup
 *   Tier 3: Deutsche Lebensmittel-DBs (fddb, wikifit, etc.)
 *   Tier 4: codecheck — letzter Versuch (Long-Tail Marken)
 *
 *   product-search.net: RAUS (Quatsch laut User 2026-05-17)
 *
 * Für JEDE Domain wird IMMER per GTIN (EAN) gesucht — niemals per
 * Produkt-Name (User-Vorgabe in CLAUDE.md).
 *
 * `requiresJS: true` → Fetcher routed via Apify Playwright-Render
 * weil Page nur Client-Side-JavaScript rendert (SPA wie mytime/
 * rewe/lidl). SPAs sind selten in Google indexiert — Serper findet
 * sie nur für ~0.5-1% der EANs — aber wenn ein Treffer da ist, sind
 * die Daten frisch & korrekt (aktuelles Sortiment).
 *
 * `skipDirectStage1: true` → Wird NICHT in Stage 1 (Direct-URL)
 * versucht. OFF und Codecheck stehen so im Tier 2/4 statt direkt
 * vor allen Shops zu greifen.
 */

const SHOPS = [
  // ════════════════════════════════════════════════════════════════
  // TIER 1 — ECHTE SHOPS (User-Top-Prio: aktuelle Daten zuerst)
  // ════════════════════════════════════════════════════════════════
  //
  // Reihenfolge nach 250-EAN-Audit Coverage. requiresJS=true für
  // SPAs (mytime, lidl, rewe, etc.) — Fetcher routet via Apify.

  // ─── Server-rendered Shops (Direct HTTP fetch reicht) ────────
  // Reihenfolge nach 750-EAN-Combined-Audit-Coverage:
  { name: 'globus',                  host: 'produkte.globus.de',
    altHosts: ['www.globus.de'] },                                  // ~18% Marken ⭐
  { name: 'kaufland',                host: 'www.kaufland.de' },     // ~5%
  { name: 'atundo',                  host: 'www.atundo.com' },      // ~5%
  { name: 'clac',                    host: 'clac.de' },             // ~5%
  { name: 'depha',                   host: 'depha.eu' },            // ~4%
  { name: 'deguo',                   host: 'deguo.com.tw' },        // ~4%
  { name: 'ehgoo',                   host: 'ehgoo.de' },            // ~4%
  { name: 'worldofsweets',           host: 'www.worldofsweets.de' },// ~2% — voll mit Zutaten+Nährwerten
  { name: 'morgenmarkt',             host: 'morgenmarkt.de' },      // ~1.4% — bestätigt: GTIN + Marken
  { name: 'liefershop',              host: 'www.liefershop.de' },   // ~2%
  // ─── Manuell whitelisted aus 20-EAN-Audit 2026-05-18 ────────────
  { name: 'lebensmittelbote',        host: 'www.lebensmittelbote.com' },
  { name: 'schaeffer24',             host: 'schaeffer24.de' },
  { name: 'kleinstark',              host: 'shop.kleinstark.de' },
  { name: 'regiooutlet',             host: 'shop.regiooutlet.de' },
  { name: 'sweets-online',           host: 'sweets-online.com' },
  { name: 'fresh-store',             host: 'fresh-store.eu' },
  { name: 'piccantino',              host: 'www.piccantino.de' },   // ~1%
  { name: 'germanfoodcorner',        host: 'germanfoodcorner.de' }, // ~1% (mit Zutaten!)
  { name: 'shop.kastner',            host: 'shop.kastner.at' },     // ~1%
  { name: 'rossmann',                host: 'www.rossmann.de' },     // ~1%
  { name: 'dm',                      host: 'www.dm.de' },           // <1%
  { name: 'lebensmittel-sonderposten', host: 'www.lebensmittel-sonderposten.de' },

  // ─── Server-rendered Discounter (mit Chrome-UA serven sie HTML)
  // ─── Erkenntnis 2026-05-17: requiresJS war falsch, nur User-Agent
  // ─── war geblockt. Mit korrektem UA bekommen wir vollen HTML
  // ─── inkl. lazy-loaded Tab-Inhalten (im DOM, CSS-versteckt).
  { name: 'rewe',                    host: 'shop.rewe.de',
    altHosts: ['www.rewe.de'] },                                    // 0.9%
  { name: 'lidl',                    host: 'www.lidl.de' },         // 0.3%
  { name: 'mytime',                  host: 'www.mytime.de' },       // 0.13%
  { name: 'edeka24',                 host: 'www.edeka24.de' },      // server-rendered ✓
  { name: 'knuspr',                  host: 'www.knuspr.de' },       // server-rendered ✓
  { name: 'gurkerl',                 host: 'www.gurkerl.at' },      // server-rendered ✓
  { name: 'billa',                   host: 'www.billa.at',
    altHosts: ['shop.billa.at'] },                                  // server-rendered ✓

  // ─── ECHTE SPAs — brauchen Apify JS-Render ───────────────────
  // (mit Chrome-UA testen ergibt <10k bytes leeres Skelett — kein
  // Server-Side-Rendering der Produktdaten. Apify ist hier Pflicht.)
  { name: 'mein-aldi',  host: 'www.mein-aldi.de',     requiresJS: true },
  { name: 'metro',      host: 'www.metro.de',         requiresJS: true },
  { name: 'aldi-nord',  host: 'www.aldi-nord.de',     requiresJS: true },
  { name: 'edeka',      host: 'www.edeka.de',         requiresJS: true },
  { name: 'penny',      host: 'www.penny.de',         requiresJS: true },
  { name: 'netto-online', host: 'www.netto-online.de', requiresJS: true },
  { name: 'interspar',  host: 'www.interspar.at',     requiresJS: true },
  { name: 'spar',       host: 'www.spar.at',          requiresJS: true },
  { name: 'hofer',      host: 'www.hofer.at',         requiresJS: true },
  { name: 'roksh',      host: 'www.roksh.at',         requiresJS: true },

  // ════════════════════════════════════════════════════════════════
  // TIER 2 — OpenFoodFacts (User-Vorgabe: Shops zuerst, OF danach)
  // ════════════════════════════════════════════════════════════════
  // Massiv coverage (~80% kombiniert) aber crowdsourced & evtl.
  // veraltet. Daher NICHT in Stage 1 (skipDirectStage1).
  {
    name: 'openfoodfacts',
    host: 'de.openfoodfacts.org',
    altHosts: [
      'world.openfoodfacts.org',
      'at.openfoodfacts.org',
      'ch.openfoodfacts.org',
      'fr.openfoodfacts.org',
      'es.openfoodfacts.org',
      'it.openfoodfacts.org',
      'ie-ga.openfoodfacts.org',
      'es-gl.openfoodfacts.org',
      'es-ca.openfoodfacts.org',
      'be-fr.openfoodfacts.org',
      'ch-fr.openfoodfacts.org',
      'ch-it.openfoodfacts.org',
      'openfoodfacts.org',
    ],
    directUrl: (ean) =>
      `https://de.openfoodfacts.org/produkt/${encodeURIComponent(ean)}`,
    skipDirectStage1: true,
  },

  // ════════════════════════════════════════════════════════════════
  // TIER 3 — Deutsche Lebensmittel-Datenbanken (nach OF, User-Vorgabe)
  // ════════════════════════════════════════════════════════════════
  // Lebensmittel-Datenbanken — Nährwerte/Zutaten trustworthy, ABER
  // KEIN Preis übernehmen (DBs sind keine Verkaufsstellen, Preise
  // dort sind veraltet/erfunden). User-Vorgabe 2026-05-19.
  { name: 'fddb',             host: 'fddb.info',           noPriceTrust: true }, // 8.8%
  { name: 'wikifit',          host: 'wikifit.de',          noPriceTrust: true }, // 8.8%
  { name: 'opengtindb',       host: 'opengtindb.org',      noPriceTrust: true }, // 4.8%
  { name: 'ohnegentechnik',   host: 'www.ohnegentechnik.org', noPriceTrust: true }, // 4.8% Bio-DB
  { name: 'das-ist-drin',     host: 'das-ist-drin.de',     noPriceTrust: true }, // 3.6%
  { name: 'digit-eyes',       host: 'www.digit-eyes.com',  noPriceTrust: true }, // 3.2%
  { name: 'ecoinform',        host: 'www.ecoinform.de',    noPriceTrust: true }, // 2.4% Bio

  // ════════════════════════════════════════════════════════════════
  // TIER 4 — Codecheck (User-Vorgabe: zurückstellen, letzter Versuch)
  // ════════════════════════════════════════════════════════════════
  {
    name: 'codecheck',
    host: 'www.codecheck.info',
    directUrl: (ean) =>
      `https://www.codecheck.info/product.search?q=${encodeURIComponent(ean)}`,
    noPriceTrust: true,
    /** Auch wenn directUrl da ist — nicht in Stage 1, damit erst
     *  Shops + OF + DE LM-DBs probiert werden. Greift nur wenn alle
     *  vorherigen failen (= bei sehr obskuren Long-Tail-Produkten). */
    skipDirectStage1: true,
  },

  // ════════════════════════════════════════════════════════════════
  // TIER 5 — Preis-Aggregatoren (User-Vorgabe 2026-05-19: ganz nach
  // hinten, nur Preis trusten, Zutaten/Nährwerte werden gedroppt)
  // ════════════════════════════════════════════════════════════════
  // Diese Sites listen Angebote von echten Shops, haben aber meist
  // KEINE Zutaten/Nährwerte. Sie sind Preis-Quellen für den
  // Long-Tail wo echte Shops nichts liefern.
  { name: 'discounto',        host: 'www.discounto.de',    priceOnly: true }, // 1.2%

  // RAUS (User-Entscheidung 2026-05-17): product-search.net
];

// ════════════════════════════════════════════════════════════════
// BLACKLIST — Domains die wir NIE versuchen (Müll/Auktionen/Spam)
// ════════════════════════════════════════════════════════════════
// Lernung aus 750-EAN-Audit (2026-05-17): viele Auktion-/Marketplace-
// Sites kommen häufig in Serper-Hits, haben aber unzuverlässige
// Daten (alte/falsche Bilder, Marketplace-Sellers mit unklaren
// Quellen). Explizit blocken statt durchlassen.
const BLACKLIST = new Set([
  // Auktion-/Marketplace
  'ebay.de', 'ebay.com', 'ebay.co.uk', 'ebay.it', 'ebay.at',
  'amazon.de', 'amazon.com', 'amazon.sg', 'amazon.co.uk',
  'hood.de', 'allegro.pl', 'allegro.sk', 'allegro.cz',
  'mynetfair.com', 'm.mynetfair.com', 'myntra.com', 'trendyol.com',
  'kespro.com', 'rozetka.com.ua', 'prom.ua', 'shein.com', 'us.shein.com',
  'voghion.com', 'm.voghion.com', 'discogs.com', 'overstock.com',
  'autodoc.de', 'autodoc.com', 'autodoc.fr', 'bestbuy.com',

  // Junk/Spam
  'mustakshif.com', 'prices.nedostavka.net', 'mega-einkaufsparadies.de',
  'mega-b2bshop.de', 'lebenslust.sg', 'lebenslust.ae',
  'thefreshmarketdubai.com', 'ducem.ae', 'best-before.co.za',
  'worldcart.co.za', 'super99.com', 'jollygrocer.co.uk',
  'service-online.su', '136.243.61.124', 'www-.opengtindb.org',
  'ww.w.opengtindb.org', 'cardealpage.com', 'bigshopper.de',
  'gebrauchtmaschinen.de', 'maschinensucher.at', 'forstinger.com',
  'weyland.at', 'editorialist.com', 'us.vestiairecollective.com',
  'savorsnackshop.com', 'balsamicint.com', 'multimediastore.ch',
  'mycaferia.at', 'universalconcept.be', 'gastmesse.at',
  'foodstore.one', 'austriansupermarket.com', 'mercator.direct',
  'gutenmarket.pl', 'thanopoulos.gr', 'simplygourmand.com',
  'tops.co.th', 'kismetsarkuteri.com', 'sweet-factory.com.ua',
  'olammarket.com.ua', 'deguo.com.tw',  // TW-Reseller, unzuverlässig

  // Wissenschaft / Datenbanken die NICHTS mit Lebensmitteln zu tun haben
  'pubmed.ncbi.nlm.nih.gov', 'nvd.nist.gov', 'apps.dtic.mil',
  'govinfo.gov', 'digital.library.unt.edu', 'aviationweek.com',
  'exchange.xforce.ibmcloud.com', 'plos.figshare.com',
  'springermedizin.de', 'dgv.tcag.ca', 'momaps1.org',
  'osu.ppy.sh', 'plus-legacy.cobiss.net', 'beratrail.io',
  'bloaty.io', 'talents.studysmarter.de', 'dejure.org',
  'commons.wikimedia.org', 'cellpeoplesecret.z6.web.core.windows.net',
  'portalvhdszpw30pbh6c7nc.blob.core.windows.net',
  'etc.blockscout.com', 'explorer.chiliz.com',

  // Stock-Images / PDFs (nicht relevant für Lebensmittel-Daten)
  'vecteezy.com', 'de.vecteezy.com', 'dreamstime.com',
  'de.dreamstime.com', 'yumpu.com', 'scribd.com', 'es.scribd.com',
  'de.scribd.com', 'github.com',

  // Social Media
  'facebook.com', 'm.facebook.com', 'instagram.com', 'twitter.com',
  'x.com', 'youtube.com', 'reddit.com', 'open.spotify.com',
  'z-sopbjaam.blogspot.com', 'tiktok.com', 'pinterest.com',
  'pinterest.de',

  // Diät-Apps / Diet-Tracker (oft outdated user-generated)
  'sanufy.de', 'myrealfood.app', 'buffcoach.net',
  'trashpandaapp.com', 'pantrist.app', 'chompthis.com',
  'buycott.com', 'icheck.vn', 'halalcheck.net',
  'kaloriendb.de', // de-LM-DB aber oft veraltet/widersprüchlich

  // International Marketplaces / Foren
  'allegro.pl', 'allegro.sk', 'allegro.cz', 'cenoteka.rs',
  'ferpotravina.cz', 'cijene.hr', 'kaufland.hr',
  'namirnice.koreqt.hr', 'usporedicijene.com',
  'tamdaexpress.eu', 'bonavita.cz', 'bimart.cz', 'dathang.eu',
  'thamhaplus.cz', 'fitboy.cz', 'b2b.korunapb.cz', 'ulovkafe.cz',
  'kuplepsze.pl', 'crosstribution.de', 'aachen-shoppt-smart.de',
  'aachen-bringts.de',  // 5% audit, aber Marken-Info ohne Nährwerte

  // Spezial-Auktion / Restposten
  'bid.cars', 'hkjunkcall.com', 'picclick.de', 'incibeauty.com',
  '180.dk', 'krak.dk', 'proff.dk', 'clickandcollect.scandipark.dk',
  'deutschermarkt.ro', 'foodrepo.org',
  // Lidl-International (nicht DE-Daten)
  'lidl.com', 'lidl.ie', 'lidl.fr', 'lidl.it', 'lidl.es',
]);

/** Prüft ob eine Domain auf der Blacklist steht (auch mit www.). */
function isBlacklisted(host) {
  if (!host) return false;
  const bare = host.replace(/^www\./, '');
  return BLACKLIST.has(host) || BLACKLIST.has(bare);
}

/** Quality-Check für Page-Content vor Claude-Call.
 *  3 Bedingungen — alle müssen erfüllt sein:
 *   1. HTML enthält die exakte EAN (= echte Produkt-Page)
 *   2. HTML enthält mind. 1 Nährwert/Zutaten-Keyword
 *   3. HTML > 3KB (nicht leeres SPA-Skelett / 404-Stub)
 *  Wenn alle drei OK → wahrscheinlich verwertbar, Claude-Token wert.
 */
function isPageGoodCandidate(html, ean) {
  if (!html || typeof html !== 'string') return false;
  if (html.length < 3000) return false;
  if (!ean || !html.includes(String(ean))) return false;
  // Lowercase-Match weil Quality-Detection Case-Insensitive sein muss
  const lower = html.toLowerCase();
  const hasNutritionKw =
    lower.includes('zutaten') ||
    lower.includes('nährwert') ||
    lower.includes('naehrwert') ||
    lower.includes('brennwert') ||
    lower.includes('kcal') ||
    lower.includes(' kj ') ||
    lower.includes('fettsäuren') ||
    lower.includes('inhaltsstoff');
  return hasNutritionKw;
}

/** Liefert die Shop-Konfig in Reihenfolge. */
function getShopsInPriorityOrder() {
  return SHOPS.slice();
}

/** Sucht in einer URL den passenden Shop-Eintrag — nach Host-Match.
 *  Berücksichtigt `altHosts` damit Subdomains wie world.openfoodfacts.org
 *  auch matchen. */
function findShopByUrl(url) {
  if (!url) return null;
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  for (const s of SHOPS) {
    const hosts = [s.host, ...(s.altHosts || [])];
    for (const h of hosts) {
      const bare = h.replace(/^www\./, '');
      if (host === h || host === bare || host.endsWith('.' + bare)) {
        return s;
      }
    }
  }
  return null;
}

/** Findet den Prio-Index eines Shops (kleiner = besser). MAX_INT für
 *  Unbekannte. */
function getShopPriority(shopName) {
  const idx = SHOPS.findIndex((s) => s.name === shopName);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

// ════════════════════════════════════════════════════════════════
// AUTO-WHITELIST — dynamisch aus Telemetrie geladen
// ════════════════════════════════════════════════════════════════
// Schwellen:
//   - successCount >= 3 AND avgConfidence >= 0.7  → auto-whitelist
//   - failCount >= 5 && successCount == 0         → temp blacklist (24h)
//   - failCount >= 20 && successCount == 0        → permanent blacklist
//
// Cache: 5 Minuten TTL — danach Reload aus Firestore. Damit
// Cold-Starts der CF nicht jedes Mal Firestore-Calls machen.

const AUTO_PROMOTE_MIN_SUCCESS = 3;
const AUTO_PROMOTE_MIN_AVG_CONF = 0.7;
const AUTO_DEMOTE_MIN_FAIL = 5;
const PERM_DEMOTE_MIN_FAIL = 20;
const CACHE_TTL_MS = 5 * 60 * 1000;

let _cache = null; // { ts, whitelist: Map<host, prio>, blacklist: Set<host> }

/** Lädt Auto-Whitelist + temp-Blacklist aus Telemetrie. Cached 5min. */
async function loadAutoLists(db) {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache;

  const whitelist = new Map(); // host → prio (lower = better)
  const blacklist = new Set();
  try {
    const snap = await db.collection('nutritionscrape_telemetry').get();
    for (const d of snap.docs) {
      const x = d.data() || {};
      const host = x.shop;
      if (!host || typeof host !== 'string') continue;
      // Skip wenn schon static whitelisted oder blacklisted
      if (isBlacklisted(host)) continue;
      const isInStaticWhitelist = SHOPS.some((s) => {
        const hosts = [s.host, ...(s.altHosts || [])];
        return hosts.some((h) => h === host || h.replace(/^www\./, '') === host);
      });
      if (isInStaticWhitelist) continue;

      const sc = x.successCount ?? 0;
      const fc = x.failCount ?? 0;
      const avg = x.avgConfidence ?? 0;

      if (sc >= AUTO_PROMOTE_MIN_SUCCESS && avg >= AUTO_PROMOTE_MIN_AVG_CONF) {
        // Promotion-Prio: 1000 + (1 - confidence). Lower prio = better.
        // Plus successCount-Bonus damit häufige Erfolger weiter vorne sind.
        const prio = 1000 - Math.min(sc, 50) * 5 + Math.round((1 - avg) * 50);
        whitelist.set(host, prio);
      } else if (sc === 0 && fc >= AUTO_DEMOTE_MIN_FAIL) {
        // Temp- oder Permanent-Blacklist
        // (für jetzt: einfach blacklisten — könnte mit 24h-TTL erweitert werden)
        blacklist.add(host);
      }
    }
  } catch (e) {
    console.warn('[domains] auto-list load failed:', e?.message);
  }

  _cache = { ts: Date.now(), whitelist, blacklist };
  console.log(
    `[domains] auto-lists loaded: ${whitelist.size} promoted, ${blacklist.size} demoted`,
  );
  return _cache;
}

/** Wie findShopByUrl, aber checked auch die dynamische Auto-Whitelist. */
async function findShopByUrlDynamic(url, db) {
  const fromStatic = findShopByUrl(url);
  if (fromStatic) return fromStatic;
  if (!db) return null;
  const { whitelist } = await loadAutoLists(db);
  let host;
  try {
    host = new URL(url).host.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (whitelist.has(host)) {
    return { name: host, host, autoPromoted: true, priority: whitelist.get(host) };
  }
  return null;
}

/** Erweiterter isBlacklisted-Check der auch Auto-Demoted Hosts erfasst. */
async function isBlacklistedDynamic(host, db) {
  if (isBlacklisted(host)) return true;
  if (!db) return false;
  const { blacklist } = await loadAutoLists(db);
  const bare = (host || '').replace(/^www\./, '');
  return blacklist.has(bare);
}

module.exports = {
  SHOPS,
  BLACKLIST,
  isBlacklisted,
  isPageGoodCandidate,
  getShopsInPriorityOrder,
  findShopByUrl,
  getShopPriority,
  // Dynamisch (Auto-Promote/Demote)
  loadAutoLists,
  findShopByUrlDynamic,
  isBlacklistedDynamic,
};
