/**
 * Journey Cleanup — runs nightly via Cloud Scheduler.
 *
 * Finalizes journeys that have been silently abandoned (App-Kill,
 * Force-Close, Crash) and never received a `completedAt`. The
 * in-app fix in `lib/services/journeyTrackingService.ts` covers the
 * happy-path (background → 30 s timer → finalize) but if iOS kills
 * the process before the 30-s timer fires, or the OS swipes the
 * app from the multitasking-stack mid-session, the journey doc
 * keeps `completedAt == null` forever.
 *
 * Strategy:
 *   • Query collectionGroup('journeys') WHERE lastUpdated < (now − 72h).
 *     The 72h window is intentional — short enough that stale docs
 *     don't accumulate, long enough that ein User der die App ein
 *     Wochenende nicht öffnet, NICHT als abandoned getaggt wird
 *     wenn er Montag zurückkommt. (Wenn die App nach 72h doch noch
 *     ein update auf dieselbe Journey schickt → finalizeJourney in
 *     der App writet completedAt=now, das überschreibt unseren
 *     stale-cleanup harmlos.)
 *   • Für jeden Treffer mit completedAt == null:
 *       completedAt: lastUpdated  (kein "now" — wir wissen wann sie
 *                                  zuletzt aktiv war, das ist
 *                                  analytisch wertvoller)
 *       completionReason: 'stale_cleanup_72h'
 *       finalStatus: derive from journey state (purchased / in_cart /
 *                    abandoned / completed)
 *   • Batched writes (500/batch, Firestore-Limit).
 *
 * Cost @ 619k journeys total, ~5% stale:
 *   • ~31k Reads + ~31k Writes pro Lauf ≈ 0.02 €
 *   • Compute (60-120s @ 256MB): cent-Bereich
 *   • Daily: <1 €/Monat
 *
 * Deploy:
 *   firebase deploy --only functions:cleanupStaleJourneys
 *
 * Manuell triggern:
 *   curl "https://europe-west1-markendetektive-895f7.cloudfunctions.net/cleanupStaleJourneysManual?key=<TRIGGER_KEY>"
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const STALE_THRESHOLD_MS = 72 * 60 * 60 * 1000; // 72 hours
const PAGE_SIZE = 500; // max docs per query+batch (Firestore-Limit)

function tsToMillis(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t === 'number') return t;
  if (t && t._seconds) return t._seconds * 1000;
  return 0;
}

/**
 * Leitet den finalStatus aus dem Journey-Doc ab — analog zur
 * Logik in `journeyTrackingService.finalizeJourneyInFirestore`.
 */
function deriveFinalStatus(data) {
  if (data.purchased === true) return 'purchased';
  if (Array.isArray(data.addedToCart) && data.addedToCart.length > 0) {
    return 'in_cart';
  }
  if (data.abandoned) return 'abandoned';
  return 'abandoned'; // stale = abandoned by definition
}

async function cleanupStale() {
  const startedAt = Date.now();
  const cutoff = new Date(startedAt - STALE_THRESHOLD_MS);

  console.log(
    `journey-cleanup: scanning journeys with lastUpdated < ${cutoff.toISOString()} (72h ago)`,
  );

  let totalScanned = 0;
  let totalFinalized = 0;
  let totalSkipped = 0; // already finalized
  let lastDoc = null;
  let pageNum = 0;

  while (true) {
    pageNum += 1;
    let q = db
      .collectionGroup('journeys')
      .where('lastUpdated', '<', admin.firestore.Timestamp.fromDate(cutoff))
      .select('lastUpdated', 'completedAt', 'purchased', 'addedToCart', 'abandoned', 'startTime')
      .orderBy('lastUpdated', 'asc')
      .limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let writes = 0;

    snap.forEach((d) => {
      totalScanned += 1;
      const data = d.data();

      // Already finalized — skip (idempotency).
      if (data.completedAt) {
        totalSkipped += 1;
        return;
      }

      const lastUpdatedMs = tsToMillis(data.lastUpdated);
      const startMs = tsToMillis(data.startTime) || lastUpdatedMs;
      const durationMs = Math.max(0, lastUpdatedMs - startMs);

      // WICHTIG: lastUpdated NICHT anfassen — der leaderboard-
      // aggregator (03:00) liest lastUpdated als "letzte aktive
      // Stadt pro User". Würde diese Cleanup-Funktion lastUpdated
      // auf "jetzt" pushen, würden 1000e stale Journeys plötzlich
      // als "heute aktiv" gezählt → kaputte Geo-Stats. Doc-Update
      // mit explizit nur den Finalize-Feldern.
      batch.update(d.ref, {
        completedAt: data.lastUpdated, // use last activity, not now
        completionReason: 'stale_cleanup_72h',
        journeyDurationMs: durationMs,
        finalStatus: deriveFinalStatus(data),
      });
      writes += 1;
    });

    if (writes > 0) {
      await batch.commit();
      totalFinalized += writes;
      console.log(
        `journey-cleanup: page ${pageNum} — scanned=${snap.size}, finalized=${writes}, skipped=${snap.size - writes}`,
      );
    } else {
      console.log(
        `journey-cleanup: page ${pageNum} — scanned=${snap.size}, all already finalized`,
      );
    }

    lastDoc = snap.docs[snap.docs.length - 1];

    // Safety brake on runaway loop.
    if (pageNum > 1000) {
      console.warn('journey-cleanup: pageNum > 1000, breaking');
      break;
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `journey-cleanup: DONE — scanned=${totalScanned}, finalized=${totalFinalized}, skipped=${totalSkipped} in ${elapsedMs} ms`,
  );

  return { totalScanned, totalFinalized, totalSkipped, elapsedMs };
}

// ─── Scheduled trigger — runs every night at 02:30 Berlin time ──────────
//
// Vor dem Leaderboard-Aggregator (03:00). Reihenfolge wichtig:
// erst Cleanup (setzt completedAt für stale Journeys) → dann
// Aggregator (kann auf konsistenten Endzustand zugreifen).
exports.cleanupStaleJourneys = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('every day 02:30')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    await cleanupStale();
    return null;
  });

