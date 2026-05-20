# Serper.dev — Setup Walkthrough

Schritt-für-Schritt-Anleitung um den Scraper-Backend aufzusetzen.
~2 min aktive Arbeit, danach sofort einsatzbereit.

## Warum Serper statt Vertex AI Search?

Vertex AI Search "Basic Website Search" nutzt einen abgespeckten
Google-Snippet-Index der EANs NICHT als searchable Text führt
(EANs stehen meist tief in Produktdetail-Tabs, nicht im Title/
Meta). Resultat: 0 Treffer bei EAN-Queries — getestet, bestätigt.

Serper.dev macht echte google.com-Searches per API → liefert exakt
das was der User im Browser sieht, inkl. Shop-Produktseiten für
EAN-Queries.

## Schritt 1 — Account anlegen

<https://serper.dev/signup>

Google-SSO oder Email — 2500 Free-Tier-Queries direkt verfügbar.

## Schritt 2 — API-Key kopieren

<https://serper.dev/api-key>

Format: 40-Zeichen-Hex-String.

## Schritt 3 — Secret in GCP setzen

```bash
echo -n "<YOUR_API_KEY>" | gcloud secrets create SERPER_API_KEY \
  --data-file=- --project markendetektive-895f7

# Oder wenn Secret schon existiert — neue Version anlegen:
echo -n "<YOUR_API_KEY>" | gcloud secrets versions add SERPER_API_KEY \
  --data-file=- --project markendetektive-895f7
```

## Schritt 4 — Function deployen

```bash
firebase deploy --only functions:nutrition-scraper --project markendetektive-895f7
```

## Schritt 5 — Smoke-Test

```bash
curl "https://scrapeean-ad6ydmbzbq-ew.a.run.app?key=$(cat /tmp/nutrition_scraper_key.txt)&ean=5900102026074"
```

Erwartete Response:

```json
{
  "result": "ok",
  "triedUrls": 3,
  "successUrl": "https://www.codecheck.info/produkt/...",
  "successShop": "codecheck",
  "extracted": { "attr_ingredientStatement": "Zucker, …", ... }
}
```

## Schritt 6 — Vollen Batch-Scrape

```bash
# dryRun zuerst — checkt nur wie viele URLs Serper findet
curl "https://scrapebatch-ad6ydmbzbq-ew.a.run.app?key=$(cat /tmp/nutrition_scraper_key.txt)&collection=produkte&limit=50&dryRun=1"

# Wenn Zahlen gut → echter Run
curl "https://scrapebatch-ad6ydmbzbq-ew.a.run.app?key=$(cat /tmp/nutrition_scraper_key.txt)&collection=produkte&limit=200"
```

## Kosten

- Free-Tier: 2500 Queries gratis
- Starter: $50 / 50.000 Queries
- Pro: $375 / 500.000 Queries

Für ~8000 uncovered Produkte:
- Serper: ~$8 (oder Free + Starter wenn schon angefasst)
- Claude Haiku 3.5: ~$0.013 / Produkt → ~$105
- **One-Shot Backfill: ~$115**

Nach erstem Full-Run: nur neue Produkte (via onCreate-Trigger),
Kosten ~$0.013/Produkt + 1 Serper-Query (≈ $0.001).

## Troubleshooting

### "all_failed" / "no_urls"

Serper findet keine Treffer auf unseren 11 Shop-Domains.

```bash
# Direkt-Test der Serper-API
curl -X POST 'https://google.serper.dev/search' \
  -H 'X-API-KEY: <KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"q":"5900102026074","gl":"de","hl":"de","num":10}' \
  | jq '.organic[].link'
```

Wenn google.com selbst keine Shop-Treffer hat → Produkt zu obskur,
kein Eintrag in Discounter-Shops. Erwarteter Fall für ~20-30% der
Produkte.

### HTTP 401 / 403

API-Key falsch oder Quota erschöpft. Check:

```bash
gcloud secrets versions access latest --secret=SERPER_API_KEY \
  --project markendetektive-895f7
```

Quota-Status: <https://serper.dev/dashboard>

### Quota-Exhaustion

Bei 2500/Monat → Upgrade auf Starter ($50). Im Dashboard.
