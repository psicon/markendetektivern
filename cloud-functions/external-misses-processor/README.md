# external-misses-processor — Hintergrundsuche für unbekannte Barcodes

Sucht für gescannte Barcodes, die wir nicht kennen, im Netz nach Produktdaten
(über `scrapeEan` im `nutrition-scraper`) — **nur per EAN, nie per Name**.
Läuft alle 10 Minuten; Tempo, Tagesdeckel und Not-Aus stehen in Firestore und
lassen sich ohne Deploy ändern.

## Ablauf

```
App scannt Barcode → resolveExternalProduct (external-product-lookup)
      │  planeAbruf: legt external_lookup_misses/{ean} an oder öffnet ihn
      │  wieder → status 'pending', grund, rang (= scanTage·1e13 + lastSeenAt)
      ▼
processExternalMisses (diese Funktion, alle 10 Minuten)
      │  1. verlorene Ansprüche freigeben (processing > 30 min)
      │  2. _meta/produktsuche lesen (unlesbar → kein Lauf)
      │  3. Kandidaten: pending nach rang absteigend, seitenweise, ohne die
      │     gerade wartenden (Fehler-Wartezeit); Fälle ohne rang nur, wenn
      │     die rang-Abfrage scheitert oder nicht genug liefert
      │  4. ohne Geld überspringen: ungültige Nummer, Ladencode; dann
      │     Tagesdeckel (Halt), dann im Katalog → überspringen
      │  5. EIN Abruf des Serper-Guthabens vor der ersten Suche
      │  6. beanspruchen (Transaktion: noch pending? aktiv? Deckel? → processing)
      │  7. scrapeEan { ean, ohneOpenFoodFacts, nurDomains?, auffrischen?, bevorzugteUrl? }
      ▼
nutritionscrape/{ean}  ──(Trigger in external-product-lookup)──▶  external_products/{ean}
```

Die Regeln stehen als reine Funktionen in `src/regeln.js` (Prüfziffer,
Ladencode, RCN-8, Beanspruchen, Serper-Grenze, Ergebniszuordnung, Reihenfolge)
und `src/konfig.js` (Konfiguration, Kalendertag). `src/lauf.js` enthält nur
den Ablauf mit Firestore, `index.js` nur Zeitplan und Handaufruf.

## Steuerung: `_meta/produktsuche`

Fehlt das Dokument oder ein Feld, gelten die Standardwerte. Ändern in der
Firebase-Console wirkt ab dem nächsten Lauf; `aktiv` und `tagesDeckel` sogar
sofort (jede Beanspruchung liest sie in ihrer Transaktion neu).

| Feld | Standard | Bedeutung |
|---|---|---|
| `aktiv` | `true` | `false` (oder jeder andere Wert außer `true`) hält jede bezahlte Suche an |
| `proLauf` | `1` | bezahlte Suchen je Lauf (0 = Pause), höchstens 20 |
| `tagesDeckel` | `120` | bezahlte Suchen je Kalendertag (Europe/Berlin), höchstens 5.000 |
| `auffrischenNachTagen` | `60` | liest external-product-lookup (Wiederöffnen alter Fälle) |
| `serperMindestGuthaben` | `1000` | darunter wird nichts mehr bezahlt |
| `shopBilder` | `false` | liest external-product-lookup (Bilder von Shopseiten) |

Zahlen dürfen als Zahl oder als reine Ziffern im Text stehen (die Console
legt neue Felder als Text an). Zu große Werte werden gekappt (Warnung im
Log). Ein UNGÜLTIGER Wert bei `aktiv`, `proLauf`, `tagesDeckel` oder
`serperMindestGuthaben` (Wort, negativ, Bruch, null) hält die Suche an —
Halt `konfig_ungueltig`, rot im Tagesbericht —, statt still auf den höheren
Standard zu fallen (Prüfrunde 2). Ein ungültiges `auffrischenNachTagen` fällt
auf 60. Standard = 6 Läufe/h × 1 = bis 120 am Tag, also ungefähr das alte
Tempo (5/h).

**Hochdrehen** (Beispiel 60/h): `proLauf: 10`, `tagesDeckel: 1500`. Vorher
Serper-Guthaben prüfen — bei 1.440 Suchen am Tag reichen 12.000 Credits
gut 8 Tage.

