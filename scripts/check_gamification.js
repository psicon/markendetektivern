const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK || '{}');

if (!serviceAccount.project_id) {
  console.error('❌ Firebase Admin SDK nicht konfiguriert');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkConfig() {
  console.log('=== CHECKING GAMIFICATION CONFIG ===\n');
  
  // Check actions
  const actionsDoc = await db.doc('gamification/actions').get();
  console.log('📋 Actions Document exists:', actionsDoc.exists);
  
  if (actionsDoc.exists) {
    const data = actionsDoc.data();
    console.log('\n🎮 Available Actions:');
    for (const [action, config] of Object.entries(data)) {
      console.log(`  ${action}: ${config.points} points`);
      if (config.antiAbuse) {
        if (config.antiAbuse.dailyCap) console.log(`    - Daily cap: ${config.antiAbuse.dailyCap}`);
        if (config.antiAbuse.weeklyCap) console.log(`    - Weekly cap: ${config.antiAbuse.weeklyCap}`);
        if (config.antiAbuse.oneTime) console.log(`    - One-time only`);
      }
    }
  }
  
  // Check levels  
  const levelsSnap = await db.collection('gamification/levels/items').orderBy('id').get();
  console.log('\n📊 Levels:', levelsSnap.size);
  
  levelsSnap.forEach(doc => {
    const level = doc.data();
    console.log(`  Level ${level.id}: ${level.name}`);
    console.log(`    - Points required: ${level.pointsRequired}`);
    console.log(`    - Savings required: ${level.savingsRequired}€`);
  });
  
  process.exit(0);
}

checkConfig().catch(console.error);
