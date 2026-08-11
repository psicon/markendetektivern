/**
 * Tests für den Aufnahme-Kontext.
 *
 * Der Service läuft im stillen Pfad: Wenn er scheitert, merkt das niemand —
 * die Einreichung geht durch, nur ohne Ortsangabe. Genau deshalb prüfen
 * diese Tests vor allem, dass er NIE wirft und dass er den Grund für ein
 * fehlendes GPS festhält. Ohne diesen Grund ist „Nutzer hat abgelehnt"
 * nicht von „alte App-Version" zu unterscheiden — und damit wäre die
 * Abdeckung der Standortfreigabe unmessbar.
 */

const mockLocation = {
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
};
jest.mock('expo-location', () => mockLocation);

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '6.0.16',
  nativeBuildVersion: '1234',
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

// Ohne Typ-Argument leitet jest.fn(() => null) den Rückgabetyp `null` ab
// und lehnt danach jedes mockReturnValue mit echten Daten ab.
const mockJourney = {
  getCurrentJourneyLocation: jest.fn<any, []>(),
  getCurrentJourneyId: jest.fn<any, []>(),
};
jest.mock('@/lib/services/journeyTrackingService', () => ({
  __esModule: true,
  default: mockJourney,
}));

import {
  clientVersion,
  erfasseCaptureContext,
  standortAnfordern,
  standortStatus,
} from '../captureContext';

const erlaubt = (over = {}) => ({ granted: true, canAskAgain: true, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt());
  mockLocation.getLastKnownPositionAsync.mockResolvedValue(null);
  mockLocation.getCurrentPositionAsync.mockResolvedValue(null);
  mockJourney.getCurrentJourneyLocation.mockReturnValue(null);
  mockJourney.getCurrentJourneyId.mockReturnValue(null);
});

describe('Berechtigungsstatus wird gelesen, nie erfragt', () => {
  it('fragt NIE nach der Berechtigung — der iOS-Dialog erscheint nur einmal im Leben der App', async () => {
    await erfasseCaptureContext();
    // requestForegroundPermissionsAsync existiert im Mock gar nicht; würde
    // der Service es aufrufen, schlüge der Test mit TypeError fehl.
    expect(mockLocation.getForegroundPermissionsAsync).toHaveBeenCalled();
  });

  it('unterscheidet „noch nicht gefragt" von „abgelehnt"', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: true,
    });
    expect(await standortStatus()).toBe('not_asked');

    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    });
    expect(await standortStatus()).toBe('denied');
  });

  it('erkennt Androids „ungefähren Standort"', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(
      erlaubt({ android: { accuracy: 'coarse' } }),
    );
    expect(await standortStatus()).toBe('granted_coarse');
  });
});

describe('standortAnfordern löst den System-Dialog aus — und nur diese Funktion', () => {
  it('meldet die erteilte Freigabe', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue(erlaubt());
    expect(await standortAnfordern()).toBe('granted_precise');
  });

  it('unterscheidet eine endgültige Ablehnung von einer aufschiebbaren', async () => {
    // Der Unterschied entscheidet über die Reaktion: Bei „denied" zeigt
    // iOS den Dialog NIE wieder, der Aufruf kehrt still zurück — dort muss
    // ein eigener Hinweis mit dem Weg in die Einstellungen übernehmen,
    // sonst wirkt der Knopf kaputt.
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    });
    expect(await standortAnfordern()).toBe('denied');

    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: true,
    });
    expect(await standortAnfordern()).toBe('not_asked');
  });

  it('wirft nicht, wenn die Abfrage selbst scheitert', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockRejectedValue(new Error('x'));
    expect(await standortAnfordern()).toBe('unavailable');
  });

  it('wird vom stillen Erfassungspfad NICHT aufgerufen', async () => {
    // Die Trennung ist der ganze Punkt: erfasseCaptureContext läuft beim
    // Einreichen im Hintergrund und darf den einen iOS-Versuch niemals
    // dort verbrauchen.
    await erfasseCaptureContext();
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('Die Kamera darf nie warten', () => {
  it('nimmt einen frischen bekannten Fix sofort, ohne eine Messung zu starten', async () => {
    mockLocation.getLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 52.52, longitude: 13.405, accuracy: 12 },
      timestamp: Date.now() - 30_000,
    });

    const c = await erfasseCaptureContext();
    expect(c.gps).toMatchObject({ lat: 52.52, lon: 13.405, accuracyM: 12 });
    // Eine frische Messung kann drinnen 30–60 s ohne Fix laufen — genau
    // deshalb wird sie hier gar nicht erst angestoßen.
    expect(mockLocation.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('verwirft einen veralteten Fix als „aktuelle Position" und misst neu', async () => {
    mockLocation.getLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 52.52, longitude: 13.405, accuracy: 12 },
      timestamp: Date.now() - 60 * 60 * 1000, // eine Stunde alt
    });
    mockLocation.getCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 48.137, longitude: 11.575, accuracy: 8 },
      timestamp: Date.now(),
    });

    const c = await erfasseCaptureContext();
    expect(mockLocation.getCurrentPositionAsync).toHaveBeenCalled();
    expect(c.gps?.lat).toBeCloseTo(48.137, 3);
  });
});

