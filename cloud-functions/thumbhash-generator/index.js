/**
 * BlurHash-Generator — Firebase Cloud Functions (Gen2).
 * ClickUp 86c9pz8pz: app-weite Bild-Platzhalter statt Shimmer-only.
 *
 * Schreibt pro Produkt ein 32px-WebP als data-URI (~0,5 KB), das
 * expo-image client-seitig als formtreuen Mini-Bild-Platzhalter
 * rendert:
 *   • Feld `bildThumb`     — data-URI (für placeholder={{ uri }})
 *   • Feld `bildThumbFor`  — Quell-URL, aus der das Thumb entstand
 *     (Idempotenz-Marker: nur neu rechnen, wenn sich das Bild ändert;
 *     verhindert zugleich die Trigger-Self-Loop).
 *
 * Quelle ist dieselbe Prioritätskette, die die App rendert:
 *   bildClean → bild. (bildClean ist weißgrundig — flatten(white) im
 *   Encoder macht den Hash dazu konsistent.)
 *
 * Triggers:
 *   onProduktWritten / onMarkenProduktWritten — neue/geänderte Bilder.
 *
 * Backfill (Bestand, cursor-basiert — Aufrufer loopt bis nextCursor null):
 *   curl ".../backfillBlurhash?key=<NUTRITION_SCRAPER_TRIGGER_KEY>\
 *     &collection=produkte&limit=150[&cursor=<docId>]"
 *
 * Deploy:
 *   npx firebase-tools deploy --only functions:thumbhash-generator
 */

const admin = require('firebase-admin');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const sharp = require('sharp');
// (v3: ThumbHash-Encode entfernt — wir liefern jetzt ein echtes
// 32px-WebP als data-URI, siehe computeThumb.)

admin.initializeApp();

const TRIGGER_KEY = defineSecret('NUTRITION_SCRAPER_TRIGGER_KEY');

const REGION = 'europe-west1';

// ─── Encoding ──────────────────────────────────────────────────────

/** Bild-URL des Docs in App-Render-Priorität. */
function imageUrlOf(data) {
  if (!data) return null;
  const url = data.bildClean || data.bild || null;
  return typeof url === 'string' && url.startsWith('http') ? url : null;
}

/**
 * Lädt das Bild und erzeugt ein 32px-WebP als data-URI (~350-600 B
 * base64).
 *
 * v3 (User-Feedback 2026-06-12, zweite Runde): Hash-Blur (BlurHash/
 * ThumbHash) ist die Best Practice fuer VOLLFLAECHEN-Fotos — fuer
 * Produkt-CUTOUTS auf Karten wirkt der Farbnebel falsch ('haesslich,
 * Aufpoppen'). Ein winziges ECHTES Bild zeigt dagegen eine erkennbare,
 * formtreue Produkt-Vorschau (unscharf hochskaliert), in die das
 * echte Bild unsichtbar weich ueberblendet. expo-image rendert
 * data-URIs als placeholder nativ; contain haelt die Geometrie.
 */
