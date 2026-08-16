'use strict';
/**
 * Regressionsmessung: Bon-OCR mit Denk-Budget 0 gegen die gespeicherten
 * Konsens-Ergebnisse der Juli-Bons.
 *
 * Vergleichsmaßstab je Bon (gespeichertes ocr = Konsens aus 2+ Lesungen,
 * reconciliation-geprüft — der beste verfügbare Näherungswert an die
 * Wahrheit):
 *   • summeGleich:  Σ priceCents der neuen Lesung == Σ der gespeicherten
 *   • anzahlGleich: gleiche Artikelanzahl
 *   • zeilenTreffer: Anteil identischer (normName#price)-Paare
 *   • denkTokens:   muss 0 sein (beweist, dass das Flag greift)
 *
 * Geschichtet: normale Bons (attempts<=2) UND schwere (attempts>=3) — bei
 * den schweren ist die Frage, ob eine dümmere Flash-Lesung öfter in die
 * teure Pro-Eskalation liefe.
 */
process.env.CASHBACK_OCR_THINKING_BUDGET = process.env.REG_BUDGET || '0';

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7', storageBucket: 'markendetektive-895f7.appspot.com' });
const db = admin.firestore();
const bucket = admin.storage().bucket();
const { extractReceipt } = require('./lib/ocr');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
const paare = (items) => (items || []).map((i) => `${norm(i.raw != null ? i.raw : i.name)}#${i.priceCents}`);
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
  // Deterministisch mischen (sortiert nach id), dann Schichten ziehen.
  const sample = [...leicht.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 40),
                  ...schwer.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 20)];
  console.log(`Grundmenge: ${mitOcr.length} Juli-Bons (leicht ${leicht.length} / schwer ${schwer.length}) → Stichprobe ${sample.length}`);

  const erg = [];
  let denkTokensGesamt = 0;
  for (const d of sample) {
    const x = d.data();
    const pfad = x.storage.path;
    try {
      const [bytes] = await bucket.file(pfad).download();
      const r = await extractReceipt(bytes, 'image/jpeg');
      const u = r && r.usage ? r.usage : {};
      const neu = r.parsed && Array.isArray(r.parsed.items) ? r.parsed.items : [];
      const alt = x.items;
      const pAlt = paare(alt); const pNeu = paare(neu);
      const setAlt = new Map(); pAlt.forEach((p) => setAlt.set(p, (setAlt.get(p) || 0) + 1));
      let treffer = 0;
      pNeu.forEach((p) => { const c = setAlt.get(p) || 0; if (c > 0) { treffer++; setAlt.set(p, c - 1); } });
      const zeilenTreffer = pAlt.length ? treffer / Math.max(pAlt.length, pNeu.length) : 0;
      const denk = (r.thoughtsTokens != null ? r.thoughtsTokens : (u.thoughtsTokenCount || 0)) || 0;
      denkTokensGesamt += denk;
      erg.push({
        id: d.id.slice(0, 8), schwer: (x.ocr.robust.attempts || 2) >= 3,
        summeGleich: summe(neu) === summe(alt),
        anzahlGleich: neu.length === alt.length,
        zeilenTreffer, out: r.outputTokens, denk,
      });
    } catch (e) {
      erg.push({ id: d.id.slice(0, 8), fehler: e.code || e.message.slice(0, 60) });
    }
  }

  const ok = erg.filter((e) => !e.fehler);
  const q = (arr, f) => arr.length ? (arr.filter(f).length / arr.length * 100).toFixed(1) : '—';
  const mittel = (arr, k) => arr.length ? Math.round(arr.reduce((s, e) => s + (e[k] || 0), 0) / arr.length) : 0;
  const zt = (arr) => arr.length ? (arr.reduce((s, e) => s + e.zeilenTreffer, 0) / arr.length * 100).toFixed(1) : '—';

  for (const [name, teil] of [['GESAMT', ok], ['leicht', ok.filter((e) => !e.schwer)], ['schwer', ok.filter((e) => e.schwer)]]) {
    console.log(`\n${name} (n=${teil.length}):`);
    console.log(`  Summe identisch:   ${q(teil, (e) => e.summeGleich)} %`);
    console.log(`  Anzahl identisch:  ${q(teil, (e) => e.anzahlGleich)} %`);
    console.log(`  Zeilen-Treffer:    ${zt(teil)} %`);
    console.log(`  Ø Output-Tokens:   ${mittel(teil, 'out')}`);
  }
  console.log(`\nDenk-Tokens über alle Läufe: ${denkTokensGesamt} (muss 0 sein)`);
  console.log(`Fehler: ${erg.length - ok.length}`);
  erg.filter((e) => e.fehler).slice(0, 5).forEach((e) => console.log('  !', e.id, e.fehler));
  process.exit(0);
}
lauf().catch((e) => { console.error('ABBRUCH:', e.message); process.exit(1); });
