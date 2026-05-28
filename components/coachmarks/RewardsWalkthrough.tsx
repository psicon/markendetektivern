// RewardsWalkthrough — Spotlight-Tour für den Belohnungen-Tab.
//
// Architektur parallel zu ProductDetailWalkthrough: ein persistenter
// SpotlightOverlay, nur Props ändern sich pro Phase. Smooth
// withSpring-Glide zwischen Phasen statt Modal-Slider.
//
// Phasen:
//   1. **hero**   — Spotlight auf die Cashback-Hero-Card. Erklärt,
//      dass das ein echtes Bankguthaben ist, was die Auszahlungs-
//      Schwelle bedeutet.
//   2. **earn**   — Spotlight auf die Schnellzugriff-Row (Kassenbon
//      scannen). Macht konkret was der User TUT um Cashback zu
//      verdienen + nennt das wöchentliche Limit.
//   3. **redeem** — Spotlight auf die "Cashback einlösen"-Card.
//      Erklärt, wie das Geld aufs Konto kommt sobald 10 € voll sind.
//
// Im Vergleich zum vorherigen Slide-Modal (CoachmarkOverlay):
//   • Pointet auf reale UI-Elemente → User lernt durch ZEIGEN, nicht
//     durch abstraktes Erklären.
//   • Reihenfolge folgt der User-Journey (Konto → Verdienen →
//     Auszahlen).
//   • Motivierende Sprache mit konkreten Zahlen statt nüchterner
//     Mechanik-Erklärung.
//
// Anchor-IDs sind exportiert; rewards.tsx muss sie EXAKT gleich
// verwenden.

import React, { useCallback, useEffect, useState } from 'react';

import { CoachmarkService } from '@/lib/services/coachmarkService';
import { SpotlightOverlay } from './SpotlightOverlay';

export const REWARDS_ANCHOR_HERO = 'rewards.hero';
export const REWARDS_ANCHOR_EARN = 'rewards.earn';
export const REWARDS_ANCHOR_REDEEM = 'rewards.redeem';

type Phase = 'hero' | 'earn' | 'redeem';

const PHASES_ORDER: Phase[] = ['hero', 'earn', 'redeem'];

export type RewardsWalkthroughProps = {
  visible: boolean;
  onDismiss: () => void;
};

function configForPhase(
  phase: Phase,
): { anchorId: string; title: string; body: string; lottie: any } {
  switch (phase) {
    case 'hero':
      return {
        anchorId: REWARDS_ANCHOR_HERO,
        title: 'Dein Cashback-Guthaben',
        body:
          'Hier siehst du, wie viel Geld du schon gesammelt hast. Sobald 10 € voll sind, überweisen wir dir den Betrag direkt aufs Bankkonto.',
        lottie: require('@/assets/lottie/gift.json'),
      };
    case 'earn':
      return {
        anchorId: REWARDS_ANCHOR_EARN,
        title: 'So sammelst du Cashback',
        body:
          'Mach ein Foto vom Kassenbon nach dem Einkauf — wir lesen ihn automatisch und schreiben dir bis zu 0,08 € pro Bon gut. Bis zu 6 Bons pro Woche, das sind ungefähr 2 € extra im Monat.',
        lottie: require('@/assets/lottie/task.json'),
      };
    case 'redeem':
      return {
        anchorId: REWARDS_ANCHOR_REDEEM,
        title: 'Auszahlen ab 10 €',
        body:
          'Ab 10 € kannst du dir dein Cashback auszahlen lassen. Tipp einfach auf „Cashback einlösen" — wir überweisen den vollen Betrag aufs Bankkonto.',
        lottie: require('@/assets/lottie/savings.json'),
      };
  }
}

export function RewardsWalkthrough({
  visible,
  onDismiss,
}: RewardsWalkthroughProps) {
  const [phase, setPhase] = useState<Phase>('hero');

  useEffect(() => {
    if (visible) setPhase('hero');
  }, [visible]);

  useEffect(() => {
    CoachmarkService.setActive('rewards', visible);
    return () => {
      CoachmarkService.setActive('rewards', false);
    };
  }, [visible]);

  const advance = useCallback(() => {
    const idx = PHASES_ORDER.indexOf(phase);
    if (idx < 0 || idx >= PHASES_ORDER.length - 1) {
      onDismiss();
      return;
    }
    setPhase(PHASES_ORDER[idx + 1]);
  }, [phase, onDismiss]);

  if (!visible) return null;

  const config = configForPhase(phase);
  const stepIndex = PHASES_ORDER.indexOf(phase) + 1;
  const totalSteps = PHASES_ORDER.length;
  const isLastStep = stepIndex === totalSteps;
  const primaryLabel = isLastStep
    ? 'Verstanden'
    : `Weiter (${stepIndex}/${totalSteps})`;

  // Hero + earn-row + redeem-Card sind alle groß — Pulse darauf wirkt
  // unruhig. Im Vergleich zu ProductDetailWalkthrough wo ab Phase 3
  // kleine Buttons gespotlighted werden (Pulse hilft Blick) sind hier
  // alle 3 Phasen "große Container". Daher disablePulse durchgängig.
  return (
    <SpotlightOverlay
      visible
      anchorId={config.anchorId}
      title={config.title}
      body={config.body}
      lottie={config.lottie}
      onSkip={onDismiss}
      onPrimary={advance}
      primaryLabel={primaryLabel}
      disablePulse
    />
  );
}
