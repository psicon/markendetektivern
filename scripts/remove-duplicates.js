const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'markendetektive-895f7'
});

const db = admin.firestore();

async function removeDuplicates() {
  console.log('🧹 Bereinige Achievement Duplikate...\n');
  
  const snapshot = await db.collection('achievements').get();
  const achievementsByName = {};
  
  // Gruppiere nach Namen
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const name = data.name || 'UNNAMED';
    
    if (!achievementsByName[name]) {
      achievementsByName[name] = [];
    }
    
    achievementsByName[name].push({
      id: doc.id,
      doc: doc,
      data: data,
      createdAt: data.createdAt?._seconds || 0
    });
  });
  
  console.log('📊 Gefundene Duplikate:\n');
  
  const toDelete = [];
  
  Object.entries(achievementsByName).forEach(([name, items]) => {
    if (items.length > 1) {
      console.log(`  ❌ "${name}": ${items.length} Dokumente`);
      
      // Sortiere nach createdAt (älteste zuerst)
      items.sort((a, b) => a.createdAt - b.createdAt);
      
      // Behalte das erste (älteste), lösche den Rest
      const keep = items[0];
      const deleteItems = items.slice(1);
      
      console.log(`     ✅ Behalte: ${keep.id}`);
      deleteItems.forEach(item => {
        console.log(`     🗑️  Lösche: ${item.id}`);
        toDelete.push(item.id);
      });
      console.log('');
    }
  });
  
  if (toDelete.length === 0) {
    console.log('✅ Keine Duplikate zu löschen!\n');
    process.exit(0);
  }
  
  console.log(`\n🗑️  Lösche ${toDelete.length} Duplikate...\n`);
  
  // Lösche die Duplikate
  const batch = db.batch();
  toDelete.forEach(id => {
    batch.delete(db.collection('achievements').doc(id));
  });
  
  await batch.commit();
  
  console.log('✅ Duplikate erfolgreich gelöscht!\n');
  
  // Zeige finalen Stand
  console.log('📋 VERBLEIBENDE ACHIEVEMENTS:');
  const finalSnapshot = await db.collection('achievements').get();
  finalSnapshot.docs.forEach(doc => {
    const data = doc.data();
    console.log(`  - ${data.name} (ID: ${doc.id})`);
  });
  
  process.exit(0);
}

removeDuplicates().catch(error => {
  console.error('❌ Fehler:', error);
  process.exit(1);
});
