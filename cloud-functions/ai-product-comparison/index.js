/**
 * ai-product-comparison — NoName-vs-Markenprodukt-Bewertung via Gemini.
 *
 * ─── Was das tut ─────────────────────────────────────────────────────
 *
 * Pro NoName-Produkt (`produkte/{id}`) wird verglichen wie es im
 * Verhältnis zum gelinkten Markenprodukt (`markenProdukte/{ref}`)
 * abschneidet:
 *
 *   • 5-Punkte-Skala (1=NoName deutlich schlechter / rot
 *                     → 5=NoName deutlich besser / grün)
 *   • Kurzer Begründungstext (1-2 Sätze, DE, max 220 Zeichen)
 *
 * Ergebnis landet auf produkte/{id}.aiComparison:
 *   {
 *     score: 1..5,
 *     reasoning: "Kurzer Text",
 *     model: "gemini-2.5-flash",
 *     promptVersion: "v1",
 *     inputHash: "abc123...",  // sha256 von Inputs, kappt 16 chars
 *     updatedAt: Timestamp,
 *     skipped?: "no-markenprodukt" | "incomparable" | undefined,
 *   }
 *
 * ─── Wann das läuft ──────────────────────────────────────────────────
 *
 *   1. onProduktCreate     — neues NoName-Produkt angelegt
 *   2. onProduktUpdate     — relevante Felder (Nutrition / Zutaten /
 *                            markenProdukt-Ref) haben sich geändert
 *   3. onMarkenProduktUpdate — Original-Markenprodukt-Nutrition oder
 *                            -Zutaten geändert → alle gelinkten
 *                            NoNames neu bewerten
 *   4. runComparisonBackfill (HTTPS, manual) — alle NoNames ohne
 *                            aiComparison.score abarbeiten
 *   5. runComparisonForProduct (HTTPS, manual) — eine spezifische
 *                            EAN/ID neu bewerten (debug + admin)
 *
 * ─── Idempotenz / Cost-Cap ───────────────────────────────────────────
 *
 * Vor jedem Gemini-Call:
 *   • hashed die relevanten Inputs (Nährwerte + Zutaten beider Produkte)
 *   • vergleicht mit `aiComparison.inputHash`
 *   • wenn identisch + selbe promptVersion → SKIP (kein Gemini-Call)
 *
 * Verhindert dass z.B. ein onProduktUpdate-Trigger durch Image-URL-
 * Änderung einen Gemini-Call auslöst.
 *
 * ─── Skip-Logik ──────────────────────────────────────────────────────
 *
 * Comparison wird gesetzt mit `skipped: 'no-markenprodukt'` wenn der
 * NoName keinen markenProdukt-Ref hat (= kein Original zum Vergleichen).
 *
 * Mit `skipped: 'incomparable'` wenn beide Produkte keine sinnvollen
 * Daten haben (weder Nährwerte noch Zutaten).
 *
 * Client kann dann score nicht anzeigen — UI fällt zurück auf "—".
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v2');
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const {
  snapshotFromDoc,
  isSnapshotComparable,
  callGemini,
  PROMPT_VERSION,
  DEFAULT_MODEL,
} = require('./src/comparator');
const {
  ASSESSMENT_PROMPT_VERSION,
  snapshotFromDoc: assessmentSnapshotFromDoc,
  isAssessable,
  callGeminiAssessment,
} = require('./src/assessor');
const { inputHash } = require('./src/hash');

if (!admin.apps.length) admin.initializeApp();

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const TRIGGER_KEY = defineSecret('NUTRITION_SCRAPER_TRIGGER_KEY');

const REGION = 'europe-west1';
const COMMON_OPTS = {
  region: REGION,
  timeoutSeconds: 540,
  memory: '512MiB',
  secrets: [GEMINI_API_KEY],
};

// ════════════════════════════════════════════════════════════════════
// Hilfsfunktion — runComparison(produktId)
// ════════════════════════════════════════════════════════════════════

/**
 * Macht einen kompletten Comparison-Pass für ein NoName-Produkt.
 * Returnt { state: 'updated' | 'skipped-nochange' | 'no-markenprodukt'
 *           | 'incomparable' | 'gemini-failed', detail?: string }
 *
 * Idempotent: wenn der Input-Hash unverändert ist, kein Gemini-Call.
 */
