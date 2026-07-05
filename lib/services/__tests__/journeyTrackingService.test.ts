/**
 * Phase-2-Service-Test: journeyTrackingService.
 *
 * Fokus liegt auf dem Session-Kern + den jüngst geänderten Pfaden:
 * - `isMarketDataConsentGranted` ist lokal IMMER true (Consent-Gate
 *   bewusst entfernt) → startJourney/trackProductView steigen NICHT früh aus.
 * - `removeUndefinedValues` (rekursives undefined-Stripping, null/0/''/false
 *   bleiben erhalten).
 * - `startJourney` legt einen Journey-Context an.
 * - `trackProductView` baut die productRef je productType über
 *   `collectionForProductType` (brand→markenProdukte, noname→produkte,
 *   external→external_products — externe Produkte MÜSSEN getrackt werden).
 * - `ensureProductTracked` ist idempotent.
 * - `loadActiveJourney` Staleness-Guard (>6h idle → frische statt resume).
 * - `getViewedProductIndexAfterAction` + `trackQualityEngagement`.
 *
 * Firestore + RN/expo/Service-Deps sind komplett gemockt, sodass die reine
 * Service-Logik in Node läuft. Persist ist debounced (1500ms setTimeout) — die
 * Assertions zielen daher auf den IN-MEMORY-State (`getCurrentJourney()`), nicht
 * auf den verzögerten Firestore-Write. Wo der Persist getestet wird, sind
 * Fake-Timer-Annahmen explizit dokumentiert.
 */
import { makeSnapshot } from './__helpers__/rnfirestoreMock';

jest.mock('@react-native-firebase/firestore', () =>
  require('./__helpers__/rnfirestoreMock').createFirestoreMock(),
);
// `db` ist im Mock-Kontext irrelevant — nur ein Marker, der durchgereicht wird.
jest.mock('@/lib/firebase', () => ({ db: { __mockDb: true } }));

// expo-application liest beim Modul-Load APP_INFO (Version/Build/OS).
jest.mock('expo-application', () => ({
  nativeApplicationVersion: '6.0.0',
  applicationId: 'de.markendetektive',
  nativeBuildVersion: '1186',
}));

// react-native: nur Platform wird verwendet (APP_INFO.os).
jest.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: any) => o.ios },
}));

// analyticsService: tatsächlich genutzte Methoden im Service sind
// trackProductView, trackEvent, trackAddToCart (siehe grep der Callsites).
jest.mock('../analyticsService', () => ({
  analyticsService: {
    trackProductView: jest.fn(),
    trackEvent: jest.fn(),
    trackAddToCart: jest.fn(),
  },
}));

// AnonymousLocationService: der Service ruft NUR die statische getLocation()
// (addLocationToJourney). Default → null (keine Location).
jest.mock('../anonymousLocationService', () => ({
  AnonymousLocationService: {
    getLocation: jest.fn(async () => null),
  },
}));

// preferenceProfileService wird in completeJourney LAZY importiert
// (import('./preferenceProfileService')). Da unser Reset über
// completeJourney('new_session') läuft, mocken wir es, damit der dynamische
// Import nicht den echten Modul-Graph (Firestore etc.) zieht.
jest.mock('../preferenceProfileService', () => ({
  updateFromJourney: jest.fn(async () => undefined),
}));

import {
  doc,
  getDocs,
  updateDoc,
} from '@react-native-firebase/firestore';
import { analyticsService } from '../analyticsService';
import { AnonymousLocationService } from '../anonymousLocationService';
// HINWEIS: journeyTrackingService.ts exportiert NUR den Default (die Singleton-
// Instanz) — KEINEN benannten `JourneyTrackingService`-Klassen-Export (vgl.
// scanHistoryService, das beides exportiert). Die Singleton-Identität wird daher
// über die statische getInstance() am Konstruktor der Instanz geprüft.
import journeyTrackingService from '../journeyTrackingService';

const JourneyTrackingService = (journeyTrackingService as any)
  .constructor as { getInstance(): unknown };

const docMock = doc as unknown as jest.Mock;
const getDocsMock = getDocs as unknown as jest.Mock;
const updateDocMock = updateDoc as unknown as jest.Mock;
const trackProductViewMock = analyticsService.trackProductView as jest.Mock;
const getLocationMock = (AnonymousLocationService as any).getLocation as jest.Mock;

const service = journeyTrackingService as any;

