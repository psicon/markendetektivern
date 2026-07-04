import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { markAppContentReady } from '@/lib/utils/appReady';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { safePush } from '@/lib/utils/safeNav';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  InteractionManager,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BannerAd } from '@/components/ads/BannerAd';
import { HomeWalkthrough } from '@/components/coachmarks/HomeWalkthrough';
import {
  DemographicsPromptSheet,
  type DemographicsResult,
} from '@/components/onboarding/DemographicsPromptSheet';
import { DetectiveMark } from '@/components/design/DetectiveMark';
import {
  MorphingHeader,
  MORPHING_HEADER_ROW_HEIGHT,
} from '@/components/design/MorphingHeader';
import { ProductCard } from '@/components/design/ProductCard';
import { StufenChips } from '@/components/design/StufenChips';
import { QuickAccessCard } from '@/components/design/QuickAccessCard';
import { Shimmer } from '@/components/design/Skeletons';
import { SearchBottomSheet } from '@/components/ui/SearchBottomSheet';
import { Colors } from '@/constants/Colors';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import {
  LEVEL_GRADIENT_END,
  LEVEL_GRADIENT_START,
  levelGradient,
  mdiForLevelIcon,
} from '@/lib/utils/levelIcon';
import { useCoachmark } from '@/hooks/useCoachmark';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useGamificationEnabled } from '@/hooks/useGamificationEnabled';
import { useTokens } from '@/hooks/useTokens';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useRevenueCat } from '@/lib/contexts/RevenueCatProvider';
import { useCashbackUserState } from '@/lib/hooks/useCashbackUserState';
import { startReceiptScanFlow } from '@/lib/services/cashbackScanStart';
import { startProductSubmitFlow } from '@/lib/services/productSubmitStart';
import { isAnySheetOpen, whenSheetsIdle } from '@/lib/services/sheetPresence';
import { useShoppingCartCount } from '@/lib/hooks/useShoppingCartCount';
import { useFavoritesCount } from '@/lib/hooks/useFavoritesCount';
import { useSurvey } from '@/components/survey/SurveyProvider';
import { getGeneralSurveys } from '@/lib/services/surveyService';
import { achievementService } from '@/lib/services/achievementService';
import { AlgoliaService } from '@/lib/services/algolia';
import { FirestoreService } from '@/lib/services/firestore';
import { useNetworkStatus } from '@/lib/services/network';
import searchHistoryService from '@/lib/services/searchHistoryService';
import WordPressService, { WordPressPost } from '@/lib/services/wordpress';
import { Level } from '@/lib/types/achievements';
import { FirestoreDocument, Handelsmarken, Produkte } from '@/lib/types/firestore';
import { getProductImage } from '@/lib/utils/productImage';

type DiscounterInfo = { color: string; short: string; bild?: string };

