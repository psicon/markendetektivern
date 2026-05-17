# Vertex AI Search — Setup Walkthrough

Schritt-für-Schritt-Anleitung um den Scraper-Backend aufzusetzen.
~10 min aktive Arbeit, danach 24h Indexing-Wartezeit bis die Domains
durchgecrawlt sind.

## Vorab-Check

```bash
# Sicherstellen dass die API aktiviert ist (sollte bereits)
gcloud services list --enabled --project markendetektive-895f7 | grep discoveryengine
```

Wenn `discoveryengine.googleapis.com` NICHT aufgelistet ist:

```bash
gcloud services enable discoveryengine.googleapis.com \
  --project markendetektive-895f7
```

## Schritt 1 — AI Applications Console öffnen

URL direkt: <https://console.cloud.google.com/gen-app-builder/engines?project=markendetektive-895f7>

(Falls die URL nicht funktioniert: Google Cloud Console → Menü
links → "AI Applications" oder "Search & Conversation")

## Schritt 2 — Neue Search App anlegen

1. Klick **"+ Create App"** (oder "+ App erstellen")
2. App-Typ wählen: **Search**
3. Configuration:
   - **App name**: `nutrition-product-search` (frei wählbar)
   - **External name**: kann gleich bleiben
   - **Company name**: `Markendetektive` (oder beliebig)
   - **Generic recommendations**: kann aus
   - **Enterprise features**: **aus** (Basic Edition reicht, billiger)
4. **Location**: `global` (empfohlen — niedrigste Latenz)
5. **Continue**

## Schritt 3 — Datastore anlegen

Auf dem nächsten Screen "Connect data sources":

1. **+ Create new data store**
2. **Data type**: **Website Content**
3. **What kind of data**: **Public Website Content** (no Indexing
   for advanced features needed — Basic ist OK)
4. **Continue**

## Schritt 4 — Domains hinzufügen

Bei "Specify URL patterns":

1. **Source**: Sites I provide
2. **Sites to include**: pro Zeile eine Domain mit `/*` Wildcard
   (damit alle Seiten der Domain indexiert werden). **Eine
   Zeile pro Eintrag** — Reihenfolge ist egal (Priorität kommt
   aus `src/domains.js`):

```
www.codecheck.info/*
www.product-search.net/*
www.metro.de/*
www.globus.de/*
www.mein-aldi.de/*
www.knuspr.de/*
www.mytime.de/*
www.liefershop.de/*
www.gurkerl.at/*
www.interspar.at/*
www.roksh.at/*
```

3. **Sites to exclude**: leer lassen
4. **Continue**

## Schritt 5 — Datastore Details

1. **Data store name**: `nutrition-scraper-datastore` (frei
   wählbar — Anzeige-Name)
2. **Data store ID** (wichtig!): wird automatisch generiert,
   z.B. `nutrition-scraper-datastore_1747498xxx`. **DAS ist die
   ID die wir gleich brauchen.**
3. **Location**: `global`
4. **Create**

## Schritt 6 — Datastore-ID notieren

Auf der Datastore-Detail-Seite (URL enthält die ID):

```
https://console.cloud.google.com/gen-app-builder/data-stores/<DATA_STORE_ID>?project=markendetektive-895f7
```

ODER unter **"Activity"** → **"Configurations"** → "Data Store ID:
`nutrition-scraper-datastore_1747498xxx`"

Diese ID gleich.

## Schritt 7 — Secrets aktualisieren

```bash
# Datastore-ID als neue Version ans Secret schicken
echo -n "nutrition-scraper-datastore_1747498xxx" | gcloud secrets versions add VERTEX_AI_SEARCH_DATASTORE_ID \
  --data-file=- --project markendetektive-895f7

# Location ist global, war schon korrekt gesetzt — Check:
gcloud secrets versions access latest --secret=VERTEX_AI_SEARCH_LOCATION \
  --project markendetektive-895f7
# Output sollte "global" sein
```

## Schritt 8 — Scraper redeployen damit neue Secret-Version geladen wird

