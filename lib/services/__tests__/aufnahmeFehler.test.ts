/**
 * Rückmeldung bei gescheiterter Aufnahme (lib/services/ui/aufnahmeFehler.ts).
 *
 * Kern: Eine Unterbrechung der Kamera durch das System (Nebeneinander-Modus,
 * andere App) darf NICHT „gleich bereit — tipp nochmal“ melden, sondern muss
 * den Ausweg nennen.
 */

const alertMock = jest.fn();
const toastMock = jest.fn();

jest.mock('react-native', () => ({ Alert: { alert: (...a: unknown[]) => alertMock(...a) } }));
jest.mock('@/lib/services/ui/toast', () => ({
  showInfoToast: (...a: unknown[]) => toastMock(...a),
}));
// Das Paket zeigt im node_modules-Link auf den Haupt-Checkout; die reine
// Logik direkt aus diesem Stand laden.
jest.mock('bon-edge-detector', () =>
  jest.requireActual('@/modules/bon-edge-detector/src/aufnahmeZuordnung'),
);

import { BonScannerFehler } from '@/modules/bon-edge-detector/src/aufnahmeZuordnung';
import {
  KAMERA_GLEICH_BEREIT,
  kameraBelegtHinweis,
  zeigeAufnahmeFehler,
} from '@/lib/services/ui/aufnahmeFehler';

describe('zeigeAufnahmeFehler', () => {
  it('lädt bei kurz nicht bereiter Kamera zum erneuten Tippen ein', () => {
    zeigeAufnahmeFehler(new BonScannerFehler('session_not_running'));
    expect(toastMock).toHaveBeenCalledWith(KAMERA_GLEICH_BEREIT, 'info');
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('nennt im Nebeneinander-Modus den Ausweg statt „gleich bereit“', () => {
    zeigeAufnahmeFehler(new BonScannerFehler('session_interrupted', 'multitasking'));
    expect(toastMock).not.toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledTimes(1);
    const [titel, text] = alertMock.mock.calls[0];
    expect(`${titel} ${text}`).toMatch(/Vollbild/);
    expect(text).toMatch(/Galerie/);
  });

  it('zeigt auch ohne bekannten Grund einen Ausweg', () => {
    zeigeAufnahmeFehler(new BonScannerFehler('session_interrupted'));
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0][1]).toMatch(/Galerie/);
  });

  it('bleibt still, wenn die Ansicht abgebaut wurde', () => {
    zeigeAufnahmeFehler(new BonScannerFehler('unmounted'));
    expect(toastMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe('kameraBelegtHinweis', () => {
  it.each(['multitasking', 'other_client', 'system_pressure', null, 'ein_neuer_grund'])(
    'hat für %p einen Text mit Ausweg und ohne „gleich bereit“',
    (grund) => {
      const { titel, text } = kameraBelegtHinweis(grund);
      expect(titel.length).toBeGreaterThan(0);
      expect(text).toMatch(/Galerie/);
      expect(`${titel} ${text}`).not.toMatch(/gleich bereit/);
    },
  );
});
