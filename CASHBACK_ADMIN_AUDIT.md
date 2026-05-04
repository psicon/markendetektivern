# Cashback — Admin-Audit Cheatsheet

Wo schaust du als Admin nach, was passiert ist? Solange wir noch
keine eigene UI haben (kommt später ins RevealyIQ-Dashboard, siehe
`CASHBACK_ARCHITECTURE.md` §13.2 Phase 7), nutzt du Firebase Console
+ Cloud Run Logs.

---

## 1. Pro-Bon Audit

### Was ist passiert?

**Firebase Console → Firestore → `receipts/{cashbackId}`**

Hier liegt die vollständige authoritative Receipt-Doc. Felder:

| Feld | Bedeutung |
|------|-----------|
| `userId` | Wer hat den Bon eingereicht |
| `status` | `ocr_pending` / `approved` / `review` / `rejected` |
| `rejectReason` | bei rejected: `unknown_merchant` / `bon_too_old` / `below_min_items` / `reconciliation_delta` / `not_a_receipt` / `no_bon_date` / `process_error` |
| `merchant` | `{ id, name, raw, matchedScore }` — wie der Markt erkannt wurde |
| `bonDate` | YYYY-MM-DD wie auf dem Bon gedruckt |
| `bonTotalCents` | Endbetrag in Cents |
| `items[]` | Alle Items aus dem OCR mit Preis + ob eligible |
| `eligibleItemCount` | Wie viele Items für Cashback zählen |
| `tierApplied` / `cashbackCents` | Welcher Tier griff (5/8 ¢) |
| `ocr.parsed` | Komplettes Gemini-OCR-Ergebnis (raw + structured) |
| `ocr.latencyMs` | Wie lang die OCR gedauert hat |
| `capture` | hash, perceptualHash, source (camera/upload), capturedAt |
| `storage.path` | `cashback-uploads/{uid}/{file}.jpg` — Bon-Bild |
| `createdAt` / `updatedAt` | Zeitstempel |

### Status-Mirror (was die App sieht)

**`users/{uid}/cashback_status/{cashbackId}`**

Slim-Mirror den die App via Snapshot-Listener subscribed. Felder hier
sind identisch zu denen oben, gefiltert. Plus: `merchantDisplayName`
(„LiDL (DE)"), `merchantLogoUrl` (CDN-URL aus discounter-Collection),
`bonAgeDays` (vom Server gerechnet), `merchantMatchVia`
(`alias` / `fuzzy` / `substring`), `bonCountry`.

### Cashback-Ledger (echte Geldbewegungen)

**`users/{uid}/cashback_ledger/{ledgerId}`**

Einer pro Earn / Auszahlung / Reverse / Admin-Adjust.

```
{
  type: 'earn',
  cents: 8,
  receiptId: 'A0ua2B8g7cwLxk66Bn2o',
  balanceAfterCents: 8,
  createdAt: <timestamp>
}
```

Wenn du wissen willst „wo kamen die 8 Cent her?": klicke das Doc, schau
`receiptId` → öffne `receipts/{receiptId}` → siehst Markt, Items, Bon-Foto.

### User-Doc (Saldo)

**`users/{uid}`** Felder:

```
cashback_balance_cents       # aktuelles Guthaben
cashback_lifetime_cents      # alles was je gutgeschrieben wurde
cashback_pending_cents       # Phase 6.5 — gesperrtes Guthaben in Cooling-Period
cashback_last_bon_date       # YYYY-MM-DD — Daily-Cap-Trigger
cashback_consent             # { accepted, version, acceptedAt, appVersion }
trust_score                  # Phase 4.5 — derived
```

---

## 2. Pipeline-Logs

**Firebase Console → Functions → Logs** filtern auf
`cashback-pipeline:processCashback`. Oder direkt:

```bash
firebase functions:log --only cashback-pipeline -n 100
gcloud logging read 'resource.labels.service_name=~"processcashback"' \
  --project markendetektive-895f7 --limit 50
```

Loggt strukturiert:

```
process-done | cashbackId | status | latencyMs | cashbackCents | eligibleItemCount | deltaCents
process-failed | cashbackId | err | stack
```

Bei Fehlern erscheint die OCR-API-Antwort plus Stacktrace.

---

## 3. Was prüfen bei Verdacht?

### „Hat der wirklich N Cent verdient?"

1. `users/{uid}` → `cashback_lifetime_cents` zeigt was insgesamt geflossen ist
2. Iteriere `users/{uid}/cashback_ledger` → jede `earn`-Zeile checken
3. Per `receiptId` zur Receipt → Items + Bon-Foto + Markt verifizieren

### „Ist das Foto echt?"

1. `receipts/{id}.storage.path` öffnen über Cloud Storage Browser
   (Firebase Console → Storage)
2. `receipts/{id}.capture` checken: source (live_camera vs upload),
   hash, perceptualHash
3. `receipts/{id}.ocr.parsed.suspiciousManipulation` lesen — wenn
   `true`, OCR hat selbst Manipulation vermutet

### „Welcher Markt war das wirklich?"

1. `receipts/{id}.merchant.raw` — was tatsächlich im OCR stand
2. `receipts/{id}.merchant.id` — was der Matcher draus gemacht hat
3. `merchantMatchVia` zeigt Stage: alias/fuzzy/substring — bei `fuzzy`
   öfter falsch positiv, bei Verdacht prüfen

### „Wieso wurde abgelehnt?"

`rejectReason`:
- `unknown_merchant` — Matcher hat nichts gefunden. `merchant.raw` zeigt was OCR sah. Wenn das ein realer Markt ist den wir noch nicht haben → Alias hinzufügen oder discounter-Doc anlegen
- `bon_too_old` — Server-Datum minus Bon-Datum > 5 Tage
- `below_min_items` — <4 Items mit Preis
- `reconciliation_delta` — Σ Items vs Total > 2 €
- `not_a_receipt` — Gemini hält Foto für keinen Bon
- `no_bon_date` — Datum nicht erkannt → manuelle Prüfung

---

## 4. Quick-Check Beispiele

```bash
# Alle Bons der letzten 24h
firebase firestore:query 'collection=receipts orderBy createdAt desc limit 30'

# Wie viel Cashback insgesamt heute ausgezahlt
gcloud logging read 'resource.labels.service_name="processcashback" \
  jsonPayload.message="process-done" timestamp>="-1d"' \
  --format='value(jsonPayload.cashbackCents)' \
  | awk '{s+=$1} END {print s/100, "EUR"}'

# Liste aller Bons eines Users
firebase firestore:query 'collection=receipts where userId=="UID_HIER" orderBy createdAt desc'
```

---

## 5. Phase 7 (kommt)

Eigene Admin-UI im RevealyIQ-Dashboard mit:
- Operations-Tab (heute eingereicht, queue depth, errors)
- Holdback-Inbox (Bons in `review` für manuelle Approve/Reject)
- Finance (paid-out, pending, lifetime)
- Fraud (duplicate hits, AI-flag rate)
- Config-Editor (Tiers, Thresholds, Eligible Markets)

Bis dahin: oben gelistete Firestore-Pfade + Cloud Logs.
