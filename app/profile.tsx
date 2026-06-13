// app/profile.tsx
//
// Profile screen — redesigned. Combines what used to live on the
// `(tabs)/more.tsx` (settings, links, toggles, dev tools) with the
// previous profile content (identity, level + savings hero, menu)
// into a single screen, matching `markendetektive_newdesign/project/Profile.jsx`.
//
// Design rules from CLAUDE.md applied 1:1:
//   • DetailHeader chrome (back-button + edit-pencil right slot)
//   • FilterSheet for the "Find us on social media" sheet
//   • useTokens / fontFamily / fontWeight from design tokens
//   • level-tinted gradient hero (mirrors levelGradient on rewards)
//   • white-surface menu cards with soft shadow

import { ratingPromptService } from '@/lib/services/ratingPrompt';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useNavigation } from 'expo-router';
import { safePush } from '@/lib/utils/safeNav';
import * as WebBrowser from 'expo-web-browser';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import {
  Alert,
  DevSettings,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Switch,
  Text,
  Image as RNImage,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingService } from '@/lib/services/onboardingService';

import {
  DETAIL_HEADER_ROW_HEIGHT,
  DetailHeader,
} from '@/components/design/DetailHeader';
import { FilterSheet } from '@/components/design/FilterSheet';
import { DemographicsPromptSheet } from '@/components/onboarding/DemographicsPromptSheet';
import { AuthRequiredModal } from '@/components/ui/AuthRequiredModal';
import { SimilarityStagesModal } from '@/components/ui/SimilarityStagesModal';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useGamificationEnabled } from '@/hooks/useGamificationEnabled';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useCashbackUserState } from '@/lib/hooks/useCashbackUserState';
import { useRevenueCat } from '@/lib/contexts/RevenueCatProvider';
import { useTheme } from '@/lib/contexts/ThemeContext';
import { achievementService } from '@/lib/services/achievementService';
import {
  ALL_TOUR_KEYS,
  CoachmarkService,
  type TourKey,
} from '@/lib/services/coachmarkService';
import { FirestoreService } from '@/lib/services/firestore';
import type { Level } from '@/lib/types/achievements';
import {
  LEVEL_GRADIENT_END,
  LEVEL_GRADIENT_START,
  levelGradient,
  mdiForLevelIcon,
} from '@/lib/utils/levelIcon';

// `levelGradient` + `mdiForLevelIcon` live in `lib/utils/levelIcon.ts`
// — shared with home + achievements screens so all three render
// identical colour + icon identity for the same level.

