#!/bin/bash
# Offline-Tests fuer update-instanz.mjs. fetch ist gemockt (mock-fetch.mjs), gcloud durch ein
# Attrappen-Skript ersetzt: KEIN Netzwerkzugriff, kein Aufruf gegen ein echtes Projekt.
# Aufruf: scripts/algolia-ext/test/run-tests.sh      (Ausgaben landen in einem Temp-Ordner)
set -u
T=$(cd "$(dirname "$0")" && pwd)
N=${NODE:-$HOME/.nvm/versions/node/v22.22.2/bin/node}
SKRIPT=$T/../update-instanz.mjs
export MOCK_INSTANCES=${MOCK_INSTANCES:-$T/instanzen-fixture.json}
OUT=$(mktemp -d)
if [ -n "${BEHALTEN:-}" ]; then echo "Ausgaben bleiben in $OUT"; else trap 'rm -rf "$OUT"' EXIT; fi
mkdir -p "$OUT/bin"; printf '#!/bin/sh\necho test-token\n' > "$OUT/bin/gcloud"; chmod +x "$OUT/bin/gcloud"
export PATH="$OUT/bin:$PATH"
cd "$OUT"
pass=0; fail=0
lauf() { # name erwarteterExit szenario startversion startstate args...
  local name=$1 soll=$2; export MOCK_SZENARIO=$3 MOCK_START_VERSION=$4 MOCK_START_STATE=$5; shift 5
  export MOCK_LOG=$OUT/$name.log; : > "$MOCK_LOG"
  "$N" --import "$T/mock-fetch.mjs" "$SKRIPT" "$@" --protokoll "$OUT/prot-$name" > "$OUT/$name.out" 2>&1; local ist=$?
  if [ "$ist" = "$soll" ]; then pass=$((pass+1)); echo "OK   $name (exit $ist)"; else fail=$((fail+1)); echo "FAIL $name (exit $ist, erwartet $soll)"; tail -5 "$OUT/$name.out"; fi
}
enthaelt() { # name text — Ausgabe muss den Text enthalten
  if grep -qF -- "$2" "$OUT/$1.out"; then pass=$((pass+1)); echo "OK   $1 enthaelt: $2"; else fail=$((fail+1)); echo "FAIL $1 enthaelt nicht: $2"; tail -5 "$OUT/$1.out"; fi
}
unset MOCK_START_DFI MOCK_FEHLER_KONFIG
# --- Grundfaelle (ACTIVE) ---
lauf pruefen_vatb            0 ok "" "" firestore-algolia-search-vatb --pruefen --erwarte-version 1.2.0
lauf pruefen_ohne_erwarte    2 ok "" "" firestore-algolia-search-vatb --pruefen
lauf ausfuehren_ohne_erwarte 2 ok "" "" firestore-algolia-search-vatb --ausfuehren
lauf falsche_erwartung       2 ok "" "" firestore-algolia-search-vatb --ausfuehren --erwarte-version 1.2.10
lauf unbekannte_erwartung    2 ok "" "" firestore-algolia-search-vatb --ausfuehren --erwarte-version 1.2.1
lauf unbekannte_instanz      2 ok "" "" firestore-bigquery-export --pruefen
lauf tippfehler_instanz      2 ok "" "" firestore-algolia-search-vatbx --pruefen
lauf ziel_120_verboten       2 ok "" "" firestore-algolia-search-vatb --pruefen --version 1.2.0
lauf ausfuehren_vatb         0 ok "" "" firestore-algolia-search-vatb --ausfuehren --erwarte-version 1.2.0
lauf ausfuehren_iyqn         0 ok "" "" firestore-algolia-search-iyqn --ausfuehren --erwarte-version 1.2.10
lauf ausfuehren_ohne_suffix  0 ok "" "" firestore-algolia-search --ausfuehren --erwarte-version 1.2.0
lauf rueckweg_1210           0 ok 1.3.0 "" firestore-algolia-search-vatb --ausfuehren --version 1.2.10 --erwarte-version 1.3.0
lauf falsche_laufzeit        2 falscheLaufzeit "" "" firestore-algolia-search-v50j --ausfuehren --erwarte-version 1.2.0
lauf modus_fehlt             2 ok "" "" firestore-algolia-search-vatb
lauf plan_vatb               0 ok "" "" firestore-algolia-search-vatb --plan
lauf zwei_modi               2 ok "" "" firestore-algolia-search-vatb --plan --ausfuehren --erwarte-version 1.2.0
lauf liste_ohne_flag         2 ok "" "" firestore-algolia-search-vatb --ausfuehren --erwarte-version 1.2.0,1.3.0
lauf active_mit_flag         2 ok "" "" firestore-algolia-search-vatb --ausfuehren --erwarte-version 1.2.0 --aus-fehlerzustand
lauf plan_mit_flag           2 ok "" "" firestore-algolia-search-vatb --plan --aus-fehlerzustand
# --- Fehlschlag waehrend des Updates: Zustand danach wird gelesen und protokolliert ---
export MOCK_FEHLER_KONFIG=neu
lauf opfehler                2 opfehler "" "" firestore-algolia-search-v50j --ausfuehren --erwarte-version 1.2.0
enthaelt opfehler "Instanz nach dem Fehlschlag: Zustand ERRORED"
enthaelt opfehler "zuerst --plan"
unset MOCK_FEHLER_KONFIG
# --- Instanz steht auf ERRORED (Rueckweg/Wiederholung) ---
lauf errored_plan            0 ok 1.3.0 ERRORED firestore-algolia-search-vatb --plan
enthaelt errored_plan "Zustand ERRORED"
enthaelt errored_plan "--aus-fehlerzustand"
lauf errored_ohne_flag       2 ok 1.3.0 ERRORED firestore-algolia-search-vatb --ausfuehren --version 1.2.10 --erwarte-version 1.3.0
lauf errored_rueckweg_neu    0 ok 1.3.0 ERRORED firestore-algolia-search-vatb --ausfuehren --version 1.2.10 --erwarte-version 1.3.0 --aus-fehlerzustand
lauf errored_rueckweg_alt    0 ok 1.2.0 ERRORED firestore-algolia-search-vatb --ausfuehren --version 1.2.10 --erwarte-version 1.2.0,1.3.0 --aus-fehlerzustand
lauf errored_pruefen         0 ok 1.3.0 ERRORED firestore-algolia-search-vatb --pruefen --version 1.2.10 --erwarte-version 1.3.0 --aus-fehlerzustand
lauf errored_falsche_erw     2 ok 1.2.0 ERRORED firestore-algolia-search-vatb --ausfuehren --version 1.2.10 --erwarte-version 1.3.0 --aus-fehlerzustand
export MOCK_START_DFI=false
lauf errored_wiederholung    0 ok 1.3.0 ERRORED firestore-algolia-search-vatb --ausfuehren --version 1.3.0 --erwarte-version 1.2.0,1.3.0 --aus-fehlerzustand
lauf active_zielstand        0 ok 1.3.0 "" firestore-algolia-search-vatb --ausfuehren --version 1.3.0 --erwarte-version 1.3.0
enthaelt active_zielstand "Bereits auf Zielstand"
unset MOCK_START_DFI
lauf deploying_mit_flag      2 ok 1.3.0 DEPLOYING firestore-algolia-search-vatb --ausfuehren --version 1.2.10 --erwarte-version 1.3.0 --aus-fehlerzustand
lauf deploying_ohne_flag     2 ok 1.3.0 DEPLOYING firestore-algolia-search-vatb --ausfuehren --version 1.2.10 --erwarte-version 1.3.0
# --- Inhaltliche Pruefung der gesendeten PATCH-Aufrufe ---
"$N" -e '
const fs=require("fs");const raw=JSON.parse(fs.readFileSync(process.env.MOCK_INSTANCES));
const live=Object.fromEntries(raw.instances.map(i=>[i.name.split("/").pop(),i]));
let ok=true;const chk=(c,m)=>{if(!c){ok=false;console.log("FAIL",m)}};
const mitPatch=[["pruefen_vatb","firestore-algolia-search-vatb","1.3.0","true"],["ausfuehren_vatb","firestore-algolia-search-vatb","1.3.0","false"],["ausfuehren_iyqn","firestore-algolia-search-iyqn","1.3.0","false"],["ausfuehren_ohne_suffix","firestore-algolia-search","1.3.0","false"],["rueckweg_1210","firestore-algolia-search-vatb","1.2.10","false"],["opfehler","firestore-algolia-search-v50j","1.3.0","false"],["errored_rueckweg_neu","firestore-algolia-search-vatb","1.2.10","false"],["errored_rueckweg_alt","firestore-algolia-search-vatb","1.2.10","false"],["errored_pruefen","firestore-algolia-search-vatb","1.2.10","true"],["errored_wiederholung","firestore-algolia-search-vatb","1.3.0","false"]];
for (const [f,inst,vers,vo] of mitPatch) {
  const calls=fs.readFileSync(f+".log","utf8").trim().split("\n").map(JSON.parse);
  const p=calls.filter(c=>c.m==="PATCH");
  chk(p.length===1,f+": genau ein PATCH ("+p.length+")");
  if (!p.length) continue;
  chk(p[0].url.includes("/instances/"+inst+"?"),f+": PATCH-Ziel "+p[0].url);
  chk(p[0].url.includes("validateOnly="+vo),f+": validateOnly="+vo);
  chk(decodeURIComponent(p[0].url).includes("updateMask=config.extension_ref,config.extension_version,config.params,config.system_params,config.allowed_event_types,config.eventarc_channel"),f+": updateMask");
  const b=p[0].body.config, l=live[inst].config;
  chk(b.extensionRef==="algolia/firestore-algolia-search" && b.extensionVersion===vers,f+": ref/version "+b.extensionVersion);
  const diff=[...new Set([...Object.keys(b.params),...Object.keys(l.params)])].filter(k=>b.params[k]!==l.params[k]);
  chk(JSON.stringify(diff)==="[\"DO_FULL_INDEXING\"]" && b.params.DO_FULL_INDEXING==="false",f+": nur DO_FULL_INDEXING geaendert "+JSON.stringify(diff));
  chk(JSON.stringify(b.systemParams)===JSON.stringify(l.systemParams),f+": systemParams 1:1");
  chk(!("ALT_OBJECT_ID" in b.params),f+": kein ALT_OBJECT_ID");
  const fremde=calls.filter(c=>c.m!=="GET"&&!c.url.includes("/instances/"+inst+"?")&&!c.url.includes("/operations/"));
  chk(fremde.length===0,f+": keine Schreibaufrufe an andere Instanzen");
}
const ohnePatch=["plan_vatb","zwei_modi","pruefen_ohne_erwarte","ausfuehren_ohne_erwarte","falsche_erwartung","unbekannte_erwartung","unbekannte_instanz","tippfehler_instanz","ziel_120_verboten","modus_fehlt","liste_ohne_flag","active_mit_flag","plan_mit_flag","errored_plan","errored_ohne_flag","errored_falsche_erw","active_zielstand","deploying_mit_flag","deploying_ohne_flag"];
for (const f of ohnePatch) {
  const t=fs.readFileSync(f+".log","utf8").trim(); const calls=t?t.split("\n").map(JSON.parse):[];
  chk(!calls.some(c=>c.m!=="GET"),f+": darf nichts senden ausser GET");
}
// Protokoll des Fehlschlags enthaelt den Zustand danach
const pf=fs.readdirSync("prot-opfehler").filter(x=>x.endsWith("-fehler.json"));
chk(pf.length===1,"opfehler: Fehlerprotokoll geschrieben");
if (pf.length) { const j=JSON.parse(fs.readFileSync("prot-opfehler/"+pf[0])); chk(j.instanzDanach&&j.instanzDanach.state==="ERRORED"&&j.instanzDanach.config.extensionVersion==="1.3.0","opfehler: Zustand danach protokolliert"); }
// Vorher-Protokoll haelt Zustand und eingetragene Version fest
const pv=fs.readdirSync("prot-errored_rueckweg_alt").filter(x=>x.endsWith("-vorher.json"));
if (pv.length) { const j=JSON.parse(fs.readFileSync("prot-errored_rueckweg_alt/"+pv[0])); chk(j.zustand==="ERRORED"&&j.versionInKonfiguration==="1.2.0"&&j.ausFehlerzustand===true,"errored_rueckweg_alt: Vorher-Protokoll"); } else chk(false,"errored_rueckweg_alt: Vorher-Protokoll fehlt");
console.log(ok?"INHALT OK":"INHALT FEHLER"); process.exit(ok?0:1);' && pass=$((pass+1)) || fail=$((fail+1))
echo "== $pass bestanden, $fail fehlgeschlagen"
[ $fail = 0 ]
