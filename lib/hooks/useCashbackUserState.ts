/**
 * useCashbackUserState — live snapshot of the user's cashback fields.
 *
 * Subscribes to /users/{uid} for the duration of the component lifecycle.
 * Returns sane defaults while the subscription is bootstrapping.
 *
 * Usage:
 *   const { balanceCents, lifetimeCents, consent, isLoading } = useCashbackUserState();
 */

import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/lib/contexts/AuthContext';
import {
  getCashbackConfig,
  subscribeCashbackUserState,
  type CashbackUserSnapshot,
} from '@/lib/services/cashbackService';

export interface UseCashbackUserState extends CashbackUserSnapshot {
  isLoading: boolean;
  hasConsent: boolean;
  uid: string | null;
}

const EMPTY: CashbackUserSnapshot = {
  balanceCents: 0,
  lifetimeCents: 0,
  pendingCents: 0,
  lastBonDate: null,
  trustScore: 0,
  consent: null,
};

export function useCashbackUserState(): UseCashbackUserState {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [state, setState] = useState<CashbackUserSnapshot>(EMPTY);
  const [isLoading, setLoading] = useState<boolean>(Boolean(uid));
  // Aktuell geforderte Consent-Version aus der Config (gecacht im
  // Service). Ohne den Versions-Vergleich wäre ein consentVersion-Bump
  // wirkungslos — `accepted` bleibt ja true (ClickUp 86ca6u6xd).
  const [requiredVersion, setRequiredVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getCashbackConfig()
      .then((config) => {
        if (alive) setRequiredVersion(config.consentVersion);
      })
      .catch(() => {
        /* Config-Fetch failed → Fallback unten: nur `accepted` prüfen */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!uid) {
      setState(EMPTY);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = subscribeCashbackUserState(uid, (snapshot) => {
      setState(snapshot);
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  return useMemo<UseCashbackUserState>(
    () => ({
      ...state,
      isLoading,
      // Solange die Config noch lädt (requiredVersion null), zählt nur
      // `accepted` — verhindert ein kurzes Aufblitzen des Consent-Gates
      // bei Usern mit gültigem Consent.
      hasConsent:
        Boolean(state.consent?.accepted) &&
        (requiredVersion === null || state.consent?.version === requiredVersion),
      uid,
    }),
    [state, isLoading, uid, requiredVersion],
  );
}
