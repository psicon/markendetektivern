/**
 * LLM-Extractor — Herzstück des Scrapers.
 *
 * Nimmt HTML einer beliebigen Produkt-Seite (Discounter / Hersteller /
 * Codecheck / etc.) und extrahiert die strukturierten Daten per KI. Damit
 * brauchen wir KEINEN site-spezifischen Parser — eine Pipeline für ALLE Sites.
 *
 * Output-Schema: reweapify-kompatibel (attr_ingredientStatement,
 * nutr_*_val + _unit), damit der Backfill (CF2) das direkt
 * konsumieren kann.
 *
 * ═══ Modell (seit 02.10.2026: Gemini über Vertex, vorher Claude Haiku) ═══
 * Bis 01.10.2026 lief das Auslesen über Claude (Anthropic-API). Ab dem
 * 18.08.2026 war das Anthropic-Guthaben aufgebraucht: jede Extraktion endete
 * mit 400 „credit balance is too low“, wurde aber als „nichts gefunden“
 * gemeldet (return null). Folge: scrapeEan meldete „all_failed“, der
 * external-misses-processor schloss jede EAN dauerhaft als „no-data“ ab —
 * rund 5.400 EANs in sechs Wochen, während Serper/Apify weiter bezahlt wurden.
 *
 * Jetzt: gemini-3.5-flash über Vertex (Projekt-Billing, Startup-Guthaben),
 * Standort `eu` (für 3.5-flash zugesagt, siehe cashback-pipeline/lib/
 * geminiModelle.js), Denken über `thinkingLevel` (CLAUDE.md: nie
 * `thinkingBudget`). Rückschalter ohne Codeänderung: Umgebungsvariablen
 * SCRAPER_GEMINI_MODEL / SCRAPER_GEMINI_LOCATION.
 *
 * ═══ Fehlervertrag (die eigentliche Reparatur) ═══
 *   • KI hält die Seite für eine Produktseite (Sicherheit ≥ 0,5) → Objekt.
 *     Ob darin etwas Verwertbares steht, entscheidet der Aufrufer
 *     (seitenDaten.hatVerwertbareDaten) — erst er kennt den belegten Namen.
 *   • Seite ist keine Produktseite / Modell lehnt ab → null (inhaltliche Aussage)
 *   • KI nicht erreichbar / Kontingent / Zeitlimit / kaputtes JSON nach
 *     Wiederholungen → wirft ExtractUnavailableError (code
 *     'extract_unavailable'). Ein Infrastrukturfehler ist NIE eine Aussage
 *     über das Produkt — die Aufrufer dürfen daraus kein „keine Daten“ machen.
 *
 * ═══ Kosten ═══
 * Jede KI-Antwort — auch null, Ablehnung, kaputtes JSON oder Fehler — steht
 * als eine Logzeile `{"evt":"produktsuche_kosten", …}` im Log. Bis 04.10.
 * wurden nur erfolgreiche Aufrufe geloggt; gut die Hälfte der bezahlten
 * Aufrufe blieb unsichtbar.
 */

const { GoogleGenAI } = require('@google/genai');

const { ExtractUnavailableError } = require('./fehler');

const MODEL = process.env.SCRAPER_GEMINI_MODEL || 'gemini-3.5-flash';
const LOCATION = process.env.SCRAPER_GEMINI_LOCATION || 'eu';
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'markendetektive-895f7';
// Gemessen 02.10.2026 (eu, LOW): 1–11 s je Seite. 45 s lässt Luft. Der
// schlimmste Fall EINER Seite (3 Versuche + Pausen ≈ 150 s, davor bis 135 s
// Abruf mit Apify-Rückfall) passt NICHT in die Frist von scrapeEan (190 s,
// geprüft nur vor jedem neuen Kandidaten) und auch nicht sicher unter den
// Abbruch des Prozessors nach 240 s. Bricht der Prozessor ab, läuft
// scrapeEan weiter und speichert einen Fund trotzdem; der Prozessor prüft
// deshalb vor der nächsten bezahlten Suche, ob inzwischen ein Fund vorliegt
// (external-misses-processor, 'ok_nach_zeitlimit'). Gemessen seit 01.10.:
// 1 von 393 Aufrufen über 240 s.
const CALL_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 3;
// Inhaltliche Ablehnung durch das Modell: Wiederholen bringt nichts, und es
// ist kein Ausfall — die Seite gilt als „nichts Verwertbares“.
const BLOCKIERT = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY']);

