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

import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { CITY_TO_BUNDESLAND, normalizeCityName } from '@/lib/data/city-to-bundesland';

export type LbScope = 'overall' | 'bundesland' | 'stadt';
export type LbPeriod = 'all' | 'year' | 'month' | 'week';
export type LbMetric = 'pts' | 'eur';

/** True when the period has real data today. Year + week are stubs
 *  until the backend tracks per-period counters. */
export function isPeriodAvailable(p: LbPeriod): boolean {
  return p === 'all';
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
type Snapshot = {
  bundesland: Omit<LbRow, 'isMe'>[];
  cities: Omit<LbRow, 'isMe'>[];
  topUsers: Omit<LbUser, 'isMe'>[];
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
      _cache = {
        bundesland,
        cities,
        topUsers,
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
 * Top individual users (Deutschland-wide). Sort by the chosen
 * metric (pts or eur). Period-windowed periods return [] until the
 * backend tracks rolling counters.
 */
export async function getOverallUsers(
  userNick?: string | null,
  period: LbPeriod = 'all',
  metric: LbMetric = 'pts',
): Promise<LbUser[]> {
  if (period !== 'all') return [];
  const snap = await fetchSnapshot();
  const sorted = [...snap.topUsers].sort((a, b) =>
    metric === 'eur' ? b.eur - a.eur : b.pts - a.pts,
  );
  return sorted.map((u, i) => ({
    ...u,
    rank: i + 1,
    isMe: !!userNick && u.name === userNick,
  }));
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
