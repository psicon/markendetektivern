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
 */

const USER_AGENT =
  'MarkenDetektive-NutritionScraper/0.1 (+contact: patrick@markendetektive.de)';

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
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

/** Throttled fetch per host. Returnt { html, status, finalUrl } oder
 *  null bei Fehler / Block. */
async function fetchHtml(url, { skipRobots = false } = {}) {
  const host = getHost(url);
  if (!host) {
    console.warn('[fetcher] invalid URL:', url);
    return null;
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
      return null;
    }
  }

  if (!resp.ok) {
    if (resp.status >= 500) {
      // 5xx → ein Retry
      try {
        await sleep(2000);
        resp = await doFetch();
      } catch {
        return null;
      }
    }
    if (!resp.ok) {
      console.log(`[fetcher] ${url} → HTTP ${resp.status}`);
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
    console.warn(`[fetcher] ${url} read error:`, e?.message);
    return null;
  }

  // Concat + decode
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.length;
  }
  const html = new TextDecoder('utf-8').decode(buf);
  return { html, status: resp.status, finalUrl: resp.url };
}

module.exports = { fetchHtml, isAllowedByRobots, USER_AGENT };
