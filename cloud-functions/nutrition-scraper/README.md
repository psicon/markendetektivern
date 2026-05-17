# nutrition-scraper

LLM-basierter Generic-Scraper für Lebensmittel-Produktseiten.
Schreibt strukturierte `nutritionscrape`-Docs, die der
`nutrition-backfill` (CF2) als 3. Source (`sonstiges`) konsumiert.

## Warum

Wir haben ~7000 Discounter-Eigenmarken (Aldi, Lidl, Penny, Rewe,
Edeka, Metro, Globus, ...) ohne Nährwerte/Zutaten in Firestore.
OpenFoodFacts hat die meisten davon nicht. Pro Site einen
Custom-Parser zu schreiben wäre nicht skalierbar.

**Lösung**: HTML → Claude Haiku → strukturiertes JSON. Eine
Pipeline für ALLE Sites.

## Architektur

```
EAN → resolver.js → URL(s)
                       ↓
                  fetcher.js (Throttle + Robots-Check)
                       ↓
                   HTML
                       ↓
                 extractor.js (Claude API)
                       ↓
                JSON (reweapify-Schema)
                       ↓
                  writer.js → Firestore.nutritionscrape
```

CF2 (`nutrition-backfill`) liest später `nutritionscrape` per EAN
und schreibt es ans Produkt mit `source='scraper'`.

## Endpoints (HTTPS Gen-2 Cloud Functions, europe-west1)

### 1. `scrapeSingleUrl` — Test/Manual

Fetcht eine spezifische URL, extrahiert, schreibt. Für Debug + ad-hoc.

```bash
curl "https://europe-west1-<project>.cloudfunctions.net/scrapeSingleUrl?key=<TRIGGER>&ean=4002334113001&url=https://www.codecheck.info/produkt/123"
```

### 2. `scrapeEan` — Resolver-based

Resolver findet URLs, Scraper probiert durch (1. Treffer wins).

```bash
curl "https://...cloudfunctions.net/scrapeEan?key=<TRIGGER>&ean=4002334113001&productName=Erdbeere%20Joghurt"
```

### 3. `scrapeBatch` — Batch-Run

Iteriert produkte/markenProdukte ohne `nutritionSource`. Bis zu
60 min Timeout (Gen 2).

```bash
curl "https://...cloudfunctions.net/scrapeBatch?key=<TRIGGER>&collection=produkte&limit=100"
```

Params:
- `collection`: `produkte` oder `markenProdukte`
- `limit`: max # zu verarbeiten (default 50)
- `dryRun`: `1` → keine Writes / Resolver-Calls

## Setup (User-Side)

### 1. Anthropic API Key + Trigger-Key

```bash
echo -n "sk-ant-xxx" | gcloud secrets create ANTHROPIC_API_KEY \
  --data-file=- --project markendetektive-895f7

echo -n "$(openssl rand -hex 16)" | gcloud secrets create NUTRITION_SCRAPER_TRIGGER_KEY \
  --data-file=- --project markendetektive-895f7
```

### 2. Vertex AI Search Setup

Die Custom Search JSON API ist für Neukunden nicht mehr verfügbar.
**Vertex AI Search** ist der empfohlene Nachfolger (bis 50 Domains).

```bash
# Discovery Engine API aktivieren
gcloud services enable discoveryengine.googleapis.com \
  --project markendetektive-895f7
```

