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

export type LbScope = 'bundesland' | 'stadt';

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

// In-memory cache for the session — the aggregate is updated daily,
// no point re-fetching it on every Bestenliste-tap.
type Snapshot = {
  bundesland: Omit<LbRow, 'isMe'>[];
  cities: Omit<LbRow, 'isMe'>[];
  updatedAt: number;
  fetchedAt: number;
};
let _cache: Snapshot | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

async function fetchSnapshot(): Promise<Snapshot> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) return _cache;
  const snap = await getDoc(doc(db, 'aggregates', 'leaderboard_v1'));
  if (!snap.exists()) {
    return { bundesland: [], cities: [], updatedAt: 0, fetchedAt: Date.now() };
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
    // Normalize "Munich" → "München" etc. on read so the UI shows
    // German names regardless of what the IP-geocoder produced.
    label: normalizeCityName(r.label),
    bundesland: r.bl || CITY_TO_BUNDESLAND[r.label] || undefined,
    pts: Number(r.pts || 0),
    eur: Number(r.eur || 0),
    users: Number(r.users || 0),
    rank: Number(r.rank || 0),
  }));
  _cache = {
    bundesland,
    cities,
    updatedAt: data.updatedAt?.toMillis?.() ?? 0,
    fetchedAt: Date.now(),
  };
  return _cache;
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
 * Bundesland-Liga, sorted by Detektiv-Punkte. The user's row is
 * marked with `isMe = true` based on their userProfile.bundesland (or
 * guessedBundesland fallback), so the renderer doesn't have to do
 * matching.
 */
export async function getBundeslandRanks(
  userBundesland?: string | null,
): Promise<LbRow[]> {
  const snap = await fetchSnapshot();
  return snap.bundesland.map((r) => ({
    ...r,
    isMe: !!userBundesland && r.label === userBundesland,
  }));
}

/**
 * Städte-Liga, top 50 sorted by Detektiv-Punkte. Same isMe-marking
 * via userProfile.city / guessedCity.
 */
export async function getCityRanks(
  userCity?: string | null,
): Promise<LbRow[]> {
  const snap = await fetchSnapshot();
  const target = userCity ? normalizeCityName(userCity) : null;
  return snap.cities.map((r) => ({
    ...r,
    isMe: !!target && r.label === target,
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
