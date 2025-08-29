const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'markendetektive-895f7'
});

const db = admin.firestore();

async function checkAchievements() {
  console.log('🔍 Prüfe Achievements in Firestore...\n');
  
  const snapshot = await db.collection('achievements').get();
  const achievements = {};
  const allDocs = [];
  
  snapshot.docs.forEach(doc => {
    const data = doc.data();
    allDocs.push({
      id: doc.id,
      name: data.name,
      trigger: data.trigger?.action
    });
    
    const key = data.name || 'UNNAMED';
    if (!achievements[key]) {
      achievements[key] = [];
    }
    achievements[key].push({
      id: doc.id,
      trigger: data.trigger?.action
    });
  });
  
  console.log(`📊 GESAMT: ${snapshot.size} Achievement-Dokumente\n`);
  console.log('🔍 DUPLIKAT-CHECK:\n');
  
  let hasDuplicates = false;
  
  Object.entries(achievements).forEach(([name, items]) => {
    if (items.length > 1) {
      hasDuplicates = true;
      console.log(`  ❌ "${name}": ${items.length} mal vorhanden`);
      items.forEach(item => {
        console.log(`     - ID: ${item.id}`);
        console.log(`       Action: ${item.trigger}`);
      });
      console.log('');
    }
  });
  
  if (!hasDuplicates) {
    console.log('  ✅ Keine Duplikate gefunden!\n');
  }
  
  console.log('📋 ALLE ACHIEVEMENTS:');
  allDocs.forEach(doc => {
    console.log(`  - ${doc.name} (ID: ${doc.id})`);
  });
  
  process.exit(0);
}

checkAchievements().catch(error => {
  console.error('❌ Fehler:', error);
  process.exit(1);
});
