import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  pruefeStandortPflicht,
  standortPflichtErfuellen,
  type StandortPflicht,
} from '@/lib/services/standortPflicht';

/**
 * Stand der Standortpflicht für einen Reward-Screen (siehe
 * `lib/services/standortPflicht.ts`).
 *
 * `stand === null` heißt „noch nicht geprüft" — der Screen zeigt dann weder
 * die Sperre noch den eigentlichen Inhalt, damit nichts aufblitzt (etwa die
 * Kamera-Abfrage vor der Standort-Abfrage).
 *
 * Neu geprüft wird bei jedem Wechsel in den Vordergrund: nach dem Umweg
 * über die Einstellungen, aber auch wenn iOS „Einmal erlauben" beim
 * Hintergrundwechsel verfallen lässt. Ein Zähler sorgt dafür, dass nur die
 * zuletzt gestartete Prüfung den Stand setzt.
 */
export function useStandortPflicht(aktiv: boolean = true) {
  const [stand, setStand] = useState<StandortPflicht | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const epoche = useRef(0);
  const laeuftRef = useRef(false);

  const pruefen = useCallback(async (): Promise<StandortPflicht> => {
    const meine = ++epoche.current;
    const s = await pruefeStandortPflicht();
    if (meine === epoche.current) setStand(s);
    return s;
  }, []);

  useEffect(() => {
    if (!aktiv) return;
    // Ein Stand aus einer früheren Aktivierung ist veraltet — lieber kurz
    // nichts zeigen als den falschen Inhalt aufblitzen lassen.
    setStand(null);
    void pruefen();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void pruefen();
    });
    return () => {
      sub.remove();
      // Bei der nächsten Aktivierung nicht den alten Stand aufblitzen lassen.
      setStand(null);
    };
  }, [aktiv, pruefen]);

  const erfuellen = useCallback(async () => {
    if (laeuftRef.current) return;
    laeuftRef.current = true;
    setLaeuft(true);
    try {
      const vorher = await pruefeStandortPflicht();
      const nachher = await standortPflichtErfuellen(vorher);
      // null = der Nutzer ist in die Einstellungen gewechselt; den Stand
      // liefert die Prüfung beim Zurückkehren (AppState). Hier nichts setzen,
      // sonst überschriebe ein spät zurückkehrendes openSettings() die
      // frische Prüfung.
      if (nachher !== null) {
        epoche.current += 1;
        setStand(nachher);
      }
    } finally {
      laeuftRef.current = false;
      setLaeuft(false);
    }
  }, []);

  return { stand, laeuft, pruefen, erfuellen };
}
