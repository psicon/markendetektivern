/**
 * BonScanner — live receipt scanner with manual shutter (iOS).
 *
 * Wraps the native BonScannerView (AVCaptureSession + per-frame
 * VNDetectRectangles overlay). Exposes an imperative `capture()` that
 * resolves with the perspective-corrected JPEG.
 *
 * Capture is triggered via an incrementing `captureSignal` prop (rather
 * than a native view method) — robust across Expo Modules versions and
 * React-friendly. The result comes back on the `onCapture` event, which
 * we bridge to the pending `capture()` promise.
 *
 * On Android, or on an iOS binary that predates the native view, the
 * native view manager is absent → `isBonScannerAvailable` is false and
 * the component renders null, so callers fall back to the basic camera.
 */

import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

export interface BonScannerCaptureResult {
  uri: string;
  width: number;
  height: number;
}

/** Live-tunable scanner parameters (must mirror Swift ScannerTuning). */
export interface ScannerTuning {
  liveMinConfidence: number;
  captureMinConfidence: number;
  persistenceFrames: number;
  visionHz: number;
  minAspect: number;
  maxAspect: number;
  minSize: number;
  quadratureTolerance: number;
  maxObservations: number;
  continuityRadius: number;
  smoothing: number;
}

/** Defaults = the shipped Swift values. */
export const DEFAULT_SCANNER_TUNING: ScannerTuning = {
  liveMinConfidence: 0.25,
  captureMinConfidence: 0.6,
  persistenceFrames: 22,
  visionHz: 15,
  minAspect: 0.2,
  maxAspect: 1.0,
  minSize: 0.2,
  quadratureTolerance: 25,
  maxObservations: 6,
  continuityRadius: 0.22,
  smoothing: 0.5,
};

interface NativeCaptureEvent {
  nativeEvent: BonScannerCaptureResult;
}
interface NativeErrorEvent {
  nativeEvent: { message: string };
}
interface NativeEdgesEvent {
  nativeEvent: { visible: boolean };
}

interface NativeProps {
  style?: StyleProp<ViewStyle>;
  isActive?: boolean;
  torch?: boolean;
  captureSignal?: number;
  tuning?: ScannerTuning;
  onCapture?: (e: NativeCaptureEvent) => void;
  onError?: (e: NativeErrorEvent) => void;
  onEdgesDetected?: (e: NativeEdgesEvent) => void;
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
  /** Capture the current frame, warp it flat, resolve with the JPEG. */
  capture: () => Promise<BonScannerCaptureResult>;
}

export interface BonScannerProps {
  style?: StyleProp<ViewStyle>;
  /** Start/stop the capture session (stop on blur/unmount). */
  isActive?: boolean;
  /** Torch on/off. */
  torch?: boolean;
  /** Live tuning (omit → native defaults). */
  tuning?: ScannerTuning;
  /** Fired when the live edge overlay appears/disappears (arm the shutter). */
  onEdges?: (visible: boolean) => void;
  /** Fired on a fatal camera error (e.g. no camera). */
  onError?: (message: string) => void;
}

export const BonScanner = React.forwardRef<BonScannerHandle, BonScannerProps>(
  function BonScanner({ style, isActive = true, torch = false, tuning, onEdges, onError }, ref) {
    const [signal, setSignal] = React.useState(0);
    const pending = React.useRef<{
      resolve: (r: BonScannerCaptureResult) => void;
      reject: (e: Error) => void;
    } | null>(null);

    React.useImperativeHandle(
      ref,
      () => ({
        capture: () =>
          new Promise<BonScannerCaptureResult>((resolve, reject) => {
            // Reject any in-flight capture before starting a new one.
            pending.current?.reject(new Error('superseded'));
            pending.current = { resolve, reject };
            setSignal((s) => s + 1);
          }),
      }),
      [],
    );

    React.useEffect(() => {
      // If the view unmounts with a capture in flight, fail it.
      return () => {
        pending.current?.reject(new Error('unmounted'));
        pending.current = null;
      };
    }, []);

    if (!NativeView) return null;

    return (
      <NativeView
        style={style}
        isActive={isActive}
        torch={torch}
        tuning={tuning}
        captureSignal={signal}
        onCapture={(e) => {
          pending.current?.resolve(e.nativeEvent);
          pending.current = null;
        }}
        onError={(e) => {
          pending.current?.reject(new Error(e.nativeEvent.message));
          pending.current = null;
          onError?.(e.nativeEvent.message);
        }}
        onEdgesDetected={(e) => onEdges?.(e.nativeEvent.visible)}
      />
    );
  },
);
