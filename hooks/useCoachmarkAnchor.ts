// useCoachmarkAnchor — Registry-Hook für Spotlight-Targets.
//
// Pattern: jeder Screen, der ein UI-Element mal als Spotlight-Target
// braucht, wickelt es so ein:
//
//   const demoCard = useCoachmarkAnchor('home.demoProduct');
//   <View ref={demoCard.ref} onLayout={demoCard.onLayout}>...</View>
//
// Die Spotlight-Engine fragt dann via `subscribeAnchor('home.demoProduct',
// listener)` die aktuellen Bildschirm-Coords ab. Anchor-IDs sind
// frei wählbare Strings, Empfehlung: `<screen>.<element>` für Lesbarkeit.
//
// ─── Zwei Mess-Modi ──────────────────────────────────────────────
//
// **Modus A — innerhalb einer ScrollView (preferred):**
// Wenn `<CoachmarkScrollProvider>` über dem Hook hängt, messen wir
// via `measureLayout(scrollViewRef.current, …)` die Position
// RELATIV zum ScrollView-Content. Das ist STABIL — sie ändert sich
// NICHT wenn die ScrollView scrollt. Das Spotlight kombiniert
// diesen layoutY mit dem SharedValue scrollY auf jedem Frame, um
// die Window-Position abzuleiten. Resultat: Spotlight wandert in
// Echtzeit mit dem Scroll mit, kein Stale-Rect, keine Timer.
//
// **Modus B — Fallback ohne ScrollView (statisch):**
// Wenn kein Provider da ist (z.B. Screen ohne Scroll), messen wir
// via `measureInWindow` die absolute Window-Position. Der Spotlight
// rendert dann an dieser Position. Funktioniert solange das Element
// sich nicht bewegt.
//
// Der Hook entscheidet automatisch je nach Provider-Verfügbarkeit.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { findNodeHandle, View } from 'react-native';
import { useCoachmarkScrollContext } from '@/components/coachmarks/CoachmarkScrollContext';

export type AnchorRect = {
  // Position — entweder content-relativ (measureLayout) oder
  // window-absolut (measureInWindow), abhängig vom Mess-Modus.
  // `space` markiert, in welchem Koordinaten-System die Werte sind:
  //   • 'layout' = relativ zum ScrollView-Content
  //   • 'window' = absolut im Bildschirm
  // Der Spotlight braucht das, um zu wissen ob er scrollY draufrechnen
  // muss oder nicht.
  space: 'layout' | 'window';
  x: number;
  y: number;
  width: number;
  height: number;
};

// Modul-globaler Storage. Map statt Set damit Anchor-IDs
// deterministisch eindeutig bleiben (zweiter Mount überschreibt
// ersten, kein Duplikat).
const anchors = new Map<string, AnchorRect>();
type Listener = (rect: AnchorRect | null) => void;
const subscribers = new Map<string, Set<Listener>>();

function notify(id: string, rect: AnchorRect | null) {
  const subs = subscribers.get(id);
  if (!subs) return;
  for (const fn of Array.from(subs)) {
    try {
      fn(rect);
    } catch (e) {
      console.warn('Coachmark anchor listener threw (non-fatal):', e);
    }
  }
}

function isValidRect(x: number, y: number, w: number, h: number) {
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(w) &&
    Number.isFinite(h) &&
    w > 0 &&
    h > 0
  );
}

/**
 * Synchroner Lookup. Liefert `null` wenn Anchor noch nicht gemessen
 * oder wieder unmountet.
 */
export function getAnchor(id: string): AnchorRect | null {
  return anchors.get(id) ?? null;
}

/**
 * Subscribe-API für die Spotlight-Engine. Pusht den aktuell
 * bekannten Rect (falls vorhanden) sofort an den Listener — damit
 * das Spotlight nicht "blank" startet wenn der Anchor schon vorher
 * gemessen war.
 */
export function subscribeAnchor(id: string, listener: Listener): () => void {
  let subs = subscribers.get(id);
  if (!subs) {
    subs = new Set();
    subscribers.set(id, subs);
  }
  subs.add(listener);
  const current = anchors.get(id);
  if (current) {
    try {
      listener(current);
    } catch (e) {
      console.warn('Coachmark anchor initial-push threw (non-fatal):', e);
    }
  }
  return () => {
    subs!.delete(listener);
    if (subs!.size === 0) {
      subscribers.delete(id);
    }
  };
}

/**
 * Hook für Screens — bindet eine Anchor-ID an ein konkretes UI-Element.
 *
 * Returns ein Objekt mit:
 *   • `ref`      — auf das Ziel-View gelegt: `<View ref={anchor.ref}>`
 *   • `onLayout` — ebenfalls auf das Ziel-View gelegt
 *
 * Beim Unmount wird der Anchor automatisch aus dem Registry entfernt
 * und alle Listener mit `null` informiert.
 */
export function useCoachmarkAnchor(id: string) {
  const ref = useRef<View | null>(null);
  // Context wird im selben Render gelesen wie der Hook benutzt wird
  // — wenn der Caller den Provider falsch verschachtelt, kriegt er
  // automatisch Modus B (window-absolute) als Fallback. Kein Crash.
  const ctx = useCoachmarkScrollContext();

  const measure = useCallback(() => {
    const view = ref.current;
    if (!view) return;
    requestAnimationFrame(() => {
      try {
        // ── Modus A: measureLayout relativ zur ScrollView ──
        // Das gibt uns content-relative Coords, die nicht mit
        // dem Scroll-Offset wandern. Spotlight kombiniert sie mit
        // dem aktuellen scrollY zur Render-Zeit.
        if (ctx?.scrollViewRef.current) {
          const sv = ctx.scrollViewRef.current as any;
          const scrollViewHandle = findNodeHandle(sv);
          if (scrollViewHandle != null) {
            view.measureLayout(
              scrollViewHandle,
              (x, y, width, height) => {
                if (!isValidRect(x, y, width, height)) return;
                const rect: AnchorRect = {
                  space: 'layout',
                  x,
                  y,
                  width,
                  height,
                };
                anchors.set(id, rect);
                notify(id, rect);
              },
              () => {
                // Fehler beim measureLayout (z.B. View nicht
                // mehr im Tree) → still ignorieren, der Anchor
                // bleibt einfach unbesetzt.
              },
            );
            return;
          }
        }
        // ── Modus B: measureInWindow absolute Window-Coords ──
        view.measureInWindow((x, y, width, height) => {
          if (!isValidRect(x, y, width, height)) return;
          const rect: AnchorRect = {
            space: 'window',
            x,
            y,
            width,
            height,
          };
          anchors.set(id, rect);
          notify(id, rect);
        });
      } catch {
        // View bereits unmounted oder native Bridge unavailable —
        // schluck stillschweigend.
      }
    });
  }, [id, ctx]);

  const onLayout = useCallback(() => {
    measure();
  }, [measure]);

  // Beim Unmount: Anchor aus Registry entfernen + Listener
  // informieren damit Spotlight elegant verschwindet.
  useEffect(() => {
    return () => {
      anchors.delete(id);
      notify(id, null);
    };
  }, [id]);

  return useMemo(() => ({ ref, onLayout }), [onLayout]);
}
