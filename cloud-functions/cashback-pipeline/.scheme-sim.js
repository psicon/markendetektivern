'use strict';
/**
 * Simulation des "Billig-zuerst"-Schemas an denselben 60 Juli-Bons:
 *
 *   Phase 0 (NEU): 2 Lesungen OHNE Denken.
 *     Akzeptiert NUR wenn beide dieselbe (name#preis)-Sequenz liefern
 *     (Produktions-sigOf) UND die Reconciliation besteht (Produktions-
 *     reconcile: Σ Artikel == aufgedrucktes Bon-Total, inkl. Toleranzen).
 *   Sonst: heutiger Pfad unverändert (Denken an, Eskalation) — hier nicht
 *   simuliert, nur gezählt.
 *
 * Gemessen wird:
 *   • Wie viele Bons landen in Phase 0 (= Ersparnis-Anteil)?
 *   • FALSCH-AKZEPTIERT: Phase-0-Ergebnis weicht vom gespeicherten
 *     Konsens ab (Summe ODER Artikelzahl) — die entscheidende Zahl.
 *     Muss ~0 sein, sonst ist das Schema abzulehnen.
 */
process.env.CASHBACK_OCR_THINKING_BUDGET = '0';

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
  const sample = [...leicht.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 40),
                  ...schwer.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 20)];
  console.log(`Stichprobe: ${sample.length} (wie Regressionsläufe 1-3)`);

  let akzeptiert = 0, eskaliert = 0, falschAkzeptiert = 0, fehler = 0;
  let akzLeicht = 0, akzSchwer = 0, nLeicht = 0, nSchwer = 0;
  let tokensBillig = 0;
  const falschDetails = [];

  for (const d of sample) {
    const x = d.data();
    const istSchwer = (x.ocr.robust.attempts || 2) >= 3;
    if (istSchwer) nSchwer++; else nLeicht++;
    try {
      const [bytes] = await bucket.file(x.storage.path).download();
      const r1 = await extractReceipt(bytes, 'image/jpeg');
      const r2 = await extractReceipt(bytes, 'image/jpeg');
      tokensBillig += (r1.outputTokens || 0) + (r2.outputTokens || 0) + (r1.thoughtsTokens || 0) + (r2.thoughtsTokens || 0);

      const einig = sigOf(r1.parsed.items) === sigOf(r2.parsed.items);
      const rec = r1.parsed.isReceipt !== false && reconcile(r1.parsed).ok;
      if (einig && rec) {
        akzeptiert++;
        if (istSchwer) akzSchwer++; else akzLeicht++;
        // Gegen die Wahrheit: weicht das akzeptierte Ergebnis vom
        // gespeicherten Konsens ab?
        const falsch = summe(r1.parsed.items) !== summe(x.items) || r1.parsed.items.length !== x.items.length;
        if (falsch) {
          falschAkzeptiert++;
          falschDetails.push(`${d.id.slice(0, 8)} (${istSchwer ? 'schwer' : 'leicht'}): Σ ${summe(r1.parsed.items)} vs ${summe(x.items)}, n ${r1.parsed.items.length} vs ${x.items.length}`);
        }
      } else {
        eskaliert++;
      }
    } catch (e) {
      fehler++;
    }
  }

  const n = akzeptiert + eskaliert;
  console.log(`\nPhase-0-akzeptiert:  ${akzeptiert}/${n} (${(akzeptiert / n * 100).toFixed(1)} %)`);
  console.log(`  leicht: ${akzLeicht}/${nLeicht} | schwer: ${akzSchwer}/${nSchwer}`);
  console.log(`eskaliert (heutiger Pfad): ${eskaliert}`);
  console.log(`\nFALSCH AKZEPTIERT: ${falschAkzeptiert}  ← muss ~0 sein`);
  falschDetails.forEach((f) => console.log('  !', f));
  console.log(`\nØ Output+Denk-Tokens je Bon (2 billige Lesungen): ${Math.round(tokensBillig / Math.max(n, 1))}`);
  console.log(`Fehler (Netz o.ä.): ${fehler}`);
  process.exit(0);
}
lauf().catch((e) => { console.error('ABBRUCH:', e.message); process.exit(1); });