## Tageszähler: `_meta/produktsuche_tage/tage/{YYYY-MM-DD}`

Kalendertag Europe/Berlin. Liest der Tagesbericht der review-console.

| Feld | Bedeutung |
|---|---|
| `bearbeitet` | beanspruchte (= bezahlte) Suchen; zählt gegen `tagesDeckel` |
| `gefunden` / `keineDaten` / `fehler` | Ergebnis der Suchen (Fehler = 503, Netz, Zeitlimit, verlorener Anspruch) |
| `uebersprungen` | ohne Geld abgeschlossen (ungültig, Ladencode, im Katalog) |
| `serperRest` | zuletzt gelesenes Serper-Guthaben |
| `angehalten` | aktueller Halt: `aus` (Schalter), `tagesdeckel`, `serper_guthaben`, `serper_guthaben_unbekannt`, `dienst_ausfall` (Pause nach zwei dienstweiten Fehlern in Folge, mit `pausiertBisMs`), `konfig_ungueltig` (mit `ungueltigeFelder`); wird bei der nächsten Beanspruchung gelöscht. `proLauf: 0` schreibt keinen Halt (steht in der Konfiguration) |
| `kostenSchaetzungUsd` | Schätzung: 0,016 $ je Suche mit angefallenen Kosten (Messung 02.–04.10.2026); genaue KI-Kosten stehen in den Logzeilen `produktsuche_kosten` des nutrition-scraper |
| `kandidatenKnapp` | Läufe, die auch nach ~500 gelesenen Fällen weniger als `proLauf` beanspruchbare fanden (oben nur Fälle, die nach gesperrten Shopseiten warten); der Tagesbericht warnt ab 6 |

Der Vertrag nannte `_meta/produktsuche_tage/{YYYY-MM-DD}` — das ist in
Firestore kein Dokumentpfad (drei Teile = Sammlung). Daher die Sammlung `tage`.

Das Elterndokument `_meta/produktsuche_tage` trägt den Zustand über Tage
hinweg: `dienstAusfallInFolge`, `letzterDienstFehler`, `pausiertBisMs`
(Pause nach Dienstausfall, gilt auch über Mitternacht).

## Felder am Fall (`external_lookup_misses/{ean}`)

Liest: `status`, `rang`, `hitCount` (nur Ersatz-Reihenfolge), `grund`,
`errorCount`, `fehlerInFolge`, `naechsterVersuchAb`, `letzterFehlerCode`,
`processedAt`, `processedSource`, `processedResult`; vor jeder bezahlten
Suche zusätzlich `nutritionscrape/{ean}` (Quellseite, ob Daten vorliegen,
Datenstand) — ist es nicht lesbar, wird nichts bezahlt.
Schreibt:

| Feld | wann |
|---|---|
| `status` | `processing` beim Beanspruchen; danach `resolved` / `no-data` / `pending` / `error` / `uebersprungen` |
| `lockAt`, `lockId` | nur während `processing` |
| `processedAt` | bei jedem Abschluss und jedem Fehler |
| `processedResult` | `ok`, `all_failed`, `no_urls`, `auffrischen_ohne_fund`, `quelle_widerlegt`, `ok_nach_zeitlimit`, `uebersprungen` — bei Fehlern unverändert |
| `processedSource` | nur bei einem Fund (Shop); bleibt danach stehen = „es gab einen Fund"; gelöscht bei `quelle_widerlegt` |
| `uebersprungenGrund` | `ungueltige_ean`, `ladencode`, `im_katalog` |
| `refreshVersuchtAm` | bei jeder Auffrischung mit inhaltlichem Ergebnis |
| `processingError`, `letzterFehlerCode` | bei Fehlern; gelöscht beim nächsten inhaltlichen Ergebnis |
| `errorCount` | Fehler AM BARCODE in Folge (`fetch_unavailable`, verlorener Anspruch); 5 → `error` |
| `abrufGesperrtInFolge` | `fetch_unavailable` am Barcode in Folge (alle Shopseiten gesperrt); danach mindestens 6 h Wartezeit (ein kurzer Apify-Ausfall sieht genauso aus); 2 → `error` |
| `fehlerInFolge`, `naechsterVersuchAb` | jeder Fehler: Zähler +1, Wartezeit 30 min · 2^(n-1), höchstens 24 h; 12 → `error` |
| `errorGrund` | bei `error`: `am_barcode`, `abruf_gesperrt` (beide öffnet die Abfrage erst nach `auffrischenNachTagen` wieder) oder `in_folge` (nach 7 Tagen) |

