/**
 * LLM-Extractor — Herzstück des Scrapers.
 *
 * Nimmt HTML einer beliebigen Produkt-Seite (Discounter / Hersteller /
 * Codecheck / etc.) und extrahiert die strukturierten Daten via
 * Claude. Damit brauchen wir KEINEN site-spezifischen Parser — eine
 * Pipeline für ALLE Sites.
 *
 * Output-Schema: reweapify-kompatibel (attr_ingredientStatement,
 * nutr_*_val + _unit), damit der Backfill (CF2) das direkt
 * konsumieren kann.
 *
 * Kosten: Claude Haiku 3.5
 *   - Input: $0.80 / M Tokens
 *   - Output: $4 / M Tokens
 *   - Typische HTML-Seite gestrippt: ~5-15k Tokens Input, ~200 Tokens
 *     Output → ~$0.005 pro Call
 *   - 7000 EANs × $0.005 = ~$35 für full-cover-Run
 *
 * API-Key wird via Functions-Config gelesen:
 *   firebase functions:config:set anthropic.api_key="sk-ant-..."
 */

const Anthropic = require('@anthropic-ai/sdk');

let _client = null;
function getClient(apiKey) {
  if (!_client) {
    _client = new Anthropic.default({ apiKey });
  }
  return _client;
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
  // ALLE Tags raus — Claude braucht für Text-Extraction die Struktur
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

WICHTIG:
- Returnere AUSSCHLIESSLICH ein JSON-Objekt, keine Erklärungen
- Fehlende Felder = null (NICHT undefined, NICHT 0). Bei Arrays: leeres Array []
- Wenn die Seite KEINE Produkt-Seite ist (z.B. Kategorie-Liste, 404, Captcha) → return {"confidence": 0}
- Numerische Werte als number (nicht string). Kommas durch Punkte ersetzen ("4,99" → 4.99)
- Trim Whitespace
- Booleans nur true/false/null (NICHT "ja"/"nein")

HTML:
{HTML_CONTENT}`;

/** Extrahiert strukturierte Produkt-Daten aus HTML.
 *  Returnt das geparste Objekt oder null wenn nichts brauchbares
 *  gefunden wurde / confidence zu niedrig. */
async function extractFromHtml({ html, apiKey, productName = null, modelOverride = null }) {
  if (!apiKey) {
    throw new Error('extractFromHtml: api key fehlt');
  }
  const stripped = stripHtml(html);
  if (stripped.length < 200) {
    // Kein/zu wenig Content
    return null;
  }

  // Prompt-Caching: der EXTRACTION_PROMPT (~2500 tokens) ist für JEDE
  // EAN identisch — wir nutzen Anthropic Prompt-Caching damit der
  // statische Teil 10× günstiger gerechnet wird. System-Prompt enthält
  // den cacheable Anweisungs-Teil, User-Message enthält nur das
  // variable HTML.
  const promptHtml = productName
    ? `[Erwarteter Produkt-Name: "${productName}"]\n\n${stripped}`
    : stripped;

  const client = getClient(apiKey);
  const model = modelOverride || 'claude-haiku-4-5';

  // EXTRACTION_PROMPT enthält "{HTML_CONTENT}" Marker am Ende —
  // wir splitten in statischen Teil (cached) + dynamischen Teil.
  const promptParts = EXTRACTION_PROMPT.split('{HTML_CONTENT}');
  const staticInstructions = promptParts[0]; // wird gecached
  const dynamicSuffix = promptParts[1] || ''; // nach dem HTML (selten was)

  const callClaude = async () =>
    await client.messages.create({
      model,
      max_tokens: 900, // optimiert — meiste Outputs sind <800 tokens
      // System-Prompt = cacheable Instructions
      system: [
        {
          type: 'text',
          text: staticInstructions,
          cache_control: { type: 'ephemeral' }, // → Anthropic Prompt-Caching
        },
      ],
      messages: [
        {
          role: 'user',
          content: 'HTML:\n' + promptHtml + dynamicSuffix,
        },
      ],
    });

  // Anthropic Rate-Limit (z.B. 10k tokens/min auf Tier 1) ist der
  // Bottleneck bei parallelen Batches. 4 retries mit exponential
  // backoff: 15s, 30s, 45s, 60s. Total max ~150sec wartezeit pro
  // Extract — die Page-Daten werden nicht verloren wenn Rate-Limit
  // gerade zuschlägt.
  let resp;
  let attempt = 0;
  const MAX_ATTEMPTS = 5; // initial + 4 retries
  while (attempt < MAX_ATTEMPTS) {
    try {
      resp = await callClaude();
      break; // success
    } catch (e) {
      attempt++;
      const status = e?.status || e?.response?.status;
      const isRetryable = status === 429 || (status >= 500 && status < 600);
      if (!isRetryable || attempt >= MAX_ATTEMPTS) {
        console.warn(
          `[extractor] Claude API error (attempt ${attempt}/${MAX_ATTEMPTS}, status=${status}):`,
          e?.message || e,
        );
        return null;
      }
      // Wait time: prefer server's retry-after header, fallback zu
      // exponential backoff: 15s, 30s, 45s, 60s
      const retryAfterHeader = Number(
        e?.headers?.['retry-after'] ||
          e?.response?.headers?.['retry-after'] ||
          0,
      );
      const backoffMs = attempt * 15000;
      const waitMs = Math.min(
        Math.max(retryAfterHeader * 1000, backoffMs),
        70000,
      );
      console.warn(
        `[extractor] Claude ${status} attempt ${attempt}, retry in ${waitMs}ms`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  if (!resp) return null;

  const text = resp?.content?.[0]?.text;
  if (!text) return null;

  // JSON aus Response parsen — manchmal wickelt Claude in ```json ... ```
  let jsonText = text.trim();
  const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) jsonText = fence[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    console.warn('[extractor] JSON parse failed:', e?.message);
    return null;
  }

  // Confidence-Schwelle: < 0.5 als unbrauchbar verwerfen
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
  if (confidence < 0.5) {
    return null;
  }

  // Cleanup: Drop confidence aus dem Output (wir loggen das separat)
  const out = { ...parsed };
  delete out.confidence;

  // Wenn nichts Verwertbares im Output → null.
  // "Verwertbar" = Zutaten ODER Nährwerte ODER Preis ODER Hersteller.
  // Preis-only-Hits (z.B. discounto.de, Aggregator-Sites) sind absolut
  // wertvoll für die Preis-Historie — nicht verwerfen nur weil Nutrition
  // fehlt. Das war 2026-05-19 die Haupt-Ursache für "extract_failed" bei
  // Pages die eigentlich Daten hatten.
  const hasIngredients =
    typeof out.attr_ingredientStatement === 'string' &&
    out.attr_ingredientStatement.trim().length > 0;
  const hasNutrition =
    typeof out.nutr_Energie_val === 'number' ||
    typeof out.nutr_Fett_val === 'number' ||
    typeof out.nutr_Kohlenhydrate_val === 'number' ||
    typeof out.nutr_Eiwei_val === 'number';
  const hasPrice = typeof out.attr_preis === 'number' && out.attr_preis > 0;
  const hasManufacturer =
    typeof out.attr_hersteller === 'string' &&
    out.attr_hersteller.trim().length > 0;
  if (!hasIngredients && !hasNutrition && !hasPrice && !hasManufacturer) {
    return null;
  }

  // Log cache-stats damit wir sehen ob Prompt-Caching greift.
  // Bei einem Cache-Hit ist cache_read_input_tokens > 0 — der Großteil
  // des statischen System-Prompts wird dann 10× günstiger gerechnet.
  if (resp.usage?.cache_read_input_tokens) {
    console.log(
      `[extractor] cache HIT: read=${resp.usage.cache_read_input_tokens}, ` +
        `creation=${resp.usage.cache_creation_input_tokens || 0}, ` +
        `input=${resp.usage.input_tokens}, output=${resp.usage.output_tokens}`,
    );
  } else if (resp.usage?.cache_creation_input_tokens) {
    console.log(
      `[extractor] cache CREATED: ${resp.usage.cache_creation_input_tokens} tokens, ` +
        `input=${resp.usage.input_tokens}, output=${resp.usage.output_tokens}`,
    );
  }

  return {
    ...out,
    _confidence: confidence,
    _model: model,
    _tokensIn: resp.usage?.input_tokens ?? null,
    _tokensOut: resp.usage?.output_tokens ?? null,
    _tokensCacheRead: resp.usage?.cache_read_input_tokens ?? 0,
    _tokensCacheCreation: resp.usage?.cache_creation_input_tokens ?? 0,
  };
}

module.exports = { extractFromHtml, stripHtml };
