/**
 * Regressionstests für die zwei Verhaltensänderungen am Bewertungs-Gate
 * (August 2026):
 *
 *  1. `hasRated_<uid>` ist keine LEBENSSPERRE mehr. Der Schlüssel bedeutet
 *     „hat unser altes Modal beantwortet", nicht „hat im Store bewertet" —
 *     der positive Zweig führte nur auf einen Store-Deeplink, den die
 *     meisten nie abschlossen. Trotzdem sperrte er beide Auto-Pfade für
 *     immer; betroffen waren 4.782 Nutzer, also gerade die aktivsten.
 *
 *  2. `blockingReason()` liefert den GRUND statt nur true/false. Ohne ihn
 *     ließ sich nicht unterscheiden, ob ein Nutzer am Budget, an einer
 *     alten Antwort oder an einem Cooldown hängt — und damit auch nicht,
 *     welche Stellschraube überhaupt etwas bringt.
 *
 * Beides ist reine Storage-Logik und hier ohne Firestore/Native testbar.
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
    multiSet: jest.fn((pairs: [string, string][]) => {
      pairs.forEach(([k, v]) => (store[k] = v));
      return Promise.resolve();
    }),
    multiRemove: jest.fn((keys: string[]) => {
      keys.forEach((k) => delete store[k]);
      return Promise.resolve();
    }),
    getAllKeys: jest.fn(() => Promise.resolve(Object.keys(store))),
  },
}));

// Diese Jest-Projektkonfiguration transformiert `react-native` nicht
// (die Suiten hier laufen bewusst ohne RN-Transform). ratingPrompt
// importiert AppState/Platform statisch — Projekt-Regel, dynamische
// react-native-Imports crashen zur Laufzeit über metroImportAll.
// Deshalb hier ein schlanker Modul-Stub statt eines Config-Umbaus.
// Das Versions-Gate liest die native App-Version. Fest verdrahtet,
// damit der Test nicht von der echten app.json abhängt.
const TEST_VERSION = '6.0.12';
jest.mock('expo-application', () => ({ nativeApplicationVersion: '6.0.12' }));

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
  AppState: { currentState: 'active' },
  Linking: { openURL: jest.fn(() => Promise.resolve()) },
  Platform: { OS: 'ios', select: (o: any) => o.ios },
}));

jest.mock('@react-native-firebase/firestore', () => ({
  doc: jest.fn(),
  setDoc: jest.fn(() => Promise.resolve()),
  updateDoc: jest.fn(() => Promise.resolve()),
  serverTimestamp: jest.fn(() => 'ts'),
}));
jest.mock('../../firebase', () => ({ db: {} }));
jest.mock('../coachmarkService', () => ({
  CoachmarkService: { isAnyActive: () => false },
}));
jest.mock('../sheetPresence', () => ({
  isAnySheetOpen: () => false,
  isSurveyVisible: () => false,
}));
jest.mock('../ratingTelemetry', () => ({
  RatingTelemetry: { log: jest.fn(() => Promise.resolve()), resetGuards: jest.fn(() => Promise.resolve()) },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ratingPromptService } = require('../ratingPrompt');

const UID = 'user-1';
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});

describe('hasRated ist keine Lebenssperre mehr', () => {
  it('ohne jede Antwort: kein Blocker', async () => {
    expect(await ratingPromptService.blockingReason(UID)).toBeNull();
  });

  it('frische positive Antwort blockiert (Schamfrist)', async () => {
    store[`hasRated_${UID}`] = JSON.stringify({ type: 'positive', at: Date.now() });
    expect(await ratingPromptService.blockingReason(UID)).toBe('already_rated');
  });

  it('positive Antwort älter als 30 Tage blockiert NICHT mehr', async () => {
    store[`hasRated_${UID}`] = JSON.stringify({
      type: 'positive',
      at: Date.now() - 31 * DAY,
    });
    expect(await ratingPromptService.blockingReason(UID)).toBeNull();
  });

  it('negative Antwort blockiert deutlich länger — wer unzufrieden war, wird in Ruhe gelassen', async () => {
    store[`hasRated_${UID}`] = JSON.stringify({
      type: 'negative',
      at: Date.now() - 31 * DAY,
    });
    expect(await ratingPromptService.blockingReason(UID)).toBe('already_rated');

    store[`hasRated_${UID}`] = JSON.stringify({
      type: 'negative',
      at: Date.now() - 181 * DAY,
    });
    expect(await ratingPromptService.blockingReason(UID)).toBeNull();
  });

  it('Altformat (nackter Typ ohne Datum) wird migriert statt ewig zu sperren', async () => {
    store[`hasRated_${UID}`] = 'positive';
    // Erstes Lesen migriert und stempelt auf jetzt → blockt zunächst.
    expect(await ratingPromptService.blockingReason(UID)).toBe('already_rated');

    const migrated = JSON.parse(store[`hasRated_${UID}`]);
    expect(migrated.type).toBe('positive');
    expect(typeof migrated.at).toBe('number');
    expect(migrated.at).toBeGreaterThan(0);

    // Nach Ablauf der Frist ist der Altfall frei — vorher war er es NIE.
    store[`hasRated_${UID}`] = JSON.stringify({ type: 'positive', at: migrated.at - 31 * DAY });
    expect(await ratingPromptService.blockingReason(UID)).toBeNull();
  });

  it('Altformat "negative" wird nicht versehentlich als positiv gelesen', async () => {
    store[`hasRated_${UID}`] = 'negative';
    await ratingPromptService.blockingReason(UID);
    expect(JSON.parse(store[`hasRated_${UID}`]).type).toBe('negative');
  });
});

describe('blockingReason nennt den Grund', () => {
  it('Dismiss-Cooldown', async () => {
    store[`ratingDismissedAt_${UID}`] = String(Date.now());
    expect(await ratingPromptService.blockingReason(UID)).toBe('dismiss_cooldown');
  });

  it('abgelaufener Dismiss blockiert nicht mehr', async () => {
    store[`ratingDismissedAt_${UID}`] = String(Date.now() - 61 * DAY);
    expect(await ratingPromptService.blockingReason(UID)).toBeNull();
  });

  it('Versions-Budget (geräteweit, uid-frei) — der Riegel gegen Logout-Umgehung', async () => {
    store['nativeReviewAskedVersion_global'] = TEST_VERSION;
    expect(await ratingPromptService.blockingReason(UID)).toBe('version_budget');
  });

  it('14-Tage-Cooldown nach einer Anfrage', async () => {
    store[`nativeReviewAskedAt_${UID}`] = String(Date.now() - 2 * DAY);
    expect(await ratingPromptService.blockingReason(UID)).toBe('ask_cooldown');
  });

  it('Reihenfolge: eine alte Antwort schlägt das Budget — der Grund ist der ERSTE Treffer', async () => {
    store[`hasRated_${UID}`] = JSON.stringify({ type: 'negative', at: Date.now() });
    store['nativeReviewAskedVersion_global'] = 'irgendwas';
    expect(await ratingPromptService.blockingReason(UID)).toBe('already_rated');
  });

  it('canRequestNativeReview bleibt das boolesche Gegenstück', async () => {
    expect(await ratingPromptService.canRequestNativeReview(UID)).toBe(true);
    store[`hasRated_${UID}`] = JSON.stringify({ type: 'positive', at: Date.now() });
    expect(await ratingPromptService.canRequestNativeReview(UID)).toBe(false);
  });
});
