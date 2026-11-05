'use strict';
/** Nachbuchung für freigegebene crowd_uploads OHNE Ledger-Buchung und OHNE rewardSkipped, deren User
 *  unter dem Deckel liegt (Stand 07.09.2026: 5 Freigaben aus der Review-Runde, die der Client OHNE campaignId
 *  abgeschickt hatte (Android 6.0.15, zwei Nutzer, je eine Sitzung — Kampagnenliste beim Wizard-Start leer). Vorgehen: campaignId auf den September-Topf setzen, dann den Reward-Trigger
 *  per Status-Wechsel pending→approved erneut auslösen. Ledger-ID crowd_<id> ist idempotent (nie doppelt);
 *  Per-User-Cap + Budget prüft der Trigger selbst.
 *  Aufruf (im HAUPT-Checkout, nicht im Worktree):
 *    cd /Users/patricksieber/Documents/src/markendetektivern/cloud-functions/cashback-pipeline
 *    DRY_RUN=1 node .crowd-retrigger-0907.js   # nur zählen
 *    node .crowd-retrigger-0907.js             # ausführen
 *    node .crowd-verify-0903.js                # Nachkontrolle */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const DRY = process.env.DRY_RUN === '1';
const CID = 'produkt-fotos-september-2026';
(async () => {
  const since = Date.parse('2026-09-03T00:00:00Z');
  const all = await db.collection('crowd_uploads').where('status', '==', 'approved').get();
  const todo = [];
  for (const d of all.docs) {
    const x = d.data();
    if (!(x.reviewedAt?.toMillis?.() >= since) || x.rewardSkipped) continue;
    const l = await db.doc(`users/${x.userId}/cashback_ledger/crowd_${d.id}`).get();
    if (l.exists) continue;
    const u = (await db.doc(`users/${x.userId}`).get()).data() || {};
    const totOld = (u.cashback_campaign_totals || {})[x.campaignId] || 0;
    if (x.campaignId && totOld >= 500) continue; // am Deckel der eigenen Kampagne → korrekt ohne Buchung
    todo.push({ id: d.id, camp: x.campaignId || null });
  }
  const byCamp = {}; todo.forEach((t) => { byCamp[t.camp] = (byCamp[t.camp] || 0) + 1; });
  console.log(`nachzubuchen: ${todo.length} ${JSON.stringify(byCamp)}${DRY ? ' (DRY)' : ''}`);
  if (DRY) process.exit(0);
  let n = 0;
  for (const t of todo) {
    const ref = db.doc(`crowd_uploads/${t.id}`);
    await ref.update({ campaignId: CID, campaignIdRebookedFrom: t.camp, status: 'pending', retriggerAt0907: admin.firestore.FieldValue.serverTimestamp() });
    await ref.update({ status: 'approved', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    n++;
    if (n % 10 === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`Trigger erneut ausgelöst für ${n} — jetzt: node .crowd-verify-0903.js`);
  process.exit(0);
})().catch((e) => { console.error('ABBRUCH', e); process.exit(1); });
