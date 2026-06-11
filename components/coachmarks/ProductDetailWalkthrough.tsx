// ProductDetailWalkthrough — Tour für die Produktdetail-Screens
// (noname-detail UND product-comparison).
//
// Architektur (refactored): EIN persistenter SpotlightOverlay,
// nur die Props (anchorId, title, body) ändern sich pro Phase.
// React reconciled das auf dieselbe Instanz → die animated
// rect-shared-values im SpotlightOverlay erhalten ihre Werte und
// können mit `withSpring` smooth zur neuen Position gleiten,
// statt zwischen Phasen unmount/remount-Crossfades zu machen.
//
// Phasen:
//   1. **hero**     — Spotlight auf das Hero (Markenprodukt /
//      NoName).
//   2. **context**  — Carousel mit Stufen (comparison) bzw.
//      Stufen-Indicator (noname).
//   3. **favorite** — Heart-Button.
//   4. **cart**     — Cart-Plus-Button.
//   5. **rating**   — Star-Button.
//
// Anchor-IDs sind exportiert; die Detail-Screens müssen sie EXAKT
// gleich verwenden.

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { CoachmarkService } from '@/lib/services/coachmarkService';
import { SpotlightOverlay } from './SpotlightOverlay';

export const PRODUCT_DETAIL_ANCHOR_HERO = 'product.hero';
export const PRODUCT_DETAIL_ANCHOR_CONTEXT = 'product.context';
export const PRODUCT_DETAIL_ANCHOR_CART = 'product.cart';
export const PRODUCT_DETAIL_ANCHOR_FAVORITE = 'product.favorite';
export const PRODUCT_DETAIL_ANCHOR_RATING = 'product.rating';

type Phase = 'hero' | 'context' | 'favorite' | 'cart' | 'rating';

const PHASES_ORDER: Phase[] = [
  'hero',
  'context',
  'favorite',
  'cart',
  'rating',
];

export type ProductDetailScreenType = 'noname' | 'comparison';

export type ProductDetailWalkthroughProps = {
  visible: boolean;
  onDismiss: () => void;
  /**
   * Welcher Detail-Screen mountet die Tour. Beeinflusst Texte
   * der hero- und context-Phasen.
   */
  screenType: ProductDetailScreenType;
};

// Pro Phase: anchor + title + body. screenType-aware für Phasen
// die unterschiedliche Texte/Anchors je Detail-Typ brauchen.
function configForPhase(
  phase: Phase,
  screenType: ProductDetailScreenType,
): { anchorId: string; title: string; body: string } {
  switch (phase) {
    case 'hero':
      return screenType === 'comparison'
        ? {
            anchorId: PRODUCT_DETAIL_ANCHOR_HERO,
            title: 'Das Markenprodukt',
            body:
              'Das ist die Marke — Name, Bild und Preis. Drunter zeigen wir dir günstigere Alternativen, die fast gleich sind.',
          }
        : {
            anchorId: PRODUCT_DETAIL_ANCHOR_HERO,
            title: 'Die günstige Alternative',
            body:
              'Bild, Hersteller und Preis siehst du hier. Drunter steht, wie ähnlich das Produkt einem teureren Markenprodukt ist.',
          };
    case 'context':
      return screenType === 'comparison'
        ? {
            anchorId: PRODUCT_DETAIL_ANCHOR_CONTEXT,
            title: 'Günstigere Alternativen',
            body:
              'Diese Produkte kommen vom selben Hersteller wie das Original oben — kosten aber weniger. Die Balken zeigen, wie ähnlich sie sind: 5 = identisch, 4 = sehr ähnlich, 3 = vergleichbar.',
          }
        : {
            anchorId: PRODUCT_DETAIL_ANCHOR_CONTEXT,
            title: 'Wie ähnlich ist es einer Marke?',
            body:
              'Die Balken zeigen die Ähnlichkeit. Ab Stufe 3 findest du auch das passende Markenprodukt direkt zum Vergleichen — und siehst, was du beim Wechsel sparst.',
          };
    case 'favorite':
      return {
        anchorId: PRODUCT_DETAIL_ANCHOR_FAVORITE,
        title: 'Als Lieblingsprodukt speichern',
        body:
          'Tipp aufs Herz, um dir das Produkt zu merken. Du findest es später unter „Lieblingsprodukte" im Profil wieder.',
      };
    case 'cart':
      return {
        anchorId: PRODUCT_DETAIL_ANCHOR_CART,
        title: 'Auf den Einkaufszettel',
        body:
          'Tipp drauf, um das Produkt zum Einkaufszettel hinzuzufügen. Die Liste rechnet automatisch zusammen, wie viel du sparen wirst.',
      };
    case 'rating':
      return {
        anchorId: PRODUCT_DETAIL_ANCHOR_RATING,
        title: 'Wie schmeckt’s dir?',
        body:
          'Bewerte das Produkt mit Sternen — oder schau erst mal, was andere Detektive davon halten.',
      };
  }
}

export function ProductDetailWalkthrough({
  visible,
  onDismiss,
  screenType,
}: ProductDetailWalkthroughProps) {
  const [phase, setPhase] = useState<Phase>('hero');

  // Beim erneuten Sichtbarwerden zurück auf die erste Phase.
  useEffect(() => {
    if (visible) setPhase('hero');
  }, [visible]);

  // Walkthrough-Active-Tracking — Gamification-Notifications
  // queued solange Tour läuft, fired danach.
  useEffect(() => {
    CoachmarkService.setActive('product-detail', visible);
    return () => {
      CoachmarkService.setActive('product-detail', false);
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

  const config = useMemo(
    () => configForPhase(phase, screenType),
    [phase, screenType],
  );

  if (!visible) return null;

  const stepIndex = PHASES_ORDER.indexOf(phase) + 1;
  const totalSteps = PHASES_ORDER.length;
  const isLastStep = stepIndex === totalSteps;
  const primaryLabel = isLastStep
    ? 'Fertig'
    : `Weiter (${stepIndex}/${totalSteps})`;

  // EIN persistenter Overlay über alle Phasen — der gleiche
  // Component-Tree, nur Props ändern sich. React reconciled, die
  // animated Rect-Werte im Overlay bleiben erhalten und gleiten
  // mit `withSpring` zur neuen Position (siehe SpotlightOverlay).
  //
  // T17.28: Pulse-Animation jetzt auf ALLEN Phasen aktiv. Vorher
  // war sie auf hero+context aus (Argument: zu unruhig auf großen
  // Containern). In der Praxis war das aber „animation fehlt
  // teilweise"-Gefühl — die subtile Atem-Animation hilft auch bei
  // großen Targets, weil sie klar signalisiert WELCHES Element
  // gerade beschrieben wird.

  return (
    <SpotlightOverlay
      visible
      anchorId={config.anchorId}
      title={config.title}
      body={config.body}
      onSkip={() => onDismiss()}
      skipLabel="Tour beenden"
      onPrimary={isLastStep ? () => onDismiss() : advance}
      primaryLabel={primaryLabel}
    />
  );
}
