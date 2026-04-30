// ProductDetailWalkthrough — Tour für die Produktdetail-Screens
// (noname-detail UND product-comparison).
//
// 5-Step-Spotlight-Sequenz, KEINE Welcome-Card mehr (User-Feedback:
// "die kannst du dir sparen" — der Walkthrough soll direkt los).
//
// Reihenfolge:
//   1. **hero**     — Spotlight auf das Hero (Markenprodukt auf
//      comparison, NoName auf noname-detail). "Was du gerade siehst".
//   2. **context**  — Spotlight auf den NoName-Carousel (comparison)
//      bzw. die Stufen-Indicator-Zeile (noname-detail). Erklärt
//      Ähnlichkeitsstufen.
//   3. **favorite** — Heart-Button.
//   4. **cart**     — Cart-Plus-Button.
//   5. **rating**   — Star-Button.
//
// Anchor-IDs sind exportiert; die Detail-Screens müssen sie EXAKT
// gleich verwenden (single source of truth).

import React, { useCallback, useEffect, useState } from 'react';

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
   * Welcher Detail-Screen mountet die Tour. Beeinflusst die Texte
   * der hero- und context-Phasen (Markenprodukt vs NoName-Produkt;
   * NoName-Carousel vs Stufen-Indicator-Zeile).
   */
  screenType: ProductDetailScreenType;
};

export function ProductDetailWalkthrough({
  visible,
  onDismiss,
  screenType,
}: ProductDetailWalkthroughProps) {
  const [phase, setPhase] = useState<Phase>('hero');

  // Beim erneuten Sichtbarwerden zurück auf die erste Phase —
  // sonst landet ein Replay aus dem Dev-Panel mitten in der Tour.
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

  if (!visible) return null;

  const stepIndex = PHASES_ORDER.indexOf(phase) + 1; // 1-indexed
  const totalSteps = PHASES_ORDER.length; // 5
  const isLastStep = stepIndex === totalSteps;
  const primaryLabel = isLastStep
    ? 'Fertig'
    : `Weiter (${stepIndex}/${totalSteps})`;

  // ─── Phase 1: Hero ────────────────────────────────────────────
  if (phase === 'hero') {
    if (screenType === 'comparison') {
      return (
        <SpotlightOverlay
          visible
          anchorId={PRODUCT_DETAIL_ANCHOR_HERO}
          title="Das Markenprodukt"
          body="Hier siehst du das Original — Hersteller, Bild und Marken-Preis. Darunter zeigen wir dir günstigere NoName-Alternativen."
          onSkip={onDismiss}
          skipLabel="Tour beenden"
          onPrimary={advance}
          primaryLabel={primaryLabel}
        />
      );
    }
    return (
      <SpotlightOverlay
        visible
        anchorId={PRODUCT_DETAIL_ANCHOR_HERO}
        title="Das NoName-Produkt"
        body="Hier siehst du Bild, Hersteller und Preis. Darunter zeigen wir dir die Ähnlichkeitsstufe — wie nah das Produkt einem Markenprodukt kommt."
        onSkip={onDismiss}
        skipLabel="Tour beenden"
        onPrimary={advance}
        primaryLabel={primaryLabel}
      />
    );
  }

  // ─── Phase 2: Context (Carousel oder Stufen) ─────────────────
  if (phase === 'context') {
    if (screenType === 'comparison') {
      return (
        <SpotlightOverlay
          visible
          anchorId={PRODUCT_DETAIL_ANCHOR_CONTEXT}
          title="NoName-Alternativen"
          body="Diese NoName-Produkte kommen vom selben Hersteller wie das Markenprodukt oben. Die Stufen-Balken zeigen dir, wie nah dran sie sind: Stufe 5 = identisch, 4 = sehr ähnlich, 3 = vergleichbar."
          onSkip={onDismiss}
          skipLabel="Tour beenden"
          onPrimary={advance}
          primaryLabel={primaryLabel}
        />
      );
    }
    return (
      <SpotlightOverlay
        visible
        anchorId={PRODUCT_DETAIL_ANCHOR_CONTEXT}
        title="Ähnlichkeitsstufe"
        body="Stufen 1 und 2 stehen für reine NoName-Hersteller bzw. Hersteller die nebenbei auch Markenprodukte produzieren — ohne direkten Marken-Vergleich. Bei Stufen 3-5 findest du das passende Markenprodukt + günstigere Alternativen."
        onSkip={onDismiss}
        skipLabel="Tour beenden"
        onPrimary={advance}
        primaryLabel={primaryLabel}
      />
    );
  }

  // ─── Phase 3: Favorite ───────────────────────────────────────
  if (phase === 'favorite') {
    return (
      <SpotlightOverlay
        visible
        anchorId={PRODUCT_DETAIL_ANCHOR_FAVORITE}
        title="Favorisieren"
        body="Tippe um das Produkt als Lieblingsprodukt zu speichern. Du findest deine Favoriten unter Lieblingsprodukte im Profil."
        onSkip={onDismiss}
        skipLabel="Tour beenden"
        onPrimary={advance}
        primaryLabel={primaryLabel}
      />
    );
  }

  // ─── Phase 4: Cart ───────────────────────────────────────────
  if (phase === 'cart') {
    return (
      <SpotlightOverlay
        visible
        anchorId={PRODUCT_DETAIL_ANCHOR_CART}
        title="Einkaufsliste"
        body="Tippe hier um das Produkt zur Einkaufsliste hinzuzufügen. Wir tracken automatisch wie viel du beim Wechsel sparst."
        onSkip={onDismiss}
        skipLabel="Tour beenden"
        onPrimary={advance}
        primaryLabel={primaryLabel}
      />
    );
  }

  // ─── Phase 5: Rating ─────────────────────────────────────────
  return (
    <SpotlightOverlay
      visible
      anchorId={PRODUCT_DETAIL_ANCHOR_RATING}
      title="Bewertungen"
      body="Tippe um das Produkt zu bewerten oder zu sehen was andere Detektive davon halten."
      onSkip={onDismiss}
      skipLabel="Tour beenden"
      onPrimary={onDismiss}
      primaryLabel="Fertig"
    />
  );
}