let _client = null;
function getClient() {
  if (!_client) {
    _client = new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });
  }
  return _client;
}

/** Ein Aufruf mit hartem Zeitlimit (Muster aus cashback-pipeline/lib/ocr.js). */
async function callGemini({ systemInstruction, userText, model }) {
  const abort = new AbortController();
  const request = getClient().models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      // Denk-Token zählen zu maxOutputTokens — großzügig, damit die Antwort
      // nicht abgeschnitten wird (CLAUDE.md: 512 war beim Namer zu knapp).
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel: 'LOW' },
      abortSignal: abort.signal,
    },
  });
  request.catch(() => {});
  let timer = null;
  try {
    return await Promise.race([
      request,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          const err = new Error(`Gemini timeout after ${CALL_TIMEOUT_MS} ms`);
          err.code = 'timeout';
          reject(err);
        }, CALL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Antworttext → Objekt. Wirft bei leerer/abgeschnittener/kaputter Antwort. */
function parseResponse(resp) {
  const finishReason = resp?.candidates?.[0]?.finishReason ?? null;
  const text = resp?.text;
  if (!text) {
    const err = new Error(`Gemini ohne Text (finishReason=${finishReason})`);
    err.code = BLOCKIERT.has(finishReason) ? 'blocked' : 'empty';
    throw err;
  }
  let jsonText = text.trim();
  const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) jsonText = fence[1].trim();
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    const err = new Error(`JSON parse failed (finishReason=${finishReason}): ${e?.message}`);
    err.code = 'json';
    throw err;
  }
}

// Keywords die "hier kommt Zutaten/Nährwerte/Preis/Hersteller" markieren.
// SPEZIFISCH genug damit Navi-Treffer nicht matchen.
const RELEVANCE_KEYWORDS = [
  'zutaten:',
  'inhaltsstoffe:',
  'durchschnittliche nährwerte',
  'durchschnittliche naehrwerte',
  'nährwerte pro',
  'pro 100 g',
  'pro 100g',
  'pro 100 ml',
  'pro 100ml',
  'brennwert',
  'kj/',
  'kcal',
  'allergen',
  'nutri-score',
  'nutriscore',
  'eco-score',
  'ecoscore',
  'herkunftsland',
  'hersteller',
  'produzent',
  'eur/',
  '€/',
  ' € ',
  ' eur ',
];

/** Strippt HTML auf Text-Content + schneidet auf die relevante
 *  Sektion (Zutaten/Nährwerte) zu.
 *
 *  Strategie:
 *   1. Script/Style/SVG/Comments/iframes raus.
 *   2. Alle Tags raus → reiner Text.
 *   3. Whitespace normalisieren.
 *   4. Wenn Text > MAX: Position des ersten Relevanz-Keywords finden,
 *      Window ±EXTEND_BEFORE / ±EXTEND_AFTER drumherum schneiden.
 *      Wenn KEIN Keyword: nimm die letzten MAX Chars (Produkt-Detail
 *      ist meist im mittleren/unteren Teil, Header oben = Schrott).
 *
 *  Ziel: ~6k Chars (= ~1.5k Tokens) damit wir auch bei Rate-Limit
 *  10k Tokens/min mehrere Calls/min hinkriegen. */
