/**
 * Die Abarbeitungsschleife beider Upload-Warteschlangen: EIN Lauf, und kein
 * Lauf ohne Ende (Fix aus 19ae57f vom 10.09.2026, auf den Stand vom 26.09.
 * übertragen; die Bon-Warteschlange hatte denselben Riegel-Fehler).
 *
 * 1. Wiedereintritt: `processQueue` prüfte `processing` und setzte den Riegel
 *    erst zwei `await`s später. Zwei gleichzeitige Aufrufer starteten ZWEI
 *    Schleifen — Aufträge liefen parallel statt nacheinander.
 * 2. Zeitdeckel (nur Produktfotos): `runJob` awaitete `submitProduct` — ein
 *    Firestore-Write, der offline nie auflöst. Die Warteschlange stand dann bis
 *    zum App-Neustart still, ohne Fehler und ohne Hinweis.
 */

const speicher: Record<string, string> = {};
const FOTO_KEY = 'product_upload_queue_v1';
const BON_KEY = 'bon_upload_queue_v1';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => speicher[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      speicher[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete speicher[k];
    }),
  },
}));
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///doc/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));
jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })), currentState: 'active' },
}));
jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: { uid: 'u1', isAnonymous: false, providerData: [{ providerId: 'password' }] } },
}));
jest.mock('../network', () => ({
  isOnline: jest.fn(() => true),
  refreshNetwork: jest.fn(async () => true),
  subscribeNetwork: jest.fn(() => jest.fn()),
}));
jest.mock('../gastUebernahme', () => ({
  GastUebernahme: { zielVon: jest.fn(() => null), beiAenderung: jest.fn(() => jest.fn()) },
}));
jest.mock('../gastBestand', () => ({
  GastBestand: { merke: jest.fn(async () => undefined), hat: jest.fn(async () => false) },
}));
jest.mock('../cashbackUpload', () => ({
  createPendingMirror: jest.fn(async () => undefined),
  deletePendingMirror: jest.fn(async () => undefined),
  enqueueCashback: jest.fn(async (p: { clientUploadId: string }) => ({ cashbackId: p.clientUploadId, duplicate: false })),
  setPendingMirrorError: jest.fn(async () => undefined),
  setPendingMirrorProgress: jest.fn(async () => undefined),
  uploadBonImage: jest.fn(async (_uri: string, uid: string) => ({ storagePath: `cashback-uploads/${uid}/x.jpg` })),
}));
jest.mock('@/lib/utils/cashbackImage', () => ({
  prepareForUpload: jest.fn(async (uri: string) => ({ uri, resized: false })),
  hashImageFile: jest.fn(async () => null),
}));
jest.mock('../journeyTrackingService', () => ({
  __esModule: true,
  default: { getCurrentJourney: () => null },
}));
jest.mock('../productSubmit', () => ({
  submitProduct: jest.fn(async () => 'doc-id'),
  uploadProductImage: jest.fn(async () => 'crowduploads/pfad.jpg'),
}));
jest.mock('../ui/toast', () => ({ showInfoToast: jest.fn() }));

type FotoQueue = typeof import('../uploadQueue');
type BonQueue = typeof import('../bonUploadQueue');

/**
 * Knapp über dem Zeitdeckel (30 s), aber unter der ersten Wiederholungsfrist
 * (10 s NACH dem Scheitern, also ab 40 s) — so misst der Test genau EINEN
 * abgelaufenen Versuch.
 */
const UEBER_DEN_DECKEL_MS = 31_000;

function fotoAuftrag(id: string, productIndex: number) {
  return {
    id,
    uid: 'u1',
    docUid: 'u1',
    sessionId: '94ea55c3fd9caddfbce6bd1c',
    productIndex,
    marketId: null,
    marketName: 'Kaufland',
    marketLand: 'DE',
    productName: 'Sinnack Kaiser Brötchen',
    ean: '4009097010684',
    campaignId: 'produkt-fotos-september-2026',
    campaignResolve: null,
    steps: [
      { key: 'front', uri: `file:///doc/upload_queue/${id}/front.jpg`, fileName: `front_${id}.jpg` },
      { key: 'rueckseite', uri: `file:///doc/upload_queue/${id}/rueck.jpg`, fileName: `rueck_${id}.jpg` },
    ],
    status: 'queued',
    progress: 0,
    attempts: 0,
    lastError: null,
    createdAt: 1,
    capture: null,
    clientVersion: null,
  };
}

