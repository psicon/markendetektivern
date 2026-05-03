// Leaderboard service — reads from the Firestore aggregate doc that
// the daily Cloud Function writes (admin script today, scheduled
// function later). Single doc, ~4 KB, one read per session.
//
// Conceptually:
//   - Each user's totalSavings + stats.pointsTotal feed into ONE
//     city/Bundesland bucket.
//   - Bucket assignment: userProfile.city if explicitly set,
//     otherwise the most-frequent city from that user's journey
//     history.
//   - The aggregator runs server-side; the app just reads the result.
//
// No per-user listing. The Liga is a city/Bundesland duel; users
// don't appear individually anywhere on the leaderboard.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CITY_TO_BUNDESLAND, normalizeCityName } from '@/lib/data/city-to-bundesland';

export type LbScope = 'overall' | 'bundesland' | 'stadt';
// 'year' (Champion) was dropped — yearly counters were too noisy
// to maintain cheaply at our scale, and the user-facing value is
// marginal vs. month/week. Lifetime ('all') comes from the nightly
// aggregator doc; 'month' and 'week' come from live Firestore
// queries against the legacy `leaderboards` collection.
export type LbPeriod = 'all' | 'month' | 'week';
export type LbMetric = 'pts' | 'eur';

/** True when the period has real data today. With v5 of the
 *  aggregator (periodTopUsers populated) all four are real. */
export function isPeriodAvailable(_p: LbPeriod): boolean {
  return true;
}

export type LbRow = {
  /** Stable key for highlight matching (slug of label). */
  key: string;
  /** Human-readable name shown in the list. */
  label: string;
  /** Bundesland of the city (cities only). */
  bundesland?: string;
  /** Detektiv-Punkte total in the bucket. */
  pts: number;
  /** Cumulative Ersparnis in € in the bucket. */
  eur: number;
  /** How many users contributed to this bucket. */
  users: number;
  /** 1-based rank in the sorted list. */
  rank: number;
  /** Highlighted "DU" row, set on the client based on user region. */
  isMe?: boolean;
};

export const BUNDESLAENDER = [
  'Baden-Württemberg',
  'Bayern',
  'Berlin',
  'Brandenburg',
  'Bremen',
  'Hamburg',
  'Hessen',
  'Mecklenburg-Vorpommern',
  'Niedersachsen',
  'Nordrhein-Westfalen',
  'Rheinland-Pfalz',
  'Saarland',
  'Sachsen',
  'Sachsen-Anhalt',
  'Schleswig-Holstein',
  'Thüringen',
] as const;
export type Bundesland = (typeof BUNDESLAENDER)[number];

export type LbUser = {
  id: string;
  rank: number;
  /** display_name as chosen by the user (gamer-tag style). */
  name: string;
  avatar: string;
  /** photoUrl from userProfile.photo_url — rendered as the avatar
   *  when present, falls back to first-letter circle when null. */
  photoUrl: string | null;
  city: string | null;
  bundesland: string | null;
  level: number;
  pts: number;
  eur: number;
  isMe?: boolean;
};

// In-memory cache for the session — the aggregate is updated daily,
// no point re-fetching it on every Bestenliste-tap.
//
// `_inflight` dedupes parallel reads: when both the Bundesland and
// City lists fire on mount, they share ONE Firestore read instead
// of racing.
type PercentileThresholds = {
  p1: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
};

type Snapshot = {
  bundesland: Omit<LbRow, 'isMe'>[];
  cities: Omit<LbRow, 'isMe'>[];
  topUsers: Omit<LbUser, 'isMe'>[];
  totalUsersWithPts: number;
  percentileThresholds: PercentileThresholds | null;
  updatedAt: number;
  fetchedAt: number;
};
let _cache: Snapshot | null = null;
let _inflight: Promise<Snapshot> | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