function stripHtml(html) {
  if (!html) return '';
  let s = html;
  // <script>, <style>, <noscript>, <iframe> komplett raus
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  s = s.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  // HTML-Comments raus
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // SVG-Inhalt raus (oft seitenweise dekoratives Markup)
  s = s.replace(/<svg[\s\S]*?<\/svg>/gi, '');
  // ALLE Tags raus — die KI braucht für Text-Extraction die Struktur
  // nicht, nur den Content. Sparen massiv Tokens.
  s = s.replace(/<[^>]+>/g, ' ');
  // HTML-Entities die wichtig sind decoden
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&szlig;/gi, 'ß')
    .replace(/&auml;/gi, 'ä')
    .replace(/&ouml;/gi, 'ö')
    .replace(/&uuml;/gi, 'ü')
    .replace(/&Auml;/g, 'Ä')
    .replace(/&Ouml;/g, 'Ö')
    .replace(/&Uuml;/g, 'Ü');
  // Mehrfach-Whitespace zusammen
  s = s.replace(/\s+/g, ' ').trim();

  const MAX = 4500; // verkleinert → weniger Tokens

  if (s.length <= MAX) return s;

  // Multi-window: 1× Window um Zutaten/Nährwerte (4500 chars) + 1×
  // Window um Preis (1500 chars). Beide sind oft an unterschiedlichen
  // Stellen der Page (Preis im Header/Sidebar, Zutaten weit unten).
  const lower = s.toLowerCase();
  // ── Window 1: Zutaten/Nährwerte ─────────────────────────────
  const NUTRI_KEYWORDS = [
    'zutaten:',
    'inhaltsstoffe:',
    'durchschnittliche nährwerte',
    'durchschnittliche naehrwerte',
    'nährwerte pro',
    'pro 100 g',
    'pro 100g',
    'pro 100 ml',
    'pro 100ml',
    'brennwert',
    'kj/',
    'kcal',
    'allergen',
    'nutri-score',
    'nutriscore',
    'eco-score',
    'herkunftsland',
    'hersteller',
    'produzent',
  ];
  // ── Window 2: Preis ──────────────────────────────────────────
  const PRICE_KEYWORDS = [
    'eur/',
    '€/',
    ' € ',
    ' eur ',
    'preis pro',
    'grundpreis',
    'inhalt:',
  ];

  const findPivot = (keywords) => {
    const all = [];
    for (const kw of keywords) {
      let from = 0;
      while (true) {
        const i = lower.indexOf(kw, from);
        if (i < 0) break;
        all.push(i);
        from = i + kw.length;
      }
    }
    if (all.length === 0) return -1;
    all.sort((a, b) => a - b);
    return all[Math.floor(all.length * 0.5)];
  };

  const nutriPivot = findPivot(NUTRI_KEYWORDS);
  const pricePivot = findPivot(PRICE_KEYWORDS);

  if (nutriPivot < 0 && pricePivot < 0) {
    // Kein Keyword — letzte MAX Chars als Notlösung
    return s.slice(s.length - MAX);
  }

  // Berechne Windows. Wenn beide Pivots existieren UND eng beieinander
  // (<1500 chars Distanz) → ein großes kombiniertes Window. Sonst →
  // zwei separate Windows.
  const NUTRI_BEFORE = 500, NUTRI_AFTER = 2800;
  const PRICE_BEFORE = 200, PRICE_AFTER = 900;

  if (nutriPivot < 0) {
    // Nur Preis-Window
    const start = Math.max(0, pricePivot - PRICE_BEFORE);
    const end = Math.min(s.length, pricePivot + PRICE_AFTER);
    return s.slice(start, end);
  }
  if (pricePivot < 0) {
    // Nur Nutri-Window
    const start = Math.max(0, nutriPivot - NUTRI_BEFORE);
    const end = Math.min(s.length, nutriPivot + NUTRI_AFTER);
    return s.slice(start, end);
  }

  // Beide Pivots existieren
  const distance = Math.abs(pricePivot - nutriPivot);
  if (distance < 1500) {
    // Eng beieinander → ein erweitertes Window das beide umfasst
    const lo = Math.max(0, Math.min(nutriPivot, pricePivot) - 600);
    const hi = Math.min(s.length, Math.max(nutriPivot, pricePivot) + 3500);
    return s.slice(lo, hi);
  }

  // Zwei separate Windows
  const nutriStart = Math.max(0, nutriPivot - NUTRI_BEFORE);
  const nutriEnd = Math.min(s.length, nutriPivot + NUTRI_AFTER);
  const priceStart = Math.max(0, pricePivot - PRICE_BEFORE);
  const priceEnd = Math.min(s.length, pricePivot + PRICE_AFTER);
  // Reihenfolge im Output: Preis-Section FIRST (kürzer) + Zutaten/Nährwerte
  const priceWin = s.slice(priceStart, priceEnd);
  const nutriWin = s.slice(nutriStart, nutriEnd);
  return '[PREIS]\n' + priceWin + '\n\n[ZUTATEN/NÄHRWERTE]\n' + nutriWin;
}