async function runComparison(db, produktId, opts = {}) {
  const { force = false, apiKey } = opts;
  const produktRef = db.collection('produkte').doc(produktId);
  const produktSnap = await produktRef.get();
  if (!produktSnap.exists) {
    return { state: 'not-found' };
  }
  const produktData = produktSnap.data() || {};

  // markenProdukt-Ref auflösen
  const mpRef = produktData.markenProdukt;
  if (!mpRef) {
    // Kein MP-Link → kein Vergleich möglich. Stattdessen Standalone-
    // Assessment (Kategorie-relative Bewertung) durchführen, damit
    // auch Stufe-1/2-Produkte eine KI-Aussage bekommen (User-Vorgabe
    // 2026-05-28).
    return await runAssessment(db, produktId, opts);
  }

  // Akzeptiert sowohl DocReference als auch String-ID
  let mpDoc;
  try {
    if (typeof mpRef === 'string') {
      mpDoc = await db.collection('markenProdukte').doc(mpRef).get();
    } else if (mpRef.get && typeof mpRef.get === 'function') {
      // Firestore DocumentReference
      mpDoc = await mpRef.get();
    } else if (mpRef.path) {
      // Falls als String-Path serialisiert ist
      mpDoc = await db.doc(mpRef.path).get();
    } else {
      throw new Error('Unbekanntes markenProdukt-Ref-Format');
    }
  } catch (e) {
    console.warn(`[ai-comparison] markenProdukt-Resolve failed für ${produktId}:`, e.message);
    return { state: 'mp-resolve-failed', detail: e.message };
  }

  if (!mpDoc.exists) {
    return { state: 'mp-missing' };
  }

  const nonameSnap = snapshotFromDoc(produktData);
  const originalSnap = snapshotFromDoc(mpDoc.data());

  if (!isSnapshotComparable(nonameSnap) || !isSnapshotComparable(originalSnap)) {
    await produktRef.set(
      {
        aiComparison: {
          skipped: 'incomparable',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          promptVersion: PROMPT_VERSION,
        },
      },
      { merge: true },
    );
    return { state: 'incomparable' };
  }

  // Hash-Check — wenn Input + Prompt identisch, nichts tun.
  const hash = inputHash(nonameSnap, originalSnap);
  const prev = produktData.aiComparison;
  if (
    !force &&
    prev?.inputHash === hash &&
    prev?.promptVersion === PROMPT_VERSION &&
    typeof prev?.score === 'number'
  ) {
    return { state: 'skipped-nochange' };
  }

  // Gemini-Call
  let result;
  try {
    result = await callGemini({
      apiKey: apiKey || GEMINI_API_KEY.value(),
      snapshot: { noname: nonameSnap, original: originalSnap },
    });
  } catch (e) {
    console.error(`[ai-comparison] Gemini failed für ${produktId}:`, e.message);
    // Trotzdem aiComparison-Doc schreiben mit Fehler-Marker damit der
    // Client weiß "wir haben's versucht, aber es ging schief" und nicht
    // ewig auf eine Antwort wartet. lastError-Feld ist nur für Debug.
    await produktRef.set(
      {
        aiComparison: {
          lastError: String(e.message || e).slice(0, 200),
          lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
          promptVersion: PROMPT_VERSION,
        },
      },
      { merge: true },
    );
    return { state: 'gemini-failed', detail: e.message };
  }

  await produktRef.set(
    {
      aiComparison: {
        score: result.score,
        reasoning: result.reasoning,
        model: result.model,
        promptVersion: result.promptVersion,
        inputHash: hash,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Reset error markers bei Erfolg
        lastError: admin.firestore.FieldValue.delete(),
        lastErrorAt: admin.firestore.FieldValue.delete(),
        skipped: admin.firestore.FieldValue.delete(),
      },
    },
    { merge: true },
  );

  return {
    state: 'updated',
    detail: `score=${result.score} model=${result.model}`,
  };
}

