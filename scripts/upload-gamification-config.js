const admin = require('firebase-admin');

// Initialize Admin SDK mit Service Account
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'markendetektive-895f7'
});

const db = admin.firestore();

// === LEVEL CONFIGURATION ===
const levels = [
  {
    id: 1,
    name: 'Sparanfänger',
    description: 'Der erste Schritt',
    savingsRequired: 0,
    pointsRequired: 0,
    reward: 'Zugang zu allen Grundfunktionen',
    icon: 'pawprint',
    color: '#BF8970',
    lottieAnimation: 'level_up_simple',
  },
  {
    id: 2,
    name: 'Erster Schritt',
    description: 'Schon nach deiner ersten Aktion erreichst du Level 2',
    savingsRequired: 0,
    pointsRequired: 10,
    reward: 'Badge: Erster Schritt',
    icon: 'trophy',
    color: '#FFB74D',
    lottieAnimation: 'confetti_short',
  },
  {
    id: 3,
    name: 'Sparfuchs',
    description: 'Ein paar Aktionen weiter – noch ohne Ersparnis',
    savingsRequired: 0,
    pointsRequired: 30,
    reward: 'Profilrahmen Bronze',
    icon: 'trophy.fill',
    color: '#81C784',
    lottieAnimation: 'badge_pulse',
  },
  {
    id: 4,
    name: 'Preisjäger',
    description: 'Ab hier zählen Punkte UND echte Ersparnis',
    savingsRequired: 20,
    pointsRequired: 80,
    reward: 'Neue Kategorie freigeschaltet',
    icon: 'pawprint.fill',
    color: '#FFD54F',
    lottieAnimation: 'sparkle_long',
  },
  {
    id: 5,
    name: 'Einkaufsdetektiv',
    description: 'Aktive Nutzung & erste größere Ersparnis',
    savingsRequired: 50,
    pointsRequired: 200,
    reward: 'Profilrahmen Silber',
    icon: 'star.fill',
    color: '#FF6B6B',
    lottieAnimation: 'level_up_wave',
  },
  {
    id: 6,
    name: 'Clever Shopper',
    description: 'Die Kurve wird steiler',
    savingsRequired: 150,
    pointsRequired: 500,
    reward: 'Neue Kategorie freigeschaltet',
    icon: 'star.circle',
    color: '#5AC8FA',
    lottieAnimation: 'medal_spin',
  },
  {
    id: 7,
    name: 'Deal Hunter',
    description: 'Nur wer regelmäßig spart, kommt weiter',
    savingsRequired: 400,
    pointsRequired: 1000,
    reward: 'Spezialmissionen',
    icon: 'rosette',
    color: '#7E57C2',
    lottieAnimation: 'burst',
  },
  {
    id: 8,
    name: 'Profi-Sparer',
    description: 'Starker Grind – dafür Goldrahmen',
    savingsRequired: 700,
    pointsRequired: 1800,
    reward: 'Profilrahmen Gold + Badge',
    icon: 'crown',
    color: '#FBC02D',
    lottieAnimation: 'crown_shine',
  },
  {
    id: 9,
    name: 'Regal-König',
    description: 'Die Königsklasse der NoName-Jäger',
    savingsRequired: 1200,
    pointsRequired: 3000,
    reward: 'Neue Kategorie freigeschaltet',
    icon: 'crown.fill',
    color: '#FFA726',
    lottieAnimation: 'king_sparkle',
  },
  {
    id: 10,
    name: 'Marken-Detektiv',
    description: 'Maximaler Titel – Prestige',
    savingsRequired: 2000,
    pointsRequired: 5000,
    reward: 'Prestige-Titel',
    icon: 'star.circle.fill',
    color: '#FF5252',
    lottieAnimation: 'fireworks_full',
  },
];

// === ACTIONS CONFIGURATION ===
const actions = {
  first_action_any: { 
    points: 10, 
    oneTime: true, 
    notes: "Erster Scan ODER erste Suche ODER erster Vergleich" 
  },
  scan_product: { 
    points: 2, 
    dailyCap: 10, 
    dedupeWindowSec: 10 
  },
  view_comparison: { 
    points: 3, 
    dailyCap: 10, 
    dedupeWindowSec: 10 
  },
  search_product: { 
    points: 1, 
    dailyCap: 10, 
    dedupeWindowSec: 5 
  },
  complete_shopping: { 
    points: 5, 
    weeklyCap: 5, 
    notes: "Einkaufszettel leer gekauft" 
  },
  submit_rating: { 
    points: 2, 
    dailyCap: 5, 
    minTextLength: 20 
  },
  mission_daily_done: { 
    points: 5, 
    dailyCap: 1 
  },
  mission_weekly_done: { 
    points: 15, 
    weeklyCap: 1 
  }
};

