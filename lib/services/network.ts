/**
 * Connectivity — single source of truth for "are we online".
 *
 * Wraps @react-native-community/netinfo so the rest of the app reads ONE
 * derived state instead of poking NetInfo directly. `online` means: an
 * interface is connected AND the internet is not explicitly unreachable.
 *
 * Reachability nuance: NetInfo's `isInternetReachable` is `null` until the
 * first probe completes. We treat `null` as "assume online" so we never flash
 * an "offline" banner on a cold start when we simply don't know yet — only a
 * definitive `false` (or no connection) counts as offline.
 *
 * Used by the upload queue (skip uploads when offline, resume on reconnect)
 * and by the product-submit overview (offline hint banner).
 */
import { useEffect, useState } from 'react';
import type { NetInfoState } from '@react-native-community/netinfo';

/**
 * netinfo is a NATIVE module. Loading it touches the native bridge at
 * module-eval time (it constructs a NativeEventEmitter), so on a stale binary
 * that predates the dependency the IMPORT itself throws
 * "NativeModule.RNCNetInfo is null" and white-screens the whole app. A
 * connectivity helper must never do that — so we load it through a guarded
 * require and degrade to "assume online" when it's missing. Real offline
 * detection returns after a native rebuild that bundles the module.
 */
type NetInfoModule = typeof import('@react-native-community/netinfo').default;
export let nativeNetInfoAvailable = true;
let NetInfo: NetInfoModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  NetInfo = require('@react-native-community/netinfo').default as NetInfoModule;
} catch (e) {
  nativeNetInfoAvailable = false;
  console.warn(
    '[network] netinfo native module unavailable — assuming online. ' +
      'Rebuild the dev client (npx expo run:ios) to enable offline detection.',
    e,
  );
}

export interface NetworkStatus {
  /** An interface (wifi/cellular) reports a connection. */
  connected: boolean;
  /** NetInfo's internet-reachability probe: true / false / null (unknown). */
  reachable: boolean | null;
  /** connected AND not explicitly unreachable (null reachable → assume true). */
  online: boolean;
}

function derive(s: NetInfoState): NetworkStatus {
  const connected = s.isConnected !== false;
  const reachable = s.isInternetReachable;
  return { connected, reachable, online: connected && reachable !== false };
}

let current: NetworkStatus = { connected: true, reachable: null, online: true };
const listeners = new Set<(s: NetworkStatus) => void>();

if (NetInfo) {
  try {
    NetInfo.addEventListener((s) => {
      current = derive(s);
      listeners.forEach((fn) => {
        try {
          fn(current);
        } catch {
          /* ignore listener errors */
        }
      });
    });
  } catch (e) {
    nativeNetInfoAvailable = false;
    console.warn('[network] netinfo addEventListener failed — assuming online.', e);
  }
}

export function getNetwork(): NetworkStatus {
  return current;
}

export function isOnline(): boolean {
  return current.online;
}

export function subscribeNetwork(fn: (s: NetworkStatus) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => {
    listeners.delete(fn);
  };
}

/** Force a fresh reachability probe (the "kurz prüfen ob Internet da ist"
 *  check before we attempt uploads). Updates the shared state too. */
export async function refreshNetwork(): Promise<NetworkStatus> {
  if (!NetInfo) return current;
  try {
    const s = await NetInfo.refresh();
    current = derive(s);
  } catch {
    /* keep last known state */
  }
  return current;
}

/** React hook for components that need to react to connectivity. */
export function useNetworkStatus(): NetworkStatus {
  const [s, setS] = useState<NetworkStatus>(current);
  useEffect(() => subscribeNetwork(setS), []);
  return s;
}