// ════════════════════════════════════════════════════════════════════
// Hilfsfunktion — runAssessment(produktId)
// ════════════════════════════════════════════════════════════════════
//
// Standalone-Bewertung wenn KEIN markenProdukt-Link existiert.
// Output landet auf produkte/{id}.aiAssessment (separates Feld zu
// aiComparison damit die UI klar trennen kann).
//
// Hash-Check über die Input-Snapshot — wenn Nährwerte/Zutaten/Name
// unverändert, kein Gemini-Call.

async function runAssessment(db, produktId, opts = {}) {
  const { force = false, apiKey } = opts;
  const produktRef = db.collection('produkte').doc(produktId);
  const produktSnap = await produktRef.get();
  if (!produktSnap.exists) {
    return { state: 'not-found' };
  }
  const produktData = produktSnap.data() || {};
  const snap = assessmentSnapshotFromDoc(produktData);

  if (!isAssessable(snap)) {
    // Wirklich gar nichts da — selbst Name fehlt. Schreiben wir
    // skipped damit nicht jeder Trigger das nochmal versucht.
    await produktRef.set(
      {
        aiAssessment: {
          skipped: 'no-data',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          promptVersion: ASSESSMENT_PROMPT_VERSION,
        },
      },
      { merge: true },
    );
    return { state: 'assessment-no-data' };
  }

  // Hash-Check — einfacher als bei Comparison weil nur ein Produkt
  const hashKey = JSON.stringify([
    snap.energy, snap.fat, snap.satFat, snap.carbs, snap.sugar,
    snap.fiber, snap.protein, snap.salt,
    String(snap.ingredients || '').toLowerCase().replace(/\s+/g, ' ').trim(),
  ]);
  const hash = require('crypto').createHash('sha256').update(hashKey).digest('hex').slice(0, 16);
  const prev = produktData.aiAssessment;
  if (
    !force &&
    prev?.inputHash === hash &&
    prev?.promptVersion === ASSESSMENT_PROMPT_VERSION &&
    typeof prev?.healthScore === 'number'
  ) {
    return { state: 'assessment-skipped-nochange' };
  }

  // Kategorie aus kategorie-Ref auflösen (falls Ref). Optional —
  // wenn nicht resolvebar, geht Gemini ohne Kategorie-Hinweis weiter.
  let categoryName = null;
  try {
    const catRef = produktData.kategorie;
    if (catRef) {
      let catDoc;
      if (typeof catRef === 'string') {
        catDoc = await db.collection('kategorien').doc(catRef).get();
      } else if (catRef.get && typeof catRef.get === 'function') {
        catDoc = await catRef.get();
      } else if (catRef.path) {
        catDoc = await db.doc(catRef.path).get();
      }
      if (catDoc?.exists) {
        const c = catDoc.data() || {};
        categoryName = c.bezeichnung || c.name || null;
      }
    }
  } catch (e) {
    // Egal — Kategorie ist optional
  }

  // Gemini-Call
  let result;
  try {
    result = await callGeminiAssessment({
      apiKey: apiKey || GEMINI_API_KEY.value(),
      snapshot: snap,
      category: categoryName,
    });
  } catch (e) {
    console.error(`[ai-assessment] Gemini failed für ${produktId}:`, e.message);
    await produktRef.set(
      {
        aiAssessment: {
          lastError: String(e.message || e).slice(0, 200),
          lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
          promptVersion: ASSESSMENT_PROMPT_VERSION,
        },
      },
      { merge: true },
    );
    return { state: 'assessment-gemini-failed', detail: e.message };
  }

  await produktRef.set(
    {
      aiAssessment: {
        healthScore: result.healthScore,
        reasoning: result.reasoning,
        model: result.model,
        promptVersion: result.promptVersion,
        inputHash: hash,
        category: categoryName,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: admin.firestore.FieldValue.delete(),
        lastErrorAt: admin.firestore.FieldValue.delete(),
        skipped: admin.firestore.FieldValue.delete(),
      },
    },
    { merge: true },
  );

  return {
    state: 'assessment-updated',
    detail: `healthScore=${result.healthScore} model=${result.model}`,
  };
}

