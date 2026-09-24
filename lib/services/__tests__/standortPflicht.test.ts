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
  enableNetworkProviderAsync: jest.fn<any, []>(),
};
jest.mock('expo-location', () => mockLocation);

const mockRN = {
  Platform: { OS: 'android' as 'android' | 'ios' },
  Linking: { openSettings: jest.fn<any, []>(), sendIntent: jest.fn<any, [string]>() },
};
jest.mock('react-native', () => mockRN);

import { pruefeStandortPflicht, standortPflichtErfuellen } from '@/lib/services/standortPflicht';

const erlaubt = { status: 'granted', granted: true, canAskAgain: true };
const nieGefragt = { status: 'undetermined', granted: false, canAskAgain: true };
const endgueltigAbgelehnt = { status: 'denied', granted: false, canAskAgain: false };

beforeEach(() => {
  mockRN.Platform.OS = 'android';
  mockLocation.hasServicesEnabledAsync.mockResolvedValue(true);
  mockRN.Linking.openSettings.mockResolvedValue(undefined);
  mockRN.Linking.sendIntent.mockResolvedValue(undefined);
});

describe('pruefeStandortPflicht', () => {
  it('erfüllt bei Freigabe und eingeschalteten Diensten', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    await expect(pruefeStandortPflicht()).resolves.toBe('erfuellt');
  });

  it('Dienste aus trotz Freigabe → dienste_aus', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    mockLocation.hasServicesEnabledAsync.mockResolvedValue(false);
    await expect(pruefeStandortPflicht()).resolves.toBe('dienste_aus');
  });

  it('nie gefragt → fragen', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(nieGefragt);
    await expect(pruefeStandortPflicht()).resolves.toBe('fragen');
  });

  it('endgültig abgelehnt → einstellungen; bei global ausgeschalteten Diensten zuerst die Dienste', async () => {
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(endgueltigAbgelehnt);
    await expect(pruefeStandortPflicht()).resolves.toBe('einstellungen');
    mockLocation.hasServicesEnabledAsync.mockResolvedValue(false);
    await expect(pruefeStandortPflicht()).resolves.toBe('dienste_aus');
  });

  it('Lesefehler sperren nicht', async () => {
    mockLocation.getForegroundPermissionsAsync.mockRejectedValue(new Error('native'));
    await expect(pruefeStandortPflicht()).resolves.toBe('erfuellt');
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    mockLocation.hasServicesEnabledAsync.mockRejectedValue(new Error('native'));
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

  it('einstellungen → App-Einstellungen, Stand kommt über den AppState (null)', async () => {
    await expect(standortPflichtErfuellen('einstellungen')).resolves.toBeNull();
    expect(mockRN.Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('Android, Dienste aus → Googles Einschalt-Dialog', async () => {
    mockLocation.enableNetworkProviderAsync.mockResolvedValue(undefined);
    mockLocation.getForegroundPermissionsAsync.mockResolvedValue(erlaubt);
    await expect(standortPflichtErfuellen('dienste_aus')).resolves.toBe('erfuellt');
    expect(mockRN.Linking.sendIntent).not.toHaveBeenCalled();
  });

  it('Android, Dialog abgelehnt → Systemseite der Ortung', async () => {
    mockLocation.enableNetworkProviderAsync.mockRejectedValue(new Error('abgelehnt'));
    await expect(standortPflichtErfuellen('dienste_aus')).resolves.toBeNull();
    expect(mockRN.Linking.sendIntent).toHaveBeenCalledWith('android.settings.LOCATION_SOURCE_SETTINGS');
  });

  it('iOS, Dienste aus → App-Einstellungen (keine privaten URLs)', async () => {
    mockRN.Platform.OS = 'ios';
    await expect(standortPflichtErfuellen('dienste_aus')).resolves.toBeNull();
    expect(mockLocation.enableNetworkProviderAsync).not.toHaveBeenCalled();
    expect(mockRN.Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('Einstellungen nicht zu öffnen → alter Stand, keine Sackgasse ohne Rückmeldung', async () => {
    mockRN.Linking.openSettings.mockRejectedValue(new Error('kaputt'));
    await expect(standortPflichtErfuellen('einstellungen')).resolves.toBe('einstellungen');
  });
});
