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
import { getFirestore } from '@react-native-firebase/firestore';
import { getStorage } from '@react-native-firebase/storage';

// Default-App (initialisiert von Native-Layer via Google-Services-Files)
export const app = getApp();

// Firestore — native, mit eingebautem Persistent-Cache. Kein
// `experimentalAutoDetectLongPolling` mehr nötig (Native-Transport).
export const db = getFirestore();

// Auth — native persistent session. RN-Persistence ist eingebaut,
// kein AsyncStorage-Wrapper mehr nötig.
export const auth = getAuth();

// Storage
export const storage = getStorage();

export default app;
