import { Alert } from 'react-native';
import { BonScannerFehler, aufnahmeFehlerArt } from 'bon-edge-detector';

import { showInfoToast } from '@/lib/services/ui/toast';

/** Kamera war beim Auslösen kurz nicht bereit (Zeitgrenze / Sitzung lief
 *  nicht). Kein Fehler des Nutzers — ein zweiter Tipp genügt. */
export const KAMERA_GLEICH_BEREIT = 'Die Kamera ist gleich bereit — tipp einfach nochmal.';

/**
 * Hinweis, wenn das System die Kamera unterbrochen hat. Hier hilft ein
 * weiterer Tipp allein NICHT (im Nebeneinander-Modus etwa bleibt die Kamera
 * gesperrt, bis die App im Vollbild läuft) — darum nie „gleich bereit“
 * versprechen, sondern den Ausweg nennen. Die Galerie gibt es in beiden
 * Aufrufern (Bon-Scanner, Produkt-Assistent). Als Dialog statt Toast: der
 * Text ist zum Lesen da, der Toast bricht nach zwei Zeilen ab.
 */
export function kameraBelegtHinweis(grund: string | null): { titel: string; text: string } {
  switch (grund) {
    case 'multitasking':
      return {
        titel: 'Die Kamera braucht den Vollbild-Modus',
        text: 'Öffne MarkenDetektive im Vollbild, dann kannst du direkt loslegen. Oder nimm ein Foto aus deiner Galerie.',
      };
    case 'other_client':
      return {
        titel: 'Die Kamera ist gerade in Benutzung',
        text: 'Eine andere App nutzt gerade die Kamera. Sobald sie frei ist, geht’s hier weiter. Oder nimm ein Foto aus deiner Galerie.',
      };
    case 'system_pressure':
      return {
        titel: 'Die Kamera macht kurz Pause',
        text: 'Dein Handy ist gerade sehr warm, deshalb pausiert die Kamera kurz. In ein paar Minuten geht’s weiter. Oder nimm ein Foto aus deiner Galerie.',
      };
    default:
      return {
        titel: 'Die Kamera ist gerade in Benutzung',
        text: 'Im Vollbild und ohne andere Kamera-App geht’s direkt weiter. Oder nimm ein Foto aus deiner Galerie.',
      };
  }
}

/**
 * Die Kamera lässt sich nicht nutzen (keine Kamera, oder ein Laufzeitfehler
 * hat sie angehalten). Ein weiterer Tipp hilft nicht — darum nie „versuch es
 * noch einmal“, sondern die Galerie; eine neu geöffnete Kamera richtet sich
 * neu ein.
 */
export const KAMERA_NICHT_ERREICHBAR = {
  titel: 'Die Kamera ist gerade nicht erreichbar',
  text: 'Mach das Foto kurz mit deiner Kamera-App und wähl es hier über die Galerie aus. Beim nächsten Öffnen der Kamera geht’s auch hier wieder direkt los.',
} as const;

/**
 * Die Kamera hat ausgelöst, aber das Bild kam nicht innerhalb der großzügigen
 * Zeitgrenze. Wer jetzt erneut tippt, läuft wahrscheinlich wieder hinein —
 * darum die Galerie statt „tipp nochmal“. Das verspätete Bild wird verworfen
 * und liegt NICHT in der Fotos-App: darum den konkreten Weg nennen (Kamera-App,
 * dann Galerie), nie „nimm es aus deiner Galerie“.
 */
export const AUFNAHME_DAUERT = {
  titel: 'Über die Galerie geht’s gerade schneller',
  text: 'Mach das Foto kurz mit deiner Kamera-App und wähl es hier über die Galerie aus – oder öffne die Kamera einfach neu.',
} as const;

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
    case 'kamera_belegt': {
      const grund = fehler instanceof BonScannerFehler ? fehler.grund : null;
      const { titel, text } = kameraBelegtHinweis(grund);
      Alert.alert(titel, text);
      return;
    }
    case 'kamera_fehlt':
      Alert.alert(KAMERA_NICHT_ERREICHBAR.titel, KAMERA_NICHT_ERREICHBAR.text);
      return;
    case 'zu_langsam':
      Alert.alert(AUFNAHME_DAUERT.titel, AUFNAHME_DAUERT.text);
      return;
    case 'still':
      return;
    case 'fehlgeschlagen':
      Alert.alert('Aufnahme fehlgeschlagen', 'Bitte versuch es noch einmal.');
  }
}