Regeln, die man nicht wieder aufweichen darf:
- **Fehler sind nie „keine Daten"**: 503 (KI, Suche, Seitenabruf, Frist),
  Netz-/Zeitfehler, 401, unbekannte Antworten → `pending` mit Wartezeit.
- **Dienstweit ≠ am Barcode** (`src/regeln.js`): KI, Suche, Schlüssel (401),
  400/403/404/5xx von scrapeEan, Netz, Zeitüberschreitungen (`zeitlimit`,
  `zeitlimit_aufruf` — so kommt eine HÄNGENDE KI an, Prüfrunde 2) und
  unbekannte Antworten zählen NICHT gegen den Barcode — sonst stünde nach
  einer Stunde Ausfall der meistgescannte Barcode auf `error`. Nach einem
  dienstweiten Fehler endet der Lauf; nach zwei in Folge pausiert der
  Prozessor (30 min, wachsend bis 6 h). Am Barcode liegen `fetch_unavailable`
  und verlorene Ansprüche: 5 in Folge → `error`; `fetch_unavailable` schon
  nach 2 in Folge, mindestens 6 h auseinander (Shops wie saturn/skroutz/
  kaufland sperren dauerhaft, jede
  Wiederholung kostete eine Serper-Suche und einen Platz im Tagesdeckel).
  Solche Fälle öffnet die Abfrage erst nach `auffrischenNachTagen` wieder,
  `error` aus 12 Fehlern jeder Art schon nach 7 Tagen
  (external-product-lookup `planeAbruf`, `errorGrund`).
- **Fund nach Abbruch**: Bricht der Aufruf nach 240 s ab oder reißt das Netz,
  läuft scrapeEan weiter. Liegt vor dem nächsten Versuch ein neuerer Fund in
  `nutritionscrape/{ean}`, wird der Fall ohne neue Suche `resolved`
  (`ok_nach_zeitlimit`).
- **Widerlegte Quellseite**: Meldet scrapeEan `altdatenWiderlegt`, waren die
  alten (ungeprüften) Daten falsch und sind entfernt → `no-data`
  (`quelle_widerlegt`), nicht „alte Daten bleiben".
- **Früherer Fund bleibt**: Findet eine Auffrischung nichts, bleibt der Fall
  `resolved`, die alten Daten bleiben stehen. „Früherer Fund" heißt:
  `processedSource`/`processedResult` des Falls ODER Daten in
  `nutritionscrape/{ean}` — die Abfrage legt `pending/auffrischen` auch neu
  an, wenn alte bezahlte Daten existieren, aber noch kein Fall.
- **Ladencodes** (13-stellig 20–29, 02 oder 04, auch UPC-A „2…"/„4…") werden
  nie bezahlt gesucht — GS1 vergibt diese Präfixe nie an Hersteller, die
  Nummer gilt nur in einem Markt (gleiche Abgrenzung wie `istHandelsCode` in
  review-console/src/werte.js). **RCN-8** (8-stellig „2…" oder „0…") nur bei
  deutschen Handelsketten (`RCN8_DOMAINS`).
- **Katalog zuerst**: Steht die EAN in `produkte`/`markenProdukte` (EANs, eans,
  EAN, ean, gtin, GTIN, moreInformation.EAN; 8/12/13/14-stellig und als Zahl),
  wird nicht gesucht. Ist der Katalog nicht lesbar, wird auch nicht bezahlt.
- **Serper-Guthaben** wird vor der ersten Suche jedes Laufs gelesen. Unter
  `serperMindestGuthaben` oder unlesbar → Halt.

## Indizes

Benötigt (Sammlung `external_lookup_misses`):

| Felder | wofür | Stand 04.10.2026 |
|---|---|---|
| `status` ASC, `rang` DESC | Reihenfolge | **fehlt — vor dem Deploy anlegen** |
| `status` ASC, `hitCount` DESC | Fälle ohne `rang` / Ersatz | READY |
| `status` ASC, `lockAt` ASC | verlorene Ansprüche | READY |

