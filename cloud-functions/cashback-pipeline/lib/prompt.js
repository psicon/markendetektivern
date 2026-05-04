/**
 * Gemini system prompt for DACH receipt OCR.
 * Ported 1:1 from tools/cashback-ocr-validation/prompts.py (v1.0).
 *
 * VERSION HISTORY
 * v1.0 (2026-05-03) — initial.
 * v1.1 (2026-05-04) — Gemini schema fix: nullability via `nullable: true`
 *   instead of `type: [..., 'null']` which Gemini's schema validator
 *   rejected (Proto field is not repeating).
 */

'use strict';

const VERSION = 'v1.1';

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

// Gemini structured-output schema. Note: Gemini does NOT accept
// `type: ['string', 'null']` (JSON-Schema syntax). Optional fields
// must use `nullable: true` and a single concrete type.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    isReceipt: { type: 'boolean' },
    notReceiptReason: { type: 'string', nullable: true },
    merchant: { type: 'string', nullable: true },
    merchantSubtitle: { type: 'string', nullable: true },
    bonDate: { type: 'string', nullable: true },
    bonTime: { type: 'string', nullable: true },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qty: { type: 'number' },
          priceCents: { type: 'integer' },
          unitPriceCents: { type: 'integer', nullable: true },
          category: { type: 'string', nullable: true },
        },
        required: ['name', 'priceCents'],
      },
    },
    subtotalCents: { type: 'integer', nullable: true },
    totalCents: { type: 'integer', nullable: true },
    paymentMethod: { type: 'string', nullable: true },
    suspiciousManipulation: { type: 'boolean' },
    manipulationNotes: { type: 'string', nullable: true },
    ocrConfidence: { type: 'number', nullable: true },
  },
  required: ['isReceipt', 'items'],
};

module.exports = { VERSION, SYSTEM_PROMPT, USER_PROMPT, RESPONSE_SCHEMA };
