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
| Halte-Grund für die Prüfkonsole | `review.rundeOffen` (`fotoRundeRegeln.rundeOffenEintrag`), gelesen in `einreichung.precheckOf`; Foto-Befunde früherer Läufe: `fotoRundeRegeln.bildMitVorbefund` |
| Warnungen | `src/warnungen.js` (+ Tests) |
| Buchung + Push | `crowd-upload-reward` (Trigger bei `approved` bucht; der Sammler `crowd_push_sammler` verschickt EINE Nachricht pro Person) |
| Bericht | Firestore `ops_tagesberichte/{lauf}` und `ops_tagesberichte/aktuell` |
| Dashboard | https://md-receipt-admin.web.app/tagesbericht.html (Callable `reviewTagesberichte`) |
| Morgen-Chat | geplante Aufgabe `morgenrunde-bericht` in der Claude-App (08:35/08:48), postet in ClickUp |
| Schalter | `cashback_config/v1.fotoWorker === true` → scharf, sonst Trockenlauf |
| Bildschirmfoto als Preisbeleg | `src/preisBildschirm.js` (+ Tests), Schalter `cashback_config/v1.preisBildschirmRegel`: `false` \| `'shadow'` (Standard) \| `true` |
| Preisbeleg „Kassenbon" (Warenkorb, fremder Händler) | dieselbe Datei, EIGENER Schalter `cashback_config/v1.preisBelegRegel`: `false` \| `'shadow'` (Standard) \| `true` (Nachprüfung 05.10.2026) |
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
   Aufruf die Nummer unter dem Strichcode des Barcode-Fotos mit (`eanFoto`)
   und — ist einer der Schalter `preisBildschirmRegel` / `preisBelegRegel`
   nicht aus — woher der Preis stammt (`preisQuelle`; mit Preisbeleg auch die
   Unterfragen zum Kassenbon); mit Bildschirm-Regel liest die Runde danach den
   Kopf des Preisfotos (192 KB: Format, Maße, Kamerahersteller, EXIF-Datum/Software);
   wo nötig folgt eine zweite Lesung nur dieses Fotos (innerhalb der
   Arbeitszeit). Ein Halte-Befund eines früheren Laufs gilt weiter, bis ein
   Mensch in der Konsole entscheidet. Die Runde
   legt das Ergebnis in `eanFotoOcr` ab (als Ganzes ersetzt), auch im Trockenlauf.
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
- **Bildschirmfoto als Preisbeleg (Patrick 04.10.2026: „ja, bau das" —
  erst eine Woche beobachten, dann ablehnen mit `fotos_unpassend`).**
  Anlass: 40 Einreichungen von 20 Personen zeigten als „Preis" ein
  Bildschirmfoto (Händler-App, Online-Shop, Online-Prospekt, Google), alle
  bezahlt (5,77 €), 6 davon seit der Preis-Pflicht; Prüfrunde 2 fand 2
  weitere bezahlte außerhalb der Messmenge (mindestens 42). Der Lesedienst las dort
  einen Preis und hielt das Bild meist für ein Preisschild; die Bildprüfung
  nannte alle 40 „echt" — die Preis-Pflicht allein fängt sie nicht.
  **Zwei Signale:** (1) die Bildprüfung beantwortet im selben Aufruf
  `preisQuelle` = laden | kassenbon | bildschirm | keiner | unklar (Wortlaut
  in `taeglicheRunde.js`, `PREIS_QUELLE_FRAGE`, wortgleich mit der Messung —
  wer ein Wort ändert, misst neu); (2) Bildmerkmale der Datei
  (`bildschirmMerkmal`): kein Kamerahersteller in den EXIF-Daten UND (EXIF
  mit Software oder Aufnahmedatum ODER PNG ODER Seitenverhältnis weder 4:3
  noch 16:9). Gemessen 04.10.: im vollen Aufruf 40 von 40 Bildschirmfotos
  „bildschirm", keine von 54 schwierigen Gegenproben (e-Bons mit App-Rahmen,
  E-Paper-Schilder, Digitaldisplay im Kaufland); nur mit dem Preisfoto 0 von
  311 Nicht-Bildschirmen, 167 von 167 Kassenbons richtig. Merkmal:
  Kamerafotos 0/170; die App-Kamera speichert immer 4:3 (3.687 von 3.688) und
  ohne Hersteller, Datum und Software — auf iOS steht ein EXIF-Rest aus
  Ausrichtung, Auflösung und Pixelmaßen (49 von 294 Stichproben, Prüfrunde 2;
  die Messung hatte das als „ohne EXIF" gezählt). Ein bloßer EXIF-Block
  taugt deshalb NICHT als Zeichen, nur Software (0x0131) oder Aufnahmedatum
  (0x9003). Allein taugt das Merkmal nicht: e-Bons (127/127) und
  zugeschnittene Regalfotos tragen es auch.
  **„40 von 40" ist ein Auswahl-Effekt** (Prüfrunde 2): die 40 wurden über
  die Merkmal-Klasse gefunden, außerhalb gab es nur 100 Zufallsfälle. In der
  ungeprüften Klasse „EXIF ohne Hersteller, Kameraformat" (3 Dateien im
  Bestand) lagen 2 bezahlte Bildschirmfotos (Billa-Online-Shop 1200×2152 ≈
  16:9; ein auf „2,79 € Aldi Süd" zugeschnittener App-Ausschnitt 446×248) —
  beide mit EXIF-Datum ohne Hersteller, deshalb die EXIF-Bedingung. Die
  dritte Datei ist ein nachbearbeitetes Regalfoto (mit „laden" → liegt).
  Mehrkosten im Bestand genau diese 3 Dateien. Der Bildkopf-Parser ist
  handgeschrieben (sharp scheitert an gekürzten JPEGs) und wurde an 627
  echten Preisfotos gegen die Messung geprüft, nach der Erweiterung an 731
  (alle mit EXIF, 294 App-Kamera-Fotos, die 40 Bildschirmfotos): 0
  Abweichungen, kein App-Kamera-Foto mit Merkmal.
  **Regel** (`preisBildschirmBefund`, ausgewertet in `freigabe()`, NACH der
  Preis-Pflicht — bei 36 von 37 Bildschirmfotos der Vor-Analyse war ein Preis
  gelesen, die Regel muss greifen, bevor er zur Freigabe führt):
  „bildschirm" + Merkmale + der Lesedienst hat das Preisfoto GELESEN und
  KEINEN Kassenbon gesehen (`lesedienstOhneBonOf`: preisschild/produktfoto/
  sonstiges) → ablehnen; „bildschirm" sonst (ohne Merkmale, Merkmale
  unbekannt, der Lesedienst sah einen Kassenbon, oder er hat das Preisfoto
  gar nicht gelesen) → liegen lassen; „laden" + Merkmale → liegen lassen
  (meist zugeschnittene Regalfotos, ~1 pro Woche); „keiner" + Merkmale →
  liegen lassen wie eine fehlende Antwort (Prüfrunde 3 — las der Lesedienst
  trotzdem einen Preis, wäre die Preis-Pflicht erfüllt und es würde bezahlt;
  ohne gelesenen Preis bleibt es bei „Preis fehlt"; gemessen 9 von 9 solchen
  Fällen ohne gelesenen Preis, kostet also nichts); „unklar" → liegen lassen;
  Antwort fehlt + Merkmale → liegen lassen; „laden", „keiner" oder Antwort
  fehlt, aber Kopf des Preisfotos nicht abrufbar → liegen lassen
  (`preis_kopf_nicht_lesbar`); „kassenbon" → nie abgelehnt (Kassenbons
  zählen immer, auch e-Bons und App-Bons als Bildschirmfoto — Entscheidung
  Patrick 04.10., CLAUDE.md), aber liegen lassen, wenn die Merkmale passen
  (oder der Kopf nicht abrufbar war, Prüfrunde 3) UND der Lesedienst das
  Preisfoto gelesen und KEINEN Bon gesehen hat (Prüfrunde 2 — sonst hinge die
  Bezahlung an EINER Antwort, etwa bei einem Warenkorb oder einer
  Bestellübersicht als „Bon"; gemessen trägt der Lesedienst 0 von 167
  Kassenbons als „kein Bon", kostet also nichts). Ein Halte-Befund macht
  nur aus einer sonst fälligen FREIGABE einen offenen Fall
  (`preis_bildschirm_unsicher`); „Preis fehlt" bleibt eine Ablehnung, ein
  schon offener Fall behält seinen Grund. Ein Ablehn-Befund ersetzt auch
  „Preis fehlt" und einen sonst offenen Fall (Ort auffällig, Preis unsicher,
  Kontosperre unbekannt — die Ablehnung hängt an keinem dieser Abgleiche; die
  Kontosperre liest die Runde beim Schreiben ohnehin nach). Ein
  „Nachlesen gescheitert" ersetzt sie dagegen nur, wenn die Erstlesung das
  Preisfoto schon gelesen hatte — sonst kommt es gar nicht zur Ablehnung
  (Prüfrunde 3, siehe unten).
  **Gegenzeichen des Lesedienstes** (`lesedienstBonOf`, Gegenprüfung
  04.10.2026): `priceImageKind` kassenbon/beides (Erst- ODER Nachlesung —
  die Nachlesung ergänzt, sie ersetzt nicht; Prüfrunde 2) oder eine gelesene
  Bon-Kopfzeile in `priceReceipt`. Gemessen: 164 von 167
  Kassenbons tragen es, 0 von 40 Bildschirmfotos. Ohne dieses Zeichen hinge der
  Schutz der e-Bons an EINER Modellantwort — die Merkmale tragen sie immer
  (127/127), und ein Modellwechsel (wie 22.09.) lehnte sie still ab. Bewusst
  ohne „preisschild": so hielt der Lesedienst 26 von 40 Bildschirmfotos.
  Erkennt der Lesedienst während des Laufs einen Kassenbon, wird eine schon
  geplante Ablehnung nicht geschrieben (Transaktion, wie bei „Preis fehlt").
  **Abgelehnt wird nur auf eine Lesung hin** (Prüfrunde 3, 04.10.2026): hat
  der Lesedienst das Preisfoto NICHT gelesen (Erstlesung gescheitert,
  `productNameOcrFehler`, und die Nachlesung am Google-Limit oder an der
  Zeitgrenze gescheitert), fehlt genau der Abgleich, der einen e-Bon vor einer
  einzelnen Fehlantwort schützt — dann liegen lassen, nie ablehnen. Kostet
  gemessen 1 von 40 Bildschirmfotos (vom 11.09., ohne Bildart-Feld; die 6
  seit dem 26.09. tragen alle „gelesen, kein Bon"). Ebenso zählt, was die
  Nachlesung des Laufs (Preis oder Hersteller — sie liest das Preisfoto mit)
  sah, auch wenn nichts übernommen wurde (zwei Lesungen, verschiedene
  Beträge — dann steht ihre Bildart nicht am Dokument): sah eine davon einen
  Kassenbon, ist das ein Gegenzeichen (`lesedienstBonOf(x, zusatzArten)`).
  Nur in diese Richtung — ungeeinte „preisschild"-Lesungen machen nichts
  ablehnbar.
  **Technik ist kein Freispruch** (Gegenprüfung 04.10.2026): ist der Kopf des
  Preisfotos nicht abrufbar (Storage, Zeitgrenze), gibt die Regel einen Preis
  „aus dem Laden" (auch „keiner", keine Antwort, und einen „Kassenbon", dem
  der Lesedienst widerspricht) nicht frei — wie `kontosperre_unbekannt` und
  `foto_abgleich_gescheitert`. Ein Format ohne lesbare Maße (WebP, HEIC) ist
  dagegen kein Technikfehler. Dieser Halt wird NICHT weitergetragen: am
  nächsten Morgen prüft die Runde neu. Scharf und bei mehr als einem Viertel
  der befragten Fälle (mind. 8) warnt der Bericht ROT
  (`preisfoto_kopf_nicht_abrufbar`) — das ist ein Tag fast ohne Freigaben.
  **Ein angehaltener Fall wird nie automatisch frei** (Gegenprüfung
  04.10.2026, wie Barcode- und Foto-Befund): ein Befund aus einem SCHARFEN Lauf
  steht als `review.rundeOffen.preisBildschirm` am Fall und gilt im nächsten
  Lauf weiter (`preisBildschirmVorbefund`/`preisBildschirmMitVorbefund`) —
  auch wenn das Modell dann anders antwortet oder die Bildprüfung scheitert.
  Er verschärft höchstens zu „liegen lassen", nie zur Ablehnung. Ein Befund
  „liegen lassen" bleibt das auch, wenn der Tag selbst „ablehnen" liest
  (Prüfrunde 3, 04.10.2026): gehalten wurde, weil sich etwas widersprach
  („laden" oder „kassenbon" zu einer Datei wie ein Bildschirm), und die
  Antwort des Vortags steht nicht am Dokument — würde jeden Morgen neu
  gefragt, wüchse die Wahrscheinlichkeit einer Ablehnung mit jedem Tag, den
  der Fall auf Patrick wartet. Nur ein Befund „ablehnen" (von der Notbremse
  zurückgehalten) darf bei heutiger Ablehn-Lesung abgelehnt werden. Folge:
  ein am ersten Tag nur wegen „unklar" oder fehlender Antwort gehaltenes
  Bildschirmfoto lehnt die Runde nicht mehr selbst ab, es wartet auf die
  Konsole (gemessen selten: unklar 3 von 351, ohne Antwort 0 von 448).
  Aufheben: jede Entscheidung in der Konsole
  (ersetzt `review`), oder der Schalter DER REGEL, die den Befund trägt
  (`false` nimmt ihn weg, in `'shadow'` hält er nichts mehr). Ein Befund aus
  der Beobachtung wird nie übernommen.
  **Zwei Schalter, getrennt (Nachprüfung 05.10.2026):** Bildschirm-Regel
  `preisBildschirmRegel` und Preisbeleg `preisBelegRegel`. Bis dahin hing der
  Preisbeleg am Schalter der Bildschirm-Regel — wer ihn zurücknehmen wollte
  (etwa weil er zu viele Bons inhabergeführter Märkte anhält), gab am nächsten
  Morgen auch jedes angehaltene Bildschirmfoto und jede von der Notbremse
  zurückgehaltene Bildschirm-Ablehnung ohne Menschen frei (nachgestellt).
  Jetzt wirkt jede Regel nur unter IHREM Schalter (`preisBildschirmLage`), und
  der Eintrag am Fall nennt, welche Regeln ihn halten
  (`preisBildschirm.regeln`, z. B. `['bildschirm']`, `['beleg']` oder beide);
  ältere Einträge ohne `regeln` gelten über `art: 'beleg'` als Preisbeleg,
  sonst als Bildschirm-Regel, ein „ablehnen" immer als Bildschirm-Regel.
  Ein Fall, den beide Regeln halten, liegt, solange eine der beiden scharf ist.
  **Rückweg je Regel — und was er freigibt:**
  `preisBildschirmRegel` auf `'shadow'` oder `false` gibt am nächsten Morgen
  alle von der Bildschirm-Regel angehaltenen Fälle frei (auch zurückgehaltene
  Bildschirm-Ablehnungen), sofern nichts anderes sie hält — sie werden bezahlt.
  `preisBelegRegel` auf `'shadow'` oder `false` ebenso für die Preisbeleg-Halte.
  „Sofern nichts anderes sie hält" schließt die ANDERE Regel ein — und ein
  gehaltener Fall wird dabei nie abgelehnt: liest die Bildschirm-Regel an dem
  Morgen „ablehnen", hält sie ihn nur (`preis_bildschirm_unsicher`), bei
  `'shadow'` wie bei `false` (Nachprüfung 05.10.2026: mit `false` wurde ein
  Preisbeleg-Halt auf eine einzige neue „bildschirm"-Lesung hin endgültig
  abgelehnt; `ablehnenGesperrt` in `preisBildschirmMitVorbefund`).
  Wer das nicht will, entscheidet die angehaltenen Fälle VOR dem Umschalten in
  der Konsole (Liste: Tagesbericht bzw. Konsole mit Hinweis
  `preis_bildschirm_unsicher` / `preis_beleg_unsicher`). Wie viele so bezahlt
  wurden, steht am Morgen danach im Tagesbericht
  (`preisBildschirm.nachRuecknahmeFrei`, „nach Rücknahme einer Regel freigegeben").
  **Schalter** `cashback_config/v1.preisBildschirmRegel`: `false` = aus
  (kein Bildkopf, kein Bildschirm-Befund, nichts am Dokument — die Frage nach
  der Preisquelle entfällt erst, wenn auch `preisBelegRegel` aus ist, denn der
  Preisbeleg braucht die Antwort „kassenbon"); `'shadow'` =
  Beobachtung, entschieden wird wie bisher; `true` = scharf (wirkt nur, wenn
  auch `fotoWorker` scharf ist). `preisBelegRegel` genauso: `false` = keine
  Unterfragen zum Kassenbon (die Anweisung ist dann wortgleich die vom
  04.10.), kein Beleg-Befund; `'shadow'` = Beobachtung; `true` = scharf (nur
  liegen lassen). Fehlt ein Schalter oder hat er einen anderen
  Wert (Tippfehler, `"true"` als Text — so legt die Firebase-Konsole ein neues
  Feld standardmäßig an!) → `'shadow'`: ein Tippfehler schaltet weder still
  scharf noch die Beobachtung ab, steht aber gelb im Bericht
  (`preisbildschirm_schalter_unbekannt` bzw. `preisbeleg_schalter_unbekannt`,
  mit Wert und Typ; Prüfrunde 2).
  Gelesen werden beide Schalter EINMAL, zusammen mit `fotoWorker` (index.js reicht
  sie durch): ein eigenes zweites Lesen konnte allein scheitern, und als
  `'shadow'` hätte dann kein scharfer Befund mehr gehalten — angehaltene Fälle
  wären ohne Menschen frei geworden (Prüfrunde 2). Scheitert das Lesen, läuft
  die Runde gar nicht. Ein Wechsel ändert die Regelversion (gelbe Warnung
  „Regeln geändert"). Kein Deploy nötig.
  **Am Dokument** (`review` ist server-only, firestore.rules) steht so wenig
  wie möglich, denn das Dokument liest der Einreicher selbst (firestore.rules
  `crowd_uploads` read für den Eigentümer, die App lädt es ganz): NUR bei einem
  nach dem Lauf offenen Fall mit Befund `review.rundeOffen.preisBildschirm` =
  `{modus, befund, seit, regeln}` (`regeln` nur bei scharfem Befund) und ein
  neutraler Hinweis („Preisquelle unsicher …
  Einzelheiten im Tagesbericht"). Nicht am Dokument (Gegenprüfung 04.10.2026):
  die Antwort und Begründung des Modells (`preisQuelle`, `preisQuelleGrund`),
  das Merkmal, Format, Maße, Gerätemarke — das wäre eine Anleitung zum
  Umgehen (zuschneiden, Statusleiste weg); und an freigegebenen Fällen gar
  nichts, sonst trüge in der Beobachtungswoche jedes bezahlte Bildschirmfoto
  eine Woche Vorwarnung. Alles das steht im Tagesbericht (nur Admins).
  Abgelehnt steht `rejectReason: 'fotos_unpassend'` (App-Text seit 05.09. in jeder Version;
  `preis_fehlt` behauptete „kein Preis zu sehen" und gibt es erst ab 6.0.20),
  intern `review.reason: 'preis_bildschirm'` (`duplicatePolicy.APP_GRUND`).
  Ein eigener App-Text liegt unter `preis_bildschirm` in `REASON_COPY` für
  eine spätere Version bereit. Nicht in `DOPPEL_GRUENDE`: wer danach mit
  einem echten Preisfoto nachreicht, wird normal geprüft.
  **Bericht** `preisBildschirm`: Modus, Antworten je Quelle, Merkmal
  ja/nein/unbekannt, `befundAblehnen`, `befundHalten` (nur wo sonst
  freigegeben), `stattFreigabe` (ohne die Regel bezahlt) — diese drei NUR für
  die Bildschirm-Regel (auch ein Halt nur wegen des nicht abrufbaren Bildkopfs)
  und nur am Morgen des Befunds; ein reiner Preisbeleg-Fall zählt dort nicht,
  ein Fall, den beide Regeln halten, in beiden Abschnitten (Nachprüfung
  05.10.2026: vorher standen alle Preisbeleg-Fälle auch hier, und ein scharf
  gehaltener Fall kam an jedem Morgen, an dem er auf Patrick wartete, erneut
  dazu — genau die Zahlen, nach denen die Regeln scharf geschaltet werden).
  `ausVortagen`: liegt weiter, weil ein Befund der Bildschirm-Regel aus einem
  früheren Lauf heute wirkt (auch eine von der Notbremse zurückgehaltene
  Ablehnung — die zählt nur am ersten Morgen als `befundAblehnen`);
  `nachRuecknahmeFrei`: ein scharfer Befund stand am Fall, seine Regel ist
  zurückgenommen, heute bezahlt. Die Zählung je Fall steht in
  `preisBildschirm.preisBildschirmZaehlart`. `kassenbonMitMerkmal`,
  `bildschirmTrotzBon` (Bildprüfung „Bildschirm", Lesedienst „Kassenbon"),
  `kassenbonOhneLesedienstBon` (Bildprüfung „Kassenbon", Lesedienst las und
  sah keinen — liegt), `kassenbonLesedienstOhneBon` + bis 20
  `kassenbonLesedienstOhneBonFaelle` (dasselbe für ALLE solchen Fälle, auch
  ohne Merkmale — die werden bezahlt; Prüfrunde 3, siehe Lücken),
  `schalterUnbekannt` (nur bei unbekanntem Wert),
  `kopfNichtAbrufbar`, `vorbefund` (Fälle, die ein Befund früherer Läufe heute
  weiter liegen lässt, beide Regeln, jeder Fall einmal) und bis 50 Fälle der
  Bildschirm-Regel mit Link in die Konsole, je Fall mit Antwort, Begründung,
  Datei und `vorbefund` (seit wann).
  **Kosten:** ~440 Eingabe- und ~25
  Ausgabe-Token je Fall im ohnehin laufenden Aufruf (~3 $ im Monat zum
  Listenpreis) plus ~120 Storage-Abrufe à 192 KB am Tag.
  **Nach der Beobachtungswoche:** im Dashboard jeden „wäre abgelehnt"-Fall
  am Preisfoto ansehen (Ziel: 0 echte Preisschilder/Bons darunter), dazu
  jeden „Kassenbon, Lesedienst sah keinen" (Ziel: nur echte Bons), dann
  `preisBildschirmRegel: true` setzen. Rückweg: `'shadow'` oder `false` —
  gibt die angehaltenen Fälle DIESER Regel frei (siehe „Rückweg je Regel").
  Den Preisbeleg schaltet `preisBelegRegel` getrennt scharf.
  Nichts wirkt rückwirkend: in der Beobachtung freigegebene Fälle bleiben
  bezahlt, zurückgefordert wird nichts.
  **Vor dem Ausrollen gemessen (04.10.2026, nur lesend):** die Zusatzfrage
  ändert die übrigen Antworten nicht — an 40 frischen, von der Runde
  entschiedenen Fällen (davon 10 Ablehnungen) waren echt, lose Ware,
  trägt Angaben, dieselbe Ansicht und Preis sichtbar bis auf eine Antwort
  gleich (Preis sichtbar „unsicher" → „ja" bei einem freigegebenen Fall);
  die Regel hätte dort nichts angehalten. Der Bildkopf-Parser lieferte an
  627 Preisfotos dieselbe Klasse wie die Messung (0 Abweichungen).
- **Preisbeleg „Kassenbon": Warenkorb und fremde Händler (Entscheidung
  Claude im Auftrag Patricks, 04.10.2026 — Patrick: „Kannst du selbst
  entscheiden?").** Beide Befunde lassen nur LIEGEN, nie ab, und hängen am
  EIGENEN Schalter `preisBelegRegel` (Nachprüfung 05.10.2026; bis dahin am
  Schalter der Bildschirm-Regel, siehe „Zwei Schalter"): Beobachtung zählt
  nur, scharf wird aus einer sonst fälligen Freigabe ein offener Fall. Nur bei
  der Antwort „kassenbon" (`preisBelegBefund` in `src/preisBildschirm.js`).
  **(1) Ohne Kassenbon-Merkmale (Warenkorb-Lücke aus Prüfrunde 3):** ein auf
  Artikelzeilen zugeschnittener Online-Warenkorb oder eine Bestellliste hieß
  „kassenbon" und wurde still bezahlt. Jetzt braucht der Beleg mindestens EIN
  Merkmal eines abgeschlossenen Einkaufs — laut Bildprüfung (`belegMerkmale`:
  `haendler` Name/Logo, `datum` Kaufdatum/Uhrzeit, `summe`, `nummer` Bon-/
  Kassen-/Beleg-/Rechnungs-/Bestell-Nr. oder TSE, `zahlung`, `steuer`
  MwSt.-Aufstellung oder Kennzeichen A/B hinter den Preisen) ODER laut
  Lesedienst (gelesener Bon-Kopf in `priceReceipt`: Name oder Anschrift).
  Sonst → liegen. Ein Bon-Kopf des Lesedienstes allein genügt (kein echter
  Bon hängt an EINER Modellantwort); keine verwertbare Antwort auf die
  Merkmal-Frage ist dagegen kein Freispruch. Eine von der Bildprüfung
  genannte Kette zählt NICHT als Merkmal — das Modell kann sie aus dem
  Produkt („K-Classic") erschließen. Die Steuer-Kennzeichen gehören dazu,
  weil zugeschnittene echte Bons sie meist tragen und ein Warenkorb nie.
  **(2) Fremder Händler** (wie für Bons seit 04.10.: „nur unsere Märkte,
  Amazon nein", CLAUDE.md): die Bildprüfung nennt die KETTE nach Name/Logo
  (`belegHaendler`; „bei inhabergeführten Märkten die Kette, nicht den
  Inhaber"). Löst kein genannter Name — weder dieser noch der vom Lesedienst
  gelesene Filialname — auf einen unserer Märkte auf → liegen. Nennt die
  Bildprüfung keinen, zählt der Filialname des Lesedienstes allein (TK Maxx).
  Unsere Märkte = erstes Wort jedes Namens in `discounter` (täglich gelesen,
  ~20 Dokumente; ein neu aufgenommener Markt wie Picnic gilt sofort) plus feste
  Ketten und Vertriebslinien im Code (`UNSERE_KETTEN`: nahkauf, Marktkauf,
  E center, Neukauf, nah & gut, diska, Eurospar/Interspar) — die sind auch der
  Rückfall, wenn `discounter` nicht lesbar ist (gelbe Warnung). Ganze Wörter
  („R E W E" wird zusammengezogen), Komposita nur mit Schlüsseln ab fünf
  Buchstaben („Edekamarkt"), KEINE Tippfehler-Toleranz (die Bon-Pipeline
  machte damit aus „Das" dm). dm-, Rossmann-, REWE-Online usw. gelten.
  **Am Dokument** nur `review.rundeOffen.grund: 'preis_beleg_unsicher'`,
  `preisBildschirm: {modus, befund: 'halten', seit, regeln: ['beleg'], art: 'beleg'}` und der
  Hinweis „Preisbeleg unsicher — …" — bewusst ohne „Warenkorb", „Händler",
  Merkmale: wer liest, woran es hing, schneidet sonst den Kopf ab oder die
  Summenzeile dazu. Welcher der beiden Befunde, steht nur im Tagesbericht.
  Ein scharfer Halt wird wie jeder andere nie automatisch frei
  (`preisBildschirmVorbefund` trägt `regeln` weiter) — außer man nimmt
  `preisBelegRegel` zurück; die Bildschirm-Regel berührt ihn nicht. Konsole:
  Hinweis `preis_beleg_unsicher`, keine Sperre.
  **Bericht** `preisBildschirm.beleg`: `modus` (Schalter `preisBelegRegel`),
  `schalterUnbekannt`, Zahlen und Fälle wie unten; mit `preisBelegRegel: false`
  alle 0 (nicht gefragt). Je Fall in `preisBildschirm.faelle` sagt `wirkt`, ob
  ein scharfer Schalter etwas geändert hat.
  **Gemessen 05.10.2026** (nur lesend, 272 Aufrufe im vollen Aufruf der
  Runde mit der neuen Anweisung, 4,05 $; scratchpad `pb-beleg/`):
  - Echte Kassenbons (Wahrheit der Messung vom 04.10.): 166 von 167
    „kassenbon". (1) hält 3 — e-Bons eines Nutzers, eng auf Artikelzeilen
    OHNE Kennzeichen zugeschnitten, von einem Warenkorb nicht zu
    unterscheiden. (1) kann nur greifen, wo der Lesedienst KEINEN Bon-Kopf
    las: das waren 41 der 166 (34 e-Bons, 19 davon von einem Nutzer, nur 5
    Papierbons) — „0 von 40 Papierbons" sagte deshalb wenig (35 der 40 hatten
    einen Kopf). Ohne die Steuer-Kennzeichen als
    Merkmal wären es 25 gewesen, mit „Summe allein zählt nicht" 6, nur mit
    Nummer/Zahlung/Steuer 8 (von 41 echten Bons ohne Lesedienst-Kopf). (2) hält die Amazon-Rechnung
    (zu einem Netto-Produkt, bezahlt) — gewollt.
  - **Nachmessung Papierbons (Nachprüfung 05.10.2026, nur lesend, 81
    Aufrufe, 1,20 $; scratchpad `pb-pruef/`):** Im Bestand vom 04.10. sind 155
    Kassenbon-Preisfotos Kamerafotos ohne Lesedienst-Kopf (ungemessen 150).
    41 davon gemessen (alle 18 Aldi Nord, 23 andere Märkte, gleiche
    Anweisung): 4 bleiben liegen, alle echt und bezahlt — eine
    Aldi-Süd-Nahaufnahme mit abgeschnittenen Preisen (nur Artikelnummern), ein
    Aldi-Nord-Ausschnitt aus zwei Artikelzeilen (dasselbe Foto zweimal
    eingereicht), ein Kaufland-Ausschnitt. Ein Mensch sieht diesen Fotos den
    Kauf auch nur am Thermopapier an. Aldi Nord druckt Ziffern („€ 1"/„€ 2")
    statt A/B: als `steuer` erkannt in 16 von 18, auch bei Ausschnitten nur
    aus Artikelzeilen — die Anweisung bleibt deshalb wortgleich.
    Stabilität: dieselben 40 Fälle mit genau einem oder keinem Merkmal ein
    zweites Mal gefragt (identische Eingabe, gleiche Token-Zahl): 0 Wechsel
    zwischen „mit Merkmal" und „ohne", ein Wechsel der Quelle (kassenbon →
    keiner, beide ohne Merkmal). Die 22 Bons, die nur über `steuer` bestehen,
    hängen damit nicht an einer zufälligen Antwort; eine zweite Bildprüfung
    vor dem Liegenlassen änderte nichts und ist deshalb nicht gebaut.
  - Alle 27 Preisbelege, deren gelesener Händlername nicht auf einen unserer
    Märkte auflöst (24 inhabergeführte REWE/EDEKA, Amazon, Wreesmann,
    TK Maxx): fremd erkannt 3 von 3; bei den Inhaber-Bons nannte die
    Bildprüfung 18-mal die Kette, 5-mal den Namen eines REWE-Markts ohne Logo
    auf dem Bon („Krummenerl") → liegen (Mensch sieht es dem Bon auch nicht
    an, nur am gewählten Markt).
  - Die Zusatzfragen verschieben die übrigen Antworten nicht messbar:
    Bildschirmfotos 40 von 40 „bildschirm" (Regel: 39 abgelehnt, 1 liegt —
    wie vorher), Laden 22/22, kein Preis 8/8, eine Antwort „keiner" wurde
    richtig „kassenbon". Ein e-Bon-Ausschnitt aus einer einzigen Zeile hieß
    „laden" (vorher nur im Modus „nur Preisfoto" gemessen) und bleibt über die
    Bildschirm-Regel liegen.
  - Synthetische Warenkörbe (auf Artikelzeilen zugeschnitten, 4:3 ohne EXIF,
    je zweimal): 7 von 8 „bildschirm" (liegen über die Bildschirm-Regel), 1
    MIT Zwischensumme „kassenbon" + `summe` → bezahlt (Lücke, siehe unten).
    Bon-Zeilen mit Kennzeichen 2/2 „kassenbon" + `steuer`.
  - Eine Antwort kam als Liste verpackt zurück (`[{…}]`) — wird jetzt
    ausgepackt (vorher: „Bildprüfung gescheitert").
  - Erwartet im Betrieb: (1) etwa 3–5 pro Woche (rund jeder zehnte
    „Kassenbon" ohne Lesedienst-Kopf, 7 von 83 gemessen; davon kamen im
    September ~30, Anfang Oktober ~45 pro Woche, überwiegend Papierbons),
    (2) etwa 1–3 pro Woche (0,7 % der Bons mit gelesenem Kopf, gut die Hälfte
    davon Inhaber-Märkte ohne Logo). Zusammen ~4–8 Fälle pro Woche
    Mehrarbeit, nur scharf (vor der Nachmessung hier: ~3–5).
  **Bericht** `preisBildschirm.beleg`: `kassenbon` (befragt), `ohneMerkmale`,
  `fremderHaendler` (heutige Lesungen), `stattFreigabe` (nur am Morgen des
  Befunds, auch wenn zusätzlich die Bildschirm-Regel hält), `ausVortagen`
  (liegt weiter wegen eines Preisbeleg-Befunds eines früheren Laufs — nicht
  erneut in `stattFreigabe`, Nachprüfung 05.10.2026), `merkmaleOhneAntwort`,
  `maerkteUnlesbar`, bis 30 `faelle` (heutige Befunde und Fälle, die ein
  Preisbeleg-Befund trägt: Befund, Händler laut Bildprüfung und Lesedienst,
  Merkmale, Begründung, `wirkt`, `vorbefund`). Ein Fall, den auch die
  Bildschirm-Regel hält, steht zusätzlich in `preisBildschirm.faelle`, dort mit
  `beleg`/`belegHaendler`. **Kosten:** ~300 Eingabe- und ~40
  Ausgabe-Token mehr je Fall im ohnehin laufenden Aufruf (gemessen an 97
  gleichen Fällen; ~3 $ im Monat zum Listenpreis), ~20 Lesevorgänge
  `discounter` am Tag.
  **Nach der Beobachtungswoche** (zusammen mit der Bildschirm-Regel): jeden
  Fall der Liste „Preisbeleg" am Preisfoto ansehen — Ziel: bei „ohne
  Merkmale" nur Warenkörbe/Bestelllisten oder Ausschnitte ohne jedes Merkmal,
  bei „fremder Händler" nur Händler außerhalb unserer Märkte bzw. Inhaber-
  Märkte ohne Logo. Steht dort ein normaler Bon unserer Märkte, erst die
  Ursache klären, dann scharf schalten. Liegen bei „ohne Merkmale" vor allem
  Kamerafotos von Papierbons (Spalte Datei: 4:3, kein Bildschirm-Merkmal),
  wäre eine Möglichkeit, (1) nur auf Dateien MIT Bildschirm-Merkmal
  anzuwenden — das öffnet aber den mit der App-Kamera abfotografierten
  Warenkorb; Entscheidung mit den Fällen der Woche, nicht vorher.
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
  (`ean_abweichend`/`ean_unsicher`). Die Konsole macht daraus `hold` —
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
- Scheitert das Speichern bei einem Fall mit sperrendem Befund oder mit einem
  scharfen Halt der Bildschirm-Regel → rote Warnung `befund_nicht_gespeichert`.
- **Bildschirmfoto als Preisbeleg (04.10.2026) ist KEIN sperrender Befund.**
  Die Konsole übernimmt den Befund der Runde aus
  `review.rundeOffen.preisBildschirm` als Hinweis: `preis_bildschirm` (Befund
  „ablehnen") bzw. `preis_bildschirm_unsicher` („halten") — gelber Punkt in
  der Warteschlange, Zeile „Preisfoto: Bildschirmfoto" im Fall, Freigabe ohne
  Notiz möglich (wer hinsieht, entscheidet; Ablehnen mit A, dann 2 = „Fotos
  passen nicht", derselbe Code wie in der Runde). Nachrechnen kann sie ihn
  nicht: woran er hängt, steht bewusst nicht am Dokument, sondern im
  Tagesbericht des Laufs (`seit`). Ebenso der Preisbeleg (05.10.2026):
  `art: 'beleg'` → Hinweis `preis_beleg_unsicher`, Zeile „Preisbeleg:
  unsicher — selbst ansehen" (zählt: Kassenbon, e-Bon, Online-Rechnung eines
  unserer Märkte; nicht: Warenkorb/Bestellliste ohne Kauf, Rechnung eines
  fremden Händlers).

## Rettungsläufe vor dem Urteil

Fehlt ein Feld, wird es mit Denken nachgelesen, bevor abgelehnt wird — die
erste Erkennung läuft ohne Denkbudget und versagt regelmäßig an sauberen
Fotos (am 13./19./20.09. je zweistellig viele Fälle).

- Ergebnisse landen IMMER in eigenen Feldern (`productNameRescueOcr`,
  `eanRescueOcr`, `priceRescueOcr`, `manufacturerRescueOcr`), nie in den
  Originalfeldern — sonst ist die Qualitätsmessung der Ersterkennung verfälscht.
- Übernommen wird nur, was **zwei unabhängige Lesungen gleich lesen**.
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
- **Bildschirmfoto als Preisbeleg auffällig oft:** mindestens 4 PERSONEN und
  mehr als 2,5 % der geprüften Fälle → nur diese Ablehnungen
  (`notbremse_preis_bildschirm`; gemessen 6 in 8,5 Tagen bei ~120 Fällen am
  Tag, ~0,6 %). Personen, nicht Fälle (Prüfrunde 2): Bildschirmfotos kommen
  gebündelt — im Lauf 2026-10-02_080004 vier von zwei Personen bei 126
  geprüften (3,2 %); als Fälle gezählt hätte die Bremse genau an einem Tag
  gegriffen, an dem die Regel richtig lag, und die zurückgehaltenen Fälle
  zählten mit ihrem Befund am Folgetag wieder mit. Die frühere Schätzung
  „fälschlich an einem von 170 Tagen" setzte unabhängige Fälle voraus und
  stimmte nicht (mit Fällen: 1 von 9 scharfen Läufen seit 26.09.). Seit 26.09.
  höchstens 2 Personen je Lauf. Vorher 5 und 5 % — das ließ eine Fehllesung
  im Umfang der e-Bon-Quote (~4 %, viele Personen) an jedem echten Tag seit
  26.09. durch (Gegenprüfung 04.10.2026). Eine geänderte Lesart des Modells
  trifft viele Personen, eine Welle eine oder zwei. Zählt wie „Preis fehlt" nicht in die Gesamtquote
  (`AUSSER_GESAMTQUOTE`, am Dokument über `review.reason`). Ein zurückgehaltener
  Ablehn-Befund steht am Fall und hält im nächsten Lauf weiter, solange der
  Tag ihn nicht selbst wieder als „ablehnen" liest.
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
  automatisch aufgehoben. (`werte.eanFotoBestaetigen`)
  Ebenso: die alten Handrunden-Skripte (`.crowd-review-0909/1309.js`, nicht
  versioniert) schreiben `dup.reason` unverändert — nicht mehr benutzen.
  (e) **Bildschirmfoto als Preisbeleg (04.10.2026), offen:** Kassenbons mit
  Bildschirm-Merkmalen (e-Bons, App-Bons) bleiben unberührt, weil Kassenbons
  immer zählen. Wörtlich genommen („nur eins von beiden → liegen lassen")
  lägen ~34 e-Bons pro Woche bei Patrick — der Bericht zählt sie
  (`kassenbonMitMerkmal`). Die Wahl ist aber nicht „34 pro Woche oder
  keiner": seit Prüfrunde 2 bleibt ein „Kassenbon" mit Merkmalen liegen, wenn
  der Lesedienst das Foto las und keinen Bon sah — gemessen 0 Fälle, schließt
  aber die Lücke, dass die Bezahlung an EINER Antwort hing. „Unklar" bleibt liegen, auch ohne Merkmale (eine
  Verschärfung, gemessen 0 von 311 Nicht-Bildschirmen). Neu gegenüber der
  wörtlichen Vorgabe und deshalb Patrick vorzulegen: die Regel lehnt nicht ab,
  wenn der Lesedienst einen Kassenbon erkannte (strenger als „Bildschirm UND
  Merkmale"; gibt keinen gemessenen Bildschirmfall frei).
  (f) **Rechnungen fremder Händler — ENTSCHIEDEN (Claude im Auftrag
  Patricks, 04.10.2026):** gleiche Regel wie für Bons, „nur unsere Märkte,
  Amazon nein" — ein Preisbeleg eines Händlers außerhalb `discounter` bleibt
  scharf liegen (nicht abgelehnt). Umgesetzt und gemessen 05.10., siehe
  „Preisbeleg ‚Kassenbon'" oben. Anlass war Fall
  `otzruvTyXmQjDj9dv0RnXTzEETt1_1963faab…` (Amazon-Rechnung zu einem
  Netto-Produkt, freigegeben); zurückgefordert wird nichts.
  (g) **Warenkorb als „Kassenbon" — ENTSCHIEDEN (Claude im Auftrag Patricks,
  04.10.2026):** ein „Kassenbon" ohne jedes Kassenbon-Merkmal bleibt scharf
  liegen, auch ohne Bildschirm-Merkmale. Siehe oben.
- **Bildschirmfoto als Preisbeleg, Lücken:** ein mit der App-Kamera
  abfotografierter Bildschirm hat keine Bildschirm-Merkmale (immer 4:3, ohne
  Datum und Software). Sagt das Modell „bildschirm", bleibt er liegen (nie automatisch
  abgelehnt; gemessen 0 von 170 Kamerafotos). Sagt es „laden", wird er STILL
  freigegeben — kein Befund, keine Zahl im Bericht. Messbar ist also nur der
  Treffer, nicht der Fehlschlag; die Erkennungsrate für abfotografierte
  Bildschirme ist ungemessen (alle 40 Messfälle waren digitale
  Bildschirmfotos). Ebenso still: ein Bildschirmfoto, das nur das Foto eines
  Preisschilds zeigt (Vergleichs-App), auf 4:3 oder 16:9 zugeschnitten — im
  Modus nur mit Preisfoto sagte das Modell dort einmal „laden".
  **Auch OHNE Zuschnitt fehlt das Merkmal** (Prüfrunde 3, 04.10.2026): JEDES
  Bildschirmfoto im Format 4:3 oder 16:9, das als JPEG ohne EXIF ankommt
  (Messenger, „kompatibel teilen"), hat keins — denn so sind die Bildschirme
  selbst: iPad (2048×1536, 2732×2048), 16:9-Handys wie iPhone 8/SE (750×1334)
  und ältere Androids (1080×1920), Monitore und Laptops (1920×1080,
  1366×768). Dann entscheidet allein das Modell: „bildschirm" → liegen
  lassen, „laden" → still bezahlt. Wie oft das vorkommt, ist ungemessen
  (iOS-Bildschirmfotos sind PNG, viele Android-Fotos tragen ein EXIF-Datum,
  heutige Handys sind länger als 16:9).
  **Warenkorb als „Kassenbon"** (Prüfrunde 3, 04.10.2026): der naheliegende
  Ausweg nach einer Ablehnung — im Online-Shop eines unserer Märkte das
  Produkt in den Warenkorb legen, ohne zu kaufen, das Bildschirmfoto auf die
  Artikelzeilen zuschneiden. Die gemessene Anweisung lenkt das Modell dabei
  selbst zu „kassenbon" („auch nur ein Ausschnitt mit Bon-Zeilen", „eine
  Rechnung ist immer kassenbon"). Als 4:3 ohne EXIF (kein Merkmal) wird er
  IMMER bezahlt; mit Merkmal, wenn der Lesedienst ebenfalls einen Bon liest.
  Ob gekauft wurde, prüft niemand; ein Abgleich des Händlers mit `discounter`
  (Punkt f) schließt das nicht — ein REWE-Warenkorb ginge durch. Messbar
  gemacht: der Bericht zählt und listet jeden „Kassenbon", den der Lesedienst
  las und nicht als Bon sah (`kassenbonLesedienstOhneBon`, gemessen 0 von 167
  Kassenbons). **Seit 05.10. teilweise geschlossen** (Punkt g): ohne jedes
  Kassenbon-Merkmal bleibt ein „Kassenbon" liegen. **Weiter offen:** (a) ein
  Warenkorb, der seine Summen- oder Lieferdatumszeile zeigt, hat ein
  Merkmal und wird bezahlt (synthetisch 1 von 8 als „kassenbon" + `summe`;
  „Summe allein zählt nicht" kostete 3 weitere echte e-Bons, die nur
  Artikel und Summe zeigen). (b) Eine Rechnung eines fremden Händlers, deren
  Kopf und Logo abgeschnitten sind, nennt keinen Händler — dann greift nur
  noch der gelesene Filialname, und fehlt der, wird sie bezahlt (ungemessen).
  (c) Ein Bon eines Inhaber-Markts ohne Kettenlogo („Krummenerl", REWE)
  bleibt liegen, obwohl er gilt (5 von 23 Inhaber-Bons gemessen).
  **Zuschneiden kann zur Bezahlung führen** (Prüfrunde 2; die frühere Aussage
  „nie eine Bezahlung" war falsch): ein Zuschnitt ändert nicht nur die
  Dateimerkmale, er entfernt auch die Zeichen, an denen das Modell den
  Bildschirm erkennt (30 von 40 Begründungen nennen Statusleiste, Such- oder
  Adressleiste, Warenkorb, Herz, Sterne, Schließen/Teilen). Bleibt beim
  Zuschneiden das EXIF-Datum stehen (Galerie-App), passt das Merkmal und
  „laden" bleibt liegen. Kommt der Zuschnitt OHNE EXIF als 4:3/16:9 an (etwa
  über einen Messenger), hängt alles an der Antwort des Modells — sagt es
  „laden", wird STILL bezahlt. Ungemessen. Ein eingefügter Kamerahersteller
  macht aus „ablehnen" weiter nur „liegen lassen" — und dass Merkmale zählen,
  steht nirgends am Dokument.
  Empfehlung vor `preisBildschirmRegel: true`: etwa 10 selbst gemachte
  App-Kamera-Fotos von Produktseiten (Handy und Monitor) im vollen Aufruf
  messen (wenige Cent); dazu die 2 Bildschirmfotos aus Prüfrunde 2
  (`tT20t2pxYUC7lrfpR64l`, `FP6AmNLicieuzWrr5k0t`), etwa 10 bekannte
  Bildschirmfotos, auf 4:3 zugeschnitten und ohne EXIF (~0,20 $), je ein
  NICHT zugeschnittenes iPad- und 16:9-Desktop-Bildschirmfoto als JPEG ohne
  EXIF, und 3–5 auf Artikelzeilen zugeschnittene Warenkorb- bzw.
  Bestelllisten-Bildschirmfotos als 4:3 ohne EXIF (Prüfrunde 3). Nicht
  gemessen, weil das Messbudget (~3 $) schon überschritten war — braucht
  Patricks Freigabe. Papier-Prospekte kamen in den Daten nicht vor
  (Anweisung: „unklar" → liegen lassen, ungetestet). Die Wahrheit der Messung
  beruht auf einer Sichtprüfung von Vorschaubildern (eine Person).

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
am Halte-Grund), die Bildprüfung beantwortet die Preisquelle bei mehr als
25 % (mind. 8) nicht mehr (gelb — die Bildschirm-Regel erkennt dann still
nichts; gemessen 0 von 448), mehr als 5 % (mind. 5) heute NEU wegen unsicherer
Preisquelle angehalten (gelb; normal ~1 pro Woche; übernommene Befunde zählen
nicht, sonst käme die Warnung jeden Morgen, bis Patrick entschieden hat),
mindestens 2 Preisfotos „Bildschirm", obwohl der Lesedienst einen Kassenbon
erkannte (gelb; gemessen nie — Fingerabdruck einer geänderten Lesart, die
Fälle bleiben liegen), mindestens 2 Preisfotos „Kassenbon", obwohl der
Lesedienst das Foto las und keinen Bon sah (gelb, `preisquelle_bon_widerspruch`;
gemessen nie — Warenkorb statt Bon, oder geänderte Lesart; die Fälle bleiben
liegen; ein Preisbeleg-Halt zählt hier NUR mit diesem Widerspruch — ohne die
Einschränkung zählten 11 von 189 Kassenbons mit Lesedienst-Bon mit, und die
Warnung käme etwa wöchentlich ohne Grund, Nachprüfung 05.10.2026), ein unbekannter Wert des Schalters `preisBildschirmRegel` (gelb, mit
Wert und Typ — gilt als Beobachtung), mindestens 3 Preisfotos, deren Kopf
nicht abrufbar war (gelb; Storage-Störung — scharf und bei mehr als 25 % der
befragten, mind. 8, rot: ein Tag fast ohne Freigaben, Prüfrunde 3). Preisbeleg
(05.10.2026): mehr als 5 % (mind. 5) heute NEU wegen eines unsicheren
Preisbelegs angehalten (gelb, `preisbeleg_haelt_viele`; normal ~4–8 pro
Woche), Merkmal-Frage bei mehr als 25 % (mind. 8) der „Kassenbons" ohne
Antwort (gelb, `preisbeleg_ohne_antwort` — dann bliebe jeder Bon ohne
Lesedienst-Kopf liegen; gemessen 0 von 189), Liste `discounter` nicht lesbar
(gelb, `preisbeleg_maerkte_unlesbar`), ein unbekannter Wert des Schalters
`preisBelegRegel` (gelb, `preisbeleg_schalter_unbekannt`, mit Wert und Typ —
gilt als Beobachtung). Ein scharfer Halt der
Bildschirm-Regel, der nicht gespeichert werden konnte, zählt zur roten
Warnung `befund_nicht_gespeichert` (ohne Eintrag kennt der nächste Lauf ihn
nicht). Dass die Runde gar nicht lief, erkennen
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
