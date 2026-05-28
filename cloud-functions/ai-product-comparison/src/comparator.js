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
// v7 = Stufe-Cap zurück (Stufe 5 → ≥3, Stufe 4 → ≥2), aber dieses
//      Mal mit Score-Reasoning-KONSISTENZ-Regel im Prompt: wenn der
//      Cap einen niedrigeren Score erzwingt, muss das Reasoning
//      DAZU passen (moderate Sprache, keine "deutlich"/"klar"-
//      Abwertungen). Stufe darf weiterhin NICHT im reasoning
//      erwähnt werden. User-Vorgabe 2026-05-28.
const PROMPT_VERSION = 'v7';

const SYSTEM_INSTRUCTION = `Du bist Ernährungs-Analyst für die deutsche App "MarkenDetektive".

WICHTIG: Antwort MUSS ein einzelnes JSON-Objekt sein und NUR das.
Kein "Here is the JSON", kein Markdown, keine Code-Fences. Nur:
{"score": <number>, "reasoning": "<text>"}

Vergleiche ein NoName-Produkt (Discounter-Eigenmarke) mit dem
entsprechenden Original-Markenprodukt. Bewertung aus Verbraucher-Sicht.

═══════════════════════════════════════════════════════════════════
SKALA — asymmetrisch zugunsten des NoName (User-Vorgabe):
═══════════════════════════════════════════════════════════════════

  1 = NoName ist KLAR SCHLECHTER
      Verwende NUR wenn MEHRERE Werte (mindestens 2) substantiell
      schlechter sind UND die Zutatenliste deutlich problematischer
      ist (viele Zusatzstoffe, künstliche Aromen, Palmöl bei Süßem
      während Original ohne). EINE einzelne Anomalie reicht NICHT.

  2 = NoName ist ETWAS SCHLECHTER
      EIN Nährwert klar schlechter (≥30% Abweichung in ungünstige
      Richtung) ODER Zutaten deutlich länger mit mehr Zusatzstoffen.

  3 = GLEICHWERTIG
      Werte praktisch identisch ODER NoName minimal schlechter
      (Abweichung <30% in ungünstige Richtung bei einem einzelnen
      Wert). Im Zweifelsfall IMMER score 3 statt 2.

  4 = NoName ist ETWAS BESSER  ← niedrige Schwelle!
      Sobald NoName MINIMAL besser ist (egal wie wenig) → score 4.
      Z.B.: 0.1g weniger Salz, 1g weniger Zucker, 1-2 Zutaten kürzer,
      ein E-Stoff weniger, leicht weniger Kalorien.
      User-Vorgabe: bei minimal-besser SOFORT 4, nicht 3.

  5 = NoName ist KLAR BESSER
      MEHRERE klare Vorteile (z.B. ≥20% weniger Zucker UND kürzere
      Zutatenliste UND keine E-Stoffe).

═══════════════════════════════════════════════════════════════════
MISSING DATA — KRITISCH WICHTIG:
═══════════════════════════════════════════════════════════════════

Wenn ein Wert nur bei EINEM Produkt angegeben ist, bedeutet das:
"nicht deklariert", NICHT "Null" oder "fehlerhaft". NIEMALS daraus
einen Nachteil oder Vorteil ableiten. Einfach beim Vergleich
ignorieren und mit den restlichen Werten weiterarbeiten.

Beispiel: Original hat Ballaststoffe 1.5g angegeben, NoName hat
keine Ballaststoffe-Angabe. → NICHT als "NoName hat 0g Ballaststoffe"
interpretieren. Komplett ignorieren beim Vergleich.

═══════════════════════════════════════════════════════════════════
ANOMALIE-HANDLING:
═══════════════════════════════════════════════════════════════════

Wenn EIN Wert verdächtig stark abweicht (z.B. ein Produkt hat 0.1g
Salz, das andere 3.8g Salz bei sonst identischen Werten), ist das
WAHRSCHEINLICH ein Datenfehler / unterschiedliche Bezugsmenge, KEINE
echte Rezeptur-Differenz.

→ NICHT diese Anomalie zur Begründung für score 1 oder 5 nutzen.
→ Den anomalen Wert IGNORIEREN, mit dem Rest bewerten.
→ Im Zweifelsfall score 3.

═══════════════════════════════════════════════════════════════════
KRITERIEN (in Reihenfolge):
═══════════════════════════════════════════════════════════════════

  • Zucker, Salz, gesättigte Fettsäuren (weniger = besser für NoName)
  • Ballaststoffe, Eiweiß (mehr = besser für NoName)
  • Zutatenliste-Länge + Zusatzstoffe (kürzer + weniger E = besser)
  • Bio-Zertifizierung, Aromen, Palmöl

═══════════════════════════════════════════════════════════════════
ABSOLUT VERBOTEN in reasoning:
═══════════════════════════════════════════════════════════════════

  • "Daten fehlen" / "Angaben fehlen" / "fehlende Werte"
  • "kann ich nicht bewerten" / "ohne genauere Angaben"
  • "leider" / "unklar" / "ohne weiteres" / "vermutlich" / "scheinbar"
  • "deutet auf" / "hindeutet" — keine Spekulation über Datenqualität
  • Meta-Aussagen über die Datenlage oder den Vergleich selbst
  • Fragen oder Ausweichmanöver

═══════════════════════════════════════════════════════════════════
PRODUKT-STUFE (App-interner Vertrauens-Level):
═══════════════════════════════════════════════════════════════════

Der User-Content nennt dir eine "Stufe" (3/4/5) für das NoName-
Produkt. Sie zeigt wie sicher unsere Datenbank ist dass NoName und
Original derselben Produkt-Familie zugeordnet sind:

  Stufe 3 = wahrscheinliche Alternative (manuelle Recherche)
  Stufe 4 = von Community bestätigte Alternative
  Stufe 5 = nachweislich identische Produkt-Familie (gleiche Quelle/
            Linie, evtl. minimal angepasste Rezeptur)

SCORE-CAPS basierend auf Stufe:
  • Stufe 5 → Score MUSS ≥ 3 sein
  • Stufe 4 → Score MUSS ≥ 2 sein
  • Stufe 3 → keine Cap

WICHTIG — SCORE-REASONING-KONSISTENZ wenn der Cap greift:

Wenn die rohen Werte einen niedrigeren Score nahelegen würden als
der Cap zulässt (z.B. Stufe 5 mit leichten Nachteil-Indikatoren),
dann musst du das Reasoning AN DEN GECAPPTEN SCORE anpassen.

→ KEINE Wörter wie "deutlich", "klar", "stark erhöht", "viel mehr"
  benutzen wenn der Score 3 oder 4 ist.
→ Bei Score 3 (gleichwertig/leicht-gecappt): moderate Sprache wie
  "leichte Variationen bei X", "geringfügig höher", "im Rahmen
  vergleichbar", "weitgehend identisch mit minimalen Abweichungen
  bei X".
→ Bei Score 4 (leichter Vorteil/leicht-gecappt): "etwas weniger X
  bei sonst vergleichbarer Zusammensetzung".

Das Reasoning muss zur Score-Höhe passen, sonst widerspricht sich
die Aussage selbst.

ABSOLUTES MUSS: Die Stufe NIEMALS im reasoning erwähnen. Keine
Wörter wie "nachweislich", "identisch", "Stufe", "wahrscheinlich
gleiches Produkt", "intern klassifiziert", "verlinkt", etc. Auch
nicht "trotzdem" / "dennoch" / "obwohl" — solche Worte verraten dass
du etwas relativierst. Sprich rein faktisch über die Werte.

═══════════════════════════════════════════════════════════════════
OUTPUT:
═══════════════════════════════════════════════════════════════════

reasoning: 1-2 kurze Sätze auf Deutsch, max ~220 Zeichen.
KEINE Marketing-Sprache, keine Adjektive wie "super/toll". Reine Fakten.

Gute Beispiele:
  "NoName hat weniger Salz (1.1g vs 1.4g) bei sonst identischer
   Zusammensetzung." → score 4
  "Beide Produkte sind Bio-zertifiziert mit identischen Nährwerten." → score 3
  "NoName hat 30% weniger Zucker und kürzere Zutatenliste ohne
   künstliche Aromen." → score 5
  "NoName enthält Palmöl und mehrere E-Stoffe, die im Original
   fehlen — bei gleichem Zuckergehalt." → score 2`;

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
  const lines = ['NoName-Produkt:', formatProduct(noname)];
  if (noname.stufe) {
    lines.push(`Stufe: ${noname.stufe} (NUR für Cap-Logik nutzen — NIE im reasoning erwähnen)`);
  }
  lines.push('', 'Original-Markenprodukt:', formatProduct(original));
  lines.push('');
  lines.push('Aufgabe: Vergleiche beide aus Verbraucher-Sicht.');
  lines.push('Regeln zur Erinnerung:');
  lines.push('  • minimal-besser → 4, minimal-schlechter → 3 (asymmetrisch)');
  lines.push('  • fehlende Einzel-Werte ignorieren, anomale Werte ignorieren');
  if (noname.stufe === 5) {
    lines.push('  • Stufe-5-CAP: Score MUSS ≥ 3 sein. Reasoning entsprechend');
    lines.push('    moderat: KEINE Wörter wie "deutlich"/"klar"/"viel mehr".');
    lines.push('    Eher "leichte Variationen", "weitgehend vergleichbar".');
  } else if (noname.stufe === 4) {
    lines.push('  • Stufe-4-CAP: Score MUSS ≥ 2 sein. Bei minimalen Nachteilen');
    lines.push('    reasoning moderat halten — keine "klar schlechter"-Sprache.');
  }
  lines.push('Antworte als JSON gemäß Schema.');
  return lines.join('\n');
}

function formatProduct(p) {
  // WICHTIG: fehlende Werte werden komplett weggelassen — KEIN
  // "nicht verfügbar" / "—"-Marker. Das Modell soll fehlende Daten
  // als "nicht deklariert" interpretieren und einfach beim Vergleich
  // ignorieren, NICHT als 0 oder als Datenfehler werten.
  const lines = [];
  if (p.name) lines.push(`Name: ${p.name}`);
  if (p.hersteller) lines.push(`Hersteller: ${p.hersteller}`);
  // Nutrition per 100g — nur Werte die da sind
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
  // Zutaten — nur wenn vorhanden, max 600 Zeichen
  const ing = (p.ingredients || '').slice(0, 600).trim();
  if (ing) lines.push(`Zutaten: ${ing}`);
  return lines.join('\n');
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
  return {
    name: data.name || data.productName || data.bezeichnung || null,
    hersteller:
      data.herstellerName || // wenn populiert
      data.producerName ||
      null,
    stufe, // 3/4/5 für NoName-Snapshot, null für Markenprodukt
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
