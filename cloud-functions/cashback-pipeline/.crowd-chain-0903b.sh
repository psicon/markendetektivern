#!/bin/bash
cd /Users/patricksieber/Documents/src/markendetektivern/cloud-functions/cashback-pipeline
until grep -q "FREIGABE-FÄHIG\|ABBRUCH" /tmp/crowd-analyze-0903b.log; do sleep 5; done
grep -E "FREIGABE-FÄHIG|Ausfall-Gründe|^pending" /tmp/crowd-analyze-0903b.log
ROWS_JSON=/tmp/crowd-rows-0903b.json VERDICTS_JSON=/tmp/crowd-verdicts-0903b.json node .crowd-vision.js 2>&1 | grep -E "^Vision-Audit|UNECHT|^Fertig"
# Hold: clientVersion ohne Ort und gpsStatus NICHT unavailable/timeout (Gate zahlt dort nicht)
node -e "
const admin=require('firebase-admin');admin.initializeApp({projectId:'markendetektive-895f7'});const db=admin.firestore();
(async()=>{const s=await db.collection('crowd_uploads').where('status','==','pending').get();const hold=[];const g={};
s.docs.forEach(d=>{const x=d.data();const c=x.capture||{};if(x.clientVersion&&!(c.confirmedPlace||c.gps)){const gs=c.gpsStatus||'kein-capture';g[gs]=(g[gs]||0)+1;if(!['unavailable','timeout'].includes(gs))hold.push(d.id);}});
require('fs').writeFileSync('/tmp/crowd-hold-0903b.json',JSON.stringify(hold));console.log('ohne Ort (clientVersion):',JSON.stringify(g),'| HOLD (Gate würde nicht zahlen):',hold.length);process.exit(0);})();"
echo "=== APPROVE DRY ==="; DRY_RUN=1 ROWS_JSON=/tmp/crowd-rows-0903b.json VERDICTS_JSON=/tmp/crowd-verdicts-0903b.json HOLD_JSON=/tmp/crowd-hold-0903b.json node .crowd-approve.js 2>&1 | tail -6
echo "=== REJECT DRY ==="; DRY_RUN=1 ROWS_JSON=/tmp/crowd-rows-0903b.json VERDICTS_JSON=/tmp/crowd-verdicts-0903b.json HOLD_JSON=/tmp/crowd-hold-0903b.json node .crowd-reject.js 2>&1 | tail -12
