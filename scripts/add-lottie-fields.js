const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_ADMIN_SDK)),
    databaseURL: 'https://markendetektive-895f7.firebaseio.com'
  });
}

const db = admin.firestore();

/**
 * Fügt lottieAnimation Felder zu Levels und Achievements hinzu
 */
async function addLottieFields() {
  console.log('🎬 Füge Lottie-Animation Felder hinzu...\n');
  
  try {
    // 1. LEVELS erweitern
    console.log('📊 Erweitere Level-Dokumente...');
    const levelsSnapshot = await db.collection('gamification').doc('levels').collection('items').get();
    
    const levelUpdates = [];
    levelsSnapshot.forEach(doc => {
      const levelId = parseInt(doc.id);
      const lottieAnimation = `level-${levelId}`; // level-1, level-2, etc.
      
      levelUpdates.push(
        doc.ref.update({ lottieAnimation })
      );
      
      console.log(`  ✅ Level ${levelId} → lottieAnimation: "${lottieAnimation}"`);
    });
    
    await Promise.all(levelUpdates);
    console.log(`✅ ${levelUpdates.length} Level-Dokumente erweitert\n`);

    // 2. ACHIEVEMENTS erweitern
    console.log('🏆 Erweitere Achievement-Dokumente...');
    const achievementsSnapshot = await db.collection('achievements').get();
    
    // Achievement-spezifische Lottie-Mappings
    const achievementLottieMap = {
      'first_scan': 'first-scan',
      'first_conversion': 'first-conversion', 
      'streak_7_days': 'streak-7',
      'savings_100_euro': 'savings-100',
      'shopping_master': 'shopping-master',
      'rate_expert': 'rate-expert'
    };
    
    const achievementUpdates = [];
    achievementsSnapshot.forEach(doc => {
      const data = doc.data();
      const achievementId = doc.id;
      
      // Bestimme Animation basierend auf Achievement-Typ oder ID
      let lottieAnimation = achievementLottieMap[achievementId] || 'achievement-unlock';
      
      // Spezielle Logik basierend auf Achievement-Daten
      if (data.trigger?.action === 'scan_product') {
        lottieAnimation = 'first-scan';
      } else if (data.trigger?.action === 'convert_product') {
        lottieAnimation = 'first-conversion';
      } else if (data.name?.includes('Streak')) {
        lottieAnimation = 'streak-7';
      } else if (data.name?.includes('100')) {
        lottieAnimation = 'savings-100';
      }
      
      achievementUpdates.push(
        doc.ref.update({ lottieAnimation })
      );
      
      console.log(`  ✅ "${data.name}" → lottieAnimation: "${lottieAnimation}"`);
    });
    
    await Promise.all(achievementUpdates);
    console.log(`✅ ${achievementUpdates.length} Achievement-Dokumente erweitert\n`);
    
    // 3. ZUSAMMENFASSUNG
    console.log('🎉 LOTTIE-INTEGRATION ABGESCHLOSSEN!');
    console.log(`📊 Levels mit Animation: ${levelUpdates.length}`);
    console.log(`🏆 Achievements mit Animation: ${achievementUpdates.length}`);
    console.log('\n💡 NÄCHSTE SCHRITTE:');
    console.log('1. Platziere deine .json Files in /assets/lottie/');
    console.log('2. Nutze die Namen aus den Firestore-Dokumenten');
    console.log('3. Teste Level-Ups und Achievement-Unlocks!');
    console.log('\n🎬 Verfügbare Animationen:');
    console.log('- level-1.json bis level-10.json');
    console.log('- first-scan.json, first-conversion.json');
    console.log('- streak-7.json, savings-100.json');
    console.log('- achievement-unlock.json (Standard)');
    
  } catch (error) {
    console.error('❌ Fehler beim Hinzufügen der Lottie-Felder:', error);
  }
  
  process.exit(0);
}

addLottieFields();
