/**
 * BonScanner-Auslöser: Zuordnung Tipp → native Antwort und Zeitgrenze
 * (modules/bon-edge-detector/src/aufnahmeZuordnung.ts).
 *
 * Vorfall-Klasse: `capture()` wartete ohne Zeitgrenze, und jede native
 * Antwort löste die gerade offene Zusage auf — ein verspätetes Bild konnte so
 * die NÄCHSTE Aufnahme beantworten, eine nie beantwortete Aufnahme ließ den
 * Auslöser endlos drehen.
 */

import {
  AUFNAHME_ZEITLIMIT_MS,
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

  it('beendet eine unbeantwortete Aufnahme nach der Zeitgrenze mit `timeout`', async () => {
    const z = new AufnahmeZuordnung<Bild>();
    const { zusage } = z.starten();
    const code = fehlercode(zusage);
    jest.advanceTimersByTime(AUFNAHME_ZEITLIMIT_MS - 1);
    expect(z.offeneId).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(await code).toBe('timeout');
    expect(z.offeneId).toBeNull();
  });

  it('verwirft die späte Antwort einer abgelaufenen Aufnahme — auch wenn schon eine neue offen ist', async () => {
    const z = new AufnahmeZuordnung<Bild>();
    const alt = z.starten();
    const altCode = fehlercode(alt.zusage);
    jest.advanceTimersByTime(AUFNAHME_ZEITLIMIT_MS);
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
    ['unmounted', 'still'],
    ['superseded', 'still'],
    ['capture_failed', 'fehlgeschlagen'],
    ['camera_unavailable', 'fehlgeschlagen'],
    ['ein_neuer_code', 'fehlgeschlagen'],
  ])('%s → %s', (code, art) => {
    expect(aufnahmeFehlerArt(new BonScannerFehler(code))).toBe(art);
  });

  it('wertet fremde Fehler als Fehlschlag', () => {
    expect(aufnahmeFehlerArt(new Error('timeout'))).toBe('fehlgeschlagen');
    expect(aufnahmeFehlerArt(undefined)).toBe('fehlgeschlagen');
  });
});