describe('Ein fehlendes GPS wird begründet, nicht verschwiegen', () => {
  it('hält „abgelehnt" fest', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    });
    const c = await erfasseCaptureContext();
    expect(c.gps).toBeNull();
    expect(c.gpsStatus).toBe('denied');
  });

  it('hält „noch nicht gefragt" fest', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: true,
    });
    expect((await erfasseCaptureContext()).gpsStatus).toBe('not_asked');
  });

  it('meldet „unavailable", wenn die Ortung selbst wirft', async () => {
    mockLocation.getForegroundPermissionsAsync.mockRejectedValue(new Error('kaputt'));
    const c = await erfasseCaptureContext();
    expect(c.gpsStatus).toBe('unavailable');
  });
});

describe('Der Aufnahmezeitpunkt bleibt erhalten', () => {
  it('übernimmt die übergebene Zeit, statt „jetzt" zu nehmen', async () => {
    // Der springende Punkt: submitProduct läuft erst beim Flush der
    // Warteschlange, unter Umständen Tage später. Ohne diesen Wert bekäme
    // ein im Laden aufgenommenes Foto die Ortung von zuhause.
    const gestern = Date.now() - 24 * 60 * 60 * 1000;
    const c = await erfasseCaptureContext({ capturedAt: gestern });
    expect(c.capturedAt).toBe(gestern);
  });
});

describe('Eine Einreichung darf nie an den Ortsdaten scheitern', () => {
  it('wirft auch dann nicht, wenn jede einzelne Quelle scheitert', async () => {
    mockLocation.getForegroundPermissionsAsync.mockRejectedValue(new Error('x'));
    mockLocation.getLastKnownPositionAsync.mockRejectedValue(new Error('y'));
    mockJourney.getCurrentJourneyLocation.mockImplementation(() => {
      throw new Error('z');
    });

    const c = await erfasseCaptureContext();
    expect(c).toMatchObject({ gps: null, journeyLocation: null });
    expect(typeof c.capturedAt).toBe('number');
  });
});

describe('Die Journey-Ortung wird unverändert durchgereicht', () => {
  it('übernimmt die Felder, ohne sie zu deuten', async () => {
    mockJourney.getCurrentJourneyLocation.mockReturnValue({
      lat: 51.45,
      lon: 6.65,
      city: 'Moers',
      geohash5: '51.45_6.65',
      source: 'ip',
    });
    mockJourney.getCurrentJourneyId.mockReturnValue('journey_123');

    const c = await erfasseCaptureContext();
    expect(c.journeyLocation).toEqual({
      lat: 51.45,
      lon: 6.65,
      city: 'Moers',
      geohash5: '51.45_6.65',
      source: 'ip',
    });
    expect(c.journeyId).toBe('journey_123');
  });
});

describe('Die App-Version wird mitgeschrieben', () => {
  it('liefert Version, Build und Plattform', () => {
    // Heute trägt KEIN Dokument ein Versionsfeld — dadurch ist weder die
    // Verbreitung eines Updates messbar noch unterscheidbar, ob ein Feld
    // wegen einer alten App fehlt.
    expect(clientVersion()).toEqual({ app: '6.0.16', build: '1234', platform: 'ios' });
  });
});