// ════════════════════════════════════════════════════════════════════
// Trigger 1 — onProduktCreate (neues NoName-Produkt)
// ════════════════════════════════════════════════════════════════════

exports.onProduktCreateForComparison = onDocumentCreated(
  {
    ...COMMON_OPTS,
    document: 'produkte/{produktId}',
  },
  async (event) => {
    const produktId = event.params.produktId;
    const db = admin.firestore();
    try {
      const res = await runComparison(db, produktId);
      console.log(`[ai-comparison][onCreate] ${produktId} → ${res.state} ${res.detail || ''}`);
    } catch (e) {
      console.error(`[ai-comparison][onCreate] ${produktId} unexpected:`, e?.message);
    }
  },
);

// ════════════════════════════════════════════════════════════════════
// Trigger 2 — onProduktUpdate (nur wenn relevante Felder geändert)
// ════════════════════════════════════════════════════════════════════
//
// Wichtig: Firestore feuert onUpdate für JEDE Änderung am Doc. Wenn der
// Hash-Check unten greift, kostet das nur 1 Read + 0 Gemini-Calls. Aber
// wir können noch früher abbrechen wenn die Diff KEINE relevanten Felder
// betrifft — spart 1 Markenprodukt-Read pro irrelevantem Update.

const RELEVANT_PRODUKTE_FIELDS = [
  'markenProdukt',
  'stufe',
  'nutr_Energie_val',
  'nutr_Energie_unit', // v10: bei kJ↔kcal-Switch muss neu konvertiert werden
  'nutr_Fett_val',
  'nutr_FettdavongesttigteFettsuren_val',
  'nutr_Kohlenhydrate_val',
  'nutr_KohlenhydratedavonZucker_val',
  'nutr_Ballaststoffe_val',
  'nutr_Eiwei_val',
  'nutr_Salz_val',
  'attr_ingredientStatement',
  'zutaten', // legacy
  // v10: Labels → bei Änderung neu evaluieren
  'nutriscore', 'ecoscore', 'nova',
  'attr_isVegan', 'isVegan',
  'attr_isVegetarisch', 'isVegetarian',
  'attr_isBio', 'isBio',
  'attr_isGlutenfrei', 'isGlutenFree',
  'attr_isLaktosefrei', 'isLactoseFree',
];

function relevantFieldsChanged(before, after, fields) {
  if (!before || !after) return true;
  for (const f of fields) {
    const a = before[f];
    const b = after[f];
    // Object/Ref-Vergleich: für Refs vergleichen wir .path falls da,
    // sonst JSON-stringify.
    const aStr = serialize(a);
    const bStr = serialize(b);
    if (aStr !== bStr) return true;
  }
  return false;
}

