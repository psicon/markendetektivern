/**
 * Survey-Targeting (ClickUp 86ca8fbpz).
 *
 * Reine Eligibility-Logik: entscheidet client-seitig, ob ein Poll für
 * den aktuellen User erscheinen darf. Polls sind public-read; wir laden
 * alle aktiven und filtern hier — kein Server-Roundtrip pro Poll.
 *
 * Mapping RevealyIQ-Enums ↔ App-Felder:
 *   • gender:  RevealyIQ 'male/female/diverse/prefer_not_to_say'
 *              ↔ App 'Männlich/Weiblich/Anderes' (users.gender)
 *   • regions: RevealyIQ-Region = deutsche Bundesland-Namen — 1:1 mit
 *              users.bundesland; 'Bundesweit' = kein Filter.
 *   • favoriteMarkets: RevealyIQ Market=string — toleranter Match gegen
 *              users.favoriteMarket (Discounter-ID) ODER favoriteMarketName.
 *
 * Default bei FEHLENDEM Targeting-Wert am User: wenn ein Kriterium gesetzt
 * ist, der User den Wert aber nicht hat → AUSSCHLIESSEN (konservativ: lieber
 * keine Umfrage als an die falsche Zielgruppe). profileTargeting + age/gender/
 * region/market verhalten sich alle so.
 */

import type { PreferenceProfile } from '@/lib/services/preferenceProfileService';
import type { Poll, PollGender } from '@/lib/types/survey';

export interface SurveyUserContext {
  age?: number | null;
  /** App-Form: 'Männlich' | 'Weiblich' | 'Anderes' (oder fehlend). */
  gender?: string | null;
  /** users.bundesland ?? guessedBundesland. */
  bundesland?: string | null;
  /** users.favoriteMarket (Discounter-ID). */
  favoriteMarket?: string | null;
  /** users.favoriteMarketName (Anzeigename). */
  favoriteMarketName?: string | null;
  isPremium?: boolean;
  profile?: PreferenceProfile | null;
}

/** App-Gender → RevealyIQ-Poll-Gender. */
export function mapAppGenderToPoll(appGender?: string | null): PollGender | null {
  switch ((appGender ?? '').trim()) {
    case 'Männlich':
      return 'male';
    case 'Weiblich':
      return 'female';
    case 'Anderes':
      return 'diverse';
    default:
      return null;
  }
}

function norm(s?: string | null): string {
  return (s ?? '').trim().toLowerCase();
}

/**
 * Ist der Poll für diesen User ausspielbar? Prüft NUR Targeting —
 * Status/Zeitfenster/bereits-beantwortet/Frequency prüft der Service.
 */
export function isPollEligible(poll: Poll, ctx: SurveyUserContext): boolean {
  const t = poll.targeting ?? {};

  // ── Alter ──
  if (typeof t.minAge === 'number' || typeof t.maxAge === 'number') {
    if (typeof ctx.age !== 'number') return false;
    if (typeof t.minAge === 'number' && ctx.age < t.minAge) return false;
    if (typeof t.maxAge === 'number' && ctx.age > t.maxAge) return false;
  }

  // ── Geschlecht ──
  if (Array.isArray(t.gender) && t.gender.length > 0) {
    const g = mapAppGenderToPoll(ctx.gender);
    if (!g || !t.gender.includes(g)) return false;
  }

  // ── Region (Bundesland) ──
  if (Array.isArray(t.regions) && t.regions.length > 0) {
    const wantsAll = t.regions.includes('Bundesweit');
    if (!wantsAll) {
      const userBl = norm(ctx.bundesland);
      if (!userBl) return false;
      if (!t.regions.some((r) => norm(r) === userBl)) return false;
    }
  }

  // ── Lieblingsmarkt ──
  if (Array.isArray(t.favoriteMarkets) && t.favoriteMarkets.length > 0) {
    const id = norm(ctx.favoriteMarket);
    const name = norm(ctx.favoriteMarketName);
    if (!id && !name) return false;
    const hit = t.favoriteMarkets.some((m) => {
      const mm = norm(m);
      return mm === id || mm === name;
    });
    if (!hit) return false;
  }

  // ── Premium ──
  if (typeof t.isPremium === 'boolean') {
    if (t.isPremium && !ctx.isPremium) return false;
    if (!t.isPremium && ctx.isPremium) return false;
  }

  // ── Präferenz-Profil ──
  if (Array.isArray(poll.profileTargeting) && poll.profileTargeting.length > 0) {
    const dims = ctx.profile?.dimensions;
    const conf = ctx.profile?.confidence;
    if (!dims) return false;
    for (const pt of poll.profileTargeting) {
      const v = typeof dims[pt.dimension] === 'number' ? dims[pt.dimension] : 0;
      if (v < pt.min) return false;
      if (typeof pt.minConfidence === 'number') {
        const c = conf && typeof conf[pt.dimension] === 'number' ? conf[pt.dimension] : 0;
        if (c < pt.minConfidence) return false;
      }
    }
  }

  return true;
}
