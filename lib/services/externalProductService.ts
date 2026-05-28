/**
 * ExternalProductService — Cache-Layer für EAN-Lookups aus externen
 * Quellen (REWE/scraped_products, Globus, OpenFood, …).
 *
 * T1 (dieser File): nur Cache-Layer (Read/Write/Expiry-Check). Die
 * Lookup-Cascade kommt in T2 als `lookupByEAN`-Methode hierauf.
 *
 * Collection: `external_products` (Doc-Id = EAN).
 *
 * Cache-Regel: `cachedAt + 4 Wochen < now` → stale → Re-Fetch nötig.
 */

import { db } from '@/lib/firebase';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
} from '@react-native-firebase/firestore';

import {
  EXTERNAL_CACHE_MAX_AGE_MS,
  type ExternalProductDoc,
  type ExternalProductSource,
} from '@/lib/types/externalProduct';

const COLLECTION = 'external_products';

/** Normalisiert einen EAN-String auf nur Ziffern (Doc-Id-safe). */
export function normaliseEan(ean: string): string {
  return String(ean ?? '').trim().replace(/\D/g, '');
}

/**
 * True wenn ein Eintrag älter als die Cache-Lebenszeit ist und neu
 * gefetched werden sollte.
 */
export function isExternalCacheStale(cachedAt?: Timestamp | null): boolean {
  if (!cachedAt) return true;
  const ts = cachedAt.toMillis?.() ?? 0;
  return Date.now() - ts > EXTERNAL_CACHE_MAX_AGE_MS;
}

/**
 * Liest einen Eintrag aus der external_products-Collection.
 * Gibt das Doc zurück egal ob frisch oder stale — Stale-Check macht
 * der Caller (T2 entscheidet ob Re-Fetch). null wenn kein Doc.
 */
async function getCached(ean: string): Promise<ExternalProductDoc | null> {
  const norm = normaliseEan(ean);
  if (!norm) return null;
  try {
    const ref = doc(db, COLLECTION, norm);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as ExternalProductDoc;
  } catch (e: any) {
    console.warn('ExternalProductService.getCached failed', e?.message);
    return null;
  }
}

/**
 * Schreibt einen normalisierten Source-Treffer in den Cache.
 * `cachedAt` wird via serverTimestamp gesetzt damit Timezone-egal
 * konsistent ist. Existierende Doc-Felder werden via merge:true
 * überschrieben, NICHT komplett ersetzt — so kann eine zweite Source
 * (z.B. OpenFood) ergänzende Felder (Nutriscore) nachschieben ohne
 * REWE-Daten zu kippen.
 */
async function writeThrough(
  ean: string,
  source: ExternalProductSource,
  data: Omit<ExternalProductDoc, 'ean' | 'source' | 'cachedAt'>,
): Promise<void> {
  const norm = normaliseEan(ean);
  if (!norm) return;
  try {
    const ref = doc(db, COLLECTION, norm);
    const payload: Partial<ExternalProductDoc> = {
      ...data,
      ean: norm,
      source,
      cachedAt: serverTimestamp() as Timestamp,
    };
    await setDoc(ref, payload, { merge: true });
  } catch (e: any) {
    console.warn('ExternalProductService.writeThrough failed', e?.message);
  }
}

/**
 * Liefert das gecachte Doc nur wenn es noch frisch ist (< 4 Wochen).
 * Stale-Hits returnen null damit der Caller (T2) sauber re-fetched.
 * Wer das stale Doc trotzdem braucht (z.B. als Fallback wenn Source
 * tot ist), nimmt `getCached` direkt.
 */
async function getFresh(ean: string): Promise<ExternalProductDoc | null> {
  const cached = await getCached(ean);
  if (!cached) return null;
  if (isExternalCacheStale(cached.cachedAt as any)) return null;
  return cached;
}

export const ExternalProductService = {
  getCached,
  getFresh,
  writeThrough,
  isExternalCacheStale,
  normaliseEan,
};

export default ExternalProductService;
