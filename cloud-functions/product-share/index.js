'use strict';

/**
 * product-share — Landing-Page für geteilte Produktkarten (86caj5uuu-Familie).
 *
 * Warum eine Function statt einer statischen Seite (wie join.html):
 * WhatsApp/Facebook-Crawler führen KEIN JavaScript aus — die
 * Link-Vorschau (og:title/og:description/og:image) muss pro Produkt
 * serverseitig im HTML stehen. Der Rest der Seite (App-öffnen-Kaskade,
 * Store-Badges, Look) ist 1:1 das bewährte join.html-Muster.
 *
 * Pfadformat (Hosting-Rewrite /p/** → diese Function):
 *   /p/n/<produktId>   → App: noname-detail/<id>            (Stufe 1/2)
 *   /p/vn/<produktId>  → App: product-comparison/<id>?type=noname
 *   /p/vm/<markenId>   → App: product-comparison/<id>?type=brand
 *
 * WICHTIG (join.html:69-73): App-Scheme = `markendetektivern` (mit n) —
 * die ausgelieferten Builds registrieren nur dieses Scheme zuverlässig.
 *
 * Kein Auth: der Katalog (produkte/markenProdukte) ist per Firestore-Rules
 * öffentlich lesbar (`allow read: if true`) — die Seite zeigt nichts, was
 * nicht ohnehin public ist.
 */

const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west3';
const SITE_ORIGIN = 'https://markendetektive-895f7.web.app';
const APP_STORE_URL = 'https://apps.apple.com/de/app/id6471081082';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=de.markendetektive';

