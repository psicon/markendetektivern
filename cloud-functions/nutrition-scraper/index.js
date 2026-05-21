/**
 * Nutrition-Scraper — Cloud Functions Gen 2 HTTPS-Trigger.
 *
 * Three HTTPS-Endpoints:
 *
 *   1. scrapeSingleUrl
 *      Body/Query: { ean, url, productName?, productPath? }
 *      Fetcht eine spezifische URL → Extract → Write.
 *      Für Tests + manuelle Recherchen.
 *
 *   2. scrapeEan
 *      Body/Query: { ean, productName?, productPath? }
 *      Resolver → mehrere URLs probieren → 1. Treffer wins.
 *      Für Einzel-Lookups (z.B. nach User-Feedback "fehlende Daten").
 *
 *   3. scrapeBatch
 *      Iteriert produkte + markenProdukte ohne irgendeine source.
 *      Pro Produkt: Resolver → 1. erfolgreicher Extract.
 *      Schreibt in nutritionscrape, sodass CF2-Backfill diese
 *      später als 'sonstiges'-Source einlesen kann.
 *      Throttle + Limit + dryRun-Modes.
 *
 * Auth: shared key Secret NUTRITION_SCRAPER_TRIGGER_KEY
 * Claude-API-Key: Secret ANTHROPIC_API_KEY
 * Serper.dev (Google-Search via API): Secret SERPER_API_KEY
 */

const functions = require('firebase-functions/v2/https');
const params = require('firebase-functions/params');
const admin = require('firebase-admin');

const { fetchHtml } = require('./src/fetcher');
const { extractFromHtml } = require('./src/extractor');
const { resolveCandidates } = require('./src/resolver');
const { writeScrapeResult, incrementTelemetryFail } = require('./src/writer');
const { isPageGoodCandidate } = require('./src/domains');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Gen 2 Param-API für Secrets / Config. Migration-friendly weg von
// legacy functions.config(). Auf Deploy werden die Werte aus
// .env.<project> oder Secret Manager gelesen.
const TRIGGER_KEY = params.defineSecret('NUTRITION_SCRAPER_TRIGGER_KEY');
const ANTHROPIC_API_KEY = params.defineSecret('ANTHROPIC_API_KEY');
// Serper.dev — echte google.com-Searches per API. Replacement für
// Vertex AI Search das EANs nicht im Snippet-Index hat. Optional —
// wenn nicht gesetzt, wird nur Direct-URL-Pfad genutzt.
const SERPER_API_KEY = params.defineSecret('SERPER_API_KEY');
// Apify — Playwright-Render-Service für SPA-Shops (mein-aldi, lidl,
// rewe, etc.). Optional. Wenn nicht gesetzt: SPA-Shops returnen
// einfach null beim fetch.
const APIFY_API_TOKEN = params.defineSecret('APIFY_API_TOKEN');

const REGION = 'europe-west1';
const COMMON_OPTS = {
  region: REGION,
  timeoutSeconds: 540, // Gen 2 erlaubt bis 3600; für jetzt 9 min
  memory: '1GiB',
};

function checkAuth(req, expected) {
  if (!expected) return false;
  const key = req.query?.key || req.body?.key;
  return key === expected;
}

function getEans(product) {
  if (!product) return [];
  const out = new Set();
  const candidates = [
    product.EAN,
    product.ean,
    product.gtin,
    product.GTIN,
    ...(Array.isArray(product.EANs) ? product.EANs : []),
    ...(Array.isArray(product.eans) ? product.eans : []),
  ];
  for (const v of candidates) {
    if (v == null) continue;
    const s = typeof v === 'number' ? String(v) : String(v).trim();
    if (s.length >= 8 && isPlausibleEan(s)) out.add(s);
  }
  return [...out];
}

/** Validiert ob ein EAN plausibel ist (filtert offensichtlichen Junk):
 *   - nur Ziffern
 *   - Länge 8-14 (wir sind tolerant — interne SKUs 10-11 stellig kommen vor)
 *   - nicht trivial (alle gleiche Ziffer, sequentielle Zahlen)
 *   - bei Standard-Längen 8/12/13/14 ZUSÄTZLICH Check-Digit validieren
 * Filtert Junk wie "999999999", "12345678", "00000000". */
