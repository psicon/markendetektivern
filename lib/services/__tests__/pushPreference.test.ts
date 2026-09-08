/**
 * Die Push-Einstellung muss halten, was der Schalter verspricht (86cbfdq5j).
 *
 * Der Befund, der zu diesen Tests führte: der Schalter unter
 * /notification-settings tat nichts. Er räumte die rote Zahl nicht weg, er
 * war je nach Sitzung ein kompletter Nichtstuer, er stoppte keine einzige
 * Nachricht, und beim nächsten Wechsel in den Vordergrund stand er wieder
 * auf AN. Vier Defekte übereinander — hier ist festgehalten, dass keiner
 * davon zurückkommt.
 */

const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
    setItem: jest.fn((k: string, v: string) => {
      store[k] = v;
      return Promise.resolve();
    }),
    removeItem: jest.fn((k: string) => {
      delete store[k];
      return Promise.resolve();
    }),
  },
}));

// Firestore: Schreibvorgänge mitschneiden statt ausführen. `schreibFehler`
// erlaubt es, den Fall „Abgleich kam nie durch" nachzustellen.
const writes: { path: string; data: any; merge: boolean }[] = [];
let schreibFehler: Error | null = null;
jest.mock('@react-native-firebase/firestore', () => ({
  doc: (_db: any, ...seg: string[]) => ({ __path: seg.join('/') }),
  setDoc: jest.fn((ref: any, data: any, opts: any) => {
    if (schreibFehler) return Promise.reject(schreibFehler);
    writes.push({ path: ref.__path, data, merge: !!opts?.merge });
    return Promise.resolve();
  }),
}));
jest.mock('@/lib/firebase', () => ({ db: {} }));

const UID = 'user-1';
const PREF_KEY = 'push_pref_v1';
const PENDING_KEY = 'push_pref_pending_v1';

function reset() {
  for (const k of Object.keys(store)) delete store[k];
  writes.length = 0;
  schreibFehler = null;
  jest.resetModules();
}

/**
 * Die fire-and-forget-Spiegelung durchlaufen lassen.
 *
 * Bewusst über Microtasks statt `setImmediate`: dessen Typ zieht
 * `@types/node` ins Programm, und dann gewinnt bei `setTimeout` projektweit
 * mal Node (`Timeout`), mal React Native (`number`) — mit 14 neuen
 * tsc-Fehlern in Dateien, die niemand angefasst hat (die in CLAUDE.md
 * beschriebene Drift).
 */
const gleichLaufenLassen = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** Der lokale Wert liegt als JSON mit Kontokennung vor. */
const lokalerWert = () => JSON.parse(store[PREF_KEY]).wert;
const lokalesKonto = () => JSON.parse(store[PREF_KEY]).uid;

