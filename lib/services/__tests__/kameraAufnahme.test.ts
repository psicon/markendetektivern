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
import {
  BILDSCHIRM_WEG,
  ENTZERREN_LIMIT_MS,
  aufnahmeMitGrenze,
  entzerrenMitGrenze,
} from '@/lib/services/kameraAufnahme';

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

  it('meldet eine noch hängende vorige Aufnahme (iOS ERR_CAMERA_NOT_READY) wie die Zeitgrenze', async () => {
    // expo-camera wirft das, wenn nach `timeout_bild` erneut getippt wird und
    // die alte Aufnahme nativ noch läuft — ein weiterer Tipp hilft nicht.
    const auf = steuerbar<{ uri: string }>();
    const ergebnis = aufnahmeMitGrenze(auf.zusage, GRENZE, () => true);
    auf.scheitern(Object.assign(new Error('Camera unmounted during taking photo process'), {
      code: 'ERR_CAMERA_NOT_READY',
    }));
    const e = await ergebnis.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(BonScannerFehler);
    expect((e as BonScannerFehler).code).toBe('timeout_bild');
    expect(aufnahmeFehlerArt(e)).toBe('zu_langsam');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('lässt andere expo-Fehlercodes unverändert durch', async () => {
    const auf = steuerbar<{ uri: string }>();
    const ergebnis = aufnahmeMitGrenze(auf.zusage, GRENZE, () => true);
    const anderer = Object.assign(new Error('Image could not be captured'), {
      code: 'ERR_CAMERA_IMAGE_CAPTURE',
    });
    auf.scheitern(anderer);
    await expect(ergebnis).rejects.toBe(anderer);
  });

  describe('Bildschirm inzwischen verlassen oder abgebaut', () => {
    it('verschluckt auch ERR_CAMERA_NOT_READY', async () => {
      let aktiv = true;
      const auf = steuerbar<{ uri: string }>();
      const ergebnis = aufnahmeMitGrenze(auf.zusage, GRENZE, () => aktiv);
      aktiv = false;
      auf.scheitern(Object.assign(new Error('busy'), { code: 'ERR_CAMERA_NOT_READY' }));
      await expect(ergebnis).resolves.toBe(BILDSCHIRM_WEG);
    });

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

describe('entzerrenMitGrenze', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    warn.mockRestore();
  });

  it('nimmt das entzerrte Bild, wenn es rechtzeitig kommt', async () => {
    const ent = steuerbar<{ uri: string } | null>();
    const ergebnis = entzerrenMitGrenze('file:///roh.jpg', () => ent.zusage);
    ent.erfuellen({ uri: 'file:///bon-cropped-1.jpg' });
    await expect(ergebnis).resolves.toBe('file:///bon-cropped-1.jpg');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('nimmt das Rohbild, wenn kein Bon-Umriss gefunden wurde', async () => {
    await expect(entzerrenMitGrenze('file:///roh.jpg', async () => null)).resolves.toBe(
      'file:///roh.jpg',
    );
  });

  it('nimmt das Rohbild, wenn das Entzerren scheitert (auch synchron)', async () => {
    await expect(
      entzerrenMitGrenze('file:///roh.jpg', async () => {
        throw new Error('vision kaputt');
      }),
    ).resolves.toBe('file:///roh.jpg');
    await expect(
      entzerrenMitGrenze('file:///roh.jpg', () => {
        throw new Error('modul fehlt');
      }),
    ).resolves.toBe('file:///roh.jpg');
  });

  it('dreht nie endlos: nach der Grenze geht es mit dem Rohbild weiter', async () => {
    const ent = steuerbar<{ uri: string } | null>();
    const ergebnis = entzerrenMitGrenze('file:///roh.jpg', () => ent.zusage);
    let fertig = false;
    void ergebnis.then(() => (fertig = true));
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(ENTZERREN_LIMIT_MS - 1);
    await Promise.resolve();
    expect(fertig).toBe(false);
    jest.advanceTimersByTime(1);
    await expect(ergebnis).resolves.toBe('file:///roh.jpg');
    // Das verspätete Bild ändert am Ergebnis nichts und wirft nicht.
    ent.erfuellen({ uri: 'file:///bon-cropped-spaet.jpg' });
    await Promise.resolve();
    await expect(ergebnis).resolves.toBe('file:///roh.jpg');
  });
});
