/**
 * Phase-2-Service-Test: externalProductService.
 *
 * Fokus liegt auf dem CF-Delegations-Pfad (Session-Code): die öffentlichen
 * `lookupByEAN` / `forceLookupByEAN` rufen — sofern online + Auth vorhanden —
 * die Server-Cloud-Function `resolveExternalProduct` und fallen sonst
 * (offline / kein Auth / CF-Fehler) auf das gecachte `external_products`-Doc
 * zurück. Dazu die reinen Helfer `normaliseEan` / `isExternalCacheStale` und
 * der Cache-Read `getCached`. Firestore + fetch + network sind komplett
 * gemockt, sodass die Service-Logik in Node läuft.
 *
 * Hinweis zur Mock-Mechanik (jest.config: app-Projekt `resetMocks:false` +
 * `clearMocks:true`): Default-Implementierungen der Mock-Factory bleiben
 * bestehen, nur Call-Counts werden je Test geleert. Wir nutzen daher
 * `mockResolvedValueOnce`/`mockReturnValue` bzw. setzen Defaults in
 * `beforeEach`.
 */
import { makeDocSnapshot } from './__helpers__/rnfirestoreMock';

jest.mock('@react-native-firebase/firestore', () =>
  require('./__helpers__/rnfirestoreMock').createFirestoreMock(),
);
jest.mock('@/lib/firebase', () => ({
  db: { __mockDb: true },
  auth: { currentUser: null },
}));
jest.mock('@/lib/services/network', () => ({ isOnline: jest.fn(() => true) }));
jest.mock('@/lib/services/openfood', () => ({
  __esModule: true,
  default: { getProductByEAN: jest.fn() },
}));
jest.mock('@/lib/services/scrapedProductsService', () => ({
  __esModule: true,
  default: { searchScrapedProductByGTIN: jest.fn() },
}));

import { doc, getDoc } from '@react-native-firebase/firestore';
import { EXTERNAL_CACHE_MAX_AGE_MS } from '@/lib/types/externalProduct';
import ExternalProductService, {
  normaliseEan,
  isExternalCacheStale,
} from '../externalProductService';

const getDocMock = getDoc as unknown as jest.Mock;
const docMock = doc as unknown as jest.Mock;

/** Zugriff auf das (mutierte) firebase-Mock-Objekt — `auth.currentUser` wird
 * pro Test gesetzt; der Service liest dieselbe Objekt-Referenz zur Call-Zeit. */
const firebaseMock = require('@/lib/firebase') as {
  auth: { currentUser: any };
};
const isOnlineMock = require('@/lib/services/network')
  .isOnline as jest.Mock;

/** Setzt ein authentifiziertes Mock-User-Objekt (anonym genügt in Prod). */
function setAuth(idToken: string | null) {
  firebaseMock.auth.currentUser =
    idToken === null
      ? { getIdToken: jest.fn(async () => null) }
      : { getIdToken: jest.fn(async () => idToken) };
}

/** Baut eine erfolgreiche fetch-Response für die CF. */
function cfResponse(
  body: Record<string, any>,
  init: { ok?: boolean; status?: number } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  };
}

/** Liest Methode/URL/Body des n-ten fetch-Calls aus. */
function fetchCall(n = 0) {
  const [url, opts] = (global.fetch as jest.Mock).mock.calls[n] ?? [];
  return {
    url: url as string,
    opts: (opts ?? {}) as RequestInit,
    body: opts?.body ? JSON.parse(opts.body as string) : undefined,
  };
}

const CF_URL =
  'https://europe-west1-markendetektive-895f7.cloudfunctions.net/resolveExternalProduct';

