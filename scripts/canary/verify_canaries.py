#!/usr/bin/env python3
"""Prueft: (1) Koeder existieren, (2) sind in der App unsichtbar, (3) sind in
einem Roh-Dump sichtbar (= Falle scharf). Regelmaessig laufen lassen."""
import json, subprocess, os, sys

PROJ = "markendetektive-895f7"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJ}/databases/(default)"
HERE = os.path.dirname(os.path.abspath(__file__))
REG  = json.load(open(os.path.join(HERE, "canary_registry.json")))
ALGOLIA_APP, ALGOLIA_SEARCH = "Y0KKZHT49Q", "b87bb9ffcda4b4b3e3161e155e29869e"

def tok():
    return subprocess.check_output(["gcloud","auth","print-access-token"]).decode().strip()

def curl(args):
    return subprocess.check_output(["curl","-s","--max-time","30"]+args).decode()

t = tok()
ids  = [e["doc_id"] for e in REG["eintraege"]]
eans = [e["ean"]    for e in REG["eintraege"]]
ok = True

# 1) Existenz
vorhanden = 0
for i in ids:
    r = json.loads(curl(["-H", f"Authorization: Bearer {t}", f"{BASE}/documents/produkte/{i}"]) or "{}")
    if "fields" in r: vorhanden += 1
print(f"1) Bestand: {vorhanden}/{len(ids)} Koeder vorhanden", "OK" if vorhanden == len(ids) else "!! FEHLEN")
ok &= vorhanden == len(ids)

# 2) Unsichtbar in der App? Die App sortiert immer mit orderBy('name');
#    Firestore blendet Dokumente ohne dieses Feld dabei aus.
q = {"structuredQuery": {"from":[{"collectionId":"produkte"}],
     "orderBy":[{"field":{"fieldPath":"name"},"direction":"ASCENDING"}],"limit":20000}}
res = curl(["-X","POST","-H",f"Authorization: Bearer {t}","-H","Content-Type: application/json",
            "-d", json.dumps(q), f"{BASE}/documents:runQuery"])
namen = [x["document"]["name"].split("/")[-1] for x in json.loads(res) if "document" in x]
treffer = [i for i in ids if i in namen]
print(f"2a) App-Browse (orderBy name, {len(namen)} Produkte): {len(treffer)} Koeder sichtbar",
      "OK - unsichtbar" if not treffer else f"!! SICHTBAR: {treffer}")
ok &= not treffer

# 2b) Algolia (App-Suche)
alg_treffer = []
for ean in eans[:4]:
    r = json.loads(curl(["-X","POST",
        "-H", f"X-Algolia-Application-Id: {ALGOLIA_APP}", "-H", f"X-Algolia-API-Key: {ALGOLIA_SEARCH}",
        "-H","Content-Type: application/json","-d", json.dumps({"query":ean,"hitsPerPage":5}),
        f"https://{ALGOLIA_APP}-dsn.algolia.net/1/indexes/produkte/query"]) or "{}")
    if r.get("nbHits"): alg_treffer.append(ean)
print(f"2b) Algolia-Suche nach Koeder-EANs: {len(alg_treffer)} gefunden",
      "OK - nicht im Suchindex" if not alg_treffer else f"!! IM INDEX: {alg_treffer}")
ok &= not alg_treffer

# 2c) Selbstheilung: falls der Firestore->Algolia-Sync die Koeder erneut in den
#     Suchindex geschoben hat, hier sofort wieder entfernen (sonst waeren sie
#     in Stoebern sichtbar). Admin-Key nur lokal verwenden.
ALGOLIA_ADMIN = os.environ.get("ALGOLIA_ADMIN_KEY", "")
if alg_treffer and ALGOLIA_ADMIN:
    hdr = ["-H", f"X-Algolia-Application-Id: {ALGOLIA_APP}", "-H", f"X-Algolia-API-Key: {ALGOLIA_ADMIN}",
           "-H", "Content-Type: application/json"]
    body = {"requests": [{"action": "deleteObject", "body": {"objectID": i}} for i in ids]}
    curl(["-X","POST"]+hdr+["-d", json.dumps(body), f"https://{ALGOLIA_APP}.algolia.net/1/indexes/produkte/batch"])
    print("    -> aus dem Suchindex entfernt (ALGOLIA_ADMIN_KEY gesetzt)")
elif alg_treffer:
    print("    -> ALGOLIA_ADMIN_KEY nicht gesetzt: bitte manuell aus dem Index loeschen")


# 3) Falle scharf? Ein Roh-Dump (so wuerde ein Dieb vorgehen) muss sie enthalten.
gefunden, seite = 0, None
for _ in range(60):
    url = f"{BASE}/documents/produkte?pageSize=300" + (f"&pageToken={seite}" if seite else "")
    d = json.loads(curl(["-H", f"Authorization: Bearer {t}", url]) or "{}")
    gefunden += sum(1 for doc in d.get("documents",[]) if doc["name"].split("/")[-1] in ids)
    seite = d.get("nextPageToken")
    if not seite: break
print(f"3) Roh-Dump enthaelt {gefunden}/{len(ids)} Koeder",
      "OK - Falle scharf" if gefunden == len(ids) else "!! Falle greift nicht")
ok &= gefunden == len(ids)

print("\nGESAMT:", "alles in Ordnung" if ok else "PRUEFEN!")
sys.exit(0 if ok else 1)
