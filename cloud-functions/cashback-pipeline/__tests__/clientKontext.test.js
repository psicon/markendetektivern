'use strict';

const { uebernehmeClientKontext, logZusammenfassung } = require('../lib/clientKontext');

const JETZT = Date.UTC(2026, 8, 26, 10, 0, 0);
const AUFNAHME = JETZT - 60 * 60e3; // Bon vor einer Stunde fotografiert, jetzt hochgeladen
const gps = (x = {}) => ({ lat: 50.9381, lon: 6.9591, accuracyM: 14, fixAt: AUFNAHME - 30e3, ...x });
const lauf = (body) => uebernehmeClientKontext({ capturedAt: AUFNAHME, ...body }, { jetztMs: JETZT });

describe('Alte App ohne neue Felder — Schema bleibt exakt wie heute', () => {
  test('nichts geschickt → nichts geschrieben', () => {
    expect(lauf({})).toEqual({ capture: {}, clientVersion: null, verworfen: null });
  });
});

describe('Übernahme wie crowd_uploads', () => {
  test('komplettes CaptureContext-Objekt der App: nur gpsStatus + gps landen im Bon', () => {
    const r = lauf({
      captureContext: {
        capturedAt: AUFNAHME, gpsStatus: 'granted_precise', gps: gps(),
        confirmedPlace: { city: 'Köln' }, journeyLocation: { lat: 51.15, lon: 10.45 }, journeyId: 'j1',
      },
      clientVersion: { app: '6.0.21', build: '1275', platform: 'ios' },
    });
    expect(Object.keys(r.capture).sort()).toEqual(['gps', 'gpsStatus']);
    expect(r.capture.gps).toEqual({ lat: 50.9381, lon: 6.9591, accuracyM: 14, fixAt: new Date(AUFNAHME - 30e3) });
    expect(r.capture.gps.fixAt).toBeInstanceOf(Date); // Firestore → Timestamp, wie crowd_uploads
    expect(r.clientVersion).toEqual({ app: '6.0.21', build: '1275', platform: 'ios' });
  });

  test('serverseitige Felder lassen sich über den Client NICHT setzen', () => {
    const r = lauf({ captureContext: {
      gpsStatus: 'denied', hash: 'x', perceptualHashServer: 'y', forensicFlags: { suspiciousSoftware: false },
      exif: {}, source: 'live_camera', appCheck: true, deviceAttest: true, capturedAt: 0,
    } });
    expect(Object.keys(r.capture)).toEqual(['gpsStatus']);
  });

  test('ohne Freigabe: Status ja, Koordinate nein', () => {
    for (const s of ['denied', 'not_asked', 'timeout', 'unavailable']) {
      expect(lauf({ captureContext: { gpsStatus: s } }).capture).toEqual({ gpsStatus: s });
    }
  });

  test('Fehlertext des Clients wird gekürzt übernommen, zu lang verworfen', () => {
    expect(lauf({ captureContext: { gpsStatus: 'unavailable', gpsError: 'E_LOCATION_UNAVAILABLE' } }).capture.gpsError).toBe('E_LOCATION_UNAVAILABLE');
    expect(lauf({ captureContext: { gpsStatus: 'unavailable', gpsError: 'x'.repeat(121) } }).capture.gpsError).toBeUndefined();
  });
});

describe('gpsStatus nur aus der festen Liste (captureContext.ts GpsStatus)', () => {
  test('unbekannter Status wird nicht geschrieben, Fix verworfen', () => {
    const r = lauf({ captureContext: { gpsStatus: 'granted', gps: gps() } });
    expect(r.capture).toEqual({ gpsError: 'verworfen_status_ungueltig' });
  });
  test('Fix trotz verweigerter Freigabe ist widersprüchlich → verworfen', () => {
    const r = lauf({ captureContext: { gpsStatus: 'denied', gps: gps() } });
    expect(r.capture).toEqual({ gpsStatus: 'denied', gpsError: 'verworfen_status_ohne_freigabe' });
  });
});

