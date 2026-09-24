/**
 * Standortpflicht des Reward-Programms (6.0.20).
 *
 * Geprüft wird vor allem, dass niemand in einer Sackgasse landet: jeder
 * Stand führt zu genau einem nächsten Schritt, und ein Lesefehler sperrt
 * nicht (Infrastruktur ist keine Aussage über den Nutzer).
 */

const mockLocation = {
  getForegroundPermissionsAsync: jest.fn<any, []>(),
  requestForegroundPermissionsAsync: jest.fn<any, []>(),
  hasServicesEnabledAsync: jest.fn<any, []>(),
  getProviderStatusAsync: jest.fn<any, []>(),
  enableNetworkProviderAsync: jest.fn<any, []>(),
};
jest.mock('expo-location', () => mockLocation);

const mockRN = {
  Platform: { OS: 'android' as 'android' | 'ios' },
  Linking: { openSettings: jest.fn<any, []>(), sendIntent: jest.fn<any, [string]>() },
};
jest.mock('react-native', () => mockRN);

const erlaubt = { status: 'granted', granted: true, canAskAgain: true };
const nieGefragt = { status: 'undetermined', granted: false, canAskAgain: true };
const endgueltigAbgelehnt = { status: 'denied', granted: false, canAskAgain: false };

/** Ortungsdienste an/aus — auf beiden Plattformen-Pfaden. */
function dienste(an: boolean) {
  mockLocation.hasServicesEnabledAsync.mockResolvedValue(an);
  mockLocation.getProviderStatusAsync.mockResolvedValue({ locationServicesEnabled: an });
}

// Frisches Modul je Test: der Merker für den „zweiten Tipp" ist modulweit.
let pruefeStandortPflicht: typeof import('@/lib/services/standortPflicht').pruefeStandortPflicht;
let standortPflichtErfuellen: typeof import('@/lib/services/standortPflicht').standortPflichtErfuellen;

beforeEach(() => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ pruefeStandortPflicht, standortPflichtErfuellen } = require('@/lib/services/standortPflicht'));
  mockRN.Platform.OS = 'android';
  dienste(true);
  mockLocation.requestForegroundPermissionsAsync.mockReset();
  mockLocation.enableNetworkProviderAsync.mockReset();
  mockRN.Linking.openSettings.mockReset().mockResolvedValue(undefined);
  mockRN.Linking.sendIntent.mockReset().mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('pruefeStandortPflicht', () => {
  it('erfüllt bei Freigabe und eingeschalteten Diensten', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    await expect(pruefeStandortPflicht()).resolves.toBe('erfuellt');
  });

  it('Android fragt den Hauptschalter (getProviderStatusAsync), nicht die Anbieter', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    // Tablet ohne GPS-Chip: Anbieter „aus", Hauptschalter an
    mockLocation.hasServicesEnabledAsync.mockResolvedValue(false);
    mockLocation.getProviderStatusAsync.mockResolvedValue({ locationServicesEnabled: true });
    await expect(pruefeStandortPflicht()).resolves.toBe('erfuellt');
  });

  it('iOS nutzt hasServicesEnabledAsync', async () => {
    mockRN.Platform.OS = 'ios';
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    mockLocation.hasServicesEnabledAsync.mockResolvedValue(false);
    await expect(pruefeStandortPflicht()).resolves.toBe('dienste_aus');
  });

  it('Dienste aus trotz Freigabe → dienste_aus', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    dienste(false);
    await expect(pruefeStandortPflicht()).resolves.toBe('dienste_aus');
  });

  it('nie gefragt → fragen; Dienste aus hat Vorrang (iOS zeigt sonst keinen Dialog)', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(nieGefragt);
    await expect(pruefeStandortPflicht()).resolves.toBe('fragen');
    dienste(false);
    await expect(pruefeStandortPflicht()).resolves.toBe('dienste_aus');
  });

  it('endgültig abgelehnt → einstellungen', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(endgueltigAbgelehnt);
    await expect(pruefeStandortPflicht()).resolves.toBe('einstellungen');
  });

  it('Lesefehler sperren nicht', async () => {
    mockLocation.getForegroundPermissionsAsync.mockRejectedValue(new Error('native'));
    await expect(pruefeStandortPflicht()).resolves.toBe('erfuellt');
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    mockLocation.getProviderStatusAsync.mockRejectedValue(new Error('native'));
    await expect(pruefeStandortPflicht()).resolves.toBe('erfuellt');
  });
});

