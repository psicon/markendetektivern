#!/usr/bin/env python3
"""857 neue verifizierte Synonyme ADDITIV einspielen (bestehende 189 unberührt).
Usage: python3 apply_857.py --apply  (ohne Flag = dry-run)"""
import json, urllib.request, ssl, os, sys, hashlib, unicodedata, re, time
SSL=ssl.create_default_context(); SSL.check_hostname=False; SSL.verify_mode=ssl.CERT_NONE
OUT=os.path.dirname(os.path.abspath(__file__))
APP="Y0KKZHT49Q"; ADMIN="6513c383e437bb744db65c43898d9a64"; INDICES=["produkte","markenProdukte"]
APPLY="--apply" in sys.argv
def oid(inp): return "mdsyn_"+hashlib.sha1(inp.lower().encode()).hexdigest()[:14]
def post(idx,arr):
    url=f"https://{APP}.algolia.net/1/indexes/{idx}/synonyms/batch?replaceExistingSynonyms=false"
    r=urllib.request.Request(url,data=json.dumps(arr).encode(),headers={"X-Algolia-Application-Id":APP,"X-Algolia-API-Key":ADMIN,"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(r,timeout=60,context=SSL).read()).get("taskID")

apply_set=json.load(open(f"{OUT}/final_result.json"))["apply"]
# dedupe by objectID (falls zwei Terme gleich normalisieren)
seen={}; syns=[]
for k in apply_set:
    o=oid(k["term"])
    if o in seen: continue
    seen[o]=1
    syns.append({"objectID":o,"type":"oneWaySynonym","input":k["term"],"synonyms":[k["id"]]})
print(f"  {len(syns)} eindeutige Synonyme aus {len(apply_set)} Kandidaten")
if not APPLY:
    print("  DRY-RUN. --apply zum Einspielen."); sys.exit()
for idx in INDICES:
    print(f"  ✅ {idx}: task {post(idx,syns)} — {len(syns)} additiv geschrieben")
# bestehende Gesamtzahl checken
time.sleep(2)
for idx in INDICES:
    r=urllib.request.Request(f"https://{APP}.algolia.net/1/indexes/{idx}/synonyms/search",data=json.dumps({"query":"mdsyn_","hitsPerPage":1}).encode(),headers={"X-Algolia-Application-Id":APP,"X-Algolia-API-Key":ADMIN,"Content-Type":"application/json"})
    n=json.loads(urllib.request.urlopen(r,timeout=30,context=SSL).read()).get("nbHits")
    print(f"  {idx}: jetzt {n} mdsyn_-Synonyme live")
