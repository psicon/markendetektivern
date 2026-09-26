/**
 * Abgeschnittene Uploads (Android firebase-storage 22.0.1, 26.09.2026).
 *
 * ═══ Was hier festgenagelt wird ═══
 *
 * Das SDK meldete Erfolg, obwohl auf dem Server nur 512 KiB bzw. 1 MiB einer
 * größeren Datei lagen (9 Produktfotos, 2 Bons). Jetzt gilt an BEIDEN
 * Upload-Stellen (Produktfoto + Bon):
 *
 *   - Servergröße kleiner (oder überhaupt anders) als die lokale Datei →
 *     Fehler mit code `upload_unvollstaendig`, der Upload gilt als gescheitert.
 *   - Gleiche Größe → Erfolg wie bisher.
 *   - Nichts prüfbar → durchlassen (nie still als kaputt werten), aber warnen.
 *   - Die lokale Größe reist als `customMetadata.clientSize` mit.
 */

jest.mock('expo-file-system', () => ({
  getInfoAsync: jest.fn(),
}));
jest.mock('@react-native-firebase/storage', () => ({
  ref: jest.fn((_s: unknown, p: string) => ({ path: p })),
  putFile: jest.fn(),
}));
jest.mock('@react-native-firebase/firestore', () =>
  require('./__helpers__/rnfirestoreMock').createFirestoreMock(),
);
jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: { uid: 'u1' } },
  db: { __mockDb: true },
  storage: { __mockStorage: true },
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
jest.mock('@/lib/services/journeyTrackingService', () => ({
  __esModule: true,
  default: { getCurrentJourneyId: () => null, getCurrentJourneyLocation: () => null },
}));

import * as FileSystem from 'expo-file-system';
import { putFile } from '@react-native-firebase/storage';

import { uploadBonImage } from '../cashbackUpload';
import { uploadProductImage } from '../productSubmit';
import {
  bewerteUploadAbschluss,
  UPLOAD_UNVOLLSTAENDIG,
  uploadPruefungVorbereiten,
} from '../storageUploadPruefung';

const mock = (fn: unknown) => fn as jest.Mock;

/** Lokale Datei 700.000 Bytes — liegt im anfälligen Bereich (512–768 KiB). */
const LOKAL = 700_000;
const ABGESCHNITTEN = 524_288;

function lokaleDatei(size: number | null) {
  mock(FileSystem.getInfoAsync).mockImplementation(async (uri: string) =>
    size === null ? { exists: false, uri } : { exists: true, uri, size, isDirectory: false, modificationTime: 1 },
  );
}

/**
 * putFile-Attrappe: meldet einen Fortschritt und danach den Abschluss mit dem
 * gegebenen Snapshot — asynchron und wie RNFB (StorageTask.js): vor jedem
 * Listener-Aufruf steht der Snapshot auch in `task.snapshot`.
 */
function uploadEndetMit(snap: Record<string, unknown>) {
  mock(putFile).mockImplementation(() => {
    const task: any = {
      snapshot: null,
      cancel: jest.fn(),
      on: (_evt: string, next: (s: unknown) => void, _err: unknown, complete: (s: unknown) => void) => {
        setImmediate(() => {
          task.snapshot = { bytesTransferred: snap.bytesTransferred, totalBytes: snap.totalBytes };
          next(task.snapshot);
          task.snapshot = snap;
          complete(snap);
        });
      },
    };
    return task;
  });
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mock(FileSystem.getInfoAsync).mockReset();
  mock(putFile).mockReset();
});
afterEach(() => jest.restoreAllMocks());

// ─── Reine Bewertung ─────────────────────────────────────────────────