beforeEach(() => {
  // Defaults: online, kein Auth, fetch + getDoc neutral. Tests überschreiben.
  isOnlineMock.mockReturnValue(true);
  firebaseMock.auth.currentUser = null;
  global.fetch = jest.fn();
  // getDoc default = "kein Doc" (exists=false). Cache-Fallback → null.
  getDocMock.mockResolvedValue(makeDocSnapshot(undefined));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ════════════════════════════════════════════════════════════════════════
describe('normaliseEan', () => {
  it.each([
    ['  40-01x  ', '4001'],
    ['4000539001000', '4000539001000'],
    ['ABC', ''],
    [' 5 4 4 9 ', '5449'],
    ['EAN: 12.34', '1234'],
  ])('strippt Nicht-Ziffern: %j → %j', (input, expected) => {
    expect(normaliseEan(input)).toBe(expected);
  });

  it.each([
    [null, ''],
    [undefined, ''],
    ['', ''],
  ])('null/undefined/leer → leerer String (%j)', (input, expected) => {
    expect(normaliseEan(input as unknown as string)).toBe(expected);
  });

  it('ist über den Default-Export erreichbar (gleiche Funktion)', () => {
    expect(ExternalProductService.normaliseEan).toBe(normaliseEan);
    expect(ExternalProductService.normaliseEan(' 12-3 ')).toBe('123');
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('isExternalCacheStale', () => {
  it('null/undefined → stale (true)', () => {
    expect(isExternalCacheStale(null)).toBe(true);
    expect(isExternalCacheStale(undefined)).toBe(true);
  });

  it('frischer Timestamp (jetzt) → nicht stale (false)', () => {
    const fresh = { toMillis: () => Date.now() } as any;
    expect(isExternalCacheStale(fresh)).toBe(false);
  });

  it('Timestamp knapp innerhalb der Frist (4 Wochen − 1 min) → nicht stale', () => {
    const justInside = {
      toMillis: () => Date.now() - (EXTERNAL_CACHE_MAX_AGE_MS - 60_000),
    } as any;
    expect(isExternalCacheStale(justInside)).toBe(false);
  });

  it('Timestamp knapp jenseits der Frist (4 Wochen + 1 min) → stale', () => {
    const justOutside = {
      toMillis: () => Date.now() - (EXTERNAL_CACHE_MAX_AGE_MS + 60_000),
    } as any;
    expect(isExternalCacheStale(justOutside)).toBe(true);
  });

  it('alter Timestamp (5 Wochen) → stale (true)', () => {
    const fiveWeeks = 5 * 7 * 24 * 60 * 60 * 1000;
    const old = { toMillis: () => Date.now() - fiveWeeks } as any;
    expect(isExternalCacheStale(old)).toBe(true);
  });

  it('Timestamp ohne toMillis-Methode → behandelt als 0 → stale', () => {
    // `toMillis?.() ?? 0` → Epoch-0 liegt weit jenseits der Frist.
    expect(isExternalCacheStale({} as any)).toBe(true);
  });

  it('ist über den Default-Export erreichbar', () => {
    expect(ExternalProductService.isExternalCacheStale).toBe(isExternalCacheStale);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('getCached', () => {
  it('Doc existiert → liefert data() zurück', async () => {
    const data = { ean: '4001', source: 'rewe', productName: 'Cola' };
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(data));
    const out = await ExternalProductService.getCached('4001');
    expect(out).toEqual(data);
    // doc() mit Collection external_products + normalisierter EAN.
    expect(docMock).toHaveBeenCalledWith({ __mockDb: true }, 'external_products', '4001');
  });

  it('normalisiert die EAN vor dem Doc-Zugriff', async () => {
    getDocMock.mockResolvedValueOnce(makeDocSnapshot({ productName: 'X' }));
    await ExternalProductService.getCached(' 40-01x ');
    expect(docMock).toHaveBeenCalledWith({ __mockDb: true }, 'external_products', '4001');
  });

  it('Doc existiert nicht → null', async () => {
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(undefined));
    expect(await ExternalProductService.getCached('4001')).toBeNull();
  });

  it('getDoc wirft → null (gefangen, kein Throw)', async () => {
    getDocMock.mockRejectedValueOnce(new Error('permission-denied'));
    await expect(ExternalProductService.getCached('4001')).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('leere EAN → null, KEIN getDoc', async () => {
    expect(await ExternalProductService.getCached('')).toBeNull();
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it('EAN nur aus Nicht-Ziffern → null, KEIN getDoc', async () => {
    expect(await ExternalProductService.getCached('ABC-XYZ')).toBeNull();
    expect(getDocMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('lookupByEAN — Online-Pfad (CF)', () => {
  it('online + Auth + CF-Hit → liefert CF-Antwort, korrekter Request', async () => {
    setAuth('tok-123');
    const product = { ean: '4001', source: 'rewe', productName: 'Cola' };
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      cfResponse({ product, fromCache: false, refreshed: true }),
    );

    const out = await ExternalProductService.lookupByEAN(' 40-01 ');

    expect(out).toEqual({ product, fromCache: false, refreshed: true });
    // genau ein fetch zur CF, kein Cache-getDoc nötig
    expect((global.fetch as jest.Mock)).toHaveBeenCalledTimes(1);
    expect(getDocMock).not.toHaveBeenCalled();

    const { url, opts, body } = fetchCall();
    expect(url).toBe(CF_URL);
    expect(opts.method).toBe('POST');
    expect((opts.headers as any).Authorization).toBe('Bearer tok-123');
    expect((opts.headers as any)['Content-Type']).toBe('application/json');
    // EAN normalisiert, force=false
    expect(body).toEqual({ ean: '4001', force: false });
    expect(opts.body).toBe(JSON.stringify({ ean: '4001', force: false }));
  });

  it('CF-Antwort fromCache/refreshed werden zu Booleans gecastet', async () => {
    setAuth('tok-xyz');
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      cfResponse({ product: { ean: '1', productName: 'P' } }), // fromCache/refreshed fehlen
    );
    const out = await ExternalProductService.lookupByEAN('1');
    expect(out).toEqual({
      product: { ean: '1', productName: 'P' },
      fromCache: false,
      refreshed: false,
    });
  });

  it('online, aber Auth=null → KEIN fetch, fällt auf getCached zurück (Cache-Hit)', async () => {
    firebaseMock.auth.currentUser = null;
    const cached = { ean: '4001', source: 'openfood', productName: 'Aus Cache' };
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(cached));

    const out = await ExternalProductService.lookupByEAN('4001');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(out).toEqual({ product: cached, fromCache: true, refreshed: false });
  });

  it('online, Auth=null, auch kein Cache → null', async () => {
    firebaseMock.auth.currentUser = null;
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(undefined));
    expect(await ExternalProductService.lookupByEAN('4001')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('CF res.ok=false (HTTP 500) → CF null → Cache-Fallback', async () => {
    setAuth('tok-123');
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      cfResponse({ product: { ean: 'x' } }, { ok: false, status: 500 }),
    );
    const cached = { ean: '4001', source: 'rewe', productName: 'Cache' };
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(cached));

    const out = await ExternalProductService.lookupByEAN('4001');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(getDocMock).toHaveBeenCalledTimes(1); // Fallback-Read
    expect(out).toEqual({ product: cached, fromCache: true, refreshed: false });
    expect(console.warn).toHaveBeenCalledWith('[external-lookup] CF non-ok', 500);
  });

  it('CF res.ok=false + kein Cache → null', async () => {
    setAuth('tok-123');
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      cfResponse({}, { ok: false, status: 503 }),
    );
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(undefined));
    expect(await ExternalProductService.lookupByEAN('4001')).toBeNull();
  });

  it('CF json ohne product-Feld → CF null → Cache-Fallback', async () => {
    setAuth('tok-123');
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      cfResponse({ fromCache: true, refreshed: false }), // kein product
    );
    const cached = { ean: '4001', source: 'rewe', productName: 'Cache' };
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(cached));

    const out = await ExternalProductService.lookupByEAN('4001');
    expect(out).toEqual({ product: cached, fromCache: true, refreshed: false });
  });

  it('CF json ohne product + kein Cache → null', async () => {
    setAuth('tok-123');
    (global.fetch as jest.Mock).mockResolvedValueOnce(cfResponse({}));
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(undefined));
    expect(await ExternalProductService.lookupByEAN('4001')).toBeNull();
  });

  it('fetch wirft (Netzwerkfehler) → gefangen → null → Cache-Fallback', async () => {
    setAuth('tok-123');
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    const cached = { ean: '4001', source: 'openfood', productName: 'Cache' };
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(cached));

    const out = await ExternalProductService.lookupByEAN('4001');
    expect(out).toEqual({ product: cached, fromCache: true, refreshed: false });
    expect(console.warn).toHaveBeenCalled();
  });

  it('getIdToken wirft → resolveViaCF gefangen → Cache-Fallback', async () => {
    firebaseMock.auth.currentUser = {
      getIdToken: jest.fn(async () => {
        throw new Error('token-failure');
      }),
    };
    const cached = { ean: '4001', source: 'rewe', productName: 'Cache' };
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(cached));

    const out = await ExternalProductService.lookupByEAN('4001');
    expect(global.fetch).not.toHaveBeenCalled(); // wirft vor dem fetch
    expect(out).toEqual({ product: cached, fromCache: true, refreshed: false });
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('lookupByEAN — Offline-Pfad', () => {
  it('offline → KEIN fetch, nur getCached (Cache-Hit)', async () => {
    isOnlineMock.mockReturnValue(false);
    setAuth('tok-123'); // Auth vorhanden, aber offline → trotzdem kein CF-Call
    const cached = { ean: '4001', source: 'rewe', productName: 'Offline-Cache' };
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(cached));

    const out = await ExternalProductService.lookupByEAN('4001');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(out).toEqual({ product: cached, fromCache: true, refreshed: false });
  });

  it('offline + kein Cache → null', async () => {
    isOnlineMock.mockReturnValue(false);
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(undefined));
    expect(await ExternalProductService.lookupByEAN('4001')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('lookupByEAN — Guards', () => {
  it('leere EAN → null, KEIN fetch, KEIN getDoc', async () => {
    setAuth('tok-123');
    const out = await ExternalProductService.lookupByEAN('');
    expect(out).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it('EAN ohne Ziffern → null, KEIN fetch, KEIN getDoc', async () => {
    setAuth('tok-123');
    const out = await ExternalProductService.lookupByEAN('---abc---');
    expect(out).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getDocMock).not.toHaveBeenCalled();
  });

  it('isOnline wird genau einmal befragt', async () => {
    setAuth('tok-123');
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      cfResponse({ product: { ean: '4001', productName: 'P' } }),
    );
    await ExternalProductService.lookupByEAN('4001');
    expect(isOnlineMock).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('forceLookupByEAN', () => {
  it('online + Auth + CF-Hit → Body enthält force:true', async () => {
    setAuth('tok-force');
    const product = { ean: '4001', source: 'rewe', productName: 'Force-Cola' };
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      cfResponse({ product, fromCache: false, refreshed: true }),
    );

    const out = await ExternalProductService.forceLookupByEAN(' 40-01 ');

    expect(out).toEqual({ product, fromCache: false, refreshed: true });
    const { url, opts, body } = fetchCall();
    expect(url).toBe(CF_URL);
    expect(opts.method).toBe('POST');
    expect((opts.headers as any).Authorization).toBe('Bearer tok-force');
    expect(body).toEqual({ ean: '4001', force: true });
  });

  it('online, Auth=null → KEIN fetch, Cache-Fallback', async () => {
    firebaseMock.auth.currentUser = null;
    const cached = { ean: '4001', source: 'rewe', productName: 'Cache' };
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(cached));

    const out = await ExternalProductService.forceLookupByEAN('4001');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(out).toEqual({ product: cached, fromCache: true, refreshed: false });
  });

  it('CF res.ok=false → Cache-Fallback', async () => {
    setAuth('tok-force');
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      cfResponse({}, { ok: false, status: 500 }),
    );
    const cached = { ean: '4001', source: 'openfood', productName: 'Cache' };
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(cached));

    const out = await ExternalProductService.forceLookupByEAN('4001');
    expect(out).toEqual({ product: cached, fromCache: true, refreshed: false });
  });

  it('fetch wirft → Cache-Fallback', async () => {
    setAuth('tok-force');
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(undefined));
    expect(await ExternalProductService.forceLookupByEAN('4001')).toBeNull();
  });

  it('offline → KEIN fetch, Cache-Fallback', async () => {
    isOnlineMock.mockReturnValue(false);
    setAuth('tok-force');
    const cached = { ean: '4001', source: 'rewe', productName: 'Offline' };
    getDocMock.mockResolvedValueOnce(makeDocSnapshot(cached));

    const out = await ExternalProductService.forceLookupByEAN('4001');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(out).toEqual({ product: cached, fromCache: true, refreshed: false });
  });

  it('leere EAN → null, KEIN fetch', async () => {
    setAuth('tok-force');
    expect(await ExternalProductService.forceLookupByEAN('')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getDocMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════
describe('ExternalProductService — Public-Surface', () => {
  it('exponiert die erwarteten Methoden', () => {
    for (const key of [
      'getCached',
      'getFresh',
      'writeThrough',
      'isExternalCacheStale',
      'normaliseEan',
      'lookupByEAN',
      'forceLookupByEAN',
      'recordMiss',
    ]) {
      expect(typeof (ExternalProductService as any)[key]).toBe('function');
    }
  });
});
