#!/usr/bin/env node

/**
 * Script zum Entfernen der lottieAnimation Felder aus Firebase
 * Da wir jetzt ein vollständig lokales System verwenden
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://markendetektivern.firebaseio.com'
});

const db = admin.firestore();

async function removeLottieFields() {
  try {
    console.log('🧹 Entferne lottieAnimation Felder aus Firestore...\n');

    // Remove from levels
    const levelsSnapshot = await db.collection('levels').get();
    console.log(`📊 Gefundene Level: ${levelsSnapshot.size}`);
    
    const batch1 = db.batch();
    levelsSnapshot.forEach(doc => {
      if (doc.data().lottieAnimation) {
        console.log(`  ❌ Entferne lottieAnimation aus Level ${doc.data().id}`);
        batch1.update(doc.ref, {
          lottieAnimation: admin.firestore.FieldValue.delete()
        });
      }
    });
    await batch1.commit();
    console.log('✅ Level lottieAnimation Felder entfernt\n');

    // Remove from achievements
    const achievementsSnapshot = await db.collection('achievements').get();
    console.log(`🏆 Gefundene Achievements: ${achievementsSnapshot.size}`);
    
    const batch2 = db.batch();
    achievementsSnapshot.forEach(doc => {
      if (doc.data().lottieAnimation) {
        console.log(`  ❌ Entferne lottieAnimation aus Achievement "${doc.data().name}"`);
        batch2.update(doc.ref, {
          lottieAnimation: admin.firestore.FieldValue.delete()
        });
      }
    });
    await batch2.commit();
    console.log('✅ Achievement lottieAnimation Felder entfernt\n');

    console.log('🎉 Cleanup abgeschlossen!');
    console.log('📝 System nutzt jetzt vollständig lokale Lottie-Zuordnungen');
    
  } catch (error) {
    console.error('❌ Fehler beim Cleanup:', error);
  } finally {
    process.exit(0);
  }
}

// Ausführen
removeLottieFields();