// kind → { Firestore-Collection, App-Deep-Pfad-Builder }
const KINDS = {
  n: { collection: 'produkte', deepPath: (id) => `noname-detail/${id}` },
  vn: { collection: 'produkte', deepPath: (id) => `product-comparison/${id}?type=noname` },
  vm: { collection: 'markenProdukte', deepPath: (id) => `product-comparison/${id}?type=brand` },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Für <script>-Einbettung: JSON-encoden + `<` entschärfen (kein </script>-Breakout). */
function jsString(s) {
  return JSON.stringify(String(s)).replace(/</g, '\\u003c');
}

/** og:image nur von unserem Storage-Host zulassen — sonst App-Icon-Fallback. */
function safeImageUrl(candidate) {
  if (typeof candidate !== 'string') return null;
  if (!/^https:\/\/(firebasestorage\.googleapis\.com|storage\.googleapis\.com)\//.test(candidate)) {
    return null;
  }
  return candidate;
}

/**
 * "Spare X %" — spiegelt lib/utils/savings.ts calculateSavings EXAKT
 * (sonst widerspricht die Link-Vorschau dem In-App-Badge):
 * (1) vorberechnete ersparnis/ersparnisProz auf dem NoName-Doc (verbatim
 *     gerundet), (2) Preis-pro-Packungseinheit wenn BEIDE Docs preis>0 +
 *     packSize>0 — teurerer NoName fällt NICHT auf Stufe 3 durch,
 * (3) absolute Preisdifferenz ohne packSize-Paar. Nie negative Werte.
 */
async function resolveSavingsPct(nonameData) {
  const eur = Number(nonameData.ersparnis);
  const pct = Number(nonameData.ersparnisProz);
  if (Number.isFinite(eur) && eur > 0 && Number.isFinite(pct) && pct > 0) {
    const rounded = Math.round(pct);
    return rounded > 0 ? rounded : null;
  }
  const ref = nonameData.markenProdukt;
  if (!ref || typeof ref.get !== 'function') return null;
  try {
    const brandSnap = await ref.get();
    if (!brandSnap.exists) return null;
    const brand = brandSnap.data() || {};
    const bp = Number(brand.preis);
    const np = Number(nonameData.preis);
    if (!(bp > 0) || !(np > 0)) return null;
    const bs = Number(brand.packSize);
    const ns = Number(nonameData.packSize);
    if (bs > 0 && ns > 0) {
      // Stufe 2 — per-unit; teurerer NoName = keine Aussage (kein Fallthrough).
      const brandPerUnit = bp / bs;
      const nnPerUnit = np / ns;
      if (nnPerUnit >= brandPerUnit) return null;
      const p = Math.round(((brandPerUnit - nnPerUnit) / brandPerUnit) * 100);
      return p > 0 ? p : null;
    }
    // Stufe 3 — absolute Differenz.
    if (np < bp) {
      const p = Math.round(((bp - np) / bp) * 100);
      return p > 0 ? p : null;
    }
  } catch (e) {
    logger.warn('brand lookup for savings failed', { err: e.message });
  }
  return null;
}

function renderPage({ deepPath, title, ogTitle, description, imageUrl, canonicalUrl, savingsPct, found }) {
  const ogImage = imageUrl || `${SITE_ORIGIN}/app-icon.png`;
  const h1 = found ? escapeHtml(title) : 'Produkt in MarkenDetektive ansehen';
  const sub = escapeHtml(description);
  const pill =
    found && savingsPct
      ? `<div class="pill">Spare ${savingsPct} % gegen&uuml;ber dem Markenprodukt</div>`
      : '';
  const productImg =
    found && imageUrl
      ? `<img class="product" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(title)}" />`
      : `<img class="logo" src="/app-icon.png" alt="MarkenDetektive" />`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — MarkenDetektive</title>
  <meta name="robots" content="noindex" />
  <meta property="og:site_name" content="MarkenDetektive" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(ogTitle || title)}" />
  <meta property="og:description" content="${sub}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f7f8; color: #191c1d;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 24px;
    }
    @media (prefers-color-scheme: dark) {
      body { background: #0f1214; color: #f2f4f5; }
      .card { background: #191d20 !important; }
      .sub { color: #9aa4a8 !important; }
      .product { background: #fff; }
    }
    .card {
      background: #fff; border-radius: 22px; padding: 36px 28px;
      max-width: 380px; width: 100%; text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,.08);
    }
    .logo {
      width: 76px; height: 76px; border-radius: 18px; margin: 0 auto 18px;
      display: block; box-shadow: 0 4px 14px rgba(0,0,0,.12);
    }
    .product {
      width: 140px; height: 140px; object-fit: contain; margin: 0 auto 16px;
      display: block; border-radius: 16px;
    }
    h1 { font-size: 21px; font-weight: 800; letter-spacing: -.3px; margin-bottom: 10px; }
    .sub { font-size: 14px; line-height: 1.5; color: #5c676b; margin-bottom: 22px; }
    .pill {
      display: inline-block; padding: 6px 12px; border-radius: 999px;
      background: rgba(13,133,117,.1); color: #0d8575;
      font-size: 13px; font-weight: 800; margin-bottom: 18px;
    }
    .btn {
      display: block; width: 100%; padding: 15px 18px; border-radius: 14px;
      background: #0d8575; color: #fff; font-size: 16px; font-weight: 800;
      text-decoration: none; margin-bottom: 12px;
    }
    .btn:active { opacity: .85; }
    .store { display: flex; gap: 10px; justify-content: center; align-items: center; margin-top: 18px; }
    .store img.apple { height: 40px; display: block; }
    .store img.google { height: 50px; display: block; margin: -5px; }
    .hint { font-size: 12px; color: #8b9498; margin-top: 20px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    ${productImg}
    <h1>${h1}</h1>
    ${pill}
    <p class="sub">${sub}</p>
    <a id="open" class="btn" href="#">In der App öffnen</a>
    <div class="store">
      <a href="${APP_STORE_URL}"><img class="apple" src="/app-store-badge.svg" alt="Laden im App Store" /></a>
      <a href="${PLAY_STORE_URL}"><img class="google" src="/google-play-badge.png" alt="Jetzt bei Google Play" /></a>
    </div>
    <p class="hint">App schon installiert und nichts passiert? Tippe oben auf „In der App öffnen".</p>
  </div>
  <script>
    // Deep-Pfad kommt serverseitig; Kaskade = 1:1 join.html (bewährt):
    // Scheme markendetektivern (mit n!), Android plain-scheme → 1,6s
    // visibilitychange-Check → intent:// OHNE Store-Fallback.
    var deep = ${jsString(deepPath)};
    var appUrl = 'markendetektivern://' + deep;
    var btn = document.getElementById('open');
    var isAndroid = /android/i.test(navigator.userAgent);
    var androidIntent = 'intent://' + deep +
      '#Intent;scheme=markendetektivern;package=de.markendetektive;end';
    var tryOpenAndroid = function () {
      var t = setTimeout(function () {
        if (!document.hidden) location.href = androidIntent;
      }, 1600);
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) clearTimeout(t);
      }, { once: true });
      location.href = appUrl;
    };
    if (isAndroid) {
      btn.addEventListener('click', function (e) { e.preventDefault(); tryOpenAndroid(); });
      btn.href = '#';
    } else {
      btn.href = appUrl;
    }
    setTimeout(function () {
      if (isAndroid) tryOpenAndroid();
      else location.href = appUrl;
    }, 350);
  </script>
</body>
</html>`;
}

exports.productShare = onRequest(
  { region: REGION, timeoutSeconds: 30, memory: '256MiB', invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    // Pfad: /p/<kind>/<id> — id strikt sanitizen (Doc-IDs sind alphanumerisch).
    const m = String(req.path || '').match(/^\/p\/(n|vn|vm)\/([A-Za-z0-9_-]{1,64})\/?$/);
    const kindKey = m ? m[1] : null;
    const id = m ? m[2] : null;
    const kind = kindKey ? KINDS[kindKey] : null;

    let found = false;
    let title = 'MarkenDetektive';
    let ogTitle = null;
    let description =
      'Jetzt kostenlos Preise vergleichen & günstige Alternativen entdecken — mit der MarkenDetektive-App.';
    let imageUrl = null;
    let savingsPct = null;
    // Ohne gültigen Pfad: generische Seite, App öffnet auf Home.
    let deepPath = kind ? kind.deepPath(id) : '';
    const canonicalUrl = kind ? `${SITE_ORIGIN}/p/${kindKey}/${id}` : `${SITE_ORIGIN}/p`;

    if (kind) {
      try {
        const snap = await db.collection(kind.collection).doc(id).get();
        if (snap.exists) {
          const data = snap.data() || {};
          found = true;
          title = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : title;
          // OG-Bild: PNG-Kette (Crawler mögen PNG > WebP) — bildCleanPng → bildClean → bild.
          imageUrl =
            safeImageUrl(data.bildCleanPng) ||
            safeImageUrl(data.bildClean) ||
            safeImageUrl(data.bild);
          if (kind.collection === 'produkte') {
            savingsPct = await resolveSavingsPct(data);
          }
          // Der Hook gehört in den og:title — Messenger-Karten (iMessage!)
          // zeigen primär Titel + Bild, die Description oft gar nicht.
          ogTitle = savingsPct
            ? `${title} — spare ${savingsPct} %`
            : `${title} — jetzt Preise vergleichen`;
          description = savingsPct
            ? `Die günstige Alternative zum Markenprodukt — jetzt kostenlos in der MarkenDetektive-App vergleichen.`
            : 'Jetzt kostenlos Preise vergleichen & günstige Alternativen entdecken — mit der MarkenDetektive-App.';
        } else {
          logger.info('product not found', { kind: kindKey, id });
        }
      } catch (e) {
        // Fehler nie an den User: generische Seite rendert trotzdem.
        logger.error('product lookup failed', { kind: kindKey, id, err: e.message });
      }
    }

    res.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(renderPage({ deepPath, title, ogTitle, description, imageUrl, canonicalUrl, savingsPct, found }));
  },
);