const EXTRACTION_PROMPT = `Du bist ein präziser Daten-Extraktor für Lebensmittel-Produktseiten.

Aus dem folgenden HTML einer Produkt-Seite extrahiere:

1. **attr_ingredientStatement** — die Zutaten-Liste als zusammenhängender String, auf Deutsch wenn verfügbar. Allergene können UPPERCASE markiert sein, das beibehalten. Wenn keine Zutaten erkennbar → null.

2. **Nährwerte pro 100g/100ml** — wenn auf der Seite die Tabelle "Nährwerte" oder "Durchschnittliche Nährwerte" oder "Pro 100g" vorhanden ist:
   - nutr_Energie_val + nutr_Energie_unit (typisch kcal — wenn nur kJ angegeben, KEINE Umrechnung, gib kJ als unit)
   - nutr_Fett_val + nutr_Fett_unit
   - nutr_FettdavongesttigteFettsuren_val + _unit (gesättigte Fettsäuren — Feldname mit Tippfehler beibehalten, sic!)
   - nutr_Kohlenhydrate_val + _unit
   - nutr_KohlenhydratedavonZucker_val + _unit (davon Zucker)
   - nutr_Ballaststoffe_val + _unit
   - nutr_Eiwei_val + _unit (Eiweiß — Feldname OHNE ß, sic!)
   - nutr_Salz_val + _unit
   - nutr_serving_size: 100, nutr_serving_unit: "g" (oder "ml" bei Flüssigkeiten)

3. **attr_preis** — aktueller Verkaufspreis (number, EUR ohne Währungssymbol — z.B. 4.99). Auf Shop-Seiten (Globus, mytime etc.) sichtbar als "4,99 €" oder "EUR 4.99". OpenFoodFacts hat KEINEN Preis → null. Bei "ab"-Preisen ("ab 2,99 €"): den Basispreis nehmen. Bei "im Angebot": den AKTUELLEN reduzierten Preis. Wenn kein Preis erkennbar → null.

4. **attr_preisPackgroesse** — String der Packungsangabe zu der der Preis gehört (z.B. "500 g", "200 ml", "6 Stück"). Wenn nicht erkennbar → null.

5. **attr_preisPerKg** — Grundpreis pro Kilo/Liter (number, EUR) wenn auf der Seite angegeben (z.B. "9,98 € / 1 kg"). Sonst null.

6. **attr_hersteller** — Hersteller-/Produzent-Name (z.B. "De Beukelaer", "Bauer", "Globus", "Aldi"). Aus Seitentitel, "Produzent für:", "von Marke X" extrahierbar. Wenn nicht erkennbar → null.

7. **attr_packageSize** + **attr_packageUnit** — Gesamtinhalt der Packung. **STRENG**:
   - attr_packageSize MUSS ein number-Literal sein (kein String). Beispiel: 140 nicht "140" nicht "140 g".
   - attr_packageUnit MUSS string mit nur der Einheit sein, OHNE Zahl. Beispiel: "g" nicht "140 g".
   - Beispiele für richtige Antwort als JSON:
     - "140 g" → {"attr_packageSize": 140, "attr_packageUnit": "g"}
     - "1,5 L" → {"attr_packageSize": 1.5, "attr_packageUnit": "l"}
     - "6×100g" → {"attr_packageSize": 6, "attr_packageUnit": "Stück"}
   - Falsche Antwort (NICHT so):
     - {"attr_packageSize": "140 g"} ← FALSCH (string statt number, Einheit drin)
     - {"attr_packageSize": "140", "attr_packageUnit": "g"} ← FALSCH (string statt number)
   - Wenn nicht erkennbar → beide null.

8. **attr_nutri_score** — Nutri-Score (string aus {"A","B","C","D","E"}). Auf OpenFoodFacts oft sichtbar als farbige Ampel. Wenn nicht angegeben → null.

9. **attr_eco_score** — Eco-Score (string aus {"A","B","C","D","E","F"}). Hauptsächlich OpenFoodFacts. Sonst → null.

10. **attr_allergene** — Array<string> der Allergene als Großbuchstaben-Tokens (z.B. ["GLUTEN","MILCH","SOJA","EI","SCHALENFRUECHTE","SESAM","SELLERIE","SENF","FISCH","KREBSTIERE","WEICHTIERE","ERDNUSS","LUPINE","SULFITE"]). Aus "Allergene: ..." Sektion oder UPPERCASE-Markern in Zutaten extrahieren. Spuren nicht hier (siehe attr_spuren). Wenn keine → [].

11. **attr_spuren** — Array<string> der "kann enthalten" / "Spuren von" Allergene, gleiche Tokens wie attr_allergene. Wenn keine → [].

12. **attr_isVegan** — boolean. true wenn explizit "vegan" gekennzeichnet, false wenn vegan ausgeschlossen, null wenn nicht erkennbar.

13. **attr_isVegetarisch** — boolean. true wenn vegetarisch gekennzeichnet (vegan ist automatisch vegetarisch), false bei Fleisch/Fisch, null wenn nicht erkennbar.

14. **attr_isBio** — boolean. true wenn Bio-Siegel auf Page (EU-Bio, Demeter, Bioland, Naturland, Bio-Knospe, demeter etc.) ODER Produktname enthält "Bio". Sonst false. Null wenn nicht erkennbar.

15. **attr_biosiegel** — String mit konkretem Siegel-Namen wenn isBio=true (z.B. "EU-Bio", "Demeter", "Bioland", "Naturland", "Bio-Suisse"). Wenn isBio=true aber nicht spezifiziert → "Bio". Sonst null.

16. **attr_herkunftsland** — Land-Name oder ISO-Code (z.B. "Deutschland", "Italien", "DE", "IT"). Aus "Herkunft:" oder "Hergestellt in:" Sektion. Wenn nicht angegeben → null.

17. **confidence** — deine Selbst-Einschätzung 0.0-1.0, wie sicher du bist dass es eine echte Produkt-Seite ist und die Daten korrekt extrahiert wurden.

18. **produktName** — der Produktname, wie er auf der Seite steht (Marke + Bezeichnung + Menge, z.B. "Milka Alpenmilch Schokolade 100 g"), OHNE Shopnamen und ohne Zusätze wie "kaufen", "online bestellen", "bei Shop X". Steht vor dem HTML ein [Rohname aus den Seitendaten], gib GENAU diesen bereinigt zurück und erfinde nichts dazu. Den [Erwarteten Produkt-Namen] NICHT übernehmen, wenn er so nicht auf der Seite steht. Wenn nicht erkennbar → null.

19. **einzelprodukt** — boolean. true, wenn die Seite genau EIN Produkt beschreibt (Produktdetailseite). false bei Suchergebnissen, Listen, Kategorie- oder Vergleichsseiten mit mehreren Produkten. null wenn unklar.

20. **produktBildUrl** — NUR wenn im Text eine vollständige Bild-Adresse (https://…) des Produkts selbst steht (z.B. Markdown ![Bild](https://…)): exakt kopieren, nichts zusammensetzen. Sonst null.

WICHTIG:
- Returnere AUSSCHLIESSLICH ein JSON-Objekt, keine Erklärungen
- Fehlende Felder = null (NICHT undefined, NICHT 0). Bei Arrays: leeres Array []
- Wenn die Seite KEINE Produkt-Seite ist (z.B. Kategorie-Liste, 404, Captcha) → return {"confidence": 0}
- Numerische Werte als number (nicht string). Kommas durch Punkte ersetzen ("4,99" → 4.99)
- Trim Whitespace
- Booleans nur true/false/null (NICHT "ja"/"nein")

HTML:
{HTML_CONTENT}`;

