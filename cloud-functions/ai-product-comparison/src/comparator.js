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

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

// Prompt-Version: hash auf doc speichern damit wir bei Prompt-Update
// alte Comparisons automatisch invalidieren können (Backfill rechnet
// alles mit version-Unterschied neu).
// v13 = Asymmetrie kristallklar gemacht: minimal-besser-NoName → 4,
//       minimal-besser-Original → trotzdem 3 (nicht 2). Die Skala
//       kippt IMMER zugunsten NoName wenn nichts klar dagegen spricht.
const PROMPT_VERSION = 'v13';

const SYSTEM_INSTRUCTION = `Du bist Ernährungswissenschaftler. Du vergleichst ein NoName-Produkt (Discounter-Eigenmarke) mit dem Original-Markenprodukt aus der Sicht eines Verbrauchers.

OUTPUT — STRENG NUR ein JSON-Objekt, ohne Markdown, ohne Preamble:
{"score": <1-5>, "reasoning": "<DE-Text, 2-3 vollständige Sätze, ≤320 Zeichen>"}

WICHTIG: Schreibe VOLLSTÄNDIGE Sätze. Kein Satz darf abgeschnitten sein.
Lieber kürzer und vollständig als länger und unfertig. Verwende kein "…"
oder "etc." am Ende.

SCORE-SKALA — ASYMMETRISCH zugunsten NoName:
  5 = klar besser     — mehrere klare NoName-Vorteile (Werte UND Zutaten)
  4 = etwas besser    — NoName hat irgendwo einen Vorteil (auch nur einen,
                        auch nur leicht). Sobald EIN Vorteil da ist → 4.
  3 = gleichwertig    — Werte praktisch identisch ODER nur Original
                        leicht besser (≤15%) ohne starke Premium-Vorteile
  2 = etwas schlechter — KLARER Original-Vorteil ohne NoName-Ausgleich
                        (z.B. Original-Wert ≥20% besser; ODER Original
                        hat Bio/Fair-Trade/echte Wirk-Zutat die NoName fehlt)
  1 = klar schlechter  — MEHRERE substantielle Original-Vorteile, NoName
                        hat keinen Ausgleich

═══════════════════════════════════════════════════════════════════
ENTSCHEIDUNGS-LOGIK — IN DIESER REIHENFOLGE PRÜFEN:
═══════════════════════════════════════════════════════════════════

Schritt 1: Hat der NoName IRGENDWO einen klaren Vorteil (≥5% besser
in einem Nährwert, weniger Zusatzstoffe, eigener Premium-Marker,
bessere echte Wirk-Zutaten)?
  → JA: Score ist mindestens 4
        (5 nur wenn MEHRERE klare Vorteile UND keine echten Nachteile)
  → NEIN: weiter zu Schritt 2

Schritt 2: Hat das Original klare Vorteile gegenüber NoName?
  • Mehrere Werte ≥10% besser ODER
  • Premium-Marker (Bio/Fair-Trade/Rainforest/etc.) die NoName nicht hat ODER
  • Echte Wirk-Zutat die NoName nicht hat
  → JA, mehrere davon: Score 1
  → JA, eines davon: Score 2
  → NEIN (nur minimal besser, ≤15%, ohne Premium-Marker): Score 3
        (Asymmetrie — Original-Minimal-Vorteil reicht NICHT für 2)

KERNREGEL: Der NoName-Vorteil-Check kommt ZUERST. Sobald NoName
irgendwo punktet → score ≥4. Score 2 oder 1 nur wenn NoName GAR
KEINEN Vorteil hat UND Original klare Vorteile hat.

BEWERTUNGS-KRITERIEN als Ernährungswissenschaftler:
  Nährwerte — weniger Salz, weniger Zucker, weniger gesättigte Fettsäuren,
              weniger Kalorien sind besser; mehr Eiweiß / Ballaststoffe sind besser.
  Zutaten   — weniger Zusatzstoffe (Aromen, Konservierungs-, Verdickungs-,
              Farbstoffe, E-Nummern) ist besser. Echte Wirk-Zutaten
              (z.B. echte Vanille, Melisse, Bourbon-Vanilleschote) sind
              besser als Aromen.
  Labels    — Bio, Fair Trade, Rainforest Alliance, MSC/ASC, Tierwohl,
              V-Label, Vegan, Vegetarisch, Glutenfrei, Laktosefrei
              zählen als Qualitätsmarker.
              Nutri-Score (A besser als E), NOVA-Gruppe (1 besser als 4),
              Eco-Score (A besser als E) — niedriger ist besser.

REGELN ZUR VERLÄSSLICHKEIT:
  • Keine Zahl erwähnen die nicht in der Datentabelle steht.
  • Energie ist bereits in kcal — niemals umrechnen.
  • Fehlende Werte auf einer Seite einfach ignorieren, nie als "0" lesen.
  • Niemals über Datenqualität sprechen. Keine Worte wie "extrem",
    "unrealistisch", "fehlerhaft", "vermutlich", "scheinbar".
  • Keine Worte wie "Stufe", "nachweislich", "intern", "klassifiziert".
  • Im User-Content kann eine "Stufe" stehen. Sie ist intern — niemals
    erwähnen. Beachte still: Stufe 5 → score min. 3; Stufe 4 → score min. 2.

REASONING-STIL (nach Beispielen):

BEISPIEL 1 — NoName klar besser → score 4-5:
  "Das NoName-Produkt hat weniger Kalorien, weniger Fett und Zucker und
  ist damit etwas gesünder bzw. weniger belastend. Dazu kommt, dass es
  keine Verdickungsmittel und künstliche Konservierungsstoffe enthält,
  was die Zutaten deutlich besser macht."

BEISPIEL 2 — NoName leicht besser → score 4:
  "Das NoName-Produkt enthält keine künstlichen Farbstoffe und Aromen.
  Ansonsten sind sich die Produkte in Zutaten und Nährwerten sehr ähnlich.
  Deswegen ist das NoName-Produkt in der Qualität höchstwahrscheinlich
  besser."

BEISPIEL 3 — Original deutlich besser → score 2
  (nur bei KLAREN Original-Vorteilen, nicht bei minimalen Abweichungen):
  "Das Original ist Bio- und Fair-Trade-zertifiziert und enthält echte
  Vanille, während das NoName-Produkt auf künstliche Aromen setzt. Die
  Nährwerte sind ähnlich, aber qualitativ ist die Marke hier vorzuziehen."

BEISPIEL 4 — Original nur leicht besser → score 3 (gleichwertig!):
  "Die Produkte sind in den Zutaten und Nährwerten sehr ähnlich.
  Das Original hat geringfügig weniger Salz, dieser Unterschied ist
  jedoch zu klein um qualitativ ins Gewicht zu fallen."

Schreibe in vollständigen deutschen Sätzen, sachlich, ohne Werbe-Adjektive.
Konkrete Werte und Marker nennen wenn relevant.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ['score', 'reasoning'],
  properties: {
    score: { type: Type.INTEGER, minimum: 1, maximum: 5 },
    reasoning: { type: Type.STRING, maxLength: 400 },
  },
};

/**
 * Baut den User-Content für die Comparison-Anfrage.
 * Trimmt Werte (kein NaN, kein undefined als String).
 */
function buildUserContent({ noname, original }) {
  const lines = [
    'Vergleichs-Daten (alle Nährwerte pro 100g, Energie bereits in kcal):',
    '',
    formatComparisonTable(original, noname),
  ];
  if (noname.stufe) {
    lines.push('', `(interne Stufe: ${noname.stufe})`);
  }
  lines.push('', 'Vergleiche beide und antworte als JSON.');
  return lines.join('\n');
}

// Wird in buildUserContent durch formatComparisonTable ersetzt — bleibt
// hier nur falls von externen Aufrufern noch genutzt.
function formatProduct(p) {
  const lines = [];
  if (p.name) lines.push(`Name: ${p.name}`);
  if (p.hersteller) lines.push(`Hersteller: ${p.hersteller}`);
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
  const ing = (p.ingredients || '').slice(0, 600).trim();
  if (ing) lines.push(`Zutaten: ${ing}`);
  return lines.join('\n');
}

// Side-by-Side Format — verhindert Werte-Verwechslung. Pro Zeile
// EIN Aspekt mit Original- und NoName-Wert nebeneinander. Wenn ein
// Wert fehlt: leere Spalte. Das Modell kann hier nicht durcheinander
// kommen welcher Wert wohin gehört.
function formatComparisonTable(original, noname) {
  const rows = [];

  // Header
  rows.push(`| Aspekt              | ORIGINAL           | EIGENMARKE (NoName) |`);
  rows.push(`|---------------------|--------------------|---------------------|`);

  const row = (label, oVal, nVal) => {
    const o = oVal == null ? '' : String(oVal);
    const n = nVal == null ? '' : String(nVal);
    return `| ${label.padEnd(19)} | ${o.padEnd(18)} | ${n.padEnd(19)} |`;
  };

  if (original.name || noname.name) {
    rows.push(row('Name', original.name, noname.name));
  }
  if (original.hersteller || noname.hersteller) {
    rows.push(row('Hersteller', original.hersteller, noname.hersteller));
  }

  // Nährwerte (alle in kcal nach v10-Konvertierung)
  rows.push(row('Energie (kcal)', original.energy, noname.energy));
  rows.push(row('Fett (g)', original.fat, noname.fat));
  rows.push(row('gesättigt (g)', original.satFat, noname.satFat));
  rows.push(row('Kohlenhydrate (g)', original.carbs, noname.carbs));
  rows.push(row('davon Zucker (g)', original.sugar, noname.sugar));
  rows.push(row('Ballaststoffe (g)', original.fiber, noname.fiber));
  rows.push(row('Eiweiß (g)', original.protein, noname.protein));
  rows.push(row('Salz (g)', original.salt, noname.salt));

  // Labels — nur wenn mindestens einer was hat
  const lbl = (key, label) => {
    const o = original.labels?.[key];
    const n = noname.labels?.[key];
    if (o == null && n == null) return null;
    const fmt = (v) => (v === true ? 'ja' : v === false ? 'nein' : v == null ? '' : String(v));
    return row(label, fmt(o), fmt(n));
  };
  const labelRows = [
    lbl('nutriscore', 'Nutri-Score'),
    lbl('ecoscore', 'Eco-Score'),
    lbl('nova', 'NOVA-Gruppe'),
    lbl('isBio', 'Bio'),
    lbl('isVegan', 'Vegan'),
    lbl('isVegetarisch', 'Vegetarisch'),
    lbl('isGlutenfrei', 'Glutenfrei'),
    lbl('isLaktosefrei', 'Laktosefrei'),
  ].filter(Boolean);
  if (labelRows.length > 0) {
    rows.push(`|---------------------|--------------------|---------------------|`);
    rows.push(...labelRows);
  }

  let out = rows.join('\n');

  // Zutaten als separater Block (zu lang für Tabellen-Format)
  const oIng = (original.ingredients || '').slice(0, 600).trim();
  const nIng = (noname.ingredients || '').slice(0, 600).trim();
  if (oIng) out += `\n\nZUTATEN ORIGINAL:\n${oIng}`;
  if (nIng) out += `\n\nZUTATEN EIGENMARKE (NoName):\n${nIng}`;

  return out;
}

/**
 * Extrahiert ein normalisiertes Produkt-Snapshot aus einem
 * Firestore-Doc (sowohl produkte als auch markenProdukte).
 * Liest die reweapify-style nutr_*-Felder.
 */
function snapshotFromDoc(data) {
  if (!data) return null;
  // stufe kann String '3'/'4'/'5' oder Number sein — normalisieren
  let stufe = null;
  if (typeof data.stufe === 'string') {
    const n = parseInt(data.stufe, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 5) stufe = n;
  } else if (typeof data.stufe === 'number') {
    if (data.stufe >= 1 && data.stufe <= 5) stufe = data.stufe;
  }

  // ENERGIE — KRITISCH: nutr_Energie_unit auswerten. Wenn 'kJ' →
  // konvertieren zu kcal damit Gemini einheitlich kcal-Zahlen sieht
  // und keine kJ-vs-kcal-Verwechslung entsteht (1 kcal = 4.184 kJ).
  let energyKcal = numOrNull(data.nutr_Energie_val);
  const energyUnit = typeof data.nutr_Energie_unit === 'string'
    ? data.nutr_Energie_unit.toLowerCase()
    : null;
  if (energyKcal != null && (energyUnit === 'kj' || energyUnit === 'kJ'.toLowerCase())) {
    energyKcal = Math.round(energyKcal / 4.184);
  }

  // Labels — wenn vorhanden, auch an Gemini geben damit Premium-Marker
  // berücksichtigt werden können. Felder existieren teilweise auf
  // produkte/markenProdukte (nutriscore) bzw. nach reweapify-Backfill
  // (attr_isVegan, attr_isVegetarisch).
  const labels = {
    nutriscore: typeof data.nutriscore === 'string' ? data.nutriscore.toLowerCase() : null,
    ecoscore: typeof data.ecoscore === 'string' ? data.ecoscore.toLowerCase() : null,
    nova: typeof data.nova === 'string' || typeof data.nova === 'number' ? String(data.nova) : null,
    isVegan: typeof data.attr_isVegan === 'boolean' ? data.attr_isVegan
             : typeof data.isVegan === 'boolean' ? data.isVegan
             : null,
    isVegetarisch: typeof data.attr_isVegetarisch === 'boolean' ? data.attr_isVegetarisch
                   : typeof data.isVegetarian === 'boolean' ? data.isVegetarian
                   : null,
    isGlutenfrei: typeof data.attr_isGlutenfrei === 'boolean' ? data.attr_isGlutenfrei
                  : typeof data.isGlutenFree === 'boolean' ? data.isGlutenFree
                  : null,
    isLaktosefrei: typeof data.attr_isLaktosefrei === 'boolean' ? data.attr_isLaktosefrei
                   : typeof data.isLactoseFree === 'boolean' ? data.isLactoseFree
                   : null,
    isBio: typeof data.attr_isBio === 'boolean' ? data.attr_isBio
           : typeof data.isBio === 'boolean' ? data.isBio
           : null,
  };

  return {
    name: data.name || data.productName || data.bezeichnung || null,
    hersteller:
      data.herstellerName || // wenn populiert
      data.producerName ||
      null,
    stufe, // 3/4/5 für NoName-Snapshot, null für Markenprodukt
    energy: energyKcal, // immer in kcal — kJ wurde konvertiert
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

/**
 * Prüft ob ein Snapshot vergleichbare Daten hat. User-Vorgabe
 * 2026-05-28 nach Re-Review: Name allein reicht NICHT. Wenn ein
 * Produkt weder Nährwerte noch Zutaten hat, gibt es nichts zu
 * vergleichen — dann lieber GAR keine KI-Bewertung anzeigen als
 * Meta-Text wie "Da keine Nährwerte vorliegen…".
 *
 * Folge: das Doc bekommt aiComparison.skipped='incomparable' und
 * die UI rendert nichts (AiComparisonScale returnt null).
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
  let score = Math.round(Number(parsed.score));
  if (!Number.isFinite(score) || score < 1 || score > 5) {
    throw new Error(`Gemini score invalid: ${parsed.score}`);
  }
  let reasoning = String(parsed.reasoning || '').trim();
  if (reasoning.length === 0) {
    throw new Error('Gemini returned empty reasoning');
  }

  // Stufe-Cap als Safety-Net falls das Modell die Prompt-Regeln
  // ignoriert. v7: Score wird hochgezogen, aber das Reasoning sollte
  // dank Prompt-Anweisung bereits moderat formuliert sein. Falls
  // doch starke Sprache übrig blieb, könnte man hier optional einen
  // String-Cleanup machen — aktuell vertrauen wir dem Prompt.
  const stufe = snapshot?.noname?.stufe;
  if (stufe === 5 && score < 3) {
    score = 3;
  } else if (stufe === 4 && score < 2) {
    score = 2;
  }

  // Soft-Cap: wenn länger als 380, schneide am letzten Satz-Ende ab
  // statt mitten im Wort mit '…'. User-Vorgabe: keine angeschnittenen
  // Texte in der UI.
  if (reasoning.length > 380) {
    const truncated = reasoning.slice(0, 380);
    const lastDot = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('! '),
      truncated.lastIndexOf('? '),
    );
    if (lastDot > 200) {
      reasoning = truncated.slice(0, lastDot + 1);
    } else {
      // Kein vernünftiges Satzende gefunden — auf letztes Leerzeichen
      const lastSpace = truncated.lastIndexOf(' ');
      reasoning = (lastSpace > 200 ? truncated.slice(0, lastSpace) : truncated).trim();
      if (!/[.!?]$/.test(reasoning)) reasoning += '.';
    }
  }

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
