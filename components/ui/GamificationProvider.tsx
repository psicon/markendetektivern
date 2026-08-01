import * as Haptics from 'expo-haptics';
import { AppState } from 'react-native';
import { safeNavigate, safePush } from '@/lib/utils/safeNav';
import { getCurrentPathname } from '@/lib/utils/currentRoute';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { subscribeUserCashbackHistoryPaged } from '@/lib/services/cashbackUpload';
import {
  achievementService,
  setAchievementUnlockHandler,
  setLevelUpHandler,
  setPointsEarnedHandler,
} from '@/lib/services/achievementService';
import { formatCents } from '@/lib/types/cashback';
import { CoachmarkService } from '@/lib/services/coachmarkService';
import { FirstCaseService } from '@/lib/services/firstCaseService';
import { gamificationSettingsService } from '@/lib/services/gamificationSettingsService';
import { ratingPromptService } from '@/lib/services/ratingPrompt';
import {
  isAnySheetOpen,
  isSurveyVisible,
  onPresentationIdle,
} from '@/lib/services/sheetPresence';
import { RATING_POLL_INTERVAL_MS } from '@/lib/perfFlags';

import { showInfoToast, showPointsToast, showStreakToast as showStreakToastNew } from '@/lib/services/ui/toast';
import { Achievement } from '@/lib/types/achievements';
import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { type BannerData } from './AchievementUnlockBanner';
import { AppRatingModal } from './AppRatingModal';

// Ruhe-Fenster nach der letzten Feier-Kante, bevor der native
// Review-Dialog angefragt wird (gibt EdgeGlow-Nachlauf, Queue-Drain
// und Punkte-Toasts Luft).
const FIRST_CASE_SETTLE_DELAY_MS = 2500;

// Regelfall: der Dialog kommt WÄHREND die Feier noch steht, gemessen ab
// dem Moment, in dem der Banner sichtbar wird. Vorher hing er an der
// Ruhe-Kante „Banner weg" — mit 6 s Standzeit + Ausblenden + 2,5 s waren
// das real ~9 s, und der Bezug zum Erfolgserlebnis war verloren.
// Der Banner ist ein Animated.View, KEIN <Modal> — der native Dialog
// darüber ist deshalb unkritisch (kein Zwei-Modal-Deadlock auf iOS).
//
// OBERGRENZE: AUTO_DISMISS_MS des Banners (6 s). Dessen Timer startet im
// selben Effect, der ihn einblendet, also praktisch im selben Tick wie
// dieser hier — bei 5 s bleibt rund 1 s Rest-Standzeit. Wer diesen Wert
// erhöht, muss den Banner laenger stehen lassen, sonst fragt die App in
// einen leeren Bildschirm und der Kontext zum Erfolg ist wieder weg.
const FIRST_CASE_PROMPT_AFTER_BANNER_MS = 5000;

// AchievementUnlockBanner LAZY laden — sein Modul importiert
// transitiv @shopify/react-native-skia (durch EdgeGlow) und das ist
// auf manchen Android-Devices (Mediatek + Memory-Pressure) ein
// spürbarer Startup-Cost. Lazy heißt: Skia-Module wird erst geladen
// wenn ein Banner WIRKLICH gezeigt werden soll, nicht bereits beim
// App-Start.
const AchievementUnlockBanner = lazy(() =>
  import('./AchievementUnlockBanner').then((m) => ({
    default: m.AchievementUnlockBanner,
  })),
);

// ─── Banner-Data-Builder ─────────────────────────────────────────
//
// Wandeln Achievement-/LevelUp-Daten ins generische BannerData-
// Schema um (Reanimated-friendly, mit Lottie). Werden vom Provider
// intern für Auto-Trigger benutzt UND von Catalog-Pages (achievements.tsx)
// exportiert für Preview-Taps via useGamification().showBanner(...).
//
// Lottie-Mapping spiegelt `lottieFor` aus app/achievements.tsx —
// gleiche Animation pro Action damit der visuelle Eindruck zwischen
// Detail-Page und Banner konsistent ist.
//
// Reihenfolge der Auflösung:
//   1. Per-Achievement-ID-Override (für Spezialfälle wo die Action
//      generisch ist aber das Achievement eine eigene Identität
//      braucht — z.B. "Treu bleiben" ist daily_streak aber soll
//      die Loyalty-Heart-Lottie zeigen, nicht streak-fire).
//   2. Per-Action-Mapping als Fallback.
function lottieForAchievement(achievement: Achievement): any {
  try {
    // Per-ID-Overrides — nur wo die Action-basierte Logik nicht
    // passt. Erweitern wenn weitere Achievements eigene Lottie
    // brauchen.
    switch (achievement.id) {
      case 'UcO5xJgps0kUIg8V32li': // "Treu bleiben" — 30-Tage-Streak,
        // Heart-Theme statt streak-fire (semantisch Loyalty, nicht
        // Combustion).
        return require('@/assets/lottie/favorites2.json');
    }

    switch (achievement.trigger?.action) {
      case 'first_action_any':
        return require('@/assets/lottie/rocket.json');
      case 'daily_streak':
        return require('@/assets/lottie/streak-fire.json');
      case 'view_comparison':
        return require('@/assets/lottie/comparison.json');
      case 'complete_shopping':
        return require('@/assets/lottie/task.json');
      case 'search_product':
        return require('@/assets/lottie/search.json');
      case 'submit_rating':
        return require('@/assets/lottie/ratingsthumbsup.json');
      case 'create_list':
        return require('@/assets/lottie/task.json');
      case 'convert_product':
        return require('@/assets/lottie/swap.json');
      case 'share_app':
        return require('@/assets/lottie/review.json');
      case 'submit_product':
        return require('@/assets/lottie/favorites.json');
      case 'save_product':
        return require('@/assets/lottie/favorites2.json');
      case 'savings_total':
        return require('@/assets/lottie/savings.json');
      default:
        return require('@/assets/lottie/confetti.json');
    }
  } catch {
    return require('@/assets/lottie/confetti.json');
  }
}

