/**
 * Push-Taps müssen am Ziel ankommen (17.09.2026).
 *
 * Zwei Fehler, die diese Suite festhält:
 *   1. Der Server schickte `markendetektivern://…`, der Resolver kannte nur
 *      `markendetektive://…` — jeder Tap landete auf der Startseite.
 *   2. Beim Kaltstart ersetzte `router.replace('/(tabs)')` aus app/index.tsx
 *      das gerade geöffnete Ziel. Ziele vor dem Tab-Layout werden deshalb
 *      vorgemerkt und erst danach geöffnet.
 */

const push = jest.fn();
const replace = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: any[]) => push(...a), replace: (...a: any[]) => replace(...a) } }));

const nachInteraktionen: (() => void)[] = [];
jest.mock('react-native', () => ({
  InteractionManager: {
    runAfterInteractions: (fn: () => void) => {
      nachInteraktionen.push(fn);
      return { cancel: () => {} };
    },
  },
}));

type Modul = typeof import('../pushDeepLinks');
function frischesModul(): Modul {
  let m!: Modul;
  jest.isolateModules(() => {
    m = require('../pushDeepLinks');
  });
  return m;
}

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  nachInteraktionen.length = 0;
});

describe('resolveDeepLink', () => {
  const { resolveDeepLink } = frischesModul();

  it.each([
    ['/cashback/pending/abc', '/cashback/pending/abc'],
    ['markendetektivern://cashback/pending/abc', '/cashback/pending/abc'],
    ['markendetektive://cashback/pending/abc', '/cashback/pending/abc'],
    ['MarkenDetektive://cashback/pending/abc', '/cashback/pending/abc'],
    ['markendetektive:///cashback/pending/abc', '/cashback/pending/abc'],
    ['https://markendetektive.de/noname-detail/x1', '/noname-detail/x1'],
    ['cashback/pending/abc', '/cashback/pending/abc'],
    ['/(tabs)/rewards?campaign=c1', '/(tabs)/rewards?campaign=c1'],
    ['  /achievements  ', '/achievements'],
    ['/notification-settings', '/notification-settings'],
  ])('%s → %s', (ein, aus) => {
    expect(resolveDeepLink(ein)).toBe(aus);
  });

  it.each([['/admin/geheim'], ['javascript:alert(1)'], [''], [null], [42]])('%s wird verworfen', (ein) => {
    expect(resolveDeepLink(ein)).toBeNull();
  });
});

