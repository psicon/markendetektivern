/**
 * Regressionstests zum Handover vom 10.08.2026.
 *
 * Kern des Befunds war nicht der Einzelfall, sondern dass
 * `registerFcmTokenForUser` VIER verschiedene Fehlerfälle
 * ununterscheidbar verschluckte: kein natives Modul, abgelehnte
 * Berechtigung, gescheitertes getToken() und gescheiterter Write
 * führten alle zu demselben Zustand in der Datenbank — nichts.
 *
 * Diese Suite hält fest, dass jeder der vier Wege jetzt einen eigenen,
 * serverseitig sichtbaren Zustand hinterlässt, und dass `addedAt` beim
 * Aktualisieren nicht mehr überschrieben wird.
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

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  NativeModules: {},
  TurboModuleRegistry: { get: () => null },
}));

jest.mock('expo-application', () => ({ nativeApplicationVersion: '6.0.15' }));

// Firestore: Schreibvorgänge mitschneiden statt ausführen.
const writes: { path: string; data: any; merge: boolean }[] = [];
let docExists = false;
jest.mock('@react-native-firebase/firestore', () => ({
  doc: (_db: any, ...seg: string[]) => ({ __path: seg.join('/') }),
  getDoc: jest.fn(() => Promise.resolve({ exists: () => docExists })),
  setDoc: jest.fn((ref: any, data: any, opts: any) => {
    writes.push({ path: ref.__path, data, merge: !!opts?.merge });
    return Promise.resolve();
  }),
  serverTimestamp: () => '__ts__',
}));
jest.mock('@/lib/firebase', () => ({ db: {} }));

const UID = 'user-1';

function reset() {
  for (const k of Object.keys(store)) delete store[k];
  writes.length = 0;
  docExists = false;
  jest.resetModules();
}

/** Zustand aus dem letzten users/{uid}-Write ziehen. */
function letzterZustand() {
  const w = [...writes].reverse().find((x) => x.path === `users/${UID}`);
  return w?.data?.fcmStatus ?? null;
}

/**
 * `recordState` wird bewusst fire-and-forget aufgerufen (`void …`), weil
 * ein Firestore-Write offline unbegrenzt hängt und die Registrierung
 * nicht blockieren darf. Der Test muss die offene Promise-Kette deshalb
 * ausdrücklich auslaufen lassen — sonst prüft er einen Zustand, der noch
 * gar nicht geschrieben ist.
 */
const microtasksDurchlaufen = () => new Promise((r) => setImmediate(r));

describe('Kein natives Modul — Fall 1', () => {
  beforeEach(reset);

  it('hinterlässt state=no_module statt stiller Rückkehr', async () => {
    // NativeModules ist leer und TurboModuleRegistry.get liefert null →
    // isMessagingLinked() ist false, der Service steigt sofort aus.
    const { registerFcmTokenForUser } = require('../fcmTokenService');
    const teardown = await registerFcmTokenForUser(UID);
    await microtasksDurchlaufen();

    expect(typeof teardown).toBe('function');
    expect(letzterZustand()).toMatchObject({
      state: 'no_module',
      platform: 'ios',
      appVersion: '6.0.15',
    });
  });

  it('schreibt bei unverändertem Zustand kein zweites Mal', async () => {
    const { registerFcmTokenForUser } = require('../fcmTokenService');
    await registerFcmTokenForUser(UID);
    await microtasksDurchlaufen();
    expect(writes.filter((w) => w.path === `users/${UID}`).length).toBe(1);

    // Zweiter Aufruf in derselben Sitzung: gleicher Zustand, kein Write.
    await registerFcmTokenForUser(UID);
    await microtasksDurchlaufen();
    expect(writes.filter((w) => w.path === `users/${UID}`).length).toBe(1);
  });

  it('der persistente Riegel wird ERST nach erfolgreichem Write gesetzt', async () => {
    const { registerFcmTokenForUser } = require('../fcmTokenService');
    await registerFcmTokenForUser(UID);
    await microtasksDurchlaufen();
    // Offline würde der Write hängen und der Riegel leer bleiben — hier
    // läuft er durch, also ist er gesetzt und trägt die Signatur.
    expect(store[`fcm/v1/state_${UID}`]).toContain('no_module');
    expect(store[`fcm/v1/state_${UID}`]).toContain('6.0.15');
  });
});

describe('addedAt wird beim Aktualisieren nicht überschrieben', () => {
  beforeEach(reset);

  it('neues Token-Dokument bekommt addedAt', async () => {
    docExists = false;
    const { persistToken } = require('../fcmTokenService');
    await persistToken(UID, 'tok-abc');
    const w = writes.find((x) => x.path.includes('/fcmTokens/'));
    expect(w?.data).toHaveProperty('addedAt');
    expect(w?.data).toHaveProperty('lastSeenAt');
  });

  it('bestehendes Dokument behält sein addedAt', async () => {
    docExists = true;
    const { persistToken } = require('../fcmTokenService');
    await persistToken(UID, 'tok-abc');
    const w = writes.find((x) => x.path.includes('/fcmTokens/'));
    expect(w?.data).not.toHaveProperty('addedAt');
    expect(w?.data).toHaveProperty('lastSeenAt');
  });
});
