/**
 * BlurHash-Generator — Firebase Cloud Functions (Gen2).
 * ClickUp 86c9pz8pz: app-weite Bild-Platzhalter statt Shimmer-only.
 *
 * Schreibt pro Produkt einen ~25-Byte-ThumbHash (base64), den
 * expo-image client-seitig als Silhouetten-Platzhalter decodiert
 * (traegt Aspekt + Alpha — anders als BlurHash):
 *   • Feld `bildThumbhash`     — der Hash (für placeholder={{ thumbhash }})
 *   • Feld `bildThumbhashFor`  — Quell-URL, aus der der Hash entstand
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
// thumbhash ist ESM-only — in der CJS-CF via dynamic import laden
// (Node 22 kann das nativ; einmal pro Instanz gecacht).
let thumbhashModP = null;
function loadThumbhash() {
  if (!thumbhashModP) thumbhashModP = import('thumbhash');
  return thumbhashModP;
}

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
 * Lädt das Bild und encodiert einen ThumbHash (base64).
 *
 * ThumbHash statt BlurHash (User-Feedback 2026-06-12): BlurHash
 * speichert WEDER Seitenverhältnis NOCH Alpha — der Placeholder
 * flutete die ganze Card-Fläche ('alles grün geblurrt') und das echte
 * Bild poppte in anderer Form auf. ThumbHash kodiert Aspekt + Alpha:
 * freigestellte Produktbilder ergeben eine weiche SILHOUETTE in
 * echter Produktform, das Bild materialisiert sich formgleich.
 * Deshalb auch KEIN flatten — Alpha bleibt erhalten.
 * 100px = ThumbHash-Maximum.
 */
async function computeThumbhash(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!resp.ok) throw new Error(`fetch ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const { data, info } = await sharp(buf)
    .resize(100, 100, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const th = await loadThumbhash();
  const hash = th.rgbaToThumbHash(info.width, info.height, data);
  return Buffer.from(hash).toString('base64');
}

/**
 * Hash für ein Doc berechnen + schreiben, wenn nötig.
 * Returns 'written' | 'skipped' | 'cleared'.
 */
async function processDoc(ref, data) {
  const url = imageUrlOf(data);
  if (!url) {
    // Kein Bild (mehr): veraltete Hashes aufräumen.
    if (data && (data.bildThumbhash || data.bildBlurhash)) {
      await ref.update({
        bildThumbhash: admin.firestore.FieldValue.delete(),
        bildThumbhashFor: admin.firestore.FieldValue.delete(),
        bildBlurhash: admin.firestore.FieldValue.delete(),
        bildBlurhashFor: admin.firestore.FieldValue.delete(),
      });
      return 'cleared';
    }
    return 'skipped';
  }
  if (data.bildThumbhash && data.bildThumbhashFor === url) return 'skipped';
  const hash = await computeThumbhash(url);
  // Die Legacy-BlurHash-Felder (erste Iteration, 2026-06-12 vormittags)
  // im selben Write entsorgen.
  await ref.update({
    bildThumbhash: hash,
    bildThumbhashFor: url,
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
      const upToDate =
        data.bildThumbhash && data.bildThumbhashFor === urlAfter;
      if (urlAfter === urlBefore && upToDate) return;
      if (!urlAfter && !data.bildThumbhash && !data.bildBlurhash) return;
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
