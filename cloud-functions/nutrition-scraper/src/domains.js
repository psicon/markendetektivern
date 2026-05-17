/**
 * Domain-Konfiguration für den Scraper-Resolver.
 *
 * Priorität (1. Treffer wins):
 *   1. codecheck.info        — dedizierter EAN-Lookup, deterministische URL
 *   2. product-search.net    — EAN-direkter Lookup-Service
 *   3. metro.de
 *   4. globus.de
 *   5. mein-aldi.de
 *   6. knuspr.de
 *   7. mytime.de
 *   8. liefershop.de
 *   9. gurkerl.at
 *  10. interspar.at
 *  11. roksh.at
 *
 * Für JEDE Domain wird IMMER per GTIN (EAN) gesucht — niemals per
 * Produkt-Name. Wenn Vertex AI Search konfiguriert ist, durchsuchen
 * wir alle Domains in einem Call und filtern Resultate gemäß
 * Prio-Reihenfolge. Domains mit `directUrl(ean)`-Pattern (codecheck,
 * product-search) werden zusätzlich direkt versucht ohne Search-API.
 */

const SHOPS = [
  {
    name: 'codecheck',
    host: 'www.codecheck.info',
    /** Codecheck hat eine deterministische Search-URL die direkt auf
     *  das Produkt geht (oder Search-Listing wenn mehrere). */
    directUrl: (ean) =>
      `https://www.codecheck.info/product.search?q=${encodeURIComponent(ean)}`,
  },
  {
    name: 'product-search.net',
    host: 'www.product-search.net',
    /** Dedizierter EAN-Lookup-Dienst. URL-Pattern via Search-Page. */
    directUrl: (ean) =>
      `https://www.product-search.net/?ean=${encodeURIComponent(ean)}`,
  },
  { name: 'metro',         host: 'www.metro.de'         },
  { name: 'globus',         host: 'www.globus.de'        },
  { name: 'mein-aldi',      host: 'www.mein-aldi.de'     },
  { name: 'knuspr',         host: 'www.knuspr.de'        },
  { name: 'mytime',         host: 'www.mytime.de'        },
  { name: 'liefershop',     host: 'www.liefershop.de'    },
  { name: 'gurkerl',        host: 'www.gurkerl.at'       },
  { name: 'interspar',      host: 'www.interspar.at'     },
  { name: 'roksh',          host: 'www.roksh.at'         },
];

/** Liefert die Shop-Konfig in Reihenfolge. */
function getShopsInPriorityOrder() {
  return SHOPS.slice();
}

/** Sucht in einer URL den passenden Shop-Eintrag — nach Host-Match. */
function findShopByUrl(url) {
  if (!url) return null;
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  // Match: exakt ODER subdomain-of (z.B. shop.metro.de matcht metro.de)
  return (
    SHOPS.find(
      (s) =>
        host === s.host ||
        host.endsWith('.' + s.host.replace(/^www\./, '')) ||
        host === s.host.replace(/^www\./, ''),
    ) || null
  );
}

/** Findet den Prio-Index eines Shops (kleiner = besser). MAX_INT für
 *  Unbekannte. */
function getShopPriority(shopName) {
  const idx = SHOPS.findIndex((s) => s.name === shopName);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

module.exports = {
  SHOPS,
  getShopsInPriorityOrder,
  findShopByUrl,
  getShopPriority,
};
