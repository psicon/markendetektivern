const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN_SDK)),
    databaseURL: 'https://markendetektive-895f7.firebaseio.com'
  });
}

const db = admin.firestore();

async function checkUserLevels() {
  try {
    console.log('🔍 Prüfe User-Level-Daten...');
    
    const usersSnapshot = await db.collection('users').limit(10).get();
    
    if (usersSnapshot.empty) {
      console.log('❌ Keine User in der DB gefunden');
      return;
    }
    
    console.log(`Gefundene Users: ${usersSnapshot.size}`);
    console.log('=====================================');
    
    usersSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`👤 User: ${doc.id}`);
      console.log(`  ├─ stats.currentLevel: ${data.stats?.currentLevel || 'undefined'}`);
      console.log(`  ├─ stats.pointsTotal: ${data.stats?.pointsTotal || 'undefined'}`);
      console.log(`  ├─ stats.savingsTotal: ${data.stats?.savingsTotal || 'undefined'}`);
      console.log(`  ├─ level (legacy): ${data.level || 'undefined'}`);
      console.log(`  ├─ totalSavings: ${data.totalSavings || 'undefined'}`);
      console.log(`  ├─ stats object exists: ${!!data.stats}`);
      console.log(`  └─ lastActivityAt: ${data.lastActivityAt ? new Date(data.lastActivityAt._seconds * 1000).toLocaleString() : 'undefined'}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Fehler beim Prüfen der User-Daten:', error);
  }
  
  process.exit(0);
}

checkUserLevels();
