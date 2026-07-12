import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  fetchSignInMethodsForEmail,
  FirebaseAuthTypes,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from '@react-native-firebase/auth';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, InteractionManager } from 'react-native';
import { PERF } from '../perfFlags';
import { auth } from '../firebase';
import achievementService, { setProfileRefreshCallback } from '../services/achievementService';
import {
  buildAppleDisplayName,
  getAppleCredential,
  isAppleAuthAvailable,
  signOutApple,
} from '../services/auth/appleAuth';
import {
  getGoogleCredential,
  signOutGoogle,
} from '../services/auth/googleAuth';
import {
  getFacebookCredential,
  lastFbDebug,
  signOutFacebook,
} from '../services/auth/facebookAuth';
import { createUserProfile, getUserProfile, patchUserProfile, syncProfileFromAuth, UserProfile } from '../services/userProfile';
import { scheduleRegionGuess } from '../services/regionGuess';
import { isOnline } from '../services/network';
import { FirestoreService } from '../services/firestore';
import { doc, getDoc, setDoc } from '@react-native-firebase/firestore';
import { db } from '../firebase';

/**
 * ClickUp 86cacp981 (1.18) + 86cacp8xx (1.17): Überträgt die Onboarding-Felder
 * vom (beim Provider-Login verworfenen) Anon-Konto auf das BESTEHENDE Konto,
 * auf das gewechselt wurde — aber NUR Felder, die dort noch leer sind.
 * Bestehende Werte des Kontos gewinnen (passend zum Confirm-Dialog „du machst
 * mit deinem bestehenden Konto weiter").
 *
 * Strikt non-destruktiv: füllt nur Lücken, überschreibt nie. Der Caller wickelt
 * den Aufruf in try/catch — scheitert er, läuft der Login normal weiter
 * (schlimmstenfalls No-op = bisheriges Verhalten).
 */
const ONBOARDING_CARRY_KEYS = [
  'favoriteMarket',
  'favoriteMarketName',
  'favoriteMarkets',
  'primaryMarket',
  'weeklyBudgetEur',
  'priorities',
  'prioritiesOther',
  'country',
] as const;

async function carryOnboardingFields(fromUid: string, toUid: string): Promise<void> {
  const [fromSnap, toSnap] = await Promise.all([
    getDoc(doc(db, 'users', fromUid)),
    getDoc(doc(db, 'users', toUid)),
  ]);
  if (!fromSnap.exists()) return;
  const from = (fromSnap.data() ?? {}) as Record<string, any>;
  const to = (toSnap.exists() ? toSnap.data() ?? {} : {}) as Record<string, any>;

  const isEmpty = (v: any) =>
    v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

  const patch: Record<string, any> = {};
  for (const key of ONBOARDING_CARRY_KEYS) {
    if (!isEmpty(from[key]) && isEmpty(to[key])) {
      patch[key] = from[key];
    }
  }
  if (Object.keys(patch).length > 0) {
    await setDoc(doc(db, 'users', toUid), patch, { merge: true });
    console.log(
      `✅ Onboarding-Felder vom Anon-Konto übernommen: ${Object.keys(patch).join(', ')}`,
    );
  }
}

interface AdditionalProfileData {
  realName?: string;
  // T12.4: birthDate → age (Integer-Slider). Caller schickt die
  // Zahl, AuthContext speichert age + ageBucket + ageReportedAt +
  // ageReportedYear ans User-Doc.
  age?: number;
  gender?: string;
  location?: string;
  favoriteMarket?: string; // Discounter ID
  favoriteMarketName?: string; // Marktname für schnelle Anzeige
}

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  /** True, sobald der Profil-Load für den aktuellen User einmal durch ist
   *  (Erfolg oder Fehler). Anti-Flash-Gate: solange false, Skeleton statt
   *  der "?? 1"-Level-/Punkte-Fallbacks rendern (analog premiumKnown). */
  profileKnown: boolean;
  loading: boolean;
  isAnonymous: boolean;
  /** True während logout() läuft — kurzes Fenster zwischen Firebase
   *  signOut und der Re-Anon-Anmeldung. Tabs-Layout liest das damit
   *  die Welcome-Escape-Hatch nicht in diesem Fenster feuert. */
  isLoggingOut: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string, additionalData?: AdditionalProfileData) => Promise<void>;
  /** true = echter Login; false = User hat abgebrochen (Caller darf
   *  dann NICHT completeAndGoHome/markCompleted ausfuehren — 86ca7x9ep). */
  signInWithGoogle: () => Promise<boolean>;
  /** true = echter Login; false = User hat abgebrochen (Caller darf
   *  dann NICHT completeAndGoHome/markCompleted ausfuehren — 86ca7x9ep). */
  signInWithApple: () => Promise<boolean>;
  /** true = echter Login; false = User hat abgebrochen (Caller darf
   *  dann NICHT completeAndGoHome/markCompleted ausfuehren — 86ca7x9ep). */
  signInWithFacebook: () => Promise<boolean>;
  signInAnonymously: () => Promise<void>;
  logout: () => Promise<void>;
  isAppleAuthAvailable: () => Promise<boolean>;
  refreshUserProfile: () => Promise<void>;
  /** ClickUp 86cacp92p (1.19): geführtes Facebook↔E-Mail/Passwort-Linking.
   *  Nicht-null = Link-Sheet zeigen (FB-E-Mail gehört einem Passwort-Konto). */
  facebookLinkPrompt: { email: string } | null;
  /** Im Link-Sheet: mit dem Passwort ins Bestandskonto einloggen + FB verknüpfen. */
  completeFacebookLink: (password: string) => Promise<void>;
  /** Link-Sheet abbrechen (Pending-FB-Credential verwerfen). */
  cancelFacebookLink: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Hilfsfunktion für Streak Toast bei App-Start
