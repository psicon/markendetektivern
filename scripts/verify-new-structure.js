const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'markendetektive-895f7'
});

const db = admin.firestore();

async function verifyStructure() {
  console.log('🔍 VERIFIZIERE NEUE FIRESTORE STRUKTUR...\n');
  
  try {
    // 1. CHECK LEVELS
    console.log('📊 Levels:');
    const levelsSnapshot = await db.collection('gamification').doc('levels').collection('items').get();
    console.log(`  ✅ ${levelsSnapshot.size} Levels gefunden`);
    if (levelsSnapshot.size > 0) {
      const firstLevel = levelsSnapshot.docs[0].data();
      console.log(`  → Beispiel: Level ${firstLevel.id} - ${firstLevel.name}\n`);
    }
    
    // 2. CHECK ACTIONS
    console.log('🎮 Actions:');
    const actionsDoc = await db.collection('gamification').doc('actions').get();
    if (actionsDoc.exists) {
      const data = actionsDoc.data();
      const actionCount = Object.keys(data.actions || {}).length;
      console.log(`  ✅ Actions Config gefunden mit ${actionCount} Actions`);
      console.log(`  → Beispiel Actions:`, Object.keys(data.actions || {}).slice(0, 3).join(', '), '\n');
    } else {
      console.log('  ❌ Actions Config nicht gefunden!\n');
    }
    
    // 3. CHECK STREAKS
    console.log('🔥 Streaks:');
    const streaksDoc = await db.collection('gamification').doc('streaks').get();
    if (streaksDoc.exists) {
      const data = streaksDoc.data();
      console.log(`  ✅ Streaks Config gefunden`);
      console.log(`  → ${data.tiers?.length || 0} Streak Tiers`);
      console.log(`  → Active Events:`, data.activeEvents?.join(', '), '\n');
    } else {
      console.log('  ❌ Streaks Config nicht gefunden!\n');
    }
    
    // 4. CHECK ALTE STRUKTUR
    console.log('🗑️  Prüfe ob alte config/ Struktur noch existiert:');
    const oldConfig = await db.collection('gamification').doc('config').get();
    if (oldConfig.exists) {
      console.log('  ⚠️  WARNUNG: Alte config Struktur noch vorhanden!');
    } else {
      console.log('  ✅ Alte config Struktur erfolgreich gelöscht');
    }
    
    console.log('\n✅ NEUE STRUKTUR:');
    console.log('  /gamification/levels/items/{1,2,3...}');
    console.log('  /gamification/actions');
    console.log('  /gamification/streaks');
    console.log('  /achievements/{...}\n');
    
  } catch (error) {
    console.error('❌ Fehler:', error);
  }
  
  process.exit(0);
}

verifyStructure();
