#!/usr/bin/env python3
"""Dump id->name for all reference collections, then match failing search terms."""
import json, subprocess, urllib.request, urllib.parse, unicodedata, difflib, csv, os, ssl
SSLCTX = ssl.create_default_context()
SSLCTX.check_hostname = False
SSLCTX.verify_mode = ssl.CERT_NONE

PROJ = "markendetektive-895f7"
TOKEN = subprocess.check_output(["gcloud", "auth", "print-access-token"]).decode().strip()
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJ}/databases/(default)/documents"
OUT = os.path.dirname(os.path.abspath(__file__))

def norm(s):
    if not s: return ""
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()
    return " ".join(s.split())

def dump_collection(col, name_fields=("name",)):
    """Paginate a collection, return list of {id, name}."""
    out = []
    token = None
    while True:
        params = {"pageSize": "300", "mask.fieldPaths": name_fields[0]}
        if len(name_fields) > 1:
            # can't mask multiple easily via query string repeat; just fetch name
            pass
        if token: params["pageToken"] = token
        url = f"{BASE}/{col}?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
        try:
            d = json.loads(urllib.request.urlopen(req, timeout=60, context=SSLCTX).read())
        except Exception as e:
            print(f"  ! {col} page error: {e}"); break
        for doc in d.get("documents", []):
            oid = doc["name"].split("/")[-1]
            nm = None
            for f in name_fields:
                v = doc.get("fields", {}).get(f, {})
                if "stringValue" in v: nm = v["stringValue"]; break
            if nm: out.append({"id": oid, "name": nm})
        token = d.get("nextPageToken")
        if not token: break
    return out

collections = {
    "hersteller": ("name",),
    "hersteller_new": ("herstellername",),
    "handelsmarken": ("bezeichnung",),
    "kategorien": ("bezeichnung",),
}
refs = {}
for col, nf in collections.items():
    lst = dump_collection(col, nf)
    refs[col] = lst
    print(f"  {col}: {len(lst)} Docs mit Namen")
    json.dump(lst, open(f"{OUT}/refs_{col}.json", "w"), ensure_ascii=False)

# Build normalized name -> [(col,id,name)] index
name_index = {}
for col, lst in refs.items():
    for e in lst:
        n = norm(e["name"])
        if len(n) < 2: continue
        name_index.setdefault(n, []).append((col, e["id"], e["name"]))

all_norm_names = list(name_index.keys())

# Load failing terms
terms = []
with open("/tmp/failing_terms.csv") as f:
    r = csv.reader(f)
    next(r, None)
    for row in r:
        if len(row) >= 2:
            terms.append((row[0], int(row[1])))

# token-subset index: every normalized ref name split into token set
ref_tokensets = [(n, set(n.split())) for n in all_norm_names]

def subset_match(t):
    """term matches ref if all term-tokens appear in ref name (len>=3 tokens guard)."""
    tt = set(t.split())
    hits = []
    for n, toks in ref_tokensets:
        if tt and tt.issubset(toks) and n != t:
            # avoid matching a 1-char/too-generic term into huge names
            if len(t) >= 4 or len(tt) > 1:
                hits.append(n)
    # prefer shortest ref name (closest to the brand itself)
    hits.sort(key=len)
    return hits[:3]

exact, fuzzy, subset, nomatch = [], [], [], []
for term, n in terms:
    t = norm(term)
    if t in name_index:
        exact.append((term, n, name_index[t]))
        continue
    cands = difflib.get_close_matches(t, all_norm_names, n=3, cutoff=0.86)
    if cands:
        fuzzy.append((term, n, [(c, name_index[c]) for c in cands]))
        continue
    sm = subset_match(t)
    if sm:
        subset.append((term, n, [(c, name_index[c]) for c in sm]))
        continue
    nomatch.append((term, n))

wsum = lambda lst: sum(x[1] for x in lst)
tot = wsum(terms)
print(f"\n═══ MATCH-ERGEBNIS (Top-{len(terms)} Fehlschläge, {tot} Such-Events) ═══")
print(f"  EXAKT   {len(exact):>3} Begriffe  ({wsum(exact)} Events, {100*wsum(exact)//tot}%)")
print(f"  FUZZY   {len(fuzzy):>3} Begriffe  ({wsum(fuzzy)} Events)")
print(f"  SUBSET  {len(subset):>3} Begriffe  ({wsum(subset)} Events)")
print(f"  KEIN    {len(nomatch):>3} Begriffe  ({wsum(nomatch)} Events, {100*wsum(nomatch)//tot}%)")

print(f"\n─── EXAKT (Top 45) ───")
for term, n, matches in exact[:45]:
    cols = ", ".join(f"{c}:{nm}" for c, i, nm in matches)
    print(f"  {n:>4}×  {term:<22} → {cols}")

print(f"\n─── FUZZY (alle) ───")
for term, n, matches in fuzzy:
    best = matches[0]
    print(f"  {n:>4}×  {term:<22} ≈ {best[0]}  ({best[1][0][0]}:{best[1][0][2]})")

print(f"\n─── SUBSET (Top 25) ───")
for term, n, matches in subset[:25]:
    best = matches[0]
    print(f"  {n:>4}×  {term:<22} ⊂ {best[1][0][0]}:{best[1][0][2]}")

print(f"\n─── KEIN MATCH (Top 40 — Katalog-Lücke ODER Marke fehlt in refs) ───")
for term, n in nomatch[:40]:
    print(f"  {n:>4}×  {term}")

# Diagnose: sind die grossen fehlenden Marken IRGENDWO als substring?
print(f"\n─── DIAGNOSE: grosse nomatch-Marken als Substring in irgendeiner ref? ───")
for probe in ["milka","lindt","philadelphia","alpro","rama","snickers","ritter","oatly","mutti","lavazza"]:
    hitcols = []
    for col, lst in refs.items():
        for e in lst:
            if probe in norm(e["name"]):
                hitcols.append(f"{col}:{e['name']}"); break
    print(f"  {probe:<14} → {hitcols if hitcols else 'NICHT im Katalog (keine ref)'}")

json.dump({"exact": exact, "fuzzy": fuzzy, "subset": subset, "nomatch": nomatch},
          open(f"{OUT}/match_result.json", "w"), ensure_ascii=False)
print(f"\n  → match_result.json geschrieben")
