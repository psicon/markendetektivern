/**
 * Globus-Scraper — HTTPS-Callable Cloud Function.
 *
 * Aufruf vom Client (ExternalProductService.tryGlobus) mit
 *   { ean: string }
 * Returnt
 *   { found: false } | { found: true, product: ScrapedGlobusProduct }
 *
 * ─── Status: Skeleton mit TODO ─────────────────────────────────────
 *
 * Globus' Produkt-Portal (produkte.globus.de) ist ein content-portal-
 * style Website ohne offensichtliche EAN-Search-API oder URL-Pattern.
 * Eine echte Implementation braucht eine der folgenden Strategien:
 *
 *   A) Serper.dev: Google-Search "site:produkte.globus.de {ean}" →
 *      finde Produkt-URL → fetch + parse.
 *      Empfohlen weil bestehende `nutrition-scraper` CF dasselbe Pattern
 *      schon nutzt. Setup: SERPER_API_KEY-Secret + Domain-Whitelist.
 *
 *   B) Reverse-Engineering der internen Search-API von Globus.
 *      Browser-DevTools-Network-Inspection nötig um Endpoint + Params
 *      zu finden. Risiko: Anti-Bot-Schutz, Layout-Änderungen.
 *
 *   C) Periodischer Bulk-Crawl der Globus-Sitemaps in eine eigene
 *      Firestore-Collection (analog scraped_products für REWE). Offline-
 *      Lookup. Mehr Setup-Aufwand, dafür stable.
 *
 * Aktueller Stand: returnt IMMER { found: false }. Die Cascade
 * (ExternalProductService.lookupByEAN) fällt damit auf OpenFood weiter.
 *
 * TODO: eine der drei Strategien implementieren. Beim Implementieren
 * MUSS das Output-Format dem ScrapedProduct-Schema entsprechen, damit
 * die Normalizer-Logik in externalProductService.normaliseScraped()
 * direkt funktioniert.
 */

const functions = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const REGION = 'europe-west1';

/**
 * HTTPS Callable: `globusLookupByEan`
 * Input: { ean: string }
 * Output: { found: boolean, product?: object }
 */
exports.globusLookupByEan = functions.onCall(
  {
    region: REGION,
    timeoutSeconds: 30,
    memory: '512MiB',
  },
  async (request) => {
    const ean = String(request.data?.ean ?? '').trim();
    if (!/^\d{8,14}$/.test(ean)) {
      throw new functions.HttpsError('invalid-argument', 'Ungültiger EAN');
    }

    // TODO: Implementierung gemäß einer der oben genannten Strategien.
    // Bis dahin: false zurückgeben, Cascade fällt zu OpenFood durch.
    console.log(`[globus-scraper] EAN ${ean} — pipeline nicht implementiert`);
    return { found: false };

    /* Beispiel-Skeleton für Strategie A (Serper + cheerio):
    const cheerio = require('cheerio');

    // 1. Serper.dev Search
    const searchResp = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: `site:produkte.globus.de "${ean}"`,
        num: 5,
      }),
    });
    const search = await searchResp.json();
    const firstHit = search.organic?.[0];
    if (!firstHit?.link) return { found: false };

    // 2. Fetch Produkt-Page
    const pageResp = await fetch(firstHit.link, {
      headers: { 'User-Agent': 'MarkenDetektive Bot (contact: patrick@markendetektive.de)' },
    });
    if (!pageResp.ok) return { found: false };
    const html = await pageResp.text();
    const $ = cheerio.load(html);

    // 3. Extract (selektoren müssen aus Globus-HTML-Struktur abgeleitet werden)
    const product = {
      gtin: ean,
      productName: $('h1.product-title').text().trim() || undefined,
      brandName: $('.product-brand').text().trim() || undefined,
      price: parseFloat($('.product-price').text().replace(',', '.')) || undefined,
      images: [$('.product-image img').attr('src')].filter(Boolean),
      ingredients: $('.product-ingredients').text().trim() || undefined,
      productCategory: $('.breadcrumb li').last().text().trim() || undefined,
      source: 'globus',
    };

    if (!product.productName) return { found: false };
    return { found: true, product };
    */
  },
);