describe('standortPflichtErfuellen', () => {
  it('fragen → Systemdialog, danach frischer Stand', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    await expect(standortPflichtErfuellen('fragen')).resolves.toBe('erfuellt');
    expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('iOS, einstellungen → App-Einstellungen, Stand kommt über den AppState (null)', async () => {
    mockRN.Platform.OS = 'ios';
    await expect(standortPflichtErfuellen('einstellungen')).resolves.toBeNull();
    expect(mockRN.Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('Android, einstellungen: kommt der Dialog doch noch und wird erlaubt → weiter, keine Einstellungen', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    await expect(standortPflichtErfuellen('einstellungen')).resolves.toBe('erfuellt');
    expect(mockRN.Linking.openSettings).not.toHaveBeenCalled();
  });

  it('Android, einstellungen: Absage OHNE Dialog öffnet die Einstellungen — egal wie langsam (Galaxy-A13-Fall)', async () => {
    let t = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => t);
    mockLocation.requestForegroundPermissionsAsync.mockImplementation(async () => {
      t += 2500; // unsichtbare GrantPermissionsActivity auf langsamem Gerät
      return endgueltigAbgelehnt;
    });
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(endgueltigAbgelehnt);
    await expect(standortPflichtErfuellen('einstellungen')).resolves.toBeNull();
    expect(mockRN.Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('Android, einstellungen: Dialog erschien, Nutzer lehnte ab, wieder fragbar → kein ungefragter Sprung', async () => {
    mockLocation.requestForegroundPermissionsAsync.mockResolvedValue(nieGefragt);
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue({ ...nieGefragt, status: 'denied' });
    await expect(standortPflichtErfuellen('einstellungen')).resolves.toBe('fragen');
    expect(mockRN.Linking.openSettings).not.toHaveBeenCalled();
  });

  it('Android, Dienste aus → Googles Einschalt-Dialog, danach weiter', async () => {
    mockLocation.enableNetworkProviderAsync.mockResolvedValue(undefined);
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    await expect(standortPflichtErfuellen('dienste_aus')).resolves.toBe('erfuellt');
    expect(mockRN.Linking.sendIntent).not.toHaveBeenCalled();
  });

  it('Android, kein Dialog möglich (sofortige Absage) → Systemseite, OHNE auf sendIntent zu warten', async () => {
    mockLocation.enableNetworkProviderAsync.mockRejectedValue(new Error('keine Play-Dienste'));
    // RN 0.79: sendIntent löst nie auf — darf den Knopf nicht festhalten
    mockRN.Linking.sendIntent.mockReturnValue(new Promise(() => {}));
    await expect(standortPflichtErfuellen('dienste_aus')).resolves.toBeNull();
    expect(mockRN.Linking.sendIntent).toHaveBeenCalledWith('android.settings.LOCATION_SOURCE_SETTINGS');
  });

  it('Android, „Nein danke" im Dialog → nicht ungefragt weiter; zweiter Tipp → Systemseite', async () => {
    let t = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => t);
    mockLocation.enableNetworkProviderAsync.mockImplementation(async () => {
      t += 2000;
      throw new Error('nein danke');
    });
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    dienste(false);
    await expect(standortPflichtErfuellen('dienste_aus')).resolves.toBe('dienste_aus');
    expect(mockRN.Linking.sendIntent).not.toHaveBeenCalled();

    t += 5000; // zweiter Tipp kurz danach
    await expect(standortPflichtErfuellen('dienste_aus')).resolves.toBeNull();
    expect(mockRN.Linking.sendIntent).toHaveBeenCalledTimes(1);
    expect(mockLocation.enableNetworkProviderAsync).toHaveBeenCalledTimes(1);
  });

  it('iOS, Dienste aus → App-Einstellungen (keine privaten URLs)', async () => {
    mockRN.Platform.OS = 'ios';
    await expect(standortPflichtErfuellen('dienste_aus')).resolves.toBeNull();
    expect(mockLocation.enableNetworkProviderAsync).not.toHaveBeenCalled();
    expect(mockRN.Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('Einstellungen nicht zu öffnen → alter Stand, keine Sackgasse ohne Rückmeldung', async () => {
    mockRN.Platform.OS = 'ios';
    mockRN.Linking.openSettings.mockRejectedValue(new Error('kaputt'));
    await expect(standortPflichtErfuellen('einstellungen')).resolves.toBe('einstellungen');
  });
});
