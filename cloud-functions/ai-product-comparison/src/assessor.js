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

const ASSESSMENT_PROMPT_VERSION = 'v6';

const SYSTEM_INSTRUCTION = `Du bist Ernährungs-Analyst für die deutsche App "MarkenDetektive".

WICHTIG: Antwort MUSS ein einzelnes JSON-Objekt sein und NUR das.
Kein "Here is the JSON", kein Markdown, keine Code-Fences. Nur:
{"healthScore": <number>, "reasoning": "<text>"}

Bewerte das gegebene Produkt anhand seiner Nährwerte + Zutaten —
KATEGORIE-RELATIV. Eine Tafel Schokolade soll mit anderen Schokoladen
verglichen werden, nicht mit Salat. Eine Tüte Chips mit anderen Chips.

═══════════════════════════════════════════════════════════════════
SKALA — kategorie-relativ, mit klaren Anforderungen pro Stufe:
═══════════════════════════════════════════════════════════════════

  1 = klar UNGESUND für die Kategorie. Mehrere Negativ-Signale
      gleichzeitig (sehr lange Zutatenliste UND viele Zusatzstoffe UND
      deutlich höhere Zucker-/Salz-/Fettwerte als kategorie-typisch).
  2 = unterhalb des Durchschnitts (klarer Einzel-Nachteil).
  3 = DURCHSCHNITT der Kategorie / Standard-Rezeptur. Das ist der
      DEFAULT — und zugleich der Deckel für hochverarbeitete Produkte
      (siehe unten).
  4 = klar oberhalb des Durchschnitts. NUR wenn MEHRERE klare Positiv-
      Aspekte ZUSAMMENKOMMEN — z.B. kurze, klare Zutatenliste OHNE
      künstliche Aromen/Süßstoffe UND bessere Nährwerte (weniger Zucker/
      Salz/gesättigtes Fett) als kategorie-typisch. EIN einzelner Vorteil
      reicht NICHT für eine 4.
  5 = herausragend in der Kategorie, SELTEN vergeben: Bio ODER sehr
      kurze, klare Zutatenliste OHNE Zusatzstoffe — UND deutlich bessere
      Nährwerte als der Kategorie-Durchschnitt.

═══════════════════════════════════════════════════════════════════
DECKEL FÜR HOCHVERARBEITETE PRODUKTE (HART — überschreibt die Skala):
═══════════════════════════════════════════════════════════════════

Ist das Produkt stark verarbeitet — NOVA-Gruppe 4 (falls angegeben) ODER
die Zutatenliste enthält mehrere Zusatzstoffe (Süßstoffe wie Aspartam/
Acesulfam/Sucralose, künstliche Aromen, Farbstoffe, mehrere E-Nummern) —
dann MAXIMAL score 3. Solche Produkte sind NIE "sehr gute Wahl" (4 oder 5),
auch nicht kategorie-relativ. Beispiel: ein kalorienarmes Diet-Getränk mit
Süßstoffen + Farbstoff ist trotz wenig Zucker höchstens 3.

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
  "Kurze Zutatenliste ohne künstliche Aromen und mit 12g Zucker auf 100g
   deutlich unter dem Schokoladen-Durchschnitt." → score 4
   (mehrere Positiv-Aspekte: klare Liste UND wenig Zucker)
  "Klassische Rezeptur mit standardtypischen Nährwerten für die
   Kategorie." → score 3
  "Kalorienarm, aber mit Süßstoffen und Farbstoff stark verarbeitet." → score 3
   (Deckel greift trotz wenig Zucker)
  "Lange Zutatenliste mit mehreren Zusatzstoffen und Aromen, deutlich
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

  // Verarbeitungs-Signale (falls vorhanden) — wichtig für den
  // Hochverarbeitet-Deckel: NOVA 4 / Süßstoffe / Farbstoffe → max 3.
  const lbl = product.labels || {};
  const sig = [];
  if (lbl.nutriscore) sig.push(`Nutri-Score ${String(lbl.nutriscore).toUpperCase()}`);
  if (lbl.nova) sig.push(`NOVA-Gruppe ${lbl.nova}`);
  if (lbl.isBio === true) sig.push('Bio');
  if (sig.length > 0) lines.push(`Signale: ${sig.join(', ')}`);

  lines.push('');
  lines.push('Aufgabe: kategorie-relative Bewertung gemäß Skala + Deckel.');
  lines.push('4/5 brauchen MEHRERE klare Positiv-Aspekte; hochverarbeitete');
  lines.push('Produkte (NOVA 4 / Süßstoffe / Farbstoffe / viele Zusatzstoffe)');
  lines.push('maximal 3. Fehlende Werte ignorieren, NIEMALS Datenlage thematisieren.');
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
  // Scores aus BEIDEN Feld-Konventionen lesen: produkte/markenProdukte nutzen
  // nutriscore/ecoscore/nova, external_products nutzen scoreNutri/scoreEco/
  // scoreNova. So greift der Hochverarbeitet-Deckel (NOVA 4) auch extern.
  const nutriRaw = data.nutriscore ?? data.scoreNutri;
  const ecoRaw = data.ecoscore ?? data.scoreEco;
  const novaRaw = data.nova ?? data.scoreNova;
  const labels = {
    nutriscore: typeof nutriRaw === 'string' ? nutriRaw.toLowerCase() : null,
    ecoscore: typeof ecoRaw === 'string' ? ecoRaw.toLowerCase() : null,
    nova: typeof novaRaw === 'string' || typeof novaRaw === 'number' ? String(novaRaw) : null,
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
