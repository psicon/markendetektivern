# Wissen des Morgen-Workers (Produktfoto-Prüfrunde)

Diese Datei IST das Gedächtnis des Workers. Sie ersetzt den Chat-Verlauf:
alles, was in den Prüfrunden vom 09.–20.09.2026 Geld oder Nutzer gekostet
hat, steht hier als Regel. Wer die Function ändert, ändert zuerst diese Datei.

## Auftrag

Jeden Morgen um 8 Uhr (Europe/Berlin) alle offenen Produktfoto-Einreichungen
(`crowd_uploads`, `status: 'pending'`) prüfen, entscheiden, das Ergebnis
festhalten und melden. Freigaben UND Ablehnungen laufen automatisch
(Entscheidung Patrick, 20.09.2026).

## Reihenfolge des Laufs

1. **Offene Einreichungen laden**, älteste zuerst. Chronologisch entscheiden
   ist Pflicht: sonst blockiert eine jüngere Einreichung an einer älteren, die
   im selben Lauf noch entschieden wird.
2. **Rettungsläufe** für fehlende Felder (Name, EAN, Preis, Hersteller) —
   siehe unten. Erst danach urteilen.
3. **Vollständigkeit + Doppel-Regel** (Kopie der Konsolen-Regel, `src/regeln.js`).
4. **Bildprüfung** (Vision) — zeigt das Foto wirklich das behauptete Produkt.
5. **Entscheiden + buchen.** Die Buchung macht NICHT dieser Worker, sondern
   der bestehende Trigger `crowd-upload-reward` beim Übergang auf `approved`.
6. **Ergebnis schreiben** nach `crowd_review_runs/{YYYY-MM-DD}` und melden.

## Regeln, die nicht verhandelbar sind

- **Die Regeldatei muss aus dem Haupt-Checkout stammen.** Am 20.09. lief ein
  Lauf gegen eine Regelfassung, die sechs Tage alt war — 8 von 14 Ablehnungen
  wären gegen eine Entscheidung gegangen, die Patrick Stunden vorher getroffen
  hatte. Eine Ablehnung ist endgültig. Der Lauf protokolliert deshalb, welche
  Regelversion er benutzt hat.
- **Eine Doppel-Gruppe muss eine zahlbare Kopie übrig lassen.** Die älteste
  Einreichung einer Gruppe ist die Referenz und wird nie gesperrt. Sonst geht
  auch die korrekte Erst-Einreichung leer aus (passiert am 10.09., 3 Gruppen).
- **Bild-Wiederverwendung trifft nur die jüngere Einreichung**, nie beide.
- **Bild-Dedup zählt nur die Identitäts-Fotos** (front, rueckseite, hersteller,
  ean, naehrwerte, zutaten) — NICHT `preis`. Zwei echte Sorten teilen sich oft
  ein gemeinsames Regal-/Aktionsschild.
- **Sieben Dateien sind nicht sieben Ansichten**, und dieselbe Datei ist nicht
  immer ein Mangel: ein Rückseitenfoto kann Zutaten, Nährwerte und Hersteller
  zugleich zeigen (vollständig), sieben Aufnahmen derselben Vorderseite sind
  wertlos (unvollständig). Das entscheidet nur die Bildprüfung.
- **Ein gescheiterter Bild-Audit ist keine Freigabe und keine Ablehnung.**
  Bricht die Prüfung an einem Limit ab (429), bleibt der Fall offen für morgen.
- **Jeder Ablehngrund braucht einen App-Text** in `lib/utils/productSubmissionCopy.ts`.
  Ohne Eintrag liest der Nutzer einen Standardtext, der nicht zu seinem Fall
  passt (bis 20.09. bei 31 % der Abgelehnten so).
- **Fehlende Vergleichswerte gelten als gleich** (fail-closed) — deshalb muss
  bei fehlendem Preis BEIDE Seiten nachgelesen werden, Kandidat und Referenz.
  Sonst entscheidet, auf welcher Seite die Texterkennung zufällig versagt hat.
- **Ein geretteter Preis darf eine Sperre lösen, eine geretteter Herstellername
  nicht.** Markeninhaber und Produzent stehen beide auf der Packung; das ist
  kein Beleg für „andere Daten".
- **Lose Ware wird angenommen** (Entscheidung Patrick, 20.09.): Waagen-Codes
  sind kein Ablehngrund. Nur kennzeichnen und die Doppelprüfung zusätzlich nach
  Markt trennen.

## Rettungsläufe vor dem Urteil

Fehlt ein Feld, wird es mit Denken nachgelesen, bevor abgelehnt wird — die
erste Erkennung läuft ohne Denkbudget und versagt regelmäßig an sauberen
Fotos (am 13./19./20.09. je zweistellig viele Fälle).

- Ergebnisse landen IMMER in eigenen Feldern (`productNameRescueOcr`,
  `eanRescueOcr`, `priceRescueOcr`, `manufacturerRescueOcr`), nie in den
  Originalfeldern — sonst ist die Qualitätsmessung der Ersterkennung verfälscht.
- Übernommen wird nur, was **zwei unabhängige Lesungen gleich lesen**.
- Bei EANs zusätzlich die Prüfziffer verlangen. Lose Ware verleitet das Modell
  sonst dazu, die Nummer vom Waage-Etikett zu liefern.

## Notbremse (Warnungen, die den Lauf anhalten)

Der Lauf hält an und meldet, statt weiterzumachen, wenn:

- die Ablehnungsquote des Tages über dem Doppelten des 30-Tage-Schnitts liegt,
- mehr als ein Viertel der Bildprüfungen an einem Limit scheitert,
- die zugeordnete Aktion ausgelaufen ist oder ihr Budget auf 0 steht
  (im September zwei Tage lang 119 Bons ohne Prämie),
- die Regeldatei sich seit dem letzten Lauf geändert hat (dann erst ansehen).

Angehaltene Läufe entscheiden nichts. Die Fälle bleiben offen.

## Meldung

Eine Nachricht pro Lauf mit: Anzahl entschieden, freigegeben, abgelehnt (nach
Gründen), gebuchter Betrag, offen geblieben, Warnungen. Geht an den
ClickUp-Chat und in den eigenen Claude-Chat; die Zahlen stehen zusätzlich im
Dashboard der Prüfkonsole.