function isPlausibleEan(s) {
  if (!/^\d+$/.test(s)) return false;
  const len = s.length;
  if (len < 8 || len > 14) return false;

  // Trivial: alle gleiche Ziffer
  if (/^(\d)\1+$/.test(s)) return false;

  // Trivial: streng sequenziell ("12345678" / "01234567")
  let sequential = true;
  for (let i = 1; i < s.length; i++) {
    if ((+s[i] - +s[i - 1] + 10) % 10 !== 1) { sequential = false; break; }
  }
  if (sequential) return false;

  // KEINE Check-Digit-Validierung mehr (User-Vorgabe 2026-05-19).
  // Begründung: manuelle EAN-Erfassung hat oft Tippfehler im Check-Digit
  // → EAN sah real aus, Pipeline hat sie aber als invalid verworfen.
  // Schutz vor Fake-EAN-Waste ist später: html.includes(ean)-Check vor
  // Claude-Call. Wenn die EAN nirgends in Serper-Treffern auftaucht
  // → keine Claude-Tokens verbrannt. Risiko = 0.
  return true;
}

// ─── Endpoint 1: scrapeSingleUrl ──────────────────────────────────
exports.scrapeSingleUrl = functions.onRequest(
  {
    ...COMMON_OPTS,
    secrets: [TRIGGER_KEY, ANTHROPIC_API_KEY, APIFY_API_TOKEN],
  },
  async (req, res) => {
    if (!checkAuth(req, TRIGGER_KEY.value())) {
      res.status(401).send('Unauthorized');
      return;
    }

    const { ean, url, productName, productPath } = req.method === 'POST'
      ? req.body
      : req.query;

    if (!ean || !url) {
      res.status(400).send('Missing ean or url param');
      return;
    }

    try {
      const fetched = await fetchHtml(url, { apifyToken: APIFY_API_TOKEN.value() });
      if (!fetched) {
        res.status(200).json({ result: 'fetch_failed', url });
        return;
      }
      const extracted = await extractFromHtml({
        html: fetched.html,
        apiKey: ANTHROPIC_API_KEY.value(),
        productName,
      });
      if (!extracted) {
        res.status(200).json({ result: 'extract_failed', url });
        return;
      }
      const writeRes = await writeScrapeResult({
        ean: String(ean),
        productPath: productPath || null,
        extracted,
        sourceUrl: fetched.finalUrl,
      });
      res.status(200).json({ result: 'ok', extracted, write: writeRes });
    } catch (e) {
      console.error('[scrapeSingleUrl] error:', e);
      res.status(500).send(String(e?.message || e));
    }
  },
);

// ─── Endpoint 2: scrapeEan ────────────────────────────────────────
exports.scrapeEan = functions.onRequest(
  {
    ...COMMON_OPTS,
    secrets: [TRIGGER_KEY, ANTHROPIC_API_KEY, SERPER_API_KEY, APIFY_API_TOKEN],
  },
  async (req, res) => {
    if (!checkAuth(req, TRIGGER_KEY.value())) {
      res.status(401).send('Unauthorized');
      return;
    }

    const { ean, productName, productPath } = req.method === 'POST'
      ? req.body
      : req.query;

    if (!ean) {
      res.status(400).send('Missing ean param');
      return;
    }

    try {
      const serperKey = SERPER_API_KEY.value();
      const candidates = await resolveCandidates([String(ean)], {
        serper: serperKey ? { apiKey: serperKey } : null,
      });

      if (candidates.length === 0) {
        res.status(200).json({ result: 'no_urls' });
        return;
      }

      // Versuche URLs sequentiell in Prio-Reihenfolge (Shops zuerst,
      // OF + codecheck als Fallback). 1. erfolgreicher Extract wins.
      const apifyToken = APIFY_API_TOKEN.value();
      for (const candidate of candidates) {
        const fetched = await fetchHtml(candidate.url, {
          requiresJS: candidate.requiresJS,
          apifyToken,
        });
        if (!fetched) continue;
        // Quality-Check für UNKNOWN-Domain-Hits (serper-unknown):
        // bevor wir Claude-Tokens verbrennen, prüfen wir ob die Page
        // überhaupt verwertbar ist (EAN drin + Nährwert-Keyword + Mindestgröße).
        if (candidate.requiresQualityCheck) {
          if (!isPageGoodCandidate(fetched.html, String(ean))) {
            console.log(`[scrapeEan] skip ${candidate.shop} (quality-check fail)`);
            // Telemetrie-Fail-Counter inkrementieren → bei 5+ Fails ohne
            // Success wird die Domain auto-temp-blacklistet
            incrementTelemetryFail(db, candidate.shop, String(ean), 'quality_check').catch(()=>{});
            continue;
          }
        }
        const extracted = await extractFromHtml({
          html: fetched.html,
          apiKey: ANTHROPIC_API_KEY.value(),
          productName,
        });
        if (!extracted) continue;
        const writeRes = await writeScrapeResult({
          ean: String(ean),
          productPath: productPath || null,
          extracted,
          sourceUrl: fetched.finalUrl,
          sourceShop: candidate.shop,
        });
        res.status(200).json({
          result: 'ok',
          triedUrls: candidates.length,
          successUrl: fetched.finalUrl,
          successShop: candidate.shop,
          extracted,
          write: writeRes,
        });
        return;
      }
      res.status(200).json({ result: 'all_failed', triedUrls: candidates.length });
    } catch (e) {
      console.error('[scrapeEan] error:', e);
      res.status(500).send(String(e?.message || e));
    }
  },
);

