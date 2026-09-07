const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('crowd_uploads')
    .select('probableLocation', 'capture', 'priceReceipt', 'marketLand', 'status')
    .get();
  let n = 0, mitPL = 0;
  const proSource = {};
  let plNoCountryField = 0, plHasLandField = 0;
  let bonAberNichtSieger = 0, bonAberKeinPunkt = 0;
  let gpsRohAberKeinPunkt = 0;
  let gpsGrob = { ueber1km: 0, ueber3km: 0 };
  const beispiele = [];
  snap.forEach((d) => {
    n++;
    const x = d.data();
    const p = x.probableLocation;
    if (!p) return;
    mitPL++;
    proSource[p.source] = (proSource[p.source] || 0) + 1;
    if (p.country !== undefined) plNoCountryField++;
    if (p.land !== undefined) plHasLandField++;
    const bonZip = x.priceReceipt && x.priceReceipt.zip;
    if (bonZip && p.source !== 'gps_capture' && p.source !== 'exif_gps') {
      bonAberNichtSieger++;
      if (p.lat == null) { bonAberKeinPunkt++; if (beispiele.length < 6) beispiele.push({ id: d.id, source: p.source, conf: p.confidence, zip: bonZip, city: x.priceReceipt.city || null, status: x.status }); }
    }
    const g = x.capture && x.capture.gps;
    if (g && Number.isFinite(g.lat) && p.lat == null) gpsRohAberKeinPunkt++;
    if (g && Number.isFinite(g.accuracyM)) {
      if (g.accuracyM > 1000) gpsGrob.ueber1km++;
      if (g.accuracyM > 3000) gpsGrob.ueber3km++;
    }
  });
  console.log(JSON.stringify({ n, mitPL, proSource, plHasCountryField: plNoCountryField, plHasLandField, bonAberNichtSieger, bonAberKeinPunkt, gpsRohAberKeinPunkt, gpsGrob, beispiele }, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FEHLER', e.message); process.exit(1); });
