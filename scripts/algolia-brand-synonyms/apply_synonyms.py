#!/usr/bin/env python3
"""Apply verified brand-synonyms to Algolia (additiv, idempotent, one-way term->refID).
Reads finalKeepTerms from wf_result.json + candidate ids from candidates.json.
Usage: python3 apply_synonyms.py [--dry]  (default dry-run; pass --apply to write)"""
import json, urllib.request, ssl, os, sys, re, unicodedata
SSLCTX = ssl.create_default_context(); SSLCTX.check_hostname=False; SSLCTX.verify_mode=ssl.CERT_NONE
OUT = os.path.dirname(os.path.abspath(__file__))
APP="Y0KKZHT49Q"; ADMIN="6513c383e437bb744db65c43898d9a64"
INDICES=["produkte","markenProdukte"]
APPLY = "--apply" in sys.argv

def slug(s):
    s=unicodedata.normalize("NFKD",s).encode("ascii","ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+","_",s).strip("_")

def post(index, arr):
    url=f"https://{APP}.algolia.net/1/indexes/{index}/synonyms/batch?replaceExistingSynonyms=false"
    req=urllib.request.Request(url,data=json.dumps(arr).encode(),
        headers={"X-Algolia-Application-Id":APP,"X-Algolia-API-Key":ADMIN,"Content-Type":"application/json"})
    return json.loads(urllib.request.urlopen(req,timeout=60,context=SSLCTX).read())

cands={r["term"]:r for r in json.load(open(f"{OUT}/candidates.json"))["valid"]}
keep=json.load(open(f"{OUT}/wf_result.json"))["finalKeepTerms"]

syns=[]
skipped=[]
for term in keep:
    c=cands.get(term)
    if not c: skipped.append(term); continue
    syns.append({"objectID":f"mdsyn_{slug(term)}","type":"oneWaySynonym",
                 "input":term,"synonyms":[c["id"]],
                 "_ref":f"{c['col']}:{c['refname']}","_prod":c["tot"]})

print(f"═══ {len(syns)} Synonyme vorbereitet ({len(skipped)} ohne Kandidat übersprungen) ═══")
for s in syns[:12]:
    print(f"  {s['input']:<22} → {s['synonyms'][0]}  ({s['_ref'][:40]}, {s['_prod']} Prod)")
print(f"  … +{max(0,len(syns)-12)} weitere")

# strip internal _fields before pushing
clean=[{k:v for k,v in s.items() if not k.startswith("_")} for s in syns]

if not APPLY:
    print("\n  DRY-RUN. Zum Anwenden: python3 apply_synonyms.py --apply")
    json.dump(syns,open(f"{OUT}/applied_synonyms.json","w"),ensure_ascii=False)
else:
    for idx in INDICES:
        r=post(idx,clean)
        print(f"  ✅ {idx}: taskID {r.get('taskID')} — {len(clean)} Synonyme geschrieben")
    json.dump(syns,open(f"{OUT}/applied_synonyms.json","w"),ensure_ascii=False)
    print(f"\n  → {len(clean)} Synonyme LIVE auf beiden Indizes. Rollback: python3 rollback_synonyms.py")