async function fetchSnapshot(): Promise<Snapshot> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) return _cache;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const snap = await getDoc(doc(db, 'aggregates', 'leaderboard_v1'));
      if (!snap.exists()) {
        const empty: Snapshot = {
          bundesland: [],
          cities: [],
          topUsers: [],
          totalUsersWithPts: 0,
          percentileThresholds: null,
          updatedAt: 0,
          fetchedAt: Date.now(),
        };
        return empty;
      }
      const data = snap.data() as any;
      const bundesland = (data.bundesland || []).map((r: any) => ({
        key: slug(r.label),
        label: r.label,
        pts: Number(r.pts || 0),
        eur: Number(r.eur || 0),
        users: Number(r.users || 0),
        rank: Number(r.rank || 0),
      }));
      const cities = (data.cities || []).map((r: any) => ({
        key: slug(r.label),
        // Normalize "Munich" → "München" on read so the UI shows
        // German names regardless of what the IP-geocoder produced.
        label: normalizeCityName(r.label),
        bundesland: r.bl || CITY_TO_BUNDESLAND[r.label] || undefined,
        pts: Number(r.pts || 0),
        eur: Number(r.eur || 0),
        users: Number(r.users || 0),
        rank: Number(r.rank || 0),
      }));
      const topUsers = (data.topUsers || []).map((u: any) => ({
        id: String(u.id || ''),
        rank: Number(u.rank || 0),
        name: String(u.name || 'Anonymer Detektiv'),
        avatar: String(u.avatar || '🦉'),
        photoUrl: u.photoUrl ?? null,
        city: u.city ? normalizeCityName(u.city) : null,
        bundesland: u.bundesland || (u.city ? CITY_TO_BUNDESLAND[u.city] : null) || null,
        level: Number(u.level || 1),
        pts: Number(u.pts || 0),
        eur: Number(u.eur || 0),
      }));
      const pt = data.percentileThresholds || null;
      _cache = {
        bundesland,
        cities,
        topUsers,
        totalUsersWithPts: Number(data.totalUsersWithPts || 0),
        percentileThresholds: pt
          ? {
              p1: Number(pt.p1 || 0),
              p5: Number(pt.p5 || 0),
              p10: Number(pt.p10 || 0),
              p25: Number(pt.p25 || 0),
              p50: Number(pt.p50 || 0),
              p75: Number(pt.p75 || 0),
              p90: Number(pt.p90 || 0),
            }
          : null,
        updatedAt: data.updatedAt?.toMillis?.() ?? 0,
        fetchedAt: Date.now(),
      };
      return _cache;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Bundesland-Liga, sorted by the chosen metric (pts or eur). The
 * user's row is marked with `isMe = true` based on their
 * userProfile.bundesland (or guessedBundesland fallback). For
 * non-`all` periods we currently return [] — Champion / Rising Star
 * are stubs until the backend tracks rolling-window counters.
 */
export async function getBundeslandRanks(
  userBundesland?: string | null,
  period: LbPeriod = 'all',
  metric: LbMetric = 'pts',
): Promise<LbRow[]> {
  if (period !== 'all') return [];
  const snap = await fetchSnapshot();
  const sorted = [...snap.bundesland].sort((a, b) =>
    metric === 'eur' ? b.eur - a.eur : b.pts - a.pts,
  );
  return sorted.map((r, i) => ({
    ...r,
    rank: i + 1,
    isMe: !!userBundesland && r.label === userBundesland,
  }));
}

/**
 * Städte-Liga, top-50 sorted by chosen metric. Same isMe-marking
 * via userProfile.city / guessedCity.
 */
export async function getCityRanks(
  userCity?: string | null,
  period: LbPeriod = 'all',
  metric: LbMetric = 'pts',
): Promise<LbRow[]> {
  if (period !== 'all') return [];
  const snap = await fetchSnapshot();
  const target = userCity ? normalizeCityName(userCity) : null;
  const sorted = [...snap.cities].sort((a, b) =>
    metric === 'eur' ? b.eur - a.eur : b.pts - a.pts,
  );
  return sorted.map((r, i) => ({
    ...r,
    rank: i + 1,
    isMe: !!target && r.label === target,
  }));
}

