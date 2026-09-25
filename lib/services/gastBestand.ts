import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Merkt sich, für welche Gast-uids auf diesem Gerät etwas eingereicht wurde
 * (Bon oder Produktfoto). Einziger Schreiber des Schlüssels
 * `gast_einreichung_v1`.
 *
 * Zweck (Entscheidung 25.09.2026 „erst einreichen, dann Konto"): Meldet sich
 * ein Gast mit einem BESTEHENDEN Konto an, muss vorher der Besitznachweis
 * gesichert und ein Mitnahme-Dialog gezeigt werden — aber nur, wenn es
 * überhaupt etwas mitzunehmen gibt. Eine lokale Liste reicht dafür: sie ist
 * sofort da (auch offline) und sagt nichts über Geld, nur „hier gibt es was".
 */

const KEY = 'gast_einreichung_v1';
const MAX = 10;

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

  async hat(uid: string | null | undefined): Promise<boolean> {
    if (!uid) return false;
    return (await lesen()).includes(uid);
  },
};
