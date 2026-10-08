/**
 * Gemini system prompt for DACH receipt OCR.
 * Ported 1:1 from tools/cashback-ocr-validation/prompts.py (v1.0).
 *
 * ═══ Zwei Versionen hinter einem Schalter (05.10.2026) ═══
 * `cashback_config/v1.ocrPrompt` = 'v1.4' | 'v1.5' | 'v1.6' wählt den Prompt der
 * Bon-OCR (Robust-Leiter in lib/ocr_robust.js). Fehlt der Wert oder ist er
 * ungültig, gilt v1.4 — der Deploy ändert an der Texterkennung also nichts.
 * Umschalten wirkt ohne Deploy beim nächsten Bon (loadConfig je Lauf).
 * Regeln, die beim Umschalten gelten (index.js, lib/ocr_robust.js):
 *   • Jede Lesung trägt ihre Version (`ocr.promptVersion`); ein am Bon
 *     gespeichertes OCR-Ergebnis wird mit SEINER Version weiterverwendet und
 *     nicht neu gelesen.
 *   • Ein Zwischenstand der Leiter (`ocrZwischenstand`) aus der anderen
 *     Version wird verworfen — Lesungen zweier Versionen werden nie
 *     gemeinsam bewertet.
 *   • Die Zweitprüfung liest mit der Version der Erstlesung
 *     (lib/prompt_referee.js), nicht mit dem aktuellen Schalter.
 *   • cv-hybrid (Rückweg) nutzt immer das v1.4-Schema.
 * Was v1.5 zusätzlich liefert (belegart, bestellnummer, bonComplete,
 * Rabattzeilen mit category 'Warenkorbrabatt'), fehlt in v1.4-Lesungen; alle
 * Stellen, die es auswerten (lib/belegart.js, lib/doppelBon.js, reconcile in
 * lib/ocr.js), verhalten sich ohne diese Felder wie vor v1.5.
 * v1.6 liefert dieselben Felder wie v1.5 (gleiches Schema) — jede dieser
 * Stellen gilt damit auch für v1.6. Stellen, die an der VERSION hängen statt
 * an Feldern: Zweitprüfung (lib/prompt_referee.js, eigene Fassung je
 * Version), Kopplung der Denkstufe (lib/geminiModelle.js OCR_DENKSTUFE_PROMPTE)
 * und der Punkte-Abgleich (abgleichOptionen, nur v1.6).
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
 *   Artikelsumme ein und vermerkt `summeAusArtikeln: true`. Eingabe +844
 *   Token je Lesung (gemessen 05.10. an 57 Bons, gepaart gegen v1.4; vor dem
 *   Coupon-Fix — dessen Zuschlag steht unten).
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
 *   Coupon-Fix (05.10.2026, Regel 16): Messung an 57 Bons zeigte, dass v1.5
 *   bei Coupons auf den ganzen Einkauf (Rossmann „10% COUPONAKTION", dm
 *   „Rabatt") die Artikelpreise wie gedruckt las und die Coupon-Zeile wegließ
 *   — der Abgleich scheiterte. v1.4 hatte den Coupon in Artikelpreise
 *   eingerechnet (5,6 % aller Bons in 14 Tagen tragen einen solchen Coupon).
 *   Jetzt: jede solche Zeile als eigenes Item mit NEGATIVEM Preis und
 *   category 'Warenkorbrabatt', Artikelpreise wie gedruckt. Sie zählt nicht
 *   als Artikel (countEligibleItems: Preis ≤ 0), der Abgleich rechnet sie mit
 *   und verlangt die Belegkette des Warenkorb-Rabatts (lib/ocr.js reconcile).
 *   Nachgemessen 05.10. (je 2 Flash-Lesungen v1.4 und v1.5 am selben Tag,
 *   scratchpad coupon-fix/mess.js): 15 Coupon-Bons (Rossmann, dm, Kaufland) —
 *   Abgleich ok 24/30 Lesungen (v1.4: 23/30), Bons ohne aufgehende Lesung 2
 *   (v1.4: 3), Einigung nach zwei Lesungen 10/15 (v1.4: 8/15); Markt und
 *   Datum 30/30 gleich. Beide v1.5-Fehlschläge sind die Grenze (Coupon ≥ 25 %
 *   der Zwischensumme, Kette sonst exakt), einer davon ein bezahlter dm-Bon.
 *   Eingabe +1.301 Token je Lesung gegenüber v1.4 (+457 durch Regel 16).
 * v1.6 (2026-10-08) — Nachbesserung der Variante „Denkstufe LOW + v1.5"
 *   (Auftrag Patrick 08.10.2026). Schema, Belegart, Regel 16 und alles andere
 *   wie v1.5; geändert sind nur Regeln 5, 6, 8, 16 (Verweis), C und E, neu ist
 *   Regel 17. Anlass ist Messung 2 (268 echte Bons, LOW + v1.5, Scratchpad
 *   messung2): 0 falsch angenommen, aber
 *     a) Uhrzeit in 41 von 254 Bons (16 %) genau zwei Stunden zu früh — die
 *        UTC-Zeit des TSE-Blocks („2026-09-22T17:07:59.000Z") statt der
 *        gedruckten Kassenzeit („22.09.26 19:07"); Lidl 24, Netto 13, EDEKA 3,
 *        Müller 1; 37 davon unter den Freigaben. Die Uhrzeit ist Teil des
 *        kontenübergreifenden Doppel-Schlüssels (transactionHash) und der
 *        Doppel-Regeln mit Uhrzeit — eine Kopie mit Kassenzeit und das
 *        Original mit TSE-Zeit fänden sich nicht. → Regel 5.
 *     b) 18 Freigaben mit Bewertung 'high' trugen falsche Artikelpreise
 *        (9 mit Summenabweichung innerhalb der Pfand-Toleranz, 9 mit sich
 *        aufhebenden Fehlern); häufig war ein Artikelrabatt beim Pfand oder
 *        beim falschen Artikel abgezogen (Netto: „MuelMilch 0,69 / EW-Pfand
 *        0,25 / 0.10€ Rabatt -0,10"), und gleiche Wiederholzeilen fehlten
 *        (ALDI: 2 von 7 „Sahnejoghurt"-Zeilen). → Regeln 6, A, C, E.
 *     c) dm „Eingelöste Punkte -380 = EUR -3,80" als Rabattzeile gelesen
 *        (bon_mupp8gdg5lgyyz, Abgleich unbelegt → abgelehnt; der Betrieb zog
 *        die Punkte vom Estrid-Preis ab). Punkte sind ein Zahlungsmittel;
 *        totalCents ist der Betrag VOR der Punkteverrechnung. → Regeln 8, 17.
 *        Zusätzlich im Abgleich (lib/ocr.js reconcile, nur für v1.6-Lesungen):
 *        eine negative Zeile mit „Punkte"/„Payback" zählt nicht zur Summe
 *        (lib/punkteZahlung.js).
 *   Regel 4 (Datum) ist unverändert: das TSE-Datum hat weiter Vorrang. Bei
 *   UTC-Zeitstempeln kann es für Einkäufe zwischen 0 und 2 Uhr Ortszeit einen
 *   Tag zu früh sein — bekannt, nicht Teil dieses Auftrags.
 *   NICHT gemessen (Stand 08.10.2026): v1.6 lief noch an keinem echten Bon.
 *   Ab Werk aus; wählbar nur über `cashback_config/v1.ocrPrompt === 'v1.6'`.
 */