// ─── One-off recovery — restore lastUpdated for docs that the
// initial buggy cleanup-run (commit a8ef58d) clobbered. Original
// lastUpdated wurde dort als completedAt preserved → kopiere
// completedAt zurück in lastUpdated bei allen Docs mit
// completionReason='stale_cleanup_72h'. Idempotent: läuft nur
// für Docs wo lastUpdated > completedAt (= wurde von Cleanup
// nachtraeglich gepusht). Nach einmaligem Lauf können wir den
// Code wieder entfernen.
async function restoreStaleLastUpdated() {
  const startedAt = Date.now();
  // Der initiale Cleanup-Lauf lief zwischen 2026-05-16T08:18:25 und
  // 08:19:10 (45s). Wir nutzen den bestehenden lastUpdated-collectionGroup-
  // Index und filtern auf docs mit lastUpdated >= cleanup-start.
  // completionReason='stale_cleanup_72h' Filter geschieht in-code.
  const CLEANUP_START = new Date('2026-05-16T08:18:00Z');
  console.log(
    `journey-cleanup: RECOVERY — restoring lastUpdated for stale_cleanup_72h docs (touched >= ${CLEANUP_START.toISOString()})`,
  );

  let totalScanned = 0;
  let totalRestored = 0;
  let totalSkipped = 0;
  let lastDoc = null;
  let pageNum = 0;

  while (true) {
    pageNum += 1;
    let q = db
      .collectionGroup('journeys')
      .where('lastUpdated', '>=', admin.firestore.Timestamp.fromDate(CLEANUP_START))
      .select('lastUpdated', 'completedAt', 'completionReason')
      .orderBy('lastUpdated', 'asc')
      .limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let writes = 0;

    snap.forEach((d) => {
      totalScanned += 1;
      const data = d.data();
      // Nur die vom Cleanup berührten Docs anfassen.
      if (data.completionReason !== 'stale_cleanup_72h') {
        totalSkipped += 1;
        return;
      }
      const lastMs = tsToMillis(data.lastUpdated);
      const compMs = tsToMillis(data.completedAt);
      // Idempotenz: nur restoren wenn lastUpdated > completedAt
      // (= clobbered von initialem Run). Bei späteren Runs ist
      // lastUpdated bereits korrekt = completedAt.
      if (!compMs || lastMs <= compMs) {
        totalSkipped += 1;
        return;
      }
      batch.update(d.ref, { lastUpdated: data.completedAt });
      writes += 1;
    });

    if (writes > 0) {
      await batch.commit();
      totalRestored += writes;
      console.log(
        `journey-cleanup RECOVERY page ${pageNum}: scanned=${snap.size}, restored=${writes}, skipped=${snap.size - writes}`,
      );
    } else {
      console.log(
        `journey-cleanup RECOVERY page ${pageNum}: scanned=${snap.size}, none to restore`,
      );
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (pageNum > 1000) {
      console.warn('journey-cleanup RECOVERY: pageNum > 1000, breaking');
      break;
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `journey-cleanup RECOVERY DONE — scanned=${totalScanned}, restored=${totalRestored}, skipped=${totalSkipped} in ${elapsedMs} ms`,
  );
  return { totalScanned, totalRestored, totalSkipped, elapsedMs };
}

exports.restoreStaleLastUpdatedManual = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    const expected = functions.config()?.journeycleanup?.trigger_key;
    if (!expected || req.query.key !== expected) {
      res.status(401).send('Unauthorized');
      return;
    }
    try {
      const result = await restoreStaleLastUpdated();
      res.status(200).json(result);
    } catch (e) {
      console.error('journey-cleanup RECOVERY failed:', e);
      res.status(500).send(String(e?.message || e));
    }
  });

// ─── Manual trigger (HTTP) — for ad-hoc reruns / first deploy ──────────
exports.cleanupStaleJourneysManual = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    const expected = functions.config()?.journeycleanup?.trigger_key;
    if (!expected || req.query.key !== expected) {
      res.status(401).send('Unauthorized');
      return;
    }
    try {
      const result = await cleanupStale();
      res.status(200).json(result);
    } catch (e) {
      console.error('journey-cleanup manual run failed:', e);
      res.status(500).send(String(e?.message || e));
    }
  });