/**
 * Sauberer Reset des Singletons vor jedem Test. completeJourney('new_session')
 * setzt currentJourney + currentJourneyUserId auf null (der definierte
 * Reset-Pfad). Zusätzlich werden interne Felder, die completeJourney NICHT
 * anfasst (lastUserId, isLoadingJourney, Persist-Debounce, consumerProfile-
 * Flag), direkt zurückgesetzt — sonst leckt State zwischen Tests (Singleton,
 * clearMocks räumt nur Call-Counts, nicht den Service-State).
 */
function resetJourneyState() {
  // Wenn eine Journey offen ist, sauber schließen (ohne userId → kein finalize-
  // Write, kein preferenceProfile-Import-Pfad mit echtem uid).
  service.currentJourney = null;
  service.currentJourneyUserId = null;
  service.lastUserId = null;
  service.isLoadingJourney = false;
  service.consumerProfileResolved = false;
  service.persistPendingUserId = null;
  service.persistJourneyCallCount = 0;
  if (service.persistDebounceTimer) {
    clearTimeout(service.persistDebounceTimer);
    service.persistDebounceTimer = null;
  }
  if (service.journeyTimeout) {
    clearTimeout(service.journeyTimeout);
    service.journeyTimeout = null;
  }
}

beforeEach(() => {
  getDocsMock.mockResolvedValue(makeSnapshot([]));
  getLocationMock.mockResolvedValue(null);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  resetJourneyState();
});

afterEach(() => {
  resetJourneyState();
  jest.restoreAllMocks();
});

describe('JourneyTrackingService.getInstance', () => {
  it('ist ein Singleton (default-Export === getInstance())', () => {
    expect(JourneyTrackingService.getInstance()).toBe(journeyTrackingService);
    expect(JourneyTrackingService.getInstance()).toBe(
      JourneyTrackingService.getInstance(),
    );
  });
});

describe('Consent-Gate ist entfernt (Journey läuft für ALLE User)', () => {
  it('startJourney erzeugt eine echte Journey (keine untracked-ID)', () => {
    const id = journeyTrackingService.startJourney('browse', 'home');
    expect(id).toMatch(/^journey_\d+_/);
    expect(id).not.toMatch(/untracked/);
    // Es existiert ein in-memory Journey-Context.
    expect(journeyTrackingService.getCurrentJourney()).not.toBeNull();
    expect(journeyTrackingService.getCurrentJourneyId()).toBe(id);
  });

  it('trackProductView legt OHNE vorherige Journey selbst eine an (kein Consent-Abbruch)', () => {
    expect(journeyTrackingService.getCurrentJourney()).toBeNull();
    journeyTrackingService.trackProductView('nn-1', 'noname', 'Ja! Cola');
    // Es gibt jetzt eine Journey + genau einen viewed-Eintrag.
    const j = journeyTrackingService.getCurrentJourney();
    expect(j).not.toBeNull();
    expect(j!.viewedProducts).toHaveLength(1);
  });
});

describe('removeUndefinedValues', () => {
  const clean = (obj: any) => service.removeUndefinedValues(obj);

  it('strippt undefined auf oberster Ebene, lässt null/0/""/false stehen', () => {
    const out = clean({ a: undefined, b: null, c: 0, d: '', e: false, f: 'x' });
    expect(out).not.toHaveProperty('a');
    expect(out).toEqual({ b: null, c: 0, d: '', e: false, f: 'x' });
  });

  it('strippt undefined rekursiv in verschachtelten Objekten', () => {
    const out = clean({
      nested: { keep: 1, drop: undefined, deeper: { gone: undefined, here: 'y' } },
    });
    expect(out).toEqual({ nested: { keep: 1, deeper: { here: 'y' } } });
    expect(out.nested).not.toHaveProperty('drop');
    expect(out.nested.deeper).not.toHaveProperty('gone');
  });

  it('filtert undefined-Elemente aus Arrays heraus', () => {
    const out = clean({ arr: [1, undefined, 2, null, undefined, 'z'] });
    // undefined wird gefiltert, null bleibt.
    expect(out.arr).toEqual([1, 2, null, 'z']);
  });

  it('verschachtelte Objekte INNERHALB von Arrays werden rekursiv bereinigt', () => {
    const out = clean({ list: [{ a: undefined, b: 2 }, { c: null }] });
    expect(out.list).toEqual([{ b: 2 }, { c: null }]);
  });

  it('Top-Level undefined → null', () => {
    expect(clean(undefined)).toBeNull();
  });

  it('Top-Level null → null (bleibt)', () => {
    expect(clean(null)).toBeNull();
  });

  it('lässt Date-Objekte unverändert', () => {
    const d = new Date('2026-06-14T00:00:00Z');
    expect(clean(d)).toBe(d);
  });

  it('lässt Objekte mit path (DocumentReference-Heuristik) unverändert', () => {
    const ref = { path: 'produkte/x', id: 'x' };
    expect(clean(ref)).toBe(ref);
  });

  it('lässt serverTimestamp-artige FieldValues (_type) unverändert', () => {
    const fv = { _type: 'serverTimestamp' };
    expect(clean(fv)).toBe(fv);
  });
});

