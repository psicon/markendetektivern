'use strict';

/**
 * Nachlauf der Bon-Artikel-Zuordnung (08.10.2026, nachlauf.js).
 *
 * Prüfbefund: eine Zeile, die an Zeit oder Kontingent scheitert, trägt
 * matchVersion und wird ohne force nie wieder bearbeitet. Die Tests sichern:
 *  1. Nur Zeit-/Kontingentfehler werden nachgeholt, höchstens dreimal, mit
 *     wachsender Wartezeit; der Zähler lässt sich nicht zurücksetzen.
 *  2. Der Nachlauf hakt NIE einen Einkaufszettel ab (noClose).
 *  3. Er überschreibt keine inzwischen erledigte Zeile und räumt sie aus.
 *  4. Ein kranker Vertex verbrennt nicht alle Versuche in einem Durchgang.
 */

const N = require('../nachlauf');

const MIN = 60_000;
const JETZT = 1_800_000_000_000;
const PP = 'users/u1/purchased_products/bon1_goldmais';

// ─── In-Memory-Firestore (genug für matcher.js + nachlauf.js) ────────
const DELETE = Symbol('DELETE');
function speicher(start = {}) {
  const docs = new Map(Object.entries(start));
  const log = [];
  const anwenden = (alt, neu, merge) => {
    const out = merge ? { ...(alt || {}) } : {};
    for (const [k, v] of Object.entries(neu)) {
      if (v === DELETE) delete out[k];
      else if (v && typeof v === 'object' && 'increment' in v && Object.keys(v).length === 1) out[k] = (out[k] || 0) + v.increment;
      else out[k] = v;
    }
    return out;
  };
  const schreib = (path, data, opts) => {
    log.push({ op: 'set', path, data });
    docs.set(path, anwenden(docs.get(path), data, opts && opts.merge));
  };
  const aendern = (path, data) => {
    if (!docs.has(path)) throw new Error(`NOT_FOUND ${path}`);
    log.push({ op: 'update', path, data });
    docs.set(path, anwenden(docs.get(path), data, true));
  };
  const loesch = (path) => {
    log.push({ op: 'delete', path });
    docs.delete(path);
  };
  const snap = (path) => ({ id: path.split('/').pop(), ref: ref(path), exists: docs.has(path), data: () => (docs.has(path) ? { ...docs.get(path) } : undefined) });
  const kinder = (col) =>
    [...docs.keys()].filter((p) => p.startsWith(`${col}/`) && p.split('/').length === col.split('/').length + 1).map(snap);
  const vergleich = { '<=': (a, b) => a <= b, '==': (a, b) => a === b, '>=': (a, b) => a >= b };
  const wert = (v) => (v instanceof Date ? v.getTime() : v && typeof v.toMillis === 'function' ? v.toMillis() : v);
  const query = (col, filter = [], ordnung = null, max = Infinity) => {
    const q = {
      where: (f, op, v) => query(col, [...filter, [f, op, v]], ordnung, max),
      orderBy: (f) => query(col, filter, f, max),
      limit: (n) => query(col, filter, ordnung, n),
      findNearest: () => ({ get: async () => liste(col === 'productEmbeddings' ? kinder(col).map((s) => ({ ...s, data: () => ({ ...s.data(), _dist: 0.1 }) })) : []) }),
      get: async () => {
        let r = kinder(col).filter((s) => filter.every(([f, op, v]) => vergleich[op](wert(s.data()[f]), wert(v))));
        if (ordnung) r = r.sort((a, b) => wert(a.data()[ordnung]) - wert(b.data()[ordnung]));
        return liste(r.slice(0, max));
      },
      doc: (id) => ref(`${col}/${id}`),
      add: async (data) => {
        const path = `${col}/auto${docs.size}`;
        schreib(path, data);
        return ref(path);
      },
    };
    return q;
  };
  const liste = (arr) => ({ docs: arr, empty: !arr.length, size: arr.length, forEach: (fn) => arr.forEach(fn) });
  function ref(path) {
    return {
      path,
      id: path.split('/').pop(),
      get: async () => snap(path),
      set: async (d, o) => schreib(path, d, o),
      update: async (d) => aendern(path, d),
      delete: async () => loesch(path),
      collection: (sub) => query(`${path}/${sub}`),
    };
  }
  const db = {
    collection: (name) => query(name),
    doc: (path) => ref(path),
    getAll: async (...refs) => refs.filter((r) => r && r.path).map((r) => snap(r.path)),
    batch: () => {
      const ops = [];
      return {
        set: (r, d, o) => ops.push(() => schreib(r.path, d, o)),
        delete: (r) => ops.push(() => loesch(r.path)),
        commit: async () => ops.forEach((f) => f()),
      };
    },
    runTransaction: async (fn) => {
      const ops = [];
      const tx = {
        get: async (r) => snap(r.path),
        set: (r, d, o) => ops.push(() => schreib(r.path, d, o)),
        update: (r, d) => ops.push(() => aendern(r.path, d)),
        delete: (r) => ops.push(() => loesch(r.path)),
      };
      const out = await fn(tx);
      ops.forEach((f) => f());
      return out;
    },
  };
  return { db, docs, log, ref };
}

