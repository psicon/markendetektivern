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

1. **Offene Einreichungen laden**, älteste zuerst.
2. **Nachlesen** fehlender Angaben (Name, EAN, Preis, Hersteller) — siehe unten.
3. **Dateien prüfen**: leer (0 Byte) = Mangel; nicht abrufbar = unsere Technik;
   Identitätsfoto schon in einer älteren Einreichung = Wiederverwendung.
4. **Bildprüfung** aller Fälle, denen kein Foto fehlt.
5. **Chronologisch entscheiden** (`entscheideFall`) — eine im selben Lauf
   entschiedene Einreichung ist für die nächste derselben EAN Referenz bzw.
   kein offener Vorgänger mehr.
6. **Notbremse** prüfen, dann schreiben.
7. **Auf die Buchungen warten** (höchstens 5 Minuten) — nur für die Zahlen im
   Bericht. Die Nachricht an die Nutzer schickt der Sammler in crowd-upload-reward.
8. **Bericht** mit Bon-Lage, Aktionen und Warnungen schreiben.

Zeitbudget: nach 18 Minuten beginnt die Runde nichts Neues mehr; der Rest ist
am nächsten Morgen dran (Warnung „nicht geschafft").

## Regeln, die nicht verhandelbar sind

- **Die Regeldatei muss aus dem Haupt-Checkout stammen.** Am 20.09. lief ein
  Lauf gegen eine Regelfassung, die sechs Tage alt war — 8 von 14 Ablehnungen
  wären gegen eine Entscheidung gegangen, die Patrick Stunden vorher getroffen
  hatte. Eine Ablehnung ist endgültig. Der Lauf protokolliert deshalb, welche
  Regelversion er benutzt hat.
- **Eine Doppel-Gruppe muss eine zahlbare Kopie übrig lassen.** Die älteste
  Einreichung einer Gruppe ist die Referenz und wird nie gesperrt. Sonst geht
  auch die korrekte Erst-Einreichung leer aus (passiert am 10.09., 3 Gruppen).
- **Bild-Wiederverwendung trifft nur die jüngere Einreichung**, nie beide.
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
- **Fehlende Vergleichswerte gelten als gleich** (fail-closed) — deshalb muss
  bei fehlendem Preis BEIDE Seiten nachgelesen sein, Kandidat und Referenz.
  Die Runde erfüllt das von selbst: die Referenz der Doppel-Regel ist eine
  eigene Freigabe binnen 24 h und lief als offene Einreichung schon durch das
  Nachlesen. Scheiterte das Nachlesen beim Kandidaten technisch und hängt die
  Sperre nur am fehlenden Preis, bleibt der Fall offen statt abgelehnt.
- **Ein geretteter Preis darf eine Sperre lösen, eine geretteter Herstellername
  nicht.** Markeninhaber und Produzent stehen beide auf der Packung; das ist
  kein Beleg für „andere Daten".
- **Lose Ware wird angenommen** (Entscheidung Patrick, 20.09.): Waagen-Codes
  sind kein Ablehngrund. Nur kennzeichnen und die Doppelprüfung zusätzlich nach
  Markt trennen.

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

## Warnungen im Bericht

Jede steht für einen Ausfall, der schon einmal unbemerkt blieb:
Aktion läuft aus ohne Nachfolger (01.09.), keine laufende Aktion, Budget leer
oder knapp, **Zweitprüfung eingeschaltet aber 48 h nicht gelaufen** (23.09.:
ein Ausrollen von einem Zweig ohne diesen Code nahm sie still raus), Bons
hängen ≥ 3 Tage in der Prüfung, > 5 % Bons ohne Aktion, Bildprüfung
scheitert reihenweise, Runde nicht fertig geworden, Notbremse, Regeln
seit dem letzten Lauf geändert. Dass die Runde gar nicht lief, erkennen
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
