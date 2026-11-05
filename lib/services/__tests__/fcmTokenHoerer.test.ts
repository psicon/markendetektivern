/**
 * Token-Registrierung auf Android und der eine Erneuerungs-Hörer
 * (17.09.2026).
 *
 * Festgehalten wird:
 *   • höchstens EIN onTokenRefresh-Hörer, immer für die zuletzt registrierte
 *     uid — vorher sammelten sich Hörer an, und nach einem Kontowechsel schrieb
 *     der alte einen erneuerten Token unter das vorige Konto;
 *   • Android ohne Erlaubnis wird nach „kann noch gefragt werden" und
 *     „abgelehnt" getrennt (vorher stand beides als permission_denied da);
 *   • ein leerer Token nach dem Sheet ist kein 'ok'.
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

const mockPlattform: { OS: string; Version: number } = { OS: 'android', Version: 34 };
jest.mock('react-native', () => ({
  Platform: mockPlattform,
  NativeModules: { RNFBMessagingModule: {} },
  TurboModuleRegistry: { get: () => null },
  // Wächter (berechtigungsWaechter.ts): 'background' = Dialog sichtbar → regulär warten.
  AppState: { currentState: 'background', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

jest.mock('expo-application', () => ({ nativeApplicationVersion: '6.0.18' }));

const writes: { path: string; data: any }[] = [];
jest.mock('@react-native-firebase/firestore', () => ({
  doc: (_db: any, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: jest.fn(() => Promise.resolve({ exists: () => false })),
  setDoc: jest.fn((ref: any, data: any) => {
    writes.push({ path: ref.__path, data });
    return Promise.resolve();
  }),
  serverTimestamp: () => '__ts__',
}));
jest.mock('@/lib/firebase', () => ({ db: {} }));

// ── Messaging-Attrappe ──────────────────────────────────────────────
const mockMsg = {
  hasPermission: jest.fn(() => Promise.resolve(1)),
  getToken: jest.fn(() => Promise.resolve('tok-1')),
  hoerer: [] as { fn: (t: string) => void; abbestellt: boolean }[],
  onTokenRefresh: jest.fn((fn: (t: string) => void) => {
    const h = { fn, abbestellt: false };
    mockMsg.hoerer.push(h);
    return () => {
      h.abbestellt = true;
    };
  }),
};
jest.mock('@react-native-firebase/messaging', () => {
  const messaging: any = () => mockMsg;
  messaging.AuthorizationStatus = { NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2 };
  return { __esModule: true, default: messaging };
});

const mockExpo = {
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'denied', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
};
jest.mock('expo-notifications', () => mockExpo);

type Modul = typeof import('../fcmTokenService');
function frischesModul(): Modul {
  let m!: Modul;
  jest.isolateModules(() => {
    m = require('../fcmTokenService');
  });
  return m;
}

const lauf = () => new Promise((r) => setImmediate(r));
const aktiveHoerer = () => mockMsg.hoerer.filter((h) => !h.abbestellt);
const zustand = (uid: string) =>
  [...writes].reverse().find((w) => w.path === `users/${uid}` && w.data?.fcmStatus)?.data.fcmStatus ?? null;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  writes.length = 0;
  mockMsg.hoerer.length = 0;
  mockMsg.hasPermission.mockImplementation(() => Promise.resolve(1));
  mockMsg.getToken.mockImplementation(() => Promise.resolve('tok-1'));
  mockExpo.getPermissionsAsync.mockImplementation(() => Promise.resolve({ status: 'denied', canAskAgain: true }));
  mockExpo.requestPermissionsAsync.mockImplementation(() => Promise.resolve({ status: 'granted' }));
  mockPlattform.OS = 'android';
  mockPlattform.Version = 34;
});

describe('ein Erneuerungs-Hörer', () => {
  it('zweimal dieselbe uid → ein Hörer', async () => {
    const m = frischesModul();
    await m.registerFcmTokenForUser('A');
    await m.registerFcmTokenForUser('A');
    expect(aktiveHoerer()).toHaveLength(1);
  });

  it('Kontowechsel ersetzt den Hörer, der neue schreibt unter die neue uid', async () => {
    const m = frischesModul();
    await m.registerFcmTokenForUser('A');
    await m.registerFcmTokenForUser('B');
    expect(aktiveHoerer()).toHaveLength(1);

    writes.length = 0;
    aktiveHoerer()[0].fn('tok-neu');
    await lauf();
    const tokenWrites = writes.filter((w) => w.path.includes('/fcmTokens/'));
    expect(tokenWrites).toHaveLength(1);
    expect(tokenWrites[0].path.startsWith('users/B/')).toBe(true);
  });

  it('Kontowechsel ohne Erlaubnis entfernt den alten Hörer trotzdem', async () => {
    const m = frischesModul();
    await m.registerFcmTokenForUser('A');
    mockMsg.hasPermission.mockImplementation(() => Promise.resolve(0));
    await m.registerFcmTokenForUser('B');
    expect(aktiveHoerer()).toHaveLength(0);
  });

  it('die Aufräumfunktion eines ersetzten Aufrufs lässt den aktuellen Hörer stehen', async () => {
    const m = frischesModul();
    const altAufraeumen = await m.registerFcmTokenForUser('A');
    await m.registerFcmTokenForUser('B');
    altAufraeumen();
    expect(aktiveHoerer()).toHaveLength(1);
  });

  it('verspätete Registrierung für A ersetzt den Hörer von B nicht', async () => {
    const m = frischesModul();
    // A hängt im getToken (schwaches Netz) …
    let aFreigeben!: (t: string) => void;
    mockMsg.getToken.mockImplementationOnce(() => new Promise<string>((r) => (aFreigeben = r)));
    const aLaeuft = m.registerFcmTokenForUser('A');
    await lauf();
    // … währenddessen wechselt das Konto, B registriert vollständig.
    await m.registerFcmTokenForUser('B');
    expect(aktiveHoerer()).toHaveLength(1);
    // Jetzt kommt A an.
    aFreigeben('tok-a');
    await aLaeuft;
    await lauf();
    expect(aktiveHoerer()).toHaveLength(1);
    writes.length = 0;
    aktiveHoerer()[0].fn('tok-neu');
    await lauf();
    expect(writes.find((w) => w.path.includes('/fcmTokens/'))?.path.startsWith('users/B/')).toBe(true);
  });

  it('die Aufräumfunktion des aktuellen Aufrufs entfernt ihn', async () => {
    const m = frischesModul();
    const aufraeumen = await m.registerFcmTokenForUser('A');
    aufraeumen();
    expect(aktiveHoerer()).toHaveLength(0);
  });
});

describe('Android ohne Erlaubnis — Diagnose', () => {
  it('nie gefragt (expo: denied + canAskAgain) → permission_not_determined, kein Token', async () => {
    mockMsg.hasPermission.mockImplementation(() => Promise.resolve(0));
    const m = frischesModul();
    await m.registerFcmTokenForUser('A');
    await lauf();
    expect(zustand('A')).toMatchObject({ state: 'permission_not_determined', platform: 'android' });
    expect(mockMsg.getToken).not.toHaveBeenCalled();
    expect(writes.some((w) => w.path.includes('/fcmTokens/'))).toBe(false);
  });

  it('endgültig abgelehnt (canAskAgain false) → permission_denied', async () => {
    mockMsg.hasPermission.mockImplementation(() => Promise.resolve(0));
    mockExpo.getPermissionsAsync.mockImplementation(() => Promise.resolve({ status: 'denied', canAskAgain: false }));
    const m = frischesModul();
    await m.registerFcmTokenForUser('A');
    await lauf();
    expect(zustand('A')).toMatchObject({ state: 'permission_denied' });
  });

  it('expo nicht lesbar → Einordnung aus RNFB', async () => {
    mockMsg.hasPermission.mockImplementation(() => Promise.resolve(0));
    mockExpo.getPermissionsAsync.mockImplementation(() => Promise.reject(new Error('weg')));
    const m = frischesModul();
    await m.registerFcmTokenForUser('A');
    await lauf();
    expect(zustand('A')).toMatchObject({ state: 'permission_denied' });
  });
});

describe('harteBerechtigungAnfragen — Android', () => {
  it('Zustimmung speichert den Token', async () => {
    const m = frischesModul();
    await expect(m.harteBerechtigungAnfragen('A')).resolves.toBe(true);
    await lauf();
    expect(writes.some((w) => w.path.startsWith('users/A/fcmTokens/') && w.data.token === 'tok-1')).toBe(true);
    expect(zustand('A')).toMatchObject({ state: 'ok' });
  });

  it('leerer Token ist KEIN ok', async () => {
    mockMsg.getToken.mockImplementation(() => Promise.resolve(''));
    const m = frischesModul();
    await m.harteBerechtigungAnfragen('A');
    await lauf();
    expect(zustand('A')).toMatchObject({ state: 'token_failed' });
    expect(writes.some((w) => w.path.includes('/fcmTokens/'))).toBe(false);
  });

  it('Ablehnung im Systemdialog holt keinen Token', async () => {
    mockExpo.requestPermissionsAsync.mockImplementation(() => Promise.resolve({ status: 'denied' }));
    const m = frischesModul();
    await expect(m.harteBerechtigungAnfragen('A')).resolves.toBe(false);
    expect(mockMsg.getToken).not.toHaveBeenCalled();
  });

  it('erste Ablehnung (Android fragt noch einmal) → permission_not_determined, wie beim Start', async () => {
    mockExpo.requestPermissionsAsync.mockImplementation(() =>
      Promise.resolve({ status: 'denied', canAskAgain: true }),
    );
    const m = frischesModul();
    await m.harteBerechtigungAnfragen('A');
    await lauf();
    expect(zustand('A')).toMatchObject({ state: 'permission_not_determined' });
  });

  it('endgültige Ablehnung → permission_denied', async () => {
    mockExpo.requestPermissionsAsync.mockImplementation(() =>
      Promise.resolve({ status: 'denied', canAskAgain: false }),
    );
    const m = frischesModul();
    await m.harteBerechtigungAnfragen('A');
    await lauf();
    expect(zustand('A')).toMatchObject({ state: 'permission_denied' });
  });
});
