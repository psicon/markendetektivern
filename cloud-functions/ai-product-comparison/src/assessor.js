/**
 * assessor.js — Standalone-Bewertung EINES Produkts (NICHT Vergleich).
 *
 * Anders als comparator.js (NoName vs. Markenprodukt) liefert dieser
 * Modul eine generelle KI-Einschätzung zu Nährwerten + Zutaten EINES
 * Produkts im Hinblick auf seine Produkt-Kategorie.
 *
 * Use-Case: NoName-Produkte ohne Markenprodukt-Link (Stufe 1/2) — auch
 * dort wollen wir eine KI-Aussage zur Produktqualität zeigen, nur eben
 * nicht als Vergleich sondern als Einzelbewertung.
 *
 * Output:
 *   {
 *     healthScore: 1..5,    // 1 = wenig empfehlenswert / 5 = sehr empfehlenswert
 *     reasoning: string,    // 1-2 Sätze DE, fakten-basiert
 *   }
 *
 * KRITISCH: Bewertung ist KATEGORIE-RELATIV. Eine "1" für Chips heißt
 * NICHT dass das eine gesunde Wahl ist — sondern dass es selbst unter
 * den Chips eher ungesund ist. Eine "5" für Chips heißt: relativ
 * gesehen eine bessere Chips-Wahl (z.B. weniger Fett, kein Aroma).
 *
 * Modell + Konfig identisch zum Comparator (Gemini 2.5 Flash,
 * thinkingBudget=0, niedrige Temperature).
 */

const { GoogleGenAI, Type } = require('@google/genai');

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

const ASSESSMENT_PROMPT_VERSION = 'v5';

const SYSTEM_INSTRUCTION = `Du bist Ernährungs-Analyst für die deutsche App "MarkenDetektive".

WICHTIG: Antwort MUSS ein einzelnes JSON-Objekt sein und NUR das.
Kein "Here is the JSON", kein Markdown, keine Code-Fences. Nur:
{"healthScore": <number>, "reasoning": "<text>"}

Bewerte das gegebene Produkt anhand seiner Nährwerte + Zutaten —
KATEGORIE-RELATIV. Eine Tafel Schokolade soll mit anderen Schokoladen
verglichen werden, nicht mit Salat. Eine Tüte Chips mit anderen Chips.

═══════════════════════════════════════════════════════════════════
SKALA — wohlwollend gegenüber dem Produkt (User-Vorgabe):
═══════════════════════════════════════════════════════════════════

  1 = klar UNGESUND für die Kategorie
      Nur wenn MEHRERE Negativ-Signale gleichzeitig auftreten
      (sehr lange Zutatenliste UND viele E-Stoffe UND deutlich höhere
       Werte bei Zucker/Salz/Fett als kategorie-typisch).
  2 = unterhalb des Durchschnitts (klarer Einzel-Nachteil)
  3 = DURCHSCHNITT der Kategorie / Standard-Rezeptur
  4 = oberhalb des Durchschnitts ← niedrige Schwelle!
      Sobald EIN klarer Positiv-Aspekt erkennbar ist (Bio, weniger
      Zucker als üblich, kurze klare Zutatenliste, ohne Aromen, etc.)
      → score 4. Nicht 3.
  5 = sehr gute Wahl in der Kategorie (Bio UND kurze klare
      Zutatenliste UND ausgewogene Nährwerte)

═══════════════════════════════════════════════════════════════════
MISSING DATA — KRITISCH:
═══════════════════════════════════════════════════════════════════

Wenn ein Nährwert nicht angegeben ist, bedeutet das "nicht deklariert",
NICHT "Null". Bewerte anhand der Werte die DA sind. Erwähne fehlende
Daten NICHT.

═══════════════════════════════════════════════════════════════════
ABSOLUT VERBOTEN in reasoning:
═══════════════════════════════════════════════════════════════════

  • "Daten fehlen" / "Angaben fehlen" / "fehlende Werte"
  • "kann ich nicht bewerten" / "ohne genauere Angaben"
  • "leider" / "unklar" / "ohne weiteres" / "vermutlich" / "scheinbar"
  • "deutet auf" / "hindeutet"
  • Meta-Aussagen über die Datenlage
  • Diskussion ob die Kategorie selbst gesund ist (Schokolade darf
    nicht abgewertet werden weil "Süßes ist ungesund")

═══════════════════════════════════════════════════════════════════
OUTPUT:
═══════════════════════════════════════════════════════════════════

reasoning: 1-2 kurze Sätze auf Deutsch, max ~220 Zeichen.
KEINE Marketing-Sprache, keine Adjektive wie "super/toll". Reine Fakten.

Gute Beispiele:
  "Mit 12g Zucker auf 100g unterhalb des Schokoladen-Durchschnitts,
   kurze Zutatenliste ohne künstliche Aromen." → score 4
  "Klassische Rezeptur mit standardtypischen Nährwerten für die
   Kategorie." → score 3
  "Lange Zutatenliste mit mehreren E-Stoffen und Aromen, deutlich
   mehr Zucker als kategorie-üblich." → score 2`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ['healthScore', 'reasoning'],
  properties: {
    healthScore: { type: Type.INTEGER, minimum: 1, maximum: 5 },
    reasoning: { type: Type.STRING, maxLength: 260 },
  },
};