'use strict';

/** Ohne gültigen Schalter gilt v1.4 — der Live-Prompt bis zum Umschalten. */
const STANDARD_VERSION = 'v1.4';

// ═══ v1.4 — Live-Prompt seit 05.09.2026. NICHT ÄNDERN. ═══
// Byte-gleich mit dem ausgerollten Stand (7220a7c5, processCashback vom
// 03.10.2026); __tests__/promptVersion.test.js prüft das über SHA-256.
const SYSTEM_PROMPT_V14 = `\
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
7. **Merchant** = Filialname wie er ganz oben auf dem Bon steht.
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

// ═══ v1.5 — Belegart, Bestellnummer, bonComplete, Coupon-Zeilen. ═══
const SYSTEM_PROMPT_V15 = `\
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
6. **Items**: nur tatsächliche Produkt-Zeilen, keine Gesamt-/Steuer-
   Zeilen und keine Rabatt-Zeilen — einzige Ausnahme sind Rabatte und
   Coupons auf den GANZEN Einkauf (Regel 16). Mehrfachzeilen pro Produkt
   einmal mit finalem Preis nach Rabatt aufnehmen. (Pfand-Zeilen als
   eigene Items mit category='Pfand' aufnehmen — die Zuordnung weiter
   unten gilt auch für sie.) Beachte zwingend die Sektion „Zeilen-/Preis-
   Zuordnung".
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

