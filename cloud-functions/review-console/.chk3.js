const admin=require('firebase-admin'); admin.initializeApp({projectId:'markendetektive-895f7'});
const db=admin.firestore(); const {ortVonEinreichung}=require('./src/ort');
(async()=>{
  const s=await db.collection('crowd_uploads').select('capture','priceReceipt','probableLocation','marketLand','marketName','status').get();
  const labels={}; let countryFehlt=0, landDa=0, ausserhalbLandFallback=0, nichtBestimmbar=0;
  const beispiele=[];
  s.docs.forEach(d=>{const x=d.data(); const p=x.probableLocation; const o=ortVonEinreichung(x);
    if(p&&p.source){ if(p.country===undefined) countryFehlt++; if(p.land) landDa++; }
    if(o.label==='Ort nicht bestimmbar'){nichtBestimmbar++; if(beispiele.length<3)beispiele.push({id:d.id,src:p&&p.source,land:p&&p.land,marketLand:x.marketLand});}
    labels[o.quelle||'null']=(labels[o.quelle||'null']||0)+1;
    if(p&&p.land&&x.marketLand&&p.land!==x.marketLand) ausserhalbLandFallback++;
  });
  console.log('Quellen:',JSON.stringify(labels));
  console.log('probableLocation ohne .country:',countryFehlt,'| mit .land:',landDa);
  console.log('Label "Ort nicht bestimmbar":',nichtBestimmbar, JSON.stringify(beispiele));
  console.log('p.land != marketLand:',ausserhalbLandFallback);
  process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1);});
