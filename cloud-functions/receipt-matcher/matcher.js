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

const NONAME_K = 16;
const MARKE_K = 10;
const AUTO_LOCK = 0.9; // ≥ → automatisch locken (Tier-1) bzw. Promotion (Tier-2)
const REVIEW_MIN = 0.7; // [REVIEW_MIN, AUTO_LOCK) → Mensch-Review

// Negativ-Cache (Fix 16.08.2026): Wie lange ein 'needs_review'/'promotion_
// pending'-Ergebnis als frisch gilt. Innerhalb des Fensters wird dieselbe
// (Markt, normKey)-Zeile NICHT erneut durch Embedding+KI geschickt —
// gemessen liefen 26,8 % aller KI-Aufrufe auf bereits analysierte Strings
// ("Wasser still" 23x), weil diese Ausgänge keinen Alias hinterließen.
// Nach Ablauf bekommt die Zeile eine frische Analyse: der Katalog wächst,
// aus needs_review kann ein Treffer werden.
const PENDING_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Ist ein Pending-Marker am Alias-Doc frisch genug, um die teure
 * Neu-Analyse zu ersetzen? Pure Funktion — testbar ohne Firestore.
 *
 * Bewusst NICHT frisch, wenn:
 *  • das Doc gelockt ist (menschliche/automatische Entscheidung gewinnt
 *    IMMER — der Marker schreibt deshalb auch nie `resolvedBy`),
 *  • eine andere MATCH_VERSION ihn schrieb (neue Logik → neu analysieren),
 *  • er älter als PENDING_TTL_MS ist.
 */
function istPendingFrisch(a, nowMs, version) {
  if (!a || !a.pendingStatus) return false;
  const locked = a.resolvedBy && a.resolvedBy !== 'ai-review-pending';
  if (locked) return false;
  if (a.pendingMatchVersion !== version) return false;
  const t = a.lastAiAt && typeof a.lastAiAt.toMillis === 'function' ? a.lastAiAt.toMillis() : 0;
  return t > 0 && nowMs - t < PENDING_TTL_MS;
}

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