// ────────────────────────────────────────────────────────────────────
// Screen
// ────────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { theme, shadows } = useTokens();
  const insets = useSafeAreaInsets();
  // Spielerische Inhalte-Toggle. Wenn aus → Level-Card, Punkte-
  // Stats, "Belohnungen & Level"-Menüeintrag werden ausgeblendet.
  // Cashback (€) bleibt sichtbar weil das echtes Geld ist.
  const gamificationEnabled = useGamificationEnabled();
  const navigation = useNavigation();

  const { user, userProfile, logout, isAnonymous } = useAuth();
  const cashback = useCashbackUserState();
  const cashbackEurStr = (cashback.balanceCents / 100)
    .toFixed(2)
    .replace('.', ',');
  const { isPremium, presentPaywall } = useRevenueCat();
  const { isDarkMode, toggleDarkMode } = useTheme();

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSocialSheet, setShowSocialSheet] = useState(false);
  const [showSimilarityModal, setShowSimilarityModal] = useState(false);
  // T11.8: Debug-Trigger für das Demographie-Sheet — pure visual
  // Vorschau, schreibt nichts ans User-Doc (anders als der echte
  // Climax-Flow). Submit/Skip schließen einfach.
  const [showDemographicsTest, setShowDemographicsTest] = useState(false);
  const [showOnboardingButton, setShowOnboardingButton] = useState(false);
  const [gamificationDisabled, setGamificationDisabled] = useState(false);
  // Umfrage-Vorschläge nach Aktionen (ClickUp 86ca8fbpz) — Default an.
  const [actionSurveysEnabled, setActionSurveysEnabled] = useState(true);
  const [appVersion, setAppVersion] = useState('1.0.0');
  // Levels catalogue — loaded from achievementService so the level
  // card shows the level's actual colour + icon + threshold (same
  // numbers shown on /achievements + the home-tab card). Without
  // this we'd fall back to a heuristic (level+1)*1000 estimate that
  // doesn't match the rest of the app.
  const [levels, setLevels] = useState<Level[]>([]);

  // Hide native stack header — we render our own DetailHeader.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    // Aus dem nativen Binary lesen (expo-application), NICHT aus
    // Constants.expoConfig. expoConfig kommt aus app.json zur
    // JS-Bundle-Build-Zeit — bei EAS-Builds mit autoIncrement
    // weicht die Nummer dort von der wirklich installierten Build-
    // Nummer ab. nativeApplicationVersion / nativeBuildVersion
    // lesen direkt aus Info.plist (iOS) bzw. PackageInfo (Android),
    // also exakt das was im Store/TestFlight gelandet ist.
    const v = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '1.0.0';
    const b = Application.nativeBuildVersion ?? '0';
    setAppVersion(`${v}.${b}`);
  }, []);

  useEffect(() => {
    let alive = true;
    achievementService
      .getAllLevels()
      .then((ls) => {
        if (alive) setLevels(ls || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        // Onboarding-Button nur zeigen wenn User geskippt hat
        // (egal ob early oder mid) UND nie abgeschlossen — dann
        // bieten wir "Onboarding nachholen" an.
        const status = await OnboardingService.getStatus();
        if (!alive) return;
        setShowOnboardingButton(
          status === 'skipped_early' || status === 'skipped_mid',
        );

        const { gamificationSettingsService } = await import(
          '@/lib/services/gamificationSettingsService'
        );
        const disabled = await gamificationSettingsService.areNotificationsDisabled();
        if (!alive) return;
        setGamificationDisabled(disabled);
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  // Resolved user data
  const displayName = userProfile?.display_name || user?.displayName || 'Detektiv';
  const realName = (userProfile as any)?.real_name || '';
  const email = userProfile?.email || user?.email || '';

  // Debug-Section-Gate. Im DEV-Build immer sichtbar. In Production-
  // Builds (TestFlight + Play-Internal) nur für ein spezifisches
  // Whitelist-Email — sodass der Owner auf seinem Live-Device die
  // Debug-Tools ohne Sonder-Build verwenden kann, normale Tester
  // die Section aber nicht zu Gesicht kriegen.
  const DEBUG_WHITELIST = ['patrickvfbfan@web.de'];
  const showDebugSection =
    __DEV__ || (email && DEBUG_WHITELIST.includes(email.toLowerCase()));
  const photoUrl = (userProfile as any)?.photo_url || user?.photoURL || null;
  const totalSavings = Number(userProfile?.totalSavings ?? 0);
  const productsSaved = Number((userProfile as any)?.productsSaved ?? 0);
  const level = Number(
    (userProfile as any)?.stats?.currentLevel ??
      (userProfile as any)?.level ??
      1,
  );
  const points = Number(
    (userProfile as any)?.stats?.pointsTotal ??
      (userProfile as any)?.stats?.totalPoints ??
      0,
  );
  const favoriteMarket = (userProfile as any)?.favoriteMarketName || '';
  const favoriteMarketId = (userProfile as any)?.favoriteMarket || '';
  // Lieblingsmarkt-Land (Country-Code, z. B. "DE", "AT") wird auf dem
  // User-Profil NICHT mitgespeichert — nur die ID + der Name sind
  // gecacht. Wir holen den Discounter beim Mount einmalig per ID nach,
  // um das Land in Klammern hinter den Namen zu setzen ("LiDL (DE)").
  // FirestoreService cached Discounter intern (30 Min), das ist also
  // fast immer ein Cache-Hit.
  const [favoriteMarketLand, setFavoriteMarketLand] = useState<string>('');
  useEffect(() => {
    let alive = true;
    if (!favoriteMarketId) {
      setFavoriteMarketLand('');
      return;
    }
    FirestoreService.getDiscounterById(favoriteMarketId)
      .then((d: any) => {
        if (alive) setFavoriteMarketLand(d?.land || '');
      })
      .catch(() => {
        if (alive) setFavoriteMarketLand('');
      });
    return () => {
      alive = false;
    };
  }, [favoriteMarketId]);
  const city =
    (userProfile as any)?.city ?? (userProfile as any)?.guessedCity ?? '';
  const bundesland =
    (userProfile as any)?.bundesland ??
    (userProfile as any)?.guessedBundesland ??
    '';

  // Real level info from the catalogue — same source the home
  // card and the Errungenschaften screen use.
  const levelInfo = levels.find((l) => l.id === level);
  const nextLevel = levels.find((l) => l.id === level + 1);
  const remainingPoints = nextLevel
    ? Math.max(0, (nextLevel.pointsRequired ?? 0) - points)
    : 0;
  const remainingSavings = nextLevel
    ? Math.max(0, (nextLevel.savingsRequired ?? 0) - totalSavings)
    : 0;
  const levelSubtitle = (() => {
    if (!nextLevel) return 'Maximales Level erreicht!';
    const eur = remainingSavings.toFixed(2).replace('.', ',') + ' €';
    const pts = `${remainingPoints.toLocaleString('de-DE')} Pkt`;
    if (remainingSavings <= 0 && remainingPoints <= 0) {
      return 'Bereit fürs nächste Level!';
    }
    if (remainingSavings <= 0) return `${pts} zum nächsten Level`;
    if (remainingPoints <= 0) return `${eur} zum nächsten Level`;
    return `${eur} & ${pts} zum nächsten Level`;
  })();

  // ── External link helpers ─────────────────────────────────────
  const openExternal = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
        controlsColor: theme.primary,
        toolbarColor: theme.bg,
      });
    } catch {
      Linking.openURL(url);
    }
  };

  const handleShareApp = () =>
    Share.share({
      message:
        'Schau dir die Markendetektive App an! Spare Geld mit NoName-Produkten.',
      url: 'https://markendetektive.de',
    });

  const handleRateApp = async () => {
    try {
      const { ratingPromptService } = await import(
        '@/lib/services/ratingPrompt'
      );
      const handler: any = (ratingPromptService as any).showRatingModal;
      if (typeof handler === 'function') handler(true);
      else Alert.alert('Bewertung', 'Bewertung kann derzeit nicht geöffnet werden.');
    } catch {
      Alert.alert('Bewertung', 'Bewertung kann derzeit nicht geöffnet werden.');
    }
  };

  const handleResumeOnboarding = async () => {
    try {
      await OnboardingService.resetOnboarding();
      setShowOnboardingButton(false);
      safePush('/onboarding' as any);
    } catch (e) {
      console.warn('Profile: resumeOnboarding failed', e);
    }
  };

  const handleGamificationToggle = async (next: boolean) => {
    try {
      const { gamificationSettingsService } = await import(
        '@/lib/services/gamificationSettingsService'
      );
      await gamificationSettingsService.setNotificationsDisabled(next);
      setGamificationDisabled(next);
    } catch (e) {
      console.warn('Profile: gamification toggle failed', e);
    }
  };

  // Umfrage-Vorschläge nach Aktionen an/aus (dauerhaft). Initial laden +
  // beim Umschalten persistieren (surveyService, AsyncStorage).
  useEffect(() => {
    let alive = true;
    import('@/lib/services/surveyService')
      .then((m) => m.areActionSurveysEnabled())
      .then((v) => {
        if (alive) setActionSurveysEnabled(v);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const handleActionSurveyToggle = async (next: boolean) => {
    setActionSurveysEnabled(next);
    try {
      const m = await import('@/lib/services/surveyService');
      await m.setActionSurveysEnabled(next);
    } catch (e) {
      console.warn('Profile: survey toggle failed', e);
    }
  };

  const handleLogout = () => {
    if (isAnonymous) {
      setShowAuthModal(true);
      return;
    }
    Alert.alert('Abmelden', 'Möchtest du dich wirklich abmelden?', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Abmelden',
        style: 'destructive',
        onPress: async () => {
          try {
            await logout();
            // Leave the profile route — the registered-only
            // sections at the bottom (account-löschen, etc.)
            // don't make sense for the now-anonymous user, and
            // staying on /profile means we'd render a stale
            // identity for one frame before the AuthContext
            // listener fires. `replace` (not `push`) so back-
            // navigation doesn't return the user here.
            router.replace('/(tabs)' as any);
          } catch {
            Alert.alert('Fehler', 'Beim Abmelden ist ein Fehler aufgetreten.');
          }
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Account löschen',
      'Bist du sicher? Diese Aktion kann nicht rückgängig gemacht werden.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Account löschen',
          style: 'destructive',
          onPress: async () => {
            if (!user) return;
            try {
              const { deleteUser } = await import('@react-native-firebase/auth');
              await deleteUser(user);
              router.replace('/');
            } catch (e: any) {
              if (e?.code === 'auth/requires-recent-login') {
                Alert.alert(
                  'Erneute Anmeldung erforderlich',
                  'Aus Sicherheitsgründen bitte erneut anmelden.',
                  [
                    {
                      text: 'Anmelden',
                      onPress: async () => {
                        await logout();
                        router.replace('/auth/login' as any);
                      },
                    },
                    { text: 'Abbrechen', style: 'cancel' },
                  ],
                );
              } else {
                Alert.alert(
                  'Fehler',
                  'Account konnte nicht gelöscht werden.',
                );
              }
            }
          },
        },
      ],
    );
  };

  // ─── Coachmark (Per-Screen-Tour) Dev-Tools ──────────────────────
  //
  // NICHT zu verwechseln mit dem `onResetOnboardingDev` direkt
  // darunter — das ist der 9-Step-Daten-Erhebungs-Flow, das hier
  // sind die kleinen Erklär-Overlays die beim ersten Besuch jeder
  // Hauptscreen-Seite erscheinen.

  const COACHMARK_LABELS: Record<TourKey, string> = {
    home: 'Home (Welcome + Spotlight)',
    'product-detail': 'Produktdetail (Welcome + 3 Spotlights)',
    rewards: 'Belohnungen (Karten-Modal)',
  };

  // Route pro Tour — wird für die "Tour jetzt zeigen"-Aktion benutzt.
  // Für 'product-detail' brauchen wir eine konkrete Produkt-ID; wir
  // verwenden den ersten enttarnten Top-Treffer als Demo-Ziel
  // (siehe `replayProductDetail` unten — async Lookup).
  const COACHMARK_ROUTES: Record<TourKey, string> = {
    home: '/(tabs)',
    'product-detail': '', // dynamisch aufgelöst, siehe onCoachmarkReplayOne
    rewards: '/(tabs)/rewards',
  };

  const [coachmarkStatuses, setCoachmarkStatuses] = useState<
    Record<TourKey, string | null>
  >({
    home: null,
    'product-detail': null,
    rewards: null,
  });

  const reloadCoachmarkStatuses = useCallback(async () => {
    const status = await CoachmarkService.getAllStatus();
    setCoachmarkStatuses(status);
  }, []);

  useEffect(() => {
    void reloadCoachmarkStatuses();
  }, [reloadCoachmarkStatuses]);

  const formatCoachmarkSeen = (iso: string | null) => {
    if (!iso) return 'noch nicht gesehen';
    try {
      const d = new Date(iso);
      // German short-date format ("30.04.26, 15:23"). Locale-stable
      // because we pass 'de-DE' explicitly.
      return `gesehen am ${d.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      })} ${d.toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    } catch {
      return 'gesehen';
    }
  };

  // ─── Komplett-Reset (Test-User) ────────────────────────────────
  //
  // Löscht NUR LOKAL alles was die App gespeichert hat (AsyncStorage)
  // und meldet den User ab. Auf __DEV__-Builds triggern wir
  // anschließend `DevSettings.reload()` → JS-Bundle reboots
  // automatisch, frische AuthContext-Pipeline läuft an, anonymer
  // User mit neuer UID, Level 1, kein Onboarding-Flag.
  //
  // Wirkung in einem:
  //   • Onboarding-Flow (9-Step) startet wieder bei Schritt 1
  //   • Coachmark-Tours stehen auf "noch nicht gesehen"
  //   • Level zurück auf 1, 0 Punkte, keine Achievements
  //   • Lieblingsmarkt + alle Personalisierungen weg
  //   • Such-Verlauf, Cart, Favoriten weg (sofern lokal cached)
  //
  // Was NICHT angefasst wird:
  //   • Das alte User-Doc auf Firestore — bleibt liegen. Wenn du
  //     dich später wieder mit Email/Passwort einloggst, sind
  //     deine echten Daten zurück. Pro Reset-Run ist man halt ein
  //     anderer anonymer User.
  //
  // Nur in __DEV__ verfügbar.
  const onFullLocalReset = () =>
    Alert.alert(
      'Komplett-Reset (lokal)',
      'Löscht alle lokalen App-Daten und meldet dich ab. Beim nächsten Start bist du ein frischer anonymer Test-User: Level 1, kein Onboarding gemacht, keine Tours gesehen.\n\nDas alte Firestore-Doc bleibt unangetastet — Account-Login wäre wiederherstellbar.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              // 1. Logout zuerst, damit Firebase seine Persistenz
              // ordentlich räumt bevor wir AsyncStorage wegblasen.
              try {
                await logout();
              } catch (e) {
                console.warn('FullReset: logout failed (non-fatal)', e);
              }

              // 2. AsyncStorage komplett wegblasen.
              await AsyncStorage.clear();

              // 3. Belt-and-suspenders: explizit nochmal die
              // bekannten Reset-Keys droppen, falls AsyncStorage.clear()
              // aus irgendeinem Grund einzelne nicht abgeräumt hat.
              // Onboarding-Status geht via Service (Single Source of
              // Truth) — der löscht auch v1-Legacy-Keys mit.
              await OnboardingService.resetOnboarding();
              await AsyncStorage.multiRemove([
                '@gamification_notifications_disabled',
                'coachmark/v1/home',
                'coachmark/v1/rewards',
                '@auth_user_id_backup',
                '@auth_user_email_backup',
                '@auth_last_login',
              ]);

              // 4. Kurz warten damit AsyncStorage native flush
              // durch ist (sonst könnte ein DevSettings.reload()
              // das JS bevor die Schreibvorgänge committed sind
              // re-hochfahren).
              await new Promise((resolve) => setTimeout(resolve, 200));

              // 5. App reload. In __DEV__ programmatic via
              // DevSettings → JS-Bundle reboots, frische
              // AuthContext-Pipeline → /onboarding/hero. In
              // Production-Build ist das nicht verfügbar →
              // Fallback auf Alert.
              if (__DEV__) {
                try {
                  DevSettings.reload();
                  return; // Kein Alert mehr, App lädt gerade neu
                } catch (e) {
                  console.warn('DevSettings.reload failed:', e);
                }
              }
              Alert.alert(
                'Erledigt',
                'Bitte App komplett schließen und neu öffnen — beim nächsten Start bist du frischer Test-User.',
              );
            } catch (e: any) {
              Alert.alert(
                'Fehler beim Reset',
                String(e?.message ?? e),
              );
            }
          },
        },
      ],
    );

  const onCoachmarkResetAll = () =>
    Alert.alert(
      'Tours zurücksetzen',
      'Beim nächsten Besuch von Home und Belohnungen erscheinen die Erklär-Tours erneut.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Zurücksetzen',
          style: 'destructive',
          onPress: async () => {
            await CoachmarkService.resetAll();
            await reloadCoachmarkStatuses();
            Alert.alert(
              'Erledigt',
              'Alle Tours sind zurückgesetzt — beim nächsten Mount jedes Screens taucht die Tour wieder auf.',
            );
          },
        },
      ],
    );

  const onCoachmarkReplayOne = async (key: TourKey) => {
    // Erst zur passenden Seite navigieren, dann nach kurzem Delay
    // das Replay-Event feuern. Der Delay gibt dem Ziel-Screen
    // Zeit zu mounten und der useCoachmark-Hook Zeit, sich beim
    // EventEmitter zu registrieren — sonst geht das Event ins Leere.
    // 500 ms hat sich in der Praxis als ausreichend erwiesen
    // (Stack-Animation ~300 ms + Mount-Render ~100-150 ms).
    if (key === 'product-detail') {
      // Demo-Ziel: erstes top-enttarntes Produkt für die Detail-
      // Tour. Dynamisch weil's keine feste Produkt-ID gibt.
      try {
        const top = await FirestoreService.getTopEnttarnteProdukteRandomized(
          10,
          1,
        );
        const productId = top?.[0]?.id;
        if (!productId) {
          Alert.alert(
            'Kein Demo-Produkt',
            'Konnte kein Demo-Produkt für die Detail-Tour finden.',
          );
          return;
        }
        // Stufe < 3 → noname-detail, sonst product-comparison.
        const stufe = parseInt(String((top[0] as any).stufe ?? '1')) || 1;
        const route =
          stufe <= 2
            ? `/noname-detail/${productId}`
            : `/product-comparison/${productId}?type=noname`;
        safePush(route as any);
      } catch (e) {
        Alert.alert('Fehler', String((e as any)?.message ?? e));
        return;
      }
    } else {
      safePush(COACHMARK_ROUTES[key] as any);
    }
    setTimeout(() => {
      CoachmarkService.requestReplay(key);
    }, 600);
  };

  const onResetOnboardingDev = () =>
    Alert.alert(
      'Onboarding zurücksetzen',
      'Beim nächsten App-Start erscheint das Onboarding wieder.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Zurücksetzen',
          style: 'destructive',
          onPress: async () => {
            const { OnboardingService } = await import(
              '@/lib/services/onboardingService'
            );
            await OnboardingService.resetOnboarding();
            Alert.alert('Erledigt', 'Bitte App neu starten.');
          },
        },
      ],
    );

  /**
   * Test-Helper: Onboarding-Flags resetten UND direkt zum Onboarding
   * navigieren (ohne App-Restart). Schneller dev-loop für UI-Tests
   * + State-Resets — User-Wunsch ('mach das onboarding im debug
   * bereich direkt aufrufbar damit ich besser testen kann').
   */
  const onJumpToOnboardingDev = async () => {
    try {
      const { OnboardingService } = await import(
        '@/lib/services/onboardingService'
      );
      await OnboardingService.resetOnboarding();
      router.replace('/onboarding');
    } catch (err) {
      console.error('❌ Jump-to-onboarding failed:', err);
      Alert.alert('Fehler', 'Onboarding konnte nicht geöffnet werden.');
    }
  };

  const onConsentForceShow = async () => {
    try {
      const { consentService } = await import(
        '@/lib/services/consentService'
      );
      await consentService.forceShowConsentForm();
    } catch (e: any) {
      Alert.alert('Fehler', String(e?.message ?? e));
    }
  };
  const onConsentReset = async () => {
    try {
      const { consentService } = await import(
        '@/lib/services/consentService'
      );
      await consentService.resetConsent();
      Alert.alert('Consent zurückgesetzt', 'Erscheint beim nächsten Start neu.');
    } catch (e: any) {
      Alert.alert('Fehler', String(e?.message ?? e));
    }
  };
  const onConsentStatus = async () => {
    try {
      const { consentService } = await import(
        '@/lib/services/consentService'
      );
      await consentService.initialize();
      const s = await consentService.getDetailedStatus();
      Alert.alert(
        'Consent Status',
        `Status: ${s.status}\nCan Show Ads: ${s.canShowAds ? '✓' : '✗'}\nPersonalized: ${s.canShowPersonalizedAds ? '✓' : '✗'}`,
      );
    } catch (e: any) {
      Alert.alert('Fehler', String(e?.message ?? e));
    }
  };
  const onShowBonScanConsent = async () => {
    // Wipe the cashback consent so the screen mounts in its
    // first-time state, then navigate. Fail-soft if there's no user
    // (anonymous flow lands on /auth before /cashback/consent anyway).
    try {
      if (user?.uid) {
        const { revokeCashbackConsent } = await import(
          '@/lib/services/cashbackService'
        );
        await revokeCashbackConsent(user.uid);
      }
    } catch (e: any) {
      // Non-fatal — the consent screen still renders, just won't
      // be in the pristine "first time" state.
      console.warn('revokeCashbackConsent failed', e?.message);
    }
    safePush('/cashback/consent?from=receipt' as any);
  };
  const onResetUnlocks = async () => {
    try {
      const { categoryAccessService } = await import(
        '@/lib/services/categoryAccessService'
      );
      await categoryAccessService.resetAllTemporaryUnlocks();
      Alert.alert('Erledigt', 'Temporäre Kategorie-Freischaltungen entfernt.');
    } catch (e: any) {
      Alert.alert('Fehler', String(e?.message ?? e));
    }
  };

  // Dev-Reset: löscht alle Mirror-Docs (`users/{uid}/cashback_status/*`)
  // damit der nächste Bon-Upload mit frischen Counter-Limits startet
  // und keine "duplicate"-Treffer durch alte clientUploadIds entstehen.
  // Affects nur den Mirror — die echten /receipts/* Server-Docs bleiben
  // (das ist Cloud-Function-Domäne, kein Client-Schreibrecht).
  const onResetCashbackBons = async () => {
    if (!user?.uid) {
      Alert.alert('Nicht angemeldet', 'Bitte zuerst anmelden.');
      return;
    }
    Alert.alert(
      'Bons zurücksetzen?',
      'Entfernt alle lokalen Mirror-Einträge unter cashback_status. Server-seitige Receipts bleiben erhalten.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Zurücksetzen',
          style: 'destructive',
          onPress: async () => {
            try {
              const [{ collection, getDocs, deleteDoc }, { db }] =
                await Promise.all([
                  import('@react-native-firebase/firestore'),
                  import('@/lib/firebase'),
                ]);
              const snap = await getDocs(
                collection(db, `users/${user.uid}/cashback_status`),
              );
              let n = 0;
              for (const d of snap.docs) {
                await deleteDoc(d.ref);
                n++;
              }
              Alert.alert('Erledigt', `${n} Bon-Einträge gelöscht.`);
            } catch (e: any) {
              console.error('[debug] resetCashbackBons failed', e);
              Alert.alert('Fehler', String(e?.message ?? e));
            }
          },
        },
      ],
    );
  };

  // ── Header chrome (DetailHeader, like achievements + product details)
  const chromeHeight = insets.top + DETAIL_HEADER_ROW_HEIGHT;
  const editAction = () => {
    if (isAnonymous) setShowAuthModal(true);
    else safePush('/edit-profile' as any);
  };

  // ── Single render path for both anonymous + registered. The
  //    only differences:
  //      • Identity block: anonymous shows "Anonymer Detektiv"
  //        placeholder + upgrade CTA tile, registered shows real
  //        name/email/badges
  //      • Bottom action: anonymous gets "Mit Account anmelden",
  //        registered gets Logout + Account-löschen
  //      • Account löschen: anonymous never shows it (no account)
  //    Everything else (Level, Savings, Menu sections, Settings
  //    toggles, Version, DEV tools) is identical so the user can
  //    fully explore the app even before registering.
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: chromeHeight,
          paddingBottom: 60,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity block — adapts to auth state */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
          }}
        >
          {isAnonymous ? (
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: theme.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: theme.border,
              }}
            >
              <MaterialCommunityIcons
                name="account-question-outline"
                size={32}
                color={theme.textMuted}
              />
            </View>
          ) : (
            <Avatar photoUrl={photoUrl} name={displayName} />
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            {/* Name + Premium-Krone: die Krone sitzt schräg über der
                rechten oberen Ecke des Namens (User-Vorgabe 2026-06-11
                — "fühlt sich besser an"). Wrapper hugged den Text
                (flex-start), damit die Krone am Namensende klebt,
                egal wie lang der Name ist. */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
              }}
            >
              <View style={{ position: 'relative', flexShrink: 1, minWidth: 0 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 22,
                    color: theme.text,
                    letterSpacing: -0.3,
                  }}
                >
                  {isAnonymous ? 'Anonymer Detektiv' : displayName}
                </Text>
                {isPremium ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -9,
                      right: -6,
                      transform: [{ rotate: '18deg' }],
                    }}
                  >
                    <MaterialCommunityIcons
                      name="crown"
                      size={15}
                      color="#FFC107"
                    />
                  </View>
                ) : null}
              </View>
            </View>
            {!isAnonymous && realName ? (
              <Text
                numberOfLines={1}
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 12,
                  color: theme.textMuted,
                  marginTop: 1,
                }}
              >
                {realName}
              </Text>
            ) : null}
            {isAnonymous ? (
              <Text
                numberOfLines={2}
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 12,
                  color: theme.textMuted,
                  marginTop: 2,
                }}
              >
                Nicht alle Features verfügbar — sichere deine Daten mit
                einem Account.
              </Text>
            ) : (
              <Text
                numberOfLines={1}
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 11,
                  color: theme.textMuted,
                  marginTop: 2,
                }}
              >
                {email}
              </Text>
            )}
            {!isAnonymous && (favoriteMarket || city) ? (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 6,
                  marginTop: 7,
                }}
              >
                {favoriteMarket ? (
                  <LocBadge
                    icon="store-outline"
                    label={`Dein Lieblingsmarkt: ${favoriteMarket}${
                      favoriteMarketLand ? ` (${favoriteMarketLand})` : ''
                    }`}
                  />
                ) : null}
                {city ? (
                  <LocBadge
                    icon="map-marker-outline"
                    label={
                      bundesland ? `${city}, ${bundesland}` : city
                    }
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        </View>

        {/* For anonymous users: prominent upgrade CTA (replaces the
            premium banner that only makes sense for logged-in users) */}
        {isAnonymous ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
            <Pressable
              onPress={() => safePush('/auth/register?from=app' as any)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 14,
                borderRadius: 14,
                backgroundColor: theme.surface,
                borderWidth: 1.5,
                borderColor: theme.primary,
                opacity: pressed ? 0.92 : 1,
              })}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialCommunityIcons
                  name="cloud-upload-outline"
                  size={22}
                  color={theme.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 14,
                    color: theme.text,
                  }}
                >
                  Daten sichern & synchronisieren
                </Text>
                <Text
                  numberOfLines={2}
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 11,
                    color: theme.textMuted,
                    marginTop: 2,
                  }}
                >
                  Account erstellen für Backup & geräteübergreifenden Sync
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={18}
                color={theme.textMuted}
              />
            </Pressable>
          </View>
        ) : null}

        {/* T16: Premium-Banner / Ads-Entfernen — App ist FREE, einziger
            Premium-Benefit ist Werbe-Entfernung. Sichtbar für JEDEN
            non-premium User (auch anonyme). Title fokussiert auf den
            konkreten Benefit statt abstraktem "Premium". */}
        {!isPremium ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
            <Pressable
              onPress={() => presentPaywall('profile_upgrade')}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 14,
                borderRadius: 12,
                backgroundColor: theme.surface,
                borderWidth: 1.5,
                borderColor: '#FFC107',
                opacity: pressed ? 0.92 : 1,
              })}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: 'rgba(255,193,7,0.15)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialCommunityIcons name="close-octagon" size={20} color="#FFC107" />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 14,
                    color: theme.text,
                    letterSpacing: -0.2,
                  }}
                >
                  Werbung entfernen
                </Text>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 12,
                    color: theme.textMuted,
                    marginTop: 2,
                    letterSpacing: -0.1,
                  }}
                >
                  MarkenDetektive werbefrei genießen
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={18}
                color={theme.textMuted}
              />
            </Pressable>
          </View>
        ) : null}

        {/* Level card — neutral surface + level-gradient icon
            circle + single-line "X € & Y Pkt zum nächsten Level"
            subtitle. Identical pattern to the home-tab level card
            so both surfaces feel like the same component (and
            both link to /achievements). No progress bar — the
            inline subtitle carries the same info more compactly.
            Komplett versteckt wenn Spielerische Inhalte deaktiviert
            sind. */}
        {gamificationEnabled ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
          <Pressable
            onPress={() => safePush('/achievements' as any)}
            style={({ pressed }) => ({
              borderRadius: radii.lg,
              backgroundColor: theme.surface,
              paddingHorizontal: 14,
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              opacity: pressed ? 0.94 : 1,
              ...shadows.sm,
            })}
          >
            <LinearGradient
              colors={levelGradient(level, levelInfo?.color)}
              start={LEVEL_GRADIENT_START}
              end={LEVEL_GRADIENT_END}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <MaterialCommunityIcons
                name={mdiForLevelIcon(levelInfo?.icon)}
                size={20}
                color="#fff"
              />
            </LinearGradient>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 14,
                  color: theme.text,
                  letterSpacing: -0.2,
                }}
              >
                Level {level}
                {levelInfo?.name ? ` · ${levelInfo.name}` : ''}
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 12,
                  color: theme.textMuted,
                  marginTop: 2,
                }}
              >
                {levelSubtitle}
              </Text>
            </View>

            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={theme.textMuted}
            />
          </Pressable>
        </View>
        ) : null}

        {/* Savings card — orange gradient, links to purchase history */}
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <Pressable
            onPress={() => safePush('/purchase-history' as any)}
            style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
          >
            <LinearGradient
              colors={['#f97316', '#ea580c']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                borderRadius: 14,
                paddingHorizontal: 14,
                paddingVertical: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.semibold,
                    fontSize: 10,
                    color: '#fff',
                    opacity: 0.9,
                    letterSpacing: 0.6,
                    textTransform: 'uppercase',
                  }}
                >
                  Deine Gesamtersparnis
                </Text>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 22,
                    color: '#fff',
                    letterSpacing: -0.4,
                    marginTop: 3,
                  }}
                >
                  {totalSavings.toFixed(2).replace('.', ',')} €
                </Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderRadius: 10,
                  backgroundColor: 'rgba(255,255,255,0.22)',
                  alignItems: 'center',
                }}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 16,
                    color: '#fff',
                  }}
                >
                  {productsSaved}
                </Text>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.semibold,
                    fontSize: 9,
                    color: '#fff',
                    opacity: 0.9,
                  }}
                >
                  gekauft
                </Text>
              </View>
            </LinearGradient>
          </Pressable>
        </View>

        {/* Account / Inhalte menu */}
        <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
          <MenuCard>
            {/* Gamification-Bereich: zwei Einträge, beide hinter dem
                Toggle versteckbar.
                  1. "Belohnungen" → führt zum Rewards-Tab (Cashback
                     einlösen, Bestenliste).
                  2. "Level & Errungenschaften" → führt zur Errungen-
                     schaften-Seite (Level-Catalog + Achievement-Liste).
                Wenn beide versteckt sind rückt die Einkaufszettel-Row
                in die `first`-Position. */}
            {/* "Belohnungen" führt zum Cashback-Konto (echtes Geld) → IMMER
                sichtbar, auch wenn Gamification aus ist (ClickUp 86ca8hpgd).
                Nur "Level & Errungenschaften" (reine Gamification) hängt am
                Toggle. */}
            <MenuRow
              icon="gift-outline"
              color="#f97316"
              label="Belohnungen"
              sub={`${cashbackEurStr} € Cashback-Konto`}
              onPress={() => safePush('/(tabs)/rewards' as any)}
              first
            />
            {gamificationEnabled ? (
              <MenuRow
                icon="trophy-outline"
                color="#e0a800"
                label="Level & Errungenschaften"
                sub={`Level ${level} · ${points.toLocaleString('de-DE')} Pkt`}
                onPress={() => safePush('/achievements' as any)}
              />
            ) : null}
            <MenuRow
              icon="format-list-checks"
              color={theme.primary}
              label="Einkaufszettel"
              onPress={() => safePush('/shopping-list' as any)}
            />
            <MenuRow
              icon="heart-outline"
              color="#ef4444"
              label="Lieblingsprodukte"
              onPress={() => safePush('/favorites' as any)}
            />
            <MenuRow
              icon="history"
              color="#8b5cf6"
              label="Kaufhistorie"
              onPress={() => safePush('/purchase-history' as any)}
            />
            <MenuRow
              icon="clipboard-list-outline"
              color="#0d8575"
              label="Meine Bons"
              sub="Verlauf, Status & abgelehnte Bons"
              onPress={() => safePush('/cashback/history' as any)}
            />
            <MenuRow
              icon="magnify"
              color="#0ea5e9"
              label="Such- & Scanverlauf"
              onPress={() => safePush('/history' as any)}
            />
            <MenuRow
              icon="chart-bar"
              color="#0d8575"
              label="Stufensystem erklärt"
              onPress={() => setShowSimilarityModal(true)}
            />
            <MenuRow
              icon="account-edit-outline"
              color={theme.textMuted}
              label="Profil bearbeiten"
              onPress={() => safePush('/edit-profile' as any)}
              last
            />
          </MenuCard>
        </View>

        {/* Mehr */}
        <SectionLabel theme={theme}>Mehr</SectionLabel>
        <View style={{ paddingHorizontal: 20 }}>
          <MenuCard>
            {showOnboardingButton ? (
              <MenuRow
                icon="account-plus-outline"
                color={theme.primary}
                label="Onboarding abschließen"
                onPress={handleResumeOnboarding}
                first
              />
            ) : null}
            <MenuRow
              icon="lightbulb-on-outline"
              color={theme.primary}
              label="Tipps & Tricks"
              onPress={() => safePush('/tipps-und-tricks' as any)}
              first={!showOnboardingButton}
            />
            <MenuRow
              icon="newspaper-variant-outline"
              color={theme.primary}
              label="Neuigkeiten"
              onPress={() =>
                openExternal('https://www.markendetektive.de/blog/')
              }
            />
            <MenuRow
              icon="account-group-outline"
              color={theme.primary}
              label="Find us on Social Media"
              onPress={() => setShowSocialSheet(true)}
            />
            <MenuRow
              icon="star-outline"
              color={theme.primary}
              label="App bewerten"
              onPress={handleRateApp}
            />
            <MenuRow
              icon="share-variant-outline"
              color={theme.primary}
              label="App teilen"
              onPress={handleShareApp}
            />
            <MenuRow
              icon="bell-outline"
              color={theme.primary}
              label="Benachrichtigungen"
              onPress={() => safePush('/notification-settings' as any)}
              last
            />
          </MenuCard>
        </View>

        {/* Kontakt & Rechtliches */}
        <SectionLabel theme={theme}>Kontakt & Rechtliches</SectionLabel>
        <View style={{ paddingHorizontal: 20 }}>
          <MenuCard>
            <MenuRow
              icon="shield-outline"
              color={theme.primary}
              label="Datenschutz & Haftungsausschluss"
              onPress={() =>
                openExternal(
                  'https://www.markendetektive.de/datenschutzerklaerung-haftungsausschluss/',
                )
              }
              first
            />
            <MenuRow
              icon="file-document-outline"
              color={theme.primary}
              label="AGB"
              onPress={() =>
                openExternal('https://www.markendetektive.de/agb/')
              }
            />
            <MenuRow
              icon="email-outline"
              color={theme.primary}
              label="Kontakt"
              onPress={() =>
                openExternal('https://www.markendetektive.de/kontakt/')
              }
              last
            />
          </MenuCard>
        </View>

        {/* Einstellungen — toggles */}
        <SectionLabel theme={theme}>Einstellungen</SectionLabel>
        <View style={{ paddingHorizontal: 20 }}>
          <MenuCard>
            <ToggleRow
              icon={isDarkMode ? 'weather-night' : 'white-balance-sunny'}
              label="Dunkler Modus"
              value={isDarkMode}
              onChange={toggleDarkMode}
              first
            />
            <ToggleRow
              icon="bell-off-outline"
              label="Spielerische Inhalte ausblenden"
              value={gamificationDisabled}
              onChange={handleGamificationToggle}
            />
            {/* Stumm-Schalter: ON = Umfragen stumm (keine Vorschläge nach
                Aktionen). Intern bleibt actionSurveysEnabled die Wahrheit
                (an = Vorschläge erlaubt) → hier invertiert dargestellt. */}
            <ToggleRow
              icon="volume-off"
              label="Umfragen stumm schalten"
              value={!actionSurveysEnabled}
              onChange={(muted) => handleActionSurveyToggle(!muted)}
            />
            {/* T17.31 + ClickUp 86ca6u6xd [5]: Cashback & Markt-
                Statistiken — der EINE v2-Consent (Bon-Daten + App-
                Nutzung). Row ist IMMER sichtbar, weil die Datenschutz-
                erklärung den Widerruf unter "Profil → Einstellungen"
                verspricht:
                • AN → AUS: Confirm-Alert; bestätigt → revoke. Das
                  Tracking-Gate (trackingConsent.ts) schließt live über
                  den User-Snapshot — Erfassung endet sofort.
                • AUS → AN: KEIN stilles Aktivieren — informierte
                  Einwilligung nötig → Route zum Consent-Screen; nach
                  Accept flippt der Snapshot den Toggle automatisch. */}
            <ToggleRow
              icon="cash-multiple"
              label="Cashback & Rewards"
              value={cashback.hasConsent}
              onChange={() => {
                if (cashback.hasConsent) {
                  Alert.alert(
                    'Cashback & Rewards deaktivieren?',
                    'Die Erfassung deiner App-Nutzung endet sofort und du kannst keine Bons mehr einreichen. Bereits gutgeschriebenes Cashback bleibt erhalten — Auszahlung wie gewohnt ab 10 €.',
                    [
                      { text: 'Abbrechen', style: 'cancel' },
                      {
                        text: 'Deaktivieren',
                        style: 'destructive',
                        onPress: async () => {
                          if (!user?.uid) return;
                          try {
                            const { revokeCashbackConsent } = await import(
                              '@/lib/services/cashbackService'
                            );
                            await revokeCashbackConsent(user.uid);
                          } catch (e: any) {
                            Alert.alert(
                              'Fehler',
                              e?.message ?? 'Bitte erneut versuchen.',
                            );
                          }
                        },
                      },
                    ],
                  );
                } else {
                  // from=settings: Consent-Screen routet nach Accept
                  // zurück hierher statt in den Kamera-Flow.
                  safePush('/cashback/consent?from=settings' as any);
                }
              }}
              last
            />
          </MenuCard>
        </View>

        {/* Version */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 18,
            alignItems: 'center',
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 11,
              color: theme.textMuted,
            }}
          >
            Version {appVersion}
          </Text>
        </View>

        {/* Bottom action — adapts to auth state.
            • Anonymous: "Mit bestehendem Account anmelden" (primary)
            • Registered: "Abmelden" (red) + Account-löschen-Link */}
        <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
          {isAnonymous ? (
            <Pressable
              onPress={() => safePush('/auth/login' as any)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                height: 48,
                borderRadius: 12,
                backgroundColor: theme.surface,
                borderWidth: 1,
                borderColor: theme.border,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <MaterialCommunityIcons
                name="login"
                size={17}
                color={theme.primary}
              />
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 14,
                  color: theme.primary,
                }}
              >
                Mit bestehendem Account anmelden
              </Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={handleLogout}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  height: 48,
                  borderRadius: 12,
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: 'rgba(220,38,38,0.18)',
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <MaterialCommunityIcons
                  name="logout"
                  size={17}
                  color="#dc2626"
                />
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 14,
                    color: '#dc2626',
                  }}
                >
                  Abmelden
                </Text>
              </Pressable>
              <Pressable
                onPress={handleDeleteAccount}
                style={({ pressed }) => ({
                  alignItems: 'center',
                  marginTop: 12,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 12,
                    color: theme.textMuted,
                    textDecorationLine: 'underline',
                  }}
                >
                  Account löschen
                </Text>
              </Pressable>
            </>
          )}
        </View>

        {/* Debug-Section: __DEV__-Build ODER Whitelist-Email
            (siehe showDebugSection oben). */}
        {showDebugSection ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 10,
                color: theme.textMuted,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              Entwickler · Debug
            </Text>
            <MenuCard>
              <MenuRow
                icon="rocket-launch-outline"
                color="#0d8575"
                label="Onboarding direkt öffnen"
                sub="Resettet die Flags + springt sofort rein (kein App-Restart)"
                onPress={onJumpToOnboardingDev}
                first
              />
              <MenuRow
                icon="restore"
                color="#dc2626"
                label="Onboarding zurücksetzen"
                sub="Setzt nur die Flags zurück — beim nächsten App-Start erscheint Onboarding"
                onPress={onResetOnboardingDev}
              />
              <MenuRow
                icon="shield-key-outline"
                color="#0ea5e9"
                label="Consent-Form anzeigen"
                onPress={onConsentForceShow}
              />
              <MenuRow
                icon="shield-refresh-outline"
                color="#8b5cf6"
                label="Consent zurücksetzen"
                onPress={onConsentReset}
              />
              <MenuRow
                icon="shield-check-outline"
                color="#10b981"
                label="Consent-Status anzeigen"
                onPress={onConsentStatus}
              />
              <MenuRow
                icon="star-face"
                color="#f59e0b"
                label="App-Rating-Dialog anzeigen"
                sub="Öffnet das Bewertungs-Modal sofort (zum Testen von Copy/Design)"
                onPress={() => {
                  if (!ratingPromptService.debugShowNow()) {
                    Alert.alert('Rating-Modal', 'Handler nicht registriert (GamificationProvider nicht gemountet?).');
                  }
                }}
              />
              <MenuRow
                icon="receipt"
                color="#0d8575"
                label="Bon-Scan-Seite anzeigen"
                sub="Setzt Cashback-Consent zurück + öffnet die Seite"
                onPress={onShowBonScanConsent}
              />
              <MenuRow
                icon="lock-reset"
                color="#f59e0b"
                label="Kategorie-Freischaltungen löschen"
                onPress={onResetUnlocks}
              />
              <MenuRow
                icon="receipt-text-remove"
                color="#dc2626"
                label="Bons zurücksetzen"
                sub="Löscht alle lokalen Bon-Einträge (cashback_status)"
                onPress={onResetCashbackBons}
              />
              <MenuRow
                icon="bell-ring-outline"
                color="#0d8575"
                label="Toast / Banner Tester"
                sub="Jeden Toast und jedes Achievement / Level-Banner einzeln triggern"
                onPress={() => safePush('/debug/notifications' as any)}
              />
              <MenuRow
                icon="account-question-outline"
                color="#0d8575"
                label="Demografie-Sheet Tester"
                sub="Öffnet das Post-Climax Bottom-Sheet (pure Visual-Vorschau, schreibt nichts)"
                onPress={() => setShowDemographicsTest(true)}
                last
              />
            </MenuCard>

            {/* Coachmark Dev-Panel — Status pro Screen-Tour + Reset
                + Per-Tour-Replay. Bewusst eigene Section damit die
                Trennung zum klassischen Onboarding-Flow auch im UI
                klar ist. */}
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 10,
                color: theme.textMuted,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                marginTop: 18,
                marginBottom: 8,
              }}
            >
              Erklär-Tours · Status
            </Text>
            <MenuCard>
              {ALL_TOUR_KEYS.map((key, idx) => {
                const seenAt = coachmarkStatuses[key];
                const isFirst = idx === 0;
                const isLast = idx === ALL_TOUR_KEYS.length - 1;
                return (
                  <MenuRow
                    key={`status-${key}`}
                    icon={seenAt ? 'check-circle' : 'circle-outline'}
                    color={seenAt ? '#10b981' : '#94a3b8'}
                    label={COACHMARK_LABELS[key]}
                    sub={formatCoachmarkSeen(seenAt)}
                    // Tap auf eine Status-Zeile: Tour direkt zeigen
                    // (Replay) — bequem zum Iterieren am Inhalt.
                    onPress={() => onCoachmarkReplayOne(key)}
                    first={isFirst}
                    last={isLast}
                  />
                );
              })}
            </MenuCard>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 10,
                color: theme.textMuted,
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                marginTop: 18,
                marginBottom: 8,
              }}
            >
              Erklär-Tours · Aktionen
            </Text>
            <MenuCard>
              <MenuRow
                icon="restore-alert"
                color="#dc2626"
                label="Alle Tours zurücksetzen"
                sub="Setzt Home + Belohnungen auf 'noch nicht gesehen'"
                onPress={onCoachmarkResetAll}
                first
                last
              />
            </MenuCard>

            {/* Nuclear Reset — eigener Block ganz unten weil's die
                aggressivste Aktion ist und nicht aus Versehen
                getappt werden soll. Setzt den Account praktisch
                auf null (auf der lokalen Seite), inkl. Auth → der
                User landet als frischer anonymer Test-User. */}
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 10,
                color: '#dc2626',
                letterSpacing: 0.8,
                textTransform: 'uppercase',
                marginTop: 18,
                marginBottom: 8,
              }}
            >
              Test-User · Reset
            </Text>
            <MenuCard>
              <MenuRow
                icon="nuke"
                color="#dc2626"
                label="Komplett-Reset (lokal)"
                sub="Logout + AsyncStorage wipe → frischer Anonymous-User beim Neustart"
                onPress={onFullLocalReset}
                first
                last
              />
            </MenuCard>
          </View>
        ) : null}
      </ScrollView>

      {/* Chrome */}
      <DetailHeader
        title="Profil"
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={editAction}
            hitSlop={6}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <MaterialCommunityIcons
              name="pencil-outline"
              size={18}
              color={theme.textMuted}
            />
          </Pressable>
        }
      />

      {/* Sheets / modals */}
      <FilterSheet
        visible={showSocialSheet}
        title="Folge uns"
        onClose={() => setShowSocialSheet(false)}
      >
        <SocialMediaSheetContent
          onPick={(url) => {
            // Close the sheet first, THEN open the in-app browser.
            // iOS can't present a SFSafariViewController while
            // another Modal (the FilterSheet) is still in its
            // slide-out animation — both block on the same modal
            // stack and the app freezes. Waiting ~320 ms (sheet
            // close duration ≈ 260 ms + a safety buffer) ensures
            // the FilterSheet has fully unmounted before we open
            // the browser.
            setShowSocialSheet(false);
            setTimeout(() => openExternal(url), 320);
          }}
        />
      </FilterSheet>

      <SimilarityStagesModal
        visible={showSimilarityModal}
        onClose={() => setShowSimilarityModal(false)}
      />

      <AuthRequiredModal
        visible={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        feature="Profil bearbeiten"
        message="Erstelle einen Account um dein Profil vollständig zu bearbeiten."
      />

      {/* T11.8: Debug-Trigger für DemographicsPromptSheet — schreibt
          KEIN Firestore-Doc, kein AsyncStorage-Flag. Nur Visual-
          Vorschau für UI-Iteration. */}
      <DemographicsPromptSheet
        visible={showDemographicsTest}
        onSubmit={() => setShowDemographicsTest(false)}
        onSkip={() => setShowDemographicsTest(false)}
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────

function Avatar({
  photoUrl,
  name,
}: {
  photoUrl: string | null;
  name: string;
}) {
  const { theme } = useTokens();
  if (photoUrl) {
    return (
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          overflow: 'hidden',
          borderWidth: 2,
          borderColor: theme.surface,
        }}
      >
        <RNImage
          source={{ uri: photoUrl }}
          style={{ width: '100%', height: '100%' }}
        />
      </View>
    );
  }
  // Fallback: gradient circle with first initial.
  const initial = name?.[0]?.toUpperCase() ?? '🦉';
  return (
    <LinearGradient
      colors={['#0a6f62', '#10a18a']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        width: 72,
        height: 72,
        borderRadius: 36,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 3,
        borderColor: '#fff',
      }}
    >
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 32,
          color: '#fff',
        }}
      >
        {initial}
      </Text>
    </LinearGradient>
  );
}

