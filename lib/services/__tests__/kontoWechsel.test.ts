/**
 * Wechsel eines Gastes in ein BESTEHENDES Konto (Entscheidung 25.09.2026,
 * Bauanleitung Schritt 26, Prüfrunde 1).
 *
 * Geprüft wird der Ablauf, an dem Geld hängt:
 * - Ohne Einreichungen läuft alles wie vor dem Umbau (kein Ticket, kein
 *   Hinweis, keine Netzrunde).
 * - Mit Einreichungen: Mitnahme-Dialog, Besitznachweis VOR dem Wechsel,
 *   offene Uploads werden noch als Gast hochgeladen, erst dann angemeldet.
 * - Scheitert der Besitznachweis, wird niemand aus dem eigenen Konto
 *   ausgesperrt.
 */

/** Antwort je Dialog-Titel; ohne Eintrag gilt der letzte Knopf. */
let antworten: Record<string, string> = {};

jest.mock('react-native', () => ({
  Alert: {
    alert: jest.fn((titel: string, _text: string, knoepfe: { text: string; onPress?: () => void }[]) => {
      const gewuenscht = antworten[titel];
      const knopf = gewuenscht ? knoepfe.find((k) => k.text === gewuenscht) : knoepfe[knoepfe.length - 1];
      if (!knopf) throw new Error(`Knopf ${gewuenscht} fehlt in „${titel}"`);
      knopf.onPress?.();
    }),
  },
}));

const authMock: { currentUser: any } = { currentUser: null };
jest.mock('@/lib/firebase', () => ({ auth: authMock }));

jest.mock('@/lib/services/gastBestand', () => ({
  GastBestand: { hat: jest.fn(async () => false), merke: jest.fn() },
}));
jest.mock('@/lib/services/gastUebernahme', () => ({
  GastUebernahme: {
    vorbereiten: jest.fn(async () => 'ok'),
    zielMerken: jest.fn(async () => undefined),
    einloesenAlle: jest.fn(async () => undefined),
  },
}));
jest.mock('@/lib/services/authRueckkehr', () => ({
  AuthRueckkehr: { nachKontowechsel: jest.fn(async () => undefined) },
}));
jest.mock('@/lib/services/bonUploadQueue', () => ({
  pausiereBonQueue: jest.fn(),
  setzeBonQueueFort: jest.fn(),
  gesperrteFreigeben: jest.fn(async () => undefined),
  bonsVorWechselAbarbeiten: jest.fn(async () => true),
}));
jest.mock('@/lib/services/uploadQueue', () => ({
  pausiereUploadQueue: jest.fn(),
  setzeUploadQueueFort: jest.fn(),
  uploadsVorWechselAbarbeiten: jest.fn(async () => true),
}));
jest.mock('@/lib/services/network', () => ({ isOnline: jest.fn(() => true) }));

import { Alert } from 'react-native';

import { AuthRueckkehr } from '@/lib/services/authRueckkehr';
import * as bonQueue from '@/lib/services/bonUploadQueue';
import { GastBestand } from '@/lib/services/gastBestand';
import { GastUebernahme } from '@/lib/services/gastUebernahme';
import {
  confirmAccountSwitch,
  inBestehendesKontoWechseln,
  KONTO_UMZUG_OFFLINE,
  maskiereEmail,
  nachVerknuepfung,
} from '@/lib/services/kontoWechsel';
import { isOnline } from '@/lib/services/network';
import * as fotoQueue from '@/lib/services/uploadQueue';

const alertMock = Alert.alert as jest.Mock;
const hatMock = GastBestand.hat as jest.Mock;
const vorbereitenMock = GastUebernahme.vorbereiten as jest.Mock;
const zielMerkenMock = GastUebernahme.zielMerken as jest.Mock;
const einloesenMock = GastUebernahme.einloesenAlle as jest.Mock;
const bonsAbarbeitenMock = bonQueue.bonsVorWechselAbarbeiten as jest.Mock;
const fotosAbarbeitenMock = fotoQueue.uploadsVorWechselAbarbeiten as jest.Mock;

const STUNDE = 60 * 60 * 1000;
let gastNr = 0;

/** Jeder Test bekommt einen eigenen Gast (die Mitnahme-Bestätigung gilt je uid). */
function gast(alterMs = 2 * STUNDE) {
  gastNr += 1;
  return {
    uid: `gast-${gastNr}`,
    isAnonymous: true,
    providerData: [],
    metadata: { creationTime: new Date(Date.now() - alterMs).toISOString() },
  };
}

const KONTO_B = { uid: 'konto-B', isAnonymous: false, providerData: [{ providerId: 'password' }] };

/** anmelden(), das — wie Firebase — die uid auf das bestehende Konto wechselt. */
function wechselNach(ziel: any = KONTO_B) {
  return jest.fn(async () => {
    authMock.currentUser = ziel;
    return 'ergebnis';
  });
}

