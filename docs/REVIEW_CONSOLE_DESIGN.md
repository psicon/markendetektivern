# Review-Konsole — Produktfotos & Bons prüfen, filtern, freigeben

Stand 05.09.2026 · Auftrag (Patrick, 05.09.): „Ein bei Firebase gehostetes Web-Projekt, um
Crowd-Uploads und Kassenbons zu überprüfen, reinzuschauen, zu filtern, zu suchen und die
Freigabe anzustoßen — Einzelzeilen und Batch. Ein vollwertiges Tool."

## 1. Was heute existiert (und wiederverwendet wird)

| Baustein | Stand | Verwendung im Tool |
|---|---|---|
| Hosting-Site `md-receipt-admin` (`receipt-admin-web/index.html`) | Vanilla-ES-Module, Firebase-Auth E-Mail/Passwort, Custom-Claim `admin:true`, Callables in `europe-west1` | **Dieselbe Site, dieselbe Anmeldung.** Die Konsole wird zur zweiten und dritten Seite (`produktfotos.html`, `bons.html`), gemeinsame `admin-common.js` (Auth-Gate, Callable-Helper, Toast, Zoom). Kein Build-Schritt, kein neuer Toolchain. |
| `crowd-upload-reward` (Trigger `pending → approved`) | live | Bleibt die EINZIGE Geldbuchung für Fotos. Das Tool setzt nur den Status. |
| `crowd-upload-namer` (OCR Produktname beim Anlegen) | live | Wird um `priceOcr` (Preisschild) und `manufacturerOcr` (Hersteller-Foto) erweitert — die Vergleichsdaten der Doppel-Regel. |
| `resolveCashbackReview` (HTTPS, Key) | live, alle Caps, Ledger-Reverse | Bon-Entscheidungen laufen server-seitig weiter über diesen Endpoint; die Konsole ruft ihn über einen Admin-Callable (Key aus Secret Manager, nie im Browser). |
| Skripte `.crowd-approve.js` / `.crowd-reject.js` / `.crowd-holds.js` | manuell, Runden 20.08.–03.09. | Ihre Regeln (7/7 Fotos, EAN 8–14, Name, kein Doppel, keine md5-Wiederverwendung, Vision-Audit) werden zur automatischen **Vorprüfung** je Upload. |

Datenbasis (05.09.): 1.596 `crowd_uploads` (1.172 approved, 275 rejected, 149 pending), 3 Aktionen,
53 Wiederholungen „gleicher Nutzer + gleiche EAN", 36 EANs von mehreren Nutzern. Halte-Gründe bisher:
doppelt_eingereicht 191, ean_fehlt 134, produkt_bereits_verguetet 129, bilder_wiederverwendet 35.

## 2. Die Doppel-Regel (Produktentscheidung 05.09.2026)

Ein Produkt = **EAN** (Fallback: normalisierter Name + Markt, wenn keine EAN). Referenz ist die
jüngste **freigegebene** Einreichung desselben Produkts (`prior`).

| Fall | Regel | Ergebnis |
|---|---|---|
| Gleicher Nutzer, `prior` < 30 Tage alt, gleiche Daten | Sperre | `rejected`, Grund `sperre_30_tage_gleicher_nutzer`, `lockUntil` = prior + 30 d |
| Gleicher Nutzer, `prior` < 30 Tage, **andere Daten** (Preis ≠, Hersteller ≠, Markt ≠) | erlaubt | freigabefähig, Hinweis „Aktualisierung: Preis 1,99 → 2,29" |
| Anderer Nutzer, `prior` < 30 Tage, gleiche Daten | Sperre | `rejected`, Grund `sperre_30_tage_anderer_nutzer` |
| Anderer Nutzer, `prior` < 30 Tage, **andere Daten** | erlaubt | freigabefähig, Hinweis auf Unterschied |
| `prior` ≥ 30 Tage | erlaubt | normale Prüfung |
| `prior` noch `pending` | Halten | `holdReason: doppelt_eingereicht` — erst die ältere entscheiden |

„Andere Daten" heißt: `priceCents` (OCR vom Preisschild, Toleranz 0 ct — Preisänderung ist genau
das Signal), `manufacturer` (normalisiert, Levenshtein ≤ 2 = gleich), `marketId`. Fehlt bei einer
Seite der Wert, gilt er als **gleich** (fail-closed: kein Bonus für fehlende Daten).

Die Regel lebt in EINEM Modul `cloud-functions/review-console/src/duplicatePolicy.js` (rein,
getestet) und wird an ZWEI Stellen angewandt:
1. **Vorprüfung** beim Anlegen (nach der Namer-OCR): schreibt `review.precheck` ans Doc — die Liste
   zeigt es sofort, Batch-Freigabe überspringt gesperrte Zeilen.
