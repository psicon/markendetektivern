// Leaderboard service — individual user rankings + collective city battle.
//
// Phase 3 ships with MOCK data so the UI can be reviewed without a
// backend. The contract is intentionally narrow so the day Cloud
// Function aggregates land we only swap out the implementations
// here. Nothing else in the app touches the underlying data.
//
// Two concepts side-by-side, mirroring the prototype:
//   1. Individual user leaderboard — display_name + chosen city,
//      sorted by Detektiv-Punkte. Public listing relies on the user
//      having a chosen display_name (already public) and having
//      opted-in to share their city via the Region-Setup sheet.
//   2. Städte-Duell — anonymous aggregate per city, no user names.
//      This is the GDPR-friendly "kollektiv"-Konzept the user wanted
//      preserved as a complement to the user list.

export type LbScope = 'overall' | 'bundesland' | 'friends';
export type LbPeriod = 'month' | 'all';

export type LbUser = {
  /** Stable id (would be uid in real life, slugged nick for mock). */
  id: string;
  rank: number;
  /** Public display name (gamer-tag style). */
  name: string;
  /** Avatar emoji — can be replaced by a photo_url later. */
  avatar: string;
  /** User's opted-in city (free-text on the profile). */
  city: string;
  /** Detektiv-Punkte for the requested period. */
  pts: number;
  /** Cumulative Ersparnis in € for the requested period. */
  eur: number;
  /** True when this row is the current user. */
  isMe?: boolean;
};

export type LbCityBattleRow = {
  city: string;
  bundesland: string;
  pts: number;
  /** % change vs. last period — string with leading sign, e.g. "+4.2%". */
  delta: string;
};

// ─── Static Bundesland list — the 16 of them ────────────────────────────
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

// ─── Mock data — individual leaderboard ─────────────────────────────────
// Realistic-looking gamer-tag style nicknames + spoof user as
// "Hannah K." (matches the prototype). The "isMe" flag is set on the
// fly inside getLeaderboard once we know the current user's nick.
type RawUser = { name: string; avatar: string; city: string; bundesland: Bundesland };

const MOCK_USERS_OVERALL_MONTH: (RawUser & { pts: number; eur: number })[] = [
  { name: 'PreisjägerT',      avatar: '🦊', city: 'München',     bundesland: 'Bayern',                pts: 3210, eur: 128.4 },
  { name: 'AldiAgent23',      avatar: '🐻', city: 'Nürnberg',    bundesland: 'Bayern',                pts: 2980, eur: 112.9 },
  { name: 'SparfuchsMila',    avatar: '🦊', city: 'Augsburg',    bundesland: 'Bayern',                pts: 2760, eur: 98.2 },
  { name: 'Detektiv Dave',    avatar: '🕵️', city: 'Regensburg',  bundesland: 'Bayern',                pts: 2510, eur: 68.1 },
  { name: 'Hannah K.',        avatar: '🦉', city: 'München',     bundesland: 'Bayern',                pts: 2340, eur: 76.3 },
  { name: 'Billig-Betty',     avatar: '🐨', city: 'Würzburg',    bundesland: 'Bayern',                pts: 2120, eur: 54.4 },
  { name: 'KeinMarkusKeiner', avatar: '🦝', city: 'Ingolstadt',  bundesland: 'Bayern',                pts: 1980, eur: 84.5 },
  { name: 'NoNameNina',       avatar: '🐸', city: 'Erlangen',    bundesland: 'Bayern',                pts: 1740, eur: 42.8 },
  { name: 'Herr Sparschwein', avatar: '🐷', city: 'Bamberg',     bundesland: 'Bayern',                pts: 1520, eur: 31.5 },
  { name: 'BayernBlitz',      avatar: '🦁', city: 'München',     bundesland: 'Bayern',                pts: 1480, eur: 96.2 },
  { name: 'KölscherKlaus',    avatar: '🦄', city: 'Köln',        bundesland: 'Nordrhein-Westfalen',   pts: 1320, eur: 64.5 },
  { name: 'HamburgerHero',    avatar: '⚓', city: 'Hamburg',     bundesland: 'Hamburg',               pts: 1180, eur: 48.3 },
  { name: 'BerlinerBär',      avatar: '🐻', city: 'Berlin',      bundesland: 'Berlin',                pts: 1090, eur: 39.8 },
  { name: 'StuttgartStar',    avatar: '⭐', city: 'Stuttgart',   bundesland: 'Baden-Württemberg',     pts: 980,  eur: 34.2 },
  { name: 'Frankfurter F',    avatar: '🌭', city: 'Frankfurt',   bundesland: 'Hessen',                pts: 870,  eur: 28.7 },
];

