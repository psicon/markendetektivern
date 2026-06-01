/**
 * Preference Profile CF — nightly. The server half of the hybrid producer
 * (ClickUp 86ca1h3fk, Slice B/D follow-up):
 *
 *   1. DRIFT-DECAY — pulls each user's profile dimensions toward neutral by a
 *      half-life factor based on time since the last client update. Implements
 *      the "Half-Life ~30–60 Tage" longitudinal requirement that the client
 *      EWMA (session-count-based) can't do on its own.
 *   2. FACTS — category-based lifestyle facts from users/{uid}/purchases
 *      (petOwner, hasBaby, dietary vegan/vegetarian, alcoholBuyer). Written
 *      into users/{uid}/profile/preferences.facts with confidence + source.
 *
 * Race-safe vs the client EWMA: decay scales with time-since-updatedAt, so a
 * just-updated profile barely decays; facts are written under the separate
 * `facts` key (merge) and never touch `dimensions`/`confidence`.
 *
 * Deploy (Node 22): firebase deploy --only functions:decayPreferenceProfiles
 * Manual: functions:decayPreferenceProfilesManual (HTTPS)
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const DIMENSIONS = [
  'price', 'brandLoyalty', 'marketLoyalty', 'contentQuality', 'health',
  'sustainability', 'exploration', 'noNameOpenness', 'thoroughness',
];
const NEUTRAL = 1 / DIMENSIONS.length; // ~0.111 (dims are a distribution)
const FACT_MIN_PURCHASES = 2; // mind. 2 Käufe in der Kategorie → Fakt

// Category name → fact mapping (resolved to ids at runtime from `kategorien`).
const FACT_CATEGORY_NAMES = {
  'Fürs Haustier': 'petOwner',
  'Fürs Baby': 'hasBaby',
  'Alkohol': 'alcoholBuyer',
  'Veggie und Vegan': 'veggie',
};

function refId(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.includes('/') ? v.split('/').pop() : v;
  if (v.id) return v.id;
  if (v._path && Array.isArray(v._path.segments)) return v._path.segments[v._path.segments.length - 1];
  return null;
}

async function run() {
  const startedAt = Date.now();

  // Resolve fact-relevant category ids.
  const catSnap = await db.collection('kategorien').get();
  const catIdToFact = {};
  catSnap.forEach((d) => {
    const name = (d.data().bezeichnung || d.data().name || '').trim();
    if (FACT_CATEGORY_NAMES[name]) catIdToFact[d.id] = FACT_CATEGORY_NAMES[name];
  });

  // Per-user purchase aggregation: facts + #4 (topCategories/topBrands/
  // priceBand) + #3-rest (stufenTrust = Stufen-Vertrauen, activity/churn).
  const userFactCounts = {}; // uid → { petOwner, hasBaby, alcoholBuyer, veggie }
  const userAgg = {}; // uid → { cats:{}, brands:{}, prices:[], stufeSum, stufeN, lastTs }
  const purchasesSnap = await db
    .collectionGroup('purchases')
    .select('kategorie', 'hersteller', 'preis', 'stufe', 'createdAt')
    .get();
  purchasesSnap.forEach((doc) => {
    const uid = doc.ref.parent.parent ? doc.ref.parent.parent.id : null;
    if (!uid) return;
    const catId = refId(doc.get('kategorie'));
    const fact = catIdToFact[catId];
    if (fact) {
      const u = (userFactCounts[uid] = userFactCounts[uid] || {});
      u[fact] = (u[fact] || 0) + 1;
    }
    const a = (userAgg[uid] = userAgg[uid] || { cats: {}, brands: {}, prices: [], stufeSum: 0, stufeN: 0, lastTs: 0 });
    if (catId) a.cats[catId] = (a.cats[catId] || 0) + 1;
    const brandId = refId(doc.get('hersteller'));
    if (brandId) a.brands[brandId] = (a.brands[brandId] || 0) + 1;
    const preis = Number(doc.get('preis'));
    if (Number.isFinite(preis) && preis > 0) a.prices.push(preis);
    const stufe = parseInt(String(doc.get('stufe') || '0'), 10);
    if (stufe >= 1 && stufe <= 5) {
      a.stufeSum += stufe;
      a.stufeN += 1;
    }
    const ts = doc.get('createdAt');
    const ms = ts && ts.toMillis ? ts.toMillis() : 0;
    if (ms > a.lastTs) a.lastTs = ms;
  });

  const topN = (counts, n) =>
    Object.entries(counts)
      .map(([id, c]) => ({ id, score: c }))
      .sort((x, y) => y.score - x.score)
      .slice(0, n);
  const percentile = (sorted, p) =>
    sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(2) : null;

  // Walk all profiles: decay dimensions + write facts. The profile lives at
  // users/{uid}/profile/preferences → collection 'profile', doc 'preferences'.
  const profilesSnap = await db.collectionGroup('profile').get();
  let decayed = 0;
  let factsWritten = 0;
  let profilesScanned = 0;
  const now = Date.now();
  const batchWrites = [];

  profilesSnap.forEach((doc) => {
    if (doc.id !== 'preferences') return;
    const uid = doc.ref.parent.parent ? doc.ref.parent.parent.id : null;
    if (!uid) return;
    profilesScanned += 1;
    const data = doc.data() || {};
    const update = {};

    // 1) Drift-decay.
    const dims = data.dimensions;
    const halfLife = Number(data.halfLifeDays) || 45;
    const updatedMs = data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : null;
    if (dims && updatedMs) {
      const days = (now - updatedMs) / 86400000;
      if (days >= 1) {
        const factor = Math.pow(0.5, days / halfLife); // 1 → unverändert, →0 mit der Zeit
        const newDims = {};
        const newConf = {};
        for (const d of DIMENSIONS) {
          const v = typeof dims[d] === 'number' ? dims[d] : NEUTRAL;
          newDims[d] = +(NEUTRAL + (v - NEUTRAL) * factor).toFixed(4);
          const c = data.confidence && typeof data.confidence[d] === 'number' ? data.confidence[d] : 0;
          newConf[d] = +(c * factor).toFixed(4);
        }
        update.dimensions = newDims;
        update.confidence = newConf;
        update.decayedAt = admin.firestore.FieldValue.serverTimestamp();
        decayed += 1;
      }
    }

    // 2) Facts.
    const counts = userFactCounts[uid];
    if (counts) {
      const facts = {};
      const mk = (n) => ({ value: true, confidence: Math.min(1, n / 6), source: 'inferred' });
      if ((counts.petOwner || 0) >= FACT_MIN_PURCHASES) facts.petOwner = mk(counts.petOwner);
      if ((counts.hasBaby || 0) >= FACT_MIN_PURCHASES) facts.hasBaby = mk(counts.hasBaby);
      if ((counts.alcoholBuyer || 0) >= FACT_MIN_PURCHASES) facts.alcoholBuyer = mk(counts.alcoholBuyer);
      if ((counts.veggie || 0) >= FACT_MIN_PURCHASES) {
        facts.dietary = { value: ['vegetarian'], confidence: Math.min(1, counts.veggie / 6), source: 'inferred' };
      }
      if (Object.keys(facts).length) {
        update.facts = facts;
        factsWritten += 1;
      }
    }

    // 3) #4 + #3-rest: topCategories / topBrands / priceBand / stufenTrust /
    //    activity (Aktivität-Churn) aus den aggregierten Käufen.
    const agg = userAgg[uid];
    if (agg && agg.prices.length + Object.keys(agg.cats).length > 0) {
      update.topCategories = topN(agg.cats, 5);
      update.topBrands = topN(agg.brands, 5);
      const sorted = agg.prices.slice().sort((x, y) => x - y);
      if (sorted.length) {
        update.priceBand = { p25: percentile(sorted, 0.25), p50: percentile(sorted, 0.5), p75: percentile(sorted, 0.75), n: sorted.length };
      }
      // Stufen-Vertrauen: durchschnittliche Ähnlichkeitsstufe der Käufe (1..5).
      if (agg.stufeN > 0) update.stufenTrust = +(agg.stufeSum / agg.stufeN).toFixed(2);
      // Aktivität/Churn: Tage seit letztem Kauf.
      if (agg.lastTs > 0) {
        update.lastPurchaseAt = agg.lastTs;
        update.daysSinceLastPurchase = Math.floor((now - agg.lastTs) / 86400000);
      }
    }

    if (Object.keys(update).length) batchWrites.push({ ref: doc.ref, update });
  });

  // Commit in chunks of 400.
  for (let i = 0; i < batchWrites.length; i += 400) {
    const batch = db.batch();
    batchWrites.slice(i, i + 400).forEach(({ ref, update }) => batch.set(ref, update, { merge: true }));
    await batch.commit();
  }

  return {
    profilesScanned,
    purchasesScanned: purchasesSnap.size,
    decayed,
    factsWritten,
    computeMs: Date.now() - startedAt,
  };
}

exports.decayPreferenceProfiles = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .pubsub.schedule('every day 03:30')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    const r = await run();
    console.log('✅ preference profiles decayed + facts', JSON.stringify(r));
    return null;
  });

exports.decayPreferenceProfilesManual = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onRequest(async (req, res) => {
    try {
      res.json({ ok: true, ...(await run()) });
    } catch (e) {
      console.error('decay failed', e);
      res.status(500).json({ ok: false, error: String(e && e.message) });
    }
  });
