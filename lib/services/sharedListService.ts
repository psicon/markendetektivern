/**
 * sharedListService — Client für geteilte Einkaufszettel (Stufe 5).
 *
 * ADDITIV: fasst den persönlichen Zettel (users/{uid}/einkaufswagen) NICHT an.
 * Alle Writes hier gehen auf die neue Top-Level-Collection `shared_lists`.
 *
 * Security-Kern (siehe firestore.rules + CF): `memberIds` wird client-seitig NUR
 * geschrumpft (leave/remove). Der BEITRITT läuft ausschließlich über die
 * Callable `joinSharedList` — hier via fetch aufgerufen, damit kein
 * @react-native-firebase/functions (= Native-Rebuild) nötig ist.
 */

import * as Crypto from 'expo-crypto';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from '@react-native-firebase/firestore';

import { auth, db } from '@/lib/firebase';

const PROJECT = 'markendetektive-895f7';
const REGION = 'europe-west3';
const CALLABLE_URL = `https://${REGION}-${PROJECT}.cloudfunctions.net/joinSharedList`;
export const SHARED_LIST_MAX_MEMBERS = 6;
const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48h

export interface SharedListDoc {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  inviteCode?: string;
  inviteExpiresAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

/** Denormalisiertes Item (self-contained, keine Cross-User-Refs). Genug, um
 *  eine Card zu rendern — beim Teilen aus den bereits angereicherten
 *  persönlichen Items befüllt. */
export interface SharedListItem {
  id: string;
  name: string;
  kind: 'brand' | 'noname';
  anzahl?: number;
  gekauft?: boolean;
  addedBy?: string;
  addedByName?: string | null;
  marketName?: string | null;
  savings?: number | null;
  productId?: string | null;
  bild?: string | null;
  timestamp?: any;
}

async function randomCode(): Promise<string> {
  try {
    const bytes = await Crypto.getRandomBytesAsync(8);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // Fallback — für einen Invite-Code ausreichend (Security ist die memberIds-
    // Gate + die 48h-Ablaufprüfung, nicht die Rate-Unvorhersehbarkeit).
    return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  }
}

export const SharedListService = {
  /** Erstellt eine geteilte Liste (Owner = aktueller User) und übernimmt die
   *  übergebenen Items EINMALIG. Gibt die neue listId zurück. */
  async createSharedList(
    name: string,
    items: Omit<SharedListItem, 'id'>[] = [],
  ): Promise<string> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('not-authenticated');
    const code = await randomCode();
    const listRef = await addDoc(collection(db, 'shared_lists'), {
      name: (name || '').trim() || 'Unsere Liste',
      ownerId: uid,
      memberIds: [uid],
      inviteCode: code,
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await Promise.all(
      (items || []).slice(0, 200).map((it) =>
        addDoc(collection(db, `shared_lists/${listRef.id}/items`), {
          ...it,
          addedBy: uid,
          gekauft: !!it.gekauft,
          timestamp: serverTimestamp(),
        }).catch(() => null),
      ),
    );
    return listRef.id;
  },

  /** Alle Listen, in denen der User Mitglied ist (Live). */
  subscribeMySharedLists(
    uid: string,
    cb: (lists: SharedListDoc[]) => void,
  ): Unsubscribe {
    if (!uid) {
      cb([]);
      return () => {};
    }
    const q = query(
      collection(db, 'shared_lists'),
      where('memberIds', 'array-contains', uid),
    );
    return onSnapshot(
      q,
      (qs: any) => {
        const rows: SharedListDoc[] = qs.docs.map((d: any) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        rows.sort(
          (a, b) =>
            (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0),
        );
        cb(rows);
      },
      () => cb([]),
    );
  },

  subscribeSharedList(
    listId: string,
    cb: (list: SharedListDoc | null) => void,
  ): Unsubscribe {
    return onSnapshot(
      doc(db, 'shared_lists', listId),
      (d: any) => cb(d.exists ? { id: d.id, ...(d.data() as any) } : null),
      () => cb(null),
    );
  },

  subscribeSharedListItems(
    listId: string,
    cb: (items: SharedListItem[]) => void,
  ): Unsubscribe {
    return onSnapshot(
      collection(db, `shared_lists/${listId}/items`),
      (qs: any) => {
        const rows: SharedListItem[] = qs.docs.map((d: any) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        cb(rows);
      },
      () => cb([]),
    );
  },

  // — Item-Writes (fire-and-forget wie beim persönlichen Zettel, CLAUDE.md) —
  addItem(
    listId: string,
    item: Omit<SharedListItem, 'id' | 'addedBy' | 'gekauft' | 'timestamp'>,
    addedByName?: string | null,
  ): void {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    void addDoc(collection(db, `shared_lists/${listId}/items`), {
      ...item,
      addedBy: uid,
      addedByName: addedByName ?? null,
      gekauft: false,
      timestamp: serverTimestamp(),
    }).catch((e) => console.warn('sharedList addItem failed', e));
  },

  markItemPurchased(listId: string, itemId: string, purchased = true): void {
    void updateDoc(doc(db, `shared_lists/${listId}/items`, itemId), {
      gekauft: purchased,
    }).catch((e) => console.warn('sharedList markItemPurchased failed', e));
  },

  removeItem(listId: string, itemId: string): void {
    void deleteDoc(doc(db, `shared_lists/${listId}/items`, itemId)).catch((e) =>
      console.warn('sharedList removeItem failed', e),
    );
  },

  // — Mitglieder (memberIds nur SCHRUMPFEN; Beitritt via CF) —
  async leaveList(listId: string): Promise<void> {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const snap = await getDoc(doc(db, 'shared_lists', listId));
    if (!snap.exists) return;
    const members: string[] = (snap.data() as any)?.memberIds ?? [];
    await updateDoc(doc(db, 'shared_lists', listId), {
      memberIds: members.filter((m) => m !== uid),
      updatedAt: serverTimestamp(),
    });
  },

  /** Owner entfernt ein Mitglied. */
  async removeMember(listId: string, memberUid: string): Promise<void> {
    const snap = await getDoc(doc(db, 'shared_lists', listId));
    if (!snap.exists) return;
    const members: string[] = (snap.data() as any)?.memberIds ?? [];
    await updateDoc(doc(db, 'shared_lists', listId), {
      memberIds: members.filter((m) => m !== memberUid),
      updatedAt: serverTimestamp(),
    });
  },

  async rename(listId: string, name: string): Promise<void> {
    await updateDoc(doc(db, 'shared_lists', listId), {
      name: (name || '').trim() || 'Unsere Liste',
      updatedAt: serverTimestamp(),
    });
  },

  /** Neuen Einladungs-Code + 48h-Fenster setzen (Owner). */
  async rotateInvite(listId: string): Promise<string> {
    const code = await randomCode();
    await updateDoc(doc(db, 'shared_lists', listId), {
      inviteCode: code,
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
      updatedAt: serverTimestamp(),
    });
    return code;
  },

  inviteLinkFor(code: string): string {
    // App-Scheme (bereits registriert: markendetektive ist der saubere).
    return `markendetektive://join-list/${code}`;
  },

  /** Beitritt via Callable joinSharedList (fetch + Auth-ID-Token). */
  async joinViaCode(
    inviteCode: string,
  ): Promise<{ listId: string; name?: string; alreadyMember?: boolean; joined?: boolean }> {
    const user = auth.currentUser;
    if (!user) throw new Error('not-authenticated');
    const token = await user.getIdToken();
    const res = await fetch(CALLABLE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ data: { inviteCode: String(inviteCode).trim() } }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      throw new Error(json?.error?.message || 'Beitritt fehlgeschlagen.');
    }
    return json.result ?? {};
  },
};
