'use strict';

/**
 * Doppelzahlungen bei Kassenbons (Entscheidung Patrick 04.10.2026: „ja,
 * abstellen" — dieselbe Person darf denselben Bon nie zweimal bezahlt
 * bekommen). Reine Regeln, ohne I/O; die Buchung (syncLedgerForReceipt in
 * index.js) liest und schreibt.
 *
 * Warum in der Buchung und nicht nur davor: Die Inhaltsprüfung der Pipeline
 * (contentHash/transactionHash/itemsHash, index.js Schritt 5b) läuft NACH dem
 * Lesen und VOR der Buchung, ohne Transaktion. Zwei Fotos desselben Bons, die
 * gleichzeitig verarbeitet werden, sehen einander dort nicht — am 04.10. wurde
 * so ein Kaufland-Bon (30,03 €) zweimal bezahlt, die Gutschriften 0,28 s
 * auseinander. Und Resolver, Prüfkonsole und Bon-Runde buchen ohne diese
 * Prüfung. Die Buchungsfunktion ist die EINE Stelle, durch die jeder Bon geht.
 *
 * Vier Regeln (gemessen an 14.369 Bons aus 95 Tagen, Skripte in
 * scratchpad/bon-rueckblick, c_eval.js):
 *   summe      gleiche Person + Markt + Bon-Tag + Endsumme, gegen BEZAHLTE Bons
 *              des Tages. 615 Paare, 612 derselbe Bon; echte Zweitkäufe nur mit
 *              1–2 Artikeln (nie zahlbar, ab 6 Artikeln 0 Fälle).
 *   konten     Markt + Tag + Uhrzeit + Summe über alle Konten (Schlüssel-
 *              dokument, „der erste gewinnt"). 28 Paare, alle derselbe Bon.
 *              NUR mit Uhrzeit — ohne sie gab es 10 echte Zufallspaare.
 *   artikel    gleiche Person + Markt + Tag, Anteil gleicher Artikel (Name +
 *              Preis, ohne Pfand/Rabatt/0-€-Zeilen, jeder Artikel einmal) am
 *              kleineren Bon ≥ 0,6, beide Bons ≥ 5 verschiedene Artikel.
 *              Höchster Wert unter 964 echten Zweitkäufen: 0,43; niedrigster
 *              Doppelbon: 0,71. Fängt andere Lesung der Summe und Teilfotos.
 *   bestellung Bestellnummer einer Online-Bestellung über alle Konten (nicht
 *              gemessen — nur Beobachtung, bis Treffer durchgesehen sind).
 *
 * Zwei weitere Regeln aus der Prüfrunde (Angriffe nachgestellt, Skripte in
 * scratchpad/betrueger-r1):
 *   datum      gleiche Person + Markt + Uhrzeit (HH:MM), ANDERER Bon-Tag bis
 *              8 Tage daneben, dazu gleiche Summe ODER Artikelanteil ≥ Schwelle.
 *              Fängt die Kopie eines bezahlten Bon-Fotos, in der nur das Datum
 *              geändert ist — alle anderen Regeln enthalten den Tag. 7.403
 *              Paare gleiche Person/Markt/anderer Tag ≤ 8: 0 mit gleicher
 *              Uhrzeit und Summe, 0 mit gleicher Uhrzeit und Anteil ≥ 0,6.
 *              Ohne die Uhrzeit nicht tragfähig: 26 echte Gewohnheitskäufe
 *              liegen über Tage hinweg bei ≥ 0,6.
 *   kontenArtikel  andere Person, gleicher Markt + Tag, Artikelanteil ≥
 *              Schwelle (beide ≥ minArtikel) — ohne Uhrzeit und Summe. Fängt
 *              denselben Bon aus einem zweiten Konto, wenn dort die Uhrzeit
 *              verdeckt oder anders gelesen ist (der Kontenschlüssel braucht
 *              sie). 89.463 Paare verschiedener Konten: alle 21 mit Anteil
 *              ≥ 0,6 waren derselbe Bon, zwei verschiedene Bons höchstens 0,5.
 *
 * Prüfrunde 2 (04.10.2026, Angriffe mit dem echten index.js nachgestellt,
 * Gegenprobe an 6.420 bezahlten Bons aus 95 Tagen, scratchpad/r2-fix/mess.js):
 *   datum      zusätzlich OHNE gleiche Uhrzeit, wenn Summe UND Artikelanteil
 *              passen — eine Kopie mit geändertem Datum und geänderter oder
 *              verdeckter Uhrzeit (beschnitten passiert sie den Feinvergleich).
 *              3.834 Paare gleiche Person/Markt, 1–8 Tage: 0 mit gleicher Summe.
 *   seite      gleiche Person + Markt + Tag, beide Belege Online-Bestellungen,
 *              mindestens einer ohne gedruckten Endbetrag (Summe aus den
 *              Artikeln, lib/belegart.js) — die Seiten EINER mehrseitigen
 *              Rechnung haben verschiedene Artikel und Summen und keine
 *              Uhrzeit, keine andere Regel sieht sie. Zwei verschieden
 *              gelesene Bestellnummern heben die Regel auf. 0 Paare gleiche
 *              Person/Markt/Tag ohne Uhrzeit, beide bezahlt.
 *   kontenDatum  gleicher Markt + Endsumme über alle Konten, anderer Tag bis
 *              8 Tage daneben, dazu gleiche Uhrzeit ODER Artikelanteil ≥
 *              Schwelle (Summen-Index `cashback_bon_summen/{markt}_{summe}`).
 *              Fängt die Kopie aus einem zweiten Konto mit geändertem Datum —
 *              alle anderen Regeln über Konten enthalten den Tag. 577.206
 *              Paare verschiedener Konten, 1–8 Tage: 80 mit gleicher Summe,
 *              davon 0 mit gleicher Uhrzeit und 0 mit Anteil ≥ 0,6.
 *
 * Prüfrunde 3 (04.10.2026, Gegenprobe an denselben 6.420 bezahlten Bons,
 * scratchpad/verif_r3_*.js):
 *   datum      reicht über den Summen-Index bis SUMMEN_AUFBEWAHRUNG_TAGE
 *              zurück (gleiche Person, gleiche Endsumme, dazu gleiche Uhrzeit
 *              ODER Artikelanteil ≥ Schwelle). Echter Fall 02.10.: Netto
 *              93,28 €, 10:44, ein Foto mit „22.10." statt „02.10." gelesen,
 *              in der Prüfung freigegeben, das andere schon bezahlt — 20 Tage
 *              Abstand, Artikelnamen verlesen (Anteil 0,07). 7.608 Paare gleiche
 *              Person/Markt, 9–95 Tage: genau 1 mit gleicher Summe und Uhrzeit
 *              (dieser Fall), 0 mit gleicher Summe und Anteil ≥ 0,6.
 *   kontenDatum  jenseits von 8 Tagen nur noch über die Artikel: 1,82 Mio.
 *              Paare verschiedener Konten, 9–95 Tage: 2 echte Zufälle mit
 *              gleicher Summe und Uhrzeit (dm 23,40 €, ALDI SÜD 16,31 €), 0 mit
 *              gleicher Summe und Anteil ≥ 0,6.
 *   datum      ohne gleiche Uhrzeit zählt statt der gedruckten Endsumme auch
 *              die gleiche Summe der gelesenen Artikel (`artikelSumme`) — eine
 *              Kopie, in der nur eine Ziffer der Endsumme geändert ist, bleibt
 *              im Abgleich (Pfand-Toleranz 200 ct). 3.834 Paare gleiche
 *              Person/Markt, 1–8 Tage: 0 mit gleicher Artikelsumme.
 *   Markt      Regeln derselben Person vergleichen auch über Märkte hinweg (ein
 *              geänderter Händlername im Kopf): Artikel ≥ Schwelle, oder Summe
 *              nur zusammen mit gleicher Uhrzeit. 6.575 Paare gleiche Person,
 *              verschiedener Markt, 0–8 Tage: 0 mit Anteil ≥ 0,5, 0 mit
 *              gleicher Summe und Uhrzeit.
 *
 * Nachprüfung 05.10.2026 (Angriffe mit dem echten index.js nachgestellt,
 * Gegenprobe an denselben 6.421 bezahlten Bons, scratchpad/nachpruef-0510):
 *   datum      liest zusätzlich den PERSONEN-Index `cashback_bon_person/{uid}`
 *              — alle bezahlten Bons derselben Person der letzten 95 Tage,
 *              ohne Markt und ohne gedruckte Endsumme im Schlüssel. Vorher hing
 *              der Rückblick über 8 Tage hinaus allein am Summen-Index
 *              `{markt}_{summe}`: Datum ≥ 9 Tage verschoben UND eine Ziffer der
 *              Endsumme oder ein Wort im Kopf geändert — keine Regel griff.
 *              Dieselbe Bedingung wie im Fenster des Tageszählers (gleiche
 *              Uhrzeit: Summe ODER Artikel; ohne sie: Summe bzw. Artikelsumme
 *              UND Artikel), Markt egal. 29.519 Paare gleiche Person, 1–95
 *              Tage, jeder Markt: genau 1 Treffer — die echte Doppelzahlung vom
 *              02.10. Verworfen: „Artikel ≥ 0,6 und Endsumme ±2 €" — traf einen
 *              echten Zweitkauf (REWE, zwei Abende hintereinander, gleicher
 *              Ingwer-Shot, Tomaten, Gurke, Cola).
 *   seite      auch an einem ANDEREN Tag im Fenster ±8 (Datum auf einer Seite
 *              geändert). 0 Paare zweier bezahlter Online-Belege desselben
 *              Markts ohne Uhrzeit in 1–8 Tagen.
 *
 * Nachprüfung 05.10.2026, zweite Runde (scratchpad/nachpruef-0510-*.js):
 *   seite      gilt auch für zwei Bildschirmabschnitte EINES App-Kassenbons
 *              (Lidl Plus …): beide `app_kassenbon`, gleicher Markt, gleicher
 *              Tag, mindestens einer ohne sichtbare Summe (lib/belegart.js
 *              setzt dort die Artikelsumme ein, OHNE Schalter — darum ohne
 *              diese Regel zwei Gutschriften; echte Fälle 16.07. und 21.09.).
 *              Nur am SELBEN Tag: Lidl-App-Bons tragen meist keine Uhrzeit,
 *              und 36 ehrliche Lidl-Paare derselben Person lagen 1–8 Tage
 *              auseinander, eines davon ohne Uhrzeit. Am selben Tag: 144
 *              bezahlte Paare gleiche Person/Markt, nur 1 ohne Uhrzeit — der
 *              echte Doppelbon vom 17.09. Zwei VERSCHIEDENE Uhrzeiten heben
 *              die Regel auf (zwei Einkäufe). Schalter `doppelOnlineSeite`
 *              mit Code-Default TRUE: die Regel greift nur, wenn ein Beleg
 *              ohne gedruckte Summe beteiligt ist (`summeAusArtikeln`), und
 *              dieser Zahlweg ist selbst ohne Schalter. `false` schaltet sie ab.
 *              WICHTIG (Korrektur 06.10.2026): `app` und `ohneSumme` liefert
 *              nur Prompt v1.5 (Belegart, summeAusArtikeln — lib/belegart.js).
 *              Unter dem Standard-Prompt v1.4 (`cashback_config/v1.ocrPrompt`
 *              nicht 'v1.5') kann die Regel darum nie greifen: v1.4 setzt bei
 *              einem Scrollbild bzw. einer Rechnungsseite ohne Summe selbst
 *              die Artikelsumme als Endbetrag ein, ohne es zu kennzeichnen —
 *              jeder Abschnitt wird einzeln bezahlt, genau wie vor diesem
 *              Zweig (echter Fall 17.09., Lidl). Der Schutz kommt erst mit
 *              ocrPrompt 'v1.5'.
 *   bild       Feinvergleich beim Hochladen (lib/bildVergleich.js) hat einen
 *              groben Bildtreffer NICHT bestätigt (Beschnitt ab 1 %), der
 *              Kandidat ist ein bezahlter Bon derselben Person, gleicher Markt,
 *              Bon-Tag ±8 → der Bon geht in die PRÜFUNG (`review`,
 *              `bild_aehnlich_bezahlt`), nicht in die Ablehnung. Ohne sie
 *              ließ `bildFeinvergleich: true` eine beschnittene Kopie mit
 *              einigen geänderten Preisziffern durch (keine Textregel greift,
 *              der grobe dHash sperrte sie bisher). Nur wenn keine andere
 *              Regel wirksam trifft (Reihenfolge). (Offene Kandidaten, Markt,
 *              Resolver: siehe zweite Runde 06.10.2026 unten.)
 *              Schalter `doppelBildAehnlich`, Code-Default TRUE, und
 *              Voraussetzung für `bildFeinvergleich: true`. Wirkt, wo
 *              `capture.bildAehnlich` steht: vom scharfen Feinvergleich beim
 *              Hochladen ODER — seit der vierten Prüfrunde 06.10.2026 und in
 *              JEDEM Modus des Feinvergleichs, also schon ab dem Deploy — vom
 *              Nachtrag bei gleichzeitigem Hochladen (index.js
 *              gleichzeitigeBildKandidaten, siehe unten).
 *
 * Nachprüfung 06.10.2026 (Befunde der Nachprüfung zum Prompt-Schalter):
 *   datum      ohne gleiche Uhrzeit zählt als Summe auch die gleiche Summe
 *              der POSITIVEN Artikel (positivSummeVon) — eine Kopie, in der nur
 *              eine Coupon- oder Leergut-Zeile eingefügt bzw. geändert und die
 *              Endsumme angepasst ist, ändert weder einen Artikel noch dessen
 *              Preis, aber Endsumme und Artikelsumme. Gegenprobe (siehe
 *              positivSummeVon): 5 Paare gleiche Positivsumme, alle Anteil 0.
 *              Gilt im Fenster des Tageszählers UND im Personen-Index (`ps`).
 *   datum      der Personen-Index trägt Namens-Hashes (`n`) und den Rabatt-
 *              Vermerk (`k`) wie Tages- und Summen-Index: über den Prompt-
 *              Wechsel v1.4 ↔ v1.5 (Coupon in den Preisen ↔ eigene Zeile)
 *              tragen dieselben Artikel verschiedene Preise; ohne Namen war ein
 *              Coupon-Bon ab Tag 9 wieder zahlbar. Größenbremse
 *              MAX_PERSON_BYTES in personAufraeumen.
 *   seiteAbweichend  wie seite, aber genau die Merkmale, die seite aufheben,
 *              weichen ab: andere Uhrzeit, andere Bestellnummer, bei App-Bons
 *              ein Bon-Tag genau 1 daneben. Mit einem einzigen geänderten Feld
 *              je Abschnitt war sonst jeder einzeln bezahlt. Nicht gemessen —
 *              zwei echte Einkäufe können so aussehen (zwei App-Bons eines
 *              Tages, einer abgeschnitten). Darum Code-Default BEOBACHTUNG
 *              (Schalter `doppelSeiteAbweichend`, fehlend = 'shadow'), und
 *              scharf (true) hält sie wie Regel bild nur in der Prüfung fest
 *              (`seite_abweichend`), lehnt nie ab. Wie seite nur mit Prompt
 *              v1.5 wirksam.
 *
 * Nachprüfung 06.10.2026, zweite Runde (Angriffe mit dem echten index.js
 * nachgestellt, __tests__/nachpruefung0610b.test.js):
 *   bild       zählt auch einen Kandidaten, der noch NICHT entschieden ist
 *              (`ocr_pending`, `review`; `offen`). Bisher zählte nur ein schon
 *              bezahlter — wurde die Kopie vor dem Original gebucht, bekamen
 *              beide Geld, und das Original (ohne Vermerk, es ist älter) sah
 *              die Kopie nie. Ein offener Kandidat ohne gelesenes Datum gilt
 *              als im Fenster. processCashback lässt die Kopie dann warten,
 *              bis das Original entschieden ist (index.js, BILD_WARTEN), und
 *              hält sie erst danach (oder nach den Versuchen) in der Prüfung
 *              (`bild_aehnlich_offen`).
 *   bild       ohne Marktbedingung: die Bildähnlichkeit ist das Signal. Ein
 *              unlesbarer Kopf wird über den Tippfehler-Abgleich „dm", ein
 *              umgeschriebener Kopf ein anderer Markt — beides umging die
 *              Regel. Gemessen (95 Tage, gleiche Person, ±8 Tage, dHash 4–7):
 *              21 von 459 Paaren an verschiedenen Märkten, also etwa +5 %
 *              Prüffälle (scratchpad/bild_markt_mess.js).
 *   bild       sieht alle groben Treffer, die laufen oder Geld bekamen (bis
 *              BILD_MAX_KANDIDATEN, seit der Abschlussprüfung bezahlte zuerst,
 *              siehe unten), nicht nur die bis zu 3 fein verglichenen — drei
 *              ältere ähnliche Bons verdrängten sonst das Original aus der Liste.
 *   seite, seiteAbweichend  ein UNSICHER erkannter Markt (Tippfehler-
 *              Abgleich ohne lesbaren Namen, Eigenmarken-Stufe: marktIstSicher)
 *              gilt als gleicher Markt: ein Abschnitt ohne Kopf wurde „dm" und
 *              einzeln bezahlt.
 *   Prüfregeln (bild, seiteAbweichend) gelten auch bei einer Entscheidung über
 *              den Resolver: trifft eine wirksam (und hat ein Mensch genau
 *              diesen Treffer nicht quittiert, quittierteTreffer), hält
 *              der Resolver ihn fest („halten") statt zu buchen — sonst gab die
 *              Bon-Runde einen Abschnitt bzw. eine Kopie frei, die wegen der
 *              Lese-Sicherheit in der Prüfung lag.
 *
 * Dritte Prüfrunde 06.10.2026 (Angriffe mit dem echten index.js nachgestellt,
 * __tests__/nachpruefung0610c.test.js):
 *   bild       `bild_aehnlich_offen` schaltet im Resolver keine Regel mehr ab
 *              (damals modiFuerEntscheidung): gab ein Mensch die Kopie frei, buchte er
 *              sie, und das Original (ohne Vermerk) wurde danach ebenfalls
 *              bezahlt. Jetzt hält der Resolver erneut fest, solange das
 *              Original offen oder inzwischen bezahlt ist.
 *   bild       auch außerhalb von ±8 Tagen, wenn der Artikelanteil mindestens
 *              BILD_FERN_ANTEIL erreicht (bildTrifft) — mit scharfem
 *              Feinvergleich war eine Kopie mit dem Datum „gestern" zu einem
 *              älteren Original sonst bezahlt.
 *   seiteAbweichend  auch bei gemischter Art am selben Tag (eine Seite als
 *              Online-Bestellung, ein Teil als App-Kassenbon, einer ohne Summe;
 *              `abweichend: ['belegart']`).
 *   summe      Code-Default AN (schalterModusStandardAn).
 *
 * Vierte Prüfrunde 06.10.2026 (__tests__/nachpruefung0610d.test.js):
 *   bild, seiteAbweichend  eine Freigabe schaltet keine Regel mehr ab, sondern
 *              quittiert die einzelnen Treffer, die der Mensch in der Zeile
 *              „Doppel-Prüfung" vor sich hatte (quittierteTreffer): wirksam,
 *              gegen einen entschiedenen Bon, im Stand `doppelPruefung.at`, den
 *              die Prüfkonsole mitschickt; neu nur bei `bild_aehnlich_bezahlt`
 *              und `seite_abweichend`, bei `bild_aehnlich_offen` wird nur
 *              Quittiertes weitergetragen. Vorher (a) buchte die Freigabe einer
 *              Kopie, die einem bezahlten ANDEREN Einkauf und dem offenen
 *              Original ähnelte, und danach das Original — zwei Gutschriften;
 *              (b) hielten bild und seiteAbweichend abwechselnd endlos fest.
 *   bild       offene Kandidaten zuerst (statt bezahlte): die Kopie wartet auf
 *              das Original, auch wenn sie zusätzlich einem bezahlten Bon ähnelt.
 *   bild       auch bei GLEICHZEITIGEM Hochladen: enqueueCashback sieht nach dem
 *              Anlegen nach, ob ein älterer Bon derselben Person mit nahem dHash
 *              inzwischen angelegt ist, und trägt ihn als Kandidaten nach
 *              (`capture.bildAehnlich.gleichzeitig`). Nur ältere — so trägt
 *              immer die jüngere Einreichung den Vermerk, nie beide.
 *
 * Abschlussprüfung 06.10.2026 (__tests__/abschluss0610.test.js):
 *   bild       die Kandidatenliste fasst alle groben Treffer der Bildprüfung
 *              (BILD_MAX_KANDIDATEN 55 statt 20) und ordnet beim Kürzen
 *              bezahlte vor offenen (bildKandidatenOrdnen). Vorher, mit 20 und
 *              „neueste zuerst": 20 frische, ähnlich aussehende Uploads kurz vor
 *              der bearbeiteten Kopie verdrängten das bezahlte Original, wurden
 *              abgelehnt, und die Kopie wurde bezahlt (nur mit scharfem
 *              Feinvergleich). Grenze bleibt die Rückschau der Bildprüfung (50
 *              jüngste Bons der Person): 50 beliebige Uploads zwischen Original
 *              und Kopie schieben das Original dort hinaus — bestehend, auch
 *              ohne diesen Zweig.
 *   bild       ein Bild, das sharp nicht lesen kann (PDF, HEIC, abgeschnittene
 *              Datei), hat keinen dHash — Regel bild und die grobe Sperre sind
 *              dafür blind. enqueueCashback vermerkt das
 *              (`capture.bildNichtLesbar`), und processCashback gibt einen
 *              solchen Bon vor der ersten Gutschrift an einen Menschen
 *              (`bild_nicht_pruefbar`, Schalter `bildNichtLesbarPruefen`).
 *
 * Bekannte Lücken (Korrektur 05.10.2026, ergänzt 06.10.): dieselbe Person,
 * ANDERER Bon-Tag (ab 1 Tag, nicht erst ab 9), Uhrzeit geändert oder verdeckt
 * UND Endsumme UND mindestens ein Artikelpreis geändert → weder Summe noch
 * Artikelsumme passt, keine Textregel greift. Heute sperrt der grobe dHash
 * solche Kopien (außer bei starkem Beschnitt); mit scharfem Feinvergleich fängt
 * sie Regel `bild` bis ±8 Tage um den Bon-Tag des Originals und darüber hinaus
 * nur ab einem Artikelanteil von BILD_FERN_ANTEIL. Gemessen als Textregel-
 * Kandidat (nicht gebaut): „gleiche Person, gleicher Markt, 1–95 Tage,
 * Artikelanteil ≥ 0,8 ohne Summe" — 0 von 11.442 bezahlten Paaren, höchster
 * ehrlicher Wert 0,75. Und: Regel bild steht nur an der JÜNGEREN Einreichung.
 * Wurde die Kopie bezahlt, während das Original abgelehnt war (Status nicht
 * offen, nicht bezahlt), und wird das Original später nachverarbeitet, sieht es
 * die Kopie nicht — vor einer Nachverarbeitung abgelehnter Bons die Bons der
 * Person mit `capture.bildAehnlich` auf diese ID prüfen.
 *
 * Jede Regel hängt an einem Schalter in `cashback_config/v1` (false | 'shadow'
 * | true, Code-Default false = altes Verhalten; Ausnahmen `summe`, `seite` und
 * `bild` (Default true) und `seiteAbweichend` (Default 'shadow'), siehe oben).
 * Ein Treffer im Modus 'shadow' wird am Bon vermerkt, ändert aber nichts.
 */