function serialize(v) {
  if (v == null) return 'null';
  if (typeof v === 'object') {
    if (v.path) return `ref:${v.path}`;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

exports.onProduktUpdateForComparison = onDocumentUpdated(
  {
    ...COMMON_OPTS,
    document: 'produkte/{produktId}',
  },
  async (event) => {
    const produktId = event.params.produktId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!relevantFieldsChanged(before, after, RELEVANT_PRODUKTE_FIELDS)) {
      // Häufiger Fall: image-Update, stufe-Update, etc. → skip ohne
      // Gemini-Call. Wichtig damit wir nicht in Kosten ertrinken.
      return;
    }
    const db = admin.firestore();
    try {
      const res = await runComparison(db, produktId);
      console.log(`[ai-comparison][onUpdate] ${produktId} → ${res.state} ${res.detail || ''}`);
    } catch (e) {
      console.error(`[ai-comparison][onUpdate] ${produktId} unexpected:`, e?.message);
    }
  },
);

// ════════════════════════════════════════════════════════════════════
// Trigger 3 — onMarkenProduktUpdate (Original geändert → alle NoNames neu)
// ════════════════════════════════════════════════════════════════════
//
// Konservativ: triggert nur bei Nährwert/Zutaten-Änderungen. Sucht alle
// produkte mit markenProdukt-Ref auf dieses MP und triggert runComparison
// für jedes. Limit defensive da NoName/MP-Verhältnis bis zu 1:N werden
// kann (theoretisch ein populäres MP mit 20 NoNames).

const RELEVANT_MP_FIELDS = [
  'nutr_Energie_val',
  'nutr_Energie_unit',
  'nutr_Fett_val',
  'nutr_FettdavongesttigteFettsuren_val',
  'nutr_Kohlenhydrate_val',
  'nutr_KohlenhydratedavonZucker_val',
  'nutr_Ballaststoffe_val',
  'nutr_Eiwei_val',
  'nutr_Salz_val',
  'attr_ingredientStatement',
  'zutaten',
  'nutriscore', 'ecoscore', 'nova',
  'attr_isVegan', 'isVegan',
  'attr_isVegetarisch', 'isVegetarian',
  'attr_isBio', 'isBio',
  'attr_isGlutenfrei', 'isGlutenFree',
  'attr_isLaktosefrei', 'isLactoseFree',
];

const MP_FANOUT_LIMIT = 30; // Sanity-Cap pro MP

exports.onMarkenProduktUpdateForComparison = onDocumentUpdated(
  {
    ...COMMON_OPTS,
    document: 'markenProdukte/{markenProduktId}',
  },
  async (event) => {
    const mpId = event.params.markenProduktId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!relevantFieldsChanged(before, after, RELEVANT_MP_FIELDS)) {
      return;
    }
    const db = admin.firestore();
    const mpRef = db.collection('markenProdukte').doc(mpId);

    // Finde alle NoNames die auf dieses MP zeigen
    let linkedSnap;
    try {
      linkedSnap = await db
        .collection('produkte')
        .where('markenProdukt', '==', mpRef)
        .limit(MP_FANOUT_LIMIT)
        .get();
    } catch (e) {
      console.warn(`[ai-comparison][onMpUpdate] query failed for mp=${mpId}:`, e?.message);
      return;
    }
    console.log(
      `[ai-comparison][onMpUpdate] mp=${mpId} touched, ${linkedSnap.size} linked NoNames`,
    );
    // Sequentiell — nicht parallel — damit wir die Rate-Limits von
    // Gemini nicht reissen. Bei großem Fan-out könnte man später
    // batchen oder eine Task-Queue einbauen.
    for (const doc of linkedSnap.docs) {
      try {
        const res = await runComparison(db, doc.id);
        console.log(`[ai-comparison][onMpUpdate] noname=${doc.id} → ${res.state}`);
      } catch (e) {
        console.error(`[ai-comparison][onMpUpdate] noname=${doc.id} failed:`, e?.message);
      }
    }
  },
);

// ════════════════════════════════════════════════════════════════════
// HTTPS-Endpoint — runComparisonForProduct (admin / debug)
// ════════════════════════════════════════════════════════════════════
//
// Aufruf:
//   curl 'https://…/runComparisonForProduct?key=<TRIGGER_KEY>&produktId=<ID>&force=1'

exports.runComparisonForProduct = onRequest(
  {
    ...COMMON_OPTS,
    secrets: [GEMINI_API_KEY, TRIGGER_KEY],
  },
  async (req, res) => {
    const triggerKey = TRIGGER_KEY.value();
    const provided = req.query?.key || req.body?.key;
    if (!triggerKey || provided !== triggerKey) {
      res.status(401).send('Unauthorized');
      return;
    }
    const produktId = String(req.query?.produktId || req.body?.produktId || '').trim();
    if (!produktId) {
      res.status(400).send('Missing produktId');
      return;
    }
    const force = String(req.query?.force || req.body?.force || '') === '1';
    try {
      const result = await runComparison(admin.firestore(), produktId, { force });
      res.status(200).json({ produktId, ...result });
    } catch (e) {
      res.status(500).send(String(e?.message || e));
    }
  },
);

