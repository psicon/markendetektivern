/**
 * Maps the pre-computed AI comparison score (aiComparison.score, 1–5) to the
 * verdict buckets used by the preference-profiling logic.
 *
 * Scale (see components/design/AiComparisonScale.tsx):
 *   1 = NoName clearly worse … 3 = equal … 5 = NoName clearly better.
 *
 * Buckets (decided 2026-06): 4–5 → "besser", 3 → "gleichwertig", 1–2 → "schlechter".
 * Only NoName products carry a verdict (a brand has no comparison to itself).
 */
export type AiVerdict = 'besser' | 'gleichwertig' | 'schlechter';

export function scoreToVerdict(score?: number | null): AiVerdict | undefined {
  if (typeof score !== 'number' || !Number.isFinite(score)) return undefined;
  if (score >= 4) return 'besser';
  if (score === 3) return 'gleichwertig';
  if (score >= 1) return 'schlechter';
  return undefined;
}
