/**
 * comparator.js — Gemini-Call für NoName-vs-Markenprodukt-Bewertung.
 *
 * Input: zwei normalisierte Produkt-Snapshots (Nährwerte + Zutaten).
 * Output:
 *   {
 *     score: 1..5,          // 1 = NoName deutlich schlechter (rot)
 *                           // 5 = NoName deutlich besser (grün)
 *     reasoning: string,    // 1-2 Sätze, max ~220 Zeichen, DE
 *   }
 *
 * Modell: per Default `gemini-2.5-flash` (text variant — bereits im
 * Projekt eingesetzt, billig + schnell). Per ENV-Var GEMINI_MODEL
 * überschreibbar, z.B. auf `gemini-3-flash` wenn das verfügbar ist.
 *
 * Cost-Profil:
 *   Pro Comparison ~600 input + ~150 output tokens.
 *   Bei Gemini 2.5 Flash: ~$0.000075/input/1k + $0.0003/output/1k.
 *   Pro Call: ca. $0.0001 (0.01 ¢).
 *   50k Produkte initial: ~$5 für komplettes Backfill.
 */

const { GoogleGenAI, Type } = require('@google/genai');

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// Prompt-Version: hash auf doc speichern damit wir bei Prompt-Update
// alte Comparisons automatisch invalidieren können (Backfill rechnet
// alles mit version-Unterschied neu).
// v2 = robusteres JSON-Parsing + verschärfter Prompt gegen Markdown-Wrap
const PROMPT_VERSION = 'v2';

const SYSTEM_INSTRUCTION = `Du bist Ernährungs-Analyst für die deutsche App "MarkenDetektive".

WICHTIG: Antwort MUSS ein einzelnes JSON-Objekt sein und NUR das.
Kein "Here is the JSON", kein Markdown, keine Code-Fences. Nur:
{"score": <number>, "reasoning": "<text>"}

Vergleiche ein NoName-Produkt (Discounter-Eigenmarke) mit dem
entsprechenden Original-Markenprodukt. Bewertung aus Verbraucher-Sicht:
gesundheitlicher Wert + Zutaten-Qualität.

Skala (genau eine Ganzzahl):
  1 = NoName ist DEUTLICH SCHLECHTER (klar mehr ungesunde Inhalte,
      viel länger Zutatenliste mit Zusatzstoffen)
  2 = NoName ist etwas schlechter
  3 = ungefähr GLEICHWERTIG (kein klarer Sieger)
  4 = NoName ist etwas besser
  5 = NoName ist DEUTLICH BESSER (klar weniger Zucker/Fett/Salz,
      sauberere Zutaten)

Wichtige Kriterien (in dieser Reihenfolge):
  • Zucker, Salz, gesättigte Fettsäuren (weniger = besser)
  • Ballaststoffe, Eiweiß (mehr = besser)
  • Zutatenliste-Länge + Zusatzstoffe (kürzer + weniger E-Nummern = besser)
  • Kalorien (kontextabhängig — bei "leicht/light" relevanter)

Konservativ bleiben: gleiche Nährwerte (±5%) UND ähnliche Zutaten = score 3.
Score 1 oder 5 nur bei DEUTLICHEN Unterschieden.

Antwort STRENG als JSON: { score: number, reasoning: string }.
reasoning: 1-2 kurze Sätze auf Deutsch, max ~220 Zeichen.
KEINE Marketing-Sprache, keine Adjektive wie "super/toll". Reine Fakten.
Beispiel: "NoName hat 30% weniger Zucker und kürzere Zutatenliste ohne
Aromen — gesünder bei vergleichbaren Nährwerten."`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ['score', 'reasoning'],
  properties: {
    score: { type: Type.INTEGER, minimum: 1, maximum: 5 },
    reasoning: { type: Type.STRING, maxLength: 260 },
  },
};

/**
 * Baut den User-Content für die Comparison-Anfrage.
 * Trimmt Werte (kein NaN, kein undefined als String).
 */
function buildUserContent({ noname, original }) {
  return [
    'NoName-Produkt:',
    formatProduct(noname),
    '',
    'Original-Markenprodukt:',
    formatProduct(original),
    '',
    'Vergleiche beide. Antworte als JSON gemäß Schema.',
  ].join('\n');
}

function formatProduct(p) {
  const lines = [
    `Name: ${p.name || 'unbekannt'}`,
    `Hersteller: ${p.hersteller || 'unbekannt'}`,
  ];
  // Nutrition per 100g
  const n = [];
  if (typeof p.energy === 'number') n.push(`Energie ${p.energy} kcal`);
  if (typeof p.fat === 'number') n.push(`Fett ${p.fat}g`);
  if (typeof p.satFat === 'number') n.push(`davon gesättigt ${p.satFat}g`);
  if (typeof p.carbs === 'number') n.push(`Kohlenhydrate ${p.carbs}g`);
  if (typeof p.sugar === 'number') n.push(`davon Zucker ${p.sugar}g`);
  if (typeof p.fiber === 'number') n.push(`Ballaststoffe ${p.fiber}g`);
  if (typeof p.protein === 'number') n.push(`Eiweiß ${p.protein}g`);
  if (typeof p.salt === 'number') n.push(`Salz ${p.salt}g`);
  if (n.length > 0) lines.push(`Nährwerte (pro 100g): ${n.join(', ')}`);
  else lines.push('Nährwerte: nicht verfügbar');
  // Ingredients (kann lang sein — auf ~600 Zeichen kappen damit der
  // Prompt nicht explodiert. 600 Zeichen reichen meistens für sinnvolle
  // Zutatenliste mit Top-10-Zutaten + Allergenen).
  const ing = (p.ingredients || '').slice(0, 600).trim();
  if (ing) lines.push(`Zutaten: ${ing}`);
  else lines.push('Zutaten: nicht verfügbar');
  return lines.join('\n');
}