Anlegen über die REST-API — **NIE** `firebase deploy --only firestore:indexes`
(das File ist nicht die Quelle der Wahrheit; am Vorfall in CLAUDE.md wurden so
75 Indizes gelöscht):

```bash
T=$(gcloud auth print-access-token); H="x-goog-user-project: markendetektive-895f7"
U="https://firestore.googleapis.com/v1/projects/markendetektive-895f7/databases/(default)/collectionGroups/external_lookup_misses/indexes"
curl -s -X POST -H "Authorization: Bearer $T" -H "$H" -H "Content-Type: application/json" "$U" \
  -d '{"queryScope":"COLLECTION","fields":[{"fieldPath":"status","order":"ASCENDING"},{"fieldPath":"rang","order":"DESCENDING"}]}'
# 409 = gibt es schon. Bis READY warten:
curl -s -H "Authorization: Bearer $T" -H "$H" "$U" | python3 -c "import sys,json;[print(i['state'],[f['fieldPath'] for f in i['fields']]) for i in json.load(sys.stdin)['indexes'] if any(f['fieldPath']=='rang' for f in i['fields'])]"
```

Fehlt der Index, läuft der Prozessor nach `hitCount` weiter und meldet
`rangAbfrageGescheitert` im Laufbericht (Log `produktsuche_prozessor_lauf`).

## Deploy — Reihenfolge ist Pflicht

1. Index `status + rang` anlegen, READY abwarten.
2. `nutrition-scraper` mit den neuen Parametern (`ohneOpenFoodFacts`,
   `nurDomains`, `bevorzugteUrl`, `auffrischen`). Ein alter scrapeEan
   ignoriert sie still: RCN-8 würde dann bei beliebigen Shops gesucht und
   OpenFoodFacts-Seiten bezahlt gelesen.
3. Nachpflege-Skript, nur die Warteschlange
   (`external-product-lookup/scripts/nachpflege-2026-10.js`, erst Trockenlauf,
   dann `SCHREIBEN=1 NUR=misses`): `rang`/`scanTage` für alle offenen Fälle.
4. Diese Funktion (Befehl unten). Fälle OHNE `rang` (die der alte
   Abfrage-Code zwischen Schritt 3 und 5 anlegt, ~200 am Tag) erreicht sie
   NICHT: Nach der Nachpflege tragen alle offenen Fälle einen `rang`, die
   Abfrage danach liefert immer genug, und die Ersatz-Abfrage nach `hitCount`
   läuft nur, wenn sie scheitert (Index fehlt) oder zu wenig liefert — und
   fände Fälle mit hitCount 1 unter 19.000 offenen ohnehin nicht. Erreicht
   werden sie erst durch Schritt 6 (`NEU=1`) oder einen erneuten Scan nach
   Schritt 5 (die neue Abfrage setzt `rang` bei jedem Scan).
5. `external-product-lookup` — ERST JETZT: Ab diesem Deploy öffnet jeder Scan
   abgeschlossene Fälle älter als 60 Tage wieder (`grund: 'auffrischen'`).
   Der alte Prozessor kennt keinen früheren Fund und würde solche Fälle bei
   einer erfolglosen Auffrischung von `resolved` auf `no-data` setzen; der neue
   behält sie `resolved` und hält den Tagesdeckel ein.
6. Nachpflege-Skript für `external_products` (`SCHREIBEN=1 NUR=produkte`) —
   erst nach Schritt 5, sonst schreibt der alte Abfrage-Code den Platzhalter
   'Produkt' wieder über reparierte Namen. Danach **Pflicht, direkt im
   Anschluss**: einmal `SCHREIBEN=1 NEU=1` (füllt nur, was zwischen Schritt 3
   und 5 ohne `rang` entstand — sonst bearbeitet der Prozessor diese Fälle erst
   beim nächsten Scan des Barcodes). Der Laufbericht zählt `ohneRang` nur unter
   den gelesenen Kandidaten; liegengebliebene Fälle zeigt er nicht.
7. `review-console` (Zeile im Tagesbericht) jederzeit; fehlende Zähler zeigt
   der Bericht als „nicht gelaufen".

