/**
 * Top-Products Aggregator — runs weekly via Cloud Scheduler.
 *
 * Pre-computes three Home top-product lists in ONE aggregate doc:
 *
 *   1. **Top 10 overall (rating)** — alle productRatings, Bayesian-Avg
 *      × Engagement-Score (Bewertungs-Anzahl + Kommentar-Anzahl).
 *   2. **Top 10 letzter Monat (rating)** — gleiche Logik, gefiltert
 *      auf Bewertungen mit `ratedate >= now - 30d`.
 *   3. **Top 10 meist aufgerufen (letzter Monat)** — eindeutige
 *      Journey-Sessions die ein Produkt enthielten, letzte 30 Tage.
 *      Gibt das beste Trending-Signal: zeigt was diesen Monat
 *      tatsächlich angeklickt wird, unabhängig davon ob bewertet.
 *
 * Output: `aggregates/topProducts_v1` mit Feldern `overall`,
 * `monthly`, `mostViewed`, `updatedAt`. App liest das mit EINEM Read
 * pro Session statt clientseitiger Aggregation (~5.000-50.000+ Reads
 * pro Session bei Live-Aggregation; siehe README).
 *
 * Single-pass design — alle Daten werden mit `.select()` Field-
 * Projection gestreamt, dann clientseitig in Memory aggregiert.
 *
 * Deploy:
 *   firebase deploy --only functions:aggregateTopProducts,functions:aggregateTopProductsHttp
 *
 * Manual trigger nach Erst-Deploy oder ad-hoc Rebuild:
 *   curl https://europe-west1-markendetektive-895f7.cloudfunctions.net/aggregateTopProductsHttp
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const AGG_PATH = ['aggregates', 'topProducts_v1'];
const TOP_N = 10;
const POOL_N = 30; // Wir holen mehr Kandidaten als TOP_N um Joins
                    // zu filtern (Produkt evtl. gelöscht oder ohne
                    // Bild). Der finale Pool wird auf TOP_N gekürzt.

// ─── Helpers ─────────────────────────────────────────────────────

function refToId(ref) {
  if (!ref) return null;
  if (ref.id) return ref.id;
  if (ref.referencePath) {
    const parts = String(ref.referencePath).split('/');
    return parts[parts.length - 1] || null;
  }
  if (ref._path?.segments && Array.isArray(ref._path.segments)) {
    const segs = ref._path.segments;
    return segs[segs.length - 1] || null;
  }
  return null;
}

function tsToMillis(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t === 'number') return t;
  if (t._seconds) return t._seconds * 1000;
  return 0;
}

// ─── Stage A: aggregate productRatings (overall + monthly) ──────

async function aggregateRatings() {
  console.log('  [A] streaming productRatings …');
  const start = Date.now();

  const cutoffMonth = Date.now() - 30 * 24 * 60 * 60 * 1000;

  // Akkumulatoren pro Produkt-Schlüssel ("noname:<id>" / "marken:<id>").
  // Wir fahren BEIDE (overall + monthly) parallel im selben Stream-
  // durchlauf — nur ein Scan, doppelter Output.
  const aggOverall = new Map();
  const aggMonthly = new Map();

  const upsert = (map, key, type, productId, overall, hasComment, ts, comment) => {
    const existing = map.get(key);
    if (existing) {
      existing.sum += overall;
      existing.count += 1;
      if (hasComment) existing.commentCount += 1;
      if (hasComment && ts > existing.latestTs) {
        existing.latestComment = comment;
        existing.latestRating = overall;
        existing.latestTs = ts;
      }
    } else {
      map.set(key, {
        id: productId,
        type,
        sum: overall,
        count: 1,
        commentCount: hasComment ? 1 : 0,
        latestComment: hasComment ? comment : null,
        latestRating: hasComment ? overall : null,
        latestTs: hasComment ? ts : 0,
      });
    }
  };

  let lastDoc = null;
  const PAGE = 5000;
  let scanned = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db
      .collection('productRatings')
      .select('productID', 'brandProductID', 'ratingOverall', 'comment', 'ratedate')
      .limit(PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    for (const docSnap of snap.docs) {
      const d = docSnap.data();
      scanned += 1;
      const productRef = d.productID || d.brandProductID;
      if (!productRef) continue;
      const isNoName = !!d.productID;
      const productId = refToId(productRef);
      if (!productId) continue;
      const overall = Number(d.ratingOverall) || 0;
      if (overall <= 0) continue;
      const ts = tsToMillis(d.ratedate);
      const comment = (d.comment ?? '').toString().trim();
      const hasComment = comment.length > 0;
      const key = `${isNoName ? 'noname' : 'marken'}:${productId}`;
      const type = isNoName ? 'noname' : 'marken';

      upsert(aggOverall, key, type, productId, overall, hasComment, ts, comment);
      if (ts >= cutoffMonth) {
        upsert(aggMonthly, key, type, productId, overall, hasComment, ts, comment);
      }
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  console.log(
    `    → ${scanned} ratings scanned, ${aggOverall.size} unique products overall, ${aggMonthly.size} this month (${Date.now() - start} ms)`,
  );
  return { aggOverall, aggMonthly };
}

// Bayesian-Avg × log10(1 + count + 2*commentCount). Filtert Produkte
// ohne Kommentar raus (= Card-Render erfordert Kommentar-Excerpt).
// Returnt FLAT items so enrichProducts has direct `.id`/`.type` access.
function rankRatings(aggMap, limitN) {
  const items = Array.from(aggMap.values()).filter((a) => a.commentCount > 0);
  if (items.length === 0) return [];
  const C = 3;
  const totalSum = items.reduce((s, a) => s + a.sum, 0);
  const totalCount = items.reduce((s, a) => s + a.count, 0);
  const m = totalCount > 0 ? totalSum / totalCount : 0;
  const scored = items.map((a) => {
    const rawAvg = a.sum / a.count;
    const bayesian = (C * m + a.sum) / (C + a.count);
    const engagement = Math.log10(1 + a.count + 2 * a.commentCount);
    return {
      id: a.id,
      type: a.type,
      count: a.count,
      commentCount: a.commentCount,
      latestComment: a.latestComment,
      latestRating: a.latestRating,
      rawAvg,
      score: bayesian * engagement,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limitN);
}

// ─── Stage B: aggregate journey views (most-viewed) ─────────────

async function aggregateMostViewed() {
  console.log('  [B] streaming journeys.viewedProducts (collectionGroup) …');
  const start = Date.now();

  const cutoffMonth = Date.now() - 30 * 24 * 60 * 60 * 1000;
  // Map<key="noname:<id>"|"marken:<id>", { id, type, count }>.
  // Pro Journey wird ein Produkt nur 1× gezählt (Set-Dedupe), damit
  // ein einzelner User der das gleiche Produkt 100× öffnet nicht
  // die Liste dominiert. Dieselbe Journey ≈ eine Browse-Session.
  const counts = new Map();

  // Server-side filter auf `lastUpdated >= cutoff` — vermeidet
  // Streaming der ganzen Journey-Historie. Braucht Single-Field
  // Index auf `lastUpdated` mit `queryScope: COLLECTION_GROUP`
  // (siehe firestore.indexes.json).
  // Plus kleinere Page-Size: `viewedProducts`-Arrays können groß
  // sein, 2k pro Batch hält die Antwort-Pakete handhabbar.
  const cutoffTs = admin.firestore.Timestamp.fromMillis(cutoffMonth);
  let lastDoc = null;
  const PAGE = 2000;
  let scanned = 0;
  let withinWindow = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db
      .collectionGroup('journeys')
      .where('lastUpdated', '>=', cutoffTs)
      .orderBy('lastUpdated', 'asc')
      .select('viewedProducts')
      .limit(PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    for (const docSnap of snap.docs) {
      scanned += 1;
      const d = docSnap.data();
      // Date-Filter ist server-seitig, hier nur noch optional
      // Sanity-Check (z.B. falls lastUpdated fehlt — bleibt
      // dann außen vor durch das fehlende Index-Match).
      withinWindow += 1;

      const arr = Array.isArray(d.viewedProducts) ? d.viewedProducts : [];
      // Pro Journey: einzigartige Produkte zählen.
      const uniqInJourney = new Set();
      for (const vp of arr) {
        if (!vp?.productId) continue;
        const type = vp.productType === 'brand' || vp.productType === 'marken'
          ? 'marken'
          : 'noname';
        uniqInJourney.add(`${type}:${vp.productId}`);
      }
      for (const key of uniqInJourney) {
        const existing = counts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          const [type, id] = key.split(':');
          counts.set(key, { id, type, count: 1 });
        }
      }
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  console.log(
    `    → ${scanned} journeys scanned (${withinWindow} within last 30d), ${counts.size} unique products viewed (${Date.now() - start} ms)`,
  );
  // Top-N nach Count, Tiebreaker random für Variation pro Run.
  const ranked = Array.from(counts.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return Math.random() - 0.5;
  });
  return ranked.slice(0, POOL_N);
}

// ─── Stage C: enrich (resolve product + joins) ──────────────────

async function enrichProducts(items) {
  // Joins-Cache pro Run — vermeidet doppelte ref-fetches.
  const refDocCache = new Map();
  const getRef = async (collection, id) => {
    const key = `${collection}/${id}`;
    if (refDocCache.has(key)) return refDocCache.get(key);
    try {
      const snap = await db.collection(collection).doc(id).get();
      const data = snap.exists ? snap.data() : null;
      refDocCache.set(key, data);
      return data;
    } catch {
      refDocCache.set(key, null);
      return null;
    }
  };

  const enriched = await Promise.all(
    items.map(async (it) => {
      const collectionName = it.type === 'noname' ? 'produkte' : 'markenProdukte';
      try {
        const productSnap = await db.collection(collectionName).doc(it.id).get();
        if (!productSnap.exists) return null;
        const product = productSnap.data();

        // Joins
        const handelsmarkeId =
          it.type === 'noname' ? refToId(product.handelsmarke) : null;
        const discounterId =
          it.type === 'noname' ? refToId(product.discounter) : null;
        const herstellerId =
          it.type === 'marken' ? refToId(product.hersteller) : null;

        const [hm, dc, herst] = await Promise.all([
          handelsmarkeId ? getRef('handelsmarken', handelsmarkeId) : Promise.resolve(null),
          discounterId ? getRef('discounter', discounterId) : Promise.resolve(null),
          herstellerId ? getRef('hersteller', herstellerId) : Promise.resolve(null),
        ]);

        return {
          id: it.id,
          type: it.type,
          name: product.name ?? 'Produkt',
          bild: product.bild ?? null,
          preis: typeof product.preis === 'number' ? product.preis : null,
          stufe: parseInt(String(product.stufe ?? '')) || 0,
          // Handelsmarke (NoName) — Eyebrow + kleines Logo
          brandName: hm ? hm.bezeichnung ?? hm.name ?? null : null,
          brandLogoUri: hm ? hm.bild ?? null : null,
          // Discounter (NoName) — Markt-Logo + -Name + Land
          marketName: dc ? dc.name ?? null : null,
          marketCountry: dc ? dc.land ?? null : null,
          marketLogoUri: dc ? dc.bild ?? null : null,
          // Hersteller (Marken) — Eyebrow für Markenprodukte
          herstellerName: herst ? herst.name ?? herst.bezeichnung ?? null : null,
          herstellerLogoUri: herst ? herst.bild ?? null : null,
          // Stage-spezifische Felder. Top-Rated hat `score`/`rawAvg`,
          // Most-Viewed nur `count`. `count` ist auf beiden gesetzt
          // (rating count vs view count) — durch `score`-Test
          // unterscheiden wir ob's eine Rating- oder View-Liste ist.
          ...(it.score !== undefined && {
            avgRating: Math.round(it.rawAvg * 10) / 10,
            ratingCount: it.count ?? null,
            commentCount: it.commentCount ?? null,
            latestComment: it.latestComment ?? null,
            latestRating: it.latestRating ?? null,
          }),
          ...(it.score === undefined && it.count !== undefined && {
            viewCount: it.count,
          }),
        };
      } catch (e) {
        console.warn(`enrichProducts: failed for ${it.id}`, e?.message);
        return null;
      }
    }),
  );

  return enriched.filter((x) => !!x);
}

// ─── Build & Write ──────────────────────────────────────────────

async function buildAndWrite() {
  const t0 = Date.now();
  console.log('aggregateTopProducts: starting');

  // Stage A — productRatings
  const { aggOverall, aggMonthly } = await aggregateRatings();
  const overallRanked = rankRatings(aggOverall, POOL_N);
  const monthlyRanked = rankRatings(aggMonthly, POOL_N);

  // Stage B — journeys
  const mostViewedRanked = await aggregateMostViewed();

  // Stage C — Joins resolven für alle drei Listen.
  // Gemeinsamer Join-Cache durch Aufruf in einem einzigen
  // enrichProducts pro Liste; theoretisch könnten dieselben
  // Produkte in mehreren Listen sein → dann wären die Joins
  // doppelt geholt. Akzeptable Verschwendung bei <100 Items
  // total.
  console.log('  [C] enriching with product + joins …');
  const enrichStart = Date.now();
  const [overallEnriched, monthlyEnriched, mostViewedEnriched] = await Promise.all([
    enrichProducts(overallRanked),
    enrichProducts(monthlyRanked),
    enrichProducts(mostViewedRanked),
  ]);
  console.log(
    `    → enriched ${overallEnriched.length}/${monthlyEnriched.length}/${mostViewedEnriched.length} (${Date.now() - enrichStart} ms)`,
  );

  // Auf TOP_N kürzen + Write
  const overall = overallEnriched.slice(0, TOP_N);
  const monthly = monthlyEnriched.slice(0, TOP_N);
  const mostViewed = mostViewedEnriched.slice(0, TOP_N);

  await db
    .collection(AGG_PATH[0])
    .doc(AGG_PATH[1])
    .set({
      version: 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      overall,
      monthly,
      mostViewed,
    });

  console.log(
    `aggregateTopProducts: done — overall=${overall.length}, monthly=${monthly.length}, mostViewed=${mostViewed.length}, total ${Date.now() - t0} ms`,
  );
  return { overall: overall.length, monthly: monthly.length, mostViewed: mostViewed.length };
}

// ─── Trigger 1: scheduled (weekly) ──────────────────────────────
exports.aggregateTopProducts = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('every monday 03:30')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    await buildAndWrite();
    return null;
  });

// ─── Trigger 2: manual HTTP — for first deploy / ad-hoc rebuilds ─
exports.aggregateTopProductsHttp = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (_req, res) => {
    try {
      const result = await buildAndWrite();
      res.status(200).json({ ok: true, ...result });
    } catch (e) {
      console.error('aggregateTopProductsHttp failed:', e);
      res.status(500).json({ ok: false, error: String(e) });
    }
  });
