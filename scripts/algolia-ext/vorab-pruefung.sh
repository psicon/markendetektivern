#!/bin/bash
# Schritt 0 des Deploy-Rezepts (NUR LESEND gegen das Projekt): prueft, dass alle Hilfsdateien
# und der 1.3.0-Build da sind (baut ihn sonst lokal nach), fuehrt die Offline-Tests aus, liest
# alle 9 Algolia-Instanzen (--plan) und vergleicht die etags aller Extensions mit der Sicherung
# vom 01.10.2026. Exit 0 nur, wenn alles dem gepruefen Stand entspricht.
# Aufruf: vorab-pruefung.sh            Umgebung: ALGOLIA_EXT_ARBEIT (Standard ~/markendetektive-sicherungen/algolia-ext-2026-10)
set -u
H=$(cd "$(dirname "$0")" && pwd)
N=${NODE:-$HOME/.nvm/versions/node/v22.22.2/bin/node}
A=${ALGOLIA_EXT_ARBEIT:-$HOME/markendetektive-sicherungen/algolia-ext-2026-10}
REF=$A/algolia-vorher-2026-10-01/instances-raw.json
P=markendetektive-895f7
fehl=0; nein() { echo "!! $*"; fehl=$((fehl+1)); }
echo "0a) Dateien"
for f in update-instanz.mjs baue-ext.sh test/run-tests.sh test/mock-fetch.mjs test/instanzen-fixture.json gen1-probe/index.js gen1-probe/package.json harness/keys.js harness/sicherung.js harness/diff-snapshots.js harness/pruefe-doc.js harness/nachkontrolle.sh harness/koeder-suche.js; do
  [ -f "$H/$f" ] || nein "fehlt: $H/$f"
done
[ -x "$N" ] || nein "Node fehlt: $N"
[ -f "$REF" ] || nein "Referenz-Sicherung fehlt: $REF (Kopie der Sicherung vom 01.10.2026)"
echo "0b) 1.3.0-Build in $A"
"$H/baue-ext.sh" 1.3.0 "$A" | tail -1 || nein "Build 1.3.0 gescheitert"
echo "0c) Offline-Tests update-instanz.mjs"
"$H/test/run-tests.sh" | tail -1; [ "${PIPESTATUS[0]}" = 0 ] || nein "Offline-Tests rot"
echo "0d) gcloud-Konto: $(gcloud config get-value account 2>/dev/null)  (Projekt wird in jedem Aufruf explizit gesetzt)"
echo "0e) Plan aller 9 Instanzen (nur lesen)"
soll() { case $1 in firestore-algolia-search|firestore-algolia-search-trzv|firestore-algolia-search-v50j|firestore-algolia-search-vatb) echo 1.2.0;; *) echo 1.2.10;; esac; }
for i in firestore-algolia-search firestore-algolia-search-trzv firestore-algolia-search-v50j firestore-algolia-search-vatb firestore-algolia-search-fll2 firestore-algolia-search-iyqn firestore-algolia-search-ly0q firestore-algolia-search-oaz3 firestore-algolia-search-t542; do
  O=$("$N" "$H/update-instanz.mjs" "$i" --plan 2>&1); rc=$?
  Z=$(echo "$O" | head -1); AE=$(echo "$O" | grep -c '^  \* ')
  echo "   $i: $(echo "$Z" | sed -E 's/.*(Zustand [A-Z]+, Version laut Konfiguration [0-9.]+).*/\1/') | Aenderungen $AE $(echo "$O" | grep '^  \* ' | tr -s ' ')"
  [ $rc = 0 ] || nein "$i: --plan rc=$rc"
  echo "$Z" | grep -q "Zustand ACTIVE, Version laut Konfiguration $(soll "$i")," || nein "$i: nicht ACTIVE auf $(soll "$i")"
  [ "$AE" = 1 ] && echo "$O" | grep -q '^  \* DO_FULL_INDEXING: true  ->  false' || nein "$i: Parameteraenderung weicht ab"
done
echo "0f) etag-Abgleich aller Extensions gegen $REF"
T=$(gcloud auth print-access-token)
curl -s -H "Authorization: Bearer $T" -H "x-goog-user-project: $P" "https://firebaseextensions.googleapis.com/v1beta/projects/$P/instances?pageSize=100" > "${TMPDIR:-/tmp}/ext-live-$$.json"
R=$(python3 -c "
import json
live={i['name'].split('/')[-1]:i['etag'] for i in json.load(open('${TMPDIR:-/tmp}/ext-live-$$.json'))['instances']}
alt={i['name'].split('/')[-1]:i['etag'] for i in json.load(open('$REF'))['instances']}
g=[k for k in alt if live.get(k)!=alt[k]]; n=[k for k in live if k not in alt]
print(len(live), 'Instanzen | geaendert:', g or 'keine', '| neu:', n or 'keine'); print('OK' if not g and not n else 'DRIFT')")
rm -f "${TMPDIR:-/tmp}/ext-live-$$.json"
echo "   $(echo "$R" | head -1)"; [ "$(echo "$R" | tail -1)" = OK ] || nein "Extensions haben sich seit der Pruefung veraendert — STOPP, neu bewerten"
if [ $fehl = 0 ]; then echo "VORAB-PRUEFUNG GRUEN"; exit 0; else echo "VORAB-PRUEFUNG NICHT GRUEN ($fehl Punkte)"; exit 1; fi
