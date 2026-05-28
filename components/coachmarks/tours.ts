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
        visual: { type: 'lottie', lottie: 'gift' },
        title: 'Echtes Geld zurück',
        body:
          'Hier sammelst du Cashback — richtiges Geld, das wir dir aufs Konto überweisen. Je mehr du mit MarkenDetektive sparst, desto mehr kommt dazu.',
      },
      {
        visual: {
          type: 'gradient-icon',
          icon: 'receipt',
          gradient: GRADIENT_GOLD,
        },
        title: 'So verdienst du',
        body:
          'Mach ein Foto von deinem Kassenbon, lade es hoch — fertig. Pro Bon bekommst du 0,08 €. Bis zu 6 Bons pro Woche. Bald gibt’s noch mehr Wege.',
      },
      {
        visual: { type: 'lottie', lottie: 'savings' },
        title: 'Auszahlen ab 5 €',
        body:
          'Sobald 5 € auf deinem Cashback-Konto sind, kannst du dir das Geld auszahlen lassen — direkt auf dein Bankkonto.',
      },
    ],
  },
};

export function getTour(key: SlideTours): Tour {
  return TOURS[key];
}
