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

## Secrets (vor Deploy setzen)

Gen-2-Functions nutzen `params.defineSecret()` mit dem
Secret-Manager. Setze:

```bash
echo -n "sk-ant-xxx" | gcloud secrets create ANTHROPIC_API_KEY \
  --data-file=- --project markendetektive-895f7

echo -n "$(openssl rand -hex 16)" | gcloud secrets create NUTRITION_SCRAPER_TRIGGER_KEY \
  --data-file=- --project markendetektive-895f7

# Optional: Google CSE für bessere URL-Resolution
echo -n "AIza..." | gcloud secrets create GOOGLE_CSE_API_KEY \
  --data-file=- --project markendetektive-895f7
echo -n "abc:xyz" | gcloud secrets create GOOGLE_CSE_ID \
  --data-file=- --project markendetektive-895f7
```

Read-Access für die Function:

```bash
SERVICE_ACCOUNT="markendetektive-895f7@appspot.gserviceaccount.com"
for SECRET in ANTHROPIC_API_KEY NUTRITION_SCRAPER_TRIGGER_KEY GOOGLE_CSE_API_KEY GOOGLE_CSE_ID; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member=serviceAccount:$SERVICE_ACCOUNT \
    --role=roles/secretmanager.secretAccessor \
    --project markendetektive-895f7
done
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

## Sources (Resolver-Stufen)

1. **Codecheck.info** — deterministische `?q=<EAN>` URL.
   Funktioniert für viele DE-Produkte. **Implementiert**.
2. **Google CSE** — sucht `<EAN> Zutaten Nährwerte`. Erfordert
   API-Key + CSE-ID. **Stub, ready-to-enable**.
3. **Discounter URL-Patterns** — Aldi/Lidl/Penny/... Slug-Patterns.
   Braucht Slug-Mapping (Algolia?). **TODO Sprint 4**.
4. **Hersteller-Website** — wenn `product.hersteller.website` da
   ist, dortige Suche/Produkt-Page. **TODO Sprint 4**.

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
