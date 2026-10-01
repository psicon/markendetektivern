#!/bin/bash
# Nachkontrolle EINER Algolia-Extension-Instanz nach Update oder Rueckweg (NUR LESEND).
# Aufruf: nachkontrolle.sh <instanz> <deployStart ISO, z.B. 2026-10-01T09:00:00Z> [zielversion, Standard 1.3.0]
# Umgebung (fuer Schritt 5): ALGOLIA_EXT_ARBEIT (ext-1.3.0-Build), ALGOLIA_EXT_VORHER (Sicherung direkt vor dem Update)
# Ergebnis in der letzten Zeile: GESAMT GRUEN | GESAMT GRUEN, Schritt 5 offen | GESAMT NICHT GRUEN (+ Gruende).
# Exit 0 = gruen (auch mit offenem Schritt 5), 1 = nicht gruen, 2 = Aufruffehler.
set -u
I=${1:-}; SEIT=${2:-}; ZIEL=${3:-1.3.0}; P=markendetektive-895f7
[ -n "$I" ] && [ -n "$SEIT" ] || { echo "Aufruf: nachkontrolle.sh <instanz> <deployStart ISO> [zielversion]"; exit 2; }
case "$ZIEL" in 1.3.0) RT=nodejs22;; 1.2.10) RT=nodejs20;; *) echo "Zielversion $ZIEL unbekannt"; exit 2;; esac
H=$(cd "$(dirname "$0")" && pwd)
N=${NODE:-$HOME/.nvm/versions/node/v22.22.2/bin/node}
PROBLEME=()
T=$(gcloud auth print-access-token)
J=$(curl -s -H "Authorization: Bearer $T" -H "x-goog-user-project: $P" "https://firebaseextensions.googleapis.com/v1beta/projects/$P/instances/$I")
FELDER=$(echo "$J" | python3 -c "
import json,sys; d=json.load(sys.stdin); c=d['config']; p=c['params']; rd=d.get('runtimeData',{}); ps=rd.get('processingState',{})
import re; m=re.match(r'^projects/\d+/secrets/([^/]+)/versions/(\d+)$', p.get('ALGOLIA_API_KEY',''))
sec=(m.group(1)+':'+m.group(2)) if m else '-'
print(c['extensionVersion'], d['state'], p['ALGOLIA_INDEX_NAME'], p['COLLECTION_PATH'], p.get('DO_FULL_INDEXING','-'), ps.get('state','-'), rd.get('stateUpdateTime','-'), sec, p.get('FORCE_DATA_SYNC','-'))") || { echo "Instanz $I nicht lesbar: $(echo "$J" | head -c 300)"; exit 1; }
read -r VER STATE IDX COLL DFI PSTATE PTIME SECRET FORCE <<<"$FELDER"
MSG=$(echo "$J" | python3 -c "import json,sys; print(json.load(sys.stdin).get('runtimeData',{}).get('processingState',{}).get('detailMessage',''))")
ERR=$(echo "$J" | python3 -c "import json,sys; e=json.load(sys.stdin).get('errorStatus'); print(json.dumps(e)[:400] if e else '')")
echo "1) Instanz $I: Version $VER, Zustand $STATE, DO_FULL_INDEXING=$DFI, FORCE_DATA_SYNC=$FORCE${ERR:+, Fehler: $ERR}"
echo "   Lifecycle: $PSTATE @ $PTIME — $MSG"
[ "$VER" = "$ZIEL" ] || PROBLEME+=("Version $VER statt $ZIEL")
[ "$STATE" = "ACTIVE" ] || PROBLEME+=("Zustand $STATE")
[ "$DFI" = "false" ] || PROBLEME+=("DO_FULL_INDEXING=$DFI")
case "$MSG" in
  "Existing documents were not indexed"*)
    if [[ "$PTIME" > "$SEIT" ]]; then echo "   OK: onUpdate lief mit neuer Konfiguration, KEIN Vollindex"
    else echo "   !! Lifecycle-Stand ist aelter als der Deploy — in 1-2 min erneut pruefen"; PROBLEME+=("Lifecycle noch nicht gelaufen"); fi;;
  *) echo "   !! UNERWARTET: Vollindex gelaufen oder Fehler — Details pruefen"; PROBLEME+=("Lifecycle-Meldung unerwartet");;
esac
for f in executeIndexOperation executeFullIndexOperation; do
  Z=$(gcloud functions describe "ext-$I-$f" --region=us-central1 --project=$P --format="value(runtime,status,updateTime)" 2>/dev/null)
  echo "2) $f: ${Z:-NICHT LESBAR}"
  read -r FRT FST _ <<<"$Z"
  { [ "${FRT:-}" = "$RT" ] && [ "${FST:-}" = "ACTIVE" ]; } || PROBLEME+=("$f: ${FRT:-?}/${FST:-?} statt $RT/ACTIVE")
