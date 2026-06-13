import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { FilterSheet } from '@/components/design/FilterSheet';
import { SurveyRunner } from '@/components/survey/SurveyRunner';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { formatCents } from '@/lib/types/cashback';
import {
  buildUserContext,
  submitResponse,
  markDismissed,
} from '@/lib/services/surveyService';
import { setSurveyPrompter } from '@/lib/services/surveyPromptBus';
import { showInfoToast } from '@/lib/services/ui/toast';
import type { Poll, PollAnswer } from '@/lib/types/survey';

/**
 * SurveyProvider (ClickUp 86ca8fbpz) — app-weiter Mount-Punkt für das
 * Umfrage-Sheet. Stellt `showSurvey(poll)` bereit (allgemeine Liste im
 * Rewards-Tab) UND registriert sich am surveyPromptBus, damit
 * action-getriggerte Umfragen nach einer Action automatisch erscheinen.
 *
 * Ein FilterSheet app-weit (analog GamificationProvider/Banner) — kein
 * Sheet pro Screen. Antwort → submitResponse (fire-and-forget Write +
 * lokales answered-Flag); Reward kommt server-seitig (CF survey-reward).
 */

interface SurveyContextValue {
  /** Öffnet das Umfrage-Sheet mit einer konkreten Umfrage. */
  showSurvey: (poll: Poll) => void;
}

const SurveyContext = createContext<SurveyContextValue>({ showSurvey: () => {} });

export function useSurvey(): SurveyContextValue {
  return useContext(SurveyContext);
}

export function SurveyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const scheme = useColorScheme() ?? 'light';

  const [poll, setPoll] = useState<Poll | null>(null);
  const [visible, setVisible] = useState(false);
  const startedAtRef = useRef(0);
  // true, sobald für die aktuelle Umfrage submit lief — verhindert dass
  // das Schließen-nach-Submit als "Dismiss" (Cooldown) gewertet wird.
  const completedRef = useRef(false);

  const showSurvey = useCallback((p: Poll) => {
    setPoll(p);
    startedAtRef.current = Date.now();
    completedRef.current = false;
    setVisible(true);
  }, []);

  // Am Bus registrieren (Action-getriggerte Umfragen).
  useEffect(() => {
    setSurveyPrompter(showSurvey);
    return () => setSurveyPrompter(null);
  }, [showSurvey]);

  const handleComplete = useCallback(
    async (answers: PollAnswer[]) => {
      const p = poll;
      const uid = user?.uid;
      if (!p || !uid) {
        setVisible(false);
        return;
      }
      completedRef.current = true;
      // Sheet sofort schließen (UI), Submit läuft fire-and-forget.
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
      const reward =
        typeof p.rewardCents === 'number' && p.rewardCents > 0
          ? ` ${formatCents(p.rewardCents)} Taler sind unterwegs.`
          : '';
      showInfoToast(`Danke für deine Antwort!${reward}`, 'info', scheme);
    },
    [poll, user?.uid, scheme],
  );

  const handleClose = useCallback(() => {
    // Schließen OHNE Abschluss = Dismiss → Cooldown setzen (nicht sofort
    // wieder anbieten). Nach Submit NICHT (completedRef).
    if (poll && !completedRef.current) {
      void markDismissed(poll.id);
    }
    setVisible(false);
  }, [poll]);

  return (
    <SurveyContext.Provider value={{ showSurvey }}>
      {children}
      <FilterSheet
        visible={visible}
        title={poll?.title ?? 'Umfrage'}
        onClose={handleClose}
      >
        {poll ? <SurveyRunner poll={poll} onComplete={handleComplete} /> : null}
      </FilterSheet>
    </SurveyContext.Provider>
  );
}