describe('Koordinaten und Genauigkeit', () => {
  const mit = (g) => lauf({ captureContext: { gpsStatus: 'granted_precise', gps: g } });
  test.each([
    ['Breite > 90', { lat: 91 }, 'koordinate'],
    ['Länge < -180', { lon: -181 }, 'koordinate'],
    ['Text statt Zahl', { lat: '50.9' }, 'koordinate'],
    ['NaN', { lon: NaN }, 'koordinate'],
    ['Nullpunkt 0/0', { lat: 0, lon: 0 }, 'nullpunkt'],
    ['negative Genauigkeit (iOS: ungültig)', { accuracyM: -1 }, 'genauigkeit'],
    ['Genauigkeit > 100 km', { accuracyM: 150000 }, 'genauigkeit'],
    ['Genauigkeit als Text', { accuracyM: '14' }, 'genauigkeit'],
  ])('%s → verworfen', (_, x, grund) => {
    const r = mit(gps(x));
    expect(r.capture.gps).toBeUndefined();
    expect(r.verworfen).toBe(grund);
    expect(r.capture.gpsStatus).toBe('granted_precise');
  });
  test('Genauigkeit unbekannt (null) ist erlaubt', () => {
    expect(mit(gps({ accuracyM: null })).capture.gps.accuracyM).toBeNull();
  });
  test('ungefährer Standort (granted_coarse, 2 km) wird gespeichert', () => {
    const r = lauf({ captureContext: { gpsStatus: 'granted_coarse', gps: gps({ accuracyM: 2000 }) } });
    expect(r.capture.gps.accuracyM).toBe(2000);
  });
});

describe('fixAt plausibel zu capturedAt', () => {
  const mit = (fixAt, extra = {}) => lauf({ ...extra, captureContext: { gpsStatus: 'granted_precise', gps: gps({ fixAt }) } });
  test('last-known 9 min vor der Aufnahme → ok', () => expect(mit(AUFNAHME - 9 * 60e3).capture.gps).toBeDefined());
  test('frische Messung 4 s nach dem Auslösen → ok', () => expect(mit(AUFNAHME + 4e3).capture.gps).toBeDefined());
  test('erst beim Hochladen gemessen (55 min nach der Aufnahme) → verworfen', () => {
    expect(mit(AUFNAHME + 55 * 60e3).verworfen).toBe('fix_nach_aufnahme');
  });
  test('über einen Tag alt → verworfen', () => expect(mit(AUFNAHME - 25 * 3600e3).verworfen).toBe('fix_zu_alt'));
  test('Sekunden statt Millisekunden → verworfen', () => expect(mit(Math.floor(AUFNAHME / 1000)).verworfen).toBe('fixzeit'));
  test('fehlt → verworfen (sonst gälte der Fix als zeitgleich)', () => expect(mit(undefined).verworfen).toBe('fixzeit'));
  test('ohne capturedAt wird gegen die Serverzeit geprüft', () => {
    const r = uebernehmeClientKontext({ captureContext: { gpsStatus: 'granted_precise', gps: gps({ fixAt: JETZT - 60e3 }) } }, { jetztMs: JETZT });
    expect(r.capture.gps).toBeDefined();
  });
});

describe('clientVersion (top-level, wie crowd_uploads)', () => {
  test('Build als Zahl wird Text', () => {
    expect(lauf({ clientVersion: { app: '6.0.21', build: 1247, platform: 'android' } }).clientVersion).toEqual({ app: '6.0.21', build: '1247', platform: 'android' });
  });
  test('unbekannte Plattform → null, Rest bleibt', () => {
    expect(lauf({ clientVersion: { app: '6.0.21', build: '1', platform: 'windows' } }).clientVersion.platform).toBeNull();
  });
  test('nur Unsinn → gar kein Feld (Fehlen heißt weiter: alte App)', () => {
    expect(lauf({ clientVersion: { app: 'x'.repeat(40), build: '<script>', platform: 1 } }).clientVersion).toBeNull();
  });
});

describe('wirft nie', () => {
  test.each([[null], [undefined], ['text'], [{ captureContext: [] }], [{ clientVersion: [] }], [{ captureContext: { gpsStatus: 'granted_precise', gps: 'x' } }]])('%p', (b) => {
    expect(() => uebernehmeClientKontext(b, { jetztMs: JETZT })).not.toThrow();
  });
  test('Getter, der wirft → leeres Ergebnis statt Absturz', () => {
    const boese = { get captureContext() { throw new Error('boom'); } };
    expect(uebernehmeClientKontext(boese, { jetztMs: JETZT })).toEqual({ capture: {}, clientVersion: null, verworfen: null });
  });
});

describe('Logs', () => {
  test('keine Koordinaten in der Log-Zusammenfassung', () => {
    const r = lauf({ captureContext: { gpsStatus: 'granted_precise', gps: gps() }, clientVersion: { app: '6.0.21', platform: 'ios' } });
    const s = JSON.stringify(logZusammenfassung(r));
    expect(s).not.toMatch(/50\.93|6\.95/);
    expect(logZusammenfassung(r)).toEqual({ gpsStatus: 'granted_precise', hatGps: true, gpsVerworfen: null, platform: 'ios', app: '6.0.21' });
  });
});
