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
  isPollRepeatable,
  pollTriggerOf,
  type Poll,
  type PollAnswer,
} from '@/lib/types/survey';

// ── Frequency-Konfig ──
// Globaler Floor zwischen ZWEI Action-Prompts (egal welche Umfrage) —
// verhindert Survey-Fatigue, ohne das Verdienen auszubremsen. 1 h ist
// ein vernünftiger "stört nicht"-Default (6 h war zu selten).
const ACTION_GLOBAL_COOLDOWN_MS = 60 * 60 * 1000; // 1 h
// Re-Ask-/Dismiss-Cooldown EINER Umfrage. Pro Umfrage via trigger.
// cooldownHours überschreibbar (0 = sofort wieder, z.B. zum Testen).
const POLL_DISMISS_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 h Default
const POLLS_TTL_MS = 5 * 60 * 1000;
const CTX_TTL_MS = 5 * 60 * 1000;

const K_ANSWERED = 'survey_answered_v1'; // string[] pollIds
const K_DISMISSED = 'survey_dismissed_v1'; // Record<pollId, ts>
const K_LAST_ACTION_PROMPT = 'survey_last_action_prompt_v1'; // ts
const K_SNOOZE_UNTIL = 'survey_snooze_until_v1'; // ts — "heute keine Vorschläge mehr"
const K_ACTION_ENABLED = 'survey_action_enabled_v1'; // '0' = dauerhaft aus (Profil-Setting)

// ── In-memory caches (RAM, kein Persist) ──
let pollsCache: { at: number; polls: Poll[] } | null = null;
let pollsInflight: Promise<Poll[]> | null = null;
let ctxCache: { uid: string; at: number; ctx: SurveyUserContext } | null = null;

function nowMs(): number {
  return Date.now();
}

// ── Campaign-Gating (ClickUp 86ca8fbpz) ──
// Eine Umfrage mit campaignId läuft nur, solange die verknüpfte Aktion
// aktiv ist + im Zeitfenster + Budget hat. Die nutzbaren Campaign-IDs
// werden 5 Min gecacht (ein collection-Read, klein).
let usableCampaignsCache: { at: number; ids: Set<string> } | null = null;
let usableCampaignsInflight: Promise<Set<string>> | null = null;

async function getUsableCampaignIds(): Promise<Set<string>> {
  if (usableCampaignsCache && nowMs() - usableCampaignsCache.at < POLLS_TTL_MS) {
    return usableCampaignsCache.ids;
  }
  if (usableCampaignsInflight) return usableCampaignsInflight;
  usableCampaignsInflight = (async () => {
    try {
      const snap = await getDocs(
        query(collection(db, 'cashback_campaigns'), where('active', '==', true)),
      );
      const ids = new Set<string>();
      const now = nowMs();
      snap.forEach((d: any) => {
        const c = d.data() || {};
        const budgetOk =
          typeof c.budgetRemainingCents !== 'number' || c.budgetRemainingCents > 0;
        const startOk = !c.startAt?.toMillis || c.startAt.toMillis() <= now;
        const endOk = !c.endAt?.toMillis || c.endAt.toMillis() >= now;
        if (budgetOk && startOk && endOk) ids.add(d.id);
      });
      // Leeres fromCache-Resultat nicht cachen (Offline-Schutz).
      if (ids.size > 0 || !(snap as any).metadata?.fromCache) {
        usableCampaignsCache = { at: nowMs(), ids };
      }
      return ids;
    } catch {
      return usableCampaignsCache?.ids ?? new Set<string>();
    } finally {
      usableCampaignsInflight = null;
    }
  })();
  return usableCampaignsInflight;
}

/** Ist die Umfrage ausspielbar bzgl. ihrer (optionalen) Campaign-Bindung? */
function campaignAllows(poll: Poll, usable: Set<string>): boolean {
  if (!poll.campaignId) return true; // keine Bindung → immer erlaubt
  return usable.has(poll.campaignId);
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
  const [polls, ctx, answered, usableCampaigns] = await Promise.all([
    getActivePolls(),
    buildUserContext(uid),
    getAnswered(),
    getUsableCampaignIds(),
  ]);
  return polls.filter(
    (p) =>
      pollTriggerOf(p).type === 'general' &&
      !answered.has(p.id) &&
      campaignAllows(p, usableCampaigns) &&
      isPollEligible(p, ctx),
  );
}

