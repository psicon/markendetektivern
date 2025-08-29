const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'markendetektive-895f7'
});

const db = admin.firestore();

async function migrateStructure() {
  console.log('🔄 MIGRATION: Vereinfache Firestore Struktur...\n');
  
  try {
    // 1. LEVELS MIGRATION
    console.log('📊 Migriere Levels...');
    const levelsSnapshot = await db.collection('gamification').doc('config').collection('levels').get();
    
    if (!levelsSnapshot.empty) {
      const batch = db.batch();
      
      // Kopiere alle Levels nach /gamification/levels
      levelsSnapshot.docs.forEach(doc => {
        const newRef = db.collection('gamification').doc('levels').collection('items').doc(doc.id);
        batch.set(newRef, doc.data());
      });
      
      await batch.commit();
      console.log(`  ✅ ${levelsSnapshot.size} Levels migriert\n`);
    }
    
    // 2. ACTIONS MIGRATION
    console.log('🎮 Migriere Actions...');
    const actionsDoc = await db.collection('gamification').doc('config').collection('actions').doc('config').get();
    
    if (actionsDoc.exists) {
      await db.collection('gamification').doc('actions').set(actionsDoc.data());
      console.log('  ✅ Actions Config migriert\n');
    }
    
    // 3. STREAKS MIGRATION
    console.log('🔥 Migriere Streaks...');
    const streaksDoc = await db.collection('gamification').doc('config').collection('streaks').doc('config').get();
    
    if (streaksDoc.exists) {
      await db.collection('gamification').doc('streaks').set(streaksDoc.data());
      console.log('  ✅ Streaks Config migriert\n');
    }
    
    console.log('🗑️  Lösche alte config Subcollection...');
    
    // Lösche alte Struktur
    const deleteOld = async () => {
      // Lösche levels
      const levelsToDelete = await db.collection('gamification').doc('config').collection('levels').get();
      const batch1 = db.batch();
      levelsToDelete.docs.forEach(doc => batch1.delete(doc.ref));
      await batch1.commit();
      
      // Lösche actions
      const actionsToDelete = await db.collection('gamification').doc('config').collection('actions').get();
      const batch2 = db.batch();
      actionsToDelete.docs.forEach(doc => batch2.delete(doc.ref));
      await batch2.commit();
      
      // Lösche streaks
      const streaksToDelete = await db.collection('gamification').doc('config').collection('streaks').get();
      const batch3 = db.batch();
      streaksToDelete.docs.forEach(doc => batch3.delete(doc.ref));
      await batch3.commit();
      
      // Lösche config document selbst
      await db.collection('gamification').doc('config').delete();
    };
    
    await deleteOld();
    console.log('  ✅ Alte Struktur gelöscht\n');
    
    console.log('📁 NEUE STRUKTUR:');
    console.log('  /gamification/levels/items/{1,2,3...}');
    console.log('  /gamification/actions');
    console.log('  /gamification/streaks\n');
    
    console.log('✅ Migration abgeschlossen!');
    
  } catch (error) {
    console.error('❌ Fehler bei Migration:', error);
  }
  
  process.exit(0);
}

migrateStructure();
