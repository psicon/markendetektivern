/**
 * App-Ready-Signal für den Splash-Übergang.
 *
 * Problem: Die grüne Splash-Overlay (components/ui/SplashScreen.tsx) blendete
 * sich nach einer FESTEN Animationsdauer (~2,15 s) aus. Auf iOS reicht das, weil
 * der Boot schnell genug ist. Auf Android ist der Boot langsamer — die Overlay
 * verschwand, BEVOR der erste echte Screen gerendert war → kurze schwarz/weisse
 * Lücke ("Whitescreen") bis die App da war.
 *
 * Lösung: Der erste echte Screen (Home / Onboarding / Auth-Welcome) meldet via
 * `markAppContentReady()`, dass er gemountet + gerendert ist. Die Splash-Overlay
 * blendet sich erst aus, wenn DIESES Signal kam (plus ihre Mindest-Animation) —
 * mit einem Sicherheits-Timeout im Splash, falls das Signal mal ausbleibt.
 *
 * Bewusst ein winziges modul-globales Event (kein Context), damit es überall
 * ohne Provider-Verkabelung erreichbar ist und früh im Boot funktioniert.
 */

let ready = false;
const listeners = new Set<() => void>();

/** Vom ersten echten Screen aufgerufen, sobald er gerendert ist. Idempotent. */
export function markAppContentReady(): void {
  if (ready) return;
  ready = true;
  for (const l of Array.from(listeners)) {
    try {
      l();
    } catch {
      /* listener-Fehler nie fatal */
    }
  }
  listeners.clear();
}

/** Synchroner Status-Check. */
export function isAppContentReady(): boolean {
  return ready;
}

/**
 * Callback feuert sobald der erste Screen bereit ist (sofort, falls schon).
 * Gibt eine Unsubscribe-Funktion zurück.
 */
export function onAppContentReady(cb: () => void): () => void {
  if (ready) {
    cb();
    return () => {};
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