const eintragPfad = (ppPath = PP) => `${N.NACHLAUF_COLLECTION}/${N.nachlaufDocId(ppPath)}`;
const fehlerZeile = (over = {}) => ({
  itemName: 'G&G Goldmais 140g',
  merchantId: 'lidl',
  priceCents: 99,
  receiptId: null,
  matchStatus: 'error',
  matchError: 'pick-timeout',
  matchVersion: 1,
  matchNachlauf: 'geplant',
  ...over,
});
const eintrag = (over = {}) => ({ uid: 'u1', ppId: 'bon1_goldmais', ppPath: PP, matchError: 'pick-timeout', naechsterAt: new Date(JETZT - MIN), laufBis: null, ...over });

// ─── 1. Regeln (pure) ────────────────────────────────────────────────
describe('planeNachlauf', () => {
  it.each(['pick-timeout', 'pick-429', 'shortlist-timeout', 'embed-failed'])('%s wird nachgeholt (15 min)', (code) => {
    const plan = N.planeNachlauf({ ppPath: PP, matchError: code, versuch: 0, jetzt: JETZT });
    expect(plan).toMatchObject({ aktion: 'planen', docId: 'u1__bon1_goldmais', ppFelder: { matchNachlauf: 'geplant' } });
    expect(plan.daten).toMatchObject({ uid: 'u1', ppId: 'bon1_goldmais', ppPath: PP, matchError: code, laufBis: null });
    expect(plan.daten.naechsterAt.getTime()).toBe(JETZT + 15 * MIN);
    // Der Zähler steigt nur beim Übernehmen — planeNachlauf darf ihn nie schreiben.
    expect(plan.daten).not.toHaveProperty('versuche');
  });

  it.each(['pick-failed', 'Cannot read properties of undefined', undefined])('%s wird NICHT nachgeholt', (code) => {
    expect(N.planeNachlauf({ ppPath: PP, matchError: code, versuch: 0, jetzt: JETZT })).toBeNull();
  });

  it('Wartezeiten 15 min → 1 h → 6 h, nach dem dritten Nachlauf erschöpft', () => {
    const ab = [0, 1, 2].map((v) => N.planeNachlauf({ ppPath: PP, matchError: 'pick-429', versuch: v, jetzt: JETZT }).daten.naechsterAt.getTime() - JETZT);
    expect(ab).toEqual([15 * MIN, 60 * MIN, 360 * MIN]);
    expect(N.planeNachlauf({ ppPath: PP, matchError: 'pick-429', versuch: 3, jetzt: JETZT })).toEqual({
      aktion: 'erschoepft',
      docId: 'u1__bon1_goldmais',
      ppFelder: { matchNachlauf: 'erschoepft' },
    });
  });

  it('nur echte Bon-Zeilen-Pfade', () => {
    expect(N.nachlaufDocId('users/u1/einkaufswagen/x')).toBeNull();
    expect(N.nachlaufDocId('pp')).toBeNull();
    expect(N.planeNachlauf({ ppPath: undefined, matchError: 'pick-timeout', jetzt: JETZT })).toBeNull();
  });

  it('Zeilenfrist des Nachlaufs = Zeilenbudget des Matchers (keine Drift)', () => {
    jest.isolateModules(() => {
      jest.doMock('firebase-admin', () => ({ firestore: () => ({}) }));
      jest.doMock('firebase-admin/firestore', () => ({ FieldValue: {} }));
      const matcher = require('../matcher');
      expect(N.ZEILE_MAX_MS).toBe(matcher.ZEILEN_BUDGET_MS);
    });
  });
});

describe('nachlaufUrteil', () => {
  it.each([
    ['kein Eintrag', null, fehlerZeile(), 'weg'],
    ['noch nicht fällig', eintrag({ naechsterAt: new Date(JETZT + MIN) }), fehlerZeile(), 'nicht_faellig'],
    ['ein anderer Lauf hält ihn', eintrag({ laufBis: new Date(JETZT + MIN) }), fehlerZeile(), 'gesperrt'],
    ['Zeile gelöscht', eintrag(), null, 'raeumen'],
    ['inzwischen zugeordnet (z. B. Admin)', eintrag(), fehlerZeile({ matchStatus: 'matched', matchError: undefined }), 'raeumen'],
    ['anderer Fehler am Dokument', eintrag(), fehlerZeile({ matchError: 'pick-failed' }), 'raeumen'],
    ['nicht vergüteter Bon', eintrag(), fehlerZeile({ rewardEligible: false }), 'raeumen'],
    ['dritter Nachlauf schon gelaufen', eintrag({ versuche: 3 }), fehlerZeile(), 'erschoepft'],
  ])('%s → %s', (_, e, pp, aktion) => {
    expect(N.nachlaufUrteil(e, pp, JETZT).aktion).toBe(aktion);
  });

  it('abgelaufener Anspruch eines abgestürzten Laufs → übernehmen, Versuch zählt weiter', () => {
    expect(N.nachlaufUrteil(eintrag({ versuche: 1, laufBis: new Date(JETZT - 1) }), fehlerZeile(), JETZT)).toEqual({ aktion: 'uebernehmen', versuch: 2 });
  });
});