function LocBadge({
  icon,
  label,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
}) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
      }}
    >
      <MaterialCommunityIcons name={icon} size={11} color={theme.primary} />
      <Text
        numberOfLines={1}
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 10,
          color: theme.primary,
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function MenuCard({ children }: { children: React.ReactNode }) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

function MenuRow({
  icon,
  color,
  label,
  sub,
  onPress,
  first,
  last,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
  label: string;
  sub?: string;
  onPress: () => void;
  first?: boolean;
  last?: boolean;
}) {
  const { theme } = useTokens();
  void last;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          backgroundColor: color + '22',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 14,
            color: theme.text,
          }}
        >
          {label}
        </Text>
        {sub ? (
          <Text
            numberOfLines={1}
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 11,
              color: theme.textMuted,
              marginTop: 1,
            }}
          >
            {sub}
          </Text>
        ) : null}
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={18}
        color={theme.textMuted}
      />
    </Pressable>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onChange,
  first,
  last,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  first?: boolean;
  last?: boolean;
}) {
  const { theme } = useTokens();
  void last;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.border,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          backgroundColor: theme.primary + '22',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons name={icon} size={18} color={theme.primary} />
      </View>
      <Text
        numberOfLines={2}
        style={{
          flex: 1,
          fontFamily,
          fontWeight: fontWeight.bold,
          fontSize: 14,
          color: theme.text,
        }}
      >
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: theme.border, true: theme.primary }}
        thumbColor={Platform.OS === 'android' ? '#fff' : undefined}
      />
    </View>
  );
}

