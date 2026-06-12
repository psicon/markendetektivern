// HomeWalkthrough — die Onboarding-Tour für den Home-Screen.
//
// Architektur (refactored): Welcome-Modal raus. Beim ersten Home-
// Aufruf nach dem Onboarding wird DIREKT die DemoProductSpotlight
// gezeigt — der Tooltip darin ("Tippe diese Karte — du siehst
// gleich wie nah die NoName-Alternative am Original ist und wie
// viel du beim Wechsel sparst") liefert Kontext genug. Eine
// vorgeschaltete 3-Bullet-Welcome-Card war zu viel für den
// "Activation Through First Successful Action"-Pattern.
//
// Flow:
//   1. Visible=true → fetch demo product (parallel)
//   2. Demo-Produkt da → DemoProductSpotlight mountet
//   3. User tippt die Karte → navigation zu Detail/Vergleich →
//      Tour markiert als gesehen via useFocusEffect-Cleanup
//   4. Oder: User tippt "Überspringen" → onDismiss
//
// Bei Fetch-Fehler wird die Tour silent dismissed.

import { useFocusEffect } from 'expo-router';
import { safePush } from '@/lib/utils/safeNav';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CoachmarkService } from '@/lib/services/coachmarkService';
import { FirestoreService } from '@/lib/services/firestore';
import { remoteConfigService } from '@/lib/services/remoteConfigService';
import type { FirestoreDocument, Produkte } from '@/lib/types/firestore';
import { DemoProductSpotlight } from './DemoProductSpotlight';

// Bleibt exportiert für Backwards-Compat (Anchor-Pattern für
// künftige Multi-Step-Touren). Aktuell verwendet der Walkthrough
// das Anchor-System NICHT — die Demo-Karte rendert er selbst.
export const HOME_DEMO_ANCHOR_ID = 'home.demoProduct';

export type HomeWalkthroughProps = {
  visible: boolean;
  // mode: 'completed' (Tour zu Ende / Demo-Produkt getippt) vs.
  // 'skipped' (Überspringen / Fetch-Fail) — steuert den Demografie-
  // Sheet-Aufschub (2026-06-11).
  onDismiss: (mode?: 'completed' | 'skipped') => void;
};

// ─── Demo-Produkt-Resolver ──────────────────────────────────────
//
// Drei-Stufen-Fallback (siehe Kommentar in der vorigen Version):
//   1. Remote Config Key `coachmark_home_demo_product_id`
//   2. Top-Enttarnt-Random-Pool als Fallback
//   3. null → Tour silent dismissed
async function resolveDemoProductId(): Promise<string | null> {
  try {
    const fromRC = await remoteConfigService.getValue(
      'coachmark_home_demo_product_id',
    );
    if (typeof fromRC === 'string' && fromRC.trim().length > 0) {
      return fromRC.trim();
    }
  } catch (e) {
    console.warn('Coachmark: Remote Config read failed (non-fatal):', e);
  }
  try {
    const top = await FirestoreService.getTopEnttarnteProdukteRandomized(10, 1);
    if (top && top.length > 0) {
      return (top[0] as any).id ?? null;
    }
  } catch (e) {
    console.warn('Coachmark: Top-Enttarnt fallback failed (non-fatal):', e);
  }
  return null;
}

export function HomeWalkthrough({
  visible,
  onDismiss,
}: HomeWalkthroughProps) {
  const [demoProduct, setDemoProduct] =
    useState<FirestoreDocument<Produkte> | null>(null);
  const [demoFetchFailed, setDemoFetchFailed] = useState(false);

  // ─── Demo-Produkt fetchen ───────────────────────────────────
  useEffect(() => {
    if (!visible) {
      setDemoProduct(null);
      setDemoFetchFailed(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const productId = await resolveDemoProductId();
        if (cancelled) return;
        if (!productId) {
          setDemoFetchFailed(true);
          return;
        }
        const product = await FirestoreService.getProductWithDetails(productId);
        if (cancelled) return;
        if (!product) {
          setDemoFetchFailed(true);
          return;
        }
        setDemoProduct(product as any);
      } catch (e) {
        if (!cancelled) {
          console.warn('Coachmark demo product fetch failed:', e);
          setDemoFetchFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Walkthrough-Active-Tracking — Gamification-Notifications
  // queued solange Tour läuft, fired danach.
  useEffect(() => {
    CoachmarkService.setActive('home', visible);
    return () => {
      CoachmarkService.setActive('home', false);
    };
  }, [visible]);

  // Fetch-Fail → silent dismiss.
  useEffect(() => {
    if (visible && demoFetchFailed) {
      onDismiss('skipped');
    }
  }, [visible, demoFetchFailed, onDismiss]);

  // ─── Auto-Dismiss bei Navigation weg vom Home ────────────────
  // Wenn User in der Spotlight-Phase die Demo-Karte tippt, fährt
  // navigation zum Detail-Screen, Home blurred. Wir nutzen den
  // Blur als "Tour erfolgreich beendet"-Signal.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useFocusEffect(
    useCallback(() => {
      return () => {
        if (visibleRef.current) {
          onDismiss('completed');
        }
      };
    }, [onDismiss]),
  );

  const handleTapDemoProduct = useCallback(() => {
    if (!demoProduct) {
      onDismiss();
      return;
    }
    const stufeNum = parseInt(String((demoProduct as any).stufe ?? '1')) || 1;
    if (stufeNum <= 2) {
      FirestoreService.prefetchProductDetails(demoProduct.id);
      safePush(`/noname-detail/${demoProduct.id}` as any);
    } else {
      FirestoreService.prefetchComparisonData(demoProduct.id, false);
      safePush(`/product-comparison/${demoProduct.id}?type=noname` as any);
    }
  }, [demoProduct, onDismiss]);

  if (!visible) return null;
  // Demo-Produkt noch nicht da → nichts rendern (kurze Lücke
  // sichtbar, akzeptabel: ~200-400 ms Round-Trip).
  if (!demoProduct) return null;

  return (
    <DemoProductSpotlight
      visible
      product={demoProduct}
      title="Diese Karten siehst du überall"
      body="Markenprodukt oder günstige Alternative — tipp einfach drauf. Du siehst sofort alles: Preis, wie ähnlich beide sind, und wie viel du sparen kannst."
      onTapProduct={handleTapDemoProduct}
      onSkip={() => onDismiss('skipped')}
    />
  );
}
