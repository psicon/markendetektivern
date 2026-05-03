/**
 * Connected-Brands Aggregator — runs weekly via Cloud Scheduler.
 *
 * Pre-computes for EACH `hersteller_new` (Hersteller / Produzent) the
 * full list of "connected" Marken (`hersteller` collection — represents
 * BRAND identity, not the manufacturer). Two sources:
 *
 *   1. DIRECT: Marken whose `herstellerref` already points to this
 *      Hersteller (the trivial case — every Marke "belongs" to a
 *      manufacturer via that ref).
 *   2. VIA-MARKENPRODUKT: NoName-Produkte (`produkte`) made by this
 *      Hersteller that are linked to a Markenprodukt
 *      (`produkte.markenProdukt` ref set). The Markenprodukt's
 *      `hersteller` field points DIRECTLY to a Marke (markenProdukte
 *      → hersteller (collection)). That Marke is "connected" to our
 *      Hersteller via the comparison.
 *
 * Single-pass design — three full collection scans with field
 * projection (`select`):
 *
 *   1. markenProdukte.select('hersteller')
 *      → Map<markenProduktId, brandId>     (1 brand-ref per MP)
 *   2. produkte.select('hersteller', 'markenProdukt')
 *      → Map<herstellerNewId, Set<brandId>>  (via-markenprodukt set)
 *   3. hersteller.select('herstellerref','name','bild')
 *      → Map<herstellerNewId, Array<Marke>>  (direct brands)
 *      → Map<brandId, Marke>                  (lookup for via-MP path)
 *
 * Then per `hersteller_new`:
 *   - merge direct + via-markenprodukt brands
 *   - dedupe by brand id
 *   - filter placeholder/dummy brands (e.g. "z - NoName")
 *   - write `aggregates/herstellerBrands_v1/{herstellerNewId}`
 *
 * Cost (rough estimate at current scale ~50k produkte / ~5k MP /
 * ~5k Marken):
 *   • ~60k reads per run, batch writes for ~5k aggregate docs
 *   • Compute: < 1 minute on 256 MB
 *   • Weekly: ≈ 0.02 € — negligible.
 *
 * Deploy:
 *   firebase deploy --only functions:aggregateConnectedBrands
 *
 * Manual trigger (first deploy / ad-hoc rebuild):
 *   curl https://europe-west1-markendetektive-895f7.cloudfunctions.net/aggregateConnectedBrandsHttp
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ─── Aggregat-Dokument-Pfad ──────────────────────────────────────
//
// Versionierung im Pfad damit wir bei Schema-Änderungen ohne
// Downtime auf v2 wechseln können (Function schreibt v2, App liest
// initial v2 → fallback v1, nach Deploy beider Seiten v1 stillegen).
const AGG_COLLECTION = 'aggregates/herstellerBrands_v1';

// ─── Placeholder-Filter ──────────────────────────────────────────
//
// Konvention im Datenbestand: Dummy-Marken werden mit "z - …" benannt
// damit sie alphabetisch ans Ende sortieren. Diese dürfen weder als
// "echte" Marke in der App auftauchen, noch ins Aggregat einfließen.
function isPlaceholderBrand(name) {
  const raw = String(name || '').trim().toLowerCase();
  if (!raw) return true;
  if (raw.startsWith('z - ')) return true;
  if (raw.startsWith('z-')) return true;
  if (raw === 'noname' || raw === 'no name') return true;
  if (raw === 'dummy' || raw === 'test' || raw === 'platzhalter') return true;
  return false;
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Extract a doc ID from a Firestore reference field. Robust against:
 *   - DocumentReference instances (`.id`)
 *   - Plain objects with `.id` and `.path` (server-side)
 *   - Plain objects with `.referencePath` (some legacy shapes)
 *   - null / undefined
 */
function refToId(ref) {
  if (!ref) return null;
  if (ref.id) return ref.id;
  if (ref.referencePath) {
    const parts = String(ref.referencePath).split('/');
    return parts[parts.length - 1] || null;
  }
  if (ref._path && Array.isArray(ref._path.segments)) {
    const segs = ref._path.segments;
    return segs[segs.length - 1] || null;
  }
  return null;
}

// ─── Stage 1 — markenProdukte → brand ref map ──────────────────

async function buildMarkenProduktBrandMap() {
  console.log('  [1/3] streaming markenProdukte.hersteller …');
  const start = Date.now();
  const map = new Map(); // markenProduktId → brandId
  let lastDoc = null;
  const PAGE = 5000;
  let scanned = 0;
  // Loop pagination: getDocs in chunks so memory stays bounded.
  // `select('hersteller')` projects only the one field we need.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db.collection('markenProdukte').select('hersteller').limit(PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const d = doc.data();
      const brandId = refToId(d.hersteller);
      if (brandId) map.set(doc.id, brandId);
      scanned += 1;
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  console.log(
    `    → ${scanned} markenProdukte scanned, ${map.size} with brand-ref (${Date.now() - start} ms)`,
  );
  return map;
}