/**
 * Passende action-getriggerte Umfrage für eine gerade ausgeführte Action
 * — oder null. Respektiert globalen Cooldown + per-Poll-Dismiss-Cooldown
 * + answered. Gibt die erste passende zurück.
 */
/** DAUERHAFTE Stummschaltung action-getriggerter Umfragen (Profil-
 *  Einstellung). Allgemeine Umfragen im Rewards-Tab bleiben erreichbar. */
export async function setActionSurveysEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(K_ACTION_ENABLED, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}
export async function areActionSurveysEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(K_ACTION_ENABLED);
    return raw !== '0'; // Default: an
  } catch {
    return true;
  }
}

/** "Heute keine Vorschläge mehr" — Snooze bis zur nächsten lokalen
 *  Mitternacht (ClickUp 86ca8fbpz, User-Stummschaltung). */
export async function snoozeActionSurveysToday(): Promise<void> {
  const d = new Date();
  d.setHours(24, 0, 0, 0); // nächste Mitternacht
  try {
    await AsyncStorage.setItem(K_SNOOZE_UNTIL, String(d.getTime()));
  } catch {
    /* ignore */
  }
}
async function isSnoozed(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(K_SNOOZE_UNTIL);
    return !!raw && nowMs() < (parseInt(raw, 10) || 0);
  } catch {
    return false;
  }
}

export async function getActionSurvey(
  uid: string,
  action: ActionType,
  metadata?: { productId?: string; productType?: string },
): Promise<Poll | null> {
  if (!uid) return null;
  // Stummschaltung (User): dauerhaftes Profil-Setting ODER Tages-Snooze.
  // Beide gelten nur für action-Vorschläge — die general-Liste im
  // Rewards-Tab bleibt immer erreichbar.
  if (!(await areActionSurveysEnabled())) return null;
  if (await isSnoozed()) return null;
  const [lastPromptRaw, answered, dismissed] = await Promise.all([
    AsyncStorage.getItem(K_LAST_ACTION_PROMPT),
    getAnswered(),
    getDismissed(),
  ]);
  const lastPrompt = lastPromptRaw ? parseInt(lastPromptRaw, 10) || 0 : 0;
  if (nowMs() - lastPrompt < ACTION_GLOBAL_COOLDOWN_MS) return null;

  const [polls, ctx, usableCampaigns] = await Promise.all([
    getActivePolls(),
    buildUserContext(uid),
    getUsableCampaignIds(),
  ]);
  const now = nowMs();
  const productId = metadata?.productId;
  // Marken-ID des betroffenen Produkts wird nur bei Bedarf (Poll mit
  // targetBrandIds) aufgelöst — ein gecachter Read, lazy.
  let brandIdResolved: string | null | undefined; // undefined = noch nicht versucht
  for (const p of polls) {
    const trig = pollTriggerOf(p);
    if (trig.type !== 'action' || trig.action !== action) continue;
    if (answered.has(p.id)) continue;
    const dAt = dismissed[p.id];
    const cd = (trig.cooldownHours ?? POLL_DISMISS_COOLDOWN_MS / 3_600_000) * 3_600_000;
    if (dAt && now - dAt < cd) continue;
    if (!campaignAllows(p, usableCampaigns)) continue;
    if (!isPollEligible(p, ctx)) continue;

    // ── Produkt-Targeting ──
    if (Array.isArray(p.targetProductIds) && p.targetProductIds.length > 0) {
      if (!productId || !p.targetProductIds.includes(productId)) continue;
    }
    // ── Marken-/Hersteller-Targeting (lazy aufgelöst) ──
    if (Array.isArray(p.targetBrandIds) && p.targetBrandIds.length > 0) {
      if (brandIdResolved === undefined) {
        brandIdResolved = productId
          ? await resolveProductBrandId(productId, metadata?.productType)
          : null;
      }
      if (!brandIdResolved || !p.targetBrandIds.includes(brandIdResolved)) continue;
    }
    return p;
  }
  return null;
}

