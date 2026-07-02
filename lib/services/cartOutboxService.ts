/**
 * cartOutboxService — kleine lokale Write-Queue für Einkaufszettel-Aktionen,
 * die OFFLINE angestoßen wurden (Stufe 3.2).
 *
 * Warum: Auf Android läuft Firestore mit `persistence: false` (dokumentiertes
 * WatchStream-CPU-Learning) → es gibt KEINE native Offline-Write-Queue. Ein
 * offline abgehaktes Item würde also nur optimistisch aus der lokalen Liste
 * verschwinden, der Firestore-Write scheitert sofort, und beim App-Kill ist die
 * Absicht verloren. Diese Outbox persistiert solche Aktionen in AsyncStorage
 * und spielt sie beim Reconnect nach.
 *
 * Design-Prinzipien:
 *  • IDEMPOTENT: dedupt pro (kind,itemId); der Replay wird nur ONLINE gefahren.
 *  • FAIL-OPEN: scheitert ein Replay-Write trotz Online (z.B. Item bereits weg),
 *    wird die Op VERWORFEN statt endlos zu retrien. Der schlimmste Fall ist ein
 *    verpasstes Abhaken (Item bleibt in der Liste, User hakt neu ab) — NIE eine
 *    Daten-Korruption/Doppel-Ausführung.
 *  • Punkte/Ersparnis werden beim Abhaken EINMAL optimistisch vergeben (im
 *    Screen), NICHT im Replay — der Replay macht nur den DB-Write nach.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type CartOutboxOp =
  | { kind: 'markPurchased'; itemId: string; ts: number }
  | {
      kind: 'removeCustom';
      itemId: string;
      productName: string;
      productType: 'brand' | 'noname';
      ts: number;
    };

const keyFor = (uid: string) => `cart_outbox_v1_${uid}`;

async function readQueue(uid: string): Promise<CartOutboxOp[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartOutboxOp[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(uid: string, q: CartOutboxOp[]): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(uid), JSON.stringify(q));
  } catch {
    /* non-fatal */
  }
}

// Modul-Guard gegen parallele Flushes (z.B. wenn mehrere Reconnect-Events
// dicht hintereinander feuern).
let flushing = false;

export const CartOutboxService = {
  /** Merkt eine offline angestoßene Aktion. Dedupt pro (kind,itemId). */
  async enqueue(uid: string, op: CartOutboxOp): Promise<void> {
    if (!uid) return;
    const q = await readQueue(uid);
    if (q.some((o) => o.kind === op.kind && o.itemId === op.itemId)) return;
    q.push(op);
    await writeQueue(uid, q);
  },

  async count(uid: string): Promise<number> {
    if (!uid) return 0;
    return (await readQueue(uid)).length;
  },

  /**
   * Spielt alle gemerkten Aktionen nach. `runOp` injiziert der Caller (hält die
   * FirestoreService-Abhängigkeit aus dem Service). Gibt die Anzahl verarbeiteter
   * Ops zurück (erfolgreich ODER fail-open verworfen). Läuft nie parallel.
   */
  async flush(uid: string, runOp: (op: CartOutboxOp) => Promise<void>): Promise<number> {
    if (!uid || flushing) return 0;
    flushing = true;
    let processed = 0;
    try {
      const q = await readQueue(uid);
      if (q.length === 0) return 0;
      for (const op of q) {
        try {
          await runOp(op);
        } catch (e) {
          // Fail-open: verwerfen statt endlos retrien. Verpasstes Abhaken ist
          // benigne; Doppel-Ausführung/Korruption wäre schlimmer.
          console.warn('[cartOutbox] replay op dropped:', (e as Error)?.message);
        }
        processed += 1;
      }
      // Alles verarbeitet → Queue leeren (idempotent).
      await writeQueue(uid, []);
    } finally {
      flushing = false;
    }
    return processed;
  },

  /** Beim Logout/Account-Wechsel aufräumen. */
  clear(uid: string): void {
    if (!uid) return;
    void AsyncStorage.removeItem(keyFor(uid)).catch(() => {});
  },
};