export function bannerDataFromAchievement(achievement: Achievement): BannerData {
  return {
    title: achievement.name,
    subtitle: achievement.description,
    points: achievement.points,
    lottie: lottieForAchievement(achievement),
    // Tier-Farbe: bevorzugt achievement.color (Firestore-konfiguriert),
    // sonst gold als Fallback ("Erfolg/Belohnung"-Konnotation).
    tint: (achievement.color as string) || '#F0A030',
    onTap: () => {
      try {
        safePush('/achievements' as any);
      } catch (e) {
        console.warn('Achievement banner nav failed (non-fatal):', e);
      }
    },
  };
}

export function bannerDataFromLevelUp(
  newLevel: number,
  oldLevel: number,
  unlockedCategory?: { id: string; name: string; imageUrl: string },
): BannerData {
  void oldLevel;

  // Level-Daten aus dem Catalog ziehen — Color, Name, Description.
  // Sync-Variante damit die Banner-Daten ohne await gebaut werden
  // können (Catalog ist nach App-Start schon geladen). Fallback
  // wenn Catalog noch leer (race-condition beim ersten Banner direkt
  // nach Cold-Start).
  const allLevels = achievementService.getAllLevelsSync();
  const levelInfo = allLevels.find((l) => l.id === newLevel);
  const tint = levelInfo?.color || '#F0A030';
  const levelName = levelInfo?.name;
  const levelDescription = levelInfo?.description;

  // Sekundär-Tint für den EdgeGlow: Color des VORHERIGEN Levels.
  // Effekt: der Halo zeigt sichtbar BEIDE Farben — die alte (vom
  // letzten Level, das man gerade verlassen hat) und die neue (vom
  // erreichten Level). Visueller "Übergang" der das Level-Up unter-
  // streicht. Fallback wenn kein vorheriges Level (z.B. Level 1):
  // undefined → EdgeGlow nutzt aufgehellte primary als Shimmer.
  const prevLevelInfo = allLevels.find((l) => l.id === newLevel - 1);
  const secondaryTint = prevLevelInfo?.color;

  // Title: "Level X erreicht – Levelname" wenn Name vorhanden,
  // sonst nur "Level X erreicht" (Catalog noch nicht geladen).
  // Em-Dash (–, U+2013) zwischen Level-Number und Name — bessere
  // Typografie als Bindestrich.
  const title = levelName
    ? `Level ${newLevel} erreicht – ${levelName}`
    : `Level ${newLevel} erreicht`;

  // Subtitle = motivierende Level-Beschreibung (wie im Banner-/Toast-Tester).
  // BEWUSST KEIN Kategorie-Unlock-Text ("Neue Kategorie verfügbar"/"…
  // freigeschaltet") mehr (ClickUp 86ca8h1x8): die Level-Up-Feier soll die
  // schöne Beschreibung zeigen — nicht die kategorie-bezogene Meldung. Die
  // Kategorie wird trotzdem freigeschaltet (Funktion unberührt), nur nicht
  // hier announced. unlockedCategory bleibt im Signatur-Vertrag (Caller +
  // Tester übergeben es), wird für den Untertitel aber nicht genutzt.
  void unlockedCategory;
  const subtitle = levelDescription || `Du bist jetzt auf Level ${newLevel}`;

  return {
    title,
    subtitle,
    lottie: (() => {
      try {
        return require('@/assets/lottie/lvlup.json');
      } catch {
        return require('@/assets/lottie/confetti.json');
      }
    })(),
    tint,
    secondaryTint,
    // Level-Up = das große Spektakel: Banner + Haptik + EdgeGlow.
    withGlow: true,
    onTap: () => {
      try {
        safePush('/achievements' as any);
      } catch (e) {
        console.warn('LevelUp banner nav failed (non-fatal):', e);
      }
    },
  };
}

// ClickUp 86caak83r: Die Cashback-Übersicht ist die Belohnungen-Tab
// (`/(tabs)/rewards` → Pathname `/rewards`). Der Bon-VERLAUF
// (`/cashback/history`) ist NICHT die Cashback-Seite. Wenn der User schon
// auf der Cashback-Seite ist, soll der Banner-Tap nicht erneut navigieren.
function isOnCashbackPage(): boolean {
  const p = getCurrentPathname();
  return p === '/rewards' || p === '/(tabs)/rewards';
}

// T17.22: Cashback-Payout Celebration. Wird vom pending/[id]-Screen
// gefeuert wenn state pending→approved transitioniert. Zentral hier
// gebaut damit's durch dieselbe Banner-Pipeline läuft wie Achievements/
// Level-Ups (CLAUDE.md: "ONE celebration component app-wide").
// Lottie: money.json (im Banner als 72×72-Icon). Tint: brand-grün
// primär, gold sekundär — klassische Geld-Konnotation. EdgeGlow ON
// (withGlow=true) damit Cashback denselben "großen Moment"-Charakter
// hat wie ein Level-Up.
export function bannerDataFromCashbackPayout(cashbackCents: number): BannerData {
  const formatted = cashbackCents > 0 ? `+${formatCents(cashbackCents)}` : 'Cashback gutgeschrieben';
  return {
    title: 'Cashback gutgeschrieben!',
    subtitle: cashbackCents > 0
      ? `${formatted} sind deinem Konto gutgeschrieben.`
      : 'Dein Bon wurde verbucht.',
    lottie: (() => {
      try {
        return require('@/assets/lottie/money.json');
      } catch {
        return require('@/assets/lottie/confetti.json');
      }
    })(),
    tint: '#0d8575',
    // Gold als Sekundär-Ton — EdgeGlow shimmert zwischen Brand-Grün
    // (Trust/Erfolg) und Gold (Geld/Wert). Spiegelt visuell was passiert:
    // grüner Bon → goldenes Geld.
    secondaryTint: '#F0A030',
    withGlow: true,
    onTap: () => {
      try {
        // ClickUp 86caak83r: zur Cashback-Übersicht (Belohnungen-Tab),
        // NICHT zur Bon-Liste. Schon auf der Cashback-Seite → kein
        // erneutes Weiterleiten. safeNavigate (statt push), damit der Tab
        // re-used statt auf den Stack gepusht wird.
        if (isOnCashbackPage()) return;
        safeNavigate('/(tabs)/rewards' as any);
      } catch (e) {
        console.warn('Cashback banner nav failed (non-fatal):', e);
      }
    },
  };
}