Gen 2 Functions cachen Secrets pro Instanz. Re-deploy forciert
einen Neustart der Instanzen:

```bash
firebase deploy --only functions:nutrition-scraper --project markendetektive-895f7
```

## Schritt 9 — Indexing-Status checken

Vertex AI indexiert die Domains jetzt. Dauert beim Erst-Crawl
**bis zu 24h**. Status:

1. Console → Data Stores → `nutrition-scraper-datastore`
2. Tab **"Activity"** zeigt Indexing-Progress
3. Tab **"Documents"** zeigt wieviele Pages indexiert sind

Du kannst während des Indexings schon testen — die Resultate
werden nur dünn sein bis Indexing fertig.

## Schritt 10 — Smoke-Test

```bash
# Single-EAN Test via scrapeEan
curl "https://scrapeean-ad6ydmbzbq-ew.a.run.app?key=$(cat /tmp/nutrition_scraper_key.txt)&ean=5900102026074"
```

Erwartete Response wenn Indexing durch:

```json
{
  "result": "ok",
  "triedUrls": 3,
  "successUrl": "https://www.codecheck.info/produkt/...",
  "successShop": "codecheck",
  "extracted": { "attr_ingredientStatement": "Zucker, …", "nutr_Energie_val": 395, ... }
}
```

## Schritt 11 — Vollen Batch-Scrape starten

Sobald Smoke-Tests grün, scrapeBatch für die uncovered Produkte:

```bash
# limit klein anfangen, dann scale up
curl "https://scrapebatch-ad6ydmbzbq-ew.a.run.app?key=$(cat /tmp/nutrition_scraper_key.txt)&collection=produkte&limit=50&dryRun=1"
```

`dryRun=1` = nur Resolver-Calls, keine Claude/Write. Damit kannst
du checken wie viele URLs Vertex AI findet. Wenn die Zahl gut
aussieht, `dryRun` weglassen für echten Run.

## Schritt 12 — Daily-Cron für Scraper (optional)

Ich kann einen `pubsub.schedule` Trigger einbauen der täglich
nachts alle uncovered Produkte scraped. Aktuell läuft der
nutrition-backfill-Daily-Cron schon nightly 02:30 — der pickt
NEU vom Scraper geschriebene Daten in nutritionscrape automatisch
ans Produkt.

Für einen separaten Scraper-Cron der NEUE Produkte ohne Source
ansetzt, sag mir Bescheid.

## Kosten

- Vertex AI Search: $1.50 / 1000 queries
- Claude Haiku 3.5: ~$0.013 / produkt (input + output Tokens)
- Cloud Run Compute: negligible

Für ~8000 verbleibende uncovered Produkte ohne Source:
**~$12 (Vertex) + ~$105 (Claude) ≈ $120 one-shot**.

Nach erstem Full-Run: nur neue Produkte werden gescrapet (via
onCreate-Trigger), Kosten ~$0.013/Produkt.

## Troubleshooting

### "DataStore not found"

Tritt auf wenn das Secret den falschen ID enthält. Prüfen:

```bash
gcloud secrets versions access latest --secret=VERTEX_AI_SEARCH_DATASTORE_ID \
  --project markendetektive-895f7
```

Sollte die echte Datastore-ID sein (nicht "NOT_YET_CONFIGURED").

### "Permission denied"

Service-Account braucht `roles/discoveryengine.viewer`:

```bash
gcloud projects add-iam-policy-binding markendetektive-895f7 \
  --member=serviceAccount:markendetektive-895f7@appspot.gserviceaccount.com \
  --role=roles/discoveryengine.viewer
```

### Kein Search-Result obwohl Domain indexiert

- Indexing kann nach Site-Add bis zu 24h dauern für initial Crawl
- Prüfe Indexing-Status im Console (Activity-Tab)
- Bei langsamen Sites (z.B. mein-aldi.de mit Login-Wall) kann
  Vertex AI nicht crawlen → weniger Treffer

### "Spell correction mode invalid"

War ein Code-Bug, gefixt. Sollte nicht mehr auftreten.
