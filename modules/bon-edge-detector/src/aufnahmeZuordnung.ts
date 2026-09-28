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
 * an die native Seite, kommt in `onCaptureStarted`, `onCapture` UND
 * `onError` zurück, und nur die passende offene Aufnahme wird beantwortet.
 *
 * Zeitgrenze in zwei Stufen, weil die Dauer zwei sehr verschiedene Teile hat:
 * 1. Bis die Kamera die Aufnahme QUITTIERT (`onCaptureStarted`, nativ
 *    `willBeginCaptureFor`): Tipp → Prop → Sitzungs-Queue → capturePhoto.
 *    Normal Millisekunden. Bleibt die Quittung aus, kommt nie etwas.
 * 2. Ab der Quittung bis zum fertigen Bild: darin steckt die ganze
 *    Aufbereitung (12-MP-Rendern, Vision, Entzerren, JPEG). Auf alten
 *    Geräten dauert das mehrere Sekunden (nicht gemessen). Eine knappe
 *    Grenze hier würde ein korrektes Bild verwerfen — und jeder weitere
 *    Tipp liefe wieder hinein. Nach der Quittung garantiert AVFoundation
 *    ohnehin einen letzten Rückruf (didFinishCaptureFor); die Grenze fängt
 *    nur eine hängende Aufbereitung.
 * Ohne Quittung (native Stände vor diesem Stand) gilt Stufe 1 für alles.
 *
 * Bewusst rein (kein React, keine nativen Module) → mit jest testbar.
 */

/** Stufe 1: vom Tipp bis zur Quittung der Kamera. Deckt auch eine gerade
 *  startende Sitzung ab (startRunning blockiert die Sitzungs-Queue ~1–2 s). */
export const AUFNAHME_START_LIMIT_MS = 5000;

/** Stufe 2: von der Quittung bis zum fertigen Bild (inkl. Aufbereitung). */
export const AUFNAHME_BILD_LIMIT_MS = 30000;

/**
 * Fehlercodes einer Aufnahme.
 * - `timeout`             JS: keine Antwort innerhalb der Zeitgrenze
 * - `session_not_running` nativ: Kamerasitzung lief beim Auslösen (noch) nicht
 * - `session_interrupted` nativ: Sitzung vom System unterbrochen — kann
 *                         dauern (Nebeneinander-Modus, andere App nutzt die
 *                         Kamera). Grund steht in `BonScannerFehler.grund`.
 * - `capture_failed`      nativ: Aufnahme oder Bildaufbereitung gescheitert
 * - `camera_unavailable`  nativ: keine nutzbare Kamera
 * - `superseded`          JS: eine neue Aufnahme hat diese abgelöst
 * - `unmounted`           JS: die Kameraansicht wurde abgebaut
 */
export type BonScannerFehlerCode =
  | 'timeout'
  | 'session_not_running'
  | 'session_interrupted'
  | 'capture_failed'
  | 'camera_unavailable'
  | 'superseded'
  | 'unmounted';

/**
 * Unterbrechungsgrund bei `session_interrupted` (aus
 * AVCaptureSession.InterruptionReason, nativ übersetzt).
 * - `multitasking`    Kamera nur im Vollbild (Nebeneinander-Modus)
 * - `other_client`    eine andere App nutzt Kamera/Mikrofon
 * - `system_pressure` Gerät zu warm o. Ä.
 * - `background`      App lag im Hintergrund — endet beim Zurückkehren
 * Unbekannte Gründe einer neueren nativen Version bleiben als String erhalten.
 */
export type KameraUnterbrechungsGrund =
  | 'multitasking'
  | 'other_client'
  | 'system_pressure'
  | 'background';

export class BonScannerFehler extends Error {
  /** Einer der `BonScannerFehlerCode`s — oder ein unbekannter Code einer
   *  neueren nativen Version (bleibt als String erhalten). */
  readonly code: string;
  /** Nur bei `session_interrupted`: der Grund, sofern die native Seite ihn
   *  kennt (`KameraUnterbrechungsGrund` oder ein neuerer), sonst `null`. */
  readonly grund: string | null;

