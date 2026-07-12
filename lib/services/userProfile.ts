import type { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import leaderboardService from './leaderboardService';

export interface UserProfile {
  uid?: string; // Optional für Kompatibilität
  email?: string; // Optional für Kompatibilität
  display_name?: string;
  real_name?: string;
  photo_url?: string;
  created_time?: any;
  totalSavings?: number;
  level?: number;
  xp?: number;
  productsSaved?: number;
  ratingsGiven?: number;
  streakDays?: number;
  isPremium?: boolean;
  premiumUntil?: Date;
  lastLoginAt?: Date;
  lastActivityAt?: Date;
  favoriteMarket?: string; // Discounter ID
  favoriteMarketName?: string; // Für schnelle Anzeige ohne DB-Lookup
  // Region-Opt-in für die Stadt-/Bundesland-Liga (Phase 3 Rewards).
  // `city` / `bundesland` werden ausschließlich gesetzt nachdem der
  // User aktiv im Region-Sheet zugestimmt hat — keine stille
  // Befüllung.
  bundesland?: string;
  city?: string;
  // Übergangs-Felder: aus den Journey-IPs des Users abgeleitete
  // Vermutung (most-frequent city). Werden vom Lazy-Fill in
  // AuthContext einmal pro User gesetzt sobald die App das nächste
  // Mal geöffnet wird, und dienen als Vorschlag im Region-Sheet
  // sowie als Fallback in der Aggregation BIS der User selber `city`
  // setzt.
  guessedCity?: string;
  guessedBundesland?: string;
}

/**
 * Lädt das bestehende User-Profil aus Firestore
 * Die users Collection existiert bereits mit allen Daten!
 */
export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  try {
    const userDoc = await getDoc(doc(db, 'users', uid));
    
    if (userDoc.exists()) {
      // Vorher: console.log('✅ User-Profil gefunden:', userDoc.data())
      // entfernt — der Object-Dump auf Android via RN-Bridge kostete
      // 100-300 ms pro Aufruf (User-Doc enthält alle Achievements
      // und Stats). Bei jedem trackAction → refreshUserProfile feuerte
      // dieser Log → mehrsekündiger JS-Thread-Freeze.
      // Babel `transform-remove-console` strippt zwar Production-
      // Builds eh, aber dieser Log war so teuer dass wir ihn auch
      // im Dev-Modus nicht haben wollen.
      return userDoc.data() as UserProfile;
    }
    
    console.log('ℹ️ Kein User-Profil gefunden für UID:', uid, '(eventuell neuer anonymer User)');
    return null;
  } catch (error) {
    console.warn('⚠️ Fehler beim Laden des User-Profils:', error);
    return null;
  }
};

/**
 * Erstellt oder aktualisiert das User-Profil
 * Wird nur beim ersten Login oder bei Updates benötigt
 */
export const createUserProfile = async (user: any, additionalData: Partial<UserProfile> = {}): Promise<void> => {
  try {
    const userRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      const profileData: UserProfile = {
        uid: user.uid,
        email: user.email || (user.isAnonymous ? 'anonymous@markendetektive.app' : ''),
        display_name: user.displayName || (user.isAnonymous ? 'Anonymer Nutzer' : ''),
        photo_url: user.photoURL || '',
        created_time: serverTimestamp(),
        totalSavings: 0,
        level: 1,
        xp: 0,
        productsSaved: 0,
        ratingsGiven: 0,
        streakDays: 0,
        isPremium: false,
        lastLoginAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
        ...additionalData
      };

      // merge:true — falls ein paralleler Service (Attribution-Mirror aus
      // dem AnalyticsProvider, achievementService) das Doc im Race zwischen
      // unserem getDoc und diesem Write bereits per setDoc(merge) angelegt
      // hat, würde ein Voll-setDoc dessen Felder (z.B. attribution) wegbügeln.
      await setDoc(userRef, profileData, { merge: true });
      console.log('✅ User-Profil erstellt für:', user.uid, '(anonymous:', user.isAnonymous, ')');
    } else {
      // Doc existiert bereits — Login-Zeit aktualisieren.
      const update: any = {
        lastLoginAt: serverTimestamp(),
        lastActivityAt: serverTimestamp(),
      };
      // Backfill created_time (User-Report 2026-07-06): das Doc kann von
      // einem anderen Service (Attribution-Mirror / achievementService)
      // per setDoc(merge) angelegt worden sein, BEVOR diese Funktion lief.
      // Dann fehlt created_time dauerhaft, weil es nur im Create-Zweig oben
      // gesetzt wird. Nur nachtragen wenn es WIRKLICH fehlt — einen
      // bestehenden Wert (wiederkehrender User) NIE überschreiben.
      if (!(userDoc.data() as any)?.created_time) {
        update.created_time = serverTimestamp();
      }
      await updateDoc(userRef, update);
      console.log('🔄 Login-Zeit aktualisiert für:', user.uid);
    }
  } catch (error) {
    console.error('❌ Fehler beim Erstellen/Aktualisieren des User-Profils:', error);
    throw error;
  }
};

