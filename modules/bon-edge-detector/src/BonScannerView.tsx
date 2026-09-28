/**
 * BonScanner — live receipt scanner with manual shutter (iOS).
 *
 * Wraps the native BonScannerView (AVCaptureSession + per-frame
 * VNDetectRectangles overlay). Exposes an imperative `capture()` that
 * resolves with the perspective-corrected JPEG.
 *
 * Capture is triggered via the `captureSignal` prop (rather than a native
 * view method) — robust across Expo Modules versions and React-friendly.
 * Each capture gets its own strictly increasing signal ID; the native side
 * echoes it in `onCapture` and `onError`, and only the matching pending
 * `capture()` is settled (see aufnahmeZuordnung.ts). No answer within
 * AUFNAHME_ZEITLIMIT_MS → rejected with code `timeout`; a late answer for
 * an expired ID is discarded and its file deleted.
 *
 * On Android, or on an iOS binary that predates the native view, the
 * native view manager is absent → `isBonScannerAvailable` is false and
 * the component renders null, so callers fall back to the basic camera.
 */

import * as FileSystem from 'expo-file-system';
import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

import { AufnahmeZuordnung, BonScannerFehler, signalIdAus } from './aufnahmeZuordnung';

export interface BonScannerCaptureResult {
  uri: string;
  width: number;
  height: number;
}

/** Live-tunable scanner parameters (must mirror Swift ScannerTuning). */
export interface ScannerTuning {
  /** Document-segmenter acceptance for the live overlay. */
  docMinConfidence: number;
  docMinArea: number;
  docMaxArea: number;
  docMaxWHRatio: number;
  /** Bon height fraction needed to call the text readable ("näher ran"). */
  minReadableHeight: number;
  persistenceFrames: number;
  visionHz: number;
  smoothing: number;
  /** Rectangle-detector fallback params (not surfaced in the panel). */
  minAspect: number;
  maxAspect: number;
  minSize: number;
  quadratureTolerance: number;
  maxObservations: number;
}

/** Defaults = the shipped Swift values. */
export const DEFAULT_SCANNER_TUNING: ScannerTuning = {
  docMinConfidence: 0.2,
  docMinArea: 0.06,
  docMaxArea: 0.9,
  docMaxWHRatio: 0.85,
  minReadableHeight: 0.55,
  persistenceFrames: 50,
  visionHz: 20,
  smoothing: 0.5,
  minAspect: 0.2,
  maxAspect: 1.0,
  minSize: 0.2,
  quadratureTolerance: 25,
  maxObservations: 6,
};

// `signalId` fehlt bei nativen Ständen vor dem 28.09.2026 und bei Fehlern,
// die zu keiner Aufnahme gehören (z. B. `camera_unavailable` beim Start).
interface NativeCaptureEvent {
  nativeEvent: BonScannerCaptureResult & { signalId?: number };
}
interface NativeErrorEvent {
  nativeEvent: { message: string; signalId?: number };
}
interface NativeEdgesEvent {
  nativeEvent: { visible: boolean };
}
interface NativeQualityEvent {
  nativeEvent: { status: BonScannerQuality };
}

/** Live readability status: no bon / too far to read / good. */
export type BonScannerQuality = 'none' | 'far' | 'ok';

interface NativeProps {
  style?: StyleProp<ViewStyle>;
  isActive?: boolean;
  torch?: boolean;
  rawCapture?: boolean;
  captureSignal?: number;
  tuning?: ScannerTuning;
  onCapture?: (e: NativeCaptureEvent) => void;
  onError?: (e: NativeErrorEvent) => void;
  onEdgesDetected?: (e: NativeEdgesEvent) => void;
  onQuality?: (e: NativeQualityEvent) => void;
  onSessionStopped?: (e: { nativeEvent: Record<string, never> }) => void;
}

const NativeView: React.ComponentType<NativeProps> | null = (() => {
  if (Platform.OS !== 'ios') return null;
  try {
    return requireNativeViewManager('BonEdgeDetector');
  } catch {
    return null;
  }
})();

/** True only when the native live-scanner view is linked into the binary. */
export const isBonScannerAvailable = NativeView != null;

