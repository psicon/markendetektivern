/**
 * Android 13+ meldet „nie gefragt" als `denied` (17.09.2026).
 *
 * Diese Suite nagelt fest, dass die App daraus wieder „offen" macht, solange
 * Android den Dialog noch zeigen würde — und dass echte Ablehnungen,
 * Android ≤ 12 und iOS unverändert bleiben.
 */

import { berechtigungAusExpo, einschaltenMitEinerFrage, wirdZugestellt } from '../pushPermissionStatus';

describe('einschaltenMitEinerFrage — genau eine Systemabfrage', () => {
  function schritte(aktuellerStand: any, fragenErgebnis: boolean, danach: any) {
    return {
      aktuellerStand,
      fragen: jest.fn(() => Promise.resolve(fragenErgebnis)),
      expoWegEinrichten: jest.fn(() => Promise.resolve()),
      standNeuLesen: jest.fn(() => Promise.resolve(danach)),
    };
  }

  it('Ablehnung: kein zweiter Weg, der erneut fragt', async () => {
    const s = schritte('undetermined', false, 'undetermined');
    await expect(einschaltenMitEinerFrage(s)).resolves.toBe('undetermined');
    expect(s.fragen).toHaveBeenCalledTimes(1);
    expect(s.expoWegEinrichten).not.toHaveBeenCalled();
    expect(s.standNeuLesen).toHaveBeenCalledTimes(1);
  });

  it('Zustimmung: Expo-Weg wird eingerichtet', async () => {
    const s = schritte('undetermined', true, 'granted');
    await expect(einschaltenMitEinerFrage(s)).resolves.toBe('granted');
    expect(s.fragen).toHaveBeenCalledTimes(1);
    expect(s.expoWegEinrichten).toHaveBeenCalledTimes(1);
  });

  it('schon erteilt: nicht fragen, nur einrichten', async () => {
    const s = schritte('granted', false, 'granted');
    await einschaltenMitEinerFrage(s);
    expect(s.fragen).not.toHaveBeenCalled();
    expect(s.expoWegEinrichten).toHaveBeenCalledTimes(1);
  });

  it('iOS leise zugestellt: fragt nach dem vollen Recht', async () => {
    const s = schritte('provisional', false, 'provisional');
    await einschaltenMitEinerFrage(s);
    expect(s.fragen).toHaveBeenCalledTimes(1);
    expect(s.expoWegEinrichten).not.toHaveBeenCalled();
  });
});

describe('berechtigungAusExpo — Android 13+', () => {
  it('nie gefragt (denied + canAskAgain) gilt als offen', () => {
    expect(berechtigungAusExpo({ status: 'denied', canAskAgain: true }, 'android', 34)).toBe('undetermined');
    expect(berechtigungAusExpo({ status: 'denied', canAskAgain: true }, 'android', 33)).toBe('undetermined');
  });

  it('nach der zweiten Ablehnung (canAskAgain false) bleibt es abgelehnt', () => {
    expect(berechtigungAusExpo({ status: 'denied', canAskAgain: false }, 'android', 34)).toBe('denied');
  });

  it('fehlt canAskAgain, gilt es als abgelehnt (fail-closed: kein Sheet ohne Wirkung)', () => {
    expect(berechtigungAusExpo({ status: 'denied' }, 'android', 34)).toBe('denied');
  });

  it('erteilt bleibt erteilt', () => {
    expect(berechtigungAusExpo({ status: 'granted', canAskAgain: true }, 'android', 34)).toBe('granted');
  });

  it('Versionsangabe als Text wird verstanden', () => {
    expect(berechtigungAusExpo({ status: 'denied', canAskAgain: true }, 'android', '34')).toBe('undetermined');
  });
});

describe('berechtigungAusExpo — Android ≤ 12 und unbekannte Version', () => {
  it('Android 12: denied heißt in den Systemeinstellungen abgeschaltet', () => {
    // expo liefert dort canAskAgain = areNotificationsEnabled = false; selbst
    // ein abweichender Wert darf kein Sheet auslösen, das nichts bewirken kann.
    expect(berechtigungAusExpo({ status: 'denied', canAskAgain: true }, 'android', 32)).toBe('denied');
  });

  it('ohne lesbare Version: abgelehnt', () => {
    expect(berechtigungAusExpo({ status: 'denied', canAskAgain: true }, 'android', undefined)).toBe('denied');
  });
});

describe('berechtigungAusExpo — iOS unverändert', () => {
  it('denied bleibt denied, auch mit canAskAgain', () => {
    expect(berechtigungAusExpo({ status: 'denied', canAskAgain: true }, 'ios', '18.0')).toBe('denied');
  });

  it('provisorisch (ios.status 3) wird erkannt', () => {
    expect(berechtigungAusExpo({ status: 'undetermined', ios: { status: 3 } }, 'ios', '18.0')).toBe('provisional');
  });

  it('nie gefragt bleibt offen', () => {
    expect(berechtigungAusExpo({ status: 'undetermined', ios: { status: 0 } }, 'ios', '18.0')).toBe('undetermined');
  });
});

describe('wirdZugestellt', () => {
  it('erteilt und provisorisch stellen zu, alles andere nicht', () => {
    expect(wirdZugestellt('granted')).toBe(true);
    expect(wirdZugestellt('provisional')).toBe(true);
    expect(wirdZugestellt('undetermined')).toBe(false);
    expect(wirdZugestellt('denied')).toBe(false);
    expect(wirdZugestellt('unknown')).toBe(false);
  });
});