/**
export const updateUserProfile = async (user: User, additionalData?: Partial<UserProfile>) => {
  try {
    const userRef = doc(db, 'users', user.uid);
    
    // Prüfe ob User bereits existiert
    const userDoc = await getDoc(userRef);
    
    if (userDoc.exists()) {
      // User existiert - nur updaten
      await updateDoc(userRef, {
        lastLoginAt: serverTimestamp(),
        ...additionalData
      });
      console.log('✅ User-Profil aktualisiert');
    } else {
      // Neuer User - erstellen (sollte selten sein, da DB bereits voll ist)
      const newUserData: UserProfile = {
        uid: user.uid,
        email: user.email || '',
        display_name: user.displayName || '',
        photo_url: user.photoURL || '',
        created_time: serverTimestamp(),
        totalSavings: 0,
        level: 1,
        xp: 0,
        productsSaved: 0,
        ratingsGiven: 0,
        streakDays: 0,
        isPremium: false,
        lastLoginAt: serverTimestamp(),
        ...additionalData
      };
      
      await setDoc(userRef, newUserData);
      console.log('✅ Neues User-Profil erstellt');
    }
  } catch (error) {
    console.error('Fehler beim Update des User-Profils:', error);
    throw error;
  }
};

/**
 * Patcht einzelne Felder im BESTEHENDEN Profil-Doc (kein Create).
 * Schlanker Ersatz fuer die auskommentierte updateUserProfile-Funktion
 * darueber. (86ca7x9ep-Follow-up: Google-Name ins Profil ziehen.)
 */
export const patchUserProfile = async (
  uid: string,
  fields: Partial<UserProfile>,
): Promise<void> => {
  await updateDoc(doc(db, 'users', uid), fields as any);
};

// Platzhalter, die createUserProfile für anonyme User schreibt — dürfen
// von echten Auth-Daten überschrieben werden, echte Werte NIE.
const PLACEHOLDER_EMAIL = 'anonymous@markendetektive.app';
const PLACEHOLDER_NAMES = ['Anonymer Nutzer', 'Anonymer Detektiv'];
const isPlaceholderEmail = (e?: string) => {
  const t = String(e || '').trim();
  return !t || t === PLACEHOLDER_EMAIL;
};
const isPlaceholderName = (n?: string) => {
  const t = String(n || '').trim();
  return !t || PLACEHOLDER_NAMES.includes(t);
};

/**
 * Konservativer fill-only-Sync users-Doc ← Firebase Auth (Audit 2026-07-12).
 *
 * Hintergrund: nach `linkWithCredential` (Anon→Provider-Upgrade) setzt
 * Firebase displayName/photoURL NICHT auf den Auth-User — die Werte hängen
 * nur in `providerData[]`. Gleichzeitig konnte das users-Doc durch einen
 * Race (Attribution-Mirror/achievementService legen es zuerst an) mit
 * Platzhaltern oder ganz ohne Identitätsfelder dastehen. Ergebnis: 616
 * Docs ohne Identität + „anonymous@…" in Profilen registrierter User.
 *
 * Diese Funktion füllt NUR Lücken/Platzhalter aus Auth + providerData —
 * ein echter Wert im Doc wird niemals überschrieben, es wird nichts
 * gelöscht, und ein fehlendes Doc wird NICHT angelegt (das bleibt
 * createUserProfile). Fire-and-forget-tauglich: wirft nur nach oben,
 * Caller entscheidet über catch.
 */