// ════════════════════════════════════════════════════════════════════
// HTTPS-Endpoint — runComparisonBackfill (initialer Mass-Run)
// ════════════════════════════════════════════════════════════════════
//
// Iteriert alle produkte ohne aiComparison.score und ohne
// aiComparison.skipped == 'no-markenprodukt'. Throttle: 1 Gemini-Call
// pro 200ms (= 5 RPS, weit unter Standard-Rate-Limit). Aufruf
// idempotent — bereits-prozessierte Docs überspringt der Hash-Check.
//
// Aufruf:
//   curl 'https://…/runComparisonBackfill?key=<TRIGGER_KEY>&limit=200'
//
// Continuation: response enthält `nextStartAfter` — den Wert als
// `startAfter`-Param beim nächsten Call mitgeben um weitere Batches
// zu prozessieren.

exports.runComparisonBackfill = onRequest(
  {
    ...COMMON_OPTS,
    timeoutSeconds: 540, // 9 min — Backfill von ~150 Produkten passt
    secrets: [GEMINI_API_KEY, TRIGGER_KEY],
  },
  async (req, res) => {
    const triggerKey = TRIGGER_KEY.value();
    const provided = req.query?.key || req.body?.key;
    if (!triggerKey || provided !== triggerKey) {
      res.status(401).send('Unauthorized');
      return;
    }
    const limit = Math.min(
      500,
      Math.max(1, parseInt(req.query?.limit || req.body?.limit || '200', 10)),
    );
    const startAfter = String(req.query?.startAfter || req.body?.startAfter || '').trim();
    const dryRun = String(req.query?.dryRun || req.body?.dryRun || '') === '1';

    const db = admin.firestore();
    let queryRef = db
      .collection('produkte')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(limit);
    if (startAfter) queryRef = queryRef.startAfter(startAfter);

    const snap = await queryRef.get();
    console.log(`[ai-comparison][backfill] picked ${snap.size} docs`);

    let updated = 0;
    let skippedNoMP = 0;
    let skippedIncomparable = 0;
    let skippedNoChange = 0;
    let geminiFailed = 0;
    let lastDocId = startAfter;

    for (const doc of snap.docs) {
      lastDocId = doc.id;
      const data = doc.data();
      const ai = data?.aiComparison;
      // Backfill-Skip: bereits prozessiert UND Prompt-Version aktuell.
      if (
        !dryRun &&
        ai?.promptVersion === PROMPT_VERSION &&
        (typeof ai.score === 'number' || ai.skipped)
      ) {
        // Schon erledigt, nichts zu tun.
        continue;
      }
      if (dryRun) {
        console.log(`[ai-comparison][backfill][dry] would process ${doc.id}`);
        continue;
      }
      try {
        const res2 = await runComparison(db, doc.id);
        switch (res2.state) {
          case 'updated':
            updated += 1;
            break;
          case 'no-markenprodukt':
            skippedNoMP += 1;
            break;
          case 'incomparable':
            skippedIncomparable += 1;
            break;
          case 'skipped-nochange':
            skippedNoChange += 1;
            break;
          case 'gemini-failed':
            geminiFailed += 1;
            break;
        }
      } catch (e) {
        geminiFailed += 1;
        console.error(`[ai-comparison][backfill] ${doc.id} failed:`, e?.message);
      }
      // Throttle: ~5 RPS gegen Gemini damit wir nicht Rate-Limit reissen
      await sleep(200);
    }

    const summary = {
      picked: snap.size,
      updated,
      skippedNoMP,
      skippedIncomparable,
      skippedNoChange,
      geminiFailed,
      nextStartAfter: snap.size === limit ? lastDocId : null,
      dryRun,
    };
    console.log('[ai-comparison][backfill] done', summary);
    res.status(200).json(summary);
  },
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