describe('startJourney', () => {
  it('setzt die Kern-Felder des Journey-Context', () => {
    const before = Date.now();
    const id = journeyTrackingService.startJourney('search', 'explore', {
      searchQuery: 'Bier',
    });
    const j = journeyTrackingService.getCurrentJourney()!;
    expect(j.journeyId).toBe(id);
    expect(j.discoveryMethod).toBe('search');
    expect(j.screenName).toBe('explore');
    expect(j.startTime).toBeGreaterThanOrEqual(before);
    expect(j.activeFilters).toEqual({ searchQuery: 'Bier' });
    expect(Array.isArray(j.viewedProducts)).toBe(true);
    expect(j.viewedProducts).toHaveLength(0);
    expect(Array.isArray(j.converted)).toBe(true);
  });

  it('strippt undefined-Werte aus activeFilters', () => {
    journeyTrackingService.startJourney('browse', 'home', {
      searchQuery: 'X',
      sortBy: undefined,
    } as any);
    const j = journeyTrackingService.getCurrentJourney()!;
    expect(j.activeFilters).toEqual({ searchQuery: 'X' });
    expect(j.activeFilters).not.toHaveProperty('sortBy');
  });

  it('triggert die (fire-and-forget) Location-Auflösung beim Start', () => {
    journeyTrackingService.startJourney('browse', 'home');
    expect(getLocationMock).toHaveBeenCalled();
  });

  it('eine bereits laufende Journey wird vor dem Start der neuen beendet', () => {
    const first = journeyTrackingService.startJourney('browse', 'home');
    const second = journeyTrackingService.startJourney('scan', 'scanner');
    expect(second).not.toBe(first);
    expect(journeyTrackingService.getCurrentJourneyId()).toBe(second);
  });

  it('setzt currentJourneyUserId, wenn eine userId übergeben wird', () => {
    journeyTrackingService.startJourney('browse', 'home', undefined, 'u-42');
    expect(service.currentJourneyUserId).toBe('u-42');
  });
});

