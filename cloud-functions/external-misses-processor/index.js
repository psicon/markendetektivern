/**
 * external-misses-processor — scheduled CF, processed pending Misses
 * aus der `external_lookup_misses`-Collection.
 *
 * ─── Was das tut ─────────────────────────────────────────────────────
 *
 * Wenn der Client (mobile App) eine EAN scant für die unsere Cascade
 * keine guten Daten findet, schreibt er ein Doc nach
 * `external_lookup_misses/{ean}` mit `status: 'pending'`.
 *
 * Diese CF läuft scheduled (jede Stunde) und bearbeitet pending
 * Misses:
 *
 *   1. Picke bis zu BATCH_LIMIT pending Misses (sortiert nach
 *      hitCount desc → populärste EANs zuerst).
 *   2. Setze status → 'processing' (Lock, damit kein zweiter Run
 *      dieselben EANs parallel bearbeitet).
 *   3. HTTP-Call an `scrapeEan`-CF (nutrition-scraper). Die CF
 *      versucht alle whitelisted Shops (Globus, Kaufland, Rewe,
 *      Lidl, Atundo, … 30+ Domains), schreibt bei Erfolg in
 *      `nutritionscrape/{ean}`.
 *   4. Setze status → 'resolved' (bei OK) oder 'no-data' (bei
 *      all_failed/no_urls).
 *
 * Beim nächsten Mal wenn ein User die EAN scant, hat
 * `tryNutritionScrape` einen Treffer und der External-Detail-
 * Screen zeigt die echten Shop-Daten (inkl. Preis, Bild,
 * Hersteller, etc.).
 *
 * ─── Warum scheduled statt direkt vom Client ─────────────────────────
 *
 * - scrapeEan ist authentifiziert via shared secret. Wir können den
 *   nicht im Client embedden (anyone könnte teure Scrapes triggern).
 *   Server-to-server ist die einzige sichere Variante.
 * - scrapeEan ist langsam (30-180s pro EAN: Serper-Search + bis zu
 *   ~10 HTML-Fetches + Claude-Extract). Wir wollen das nicht
 *   inline im UI-Flow.
 *
 * ─── Was diese CF NICHT macht ────────────────────────────────────────
 *
 * - Keine Lookups (das macht der Client).
 * - Keinen direkten Scrape (delegiert an scrapeEan).
 * - Keine Rate-Limit-Logik pro User (ist sowieso auth'd).
 *
 * ─── Status-Übergänge ─────────────────────────────────────────────────
 *
 *   pending   → processing → resolved
 *                          → no-data
 *                          → pending (bei Fehler — wir versuchen's nächste Stunde wieder)
 *   skipped   ← manuelle Markierung in Admin-UI
 */

const functions = require('firebase-functions/v2');
const params = require('firebase-functions/params');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west1';
const MISSES_COLLECTION = 'external_lookup_misses';

// scrapeEan-Aufruf braucht denselben Secret wie nutrition-scraper.
// Im Deploy: firebase functions:secrets:set NUTRITION_SCRAPER_TRIGGER_KEY
const TRIGGER_KEY = params.defineSecret('NUTRITION_SCRAPER_TRIGGER_KEY');

const SCRAPE_EAN_URL =
  'https://europe-west1-markendetektive-895f7.cloudfunctions.net/scrapeEan';

// Pro Run-Limit. Konservativ wählen — eine scrapeEan-Iteration kann
// 30-180s dauern, CF-Timeout ist 540s (Gen 2 default). 5 EANs ≈ max
// 15min worst-case, passt in 540s wenn die meisten EANs early-out'en.
// Wenn der Backlog wächst, lieber häufiger schedulen als BATCH_LIMIT
// hochziehen (CF-Timeout-Risiko).
const BATCH_LIMIT = 5;

// Maximal-Alter eines 'processing'-Locks bevor wir ihn als verloren
// betrachten und zurück auf 'pending' setzen. Schützt vor Worker-
// Crashes die das Lock-Feld nie freigeben.
const LOCK_STALE_MS = 30 * 60 * 1000; // 30 min

// ════════════════════════════════════════════════════════════════════
// Endpoint 1 — scheduled (production)
// ════════════════════════════════════════════════════════════════════

exports.processExternalMisses = functions.scheduler.onSchedule(
  {
    region: REGION,
    schedule: 'every 60 minutes',
    timeoutSeconds: 540,
    memory: '256MiB',
    secrets: [TRIGGER_KEY],
  },
  async () => {
    await runProcessor(TRIGGER_KEY.value());
  },
);

// ════════════════════════════════════════════════════════════════════
// Endpoint 2 — manual trigger (testing)
// ════════════════════════════════════════════════════════════════════
//
// Aufruf:
//   curl 'https://europe-west1-markendetektive-895f7.cloudfunctions.net/processExternalMissesManual?key=<TRIGGER_KEY>'

exports.processExternalMissesManual = functions.https.onRequest(
  {
    region: REGION,
    timeoutSeconds: 540,
    memory: '256MiB',
    secrets: [TRIGGER_KEY],
  },
  async (req, res) => {
    const triggerKey = TRIGGER_KEY.value();
    const provided = req.query?.key || req.body?.key;
    if (!triggerKey || provided !== triggerKey) {
      res.status(401).send('Unauthorized');
      return;
    }
    try {
      const summary = await runProcessor(triggerKey);
      res.status(200).json(summary);
    } catch (e) {
      console.error('processExternalMissesManual error:', e);
      res.status(500).send(String(e?.message || e));
    }
  },
);

// ════════════════════════════════════════════════════════════════════
// Core
// ════════════════════════════════════════════════════════════════════

