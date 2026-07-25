/**
 * sheetPresence — globaler Zähler aktuell präsentierter Modal-Sheets
 * (FilterSheet, RatingsSheet etc.). (ClickUp 86ca8g2p9)
 *
 * Warum: Zwei gleichzeitig sichtbare React-Native-`<Modal>`s deadlocken
 * iOS ("Attempt to present … which is already presenting …") → die App
 * FRIERT EIN. Genau das passierte, wenn nach dem Abgeben einer Bewertung
 * (RatingsSheet = Modal) eine action-getriggerte Umfrage ihr eigenes
 * FilterSheet-Modal SOFORT über dem noch offenen RatingsSheet öffnete.
 *
 * Lösung: jedes Modal-Sheet meldet sich hier an/ab. Der SurveyProvider
 * präsentiert eine Umfrage erst, wenn KEIN anderes Sheet mehr offen ist
 * (sonst Modal-über-Modal-Freeze). Die Survey-EIGENE FilterSheet meldet
 * sich NICHT an (`registerPresence={false}`), sonst zählte sie sich
 * selbst.
 *
 * Bewusst kein React-State/Context: der Zähler muss aus dem non-React
 * surveyPromptBus-Pfad lesbar sein und darf keine Re-Renders auslösen.
 */

let openCount = 0;
const idleListeners = new Set<() => void>();

/**
 * Meldet ein offenes Sheet an. Gibt einen Release-Callback zurück, der
 * beim Schließen GENAU EINMAL aufgerufen werden muss (idempotent).
 */
export function registerSheetOpen(): () => void {
  openCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) {
      // Snapshot + clear: Listener feuern genau einmal.
      const ls = [...idleListeners];
      idleListeners.clear();
      ls.forEach((l) => {
        try {
          l();
        } catch {
          /* ignore */
        }
      });
    }
  };
}

/** Ist gerade (mindestens) ein Modal-Sheet präsentiert? */
export function isAnySheetOpen(): boolean {
  return openCount > 0;
}

/**
 * Ruft `cb` GENAU EINMAL auf, sobald kein Sheet mehr offen ist — sofort,
 * wenn aktuell keins offen ist. Gibt einen Cancel-Callback zurück.
 */
export function whenSheetsIdle(cb: () => void): () => void {
  if (openCount === 0) {
    cb();
    return () => {};
  }
  idleListeners.add(cb);
  return () => idleListeners.delete(cb);
}

// ─── Sonderfall: Umfrage-Sheet ────────────────────────────────────
//
// Der Umfrage-Sheet (components/survey/SurveyProvider) ist ein echtes
// RN-<Modal> (FilterSheet), registriert sich aber bewusst NICHT im
// Zähler oben (`registerPresence={false}`) — sonst würde es sich beim
// Öffnen selbst blockieren. Damit ist es für `isAnySheetOpen()`
// unsichtbar, obwohl es präsentiert ist.
//
// Konsumenten, die kein zweites Modal/keinen System-Dialog darüber
// legen dürfen (z.B. der native Review-Dialog), brauchen diese Info.
// Da Umfragen nach JEDER Aktion angestoßen werden — auch beim
// allerersten Scan — fällt das genau mit dem "Erster Fall"-Review-
// Moment zusammen.

let surveyVisible = false;

/** Vom SurveyProvider bei jedem Öffnen/Schließen gesetzt. */
export function setSurveyVisible(v: boolean): void {
  surveyVisible = v;
}

/** Ist gerade ein Umfrage-Sheet präsentiert? */
export function isSurveyVisible(): boolean {
  return surveyVisible;
}
