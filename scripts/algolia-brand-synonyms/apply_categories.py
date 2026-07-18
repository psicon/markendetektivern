#!/usr/bin/env python3
"""Kategorie-Rückfall-Synonyme (Marke→Produkttyp) einspielen. Eigener Tier: objectID-Prefix 'mdcat_'.
Usage: python3 apply_categories.py --apply"""
import json, urllib.request, ssl, os, sys, hashlib, time
SSL=ssl.create_default_context(); SSL.check_hostname=False; SSL.verify_mode=ssl.CERT_NONE
OUT=os.path.dirname(os.path.abspath(__file__))
APP="Y0KKZHT49Q"; ADMIN="6513c383e437bb744db65c43898d9a64"; INDICES=["produkte","markenProdukte"]
APPLY="--apply" in sys.argv
def oid(inp): return "mdcat_"+hashlib.sha1(inp.lower().encode()).hexdigest()[:14]
def post(idx,arr):
    url=f"https://{APP}.algolia.net/1/indexes/{idx}/synonyms/batch?replaceExistingSynonyms=false"
    r=urllib.request.Request(url,data=json.dumps(arr).encode(),headers={"X-Algolia-Application-Id":APP,"X-Algolia-API-Key":ADMIN,"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(r,timeout=60,context=SSL).read()).get("taskID")
d=json.load(open(f"{OUT}/categories_final.json"))
rows=d["good"]+d["weak"]   # alle korrekt-kategorie, >0 Treffer
seen={}; syns=[]
for r in rows:
    o=oid(r["term"])
    if o in seen: continue
    seen[o]=1
    syns.append({"objectID":o,"type":"oneWaySynonym","input":r["term"],"synonyms":[r["chosen"]]})
print(f"  {len(syns)} Kategorie-Rückfall-Synonyme (mdcat_)")
if not APPLY:
    print("  DRY-RUN. --apply zum Einspielen."); sys.exit()
for idx in INDICES: print(f"  ✅ {idx}: task {post(idx,syns)}")
time.sleep(2)
for idx in INDICES:
    r=urllib.request.Request(f"https://{APP}.algolia.net/1/indexes/{idx}/synonyms/search",data=json.dumps({"query":"mdcat_","hitsPerPage":1}).encode(),headers={"X-Algolia-Application-Id":APP,"X-Algolia-API-Key":ADMIN,"Content-Type":"application/json"})
    print(f"  {idx}: {json.loads(urllib.request.urlopen(r,timeout=30,context=SSL).read()).get('nbHits')} mdcat_-Synonyme live")
