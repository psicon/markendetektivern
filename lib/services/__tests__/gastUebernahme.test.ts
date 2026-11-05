/**
 * Ticket-Speicher der Gast-Übernahme (Prüfrunde 1):
 * - ein offenes Ticket (mit Geheimnis) wird NIE verdrängt,
 * - ein Lesefehler führt nie dazu, dass ein leerer Stand echte Tickets
 *   überschreibt,
 * - „pausiert" oder eine Antwort ohne Fehlercode verwirft kein Ticket,
 * - vorbereiten liefert den Grund, nicht nur ja/nein.
 */

const store: Record<string, string> = {};
let leseFehler = false;

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => {
    if (leseFehler) throw new Error('keychain gesperrt');
    return store[k] ?? null;
  }),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    store[k] = v;
  }),
}));

let zaehler = 0;
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: jest.fn(async (n: number) => {
    zaehler += 1;
    return new Uint8Array(n).fill(zaehler % 250);
  }),
  digestStringAsync: jest.fn(async (_a: string, text: string) => `hash-${text}`),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  CryptoEncoding: { HEX: 'hex' },
}));

const authMock: { currentUser: any } = { currentUser: null };
jest.mock('@/lib/firebase', () => ({ auth: authMock }));

const fetchMock = jest.fn();
jest.mock('@/lib/services/cashbackUpload', () => ({
  FUNCTIONS_BASE: 'https://example.test',
  fetchWithTimeout: (...args: unknown[]) => fetchMock(...args),
}));
jest.mock('@/lib/services/ui/toast', () => ({ showInfoToast: jest.fn() }));

const KEY = 'gast_uebernahme_v1';

function antwort(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error('kein JSON');
      return body;
    },
  };
}

function gast(uid: string) {
  return { uid, isAnonymous: true, providerData: [], getIdToken: jest.fn(async () => `tok-${uid}`) };
}
function konto(uid: string) {
  return {
    uid,
    isAnonymous: false,
    providerData: [{ providerId: 'password' }],
    getIdToken: jest.fn(async () => `tok-${uid}`),
  };
}

/** Frisches Modul je Test — der Dienst hält seinen Stand im Modul. */
function dienst() {
  let mod: typeof import('@/lib/services/gastUebernahme');
  jest.isolateModules(() => {
    mod = require('@/lib/services/gastUebernahme');
  });
  return mod!.GastUebernahme;
}

function gespeichert(): Record<string, any> {
  return store[KEY] ? JSON.parse(store[KEY]) : {};
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  leseFehler = false;
  fetchMock.mockReset();
  authMock.currentUser = null;
});

describe('vorbereiten', () => {
  it('speichert das Geheimnis VOR dem Serveraufruf und liefert ok', async () => {
    const G = dienst();
    authMock.currentUser = gast('g1');
    fetchMock.mockImplementation(async () => {
      expect(gespeichert().g1?.geheimnis).toBeTruthy();
      return antwort(200, { ok: true });
    });
    await expect(G.vorbereiten('g1')).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dasselbe Geheimnis wird wiederverwendet (gleicher Hash beim zweiten Versuch)', async () => {
    const G = dienst();
    authMock.currentUser = gast('g1');
    fetchMock.mockResolvedValue(antwort(200, { ok: true }));
    await G.vorbereiten('g1');
    await G.vorbereiten('g1');
    const koerper = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).ticketHash);
    expect(koerper[0]).toBe(koerper[1]);
  });

  it('429 → zu_viele, 403 → fehler', async () => {
    const G = dienst();
    authMock.currentUser = gast('g1');
    fetchMock.mockResolvedValueOnce(antwort(429, { code: 'zu_viele_versuche' }));
    await expect(G.vorbereiten('g1')).resolves.toBe('zu_viele');
    fetchMock.mockResolvedValueOnce(antwort(403, { code: 'kein_gast' }));
    await expect(G.vorbereiten('g1')).resolves.toBe('fehler');
  });

  it('nicht der angemeldete Gast → fehler, kein Serveraufruf', async () => {
    const G = dienst();
    authMock.currentUser = gast('g2');
    await expect(G.vorbereiten('g1')).resolves.toBe('fehler');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Speicher unlesbar → fehler, und es wird NICHTS geschrieben', async () => {
    store[KEY] = JSON.stringify({ alt: { geheimnis: 'x', erstelltAm: 1, zielUid: 'k', bestaetigtNach: null, stand: null, angezeigt: null } });
    leseFehler = true;
    const G = dienst();
    authMock.currentUser = gast('g1');
    await expect(G.vorbereiten('g1')).resolves.toBe('fehler');
    leseFehler = false;
    expect(gespeichert().alt?.geheimnis).toBe('x');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Überlauf', () => {
  it('offene Tickets werden nie verdrängt, auch nicht über der Grenze', async () => {
    const offen: Record<string, any> = {};
    for (let i = 0; i < 12; i++) {
      offen[`o${i}`] = { geheimnis: `s${i}`, erstelltAm: i, zielUid: 'k', bestaetigtNach: null, stand: null, angezeigt: null };
    }
    store[KEY] = JSON.stringify(offen);
    const G = dienst();
    authMock.currentUser = gast('neu');
    fetchMock.mockResolvedValue(antwort(200, { ok: true }));

    await G.vorbereiten('neu');

    const s = gespeichert();
    expect(Object.keys(s)).toHaveLength(13);
    for (let i = 0; i < 12; i++) expect(s[`o${i}`].geheimnis).toBe(`s${i}`);
  });

  it('erledigte Einträge (ohne Geheimnis) werden ab der Grenze verdrängt, älteste zuerst', async () => {
    const eintraege: Record<string, any> = {};
    for (let i = 0; i < 10; i++) {
      eintraege[`e${i}`] = { geheimnis: null, erstelltAm: i, zielUid: 'k', bestaetigtNach: 'k', stand: null, angezeigt: null };
    }
    store[KEY] = JSON.stringify(eintraege);
    const G = dienst();
    authMock.currentUser = gast('neu');
    fetchMock.mockResolvedValue(antwort(200, { ok: true }));

    await G.vorbereiten('neu');

    const s = gespeichert();
    expect(Object.keys(s)).toHaveLength(10);
    expect(s.e0).toBeUndefined();
    expect(s.neu.geheimnis).toBeTruthy();
  });
});