const MOCK_USERS_OVERALL_ALL: (RawUser & { pts: number; eur: number })[] = [
  { name: 'PreisjägerT',      avatar: '🦊', city: 'München',     bundesland: 'Bayern',                pts: 41820, eur: 1284.4 },
  { name: 'AldiAgent23',      avatar: '🐻', city: 'Nürnberg',    bundesland: 'Bayern',                pts: 38420, eur: 1108.9 },
  { name: 'Detektiv Dave',    avatar: '🕵️', city: 'Regensburg',  bundesland: 'Bayern',                pts: 34100, eur: 624.1 },
  { name: 'SparfuchsMila',    avatar: '🦊', city: 'Augsburg',    bundesland: 'Bayern',                pts: 29760, eur: 892.2 },
  { name: 'Hannah K.',        avatar: '🦉', city: 'München',     bundesland: 'Bayern',                pts: 24340, eur: 682.3 },
  { name: 'Billig-Betty',     avatar: '🐨', city: 'Würzburg',    bundesland: 'Bayern',                pts: 22120, eur: 498.4 },
  { name: 'KeinMarkusKeiner', avatar: '🦝', city: 'Ingolstadt',  bundesland: 'Bayern',                pts: 19810, eur: 760.5 },
  { name: 'NoNameNina',       avatar: '🐸', city: 'Erlangen',    bundesland: 'Bayern',                pts: 17410, eur: 412.8 },
  { name: 'Herr Sparschwein', avatar: '🐷', city: 'Bamberg',     bundesland: 'Bayern',                pts: 15200, eur: 301.5 },
  { name: 'BayernBlitz',      avatar: '🦁', city: 'München',     bundesland: 'Bayern',                pts: 14820, eur: 894.2 },
  { name: 'KölscherKlaus',    avatar: '🦄', city: 'Köln',        bundesland: 'Nordrhein-Westfalen',   pts: 13320, eur: 644.5 },
  { name: 'HamburgerHero',    avatar: '⚓', city: 'Hamburg',     bundesland: 'Hamburg',               pts: 11800, eur: 488.3 },
];

const MOCK_CITY_BATTLE: LbCityBattleRow[] = [
  { city: 'München',    bundesland: 'Bayern',              pts: 842_000, delta: '+4.2%' },
  { city: 'Köln',       bundesland: 'Nordrhein-Westfalen', pts: 612_000, delta: '+2.1%' },
  { city: 'Augsburg',   bundesland: 'Bayern',              pts: 498_000, delta: '+6.8%' },
  { city: 'Hamburg',    bundesland: 'Hamburg',             pts: 312_000, delta: '+1.4%' },
  { city: 'Berlin',     bundesland: 'Berlin',              pts: 248_000, delta: '-0.8%' },
];

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Fetch the user leaderboard for the given scope + period.
 *
 * Scopes:
 *   • overall    — all users in Germany
 *   • bundesland — only users in `userBL` (returns empty if userBL is null)
 *   • friends    — placeholder; no friends feature yet, returns []
 *
 * The current user is identified by `userNick` (display_name) so the
 * matching row gets `isMe = true` for highlighting. If the user hasn't
 * chosen a display_name they won't be in the list.
 */
export async function getLeaderboard(
  scope: LbScope,
  period: LbPeriod,
  userBL?: string | null,
  userNick?: string | null,
): Promise<LbUser[]> {
  if (scope === 'friends') return [];
  const pool =
    period === 'month' ? MOCK_USERS_OVERALL_MONTH : MOCK_USERS_OVERALL_ALL;

  const filtered =
    scope === 'bundesland' && userBL
      ? pool.filter((u) => u.bundesland === userBL)
      : pool;

  return filtered
    .slice()
    .sort((a, b) => b.pts - a.pts)
    .map((u, i) => ({
      id: slug(u.name),
      rank: i + 1,
      name: u.name,
      avatar: u.avatar,
      city: u.city,
      pts: u.pts,
      eur: u.eur,
      isMe: !!userNick && u.name === userNick,
    }));
}

/**
 * The user's own contribution in the active period — pts + eur. Mock
 * for now; real implementation reads from userProfile.stats and a
 * period-keyed counter (Cloud Function maintains rolling-month
 * windows).
 */
export async function getUserContribution(
  period: LbPeriod,
  _userBL?: string | null,
  _userCity?: string | null,
): Promise<{ pts: number; eur: number; level: number; nextLevelInPts: number; pctToNext: number; streakDays: number; streakFreezes: number } | null> {
  // Mocked numbers matching the prototype (Hannah K.).
  return {
    pts: period === 'month' ? 2340 : 24340,
    eur: period === 'month' ? 76.3 : 682.3,
    level: 6,
    nextLevelInPts: 450,
    pctToNext: 85,
    streakDays: 18,
    streakFreezes: 2,
  };
}

/**
 * Top-N cities ranked by collective points. Anonymous aggregate, no
 * per-user data exposed. Used in the Städte-Duell widget below the
 * user leaderboard.
 */
export async function getCityBattle(
  _period: LbPeriod,
): Promise<LbCityBattleRow[]> {
  return MOCK_CITY_BATTLE;
}

/**
 * Best-effort suggestion of (Bundesland, city) for the current user
 * from their recent journey records. Phase 3 returns a plausible
 * default ('München'/'Bayern') so the setup-sheet has something to
 * show; the real implementation reads `journeys/<id>.location.city`
 * (we already store it via AnonymousLocationService) and runs it
 * through a city → Bundesland lookup table.
 */
export async function suggestRegionFromJourneys(_userId: string): Promise<{
  city: string | null;
  bundesland: Bundesland | null;
}> {
  return { city: 'München', bundesland: 'Bayern' };
}
