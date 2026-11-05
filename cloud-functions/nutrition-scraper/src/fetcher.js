/**
 * HTML-Fetcher mit Throttle + Retry + Robots-Respect.
 *
 * - User-Agent identifizierend (best practice)
 * - 800ms Throttle pro Host (gegen Rate-Limit)
 * - 1× Retry bei 5xx / Network-Error
 * - Robots.txt: konservativ — wenn /robots.txt expliziter Block,
 *   skippen. Da wir nur einzelne Produkt-Seiten lesen (kein Crawl),
 *   ist die Wahrscheinlichkeit eines Block niedrig.
 * - Timeout: 15s pro Request
 * - Max-Size: 2MB (gegen riesige Seiten / Trap-Pages)
 *
 * Für SPA-Shops (mein-aldi.de, lidl.de, rewe.de, etc. — alle mit
 * requiresJS=true in domains.js) routet `fetchHtml` automatisch
 * über Apify's `website-content-crawler` Actor. Apify rendert die
 * Page mit Playwright/Chromium und gibt sauberes Markdown zurück
 * (oder rohes HTML wenn das nicht reicht).
 *
 * ═══ Ergebnisvertrag (seit 04.10.2026) ═══
 *   • Seite geliefert                       → { html, status, finalUrl, via }
 *     (+ apifyGescheitert: '<grund>', wenn eine dünne Seite direkt geholt
 *     wurde und das Apify-Rendern scheiterte — src/kandidat.js wertet eine
 *     solche Seite ohne EAN-Beleg als Abruffehler)
 *   • Seite gibt es nicht / nichts drin      → null  (404, robots.txt, zu groß,
 *     leere Antwort — eine Aussage über die Seite)
 *   • Seite nicht abrufbar (401/403/408/425/429, 5xx, Zeitlimit, Netz)
 *                                            → wirft SeiteNichtAbrufbarError
 *   • Apify: gescheiterter Lauf (400 run-failed, 408, 5xx …), leerer
 *     Datensatz, leeres Markdown, unlesbare Antwort
 *                                            → wirft SeiteNichtAbrufbarError
 *     (Crawlee legt für blockierte oder endgültig gescheiterte Seiten kein
 *     Element ab — „leer“ ist darum keine Aussage über das Produkt)
 *   • Apify-Konto/-Kontingent (401/402/403/429), Aktor nicht gefunden (404),
 *     kein Apify-Token                       → wirft FetchUnavailableError
 * Bis 04.10. kam auch der Abruffehler als null zurück und zählte damit wie
 * eine leere Seite (siehe src/fehler.js); bei Apify galt das bis zur
 * Prüfrunde 04.10. weiter für leere Datensätze und gescheiterte Läufe.
 */

const { FetchUnavailableError, SeiteNichtAbrufbarError, istAbrufFehlerStatus } = require('./fehler');

// Echter Chrome-User-Agent. Lernung 2026-05-17: viele Shops
// (mytime, lidl, rewe, ...) servieren mit Bot-UA nur 380-byte
// leeres SPA-Skelett, mit Chrome-UA aber 270k vollen HTML inkl.
// lazy-loaded Tab-Inhalten (Zutaten/Nährwerte sind im DOM,
// nur CSS-versteckt). Daher MUSS hier Chrome stehen.
// Backup-Identifikation via accept-Header bleibt ein freundliches
// "MarkenDetektive" damit Site-Owner uns nicht für Scraper-Spam halten.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ' +
  '(+contact: patrick@markendetektive.de; MarkenDetektive-NutritionScraper/0.2)';

const THROTTLE_PER_HOST_MS = 800;
const FETCH_TIMEOUT_MS = 15000;
const MAX_BYTES = 2 * 1024 * 1024;

const lastRequestPerHost = new Map(); // host → timestamp
const robotsCache = new Map(); // host → { allowAll: boolean, ts }
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

