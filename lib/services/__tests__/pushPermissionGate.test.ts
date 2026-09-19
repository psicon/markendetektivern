/**
 * Wann fragen wir nach Benachrichtigungen (86cbfdq5j-Nachlauf, 09.09.2026).
 *
 * Der Fehler, den diese Suite festnagelt: Die App feuerte den System-Dialog
 * beim allerersten Öffnen. 10.665 von 33.841 iOS-Konten haben abgelehnt —
 * auf iOS endgültig. Der erste Reparaturvorschlag (erst nach dem ersten Bon
 * fragen) war an den eigenen Zahlen noch schlechter: nur 0,46 % der Konten
 * reichen je etwas ein, die Frage hätte 99,5 % nie erreicht.
 */

const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
    setItem: jest.fn((k: string, v: string) => {
      store[k] = v;
      return Promise.resolve();
    }),
    removeItem: jest.fn((k: string) => {
      delete store[k];
      return Promise.resolve();
    }),
  },
}));

import {
  darfFragen,
  frageVermerkt,
  interesseGezeigt,
  ladeStand,
  MAX_ANLAEUFE,
  sitzungBeginnt,
  TAGE_BIS_ERNEUT,
  type FrageLage,
} from '../pushPermissionGate';

const TAG = 24 * 60 * 60 * 1000;
const JETZT = 1_800_000_000_000;