// ─── Stage 2 — produkte → per-Hersteller brand set (via MP) ────

async function buildHerstellerToBrandSetViaMP(mpToBrandId) {
  console.log('  [2/3] streaming produkte.{hersteller,markenProdukt} …');
  const start = Date.now();
  const map = new Map(); // herstellerNewId → Set<brandId>
  let lastDoc = null;
  const PAGE = 5000;
  let scanned = 0;
  let withMP = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db
      .collection('produkte')
      .select('hersteller', 'markenProdukt')
      .limit(PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const d = doc.data();
      const herstellerNewId = refToId(d.hersteller);
      const mpId = refToId(d.markenProdukt);
      scanned += 1;
      if (!herstellerNewId || !mpId) continue;
      const brandId = mpToBrandId.get(mpId);
      if (!brandId) continue; // MP existiert nicht (mehr) oder hat keine Marke
      withMP += 1;
      let set = map.get(herstellerNewId);
      if (!set) {
        set = new Set();
        map.set(herstellerNewId, set);
      }
      set.add(brandId);
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  console.log(
    `    → ${scanned} produkte scanned, ${withMP} with markenProdukt link, ${map.size} herstellers contribute (${Date.now() - start} ms)`,
  );
  return map;
}

// ─── Stage 3 — hersteller (= Marken) → maps ────────────────────

async function buildBrandMaps() {
  console.log('  [3/3] streaming hersteller.{herstellerref,name,bild} …');
  const start = Date.now();
  // Map<herstellerNewId, Array<Marke>> — Direktverweise (`herstellerref`)
  const directByHersteller = new Map();
  // Map<brandId, Marke>                — Lookup für via-MP-Pfad
  const brandById = new Map();
  let lastDoc = null;
  const PAGE = 5000;
  let scanned = 0;
  let kept = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = db
      .collection('hersteller')
      .select('herstellerref', 'name', 'bild', 'bezeichnung')
      .limit(PAGE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const d = doc.data();
      scanned += 1;
      const name = d.name || d.bezeichnung || '';
      if (isPlaceholderBrand(name)) continue;
      const summary = {
        id: doc.id,
        name,
        bild: d.bild || null,
      };
      brandById.set(doc.id, summary);
      const herstellerNewId = refToId(d.herstellerref);
      if (!herstellerNewId) continue;
      kept += 1;
      let arr = directByHersteller.get(herstellerNewId);
      if (!arr) {
        arr = [];
        directByHersteller.set(herstellerNewId, arr);
      }
      arr.push(summary);
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }
  console.log(
    `    → ${scanned} hersteller (Marken) scanned, ${kept} non-placeholder with herstellerref, ${brandById.size} brand-lookup entries (${Date.now() - start} ms)`,
  );
  return { directByHersteller, brandById };
}

// ─── Stage 4 — merge + write batched aggregate docs ─────────────

async function writeAggregates({ directByHersteller, brandById, viaMPByHersteller }) {
  console.log('  [4/4] merging + writing single aggregate doc …');
  const start = Date.now();

  // Set aller herstellerNewIds, für die wir ÜBERHAUPT etwas haben.
  const allHerstellerIds = new Set();
  for (const id of directByHersteller.keys()) allHerstellerIds.add(id);
  for (const id of viaMPByHersteller.keys()) allHerstellerIds.add(id);

  // Wir schreiben EINEN einzigen Top-Level-Doc unter
  // `aggregates/herstellerBrands_v1` mit einer Map `byHersteller`
  // die jeder herstellerId ihre Marken-Liste zuordnet. Vorteile:
  //   • 1 Read pro App-Session statt N
  //   • Erbt automatisch die Read-Permission von `aggregates/*`
  //     (gleiche Rules-Pattern wie `aggregates/leaderboard_v1`)
  //   • Bei aktuellem Volumen: ~897 Hersteller × ~4 Marken ≈ 540 KB,
  //     weit unter dem 1-MB-Doc-Limit
  //
  // Wenn die Datenmenge irgendwann das 1-MB-Limit reißt, splitten
  // wir in `byHersteller_a`/`byHersteller_b` via erstes
  // Hex-Char-Sharding — bis dahin ist der einzelne Doc das simpelste
  // und billigste Modell.
  const byHersteller = {};
  let totalBrands = 0;

  for (const herstellerNewId of allHerstellerIds) {
    const direct = directByHersteller.get(herstellerNewId) || [];
    const viaSet = viaMPByHersteller.get(herstellerNewId) || new Set();

    // Direkte Marken haben immer source 'direct'. Via-MP-Marken
    // bekommen 'via-markenprodukt' — außer sie sind eh schon als
    // direct vorhanden, dann gewinnt 'direct'.
    const seen = new Map(); // brandId → entry
    for (const b of direct) {
      seen.set(b.id, { ...b, source: 'direct' });
    }
    for (const brandId of viaSet) {
      if (seen.has(brandId)) continue; // Direct hat Vorrang
      const b = brandById.get(brandId);
      if (!b) continue;
      seen.set(brandId, { ...b, source: 'via-markenprodukt' });
    }

    if (seen.size === 0) continue; // Hersteller ohne Marken überspringen

    const brands = Array.from(seen.values()).sort((a, b) =>
      String(a.name).localeCompare(String(b.name), 'de', { sensitivity: 'base' }),
    );

    byHersteller[herstellerNewId] = brands;
    totalBrands += brands.length;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('aggregates').doc('herstellerBrands_v1').set({
    version: 2,
    updatedAt: now,
    herstellerCount: Object.keys(byHersteller).length,
    totalBrands,
    byHersteller,
  });

  // Cleanup: Falls noch alte Subcollection-Docs existieren (aus v1-
  // Pfad `aggregates/herstellerBrands_v1/items/{id}`), in einem
  // Best-Effort-Pass löschen. Optional, schadet aber nicht.
  try {
    const oldItemsSnap = await db
      .collection('aggregates')
      .doc('herstellerBrands_v1')
      .collection('items')
      .limit(500)
      .get();
    if (!oldItemsSnap.empty) {
      let cleanupBatch = db.batch();
      let n = 0;
      for (const d of oldItemsSnap.docs) {
        cleanupBatch.delete(d.ref);
        n += 1;
      }
      await cleanupBatch.commit();
      console.log(`    → cleanup: deleted ${n} legacy subcollection docs`);
    }
  } catch (e) {
    console.warn('    → cleanup of legacy subcollection failed (non-fatal):', e?.message);
  }

  console.log(
    `    → wrote single doc with ${Object.keys(byHersteller).length} herstellers / ${totalBrands} brands (${Date.now() - start} ms)`,
  );
  return Object.keys(byHersteller).length;
}

// ─── Orchestrator ────────────────────────────────────────────────

async function buildAndWrite() {
  const t0 = Date.now();
  console.log('aggregateConnectedBrands: starting');
  const mpToBrandId = await buildMarkenProduktBrandMap();
  const viaMPByHersteller = await buildHerstellerToBrandSetViaMP(mpToBrandId);
  const { directByHersteller, brandById } = await buildBrandMaps();
  const total = await writeAggregates({
    directByHersteller,
    brandById,
    viaMPByHersteller,
  });
  console.log(
    `aggregateConnectedBrands: done — ${total} herstellers in ${Date.now() - t0} ms`,
  );
}

// ─── Trigger 1: scheduled (weekly) ───────────────────────────────
//
// Wöchentlich Montagnacht 03:00 Berlin-Zeit. Zwischen-Updates für
// neu hochgeladene Produkte sind nicht eilig — die Connected-Brands-
// Anzeige ist UX-Komfort, nicht zeitkritisch. Falls jemand häufiger
// will, einfach auf `every day 03:00` umstellen.
exports.aggregateConnectedBrands = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('every monday 03:00')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    await buildAndWrite();
    return null;
  });