/**
 * Top individual users (Deutschland-wide).
 *
 * - `period === 'all'`  → reads the pre-aggregated lifetime list
 *   from the nightly aggregator doc (~free, instant on tap).
 * - `period === 'week'` or `'month'` → live Firestore query against
 *   the legacy `leaderboards` collection that
 *   `leaderboardService.updateUserStats(...)` keeps fresh on every
 *   points/savings event. One indexed query, top-25 docs, ~25 reads
 *   per session — basically free.
 *
 * Live results are cached in-memory for the session keyed by
 * (period, metric) so swiping back and forth doesn't re-fetch.
 */
const _liveCache = new Map<
  string,
  { rows: Omit<LbUser, 'isMe'>[]; fetchedAt: number }
>();
const LIVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

const PERIOD_KEY: Record<Exclude<LbPeriod, 'all'>, 'weekly' | 'monthly'> = {
  week: 'weekly',
  month: 'monthly',
};

export async function getOverallUsers(
  userNick?: string | null,
  period: LbPeriod = 'all',
  metric: LbMetric = 'pts',
): Promise<LbUser[]> {
  let source: Omit<LbUser, 'isMe'>[];
  if (period === 'all') {
    const snap = await fetchSnapshot();
    source = [...snap.topUsers].sort((a, b) =>
      metric === 'eur' ? b.eur - a.eur : b.pts - a.pts,
    );
  } else {
    source = await fetchLivePeriodTop(period, metric);
  }
  return source.map((u, i) => ({
    ...u,
    rank: i + 1,
    isMe: !!userNick && u.name === userNick,
  }));
}

async function fetchLivePeriodTop(
  period: Exclude<LbPeriod, 'all'>,
  metric: LbMetric,
): Promise<Omit<LbUser, 'isMe'>[]> {
  const cacheKey = `${period}|${metric}`;
  const cached = _liveCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < LIVE_CACHE_TTL_MS) {
    return cached.rows;
  }
  // The legacy doc shape uses `stats.points.weekly`, `stats.savings.monthly`,
  // etc. We map our metric/period to that shape and ask Firestore
  // to do the sort + limit server-side.
  const periodKey = PERIOD_KEY[period];
  const metricKey = metric === 'pts' ? 'points' : 'savings';
  const fieldPath = `stats.${metricKey}.${periodKey}`;
  try {
    // Pull 50 so the UI's 10-step "Mehr laden" has room to expand
    // a few times before exhausting the list. Cost is the same:
    // 50 reads per session per (period, metric), and only when the
    // user actually opens that tab (cached for 5 min after).
    const q = query(
      collection(db, 'leaderboards'),
      orderBy(fieldPath, 'desc'),
      fsLimit(50),
    );
    const snap = await getDocs(q);
    const rows: Omit<LbUser, 'isMe'>[] = [];
    snap.forEach((d, idx) => {
      const data = d.data() as any;
      const stats = data.stats || {};
      const ptsTotal = Number(stats.points?.[periodKey] || 0);
      const eurTotal = Number(stats.savings?.[periodKey] || 0);
      const value = metric === 'pts' ? ptsTotal : eurTotal;
      // Skip rows where the chosen metric is zero — they'd just
      // pad the bottom of the list with no information.
      if (value <= 0) return;
      const displayName = String(data.displayName || '').trim();
      if (
        !displayName ||
        displayName === 'Anonymer Nutzer' ||
        displayName === 'Anonymer Detektiv'
      ) {
        return;
      }
      const city = data.city ? normalizeCityName(data.city) : null;
      rows.push({
        id: d.id,
        rank: idx + 1,
        name: displayName,
        avatar: '🦉',
        photoUrl: data.photoUrl ?? null,
        city,
        bundesland: city ? CITY_TO_BUNDESLAND[city] || null : null,
        // The legacy doc doesn't carry currentLevel — fall back to a
        // rough estimate from total points. Good enough for the
        // "Level X" tag in the row.
        level: Math.max(
          1,
          Math.floor(Number(stats.points?.total || 0) / 1000) + 1,
        ),
        pts: ptsTotal,
        eur: eurTotal,
      });
    });
    _liveCache.set(cacheKey, { rows, fetchedAt: Date.now() });
    return rows;
  } catch (e) {
    console.warn('getOverallUsers: live period query failed', e);
    return [];
  }
}

