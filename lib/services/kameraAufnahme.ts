import { BonScannerFehler } from 'bon-edge-detector';

import { mitZeitlimit } from '@/lib/services/berechtigungsWaechter';

/**
 * Auslöser über expo-camera (`takePictureAsync`) mit Zeitgrenze und
 * Lebenszyklus-Prüfung — Bon-Scanner-Ersatzweg (app/cashback/capture.tsx) und
 * Produktfoto-Assistent (app/product-submit/wizard.tsx).
 *
 * Zwei Dinge, die ein nacktes `await takePictureAsync()` nicht leistet:
 * 1. Eine Zeitgrenze (Projektregel: kein Spinner ohne Grenze an einem
 *    nativen await). Läuft sie ab, kommt `BonScannerFehler('timeout_bild')`
 *    — `zeigeAufnahmeFehler` nennt dann die Galerie statt „tipp nochmal“.
 *    Ein Foto, das danach noch eintrifft, fällt ins Leere: niemand wartet
 *    mehr darauf. Das Fach steht beim Aufrufer über die Closure des Tipps
 *    fest, ein spätes Bild kann also nie in einen anderen Schritt rutschen.
 * 2. Die Frage, ob der Bildschirm überhaupt noch da ist. Wurde er während der
 *    Aufnahme verlassen (X getippt, eine Push-Nachricht hat ein anderes Ziel
 *    geöffnet) oder abgebaut, darf der Aufrufer weder navigieren noch einen
 *    Hinweis über einer fremden Seite zeigen noch State setzen — egal, ob ein
 *    Foto, ein Fehler oder die Zeitgrenze kam.
 *
 * Bewusst ohne React → mit jest testbar.
 */

/** Rückgabe, wenn der Bildschirm nach der Aufnahme nicht mehr aktiv ist. */
export const BILDSCHIRM_WEG: unique symbol = Symbol('bildschirm_weg');

const ABGELAUFEN: unique symbol = Symbol('abgelaufen');

/**
 * Wartet höchstens `ms` auf `arbeit` und prüft danach `istAktiv()`.
 * - Bildschirm nicht mehr aktiv → `BILDSCHIRM_WEG` (Foto, Fehler und
 *   Zeitgrenze werden verschluckt)
 * - Zeitgrenze abgelaufen → wirft `BonScannerFehler('timeout_bild')`
 * - `arbeit` scheitert → wirft den Fehler weiter
 * - sonst das Ergebnis von `arbeit`
 */
export async function aufnahmeMitGrenze<T>(
  arbeit: Promise<T>,
  ms: number,
  istAktiv: () => boolean,
): Promise<T | typeof BILDSCHIRM_WEG> {
  let ergebnis: T | typeof ABGELAUFEN;
  try {
    ergebnis = await mitZeitlimit(arbeit, ms, ABGELAUFEN);
  } catch (fehler) {
    if (!istAktiv()) return BILDSCHIRM_WEG;
    throw fehler;
  }
  if (!istAktiv()) return BILDSCHIRM_WEG;
  if (ergebnis === ABGELAUFEN) throw new BonScannerFehler('timeout_bild');
  return ergebnis;
}
