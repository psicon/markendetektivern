/**
 * Release-Monitor Aggregator — versorgt das Monitoring-Dashboard
 * (Firebase Hosting: /monitor-md2026.html) mit frischen Zahlen.
 *
 * Berechnet in EINEM Lauf:
 *   • Sessions/Tag (letzte 14 Tage, via journeys.startTime — braucht den
 *     COLLECTION_GROUP-Index auf startTime, angelegt 12.07.2026)
 *   • v6-Verhaltens-Metriken (rollierendes 72h-Fenster, gesamt/iOS/Android)
 *   • Vor-Release-Baseline (fixes Fenster 04.–06.07.2026, Public 5.x)
 *
 * Output: aggregates/releaseMonitor_v1 — die aggregates-Collection ist per
 * Firestore-Rules öffentlich lesbar (read: if true), die Dashboard-Seite
 * liest das Doc unauthentifiziert per REST. Es landen NUR aggregierte
 * Kennzahlen im Doc, keinerlei PII.
 *
 * WICHTIG (Datenlage, 12.07.2026): journeys.lastUpdated ist bei ~759k
 * Alt-Docs ein defekt serialisierter serverTimestamp-Sentinel (Map mit
 * _methodName) — Zeitfenster IMMER über startTime, nie über lastUpdated.
 *
 * Trigger:
 *   • Scheduled alle 6 Stunden.
 *   • HTTP (manuell / „Neu berechnen"-Button der Seite). Kein Key, aber
 *     Spam-Schutz: läuft nur, wenn das Aggregat älter als 10 Min ist
 *     (gleiches Keyless-Muster wie aggregateTopProductsHttp).
 *
 * Deploy: firebase deploy --only functions:release-monitor
 * Manuell: curl https://europe-west1-markendetektive-895f7.cloudfunctions.net/aggregateReleaseMonitorHttp
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const AGG_PATH = ['aggregates', 'releaseMonitor_v1'];
const MIN_RECOMPUTE_GAP_MS = 10 * 60 * 1000;

// Fixe Vor-Release-Baseline (Public 5.x, vor dem 6.0-Store-Release am 11.07).
const OLD_FROM = new Date('2026-07-04T00:00:00Z');
const OLD_TO = new Date('2026-07-06T00:00:00Z');
// v6-Fenster: rollierend 72 h.
const V6_WINDOW_MS = 72 * 60 * 60 * 1000;

const SELECT_FIELDS = [
  'journeyId', 'viewedProductsCount', 'convertedCount', 'status',
  'completionReason', 'filterMetrics', 'consumerProfile', 'app',
  'scannedcodes', 'searchedproducts', 'customItems',
];

function ts(d) {
  return admin.firestore.Timestamp.fromDate(d);
}

async function countBetween(from, to) {
  const snap = await db
    .collectionGroup('journeys')
    .where('startTime', '>=', ts(from))
    .where('startTime', '<', ts(to))
    .count()
    .get();
  return snap.data().count;
}

async function sampleBetween(from, to, limit) {
  const snap = await db
    .collectionGroup('journeys')
    .where('startTime', '>=', ts(from))
    .where('startTime', '<', ts(to))
    .select(...SELECT_FIELDS)
    .limit(limit)
    .get();
  const rows = [];
  snap.forEach((d) => rows.push({
    ...(d.data() || {}),
    // users/{uid}/journeys/{id} → uid für die Pro-User-Metriken.
    _uid: d.ref.parent.parent ? d.ref.parent.parent.id : null,
  }));
  return rows;
}

/** Doppel-Docs pro journeyId (Alt-Bug) — vollstes Doc gewinnt. */
function dedupe(rows) {
  const best = new Map();
  for (const r of rows) {
    const k = r.journeyId || Math.random().toString(36);
    const prev = best.get(k);
    if (!prev || (r.viewedProductsCount || 0) > (prev.viewedProductsCount || 0)) {
      best.set(k, r);
    }
  }
  return [...best.values()];
}