describe('trackProductView — productRef je productType (collectionForProductType)', () => {
  beforeEach(() => {
    journeyTrackingService.startJourney('browse', 'home');
    docMock.mockClear();
  });

  it("noname → productRef auf produkte/<id>", () => {
    journeyTrackingService.trackProductView('nn-123', 'noname', 'Ja! Cola');
    const j = journeyTrackingService.getCurrentJourney()!;
    const last = j.viewedProducts[j.viewedProducts.length - 1];
    const ref = last.actions![0].productRef;
    expect(ref).toEqual(expect.objectContaining({ path: 'produkte/nn-123' }));
    expect(docMock).toHaveBeenCalledWith({ __mockDb: true }, 'produkte', 'nn-123');
  });

  it('brand → productRef auf markenProdukte/<id>', () => {
    journeyTrackingService.trackProductView('mp-999', 'brand', 'Coca-Cola');
    const j = journeyTrackingService.getCurrentJourney()!;
    const last = j.viewedProducts[j.viewedProducts.length - 1];
    const ref = last.actions![0].productRef;
    expect(ref).toEqual(
      expect.objectContaining({ path: 'markenProdukte/mp-999' }),
    );
    expect(docMock).toHaveBeenCalledWith(
      { __mockDb: true },
      'markenProdukte',
      'mp-999',
    );
  });

  it('external → productRef auf external_products/<ean> (NICHT produkte/<ean>)', () => {
    // Der konkrete Bug-Fix: externe Produkte MÜSSEN getrackt werden und
    // zeigen auf external_products statt auf eine Bogus-produkte/{EAN}-Ref.
    journeyTrackingService.trackProductView(
      '5449000000996',
      'external',
      'Schwip Schwap',
    );
    const j = journeyTrackingService.getCurrentJourney()!;
    expect(j.viewedProducts).toHaveLength(1);
    const last = j.viewedProducts[0];
    const ref = last.actions![0].productRef;
    expect(ref).toEqual(
      expect.objectContaining({ path: 'external_products/5449000000996' }),
    );
    expect(docMock).toHaveBeenCalledWith(
      { __mockDb: true },
      'external_products',
      '5449000000996',
    );
    expect(ref.path).not.toContain('produkte/5449');
  });

  it('schreibt productType + productName in den viewed-Eintrag', () => {
    journeyTrackingService.trackProductView('p1', 'noname', 'Minimal');
    const last = journeyTrackingService.getCurrentJourney()!.viewedProducts[0];
    expect(last.productType).toBe('noname');
    expect(last.productName).toBe('Minimal');
    expect(last.actions![0].type).toBe('viewed');
  });

  it("leerer/fehlender productName → Fallback 'Produkt'", () => {
    journeyTrackingService.trackProductView('p1', 'noname', '' as any);
    const last = journeyTrackingService.getCurrentJourney()!.viewedProducts[0];
    expect(last.productName).toBe('Produkt');
  });

  it('jeder View ist ein eigener Eintrag (mehrfacher Aufruf → mehrere Einträge)', () => {
    journeyTrackingService.trackProductView('p1', 'noname', 'A');
    journeyTrackingService.trackProductView('p1', 'noname', 'A');
    journeyTrackingService.trackProductView('p2', 'noname', 'B');
    expect(journeyTrackingService.getCurrentJourney()!.viewedProducts).toHaveLength(3);
  });

  it('übergibt den Journey-Context an analyticsService.trackProductView', () => {
    trackProductViewMock.mockClear();
    journeyTrackingService.trackProductView('p1', 'brand', 'A', 3);
    expect(trackProductViewMock).toHaveBeenCalledTimes(1);
    const [pid, ptype, , extra] = trackProductViewMock.mock.calls[0];
    expect(pid).toBe('p1');
    expect(ptype).toBe('brand');
    expect(extra).toEqual(
      expect.objectContaining({ discovery_method: 'browse' }),
    );
  });

  it('position wird übernommen, wenn gesetzt', () => {
    journeyTrackingService.trackProductView('p1', 'noname', 'A', 7);
    expect(journeyTrackingService.getCurrentJourney()!.viewedProducts[0].position).toBe(7);
  });
});

describe('ensureProductTracked — idempotent', () => {
  beforeEach(() => {
    journeyTrackingService.startJourney('browse', 'home');
  });

  it('trackt ein noch nicht erfasstes Produkt genau einmal', () => {
    journeyTrackingService.ensureProductTracked('p1', 'noname', 'A');
    expect(journeyTrackingService.getCurrentJourney()!.viewedProducts).toHaveLength(1);
  });

  it('zweiter Aufruf mit gleicher productId → KEIN zweiter Eintrag', () => {
    journeyTrackingService.ensureProductTracked('p1', 'noname', 'A');
    journeyTrackingService.ensureProductTracked('p1', 'noname', 'A');
    expect(journeyTrackingService.getCurrentJourney()!.viewedProducts).toHaveLength(1);
  });

  it('unterschiedliche productIds → jeweils ein Eintrag', () => {
    journeyTrackingService.ensureProductTracked('p1', 'noname', 'A');
    journeyTrackingService.ensureProductTracked('p2', 'brand', 'B');
    expect(journeyTrackingService.getCurrentJourney()!.viewedProducts).toHaveLength(2);
  });

  it('leere productId → no-op', () => {
    journeyTrackingService.ensureProductTracked('', 'noname', 'A');
    expect(journeyTrackingService.getCurrentJourney()!.viewedProducts).toHaveLength(0);
  });
});

