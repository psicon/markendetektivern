#!/usr/bin/env python3
"""Build the catalog-gap wishlist from the workflow gapTriage + candidate gap list + freqs."""
import json, os
OUT = os.path.dirname(os.path.abspath(__file__))
wf=json.load(open(f"{OUT}/wf_result_raw.json"))
cand=json.load(open(f"{OUT}/candidates.json"))
nomatch_freq={t:n for t,n in json.load(open(f"{OUT}/match_result.json"))["nomatch"]}

triage=wf.get("gapTriage",[])
for r in triage: r["freq"]=nomatch_freq.get(r["term"],0)

def bucket(cat): return [r for r in triage if r["category"]==cat]
labels={"marke_fehlt":"🏷️  MARKEN die fehlen (Katalog-Wunschliste)",
        "kategorie_oder_typ":"📦 KATEGORIEN/Produktarten (Suche funktioniert nicht ohne Treffer)",
        "non_food_drogerie":"🧴 DROGERIE/Non-Food",
        "discounter_name":"🏪 DISCOUNTER-Namen",
        "tippfehler":"⌨️  Tippfehler","generisch":"… generisch","unklar":"… unklar"}

print("═══════════ KATALOG-LÜCKEN — nachfrage-priorisiert ═══════════")
for cat in ("marke_fehlt","kategorie_oder_typ","non_food_drogerie","discounter_name"):
    rows=sorted(bucket(cat),key=lambda r:-r["freq"])
    if not rows: continue
    tot=sum(r["freq"] for r in rows)
    print(f"\n{labels[cat]}  — {len(rows)} Begriffe, {tot} Such-Events")
    for r in rows[:25]:
        note=f"  ({r['note']})" if r.get("note") else ""
        print(f"   {r['freq']:>4}×  {r['term']}{note}")

# refs that exist but have 0 products
gap=sorted(cand["gap"],key=lambda r:-r["freq"])
print(f"\n\n⚠️  REF EXISTIERT, aber 0 PRODUKTE — {len(gap)} Marken (importieren/verlinken lohnt sofort)")
for r in gap[:30]:
    print(f"   {r['freq']:>4}×  {r['term']:<22} (angelegt als {r['col']}:{r.get('ref') or r.get('refname')})")
