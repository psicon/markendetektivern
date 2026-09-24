'use strict';

/**
 * Wer darf einen Bon gerade anfassen? (Push-Prüfung 24.09.2026)
 * Doppelzustellung derselben Nachricht, laufende Entscheidung der Konsole,
 * gleichzeitige Entscheidungen — siehe lib/laufAnspruch.js.
 */

const {
  LAUF_MAX_MS,
  ENTSCHEIDUNG_MAX_MS,
  laufFeld,
  aktiveLaeufe,
  laufUrteil,
  entscheidungUrteil,
  laufBeginnen,
  laufBeenden,
  entscheidungBeanspruchen,
  entscheidungFreigeben,
} = require('../lib/laufAnspruch');

const T0 = 1_800_000_000_000;
const ts = (ms) => ({ toMillis: () => ms });

/** Minimale Firestore-Nachbildung: ein Dokument, Transaktionen seriell. */
function fakeDb(start) {
  let daten = start === undefined ? undefined : JSON.parse(JSON.stringify(start), (k, v) => (v && v.__ms != null ? ts(v.__ms) : v));
  let jetzt = T0;
  const setzePfad = (obj, pfad, wert) => {
    const teile = pfad.split('.');
    let o = obj;
    for (const t of teile.slice(0, -1)) o = o[t] = o[t] || {};
    if (wert === LOESCHEN) delete o[teile[teile.length - 1]];
    else o[teile[teile.length - 1]] = wert;
  };
  const LOESCHEN = { loeschen: true };
  const docRef = {
    async update(felder) {
      if (daten === undefined) throw new Error('NOT_FOUND');
      for (const [k, v] of Object.entries(felder)) setzePfad(daten, k, v);
    },
  };
  const db = {
    async runTransaction(fn) {
      const tx = {
        async get() {
          return { exists: daten !== undefined, data: () => daten };
        },
        update(ref, felder) {
          for (const [k, v] of Object.entries(felder)) setzePfad(daten, k, v);
        },
      };
      return fn(tx);
    },
  };
  const admin = {
    firestore: {
      Timestamp: { now: () => ts(jetzt) },
      FieldValue: { delete: () => LOESCHEN },
    },
  };
  return {
    db,
    admin,
    docRef,
    lesen: () => daten,
    uhr: (ms) => {
      jetzt = ms;
    },
  };
}

describe('laufFeld', () => {
  it('macht aus jeder Event-ID einen gültigen Pfadteil', () => {
    expect(laufFeld('21151306263066847')).toBe('e21151306263066847');
    expect(laufFeld('a.b/c')).toBe('ea_b_c');
  });
});

describe('Urteile (rein)', () => {
  it('aktiveLaeufe ignoriert abgelaufene Ansprüche', () => {
    const v = { e1: ts(T0 - 1000), e2: ts(T0 - LAUF_MAX_MS - 1) };
    expect(aktiveLaeufe(v, T0)).toEqual(['e1']);
    expect(aktiveLaeufe(undefined, T0)).toEqual([]);
  });

  it('dieselbe Nachricht, erster Lauf aktiv → doppelt', () => {
    expect(laufUrteil({ verarbeitung: { e7: ts(T0 - 5000) } }, '7', T0)).toBe('doppelt');
  });

  it('dieselbe Nachricht, erster Lauf beendet oder abgelaufen → frei', () => {
    expect(laufUrteil({ verarbeitung: {} }, '7', T0)).toBe('frei');
    expect(laufUrteil({ verarbeitung: { e7: ts(T0 - LAUF_MAX_MS - 1) } }, '7', T0)).toBe('frei');
  });

  it('andere Nachricht (Kehrlauf, Nachverarbeitung) läuft wie bisher', () => {
    expect(laufUrteil({ verarbeitung: { e7: ts(T0 - 5000) } }, '8', T0)).toBe('frei');
  });

  it('laufende Entscheidung der Konsole → Pipeline wartet nicht, sondern lässt aus', () => {
    expect(laufUrteil({ entscheidungLaeuft: { decision: 'approve', seit: ts(T0 - 1000) } }, '8', T0)).toBe('entscheidung_laeuft');
    expect(laufUrteil({ entscheidungLaeuft: { decision: 'approve', seit: ts(T0 - ENTSCHEIDUNG_MAX_MS - 1) } }, '8', T0)).toBe('frei');
  });

  it('Konsole: nur review, keine laufende Entscheidung, kein aktiver Lauf', () => {
    expect(entscheidungUrteil({ status: 'approved' }, T0)).toBe('not_in_review');
    expect(entscheidungUrteil({ status: 'review', entscheidungLaeuft: { seit: ts(T0 - 1) } }, T0)).toBe('decision_in_progress');
    expect(entscheidungUrteil({ status: 'review', verarbeitung: { e1: ts(T0 - 1) } }, T0)).toBe('in_verarbeitung');
    expect(entscheidungUrteil({ status: 'review', verarbeitung: { e1: ts(T0 - LAUF_MAX_MS - 1) } }, T0)).toBe('frei');
    expect(entscheidungUrteil({ status: 'review' }, T0)).toBe('frei');
  });
});