// Cache: productId → herstellerId (RAM, klein, Marken-Targeting selten).
const brandIdCache = new Map<string, string | null>();

/**
 * Löst die Marken-/Hersteller-Doc-ID eines Produkts auf (für Marken-
 * Targeting). Liest 1 Doc (gecacht). markenProdukte.hersteller zeigt auf
 * die MARKE (hersteller-Collection), produkte.hersteller auf den echten
 * Hersteller (hersteller_new) — wir geben die jeweils referenzierte ID
 * zurück; targetBrandIds kann beide Welten enthalten.
 */
async function resolveProductBrandId(
  productId: string,
  productType?: string,
): Promise<string | null> {
  if (brandIdCache.has(productId)) return brandIdCache.get(productId) ?? null;
  try {
    const isMarke = productType === 'markenprodukt' || productType === 'marke' || productType === 'brand';
    const col = isMarke ? 'markenProdukte' : 'produkte';
    const snap = await getDocs(
      query(collection(db, col), where('__name__', '==', productId)),
    ).catch(() => null);
    let id: string | null = null;
    const data = snap && !snap.empty ? (snap.docs[0].data() as any) : null;
    const ref = data?.hersteller;
    if (ref) {
      // Ref-Shapes defensiv: modular .id, Legacy referencePath / path / _path.
      id =
        ref.id ||
        (ref.referencePath ? String(ref.referencePath).split('/').pop() : null) ||
        (ref._path?.segments ? ref._path.segments[ref._path.segments.length - 1] : null) ||
        (typeof ref.path === 'string' ? ref.path.split('/').pop() : null) ||
        (typeof ref === 'string' ? ref.split('/').pop() : null) ||
        null;
    }
    brandIdCache.set(productId, id);
    return id;
  } catch {
    brandIdCache.set(productId, null);
    return null;
  }
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

  // 1. Frequenz-State setzen (await: muss VOR dem Sheet-Schließen
  //    persistiert sein — sonst Re-Trigger-Race, siehe Coachmark-Learning).
  //    • Einmalige Umfragen → answered (nie wieder).
  //    • Wiederholbare (per_answer / none-action) → NICHT answered, aber
  //      Dismiss-Cooldown, damit sie nicht sofort erneut aufpoppen.
  try {
    if (isPollRepeatable(poll)) {
      await markDismissed(poll.id);
    } else {
      const answered = await getAnswered();
      answered.add(poll.id);
      await AsyncStorage.setItem(K_ANSWERED, JSON.stringify([...answered]));
    }
  } catch {
    /* nicht fatal */
  }

  // 2. poll_responses fire-and-forget (offline → Firestore-Queue →
  //    CF vergibt Reward bei Reconnect). RevealyIQs Schema 1:1.
  //    WICHTIG: RN-Firestore wirft bei undefined-Feldwerten
  //    ('Unsupported field value: undefined') — userContext NUR mit
  //    tatsächlich vorhandenen Werten bauen (anonyme User ohne Profil
  //    haben hier sonst lauter undefined).
  const userContext: Record<string, any> = {};
  if (ctx.favoriteMarket) userContext.favoriteMarket = ctx.favoriteMarket;
  if (ctx.gender) userContext.gender = ctx.gender;
  if (typeof ctx.age === 'number') userContext.age = ctx.age;
  if (ctx.bundesland) userContext.region = ctx.bundesland;
  if (typeof ctx.isPremium === 'boolean') userContext.isPremium = ctx.isPremium;

  const response = {
    pollId: poll.id,
    userId: uid,
    answers,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedMs).toISOString(),
    timeSpentSeconds: Math.max(0, Math.round((completedMs - startedAtMs) / 1000)),
    userContext,
  };
  void addDoc(collection(db, 'poll_responses'), response as any).catch((e) =>
    console.warn('[survey] poll_responses write failed (queued offline?):', (e as Error)?.message),
  );
}

/** Cache-Reset (z.B. Logout / Account-Wechsel). */
export function resetSurveyCaches(): void {
  pollsCache = null;
  ctxCache = null;
  usableCampaignsCache = null;
  brandIdCache.clear();
}