const crypto = require('crypto');
const { computeTransactionHash } = require('./forensics');
const { onlineMerkmal } = require('./belegart');

// Dieselbe Liste wie in der Messung (c_eval.js) — Pfand, Leergut, eingelöste
// Punkte, Rabatt- und Gutscheinzeilen sagen nichts darüber, ob zwei Bons
// derselbe Einkauf sind, und stehen auf vielen Bons gleich.
const NICHT_ARTIKEL_RE = /pfand|leergut|leerg\b|leerg\.|einweg.?leer|eingel(ö|o)ste punkte|billa bon|rabatt|gutschein|coupon/i;
const MAX_ARTIKEL = 150;
const MAX_SCHLUESSEL_LAENGE = 60;
// Rabatt auf den ganzen Einkauf als eigene Zeile (Prompt v1.5, Regel 16 —
// lib/prompt.js). v1.4 rechnete denselben Coupon in die Artikelpreise ein.
const RABATT_KATEGORIE_RE = /^warenkorbrabatt$/i;
// Namensvergleich (Nachprüfung 05.10.2026, Runde 2): Name ohne Preis, auf
// diese Länge gekürzt — der Artikel-Schlüssel kürzt lange Namen je nach
// Stellenzahl des Preises verschieden.
const NAMEN_LAENGE = 40;
const MAX_PERSON_NAMEN = 40;

