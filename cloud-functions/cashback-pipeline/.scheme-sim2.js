'use strict';
/**
 * MESSRUNDE 2 — "Billig zuerst" mit Kurz-Bon-Schranke:
 * Phase-0-Akzeptanz NUR wenn zusätzlich items.length <= 25.
 * Größere Schwer-Stichprobe (60 statt 20), Fehlgriffe müssen 0 sein.
 */
process.env.CASHBACK_OCR_THINKING_BUDGET = '0';
const MAX_ITEMS = 25;

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7', storageBucket: 'markendetektive-895f7.appspot.com' });
const db = admin.firestore();
const bucket = admin.storage().bucket();
const { extractReceipt, reconcile } = require('./lib/ocr');
const { sigOf } = require('./lib/ocr_robust');

const summe = (items) => (items || []).reduce((s, i) => s + (Number(i.priceCents) || 0), 0);

async function lauf() {
  const s = await db.collection('receipts')
    .where('createdAt', '>=', new Date('2026-07-01')).where('createdAt', '<', new Date('2026-08-01'))
    .get();
  const mitOcr = s.docs.filter((d) => {
    const x = d.data();
    return Array.isArray(x.items) && x.items.length >= 3 &&
      x.storage && x.storage.path && x.ocr && x.ocr.robust;
  });
  const leicht = mitOcr.filter((d) => (d.data().ocr.robust.attempts || 2) <= 2);
  const schwer = mitOcr.filter((d) => (d.data().ocr.robust.attempts || 2) >= 3);
  // ANDERE Stichprobe als Runde 1 (Ende der Sortierung statt Anfang) —
  // sonst validieren wir an denselben Bons, an denen die Regel entstand.
  const sample = [...leicht.sort((a, b) => a.id.localeCompare(b.id)).slice(-40),
                  ...schwer.sort((a, b) => a.id.localeCompare(b.id)).slice(-60)];
  console.log(`Stichprobe: ${sample.length} (40 leicht + ${Math.min(60, schwer.length)} schwer, FRISCHE Bons)`);

  let akzeptiert = 0, eskaliert = 0, falsch = 0, fehler = 0, langGate = 0;
  let akzL = 0, akzS = 0, nL = 0, nS = 0;
  const falschDetails = [];

  for (const d of sample) {
    const x = d.data();
    const istSchwer = (x.ocr.robust.attempts || 2) >= 3;
    if (istSchwer) nS++; else nL++;
    try {
      const [bytes] = await bucket.file(x.storage.path).download();
      const r1 = await extractReceipt(bytes, 'image/jpeg');
      const r2 = await extractReceipt(bytes, 'image/jpeg');
      const einig = sigOf(r1.parsed.items) === sigOf(r2.parsed.items);
      const rec = r1.parsed.isReceipt !== false && reconcile(r1.parsed).ok;
      const kurz = (r1.parsed.items || []).length <= MAX_ITEMS;
      if (einig && rec && !kurz) langGate++;
      if (einig && rec && kurz) {
        akzeptiert++;
        if (istSchwer) akzS++; else akzL++;
        const daneben = summe(r1.parsed.items) !== summe(x.items) || r1.parsed.items.length !== x.items.length;
        if (daneben) {
          falsch++;
          falschDetails.push(`${d.id.slice(0, 8)} (${istSchwer ? 'schwer' : 'leicht'}, ${r1.parsed.items.length} Art.): Σ ${summe(r1.parsed.items)} vs ${summe(x.items)}`);
        }
      } else {
        eskaliert++;
      }
    } catch (e) { fehler++; if (fehler <= 3) console.log('  FEHLER-DETAIL:', (e && (e.code || e.message) || String(e)).slice(0, 200)); }
  }

  const n = akzeptiert + eskaliert;
  console.log(`\nPhase-0-akzeptiert: ${akzeptiert}/${n} (${(akzeptiert / n * 100).toFixed(1)} %)`);
  console.log(`  leicht: ${akzL}/${nL} | schwer: ${akzS}/${nS}`);
  console.log(`  durch Kurz-Bon-Schranke eskaliert (wäre sonst akzeptiert): ${langGate}`);
  console.log(`\nFALSCH AKZEPTIERT: ${falsch}  ← muss 0 sein`);
  falschDetails.forEach((f) => console.log('  !', f));
  console.log(`Fehler (Netz o.ä.): ${fehler}`);
  process.exit(0);
}
lauf().catch((e) => { console.error('ABBRUCH:', e.message); process.exit(1); });