const checkStreakOnAppStart = async (userId: string) => {
  try {
    // Hole aktuelle User-Stats
    const userStats = await achievementService.getUserStats(userId);
    const currentStreak = userStats?.currentStreak || 0;
    const lastStreakCheck = userStats?.lastStreakCheckDate;
    
    // Prüfe ob heute schon gecheckt wurde (dann keine Punkte anzeigen)
    const today = new Date().toISOString().split('T')[0];
    const isFirstOpenToday = lastStreakCheck !== today;
    
    // Zeige Toast nur wenn Streak >= 2 Tage (erste Tag ist noch nicht interessant)
    if (currentStreak >= 2) {
      // Berechne Bonus-Punkte (aber zeige nur an wenn heute der erste Check ist)
      const bonusPoints = isFirstOpenToday ? Math.max(0, currentStreak - 1) : 0;
      
      console.log(`🔥 Zeige Streak Toast für ${currentStreak} Tage (${bonusPoints} Punkte)`);
      
      // Prüfe ob global showStreakToast verfügbar ist (von GamificationProvider)
      if (typeof (global as any).showStreakToast === 'function') {
        (global as any).showStreakToast(currentStreak, bonusPoints);
      } else {
        console.log('⚠️ showStreakToast nicht verfügbar - GamificationProvider noch nicht ready');
        // Retry nach 2 Sekunden falls GamificationProvider noch lädt
        setTimeout(() => {
          if (typeof (global as any).showStreakToast === 'function') {
            (global as any).showStreakToast(currentStreak, bonusPoints);
          }
        }, 2000);
      }
    } else {
      console.log(`⏭️ Kein Streak Toast - nur ${currentStreak} Tage`);
    }
  } catch (error) {
    console.error('❌ Fehler beim Streak Toast Check:', error);
  }
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  // Anti-Flash-Signal (analog premiumKnown): true, sobald refreshUserProfile
  // für den AKTUELLEN User einmal durchgelaufen ist (Erfolg ODER Fehler).
  // Consumer (Home-Level-Card) zeigen bis dahin Skeleton statt der
  // "?? 1"-Fallbacks — behebt das "Level 1 poppt aufs echte Level".
  const [profileKnown, setProfileKnown] = useState(false);
  const profileKnownUidRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);
  // ClickUp 86cacp92p (1.19): Pending FB-Credential fürs geführte Linking.
  // useRef (KEIN State, nie persistiert): der FB-Access-Token ist sensibel +
  // muss den Re-Auth-Round-Trip ohne Re-Render-Race überleben.
  const pendingFbLink = useRef<{ credential: FirebaseAuthTypes.AuthCredential; email: string } | null>(null);
  const [facebookLinkPrompt, setFacebookLinkPrompt] = useState<{ email: string } | null>(null);
  // T17.14: True während logout() läuft (signOut → signInAnonymously).
  // Tabs-Layout liest das damit die "user==null"-Escape-Hatch zu
  // /auth/welcome NICHT feuert während des kurzen null-User-Fensters
  // zwischen signOut und der Re-Anon-Anmeldung. Vorher gabs einen
  // sichtbaren Welcome-Flash beim Abmelden.
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Read-Race-Guard (86ca7x9ep-Follow-up 'Name blitzt auf und wird
  // wieder ersetzt'): mehrere parallele refreshUserProfile-Laeufe
  // (Auth-Listener + Provider-Sign-In-Pfad) koennen sich gegenseitig
  // mit VERALTETEN Reads ueberschreiben — der zuletzt GESTARTETE
  // Lauf gewinnt, aeltere setzen keinen State mehr.
  const profileRefreshSeq = useRef(0);

  const refreshUserProfile = useCallback(async () => {
    if (user?.uid) {
      const seq = ++profileRefreshSeq.current;
      const isStale = () => seq !== profileRefreshSeq.current;
      try {
        // Versuche Profile zu laden (auch für anonyme User)
        let profile = await getUserProfile(user.uid);
        
        // Falls kein Profil existiert, erstelle eins für anonyme User
        if (!profile && user.isAnonymous) {
          const basicProfile = {
            uid: user.uid,
            email: 'anonymous@markendetektive.app',
            display_name: 'Anonymer Nutzer',
            created_time: new Date(),
            totalSavings: 0,
            // LEVEL WIRD NICHT HIER GESETZT - kommt aus stats
            xp: 0,
            productsSaved: 0,
            ratingsGiven: 0,
            streakDays: 0,
            isPremium: false
          };
          profile = basicProfile;
          console.log('📝 Anonymes Profil erstellt für:', user.uid);
        }
        
        // Lade Achievement-Stats
        const stats = await achievementService.getUserStats(user.uid);
        const enrichedProfile = {
          ...profile,
          stats: stats
        };
        
        if (isStale()) return; // neuerer Refresh laeuft — nicht clobbern
        setUserProfile(enrichedProfile);
        setProfileKnown(true);
        console.log('🔄 AuthContext: User profile + stats refreshed (anonymous:', user.isAnonymous, ')');
      } catch (error) {
        console.warn('⚠️ Profil konnte nicht geladen werden:', error);
        if (!isStale()) {
          setUserProfile(null);
          // Auch "bekannt gescheitert" zählt als known — Consumer dürfen
          // dann ihre Fallbacks rendern statt ewig Skeleton zu zeigen.
          setProfileKnown(true);
        }
      }
    }
    // Phase 0 B: Deps sind string/boolean primitives statt das ganze
    // user-Object. Vorher: `[user]` → callback-identity wechselt
    // bei JEDER user-Object-Mutation → AuthContext memo invalidates
    // → komplette useAuth()-Consumer-Cascade rerendert.
    // Jetzt: nur bei tatsächlichem uid- oder anonymous-Wechsel.
    // user.uid und user.isAnonymous innerhalb des Callbacks bleiben
    // funktional unverändert (closure capturet aktuelle Werte).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, user?.isAnonymous]);

  useEffect(() => {
    // Registriere Profile-Refresh-Callback für Achievement-System
    setProfileRefreshCallback(refreshUserProfile);
    
    let anonymousSignInTimeout: NodeJS.Timeout | null = null;
    let isMounted = true;
    let hasInitialAuthState = false;
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Verhindere State Updates wenn Component unmounted ist
      if (!isMounted) {
        console.log('⏭️ Auth state change ignored (component unmounted)');
        return;
      }
      
      console.log('🔄 AuthContext: Auth state changed:', user ? `User: ${user.uid} (anonymous: ${user.isAnonymous})` : 'No user');
      setUser(user);
      setIsAnonymous(user?.isAnonymous || false);
      // profileKnown gilt pro User: bei echtem Wechsel (Login/Logout/
      // Account-Switch) zurücksetzen, damit das alte Profil nicht als
      // "bekannt" fürs neue Konto durchgeht.
      if ((user?.uid ?? null) !== profileKnownUidRef.current) {
        profileKnownUidRef.current = user?.uid ?? null;
        setProfileKnown(false);
      }
      
      // 🔐 BACKUP: Speichere User-ID zusätzlich (falls AsyncStorage teilweise gelöscht wird)
      if (user?.uid) {
        try {
          await AsyncStorage.setItem('@auth_user_id_backup', user.uid);
          await AsyncStorage.setItem('@auth_user_email_backup', user.email || 'anonymous');
          await AsyncStorage.setItem('@auth_last_login', Date.now().toString());
        } catch (error) {
          console.warn('⚠️ Could not backup user session:', error);
        }
      }
      
        // Set user ID in Crashlytics (nur in Production Builds)
        if (!__DEV__ && Constants.appOwnership !== 'expo') {
          try {
            const crashlytics = require('@react-native-firebase/crashlytics').default;
            if (user?.uid) {
              await crashlytics().setUserId(user.uid);
              crashlytics().setAttribute('is_anonymous', user.isAnonymous ? 'true' : 'false');
            }
          } catch (error) {
            console.log('⚠️ Crashlytics not available:', error);
          }
        }
      
      if (user?.uid) {
        // User gefunden - lösche Timeout falls noch aktiv
        if (anonymousSignInTimeout) {
          clearTimeout(anonymousSignInTimeout);
          anonymousSignInTimeout = null;
          console.log('✅ Timeout gecancelt - User gefunden');
        }
        hasInitialAuthState = true;

        // WSOD-Fix (ClickUp 86ca8c9rn): setLoading(false) SOFORT,
        // sobald der Auth-State steht — NICHT erst nach der
        // Firestore-Pipeline unten. Offline haengt `await
        // createUserProfile` (setDoc-Promise resolved erst bei
        // Server-Ack, Forbidden Pattern) fuer immer -> loading blieb
        // true -> das (tabs)/_layout-Gate renderte dauerhaft einen
        // leeren View = White Screen of Death beim Kaltstart ohne
        // Empfang. Die UI braucht nur den User; Profil/Gamification
        // fuellen sich nachgelagert (und holen sich bei Reconnect
        // ihre Writes automatisch nach).
        setLoading(false);

        // 🔄 EINMALIGE GAMIFICATION INITIALISIERUNG nach Authentifizierung
        console.log('🚀 Starte Gamification-Initialisierung nach Authentifizierung...');
        try {
          // Reset Achievement Service nur bei User-Wechsel
          achievementService.resetForNewAuth(user.uid);
          
          // Neu-Initialisierung mit authentifiziertem User
          await achievementService.initialize();
          console.log('✅ Gamification-System erfolgreich nach Auth reinitialisiert');
        } catch (error) {
          console.error('❌ Gamification-Reload nach Auth fehlgeschlagen:', error);
          // Trotzdem weitermachen - App soll funktionieren
        }

        // Stelle sicher, dass User-Profil existiert (auch für anonyme User)
        try {
          await createUserProfile(user);
          console.log('✅ User-Profil erfolgreich erstellt/aktualisiert für:', user.uid);
        } catch (error: any) {
          if (error?.code === 'permission-denied') {
            console.error('🔥 FIREBASE RULES PROBLEM: Anonyme User können kein Profil erstellen!');
            console.error('➡️ Firebase Rules müssen aktualisiert werden (siehe firebase-rules-anonymous.json)');
          } else {
            console.error('❌ Fehler beim Erstellen des User-Profils:', error);
          }
          // Trotzdem weitermachen - User kann die App nutzen
        }
        await refreshUserProfile();
        
        // 📱 App Rating temporär deaktiviert - verursacht App-Freeze  
        try {
          console.log('📱 App Rating Login-Tracking DEAKTIVIERT (Freeze-Fix)');
          // await appRatingService.incrementLoginCount(user.uid);
        } catch (error) {
          console.error('❌ App Rating Login-Tracking Fehler:', error);
        }
        
        // Achievement-Checks für ALLE User (anonym + registriert)
        try {
          await achievementService.checkDailyStreak(user.uid);
          console.log('✅ Daily Streak gecheckt für User:', user.uid, '(anonymous:', user.isAnonymous, ')');
          
          await achievementService.checkAndUpdateLevel(user.uid);
          console.log('✅ Level gecheckt für User:', user.uid, '(anonymous:', user.isAnonymous, ')');
          
          // 🔥 Zeige Streak Toast falls aktiv (nach kurzer Verzögerung für bessere UX)
          setTimeout(() => checkStreakOnAppStart(user.uid), 1500);
        } catch (error) {
          console.warn('⚠️ Achievement-Checks fehlgeschlagen für User:', user.uid, error);
        }
        // setLoading(false) ist bereits oben passiert (WSOD-Fix) —
        // hier bewusst KEIN zweiter Call noetig.
      } else {
        // WICHTIG: Warte 1 Sekunde bevor neue anonyme Session erstellt wird
        // Firebase braucht Zeit um persistierte Session aus AsyncStorage zu laden
        // Nur beim ERSTEN Call mit user=null, nicht bei jedem weiteren
        if (!hasInitialAuthState && !anonymousSignInTimeout) {
          console.log('⏳ Warte auf Firebase Session-Wiederherstellung (1 Sekunde)...');
          
          anonymousSignInTimeout = setTimeout(async () => {
            // Prüfe ob Component noch mounted ist
            if (!isMounted) {
              console.log('⏭️ Timeout ignored (component unmounted)');
              return;
            }
            
            // Prüfe nochmal ob inzwischen User geladen wurde
            const currentUser = auth.currentUser;
            if (!currentUser) {
              // Prüfe ob es einen Backup gibt (deutet auf verlorene Session hin)
              try {
                const backupUserId = await AsyncStorage.getItem('@auth_user_id_backup');
                const backupEmail = await AsyncStorage.getItem('@auth_user_email_backup');
                
                if (backupUserId && backupEmail && backupEmail !== 'anonymous') {
                  // User hatte eine registrierte Session - nicht überschreiben!
                  console.warn('⚠️ Registrierte Session verloren - bitte User neu anmelden lassen');
                  console.warn('   Backup User ID:', backupUserId);
                  if (isMounted) {
                    setUserProfile(null);
                    setLoading(false);
                  }
                  return;
                }
              } catch (error) {
                console.warn('⚠️ Konnte Backup nicht prüfen:', error);
              }
              
              console.log('👤 Kein User nach Wartezeit gefunden - starte anonyme Anmeldung...');
              try {
                await signInAnonymously(auth);
                console.log('✅ Neue anonyme Anmeldung erfolgreich');
                // onAuthStateChanged wird automatisch getriggert
              } catch (error) {
                console.error('❌ Anonyme Anmeldung fehlgeschlagen:', error);
                if (isMounted) {
                  setLoading(false);
                }
              }
            } else {
              console.log('✅ Firebase Session wurde während Wartezeit wiederhergestellt');
              if (isMounted) {
                setLoading(false);
              }
            }
            
            anonymousSignInTimeout = null;
          }, 1000);
        } else if (hasInitialAuthState) {
          // User war vorher da, aber jetzt nicht mehr (z.B. Logout)
          setUserProfile(null);
          setLoading(false);
        }
      }
    });

    return () => {
      isMounted = false;
      if (anonymousSignInTimeout) {
        clearTimeout(anonymousSignInTimeout);
        anonymousSignInTimeout = null;
      }
      unsubscribe();
    };
  }, [refreshUserProfile]);

  // ─── Anon-Linking helpers ───────────────────────────────────────────
  //
  // Wenn der aktuelle User anonym ist und sich später mit einem
  // Provider (Apple/Google/Email) anmeldet, MÜSSEN wir
  // linkWithCredential nehmen statt signInWithCredential — sonst
  // entsteht ein neuer Account und alle Daten der anonymen Session
  // (Favoriten, Punkte, Käufe, Onboarding-Antworten) gehen verloren.
  //
  // Edge-case: Provider-Account gehört bereits einer anderen UID
  // (User hat sich z.B. früher mal angemeldet, dann Anon-Session auf
  // dem gleichen Device gestartet). Firebase wirft dann
  // `auth/credential-already-in-use`. Wir fragen den User per
  // Confirm-Dialog ob er zum bestehenden Account wechseln will
  // (Daten-Verlust akzeptiert) — falls ja, fallback auf normalen
  // signInWithCredential. Falls nein, Anmeldung abbrechen.

  /**
   * Confirm-Dialog wenn die Anon-Daten gegen einen existierenden
   * Provider-Account getauscht würden. Returns true wenn der User
   * fortfahren will, false sonst.
   *
   * ClickUp 86ca7f3xn (2026-06-11):
   * - FRISCHE Anon-Session (< 5 Min, typisch: erste Anmeldung direkt
   *   nach dem Onboarding) → KEIN Dialog, einfach mit dem bestehenden
   *   Konto fortfahren. Da ist nichts Wertvolles zu verlieren, und
   *   ein Warn-Dialog beim allerersten Login ist doppelt verwirrend.
   * - Sonst: positive Formulierung ("Mit diesem Konto fortfahren"
   *   statt rotem "Konto wechseln") + faktischer Hinweis, dass die
   *   Gast-Daten nicht übernommen werden.
   */
  const confirmAccountSwitch = (): Promise<boolean> => {
    const createdAt = auth.currentUser?.metadata?.creationTime;
    if (createdAt) {
      const ageMs = Date.now() - new Date(createdAt).getTime();
      // 60 Min statt 5 (ClickUp 86ca7x1m2): Onboarding + Walkthrough
      // dauern laenger als 5 Min — die 'erste Anmeldung direkt nach
      // der Installation' fiel sonst aus dem Fenster und bekam den
      // Dialog doch. 60 Min deckt die gesamte Erst-Session ab.
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 60 * 60 * 1000) {
        return Promise.resolve(true);
      }
    }
    return new Promise((resolve) => {
      // Copy-Ton-Regel + ClickUp 86ca7x1m2: kein 'nicht übernommen'
      // (Negativ-Frame), Button kurz und eindeutig.
      Alert.alert(
        'Du hast bereits ein Konto',
        'Mit diesem Konto bist du schon einmal angemeldet gewesen. ' +
          'Du machst genau dort weiter, wo du damit aufgehört hast — ' +
          'mit deinen Punkten, Favoriten und Listen aus diesem Konto.',
        [
          { text: 'Abbrechen', style: 'cancel', onPress: () => resolve(false) },
          {
            text: 'Ok, fortfahren!',
            onPress: () => resolve(true),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  };

  /**
   * Zentrale Auth-Logik: bei anonymem User → linkWithCredential
   * (UID + Daten bleiben), sonst signInWithCredential (normaler
   * Login). Bei `credential-already-in-use` wird der User gefragt
   * ob er zum bestehenden Account wechseln will.
   *
   * Kern-Logik — Aufrufer nutzen den `linkOrSignIn`-Wrapper darunter,
   * der nach JEDEM Erfolgs-Exit das users-Doc konservativ aus Auth
   * auffüllt (Audit 2026-07-12).
   */
  const linkOrSignInCore = async (
    credential: FirebaseAuthTypes.AuthCredential,
    // R3-deeper (ClickUp 86cacp8xx): optionaler Refresher für ein FRISCHES
    // Provider-Credential. Apple-idTokens sind bei Firebase EINMALIG einlösbar:
    // nach einem gescheiterten `linkWithCredential` ist das Credential
    // verbraucht, und ein `signInWithCredential` mit DEMSELBEN Credential failt
    // erneut mit "duplicate credential" (genau Manons Screenrecording: Confirm-
    // Dialog erscheint → Sign-in failt dann). Im Account-Switch-Fallback daher
    // ein frisches Credential holen (Apple re-prompt — passiert nur im seltenen
    // Konflikt-/Reinstall-Fall). Nur Provider mit Single-Use-Credential (Apple)
    // übergeben den Refresher; ohne ihn bleibt das bisherige Verhalten.
    refreshCredential?: () => Promise<FirebaseAuthTypes.AuthCredential | null>,
  ): Promise<FirebaseAuthTypes.UserCredential> => {
    const currentUser = auth.currentUser;
    // Helper: "credential already attached to a different user"
    // canonical signal in Firebase iOS is `auth/credential-already-in-use`.
    // BUT RNFirebase on iOS occasionally surfaces it as
    // `auth/unknown` with the server-message containing "Duplicate
    // credential" (we have a repro of this with Apple). Treat both
    // identically — drop anonymous, sign in to the existing account.
    const isCredentialAlreadyInUse = (e: any): boolean => {
      if (e?.code === 'auth/credential-already-in-use') return true;
      // Beim LINKEN an den Anon-User wirft Firebase-iOS
      // `auth/email-already-in-use` (statt credential-already-in-use),
      // wenn die Provider-E-Mail bereits einem anderen Konto gehört —
      // z.B. früher registriert, jetzt frische Anon-Session auf dem
      // Device. Gleicher Fall, gleiche Behandlung (Confirm → Sign-In).
      // Repro: Google-Login auf Registrieren-Screen, Juni 2026.
      if (e?.code === 'auth/email-already-in-use') return true;
      const msg = String(e?.message ?? '').toLowerCase();
      if (e?.code === 'auth/unknown' && msg.includes('duplicate')) return true;
      // R3 (ClickUp 86cacp8xx): Apple-Reinstall-Link-Konflikt. Firebase-iOS
      // mappt die Server-Prosa "duplicate credential received" auf KEINEN
      // bekannten Code → fällt auf auth/internal-error zurück (über die
      // RNFirebase-Bridge), sodass die Code-Checks oben NICHT greifen, der
      // Roh-Fehler beim User landet UND die frische Anon-Session stuck bleibt
      // (jeder Retry wiederholt denselben Fehler; nach Neustart = Gast).
      // Die Credential-Konflikt-Prosa daher CODE-AGNOSTISCH matchen, damit der
      // Duplicate in den Fallback (confirmAccountSwitch → signInWithCredential
      // = sauberer Wechsel ins bestehende Apple-Konto) geroutet wird. Eng auf
      // die Konflikt-Prosa beschränkt, um transiente internal-errors nicht zu
      // verschlucken. (SDK-Versionen variieren die Prosa → beide Formen.)
      if (msg.includes('duplicate credential')) return true;
      if (msg.includes('credential') && msg.includes('already')) return true;
      return false;
    };

    if (currentUser?.isAnonymous) {
      const anonUid = currentUser.uid;
      try {
        const linked = await linkWithCredential(currentUser, credential);
        // R2 (ClickUp 86cadntj7): Beim In-Place-Upgrade Anon→Provider bleibt
        // die UID gleich → `onAuthStateChanged` feuert NICHT (RNFirebase
        // emittiert beim Link nur onUserChanged/onIdTokenChanged; der native
        // iOS-AuthState-Listener feuert nur bei Identitätswechsel). Dadurch
        // blieben Context-`user`/`isAnonymous` stehen → die UI behandelte den
        // frisch eingeloggten User weiter als Gast („Anonymer Detektiv"),
        // obwohl Firebase-seitig isAnonymous bereits false war (der Avatar
        // updatete via refreshUserProfile → genau der gemeldete Split).
        // Hier den State explizit aus dem frischen auth.currentUser nachziehen.
        // UID unverändert → die schweren onAuthStateChanged-Side-Effects
        // (Gamification-Reset/Init, createUserProfile, Streak) NICHT erneut
        // auslösen; nur User-Ref + isAnonymous fürs UI aktualisieren.
        const upgraded = auth.currentUser;
        if (upgraded) {
          setUser(upgraded);
          setIsAnonymous(upgraded.isAnonymous ?? false);
        }
        return linked;
      } catch (e: any) {
        if (isCredentialAlreadyInUse(e)) {
          const confirmed = await confirmAccountSwitch();
          if (!confirmed) {
            const err: any = new Error('Anmeldung abgebrochen');
            err.code = 'auth/cancelled';
            throw err;
          }
          // Fallback: drop anon, sign in with the existing account.
          // R3-deeper (86cacp8xx): das ursprüngliche Credential kann beim Sign-in
          // single-use-verbraucht sein (Apple-idToken). Wenn ein Refresher da ist,
          // ein FRISCHES Credential holen — sonst failt signInWithCredential mit
          // demselben "duplicate credential" wie das vorangegangene linkWithCredential.
          let signInCred = credential;
          if (refreshCredential) {
            const fresh = await refreshCredential();
            if (fresh) signInCred = fresh;
          }
          const result = await signInWithCredential(auth, signInCred);
          // ClickUp 86cacp981 (1.18) + 86cacp8xx (1.17): leere Felder des
          // bestehenden Kontos aus den frischen Onboarding-Daten füllen
          // (fill-only-missing). Non-fatal — Login läuft auch ohne Carry-over.
          if (result.user && result.user.uid !== anonUid) {
            try {
              await carryOnboardingFields(anonUid, result.user.uid);
            } catch (ce) {
              console.warn('Onboarding-Carry-over fehlgeschlagen (non-fatal):', ce);
            }
          }
          return result;
        }
        throw e;
      }
    }
    // Non-anonymous user → straight sign-in. Still treat the same
    // "duplicate credential" oddity gracefully: it means the user
    // tapped re-login with the same provider — Firebase rejects but
    // a fresh sign-in attempt one tick later usually works.
    try {
      return await signInWithCredential(auth, credential);
    } catch (e: any) {
      if (isCredentialAlreadyInUse(e)) {
        // Same provider already on this user — that's actually a
        // successful state from the UX angle. Return the current user.
        if (auth.currentUser) {
          // Construct a UserCredential-shaped wrapper. RNFirebase doesn't
          // export a public way to build one, so we cast a minimal object.
          return {
            user: auth.currentUser,
            additionalUserInfo: null,
            credential: null,
          } as unknown as FirebaseAuthTypes.UserCredential;
        }
      }
      throw e;
    }
  };

  /**
   * Wrapper um linkOrSignInCore: nach jedem erfolgreichen Provider-
   * Login/-Link (Google/Apple/Facebook, alle 4 Exit-Pfade des Cores)
   * das users-Doc konservativ aus Firebase Auth auffüllen — fill-only,
   * echte Werte werden nie überschrieben (syncProfileFromAuth).
   * Fire-and-forget: der Login darf daran weder scheitern noch hängen
   * (Firestore-Await im kritischen Pfad = Offline-Hänger, CLAUDE.md).
   */
  const linkOrSignIn = async (
    credential: FirebaseAuthTypes.AuthCredential,
    refreshCredential?: () => Promise<FirebaseAuthTypes.AuthCredential | null>,
  ): Promise<FirebaseAuthTypes.UserCredential> => {
    const result = await linkOrSignInCore(credential, refreshCredential);
    const authedUser = result?.user ?? auth.currentUser;
    if (authedUser && !authedUser.isAnonymous) {
      void syncProfileFromAuth(authedUser).catch((e) =>
        console.warn('syncProfileFromAuth fehlgeschlagen (non-fatal):', e),
      );
    }
    return result;
  };

  const signIn = async (email: string, password: string) => {
    try {
      // Login = "I HAVE this account, log me in". Das ist NICHT
      // dasselbe wie linkWithCredential — letzteres würde einen
      // NEUEN Email-Password-Identity am bestehenden Anon-User
      // anhängen, statt zum existierenden Account zu wechseln.
      //
      // Korrektes Verhalten bei Anon-User der sich auf ein
      // existierendes Konto einloggen will: warnen dass die
      // Anon-Daten verloren gehen, dann signInWithEmailAndPassword.
      const currentUser = auth.currentUser;
      if (currentUser?.isAnonymous) {
        const confirmed = await confirmAccountSwitch();
        if (!confirmed) {
          const err: any = new Error('Anmeldung abgebrochen');
          err.code = 'auth/cancelled';
          throw err;
        }
      }
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      if (__DEV__) {
        console.error('Sign in error:', error);
      }
      throw error;
    }
  };

  const signUp = async (
    email: string,
    password: string,
    displayName: string,
    additionalData?: AdditionalProfileData,
  ) => {
    try {
      const currentUser = auth.currentUser;
      // VOR dem Link festhalten — das native User-Objekt kann nach
      // linkWithCredential mutieren (isAnonymous flippt am selben Objekt).
      const wasAnonymous = currentUser?.isAnonymous === true;
      let userCredential: FirebaseAuthTypes.UserCredential;

      if (currentUser?.isAnonymous) {
        // Anon → upgrade zu Email/Password-Account, UID + Daten
        // bleiben erhalten.
        const credential = EmailAuthProvider.credential(email, password);
        try {
          userCredential = await linkWithCredential(currentUser, credential);
        } catch (e: any) {
          if (e?.code === 'auth/email-already-in-use') {
            // Email gehört schon einem anderen Account → User hat zwei
            // Optionen: bestehenden Account einloggen (Daten weg) oder
            // andere Email nehmen.
            const confirmed = await confirmAccountSwitch();
            if (!confirmed) {
              const err: any = new Error('Registrierung abgebrochen');
              err.code = 'auth/cancelled';
              throw err;
            }
            userCredential = await signInWithEmailAndPassword(auth, email, password);
          } else {
            throw e;
          }
        }
      } else {
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
      }

      // DisplayName + zusätzliche Profil-Daten setzen.
      if (userCredential.user) {
        await updateProfile(userCredential.user, { displayName });

        if (additionalData) {
          const { serverTimestamp } = await import('@react-native-firebase/firestore');
          // T12.4: age + Capture-Timestamps statt birthDate.
          // ageReportedAt/ageReportedYear nur setzen wenn age tatsächlich
          // übergeben wurde — sonst bleibt das Feld leer und kann später
          // im Profile-Editor nachgepflegt werden.
          const { ageBucketFromAge } = await import('@/lib/utils/age');
          const agePatch = typeof additionalData.age === 'number'
            ? {
                age: additionalData.age,
                ageBucket: ageBucketFromAge(additionalData.age),
                ageReportedAt: serverTimestamp(),
                ageReportedYear: new Date().getFullYear(),
              }
            : {};
          await setDoc(
            doc(db, 'users', userCredential.user.uid),
            {
              display_name: displayName,
              real_name: additionalData.realName || '',
              email,
              ...agePatch,
              gender: additionalData.gender || '',
              location: additionalData.location || '',
              // photo_url/totalSavings hier NICHT setzen (Audit 2026-07-12):
              // beim Anon→Email-Upgrade bleibt die UID gleich, das Doc
              // existiert bereits aus der Gast-Phase — `photo_url: ''`
              // löschte ein als Gast gesetztes Foto und `totalSavings: 0`
              // nullte die per increment() gepflegte Anzeige-Ersparnis
              // PERMANENT (kein Self-Heal, siehe updateUserTotalSavings).
              // Frische Accounts bekommen ihre Defaults aus createUserProfile.
              // created_time NICHT überschreiben wenn der User vorher
              // anonym war — der existiert dann schon mit serverTimestamp
              // aus der Anon-Phase. Beim merge:true ohne created_time
              // bleibt der bestehende Wert erhalten.
              ...(currentUser?.isAnonymous ? {} : { created_time: serverTimestamp() }),
              lastLoginAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      }

      // Tester-Finding 1.15 (Build 1242): Nach Anon→Email-Upgrade blieb die
      // UI bis zum App-Neustart beim "Anonymen Detektiv". Grund: linking
      // behält die UID → RNFirebase feuert KEIN onAuthStateChanged (gleiche
      // Firebase-Eigenheit wie beim R2-Fix aadcad4 für Google/Apple/FB in
      // linkOrSignIn) → setUser/setIsAnonymous/userProfile blieben stale.
      // Analog R2: Context-State manuell nachziehen. BEWUSST nach
      // updateProfile + setDoc, damit refreshUserProfile den echten Namen
      // lädt (Spiegel des Google-Pfads). Im email-already-in-use-Fallback
      // (UID-Wechsel → onAuthStateChanged feuert) ist der Block idempotent.
      if (wasAnonymous) {
        const upgraded = auth.currentUser;
        if (upgraded) {
          setUser(upgraded);
          setIsAnonymous(upgraded.isAnonymous ?? false);
          // Refresh NUR im Gleiche-UID-Pfad (erfolgreicher Link): die
          // refreshUserProfile-Closure hält noch die Vor-Link-UID. Im
          // Fallback (UID-Wechsel) feuert onAuthStateChanged und lädt
          // das Profil selbst — ein Refresh hier könnte dort das ALTE
          // Profil laden.
          if (upgraded.uid === currentUser?.uid) {
            await refreshUserProfile();
          }
        }
      }
    } catch (error) {
      if (__DEV__) {
        console.error('Sign up error:', error);
      }
      throw error;
    }
  };

  const handleSignInWithGoogle = async (): Promise<boolean> => {
    // Rueckgabe false = Abbruch OHNE Login (86ca7x9ep): vorher kehrte
    // der Handler still zurueck und JEDER Caller lief danach in seinen
    // Erfolgs-Pfad (markCompleted + router.replace) — der User landete
    // als ANONYMER User in der App und dachte, er sei eingeloggt.
    try {
      const bundle = await getGoogleCredential();
      if (!bundle) {
        // User hat das Google-Sheet abgebrochen. Kein Fehler.
        return false;
      }
      const userCredential = await linkOrSignIn(bundle.credential);
      console.log(
        '✅ Google Sign-In:',
        userCredential.user.email,
        userCredential.additionalUserInfo?.isNewUser ? '(neu)' : '(bestehend)',
      );
      // Name/Foto aus dem Google-Konto ins Profil ziehen ('es steht
      // immer Detektiv'): beim Linken eines Anon-Users setzt Firebase
      // displayName/photoURL NICHT — und auch das Firestore-Profil
      // existiert dann schon (vom Anon-User) ohne echten Namen.
      // Nur fuellen, nie ueberschreiben: ein selbst gewaehlter Name
      // im Profil-Editor bleibt unangetastet.
      try {
        const uid = userCredential.user.uid;
        const profile = await getUserProfile(uid);
        const currentName = (profile?.display_name ?? '').trim();
        const updates: Partial<UserProfile> = {};
        if (
          bundle.displayName &&
          (!currentName || currentName === 'Anonymer Nutzer')
        ) {
          updates.display_name = bundle.displayName;
        }
        if (bundle.photoUrl && !(profile?.photo_url ?? '').trim()) {
          updates.photo_url = bundle.photoUrl;
        }
        if (!profile) {
          await createUserProfile(userCredential.user, {
            display_name: bundle.displayName || userCredential.user.displayName || '',
            email: bundle.email || userCredential.user.email || '',
            photo_url: bundle.photoUrl || '',
          });
          await refreshUserProfile();
        } else if (Object.keys(updates).length > 0) {
          await patchUserProfile(uid, updates);
          await refreshUserProfile();
        }
      } catch (e) {
        console.warn('Google Sign-In: Profil-Namen-Sync fehlgeschlagen (non-fatal):', e);
      }
      return true;
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return false; // User cancel = kein Fehler
      if (__DEV__) {
        console.error('Google Sign-In error:', error);
      }
      throw error;
    }
  };

  const handleSignInWithApple = async (): Promise<boolean> => {
    // ClickUp 86cacp8xx (1.17) + 86cacp900 (1.22): Apple läuft jetzt — wie
    // Google/Facebook — über `linkOrSignIn` statt über den alten Sonderpfad
    // (signOut + standalone signInWithCredential).
    //
    // Warum der alte Pfad falsch war:
    //   • signOut(anon) verwarf die Anon-UID inkl. aller frisch gemirrorten
    //     Onboarding-Daten → User blieb "Anonymer Detektiv" / Lieblingsmarkt
    //     fiel auf Alt-Daten zurück (1.17).
    //   • Der signOut erzeugte ein kurzes Null-User-Fenster; der folgende
    //     Server-Call hängt offline ewig → Tabs-Escape-Hatch-Schleife +
    //     App-Hänger (1.22).
    //
    // `linkOrSignIn`: bei Anon-User → linkWithCredential (UID + Daten bleiben,
    // EIN Apple-Sheet, kein zweiter Dialog). Nur wenn die Apple-Identität
    // bereits einem ANDEREN Konto gehört, greift der Confirm + signInWith-
    // Credential-Fallback (isCredentialAlreadyInUse deckt Apples
    // `auth/unknown`+"duplicate"-Variante ab).
    try {
      const bundle = await getAppleCredential();
      if (!bundle) return false;

      // Offline-Guard (1.22): Apples Token-Issue gelingt lokal oft auch
      // offline, aber linkWithCredential/signInWithCredential muss zum
      // Firebase-Server — offline hängt die Promise ewig. Früh + sauber
      // abbrechen, damit der Caller die Offline-Meldung zeigt statt eines
      // App-Hängers. (Fällt die Offline-Detection aus → isOnline()=true →
      // No-op, kein Regress.)
      if (!isOnline()) {
        const err: any = new Error('Keine Internetverbindung');
        err.code = 'auth/network-request-failed';
        throw err;
      }

      // R3-deeper (86cacp8xx): Refresher fürs Account-Switch-Fallback mitgeben.
      // Apple-idToken ist EINMALIG einlösbar — wenn der anon→Apple-Link mit
      // "duplicate credential" failt (Apple-Identität gehört bereits einem
      // anderen Konto, z.B. nach Reinstall), ist das erste Credential verbraucht.
      // Dann holt linkOrSignIn über diesen Callback ein FRISCHES Apple-Credential,
      // bevor es signInWithCredential ins bestehende Konto macht.
      const userCredential = await linkOrSignIn(bundle.credential, async () => {
        const fresh = await getAppleCredential();
        return fresh?.credential ?? null;
      });

      const isNewUser = userCredential.additionalUserInfo?.isNewUser;
      if (isNewUser && userCredential.user) {
        const displayName = buildAppleDisplayName(bundle.fullName);
        await createUserProfile(userCredential.user, {
          realName: displayName,
          email: bundle.email || userCredential.user.email || '',
        });
        console.log(`✅ Apple Sign-In: NEUER USER → Profil angelegt (${userCredential.user.email})`);
      } else {
        console.log('✅ Apple Sign-In: bestehender/verknüpfter User');
      }

      // Namens-Sync (analog handleSignInWithGoogle, ClickUp 1.17): beim
      // Anon→Apple-LINK ist isNewUser=false → oben wird kein Profil angelegt,
      // und Firebase setzt den displayName beim Linken NICHT. Apple liefert
      // fullName NUR beim allerersten Consent — wenn ein ECHTER Name dabei ist
      // und das Profil noch namenlos ist, nachtragen, damit der User nicht
      // "Anonymer Detektiv" bleibt. Nur füllen, nie einen selbst gewählten
      // Namen überschreiben.
      try {
        const hasRealAppleName = !!(
          bundle.fullName?.givenName || bundle.fullName?.familyName
        );
        if (hasRealAppleName && userCredential.user) {
          const uid = userCredential.user.uid;
          const profile = await getUserProfile(uid);
          const currentName = (profile?.display_name ?? '').trim();
          const isPlaceholder =
            !currentName ||
            currentName === 'Anonymer Nutzer' ||
            currentName === 'Anonymer Detektiv';
          if (profile && isPlaceholder) {
            await patchUserProfile(uid, {
              display_name: buildAppleDisplayName(bundle.fullName),
            });
            await refreshUserProfile();
          }
        }
      } catch (e) {
        console.warn('Apple Sign-In: Profil-Namen-Sync fehlgeschlagen (non-fatal):', e);
      }
      return true;
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return false;
      if (__DEV__) {
        console.error('Apple Sign-In error:', error);
      }
      throw error;
    }
  };

  const handleSignInWithFacebook = async (): Promise<boolean> => {
    // E-Mail + Credential aus dem FB-Graph merken, damit wir sie im catch
    // (account-exists) noch haben (bundle ist dort nicht mehr in scope).
    let fbEmail = '';
    let fbCredential: FirebaseAuthTypes.AuthCredential | null = null;
    try {
      const bundle = await getFacebookCredential();
      if (!bundle) {
        // User hat das Facebook-Sheet abgebrochen.
        return false;
      }
      fbEmail = bundle.email || '';
      fbCredential = bundle.credential;
      const userCredential = await linkOrSignIn(bundle.credential);

      // Facebook liefert beim ersten Sign-In email + displayName + photoURL
      // (best-effort, je nach User-Permission). Bei neuem User legen wir
      // direkt das Firestore-Profil an — spiegelbildlich zum Apple-Pfad.
      const isNewUser = userCredential.additionalUserInfo?.isNewUser;
      if (isNewUser && userCredential.user) {
        await createUserProfile(userCredential.user, {
          realName: bundle.displayName || userCredential.user.displayName || 'Facebook User',
          email: bundle.email || userCredential.user.email || '',
        });
        console.log(`✅ Facebook Sign-In: NEUER USER → Profil angelegt (${userCredential.user.email})`);
      } else {
        console.log('✅ Facebook Sign-In: bestehender User');
      }
      return true;
    } catch (error: any) {
      if (error?.code === 'auth/cancelled') return false;

      // ClickUp 86cacp92p (1.19): Die Facebook-E-Mail gehört bereits einem
      // Konto mit ANDEREM Provider (Google/Apple/E-Mail). Firebase wirft
      // `auth/account-exists-with-different-credential`. Statt des rohen
      // FB-Debug-Strings (siehe Diagnostik-Block unten) dem User freundlich
      // sagen, womit er sich anmelden soll (Copy-Ton positiv, gem. CLAUDE.md).
      if (error?.code === 'auth/account-exists-with-different-credential') {
        const email = fbEmail || error?.userInfo?.email || error?.email || '';
        let methods: string[] = [];
        if (email) {
          try {
            methods = await fetchSignInMethodsForEmail(auth, email);
          } catch {
            // egal — dann generischer Hinweis ohne Provider-Namen
          }
        }
        const labels: Record<string, string> = {
          'google.com': 'Google',
          'apple.com': 'Apple',
          'facebook.com': 'Facebook',
          password: 'E-Mail & Passwort',
        };
        const known = methods
          .map((m) => labels[m])
          .filter((v): v is string => !!v);
        // ClickUp 86cacp92p (1.19): Manons Fall — die FB-E-Mail gehört einem
        // E-Mail/Passwort-Konto. Statt Sackgassen-Hinweis ein GEFÜHRTES Linking:
        // FB-Credential merken + Link-Sheet zeigen. Der User loggt sich EINMAL
        // mit Passwort ein (completeFacebookLink) → danach ist FB ans Konto
        // geknüpft und künftige FB-Logins funktionieren. (Scope bewusst nur
        // Passwort; Google/Apple-Konten bekommen weiter den Hinweis unten.)
        if (methods.includes('password') && fbCredential) {
          pendingFbLink.current = { credential: fbCredential, email };
          setFacebookLinkPrompt({ email });
          return false;
        }
        const msg =
          known.length > 0
            ? `Mit dieser E-Mail gibt es schon ein Konto. Melde dich bitte mit ${known.join(' oder ')} an.`
            : 'Mit dieser E-Mail gibt es bereits ein Konto bei einem anderen Anmelde-Weg. Bitte melde dich darüber an.';
        const friendly: any = new Error(msg);
        friendly.code = 'auth/account-exists-with-different-credential';
        throw friendly;
      }

      if (__DEV__) {
        if (error?.code === 'auth/facebook-sdk-unavailable') {
          console.warn('Facebook Sign-In skipped (SDK unavailable on this build):', error?.message);
        } else {
          console.error('Facebook Sign-In error:', error);
        }
      }

      // T17.18: TestFlight-Diagnostik. Wir können keine console.log
      // sehen in Production-Builds — also packen wir alle FB-OAuth-
      // Infos in die error.message, damit der Toast in welcome/login/
      // register sie anzeigt. Format ist absichtlich kompakt.
      if (error?.code !== 'auth/facebook-sdk-unavailable' && lastFbDebug.tokenLen > 0) {
        const debug = `[FB-Debug] token=${lastFbDebug.tokenPrefix}…(${lastFbDebug.tokenLen}) graph=${lastFbDebug.graphStatus}`;
        const fbErr: any = new Error(
          `${error?.code || 'err'}: ${error?.message || 'unknown'} | ${debug}`,
        );
        fbErr.code = error?.code;
        throw fbErr;
      }
      throw error;
    }
  };

  // ClickUp 86cacp92p (1.19): Aktionen fürs FB-Link-Sheet.
  const cancelFacebookLink = () => {
    pendingFbLink.current = null;
    setFacebookLinkPrompt(null);
  };

  const completeFacebookLink = async (password: string) => {
    const pending = pendingFbLink.current;
    if (!pending) {
      throw new Error('Keine Facebook-Verknüpfung ausstehend');
    }
    // 1. In das bestehende E-Mail/Passwort-Konto einloggen. Das Link-Sheet IST
    //    die Account-Switch-Bestätigung → signInWithEmailAndPassword direkt
    //    (kein zusätzlicher confirmAccountSwitch-Dialog wie in signIn()).
    await signInWithEmailAndPassword(auth, pending.email, password);
    // 2. FB-Credential ans jetzt eingeloggte Konto knüpfen → künftige FB-Logins
    //    treffen den normalen signInWithCredential-Erfolgspfad.
    try {
      if (auth.currentUser) {
        await linkWithCredential(auth.currentUser, pending.credential);
      }
    } catch (e: any) {
      // credential-already-in-use = FB ist bereits verknüpft (Race) → als Erfolg behandeln.
      if (e?.code !== 'auth/credential-already-in-use') throw e;
    }
    pendingFbLink.current = null;
    setFacebookLinkPrompt(null);
  };

  const handleSignInAnonymously = async () => {
    try {
      const result = await signInAnonymously(auth);
      console.log('🔒 Anonymer Login erfolgreich:', result.user.uid);
      // User wird automatisch via onAuthStateChanged gesetzt
    } catch (error) {
      if (__DEV__) {
        console.error('Anonymous Sign-In error:', error);
      }
      throw error;
    }
  };

  const logout = async () => {
    setIsLoggingOut(true);
    try {
      // Sign out from social providers if needed
      await signOutGoogle().catch(() => {}); // Ignore errors
      await signOutApple().catch(() => {}); // Ignore errors
      await signOutFacebook().catch(() => {}); // Ignore errors

      // 🧹 Clear the AsyncStorage auth backup BEFORE signing out.
      // This backup is meant to detect "Firebase session
      // unexpectedly lost" on app boot — it makes the app refuse
      // to auto-anonymous-login because we assume the user wants
      // their registered identity back. After an EXPLICIT logout
      // that's the wrong assumption: the user wants to be
      // logged out, anonymous mode is fine. Without this clear,
      // the next app boot sees the backup, refuses to auto-anon,
      // and traps the user on a blank screen forever.
      try {
        await AsyncStorage.removeItem('@auth_user_id_backup');
        await AsyncStorage.removeItem('@auth_user_email_backup');
        await AsyncStorage.removeItem('@auth_last_login');
      } catch (clearErr) {
        console.warn('⚠️ Could not clear auth backup on logout:', clearErr);
      }

      // Sign out from Firebase
      await signOut(auth);
      console.log('✅ Logout erfolgreich');

      // Umfrage-Caches leeren (Account-Wechsel): answered-Counts, Polls,
      // Session-Cap. Verhindert, dass Stand des alten Users beim nächsten
      // User durchschlägt. 86ca8h…
      try {
        const { resetSurveyCaches } = await import('@/lib/services/surveyService');
        resetSurveyCaches();
      } catch {
        /* non-fatal */
      }

      // 🔁 Re-establish an anonymous session immediately. Without
      // this the tab layout sees `!user` and renders a blank
      // screen (auto-anonymous-login only fires on first mount,
      // not on a subsequent sign-out — see `hasInitialAuthState`
      // gate in the onAuthStateChanged effect). Re-signing in
      // here makes the app usable again right after logout: the
      // user is back to anonymous mode, the listener fires and
      // refreshes user/profile state across the tree.
      try {
        await signInAnonymously(auth);
        console.log('✅ Re-signed-in as anonymous after logout');
      } catch (anonErr) {
        console.warn('⚠️ Anonymous re-sign-in failed after logout:', anonErr);
        // Non-fatal: the user is still logged out, just stuck.
        // Caller (profile.tsx) navigates to home anyway, and the
        // tab layout's redirect-to-welcome guard kicks in.
      }
    } catch (error) {
      // Verhindere React Error Logs in Production
      if (__DEV__) {
        console.error('Logout error:', error);
      }
      throw error;
    } finally {
      // T17.14: Flag erst NACH Re-Anon-Anmeldung droppen, damit
      // Tabs-Layout-Escape-Hatch nicht zwischendurch feuert.
      setIsLoggingOut(false);
    }
  };

  // Development Helper: Complete Auth Reset
  const resetAuthForDevelopment = async () => {
    if (__DEV__) {
      try {
        console.log('🧹 DEV: Resetting auth completely...');
        
        // Clear Firebase Auth
        await signOut(auth);
        
        // Clear AsyncStorage
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        await AsyncStorage.clear();
        
        console.log('✅ DEV: Auth reset complete');
      } catch (error) {
        console.error('❌ DEV: Reset auth error:', error);
      }
    }
  };



  // Lazy-fill of guessedCity / guessedBundesland from journey history
  // — runs once per user when both fields are still empty. Sits as
  // a separate effect on (uid, profile-region) so it doesn't fire
  // until the profile load has resolved. The actual work is
  // deferred via InteractionManager so it never blocks the main
  // render.
  useEffect(() => {
    if (!user?.uid || !userProfile) return;
    if (userProfile.city || userProfile.guessedCity) return;
    const handle = scheduleRegionGuess(
      user.uid,
      { city: userProfile.city, guessedCity: userProfile.guessedCity },
      () => refreshUserProfile(),
    );
    return () => {
      try {
        handle.cancel?.();
      } catch {}
    };
  }, [user?.uid, userProfile?.city, userProfile?.guessedCity, refreshUserProfile]);

  // FCM token registration for cashback push notifications.
  // Lazy-imports the messaging module so the dev-client doesn't crash
  // when the native module hasn't been linked yet.
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { registerFcmTokenForUser } = await import('@/lib/services/fcmTokenService');
        const teardown = await registerFcmTokenForUser(uid);
        if (cancelled) {
          teardown();
        } else {
          unsub = teardown;
        }
      } catch (e: any) {
        // Non-fatal — push is a nice-to-have, app works without.
        console.log('[fcm] register skipped:', e?.message);
      }
    })();
    return () => {
      cancelled = true;
      try {
        unsub?.();
      } catch {}
    };
  }, [user?.uid]);

  // Self-healing Backfill für `favoriteMarketName`.
  //
  // Bestands-User die das Onboarding VOR dem Mirror-Fix abgeschlossen
  // haben, haben nur `favoriteMarket` (die ID) gesetzt — ohne den
  // dazugehörigen Namen-String. Folge: ihre Profil-Stat-Card "Dein
  // Lieblingsmarkt" rendert nichts, weil sie direkt den Namen liest
  // (siehe profile.tsx:160).
  //
  // Dieser Effekt heilt das einmal pro betroffenem User: wenn die ID
  // da ist aber der Name fehlt, lädt er den Discounter-Doc nach und
  // schreibt das Name-Feld auf das User-Doc. Danach feuert die
  // Bedingung nie wieder (Name ist gesetzt → early return). Cost: 1
  // Read + 1 Write pro Bestands-User, einmalig in der Lebensdauer.
  //
  // Pattern parallel zum guessedCity-Backfill darüber: defer via
  // InteractionManager damit's nicht den App-Start blockiert, alles
  // in try/catch damit ein Fehler die Auth-Pipeline nicht stört.
  useEffect(() => {
    if (!user?.uid || !userProfile) return;
    const uid = user.uid;
    const favId = (userProfile as any).favoriteMarket as string | undefined;
    const favName = (userProfile as any).favoriteMarketName as string | undefined;
    // Nichts zu tun wenn keine ID oder Name schon vorhanden.
    if (!favId) return;
    if (favName && favName.length > 0) return;

    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(async () => {
      try {
        if (cancelled) return;
        const market = await FirestoreService.getDiscounterById(favId);
        if (cancelled) return;
        const name = (market as any)?.name as string | undefined;
        if (!name) return;
        await setDoc(
          doc(db, 'users', uid),
          { favoriteMarketName: name },
          { merge: true },
        );
        if (cancelled) return;
        // Profile neu laden, damit das Profil-Stat-Card sofort
        // den Lieblingsmarkt anzeigt — ohne App-Restart.
        await refreshUserProfile();
        console.log('✅ Lieblingsmarkt-Name nachgetragen für Bestands-User:', uid);
      } catch (e) {
        console.warn('⚠️ favoriteMarketName-Backfill fehlgeschlagen (non-fatal):', e);
      }
    });
    return () => {
      cancelled = true;
      try {
        handle.cancel?.();
      } catch {}
    };
  }, [user?.uid, userProfile, refreshUserProfile]);

  // Fix A — Mit `PERF.memoAuthValue=true`: memoized value-Object,
  // damit Consumer (alle `useAuth()`-Aufrufer = halbe App) nicht
  // bei jedem unrelated Re-Render des AuthProviders mit-rendern.
  // Ohne Memo: jeder Render erzeugt neues Object → React vergleicht
  // per ===, sieht "neu", rendert alle Consumer durch.
  // Rollback: PERF.memoAuthValue = false → fällt zurück auf
  // referenz-instabiles Object (Original-Verhalten).
  const valueMemo = useMemo(
    () => ({
      user,
      userProfile,
      profileKnown,
      loading,
      isAnonymous,
      isLoggingOut,
      signIn,
      signUp,
      signInWithGoogle: handleSignInWithGoogle,
      signInWithApple: handleSignInWithApple,
      signInWithFacebook: handleSignInWithFacebook,
      signInAnonymously: handleSignInAnonymously,
      logout,
      isAppleAuthAvailable,
      refreshUserProfile,
      facebookLinkPrompt,
      completeFacebookLink,
      cancelFacebookLink,
      ...__DEV__ && { resetAuthForDevelopment },
    }),
    [
      user,
      userProfile,
      profileKnown,
      loading,
      isAnonymous,
      isLoggingOut,
      signIn,
      signUp,
      handleSignInWithGoogle,
      handleSignInWithApple,
      handleSignInWithFacebook,
      handleSignInAnonymously,
      logout,
      refreshUserProfile,
      facebookLinkPrompt,
      completeFacebookLink,
      cancelFacebookLink,
    ],
  );
  const value = PERF.memoAuthValue
    ? valueMemo
    : {
        user,
        userProfile,
        profileKnown,
        loading,
        isAnonymous,
        signIn,
        signUp,
        signInWithGoogle: handleSignInWithGoogle,
        signInWithApple: handleSignInWithApple,
        signInAnonymously: handleSignInAnonymously,
        logout,
        isAppleAuthAvailable,
        refreshUserProfile,
        facebookLinkPrompt,
        completeFacebookLink,
        cancelFacebookLink,
        ...(__DEV__ && { resetAuthForDevelopment }),
      };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
