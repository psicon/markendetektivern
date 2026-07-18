#!/usr/bin/env python3
"""Query applied terms against Algolia (merged both indices) and report nbHits — before/after proof."""
import json, urllib.request, ssl, os, sys
SSLCTX = ssl.create_default_context(); SSLCTX.check_hostname=False; SSLCTX.verify_mode=ssl.CERT_NONE
OUT = os.path.dirname(os.path.abspath(__file__))
APP="Y0KKZHT49Q"; KEY="6513c383e437bb744db65c43898d9a64"
label = sys.argv[1] if len(sys.argv)>1 else "snapshot"

def hits(term):
    tot=0
    for idx in ("produkte","markenProdukte"):
        url=f"https://{APP}-dsn.algolia.net/1/indexes/{idx}/query"
        body=json.dumps({"query":term,"hitsPerPage":0}).encode()
        req=urllib.request.Request(url,data=body,headers={"X-Algolia-Application-Id":APP,"X-Algolia-API-Key":KEY,"Content-Type":"application/json"})
        tot+=json.loads(urllib.request.urlopen(req,timeout=30,context=SSLCTX).read()).get("nbHits",0)
    return tot

terms=[s["input"] for s in json.load(open(f"{OUT}/applied_synonyms.json"))]
res={t:hits(t) for t in terms}
json.dump(res,open(f"{OUT}/ba_{label}.json","w"),ensure_ascii=False)
nonzero=sum(1 for v in res.values() if v>0)
print(f"═══ {label}: {nonzero}/{len(terms)} Begriffe finden jetzt Produkte ═══")
for t in sorted(res,key=lambda x:-res[x])[:20]:
    print(f"  {res[t]:>5}  {t}")

# compare if both snapshots exist
if os.path.exists(f"{OUT}/ba_before.json") and os.path.exists(f"{OUT}/ba_after.json"):
    b=json.load(open(f"{OUT}/ba_before.json")); a=json.load(open(f"{OUT}/ba_after.json"))
    fixed=[t for t in a if b.get(t,0)==0 and a[t]>0]
    print(f"\n  ▶ {len(fixed)}/{len(a)} Begriffe: 0 → >0 Treffer (vorher tot, jetzt findbar)")
