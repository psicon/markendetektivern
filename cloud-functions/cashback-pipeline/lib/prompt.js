/**
 * Gemini system prompt for DACH receipt OCR.
 * Ported 1:1 from tools/cashback-ocr-validation/prompts.py (v1.0).
 *
 * VERSION HISTORY
 * v1.0 (2026-05-03) — initial.
 * v1.1 (2026-05-04) — Gemini schema fix: nullability via `nullable: true`
 *   instead of `type: [..., 'null']` which Gemini's schema validator
 *   rejected (Proto field is not repeating).
 * v1.3 (2026-06-07) — Name↔Preis-Zuordnung gehärtet (Bon-Preis-Mismatch,
 *   User-Report REWE/LIDL): viele Thermo-Bons drucken die Preis-Spalte versetzt
 *   (Preis steht ~eine Zeile tiefer als der Name). Gemini paarte nach
 *   Pixel-Höhe statt der Reihe nach → Preise dem falschen Artikel zugeordnet
 *   (z. B. REWE CHORIZO/SERRANO vertauscht, LIDL Pfand gedroppt + Zucchini-
 *   Preisvorteil ignoriert). Neue „Zeilen-/Preis-Zuordnung"-Sektion +
 *   per-Item `raw`-Zeile. An 2 echten Bons validiert (REWE 8/8, LIDL 7/11→11/11).
 */

'use strict';

const VERSION = 'v1.3';

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
6. **Items**: nur tatsächliche Produkt-Zeilen, keine Rabatt-/Gesamt-/
   Steuer-Zeilen. Mehrfachzeilen pro Produkt einmal mit finalem Preis
   nach Rabatt aufnehmen. (Pfand-Zeilen als eigene Items mit
   category='Pfand' aufnehmen — die Zuordnung weiter unten gilt auch
   für sie.) Beachte zwingend die Sektion „Zeilen-/Preis-Zuordnung".
7. **Merchant** = Filialname wie er ganz oben auf dem Bon steht.
8. **Total** = der ENDBETRAG nach Rabatten.
9. Wenn das Bild kein Kassenbon ist, setze isReceipt=false und gib
   einen Grund in notReceiptReason.
10. Bei Manipulationsverdacht setze suspiciousManipulation=true und
    beschreibe in manipulationNotes.
11. **bonCountry**: setze 'DE' / 'AT' / 'CH' wenn das Land erkennbar
    ist. Starke Signale (in dieser Priorität):
    - UID-Nr / Steuer-ID Präfix: 'DE...' = DE, 'ATU...' = AT, 'CHE-...' = CH
    - Postleitzahl: 5-stellig (DE), 4-stellig (AT/CH)
    - Adresse mit Bundesland-Hinweis
    - Währung CHF = CH (sonst EUR)
    Wenn unklar: null lassen.

## Zeilen-/Preis-Zuordnung (KRITISCH — häufigste Fehlerquelle)

A. **Lies den Bon strikt Zeile für Zeile von OBEN nach UNTEN und gib die
   Items in GENAU dieser Reihenfolge zurück.** Niemals sortieren, niemals
   umgruppieren, niemals zwei benachbarte Artikel vertauschen.
B. **Ordne Preise der REIHE NACH zu, NICHT nach pixel-genauer horizontaler
   Höhe.** Viele Thermo-Bons drucken die Preis-Spalte vertikal VERSETZT — der
   Preis eines Artikels steht oft eine halbe bis ganze Zeile TIEFER als sein
   Name (die 'EUR'-Kopfzeile sitzt dann auf Höhe des 1. Artikelnamens, der
   1. Preis auf Höhe des 2. Namens usw., der letzte Preis steht UNTER dem
   letzten Namen). Verlasse dich daher NIE auf gleiche Pixel-Höhe: der n-te
   Preis der Preis-Spalte gehört zum n-ten Artikel (1.→1., 2.→2., …). Anzahl
   Produkt-/Pfand-Preise = Anzahl Items.
C. **Preisvorteil/Rabatt-Zeilen** (z. B. 'Preisvorteil -0,17', 'Rabatt')
   gehören zum unmittelbar DAVOR stehenden Artikel und verringern dessen
   Preis — NICHT als eigenen Artikel ausgeben, sondern vom vorherigen Artikel
   abziehen und dessen finalen Preis ausgeben.
D. **Gewichtsware** (z. B. 'Zucchini  0,418 kg x 1,39'): der Preis ist
   Gewicht × Kilopreis (ggf. minus Preisvorteil).
E. **Selbstkontrolle:** Σ aller item.priceCents (inkl. Pfand) muss dem
   Endbetrag (totalCents) entsprechen. Stimmt es nicht, hast du sehr
   wahrscheinlich wegen des Spalten-Versatzes Preise falsch zugeordnet —
   korrigiere die ZUORDNUNG (verschiebe die Preis-Spalte um eine Zeile),
   erfinde KEINE Werte, bis die Summe passt.
F. **raw** pro Item: gib die wörtliche Bon-Zeile an (Name + Preis genau wie
   gedruckt), damit Name und Preis garantiert aus DERSELBEN Zeile stammen.`;

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
          // Verbatim receipt line (name + price as printed) — anchors the
          // name↔price pair to the SAME physical row (v1.3, price-mismatch fix).
          raw: { type: 'string', nullable: true },
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
    bonCountry: { type: 'string', nullable: true },
  },
  required: ['isReceipt', 'items'],
};

module.exports = { VERSION, SYSTEM_PROMPT, USER_PROMPT, RESPONSE_SCHEMA };
