/**
 * usePreferenceProfile — Slice D (Konsum).
 *
 * Liest users/{uid}/profile/preferences EINMAL pro Session (modul-gecacht,
 * read-once — Kostenregel) und stellt es read-only bereit. Konsumenten biasen
 * damit nur (z.B. Default-Sort), filtern nie hart (keine Filterblase).
 */

import { doc, getDoc } from '@react-native-firebase/firestore';
import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/contexts/AuthContext';
import { db } from '@/lib/firebase';
import {
  PROFILE_DIMENSIONS,
  type PreferenceProfile,
  type ProfileDimension,
} from '@/lib/services/preferenceProfileService';

// Module-scoped read-once cache (RAM only, kein erneuter Read pro Mount).
let cache: { uid: string; profile: PreferenceProfile | null } | null = null;

export function usePreferenceProfile(): PreferenceProfile | null {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [profile, setProfile] = useState<PreferenceProfile | null>(
    cache && cache.uid === uid ? cache.profile : null,
  );

  useEffect(() => {
    if (!uid) {
      setProfile(null);
      return;
    }
    if (cache && cache.uid === uid) {
      setProfile(cache.profile);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', uid, 'profile', 'preferences'));
        const p = snap.exists() ? (snap.data() as PreferenceProfile) : null;
        cache = { uid, profile: p };
        if (alive) setProfile(p);
      } catch {
        if (alive) setProfile(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [uid]);

  return profile;
}

/** Dominante Dimension (höchster EWMA-Wert) + ihre Confidence, oder null. */
export function dominantDimension(
  p: PreferenceProfile | null,
): { dim: ProfileDimension; value: number; confidence: number } | null {
  if (!p?.dimensions) return null;
  let best: ProfileDimension | null = null;
  let bestV = -1;
  for (const d of PROFILE_DIMENSIONS) {
    const v = typeof p.dimensions[d] === 'number' ? p.dimensions[d] : 0;
    if (v > bestV) {
      bestV = v;
      best = d;
    }
  }
  if (!best) return null;
  return { dim: best, value: bestV, confidence: p.confidence?.[best] ?? 0 };
}