// Größe/Menge aus einem Produkt-/Bon-String ziehen ("Goldmais 140g" → "140g",
// "Cola 0,33l" → "0,33l", "6x0,33l", "250 ml", "1 kg", "10 Stück").
function parseSize(s) {
  const t = String(s || '');
  const m = t.match(/(\d+\s?[x×]\s?)?\d+(?:[.,]\d+)?\s?(?:kg|g|ml|cl|l|stk|stück|stück\.|st\.|pck|er)\b/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

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

// Discounter-Cache (einmal pro warmer Instanz): id → { name, land, nn }.
let _discCache = null;
async function ensureDiscounters() {
  if (_discCache) return _discCache;
  const byId = {};
  const ds = await db.collection('discounter').get();
  ds.forEach((d) => {
    const x = d.data();
    byId[d.id] = { name: x.name || null, land: x.land || null, nn: norm(x.name) };
  });
  _discCache = { byId };
  return _discCache;
}

/**
 * ALLE discounter-IDs zum Slug — ein Markt kann mehrfach existieren (z.B. LiDL
 * DE + AT). Land-Match wird vorgezogen, damit der Markt-Bonus die richtige
 * Filiale bevorzugt. Wird NICHT mehr als harter Filter genutzt (nur Bonus).
 */
async function discounterIdsForSlug(slug, land) {
  const c = await ensureDiscounters();
  const s = norm(slug);
  if (!s) return [];
  const matches = Object.entries(c.byId)
    .filter(([, v]) => v.nn && (v.nn === s || v.nn.includes(s) || s.includes(v.nn)))
    .map(([id, v]) => ({ id, land: v.land }));
  if (land) matches.sort((a, b) => (b.land === land ? 1 : 0) - (a.land === land ? 1 : 0));
  return matches.map((m) => m.id);
}

/**
 * findNearest Shortlist:
 *  - MARKE: markt-agnostisch (Marken gibt es in jedem Markt).
 *  - NoName/EIGENMARKE: NUR aus dem/den Markt-ID(s) des Bons — Eigenmarken sind
 *    markt-EXKLUSIV (eine Penny-Eigenmarke gibt es nicht bei Lidl). Es wird über
 *    ALLE IDs des Markt-Slugs gesucht (z.B. Lidl-DE UND -AT), damit die frühere
 *    DE/AT-Falschauflösung nicht wieder das echte Produkt ausschließt.
 *  - Markt unbekannt → Fallback markt-agnostisch (besser als keine Kandidaten).
 */
async function shortlist(queryVec, bonMarketIds) {
  const c = await ensureDiscounters();
  const qv = FieldValue.vector(queryVec);
  const col = db.collection('productEmbeddings');
  const near = (q, limit) => q.findNearest({ vectorField: 'vector', queryVector: qv, limit, distanceMeasure: 'COSINE', distanceResultField: '_dist' }).get();

  const ids = bonMarketIds && bonMarketIds.length ? bonMarketIds : null;
  const tasks = [near(col.where('type', '==', 'marke'), MARKE_K)];
  if (ids) {
    for (const id of ids) tasks.push(near(col.where('type', '==', 'noname').where('discounterId', '==', id), NONAME_K));
  } else {
    tasks.push(near(col.where('type', '==', 'noname'), NONAME_K)); // Markt unbekannt → agnostisch
  }
  const snaps = await Promise.all(tasks);

  const out = [];
  snaps.forEach((snap) =>
    snap.forEach((doc) => {
      const x = doc.data();
      out.push({
        id: doc.id, // = produkte/markenProdukte/reweapify DocId
        name: x.name,
        type: x.type,
        source: x.sourceCollection,
        tier: x.sourceCollection === 'reweapify' ? 2 : 1,
        preis: x.preis,
        gtin: x.gtin || null,
        brand: x.brand || null,
        handelsmarke: x.handelsmarke || null,
        size: x.size || null,
        discounterId: x.discounterId || null,
        market: x.discounterId && c.byId[x.discounterId] ? c.byId[x.discounterId].name : null,
        sameMarket: x.type === 'noname', // NoName ist bereits markt-gefiltert
        dist: x._dist,
      });
    }),
  );
  const seen = new Set();
  return out
    .sort((a, b) => (a.dist ?? 9) - (b.dist ?? 9))
    .filter((x) => (seen.has(x.id) ? false : seen.add(x.id)))
    .slice(0, NONAME_K + MARKE_K);
}

const PICK_SYS = `Du bist Experte für deutsche/österreichische Kassenbons. Ordne EINE Bon-Zeile dem am besten passenden Kandidaten zu (dessen Index) ODER gib candidateIdx -1 ("kein passender Kandidat").

ZUORDNEN HOLISTISCH über ALLE Signale gemeinsam — nicht über ein einzelnes Kriterium:
- Produktname/Sorte (Hauptsignal)
- Marke bzw. Handelsmarke (s.u.)
- Markt: Jeder Kandidat zeigt seinen Markt; „✓(gleicher Markt wie Bon)" = im selben Markt verkauft. Eine Eigenmarke/NoName (Milbona, G&G, chef select…) gibt es NUR im eigenen Markt → bei Eigenmarken-/NoName-Bon-Zeilen einen ✓-Kandidaten STARK bevorzugen. Bei echten Marken ist der Markt unwichtig (gibt es überall).
- Preis (grob plausibel; Aktionspreise weichen ab)
- Größe/Menge (z.B. 0,33l ≠ 1l, 140g ≠ 425g) — wenn angegeben, als Bestätigung nutzen, nicht als K.o. bei kleinen Abweichungen
- ★-Anker (Einkaufszettel/zuletzt gekauft, s.u.)

EIGENMARKEN / KÜRZEL auf dem Bon = Handelsmarke des Markts:
G&G/GUT&GÜNSTIG=EDEKA/Netto · JA!=REWE · K-CLASSIC/KLC=Kaufland · MILBONA/MILSANI/MILFINA=Lidl/Aldi · GUT BIO/BIO SONNE=Aldi/Netto · REWE BIO/REWE BESTE WAHL=REWE · GUT&GERNE·EDEKA · usw.
→ Ein Eigenmarken-Bon (z.B. "G&G Sonnenmais") passt am besten zu einem Kandidaten, dessen **Handelsmarke** dazu passt (z.B. Handelsmarke G&G). Solche Kandidaten STARK bevorzugen.
→ Die NoName/Marke-Klassifikation im Katalog ist NICHT immer sauber. Wenn der beste Kandidat über Name+Größe+Preis+Markt klar dasselbe Produkt ist, ORDNE ZU — auch wenn das Typ-Label (NoName/Marke) nicht ideal passt. Das Typ-Label ist ein Hinweis, KEIN hartes Verbot.

PERSÖNLICHER ANKER: ★[Einkaufszettel]/★[zuletzt gekauft] hatte DIESER Nutzer gerade/kürzlich — starker Hinweis. Bevorzugen, wenn Name/Markt/Preis/Größe plausibel passen.

WICHTIG bei Namens-Übereinstimmung aber Marken-Abweichung: Wenn ein Kandidat in Produktname (+ ggf. Größe/Preis/Markt) klar dasselbe Produkt beschreibt, aber die Marke/Handelsmarke abweicht (z.B. Bon "G&G Sonnenmais" vs Kandidat "Sonnenmais" einer anderen Marke), dann NICHT -1, sondern diesen besten Kandidaten mit MITTLERER confidence (0.5–0.7) vorschlagen → der Mensch entscheidet. Nur bei reiner Kategorie-/Wortähnlichkeit ohne echte Produktgleichheit -1.

NICHT zuordnen (candidateIdx -1):
- Frischware ohne Marke (loses Obst/Gemüse/Theke: "Avocado","Banane","Hähnchenbrust") → lineType "nonproduct".
- Wenn KEIN Kandidat plausibel dasselbe Produkt ist (nur Kategorie, z.B. "Cola" vs irgendeine andere Limo-Sorte) → -1.
PFAND/LEERGUT → "pfand". RABATT/SUMME/ZAHLART/COUPON/PAYBACK → "nonproduct".

CONFIDENCE ehrlich (wie sicher ist es DASSELBE Produkt):
- 0.90+  klar dasselbe (Name/Größe + Marke/Handelsmarke + Markt + Preis stimmig)
- 0.70–0.89  gut, kleine Restunsicherheit (z.B. Größe fehlt)
- 0.50–0.69  plausibel aber unsicher → Mensch prüft
- <0.50 / -1  kein überzeugender Treffer

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

async function geminiPick(itemName, marktSlug, priceCents, cands, bonSize) {
  const user =
    `Bon-Zeile: "${itemName}"\nMarkt: ${marktSlug}\nPreis: ${(priceCents / 100).toFixed(2)} €${bonSize ? `\nGröße/Menge: ${bonSize}` : ''}\n\nKandidaten:\n` +
    cands
      .map((c, i) => {
        const brand = c.handelsmarke ? `Handelsmarke: ${c.handelsmarke}` : c.brand ? `Marke: ${c.brand}` : '';
        const market = c.market ? ` · Markt: ${c.market}${c.sameMarket ? ' ✓(gleicher Markt wie Bon)' : ''}` : '';
        return `[${i}] ${c.name} | ${c.type === 'noname' ? 'NoName' : 'Marke'}${brand ? ' · ' + brand : ''}${c.size ? ' · ' + c.size : ''}${c.preis != null ? ` · ${Number(c.preis).toFixed(2)}€` : ''}${market}${c.tier === 2 ? ' · (reweapify)' : ''}${c.personal ? ` ★[${c.reason}]` : ''}`;
      })
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
    const dc = await ensureDiscounters();
    const refs = [...ids].map((id) => db.collection('productEmbeddings').doc(String(id)));
    const docs = await db.getAll(...refs).catch(() => []);
    cands = docs
      .filter((d) => d.exists)
      .map((d) => {
        const x = d.data();
        const vv = x.vector;
        const _vec = vv && typeof vv.toArray === 'function' ? vv.toArray() : Array.isArray(vv) ? vv : null;
        return { id: d.id, name: x.name, type: x.type, source: x.sourceCollection, preis: x.preis, brand: x.brand || null, handelsmarke: x.handelsmarke || null, size: x.size || null, discounterId: x.discounterId || null, market: x.discounterId && dc.byId[x.discounterId] ? dc.byId[x.discounterId].name : null, tier: x.sourceCollection === 'reweapify' ? 2 : 1, personal: true, reason: reason[d.id] || 'persönlich', _vec };
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
  const { itemName, marktSlug, priceCents = 0, userId = null, receiptId = null, ppRef = null, merchantName = null, merchantLand = null, bonDate = null } = ctx;
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

      // NEGATIV-CACHE: Ein frischer Pending-Marker heißt, EXAKT diese
      // (Markt, normKey)-Zeile wurde bereits voll analysiert (Embedding +
      // KI) und wartet auf menschliche Review — eine erneute Analyse
      // liefert dasselbe Ergebnis und kostet nur Geld. Der Skip greift
      // NUR, wenn der User keine persönlichen Anker hat (Einkaufszettel /
      // kürzliche Käufe): mit passendem Zettel-Item kann dieselbe Zeile
      // über die abgesenkte Schwelle zu 'matched' werden — diese Chance
      // darf der Cache nicht nehmen. hitCount der Queue zählt beim Skip
      // weiter, es bleibt das Demand-Signal für die Review-Priorisierung.
      if (istPendingFrisch(a, Date.now(), MATCH_VERSION)) {
        const persoenliche = userId ? await fetchPersonalCandidates(userId) : [];
        if (!persoenliche.length) {
          if (!dryRun) {
            await aliasRef.set(
              { votes: FieldValue.increment(1), lastSeen: FieldValue.serverTimestamp() },
              { merge: true },
            );
            if (a.pendingStatus === 'promotion_pending' && a.pendingReweapifyId) {
              await db
                .collection('promotionQueue')
                .doc(String(a.pendingReweapifyId))
                .set({ hitCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            } else {
              await db
                .collection('receiptReviewQueue')
                .doc(aliasId(marktSlug, normKey))
                .set({ hitCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
            }
          }
          if (a.pendingStatus === 'promotion_pending') {
            await writePP({ matchStatus: 'promotion_pending', reweapifyId: a.pendingReweapifyId || null, lineType: 'product', matchConfidence: a.pendingConfidence ?? null, matchSource: 'ai-cached' });
            return { status: 'promotion_pending', source: 'pending-cache', confidence: a.pendingConfidence ?? null };
          }
          await writePP({ matchStatus: 'needs_review', lineType: 'product', matchConfidence: a.pendingConfidence ?? null, matchSource: 'ai-cached' });
          return { status: 'needs_review', source: 'pending-cache', confidence: a.pendingConfidence ?? null };
        }
      }
    }
  }

  // 3) Embedding + Shortlist (markt-agnostisch; Markt nur als Bonus/Signal)
  const bonMarketIds = await discounterIdsForSlug(marktSlug, merchantLand);
  const qv = await embedQuery(itemName);
  if (!qv) {
    await writePP({ matchStatus: 'error', matchError: 'embed-failed' });
    return { status: 'error', reason: 'embed-failed' };
  }
  const catalogCands = await shortlist(qv, bonMarketIds);
  // Bon-Metadaten (Preis/Größe/Datum/Markt) einmal berechnen → an Alias + Queue.
  const bonDateStr = bonDate && bonDate.toDate ? bonDate.toDate().toISOString() : typeof bonDate === 'string' ? bonDate : null;
  const bonMeta = { priceCents, bonSize: parseSize(itemName), bonDate: bonDateStr, market: await marketInfo(receiptId, merchantName, merchantLand) };
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

  // 4) Gemini-Pick (mit Bon-Größe als zusätzliches Signal)
  let pick;
  try {
    pick = await geminiPick(itemName, marktSlug, priceCents, cands, parseSize(itemName));
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
    if (!dryRun) await lockAlias(marktSlug, normKey, { productId: cand.id, productSource: cand.source, lineType: 'product', confidence: conf, resolvedBy: cand.personal ? 'ai-anchor' : 'ai-auto', sampleName: itemName, bon: bonMeta });
    await writePP({ matchStatus: 'matched', productId: cand.id, productSource: cand.source, lineType: 'product', matchConfidence: conf, matchSource: cand.personal ? 'ai-anchor' : 'ai' });
    if (!opts.noClose) await closeJourneyForProduct(userId, cand.id, receiptId);
    if (!dryRun && receiptId) await writeReceiptMatch({ receiptId, ppId: ppRef && ppRef.id, userId, productId: cand.id, productSource: cand.source, confidence: conf, source: 'ai', itemName, marktSlug });
    return { status: 'matched', tier: 1, productId: cand.id, confidence: conf };
  }

  // Tier-2 (reweapify) plausibel → Promotion-Queue (Mensch gibt frei, kein Auto-Katalog).
  if (cand && cand.tier === 2 && conf >= REVIEW_MIN) {
    if (!dryRun) await enqueuePromotion({ reweapifyId: cand.id, name: cand.name, gtin: cand.gtin, kind: cand.type, marktSlug, normKey, sampleName: itemName, confidence: conf, ppId: ppRef && ppRef.id, userId, receiptId, market: bonMeta.market, bonDate: bonMeta.bonDate, priceCents, bonSize: bonMeta.bonSize });
    // Pending-Marker fürs Negativ-Cache (s. istPendingFrisch). Bewusst OHNE
    // `resolvedBy`: der Marker darf eine parallel laufende menschliche
    // Freigabe (setzt resolvedBy) niemals überschreiben — der locked-Check
    // im Lookup gewinnt dann automatisch.
    if (!dryRun) await aliasRef.set({ marktSlug: norm(marktSlug), normKey, pendingStatus: 'promotion_pending', pendingReweapifyId: cand.id, pendingConfidence: conf, pendingMatchVersion: MATCH_VERSION, lastAiAt: FieldValue.serverTimestamp(), sampleName: itemName, lastSeen: FieldValue.serverTimestamp() }, { merge: true });
    await writePP({ matchStatus: 'promotion_pending', reweapifyId: cand.id, lineType: 'product', matchConfidence: conf, matchSource: 'ai' });
    return { status: 'promotion_pending', tier: 2, reweapifyId: cand.id, confidence: conf };
  }

  // Alles andere mit Kandidaten — Tier-1 unsicher ODER KI hat -1 / keinen klaren Treffer.
  // KI RÄT NICHT automatisch → Mensch entscheidet (Vorschlag + Confidence + Shortlist + Katalog-Suche).
  // (cands ist hier garantiert nicht leer — der no-candidates-Fall ist oben abgefangen.)
  if (!dryRun) await enqueueReview({ marktSlug, normKey, sampleName: itemName, priceCents, bonSize: bonMeta.bonSize, bonDate: bonMeta.bonDate, market: bonMeta.market, candidates: cands.slice(0, 20), suggestionIdx: pick.candidateIdx, confidence: conf, ppId: ppRef && ppRef.id, userId, receiptId });
  // Pending-Marker fürs Negativ-Cache — ohne `resolvedBy`, s. Tier-2-Zweig.
  if (!dryRun) await aliasRef.set({ marktSlug: norm(marktSlug), normKey, pendingStatus: 'needs_review', pendingConfidence: conf, pendingMatchVersion: MATCH_VERSION, lastAiAt: FieldValue.serverTimestamp(), sampleName: itemName, lastSeen: FieldValue.serverTimestamp() }, { merge: true });
  await writePP({ matchStatus: 'needs_review', lineType: 'product', matchConfidence: conf, matchSource: 'ai' });
  return { status: 'needs_review', confidence: conf, suggestion: cand };
}

function writeReceiptMatch(m) {
  return db.collection('receiptMatches').add({ ...m, createdAt: FieldValue.serverTimestamp() });
}

// Markt-Info für die Queue: echter Name + Land + Roh-Markttext (OCR, enthält
// teils Filiale/Ort). Strukturierte Adresse existiert in den Daten nicht.
async function marketInfo(receiptId, name, land) {
  let raw = null;
  if (receiptId) {
    try {
      const r = await db.collection('receipts').doc(receiptId).get();
      if (r.exists) {
        const m = r.data().merchant || {};
        name = m.name || name;
        land = m.land || land;
        raw = m.raw || null;
      }
    } catch (e) {
      /* ignore */
    }
  }
  return { name: name || null, land: land || null, raw: raw && raw !== name ? raw : null };
}

function enqueueReview(r) {
  // Dedupe per (Markt, normKey): EINE Review-Karte je unbekanntem String.
  return db
    .collection('receiptReviewQueue')
    .doc(aliasId(r.marktSlug, r.normKey))
    .set(
      { ...r, status: 'open', hitCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
}

function enqueuePromotion(p) {
  // Dedupe per reweapify-Produkt.
  return db
    .collection('promotionQueue')
    .doc(String(p.reweapifyId))
    .set(
      { ...p, status: 'open', hitCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
}

/**
 * Kandidaten on-demand NUR mit Bild anreichern (für die Web-UI). Marke/
 * Handelsmarke/Größe liegen bereits am Kandidaten (aus productEmbeddings via
 * shortlist). Holt pro Quell-Collection das Bild-Feld per getAll.
 *   image: bildClean → bildCleanHq → bild → image (reweapify)
 */
async function enrichCandidates(cands) {
  const byCol = {};
  for (const c of cands) (byCol[c.source] = byCol[c.source] || []).push(c);
  const asStr = (v) => (typeof v === 'string' ? v : null);
  for (const [col, list] of Object.entries(byCol)) {
    if (!col) continue;
    const refs = list.map((c) => db.collection(col).doc(String(c.id)));
    let docs = [];
    try {
      docs = await db.getAll(...refs, { fieldMask: ['bildClean', 'bildCleanHq', 'bild', 'image'] });
    } catch (e) {
      continue;
    }
    const map = {};
    docs.forEach((d) => (map[d.id] = d.exists ? d.data() : {}));
    for (const c of list) {
      const x = map[String(c.id)] || {};
      c.image = asStr(x.bildClean) || asStr(x.bildCleanHq) || asStr(x.bild) || asStr(x.image);
    }
  }
  return cands;
}

module.exports = { matchLine, norm, aliasId, parseSize, embedQuery, shortlist, enrichCandidates, discounterIdsForSlug, MATCH_VERSION, istPendingFrisch, PENDING_TTL_MS };
