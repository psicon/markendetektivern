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

/** Strippt HTML auf relevanten Content (entfernt <script>, <style>,
 *  Header/Footer/Nav Tags) damit der LLM-Prompt kleiner wird und
 *  Kosten + Latenz sinken. Pragmatische Heuristik, kein
 *  vollständiger HTML-Parser. */
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
  // Mehrfach-Whitespace zusammen
  s = s.replace(/\s+/g, ' ').trim();
  // Hard-Cap auf 40k chars — wenn HTML länger ist, schneiden wir den
  // Anfang ab (Header/Nav-Schrott). Produkt-Info ist meist im
  // mittleren/unteren Teil.
  const MAX = 40000;
  if (s.length > MAX) {
    s = s.slice(s.length - MAX);
  }
  return s;
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

3. **confidence** — deine Selbst-Einschätzung 0.0-1.0, wie sicher du bist dass es eine echte Produkt-Seite ist und die Daten korrekt extrahiert wurden.

WICHTIG:
- Returnere AUSSCHLIESSLICH ein JSON-Objekt, keine Erklärungen
- Fehlende Felder = null (NICHT undefined, NICHT 0)
- Wenn die Seite KEINE Produkt-Seite ist (z.B. Kategorie-Liste, 404, Captcha) → return {"confidence": 0}
- Numerische Werte als number (nicht string)
- Trim Whitespace

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

  const promptHtml = productName
    ? `[Erwarteter Produkt-Name: "${productName}"]\n\n${stripped}`
    : stripped;
  const prompt = EXTRACTION_PROMPT.replace('{HTML_CONTENT}', promptHtml);

  const client = getClient(apiKey);
  const model = modelOverride || 'claude-haiku-4-5';

  let resp;
  try {
    resp = await client.messages.create({
      model,
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    console.warn('[extractor] Claude API error:', e?.message || e);
    return null;
  }

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

  // Wenn nichts Verwertbares im Output → null
  const hasIngredients =
    typeof out.attr_ingredientStatement === 'string' &&
    out.attr_ingredientStatement.trim().length > 0;
  const hasNutrition =
    typeof out.nutr_Energie_val === 'number' ||
    typeof out.nutr_Fett_val === 'number' ||
    typeof out.nutr_Kohlenhydrate_val === 'number' ||
    typeof out.nutr_Eiwei_val === 'number';
  if (!hasIngredients && !hasNutrition) {
    return null;
  }

  return {
    ...out,
    _confidence: confidence,
    _model: model,
    _tokensIn: resp.usage?.input_tokens ?? null,
    _tokensOut: resp.usage?.output_tokens ?? null,
  };
}

module.exports = { extractFromHtml, stripHtml };