describe('bewerteUploadAbschluss', () => {
  test('Server kleiner als lokal → unvollständig', () => {
    expect(bewerteUploadAbschluss(LOKAL, { metadata: { size: ABGESCHNITTEN } })).toEqual({
      vollstaendig: false,
      grundlage: 'server',
      erwartetBytes: LOKAL,
      angekommenBytes: ABGESCHNITTEN,
    });
  });

  test('gleiche Größe → vollständig', () => {
    expect(bewerteUploadAbschluss(LOKAL, { metadata: { size: LOKAL } })).toEqual({
      vollstaendig: true,
      grundlage: 'server',
    });
  });

  test('jede andere Abweichung zählt ebenfalls', () => {
    expect(bewerteUploadAbschluss(LOKAL, { metadata: { size: LOKAL + 1 } }).vollstaendig).toBe(false);
  });

  test('Größe als Zeichenkette wird gelesen', () => {
    expect(bewerteUploadAbschluss(LOKAL, { metadata: { size: String(ABGESCHNITTEN) } }).vollstaendig).toBe(false);
  });

  test('lokal unbekannt → Fortschritt: weniger übertragen als gesamt ist unvollständig', () => {
    expect(
      bewerteUploadAbschluss(null, {
        metadata: { size: ABGESCHNITTEN },
        bytesTransferred: ABGESCHNITTEN,
        totalBytes: LOKAL,
      }),
    ).toMatchObject({ vollstaendig: false, grundlage: 'fortschritt', erwartetBytes: LOKAL });
  });

  test('lokal unbekannt → Fortschritt vollständig ist ok', () => {
    expect(bewerteUploadAbschluss(null, { bytesTransferred: LOKAL, totalBytes: LOKAL })).toEqual({
      vollstaendig: true,
      grundlage: 'fortschritt',
    });
  });

  test('Servergröße 0 oder -1 gilt als unbekannt, nicht als abgeschnitten', () => {
    // Sonst sperrte eine SDK-Version ohne metadata.size jeden Upload.
    for (const size of [0, -1, null, undefined, 'x']) {
      expect(bewerteUploadAbschluss(LOKAL, { metadata: { size }, bytesTransferred: LOKAL, totalBytes: LOKAL })).toEqual({
        vollstaendig: true,
        grundlage: 'fortschritt',
      });
    }
  });

  test('nichts prüfbar → durchlassen', () => {
    expect(bewerteUploadAbschluss(null, {})).toEqual({ vollstaendig: true, grundlage: 'ungeprueft' });
    expect(bewerteUploadAbschluss(null, null)).toEqual({ vollstaendig: true, grundlage: 'ungeprueft' });
    expect(bewerteUploadAbschluss(LOKAL, { metadata: null, totalBytes: -1, bytesTransferred: 0 })).toEqual({
      vollstaendig: true,
      grundlage: 'ungeprueft',
    });
  });
});

// ─── Vorbereitung (lokale Größe + Metadaten) ─────────────────────────

describe('uploadPruefungVorbereiten', () => {
  test('file:// → lokale Größe und clientSize in den Metadaten', async () => {
    lokaleDatei(LOKAL);
    const p = await uploadPruefungVorbereiten('file:///doc/a.jpg', 'x/a.jpg', 'image/jpeg');
    expect(FileSystem.getInfoAsync).toHaveBeenCalledWith('file:///doc/a.jpg', { size: true });
    expect(p.lokaleBytes).toBe(LOKAL);
    expect(p.metadata).toEqual({ contentType: 'image/jpeg', customMetadata: { clientSize: String(LOKAL) } });
  });

  test('absoluter Pfad wird als Datei gelesen', async () => {
    lokaleDatei(LOKAL);
    await uploadPruefungVorbereiten('/data/user/0/a.jpg', 'x/a.jpg', 'image/jpeg');
    expect(FileSystem.getInfoAsync).toHaveBeenCalledWith('file:///data/user/0/a.jpg', { size: true });
  });

  test('ph:// wird nicht gemessen (RNFB wandelt es vor dem Upload um)', async () => {
    lokaleDatei(LOKAL);
    const p = await uploadPruefungVorbereiten('ph://ABC-123', 'x/a.jpg', 'image/jpeg');
    expect(FileSystem.getInfoAsync).not.toHaveBeenCalled();
    expect(p.lokaleBytes).toBeNull();
    expect(p.metadata).toEqual({ contentType: 'image/jpeg' });
  });

  test('Lesefehler oder fehlende Datei → Größe unbekannt, kein Abbruch', async () => {
    mock(FileSystem.getInfoAsync).mockRejectedValue(new Error('io'));
    expect((await uploadPruefungVorbereiten('file:///a.jpg', 'x', 'image/jpeg')).lokaleBytes).toBeNull();
    lokaleDatei(null);
    expect((await uploadPruefungVorbereiten('file:///a.jpg', 'x', 'image/jpeg')).lokaleBytes).toBeNull();
  });

  test('pruefeAbschluss liefert den Fehler mit Code und Größen', async () => {
    lokaleDatei(LOKAL);
    const p = await uploadPruefungVorbereiten('file:///a.jpg', 'x/a.jpg', 'image/jpeg');
    const fehler: any = p.pruefeAbschluss({ metadata: { size: ABGESCHNITTEN } });
    expect(fehler).toBeInstanceOf(Error);
    expect(fehler.code).toBe(UPLOAD_UNVOLLSTAENDIG);
    expect(fehler.erwartetBytes).toBe(LOKAL);
    expect(fehler.angekommenBytes).toBe(ABGESCHNITTEN);
    expect(p.pruefeAbschluss({ metadata: { size: LOKAL } })).toBeNull();
  });

  test('nicht prüfbar → null, aber sichtbar gewarnt', async () => {
    lokaleDatei(null);
    const p = await uploadPruefungVorbereiten('file:///a.jpg', 'x/a.jpg', 'image/jpeg');
    expect(p.pruefeAbschluss({})).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('nicht prüfbar'),
      expect.objectContaining({ storagePath: 'x/a.jpg' }),
    );
  });
});

