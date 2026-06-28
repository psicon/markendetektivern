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
import journeyTrackingService from '@/lib/services/journeyTrackingService';
import { getPreferenceProfile } from '@/lib/services/preferenceProfileService';
import { getUserProfile } from '@/lib/services/userProfile';
import {
  isPollEligible,
  type SurveyUserContext,
} from '@/lib/services/surveyTargeting';
import type { ActionType } from '@/lib/types/achievements';
import {
  extractRefId,
  isPollRepeatable,
  pollTriggerOf,
  type Poll,
  type PollAnswer,
} from '@/lib/types/survey';

// ── Frequency-Konfig ──
// Re-Ask-/Dismiss-Cooldown EINER Umfrage: nach Antwort/Wegklick erst
// nach `cooldownHours` (Default 6 h) wieder zeigen → kein Re-Pop-Spam.
// Pro Umfrage via trigger.cooldownHours überschreibbar (0 = sofort wieder).
const POLL_DISMISS_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 h Default
const POLLS_TTL_MS = 5 * 60 * 1000;
const CTX_TTL_MS = 5 * 60 * 1000;

// Session-Cap (User-Vorgabe 86ca8fbpz / Bug-Report): eine action-getriggerte
// Umfrage darf pro App-Start NUR EINMAL aufpoppen — sonst kommt sie bei jeder
// Aktion (z.B. jedes Produkt-Öffnen) wieder und nervt. Nach dem Anzeigen wird
// die Umfrage zusätzlich per markDismissed in den persistenten 6-h-Cooldown
// gelegt, damit sie auch nach einem App-Neustart nicht sofort wieder kommt.
// Das Flag ist MODUL-scoped (RAM) → resettet beim App-Neustart von selbst.
let actionPromptedThisSession = false;

const K_ANSWERED = 'survey_answered_v1'; // string[] pollIds
const K_DISMISSED = 'survey_dismissed_v1'; // Record<pollId, ts>
const K_SNOOZE_UNTIL = 'survey_snooze_until_v1'; // ts — "heute keine Vorschläge mehr"
const K_ACTION_ENABLED = 'survey_action_enabled_v1'; // '0' = dauerhaft aus (Profil-Setting)
const K_ANSWER_COUNT = 'survey_answer_count_v1'; // Record<pollId, number>

// ── In-memory caches (RAM, kein Persist) ──
let pollsCache: { at: number; polls: Poll[] } | null = null;
let pollsInflight: Promise<Poll[]> | null = null;
let ctxCache: { uid: string; at: number; ctx: SurveyUserContext } | null = null;
// Server-seitige Antwort-Zähler pro pollId (aus poll_responses). DAS ist
// die Wahrheit, ob eine Umfrage schon beantwortet wurde — NICHT der lokale
// answered-Set allein (der wird bei Reset/Reinstall/Geräte-Wechsel leer →
// sonst könnte man dieselbe Umfrage erneut ausfüllen + erneut Cashback
// kassieren). 86ca8h… (kritischer Bug).
let answeredCountsCache: { uid: string; at: number; counts: Record<string, number> } | null = null;
let answeredCountsInflight: Promise<Record<string, number>> | null = null;
const ANSWERED_TTL_MS = 60 * 1000; // 1 Min — frisch genug, ein Read pro Minute

function nowMs(): number {
  return Date.now();
}

/**
 * Wie oft hat dieser User jede Umfrage SCHON beantwortet — autoritativ aus
 * `poll_responses` (Server). Überlebt lokalen Reset/Reinstall/Geräte-Wechsel,
 * im Gegensatz zum lokalen answered-Set. Cache 1 Min + inflight-Dedup, billig.
 */