export default function HomeScreen() {
  // Splash-Overlay erst ausblenden, wenn dieser Screen gerendert ist
  // (verhindert die schwarz/weisse Boot-Lücke auf Android, s. lib/utils/appReady).
  useEffect(() => {
    markAppContentReady();
  }, []);
  const { top: insetTop } = useSafeAreaInsets();
  const { theme, shadows, brand } = useTokens();
  const colorScheme = useColorScheme();
  const legacyColors = Colors[colorScheme ?? 'light'];
  // iOS-Status-Bar-Tap-Fix: nur der aktuell-fokussierte Tab darf
  // scrollsToTop=true tragen, sonst hat iOS >1 aktive UIScrollViews
  // (alle 3 Tabs bleiben gemountet) und blockt den Tap komplett.
  const isFocused = useIsFocused();

  const { user, userProfile, refreshUserProfile } = useAuth();
  const { isPremium, showAds, refreshPremiumStatus } = useRevenueCat();
  const analytics = useAnalytics();
  const cashback = useCashbackUserState();
  // Live cart-count für das Einkaufsliste-Schnellzugriff-Card-Badge.
  // Shared mit FloatingShoppingListButton — gleicher Listener-Wert.
  const { count: cartCount } = useShoppingCartCount();
  // Live favorites-count → Badge auf der Favoriten-Card. Leichtgewichtiger
  // snap.size-Listener (KEIN Produktdaten-Load) → Home-Performance bleibt.
  const { count: favoritesCount } = useFavoritesCount();

  // Anzahl verfügbarer allgemeiner Umfragen → Badge auf der Umfragen-
  // Schnellzugriff-Card. activityNonce triggert ein Reload nach jeder
  // Beantwortung/Schließen; isFocused beim Zurückkehren. PERFORMANCE: der
  // (gecachte) Poll-Fetch wird via InteractionManager hinter den First-
  // Paint/Animationen deferred, damit das Badge die Home-Render-Phase nicht
  // belastet.
  const { activityNonce } = useSurvey();
  const [surveyCount, setSurveyCount] = useState(0);
  useEffect(() => {
    if (!user?.uid || !isFocused) return;
    let alive = true;
    const handle = InteractionManager.runAfterInteractions(() => {
      if (!alive) return;
      getGeneralSurveys(user.uid)
        .then((s) => alive && setSurveyCount(s.length))
        .catch(() => alive && setSurveyCount(0));
    });
    return () => {
      alive = false;
      handle.cancel?.();
    };
  }, [user?.uid, isFocused, activityNonce]);

  // Tap target for "Kassenbon scannen" — campaign-aware scan start
  // (shared with "Meine Bons"). Bug 86ca24dk4.
  const onScanBon = useCallback(
    () => startReceiptScanFlow(cashback.uid, cashback.hasConsent),
    [cashback.uid, cashback.hasConsent],
  );

  // Tap target "Produkte einreichen" — consent-gated, wenn gerade eine
  // product_photos-Aktion mit Reward läuft (86cagb5gh; Gate im Service,
  // geteilt mit dem Rewards-Tab).
  const onProductSubmit = useCallback(
    () => void startProductSubmitFlow(cashback.hasConsent),
    [cashback.hasConsent],
  );

  // Coachmark — per-Screen-Erklär-Overlay, fires nur beim ersten
  // Mount eines Users (siehe useCoachmark für die Hard-Block-Logik
  // gegen das laufende Onboarding und die Replay-Bridge fürs Profil).
  // Die Tour rendert IHRE EIGENE Demo-Karte (DemoProductSpotlight
  // im Modal) statt ein Element auf dem Home-Screen zu spotlighten —
  // Layout-Shifts durch Ads etc. sind damit irrelevant.
  const homeCoachmark = useCoachmark('home');

  // T15.1: Global-State ob IRGENDEIN Walkthrough in der App gerade
  // aktiv ist. Wird vom CoachmarkService gepflegt — jeder
  // Walkthrough-Component setActive(true/false) beim Mount/Unmount.
  // Verwendet als zusätzliches Gate für das Demografie-Sheet damit
  // es nicht parallel zu z.B. dem product-detail-Walkthrough öffnet
  // wenn der Home-Walkthrough den User dorthin geführt hat.
  const [anyWalkthroughActive, setAnyWalkthroughActive] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    (async () => {
      const { CoachmarkService } = await import('@/lib/services/coachmarkService');
      if (cancelled) return;
      unsubscribe = CoachmarkService.onActivityChange((any) => {
        setAnyWalkthroughActive(any);
      });
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // C2 (Stufe 1): Werbebanner in der ERSTEN Session unterdrücken — kein Ad,
  // bevor der User einmal Wert gesehen hat (schützt den ersten Eindruck +
  // Store-Bewertungen). Ab dem 2. App-Start sichtbar. Bei Storage-Fehler
  // wird das Banner gezeigt (Monetarisierung nicht dauerhaft blockieren).
  const [bannerAllowed, setBannerAllowed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getAppStartCount } = await import('@/lib/services/demographicsPromptSignals');
        const count = await getAppStartCount();
        if (!cancelled) setBannerAllowed(count > 1);
      } catch {
        if (!cancelled) setBannerAllowed(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Spielerische Inhalte-Toggle — wenn aus, blenden wir die Level-
  // Card aus. Cashback / Sparpotenzial / Neue Funde bleiben
  // sichtbar (echter App-Inhalt, nicht Spielelement).
  const gamificationEnabled = useGamificationEnabled();

  // Scroll-driven header
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  // Search — `searchSheetTop` is the absolute Y coordinate where
  // the SearchBottomSheet's top edge should land. Captured at the
  // moment the user taps so it reflects the CURRENT scroll state:
  //
  //   • Top of scroll: sheet sits below the fat below-header
  //     search bar.
  //   • Scrolled past 30 px: fat search bar is hidden; sheet sits
  //     below the header chrome (compact pill is INSIDE the chrome
  //     at the right edge).
  //
  // Without this, the sheet always opens at the "top of scroll"
  // anchor, which leaves a big chrome-shaped gap above it when
  // the user opened it while scrolled.
  const [showSearchSheet, setShowSearchSheet] = useState(false);
  const [searchSheetTop, setSearchSheetTop] = useState<number | null>(null);

  const openSearchSheet = useCallback(() => {
    // Pass the visible search bar's TOP Y to the sheet. The sheet
    // positions itself so its INTERNAL input lands at exactly
    // that Y — looks like the page's search bar morphed in place
    // into the sheet's bar. Switches based on current scroll:
    //
    //   • Top of scroll: fat search bar visible at
    //     `insetTop + chrome (56) + paddingTop (12)` = the bar's
    //     TOP edge. Sheet's input lands there.
    //   • Scrolled past 30 px (fat bar gone, compact pill visible
    //     inside the chrome): pill top is at `insetTop + 8`
    //     (chrome row paddingVertical 4 + morphSlot center offset
    //     4). Sheet's input lands there — the pill is "ganz hoch".
    const fatBarVisible = scrollY.value < 30;
    const inputTop = fatBarVisible
      ? insetTop + MORPHING_HEADER_ROW_HEIGHT + 12
      : insetTop + 8;
    setSearchSheetTop(inputTop);
    setShowSearchSheet(true);
  }, [insetTop, scrollY]);

  // ─── Demographics-Bottom-Sheet (T3) ──────────────────────────
  // Trigger: gesetzt vom Onboarding-Climax (Auth- ODER Guest-Path).
  // Wird hier einmalig konsumiert, dann Flag entfernt. Caller-
  // Handler weiter unten schreibt users/{uid}.age / .gender etc.
  const [showDemographicsSheet, setShowDemographicsSheet] = useState(false);

  // Products
  const [enttarnteProdukte, setEnttarnteProdukte] = useState<FirestoreDocument<Produkte>[]>([]);
  const [discounterMap, setDiscounterMap] = useState<Record<string, DiscounterInfo>>({});
  const [handelsmarken, setHandelsmarken] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sequenz-Gates für gestaffeltes Laden:
  //   1) Page-Render (chrome) — sofort
  //   2) Produkte ("Für dich enttarnt") — beim ersten Frame-deferred Trigger
  //   3) News — sobald Produkte fertig
  //   4) Top-Produkte (overall + monthly) — sobald News fertig
  // Damit füllt sich die Page von oben nach unten in der gleichen
  // Reihenfolge in der der User scrollt — "Für dich enttarnt"
  // immer zuerst, weil das die wichtigste Discovery-Section ist.
  const [productsStageDone, setProductsStageDone] = useState(false);
  const [newsStageDone, setNewsStageDone] = useState(false);
  // Reconnect-Reload (ClickUp 86ca8c9n6): wurde Home OHNE Empfang
  // gemountet, blieben alle Sections leer — und luden nach dem Netz-
  // Comeback nie nach. Der Nonce re-triggert die Stage-1-Pipeline
  // (Stage 2/3 haengen an den StageDone-Flanken und laufen mit).
  const [netRetryNonce, setNetRetryNonce] = useState(0);
  const netStatus = useNetworkStatus();
  const prevNetOnlineRef = React.useRef(netStatus.online);
  useEffect(() => {
    const wasOnline = prevNetOnlineRef.current;
    prevNetOnlineRef.current = netStatus.online;
    if (wasOnline || !netStatus.online) return; // nur offline→online
    if (enttarnteProdukte.length > 0 && !error) return; // Daten sind da
    setError(null);
    setLoading(true);
    setProductsStageDone(false);
    setNewsStageDone(false);
    setNetRetryNonce((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netStatus.online]);

  // Gamification
  const [levels, setLevels] = useState<Level[]>([]);
  const [levelsLoading, setLevelsLoading] = useState(true);

  // News
  const [newsPosts, setNewsPosts] = useState<WordPressPost[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);

  // Top-rated Produkte: zwei separate Listen — "Overall" (alle
  // Bewertungen) und "Letzter Monat" (nur Bewertungen aus den
  // letzten 30 Tagen). Beide laufen in eigenen useEffects und
  // haben eigene Loading-States, sodass eine fehlschlagende
  // Aggregation die andere nicht blockiert. `TopRatedItem` ist
  // unten am Modul-Ende definiert (geteilt mit der TopRatedCard +
  // TopRatedSection).
  const [topRatedMonth, setTopRatedMonth] = useState<TopRatedItem[]>([]);
  const [topRatedMonthLoading, setTopRatedMonthLoading] = useState(true);
  // "Meist aufgerufen" — eindeutige Journey-Sessions die das Produkt
  // angesehen haben (Fenster: 1 Woche, siehe top-products-aggregator).
  // Trending-Signal unabhängig von Bewertungen.
  const [mostViewed, setMostViewed] = useState<TopRatedItem[]>([]);
  const [mostViewedLoading, setMostViewedLoading] = useState(true);

  // ─── UMP consent SAFETY-NET (Android only) ──────────────────────────────────
  // Primary-Pfad ist seit ClickUp 86c9qd5qu in app/index.tsx (vor
  // dem Routing). Dieser useFocusEffect bleibt als reines Safety-Net
  // für den seltenen Fall dass Consent während Session expired
  // (Status wird auf REQUIRED zurückgesetzt nach Google-SDK-Reglen)
  // → bei nächstem Home-Focus nochmal anbieten. Schluckt alle
  // Fehler still, damit der User nie hier hängen bleibt.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'ios') return;
      let cancelled = false;
      (async () => {
        try {
          await new Promise(r => setTimeout(r, 1500));
          if (cancelled) return;
          const { consentService } = await import('@/lib/services/consentService');
          if (await consentService.hasConsent()) return;
          const status = await consentService.initialize();
          if (cancelled) return;
          if (status === 'REQUIRED') await consentService.showConsentFormIfRequired();
        } catch {}
      })();
      return () => { cancelled = true; };
    }, [])
  );

  // ─── Pending onboarding paywall ───────────────────────────────────────────
  // C1 (Stufe 1): Die Paywall darf sich NIE über die Erklär-Tour oder ein
  // offenes Sheet legen — zwei gleichzeitige RN-<Modal>s frieren iOS ein
  // (dokumentiertes Doppel-Modal-Risiko). Solange die Tour läuft, startet der
  // Effect gar nicht erst; er re-runt automatisch, sobald sie zu ist (Deps
  // homeCoachmark.visible / anyWalkthroughActive). Direkt vor dem Präsentieren
  // wird zusätzlich auf "kein Sheet offen" gewartet (whenSheetsIdle).
  useEffect(() => {
    if (homeCoachmark.visible || anyWalkthroughActive) return;
    let cancelled = false;
    (async () => {
      try {
        const flag = await AsyncStorage.getItem('pending_onboarding_paywall');
        if (flag !== '1') return;
        await AsyncStorage.removeItem('pending_onboarding_paywall');
        // Premium-Boot-Fix 2026-07: den FRISCHEN Rückgabewert nutzen — das
        // gecapturte `isPremium` aus dem Render-Scope war eine Stale-Closure
        // (refreshPremiumStatus updatete zwar den Provider-State, die lokale
        // Variable blieb false → Paywall poppte für Premium-User auf).
        // Nur bei BESTÄTIGTEM "kein Premium" (false) zeigen — null (Status
        // unbekannt) zeigt keine Paywall (fail-closed).
        const premiumNow = await refreshPremiumStatus();
        if (premiumNow !== false) return;
        const { remoteConfigService } = await import('@/lib/services/remoteConfigService');
        if (!(await remoteConfigService.shouldShowOnboardingPaywall())) return;
        try {
          const { revenueCatService } = await import('@/lib/services/revenueCatService');
          let tries = 0;
          while (!revenueCatService.isInitialized && tries < 25) {
            await new Promise(r => setTimeout(r, 200));
            tries++;
          }
        } catch {}
        // NOTE: InteractionManager is imported statically at the top
        // of this file. Dynamic `await import('react-native')`
        // triggers metro's `metroImportAll`, which enumerates all
        // RN exports and fires the lazy `PushNotificationIOS`
        // getter — that module's top-level code calls
        // `new NativeEventEmitter()` against a missing native
        // module and crashes. Static import side-steps it.
        await new Promise<void>(r => InteractionManager.runAfterInteractions(() => r()));
        if (cancelled) return;
        // C1: warten bis KEIN Sheet (z.B. Demografie) mehr präsentiert ist,
        // bevor die Paywall (selbst ein Modal) aufgeht.
        await new Promise<void>((resolve) => {
          if (!isAnySheetOpen()) { resolve(); return; }
          whenSheetsIdle(() => resolve());
        });
        if (cancelled) return;
        try {
          const Haptics = await import('expo-haptics');
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          const { revenueCatService } = await import('@/lib/services/revenueCatService');
          await revenueCatService.presentPaywall('onboarding');
        } catch {}
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [isPremium, homeCoachmark.visible, anyWalkthroughActive]);

  // ─── Demografie-Sheet (T17.15) ────────────────────────────────────────────
  // Einfache, robuste Logik — basiert auf User-Doc-State, NICHT auf
  // transienten AsyncStorage-Flags. Damit funktioniert das Sheet:
  //   • bei Erst-Install nach Onboarding-Climax
  //   • bei App-Updates (User die Sheet nie gesehen haben kriegen's
  //     einmalig)
  //   • bei Onboarding-Skip + späterer Auth (User-Doc füllt sich)
  // Bedingungen ALLE müssen wahr sein:
  //   1. User-Auth ready
  //   2. User aktuell auf Home (isFocused)
  //   3. Kein Walkthrough aktiv (anyWalkthroughActive=false)
  //   4. Home-Walkthrough nicht mehr visible
  //   5. Onboarding wurde durchlaufen (Climax oder Skip — beide OK)
  //   6. Home-Walkthrough wurde gesehen (auto-shown completed ODER
  //      explizit geskipped — beide setzen markSeen)
  //   7. User-Doc hat WEDER age NOCH gender (= unbeantwortet)
  //   8. User-Doc hat NICHT `demographicsSkipped: true` (User hat
  //      sich aktiv gegen das Sheet entschieden — nicht nochmal nerven)
  useEffect(() => {
    // Dev-Diagnose (2026-06-11): das Sheet brach still ab — jeder
    // Early-Return loggt im DEV-Build seinen Grund.
    const why = (reason: string) => {
      if (__DEV__) console.log(`[DemographicsSheet] skip: ${reason}`);
    };
    if (!user?.uid) { why('kein user'); return; }
    if (!isFocused) { why('home nicht fokussiert'); return; }
    if (anyWalkthroughActive) { why('walkthrough aktiv'); return; }
    if (homeCoachmark.visible) { why('home-coachmark sichtbar'); return; }
    let cancelled = false;
    (async () => {
      try {
        const { OnboardingService } = await import('@/lib/services/onboardingService');
        if (!(await OnboardingService.hasPassedOnboarding())) { why('onboarding nicht durchlaufen'); return; }

        const { CoachmarkService } = await import('@/lib/services/coachmarkService');
        if (!(await CoachmarkService.getSeen('home'))) { why("getSeen('home')=false — walkthrough nie gesehen/markiert"); return; }

        // Aufschub nach Walkthrough-SKIP (User-Spec 2026-06-11): nach
        // KOMPLETT durchlaufener Tour darf das Sheet sofort kommen
        // (der Tour-Abschluss ist ohnehin der Tap auf das Demo-Produkt
        // = erster Produktbesuch). Nach SKIP erst beim 2. App-Start
        // ODER nach dem ersten Produktbesuch + Rückkehr zum Home (der
        // isFocused-Re-Run dieses Effects). Altdaten ohne Modus-Key
        // gelten als 'completed' (Verhalten wie bisher).
        const seenMode = await CoachmarkService.getSeenMode('home');
        if (seenMode === 'skipped') {
          const signals = await import('@/lib/services/demographicsPromptSignals');
          const [startCount, productVisited] = await Promise.all([
            signals.getAppStartCount(),
            signals.wasProductVisited(),
          ]);
          if (startCount < 2 && !productVisited) {
            why(`walkthrough geskippt — Aufschub aktiv (starts=${startCount}, produktBesucht=false)`);
            return;
          }
        }

        const { getDoc, doc } = await import('@react-native-firebase/firestore');
        const { db } = await import('@/lib/firebase');
        const snap = await getDoc(doc(db, 'users', user.uid));
        const data = snap.exists ? snap.data() : null;

        // ClickUp 86cad6cy5 (6.19/6.20): per-UID-Marker prüfen. Nach Abmelden
        // bzw. Account-Löschen entsteht eine FRISCHE Anon-UID OHNE
        // `onboardingCompletedAt` → das Sheet darf dann NICHT erneut kommen.
        // (Das device-lokale `hasPassedOnboarding()` oben übersteht den Logout
        // und würde sonst fälschlich durchlassen; `onboardingCompletedAt` wird
        // im Onboarding-Climax UND -Skip ans User-Doc geschrieben, also nur für
        // Identitäten gesetzt, die den Flow tatsächlich durchlaufen haben.)
        if (data?.onboardingCompletedAt == null) { why('onboardingCompletedAt fehlt (frische UID nach Logout/Delete)'); return; }

        // Daten bereits vorhanden? Nicht nochmal fragen.
        if (data?.age != null) { why('age schon im User-Doc'); return; }
        if (typeof data?.gender === 'string' && data.gender.length > 0) { why('gender schon im User-Doc'); return; }
        // User hat bewusst geskipped? Nicht nochmal nerven.
        if (data?.demographicsSkipped === true) { why('demographicsSkipped=true'); return; }
        if (__DEV__) console.log('[DemographicsSheet] alle Bedingungen erfüllt → Sheet öffnet');

        // Kurz warten bis Home-Mount ruhig ist (sonst öffnet das Sheet
        // mitten in den ProductCard-Initial-Animationen).
        await new Promise<void>(r => InteractionManager.runAfterInteractions(() => r()));
        if (cancelled) return;
        setShowDemographicsSheet(true);
      } catch (err) {
        console.warn('[Home] demographics prompt check failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid, homeCoachmark.visible, isFocused, anyWalkthroughActive]);

  const handleDemographicsSubmit = useCallback((result: DemographicsResult) => {
    // R7 (ClickUp 86cacp9pc): Sheet SOFORT schließen; den Firestore-Write
    // fire-and-forget (lokaler Cache updatet sofort, kein UI-Block, offline
    // kein Hänger) und refreshUserProfile ERST NACH den Animationen. Vorher
    // löste das awaitete refreshUserProfile sein setUserProfile ~200–500ms
    // später aus — MITTEN in der Sheet-Dismiss-Animation — und re-renderte den
    // MorphingHeader-BlurView des Home-Screens → genau das gemeldete Flimmern.
    setShowDemographicsSheet(false);
    if (!user?.uid) return;
    const uid = user.uid;
    const now = new Date();
    void (async () => {
      try {
        const { setDoc, doc, serverTimestamp } = await import('@react-native-firebase/firestore');
        const { db } = await import('@/lib/firebase');
        // T11.18: eigenständige age-Capture-Timestamp + ageReportedYear, damit
        // wir das Alter über die Zeit hochrechnen können (heute 32 → in 4 Jahren ≈ 36).
        void setDoc(
          doc(db, 'users', uid),
          {
            age: result.age,
            ageBucket: result.ageBucket,
            ageReportedAt: serverTimestamp(),
            ageReportedYear: now.getFullYear(),
            gender: result.gender,
            demographicsCapturedAt: serverTimestamp(),
          },
          { merge: true },
        ).catch((err) => console.warn('[Home] demographics save failed:', err));
        await AsyncStorage.removeItem('pending_demographics_prompt');
      } catch (err) {
        console.warn('[Home] demographics save failed:', err);
      }
    })();
    // T17.15: AuthContext-userProfile refreshen (sonst sieht email-register die
    // frischen age/gender-Werte nicht) — aber hinter den Animationen (s.o.).
    // Liest den lokal bereits geupdateten Cache, braucht den Server-Ack nicht.
    InteractionManager.runAfterInteractions(() => {
      refreshUserProfile().catch(() => {});
    });
  }, [user?.uid, refreshUserProfile]);

  const handleDemographicsSkip = useCallback(() => {
    // R7 (86cacp9pc): analog Submit — Sheet sofort schließen, Write
    // fire-and-forget, refreshUserProfile hinter die Animation (kein Flimmern).
    setShowDemographicsSheet(false);
    const uid = user?.uid;
    void (async () => {
      try {
        await AsyncStorage.removeItem('pending_demographics_prompt');
        if (!uid) return;
        const { setDoc, doc, serverTimestamp } = await import('@react-native-firebase/firestore');
        const { db } = await import('@/lib/firebase');
        void setDoc(
          doc(db, 'users', uid),
          {
            demographicsSkipped: true,
            demographicsSkippedAt: serverTimestamp(),
          },
          { merge: true },
        ).catch((err) => console.warn('[Home] demographics skip-mark failed:', err));
      } catch (err) {
        console.warn('[Home] demographics skip-mark failed:', err);
      }
    })();
    if (user?.uid) {
      InteractionManager.runAfterInteractions(() => {
        refreshUserProfile().catch(() => {});
      });
    }
  }, [user?.uid, refreshUserProfile]);

  // ─── Load levels ────────────────────────────────────────────────────────────
  // Deferred via InteractionManager — die Level-Card auf Home rendert
  // ihren Skeleton bis die Daten da sind. Vorher feuerte das beim
  // Mount und konkurrierte mit Stöbern/Rewards um Firestore-Reads.
  useEffect(() => {
    if (!user) { setLevelsLoading(false); return; }
    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      achievementService.getAllLevels()
        .then((ls) => {
          if (!cancelled) setLevels(ls);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLevelsLoading(false);
        });
    });
    return () => {
      cancelled = true;
      handle.cancel?.();
    };
  }, [user]);

  // ─── Load products (split from joins for fast first paint) ─────────────────
  //
  // Three parallel/staged fetches, ZERO additional Firestore reads
  // vs. the previous flow — we just stop blocking on the joins:
  //
  //   1. Products query (50 docs, ≈ 300-500 ms cold) → as soon as
  //      this lands we `setEnttarnteProdukte` + `setLoading(false)`,
  //      so the carousel renders with the live image / name / price /
  //      stufe. The eyebrow row shows shimmer placeholders meanwhile.
  //   2. Discounter map (≈ 30 docs, cached 30 min, near-instant on
  //      revisit). Fires in parallel with #1, lands independently.
  //      When it lands, every product card's discounter logo
  //      replaces its shimmer.
  //   3. Per-product Handelsmarke joins (cached 30 min per ref).
  //      Fires the moment products land. Each card's brand text
  //      replaces its shimmer when its specific ref resolves.
  //
  // The user sees the carousel with images + prices ~half a second
  // earlier than before; discounter/Handelsmarke logos pop in
  // (smoothly, via the eyebrow shimmer crossfade) shortly after.
  useEffect(() => {
    import('@/lib/services/remoteConfigService').then(m =>
      m.remoteConfigService.initialize().catch(() => {})
    );
    // Stufe-Copy aus Remote Config bei App-Boot vorwärmen — damit
    // die Comparison-Page beim ersten Aufruf bereits die RC-Werte
    // im Cache hat und nicht erst Fallback → RC switchen muss.
    import('@/lib/utils/stufeCopy').then(m => m.loadStufeCopy().catch(() => {}));

    let cancelled = false;

    // Stage 1 — "Für dich enttarnt"-Produkte + Discounter.
    // Deferred via InteractionManager → erst nach dem Page-Render-
    // Settle. Beide Inner-Fetches laufen parallel; der STAGE gilt
    // als done sobald beide fertig sind (ob success oder fail —
    // die nachfolgenden Stages sollen auch starten wenn diese
    // Stage nichts zurückbringt).
    const handle = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;

      const productsPromise = (async () => {
        try {
          // W1 — Pool von 200 auf 90 reduziert. Mit 90 randomized
          // pickt Home's Top-Enttarnte aus einem ausreichend großen
          // Pool für sichtbare Variety, ohne 200 Doc-Reads bei
          // jedem Home-Mount (auf Web SDK Android 2-3 s Roundtrip).
          // 2.2 (Stufe 2): "Für dich enttarnt" nach Lieblingsmärkten bevorzugen.
          // `favoriteMarket` (singular) = Discounter-Doc-ID (zuverlässig);
          // `favoriteMarkets` ist shape-inkonsistent → nur Objekt-IDs mitnehmen.
          // Soft-Prefer im Service (nie leer); wenn userProfile noch nicht
          // hydratiert ist, bleibt der Feed einfach ungefiltert (kein Bruch).
          const favIds: string[] = [];
          const fm = (userProfile as any)?.favoriteMarket;
          if (typeof fm === 'string' && fm) favIds.push(fm);
          const fms = (userProfile as any)?.favoriteMarkets;
          if (Array.isArray(fms)) {
            for (const m of fms) {
              const id = typeof m === 'string' ? null : (m?.id ?? m?.docRef?.id);
              if (typeof id === 'string' && id) favIds.push(id);
            }
          }
          const produkteData = await FirestoreService.getTopEnttarnteProdukteRandomized(
            90,
            10,
            favIds.length ? Array.from(new Set(favIds)) : undefined,
          );
          if (cancelled) return;
          setEnttarnteProdukte(produkteData);

          // W2 — Pre-Batch der handelsmarke-Refs: statt N individuelle
          // getDoc-Calls (auf Web SDK Android jeweils ~250 ms) nutzen
          // wir `getDocumentsBatch` mit `where(documentId(), 'in', ...)`.
          // 10 Refs werden in 1-2 Roundtrips gebatcht statt 10 separaten.
          // Eyebrow-Logos füllen sich weiterhin nach (Stage-Done ist
          // nicht geblockt) — nur eben deutlich schneller.
          (async () => {
            const refIds = new Set<string>();
            const productToRefId = new Map<string, string>();
            for (const p of produkteData) {
              if (!p.handelsmarke) continue;
              const path = (p.handelsmarke as any).referencePath ?? p.handelsmarke.path;
              if (!path) continue;
              const [coll, id] = String(path).split('/');
              if (coll === 'handelsmarken' && id) {
                refIds.add(id);
                productToRefId.set(p.id, id);
              }
            }
            if (refIds.size === 0) return;
            try {
              const resolved = await FirestoreService.getDocumentsBatch<Handelsmarken>(
                'handelsmarken',
                Array.from(refIds),
              );
              if (cancelled) return;
              const hMap: Record<string, string> = {};
              for (const [productId, refId] of productToRefId) {
                const hm = resolved[refId];
                if (hm && (hm as any).bezeichnung) {
                  hMap[productId] = (hm as any).bezeichnung;
                }
              }
              setHandelsmarken(hMap);
            } catch {
              // swallow
            }
          })();
        } catch {
          if (!cancelled) setError('Fehler beim Laden der Daten');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      const discounterPromise = (async () => {
        try {
          const discounters = await FirestoreService.getDiscounter();
          if (cancelled) return;
          const dMap: Record<string, DiscounterInfo> = {};
          discounters.forEach(d => {
            const n = d.name ?? '';
            dMap[d.id] = {
              color: d.color ?? '#888888',
              short: n.length <= 2 ? n : n[0].toUpperCase(),
              bild: (d as any).bild,
            };
          });
          setDiscounterMap(dMap);
        } catch {
          // Non-fatal: cards just keep their logo shimmer indefinitely
          // if the discounter list can't load. The product itself is
          // still useful.
        }
      })();

      // Sobald BEIDE inneren Fetches resolved sind, geht's mit
      // Stage 2 (News) los. `allSettled` damit ein Fehler den
      // Sequenz-Gate nicht blockiert.
      Promise.allSettled([productsPromise, discounterPromise]).then(() => {
        if (!cancelled) setProductsStageDone(true);

        // W4 — Stöbern Prewarm: nachdem Home's eigene Reads fertig
        // sind, im Hintergrund die ersten Stöbern-Queries laden.
        // Cache-Schicht in `stoebernCache.ts` merkt sich die
        // Resultate; wenn der User später auf Stöbern tippt rendert
        // die Page instant aus dem Cache statt 13 s zu warten.
        // 2 s Delay damit der UI-Thread nach Home-Render kurz Luft
        // hat. Idempotent (prewarmStoebern() macht nix wenn schon
        // gecached oder in-flight).
        setTimeout(() => {
          if (cancelled) return;
          import('@/lib/services/stoebernCache')
            .then(({ prewarmStoebern }) => prewarmStoebern())
            .catch(() => {});
        }, 2000);
      });
    });

    return () => {
      cancelled = true;
      handle.cancel?.();
    };
    // netRetryNonce: Reconnect-Reload (siehe oben) — laesst die ganze
    // Stage-Pipeline nach einem Offline-Mount erneut durchlaufen.
  }, [netRetryNonce]);

  // ─── Load news (Stage 2) ────────────────────────────────────────────
  // Lädt erst nachdem die Produkt-Stage durch ist — das ist die
  // wichtigere Section und soll nicht von News-Reads ausgebremst
  // werden. WordPressService hat eigenes 5-Min Cache + 25s Hard-
  // Timeout, fail-soft → bei Hang oder Empty schlägt der News-
  // Block in seinen Empty-State um, der Rest der Page läuft weiter.
  useEffect(() => {
    if (!productsStageDone) return;
    let cancelled = false;
    (async () => {
      try {
        const svc = new WordPressService();
        const { posts } = await svc.getLatestPosts(5);
        if (!cancelled) setNewsPosts(posts);
      } catch {
        // Fehler/Timeout — News-Section zeigt Empty-State.
      } finally {
        if (!cancelled) {
          setNewsLoading(false);
          setNewsStageDone(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productsStageDone]);

  // ─── Load Top-Products (Stage 3) ──────────────────────────────────
  // Liest EIN Aggregat-Doc (`aggregates/topProducts_v1`) das die drei
  // Home-Top-Listen pre-computed enthält:
  //   • overall (Bewertungen, all-time)
  //   • monthly (Bewertungen, letzte 30 Tage)
  //   • mostViewed (Journey-Sessions, letzte 30 Tage)
  // Cloud-Function `top-products-aggregator` befüllt das wöchentlich.
  // Statt vorher 3× clientseitige Aggregation (~5.000-50.000+ Reads)
  // ist es jetzt 1 Doc-Read (~1 Read). Bei 100k MAU: ~6.000 €/Mo
  // gespart.
  useEffect(() => {
    if (!newsStageDone) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await FirestoreService.getTopProducts();
        if (cancelled) return;
        setTopRatedMonth((data.monthly as any) ?? []);
        setMostViewed((data.mostViewed as any) ?? []);
      } catch {
        /* Empty-States, keine Crashes */
      } finally {
        if (!cancelled) {
          setTopRatedMonthLoading(false);
          setMostViewedLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [newsStageDone]);

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const handleSearch = (term: string) => {
    const t = term.trim();
    if (!t || t.length < 3) return;

    // History-Save fire-and-forget — kein await, damit der
    // router.push synchron im selben Frame wie der Sheet-Close
    // feuert. Search-History ist ein "nice to have", darf nie
    // den Such-Flow blockieren.
    if (user?.uid) {
      void searchHistoryService.saveSearchTerm(user.uid, t);
    }

    // Pre-Fetch: Algolia-Call fire-and-forget BEVOR die Navigation
    // läuft. Die Promise sitzt im inflight-Cache der AlgoliaService.
    // Bis Stöbern mountet (~200-300 ms später) ist der Roundtrip
    // schon halb durch. Stöbern's runSearch hängt sich an dieselbe
    // Promise statt einen zweiten HTTP-Request zu schicken — sieht
    // für den User aus als wäre die Suche "schon da" wenn er
    // ankommt, statt "Skeleton → Spinner → Pop".
    void AlgoliaService.searchAll(t, 0, 40);

    // Search is now in-place inside Stöbern (see explore.tsx). The
    // `query` param triggers an auto-submit + lands on the Alle
    // tab with merged Eigenmarken + Marken hits.
    safePush(
      `/(tabs)/explore?query=${encodeURIComponent(t)}&tab=alle` as any,
    );
  };

  const handleProductPress = (product: FirestoreDocument<Produkte>, index: number) => {
    analytics.trackProductViewWithJourney(
      product.id,
      'noname',
      product.name ?? 'NoName Produkt',
      index
    );
    const stufe = parseInt(product.stufe) || 1;
    // Pre-warm cache before navigation so the destination screen
    // typically renders with data on its first paint.
    if (stufe <= 2) {
      FirestoreService.prefetchProductDetails(product.id);
      safePush(`/noname-detail/${product.id}` as any);
    } else {
      FirestoreService.prefetchComparisonData(product.id, false);
      safePush(`/product-comparison/${product.id}?type=noname` as any);
    }
  };

  const openNewsArticle = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
        controlsColor: theme.primary,
      });
    } catch {}
  };

  // Tap auf eine Top-Rated-Card. Navigation ist je nach Produkt-Typ
  // (NoName/Marken) und — bei NoNames — zusätzlich nach Stufe ver-
  // schieden, exakt wie im handleProductPress oben. Vor jedem Push
  // wird die passende Detail-Resource prefetched, damit die Detail-
  // Seite mit Daten auf der ersten Frame rendert.
  const handleTopRatedPress = (item: TopRatedItem) => {
    // Flat-Item vom Aggregator. Legacy `item.product`-Wrapper als Fallback.
    const productName =
      item.name ?? item.product?.name ?? 'Produkt';
    if (item.type === 'marken') {
      analytics.trackProductViewWithJourney(item.id, 'brand', productName, 0);
      FirestoreService.prefetchComparisonData(item.id, true);
      safePush(`/product-comparison/${item.id}?type=brand` as any);
      return;
    }
    analytics.trackProductViewWithJourney(item.id, 'noname', productName, 0);
    const stufe =
      item.stufe ?? parseInt(item.product?.stufe ?? '3', 10) ?? 3;
    if (stufe <= 2) {
      FirestoreService.prefetchProductDetails(item.id);
      safePush(`/noname-detail/${item.id}` as any);
    } else {
      FirestoreService.prefetchComparisonData(item.id, false);
      safePush(`/product-comparison/${item.id}?type=noname` as any);
    }
  };

  // ─── Animated styles ────────────────────────────────────────────────────────
  const searchBarAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 30], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [0, 30], [0, -8], Extrapolation.CLAMP) },
    ],
  }));

  // Scan-icon-in-the-search-bar handoff: while the header scan button
  // is appearing (see MorphingHeader.scannerStyle, scrollY 30→95), this
  // icon simultaneously translates UP and shrinks, giving the visual
  // impression of the icon "flying" into the header. It fades before
  // the header button's landing-pop at scrollY ≈ 72, so the arrival
  // there reads as the same icon reaching its destination.
  const bigScanIconAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 50, 68], [1, 0.5, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [0, 68], [0, -72], Extrapolation.CLAMP) },
      { scale: interpolate(scrollY.value, [0, 68], [1, 0.7], Extrapolation.CLAMP) },
    ],
  }));

  // ─── Level card data ────────────────────────────────────────────────────────
  const levelNum = (userProfile as any)?.stats?.currentLevel ?? userProfile?.level ?? 1;
  const currentSavings = userProfile?.totalSavings ?? 0;
  const currentPoints = Number(
    (userProfile as any)?.stats?.pointsTotal ??
      (userProfile as any)?.totalPoints ??
      0,
  );
  const levelInfo = levels.find(l => l.id === levelNum) ?? levels[0];
  const nextLevel = levels.find(l => l.id === levelNum + 1);
  // Level-coloured accent for the icon circle. The card surface
  // itself stays neutral (theme.surface) so it sits calmly between
  // the Schnellzugriff row above and the Banner-Ad / "Für dich
  // enttarnt" sections below — the previous full-bleed colour
  // background made the home tab visually noisy.
  const levelAccent = levelInfo?.color ?? brand.primary;
  // Savings + points still missing to reach the next level. Rendered
  // inline as e.g. "5,40 € & 230 Pkt zum nächsten Level".
  const remainingSavings = nextLevel
    ? Math.max(0, nextLevel.savingsRequired - currentSavings)
    : 0;
  const remainingPoints = nextLevel
    ? Math.max(0, (nextLevel.pointsRequired ?? 0) - currentPoints)
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

  const scrollContentPaddingTop = insetTop + MORPHING_HEADER_ROW_HEIGHT;

  // ─── Schnellzugriff items ────────────────────────────────────────────────────
  // Matches prototype Home.jsx. Backgrounds are prototype-specific brand accents
  // (mint for Kassenbon, lavender for Produkte, neutral for the rest).
  // Memoised so the array reference is stable between renders —
  // QuickAccessCard's React.memo only kicks in if the props don't
  // change; otherwise we'd re-render five cards on every scroll
  // tick.
  const schnellzugriff = useMemo(() => [
    { icon: 'receipt' as const, label: 'Kassenbon\nscannen', background: '#0d8575', dark: true as const,  onPress: onScanBon },
    { icon: 'camera-plus-outline'  as const, label: 'Produkte\neinreichen', background: '#5b4f9c', dark: true as const,  onPress: onProductSubmit },
    // Cart-Glyph (gefüllt) — entspricht dem `cart.fill` der alten
    // Homepage und matcht den schwebenden Einkaufszettel-FAB rechts
    // unten, sodass Schnellzugriff + FAB visuell verbunden sind.
    // Sitzt zwischen "Produkte einreichen" und "Deine Favoriten" —
    // Action-orientierte Cards (Bon, Produkt, Einkaufsliste) gehören
    // visuell zusammen, gefolgt von Browse-Cards (Favoriten, Umfragen).
    { icon: 'cart'                 as const, label: 'Einkaufs-\nzettel',    background: theme.surfaceAlt, dark: false as const, onPress: () => safePush('/shopping-list' as any) },
    // Theme-aware bg statt hardcoded `#dde2e4` (das war im Dark-Modus
    // mit weißem text unlesbar). theme.surfaceAlt ist hellgrau im
    // Light-Modus und dunkelgrau im Dark-Modus → theme.text liest
    // sich in beiden Modi korrekt.
    { icon: 'heart-outline'        as const, label: 'Deine\nFavoriten',    background: theme.surfaceAlt, dark: false as const, onPress: () => safePush('/favorites' as any) },
    { icon: 'poll'                 as const, label: 'Umfragen',            background: theme.surfaceAlt, dark: false as const, onPress: () => safePush('/surveys' as any) },
  ], [onScanBon, onProductSubmit, theme.surfaceAlt]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <MorphingHeader
        scrollY={scrollY}
        insetTop={insetTop}
        onPressSearch={openSearchSheet}
        onPressScanner={() => safePush('/barcode-scanner')}
        onPressProfile={() => safePush(user ? ('/profile' as any) : ('/auth/welcome' as any))}
        profilePhotoUrl={
          (userProfile as any)?.photo_url || user?.photoURL || null
        }
      />

      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        scrollsToTop={isFocused}
        // paddingBottom: Tab-Bar ist absolut positioniert (höhe 90 iOS /
        // 62 Android) und der FAB sitzt darüber bei bottom 100 — der
        // Content darf bis kurz vor die FAB-Unterkante laufen, weil
        // die Tab-Bar selbst transparent über dem Content schwebt.
        // 110 px lassen die letzte Card sichtbar, ohne unnötig leeren
        // Raum am Ende.
        contentContainerStyle={{ paddingTop: scrollContentPaddingTop, paddingBottom: 110 }}
      >
        {/* ── Below-header search bar ── The scan-icon is pulled out of
            the searchBarAnimStyle wrapper so it can travel up to the
            header position independently of the pill's fade. That way
            the icon looks like it's physically flying into the chrome
            instead of vanishing with the pill and re-appearing above. */}
        <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 }}>
          <Animated.View style={searchBarAnimStyle}>
            <Pressable
              onPress={openSearchSheet}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.surface,
                borderRadius: radii.full,
                height: 48,
                paddingLeft: 16,
                paddingRight: 48, // reserve space where the scan icon visually sits
                gap: 10,
                ...shadows.sm,
              }}
            >
              <MaterialCommunityIcons name="magnify" size={20} color={theme.textMuted} />
              <Text
                style={{ flex: 1, fontFamily, fontWeight: fontWeight.regular, fontSize: 14, color: theme.textMuted }}
                numberOfLines={1}
              >
                Marken oder Produkte suchen…
              </Text>
            </Pressable>
          </Animated.View>
          <Animated.View
            style={[
              {
                position: 'absolute',
                // top = 12 (wrapper paddingTop) + (48 pill height - 20 icon) / 2
                top: 26,
                // right = 20 (wrapper paddingRight) + 16 (pill paddingRight)
                right: 36,
              },
              bigScanIconAnimStyle,
            ]}
          >
            <Pressable onPress={() => safePush('/barcode-scanner')} hitSlop={10}>
              <MaterialCommunityIcons name="barcode-scan" size={20} color={theme.primary} />
            </Pressable>
          </Animated.View>
        </View>

        {/* ── Schnellzugriff ── */}
        <View style={{ marginTop: 20 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 13,
              color: theme.textMuted,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              marginBottom: 12,
              paddingHorizontal: 20,
            }}
          >
            Schnellzugriff
          </Text>
          <Animated.ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollsToTop={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
          >
            {schnellzugriff.map((item, i) => (
              <QuickAccessCard
                key={i}
                icon={item.icon}
                label={item.label}
                background={item.background}
                dark={item.dark}
                onPress={item.onPress}
                // Live-Count-Badge: Cart → Einkaufszettel, Favoriten →
                // Anzahl Favoriten, Umfragen → verfügbare Umfragen. Andere
                // Cards bleiben badge-frei (count <= 0 rendert nichts).
                count={
                  item.icon === 'cart'
                    ? cartCount
                    : item.icon === 'heart-outline'
                      ? favoritesCount
                      : item.icon === 'poll'
                        ? surveyCount
                        : undefined
                }
              />
            ))}
          </Animated.ScrollView>
        </View>

        {/* ── Level card ──────────────────────────────────────────
            Compact, white-surface card with a level-coloured icon
            circle on the left and a single-line "remaining" caption.
            No progress bar — the inline "X € & Y Pkt zum nächsten
            Level" copy is more informative and lets the card sit
            shorter (≈ 64 px instead of the previous ~88 px).
            Wird komplett ausgeblendet wenn der User die
            spielerischen Inhalte deaktiviert hat (Profil-Toggle). */}
        {!gamificationEnabled ? null : levelsLoading || levels.length === 0 ? (
          <View
            style={{
              marginHorizontal: 20,
              marginTop: 20,
              borderRadius: radii.lg,
              backgroundColor: theme.surface,
              paddingHorizontal: 14,
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              ...shadows.sm,
            }}
          >
            <Shimmer width={40} height={40} radius={20} />
            <View style={{ flex: 1, gap: 6 }}>
              <Shimmer width={90} height={12} radius={4} />
              <Shimmer width="80%" height={11} radius={3} />
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => safePush('/achievements' as any)}
            style={({ pressed }) => ({
              marginHorizontal: 20,
              marginTop: 20,
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
            {/* Level-gradient icon circle (40×40) — same two-stop
                gradient + diagonal vector as the CurrentLevelHero
                on /achievements (just shrunk to fit the home
                card). The icon glyph itself stays white so it
                reads on any underlying gradient. The card's
                surface stays neutral so this is the only colourful
                element of the row. */}
            <LinearGradient
              colors={levelGradient(levelNum, levelInfo?.color)}
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
                // Per-level glyph — paw / trophy / crown / fire /
                // … same mapping as Errungenschaften.
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
                Level {levelNum}
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
        )}

        {/* ── Banner Ad ── (C2: erst ab Session 2, siehe bannerAllowed) */}
        {showAds && bannerAllowed && (
          <View style={{ marginTop: 16 }}>
            <BannerAd
              onAdLoaded={() => {}}
              onAdFailedToLoad={() => {}}
            />
          </View>
        )}

        {/* ── Neue Funde — typography matches the "Schnellzugriff"
            section-eyebrow further up the page for a consistent
            rhythm across the Home sections (same size, same muted
            grey, same letter-spacing). */}
        <View style={{ marginTop: 24 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 13,
              color: theme.textMuted,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              paddingHorizontal: 20,
              marginBottom: 4,
            }}
          >
            Neue Funde
          </Text>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingHorizontal: 20,
              marginBottom: 12,
            }}
          >
            <Text
              style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 22, color: theme.text, letterSpacing: -0.2 }}
            >
              Für dich enttarnt
            </Text>
            <Pressable onPress={() => safePush('/(tabs)/explore' as any)}>
              <Text
                style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 13, color: theme.primary }}
              >
                Alle anzeigen
              </Text>
            </Pressable>
          </View>

          {loading ? (
            // Skeleton row for "Für dich enttarnt" — mirrors the
            // horizontal ProductCard shape exactly: 168 px wide,
            // 135 px image area, padding row with eyebrow + 2-line
            // title + price. Each skeleton element shimmers via
            // the shared `Shimmer` (gradient sweep, Instagram-
            // style). Card surface + radius matches live cards so
            // the swap-in is invisible. */
            <Animated.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollsToTop={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            >
              {[0, 1, 2, 3].map(i => (
                <View
                  key={i}
                  style={{
                    width: 168,
                    backgroundColor: theme.surface,
                    borderRadius: radii.lg,
                    overflow: 'hidden',
                    ...shadows.sm,
                  }}
                >
                  {/* Image slot */}
                  <Shimmer width={168} height={135} radius={0} />
                  {/* Body */}
                  <View style={{ padding: 12, paddingBottom: 14 }}>
                    <Shimmer width={72} height={10} radius={3} style={{ marginBottom: 8 }} />
                    <Shimmer height={12} radius={4} style={{ marginBottom: 6 }} />
                    <Shimmer width="65%" height={12} radius={4} style={{ marginBottom: 10 }} />
                    <Shimmer width={70} height={16} radius={4} />
                  </View>
                </View>
              ))}
            </Animated.ScrollView>
          ) : error ? (
            // 3.1 (Stufe 3): statt totem Text ein offline-bewusster Retry-Block.
            // Bumpt netRetryNonce → derselbe Reload-Pfad wie bei Reconnect.
            <View style={{ paddingHorizontal: 20, gap: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <MaterialCommunityIcons
                  name={netStatus.online ? 'cloud-alert' : 'wifi-off'}
                  size={18}
                  color={theme.textMuted}
                  style={{ marginTop: 1 }}
                />
                <Text
                  style={{
                    flex: 1,
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 14,
                    lineHeight: 19,
                    color: theme.textSub,
                  }}
                >
                  {netStatus.online
                    ? 'Das Laden hat gerade nicht geklappt. Ein neuer Versuch hilft meistens.'
                    : 'Gerade kein Empfang — sobald du wieder online bist, klappt es sofort.'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Erneut versuchen"
                onPress={() => {
                  setError(null);
                  setLoading(true);
                  setProductsStageDone(false);
                  setNewsStageDone(false);
                  setNetRetryNonce((n) => n + 1);
                }}
                style={({ pressed }) => ({
                  alignSelf: 'flex-start',
                  backgroundColor: brand.primary,
                  borderRadius: radii.full,
                  paddingHorizontal: 22,
                  paddingVertical: 10,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 14, color: '#fff' }}>
                  Erneut versuchen
                </Text>
              </Pressable>
            </View>
          ) : (
            <Animated.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollsToTop={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            >
              {enttarnteProdukte.map((product, index) => {
                const disc = product.discounter ? discounterMap[(product.discounter as any).id] : null;
                const brandName = handelsmarken[product.id] ?? null;
                const logoUri = disc?.bild ?? null;
                // Eyebrow joins (discounter + handelsmarke) load
                // INDEPENDENTLY from the product itself. While
                // either is missing AND we expect it (the product
                // has a `discounter` and/or `handelsmarke` ref),
                // render shimmer placeholders so the eyebrow row
                // reserves its 16 px slot and replaces silently
                // once the data arrives.
                const expectsLogo = !!product.discounter;
                const expectsBrand = !!product.handelsmarke;
                const eyebrowLoading =
                  (expectsLogo && !logoUri) || (expectsBrand && !brandName);
                return (
                  <ProductCard
                    key={product.id}
                    title={product.name ?? ''}
                    brand={brandName}
                    eyebrowLogoUri={logoUri}
                    eyebrowLoading={eyebrowLoading}
                    product={product}
                    price={product.preis ?? 0}
                    stufe={parseInt(product.stufe) || 1}
                    variant="horizontal"
                    onPress={() => handleProductPress(product, index)}
                  />
                );
              })}
            </Animated.ScrollView>
          )}
        </View>

        {/* ── Neuigkeiten ── */}
        <View style={{ marginTop: 28 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: 20,
              marginBottom: 12,
            }}
          >
            <Text
              style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 20, color: theme.text }}
            >
              Neuigkeiten
            </Text>
          </View>

          {newsLoading ? (
            <Animated.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollsToTop={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            >
              {[0, 1, 2].map(i => (
                <Shimmer
                  key={i}
                  width={270}
                  height={180}
                  radius={radii.lg}
                />
              ))}
            </Animated.ScrollView>
          ) : newsPosts.length === 0 ? (
            <Text
              style={{ paddingHorizontal: 20, fontFamily, fontSize: 14, color: theme.textMuted }}
            >
              Keine Neuigkeiten verfügbar
            </Text>
          ) : (
            <Animated.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollsToTop={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            >
              {newsPosts.map(post => (
                <NewsCard
                  key={post.id}
                  post={post}
                  onPress={openNewsArticle}
                />
              ))}
            </Animated.ScrollView>
          )}
        </View>

        {/* ── Cashback CTA ── */}
        <View style={{ paddingHorizontal: 20, marginTop: 28 }}>
          <LinearGradient
            colors={[brand.primaryDark, brand.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: radii.xl, overflow: 'hidden', ...shadows.fab }}
          >
            <Pressable
              onPress={() => safePush('/(tabs)/rewards' as any)}
              style={{ padding: 24 }}
            >
              <View style={{ opacity: 0.18, position: 'absolute', right: -30, bottom: -20 }}>
                <DetectiveMark size={140} color="#fff" />
              </View>
              <View>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 22,
                    lineHeight: 26,
                    color: '#fff',
                    letterSpacing: -0.2,
                    marginBottom: 10,
                  }}
                >
                  Sichere dir Cashback &{'\n'}Rewards!
                </Text>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.regular,
                    fontSize: 13,
                    lineHeight: 19,
                    color: 'rgba(255,255,255,0.92)',
                    marginBottom: 16,
                    maxWidth: 260,
                  }}
                >
                  Scanne deinen Kassenbeleg oder nimm an Umfragen teil, um dir Gutscheine oder Cashback zu sichern.
                </Text>
                <View
                  style={{
                    alignSelf: 'flex-start',
                    backgroundColor: theme.surface,
                    borderRadius: radii.full,
                    paddingHorizontal: 18,
                    height: 44,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <MaterialCommunityIcons name="trophy" size={16} color={brand.primary} />
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.bold,
                      fontSize: 13,
                      color: brand.primary,
                    }}
                  >
                    Rewards
                  </Text>
                </View>
              </View>
            </Pressable>
          </LinearGradient>
        </View>

        {/* ── Zwei feste Karussells (User-Wunsch 2026-07): frische, oft
            wechselnde Listen motivieren häufigeres Reinschauen. Kein Tab —
            beide immer sichtbar untereinander. */}
        <TopRatedSection
          eyebrow="Diesen Monat top bewertet"
          title="Top-Bewertungen des Monats"
          topMargin={28}
          loading={topRatedMonthLoading}
          items={topRatedMonth}
          emptyText="Im letzten Monat wurden noch keine Produkte bewertet — sei der erste, der ein Produkt enttarnt und seine Meinung teilt."
          onItemPress={handleTopRatedPress}
        />
        <TopRatedSection
          eyebrow="Diese Woche am meisten angeschaut"
          title="Meist aufgerufen diese Woche"
          topMargin={22}
          loading={mostViewedLoading}
          items={mostViewed}
          emptyText="Noch keine Aufrufe diese Woche — schau dir ein paar Produkte an, dann füllt sich die Liste."
          onItemPress={handleTopRatedPress}
        />

      </Animated.ScrollView>

      {/* Einkaufszettel-FAB auf Home BEWUSST entfernt: die
          Schnellzugriff-Einkaufsliste-Card mit Live-Count-Badge
          ist jetzt der Cart-Anker auf der Startseite — ein
          zusätzlicher FAB unten rechts wäre redundant. Auf
          Detail-/Comparison-Seiten bleibt der FAB unverändert
          erhalten, weil dort die Schnellzugriff-Card nicht
          existiert. */}

      <SearchBottomSheet
        visible={showSearchSheet}
        onClose={() => setShowSearchSheet(false)}
        // `topAnchor` is the page-side search bar's TOP Y — the
        // sheet places its own input at this exact position so
        // the two visually morph into one. See `openSearchSheet`
        // for the scroll-aware computation.
        topAnchor={
          searchSheetTop ??
          insetTop + MORPHING_HEADER_ROW_HEIGHT + 12
        }
        colors={legacyColors}
        onSearch={handleSearch}
      />

      {/* Home-Walkthrough (Welcome-Card → Spotlight → Tour-Ende).
          Rendert eine kuratierte Demo-Karte SELBST in einem Modal-
          Layer (siehe DemoProductSpotlight) — unabhängig vom Home-
          Render-Tree, keine Layout-Shifts durch Ads. */}
      <HomeWalkthrough
        visible={homeCoachmark.visible}
        onDismiss={homeCoachmark.dismiss}
      />

      {/* Demographics-Prompt nach Onboarding-Climax (T3).
          Sheet wird nur einmal pro User gezeigt — Trigger-Logik im
          useEffect oben. */}
      <DemographicsPromptSheet
        visible={showDemographicsSheet}
        onSubmit={handleDemographicsSubmit}
        onSkip={handleDemographicsSkip}
      />
    </View>
  );
}

