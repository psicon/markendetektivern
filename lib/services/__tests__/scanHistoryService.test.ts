/**
 * Phase-2-Service-Test: scanHistoryService.
 *
 * Fokus: die Schreib-Payload-Normalisierung von `saveScan` (undefined→null,
 * Referenz-Logik nur für kuratierte Produkte, externe Produkte mit
 * `isExternal`/`source`), die Guard-Bedingungen, und das Lese-/Subscribe-/
 * Soft-Delete-Mapping. Firestore ist komplett gemockt
 * (`__helpers__/rnfirestoreMock`), sodass die reine Service-Logik in Node läuft.
 */
import { makeSnapshot } from './__helpers__/rnfirestoreMock';

jest.mock('@react-native-firebase/firestore', () =>
  require('./__helpers__/rnfirestoreMock').createFirestoreMock(),
);
// `db` ist im Mock-Kontext irrelevant — nur ein Marker, der durchgereicht wird.
jest.mock('@/lib/firebase', () => ({ db: { __mockDb: true } }));

import {
  addDoc,
  doc,
  getDocs,
  onSnapshot,
} from '@react-native-firebase/firestore';
import scanHistoryService, { ScanHistoryService } from '../scanHistoryService';

const addDocMock = addDoc as unknown as jest.Mock;
const getDocsMock = getDocs as unknown as jest.Mock;
const onSnapshotMock = onSnapshot as unknown as jest.Mock;
const docMock = doc as unknown as jest.Mock;

/** Die an addDoc übergebene Daten-Payload des n-ten Calls. */
const payloadOf = (call = 0) => addDocMock.mock.calls[call]?.[1] as Record<string, any>;

