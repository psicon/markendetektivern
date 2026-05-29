/**
 * manufacturer.js — KI-Einschätzung EINES Herstellers (kein Vergleich).
 *
 * Liefert eine kurze, neutrale Einordnung eines Herstellers auf Basis des
 * MODELL-WISSENS (Gemini): Herkunft/Regionalität + allgemeine Einordnung,
 * plus — VORSICHTIG und nur wenn breit dokumentiert — bekannte öffentliche
 * Kontroversen. KEIN Score (User-Vorgabe 2026-05-29: reine Info-Karte).
 *
 * Wird PRO HERSTELLER einmal berechnet (hersteller/{id}.aiHersteller),
 * nicht pro Produkt — der gleiche Hersteller wird so nicht 50× bewertet.
 * Alle Produkte die auf den Hersteller zeigen lesen dieselbe Bewertung.
 *
 * Output:
 *   {
 *     herkunft: string,   // One-Liner für ein Badge, z.B.
 *                         //   "Deutschland · Familienunternehmen aus Ravensburg"
 *     summary:  string,   // 2-4 Sätze DE, neutral; ggf. vorsichtige
 *                         //   bekannte Kontroverse, defensiv formuliert.
 *   }
 *
 * RECHTLICHES / HALLUZINATION:
 *   Modell-Wissen hat einen Trainingsstand (keine Live-News) und kann
 *   irren. Falsche Skandal-Behauptungen sind rechtlich heikel (Rufschädi-
 *   gung). Der Prompt erzwingt daher: nur breit dokumentierte, unstrittige
 *   Fakten; defensive Sprache ("öffentlich diskutiert", "in der Vergangen-
 *   heit kritisiert"); KEINE erfundenen Kontroversen; wenn nichts Markantes
 *   bekannt ist → nur neutrale Herkunfts-/Einordnungs-Aussage.
 */

const { GoogleGenAI, Type } = require('@google/genai');

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

const MANUFACTURER_PROMPT_VERSION = 'v1';

const SYSTEM_INSTRUCTION = `Du bist ein nüchterner Lebensmittel-Branchen-Analyst für die deutsche App "MarkenDetektive". Du gibst eine KURZE, faktische Einordnung EINES Herstellers/Lebensmittelproduzenten.

Antwort MUSS ein einzelnes JSON-Objekt sein, nur das, ohne Markdown/Preamble:
{"herkunft": "<One-Liner>", "summary": "<2-4 Sätze DE>"}

INHALT:
1. herkunft: knapper One-Liner zur Herkunft/Art des Unternehmens, gestützt
   auf die übergebenen Stamm­daten (Land, Stadt) + dein Wissen. Beispiele:
   "Deutschland · Familienunternehmen aus Ravensburg",
   "Deutschland", "Schweiz · internationaler Konzern". Max ~70 Zeichen.

2. summary: 2-4 vollständige deutsche Sätze. Reihenfolge:
   • Neutrale Einordnung: Herkunft/Regionalität, Größe (Mittelstand/Familien-
     betrieb/Konzern), Tradition, Schwerpunkt, ggf. Zertifizierungen.
   • NUR wenn breit dokumentiert und unstrittig: eine bekannte öffentliche
     Kontroverse — DEFENSIV formuliert ("wurde öffentlich diskutiert",
     "stand in der Vergangenheit in der Kritik wegen…"). Sonst weglassen.

STRENGE REGELN (rechtlich + Qualität):
  • ERFINDE NICHTS. Keine Kontroverse behaupten, die du nicht sicher kennst.
  • Wenn dir der Hersteller unbekannt ist → schreibe NUR eine neutrale
    Herkunfts-/Einordnungs-Aussage aus den Stammdaten. KEINE Spekulation,
    KEINE Kontroverse, kein "vermutlich"/"vermutlich/wahrscheinlich".
  • Keine absoluten Schuld-Urteile ("ist verantwortlich für…"). Nur
    referierend: "öffentlich diskutiert/kritisiert wurde…".
  • Keine Werbe-Sprache ("toll", "hochwertig", "beste"). Sachlich.
  • Kein Gesundheits- oder Produkt-Urteil (das macht eine andere Analyse).
  • Keine Meta-Sätze über Datenlage ("Informationen fehlen", "soweit bekannt").
  • Keine tagesaktuellen Behauptungen ("aktuell", "derzeit", Jahreszahlen
    der Gegenwart) — dein Wissen ist nicht live.

BEISPIELE (Stil):
  herkunft: "Deutschland · Familienunternehmen aus Löningen"
  summary: "Mittelständischer Tiefkühl-Hersteller aus Niedersachsen mit
   Schwerpunkt auf Kartoffelprodukten. Das Unternehmen produziert
   überwiegend am deutschen Standort."

  herkunft: "Schweiz · internationaler Konzern"
  summary: "Weltweit tätiger Lebensmittelkonzern mit Sitz in der Schweiz und
   breitem Markenportfolio. In der Vergangenheit wurde das Unternehmen
   öffentlich wegen seiner Wasser-Abfüllpraktiken kritisiert."`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  required: ['herkunft', 'summary'],
  properties: {
    herkunft: { type: Type.STRING, maxLength: 90 },
    summary: { type: Type.STRING, maxLength: 420 },
  },
};

