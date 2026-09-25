/**
 * Wechsel eines Gastes in ein BESTEHENDES Konto (Entscheidung 25.09.2026,
 * Bauanleitung Schritt 26).
 *
 * Geprüft wird der Ablauf, an dem Geld hängt: Wer etwas eingereicht hat,
 * bekommt immer den Mitnahme-Dialog, der Besitznachweis wird VOR dem Wechsel
 * gesichert, ohne ihn gibt es bei vorhandenem Bestand keinen Wechsel, und nach
 * dem Wechsel wird genau das neue Konto als Ziel gemerkt.
 */

type Wahl = 'ok' | 'abbrechen';
let wahl: Wahl = 'ok';

jest.mock('react-native', () => ({
  Alert: {
    alert: jest.fn((_titel: string, _text: string, knoepfe: { onPress?: () => void }[]) => {
      const knopf = wahl === 'ok' ? knoepfe[knoepfe.length - 1] : knoepfe[0];
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
    vorbereiten: jest.fn(async () => true),
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
}));
jest.mock('@/lib/services/uploadQueue', () => ({
  pausiereUploadQueue: jest.fn(),
  setzeUploadQueueFort: jest.fn(),
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

const STUNDE = 60 * 60 * 1000;

function gast(alterMs = 2 * STUNDE) {
  return {
    uid: 'gast-A',
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

beforeEach(() => {
  wahl = 'ok';
  authMock.currentUser = gast();
  hatMock.mockResolvedValue(false);
  vorbereitenMock.mockResolvedValue(true);
  zielMerkenMock.mockResolvedValue(undefined);
  einloesenMock.mockResolvedValue(undefined);
  (AuthRueckkehr.nachKontowechsel as jest.Mock).mockResolvedValue(undefined);
  (bonQueue.pausiereBonQueue as jest.Mock).mockImplementation(() => undefined);
  (bonQueue.setzeBonQueueFort as jest.Mock).mockImplementation(() => undefined);
  (isOnline as jest.Mock).mockReturnValue(true);
});

function erwarteFortgesetzt() {
  expect(bonQueue.setzeBonQueueFort).toHaveBeenCalledTimes(1);
  expect(fotoQueue.setzeUploadQueueFort).toHaveBeenCalledTimes(1);
}

describe('inBestehendesKontoWechseln', () => {
  it('kein Gast → direkt anmelden, kein Ticket, kein Dialog, keine Pause', async () => {
    authMock.currentUser = KONTO_B;
    const anmelden = wechselNach({ ...KONTO_B, uid: 'konto-C' });

    await expect(inBestehendesKontoWechseln({ zielEmail: 'x@y.de', anmelden })).resolves.toBe('ergebnis');

    expect(anmelden).toHaveBeenCalledTimes(1);
    expect(hatMock).not.toHaveBeenCalled();
    expect(vorbereitenMock).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
    expect(bonQueue.pausiereBonQueue).not.toHaveBeenCalled();
    expect(zielMerkenMock).not.toHaveBeenCalled();
  });

  it('Gast mit Bestand → Mitnahme-Dialog mit maskierter E-Mail, auch in der ersten Stunde', async () => {
    authMock.currentUser = gast(5 * 60 * 1000); // frisch: früher stille Automatik
    hatMock.mockResolvedValue(true);

    await inBestehendesKontoWechseln({ zielEmail: 'patrick@web.de', anmelden: wechselNach() });

    expect(alertMock).toHaveBeenCalledTimes(1);
    const [titel, text, knoepfe] = alertMock.mock.calls[0];
    expect(titel).toBe('Willkommen zurück!');
    expect(text).toContain('p***@web.de');
    expect(text).not.toContain('patrick@');
    expect(knoepfe.map((k: { text: string }) => k.text)).toEqual(['Abbrechen', 'Mitnehmen & anmelden']);
  });

  it('Mitnahme-Dialog kommt trotz dialogUeberspringen, sobald Bestand da ist', async () => {
    hatMock.mockResolvedValue(true);
    await inBestehendesKontoWechseln({ dialogUeberspringen: true, anmelden: wechselNach() });
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0][0]).toBe('Willkommen zurück!');
  });

  it('Reihenfolge: pausieren → Ticket sichern → anmelden → Ziel merken → einlösen → fortsetzen', async () => {
    hatMock.mockResolvedValue(true);
    const reihe: string[] = [];
    (bonQueue.pausiereBonQueue as jest.Mock).mockImplementation(() => reihe.push('pause'));
    vorbereitenMock.mockImplementation(async (von: string) => {
      reihe.push(`vorbereiten:${von}:${authMock.currentUser.uid}`);
      return true;
    });
    const anmelden = jest.fn(async () => {
      reihe.push('anmelden');
      authMock.currentUser = KONTO_B;
      return 'ergebnis';
    });
    zielMerkenMock.mockImplementation(async (von: string, ziel: string) => {
      reihe.push(`ziel:${von}->${ziel}`);
    });
    (AuthRueckkehr.nachKontowechsel as jest.Mock).mockImplementation(async () => reihe.push('rueckkehr'));
    einloesenMock.mockImplementation(async () => reihe.push('einloesen'));
    (bonQueue.setzeBonQueueFort as jest.Mock).mockImplementation(() => reihe.push('fort'));

    await expect(inBestehendesKontoWechseln({ zielEmail: 'p@web.de', anmelden })).resolves.toBe('ergebnis');

    // vorbereiten läuft, solange noch der GAST angemeldet ist.
    expect(reihe).toEqual([
      'pause',
      'vorbereiten:gast-A:gast-A',
      'anmelden',
      'ziel:gast-A->konto-B',
      'rueckkehr',
      'einloesen',
      'fort',
    ]);
    expect(fotoQueue.pausiereUploadQueue).toHaveBeenCalledTimes(1);
    expect(fotoQueue.setzeUploadQueueFort).toHaveBeenCalledTimes(1);
  });

  it('Abbruch im Mitnahme-Dialog → auth/cancelled, nichts angefasst', async () => {
    hatMock.mockResolvedValue(true);
    wahl = 'abbrechen';
    const anmelden = wechselNach();

    await expect(inBestehendesKontoWechseln({ anmelden })).rejects.toMatchObject({ code: 'auth/cancelled' });

    expect(anmelden).not.toHaveBeenCalled();
    expect(vorbereitenMock).not.toHaveBeenCalled();
    expect(bonQueue.pausiereBonQueue).not.toHaveBeenCalled();
    expect(authMock.currentUser.uid).toBe('gast-A');
  });

  it('Abbruch im alten Konto-Dialog (ohne Bestand) → ebenfalls auth/cancelled', async () => {
    wahl = 'abbrechen';
    const anmelden = wechselNach();
    await expect(inBestehendesKontoWechseln({ anmelden })).rejects.toMatchObject({ code: 'auth/cancelled' });
    expect(alertMock.mock.calls[0][0]).toBe('Du hast bereits ein Konto');
    expect(anmelden).not.toHaveBeenCalled();
  });

  it('Bestand, aber Ticket nicht gesichert → auth/konto-umzug-offline, KEIN Wechsel', async () => {
    hatMock.mockResolvedValue(true);
    vorbereitenMock.mockResolvedValue(false);
    const anmelden = wechselNach();

    const fehler = await inBestehendesKontoWechseln({ anmelden }).catch((e) => e);

    expect(fehler).toMatchObject({ code: KONTO_UMZUG_OFFLINE });
    expect(fehler.message.length).toBeLessThan(140);
    expect(anmelden).not.toHaveBeenCalled();
    expect(zielMerkenMock).not.toHaveBeenCalled();
    expect(authMock.currentUser.uid).toBe('gast-A');
    erwarteFortgesetzt();
  });

  it('ohne Bestand und ohne Ticket → Anmeldung läuft trotzdem, aber kein Ziel wird gemerkt', async () => {
    authMock.currentUser = gast(10 * 60 * 1000); // frisch → keine Rückfrage
    vorbereitenMock.mockResolvedValue(false);
    const anmelden = wechselNach();

    await expect(inBestehendesKontoWechseln({ anmelden })).resolves.toBe('ergebnis');

    expect(alertMock).not.toHaveBeenCalled();
    expect(vorbereitenMock).toHaveBeenCalledWith('gast-A');
    expect(anmelden).toHaveBeenCalledTimes(1);
    expect(zielMerkenMock).not.toHaveBeenCalled();
    expect(einloesenMock).not.toHaveBeenCalled();
    erwarteFortgesetzt();
  });

  it('ohne Bestand und offline → kein Warten auf Netzversuche', async () => {
    (isOnline as jest.Mock).mockReturnValue(false);
    await inBestehendesKontoWechseln({ dialogUeberspringen: true, anmelden: wechselNach() });
    expect(vorbereitenMock).not.toHaveBeenCalled();
    expect(zielMerkenMock).not.toHaveBeenCalled();
  });

  it('mit Bestand wird das Ticket auch bei scheinbar fehlendem Netz versucht', async () => {
    hatMock.mockResolvedValue(true);
    (isOnline as jest.Mock).mockReturnValue(false);
    await inBestehendesKontoWechseln({ anmelden: wechselNach() });
    expect(vorbereitenMock).toHaveBeenCalledWith('gast-A');
  });

  it('dialogUeberspringen ohne Bestand → kein Dialog (Facebook-Sheet hat bestätigt)', async () => {
    await inBestehendesKontoWechseln({ dialogUeberspringen: true, anmelden: wechselNach() });
    expect(alertMock).not.toHaveBeenCalled();
    expect(zielMerkenMock).toHaveBeenCalledWith('gast-A', 'konto-B');
  });

  it('Anmeldung scheitert → Fehler kommt durch, Warteschlangen laufen weiter, kein Ziel', async () => {
    hatMock.mockResolvedValue(true);
    const anmelden = jest.fn(async () => {
      const e: any = new Error('falsch');
      e.code = 'auth/wrong-password';
      throw e;
    });

    await expect(inBestehendesKontoWechseln({ anmelden })).rejects.toMatchObject({
      code: 'auth/wrong-password',
    });
    expect(zielMerkenMock).not.toHaveBeenCalled();
    expect(einloesenMock).not.toHaveBeenCalled();
    erwarteFortgesetzt();
  });

  it('gleiche uid nach der Anmeldung → kein Ziel gemerkt', async () => {
    const anmelden = jest.fn(async () => 'ergebnis'); // uid bleibt gast-A
    await inBestehendesKontoWechseln({ dialogUeberspringen: true, anmelden });
    expect(zielMerkenMock).not.toHaveBeenCalled();
  });

  it('Fehler beim Merken des Ziels lässt die gelungene Anmeldung stehen', async () => {
    zielMerkenMock.mockRejectedValueOnce(new Error('SecureStore'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      inBestehendesKontoWechseln({ dialogUeberspringen: true, anmelden: wechselNach() }),
    ).resolves.toBe('ergebnis');
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
    wahl = 'abbrechen';
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