function titel(): string[] {
  return alertMock.mock.calls.map((c) => c[0]);
}

beforeEach(() => {
  jest.clearAllMocks();
  antworten = {};
  authMock.currentUser = gast();
  hatMock.mockResolvedValue(false);
  vorbereitenMock.mockResolvedValue('ok');
  zielMerkenMock.mockResolvedValue(undefined);
  einloesenMock.mockResolvedValue(undefined);
  bonsAbarbeitenMock.mockResolvedValue(true);
  fotosAbarbeitenMock.mockResolvedValue(true);
  (AuthRueckkehr.nachKontowechsel as jest.Mock).mockResolvedValue(undefined);
  (isOnline as jest.Mock).mockReturnValue(true);
});

describe('inBestehendesKontoWechseln — ohne Einreichungen (Normalfall wie vorher)', () => {
  it('kein Gast → direkt anmelden, sonst nichts', async () => {
    authMock.currentUser = KONTO_B;
    const anmelden = wechselNach({ ...KONTO_B, uid: 'konto-C' });

    await expect(inBestehendesKontoWechseln({ zielEmail: 'x@y.de', anmelden })).resolves.toBe('ergebnis');

    expect(anmelden).toHaveBeenCalledTimes(1);
    expect(hatMock).not.toHaveBeenCalled();
    expect(vorbereitenMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
    expect(bonQueue.pausiereBonQueue).not.toHaveBeenCalled();
  });

  it('Gast ohne Bestand → alter Dialog, KEIN Ticket, kein Ziel, keine Pause, kein Warten', async () => {
    const anmelden = wechselNach();

    await expect(inBestehendesKontoWechseln({ zielEmail: 'x@y.de', anmelden })).resolves.toBe('ergebnis');

    expect(titel()).toEqual(['Du hast bereits ein Konto']);
    expect(vorbereitenMock).not.toHaveBeenCalled();
    expect(bonsAbarbeitenMock).not.toHaveBeenCalled();
    expect(fotosAbarbeitenMock).not.toHaveBeenCalled();
    expect(zielMerkenMock).not.toHaveBeenCalled();
    expect(einloesenMock).not.toHaveBeenCalled();
    expect(AuthRueckkehr.nachKontowechsel).not.toHaveBeenCalled();
    expect(bonQueue.pausiereBonQueue).not.toHaveBeenCalled();
  });

  it('frische Gast-Sitzung ohne Bestand → wie bisher ganz ohne Dialog', async () => {
    authMock.currentUser = gast(10 * 60 * 1000);
    await inBestehendesKontoWechseln({ anmelden: wechselNach() });
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('dialogUeberspringen ohne Bestand → kein Dialog (Facebook-Sheet hat bestätigt)', async () => {
    await inBestehendesKontoWechseln({ dialogUeberspringen: true, anmelden: wechselNach() });
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('Abbruch im alten Dialog → auth/cancelled, nicht angemeldet', async () => {
    antworten = { 'Du hast bereits ein Konto': 'Abbrechen' };
    const anmelden = wechselNach();
    await expect(inBestehendesKontoWechseln({ anmelden })).rejects.toMatchObject({ code: 'auth/cancelled' });
    expect(anmelden).not.toHaveBeenCalled();
  });

  it('ohne Bestand und offline → kein Netzversuch, die Anmeldung meldet sich selbst', async () => {
    (isOnline as jest.Mock).mockReturnValue(false);
    await inBestehendesKontoWechseln({ anmelden: wechselNach() });
    expect(vorbereitenMock).not.toHaveBeenCalled();
  });
});

describe('inBestehendesKontoWechseln — mit Einreichungen', () => {
  beforeEach(() => {
    hatMock.mockResolvedValue(true);
  });

  it('Mitnahme-Dialog mit maskierter E-Mail, auch in der ersten Stunde und trotz dialogUeberspringen', async () => {
    authMock.currentUser = gast(5 * 60 * 1000);
    await inBestehendesKontoWechseln({ zielEmail: 'patrick@web.de', dialogUeberspringen: true, anmelden: wechselNach() });

    expect(titel()).toEqual(['Willkommen zurück!']);
    expect(alertMock.mock.calls[0][1]).toContain('p***@web.de');
    expect(alertMock.mock.calls[0][1]).not.toContain('patrick@');
  });

  it('Reihenfolge: Ticket sichern → Uploads als Gast fertig → pausieren → anmelden → Ziel merken → einlösen → fortsetzen', async () => {
    const vonUid = authMock.currentUser.uid;
    const ablauf: string[] = [];
    vorbereitenMock.mockImplementation(async (uid: string) => {
      ablauf.push(`vorbereiten:${uid}:${authMock.currentUser.uid}`);
      return 'ok';
    });
    bonsAbarbeitenMock.mockImplementation(async (uid: string) => {
      ablauf.push(`bons:${uid}:${authMock.currentUser.uid}`);
      return true;
    });
    fotosAbarbeitenMock.mockImplementation(async (uid: string) => {
      ablauf.push(`fotos:${uid}:${authMock.currentUser.uid}`);
      return true;
    });
    (bonQueue.pausiereBonQueue as jest.Mock).mockImplementation(() => ablauf.push('pause'));
    (bonQueue.setzeBonQueueFort as jest.Mock).mockImplementation(() => ablauf.push('fort'));
    zielMerkenMock.mockImplementation(async (von: string, nach: string) => {
      ablauf.push(`ziel:${von}->${nach}`);
    });
    einloesenMock.mockImplementation(async () => {
      ablauf.push('einloesen');
    });
    const anmelden = jest.fn(async () => {
      ablauf.push('anmelden');
      authMock.currentUser = KONTO_B;
      return 'ergebnis';
    });

    await inBestehendesKontoWechseln({ anmelden });

    expect(ablauf).toEqual([
      `vorbereiten:${vonUid}:${vonUid}`,
      `bons:${vonUid}:${vonUid}`,
      `fotos:${vonUid}:${vonUid}`,
      'pause',
      'anmelden',
      `ziel:${vonUid}->konto-B`,
      'einloesen',
      'fort',
    ]);
    expect(fotoQueue.setzeUploadQueueFort).toHaveBeenCalledTimes(1);
    expect(AuthRueckkehr.nachKontowechsel).toHaveBeenCalledTimes(1);
  });

  it('Abbruch im Mitnahme-Dialog → auth/cancelled, nichts angefasst', async () => {
    antworten = { 'Willkommen zurück!': 'Abbrechen' };
    const anmelden = wechselNach();
    await expect(inBestehendesKontoWechseln({ anmelden })).rejects.toMatchObject({ code: 'auth/cancelled' });
    expect(vorbereitenMock).not.toHaveBeenCalled();
    expect(anmelden).not.toHaveBeenCalled();
    expect(bonQueue.pausiereBonQueue).not.toHaveBeenCalled();
  });

  it('offline → auth/konto-umzug-offline sofort, ohne Netzversuche und ohne Wechsel', async () => {
    (isOnline as jest.Mock).mockReturnValue(false);
    const anmelden = wechselNach();
    await expect(inBestehendesKontoWechseln({ anmelden })).rejects.toMatchObject({ code: KONTO_UMZUG_OFFLINE });
    expect(vorbereitenMock).not.toHaveBeenCalled();
    expect(anmelden).not.toHaveBeenCalled();
  });

  it('Ticket scheitert am Netz → auth/konto-umzug-offline, kein Wechsel', async () => {
    vorbereitenMock.mockResolvedValue('offline');
    const anmelden = wechselNach();
    await expect(inBestehendesKontoWechseln({ anmelden })).rejects.toMatchObject({ code: KONTO_UMZUG_OFFLINE });
    expect(anmelden).not.toHaveBeenCalled();
    expect(bonQueue.pausiereBonQueue).not.toHaveBeenCalled();
  });

  it.each(['fehler', 'zu_viele'])(
    'Ticket scheitert (%s) → „Jetzt anmelden" führt ins Konto, ohne Ziel und ohne Warten',
    async (grund) => {
      vorbereitenMock.mockResolvedValue(grund);
      antworten = { 'Mitnahme klappt gerade nicht': 'Jetzt anmelden' };
      const anmelden = wechselNach();

      await expect(inBestehendesKontoWechseln({ anmelden })).resolves.toBe('ergebnis');

      expect(anmelden).toHaveBeenCalledTimes(1);
      expect(bonsAbarbeitenMock).not.toHaveBeenCalled();
      expect(zielMerkenMock).not.toHaveBeenCalled();
      expect(einloesenMock).not.toHaveBeenCalled();
      expect(bonQueue.setzeBonQueueFort).toHaveBeenCalledTimes(1);
    },
  );

  it('Ticket scheitert → „Nochmal versuchen" versucht erneut und wechselt dann normal', async () => {
    vorbereitenMock.mockResolvedValueOnce('fehler').mockResolvedValueOnce('ok');
    antworten = { 'Mitnahme klappt gerade nicht': 'Nochmal versuchen' };

    await inBestehendesKontoWechseln({ anmelden: wechselNach() });

    expect(vorbereitenMock).toHaveBeenCalledTimes(2);
    expect(zielMerkenMock).toHaveBeenCalledTimes(1);
  });

  it('Ticket scheitert → „Abbrechen" wirft auth/cancelled', async () => {
    vorbereitenMock.mockResolvedValue('fehler');
    antworten = { 'Mitnahme klappt gerade nicht': 'Abbrechen' };
    const anmelden = wechselNach();
    await expect(inBestehendesKontoWechseln({ anmelden })).rejects.toMatchObject({ code: 'auth/cancelled' });
    expect(anmelden).not.toHaveBeenCalled();
  });

  it('Uploads noch nicht fertig → „Weiter warten" wartet eine weitere Runde, dann Wechsel', async () => {
    bonsAbarbeitenMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await inBestehendesKontoWechseln({ anmelden: wechselNach() });

    expect(titel()).toEqual(['Willkommen zurück!', 'Gleich fertig']);
    expect(bonsAbarbeitenMock).toHaveBeenCalledTimes(2);
    expect(zielMerkenMock).toHaveBeenCalledTimes(1);
  });

  it('Uploads noch nicht fertig → Abbrechen lässt den Gast angemeldet', async () => {
    fotosAbarbeitenMock.mockResolvedValue(false);
    antworten = { 'Gleich fertig': 'Abbrechen' };
    const anmelden = wechselNach();
    await expect(inBestehendesKontoWechseln({ anmelden })).rejects.toMatchObject({ code: 'auth/cancelled' });
    expect(anmelden).not.toHaveBeenCalled();
    expect(bonQueue.pausiereBonQueue).not.toHaveBeenCalled();
  });

  it('zweiter Aufruf für denselben Gast (Facebook → Passwort) zeigt den Dialog nicht noch einmal', async () => {
    const scheitert = jest.fn(async () => {
      throw Object.assign(new Error('fb'), { code: 'auth/account-exists-with-different-credential' });
    });
    await expect(inBestehendesKontoWechseln({ anmelden: scheitert })).rejects.toMatchObject({
      code: 'auth/account-exists-with-different-credential',
    });
    await inBestehendesKontoWechseln({ dialogUeberspringen: true, anmelden: wechselNach() });

    expect(titel()).toEqual(['Willkommen zurück!']);
  });

  it('Anmeldung scheitert → Fehler kommt durch, Warteschlangen laufen weiter, kein Ziel', async () => {
    const anmelden = jest.fn(async () => {
      throw Object.assign(new Error('falsch'), { code: 'auth/wrong-password' });
    });
    await expect(inBestehendesKontoWechseln({ anmelden })).rejects.toMatchObject({ code: 'auth/wrong-password' });
    expect(zielMerkenMock).not.toHaveBeenCalled();
    expect(bonQueue.setzeBonQueueFort).toHaveBeenCalledTimes(1);
    expect(fotoQueue.setzeUploadQueueFort).toHaveBeenCalledTimes(1);
  });

  it('gleiche uid nach der Anmeldung → kein Ziel gemerkt', async () => {
    const anmelden = jest.fn(async () => 'ergebnis');
    await inBestehendesKontoWechseln({ anmelden });
    expect(zielMerkenMock).not.toHaveBeenCalled();
  });

  it('Fehler beim Merken des Ziels lässt die gelungene Anmeldung stehen', async () => {
    zielMerkenMock.mockRejectedValueOnce(new Error('SecureStore weg'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(inBestehendesKontoWechseln({ anmelden: wechselNach() })).resolves.toBe('ergebnis');
    warn.mockRestore();
  });
});

describe('confirmAccountSwitch (verschoben, Verhalten gleich)', () => {
  it('frische Gast-Sitzung unter 60 Minuten → ohne Dialog weiter', async () => {
    authMock.currentUser = gast(59 * 60 * 1000);
    await expect(confirmAccountSwitch()).resolves.toBe(true);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('ältere Sitzung → Dialog, Antwort entscheidet', async () => {
    authMock.currentUser = gast(61 * 60 * 1000);
    await expect(confirmAccountSwitch()).resolves.toBe(true);
    antworten = { 'Du hast bereits ein Konto': 'Abbrechen' };
    await expect(confirmAccountSwitch()).resolves.toBe(false);
    expect(alertMock).toHaveBeenCalledTimes(2);
  });
});

describe('Hilfen', () => {
  it('maskiereEmail', () => {
    expect(maskiereEmail('patrick@web.de')).toBe('p***@web.de');
    expect(maskiereEmail(' a@b.de ')).toBe('a***@b.de');
    expect(maskiereEmail('kaputt')).toBeNull();
    expect(maskiereEmail('@web.de')).toBeNull();
    expect(maskiereEmail('x@')).toBeNull();
    expect(maskiereEmail(null)).toBeNull();
  });

  it('nachVerknuepfung gibt auf ein Konto wartende Aufträge frei und wirft nie', async () => {
    (bonQueue.gesperrteFreigeben as jest.Mock).mockRejectedValueOnce(new Error('weg'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => nachVerknuepfung()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(bonQueue.gesperrteFreigeben).toHaveBeenCalledWith(['konto_erforderlich']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
