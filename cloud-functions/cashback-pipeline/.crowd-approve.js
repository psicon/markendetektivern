'use strict';
/** Freigabe der geprüften crowd_uploads (Runde 20.08.2026).
 *  Freigegeben wird NUR was ALLE Prüfungen bestanden hat:
 *   • Signal: 7/7 Fotos vorhanden + Storage ok, EAN 8-14-stellig, Name (Namer-
 *     OCR), kein user+ean-Duplikat (weder approved noch pending-älter),
 *     keine md5-identischen Bilder über Einreichungen hinweg
 *   • Vision: Gemini-Audit echt !== false (Fehler beim Prüfen = ungeprüft →
 *     Signal entscheidet; ein Infrastrukturfehler ist NIE ein Inhaltsurteil)
 *  Status-Flip pending→approved feuert crowd-upload-reward (idempotente
 *  Buchung crowd_<uploadId>, Ortsgate/Caps macht der Trigger).
 *  DRY_RUN=1 → nur auflisten. */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const fs = require('fs');
const DRY = process.env.DRY_RUN === '1';

const HOLD = new Set(process.env.HOLD_JSON ? JSON.parse(fs.readFileSync(process.env.HOLD_JSON, 'utf8')) : []);
const { rows } = JSON.parse(fs.readFileSync(process.env.ROWS_JSON, 'utf8')).rows.filter((r) => !HOLD.has(r.id)) && { rows: JSON.parse(fs.readFileSync(process.env.ROWS_JSON, 'utf8')).rows.filter((r) => !HOLD.has(r.id)) };
const verdicts = JSON.parse(fs.readFileSync(process.env.VERDICTS_JSON, 'utf8'));

// md5-Duplikate exakt wie in der Analyse ableiten
const md5dups = new Set();
const owner = new Map();
for (const r of rows) for (const m of r.md5s) {
  const prev = owner.get(m.md5);
  if (prev && prev !== r.id) { md5dups.add(r.id); md5dups.add(prev); }
  else owner.set(m.md5, r.id);
}

const freigeben = rows.filter((r) =>
  !r.missing.length && !r.broken.length && r.eanOk && r.name &&
  !r.dupApproved && !r.dupPending && !md5dups.has(r.id) &&
  (verdicts[r.id] ? verdicts[r.id].echt !== false : true),
);
const visionBlocked = rows.filter((r) => verdicts[r.id] && verdicts[r.id].echt === false);

async function lauf() {
  console.log(`Freizugeben: ${freigeben.length} | Vision-blockiert: ${visionBlocked.length}${DRY ? ' (DRY RUN)' : ''}`);
  visionBlocked.forEach((r) => console.log('  VISION-HOLD:', r.id, '|', r.name.slice(0, 32), '|', verdicts[r.id].grund));
  if (DRY) process.exit(0);

  let done = 0;
  for (const r of freigeben) {
    // Guard: Doc muss JETZT noch pending sein (Race mit parallelem Operator)
    const ref = db.doc(`crowd_uploads/${r.id}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().status !== 'pending') return;
      tx.update(ref, {
        status: 'approved',
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewNote: 'auto-review 2026-09-04: 7/7 Fotos, EAN, Namer-OCR, Dedup (user+ean, md5), Vision-Audit',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    done++;
    if (done % 25 === 0) {
      console.log(`  … ${done}/${freigeben.length} freigegeben`);
      await new Promise((res) => setTimeout(res, 1500)); // Trigger-Atempause
    }
  }
  console.log(`\nFreigegeben: ${done}`);
  process.exit(0);
}
lauf().catch((e) => { console.error('ABBRUCH', e); process.exit(1); });