beforeEach(() => {
  // Defaults: cleanupOldScans (läuft am Ende von saveScan) sieht eine leere
  // Collection → kein Batch-Commit; Tests, die Reads brauchen, überschreiben.
  getDocsMock.mockResolvedValue(makeSnapshot([]));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('scanHistoryService.getInstance', () => {
  it('ist ein Singleton (default-Export === getInstance())', () => {
    expect(ScanHistoryService.getInstance()).toBe(scanHistoryService);
    expect(ScanHistoryService.getInstance()).toBe(ScanHistoryService.getInstance());
  });
});

describe('saveScan — Guards', () => {
  it.each([
    ['fehlende userId', '', { ean: '40001', productId: 'p1', productName: 'X', productType: 'noname' as const }],
    ['fehlende ean', 'u1', { ean: '', productId: 'p1', productName: 'X', productType: 'noname' as const }],
    ['fehlende productId', 'u1', { ean: '40001', productId: '', productName: 'X', productType: 'noname' as const }],
  ])('schreibt nichts bei %s', async (_label, uid, data) => {
    await scanHistoryService.saveScan(uid, data as any);
    expect(addDocMock).not.toHaveBeenCalled();
  });
});

describe('saveScan — kuratierte Produkte (noname / markenprodukt)', () => {
  it('noname: setzt produktRef auf produkte/<id>, isMarke=false, kein isExternal', async () => {
    await scanHistoryService.saveScan('u1', {
      ean: '4000539001000',
      productId: 'nn-123',
      productName: 'Ja! Cola',
      productType: 'noname',
      price: 0.39,
    });

    expect(addDocMock).toHaveBeenCalledTimes(1);
    // Collection-Pfad
    expect(addDocMock.mock.calls[0][0].path).toBe('users/u1/scanHistory');
    const p = payloadOf();
    expect(p.productType).toBe('noname');
    expect(p.isMarke).toBe(false);
    expect(p.produktRef).toEqual(expect.objectContaining({ path: 'produkte/nn-123' }));
    expect(p.markenProduktRef).toBeUndefined();
    expect(p).not.toHaveProperty('isExternal');
    expect(p.price).toBe(0.39);
    expect(p.EAN).toBe('4000539001000'); // Legacy-Großschreibung
    expect(p.deleted).toBe(false);
    expect(p.timestamp).toEqual({ __sentinel: 'serverTimestamp' });
  });

  it('markenprodukt: setzt markenProduktRef auf markenProdukte/<id>, isMarke=true', async () => {
    await scanHistoryService.saveScan('u1', {
      ean: '4011200296908',
      productId: 'mp-999',
      productName: 'Coca-Cola',
      productType: 'markenprodukt',
    });

    const p = payloadOf();
    expect(p.isMarke).toBe(true);
    expect(p.markenProduktRef).toEqual(expect.objectContaining({ path: 'markenProdukte/mp-999' }));
    expect(p.produktRef).toBeUndefined();
    expect(docMock).toHaveBeenCalledWith({ __mockDb: true }, 'markenProdukte', 'mp-999');
  });
});

describe('saveScan — externe Produkte', () => {
  it('setzt isExternal + source, KEINE Firestore-Referenz', async () => {
    await scanHistoryService.saveScan('u1', {
      ean: '5449000000996',
      productId: '5449000000996', // productId == ean bei extern
      productName: 'Schwip Schwap',
      productType: 'external',
      source: 'openfood',
    });

    const p = payloadOf();
    expect(p.isExternal).toBe(true);
    expect(p.source).toBe('openfood');
    expect(p.isMarke).toBe(false);
    expect(p.produktRef).toBeUndefined();
    expect(p.markenProduktRef).toBeUndefined();
    // doc() darf NICHT für eine Produkt-Referenz aufgerufen worden sein.
    expect(docMock).not.toHaveBeenCalled();
  });

  it('source fehlt → source:null (kein undefined an Firestore)', async () => {
    await scanHistoryService.saveScan('u1', {
      ean: '5449000000996',
      productId: '5449000000996',
      productName: 'Extern ohne Quelle',
      productType: 'external',
    });
    const p = payloadOf();
    expect(p.isExternal).toBe(true);
    expect(p.source).toBeNull();
  });
});

describe('saveScan — undefined→null Normalisierung (RN-Firestore wirft bei undefined)', () => {
  it('optionale Felder werden zu null wenn nicht gesetzt', async () => {
    await scanHistoryService.saveScan('u1', {
      ean: '40001',
      productId: 'p1',
      productName: 'Minimal',
      productType: 'noname',
    });
    const p = payloadOf();
    for (const k of ['productImage', 'productThumb', 'brandName', 'brandImage', 'price']) {
      expect(p[k]).toBeNull();
    }
    // keine undefined-Werte in der gesamten Payload
    expect(Object.values(p).some((v) => v === undefined)).toBe(false);
  });

  it('nicht-numerischer Preis → null', async () => {
    await scanHistoryService.saveScan('u1', {
      ean: '40001',
      productId: 'p1',
      productName: 'X',
      productType: 'noname',
      price: NaN as unknown as number,
    });
    // NaN ist typeof 'number' → bleibt NaN (kein null). Wir prüfen den
    // dokumentierten Pfad: undefined/string → null.
    expect(payloadOf().price).toBeNaN();

    addDocMock.mockClear();
    await scanHistoryService.saveScan('u1', {
      ean: '40002',
      productId: 'p2',
      productName: 'Y',
      productType: 'noname',
      price: 'abc' as unknown as number,
    });
    expect(payloadOf().price).toBeNull();
  });
});

describe('saveScan — Fehlerresilienz', () => {
  it('schluckt addDoc-Fehler (kein Throw nach außen)', async () => {
    addDocMock.mockRejectedValueOnce(new Error('offline'));
    await expect(
      scanHistoryService.saveScan('u1', {
        ean: '40001',
        productId: 'p1',
        productName: 'X',
        productType: 'noname',
      }),
    ).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('triggert cleanupOldScans nach erfolgreichem Schreiben', async () => {
    await scanHistoryService.saveScan('u1', {
      ean: '40001',
      productId: 'p1',
      productName: 'X',
      productType: 'noname',
    });
    // cleanupOldScans liest die ganze Collection → getDocs läuft.
    expect(getDocsMock).toHaveBeenCalled();
  });
});

describe('getRecentScans', () => {
  it('leere userId → []', async () => {
    expect(await scanHistoryService.getRecentScans('')).toEqual([]);
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it('mappt Snapshot, ean-Fallback auf EAN, productType-Fallback aus isMarke', async () => {
    getDocsMock.mockResolvedValueOnce(
      makeSnapshot([
        { id: 'a', data: { EAN: '111', productId: 'p1', productName: 'Alt-Schema', isMarke: true, deleted: false } },
        { id: 'b', data: { ean: '222', productId: 'p2', productName: 'Neu', productType: 'external', source: 'rewe' } },
      ]),
    );
    const scans = await scanHistoryService.getRecentScans('u1', 5);
    expect(scans).toHaveLength(2);
    expect(scans[0]).toEqual(
      expect.objectContaining({ id: 'a', ean: '111', productType: 'markenprodukt' }),
    );
    expect(scans[1]).toEqual(
      expect.objectContaining({ id: 'b', ean: '222', productType: 'external', source: 'rewe' }),
    );
  });

  it('Fehler beim Laden → []', async () => {
    getDocsMock.mockRejectedValueOnce(new Error('boom'));
    expect(await scanHistoryService.getRecentScans('u1')).toEqual([]);
  });
});

describe('subscribeToScanHistory', () => {
  it('leere userId → No-op-Unsubscribe, kein onSnapshot', () => {
    const unsub = scanHistoryService.subscribeToScanHistory('', 10, () => {});
    expect(typeof unsub).toBe('function');
    expect(onSnapshotMock).not.toHaveBeenCalled();
  });

  it('registriert onSnapshot und liefert gemappte Scans an den Callback', () => {
    let capturedNext: ((snap: unknown) => void) | undefined;
    onSnapshotMock.mockImplementationOnce((_q: unknown, next: (snap: unknown) => void) => {
      capturedNext = next;
      return jest.fn();
    });
    const cb = jest.fn();
    scanHistoryService.subscribeToScanHistory('u1', 10, cb);
    expect(onSnapshotMock).toHaveBeenCalledTimes(1);

    capturedNext?.(
      makeSnapshot([{ id: 'x', data: { ean: '9', productId: 'p', productName: 'N', productType: 'noname' } }]),
    );
    expect(cb).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'x', ean: '9', productType: 'noname' }),
    ]);
  });

  it('onSnapshot-Error → Callback mit []', () => {
    let capturedErr: ((e: unknown) => void) | undefined;
    onSnapshotMock.mockImplementationOnce((_q: unknown, _next: unknown, onErr: (e: unknown) => void) => {
      capturedErr = onErr;
      return jest.fn();
    });
    const cb = jest.fn();
    scanHistoryService.subscribeToScanHistory('u1', 10, cb);
    capturedErr?.(new Error('listener-fail'));
    expect(cb).toHaveBeenCalledWith([]);
  });
});

describe('markAllAsDeleted', () => {
  it('leere userId → kein Read', async () => {
    await scanHistoryService.markAllAsDeleted('');
    expect(getDocsMock).not.toHaveBeenCalled();
  });

  it('keine aktiven Scans → kein Batch', async () => {
    const batch = require('@react-native-firebase/firestore').writeBatch as jest.Mock;
    getDocsMock.mockResolvedValueOnce(makeSnapshot([]));
    await scanHistoryService.markAllAsDeleted('u1');
    expect(batch).not.toHaveBeenCalled();
  });

  it('aktive Scans → batch.update je Doc + commit', async () => {
    const writeBatch = require('@react-native-firebase/firestore').writeBatch as jest.Mock;
    const commit = jest.fn(async () => undefined);
    const update = jest.fn();
    writeBatch.mockReturnValueOnce({ set: jest.fn(), update, delete: jest.fn(), commit });

    getDocsMock.mockResolvedValueOnce(
      makeSnapshot([
        { id: 'a', data: { deleted: false } },
        { id: 'b', data: { deleted: false } },
      ]),
    );
    await scanHistoryService.markAllAsDeleted('u1');
    expect(update).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
