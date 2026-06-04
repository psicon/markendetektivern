/**
 * receipt-matcher — Teil 2: Bon-Zeile → Produkt.
 *
 * Resolver-Kette pro Zeile:
 *   1. Negativ-Muster (Pfand/Rabatt/Summe…) → lineType 'pfand'/'nonproduct', kein Produkt.
 *   2. Alias-Lexikon-Lookup (receiptAliases) → gelockt? sofort übernehmen (kein Embed/KI).
 *   3. Embedding (gemini-embedding-001 768d) → Firestore findNearest Shortlist
 *      (markt-gefiltert: NoName@Markt ∪ alle Marken; mischt Tier-1 produkte/markenProdukte
 *      + Tier-2 reweapify).
 *   4. Gemini-3.5-flash Pick aus Shortlist → { lineType, candidateIdx, confidence }.
 *   5. Confidence-Gate → Outcome:
 *        • Tier-1 + conf≥AUTO_LOCK → Match gelockt + receiptMatch + productId an purchased_products + Journey-Closure
 *        • Tier-2 (reweapify) + conf≥AUTO_LOCK → promotionQueue (Review-Queue v1, NICHT auto in den Katalog)
 *        • conf∈[REVIEW_MIN,AUTO_LOCK) → receiptReviewQueue (Mensch entscheidet)
 *        • Pfand/Discount/Nonproduct → Negativ-Alias
 *        • sonst (kein Kandidat) → external_lookup_misses (Nachfragesignal)
 *
 * Alias-Lexikon macht KI/Embedding 1× pro NEUEM (Markt, normKey) — danach reiner Lookup.
 */

'use strict';

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { GoogleGenAI } = require('@google/genai');

const db = admin.firestore();

const EMB_MODEL = 'gemini-embedding-001';
const EMB_DIM = 768;
const PICK_MODEL = 'gemini-3.5-flash';
const MATCH_VERSION = 1; // Bump → erzwingt Re-Match (Idempotenz-Gate)

const NONAME_K = 12;
const MARKE_K = 8;
const AUTO_LOCK = 0.9; // ≥ → automatisch locken (Tier-1) bzw. Promotion (Tier-2)
const REVIEW_MIN = 0.7; // [REVIEW_MIN, AUTO_LOCK) → Mensch-Review

// ─── Helpers ─────────────────────────────────────────────────────────
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');

const refId = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return v.split('/').pop();
  if (v.id) return v.id;
  if (v._path && v._path.segments) return v._path.segments.slice(-1)[0];
  return null;
};

// Cosine-Distanz (1 - cosine_similarity), kompatibel zu findNearest COSINE.
function cosineDist(a, b) {
  if (!a || !b) return 1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? 1 - dot / d : 1;
}

// Doc-Id fürs Alias-Lexikon (Markt + normKey, slash-safe).
const aliasId = (marktSlug, normKey) => `${norm(marktSlug) || 'unknown'}__${normKey}`.slice(0, 1400);

// Negativ-Muster: nie ein Produkt, nie KI/Embed.
const NEG_RE =
  /pfand|leergut|summe|rabatt|coupon|gutschein|treuepunkt|payback|ec[- ]?cash|kartenzahlung|rueckgeld|rückgeld|wechselgeld|mwst|ust\.|zwischensumme|gesamtbetrag|trinkgeld|bedienung/i;
function negativeType(name) {
  const n = String(name || '');
  if (/pfand|leergut/i.test(n)) return 'pfand';
  if (NEG_RE.test(n)) return 'nonproduct';
  return null;
}

let _ai = null;
function ai() {
  if (_ai) return _ai;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  _ai = new GoogleGenAI({ apiKey });
  return _ai;
}

