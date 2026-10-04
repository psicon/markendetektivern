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
 * VERSION HISTORY
 * referee-v1 (2026-09-14) — initial (Live-Test an 13 Bons).
 * referee-v2 (2026-09-14) — ohne Grund-Hinweis und Upload-Datum, Regel H ohne
 *   ausgeschriebene Gleichung (beides lud zum Zurechtbiegen ein, Review).
 * referee-v2+v1.5 (2026-10-04) — die frühere Regel J (bonComplete) steht
 *   wortgleich als Regel 12 im Haupt-Prompt und gilt damit für jede Lesung;
 *   hier entfällt sie, die frühere Regel K heißt jetzt J. Inhalt unverändert.
 */

'use strict';

const {
  VERSION: BASE_VERSION,
  SYSTEM_PROMPT: BASE_SYSTEM_PROMPT,
  USER_PROMPT: BASE_USER_PROMPT,
  RESPONSE_SCHEMA: BASE_SCHEMA,
} = require('./prompt');

const VERSION = `referee-v2+${BASE_VERSION}`;

const SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

## Zweitprüfung — diese Regeln haben Vorrang

G. **Rabatte auf den ganzen Einkauf** (z. B. „5% Rabatt Warenkorb",
   „Gutschein Netto-App -2,00", „10 € Coupon", Mitarbeiterrabatt), die NICHT
   unmittelbar unter einem bestimmten Artikel stehen, sind KEINE Items. Trage
   jede solche Zeile einzeln in basketDiscounts ein: label = Text wie
   gedruckt, cents = Betrag als POSITIVE Zahl. Artikelbezogene
   Preisvorteile (Regel C) bleiben wie bisher am Artikel.
H. **subtotalCents** = die gedruckte Zwischensumme VOR diesen Rabatten (oft
   „SUMME" oder „Zwischensumme" oberhalb der Rabattzeilen). Nur übernehmen,
   wenn sie gedruckt ist — nicht selbst ausrechnen. basketDiscounts nur mit
   Zeilen füllen, die wörtlich auf dem Bon stehen.
I. **Zahlungszeilen** (BAR, EC-Karte, Kreditkarte, Gutschein- oder
   Geschenkkarte ALS ZAHLUNGSMITTEL, eingelöste Punkte, Rückgeld) sind weder
   Items noch basketDiscounts.
J. **Nichts erzwingen.** Passt die Summe nicht, liefere trotzdem, was
   gedruckt ist. Unlesbare Ziffern NIE raten, damit eine Summe aufgeht.`;

/**
 * Bewusst OHNE Hinweis auf den Ablehngrund und OHNE Upload-Datum (Review
 * 14.09.): „das Datum lag weit vor dem Upload" plus Upload-Datum lädt das
 * Modell ein, ein Datum nahe am Upload zu „finden" — und zwei Lesungen
 * desselben Modells tun das womöglich gleich, dann gälte ein alter Bon als
 * entschieden. Ebenso lädt „Summe passte nicht" zu einer Rabattzeile ein, die
 * die Summe aufgehen lässt. Die Zweitprüfung ist eine unabhängige Lesung; die
 * Jahres-Korrektur macht der Server (plausibilizeBonDate).
 */
const USER_PROMPT = `${BASE_USER_PROMPT} Dies ist eine Zweitprüfung.`;

const RESPONSE_SCHEMA = {
  ...BASE_SCHEMA,
  properties: {
    ...BASE_SCHEMA.properties,
    basketDiscounts: {
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
    },
    bonComplete: { type: 'boolean', nullable: true },
  },
};

module.exports = { VERSION, SYSTEM_PROMPT, USER_PROMPT, RESPONSE_SCHEMA };
