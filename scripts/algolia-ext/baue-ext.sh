#!/bin/bash
# Baut den Funktionscode einer Version der Extension algolia/firestore-algolia-search lokal
# nach — NUR fuer Vergleiche und die Nachkontrolle (harness/pruefe-doc.js, harness/vergleich.js).
# Rollt nichts aus und beruehrt kein Projekt.
# Aufruf: baue-ext.sh <1.3.0|1.2.10|1.2.0> <arbeitsordner>
#   -> <arbeitsordner>/ext-<version>/functions/{lib,node_modules}
# Quelle: Git-Tag des Algolia-Repos (1.3.0 / v1.2.10 / v1.2.0). npm ci installiert exakt den
# package-lock des Tags und kompiliert per "prepare" nach lib/. Ist der Build schon da, passiert nichts.
set -euo pipefail
V=${1:-}; A=${2:-}
[ -n "$V" ] && [ -n "$A" ] || { echo "Aufruf: baue-ext.sh <version> <arbeitsordner>"; exit 2; }
case "$V" in 1.3.0) TAG=1.3.0;; 1.2.10) TAG=v1.2.10;; 1.2.0) TAG=v1.2.0;; *) echo "unbekannte Version $V"; exit 2;; esac
NODE_BIN=${NODE_BIN:-$HOME/.nvm/versions/node/v22.22.2/bin}
Z="$A/ext-$V"
if [ -f "$Z/functions/lib/extract.js" ] && [ -d "$Z/functions/node_modules/firebase-admin" ]; then echo "ext-$V vorhanden: $Z"; exit 0; fi
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
git clone -q --depth 1 --branch "$TAG" https://github.com/algolia/firestore-algolia-search.git "$TMP/src"
IST=$(python3 -c "import json;print(json.load(open('$TMP/src/functions/package.json'))['version'])")
[ "$IST" = "$V" ] || { echo "Tag $TAG traegt package.json-Version $IST statt $V — ABBRUCH"; exit 1; }
mkdir -p "$Z"; rm -rf "$Z/functions"; cp -R "$TMP/src/functions" "$Z/functions"
cp "$TMP/src/extension.yaml" "$Z/extension.yaml"
(cd "$Z/functions" && PATH="$NODE_BIN:$PATH" npm ci --no-audit --no-fund --loglevel=error)
[ -f "$Z/functions/lib/extract.js" ] || (cd "$Z/functions" && PATH="$NODE_BIN:$PATH" npx tsc)
[ -f "$Z/functions/lib/extract.js" ] || { echo "Build unvollstaendig: lib/extract.js fehlt"; exit 1; }
echo "ext-$V gebaut: $Z (Tag $TAG, $(git -C "$TMP/src" rev-parse --short HEAD))"
