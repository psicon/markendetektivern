#!/usr/bin/env python3
"""Rollback der von uns angelegten Algolia-Synonyme. Zwei Tiers:
  mdsyn_ = Marken-Synonyme (Begriff → echte Marken-Produkte)
  mdcat_ = Kategorie-Rückfall (Marke ohne Katalog → Produkttyp-Kategorie)
Usage:
  python3 rollback_synonyms.py            # löscht BEIDE Tiers (voller Rollback)
  python3 rollback_synonyms.py mdcat_     # löscht NUR die Kategorie-Rückfälle
  python3 rollback_synonyms.py mdsyn_     # löscht NUR die Marken-Synonyme
Andere (Nicht-md*)-Synonyme bleiben immer unangetastet."""
import json, urllib.request, ssl, sys
SSL=ssl.create_default_context(); SSL.check_hostname=False; SSL.verify_mode=ssl.CERT_NONE
APP="Y0KKZHT49Q"; ADMIN="6513c383e437bb744db65c43898d9a64"
INDICES=["produkte","markenProdukte"]
H={"X-Algolia-Application-Id":APP,"X-Algolia-API-Key":ADMIN,"Content-Type":"application/json"}
PREFIXES=[sys.argv[1]] if len(sys.argv)>1 else ["mdsyn_","mdcat_"]

def req(method,url,data=None):
    r=urllib.request.Request(url,data=(json.dumps(data).encode() if data is not None else None),headers=H,method=method)
    return json.loads(urllib.request.urlopen(r,timeout=60,context=SSL).read())

for idx in INDICES:
    for pref in PREFIXES:
        ids=[]; page=0
        while True:
            res=req("POST",f"https://{APP}.algolia.net/1/indexes/{idx}/synonyms/search",{"query":pref,"page":page,"hitsPerPage":100})
            ids+=[h["objectID"] for h in res.get("hits",[]) if h.get("objectID","").startswith(pref)]
            if (page+1)*100>=res.get("nbHits",0): break
            page+=1
        for oid in set(ids): req("DELETE",f"https://{APP}.algolia.net/1/indexes/{idx}/synonyms/{oid}")
        print(f"  {idx}: {len(set(ids))} {pref}-Synonyme gelöscht")
print("  Rollback fertig.")