describe('loadActiveJourney — Staleness-Guard (JOURNEY_RESUME_MAX_IDLE_MS = 6h)', () => {
  const SIX_H = 6 * 60 * 60 * 1000;

  it('frische active-Journey (<6h idle) wird resumed', async () => {
    const recent = Date.now() - 60 * 1000; // 1 min her
    getDocsMock.mockResolvedValueOnce(
      makeSnapshot([
        {
          id: 'j-fresh',
          data: {
            journeyId: 'journey_fresh',
            status: 'active',
            startTime: { toDate: () => new Date(recent), toMillis: () => recent },
            lastUpdated: { toMillis: () => recent },
            discoveryMethod: 'browse',
            screenName: 'home',
            viewedProducts: [{ productId: 'x' }],
          },
        },
      ]),
    );
    await journeyTrackingService.loadActiveJourney('u1');
    const j = journeyTrackingService.getCurrentJourney()!;
    expect(j.journeyId).toBe('journey_fresh');
    expect(j.firestoreDocId).toBe('j-fresh');
    // Resume → das stale-close-updateDoc darf NICHT gelaufen sein.
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('stale active-Journey (>6h idle) wird NICHT resumed → frische Session', async () => {
    const stale = Date.now() - (SIX_H + 60 * 60 * 1000); // 7h her
    getDocsMock.mockResolvedValueOnce(
      makeSnapshot([
        {
          id: 'j-stale',
          ref: { __kind: 'doc', path: 'users/u1/journeys/j-stale', id: 'j-stale' },
          data: {
            journeyId: 'journey_stale',
            status: 'active',
            startTime: { toDate: () => new Date(stale), toMillis: () => stale },
            lastUpdated: { toMillis: () => stale },
            discoveryMethod: 'browse',
            screenName: 'home',
            viewedProducts: [],
          },
        },
      ]),
    );
    await journeyTrackingService.loadActiveJourney('u1');
    const j = journeyTrackingService.getCurrentJourney()!;
    // Die stale Journey wurde NICHT übernommen — es läuft eine frische.
    expect(j.journeyId).not.toBe('journey_stale');
    expect(j.journeyId).toMatch(/^journey_\d+_/);
    // Die alte wurde via updateDoc auf 'inactive'/stale_resume geschlossen.
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(updateDocMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ status: 'inactive', completionReason: 'stale_resume' }),
    );
  });

  it('Staleness fällt auf startTime zurück, wenn lastUpdated fehlt (>6h → frisch)', async () => {
    const stale = Date.now() - (SIX_H + 5 * 60 * 1000);
    getDocsMock.mockResolvedValueOnce(
      makeSnapshot([
        {
          id: 'j-stale2',
          ref: { __kind: 'doc', path: 'users/u1/journeys/j-stale2', id: 'j-stale2' },
          data: {
            journeyId: 'journey_stale2',
            status: 'active',
            startTime: { toDate: () => new Date(stale), toMillis: () => stale },
            // lastUpdated fehlt absichtlich → Fallback auf startTime
            discoveryMethod: 'browse',
            screenName: 'home',
            viewedProducts: [],
          },
        },
      ]),
    );
    await journeyTrackingService.loadActiveJourney('u1');
    expect(journeyTrackingService.getCurrentJourney()!.journeyId).not.toBe(
      'journey_stale2',
    );
    expect(updateDocMock).toHaveBeenCalledTimes(1);
  });

  it('keine active-Journey vorhanden → startet eine neue Session', async () => {
    getDocsMock.mockResolvedValueOnce(makeSnapshot([]));
    await journeyTrackingService.loadActiveJourney('u1');
    const j = journeyTrackingService.getCurrentJourney();
    expect(j).not.toBeNull();
    expect(j!.journeyId).toMatch(/^journey_\d+_/);
  });

  it('leere userId → kein Read, keine Journey', async () => {
    await journeyTrackingService.loadActiveJourney('');
    expect(getDocsMock).not.toHaveBeenCalled();
    expect(journeyTrackingService.getCurrentJourney()).toBeNull();
  });

  it('Fehler beim Laden → fällt auf neue Session zurück (kein Throw)', async () => {
    getDocsMock.mockRejectedValueOnce(new Error('offline'));
    await expect(
      journeyTrackingService.loadActiveJourney('u1'),
    ).resolves.toBeUndefined();
    expect(journeyTrackingService.getCurrentJourney()).not.toBeNull();
  });
});