/**
 * Normalisiert ein hersteller-Doc in ein Snapshot.
 *   name           = Marken-/Kurzname (öffentlich bekannt, z.B. "Neuburger")
 *   legalName      = Rechtsform/Entität (z.B. "OMIRA GmbH")
 *   land/stadt     = Stammdaten für Regionalität (erden den Prompt)
 */
function snapshotFromHersteller(data) {
  if (!data) return null;
  const clean = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    name: clean(data.name) || null,
    legalName: clean(data.herstellername) || null,
    land: clean(data.land) || null,
    stadt: clean(data.stadt) || null,
  };
}

/**
 * Platzhalter-/Müll-Einträge filtern, die nicht sinnvoll bewertbar sind.
 * Beispiele aus den Daten: "z - NoName", reiner Single-Char-Name.
 */
function isEvaluable(s) {
  if (!s) return false;
  const candidate = (s.name || s.legalName || '').trim();
  if (candidate.length < 2) return false;
  const low = candidate.toLowerCase();
  if (low === 'noname' || low === 'no name') return false;
  if (low.startsWith('z - ')) return false; // Platzhalter-Konvention im Datensatz
  return true;
}

function buildUserContent(s) {
  const lines = [];
  if (s.name) lines.push(`Markenname: ${s.name}`);
  if (s.legalName && s.legalName !== s.name) lines.push(`Unternehmen: ${s.legalName}`);
  const ort = [s.stadt, s.land].filter(Boolean).join(', ');
  if (ort) lines.push(`Sitz (laut Stammdaten): ${ort}`);
  lines.push('');
  lines.push('Aufgabe: knappe, neutrale Hersteller-Einordnung gemäß System-');
  lines.push('Regeln. Kontroverse NUR wenn breit dokumentiert + defensiv.');
  lines.push('Bei unbekanntem Hersteller: nur Herkunft/Einordnung, nichts erfinden.');
  lines.push('Antworte als JSON gemäß Schema.');
  return lines.join('\n');
}

async function callGeminiManufacturer({ apiKey, snapshot, model = DEFAULT_MODEL }) {
  const ai = new GoogleGenAI({ apiKey });
  const userContent = buildUserContent(snapshot);

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
    throw new Error('Gemini (manufacturer) returned no text');
  }

  const parsed = parseLooseJson(rawText);
  let herkunft = String(parsed.herkunft || '').trim();
  let summary = String(parsed.summary || '').trim();
  if (summary.length === 0) {
    throw new Error('Gemini (manufacturer) returned empty summary');
  }
  if (herkunft.length > 90) herkunft = herkunft.slice(0, 88).trim() + '…';
  if (summary.length > 420) {
    const truncated = summary.slice(0, 420);
    const lastDot = Math.max(
      truncated.lastIndexOf('. '),
      truncated.lastIndexOf('! '),
      truncated.lastIndexOf('? '),
    );
    summary = lastDot > 200 ? truncated.slice(0, lastDot + 1) : truncated.trim();
  }

  return {
    herkunft,
    summary,
    model,
    promptVersion: MANUFACTURER_PROMPT_VERSION,
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
      `Gemini manufacturer JSON parse failed: ${e.message} — raw: ${String(raw).slice(0, 200)}`,
    );
  }
}

module.exports = {
  MANUFACTURER_PROMPT_VERSION,
  snapshotFromHersteller,
  isEvaluable,
  callGeminiManufacturer,
};
