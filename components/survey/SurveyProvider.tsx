import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Pressable, Text, View } from 'react-native';

import { FilterSheet } from '@/components/design/FilterSheet';
import { SurveyRunner } from '@/components/survey/SurveyRunner';
import {
  bannerDataFromCashbackPayout,
  useGamification,
} from '@/components/ui/GamificationProvider';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { router } from 'expo-router';

import { useAuth } from '@/lib/contexts/AuthContext';
import { hasValidCashbackConsent } from '@/lib/services/cashbackService';
import { formatCents } from '@/lib/types/cashback';
import {
  buildUserContext,
  submitResponse,
  markDismissed,
  snoozeActionSurveysToday,
} from '@/lib/services/surveyService';
import { setSurveyPrompter } from '@/lib/services/surveyPromptBus';
import { isAnySheetOpen, whenSheetsIdle } from '@/lib/services/sheetPresence';
import {
  showCashbackNudgeToast,
  showInfoToast,
  showSurveyHintToast,
} from '@/lib/services/ui/toast';
import { pollTriggerOf, type Poll, type PollAnswer } from '@/lib/types/survey';

/**
 * SurveyProvider (ClickUp 86ca8fbpz) — app-weiter Mount-Punkt für das
 * Umfrage-Sheet. Stellt `showSurvey(poll)` bereit (allgemeine Liste im
 * Rewards-Tab) UND registriert sich am surveyPromptBus für action-
 * getriggerte Umfragen.
 *
 * Action-Anzeige (User-Vorgabe): `actionDisplay` am Poll steuert, ob die
 * Umfrage nach der Aktion SOFORT als Sheet kommt ('immediate') oder als
 * dezenter, antippbarer Hinweis mit Verdienst-Möglichkeit ('hint'). Im
 * Sheet einer action-getriggerten Umfrage gibt es zudem "Heute keine
 * Vorschläge mehr" (Stummschaltung bis Mitternacht).
 *
 * Antwort → submitResponse (fire-and-forget Write + lokales answered-
 * Flag); Reward kommt server-seitig (CF survey-reward).
 */

interface SurveyContextValue {
  /** Öffnet das Umfrage-Sheet mit einer konkreten Umfrage. */
  showSurvey: (poll: Poll) => void;
  /** Bumpt bei jedem Schließen/Abschluss — Konsumenten (Rewards-Tile)
   *  laden ihre Umfrage-Liste neu, damit beantwortete verschwinden. */
  activityNonce: number;
}

const SurveyContext = createContext<SurveyContextValue>({
  showSurvey: () => {},
  activityNonce: 0,
});

export function useSurvey(): SurveyContextValue {
  return useContext(SurveyContext);
}