// ─── Top-rated section ───────────────────────────────────────────────────────
//
// Wiederverwendbarer Block: Eyebrow + Headline + horizontale
// Snap-Liste aus TopRatedCards. Wird auf Home zweimal verwendet
// (Overall + Letzter Monat) — Layout/Padding/Empty-State sind
// identisch, nur Copy + Daten-Quelle unterscheidet sich.

// Flat-Item-Shape wie vom Aggregator (`top-products-aggregator`)
// geliefert. Produkt-Felder direkt am Item, plus Joins, plus
// optionale Metric-Felder:
//   • avgRating + commentCount + latestComment → Rating-Listen
//   • viewCount → Most-Viewed-Liste
type TopRatedItem = {
  id: string;
  type: 'noname' | 'marken';
  // Produkt-Felder direkt
  name: string;
  bild: string | null;
  preis: number | null;
  stufe: number;
  // Joins
  brandName: string | null;
  brandLogoUri: string | null;
  marketName: string | null;
  marketCountry: string | null;
  marketLogoUri: string | null;
  herstellerName: string | null;
  herstellerLogoUri: string | null;
  // Optional je nach Liste
  avgRating?: number;
  ratingCount?: number;
  commentCount?: number;
  latestComment?: string | null;
  latestRating?: number | null;
  viewCount?: number;
  // Legacy fallback — alte API hatte `product`-Wrapper.
  product?: any;
};

