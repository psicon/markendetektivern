/**
 * Leaderboard Aggregator — runs nightly via Cloud Scheduler.
 *
 * Streams all journeys + users, builds three pre-computed lists
 * (Bundesländer × users, Städte × users, top individual users) and
 * writes them to ONE Firestore doc: aggregates/leaderboard_v1.
 *
 * The app reads that single doc per session — 1 read, ~10 KB —
 * regardless of how many users exist behind it.
 *
 * Deploy as a Firebase Cloud Function (Node 20):
 *   firebase deploy --only functions:aggregateLeaderboard
 *
 * Schedule via Cloud Scheduler (or pubsub.schedule):
 *   pubsub.schedule('every day 03:00').timeZone('Europe/Berlin')
 *
 * Cost (199k users / 619k journeys today):
 *   • ~620k journey reads + ~199k user reads ≈ 0.55 €
 *   • Compute (5–10 min @ 256 MB): a few cents
 *   • Daily total: ~17 €/month — negligible for the feature
 *
 * At 500k users / 1.5M journeys: ~37 €/month. Still negligible.
 * Beyond 5M users we'd switch to BigQuery for the journey scan.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');

// City → Bundesland lookup. Kept inline so the function doesn't
// depend on the app's TypeScript build. Source-of-truth lives in
// `lib/data/city-to-bundesland.ts` — keep them in sync (or move to
// a shared package later).
const CITY_TO_BUNDESLAND = require('./city-to-bundesland.json');

const BUNDESLAENDER = [
  'Baden-Württemberg', 'Bayern', 'Berlin', 'Brandenburg', 'Bremen',
  'Hamburg', 'Hessen', 'Mecklenburg-Vorpommern', 'Niedersachsen',
  'Nordrhein-Westfalen', 'Rheinland-Pfalz', 'Saarland', 'Sachsen',
  'Sachsen-Anhalt', 'Schleswig-Holstein', 'Thüringen',
];

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

function tsToMillis(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t === 'number') return t;
  if (t._seconds) return t._seconds * 1000;
  return 0;
}

async function streamUserCities() {
  const userCity = new Map();
  let lastDoc = null;
  const PAGE = 5000;
  while (true) {
    let q = db
      .collectionGroup('journeys')
      .select('location', 'lastUpdated')
      .orderBy('__name__')
      .limit(PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    snap.forEach((d) => {
      const data = d.data();
      const loc = data.location;
      if (!loc || !loc.city || loc.source === 'fallback') return;
      if (loc.city === 'DACH-Region') return;
      const uid = d.ref.parent.parent && d.ref.parent.parent.id;
      if (!uid) return;
      const ts = tsToMillis(data.lastUpdated);
      let entry = userCity.get(uid);
      if (!entry) {
        entry = { tally: new Map(), latest: { city: loc.city, ts } };
        userCity.set(uid, entry);
      }
      entry.tally.set(loc.city, (entry.tally.get(loc.city) || 0) + 1);
      if (ts > entry.latest.ts) entry.latest = { city: loc.city, ts };
    });
    lastDoc = snap.docs[snap.docs.length - 1];
  }
  // Reduce to most-frequent city per user.
  const final = new Map();
  userCity.forEach((entry, uid) => {
    let best = null;
    let bestCount = -1;
    entry.tally.forEach((count, city) => {
      if (count > bestCount || (count === bestCount && city === entry.latest.city)) {
        best = city;
        bestCount = count;
      }
    });
    final.set(uid, best);
  });
  return final;
}

async function aggregateUsers(userCity) {
  const blAgg = new Map();
  const cityAgg = new Map();
  const userCandidates = [];
  let lastDoc = null;
  const PAGE = 5000;
  while (true) {
    let q = db
      .collection('users')
      .select('city', 'bundesland', 'totalSavings', 'stats', 'display_name', 'photo_url')
      .orderBy('__name__')
      .limit(PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    snap.forEach((d) => {
      const data = d.data();
      let city = null;
      let bl = null;
      if (data.city) {
        city = data.city;
        bl = data.bundesland || CITY_TO_BUNDESLAND[city] || null;
      } else {
        const guessed = userCity.get(d.id);
        if (guessed) {
          city = guessed;
          bl = CITY_TO_BUNDESLAND[city] || null;
        }
      }
      const eur = Number(data.totalSavings || 0);
      const pts = Number((data.stats && data.stats.pointsTotal) || 0);
      const level = Number((data.stats && data.stats.currentLevel) || 1);
      const displayName = String(data.display_name || '').trim();

      if (
        pts > 0 &&
        displayName &&
        displayName !== 'Anonymer Nutzer' &&
        displayName !== 'Anonymer Detektiv'
      ) {
        userCandidates.push({
          id: d.id,
          name: displayName,
          photoUrl: data.photo_url || null,
          city: city || null,
          bundesland: bl || null,
          level,
          pts,
          eur,
        });
      }

      if (!bl || !city) return;

      const productsSaved = Number((data.stats && data.stats.productsSaved) || 0);

      const bRow = blAgg.get(bl) || { pts: 0, eur: 0, productsSaved: 0, users: 0 };
      bRow.pts += pts;
      bRow.eur += eur;
      bRow.productsSaved += productsSaved;
      bRow.users += 1;
      blAgg.set(bl, bRow);

      const cRow = cityAgg.get(city) || { bl, pts: 0, eur: 0, productsSaved: 0, users: 0 };
      cRow.pts += pts;
      cRow.eur += eur;
      cRow.productsSaved += productsSaved;
      cRow.users += 1;
      cityAgg.set(city, cRow);
    });
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  // Sort all candidates once — used for both the topUsers slice and
  // for percentile thresholds.
  const sorted = userCandidates.sort(
    (a, b) => b.pts - a.pts || b.eur - a.eur,
  );
  const topUsers = sorted
    .slice(0, 100)
    .map((u, i) => ({ ...u, rank: i + 1 }));

  // Percentile thresholds across all users with points > 0. The
  // client uses these to render a motivational "Better than X%"
  // line for users outside the top-100. Thresholds are pts-values:
  // a user with pts >= thresholds.p90 is in the top 10%, etc.
  const totalWithPts = sorted.length;
  const ptsAt = (p) => {
    if (totalWithPts === 0) return 0;
    // p is the "top X%" cutoff — index from the top.
    const idx = Math.min(
      totalWithPts - 1,
      Math.max(0, Math.floor((p / 100) * totalWithPts)),
    );
    return sorted[idx].pts;
  };
  const percentileThresholds = {
    p1: ptsAt(1),    // top 1%
    p5: ptsAt(5),    // top 5%
    p10: ptsAt(10),
    p25: ptsAt(25),
    p50: ptsAt(50),
    p75: ptsAt(75),
    p90: ptsAt(90),
  };

  return {
    blAgg,
    cityAgg,
    topUsers,
    totalUsersWithPts: totalWithPts,
    percentileThresholds,
  };
}


async function buildAndWrite() {
  console.log('aggregateLeaderboard: starting');
  const userCity = await streamUserCities();
  console.log(`  userCity map size: ${userCity.size}`);
  const { blAgg, cityAgg, topUsers, totalUsersWithPts, percentileThresholds } =
    await aggregateUsers(userCity);
  console.log(
    `  bl: ${blAgg.size}, cities: ${cityAgg.size}, topUsers: ${topUsers.length}, totalUsersWithPts: ${totalUsersWithPts}`,
  );

  // Period-windowed leaderboards (week / month) are NOT built here.
  // They run as live Firestore queries from the app against the
  // existing `leaderboards` collection that the legacy
  // `leaderboardService.updateUserStats(...)` already keeps
  // up-to-date on every points/savings event. One indexed query per
  // user session (`orderBy('stats.points.weekly').limit(25)`) reads
  // ~25 docs and costs effectively nothing. Year ("Champion") is
  // dropped from the period switcher entirely. Lifetime ("Aller
  // Zeiten") continues to be served from this aggregator.

  const blRows = BUNDESLAENDER
    .map((name) => {
      const r = blAgg.get(name) || { pts: 0, eur: 0, productsSaved: 0, users: 0 };
      return { key: name, label: name, ...r };
    })
    .sort((a, b) => b.pts - a.pts || b.eur - a.eur)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  const cityRows = Array.from(cityAgg.entries())
    .map(([city, r]) => ({ key: city, label: city, ...r }))
    .sort((a, b) => b.pts - a.pts || b.eur - a.eur)
    .slice(0, 50)
    .map((r, i) => ({ ...r, rank: i + 1 }));

  await db.collection('aggregates').doc('leaderboard_v1').set({
    version: 4,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    bundesland: blRows,
    cities: cityRows,
    topUsers,
    totalUsersWithRegion: blRows.reduce((s, r) => s + r.users, 0),
    totalUsersWithPts,
    percentileThresholds,
  });
  console.log('aggregateLeaderboard: done');
}

// ─── Scheduled trigger — runs every night at 03:00 Berlin time ──────────
exports.aggregateLeaderboard = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('every day 03:00')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    await buildAndWrite();
    return null;
  });

// ─── Manual trigger (HTTP) — for ad-hoc reruns / first deploy ──────────
exports.aggregateLeaderboardManual = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    // Lightweight auth: a static key from the env. Anyone with the
    // key can trigger; without it, request is rejected. Set via
    //   firebase functions:config:set leaderboard.trigger_key="…"
    const expected = functions.config()?.leaderboard?.trigger_key;
    if (!expected || req.query.key !== expected) {
      res.status(401).send('Unauthorized');
      return;
    }
    try {
      await buildAndWrite();
      res.status(200).send('OK');
    } catch (e) {
      console.error(e);
      res.status(500).send(String(e));
    }
  });
