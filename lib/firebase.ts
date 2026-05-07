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

import { getApp } from '@react-native-firebase/app';
import { getAuth } from '@react-native-firebase/auth';
import { getFirestore } from '@react-native-firebase/firestore';
import { getStorage } from '@react-native-firebase/storage';

// Default-App (initialisiert von Native-Layer via Google-Services-Files)
export const app = getApp();

// Firestore — native mit eingebautem Cache.
export const db = getFirestore();

// Auth — native persistent session.
export const auth = getAuth();

// Storage
export const storage = getStorage();

export default app;