// ─── Endpoint 3: scrapeBatch ──────────────────────────────────────
exports.scrapeBatch = functions.onRequest(
  {
    ...COMMON_OPTS,
    timeoutSeconds: 3600, // Gen 2 max 60min
    secrets: [TRIGGER_KEY, ANTHROPIC_API_KEY, SERPER_API_KEY, APIFY_API_TOKEN],
  },
  async (req, res) => {
    if (!checkAuth(req, TRIGGER_KEY.value())) {
      res.status(401).send('Unauthorized');
      return;
    }

    const params = req.method === 'POST' ? req.body : req.query;
    const collection = String(params.collection || 'produkte');
    const limit = params.limit ? parseInt(String(params.limit), 10) : 50;
    const dryRun = String(params.dryRun || '') === '1';
    // forceRefresh=1 → re-scrape auch wenn EAN schon in nutritionscrape.
    // Sinnvoll für Schema-Migration (neue attr_* Felder ergänzen).
    const forceRefresh = String(params.forceRefresh || '') === '1';

    if (collection !== 'produkte' && collection !== 'markenProdukte') {
      res.status(400).send('collection must be produkte or markenProdukte');
      return;
    }

    const stats = {
      scanned: 0,
      already_in_nutritionscrape: 0,
      scrape_ok: 0,
      scrape_failed: 0,
      no_eans: 0,
      no_urls: 0,
      error: 0,
    };
    const startedAt = Date.now();

    try {
      // Welche Source-Werte gelten als "schon erledigt" / Skip-Kandidat?
      // - manual/rewe/ocr: trusted, NIE überschreiben
      // - scraper: WIR haben schon gescraped — keine weitere Iteration nötig
      //   (sonst Endlosschleife: scrapeBatch nimmt immer wieder dieselben docs)
      // Wir lassen NUR Felder überschreiben wo:
      //   - keine Source da ist (undefined/null/'')
      //   - openfood/legacy/reweapify-fill als Quelle → wollen wir verbessern
      const SKIP_SOURCES = new Set(['manual', 'rewe', 'ocr', 'scraper']);

      // User-Entscheidung 2026-05-18: ALLE Kategorien durchlaufen
      // (auch Drogerie & Tiernahrung) — dort sind oft Inhaltsstoffe
      // wertvoll (Schampoo-Zutaten, Tierfutter-Zusammensetzung etc.).
      // Kein Kategorie-Filter.

      const isProcessable = (data) => {
        const ns = data?.nutritionSource;
        const is = data?.ingredientsSource;
        // Bei forceRefresh: nur trusted sources (manual/rewe/ocr) skippen
        if (forceRefresh) {
          const TRUSTED = new Set(['manual', 'rewe', 'ocr']);
          const nsTrusted = TRUSTED.has(ns);
          const isTrusted = TRUSTED.has(is);
          if (nsTrusted && isTrusted) return false;
          return true;
        }
        const nsSkip = SKIP_SOURCES.has(ns);
        const isSkip = SKIP_SOURCES.has(is);
        // Wenn BEIDE Felder schon "fertig" → skip
        if (nsSkip && isSkip) return false;
        // Sonst processable (eine Feldgruppe braucht noch Daten)
        return true;
      };

      // SIMPLE Strategie (User-Vorgabe 2026-05-18):
      // Skip wenn IRGENDEINE Source bereits gesetzt ODER attr_*-Metadaten
      // schon vom Scraper geschrieben wurden (Nicht-LM-Hits: Müllbeutel,
      // Drogerie etc. mit nur attr_preis/attr_hersteller, ohne nutritionSource).
      // User-Logik: "wenn rewe da, dann eh ok, nicht anfassen".
      // Cursor + Schema-Migration: ClickUp 86c9vktgg
      const HAS_SOURCE = (data) => {
        if (!data) return false;
        if (data.nutritionSource || data.ingredientsSource) return true;
        // attr_*-Metadaten als touched-Indikator (z.B. Nicht-Lebensmittel
        // mit nur Hersteller+Preis aus scraper) — Scanner muss diese
        // als "fertig" werten, sonst Endlos-Pick.
        if (data.attr_preisShop || data.attr_hersteller ||
            (typeof data.attr_preis === 'number' && data.attr_preis > 0)) {
          return true;
        }
        // eanStatus='invalid' → expliziter Mark "unscrape-bar" → skip
        if (data.eanStatus === 'invalid') return true;
        return false;
      };

      // Pre-Load: EANs die in nutritionscrape als "_failed mit failCount>=3"
      // markiert sind → bei diesen Docs hat sich Serper/Resolver/Extractor
      // schon 3x die Zähne ausgebissen, nicht nochmal versuchen. Verhindert
      // dass die Pipeline auf einem Pool von ~80 hard-cases endlos kreist.
      const failedSnap = await db.collection('nutritionscrape')
        .where('_failed', '==', true)
        .select('_failCount')
        .get()
        .catch((e) => {
          console.warn('[scrapeBatch] load failed-EANs:', e?.message);
          return { docs: [] };
        });
      const failedEans = new Set();
      for (const fd of (failedSnap.docs || [])) {
        const fc = fd.data()?._failCount ?? 0;
        if (fc >= 3) failedEans.add(fd.id);
      }
      console.log(`[scrapeBatch] failed-EAN-blocklist: ${failedEans.size} EANs (failCount>=3)`);

      // Paginierter Scan mit großer Page-Size damit wir bei viel covered
      // docs durchkommen ohne 50-Pages-Cap zu hitten.
      const PAGE = Math.max(1000, limit * 8);
      let docs = [];
      let lastDocSnap = null;
      let pagesScanned = 0;
      let scannedTotal = 0;
      const MAX_PAGES = 30;
      while (docs.length < limit && pagesScanned < MAX_PAGES) {
        let q = db.collection(collection).orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
        if (lastDocSnap) q = q.startAfter(lastDocSnap);
        const snap = await q.get();
        if (snap.empty) break;
        const filtered = snap.docs.filter((d) => {
          const data = d.data();
          if (HAS_SOURCE(data)) return false;
          const docEans = getEans(data);
          // 2026-05-20: Müll-EAN-Docs ('999', '99999999' etc.) raus aus
          // Scan — sonst füllen sie die limit=100 Slots und der Scanner
          // erreicht die ECHTEN frischen Docs nie (~900 markenProdukte
          // waren unbearbeitet weil alphabetisch früher Müll-EAN-Cluster
          // den Pick komplett verbrannte).
          if (docEans.length === 0) return false;
          // Doc dessen erste EAN auf der failed-Liste ist → überspringen
          if (failedEans.has(docEans[0])) return false;
          return true;
        });
        docs.push(...filtered);
        lastDocSnap = snap.docs[snap.docs.length - 1];
        scannedTotal += snap.docs.length;
        pagesScanned++;
        if (snap.docs.length < PAGE) break;
      }
      docs = docs.slice(0, limit);
      console.log(`[scrapeBatch] simple scan: ${pagesScanned} pages, ${scannedTotal} scanned → ${docs.length} ohne source`);

      const serperKey = SERPER_API_KEY.value();
      const serperCfg = serperKey ? { apiKey: serperKey } : null;
      const apiKey = ANTHROPIC_API_KEY.value();
      const apifyToken = APIFY_API_TOKEN.value();

      // Single-Doc-Processor — extracted für within-batch-Concurrency
      const processDoc = async (d) => {
        const product = d.data();
        const eans = getEans(product);
        if (eans.length === 0) return { type: 'no_eans' };

        // SIMPLE: wenn nutritionscrape doc schon existiert → skip.
        // Auch bei reinen Failure-Markern (_failed: true mit failCount>=3),
        // damit die Pipeline nicht endlos auf denselben hard-cases hängt.
        // (Schema-Migration für alte Docs: siehe ClickUp 86c9vktgg)
        const scrapeRef = db.collection('nutritionscrape').doc(eans[0]);
        const scrapeDoc = await scrapeRef.get();
        if (scrapeDoc.exists && !forceRefresh) {
          const sd = scrapeDoc.data() || {};
          // Hat echte Daten ODER hat 3+ Failures → skip
          const hasRealData = !!(sd.scrapedSource && !sd._failed);
          const tooManyFails = sd._failed && (sd._failCount ?? 0) >= 3;
          if (hasRealData || tooManyFails) {
            return { type: 'already' };
          }
        }

        if (dryRun) return { type: 'ok' };

        const candidates = await resolveCandidates(eans, { serper: serperCfg });
        if (candidates.length === 0) {
          // Failure-Marker so dass Doc beim nächsten Scan geskippt wird
          await scrapeRef.set({
            gtin: eans[0],
            _failed: true,
            _failCount: admin.firestore.FieldValue.increment(1),
            _lastFailReason: 'no_urls',
            _lastFailAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true }).catch(()=>{});
          return { type: 'no_urls' };
        }

        // CAP=6: max. 6 Kandidaten pro EAN durchprobieren. User-Vorgabe
        // 2026-05-19. Wenn nach 6 keine Daten — failure marker, weiter.
        const MAX_CANDIDATES = 6;
        const candidatesToTry = candidates.slice(0, MAX_CANDIDATES);

        // Accumulative-Extraction: sammle Daten aus mehreren Kandidaten,
        // schreib am Ende den Merge. Stop früh wenn alles Kern-Felder
        // (Zutaten + Nährwerte) abgedeckt sind. priceOnly-Shops liefern
        // nur Preis, andere liefern Zutaten/Nährwerte/Preis.
        // User-Vorgabe: "Preis nur von offiziellen und bekannten Shops",
        // also strip attr_preis* wenn candidate.noPriceTrust=true ODER
        // candidate.source==='serper-unknown'.
        let merged = null;        // accumulated extracted-result
        let firstSourceUrl = null;
        let firstSourceShop = null;
        let firstHadIngredients = false;
        let firstHadNutrition = false;

        for (const candidate of candidatesToTry) {
          // Early-Stop: wenn wir bereits Zutaten + Nährwerte haben, reicht.
          if (firstHadIngredients && firstHadNutrition && merged?.attr_preis) {
            break;
          }

          const fetched = await fetchHtml(candidate.url, {
            requiresJS: candidate.requiresJS,
            apifyToken,
          });
          if (!fetched) continue;
          if (candidate.requiresQualityCheck) {
            if (!isPageGoodCandidate(fetched.html, eans[0])) {
              incrementTelemetryFail(db, candidate.shop, eans[0], 'quality_check').catch(()=>{});
              continue;
            }
          }
          // BEFORE-CLAUDE GUARD: die HTML MUSS die EAN als Text enthalten.
          if (fetched.html && !fetched.html.includes(eans[0])) {
            incrementTelemetryFail(db, candidate.shop, eans[0], 'ean_not_in_html').catch(()=>{});
            continue;
          }
          const extracted = await extractFromHtml({
            html: fetched.html,
            apiKey,
            productName: product?.name,
          });
          if (!extracted) continue;

          // Trust-basierter Strip: NICHT-trusted Quellen liefern nur
          // bestimmte Felder. priceOnly → NUR Preis-Felder behalten.
          // noPriceTrust → Preis-Felder droppen, Rest behalten.
          if (candidate.priceOnly) {
            // Aggregator (z.B. discounto) → nur Preis-Felder
            const priceOnlyFields = ['attr_preis', 'attr_preisPackgroesse', 'attr_preisPerKg'];
            for (const k of Object.keys(extracted)) {
              if (k.startsWith('_')) continue; // keep _confidence/_model
              if (!priceOnlyFields.includes(k)) delete extracted[k];
            }
          } else if (candidate.noPriceTrust) {
            // DB oder unknown → Preis-Felder droppen
            delete extracted.attr_preis;
            delete extracted.attr_preisPackgroesse;
            delete extracted.attr_preisPerKg;
          }

          // Merge in akkumulierten Result: erster Hit definiert Source,
          // spätere füllen nur fehlende Felder auf.
          if (!merged) {
            merged = { ...extracted };
            firstSourceUrl = fetched.finalUrl;
            firstSourceShop = candidate.shop;
          } else {
            for (const [k, v] of Object.entries(extracted)) {
              if (v == null) continue;
              if (k.startsWith('_')) continue;
              // Felder die noch nicht da sind ergänzen
              if (merged[k] == null || merged[k] === '' || (Array.isArray(merged[k]) && merged[k].length === 0)) {
                merged[k] = v;
              }
            }
          }

          firstHadIngredients = firstHadIngredients ||
            (typeof merged.attr_ingredientStatement === 'string' &&
             merged.attr_ingredientStatement.trim().length > 0);
          firstHadNutrition = firstHadNutrition ||
            (typeof merged.nutr_Energie_val === 'number' ||
             typeof merged.nutr_Fett_val === 'number');
        }

        if (merged && (firstHadIngredients || firstHadNutrition || merged.attr_preis)) {
          await writeScrapeResult({
            ean: eans[0],
            productPath: `${collection}/${d.id}`,
            extracted: merged,
            sourceUrl: firstSourceUrl,
            sourceShop: firstSourceShop,
          });
          return { type: 'ok' };
        }
        // Alle Candidates durchprobiert, kein Extract → Failure-Marker.
        // Nach 3 Versuchen wird der Doc beim Scan geskippt.
        await scrapeRef.set({
          gtin: eans[0],
          _failed: true,
          _failCount: admin.firestore.FieldValue.increment(1),
          _lastFailReason: 'all_candidates_failed',
          _lastFailAt: admin.firestore.FieldValue.serverTimestamp(),
          _lastFailCandidateCount: candidates.length,
        }, { merge: true }).catch(()=>{});
        return { type: 'failed' };
      };

      // Within-Batch-Concurrency: 3 EANs parallel.
      // Anthropic Tier 2 = 60k tokens/min, eine call ist ~3000 tokens =
      // ~20 calls/min möglich. Mit 3 parallel kommen wir nahe an die
      // theoretische Grenze ohne 429-Cascade.
      const CONCURRENCY = 3;
      let cursor = 0;
      const workers = Array(CONCURRENCY).fill(0).map(async () => {
        while (cursor < docs.length) {
          const idx = cursor++;
          const d = docs[idx];
          stats.scanned += 1;
          try {
            const r = await processDoc(d);
            const map = {
              no_eans: 'no_eans',
              already: 'already_in_nutritionscrape',
              ok: 'scrape_ok',
              no_urls: 'no_urls',
              failed: 'scrape_failed',
            };
            stats[map[r.type]] = (stats[map[r.type]] || 0) + 1;
          } catch (e) {
            console.error(`[scrapeBatch] doc ${d.id} error:`, e?.message);
            stats.error += 1;
          }
        }
      });
      await Promise.all(workers);

      const elapsedMs = Date.now() - startedAt;
      // Hit-Rate Telemetrie — Zähler aus Worker-Loop ausgeben damit wir
      // OHNE in Cloud-Run-Logs nach Response-Body suchen zu müssen sehen
      // wie viele Writes pro Cron-Welle landen.
      const ok = stats.scrape_ok || 0;
      const failed = stats.scrape_failed || 0;
      const noUrls = stats.no_urls || 0;
      const noEans = stats.no_eans || 0;
      const already = stats.already_in_nutritionscrape || 0;
      const attempted = ok + failed + noUrls;
      const hitRate = attempted > 0 ? ((ok / attempted) * 100).toFixed(1) : '0.0';
      console.log(
        `[scrapeBatch] DONE col=${collection} elapsed=${elapsedMs}ms ` +
        `ok=${ok} failed=${failed} no_urls=${noUrls} no_eans=${noEans} ` +
        `already=${already} → hitRate=${hitRate}% (of ${attempted} attempted)`,
      );

      res.status(200).json({
        collection,
        limit,
        dryRun,
        elapsedMs,
        hitRate: Number(hitRate),
        ...stats,
      });
    } catch (e) {
      console.error('[scrapeBatch] error:', e);
      res.status(500).send(String(e?.message || e));
    }
  },
);
