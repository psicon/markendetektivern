# plz.json — Kopie

Kopie von `cloud-functions/review-console/data/plz.json` (Herkunft, Aufbau und
Neuerzeugung stehen dort in `QUELLE.md`). Codebases teilen in diesem Projekt
keinen Code; beim Neuerzeugen BEIDE Dateien ersetzen.

Genutzt vom Ortsschätzer (`src/bonAdresse.js`): Postleitzahl der Filialadresse
vom Kassenbon → Koordinate des PLZ-Gebiets (Schlüssel `"DE:12345"`, Wert
`[lat, lon, ort, bundesland, firmenMarkierung?]`).
