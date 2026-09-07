const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const { ortVonEinreichung } = require('./src/ort');
const { evaluateDuplicate, completenessCheck, ms } = require('./src/duplicatePolicy');
const REQUIRED = ['front','rueckseite','hersteller','ean','naehrwerte','zutaten','preis'];
const pol=(id,x)=>({id,userId:x.userId??null,ean:x.ean??null,marketId:x.marketId??null,status:x.status??null,createdAt:ms(x.createdAt),priceOcr:x.priceOcr??null,manufacturerOcr:x.manufacturerOcr??null});
(async()=>{
  const d = await db.collection('crowd_uploads').doc('HsTFEMFLYJ5pX9nc4GQf').get();
  if (!d.exists) { console.log('Fall HsTFEMFLYJ5pX9nc4GQf: nicht vorhanden'); }
  else {
    const x=d.data();
    console.log('status', x.status, '| marketLand', x.marketLand, '| marketName', x.marketName);
    console.log('probableLocation', JSON.stringify(x.probableLocation));
    const o = ortVonEinreichung(x);
    console.log('ORT =>', JSON.stringify({quelle:o.quelle,label:o.label,genau:o.genauigkeitM,lat:o.lat,lon:o.lon,auff:o.auffaellig,herkunft:o.herkunft}));
  }
  // Würde die Warteschlangen-Form überhaupt je 'locked' liefern? Test über ALLE Uploads.
  const all = await db.collection('crowd_uploads').select('userId','ean','marketId','status','createdAt','priceOcr','manufacturerOcr').get();
  const byEan=new Map();
  all.docs.forEach(dd=>{const x=dd.data(); if(!x.ean)return; if(!byEan.has(x.ean))byEan.set(x.ean,[]); const p=pol(dd.id,x); byEan.get(x.ean).push({...p,_policy:p});});
  let locked=0, hold=0, ok=0;
  all.docs.forEach(dd=>{const x=dd.data(); if(!x.ean)return;
    const others=(byEan.get(x.ean)||[]).filter(r=>r.id!==dd.id).map(r=>r._policy);
    const v=evaluateDuplicate(pol(dd.id,x),others).verdict; if(v==='locked')locked++; else if(v==='hold')hold++; else ok++;});
  console.log('Doppel-Regel über ALLE Uploads (Warteschlangen-Form): locked',locked,'hold',hold,'ok',ok);
  process.exit(0);
})().catch(e=>{console.error('ERR',e.stack);process.exit(1);});
