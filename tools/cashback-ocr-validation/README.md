# Phase 0 — OCR Validation

Standalone Python tool. **Hat NICHTS mit der App / Firebase / Cloud Functions
zu tun.** Läuft komplett lokal, schickt Bons direkt an die Gemini API,
schreibt JSON + CSV in `output/`.

Ziel: bevor wir auch nur eine Zeile Cloud-Function-Code für das Cashback-
System schreiben, beweisen dass **Gemini 2.5 Flash deutsche Kassenbons
gut genug versteht**. Decision-Gate: ≥95 % der Bons mit Total/Σitems-
Differenz ≤ 0,05 €.

---

## 1. Setup (einmalig, ~5 Minuten)

### 1a. Gemini API Key holen

1. https://aistudio.google.com/apikey öffnen
2. Mit dem Google-Account einloggen, der zu `markendetektive-895f7`
   gehört (oder neuen Personal-Key — egal, gleicher Pricing).
3. **"Create API key"** → in einem **bestehenden** GCP-Projekt
   (`markendetektive-895f7` ist fein) oder neu.
4. Key kopieren (`AIzaSy…`).

### 1b. Repo-Setup

```bash
cd tools/cashback-ocr-validation

# Python-venv (falls du keine globale Python-Umgebung dafür willst)
python3 -m venv .venv
source .venv/bin/activate

# Deps
pip install -r requirements.txt

# Key in .env packen
cp .env.example .env
# .env editieren, GEMINI_API_KEY eintragen
```

Quick-Check dass alles installiert ist:

```bash
python -c "from google import genai; print('genai ok')"
python -c "from pydantic import BaseModel; print('pydantic ok')"
```

---

## 2. Bons reinlegen

Leg **5–10 echte Kassenbons** von DACH-Supermärkten in `bons/`. Format:
`.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`, `.heif`, `.pdf`.

Empfehlung für eine sinnvolle Stichprobe:

| Was | Warum |
|-----|-------|
| 1× Aldi (Süd oder Nord) | High-volume Discounter |
| 1× Lidl | High-volume Discounter |
| 1× Edeka | Vollsortimenter |
| 1× Rewe | Vollsortimenter |
| 1× Kaufland | Großflächen-Discounter |
| 1× Penny / Netto | weiterer Discounter |
| 1× zerknittert / verknickt | Real-world capture-Qualität |
| 1× schräg fotografiert | Real-world capture-Qualität |
| 1× sehr lang (≥30 Items) | Token-Kosten unter Stress |
| 1× kurz (3–4 Items) | Edge-Case Tier-Cutoff |

Naming egal — `aldi-2026-04-30.jpg`, `bon1.jpg`, was du willst. Der
Tool-Output benutzt einfach den Dateinamen als ID.

---

## 3. Ausführen

```bash
# Default: gemini-2.5-flash, alle Bons in bons/
python validate.py

# Nur die ersten 3 Bons (Probelauf, falls du Geld sparen willst beim Testen)
python validate.py --limit 3

# Anderes Modell (zum Vergleich):
python validate.py --model gemini-2.5-flash-lite
python validate.py --model gemini-2.5-pro

# Alternativer Bons-Ordner:
python validate.py --bons /path/to/other/bons
```

### Was passiert

Pro Bon:

1. Bild + Prompt → Gemini API (`gemini-2.5-flash` default).
2. Antwort wird **strikt gegen Pydantic-Schema** validiert.
3. JSON landet in `output/<filename>.json`.
4. Konsole: `OK 12 items, total=23.45€, Σitems=23.40€, Δ=0.05, 1240 ms`.

Am Ende: `output/summary.csv` mit allen Bons als Zeilen +
Aggregat-Stats auf der Konsole.

### Beispiel-Output (Konsole)

```
→ 7 bon(s) | model=gemini-2.5-flash | prompt=v1.0

[1/7] aldi_2026-04-30.jpg ... OK  14 items, total=23.45€, Σitems=23.45€, Δ=0.00, 1240 ms
[2/7] lidl_zerknittert.jpg ... OK  8 items, total=11.27€, Σitems=11.32€, Δ=0.05, 980 ms
[3/7] rewe_lang.jpg ... OK  31 items, total=89.12€, Σitems=89.12€, Δ=0.00, 2100 ms
…

──────────────────────────────────────────────────────────────────────
Bons:               7
OK:                 7  (100%)
FAIL:               0
Avg latency:        1383 ms
Sum est cost:       1.2400 ¢ (0.0124 $)
Avg cost / bon:     0.1771 ¢
→ at 1.5k bons/day: 79.70 $/month
Avg total/Σitems Δ: 0.01 €
Bons with Δ ≤ 0.05€: 7/7 (100%)
──────────────────────────────────────────────────────────────────────
```