**Im GCP Console** (https://console.cloud.google.com/gen-app-builder):

1. **AI Applications** → **Apps** → **Create App**
2. **Type**: `Search` (Generic)
3. **Datastore**: erstelle einen neuen Web-Datastore
   - Source: "Sites I provide"
   - **Sites hinzufügen** (in dieser Priorität, einer pro Zeile):
     ```
     www.codecheck.info
     www.product-search.net
     www.metro.de
     www.globus.de
     www.mein-aldi.de
     www.knuspr.de
     www.mytime.de
     www.liefershop.de
     www.gurkerl.at
     www.interspar.at
     www.roksh.at
     ```
4. **Location**: `global` (empfohlen)
5. Warten auf Indexing (~24h für Erst-Crawl)
6. **Datastore-ID** notieren (steht auf der Datastore-Detail-Page)

Secrets eintragen:

```bash
echo -n "<datastore-id>" | gcloud secrets create VERTEX_AI_SEARCH_DATASTORE_ID \
  --data-file=- --project markendetektive-895f7

echo -n "global" | gcloud secrets create VERTEX_AI_SEARCH_LOCATION \
  --data-file=- --project markendetektive-895f7
```

### 3. IAM (Read-Access für Function)

```bash
SERVICE_ACCOUNT="markendetektive-895f7@appspot.gserviceaccount.com"

# Secrets
for SECRET in ANTHROPIC_API_KEY NUTRITION_SCRAPER_TRIGGER_KEY \
              VERTEX_AI_SEARCH_DATASTORE_ID VERTEX_AI_SEARCH_LOCATION; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member=serviceAccount:$SERVICE_ACCOUNT \
    --role=roles/secretmanager.secretAccessor \
    --project markendetektive-895f7
done

# Discovery Engine (für Vertex AI Search-Calls)
gcloud projects add-iam-policy-binding markendetektive-895f7 \
  --member=serviceAccount:$SERVICE_ACCOUNT \
  --role=roles/discoveryengine.viewer
```

### 4. Deploy

```bash
firebase deploy --only functions:nutrition-scraper \
  --project markendetektive-895f7
```

## Kosten-Schätzung

Per Scrape (ein Produkt, single URL):

| Komponente | Kosten | Note |
|---|---:|---|
| Claude Haiku 3.5 | $0.001–0.005 | Hängt von HTML-Größe |
| Google CSE | $0.005 | $5/1000, free tier 100/Tag |
| Cloud Functions Gen 2 | $0.00005 | 9min × 1GB |
| HTML-Fetch | negligible | ~50KB |

**Full-Run für 7000 produkte**: ~$35–60 one-shot.

Vs. site-spezifische Parser schreiben (50+ Sites, 50 Tage Dev):
massive Ersparnis.

## Shop-Priorität (1. Treffer wins)

Konfiguriert in `src/domains.js`. **Suche IMMER nur per GTIN/EAN**,
niemals per Produkt-Name (User-Vorgabe). Resolver geht in dieser
Reihenfolge durch:

| # | Shop | Direct-EAN-URL | Vertex AI Search |
|---|---|:-:|:-:|
| 1 | codecheck.info       | ✅ | ✅ |
| 2 | product-search.net   | ✅ | ✅ |
| 3 | metro.de             | – | ✅ |
| 4 | globus.de            | – | ✅ |
| 5 | mein-aldi.de         | – | ✅ |
| 6 | knuspr.de            | – | ✅ |
| 7 | mytime.de            | – | ✅ |
| 8 | liefershop.de        | – | ✅ |
| 9 | gurkerl.at           | – | ✅ |
| 10 | interspar.at        | – | ✅ |
| 11 | roksh.at            | – | ✅ |

Pro EAN werden die URL-Kandidaten in dieser Reihenfolge probiert.
Erster erfolgreich extrahierter Hit wins — alle weiteren werden
ignoriert.

Direct-URL-Pattern für codecheck + product-search.net laufen IMMER
zuerst (keine API-Kosten, deterministisch). Wenn die nicht
zünden, geht Vertex AI Search alle indexed Domains durch und
gibt Treffer in Shop-Prio-Reihenfolge zurück.

## Schema von nutritionscrape-Doc

Doc-ID = EAN (z.B. `4002334113001`):

```json
{
  "gtin": "4002334113001",
  "productPath": "produkte/abc123" | null,
  "attr_ingredientStatement": "...",
  "nutr_Energie_val": 395, "nutr_Energie_unit": "kcal",
  "nutr_Fett_val": 7.4, "nutr_Fett_unit": "g",
  "nutr_FettdavongesttigteFettsuren_val": 4.6, "..._unit": "g",
  "nutr_Kohlenhydrate_val": 78, "nutr_Kohlenhydrate_unit": "g",
  "nutr_KohlenhydratedavonZucker_val": 67, "..._unit": "g",
  "nutr_Ballaststoffe_val": 0, "..._unit": "g",
  "nutr_Eiwei_val": 4.2, "..._unit": "g",
  "nutr_Salz_val": 0.15, "..._unit": "g",
  "nutr_serving_size": 100, "nutr_serving_unit": "g",
  "scrapedAt": Timestamp,
  "scrapedSource": "scraper",
  "scrapedUrl": "https://www.codecheck.info/...",
  "confidence": 0.85,
  "model": "claude-haiku-4-5",
  "tokensIn": 4200,
  "tokensOut": 180
}
```

## Was später noch zu tun ist (out of Sprint 3 Skeleton)

- **`tryScraper(eans)` Adapter in CF2** (`nutrition-backfill`) der
  diese Collection als Source #3 liest. Hat exakt die gleiche Shape
  wie tryReweapify / tryOpenFood — analog zu integrieren.
- **Cron-Schedule**: `scrapeBatch` täglich um 04:00 für noch nicht
  abgedeckte Produkte. Pubsub-Schedule wie bei
  `journey-cleanup`/`leaderboard-aggregator`.
- **Validator**: zusätzliche Plausibilitäts-Checks
  (Energie 50-900 kcal, Fett 0-100g, etc.). Drop offensichtlich
  fehlerhafte LLM-Outputs.
- **Resolver-Erweiterung**: Per-Discounter Slug-Mapping (wenn
  Algolia einen Slug pro Produkt indexiert), Hersteller-Websites.

## Robots-Respect

Vor jedem Fetch wird `robots.txt` des Hosts geprüft. Bei einem
expliziten `User-agent: * / Disallow: /` wird übersprungen.

24h Robots-Cache reduziert Overhead.
