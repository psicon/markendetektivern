/**
 * EAN → URL(s) Resolver.
 *
 * Verschiedene Resolver-Stufen in Reihenfolge:
 *   1. Direkter Lookup auf bekannten EAN-Lookup-Sites (codecheck.info)
 *   2. Google Custom Search Engine (CSE) — sucht "<ean> Zutaten Nährwerte"
 *   3. Discounter-spezifische URL-Patterns (falls Slug bekannt)
 *   4. Hersteller-Website (falls verlinkt)
 *
 * Sprint-3-Anfangs-Stand:
 *   - resolveCodecheck:   IMPLEMENTIERT (deterministische URL)
 *   - resolveGoogleCSE:   STUB — braucht GOOGLE_CSE_API_KEY + CSE_ID
 *   - resolveDiscounter:  STUB — kann später durch Hand-pflege erweitert werden
 *
 * Returnt: Array von URL-Strings, in Reihenfolge der Vertrauens-Quality.
 * Scraper probiert jede der URLs durch (mit Throttle) bis ein
 * Extractor-Hit kommt oder Liste leer ist.
 */

/** Codecheck.info — deterministische Such-URL mit EAN-Param.
 *  Liefert eine Search-Result-Seite, die meist direkt zum Produkt
 *  weiterleitet. Funktioniert für viele DE-Produkte gut. */
function resolveCodecheck(ean) {
  if (!ean) return [];
  // Codecheck unterstützt direkte EAN-Suche via search.
  return [`https://www.codecheck.info/product.search?q=${encodeURIComponent(ean)}`];
}

/** Google Custom Search Engine — sucht den EAN + Kontext-Wörter,
 *  liefert Top-N Result-URLs. Erfordert GOOGLE_CSE_API_KEY und
 *  GOOGLE_CSE_ID (functions.config().google.cse_key + google.cse_id).
 *
 *  Aktuell STUB. Kosten: $5/1000 Queries (free tier 100/Tag). */
async function resolveGoogleCSE(ean, { apiKey, cseId, productName = null } = {}) {
  if (!apiKey || !cseId) return [];
  const query = productName
    ? `${ean} ${productName} Zutaten Nährwerte`
    : `${ean} Zutaten Nährwerte`;
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&num=5`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      console.warn('[resolver] CSE error:', resp.status);
      return [];
    }
    const json = await resp.json();
    return (json.items || [])
      .map((it) => it.link)
      .filter((u) => typeof u === 'string' && u.startsWith('http'));
  } catch (e) {
    console.warn('[resolver] CSE threw:', e?.message);
    return [];
  }
}

/** Discounter-spezifische URL-Patterns. Wenn wir den Slug eines
 *  Produkts kennen (z.B. von Algolia), könnten wir die direkte URL
 *  konstruieren. Sprint 3 fängt mit leerer Liste an — pflegbar
 *  später wenn Slugs verfügbar werden. */
function resolveDiscounter(_product) {
  // Beispiel-Patterns (auskommentiert — Slug-Mapping nötig):
  // - Aldi:  https://www.aldi-sued.de/de/produkte/<slug>.html
  // - Lidl:  https://www.lidl.de/p/<slug>/p<productId>
  // - Penny: https://www.penny.de/produkte/<slug>
  return [];
}

/** Hauptfunktion: alle EAN-Kandidaten durch alle Resolver-Stufen.
 *  Returnt deduplizierte URL-Liste. */
async function resolveCandidates(eans, { product, googleCse } = {}) {
  if (!Array.isArray(eans) || eans.length === 0) return [];
  const urls = [];
  const seen = new Set();
  const add = (u) => {
    if (typeof u !== 'string') return;
    if (seen.has(u)) return;
    seen.add(u);
    urls.push(u);
  };

  // Pro EAN alle Resolver durchlaufen
  for (const ean of eans) {
    for (const u of resolveCodecheck(ean)) add(u);
    if (googleCse) {
      const cseUrls = await resolveGoogleCSE(ean, {
        apiKey: googleCse.apiKey,
        cseId: googleCse.cseId,
        productName: product?.name,
      });
      for (const u of cseUrls) add(u);
    }
  }

  // Discounter-Patterns nutzen das ganze Produkt (für slug etc.)
  for (const u of resolveDiscounter(product)) add(u);

  return urls;
}

module.exports = {
  resolveCodecheck,
  resolveGoogleCSE,
  resolveDiscounter,
  resolveCandidates,
};