/**
 * Lifetime contribution of the current user — read straight from
 * their userProfile (totalSavings + stats.pointsTotal). No
 * leaderboard fetch needed; the App already has the userProfile.
 */
export type UserContribution = {
  pts: number;
  eur: number;
  level: number;
  pctToNext: number;
  streakDays: number;
  city: string | null;
  bundesland: string | null;
};

export function userContributionFromProfile(
  userProfile: any,
): UserContribution | null {
  if (!userProfile) return null;
  const stats = userProfile.stats || {};
  return {
    pts: Number(stats.pointsTotal || 0),
    eur: Number(userProfile.totalSavings || 0),
    level: Number(stats.currentLevel || userProfile.level || 1),
    // Without a known nextLevel-threshold here, we just expose 0;
    // the UI can compute pct from level metadata if needed later.
    pctToNext: 0,
    streakDays: Number(stats.currentStreak || 0),
    city:
      userProfile.city ?? userProfile.guessedCity ?? null,
    bundesland:
      userProfile.bundesland ?? userProfile.guessedBundesland ?? null,
  };
}

/** When was the aggregate last refreshed? Useful for "Stand: heute" labels. */
export async function getAggregateUpdatedAt(): Promise<Date | null> {
  const snap = await fetchSnapshot();
  return snap.updatedAt > 0 ? new Date(snap.updatedAt) : null;
}

export type LbPosition = {
  /** 1-based exact rank if user is in the top-100, else null. */
  rank: number | null;
  /** "Better than X%" — 0..99. */
  percentile: number;
  /** Approximate global rank (estimated via percentile when not in top-100). */
  approxRank: number | null;
  totalUsers: number;
  /** Encouragement copy tied to the percentile / rank. */
  message: string;
};

/**
 * Compute the user's percentile + a motivational copy line. Mirrors
 * the old `leaderboardService.getPercentileMessage` ladder so the UX
 * stays familiar between the legacy /leaderboard screen and the new
 * Bestenliste tab.
 *
 * If the user is in the cached topUsers list we know their exact
 * rank. Otherwise we interpolate between the percentile thresholds
 * baked into the aggregate doc.
 */
export async function getUserPosition(
  userPts: number,
  userNick?: string | null,
): Promise<LbPosition> {
  const snap = await fetchSnapshot();
  const total = snap.totalUsersWithPts || 0;
  const hasThresholds = !!snap.percentileThresholds;

  // 1) Are they in the top-100 with a known display_name match?
  let exactRank: number | null = null;
  if (userNick) {
    const hit = snap.topUsers.find((u) => u.name === userNick);
    if (hit) exactRank = hit.rank;
  }

  // Always end up with a 0..99 percentile so the UI can always
  // render "Besser als X%". Three sources, in priority order:
  //   1. exact rank in top-100 → percentile from rank/total
  //   2. percentile thresholds → ladder lookup by userPts
  //   3. neither (aggregator pre-v4 / user not yet active) →
  //      pts-based heuristic so we still produce a number rather
  //      than falling back to a generic "data is loading" line
  //      (the user explicitly hated those).
  let percentile: number;
  if (exactRank !== null && total > 0) {
    percentile = Math.max(0, Math.round(((total - exactRank) / total) * 100));
  } else if (hasThresholds) {
    const t = snap.percentileThresholds!;
    if (userPts >= t.p1) percentile = 99;
    else if (userPts >= t.p5) percentile = 95;
    else if (userPts >= t.p10) percentile = 90;
    else if (userPts >= t.p25) percentile = 75;
    else if (userPts >= t.p50) percentile = 50;
    else if (userPts >= t.p75) percentile = 25;
    else if (userPts >= t.p90) percentile = 10;
    else percentile = 0;
  } else {
    // No thresholds in the doc yet — rough estimate based on the
    // user's points. Anyone with points is, at minimum, ahead of
    // the silent majority that has zero. Once the aggregator runs
    // again with v4 fields, this branch is dead and the real
    // percentile takes over.
    if (userPts >= 5000) percentile = 95;
    else if (userPts >= 2000) percentile = 90;
    else if (userPts >= 1000) percentile = 75;
    else if (userPts >= 500) percentile = 50;
    else if (userPts >= 100) percentile = 25;
    else if (userPts > 0) percentile = 10;
    else percentile = 0;
  }

  const approxRank =
    exactRank !== null
      ? exactRank
      : total > 0
        ? Math.max(1, Math.round(((100 - percentile) / 100) * total))
        : null;

  const message = motivationalLine(percentile, exactRank, userPts);

  return {
    rank: exactRank,
    // Don't leak the -1 sentinel to the UI. From the outside, "no
    // data" looks like 0 — the message + rank label do the rest.
    percentile,
    approxRank,
    totalUsers: total,
    message,
  };
}

