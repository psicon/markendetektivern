// Leaderboard service — collective city/Bundesland scoring.
//
// Phase 3 ships with MOCK data so the UI can be reviewed without a
// backend. The contract is intentionally narrow so the day Cloud
// Function aggregates land we only swap out the implementations
// here. Nothing else in the app touches the underlying collections.
//
// Concept (deliberately NOT individual user rankings):
//   • Each user's points are added anonymously to their CITY and
//     BUNDESLAND counters.
//   • Leaderboards rank cities/Bundesländer, not users.
//   • The user sees their own contribution privately (mini card) but
//     never appears as an individual on a public list.
// This is the GDPR-friendly variant: aggregate output, k-anonymity
// on the sale side, no per-user listing.

export type LbScope = 'bundesland' | 'stadt';
export type LbPeriod = 'month' | 'all';

export type LbRow = {
  /** Stable key — slug of the label, used for highlight matching. */
  key: string;
  /** Human-readable name shown in the list. */
  label: string;
  /** Bundesland name (cities only). */
  bundesland?: string;
  /** Score for the requested period. */
  pts: number;
  /** Aktuelle Position (1-based) in der gelieferten Sortierung. */
  rank: number;
  /** Highlight flag — set by the service when it matches the
   *  passed-in user region, so the renderer doesn't have to do that
   *  matching again. */
  isMe?: boolean;
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

// ─── Mock data ──────────────────────────────────────────────────────────
type BLEntry = { label: Bundesland; monthPts: number; allPts: number };
const MOCK_BL: BLEntry[] = [
  { label: 'Bayern', monthPts: 842_000, allPts: 12_400_000 },
  { label: 'Nordrhein-Westfalen', monthPts: 612_000, allPts: 9_800_000 },
  { label: 'Baden-Württemberg', monthPts: 498_000, allPts: 7_900_000 },
  { label: 'Niedersachsen', monthPts: 312_000, allPts: 4_400_000 },
  { label: 'Hessen', monthPts: 248_000, allPts: 3_500_000 },
  { label: 'Sachsen', monthPts: 198_000, allPts: 2_800_000 },
  { label: 'Rheinland-Pfalz', monthPts: 162_000, allPts: 2_100_000 },
  { label: 'Berlin', monthPts: 151_000, allPts: 2_050_000 },
  { label: 'Schleswig-Holstein', monthPts: 124_000, allPts: 1_700_000 },
  { label: 'Brandenburg', monthPts: 98_000, allPts: 1_300_000 },
  { label: 'Sachsen-Anhalt', monthPts: 86_000, allPts: 1_100_000 },
  { label: 'Hamburg', monthPts: 82_000, allPts: 1_080_000 },
  { label: 'Thüringen', monthPts: 76_000, allPts: 1_020_000 },
  { label: 'Mecklenburg-Vorpommern', monthPts: 58_000, allPts: 720_000 },
  { label: 'Saarland', monthPts: 41_000, allPts: 540_000 },
  { label: 'Bremen', monthPts: 35_000, allPts: 460_000 },
];

type CityEntry = { label: string; bundesland: Bundesland; monthPts: number; allPts: number };
const MOCK_CITIES: CityEntry[] = [
  { label: 'München', bundesland: 'Bayern', monthPts: 184_000, allPts: 2_400_000 },
  { label: 'Köln', bundesland: 'Nordrhein-Westfalen', monthPts: 156_000, allPts: 2_080_000 },
  { label: 'Hamburg', bundesland: 'Hamburg', monthPts: 82_000, allPts: 1_080_000 },
  { label: 'Berlin', bundesland: 'Berlin', monthPts: 151_000, allPts: 2_050_000 },
  { label: 'Stuttgart', bundesland: 'Baden-Württemberg', monthPts: 124_000, allPts: 1_900_000 },
  { label: 'Frankfurt am Main', bundesland: 'Hessen', monthPts: 118_000, allPts: 1_650_000 },
  { label: 'Düsseldorf', bundesland: 'Nordrhein-Westfalen', monthPts: 96_000, allPts: 1_400_000 },
  { label: 'Nürnberg', bundesland: 'Bayern', monthPts: 92_000, allPts: 1_360_000 },
  { label: 'Dortmund', bundesland: 'Nordrhein-Westfalen', monthPts: 78_000, allPts: 1_120_000 },
  { label: 'Essen', bundesland: 'Nordrhein-Westfalen', monthPts: 72_000, allPts: 980_000 },
  { label: 'Leipzig', bundesland: 'Sachsen', monthPts: 68_000, allPts: 940_000 },
  { label: 'Dresden', bundesland: 'Sachsen', monthPts: 62_000, allPts: 860_000 },
  { label: 'Bremen', bundesland: 'Bremen', monthPts: 35_000, allPts: 460_000 },
  { label: 'Hannover', bundesland: 'Niedersachsen', monthPts: 56_000, allPts: 780_000 },
  { label: 'Augsburg', bundesland: 'Bayern', monthPts: 48_000, allPts: 690_000 },
  { label: 'Mannheim', bundesland: 'Baden-Württemberg', monthPts: 44_000, allPts: 620_000 },
  { label: 'Karlsruhe', bundesland: 'Baden-Württemberg', monthPts: 42_000, allPts: 580_000 },
  { label: 'Bonn', bundesland: 'Nordrhein-Westfalen', monthPts: 40_000, allPts: 540_000 },
  { label: 'Wiesbaden', bundesland: 'Hessen', monthPts: 38_000, allPts: 510_000 },
  { label: 'Münster', bundesland: 'Nordrhein-Westfalen', monthPts: 36_000, allPts: 480_000 },
  { label: 'Mainz', bundesland: 'Rheinland-Pfalz', monthPts: 34_000, allPts: 450_000 },
  { label: 'Regensburg', bundesland: 'Bayern', monthPts: 32_000, allPts: 420_000 },
  { label: 'Kiel', bundesland: 'Schleswig-Holstein', monthPts: 30_000, allPts: 410_000 },
  { label: 'Saarbrücken', bundesland: 'Saarland', monthPts: 28_000, allPts: 380_000 },
  { label: 'Erfurt', bundesland: 'Thüringen', monthPts: 26_000, allPts: 360_000 },
  { label: 'Magdeburg', bundesland: 'Sachsen-Anhalt', monthPts: 24_000, allPts: 320_000 },
  { label: 'Potsdam', bundesland: 'Brandenburg', monthPts: 22_000, allPts: 290_000 },
  { label: 'Rostock', bundesland: 'Mecklenburg-Vorpommern', monthPts: 20_000, allPts: 270_000 },
  { label: 'Schwerin', bundesland: 'Mecklenburg-Vorpommern', monthPts: 14_000, allPts: 180_000 },
  { label: 'Lübeck', bundesland: 'Schleswig-Holstein', monthPts: 18_000, allPts: 240_000 },
];

// ─── Helpers ────────────────────────────────────────────────────────────
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
 * Fetch the leaderboard for a given scope (Bundesländer or Cities) and
 * period (month or all-time). The user's region is passed in so the
 * service can mark the matching row as `isMe` for highlighting.
 *
 * Today returns mock data instantly; tomorrow this is a Firestore read
 * against the aggregate counter collections.
 */
export async function getLeaderboard(
  scope: LbScope,
  period: LbPeriod,
  userBL?: string | null,
  userCity?: string | null,
): Promise<LbRow[]> {
  const ptsKey = period === 'month' ? 'monthPts' : 'allPts';
  if (scope === 'bundesland') {
    const sorted = [...MOCK_BL].sort((a, b) => b[ptsKey] - a[ptsKey]);
    return sorted.map((r, i) => ({
      key: slug(r.label),
      label: r.label,
      pts: r[ptsKey],
      rank: i + 1,
      isMe: !!userBL && userBL === r.label,
    }));
  }
  const sorted = [...MOCK_CITIES].sort((a, b) => b[ptsKey] - a[ptsKey]);
  return sorted.map((r, i) => ({
    key: slug(r.label),
    label: r.label,
    bundesland: r.bundesland,
    pts: r[ptsKey],
    rank: i + 1,
    isMe: !!userCity && userCity === r.label,
  }));
}

/**
 * The user's own contribution to their city / Bundesland for the given
 * period. Mock for now — wired to the live counters once the backend
 * exists. Returns null when the user hasn't picked a region.
 */
export async function getUserContribution(
  period: LbPeriod,
  userBL?: string | null,
  userCity?: string | null,
): Promise<{ pts: number; city: string; bundesland: string } | null> {
  if (!userBL || !userCity) return null;
  // Mock: 240 pts this month, 4_200 all-time.
  return {
    pts: period === 'month' ? 240 : 4_200,
    city: userCity,
    bundesland: userBL,
  };
}

/**
 * Best-effort suggestion of (Bundesland, city) for the current user
 * from their recent journey records. Phase 3 returns a plausible
 * default ('München'/'Bayern') so the setup-sheet has something to
 * show; the real implementation reads the most-recent
 * `journeys/<id>.location.city` and runs it through a city→Bundesland
 * lookup table.
 */
export async function suggestRegionFromJourneys(_userId: string): Promise<{
  city: string | null;
  bundesland: Bundesland | null;
}> {
  // Phase 3 stub. Returns München / Bayern as a placeholder — the
  // real journey query slots in here.
  return { city: 'München', bundesland: 'Bayern' };
}
