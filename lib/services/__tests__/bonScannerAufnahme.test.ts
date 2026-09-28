/**
 * BonScanner-Auslöser: Zuordnung Tipp → native Antwort und Zeitgrenze
 * (modules/bon-edge-detector/src/aufnahmeZuordnung.ts).
 *
 * Vorfall-Klasse: `capture()` wartete ohne Zeitgrenze, und jede native
 * Antwort löste die gerade offene Zusage auf — ein verspätetes Bild konnte so
 * die NÄCHSTE Aufnahme beantworten, eine nie beantwortete Aufnahme ließ den
 * Auslöser endlos drehen. Zweite Klasse (Prüfrunde 28.09.): eine feste
 * Grenze vom Tipp bis zum fertigen Bild verwarf auf langsamen Geräten gute
 * Bilder, und eine Unterbrechung der Kamera versprach „gleich bereit“.
 */

import {
  AUFNAHME_BILD_LIMIT_MS,
  AUFNAHME_START_LIMIT_MS,
  AufnahmeZuordnung,
  BonScannerFehler,
  aufnahmeFehlerArt,
  signalIdAus,
} from '@/modules/bon-edge-detector/src/aufnahmeZuordnung';

type Bild = { uri: string };

const bild = (uri: string): Bild => ({ uri });

async function fehlercode(zusage: Promise<unknown>): Promise<string> {
  try {
    await zusage;
  } catch (e) {
    if (e instanceof BonScannerFehler) return e.code;
    throw e;
  }
  throw new Error('Zusage wurde erfüllt statt abgelehnt');
}

