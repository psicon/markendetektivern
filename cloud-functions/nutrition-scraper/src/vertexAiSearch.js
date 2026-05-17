/**
 * Vertex AI Search Adapter.
 *
 * Cloud Custom Search JSON API ist für Neukunden nicht mehr verfügbar
 * (Google-Hinweis Mai 2026). Vertex AI Search ist der empfohlene
 * Nachfolger — bis 50 Domains, gleicher Use-Case.
 *
 * Setup (User-Side, einmalig):
 *   1. Enable: gcloud services enable discoveryengine.googleapis.com
 *   2. Console: cloud.google.com → AI Applications → Search Apps
 *      Create Search App with Generic-Industry + Web-Datastore
 *      Datasource: add the 11 domains from domains.js as "Sites I provide"
 *      Wait for indexing (~24h after add)
 *   3. Note: dataStoreId + location (z.B. "global" oder "eu")
 *   4. Set Secrets:
 *      gcloud secrets create VERTEX_AI_SEARCH_DATASTORE_ID --data-file=-
 *      gcloud secrets create VERTEX_AI_SEARCH_LOCATION --data-file=-
 *   5. Grant Function-Service-Account die Rolle
 *      "Discovery Engine Editor" (oder Viewer minimal)
 *
 * Auth: Application Default Credentials (CF SA hat per default Zugriff
 * wenn IAM-Role gesetzt).
 *
 * Kosten: ~$1.50 / 1000 queries.
 */

const { GoogleAuth } = require('google-auth-library');

const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  'markendetektive-895f7';

let _auth = null;
function getAuth() {
  if (!_auth) {
    _auth = new GoogleAuth({
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
    });
  }
  return _auth;
}

/** Sucht via Vertex AI Search. Returnt Liste von { link, title,
 *  snippet }. Bei Config-Fehler oder API-Error: leeres Array. */
async function searchByEan({ ean, dataStoreId, location = 'global', pageSize = 10 }) {
  if (!ean || !dataStoreId) return [];

  // Vertex AI Search v1alpha Endpoint
  // location 'global' nutzt globale Endpunkt; sonst region-spezifisch.
  const host =
    location === 'global'
      ? 'discoveryengine.googleapis.com'
      : `${location}-discoveryengine.googleapis.com`;
  const url = `https://${host}/v1alpha/projects/${PROJECT_ID}/locations/${location}/dataStores/${dataStoreId}/servingConfigs/default_search:search`;

  let token;
  try {
    const client = await getAuth().getClient();
    const tokenResp = await client.getAccessToken();
    token = tokenResp?.token || tokenResp;
  } catch (e) {
    console.warn('[vertexAiSearch] auth failed:', e?.message);
    return [];
  }

  const body = {
    query: String(ean),
    pageSize,
    // Spell-correct nicht nötig für EANs (numerisch)
    spellCorrectionSpec: { mode: 'OFF' },
    // Snippets damit wir bei Match-Quality entscheiden können
    contentSearchSpec: {
      snippetSpec: { returnSnippet: true },
    },
  };

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.warn('[vertexAiSearch] fetch error:', e?.message);
    return [];
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    console.warn(
      `[vertexAiSearch] HTTP ${resp.status}: ${txt.slice(0, 200)}`,
    );
    return [];
  }

  let json;
  try {
    json = await resp.json();
  } catch {
    return [];
  }

  const results = json.results || [];
  return results
    .map((r) => {
      const doc = r.document || {};
      const sd = doc.derivedStructData || doc.structData || {};
      const link = sd.link || sd.htmlFormattedUrl || doc.uri || null;
      const title = sd.title || null;
      const snippet =
        sd.snippets?.[0]?.snippet ?? sd.snippet ?? null;
      return link ? { link, title, snippet } : null;
    })
    .filter(Boolean);
}

module.exports = { searchByEan };