/**
 * "Erster Fall geschlossen" (ClickUp 86cav7gqm) — die Feier für den
 * ersten echten Erfolg (Katalog-Treffer im Scanner), gezeigt sobald
 * zusätzlich der Walk-Through durch ist.
 *
 * EIGENE Banner-Quelle statt Umtexten des `first_action_any`-
 * Achievements: dieses Achievement wird im Standard-Funnel schon vom
 * Walkthrough-Demo-Tap verbraucht (die Demo-Karte führt auf eine
 * Produktseite → `trackAction('view_comparison')`), also LANGE bevor
 * der User zum ersten Mal selbst scannt. Ein Umtexten hätte die Feier
 * dort verbrannt und im entscheidenden Moment gar keinen Banner gehabt.
 *
 * Der native Review-Dialog hängt an der Beendigung GENAU DIESES
 * Banners — dadurch ist die Reihenfolge "erst Feier, dann Frage"
 * strukturell garantiert und kann nicht von einem noch ausstehenden
 * anderen Banner überholt werden (presentBanner reiht ein, dismissBanner
 * drainiert).
 *
 * KEINE Punkte am Banner: eine Belohnung in unmittelbarer Nähe zur
 * Bewertungsbitte wäre Incentivierung (Apple 3.2.2(x), Play-Policy,
 * UWG). Die Punkte für die Aktion selbst laufen unabhängig weiter.
 */
/**
 * Variante für BESTANDSNUTZER (Level ≥ 3).
 *
 * Warum es die braucht: die Gates von firstCaseService sind reine
 * AsyncStorage-Keys (`firstCase/v1/*`), die es bei KEINEM bestehenden
 * User gibt. Beim Update auf 6.0.12 laufen deshalb auch langjährige
 * Nutzer durch dieselbe Kante — mechanisch gewollt (sie sollen gefragt
 * werden), aber „Erster Fall geschlossen!" wäre für jemanden mit
 * hunderten Vergleichen schlicht falsch und wirkt herablassend.
 *
 * Gleicher Mechanismus, gleiche Sicherungen, nur ehrlicher Text.
 */
export function bannerDataFromVeteranCase(level: number): BannerData {
  return bannerDataFromCase({ stufe: 5, everCelebrated: true, level });
}

/**
 * Der Feier-Text richtet sich nach ZWEI Dingen — beide sind Pflicht,
 * sonst behauptet der Banner etwas, das der Bildschirm darunter
 * widerlegt:
 *
 *  1. WAS der Nutzer vor sich hat (`stufe`). Auf einer Stufe-1/2-Seite
 *     steht wörtlich „Kein direktes Markenprodukt zum Vergleich
 *     hinterlegt" — dort ist „Fall geschlossen" schlicht falsch, und ein
 *     Glückwunsch über einem Fehlschlag ist der direkte Weg zu weiteren
 *     1-Stern-Bewertungen. 29 % der Produkte sind Stufe 1/2, bei Scans
 *     mehr (man scannt, was die App noch nicht kennt).
 *  2. OB schon jemals gefeiert wurde (`everCelebrated`). Seit die
 *     Schlüssel versions-gebunden sind, läuft die Feier pro Release
 *     erneut — „Erster Fall" wäre ab dem zweiten Mal nachprüfbar
 *     gelogen. Die Weiche hing vorher am Level (≥ 3), das deckt aber nur
 *     ~7 % der Nutzer ab; die übrigen 93 % hätten bei JEDEM Release
 *     wieder „Erster" gelesen.
 */
export function bannerDataFromCase(opts: {
  stufe: number;
  everCelebrated: boolean;
  level?: number;
}): BannerData {
  const enttarnt = opts.stufe >= 3;
  const { title, subtitle } = (() => {
    if (!opts.everCelebrated) {
      return enttarnt
        ? { title: 'Erster Fall geschlossen!', subtitle: 'Herzlichen Glückwunsch, Detektiv!' }
        : { title: 'Produkt gefunden!', subtitle: 'Es liegt jetzt in deiner Akte.' };
    }
    // Wiederholung: nie „erster", und der Level nur wenn er etwas aussagt.
    const wer = opts.level && opts.level >= 3 ? `Detektiv Level ${opts.level}` : 'Detektiv';
    return enttarnt
      ? { title: 'Wieder ein Fall gelöst!', subtitle: `Starke Arbeit, ${wer}.` }
      : { title: 'Produkt gefunden!', subtitle: `Wieder eins für die Akte, ${wer}.` };
  })();

  return {
    kind: 'firstCase',
    title,
    // Kurz halten: der Banner gibt dem Subtitle 2 Zeilen neben Lottie
    // (72 px) — ein längerer Satz wird bei großer System-Schrift
    // (maxFontSizeMultiplier 1.3) abgeschnitten.
    subtitle,
    lottie: (() => {
      try {
        return require('@/assets/lottie/firstaction.json');
      } catch {
        return require('@/assets/lottie/confetti.json');
      }
    })(),
    tint: '#F0A030',
    // EdgeGlow shimmert Gold ↔ Brand-Grün.
    secondaryTint: '#0d8575',
    withGlow: true,
    onTap: () => {
      try {
        safePush('/achievements' as any);
      } catch (e) {
        console.warn('First-case banner nav failed (non-fatal):', e);
      }
    },
  };
}

/** Rückwärtskompatible Kurzform für das Dev-Panel (Optik-Vorschau). */
export function bannerDataFromFirstCase(): BannerData {
  return bannerDataFromCase({ stufe: 5, everCelebrated: false });
}

// Kurze Toast-Texte für abgelehnte Bons (die ausführliche Begründung
// steht im pending/[id]-Screen). Klein wie eine Fehlermeldung.
function cashbackRejectToastMsg(reason?: string | null, maxAgeDays?: number | null): string {
  switch (reason) {
    case 'below_min_items':
      return 'Bon abgelehnt: zu wenige Artikel erkannt.';
    case 'duplicate_content_self':
    case 'duplicate_content_cross_user':
      return 'Bon abgelehnt: bereits eingereicht.';
    case 'unknown_merchant':
      return 'Bon abgelehnt: Markt nicht unterstützt.';
    case 'bon_too_old':
      return typeof maxAgeDays === 'number'
        ? `Bon abgelehnt: zu alt (max. ${maxAgeDays} Tage).`
        : 'Bon abgelehnt: zu alt.';
    case 'not_a_receipt':
      return 'Bon abgelehnt: kein Kassenbon erkannt.';
    case 'no_bon_date':
      return 'Bon nicht lesbar — bitte neu scannen.';
    case 'reconciliation_delta':
      return 'Bon war schwer lesbar — bitte neu scannen.';
    case 'process_error':
    case 'pubsub_publish_failed':
      return 'Hat nicht geklappt — bitte noch mal scannen.';
    default:
      return 'Bon nicht lesbar — tippe unter „Meine Bons" für Details.';
  }
}

