/**
 * surveyService — Umfragen laden, eligibility-filtern, beantworten
 * (ClickUp 86ca8fbpz).
 *
 * Datenfluss: liest RevealyIQs `polls` (public-read) direkt, schreibt
 * Antworten nach `poll_responses` (dort wertet RevealyIQ aus). Der
 * Cashback-Reward läuft NICHT hier, sondern server-seitig über die
 * Cloud Function `survey-reward` (onCreate poll_responses) — der Ledger
 * ist client-write-locked, und idempotente Gutschrift gehört auf den
 * Server.
 *
 * Frequency: eine beantwortete Umfrage wird NIE wieder gezeigt
 * (lokales answered-Set, zusätzlich gegen poll_responses absicherbar).
 * Action-getriggerte Prompts haben einen globalen Cooldown (nicht bei
 * jeder Action nerven) + per-Poll-Dismiss-Cooldown.
 *
 * Writes sind fire-and-forget (Forbidden Pattern: await blockt offline
 * ewig). Der lokale answered-State treibt die UI; der poll_responses-
 * Write geht offline in die Firestore-Queue und feuert bei Reconnect →
 * dann vergibt die CF den Reward.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addDoc,
  collection,
  getDocs,
  query,
  where,
} from '@react-native-firebase/firestore';

import { db } from '@/lib/firebase';
import { getPreferenceProfile } from '@/lib/services/preferenceProfileService';
import { getUserProfile } from '@/lib/services/userProfile';
import {
  isPollEligible,
  type SurveyUserContext,
} from '@/lib/services/surveyTargeting';
import type { ActionType } from '@/lib/types/achievements';
import {
  pollTriggerOf,
  type Poll,
  type PollAnswer,
} from '@/lib/types/survey';

// ── Frequency-Konfig ──
const ACTION_GLOBAL_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 h zwischen Action-Prompts
const POLL_DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // abgebrochene Poll: 24 h Ruhe
const POLLS_TTL_MS = 5 * 60 * 1000;
const CTX_TTL_MS = 5 * 60 * 1000;

const K_ANSWERED = 'survey_answered_v1'; // string[] pollIds
const K_DISMISSED = 'survey_dismissed_v1'; // Record<pollId, ts>
const K_LAST_ACTION_PROMPT = 'survey_last_action_prompt_v1'; // ts

// ── In-memory caches (RAM, kein Persist) ──
let pollsCache: { at: number; polls: Poll[] } | null = null;
let pollsInflight: Promise<Poll[]> | null = null;
let ctxCache: { uid: string; at: number; ctx: SurveyUserContext } | null = null;

function nowMs(): number {
  return Date.now();
}

function isWithinWindow(poll: Poll): boolean {
  const now = nowMs();
  if (poll.startDate) {
    const s = Date.parse(poll.startDate);
    if (Number.isFinite(s) && now < s) return false;
  }
  if (poll.endDate) {
    const e = Date.parse(poll.endDate);
    if (Number.isFinite(e) && now > e) return false;
  }
  return true;
}

/** Aktive Polls aus `polls` (status active, im Zeitfenster). Cache+Dedup. */
export async function getActivePolls(force = false): Promise<Poll[]> {
  if (!force && pollsCache && nowMs() - pollsCache.at < POLLS_TTL_MS) {
    return pollsCache.polls;
  }
  if (pollsInflight) return pollsInflight;
  pollsInflight = (async () => {
    try {
      const snap = await getDocs(
        query(collection(db, 'polls'), where('status', '==', 'active')),
      );
      const polls: Poll[] = [];
      snap.forEach((d: any) => {
        const data = d.data() as any;
        const poll: Poll = { id: d.id, ...data };
        if (Array.isArray(poll.questions) && poll.questions.length > 0 && isWithinWindow(poll)) {
          polls.push(poll);
        }
      });
      // Leeres fromCache-Resultat NICHT cachen (Offline-Schutz, analog
      // firestore.ts) — sonst klebt eine leere Liste 5 Min fest.
      if (polls.length > 0 || !(snap as any).metadata?.fromCache) {
        pollsCache = { at: nowMs(), polls };
      }
      return polls;
    } catch (e) {
      console.warn('[survey] getActivePolls failed:', (e as Error)?.message);
      return pollsCache?.polls ?? [];
    } finally {
      pollsInflight = null;
    }
  })();
  return pollsInflight;
}

/** User-Context für Targeting (users-Doc + Präferenz-Profil). Cache pro uid. */
export async function buildUserContext(uid: string): Promise<SurveyUserContext> {
  if (ctxCache && ctxCache.uid === uid && nowMs() - ctxCache.at < CTX_TTL_MS) {
    return ctxCache.ctx;
  }
  const [profileDoc, prefProfile] = await Promise.all([
    getUserProfile(uid),
    getPreferenceProfile(uid),
  ]);
  const p = (profileDoc ?? {}) as any;
  const ctx: SurveyUserContext = {
    age: typeof p.age === 'number' ? p.age : null,
    gender: p.gender ?? null,
    bundesland: p.bundesland ?? p.guessedBundesland ?? null,
    favoriteMarket: p.favoriteMarket ?? null,
    favoriteMarketName: p.favoriteMarketName ?? null,
    isPremium: !!p.isPremium,
    profile: prefProfile,
  };
  ctxCache = { uid, at: nowMs(), ctx };
  return ctx;
}

