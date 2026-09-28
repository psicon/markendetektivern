/**
 * expo-camera-Auslöser mit Zeitgrenze und Lebenszyklus-Prüfung
 * (lib/services/kameraAufnahme.ts) — Bon-Scanner-Ersatzweg und
 * Produktfoto-Assistent.
 *
 * Vorfall-Klassen (Prüfrunde 2, 28.09.2026):
 * - `takePictureAsync` ohne Grenze: hängt die Kamera, dreht der Auslöser
 *   endlos (Projektregel: kein Spinner ohne Zeitgrenze an nativem await).
 * - Nach dem await ist der Screen womöglich verlassen: ein Hinweis erschiene
 *   über einer fremden Seite, eine Navigation träfe deren Route.
 */

jest.mock('react-native', () => ({
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
}));
// Das Paket zeigt im node_modules-Link auf den Haupt-Checkout; die reine
// Logik direkt aus diesem Stand laden.
jest.mock('bon-edge-detector', () =>
  jest.requireActual('@/modules/bon-edge-detector/src/aufnahmeZuordnung'),
);

import { BonScannerFehler, aufnahmeFehlerArt } from '@/modules/bon-edge-detector/src/aufnahmeZuordnung';
import { BILDSCHIRM_WEG, aufnahmeMitGrenze } from '@/lib/services/kameraAufnahme';

const GRENZE = 30_000;

/** Eine Aufnahme, deren Ausgang der Test bestimmt. */
function steuerbar<T>() {
  let erfuellen!: (wert: T) => void;
  let scheitern!: (fehler: unknown) => void;
  const zusage = new Promise<T>((res, rej) => {
    erfuellen = res;
    scheitern = rej;
  });
  return { zusage, erfuellen, scheitern };
}

describe('aufnahmeMitGrenze', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('liefert das Foto, solange der Bildschirm aktiv ist', async () => {
    const auf = steuerbar<{ uri: string }>();
    const ergebnis = aufnahmeMitGrenze(auf.zusage, GRENZE, () => true);
    auf.erfuellen({ uri: 'file:///foto.jpg' });
    await expect(ergebnis).resolves.toEqual({ uri: 'file:///foto.jpg' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('beendet eine hängende Aufnahme an der Grenze mit `timeout_bild` — ohne „tipp nochmal“', async () => {
    const auf = steuerbar<{ uri: string }>();
    const ergebnis = aufnahmeMitGrenze(auf.zusage, GRENZE, () => true);
    const fehler = ergebnis.catch((e: unknown) => e);
    jest.advanceTimersByTime(GRENZE - 1);
    let fertig = false;
    void ergebnis.then(
      () => (fertig = true),
      () => (fertig = true),
    );
    await Promise.resolve();
    expect(fertig).toBe(false);
    jest.advanceTimersByTime(1);
    const e = await fehler;
    expect(e).toBeInstanceOf(BonScannerFehler);
    expect((e as BonScannerFehler).code).toBe('timeout_bild');
    expect(aufnahmeFehlerArt(e)).toBe('zu_langsam');
  });

  it('lässt ein Foto, das nach der Grenze kommt, ins Leere fallen', async () => {
    const auf = steuerbar<{ uri: string }>();
    const ergebnis = aufnahmeMitGrenze(auf.zusage, GRENZE, () => true);
    const fehler = ergebnis.catch((e: unknown) => e);
    jest.advanceTimersByTime(GRENZE);
    expect(((await fehler) as BonScannerFehler).code).toBe('timeout_bild');
    // Das späte Foto ändert am schon gemeldeten Ausgang nichts und wirft nicht.
    auf.erfuellen({ uri: 'file:///spaet.jpg' });
    await Promise.resolve();
    expect(((await fehler) as BonScannerFehler).code).toBe('timeout_bild');
  });

  it('reicht einen Kamerafehler weiter, solange der Bildschirm aktiv ist', async () => {
    const auf = steuerbar<{ uri: string }>();
    const ergebnis = aufnahmeMitGrenze(auf.zusage, GRENZE, () => true);
    const kaputt = new Error('camera closed');
    auf.scheitern(kaputt);
    await expect(ergebnis).rejects.toBe(kaputt);
    expect(jest.getTimerCount()).toBe(0);
  });

  describe('Bildschirm inzwischen verlassen oder abgebaut', () => {
    it('verwirft ein fertiges Foto (keine Navigation, kein State)', async () => {
      let aktiv = true;
      const auf = steuerbar<{ uri: string }>();
      const ergebnis = aufnahmeMitGrenze(auf.zusage, GRENZE, () => aktiv);
      aktiv = false;
      auf.erfuellen({ uri: 'file:///foto.jpg' });
      await expect(ergebnis).resolves.toBe(BILDSCHIRM_WEG);
    });

    it('verschluckt die abgelaufene Grenze (kein Hinweis über einer fremden Seite)', async () => {
      let aktiv = true;
      const auf = steuerbar<{ uri: string }>();
      const ergebnis = aufnahmeMitGrenze(auf.zusage, GRENZE, () => aktiv);
      aktiv = false;
      jest.advanceTimersByTime(GRENZE);
      await expect(ergebnis).resolves.toBe(BILDSCHIRM_WEG);
    });

    it('verschluckt einen Kamerafehler', async () => {
      let aktiv = true;
      const auf = steuerbar<{ uri: string }>();
      const ergebnis = aufnahmeMitGrenze(auf.zusage, GRENZE, () => aktiv);
      aktiv = false;
      auf.scheitern(new Error('camera closed'));
      await expect(ergebnis).resolves.toBe(BILDSCHIRM_WEG);
    });

    it('prüft erst NACH dem await — wer zurückkehrt, bevor das Foto kommt, bekommt es', async () => {
      let aktiv = false;
      const auf = steuerbar<{ uri: string }>();
      const ergebnis = aufnahmeMitGrenze(auf.zusage, GRENZE, () => aktiv);
      aktiv = true;
      auf.erfuellen({ uri: 'file:///foto.jpg' });
      await expect(ergebnis).resolves.toEqual({ uri: 'file:///foto.jpg' });
    });
  });
});