function SectionLabel({
  children,
  theme,
}: {
  children: React.ReactNode;
  theme: ReturnType<typeof useTokens>['theme'];
}) {
  return (
    <Text
      style={{
        paddingHorizontal: 22,
        paddingTop: 18,
        paddingBottom: 8,
        fontFamily,
        fontWeight: fontWeight.bold,
        fontSize: 11,
        color: theme.textMuted,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </Text>
  );
}

// ────────────────────────────────────────────────────────────────────
// Social-media sheet content — replaces the legacy native Alert
// with a real bottom-sheet (consistent with the rest of the app).
// ────────────────────────────────────────────────────────────────────

const SOCIAL_LINKS = [
  {
    key: 'instagram',
    icon: 'instagram' as const,
    color: '#e4405f',
    label: 'Instagram',
    url: 'https://instagram.com/markendetektive',
  },
  {
    key: 'facebook',
    icon: 'facebook' as const,
    color: '#1877f2',
    label: 'Facebook',
    url: 'https://facebook.com/markendetektive',
  },
  {
    key: 'youtube',
    icon: 'youtube' as const,
    color: '#ff0000',
    label: 'YouTube',
    url: 'https://www.youtube.com/@markendetektive',
  },
  {
    key: 'tiktok',
    icon: 'music-note' as const,
    color: '#000',
    label: 'TikTok',
    url: 'https://www.tiktok.com/@markendetektive',
  },
];

function SocialMediaSheetContent({
  onPick,
}: {
  onPick: (url: string) => void;
}) {
  const { theme } = useTokens();
  return (
    <View>
      {useMemo(() => SOCIAL_LINKS, []).map((s, i) => (
        <Pressable
          key={s.key}
          onPress={() => onPick(s.url)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 14,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: theme.border,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              backgroundColor: s.color + '22',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons name={s.icon} size={22} color={s.color} />
          </View>
          <Text
            style={{
              flex: 1,
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 15,
              color: theme.text,
            }}
          >
            {s.label}
          </Text>
          <MaterialCommunityIcons
            name="open-in-new"
            size={16}
            color={theme.textMuted}
          />
        </Pressable>
      ))}
    </View>
  );
}
