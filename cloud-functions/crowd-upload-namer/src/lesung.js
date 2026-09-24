'use strict';

/**
 * Die Lesung selbst: Prompt, Schema, Gemini-Aufruf mit Wiederholung und die
 * Auswertung zum Dokument-Patch. Getrennt vom Trigger, damit das Nachlese-
 * Skript für betroffene Einreichungen EXAKT dieselbe Logik nutzt.
 *
 * Vorfall 22.–24.09.2026: Vertex lehnte seit dem 22.09. ~13 Uhr UTC einen Teil
 * der Anfragen mit `thinkingConfig: { thinkingBudget: 0 }` ab — 400 „Thinking
 * budget is not supported for this model" (gemessen: 4 von 15 Anfragen mit
 * denselben Bildern; offenbar eine schrittweise ausgerollte Modellversion).
 * Jeder Fehler wurde als „kein Name, kein Preis, kein Hersteller" gespeichert,
 * ohne zweiten Versuch: 47 Einreichungen in drei Tagen, obwohl die Fotos
 * einwandfrei lesbar waren. Gemini-3-Modelle steuern das Denken über
 * `thinkingLevel`; mit 'LOW' liefen 15 von 15 Anfragen durch, mit identischem
 * Ergebnis (die Morgenrunde der Review-Konsole nutzt dieselbe Einstellung).
 */

// Views that carry the product name best: front first, price tag as a
// cross-check (shop shelf labels usually print the name too). Seit 05.09.2026
// zusätzlich das Hersteller-Foto: Preis (Preisschild) und Hersteller sind die
// Vergleichsdaten der Doppel-Regel der Review-Konsole (review-console/
// src/duplicatePolicy.js) — „andere Daten" = Preis, Hersteller oder Markt.
const NAME_STEPS = ['front', 'preis', 'hersteller'];
// Beschriftung der Bilder im Prompt — ohne sie weiß das Modell nicht, WELCHES
// Bild welche Ansicht ist, und ordnet Preis/Hersteller falsch zu.
const STEP_LABEL = { front: 'Bild „Produktvorderseite"', preis: 'Bild „Preis"', hersteller: 'Bild „Herstellerangabe"' };
// Below this we keep the OCR as a suggestion but don't auto-fill the name.
const MIN_CONFIDENCE = 0.45;

/**
 * Das Schema. `Type` kommt aus @google/genai und wird hereingereicht, damit
 * dieses Modul ohne die Bibliothek testbar ist.
 */
function responseSchema(Type) {
  return {
    type: Type.OBJECT,
    properties: {
      productName: { type: Type.STRING },
      confidence: { type: Type.NUMBER },
      // Preis vom Preisschild ODER vom Kassenbon in Cent (1,99 € → 199); 0 = nicht lesbar.
      priceCents: { type: Type.INTEGER },
      // Hersteller/Inverkehrbringer laut Verpackung (Firma, ohne Adresse); leer = nicht lesbar.
      manufacturer: { type: Type.STRING },
      // Was das „Preis"-Bild tatsächlich zeigt. Gemessen an 40 echten Einreichungen
      // (06.09.2026): 50 % Produktfoto ohne Preis, 30 % Preisschild, 17,5 % Kassenbon.
      priceImageKind: { type: Type.STRING },
      // Nur wenn das Preis-Bild ein KASSENBON ist: der Bon-Kopf. Damit hat die
      // Einreichung eine harte Ortsangabe (Filialadresse) — genauer als jedes
      // GPS-Raster — und der Markt lässt sich gegen die App-Auswahl prüfen.
      receiptMerchant: { type: Type.STRING },
      receiptStreet: { type: Type.STRING },
      receiptZip: { type: Type.STRING },
      receiptCity: { type: Type.STRING },
      receiptDate: { type: Type.STRING },
    },
    required: ['productName', 'confidence', 'priceCents', 'manufacturer', 'priceImageKind', 'receiptMerchant', 'receiptStreet', 'receiptZip', 'receiptCity', 'receiptDate'],
  };
}

