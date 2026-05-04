# Handoff Prompt — Phase 2: Async OCR Backend mit Push-Notification

**Wo gehört das hin?** `cloud-functions/` (Firebase Functions) +
`app/` (React Native, Push-Handling). Eigene Session.

**Voraussetzung:** Phase 1 (Foundation: `cashback_config`, AGB-Consent,
Firestore-Rules, User-Fields) muss DONE sein. OCR-Pipeline aus Phase 0
(`tools/cashback-ocr-validation/`) ist gewählt: **Cloud Vision + Gemini
Flash Hybrid** mit Auto-Escalate auf DocAI Expense Parser.

---

## Mission in einem Satz

User wartet **0 Sekunden** auf OCR. Bon hochladen → sofort "wird geprüft",
Push-Notification "Cashback bereit!" wenn fertig (5–8s später, im
Hintergrund).

## Warum das wichtig ist

Im Phase-0-Tool gemessen: **32.6s/Bon Latenz** (ohne Parallel; mit
Parallel ~6-8s). Selbst 6-8s aktiv warten ist UX-Tod. Async + Push macht
die wahrgenommene Latenz **null**.

## Architektur

```
┌─────────────┐    1. POST /cashbacks  ┌────────────────────────┐
│  React      │ ─────────────────────▶ │  HTTPS Cloud Function  │
│  Native App │  { imageUrl, userId }  │  enqueueCashback()     │
└─────────────┘ ◀───── 200 OK ──────── │  • Validates user      │
                                       │  • Writes Firestore    │
                                       │    /cashbacks/{id}     │
                                       │    status="processing" │
                                       │  • Enqueues PubSub     │
                                       │    "ocr-jobs" topic    │
                                       └───────────┬────────────┘
                                                   │ async
                                                   ▼
                                       ┌────────────────────────┐
                                       │  PubSub-triggered Fn   │
                                       │  processCashback()     │
                                       │  • Download image      │
                                       │    from Storage        │
                                       │  • Run CV+Gemini       │
                                       │    Hybrid (60s timeout)│
                                       │  • If Δ > 0.05€ →      │
                                       │    DocAI escalate      │
                                       │  • Match catalog       │
                                       │    (Phase 3)           │
                                       │  • Update Firestore    │
                                       │    status="ready" |    │
                                       │    "rejected"          │
                                       │  • Send FCM push       │
                                       └────────────────────────┘
                                                   │
                                                   ▼
                                       ┌────────────────────────┐
                                       │  React Native App      │
                                       │  receives push,        │
                                       │  deep-links to         │
                                       │  /cashback/{id}        │
                                       └────────────────────────┘
```

## Komponenten zu bauen

### 1. `enqueueCashback` — HTTPS Function (synchron, ~200ms)

`cloud-functions/src/cashback/enqueue.ts`

- Auth-Check: User ist eingeloggt + AGB akzeptiert (Phase-1 Field)
- Idempotency-Key: SHA-256 vom Image (Bytes-Hash) — Duplikate
  zurückweisen
- Rate-Limit: max 20 Bons/Tag/User (anti-abuse, von cashback_config)
- Storage-Pfad validieren: `cashback-uploads/{userId}/{uuid}.jpg`
- Erstelle Firestore-Doc:
  ```ts
  /cashbacks/{cashbackId} = {
    userId, imagePath, bytesHash,
    status: "processing",
    createdAt: serverTimestamp(),
    estimatedReadyBy: serverTimestamp() + 30s,
  }
  ```
- Publish PubSub-Message auf `ocr-jobs` mit `{ cashbackId }`
- Return `{ cashbackId, estimatedReadyBy }` an Client (sofort, < 500ms)

### 2. `processCashback` — PubSub-Triggered Function (async, ~10s)

`cloud-functions/src/cashback/process.ts`

- Trigger: `ocr-jobs` PubSub-Topic
- Memory: 1GB (Vision-Client + Gemini-Client + image bytes)
- Timeout: 120s (für edge cases mit DocAI-Escalation)
- Retries: 3 (Backoff: 30s, 5min, 30min) — bei API-Fehlern
- Schritte:
  1. Read Firestore-Doc, Storage-Image-Download
  2. Resize → max 2000px (gleicher Code wie
     `tools/cashback-ocr-validation/image_prep.py`)
  3. Cloud Vision OCR → text + word boxes
  4. Gemini 2.5 Flash → structured Receipt JSON
     (gleicher Prompt wie `cv_hybrid.py::PARSER_SYSTEM_PROMPT`)
  5. Reconciliation: |Σ items - Total| ≤ 0.05€
  6. Wenn FAIL: DocAI Expense Parser als Backup
  7. Wenn beide FAIL: status="rejected", reason in Doc
  8. Catalog-Match (Phase 3 — vorerst Skip oder Stub)
  9. Update Firestore-Doc: `status: "ready"`, `receipt: {...}`,
     `cashbackCents: ...`, `processedAt: serverTimestamp()`
  10. FCM Push an User: "🎉 Dein Cashback ist bereit!"
- Logging: jeden Schritt mit Latenz + Engine-Used in Cloud Logging
  (für Cost-Monitoring + Debugging)

### 3. FCM Push-Setup

`cloud-functions/src/notifications/sendPush.ts`

- Firebase Cloud Messaging Token-Storage in
  `/users/{userId}/fcmTokens` (Array, weil Multi-Device)
