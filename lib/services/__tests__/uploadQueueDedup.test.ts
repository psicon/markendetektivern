/**
 * Ein Produkt-Slot, EIN Warteschlangen-Auftrag (Vorfall 10.09.2026).
 *
 * Der Einreichen-Knopf gab im ausgelieferten Stand bis zu vier Sekunden lang
 * keinerlei Rückmeldung (Standort + Aktionsauflösung), war aber nicht gesperrt.
 * Jeder weitere Tipp legte einen EIGENEN Auftrag an, kopierte sieben Dateien
 * und lud sie erneut hoch — daher die byteidentischen Kopien im Abstand von
 * 10–13 Sekunden (das ist die Laufzeit EINES Auftrags, keine Frist).
 *
 * Die Oberflächensperre und die deterministische Doc-ID verhindern das doppelte
 * DOKUMENT; dieser Riegel spart zusätzlich die doppelte ARBEIT.
 */

const speicher: Record<string, string> = {};
const SCHLUESSEL = 'product_upload_queue_v1';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => speicher[k] ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      speicher[k] = v;
    }),
    removeItem: jest.fn(async (k: string) => {
      delete speicher[k];
    }),
  },
}));
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///doc/',
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(async () => ({ exists: true })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  copyAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
}));
jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })), currentState: 'active' },
}));
jest.mock('../network', () => ({
  // Dauerhaft offline: dann rührt processQueue die Aufträge nicht an und der
  // Test misst die Warteschlange selbst, nicht den Upload.
  isOnline: jest.fn(() => false),
  refreshNetwork: jest.fn(async () => false),
  subscribeNetwork: jest.fn(() => jest.fn()),
}));
jest.mock('../productSubmit', () => ({
  submitProduct: jest.fn(async () => 'u1_sess_1'),
  uploadProductImage: jest.fn(async () => 'crowduploads/u1/sess/produkt_1/images/front_x.jpg'),
}));
jest.mock('../ui/toast', () => ({ showInfoToast: jest.fn() }));
// Seit Stufe 1 (25.09.2026) fragt die Warteschlange die angemeldete uid und
// die bestätigte Gast-Übernahme ab; beides ist hier ohne Belang.
jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: { uid: 'u1', isAnonymous: false, providerData: [{ providerId: 'password' }] } },
}));
jest.mock('../gastUebernahme', () => ({
  GastUebernahme: { zielVon: jest.fn(() => null), beiAenderung: jest.fn(() => jest.fn()) },
}));
jest.mock('../gastBestand', () => ({ GastBestand: { merke: jest.fn(async () => undefined) } }));

import * as FileSystem from 'expo-file-system';

type Queue = typeof import('../uploadQueue');

const EINGABE = {
  uid: 'u1',
  sessionId: '94ea55c3fd9caddfbce6bd1c',
  productIndex: 3,
  marketId: null,
  marketName: 'Kaufland',
  marketLand: 'DE',
  productName: 'Sinnack Kaiser Brötchen',
  ean: '4009097010684',
  campaignId: 'produkt-fotos-september-2026',
  steps: [
    { key: 'front' as const, uri: 'file:///cache/front.jpg', fileName: 'front_a.jpg' },
    { key: 'rueckseite' as const, uri: 'file:///cache/rueck.jpg', fileName: 'rueckseite_a.jpg' },
  ],
  capture: null,
  clientVersion: null,
};

/**
 * Frisches Modul je Test — die Warteschlange hält ihren Zustand auf Modul-
 * Ebene, sonst trüge ein Test den Stand des vorigen mit.
 */
function frischeQueue(vorbelegung?: unknown[]): Queue {
  for (const k of Object.keys(speicher)) delete speicher[k];
  if (vorbelegung) speicher[SCHLUESSEL] = JSON.stringify(vorbelegung);
  let q: Queue;
  jest.isolateModules(() => {
    q = require('../uploadQueue');
  });
  return q!;
}

/** Aktueller Stand über das öffentliche Abonnement (feuert asynchron). */
function auftraege(q: Queue): Promise<any[]> {
  return new Promise((res) => {
    const ab = q.subscribeUploadQueue((jobs) => {
      ab();
      res(jobs as any[]);
    });
  });
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  (FileSystem.copyAsync as jest.Mock).mockClear();
});
afterEach(() => jest.restoreAllMocks());

test('zweiter Tipp auf denselben Slot erzeugt keinen zweiten Auftrag', async () => {
  const q = frischeQueue();
  const ersteId = await q.enqueueProductUpload(EINGABE as never);
  const kopienNachErstem = (FileSystem.copyAsync as jest.Mock).mock.calls.length;
  expect(kopienNachErstem).toBe(EINGABE.steps.length);

  // Zweiter Tipp, neue Dateinamen (jeder doSubmit prägt einen eigenen
  // Bild-Token) — es bleibt trotzdem derselbe Auftrag mit dem ersten Bildsatz.
  const zweiteId = await q.enqueueProductUpload({
    ...EINGABE,
    steps: EINGABE.steps.map((s) => ({ ...s, fileName: s.fileName.replace('_a', '_b') })),
  } as never);

  expect(zweiteId).toBe(ersteId);
  expect(await auftraege(q)).toHaveLength(1);
  // Keine zweite Runde Dateikopien — das ist der eingesparte Aufwand.
  expect((FileSystem.copyAsync as jest.Mock).mock.calls.length).toBe(kopienNachErstem);
});

test('ein anderer Produkt-Slot derselben Sitzung bleibt ein eigener Auftrag', async () => {
  // Sonst verschluckte der Riegel echte zweite Produkte im selben Markt.
  const q = frischeQueue();
  const id3 = await q.enqueueProductUpload(EINGABE as never);
  const id4 = await q.enqueueProductUpload({ ...EINGABE, productIndex: 4 } as never);
  expect(id4).not.toBe(id3);
  expect(await auftraege(q)).toHaveLength(2);
});

test('eine andere Wizard-Sitzung teilt sich keinen Auftrag', async () => {
  // Der Schlüssel ist seit Stufe 1 Sitzung + Slot, ohne uid (derselbe Slot
  // bleibt derselbe Auftrag, auch wenn aus dem Gast ein Konto wurde — siehe
  // gastQueue.test.ts). Getrennt werden Personen über die Zufalls-sessionId.
  const q = frischeQueue();
  const a = await q.enqueueProductUpload(EINGABE as never);
  const b = await q.enqueueProductUpload({ ...EINGABE, uid: 'u2', sessionId: 'c0ffee00c0ffee00c0ffee00' } as never);
  expect(b).not.toBe(a);
  expect(await auftraege(q)).toHaveLength(2);
});

test('ein gescheiterter Auftrag wird durch erneutes Einreichen wieder aufgenommen', async () => {
  // Ohne das täte der Tipp bei erschöpftem Auto-Versuchsvorrat sichtbar nichts.
  const q = frischeQueue([
    {
      id: 'alt1',
      uid: EINGABE.uid,
      sessionId: EINGABE.sessionId,
      productIndex: EINGABE.productIndex,
      steps: [],
      status: 'failed',
      progress: 0,
      attempts: 5,
      lastError: 'boom',
      createdAt: 1,
      capture: null,
      clientVersion: null,
      campaignResolve: null,
    },
  ]);

  const wieder = await q.enqueueProductUpload(EINGABE as never);
  expect(wieder).toBe('alt1');
  const stand = await auftraege(q);
  expect(stand).toHaveLength(1);
  expect(stand[0].status).toBe('queued');
  expect(stand[0].attempts).toBe(0);
  expect(stand[0].lastError).toBeNull();
});
