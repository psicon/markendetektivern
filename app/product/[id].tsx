import { doc, getDoc } from '@react-native-firebase/firestore';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { useTokens } from '@/hooks/useTokens';
import { db } from '@/lib/firebase';

/**
 * Deep-link / share RESOLVER: `markendetektive://product/{id}` routes to the
 * CORRECT detail screen based on the product's Stufe + collection.
 *
 * Why: a raw `noname-detail/{id}` or `product-comparison/{id}` link requires the
 * sender to already know the Stufe — so a shared product link can land on the
 * wrong page (a Stufe-4 product opened via noname-detail shows "kein
 * Markenoriginal" instead of the comparison). This resolver applies the SAME
 * rule the in-app taps use (Stufe ≤2 → noname-detail, 3-5 → product-comparison)
 * so ONE link form always lands right. Uses `replace` so Back goes Home, not
 * back to this throwaway resolver screen.
 */
export default function ProductResolver() {
  const { id, type } = useLocalSearchParams<{ id: string; type?: string }>();
  const { theme } = useTokens();

  useEffect(() => {
    const pid = String(id ?? '');
    if (!pid) {
      router.replace('/(tabs)');
      return;
    }
    let alive = true;
    (async () => {
      try {
        // Explicit brand type from the caller wins (no fetch needed).
        if (type === 'markenprodukt' || type === 'brand') {
          if (alive) router.replace(`/product-comparison/${pid}?type=markenprodukt` as any);
          return;
        }
        // NoName produkt → route by Stufe.
        const snap = await getDoc(doc(db, 'produkte', pid));
        if (!alive) return;
        if (snap.exists()) {
          const stufe = parseInt(String((snap.data() as any)?.stufe ?? '1'), 10) || 1;
          router.replace(
            (stufe <= 2
              ? `/noname-detail/${pid}`
              : `/product-comparison/${pid}?type=noname`) as any,
          );
          return;
        }
        // Markenprodukt fallback.
        const mp = await getDoc(doc(db, 'markenProdukte', pid));
        if (!alive) return;
        if (mp.exists()) {
          router.replace(`/product-comparison/${pid}?type=markenprodukt` as any);
          return;
        }
        // Unknown id → noname-detail renders a clean "nicht verfügbar" state.
        router.replace(`/noname-detail/${pid}` as any);
      } catch {
        if (alive) router.replace(`/noname-detail/${pid}` as any);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, type]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.bg,
      }}
    >
      <ActivityIndicator color={theme.primary ?? '#0d8575'} size="large" />
    </View>
  );
}
