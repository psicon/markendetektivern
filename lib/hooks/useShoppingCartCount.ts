// useShoppingCartCount — live count of "noch zu kaufenden" items im
// Einkaufszettel des aktuellen Users (gekauft == false). Geteiltes
// Hook damit FAB + Schnellzugriff-Card auf Home (oder weitere
// Stellen) denselben Count zeigen, ohne dass jede Stelle ihren
// eigenen Firestore-Listener hochzieht.
//
// Hinweise:
// - Listener bleibt aktiv solange das Hook gemounted ist; löst sich
//   beim User-Wechsel (uid in Dependency) und beim Unmount sauber.
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

export interface ShoppingCartCount {
  count: number;
  loading: boolean;
}

export function useShoppingCartCount(): ShoppingCartCount {
  const { user } = useAuth();
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!user?.uid) {
      setCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
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
  }, [user?.uid]);

  return { count, loading };
}
