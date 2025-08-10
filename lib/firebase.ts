import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDXqHTFTgHnr2vHX9-QJhPBQvOhxX8_kZs",
  authDomain: "markendetektive-895f7.firebaseapp.com", 
  projectId: "markendetektive-895f7",
  storageBucket: "markendetektive-895f7.firebasestorage.app",
  messagingSenderId: "1754828123",
  appId: "1:1754828123:web:c8f8f8f8f8f8f8f8f8f8f8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
export const db = getFirestore(app);

export default app;

