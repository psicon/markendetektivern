/**
 * Zuordnung „Auslöser-Tipp → Ergebnis der nativen Kamera“ für den BonScanner.
 *
 * Bis 28.09.2026 wartete `capture()` ohne Zeitgrenze, und jedes native
 * Ergebnis löste die gerade offene Zusage auf — egal, zu welchem Tipp es
 * gehörte. Lief die Kamerasitzung nicht (Übergang im Produkt-Assistenten,
 * Unterbrechung), kam nie eine Antwort: der Auslöser drehte endlos. Und ein
 * verspätetes Ergebnis hätte die NÄCHSTE Aufnahme beantwortet (Foto eines
 * anderen Schritts im falschen Fach).
 *
 * Jetzt bekommt jede Aufnahme eine Signal-ID. Sie geht als `captureSignal`
 * an die native Seite, kommt in `onCapture` UND `onError` zurück, und nur
 * die passende offene Aufnahme wird beantwortet. Bleibt die Antwort aus,
 * endet die Aufnahme nach `AUFNAHME_ZEITLIMIT_MS` mit dem Code `timeout`.
 *
 * Bewusst rein (kein React, keine nativen Module) → mit jest testbar.
 */

/** Zeitgrenze einer Aufnahme. Auslösen + Entzerren + JPEG dauert auf
 *  iPhones 1–3 s; 8 s lassen Luft für ältere Geräte, ohne dass ein
 *  hängender Auslöser lange stehen bleibt. */
export const AUFNAHME_ZEITLIMIT_MS = 8000;

/**
 * Fehlercodes einer Aufnahme.
 * - `timeout`             JS: keine Antwort innerhalb der Zeitgrenze
 * - `session_not_running` nativ: Kamerasitzung lief beim Auslösen nicht
 * - `capture_failed`      nativ: Aufnahme oder Bildaufbereitung gescheitert
 * - `camera_unavailable`  nativ: keine nutzbare Kamera
 * - `superseded`          JS: eine neue Aufnahme hat diese abgelöst
 * - `unmounted`           JS: die Kameraansicht wurde abgebaut
 */
export type BonScannerFehlerCode =
  | 'timeout'
  | 'session_not_running'
  | 'capture_failed'
  | 'camera_unavailable'
  | 'superseded'
  | 'unmounted';

export class BonScannerFehler extends Error {
  /** Einer der `BonScannerFehlerCode`s — oder ein unbekannter Code einer
   *  neueren nativen Version (bleibt als String erhalten). */
  readonly code: string;

  constructor(code: string) {
    super(code);
    // Hält `instanceof` auch dann intakt, wenn ein Transpiler Klassen nach
    // ES5 übersetzt (Error-Unterklassen verlieren dort sonst ihren Prototyp).
    Object.setPrototypeOf(this, BonScannerFehler.prototype);
    this.name = 'BonScannerFehler';
    this.code = code;
  }
}

/** Wie ein Aufrufer auf einen Aufnahmefehler reagiert. */
export type AufnahmeFehlerArt =
  /** Kamera war kurz nicht bereit — freundlich zum erneuten Tippen einladen. */
  | 'nochmal_tippen'
  /** Kein Hinweis nötig (Ansicht abgebaut / Aufnahme abgelöst). */
  | 'still'
  /** Echter Fehlschlag — bisherige Fehlermeldung zeigen. */
  | 'fehlgeschlagen';

export function aufnahmeFehlerArt(fehler: unknown): AufnahmeFehlerArt {
  const code = fehler instanceof BonScannerFehler ? fehler.code : null;
  if (code === 'timeout' || code === 'session_not_running') return 'nochmal_tippen';
  if (code === 'unmounted' || code === 'superseded') return 'still';
  return 'fehlgeschlagen';
}

/** Was mit einer nativen Antwort geschehen ist. */
export type Zustellung = 'angenommen' | 'verworfen';