// ─── 2. Matcher schreibt Fehler + Nachlauf in EINEM Batch ────────────
function ladeMatcher({ generateContent, startDocs = {} } = {}) {
  const s = speicher(startDocs);
  let matcher;
  const calls = { generate: 0 };
  jest.isolateModules(() => {
    // Die index.js-Tests (Abschnitt 5) mocken ../matcher und ../gemini per
    // doMock; das gilt über isolateModules hinaus. Hier immer die echten.
    jest.dontMock('../matcher');
    jest.dontMock('../gemini');
    jest.doMock('firebase-admin', () => ({ firestore: () => s.db }));
    jest.doMock('firebase-admin/firestore', () => ({
      FieldValue: { vector: (v) => v, increment: (n) => ({ increment: n }), serverTimestamp: () => 'SERVER_TS', delete: () => DELETE },
    }));
    jest.doMock('firebase-functions/logger', () => ({ info: () => {}, warn: () => {}, error: () => {} }));
    jest.doMock('@google/genai', () => ({
      GoogleGenAI: class {
        constructor() {
          this.models = {
            generateContent: async (params) => {
              calls.generate++;
              return generateContent ? generateContent(params, calls.generate) : { text: '{"lineType":"product","candidateIdx":0,"confidence":0.95}' };
            },
            embedContent: async () => ({ embeddings: [{ values: [0.1, 0.2, 0.3] }] }),
          };
        }
      },
    }));
    matcher = require('../matcher');
  });
  return { matcher, ...s, calls };
}

const haengtBisAbbruch = (params) =>
  new Promise((_, reject) => {
    params.config.abortSignal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });

const KATALOG = {
  'productEmbeddings/p1': { name: 'Goldmais 140g', type: 'noname', sourceCollection: 'produkte', preis: 0.99, discounterId: 'd1', vector: [0.1, 0.2, 0.3] },
  'discounter/d1': { name: 'Lidl', land: 'DE' },
};
const ctx = (s, over = {}) => ({ itemName: 'G&G Goldmais 140g', marktSlug: 'lidl', priceCents: 99, userId: 'u1', receiptId: null, ppRef: s.ref(PP), ...over });

describe('matchLine plant den Nachlauf', () => {
  afterEach(() => jest.useRealTimers());

  it('Pick hängt → Fehler + matchNachlauf geplant + Eintrag, beides in einem Batch', async () => {
    jest.useFakeTimers({ now: JETZT });
    const s = ladeMatcher({ generateContent: haengtBisAbbruch, startDocs: { ...KATALOG } });
    const p = s.matcher.matchLine(ctx(s), { deadlineAt: JETZT + 100_000 });
    await jest.advanceTimersByTimeAsync(60_000);
    await expect(p).resolves.toMatchObject({ status: 'error', reason: 'pick-timeout' });
    expect(s.docs.get(PP)).toMatchObject({ matchStatus: 'error', matchError: 'pick-timeout', matchVersion: 1, matchNachlauf: 'geplant' });
    const e = s.docs.get(eintragPfad());
    expect(e).toMatchObject({ uid: 'u1', ppPath: PP, matchError: 'pick-timeout', laufBis: null });
    // geschrieben nach zwei Pick-Versuchen à 25 s, fällig 15 min danach
    expect(e.naechsterAt.getTime()).toBe(JETZT + 50_000 + 15 * MIN);
  });

  it('400 (pick-failed) → kein Nachlauf; dryRun schreibt gar nichts', async () => {
    jest.useFakeTimers({ now: JETZT });
    const s = ladeMatcher({ generateContent: async () => { throw Object.assign(new Error('bad'), { status: 400 }); }, startDocs: { ...KATALOG } });
    await expect(s.matcher.matchLine(ctx(s), { deadlineAt: JETZT + 100_000 })).resolves.toMatchObject({ reason: 'pick-failed' });
    expect(s.docs.get(PP)).toMatchObject({ matchError: 'pick-failed' });
    expect(s.docs.has(eintragPfad())).toBe(false);

    const t = ladeMatcher({ generateContent: haengtBisAbbruch, startDocs: { ...KATALOG } });
    const p = t.matcher.matchLine(ctx(t), { deadlineAt: JETZT + 100_000, dryRun: true });
    await jest.advanceTimersByTimeAsync(60_000);
    await p;
    expect(t.docs.has(PP)).toBe(false);
    expect(t.docs.has(eintragPfad())).toBe(false);
  });

  it('dritter Nachlauf scheitert erneut → erschöpft, Eintrag weg', async () => {
    jest.useFakeTimers({ now: JETZT });
    const s = ladeMatcher({ generateContent: haengtBisAbbruch, startDocs: { ...KATALOG, [eintragPfad()]: eintrag({ versuche: 3 }) } });
    const p = s.matcher.matchLine(ctx(s), { deadlineAt: JETZT + 100_000, noClose: true, nachlaufVersuch: 3 });
    await jest.advanceTimersByTimeAsync(60_000);
    await p;
    expect(s.docs.get(PP)).toMatchObject({ matchStatus: 'error', matchError: 'pick-timeout', matchNachlauf: 'erschoepft', matchNachlaufVersuch: 3 });
    expect(s.docs.has(eintragPfad())).toBe(false);
  });

  it('Nachlauf endet mit 400 → kein „geplant“ mehr am Dokument, alte Pick-Werte weg', async () => {
    jest.useFakeTimers({ now: JETZT });
    const s = ladeMatcher({
      generateContent: async () => { throw Object.assign(new Error('bad'), { status: 400 }); },
      startDocs: { ...KATALOG, [PP]: fehlerZeile({ pickAttempts: 2, pickMs: 50_000 }), [eintragPfad()]: eintrag({ versuche: 1 }) },
    });
    await s.matcher.matchLine(ctx(s), { noClose: true, nachlaufVersuch: 1 });
    const pp = s.docs.get(PP);
    expect(pp).toMatchObject({ matchStatus: 'error', matchError: 'pick-failed', pickAttempts: 1, matchNachlaufVersuch: 1 });
    expect(pp).not.toHaveProperty('matchNachlauf');
  });

  it('Erfolg nach einem Fehler räumt die Fehlerspuren', async () => {
    jest.useFakeTimers({ now: JETZT });
    const s = ladeMatcher({ startDocs: { ...KATALOG, [PP]: fehlerZeile({ matchErrorDetail: 'pick_timeout nach 25000 ms', pickAttempts: 2, pickMs: 50_000 }) } });
    await expect(s.matcher.matchLine(ctx(s), { noClose: true, nachlaufVersuch: 1 })).resolves.toMatchObject({ status: 'matched', productId: 'p1' });
    const pp = s.docs.get(PP);
    expect(pp).toMatchObject({ matchStatus: 'matched', productId: 'p1', matchNachlaufVersuch: 1 });
    for (const f of s.matcher.FEHLER_FELDER) expect(pp).not.toHaveProperty(f);
  });
});