const SCHLUESSEL_SAMMLUNG = 'cashback_bon_schluessel';
const EINTRAG_VERSION = 1;
// Tages-Index für die Regel kontenArtikel: `cashback_bon_tage/{markt}_{tag}`
// = { eintraege: { [receiptId]: { u: uid, a: [Artikel-Hashes] } } }, nur für
// den Server (kein Rules-Block, das abschließende deny-all greift). Je Eintrag
// typisch ~300 Byte, gemessen höchstens 82 Bons je Markt und Tag — das
// Dokument bleibt weit unter 1 MB. Ab MAX_TAGES_EINTRAEGE wird nicht mehr
// eingetragen (eine zu große Datei ließe sonst die Buchung scheitern).
// Geschrieben wird er nur, solange die Regel läuft ('shadow' oder true) — nur
// dann wird er auch gelesen, und nur so greift die Größenbremse (Prüfrunde 3).
const TAGE_SAMMLUNG = 'cashback_bon_tage';
const MAX_TAGES_EINTRAEGE = 600;
const HASH_LAENGE = 8;
// Regel datum: so viele Tage vor und nach dem Bon-Tag.
const DATUM_FENSTER_TAGE = 8;
// Summen-Index für die Regeln kontenDatum und datum:
// `cashback_bon_summen/{markt}_{summe}` = { eintraege: { [receiptId]: { u: uid,
// t: Tag, z: Uhrzeit|null, a: [Artikel-Hashes] } } }, nur für den Server.
// Gleiche Summe im selben Markt ist selten: über 95 Tage höchstens 3 bezahlte
// Bons je Dokument (6.416 Bons, 6.078 Dokumente, größtes ~750 Byte). Einträge,
// deren Tag mehr als SUMMEN_AUFBEWAHRUNG_TAGE zurückliegt, räumt die nächste
// Gutschrift weg. Die Aufbewahrung bestimmt, wie weit ein geändertes oder
// verlesenes Datum noch erkannt wird (Prüfrunde 3: Fehllesung 02 ↔ 22 = 20
// Tage); 95 Tage = der gemessene Zeitraum — länger nur mit neuer Messung.
const SUMMEN_SAMMLUNG = 'cashback_bon_summen';
const MAX_SUMMEN_EINTRAEGE = 400;
const SUMMEN_AUFBEWAHRUNG_TAGE = 95;
// Personen-Index für die Regel datum (Nachprüfung 05.10.2026):
// `cashback_bon_person/{uid}` = { eintraege: { [receiptId]: { l: [Lesung] } } },
// Lesung = { t: Tag, m: Markt, z: Uhrzeit|null, s: Endsumme|null,
// as: Artikelsumme|null, ps: Positivsumme|null, a: [Artikel-Hashes],
// n: [Namens-Hashes], k?: true } — nur für den Server, keine Artikelnamen im
// Klartext. Höchstens 2 Lesungen je Bon (die erste und die jüngste
// abweichende: der Bon sperrt unter beiden), höchstens 80 Artikel- und 40
// Namens-Hashes je Lesung, höchstens 300 Bons je Person (mehr als 3 bezahlte
// Bons am Tag über 95 Tage gibt es nicht; darüber fallen die ältesten heraus)
// und geschätzt höchstens MAX_PERSON_BYTES. Typisch wenige KB. Die Lesungen stehen bewusst in einem
// ARRAY: Felder in Maps innerhalb eines Arrays indexiert Firestore nicht
// einzeln — je Bon ~2 Indexeinträge statt ~90 (Grenze 40.000 je Dokument; als
// Map wäre eine Person mit 300 Bons darüber, und ihre Buchung scheiterte).
// Geschrieben bei JEDER Gutschrift,
// unabhängig vom Schalter — damit er beim Scharfschalten vollständig ist; den
// Bestand davor trägt `.backfill-doppel-person.js` nach.
const PERSON_SAMMLUNG = 'cashback_bon_person';
const MAX_PERSON_EINTRAEGE = 300;
const MAX_PERSON_LESUNGEN = 2;
const MAX_PERSON_ARTIKEL = 80;
const PERSON_AUFBEWAHRUNG_TAGE = SUMMEN_AUFBEWAHRUNG_TAGE;
// Größenbremse (Nachprüfung 05.10.2026, Runde 2; umgesetzt 06.10. in
// personAufraeumen): seit dem Namensvergleich trägt jede Lesung zusätzlich bis
// zu 40 Namens-Hashes — eine volle Lesung wiegt ~1,15 KB, 300 Bons mit je 2
// vollen Lesungen rund 700 KB. Liegt die geschätzte Größe über dieser Grenze,
// fallen die ältesten Bons heraus (1 MiB wäre das Ende jeder Buchung dieser
// Person).
const MAX_PERSON_BYTES = 700_000;

/** Wie in der Messung: klein, nur a–z, 0–9, äöüß. */
function normName(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
}

/**
 * Artikel-Schlüssel eines Bons: „name#preisCent", jeder nur einmal.
 * Nimmt Bon-Artikel in beiden Formen: `name` (OCR) oder `raw` (receipts.items).
 * @param {Array<{name?:string, raw?:string, priceCents?:number}>} items
 * @returns {string[]}
 */
function artikelSchluessel(items) {
  if (!Array.isArray(items)) return [];
  const gesehen = new Set();
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const name = it.name ?? it.raw ?? '';
    const p = it.priceCents;
    if (!Number.isInteger(p) || p <= 0) continue;
    if (NICHT_ARTIKEL_RE.test(String(name))) continue;
    const n = normName(name);
    if (n.length < 2) continue;
    const preis = String(p);
    const schluessel = `${n.slice(0, MAX_SCHLUESSEL_LAENGE - 1 - preis.length)}#${preis}`;
    gesehen.add(schluessel);
    if (gesehen.size >= MAX_ARTIKEL) break;
  }
  return [...gesehen];
}

