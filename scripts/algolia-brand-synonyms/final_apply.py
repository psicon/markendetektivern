#!/usr/bin/env python3
"""Konsolidiertes finales Apply: base-keeps + Varianten, EINDEUTIGE objectIDs pro exaktem Input.
Rollback aller mdsyn_ zuerst (clean slate), dann Apply. Idempotent & kollisionsfrei."""
import json, urllib.request, ssl, os, hashlib, time
SSL=ssl.create_default_context();SSL.check_hostname=False;SSL.verify_mode=ssl.CERT_NONE
OUT=os.path.dirname(os.path.abspath(__file__))
APP="Y0KKZHT49Q";ADMIN="6513c383e437bb744db65c43898d9a64";INDICES=["produkte","markenProdukte"]
H={"X-Algolia-Application-Id":APP,"X-Algolia-API-Key":ADMIN,"Content-Type":"application/json"}
def req(method,url,data=None):
    r=urllib.request.Request(url,data=(json.dumps(data).encode() if data is not None else None),headers=H,method=method)
    return json.loads(urllib.request.urlopen(r,timeout=60,context=SSL).read())

cands={r["term"]:r for r in json.load(open(f"{OUT}/candidates.json"))["valid"]}
keep=json.load(open(f"{OUT}/wf_result.json"))["finalKeepTerms"]
variants={"gut und günstig":"gut&günstig","arla skyr":"arla","ültje erdnüsse":"ültje",
          "chipsfrisch":"funny frisch","tempo taschentücher":"tempos","edeka bio":"edeka bio"}

# input -> id  (exakter Input eindeutig; Varianten reuse geprüfter Marken-IDs)
pairs={}
for t in keep:
    c=cands.get(t)
    if c: pairs[t]=c
for t,src in variants.items():
    c=cands.get(src)
    if c and t not in pairs: pairs[t]=c

def oid(inp): return "mdsyn_"+hashlib.sha1(inp.lower().encode()).hexdigest()[:14]
syns=[{"objectID":oid(t),"type":"oneWaySynonym","input":t,"synonyms":[c["id"]]} for t,c in pairs.items()]
# objectID-Eindeutigkeit garantieren
assert len({s["objectID"] for s in syns})==len(syns), "objectID-Kollision!"
print(f"  {len(syns)} eindeutige Synonyme (aus {len(keep)} keeps + {len(variants)} Varianten, dedupliziert)")

# 1) Rollback aller alten mdsyn_
for idx in INDICES:
    ids=[];page=0
    while True:
        res=req("POST",f"https://{APP}.algolia.net/1/indexes/{idx}/synonyms/search",{"query":"mdsyn_","page":page,"hitsPerPage":100})
        ids+=[h["objectID"] for h in res.get("hits",[]) if h.get("objectID","").startswith("mdsyn_")]
        if (page+1)*100>=res.get("nbHits",0): break
        page+=1
    for o in set(ids): req("DELETE",f"https://{APP}.algolia.net/1/indexes/{idx}/synonyms/{o}")
    print(f"  {idx}: {len(set(ids))} alte mdsyn_ entfernt")
time.sleep(3)
# 2) Apply frisch
for idx in INDICES:
    r=req("POST",f"https://{APP}.algolia.net/1/indexes/{idx}/synonyms/batch?replaceExistingSynonyms=false",syns)
    print(f"  ✅ {idx}: {len(syns)} geschrieben (task {r.get('taskID')})")
json.dump([{k:v for k,v in s.items()} for s in syns],open(f"{OUT}/applied_synonyms.json","w"),ensure_ascii=False)
print(f"\n  → {len(syns)} Synonyme LIVE, kollisionsfrei.")