// Bestätigte EAN-Lookup-Domains (explizit vom User listed). Diese
// Sites haben oft "Disallow: /search" o.ä. das die generische
// robots.txt-Heuristik missdeutet. Da wir nur einzelne Produkt-Seiten
// lesen (kein Crawl) und diese Sites ihren Zweck offen kommunizieren,
// bypassen wir robots-Check für sie.
const ROBOTS_BYPASS_HOSTS = new Set([
  'www.codecheck.info',
  'codecheck.info',
  'www.product-search.net',
  'product-search.net',
  'de.openfoodfacts.org',
  'world.openfoodfacts.org',
  'openfoodfacts.org',
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** AbortSignal.timeout wirft einen DOMException 'TimeoutError'. */
function istZeitlimit(e) {
  return e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timeout/i.test(String(e?.message || ''));
}

function getHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

async function isAllowedByRobots(url) {
  const host = getHost(url);
  if (!host) return false;

  // Bypass-Liste: explizit-erlaubte EAN-Lookup-Sites.
  if (ROBOTS_BYPASS_HOSTS.has(host)) return true;

  const cached = robotsCache.get(host);
  if (cached && Date.now() - cached.ts < ROBOTS_TTL_MS) {
    return cached.allowAll;
  }
  try {
    const robotsUrl = `https://${host}/robots.txt`;
    const resp = await fetch(robotsUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      // Wenn /robots.txt nicht ladbar → konservativ ALLOW.
      robotsCache.set(host, { allowAll: true, ts: Date.now() });
      return true;
    }
    const txt = await resp.text();
    // Conservative-Heuristik: nur blocken wenn ein "User-agent: *"
    // Block AUSSCHLIESSLICH ein generelles "Disallow: /" (allein)
    // hat — kein anderes Allow/Disallow das es einschränkt. Für
    // unseren Use-Case (Einzel-Produkt-Pages lesen) ist das in den
    // meisten Fällen erlaubt.
    const lines = txt.split('\n').map((l) => l.trim().toLowerCase());
    let inStarBlock = false;
    let starBlockHasDisallowAll = false;
    let starBlockHasAllow = false;
    let starBlockHasSpecificDisallow = false;
    for (const line of lines) {
      if (line.startsWith('user-agent:')) {
        inStarBlock = line.includes('*');
        continue;
      }
      if (!inStarBlock) continue;
      if (line === 'disallow: /') starBlockHasDisallowAll = true;
      else if (line.startsWith('disallow: ') && line !== 'disallow:') {
        starBlockHasSpecificDisallow = true;
      } else if (line.startsWith('allow:')) {
        starBlockHasAllow = true;
      }
    }
    // Nur blocken wenn KOMPLETT Disallow:/ und KEIN Allow / kein
    // spezifischer Disallow (was auf gemischt erlauben-erlaubend
    // hindeutet).
    const allowAll = !(
      starBlockHasDisallowAll && !starBlockHasAllow && !starBlockHasSpecificDisallow
    );
    robotsCache.set(host, { allowAll, ts: Date.now() });
    return allowAll;
  } catch {
    // Bei Fehler conservatively allowed
    robotsCache.set(host, { allowAll: true, ts: Date.now() });
    return true;
  }
}

/** Apify-Render: holt eine SPA-Page via Playwright und gibt
 *  Markdown zurück (die KI bekommt Markdown — kleiner Prompt,
 *  weniger Tokens, gleicher Inhalt).
 *
 *  Apify-Token wird via Env oder Secret-Manager geliefert
 *  (process.env.APIFY_API_TOKEN). Fehlt er, wirft der Aufruf
 *  FetchUnavailableError: eine fehlende Einstellung betrifft jede Seite und
 *  ist keine Aussage über diese (bis 04.10. kam null = „keine Seite“). */
async function fetchViaApify(url, { apifyToken, verbrauch } = {}) {
  const token = apifyToken || process.env.APIFY_API_TOKEN;
  if (!token) {
    console.warn('[fetcher] Apify-Token fehlt, kann SPA nicht rendern:', url);
    throw new FetchUnavailableError('Apify-Token fehlt');
  }
  if (verbrauch) verbrauch.apifyAbrufe = (verbrauch.apifyAbrufe || 0) + 1;
  const apifyUrl =
    `https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(token)}&timeout=90`;

  let resp;
  try {
    resp = await fetch(apifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startUrls: [{ url }],
        maxCrawlPages: 1,
        maxCrawlDepth: 0,
        crawlerType: 'playwright:adaptive',
        saveMarkdown: true,
        saveHtml: false,
        removeCookieWarnings: true,
        clickElementsCssSelector: '[aria-label*="kzeptieren" i], [aria-label*="ccept" i]',
      }),
      signal: AbortSignal.timeout(120000), // Apify selbst kann bis 90s
    });
  } catch (e) {
    // Zeitlimit oder Netz beim Rendern DIESER Seite — kein Urteil über sie.
    console.warn(`[fetcher/apify] fetch error for ${url}:`, e?.message);
    throw new SeiteNichtAbrufbarError(url, { grund: istZeitlimit(e) ? 'apify_zeitlimit' : 'apify_netz' }, e);
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    console.warn(`[fetcher/apify] HTTP ${resp.status} for ${url}: ${txt.slice(0, 200)}`);
    // Konto-/Kontingentfehler betreffen JEDE Seite (Token ungültig, Guthaben
    // leer, gesperrt, Ratenlimit) — kein Seitenproblem, siehe src/fehler.js.
    // 404 heißt bei dieser Schnittstelle „Aktor nicht gefunden“ (der Status
    // der Zielseite steht erst im Datensatz) — ebenfalls jede Seite.
    if ([401, 402, 403, 404, 429].includes(resp.status)) {
      throw new FetchUnavailableError(`Apify HTTP ${resp.status}: ${txt.slice(0, 120)}`);
    }
    // 400 (run-failed), 408, 5xx …: der Lauf für diese Seite ist gescheitert
    // (Zeitlimit, Renderer abgestürzt) — kein Urteil über die Seite.
    throw new SeiteNichtAbrufbarError(url, { status: resp.status, grund: `apify_${resp.status}` });
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    console.warn(`[fetcher/apify] Antwort unlesbar für ${url}: ${e?.message}`);
    throw new SeiteNichtAbrufbarError(url, { grund: 'apify_antwort' }, e);
  }
  const item = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!item) {
    // Blockiert oder endgültig gescheitert: Crawlee legt dann kein Element ab.
    console.warn(`[fetcher/apify] leerer Datensatz für ${url}`);
    throw new SeiteNichtAbrufbarError(url, { grund: 'apify_leer' });
  }
  const zielStatus = item.crawl?.httpStatusCode;
  if (typeof zielStatus === 'number' && zielStatus >= 400) {
    console.log(`[fetcher/apify] ${url} → Ziel HTTP ${zielStatus}`);
    if (istAbrufFehlerStatus(zielStatus)) throw new SeiteNichtAbrufbarError(url, { status: zielStatus });
    return null; // 404/410: die Seite gibt es nicht
  }
  const md = item.markdown || item.text || '';
  if (!md || md.length < 100) {
    console.warn(`[fetcher/apify] leeres Markdown (${md.length} Zeichen) für ${url}`);
    throw new SeiteNichtAbrufbarError(url, { grund: 'apify_leer' });
  }
  // Markdown wird als "html" zurückgegeben — stripHtml ist no-op auf
  // reinem Text + erkennt Keywords genauso. Marker fürs Logging.
  return {
    html: md,
    status: item.crawl?.httpStatusCode || 200,
    finalUrl: item.crawl?.loadedUrl || url,
    via: 'apify',
  };
}

