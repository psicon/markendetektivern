/**
 * Abgeschnittener Upload in den Warteschlangen (26.09.2026).
 *
 * ═══ Was hier festgenagelt wird ═══
 *
 * `upload_unvollstaendig` (siehe storageUploadPruefung.ts) ist ein Fehler wie
 * ein Funkloch — KEIN endgültiger:
 *
 *   - Produktfotos: das Dokument entsteht erst, wenn alle Fotos geprüft
 *     vollständig oben sind. Der Neuversuch lädt das abgeschnittene Foto
 *     unter DEMSELBEN Pfad neu (überschreibt es) und lädt die schon
 *     hochgeladenen Fotos nicht noch einmal hoch.
 *   - Bons: der Auftrag scheitert ohne Sperre, verbraucht einen normalen
 *     Versuch, und enqueueCashback wird mit dem abgeschnittenen Bild nie
 *     aufgerufen — erst der automatische Neuversuch reicht ein, genau einmal
 *     und mit dem Pfad des neuen Uploads.
 */

const speicher: Record<string, string> = {};
const BON_KEY = 'bon_upload_queue_v1';
const FOTO_KEY = 'product_upload_queue_v1';

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
  enqueueCashback: jest.fn(),
  setPendingMirrorError: jest.fn(async () => undefined),
  setPendingMirrorProgress: jest.fn(async () => undefined),
  uploadBonImage: jest.fn(),
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
  submitProduct: jest.fn(),
  uploadProductImage: jest.fn(),
}));
jest.mock('../ui/toast', () => ({ showInfoToast: jest.fn() }));

import { auth } from '@/lib/firebase';
import { enqueueCashback, uploadBonImage } from '../cashbackUpload';
import { GastUebernahme } from '../gastUebernahme';
import { submitProduct, uploadProductImage } from '../productSubmit';

type BonQueue = typeof import('../bonUploadQueue');
type FotoQueue = typeof import('../uploadQueue');

const mock = (fn: unknown) => fn as jest.Mock;

function unvollstaendig(): Error {
  const e: any = new Error('upload_unvollstaendig');
  e.code = 'upload_unvollstaendig';
  return e;
}

function frisch<T>(key: string, modul: string, vorbelegung: unknown[]): T {
  for (const k of Object.keys(speicher)) delete speicher[k];
  speicher[key] = JSON.stringify(vorbelegung);
  let q: T;
  jest.isolateModules(() => {
    q = require(modul);
  });
  return q!;
}

function stand(abonnieren: (fn: (jobs: unknown[]) => void) => () => void): Promise<any[]> {
  return new Promise((res) => {
    const ab = abonnieren((jobs) => {
      ab();
      res(jobs as any[]);
    });
  });
}

const pfad = (uid: string, key: string) => `crowduploads/${uid}/sess/produkt_3/images/${key}_a.jpg`;