function TopRatedSection({
  eyebrow,
  title,
  loading,
  items,
  emptyText,
  onItemPress,
  /** Top-Margin für die Section. Default 28; bei verschachtelten
   *  Sub-Sections (mehrere Listen unter einer Parent-Heading) auf
   *  einen kleineren Wert wie 12 setzen. Die Header-STYLES bleiben
   *  identisch. */
  topMargin,
}: {
  /** Optional. Wenn nicht gesetzt, rendert nur der schwarze Title. */
  eyebrow?: string;
  title: string;
  loading: boolean;
  items: TopRatedItem[];
  emptyText: string;
  onItemPress: (item: TopRatedItem) => void;
  topMargin?: number;
}) {
  const { theme, shadows } = useTokens();
  return (
    <View style={{ marginTop: topMargin ?? 28 }}>
      {eyebrow || title ? (
        <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
          {eyebrow ? (
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 13,
                color: theme.textMuted,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                marginBottom: 4,
              }}
            >
              {eyebrow}
            </Text>
          ) : null}
          {title ? (
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 20,
                color: theme.text,
                letterSpacing: -0.2,
              }}
            >
              {title}
            </Text>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <Animated.ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollsToTop={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        >
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{
                width: TOP_RATED_CARD_WIDTH,
                backgroundColor: theme.surface,
                borderRadius: radii.lg,
                overflow: 'hidden',
                ...shadows.sm,
              }}
            >
              {/* Bild-Placeholder mit gleicher 135 px Höhe wie die
                  echte ProductCard (horizontal variant) — kein
                  Layout-Sprung beim Daten-Swap. */}
              <Shimmer width="100%" height={135} radius={0} />
              <View style={{ padding: 12, paddingBottom: 14 }}>
                <Shimmer width={72} height={10} style={{ marginBottom: 8 }} />
                <Shimmer height={12} style={{ marginBottom: 6 }} />
                <Shimmer width="70%" height={12} style={{ marginBottom: 10 }} />
                <Shimmer width={80} height={16} style={{ marginBottom: 8 }} />
                <View
                  style={{
                    height: 1,
                    backgroundColor: theme.border,
                    marginTop: 4,
                    marginBottom: 6,
                  }}
                />
                <Shimmer width="100%" height={11} radius={3} style={{ marginBottom: 4 }} />
                <Shimmer width="80%" height={11} radius={3} />
              </View>
            </View>
          ))}
        </Animated.ScrollView>
      ) : items.length === 0 ? (
        <Text
          style={{
            paddingHorizontal: 20,
            fontFamily,
            fontSize: 14,
            color: theme.textMuted,
            lineHeight: 19,
          }}
        >
          {emptyText}
        </Text>
      ) : (
        <Animated.ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollsToTop={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        >
          {items.map((item, idx) => (
            <TopRatedCard
              key={`${item.type}:${item.id}`}
              rank={idx + 1}
              item={item}
              onPress={() => onItemPress(item)}
            />
          ))}
        </Animated.ScrollView>
      )}
    </View>
  );
}

