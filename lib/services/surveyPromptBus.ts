/**
 * surveyPromptBus — entkoppelt den non-React achievementService von der
 * React-Survey-UI (ClickUp 86ca8fbpz). Der SurveyProvider registriert
 * beim Mount einen Prompter; achievementService.trackAction ruft nach
 * jeder Action `requestActionSurvey` — findet der surveyService eine
 * passende action-getriggerte Umfrage, blendet der Provider sie ein.
 *
 * Eigenes Modul (statt direkt im Provider), damit der Service KEINE
 * React-Komponente importiert (Import-Zyklus + RN-Bridge-Risiko).
 */

import { getActionSurvey, markActionPromptShown } from '@/lib/services/surveyService';
import type { ActionType } from '@/lib/types/achievements';
import type { Poll } from '@/lib/types/survey';

type Prompter = (poll: Poll) => void;

let prompter: Prompter | null = null;

/** Vom SurveyProvider beim Mount registriert (null beim Unmount). */
export function setSurveyPrompter(fn: Prompter | null): void {
  prompter = fn;
}

/**
 * Nach einer App-Action aufrufen (fire-and-forget). Sucht eine passende
 * action-getriggerte Umfrage und blendet sie über den Prompter ein.
 * No-op, wenn kein Prompter aktiv (App noch nicht gemountet) oder keine
 * Umfrage passt / Cooldown greift.
 */
export async function requestActionSurvey(
  uid: string,
  action: ActionType,
): Promise<void> {
  if (!prompter || !uid) return;
  try {
    const poll = await getActionSurvey(uid, action);
    if (poll && prompter) {
      await markActionPromptShown();
      prompter(poll);
    }
  } catch {
    /* fire-and-forget: darf trackAction nie beeinflussen */
  }
}