async function runProcessor(triggerKey) {
  console.log('[misses-processor] start');

  // 1. Stale 'processing'-Locks aufräumen (Worker-Crash-Recovery).
  await unstickStaleLocks();

  // 2. Pending Misses picken (populärste zuerst).
  const pending = await pickPendingMisses(BATCH_LIMIT);
  console.log(`[misses-processor] picked ${pending.length} pending misses`);

  if (pending.length === 0) {
    return { picked: 0, resolved: 0, noData: 0, errored: 0 };
  }

  let resolved = 0;
  let noData = 0;
  let errored = 0;

  for (const miss of pending) {
    const ean = miss.id;
    console.log(`[misses-processor] processing ean=${ean}`);

    // 3a. Lock setzen
    try {
      await db.collection(MISSES_COLLECTION).doc(ean).update({
        status: 'processing',
        lockAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      console.warn(`[misses-processor] lock failed for ${ean}:`, e?.message);
      continue;
    }

    // 3b. scrapeEan aufrufen
    let resultStatus = 'pending';
    let resultSource = null;
    let resultError = null;

    try {
      const scrapeRes = await callScrapeEan(ean, triggerKey);
      const result = scrapeRes?.result;
      if (result === 'ok') {
        resultStatus = 'resolved';
        resultSource = scrapeRes.successShop || 'scraper';
        resolved += 1;
      } else if (result === 'all_failed' || result === 'no_urls') {
        resultStatus = 'no-data';
        noData += 1;
      } else {
        resultStatus = 'pending'; // unbekannt — beim nächsten Run nochmal
        resultError = `unexpected scrapeEan result: ${JSON.stringify(result)}`;
        errored += 1;
      }
    } catch (e) {
      // Netzwerk-Error / Timeout / 500 → status zurück auf pending,
      // damit der nächste Run es erneut probiert.
      resultStatus = 'pending';
      resultError = String(e?.message || e).slice(0, 500);
      errored += 1;
      console.error(`[misses-processor] scrapeEan failed for ${ean}:`, e?.message);
    }

    // 3c. Status zurückschreiben
    try {
      const update = {
        status: resultStatus,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedSource: resultSource,
      };
      if (resultError) update.processingError = resultError;
      else update.processingError = admin.firestore.FieldValue.delete();
      // Lock-Feld räumen
      update.lockAt = admin.firestore.FieldValue.delete();

      await db.collection(MISSES_COLLECTION).doc(ean).update(update);
    } catch (e) {
      console.warn(
        `[misses-processor] status write failed for ${ean}:`,
        e?.message,
      );
    }
  }

  const summary = {
    picked: pending.length,
    resolved,
    noData,
    errored,
  };
  console.log('[misses-processor] done', summary);
  return summary;
}

/**
 * Sucht 'processing'-Docs deren lockAt älter als LOCK_STALE_MS ist und
 * setzt sie zurück auf 'pending'. Schützt vor Locks die durch Worker-
 * Crashes hängen geblieben sind.
 */
async function unstickStaleLocks() {
  try {
    const cutoff = admin.firestore.Timestamp.fromMillis(
      Date.now() - LOCK_STALE_MS,
    );
    const snap = await db
      .collection(MISSES_COLLECTION)
      .where('status', '==', 'processing')
      .where('lockAt', '<', cutoff)
      .limit(20)
      .get();
    if (snap.empty) return;
    console.log(`[misses-processor] unsticking ${snap.size} stale locks`);
    const batch = db.batch();
    snap.docs.forEach((d) => {
      batch.update(d.ref, {
        status: 'pending',
        lockAt: admin.firestore.FieldValue.delete(),
        processingError: 'lock-recovery: vorheriger Run timeout/crashed',
      });
    });
    await batch.commit();
  } catch (e) {
    // Wenn der Composite-Index fehlt (status + lockAt) failt das hier.
    // Nicht kritisch — beim nächsten Run nochmal versuchen.
    console.warn('[misses-processor] unstickStaleLocks failed:', e?.message);
  }
}

/**
 * Pickt bis zu N pending Misses. Sortiert nach hitCount desc, damit
 * populäre EANs (= viele User scannen sie) zuerst dran sind.
 */
async function pickPendingMisses(n) {
  try {
    const snap = await db
      .collection(MISSES_COLLECTION)
      .where('status', '==', 'pending')
      .orderBy('hitCount', 'desc')
      .limit(n)
      .get();
    return snap.docs;
  } catch (e) {
    // Composite-Index fehlt? Fallback ohne orderBy.
    console.warn(
      '[misses-processor] pickPendingMisses with orderBy failed, falling back without sort:',
      e?.message,
    );
    const snap = await db
      .collection(MISSES_COLLECTION)
      .where('status', '==', 'pending')
      .limit(n)
      .get();
    return snap.docs;
  }
}

/**
 * Macht einen HTTP-POST an scrapeEan mit dem shared trigger key.
 * Returnt das JSON-Result. Wirft bei Netzwerk-Error / non-2xx.
 */
async function callScrapeEan(ean, triggerKey) {
  // Node 22 hat global fetch.
  const url = `${SCRAPE_EAN_URL}?key=${encodeURIComponent(triggerKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ean: String(ean) }),
    // CF-internal timeout — scrapeEan hat selbst 540s, wir kappen
    // hier bei 240s damit wir auf jeden Fall die anderen Misses
    // noch durchkriegen.
    signal: AbortSignal.timeout(240_000),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`scrapeEan ${resp.status}: ${txt.slice(0, 200)}`);
  }
  return await resp.json();
}