Jede Codebase einzeln ausrollen, vorher den deployten Stand mit dem Zweig
vergleichen (CLAUDE.md):

```bash
cd cloud-functions/external-misses-processor && npm install && cd ../..
PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" npx firebase-tools@15.15.0 \
  deploy --only "functions:external-misses-processor" --project markendetektive-895f7 --non-interactive
```

Zurückdrehen ohne Deploy: `_meta/produktsuche.aktiv = false`.

## Secrets

- `NUTRITION_SCRAPER_TRIGGER_KEY` — Aufruf von scrapeEan (Body, nie Adresse).
- `SERPER_API_KEY` — nur zum Lesen des Guthabens (`GET google.serper.dev/account`,
  verbraucht keine Suche). Der Schlüssel bleibt im Speicher, wird nie geloggt.

## Handaufruf

Derselbe Lauf mit derselben Beanspruchung und demselben Deckel:

```bash
KEY=$(npx firebase-tools functions:secrets:access NUTRITION_SCRAPER_TRIGGER_KEY --project markendetektive-895f7)
curl -s -X POST -H 'Content-Type: application/json' -d "{\"key\":\"$KEY\"}" \
  https://europe-west1-markendetektive-895f7.cloudfunctions.net/processExternalMissesManual
```

Nur POST mit Schlüssel im Body (Adressen stehen im Klartext in den
Zugriffsprotokollen). Antwort = Laufbericht, z. B.
`{ "beansprucht": 1, "gefunden": 1, "uebersprungen": 2, "serperRest": 11960, "angehalten": null, … }`.

## Nach einem Ausfall

Dienstweite Ausfälle (KI, Serper, Schlüssel, Ausrollen) zählen nicht gegen
die Barcodes; die Pause hebt sich mit dem nächsten inhaltlichen Ergebnis
selbst auf. Sofort weiter (statt bis zum Ende der Pause zu warten):
`_meta/produktsuche_tage` → `pausiertBisMs` löschen.

Liegt ein Ausfall am Barcode (z. B. Apify-Rendern tagelang kaputt →
`fetch_unavailable`) und stehen deshalb Fälle auf `error` (`errorGrund`
`abruf_gesperrt`/`am_barcode`), öffnet sie der nächste Scan erst nach
`auffrischenNachTagen` wieder. Früher: in der Console die betroffenen
Fälle auf `status: 'pending'` setzen und `errorCount`, `fehlerInFolge`,
`abrufGesperrtInFolge`, `errorGrund`, `naechsterVersuchAb` löschen (Filter
`status == 'error'`, nach `letzterFehlerCode` und `processedAt` des Ausfalls).

## Logs

- `{"evt":"produktsuche_prozessor_lauf", …}` — Laufbericht (Kandidaten,
  beansprucht, wartend, nachgetragen, Ergebnisse, Halt/Abbruch, Serper-Rest,
  Dauer). Eigener Name: scrapeEan schreibt je Barcode `produktsuche_lauf`
  (Verbrauch) — eine Summe über `evt` mischt sonst beides.
- `{"evt":"produktsuche_ean", …}` — je bezahlter Suche: Grund, Ergebnis,
  Code, Shop, Dauer, ob `nurDomains`/`bevorzugteUrl` gesetzt waren.
- `{"evt":"produktsuche_im_katalog", …}` — übersprungen, weil im Katalog.

## Kosten

- Je bezahlter Suche gemessen ~0,016 $ (KI ~70 %, Apify, 1 Serper-Credit,
  Rechenzeit). Standard-Deckel 120/Tag ≈ 1,9 $/Tag.
- Übersprungene Fälle kosten nur Firestore-Lesevorgänge (Katalogprüfung:
  14 Abfragen je EAN).
- Zeitplan: 1 Scheduler-Job wie bisher; Läufe ohne Arbeit dauern Sekunden.

## Firestore-Regeln

`external_lookup_misses` und `_meta/*` liest und schreibt nur der Server
(Admin-SDK). Für beide gibt es keinen eigenen Rules-Block — es gilt das finale
deny-all (geprüft am Live-Stand 04.10.2026). Clients legen Fälle nicht selbst
an; die App ruft `resolveExternalProduct`. Die frühere Anleitung
`FIRESTORE_RULES.md` (Client-Schreibregeln) war überholt und ist entfernt.