describe('AufnahmeZuordnung', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('vergibt strikt steigende, positive IDs — auch über Instanzen hinweg', () => {
    const a = new AufnahmeZuordnung<Bild>();
    const b = new AufnahmeZuordnung<Bild>();
    const erste = a.starten();
    const zweite = b.starten();
    erste.zusage.catch(() => {});
    zweite.zusage.catch(() => {});
    expect(erste.id).toBeGreaterThan(0);
    expect(zweite.id).toBeGreaterThan(erste.id);
    a.abbrechen('unmounted');
    b.abbrechen('unmounted');
  });

  it('beantwortet die offene Aufnahme mit passender ID und räumt den Timer ab', async () => {
    const z = new AufnahmeZuordnung<Bild>();
    const { id, zusage } = z.starten();
    expect(z.ergebnis(id, bild('file:///a.jpg'))).toBe('angenommen');
    await expect(zusage).resolves.toEqual({ uri: 'file:///a.jpg' });
    expect(z.offeneId).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('meldet einen nativen Fehler mit passender ID als BonScannerFehler', async () => {
    const z = new AufnahmeZuordnung<Bild>();
    const { id, zusage } = z.starten();
    expect(z.fehler(id, 'session_not_running')).toBe('angenommen');
    expect(await fehlercode(zusage)).toBe('session_not_running');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('beendet eine nie quittierte Aufnahme nach der Start-Grenze mit `timeout`', async () => {
    const z = new AufnahmeZuordnung<Bild>();
    const { zusage } = z.starten();
    const code = fehlercode(zusage);
    jest.advanceTimersByTime(AUFNAHME_START_LIMIT_MS - 1);
    expect(z.offeneId).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(await code).toBe('timeout');
    expect(z.offeneId).toBeNull();
  });

  describe('Quittung der Kamera (zweistufige Zeitgrenze)', () => {
    it('gibt der Aufbereitung nach der Quittung die lange Grenze — ab der Quittung gerechnet', async () => {
      const z = new AufnahmeZuordnung<Bild>();
      const { id, zusage } = z.starten();
      jest.advanceTimersByTime(AUFNAHME_START_LIMIT_MS - 100);
      expect(z.gestartet(id)).toBe('angenommen');
      // Die Start-Grenze wäre jetzt längst abgelaufen: das langsame Bild
      // darf trotzdem noch kommen.
      jest.advanceTimersByTime(AUFNAHME_BILD_LIMIT_MS - 1);
      expect(z.offeneId).toBe(id);
      expect(z.ergebnis(id, bild('file:///langsam.jpg'))).toBe('angenommen');
      await expect(zusage).resolves.toEqual({ uri: 'file:///langsam.jpg' });
      expect(jest.getTimerCount()).toBe(0);
    });

    it('beendet auch eine quittierte Aufnahme, wenn die Aufbereitung hängt', async () => {
      const z = new AufnahmeZuordnung<Bild>();
      const { id, zusage } = z.starten();
      const code = fehlercode(zusage);
      z.gestartet(id);
      jest.advanceTimersByTime(AUFNAHME_BILD_LIMIT_MS);
      expect(await code).toBe('timeout');
      expect(z.offeneId).toBeNull();
    });

    it('verlängert nur mit passender ID und nur einmal', async () => {
      const z = new AufnahmeZuordnung<Bild>();
      const { id, zusage } = z.starten();
      const code = fehlercode(zusage);
      expect(z.gestartet(undefined)).toBe('verworfen');
      expect(z.gestartet(id + 1)).toBe('verworfen');
      expect(z.gestartet(id)).toBe('angenommen');
      jest.advanceTimersByTime(AUFNAHME_BILD_LIMIT_MS - 1);
      // Eine zweite Quittung setzt die Grenze NICHT erneut.
      expect(z.gestartet(id)).toBe('verworfen');
      jest.advanceTimersByTime(1);
      expect(await code).toBe('timeout');
    });

    it('ignoriert die Quittung einer abgelösten Aufnahme', async () => {
      const z = new AufnahmeZuordnung<Bild>();
      const alt = z.starten();
      alt.zusage.catch(() => {});
      const neu = z.starten();
      const code = fehlercode(neu.zusage);
      expect(z.gestartet(alt.id)).toBe('verworfen');
      // Die neue Aufnahme hat weiter nur die Start-Grenze.
      jest.advanceTimersByTime(AUFNAHME_START_LIMIT_MS);
      expect(await code).toBe('timeout');
    });

    it('verwirft eine Quittung, die nach dem Ergebnis kommt', async () => {
      const z = new AufnahmeZuordnung<Bild>();
      const { id, zusage } = z.starten();
      z.ergebnis(id, bild('file:///a.jpg'));
      await zusage;
      expect(z.gestartet(id)).toBe('verworfen');
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it('gibt den Unterbrechungsgrund eines nativen Fehlers weiter', async () => {
    const z = new AufnahmeZuordnung<Bild>();
    const { id, zusage } = z.starten();
    expect(z.fehler(id, 'session_interrupted', 'multitasking')).toBe('angenommen');
    const fehler = await zusage.catch((e: unknown) => e);
    expect(fehler).toBeInstanceOf(BonScannerFehler);
    expect((fehler as BonScannerFehler).code).toBe('session_interrupted');
    expect((fehler as BonScannerFehler).grund).toBe('multitasking');
  });

  it('verwirft die späte Antwort einer abgelaufenen Aufnahme — auch wenn schon eine neue offen ist', async () => {
    const z = new AufnahmeZuordnung<Bild>();
    const alt = z.starten();
    const altCode = fehlercode(alt.zusage);
    jest.advanceTimersByTime(AUFNAHME_START_LIMIT_MS);
    expect(await altCode).toBe('timeout');

    const neu = z.starten();
    // Das Bild des ersten Tipps kommt jetzt erst an: darf die neue Aufnahme
    // NICHT beantworten (sonst landet es im falschen Schritt).
    expect(z.ergebnis(alt.id, bild('file:///spaet.jpg'))).toBe('verworfen');
    expect(z.fehler(alt.id, 'capture_failed')).toBe('verworfen');
    expect(z.offeneId).toBe(neu.id);

    expect(z.ergebnis(neu.id, bild('file:///richtig.jpg'))).toBe('angenommen');
    await expect(neu.zusage).resolves.toEqual({ uri: 'file:///richtig.jpg' });
  });

  it('löst eine noch offene Aufnahme beim nächsten Start mit `superseded` ab', async () => {
    const z = new AufnahmeZuordnung<Bild>();
    const erste = z.starten();
    const ersteCode = fehlercode(erste.zusage);
    const zweite = z.starten();
    expect(await ersteCode).toBe('superseded');
    expect(z.ergebnis(erste.id, bild('file:///alt.jpg'))).toBe('verworfen');
    expect(z.ergebnis(zweite.id, bild('file:///neu.jpg'))).toBe('angenommen');
    await expect(zweite.zusage).resolves.toEqual({ uri: 'file:///neu.jpg' });
    // Die abgelöste Aufnahme hinterlässt keinen laufenden Timer.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bricht beim Abbau mit `unmounted` ab, ohne später noch `timeout` zu melden', async () => {
    const z = new AufnahmeZuordnung<Bild>();
    const { zusage } = z.starten();
    z.abbrechen('unmounted');
    expect(await fehlercode(zusage)).toBe('unmounted');
    expect(jest.getTimerCount()).toBe(0);
    // Abbrechen ohne offene Aufnahme ist harmlos.
    expect(() => z.abbrechen('unmounted')).not.toThrow();
  });

  describe('Antworten ohne Signal-ID (native Stände vor der ID)', () => {
    it('ordnet sie der einzigen offenen Aufnahme zu', async () => {
      const z = new AufnahmeZuordnung<Bild>();
      const { zusage } = z.starten();
      expect(z.ergebnis(undefined, bild('file:///alt-binary.jpg'))).toBe('angenommen');
      await expect(zusage).resolves.toEqual({ uri: 'file:///alt-binary.jpg' });
    });

    it('lässt sie ins Leere laufen, wenn keine Aufnahme offen ist', () => {
      const z = new AufnahmeZuordnung<Bild>();
      expect(z.ergebnis(undefined, bild('file:///x.jpg'))).toBe('verworfen');
      expect(z.fehler(undefined, 'camera_unavailable')).toBe('verworfen');
    });

    it('meldet einen ID-losen Fehler der offenen Aufnahme (Kamera nicht verfügbar)', async () => {
      const z = new AufnahmeZuordnung<Bild>();
      const { zusage } = z.starten();
      expect(z.fehler(undefined, 'camera_unavailable')).toBe('angenommen');
      expect(await fehlercode(zusage)).toBe('camera_unavailable');
    });
  });
});

describe('signalIdAus', () => {
  it.each([
    [1, 1],
    [42, 42],
    [0, null],
    [-3, null],
    [1.5, null],
    ['3', null],
    [undefined, null],
    [null, null],
    [Number.NaN, null],
  ])('%p → %p', (roh, erwartet) => {
    expect(signalIdAus(roh)).toBe(erwartet);
  });
});

describe('aufnahmeFehlerArt', () => {
  it.each([
    ['timeout', 'nochmal_tippen'],
    ['session_not_running', 'nochmal_tippen'],
    ['session_interrupted', 'kamera_belegt'],
    ['unmounted', 'still'],
    ['superseded', 'still'],
    ['capture_failed', 'fehlgeschlagen'],
    ['camera_unavailable', 'fehlgeschlagen'],
    ['ein_neuer_code', 'fehlgeschlagen'],
  ])('%s → %s', (code, art) => {
    expect(aufnahmeFehlerArt(new BonScannerFehler(code))).toBe(art);
  });

  it.each([
    ['multitasking', 'kamera_belegt'],
    ['other_client', 'kamera_belegt'],
    ['system_pressure', 'kamera_belegt'],
    ['ein_neuer_grund', 'kamera_belegt'],
    // Endet von selbst, sobald die App vorn ist — dort stimmt „gleich bereit“.
    ['background', 'nochmal_tippen'],
  ])('session_interrupted mit Grund %s → %s', (grund, art) => {
    expect(aufnahmeFehlerArt(new BonScannerFehler('session_interrupted', grund))).toBe(art);
  });

  it('verspricht bei einer Unterbrechung nie „gleich bereit“', () => {
    // Vorfall-Klasse Prüfrunde 28.09.: Nebeneinander-Modus hält die Kamera
    // dauerhaft an — „tipp einfach nochmal“ wäre eine Schleife.
    expect(aufnahmeFehlerArt(new BonScannerFehler('session_interrupted'))).not.toBe('nochmal_tippen');
  });

  it('wertet fremde Fehler als Fehlschlag', () => {
    expect(aufnahmeFehlerArt(new Error('timeout'))).toBe('fehlgeschlagen');
    expect(aufnahmeFehlerArt(undefined)).toBe('fehlgeschlagen');
  });
});
