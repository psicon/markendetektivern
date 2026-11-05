'use strict';
/** Ablehnung der nicht freigabefähigen pending crowd_uploads (Runde 03.09.2026) —
 *  wie am 27.08.: status 'rejected' + maschineller rejectReason + reviewNote im
 *  positiven Ton (was fehlt + was beim nächsten Mal klappt). DRY_RUN=1 → nur listen. */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const fs = require('fs');
const DRY = process.env.DRY_RUN === '1';
const HOLD = new Set(process.env.HOLD_JSON ? JSON.parse(fs.readFileSync(process.env.HOLD_JSON, 'utf8')) : []);
const { rows } = JSON.parse(fs.readFileSync(process.env.ROWS_JSON, 'utf8')).rows.filter((r) => !HOLD.has(r.id)) && { rows: JSON.parse(fs.readFileSync(process.env.ROWS_JSON, 'utf8')).rows.filter((r) => !HOLD.has(r.id)) };
const verdicts = JSON.parse(fs.readFileSync(process.env.VERDICTS_JSON, 'utf8'));
const md5dups = new Set(); const owner = new Map();
for (const r of rows) for (const m of r.md5s) { const prev = owner.get(m.md5); if (prev && prev !== r.id) { md5dups.add(r.id); md5dups.add(prev); } else owner.set(m.md5, r.id); }
const SLOT_DE = { front: 'Vorderseite', rueckseite: 'Rückseite', hersteller: 'Herstellerangabe', ean: 'Barcode/EAN', naehrwerte: 'Nährwerttabelle', zutaten: 'Zutatenliste', preis: 'Preisschild' };
function decide(r) {
  const reasons = []; const notes = [];
  if (r.missing.length) { reasons.push('unvollstaendig'); notes.push(`Es fehlen: ${r.missing.map((k) => SLOT_DE[k] || k).join(', ')}. Alle 7 Fotos zusammen machen den Datensatz komplett.`); }
  if (r.broken.length) { reasons.push('bild_defekt'); notes.push(`Foto nicht lesbar: ${r.broken.map((k) => SLOT_DE[k] || k).join(', ')}.`); }
  if (!r.eanOk) { reasons.push('ean_fehlt'); notes.push('Der Barcode (EAN, 8–14 Ziffern) ist Pflicht — er ordnet das Produkt eindeutig zu.'); }
  if (!r.name) { reasons.push('kein_produktname'); notes.push('Der Produktname war nicht erkennbar — die Vorderseite gut ausgeleuchtet und ohne Spiegelung fotografieren.'); }
  if (r.dupApproved) { reasons.push('produkt_bereits_verguetet'); notes.push('Dieses Produkt hast du schon eingereicht und es wurde bereits vergütet — jedes Produkt zählt einmal.'); }
  if (r.dupPending) { reasons.push('doppelt_eingereicht'); notes.push('Doppelt eingereicht — die frühere Einreichung zählt.'); }
  if (md5dups.has(r.id)) { reasons.push('bilder_wiederverwendet'); notes.push('Dieselben Fotos wurden schon für eine andere Einreichung verwendet — pro Produkt bitte eigene Aufnahmen.'); }
  if (verdicts[r.id]?.echt === false) { reasons.push('fotos_unpassend'); notes.push(`Die Fotos zeigen nicht das erwartete Produkt (${verdicts[r.id].grund}).`); }
  return { reasons, notes };
}
(async () => {
  const todo = rows.map((r) => ({ r, ...decide(r) })).filter((t) => t.reasons.length);
  const byReason = {}; todo.forEach((t) => t.reasons.forEach((x) => { byReason[x] = (byReason[x] || 0) + 1; }));
  console.log(`Abzulehnen: ${todo.length} von ${rows.length}${DRY ? ' (DRY)' : ''} | Gründe: ${JSON.stringify(byReason)}`);
  if (DRY) { todo.slice(0, 15).forEach((t) => console.log('  ', t.r.id, '|', (t.r.name || '(ohne Name)').slice(0, 30), '|', t.reasons.join(','))); process.exit(0); }
  let done = 0;
  for (const t of todo) {
    const ref = db.doc(`crowd_uploads/${t.r.id}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().status !== 'pending') return;
      tx.update(ref, {
        status: 'rejected', rejectReason: t.reasons[0], holdReasons: t.reasons,
        reviewNote: `Prüfung 04.09.2026: ${t.notes.join(' ')} Beim nächsten Produkt klappt es — danke fürs Mitmachen!`,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    done++;
  }
  console.log(`Abgelehnt: ${done}`);
  process.exit(0);
})().catch((e) => { console.error('ABBRUCH', e); process.exit(1); });