const PROMPT = [
  'Du siehst ein oder zwei Fotos eines Supermarkt-Produkts (Verpackungs-Vorderseite, evtl. ein Preisschild aus dem Regal).',
  'Extrahiere den PRODUKTNAMEN exakt so, wie ihn ein Kunde nennen würde: Marke + Produktbezeichnung + ggf. Sorte/Variante.',
  'Regeln:',
  '- KEINE Mengenangaben (g, ml, Stück), KEINE Preise, KEINE Werbe-Claims ("NEU", "Aktion", "%").',
  '- Marke und Bezeichnung zusammen, z.B. "Gut & Günstig Vollmilch 3,5%".',
  '- Wenn der Name nicht zuverlässig lesbar ist: leerer String und confidence 0.',
  '',
  'PREIS: der Preis des Produkts in Cent als Ganzzahl (1,99 € → 199) — vom Preisschild ODER von der Bon-Zeile dieses Produkts; Grundpreise (€/kg, €/l) NICHT verwenden; nicht lesbar → 0.',
  'HERSTELLER: der Inverkehrbringer laut Verpackung als Firmenname ohne Adresse (z.B. "Molkerei Weihenstephan GmbH"); nicht lesbar → leerer String.',
  '',
  'priceImageKind — was zeigt das Bild „Preis" wirklich? Wähle immer die beste Kategorie:',
  '  "preisschild" (Regal-Etikett), "kassenbon" (Kassenzettel, auch schräg oder teilweise),',
  '  "beides", "produktfoto" (nur Verpackung, kein Preis), "sonstiges", "fehlt" (kein Preis-Bild dabei).',
  'Ist es ein KASSENBON (oder "beides"), lies aus dem Bon-KOPF: receiptMerchant (Filialname),',
  'receiptStreet (Straße + Hausnummer), receiptZip (Postleitzahl), receiptCity (Ort),',
  'receiptDate (Kaufdatum ISO YYYY-MM-DD). Nicht lesbar oder kein Bon → leerer String.',
  'Nimm die FILIALADRESSE aus dem Bon-Kopf, nicht den Firmensitz aus dem Fußbereich.',
  '',
  'Antworte als JSON gemäß Schema; confidence zwischen 0 und 1. Nichts erfinden.',
].join('\n');

/** Zeitgrenze je Anfrage. Ohne sie hing beim Nachlesen eine Anfrage > 5 min. */
const ANFRAGE_TIMEOUT_MS = 60 * 1000;

/**
 * Gemini-Konfiguration. `thinkingLevel` statt `thinkingBudget` (siehe oben);
 * die Denk-Token zählen zum Ausgabelimit — mit 'LOW' waren es 0–98, das alte
 * Limit von 512 wäre knapp, darum 4096.
 */
function geminiKonfig(Type, { ohneDenken = false } = {}) {
  return {
    responseMimeType: 'application/json',
    responseSchema: responseSchema(Type),
    temperature: 0.1,
    ...(ohneDenken ? {} : { thinkingConfig: { thinkingLevel: 'LOW' } }),
    maxOutputTokens: 4096,
    httpOptions: { timeout: ANFRAGE_TIMEOUT_MS },
  };
}

/** Lehnt das Modell die Denk-Einstellung selbst ab (wie am 22.09. mit thinkingBudget)? */
function istDenkEinstellungAbgelehnt(err) {
  return /thinking/i.test(String(err && err.message)) && /\b400\b|INVALID_ARGUMENT/.test(`${err && err.message} ${err && err.status}`);
}

function extractText(response) {
  let rawText = null;
  try {
    rawText = response && response.text;
  } catch {
    rawText = null;
  }
  if (!rawText) {
    const parts = response && response.candidates && response.candidates[0] &&
      response.candidates[0].content && response.candidates[0].content.parts;
    if (Array.isArray(parts)) {
      rawText = parts.map((p) => (p && p.text) || '').filter(Boolean).join('');
    }
  }
  return rawText;
}

/**
 * Lohnt ein zweiter Versuch? Überlastung, Serverfehler, Netz, leere oder
 * abgeschnittene Antwort — ja. Ein inhaltlicher 400 (falsches Argument,
 * Bild ungültig) — nein, der käme beim nächsten Mal genauso.
 */
function istVoruebergehend(err) {
  const text = `${err && err.name} ${err && err.message} ${err && err.status} ${err && err.code}`;
  if (err instanceof SyntaxError) return true; // abgeschnittenes JSON
  return /\b(429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|INTERNAL|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|empty gemini response|abort|timed? ?out/i.test(text);
}

const schlafenStandard = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ruft Gemini auf und gibt das geparste JSON zurück. Vorübergehende Fehler
 * werden wiederholt (Standard: 4 Versuche, Pausen 3 s, 10 s, 20 s) — vorher
 * endete jeder Aussetzer dauerhaft als „kein Name". Die Pausen sind so lang,
 * weil Vertex bei Überlastung (429) mit kurzen Abständen beim Nachlesen der
 * 44 betroffenen Einreichungen dreimal hintereinander ablehnte. Schlimmster
 * Fall 4 × 60 s + 33 s < 300 s Funktionszeit. Wirft den letzten Fehler, mit
 * `versuche` am Fehlerobjekt.
 */
async function leseMitWiederholung({ ai, model, parts, Type, versuche = 4, pausenMs = [3000, 10000, 20000], schlafen = schlafenStandard }) {
  let letzter = null;
  // Lehnt Google künftig auch die neue Denk-Einstellung ab, versucht der
  // nächste Durchgang es ohne — statt wieder alles als „kein Name" zu speichern.
  let ohneDenken = false;
  for (let v = 1; v <= versuche; v++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: geminiKonfig(Type, { ohneDenken }),
      });
      const rawText = extractText(response);
      if (!rawText || !rawText.trim()) throw new Error('empty gemini response');
      const parsed = JSON.parse(rawText);
      return { parsed, versuche: v };
    } catch (e) {
      letzter = e instanceof Error ? e : new Error(String(e));
      letzter.versuche = v;
      if (v === versuche) break;
      if (!ohneDenken && istDenkEinstellungAbgelehnt(e)) {
        ohneDenken = true;
        continue;
      }
      if (!istVoruebergehend(e)) break;
      await schlafen(pausenMs[Math.min(v - 1, pausenMs.length - 1)]);
    }
  }
  throw letzter;
}