function bonAuftrag(id: string, createdAt: number) {
  return {
    id,
    uid: 'u1',
    imageUri: `file:///doc/bon_upload_queue/${id}.jpg`,
    hash: 'h',
    width: 1000,
    height: 3000,
    capturedAt: 1,
    source: 'live_camera',
    campaignId: null,
    status: 'queued',
    progress: 0,
    attempts: 0,
    lastError: null,
    createdAt,
  };
}

/**
 * Frisches Modul je Test — die Warteschlangen halten ihren Zustand auf
 * Modul-Ebene. Die Mocks werden INNERHALB der Isolierung geholt, damit es
 * garantiert dieselben Instanzen sind, die das Modul benutzt.
 */
function frisch(key: string, vorbelegung: unknown[]) {
  for (const k of Object.keys(speicher)) delete speicher[k];
  speicher[key] = JSON.stringify(vorbelegung);
  let foto: FotoQueue;
  let bon: BonQueue;
  let ps: any;
  let cu: any;
  let net: any;
  let toast: any;
  jest.isolateModules(() => {
    foto = require('../uploadQueue');
    bon = require('../bonUploadQueue');
    ps = require('../productSubmit');
    cu = require('../cashbackUpload');
    net = require('../network');
    toast = require('../ui/toast');
  });
  return { foto: foto!, bon: bon!, ps, cu, net, toast };
}

function fotoStand(q: FotoQueue): Promise<any[]> {
  return new Promise((res) => {
    const ab = q.subscribeUploadQueue((jobs) => {
      ab();
      res(jobs as any[]);
    });
  });
}

/** Das Fenster, das den alten Riegel aufstieß: erst offline, dann meldet die
 *  Sonde „online" — der zweite Aufrufer käme an der Prüfung vorbei, während
 *  der erste noch in der Sonde hängt. */
