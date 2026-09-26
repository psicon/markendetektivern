import { useCallback, useEffect, useRef } from 'react';

import { aufnahmeKontextStarten, type CaptureContext } from '@/lib/services/captureContext';

/**
 * Standort im Moment der Bon-Aufnahme: startet beim Öffnen der Prüfseite,
 * das Ergebnis holt „Einreichen" ab (höchstens AUFNAHME_KONTEXT_MS Wartezeit).
 * Mit `messen = false` (Bild aus der Galerie) wird nichts gemessen → `null`.
 * Logik und Tests: `aufnahmeKontextStarten` in lib/services/captureContext.ts.
 */
export function useAufnahmeKontext(
  capturedAt: number,
  messen: boolean,
): () => Promise<CaptureContext | null> {
  const laufRef = useRef<{ fuer: number; holen: () => Promise<CaptureContext> } | null>(null);

  useEffect(() => {
    laufRef.current = messen ? { fuer: capturedAt, holen: aufnahmeKontextStarten(capturedAt) } : null;
  }, [capturedAt, messen]);

  return useCallback(async () => {
    if (!messen) return null;
    const lauf = laufRef.current;
    const holen = lauf && lauf.fuer === capturedAt ? lauf.holen : aufnahmeKontextStarten(capturedAt);
    return holen();
  }, [capturedAt, messen]);
}
