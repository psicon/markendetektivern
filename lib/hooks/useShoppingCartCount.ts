// useShoppingCartCount — live count of "noch zu kaufenden" items in der
// AKTIVEN Einkaufsliste des Users (gekauft == false). Geteiltes Hook damit
// FAB + Schnellzugriff-Card auf Home (oder weitere Stellen) denselben
// Count zeigen, ohne dass jede Stelle ihren eigenen Firestore-Listener
// hochzieht.
//
// Stufe 5 (2026-07-02): Der Count folgt der app-weit „aktuellen Liste"
// (ActiveListService) — ist eine geteilte Liste aktiv, zählt der Badge
// deren offene Items (dort landen auch die Adds von Produktseiten).
//
// Hinweise:
// - Listener bleibt aktiv solange das Hook gemounted ist; löst sich
//   beim User-/Listen-Wechsel und beim Unmount sauber.
// - Initial-Load: `loading` true bis erster Snapshot kommt. Caller
//   können das nutzen für Skeletons. Ohne User: loading sofort
//   false, count 0.
// - Mehrere Caller in einem Render-Tree → Firestore SDK multiplext
//   die zugrundeliegende Watch-Subscription, das ist günstig.

import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from '@react-native-firebase/firestore';
import { useEffect, useState } from 'react';

import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/contexts/AuthContext';
import { ActiveListService, type ActiveList } from '@/lib/services/activeListService';

export interface ShoppingCartCount {
  count: number;
  loading: boolean;
}

export function useShoppingCartCount(): ShoppingCartCount {
  const { user } = useAuth();
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  // Aktive Liste live verfolgen (ändert sich beim Umschalten im Zettel).
  const [activeList, setActiveList] = useState<ActiveList | null>(
    () => ActiveListService.getActiveListSync(),
  );
  useEffect(() => ActiveListService.subscribe(setActiveList), []);

  useEffect(() => {
    if (!user?.uid) {
      setCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    if (activeList) {
      // Geteilte Liste: KEIN where-Query — Legacy-v1-Items tragen
      // `purchased` statt `gekauft` (Client-Filter, Listen sind klein).
      const unsub = onSnapshot(
        collection(db, 'shared_lists', activeList.listId, 'items'),
        (snap) => {
          let open = 0;
          snap.forEach((d: any) => {
            const it: any = d.data();
            if (it?.gekauft !== true && it?.purchased !== true) open += 1;
          });
          setCount(open);
          setLoading(false);
        },
        (err) => {
          console.warn('useShoppingCartCount: shared snapshot error', err);
          setLoading(false);
        },
      );
      return () => {
        unsub();
      };
    }
    const userRef = doc(db, 'users', user.uid);
    const q = query(
      collection(userRef, 'einkaufswagen'),
      where('gekauft', '==', false),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setCount(snap.size);
        setLoading(false);
      },
      (err) => {
        console.warn('useShoppingCartCount: snapshot error', err);
        setLoading(false);
      },
    );
    return () => {
      unsub();
    };
  }, [user?.uid, activeList?.listId]);

  return { count, loading };
}
