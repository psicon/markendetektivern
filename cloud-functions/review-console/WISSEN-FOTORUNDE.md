# Wissen der Morgenrunde (Produktfotos)

Diese Datei IST das Gedächtnis der Morgenrunde. Sie ersetzt einen Chat-Verlauf:
alles, was in den Prüfrunden vom 09.–24.09.2026 Geld oder Nutzer gekostet
hat, steht hier als Regel. Wer die Runde ändert, ändert zuerst diese Datei.

## Was wo liegt

| Teil | Ort |
|---|---|
| Ablauf | `src/taeglicheRunde.js` (Cloud Function `fotoRundeTaeglich`, 08:00 Europe/Berlin) |
| Entscheidungsregeln, Notbremse, Bündeln | `src/fotoRundeRegeln.js` (+ Tests) |
| Doppel-Regel | `src/duplicatePolicy.js` — DIESELBE Datei wie die Prüfkonsole |
| Gesperrte Konten | `src/kontoSperre.js` — liest `cashback_sperren/{uid}` (server-only), Runde UND Konsole |
| Nummer vom Barcode-Foto | `src/werte.js` (`eanFotoBefund`, `eanFotoMitVorbefund`), gelesen in der Bildprüfung, abgelegt in `eanFotoOcr` |
| Barcode-Korrektur (06.10.2026) | `src/werte.js` (`eanKorrekturKandidat`, `eanKorrekturAus`, `strichcodeUrteil`, `eanKorrekturOf`, `eanOf`), abgelegt in `eanKorrektur`; Pflicht-Zeuge `src/strichcode.js` (Strichcode-Leser zxing-wasm 2.2.4); Notbremse `fotoRundeRegeln.korrekturBremse` |
| Halte-Grund für die Prüfkonsole | `review.rundeOffen` (`fotoRundeRegeln.rundeOffenEintrag`), gelesen in `einreichung.precheckOf`; Foto-Befunde früherer Läufe: `fotoRundeRegeln.bildMitVorbefund` |
| Warnungen | `src/warnungen.js` (+ Tests) |
| Buchung + Push | `crowd-upload-reward` (Trigger bei `approved` bucht; der Sammler `crowd_push_sammler` verschickt EINE Nachricht pro Person) |
| Bericht | Firestore `ops_tagesberichte/{lauf}` und `ops_tagesberichte/aktuell` |
| Dashboard | https://md-receipt-admin.web.app/tagesbericht.html (Callable `reviewTagesberichte`) |
| Morgen-Chat | geplante Aufgabe `morgenrunde-bericht` in der Claude-App (08:35/08:48), postet in ClickUp |
| Schalter | `cashback_config/v1.fotoWorker === true` → scharf, sonst Trockenlauf |
| Von Hand anstoßen | HTTP `fotoRundeManuell?key=…` (europe-west1) — ohne Schlüssel 403; scharf nur mit `scharf=1` und eingeschaltetem Schalter |

Die Runde liegt bewusst in der Prüfkonsole und nicht in einer eigenen
Codebase: eine Kopie der Doppel-Regel wäre genau der Fehler vom 20.09.

## Auftrag

Jeden Morgen um 8 Uhr alle offenen Produktfoto-Einreichungen
(`crowd_uploads`, `status: 'pending'`) prüfen, entscheiden, melden.
Freigaben UND Ablehnungen laufen automatisch (Entscheidung Patrick,
24.09.2026). Liegen bleibt nur, was an unserer Technik hängt oder was die
Notbremse zurückhält — das steht im Bericht unter `wartetAufDich`.

## Reihenfolge des Laufs

1. **Offene Einreichungen laden**, älteste zuerst (Server-Zeitpunkt
   `createTime`, siehe unten), dazu die Liste gesperrter Konten.
   Einreichungen gesperrter Konten werden weder nachgelesen noch angesehen —
   sie bleiben stumm liegen.
2. **Nachlesen** fehlender Angaben (Name, EAN, Preis, Hersteller) — siehe unten.
3. **Dateien prüfen**: leer (0 Byte) = Mangel; nicht abrufbar = unsere Technik;
   Identitätsfoto schon in einer älteren Einreichung — gegen ALLE
   Einreichungen, über eine Storage-Liste von `crowduploads/` (6 Seiten, ~3 s
   für 28.741 Dateien, 02.10.2026).
4. **Bildprüfung** aller Fälle, denen kein Foto fehlt. Sie liest im selben
   Aufruf die Nummer unter dem Strichcode des Barcode-Fotos mit (`eanFoto`);
   wo nötig folgt eine zweite Lesung nur dieses Fotos (innerhalb der
   Arbeitszeit). Ein Halte-Befund eines früheren Laufs gilt weiter, bis ein
   Mensch in der Konsole entscheidet — außer der Halt erfüllt das Kriterium
   der Barcode-Korrektur (siehe dort). Die Runde
   legt das Ergebnis in `eanFotoOcr` ab (als Ganzes ersetzt), auch im Trockenlauf.
   **Barcode korrigieren** (seit 06.10.2026): eine vom Modell zweimal gleich
   gelesene, gültige Foto-Nummer (kein Waagen-Code), die der feste
   Strichcode-Leser auf dem ORIGINAL des Barcode-Fotos bestätigt, wird zur EAN
   der Einreichung (`eanKorrektur`, zusammen mit `eanFotoOcr` in EINEM
   Schreibvorgang — NUR im scharfen Lauf, nie im Trockenlauf, und nur mit
   eingeschaltetem Schalter `cashback_config/v1.barcodeKorrektur === true`);
   alle weiteren Schritte rechnen mit ihr.
5. **Chronologisch entscheiden** (`entscheideFall`) — eine im selben Lauf
   entschiedene Einreichung ist für die nächste derselben EAN Referenz bzw.
   kein offener Vorgänger mehr. „Dieselbe EAN" heißt dieselbe GTIN in jeder
   Schreibweise (`werte.eanSchluessel`).
6. **Notbremse** prüfen, dann schreiben. Danach bekommt jeder Fall, der offen
   bleibt, seinen Grund und die sperrenden Befunde in `review.rundeOffen`
   (auch im Trockenlauf) — siehe „Was die Prüfkonsole von der Runde erfährt".
7. **Auf die Buchungen warten** (höchstens 5 Minuten) — nur für die Zahlen im
   Bericht. Die Nachricht an die Nutzer schickt der Sammler in crowd-upload-reward.
8. **Bericht** mit Bon-Lage, Aktionen und Warnungen schreiben.

