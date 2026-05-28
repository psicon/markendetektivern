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
//      Erklärt, wie das Geld aufs Konto kommt sobald 5 € voll sind.
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
): { anchorId: string; title: string; body: string } {
  switch (phase) {
    case 'hero':
      return {
        anchorId: REWARDS_ANCHOR_HERO,
        title: 'Dein Cashback-Konto',
        body:
          'Hier wächst echtes Geld — kein Punkte-System, kein Gutschein-Trick. Was du hier siehst, zahlen wir dir aufs Bankkonto aus, sobald 5 € voll sind.',
      };
    case 'earn':
      return {
        anchorId: REWARDS_ANCHOR_EARN,
        title: 'So füllst du dein Konto',
        body:
          'Foto vom Kassenbon machen, hochladen — wir lesen ihn automatisch. 0,08 € pro Bon, bis zu 6 Bons pro Woche. Das macht bis zu 2 € extra im Monat, einfach so beim Einkaufen.',
      };
    case 'redeem':
      return {
        anchorId: REWARDS_ANCHOR_REDEEM,
        title: 'Auszahlen ab 5 €',
        body:
          'Sobald 5 € voll sind, tipp einfach auf „Cashback einlösen". Wir überweisen direkt auf dein Bankkonto. Keine Bedingungen, keine Provision — dein Geld gehört dir.',
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
      onSkip={onDismiss}
      onPrimary={advance}
      primaryLabel={primaryLabel}
      disablePulse
    />
  );
}
