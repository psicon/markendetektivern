/**
 * Serper.dev Search Adapter.
 *
 * Ersatz für Vertex AI Search nachdem sich rausgestellt hat dass
 * Vertex AI "Basic Website Search" den Google-Snippet-Index nutzt,
 * der EANs NICHT als searchable Text indexiert (EANs stehen meist
 * tief in Produktdetail-Tabs, nicht im Title/Meta).
 *
 * Serper macht echte google.com-Searches via API → liefert dieselben
 * Resultate die der User in google.com sieht, inkl. Shop-Produktseiten
 * für EAN-Queries.
 *
 * Setup:
 *   1. Account auf https://serper.dev anlegen
 *   2. API-Key kopieren
 *   3. Secret setzen:
 *      echo -n "<key>" | gcloud secrets create SERPER_API_KEY \
 *        --data-file=- --project markendetektive-895f7
 *   4. Function-SA bekommt automatisch Zugriff via params.defineSecret
 *
 * Kosten:
 *   - Free-Tier: 2500 queries gratis
 *   - Starter: $50 / 50.000 queries
 *   - Pro: $375 / 500.000 queries
 *
 * Für ~8000 uncovered Produkte: ~$8 (oder Free + Starter).
 */

const SERPER_ENDPOINT = 'https://google.serper.dev/search';

/** Sucht via Serper. Returnt Liste von { link, title, snippet }.
 *  Bei Auth-Fehler / API-Error: leeres Array.
 *
 *  @param {object} args
 *  @param {string} args.ean
 *  @param {string} args.apiKey
 *  @param {number} [args.pageSize=10]
 *  @param {string} [args.gl='de']    Geo-Location: de (Deutschland) — für
 *                                    DACH-Shops am relevantesten.
 *  @param {string} [args.hl='de']    Language: deutsch.
 */
async function searchByEan({ ean, apiKey, pageSize = 10, gl = 'de', hl = 'de' }) {
  if (!ean || !apiKey) return [];

  const body = {
    q: String(ean),
    gl,
    hl,
    num: pageSize,
  };

  let resp;
  try {
    resp = await fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.warn('[serperSearch] fetch error:', e?.message);
    return [];
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    console.warn(
      `[serperSearch] HTTP ${resp.status}: ${txt.slice(0, 200)}`,
    );
    return [];
  }

  let json;
  try {
    json = await resp.json();
  } catch {
    return [];
  }

  // Serper-Response: { organic: [{ link, title, snippet, position }, ...] }
  const organic = Array.isArray(json.organic) ? json.organic : [];
  return organic
    .map((r) => {
      const link = r.link || null;
      if (!link || typeof link !== 'string' || !link.startsWith('http')) {
        return null;
      }
      return {
        link,
        title: r.title || null,
        snippet: r.snippet || null,
      };
    })
    .filter(Boolean);
}

module.exports = { searchByEan };
