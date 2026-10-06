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
 *      Body/Query: { ean, productName?, productPath?, ohneOpenFoodFacts?,
 *                    nurDomains?, bevorzugteUrl?, auffrischen? }
 *      (Parameter: src/anfrage.js, Ablauf: src/suche.js)
 *      bevorzugteUrl → Resolver → mehrere URLs probieren → 1. voller Treffer.
 *      Für Einzel-Lookups und den external-misses-processor.
 *      Antwort u. a. `altdatenWiderlegt: true`, wenn die bevorzugte Seite die
 *      dort vor dem 04.10.2026 ungeprüft gelesenen Daten widerlegt hat und
 *      diese entfernt wurden (der Prozessor schließt dann nicht mit „alte
 *      Daten bleiben“ ab).
 *
 *   3. scrapeBatch
 *      Iteriert produkte + markenProdukte ohne irgendeine source.
 *      Pro Produkt: Resolver → 1. erfolgreicher Extract.
 *      Schreibt in nutritionscrape, sodass CF2-Backfill diese
 *      später als 'sonstiges'-Source einlesen kann.
 *      Throttle + Limit + dryRun-Modes.
 *
 * Auth: shared key Secret NUTRITION_SCRAPER_TRIGGER_KEY
 * KI-Auslesen: gemini-3.5-flash über Vertex (Projekt-Billing, kein Schlüssel),
 *   siehe src/extractor.js. Bis 01.10.2026 Claude (Anthropic-Guthaben ab
 *   18.08.2026 leer → jede EAN fälschlich „keine Daten“).
 * Serper.dev (Google-Search via API): Secret SERPER_API_KEY
 */

const functions = require('firebase-functions/v2/https');
const params = require('firebase-functions/params');
const admin = require('firebase-admin');

