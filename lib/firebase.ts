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

// Initialize Firestore
export const db = getFirestore(app);

// Initialize Firebase Auth with persistence
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});

// Initialize Firebase Storage
export const storage = getStorage(app);

export default app;