Die letzten 3 Zeilen sind das **Decision-Gate**:

| Metrik | Schwelle |
|--------|----------|
| OK-Quote | ≥ 95 % |
| Bons mit Δ ≤ 0,05 € | ≥ 95 % |
| Avg Cost / Bon | ≤ 0,2 ¢ (sonst Plan B-Lite oder Hybrid prüfen) |

Wenn alle drei grün: **Plan B locked** → wir machen Phase 1.

Wenn einer rot: wir besprechen ob (a) Prompt-Iteration, (b) auf
`gemini-2.5-pro` upgraden, (c) Hybrid mit Document AI fallback,
(d) auf `gemini-2.5-flash-lite` runter wenn Qualität ausreicht.

---

## 4. Output durchschauen

```bash
# Ein einzelner Bon detailliert:
cat output/aldi_2026-04-30.json | jq

# Tabellarisch alle Bons:
column -t -s, output/summary.csv | less -S
```

Für jeden Bon im JSON wichtig:

- `receipt.merchant` — wurde Aldi auch als "Aldi" erkannt?
- `receipt.bonDate` / `receipt.bonTime` — kommt das richtige Datum raus?
- `receipt.items[]` — sind ALLE Artikel drin? Stimmen die Preise?
- `receipt.totalCents` — matcht das mit dem echten Endbetrag?
- `receipt.suspiciousManipulation` — falsche Positives bei echten Bons?
- `receipt.ocrConfidence` — wo schätzt das Modell sich selbst niedrig ein?

---

## 5. Was tun bei Fehlern

| Fehler | Ursache | Fix |
|--------|---------|-----|
| `ERROR: set GEMINI_API_KEY` | `.env` nicht erstellt / Variable nicht gesetzt | `cp .env.example .env` + Key eintragen, oder `export GEMINI_API_KEY=...` |
| `google.genai.errors.ClientError: 403` | API noch nicht aktiviert / falsches Projekt | https://aistudio.google.com/apikey neu generieren oder im richtigen Projekt aktivieren |
| `429 RESOURCE_EXHAUSTED` | Rate-Limit (Free-Tier ist eng) | warten oder Billing aktivieren |
| `schema: [{...}]` | Modell hat sich nicht ans Schema gehalten | siehe `output/<bon>.json` → `rawText` Feld → Prompt-Iteration nötig |
| `json.decode: …` | Modell hat Markdown-Fences statt JSON geliefert | Prompt-Iteration (sollte mit `response_mime_type='application/json'` nicht passieren — wenn doch, melden) |

---

## 6. Was als Nächstes (nach Phase 0)

Wenn Decision-Gate grün:

1. **Du gibst grünes Licht** → ich starte Phase 1: `cashback_config`,
   AGB-Consent-Flow, User-Fields, Firestore-Rules.
2. Phase 0-Tool bleibt im Repo — wir nutzen es weiter als Regression-
   Suite wenn wir später den Prompt iterieren.

Wenn Decision-Gate rot:

1. Wir debuggen anhand der Per-Bon-JSONs welche Bon-Typen das Modell
   nicht packt.
2. Optionen: Prompt-Iteration, Modell-Upgrade, Document AI Fallback,
   oder kleinerer Scope (z. B. nur 4 Top-Discounter zum Start).

---

## 7. Architektur-Reminder

Dieses Tool ist **Phase 0** aus `CASHBACK_ARCHITECTURE.md`. Bevor du
hier weiter machst:

- `KNOWHOW.md` lesen (lebt auf Branch `feat/design-implementation-home`,
  Commit `4db2627`. Schema-Mapping marke vs hersteller_new ist da
  drin — kritisch!)
- `CASHBACK_ARCHITECTURE.md` lesen (gesamter Cashback-Plan)

Tool darf NICHT:
- Firestore schreiben
- Cloud Functions deployen
- in `app/` editieren
- API-Keys in Code committen

Tool darf:
- Lokale Files schreiben (`bons/`, `output/`)
- Gemini API anrufen
- Print-Statements zur Konsole

---

*Build-Log: prompts.py + schema.py + validate.py = ~270 LOC. Nichts magisches.*