describe('einloesenAlle', () => {
  function mitTicket(stand: any = null) {
    store[KEY] = JSON.stringify({
      g1: { geheimnis: 'geheim', erstelltAm: 1, zielUid: 'k1', bestaetigtNach: null, stand, angezeigt: null },
    });
  }

  it('pausiert → Ticket bleibt, Hinweis genau einmal', async () => {
    mitTicket();
    const toast = require('@/lib/services/ui/toast').showInfoToast as jest.Mock;
    toast.mockClear();
    const G = dienst();
    authMock.currentUser = konto('k1');
    fetchMock.mockResolvedValue(antwort(200, { status: 'pausiert' }));

    await G.einloesenAlle();
    await G.einloesenAlle();

    expect(gespeichert().g1.geheimnis).toBe('geheim');
    expect(G.zielVon('g1')).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('410 nach „pausiert" verwirft das Ticket NICHT', async () => {
    mitTicket({ status: 'pausiert' });
    const G = dienst();
    authMock.currentUser = konto('k1');
    fetchMock.mockResolvedValue(antwort(410, { code: 'abgelaufen' }));

    await G.einloesenAlle();

    expect(gespeichert().g1.geheimnis).toBe('geheim');
  });

  it('403 ohne Fehlercode (z. B. fehlende Aufrufberechtigung) verwirft das Ticket NICHT', async () => {
    mitTicket();
    const G = dienst();
    authMock.currentUser = konto('k1');
    fetchMock.mockResolvedValue(antwort(403));

    await G.einloesenAlle();

    expect(gespeichert().g1.geheimnis).toBe('geheim');
  });

  it('endgültige Ablehnung mit Code verwirft das Ticket', async () => {
    mitTicket();
    const G = dienst();
    authMock.currentUser = konto('k1');
    fetchMock.mockResolvedValue(antwort(409, { code: 'schon_gebunden' }));

    await G.einloesenAlle();

    expect(gespeichert().g1).toBeUndefined();
  });

  it('läuft → Zuordnung bestätigt; abgeschlossen → Geheimnis weg, Zuordnung bleibt', async () => {
    mitTicket();
    const G = dienst();
    authMock.currentUser = konto('k1');
    fetchMock.mockResolvedValueOnce(antwort(200, { status: 'laeuft' }));
    await G.einloesenAlle();
    expect(G.zielVon('g1')).toBe('k1');

    fetchMock.mockResolvedValueOnce(antwort(200, { status: 'abgeschlossen', summe: { bonsUmgezogen: 2 } }));
    await G.einloesenAlle();
    expect(gespeichert().g1.geheimnis).toBeNull();
    expect(G.zielVon('g1')).toBe('k1');
  });

  it('fremdes Konto am selben Gerät löst nichts ein', async () => {
    mitTicket();
    const G = dienst();
    authMock.currentUser = konto('andere');
    await G.einloesenAlle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
