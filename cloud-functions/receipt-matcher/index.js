/**
 * receipt-matcher — Teil 1: Katalog-Embedding-Fundament.
 *
 * Schreibt pro Produkt einen Embedding-Vektor (Produktname) nach
 * `productEmbeddings/{productId}`. Der spätere Matcher (Teil 2) lädt das
 * markt-gefilterte Subset dieser Vektoren in den Speicher und macht
 * brute-force Cosine-Retrieval → kein Vektor-DB, kein Doc-Bloat auf
 * produkte/markenProdukte.
 *
 * Modell: gemini-embedding-001 (768-dim via outputDimensionality).
 * Re-Embedding NUR bei Namens-Änderung (Trigger) bzw. fehlend/stale
 * (Backfill) — Preis-/Metadaten-Änderungen lösen KEIN neues Embedding aus
 * (kostet sonst pro Preis-Update ein Gemini-Call).
 *
 * Schema productEmbeddings/{id}:
 *   vector:           Vector(768)  // Firestore-Vektor-Typ (FieldValue.vector), NICHT number[]
 *   type:             'noname' | 'marke'
 *   discounterId:     string | null   // nur NoName; Marken sind markt-agnostisch
 *   name, nameNorm:   string
 *   preis:            number | null
 *   sourceCollection: 'produkte' | 'markenProdukte'
 *   embModel, embDim, embVersion, updatedAt
 */

'use strict';

const admin = require('firebase-admin');
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { GoogleGenAI } = require('@google/genai');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const matcher = require('./matcher');

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const TRIGGER_KEY = defineSecret('NUTRITION_SCRAPER_TRIGGER_KEY');

const REGION = 'europe-west1';
const EMB_MODEL = 'gemini-embedding-001';
const EMB_DIM = 768;
const EMB_VERSION = 1; // Bump → Backfill re-embedded alles
const EMB_BATCH = 96; // Texte pro embedContent-Call

const COMMON = {
  region: REGION,
  secrets: [GEMINI_API_KEY],
};

// ─── Helpers ─────────────────────────────────────────────────────────
const refId = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return v.split('/').pop();
  if (v.id) return v.id;
  if (v._path && v._path.segments) return v._path.segments.slice(-1)[0];
  return null;
};

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');

let _ai = null;
function ai() {
  if (_ai) return _ai;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  _ai = new GoogleGenAI({ apiKey });
  return _ai;
}

/**
 * Embed eine Liste Strings → number[][] (gleiche Reihenfolge).
 * Fault-tolerant: ein Chunk-Fehler (Rate-Limit/500/Poison-Name) killt NICHT
 * den ganzen Batch — 3× Retry mit Backoff, dann werden NUR die Strings des
 * fehlgeschlagenen Chunks als null übersprungen (Cursor läuft weiter, ein
 * späterer force-Lauf holt sie nach). Verhindert "ein 500er stoppt alles".
 */
