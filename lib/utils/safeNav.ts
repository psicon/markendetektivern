/**
 * safeNav — debounced wrappers für expo-router Navigation.
 *
 * User-Bug-Report: "wenn ich sehr schnell auf seitenwechsel tippe
 * (zb. 2-3x auf einkaufszettel) dann öffnet er die seiten x mal.
 * wenn der empfang schlecht ist, wird der effekt natürlich noch
 * wilder."
 *
 * Klassischer React-Native-Doppelt-Push-Bug: jeder Tap feuert
 * `router.push(...)`, der nächste Tap kommt bevor die Navigation
 * settled ist → mehrfache Stack-Pushes des gleichen Screens. Bei
 * langsamem Netzwerk wird der Effekt schlimmer weil die Push-
 * Animation noch länger läuft und der User mehr Zeit hat ein
 * zweites/drittes Mal zu tappen.
 *
 * Lösung: globaler Debounce auf Modul-Level. Ein Push (oder
 * Replace) sperrt für `NAV_DEBOUNCE_MS` jede weitere Navigation
 * — egal von welcher Component. Push-aufrufe innerhalb des
 * Fensters werden silent gedropped (boolean-Return falls der
 * Caller wissen will).
 *
 * Standard-Debounce 600 ms = lang genug um Doppel-Tap-Spam zu
 * fangen, kurz genug dass intentionale schnelle Navigation (z.B.
 * Detail → zurück → anderes Detail) sich nicht stranguliert
 * anfühlt.
 *
 * Verwendung:
 *   import { safePush, safeReplace, safeBack } from '@/lib/utils/safeNav';
 *   // statt: router.push(href)
 *   safePush(href);
 */

import { router } from 'expo-router';

const NAV_DEBOUNCE_MS = 600;

let lastNavAt = 0;

/**
 * Debounced push. Returns true if the navigation actually fired,
 * false if it was suppressed by the debounce window. Most callers
 * können den Return ignorieren — es ist nur fürs gelegentliche
 * Debug-Logging.
 */
export function safePush(href: any): boolean {
  const now = Date.now();
  if (now - lastNavAt < NAV_DEBOUNCE_MS) {
    return false;
  }
  lastNavAt = now;
  router.push(href);
  return true;
}

export function safeReplace(href: any): boolean {
  const now = Date.now();
  if (now - lastNavAt < NAV_DEBOUNCE_MS) {
    return false;
  }
  lastNavAt = now;
  router.replace(href);
  return true;
}

export function safeBack(): boolean {
  const now = Date.now();
  if (now - lastNavAt < NAV_DEBOUNCE_MS) {
    return false;
  }
  lastNavAt = now;
  router.back();
  return true;
}

/**
 * Reset the debounce — z.B. wenn ein Screen unmountet ohne
 * Navigation oder die App in den Background geht. Selten gebraucht.
 */
export function resetSafeNavDebounce(): void {
  lastNavAt = 0;
}