// ─── 3. Durchgang ────────────────────────────────────────────────────
describe('nachlauf()', () => {
  const uhr = (t = JETZT) => {
    const u = { t };
    u.fn = () => u.t;
    return u;
  };

  it('fällige Zeile: Neuzuordnung mit noClose, Versuch 1, Frist im Lauf; Eintrag danach weg', async () => {
    const s = speicher({ [PP]: fehlerZeile({ bonDate: '2026-10-08' }), [eintragPfad()]: eintrag() });
    const u = uhr();
    const matchLine = jest.fn(async (c) => {
      await c.ppRef.set({ matchStatus: 'matched', productId: 'p1' }, { merge: true });
      return { status: 'matched', productId: 'p1' };
    });
    const ende = JETZT + 300_000;
    const b = await N.nachlauf({ db: s.db, matchLine, jetzt: u.fn, laufEndeAt: ende });
    expect(matchLine).toHaveBeenCalledTimes(1);
    const [c, o] = matchLine.mock.calls[0];
    expect(c).toMatchObject({ itemName: 'G&G Goldmais 140g', marktSlug: 'lidl', priceCents: 99, userId: 'u1', bonDate: '2026-10-08' });
    expect(c.ppRef.path).toBe(PP);
    expect(o).toEqual({ noClose: true, deadlineAt: JETZT + N.ZEILE_MAX_MS, nachlaufVersuch: 1 });
    expect(s.docs.has(eintragPfad())).toBe(false);
    expect(b).toMatchObject({ gefunden: 1, versucht: 1, gerettet: 1, abbruch: null });
  });

  it('Frist der Zeile endet nie nach dem Lauf', async () => {
    const s = speicher({ [PP]: fehlerZeile(), [eintragPfad()]: eintrag() });
    const matchLine = jest.fn(async () => ({ status: 'needs_review' }));
    await N.nachlauf({ db: s.db, matchLine, jetzt: () => JETZT, laufEndeAt: JETZT + 50_000 });
    expect(matchLine.mock.calls[0][1].deadlineAt).toBe(JETZT + 50_000);
  });

  it('erledigte, gelöschte und nicht vergütete Zeilen werden ausgeräumt, nie neu zugeordnet', async () => {
    const a = 'users/u1/purchased_products/a';
    const c = 'users/u2/purchased_products/c';
    const s = speicher({
      [PP]: fehlerZeile({ matchStatus: 'matched', matchError: undefined }),
      [c]: fehlerZeile({ rewardEligible: false }),
      [eintragPfad()]: eintrag(),
      [eintragPfad(a)]: eintrag({ ppPath: a }),
      [eintragPfad(c)]: eintrag({ ppPath: c, uid: 'u2' }),
    });
    const matchLine = jest.fn();
    const b = await N.nachlauf({ db: s.db, matchLine, jetzt: () => JETZT });
    expect(matchLine).not.toHaveBeenCalled();
    expect(b.geraeumt).toBe(3);
    expect([...s.docs.keys()].filter((k) => k.startsWith(N.NACHLAUF_COLLECTION))).toEqual([]);
    expect(s.docs.get(PP)).toMatchObject({ matchStatus: 'matched' });
  });

  it('nicht fällige und gesperrte Einträge bleiben liegen', async () => {
    const s = speicher({
      [PP]: fehlerZeile(),
      [eintragPfad()]: eintrag({ laufBis: new Date(JETZT + MIN) }),
      [eintragPfad('users/u1/purchased_products/spaeter')]: eintrag({ naechsterAt: new Date(JETZT + MIN) }),
    });
    const matchLine = jest.fn();
    const b = await N.nachlauf({ db: s.db, matchLine, jetzt: () => JETZT });
    expect(matchLine).not.toHaveBeenCalled();
    expect(b).toMatchObject({ gefunden: 1, uebersprungen: 1 });
    expect(s.docs.has(eintragPfad())).toBe(true);
  });

  it('Eintrag mit drei verbrauchten Versuchen → erschöpft am Dokument, kein Aufruf', async () => {
    const s = speicher({ [PP]: fehlerZeile(), [eintragPfad()]: eintrag({ versuche: 3 }) });
    const matchLine = jest.fn();
    const b = await N.nachlauf({ db: s.db, matchLine, jetzt: () => JETZT });
    expect(matchLine).not.toHaveBeenCalled();
    expect(b.erschoepft).toBe(1);
    expect(s.docs.get(PP).matchNachlauf).toBe('erschoepft');
    expect(s.docs.has(eintragPfad())).toBe(false);
  });

  it('Vertex krank: nach drei erneuten Zeitfehlern in Folge endet der Durchgang, der vierte Eintrag verbraucht keinen Versuch', async () => {
    const start = {};
    for (const n of [1, 2, 3, 4]) {
      const p = `users/u1/purchased_products/z${n}`;
      start[p] = fehlerZeile();
      start[eintragPfad(p)] = eintrag({ ppPath: p, naechsterAt: new Date(JETZT - n * MIN) });
    }
    const s = speicher(start);
    // matchLine scheitert wieder; plant (wie der echte Matcher) neu
    const matchLine = jest.fn(async (c, o) => {
      const plan = N.planeNachlauf({ ppPath: c.ppRef.path, matchError: 'pick-timeout', versuch: o.nachlaufVersuch, jetzt: JETZT });
      await s.db.collection(N.NACHLAUF_COLLECTION).doc(plan.docId).set(plan.daten, { merge: true });
      return { status: 'error', reason: 'pick-timeout' };
    });
    const b = await N.nachlauf({ db: s.db, matchLine, jetzt: () => JETZT });
    expect(matchLine).toHaveBeenCalledTimes(3);
    expect(b).toMatchObject({ versucht: 3, erneutFehler: 3, abbruch: 'fehlerserie' });
    // Älteste zuerst (z4 ist am längsten fällig) → z1 blieb unberührt
    const z1 = s.docs.get(eintragPfad('users/u1/purchased_products/z1'));
    expect(z1.versuche).toBeUndefined();
    const z4 = s.docs.get(eintragPfad('users/u1/purchased_products/z4'));
    expect(z4).toMatchObject({ versuche: 1, laufBis: null });
    expect(z4.naechsterAt.getTime()).toBe(JETZT + 60 * MIN);
  });

  it('anderer Fehler (400) beim Nachlauf → Eintrag weg, keine Fehlerserie', async () => {
    const s = speicher({ [PP]: fehlerZeile(), [eintragPfad()]: eintrag() });
    const b = await N.nachlauf({ db: s.db, matchLine: async () => ({ status: 'error', reason: 'pick-failed' }), jetzt: () => JETZT });
    expect(b).toMatchObject({ endgueltigFehler: 1, abbruch: null });
    expect(s.docs.has(eintragPfad())).toBe(false);
  });

  it('Restzeit reicht nicht → keine Zeile begonnen', async () => {
    const s = speicher({ [PP]: fehlerZeile(), [eintragPfad()]: eintrag() });
    const matchLine = jest.fn();
    const b = await N.nachlauf({ db: s.db, matchLine, jetzt: () => JETZT, laufEndeAt: JETZT + N.ZEILE_MIN_REST_MS - 1 });
    expect(matchLine).not.toHaveBeenCalled();
    expect(b.abbruch).toBe('zeit');
    expect(s.docs.get(eintragPfad()).versuche).toBeUndefined();
  });

  it('matchLine wirft → Anspruch frei, neu geplant mit der Wartezeit des Versuchs', async () => {
    const s = speicher({ [PP]: fehlerZeile(), [eintragPfad()]: eintrag({ versuche: 1 }) });
    const errors = [];
    const b = await N.nachlauf({
      db: s.db,
      matchLine: async () => { throw new Error('UNAVAILABLE'); },
      logger: { info: () => {}, error: (m, d) => errors.push(d) },
      jetzt: () => JETZT,
    });
    expect(b.fehlerIntern).toBe(1);
    const e = s.docs.get(eintragPfad());
    expect(e).toMatchObject({ versuche: 2, laufBis: null });
    expect(e.naechsterAt.getTime()).toBe(JETZT + 360 * MIN);
    expect(errors[0].err).toBe('UNAVAILABLE');
  });

  it('wurde der Eintrag während des Versuchs neu geplant (Hand-Endpunkt), entfernt der Nachlauf ihn nicht', async () => {
    const s = speicher({ [PP]: fehlerZeile(), [eintragPfad()]: eintrag() });
    const matchLine = async () => {
      await s.db.collection(N.NACHLAUF_COLLECTION).doc(N.nachlaufDocId(PP)).set({ laufBis: null, naechsterAt: new Date(JETZT + 15 * MIN) }, { merge: true });
      return { status: 'needs_review' };
    };
    await N.nachlauf({ db: s.db, matchLine, jetzt: () => JETZT });
    expect(s.docs.has(eintragPfad())).toBe(true);
  });
});