/** Motivational line for the user's standing.
 *
 *  Two tiers:
 *    a) Top-100 — exact rank known. Copy plays the rank itself ("auf
 *       dem Treppchen", "Top 25", …) without spamming a percentile
 *       number that's basically 100% anyway.
 *    b) Outside Top-100 — exact rank unknown. Copy leans into the
 *       percentile number with strong "besser als alle anderen"
 *       framing, so even rank 80.000 reads as a positive milestone.
 *
 *  Each tier rotates through a small bank of variants so the same
 *  user sees something fresh on repeat opens. The variant is chosen
 *  deterministically per day so it doesn't change mid-session. */
function motivationalLine(
  percentile: number,
  rank: number | null,
  userPts: number,
): string {
  // Stable per-day index so the message doesn't flicker on re-renders
  // but does rotate across days/visits.
  const daySeed = Math.floor(Date.now() / 86_400_000);
  const pick = <T,>(arr: readonly T[]): T => arr[daySeed % arr.length];

  // Three-tier ladder per the user spec:
  //   1) rank ≤ 50 (exact, top 50)        → "Hammer Top 50! Greif oben an"
  //   2) percentile ≥ 90 (top 10% or better) → "Du gehörst zu den besten Y%"
  //                                            (Y = 100 − percentile, so
  //                                            percentile 95 → top 5%, etc.)
  //   3) everyone else                    → "Besser als X% aller Detektive"
  //
  // The 0-pts case keeps its own onboarding nudge so we don't tell
  // a brand-new user they're "Besser als 0%" — feels insulting.

  if (rank !== null && rank <= 50) {
    return pick([
      '🔥 Du bist der Hammer Top 50! Greif ganz oben an!',
      '🔥 Hammer — Top 50 in Deutschland! Greif ganz oben an.',
      '🔥 Top 50! Du bist der Hammer — die Spitze ist drin!',
    ]);
  }

  if (percentile >= 90) {
    const top = Math.max(1, 100 - percentile); // top 1% / top 5% / top 10%
    return pick([
      `💎 Du gehörst zu den besten ${top}% aller Detektive!`,
      `💎 Top ${top}% in Deutschland — beeindruckend, weiter so!`,
      `🏆 Du gehörst zu den besten ${top}% — Profi-Liga!`,
    ]);
  }

  if (percentile > 0) {
    return pick([
      `🚀 Besser als ${percentile}% aller Detektive!`,
      `📈 Besser als ${percentile}% — der Aufstieg läuft!`,
      `💪 ${percentile}% liegen schon hinter dir — weiter so!`,
    ]);
  }

  // percentile === 0 — either no thresholds yet or user is right at
  // the bottom. Differentiate by whether they have any points.
  if (userPts > 0) {
    return pick([
      '🚀 Erste Punkte sind drin — jetzt richtig durchstarten!',
      '💪 Erste Schritte gemacht — jede Aktion bringt dich nach oben!',
      '⭐ Der Aufstieg in die Liga beginnt jetzt!',
    ]);
  }
  return pick([
    '🎯 Sammle deine ersten Punkte und steig in die Liga ein!',
    '🚀 Eine Aktion fehlt — und schon bist du dabei!',
    '⭐ Bereit für den Aufstieg? Dein erster Scan zählt!',
  ]);
}
