'use strict';
const fs = require('fs');
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
(async () => {
  const done = JSON.parse(fs.readFileSync('.entscheide-fotos.result.json', 'utf8'));
  const frei = done.filter((x) => x.aktion === 'approve' && x.ergebnis === 'approved').map((x) => x.id);
  const ohne = [];
  for (let i = 0; i < frei.length; i += 30) {
    const snaps = await db.getAll(...frei.slice(i, i + 30).map((id) => db.collection('crowd_uploads').doc(id)));
    snaps.forEach((s) => {
      const x = s.data() || {};
      if (!(x.rewardResult === 'credited' || (x.rewardCents ?? 0) > 0) && !x.rewardSkipped) {
        ohne.push({ id: s.id, uid: x.userId, campaign: x.campaignId ?? null });
      } else if (x.rewardSkipped) {
        ohne.push({ id: s.id, uid: x.userId, campaign: x.campaignId ?? null, uebersprungen: x.rewardSkippedReason });
      }
    });
  }
  console.log(`${ohne.length} ohne Buchung — prüfe Ledger + Deckel je Nutzer`);
  const users = [...new Set(ohne.map((x) => x.uid))];
  const stand = new Map();
  for (const uid of users) {
    const [led, u] = await Promise.all([
      db.collection(`users/${uid}/cashback_ledger`).get(),
      db.doc(`users/${uid}`).get(),
    ]);
    let lifetime = 0;
    const proKampagne = {};
    led.docs.forEach((d) => {
      const x = d.data();
      const c = x.type === 'earn' ? (x.cents ?? 0) : x.type === 'reverse' ? -(x.cents ?? 0) : 0;
      lifetime += c;
      if (x.campaignId) proKampagne[x.campaignId] = (proKampagne[x.campaignId] || 0) + c;
    });
    stand.set(uid, { lifetime, proKampagne, totals: u.data()?.cashback_campaign_totals ?? null });
  }
  const zaehl = {};
  for (const o of ohne) {
    const s = stand.get(o.uid);
    const proK = s.proKampagne[o.campaign] ?? 0;
    const grund = o.uebersprungen ? `übersprungen:${o.uebersprungen}`
      : proK >= 500 ? 'per_user_cap_5eur'
      : 'UNGEKLAERT';
    zaehl[grund] = (zaehl[grund] || 0) + 1;
    if (grund === 'UNGEKLAERT') console.log(`  ? ${o.id} uid=${String(o.uid).slice(0, 8)} kampagne=${o.campaign} bisher=${(proK / 100).toFixed(2)}€`);
  }
  console.log('Ergebnis:', JSON.stringify(zaehl, null, 1));
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
