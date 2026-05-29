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
 * Die Trigger (1-3) bewerten NICHT sofort, sondern setzen nur ein
 * Dirty-Flag (`aiComparisonDirtyAt`). Der debounce-Sweeper (4) verarbeitet
 * ein Produkt erst, wenn seit der letzten Änderung ≥ 1h vergangen ist —
 * so läuft die KI nicht 5× während ein Pflege-Vorgang mehrere Felder
 * nacheinander schreibt (User-Vorgabe 2026-05-29).
 *
 *   1. onProduktCreate     — neues NoName-Produkt → dirty
 *   2. onProduktUpdate     — relevante Felder (Nutrition / Zutaten /
 *                            markenProdukt-Ref) geändert → dirty
 *   3. onMarkenProduktUpdate — Original-Markenprodukt-Nutrition oder
 *                            -Zutaten geändert → alle gelinkten
 *                            NoNames dirty (Vergleich springt automatisch
 *                            wieder an wenn die Marke später gepflegt wird)
 *   4. processPendingComparisons (scheduled, alle 15 Min) — verarbeitet
 *                            alle dirty-Produkte deren letzte Änderung ≥1h
 *                            her ist (trailing debounce)
 *   5. scheduledComparisonBackfill (scheduled) — Komplett-Durchlauf,
 *                            re-evaluiert alles bei promptVersion-Bump
 *   6. runComparisonBackfill / runComparisonForProduct (HTTPS, manual) —
 *                            sofort + force, für debug + admin
 *
 * ─── Fallback wenn kein Vergleich möglich ────────────────────────────
 *
 *   • NoName ohne markenProdukt-Link    → Standalone-Assessment
 *     (kategorie-relativ, aiAssessment).
 *   • NoName MIT Link, aber Marke ohne Daten → Standalone-Assessment
 *     des NoName (statt skippen). Sobald die Marke Daten bekommt, springt
 *     der echte Vergleich an und überschreibt das Assessment.
 *   • NoName selbst ohne Daten           → skipped (UI rendert nichts).
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
const {
  MANUFACTURER_PROMPT_VERSION,
  snapshotFromHersteller,
  isEvaluable: isHerstellerEvaluable,
  callGeminiManufacturer,
} = require('./src/manufacturer');
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

// ─── Debounce (Trailing) ─────────────────────────────────────────────
// Trigger laufen NICHT mehr sofort, sondern setzen nur ein Dirty-Flag
// (`aiComparisonDirtyAt` = Zeitpunkt der letzten relevanten Änderung).
// Der processPendingComparisons-Sweeper verarbeitet ein Produkt erst,
// wenn dessen letzte Änderung ≥ DEBOUNCE_MS her ist — also wenn ein
// Editier-/Pflege-Vorgang abgeschlossen ist und sich nichts mehr tut.
// User-Vorgabe 2026-05-29: "nicht sofort anspringen, lieber 1h später
// wenn alle felder gepflegt sind."
const DIRTY_FIELD = 'aiComparisonDirtyAt';
const DEBOUNCE_MS = 60 * 60 * 1000; // 1 Stunde

/**
 * Markiert ein produkte-Doc als "neu zu bewerten" (Dirty-Flag = jetzt).
 * Jede relevante Änderung bumpt den Zeitstempel → der Sweeper wartet,
 * bis 1h lang KEINE Änderung mehr kam (trailing debounce).
 *
 * Hinweis: Das Schreiben des Flags triggert onProduktUpdate erneut, aber
 * DIRTY_FIELD ist NICHT in RELEVANT_PRODUKTE_FIELDS → der Re-Trigger
 * bricht sofort ab (kein Loop, kein Gemini-Call).
 */
