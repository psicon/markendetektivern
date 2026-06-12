import { useEffect, useRef } from 'react';

import { useNetworkStatus } from '@/lib/services/network';

/**
 * Auto-Retry bei Reconnect (ClickUp 86ca8c9n6): wenn ein Screen in
 * einem Fehler-State haengt und das Netz zurueckkommt (offline→online-
 * Flanke), wird `retry` automatisch gefeuert — der User muss nicht
 * selbst "Erneut versuchen" tippen ("wird nicht nachgeladen wenn
 * Empfang wieder da").
 *
 * `active` gated den Retry: nur retriggern, wenn der Screen wirklich
 * in einem retry-wuerdigen Zustand ist (z.B. Offline-/Generic-Fehler,
 * NICHT ein server-bestaetigtes "Produkt nicht gefunden").
 */
export function useAutoRetryOnReconnect(active: boolean, retry: () => void) {
  const net = useNetworkStatus();
  const prevOnlineRef = useRef(net.online);
  const retryRef = useRef(retry);
  retryRef.current = retry;

  useEffect(() => {
    const wasOnline = prevOnlineRef.current;
    prevOnlineRef.current = net.online;
    if (!wasOnline && net.online && active) {
      retryRef.current();
    }
  }, [net.online, active]);
}