  constructor(code: string, grund?: unknown) {
    super(code);
    // Hält `instanceof` auch dann intakt, wenn ein Transpiler Klassen nach
    // ES5 übersetzt (Error-Unterklassen verlieren dort sonst ihren Prototyp).
    Object.setPrototypeOf(this, BonScannerFehler.prototype);
    this.name = 'BonScannerFehler';
    this.code = code;
    this.grund = typeof grund === 'string' && grund ? grund : null;
  }
}

/** Wie ein Aufrufer auf einen Aufnahmefehler reagiert. */
export type AufnahmeFehlerArt =
  /** Kamera war kurz nicht bereit — freundlich zum erneuten Tippen einladen. */
  | 'nochmal_tippen'
  /** Kamera ist vom System belegt — ein erneuter Tipp allein hilft nicht,
   *  der Nutzer braucht den Ausweg (Vollbild, andere App schließen, Galerie). */
  | 'kamera_belegt'
  /** Kein Hinweis nötig (Ansicht abgebaut / Aufnahme abgelöst). */
  | 'still'
  /** Echter Fehlschlag — bisherige Fehlermeldung zeigen. */
  | 'fehlgeschlagen';

export function aufnahmeFehlerArt(fehler: unknown): AufnahmeFehlerArt {
  if (!(fehler instanceof BonScannerFehler)) return 'fehlgeschlagen';
  const { code, grund } = fehler;
  if (code === 'timeout' || code === 'session_not_running') return 'nochmal_tippen';
  if (code === 'session_interrupted') {
    // Hintergrund-Unterbrechung endet, sobald die App vorn ist — dort
    // stimmt „gleich bereit“. Alles andere kann dauern.
    return grund === 'background' ? 'nochmal_tippen' : 'kamera_belegt';
  }
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
  /** Kamera hat die Aufnahme quittiert → Stufe 2 der Zeitgrenze läuft. */
  quittiert: boolean;
}

export interface AufnahmeLimits {
  startMs: number;
  bildMs: number;
}

export class AufnahmeZuordnung<T> {
  private offen: OffeneAufnahme<T> | null = null;

  constructor(
    private readonly limits: AufnahmeLimits = {
      startMs: AUFNAHME_START_LIMIT_MS,
      bildMs: AUFNAHME_BILD_LIMIT_MS,
    },
  ) {}

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
      this.offen = {
        id,
        resolve,
        reject,
        timer: this.zeitgrenze(id, this.limits.startMs),
        quittiert: false,
      };
    });
    return { id, zusage };
  }

  /**
   * Kamera hat die Aufnahme quittiert (`willBeginCaptureFor`): ab jetzt gilt
   * die großzügige Grenze für die Aufbereitung, gerechnet ab diesem Moment.
   * Nur mit passender ID — eine Quittung ohne ID verlängert nichts.
   */
  gestartet(signalIdRoh: unknown): Zustellung {
    const offen = this.offen;
    const signalId = signalIdAus(signalIdRoh);
    if (!offen || signalId === null || signalId !== offen.id || offen.quittiert) {
      return 'verworfen';
    }
    clearTimeout(offen.timer);
    offen.timer = this.zeitgrenze(offen.id, this.limits.bildMs);
    offen.quittiert = true;
    return 'angenommen';
  }

  /** Native Aufnahme liegt vor. `verworfen` = gehört zu keiner offenen
   *  Aufnahme (zu spät, abgelöst) — das Bild darf nicht verwendet werden. */
  ergebnis(signalId: unknown, wert: T): Zustellung {
    const offen = this.nehmen(signalId);
    if (!offen) return 'verworfen';
    offen.resolve(wert);
    return 'angenommen';
  }

  /** Native Seite meldet einen Fehler (bei `session_interrupted` mit Grund). */
  fehler(signalId: unknown, code: string, grund?: unknown): Zustellung {
    const offen = this.nehmen(signalId);
    if (!offen) return 'verworfen';
    offen.reject(new BonScannerFehler(code, grund));
    return 'angenommen';
  }

  /** Beendet eine offene Aufnahme ohne native Antwort (z. B. `unmounted`). */
  abbrechen(code: BonScannerFehlerCode): void {
    this.beenden(new BonScannerFehler(code));
  }

  private zeitgrenze(id: number, ms: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const offen = this.offen;
      if (!offen || offen.id !== id) return;
      this.offen = null;
      offen.reject(new BonScannerFehler('timeout'));
    }, ms);
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
