// Lazy-fill of `userProfile.guessedCity` / `guessedBundesland` from
// the user's own journey history.
//
// Runs at most once per user (when both fields are still empty),
// scheduled via InteractionManager so it never blocks the main
// render. Reads up to 50 of the user's most recent journeys, picks
// the most-frequent IP-derived city, looks up the Bundesland, writes
// back to userProfile.
//
// This is the "Übergangslösung" the user wanted: until they
// explicitly set a city via the Region-Setup sheet, the guessed
// values drive the prompt suggestion and serve as a fallback for
// the leaderboard aggregator.

import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { InteractionManager } from 'react-native';
import { db } from '@/lib/firebase';
import {
  CITY_TO_BUNDESLAND,
  normalizeCityName,
} from '@/lib/data/city-to-bundesland';

const JOURNEY_SAMPLE = 50;

/**
 * Compute a most-frequent-city guess from the user's journey
 * subcollection and write it back to their profile. Idempotent —
 * if either field is already set we skip. Errors are swallowed so
 * a transient Firestore hiccup doesn't surface as a UI failure.
 */
export async function guessRegionForUser(
  uid: string,
  userProfile: { city?: string; guessedCity?: string } | null | undefined,
): Promise<{ city: string; bundesland: string } | null> {
  if (!uid) return null;
  // Skip if user has already opted in OR a previous lazy-fill
  // already wrote a value. Both stay forever; this runs at most once.
  if (userProfile?.city || userProfile?.guessedCity) return null;

  try {
    const q = query(
      collection(db, 'users', uid, 'journeys'),
      orderBy('lastUpdated', 'desc'),
      limit(JOURNEY_SAMPLE),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;

    const tally = new Map<string, number>();
    snap.forEach((d) => {
      const data = d.data() as any;
      const loc = data.location;
      if (!loc || !loc.city) return;
      if (loc.source === 'fallback') return;
      if (loc.city === 'DACH-Region') return;
      const city = normalizeCityName(loc.city);
      tally.set(city, (tally.get(city) || 0) + 1);
    });
    if (tally.size === 0) return null;

    // Most-frequent wins (ties broken by insertion order = recency).
    let best: { city: string; n: number } | null = null;
    tally.forEach((n, city) => {
      if (!best || n > best.n) best = { city, n };
    });
    if (!best) return null;
    const bundesland = CITY_TO_BUNDESLAND[best.city];
    if (!bundesland) return null;

    await updateDoc(doc(db, 'users', uid), {
      guessedCity: best.city,
      guessedBundesland: bundesland,
    });
    return { city: best.city, bundesland };
  } catch {
    // Swallowed on purpose — no UI surfacing for a background guess.
    return null;
  }
}

/**
 * Schedule the guess to run after the current render frame. Safe to
 * call from any effect; bails out if there's nothing to do.
 */
export function scheduleRegionGuess(
  uid: string | null | undefined,
  userProfile: { city?: string; guessedCity?: string } | null | undefined,
  onDone?: () => void,
): { cancel: () => void } {
  if (!uid || userProfile?.city || userProfile?.guessedCity) {
    return { cancel: () => {} };
  }
  const handle = InteractionManager.runAfterInteractions(async () => {
    await guessRegionForUser(uid, userProfile);
    onDone?.();
  });
  return handle;
}
