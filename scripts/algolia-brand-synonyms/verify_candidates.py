#!/usr/bin/env python3
"""For each matched term->refid, EMPIRICALLY test: does the raw ID surface products in Algolia?
Only IDs with >0 hits become valid synonyms. Also pulls sample product names for relevance judgement."""
import json, urllib.request, ssl, os, time
SSLCTX = ssl.create_default_context(); SSLCTX.check_hostname=False; SSLCTX.verify_mode=ssl.CERT_NONE
OUT = os.path.dirname(os.path.abspath(__file__))
APP="Y0KKZHT49Q"; KEY="6513c383e437bb744db65c43898d9a64"

def aq(index, q, hpp=5):
    url=f"https://{APP}-dsn.algolia.net/1/indexes/{index}/query"
    body=json.dumps({"query":q,"hitsPerPage":hpp,"attributesToRetrieve":["name"]}).encode()
    req=urllib.request.Request(url,data=body,headers={"X-Algolia-Application-Id":APP,"X-Algolia-API-Key":KEY,"Content-Type":"application/json"})
    d=json.loads(urllib.request.urlopen(req,timeout=30,context=SSLCTX).read())
    return d.get("nbHits",0),[h.get("name") for h in d.get("hits",[])]

m=json.load(open(f"{OUT}/match_result.json"))
cands={}
for bucket in ("exact","fuzzy","subset"):
    for entry in m[bucket]:
        term,n,matches=entry[0],entry[1],entry[2]
        ids=[]
        if bucket=="exact":
            for (col,i,name) in matches: ids.append((col,i,name))
        else:
            for (nn,lst) in matches:
                for (col,i,name) in lst: ids.append((col,i,name))
        # de-dup ids
        seen=set(); uids=[]
        for c in ids:
            if c[1] not in seen: seen.add(c[1]); uids.append(c)
        cands[term]=(n,uids,bucket)

valid=[]; gap=[]
for term,(n,ids,bucket) in sorted(cands.items(),key=lambda x:-x[1][0]):
    best=None
    for (col,i,name) in ids:
        try:
            npd,sp=aq("produkte",i); nmk,sm=aq("markenProdukte",i)
        except Exception:
            npd,sp,nmk,sm=0,[],0,[]
        tot=npd+nmk
        cand={"col":col,"id":i,"refname":name,"nb_prod":npd,"nb_marken":nmk,"tot":tot,"samples":[x for x in (sp+sm) if x][:5]}
        if best is None or tot>best["tot"]: best=cand
        time.sleep(0.02)
    row={"term":term,"freq":n,"bucket":bucket,**best}
    (valid if best["tot"]>0 else gap).append(row)

valid.sort(key=lambda r:-r["freq"]); gap.sort(key=lambda r:-r["freq"])
json.dump({"valid":valid,"gap":gap},open(f"{OUT}/candidates.json","w"),ensure_ascii=False)

vsum=sum(r["freq"] for r in valid); gsum=sum(r["freq"] for r in gap)
print(f"═══ EMPIRISCHE PRÜFUNG ({len(cands)} gematchte Begriffe) ═══")
print(f"  ✅ VALID  (Ref-ID bringt Produkte → Synonym wirkt): {len(valid)} Begriffe, {vsum} Such-Events")
print(f"  ⚠️  0-HITS (Ref existiert, aber KEINE Produkte):     {len(gap)} Begriffe, {gsum} Events\n")
print(f"─── ✅ VALID — diese Synonyme wirken sofort (Top 55) ───")
print(f"  {'freq':>5} {'term':<20} {'→ Produkte':>10}  Sample-Produkte")
for r in valid[:55]:
    s=", ".join(r["samples"][:2])[:52]
    print(f"  {r['freq']:>5} {r['term']:<20} {r['tot']:>10}  [{r['col'][:4]}] {s}")
print(f"\n─── ⚠️  Ref existiert, aber 0 Produkte (Katalog-Lücke trotz Ref, Top 20) ───")
for r in gap[:20]:
    print(f"  {r['freq']:>5} {r['term']:<20} ref={r['col']}:{r['refname'][:30]}")
print(f"\n  → candidates.json geschrieben")