/** „8:05", „08:05:31" → „08:05"; sonst null. */
function uhrzeitNormal(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function tagNormal(d) {
  const s = String(d ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * Bestellnummer einer Online-Bestellung, normalisiert. Kunden-, Kassen- oder
 * Telefonnummern liest das Modell laut Prompt nicht hierher; die Form-Prüfung
 * fängt zusätzlich, was sicher keine Bestellnummer ist (zu kurz, kaum Ziffern,
 * ein Datum). Lieber kein Schlüssel als ein falscher — ein falscher Schlüssel
 * sperrt einen fremden Bon.
 * @returns {string|null}
 */
function bestellnummerNormal(roh) {
  if (roh == null) return null;
  const text = String(roh).trim();
  if (!text) return null;
  // Datumsformen: 04.10.2026, 2026-10-04, 4/10/26 …
  if (/^\d{1,4}[.\-/]\d{1,2}[.\-/]\d{1,4}$/.test(text)) return null;
  const n = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (n.length < 6 || n.length > 30) return null;
  if ((n.match(/\d/g) || []).length < 4) return null;
  // Reine 8-stellige Zahl, die ein Datum ist (20261004 / 04102026).
  if (/^\d{8}$/.test(n)) {
    const jmt = /^(20\d\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(n);
    const tmj = /^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(20\d\d)$/.test(n);
    if (jmt || tmj) return null;
  }
  return n;
}

/** Schlüssel-ID der Bestellnummer (über alle Konten). */
function bestellSchluessel(markt, nummer) {
  const nr = bestellnummerNormal(nummer);
  if (!markt || !nr) return null;
  return 'bo_' + crypto.createHash('sha256').update(`${String(markt).toLowerCase()}|${nr}`).digest('hex').slice(0, 24);
}

/** Schlüssel-ID Markt + Tag + Uhrzeit + Summe (über alle Konten); nur mit Uhrzeit. */
function kontenSchluessel(markt, tag, uhrzeit, summe) {
  if (!uhrzeit) return null;
  const h = computeTransactionHash(markt, tag, uhrzeit, summe);
  return h ? `tx_${h}` : null;
}

/** ID des Tages-Index-Dokuments (Regel kontenArtikel); null ohne Markt/Tag. */
function tagesIndexId(markt, tag) {
  if (!markt || !tag) return null;
  return `${String(markt).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60)}_${tag}`;
}

/** ID des Summen-Index-Dokuments (Regel kontenDatum); null ohne Markt/Summe. */
function summenIndexId(markt, summe) {
  if (!markt || !Number.isInteger(summe) || summe <= 0) return null;
  return `${String(markt).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60)}_${summe}`;
}

/** Tage zwischen zwei YYYY-MM-DD (Betrag); null, wenn eines fehlt. */
function tageAbstand(a, b) {
  const x = Date.parse(`${tagNormal(a)}T12:00:00Z`);
  const y = Date.parse(`${tagNormal(b)}T12:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.round(Math.abs(x - y) / 86400000);
}

/**
 * Artikel-Schlüssel als kurze Hashes für den kontenübergreifenden Tages-Index:
 * dort stehen Einträge FREMDER Konten, darum keine Artikelnamen. 8 Hex-Zeichen
 * (32 Bit) — eine Zufallsgleichheit unter den ~2.500 Artikeln eines Markt-Tags
 * ist praktisch ausgeschlossen und verschöbe den Anteil um höchstens 1 Artikel.
 */
function artikelHashes(artikel) {
  if (!Array.isArray(artikel)) return [];
  const out = new Set();
  for (const k of artikel) {
    if (typeof k !== 'string' || !k) continue;
    out.add(crypto.createHash('sha256').update(k).digest('hex').slice(0, HASH_LAENGE));
    if (out.size >= MAX_ARTIKEL) break;
  }
  return [...out];
}

/** Die Tage im Fenster der Regel datum (ohne den Tag selbst), als YYYY-MM-DD. */
function tageImFenster(tag, n = DATUM_FENSTER_TAGE) {
  const t = tagNormal(tag);
  if (!t) return [];
  const basis = Date.parse(`${t}T12:00:00Z`);
  if (!Number.isFinite(basis)) return [];
  const out = [];
  for (let d = 1; d <= n; d++) {
    out.push(new Date(basis - d * 86400000).toISOString().slice(0, 10));
    out.push(new Date(basis + d * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Summe der gelesenen Artikelpreise — dieselbe Rechnung wie der Abgleich
 * (lib/ocr.js reconcile). Ändert jemand nur die gedruckte Endsumme, bleibt sie
 * gleich (Prüfrunde 3). null ohne Artikel.
 */
function artikelSummeVon(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const s = items.reduce((acc, it) => acc + (it && Number.isFinite(it.priceCents) ? it.priceCents : 0), 0);
  return Number.isInteger(s) && s > 0 ? s : null;
}

/**
 * Summe der POSITIVEN Artikelzeilen — ohne Pfand, Leergut, Rabatt-, Coupon-
 * und Gutscheinzeilen (derselbe Filter wie artikelSchluessel). Nachprüfung
 * 05.10.2026, Runde 2: die Artikelsumme oben zählt negative Zeilen mit; wer
 * in eine Kopie nur eine Zeile „Coupon −1,50" oder „Leergut −0,75" einfügt
 * und die Endsumme anpasst, ändert sie, ohne einen Artikel anzufassen — und
 * unter v1.5 ist die Couponzeile sogar die vorgesehene Lesart (Regel 16).
 * Gegenprobe an 6.421 bezahlten Bons (29.519 Paare gleiche Person, 1–95
 * Tage, jeder Markt, scratchpad/bild-r2/mess.js): 5 Paare mit gleicher
 * Positivsumme, alle mit Artikelanteil 0 — keines mit Anteil ≥ 0,6.
 * null ohne positive Artikel.
 */
function positivSummeVon(items) {
  if (!Array.isArray(items) || !items.length) return null;
  let s = 0;
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const p = it.priceCents;
    if (!Number.isInteger(p) || p <= 0) continue;
    if (RABATT_KATEGORIE_RE.test(String(it.category ?? ''))) continue;
    if (NICHT_ARTIKEL_RE.test(String(it.name ?? it.raw ?? ''))) continue;
    s += p;
  }
  return s > 0 ? s : null;
}

/** Trägt die Lesung einen Rabatt auf den ganzen Einkauf als eigene Zeile (v1.5)? */
function hatWarenkorbRabatt(items) {
  return Array.isArray(items) && items.some((it) => it && RABATT_KATEGORIE_RE.test(String(it.category ?? '')));
}

/**
 * Artikelnamen ohne Preis aus den Artikel-Schlüsseln („name#preis"), jeder
 * nur einmal, auf NAMEN_LAENGE gekürzt.
 */
function artikelNamen(artikel) {
  if (!Array.isArray(artikel)) return [];
  const out = new Set();
  for (const k of artikel) {
    if (typeof k !== 'string') continue;
    const i = k.lastIndexOf('#');
    const n = (i >= 0 ? k.slice(0, i) : k).slice(0, NAMEN_LAENGE);
    if (n.length >= 2) out.add(n);
  }
  return [...out];
}

/**
 * Anteil gemeinsamer Einträge am KLEINEREN von zwei Listen; null, wenn eine
 * weniger als `min` Einträge hat.
 */
function anteilAus(a, b, min) {
  const x = Array.isArray(a) ? a : [];
  const y = new Set(Array.isArray(b) ? b : []);
  if (x.length < min || y.size < min) return null;
  let g = 0;
  for (const k of x) if (y.has(k)) g++;
  return g / Math.min(x.length, y.size);
}

/**
 * Prompt-Wechsel (Nachprüfung 05.10.2026, Runde 2): v1.4 rechnete einen
 * Coupon auf den ganzen Einkauf in die Artikelpreise ein, v1.5 liest die
 * gedruckten Preise und den Coupon als eigene Zeile. Dieselben Artikel tragen
 * dann verschiedene Schlüssel „name#preis" (gemessen an echten Rossmann-
 * Lesungen: Anteil 0,00–0,06 zwischen den Versionen). Trägt eine der beiden
 * Lesungen einen solchen Rabatt, zählt darum zusätzlich der Anteil gleicher
 * NAMEN — der größere Wert gilt. Gegenprobe an 6.421 bezahlten Bons
 * (scratchpad/bild-r2/mess.js): 48.577 Paare verschiedener Konten, gleicher
 * Markt und Tag — kein Paar mit Namensanteil ≥ 0,6 (höchster 0,57); 29.519
 * Paare gleiche Person, 1–95 Tage, mit gleicher Summe oder Uhrzeit — keines.
 * @returns {number|null}
 */
function mitNamen(preisAnteil, namenAnteil, rabatt) {
  if (!rabatt || namenAnteil == null) return preisAnteil;
  return preisAnteil == null ? namenAnteil : Math.max(preisAnteil, namenAnteil);
}

/**
 * Identität eines Bons für die Doppel-Prüfung.
 * @returns {{markt:string|null, tag:string|null, summe:number|null, uhrzeit:string|null,
 *            artikel:string[], artikelSumme:number|null, bestellHash:string|null,
 *            kontenId:string|null, tagesIndex:string|null}}
 */
function identitaet({ merchantId, bonDate, totalCents, bonTime, items, bestellnummer, online, summeAusArtikeln, belegart, marktSicher = true } = {}) {
  const markt = merchantId && merchantId !== 'unknown' ? String(merchantId).toLowerCase() : null;
  const tag = tagNormal(bonDate);
  const summe = Number.isInteger(totalCents) && totalCents > 0 ? totalCents : null;
  const uhrzeit = uhrzeitNormal(bonTime);
  return {
    markt,
    tag,
    summe,
    uhrzeit,
    artikel: artikelSchluessel(items),
    artikelSumme: artikelSummeVon(items),
    // Nachprüfung 05.10.2026, Runde 2: Summe der positiven Artikel (Regel
    // datum ohne Uhrzeit, positivSummeVon) und ob die Lesung einen Warenkorb-
    // Rabatt als eigene Zeile führt (Namensvergleich über den Prompt-Wechsel).
    positivSumme: positivSummeVon(items),
    rabatt: hatWarenkorbRabatt(items),
    bestellHash: bestellSchluessel(markt, bestellnummer),
    kontenId: markt && tag && summe ? kontenSchluessel(markt, tag, uhrzeit, summe) : null,
    tagesIndex: tagesIndexId(markt, tag),
    summenIndex: tag ? summenIndexId(markt, summe) : null,
    // Regel seite: Online-Bestellung (lib/belegart.js onlineMerkmal) und ob der
    // Endbetrag nur aus den Artikeln stammt (Seite ohne gedruckte Summe).
    online: online === true,
    ohneSumme: summeAusArtikeln === true,
    // Regel seite für App-Kassenbons (Nachprüfung 05.10.2026): Abschnitte
    // EINES App-Bons. Nur die Belegart des Modells (Prompt v1.5) zählt.
    app: belegart === 'app_kassenbon',
    // Markt nur unsicher erkannt (marktIstSicher, Nachprüfung 06.10.2026,
    // zweite Runde): Regeln seite/seiteAbweichend werten ihn als gleich.
    marktUnsicher: Boolean(markt) && marktSicher === false,
  };
}

/**
 * Stammt der Markt aus einem lesbaren Namen (Nachprüfung 06.10.2026, zweite
 * Runde)? Der Tippfehler-Abgleich ohne verwertbaren Namen macht einen leeren
 * Kopf zu „dm" (Abstand 2), die Eigenmarken-Stufe rät die Kette aus den
 * Artikeln — beides kann ein abgeschnittener oder übermalter Kopf erzwingen.
 * Alias, Umsatzsteuer-ID und Teilwort kommen aus gelesenem Text. Unbekannt
 * (Altbestand ohne `matchVia`) gilt als sicher — wie vor dieser Regel.
 * @param {string|null|undefined} matchVia  lib/merchant.js resolveMerchant().matchVia
 * @param {boolean} nameLesbar              lib/merchant.js nameVerwertbar(raw)
 */
function marktIstSicher(matchVia, nameLesbar) {
  if (matchVia === 'fuzzy') return nameLesbar === true;
  if (matchVia === 'eigenmarke') return false;
  return true;
}

/**
 * Identität aus einem gespeicherten `receipts`-Dokument (Resolver, Altbestand
 * ohne Tageseintrag, .backfill-doppel-person.js).
 *
 * Steht `neulesungVerworfen` am Bon (Bestandsschutz, Nachprüfung 06.10.2026),
 * trägt `ocr` eine Lesung, die NICHT bezahlt wurde — die bezahlte steht nur
 * noch in den Feldern des Bons (bonDate, bonTotalCents, merchant, items …).
 * Dann gelten allein diese; was nur die Texterkennung kennt (Bestellnummer,
 * summeAusArtikeln), fehlt.
 */
function identitaetAusBon(bon) {
  const b = bon || {};
  const verworfen = Boolean(b.neulesungVerworfen);
  const parsed = (!verworfen && b.ocr && b.ocr.parsed) || {};
  const items = Array.isArray(parsed.items) && parsed.items.length
    ? parsed.items
    : Array.isArray(b.items) ? b.items : [];
  return identitaet({
    merchantId: b.merchant && b.merchant.id,
    bonDate: b.bonDate ?? parsed.bonDate,
    totalCents: Number.isInteger(b.bonTotalCents) ? b.bonTotalCents : parsed.totalCents,
    bonTime: b.bonTime ?? parsed.bonTime,
    items,
    bestellnummer: parsed.bestellnummer,
    online: Boolean(onlineMerkmal(parsed)) || (verworfen && b.belegart === 'online_bestellung'),
    summeAusArtikeln: parsed.summeAusArtikeln === true,
    belegart: parsed.belegart ?? b.belegart ?? null,
    // Seit 06.10.2026 schreibt processCashback `merchant.sicher` mit; fehlt es
    // (Altbestand), gilt der Markt als sicher.
    marktSicher: !(b.merchant && b.merchant.sicher === false),
  });
}

/** Was am Tageszähler je bezahltem Bon steht (`cashback_days/{Tag}.eintraege`). */
function eintragAus(id) {
  return {
    markt: id.markt ?? null,
    summe: id.summe ?? null,
    uhrzeit: id.uhrzeit ?? null,
    artikel: Array.isArray(id.artikel) ? id.artikel.slice(0, MAX_ARTIKEL) : [],
    // Regel datum ohne Uhrzeit (Prüfrunde 3); fehlt in Einträgen davor.
    ...(Number.isInteger(id.artikelSumme) ? { artikelSumme: id.artikelSumme } : {}),
    // Nachprüfung 05.10.2026, Runde 2; fehlt in Einträgen davor.
    ...(Number.isInteger(id.positivSumme) ? { positivSumme: id.positivSumme } : {}),
    bestellHash: id.bestellHash ?? null,
    // Nur gesetzt, wenn wahr (Regel seite) — spart Platz am Tageszähler.
    ...(id.online ? { online: true } : {}),
    ...(id.ohneSumme ? { ohneSumme: true } : {}),
    ...(id.app ? { app: true } : {}),
    ...(id.rabatt ? { rabatt: true } : {}),
    ...(id.marktUnsicher ? { marktUnsicher: true } : {}),
    v: EINTRAG_VERSION,
  };
}

/**
 * Gleiche Person (das stellt der Aufrufer sicher): wie ähnlich sind zwei Bons?
 * Seit Prüfrunde 3 auch über Märkte hinweg — ob ein anderer Markt reicht,
 * entscheidet doppelUrteil (`gleicherMarkt`). Trägt eine Lesung einen
 * Warenkorb-Rabatt, zählt auch der Anteil gleicher Namen (mitNamen).
 * @returns {{summe:boolean, artikelSumme:boolean, positivSumme:boolean, anteil:number|null, gleicherMarkt:boolean}}
 */
function vergleiche(neu, alt, { minArtikel = 5 } = {}) {
  const out = { summe: false, artikelSumme: false, positivSumme: false, anteil: null, gleicherMarkt: false };
  if (!neu || !alt || !neu.markt || !alt.markt) return out;
  out.gleicherMarkt = neu.markt === alt.markt;
  out.summe = Number.isInteger(neu.summe) && neu.summe > 0 && neu.summe === alt.summe;
  out.artikelSumme = Number.isInteger(neu.artikelSumme) && neu.artikelSumme > 0 && neu.artikelSumme === alt.artikelSumme;
  out.positivSumme = Number.isInteger(neu.positivSumme) && neu.positivSumme > 0 && neu.positivSumme === alt.positivSumme;
  const rabatt = Boolean(neu.rabatt || alt.rabatt);
  out.anteil = mitNamen(
    anteilAus(neu.artikel, alt.artikel, minArtikel),
    rabatt ? anteilAus(artikelNamen(neu.artikel), artikelNamen(alt.artikel), minArtikel) : null,
    rabatt,
  );
  return out;
}

/** false | 'shadow' | true — alles andere gilt als aus. */
function schalterModus(v) {
  if (v === true) return true;
  if (v === 'shadow') return 'shadow';
  return false;
}

/**
 * Wie schalterModus, aber ein FEHLENDER Wert (undefined/null) gilt als true.
 * Nur für Schutzregeln, die ausschließlich einen Zahlweg absichern, der selbst
 * ohne Schalter gilt (seite) bzw. erst mit einem anderen scharfen Schalter
 * entsteht (bild) — dort hieße „aus" per Default: der Deploy öffnet die Lücke.
 * Dazu summe (dritte Prüfrunde 06.10.2026): der Doppelfall vom 04.10., den
 * Patrick abgestellt haben will („ja, abstellen"), und gemessen ohne einen
 * zahlbaren Fehlalarm (615 Paare, 612 derselbe Bon, die übrigen 3 mit 1–2
 * Artikeln) — „aus" per Default hieße: der Deploy allein stellt nichts ab.
 * Ein ausdrückliches false oder 'shadow' wirkt wie überall.
 */
function schalterModusStandardAn(v) {
  return v == null ? true : schalterModus(v);
}

/**
 * Wie schalterModus, aber ein FEHLENDER Wert gilt als 'shadow': die Regel wird
 * ab dem Deploy nur beobachtet (Vermerk am Bon, Log), ohne Wirkung. Für eine
 * Regel, die erst gemessen werden muss, bevor jemand sie scharf schaltet.
 */
function schalterModusStandardBeobachtung(v) {
  return v == null ? 'shadow' : schalterModus(v);
}

/** Schalter und Schwellen aus `cashback_config/v1`. */
function doppelModi(config = {}) {
  const schwelle = Number(config.doppelArtikelSchwelle);
  const minArtikel = Number(config.doppelArtikelMin);
  return {
    // Code-Default AN (dritte Prüfrunde 06.10.2026, siehe Kopf): sonst
    // verhinderte der Deploy allein den Doppelfall vom 04.10. nicht.
    summe: schalterModusStandardAn(config.doppelSumme),
    konten: schalterModus(config.doppelKonten),
    artikel: schalterModus(config.doppelArtikel),
    bestellung: schalterModus(config.doppelBestellnummer),
    datum: schalterModus(config.doppelDatum),
    kontenArtikel: schalterModus(config.doppelKontenArtikel),
    // Code-Default AN (Nachprüfung 05.10.2026, siehe Kopf).
    seite: schalterModusStandardAn(config.doppelOnlineSeite),
    kontenDatum: schalterModus(config.doppelKontenDatum),
    bild: schalterModusStandardAn(config.doppelBildAehnlich),
    // Code-Default BEOBACHTUNG (Nachprüfung 06.10.2026, siehe Kopf): erst
    // messen, wie oft ehrliche Paare so aussehen; true hält in der Prüfung.
    seiteAbweichend: schalterModusStandardBeobachtung(config.doppelSeiteAbweichend),
    // Untergrenze 0,5: darunter lag in der Messung kein Wert mehr gemessen, und
    // ein Tippfehler (0.06) sperrte sonst echte Zweitkäufe.
    schwelle: Number.isFinite(schwelle) && schwelle >= 0.5 && schwelle <= 1 ? schwelle : 0.6,
    minArtikel: Number.isInteger(minArtikel) && minArtikel >= 3 ? minArtikel : 5,
  };
}

/** Schalterstand für den Vermerk am Bon (`receipts.doppelPruefung.modi`). */
function modiVermerk(modi = {}) {
  const { summe, konten, artikel, bestellung, datum, kontenArtikel, seite, kontenDatum, bild, seiteAbweichend } = modi;
  return {
    summe: summe ?? false,
    konten: konten ?? false,
    artikel: artikel ?? false,
    bestellung: bestellung ?? false,
    datum: datum ?? false,
    kontenArtikel: kontenArtikel ?? false,
    seite: seite ?? false,
    kontenDatum: kontenDatum ?? false,
    bild: bild ?? false,
    seiteAbweichend: seiteAbweichend ?? false,
  };
}

// `seiteAbweichend` und `bild` zuletzt: sie halten nur in der Prüfung fest —
// trifft eine Regel wirksam, die ablehnt, gewinnt die (ein erneut
// fotografierter, schon bezahlter Bon soll abgelehnt werden, nicht einen
// Menschen beschäftigen).
const REGEL_REIHENFOLGE = ['summe', 'konten', 'bestellung', 'seite', 'artikel', 'datum', 'kontenArtikel', 'kontenDatum', 'seiteAbweichend', 'bild'];

// Grund am Bon, wenn Regel `bild` wirksam trifft: Prüfung durch einen Menschen.
const BILD_GRUND = 'bild_aehnlich_bezahlt';
// … gegen einen Kandidaten, der noch nicht entschieden ist (06.10.2026).
const BILD_OFFEN_GRUND = 'bild_aehnlich_offen';
// Ebenso Regel `seiteAbweichend` (Nachprüfung 06.10.2026).
const SEITE_GRUND = 'seite_abweichend';
// Regeln, die nicht ablehnen, sondern einen Menschen entscheiden lassen.
const PRUEF_REGELN = new Set(['bild', 'seiteAbweichend']);
// Status eines Bild-Kandidaten, der noch nicht entschieden ist (Regel bild).
const BILD_OFFEN_STATUS = new Set(['ocr_pending', 'review']);
// Status eines Bild-Kandidaten, der Geld bekommen hat (Reihenfolge beim Kürzen).
const BILD_BEZAHLT_STATUS = new Set(['approved', 'paid', 'matched']);
// Wie viele Kandidaten aus `capture.bildAehnlich` Regel bild höchstens prüft
// (je einer ein Bon-Lesevorgang, im Fenster dazu eine Ledger-Abfrage).
// Abschlussprüfung 06.10.2026: mindestens so viele, wie die Bildprüfung beim
// Hochladen überhaupt finden kann — index.js DHASH_DEDUP_LOOKBACK (50 jüngste
// Bons) plus DHASH_EXAKT_FEIN (5 exakte Treffer), Test abschluss0610. Vorher
// 20, neueste zuerst: 20 frisch hochgeladene, noch offene Lockvögel mit
// ähnlichem Bild schoben das bezahlte Original aus der Liste, wurden danach
// abgelehnt, und die bearbeitete Kopie war bezahlt. Gelesen wird nur bei Bons
// mit `capture.bildAehnlich`; beim Kürzen zählt die Reihenfolge von
// bildKandidatenOrdnen (bezahlte zuerst).
const BILD_MAX_KANDIDATEN = 55;
// Regel bild außerhalb des Fensters: Mindestanteil gleicher Artikel (bildTrifft).
const BILD_FERN_ANTEIL = 0.8;

/** Hält ein wirksamer Treffer dieser Regel nur in der Prüfung fest (statt abzulehnen)? */
function nurPruefung(regel) {
  return PRUEF_REGELN.has(regel);
}

// Prüfgründe, unter denen ein Mensch die Zeile „Doppel-Prüfung" vor sich hat
// (die Bon-Runde fasst sie nie an, review-console/src/bonRegeln bearbeitbar).
const PRUEF_GRUENDE = new Set([BILD_GRUND, BILD_OFFEN_GRUND, SEITE_GRUND]);
// … und unter denen eine Freigabe NEUE Treffer quittiert: die Konsole sagt dort
// „mit JEDEM verlinkten Bon vergleichen". Bei `bild_aehnlich_offen` lautet die
// Anweisung „erst den offenen entscheiden" — eine Freigabe dort quittiert
// nichts Neues, sie trägt nur schon Quittiertes weiter.
const QUITTUNG_GRUENDE = new Set([BILD_GRUND, SEITE_GRUND]);

/** Schlüssel eines Treffers für die Quittung: Regel + der andere Bon. */
function trefferSchluessel(t) {
  return `${t.regel}:${t.gegen}`;
}

/** Zeitpunkt als Millisekunden (Firestore-Timestamp, Zahl, Date, {seconds}). */
function zeitMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  const s = typeof v.seconds === 'number' ? v.seconds : typeof v._seconds === 'number' ? v._seconds : null;
  if (s == null) return null;
  const n = typeof v.nanoseconds === 'number' ? v.nanoseconds : typeof v._nanoseconds === 'number' ? v._nanoseconds : 0;
  return s * 1000 + Math.floor(n / 1e6);
}

/**
 * Welche Treffer der Prüfregeln (bild, seiteAbweichend) ein Mensch mit seiner
 * Freigabe QUITTIERT — als Schlüssel `regel:gegen` für doppelUrteil(quittiert).
 *
 * Vierte Prüfrunde 06.10.2026: bis dahin schaltete der Resolver nach dem
 * Prüfgrund am Bon eine ganze Regel ab (`bild_aehnlich_bezahlt` → bild,
 * `seite_abweichend` → seiteAbweichend). Zwei Folgen, beide mit dem echten
 * index.js nachgestellt:
 *   - Ähnelte die Kopie einem bezahlten ANDEREN Einkauf und dem noch offenen
 *     Original, stand der Grund auf `bild_aehnlich_bezahlt`. Der Mensch sah
 *     einen anderen Einkauf und gab frei — die Regel war damit auch für das
 *     offene Original aus, die Kopie wurde gebucht, danach das Original
 *     (es trägt keinen Vermerk). Zwei Gutschriften für einen Einkauf.
 *   - Trafen bild UND seiteAbweichend, schaltete jede Freigabe nur die eine
 *     Regel ab, die andere hielt wieder fest — der Grund wechselte endlos,
 *     ein zweiter echter Einkauf wurde nie bezahlt.
 * Jetzt zählt, was der Mensch in der Zeile „Doppel-Prüfung" vor sich hatte:
 * jeder Treffer einer Prüfregel, der dort wirksam (oder schon quittiert) und
 * gegen einen ENTSCHIEDENEN Bon stand, gilt mit der Freigabe als „anderer
 * Einkauf". Ein noch offener Kandidat wird nie quittiert (wie er ausgeht, sah
 * niemand), ein neuer Treffer ebenso wenig — beide halten weiter fest.
 *
 * Nur, wenn der Mensch GENAU DIESEN Stand gesehen hat: `gesehenMs` (von der
 * Prüfkonsole mitgeschickt) muss `doppelPruefung.at` entsprechen. Wurde der
 * Vermerk inzwischen neu geschrieben (anderer Prüfer, erneute Verarbeitung),
 * quittiert die Freigabe nichts, der Resolver hält fest, und die Konsole lädt
 * den neuen Stand. Neue Quittungen nur bei `bild_aehnlich_bezahlt` und
 * `seite_abweichend` (QUITTUNG_GRUENDE); bei `bild_aehnlich_offen` werden nur
 * schon quittierte Treffer weitergetragen — dort heißt die Anweisung „erst den
 * offenen Bon entscheiden", und wer das befolgt, hat die übrigen Zeilen nicht
 * zwingend verglichen. Die Bon-Runde und andere Gründe quittieren nie.
 * @param {object} o
 * @param {string|null} o.reviewReason   Prüfgrund am Bon
 * @param {object|null} o.doppelPruefung `receipts.doppelPruefung`
 * @param {number|string|null} o.gesehenMs  `doppelPruefung.at`, wie ihn der Mensch sah
 * @returns {string[]}
 */
function quittierteTreffer({ reviewReason = null, doppelPruefung = null, gesehenMs = null } = {}) {
  const grund = String(reviewReason || '');
  if (!PRUEF_GRUENDE.has(grund)) return [];
  const neueQuittung = QUITTUNG_GRUENDE.has(grund);
  const dp = doppelPruefung && typeof doppelPruefung === 'object' ? doppelPruefung : null;
  if (!dp) return [];
  const stand = zeitMs(dp.at);
  const gesehen = gesehenMs == null || gesehenMs === '' ? NaN : Number(gesehenMs);
  if (stand == null || !Number.isFinite(gesehen) || gesehen !== stand) return [];
  const treffer = Array.isArray(dp.treffer) ? dp.treffer : [];
  return [...new Set(treffer
    .filter((t) => t && nurPruefung(t.regel) && (t.modus === 'quittiert' || (neueQuittung && t.modus === 'wirksam'))
      && !t.offen && typeof t.gegen === 'string' && t.gegen)
    .map(trefferSchluessel))];
}

/**
 * Die Kandidaten der Regel bild aus `capture.bildAehnlich` (eigener Bon
 * ausgeschlossen, ohne Doppelte, höchstens BILD_MAX_KANDIDATEN).
 * @returns {string[]}
 */
function bildKandidatenIds(bildAehnlich, bonId) {
  const b = bildAehnlich && typeof bildAehnlich === 'object' ? bildAehnlich : null;
  if (!b) return [];
  const ids = [...(Array.isArray(b.kandidaten) ? b.kandidaten : []), b.kandidat];
  return [...new Set(ids.filter((id) => typeof id === 'string' && id && id !== bonId))].slice(0, BILD_MAX_KANDIDATEN);
}

/**
 * Reihenfolge der Bild-Kandidaten, bevor sie für `capture.bildAehnlich.
 * kandidaten` auf BILD_MAX_KANDIDATEN gekürzt werden (Abschlussprüfung
 * 06.10.2026): zuerst Bons, die Geld bekommen haben, dann noch offene, dann
 * der Rest; innerhalb jeder Gruppe die neuesten zuerst (ein Original liegt
 * höchstens wenige Wochen zurück).
 *
 * Bezahlte zuerst, weil sich nur OFFENE Bons beliebig vermehren lassen: jeder
 * frische Upload ist `ocr_pending`, bis er gelesen ist. Vorher galt allein
 * „neueste zuerst" — 20 Lockvögel kurz vor der Kopie verdrängten das bezahlte
 * Original, wurden abgelehnt, und die Kopie wurde bezahlt (mit dem echten
 * index.js nachgestellt). Bezahlte Bons begrenzen die Tages- und Wochendeckel.
 * Gegen das Verdrängen eines noch OFFENEN Originals hilft nur, dass
 * BILD_MAX_KANDIDATEN alle groben Treffer fasst.
 * @param {Array<{id:string, status?:string|null, ms?:number|null}>} liste
 * @param {string|null} [bonId]  eigener Bon (fällt heraus)
 * @returns {string[]}
 */
function bildKandidatenOrdnen(liste, bonId = null) {
  const rang = (s) => (BILD_BEZAHLT_STATUS.has(s) ? 0 : BILD_OFFEN_STATUS.has(s) ? 1 : 2);
  const gesehen = new Set();
  const eintraege = [];
  for (const k of Array.isArray(liste) ? liste : []) {
    if (!k || typeof k.id !== 'string' || !k.id || k.id === bonId || gesehen.has(k.id)) continue;
    gesehen.add(k.id);
    eintraege.push({ id: k.id, rang: rang(k.status), ms: Number.isFinite(k.ms) ? k.ms : 0 });
  }
  return eintraege
    .sort((a, b) => a.rang - b.rang || b.ms - a.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => e.id)
    .slice(0, BILD_MAX_KANDIDATEN);
}

/**
 * Anteil gleicher Artikel zweier Lesungen für Regel bild — wie vergleiche(),
 * aber ohne Marktbedingung (die Regel ist seit 06.10.2026 marktunabhängig).
 * null, wenn eine Lesung weniger als `minArtikel` Artikel hat.
 */
function bildAnteil(neu, alt, modi = {}) {
  if (!neu || !alt) return null;
  const minArtikel = modi.minArtikel ?? 5;
  const rabatt = Boolean(neu.rabatt || alt.rabatt);
  return mitNamen(
    anteilAus(neu.artikel, alt.artikel, minArtikel),
    rabatt ? anteilAus(artikelNamen(neu.artikel), artikelNamen(alt.artikel), minArtikel) : null,
    rabatt,
  );
}

/**
 * Regel bild (Nachprüfung 05.10.2026, Markt seit 06.10.2026 egal): passt ein
 * Kandidat aus `capture.bildAehnlich` (Bon derselben Person) zur neuen
 * Lesung? Bon-Tag höchstens DATUM_FENSTER_TAGE daneben. Ein noch offener
 * Kandidat (`offen`) ohne gelesenes Datum gilt als im Fenster — er wird ja
 * erst gelesen. Ob er bezahlt bzw. offen ist, prüft der Aufrufer (Ledger,
 * Status).
 *
 * Weiter weg (dritte Prüfrunde 06.10.2026): mit scharfem Feinvergleich sperrt
 * der grobe Bildvergleich (120 Tage Rückschau) eine beschnittene Kopie nicht
 * mehr — eine Kopie mit dem Datum „gestern" zu einem 15 Tage alten Original
 * war bezahlt. Darum trifft die Regel auch außerhalb des Fensters, wenn
 * zusätzlich der Artikelanteil (`anteil`, bildAnteil) mindestens
 * BILD_FERN_ANTEIL erreicht: gemessen „gleiche Person, gleicher Markt, 1–95
 * Tage, Anteil ≥ 0,8" — 0 von 11.442 bezahlten Paaren, höchster ehrlicher Wert
 * 0,75; eine Kopie mit einem geänderten von zehn Preisen liegt bei 0,9. Weiter
 * als der grobe Bildvergleich reicht keiner der Kandidaten zurück.
 * @param {object} neu        identitaet()
 * @param {{tag?:string|null, offen?:boolean, anteil?:number|null}} kandidat
 * @param {object} [modi]     doppelModi() (Schwelle)
 * @returns {{abstand:number|null, fern?:true}|null}
 */
function bildTrifft(neu, kandidat, modi = {}) {
  if (!neu || !kandidat || !neu.tag) return null;
  const abstand = tageAbstand(neu.tag, kandidat.tag);
  if (abstand == null) return kandidat.offen === true ? { abstand: null } : null;
  if (abstand <= DATUM_FENSTER_TAGE) return { abstand };
  const schwelle = Math.max(modi.schwelle ?? 0.6, BILD_FERN_ANTEIL);
  return Number.isFinite(kandidat.anteil) && kandidat.anteil >= schwelle ? { abstand, fern: true } : null;
}

/**
 * Regel kontenArtikel, erster Schritt: welche Einträge des Tages-Index
 * (FREMDE Konten) erreichen die Schwelle? Ob ihr Bon noch bezahlt ist, prüft
 * der Aufrufer danach — nur für diese wenigen Einträge.
 * @param {object} o
 * @param {string} o.bonId
 * @param {string} o.uid
 * @param {object} o.neu         identitaet()
 * @param {object} o.eintraege   `cashback_bon_tage/{…}.eintraege`
 * @param {object} o.modi        doppelModi()
 * @returns {Array<{id:string, uid:string, anteil:number}>}
 */
function kontenArtikelKandidaten({ bonId, uid, neu, eintraege, modi = {} }) {
  const minArtikel = modi.minArtikel ?? 5;
  const schwelle = modi.schwelle ?? 0.6;
  const a = artikelHashes(neu && neu.artikel);
  if (a.length < minArtikel || !eintraege || typeof eintraege !== 'object') return [];
  // Gleich lang gekürzt wie die gespeicherten Namen (namenFelder).
  const n = namenHashes(neu && neu.artikel, MAX_PERSON_ARTIKEL);
  const out = [];
  for (const [id, e] of Object.entries(eintraege)) {
    if (!e || id === bonId || !e.u || e.u === uid) continue;
    const rabatt = Boolean((neu && neu.rabatt) || e.k);
    const anteil = mitNamen(anteilAus(a, e.a, minArtikel), rabatt ? anteilAus(n, e.n, minArtikel) : null, rabatt);
    if (anteil != null && anteil >= schwelle) out.push({ id, uid: e.u, anteil: Math.round(anteil * 1000) / 1000 });
  }
  return out.sort((x, y) => y.anteil - x.anteil);
}

/** Namens-Hashes (ohne Preis) für die Indizes; höchstens MAX_ARTIKEL. */
function namenHashes(artikel, max = MAX_ARTIKEL) {
  return artikelHashes(artikelNamen(artikel)).slice(0, max);
}

/**
 * Felder für den Namensvergleich in den Indizes (Nachprüfung 05.10.2026,
 * Runde 2): `n` = Namens-Hashes, `k` = die Lesung führt einen Warenkorb-
 * Rabatt. Einträge davor haben `n` nicht — dort bleibt es beim Preisvergleich.
 */
function namenFelder(id, max = MAX_PERSON_ARTIKEL) {
  return {
    n: namenHashes(id && id.artikel, max),
    ...(id && id.rabatt ? { k: true } : {}),
  };
}

/** Eintrag eines Bons im Tages-Index (Regel kontenArtikel). */
function tagesEintragAus(uid, id) {
  return { u: uid, a: artikelHashes(id && id.artikel), ...namenFelder(id) };
}

/** Eintrag eines Bons im Summen-Index (Regel kontenDatum). */
function summenEintragAus(uid, id) {
  return { u: uid, t: (id && id.tag) || null, z: (id && id.uhrzeit) || null, a: artikelHashes(id && id.artikel), ...namenFelder(id) };
}

/**
 * Summen-Index, erster Schritt: welche Einträge (alle Konten, gleiche Summe
 * und gleicher Markt stecken schon im Dokument) liegen an einem ANDEREN Tag
 * und passen? Ob ihr Bon noch bezahlt ist, prüft der Aufrufer.
 *
 *   gleiche Person (`uid`, Regel datum)   bis SUMMEN_AUFBEWAHRUNG_TAGE:
 *                                         gleiche Uhrzeit ODER Artikel ≥ Schwelle
 *   anderes Konto (Regel kontenDatum)     bis DATUM_FENSTER_TAGE: ebenso;
 *                                         darüber nur Artikel ≥ Schwelle
 *
 * Warum so (Prüfrunde 3, 6.420 bezahlte Bons, 9–95 Tage Abstand): dieselbe
 * Person mit gleicher Summe und Uhrzeit — genau 1 Paar, die echte
 * Doppelzahlung vom 02.10.; verschiedene Konten mit gleicher Summe und Uhrzeit
 * — 2 echte Zufälle, mit Artikeln ≥ 0,6 — 0.
 * `gleichePerson`/`fremde` = false lassen die jeweilige Seite weg (Regel aus).
 * @returns {Array<{id:string, uid:string, tag:string, abstand:number, anteil:number|null, gleicheZeit:boolean}>}
 */
function kontenDatumKandidaten({ bonId, uid = null, neu, eintraege, modi = {}, gleichePerson = true, fremde = true }) {
  const minArtikel = modi.minArtikel ?? 5;
  const schwelle = modi.schwelle ?? 0.6;
  if (!neu || !neu.tag || !eintraege || typeof eintraege !== 'object') return [];
  const a = artikelHashes(neu.artikel);
  // Gleich lang gekürzt wie die gespeicherten Namen (namenFelder).
  const n = namenHashes(neu.artikel, MAX_PERSON_ARTIKEL);
  const out = [];
  for (const [id, e] of Object.entries(eintraege)) {
    if (!e || id === bonId || !e.u || !e.t || e.t === neu.tag) continue;
    const abstand = tageAbstand(neu.tag, e.t);
    if (abstand == null || abstand > SUMMEN_AUFBEWAHRUNG_TAGE) continue;
    const selbe = Boolean(uid) && e.u === uid;
    if (selbe ? !gleichePerson : !fremde) continue;
    const gleicheZeit = Boolean(neu.uhrzeit) && neu.uhrzeit === e.z;
    const rabatt = Boolean(neu.rabatt || e.k);
    const roh = mitNamen(anteilAus(a, e.a, minArtikel), rabatt ? anteilAus(n, e.n, minArtikel) : null, rabatt);
    const anteil = roh == null ? null : Math.round(roh * 1000) / 1000;
    const artikelPasst = anteil != null && anteil >= schwelle;
    const trifft = selbe || abstand <= DATUM_FENSTER_TAGE ? gleicheZeit || artikelPasst : artikelPasst;
    if (trifft) out.push({ id, uid: e.u, tag: e.t, abstand, anteil, gleicheZeit });
  }
  return out.sort((x, y) => Number(y.gleicheZeit) - Number(x.gleicheZeit) || (y.anteil ?? 0) - (x.anteil ?? 0));
}

/**
 * Einträge des Summen-Index, die zu alt sind, um noch zu zählen (Tag mehr als
 * SUMMEN_AUFBEWAHRUNG_TAGE vor `heute`). Die IDs räumt die Gutschrift weg.
 */
function veralteteSummenEintraege(eintraege, heute, tage = SUMMEN_AUFBEWAHRUNG_TAGE) {
  if (!eintraege || typeof eintraege !== 'object') return [];
  const h = tagNormal(heute);
  if (!h) return [];
  return Object.entries(eintraege)
    .filter(([, e]) => !e || !e.t || (e.t < h && tageAbstand(h, e.t) > tage))
    .map(([id]) => id);
}

/**
 * Eine Lesung eines bezahlten Bons im Personen-Index; null ohne Tag.
 * `ps` = Summe der positiven Artikel, `n` = Namens-Hashes (ohne Preis,
 * höchstens MAX_PERSON_NAMEN), `k` = die Lesung führt einen Warenkorb-Rabatt
 * als eigene Zeile — damit greift die Regel datum auch über 8 Tage hinaus bei
 * einer eingefügten Coupon-/Leergut-Zeile und über den Prompt-Wechsel v1.4 ↔
 * v1.5 (Nachprüfung 06.10.2026; vorher nur Tageszähler und Summen-Index).
 */
function personLesungAus(id) {
  if (!id || !id.tag) return null;
  return {
    t: id.tag,
    m: id.markt ?? null,
    z: id.uhrzeit ?? null,
    s: Number.isInteger(id.summe) ? id.summe : null,
    as: Number.isInteger(id.artikelSumme) ? id.artikelSumme : null,
    ps: Number.isInteger(id.positivSumme) ? id.positivSumme : null,
    a: artikelHashes(id.artikel).slice(0, MAX_PERSON_ARTIKEL),
    ...namenFelder(id, MAX_PERSON_NAMEN),
  };
}

const lesungenVon = (e) => (e && Array.isArray(e.l) ? e.l.filter((x) => x && typeof x === 'object') : []);
// `ps` fehlt in Lesungen ohne positive Artikel (null) — dann gleich wie bisher.
const gleicheLesung = (x, y) => x.t === y.t && x.m === y.m && x.z === y.z && x.s === y.s && x.as === y.as
  && (x.ps ?? null) === (y.ps ?? null);

/**
 * Geschätzte Speichergröße eines Werts nach den Firestore-Regeln (Zeichenkette
 * = UTF-8-Bytes + 1, Zahl 8, Wahrheitswert/null 1, Map = Feldnamen + 1 plus
 * Werte, Array = Summe der Elemente). Für die Größenbremse des Personen-Index.
 */
function speicherGroesse(v) {
  if (v == null || typeof v === 'boolean') return 1;
  if (typeof v === 'number') return 8;
  if (typeof v === 'string') return Buffer.byteLength(v, 'utf8') + 1;
  if (Array.isArray(v)) return v.reduce((s, x) => s + speicherGroesse(x), 0);
  if (typeof v === 'object') {
    let s = 0;
    for (const [k, x] of Object.entries(v)) s += Buffer.byteLength(k, 'utf8') + 1 + speicherGroesse(x);
    return s;
  }
  return 8;
}

/**
 * Neuer Wert des eigenen Eintrags im Personen-Index: die bisherigen Lesungen
 * um die aktuelle ERGÄNZT (nie ersetzt — der Bon sperrt unter jeder Lesung),
 * höchstens MAX_PERSON_LESUNGEN (die erste und die jüngste). null, wenn sich
 * nichts ändert.
 */
function personEintragWert(alt, lesung) {
  if (!lesung) return null;
  const bisher = lesungenVon(alt);
  if (bisher.some((x) => gleicheLesung(x, lesung))) return null;
  const l = bisher.length >= MAX_PERSON_LESUNGEN ? [bisher[0], lesung] : [...bisher, lesung];
  return { l };
}

/**
 * Welche Einträge des Personen-Index fallen weg? Alle, deren jüngste Lesung
 * mehr als PERSON_AUFBEWAHRUNG_TAGE vor `heute` liegt, und — ist das Dokument
 * danach noch voll (MAX_PERSON_EINTRAEGE Bons oder geschätzt mehr als
 * MAX_PERSON_BYTES, `neuWert` für `neuId` eingerechnet) — die ältesten, bis
 * Platz ist. Der Eintrag `neuId` selbst fällt nie weg.
 * @param {object} eintraege
 * @param {string} heute  YYYY-MM-DD
 * @param {string|null} neuId
 * @param {{tage?:number, neuWert?:object|null, maxBytes?:number}} opts
 */
function personAufraeumen(eintraege, heute, neuId = null, { tage = PERSON_AUFBEWAHRUNG_TAGE, neuWert = null, maxBytes = MAX_PERSON_BYTES } = {}) {
  if (!eintraege || typeof eintraege !== 'object') return [];
  const h = tagNormal(heute);
  const juengster = (e) => lesungenVon(e).map((x) => tagNormal(x.t)).filter(Boolean).sort().pop() || null;
  const weg = [];
  const bleiben = [];
  for (const [id, e] of Object.entries(eintraege)) {
    if (id === neuId) continue;
    const t = juengster(e);
    if (!t || (h && t < h && tageAbstand(h, t) > tage)) weg.push(id);
    else bleiben.push([id, t, Buffer.byteLength(id, 'utf8') + 1 + speicherGroesse(e)]);
  }
  bleiben.sort((x, y) => (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0));
  const platz = MAX_PERSON_EINTRAEGE - (neuId ? 1 : 0);
  let i = 0;
  while (bleiben.length - i > platz) weg.push(bleiben[i++][0]);
  // Größenbremse: Dokument-Grundlast (Name, updatedAt, Feld `eintraege`) ist
  // gegen 1 MiB vernachlässigbar, die Grenze lässt dafür ~300 KB Luft.
  let bytes = (neuId ? Buffer.byteLength(neuId, 'utf8') + 1 + speicherGroesse(neuWert || eintraege[neuId] || null) : 0)
    + bleiben.slice(i).reduce((s, x) => s + x[2], 0);
  while (bytes > maxBytes && i < bleiben.length) {
    bytes -= bleiben[i][2];
    weg.push(bleiben[i++][0]);
  }
  return weg;
}

/**
 * Regel datum über den Personen-Index: welche bezahlten Bons DERSELBEN Person
 * (jeder Markt, 1–PERSON_AUFBEWAHRUNG_TAGE Tage daneben) passen? Dieselbe
 * Bedingung wie im Fenster des Tageszählers (doppelUrteil, `andererTag`):
 * gleiche Uhrzeit → Endsumme ODER Artikel ≥ Schwelle; ohne sie → (Endsumme
 * ODER Artikelsumme ODER Positivsumme) UND Artikel ≥ Schwelle. Ob ihr Bon noch bezahlt ist,
 * prüft der Aufrufer (Ledger).
 * @returns {Array<{id:string, tag:string, abstand:number, anteil:number|null, gleicheZeit:boolean, andererMarkt:boolean}>}
 */
function personKandidaten({ bonId, neu, eintraege, modi = {} }) {
  const minArtikel = modi.minArtikel ?? 5;
  const schwelle = modi.schwelle ?? 0.6;
  if (!neu || !neu.tag || !eintraege || typeof eintraege !== 'object') return [];
  const a = artikelHashes(neu.artikel).slice(0, MAX_PERSON_ARTIKEL);
  // Gleich lang gekürzt wie die gespeicherten Namen — sonst teilte der Anteil
  // durch die kürzere, abgeschnittene Liste.
  const n = namenHashes(neu.artikel, MAX_PERSON_NAMEN);
  const out = [];
  for (const [id, e] of Object.entries(eintraege)) {
    if (id === bonId) continue;
    let bester = null;
    for (const r of lesungenVon(e)) {
      if (!r.t || r.t === neu.tag) continue;
      const abstand = tageAbstand(neu.tag, r.t);
      if (abstand == null || abstand < 1 || abstand > PERSON_AUFBEWAHRUNG_TAGE) continue;
      const gleicheZeit = Boolean(neu.uhrzeit) && neu.uhrzeit === r.z;
      const summe = Number.isInteger(neu.summe) && neu.summe > 0 && neu.summe === r.s;
      const artikelSumme = Number.isInteger(neu.artikelSumme) && neu.artikelSumme > 0 && neu.artikelSumme === r.as;
      const positivSumme = Number.isInteger(neu.positivSumme) && neu.positivSumme > 0 && neu.positivSumme === r.ps;
      // Namensvergleich wie in den anderen Indizes (mitNamen): nur, wenn eine
      // der Lesungen einen Warenkorb-Rabatt führt. Lesungen ohne `n` (vor dem
      // Nachtrag) bleiben beim Preisvergleich.
      const rabatt = Boolean(neu.rabatt || r.k);
      const roh = mitNamen(anteilAus(a, r.a, minArtikel), rabatt ? anteilAus(n, r.n, minArtikel) : null, rabatt);
      const anteil = roh == null ? null : Math.round(roh * 1000) / 1000;
      const artikelPasst = anteil != null && anteil >= schwelle;
      const trifft = gleicheZeit ? summe || artikelPasst : (summe || artikelSumme || positivSumme) && artikelPasst;
      if (!trifft) continue;
      const k = { id, tag: r.t, abstand, anteil, gleicheZeit, andererMarkt: Boolean(neu.markt) && Boolean(r.m) && neu.markt !== r.m };
      if (!bester || Number(k.gleicheZeit) > Number(bester.gleicheZeit) || (k.anteil ?? 0) > (bester.anteil ?? 0)) bester = k;
    }
    if (bester) out.push(bester);
  }
  return out.sort((x, y) => Number(y.gleicheZeit) - Number(x.gleicheZeit) || (y.anteil ?? 0) - (x.anteil ?? 0));
}

/**
 * Das Urteil über einen noch nicht gebuchten Bon.
 *
 * @param {object} o
 * @param {string} o.bonId
 * @param {string} o.uid
 * @param {object} o.neu         identitaet() des Bons
 * @param {Array<{id:string, eintrag:object, tag?:string}>} o.andere  BEZAHLTE
 *        Bons derselben Person (eigener Bon ausgeschlossen), jeder Markt.
 *        Ohne `tag` bzw. mit dem Tag des Bons: Regeln summe/artikel/seite/
 *        seiteAbweichend. Mit einem anderen Tag: Regeln datum, seite (online,
 *        ±8) und seiteAbweichend (online ±8, App genau ±1).
 * @param {Array<{id:string, regel:'konten'|'bestellung', besitzer:{receiptId:string, uid:string}|null, lebendig:boolean}>} o.schluessel
 * @param {Array<{id:string, uid:string, anteil:number, lebendig:boolean}>} o.kontenArtikel
 * @param {Array<{id:string, uid:string, tag:string, abstand?:number, anteil:number|null, gleicheZeit:boolean, lebendig:boolean}>} o.kontenDatum
 *        Kandidaten aus dem Summen-Index (kontenDatumKandidaten): eigene →
 *        Regel datum, fremde → Regel kontenDatum.
 * @param {Array<{id:string, tag:string, abstand:number, anteil:number|null, gleicheZeit:boolean, andererMarkt:boolean, lebendig:boolean}>} o.person
 *        Kandidaten aus dem Personen-Index (personKandidaten) → Regel datum.
 * @param {Array<{id:string, markt:string|null, tag:string|null, lebendig:boolean, offen?:boolean, anteil?:number|null}>} o.bild
 *        Kandidaten aus `capture.bildAehnlich` (nur dieselbe Person) → Regel
 *        bild (hält in der Prüfung, lehnt nicht ab). `lebendig` = laut Ledger
 *        bezahlt, `offen` = noch nicht entschieden (BILD_OFFEN_STATUS),
 *        `anteil` = bildAnteil() gegen die Lesung des Kandidaten (außerhalb
 *        des Fensters, bildTrifft).
 * @param {object} o.modi        doppelModi()
 * @param {string[]} [o.quittiert]  quittierteTreffer(): Treffer der Prüfregeln,
 *        die ein Mensch mit seiner Freigabe als „anderer Einkauf" bestätigt
 *        hat. Sie bleiben in der Liste (modus 'quittiert'), halten aber nicht
 *        mehr fest. Ablehnende Regeln und offene Kandidaten nie.
 * @returns {{treffer: Array<{regel:string, gegen:string, sameUser:boolean, anteil?:number, modus:'wirksam'|'beobachtung'|'quittiert'}>, wirksam: object|null}}
 */
function doppelUrteil({ bonId, uid, neu, andere = [], schluessel = [], kontenArtikel = [], kontenDatum = [], person = [], bild = [], modi = {}, quittiert = [] }) {
  const treffer = [];
  const modusVon = (regel) => (modi[regel] === true ? 'wirksam' : modi[regel] === 'shadow' ? 'beobachtung' : null);
  const schwelle = modi.schwelle ?? 0.6;
  const rund = (v) => Math.round(v * 1000) / 1000;
  // Regel seite: zwei Teile EINES Belegs — Seiten einer Online-Rechnung oder
  // Bildschirmabschnitte eines App-Kassenbons (Nachprüfung 05.10.2026). Nur,
  // wenn beide dieselbe Art haben (beide online oder beide App), derselbe
  // Markt, und mindestens einer ohne gedruckten Endbetrag — zwei vollständige
  // Belege sind zwei Einkäufe. Zwei VERSCHIEDEN gelesene Bestellnummern oder
  // zwei verschiedene Uhrzeiten heben sie auf.
  const gleicheArt = (eintrag) => (neu.online && eintrag.online) || (neu.app && eintrag.app);
  // Ein nur unsicher erkannter Markt auf einer Seite gilt als gleich
  // (Nachprüfung 06.10.2026, zweite Runde): ein Abschnitt ohne Kopf wurde über
  // den Tippfehler-Abgleich „dm" und einzeln bezahlt.
  const marktGilt = (v, eintrag) => v.gleicherMarkt || Boolean(neu.marktUnsicher) || Boolean(eintrag.marktUnsicher);
  const seiteBasis = (v, eintrag) => marktGilt(v, eintrag) && gleicheArt(eintrag) && (neu.ohneSumme || eintrag.ohneSumme);
  const andereNummer = (eintrag) => Boolean(neu.bestellHash) && Boolean(eintrag.bestellHash) && neu.bestellHash !== eintrag.bestellHash;
  const andereZeit = (eintrag) => Boolean(neu.uhrzeit) && Boolean(eintrag.uhrzeit) && neu.uhrzeit !== eintrag.uhrzeit;
  const seiteTrifft = (v, eintrag) => seiteBasis(v, eintrag) && !andereNummer(eintrag) && !andereZeit(eintrag);
  const appFeld = (eintrag) => (neu.app && eintrag.app ? { app: true } : {});
  // Gemischte Art (dritte Prüfrunde 06.10.2026): eine Rechnungsseite als
  // Online-Bestellung, ein weiterer Teil als App-Kassenbon — beide setzen ohne
  // gedruckte Summe die Artikelsumme ein (lib/belegart.js), Regel seite griff
  // nicht (sie verlangt dieselbe Art). Nur am selben Tag und nur als
  // seiteAbweichend (Prüfung, `abweichend: ['belegart']`): nicht gemessen.
  const artGemischt = (eintrag) => (neu.online || neu.app) && (eintrag.online || eintrag.app) && !gleicheArt(eintrag);
  const gemischtBasis = (v, eintrag) => marktGilt(v, eintrag) && artGemischt(eintrag) && (neu.ohneSumme || eintrag.ohneSumme);
  // Regel seiteAbweichend (Nachprüfung 06.10.2026): seite träfe, nur ein
  // aufhebendes Merkmal weicht ab — eine andere Uhrzeit, eine andere
  // Bestellnummer, bei einem App-Bon ein Bon-Tag genau 1 daneben. Mit EINEM
  // geänderten Feld je Abschnitt bzw. Seite wäre sonst jeder einzeln bezahlt.
  // Weil zwei echte Einkäufe genauso aussehen können (zwei App-Bons eines
  // Tages, einer abgeschnitten), hält sie nur in der Prüfung fest.
  const abweichung = (eintrag, tagDaneben) => [
    ...(andereZeit(eintrag) ? ['uhrzeit'] : []),
    ...(andereNummer(eintrag) ? ['bestellnummer'] : []),
    ...(tagDaneben ? ['tag'] : []),
  ];
  if (neu && neu.markt) {
    for (const { id, eintrag, tag } of andere) {
      if (!eintrag || id === bonId || !eintrag.markt) continue;
      const v = vergleiche(neu, eintrag, modi);
      const artikelPasst = v.anteil != null && v.anteil >= schwelle;
      const gleicheZeit = Boolean(neu.uhrzeit) && neu.uhrzeit === eintrag.uhrzeit;
      // Anderer Markt (Prüfrunde 3: Händlername im Kopf geändert): am Treffer
      // vermerkt, damit die Beobachtung ihn getrennt auswerten kann.
      const marktFeld = v.gleicherMarkt ? {} : { andererMarkt: true };
      const andererTag = Boolean(tag) && tag !== neu.tag;
      if (andererTag) {
        // Regel seite auch an einem anderen Tag im Fenster (Nachprüfung
        // 05.10.2026): sonst genügte es, auf EINER Seite das Datum zu ändern,
        // und jede Seite wurde bezahlt — am Tageslimit vorbei. Nur für
        // Online-Rechnungen: App-Bons derselben Person tragen über Tage hinweg
        // oft keine Uhrzeit (36 ehrliche Lidl-Paare in 1–8 Tagen).
        const abstand = tageAbstand(neu.tag, tag);
        const onlineFenster = neu.online && eintrag.online && abstand != null && abstand <= DATUM_FENSTER_TAGE;
        if (modusVon('seite') && onlineFenster && seiteTrifft(v, eintrag)) {
          treffer.push({ regel: 'seite', gegen: id, sameUser: true, tag, ...marktFeld, modus: modusVon('seite') });
        }
        // Regel seiteAbweichend an einem anderen Tag: Online-Seite im Fenster
        // mit anderer Uhrzeit/Bestellnummer, App-Abschnitt genau 1 Tag daneben.
        if (modusVon('seiteAbweichend') && seiteBasis(v, eintrag)
          && ((onlineFenster && !seiteTrifft(v, eintrag)) || (neu.app && eintrag.app && abstand === 1))) {
          treffer.push({
            regel: 'seiteAbweichend', gegen: id, sameUser: true, tag,
            abweichend: abweichung(eintrag, neu.app && eintrag.app && abstand === 1),
            ...appFeld(eintrag),
            ...marktFeld,
            modus: modusVon('seiteAbweichend'),
          });
        }
        // Regel datum. Mit derselben Uhrzeit genügt Summe ODER Artikel; ohne
        // sie (verdeckt, geändert) braucht es Summe UND Artikel — Gewohnheits-
        // käufe über Tage hinweg erreichen den Artikelanteil, aber nie
        // dieselbe Summe (0 von 3.834 Paaren). Als Summe zählt auch die
        // gleiche Artikelsumme (nur die gedruckte Endsumme geändert; 0 von
        // 3.834 Paaren) und die gleiche Summe der positiven Artikel (nur eine
        // Coupon-/Leergut-Zeile eingefügt oder geändert, positivSummeVon).
        if (!modusVon('datum')) continue;
        const summePasst = v.summe || v.artikelSumme || v.positivSumme;
        if (gleicheZeit ? (v.summe || artikelPasst) : (summePasst && artikelPasst)) {
          treffer.push({
            regel: 'datum', gegen: id, sameUser: true, tag,
            ...(v.anteil != null ? { anteil: rund(v.anteil) } : {}),
            ...(gleicheZeit ? {} : { ohneUhrzeit: true }),
            ...(!gleicheZeit && !v.summe ? { nurArtikelSumme: true } : {}),
            ...(!gleicheZeit && !v.summe && !v.artikelSumme ? { nurPositivSumme: true } : {}),
            ...marktFeld,
            modus: modusVon('datum'),
          });
        }
        continue;
      }
      // Regel summe: im selben Markt allein; in einem anderen Markt nur mit
      // gleicher Uhrzeit (0 von 6.575 Paaren gleiche Person, anderer Markt).
      if (v.summe && (v.gleicherMarkt || gleicheZeit) && modusVon('summe')) {
        treffer.push({ regel: 'summe', gegen: id, sameUser: true, ...marktFeld, modus: modusVon('summe') });
      }
      if (artikelPasst && modusVon('artikel')) {
        treffer.push({ regel: 'artikel', gegen: id, sameUser: true, anteil: rund(v.anteil), ...marktFeld, modus: modusVon('artikel') });
      }
      // Regel seite (siehe seiteTrifft).
      if (modusVon('seite') && seiteTrifft(v, eintrag)) {
        treffer.push({ regel: 'seite', gegen: id, sameUser: true, ...appFeld(eintrag), ...marktFeld, modus: modusVon('seite') });
      }
      // Regel seiteAbweichend am selben Tag: alles wie seite, nur Uhrzeit oder
      // Bestellnummer verschieden — oder die Art (gemischtBasis).
      const gemischt = gemischtBasis(v, eintrag);
      if (modusVon('seiteAbweichend') && ((seiteBasis(v, eintrag) && !seiteTrifft(v, eintrag)) || gemischt)) {
        treffer.push({
          regel: 'seiteAbweichend', gegen: id, sameUser: true,
          abweichend: [...(gemischt ? ['belegart'] : []), ...abweichung(eintrag, false)],
          ...appFeld(eintrag),
          ...marktFeld,
          modus: modusVon('seiteAbweichend'),
        });
      }
    }
  }
  for (const s of schluessel) {
    if (!s || !s.besitzer || !s.lebendig) continue;
    if (s.besitzer.receiptId === bonId) continue;
    const modus = modusVon(s.regel);
    if (!modus) continue;
    treffer.push({ regel: s.regel, gegen: s.besitzer.receiptId, sameUser: s.besitzer.uid === uid, modus });
  }
  for (const k of kontenArtikel) {
    if (!k || !k.lebendig || k.id === bonId || k.uid === uid) continue;
    const modus = modusVon('kontenArtikel');
    if (!modus) continue;
    treffer.push({ regel: 'kontenArtikel', gegen: k.id, sameUser: false, anteil: k.anteil, modus });
  }
  // Summen-Index: Einträge derselben Person gehören zur Regel datum (Schalter
  // doppelDatum, reicht so über das Fenster des Tageszählers hinaus —
  // Prüfrunde 3), Einträge anderer Konten zur Regel kontenDatum. Einen Bon,
  // den der Tageszähler schon unter derselben Regel gemeldet hat, nicht doppelt.
  for (const k of kontenDatum) {
    if (!k || !k.lebendig || k.id === bonId) continue;
    const selbe = Boolean(uid) && k.uid === uid;
    const regel = selbe ? 'datum' : 'kontenDatum';
    const modus = modusVon(regel);
    if (!modus) continue;
    if (treffer.some((t) => t.regel === regel && t.gegen === k.id)) continue;
    treffer.push({
      regel, gegen: k.id, sameUser: selbe, tag: k.tag,
      ...(k.anteil != null ? { anteil: k.anteil } : {}),
      ...(k.gleicheZeit ? {} : { ohneUhrzeit: true }),
      ...(Number.isInteger(k.abstand) && k.abstand > DATUM_FENSTER_TAGE ? { abstand: k.abstand } : {}),
      modus,
    });
  }
  // Personen-Index (Nachprüfung 05.10.2026): dieselbe Person, jeder Markt, bis
  // 95 Tage — Regel datum. Einen Bon, den Tageszähler oder Summen-Index schon
  // unter datum gemeldet haben, nicht doppelt.
  for (const k of person) {
    if (!k || !k.lebendig || k.id === bonId) continue;
    const modus = modusVon('datum');
    if (!modus) break;
    if (treffer.some((t) => t.regel === 'datum' && t.gegen === k.id)) continue;
    treffer.push({
      regel: 'datum', gegen: k.id, sameUser: true, tag: k.tag, quelle: 'person',
      ...(k.anteil != null ? { anteil: k.anteil } : {}),
      ...(k.gleicheZeit ? {} : { ohneUhrzeit: true }),
      ...(k.andererMarkt ? { andererMarkt: true } : {}),
      ...(Number.isInteger(k.abstand) && k.abstand > DATUM_FENSTER_TAGE ? { abstand: k.abstand } : {}),
      modus,
    });
  }
  // Regel bild (Nachprüfung 05.10.2026): Bild ähnlich einem Bon derselben
  // Person, vom Feinvergleich nicht als dasselbe bestätigt, Bon-Tag ±8 →
  // Prüfung durch einen Menschen. Seit 06.10.2026 (zweite Runde) jeder Markt
  // und auch gegen einen noch OFFENEN Kandidaten. Offene zuerst (vierte
  // Prüfrunde 06.10.2026, vorher bezahlte zuerst): ähnelt die Kopie einem
  // bezahlten anderen Einkauf UND dem noch offenen Original, wartet sie auf
  // das Original (bildWarten in index.js) bzw. steht als
  // `bild_aehnlich_offen` in der Prüfung — „erst den anderen entscheiden".
  // Mit bezahlten zuerst ging sie sofort als `bild_aehnlich_bezahlt` an einen
  // Menschen, der nur den anderen Einkauf verglich.
  const bildListe = bild.filter((k) => k && k.id !== bonId && (k.lebendig || k.offen))
    .sort((a, b) => Number(Boolean(a.lebendig)) - Number(Boolean(b.lebendig)));
  for (const k of bildListe) {
    const modus = modusVon('bild');
    if (!modus) break;
    const offen = !k.lebendig;
    const t = bildTrifft(neu, { tag: k.tag, offen, anteil: k.anteil }, modi);
    if (!t) continue;
    if (treffer.some((x) => x.regel === 'bild' && x.gegen === k.id)) continue;
    const kMarkt = k.markt ? String(k.markt).toLowerCase() : null;
    treffer.push({
      regel: 'bild', gegen: k.id, sameUser: true, tag: k.tag ?? null, abstand: t.abstand,
      ...(t.fern ? { anteil: rund(k.anteil) } : {}),
      ...(offen ? { offen: true } : {}),
      ...(kMarkt && neu.markt && kMarkt !== neu.markt ? { andererMarkt: true } : {}),
      modus,
    });
  }
  // Quittung (quittierteTreffer): Treffer einer Prüfregel gegen einen
  // entschiedenen Bon, den ein Mensch schon als „anderer Einkauf" freigegeben
  // hat, hält nicht mehr fest. Er bleibt in der Liste, damit die Prüfkonsole
  // ihn weiter zeigt und eine weitere Freigabe ihn wieder quittiert.
  if (Array.isArray(quittiert) && quittiert.length) {
    const q = new Set(quittiert);
    for (const t of treffer) {
      if (t.modus === 'wirksam' && nurPruefung(t.regel) && !t.offen && q.has(trefferSchluessel(t))) t.modus = 'quittiert';
    }
  }
  treffer.sort((a, b) => REGEL_REIHENFOLGE.indexOf(a.regel) - REGEL_REIHENFOLGE.indexOf(b.regel));
  const wirksam = treffer.find((t) => t.modus === 'wirksam') || null;
  return { treffer, wirksam };
}

/**
 * Grund-Code am Bon — dieselben Codes wie die Inhaltsprüfung, kein neuer.
 * Ausnahmen Regeln bild und seiteAbweichend (nurPruefung): sie lehnen nicht
 * ab, der Code ist der Prüfgrund.
 */
function grundFuer(t) {
  if (t && t.regel === 'bild') return t.offen ? BILD_OFFEN_GRUND : BILD_GRUND;
  if (t && t.regel === 'seiteAbweichend') return SEITE_GRUND;
  return t && t.sameUser === false ? 'duplicate_content_cross_user' : 'duplicate_content_self';
}

module.exports = {
  SCHLUESSEL_SAMMLUNG,
  TAGE_SAMMLUNG,
  SUMMEN_SAMMLUNG,
  MAX_TAGES_EINTRAEGE,
  MAX_SUMMEN_EINTRAEGE,
  SUMMEN_AUFBEWAHRUNG_TAGE,
  PERSON_SAMMLUNG,
  MAX_PERSON_EINTRAEGE,
  MAX_PERSON_LESUNGEN,
  MAX_PERSON_ARTIKEL,
  PERSON_AUFBEWAHRUNG_TAGE,
  DATUM_FENSTER_TAGE,
  BILD_GRUND,
  BILD_OFFEN_GRUND,
  BILD_OFFEN_STATUS,
  BILD_BEZAHLT_STATUS,
  BILD_MAX_KANDIDATEN,
  BILD_FERN_ANTEIL,
  SEITE_GRUND,
  PRUEF_GRUENDE,
  QUITTUNG_GRUENDE,
  NICHT_ARTIKEL_RE,
  normName,
  artikelSchluessel,
  artikelSummeVon,
  artikelHashes,
  uhrzeitNormal,
  bestellnummerNormal,
  bestellSchluessel,
  kontenSchluessel,
  tagesIndexId,
  summenIndexId,
  tageAbstand,
  tageImFenster,
  identitaet,
  identitaetAusBon,
  eintragAus,
  tagesEintragAus,
  summenEintragAus,
  vergleiche,
  schalterModus,
  schalterModusStandardAn,
  schalterModusStandardBeobachtung,
  doppelModi,
  nurPruefung,
  quittierteTreffer,
  trefferSchluessel,
  bildKandidatenIds,
  bildKandidatenOrdnen,
  bildTrifft,
  bildAnteil,
  marktIstSicher,
  modiVermerk,
  kontenArtikelKandidaten,
  kontenDatumKandidaten,
  veralteteSummenEintraege,
  personLesungAus,
  personEintragWert,
  personAufraeumen,
  personKandidaten,
  speicherGroesse,
  doppelUrteil,
  grundFuer,
};
