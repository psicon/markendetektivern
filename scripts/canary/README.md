# Canary-Einträge (Datendiebstahl-Nachweis)

**Angelegt: 01.09.2026 · Vertraulich — Inhalt niemals nach außen geben.**

## Warum das existiert

Unsere Hersteller-Zuordnungen sind das Kern-Asset (Basis von App + RevealyIQ).
Rechtlich sind einzelne Zuordnungen **Fakten und damit nicht schützbar** —
geschützt ist nur die Datenbank als Investitionsleistung (§§ 87a ff. UrhG).
Praktisch heißt das: Ohne Marker kann jeder Dieb behaupten, seine Daten
stammten aus Open Food Facts oder von seiner Community. **Genau diese Ausrede
schließen die Köder.**

Jeder Köder ist eine **frei erfundene Kombination** aus
* einer erfundenen EAN mit Präfix `29` (= interne/eingeschränkte Nutzung; kann
  per GS1-Definition nie ein reales Handelsprodukt bezeichnen) und
* einem **frei erfundenen Hersteller** („Krellhofer Lebensmittelwerke GmbH" —
  vor Anlage geprüft: existiert nirgends).

Taucht eine dieser Kombinationen je in einer fremden App oder Datenbank auf,
kann sie nur aus unserer Datenbank stammen. Das ist der Beweis.

## Warum das unseren Nutzern nicht schadet

Die Köder sind in der App **unsichtbar** und behaupten **nichts über reale
Firmen oder reale Produkte**:

| Schutz | Wirkung |
|---|---|
| kein Feld `name` | Firestore schließt Dokumente ohne Sortierfeld aus **jeder** `orderBy('name')`-Abfrage aus — das ist die gesamte Stöbern-Ansicht |
| kein `kategorie`, `discounter`, `handelsmarke`, `preis`, `stufe` | jede gefilterte `where`-Abfrage schließt sie ebenfalls aus |
| keine reale EAN | kein Barcode-Scan trifft sie jemals |
| erfundener Hersteller | keine falsche Aussage über ein echtes Unternehmen |
| aus dem Algolia-Index entfernt | nicht über die Suche auffindbar |

Damit gilt auch für uns dieselbe Regel wie für den Content: **wir erfinden
keine Fakten, die ein Nutzer je zu sehen bekommt.**

## Dateien

* `create_canaries.py` — Anlage (einmalig, bereits ausgeführt)
* `verify_canaries.py` — Kontrolle: Bestand, Unsichtbarkeit, Falle scharf
* `canary_registry.json` — **das Beweismittel**: alle Köder + SHA-256

## Wichtig: Der Sync holt sie zurück

Der `sanitizealgolia`-Dienst hat die Köder beim Anlegen **innerhalb von
Sekunden** in den Suchindex geschoben — sie wurden entfernt. Sollte ein
künftiger Voll-Resync sie erneut einspielen, holt `verify_canaries.py` sie
wieder raus, wenn der Admin-Key gesetzt ist:

```bash
ALGOLIA_ADMIN_KEY=<admin-key> python3 verify_canaries.py
```

**Empfehlung: monatlich laufen lassen** (dauert ~30 Sekunden).

## Im Verdachtsfall

1. Verdächtige App/Datenbank nach den EANs aus `canary_registry.json` und nach
   „Krellhofer" durchsuchen.
2. Treffer dokumentieren (Screenshot, Datum, Version).
3. `canary_registry.json` + der zugehörige **Git-Commit** belegen, dass die
   Einträge vorher bei uns existierten — die Git-Historie ist der Zeitstempel.
4. Damit zum Anwalt. Ein Treffer ist praktisch nicht erklärbar außer durch
   eine Kopie unserer Datenbank.