describe('Ansprüche (Transaktionen)', () => {
  it('Doppelzustellung: zweiter Lauf derselben Nachricht wird abgewiesen, nach Ende wieder frei', async () => {
    const f = fakeDb({ status: 'ocr_pending' });
    const a = await laufBeginnen({ ...f, eventId: '42', jetzt: () => T0 });
    expect(a).toEqual({ urteil: 'frei', angemeldet: true });
    const b = await laufBeginnen({ ...f, eventId: '42', jetzt: () => T0 + 5000 });
    expect(b).toEqual({ urteil: 'doppelt', angemeldet: false });
    await laufBeenden({ ...f, eventId: '42' });
    expect(f.lesen().verarbeitung).toEqual({});
    const c = await laufBeginnen({ ...f, eventId: '42', jetzt: () => T0 + 6000 });
    expect(c.urteil).toBe('frei');
  });

  it('Konsole kann nicht entscheiden, solange die Pipeline rechnet — danach schon', async () => {
    const f = fakeDb({ status: 'review' });
    await laufBeginnen({ ...f, eventId: '1', jetzt: () => T0 });
    const x = await entscheidungBeanspruchen({ db: f.db, admin: f.admin, ref: f.docRef, decision: 'approve', jetzt: () => T0 + 1000 });
    expect(x.urteil).toBe('in_verarbeitung');
    await laufBeenden({ ...f, eventId: '1' });
    const y = await entscheidungBeanspruchen({ db: f.db, admin: f.admin, ref: f.docRef, decision: 'approve', jetzt: () => T0 + 2000 });
    expect(y.urteil).toBe('frei');
    expect(f.lesen().entscheidungLaeuft.decision).toBe('approve');
  });

  it('zwei Entscheidungen gleichzeitig: die zweite bekommt decision_in_progress', async () => {
    const f = fakeDb({ status: 'review' });
    const erste = await entscheidungBeanspruchen({ db: f.db, admin: f.admin, ref: f.docRef, decision: 'approve', jetzt: () => T0 });
    const zweite = await entscheidungBeanspruchen({ db: f.db, admin: f.admin, ref: f.docRef, decision: 'reject', jetzt: () => T0 + 500 });
    expect(erste.urteil).toBe('frei');
    expect(zweite.urteil).toBe('decision_in_progress');
  });

  it('Konsole gibt nur ihren EIGENEN Anspruch frei', async () => {
    const f = fakeDb({ status: 'review' });
    const erste = await entscheidungBeanspruchen({ db: f.db, admin: f.admin, ref: f.docRef, decision: 'approve', jetzt: () => T0 });
    expect(erste.token).toEqual(expect.any(String));
    // fremder Token → Anspruch bleibt stehen
    expect(await entscheidungFreigeben({ db: f.db, admin: f.admin, ref: f.docRef, token: 'fremd' })).toBe(false);
    expect(f.lesen().entscheidungLaeuft.decision).toBe('approve');
    // eigener Token → weg, danach ist wieder frei
    expect(await entscheidungFreigeben({ db: f.db, admin: f.admin, ref: f.docRef, token: erste.token })).toBe(true);
    expect(f.lesen().entscheidungLaeuft).toBeUndefined();
    const zweite = await entscheidungBeanspruchen({ db: f.db, admin: f.admin, ref: f.docRef, decision: 'reject', jetzt: () => T0 + 1000 });
    expect(zweite.urteil).toBe('frei');
    // Firestore-Fehler beim Freigeben → false, wirft nicht
    const kaputt = { runTransaction: async () => { throw new Error('UNAVAILABLE'); } };
    expect(await entscheidungFreigeben({ db: kaputt, admin: f.admin, ref: f.docRef, token: zweite.token })).toBe(false);
  });

  it('Pipeline startet nicht, während die Konsole entscheidet', async () => {
    const f = fakeDb({ status: 'review' });
    await entscheidungBeanspruchen({ db: f.db, admin: f.admin, ref: f.docRef, decision: 'approve', jetzt: () => T0 });
    const lauf = await laufBeginnen({ ...f, eventId: '9', jetzt: () => T0 + 1000 });
    expect(lauf).toEqual({ urteil: 'entscheidung_laeuft', angemeldet: false });
  });

  it('laufBeginnen wirft nie: Firestore-Fehler → Verarbeitung wie bisher, ohne Anspruch', async () => {
    const f = fakeDb({ status: 'ocr_pending' });
    const kaputt = { runTransaction: async () => { throw new Error('UNAVAILABLE'); } };
    const r = await laufBeginnen({ db: kaputt, admin: f.admin, docRef: f.docRef, eventId: '1' });
    expect(r).toMatchObject({ urteil: 'frei', angemeldet: false, fehler: 'UNAVAILABLE' });
  });

  it('ohne Event-ID oder ohne Dokument: frei, ohne Anspruch', async () => {
    const f = fakeDb(undefined);
    expect(await laufBeginnen({ ...f, eventId: '' })).toEqual({ urteil: 'frei', angemeldet: false });
    expect(await laufBeginnen({ ...f, eventId: '1' })).toEqual({ urteil: 'frei', angemeldet: false });
    expect(await laufBeenden({ ...f, eventId: '1' })).toBe(false);
  });
});