/**
 * Extrahiert ein normalisiertes Produkt-Snapshot aus einem
 * Firestore-Doc (sowohl produkte als auch markenProdukte).
 * Liest die reweapify-style nutr_*-Felder.
 */
function snapshotFromDoc(data) {
  if (!data) return null;
  return {
    name: data.name || data.productName || data.bezeichnung || null,
    hersteller:
      data.herstellerName || // wenn populiert
      data.producerName ||
      null,
    energy: numOrNull(data.nutr_Energie_val),
    fat: numOrNull(data.nutr_Fett_val),
    satFat: numOrNull(data.nutr_FettdavongesttigteFettsuren_val),
    carbs: numOrNull(data.nutr_Kohlenhydrate_val),
    sugar: numOrNull(data.nutr_KohlenhydratedavonZucker_val),
    fiber: numOrNull(data.nutr_Ballaststoffe_val),
    protein: numOrNull(data.nutr_Eiwei_val),
    salt: numOrNull(data.nutr_Salz_val),
    ingredients: data.attr_ingredientStatement || data.zutaten || null,
  };
}

function numOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Prüft ob ein Snapshot überhaupt genug Daten hat um sinnvoll zu
 * vergleichen. Wir brauchen MINDESTENS Nährwerte ODER Zutaten —
 * sonst macht der Vergleich keinen Sinn.
 */
function isSnapshotComparable(s) {
  if (!s) return false;
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

/**
 * Macht den Gemini-Call. Wirft bei Netzwerk/Modell-Fehler.
 * Caller MUSS try/catch'n.
 */
async function callGemini({ apiKey, snapshot, model = DEFAULT_MODEL }) {
  const ai = new GoogleGenAI({ apiKey });
  const userContent = buildUserContent(snapshot);

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      // Niedrige Temperature — wir wollen deterministisch + faktenbasiert.
      temperature: 0.2,
      // Bei Gemini 2.5 Flash ist "Thinking" standardmäßig an und frisst
      // den Output-Budget auf — beobachtet: Output wird mid-string
      // truncated weil das Thinking schon X hundert Tokens verbraucht
      // hat. Wir brauchen kein Thinking für diesen einfachen JSON-Output.
      thinkingConfig: { thinkingBudget: 0 },
      // 1024 Tokens — sollte locker für 150-Token-Output reichen.
      maxOutputTokens: 1024,
    },
  });

  // text-Resolver: SDK v1.x exposes `response.text` as getter — kann aber
  // null sein wenn das Modell parts-Struktur returnt. Fallback auf
  // candidates[0].content.parts[*].text.
  let rawText = null;
  try {
    rawText = response?.text;
  } catch {
    rawText = null;
  }
  if (!rawText) {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts)) {
      rawText = parts
        .map((p) => p?.text || '')
        .filter(Boolean)
        .join('');
    }
  }
  if (!rawText || rawText.trim().length === 0) {
    throw new Error('Gemini returned no text (also empty candidates)');
  }

  const parsed = parseLooseJson(rawText);
  // Defensive Validation — sollte durch responseSchema schon gegeben
  // sein, aber paranoid.
  const score = Math.round(Number(parsed.score));
  if (!Number.isFinite(score) || score < 1 || score > 5) {
    throw new Error(`Gemini score invalid: ${parsed.score}`);
  }
  let reasoning = String(parsed.reasoning || '').trim();
  if (reasoning.length === 0) {
    throw new Error('Gemini returned empty reasoning');
  }
  // Hart auf 220 Zeichen kappen falls das Modell länger ist
  if (reasoning.length > 220) reasoning = reasoning.slice(0, 217) + '…';

  return {
    score,
    reasoning,
    model,
    promptVersion: PROMPT_VERSION,
  };
}

/**
 * Robustes JSON-Parsing für LLM-Outputs.
 *
 * Behandelt:
 *   - Markdown-Fences (```json ... ```)
 *   - Preamble ("Here is the JSON requested:")
 *   - Leading/trailing whitespace
 *   - Single Trailing Comma (best-effort)
 *
 * Wirft mit detail wenn auch nach Cleanup kein gültiges JSON.
 */
function parseLooseJson(raw) {
  let s = String(raw || '').trim();
  // Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  // Substring zwischen erstem { und letztem } — das fängt sowohl
  // Preamble ("Here is...") als auch trailing-Kommentare ab.
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  // Trailing-Comma vor } entfernen (best-effort)
  s = s.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(
      `Gemini JSON parse failed even after cleanup: ${e.message} — raw: ${String(raw).slice(0, 200)}`,
    );
  }
}

module.exports = {
  DEFAULT_MODEL,
  PROMPT_VERSION,
  snapshotFromDoc,
  isSnapshotComparable,
  callGemini,
};
