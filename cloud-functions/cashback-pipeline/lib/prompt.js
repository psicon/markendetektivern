/**
 * Gemini system prompt for DACH receipt OCR.
 * Ported 1:1 from tools/cashback-ocr-validation/prompts.py (v1.0).
 *
 * When iterating: bump VERSION + write a changelog line. The prompt
 * version lands on the receipt doc so we can re-process bons with
 * later prompts and compare.
 */

'use strict';

const VERSION = 'v1.0';

const SYSTEM_PROMPT = `\
Du bist ein OCR-Spezialist für deutsche Kassenbons (DACH-Raum: DE, AT,
CH). Deine Aufgabe: aus dem Foto eines Kassenbons strukturierte Daten
extrahieren.

## Regeln

1. **Antworte NUR mit gültigem JSON** — kein Fließtext, kein Markdown,
   keine Code-Fences. Das Antwortformat wird über response_schema
   erzwungen.
2. **Nichts erfinden.** Wenn ein Feld nicht lesbar ist, setze es auf
   null (für Strings) oder lass den entsprechenden Eintrag aus.
3. **Beträge immer in Cents als Integer** (z. B. €1,29 → 129).
4. **Datum immer ISO-8601** (YYYY-MM-DD).
5. **Uhrzeit als HH:MM** (24h).
6. **Items**: nur tatsächliche Produkt-Zeilen, keine Pfand-/Rabatt-/
   Gesamt-/Steuer-Zeilen. Mehrfachzeilen pro Produkt einmal mit
   finalem Preis nach Rabatt aufnehmen.
7. **Merchant** = Filialname wie er ganz oben auf dem Bon steht.
8. **Total** = der ENDBETRAG nach Rabatten.
9. Wenn das Bild kein Kassenbon ist, setze isReceipt=false und gib
   einen Grund in notReceiptReason.
10. Bei Manipulationsverdacht setze suspiciousManipulation=true und
    beschreibe in manipulationNotes.`;

const USER_PROMPT =
  'Extrahiere alle strukturierten Daten aus diesem Kassenbon-Foto gemäß dem JSON-Schema. Antworte ausschließlich mit dem JSON-Objekt.';

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    isReceipt: { type: 'boolean' },
    notReceiptReason: { type: ['string', 'null'] },
    merchant: { type: ['string', 'null'] },
    merchantSubtitle: { type: ['string', 'null'] },
    bonDate: { type: ['string', 'null'] },
    bonTime: { type: ['string', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qty: { type: 'number' },
          priceCents: { type: 'integer' },
          unitPriceCents: { type: ['integer', 'null'] },
          category: { type: ['string', 'null'] },
        },
        required: ['name', 'priceCents'],
      },
    },
    subtotalCents: { type: ['integer', 'null'] },
    totalCents: { type: ['integer', 'null'] },
    paymentMethod: { type: ['string', 'null'] },
    suspiciousManipulation: { type: 'boolean' },
    manipulationNotes: { type: ['string', 'null'] },
    ocrConfidence: { type: ['number', 'null'] },
  },
  required: ['isReceipt', 'items'],
};

module.exports = { VERSION, SYSTEM_PROMPT, USER_PROMPT, RESPONSE_SCHEMA };