## Rabatte und Coupons auf den ganzen Einkauf

16. Rabatt-, Coupon- und Gutscheinzeilen, die NACH der Artikelliste stehen
    (meist unter der Zwischensumme, vor dem Endbetrag) und NICHT unmittelbar
    unter einem einzelnen Artikel — z. B. „10% COUPONAKTION", „Coupon 20%
    Bio Lebensmittel", „Rabatt", „Coupon 10€", „5€ Rabatt Warenkorb",
    „K Card XTRA Rabatt", „Mitarbeiterrabatt" — nimmst du als EIGENE Zeile
    in items auf:
    - name und raw wie gedruckt, priceCents NEGATIV (9,69 € Rabatt → -969),
      category='Warenkorbrabatt'. Jede gedruckte Rabattzeile einzeln, auch
      wenn ihr Betrag ohne Minuszeichen gedruckt ist.
    - Die Artikel darüber behalten ihren Preis WIE GEDRUCKT. Einen solchen
      Rabatt NIE auf Artikel verteilen und NIE von einem Artikelpreis
      abziehen.
    - subtotalCents = die gedruckte Zwischensumme VOR diesen Zeilen (z. B.
      „Zwischensumme", „SUMME"), nur wenn sie gedruckt ist.
    - KEINE Rabattzeilen sind: Zahlungszeilen (BAR, EC- oder Kreditkarte,
      Gutschein- oder Geschenkkarte als Zahlungsmittel, eingelöste Punkte
      oder Guthaben, Rückgeld), Storno- und Rückgabezeilen (bleiben normale
      Items, wie gedruckt) und Hinweise, die den Endbetrag nicht verringern
      („Sie haben … gespart").

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
   abziehen und dessen finalen Preis ausgeben. Das gilt nur für Zeilen direkt
   unter einem Artikel; Rabatte auf den ganzen Einkauf regelt Regel 16.
D. **Gewichtsware** (z. B. 'Zucchini  0,418 kg x 1,39'): der Preis ist
   Gewicht × Kilopreis (ggf. minus Preisvorteil).
E. **Selbstkontrolle:** Σ aller item.priceCents (inkl. Pfand und der
   negativen Rabattzeilen nach Regel 16) muss dem Endbetrag (totalCents)
   entsprechen. Stimmt es nicht, hast du sehr
   wahrscheinlich wegen des Spalten-Versatzes Preise falsch zugeordnet —
   korrigiere die ZUORDNUNG (verschiebe die Preis-Spalte um eine Zeile),
   erfinde KEINE Werte, bis die Summe passt.
F. **raw** pro Item: gib die wörtliche Bon-Zeile an (Name + Preis genau wie
   gedruckt), damit Name und Preis garantiert aus DERSELBEN Zeile stammen.`;

// ═══ v1.6 — v1.5 + Kassenzeit statt TSE-Zeit, Artikelrabatt nie aufs Pfand,
// Wiederholzeilen einzeln, eingelöste Punkte als Zahlungsmittel. ═══
// Geändert gegenüber v1.5: Regeln 5, 6, 8, 16 (Verweis auf 17), C, E; neu: 17.
const SYSTEM_PROMPT_V16 = `\
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
5. **Uhrzeit (bonTime) als HH:MM** (24h): die Kassenzeit in ORTSZEIT, wie
   sie beim Bon-Datum im Kopf oder im Fuß des Kassenbons gedruckt ist
   (z. B. „22.09.26  19:07" oder „Datum 05.10.26  Uhrzeit 16:02").
   - NIE eine Zeit aus dem TSE-/Signatur-Block (TSE-Start, TSE-Stop/-Ende,
     Signaturzeit, Zeitstempel wie „2026-09-22T17:07:59.000Z"): sie steht
     oft in UTC und liegt dann ein bis zwei Stunden zu früh.
   - Auch nicht die Uhrzeit eines angehängten Kartenzahlungsbelegs.
   - Ist sonst keine Uhrzeit gedruckt, nimm die TSE-Startzeit nur, wenn sie
     NICHT als UTC gekennzeichnet ist (kein „Z" am Ende, kein „UTC", „GMT"
     oder „+00:00"; z. B. „Start: 2026-09-30 10:13:30" → 10:13). Sonst
     bonTime=null.
6. **Items**: nur tatsächliche Produkt-Zeilen, keine Gesamt-/Steuer-
   Zeilen und keine Rabatt-Zeilen — einzige Ausnahme sind Rabatte und
   Coupons auf den GANZEN Einkauf (Regel 16). Gehören mehrere gedruckte
   Zeilen zu EINER Position (Mengenzeile wie „3 x 0,69" oder „2x 1,65",
   Gewichtszeile, Rabattzeile direkt darunter), nimm die Position einmal
   mit dem finalen Preis nach Rabatt auf. Steht derselbe Artikel dagegen
   mehrmals als EIGENE Zeile mit eigenem Preis da (z. B. siebenmal
   „Sahnejoghurt  0,39" untereinander), ist JEDE dieser Zeilen ein eigenes
   Item — nicht zusammenfassen, keine auslassen. (Pfand-Zeilen als eigene
   Items mit category='Pfand' aufnehmen — die Zuordnung weiter unten gilt
   auch für sie.) Beachte zwingend die Sektion „Zeilen-/Preis-Zuordnung".
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
8. **Total** = der ENDBETRAG nach allen Rabatten und Coupons, aber VOR der
   Verrechnung eingelöster Punkte (Regel 17).
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

## Rabatte und Coupons auf den ganzen Einkauf

16. Rabatt-, Coupon- und Gutscheinzeilen, die NACH der Artikelliste stehen
    (meist unter der Zwischensumme, vor dem Endbetrag) und NICHT unmittelbar
    unter einem einzelnen Artikel — z. B. „10% COUPONAKTION", „Coupon 20%
    Bio Lebensmittel", „Rabatt", „Coupon 10€", „5€ Rabatt Warenkorb",
    „K Card XTRA Rabatt", „Mitarbeiterrabatt" — nimmst du als EIGENE Zeile
    in items auf:
    - name und raw wie gedruckt, priceCents NEGATIV (9,69 € Rabatt → -969),
      category='Warenkorbrabatt'. Jede gedruckte Rabattzeile einzeln, auch
      wenn ihr Betrag ohne Minuszeichen gedruckt ist.
    - Die Artikel darüber behalten ihren Preis WIE GEDRUCKT. Einen solchen
      Rabatt NIE auf Artikel verteilen und NIE von einem Artikelpreis
      abziehen.
    - subtotalCents = die gedruckte Zwischensumme VOR diesen Zeilen (z. B.
      „Zwischensumme", „SUMME"), nur wenn sie gedruckt ist.
    - KEINE Rabattzeilen sind: Zahlungszeilen (BAR, EC- oder Kreditkarte,
      Gutschein- oder Geschenkkarte als Zahlungsmittel, eingelöste Punkte
      oder Guthaben — siehe Regel 17, Rückgeld), Storno- und Rückgabezeilen
      (bleiben normale Items, wie gedruckt) und Hinweise, die den Endbetrag
      nicht verringern („Sie haben … gespart").

## Eingelöste Punkte (Zahlungsmittel)

17. Eingelöste Punkte — PAYBACK, DeutschlandCard, dm-Punkte, Bonus- oder
    Treuepunkte (z. B. „Eingelöste Punkte  -380  = EUR -3,80" oder
    „PAYBACK Punkte eingelöst  -2,00") — sind ein ZAHLUNGSMITTEL wie
    Bargeld, kein Rabatt:
    - NIE als Item aufnehmen (auch nicht als Rabattzeile nach Regel 16) und
      NIE von einem Artikelpreis abziehen.
    - totalCents ist der Betrag VOR der Punkteverrechnung, nicht der „zu
      zahlende Betrag" danach — meist die gedruckte SUMME. Stehen zwischen
      dieser SUMME und der Punktezeile noch Rabatt- oder Couponzeilen
      (Regel 16), gilt: totalCents = zu zahlender Betrag + eingelöste
      Punkte.
    - Punkte, die mit diesem Einkauf erst gesammelt werden („Für diesen
      Einkauf erhältst Du 46 °P", Punktestand), sind nur Hinweise und
      gehören in kein Feld.

## Zeilen-/Preis-Zuordnung (KRITISCH — häufigste Fehlerquelle)

A. **Lies den Bon strikt Zeile für Zeile von OBEN nach UNTEN und gib die
   Items in GENAU dieser Reihenfolge zurück.** Niemals sortieren, niemals
   umgruppieren, niemals zwei benachbarte Artikel vertauschen. Wiederholt
   sich derselbe Artikel in mehreren eigenen Zeilen, gib jede Zeile als
   eigenes Item aus (Regel 6).
B. **Ordne Preise der REIHE NACH zu, NICHT nach pixel-genauer horizontaler
   Höhe.** Viele Thermo-Bons drucken die Preis-Spalte vertikal VERSETZT — der
   Preis eines Artikels steht oft eine halbe bis ganze Zeile TIEFER als sein
   Name (die 'EUR'-Kopfzeile sitzt dann auf Höhe des 1. Artikelnamens, der
   1. Preis auf Höhe des 2. Namens usw., der letzte Preis steht UNTER dem
   letzten Namen). Verlasse dich daher NIE auf gleiche Pixel-Höhe: der n-te
   Preis der Preis-Spalte gehört zum n-ten Artikel (1.→1., 2.→2., …). Anzahl
   Produkt-/Pfand-Preise = Anzahl Items.
C. **Artikelrabatte** — Zeilen wie 'Preisvorteil -0,17', 'Rabatt',
   '25% Rabatt', '0.10€ Rabatt', 'Lidl Plus Rabatt', 'Aktion' oder ein
   Coupon direkt unter einem Artikel — gehören zur darüberstehenden
   ARTIKEL-Zeile und verringern deren Preis: NICHT als eigenes Item
   ausgeben, sondern vom Artikel abziehen und dessen finalen Preis ausgeben.
   Pfand und Leergut bekommen NIE einen Rabatt: steht zwischen Artikel und
   Rabattzeile eine Pfand- oder Leergut-Zeile (z. B. „MuelMilch  0,69 /
   EW-Pfand 0,25 EUR  0,25 / 0.10€ Rabatt  -0,10"), gehört der Rabatt zum
   Artikel ÜBER dem Pfand, und das Pfand bleibt genau wie gedruckt. Einen
   Artikelrabatt nie einem Artikel weiter oben oder weiter unten zuordnen.
   Das gilt nur für Zeilen direkt unter einem Artikel; Rabatte auf den
   ganzen Einkauf regelt Regel 16.
D. **Gewichtsware** (z. B. 'Zucchini  0,418 kg x 1,39'): der Preis ist
   Gewicht × Kilopreis (ggf. minus Preisvorteil).
E. **Selbstkontrolle:** Σ aller item.priceCents (inkl. Pfand und der
   negativen Rabattzeilen nach Regel 16, OHNE eingelöste Punkte nach
   Regel 17) muss dem Endbetrag (totalCents) entsprechen. Stimmt es nicht,
   hast du sehr wahrscheinlich wegen des Spalten-Versatzes Preise falsch
   zugeordnet, einen Artikelrabatt beim falschen Artikel oder beim Pfand
   abgezogen oder eine Wiederholzeile ausgelassen — korrigiere die
   ZUORDNUNG (verschiebe die Preis-Spalte um eine Zeile, ordne den Rabatt
   dem Artikel darüber zu), erfinde KEINE Werte, bis die Summe passt.
F. **raw** pro Item: gib die wörtliche Bon-Zeile an (Name + Preis genau wie
   gedruckt), damit Name und Preis garantiert aus DERSELBEN Zeile stammen.`;

// Für alle Versionen gleich (v1.4 unverändert).
const USER_PROMPT =
  'Extrahiere alle strukturierten Daten aus diesem Kassenbon-Foto gemäß dem JSON-Schema. Antworte ausschließlich mit dem JSON-Objekt.';

// Gemini structured-output schema. Note: Gemini does NOT accept
// `type: ['string', 'null']` (JSON-Schema syntax). Optional fields
// must use `nullable: true` and a single concrete type.
const RESPONSE_SCHEMA_V14 = {
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
  },
  required: ['isReceipt', 'items'],
};

// v1.5 = v1.4 + drei Felder am Ende (Reihenfolge der v1.4-Felder unverändert).
const RESPONSE_SCHEMA_V15 = {
  ...RESPONSE_SCHEMA_V14,
  properties: {
    ...RESPONSE_SCHEMA_V14.properties,
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
};

// v1.6 = Schema von v1.5 unverändert (dasselbe Objekt): die neuen Regeln
// ändern nur, WAS in die Felder kommt, nicht welche Felder es gibt.
const RESPONSE_SCHEMA_V16 = RESPONSE_SCHEMA_V15;

const PROMPTS = Object.freeze({
  'v1.4': Object.freeze({ VERSION: 'v1.4', SYSTEM_PROMPT: SYSTEM_PROMPT_V14, USER_PROMPT, RESPONSE_SCHEMA: RESPONSE_SCHEMA_V14 }),
  'v1.5': Object.freeze({ VERSION: 'v1.5', SYSTEM_PROMPT: SYSTEM_PROMPT_V15, USER_PROMPT, RESPONSE_SCHEMA: RESPONSE_SCHEMA_V15 }),
  'v1.6': Object.freeze({ VERSION: 'v1.6', SYSTEM_PROMPT: SYSTEM_PROMPT_V16, USER_PROMPT, RESPONSE_SCHEMA: RESPONSE_SCHEMA_V16 }),
});
const VERSIONEN = Object.freeze(Object.keys(PROMPTS));

/**
 * Wert des Schalters `cashback_config/v1.ocrPrompt` → gültige Version.
 * Fehlt er, ist er falsch geschrieben oder unbekannt: v1.4. Kein Trimmen,
 * keine Groß-/Kleinschreibung — nur die exakten Werte schalten um.
 * @param {*} wert
 * @returns {'v1.4'|'v1.5'|'v1.6'}
 */
function promptVersionAus(wert) {
  return typeof wert === 'string' && Object.prototype.hasOwnProperty.call(PROMPTS, wert) ? wert : STANDARD_VERSION;
}

/** Prompt-Satz {VERSION, SYSTEM_PROMPT, USER_PROMPT, RESPONSE_SCHEMA} einer Version. */
function promptFuer(wert) {
  return PROMPTS[promptVersionAus(wert)];
}

/**
 * Aufruf-Optionen für extractReceipt (lib/ocr.js): Prompt, Schema und das
 * Versions-Etikett der Lesung gehören zusammen — nie einzeln setzen.
 */
function promptOptionen(wert) {
  const p = promptFuer(wert);
  return { systemInstruction: p.SYSTEM_PROMPT, userPrompt: p.USER_PROMPT, responseSchema: p.RESPONSE_SCHEMA, promptVersion: p.VERSION };
}

/**
 * Grund-Fassung einer GESPEICHERTEN Lesung (`ocr.promptVersion`, Lesung der
 * Zweitprüfung): 'v1.6' für 'v1.6' und 'referee-v2+v1.6'. Anders als
 * promptVersionAus kein Rückfall auf den Standard — eine unbekannte Fassung
 * (Bestand v1.3, DocAI, cv-hybrid, fehlend) liefert null.
 * @param {*} promptVersion
 * @returns {string|null}
 */
function basisVersion(promptVersion) {
  if (typeof promptVersion !== 'string') return null;
  const teil = promptVersion.slice(promptVersion.lastIndexOf('+') + 1);
  return Object.prototype.hasOwnProperty.call(PROMPTS, teil) ? teil : null;
}

// Die bisherigen Einzel-Exporte bleiben der STANDARD (v1.4): cv-hybrid
// (lib/prompt_text.js teilt das Schema), Skripte und alle Aufrufer ohne Schalter.
module.exports = {
  ...PROMPTS[STANDARD_VERSION],
  STANDARD_VERSION,
  VERSIONEN,
  PROMPTS,
  promptVersionAus,
  promptFuer,
  promptOptionen,
  basisVersion,
};
