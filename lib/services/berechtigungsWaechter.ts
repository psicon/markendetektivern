import { AppState } from 'react-native';

/**
 * Schutz gegen hängende Berechtigungsanfragen (Vorfall 25.09.2026, Pixel 8 /
 * Android 16, Build 6.0.20-1246).
 *
 * Steht der Ausgang einer Anfrage schon fest (erteilt oder dauerhaft
 * verweigert), antwortet Android ohne sichtbaren Dialog. React Native stellte
 * das Ergebnis dann erst beim nächsten Aufwachen der App zu (Sperren/
 * Entsperren) — der Knopf drehte ewig. Die Wurzel ist in `MainActivity.kt`
 * behoben; dieser Wächter ist die zweite Sicherung auf JS-Seite:
 *
 * Erscheint nach `ohneDialogMs` kein Systemdialog (die App blieb die ganze
 * Zeit im Vordergrund), wird nicht weiter auf die Anfrage gewartet, sondern
 * der Stand frisch gelesen. Erscheint ein Dialog (die App verlässt kurz den
 * Vordergrund), wird wie gewohnt auf die Antwort des Nutzers gewartet.
 *
 * Vorher prüfen, ob eine Anfrage überhaupt nötig ist (erteilt / dauerhaft
 * verweigert) — das ist Sache des Aufrufers.
 */
export const OHNE_DIALOG_MS = 2500;

export function anfragenOhneHaenger<T>(
  anfragen: () => Promise<T>,
  lesen: () => Promise<T>,
  ohneDialogMs: number = OHNE_DIALOG_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let fertig = false;
    // Läuft die App beim Start der Anfrage schon nicht im Vordergrund, gilt
    // das wie ein Dialog: dann wird regulär gewartet.
    let dialogGesehen = AppState.currentState !== 'active';
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') dialogGesehen = true;
    });
    const abschliessen = (): boolean => {
      if (fertig) return false;
      fertig = true;
      clearTimeout(timer);
      sub.remove();
      return true;
    };
    const timer = setTimeout(() => {
      if (fertig || dialogGesehen) return;
      lesen().then(
        (wert) => {
          if (abschliessen()) resolve(wert);
        },
        (fehler) => {
          if (abschliessen()) reject(fehler);
        },
      );
    }, ohneDialogMs);
    let anfrage: Promise<T>;
    try {
      anfrage = anfragen();
    } catch (fehler) {
      if (abschliessen()) reject(fehler);
      return;
    }
    anfrage.then(
      (wert) => {
        if (abschliessen()) resolve(wert);
      },
      (fehler) => {
        if (abschliessen()) reject(fehler);
      },
    );
  });
}

/** Begrenzt ein beliebiges await; liefert `ersatz` nach `ms`. Wirft nie selbst. */
export function mitZeitlimit<T, E>(arbeit: Promise<T>, ms: number, ersatz: E): Promise<T | E> {
  return new Promise<T | E>((resolve, reject) => {
    const timer = setTimeout(() => resolve(ersatz), ms);
    arbeit.then(
      (wert) => {
        clearTimeout(timer);
        resolve(wert);
      },
      (fehler) => {
        clearTimeout(timer);
        reject(fehler);
      },
    );
  });
}
