#!/bin/bash
cd /Users/patricksieber/Documents/src/markendetektivern/cloud-functions/cashback-pipeline
for i in $(seq 1 40); do
  n=$(node -e "const a=require('firebase-admin');a.initializeApp({projectId:'markendetektive-895f7'});a.firestore().collection('receipts').where('status','==','ocr_pending').get().then(p=>{console.log(p.docs.filter(d=>Date.now()-d.data().createdAt.toMillis()>30*60000).length);process.exit(0);});" 2>/dev/null | tail -1)
  [ "$n" = "0" ] && break
  sleep 15
done
echo "alte ocr_pending übrig: $n"
KEY="$(gcloud secrets versions access latest --secret=NUTRITION_SCRAPER_TRIGGER_KEY --project=markendetektive-895f7 2>/dev/null)"
CASHBACK_ADMIN_KEY="$KEY" node .review-approve.js 2>&1 | grep -E "^Gate|^Budget|^Review-Bons|approved|no_reward|rejected|SKIP|ABBRUCH|^Ergebnis|^gutgeschrieben" | tail -12
