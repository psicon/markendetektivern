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
 * v1.4 (2026-09-05) — Filialadresse strukturiert (`storeAddress` {street, zip,
 *   city}). Bisher kam der Bon-Ort nur aus der IP-Journey (61–377 km daneben);
 *   die Anschrift steht aber auf fast jedem Bon-Kopf. `merchantSubtitle` bleibt
 *   als wörtliche Zeile erhalten (Bestand + deterministischer Fallback-Parser
 *   in lib/storeAddress.js). Items/Preise/Datum unverändert.
 * v1.5 (2026-10-04) — Belegart (`belegart`: kassenbon | app_kassenbon |
 *   online_bestellung | sonstiges), `bestellnummer` und `bonComplete`
 *   (Entscheidung Patrick 04.10.: nur Kassenbons; App-Kassenbons nach Einkauf
 *   im Laden zählen; Online-Bestellungen nur bei unseren Märkten). Bei einer
 *   Online-Bestellung KEINE Anschrift in merchantSubtitle/storeAddress — dort
 *   stand bis v1.4 die Lieferanschrift des Kunden als „Filiale"
 *   (bon_mtu6wj0anmcck4, mit Namen). Regel 12 (bonComplete) stand bisher nur
 *   in der Zweitprüfung (Regel J) und gilt jetzt für jede Lesung; vorerst nur
 *   gespeichert und gemessen, ohne Wirkung.
 *   Gemessen 04.10. an 18 echten Bons (je eine Lesung v1.4 und v1.5): Laden-
 *   und App-Bons gleich gut (Summe 11/11, Abgleich 10/11 bei beiden, Artikel-
 *   folge wie gespeichert 9/11 statt 7/11), kein Laden-/App-Bon als Online-
 *   Bestellung erkannt, 7/7 Online-Belege erkannt, 0 Anschriften. Abweichung:
 *   zwei UNVOLLSTÄNDIGE Online-Rechnungen (Seite 1 von 4, keine Summe im Bild)
 *   liefern jetzt totalCents null und bonComplete false — v1.4 hatte dort die
 *   Artikelsumme als Endbetrag eingesetzt und bezahlt. Damit das bleibt
 *   (Patrick: Online-Bestellungen unserer Märkte zählen, dm ja), setzt
 *   lib/belegart.js bei einer Online-Bestellung ohne Endbetrag die
 *   Artikelsumme ein und vermerkt `summeAusArtikeln: true`. Eingabe +~600
 *   Token je Lesung.
 *   Prüfrunde 04.10.: Regel 7 verbietet, den Händler aus Eigenmarken zu
 *   schließen — mit geschwärztem Logo las das Modell eine Picnic-Rechnung als
 *   „Edeka" (aus G&G), und das trifft im Resolver schon die Namensstufe.
 *   Prüfrunde 2 (04.10.): Mit dieser Regel lieferten 4 von 4 Lidl-Plus-
 *   Screenshots ohne Logo (Bon beginnt mit der Anschrift) `merchant: null`,
 *   v1.4 las „Lidl". Darum gilt bei einem App-Kassenbon die sichtbare
 *   Händler-App als Absender (Name in Kopf-, Tab- oder Navigationsleiste oder
 *   in einer Bon-Zeile wie „Lidl Plus Rabatt") — eine gedruckte bzw. sichtbare
 *   Angabe, kein Schluss aus Artikeln. Eine Liefer- oder Shop-App (Picnic)
 *   zeigt ihren eigenen Namen und bleibt draußen. Nachgemessen (je eine
 *   Lesung, scratchpad/r2-fix/v15c.js): 4/4 Lidl-Plus-Screenshots → „Lidl",
 *   beide Picnic-Belege (ohne Kopf, geschwärzt) → merchant null →
 *   unknown_merchant, 4 Kontroll-Bons (Kaufland, ALDI SÜD, Penny, Lidl)
 *   unverändert.
 */

'use strict';

const VERSION = 'v1.5';

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
4. **Datum immer ISO-8601** (YYYY-MM-DD). Zweistellige Jahre auf dem Bon
   (z. B. „24.08.26") sind IMMER 20YY → 2026-08-24, nie 2020. Enthält der
   Bon einen TSE-/Signatur-Block mit vollständigem Datum (z. B.
   „2026-08-24T09:55…"), hat dieses Datum Vorrang vor der Kopfzeile.
5. **Uhrzeit als HH:MM** (24h).
6. **Items**: nur tatsächliche Produkt-Zeilen, keine Rabatt-/Gesamt-/
   Steuer-Zeilen. Mehrfachzeilen pro Produkt einmal mit finalem Preis
   nach Rabatt aufnehmen. (Pfand-Zeilen als eigene Items mit
   category='Pfand' aufnehmen — die Zuordnung weiter unten gilt auch
   für sie.) Beachte zwingend die Sektion „Zeilen-/Preis-Zuordnung".
7. **Merchant** = Filialname wie er ganz oben auf dem Bon steht. Nur einen
   sichtbar GEDRUCKTEN Händler-, Filial- oder Shopnamen übernehmen (Kopf,
   Logo, Absender, Fußzeile) — NIE aus Artikel- oder Eigenmarkennamen
   ableiten (z. B. „Gut & Günstig", „ja!", „K-Classic"). Ist kein Name zu
   sehen: null.
   Bei einem App-Kassenbon (Regel 13) ist die Händler-App der Absender: steht
   ihr Name sichtbar in der App-Oberfläche (Kopf-, Tab- oder Navigations-
   leiste) oder in einer Bon-Zeile (z. B. „Lidl Plus" oder „Lidl Plus
   Rabatt"), ist merchant die Kette („Lidl"), auch wenn das Logo
   weggescrollt ist. Zeigt die App einen Liefer- oder Shopnamen (z. B.
   „Picnic"), ist das der merchant.
   **merchantSubtitle** = die wörtliche(n) Zusatzzeile(n) direkt unter dem
   Filialnamen (Anschrift, Filialnummer), unverändert wie gedruckt.
   **storeAddress** = die Anschrift der FILIALE aus dem Bon-Kopf, aufgeteilt:
   street = Straße + Hausnummer, zip = Postleitzahl (DE 5-stellig, AT/CH
   4-stellig), city = Ort OHNE Postleitzahl. Nur übernehmen, was gedruckt
   ist; fehlt ein Teil → null. Filial-, Markt-, Kassen- oder Bonnummern
   (z. B. „Filiale 6100", „Markt 8068") sind KEINE Postleitzahl. Steht im
   Fußbereich zusätzlich ein Firmensitz (GmbH-Anschrift, Impressum), zählt
   die Filialadresse oben, nicht der Firmensitz.
8. **Total** = der ENDBETRAG nach Rabatten.
9. Wenn das Bild kein Kassenbon ist, setze isReceipt=false und gib
   einen Grund in notReceiptReason. Ein App-Kassenbon und die Rechnung
   einer Bestellung mit Artikeln, Preisen und Summe sind Belege
   (isReceipt=true, Belegart siehe Regel 13).
10. Bei Manipulationsverdacht setze suspiciousManipulation=true und
    beschreibe in manipulationNotes.
11. **bonCountry**: setze 'DE' / 'AT' / 'CH' wenn das Land erkennbar
    ist. Starke Signale (in dieser Priorität):
    - UID-Nr / Steuer-ID Präfix: 'DE...' = DE, 'ATU...' = AT, 'CHE-...' = CH
    - Postleitzahl: 5-stellig (DE), 4-stellig (AT/CH)
    - Adresse mit Bundesland-Hinweis
    - Währung CHF = CH (sonst EUR)
    Wenn unklar: null lassen.
12. **bonComplete**: true nur, wenn Marktname/Kopf, die Artikelliste bis zur
    Summe UND das Datum vollständig im Bild und lesbar sind. false, wenn der
    Bon abgeschnitten, verdeckt oder an entscheidenden Stellen unlesbar ist.
    null, wenn du es nicht beurteilen kannst.

## Belegart (Pflicht)

13. **belegart** — was für ein Beleg ist das?
    - 'kassenbon': gedruckter Kassenbon aus einem Geschäft (Foto vom Papier).
    - 'app_kassenbon': digitaler Kassenbon nach einem Einkauf IM LADEN —
      Screenshot oder Ansicht aus einer Händler-App (z. B. Lidl Plus,
      Netto-App, Kaufland-App, REWE-App) oder ein per E-Mail geschickter
      Kassenbon eines Ladeneinkaufs. Erkennbar am Kassenbon-Aufbau mit
      Filiale, Kasse/Bon-Nummer und Uhrzeit.
    - 'online_bestellung': Rechnung, Lieferschein oder Bestellbestätigung
      einer Bestellung — auch Liefer- und Abholservice (z. B. Onlineshop,
      Lieferadresse, Bestellnummer, Versandkosten, Liefertermin).
    - 'sonstiges': alles andere (kein Kassenbon).
    Im Zweifel zwischen 'kassenbon' und 'app_kassenbon': 'app_kassenbon' nur,
    wenn es sichtbar eine digitale Ansicht ist.
14. **bestellnummer**: NUR bei 'online_bestellung' — die Bestell- oder
    Auftragsnummer wie gedruckt. NIE eine Kunden-, Kassen-, Bon-, Filial-
    oder Telefonnummer. Sonst null.
15. **Bei 'online_bestellung' sind storeAddress und merchantSubtitle IMMER
    null.** Namen von Kunden und Liefer- oder Rechnungsanschriften gehören in
    KEIN Feld — auch nicht in merchant, raw oder notReceiptReason. merchant
    ist bei einer Bestellung der Name des Händlers bzw. Shops, wie er
    gedruckt ist (Regel 7) — nie aus den Artikeln geschlossen.

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
    // v1.4: Filialadresse strukturiert — Ort/PLZ des Einkaufs kommen vom Bon,
    // nicht aus der IP-Journey. Alles nullable: nichts erfinden.
    storeAddress: {
      type: 'object',
      nullable: true,
      properties: {
        street: { type: 'string', nullable: true },
        zip: { type: 'string', nullable: true },
        city: { type: 'string', nullable: true },
      },
    },
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
    // v1.5: Belegart, Bestellnummer (nur Online-Bestellung), Vollständigkeit.
    belegart: {
      type: 'string',
      format: 'enum',
      enum: ['kassenbon', 'app_kassenbon', 'online_bestellung', 'sonstiges'],
      nullable: true,
    },
    bestellnummer: { type: 'string', nullable: true },
    bonComplete: { type: 'boolean', nullable: true },
  },
  required: ['isReceipt', 'items'],
};

module.exports = { VERSION, SYSTEM_PROMPT, USER_PROMPT, RESPONSE_SCHEMA };
