// Welche Ortsquellen gibt es wirklich, wie oft, und wie weit liegen sie
// auseinander? Grundlage für die Entscheidung, welcher Ort gilt.
'use strict';
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();

const km = (a, b) => {
  if (!a || !b) return null;
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)) * 10) / 10;
};

(async () => {
  const up = await db.collection('crowd_uploads').get();
  const z = { gesamt: up.size, gps: 0, gpsPraezise: 0, confirmedPlace: 0, bonImPreisbild: 0,
    bonKomplett: 0, ipJourney: 0, ipFallback: 0, marktName: 0, garNichts: 0 };
  const paare = [];
  up.docs.forEach((d) => {
    const x = d.data(), c = x.capture || {};
    const hatGps = !!(c.gps && Number.isFinite(c.gps.lat));
    if (hatGps) { z.gps++; if ((c.gps.accuracy ?? 999) <= 100) z.gpsPraezise++; }
    if (c.confirmedPlace) z.confirmedPlace++;
    if (x.priceReceipt) { z.bonImPreisbild++; if (x.priceReceipt.complete) z.bonKomplett++; }
    const jl = x.journeyLocation || c.journeyLocation;
    if (jl) { z.ipJourney++; if (jl.source === 'fallback') z.ipFallback++; }
    if (x.marketName) z.marktName++;
    if (!hatGps && !c.confirmedPlace && !x.priceReceipt?.zip && !x.marketName) z.garNichts++;
    // Abweichung GPS ↔ IP messen
    if (hatGps && jl && jl.source !== 'fallback' && Number.isFinite(jl.lat)) {
      paare.push({ id: d.id, dist: km({ lat: c.gps.lat, lon: c.gps.lon }, { lat: jl.lat, lon: jl.lon }), stadt: jl.city ?? null });
    }
  });
  console.log('=== PRODUKTFOTOS (crowd_uploads):', JSON.stringify(z, null, 1));
  if (paare.length) {
    const ds = paare.map((p) => p.dist).sort((a, b) => a - b);
    const q = (p) => ds[Math.floor(ds.length * p)];
    console.log(`GPS vs. IP-Ort: n=${ds.length} | Median ${q(0.5)} km | p90 ${q(0.9)} km | max ${ds[ds.length - 1]} km | unter 10 km: ${ds.filter((x) => x <= 10).length}`);
  }

  const rec = await db.collection('receipts').select('store', 'journey', 'merchant', 'capture').get();
  const r = { gesamt: rec.size, storePlz: 0, storeKomplett: 0, storeStadt: 0, ip: 0, ipFallback: 0, merchant: 0, gpsAmBon: 0 };
  rec.docs.forEach((d) => {
    const x = d.data(), s = x.store || {};
    if (s.zip) r.storePlz++;
    if (s.zip && s.city && s.street) r.storeKomplett++;
    if (s.city) r.storeStadt++;
    const jl = x.journey?.location;
    if (jl) { r.ip++; if (jl.source === 'fallback') r.ipFallback++; }
    if (x.merchant?.id) r.merchant++;
    if (x.capture?.gps) r.gpsAmBon++;
  });
  console.log('\n=== BONS (receipts):', JSON.stringify(r, null, 1));
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