/** Rohantwort → bereinigte Werte. `hatPreisBild` steuert den Rückfall für priceImageKind. */
function auswerten(parsed, { hatPreisBild }) {
  const name = String(parsed.productName || '').trim();
  const confidence = Number(parsed.confidence) || 0;
  const pc = Number(parsed.priceCents);
  const priceCents = Number.isFinite(pc) && pc > 0 && pc < 100000 ? Math.round(pc) : null;
  const manufacturer = String(parsed.manufacturer || '').trim().slice(0, 120) || null;
  const KINDS = ['preisschild', 'kassenbon', 'beides', 'produktfoto', 'sonstiges', 'fehlt'];
  const kind = String(parsed.priceImageKind || '').trim().toLowerCase();
  const priceImageKind = KINDS.includes(kind) ? kind : (hatPreisBild ? 'unklar' : 'fehlt');
  let receipt = null;
  if (priceImageKind === 'kassenbon' || priceImageKind === 'beides') {
    const zip = String(parsed.receiptZip || '').replace(/\D/g, '');
    const city = String(parsed.receiptCity || '').trim().slice(0, 80);
    const street = String(parsed.receiptStreet || '').trim().slice(0, 120);
    const merchantName = String(parsed.receiptMerchant || '').trim().slice(0, 80);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.receiptDate || '')) ? parsed.receiptDate : null;
    if (zip || city || street || merchantName) {
      receipt = {
        merchant: merchantName || null,
        street: street || null,
        zip: /^\d{4,5}$/.test(zip) ? zip : null,
        city: city || null,
        bonDate: date,
        source: 'preis-foto',
      };
      receipt.complete = Boolean(receipt.zip && receipt.city);
    }
  }
  return { name, confidence, priceCents, manufacturer, priceImageKind, receipt };
}

/**
 * Die Felder fürs Dokument (ohne Zeitstempel — den setzt der Aufrufer).
 * Nutzereingabe gewinnt immer: `productName` nur, wenn der Nutzer nichts
 * eingetragen hat UND die Lesung sicher genug ist.
 */
function patchFelder(ergebnis, { userName }) {
  const { name, confidence, priceCents, manufacturer, priceImageKind, receipt } = ergebnis;
  const patch = {
    productNameOcr: name || null,
    productNameOcrConfidence: confidence,
    // Vergleichsdaten der Doppel-Regel (Review-Konsole). Nur OCR-Vorschläge,
    // nie Nutzer-Eingaben überschreibend; fehlend = null (fail-closed dort).
    priceOcr: priceCents != null ? { priceCents, source: priceImageKind === 'kassenbon' || priceImageKind === 'beides' ? 'bon' : 'preisschild' } : null,
    manufacturerOcr: manufacturer ? { name: manufacturer, source: 'hersteller' } : null,
    // Was das Preis-Bild zeigt + (falls Bon) die Filialadresse. Gibt der
    // Einreichung eine harte Ortsangabe und erlaubt den Abgleich des in der
    // App gewählten Marktes gegen den Bon.
    priceImageKind,
    priceReceipt: receipt,
  };
  const nutzer = (userName == null ? '' : String(userName)).trim();
  if (!nutzer && name && confidence >= MIN_CONFIDENCE) patch.productName = name;
  return patch;
}

module.exports = {
  ANFRAGE_TIMEOUT_MS,
  NAME_STEPS,
  STEP_LABEL,
  MIN_CONFIDENCE,
  PROMPT,
  responseSchema,
  geminiKonfig,
  extractText,
  istVoruebergehend,
  istDenkEinstellungAbgelehnt,
  leseMitWiederholung,
  auswerten,
  patchFelder,
};