describe('getViewedProductIndexAfterAction', () => {
  beforeEach(() => {
    journeyTrackingService.startJourney('browse', 'home');
  });

  it('keine Journey → null', () => {
    resetJourneyState();
    expect(
      journeyTrackingService.getViewedProductIndexAfterAction('p1'),
    ).toBeNull();
  });

  it('Produkt ohne addedToCart-Action → null', () => {
    journeyTrackingService.trackProductView('p1', 'noname', 'A'); // nur 'viewed'
    expect(
      journeyTrackingService.getViewedProductIndexAfterAction('p1'),
    ).toBeNull();
  });

  it('liefert den LETZTEN Index mit addedToCart-Action', () => {
    const j = journeyTrackingService.getCurrentJourney()!;
    // Manuell zwei Einträge mit addedToCart konstruieren (über die öffentliche
    // trackProductView entsteht nur 'viewed'; addToCart-Verdrahtung ist nicht
    // Teil dieses Fokus — wir testen die Index-Suche isoliert).
    j.viewedProducts = [
      { productId: 'p1', actions: [{ type: 'viewed' }] },
      { productId: 'p1', actions: [{ type: 'viewed' }, { type: 'addedToCart' }] },
      { productId: 'p2', actions: [{ type: 'addedToCart' }] },
    ] as any;
    expect(journeyTrackingService.getViewedProductIndexAfterAction('p1')).toBe(1);
    expect(journeyTrackingService.getViewedProductIndexAfterAction('p2')).toBe(2);
  });
});

describe('trackQualityEngagement', () => {
  beforeEach(() => {
    journeyTrackingService.startJourney('browse', 'home');
  });

  it('keine Journey → no-op (kein Throw)', () => {
    resetJourneyState();
    expect(() =>
      journeyTrackingService.trackQualityEngagement('p1', 'ai_expanded'),
    ).not.toThrow();
  });

  it('Produkt noch nicht viewed → no-op (kein qualityEngagement angelegt)', () => {
    journeyTrackingService.trackQualityEngagement('unknown', 'tab_nutrition');
    const j = journeyTrackingService.getCurrentJourney()!;
    expect(j.viewedProducts).toHaveLength(0);
  });

  it('setzt engaged=true + source + aiVerdict auf dem viewed-Produkt', () => {
    journeyTrackingService.trackProductView('p1', 'noname', 'A');
    journeyTrackingService.trackQualityEngagement('p1', 'ai_expanded', 'besser');
    const vp = journeyTrackingService.getCurrentJourney()!.viewedProducts.find(
      (p: any) => p.productId === 'p1',
    ) as any;
    expect(vp.qualityEngagement.engaged).toBe(true);
    expect(vp.qualityEngagement.sources.ai_expanded).toBe(true);
    expect(vp.aiVerdict).toBe('besser');
  });

  it('mehrere Engagement-Quellen akkumulieren auf demselben Produkt', () => {
    journeyTrackingService.trackProductView('p1', 'noname', 'A');
    journeyTrackingService.trackQualityEngagement('p1', 'ai_expanded');
    journeyTrackingService.trackQualityEngagement('p1', 'tab_ingredients');
    const vp = journeyTrackingService.getCurrentJourney()!.viewedProducts.find(
      (p: any) => p.productId === 'p1',
    ) as any;
    expect(vp.qualityEngagement.sources.ai_expanded).toBe(true);
    expect(vp.qualityEngagement.sources.tab_ingredients).toBe(true);
  });

  it('aiVerdict wird nicht überschrieben, wenn schon gesetzt', () => {
    journeyTrackingService.trackProductView('p1', 'noname', 'A');
    journeyTrackingService.trackQualityEngagement('p1', 'ai_expanded', 'besser');
    journeyTrackingService.trackQualityEngagement('p1', 'section_read', 'schlechter');
    const vp = journeyTrackingService.getCurrentJourney()!.viewedProducts.find(
      (p: any) => p.productId === 'p1',
    ) as any;
    expect(vp.aiVerdict).toBe('besser');
  });
});

describe('completeJourney — Reset-Pfad', () => {
  it("new_session löscht den in-memory Journey-Context", () => {
    journeyTrackingService.startJourney('browse', 'home');
    expect(journeyTrackingService.getCurrentJourney()).not.toBeNull();
    journeyTrackingService.completeJourney('new_session');
    expect(journeyTrackingService.getCurrentJourney()).toBeNull();
    expect(service.currentJourneyUserId).toBeNull();
  });

  it('completeJourney ohne aktive Journey → no-op (kein Throw)', () => {
    expect(() =>
      journeyTrackingService.completeJourney('new_session'),
    ).not.toThrow();
  });
});
