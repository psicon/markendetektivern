/**
 * Geteilter, kontrollierbarer Mock der modularen
 * `@react-native-firebase/firestore`-API für die Service-Layer-Tests (Phase 2).
 *
 * Wird in den Test-Files via `jest.mock` injiziert:
 *
 *   jest.mock('@react-native-firebase/firestore', () =>
 *     require('./__helpers__/rnfirestoreMock').createFirestoreMock());
 *
 * Danach in den Tests die einzelnen Funktionen über den importierten Namen
 * steuern, z.B. `(getDocs as jest.Mock).mockResolvedValueOnce(makeSnapshot([...]))`.
 *
 * Wichtig: `jest.config.js` setzt für das `app`-Projekt `resetMocks: false`,
 * damit die hier gesetzten Default-Implementierungen über Tests hinweg
 * bestehen bleiben. `clearMocks: true` räumt nur die Call-Counts.
 */

/** Ein Doc-/Collection-Ref-Platzhalter, an dem Tests den Pfad asserten können. */
export interface MockRef {
  __kind: 'doc' | 'collection';
  /** Pfad ohne das führende `db`-Argument, z.B. `users/u1/scanHistory`. */
  path: string;
  /** Letztes Pfad-Segment (Doc-ID bzw. Collection-Name). */
  id: string;
  ref?: MockRef;
}

const makeRef = (kind: MockRef['__kind'], args: unknown[]): MockRef => {
  const segments = args.slice(1).filter((a): a is string => typeof a === 'string');
  return { __kind: kind, path: segments.join('/'), id: segments[segments.length - 1] ?? '' };
};

/** Baut ein QuerySnapshot-artiges Objekt aus rohen Doc-Daten. */
export function makeSnapshot(
  items: { id?: string; data: Record<string, unknown>; ref?: unknown }[],
): {
  docs: { id: string; data: () => Record<string, unknown>; ref: unknown }[];
  empty: boolean;
  size: number;
  forEach: (cb: (doc: { id: string; data: () => Record<string, unknown>; ref: unknown }) => void) => void;
} {
  const docs = items.map((it, i) => ({
    id: it.id ?? `doc-${i}`,
    data: () => it.data,
    ref: it.ref ?? { __kind: 'doc' as const, path: `mock/${it.id ?? `doc-${i}`}`, id: it.id ?? `doc-${i}` },
  }));
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    forEach: (cb) => docs.forEach(cb),
  };
}

/** Baut ein DocumentSnapshot-artiges Objekt (getDoc-Rückgabe). */
export function makeDocSnapshot(
  data: Record<string, unknown> | undefined,
  id = 'mock-doc',
): { exists: () => boolean; data: () => Record<string, unknown> | undefined; id: string } {
  return { exists: () => data !== undefined, data: () => data, id };
}

export function createFirestoreMock() {
  return {
    collection: jest.fn((...args: unknown[]) => makeRef('collection', args)),
    doc: jest.fn((...args: unknown[]) => makeRef('doc', args)),

    addDoc: jest.fn(async (ref: MockRef, _data: unknown) => ({
      id: 'mock-added-id',
      path: `${ref?.path ?? 'mock'}/mock-added-id`,
    })),
    getDoc: jest.fn(async () => makeDocSnapshot(undefined)),
    getDocs: jest.fn(async () => makeSnapshot([])),
    setDoc: jest.fn(async () => undefined),
    updateDoc: jest.fn(async () => undefined),
    deleteDoc: jest.fn(async () => undefined),

    onSnapshot: jest.fn((..._args: unknown[]) => jest.fn() /* unsubscribe */),

    serverTimestamp: jest.fn(() => ({ __sentinel: 'serverTimestamp' })),
    query: jest.fn((...args: unknown[]) => ({ __kind: 'query', args })),
    where: jest.fn((...args: unknown[]) => ({ __kind: 'where', args })),
    orderBy: jest.fn((...args: unknown[]) => ({ __kind: 'orderBy', args })),
    limit: jest.fn((...args: unknown[]) => ({ __kind: 'limit', args })),

    writeBatch: jest.fn(() => ({
      set: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      commit: jest.fn(async () => undefined),
    })),
    runTransaction: jest.fn(async (_db: unknown, fn: (tx: unknown) => unknown) =>
      fn({ get: jest.fn(async () => makeDocSnapshot(undefined)), set: jest.fn(), update: jest.fn(), delete: jest.fn() }),
    ),

    // Als Werte importierte Symbole (Typ-Annotationen / instanceof / Sentinels).
    DocumentReference: class DocumentReference {},
    FieldValue: {
      delete: jest.fn(() => ({ __sentinel: 'delete' })),
      serverTimestamp: jest.fn(() => ({ __sentinel: 'serverTimestamp' })),
      increment: jest.fn((n: number) => ({ __sentinel: 'increment', n })),
      arrayUnion: jest.fn((...v: unknown[]) => ({ __sentinel: 'arrayUnion', v })),
    },
    Timestamp: {
      now: jest.fn(() => ({ toMillis: () => 1_000_000, toDate: () => new Date(1_000_000) })),
      fromMillis: jest.fn((m: number) => ({ toMillis: () => m, toDate: () => new Date(m) })),
      fromDate: jest.fn((d: Date) => ({ toMillis: () => d.getTime(), toDate: () => d })),
    },
  };
}