function buildUserContent({ product, category }) {
  // Wie comparator.formatProduct: fehlende Werte komplett weglassen,
  // keine "nicht verfügbar"-Marker — das Modell soll nicht über
  // Datenqualität spekulieren.
  const lines = [];
  if (product.name) lines.push(`Produkt: ${product.name}`);
  if (category) lines.push(`Kategorie: ${category}`);
  if (product.hersteller) lines.push(`Hersteller: ${product.hersteller}`);

  const n = [];
  if (typeof product.energy === 'number') n.push(`Energie ${product.energy} kcal`);
  if (typeof product.fat === 'number') n.push(`Fett ${product.fat}g`);
  if (typeof product.satFat === 'number') n.push(`davon gesättigt ${product.satFat}g`);
  if (typeof product.carbs === 'number') n.push(`Kohlenhydrate ${product.carbs}g`);
  if (typeof product.sugar === 'number') n.push(`davon Zucker ${product.sugar}g`);
  if (typeof product.fiber === 'number') n.push(`Ballaststoffe ${product.fiber}g`);
  if (typeof product.protein === 'number') n.push(`Eiweiß ${product.protein}g`);
  if (typeof product.salt === 'number') n.push(`Salz ${product.salt}g`);
  if (n.length > 0) lines.push(`Nährwerte (pro 100g): ${n.join(', ')}`);

  if (product.ingredients) {
    lines.push(`Zutaten: ${String(product.ingredients).slice(0, 600).trim()}`);
  }

  lines.push('');
  lines.push('Aufgabe: kategorie-relative Bewertung. Regel zur Erinnerung:');
  lines.push('niedrige Schwelle für score 4 (ein klarer Positiv-Aspekt reicht),');
  lines.push('fehlende Werte ignorieren, NIEMALS Datenlage thematisieren.');
  lines.push('Antworte als JSON gemäß Schema.');
  return lines.join('\n');
}

function snapshotFromDoc(data) {
  if (!data) return null;
  // Energie kJ → kcal Konvertierung (siehe comparator.js)
  let energyKcal = numOrNull(data.nutr_Energie_val);
  const energyUnit = typeof data.nutr_Energie_unit === 'string'
    ? data.nutr_Energie_unit.toLowerCase()
    : null;
  if (energyKcal != null && energyUnit === 'kj') {
    energyKcal = Math.round(energyKcal / 4.184);
  }
  const labels = {
    nutriscore: typeof data.nutriscore === 'string' ? data.nutriscore.toLowerCase() : null,
    ecoscore: typeof data.ecoscore === 'string' ? data.ecoscore.toLowerCase() : null,
    nova: typeof data.nova === 'string' || typeof data.nova === 'number' ? String(data.nova) : null,
    isVegan: typeof data.attr_isVegan === 'boolean' ? data.attr_isVegan
             : typeof data.isVegan === 'boolean' ? data.isVegan : null,
    isVegetarisch: typeof data.attr_isVegetarisch === 'boolean' ? data.attr_isVegetarisch
                   : typeof data.isVegetarian === 'boolean' ? data.isVegetarian : null,
    isBio: typeof data.attr_isBio === 'boolean' ? data.attr_isBio
           : typeof data.isBio === 'boolean' ? data.isBio : null,
  };
  return {
    name: data.name || data.productName || data.bezeichnung || null,
    hersteller:
      data.herstellerName || data.producerName || null,
    energy: energyKcal,
    fat: numOrNull(data.nutr_Fett_val),
    satFat: numOrNull(data.nutr_FettdavongesttigteFettsuren_val),
    carbs: numOrNull(data.nutr_Kohlenhydrate_val),
    sugar: numOrNull(data.nutr_KohlenhydratedavonZucker_val),
    fiber: numOrNull(data.nutr_Ballaststoffe_val),
    protein: numOrNull(data.nutr_Eiwei_val),
    salt: numOrNull(data.nutr_Salz_val),
    ingredients: data.attr_ingredientStatement || data.zutaten || null,
    labels,
  };
}

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function isAssessable(s) {
  if (!s) return false;
  // Wie bei Comparator: Name allein reicht NICHT. Ohne Nährwerte/
  // Zutaten gibt es nichts zu bewerten — UI rendert dann nichts
  // statt sinnloser Meta-Texte ("Daten fehlen…").
  const hasNutrition =
    s.energy != null ||
    s.fat != null ||
    s.carbs != null ||
    s.sugar != null ||
    s.protein != null ||
    s.salt != null;
  const hasIngredients =
    typeof s.ingredients === 'string' && s.ingredients.trim().length > 5;
  return hasNutrition || hasIngredients;
}

async function callGeminiAssessment({ apiKey, snapshot, category, model = DEFAULT_MODEL }) {
  const ai = new GoogleGenAI({ apiKey });
  const userContent = buildUserContent({ product: snapshot, category });

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 1024,
    },
  });

  let rawText = null;
  try {
    rawText = response?.text;
  } catch {
    rawText = null;
  }
  if (!rawText) {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      rawText = parts.map((p) => p?.text || '').filter(Boolean).join('');
    }
  }
  if (!rawText || rawText.trim().length === 0) {
    throw new Error('Gemini (assessment) returned no text');
  }

  const parsed = parseLooseJson(rawText);
  const healthScore = Math.round(Number(parsed.healthScore));
  if (!Number.isFinite(healthScore) || healthScore < 1 || healthScore > 5) {
    throw new Error(`Gemini assessment healthScore invalid: ${parsed.healthScore}`);
  }
  let reasoning = String(parsed.reasoning || '').trim();
  if (reasoning.length === 0) {
    throw new Error('Gemini assessment returned empty reasoning');
  }
  if (reasoning.length > 220) reasoning = reasoning.slice(0, 217) + '…';

  return {
    healthScore,
    reasoning,
    model,
    promptVersion: ASSESSMENT_PROMPT_VERSION,
  };
}

function parseLooseJson(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  s = s.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(
      `Gemini assessment JSON parse failed: ${e.message} — raw: ${String(raw).slice(0, 200)}`,
    );
  }
}

module.exports = {
  ASSESSMENT_PROMPT_VERSION,
  snapshotFromDoc,
  isAssessable,
  callGeminiAssessment,
};