// ═══ Erlaubte Felder der KI-Antwort ═══
// Genau die Felder, die EXTRACTION_PROMPT verlangt (Daten) — alles andere aus
// der Antwort wird verworfen. Bis zur Prüfrunde 04.10.2026 gingen ALLE
// Schlüssel weiter; der Writer setzte sie NACH gtin/productPath/sourceShop.
// Ein Modell, das (aus eigenem Antrieb oder durch Text auf einer Shopseite)
// productName, sourceShop oder productPath „liefert", hätte so die
// Belegprüfung umgangen, die Herkunft gefälscht ('rewe.de') oder die
// Übernahme in external_products unterdrückt.
const NAEHRWERT_NAMEN = [
  'Energie', 'Fett', 'FettdavongesttigteFettsuren', 'Kohlenhydrate',
  'KohlenhydratedavonZucker', 'Ballaststoffe', 'Eiwei', 'Salz',
];
const KI_DATENFELDER = new Set([
  'attr_ingredientStatement',
  ...NAEHRWERT_NAMEN.flatMap((n) => [`nutr_${n}_val`, `nutr_${n}_unit`]),
  'nutr_serving_size', 'nutr_serving_unit',
  'attr_preis', 'attr_preisPackgroesse', 'attr_preisPerKg',
  'attr_hersteller', 'attr_packageSize', 'attr_packageUnit',
  'attr_nutri_score', 'attr_eco_score', 'attr_allergene', 'attr_spuren',
  'attr_isVegan', 'attr_isVegetarisch', 'attr_isBio', 'attr_biosiegel', 'attr_herkunftsland',
]);