/** Liest die Signal-ID aus einem nativen Event. Fehlt sie (ältere native
 *  Version) oder ist sie unbrauchbar, kommt `null` zurück. */
export function signalIdAus(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isInteger(wert) && wert > 0 ? wert : null;
}

// Modulweit statt je Instanz: IDs bleiben über Remounts eindeutig und
// steigen strikt — die native Seite verwirft ein Signal, das dem zuletzt
// gesehenen gleicht.
let letzteId = 0;

interface OffeneAufnahme<T> {
  id: number;
  resolve: (wert: T) => void;
  reject: (fehler: BonScannerFehler) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AufnahmeZuordnung<T> {
  private offen: OffeneAufnahme<T> | null = null;

  constructor(private readonly zeitlimitMs: number = AUFNAHME_ZEITLIMIT_MS) {}

  /** ID der offenen Aufnahme, sonst `null`. */
  get offeneId(): number | null {
    return this.offen?.id ?? null;
  }

  /**
   * Startet eine Aufnahme. Eine noch offene wird mit `superseded` beendet —
   * ihre spätere Antwort trägt dann eine fremde ID und wird verworfen.
   * Die zurückgegebene `id` geht als `captureSignal` an die native Seite.
   */
  starten(): { id: number; zusage: Promise<T> } {
    this.beenden(new BonScannerFehler('superseded'));
    letzteId += 1;
    const id = letzteId;
    const zusage = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.offen?.id !== id) return;
        this.offen = null;
        reject(new BonScannerFehler('timeout'));
      }, this.zeitlimitMs);
      this.offen = { id, resolve, reject, timer };
    });
    return { id, zusage };
  }

  /** Native Aufnahme liegt vor. `verworfen` = gehört zu keiner offenen
   *  Aufnahme (zu spät, abgelöst) — das Bild darf nicht verwendet werden. */
  ergebnis(signalId: unknown, wert: T): Zustellung {
    const offen = this.nehmen(signalId);
    if (!offen) return 'verworfen';
    offen.resolve(wert);
    return 'angenommen';
  }

  /** Native Seite meldet einen Fehler. */
  fehler(signalId: unknown, code: string): Zustellung {
    const offen = this.nehmen(signalId);
    if (!offen) return 'verworfen';
    offen.reject(new BonScannerFehler(code));
    return 'angenommen';
  }

  /** Beendet eine offene Aufnahme ohne native Antwort (z. B. `unmounted`). */
  abbrechen(code: BonScannerFehlerCode): void {
    this.beenden(new BonScannerFehler(code));
  }

  private beenden(fehler: BonScannerFehler): void {
    const offen = this.offen;
    if (!offen) return;
    clearTimeout(offen.timer);
    this.offen = null;
    offen.reject(fehler);
  }

  /**
   * Holt die offene Aufnahme, wenn die Antwort zu ihr gehört.
   *
   * Antwort OHNE ID (native Version vor diesem Stand): wird der offenen
   * Aufnahme zugeordnet, sofern genau eine offen ist — und mehr als eine
   * gibt es nie, `starten()` löst die vorige ab. Begründung: JS und nativer
   * Code gehen immer im selben Binary raus (kein OTA-Update), der Fall tritt
   * also nur in Entwickler-Builds auf, die älter sind als das JS aus Metro.
   * Dort hieße „verwerfen“, dass der Auslöser nie wieder ein Bild liefert;
   * die Zuordnung bleibt so gut wie vor der Signal-ID. Antworten ohne ID
   * und ohne offene Aufnahme (z. B. `camera_unavailable` beim Start) gehen
   * ins Leere.
   */
  private nehmen(signalIdRoh: unknown): OffeneAufnahme<T> | null {
    const offen = this.offen;
    if (!offen) return null;
    const signalId = signalIdAus(signalIdRoh);
    if (signalId !== null && signalId !== offen.id) return null;
    clearTimeout(offen.timer);
    this.offen = null;
    return offen;
  }
}