async function getServerAnsweredCounts(
  uid: string,
  force = false,
): Promise<Record<string, number>> {
  if (
    !force &&
    answeredCountsCache &&
    answeredCountsCache.uid === uid &&
    nowMs() - answeredCountsCache.at < ANSWERED_TTL_MS
  ) {
    return answeredCountsCache.counts;
  }
  if (answeredCountsInflight) return answeredCountsInflight;
  answeredCountsInflight = (async () => {
    try {
      const snap = await getDocs(
        query(collection(db, 'poll_responses'), where('userId', '==', uid)),
      );
      const counts: Record<string, number> = {};
      snap.forEach((d: any) => {
        const pid = (d.data() as any)?.pollId;
        if (pid) counts[pid] = (counts[pid] ?? 0) + 1;
      });
      // Leeres fromCache-Resultat NICHT cachen (Offline-Schutz) — sonst klebt
      // ein leerer Stand fest und die Umfrage käme fälschlich wieder.
      if (Object.keys(counts).length > 0 || !(snap as any).metadata?.fromCache) {
        answeredCountsCache = { uid, at: nowMs(), counts };
      }
      return counts;
    } catch (e) {
      console.warn('[survey] getServerAnsweredCounts failed:', (e as Error)?.message);
      return answeredCountsCache?.counts ?? {};
    } finally {
      answeredCountsInflight = null;
    }
  })();
  return answeredCountsInflight;
}

/**
 * Ist diese Umfrage für den User ausgeschöpft? Vereint LOKAL (answered-Set)
 * + SERVER (poll_responses-Count). Nicht-wiederholbar → schon EINE Antwort
 * sperrt; wiederholbar → erst maxPerUser erreicht.
 */
function isPollExhausted(
  poll: Poll,
  localAnswered: Set<string>,
  serverCount: number,
): boolean {
  if (localAnswered.has(poll.id)) return true;
  if (!isPollRepeatable(poll)) return serverCount >= 1;
  if (typeof poll.maxPerUser === 'number' && poll.maxPerUser > 0) {
    return serverCount >= poll.maxPerUser;
  }
  return false; // wiederholbar ohne Limit
}

// ── Budget-Gating (ClickUp 86ca8fbpz) ──
// Eine Umfrage mit eigenem Budget (budgetCents) wird nur ausgespielt,
// solange Budget übrig ist. Ohne budgetCents → unbegrenzt. Eigenständig,
// keine Campaign-Verknüpfung mehr.
function budgetAllows(poll: Poll): boolean {
  if (typeof poll.budgetCents !== 'number') return true; // kein Budget-Limit
  const remaining =
    typeof poll.budgetRemainingCents === 'number'
      ? poll.budgetRemainingCents
      : poll.budgetCents;
  return remaining > 0;
}

/**
 * Poll-Zeitfeld (startDate/endDate) robust nach ms auflösen.
 *
 * WICHTIG: die DATEN sind NICHT die deklarierten ISO-Strings — RevealyIQ /
 * das Admin-Tool schreibt Firestore-TIMESTAMPS (`{ _seconds, _nanoseconds }`
 * bzw. ein Timestamp-Objekt mit `.toMillis()`). Ein blindes
 * `Date.parse(timestamp)` ergab `NaN` → `Number.isFinite(NaN)` ist false →
 * der Window-Check wurde STILL übersprungen → abgelaufene Umfragen erschienen
 * trotzdem (app-weit). Darum hier defensiv ALLE Repräsentationen abdecken.
 * null = leer/unbekannt (→ kein Limit auf der jeweiligen Seite).
 */
function pollTimeMs(v: unknown): number | null {
  if (v == null) return null;
  const a = v as any;
  if (typeof a.toMillis === 'function') {
    try { const m = a.toMillis(); return Number.isFinite(m) ? m : null; } catch { /* fallthrough */ }
  }
  if (typeof a.toDate === 'function') {
    try { const t = a.toDate().getTime(); return Number.isFinite(t) ? t : null; } catch { /* fallthrough */ }
  }
  if (typeof a._seconds === 'number') return a._seconds * 1000 + Math.floor((a._nanoseconds || 0) / 1e6);
  if (typeof a.seconds === 'number') return a.seconds * 1000 + Math.floor((a.nanoseconds || 0) / 1e6);
  if (v instanceof Date) { const t = v.getTime(); return Number.isFinite(t) ? t : null; }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}

