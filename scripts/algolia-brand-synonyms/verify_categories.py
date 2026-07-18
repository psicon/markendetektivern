#!/usr/bin/env python3
"""Kategorie-Keywords auf Abdeckung prüfen, präzise vs breit wählen, Review-Tabelle + Apply-Set bauen."""
import json, urllib.request, ssl, os, glob
SSL=ssl.create_default_context(); SSL.check_hostname=False; SSL.verify_mode=ssl.CERT_NONE
OUT=os.path.dirname(os.path.abspath(__file__))
APP="Y0KKZHT49Q"; KEY="6513c383e437bb744db65c43898d9a64"
wf=json.load(open(glob.glob(f"{os.path.dirname(OUT)}/tasks/wsaivefql.output")[0]))["result"]["results"]
freq={t["term"]:t["freq"] for t in json.load(open(f"{OUT}/gap_targets.json"))}

_c={}
def cov(w):
    if not w: return 0
    if w in _c: return _c[w]
    tot=0
    for idx in ("produkte","markenProdukte"):
        try:
            url=f"https://{APP}-dsn.algolia.net/1/indexes/{idx}/query"
            body=json.dumps({"query":w,"hitsPerPage":0}).encode()
            req=urllib.request.Request(url,data=body,headers={"X-Algolia-Application-Id":APP,"X-Algolia-API-Key":KEY,"Content-Type":"application/json"})
            tot+=json.loads(urllib.request.urlopen(req,timeout=15,context=SSL).read()).get("nbHits",0)
        except Exception: pass
    _c[w]=tot; return tot

rows=[]
# dedupe by term
seen=set()
for r in wf:
    t=r["term"]
    if t in seen or r.get("skip"): continue
    seen.add(t)
    kw=r.get("keyword","").strip().lower(); alt=(r.get("alt","") or "").strip().lower()
    ck,ca=cov(kw),cov(alt)
    # wähle: präferiere keyword wenn >=15, sonst das mit mehr Abdeckung
    if ck>=15: chosen,ccov=kw,ck
    elif ca>ck: chosen,ccov=alt,ca
    else: chosen,ccov=kw,ck
    rows.append({"term":t,"freq":freq.get(t,0),"brand":r.get("brand",""),"keyword":kw,"kcov":ck,
                 "alt":alt,"acov":ca,"chosen":chosen,"cov":ccov})
rows.sort(key=lambda x:-x["freq"])
good=[r for r in rows if r["cov"]>=8]      # brauchbare Abdeckung
weak=[r for r in rows if 0<r["cov"]<8]     # sehr dünn
zero=[r for r in rows if r["cov"]==0]      # Keyword findet auch nichts
json.dump({"good":good,"weak":weak,"zero":zero},open(f"{OUT}/categories_final.json","w"),ensure_ascii=False)
print(f"═══ KATEGORIE-RÜCKFALL — Ergebnis ═══")
print(f"  mapped (non-skip): {len(rows)} | ✅ gute Abdeckung(≥8): {len(good)} | 🟡 dünn(<8): {len(weak)} | ❌ Keyword leer(0): {len(zero)}")
print(f"  gute decken {sum(r['freq'] for r in good)} Such-Events ab\n")
print("─── ✅ Top 45 (Marke → Kategorie → Treffer) ───")
for r in good[:45]:
    print(f"  {r['freq']:>4}× {r['term']:<20} → {r['chosen']:<20} ({r['cov']:>4} Prod)")
print("\n─── 🟡 dünne Abdeckung (Kategorie stimmt, aber wenig Katalog) ───")
for r in weak[:15]:
    print(f"  {r['freq']:>4}× {r['term']:<20} → {r['chosen']:<20} ({r['cov']} Prod)")