function metrics(rows) {
  const n = rows.length;
  const fm = (r) => r.filterMetrics || {};
  const cp = (r) => r.consumerProfile || {};
  const nonEmpty = (a) => Array.isArray(a) && a.length > 0;
  let bounce = 0, zero = 0, viewsSum = 0, filter = 0, demo = 0, markt = 0;
  let cart = 0, purch = 0, conv = 0, scan = 0, such = 0, cust = 0;
  for (const r of rows) {
    const v = r.viewedProductsCount || 0;
    viewsSum += v;
    const fchg = fm(r).filterChangesCount || 0;
    const factive = fm(r).totalActiveFilters || 0;
    if (v === 0) zero += 1;
    if (v === 0 && fchg === 0 && !nonEmpty(r.scannedcodes) && !nonEmpty(r.searchedproducts) && !nonEmpty(r.customItems)) bounce += 1;
    if (factive > 0 || fchg > 0) filter += 1;
    const hasAge = cp(r).age != null && cp(r).age !== '';
    const hasGender = cp(r).gender != null && cp(r).gender !== '';
    if (hasAge || hasGender) demo += 1;
    if (cp(r).favoriteMarket) markt += 1;
    if (['in_cart', 'purchased', 'inactive_with_cart'].includes(r.status)) cart += 1;
    if (r.status === 'purchased') purch += 1;
    if ((r.convertedCount || 0) > 0) conv += 1;
    if (nonEmpty(r.scannedcodes)) scan += 1;
    if (nonEmpty(r.searchedproducts)) such += 1;
    if (nonEmpty(r.customItems)) cust += 1;
  }
  return {
    n,
    bounce, zero,
    avgViews: n ? Math.round((viewsSum / n) * 100) / 100 : 0,
    filter, demo, markt, cart, purch, conv, scan, such, cust,
  };
}

// ─── Pro-User-Metriken (Audit 12.07.2026) ────────────────────────
// Der Journey-Schnappschuss (consumerProfile) wird beim Journey-START
// aus dem users-Doc gezogen — Neu-User setzen Markt/Demografie aber
// erst SPÄTER im Onboarding derselben Session, Resume-Journeys lesen
// nie neu. Die Session-Quote unterzählt daher strukturell (gemessen:
// nur ~54 % der Sessions von Markt-Usern trugen den Stempel). Für
// Demografie/Markt/Onboarding daher direkt das users-Doc der im
// Fenster aktiven User lesen — pro User, nicht pro Sitzung.

function distinctUids(rows) {
  return [...new Set(rows.map((r) => r._uid).filter(Boolean))];
}

async function loadUserFacts(uids) {
  const map = new Map();
  for (let i = 0; i < uids.length; i += 100) {
    const chunk = uids.slice(i, i + 100);
    // eslint-disable-next-line no-await-in-loop
    const snaps = await db.getAll(
      ...chunk.map((u) => db.doc(`users/${u}`)),
      { fieldMask: ['favoriteMarket', 'age', 'gender', 'onboardingCompletedAt'] },
    );
    for (const s of snaps) {
      if (!s.exists) continue;
      const d = s.data() || {};
      map.set(s.id, {
        markt: !!d.favoriteMarket,
        demo: (d.age != null && d.age !== '') || (d.gender != null && d.gender !== ''),
        onboarding: !!d.onboardingCompletedAt,
      });
    }
  }
  return map;
}

function perUserMetrics(rows, facts) {
  const uids = distinctUids(rows);
  let markt = 0;
  let demo = 0;
  let onboarding = 0;
  for (const u of uids) {
    const f = facts.get(u);
    if (!f) continue;
    if (f.markt) markt += 1;
    if (f.demo) demo += 1;
    if (f.onboarding) onboarding += 1;
  }
  return { usersN: uids.length, userMarkt: markt, userDemo: demo, userOnboarding: onboarding };
}

