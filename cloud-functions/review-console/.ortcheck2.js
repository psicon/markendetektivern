const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const { ortVonEinreichung, landAusKoordinate, inDACH } = require('./src/ort');
(async () => {
  const snap = await db.collection('crowd_uploads').get();
  const ohnePL = [];
  let konflikt = 0;      // ohne PL: Bon-Adresse vorhanden UND confirmedPlace -> Rangfolgen unterscheiden sich
  let neusteOhnePL = 0, aeltesteMitPL = null, neusteOhne = null;
  const auff = {};
  let gpsInDACHaberNichtEindeutig = 0, gpsAusserhalbDACH = 0, gpsAT = 0, gpsCH = 0;
  const auffFaelle = [];
  const labelNichtBestimmbar = [];
  snap.forEach((d) => {
    const x = d.data();
    const o = ortVonEinreichung(x, null);
    (o.auffaellig || []).forEach((a) => { auff[a.art] = (auff[a.art] || 0) + 1; if (auffFaelle.length < 12) auffFaelle.push({ id: d.id, art: a.art, text: a.text, lat: o.lat, lon: o.lon, land: o.land, marketLand: x.marketLand, quelle: o.quelle, genau: o.genauigkeitM }); });
    if (o.label === 'Ort nicht bestimmbar' && labelNichtBestimmbar.length < 5) labelNichtBestimmbar.push({ id: d.id, quelle: o.quelle, plLand: x.probableLocation && x.probableLocation.land });
    const g = x.capture && x.capture.gps;
    if (g && Number.isFinite(g.lat)) {
      if (!inDACH(g.lat, g.lon)) gpsAusserhalbDACH++;
      else {
        const l = landAusKoordinate(g.lat, g.lon);
        if (l === null) gpsInDACHaberNichtEindeutig++;
        if (l === 'Österreich') gpsAT++;
        if (l === 'Schweiz') gpsCH++;
      }
    }
    const ms = (v) => (v && v.toMillis ? v.toMillis() : null);
    if (!x.probableLocation) {
      ohnePL.push(ms(x.createdAt));
      if (x.priceReceipt && x.priceReceipt.zip && x.capture && x.capture.confirmedPlace && !(x.capture.gps)) konflikt++;
    }
  });
  const mitTs = ohnePL.filter(Boolean).sort((a, b) => b - a);
  console.log(JSON.stringify({
    gesamt: snap.size, ohnePL: ohnePL.length,
    neusteOhnePL: mitTs[0] ? new Date(mitTs[0]).toISOString() : null,
    aeltesteOhnePL: mitTs[mitTs.length - 1] ? new Date(mitTs[mitTs.length - 1]).toISOString() : null,
    ohnePL_letzte30Tage: mitTs.filter((t) => t > Date.now() - 30 * 86400000).length,
    rangfolgeKonfliktMoeglich: konflikt,
    auffaelligkeiten: auff, gpsAusserhalbDACH, gpsInDACHaberNichtEindeutig, gpsAT, gpsCH,
    auffFaelle, labelNichtBestimmbar,
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error('FEHLER', e.stack); process.exit(1); });