Zeitbudget: nach 18 Minuten beginnt die Runde nichts Neues mehr; der Rest ist
am nächsten Morgen dran (Warnung „nicht geschafft").

## Regeln, die nicht verhandelbar sind

- **Dieselbe Person, dasselbe Produkt: einmal pro Woche (Entscheidung Patrick
  02.10.2026: „weder 24 Stunden noch 30 Tage, sondern einmal pro Woche").**
  Rollierend 168 h gegen die eigenen FREIGEGEBENEN Einreichungen derselben
  wirksamen EAN (`eanOf`), symmetrisch um den Einreichzeitpunkt. „Dieselbe EAN"
  = dieselbe GTIN in jeder Schreibweise (`werte.eanSchluessel`, links mit
  Nullen auf 14 Stellen): die App nimmt beim Eintippen 8–14 Ziffern ohne
  Normalisierung an, „0" + EAN-13 lag sonst in einer eigenen Gruppe (Prüfrunde
  02.10.2026; im Bestand noch nicht ausgenutzt, 0 Gruppen). Die Konsole fragt
  dafür alle Schreibweisen ab (`werte.eanVarianten`, `in`-Abfrage).
  Einreichzeitpunkt = `createTime` des Dokuments (Server), nicht das vom Client
  geschriebene `createdAt` — das prüfen die Regeln beim Anlegen nicht, ein
  veränderter Client könnte es um mehr als 7 Tage verschieben (gemessen: 0 von
  4.102 Dokumenten weichen > 10 min ab, die Umstellung ändert am Bestand nichts). KEINE
  Ausnahme mehr für anderen Preis, Hersteller oder Markt — der Markt wird vom
  Nutzer frei gewählt (Buschbohnen 02.10.: REWE und Netto binnen 10 Minuten,
  beide bezahlt), Preis und Hersteller liest die Texterkennung. Fremde
  Einreichungen sperren weiterhin nie (20.09.). Eine ältere eigene OFFENE
  Einreichung hält an (`doppelt_eingereicht`, offen), damit immer eine Kopie
  zahlbar bleibt. Abgelehnte sind nie Referenz.
  **Am Dokument steht `doppelt_eingereicht`**, intern (`review.reason`, Bericht)
  `sperre_woche_gleicher_nutzer`: Der alte Code `sperre_30_tage_gleicher_nutzer`
  verspricht in allen ausgelieferten App-Versionen „ab dem nächsten Tag … und
  sofort mit anderem Preis, Hersteller oder Markt" — falsch. Der präzise Text
  liegt in `REASON_COPY` für die nächste Version; umstellen in
  `duplicatePolicy.APP_GRUND`, wenn sie verbreitet ist. Gemessen vor dem
  Ausrollen: 20 von 614 Freigaben der letzten 7 Tage (3,3 %) wären gesperrt
  gewesen, seit Beginn 35 (3,28 €). Zurückgefordert wird nichts.
- **Gesperrte Konten (Entscheidung Patrick 02.10.2026, „Ja, dann sperr die
  Konten").** `cashback_sperren/{uid}` = `{ gesperrt: true, seit, grund,
  quelle }`, server-only (deny-all in firestore.rules, Test vorhanden).
  Gesperrt → **die Runde lässt die Einreichung STUMM liegen** (`offen
  konto_gesperrt`, vor allem anderen, ohne Nachlesen und Bildprüfung, nichts
  ans Dokument geschrieben); die Konsole gibt NIE frei, auch nicht mit force
  (Ausgang `refused`). Patricks Vorgabe heißt „nicht freigegeben", nicht
  „abgelehnt": eine Ablehnung wäre endgültig und für den Nutzer sichtbar, und
  eine Sperre, die der Betroffene sieht, lädt zum Ausweichen auf ein neues
  Konto ein (so auch die Gutschrift-Seite, `cashback-pipeline/lib/kontoSperre.js`).
  Bis zur Prüfrunde 02.10.2026 lehnte die Runde ab — eine eigene Verschärfung,
  die nie vorgelegt wurde. Ob es sichtbar abgelehnt werden soll, entscheidet
  Patrick; dann braucht es vorher einen App-Text (`konto_gesperrt` hat bewusst
  KEINEN REASON_COPY-Eintrag, der Server vergibt den Code nie). Der Bericht
  zählt diese Fälle getrennt (`kontoSperren.offenEinreichungen`) — sie stehen
  NICHT in „wartet auf dich" und lösen keine „wartet seit"-Warnung aus; in der
  Konsole stehen sie am Ende der Liste (`gesperrt: true`, `counts.gesperrt`).
  Wird die Sperre aufgehoben, prüft die nächste Runde sie ganz normal.
  `gesperrt: false` oder kein Dokument = nicht gesperrt. Jedes andere
  vorhandene Dokument sperrt — auch ohne Feld oder mit `gesperrt: 'ja'`
  (Prüfrunde 2, 02.10.2026: dieselbe Regel wie auf der Gutschrift-Seite,
  `cashback-pipeline/lib/kontoSperre.js istGesperrt`; vorher hieß ein unklarer
  Eintrag hier `unbekannt`, dort „gesperrt"). Lesefehler
  = `unbekannt` → NIE freigeben, aber auch nicht wegen der Sperre ablehnen
  (`kontosperre_unbekannt`, rote Warnung). In der Schreib-Transaktion wird die
  Sperre vor JEDER Entscheidung noch einmal gelesen, auch vor einer Ablehnung
  (Schlussprüfung 03.10.2026): gesperrt → `konto_gesperrt_im_lauf`, der Fall
  bleibt unverändert und stumm liegen (auch kein `review.rundeOffen`); ein
  Lesefehler → `schreib_fehler`, weder Freigabe noch Ablehnung. Vorher galt das
  nur vor einer Freigabe — war die Sperrliste beim Laden nicht lesbar, wurde
  ein gesperrtes Konto voll bearbeitet und sichtbar abgelehnt. Bereits Gebuchtes
  wird nicht zurückgebucht; Gutschrift und Auszahlung sperrt die
  Gutschrift-Seite (eigener Zweig).
- **Nummer vom Barcode-Foto (Entscheidung Patrick 02.10.2026).** Weicht die
  gelesene Nummer von der gespeicherten (`ean`, gescannt/getippt) ab → offen
  `ean_abweichend`, ein Mensch entscheidet; nie ablehnen, nie freigeben. Das
  gilt VOR der Wochen-Sperre: die rechnet mit der gespeicherten EAN, und ist
  die falsch, träfe sie womöglich ein anderes Produkt. Nur eine gültige GTIN
  zählt als gelesen (Prüfziffer, Vergleich auf 14 Stellen, UPC-A = EAN-13 mit
  führender 0). Nicht lesbar, Waagen-/Händler-Code mit eingerechnetem Gewicht
  oder Preis (GTIN-13 mit 02, 04, 20–29; UPC-A mit 2 oder 4 — lose Ware wird
  angenommen, 20.09.) oder keine gespeicherte EAN → kein Urteil. **EAN-8 wird
  IMMER verglichen** (Prüfrunde 02.10.2026): EAN-8 mit 0 oder 2 vorne sind bei
  Lidl, Penny und Norma fest gedruckte Eigenmarken-Barcodes (294 von 3.910
  Einreichungen mit EAN) — bis dahin fiel für sie der Abgleich ganz weg. Die Doppel-Regel läuft zusätzlich unter der
  Foto-Nummer; eine eigene Freigabe dort steht im Hinweis. Die gespeicherte EAN
  steht NICHT mehr im Auftrag der Bildprüfung — sonst schreibt das Modell sie
  ab. **Eine Abweichung wird mit einer zweiten Lesung nur des Barcode-Fotos
  nachgeprüft** (`eanFotoBestaetigen`): dieselbe Nummer → bestätigt (offen
  `ean_abweichend`); die GESPEICHERTE Nummer → `gleich`, die erste Lesung war
  falsch, normal weiter; alles andere (leer, unsicher, dritte Nummer) →
  `unsicher`, offen `ean_unsicher` (Prüfrunde 02.10.2026 — bis dahin wurde so
  ein Fall freigegeben, obwohl die gespeicherte Nummer nie bestätigt war);
  scheitert die Lesung technisch oder reicht die Arbeitszeit nicht mehr, bleibt
  der Fall ebenfalls liegen. **Der Befund hält, bis ein Mensch in der Konsole
  entscheidet (Prüfrunde 2, 02.10.2026; Schlussprüfung 03.10.2026):** ein
  gespeichertes `abweichend`/`unsicher` gilt weiter, egal was spätere Läufe
  lesen — ein „kein Urteil", eine ausgefallene Bildprüfung und auch ZWEI
  Lesungen der gespeicherten Nummer heben ihn NICHT auf. Freigabe nur in der
  Konsole mit force + Notiz (Entscheidung Patrick 2a: „Weicht sie ab, bleibt
  die Einreichung liegen" — ein Mensch entscheidet). Vorher bewertete die Runde
  jeden Morgen nur die Lesung des Tages (Kfs5jFA6qqOF8gD9iTEk wäre am zweiten
  Tag mit einer unlesbaren Nummer freigegeben worden), und bis zur
  Schlussprüfung hob sie einen Halt mit zwei Lesungen der gespeicherten
  Nummer selbst auf — eine eigene Abschwächung, die Patrick nie vorgelegt war
  (nachgestellt: Tag 1 angehalten, Tag 2 ohne Menschen freigegeben). Ein heutiges
  „gleich" bekommt deshalb auch keine zweite Lesung mehr. Eine heute
  bestätigte Abweichung ersetzt einen alten Befund (hält weiter); alles andere
  lässt ihn stehen. Scheiterte das Speichern von `eanFotoOcr`, steht der Befund
  auch in `review.rundeOffen.eanFoto` (`werte.eanFotoVorbefund`); hält EINE der
  beiden Quellen an, gilt der Halt (vorher: der jüngere Lauf). Der erste Tag
  ist davon unberührt: dort führt eine zweite Lesung der gespeicherten Nummer
  weiter zu `gleich` (Entscheidung Patrick 04.10.2026, siehe (d)).
  **Falsche Prüfziffer, weit weg (Prüfrunde 2):** liest das Modell eine
  Nummer mit falscher Prüfziffer, die sich an mehr als 2 von 14 Stellen von
  der gespeicherten unterscheidet (`zweifelhaft`), wird sie wie eine
  Abweichung nachgelesen: die gespeicherte Nummer → `gleich`, sonst
  `unsicher` (halten). Bis 2 Stellen bleibt es ein Lesefehler derselben
  Nummer, kein Urteil. Gemessen in den Trockenläufen 02.10.: echte
  Lesefehler 1–2 Stellen, die übrigen 4–12 (5 Fälle je Lauf). **Waagen-Code
  nur dann ohne Urteil, wenn auch die gespeicherte Nummer einer ist**
  (Prüfrunde 2): ein Waagen-Code auf dem Foto gegen einen gespeicherten
  Hersteller-Barcode ist eine echte Abweichung (im Bestand 0 Fälle in beiden
  Trockenläufen). Grund (Trockenlauf 02.10.,
  273 offene Fälle): 198 gleich, 65 ohne Urteil, 9 Abweichungen — 6 davon am
  Foto eindeutig echt (gespeicherte EAN falsch), 1 Foto mit zwei Strichcodes,
  2 falsch gelesen: bei einem unscharfen Foto erfand jede Lesung eine andere,
  GÜLTIGE Nummer, bei einem dunklen Foto war eine Ziffer falsch. Die
  Prüfziffer allein schützt also nicht. Kosten: ~15 Ausgabe-Token je Fall im
  ohnehin laufenden Aufruf (Eingabe ~8.200 Token für 7 Fotos), dazu eine
  Lesung eines einzelnen Fotos je Abweichung (~3 % der Fälle).
- **Barcode-Korrektur (Entscheidung Patrick 06.10.2026: „ja").** Eindeutige
  Fälle korrigiert die Runde selbst, statt sie liegen zu lassen. Das
  tatsächliche Verfahren (Stand Prüfrunde 06.10.2026, Runde 3):
  1. **Zwei Modell-Lesungen** derselben Nummer F: die Bildprüfung und eine
     zweite Lesung nur des Barcode-Fotos (`abweichend` + `bestaetigt`). Das
     sind zwei Aufrufe DESSELBEN Modells (gemini-3.5-flash, Temperatur 0) auf
     demselben Bild — NICHT unabhängig. Gemessen am 06.10.2026: auf
     Barcode-Fotos ohne lesbare Ziffern erfindet das Modell Nummern mit
     GÜLTIGER Prüfziffer (G&G Fusilli: 4 von 4 Lesungen 4311501358917; das
     Vollkornbrot derselben Person, Barcode verdeckt, 3 von 4 Lesungen
     erfunden, einmal dieselbe Nummer; Delverde: die zweite Lesung erfand
     „sicher" gültige Nummern). Die Prüfziffer schützt davor nicht. In 17
     gemessenen Paaren stimmten die beiden Lesungen bei einer erfundenen
     Nummer nie überein — aber das ist Glück, keine Unabhängigkeit.
  2. F ist eine gültige GTIN (Prüfziffer, 8/12/13/14 Stellen), kein
     Waagen-/Händlercode (`istHandelsCode`: GTIN-13 mit 02/04/20–29, UPC-A mit
     2/4 — strenger als „02/20–29 bei 13 Stellen"; EAN-8 bleibt korrigierbar)
     und keine Kartonnummer (GTIN-14 mit Packungsindikator 1–9).
  3. **Pflicht-Zeuge: der feste Strichcode-Leser** (`src/strichcode.js`,
     ZXing-C++ als WebAssembly, npm `zxing-wasm` exakt 2.2.4) liest HEUTE auf
     dem ORIGINAL des Barcode-Fotos (volle Auflösung, nicht die Kachel) F und
     NICHT die gespeicherte Nummer S (`werte.strichcodeUrteil` →
     `bestaetigt`). Er arbeitet auf den Strichen statt auf den gedruckten
     Ziffern — eine andere Fehlerquelle als das Modell — und erfindet keine
     Nummer ohne Striche. Liest er nichts, etwas anderes, beide Nummern (zwei
     Codes auf dem Foto, darunter S) oder scheitert er (Download, Laden,
     Zeit) → KEINE Korrektur, der Fall liegt wie vor dem 06.10.
     (`ean_abweichend`), und der Hinweis nennt, was der Leser las. Das gilt
     für Korrekturen aus heutigen Lesungen UND aus alten Befunden.
     Messung 06.10.2026 an 127 echten Barcode-Fotos (Android): 96 gelesen,
     Median 86 ms, höchstens 249 ms je 12-MP-Foto; 91× dieselbe Nummer wie
     OpenCV/Apple Vision, 5× eine andere (bei schlechten Fotos verliest er
     sich wie der Android-Scanner, typisch in der linken Hälfte — deshalb
     Zeuge, nicht Richter). An den 19 offenen Barcode-Fällen vom 06.10.:
     von den 9 geplanten Korrekturen bestätigt er 6, bei 3 (verwackelte bzw.
     angeschnittene Striche, auch mit Vorverarbeitung) liest er nichts — sie
     bleiben beim Menschen. Bei Fusilli, Vollkornbrot, Melitta (4002720001219)
     und Delverde Farfalle (8000270011319) liest er die GESPEICHERTE Nummer:
     dort hatte das Modell erfunden bzw. sich verlesen.
     Nur für die Korrektur-Kandidaten (Kosten), höchstens zwei gleichzeitig,
     mit Zeitgrenze (Download 30 s, Lesen 15 s, Arbeitszeit der Runde);
     auch bei ausgeschaltetem Schalter (der Vorschlag im Bericht zählt nur,
     was er bestätigt). Die Notbremse zählt weiter die Kandidaten nach den
     Modell-Lesungen (die strengere Wahl). Speicher: der WASM-Speicher wächst
     beim Lesen eines 12-MP-Fotos um rund 200 MB und schrumpft nicht (gemessen
     über 127 Fotos: Prozess höchstens 284 MB); die Runde lag zuletzt bei
     höchstens 29 % von 1 GiB.
     **Obergrenze der Bildgröße** (Prüfrunde 1 zur Barcode-Korrektur,
     06.10.2026): der Speicher wächst mit der PIXELZAHL, und eine weiße Fläche
     komprimiert fast auf nichts — 324 MP in 4,9 MB trieben den Leser auf
     901 MB, 400 MP in 4,1 MB auf 1.114 MB. Die Upload-Regel (unter 8 MB) hält
     so ein Bild nicht auf; über den Galerie-Weg lädt die App es unverändert
     hoch. Zusammen mit der Runde wäre Cloud Run in Schritt 4c über 1 GiB
     gelaufen und hätte die Instanz beendet — vor jedem Schreibvorgang, kein
     Bericht, keine Freigabe, und am nächsten Morgen derselbe Kandidat wieder
     (auch bei ausgeschaltetem Schalter, der Leser läuft für jeden Kandidaten).
     Deshalb liest `strichcode.bildPruefen` VOR dem Dekodieren nur den
     Dateikopf (sharp `metadata()`, entpackt nichts, ~1 ms): nur JPEG und PNG,
     höchstens 64 MP (`MAX_PIXEL`). Sonst Fehler (`bild_zu_gross: B×H`,
     `bildformat: …`, `bildkopf: …`) → keine Korrektur, gelbe Warnung
     `barcode_leser_fehler`. Gemessen: 64 MP → Prozess 253 MB; größtes
     Barcode-Foto in Produktion 48 MP (6000 × 8000, alle 4.459), die 127
     Messfotos höchstens 12,5 MP — alle 96 Treffer bleiben.
     Bibliotheks-Fallen: Formatnamen MIT Bindestrich (`'EAN-13'`; `'EAN13'`
     liefert stumm nichts); die WASM-Datei IMMER aus dem Paket laden (ohne
     `wasmBinary` holt die Bibliothek sie zur Laufzeit von einem CDN).
  Dann gilt die Foto-Nummer als EAN der Einreichung
  (`werte.eanOf`: korrigiert → `ean` → nachgelesen), und ALLE weiteren Regeln
  rechnen mit ihr — Wochen-Sperre (eine Sperre unter der korrigierten Nummer
  lehnt ab), md5-Abgleich, Preis-Pflicht, Kontosperre, Notbremsen.
  `ean_unsicher` (zweite Lesung leer, gescheitert oder eine dritte Nummer)
  bleibt beim Menschen; ebenso eine unbestätigte Abweichung und ein
  Waagen-Code auf dem Foto.
  Anlass (06.10.): 18 von 20 liegenden Fällen hingen an der Barcode-Prüfung,
  alle Android (6.0.20/1248, 2× 6.0.17/1240), 12 von einer Person; jede
  gespeicherte Nummer hatte eine gültige Prüfziffer, oft stimmten nur die
  letzten 5–6 Ziffern. 8 davon zweimal gleich gelesen → korrigierbar, 10
  `ean_unsicher` → bleiben.
  - **Gespeichert** in `eanKorrektur` = `{ean, vorher, lesungen[2], aus:
    'heute'|'vorbefund', befundVom?, zeuge: {art: 'striche', gelesen[],
    leser}, regel, lauf, at, quelle}` — nur Server. Eine Korrektur OHNE
    Zeugen (oder deren Zeuge die neue Nummer nicht oder auch die gespeicherte
    las) gilt nicht (`werte.eanKorrekturOf`, fail-closed; im Bestand standen
    am 06.10. keine Korrekturen). Die Prüfkonsole zeigt unter der korrigierten
    Nummer „Strichcode-Leser bestätigt …" — nur Server
    (firestore.rules-Sperrliste, Rules-Test). `ean` bleibt UNVERÄNDERT: die
    ursprüngliche Nummer für Audit und Scanner-Messung (dieselbe Regel wie bei
    den *RescueOcr-Feldern). `eanFotoOcr.befund` wird `korrigiert` (hält nicht
    an). Korrektur und Befund in EINEM Schreibvorgang; scheitert er, gilt die
    Korrektur NICHT (der Fall liegt wie vorher, `ean_abweichend`, gelbe
    Warnung) — sonst sähe die Konsole die alte Nummer ohne Barcode-Befund.
    Die Entscheidungs-Transaktion prüft, dass die Korrektur am Dokument steht
    (`ean_korrektur_fehlt` → liegen lassen).
  - **Eigener Schalter `cashback_config/v1.barcodeKorrektur`** (Prüfrunde
    06.10.2026, Rückweg). NUR `true` wendet Korrekturen an. Fehlt er, steht er
    auf `false` oder einem anderen Wert, rechnet die Runde sie nur (Bericht:
    `eanKorrektur.vorgeschlagen`, Liste im Dashboard „vorgeschlagen — Schalter
    ist aus"); die Fälle liegen wie vor dem 06.10. (`ean_abweichend`). Ein
    unbekannter oder unlesbarer Wert steht gelb im Bericht
    (`barcode_korrektur_schalter_unbekannt`). Der Schalter steckt in der
    Regelversion. Abschalten stoppt NEUE Korrekturen; gespeicherte gelten
    weiter (einzeln zurücknehmen: siehe Rückweg). `fotoWorker` bleibt der
    Schalter für alle Entscheidungen. index.js reicht den Wert aus seinem
    eigenen Lesen der Konfiguration durch.
  - **Rückweg: Korrektur verwerfen** (Prüfkonsole, Knopf an der Barcode-Zeile,
    `reviewDecideUploads` mit `decision: 'ean_korrektur_verwerfen'`, Pflicht-
    Notiz, genau eine Einreichung, jeder Status). Setzt nur
    `eanKorrekturVerworfen = {by, at, notiz, ean, vorher, status}` (nur Server,
    firestore.rules-Sperrliste, Rules-Test). Danach gilt wieder `ean` — in
    Runde, Konsole (auch im EAN-Index der Warteschlange, Feld im `select`) und
    in jeder künftigen Doppel-Prüfung (`werte.eanKorrekturOf` ignoriert eine
    verworfene Korrektur), und die Runde korrigiert diese Einreichung NIE
    wieder (`eanKorrekturAus`). `eanKorrektur` bleibt fürs Audit stehen, die
    Konsole zeigt „Korrektur auf … verworfen". Entscheidet nichts: eine offene
    Einreichung bleibt offen; weil das Foto weiter die andere Nummer zeigt,
    hält sie mit `ean_abweichend` (Freigabe mit force + Notiz). Die RUNDE hält
    ebenso (Prüfrunde 06.10.2026, Runde 3): nach einer Korrektur steht in
    `eanFotoOcr` `korrigiert` (kein Halte-Befund) und `review.rundeOffen` ist
    leer — der gespeicherte Vermerk `eanKorrekturVerworfen` ist deshalb selbst
    eine Halte-Quelle (bestätigte Abweichung mit der verworfenen Nummer, nie
    vertraut, `werte.eanFotoHalteQuellen`). Vorher gab die Runde den Fall am
    nächsten Morgen frei, wenn das Foto unlesbar war oder die zweite Lesung die
    gespeicherte Nummer las — während die Konsole ihn anhielt.
    **Verwerfen WÄHREND der Runde** (Prüfrunde 1 zur Barcode-Korrektur): die
    Runde lädt zu Beginn und schreibt 10–20 min später. Die
    Entscheidungs-Transaktion (Schritt 7) prüft deshalb, dass die EAN, mit der
    gerechnet wurde (`werte.eanOf`), noch gilt und `eanKorrekturVerworfen`
    sich nicht geändert hat — für den Fall selbst und für jeden Beleg einer
    Ablehnung (Wochen-Sperre, Fotos wiederverwendet). Sonst: nichts
    schreiben, morgen neu entscheiden (`uebersprungen`). Vorher gab die Runde
    in diesem Fenster einen Fall frei, der mit der verworfenen Nummer
    gerechnet war (eine Wochen-Sperre unter der gespeicherten Nummer blieb
    ungeprüft), bzw. lehnte gegen einen Beleg ab, dessen Nummer nicht mehr
    galt. Gerade nach
    einer FREIGABE wichtig: ohne Rückweg blieb eine falsch korrigierte Nummer
    für immer die EAN dieser Einreichung in der Wochen-Sperre — auch das
    Löschen von `eanKorrektur` von Hand half nicht (der Befund `korrigiert`
    hält nicht, am nächsten Morgen wäre bei erneut zweimal gelesener Nummer
    wieder korrigiert worden). Einweg; zurücknehmen ließe sich das Verwerfen
    nur von Hand.
  - **Trockenlauf (`fotoWorker` aus) speichert KEINE Korrektur** (Prüfrunde
    06.10.2026). Eine Korrektur wirkt dauerhaft (höchstens eine je
    Einreichung) und hebt in der Konsole einen Halt auf — das ist eine
    Entscheidung, keine Tatsache über die Fotos. Der Trockenlauf rechnet sie
    nur (Bericht: `eanKorrektur.gespeichert: false`, „nur geplant"), legt in
    `eanFotoOcr` den Befund DAVOR ab (`abweichend` + `bestaetigt`) und lässt
    den Halt in `review.rundeOffen` stehen (`sperrend: ['ean_abweichend']`,
    `geplant`). Der nächste scharfe Lauf korrigiert dann aus diesem Befund.
  - **Leser der EAN:** für Entscheidungen ausschließlich `review-console`
    (Runde + Konsole) — crowd-upload-reward, -namer und -location lesen sie
    nicht (geprüft 06.10.2026 per grep). Die APP zeigt sie an: „Meine
    Einreichungen" → Detail zeigt `EAN: {detailRow.ean}`
    (`app/product-submit/index.tsx`, Daten aus
    `subscribeUserProductSubmissions`), also die gescannte Nummer — auch nach
    einer Korrektur. Bekannte Grenze, für das Geld folgenlos: wird ein
    korrigierter Fall unter der korrigierten Nummer als `doppelt_eingereicht`
    abgelehnt, steht daneben eine Nummer, die mit der Sperre nichts zu tun
    hat. Behebung nur mit einem App-Build (`eanKorrektur.ean` anzeigen, wenn
    vorhanden und nicht verworfen; der Eigentümer darf das Feld lesen, an den
    Rules ist nichts nötig) — offen, nicht Teil dieser Änderung. Wer künftig
    die EAN einer Einreichung braucht (Katalog-Übernahme, Auswertung, Export),
    nimmt `werte.eanOf`, NIE `ean` allein. Die Konsole fragt Nachbarn über
    die Felder `ean`, `eanRescueOcr`, `eanKorrektur.ean` und (seit Runde 3)
    `eanFotoOcr.ean` ab (Einzelfeld-Index ist Standard, geprüft 06.10.: keine
    Ausnahme für `crowd_uploads`) und zählt nach effektiver EAN bzw. nach
    geteilter Nummer (verwandte).
  - **Abgleich danach** gegen die korrigierte Nummer (`werte.eanAbgleichOf`):
    eine spätere Bildprüfung soll sie bestätigen. Höchstens EINE Korrektur je
    Einreichung — eine bestätigte Abweichung gegen die korrigierte Nummer hält
    an (`ean_abweichend`). Der Befund, aus dem die Korrektur entstand, hält
    nicht mehr (`durchKorrekturErledigt`, z. B. ein alter Rückfall in
    `review.rundeOffen`).
  - **Schon angehaltene Fälle:** Patricks „ja" hebt für GENAU diese Klasse
    die Regel „ein angehaltener Fall wird nie automatisch aufgehoben" auf. Ein
    alter Halt wird korrigiert, wenn JEDE haltende Quelle (`eanFotoOcr`,
    `review.rundeOffen.eanFoto`) `abweichend` + `bestaetigt` mit derselben
    korrigierbaren Nummer sagt, keine einen Bremsvermerk trägt, UND heute eine
    Bildprüfung lief, die nicht widerspricht (nichts lesbar, oder dieselbe
    Nummer — auch nur einmal). Ohne Bildprüfung heute keine Korrektur aus
    einem alten Befund: ein Ausfall ist keine Bestätigung.
    „Nicht widersprechen" genügt aber NUR, wenn jede Quelle VERTRAUT ist
    (`werte.eanFotoHalteQuellen` `vertraut`, Prüfrunde 06.10.2026,
    Übergangslücke): eine Abweichung mit Vermerk `korrekturfaehig: true` und —
    bestätigt — beiden gleichen Lesungen (`zweit`), oder ohne Vermerk aus
    genau dem Lauf `2026-10-06_080038` (`LETZTER_LAUF_OHNE_VERMERK`; beim
    Rückfall zählt dessen Lauf). Sonst muss heute die Bildprüfung SELBST
    zweimal dieselbe Nummer lesen (`abweichend` + `bestaetigt`); die Korrektur
    trägt dann `heuteBestaetigt: true`. Grund: der alte Code (fe89647e, bis
    zum Ausrollen um 08:00 aktiv, auch im Trockenlauf) ersetzt JEDEN alten
    Halt durch eine heute bestätigte Abweichung und behält einen alten Halt
    gegen einen Widerspruch stillschweigend — ein früheres `unsicher` oder ein
    Widerspruch steht danach nirgends mehr. Nachgestellt am echten Fall
    otzruv…_4 (Delverde Eliche, Foto unscharf, eine Lesung erfand
    8002270014512): ohne Vermerk wäre am Folgetag bei unlesbarem Foto auf die
    erfundene Nummer korrigiert und bezahlt worden. An den Daten geprüft
    (06.10.): alle 18 haltenden Befunde offener Einreichungen und ihre
    Rückfälle stammen aus dem Lauf `2026-10-06_080038`, keine Einreichung
    existierte beim Lauf davor — jeder Fall wurde genau einmal angesehen.
    Der Vermerk wandert mit: ein unverändert übernommener Befund wird mit
    seinem Vertrauen neu geschrieben (Rückfall, Bremsvermerk), ein nicht
    vertrauter ausdrücklich mit `korrekturfaehig: false` — Neuschreiben macht
    nie aus einem nicht vertrauten einen vertrauten. Ein Befund des alten
    Codes ohne `zweit` gilt beim Übernehmen als zweimal dieselbe Nummer
    („bestätigt" hieß dort genau das).
    **Code-Schutz (Prüfrunde 06.10.2026, Runde 3, Befund „hoch"):** eine
    Abweichung OHNE Vermerk aus einem anderen Lauf als `2026-10-06_080038`
    kann nur der ALTE Code geschrieben haben, nachdem er noch einmal lief
    (Zeitplan 08:00, solange nicht ausgerollt, oder ein manueller
    Trockenlauf). Sie gilt jetzt als dauerhaft gebremst (`gebremst:
    'altcode_<lauf>'`, wie die Notbremse): nie automatisch korrigiert, auch
    nicht, wenn heute zweimal dieselbe Nummer gelesen wird — ob der Fall
    vorher `unsicher` war oder N zweimal gelesen hatte, steht nirgends mehr.
    Der Vermerk wandert beim Neuschreiben mit (`korrekturGebremst`), Hinweis
    „Befund des alten Codes ohne Vermerk", gelbe Warnung
    `barcode_altcode_wartet`. Er gilt aus JEDER Quelle (Prüfrunde 1 zur
    Barcode-Korrektur, `werte.eanFotoVorbefund`): typisch behält der alte Code
    `eanFotoOcr` vom 06.10. (heute widersprochen oder nichts lesbar) und
    schreibt nur den Rückfall mit dem neuen Lauf neu — bis dahin übernahm die
    Runde nur den Vermerk der ERSTEN Quelle, schrieb den Rückfall ohne ihn neu
    und korrigierte am Tag darauf doch. Steht der Vermerk nicht in
    `eanFotoOcr`, schreibt die Runde ihn dort hinein (`neuSpeichern`). Der Weg „heute selbst zweimal" (`heuteBestaetigt`)
    bleibt nur für Befunde des NEUEN Codes mit ausdrücklichem
    `korrekturfaehig: false` (gebremste Runde ohne Speichern, Trockenlauf) und
    deren Rückfall. Am besten trotzdem vor dem nächsten Lauf des alten Codes
    ausrollen: läuft er doch, bleiben auch die 8 echten Fälle vom 06.10. beim
    Menschen (ihr Stand steht in `ops_tagesberichte/2026-10-06_080038`).
  - **Tagesgrenze:** höchstens 25 Korrekturen aus alten Befunden je Lauf
    (`KORREKTUR_ALT_MAX`, die ältesten zuerst); der Rest wartet ohne Vermerk
    auf den nächsten Lauf, gelbe Warnung `barcode_korrektur_aufgeschoben`.
    Sie stehen außerhalb der Bremsen-Quote; ein ungewöhnlich großer Rückstand
    (Tage mit ausgeschaltetem Schalter) soll nicht in einem Zug durchlaufen.
  - **Ein Widerspruch über Tage bleibt am Dokument** (`werte.eanFotoMitVorbefund`,
    Prüfrunde 06.10.2026). Liest die Bildprüfung gegen einen alten
    `abweichend`-Halt mit Nummer N heute die gespeicherte Nummer, eine andere
    (auch zweimal), eine mit falscher Prüfziffer, oder sind die Lesungen
    uneinig, wird der Befund `unsicher` (`grund: 'lesungen_uneinig_tage'`,
    `zweit` = heutige Nummer) und NEU gespeichert. `unsicher` wird nie
    korrigiert. Bis dahin blieb der alte Befund stehen und der Widerspruch war
    am nächsten Morgen vergessen: am Folgetag mit unlesbarem Foto wäre auf N
    korrigiert und bezahlt worden — auch nach zwei verschiedenen, je zweimal
    gelesenen Nummern (das Muster „unscharfes Foto erfindet Nummern"). Ein
    alter `unsicher`-Halt bleibt `unsicher`, auch gegen zwei gleiche heutige
    Lesungen (`ean_unsicher` bleibt beim Menschen); bis dahin ersetzte eine
    heute bestätigte Abweichung JEDEN alten Befund und machte ihn am Folgetag
    korrigierbar. Bericht: `eanKorrektur.uneinigUeberTage`.
    Dasselbe gilt OHNE haltenden alten Befund (`werte.eanFotoGegenFrueher`,
    Runde 3): las ein früherer Lauf das Foto als eine andere gültige Nummer —
    typisch `gleich` (Scanner und Foto stimmten überein), der Fall lag aus
    anderem Grund weiter — und liest das Modell heute zweimal F, wird der
    Befund `unsicher` (`lesungen_uneinig_tage`), nie korrigiert. Ein
    `return null` in der Korrektur reichte nicht: dann würde `abweichend` mit
    `korrekturfaehig: true` gespeichert und am Folgetag korrigiert. Auch nach
    einer Korrektur (früher `korrigiert` F, heute zweimal eine dritte Nummer)
    hält das jetzt als `ean_unsicher` statt `ean_abweichend`.
  - **Doppel-Regel über ALLE zugehörigen Nummern, an JEDEM Tag.** Unter der
    korrigierten (effektiven) wie immer (sperrt → ablehnen). Zusätzlich
    (`dupAlt`) über alle VERWANDTEN Einreichungen: solche, die mit dieser eine
    Nummer teilen — effektive oder ursprünglich gespeicherte (`policyOf.eanVorher`),
    auf jeder Seite (`werte.eanNummern`, `teilenNummer`). Eigene Freigabe dort
    binnen 7 Tagen oder eine ältere eigene, noch offene, während die Gruppe der
    effektiven EAN nichts fand → liegen lassen (`ean_alt_doppelt`, sperrend für
    die Konsole), NIE ablehnen — eine alte Nummer kann ein Scanner-Fehler sein,
    der zufällig einem anderen eigenen Produkt gehört. Fremde Einreichungen
    halten nichts an. Drei Wege, die die Gruppe nach effektiver EAN allein
    nicht sieht (alle in der Prüfrunde 06.10.2026 mit dem Test-Harness als
    Doppelzahlung nachgestellt):
    1. die gespeicherte Nummer DIESER Einreichung = Nummer einer eigenen
       Freigabe der Woche (fremden Strichcode fotografiert);
    2. eine frühere eigene Freigabe wurde VON dieser Nummer weg korrigiert, die
       neue trägt wieder die falsche Nummer und das Foto ist unlesbar
       (dieselbe Person, systematische Fehllesung des Scanners);
    3. beide wurden von derselben alten Nummer weg auf VERSCHIEDENE Nummern
       korrigiert;
    4. (Runde 3) eine eigene FREIGABE, deren Barcode-Foto bestätigt eine
       andere Nummer zeigt, die aber nie korrigiert wurde (ein Mensch gab den
       `ean_abweichend`-Fall mit force frei — gebremst, verworfen, Karton-
       oder Waagen-Code). Ihre Foto-Nummer zählt zu ihren Nummern
       (`werte.eanFotoFreigegebenOf`, `policyOf.eanFotoFrei`). Bei einer
       VERWORFENEN Korrektur (Prüfrunde 1 zur Barcode-Korrektur) die
       verworfene Nummer — auch wenn `eanFotoOcr` noch `korrigiert` sagt
       (Verwerfen und force-Freigabe ohne Runde dazwischen, oder Verwerfen
       nach der Freigabe). Vorher hing es vom Zeitpunkt der nächsten Runde
       ab, ob die Nummer dazugehörte. Anlass: K-Classic
       Kartoffel Knödel (ecL21IfZ…_1, gespeichert 070012398358, Foto zweimal
       4012448397358, am 05.10. mit force freigegeben) — eine Einreichung mit
       der echten Nummer in derselben Woche wäre bezahlt worden.
    Die Prüfung hängt an der GESPEICHERTEN Korrektur, nicht am heutigen
    Befund: bis zur Prüfrunde rechnete die Runde sie nur am Tag der Korrektur
    — am nächsten Morgen (Foto bestätigt die korrigierte Nummer, „gleich")
    gab sie einen am Vortag angehaltenen Fall frei. Eine absichtlich falsche
    Nummer bringt nichts: sie wird durch die Foto-Nummer ersetzt und kann nur
    zusätzlich anhalten. (Dass jemand gleich Nummer UND Strichcode eines
    anderen Produkts nimmt, ging schon vorher — das fängt nur die
    Bildprüfung.) Die Konsole rechnet dasselbe (`precheckOf(…, {verwandteRows})`
    aus `verwandteVon`/`verwandteAus`; Abfragen über alle Nummern der Zeile;
    korrigiert ohne Nachschlagen → `ean_alt_ungeprueft`, hold).
  - **Notbremse der Korrektur** (`korrekturBremse`): mindestens 8 und mehr
    als 10 % — gerechnet NUR über die frischen Fälle (Prüfrunde 06.10.2026):
    Zähler = heute geplante Korrekturen aus heutigen Lesungen (`aus:
    'heute'`), Nenner = heute angesehene Fälle OHNE haltenden alten Befund.
    Der liegende Bestand ist vorsortiert — normale Fälle werden täglich
    entschieden und verschwinden, Barcode-Abweichungen bleiben liegen. Mit
    allen geplanten über alle geprüften (Stand bis zur Prüfrunde) schlug die
    Bremse beim Ausrollen fast sicher an (gemessen 06.10.: 85 offen, davon 8
    bestätigte Altfälle; frisch 8 von 175 = 4,6 %; über 10 % bei weniger als
    ~44 Eingängen über Nacht, ohne Eingänge 12,9 %) und hätte genau die Fälle
    für immer gesperrt, die Patrick aufgelöst haben wollte. Die frühere
    Annahme „der Anteil bleibt auch bei einem Rückstand aussagekräftig" war
    falsch. Schlägt die Bremse an, gilt sie für ALLE Korrekturen des Laufs,
    auch die aus alten Befunden (sie hängen an der heutigen Lesung mit):
    heute KEINE Korrektur, alle liegen wie vorher (`ean_abweichend`), rote
    Warnung `barcode_korrektur_gebremst` (Zahlen der frischen Fälle).
    - Scharfer Lauf mit Schalter an: die Runde vermerkt die Bremse am Befund
      (`eanFotoOcr.korrekturGebremst` und `review.rundeOffen.eanFoto.
      korrekturGebremst` = Lauf) — diese Fälle korrigiert sie auch später NIE,
      ein Mensch entscheidet. Bericht: `eanKorrektur.gebremstHaelt`. Konnte
      `eanFotoOcr` nicht gespeichert werden, hält der Vermerk im Rückfall
      allein (aus jeder Quelle, s. o.) und wird beim nächsten Lauf in
      `eanFotoOcr` nachgetragen.
    - Ohne Speichern (Trockenlauf, Schalter aus): KEIN Vermerk — er wirkt
      dauerhaft wie eine Entscheidung (Prüfrunde 06.10.2026: sonst hätte der
      übliche Trockenlauf nach dem Ausrollen die Altfälle schon vor dem ersten
      scharfen Lauf für immer gesperrt). Die heute gelesenen Befunde werden
      stattdessen mit `korrekturfaehig: false` abgelegt: eine spätere
      Korrektur braucht eine neue, zweifache Lesung; „nichts lesbar" reicht
      dann nicht. Die Warnung sagt „nichts dauerhaft vermerkt".
    Bericht: `eanKorrektur.quote = {korrigiert, geprueft}`, `gebremstVermerkt`.
  - **Notbremsen-Quote:** kein neuer Ablehngrund. Korrigierte Fälle enden mit
    den gewohnten Gründen (Wochen-Sperre bleibt außerhalb der Gesamtquote);
    `ean_alt_doppelt` und `ean_korrektur_fehlt` sind Liegegründe.
  - **Bericht:** `eanKorrektur` = `{korrigiert, ausHeute, ausVorbefund,
    nichtGespeichert, gebremst, gebremstAnzahl, quote, gebremstVermerkt,
    aufgeschoben, schalter, schalterUnbekannt?, vorgeschlagen,
    vorgeschlagenFaelle[{…, zeuge}], gespeichert, uneinigUeberTage,
    gebremstHaelt, kandidaten, leser: {bestaetigt, widerspricht,
    nicht_gelesen, fehler}, leserFaelle[{id, vorher, neu, aus, urteil,
    gelesen, fehler?}], faelle[{id, vorher, neu, aus, zeuge, entscheidung,
    grund}]}`,
    `notbremse.korrektur`, `eanFoto.korrigiert`; im Dashboard „Barcode
    automatisch korrigiert" mit Liste alt → neu (im Trockenlauf „nur geplant").
  - **Ausrollen — Reihenfolge** (Prüfrunde 1 zur Barcode-Korrektur, am
    Live-Stand geprüft 06.10.2026: die Live-Rules sperren nur `eanFotoOcr`,
    nicht `eanKorrektur`/`eanKorrekturVerworfen`; die Live-Seiten
    `pruefen.html`/`tagesbericht.html` kennen weder Korrektur-Anzeige noch
    „Korrektur verwerfen"):
    1. `firestore:rules` — vorher Live-Stand holen und vergleichen (CLAUDE.md,
       „Vor jedem Rules-Deploy den LIVE-Stand holen"), `npm run test:rules`
       grün. Gehen die Functions vor den Rules live, darf ein Client
       `eanKorrektur` samt erfundenem Zeugen beim Anlegen mitschicken: die
       Konsole zeigte „Strichcode-Leser bestätigt …", ohne dass der Server je
       gelesen hat (kein direkter Geldweg — `ean` kommt ohnehin vom Client —,
       aber ein falsches Vertrauenssignal).
    2. `hosting:md-receipt-admin` — sonst sieht der Mensch eine korrigierte EAN
       ohne Hinweis und kann sie nicht verwerfen.
    3. `functions:review-console` — allein, nicht zusammen mit einer anderen
       Codebase; vorher den deployten Stand gegen diesen Zweig vergleichen.
    4. Erst danach den Schalter `cashback_config/v1.barcodeKorrektur` auf
       `true` setzen.
    Mindestens die Rules müssen vor oder mit den Functions live gehen. Wegen
    der Frist (Lauf um 08:00) alle drei im selben Zug.
  - **Übertragbare Lehre (Prüfrunde 06.10.2026, vier Funde derselben Art):**
    Ein Schutz, der an einem ZUSTAND hängt (korrigiert, gebremst, widersprochen),
    muss aus dem GESPEICHERTEN Zustand gerechnet werden, nicht aus dem
    heutigen Ereignis — sonst gilt er genau einen Lauf, und der nächste Morgen
    entscheidet ohne ihn. Prüffrage bei jeder neuen Halte-Regel der Runde:
    Was sieht der Lauf von MORGEN, wenn die Bildprüfung dann „gleich",
    „nichts lesbar" oder gar nichts liefert?
    Zweite Runde derselben Prüfung (Übergang, Bremse, Rückweg): (1) eine Regel,
    die gespeicherten Zuständen vertraut, muss auch die Zustände kennen, die
    der ALTE Code bis zum Ausrollen noch schreibt — sonst öffnet das Ausrollen
    selbst die Lücke; (2) eine Quote über einen vorsortierten Rückstand misst
    den Rückstand, nicht das Modell; (3) was dauerhaft wirkt (Korrektur,
    Bremsvermerk), schreibt nur der scharfe Lauf; (4) jede automatische
    Entscheidungsregel braucht einen eigenen Schalter und einen Rückweg für
    den Einzelfall.
- **Foto-Abgleich gegen ALLE früheren Einreichungen (Entscheidung Patrick
  02.10.2026).** Gruppen gleicher Identitätsfotos (Pfad oder md5, leere
  Dateien ausgenommen). Die älteste Einreichung einer Gruppe trägt nie einen
  Befund. Ältere eines FREMDEN Kontos → offen `foto_fremdes_konto`; sonst
  ältere eigene freigegeben → `bilder_wiederverwendet`; ältere eigene offen →
  offen `foto_aeltere_offen`; ältere eigene als DOPPEL abgelehnt
  (`DOPPEL_GRUENDE`: Wochen-Sperre, `doppelt_eingereicht`, alte 24-h-Sperre,
  `bilder_wiederverwendet`, `produkt_bereits_verguetet`) →
  `bilder_wiederverwendet` — sonst ließen sich die Fotos einer als Doppel
  abgelehnten Einreichung eine Woche später einfach noch einmal einreichen
  (Prüfrunde 02.10.2026, im Bestand 12 solche jüngeren Einreichungen, 1 davon
  freigegeben — eine legitime Korrektur nach `unvollstaendig`). Das gilt NUR,
  wenn dieselbe Person für dieselbe EAN wirklich eine Freigabe hat
  (`freigabeVon`, Prüfrunde 2): `doppelt_eingereicht` wurde auch schon ohne
  bezahlte Referenz vergeben (10.09.: alle Kopien abgelehnt) — dann bliebe
  keine Kopie bezahlt (im Bestand 02.10.: 0 von 21 Befunden betroffen); ältere nur
  wegen eines behebbaren Mangels abgelehnt → normal prüfen (erlaubte
  Korrektur). Der Status ist im Lauf nachgezogen. Vorher nur gegen die im Lauf
  offenen; gemessen seit Beginn: 35 Einreichungen mit identischem Foto einer
  älteren, davon 1 eigene und 2 fremde dennoch freigegeben. Scheitert die
  Storage-Liste → keine Freigaben (`foto_abgleich_gescheitert`, rote Warnung).
  **Foto-Befunde früherer Läufe (Schlussprüfung 03.10.2026,
  `fotoRundeRegeln.bildMitVorbefund`):** lässt sich der Abgleich für einen
  Fall heute nicht VOLLSTÄNDIG rechnen (Storage-Liste gescheitert, ein
  Identitätsfoto nicht abrufbar oder ohne md5), gelten die Foto-Codes aus
  `review.rundeOffen.sperrend` des Vortags weiter. Bis dahin verschwand ein
  Halt dann aus `rundeOffen`, die Konsole zeigte „ok", und F gab ohne Notiz
  frei — ein Technikausfall hob den Halt auf. `foto_fremdes_konto` gilt
  IMMER weiter, bis ein Mensch in der Konsole entscheidet, auch wenn sich die
  md5-Grundlage ändert: storage.rules erlaubt dem Eigentümer, eigene Dateien
  in `crowduploads/` zu überschreiben — wer zwei Konten hat, überschriebe das
  Original im anderen, und der Halt wäre am nächsten Morgen weg. Ein
  übernommener Befund hält nur an, er wird nie zur Ablehnung (auch
  `bilder_wiederverwendet` nicht); er trägt keine IDs (die stehen im
  Tagesbericht des Laufs `fotoSeit`). Ein heute gefundener stärkerer Befund
  geht vor; einer, der heute zusätzlich gefunden wurde, steht mit in
  `sperrend`. Ist der Abgleich heute vollständig, wird `foto_aeltere_offen`/
  `bilder_wiederverwendet` NICHT übernommen — die ältere Einreichung kann
  inzwischen entschieden sein. Bericht: `fotoVorbefund.haelt`,
  `fotoAbgleich.unvollstaendig`. Langfristig offen: Updates auf
  `crowduploads/` nach dem ersten Hochladen sperren (Wiederholungen der
  Upload-Queue beachten).

- **Der Preis ist Pflicht (Entscheidung Patrick 26.09.2026).** Die Bildprüfung
  beantwortet `preisSichtbar` getrennt von `echt`. Freigabe nur, wenn der Preis
  gelesen ist (`werte.preisOf`) ODER auf dem Preisfoto sichtbar; sonst
  `preis_fehlt` (endgültig). Hat die Bildprüfung den Preis nicht beurteilt
  (auch: `preisSichtbar: null` = unsicher) oder scheiterte das Nachlesen an
  unserer Technik → offen. Ein Preisschild eines ANDEREN Produkts zählt nicht
  (Vergleich 26.09.: Käsezopf statt Milbona).
  **Abgelehnt wird nur ohne jedes Gegenzeichen.** Sah der Lesedienst beim
  Anlegen ein Preisschild oder einen Kassenbon (`werte.preisHinweisOf`) oder
  fand nur eine von zwei Nachlesungen einen Preis → offen `preis_unsicher`.
  Eine Ablehnung ist endgültig, Liegenlassen kostet einen Blick.
  Gemessen 26.09. an 113 echten Fällen: 0 Fehlablehnungen bei 28 Fällen mit
  sichtbarem Preis (24 frei, 4 offen), 63 von 65 ohne Preis abgelehnt.
  Notbremse: fehlt angeblich bei mehr als 30 % der geprüften Fälle der Preis
  (normal gut 10 %), werden diese Ablehnungen zurückgehalten.
  Vorher stand hier das Gegenteil („Preisfoto darf ohne Preis sein") — eine
  Regel, die ich aus meinen Handrunden übernommen hatte, obwohl Patrick am
  20.09. „preis?" als Prüfpunkt genannt hatte. Seit 01.09. hatten 624 von 1.973
  Freigaben keinen gelesenen Preis; hochgerechnet aus einer Sichtprobe zeigte
  knapp jede fünfte Freigabe gar keinen Preis. In der Morgenrunde waren es 30
  von 284. Zurückgefordert wird nichts.
- **Aufnahmeort passt nicht zum Markt** (anderes Land, Ausland, Simulator-
  Standort; `ort.auffaelligkeiten`) → bleibt für Patrick liegen (`ort_auffaellig`).
  Selten (3 von 1.973 Freigaben seit 01.09.) und oft harmlos (Aldi Süd/Hofer).
- **Liest der Lesedienst noch nach** (`namerNachlesenAb` gesetzt) → offen
  (`namer_laeuft_noch`); erst danach stehen Name, Preis und Kassenbon-Adresse fest.
  Liegt sein Termin mehr als zwei Stunden zurück, hängt er (Takt 15 min) — dann
  entscheidet die Runde selbst.

- **Die Regeldatei muss aus dem Haupt-Checkout stammen.** Am 20.09. lief ein
  Lauf gegen eine Regelfassung, die sechs Tage alt war — 8 von 14 Ablehnungen
  wären gegen eine Entscheidung gegangen, die Patrick Stunden vorher getroffen
  hatte. Eine Ablehnung ist endgültig. Der Lauf protokolliert deshalb, welche
  Regelversion er benutzt hat.
- **Eine Doppel-Gruppe muss eine zahlbare Kopie übrig lassen.** Die älteste
  Einreichung einer Gruppe ist die Referenz und wird nie gesperrt. Sonst geht
  auch die korrekte Erst-Einreichung leer aus (passiert am 10.09., 3 Gruppen).
- **Bild-Wiederverwendung trifft nur die jüngere Einreichung**, nie beide
  (seit 02.10. über `fotoRundeRegeln.bildBefund`, siehe oben).
- **Eine Sperr-Ablehnung braucht einen Beleg, der feststeht (Prüfrunde
  02.10.2026).** Wochen-Sperre und `bilder_wiederverwendet` stützen sich auf
  eine andere Einreichung (`fotoRundeRegeln.belegeVon`). Geschrieben wird so
  eine Ablehnung nur, wenn mindestens ein Beleg schon vor dem Lauf entschieden
  war oder im selben Lauf TATSÄCHLICH geschrieben wurde. Sonst (Referenz-
  Freigabe übersprungen, gescheitert, von der Notbremse oder einer frischen
  Kontosperre zurückgehalten) bleibt der Fall offen
  (`beleg_nicht_geschrieben`) — am Ende wäre sonst keine Kopie bezahlt.
- **Bild-Dedup zählt nur die Identitäts-Fotos** (front, rueckseite, hersteller,
  ean, naehrwerte, zutaten) — NICHT `preis`. Zwei echte Sorten teilen sich oft
  ein gemeinsames Regal-/Aktionsschild.
- **Sieben Dateien sind nicht sieben Ansichten**, und dieselbe Datei ist nicht
  immer ein Mangel: ein Rückseitenfoto kann Zutaten, Nährwerte und Hersteller
  zugleich zeigen (vollständig), sieben Aufnahmen derselben Vorderseite sind
  wertlos (unvollständig). Das entscheidet nur die Bildprüfung.
- **„Immer dieselbe Ansicht" ist nur ein Mangel, wenn dadurch etwas fehlt, das
  das Produkt trägt.** Vergleich 24.09. (Runde gegen Handrunde, 235 Fälle, 231
  gleich): Nektarinen im Netz und Bergkäse von der Theke hat die Runde
  abgelehnt, weil alle Fotos dasselbe Etikett zeigten. Vier unabhängige
  Gutachten: falsch. Unverarbeitetes Obst/Gemüse, Kräuter, Eier und
  Thekenware tragen keine Zutaten- oder Nährwertangaben; ihr einziges Etikett
  war vollständig fotografiert. Die Bildprüfung fragt deshalb getrennt
  `traegtAngaben`; abgelehnt wird nur bei `gleicheAnsicht && traegtAngaben`.
  Solche Freigaben tragen `frischwareOhneAngaben: true` (zählbar). Lose Ware
  wird auch dann angenommen, wenn alle Fotos das Waage-Etikett zeigen.
- **Ein gescheiterter Bild-Audit ist keine Freigabe und keine Ablehnung.**
  Bricht die Prüfung an einem Limit ab (429), bleibt der Fall offen für morgen.
- **Jeder Ablehngrund braucht einen App-Text** in `lib/utils/productSubmissionCopy.ts`.
  Ohne Eintrag liest der Nutzer einen Standardtext, der nicht zu seinem Fall
  passt (bis 20.09. bei 31 % der Abgelehnten so).
- **Preis und Hersteller lösen keine Sperre mehr** (seit der Wochen-Regel
  02.10.2026). Bis dahin galten fehlende Vergleichswerte als gleich, und ein
  geretteter Preis — nie ein geretteter Hersteller — konnte die 24-h-Sperre
  lösen. Die Werte stehen nur noch zur Information („Anders" in der Konsole).
- **Lose Ware wird angenommen** (Entscheidung Patrick, 20.09.): Waagen-Codes
  sind kein Ablehngrund. Nur kennzeichnen und die Doppelprüfung zusätzlich nach
  Markt trennen.

## Was die Prüfkonsole von der Runde erfährt (Prüfrunde 2, 02.10.2026)

Die Konsole rechnet Doppel-Regel, Kontosperre und Barcode-Abgleich selbst —
den Foto-Abgleich (md5 gegen alle früheren Einreichungen) und die zweite
Barcode-Lesung kann sie nicht. Bis zur Prüfrunde 2 stand ein Fall, den die
Runde wegen eines Fotos eines ANDEREN Kontos liegen ließ (das Muster hinter den
gesperrten Konten), dort als „Vorprüfung ok" mit Freigabe-Taste.

- Jeder Fall, der nach dem Lauf offen ist, trägt `review.rundeOffen` =
  `{grund, hinweis, zurueckgehalten, sperrend[], eanFoto, lauf, trocken, at}`
  (`fotoRundeRegeln.rundeOffenEintrag`). Im Trockenlauf bleibt jeder Fall
  offen; `geplant` sagt, was die Runde getan hätte (eine geplante Freigabe
  ohne Befund hinterlässt nichts).
- `sperrend` kommt aus den TATSACHEN, nicht aus dem gewählten Grund
  (`rundeBefunde`): gleiches Foto bei einem anderen Konto
  (`foto_fremdes_konto`), in einer älteren offenen (`foto_aeltere_offen`)
  oder bezahlten eigenen Einreichung (`bilder_wiederverwendet`, z. B. von der
  Notbremse zurückgehalten), abweichende/unsichere Barcode-Nummer
  (`ean_abweichend`/`ean_unsicher`), eigene Einreichung dieser Woche unter
  einer zugehörigen Nummer (`ean_alt_doppelt`, 06.10.2026). Die Konsole macht daraus `hold` —
  Freigabe nur mit force + Notiz. Alle anderen Gründe (Bildprüfung
  gescheitert, Ort auffällig, Preis unsicher …) stehen nur zur Information da.
- **Nicht in `holdReasons`**: die zeigt die App bei offenen Fällen als
  „Zurückgestellt". `review` liest die App nicht und steht in der Sperrliste
  von firestore.rules (Rules-Test vorhanden).
- Aktualisiert bzw. entfernt wird der Eintrag beim nächsten Lauf (in einer
  Transaktion: hat inzwischen jemand entschieden, bleibt das Dokument
  unberührt) — seine Foto-Befunde übernimmt der Lauf, wo er sie nicht
  vollständig nachrechnen kann, `foto_fremdes_konto` immer (siehe
  Foto-Abgleich); `fotoSeit` merkt sich den ersten Lauf. Jede Entscheidung
  (Runde oder Konsole) ersetzt `review` und nimmt ihn mit; „Zurückstellen" in
  der Konsole lässt ihn stehen. Gesperrte Konten bekommen keinen (sie liegen
  stumm), auch nicht bei einer erst beim Schreiben bemerkten Sperre.
- **Zurückholen** (reopen) einer Ablehnung ersetzt `review` und löscht
  `rejectReason`, behält den Grund aber in `review.wiedereroeffnet`
  (`vorherGrund` = Code am Dokument, `vorherIntern` = `review.reason`,
  `vorherVon`). War es ein Doppel-Grund (`DOPPEL_GRUENDE`, z. B.
  `bilder_wiederverwendet`, `doppelt_eingereicht`/Wochen-Sperre), liefert die
  Konsole `hold` (`zurueckgeholt_doppel`) — Freigabe nur mit force + Notiz
  (Schlussprüfung 03.10.2026; vorher stand eine Runden-Ablehnung wegen
  wiederverwendeter Fotos nach dem Zurückholen als „ok" da). Die Morgenrunde
  prüft einen zurückgeholten Fall am nächsten Morgen trotzdem neu.
- `review.precheck.dup.priorId` steht nur bei einer EIGENEN Referenz am
  Dokument (`sameUser === true`): die Doc-IDs beginnen mit der uid, eine fremde
  Referenz-ID verriet die uid eines anderen Kontos (03.10.: 237 Dokumente im
  Bestand, nicht bereinigt).
- Scheitert das Speichern bei einem Fall mit sperrendem Befund → rote Warnung
  `befund_nicht_gespeichert`.

## Rettungsläufe vor dem Urteil

Fehlt ein Feld, wird es mit Denken nachgelesen, bevor abgelehnt wird — die
erste Erkennung läuft ohne Denkbudget und versagt regelmäßig an sauberen
Fotos (am 13./19./20.09. je zweistellig viele Fälle).

- Ergebnisse landen IMMER in eigenen Feldern (`productNameRescueOcr`,
  `eanRescueOcr`, `priceRescueOcr`, `manufacturerRescueOcr`), nie in den
  Originalfeldern — sonst ist die Qualitätsmessung der Ersterkennung verfälscht.
- Übernommen wird nur, was **zwei Lesungen gleich lesen**. Das sind zwei
  Aufrufe desselben Modells auf denselben Fotos, also NICHT unabhängig (auf
  Fotos ohne lesbare Ziffern erfindet es gültige GTINs, siehe
  Barcode-Korrektur) — für die EAN-Rettung ein bekanntes Restrisiko.
- Bei EANs zusätzlich die Prüfziffer verlangen. Lose Ware verleitet das Modell
  sonst dazu, die Nummer vom Waage-Etikett zu liefern.

## Notbremse (so gebaut)

Freigaben laufen IMMER — sie sind die harmlose Richtung. Zurückgehalten
(nicht geschrieben, bleiben offen, rote Warnung) werden Ablehnungen, wenn:

- **Bildprüfung kippt:** mindestens 5 und mehr als 10 % der geprüften Fälle
  gelten als unpassend / „immer dieselbe Ansicht" → nur diese Ablehnungen
  (Handrunden 09.–24.09.: 0–2 %).
- **Gesamtquote springt:** mindestens 10 Ablehnungen und mehr als das Doppelte
  der Ablehnungsquote der letzten 30 Tage → alle Ablehnungen des Laufs.
  „Preis fehlt" zählt dabei NICHT mit, weder heute noch im 30-Tage-Schnitt:
  diese Ablehnungen gibt es erst seit 26.09. und hätten die Quote dauerhaft
  verdoppelt — die Bremse hätte jeden Tag ausgelöst und keine einzige Ablehnung
  mehr geschrieben (Gegenprüfung 26.09.).
- **Preis fehlt auffällig oft:** mindestens 8 und mehr als 30 % der geprüften
  Fälle → nur diese Ablehnungen (normal gut 10 %).
- **Wochen-Sperre auffällig oft:** mindestens 10 und mehr als 15 % aller Fälle
  des Laufs → nur diese Ablehnungen (gemessen 3,3 %). Eher ein Fehler beim
  Gruppieren als echte Doppel.
- Wochen-Sperre und alte 24-h-Sperre zählen wie „Preis fehlt" NICHT in die
  Gesamtquote — weder heute noch im 30-Tage-Schnitt (`AUSSER_GESAMTQUOTE`,
  geprüft an `rejectReason` UND `review.reason`). Gesperrte Konten brauchen
  keine Bremse: sie werden nicht abgelehnt.

## Bekannte Lücken (bewusst offen, Prüfrunde 02.10.2026)

- **Lose Ware und Waagen-Codes fallen nie unter die Wochen-Sperre.** Ohne EAN
  gibt es keine Gruppe (19 Freigaben im Bestand); ein Waagen-Code mit
  eingerechnetem Preis oder Gewicht ändert sich je Packung (rund 38 GTIN-13
  mit 02/2x/04). Gleiche Person, gleicher Name binnen 7 Tagen: 1 Paar (16 ct).
- **Händlercodes zweier Ketten können kollidieren.** Seit der Markt keine
  Ausnahme mehr ist, sperrt ein Händlercode von dm den gleichen Code von Netto
  derselben Person (im Bestand 1 Paar, dort dasselbe Produkt). Gehört zu
  ClickUp 12487v2akqg (Händlercodes kennzeichnen, Doppel-Prüfung nach Markt).
- **„Dieselbe Person" heißt „dieselbe uid".** Gast-Konto und Zielkonto eines
  Kontowechsels, oder mehrere Konten einer Person (wie bei den beiden
  gesperrten), zählen als verschiedene Personen — für Wochen-Sperre UND
  Kontosperre. Heute ohne Geldwirkung (Gäste zahlen nicht aus, Übernahme
  Stufe 2 ist aus). **Pflichtpunkt für Gast-Übernahme Stufe 2:** beide Regeln
  müssen Gast und Zielkonto als eine Person behandeln.
- **Welche fremde Einreichung dasselbe Foto hat, sieht die Konsole nicht
  direkt** (Prüfrunde 2): die IDs stehen nur im Tagesbericht, weil der
  Einreicher sein eigenes Dokument lesen darf. Die Codes selbst
  (`foto_fremdes_konto` in `review.rundeOffen`) kann ein technisch versierter
  Nutzer in seinem Rohdokument lesen — die App zeigt sie nicht (wie
  `konto_gesperrt`).
- **Offen für Patrick (Prüfrunde 2):** (a) zählt die Wochen-Sperre auch
  Freigaben, die nie bezahlt wurden (Pro-Kopf-Deckel, Aktionslücke, kein
  Ort)? Heute ja (fail-closed; gemessen 1 betroffene Einreichung, 12 ct).
  (b) Übergang: wer in den letzten 7 Tagen nach der 24-h-Regel abgelehnt wurde
  (13 Dokumente, 10 Personen), las in der App „ab dem nächsten Tag zählt es
  wieder". (c) Gespeicherte EAN mit falscher Prüfziffer und unlesbares
  Barcode-Foto → heute kein Urteil (6 von 3.894 gespeicherten EANs).
  (d) **Barcode, erster Tag — ENTSCHIEDEN (Patrick 04.10.2026: „ja"):** liest
  die Bildprüfung eine ANDERE gültige Nummer und die zweite Lesung die
  gespeicherte, gilt die erste als Fehllesung → `gleich`, die Runde
  entscheidet normal weiter (meist Freigabe). Wirkung laut Trockenlauf ~1
  Fall/Tag. Gilt nur am ersten Tag: ein einmal angehaltener Fall wird nie
  automatisch aufgehoben — mit EINER Ausnahme seit 06.10.2026, der
  Barcode-Korrektur (siehe dort). (`werte.eanFotoBestaetigen`)
  Ebenso: die alten Handrunden-Skripte (`.crowd-review-0909/1309.js`, nicht
  versioniert) schreiben `dup.reason` unverändert — nicht mehr benutzen.

## Warnungen im Bericht

Jede steht für einen Ausfall, der schon einmal unbemerkt blieb:
Aktion läuft aus ohne Nachfolger (01.09.), keine laufende Aktion, Budget leer
oder knapp, **Zweitprüfung eingeschaltet aber 48 h nicht gelaufen** (23.09.:
ein Ausrollen von einem Zweig ohne diesen Code nahm sie still raus), Bons
hängen ≥ 3 Tage in der Prüfung, > 5 % Bons ohne Aktion, Bildprüfung
scheitert reihenweise, Runde nicht fertig geworden, Notbremse, Sperrliste
nicht lesbar bzw. Foto-Abgleich gescheitert (dann gab es keine Freigaben;
Foto-Befunde früherer Läufe gelten weiter, heute erstmals geprüfte Fälle stehen
in der Konsole ohne Foto-Befund), Regeln
oder Anweisungen an das Modell seit dem letzten Lauf geändert, Produktfotos
warten ≥ 3 Tage auf eine Entscheidung (seit der Preis-Pflicht bleibt bei
Zweifel mehr liegen), mehr als 10 % (mind. 8) der geprüften Fälle heute NEU
wegen der Barcode-Nummer angehalten (gelb, über 25 % rot; normal ~3 % — ein
Sprung deutet auf das Modell, Prüfrunde 2), Halte-Grund für die Konsole nicht
gespeichert (rot) bzw. nur der Barcode-Befund nicht (gelb, steht ersatzweise
am Halte-Grund), Barcode-Korrektur gebremst (rot, siehe Barcode-Korrektur;
Zahlen der frischen Fälle, im Trockenlauf „nichts dauerhaft vermerkt"),
Korrekturen aus alten Befunden über der Tagesgrenze (gelb), Schalter
`barcodeKorrektur` unbekannt oder nicht lesbar (gelb), Strichcode-Leser bei
Korrektur-Kandidaten gescheitert (gelb `barcode_leser_fehler` — fällt er
ganz aus, korrigiert die Runde still gar nichts mehr), Barcode-Befunde des
alten Codes ohne Vermerk warten (gelb `barcode_altcode_wartet`)
bzw. eine Korrektur nicht gespeichert (gelb). Dass die Runde gar nicht lief, erkennen
Dashboard und Morgen-Chat selbst (Bericht älter als 26 h bzw. nicht von heute).

## Nachricht an die Nutzer

Die Runde verschickt NICHTS selbst. Jede Buchung landet im Sammler von
crowd-upload-reward (`crowd_push_sammler/{uid}`); der verschickt eine Minute
nach der letzten Freigabe EINE Nachricht mit der Summe — für Freigaben aus
der Runde genauso wie aus der Prüfkonsole. Nie eine Nachricht bei Ablehnung
(Entscheidung 20.09.).

Die Runde darf deshalb bei einer Freigabe KEINEN Push-Merker setzen
(`rewardPushSentAt`): der Sammler hielte die Freigabe für „schon verschickt",
und die Person bekäme gar nichts. Vorfall, der das Bündeln nötig machte:
24.09. hätte die aktivste Person 20 Pushes in wenigen Minuten bekommen.
Eine eigene Bündelung der Runde (crowd_push_buendel) gab es am 24.09. kurz —
sie wurde zugunsten des Sammlers zurückgebaut, damit es genau einen Weg gibt.

## Meldung an Patrick

Bericht → Dashboard → Morgen-Chat (liest `ops_tagesberichte/aktuell`, postet
im ClickUp-Kanal MarkenDetektive_DevBacklog). Der Chat läuft nur, wenn die
Claude-App auf Patricks Mac offen ist; sonst beim nächsten Start. Die Cloud
Function hat keinen ClickUp-Zugang (kein Token im Secret Manager) — deshalb
postet der Chat, nicht die Function.

## Bon-Runde (07:45, seit 24.09.2026)

Anlass: Patrick, 24.09. — „Wieso entscheidet die Morgenrunde nicht über Bons?
Dann laufen die ja wieder auf." Die Pipeline entscheidet fast alles selbst;
übrig bleiben ~5 Bons am Tag in `review` (60 Tage: 296 von 299 wegen niedriger
Lese-Sicherheit, `ocr_confidence_low|medium`).

- **Code:** `src/bonRunde.js` (Ablauf), `src/bonRegeln.js` (Regeln),
  `src/resolverAufruf.js` (der eine Weg zum Resolver, auch für die Konsole).
  Tests: `__tests__/bonRegeln.test.js`, `__tests__/bonRunde.test.js` (Ablauf
  gegen In-Memory-Firestore). Function `bonRundeTaeglich`, 07:45 Europe/Berlin.
- **Schalter:** `cashback_config/v1.bonWorker === true` → scharf, sonst
  Trockenlauf (liest nach, entscheidet nichts, schreibt nur den Bericht).
- **Bericht:** `ops_bonrunden/{tag}` (letzter fertiger Lauf; die Foto-Runde
  übernimmt ihn als `bonRunde` in den Tagesbericht) und
  `ops_bonrunden/{tag}_{HHMMSS}` je Lauf, beim Start mit `laeuft: true`.
- **Gemessen vor dem Ausrollen** (Vergleich mit 53 Handentscheidungen, nur
  lesend): 45 gleich, 0 lockerer als der Mensch, 6 strenger (davon 3 knapp an
  der Artikel-Grenze, je 1 Endsumme nicht im Bild / Bild defekt / Jahr
  unsicher), 2 Tageslimit-Fälle (Vergleichs-Artefakt).

**Regeln**
- **Geld rechnet NIE die Runde.** Entschieden wird über `resolveCashbackReview`
  (Deckel, Budget, Spiegel, Positionen mit `backfilled`, Push). Ergebnis nach
  Status UND Betrag der Antwort werten (`creditedCents`).
- **Freigeben** nur, wenn eine unabhängige Zweitlesung (gemini-3.5-flash,
  thinkingLevel LOW) Datum UND Endsumme selbst liest und beides passt. Leere
  oder halbe Lesung = nicht bestätigt.
- **Feld-Gate der Pipeline** (`ocrFieldAgreement`): wo Uneinigkeit vermerkt
  ist, wird genau dieses Feld strenger geprüft (Summe ±2 ct, Markt muss
  passen, Artikelzahl uneinig → Mensch, Uhrzeit uneinig → Artikel-Treffer
  zählen auch mit großem Zeitabstand). **Schwache Lage** (< 2 stimmige
  Lesungen, kein Vermerk, `none`): alle Felder gelten als uneinig; zusätzlich
  bleibt ein Bon liegen, dessen Artikelzahl knapp (≤ 1) über einer
  Betragsgrenze liegt, oder bei dem die Zweitlesung unter diese Grenze zählt.
- **Markt**: nur ganze Wörter, ohne Gattungs- und Rechtsformwörter (GmbH,
  Markt, Center, Drogerie, Tankstelle …) und ohne Himmelsrichtungen bei
  Kettennamen (Nord/Süd). Nennt die Lesung eine ANDERE bekannte Kette als die
  zugeordnete, passt es nie. Sonst passt es, wenn ein Wort der Kette (id,
  Katalogname) in der Lesung steht, oder die Mehrheit — bei mehreren Wörtern
  mindestens zwei — der Wörter des Rohnamens vom Bonkopf (`merchant.raw`, für
  inhabergeführte Märkte; ein gemeinsamer Vorname reicht nicht). „E center"
  gilt als EDEKA, „R E W E" als REWE. Ohne diese Regeln galten 946 von 27.280
  Paaren verschiedener Ketten als passend (Prüfrunde 4).
- **Datum:** Schreibweisen werden vereinheitlicht (2026-9-23, 23.09.26) —
  für den Vergleich UND die Jahresprüfung. Nur
  Jahr falsch gelesen oder Tag↔Jahr vertauscht (23.09.26 → 2023-09-26) ist eine
  Fehllesung der Zweitlesung; ein Jahr NACH dem Upload ist immer eine. Zweifel
  (`jahr_unsicher`, Mensch), wenn eine Erstlesung das andere Jahr hat — und
  IMMER, wenn die Pipeline ein Vorjahres-Datum aufs Upload-Jahr korrigiert hat
  (echter Vorjahres-Bon am Jahrestag). Eine alte Korrektur (2020 → 2026)
  erklärt dieselbe Fehllesung und hält nicht an — liest die Zweitlesung dann
  ein drittes Jahr, bleibt der Zweifel.
- **Ablehnen** nur als Doppel gegen eine schon ENTSCHIEDENE Kopie
  (approved/paid/no_reward/matched). Pro Person wird die älteste zuerst
  entschieden; eine jüngere offene Kopie zählt nicht, eine ältere offene hält
  diesen Bon an (`zwilling_unentschieden`). Gleicher Markt/Tag/Endsumme bei
  einer anderen Person (`contentHash`) → Mensch.
- **Budget:** vor jeder Freigabe die wirksame Aktion frisch lesen und gegen
  „frisch − eigene Freigaben, deren Buchung noch nicht bestätigt ist" prüfen
  (Personen laufen parallel). Bestätigt gebucht → fällt aus der Reservierung
  (steckt im frischen Stand); unklar (Netz, 5xx) → bleibt drin. Im
  Antwortfenster des Resolvers zählt eine Buchung dadurch kurz doppelt — die
  vorsichtige Richtung. Eine Variante mit „Startstand − Reservierungen"
  übersah Buchungen der Pipeline und führte zu Teilbuchungen (Prüfrunde 5).
  Reicht es nicht, bleibt der Bon liegen (`budget_leer`). Fehlendes
  Budgetfeld = 0 (wie der Resolver). Sonst schlösse der Resolver ihn
  endgültig ohne Prämie ab.
- **Beanstandung merken** (`bonRundeBeanstandet` am Bon): konnte die
  Zweitlesung einen Bon nicht bestätigen (Widerspruch, nicht lesbar, Bild
  defekt, Jahr zweifelhaft), liest die Runde ihn nicht wieder nach — bis
  Patrick entscheidet oder die Pipeline den Bon neu verarbeitet
  (`updatedAtMs`). Sonst würde ein Fall so lange gelesen, bis eine Lesung
  zufällig passt. Grenzlage, Budget und Technik werden NICHT gemerkt.
- **„Ohne Prämie" entscheidet die Runde nie** — die Pipeline hält wegen
  niedriger Lese-Sicherheit nur Bons, die sonst einen Betrag hätten.
- **Direkt vor der Entscheidung** wird der Bon frisch gelesen; hat er sich
  seit dem Laden geändert (`updatedAt`, Status), bleibt er liegen.

**Betrieb**
- **Zeit** (900 s Function): nach 7 min kein neuer Bon, Lesen bis 11 min
  (jeder Versuch auf die Restzeit gekappt), Resolver nur bis 12½ min.
- **Zeitüberschreitung beim Resolver** (Netz, 504): nachlesen; nur ein zum
  Aufruf passender Endstatus zählt als Ergebnis, und nicht, wenn inzwischen
  ein Mensch in der Konsole entschieden hat.
- **„Bild defekt"** nur bei bildspezifischen Fehlertexten (decode, image
  data). Ein anderer 400 von Google (z. B. Modell-Änderung wie am 22.09.) ist
  Technik — sonst würde ein Infrastrukturfehler als Urteil über das Bild
  dauerhaft am Bon gemerkt.
- **Warnungen:** `bonrunde_fehlt` (scharf rot, Trockenlauf gelb),
  `bonrunde_unbekannt` (Bericht nicht lesbar — die Foto-Runde schreibt ihren
  Bericht trotzdem),
  `bonrunde_abgebrochen`, `bonrunde_laeuft`, `bonrunde_technik` (schon ab einem
  Bon, auch bei gescheiterter Zweitlesung), `bonrunde_budget`,
  `bonrunde_offen` (≥ 5), `bonrunde_kollision` (mehr Freigaben einer Person
  für einen Tag als `dailyCap`).
- **Rollback:** `bonWorker` auf false setzen (wirkt ab dem nächsten Lauf,
  bricht einen laufenden nicht ab). Kein Deploy nötig.