const CASHBACK_TERMINAL = ['approved', 'paid', 'rejected', 'no_reward'];

// ─── GamificationContext ─────────────────────────────────────────
//
// Ermöglicht Catalog-Pages (achievements.tsx) den Banner für
// Preview-Taps zu zeigen. Die Auto-Trigger laufen weiterhin über
// die achievementService-Callbacks (registriert im Provider unten).
interface GamificationContextValue {
  /** Manuell einen Banner anzeigen — z.B. Catalog-Preview-Tap. */
  showBanner: (data: BannerData) => void;
}

const GamificationContext = createContext<GamificationContextValue | null>(null);

export function useGamification(): GamificationContextValue {
  const ctx = useContext(GamificationContext);
  if (!ctx) {
    throw new Error('useGamification must be used within GamificationProvider');
  }
  return ctx;
}

interface GamificationProviderProps {
  children: React.ReactNode;
}

/**
 * Zentraler Provider für alle Gamification-Banner und Toasts.
 *
 * Architektur (post-Tier-Cleanup):
 *   • ALLE Achievement-Unlocks und Level-Ups gehen durch den
 *     AchievementUnlockBanner — kein Konfetti-Modal mehr für "major"-
 *     Events. Visuell konsistent.
 *   • Punkte- und Streak-Toasts laufen über die zentrale
 *     Toast-Library (lib/services/ui/toast.tsx).
 *   • Walkthrough-Active: Banner und Toasts werden gequeued und nach
 *     Tour-Ende drainiert, sonst gehen sie unter dem Backdrop unter.
 */