// ─── Top-rated card ──────────────────────────────────────────────────────────
//
// Nutzt direkt die `ProductCard` aus dem Design-System (gleicher
// Style + Maße wie die "Für dich enttarnt"-Section auf Home), und
// reicht zwei zusätzliche Slots durch:
//   • imageOverlayTopLeft   = Rank-Badge (#1, #2, …)
//   • imageOverlayBottomLeft= 5-Stern-Skala + numerische Wertung auf
//                             einem dunklen translucent Streifen
//   • footer                = Trennlinie + 2-Zeilen Kommentar-
//                             Vorschau direkt unter der Preis-Zeile
//
// Damit ist die Card visuell 1:1 die ProductCard, nur erweitert um
// die für die Top-Rated-Liste relevanten Infos. Stufe (im üblichen
// Bottom-Right-Slot) und Eyebrow (Discounter-Logo + Handelsmarke
// für NoName, Hersteller-Logo + -Name für Marken) übernimmt
// ProductCard direkt.

type TopRatedCardProps = {
  rank: number;
  item: TopRatedItem;
  onPress: () => void;
};

const TOP_RATED_CARD_WIDTH = 168;

// Kleine 5-Stern-Skala. 5 Sterne, je nach gerundetem Score gefüllt
// oder outline. Numerischer Score (z.B. "4,6") daneben — damit der
// User sieht, dass z.B. 4,6 nicht 5,0 ist obwohl 5 Sterne leuchten.
function StarScale({ rating }: { rating: number }) {
  const full = Math.round(Math.max(0, Math.min(5, rating)));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <MaterialCommunityIcons
          key={i}
          name={i < full ? 'star' : 'star-outline'}
          size={10}
          color="#ffd44b"
        />
      ))}
    </View>
  );
}