async function computeThumb(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!resp.ok) throw new Error(`fetch ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const out = await sharp(buf)
    .resize(32, 32, { fit: 'inside' })
    .webp({ quality: 50, alphaQuality: 50 })
    .toBuffer();
  return `data:image/webp;base64,${out.toString('base64')}`;
}

/**
 * Hash für ein Doc berechnen + schreiben, wenn nötig.
 * Returns 'written' | 'skipped' | 'cleared'.
 */
async function processDoc(ref, data) {
  const url = imageUrlOf(data);
  if (!url) {
    // Kein Bild (mehr): veraltete Thumbs/Hashes aufräumen.
    if (data && (data.bildThumb || data.bildThumbhash || data.bildBlurhash)) {
      await ref.update({
        bildThumb: admin.firestore.FieldValue.delete(),
        bildThumbFor: admin.firestore.FieldValue.delete(),
        bildThumbhash: admin.firestore.FieldValue.delete(),
        bildThumbhashFor: admin.firestore.FieldValue.delete(),
        bildBlurhash: admin.firestore.FieldValue.delete(),
        bildBlurhashFor: admin.firestore.FieldValue.delete(),
      });
      return 'cleared';
    }
    return 'skipped';
  }
  if (data.bildThumb && data.bildThumbFor === url) return 'skipped';
  const thumb = await computeThumb(url);
  // Legacy-Felder der frueheren Iterationen im selben Write entsorgen.
  await ref.update({
    bildThumb: thumb,
    bildThumbFor: url,
    bildThumbhash: admin.firestore.FieldValue.delete(),
    bildThumbhashFor: admin.firestore.FieldValue.delete(),
    bildBlurhash: admin.firestore.FieldValue.delete(),
    bildBlurhashFor: admin.firestore.FieldValue.delete(),
  });
  return 'written';
}

// ─── Firestore-Triggers ────────────────────────────────────────────

function makeTrigger(collection) {
  return onDocumentWritten(
    {
      document: `${collection}/{id}`,
      region: REGION,
      memory: '512MiB',
      timeoutSeconds: 60,
      // Bild-Bursts (Backfills anderer Pipelines) nicht zur
      // Instanz-Explosion machen.
      maxInstances: 10,
    },
    async (event) => {
      const after = event.data?.after;
      if (!after || !after.exists) return; // delete → nichts zu tun
      const data = after.data();
      const before = event.data?.before?.exists
        ? event.data.before.data()
        : null;
      // Self-Loop-Guard + Idempotenz: nur aktiv werden, wenn sich die
      // Bild-URL geändert hat ODER noch kein (passender) Hash da ist.
      const urlAfter = imageUrlOf(data);
      const urlBefore = imageUrlOf(before);
      const upToDate = data.bildThumb && data.bildThumbFor === urlAfter;
      if (urlAfter === urlBefore && upToDate) return;
      if (!urlAfter && !data.bildThumb && !data.bildThumbhash && !data.bildBlurhash) return;
      try {
        const r = await processDoc(after.ref, data);
        if (r !== 'skipped') {
          console.log(`[blurhash] ${collection}/${event.params.id} → ${r}`);
        }
      } catch (e) {
        // Non-fatal: Backfill/nächster Write versucht es erneut.
        console.warn(
          `[blurhash] ${collection}/${event.params.id} failed: ${e.message}`,
        );
      }
    },
  );
}

exports.onProduktWrittenBlurhash = makeTrigger('produkte');
exports.onMarkenProduktWrittenBlurhash = makeTrigger('markenProdukte');

// ─── Backfill (HTTPS, cursor-basiert) ──────────────────────────────

exports.backfillBlurhash = onRequest(
  {
    region: REGION,
    memory: '1GiB',
    timeoutSeconds: 540,
    secrets: [TRIGGER_KEY],
  },
  async (req, res) => {
    if (req.query.key !== TRIGGER_KEY.value()) {
      res.status(401).send('Unauthorized');
      return;
    }
    const collection = String(req.query.collection || 'produkte');
    if (collection !== 'produkte' && collection !== 'markenProdukte') {
      res.status(400).send('collection must be produkte|markenProdukte');
      return;
    }
    const limit = Math.min(
      parseInt(String(req.query.limit || '150'), 10) || 150,
      400,
    );
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

    const db = admin.firestore();
    let q = db
      .collection(collection)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(limit);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();

    const stats = { processed: 0, written: 0, skipped: 0, errors: 0 };
    // Worker-Pool (Breite 8): Bild-Downloads parallel, aber gedeckelt.
    const docs = snap.docs;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, docs.length) }, async () => {
        while (next < docs.length) {
          const d = docs[next++];
          stats.processed += 1;
          try {
            const r = await processDoc(d.ref, d.data());
            if (r === 'written') stats.written += 1;
            else stats.skipped += 1;
          } catch (e) {
            stats.errors += 1;
            console.warn(`[blurhash] backfill ${d.id} failed: ${e.message}`);
          }
        }
      }),
    );

    const nextCursor =
      docs.length === limit ? docs[docs.length - 1].id : null;
    res.status(200).json({ collection, ...stats, nextCursor });
  },
);
