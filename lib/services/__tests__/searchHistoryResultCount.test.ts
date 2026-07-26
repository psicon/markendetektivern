/**
 * searchHistoryService.saveSearchTerm — Trefferzahl-Buchführung.
 *
 * Hintergrund (BigQuery-Analyse 26.07.2026): die Such-Historie meldete
 * ~60 % erfolglose Suchen, obwohl der Algolia-Index z.B. für "butter"
 * 341 Treffer liefert. Ursache war das Zusammenspiel zweier Aufrufer mit
 * der 24-h-Dedup:
 *
 *   1. Home (`app/(tabs)/index.tsx`) schreibt OHNE Trefferzahl — der
 *      Algolia-Call läuft zu dem Zeitpunkt noch.
 *   2. Stöbern (`app/(tabs)/explore.tsx`) ruft Sekunden später MIT der
 *      echten Zahl auf, lief aber in das kommentarlose Return der Dedup.
 *
 * Die echte Zahl wurde nie persistiert. Diese Tests nageln die Regeln fest,
 * damit die Kennzahl nicht erneut still kaputtgeht.
 */
import { makeSnapshot } from './__helpers__/rnfirestoreMock';

jest.mock('@react-native-firebase/firestore', () =>
  require('./__helpers__/rnfirestoreMock').createFirestoreMock(),
);
jest.mock('@/lib/firebase', () => ({ db: { __mockDb: true } }));

import { addDoc, getDocs, updateDoc } from '@react-native-firebase/firestore';
import searchHistoryService from '../searchHistoryService';

const getDocsMock = getDocs as unknown as jest.Mock;
const addDocMock = addDoc as unknown as jest.Mock;
const updateDocMock = updateDoc as unknown as jest.Mock;

const UID = 'user-1';
const EMPTY = makeSnapshot([]);

/** saveSearchTerm liest zwei Queries: erst gelöschte, dann bestehende. */
const mockQueries = (deleted: any, existing: any) => {
  getDocsMock.mockResolvedValueOnce(deleted).mockResolvedValueOnce(existing);
};

beforeEach(() => {
  jest.clearAllMocks();
  // mockReset statt clear: der Wiederherstellungs-Pfad kehrt nach dem ERSTEN
  // getDocs zurück und lässt den zweiten `mockResolvedValueOnce`-Wert in der
  // Queue liegen. `clearAllMocks` leert diese Queue nicht — der Rest würde in
  // den nächsten Test überlaufen und dort die Reihenfolge verschieben.
  getDocsMock.mockReset();
  getDocsMock.mockResolvedValue(EMPTY);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('neuer Eintrag', () => {
  it('ohne Trefferzahl (Home-Pfad) → 0 als Platzhalter', async () => {
    mockQueries(EMPTY, EMPTY);
    await searchHistoryService.saveSearchTerm(UID, 'butter');
    expect(addDocMock.mock.calls[0][1]).toMatchObject({
      searchTerm: 'butter',
      resultCount: 0,
    });
  });

  it('mit Trefferzahl → echte Zahl', async () => {
    mockQueries(EMPTY, EMPTY);
    await searchHistoryService.saveSearchTerm(UID, 'butter', 341);
    expect(addDocMock.mock.calls[0][1]).toMatchObject({ resultCount: 341 });
  });

  it('echte 0 Treffer bleibt 0 (kein Verwechseln mit "unbekannt")', async () => {
    mockQueries(EMPTY, EMPTY);
    await searchHistoryService.saveSearchTerm(UID, 'zzzznichts', 0);
    expect(addDocMock.mock.calls[0][1]).toMatchObject({ resultCount: 0 });
  });
});

describe('bestehender Eintrag (24-h-Dedup)', () => {
  const existing = (resultCount: number) =>
    makeSnapshot([{ id: 'h1', data: { searchTerm: 'butter', resultCount } }]);

  it('trägt die echte Zahl nach, wenn 0 gespeichert ist — DER Fix', async () => {
    mockQueries(EMPTY, existing(0));
    await searchHistoryService.saveSearchTerm(UID, 'butter', 341);
    expect(addDocMock).not.toHaveBeenCalled(); // Dedup bleibt aktiv
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(updateDocMock.mock.calls[0][1]).toEqual({ resultCount: 341 });
  });

  it('rührt einen bereits korrekten Wert nicht an (kein Geflacker)', async () => {
    mockQueries(EMPTY, existing(341));
    await searchHistoryService.saveSearchTerm(UID, 'butter', 350);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('ohne Trefferzahl passiert nichts — Home darf nichts überschreiben', async () => {
    mockQueries(EMPTY, existing(341));
    await searchHistoryService.saveSearchTerm(UID, 'butter');
    expect(updateDocMock).not.toHaveBeenCalled();
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('eine gemeldete 0 überschreibt nichts', async () => {
    mockQueries(EMPTY, existing(0));
    await searchHistoryService.saveSearchTerm(UID, 'butter', 0);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('aktualisiert NUR resultCount — der timestamp bleibt, sonst springt die Liste', async () => {
    mockQueries(EMPTY, existing(0));
    await searchHistoryService.saveSearchTerm(UID, 'butter', 12);
    expect(Object.keys(updateDocMock.mock.calls[0][1])).toEqual(['resultCount']);
  });
});

describe('gelöschter Eintrag wird wiederhergestellt', () => {
  const deleted = makeSnapshot([
    { id: 'd1', data: { searchTerm: 'butter', resultCount: 341, deleted: true } },
  ]);

  it('ohne Trefferzahl wird resultCount NICHT auf 0 zurückgesetzt', async () => {
    mockQueries(deleted, EMPTY);
    await searchHistoryService.saveSearchTerm(UID, 'butter');
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(updateDocMock.mock.calls[0][1]).not.toHaveProperty('resultCount');
  });

  it('mit Trefferzahl wird sie mitgeschrieben', async () => {
    mockQueries(deleted, EMPTY);
    await searchHistoryService.saveSearchTerm(UID, 'butter', 77);
    expect(updateDocMock.mock.calls[0][1]).toMatchObject({ resultCount: 77 });
  });
});
