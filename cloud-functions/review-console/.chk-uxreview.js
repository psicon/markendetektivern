const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const { evaluateDuplicate, completenessCheck, ms } = require('./src/duplicatePolicy');
const { ortVonEinreichung, ortVonBon, ortsverzeichnisAusBons } = require('./src/ort');
const REQUIRED = ['front','rueckseite','hersteller','ean','naehrwerte','zutaten','preis'];
const pol = (id,x) => ({ id, userId:x.userId??null, ean:x.ean??null, marketId:x.marketId??null, status:x.status??null, createdAt:ms(x.createdAt), priceOcr:x.priceOcr??null, manufacturerOcr:x.manufacturerOcr??null });
(async () => {
  const [open, all] = await Promise.all([
    db.collection('crowd_uploads').where('status','==','pending').get(),
    db.collection('crowd_uploads').select('userId','ean','marketId','status','createdAt','priceOcr','manufacturerOcr').get(),
  ]);
  const byEan = new Map();
  all.docs.forEach(d => { const x=d.data(); if(!x.ean) return; if(!byEan.has(x.ean)) byEan.set(x.ean,[]); const p=pol(d.id,x); byEan.get(x.ean).push({...p,_policy:p}); });
  const tally = {};
  open.docs.forEach(d => {
    const x = d.data();
    const comp = completenessCheck({images:x.images,ean:x.ean,productName:x.productName,productNameOcr:x.productNameOcr}, REQUIRED);
    const others = (byEan.get(x.ean)||[]).filter(r=>r.id!==d.id).map(r=>r._policy);
    const dup = x.ean ? evaluateDuplicate(pol(d.id,x), others) : {verdict:'ok'};
    const v = !comp.ok ? 'incomplete' : dup.verdict==='ok' ? 'ok' : dup.verdict;
    tally[v]=(tally[v]||0)+1;
  });
  console.log('pending-Urteile:', JSON.stringify(tally));

  // Karte: Auffälligkeiten + ohneOrt-Aufschlüsselung real nachrechnen
  const [ups, recs] = await Promise.all([
    db.collection('crowd_uploads').select('capture','priceReceipt','probableLocation','marketName','marketLand','status','createdAt').get(),
    db.collection('receipts').select('store','merchant','status','createdAt').get(),
  ]);
  const verz = ortsverzeichnisAusBons(recs.docs.map(d=>d.data().store).filter(s=>s&&s.city&&s.zip));
  const Q={geraet:0,filiale:1,nutzerangabe:2};
  const ohne={fotos:0,bons:0,nurLand:0,wohnort:0,garNichts:0,ortNichtAufloesbar:0};
  let auffF=0, auffB=0, pf=0, pb=0; const arten={}; const quellen={};
  ups.docs.forEach(d=>{ const o=ortVonEinreichung(d.data(),verz);
    if(o.lat==null||o.lon==null||Q[o.quelle]===undefined){ ohne.fotos++;
      if(o.quelle==='land') ohne.nurLand++; else if(o.quelle==='profil') ohne.wohnort++; else if(o.quelle==null) ohne.garNichts++; else ohne.ortNichtAufloesbar++;
      return; }
    pf++; quellen[o.quelle]=(quellen[o.quelle]||0)+1;
    if((o.auffaellig||[]).length){auffF++;(o.auffaellig||[]).forEach(a=>arten[a.art]=(arten[a.art]||0)+1);} });
  recs.docs.forEach(d=>{ const o=ortVonBon(d.data(),verz); if(o.lat==null||o.lon==null){ohne.bons++;return;} pb++;
    if((o.auffaellig||[]).length){auffB++;(o.auffaellig||[]).forEach(a=>arten[a.art]=(arten[a.art]||0)+1);} });
  console.log('Punkte Fotos',pf,'Bons',pb,'| ohneOrt',JSON.stringify(ohne),'| gesamt',ups.size,recs.size);
  console.log('auffällig Fotos',auffF,'Bons',auffB,'| Arten',JSON.stringify(arten),'| Quellen Fotos',JSON.stringify(quellen));
  process.exit(0);
})().catch(e=>{console.error('ERR',e.stack);process.exit(1);});
