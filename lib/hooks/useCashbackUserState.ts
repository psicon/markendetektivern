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
      hasConsent: Boolean(state.consent?.accepted),
      uid,
    }),
    [state, isLoading, uid],
  );
}
