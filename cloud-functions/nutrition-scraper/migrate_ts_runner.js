const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();

async function migrate(collection) {
  const snap = await db.collection(collection).get();
  let toFix = [];
  for (const d of snap.docs) {
    const x = d.data();
    const update = {};
    for (const f of ['nutritionUpdatedAt', 'ingredientsUpdatedAt']) {
      const v = x[f];
      if (typeof v === 'string') {
        const ms = Date.parse(v);
        if (Number.isFinite(ms)) update[f] = admin.firestore.Timestamp.fromMillis(ms);
      }
    }
    if (Object.keys(update).length > 0) toFix.push({ id: d.id, update });
  }
  console.log(collection + ': need to fix', toFix.length, 'docs');
  // Batch writes (max 500 per batch)
  let written = 0;
  for (let i = 0; i < toFix.length; i += 400) {
    const chunk = toFix.slice(i, i + 400);
    const batch = db.batch();
    for (const { id, update } of chunk) {
      batch.update(db.collection(collection).doc(id), update);
    }
    await batch.commit();
    written += chunk.length;
    console.log(collection + ': written', written + '/' + toFix.length);
  }
  return toFix.length;
}

(async () => {
  const a = await migrate('markenProdukte');
  const b = await migrate('produkte');
  console.log('Total migrated:', a + b);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