async function markDirty(db, produktId) {
  await db
    .collection('produkte')
    .doc(produktId)
    .set(
      { [DIRTY_FIELD]: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
}

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

  const nonameHasData = isSnapshotComparable(nonameSnap);
  const originalHasData = isSnapshotComparable(originalSnap);

  // Fall 1: NoName selbst hat KEINE Daten → es gibt nichts zu bewerten
  // (egal ob die Marke Daten hat). UI rendert nichts.
  if (!nonameHasData) {
    await produktRef.set(
      {
        aiComparison: {
          skipped: 'incomparable',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          promptVersion: PROMPT_VERSION,
        },
        // Falls vorher eine Standalone-Bewertung existierte: weg damit.
        aiAssessment: admin.firestore.FieldValue.delete(),
      },
      { merge: true },
    );
    return { state: 'incomparable' };
  }

  // Fall 2: NoName HAT Daten, aber die MARKE (noch) nicht → kein echter
  // Vergleich möglich. Statt zu skippen bewerten wir das NoName standalone
  // (kategorie-relativ), damit es wenigstens eine KI-Aussage gibt. Sobald
  // die Marke später Nährwerte/Zutaten gepflegt bekommt, springt der
  // Vergleich automatisch wieder an (onMarkenProduktUpdate → Dirty-Flag →
  // Sweeper) und überschreibt die Standalone-Bewertung sauber.
  // (User-Vorgabe 2026-05-29.)
  if (!originalHasData) {
    return await runAssessment(db, produktId, opts);
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
      // Ein echter Vergleich gewinnt — eine evtl. vorhandene Standalone-
      // Bewertung wird entfernt, damit die UI nie beide gleichzeitig sieht.
      aiAssessment: admin.firestore.FieldValue.delete(),
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
      // Es gibt aktuell keinen echten Vergleich (kein Link oder Marke ohne
      // Daten) → eine evtl. veraltete Vergleichs-Bewertung entfernen, damit
      // die UI die Standalone-Bewertung zeigt und nicht beide.
      aiComparison: admin.firestore.FieldValue.delete(),
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
      // Nicht sofort bewerten — neu angelegte Produkte bekommen ihre
      // Felder meist erst kurz nach dem Create gepflegt. Dirty-Flag setzen,
      // der Sweeper bewertet 1h nach der letzten Änderung.
      await markDirty(db, produktId);
      console.log(`[ai-comparison][onCreate] ${produktId} → dirty`);
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
      // Häufiger Fall: image-Update, stufe-Update, das Dirty-Flag selbst,
      // etc. → skip. Wichtig damit wir nicht in Kosten ertrinken UND damit
      // das Setzen des Dirty-Flags keinen Re-Trigger-Loop erzeugt.
      return;
    }
    const db = admin.firestore();
    try {
      // Debounce: nur Dirty-Flag bumpen. Der Sweeper bewertet 1h nach der
      // letzten relevanten Änderung — so läuft die KI nicht 5× während ein
      // Admin/Scraper mehrere Felder nacheinander pflegt.
      await markDirty(db, produktId);
      console.log(`[ai-comparison][onUpdate] ${produktId} → dirty`);
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
      `[ai-comparison][onMpUpdate] mp=${mpId} touched, ${linkedSnap.size} linked NoNames → dirty`,
    );
    // Debounce: alle verknüpften NoNames als dirty markieren statt sofort
    // zu bewerten. Wenn die Marke gerade erst Nährwerte/Zutaten gepflegt
    // bekommt (typisch: mehrere Felder nacheinander), wartet der Sweeper
    // bis sich 1h nichts mehr tut und rechnet DANN den Vergleich sauber neu.
    for (const doc of linkedSnap.docs) {
      try {
        await markDirty(db, doc.id);
      } catch (e) {
        console.error(`[ai-comparison][onMpUpdate] noname=${doc.id} mark failed:`, e?.message);
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

// ════════════════════════════════════════════════════════════════════
// SCHEDULED Backfill — selbst-fortsetzend, Cursor-basiert
// ════════════════════════════════════════════════════════════════════
//
// Ersetzt den fragilen Bash-HTTP-Loop. Läuft alle paar Minuten,
// arbeitet einen Batch produkte ab und merkt sich die Cursor-Position
// in einem State-Doc. Überlebt Unterbrechungen (Session-Kill etc.) —
// macht beim nächsten Tick einfach weiter wo er aufgehört hat.
//
// State-Doc: aggregates/aiComparisonBackfill
//   { cursor: lastDocId|null, promptVersion, completedAt, processed,
//     updatedAt }
//
// Logik pro Tick:
//   • Wenn promptVersion != aktuell  → Reset (Cursor=null, neu scannen),
//     promptVersion setzen. So triggert ein Prompt-Bump automatisch
//     ein komplettes Re-Backfill.
//   • Wenn completedAt gesetzt + promptVersion aktuell → fertig, no-op.
//   • Sonst: nächsten Batch ab Cursor verarbeiten, Cursor speichern.
//   • Batch < limit → Ende erreicht → completedAt setzen.

const BACKFILL_STATE_PATH = 'aggregates/aiComparisonBackfill';
// Parallelisiert (Pool 8) → großer Batch passt locker in 540s.
// 600 / 8 × ~1.5s ≈ 110s. Bei ~7300 Produkten → ~1h für den Komplett-Pass.
const BACKFILL_BATCH = 600;
const BACKFILL_CONCURRENCY = 8;

exports.scheduledComparisonBackfill = functions.scheduler.onSchedule(
  {
    ...COMMON_OPTS,
    schedule: 'every 5 minutes',
  },
  async () => {
    const db = admin.firestore();
    const stateRef = db.doc(BACKFILL_STATE_PATH);
    const stateSnap = await stateRef.get();
    const state = stateSnap.exists ? stateSnap.data() : {};

    // Prompt-Version-Wechsel → kompletter Reset
    if (state.promptVersion !== PROMPT_VERSION) {
      console.log(
        `[scheduled-backfill] promptVersion ${state.promptVersion} → ${PROMPT_VERSION}, reset cursor`,
      );
      await stateRef.set(
        {
          promptVersion: PROMPT_VERSION,
          cursor: null,
          completedAt: null,
          processed: 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return; // nächster Tick startet den Scan
    }

    // Schon fertig für diese Version → no-op
    if (state.completedAt) {
      return;
    }

    // Nächsten Batch holen
    let q = db
      .collection('produkte')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(BACKFILL_BATCH);
    if (state.cursor) q = q.startAfter(state.cursor);

    const snap = await q.get();
    if (snap.empty) {
      console.log('[scheduled-backfill] keine weiteren Docs → completed');
      await stateRef.set(
        { completedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
      return;
    }

    const lastDocId = snap.docs[snap.docs.length - 1].id;
    // Nur Docs die noch NICHT aktuell sind (Trigger könnte zwischendurch
    // schon welche erledigt haben) — parallel abarbeiten.
    const toProcess = snap.docs.filter((doc) => {
      const ai = doc.data()?.aiComparison;
      return !(
        ai?.promptVersion === PROMPT_VERSION &&
        (typeof ai.score === 'number' || ai.skipped)
      );
    });
    const processed = await runPool(toProcess, BACKFILL_CONCURRENCY, async (doc) => {
      try {
        await runComparison(db, doc.id);
      } catch (e) {
        console.error(`[scheduled-backfill] ${doc.id} failed:`, e?.message);
        throw e;
      }
    });

    const reachedEnd = snap.size < BACKFILL_BATCH;
    await stateRef.set(
      {
        cursor: lastDocId,
        processed: (state.processed || 0) + processed,
        completedAt: reachedEnd
          ? admin.firestore.FieldValue.serverTimestamp()
          : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(
      `[scheduled-backfill] batch done: ${processed} processed, cursor=${lastDocId}, reachedEnd=${reachedEnd}`,
    );
  },
);

// ════════════════════════════════════════════════════════════════════
// SCHEDULED — processPendingComparisons (Debounce-Sweeper)
// ════════════════════════════════════════════════════════════════════
//
// Verarbeitet alle produkte deren Dirty-Flag (aiComparisonDirtyAt) ≥
// DEBOUNCE_MS (1h) alt ist — also wo seit der letzten relevanten Änderung
// genug Zeit vergangen ist, dass die Pflege abgeschlossen sein dürfte.
//
// Läuft alle 15 Min. Pro Tick ein begrenzter Batch (Cost-Cap). Produkte
// die noch "frisch" geändert wurden (Flag < 1h) werden NICHT angefasst —
// trailing debounce. Das Flag wird nach erfolgreicher Verarbeitung
// transaktional entfernt, aber nur wenn es sich seitdem NICHT geändert
// hat (sonst würde eine Änderung während des Gemini-Calls verschluckt).

const PENDING_BATCH = 25;

exports.processPendingComparisons = functions.scheduler.onSchedule(
  {
    ...COMMON_OPTS,
    schedule: 'every 15 minutes',
  },
  async () => {
    const db = admin.firestore();
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - DEBOUNCE_MS);

    let snap;
    try {
      snap = await db
        .collection('produkte')
        .where(DIRTY_FIELD, '<=', cutoff)
        .orderBy(DIRTY_FIELD)
        .limit(PENDING_BATCH)
        .get();
    } catch (e) {
      // Häufigster Fehler: fehlender Single-Field-Index. Wird beim ersten
      // Deploy automatisch angelegt; bis dahin loggen + sauber abbrechen.
      console.error('[pending-sweeper] query failed:', e?.message);
      return;
    }

    if (snap.empty) {
      console.log('[pending-sweeper] nichts fällig');
      return;
    }

    let processed = 0;
    let cleared = 0;
    for (const doc of snap.docs) {
      const produktId = doc.id;
      const seenDirtyAt = doc.get(DIRTY_FIELD); // Timestamp den wir verarbeiten
      try {
        const res = await runComparison(db, produktId);
        processed += 1;
        console.log(`[pending-sweeper] ${produktId} → ${res.state} ${res.detail || ''}`);
      } catch (e) {
        console.error(`[pending-sweeper] ${produktId} runComparison failed:`, e?.message);
        // Flag NICHT löschen → nächster Tick versucht es erneut.
        continue;
      }

      // Flag nur entfernen wenn sich seit dem Lesen nichts geändert hat.
      // Sonst kam während des Gemini-Calls eine neue Änderung rein und
      // wir würden ihr Signal verschlucken.
      try {
        await db.runTransaction(async (tx) => {
          const ref = db.collection('produkte').doc(produktId);
          const fresh = await tx.get(ref);
          const cur = fresh.get(DIRTY_FIELD);
          const unchanged =
            cur && seenDirtyAt && typeof cur.isEqual === 'function'
              ? cur.isEqual(seenDirtyAt)
              : cur === seenDirtyAt;
          if (unchanged) {
            tx.update(ref, { [DIRTY_FIELD]: admin.firestore.FieldValue.delete() });
          }
        });
        cleared += 1;
      } catch (e) {
        console.warn(`[pending-sweeper] ${produktId} clear-flag failed:`, e?.message);
      }

      await sleep(200); // ~5 RPS Throttle gegen Gemini
    }

    console.log(
      `[pending-sweeper] batch done: ${processed} verarbeitet, ${cleared} Flags entfernt, ${snap.size} fällig`,
    );
  },
);

// ════════════════════════════════════════════════════════════════════
// HERSTELLER-BEWERTUNG — KI-Einschätzung pro Hersteller (kein Score)
// ════════════════════════════════════════════════════════════════════
//
// Pro hersteller/{id} EINMAL berechnet (nicht pro Produkt). Liefert eine
// neutrale Herkunfts-/Einordnungs-Aussage + ggf. vorsichtige bekannte
// Kontroverse aus Modell-Wissen. Ergebnis → hersteller/{id}.aiHersteller.
// Die App liest es über die hersteller-Reference, die eh geladen wird.
//
// Hash-Check über die Stammdaten (name/legalName/land/stadt) + promptVer.

async function runManufacturer(db, herstellerId, opts = {}) {
  const { force = false, apiKey, collection = 'hersteller' } = opts;
  const ref = db.collection(collection).doc(herstellerId);
  const snapDoc = await ref.get();
  if (!snapDoc.exists) return { state: 'not-found' };
  const data = snapDoc.data() || {};
  const snap = snapshotFromHersteller(data);

  if (!isHerstellerEvaluable(snap)) {
    await ref.set(
      {
        aiHersteller: {
          skipped: 'no-name',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          promptVersion: MANUFACTURER_PROMPT_VERSION,
        },
      },
      { merge: true },
    );
    return { state: 'hersteller-skipped' };
  }

  const hashKey = JSON.stringify([
    String(snap.name || '').toLowerCase(),
    String(snap.legalName || '').toLowerCase(),
    String(snap.land || '').toLowerCase(),
    String(snap.stadt || '').toLowerCase(),
  ]);
  const hash = require('crypto').createHash('sha256').update(hashKey).digest('hex').slice(0, 16);
  const prev = data.aiHersteller;
  if (
    !force &&
    prev?.inputHash === hash &&
    prev?.promptVersion === MANUFACTURER_PROMPT_VERSION &&
    typeof prev?.summary === 'string'
  ) {
    return { state: 'hersteller-skipped-nochange' };
  }

  let result;
  try {
    result = await callGeminiManufacturer({
      apiKey: apiKey || GEMINI_API_KEY.value(),
      snapshot: snap,
    });
  } catch (e) {
    console.error(`[ai-hersteller] Gemini failed für ${herstellerId}:`, e.message);
    await ref.set(
      {
        aiHersteller: {
          lastError: String(e.message || e).slice(0, 200),
          lastErrorAt: admin.firestore.FieldValue.serverTimestamp(),
          promptVersion: MANUFACTURER_PROMPT_VERSION,
        },
      },
      { merge: true },
    );
    return { state: 'hersteller-gemini-failed', detail: e.message };
  }

  await ref.set(
    {
      aiHersteller: {
        herkunft: result.herkunft,
        summary: result.summary,
        model: result.model,
        promptVersion: result.promptVersion,
        inputHash: hash,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastError: admin.firestore.FieldValue.delete(),
        lastErrorAt: admin.firestore.FieldValue.delete(),
        skipped: admin.firestore.FieldValue.delete(),
      },
    },
    { merge: true },
  );

  return { state: 'hersteller-updated', detail: result.herkunft };
}

// Trigger: neuer Hersteller → sofort bewerten (geringes Volumen, ~968 total).
exports.onHerstellerCreateForRating = onDocumentCreated(
  { ...COMMON_OPTS, document: 'hersteller/{herstellerId}' },
  async (event) => {
    const id = event.params.herstellerId;
    try {
      const res = await runManufacturer(admin.firestore(), id);
      console.log(`[ai-hersteller][onCreate] ${id} → ${res.state} ${res.detail || ''}`);
    } catch (e) {
      console.error(`[ai-hersteller][onCreate] ${id} unexpected:`, e?.message);
    }
  },
);

// Trigger: Hersteller-Stammdaten geändert → neu bewerten (nur bei
// relevanten Feldern; aiHersteller selbst ist NICHT relevant → kein Loop).
const RELEVANT_HERSTELLER_FIELDS = ['name', 'herstellername', 'land', 'stadt'];
exports.onHerstellerUpdateForRating = onDocumentUpdated(
  { ...COMMON_OPTS, document: 'hersteller/{herstellerId}' },
  async (event) => {
    const id = event.params.herstellerId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!relevantFieldsChanged(before, after, RELEVANT_HERSTELLER_FIELDS)) return;
    try {
      const res = await runManufacturer(admin.firestore(), id);
      console.log(`[ai-hersteller][onUpdate] ${id} → ${res.state} ${res.detail || ''}`);
    } catch (e) {
      console.error(`[ai-hersteller][onUpdate] ${id} unexpected:`, e?.message);
    }
  },
);

// HTTPS — runManufacturerForHersteller (admin/debug, sofort + force)
exports.runManufacturerForHersteller = onRequest(
  { ...COMMON_OPTS, secrets: [GEMINI_API_KEY, TRIGGER_KEY] },
  async (req, res) => {
    const triggerKey = TRIGGER_KEY.value();
    const provided = req.query?.key || req.body?.key;
    if (!triggerKey || provided !== triggerKey) {
      res.status(401).send('Unauthorized');
      return;
    }
    const herstellerId = String(req.query?.herstellerId || req.body?.herstellerId || '').trim();
    if (!herstellerId) {
      res.status(400).send('Missing herstellerId');
      return;
    }
    const force = String(req.query?.force || req.body?.force || '') === '1';
    // collection: 'hersteller' (Marken) oder 'hersteller_new' (echte Hersteller).
    let collection = String(req.query?.collection || req.body?.collection || 'hersteller_new').trim();
    if (collection !== 'hersteller' && collection !== 'hersteller_new') collection = 'hersteller_new';
    try {
      const result = await runManufacturer(admin.firestore(), herstellerId, { force, collection });
      res.status(200).json({ herstellerId, ...result });
    } catch (e) {
      res.status(500).send(String(e?.message || e));
    }
  },
);

// SCHEDULED — Hersteller-Backfill (cursor-basiert, wie Comparison-Backfill).
// Reset bei promptVersion-Bump → komplettes Re-Backfill aller Hersteller.
const HERSTELLER_BACKFILL_STATE_PATH = 'aggregates/aiHerstellerBackfill';
// Parallelisiert (Pool 8): ~968 Hersteller in 1-2 Ticks durch.
const HERSTELLER_BACKFILL_BATCH = 400;
const HERSTELLER_BACKFILL_CONCURRENCY = 8;

exports.scheduledManufacturerBackfill = functions.scheduler.onSchedule(
  { ...COMMON_OPTS, schedule: 'every 5 minutes' },
  async () => {
    const db = admin.firestore();
    const stateRef = db.doc(HERSTELLER_BACKFILL_STATE_PATH);
    const stateSnap = await stateRef.get();
    const state = stateSnap.exists ? stateSnap.data() : {};

    if (state.promptVersion !== MANUFACTURER_PROMPT_VERSION) {
      console.log(
        `[hersteller-backfill] promptVersion ${state.promptVersion} → ${MANUFACTURER_PROMPT_VERSION}, reset`,
      );
      await stateRef.set(
        {
          promptVersion: MANUFACTURER_PROMPT_VERSION,
          cursor: null,
          completedAt: null,
          processed: 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }
    if (state.completedAt) return;

    let q = db
      .collection('hersteller')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(HERSTELLER_BACKFILL_BATCH);
    if (state.cursor) q = q.startAfter(state.cursor);

    const snap = await q.get();
    if (snap.empty) {
      await stateRef.set(
        { completedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
      console.log('[hersteller-backfill] keine weiteren Docs → completed');
      return;
    }

    const lastDocId = snap.docs[snap.docs.length - 1].id;
    const toProcess = snap.docs.filter((doc) => {
      const ai = doc.data()?.aiHersteller;
      return !(
        ai?.promptVersion === MANUFACTURER_PROMPT_VERSION &&
        (typeof ai.summary === 'string' || ai.skipped)
      );
    });
    const processed = await runPool(toProcess, HERSTELLER_BACKFILL_CONCURRENCY, async (doc) => {
      try {
        await runManufacturer(db, doc.id);
      } catch (e) {
        console.error(`[hersteller-backfill] ${doc.id} failed:`, e?.message);
        throw e;
      }
    });

    const reachedEnd = snap.size < HERSTELLER_BACKFILL_BATCH;
    await stateRef.set(
      {
        cursor: lastDocId,
        processed: (state.processed || 0) + processed,
        completedAt: reachedEnd ? admin.firestore.FieldValue.serverTimestamp() : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(
      `[hersteller-backfill] batch: ${processed} verarbeitet, cursor=${lastDocId}, reachedEnd=${reachedEnd}`,
    );
  },
);

// ════════════════════════════════════════════════════════════════════
// HERSTELLER_NEW — die ECHTEN Hersteller (collection `hersteller_new`)
// ════════════════════════════════════════════════════════════════════
//
// WICHTIG: `produkte.hersteller` zeigt auf `hersteller_new` — DAS ist die
// Quelle für die Hersteller-Karte auf der Produktdetail-/Vergleichsseite.
// (Die collection `hersteller` enthält Marken und wird separat bewertet.)
// Gleiche Logik wie oben, nur andere collection + eigenes State-Doc.

const HERSTELLERNEW_BACKFILL_STATE_PATH = 'aggregates/aiHerstellerNewBackfill';

exports.onHerstellerNewCreateForRating = onDocumentCreated(
  { ...COMMON_OPTS, document: 'hersteller_new/{herstellerId}' },
  async (event) => {
    const id = event.params.herstellerId;
    try {
      const res = await runManufacturer(admin.firestore(), id, { collection: 'hersteller_new' });
      console.log(`[ai-herstellerNew][onCreate] ${id} → ${res.state} ${res.detail || ''}`);
    } catch (e) {
      console.error(`[ai-herstellerNew][onCreate] ${id} unexpected:`, e?.message);
    }
  },
);

exports.onHerstellerNewUpdateForRating = onDocumentUpdated(
  { ...COMMON_OPTS, document: 'hersteller_new/{herstellerId}' },
  async (event) => {
    const id = event.params.herstellerId;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!relevantFieldsChanged(before, after, RELEVANT_HERSTELLER_FIELDS)) return;
    try {
      const res = await runManufacturer(admin.firestore(), id, { collection: 'hersteller_new' });
      console.log(`[ai-herstellerNew][onUpdate] ${id} → ${res.state} ${res.detail || ''}`);
    } catch (e) {
      console.error(`[ai-herstellerNew][onUpdate] ${id} unexpected:`, e?.message);
    }
  },
);

exports.scheduledHerstellerNewBackfill = functions.scheduler.onSchedule(
  { ...COMMON_OPTS, schedule: 'every 5 minutes' },
  async () => {
    const db = admin.firestore();
    const stateRef = db.doc(HERSTELLERNEW_BACKFILL_STATE_PATH);
    const stateSnap = await stateRef.get();
    const state = stateSnap.exists ? stateSnap.data() : {};

    if (state.promptVersion !== MANUFACTURER_PROMPT_VERSION) {
      await stateRef.set(
        {
          promptVersion: MANUFACTURER_PROMPT_VERSION,
          cursor: null,
          completedAt: null,
          processed: 0,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }
    if (state.completedAt) return;

    let q = db
      .collection('hersteller_new')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(HERSTELLER_BACKFILL_BATCH);
    if (state.cursor) q = q.startAfter(state.cursor);

    const snap = await q.get();
    if (snap.empty) {
      await stateRef.set(
        { completedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
      console.log('[herstellerNew-backfill] keine weiteren Docs → completed');
      return;
    }

    const lastDocId = snap.docs[snap.docs.length - 1].id;
    const toProcess = snap.docs.filter((doc) => {
      const ai = doc.data()?.aiHersteller;
      return !(
        ai?.promptVersion === MANUFACTURER_PROMPT_VERSION &&
        (typeof ai.summary === 'string' || ai.skipped)
      );
    });
    const processed = await runPool(toProcess, HERSTELLER_BACKFILL_CONCURRENCY, async (doc) => {
      try {
        await runManufacturer(db, doc.id, { collection: 'hersteller_new' });
      } catch (e) {
        console.error(`[herstellerNew-backfill] ${doc.id} failed:`, e?.message);
        throw e;
      }
    });

    const reachedEnd = snap.size < HERSTELLER_BACKFILL_BATCH;
    await stateRef.set(
      {
        cursor: lastDocId,
        processed: (state.processed || 0) + processed,
        completedAt: reachedEnd ? admin.firestore.FieldValue.serverTimestamp() : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(
      `[herstellerNew-backfill] batch: ${processed} verarbeitet, cursor=${lastDocId}, reachedEnd=${reachedEnd}`,
    );
  },
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Einfacher Concurrency-Pool: arbeitet `items` mit max `concurrency`
 * gleichzeitig laufenden `worker`-Calls ab. Ersetzt das sequenzielle
 * for+sleep im Backfill → deutlich schneller, ohne Gemini-Rate-Limits zu
 * reissen (8 parallele Flash-Calls ≈ moderate RPM). Worker-Fehler werden
 * vom Worker selbst geloggt; hier nur gezählt.
 */
async function runPool(items, concurrency, worker) {
  let idx = 0;
  let done = 0;
  const runner = async () => {
    while (idx < items.length) {
      const cur = idx++;
      try {
        await worker(items[cur]);
        done += 1;
      } catch (e) {
        // worker loggt Details
      }
    }
  };
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, runner));
  return done;
}