export const syncProfileFromAuth = async (
  fbUser: FirebaseAuthTypes.User,
): Promise<void> => {
  if (!fbUser || fbUser.isAnonymous) return;
  const prov = (fbUser.providerData || []).filter(
    (p) => p && p.providerId !== 'firebase',
  );
  const email = (fbUser.email || prov.find((p) => !!p.email)?.email || '').trim();
  const name = (
    fbUser.displayName || prov.find((p) => !!p.displayName)?.displayName || ''
  ).trim();
  const photo = fbUser.photoURL || prov.find((p) => !!p.photoURL)?.photoURL || '';
  if (!email && !name && !photo) return;

  const ref = doc(db, 'users', fbUser.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const d = (snap.data() as UserProfile) || {};
  const patch: Partial<UserProfile> = {};
  if (email && isPlaceholderEmail(d.email)) patch.email = email;
  if (name && isPlaceholderName(d.display_name)) patch.display_name = name;
  if (photo && !String(d.photo_url || '').trim()) patch.photo_url = photo;
  if (Object.keys(patch).length === 0) return;
  await updateDoc(ref, patch as any);
  console.log('🔄 Profil aus Auth aufgefüllt:', fbUser.uid, Object.keys(patch));
};

/**
 * Aktualisiert Gamification-Statistiken
 */
export const updateUserStats = async (uid: string, stats: {
  xpToAdd?: number;
  savingsToAdd?: number;
  productsToAdd?: number;
  ratingsToAdd?: number;
}) => {
  try {
    const userRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userRef);
    
    if (!userDoc.exists()) {
      console.log('📝 User-Dokument existiert noch nicht für:', uid, '- überspringe Update');
      return;
    }
    
    const currentData = userDoc.data() as UserProfile;
    
    const updates: any = {
      lastActivityAt: serverTimestamp()
    };
    
    if (stats.xpToAdd) {
      updates.xp = (currentData.xp || 0) + stats.xpToAdd;
      // Level wird jetzt über AchievementService berechnet (basierend auf Punkten + Ersparnis)
      // updates.level = Math.floor(updates.xp / 100) + 1; // ENTFERNT - Level kommt von stats.currentLevel
    }
    
    if (stats.savingsToAdd) {
      updates.totalSavings = (currentData.totalSavings || 0) + stats.savingsToAdd;
      
      // 📊 Update Leaderboard with savings
      await leaderboardService.updateUserStats(uid, 0, stats.savingsToAdd);
    }
    
    if (stats.productsToAdd) {
      updates.productsSaved = (currentData.productsSaved || 0) + stats.productsToAdd;
    }
    
    if (stats.ratingsToAdd) {
      updates.ratingsGiven = (currentData.ratingsGiven || 0) + stats.ratingsToAdd;
    }
    
    await updateDoc(userRef, updates);
    console.log('✅ User-Statistiken aktualisiert:', updates);
    
  } catch (error) {
    console.error('Fehler beim Update der User-Statistiken:', error);
    throw error;
  }
};

/**
 * Prüft Premium-Status
 */
export const checkPremiumStatus = async (uid: string): Promise<boolean> => {
  try {
    const profile = await getUserProfile(uid);
    
    if (!profile) return false;
    
    if (profile.isPremium && profile.premiumUntil) {
      // Prüfe ob Premium noch gültig ist
      const now = new Date();
      const premiumUntil = profile.premiumUntil instanceof Date 
        ? profile.premiumUntil 
        : profile.premiumUntil.toDate();
      
      return premiumUntil > now;
    }
    
    return profile.isPremium || false;
    
  } catch (error) {
    console.error('Fehler beim Prüfen des Premium-Status:', error);
    return false;
  }
};