function offlineDannOnline(net: any) {
  let online = false;
  net.isOnline.mockImplementation(() => online);
  net.refreshNetwork.mockImplementation(async () => {
    online = true;
    return true;
  });
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

// ─── 1. Wiedereintritt ──────────────────────────────────────────────

describe('Produktfotos: ein Lauf statt zwei', () => {
  test('zwei gleichzeitige Aufrufe verarbeiten die Aufträge nacheinander', async () => {
    const { foto, ps, net } = frisch(FOTO_KEY, [fotoAuftrag('neu', 2), fotoAuftrag('alt', 1)]);
    offlineDannOnline(net);

    let gleichzeitig = 0;
    let hoechstens = 0;
    ps.uploadProductImage.mockImplementation(async () => {
      gleichzeitig += 1;
      hoechstens = Math.max(hoechstens, gleichzeitig);
      await new Promise((r) => setTimeout(r, 5));
      gleichzeitig -= 1;
      return 'crowduploads/pfad.jpg';
    });

    await Promise.all([foto.processQueue(), foto.processQueue()]);

    expect(hoechstens).toBe(1);
  });

  test('jeder Auftrag wird trotz gleichzeitiger Aufrufe nur einmal hochgeladen', async () => {
    const { foto, ps, net } = frisch(FOTO_KEY, [fotoAuftrag('neu', 2), fotoAuftrag('alt', 1)]);
    offlineDannOnline(net);

    await Promise.all([foto.processQueue(), foto.processQueue()]);

    // Zwei Aufträge à zwei Bildern — mehr Aufrufe hieße doppelte Arbeit.
    expect(ps.uploadProductImage).toHaveBeenCalledTimes(4);
    expect(ps.submitProduct).toHaveBeenCalledTimes(2);
  });

  test('offline: der Riegel wird wieder freigegeben', async () => {
    const { foto, ps, net } = frisch(FOTO_KEY, [fotoAuftrag('alt', 1)]);
    net.isOnline.mockImplementation(() => false);
    net.refreshNetwork.mockImplementation(async () => false);
    await foto.processQueue();
    expect(ps.uploadProductImage).not.toHaveBeenCalled();

    net.isOnline.mockImplementation(() => true);
    await foto.processQueue();
    expect(ps.submitProduct).toHaveBeenCalledTimes(1);
  });
});

describe('Bons: ein Lauf statt zwei', () => {
  test('zwei gleichzeitige Aufrufe laden nicht überlappend hoch', async () => {
    const { bon, cu, net } = frisch(BON_KEY, [bonAuftrag('bon_b', 2), bonAuftrag('bon_a', 1)]);
    offlineDannOnline(net);

    let gleichzeitig = 0;
    let hoechstens = 0;
    cu.uploadBonImage.mockImplementation(async (_uri: string, uid: string) => {
      gleichzeitig += 1;
      hoechstens = Math.max(hoechstens, gleichzeitig);
      await new Promise((r) => setTimeout(r, 5));
      gleichzeitig -= 1;
      return { storagePath: `cashback-uploads/${uid}/x.jpg` };
    });

    await Promise.all([bon.processQueue(), bon.processQueue()]);

    expect(hoechstens).toBe(1);
    expect(cu.uploadBonImage).toHaveBeenCalledTimes(2);
    expect(cu.enqueueCashback).toHaveBeenCalledTimes(2);
  });

  test('offline: der Riegel wird wieder freigegeben', async () => {
    const { bon, cu, net } = frisch(BON_KEY, [bonAuftrag('bon_a', 1)]);
    net.isOnline.mockImplementation(() => false);
    net.refreshNetwork.mockImplementation(async () => false);
    await bon.processQueue();
    expect(cu.uploadBonImage).not.toHaveBeenCalled();

    net.isOnline.mockImplementation(() => true);
    await bon.processQueue();
    expect(cu.enqueueCashback).toHaveBeenCalledTimes(1);
  });
});

// ─── 2. Zeitdeckel auf dem Schreibvorgang (Produktfotos) ────────────

describe('Produktfotos: kein Lauf ohne Ende', () => {
  test('ein hängender Schreibvorgang lässt den Auftrag nach dem Zeitdeckel scheitern', async () => {
    jest.useFakeTimers();
    const { foto, ps } = frisch(FOTO_KEY, [fotoAuftrag('alt', 1)]);
    // Offline-Firestore: löst nie auf und scheitert nie.
    ps.submitProduct.mockImplementation(() => new Promise(() => {}));

    const lauf = foto.processQueue();
    await jest.advanceTimersByTimeAsync(UEBER_DEN_DECKEL_MS);
    await lauf;

    const stand = await fotoStand(foto);
    expect(stand).toHaveLength(1);
    expect(stand[0].status).toBe('failed');
    expect(stand[0].attempts).toBe(1);
    expect(stand[0].lastError).toBe('submit_timeout');
  });

  test('nach einem hängenden Schreibvorgang läuft die Warteschlange weiter', async () => {
    jest.useFakeTimers();
    const { foto, ps } = frisch(FOTO_KEY, [fotoAuftrag('neu', 2), fotoAuftrag('alt', 1)]);
    ps.submitProduct.mockImplementation(async (_uid: string, input: any) => {
      if (input.productIndex === 1) return new Promise(() => {});
      return 'doc-id';
    });

    const lauf = foto.processQueue();
    await jest.advanceTimersByTimeAsync(UEBER_DEN_DECKEL_MS);
    await lauf;

    const stand = await fotoStand(foto);
    expect(stand.map((j) => j.id)).toEqual(['alt']);
    expect(stand[0].status).toBe('failed');
    expect(ps.submitProduct).toHaveBeenCalledTimes(2);
  });

  test('die Wiederholung lädt die schon hochgeladenen Bilder nicht erneut hoch', async () => {
    jest.useFakeTimers();
    const { foto, ps } = frisch(FOTO_KEY, [fotoAuftrag('alt', 1)]);
    ps.submitProduct.mockImplementationOnce(() => new Promise(() => {}));

    const lauf = foto.processQueue();
    await jest.advanceTimersByTimeAsync(UEBER_DEN_DECKEL_MS);
    await lauf;
    expect(ps.uploadProductImage).toHaveBeenCalledTimes(2);

    // Erste Wiederholungsfrist (10 s) verstreichen lassen → zweiter Versuch.
    await jest.advanceTimersByTimeAsync(10_000);
    expect(ps.submitProduct).toHaveBeenCalledTimes(2);
    expect(ps.uploadProductImage).toHaveBeenCalledTimes(2);
    expect(await fotoStand(foto)).toHaveLength(0);
  });

  test('ein abgelaufener Schreibvorgang zählt nicht als Erfolg', async () => {
    jest.useFakeTimers();
    const { foto, ps, toast } = frisch(FOTO_KEY, [fotoAuftrag('neu', 2), fotoAuftrag('alt', 1)]);
    ps.submitProduct.mockImplementation(async (_uid: string, input: any) => {
      if (input.productIndex === 1) return new Promise(() => {});
      return 'doc-id';
    });

    const lauf = foto.processQueue();
    await jest.advanceTimersByTimeAsync(UEBER_DEN_DECKEL_MS);
    await lauf;

    // EIN Produkt ist durch, nicht zwei.
    expect(toast.showInfoToast).toHaveBeenCalledWith('Produkt hochgeladen ✓', 'success');
  });
});