// ─── 4. Ende zu Ende: Trigger scheitert, Nachlauf rettet, Zettel bleibt ──
describe('Ende zu Ende mit dem echten Matcher', () => {
  afterEach(() => jest.useRealTimers());

  it('erst pick-timeout, 15 min später Zuordnung — offener Zettel-Eintrag bleibt offen', async () => {
    jest.useFakeTimers({ now: JETZT });
    const zettel = 'users/u1/einkaufswagen/noname_p1';
    const s = ladeMatcher({
      generateContent: (params, n) => (n <= 2 ? haengtBisAbbruch(params) : { text: '{"lineType":"product","candidateIdx":0,"confidence":0.95}' }),
      startDocs: { ...KATALOG, [zettel]: { gekauft: false, productId: 'p1', journeyId: 'j1' } },
    });
    // Trigger: beide Pick-Versuche hängen
    const p = s.matcher.matchLine(ctx(s), { deadlineAt: JETZT + 100_000 });
    await jest.advanceTimersByTimeAsync(60_000);
    await expect(p).resolves.toMatchObject({ reason: 'pick-timeout' });
    expect(s.docs.has(eintragPfad())).toBe(true);

    // Erster Takt nach Ablauf der Wartezeit
    jest.setSystemTime(JETZT + 60_000 + 15 * MIN);
    s.docs.set(PP, { ...s.docs.get(PP), itemName: 'G&G Goldmais 140g', merchantId: 'lidl', priceCents: 99 });
    const b = await N.nachlauf({ db: s.db, matchLine: s.matcher.matchLine });
    expect(b).toMatchObject({ versucht: 1, gerettet: 1 });
    const pp = s.docs.get(PP);
    expect(pp).toMatchObject({ matchStatus: 'matched', productId: 'p1', matchNachlaufVersuch: 1, matchVersion: 1 });
    expect(pp).not.toHaveProperty('matchError');
    expect(pp).not.toHaveProperty('matchNachlauf');
    expect(s.docs.has(eintragPfad())).toBe(false);
    // noClose: der Zettel-Eintrag bleibt offen, keine Journey angefasst
    expect(s.docs.get(zettel).gekauft).toBe(false);
    expect(s.log.some((w) => w.path.includes('/journeys/'))).toBe(false);
  });
});

