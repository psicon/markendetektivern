/**
 * Cashback service — config + consent + user-fields helpers.
 *
 * Stays client-side only for read paths (config, own user state).
 * All write paths that affect cashback balance MUST go through the
 * Cloud Functions in `cloud-functions/cashback-pipeline/` —
 * never trust the client to compute eligibility, tier, or balance.
 *
 * See CASHBACK_ARCHITECTURE.md §3 for the schema and §11 for hard rules.
 */

import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc, type Unsubscribe } from 'firebase/firestore';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

import { db } from '@/lib/firebase';
import {
  DEFAULT_CASHBACK_CONFIG,
  type CashbackConfigDoc,
  type CashbackConsentState,
  type CashbackUserFields,
} from '@/lib/types/cashback';

const CONFIG_DOC_PATH = 'cashback_config/v1';

// In-memory caches (TTL: 5 min for config, no TTL for user state — that
// always uses snapshot listeners).
let configCache: { value: CashbackConfigDoc; fetchedAt: number } | null = null;
const CONFIG_TTL_MS = 5 * 60 * 1000;

// ─── Config ─────────────────────────────────────────────────────────

/**
 * Load the cashback_config doc with a 5-minute in-memory cache.
 * Falls back to DEFAULT_CASHBACK_CONFIG if the doc doesn't exist
 * (e.g. before Phase 1 deployment, or if the user is offline).
 */
export async function getCashbackConfig(forceRefresh = false): Promise<CashbackConfigDoc> {
  if (!forceRefresh && configCache && Date.now() - configCache.fetchedAt < CONFIG_TTL_MS) {
    return configCache.value;
  }

  try {
    const snap = await getDoc(doc(db, CONFIG_DOC_PATH));
    const value = snap.exists()
      ? ({ ...DEFAULT_CASHBACK_CONFIG, ...(snap.data() as Partial<CashbackConfigDoc>) } as CashbackConfigDoc)
      : DEFAULT_CASHBACK_CONFIG;
    configCache = { value, fetchedAt: Date.now() };
    return value;
  } catch (error) {
    console.warn('⚠️ getCashbackConfig failed, using defaults:', error);
    return DEFAULT_CASHBACK_CONFIG;
  }
}

// ─── Consent ────────────────────────────────────────────────────────

/**
 * Read the cashback_consent block from the user doc.
 * Returns null if user doc doesn't exist or has no consent block.
 */
export async function getCashbackConsent(uid: string): Promise<CashbackConsentState | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    const data = snap.data() as Partial<CashbackUserFields>;
    return data.cashback_consent ?? null;
  } catch (error) {
    console.warn('⚠️ getCashbackConsent failed:', error);
    return null;
  }
}

/**
 * Has the user accepted the cashback consent for the current version?
 */
export async function hasValidCashbackConsent(uid: string): Promise<boolean> {
  const config = await getCashbackConfig();
  const consent = await getCashbackConsent(uid);
  return Boolean(consent?.accepted) && consent?.version === config.consentVersion;
}

/**
 * Record cashback consent acceptance on the user doc.
 * Throws if the write fails — caller decides UX (retry / route back).
 */
export async function acceptCashbackConsent(uid: string): Promise<void> {
  const config = await getCashbackConfig();
  const appVersion = Constants.expoConfig?.version ?? Constants.manifest?.version ?? 'unknown';

  const consent: CashbackConsentState = {
    accepted: true,
    version: config.consentVersion,
    acceptedAt: serverTimestamp() as unknown as CashbackConsentState['acceptedAt'],
    appVersion: `${appVersion}-${Platform.OS}`,
  };

  // setDoc with merge to be safe even if user doc doesn't exist yet
  await setDoc(doc(db, 'users', uid), { cashback_consent: consent }, { merge: true });
}

/**
 * Revoke / withdraw consent. We keep the version + acceptedAt for audit
 * (DSGVO requires evidence of when consent existed) but flip `accepted`.
 */
export async function revokeCashbackConsent(uid: string): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    'cashback_consent.accepted': false,
  });
}

// ─── User-side state subscription ───────────────────────────────────

export interface CashbackUserSnapshot {
  balanceCents: number;
  lifetimeCents: number;
  pendingCents: number;
  lastBonDate: string | null;
  trustScore: number;
  consent: CashbackConsentState | null;
}

const EMPTY_SNAPSHOT: CashbackUserSnapshot = {
  balanceCents: 0,
  lifetimeCents: 0,
  pendingCents: 0,
  lastBonDate: null,
  trustScore: 0,
  consent: null,
};

/**
 * Subscribe to the cashback fields on the user doc. Returns the
 * unsubscribe function. Calls `onChange` immediately with the current
 * value (or EMPTY_SNAPSHOT if doc doesn't exist).
 */
export function subscribeCashbackUserState(
  uid: string,
  onChange: (snapshot: CashbackUserSnapshot) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) {
        onChange(EMPTY_SNAPSHOT);
        return;
      }
      const data = snap.data() as Partial<CashbackUserFields>;
      onChange({
        balanceCents: data.cashback_balance_cents ?? 0,
        lifetimeCents: data.cashback_lifetime_cents ?? 0,
        pendingCents: data.cashback_pending_cents ?? 0,
        lastBonDate: data.cashback_last_bon_date ?? null,
        trustScore: data.trust_score ?? 0,
        consent: data.cashback_consent ?? null,
      });
    },
    (error) => {
      console.warn('⚠️ subscribeCashbackUserState error:', error);
      onChange(EMPTY_SNAPSHOT);
    },
  );
}

// ─── Daily-cap pre-check (client-side soft check) ────────────────────

/**
 * Returns whether the user has likely exhausted today's bon-cap based
 * on `cashback_last_bon_date`. **Soft check only — server is authoritative.**
 *
 * Uses Bon-Datum semantics from CASHBACK_ARCHITECTURE.md §1: the
 * user's "today" is `Europe/Berlin`.
 */
export function isLikelyOverDailyCap(lastBonDate: string | null): boolean {
  if (!lastBonDate) return false;
  const todayBerlin = new Date().toLocaleDateString('en-CA', {
    timeZone: 'Europe/Berlin',
  });
  return lastBonDate === todayBerlin;
}

/**
 * Force-clear the in-memory config cache. Useful after admin updates
 * to cashback_config or in tests.
 */
export function _resetCashbackCache() {
  configCache = null;
}