function TopRatedCard({ rank, item, onPress }: TopRatedCardProps) {
  const { theme, brand: brandTokens } = useTokens();
  // Flat-Item vom Aggregator. Legacy-Fallback auf `item.product` falls
  // noch jemand das alte Shape benutzt (z.B. live `getTopRatedProducts`).
  const isNoName = item.type === 'noname';
  const productName = item.name ?? item.product?.name ?? 'Produkt';
  // Prefer flat-item shape from aggregator (has `bildClean` + `bild`),
  // fall back to legacy nested `item.product` shape via the helper.
  const productForImage = item.bild || item.bildClean ? item : item.product;
  const productPrice =
    typeof item.preis === 'number'
      ? item.preis
      : typeof item.product?.preis === 'number'
        ? item.product.preis
        : 0;
  const stufeRaw = item.stufe ?? parseInt(String(item.product?.stufe ?? ''), 10);

  // Eyebrow für ProductCard:
  //   • NoName → Handelsmarke (z.B. "REWE GUT") + Discounter-Logo
  //   • Marken → Hersteller (z.B. "ZENTIS") + Hersteller-Logo
  const brandText = isNoName ? item.brandName : item.herstellerName;
  const brandLogo = isNoName ? item.marketLogoUri : item.herstellerLogoUri;

  // Stufe nur für NoName.
  const stufeProp =
    isNoName && stufeRaw && stufeRaw >= 1 && stufeRaw <= 5
      ? (stufeRaw as 1 | 2 | 3 | 4 | 5)
      : undefined;

  // Bottom-Left Overlay: nur Rating-Stars für Top-Bewertete-Listen.
  // Most-Viewed-Cards haben bewusst KEINEN sichtbaren Aufruf-Counter
  // — die Section-Heading "Meist aufgerufen" erklärt den Kontext,
  // ein Counter auf jeder Card wäre visueller Lärm.
  const hasRating = typeof item.avgRating === 'number' && item.avgRating > 0;
  const ratingLabel = hasRating
    ? `${String(item.avgRating).replace('.', ',')}`
    : '';

  return (
    <ProductCard
      title={productName}
      brand={brandText ?? null}
      eyebrowLogoUri={brandLogo ?? null}
      product={productForImage}
      price={productPrice}
      stufe={stufeProp}
      width={TOP_RATED_CARD_WIDTH}
      onPress={onPress}
      // Rank-Badge oben links auf dem Bild — kleine Pill in
      // brand.primary, klar lesbar auf jedem Hintergrund.
      imageOverlayTopLeft={
        <View
          style={{
            minWidth: 24,
            height: 22,
            paddingHorizontal: 6,
            borderRadius: 11,
            backgroundColor: brandTokens.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 11,
              color: '#fff',
              includeFontPadding: false as any,
            }}
          >
            #{rank}
          </Text>
        </View>
      }
      // Bottom-Left Overlay: 5-Stern-Skala + Score auf dunkler
      // Translucent-Pill — bleibt auf jedem Bild lesbar, überlagert
      // sich nicht mit der Stufen-Pill (rechts). Nur für Items mit
      // tatsächlichem Rating; Most-Viewed-Items rendern hier nichts.
      imageOverlayBottomLeft={
        hasRating ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 6,
              paddingVertical: 3,
              borderRadius: 7,
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}
          >
            <StarScale rating={item.avgRating ?? 0} />
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 10,
                color: '#fff',
                includeFontPadding: false as any,
              }}
            >
              {ratingLabel}
            </Text>
          </View>
        ) : null
      }
      // Footer = Trennlinie + 2-Zeilen Kommentar-Vorschau direkt
      // unter der Preis-Zeile. Cards ohne Kommentar werden bereits
      // im Service ausgefiltert, das ?? null ist nur Defensive.
      footer={
        item.latestComment ? (
          <>
            <View
              style={{
                height: 1,
                backgroundColor: theme.border,
                marginTop: 8,
                marginBottom: 6,
              }}
            />
            <Text
              numberOfLines={2}
              style={{
                fontFamily,
                fontWeight: fontWeight.regular,
                fontSize: 11,
                lineHeight: 15,
                color: theme.textSub,
                fontStyle: 'italic',
              }}
            >
              „{item.latestComment}"
            </Text>
          </>
        ) : null
      }
    />
  );
}

