// ────────────────────────────────────────────────────────────────────────
// Firebase init — Native SDK via @react-native-firebase
// ────────────────────────────────────────────────────────────────────────
//
// Phase L Migration: alle Firebase-Module über Native iOS/Android SDKs
// statt Web-SDK auf JS-Thread.
//
// Auth, Firestore, Storage werden vom Native-Layer initialisiert beim
// App-Start (über GoogleService-Info.plist + google-services.json), wir
// holen hier nur die default-Instances zurück.
//
// Persistence:
//   - Auth: native persistente Session (wie Web SDK + AsyncStorage)
//   - Firestore: native persistent disk cache (besser als Web SDK
//     in-memory, kein IndexedDB-Crash auf RN)
//   - Storage: kein persistent state nötig
//
// Long-Polling-Workaround entfällt: Native SDK nutzt direkten
// HTTP/2 mit Connection-Pool, kein WebChannel-Handshake-Problem.

import { getApp } from '@react-native-firebase/app';
import { getAuth } from '@react-native-firebase/auth';
import { getFirestore, setLogLevel } from '@react-native-firebase/firestore';
import { getStorage } from '@react-native-firebase/storage';

// Default-App (initialisiert von Native-Layer via Google-Services-Files)
export const app = getApp();

// Firestore — native, mit eingebautem Persistent-Cache. Kein
// `experimentalAutoDetectLongPolling` mehr nötig (Native-Transport).
export const db = getFirestore();

// DIAG (2026-05-07): Native Firestore-Debug-Logs einschalten um zu
// sehen was während des 121s-addDoc-Freezes intern passiert
// (Connection-State, Token-Refresh, Write-Stream, gRPC-Retries).
// Tag in adb logcat: "RNFBFirestore" / "FIRFirestore" / Firebase-
// internal "GrpcStream" etc.
try {
  setLogLevel('debug');
} catch {}

// Heartbeat — feuert jede 500 ms ein [hb] log. Wenn während eines
// "Freezes" die hb-Logs WEITERLAUFEN → JS-Thread ist nicht blockiert,
// nur addDoc-await hängt nativ. Wenn die hb-Logs AUSSETZEN → JS-
// Thread ist tatsächlich blockiert (Microtask-Storm o.ä.).
const __hbStart = Date.now();
setInterval(() => {
  console.error('[hb]', Date.now() - __hbStart);
}, 500);

// Auth — native persistent session. RN-Persistence ist eingebaut,
// kein AsyncStorage-Wrapper mehr nötig.
export const auth = getAuth();

// Storage
export const storage = getStorage();

export default app;
