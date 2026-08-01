/**
 * firstCaseService — "Erster Fall geschlossen" → nativer Review
 * (ClickUp 86cav7gqm).
 *
 * Kernverhalten, das hier abgesichert wird: ein Abbruch der Gate-Kette
 * darf NIEMALS etwas verbrauchen. Genau daran scheiterte der
 * Vorgänger-Ansatz (ein Armed-Flag, das auch dann als benutzt galt,
 * wenn der Prompt nie erschien) — wer beim ersten Treffer noch in der
 * Tour steckte, verlor den Trigger dauerhaft.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __store: () => store,
    __reset: () => {
      store = {};
    },
    getItem: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
    setItem: jest.fn((k: string, v: string) => {
      store[k] = v;
      return Promise.resolve();
    }),
    multiRemove: jest.fn((keys: string[]) => {
      keys.forEach((k) => delete store[k]);
      return Promise.resolve();
    }),
    multiSet: jest.fn((pairs: [string, string][]) => {
      pairs.forEach(([k, v]) => {
        store[k] = v;
      });
      return Promise.resolve();
    }),
    removeItem: jest.fn((k: string) => {
      delete store[k];
      return Promise.resolve();
    }),
  };
});

// CoachmarkService: nur die Walk-Through-Frage ist relevant.
const mockHasCompletedIntroTours = jest.fn<Promise<boolean>, []>();
jest.mock('../coachmarkService', () => ({
  CoachmarkService: {
    hasCompletedIntroTours: () => mockHasCompletedIntroTours(),
    isAnyActive: () => false,
  },
}));

// ratingPromptService: Gates + der eigentliche Request.
const mockCanRequest = jest.fn<Promise<boolean>, [string]>();
const mockRequestNow = jest.fn<Promise<boolean>, [string]>();
jest.mock('../ratingPrompt', () => ({
  ratingPromptService: {
    canRequestNativeReview: (uid: string) => mockCanRequest(uid),
    // Spiegelt canRequestNativeReview: null = frei, sonst der Grund.
    // Die Suite steuert weiterhin über mockCanRequest, damit die
    // bestehenden Fälle unverändert lesbar bleiben.
    blockingReason: async (uid: string) =>
      (await mockCanRequest(uid)) ? null : 'version_budget',
    requestNativeReviewNow: (uid: string) => mockRequestNow(uid),
  },
}));

// Telemetrie: reiner Seiteneffekt, darf den Trichter nie beeinflussen.
// Gemockt, weil der echte Service `react-native` (Platform) importiert —
// diese Suite lief bisher komplett ohne RN-Transform. Eigene Tests dafür
// stehen in ratingTelemetry.test.ts.
const mockTelemetryLog = jest.fn<Promise<void>, [any]>(() => Promise.resolve());
jest.mock('../ratingTelemetry', () => ({
  RatingTelemetry: {
    log: (input: any) => mockTelemetryLog(input),
    resetGuards: () => Promise.resolve(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { FirstCaseService } = require('../firstCaseService');

const UID = 'user-1';
const asyncStorageMock = AsyncStorage as unknown as { __reset: () => void };

beforeEach(() => {
  asyncStorageMock.__reset();
  jest.clearAllMocks();
  mockHasCompletedIntroTours.mockResolvedValue(true);
  mockCanRequest.mockResolvedValue(true);
  mockRequestNow.mockResolvedValue(true);
});

describe('markFirstCase — erstes enttarntes Produkt gesehen', () => {
  it('verbucht den ersten Fall und feuert den Bus', async () => {
    const listener = jest.fn();
    const off = FirstCaseService.onArmed(listener);
    await FirstCaseService.markFirstCase(UID);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('ist idempotent — zweiter Aufruf feuert nicht erneut', async () => {
    const listener = jest.fn();
    const off = FirstCaseService.onArmed(listener);
    await FirstCaseService.markFirstCase(UID);
    await FirstCaseService.markFirstCase(UID);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('ist ein No-op ohne uid (Anon-Sign-In noch nicht durch)', async () => {
    const listener = jest.fn();
    const off = FirstCaseService.onArmed(listener);
    await FirstCaseService.markFirstCase(null);
    expect(listener).not.toHaveBeenCalled();
    off();
  });
});

describe('shouldCelebrate — Phase 1', () => {
  it('ohne uid: false', async () => {
    expect(await FirstCaseService.shouldCelebrate(null)).toBe(false);
  });

  it('ohne Scan-Erfolg: false', async () => {
    expect(await FirstCaseService.shouldCelebrate(UID)).toBe(false);
  });

  it('Scan da, Tour offen: false — und nach der Tour true (reihenfolge-unabhängig)', async () => {
    mockHasCompletedIntroTours.mockResolvedValue(false);
    await FirstCaseService.markFirstCase(UID);
    expect(await FirstCaseService.shouldCelebrate(UID)).toBe(false);

    mockHasCompletedIntroTours.mockResolvedValue(true);
    expect(await FirstCaseService.shouldCelebrate(UID)).toBe(true);
  });

  it('Rating-Gates zu: false — die Feier wird nicht verbrannt', async () => {
    await FirstCaseService.markFirstCase(UID);
    mockCanRequest.mockResolvedValue(false);
    expect(await FirstCaseService.shouldCelebrate(UID)).toBe(false);
  });

  // Bewusste Verhaltensänderung (Aug 2026): die Feier darf sich über
  // SESSIONS hinweg wiederholen, solange der Dialog nie angefragt wurde.
  // Vorher verbrannte ein Session-Ende zwischen Banner und den 5 s bis
  // zum Dialog (Anruf, App-Kill) den Erst-Fall-Pfad DAUERHAFT — genau
  // dieser Fall traf Bestandsnutzer, deren Level-Up-Pfad längst durch ist.
  it('nach markCelebrated: weiterhin true — Session-Abbruch verbrennt den Pfad nicht', async () => {
    await FirstCaseService.markFirstCase(UID);
    expect(await FirstCaseService.shouldCelebrate(UID)).toBe(true);
    await FirstCaseService.markCelebrated(UID);
    expect(await FirstCaseService.shouldCelebrate(UID)).toBe(true);
  });

  it('nach 3 Feiern ohne Dialog: false — der Deckel greift', async () => {
    await FirstCaseService.markFirstCase(UID);
    await FirstCaseService.markCelebrated(UID);
    await FirstCaseService.markCelebrated(UID);
    expect(await FirstCaseService.shouldCelebrate(UID)).toBe(true);
    await FirstCaseService.markCelebrated(UID);
    expect(await FirstCaseService.shouldCelebrate(UID)).toBe(false);
  });

  it('nach angefragtem Dialog: false — endgültig durch', async () => {
    await FirstCaseService.markFirstCase(UID);
    await FirstCaseService.markCelebrated(UID);
    mockRequestNow.mockResolvedValue(true);
    expect(await FirstCaseService.maybeRequestReview(UID)).toBe('requested');
    expect(await FirstCaseService.shouldCelebrate(UID)).toBe(false);
  });
});

describe('maybeRequestReview — Phase 2', () => {
  it('ohne uid: no-user', async () => {
    expect(await FirstCaseService.maybeRequestReview(null)).toBe('no-user');
  });

  it('OHNE verbuchte Feier: no-celebration — kein kontextfreier Prompt', async () => {
    await FirstCaseService.markFirstCase(UID);
    expect(await FirstCaseService.maybeRequestReview(UID)).toBe('no-celebration');
    expect(mockRequestNow).not.toHaveBeenCalled();
  });

  it('nach der Feier: requested', async () => {
    await FirstCaseService.markFirstCase(UID);
    await FirstCaseService.markCelebrated(UID);
    expect(await FirstCaseService.maybeRequestReview(UID)).toBe('requested');
    expect(mockRequestNow).toHaveBeenCalledWith(UID);
  });

  it('Rating-Gates zu: gated, nichts verbraucht — späterer Versuch geht durch', async () => {
    await FirstCaseService.markFirstCase(UID);
    await FirstCaseService.markCelebrated(UID);
    mockCanRequest.mockResolvedValue(false);
    expect(await FirstCaseService.maybeRequestReview(UID)).toBe('gated');
    expect(mockRequestNow).not.toHaveBeenCalled();

    mockCanRequest.mockResolvedValue(true);
    expect(await FirstCaseService.maybeRequestReview(UID)).toBe('requested');
  });

  it('Moment passt nicht (Sheet offen / Hintergrund): unavailable, Retry bleibt möglich', async () => {
    await FirstCaseService.markFirstCase(UID);
    await FirstCaseService.markCelebrated(UID);
    mockRequestNow.mockResolvedValue(false);
    expect(await FirstCaseService.maybeRequestReview(UID)).toBe('unavailable');

    // Entscheidend: der Fehlversuch hat den Trigger NICHT verbraucht.
    mockRequestNow.mockResolvedValue(true);
    expect(await FirstCaseService.maybeRequestReview(UID)).toBe('requested');
  });

  it('nach erfolgreicher Anfrage: already — genau einmal pro User', async () => {
    await FirstCaseService.markFirstCase(UID);
    await FirstCaseService.markCelebrated(UID);
    expect(await FirstCaseService.maybeRequestReview(UID)).toBe('requested');
    expect(await FirstCaseService.maybeRequestReview(UID)).toBe('already');
    expect(mockRequestNow).toHaveBeenCalledTimes(1);
  });

  it('zwei parallele Aufrufe: genau EIN Request (inFlight-Guard)', async () => {
    await FirstCaseService.markFirstCase(UID);
    await FirstCaseService.markCelebrated(UID);
    const [a, b] = await Promise.all([
      FirstCaseService.maybeRequestReview(UID),
      FirstCaseService.maybeRequestReview(UID),
    ]);
    expect([a, b].filter((o) => o === 'requested')).toHaveLength(1);
    expect([a, b]).toContain('busy');
    expect(mockRequestNow).toHaveBeenCalledTimes(1);
  });
});

describe('reset', () => {
  it('macht Feier UND Review wieder möglich (Dev-Panel)', async () => {
    await FirstCaseService.markFirstCase(UID);
    await FirstCaseService.markCelebrated(UID);
    expect(await FirstCaseService.maybeRequestReview(UID)).toBe('requested');

    await FirstCaseService.reset(UID);
    expect(await FirstCaseService.shouldCelebrate(UID)).toBe(false); // Scan weg
    expect(await FirstCaseService.maybeRequestReview(UID)).toBe('no-celebration');

    await FirstCaseService.markFirstCase(UID);
    expect(await FirstCaseService.shouldCelebrate(UID)).toBe(true);
    await FirstCaseService.markCelebrated(UID);
    expect(await FirstCaseService.maybeRequestReview(UID)).toBe('requested');
  });
});

describe('willCelebrate — steuert die Banner-Unterdrückung', () => {
  it('false ohne verbuchten Fall', async () => {
    expect(await FirstCaseService.willCelebrate(UID)).toBe(false);
  });

  it('true sobald der Fall verbucht ist — AUCH wenn die Tour noch läuft', async () => {
    // Entscheidend: sonst wandert der 'Es geht los!'-Banner in die
    // Queue und taucht nach der Tour doch noch vor unserer Feier auf.
    mockHasCompletedIntroTours.mockResolvedValue(false);
    await FirstCaseService.markFirstCase(UID);
    expect(await FirstCaseService.willCelebrate(UID)).toBe(true);
  });

  it('true nach der Feier (der Moment ist bereits getragen)', async () => {
    await FirstCaseService.markFirstCase(UID);
    await FirstCaseService.markCelebrated(UID);
    expect(await FirstCaseService.willCelebrate(UID)).toBe(true);
  });

  it('false wenn der Review schon durch ist — dann normaler Banner', async () => {
    await FirstCaseService.markFirstCase(UID);
    await FirstCaseService.markCelebrated(UID);
    await FirstCaseService.maybeRequestReview(UID);
    expect(await FirstCaseService.willCelebrate(UID)).toBe(false);
  });

  it('false wenn die Rating-Gates zu sind — es gäbe gar keine Feier', async () => {
    await FirstCaseService.markFirstCase(UID);
    mockCanRequest.mockResolvedValue(false);
    expect(await FirstCaseService.willCelebrate(UID)).toBe(false);
  });

  it('false ohne uid', async () => {
    expect(await FirstCaseService.willCelebrate(null)).toBe(false);
  });
});
