import { Alert } from 'react-native';
import { aufnahmeFehlerArt } from 'bon-edge-detector';

import { showInfoToast } from '@/lib/services/ui/toast';

/** Kamera war beim Auslösen kurz nicht bereit (Zeitgrenze / Sitzung lief
 *  nicht). Kein Fehler des Nutzers — ein zweiter Tipp genügt. */
export const KAMERA_GLEICH_BEREIT = 'Die Kamera ist gleich bereit — tipp einfach nochmal.';

/**
 * Einheitliche Rückmeldung, wenn eine Aufnahme (Bon-Scanner, Produktfoto)
 * nicht klappt. Der Aufrufer setzt seinen Aufnahme-Zustand selbst zurück
 * (`finally`); hier geht es nur um die Meldung.
 */
export function zeigeAufnahmeFehler(fehler: unknown): void {
  switch (aufnahmeFehlerArt(fehler)) {
    case 'nochmal_tippen':
      showInfoToast(KAMERA_GLEICH_BEREIT, 'info');
      return;
    case 'still':
      return;
    case 'fehlgeschlagen':
      Alert.alert('Aufnahme fehlgeschlagen', 'Bitte versuch es noch einmal.');
  }
}
