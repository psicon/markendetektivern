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
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useCashbackUserState } from '@/lib/hooks/useCashbackUserState';
import { formatCents } from '@/lib/types/cashback';
import {
  buildUserContext,
  submitResponse,
  markDismissed,
  snoozeActionSurveysToday,
} from '@/lib/services/surveyService';
import { setSurveyPrompter } from '@/lib/services/surveyPromptBus';
import { showInfoToast, showSurveyHintToast } from '@/lib/services/ui/toast';
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
  const { hasConsent } = useCashbackUserState();
  const scheme = useColorScheme() ?? 'light';
  const { theme } = useTokens();
  // Cashback gibt's NUR für registrierte User mit aktivem Markt-Consent.
  // Der Reward-Toast darf sonst nichts versprechen (kein "X Taler unterwegs"-Lügen).
  const cashbackEligible = !isAnonymous && hasConsent;

  const [poll, setPoll] = useState<Poll | null>(null);
  const [visible, setVisible] = useState(false);
  const [activityNonce, setActivityNonce] = useState(0);
  const startedAtRef = useRef(0);
  const completedRef = useRef(false);

  // Öffnet das Sheet direkt (general-Liste + Hint-Tap + immediate-Action).
  const showSurvey = useCallback((p: Poll) => {
    setPoll(p);
    startedAtRef.current = Date.now();
    completedRef.current = false;
    setVisible(true);
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
      try {
        const ctx = await buildUserContext(uid);
        await submitResponse({
          poll: p,
          uid,
          answers,
          startedAtMs: startedAtRef.current || Date.now(),
          ctx,
        });
      } catch (e) {
        console.warn('[survey] submit failed', (e as Error)?.message);
      }
      // Reward-Text NUR wenn der User wirklich Cashback bekommt
      // (registriert + Consent) UND die Umfrage vergütet. Sonst ehrlich
      // danken + positiv auf Cashback hinweisen (kein Frust-Ton).
      const pays =
        (p.rewardTrigger ?? 'completion') !== 'none' &&
        typeof p.rewardCents === 'number' &&
        p.rewardCents > 0;
      let msg: string;
      if (pays && cashbackEligible) {
        msg = `Danke für deine Antwort! ${formatCents(p.rewardCents!)} Taler sind unterwegs.`;
      } else if (pays && !cashbackEligible) {
        msg = `Danke für deine Antwort! Mit aktiviertem Cashback gäbe es dafür ${formatCents(p.rewardCents!)} Taler.`;
      } else {
        msg = 'Danke für deine Antwort!';
      }
      showInfoToast(msg, 'info', scheme);
      setActivityNonce((n) => n + 1); // Tile-Liste neu laden
    },
    [poll, user?.uid, scheme, cashbackEligible],
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
