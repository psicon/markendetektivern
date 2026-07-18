#!/usr/bin/env python3
# =============================================================================
#  ALGOLIA-SUCHE — ROLLBACK ALLER SYNONYM-VERBESSERUNGEN
# =============================================================================
#
#  >>> AN CLAUDE (falls du diese Datei ohne Kontext bekommst): <<<
#  Der User will die Algolia-Such-Synonyme, die wir am 17./18.07.2026 zur
#  Verbesserung der Produktsuche angelegt haben, KOMPLETT rückgängig machen.
#  Diese Datei macht genau das. Führe sie aus:
#
#        python3 ALGOLIA_ROLLBACK.py            # zeigt nur, was gelöscht würde (sicher)
#        python3 ALGOLIA_ROLLBACK.py --apply    # löscht wirklich (der Rollback)
#
#  Nur mit --apply wird gelöscht. Ohne Flag = reine Vorschau. Danach dem User
#  kurz bestätigen, wie viele Synonyme entfernt wurden.
#
#  --------------------------------------------------------------------------
#  WAS DAS ROLLBACKT (und was NICHT):
#  --------------------------------------------------------------------------
#  Wir haben in Algolia (App Y0KKZHT49Q) zwei Synonym-"Tiers" angelegt, jeweils
#  auf den Indizes `produkte` und `markenProdukte`, mit eindeutigen objectID-
#  Präfixen:
#
#    • mdsyn_  (~1046)  Marken-Synonyme: Suchbegriff -> echte Marken-Produkte.
#                       Bsp: "choceur"->Choceur-Produkte, "müller milchreis"->Müller.
#                       Behebt: Markenname lag nur als Referenz-ID im Record,
#                       darum fanden Marken-Suchen 0 Treffer.
#
#    • mdcat_  (~195)   Kategorie-Rückfall: Marke NICHT im Katalog -> Produkttyp.
#                       Bsp: "milka"->Schokolade, "persil"->Waschmittel.
#
#  Dieses Skript löscht AUSSCHLIESSLICH Synonyme mit diesen beiden Präfixen.
#  Es fasst NICHTS anderes an:
#    - die ~7 ursprünglichen (Nicht-md*) Synonym-Gruppen bleiben,
#    - Produkte, Index-Settings, Ranking, App-Code, DB: alles unberührt.
#
#  Nach dem Rollback ist die Suche wieder im Stand von VOR dem 17.07.2026
#  (viele Marken-/Kategorie-Suchen liefern dann wieder 0 Treffer — das ist
#  gewollt beim Rollback).
#
#  WIEDER EINSPIELEN (falls doch gewünscht, NACH einem Rollback): die Daten
#  liegen im selben Ordner — `python3 apply_857.py --apply` (Marken) und
#  `python3 apply_categories.py --apply` (Kategorie-Rückfall). Details:
#  README.md / SYNONYM_AUDIT.md / CATEGORY_FALLBACK.md.
#
#  Nur-ein-Tier-Rollback (optional): `python3 ALGOLIA_ROLLBACK.py --apply mdcat_`
#  löscht nur die Kategorie-Rückfälle, `... mdsyn_` nur die Marken-Synonyme.
# =============================================================================
import json, urllib.request, ssl, sys

APP   = "Y0KKZHT49Q"
ADMIN = "6513c383e437bb744db65c43898d9a64"     # Algolia Admin-API-Key (Schreibrecht)
INDICES  = ["produkte", "markenProdukte"]
PREFIXES = ["mdsyn_", "mdcat_"]

APPLY = "--apply" in sys.argv
# optionales einzelnes Prefix als Argument (mdsyn_ oder mdcat_)
only = [a for a in sys.argv[1:] if a in PREFIXES]
if only:
    PREFIXES = only

SSL = ssl.create_default_context(); SSL.check_hostname = False; SSL.verify_mode = ssl.CERT_NONE
H = {"X-Algolia-Application-Id": APP, "X-Algolia-API-Key": ADMIN, "Content-Type": "application/json"}

def req(method, url, data=None):
    r = urllib.request.Request(
        url,
        data=(json.dumps(data).encode() if data is not None else None),
        headers=H, method=method,
    )
    return json.loads(urllib.request.urlopen(r, timeout=60, context=SSL).read())

def all_object_ids(index):
    """Alle Synonyme des Index paginiert holen (robust, unabhängig von Query-Matching)."""
    ids, page = [], 0
    while True:
        res = req("POST", f"https://{APP}.algolia.net/1/indexes/{index}/synonyms/search",
                  {"query": "", "page": page, "hitsPerPage": 100})
        ids += [h["objectID"] for h in res.get("hits", [])]
        if (page + 1) * 100 >= res.get("nbHits", 0):
            break
        page += 1
    return ids

print(f"\n  Algolia-Rollback — Präfixe: {', '.join(PREFIXES)}  |  Modus: {'LÖSCHEN (--apply)' if APPLY else 'VORSCHAU (kein --apply)'}\n")
total = 0
for idx in INDICES:
    to_delete = [o for o in all_object_ids(idx) if any(o.startswith(p) for p in PREFIXES)]
    total += len(to_delete)
    if APPLY:
        for o in to_delete:
            try:
                req("DELETE", f"https://{APP}.algolia.net/1/indexes/{idx}/synonyms/{o}")
            except Exception as e:
                print(f"    ! {idx}/{o}: {str(e)[:60]}")
        print(f"  {idx}: {len(to_delete)} Synonyme GELÖSCHT")
    else:
        print(f"  {idx}: {len(to_delete)} Synonyme würden gelöscht")

if APPLY:
    print(f"\n  ✅ Rollback fertig — {total} Synonyme entfernt. Andere Synonyme + alles übrige unberührt.\n")
else:
    print(f"\n  Vorschau: insgesamt {total} Synonyme betroffen. Zum wirklichen Rollback:")
    print(f"        python3 {sys.argv[0]} --apply\n")