- Push-Payload:
  ```ts
  {
    notification: { title: "🎉 Cashback bereit!", body: "Du hast 8¢ verdient." },
    data: { cashbackId, deepLink: "markendetektive://cashback/{id}" },
  }
  ```
- Failed-Token-Cleanup (bei `messaging/registration-token-not-registered`
  Token aus Array entfernen)

### 4. App-Side: Status-Listening + Push-Handling

`app/screens/Cashback/SubmitCashbackScreen.tsx`

- Nach Upload: navigate zu `CashbackPendingScreen` mit `cashbackId`
- Listen via Firestore-Snapshot auf `/cashbacks/{cashbackId}` —
  Status-Wechsel triggert UI-Update
- Optimistic UI: "Bon eingereicht ✓ · wird geprüft (~10s)"
- Wenn `status: ready` → success-Animation + "+8¢ Cashback erhalten"
- Wenn `status: rejected` → freundlicher Reject-Screen mit Re-Upload-CTA

`app/services/notifications/pushHandler.ts`

- Foreground: Toast "Cashback bereit, tippen für Details"
- Background: System-Notification, Tap = Deep-Link zum Cashback-Detail

### 5. Cost & Performance Monitoring (BigQuery + Looker)

`cloud-functions/src/cashback/monitoring.ts`

- Pro Bon Cost-Event in BigQuery loggen:
  ```ts
  { cashbackId, engine, primaryCostCents, escalated, escalateCostCents,
    primaryLatencyMs, totalLatencyMs, reconciliationDelta, timestamp }
  ```
- Looker-Dashboard: Daily $/Bon, Escalation-Rate, P50/P95/P99 Latenz,
  Reject-Rate
- Alert: bei Escalation-Rate > 15% → Slack-Notification (Capture-Quality
  problem upstream)

## Was DU NICHT machen sollst

- **Nicht** die OCR-Engines neu implementieren — Code aus
  `tools/cashback-ocr-validation/cv_hybrid.py`, `docai.py`, `image_prep.py`,
  `schema.py`, `prompts.py` 1:1 nach `cloud-functions/src/cashback/ocr/`
  portieren (Python → TypeScript). Die Prompts und das Pydantic-Schema
  sind erprobt — nur Sprache übersetzen.
- **Nicht** Firestore-Rules ändern ohne Phase-1 zu kennen.
- **Nicht** synchron (HTTPS-Function-Response wartet auf OCR) bauen —
  das war der ganze Punkt: ASYNC.
- **Nicht** GenAI-Output direkt User zeigen ohne Reconciliation-Gate.

## Akzeptanzkriterien

- HTTPS `enqueueCashback` antwortet < 500ms (P95).
- `processCashback` Median-Latenz ≤ 10s, P95 ≤ 25s.
- Push-Notification erreicht 95% der User innerhalb 60s nach Upload.
- 0 verlorene Bons (PubSub-Retries fangen alle transienten Fehler).
- Cost-Dashboard zeigt: avg ¢/Bon ≤ 0.5¢ (target Phase-0-Validation).
- Idempotency: gleicher Bon zweimal hochgeladen → Server-Side
  zurückgewiesen, keine doppelte Auszahlung.

## Empfohlene Reihenfolge

1. **Spike** (~1 Tag): Code-Port von Python → TypeScript für CV+Gemini
   und Schema. Lokal mit Firebase Emulator testen.
2. `enqueueCashback` HTTPS-Function (1 Tag).
3. `processCashback` PubSub-Function + lokale Storage-Read/Write
   (1-2 Tage).
4. FCM Push-Integration (1 Tag).
5. App-Side: Pending-Screen + Push-Handling (1-2 Tage).
6. Cost-Monitoring (1 Tag).
7. Load-Test mit 100 Bons in 1 Minute → schauen wie Pipeline skaliert.

**Geschätzt: 1.5–2 Wochen Solo-Dev.**

## Hilfreiche Referenzen

- Phase-0-Validation-Tool (alle Algorithmen erprobt):
  `tools/cashback-ocr-validation/` — README.md liest sich wie ein Spec.
- Spezifisch wichtig:
  - `cv_hybrid.py` — die hybrid OCR-Pipeline
  - `docai.py` — DocAI Expense Parser + DACH-Retailer-Detection (28
    Retailers + Position-Aware Matching)
  - `image_prep.py` — Resize + Auto-Crop + EXIF-Rotation
  - `schema.py` — Receipt Pydantic-Schema (1:1 nach Zod portieren)
  - `prompts.py` — Gemini System-Prompt (1:1 übernehmen)
- Firebase-Docs:
  - PubSub Triggers: https://firebase.google.com/docs/functions/pubsub-events
  - FCM Server: https://firebase.google.com/docs/cloud-messaging/send-message

## Erwarteter Impact

- **UX**: Wahrgenommene Latenz 32s → 0s. Massive Conversion-Boost.
- **Skalierbarkeit**: PubSub puffert Bursts (User-Spikes z.B. nach
  Marketing-Push). Cloud Functions auto-scalen bis 1000+ concurrent.
- **Cost-Visibility**: Live-Dashboard ersetzt das Phase-0-Tool für
  Production-Monitoring.

---

**Next session start mit:** "Implement Phase 2 Async OCR Backend gemäß
`tools/cashback-ocr-validation/handoff-prompts/phase-2-async-cloud-functions.md`.
Phase 1 Foundation ist done. Start mit Code-Port der OCR-Pipeline."
