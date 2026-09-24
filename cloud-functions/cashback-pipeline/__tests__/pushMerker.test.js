'use strict';

/**
 * Höchstens eine „Ka-ching!"-Nachricht je Bon (Push-Prüfung 24.09.2026).
 */

const { gutschriftPushBeanspruchen } = require('../lib/pushMerker');

const FieldValue = { serverTimestamp: () => 'JETZT' };

function fakeDb(bons) {
  const store = new Map(Object.entries(bons));
  let kette = Promise.resolve();
  const db = {
    collection: () => ({ doc: (id) => ({ id }) }),
    // Transaktionen nacheinander — wie Firestore sie bei Konflikt serialisiert.
    runTransaction(fn) {
      const lauf = kette.then(() =>
        fn({
          async get(ref) {
            const d = store.get(ref.id);
            return { exists: d !== undefined, get: (k) => (d ? d[k] : undefined) };
          },
          update(ref, felder) {
            store.set(ref.id, { ...store.get(ref.id), ...felder });
          },
        }),
      );
      kette = lauf.catch(() => {});
      return lauf;
    },
  };
  return { db, store };
}

describe('gutschriftPushBeanspruchen', () => {
  it('erster Aufruf darf senden und setzt den Merker', async () => {
    const { db, store } = fakeDb({ B1: { status: 'approved' } });
    expect(await gutschriftPushBeanspruchen({ db, FieldValue, cashbackId: 'B1', cents: 8 })).toEqual({ darf: true, grund: 'frei' });
    expect(store.get('B1')).toMatchObject({ gutschriftPushAt: 'JETZT', gutschriftPushCents: 8 });
  });

  it('zwei gleichzeitige Aufrufe → genau einer sendet', async () => {
    const { db } = fakeDb({ B1: { status: 'approved' } });
    const [a, b] = await Promise.all([
      gutschriftPushBeanspruchen({ db, FieldValue, cashbackId: 'B1', cents: 8 }),
      gutschriftPushBeanspruchen({ db, FieldValue, cashbackId: 'B1', cents: 8 }),
    ]);
    expect([a, b].filter((r) => r.darf)).toHaveLength(1);
    expect([a, b].map((r) => r.grund).sort()).toEqual(['frei', 'schon_gemeldet']);
  });

  it('schon gemeldet (auch nach Storno und erneuter Gutschrift) → nicht noch einmal', async () => {
    const { db } = fakeDb({ B1: { status: 'approved', gutschriftPushAt: 'GESTERN' } });
    expect(await gutschriftPushBeanspruchen({ db, FieldValue, cashbackId: 'B1', cents: 8 })).toEqual({ darf: false, grund: 'schon_gemeldet' });
  });

  it('ohne Bon-ID, ohne Dokument oder bei Firestore-Fehler → nicht senden', async () => {
    const { db } = fakeDb({});
    expect(await gutschriftPushBeanspruchen({ db, FieldValue, cashbackId: '', cents: 8 })).toEqual({ darf: false, grund: 'kein_bon' });
    expect(await gutschriftPushBeanspruchen({ db, FieldValue, cashbackId: 'B9', cents: 8 })).toEqual({ darf: false, grund: 'kein_bon' });
    const kaputt = { collection: db.collection, runTransaction: async () => { throw new Error('UNAVAILABLE'); } };
    expect(await gutschriftPushBeanspruchen({ db: kaputt, FieldValue, cashbackId: 'B1', cents: 8 })).toEqual({ darf: false, grund: 'fehler', fehler: 'UNAVAILABLE' });
  });
});