2. **Entscheidung** (`reviewDecideUploads`): wird bei jeder Freigabe ERNEUT berechnet (Tatsachen
   zum Zeitpunkt der Entscheidung, nicht das gecachte Ergebnis). Ein Admin kann mit `force: true` +
   Notiz übersteuern — das landet als `review.forcedBy` am Doc.

Die Sperre ist **abgeleitet** (prior + 30 Tage), kein gespeicherter Zustand pro Nutzer — nichts,
das „hängen bleiben" kann.

## 3. Architektur

```
Browser (md-receipt-admin)                Cloud Functions (europe-west1, onCall, admin-only)
  produktfotos.html ───────────────▶  review-console: reviewListUploads / reviewDecideUploads
  bons.html         ───────────────▶  review-console: reviewListReceipts / reviewDecideReceipt ──▶ resolveCashbackReview (HTTPS, Key)
  Bilder: Firebase Storage SDK ─────▶  storage.rules: read für admin-Claim (crowduploads/, cashback-uploads/)
                                       crowd-upload-namer (+ priceOcr, manufacturerOcr) ──▶ review.precheck
                                       crowd-upload-reward (unverändert) ◀── Status-Flanke pending→approved
```

- **Alles Admin-SDK hinter Callables.** Firestore-Rules bleiben unangetastet (`crowd_uploads`:
  update/delete `false`). Nur die Storage-Rules bekommen `|| request.auth.token.admin == true`.
- **Listen:** `crowd_uploads` sind 1,6 k Docs → der Callable lädt das gefilterte Fenster (Status,
  Aktion, Zeitraum; Firestore-Query) und filtert Freitext (Name, EAN, Nutzer-ID, Markt) im Speicher.
  Cursor-Paging ab 200 Zeilen. Bons (`receipts`, 6,2 k) genauso mit Status/Zeitraum-Query.
- **Batch:** bis 100 IDs pro Aufruf, jede ID eigene Transaktion, Ergebnis pro ID
  (`ok | blocked | skipped | error` + Grund). Kein „alles oder nichts" — die UI zeigt die Liste.
- **Idempotent:** Status-Flip nur aus `pending`; `reviewedAt`, `reviewedBy` (Admin-UID),
  `reviewNote` (positiv formuliert, Copy-Ton-Regel), `review.precheck`.

## 4. Bildschirme

**Produktfotos** — Kopfzeile mit Zählern (pending / heute freigegeben / gesperrt), Filter-Leiste
(Status, Aktion, Zeitraum, Halte-Grund, Vorprüfung ok/gesperrt/unvollständig), Suche (Name, EAN,
Nutzer, Markt). Tabelle: Checkbox · Thumbnail (Front, Hover-Zoom) · Name (+ OCR-Name) · EAN · Markt ·
Preis (OCR) · Hersteller (OCR) · Nutzer (Kurz-ID, Klick = alle Einreichungen dieses Nutzers) ·
Vorprüfung (Chip) · Alter. Zeile aufklappen: alle 7 Fotos, Ortsangaben, Doppel-Referenz mit
Unterschieden, Verlauf. Aktionen je Zeile: Freigeben / Ablehnen (Grund + Notiz) / Halten.
Batch-Leiste bei Auswahl: „N freigeben", „N ablehnen (Grund)", „Vorprüfung ok auswählen".

**Bons** — Filter (Status inkl. `review`, Markt, Zeitraum, Nutzer), Tabelle: Bild · Markt + Filiale
(neu: `store`) · Datum · Summe · Artikel · Status/Grund · OCR-Konfidenz · Alter. Aufklappen: Bon-Bild,
OCR-Positionen, Dedup-Treffer, Review-Grund. Aktionen (nur `review`): Freigeben / Ablehnen (Grund) /
Ohne Prämie — 1:1 die Entscheidungen von `resolveCashbackReview`.

## 5. Phasen

1. **CF `review-console`** (Duplikat-Modul + Tests, `reviewListUploads`, `reviewDecideUploads`,
   Storage-Rules) — sofort nutzbar mit dem bestehenden Login.
2. **`produktfotos.html`** + `admin-common.js`.
3. **Namer-Erweiterung** (Preis, Hersteller) + Vorprüfung beim Anlegen + Backfill der
   Vorprüfung für die 149 pending.
4. **Bons** (`reviewListReceipts`, `reviewDecideReceipt`, `bons.html`).
5. **Abnahme** mit Rollen: Reviewer/Operator, Geld-Buchhalter, Security (Claim, Rules),
   Datenschutz, Ops/Rollback.

## 6. Nicht-Ziele (bewusst)

Keine Rechteverwaltung über den Admin-Claim hinaus, keine Bild-Bearbeitung, keine Änderung der
Geldbuchung (bleibt im Trigger), kein Framework/Build-Schritt.
