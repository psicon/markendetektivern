#!/usr/bin/env python3
"""Umfassender Matcher: ALLE freq>=3 Fehl-Suchen → beste Ref (exact/brand-core/subset/fuzzy)
→ gegen echte Produkt-Existenz (Algolia, ref-id gecacht). Output: neue Synonym-Kandidaten +
Re-Check der bestehenden 189 + Gap-Buckets."""
import json, urllib.request, ssl, os, unicodedata, difflib, csv, time
SSL=ssl.create_default_context(); SSL.check_hostname=False; SSL.verify_mode=ssl.CERT_NONE
OUT=os.path.dirname(os.path.abspath(__file__))
APP="Y0KKZHT49Q"; KEY="6513c383e437bb744db65c43898d9a64"

def norm(s):
    s=unicodedata.normalize("NFKD",s or "").encode("ascii","ignore").decode().lower().strip()
    return " ".join(s.split())

PRODUCT_WORDS={"schokolade","schoko","ketchup","pesto","joghurt","jogurt","milchreis","waschmittel",
"weichspueler","weichspuler","fischstaebchen","fischstabchen","chips","kaffee","kaffe","cola","wasser",
"kaese","kase","butter","milch","sahne","quark","riegel","tee","saft","bier","senf","salat","brot",
"muesli","musli","creme","shampoo","deo","erdnuesse","erdnusse","country","bio","tabs","pizza","nudeln",
"pasta","mehl","zucker","salz","oel","ol","limo","eis","fruchtgummi","gummibaerchen","spaghetti",
"toilettenpapier","taschentuecher","windeln","reiniger","spuelmittel","duschgel","zahnpasta","gel",
"sticks","flakes","muesliriegel","proteinriegel","dressing","mayonnaise","suppe","brühe","brue","br12"}

refs={c:json.load(open(f"{OUT}/refs_{c}.json")) for c in ("hersteller","hersteller_new","handelsmarken","kategorien")}
name_index={}
for col,lst in refs.items():
    for e in lst:
        n=norm(e["name"])
        if len(n)>=2: name_index.setdefault(n,[]).append((col,e["id"],e["name"]))
all_names=list(name_index.keys())
tokensets=[(n,set(n.split())) for n in all_names]

def variants(term):
    t=norm(term); toks=t.split(); c=[t]
    if len(toks)>1:
        core=[w for w in toks if w not in PRODUCT_WORDS]
        if core and core!=toks: c.append(" ".join(core))
        if toks[0] not in PRODUCT_WORDS: c.append(toks[0])
    return list(dict.fromkeys(c))

def find_ref(term):
    for cand in variants(term):
        if cand in name_index: return name_index[cand][0],"exact",cand
        ct=set(cand.split())
        subs=[(n,name_index[n][0]) for n,ts in tokensets if ct and ct.issubset(ts) and len(cand)>=4 and (len(ct)>1 or len(cand)>=5)]
        if subs: subs.sort(key=lambda x:len(x[0])); return subs[0][1],"subset",subs[0][0]
        fz=difflib.get_close_matches(cand,all_names,n=1,cutoff=0.86)
        if fz: return name_index[fz[0]][0],"fuzzy",fz[0]
    return None,None,None

_cache={}
def prod_check(refid):
    if refid in _cache: return _cache[refid]
    tot=0; samples=[]
    for idx in ("produkte","markenProdukte"):
        try:
            url=f"https://{APP}-dsn.algolia.net/1/indexes/{idx}/query"
            body=json.dumps({"query":refid,"hitsPerPage":3,"attributesToRetrieve":["name"]}).encode()
            req=urllib.request.Request(url,data=body,headers={"X-Algolia-Application-Id":APP,"X-Algolia-API-Key":KEY,"Content-Type":"application/json"})
            d=json.loads(urllib.request.urlopen(req,timeout=15,context=SSL).read())
            tot+=d.get("nbHits",0); samples+=[h.get("name") for h in d.get("hits",[]) if h.get("name")]
        except Exception: pass
    _cache[refid]=(tot,samples[:3]); time.sleep(0.01); return _cache[refid]

terms=[]
with open("/tmp/all_failing.csv") as f:
    r=csv.reader(f); next(r,None)
    for row in r:
        if len(row)>=2: terms.append((row[0],int(row[1])))

applied={s["input"].lower() for s in json.load(open(f"{OUT}/applied_synonyms.json"))}

cand=[]; gap_ref=[]; gap_none=[]
for i,(term,freq) in enumerate(terms):
    refinfo,how,via=find_ref(term)
    if not refinfo: gap_none.append({"term":term,"freq":freq}); continue
    col,rid,rname=refinfo
    prod,samples=prod_check(rid)
    row={"term":term,"freq":freq,"col":col,"id":rid,"ref":rname,"via":via,"match":how,"prod":prod,"samples":samples,"already":term in applied}
    if prod>0: cand.append(row)
    else: gap_ref.append(row)

cand.sort(key=lambda x:-x["freq"])
new_cand=[c for c in cand if not c["already"]]
existing_cov=[c for c in cand if c["already"]]
json.dump({"new":new_cand,"existing_covered":existing_cov,"gap_ref":gap_ref,"gap_none":gap_none},
          open(f"{OUT}/comprehensive.json","w"),ensure_ascii=False)
print(f"═══ UMFASSEND: {len(terms)} Begriffe (freq>=3) ═══")
print(f"  ✅ NEUE Synonym-Kandidaten (Ref hat Produkte, nicht schon applied): {len(new_cand)} ({sum(c['freq'] for c in new_cand)} Events)")
print(f"  ↺ schon durch applied Synonym abgedeckt:                            {len(existing_cov)}")
print(f"  ⚠️  Ref existiert, 0 Produkte (Katalog-Lücke, import/link):          {len(gap_ref)} ({sum(c['freq'] for c in gap_ref)} Events)")
print(f"  ❌ keine Ref (Marke fehlt / Long-Tail):                              {len(gap_none)} ({sum(c['freq'] for c in gap_none)} Events)")
print(f"  (unique refs geprüft: {len(_cache)})")
print(f"\n─── NEUE Kandidaten Top 40 ───")
for c in new_cand[:40]:
    print(f"  {c['freq']:>4}× {c['term']:<22} → {c['col'][:4]}:{c['ref'][:24]:<24} ({c['prod']} P,{c['match'][:3]}) {(c['samples'][0] if c['samples'] else '')[:28]}")