function fotoAuftrag(extra: Record<string, unknown> = {}) {
  return {
    id: 'f1',
    uid: 'u1',
    docUid: 'u1',
    sessionId: 'sess',
    productIndex: 3,
    marketId: null,
    marketName: 'Kaufland',
    marketLand: 'DE',
    productName: null,
    ean: null,
    campaignId: null,
    campaignResolve: null,
    steps: ['front', 'rueckseite', 'hersteller'].map((key) => ({
      key,
      uri: `file:///doc/upload_queue/f1/${key}.jpg`,
      fileName: `${key}_a.jpg`,
    })),
    status: 'queued',
    progress: 0,
    attempts: 0,
    lastError: null,
    createdAt: 1,
    capture: null,
    clientVersion: null,
    ...extra,
  };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  (auth as any).currentUser = { uid: 'u1', isAnonymous: false, providerData: [{ providerId: 'password' }] };
  for (const fn of [uploadProductImage, submitProduct, uploadBonImage, enqueueCashback, GastUebernahme.zielVon]) {
    mock(fn).mockReset();
  }
  mock(GastUebernahme.zielVon).mockImplementation(() => null);
  mock(uploadProductImage).mockImplementation(
    async (_uri: string, uid: string, _s: string, _i: number, key: string) => pfad(uid, key),
  );
  mock(submitProduct).mockImplementation(async () => 'u1_sess_3');
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Foto-Warteschlange', () => {
  test('abgeschnittenes Foto: kein Dokument, Neuversuch lädt nur dieses Foto unter demselben Pfad', async () => {
    // Zweites Foto kommt beim ersten Lauf abgeschnitten an.
    mock(uploadProductImage).mockImplementationOnce(async (_u: string, uid: string, _s: string, _i: number, key: string) =>
      pfad(uid, key),
    );
    mock(uploadProductImage).mockImplementationOnce(async () => {
      throw unvollstaendig();
    });
    const q = frisch<FotoQueue>(FOTO_KEY, '../uploadQueue', [fotoAuftrag()]);

    await q.processQueue();

    expect(submitProduct).not.toHaveBeenCalled();
    const [job] = await stand(q.subscribeUploadQueue);
    expect(job).toMatchObject({ status: 'failed', attempts: 1, lastError: 'upload_unvollstaendig' });
    // Nur das erste Foto ist als hochgeladen vermerkt.
    expect(job.steps.map((s: any) => s.hochgeladen ?? null)).toEqual([
      { uid: 'u1', pfad: pfad('u1', 'front') },
      null,
      null,
    ]);

    await q.retryJob('f1');
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));

    // Zweiter Lauf: front übersprungen, rueckseite + hersteller hochgeladen —
    // rueckseite mit demselben Dateinamen, also demselben Storage-Pfad.
    const zweiterLauf = mock(uploadProductImage).mock.calls.slice(2);
    expect(zweiterLauf.map((c) => c[4])).toEqual(['rueckseite', 'hersteller']);
    expect(zweiterLauf[0][5]).toMatchObject({ fileName: 'rueckseite_a.jpg' });
    expect(submitProduct).toHaveBeenCalledTimes(1);
    expect(mock(submitProduct).mock.calls[0][1].images).toEqual({
      front: pfad('u1', 'front'),
      rueckseite: pfad('u1', 'rueckseite'),
      hersteller: pfad('u1', 'hersteller'),
    });
    expect(await stand(q.subscribeUploadQueue)).toHaveLength(0);
  });

  test('Vermerk gilt nur für dieselbe uid: nach dem Umzug ins Konto wird neu hochgeladen', async () => {
    (auth as any).currentUser = { uid: 'kontoB', isAnonymous: false, providerData: [{ providerId: 'password' }] };
    mock(GastUebernahme.zielVon).mockImplementation((uid: string) => (uid === 'gastA' ? 'kontoB' : null));
    const auftrag = fotoAuftrag({ uid: 'gastA', docUid: 'gastA' });
    auftrag.steps = auftrag.steps.map((s: any) => ({ ...s, hochgeladen: { uid: 'gastA', pfad: pfad('gastA', s.key) } }));
    const q = frisch<FotoQueue>(FOTO_KEY, '../uploadQueue', [auftrag]);

    await q.processQueue();

    expect(uploadProductImage).toHaveBeenCalledTimes(3);
    expect(mock(submitProduct).mock.calls[0][1].images.front).toBe(pfad('kontoB', 'front'));
  });

  test('Dokument scheitert nach vollständigem Upload: Neuversuch lädt nichts erneut hoch', async () => {
    mock(submitProduct).mockRejectedValueOnce(new Error('unavailable'));
    const q = frisch<FotoQueue>(FOTO_KEY, '../uploadQueue', [fotoAuftrag()]);

    await q.processQueue();
    expect(uploadProductImage).toHaveBeenCalledTimes(3);

    await q.retryJob('f1');
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));

    expect(uploadProductImage).toHaveBeenCalledTimes(3);
    expect(submitProduct).toHaveBeenCalledTimes(2);
    expect(await stand(q.subscribeUploadQueue)).toHaveLength(0);
  });
});

const bonAuftrag = () => ({
  id: 'bon_1',
  uid: 'u1',
  imageUri: 'file:///doc/bon_upload_queue/bon_1.jpg',
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
  createdAt: 1,
});

describe('Bon-Warteschlange', () => {
  test('abgeschnittener Bon: normaler Fehlversuch, keine Sperre, kein enqueueCashback', async () => {
    mock(uploadBonImage).mockRejectedValueOnce(unvollstaendig());
    const q = frisch<BonQueue>(BON_KEY, '../bonUploadQueue', [bonAuftrag()]);

    await q.processQueue();

    expect(enqueueCashback).not.toHaveBeenCalled();
    const [job] = await stand(q.subscribeBonQueue);
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(1);
    expect(job.terminal).toBeFalsy();
    expect(job.terminalCode).toBeUndefined();
  });

  test('automatischer Neuversuch reicht genau einmal ein — mit dem Pfad des neuen Uploads', async () => {
    const ZWEITER = 'cashback-uploads/u1/zweiter.jpg';
    mock(uploadBonImage)
      .mockRejectedValueOnce(unvollstaendig())
      .mockResolvedValueOnce({ storagePath: ZWEITER, contentType: 'image/jpeg', sizeBytes: 700_000 });
    mock(enqueueCashback).mockResolvedValue({ cashbackId: 'bon_1', duplicate: false });
    const q = frisch<BonQueue>(BON_KEY, '../bonUploadQueue', [bonAuftrag()]);

    await q.processQueue();
    expect(enqueueCashback).not.toHaveBeenCalled();

    // Erste Wartezeit der Warteschlange: 10 s.
    jest.advanceTimersByTime(10_000);
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));

    expect(uploadBonImage).toHaveBeenCalledTimes(2);
    expect(enqueueCashback).toHaveBeenCalledTimes(1);
    expect(mock(enqueueCashback).mock.calls[0][0]).toMatchObject({ clientUploadId: 'bon_1', storagePath: ZWEITER });
    expect(await stand(q.subscribeBonQueue)).toHaveLength(0);
  });
});
