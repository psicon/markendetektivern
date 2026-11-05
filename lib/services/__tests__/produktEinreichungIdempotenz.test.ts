/**
 * Doppel-Einreichungen von Produktfotos (Vorfall 10.09.2026).
 *
 * ═══ Was hier festgenagelt wird ═══
 *
 * Drei Nutzer erzeugten je 2–3 byteidentische Kopien derselben Einreichung:
 * gleicher Session-Ordner, gleicher Produkt-Slot, gleiches `capturedAt`, nur
 * je ein neuer Bild-Token. Abgelehnt wurde daraufhin JEDE Kopie — auch die
 * erste, korrekte. Niemand bekam etwas.
 *
 * Ausgelöst hat es der Einreichen-Knopf, der im ausgelieferten Stand nur gegen
 * unvollständige Fotos gesperrt war; der DEFEKT war aber, dass `addDoc` bei
 * jedem Aufruf eine neue Zufalls-ID prägt — es gab keinen Schlüssel, an dem
 * ein zweiter Schreibvorgang scheitern konnte.
 *
 * Zwei Ebenen, zwei Tests:
 *   1. `submitProduct` schreibt auf eine DETERMINISTISCHE ID. Der zweite
 *      Schreibvorgang ist damit ein `update` und wird von `firestore.rules`
 *      (`allow update, delete: if false`) abgelehnt — „der erste gewinnt" ist
 *      serverseitig erzwungen, nicht Client-Disziplin.
 *   2. `enqueueProductUpload` erzeugt für denselben Slot nur EINEN Auftrag,
 *      spart also sieben Dateikopien und sieben Uploads pro Extra-Tipp.
 */

// ─── 1. Idempotenz des Firestore-Schreibvorgangs ──────────────────────

