/**
 * Einkaufszettel-Snapshot in AsyncStorage (ClickUp 86ca7uhg7).
 *
 * Android läuft bewusst mit Firestore `persistence: false` (WatchStream-
 * CPU-Bug, siehe lib/firebase.ts) — beim Kaltstart ohne Netz ist der
 * Einkaufszettel dort sonst KOMPLETT leer. Genau im Markt (Funkloch) ist
 * die Liste aber der Haupt-Use-Case. Dieser Service spiegelt nach jedem
 * erfolgreichen Load einen kompakten, render-fertigen Auszug nach
 * AsyncStorage; der Screen rendert ihn als ehrliche Read-only-Ansicht
 * („Offline — letzter Stand"), wenn der Firestore-Load offline scheitert.
 *
 * Bewusst KEINE Outbox/Write-Queue (V1 read-only) — Mutationen laufen
 * weiter ausschließlich über Firestore (fire-and-forget + Listener).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CartSnapshotItem {
  id: string;
  /** Anzeigename der Zeile. */
  name: string;
  anzahl: number;
  /** 'brand' | 'noname' | 'custom-brand' | 'custom-noname' */
  kind: string;
  /** Markt-Name (NoNames), rein informativ. */
  marketName?: string | null;
}

export interface CartSnapshot {
  savedAt: number;
  brand: CartSnapshotItem[];
  noname: CartSnapshotItem[];
}

const keyFor = (uid: string) => `cart_snapshot_v1_${uid}`;

export const CartSnapshotService = {
  /** Fire-and-forget — nach jedem erfolgreichen Cart-Load aufrufen. */
  save(uid: string, snapshot: Omit<CartSnapshot, 'savedAt'>): void {
    const payload: CartSnapshot = { ...snapshot, savedAt: Date.now() };
    void AsyncStorage.setItem(keyFor(uid), JSON.stringify(payload)).catch(
      (e) => console.warn('[cartSnapshot] save failed:', (e as Error)?.message),
    );
  },

  async load(uid: string): Promise<CartSnapshot | null> {
    try {
      const raw = await AsyncStorage.getItem(keyFor(uid));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CartSnapshot;
      if (!Array.isArray(parsed.brand) || !Array.isArray(parsed.noname)) return null;
      return parsed;
    } catch (e) {
      console.warn('[cartSnapshot] load failed:', (e as Error)?.message);
      return null;
    }
  },

  /** Beim Logout/Account-Wechsel aufräumen. */
  clear(uid: string): void {
    void AsyncStorage.removeItem(keyFor(uid)).catch(() => {});
  },
};
