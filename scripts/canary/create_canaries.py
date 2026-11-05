#!/usr/bin/env python3
"""
CANARY-EINTRAEGE ("Trap Streets") fuer die MarkenDetektive-Produktdatenbank
===========================================================================
ZWECK
  Nachweisbarkeit von Datendiebstahl. Die Produktdaten sind faktisch nicht
  urheberrechtlich geschuetzt (Fakten), geschuetzt ist nur die Datenbank als
  Investitionsleistung (§§ 87a ff. UrhG). Ohne Marker laesst sich eine Kopie
  praktisch nicht beweisen - ein Dieb kann immer behaupten, die Daten stammten
  aus Open Food Facts o.ae. Diese Eintraege loesen das:

  Jeder Koeder ist eine FREI ERFUNDENE Kombination aus
    - einer erfundenen EAN (Praefix 29 = interne/eingeschraenkte Nutzung,
      kann per Definition nie ein reales Handelsprodukt bezeichnen) und
    - einem FREI ERFUNDENEN Hersteller ("Krellhofer Lebensmittelwerke GmbH",
      vorab geprueft: existiert nicht).

  Taucht diese Kombination je in einer fremden App/Datenbank auf, kann sie
  nur aus unserer Datenbank stammen. Das ist der Beweis.

WARUM DAS UNSEREN NUTZERN NICHT SCHADET
  Die Koeder sind in der App unsichtbar und behaupten nichts ueber reale
  Firmen oder reale Produkte:
    - kein Feld `name`  -> Firestore schliesst Dokumente ohne Sortierfeld aus
      JEDER orderBy('name')-Abfrage aus (= die gesamte Stoebern-Ansicht)
    - kein `kategorie`, `discounter`, `handelsmarke`, `preis`, `stufe`
      -> auch jede gefilterte Abfrage (where-Klausel) schliesst sie aus
    - keine reale EAN -> kein Scan trifft sie jemals
    - erfundener Hersteller -> keine falsche Aussage ueber ein echtes Unternehmen

BEWEISFUEHRUNG
  canary_registry.json enthaelt alle Koeder + SHA-256 ueber den kanonischen
  Datensatz. Die Datei wird committet: Die Git-Historie datiert damit
  beweiskraeftig, dass die Eintraege zu diesem Zeitpunkt bereits existierten.

VERWENDUNG
  python3 create_canaries.py --dry-run   # zeigt nur an, was angelegt wuerde
  python3 create_canaries.py --apply     # legt an (einmalig!)
  python3 verify_canaries.py             # prueft Unsichtbarkeit + Bestand
"""
import json, subprocess, sys, hashlib, random, string, datetime

PROJ = "markendetektive-895f7"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJ}/databases/(default)/documents"
APPLY = "--apply" in sys.argv

FIKTIVER_HERSTELLER = "Krellhofer Lebensmittelwerke GmbH"
HERSTELLER_ID = "krellhofer_lw_ref"          # Doc-ID in hersteller_new

# Erfundene Produkte: klingen plausibel, existieren nicht. Der Name steht
# bewusst in `bezeichnung` (NICHT `name`) - unsere App liest ausschliesslich
# `name`, ein Massen-Dump kopiert dagegen alle Felder.
KOEDER = [
    ("2911000000017", "Alpengut Bergkaese wuerzig 200g",      "Kaese, Hartkaese"),
    ("2911000000024", "Hafergold Knuspermuesli Nuss 500g",    "Muesli, Fruehstueck"),
    ("2911000000031", "Talblick Bio-Vollmilch 3,8% 1l",       "Milch, Molkereiprodukte"),
    ("2911000000048", "Sonnenfeld Rapsoel nativ 750ml",       "Speiseoel"),
    ("2911000000055", "Wiesengruen Kraeuterquark 250g",       "Quark, Molkereiprodukte"),
    ("2911000000062", "Ofenfrisch Dinkelbrot geschnitten",    "Brot, Backwaren"),
    ("2911000000079", "Frostklar Rahmspinat portioniert",     "Tiefkuehl, Gemuese"),
    ("2911000000086", "Zartschmelz Nussnougatcreme 400g",     "Brotaufstrich, Suesswaren"),
    ("2911000000093", "Klarquell Mineralwasser still 1,5l",   "Wasser, Getraenke"),
    ("2911000000109", "Herzhaft Gemuesebruehe koernig 250g",  "Wuerzmittel"),
    ("2911000000116", "Seidenpflege Duschgel Sensitiv 300ml", "Koerperpflege, Drogerie"),
    ("2911000000123", "Reinweiss Vollwaschmittel Pulver 1,3kg","Waschmittel, Drogerie"),
]

