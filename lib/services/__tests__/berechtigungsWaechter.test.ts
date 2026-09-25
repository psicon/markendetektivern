/**
 * Wächter gegen hängende Berechtigungsanfragen (Vorfall 25.09.2026, Pixel 8 /
 * Android 16): Kommt kein Systemdialog, darf nicht bis zum nächsten Aufwachen
 * der App gewartet werden. Kommt ein Dialog, wird auf den Nutzer gewartet.
 */

type Hoerer = (s: string) => void;
const hoerer = new Set<Hoerer>();
const appState = { currentState: 'active' as string };

jest.mock('react-native', () => ({
  AppState: {
    get currentState() {
      return appState.currentState;
    },
    addEventListener: jest.fn((_typ: string, fn: Hoerer) => {
      hoerer.add(fn);
      return { remove: () => hoerer.delete(fn) };
    }),
  },
}));

import { anfragenOhneHaenger, mitZeitlimit, OHNE_DIALOG_MS } from '@/lib/services/berechtigungsWaechter';

function wechsel(s: string) {
  appState.currentState = s;
  hoerer.forEach((fn) => fn(s));
}

/** Eine Anfrage, die nie antwortet (so verhielt sich Android ohne Dialog). */
const nieAntwortend = () => new Promise<string>(() => {});

beforeEach(() => {
  jest.useFakeTimers();
  hoerer.clear();
  appState.currentState = 'active';
});
afterEach(() => {
  jest.useRealTimers();
});

describe('anfragenOhneHaenger', () => {
  it('ohne Dialog: nach der Wartezeit wird der Stand gelesen, statt ewig zu warten', async () => {
    const lesen = jest.fn(async () => 'verweigert');
    const ergebnis = anfragenOhneHaenger(nieAntwortend, lesen);

    await jest.advanceTimersByTimeAsync(OHNE_DIALOG_MS - 1);
    expect(lesen).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    await expect(ergebnis).resolves.toBe('verweigert');
    expect(hoerer.size).toBe(0); // aufgeräumt
  });

  it('mit Dialog: es wird auf die Antwort des Nutzers gewartet, auch lange', async () => {
    let antworten!: (v: string) => void;
    const anfrage = () => new Promise<string>((r) => (antworten = r));
    const lesen = jest.fn(async () => 'gelesen');
    const ergebnis = anfragenOhneHaenger(anfrage, lesen);

    wechsel('background'); // Systemdialog erscheint
    await jest.advanceTimersByTimeAsync(60_000);
    expect(lesen).not.toHaveBeenCalled();

    wechsel('active');
    antworten('erteilt');
    await expect(ergebnis).resolves.toBe('erteilt');
  });

  it('schnelle Antwort gewinnt, späteres Lesen ändert nichts mehr', async () => {
    const lesen = jest.fn(async () => 'gelesen');
    const ergebnis = anfragenOhneHaenger(async () => 'erteilt', lesen);
    await expect(ergebnis).resolves.toBe('erteilt');
    await jest.advanceTimersByTimeAsync(OHNE_DIALOG_MS * 2);
    expect(lesen).not.toHaveBeenCalled();
  });

  it('eine späte Antwort nach dem Lesen wird ignoriert (kein doppeltes Auflösen)', async () => {
    let antworten!: (v: string) => void;
    const anfrage = () => new Promise<string>((r) => (antworten = r));
    const ergebnis = anfragenOhneHaenger(anfrage, async () => 'gelesen');
    await jest.advanceTimersByTimeAsync(OHNE_DIALOG_MS);
    await expect(ergebnis).resolves.toBe('gelesen');
    antworten('spät'); // darf nichts werfen
  });

  it('App schon im Hintergrund beim Start → wie Dialog: kein vorzeitiges Lesen', async () => {
    appState.currentState = 'background';
    const lesen = jest.fn(async () => 'gelesen');
    void anfragenOhneHaenger(nieAntwortend, lesen);
    await jest.advanceTimersByTimeAsync(OHNE_DIALOG_MS * 4);
    expect(lesen).not.toHaveBeenCalled();
  });

  it('Fehler der Anfrage kommt durch; synchroner Wurf ebenso', async () => {
    await expect(
      anfragenOhneHaenger(async () => {
        throw new Error('nativ');
      }, async () => 'x'),
    ).rejects.toThrow('nativ');
    await expect(
      anfragenOhneHaenger(() => {
        throw new Error('sofort');
      }, async () => 'x'),
    ).rejects.toThrow('sofort');
    expect(hoerer.size).toBe(0);
  });
});

describe('mitZeitlimit', () => {
  it('liefert das Ergebnis, wenn es rechtzeitig kommt', async () => {
    await expect(mitZeitlimit(Promise.resolve(1), 1000, 'ersatz')).resolves.toBe(1);
  });

  it('liefert den Ersatz, wenn die Arbeit hängt', async () => {
    const r = mitZeitlimit(new Promise(() => {}), 1000, 'ersatz');
    await jest.advanceTimersByTimeAsync(1000);
    await expect(r).resolves.toBe('ersatz');
  });

  it('reicht einen Fehler vor Ablauf weiter', async () => {
    await expect(mitZeitlimit(Promise.reject(new Error('kaputt')), 1000, 'ersatz')).rejects.toThrow('kaputt');
  });
});