describe('submitProduct — ein Produkt-Slot, ein Dokument', () => {
  jest.mock('@react-native-firebase/firestore', () =>
    require('./__helpers__/rnfirestoreMock').createFirestoreMock(),
  );
  jest.mock('@react-native-firebase/storage', () => ({
    ref: jest.fn((_s: unknown, p: string) => ({ path: p })),
    putFile: jest.fn(() => ({ on: jest.fn(), cancel: jest.fn() })),
  }));
  // productSubmit zieht über die Upload-Prüfung expo-file-system nach.
  jest.mock('expo-file-system', () => ({ getInfoAsync: jest.fn(async () => ({ exists: false })) }));
  jest.mock('@/lib/firebase', () => ({
    db: { __mockDb: true },
    storage: { __mockStorage: true },
    auth: { currentUser: { uid: 'u1' } },
  }));
  jest.mock('@/lib/services/cashbackService', () => ({
    getActiveCashbackCampaigns: jest.fn(async () => []),
    getActiveCashbackCampaignsStrict: jest.fn(async () => []),
    getCashbackConfig: jest.fn(async () => ({ campaignsEnabled: false })),
    getCashbackConfigStrict: jest.fn(async () => ({ campaignsEnabled: false })),
  }));
  jest.mock('@/lib/services/productCampaignChoice', () => ({
    getChosenProductCampaignId: jest.fn(async () => null),
  }));
  jest.mock('@/lib/services/journeyTrackingService', () => ({
    __esModule: true,
    default: { getCurrentJourneyId: () => null, getCurrentJourneyLocation: () => null },
  }));

  /* eslint-disable @typescript-eslint/no-var-requires */
  const { addDoc, doc, getDoc, setDoc } = require('@react-native-firebase/firestore');
  const { makeDocSnapshot } = require('./__helpers__/rnfirestoreMock');
  const { submitProduct, productSubmissionDocId } = require('../productSubmit');
  /* eslint-enable @typescript-eslint/no-var-requires */

  const EINGABE = {
    sessionId: '94ea55c3fd9caddfbce6bd1c',
    productIndex: 3,
    marketId: null,
    marketName: 'Kaufland',
    images: { front: 'crowduploads/u1/94ea55c3fd9caddfbce6bd1c/produkt_3/images/front_a.jpg' },
  };
  /** Die echten Pfade der drei Vorfälle fielen auf genau einen Schlüssel. */
  const ERWARTETE_ID = 'u1_94ea55c3fd9caddfbce6bd1c_3';

  const crowdPfade = () =>
    (doc as jest.Mock).mock.calls
      .map((c: unknown[]) => c.slice(1).join('/'))
      .filter((p: string) => p.startsWith('crowd_uploads/'));

  /**
   * Pfad-bewusster Lesevorgang. `mockResolvedValueOnce` taugt hier NICHT:
   * `collectContext` liest vorher schon `users/{uid}` und verbrauchte das
   * Once — der Bestätigungs-Read bekäme dann den Standardwert.
   */
  let crowdDocExistiert = false;
  let crowdReads = 0;

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    (doc as jest.Mock).mockClear();
    (setDoc as jest.Mock).mockClear();
    (addDoc as jest.Mock).mockClear();
    crowdDocExistiert = false;
    crowdReads = 0;
    (getDoc as jest.Mock).mockImplementation(async (ref: { path?: string }) => {
      if (String(ref?.path ?? '').startsWith('crowd_uploads/')) {
        crowdReads += 1;
        return makeDocSnapshot(crowdDocExistiert ? { userId: 'u1' } : undefined, ERWARTETE_ID);
      }
      return makeDocSnapshot(undefined);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  test('der Schlüssel ist der Produkt-Slot der Sitzung', () => {
    expect(productSubmissionDocId('u1', '94ea55c3fd9caddfbce6bd1c', 3)).toBe(ERWARTETE_ID);
    // Verschiedene Slots derselben Sitzung bleiben verschieden — sonst
    // verschluckte der Fix echte zweite Produkte.
    expect(productSubmissionDocId('u1', '94ea55c3fd9caddfbce6bd1c', 4)).not.toBe(ERWARTETE_ID);
    // Anderes Konto, gleicher Slot: eigener Schlüssel.
    expect(productSubmissionDocId('u2', '94ea55c3fd9caddfbce6bd1c', 3)).not.toBe(ERWARTETE_ID);
  });

  test('ohne verwertbaren Schlüssel wird NICHT idempotent geschrieben', () => {
    // Eine Dublette ist das kleinere Übel als eine verlorene Einreichung:
    // zwei verschiedene Einreichungen dürfen nie auf derselben ID landen.
    const a = productSubmissionDocId('u1', '', 3);
    const b = productSubmissionDocId('u1', '', 3);
    expect(a).not.toBe(b);
    expect(a.startsWith('fallback_')).toBe(true);
    // Und kein Schrägstrich im Schlüssel — der ergäbe einen verschachtelten
    // Pfad statt einer Dokument-ID.
    expect(productSubmissionDocId('u1', 'sess/../andere', 3)).not.toContain('/');
  });

  test('zweiter Lauf desselben Slots schreibt KEIN zweites Dokument', async () => {
    const ersteId = await submitProduct('u1', EINGABE as never);
    expect(ersteId).toBe(ERWARTETE_ID);

    // Der zweite Lauf trifft dieselbe ID; die Regeln lehnen ihn als `update`
    // ab. Der Client muss das als „liegt schon vor" verbuchen, nicht als
    // Fehler — und sich das per Lesevorgang BESTÄTIGEN lassen.
    (setDoc as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { code: 'firestore/permission-denied' }),
    );
    crowdDocExistiert = true;

    const zweiteId = await submitProduct('u1', EINGABE as never);

    expect(zweiteId).toBe(ersteId);
    expect(addDoc).not.toHaveBeenCalled();
    expect(new Set(crowdPfade()).size).toBe(1);
    expect(crowdPfade()[0]).toBe(`crowd_uploads/${ERWARTETE_ID}`);
  });

  test('eine Ablehnung ohne vorhandenes Dokument wird NICHT als Erfolg verbucht', async () => {
    // Abgelaufene Anmeldung o.ä.: hier darf die Einreichung nicht lautlos
    // verschwinden — sonst entsteht genau wieder „freigegeben, 0 Cent".
    (setDoc as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { code: 'firestore/permission-denied' }),
    );
    crowdDocExistiert = false;
    await expect(submitProduct('u1', EINGABE as never)).rejects.toThrow(/permission/i);
    expect(crowdReads).toBe(1); // es WURDE nachgesehen, nicht blind geworfen
  });

  test('jeder andere Fehler wird weitergeworfen', async () => {
    (setDoc as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('unavailable'), { code: 'firestore/unavailable' }),
    );
    await expect(submitProduct('u1', EINGABE as never)).rejects.toThrow(/unavailable/i);
    // Kein Bestätigungs-Read bei einem Fehler, der nichts mit den Regeln zu
    // tun hat — der kostet sonst bei jedem Netzproblem einen Firestore-Read.
    expect(crowdReads).toBe(0);
  });
});