const { InfrastrukturFehler } = require('./src/fehler');
const { resolveCandidates, kandidatFuerUrl } = require('./src/resolver');
const { writeScrapeResult } = require('./src/writer');
const { leseKandidat } = require('./src/kandidat');
const { sucheEan } = require('./src/suche');
const { leseScrapeParameter, neuerVerbrauch, istRatekandidat, entscheideErgebnis } = require('./src/anfrage');
const { ergaenzeBefund } = require('./src/zusammenfuehren');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Gen 2 Param-API für Secrets / Config. Migration-friendly weg von
// legacy functions.config(). Auf Deploy werden die Werte aus
// .env.<project> oder Secret Manager gelesen.
const TRIGGER_KEY = params.defineSecret('NUTRITION_SCRAPER_TRIGGER_KEY');
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
// Derselbe Weg wie scrapeEan (src/kandidat.js): auch eine von Hand
// angegebene Seite muss zur EAN gehören, bevor die KI läuft und etwas
// gespeichert wird.
exports.scrapeSingleUrl = functions.onRequest(
  {
    ...COMMON_OPTS,
    secrets: [TRIGGER_KEY, APIFY_API_TOKEN],
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
      const kandidat = await kandidatFuerUrl(String(url));
      if (!kandidat) {
        res.status(400).json({ result: 'url_nicht_erlaubt', url });
        return;
      }
      let r;
      try {
        r = await leseKandidat({
          kandidat,
          ean: String(ean),
          productName: productName || null,
          apifyToken: APIFY_API_TOKEN.value(),
          db,
          auftrag: 'einzelseite',
        });
      } catch (e) {
        if (e instanceof InfrastrukturFehler) {
          // KI-/Apify-Ausfall ist keine Aussage über die Seite → 503.
          res.status(503).json({ result: e.code, url, error: e.message });
          return;
        }
        throw e;
      }
      if (r.status === 'abrufFehler') {
        res.status(503).json({ result: 'fetch_unavailable', url, httpStatus: r.httpStatus, grund: r.grund });
        return;
      }
      if (r.status === 'keineSeite') {
        res.status(200).json({ result: 'fetch_failed', url });
        return;
      }
      if (r.status !== 'treffer') {
        res.status(200).json({ result: r.status === 'verworfen' ? r.grund : 'extract_failed', url });
        return;
      }
      const writeRes = await writeScrapeResult({
        ean: String(ean),
        productPath: productPath || null,
        extracted: r.befund,
        sourceUrl: r.finalUrl,
        sourceShop: kandidat.shop,
      });
      res.status(200).json({ result: 'ok', extracted: r.befund, write: writeRes });
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
    secrets: [TRIGGER_KEY, SERPER_API_KEY, APIFY_API_TOKEN],
  },
  async (req, res) => {
    if (!checkAuth(req, TRIGGER_KEY.value())) {
      res.status(401).send('Unauthorized');
      return;
    }

    const p = leseScrapeParameter(req.method === 'POST' ? req.body : req.query);
    if (p.fehler) {
      res.status(400).send(p.fehler);
      return;
    }
    for (const h of p.hinweise) console.warn(`[scrapeEan] ${p.ean}: ${h}`);

    const verbrauch = neuerVerbrauch();
    // Wer sucht? Der external-misses-processor setzt immer ohneOpenFoodFacts
    // (Produktsuche); ohne den Parameter ruft der Katalog-Backfill
    // (nutrition-backfill fireScraperForEan). Steht in jeder Kostenzeile.
    const auftrag = p.ohneOpenFoodFacts ? 'produktsuche' : 'katalog';
    // Eine Zeile je Lauf — zusammen mit den produktsuche_kosten-Zeilen des
    // Extractors lassen sich die Kosten je EAN nachrechnen. Auch bei einem
    // unerwarteten Fehler (500): Suche und KI können schon bezahlt sein.
    const protokolliere = (ergebnis, extra = {}) => {
      console.log(JSON.stringify({
        evt: 'produktsuche_lauf',
        ean: p.ean,
        auftrag,
        katalogPfad: !!p.productPath,
        ergebnis,
        auffrischen: p.auffrischen,
        bevorzugteUrl: !!p.bevorzugteUrl,
        nurDomains: !!p.nurDomains,
        ...extra,
        verbrauch,
      }));
    };

    try {
      const serperKey = SERPER_API_KEY.value();
      let s;
      try {
        s = await sucheEan({
          ean: p.ean,
          productName: p.productName,
          bevorzugteUrl: p.bevorzugteUrl,
          filter: { ohneOpenFoodFacts: p.ohneOpenFoodFacts, nurDomains: p.nurDomains },
          serper: serperKey ? { apiKey: serperKey } : null,
          apifyToken: APIFY_API_TOKEN.value(),
          db,
          verbrauch,
          auftrag,
          deps: { leseKandidat, resolveCandidates, kandidatFuerUrl },
        });
      } catch (e) {
        if (e instanceof InfrastrukturFehler) {
          // Suche ausgefallen (z. B. Serper-Guthaben leer) ≠ „keine Treffer“.
          console.warn(`[scrapeEan] ${e.code}: ${e.message}`);
          protokolliere(e.code);
          res.status(503).json({ result: e.code, error: e.message, verbrauch });
          return;
        }
        throw e;
      }

      if (s.treffer) {
        const writeRes = await writeScrapeResult({
          ean: p.ean,
          productPath: p.productPath,
          extracted: s.treffer.befund,
          sourceUrl: s.treffer.finalUrl,
          sourceShop: s.treffer.kandidat.shop,
          auffrischen: p.auffrischen,
          widerlegung: s.bevorzugteUrlWiderlegt,
        });
        protokolliere('ok', { shop: s.treffer.kandidat.shop, versucht: s.versucht, altdatenWiderlegt: writeRes.altdatenWiderlegt });
        res.status(200).json({
          result: 'ok',
          triedUrls: s.kandidaten,
          versucht: s.versucht,
          successUrl: s.treffer.finalUrl,
          successShop: s.treffer.kandidat.shop,
          bevorzugteUrlGenutzt: s.ueberBevorzugteUrl,
          altdatenWiderlegt: writeRes.altdatenWiderlegt,
          extracted: s.treffer.befund,
          write: writeRes,
          verbrauch,
        });
        return;
      }

      // Kein Treffer, aber die gespeicherte Quellseite widerlegt den
      // Altbestand → dessen Daten entfernen (src/zusammenfuehren.js). Nur
      // bei einem inhaltlichen Ergebnis: bei 503 bleibt alles, wie es ist.
      let altdatenWiderlegt = false;
      if (s.bevorzugteUrlWiderlegt && s.ergebnis.http === 200) {
        const w = await writeScrapeResult({ ean: p.ean, extracted: null, widerlegung: s.bevorzugteUrlWiderlegt });
        altdatenWiderlegt = w.altdatenWiderlegt;
      }

      // Kein Treffer: 503, wenn ein Dienst ausfiel, die Frist ablief oder
      // KEIN Kandidat ohne Abruffehler antwortete (Fremddienst-Regel,
      // CLAUDE.md) — sonst inhaltlich „nichts gefunden“.
      protokolliere(s.ergebnis.result, { versucht: s.versucht, abrufFehler: s.abrufFehler, altdatenWiderlegt });
      res.status(s.ergebnis.http).json({
        result: s.ergebnis.result,
        triedUrls: s.kandidaten,
        versucht: s.versucht,
        abrufFehler: s.abrufFehler,
        extractErrors: s.infraFehler,
        altdatenWiderlegt,
        ...(s.ergebnis.fehler ? { error: s.ergebnis.fehler } : {}),
        verbrauch,
      });
    } catch (e) {
      console.error('[scrapeEan] error:', e);
      protokolliere('fehler_500', { fehler: String(e?.message || e).slice(0, 200) });
      res.status(500).send(String(e?.message || e));
    }
  },
);

