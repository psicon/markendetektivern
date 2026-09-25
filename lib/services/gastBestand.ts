import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, doc, getDoc, getDocs, limit, query, where } from '@react-native-firebase/firestore';

import { db } from '@/lib/firebase';

/**
 * Merkt sich, für welche Gast-uids auf diesem Gerät etwas eingereicht wurde
 * (Bon oder Produktfoto). Einziger Schreiber des Schlüssels
 * `gast_einreichung_v1`.
 *
 * Zweck (Entscheidung 25.09.2026 „erst einreichen, dann Konto"): Meldet sich
 * ein Gast mit einem BESTEHENDEN Konto an, muss vorher der Besitznachweis
 * gesichert und ein Mitnahme-Dialog gezeigt werden — aber nur, wenn es
 * überhaupt etwas mitzunehmen gibt.
 *
 * Zwei Quellen: die lokale Liste (sofort da, auch offline) und — wenn sie
 * nichts weiß — ein kurzer Blick auf den Server (Prüfrunde 1: nach einer
 * Neuinstallation ist die Liste leer, das Gast-Guthaben aber noch da).
 * Klappt der Blick nicht, gilt „hat Bestand": einmal zu viel nachfragen ist
 * harmlos, Einreichungen ohne Besitznachweis zurückzulassen nicht.
 */

const KEY = 'gast_einreichung_v1';
const MAX = 10;
const SERVER_TIMEOUT_MS = 4000;

let cache: string[] | null = null;

async function lesen(): Promise<string[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Eigene Daten des Gastes — alle drei Lesevorgänge erlauben die Regeln dem Besitzer. */
async function serverHat(uid: string): Promise<boolean> {
  const [nutzer, bons, fotos] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDocs(query(collection(db, `users/${uid}/cashback_status`), limit(1))),
    getDocs(query(collection(db, 'crowd_uploads'), where('userId', '==', uid), limit(1))),
  ]);
  const d: any = nutzer.data() ?? {};
  const cents = Number(d.cashback_balance_cents ?? 0) + Number(d.cashback_lifetime_cents ?? 0);
  return cents > 0 || !bons.empty || !fotos.empty;
}

function mitZeitlimit(p: Promise<boolean>, ms: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('gast_bestand_timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export const GastBestand = {
  /** Idempotent; hält höchstens die letzten 10 uids. */
  async merke(uid: string | null | undefined): Promise<void> {
    if (!uid) return;
    const liste = await lesen();
    if (liste.includes(uid)) return;
    cache = [...liste, uid].slice(-MAX);
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      // Nur ein Hinweis-Merker — ein Schreibfehler darf nichts blockieren.
    }
  },

  /** Lokal bekannt ODER laut Server vorhanden; im Zweifel true. */
  async hat(uid: string | null | undefined): Promise<boolean> {
    if (!uid) return false;
    if ((await lesen()).includes(uid)) return true;
    try {
      const vorhanden = await mitZeitlimit(serverHat(uid), SERVER_TIMEOUT_MS);
      if (vorhanden) await GastBestand.merke(uid);
      return vorhanden;
    } catch {
      return true;
    }
  },
};