// ─── Trigger 3: debug HTTP — diagnose connections for a Hersteller ─
//
// Aufruf:
//   curl 'https://europe-west1-markendetektive-895f7.cloudfunctions.net/debugConnectedBrands?name=T.M.A.'
// oder
//   curl 'https://europe-west1-markendetektive-895f7.cloudfunctions.net/debugConnectedBrands?id=<hersteller_new doc id>'
//
// Liefert pro Match:
//   • hersteller_new doc info
//   • count direkter Marken (hersteller-Collection mit
//     herstellerref → diesen Hersteller)
//   • Liste der direkten Marken (id, name, bild, herstellerref-id)
//   • count NoName-Produkte des Herstellers mit markenProdukt-Link
//   • Beispiel-Trail: noname → markenProdukt → brand
//   • Aggregate-Doc-Inhalt (falls vorhanden)
//
// Damit lässt sich pro Hersteller exakt nachvollziehen, warum der
// Aggregator zu seinem Ergebnis kommt.
exports.debugConnectedBrands = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    try {
      const nameQ = (req.query.name || '').toString().trim().toLowerCase();
      const idQ = (req.query.id || '').toString().trim();
      const matches = [];

      if (idQ) {
        const snap = await db.collection('hersteller_new').doc(idQ).get();
        if (snap.exists) matches.push({ id: snap.id, ...snap.data() });
      } else if (nameQ) {
        const snap = await db.collection('hersteller_new').get();
        snap.forEach((d) => {
          const data = d.data();
          const candidate = String(data.name || data.herstellername || '').toLowerCase();
          if (candidate.includes(nameQ)) {
            matches.push({ id: d.id, ...data });
          }
        });
      } else {
        res.status(400).json({ ok: false, error: 'pass ?name= or ?id=' });
        return;
      }

      const out = [];
      for (const h of matches.slice(0, 5)) {
        const herstellerRef = db.collection('hersteller_new').doc(h.id);
        // Direkte Marken
        const directSnap = await db
          .collection('hersteller')
          .where('herstellerref', '==', herstellerRef)
          .get();
        const direct = [];
        directSnap.forEach((d) => {
          const dd = d.data();
          direct.push({
            id: d.id,
            name: dd.name || dd.bezeichnung || null,
            bild: dd.bild || null,
            herstellerref_id: refToId(dd.herstellerref),
          });
        });

        // NoName-Produkte mit markenProdukt-Link
        const nonamesSnap = await db
          .collection('produkte')
          .where('hersteller', '==', herstellerRef)
          .get();
        const nonames = [];
        nonamesSnap.forEach((d) => {
          const dd = d.data();
          nonames.push({
            id: d.id,
            name: dd.name || null,
            stufe: dd.stufe || null,
            markenProdukt_id: refToId(dd.markenProdukt),
            hersteller_id: refToId(dd.hersteller),
          });
        });
        const withMP = nonames.filter((n) => n.markenProdukt_id);

        // Trail: für die ersten 3 NoNames mit MP, was ist die brand der MP?
        const trail = [];
        for (const n of withMP.slice(0, 3)) {
          const mpSnap = await db
            .collection('markenProdukte')
            .doc(n.markenProdukt_id)
            .get();
          if (!mpSnap.exists) {
            trail.push({ noname: n, mp: null });
            continue;
          }
          const mp = mpSnap.data();
          const brandId = refToId(mp.hersteller);
          let brand = null;
          if (brandId) {
            const bSnap = await db.collection('hersteller').doc(brandId).get();
            if (bSnap.exists) {
              const bd = bSnap.data();
              brand = {
                id: bSnap.id,
                name: bd.name || bd.bezeichnung || null,
                bild: bd.bild || null,
                herstellerref_id: refToId(bd.herstellerref),
              };
            }
          }
          trail.push({
            noname: { id: n.id, name: n.name },
            mp: { id: mpSnap.id, name: mp.name, hersteller_field_id: brandId },
            brand,
          });
        }

        // Aggregate-Doc — neuer Pfad (single Top-Level-Doc):
        // `aggregates/herstellerBrands_v1` mit `byHersteller.{id}`.
        let aggregate = null;
        const aggSnap = await db
          .collection('aggregates')
          .doc('herstellerBrands_v1')
          .get();
        if (aggSnap.exists) {
          const all = aggSnap.data() || {};
          aggregate = {
            updatedAt: all.updatedAt,
            herstellerCount: all.herstellerCount,
            version: all.version,
            brands: all.byHersteller?.[h.id] || null,
          };
        }

        out.push({
          hersteller: {
            id: h.id,
            name: h.name || h.herstellername || null,
          },
          directBrandsCount: direct.length,
          directBrands: direct,
          nonamesCount: nonames.length,
          nonamesWithMPCount: withMP.length,
          trail,
          aggregate,
        });
      }

      res.status(200).json({ ok: true, matches: out });
    } catch (e) {
      console.error('debugConnectedBrands failed:', e);
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

// ─── Trigger 2: manual HTTP — for first deploy / ad-hoc rebuilds ─
//
// Aufruf:
//   curl https://europe-west1-markendetektive-895f7.cloudfunctions.net/aggregateConnectedBrandsHttp
//
// Kein Auth — ist ein Read-Heavy / Write-many Job, der nur Aggregate-
// Docs anlegt. Wenn der Endpoint zu offen erscheint, später per
// Firebase IAM auf authenticated-only umschalten.
exports.aggregateConnectedBrandsHttp = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    try {
      await buildAndWrite();
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error('aggregateConnectedBrandsHttp failed:', e);
      res.status(500).json({ ok: false, error: String(e) });
    }
  });
