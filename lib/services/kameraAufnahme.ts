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
 *    Auf iOS belegt die hängende Aufnahme die Kamera weiter: der nächste
 *    Tipp scheitert dort mit `ERR_CAMERA_NOT_READY` und bekommt dieselbe
 *    Meldung wie die Zeitgrenze (siehe `vorigeAufnahmeHaengt`).
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
 * expo-camera (iOS) hat für eine Aufnahme genau einen Platz: Hängt die
 * vorige noch (nach `timeout_bild` läuft sie nativ weiter), wirft jeder
 * weitere Auslöser `ERR_CAMERA_NOT_READY` (CameraPhotoCapture.swift, einzige
 * Wurfstelle dieser Ausnahme). Ein erneuter Tipp hilft dann nicht — es ist
 * derselbe Fall wie die Zeitgrenze, also dieselbe Meldung (Galerie oder
 * Kamera neu öffnen) statt „Aufnahme fehlgeschlagen, versuch es noch
 * einmal“. Android kennt den Code nicht (eigener Rückruf je Aufnahme).
 */
function vorigeAufnahmeHaengt(fehler: unknown): boolean {
  return (fehler as { code?: unknown } | null)?.code === 'ERR_CAMERA_NOT_READY';
}

/**
 * Wartet höchstens `ms` auf `arbeit` und prüft danach `istAktiv()`.
 * - Bildschirm nicht mehr aktiv → `BILDSCHIRM_WEG` (Foto, Fehler und
 *   Zeitgrenze werden verschluckt)
 * - Zeitgrenze abgelaufen → wirft `BonScannerFehler('timeout_bild')`
 * - `arbeit` scheitert, weil die vorige Aufnahme noch hängt
 *   (`ERR_CAMERA_NOT_READY`) → wirft `BonScannerFehler('timeout_bild')`
 * - `arbeit` scheitert sonst → wirft den Fehler weiter
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
    if (vorigeAufnahmeHaengt(fehler)) throw new BonScannerFehler('timeout_bild');
    throw fehler;
  }
  if (!istAktiv()) return BILDSCHIRM_WEG;
  if (ergebnis === ABGELAUFEN) throw new BonScannerFehler('timeout_bild');
  return ergebnis;
}

/** Zeitgrenze fürs Entzerren (VisionKit) nach Aufnahme oder Galerie-Wahl.
 *  Üblich ist rund eine Sekunde; die Grenze greift nur, wenn es hängt. */
export const ENTZERREN_LIMIT_MS = 10_000;

const ENTZERREN_ABGELAUFEN: unique symbol = Symbol('entzerren_abgelaufen');

/**
 * Entzerrt ein Bon-Bild höchstens `ms` lang und liefert die URI, mit der es
 * weitergeht. Findet das Entzerren keinen Bon-Umriss, scheitert es oder kommt
 * es nicht rechtzeitig zurück, geht es mit dem ROHBILD weiter — derselbe Weg
 * wie bisher im Fehlerfall (die Texterkennung kommt mit Hintergrund zurecht).
 * So dreht der Auslöser nie endlos an diesem nativen await (Projektregel).
 * Ein verspätet entzerrtes Bild fällt ins Leere: es liegt in einer eigenen
 * Datei (`bon-cropped-<UUID>.jpg`), nichts wird überschrieben.
 *
 * `entzerren` wird übergeben (in der App `detectAndCropDocument`), damit die
 * Logik ohne natives Modul testbar bleibt.
 */
export async function entzerrenMitGrenze(
  uri: string,
  entzerren: (uri: string) => Promise<{ uri: string } | null>,
  ms: number = ENTZERREN_LIMIT_MS,
): Promise<string> {
  try {
    const ergebnis = await mitZeitlimit(
      Promise.resolve().then(() => entzerren(uri)),
      ms,
      ENTZERREN_ABGELAUFEN,
    );
    if (ergebnis === ENTZERREN_ABGELAUFEN) {
      console.warn('⚠️ Entzerren über der Zeitgrenze, Rohbild wird verwendet');
      return uri;
    }
    return ergebnis?.uri || uri;
  } catch (fehler) {
    console.warn('⚠️ Entzerren nicht möglich, Rohbild wird verwendet:', (fehler as Error)?.message);
    return uri;
  }
}