// === STREAKS CONFIGURATION ===
const streaksConfig = {
  activeEvents: ["scan_product", "view_comparison", "complete_shopping"],
  tiers: [
    { minDays: 1, maxDays: 6, dailyBonusPoints: 1 },
    { minDays: 7, maxDays: 13, dailyBonusPoints: 2 },
    { minDays: 14, maxDays: 20, dailyBonusPoints: 3 },
    { minDays: 21, maxDays: 27, dailyBonusPoints: 4 },
    { minDays: 28, maxDays: 999, dailyBonusPoints: 5 }
  ],
  freeze: {
    grantedEveryDays: 7,
    maxHeld: 2
  }
};

// === ACHIEVEMENTS TO UPDATE ===
const achievementsToUpdate = [
  { id: 'vQJQu2kerTflnr2s1vTe', lottieAnimation: 'sparkle_short' }, // Erste Umwandlung
  { id: '1wM3SojnifR6mJDci6HX', lottieAnimation: 'checkmark_rise' }, // Einkaufszettelmaster
  { id: 'GbBQ3bLfN8ug5ShQ4odQ', lottieAnimation: 'bar_grow' }, // Vergleichsexperte
  { id: 'DxbuRI4WTW1Nchq7ISqi', lottieAnimation: 'chat_pop' }, // Feedbackgeber
  { id: 'UcO5xJgps0kUIg8V32li', lottieAnimation: 'heart_bounce' }, // Treu bleiben
  { id: 'LtIGWnXLOnBhZoYArWJQ', lottieAnimation: 'scan_line' }, // Scanner-Profi
  { id: 'qeiJYGXhcxZ6IXexOIAR', lottieAnimation: 'search_glow' }, // Suchmeister
  { id: 'KCvFn5YurtpqgLMuNX81', lottieAnimation: 'bookmark_drop' }, // Sammler
];

// === NEW ACHIEVEMENTS TO ADD ===
const newAchievements = [
  {
    name: 'Es geht los!',
    description: 'Deine erste Aktion in MarkenDetektive',
    points: 5,
    icon: 'hand.thumbsup',
    type: 'one-time',
    trigger: {
      action: 'first_action_any',
      target: 1
    },
    isActive: true,
    sortOrder: 0,
    color: '#8E8E93',
    lottieAnimation: 'sparkle_short',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  },
  {
    name: '100 € gespart',
    description: 'Erreiche 100 € Gesamtersparnis',
    points: 20,
    icon: 'eurosign.circle',
    type: 'milestone',
    trigger: {
      action: 'savings_total',
      target: 100
    },
    isActive: true,
    sortOrder: 9,
    color: '#34C759',
    lottieAnimation: 'piggy_fill',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }
];

// === UPLOAD FUNCTIONS ===
async function uploadLevels() {
  console.log('📊 Uploading Levels...');
  const batch = db.batch();
  
  for (const level of levels) {
    const docRef = db.collection('gamification').doc('levels').collection('items').doc(level.id.toString());
    batch.set(docRef, {
      ...level,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  
  await batch.commit();
  console.log('✅ Levels uploaded!');
}

async function uploadActions() {
  console.log('🎮 Uploading Actions Config...');
  
  const docRef = db.collection('gamification').doc('actions');
  await docRef.set({
    actions,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  console.log('✅ Actions config uploaded!');
}

async function uploadStreaks() {
  console.log('🔥 Uploading Streaks Config...');
  
  const docRef = db.collection('gamification').doc('streaks');
  await docRef.set({
    ...streaksConfig,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  console.log('✅ Streaks config uploaded!');
}

async function updateAchievements() {
  console.log('🏆 Updating existing achievements with Lottie animations...');
  
  let updated = 0;
  let skipped = 0;
  
  for (const update of achievementsToUpdate) {
    try {
      const docRef = db.collection('achievements').doc(update.id);
      const doc = await docRef.get();
      
      if (doc.exists) {
        await docRef.update({
          lottieAnimation: update.lottieAnimation,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        updated++;
        console.log(`  ✅ Updated: ${update.id}`);
      } else {
        skipped++;
        console.log(`  ⏭️  Skipped: ${update.id} (not found)`);
      }
    } catch (error) {
      console.log(`  ⚠️  Error updating ${update.id}:`, error.message);
      skipped++;
    }
  }
  
  console.log(`✅ Achievements update complete! Updated: ${updated}, Skipped: ${skipped}`);
}

async function addNewAchievements() {
  console.log('🆕 Adding new achievements...');
  
  for (const achievement of newAchievements) {
    await db.collection('achievements').add(achievement);
  }
  
  console.log('✅ New achievements added!');
}

// === MAIN EXECUTION ===
async function main() {
  try {
    console.log('🚀 Starting Gamification Config Upload...\n');
    
    await uploadLevels();
    await uploadActions();
    await uploadStreaks();
    await updateAchievements();
    await addNewAchievements();
    
    console.log('\n🎉 All configurations uploaded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error uploading configurations:', error);
    process.exit(1);
  }
}

main();
