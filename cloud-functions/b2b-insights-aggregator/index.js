/**
 * B2B Insights Aggregator — runs nightly via Cloud Scheduler.
 *
 * Streams all journeys + purchases and builds ANONYMOUS aggregate metrics
 * into ONE Firestore doc: aggregates/b2b_insights_v1. NEVER per-user — every
 * cell carries a distinct-user count and is SUPPRESSED below MIN_USERS
 * (k-anonymity). This is the B2B layer from ClickUp 86ca1h3fk.
 *
 * Metrics computed from data we already have:
 *   1. Quality-aware switching (FLAGSHIP) — using the per-product aiVerdict +
 *      qualityEngagement written by Slice A: when the AI says the NoName is
 *      "besser" / "gleichwertig" / "schlechter" AND the user engaged with
 *      quality, how often did they pick NoName vs the brand? → brand-equity
 *      strength (chose brand despite an equal/better NoName).
 *   2. Conversion funnel — viewed → compared → cart → purchased totals.
 *   3. Decision split — NoName vs Marke chosen overall.
 *   4. Category demand — purchase counts + avg savings per category (k-anon).
 *   5. Price bands — p25/p50/p75 of purchase prices.
 *   6. Discounter distribution — purchase counts per discounter (k-anon).
 *
 * NOT computed here (needs a product→hersteller denormalisation; follow-up):
 *   • Per-BRAND leakage index / per-brand switch-price-threshold. The journey
 *     stores productId, not hersteller — resolving brand per product is an
 *     expensive join. Denormalise hersteller onto viewedProducts (Slice A+) or
 *     export to BigQuery, then add the per-brand cut here.
 *
 * Deploy (Node 22):
 *   firebase deploy --only functions:aggregateB2bInsights
 * Manual run:
 *   functions:aggregateB2bInsightsManual (HTTPS)
 *
 * Cost: same order as the leaderboard aggregator (one nightly streamed scan).
 * Beyond ~5M users move the scan to BigQuery.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// k-anonymity: suppress any cell backed by fewer than this many distinct users.
const MIN_USERS = 20;

function userIdFromSubcollectionDoc(doc) {
  // journeys/purchases live at users/{uid}/<coll>/{id}
  try {
    return doc.ref.parent.parent ? doc.ref.parent.parent.id : null;
  } catch {
    return null;
  }
}

function refId(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.includes('/') ? v.split('/').pop() : v;
  if (v.id) return v.id;
  if (v._path && Array.isArray(v._path.segments)) return v._path.segments[v._path.segments.length - 1];
  return null;
}

function decisionOf(vp) {
  const actions = Array.isArray(vp && vp.actions) ? vp.actions : [];
  const has = (t) => actions.some((a) => a && a.type === t);
  if (has('purchased')) return 'purchased';
  if (has('converted') || has('converted_from')) return 'converted';
  if (has('addedToCart')) return 'cart';
  if (has('addedToFavorites')) return 'favorite';
  return null;
}

async function aggregate() {
  const startedAt = Date.now();

  // ── 1–3: scan journeys ───────────────────────────────────────────────
  const funnel = { viewed: 0, compared: 0, cart: 0, purchased: 0 };
  const decisionSplit = { noname: 0, marke: 0 };
  // verdict → { nonameChosen, markeChosen } (only quality-engaged decisions)
  const qaSwitch = {
    besser: { noname: 0, marke: 0 },
    gleichwertig: { noname: 0, marke: 0 },
    schlechter: { noname: 0, marke: 0 },
  };
  const qaUsers = { besser: new Set(), gleichwertig: new Set(), schlechter: new Set() };

  const journeysSnap = await db
    .collectionGroup('journeys')
    .select('viewedProducts')
    .get();

  journeysSnap.forEach((doc) => {
    const uid = userIdFromSubcollectionDoc(doc);
    const vps = doc.get('viewedProducts');
    if (!Array.isArray(vps)) return;
    for (const vp of vps) {
      const actions = Array.isArray(vp.actions) ? vp.actions : [];
      if (actions.some((a) => a && a.type === 'viewed')) funnel.viewed += 1;
      if (actions.some((a) => a && a.type === 'compared')) funnel.compared += 1;
      const decision = decisionOf(vp);
      if (decision === 'cart') funnel.cart += 1;
      if (decision === 'purchased') funnel.purchased += 1;
      if (!decision) continue;

      const isNoName = vp.productType === 'noname' || decision === 'converted';
      decisionSplit[isNoName ? 'noname' : 'marke'] += 1;

      const engaged = vp.qualityEngagement && vp.qualityEngagement.engaged === true;
      const verdict = vp.aiVerdict;
      if (engaged && qaSwitch[verdict]) {
        qaSwitch[verdict][isNoName ? 'noname' : 'marke'] += 1;
        if (uid) qaUsers[verdict].add(uid);
      }
    }
  });

  // Suppress quality-aware-switching buckets below k-anonymity threshold.
  const qualityAwareSwitching = {};
  for (const v of ['besser', 'gleichwertig', 'schlechter']) {
    const c = qaSwitch[v];
    const total = c.noname + c.marke;
    if (qaUsers[v].size < MIN_USERS || total === 0) {
      qualityAwareSwitching[v] = { suppressed: true };
    } else {
      qualityAwareSwitching[v] = {
        nonameChosen: c.noname,
        markeChosen: c.marke,
        nonameShare: +(c.noname / total).toFixed(3),
        // "besser" + markeChosen = brand-equity strength (chose brand despite
        // the NoName being rated better).
        brandEquityShare: +(c.marke / total).toFixed(3),
        sampleUsers: qaUsers[v].size,
      };
    }
  }

  // ── 4–6: scan purchases ──────────────────────────────────────────────
  const catCounts = {}; // catId → { count, savingsSum, users:Set }
  const discCounts = {}; // discId → { count, users:Set }
  const prices = [];

  const purchasesSnap = await db
    .collectionGroup('purchases')
    .select('discounter', 'savings', 'preis', 'kategorie')
    .get();

  purchasesSnap.forEach((doc) => {
    const uid = userIdFromSubcollectionDoc(doc);
    const catId = refId(doc.get('kategorie'));
    const discId = refId(doc.get('discounter'));
    const savings = Number(doc.get('savings')) || 0;
    const preis = Number(doc.get('preis'));
    if (Number.isFinite(preis) && preis > 0) prices.push(preis);
    if (catId) {
      const c = (catCounts[catId] = catCounts[catId] || { count: 0, savingsSum: 0, users: new Set() });
      c.count += 1;
      c.savingsSum += savings;
      if (uid) c.users.add(uid);
    }
    if (discId) {
      const d = (discCounts[discId] = discCounts[discId] || { count: 0, users: new Set() });
      d.count += 1;
      if (uid) d.users.add(uid);
    }
  });

  const categoryDemand = Object.entries(catCounts)
    .filter(([, c]) => c.users.size >= MIN_USERS)
    .map(([id, c]) => ({ categoryId: id, purchases: c.count, avgSavings: +(c.savingsSum / c.count).toFixed(2), users: c.users.size }))
    .sort((a, b) => b.purchases - a.purchases);

  const discounterDemand = Object.entries(discCounts)
    .filter(([, d]) => d.users.size >= MIN_USERS)
    .map(([id, d]) => ({ discounterId: id, purchases: d.count, users: d.users.size }))
    .sort((a, b) => b.purchases - a.purchases);

  prices.sort((a, b) => a - b);
  const pct = (p) => (prices.length ? +prices[Math.min(prices.length - 1, Math.floor(p * prices.length))].toFixed(2) : null);
  const priceBand = prices.length ? { p25: pct(0.25), p50: pct(0.5), p75: pct(0.75), n: prices.length } : null;

  const payload = {
    version: 'b2b_insights_v1',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    minUsersThreshold: MIN_USERS,
    funnel,
    decisionSplit,
    qualityAwareSwitching,
    categoryDemand,
    discounterDemand,
    priceBand,
    computeMs: Date.now() - startedAt,
    journeysScanned: journeysSnap.size,
    purchasesScanned: purchasesSnap.size,
  };

  await db.collection('aggregates').doc('b2b_insights_v1').set(payload, { merge: false });
  return payload;
}

exports.aggregateB2bInsights = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .pubsub.schedule('every day 04:00')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    const r = await aggregate();
    console.log('✅ b2b_insights_v1 written', JSON.stringify(r).slice(0, 400));
    return null;
  });

// Manual trigger for testing/backfill.
exports.aggregateB2bInsightsManual = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onRequest(async (req, res) => {
    try {
      const r = await aggregate();
      res.json({ ok: true, ...r });
    } catch (e) {
      console.error('b2b aggregate failed', e);
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });
