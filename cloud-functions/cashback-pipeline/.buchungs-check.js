'use strict';
const fs = require('fs');
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
(async () => {
  const done = JSON.parse(fs.readFileSync('.entscheide-fotos.result.json', 'utf8'));
  const frei = done.filter((x) => x.aktion === 'approve' && x.ergebnis === 'approved').map((x) => x.id);
  console.log(`${frei.length} freigegeben — prüfe Buchung je Einreichung`);
  const z = { gebucht: 0, offen: 0, uebersprungen: 0, cent: 0 };
  const offen = [];
  for (let i = 0; i < frei.length; i += 30) {
    const snaps = await db.getAll(...frei.slice(i, i + 30).map((id) => db.collection('crowd_uploads').doc(id)));
    for (const s of snaps) {
      const x = s.data() || {};
      if (x.rewardResult === 'credited' || (x.rewardCents ?? 0) > 0) { z.gebucht++; z.cent += x.rewardCents ?? 0; }
      else if (x.rewardSkipped) { z.uebersprungen++; offen.push(`${s.id} übersprungen: ${x.rewardSkippedReason ?? '?'}`); }
      else { z.offen++; offen.push(`${s.id} noch ohne Buchungsspur (status=${x.status})`); }
    }
  }
  console.log(`  gebucht ${z.gebucht} (${(z.cent / 100).toFixed(2)} €) | übersprungen ${z.uebersprungen} | ohne Spur ${z.offen}`);
  offen.slice(0, 12).forEach((l) => console.log('   ', l));
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
