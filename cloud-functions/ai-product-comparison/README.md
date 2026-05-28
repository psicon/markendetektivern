# ai-product-comparison

NoName-vs-Markenprodukt-Bewertung via Gemini Flash. Produziert eine
5-stufige Skala (1=NoName deutlich schlechter / rot → 5=NoName deutlich
besser / grün) + kurze deutsche Begründung. Läuft als Firestore-Trigger
(neue/geänderte Produkte) plus HTTPS-Backfill für den initialen Pass.

## Datenfluss

```
produkte/{id}  ──onCreate / onUpdate──┐
                                       ├──→ runComparison(id)
markenProdukte/{ref} ──onUpdate (fan-out)──┘     │
                                                 ├─ hash-check (skip wenn unverändert)
                                                 ├─ Gemini-Call (gemini-2.5-flash)
                                                 └─ aiComparison auf produkte/{id} schreiben
```

## Output-Schema auf `produkte/{id}.aiComparison`

```ts
{
  score?: 1 | 2 | 3 | 4 | 5,     // fehlt wenn skipped/lastError gesetzt
  reasoning?: string,             // 1-2 Sätze DE, max ~220 Zeichen
  model: string,                  // z.B. 'gemini-2.5-flash'
  promptVersion: string,          // 'v1' — bei Prompt-Update bumpen
  inputHash?: string,             // sha256 der Inputs, 16 chars
  updatedAt: Timestamp,
  skipped?: 'no-markenprodukt' | 'incomparable',
  lastError?: string,             // bei Gemini-Fehler
  lastErrorAt?: Timestamp,
}
```

## Endpoints

| Name | Trigger | Zweck |
|---|---|---|
| `onProduktCreateForComparison` | Firestore onDocumentCreated `produkte/{id}` | Initial-Bewertung bei neuem NoName |
| `onProduktUpdateForComparison` | Firestore onDocumentUpdated `produkte/{id}` | Re-Bewertung bei Nutrition/Zutaten/MP-Ref-Änderung |
| `onMarkenProduktUpdateForComparison` | Firestore onDocumentUpdated `markenProdukte/{id}` | Fan-out: alle gelinkten NoNames neu (max 30) |
| `runComparisonForProduct` | HTTPS | Admin: einzelne ProduktID neu bewerten (`?produktId=...&force=1`) |
| `runComparisonBackfill` | HTTPS | Initial Mass-Run mit Cursor-Pagination |

## Deploy

```bash
cd cloud-functions/ai-product-comparison
npm install
cd ../..
firebase deploy --only functions:ai-product-comparison
```

Secrets: `GEMINI_API_KEY` (schon im Projekt vom image-cleanup CF) +
`NUTRITION_SCRAPER_TRIGGER_KEY` (für HTTPS-Auth, schon gesetzt).

## Backfill

Empfohlener Workflow nach Deploy:

```bash
TRIGGER_KEY=$(firebase functions:secrets:access NUTRITION_SCRAPER_TRIGGER_KEY)

# Dry-Run zuerst — listet wie viele Produkte überhaupt anstehen
curl "https://europe-west1-markendetektive-895f7.cloudfunctions.net/runComparisonBackfill?key=$TRIGGER_KEY&dryRun=1&limit=500"

# Echter Run, Pagination per nextStartAfter
curl "https://europe-west1-markendetektive-895f7.cloudfunctions.net/runComparisonBackfill?key=$TRIGGER_KEY&limit=200"
# → returnt z.B. { picked: 200, updated: 187, nextStartAfter: "abc..." }

# Next Batch
curl "https://europe-west1-markendetektive-895f7.cloudfunctions.net/runComparisonBackfill?key=$TRIGGER_KEY&limit=200&startAfter=abc..."
```

200 Docs/Batch × 200ms Throttle = ~40s + Gemini-Latency = ~2-3min pro
Batch. 50k Docs = ~250 Batches = ~12h Wandbruchstunde. Realistisch
splittet sich das aber: viele NoNames haben keinen markenProdukt-Ref,
viele werden inkomparable sein. Ich rechne mit ~30-50% effektivem
Gemini-Call-Rate.

## Cost-Profil

Pro Comparison-Call:
- Gemini 2.5 Flash: ~600 input + 150 output tokens
- ~$0.0001 (0.01 Cent) pro Call

50k Produkte (worst case alle qualified):
- ~$5 für komplettes Backfill (einmalig)
- Trigger-Workload ongoing: vernachlässigbar (Hash-Check spart >90% der Calls)

## Wie der Hash-Check Calls spart

Firestore-Trigger feuern für JEDE Doc-Änderung. Aber 90% der Updates
betreffen NICHT die Comparison-Inputs:
- Image-URL-Update (image-cleanup-CF rewrites bildClean)
- Stufe-Update (Markt-Vergleich)
- Counter-Updates (purchase-history)

Der Hash über Nährwerte + Zutaten beider Produkte fängt das ab. Nur
wenn etwas Materielles geändert hat, läuft ein Gemini-Call.

## Skip-Logik

| Zustand | aiComparison-Wert | UI-Verhalten |
|---|---|---|
| Kein markenProdukt-Ref auf NoName | `skipped: 'no-markenprodukt'` | Skala nicht zeigen |
| Beide Produkte ohne Nährwerte+Zutaten | `skipped: 'incomparable'` | Skala nicht zeigen, Hinweis "Daten fehlen" |
| Gemini-Fehler | `lastError: '...'` | Skala nicht zeigen, optional "Bewertung lädt..." |
| Erfolg | `score: 1..5, reasoning: '...'` | Skala zeigen + Text |

## Prompt-Updates

Wenn du den System-Prompt änderst, bumpe `PROMPT_VERSION` in
`src/comparator.js` (`v1` → `v2`). Beim nächsten Backfill werden ALLE
alten Comparisons re-evaluiert weil der Version-Check failt.