/** Throttled fetch per host. Returnt { html, status, finalUrl, via } oder
 *  null, wenn es die Seite nicht gibt / robots.txt sperrt; wirft bei
 *  Abruffehlern (Ergebnisvertrag oben). `via` ist 'direkt' oder 'apify'
 *  (dann ist `html` Markdown ohne Seitendaten wie JSON-LD).
 *  `verbrauch` (optional) zählt Seiten- und Apify-Abrufe für die Kosten.
 *
 *  Wenn `requiresJS=true` → routet automatisch via Apify (SPA-Render).
 *  Wenn direct-fetch leeren Content liefert (<1KB ODER ohne Zutaten/
 *  Nährwerte-Keywords), wird AUTOMATISCH ein Apify-Retry versucht
 *  (Apify-Fallback für unbekannte SPAs / Cloudflare-Blocks). */
async function fetchHtml(url, { skipRobots = false, requiresJS = false, apifyToken, verbrauch } = {}) {
  const host = getHost(url);
  if (!host) {
    console.warn('[fetcher] invalid URL:', url);
    return null;
  }

  // Wenn der Shop explizit JS-Rendering braucht → direkt via Apify
  if (requiresJS) {
    return await fetchViaApify(url, { apifyToken, verbrauch });
  }

  if (!skipRobots) {
    const allowed = await isAllowedByRobots(url);
    if (!allowed) {
      console.log(`[fetcher] robots.txt blocks ${host}, skip`);
      return null;
    }
  }

  // Per-Host-Throttle
  const last = lastRequestPerHost.get(host) || 0;
  const elapsed = Date.now() - last;
  if (elapsed < THROTTLE_PER_HOST_MS) {
    await sleep(THROTTLE_PER_HOST_MS - elapsed);
  }
  lastRequestPerHost.set(host, Date.now());

  const doFetch = async () => {
    if (verbrauch) verbrauch.seitenAbrufe = (verbrauch.seitenAbrufe || 0) + 1;
    return await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.5',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  };

  let resp;
  try {
    resp = await doFetch();
  } catch (e) {
    console.warn(`[fetcher] ${url} threw, retrying once:`, e?.message);
    try {
      await sleep(1000);
      resp = await doFetch();
    } catch (e2) {
      console.warn(`[fetcher] ${url} retry failed:`, e2?.message);
      throw new SeiteNichtAbrufbarError(url, { grund: istZeitlimit(e2) ? 'zeitlimit' : 'netz' }, e2);
    }
  }

  if (!resp.ok) {
    if (resp.status >= 500) {
      // 5xx → ein Retry
      try {
        await sleep(2000);
        resp = await doFetch();
      } catch (e3) {
        throw new SeiteNichtAbrufbarError(url, { grund: istZeitlimit(e3) ? 'zeitlimit' : 'netz' }, e3);
      }
    }
    if (!resp.ok) {
      console.log(`[fetcher] ${url} → HTTP ${resp.status}`);
      // 403/429/5xx … sagen nichts über das Produkt (Shop sperrt, ist
      // überlastet oder kaputt). 404/410 usw. heißen: die Seite gibt es nicht.
      if (istAbrufFehlerStatus(resp.status)) {
        throw new SeiteNichtAbrufbarError(url, { status: resp.status });
      }
      return null;
    }
  }

  // Stream-Read mit Size-Cap
  const reader = resp.body?.getReader();
  if (!reader) {
    return null;
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total > MAX_BYTES) {
        console.warn(`[fetcher] ${url} → size cap exceeded (${total}b), abort`);
        try {
          await reader.cancel();
        } catch {}
        return null;
      }
    }
  } catch (e) {
    // Verbindung brach beim Lesen ab — Abruffehler, keine leere Seite.
    console.warn(`[fetcher] ${url} read error:`, e?.message);
    throw new SeiteNichtAbrufbarError(url, { grund: istZeitlimit(e) ? 'zeitlimit' : 'netz' }, e);
  }

  // Concat + decode
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  const html = new TextDecoder('utf-8').decode(buf);

  // Smart-Fallback: wenn Direct-Fetch verdächtig kurz ist UND keine
  // relevanten Keywords drin → wahrscheinlich SPA/Cookie-Wall.
  // Auto-Retry via Apify (rendert die Page mit JS).
  const looksEmpty = html.length < 8000;
  const looksSPA =
    !/zutaten|nährwert|naehrwert|brennwert|inhaltsstoff/i.test(html);
  if (looksEmpty && looksSPA && (apifyToken || process.env.APIFY_API_TOKEN)) {
    console.log(`[fetcher] ${url} dünn (${html.length}b, kein Zutaten/Nährwerte-Keyword) → Apify-Retry`);
    let apifyResult = null;
    try {
      apifyResult = await fetchViaApify(url, { apifyToken, verbrauch });
    } catch (e) {
      // Scheitert nur das Rendern dieser Seite, bleibt die direkt geholte
      // Fassung — mit Vermerk: belegt sie die EAN nicht, ist das ein
      // Abruffehler (src/kandidat.js), kein Urteil über die Seite.
      // Konto-/Kontingentfehler (FetchUnavailableError) betreffen jede Seite
      // und gehen weiter nach oben.
      if (!(e instanceof SeiteNichtAbrufbarError)) throw e;
      return {
        html,
        status: resp.status,
        finalUrl: resp.url,
        via: 'direkt',
        apifyGescheitert: e.status ? `apify_${e.status}` : e.grund,
      };
    }
    if (apifyResult) return apifyResult;
  }

  return { html, status: resp.status, finalUrl: resp.url, via: 'direkt' };
}

module.exports = { fetchHtml, isAllowedByRobots, USER_AGENT };