describe('Push-Einstellung', () => {
  beforeEach(reset);

  test('ohne gespeicherten Wert gilt AN — niemand hat abbestellt, bis er es tut', async () => {
    const { getPushPreference } = require('../pushPreference');
    await expect(getPushPreference()).resolves.toBe(true);
  });

  test('Abbestellen wird lokal gespeichert und überlebt den Neustart', async () => {
    const { setPushPreference, getPushPreference } = require('../pushPreference');
    await setPushPreference(UID, false);
    expect(lokalerWert()).toBe(false);
    expect(lokalesKonto()).toBe(UID);

    // Neustart: Modul frisch laden, Speicher bleibt.
    jest.resetModules();
    const frisch = require('../pushPreference');
    await expect(frisch.getPushPreference()).resolves.toBe(false);
  });

  test('Abbestellen landet im Nutzerdokument — das liest der Server', async () => {
    // Der Kern des Fehlers: bis 08.09.2026 kam dieses Feld je nach Sitzung
    // gar nicht an, weil ein `if (this.pushToken)` davorstand.
    const { setPushPreference } = require('../pushPreference');
    await setPushPreference(UID, false);
    await gleichLaufenLassen();

    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(`users/${UID}`);
    expect(writes[0].data).toEqual({ pushNotificationsEnabled: false });
    expect(writes[0].merge).toBe(true);
  });

  test('Wiedereinschalten schreibt true', async () => {
    const { setPushPreference, getPushPreference } = require('../pushPreference');
    await setPushPreference(UID, false);
    await setPushPreference(UID, true);
    await gleichLaufenLassen();
    await expect(getPushPreference()).resolves.toBe(true);
    expect(writes[writes.length - 1].data).toEqual({ pushNotificationsEnabled: true });
  });

  test('ohne angemeldeten Nutzer bleibt die Entscheidung trotzdem auf dem Gerät', async () => {
    const { setPushPreference, getPushPreference } = require('../pushPreference');
    await setPushPreference(null, false);
    await gleichLaufenLassen();
    await expect(getPushPreference()).resolves.toBe(false);
    expect(writes).toHaveLength(0);
  });

  test('ein gescheiterter Abgleich hinterlässt einen Merker', async () => {
    schreibFehler = new Error('kein Netz');
    const { setPushPreference } = require('../pushPreference');
    await setPushPreference(UID, false);
    await gleichLaufenLassen();

    // Lokal steht die Entscheidung, der Server weiß noch nichts.
    expect(lokalerWert()).toBe(false);
    expect(store[PENDING_KEY]).toBe('aus');
    expect(writes).toHaveLength(0);
  });

  test('ohne uid bleibt trotzdem ein Merker liegen', async () => {
    // Der teure Fall: Umschalten in einer Phase ohne aufgelösten Nutzer
    // (Anmelde-Übergang, Boot-Race). Vorher verschwand die Entscheidung
    // spurlos — kein Schreibvorgang und nichts zum Nachholen.
    const { setPushPreference } = require('../pushPreference');
    await setPushPreference(null, false);
    await gleichLaufenLassen();
    expect(store[PENDING_KEY]).toBe('aus');
    expect(writes).toHaveLength(0);
  });

});