async function aggregate() {
  const startedAt = Date.now();

  // 1) Sessions/Tag — letzte 14 Kalendertage (UTC-Tagesgrenzen).
  const daily = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i -= 1) {
    const from = new Date(today.getTime() - i * 86400000);
    const to = new Date(from.getTime() + 86400000);
    // eslint-disable-next-line no-await-in-loop
    const n = await countBetween(from, to);
    daily.push({ day: from.toISOString().slice(0, 10), n });
  }

  // 2) v6-Sample (rollierend 72 h) — nach Version 6.x gefiltert.
  const now = new Date();
  const v6raw = dedupe(await sampleBetween(new Date(now.getTime() - V6_WINDOW_MS), now, 5000));
  const isV6 = (r) => String((r.app || {}).version || '').startsWith('6.');
  const v6 = v6raw.filter(isV6);
  const v6ios = v6.filter((r) => (r.app || {}).os === 'ios');
  const v6android = v6.filter((r) => (r.app || {}).os === 'android');

  // 2b) Pro-User-Fakten für die im v6-Fenster aktiven User (ein
  // getAll-Read pro 100 User; bei ~500 Usern ≈ 500 Reads pro Lauf).
  const facts = await loadUserFacts(distinctUids(v6));

  // 3) Vor-Release-Baseline (fix) — alles außer 6.x-TestFlight.
  const oldRows = dedupe(await sampleBetween(OLD_FROM, OLD_TO, 3000)).filter((r) => !isV6(r));

  const doc = {
    version: 'releaseMonitor_v1',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    computeMs: 0, // wird unten gesetzt
    windows: {
      v6: 'rolling-72h',
      old: `${OLD_FROM.toISOString().slice(0, 10)}..${OLD_TO.toISOString().slice(0, 10)} (Public 5.x, fix)`,
    },
    daily,
    v6: {
      all: { ...metrics(v6), ...perUserMetrics(v6, facts) },
      ios: { ...metrics(v6ios), ...perUserMetrics(v6ios, facts) },
      android: { ...metrics(v6android), ...perUserMetrics(v6android, facts) },
    },
    old: metrics(oldRows),
  };
  doc.computeMs = Date.now() - startedAt;

  await db.doc(AGG_PATH.join('/')).set(doc);
  console.log(
    `release-monitor: OK — daily[${daily.length}], v6 n=${doc.v6.all.n} (ios ${doc.v6.ios.n}/android ${doc.v6.android.n}), old n=${doc.old.n}, ${doc.computeMs} ms`,
  );
  return doc;
}

// ─── Trigger 1: scheduled (alle 6 h) ─────────────────────────────
exports.aggregateReleaseMonitor = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .pubsub.schedule('every 6 hours')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    await aggregate();
    return null;
  });

// ─── Trigger 2: HTTP (Seite/„Neu berechnen" + manuell) ───────────
exports.aggregateReleaseMonitorHttp = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    // CORS für den Button auf der Hosting-Seite.
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, POST');
      res.status(204).send('');
      return;
    }
    try {
      // Spam-Schutz statt Key: nicht öfter als alle 10 Minuten rechnen.
      const cur = await db.doc(AGG_PATH.join('/')).get();
      const last = cur.exists && cur.data().updatedAt && cur.data().updatedAt.toMillis
        ? cur.data().updatedAt.toMillis()
        : 0;
      if (Date.now() - last < MIN_RECOMPUTE_GAP_MS) {
        res.status(200).json({ ok: true, skipped: 'fresh', ageMs: Date.now() - last });
        return;
      }
      const doc = await aggregate();
      res.status(200).json({ ok: true, v6n: doc.v6.all.n, oldn: doc.old.n, computeMs: doc.computeMs });
    } catch (e) {
      console.error('release-monitor http failed', e);
      res.status(500).json({ ok: false, error: String((e && e.message) || e) });
    }
  });
