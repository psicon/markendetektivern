import { useCallback, useRef } from 'react';

/**
 * usePressLock — verhindert dass derselbe Action-Handler mehrfach
 * in schneller Folge feuert (User tippt rapid 5× auf "Favorit",
 * "in den Wagen" etc.). Nach dem ersten Aufruf werden weitere
 * Aufrufe für `lockMs` Millisekunden ignoriert.
 *
 * Hintergrund: jeder echte Tap auf Action-Buttons triggert
 * eine schwere Hintergrund-Cascade (Firestore-Write +
 * achievementService.trackAction mit 12 getDocs + Profile-
 * Refresh-Cascade). Wenn 10 Taps in 3 s reinkommen, queueen
 * sich 10 Cascades und feuern dann auf einen Schlag wenn der
 * JS-Thread idle wird → mehrsekündiger Freeze.
 *
 * Mit usePressLock: nur EIN Cascade pro Lock-Window → keine
 * Burst-Belastung. UX-Tradeoff: User kann den Button für
 * 500 ms nicht erneut betätigen — nicht spürbar (Tap-Frequenz
 * von Menschen liegt selten unter 200 ms zwischen 2 Taps,
 * und ein Toggle braucht eh Zeit zum Sehen ob's geklappt hat).
 *
 * Usage:
 *   const onFavPress = usePressLock(async () => {
 *     await toggleFavorite(...);
 *   });
 *   <Pressable onPress={onFavPress}>...</Pressable>
 */
export function usePressLock<T extends (...args: any[]) => any>(
  fn: T,
  lockMs = 500,
): T {
  const lockedUntilRef = useRef<number>(0);
  const wrapped = useCallback(
    (...args: any[]) => {
      const now = Date.now();
      if (now < lockedUntilRef.current) {
        return undefined;
      }
      lockedUntilRef.current = now + lockMs;
      return fn(...args);
    },
    [fn, lockMs],
  );
  return wrapped as unknown as T;
}