// ─── 5. Geplante Funktion: Takt, nie parallel, Schalter ──────────────
describe('matchNachlauf (index.js)', () => {
  function ladeIndex(startDocs = {}) {
    const s = speicher(startDocs);
    const matchLine = jest.fn(async () => ({ status: 'matched' }));
    const infos = [];
    let index;
    jest.isolateModules(() => {
      jest.doMock('firebase-admin', () => ({ apps: [], initializeApp: () => {}, firestore: () => s.db }));
      jest.doMock('firebase-functions/v2/firestore', () => ({ onDocumentWritten: (o, h) => ({ o, h }), onDocumentCreated: (o, h) => ({ o, h }) }));
      jest.doMock('firebase-functions/v2/https', () => ({ onRequest: (o, h) => ({ o, h }), onCall: (o, h) => ({ o, h }), HttpsError: class extends Error {} }));
      jest.doMock('firebase-functions/v2/scheduler', () => ({ onSchedule: (opts, handler) => ({ opts, handler }) }));
      jest.doMock('firebase-functions/params', () => ({ defineSecret: () => ({ value: () => 'x' }) }));
      jest.doMock('firebase-functions/logger', () => ({ info: (m, d) => infos.push({ m, d }), warn: () => {}, error: () => {} }));
      jest.doMock('../admin', () => ({}));
      jest.doMock('../gemini', () => ({ ai: () => ({}) }));
      jest.doMock('../matcher', () => ({ matchLine, MATCH_VERSION: 1, SCHREIB_RESERVE_MS: 20_000, parseSize: () => null }));
      index = require('../index');
    });
    return { index, matchLine, infos, ...s };
  }

  it('alle 15 Minuten, höchstens ein Durchgang gleichzeitig, kein Plattform-Retry', () => {
    const { index } = ladeIndex();
    expect(index.matchNachlauf.opts).toMatchObject({
      region: 'europe-west1',
      schedule: '*/15 * * * *',
      timeZone: 'Europe/Berlin',
      retryCount: 0,
      timeoutSeconds: 540,
      maxInstances: 1,
      concurrency: 1,
    });
  });

  it('läuft ohne Schalter-Dokument; _meta/zuordnungNachlauf.aktiv = false stoppt ihn', async () => {
    const start = { [PP]: fehlerZeile(), [eintragPfad()]: eintrag({ naechsterAt: new Date(Date.now() - MIN) }) };
    const an = ladeIndex(start);
    await an.index.matchNachlauf.handler();
    expect(an.matchLine).toHaveBeenCalledTimes(1);
    expect(an.matchLine.mock.calls[0][1]).toMatchObject({ noClose: true, nachlaufVersuch: 1 });

    const aus = ladeIndex({ ...start, '_meta/zuordnungNachlauf': { aktiv: false } });
    await aus.index.matchNachlauf.handler();
    expect(aus.matchLine).not.toHaveBeenCalled();
    expect(aus.infos.some((i) => /ausgeschaltet/.test(i.m))).toBe(true);
  });
});

