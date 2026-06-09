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
import firestoreNamespace, { getFirestore } from '@react-native-firebase/firestore';
import { getStorage } from '@react-native-firebase/storage';
import { Platform } from 'react-native';

// ────────────────────────────────────────────────────────────────────────
// ANDROID: native Disk-Persistenz AUS → In-Memory-Cache.
// ────────────────────────────────────────────────────────────────────────
// @react-native-firebase defaultet auf `persistence: true` (Disk-Cache). Der
// intendierte Stand dieses Projekts war aber IN-MEMORY (alter Web-SDK:
// `getFirestore` ohne `persistentLocalCache`). Die Native-Migration hat die
// Disk-Persistenz unbeabsichtigt aktiviert.
//
// Folge auf Android: der native SDK hält den über die Session gelesenen
// Referenz-Graph (produkte / hersteller_new / handelsmarken / kategorien /
// packungstypen / discounter / markenProdukte — ~170+ Docs) als persistente
// Query-Targets und re-validiert sie bei JEDEM Write. Ein Cart-Write am
// Einkaufszettel (gekauft-markieren / löschen) löst dann einen WatchStream-
// RESET-Sturm + `View.computeDocChanges → ObjectValue.equals` über alle
// re-gelieferten Docs aus → der gRPC-WatchStream-Worker (FirestoreWorker)
// dreht 5+ Min bei 600% CPU durch und blockiert ALLE weiteren Reads.
// (Bewiesen per Thread-Dump + nativem Firestore-Debug-Log, Juni 2026.)
//
// iOS handhabt dieselbe Persistenz nativ sauber (kein Spin) → dort NICHT
// anfassen, Default-Persistenz bleibt. Muss VOR der ersten Firestore-Op laufen.
if (Platform.OS === 'android') {
  try {
    (firestoreNamespace as any)().settings({ persistence: false });
  } catch (e) {
    console.warn('Firestore settings(persistence:false) failed:', e);
  }
}

// Default-App (initialisiert von Native-Layer via Google-Services-Files)
export const app = getApp();

// Firestore — native mit eingebautem Cache.
export const db = getFirestore();

// Auth — native persistent session.
export const auth = getAuth();

// Storage
export const storage = getStorage();

export default app;
