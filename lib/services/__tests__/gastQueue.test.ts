/**
 * Warteschlangen und Gast-Übernahme (Stufe 1 „erst einreichen, dann Konto",
 * 25.09.2026).
 *
 * ═══ Was hier festgenagelt wird ═══
 *
 * Bis dahin schrieb die Bon-Warteschlange JEDEN Auftrag bedingungslos auf die
 * gerade angemeldete uid um. Nach einer Abmeldung (neue Gast-uid) oder wenn
 * eine andere Person das Gerät nutzt, landete ein Bon damit bei der falschen
 * uid. Jetzt gilt für Bons UND Produktfotos:
 *
 *   - Ein Auftrag läuft nur für seine eigene uid oder für ein Konto, in das
 *     der Server die Übernahme BESTÄTIGT hat (`GastUebernahme.zielVon`).
 *   - Umgeschrieben wird nur bei dieser Bestätigung; der Platzhalter der
 *     alten uid wird nicht angefasst (der Server räumt auf).
 *   - Wartende Aufträge bleiben `queued`, verbrauchen keine Versuche und
 *     halten die Verarbeitung nicht in einer Schleife fest.
 *   - Ein Foto-Auftrag behält beim Umzug die ursprüngliche Slot-ID (`docUid`),
 *     damit eine Wiederholung keine zweite Einreichung erzeugt.
 *   - Hart gesperrte Bon-Aufträge (z. B. fehlende Einwilligung) lassen sich
 *     gezielt nach ihrem Code wieder freigeben.
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
  auth: { currentUser: null },
  db: { __mockDb: true },
  storage: { __mockStorage: true },
}));
jest.mock('../network', () => ({
  isOnline: jest.fn(() => true),
  refreshNetwork: jest.fn(async () => true),
  subscribeNetwork: jest.fn(() => jest.fn()),
}));
jest.mock('../gastUebernahme', () => ({
  GastUebernahme: {
    zielVon: jest.fn(() => null),
    beiAenderung: jest.fn(() => jest.fn()),
  },
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
  default: {
    getCurrentJourney: () => null,
    getCurrentJourneyId: () => null,
    getCurrentJourneyLocation: () => null,
  },
}));
jest.mock('../productSubmit', () => ({
  submitProduct: jest.fn(),
  uploadProductImage: jest.fn(),
}));
jest.mock('../ui/toast', () => ({ showInfoToast: jest.fn() }));
// Nur für den echten submitProduct-Test (jest.requireActual weiter unten).
jest.mock('@react-native-firebase/firestore', () =>
  require('./__helpers__/rnfirestoreMock').createFirestoreMock(),
);
jest.mock('@react-native-firebase/storage', () => ({
  ref: jest.fn((_s: unknown, p: string) => ({ path: p })),
  putFile: jest.fn(() => ({ on: jest.fn(), cancel: jest.fn() })),
}));
jest.mock('@/lib/services/cashbackService', () => ({
  getActiveCashbackCampaigns: jest.fn(async () => []),
  getActiveCashbackCampaignsStrict: jest.fn(async () => []),
  getCashbackConfig: jest.fn(async () => ({ campaignsEnabled: false })),
  getCashbackConfigStrict: jest.fn(async () => ({ campaignsEnabled: false })),
}));
jest.mock('@/lib/services/productCampaignChoice', () => ({
  getChosenProductCampaignId: jest.fn(async () => null),
}));

// Die Mocks EINMAL im Haupt-Register anlegen — die per isolateModules frisch
// geladenen Warteschlangen greifen dann auf genau diese Instanzen zu.
import { auth } from '@/lib/firebase';
import { setDoc } from '@react-native-firebase/firestore';
import {
  createPendingMirror,
  deletePendingMirror,
  enqueueCashback,
  setPendingMirrorProgress,
  uploadBonImage,
} from '../cashbackUpload';
import { GastBestand } from '../gastBestand';
import { GastUebernahme } from '../gastUebernahme';
import { isOnline } from '../network';
import { submitProduct, uploadProductImage } from '../productSubmit';
import { showInfoToast } from '../ui/toast';

type BonQueue = typeof import('../bonUploadQueue');
type FotoQueue = typeof import('../uploadQueue');

const A = 'gastA';
const B = 'kontoB';
const C = 'gastC';

const mock = (fn: unknown) => fn as jest.Mock;

function anmelden(uid: string | null, registriert = false) {
  (auth as any).currentUser = uid
    ? {
        uid,
        isAnonymous: !registriert,
        providerData: registriert ? [{ providerId: 'password' }] : [],
      }
    : null;
}

/** Bestätigte Zuordnungen vonUid → zielUid, wie sie der Server geliefert hat. */
function bestaetigt(zuordnung: Record<string, string>) {
  mock(GastUebernahme.zielVon).mockImplementation((uid: string) => zuordnung[uid] ?? null);
}

