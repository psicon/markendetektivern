/**
 * Prompt + Schema der Zweitprüfung („Schiedsrichter", ClickUp 86cbfvwge).
 *
 * Baut auf dem Haupt-Prompt (lib/prompt.js) auf und ergänzt genau das, woran
 * die Mehrfach-Lesung bei den abgelehnten Bons gemessen scheiterte:
 *   • Rabatte/Gutscheine auf den GANZEN Einkauf („5% Rabatt Warenkorb",
 *     „Gutschein Netto-App") — v1.4 hat dafür kein Feld, die Lesungen schoben
 *     sie mal als Artikel ein, mal nicht (instabil, Test 14.09.2026).
 *   • Vollständigkeit: abgeschnittene Fotos (Kopf oder Summe fehlt) kann kein
 *     Modell retten; das soll die Lesung ausdrücklich sagen dürfen, statt
 *     verdeckte Ziffern zu raten.
 *
 * Seit 05.10.2026 gibt es die Zweitprüfung zu jeder Version des Haupt-Prompts
 * (Schalter `cashback_config/v1.ocrPrompt`, lib/prompt.js). index.js wählt die
 * Version der ERSTLESUNG des Bons, nicht den aktuellen Schalter — die
 * Zweitprüfung ersetzt deren Lesung und wird gegen sie geprüft (plausibel()),
 * zwei Versionen dürfen sich dabei nicht mischen.
 *
 * VERSION HISTORY
 * referee-v1 (2026-09-14) — initial (Live-Test an 13 Bons).
 * referee-v2 (2026-09-14) — ohne Grund-Hinweis und Upload-Datum, Regel H ohne
 *   ausgeschriebene Gleichung (beides lud zum Zurechtbiegen ein, Review).
 * referee-v2+v1.4 — Live-Stand, byte-gleich (__tests__/promptVersion.test.js).
 * referee-v2+v1.5 (2026-10-04) — die frühere Regel J (bonComplete) steht
 *   wortgleich als Regel 12 im Haupt-Prompt und gilt damit für jede Lesung;
 *   hier entfällt sie, die frühere Regel K heißt jetzt J. Regel G sagt
 *   zusätzlich, dass Regel 16 des Haupt-Prompts (Rabattzeilen als negative
 *   Items, Coupon-Fix 05.10.2026) hier nicht gilt — die Zweitprüfung führt
 *   solche Zeilen weiter in basketDiscounts.
 */

'use strict';

const { promptFuer, STANDARD_VERSION } = require('./prompt');

// Regeln G–I (und K) sind in beiden Fassungen wortgleich; v1.5 ergänzt G um
// einen Satz und verliert J (steht dort als Regel 12 im Haupt-Prompt).
const REGEL_G = `G. **Rabatte auf den ganzen Einkauf** (z. B. „5% Rabatt Warenkorb",
   „Gutschein Netto-App -2,00", „10 € Coupon", Mitarbeiterrabatt), die NICHT
   unmittelbar unter einem bestimmten Artikel stehen, sind KEINE Items. Trage
   jede solche Zeile einzeln in basketDiscounts ein: label = Text wie
   gedruckt, cents = Betrag als POSITIVE Zahl. Artikelbezogene
   Preisvorteile (Regel C) bleiben wie bisher am Artikel.`;
const REGEL_HI = `H. **subtotalCents** = die gedruckte Zwischensumme VOR diesen Rabatten (oft
   „SUMME" oder „Zwischensumme" oberhalb der Rabattzeilen). Nur übernehmen,
   wenn sie gedruckt ist — nicht selbst ausrechnen. basketDiscounts nur mit
   Zeilen füllen, die wörtlich auf dem Bon stehen.
I. **Zahlungszeilen** (BAR, EC-Karte, Kreditkarte, Gutschein- oder
   Geschenkkarte ALS ZAHLUNGSMITTEL, eingelöste Punkte, Rückgeld) sind weder
   Items noch basketDiscounts.`;
const NICHTS_ERZWINGEN = `**Nichts erzwingen.** Passt die Summe nicht, liefere trotzdem, was
   gedruckt ist. Unlesbare Ziffern NIE raten, damit eine Summe aufgeht.`;

const ZUSATZ = {
  'v1.4': `${REGEL_G}
${REGEL_HI}
J. **bonComplete**: true nur, wenn Marktname/Kopf, die Artikelliste bis zur
   Summe UND das Datum vollständig im Bild und lesbar sind. false, wenn der
   Bon abgeschnitten, verdeckt oder an entscheidenden Stellen unlesbar ist.
   null, wenn du es nicht beurteilen kannst.
K. ${NICHTS_ERZWINGEN}`,
  'v1.5': `${REGEL_G}
   Regel 16 gilt in der Zweitprüfung NICHT: solche Zeilen gehören nur in
   basketDiscounts, nie in items.
${REGEL_HI}
J. ${NICHTS_ERZWINGEN}`,
};

const BASKET_DISCOUNTS = {
  type: 'array',
  nullable: true,
  items: {
    type: 'object',
    properties: {
      label: { type: 'string', nullable: true },
      cents: { type: 'integer' },
    },
    required: ['cents'],
  },
};

/**
 * Bewusst OHNE Hinweis auf den Ablehngrund und OHNE Upload-Datum (Review
 * 14.09.): „das Datum lag weit vor dem Upload" plus Upload-Datum lädt das
 * Modell ein, ein Datum nahe am Upload zu „finden" — und zwei Lesungen
 * desselben Modells tun das womöglich gleich, dann gälte ein alter Bon als
 * entschieden. Ebenso lädt „Summe passte nicht" zu einer Rabattzeile ein, die
 * die Summe aufgehen lässt. Die Zweitprüfung ist eine unabhängige Lesung; die
 * Jahres-Korrektur macht der Server (plausibilizeBonDate).
 */
function bauen(basis) {
  const b = promptFuer(basis);
  return Object.freeze({
    VERSION: `referee-v2+${b.VERSION}`,
    BASIS_VERSION: b.VERSION,
    SYSTEM_PROMPT: `${b.SYSTEM_PROMPT}

## Zweitprüfung — diese Regeln haben Vorrang

${ZUSATZ[b.VERSION]}`,
    USER_PROMPT: `${b.USER_PROMPT} Dies ist eine Zweitprüfung.`,
    RESPONSE_SCHEMA: {
      ...b.RESPONSE_SCHEMA,
      properties: {
        ...b.RESPONSE_SCHEMA.properties,
        basketDiscounts: BASKET_DISCOUNTS,
        bonComplete: { type: 'boolean', nullable: true },
      },
    },
  });
}

const REFEREE_PROMPTS = Object.freeze({ 'v1.4': bauen('v1.4'), 'v1.5': bauen('v1.5') });

/**
 * Zweitprüfungs-Prompt zur Version der Erstlesung. Alles außer 'v1.5' (auch
 * Bestand v1.3, DocAI, cv-hybrid, fehlende Angabe) bekommt v1.4 — den
 * bisherigen Live-Stand.
 * @param {string|null|undefined} erstlesungVersion  ocr.promptVersion am Bon
 */
function refereePromptFuer(erstlesungVersion) {
  return REFEREE_PROMPTS[promptFuer(erstlesungVersion).VERSION];
}

module.exports = {
  ...REFEREE_PROMPTS[STANDARD_VERSION],
  REFEREE_PROMPTS,
  refereePromptFuer,
};