/** Nur einfache Werte: Text, endliche Zahl, Wahrheitswert, null, Liste von Texten. */
function einfacherWert(v) {
  if (v === null) return true;
  if (typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/** Datenfelder der KI-Antwort nach der Liste oben. */
function nurDatenfelder(parsed) {
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (KI_DATENFELDER.has(k) && einfacherWert(v)) out[k] = v;
  }
  return out;
}

/** Eine Logzeile je KI-Antwort (Vertrag Produktsuche, 04.10.2026).
 *  `auftrag` trennt die Kosten der Produktsuche (external-misses-processor)
 *  von denen des Katalog-Backfills, die sonst unter demselben evt stünden. */
function logKosten({ ean, model, usage, ergebnis, versuch, auftrag }) {
  console.log(JSON.stringify({
    evt: 'produktsuche_kosten',
    ean: ean ?? null,
    auftrag: auftrag ?? null,
    modell: model,
    standort: LOCATION,
    tokensEin: usage?.promptTokenCount ?? null,
    tokensAus: usage?.candidatesTokenCount ?? null,
    // Denk-Token werden wie Ausgabe-Token berechnet.
    tokensDenken: usage?.thoughtsTokenCount ?? null,
    versuch,
    ergebnis,
  }));
}

function zaehleVerbrauch(verbrauch, usage) {
  if (!verbrauch) return;
  verbrauch.kiAufrufe = (verbrauch.kiAufrufe || 0) + 1;
  verbrauch.tokensEin = (verbrauch.tokensEin || 0) + (usage?.promptTokenCount || 0);
  verbrauch.tokensAus = (verbrauch.tokensAus || 0) + (usage?.candidatesTokenCount || 0);
  verbrauch.tokensDenken = (verbrauch.tokensDenken || 0) + (usage?.thoughtsTokenCount || 0);
}

/** Extrahiert strukturierte Produkt-Daten aus HTML (oder Apify-Markdown).
 *  Returnt das geparste Objekt (Sicherheit ≥ 0,5) oder null — und WIRFT
 *  ExtractUnavailableError, wenn die KI nicht antwortet (Fehlervertrag oben).
 *
 *  @param {string} [args.ean]      nur für die Kosten-Logzeile
 *  @param {string} [args.rohName]  Name aus den Seitendaten (JSON-LD/og/title);
 *                                  die KI bereinigt ihn nur
 *  @param {object} [args.verbrauch] Zähler für Aufrufe und Token
 *  @param {string} [args.auftrag]  'produktsuche' | 'katalog' | 'einzelseite'
 *                                  (nur für die Kosten-Logzeile)
 *  Die KI-Felder für Name/Einzelprodukt/Bild kommen als _kiProduktName,
 *  _kiEinzelprodukt, _kiBildUrl zurück — übernommen werden sie erst nach der
 *  Belegprüfung (seitenDaten.ermittleIdentitaet). */
async function extractFromHtml({
  html,
  productName = null,
  modelOverride = null,
  ean = null,
  rohName = null,
  verbrauch = null,
  auftrag = null,
} = {}) {
  const stripped = stripHtml(html);
  if (stripped.length < 200) {
    // Kein/zu wenig Content — kein KI-Aufruf, keine Kosten
    return null;
  }

  const hinweise = [];
  if (productName) hinweise.push(`[Erwarteter Produkt-Name: "${productName}"]`);
  if (rohName) hinweise.push(`[Rohname aus den Seitendaten: "${rohName}"]`);
  const promptHtml = hinweise.length > 0 ? `${hinweise.join('\n')}\n\n${stripped}` : stripped;

  // EXTRACTION_PROMPT enthält "{HTML_CONTENT}" Marker am Ende —
  // statischer Teil als Systemanweisung, das HTML als Nutzer-Nachricht.
  const promptParts = EXTRACTION_PROMPT.split('{HTML_CONTENT}');
  const systemInstruction = promptParts[0];
  const dynamicSuffix = promptParts[1] || '';
  const userText = 'HTML:\n' + promptHtml + dynamicSuffix;
  const model = modelOverride || MODEL;

  let parsed = null;
  let resp = null;
  let lastErr = null;
  let versuch = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    resp = null;
    try {
      resp = await callGemini({ systemInstruction, userText, model });
      parsed = parseResponse(resp);
      versuch = attempt;
      break;
    } catch (e) {
      // Auch eine kaputte oder abgelehnte Antwort hat Token gekostet.
      const usage = resp?.usageMetadata || null;
      zaehleVerbrauch(verbrauch, usage);
      if (e?.code === 'blocked') {
        logKosten({ ean, model, usage, ergebnis: 'blockiert', versuch: attempt, auftrag });
        console.warn(`[extractor] Modell lehnt die Seite inhaltlich ab: ${e.message}`);
        return null;
      }
      logKosten({ ean, model, usage, ergebnis: e?.code === 'json' ? 'json_fehler' : 'fehler', versuch: attempt, auftrag });
      lastErr = e;
      const status = e?.status ?? e?.code;
      console.warn(
        `[extractor] Gemini Versuch ${attempt}/${MAX_ATTEMPTS} gescheitert (${status}): ${String(e?.message || e).slice(0, 200)}`,
      );
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, attempt === 1 ? 4000 : 12000));
      }
    }
  }
  if (!parsed) {
    throw new ExtractUnavailableError(
      `KI-Auslesen nicht verfügbar: ${String(lastErr?.message || lastErr).slice(0, 300)}`,
      lastErr,
    );
  }
  const usage = resp?.usageMetadata || {};
  zaehleVerbrauch(verbrauch, usage);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    // Kein Objekt (z. B. eine Liste) — inhaltlich unbrauchbar, kein Ausfall.
    logKosten({ ean, model, usage, ergebnis: 'kein_objekt', versuch, auftrag });
    return null;
  }

  // Confidence-Schwelle: < 0.5 als unbrauchbar verwerfen
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  if (confidence < 0.5) {
    logKosten({ ean, model, usage, ergebnis: 'keine_produktseite', versuch, auftrag });
    return null;
  }
  logKosten({ ean, model, usage, ergebnis: 'gelesen', versuch, auftrag });

  // Nur die Datenfelder des Prompts (KI_DATENFELDER). Die Identitätsfelder
  // gehen als _ki* zurück und erst nach der Belegprüfung ins Dokument
  // (seitenDaten.ermittleIdentitaet).
  const kiProduktName = typeof parsed.produktName === 'string' ? parsed.produktName : null;
  const kiEinzelprodukt = typeof parsed.einzelprodukt === 'boolean' ? parsed.einzelprodukt : null;
  const kiBildUrl = typeof parsed.produktBildUrl === 'string' ? parsed.produktBildUrl : null;

  return {
    ...nurDatenfelder(parsed),
    _confidence: confidence,
    _model: model,
    _tokensIn: usage.promptTokenCount ?? null,
    _tokensOut: usage.candidatesTokenCount ?? null,
    _tokensThought: usage.thoughtsTokenCount ?? 0,
    _kiProduktName: kiProduktName,
    _kiEinzelprodukt: kiEinzelprodukt,
    _kiBildUrl: kiBildUrl,
  };
}

module.exports = { extractFromHtml, stripHtml, ExtractUnavailableError };