function frischeBonQueue(vorbelegung?: unknown[]): BonQueue {
  for (const k of Object.keys(speicher)) delete speicher[k];
  if (vorbelegung) speicher[BON_KEY] = JSON.stringify(vorbelegung);
  let q: BonQueue;
  jest.isolateModules(() => {
    q = require('../bonUploadQueue');
  });
  return q!;
}

function frischeFotoQueue(vorbelegung?: unknown[]): FotoQueue {
  for (const k of Object.keys(speicher)) delete speicher[k];
  if (vorbelegung) speicher[FOTO_KEY] = JSON.stringify(vorbelegung);
  let q: FotoQueue;
  jest.isolateModules(() => {
    q = require('../uploadQueue');
  });
  return q!;
}

function bonStand(q: BonQueue): Promise<any[]> {
  return new Promise((res) => {
    const ab = q.subscribeBonQueue((jobs) => {
      ab();
      res(jobs as any[]);
    });
  });
}

function fotoStand(q: FotoQueue): Promise<any[]> {
  return new Promise((res) => {
    const ab = q.subscribeUploadQueue((jobs) => {
      ab();
      res(jobs as any[]);
    });
  });
}

/** Lässt angestoßene (void) Verarbeitungsläufe zu Ende laufen. */
async function ruhe() {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
}

function bonAuftrag(id: string, uid: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    uid,
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
    createdAt: 1,
    ...extra,
  };
}

function fotoAuftrag(id: string, uid: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    uid,
    sessionId: '94ea55c3fd9caddfbce6bd1c',
    productIndex: 3,
    marketId: null,
    marketName: 'Kaufland',
    marketLand: 'DE',
    productName: 'Kaiser Brötchen',
    ean: '4009097010684',
    campaignId: null,
    campaignResolve: null,
    steps: [{ key: 'front', uri: `file:///doc/upload_queue/${id}/front.jpg`, fileName: 'front_a.jpg' }],
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
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  anmelden(null);
  // Einmal-Verhalten aus vorigen Tests sicher verwerfen, dann Standard setzen.
  for (const fn of [
    GastUebernahme.zielVon,
    isOnline,
    uploadBonImage,
    enqueueCashback,
    submitProduct,
    uploadProductImage,
  ]) {
    mock(fn).mockReset();
  }
  mock(GastUebernahme.zielVon).mockImplementation(() => null);
  mock(isOnline).mockImplementation(() => true);
  mock(uploadBonImage).mockImplementation(async (_uri: string, uid: string) => ({
    storagePath: `cashback-uploads/${uid}/x.jpg`,
  }));
  mock(enqueueCashback).mockImplementation(async (p: { clientUploadId: string }) => ({
    cashbackId: p.clientUploadId,
    duplicate: false,
  }));
  mock(uploadProductImage).mockImplementation(
    async (_uri: string, uid: string, sess: string, idx: number, key: string) =>
      `crowduploads/${uid}/${sess}/produkt_${idx}/images/${key}.jpg`,
  );
  mock(submitProduct).mockImplementation(async () => 'slot');
});
afterEach(() => jest.restoreAllMocks());

// ─── Bons ─────────────────────────────────────────────────────────────