def docid(n=20):
    return "".join(random.choices(string.ascii_letters + string.digits, k=n))

def token():
    return subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()

def firestore(method, path, body=None, tok=None):
    cmd = ["curl", "-s", "--max-time", "30", "-X", method,
           "-H", f"Authorization: Bearer {tok}", "-H", "Content-Type: application/json",
           f"{BASE}/{path}"]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    return json.loads(subprocess.check_output(cmd).decode() or "{}")

def main():
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    random.seed()
    eintraege = []
    for ean, bez, beschr in KOEDER:
        eintraege.append({"doc_id": docid(), "ean": ean, "bezeichnung": bez, "beschreibung": beschr})

    if not APPLY:
        print("VORSCHAU (nichts wird geschrieben) - mit --apply ausfuehren\n")
        print(f"  hersteller_new/{HERSTELLER_ID}  ->  {FIKTIVER_HERSTELLER}")
        for e in eintraege:
            print(f"  produkte/{e['doc_id']}  EAN {e['ean']}  {e['bezeichnung']}")
        return

    tok = token()

    # 1) Fiktiver Hersteller
    firestore("PATCH", f"hersteller_new/{HERSTELLER_ID}", {
        "fields": {
            "name": {"stringValue": FIKTIVER_HERSTELLER},
            "created_at": {"timestampValue": stamp},
        }
    }, tok)
    print(f"  angelegt: hersteller_new/{HERSTELLER_ID} ({FIKTIVER_HERSTELLER})")

    # 2) Koeder-Produkte (bewusst OHNE name/kategorie/discounter/preis/stufe)
    href = f"projects/{PROJ}/databases/(default)/documents/hersteller_new/{HERSTELLER_ID}"
    for e in eintraege:
        firestore("PATCH", f"produkte/{e['doc_id']}", {
            "fields": {
                "EANs": {"arrayValue": {"values": [{"stringValue": e["ean"]}]}},
                "bezeichnung": {"stringValue": e["bezeichnung"]},
                "beschreibung": {"stringValue": e["beschreibung"]},
                "hersteller": {"referenceValue": href},
                "created_at": {"timestampValue": stamp},
                "addedby": {"stringValue": "import"},
            }
        }, tok)
        print(f"  angelegt: produkte/{e['doc_id']}  EAN {e['ean']}")

    kanonisch = json.dumps({"hersteller": FIKTIVER_HERSTELLER, "eintraege": eintraege},
                           sort_keys=True, ensure_ascii=False)
    registry = {
        "erstellt_am": stamp,
        "zweck": "Nachweis von Datenkopien aus der MarkenDetektive-Produktdatenbank",
        "fiktiver_hersteller": {"doc": f"hersteller_new/{HERSTELLER_ID}", "name": FIKTIVER_HERSTELLER},
        "eintraege": eintraege,
        "sha256": hashlib.sha256(kanonisch.encode()).hexdigest(),
        "hinweis": "Diese Datei ist das Beweismittel. Nicht veroeffentlichen. "
                   "Der Git-Commit dieser Datei datiert die Existenz der Eintraege.",
    }
    with open(__file__.replace("create_canaries.py", "canary_registry.json"), "w") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)
    print(f"\n  Registry geschrieben, SHA-256: {registry['sha256'][:32]}...")

if __name__ == "__main__":
    main()