describe('navigateToDeepLink — Kaltstart', () => {
  it('merkt ein Ziel vor dem Tab-Layout nur vor und öffnet es danach', () => {
    const m = frischesModul();
    expect(m.navigateToDeepLink('/cashback/pending/abc')).toBe(true);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    m.initialeRouteGesetzt();
    // Erst nach dem laufenden Übergang …
    expect(push).not.toHaveBeenCalled();
    nachInteraktionen.forEach((fn) => fn());
    // … und genau einmal.
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/cashback/pending/abc');
  });

  it('der letzte Tap vor dem Start gewinnt', () => {
    const m = frischesModul();
    m.navigateToDeepLink('/achievements');
    m.navigateToDeepLink('/cashback/pending/neu');
    m.initialeRouteGesetzt();
    nachInteraktionen.forEach((fn) => fn());
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/cashback/pending/neu');
  });

  it('ein ungültiges Ziel vor dem Start löst KEIN replace aus (Onboarding bleibt)', () => {
    const m = frischesModul();
    expect(m.navigateToDeepLink(null)).toBe(false);
    expect(m.navigateToDeepLink('/admin')).toBe(false);
    m.initialeRouteGesetzt();
    nachInteraktionen.forEach((fn) => fn());
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('ohne vorgemerktes Ziel passiert beim Start nichts', () => {
    const m = frischesModul();
    m.initialeRouteGesetzt();
    expect(nachInteraktionen).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  it('initialeRouteGesetzt ist idempotent', () => {
    const m = frischesModul();
    m.navigateToDeepLink('/favorites');
    m.initialeRouteGesetzt();
    m.initialeRouteGesetzt();
    nachInteraktionen.forEach((fn) => fn());
    expect(push).toHaveBeenCalledTimes(1);
  });
});

describe('navigateToDeepLink — derselbe Tap kommt zweimal (expo + RNFB)', () => {
  let jetzt = 1_000_000;
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockImplementation(() => jetzt);
  });
  afterEach(() => {
    (Date.now as jest.Mock).mockRestore();
  });

  it('Kaltstart: vorgemerkt, Start, zweite Meldung → genau eine Seite', () => {
    const m = frischesModul();
    m.navigateToDeepLink('/cashback/pending/abc'); // expo-Weg, vor dem Start
    m.initialeRouteGesetzt();
    jetzt += 20;
    m.navigateToDeepLink('/cashback/pending/abc'); // RNFB-Weg, nach dem Start
    nachInteraktionen.forEach((fn) => fn());
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('App läuft: zwei Meldungen kurz hintereinander → eine Seite', () => {
    const m = frischesModul();
    m.initialeRouteGesetzt();
    m.navigateToDeepLink('/cashback/pending/abc');
    jetzt += 50;
    m.navigateToDeepLink('markendetektivern://cashback/pending/abc');
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('verschiedene Ziele werden beide geöffnet', () => {
    const m = frischesModul();
    m.initialeRouteGesetzt();
    m.navigateToDeepLink('/cashback/pending/a');
    m.navigateToDeepLink('/cashback/pending/b');
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('dasselbe Ziel später erneut → wird wieder geöffnet', () => {
    const m = frischesModul();
    m.initialeRouteGesetzt();
    m.navigateToDeepLink('/cashback/pending/abc');
    jetzt += 6000;
    m.navigateToDeepLink('/cashback/pending/abc');
    expect(push).toHaveBeenCalledTimes(2);
  });
});

describe('navigateToDeepLink — App läuft', () => {
  it('öffnet ein gültiges Ziel sofort', () => {
    const m = frischesModul();
    m.initialeRouteGesetzt();
    expect(m.navigateToDeepLink('markendetektivern://cashback/pending/xyz')).toBe(true);
    expect(push).toHaveBeenCalledWith('/cashback/pending/xyz');
  });

  it('ungültiges oder fehlendes Ziel bewirkt nichts — kein replace über die offene Seite', () => {
    const m = frischesModul();
    m.initialeRouteGesetzt();
    expect(m.navigateToDeepLink('/admin')).toBe(false);
    expect(m.navigateToDeepLink(null)).toBe(false);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('iOS-Doppelmeldung: erst RNFB mit Link, dann expo ohne Daten → Bon-Seite bleibt', () => {
    const m = frischesModul();
    m.initialeRouteGesetzt();
    m.navigateToDeepLink('/cashback/pending/abc');
    m.navigateToDeepLink(null);
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('scheitert push, bleibt der Nutzer, wo er ist', () => {
    const m = frischesModul();
    m.initialeRouteGesetzt();
    push.mockImplementationOnce(() => {
      throw new Error('kaputt');
    });
    expect(m.navigateToDeepLink('/favorites')).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('istErsteEchteRoute', () => {
  const { istErsteEchteRoute } = frischesModul();
  it.each([
    [[], false],
    [['index'], false],
    [['onboarding'], false],
    [['auth', 'welcome'], false],
    [['(tabs)'], true],
    [['(tabs)', 'explore'], true],
    [['join-list', '[code]'], true],
    [['shopping-list'], true],
  ])('%j → %s', (segmente, erwartet) => {
    expect(istErsteEchteRoute(segmente as string[])).toBe(erwartet);
  });
});

describe('initialeRouteZuruecksetzen — Neuaufbau der Wurzel', () => {
  it('nach dem Zurücksetzen wird wieder vorgemerkt statt sofort geöffnet', () => {
    const m = frischesModul();
    m.initialeRouteGesetzt();
    m.initialeRouteZuruecksetzen();
    m.navigateToDeepLink('/favorites');
    expect(push).not.toHaveBeenCalled();
    m.initialeRouteGesetzt();
    nachInteraktionen.forEach((fn) => fn());
    expect(push).toHaveBeenCalledWith('/favorites');
  });
});

describe('extractDeepLink', () => {
  const { extractDeepLink } = frischesModul();
  it('liest deepLink und die üblichen Alternativen', () => {
    expect(extractDeepLink({ deepLink: '/a' })).toBe('/a');
    expect(extractDeepLink({ url: '/b' })).toBe('/b');
    expect(extractDeepLink(null)).toBeNull();
  });
});
