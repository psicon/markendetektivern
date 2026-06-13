// useFavoritesCount — live count der Favoriten des aktuellen Users
// (ClickUp 86ca8fbpz). Für das Schnellzugriff-Badge auf Home.
//
// PERFORMANCE: bewusst NUR `snap.size` — KEIN Laden der Produktdaten
// (das macht useFavorites, was für ein bloßes Badge viel zu teuer wäre).
// Ein leichtgewichtiger onSnapshot auf die `favorites`-Subcollection,
// analog useShoppingCartCount. Das Firestore-SDK multiplext die
// darunterliegende Watch-Subscription, falls mehrere Stellen lauschen.
//
// - Listener bleibt aktiv solange das Hook gemounted ist; löst sich beim
//   User-Wechsel (uid in Dependency) und beim Unmount sauber.
// - Ohne User: count 0, loading false.

import { collection, doc, onSnapshot } from '@react-native-firebase/firestore';
import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/contexts/AuthContext';
import { db } from '@/lib/firebase';

export interface FavoritesCount {
  count: number;
  loading: boolean;
}

export function useFavoritesCount(): FavoritesCount {
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
    const unsub = onSnapshot(
      collection(userRef, 'favorites'),
      (snap) => {
        setCount(snap.size);
        setLoading(false);
      },
      (err) => {
        console.warn('useFavoritesCount: snapshot error', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [user?.uid]);

  return { count, loading };
}