const lage = (over: Partial<FrageLage> = {}): FrageLage => ({
  berechtigung: 'offen',
  etwasOffen: false,
  jetzt: JETZT,
  ...over,
});
const stand = (over: Partial<Parameters<typeof darfFragen>[1]> = {}) => ({
  sitzungen: 1,
  handlung: false,
  zuletztGefragt: 0,
  anlaeufe: 0,
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('darfFragen — die Frage muss VOR dem Verhalten kommen', () => {
  test('erste Sitzung, nichts getan: noch nicht fragen', () => {
    // Genau der alte Fehler. Beim ersten Öffnen weiß niemand, wofür er
    // zustimmen soll — und ein Nein ist auf iOS endgültig.
    const r = darfFragen(lage(), stand({ sitzungen: 1 }));
    expect(r).toEqual({ fragen: false, grund: 'kein_interesse' });
  });

  test('zweite Sitzung reicht — wer zurückkommt, hat Interesse', () => {
    // DAS ist der Weg für die 99,5 %, die nie etwas einreichen.
    expect(darfFragen(lage(), stand({ sitzungen: 2 }))).toEqual({ fragen: true });
  });

  test('eine bedeutsame Handlung reicht schon in der ersten Sitzung', () => {
    expect(darfFragen(lage(), stand({ sitzungen: 1, handlung: true }))).toEqual({ fragen: true });
  });

  test('erteilte Berechtigung braucht keine Frage', () => {
    const r = darfFragen(lage({ berechtigung: 'erteilt' }), stand({ sitzungen: 5 }));
    expect(r).toEqual({ fragen: false, grund: 'berechtigung_erteilt' });
  });

  test('nach einer Ablehnung wird nie wieder gefragt', () => {
    // Auf iOS liesse der Dialog sich ohnehin nicht mehr öffnen — ein Sheet
    // wäre eine Frage ohne Wirkung.
    const r = darfFragen(lage({ berechtigung: 'abgelehnt' }), stand({ sitzungen: 9, handlung: true }));
    expect(r).toEqual({ fragen: false, grund: 'berechtigung_abgelehnt' });
  });

  test('niemals über ein offenes Sheet legen', () => {
    // Zwei gleichzeitig sichtbare Modals frieren iOS hart ein (86ca8g2p9).
    const r = darfFragen(lage({ etwasOffen: true }), stand({ sitzungen: 3 }));
    expect(r).toEqual({ fragen: false, grund: 'anderes_sheet_offen' });
  });
});

describe('darfFragen — wer abbestellt hat, wird nicht gefragt (17.09.2026)', () => {
  test('Abbestellung schlägt jedes Interesse', () => {
    expect(darfFragen(lage({ abbestellt: true }), stand({ sitzungen: 5, handlung: true }))).toEqual({
      fragen: false,
      grund: 'nutzer_hat_abbestellt',
    });
  });

  test('ohne Angabe wird wie bisher gefragt', () => {
    expect(darfFragen(lage(), stand({ sitzungen: 2 }))).toEqual({ fragen: true });
    expect(darfFragen(lage({ abbestellt: false }), stand({ sitzungen: 2 }))).toEqual({ fragen: true });
  });
});

describe('darfFragen — „Später" kostet nichts, drängeln schon', () => {
  test('kurz nach dem letzten Anlauf wird nicht erneut gefragt', () => {
    const r = darfFragen(
      lage({ jetzt: JETZT + 2 * TAG }),
      stand({ sitzungen: 5, zuletztGefragt: JETZT, anlaeufe: 1 }),
    );
    expect(r).toEqual({ fragen: false, grund: 'zu_frueh_nach_letzter_frage' });
  });

  test('nach Ablauf der Frist darf es einen zweiten Anlauf geben', () => {
    const r = darfFragen(
      lage({ jetzt: JETZT + (TAGE_BIS_ERNEUT + 1) * TAG }),
      stand({ sitzungen: 5, zuletztGefragt: JETZT, anlaeufe: 1 }),
    );
    expect(r).toEqual({ fragen: true });
  });

  test('nach genug Anläufen ist Schluss — auch ohne ausgesprochenes Nein', () => {
    const r = darfFragen(
      lage({ jetzt: JETZT + 400 * TAG }),
      stand({ sitzungen: 20, handlung: true, zuletztGefragt: JETZT, anlaeufe: MAX_ANLAEUFE }),
    );
    expect(r).toEqual({ fragen: false, grund: 'genug_gefragt' });
  });

  test('die Obergrenze schlägt die abgelaufene Frist', () => {
    // Sonst wäre „genug gefragt" nur eine Pause, keine Grenze.
    const r = darfFragen(
      lage({ jetzt: JETZT + 999 * TAG }),
      stand({ sitzungen: 99, zuletztGefragt: JETZT, anlaeufe: MAX_ANLAEUFE + 5 }),
    );
    expect(r.fragen).toBe(false);
  });
});

describe('Der gespeicherte Stand', () => {
  test('Sitzungen werden gezählt', async () => {
    await sitzungBeginnt();
    await sitzungBeginnt();
    expect((await ladeStand()).sitzungen).toBe(2);
  });

  test('frischer Speicher heißt: erste Sitzung, nichts getan', async () => {
    const s = await ladeStand();
    expect(s).toEqual({ sitzungen: 0, handlung: false, zuletztGefragt: 0, anlaeufe: 0 });
    expect(darfFragen(lage(), s).fragen).toBe(false);
  });

  test('eine Handlung wird gemerkt und schreibt danach nichts mehr', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    await interesseGezeigt('produkt_angesehen');
    expect((await ladeStand()).handlung).toBe(true);

    // Diese Methode hängt an achievementService.trackAction und läuft damit
    // im Nutzerpfad — sie darf nicht bei jedem Aufruf schreiben.
    AsyncStorage.setItem.mockClear();
    await interesseGezeigt('vergleich_geoeffnet');
    await interesseGezeigt('zettel_ergaenzt');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  test('der Vermerk zählt die Anläufe hoch', async () => {
    await frageVermerkt(JETZT);
    let s = await ladeStand();
    expect(s.anlaeufe).toBe(1);
    expect(s.zuletztGefragt).toBe(JETZT);

    await frageVermerkt(JETZT + 10 * TAG);
    s = await ladeStand();
    expect(s.anlaeufe).toBe(2);
    expect(s.zuletztGefragt).toBe(JETZT + 10 * TAG);
  });

  test('ein Speicherfehler blockiert nichts', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    AsyncStorage.getItem.mockRejectedValueOnce(new Error('kaputt'));
    await expect(ladeStand()).resolves.toBeDefined();
    AsyncStorage.setItem.mockRejectedValueOnce(new Error('kaputt'));
    await expect(sitzungBeginnt()).resolves.toBeUndefined();
  });
});
