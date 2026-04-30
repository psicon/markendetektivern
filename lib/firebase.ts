import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import { getReactNativePersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
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
// NOTE: We deliberately use the plain in-memory cache here.
// `persistentLocalCache` from firebase/firestore is a web-only
// API (IndexedDB-backed) and does NOT work in React Native — it
// triggers a runtime crash via `NativeEventEmitter` when the SDK
// tries to wire up its sync/storage event paths. The in-memory
// product-detail cache in `services/firestore.ts` (5-min TTL +
// inflight-promise dedup) gives us the same UX win for repeat
// visits within a session.
export const db = getFirestore(app);

// Initialize Firebase Auth with persistence
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});

// Initialize Firebase Storage
export const storage = getStorage(app);

export default app;
export { app };

