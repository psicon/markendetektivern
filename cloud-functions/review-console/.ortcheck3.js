const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('crowd_uploads').select('probableLocation','probableLocationAt','createdAt','status','capture','priceReceipt').get();
  const ms=(v)=>(v&&v.toMillis?v.toMillis():null);
  const buckets = {};
  let nachAug15 = 0, nachAug15mitPL = 0;
  const offenOhnePL = [];
  snap.forEach((d)=>{
    const x=d.data(); const t=ms(x.createdAt);
    const monat = t? new Date(t).toISOString().slice(0,7):'?';
    buckets[monat]=buckets[monat]||{n:0,mitPL:0};
    buckets[monat].n++; if(x.probableLocation) buckets[monat].mitPL++;
    if(t && t> Date.parse('2026-08-15T23:59:59Z')){ nachAug15++; if(x.probableLocation) nachAug15mitPL++; }
    if(!x.probableLocation && x.status==='pending' && offenOhnePL.length<5) offenOhnePL.push({id:d.id, createdAt: t?new Date(t).toISOString():null, hatGps: !!(x.capture&&x.capture.gps), hatBon: !!(x.priceReceipt&&x.priceReceipt.zip), hatAngabe: !!(x.capture&&x.capture.confirmedPlace)});
  });
  const wochen = Object.entries(buckets).sort();
  console.log(JSON.stringify({wochen, nachAug15, nachAug15mitPL, offenOhnePL},null,2));
  process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1);});