done
FILTER_BEIDE="resource.type=\"cloud_function\" AND resource.labels.function_name=~\"^ext-$I-execute(Full)?IndexOperation\$\" AND timestamp>=\"$SEIT\""
# Exakter Filter: bei der Instanz ohne Suffix wuerde ^ext-$I- sonst alle anderen Algolia-Instanzen mittreffen.
echo "3) Fehler/Warnungen seit $SEIT (nur die beiden Funktionen dieser Instanz; je Eintrag, nicht je Zeile):"
echo "4) Logs seit $SEIT: Konfigurationsausgaben (Key muss maskiert sein) und Vollindex-Spuren (muessen fehlen):"
AUSW=$(gcloud logging read "$FILTER_BEIDE" --project=$P --limit=500 --format=json 2>/dev/null | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: d=None
if d is None: print('   Logs nicht lesbar'); print('ZAEHLER x x x'); sys.exit()
unbekannt=0; bekannt=0; leck=0; vollindex=0
for e in d:
  jp=e.get('jsonPayload') or {}; tp=e.get('textPayload') or ''
  m=str(jp.get('message') or tp)
  fn=e.get('resource',{}).get('labels',{}).get('function_name','').rsplit('-',1)[-1]
  sev=e.get('severity','DEFAULT')
  k=jp.get('algoliaAPIKey')
  if k is not None and set(str(k))!={'*'}: leck+=1
  if 'algoliaAPIKey' in tp and '********' not in tp: leck+=1
  if 'records.length' in m or 'Finished full indexing' in m or 'enqueue next task' in m: vollindex+=1
  if sev in ('WARNING','ERROR','CRITICAL','ALERT','EMERGENCY'):
    if 'sanitizealgolia' in m: bekannt+=1
    else: unbekannt+=1; print('   3)', e['timestamp'], fn, sev, m.replace(chr(10),' ')[:200])
  if 'doFullIndexing' in m or 'records.length' in m or 'Finished full' in m or 'enqueue next task' in m:
    print('   4)', e['timestamp'], fn, m.replace(chr(10),' ')[:160])
print('   Eintraege gesamt:', len(d), '| Warnungen/Fehler: unbekannt', unbekannt, '/ bekannt (FetchError sanitizealgolia, gab es vorher auch)', bekannt)
print('   unmaskierte Key-Ausgaben:', leck, '(muss 0 sein) | Vollindex-Spuren:', vollindex, '(muss 0 sein)')
print('ZAEHLER', unbekannt, leck, vollindex)
")
echo "$AUSW" | grep -v '^ZAEHLER'
read -r _ UNBEKANNT LECK VI <<<"$(echo "$AUSW" | grep '^ZAEHLER')"
[ "${UNBEKANNT:-x}" = "0" ] || PROBLEME+=("${UNBEKANNT:-?} unbekannte Warnungen/Fehler im Log")
[ "${LECK:-x}" = "0" ] || PROBLEME+=("unmaskierter Key im Log (${LECK:-?})")
[ "${VI:-x}" = "0" ] || PROBLEME+=("Vollindex-Spuren im Log (${VI:-?})")
echo "5) Seit $SEIT synchronisierte Dokumente (Stichprobe gegen 1.3.0-Sollwert + Vorher-Form):"
IDS=$(gcloud logging read "resource.type=\"cloud_function\" AND resource.labels.function_name=\"ext-$I-executeIndexOperation\" AND jsonPayload.message:\"Algolia index for document\" AND timestamp>=\"$SEIT\"" --project=$P --limit=200 --format="value(jsonPayload.message)" 2>/dev/null | awk '{print $NF}' | sort -u | head -5 | tr '\n' ' ')
S5=offen
if [ -z "$IDS" ]; then
  echo "   noch keine natuerliche Aenderung — spaeter erneut ausfuehren (Schritte 1, 2 und 4 belegen den Deploy, NICHT die Auslieferung)"
elif [ "$ZIEL" != "1.3.0" ]; then
  echo "   Dokumente seit Start: $IDS (Sollwert-Vergleich nur fuer 1.3.0 eingerichtet; 1.2.10 baut dieselben Datensaetze)"; S5=ok
elif [ -z "${ALGOLIA_EXT_ARBEIT:-}" ] || [ -z "${ALGOLIA_EXT_VORHER:-}" ]; then
  echo "   ALGOLIA_EXT_ARBEIT/ALGOLIA_EXT_VORHER nicht gesetzt — Schritt 5 nicht pruefbar"; PROBLEME+=("Schritt 5 nicht pruefbar (Umgebung)")
else
  ALGOLIA_EXT_SECRET="$SECRET" "$N" "$H/pruefe-doc.js" "$I" "$COLL" "$IDX" $IDS | sed 's/^/   /'
  if [ "${PIPESTATUS[0]}" = "0" ]; then S5=ok; else PROBLEME+=("Schritt 5: Datensatz-Vergleich auffaellig"); fi
fi
if [ ${#PROBLEME[@]} -gt 0 ]; then
  echo "GESAMT NICHT GRUEN: $(printf '%s | ' "${PROBLEME[@]}")"; exit 1
elif [ "$S5" = "offen" ]; then
  echo "GESAMT GRUEN, Schritt 5 offen (Auslieferung echter Aenderungen noch nicht belegt)"; exit 0
else
  echo "GESAMT GRUEN (inkl. Auslieferung: $IDS)"; exit 0
fi