describe('Bon-Warteschlange', () => {
  test('ohne bestätigte Zuordnung bleibt ein fremder Gast-Auftrag wartend', async () => {
    anmelden(B, true);
    const q = frischeBonQueue([bonAuftrag('bon_a1', A)]);

    // Endet sauber, obwohl ein Auftrag `queued` bleibt (keine Schleife).
    await q.processQueue();

    expect(uploadBonImage).not.toHaveBeenCalled();
    expect(createPendingMirror).not.toHaveBeenCalled();
    expect(deletePendingMirror).not.toHaveBeenCalled();
    const [job] = await bonStand(q);
    expect(job).toMatchObject({ id: 'bon_a1', uid: A, status: 'queued', attempts: 0 });
  });

  test('bestätigte Übernahme: Auftrag zieht ins Konto, die alte uid bleibt unberührt', async () => {
    anmelden(B, true);
    bestaetigt({ [A]: B });
    const q = frischeBonQueue([bonAuftrag('bon_a1', A)]);

    await q.processQueue();

    expect(createPendingMirror).toHaveBeenCalledWith(B, 'bon_a1');
    expect(mock(uploadBonImage).mock.calls[0][1]).toBe(B);
    expect(enqueueCashback).toHaveBeenCalledWith(expect.objectContaining({ clientUploadId: 'bon_a1' }));
    // Kein Schreibvorgang mehr unter der alten uid — weder löschen noch Fortschritt.
    expect(deletePendingMirror).not.toHaveBeenCalled();
    expect(mock(setPendingMirrorProgress).mock.calls.every((c) => c[0] === B)).toBe(true);
    expect(await bonStand(q)).toHaveLength(0);
  });

  test('nach Abmeldung auf eine neue Gast-uid wird nichts umgeschrieben', async () => {
    // A gehört laut Server zu B — aber angemeldet ist jetzt ein neuer Gast C.
    anmelden(C);
    bestaetigt({ [A]: B });
    const q = frischeBonQueue([bonAuftrag('bon_a1', A), bonAuftrag('bon_c1', C, { createdAt: 2 })]);

    await q.processQueue();

    // Nur Cs eigener Auftrag lief.
    expect(uploadBonImage).toHaveBeenCalledTimes(1);
    expect(mock(uploadBonImage).mock.calls[0][1]).toBe(C);
    expect(createPendingMirror).not.toHaveBeenCalledWith(C, 'bon_a1');
    const stand = await bonStand(q);
    expect(stand).toHaveLength(1);
    expect(stand[0]).toMatchObject({ id: 'bon_a1', uid: A, status: 'queued' });
  });

  test('Kontowechsel während des Hochladens: nicht einreichen, keinen Versuch verbrauchen', async () => {
    anmelden(B, true);
    mock(uploadBonImage).mockImplementationOnce(async () => {
      anmelden(C); // Abmeldung mitten im Upload
      return { storagePath: `cashback-uploads/${B}/x.jpg` };
    });
    const q = frischeBonQueue([bonAuftrag('bon_b1', B)]);

    await q.processQueue();

    expect(enqueueCashback).not.toHaveBeenCalled();
    const [job] = await bonStand(q);
    expect(job).toMatchObject({ uid: B, status: 'queued', attempts: 0, lastError: null });
  });

  test('harte Ablehnung merkt sich ihren Code', async () => {
    anmelden(B, true);
    mock(enqueueCashback).mockRejectedValueOnce(Object.assign(new Error('403'), { code: 'consent_missing' }));
    const q = frischeBonQueue([bonAuftrag('bon_b1', B)]);

    await q.processQueue();

    const [job] = await bonStand(q);
    expect(job).toMatchObject({ status: 'failed', terminal: true, terminalCode: 'consent_missing', attempts: 0 });
  });

  test('gesperrteFreigeben gibt nur passende, eigene Sperren frei', async () => {
    anmelden(B, true);
    mock(isOnline).mockImplementation(() => false); // Zustand prüfen, nicht hochladen
    const sperre = (code: string) => ({ status: 'failed', terminal: true, terminalCode: code, attempts: 2, lastError: 'x' });
    const q = frischeBonQueue([
      bonAuftrag('bon_b1', B, sperre('consent_missing')),
      bonAuftrag('bon_b2', B, sperre('rate_limited')),
      bonAuftrag('bon_a1', A, sperre('consent_missing')),
    ]);

    await q.gesperrteFreigeben(['consent_missing']);

    const stand = Object.fromEntries((await bonStand(q)).map((j) => [j.id, j]));
    expect(stand.bon_b1).toMatchObject({ status: 'queued', attempts: 0, terminal: false, terminalCode: null, lastError: null });
    expect(stand.bon_b2).toMatchObject({ status: 'failed', terminalCode: 'rate_limited' });
    expect(stand.bon_a1).toMatchObject({ status: 'failed', terminalCode: 'consent_missing' });
  });

  test('gesperrteFreigeben stößt die Warteschlange an', async () => {
    anmelden(B, true);
    const q = frischeBonQueue([
      bonAuftrag('bon_b1', B, { status: 'failed', terminal: true, terminalCode: 'consent_missing', attempts: 0 }),
    ]);

    await q.gesperrteFreigeben(['consent_missing']);
    await ruhe();

    expect(uploadBonImage).toHaveBeenCalledTimes(1);
    expect(await bonStand(q)).toHaveLength(0);
  });

  test('Altauftrag ohne terminalCode wird am Anzeigetext erkannt', async () => {
    anmelden(B, true);
    mock(isOnline).mockImplementation(() => false);
    const q = frischeBonQueue([
      bonAuftrag('bon_b1', B, {
        status: 'failed',
        terminal: true,
        attempts: 0,
        lastError: 'Bitte bestätige zuerst die Cashback-Einwilligung.',
      }),
    ]);

    await q.gesperrteFreigeben(['consent_missing']);

    const [job] = await bonStand(q);
    expect(job).toMatchObject({ status: 'queued', terminal: false });
  });

  test('Pause: kein neuer Auftrag startet, Fortsetzen holt ihn nach', async () => {
    anmelden(B, true);
    const q = frischeBonQueue([bonAuftrag('bon_b1', B)]);

    q.pausiereBonQueue();
    await q.processQueue();
    expect(uploadBonImage).not.toHaveBeenCalled();

    q.setzeBonQueueFort();
    await ruhe();
    expect(uploadBonImage).toHaveBeenCalledTimes(1);
  });

  test('enqueueBon merkt sich die uid nur für Gäste', async () => {
    mock(isOnline).mockImplementation(() => false);
    const eingabe = {
      imageUri: 'file:///cache/bon.jpg',
      hash: 'h',
      width: 1,
      height: 1,
      capturedAt: 1,
      source: 'live_camera' as const,
      campaignId: null,
    };

    anmelden(A);
    let q = frischeBonQueue();
    await q.enqueueBon({ ...eingabe, uid: A });
    expect(GastBestand.merke).toHaveBeenCalledWith(A);

    mock(GastBestand.merke).mockClear();
    anmelden(B, true);
    q = frischeBonQueue();
    await q.enqueueBon({ ...eingabe, uid: B });
    expect(GastBestand.merke).not.toHaveBeenCalled();
  });

  test('sichtbareBonJobs zeigt nur eigene und bestätigt übernommene Aufträge', async () => {
    anmelden(B, true);
    bestaetigt({ [A]: B });
    const q = frischeBonQueue();
    const liste = [bonAuftrag('b', B), bonAuftrag('a', A), bonAuftrag('c', C)] as any[];
    expect(q.sichtbareBonJobs(liste).map((j) => j.id)).toEqual(['b', 'a']);

    bestaetigt({});
    expect(q.sichtbareBonJobs(liste).map((j) => j.id)).toEqual(['b']);

    anmelden(null);
    expect(q.sichtbareBonJobs(liste)).toEqual([]);
  });
});