describe('Abgleich mit dem Server — der Server hat recht, außer man hat gerade selbst geschaltet', () => {
  beforeEach(reset);

  test('eine Abbestellung vom anderen Gerät setzt sich durch', async () => {
    // DER Fall, der sonst still danebengeht: auf dem Tablet abbestellt,
    // Handy neu installiert. Lokal steht nichts, der Schalter zeigte „Aktiv",
    // und der Server sendete dauerhaft nichts — ohne dass es jemandem
    // auffiele.
    const { abgleichenMitServer, getPushPreference } = require('../pushPreference');
    await expect(abgleichenMitServer(UID, false)).resolves.toBe(false);
    await expect(getPushPreference()).resolves.toBe(false);
  });

  test('ein true vom Server hebt eine veraltete lokale Abbestellung auf', async () => {
    const { setPushPreference, abgleichenMitServer } = require('../pushPreference');
    await setPushPreference(UID, false);
    await gleichLaufenLassen();
    writes.length = 0;
    // Auf einem anderen Gerät wieder eingeschaltet.
    await expect(abgleichenMitServer(UID, true)).resolves.toBe(true);
    expect(lokalerWert()).toBe(true);
  });

  test('eine noch nicht übertragene eigene Entscheidung gewinnt gegen den alten Serverstand', async () => {
    // Sonst überschriebe der Abgleich beim nächsten Start genau die
    // Abbestellung, die im Funkloch getroffen wurde.
    schreibFehler = new Error('kein Netz');
    const { setPushPreference } = require('../pushPreference');
    await setPushPreference(UID, false);
    await gleichLaufenLassen();

    schreibFehler = null;
    jest.resetModules();
    const { abgleichenMitServer } = require('../pushPreference');
    await expect(abgleichenMitServer(UID, true)).resolves.toBe(false);
    await gleichLaufenLassen();

    // Und wird dabei nachgetragen.
    expect(writes).toHaveLength(1);
    expect(writes[0].data).toEqual({ pushNotificationsEnabled: false });
    expect(store[PENDING_KEY]).toBeUndefined();
  });

  test('kennt der Server das Feld nicht, wird eine lokale Abbestellung nachgetragen', async () => {
    // Etwa aus einer Sitzung, in der noch keine uid feststand.
    store[PREF_KEY] = 'aus';
    const { abgleichenMitServer } = require('../pushPreference');
    await expect(abgleichenMitServer(UID, undefined)).resolves.toBe(false);
    await gleichLaufenLassen();
    expect(writes).toHaveLength(1);
    expect(writes[0].data).toEqual({ pushNotificationsEnabled: false });
  });

  test('kennt der Server das Feld nicht und lokal steht AN, passiert nichts', async () => {
    // Der Normalfall für 283.728 von 283.756 Konten — er darf nichts kosten.
    const { abgleichenMitServer } = require('../pushPreference');
    await expect(abgleichenMitServer(UID, undefined)).resolves.toBe(true);
    await gleichLaufenLassen();
    expect(writes).toHaveLength(0);
  });

  test('ohne uid wird nur der lokale Stand gemeldet', async () => {
    store[PREF_KEY] = 'aus';
    const { abgleichenMitServer } = require('../pushPreference');
    await expect(abgleichenMitServer(null, true)).resolves.toBe(false);
    await gleichLaufenLassen();
    expect(writes).toHaveLength(0);
  });

  test('eine Abbestellung von einem ANDEREN Konto greift nicht über', async () => {
    // Familien-Gerät: A bestellt ab, meldet sich ab, B meldet sich an. Ohne
    // Kontobindung schriebe der Nachtrag-Zweig B ein `false`, das B nie
    // gewählt hat — und B bekäme nie wieder eine Nachricht, ohne je einen
    // Schalter berührt zu haben.
    const { setPushPreference, abgleichenMitServer } = require('../pushPreference');
    await setPushPreference('konto-A', false);
    await gleichLaufenLassen();
    writes.length = 0;

    // B: Server kennt das Feld nicht (wie bei 283.728 von 283.756 Konten).
    await expect(abgleichenMitServer('konto-B', undefined)).resolves.toBe(true);
    await gleichLaufenLassen();
    expect(writes).toHaveLength(0);
  });

  test('auch ein offener Merker wandert nicht auf ein fremdes Konto', async () => {
    schreibFehler = new Error('kein Netz');
    const { setPushPreference } = require('../pushPreference');
    await setPushPreference('konto-A', false);
    await gleichLaufenLassen();
    expect(store[PENDING_KEY]).toBe('aus');

    schreibFehler = null;
    jest.resetModules();
    const { abgleichenMitServer } = require('../pushPreference');
    await expect(abgleichenMitServer('konto-B', undefined)).resolves.toBe(true);
    await gleichLaufenLassen();
    expect(writes).toHaveLength(0);
    // Und er bleibt nicht liegen, sonst käme er beim nächsten Start doch.
    expect(store[PENDING_KEY]).toBeUndefined();
  });

  test('die eigene Entscheidung desselben Kontos zählt weiter', async () => {
    const { setPushPreference, abgleichenMitServer } = require('../pushPreference');
    await setPushPreference(UID, false);
    await gleichLaufenLassen();
    writes.length = 0;
    await expect(abgleichenMitServer(UID, undefined)).resolves.toBe(false);
    await gleichLaufenLassen();
    expect(writes).toHaveLength(1);
  });

  test('eine Entscheidung ohne Kennung gilt für das Konto, das sich danach anmeldet', async () => {
    // Der Anmelde-Übergang: umgeschaltet, bevor die Kennung feststand.
    const { setPushPreference, abgleichenMitServer } = require('../pushPreference');
    await setPushPreference(null, false);
    await gleichLaufenLassen();
    await expect(abgleichenMitServer(UID, undefined)).resolves.toBe(false);
    await gleichLaufenLassen();
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(`users/${UID}`);
  });

  test('wahrheitsähnliche Serverwerte zählen nicht als Aussage', async () => {
    // Ein 0 oder '' im Feld wäre ein Datenfehler, keine Abbestellung.
    const { abgleichenMitServer } = require('../pushPreference');
    await expect(abgleichenMitServer(UID, 0)).resolves.toBe(true);
    await expect(abgleichenMitServer(UID, 'false')).resolves.toBe(true);
    await expect(abgleichenMitServer(UID, null)).resolves.toBe(true);
  });
});