// ─── Inline news card ────────────────────────────────────────────────────────

type NewsCardProps = {
  post: WordPressPost;
  onPress: (url: string) => void;
};

function NewsCard({ post, onPress }: NewsCardProps) {
  const { theme, shadows } = useTokens();
  const cleanTitle = WordPressService.cleanHtml(post.title.rendered);
  const formattedDate = WordPressService.formatDate(post.date);

  return (
    <Pressable
      onPress={() => onPress(post.link)}
      style={({ pressed }) => ({
        width: 270,
        borderRadius: radii.lg,
        backgroundColor: theme.surface,
        overflow: 'hidden',
        opacity: pressed ? 0.92 : 1,
        ...shadows.md,
      })}
    >
      {post.featured_image_url ? (
        <Image
          source={{ uri: post.featured_image_url }}
          style={{ width: '100%', height: 130 }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{
            width: '100%',
            height: 130,
            backgroundColor: theme.surfaceAlt,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <MaterialCommunityIcons name="newspaper" size={32} color={theme.textMuted} />
        </View>
      )}
      <View style={{ padding: 14 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            color: theme.textMuted,
            marginBottom: 6,
          }}
        >
          {formattedDate}
        </Text>
        <Text
          numberOfLines={2}
          style={{
            fontFamily,
            fontWeight: fontWeight.semibold,
            fontSize: 14,
            lineHeight: 19,
            color: theme.text,
          }}
        >
          {cleanTitle}
        </Text>
      </View>
    </Pressable>
  );
}
