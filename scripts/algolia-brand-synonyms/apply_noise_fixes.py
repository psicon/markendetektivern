#!/usr/bin/env python3
"""Noise-Fixes auf die Kategorie-Rückfälle anwenden: 3 schärfen, 4 entfernen. schokolade bleibt."""
import json, urllib.request, ssl, os, hashlib, time
SSL=ssl.create_default_context(); SSL.check_hostname=False; SSL.verify_mode=ssl.CERT_NONE
OUT=os.path.dirname(os.path.abspath(__file__))
APP="Y0KKZHT49Q"; ADMIN="6513c383e437bb744db65c43898d9a64"; INDICES=["produkte","markenProdukte"]
H={"X-Algolia-Application-Id":APP,"X-Algolia-API-Key":ADMIN,"Content-Type":"application/json"}
def oid(inp): return "mdcat_"+hashlib.sha1(inp.lower().encode()).hexdigest()[:14]
def req(method,url,data=None):
    r=urllib.request.Request(url,data=(json.dumps(data).encode() if data is not None else None),headers=H,method=method)
    return json.loads(urllib.request.urlopen(r,timeout=60,context=SSL).read())

REFINE={"nüsse":"nussmischung","kakao":"trinkkakao","erfrischungsgetränk":"energydrink"}
REMOVE={"würze","eis","eintopf","wein"}

rows=json.load(open(f"{OUT}/categories_final.json"))
allrows=rows["good"]+rows["weak"]
refine_syns=[]; remove_ids=[]; refined_terms=[]; removed_terms=[]
for r in allrows:
    kw=r["chosen"]
    if kw in REFINE:
        refine_syns.append({"objectID":oid(r["term"]),"type":"oneWaySynonym","input":r["term"],"synonyms":[REFINE[kw]]})
        refined_terms.append((r["term"],kw,REFINE[kw]))
    elif kw in REMOVE:
        remove_ids.append(oid(r["term"])); removed_terms.append((r["term"],kw))

print(f"  Refine: {len(refine_syns)} | Remove: {len(remove_ids)}")
for idx in INDICES:
    if refine_syns:
        req("POST",f"https://{APP}.algolia.net/1/indexes/{idx}/synonyms/batch?replaceExistingSynonyms=false",refine_syns)
    for o in remove_ids:
        try: req("DELETE",f"https://{APP}.algolia.net/1/indexes/{idx}/synonyms/{o}")
        except Exception: pass
    print(f"  ✅ {idx}: {len(refine_syns)} geschärft, {len(remove_ids)} entfernt")
print("  Refined:", refined_terms)
print("  Removed:", removed_terms)