// ─── Produktfotos ─────────────────────────────────────────────────────

describe('Foto-Warteschlange', () => {
  test('bestätigte Übernahme: Upload unter dem Konto, Slot-ID bleibt die ursprüngliche', async () => {
    anmelden(B, true);
    bestaetigt({ [A]: B });
    // Altauftrag ohne docUid; das erste Einreichen scheitert, damit der
    // gespeicherte Zustand nach dem Umzug sichtbar wird. Der dabei geplante
    // Wiederholungs-Timer soll den Testlauf nicht offen halten.
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    mock(submitProduct).mockRejectedValueOnce(new Error('unavailable'));
    const q = frischeFotoQueue([fotoAuftrag('f1', A)]);

    await q.processQueue();

    expect(mock(uploadProductImage).mock.calls[0][1]).toBe(B);
    expect(submitProduct).toHaveBeenCalledWith(
      B,
      expect.objectContaining({ sessionId: '94ea55c3fd9caddfbce6bd1c', productIndex: 3 }),
      { docUid: A },
    );
    const [job] = await fotoStand(q);
    expect(job).toMatchObject({ uid: B, docUid: A, status: 'failed', attempts: 1 });

    // Wiederholung nach der Übernahme: wieder derselbe Slot.
    await q.retryJob('f1');
    await ruhe();
    expect(submitProduct).toHaveBeenCalledTimes(2);
    expect(mock(submitProduct).mock.calls[1][2]).toEqual({ docUid: A });
    expect(await fotoStand(q)).toHaveLength(0);
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('ohne Bestätigung wartet der Auftrag — auch nach Abmeldung auf einen neuen Gast', async () => {
    anmelden(C);
    bestaetigt({ [A]: B });
    const q = frischeFotoQueue([fotoAuftrag('f1', A, { docUid: A })]);

    await q.processQueue();

    expect(uploadProductImage).not.toHaveBeenCalled();
    expect(submitProduct).not.toHaveBeenCalled();
    const [job] = await fotoStand(q);
    expect(job).toMatchObject({ uid: A, docUid: A, status: 'queued', attempts: 0 });
  });

  test('derselbe Slot bleibt ein Auftrag, auch wenn aus dem Gast ein Konto wurde', async () => {
    mock(isOnline).mockImplementation(() => false);
    const eingabe = {
      sessionId: '94ea55c3fd9caddfbce6bd1c',
      productIndex: 3,
      marketId: null,
      marketName: 'Kaufland',
      marketLand: 'DE',
      productName: null,
      ean: null,
      campaignId: null,
      steps: [{ key: 'front' as const, uri: 'file:///cache/front.jpg', fileName: 'front_a.jpg' }],
    };

    anmelden(A);
    const q = frischeFotoQueue();
    const erste = await q.enqueueProductUpload({ ...eingabe, uid: A });
    expect(GastBestand.merke).toHaveBeenCalledWith(A);

    anmelden(B, true);
    const zweite = await q.enqueueProductUpload({ ...eingabe, uid: B });

    expect(zweite).toBe(erste);
    const stand = await fotoStand(q);
    expect(stand).toHaveLength(1);
    expect(stand[0]).toMatchObject({ uid: A, docUid: A });
  });

  test('ohne sessionId wird nicht zusammengelegt', async () => {
    anmelden(B, true);
    mock(isOnline).mockImplementation(() => false);
    const q = frischeFotoQueue();
    const eingabe = {
      uid: B,
      sessionId: '',
      productIndex: 1,
      marketId: null,
      marketName: null,
      marketLand: null,
      productName: null,
      ean: null,
      campaignId: null,
      steps: [],
    };
    const a = await q.enqueueProductUpload(eingabe);
    const b = await q.enqueueProductUpload(eingabe);
    expect(b).not.toBe(a);
  });

  test('ein wartender fremder Auftrag verhindert die Erfolgsmeldung nicht', async () => {
    anmelden(B, true);
    const q = frischeFotoQueue([fotoAuftrag('fa', A), fotoAuftrag('fb', B, { sessionId: 'andere', createdAt: 2 })]);

    await q.processQueue();

    expect(submitProduct).toHaveBeenCalledTimes(1);
    expect(showInfoToast).toHaveBeenCalledWith('Produkt hochgeladen ✓', 'success');
  });

  test('Pause: kein neuer Auftrag startet, Fortsetzen holt ihn nach', async () => {
    anmelden(B, true);
    const q = frischeFotoQueue([fotoAuftrag('fb', B)]);

    q.pausiereUploadQueue();
    await q.processQueue();
    expect(uploadProductImage).not.toHaveBeenCalled();

    q.setzeUploadQueueFort();
    await ruhe();
    expect(submitProduct).toHaveBeenCalledTimes(1);
  });

  test('sichtbareUploadJobs zeigt nur eigene und bestätigt übernommene Aufträge', () => {
    anmelden(B, true);
    bestaetigt({ [A]: B });
    const q = frischeFotoQueue();
    const liste = [fotoAuftrag('b', B), fotoAuftrag('a', A), fotoAuftrag('c', C)] as any[];
    expect(q.sichtbareUploadJobs(liste).map((j) => j.id)).toEqual(['b', 'a']);
  });
});

// ─── submitProduct: Dokument-ID aus docUid ───────────────────────────

// ─── Vor dem Wechsel in ein bestehendes Konto (Prüfrunde 2) ───────────

describe('Abarbeiten vor dem Kontowechsel', () => {
  beforeEach(() => {
    // Wiederholungs-Timer der Warteschlangen sollen den Lauf nicht offen halten.
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('Bon: vorübergehend gescheitert, Budget aufgebraucht → wird sofort erneut hochgeladen', async () => {
    anmelden(A);
    const q = frischeBonQueue([
      bonAuftrag('bon_a1', A, { status: 'failed', attempts: 5, lastAttemptAt: Date.now(), lastError: 'Netz' }),
    ]);

    const fertig = q.bonsVorWechselAbarbeiten(A, 5_000);
    await ruhe();

    await expect(fertig).resolves.toBe(true);
    expect(mock(uploadBonImage).mock.calls[0][1]).toBe(A);
    expect(await bonStand(q)).toHaveLength(0);
  });

  test('Bon: scheitert erneut → gilt NICHT als fertig', async () => {
    anmelden(A);
    mock(uploadBonImage).mockRejectedValue(new Error('Netz weg'));
    const q = frischeBonQueue([bonAuftrag('bon_a1', A)]);

    const fertig = q.bonsVorWechselAbarbeiten(A, 5_000);
    await ruhe();
    jest.advanceTimersByTime(5_000);

    await expect(fertig).resolves.toBe(false);
  });

  test('Bon: dauerhaft kaputt → nach Versuch + einer Wiederholung erledigt; ein zweiter Anmeldeversuch wartet nicht (Nachprüfung)', async () => {
    anmelden(A);
    mock(uploadBonImage).mockRejectedValue(new Error('Datei fehlt'));
    const q = frischeBonQueue([bonAuftrag('bon_a1', A, { status: 'failed', attempts: 5, lastAttemptAt: Date.now() })]);

    const erster = q.bonsVorWechselAbarbeiten(A, 30_000);
    await ruhe();
    jest.advanceTimersByTime(10_000); // die eine Wiederholung
    await ruhe();
    await expect(erster).resolves.toBe(true);
    expect(uploadBonImage).toHaveBeenCalledTimes(2);

    // Falsches Passwort, neuer Versuch: kein neues Budget, kein Warten, kein Upload.
    await expect(q.bonsVorWechselAbarbeiten(A, 30_000)).resolves.toBe(true);
    expect(uploadBonImage).toHaveBeenCalledTimes(2);
  });

  test('Bon: endgültig abgelehnt (z. B. fehlende Einwilligung) hält den Wechsel nicht auf', async () => {
    anmelden(A);
    const q = frischeBonQueue([
      bonAuftrag('bon_a1', A, { status: 'failed', terminal: true, terminalCode: 'consent_missing' }),
    ]);

    await expect(q.bonsVorWechselAbarbeiten(A, 5_000)).resolves.toBe(true);
    expect(uploadBonImage).not.toHaveBeenCalled();
  });

  test('Bon: Aufträge anderer uids zählen nicht', async () => {
    anmelden(A);
    const q = frischeBonQueue([bonAuftrag('bon_c1', C)]);
    await expect(q.bonsVorWechselAbarbeiten(A, 5_000)).resolves.toBe(true);
    expect(uploadBonImage).not.toHaveBeenCalled();
  });

  test('Foto: gescheitert mit aufgebrauchtem Budget → wird sofort erneut eingereicht', async () => {
    anmelden(A);
    const q = frischeFotoQueue([fotoAuftrag('f1', A, { status: 'failed', attempts: 5, lastError: 'Netz' })]);

    const fertig = q.uploadsVorWechselAbarbeiten(A, 5_000);
    await ruhe();

    await expect(fertig).resolves.toBe(true);
    expect(submitProduct).toHaveBeenCalledTimes(1);
    expect(await fotoStand(q)).toHaveLength(0);
  });

  test('Foto: dauerhaft kaputt → nach Versuch + einer Wiederholung erledigt; zweiter Aufruf wartet nicht', async () => {
    anmelden(A);
    mock(submitProduct).mockRejectedValue(new Error('unavailable'));
    const q = frischeFotoQueue([fotoAuftrag('f1', A, { status: 'failed', attempts: 5 })]);

    const erster = q.uploadsVorWechselAbarbeiten(A, 30_000);
    await ruhe();
    jest.advanceTimersByTime(10_000);
    await ruhe();
    await expect(erster).resolves.toBe(true);
    expect(submitProduct).toHaveBeenCalledTimes(2);

    await expect(q.uploadsVorWechselAbarbeiten(A, 30_000)).resolves.toBe(true);
    expect(submitProduct).toHaveBeenCalledTimes(2);
  });

  test('Foto: scheitert erneut → gilt NICHT als fertig', async () => {
    anmelden(A);
    mock(submitProduct).mockRejectedValue(new Error('unavailable'));
    const q = frischeFotoQueue([fotoAuftrag('f1', A)]);

    const fertig = q.uploadsVorWechselAbarbeiten(A, 5_000);
    await ruhe();
    jest.advanceTimersByTime(5_000);

    await expect(fertig).resolves.toBe(false);
  });
});

describe('submitProduct mit docUid', () => {
  const echt = jest.requireActual('../productSubmit') as typeof import('../productSubmit');
  const EINGABE = {
    sessionId: '94ea55c3fd9caddfbce6bd1c',
    productIndex: 3,
    marketId: null,
    marketName: 'Kaufland',
    images: { front: `crowduploads/${B}/94ea55c3fd9caddfbce6bd1c/produkt_3/images/front_a.jpg` },
  };

  beforeEach(() => {
    anmelden(B, true);
    mock(setDoc).mockClear();
  });

  const crowdSchreibvorgang = () =>
    mock(setDoc).mock.calls.find((c) => String(c[0]?.path ?? '').startsWith('crowd_uploads/'));

  test('Dokument-ID aus dem ursprünglichen Slot, userId bleibt das Konto', async () => {
    const id = await echt.submitProduct(B, EINGABE as never, { docUid: A });

    expect(id).toBe(`${A}_94ea55c3fd9caddfbce6bd1c_3`);
    const [ref, daten] = crowdSchreibvorgang()!;
    expect(ref.path).toBe(`crowd_uploads/${A}_94ea55c3fd9caddfbce6bd1c_3`);
    expect(daten.userId).toBe(B);
  });

  test('ohne docUid bleibt alles wie bisher', async () => {
    const id = await echt.submitProduct(B, EINGABE as never);
    expect(id).toBe(`${B}_94ea55c3fd9caddfbce6bd1c_3`);
    expect(crowdSchreibvorgang()![1].userId).toBe(B);
  });
});