async function embedTexts(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += EMB_BATCH) {
    const chunk = texts.slice(i, i + EMB_BATCH);
    let embs = null;
    for (let attempt = 0; attempt < 3 && !embs; attempt++) {
      try {
        const r = await ai().models.embedContent({ model: EMB_MODEL, contents: chunk, config: { outputDimensionality: EMB_DIM } });
        embs = r.embeddings || [];
      } catch (e) {
        if (attempt === 2) {
          console.warn(`embed chunk failed (${chunk.length} skipped):`, e.message);
          embs = [];
        } else {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    }
    for (let j = 0; j < chunk.length; j++) out.push((embs[j] && (embs[j].values || embs[j].embedding)) || null);
  }
  return out;
}

// REWE-Discounter-DocId (für reweapify-Eigenmarken; Marken sind markt-agnostisch).
const REWE_DISCOUNTER_ID = 'GzHmnRRIUbbhuG6b4YmE';

/**
 * Einheitliche Meta für alle drei Quell-Collections → { name, type,
 * discounterId, preis, gtin, nameNorm, sourceCollection } oder null (kein Name).
 *  - produkte        → type 'noname', discounterId aus data.discounter (Tier 1)
 *  - markenProdukte  → type 'marke',  discounterId null               (Tier 1)
 *  - reweapify       → brand_classification: 'eigenmarke' → noname@REWE,
 *                      sonst (markenprodukt/unclassified) → marke (markt-agnostisch) (Tier 2)
 */
function buildMeta(collection, data) {
  let name;
  let type;
  let discounterId;
  let preis;
  let gtin;
  if (collection === 'reweapify') {
    name = String(data.productName || '').trim();
    const bc = String(data.brand_classification || '').toLowerCase();
    if (bc === 'eigenmarke') {
      type = 'noname';
      discounterId = REWE_DISCOUNTER_ID;
    } else {
      type = 'marke';
      discounterId = null;
    }
    preis = Number.isFinite(Number(data.price_current)) ? Number(data.price_current) : null;
    gtin = data.gtin ? String(data.gtin) : null;
  } else {
    name = String(data.name || '').trim();
    type = collection === 'produkte' ? 'noname' : 'marke';
    discounterId = collection === 'produkte' ? refId(data.discounter) : null;
    preis = Number.isFinite(Number(data.preis)) ? Number(data.preis) : null;
    gtin =
      Array.isArray(data.EANs) && data.EANs.length
        ? String(data.EANs[0])
        : data.gtin
          ? String(data.gtin)
          : null;
  }
  if (!name) return null;
  return { name, type, discounterId, preis, gtin, nameNorm: norm(name), sourceCollection: collection };
}

/** Embedding fehlt oder ist stale (Name/Version/Modell/Dim geändert)? */
function isStale(existing, name) {
  if (!existing) return true;
  return (
    existing.nameNorm !== norm(name) ||
    existing.embVersion !== EMB_VERSION ||
    existing.embModel !== EMB_MODEL ||
    existing.embDim !== EMB_DIM
  );
}

// ─── Trigger: pro Produkt-Write Embedding pflegen ────────────────────
async function handleWrite(collection, event) {
  const id = event.params.id;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  const embRef = db.collection('productEmbeddings').doc(id);

  // Gelöscht → Embedding mit weg.
  if (!after) {
    if (before) await embRef.delete().catch(() => {});
    return;
  }
  const meta = buildMeta(collection, after);
  if (!meta) return; // ohne Name kein Embedding
  const name = meta.name;

  const beforeMeta = before ? buildMeta(collection, before) : null;
  const nameChanged = !beforeMeta || beforeMeta.nameNorm !== meta.nameNorm;

  if (!nameChanged) {
    // Name unverändert → nur Metadaten (discounter/preis/gtin) aktualisieren,
    // KEIN neues Embedding. Falls noch gar kein Embedding existiert (Produkt
    // wurde vor dem Backfill nur metadaten-editiert), legt der Backfill es an.
    const snap = await embRef.get();
    if (snap.exists && !isStale(snap.data(), name)) {
      await embRef.set(
        {
          discounterId: meta.discounterId,
          preis: meta.preis,
          gtin: meta.gtin,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }
    // Embedding fehlt/stale → unten neu embedden.
  }

  const [vec] = await embedTexts([name]);
  if (!vec) return;
  await embRef.set({
    ...meta,
    // Firestore-Vektor-Typ — NUR so erfasst der Vektor-Index das Feld + findNearest
    // findet es. Ein plain number[] wird NICHT indiziert.
    vector: admin.firestore.FieldValue.vector(vec),
    embModel: EMB_MODEL,
    embDim: EMB_DIM,
    embVersion: EMB_VERSION,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

exports.onProduktEmbeddingWrite = onDocumentWritten(
  { ...COMMON, document: 'produkte/{id}' },
  (event) => handleWrite('produkte', event),
);

exports.onMarkenProduktEmbeddingWrite = onDocumentWritten(
  { ...COMMON, document: 'markenProdukte/{id}' },
  (event) => handleWrite('markenProdukte', event),
);

exports.onReweapifyEmbeddingWrite = onDocumentWritten(
  { ...COMMON, document: 'reweapify/{id}' },
  (event) => handleWrite('reweapify', event),
);

// ─── Backfill (cursor-basiert, key-gated) ────────────────────────────
// GET ?key=…&collection=produkte|markenProdukte&cursor=<lastId>&limit=400&force=0
// Antwort: { collection, processed, embedded, meta, lastId, done }
exports.backfillEmbeddingsManual = onRequest(
  { ...COMMON, secrets: [GEMINI_API_KEY, TRIGGER_KEY], timeoutSeconds: 540, memory: '1GiB' },
  async (req, res) => {
    if (req.query.key !== TRIGGER_KEY.value()) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const ALLOWED = ['produkte', 'markenProdukte', 'reweapify'];
    const collection = ALLOWED.includes(req.query.collection) ? req.query.collection : 'produkte';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 400, 1), 1000);
    const force = req.query.force === '1';
    const cursor = req.query.cursor || null;

    try {
      let q = db.collection(collection).orderBy('__name__').limit(limit);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) {
        res.json({ collection, processed: 0, embedded: 0, meta: 0, lastId: cursor, done: true });
        return;
      }
      const docs = snap.docs;

      // Existierende Embeddings (nur Metadaten-Felder, NICHT die Vektoren) holen.
      const embRefs = docs.map((d) => db.collection('productEmbeddings').doc(d.id));
      const existing = await db.getAll(...embRefs, {
        fieldMask: ['nameNorm', 'embVersion', 'embModel', 'embDim'],
      });
      const existingMap = {};
      existing.forEach((e) => {
        existingMap[e.id] = e.exists ? e.data() : null;
      });

      // Welche brauchen ein (neues) Embedding?
      const toEmbed = []; // { id, name, meta }
      const metaOnly = []; // { id, meta } — Embedding aktuell, nur Metadaten mergen
      for (const d of docs) {
        const meta = buildMeta(collection, d.data());
        if (!meta) continue; // ohne Name kein Embedding
        if (force || isStale(existingMap[d.id], meta.name)) {
          toEmbed.push({ id: d.id, name: meta.name, meta });
        } else {
          metaOnly.push({ id: d.id, meta });
        }
      }

      const vecs = toEmbed.length ? await embedTexts(toEmbed.map((t) => t.name)) : [];

      // Write-Ops sammeln, dann in kleinen Chunks committen — ein 768-float-
      // Vektor pro Doc sprengt sonst das Firestore-Commit-Payload-Limit
      // (≈10 MB) bei großen Batches ("Transaction too big").
      const ops = [];
      let embedded = 0;
      toEmbed.forEach((t, i) => {
        const vec = vecs[i];
        if (!vec) return;
        ops.push({
          ref: db.collection('productEmbeddings').doc(t.id),
          data: {
            ...t.meta,
            vector: admin.firestore.FieldValue.vector(vec),
            embModel: EMB_MODEL,
            embDim: EMB_DIM,
            embVersion: EMB_VERSION,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          merge: false,
        });
        embedded++;
      });
      metaOnly.forEach((m) => {
        ops.push({
          ref: db.collection('productEmbeddings').doc(m.id),
          data: {
            discounterId: m.meta.discounterId,
            preis: m.meta.preis,
            gtin: m.meta.gtin,
            name: m.meta.name,
            nameNorm: m.meta.nameNorm,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          merge: true,
        });
      });

      const COMMIT_CHUNK = 50;
      for (let i = 0; i < ops.length; i += COMMIT_CHUNK) {
        const batch = db.batch();
        for (const op of ops.slice(i, i + COMMIT_CHUNK)) {
          batch.set(op.ref, op.data, op.merge ? { merge: true } : {});
        }
        await batch.commit();
      }

      res.json({
        collection,
        processed: docs.length,
        embedded,
        meta: metaOnly.length,
        lastId: docs[docs.length - 1].id,
        done: docs.length < limit,
      });
    } catch (e) {
      console.error('backfillEmbeddingsManual failed', e);
      res.status(500).json({ error: e.message });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════
// Teil 2 — Matcher: Bon-Zeile → Produkt
// ═══════════════════════════════════════════════════════════════════

// Trigger: jede neue Bon-Zeile (purchased_products) wird gematcht.
// Alias-Lexikon sorgt dafür, dass Embed/KI nur bei NEUEN Strings laufen.
exports.onPurchasedProductMatch = onDocumentCreated(
  { ...COMMON, document: 'users/{uid}/purchased_products/{ppId}', timeoutSeconds: 120, memory: '512MiB' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const d = snap.data() || {};
    if (d.matchVersion === matcher.MATCH_VERSION) return; // bereits gematcht (idempotent)
    try {
      await matcher.matchLine({
        itemName: d.itemName,
        marktSlug: d.merchantId,
        priceCents: d.priceCents || 0,
        userId: event.params.uid,
        receiptId: d.receiptId || null,
        ppRef: snap.ref,
      });
    } catch (e) {
      console.error('onPurchasedProductMatch failed', event.params, e);
      await snap.ref.set({ matchStatus: 'error', matchError: e.message }, { merge: true }).catch(() => {});
    }
  },
);

// Manuell: alle purchased_products eines Users (optional eines Bons) re-matchen.
// GET ?key=…&uid=<uid>[&receiptId=<id>][&force=1]
exports.matchReceiptManual = onRequest(
  { ...COMMON, secrets: [GEMINI_API_KEY, TRIGGER_KEY], timeoutSeconds: 540, memory: '512MiB' },
  async (req, res) => {
    if (req.query.key !== TRIGGER_KEY.value()) return res.status(403).json({ error: 'forbidden' });
    const uid = req.query.uid;
    if (!uid) return res.status(400).json({ error: 'uid required' });
    const force = req.query.force === '1';
    try {
      let q = db.collection('users').doc(uid).collection('purchased_products');
      if (req.query.receiptId) q = q.where('receiptId', '==', req.query.receiptId);
      const snap = await q.get();
      const tally = {};
      for (const doc of snap.docs) {
        const d = doc.data();
        if (!force && d.matchVersion === matcher.MATCH_VERSION) {
          tally.skipped = (tally.skipped || 0) + 1;
          continue;
        }
        const r = await matcher.matchLine(
          { itemName: d.itemName, marktSlug: d.merchantId, priceCents: d.priceCents || 0, userId: uid, receiptId: d.receiptId || null, ppRef: doc.ref },
          { ignoreAlias: force },
        );
        tally[r.status] = (tally[r.status] || 0) + 1;
      }
      res.json({ uid, total: snap.size, tally });
    } catch (e) {
      console.error('matchReceiptManual failed', e);
      res.status(500).json({ error: e.message });
    }
  },
);

// Backlog/Benchmark: collectionGroup purchased_products cursor-weise matchen.
// GET ?key=…&cursor=<docId>&limit=200&dryRun=1&force=1
exports.matchBacklogManual = onRequest(
  { ...COMMON, secrets: [GEMINI_API_KEY, TRIGGER_KEY], timeoutSeconds: 540, memory: '1GiB' },
  async (req, res) => {
    if (req.query.key !== TRIGGER_KEY.value()) return res.status(403).json({ error: 'forbidden' });
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500);
    const dryRun = req.query.dryRun === '1';
    const force = req.query.force === '1';
    const cursor = req.query.cursor || null;
    try {
      let q = db.collectionGroup('purchased_products').orderBy('__name__').limit(limit);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) return res.json({ processed: 0, done: true, tally: {} });
      const tally = {};
      for (const doc of snap.docs) {
        const d = doc.data();
        if (!force && !dryRun && d.matchVersion === matcher.MATCH_VERSION) {
          tally.skipped = (tally.skipped || 0) + 1;
          continue;
        }
        const uid = doc.ref.path.split('/')[1];
        const r = await matcher.matchLine(
          { itemName: d.itemName, marktSlug: d.merchantId, priceCents: d.priceCents || 0, userId: uid, receiptId: d.receiptId || null, ppRef: doc.ref },
          { dryRun, ignoreAlias: force || dryRun, noClose: true }, // Backlog: NIE retroaktiv Warenkörbe schließen
        );
        tally[r.status] = (tally[r.status] || 0) + 1;
      }
      res.json({ processed: snap.size, lastId: snap.docs[snap.docs.length - 1].id, done: snap.size < limit, tally });
    } catch (e) {
      console.error('matchBacklogManual failed', e);
      res.status(500).json({ error: e.message });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════
// Admin-Callables fürs Web-Back-Office (Review-Queue)
// ═══════════════════════════════════════════════════════════════════
Object.assign(exports, require('./admin'));

const { onCall, HttpsError } = require('firebase-functions/v2/https');

// Freie Katalog-Suche (Tier-1) für den Operator im Review — embed + findNearest.
exports.adminSearchProducts = onCall({ ...COMMON }, async (req) => {
  if (!req.auth || !req.auth.token || req.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin-Recht erforderlich.');
  }
  const q = String((req.data && req.data.query) || '').trim();
  if (!q) return { results: [] };
  const qv = await matcher.embedQuery(q);
  if (!qv) return { results: [] };
  const cands = (await matcher.shortlist(qv, (req.data && req.data.discounterId) || null)).filter((c) => c.tier === 1).slice(0, 15);
  await matcher.enrichCandidates(cands);
  return {
    results: cands.map((c) => ({ id: c.id, name: c.name, type: c.type, source: c.source, preis: c.preis, image: c.image || null, brand: c.brand || null })),
  };
});