// ─── Endpoint 3: scrapeBatch ──────────────────────────────────────
exports.scrapeBatch = functions.onRequest(
  {
    ...COMMON_OPTS,
    timeoutSeconds: 3600, // Gen 2 max 60min
    secrets: [TRIGGER_KEY, SERPER_API_KEY, APIFY_API_TOKEN],
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
      abruf_fehler: 0,
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
        // schreib am Ende den Merge. Stop früh wenn Kern-Felder (Zutaten +
        // Nährwerte + Preis) abgedeckt sind. Jede Seite läuft über denselben
        // Weg wie scrapeEan (src/kandidat.js): EAN-Beleg vor der KI,
        // Vertrauen der Quelle (priceOnly/noPriceTrust), Preis nur in Euro
        // aus DE/AT-Shops. Gesammelt wird mit ergaenzeBefund (Preis als
        // Block, Name mit seinem Beleg).
        const hatZutaten = (m) =>
          typeof m?.attr_ingredientStatement === 'string' && m.attr_ingredientStatement.trim().length > 0;
        const hatNaehrwerte = (m) =>
          typeof m?.nutr_Energie_val === 'number' || typeof m?.nutr_Fett_val === 'number';
        let merged = null;        // accumulated extracted-result
        let firstSourceUrl = null;
        let firstSourceShop = null;
        // Wie scrapeEan (src/suche.js): getrennt für die belegten Kandidaten
        // (Serper-Treffer) — Codecheck und OpenFoodFacts hängen als
        // Rückfall-Adressen an JEDER EAN und antworten immer (Suchseite, 404).
        const zaehler = { abrufFehler: 0, beantwortet: 0, belegteKandidaten: 0, belegteAbrufFehler: 0, belegteBeantwortet: 0 };

        for (const candidate of candidatesToTry) {
          // Early-Stop: wenn wir bereits Zutaten + Nährwerte + Preis haben, reicht.
          if (hatZutaten(merged) && hatNaehrwerte(merged) && merged?.attr_preis) {
            break;
          }
          // Wirft bei KI-Ausfall (ExtractUnavailableError) → processDoc bricht
          // ab, der Worker zählt einen Fehler, und es wird KEIN Failure-Marker
          // geschrieben (sonst würde das Produkt nach 3 Ausfällen für immer
          // übersprungen).
          const belegt = !istRatekandidat(candidate);
          if (belegt) zaehler.belegteKandidaten += 1;
          const r = await leseKandidat({
            kandidat: candidate,
            ean: eans[0],
            productName: product?.name || null,
            apifyToken,
            db,
            auftrag: 'katalog',
          });
          if (r.status === 'abrufFehler') {
            zaehler.abrufFehler += 1;
            if (belegt) zaehler.belegteAbrufFehler += 1;
            continue;
          }
          zaehler.beantwortet += 1;
          if (belegt) zaehler.belegteBeantwortet += 1;
          if (r.status !== 'treffer') continue;
          if (!merged) {
            firstSourceUrl = r.finalUrl;
            firstSourceShop = candidate.shop;
          }
          merged = ergaenzeBefund(merged, r.befund);
        }

        if (merged && (hatZutaten(merged) || hatNaehrwerte(merged) || merged.attr_preis)) {
          await writeScrapeResult({
            ean: eans[0],
            productPath: `${collection}/${d.id}`,
            extracted: merged,
            sourceUrl: firstSourceUrl,
            sourceShop: firstSourceShop,
          });
          return { type: 'ok' };
        }
        // Nur Abruffehler (403/429/5xx/Zeitlimit) → keine Aussage über das
        // Produkt, also KEIN Failure-Marker (sonst nach 3 Läufen für immer
        // übersprungen); der nächste Batch versucht es erneut. Dieselbe
        // Regel wie scrapeEan (anfrage.entscheideErgebnis): antworteten nur
        // Rückfall-Adressen, waren die Shopseiten trotzdem alle gesperrt
        // (Prüfrunde 3 — bis dahin zählte deren Antwort als Aussage).
        const entscheidung = entscheideErgebnis({ kandidaten: candidatesToTry.length, ...zaehler });
        if (entscheidung.http === 503) {
          return { type: 'abruf_fehler' };
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

      // Within-Batch-Concurrency: 3 EANs parallel (war auf das frühere
      // Anthropic-Ratenlimit abgestimmt; Vertex verträgt mehr, bleibt aber
      // bewusst bei 3, weil Apify-Renderings der eigentliche Kostentreiber sind).
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
              abruf_fehler: 'abruf_fehler',
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
