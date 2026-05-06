import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase configuration - PRODUCTION
const firebaseConfig = {
  apiKey: "AIzaSyCVQ-Y71TNexRKSWrVtu1HTP9uk_dSfUP0",
  authDomain: "markendetektive-895f7.firebaseapp.com",
  projectId: "markendetektive-895f7",
  storageBucket: "markendetektive-895f7.appspot.com",
  messagingSenderId: "139509881339",
  appId: "1:139509881339:web:d5d1f2b75d2b0258d6135e",
  measurementId: "G-BMRCTZPJJZ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore.
//
// `experimentalAutoDetectLongPolling: true` ist ESSENZIELL auf
// Android. Ohne diese Option versucht das Firebase Web SDK
// zuerst WebChannel-Streaming, was RNs Networking-Layer nicht
// vollständig unterstützt — der SDK probiert mehrere fehl-
// schlagende Verbindungs-Versuche durch, bevor er auf
// Long-Polling zurückfällt. Das hat First-Loads auf Android
// auf 8–10 s aufgeblasen UND Pagination-Calls in die gleiche
// Latenz-Kategorie gezogen. Mit AutoDetect: Long-Polling
// sofort, sub-second Cold-Start, schnelle Folge-Pages.
//
// NOTE: NIEMALS `persistentLocalCache` / `persistentSingleTabManager`
// hier hinzufügen. Das ist eine Web-API (IndexedDB), die
// auf RN den NativeEventEmitter-Crash auslöst. Die In-Memory-
// Caches in `services/firestore.ts` (5-Min TTL + Inflight-Dedup)
// liefern denselben Repeat-Visit-Win ohne Crash.
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});

// Initialize Firebase Auth with persistence
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});

// Initialize Firebase Storage
export const storage = getStorage(app);

export default app;
export { app };

