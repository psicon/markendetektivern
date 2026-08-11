# crowd-upload-location

Bestimmt für jede Produkt-Einreichung (`crowd_uploads/{id}`), **wo sie entstanden ist** —
und wie sicher diese Aussage ist. Trigger: `onDocumentCreated`, Region `europe-west1`.

## Für die Auswertung: das Wichtigste zuerst

**Frage nie `probableLocation.city` ab, ohne `usableFor` zu prüfen.** Das Feld
`usableFor` ist der Missbrauchsschutz — es sagt, auf welchen Ebenen die
Aussage belastbar ist:

```js
// Richtig: nur Dokumente, deren Ortsangabe die Stadtebene wirklich trägt
where('probableLocation.usableFor', 'array-contains', 'city')

// Falsch: liest auch Landesangaben und Wohnort-Selbstauskünfte als Ort
where('probableLocation.city', '==', 'Stuttgart')
```

**Eine Koordinate steht nur dort, wo eine echte Messung sie trägt.** Bei
`confidence: 'low'` oder `'none'` sind `lat`/`lon` immer `null`. Es gibt keine
Zentroide, keine Stadtmittelpunkte, keinen DACH-Mittelpunkt — ein Ort, der
keiner ist, richtet mehr Schaden an als ein leeres Feld.

## Das Feld

```
probableLocation: {
  modelVersion  'ploc-v1'
  granularity   'point'|'store'|'city'|'region'|'country'|'none'   // WAS behauptet wird
  confidence    'high'|'medium'|'low'|'none'                       // WIE SICHER
  source        'gps_capture'|'exif_gps'|'user_confirmed_place'
                |'user_profile_region'|'market_country'|'none'
  lat, lon      nur bei high/medium; high auf 5, medium auf 3 Nachkommastellen
  accuracyM     Messgenauigkeit, sobald eine Koordinate ausgegeben wird
  city, bundesland, land
  usableFor     ['country','city',…]  ← hiernach filtern
  agreement     'corroborated'|'single'|'conflicting'
  conflicts     []
  ageMinutes    Abstand Messung → Aufnahme
  signals       alle eingegangenen Signale, auch die nie gewinnenden
  resolvedBy    'client'|'server'
  computedAt
}
probableLocationAt   // Idempotenz-Riegel des Triggers
```

Zwei Achsen, weil die Lage sonst nicht ehrlich darstellbar ist: Für fast jede
Alt-Einreichung ist „Deutschland, sehr sicher" die korrekte Aussage.
Einachsig müsste daraus „low" werden — und eine belastbare Information sähe
unsicher aus.

## Rangfolge der Signale

Die höchstrangige verfügbare Messung gewinnt **allein**. Es wird nie gemittelt:
Die Genauigkeiten liegen zwischen ~10 m (GPS) und gemessenen 61–377 km
(IP-Ortung); jeder gewichtete Mittelwert ergäbe eine Koordinate, die zu keiner
Quelle gehört und präziser aussieht als alle.

| # | Quelle | Genauigkeit | Deckel |
|---|---|---|---|
| 1 | `gps_capture` — GPS beim Aufnehmen | 10–100 m | high |
| 2 | `exif_gps` — aus dem Bild gelesen | ~10–25 m | high |
| 3 | `user_confirmed_place` — im Wizard bestätigt | Stadt–Straßenzug | **medium** |
| 4 | `user_profile_region` — Selbstauskunft im Profil | Region, **Wohnort** | **low** |
| 5 | `market_country` — Land aus Markt/IP/Profil | Land | high |

**Die IP-Ortung (`journeyLocation`) ist kein Kandidat.** Sie hat die höchste
Abdeckung und den geringsten Wert: gegen die vier Dokumente mit EXIF-GPS liegt
sie 61,7 / 61,7 / 99,5 / 377,2 km daneben, und in 64 Vergleichen mit der
Selbstauskunft stimmte sie kein einziges Mal überein. Sie geht ausschließlich
als **Landes**-Signal ein — dort lag sie in 4 von 4 Fällen richtig — und wird
in `signals[]` protokolliert, **ohne Koordinate**, damit sie nicht doch
irgendwann als Ort gelesen wird.

## Wer schreibt was

| | Client | diese Function |
|---|---|---|
| `capture.gps`, `capture.confirmedPlace`, `capture.capturedAt` | ✅ | — |
| `journeyLocation`, `userLocation` | ✅ wenn vorhanden | ✅ **nur wenn sie fehlen** |
| `probableLocation` | — | ✅ ausschließlich |

Ein Race ist ausgeschlossen: `submitProduct` legt das Dokument mit **einem**
`addDoc` an, der Create-Snapshot enthält also bereits alles vom Client.

Der Trigger rekonstruiert fehlende Rohsignale selbst — deshalb funktioniert das
auch für Nutzer, die **noch eine alte App-Version** haben, und ohne dass je
wieder ein Backfill nötig wird. Die Journey-Zuordnung läuft über die Zeit
(nächste Journey vor der Einreichung, Fenster 6 h); nachgetragene Werte tragen
`journeyLocationMatch.method = 'server_trigger_nearest_preceding_journey'` bzw.
`userLocationBackfilled: true`, sind also von echten Aufnahme-Beobachtungen
unterscheidbar.

## Grenzen, die nicht umgehbar sind

- **Der Trigger sieht die IP des Einreichenden nicht.** Ein Firestore-Event
  trägt keinen Netzwerkkontext. Er kann die IP-Ortung nur *übernehmen*, nicht
  neu vornehmen. (Ein HTTPS-Callable hätte sie — bräuchte aber eine neue
  App-Version und erkaufte damit ausgerechnet das schlechteste Signal.)
- **EXIF liefert im Bestand fast nichts.** Vollscan über alle 2.086 Bilder:
  10 mit GPS in 4 Dokumenten (0,48 %). `takePictureAsync` läuft ohne
  `exif: true`, und auf iOS gehen 6 von 7 Aufnahmen über den nativen
  BonScanner, der jeden Metadaten-Container verwirft. Was EXIF trägt, kommt
  praktisch nur aus dem Galerie-Import.
- **Nutzer ohne Marktdaten-Einwilligung erzeugen keine Journeys** — für sie
  findet der Trigger nichts nachzutragen.

## Modell ändern

`src/scorer.js` ist eine reine Funktion ohne I/O. Ein geändertes Modell lässt
sich aus den Rohsignalen in Firestore neu berechnen, ohne ein Byte aus Storage
zu laden. Bei materiellen Änderungen `MODEL_VERSION` erhöhen, damit alte und
neue Bewertungen unterscheidbar bleiben.

Tests: `npx jest --selectProjects cf`

## Deploy

```bash
cd cloud-functions/crowd-upload-location && npm install
PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" npx firebase-tools@15.15.0 \
  deploy --only "functions:crowd-upload-location" \
  --project markendetektive-895f7 --non-interactive
```

`npm install` im CF-Ordner ist Pflicht — sonst bricht der Analyse-Schritt mit
„Couldn't find firebase-functions package" ab.