async function embedQuery(text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await ai().models.embedContent({ model: EMB_MODEL, contents: [String(text)], config: { outputDimensionality: EMB_DIM } });
      const e = (r.embeddings || [])[0];
      return (e && (e.values || e.embedding)) || null;
    } catch (err) {
      if (attempt === 2) {
        console.warn('embedQuery failed:', err.message);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  return null;
}

// Slug → discounter-DocId Bridge (einmal pro warmer Instanz gecacht).
let _discCache = null;
async function discounterIdForSlug(slug) {
  if (!_discCache) {
    _discCache = {};
    const ds = await db.collection('discounter').get();
    ds.forEach((d) => {
      _discCache[d.id] = norm(d.data().name || '');
    });
  }
  const s = norm(slug);
  if (!s) return null;
  // exakter/teilweiser Namensabgleich
  for (const [id, nn] of Object.entries(_discCache)) {
    if (nn && (nn === s || nn.includes(s) || s.includes(nn))) return id;
  }
  return null;
}

/** findNearest Shortlist: NoName@Markt ∪ alle Marken (Tier-1 + Tier-2 gemischt). */
async function shortlist(queryVec, discounterId) {
  const qv = FieldValue.vector(queryVec);
  const col = db.collection('productEmbeddings');
  const tasks = [];
  if (discounterId) {
    tasks.push(
      col
        .where('type', '==', 'noname')
        .where('discounterId', '==', discounterId)
        .findNearest({ vectorField: 'vector', queryVector: qv, limit: NONAME_K, distanceMeasure: 'COSINE', distanceResultField: '_dist' })
        .get(),
    );
  }
  tasks.push(
    col
      .where('type', '==', 'marke')
      .findNearest({ vectorField: 'vector', queryVector: qv, limit: MARKE_K, distanceMeasure: 'COSINE', distanceResultField: '_dist' })
      .get(),
  );
  const snaps = await Promise.all(tasks);
  const out = [];
  for (const snap of snaps) {
    snap.forEach((doc) => {
      const x = doc.data();
      out.push({
        id: doc.id, // = produkte/markenProdukte/reweapify DocId
        name: x.name,
        type: x.type,
        source: x.sourceCollection, // 'produkte' | 'markenProdukte' | 'reweapify'
        tier: x.sourceCollection === 'reweapify' ? 2 : 1,
        preis: x.preis,
        gtin: x.gtin || null,
        dist: x._dist,
      });
    });
  }
  // beste (kleinste Distanz) zuerst, dedupe per id
  const seen = new Set();
  return out
    .sort((a, b) => (a.dist ?? 9) - (b.dist ?? 9))
    .filter((c) => (seen.has(c.id) ? false : seen.add(c.id)))
    .slice(0, NONAME_K + MARKE_K);
}

const PICK_SYS = `Du bist ein extrem genauer Experte für deutsche/österreichische Kassenbons. Du ordnest EINE Bon-Zeile entweder GENAU EINEM Kandidaten zu (dessen Index) ODER gibst candidateIdx -1 zurück ("kein sicherer Treffer").

GRUNDHALTUNG: Lieber -1 als ein falscher Treffer. Du RÄTST NICHT. Ein Treffer gilt NUR, wenn der Kandidat mit hoher Sicherheit DASSELBE Produkt ist (gleiche Marke/Sorte/Variante) — NICHT bloß dieselbe Kategorie oder ein zufällig gleiches Wort.

EIGENMARKEN (Handelsmarken) erkennen — diese Kürzel/Namen sind KEINE Marke, sondern NoName (Typ "noname") des jeweiligen Markts:
- G&G / GUT&GÜNSTIG / GUT&GUENSTIG = EDEKA/Netto · JA! = REWE · K-CLASSIC/KLC = Kaufland
- MILBONA/MILSANI/MILFINA = Lidl/Aldi · GUT BIO/BIO SONNE = Aldi/Netto · REWE BIO/REWE BESTE WAHL = REWE
Eine Eigenmarken-Bon-Zeile (z.B. "G&G Süßstoff") darf NUR auf einen Kandidaten vom Typ "noname" DESSELBEN Markts gemappt werden. Gibt es keinen passenden NoName-Kandidaten → -1. NIEMALS auf ein Markenprodukt (Typ "marke") ausweichen, nur weil der Produktname zufällig passt.
Umgekehrt: eine echte Marken-Bon-Zeile NUR auf einen "marke"-Kandidaten, nicht auf ein NoName.

HARTE SIGNALE (müssen alle passen): Markt (eine EDEKA-Eigenmarke gibt es nicht bei Lidl) · Preis plausibel (0,99€ ≠ 4,99€) · Typ (noname/marke) passend zur Bon-Zeile.

PERSÖNLICHER ANKER: Kandidaten mit ★[Einkaufszettel] / ★[zuletzt gekauft] hat GENAU DIESER Nutzer gerade auf dem Einkaufszettel oder kürzlich gekauft — ein STARKER Hinweis, dass die Bon-Zeile genau das ist. Bevorzuge einen ★-Kandidaten, SOFERN Markt/Preis/Typ plausibel passen, und vergib dann höhere confidence. ABER: ein klarer Widerspruch bei Markt/Preis/Typ schlägt den Anker (der Bon ist der Beweis, nicht die Absicht) → dann NICHT den ★-Kandidaten wählen.

FRISCHWARE ohne Marke (loses Obst/Gemüse/Theke: "Avocado","Banane","Hähnchenbrust","Gehacktes") → lineType "nonproduct", candidateIdx -1.
PFAND/LEERGUT → "pfand". RABATT/SUMME/ZAHLART/COUPON/PAYBACK → "nonproduct".

CONFIDENCE ehrlich kalibrieren (es geht um "ist DASSELBE Produkt", nicht "klingt ähnlich"):
- 0.95+  eindeutig dasselbe Produkt (Marke/Sorte/Typ/Markt/Preis stimmig)
- 0.80–0.94  sehr wahrscheinlich, kleine Restunsicherheit
- 0.50–0.79  plausibel aber unsicher → Mensch soll prüfen
- <0.50 bzw. -1  kein überzeugender Treffer; bloße Kategorie-/Wortähnlichkeit ist KEIN Treffer

lineType: "product" | "pfand" | "discount" | "nonproduct".
Antworte NUR mit JSON {"lineType":..,"candidateIdx":int,"confidence":0..1}.`;

const PICK_SCHEMA = {
  type: 'object',
  properties: {
    lineType: { type: 'string' },
    candidateIdx: { type: 'integer' },
    confidence: { type: 'number' },
  },
  required: ['lineType', 'candidateIdx', 'confidence'],
};

async function geminiPick(itemName, marktSlug, priceCents, cands) {
  const user =
    `Bon-Zeile: "${itemName}"\nMarkt: ${marktSlug}\nPreis: ${(priceCents / 100).toFixed(2)} €\n\nKandidaten:\n` +
    cands
      .map(
        (c, i) =>
          `[${i}] ${c.name} | ${c.type}${c.tier === 2 ? ' (reweapify)' : ''}${c.preis != null ? ` | ${Number(c.preis).toFixed(2)}€` : ''}${c.personal ? ` ★[${c.reason}]` : ''}`,
      )
      .join('\n');
  const r = await ai().models.generateContent({
    model: PICK_MODEL,
    contents: [{ role: 'user', parts: [{ text: user }] }],
    config: {
      systemInstruction: PICK_SYS,
      responseMimeType: 'application/json',
      responseSchema: PICK_SCHEMA,
      temperature: 0.1,
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 200,
    },
  });
  let t = null;
  try {
    t = r && r.text;
  } catch (e) {
    /* fallthrough */
  }
  if (!t) {
    const parts = r && r.candidates && r.candidates[0] && r.candidates[0].content && r.candidates[0].content.parts;
    if (Array.isArray(parts)) t = parts.map((p) => (p && p.text) || '').join('');
  }
  return JSON.parse(t);
}

// ─── Outcome-Writer ──────────────────────────────────────────────────
function lockAlias(marktSlug, normKey, payload) {
  return db
    .collection('receiptAliases')
    .doc(aliasId(marktSlug, normKey))
    .set(
      {
        marktSlug: norm(marktSlug),
        normKey,
        votes: FieldValue.increment(1),
        lastSeen: FieldValue.serverTimestamp(),
        ...payload,
      },
      { merge: true },
    );
}

async function bumpExternalMiss(marktSlug, normKey, sampleName) {
  const id = aliasId(marktSlug, normKey);
  await db
    .collection('external_lookup_misses')
    .doc(id)
    .set(
      {
        source: 'receipt',
        marktSlug: norm(marktSlug),
        normKey,
        sampleName,
        hitCount: FieldValue.increment(1),
        lastSeen: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

/**
 * Journey-Closure: offene einkaufswagen-Items des Users (Subcollection
 * users/{uid}/einkaufswagen) mit diesem productId abhaken + die zugehörige
 * Journey auf 'purchased'/'receipt' setzen. Offene Items werden geladen und
 * in JS gefiltert (handelsmarkenProdukt kann Ref ODER String sein).
 */
async function closeJourneyForProduct(userId, productId, receiptId) {
  if (!userId || !productId) return 0;
  try {
    const cart = db.collection('users').doc(userId).collection('einkaufswagen');
    const snap = await cart.where('gekauft', '==', false).limit(60).get();
    let n = 0;
    for (const d of snap.docs) {
      const x = d.data();
      const pid = refId(x.handelsmarkenProdukt) || refId(x.markenProdukt) || x.productId;
      if (pid !== productId) continue;
      await d.ref.set({ gekauft: true, gekauftVia: 'receipt', receiptId: receiptId || null, gekauftAt: FieldValue.serverTimestamp() }, { merge: true });
      if (x.journeyId) {
        await db
          .collection('users')
          .doc(userId)
          .collection('journeys')
          .doc(x.journeyId)
          .set({ finalStatus: 'purchased', completionReason: 'receipt', completedAt: FieldValue.serverTimestamp() }, { merge: true })
          .catch(() => {});
      }
      n++;
    }
    return n;
  } catch (e) {
    console.warn('closeJourneyForProduct failed', e.message);
    return 0;
  }
}

// ─── Persönlicher Anker: Einkaufszettel + kürzliche Käufe ────────────
// Produkte, die DIESER User gerade auf der Liste hat / kürzlich kaufte, sind
// die stärkste Matching-Quelle. Sie werden als hochgewichtete Kandidaten in
// die Shortlist gemischt (markiert) → die KI bevorzugt sie, wenn Markt/Preis/
// Typ passen. Per-User 60s gecacht (ein Bon = viele Zeilen kurz hintereinander).
const _personalCache = new Map();
const PERSONAL_TTL_MS = 60_000;
const PERSONAL_PURCHASE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

async function fetchPersonalCandidates(userId) {
  if (!userId) return [];
  const cached = _personalCache.get(userId);
  if (cached && Date.now() - cached.ts < PERSONAL_TTL_MS) return cached.cands;

  const ids = new Set();
  const reason = {};
  try {
    const cart = await db.collection('users').doc(userId).collection('einkaufswagen').where('gekauft', '==', false).limit(40).get();
    cart.forEach((d) => {
      const x = d.data();
      const pid = refId(x.handelsmarkenProdukt) || refId(x.markenProdukt) || x.productId;
      if (pid) {
        ids.add(pid);
        reason[pid] = 'Einkaufszettel';
      }
    });
  } catch (e) {
    /* ignore */
  }
  try {
    const since = new Date(Date.now() - PERSONAL_PURCHASE_WINDOW_MS);
    const pur = await db.collection('users').doc(userId).collection('purchases').where('purchasedAt', '>=', since).limit(40).get();
    pur.forEach((d) => {
      const pid = refId(d.data().productId) || d.data().productId;
      if (pid && !reason[pid]) {
        ids.add(pid);
        reason[pid] = 'zuletzt gekauft';
      }
    });
  } catch (e) {
    /* ignore */
  }

  let cands = [];
  if (ids.size) {
    const refs = [...ids].map((id) => db.collection('productEmbeddings').doc(String(id)));
    const docs = await db.getAll(...refs).catch(() => []);
    cands = docs
      .filter((d) => d.exists)
      .map((d) => {
        const x = d.data();
        const vv = x.vector;
        const _vec = vv && typeof vv.toArray === 'function' ? vv.toArray() : Array.isArray(vv) ? vv : null;
        return { id: d.id, name: x.name, type: x.type, source: x.sourceCollection, preis: x.preis, tier: x.sourceCollection === 'reweapify' ? 2 : 1, personal: true, reason: reason[d.id] || 'persönlich', _vec };
      });
  }
  _personalCache.set(userId, { cands, ts: Date.now() });
  return cands;
}

/**
 * Kern: eine Bon-Zeile matchen + Outcome schreiben.
 * ctx = { itemName, marktSlug, priceCents, userId, receiptId, ppRef }
 * Gibt das Outcome-Objekt zurück (auch fürs Backlog-Benchmark ohne Writes via dryRun).
 */
async function matchLine(ctx, opts = {}) {
  const { itemName, marktSlug, priceCents = 0, userId = null, receiptId = null, ppRef = null } = ctx;
  const dryRun = !!opts.dryRun;
  const normKey = norm(itemName);
  const writePP = async (data) => {
    if (!dryRun && ppRef)
      await ppRef.set(
        { ...data, normKey, marktSlug: norm(marktSlug), matchVersion: MATCH_VERSION, matchedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
  };

  if (!normKey) {
    await writePP({ matchStatus: 'skipped' });
    return { status: 'skipped', reason: 'empty' };
  }

  // 1) Negativ-Muster
  const negT = negativeType(itemName);
  if (negT) {
    if (!dryRun) await lockAlias(marktSlug, normKey, { productId: null, lineType: negT, confidence: 1, resolvedBy: 'rule', sampleName: itemName });
    await writePP({ matchStatus: negT, productId: null, lineType: negT });
    return { status: negT, source: 'rule' };
  }

  // 2) Alias-Lookup
  const aliasRef = db.collection('receiptAliases').doc(aliasId(marktSlug, normKey));
  if (!opts.ignoreAlias) {
    const aliasSnap = await aliasRef.get();
    if (aliasSnap.exists) {
      const a = aliasSnap.data();
      const locked = a.resolvedBy && a.resolvedBy !== 'ai-review-pending';
      if (locked) {
        if (!dryRun) await aliasRef.set({ votes: FieldValue.increment(1), lastSeen: FieldValue.serverTimestamp() }, { merge: true });
        if (a.productId && a.lineType === 'product') {
          await writePP({ matchStatus: 'matched', productId: a.productId, productSource: a.productSource || null, lineType: 'product', matchConfidence: a.confidence ?? null, matchSource: 'alias' });
          if (!opts.noClose) await closeJourneyForProduct(userId, a.productId, receiptId);
          if (!dryRun && receiptId) await writeReceiptMatch({ receiptId, ppId: ppRef && ppRef.id, userId, productId: a.productId, productSource: a.productSource, confidence: a.confidence, source: 'alias', itemName, marktSlug });
        } else {
          await writePP({ matchStatus: a.lineType || 'nonproduct', productId: null, lineType: a.lineType || 'nonproduct', matchSource: 'alias' });
        }
        return { status: 'alias-hit', alias: a };
      }
    }
  }

  // 3) Embedding + Shortlist
  const discounterId = await discounterIdForSlug(marktSlug);
  const qv = await embedQuery(itemName);
  if (!qv) {
    await writePP({ matchStatus: 'error', matchError: 'embed-failed' });
    return { status: 'error', reason: 'embed-failed' };
  }
  const catalogCands = await shortlist(qv, discounterId);
  // Persönlicher Anker: Einkaufszettel/kürzliche Käufe nach ECHTER Ähnlichkeit zur
  // Bon-Zeile scoren (Cosine) + moderaten Bonus geben — NICHT blind vornanstellen.
  // So steigt nur ein WIRKLICH passendes Zettel-Item auf; irrelevante sinken unter
  // die Katalog-Treffer und verdrängen sie nicht.
  const PERSONAL_BONUS = 0.88; // ~12% Distanz-Bonus für eigene Absicht
  const PERSONAL_MAX_DIST = 0.42; // nur Zettel-/Kauf-Items die WIRKLICH ähnlich sind dazunehmen
  const personalScored = (userId ? await fetchPersonalCandidates(userId) : [])
    .map((c) => {
      const { _vec, ...rest } = c;
      const raw = cosineDist(qv, _vec);
      return { ...rest, _raw: raw, dist: raw * PERSONAL_BONUS };
    })
    .filter((c) => c._raw < PERSONAL_MAX_DIST) // irrelevante Zettel-Items raus (kein Display-Rauschen, kein Verdrängen)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3) // max. 3 persönliche — der Katalog behält immer Plätze
    .map(({ _raw, ...c }) => c);
  const seenIds = new Set();
  const cands = [...personalScored, ...catalogCands]
    .filter((c) => (seenIds.has(c.id) ? false : seenIds.add(c.id)))
    .sort((a, b) => (a.dist ?? 9) - (b.dist ?? 9))
    .slice(0, NONAME_K + MARKE_K);
  if (!cands.length) {
    await bumpExternalMiss(marktSlug, normKey, itemName);
    await writePP({ matchStatus: 'unmapped', productId: null, lineType: 'product' });
    return { status: 'unmapped', reason: 'no-candidates' };
  }

  // 4) Gemini-Pick
  let pick;
  try {
    pick = await geminiPick(itemName, marktSlug, priceCents, cands);
  } catch (e) {
    await writePP({ matchStatus: 'error', matchError: 'pick-failed' });
    return { status: 'error', reason: 'pick-failed', detail: e.message };
  }
  const conf = Number(pick.confidence) || 0;
  const cand = pick.candidateIdx >= 0 && pick.candidateIdx < cands.length ? cands[pick.candidateIdx] : null;

  // 5) Confidence-Gate + Outcome
  if (pick.lineType === 'pfand' || pick.lineType === 'discount' || pick.lineType === 'nonproduct') {
    if (!dryRun) await lockAlias(marktSlug, normKey, { productId: null, lineType: pick.lineType, confidence: conf, resolvedBy: 'ai-auto', sampleName: itemName });
    await writePP({ matchStatus: pick.lineType, productId: null, lineType: pick.lineType, matchSource: 'ai' });
    return { status: pick.lineType, source: 'ai', confidence: conf };
  }

  // Tier-1 eindeutig → automatisch zuordnen. Persönlicher Anker (Zettel/kürzlich
  // gekauft) senkt die Schwelle leicht (0.8 statt 0.9), weil eigene Absicht ein
  // starkes Signal ist — aber nur wenn die KI ihn trotz Markt/Preis/Typ wählt.
  const tier1Threshold = cand && cand.personal ? AUTO_LOCK - 0.1 : AUTO_LOCK;
  if (cand && cand.tier === 1 && conf >= tier1Threshold) {
    if (!dryRun) await lockAlias(marktSlug, normKey, { productId: cand.id, productSource: cand.source, lineType: 'product', confidence: conf, resolvedBy: cand.personal ? 'ai-anchor' : 'ai-auto', sampleName: itemName });
    await writePP({ matchStatus: 'matched', productId: cand.id, productSource: cand.source, lineType: 'product', matchConfidence: conf, matchSource: cand.personal ? 'ai-anchor' : 'ai' });
    if (!opts.noClose) await closeJourneyForProduct(userId, cand.id, receiptId);
    if (!dryRun && receiptId) await writeReceiptMatch({ receiptId, ppId: ppRef && ppRef.id, userId, productId: cand.id, productSource: cand.source, confidence: conf, source: 'ai', itemName, marktSlug });
    return { status: 'matched', tier: 1, productId: cand.id, confidence: conf };
  }

  // Tier-2 (reweapify) plausibel → Promotion-Queue (Mensch gibt frei, kein Auto-Katalog).
  if (cand && cand.tier === 2 && conf >= REVIEW_MIN) {
    if (!dryRun) await enqueuePromotion({ reweapifyId: cand.id, name: cand.name, gtin: cand.gtin, kind: cand.type, marktSlug, normKey, sampleName: itemName, confidence: conf, ppId: ppRef && ppRef.id, userId, receiptId });
    await writePP({ matchStatus: 'promotion_pending', reweapifyId: cand.id, lineType: 'product', matchConfidence: conf, matchSource: 'ai' });
    return { status: 'promotion_pending', tier: 2, reweapifyId: cand.id, confidence: conf };
  }

  // Alles andere mit Kandidaten — Tier-1 unsicher ODER KI hat -1 / keinen klaren Treffer.
  // KI RÄT NICHT automatisch → Mensch entscheidet (Vorschlag + Confidence + Shortlist + Katalog-Suche).
  // (cands ist hier garantiert nicht leer — der no-candidates-Fall ist oben abgefangen.)
  if (!dryRun) await enqueueReview({ marktSlug, normKey, sampleName: itemName, priceCents, candidates: cands.slice(0, 8), suggestionIdx: pick.candidateIdx, confidence: conf, ppId: ppRef && ppRef.id, userId, receiptId });
  await writePP({ matchStatus: 'needs_review', lineType: 'product', matchConfidence: conf, matchSource: 'ai' });
  return { status: 'needs_review', confidence: conf, suggestion: cand };
}

function writeReceiptMatch(m) {
  return db.collection('receiptMatches').add({ ...m, createdAt: FieldValue.serverTimestamp() });
}

function enqueueReview(r) {
  // Dedupe per (Markt, normKey): EINE Review-Karte je unbekanntem String.
  return db
    .collection('receiptReviewQueue')
    .doc(aliasId(r.marktSlug, r.normKey))
    .set(
      {
        ...r,
        status: 'open',
        hitCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

function enqueuePromotion(p) {
  // Dedupe per reweapify-Produkt.
  return db
    .collection('promotionQueue')
    .doc(String(p.reweapifyId))
    .set(
      {
        ...p,
        status: 'open',
        hitCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

/**
 * Kandidaten on-demand mit Bild + Marke/Handelsmarke anreichern (für die
 * Web-UI). Holt pro Quell-Collection die nötigen Felder per getAll —
 * KEINE Speicherung am Embedding nötig.
 *   image: bildClean → bildCleanHq → bild → image (reweapify)
 *   brand: handelsmarke (produkte/NoName) → marke/markenname (markenProdukte) → brandKey (reweapify)
 */
async function enrichCandidates(cands) {
  const byCol = {};
  for (const c of cands) (byCol[c.source] = byCol[c.source] || []).push(c);
  for (const [col, list] of Object.entries(byCol)) {
    if (!col) continue;
    const refs = list.map((c) => db.collection(col).doc(String(c.id)));
    let docs = [];
    try {
      docs = await db.getAll(...refs, { fieldMask: ['bildClean', 'bildCleanHq', 'bild', 'image', 'handelsmarke', 'marke', 'markenname', 'brandKey'] });
    } catch (e) {
      continue;
    }
    const map = {};
    docs.forEach((d) => (map[d.id] = d.exists ? d.data() : {}));
    // Nur Strings durchreichen — manche Felder (z.B. marke/handelsmarke) sind
    // Firestore-DocumentReferences; die im Callable-Response würden den Encoder
    // in eine Endlos-Rekursion schicken ("Maximum call stack size exceeded").
    const asStr = (v) => (typeof v === 'string' ? v : v && typeof v.id === 'string' ? v.id : null);
    for (const c of list) {
      const x = map[String(c.id)] || {};
      c.image = asStr(x.bildClean || x.bildCleanHq || x.bild || x.image);
      c.brand = asStr(x.handelsmarke) || asStr(x.marke) || asStr(x.markenname) || asStr(x.brandKey);
    }
  }
  return cands;
}

module.exports = { matchLine, norm, aliasId, embedQuery, shortlist, enrichCandidates, discounterIdForSlug, MATCH_VERSION };