export interface BonScannerHandle {
  /** Capture the current frame, warp it flat, resolve with the JPEG.
   *  Rejects with a `BonScannerFehler` (see `aufnahmeFehlerArt`). */
  capture: () => Promise<BonScannerCaptureResult>;
}

export interface BonScannerProps {
  style?: StyleProp<ViewStyle>;
  /** Start/stop the capture session (stop on blur/unmount). */
  isActive?: boolean;
  /** Torch on/off. */
  torch?: boolean;
  /** Capture mode. false (default) = deskew/warp to a flat document (bon
   *  scanning). true = keep the full upright photo; the live overlay +
   *  readability hint act as guidance only (product labels). */
  rawCapture?: boolean;
  /** Live tuning (omit → native defaults). */
  tuning?: ScannerTuning;
  /** Fired when the live edge overlay appears/disappears (arm the shutter). */
  onEdges?: (visible: boolean) => void;
  /** Fired when live readability changes: 'none' | 'far' | 'ok'. */
  onQuality?: (status: BonScannerQuality) => void;
  /** Fired on a fatal camera error (e.g. no camera). */
  onError?: (message: string) => void;
  /** Fired once the capture session has actually stopped (isActive → false).
   *  Lets a consumer hand the camera off to another stack deterministically
   *  instead of guessing with a timeout. */
  onSessionStopped?: () => void;
}

export const BonScanner = React.forwardRef<BonScannerHandle, BonScannerProps>(
  function BonScanner(
    { style, isActive = true, torch = false, rawCapture = false, tuning, onEdges, onQuality, onError, onSessionStopped },
    ref,
  ) {
    const [signal, setSignal] = React.useState(0);
    const zuordnungRef = React.useRef<AufnahmeZuordnung<BonScannerCaptureResult> | null>(null);
    if (!zuordnungRef.current) zuordnungRef.current = new AufnahmeZuordnung();
    const zuordnung = zuordnungRef.current;

    React.useImperativeHandle(
      ref,
      () => ({
        capture: () => {
          // Ohne native Ansicht (Android, Binary ohne Scanner) antwortet nie
          // eine Kamera — sofort ablehnen statt die Zeitgrenze abzuwarten.
          if (!NativeView) return Promise.reject(new BonScannerFehler('camera_unavailable'));
          // Löst eine noch offene Aufnahme mit `superseded` ab.
          const { id, zusage } = zuordnung.starten();
          setSignal(id);
          return zusage;
        },
      }),
      [zuordnung],
    );

    React.useEffect(() => {
      // If the view unmounts with a capture in flight, fail it.
      return () => zuordnung.abbrechen('unmounted');
    }, [zuordnung]);

    if (!NativeView) return null;

    return (
      <NativeView
        style={style}
        isActive={isActive}
        torch={torch}
        rawCapture={rawCapture}
        tuning={tuning}
        captureSignal={signal}
        onCapture={(e) => {
          const { signalId, uri, width, height } = e.nativeEvent;
          if (zuordnung.ergebnis(signalId, { uri, width, height }) === 'verworfen') {
            // Antwort auf eine abgelaufene/abgelöste Aufnahme: das Bild gehört
            // zu keinem offenen Tipp und wird nie verwendet.
            verwaistesBildLoeschen(uri);
          }
        }}
        onError={(e) => {
          const { message, signalId } = e.nativeEvent;
          const zustellung = zuordnung.fehler(signalId, message);
          // Späte Fehler einer abgelaufenen Aufnahme nicht mehr melden. Fehler
          // ohne ID (Kamera nicht verfügbar beim Start) weiterhin melden.
          if (zustellung === 'verworfen' && signalIdAus(signalId) !== null) return;
          onError?.(message);
        }}
        onEdgesDetected={(e) => onEdges?.(e.nativeEvent.visible)}
        onQuality={(e) => onQuality?.(e.nativeEvent.status)}
        onSessionStopped={() => onSessionStopped?.()}
      />
    );
  },
);

/** Löscht das Cache-JPEG einer verworfenen Aufnahme. Best effort — der
 *  Caches-Ordner wird vom System ohnehin geräumt. */
function verwaistesBildLoeschen(uri: unknown): void {
  if (typeof uri !== 'string' || !uri) return;
  FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}
