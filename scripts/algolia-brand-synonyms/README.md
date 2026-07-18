# Algolia Marken-Synonyme (Referenz-ID-Such-Bug-Mitigation)

## Problem
Marken-, Handelsmarken- und Kategorie-Namen liegen in **eigenen Collections**
(`hersteller`, `handelsmarken`, `kategorien`, `hersteller_new`). Der Firestore→Algolia-Sync
serialisiert die `DocumentReference` als **Pfad-String** (`"hersteller/<id>"`) — der
**Markenname steht NIRGENDS im Algolia-Record**, nur die ID. `searchableAttributes` durchsucht
zwar `hersteller`/`handelsmarke`/`kategorie`, findet dort aber nur die ID.

**Folge:** Suche funktioniert nur für Wörter, die zufällig im **Produktnamen** stehen.
Jede reine Marken-/Kategorie-Suche fällt auf 0 Treffer. In der Such-History (BigQuery
`firestore_export.searchHistory_raw_latest`): **99% aller Suchen = 0 Treffer** (letzte 7 Tage: 73%).
Top-Fehlschläge: `milka`, `lindt`, `choceur`, `moser roth`, `philadelphia`, `ritter sport` …

## Fix (rein Algolia — DB + App unangetastet)
Für jeden nachgefragten Marken-Suchbegriff, dessen Ref-ID nachweislich Produkte hat, ein
**one-way-Synonym** `input: "<begriff>" → synonyms: ["<refID>"]`. Die rohe Ref-ID ist ein
durchsuchbarer Token im `hersteller`/`handelsmarke`-Feld → das Synonym leitet die Suche dorthin.
Synonyme sind **Index-Config, keine Records** → sie **überleben den Sync** (im Gegensatz zu
`partialUpdate` von Feldern, die der nächste Produkt-Sync überschreiben würde).

- **objectID-Präfix `mdsyn_`** (+ sha1-Hash des Inputs → kollisionsfrei, idempotent).
- **`replaceExistingSynonyms=false`** → die ~7 bestehenden Synonym-Gruppen bleiben unangetastet.
- Angewandt auf **beide** Indizes (`produkte`, `markenProdukte`).
- **Sicherheitsgarantie:** alle Ziel-Begriffe finden aktuell 0 Treffer → ein Synonym kann nur
  Ergebnisse HINZUFÜGEN, nie eine funktionierende Suche verschlechtern. Der App-Query-Pfad
  (`lib/services/algolia.ts`, `searchNoNameProducts`/`searchMarkenprodukte`) nutzt KEIN
  `restrictSearchableAttributes` → Index-Synonyme wirken 1:1 in der App.

## Auswahl (nachfrage-getrieben + adversariell verifiziert)
1. Top-1500 dauerhaft-fehlschlagende Suchbegriffe aus BigQuery (`resultCount=0`, `freq>=2`).
2. Deterministisch gegen alle Ref-Collection-Namen gematcht (exakt / Fuzzy-Tippfehler / Teilwort).
3. **Empirisch geprüft**: bringt die rohe Ref-ID echte Produkte in Algolia? (nur dann valide).
4. **Adversariell** (Multi-Agent-Workflow): Relevanz + Kollisionsrisiko je Kandidat, riskante von
   einem skeptischen Refuter gegengeprüft. Fehlmatches raus (z.B. `stollen`→Hähnchen-Marke „Stolle",
   `hela`→„hella", `golden`/`veggie`/`getränke` zu generisch).
5. Ergebnis: **189 Synonyme live** (156 Suchen von 0→Treffer, Rest bereits per Katalog-Wachstum ok).

## Dateien
- `applied_synonyms.json` — der aktuell live gespielte Synonym-Satz (Snapshot).
- `final_apply.py` — Rollback aller `mdsyn_` + frisches Apply (kollisionsfrei, idempotent).
- `rollback_synonyms.py` — **alle `mdsyn_`-Synonyme löschen** (Sofort-Rückgängig, lässt andere intakt).
- `verify_beforeafter.py [label]` — nbHits je Begriff (Vorher/Nachher-Beweis).
- `gap_report.py` — **Katalog-Wunschliste** (nachgefragte, aber fehlende Marken/Kategorien).
- `dump_refs.py` / `verify_candidates.py` — Neu-Erzeugung der Kandidaten aus Such-History.
- `candidates.json` — alle 233 empirisch geprüften Kandidaten (inkl. verworfene).
- `wf_result_raw.json` — Workflow-Verdicts (keeps/drops/refute) + Gap-Triage.

## Rollback (jederzeit, ein Befehl)
```bash
python3 scripts/algolia-brand-synonyms/rollback_synonyms.py
```

## Neu laufen lassen (z.B. monatlich, neue Fehl-Suchen aufsammeln)
Voraussetzung: `gcloud auth` (BigQuery + Firestore) + Algolia-Admin-Key in den Skripten.
1. `dump_refs.py` (frische Fehl-Suchen aus BigQuery → Ref-Match)
2. `verify_candidates.py` (empirische Algolia-Prüfung)
3. adversarielle Verifikation (Workflow) → `wf_result.json`
4. `final_apply.py`  → `verify_beforeafter.py after`

## Der EIGENTLICHE Fix (Follow-up)
Das hier ist die dauerhafte, saubere Mitigation OHNE DB/App. Der strukturell korrekte Fix löst die
Referenz im **Sync-Layer** auf (`sanitizealgolia` Cloud-Run-Service): `hersteller`/`handelsmarke`-Ref
→ Name in ein `herstellerName`-Feld schreiben. Dann sind ALLE Marken findbar (auch nie gesuchte),
und die Synonyme können entfallen. Solange das nicht passiert, ist dieser Synonym-Satz der Fix.
