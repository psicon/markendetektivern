import { useCallback, useEffect, useRef } from 'react';

import { aufnahmeKontextStarten, type CaptureContext } from '@/lib/services/captureContext';

/**
 * Standort im Moment der Bon-Aufnahme: startet beim Öffnen der Prüfseite,
 * das Ergebnis holt „Einreichen" ab (höchstens AUFNAHME_KONTEXT_MS Wartezeit).
 * Logik und Tests: `aufnahmeKontextStarten` in lib/services/captureContext.ts.
 */
export function useAufnahmeKontext(capturedAt: number): () => Promise<CaptureContext> {
  const laufRef = useRef<{ fuer: number; holen: () => Promise<CaptureContext> } | null>(null);

  useEffect(() => {
    laufRef.current = { fuer: capturedAt, holen: aufnahmeKontextStarten(capturedAt) };
  }, [capturedAt]);

  return useCallback(() => {
    const lauf = laufRef.current;
    const holen = lauf && lauf.fuer === capturedAt ? lauf.holen : aufnahmeKontextStarten(capturedAt);
    return holen();
  }, [capturedAt]);
}