// ─── Produktfoto-Upload ──────────────────────────────────────────────

describe('uploadProductImage', () => {
  const hochladen = () =>
    uploadProductImage('file:///doc/upload_queue/j1/front.jpg', 'u1', 'sess', 1, 'front', {
      fileName: 'front_a.jpg',
    });

  test('Server kleiner → Fehler upload_unvollstaendig', async () => {
    lokaleDatei(LOKAL);
    uploadEndetMit({ metadata: { size: ABGESCHNITTEN }, bytesTransferred: ABGESCHNITTEN, totalBytes: LOKAL });
    await expect(hochladen()).rejects.toMatchObject({ code: UPLOAD_UNVOLLSTAENDIG });
  });

  test('gleiche Größe → Pfad zurück, clientSize mitgeschickt', async () => {
    lokaleDatei(LOKAL);
    uploadEndetMit({ metadata: { size: LOKAL }, bytesTransferred: LOKAL, totalBytes: LOKAL });
    await expect(hochladen()).resolves.toBe('crowduploads/u1/sess/produkt_1/images/front_a.jpg');
    expect(mock(putFile).mock.calls[0][2]).toEqual({
      contentType: 'image/jpeg',
      customMetadata: { clientSize: String(LOKAL) },
    });
  });

  test('nichts bekannt → durchgelassen wie bisher', async () => {
    lokaleDatei(null);
    uploadEndetMit({});
    await expect(hochladen()).resolves.toBe('crowduploads/u1/sess/produkt_1/images/front_a.jpg');
    expect(mock(putFile).mock.calls[0][2]).toEqual({ contentType: 'image/jpeg' });
  });
});

// ─── Bon-Upload ──────────────────────────────────────────────────────

describe('uploadBonImage', () => {
  const hochladen = () => uploadBonImage('file:///doc/bon_upload_queue/b1.jpg', 'u1');

  test('Server kleiner → Fehler upload_unvollstaendig, Abschluss-Zweig meldet nichts', async () => {
    lokaleDatei(LOKAL);
    // So sieht der SDK-Fehler aus: das SDK hält alles für übertragen, der
    // Server hat weniger. Die Servergröße entscheidet, nicht der Fortschritt.
    uploadEndetMit({ metadata: { size: ABGESCHNITTEN }, bytesTransferred: LOKAL, totalBytes: LOKAL });
    const onProgress = jest.fn();
    await expect(uploadBonImage('file:///doc/b1.jpg', 'u1', { onProgress })).rejects.toMatchObject({
      code: UPLOAD_UNVOLLSTAENDIG,
    });
    // Nur der Fortschritts-Tick, kein zusätzliches „fertig" aus dem
    // Abschluss-Zweig. Was der Spiegel danach zeigt, bestimmt die
    // Fehlermeldung der Warteschlange.
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  test('jeder Versuch lädt unter neuem Namen hoch — der Neuversuch trifft nie das abgeschnittene Objekt', async () => {
    lokaleDatei(LOKAL);
    uploadEndetMit({ metadata: { size: ABGESCHNITTEN }, bytesTransferred: LOKAL, totalBytes: LOKAL });
    await expect(hochladen()).rejects.toMatchObject({ code: UPLOAD_UNVOLLSTAENDIG });
    uploadEndetMit({ metadata: { size: LOKAL }, bytesTransferred: LOKAL, totalBytes: LOKAL });
    const res = await hochladen();

    const [ersterPfad, zweiterPfad] = mock(putFile).mock.calls.map((c) => c[0].path);
    expect(zweiterPfad).toBe(res.storagePath);
    expect(zweiterPfad).not.toBe(ersterPfad);
  });

  test('gleiche Größe → Erfolg mit Pfad, clientSize mitgeschickt', async () => {
    lokaleDatei(LOKAL);
    uploadEndetMit({ metadata: { size: LOKAL }, bytesTransferred: LOKAL, totalBytes: LOKAL });
    const res = await hochladen();
    expect(res.storagePath).toMatch(/^cashback-uploads\/u1\/[0-9a-f]{32}\.jpg$/);
    expect(res.sizeBytes).toBe(LOKAL);
    expect(mock(putFile).mock.calls[0][2]).toEqual({
      contentType: 'image/jpeg',
      customMetadata: { clientSize: String(LOKAL) },
    });
  });

  test('nichts bekannt → durchgelassen wie bisher', async () => {
    lokaleDatei(null);
    uploadEndetMit({});
    await expect(hochladen()).resolves.toMatchObject({ contentType: 'image/jpeg' });
  });
});
