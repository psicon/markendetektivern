/**
 * activeListService — die app-weit „aktuelle" Einkaufsliste (Stufe 5).
 *
 * Die im Einkaufszettel gewählte Liste (persönlich oder geteilt) ist das
 * ZIEL aller Cart-Adds — auch von Produktseiten, Favoriten und Vergleich.
 * User-Anforderung 2026-07-02: „eine Liste, auf der die Produkte landen,
 * wenn ich auf hinzufügen tippe".
 *
 * - Single Source of Truth für das Add-Ziel (AsyncStorage-Key wird NUR
 *   hier geschrieben — CLAUDE.md-Regel).
 * - null = persönlicher Zettel (Default).
 * - Persistiert über App-Neustarts; der Einkaufszettel-Umschalter hält
 *   den Wert aktuell, Konsumenten (Badge-Hook, Produktseiten) lesen ihn
 *   bzw. abonnieren Änderungen.
 * - Lazy-Validierung einmal pro Session: ist der User nicht (mehr)
 *   Mitglied der persistierten Liste, wird das Ziel auf den persönlichen
 *   Zettel zurückgesetzt (sonst liefen Adds ins permission-denied-Leere).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc } from '@react-native-firebase/firestore';

import { auth, db } from '@/lib/firebase';

const STORAGE_KEY = 'active_cart_list_v1';

export interface ActiveList {
  listId: string;
  name: string;
}

type Listener = (active: ActiveList | null) => void;

let inMemory: ActiveList | null = null;
let hydrated = false;
let validatedForUid: string | null = null;
let hydratePromise: Promise<void> | null = null;
const listeners = new Set<Listener>();

const notify = () => {
  for (const cb of listeners) {
    try {
      cb(inMemory);
    } catch {
      /* Listener dürfen den Service nie brechen */
    }
  }
};

const hydrate = async (): Promise<void> => {
  if (hydrated) return;
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.listId === 'string') {
            inMemory = { listId: parsed.listId, name: String(parsed.name ?? 'Geteilte Liste') };
          }
        }
      } catch {
        inMemory = null;
      } finally {
        hydrated = true;
      }
    })();
  }
  await hydratePromise;
};

export const ActiveListService = {
  /** Aktives Add-Ziel (validiert einmal pro Session gegen memberIds).
   *  null = persönlicher Zettel. */
  async getActiveList(): Promise<ActiveList | null> {
    await hydrate();
    if (!inMemory) return null;
    const uid = auth.currentUser?.uid;
    if (uid && validatedForUid !== uid) {
      try {
        const snap = await getDoc(doc(db, 'shared_lists', inMemory.listId));
        const members: string[] = (snap.data() as any)?.memberIds ?? [];
        if (!snap.exists || !members.includes(uid)) {
          // Entfernt / Liste weg → zurück auf den persönlichen Zettel.
          await ActiveListService.setActiveList(null);
          return null;
        }
        validatedForUid = uid;
      } catch (e: any) {
        // permission-denied ist das DEFINITIVE "kein Zugriff mehr"-Signal:
        // die Rules lehnen den Doc-Read für Nicht-Mitglieder ab (auch bei
        // gelöschter Liste) — der !exists/!member-Zweig oben ist für genau
        // diese Fälle unerreichbar (er setzt lesbares Doc voraus). Ohne
        // Reset lädt sonst JEDE Session einen permission-denied-Zettel.
        if (String(e?.code ?? '').includes('permission-denied')) {
          await ActiveListService.setActiveList(null);
          return null;
        }
        // Offline/sonstige Fehler: Wert optimistisch behalten (Rules
        // blocken im Zweifel den Write; der Zettel korrigiert beim Besuch).
      }
    }
    return inMemory;
  },

  /** Synchroner In-Memory-Wert (nach erstem getActiveList/Set verlässlich). */
  getActiveListSync(): ActiveList | null {
    return inMemory;
  },

  async setActiveList(active: ActiveList | null): Promise<void> {
    inMemory = active;
    hydrated = true;
    if (active) validatedForUid = auth.currentUser?.uid ?? null;
    try {
      if (active) {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(active));
      } else {
        await AsyncStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* Persistenz best-effort; in-memory gilt für die Session */
    }
    notify();
  },

  /** Änderungs-Abo (z.B. Cart-Badge-Hook). Liefert Unsubscribe. */
  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    // Aktuellen Stand sofort liefern (nach Hydrate).
    void hydrate().then(() => cb(inMemory));
    return () => {
      listeners.delete(cb);
    };
  },

  /** cartTarget für FirestoreService-Cart-Ops (undefined = persönlich). */
  async getCartTarget(
    addedByName?: string | null,
  ): Promise<{ sharedListId: string; addedByName?: string | null } | undefined> {
    const active = await ActiveListService.getActiveList();
    return active ? { sharedListId: active.listId, addedByName: addedByName ?? null } : undefined;
  },
};
