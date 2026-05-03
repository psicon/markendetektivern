// Coachmark-Inhalt — Slide-Definitionen für die slide-basierten Touren.
//
// Aktuell nur EINE: `rewards`. Home läuft NICHT mehr über dieses Schema
// — die Home-Tour ist welcome + spotlight, geregelt vom
// `HomeWalkthrough.tsx`-Orchestrator. Wenn du den Wording-Stil dort
// anpassen willst, ist das die Stelle.

import type { TourKey } from '@/lib/services/coachmarkService';

// ─── Visual-Schema ───────────────────────────────────────────────
//
// Pro Slide entweder Lottie ODER Gradient-Icon. Lottie für Hero-
// Slides (visuell festlich), Gradient-Icon für sachlichere Slides
// (Mechaniken). Die Map LOTTIE_FILES in CoachmarkOverlay.tsx muss
// alle hier referenzierten Lottie-Keys enthalten.
export type SlideVisual =
  | { type: 'lottie'; lottie: LottieKey }
  | { type: 'gradient-icon'; icon: string; gradient: [string, string] };

// Erlaubte Lottie-Keys — exakt die Files die in CoachmarkOverlay
// per `require()` registriert sind. TS hilft hier doppelte
// Buchführung zu vermeiden.
export type LottieKey =
  | 'rocket'
  | 'search'
  | 'savings'
  | 'comparison'
  | 'task'
  | 'streak-fire'
  | 'points-earned'
  | 'swap'
  | 'gift';

export type Slide = {
  visual: SlideVisual;
  title: string;
  body: string;
};

export type Tour = {
  key: TourKey;
  slides: Slide[];
};

// Brand-Gradients für die "gradient-icon"-Visuals.
const GRADIENT_GOLD: [string, string] = ['#FFB347', '#FF7E5F'];

// Tour-Inhalte. `home` fehlt bewusst — siehe HomeWalkthrough.tsx.
type SlideTours = Extract<TourKey, 'rewards'>;

export const TOURS: Record<SlideTours, Tour> = {
  rewards: {
    key: 'rewards',
    slides: [
      {
        visual: {
          type: 'gradient-icon',
          icon: 'medal-outline',
          gradient: GRADIENT_GOLD,
        },
        title: 'Punkte und Taler',
        body:
          'Detektiv-Punkte misst deine Aktivität in der App. Cashback-Taler ist echtes Geld, das du dir auszahlen kannst, sobald du 5 € erreicht hast.',
      },
      {
        visual: { type: 'lottie', lottie: 'streak-fire' },
        title: 'Bestenliste',
        body:
          'Vergleich dich mit anderen Detektiven — wöchentlich, monatlich, all-time. Auch nach Bundesland und Stadt.',
      },
      {
        visual: { type: 'lottie', lottie: 'gift' },
        title: 'Sparen lohnt sich doppelt',
        body:
          'Jedes gekaufte No-Name-Produkt füllt deine Taler-Kasse. Auszahlen geht ab 5 € — direkt aufs Konto.',
      },
    ],
  },
};

export function getTour(key: SlideTours): Tour {
  return TOURS[key];
}
