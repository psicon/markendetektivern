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

/**
 * #2: declared > inferred. Vom User explizit Angegebenes überschreibt die
 * abgeleiteten Dimensionen (mit voller Confidence). declared kommt aus dem
 * profile.declared-Feld (vom CF aus dem User-Doc gespiegelt).
 */
function mergeDeclared(p: any): PreferenceProfile {
  const d = p?.declared;
  if (!d) return p;
  const dims = { ...(p.dimensions || {}) };
  const conf = { ...(p.confidence || {}) };
  const boost = (dim: string) => {
    dims[dim] = Math.max(typeof dims[dim] === 'number' ? dims[dim] : 0, 0.6);
    conf[dim] = 1;
  };
  if (d.favoriteMarket) boost('marketLoyalty');
  if (Array.isArray(d.dietary) && d.dietary.length) boost('health');
  if (Array.isArray(d.caresAbout)) {
    if (d.caresAbout.some((x: string) => ['sustainability', 'bio', 'regional', 'eco'].includes(x))) boost('sustainability');
    if (d.caresAbout.includes('quality')) boost('contentQuality');
    if (d.caresAbout.includes('price')) boost('price');
  }
  return { ...p, dimensions: dims, confidence: conf };
}

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
        const p = snap.exists() ? mergeDeclared(snap.data()) : null;
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
