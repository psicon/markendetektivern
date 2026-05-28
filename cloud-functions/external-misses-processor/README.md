# external-misses-processor

Scheduled Cloud Function — bearbeitet pending Misses aus
`external_lookup_misses` durch Aufruf der vorhandenen
`scrapeEan`-CF aus dem `nutrition-scraper`. Damit kommen alle
30+ whitelisted Shops (Globus, Kaufland, Rewe, Lidl, Atundo, …)
automatisch als EAN-Backfill für Misses, die der Mobile-Client
beim Scan erkannt hat.

## Architektur

```
Mobile App (Scan unbekannte EAN)
      │
      ▼
externalProductService.lookupByEAN
      │  Cascade: reweapify → nutritionscrape → scraped_products → globus-cf → openfood
      │
      │  Wenn kein Hit (oder nur openfood) → recordMiss()
      ▼
external_lookup_misses/{ean}    ← status: 'pending'
      │
      ▼
processExternalMisses (this CF, scheduled hourly)
      │  pickt bis zu 5 pending Misses (popular first)
      │  setzt status → 'processing'
      │  ruft scrapeEan auf
      ▼
scrapeEan (nutrition-scraper)
      │  Serper-Search → Multi-Shop-Fetch → Claude-Extract
      │  schreibt bei Erfolg in nutritionscrape/{ean}
      │
      ▼  Result-Status
external_lookup_misses/{ean}.status ← 'resolved' | 'no-data' | 'pending'
      │
      ▼
Beim nächsten Mal scannt ein User die EAN:
externalProductService.lookupByEAN
      │  Cascade-Stage 2 (nutritionscrape) hat jetzt einen Hit
      │  → Detail-Page zeigt echte Shop-Daten (inkl. Preis, Bild, Hersteller)
```

## Deploy

```bash
cd cloud-functions/external-misses-processor
npm install
cd ../..
firebase deploy --only functions:external-misses-processor
```

## Secrets

Diese CF braucht den `NUTRITION_SCRAPER_TRIGGER_KEY` damit sie
`scrapeEan` aufrufen kann. Schon gesetzt vom nutrition-scraper-
Deploy. Wenn nicht:

```bash
firebase functions:secrets:set NUTRITION_SCRAPER_TRIGGER_KEY
# Wert ist derselbe wie für nutrition-scraper
```

## Manueller Test

```bash
TRIGGER_KEY=$(firebase functions:secrets:access NUTRITION_SCRAPER_TRIGGER_KEY)
curl "https://europe-west1-markendetektive-895f7.cloudfunctions.net/processExternalMissesManual?key=$TRIGGER_KEY"
```

Erwartete Response (z.B.):

```json
{ "picked": 3, "resolved": 2, "noData": 1, "errored": 0 }
```

## Composite-Indizes

Für die effiziente `pickPendingMisses`-Query (where status=='pending'
ORDER BY hitCount DESC) braucht Firestore einen Composite-Index:

- Collection: `external_lookup_misses`
- Felder: `status` ASC, `hitCount` DESC

Beim ersten Deploy + ersten Cron-Run wirft Firestore einen Link in
den CF-Logs aus mit dem du den Index per Klick anlegen kannst. Bis
dahin fällt der Code auf ein orderBy-loses Query zurück (siehe
`pickPendingMisses` Catch).

Plus ein zweiter Composite-Index für `unstickStaleLocks`:
- Collection: `external_lookup_misses`
- Felder: `status` ASC, `lockAt` ASC

Ebenfalls erst nötig wenn Locks vorkommen — bis dahin failed der
Query silent und beim nächsten Run wird nochmal versucht.

## Cost-Profil

- Scheduler: 1 invocation/Stunde = 720/Monat. Free Tier.
- Pro Invocation: ~5 EANs × ~30-180s pro scrapeEan. Memory 256MiB.
  Im worst case 15min CPU = etwa €0.02 pro Run. ~€15/Monat.
- scrapeEan-Kosten (Claude + Serper + Apify) sind separat im
  nutrition-scraper-Budget — siehe dortige Doku.
- Firestore: ~5 reads + 5-10 writes pro Run. Vernachlässigbar.

## Skipping / Manual Override

Per Hand in der Firestore-Console:

- Setze `status: 'skipped'` für EANs die du NIE prozessieren willst
  (falscher EAN-Typ, Erwachsenen-Inhalt, etc.). Processor ignoriert
  diese.
- Setze `status: 'pending'` zurück um eine `no-data`-EAN nochmal
  versuchen zu lassen (z.B. nach Shop-Liste-Erweiterung).

## Was diese CF NICHT macht

- Keine Lookups (das macht die App).
- Keinen Echtzeit-Scrape (Latency-grund — scrapeEan kann Minuten dauern).
- Keine Auth-Validierung per Firebase-User. scrapeEan reicht das ab.

Siehe auch `FIRESTORE_RULES.md` für die nötigen Client-Schreib-Rules.