/** Lokale Helfer für Frequency-State. */
async function getAnswered(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(K_ANSWERED);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
async function getDismissed(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(K_DISMISSED);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Hat der User diese Umfrage schon beantwortet (lokal bekannt)? */
export async function hasAnswered(pollId: string): Promise<boolean> {
  return (await getAnswered()).has(pollId);
}

/**
 * Allgemeine Umfragen für die Liste im Rewards-Tab: aktiv, general,
 * eligible, noch nicht beantwortet.
 */
export async function getGeneralSurveys(uid: string): Promise<Poll[]> {
  if (!uid) return [];
  const [polls, ctx, answered] = await Promise.all([
    getActivePolls(),
    buildUserContext(uid),
    getAnswered(),
  ]);
  return polls.filter(
    (p) =>
      pollTriggerOf(p).type === 'general' &&
      !answered.has(p.id) &&
      isPollEligible(p, ctx),
  );
}

/**
 * Passende action-getriggerte Umfrage für eine gerade ausgeführte Action
 * — oder null. Respektiert globalen Cooldown + per-Poll-Dismiss-Cooldown
 * + answered. Gibt die erste passende zurück.
 */
export async function getActionSurvey(
  uid: string,
  action: ActionType,
): Promise<Poll | null> {
  if (!uid) return null;
  const [lastPromptRaw, answered, dismissed] = await Promise.all([
    AsyncStorage.getItem(K_LAST_ACTION_PROMPT),
    getAnswered(),
    getDismissed(),
  ]);
  const lastPrompt = lastPromptRaw ? parseInt(lastPromptRaw, 10) || 0 : 0;
  if (nowMs() - lastPrompt < ACTION_GLOBAL_COOLDOWN_MS) return null;

  const [polls, ctx] = await Promise.all([getActivePolls(), buildUserContext(uid)]);
  const now = nowMs();
  for (const p of polls) {
    const trig = pollTriggerOf(p);
    if (trig.type !== 'action' || trig.action !== action) continue;
    if (answered.has(p.id)) continue;
    const dAt = dismissed[p.id];
    const cd = (trig.cooldownHours ?? POLL_DISMISS_COOLDOWN_MS / 3_600_000) * 3_600_000;
    if (dAt && now - dAt < cd) continue;
    if (!isPollEligible(p, ctx)) continue;
    return p;
  }
  return null;
}

/** Markiert, dass ein Action-Prompt JETZT gezeigt wurde (globaler Cooldown). */
export async function markActionPromptShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(K_LAST_ACTION_PROMPT, String(nowMs()));
  } catch {
    /* ignore */
  }
}

/** Merkt eine abgebrochene Umfrage (Dismiss-Cooldown). */
export async function markDismissed(pollId: string): Promise<void> {
  try {
    const d = await getDismissed();
    d[pollId] = nowMs();
    await AsyncStorage.setItem(K_DISMISSED, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

/**
 * Antwort absenden: lokal als beantwortet markieren (treibt die UI),
 * dann poll_responses fire-and-forget schreiben. Der Reward kommt
 * server-seitig (CF survey-reward). Gibt sofort zurück — kein Warten
 * auf Server-Ack (offline-safe).
 */
export async function submitResponse(args: {
  poll: Poll;
  uid: string;
  answers: PollAnswer[];
  startedAtMs: number;
  ctx: SurveyUserContext;
}): Promise<void> {
  const { poll, uid, answers, startedAtMs, ctx } = args;
  const completedMs = nowMs();

  // 1. Lokal SOFORT als beantwortet markieren (await: muss persistiert
  //    sein bevor die UI das Sheet schließt — sonst Re-Trigger-Race,
  //    siehe Coachmark-Learning).
  try {
    const answered = await getAnswered();
    answered.add(poll.id);
    await AsyncStorage.setItem(K_ANSWERED, JSON.stringify([...answered]));
  } catch {
    /* nicht fatal */
  }

  // 2. poll_responses fire-and-forget (offline → Firestore-Queue →
  //    CF vergibt Reward bei Reconnect). RevealyIQs Schema 1:1.
  const response = {
    pollId: poll.id,
    userId: uid,
    answers,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedMs).toISOString(),
    timeSpentSeconds: Math.max(0, Math.round((completedMs - startedAtMs) / 1000)),
    userContext: {
      favoriteMarket: ctx.favoriteMarket ?? undefined,
      gender: ctx.gender ?? undefined,
      age: ctx.age ?? undefined,
      region: ctx.bundesland ?? undefined,
      isPremium: ctx.isPremium ?? undefined,
    },
  };
  void addDoc(collection(db, 'poll_responses'), response as any).catch((e) =>
    console.warn('[survey] poll_responses write failed (queued offline?):', (e as Error)?.message),
  );
}

/** Cache-Reset (z.B. Logout / Account-Wechsel). */
export function resetSurveyCaches(): void {
  pollsCache = null;
  ctxCache = null;
}