export const GamificationProvider: React.FC<GamificationProviderProps> = ({ children }) => {
  const colorScheme = useColorScheme();
  const { user } = useAuth();
  void user;

  // Banner-State + Pending-Queue (für Walkthrough-Konflikt).
  const [bannerData, setBannerData] = useState<BannerData | null>(null);
  // Banner-Queue (86ca8h…): Banner laufen SEQUENZIELL, einer nach dem anderen.
  // WICHTIG: `bannerShowingRef` wird SYNCHRON gesetzt (nicht per useEffect) —
  // sonst racen Banner, die im selben Tick feuern (z.B. mehrere Achievements,
  // die eine einzige Aktion freischaltet) und ersetzen sich gegenseitig.
  // `bannerQueueRef` hält die wartenden Banner (FIFO, dedupt, gedeckelt).
  const bannerQueueRef = useRef<BannerData[]>([]);
  const bannerShowingRef = useRef(false);
  const currentBannerKeyRef = useRef<string | null>(null);
  const BANNER_QUEUE_MAX = 4;
  const bannerKey = (b: BannerData) => `${b.title}|${b.subtitle}`;

  // Banner zeigen ODER hinten anstellen — komplett synchron entschieden, ohne
  // bannerData-State zu lesen (sonst stale closure in den setTimeout/async-
  // Handlern). Refs sind immer aktuell, auch im selben Tick.
  const presentBanner = useCallback((data: BannerData) => {
    const k = bannerKey(data);
    // Dedupe: identischer Banner läuft gerade ODER steht schon in der Queue.
    if (bannerShowingRef.current && currentBannerKeyRef.current === k) return;
    if (bannerQueueRef.current.some((b) => bannerKey(b) === k)) return;
    // Walkthrough läuft ODER ein Banner ist offen → hinten anstellen.
    if (CoachmarkService.isAnyActive() || bannerShowingRef.current) {
      if (bannerQueueRef.current.length < BANNER_QUEUE_MAX) bannerQueueRef.current.push(data);
      return;
    }
    bannerShowingRef.current = true; // synchron → kein Same-Tick-Race
    currentBannerKeyRef.current = k;
    setBannerData(data);
  }, []);

  // Nächsten Banner aus der Queue zeigen, sofern frei + kein Walkthrough.
  const maybeShowNextBanner = useCallback(() => {
    if (CoachmarkService.isAnyActive()) return;
    if (bannerShowingRef.current) return;
    const next = bannerQueueRef.current.shift();
    if (!next) return;
    bannerShowingRef.current = true;
    currentBannerKeyRef.current = bannerKey(next);
    setBannerData(next);
  }, []);

  // Banner dismisst → Slot freigeben + nach kurzer Pause den nächsten zeigen.
  const dismissBanner = useCallback(() => {
    bannerShowingRef.current = false;
    currentBannerKeyRef.current = null;
    setBannerData(null);
    setTimeout(maybeShowNextBanner, 350);
  }, [maybeShowNextBanner]);

  // 📱 App Rating Modal State
  const [showAppRatingModal, setShowAppRatingModal] = useState(false);

  // Pending-Queues für Toasts (Walkthrough-Active → drainen nach Ende).
  const [pendingPointsToasts, setPendingPointsToasts] = useState<
    Array<{ points: number; message: string }>
  >([]);
  const [pendingStreakToasts, setPendingStreakToasts] = useState<
    Array<{ streakDays: number; bonusPoints?: number }>
  >([]);

  // ─── Walkthrough-Active Tracking ──────────────────────────────
  //
  // Wenn ein Walkthrough sichtbar ist, sollen ALLE Gamification-
  // Notifications (Banner, Toasts) NICHT parallel feuern, sondern
  // queuen und nach Tour-Ende abarbeiten. Sonst gehen sie unter dem
  // Tour-Backdrop unter.
  const [walkthroughActive, setWalkthroughActive] = useState(false);
  useEffect(() => {
    const off = CoachmarkService.onActivityChange((any) => {
      setWalkthroughActive(any);
    });
    return off;
  }, []);

  // ─── "Erster Fall geschlossen" → nativer Review ────────────────
  //
  // ZWEI PHASEN (ClickUp 86cav7gqm), damit die Reihenfolge
  // "erst Feier, dann Frage" strukturell garantiert ist:
  //
  //   PHASE 1  tryCelebrateFirstCase: sobald Erst-Erfolg UND
  //            Walk-Through vorliegen, zeigt der Provider EINE eigene
  //            Glückwunsch-Feier (bannerDataFromFirstCase) über
  //            presentBanner — die reiht sich in die normale
  //            Banner-Queue ein, kommt also nach etwaigen anderen
  //            Feiern und wird während einer Tour gequeued.
  //   PHASE 2  trySettleFirstCase: fragt den nativen Dialog an,
  //            sobald nichts mehr läuft. Läuft NUR, wenn Phase 1 die
  //            Sequenz gestartet hat (firstCaseAwaitingReviewRef) —
  //            deshalb kann der Dialog nie kontextfrei erscheinen.
  //
  // WARUM NICHT AM ACHIEVEMENT-BANNER: das `first_action_any`-
  // Achievement ist im Standard-Funnel schon vom Walkthrough-Demo-Tap
  // verbraucht (Demo-Karte → Produktseite → trackAction), also lange
  // vor dem ersten eigenen Scan — dort hätte die Feier gefehlt.
  //
  // DER TIMER WARTET AUF NICHTS (das wäre das verbotene Time-based
  // Debouncing): er terminiert nur eine RE-EVALUIERUNG. Die
  // Entscheidung fällt ausschließlich über synchron gelesene Refs/
  // States. Zu früh gefeuert ⇒ Gate greift, nichts wird verbraucht,
  // die nächste Kante versucht es erneut. Zu JEDEM Gate gibt es eine
  // Gegenkante (Banner, Tour, Modal, Arm-Bus, AppState) — sonst bliebe
  // ein geblockter Versuch für immer liegen.
  //
  // BEWUSSTE GRENZE: wird die App zwischen Feier und Dialog gekillt,
  // ist die Erst-Fall-Chance verbraucht (celebratedAt ist gesetzt, die
  // Sequenz-Ref lebt nur in der Session). Alternative wäre ein
  // kontextfreier Prompt beim nächsten Start — genau davor warnen die
  // Store-Guidelines. Zweite Chance bleibt der Level-Up-Pfad.
  const [firstCaseTick, setFirstCaseTick] = useState(0);
  const bumpFirstCaseTick = useCallback(() => setFirstCaseTick((n) => n + 1), []);

  // Kanten, die eine Re-Evaluierung auslösen:
  //  • Erst-Erfolg frisch verbucht (Bus)
  //  • App kommt in den Vordergrund (AppState-Gate war sonst blind)
  // Die übrigen Kanten liefern die Effect-Deps unten (Banner, Tour,
  // Rating-Modal). Wichtig ist, dass es zu JEDEM Gate eine Gegenkante
  // gibt — sonst bleibt ein geblockter Versuch für immer liegen.
  useEffect(() => FirstCaseService.onArmed(bumpFirstCaseTick), [bumpFirstCaseTick]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') bumpFirstCaseTick();
    });
    return () => sub.remove();
  }, [bumpFirstCaseTick]);
  // Gegenkante zum Sheet-/Umfrage-Gate in Phase 2. Ohne sie haengt die
  // Re-Evaluierung daran, dass zufaellig ein weiterer Banner kommt: die
  // Umfrage laeuft nach JEDER Aktion, ist fuer isAnySheetOpen() aber
  // unsichtbar, faellt also genau mit dem Erst-Fall-Moment zusammen.
  useEffect(() => onPresentationIdle(bumpFirstCaseTick), [bumpFirstCaseTick]);

  // Läuft die Feier→Review-Sequenz? Wird gesetzt, sobald die Feier
  // präsentiert/eingereiht ist, und ist die BEDINGUNG dafür, dass
  // überhaupt ein Review-Versuch stattfindet. Damit kann der Dialog
  // niemals kontextfrei erscheinen (z.B. beim Kaltstart auf Home) —
  // ohne diese Ref wäre jeder Mount eine gültige "Ruhe-Kante".
  const firstCaseAwaitingReviewRef = useRef(false);
  const firstCaseCelebrateBusyRef = useRef(false);
  // Steht gerade UNSERE eigene Erst-Fall-Feier auf dem Schirm? Nur dann
  // darf Phase 2 laufen, obwohl ein Banner sichtbar ist — bei jedem
  // anderen Banner bleibt es beim Warten auf die Ruhe-Kante.
  const firstCaseBannerVisibleRef = useRef(false);
  // Trigger-Art + Level aus Phase 1 für die Telemetrie in Phase 2 halten.
  // Ohne das ließe sich in der Auswertung nicht trennen, ob ein Prompt bei
  // einem Neu- oder einem Bestandsnutzer hängenblieb — und genau daran
  // hängt die Frage, ob wir die Bestandsbasis überhaupt erreichen.
  const firstCaseTriggerRef = useRef<'first_case' | 'veteran_case'>('first_case');
  const firstCaseLevelRef = useRef<number | undefined>(undefined);

  /** PHASE 1: Feier zeigen, sobald Erst-Erfolg UND Walk-Through da sind. */
  const tryCelebrateFirstCase = useCallback(async () => {
    const uid = user?.uid;
    if (!uid) return;
    if (firstCaseAwaitingReviewRef.current) return; // Sequenz läuft schon
    if (firstCaseCelebrateBusyRef.current) return; // synchroner Guard
    firstCaseCelebrateBusyRef.current = true;
    try {
      if (!(await FirstCaseService.shouldCelebrate(uid))) return;
      // Verbuchen BEVOR wir zeigen — die Feier ist einmalig, und ein
      // Doppel-Banner wäre schlimmer als ein verlorener Banner.
      await FirstCaseService.markCelebrated(uid);
      firstCaseAwaitingReviewRef.current = true;

      const notificationsDisabled =
        await gamificationSettingsService.areNotificationsDisabled();
      if (notificationsDisabled) {
        // Für diese User gibt es bewusst KEINE Feier. Der Review folgt
        // trotzdem am nächsten Ruhe-Punkt — das ist Absicht, kein Bug.
        console.log('🔕 Erster-Fall-Feier unterdrückt (Spielerische Inhalte aus)');
      } else {
        // Bestandsnutzer (Level ≥ 3) bekommen denselben Mechanismus, aber
        // ehrlichen Text — für sie ist es NICHT der erste Fall. Der Level-
        // Read darf die Feier nicht gefährden: schlägt er fehl, bleibt es
        // beim bisherigen Verhalten (Erst-Fall-Text).
        let level = 0;
        try {
          level = Number((await achievementService.getUserStats(uid))?.currentLevel) || 0;
        } catch (e) {
          console.warn('Level-Read für Feier-Text fehlgeschlagen (non-fatal):', e);
        }
        // presentBanner reiht sich korrekt ein (Walkthrough aktiv oder
        // anderer Banner offen → Queue) — dadurch kommt unsere Feier
        // garantiert NACH etwaigen anderen Feiern.
        // Text nach dem, was der Nutzer WIRKLICH vor sich hat: die
        // gesehene Stufe entscheidet über „Fall gelöst" vs. „Produkt
        // gefunden", der versions-übergreifende Feier-Zähler über
        // „Erster …" vs. Wiederholung. Die alte Weiche hing am Level
        // (≥ 3) und deckte damit nur ~7 % der Nutzer ab — alle anderen
        // hätten bei jedem Release wieder „Erster Fall" gelesen.
        const ctx = await FirstCaseService.getCelebrationContext(uid);
        firstCaseTriggerRef.current = ctx.everCelebrated ? 'veteran_case' : 'first_case';
        firstCaseLevelRef.current = level || undefined;
        presentBanner(
          bannerDataFromCase({
            stufe: ctx.stufe,
            everCelebrated: ctx.everCelebrated,
            level,
          }),
        );
      }
      // Frische Kante für Phase 2 erzwingen: das Setzen einer Ref löst
      // keinen Re-Render aus, und im unterdrückten Fall gibt es auch
      // keine bannerData-Änderung, die den Settle-Effect neu anstößt.
      bumpFirstCaseTick();
    } catch (e) {
      console.warn('First-case celebration failed (non-fatal):', e);
    } finally {
      firstCaseCelebrateBusyRef.current = false;
    }
  }, [user?.uid, presentBanner, bumpFirstCaseTick]);

  useEffect(() => {
    if (walkthroughActive) return; // Tour läuft → nach ihrem Ende erneut
    void tryCelebrateFirstCase();
  }, [firstCaseTick, walkthroughActive, tryCelebrateFirstCase]);

  /** PHASE 2: nach der Feier den nativen Dialog anfragen. */
  const trySettleFirstCase = useCallback(() => {
    if (!firstCaseAwaitingReviewRef.current) return;
    // Refs sind die einzigen synchron aktuellen Quellen (bannerData als
    // State kann im selben Tick veraltet sein) — insbesondere deckt
    // `bannerQueueRef` den Fall ab, dass noch ein Banner WARTET.
    // Ausnahme: unsere EIGENE Feier darf stehen bleiben — der Dialog soll
    // ja genau dann kommen, während der Erfolg noch sichtbar ist.
    if (bannerShowingRef.current && !firstCaseBannerVisibleRef.current) return;
    if (bannerQueueRef.current.length > 0) return;
    if (CoachmarkService.isAnyActive()) return;
    if (isAnySheetOpen() || isSurveyVisible()) return;
    if (AppState.currentState !== 'active') return;
    void FirstCaseService.maybeRequestReview(
      user?.uid,
      firstCaseTriggerRef.current,
      firstCaseLevelRef.current,
    ).then((outcome) => {
      if (outcome === 'requested' || outcome === 'already' || outcome === 'gated') {
        // Sequenz abgeschlossen bzw. endgültig gegated → nicht weiter
        // versuchen. 'unavailable'/'busy' bleiben offen für die nächste
        // Kante (Sheet zu, App wieder aktiv …).
        firstCaseAwaitingReviewRef.current = false;
      }
      if (outcome === 'requested') {
        console.log('⭐ Erster Fall — nativer Review angefragt');
      }
    });
  }, [user?.uid]);

  // SCHNELLPFAD: sobald unsere eigene Feier sichtbar ist, den Dialog nach
  // FIRST_CASE_PROMPT_AFTER_BANNER_MS anfragen — noch während der Banner
  // steht. Der Timer haengt an `bannerData`, nicht am presentBanner-Aufruf:
  // presentBanner kann den Banner erst EINREIHEN (Walkthrough aktiv, anderer
  // Banner offen), dann waere ein Timer ab Aufruf zu frueh gelaufen.
  useEffect(() => {
    const own = bannerData?.kind === 'firstCase';
    firstCaseBannerVisibleRef.current = own;
    if (!own) return;
    const t = setTimeout(trySettleFirstCase, FIRST_CASE_PROMPT_AFTER_BANNER_MS);
    return () => clearTimeout(t);
  }, [bannerData, trySettleFirstCase]);

  // Ruhe-Kanten für Phase 2: Banner weg, Walkthrough zu Ende, Rating-
  // Modal zu, Tick (Arm / App wieder im Vordergrund). Bleibt als
  // Rückfallebene bestehen — z.B. wenn der User die Feier vorher
  // wegwischt oder sie (Spielerische Inhalte aus) gar nicht kommt.
  useEffect(() => {
    if (bannerData !== null) return;
    if (walkthroughActive) return;
    if (showAppRatingModal) return;
    const t = setTimeout(trySettleFirstCase, FIRST_CASE_SETTLE_DELAY_MS);
    return () => clearTimeout(t);
  }, [bannerData, walkthroughActive, showAppRatingModal, firstCaseTick, trySettleFirstCase]);

  // ─── Auto-Trigger-Handler ────────────────────────────────────
  //
  // Achievement-Unlock und Level-Up routen IMMER zum Banner.
  // 1.5 s Defer damit Detail-Mounts nicht direkt von einer
  // Reward-Animation überlagert werden — der User soll erst Inhalte
  // aufnehmen können bevor Feedback kommt.

  const achievementHandler = useCallback(async (achievement: Achievement) => {
    console.log('🏆 Achievement Unlock UI triggered:', achievement.name);

    const notificationsDisabled =
      await gamificationSettingsService.areNotificationsDisabled();
    if (notificationsDisabled) {
      console.log('🔕 Achievement-UI unterdrückt (Spielerische Inhalte deaktiviert)');
      return;
    }

    // „Es geht los!" (+5 Punkte) NICHT zeigen, wenn die „Erster Fall
    // geschlossen"-Feier denselben Moment traegt — sie sagt dasselbe,
    // nur staerker. Sonst laufen beim ersten Fall DREI Banner
    // hintereinander (Achievement + Level 2 + Feier), zusammen ~20 s;
    // der User sieht die Meldungen dann als „zu spaet".
    // Die PUNKTE werden normal vergeben, nur der Banner entfaellt.
    if (achievement.trigger?.action === 'first_action_any') {
      try {
        if (await FirstCaseService.willCelebrate(user?.uid)) {
          console.log('🎖️ first_action_any-Banner unterdrückt — Erster-Fall-Feier übernimmt');
          return;
        }
      } catch {
        /* im Zweifel normal zeigen */
      }
    }

    const data = bannerDataFromAchievement(achievement);
    // presentBanner entscheidet synchron Zeigen-vs-Queue (race-frei auch bei
    // mehreren Achievements, die EINE Aktion gleichzeitig freischaltet).
    setTimeout(() => presentBanner(data), 1500);
  }, [presentBanner, user?.uid]);

  const pointsHandler = useCallback(async (points: number, action: string, message: string) => {
    if (points <= 0) return;
    void action;
    const notificationsDisabled = await gamificationSettingsService.areNotificationsDisabled();
    if (notificationsDisabled) {
      console.log('🔕 Punkte Toast unterdrückt (Spielerische Inhalte deaktiviert)');
      return;
    }
    if (CoachmarkService.isAnyActive()) {
      console.log('🎯 Punkte-Toast queued — Walkthrough läuft');
      setPendingPointsToasts((prev) => [...prev, { points, message }]);
      return;
    }
    showPointsToast(message, points, colorScheme || 'light');
  }, [colorScheme]);

  const levelUpHandler = useCallback(async (
    newLevel: number,
    oldLevel: number,
    unlockedCategory?: { id: string; name: string; imageUrl: string },
  ) => {
    console.log(`🎯 Level-Up UI triggered: ${oldLevel} → ${newLevel}`);
    if (unlockedCategory) {
      console.log(`🎁 Mit freigeschalteter Kategorie: ${unlockedCategory.name}`);
    }

    const notificationsDisabled =
      await gamificationSettingsService.areNotificationsDisabled();
    if (notificationsDisabled) {
      console.log('🔕 Level-Up UI unterdrückt (Spielerische Inhalte deaktiviert)');
      return;
    }

    const data = bannerDataFromLevelUp(newLevel, oldLevel, unlockedCategory);
    setTimeout(() => presentBanner(data), 1500);

    // Rating-Trigger nach Level-Up: ab Level 3 setzen wir den
    // Pending-Rating-Flag, sodass der periodische Check (siehe
    // unten) das App-Rating-Modal nach dem Banner-Schließen anbietet.
    if (newLevel >= 3 && user?.uid) {
      try {
        await ratingPromptService.setPendingRating(user.uid, newLevel);
      } catch (error) {
        console.error('❌ Error setting rating flag:', error);
      }
    }
  }, [user?.uid, presentBanner]);

  // 🔄 Callback-Registrierung beim Mount
  useEffect(() => {
    setAchievementUnlockHandler(achievementHandler);
    setPointsEarnedHandler(pointsHandler);
    setLevelUpHandler(levelUpHandler);
    ratingPromptService.setRatingModalHandler(setShowAppRatingModal);
    return () => {
      setAchievementUnlockHandler(null);
      setPointsEarnedHandler(null);
      setLevelUpHandler(null);
      ratingPromptService.setRatingModalHandler(() => {});
    };
  }, [achievementHandler, pointsHandler, levelUpHandler]);

  // 🎖️ Banner-Suppression beim Walkthrough-Open: ziehe einen sichtbaren
  // Banner zurück und stell ihn VORNE in die Queue (kommt nach dem
  // Walkthrough zuerst wieder). Refs synchron freigeben.
  useEffect(() => {
    if (walkthroughActive && bannerData) {
      console.log('🎖️ Walkthrough öffnet — aktiver Banner geht in Queue');
      bannerQueueRef.current.unshift(bannerData);
      bannerShowingRef.current = false;
      currentBannerKeyRef.current = null;
      setBannerData(null);
    }
  }, [bannerData, walkthroughActive]);

  // 🎖️ Banner-Drain nach Walkthrough-Close: zeigt den nächsten gequeueten
  // Banner. (Der Drain nach einem normalen Dismiss läuft über dismissBanner.)
  useEffect(() => {
    if (walkthroughActive) return;
    const t = setTimeout(maybeShowNextBanner, 400);
    return () => clearTimeout(t);
  }, [walkthroughActive, maybeShowNextBanner]);

  // 🟡 Pending Punkte/Streak-Toasts-Drain bei Walkthrough-Ende.
  useEffect(() => {
    if (walkthroughActive) return;
    if (pendingPointsToasts.length === 0) return;
    const queue = pendingPointsToasts;
    setPendingPointsToasts([]);
    queue.forEach((t, idx) => {
      setTimeout(() => {
        showPointsToast(t.message, t.points, colorScheme || 'light');
      }, 300 + idx * 200);
    });
  }, [walkthroughActive, pendingPointsToasts, colorScheme]);

  useEffect(() => {
    if (walkthroughActive) return;
    if (pendingStreakToasts.length === 0) return;
    const queue = pendingStreakToasts;
    setPendingStreakToasts([]);
    queue.forEach((t, idx) => {
      setTimeout(() => {
        showStreakToastNew(t.streakDays, t.bonusPoints, colorScheme || 'light');
      }, 600 + idx * 200);
    });
  }, [walkthroughActive, pendingStreakToasts, colorScheme]);

  // 📱 Periodic check for pending rating — pause während Banner
  // sichtbar ist, sonst öffnet das Rating-Modal genau in den 7 s
  // in denen der Banner up ist.
  useEffect(() => {
    let checkCount = 0;
    const checkInterval = setInterval(async () => {
      // walkthroughActive mit prüfen: sonst platzt der Level-Up-Prompt
      // mitten in eine laufende Tour (bisher prüfte das niemand).
      if (showAppRatingModal || bannerData !== null || walkthroughActive) {
        return;
      }
      checkCount++;
      try {
        await ratingPromptService.checkAndShowPendingRating();
      } catch (error) {
        console.error('❌ Periodic rating check error:', error);
      }
    }, RATING_POLL_INTERVAL_MS);
    return () => {
      clearInterval(checkInterval);
    };
  }, [showAppRatingModal, bannerData, walkthroughActive]);

  // ─── Public Streak-Toast (ggf. via global) ──────────────────
  //
  // Funktion zum manuellen Anzeigen der Streak Toast (z.B. von
  // achievementService oder direkt aus Pages). Geht durch dieselbe
  // Walkthrough-Queue-Logik.
  const showStreakToast = useCallback((streakDays: number, bonusPoints?: number) => {
    console.log(`🔥 Streak Toast triggered: ${streakDays} Tage (${bonusPoints || 0} Punkte)`);
    if (CoachmarkService.isAnyActive()) {
      console.log('🎯 Streak-Toast queued — Walkthrough läuft');
      setPendingStreakToasts((prev) => [...prev, { streakDays, bonusPoints }]);
      return;
    }
    showStreakToastNew(streakDays, bonusPoints, colorScheme || 'light');
  }, [colorScheme]);

  // Expose showStreakToast globally für einfachen Zugriff von Services.
  useEffect(() => {
    (global as any).showStreakToast = showStreakToast;
    return () => {
      delete (global as any).showStreakToast;
    };
  }, [showStreakToast]);

  // ─── Public showBanner für Catalog-Previews ──────────────────
  //
  // Wird über useGamification() konsumiert. Zeigt direkt einen
  // Banner ohne 1.5 s Defer (User hat ja gerade aktiv getapped),
  // respektiert aber die Walkthrough-Queue.
  const showBanner = useCallback(
    (data: BannerData) => {
      // Geht durch dieselbe synchrone Queue wie alle Banner — kein Ersetzen
      // eines offenen Banners (86ca8h…).
      presentBanner(data);
    },
    [presentBanner],
  );

  // ─── Globaler Cashback-Status-Watcher ───────────────────────────
  //
  // Feuert Genehmigungs-Banner (mit EdgeGlow) + Ablehnungs-Toast GLOBAL,
  // egal auf welchem Screen der User gerade ist — der pending/[id]-Screen
  // muss dafür NICHT gemountet sein (Bug-Fix 86ca1xx90: vorher kam nichts
  // wenn man weg navigierte). Nur LIVE-Transitionen feiern: erster
  // Snapshot = Baseline (kein Feuern für bereits-terminale Bons beim
  // App-Start). Ein Bon feuert nur, wenn er aus einem NICHT-terminalen
  // Zustand (uploading/pending/review) heraus kippt.
  const cashbackSeenRef = useRef<Map<string, string>>(new Map());
  const cashbackBaselineRef = useRef(false);
  useEffect(() => {
    if (!user?.uid) {
      cashbackSeenRef.current = new Map();
      cashbackBaselineRef.current = false;
      return;
    }
    const seen = new Map<string, string>();
    cashbackSeenRef.current = seen;
    cashbackBaselineRef.current = false;

    const unsub = subscribeUserCashbackHistoryPaged(15, (entries) => {
      if (!cashbackBaselineRef.current) {
        entries.forEach((e) => {
          if (e.status) seen.set(e.id, e.status);
        });
        cashbackBaselineRef.current = true;
        return;
      }
      entries.forEach((e) => {
        const cur = e.status;
        if (!cur) return;
        const prev = seen.get(e.id);
        if (prev === cur) return;
        seen.set(e.id, cur);
        // Nur echte Transition aus einem nicht-terminalen Zustand feiern.
        if (prev === undefined || CASHBACK_TERMINAL.includes(prev)) return;

        if (cur === 'approved' || cur === 'paid') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          showBanner(bannerDataFromCashbackPayout(e.cashbackCents ?? 0));
        } else if (cur === 'rejected') {
          showInfoToast(cashbackRejectToastMsg(e.rejectReason, (e as any).maxAgeDays), 'error', colorScheme || 'light');
        } else if (cur === 'no_reward') {
          // Reason-aware + positiv (CLAUDE.md: nie Frust). Bei erreichtem
          // Tages-/Wochenlimit klar kommunizieren, dass der Bon trotzdem
          // zählt + wann es wieder Cashback gibt (86ca8hr90).
          const reason = (e as any).rejectReason as string | undefined;
          let msg = 'Bon gespeichert — zählt zu deiner Ausgabenübersicht.';
          if (reason === 'daily_cap_reached') {
            msg = 'Bon gespeichert & zählt zu deiner Übersicht. Heute gab es schon Cashback — morgen gibt es wieder etwas obendrauf.';
          } else if (reason === 'weekly_cap_reached') {
            msg = 'Bon gespeichert & zählt zu deiner Übersicht. Dein Cashback-Limit dieser Woche ist erreicht — nächste Woche geht es weiter.';
          }
          showInfoToast(msg, 'info', colorScheme || 'light');
        }
      });
    });
    return () => {
      unsub();
    };
  }, [user?.uid, colorScheme, showBanner]);

  // Context-Value memoisiert — sonst wird auf JEDEM Provider-Render
  // ein neues Object erstellt → alle useGamification()-Consumer
  // re-rendern unnötig. showBanner ist via useCallback eh stable.
  const ctxValue = useMemo(() => ({ showBanner }), [showBanner]);

  return (
    <GamificationContext.Provider value={ctxValue}>
      {children}

      {/* Banner LAZY und nur conditional gemountet:
          - Wenn bannerData null ist → keine Komponente mounted, KEIN
            Skia-Import, KEIN EdgeGlow-Bootstrap.
          - Erst wenn ein echter Banner getriggert wird, lädt React
            das Modul (Suspense-fallback null während des Imports).
          - Beim Dismiss (setBannerData(null)) bleibt das Modul im
            Memory-Cache, ist also schon warm beim nächsten Banner.
          Effekt: App-Cold-Start wird leichter, Mid-Memory-Pressure
          weniger Risiko dass das Skia-Init JS-Thread blockiert. */}
      {bannerData ? (
        <Suspense fallback={null}>
          <AchievementUnlockBanner
            visible
            data={bannerData}
            onDismiss={dismissBanner}
          />
        </Suspense>
      ) : null}

      {/* App Rating Modal — Nach Level-Up via ratingPromptService. */}
      <AppRatingModal
        visible={showAppRatingModal}
        onClose={() => setShowAppRatingModal(false)}
      />
    </GamificationContext.Provider>
  );
};
