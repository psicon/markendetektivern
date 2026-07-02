/**
 * sharedListService — Client für geteilte Einkaufszettel (Stufe 5).
 *
 * ADDITIV: fasst den persönlichen Zettel (users/{uid}/einkaufswagen) NICHT an.
 * Alle Writes hier gehen auf die neue Top-Level-Collection `shared_lists`.
 *
 * Items einer geteilten Liste leben in `shared_lists/{listId}/items` und tragen
 * EXAKT das Einkaufswagen-Doc-Schema (markenProdukt/handelsmarkenProdukt als
 * DocumentReference, customItem, gekauft, name, anzahl, timestamp — plus
 * addedBy/addedByName für die Attribution). Dadurch laufen Laden/Enrichment/
 * Mutationen über DIESELBEN FirestoreService-Cart-Methoden wie der persönliche
 * Zettel (cartTarget-Parameter) → identische UI + identisches Verhalten.
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
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from '@react-native-firebase/firestore';

import { auth, db } from '@/lib/firebase';

const PROJECT = 'markendetektive-895f7';
const REGION = 'europe-west3';
const CALLABLE_URL = `https://${REGION}-${PROJECT}.cloudfunctions.net/joinSharedList`;
/**
 * Einladungs-Links sind HTTPS (Firebase Hosting Join-Page), NICHT das Custom-
 * Scheme: die iOS-Kamera weigert sich, `markendetektive://…` aus QR-Codes zu
 * öffnen („Keine nutzbaren Daten gefunden"). Die Web-Page leitet auf das
 * App-Scheme weiter (+ Store-Fallback). Seite: public-web/, Hosting-Site
 * markendetektive-895f7 (Default-Site des Projekts).
 */
const INVITE_LINK_BASE = `https://${PROJECT}.web.app/join-list`;
export const SHARED_LIST_MAX_MEMBERS = 6;
const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // 48h

export interface SharedListDoc {
  id: string;
  name: string;
  ownerId: string;
  ownerName?: string;
  memberIds: string[];
  /** uid → Anzeigename (Clients dürfen fremde users/*-Profile nicht lesen). */
  memberNames?: Record<string, string>;
  inviteCode?: string;
  inviteExpiresAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

/** Ein Item im Einkaufswagen-Schema, das beim Erstellen 1:1 in die geteilte
 *  Liste kopiert wird. `id` gesetzt = deterministische Doc-ID (brand_/noname_),
 *  sonst Auto-ID (Custom-Items). `data` = das komplette Cart-Doc-Payload. */
export interface SharedListSeedDoc {
  id?: string;
  data: Record<string, any>;
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
   *  übergebenen Cart-Docs EINMALIG (Einkaufswagen-Schema, det-IDs erhalten —
   *  so funktionieren anzahl-Increments per addToShoppingCart identisch).
   *  Gibt die neue listId zurück. */
  async createSharedList(
    name: string,
    seedDocs: SharedListSeedDoc[] = [],
    ownerName?: string | null,
  ): Promise<string> {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('not-authenticated');
    const code = await randomCode();
    const displayName = (ownerName || '').trim().slice(0, 40) || 'Ich';
    const listRef = await addDoc(collection(db, 'shared_lists'), {
      name: (name || '').trim() || 'Unsere Liste',
      ownerId: uid,
      ownerName: displayName,
      memberIds: [uid],
      memberNames: { [uid]: displayName },
      inviteCode: code,
      inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const itemsCol = collection(db, `shared_lists/${listRef.id}/items`);
    await Promise.all(
      (seedDocs || []).slice(0, 200).map((seed) => {
        const payload = {
          ...seed.data,
          addedBy: uid,
          addedByName: displayName,
          timestamp: serverTimestamp(),
        };
        const write = seed.id
          ? setDoc(doc(db, `shared_lists/${listRef.id}/items`, seed.id), payload)
          : addDoc(itemsCol, payload);
        return write.catch(() => null);
      }),
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

  /** Live-Trigger auf die Items einer geteilten Liste. Payload wird bewusst
   *  NICHT gemappt — der Einkaufszettel lädt/enriched über seine bestehende
   *  Pipeline (FirestoreService.getShoppingCartItems mit sharedListId); der
   *  Listener signalisiert nur „etwas hat sich geändert" (Echtzeit-Sync).
   *  onError feuert z.B. bei permission-denied (User wurde entfernt). */
  subscribeSharedListItemsTrigger(
    listId: string,
    onChange: () => void,
    onError?: () => void,
  ): Unsubscribe {
    return onSnapshot(
      collection(db, `shared_lists/${listId}/items`),
      () => onChange(),
      () => onError?.(),
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
    return `${INVITE_LINK_BASE}/${code}`;
  },

  /** Beitritt via Callable joinSharedList (fetch + Auth-ID-Token). */
  async joinViaCode(
    inviteCode: string,
    displayName?: string | null,
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
      body: JSON.stringify({
        data: {
          inviteCode: String(inviteCode).trim(),
          displayName: (displayName || '').trim().slice(0, 40),
        },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      throw new Error(json?.error?.message || 'Beitritt fehlgeschlagen.');
    }
    return json.result ?? {};
  },
};