// ─── 6. Altbestand der Störung ab 01.10. (Prüfbefund 08.10.2026) ─────
// Der alte Matcher schrieb jeden Pick-Fehler, auch jeden Zeitabbruch, als
// 'pick-failed' — ohne pickAttempts. Der Nachlauf allein holt diese Zeilen
// nie nach (kein Eintrag, 'pick-failed' nicht in NACHLAUF_GRUENDE). Nur ein
// ausdrücklich als Altbestand geplanter Eintrag (Einmal-Skript) nimmt sie an.
describe('Altbestand', () => {
  const alteZeile = (over = {}) => fehlerZeile({ matchError: 'pick-failed', matchNachlauf: undefined, ...over });
  const altEintrag = (over = {}) => eintrag({ matchError: 'pick-failed', altbestand: true, altArt: N.ALTBESTAND_ART.PICK_FAILED_ALT, ...over });

  it.each([
    ['alter Pick-Fehler (ohne pickAttempts)', alteZeile(), 'pick-failed-alt'],
    ['neuer 400 (mit pickAttempts) ist KEIN Altbestand', alteZeile({ pickAttempts: 1 }), null],
    ['nie fertig geschrieben', { itemName: 'x', merchantId: 'lidl' }, 'ohne-stand'],
    ['Ausnahme im Trigger', { itemName: 'x', matchStatus: 'error', matchError: 'Cannot read properties of undefined' }, 'trigger-ausnahme'],
    ['zugeordnet', fehlerZeile({ matchStatus: 'matched', matchError: undefined }), null],
    ['Zeitfehler des neuen Codes (macht der normale Nachlauf)', fehlerZeile(), null],
    ['nicht vergüteter Bon', alteZeile({ rewardEligible: false }), null],
    ['skipped_ineligible', { matchStatus: 'skipped_ineligible' }, null],
    ['kein Dokument', null, null],
  ])('altbestandArt: %s → %s', (_, pp, art) => {
    expect(N.altbestandArt(pp)).toBe(art);
  });

  it('planeAltbestand: Standard nur pick-failed-alt, kein versuche, Fälligkeit je Takt verteilt', () => {
    const p0 = N.planeAltbestand({ ppPath: PP, pp: alteZeile(), index: 0, jetzt: JETZT });
    expect(p0).toMatchObject({ art: 'pick-failed-alt', docId: 'u1__bon1_goldmais', ppFelder: { matchNachlauf: 'geplant' } });
    expect(p0.daten).toMatchObject({ uid: 'u1', ppId: 'bon1_goldmais', ppPath: PP, matchError: 'pick-failed', altbestand: true, altArt: 'pick-failed-alt', laufBis: null });
    expect(p0.daten).not.toHaveProperty('versuche');
    expect(p0.daten.naechsterAt.getTime()).toBe(JETZT);
    const takt = (i) => N.planeAltbestand({ ppPath: PP, pp: alteZeile(), index: i, jetzt: JETZT }).daten.naechsterAt.getTime() - JETZT;
    expect([N.ALTBESTAND_JE_TAKT - 1, N.ALTBESTAND_JE_TAKT, 2 * N.ALTBESTAND_JE_TAKT].map(takt)).toEqual([0, N.TAKT_MS, 2 * N.TAKT_MS]);
    expect(N.ALTBESTAND_JE_TAKT).toBeLessThan(N.LAUF_MAX_ZEILEN);
    // Ohne Freigabe der Art keine Zeile ohne Stand
    expect(N.planeAltbestand({ ppPath: PP, pp: { itemName: 'x' }, jetzt: JETZT })).toBeNull();
    expect(N.planeAltbestand({ ppPath: PP, pp: { itemName: 'x' }, jetzt: JETZT, arten: new Set(['ohne-stand']) })).toMatchObject({ art: 'ohne-stand' });
    expect(N.planeAltbestand({ ppPath: 'users/u1/einkaufswagen/x', pp: alteZeile(), jetzt: JETZT })).toBeNull();
  });

  it('ppId mit doppeltem Unterstrich bleibt vollständig (planeNachlauf und planeAltbestand)', () => {
    const pfad = 'users/u1/purchased_products/bon1__mais';
    expect(N.planeNachlauf({ ppPath: pfad, matchError: 'pick-429', jetzt: JETZT }).daten).toMatchObject({ uid: 'u1', ppId: 'bon1__mais' });
    expect(N.planeAltbestand({ ppPath: pfad, pp: alteZeile(), jetzt: JETZT }).daten).toMatchObject({ uid: 'u1', ppId: 'bon1__mais' });
  });

  it.each([
    ['Altbestand-Eintrag + alte Zeile → übernehmen', altEintrag(), alteZeile(), 'uebernehmen'],
    ['GEWÖHNLICHER Eintrag + alte Zeile → räumen (nur das Skript plant Altbestand)', eintrag({ matchError: 'pick-failed' }), alteZeile(), 'raeumen'],
    ['Altbestand-Eintrag, Zeile inzwischen mit echtem 400 (pickAttempts) → räumen', altEintrag(), alteZeile({ pickAttempts: 1 }), 'raeumen'],
    ['Altbestand-Eintrag, Zeile inzwischen zugeordnet → räumen', altEintrag(), alteZeile({ matchStatus: 'matched', matchError: undefined }), 'raeumen'],
    ['Altbestand-Eintrag, nicht vergütet → räumen', altEintrag(), alteZeile({ rewardEligible: false }), 'raeumen'],
    ['Altbestand-Eintrag, Zeile ohne Stand → übernehmen', altEintrag({ altArt: 'ohne-stand' }), { itemName: 'x', merchantId: 'lidl' }, 'uebernehmen'],
    ['Altbestand-Eintrag, nach erneutem Zeitfehler → übernehmen (normaler Weg)', altEintrag({ versuche: 1 }), fehlerZeile({ pickAttempts: 2 }), 'uebernehmen'],
    ['Altbestand-Eintrag, drei Versuche verbraucht → erschöpft', altEintrag({ versuche: 3 }), alteZeile(), 'erschoepft'],
  ])('nachlaufUrteil: %s', (_, e, pp, aktion) => {
    expect(N.nachlaufUrteil(e, pp, JETZT).aktion).toBe(aktion);
  });

  describe('Ende zu Ende mit dem echten Matcher', () => {
    afterEach(() => jest.useRealTimers());
    const start = (over = {}) => ({ ...KATALOG, [PP]: alteZeile(over), [eintragPfad()]: altEintrag() });

    it('Zuordnung: Zeile zugeordnet, Fehlerspuren weg, Eintrag weg, Zettel bleibt offen', async () => {
      jest.useFakeTimers({ now: JETZT });
      const zettel = 'users/u1/einkaufswagen/noname_p1';
      const s = ladeMatcher({ startDocs: { ...start(), [zettel]: { gekauft: false, productId: 'p1', journeyId: 'j1' } } });
      const b = await N.nachlauf({ db: s.db, matchLine: s.matcher.matchLine });
      expect(b).toMatchObject({ versucht: 1, gerettet: 1 });
      const pp = s.docs.get(PP);
      expect(pp).toMatchObject({ matchStatus: 'matched', productId: 'p1', matchNachlaufVersuch: 1 });
      for (const f of s.matcher.FEHLER_FELDER) expect(pp).not.toHaveProperty(f);
      expect(s.docs.has(eintragPfad())).toBe(false);
      expect(s.docs.get(zettel).gekauft).toBe(false);
    });

    it('echter 400: genau EIN weiterer Versuch, danach kein Eintrag mehr', async () => {
      jest.useFakeTimers({ now: JETZT });
      const s = ladeMatcher({ generateContent: async () => { throw Object.assign(new Error('bad'), { status: 400 }); }, startDocs: start() });
      const b = await N.nachlauf({ db: s.db, matchLine: s.matcher.matchLine });
      expect(b).toMatchObject({ versucht: 1, endgueltigFehler: 1 });
      expect(s.docs.get(PP)).toMatchObject({ matchError: 'pick-failed', pickAttempts: 1 });
      expect(s.docs.has(eintragPfad())).toBe(false);
      // Nächster Takt: nichts mehr zu tun
      expect(await N.nachlauf({ db: s.db, matchLine: s.matcher.matchLine })).toMatchObject({ gefunden: 0 });
    });

    it('erneuter Zeitabbruch: wie jede Zeile neu geplant (1 h), Altbestand-Kennung bleibt', async () => {
      jest.useFakeTimers({ now: JETZT });
      const s = ladeMatcher({ generateContent: haengtBisAbbruch, startDocs: start() });
      const p = N.nachlauf({ db: s.db, matchLine: s.matcher.matchLine });
      await jest.advanceTimersByTimeAsync(60_000);
      expect(await p).toMatchObject({ versucht: 1, erneutFehler: 1 });
      const e = s.docs.get(eintragPfad());
      expect(e).toMatchObject({ versuche: 1, laufBis: null, matchError: 'pick-timeout', altbestand: true });
      expect(e.naechsterAt.getTime()).toBe(JETZT + 50_000 + 60 * MIN);
      expect(s.docs.get(PP)).toMatchObject({ matchError: 'pick-timeout', matchNachlauf: 'geplant', pickAttempts: 2 });
    });
  });
});