function isWithinWindow(poll: Poll): boolean {
  const now = nowMs();
  const s = pollTimeMs(poll.startDate);
  if (s != null && now < s) return false;
  const e = pollTimeMs(poll.endDate);
  if (e != null && now > e) return false;
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

  // Alter wie im Journey-consumerProfile (journeyTrackingService): gemeldetes
  // age + (heute − Meldejahr) hochrechnen, Legacy-Fallback birthDate.
  let age: number | null = null;
  if (typeof p.age === 'number') {
    age =
      typeof p.ageReportedYear === 'number'
        ? p.age + Math.max(0, new Date().getFullYear() - p.ageReportedYear)
        : p.age;
  } else if (p.birthDate?.toDate) {
    const bd = p.birthDate.toDate();
    age = Math.floor((Date.now() - bd.getTime()) / (365.25 * 24 * 3600 * 1000));
  }
  if (!(typeof age === 'number' && age > 0 && age < 120)) age = null;

  // Level + Ersparnis gespiegelt aus Journey-consumerProfile.
  const stats = p.stats || {};
  const level =
    typeof stats.currentLevel === 'number'
      ? stats.currentLevel
      : typeof p.level === 'number'
        ? p.level
        : null;
  const savingsRaw =
    Number(p.totalSavings) || Number(stats.totalSavings) || Number(stats.savingsTotal) || 0;
  const savingsTotal = savingsRaw > 0 ? Math.round(savingsRaw * 100) / 100 : null;

  const ctx: SurveyUserContext = {
    age,
    gender: p.gender ?? null,
    bundesland: p.bundesland ?? p.guessedBundesland ?? null,
    favoriteMarket: p.favoriteMarket ?? null,
    favoriteMarketName: p.favoriteMarketName ?? null,
    isPremium: !!p.isPremium,
    level,
    savingsTotal,
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
// Anzahl der (lokal bekannten) Antworten pro Umfrage — treibt das
// Per-User-Limit client-seitig, damit beantwortete/ausgeschöpfte Umfragen
// nicht erneut erscheinen + der Reward-Toast nicht lügt.
async function getAnswerCounts(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(K_ANSWER_COUNT);
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
export async function getGeneralSurveys(uid: string, force = false): Promise<Poll[]> {
  if (!uid) return [];
  const [polls, ctx, answered, serverCounts] = await Promise.all([
    getActivePolls(force),
    buildUserContext(uid),
    getAnswered(),
    getServerAnsweredCounts(uid, force),
  ]);
  return polls.filter(
    (p) =>
      pollTriggerOf(p).type === 'general' &&
      // Schon beantwortet? LOKAL oder SERVER (poll_responses) — Server ist
      // die Wahrheit, überlebt lokalen Reset/Reinstall.
      !isPollExhausted(p, answered, serverCounts[p.id] ?? 0) &&
      budgetAllows(p) &&
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
  // Session-Cap: pro App-Start max. EIN action-Prompt (User-Vorgabe —
  // sonst poppt die Umfrage bei jeder Aktion wieder). Resettet beim
  // App-Neustart (Modul-Flag).
  if (actionPromptedThisSession) return null;
  // Stummschaltung (User): dauerhaftes Profil-Setting ODER Tages-Snooze.
  // Beide gelten nur für action-Vorschläge — die general-Liste im
  // Rewards-Tab bleibt immer erreichbar.
  if (!(await areActionSurveysEnabled())) return null;
  if (await isSnoozed()) return null;
  const [answered, dismissed, serverCounts] = await Promise.all([
    getAnswered(),
    getDismissed(),
    getServerAnsweredCounts(uid),
  ]);

  const [polls, ctx] = await Promise.all([
    getActivePolls(),
    buildUserContext(uid),
  ]);
  const now = nowMs();
  const productId = metadata?.productId;
  // Marken-ID des betroffenen Produkts wird nur bei Bedarf (Poll mit
  // targetBrandIds) aufgelöst — ein gecachter Read, lazy.
  let brandIdResolved: string | null | undefined; // undefined = noch nicht versucht
  for (const p of polls) {
    const trig = pollTriggerOf(p);
    if (trig.type !== 'action' || trig.action !== action) continue;
    // Schon beantwortet/ausgeschöpft? LOKAL oder SERVER (poll_responses).
    // Server überlebt Reset/Reinstall → kein erneutes Ausfüllen + Kassieren.
    if (isPollExhausted(p, answered, serverCounts[p.id] ?? 0)) continue;
    // Pro-Umfrage-Cooldown: nach Antwort/Wegklick (markDismissed) erst
    // nach `cooldownHours` (Default 6 h) wieder zeigen → kein Re-Pop-Spam.
    // Verschiedene Umfragen können weiterhin je auf ihre Aktion feuern.
    const dAt = dismissed[p.id];
    const cd = (trig.cooldownHours ?? POLL_DISMISS_COOLDOWN_MS / 3_600_000) * 3_600_000;
    if (dAt && now - dAt < cd) continue;
    if (!budgetAllows(p)) continue;
    if (!isPollEligible(p, ctx)) continue;

    // ── Produkt-Targeting (Referenzen → id-Vergleich) ──
    if (Array.isArray(p.targetProducts) && p.targetProducts.length > 0) {
      const ids = p.targetProducts.map((r) => extractRefId(r)?.id).filter(Boolean);
      if (!productId || !ids.includes(productId)) continue;
    }
    // ── Marken-/Hersteller-Targeting (Referenzen, lazy aufgelöst) ──
    if (Array.isArray(p.targetBrands) && p.targetBrands.length > 0) {
      const brandIds = p.targetBrands.map((r) => extractRefId(r)?.id).filter(Boolean);
      if (brandIdResolved === undefined) {
        brandIdResolved = productId
          ? await resolveProductBrandId(productId, metadata?.productType)
          : null;
      }
      if (!brandIdResolved || !brandIds.includes(brandIdResolved)) continue;
    }
    // Treffer → diesen Prompt für die Session sperren (max. 1×/Start) UND
    // die Umfrage in den persistenten 6-h-Cooldown legen, damit sie auch
    // nach einem Neustart nicht sofort wieder kommt. Erst NACH dem Anzeigen
    // (nicht schon bei reiner Eligibility) — sonst würde eine geöffnete,
    // aber nie angezeigte Umfrage fälschlich gesperrt.
    actionPromptedThisSession = true;
    void markDismissed(p.id);
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
  /** Markt-Consent akzeptiert (aktuelle Version)? Markiert das Response-
   *  Doc, damit RevealyIQ konsentierte von nicht-konsentierten Daten
   *  trennen kann (User-Vorgabe: sammeln, aber markieren). */
  marketConsent: boolean;
  /** Registrierter (nicht-anonymer) Account? */
  registered: boolean;
}): Promise<void> {
  const { poll, uid, answers, startedAtMs, ctx, marketConsent, registered } = args;
  const completedMs = nowMs();

  // 0. HARTER Re-Submit-Schutz (kritischer Bug 86ca8h…): selbst wenn die
  //    Umfrage durch verlorenen Lokal-State (Reset/Reinstall/Geräte-Wechsel)
  //    erneut angezeigt wurde, NICHT erneut schreiben/kassieren, wenn sie
  //    LOKAL oder am SERVER (poll_responses) bereits ausgeschöpft ist. Der
  //    Loading-Filter blendet ausgeschöpfte Umfragen zwar schon aus — das
  //    hier ist die zweite Verteidigungslinie direkt vor dem Write.
  try {
    const [localAnswered, serverCounts] = await Promise.all([
      getAnswered(),
      getServerAnsweredCounts(uid),
    ]);
    if (isPollExhausted(poll, localAnswered, serverCounts[poll.id] ?? 0)) {
      console.warn('[survey] submit geblockt — Umfrage bereits ausgeschöpft:', poll.id);
      return;
    }
  } catch {
    /* im Zweifel weiter — die CF-Idempotenz (Ledger) ist der finale Geld-Guard */
  }

  // 1. Frequenz-State setzen (await: muss VOR dem Sheet-Schließen
  //    persistiert sein — sonst Re-Trigger-Race, siehe Coachmark-Learning).
  //    • Antwort-Zähler hochzählen.
  //    • Einmalig (completion / none-general) ODER Per-User-Limit erreicht
  //      → answered (nie wieder zeigen → kein Re-Pop, kein Lügen-Toast).
  //    • Sonst (per_answer mit Restkontingent) → nur Dismiss-Cooldown.
  try {
    const counts = await getAnswerCounts();
    const newCount = (counts[poll.id] ?? 0) + 1;
    counts[poll.id] = newCount;
    await AsyncStorage.setItem(K_ANSWER_COUNT, JSON.stringify(counts));

    const repeatable = isPollRepeatable(poll);
    const capReached =
      typeof poll.maxPerUser === 'number' && poll.maxPerUser > 0 && newCount >= poll.maxPerUser;
    if (!repeatable || capReached) {
      const answered = await getAnswered();
      answered.add(poll.id);
      await AsyncStorage.setItem(K_ANSWERED, JSON.stringify([...answered]));
    } else {
      await markDismissed(poll.id);
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
  // userContext so VOLLSTÄNDIG wie das Journey-consumerProfile (ClickUp
  // 86ca8g6jf) — nur definierte Werte (RN-Firestore wirft bei undefined).
  const userContext: Record<string, any> = {};
  if (ctx.favoriteMarket) userContext.favoriteMarket = ctx.favoriteMarket;
  if (ctx.favoriteMarketName) userContext.favoriteMarketName = ctx.favoriteMarketName;
  if (ctx.gender) userContext.gender = ctx.gender;
  if (typeof ctx.age === 'number') userContext.age = ctx.age;
  if (ctx.bundesland) userContext.region = ctx.bundesland;
  if (typeof ctx.isPremium === 'boolean') userContext.isPremium = ctx.isPremium;
  if (typeof ctx.level === 'number') userContext.level = ctx.level;
  if (typeof ctx.savingsTotal === 'number') userContext.savingsTotal = ctx.savingsTotal;
  // Präferenz-Profil-Dimensionen (0..1) für die B2B-Auswertung (analog
  // Journey-Motivation). Nur setzen, wenn vorhanden.
  if (ctx.profile?.dimensions && Object.keys(ctx.profile.dimensions).length > 0) {
    userContext.profileDimensions = ctx.profile.dimensions;
  }

  // Journey-Verknüpfung: aktuelle Journey-ID (falls eine läuft) ans
  // Response heften, damit RevealyIQ die Umfrage-Antwort mit dem
  // Verhaltens-Funnel der Journey joinen kann (86ca8g6jf).
  let journeyId: string | null = null;
  try {
    journeyId = journeyTrackingService.getCurrentJourneyId();
  } catch {
    journeyId = null;
  }

  const response: Record<string, any> = {
    pollId: poll.id,
    userId: uid,
    answers,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(completedMs).toISOString(),
    timeSpentSeconds: Math.max(0, Math.round((completedMs - startedAtMs) / 1000)),
    userContext,
    ...(journeyId ? { journeyId } : {}),
    // Daten-Consent-Markierung (User-Vorgabe: Antworten von Consent-losen
    // Usern sammeln, ABER markieren). RevealyIQ kann so konsentierte
    // Marktdaten herausfiltern. Cashback hängt server-seitig ohnehin an
    // genau diesen Flags (CF survey-reward).
    consent: {
      marketConsent, // Markt-Consent akzeptiert (aktuelle Version)
      registered, // nicht-anonymer Account
    },
  };
  void addDoc(collection(db, 'poll_responses'), response as any).catch((e) =>
    console.warn('[survey] poll_responses write failed (queued offline?):', (e as Error)?.message),
  );

  // Server-Antwort-Zähler-Cache invalidieren, damit ein späterer Load die
  // frische Antwort berücksichtigt (lokaler answered-/count-State gated die
  // UI ohnehin sofort, das hier hält den Server-Stand konsistent).
  answeredCountsCache = null;
}

/** Cache-Reset (z.B. Logout / Account-Wechsel). */
export function resetSurveyCaches(): void {
  pollsCache = null;
  ctxCache = null;
  brandIdCache.clear();
  answeredCountsCache = null;
  // Account-Wechsel zählt wie ein frischer Start → Session-Cap zurücksetzen.
  actionPromptedThisSession = false;
}