export function SurveyProvider({ children }: { children: React.ReactNode }) {
  const { user, isAnonymous } = useAuth();
  const scheme = useColorScheme() ?? 'light';
  const { theme } = useTokens();
  // Cashback-Gutschrift-Feier (Glow-Banner) — wie bei Bons. Für berechtigte
  // Umfragen statt grauem Mini-Toast (ClickUp 86ca8hqt8).
  const { showBanner } = useGamification();

  // Button "Zum Cashback" (ClickUp 86ca8gc8r): führt zur Cashback-
  // Aktivierung — Rewards-Tab als Basis, dann Consent-Screen (from=settings
  // → nach Accept zurück auf Rewards). Walkthrough wird NICHT übersteuert,
  // wir navigieren nur. router.push (nicht safePush) für die 2-Schritt-Nav,
  // sonst dropt der 600-ms-Debounce den zweiten Push.
  const goToCashback = useCallback(() => {
    // NUR EINE Navigation (86ca8hnmb): vorher wurde erst der Rewards-Tab UND
    // dann der Consent gepusht — der Rewards-Screen hat aber selbst einen
    // Auto-Consent-Prompt beim Erstbesuch → zwei Consent-Screens stapelten
    // sich (Duplikat). Direkt zum Consent; from=rewards landet nach dem
    // Akzeptieren auf Rewards (siehe goAfterConsent), kein Auto-Scanner.
    router.push('/cashback/consent?from=rewards' as any);
  }, []);

  const [poll, setPoll] = useState<Poll | null>(null);
  const [visible, setVisible] = useState(false);
  const [activityNonce, setActivityNonce] = useState(0);
  const startedAtRef = useRef(0);
  const completedRef = useRef(false);

  // Öffnet das Sheet. WICHTIG: niemals ein zweites RN-Modal über einem
  // bereits offenen Sheet präsentieren (RatingsSheet/FilterSheet) — das
  // deadlockt iOS (App-Freeze, 86ca8g2p9). Ist gerade ein anderes Sheet
  // offen, warten wir, bis alle zu sind, + kurzer Puffer für die Dismiss-
  // Animation. Auf normalen Screens (kein Sheet offen) öffnet es sofort.
  const showSurvey = useCallback((p: Poll) => {
    const present = () => {
      setPoll(p);
      startedAtRef.current = Date.now();
      completedRef.current = false;
      setVisible(true);
    };
    if (isAnySheetOpen()) {
      whenSheetsIdle(() => setTimeout(present, 350));
    } else {
      present();
    }
  }, []);

  // Bus-Prompter (action-getriggert): entscheidet Sheet vs. Hinweis.
  const promptFromAction = useCallback(
    (p: Poll) => {
      const display = p.actionDisplay ?? 'immediate';
      if (display === 'hint') {
        const reward =
          typeof p.rewardCents === 'number' && p.rewardCents > 0
            ? ` ${formatCents(p.rewardCents)} verdienen.`
            : '';
        showSurveyHintToast(
          `Kurze Umfrage offen —${reward || ' jetzt mitmachen.'}`,
          () => showSurvey(p),
          scheme,
        );
      } else {
        showSurvey(p);
      }
    },
    [showSurvey, scheme],
  );

  // Am Bus registrieren (Action-getriggerte Umfragen).
  useEffect(() => {
    setSurveyPrompter(promptFromAction);
    return () => setSurveyPrompter(null);
  }, [promptFromAction]);

  const handleComplete = useCallback(
    async (answers: PollAnswer[]) => {
      const p = poll;
      const uid = user?.uid;
      if (!p || !uid) {
        setVisible(false);
        return;
      }
      completedRef.current = true;
      setVisible(false);

      // Cashback-Berechtigung AUTORITATIV + FRISCH bestimmen (ClickUp
      // 86ca8ge7y): NICHT den evtl. veralteten Hook-Wert nehmen, sondern
      // live lesen — exakt die CF-Regel (registriert + gültiger Consent
      // inkl. Versions-Match). Sonst zeigte der Toast "mit aktiviertem
      // Cashback gäbe es…" obwohl Cashback längst aktiv ist.
      let validConsent = false;
      try {
        validConsent = await hasValidCashbackConsent(uid);
      } catch {
        validConsent = false;
      }
      const registered = !isAnonymous;
      const eligible = registered && validConsent;

      try {
        const ctx = await buildUserContext(uid);
        await submitResponse({
          poll: p,
          uid,
          answers,
          startedAtMs: startedAtRef.current || Date.now(),
          ctx,
          // Consent-Markierung am Response-Doc (sammeln, aber markieren).
          marketConsent: validConsent,
          registered,
        });
      } catch (e) {
        console.warn('[survey] submit failed', (e as Error)?.message);
      }

      // Reward-Text NUR wenn die Umfrage vergütet. Berechtigt → "unterwegs".
      // Nicht berechtigt → freundlicher Hinweis MIT "Zum Cashback"-Button
      // (führt zur Aktivierung). Positiver Ton, kein Frust.
      const pays =
        (p.rewardTrigger ?? 'completion') !== 'none' &&
        typeof p.rewardCents === 'number' &&
        p.rewardCents > 0;
      if (pays && eligible) {
        // Berechtigt → dieselbe Cashback-Gutschrift-Feier wie bei Bons:
        // Glow-Banner statt grauem Mini-Toast (ClickUp 86ca8hqt8). Der CF
        // schreibt den Betrag gleich gut → optimistisch sofort feiern.
        showBanner(bannerDataFromCashbackPayout(p.rewardCents!));
      } else if (pays && !eligible) {
        // Betrag ZUERST — der Hinweis-Toast kürzt lange Texte (2 Zeilen +
        // Action-Pille), sonst wird der Betrag abgeschnitten (86ca…).
        showCashbackNudgeToast(
          `${formatCents(p.rewardCents!)} Guthaben gäbe es mit aktiviertem Cashback.`,
          goToCashback,
          scheme,
        );
      } else {
        showInfoToast('Danke für deine Antwort!', 'info', scheme);
      }
      setActivityNonce((n) => n + 1); // Tile-Liste neu laden
    },
    [poll, user?.uid, scheme, isAnonymous, goToCashback, showBanner],
  );

  const handleClose = useCallback(() => {
    // Schließen OHNE Abschluss = Dismiss → Cooldown (nicht sofort wieder).
    if (poll && !completedRef.current) {
      void markDismissed(poll.id);
    }
    setVisible(false);
    setActivityNonce((n) => n + 1);
  }, [poll]);

  // "Heute stumm schalten" — nur bei action-getriggerten Umfragen.
  const handleSnooze = useCallback(() => {
    void snoozeActionSurveysToday();
    completedRef.current = true; // kein Dismiss-Cooldown nötig, Snooze deckt ab
    setVisible(false);
    showInfoToast('Alles klar — heute keine Vorschläge mehr.', 'info', scheme);
  }, [scheme]);

  const isActionPoll = poll ? pollTriggerOf(poll).type === 'action' : false;

  return (
    <SurveyContext.Provider value={{ showSurvey, activityNonce }}>
      {children}
      <FilterSheet
        visible={visible}
        title={poll?.title ?? 'Umfrage'}
        onClose={handleClose}
        registerPresence={false}
      >
        {poll ? (
          <View>
            <SurveyRunner poll={poll} onComplete={handleComplete} />
            {isActionPoll ? (
              <Pressable
                onPress={handleSnooze}
                style={({ pressed }) => ({
                  alignSelf: 'center',
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  marginTop: 6,
                  opacity: pressed ? 0.6 : 1,
                })}
                hitSlop={6}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 13,
                    color: theme.textMuted,
                  }}
                >
                  Heute stumm schalten
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </FilterSheet>
    </SurveyContext.Provider>
  );
}
