'use strict';
/**
 * Prüfkonsole (index.js, reviewDecideUploads / reviewQueue) gegen einen
 * In-Memory-Firestore — die Verdrahtung der Entscheidungen Patrick vom
 * 02.10.2026:
 *  - gesperrte Konten gibt die Konsole NIE frei, auch nicht mit force,
 *  - ein Lesefehler der Sperre führt nicht zur Freigabe,
 *  - Wochen-Sperre und abweichende Barcode-Nummer blockieren ohne force,
 *  - eine Ablehnung wegen Wochen-Sperre (auch mit dem alten 30-Tage-Code einer
 *    noch nicht neu ausgerollten Oberfläche) landet als `doppelt_eingereicht`.
 */
const mockStore = new Map();
const mockLage = { sperreFehler: false };
const mockCreate = new Map(); // Dokumentpfad → Server-Zeitpunkt (createTime)
const mockSentinel = { __feld: 'serverTimestamp' };
const mockDelete = { __feld: 'delete' };

function kopie(v) {
  if (Array.isArray(v)) return v.map(kopie);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, kopie(x)]));
  return v;
}
function snapshot(pfad, daten) {
  const d = daten === undefined ? undefined : kopie(daten);
  const createTime = mockCreate.has(pfad) ? { toMillis: () => mockCreate.get(pfad) } : undefined;
  return { id: pfad.split('/').pop(), exists: d !== undefined, createTime, data: () => (d === undefined ? undefined : kopie(d)), get: (f) => (d === undefined ? undefined : kopie(d[f])) };
}
function docRef(pfad) {
  return {
    path: pfad, id: pfad.split('/').pop(),
    get: async () => {
      if (pfad.startsWith('cashback_sperren/') && mockLage.sperreFehler) throw new Error('UNAVAILABLE');
      return snapshot(pfad, mockStore.get(pfad));
    },
  };
}
function query(sammlung, filter = []) {
  return {
    where: (f, op, v) => query(sammlung, [...filter, [f, op, v]]),
    select: () => query(sammlung, filter),
    limit: () => query(sammlung, filter),
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    get: async () => {
      if (sammlung === 'cashback_sperren' && mockLage.sperreFehler) throw new Error('UNAVAILABLE');
      const docs = [...mockStore.entries()]
        .filter(([p]) => p.startsWith(`${sammlung}/`) && p.split('/').length === 2)
        .filter(([, d]) => filter.every(([f, op, v]) => {
          const wert = f.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
          return op === '==' ? wert === v : op === 'in' ? v.includes(wert) : true;
        }))
        .map(([p, d]) => snapshot(p, d));
      return { docs, size: docs.length, empty: !docs.length };
    },
  };
}
function anwenden(pfad, daten) {
  const neu = { ...(mockStore.get(pfad) || {}) };
  for (const [k, v] of Object.entries(kopie(daten))) {
    if (v && v.__feld === 'delete') delete neu[k];
    else neu[k] = v;
  }
  mockStore.set(pfad, neu);
}
const mockDb = {
  collection: (name) => ({ ...query(name), doc: (id) => docRef(`${name}/${id}`) }),
  doc: (pfad) => docRef(pfad),
  getAll: async (...args) => Promise.all(args.filter((a) => a && a.path).map((r) => r.get())),
  runTransaction: async (fn) => {
    const ops = [];
    const r = await fn({ get: (x) => x.get(), update: (ref, daten) => ops.push([ref.path, daten]) });
    for (const [p, d] of ops) anwenden(p, d);
    return r;
  },
};

jest.mock('firebase-admin', () => {
  const firestore = () => mockDb;
  firestore.Timestamp = { fromMillis: (t) => ({ toMillis: () => t }) };
  return { initializeApp: () => {}, firestore, storage: () => ({ bucket: () => ({ name: 'b', file: () => ({ getMetadata: async () => [{}] }) }) }) };
});
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => mockSentinel, delete: () => mockDelete } }));
jest.mock('firebase-functions/logger', () => ({ info: () => {}, warn: () => {}, error: () => {} }));
jest.mock('firebase-functions/params', () => ({ defineSecret: () => ({ value: () => 'k' }) }));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (o, fn) => fn }));
jest.mock('firebase-functions/v2/https', () => ({
  onCall: (o, fn) => fn,
  onRequest: (o, fn) => fn,
  HttpsError: class HttpsError extends Error { constructor(code, msg) { super(msg); this.code = code; } },
}));

const konsole = require('../index');

const TAG_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 2, 10, 0, 0);
const EAN = '4061464833821';
const ANDERE = '4000417025005';
const FOTOS = Object.fromEntries(['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'].map((s) => [s, `crowduploads/u/x/${s}.jpg`]));
const ts = (n) => ({ toMillis: () => n });
const lege = (id, extra = {}) => mockStore.set(`crowd_uploads/${id}`, {
  userId: 'u1', ean: EAN, status: 'pending', createdAt: ts(T0), marketId: 'rewe', images: FOTOS,
  productNameOcr: 'Skyr', priceOcr: { priceCents: 129 }, manufacturerOcr: { name: 'Milsani' }, ...extra,
});
const admin = { auth: { uid: 'patrick', token: { admin: true } } };
const entscheide = (data) => konsole.reviewDecideUploads({ ...admin, data });
const doc = (id) => mockStore.get(`crowd_uploads/${id}`);

beforeEach(() => { mockStore.clear(); mockCreate.clear(); mockLage.sperreFehler = false; });

describe('Freigabe in der Prüfkonsole', () => {
  it('sauberer Fall → freigegeben', async () => {
    lege('k');
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'approved' });
    expect(doc('k').status).toBe('approved');
  });

  it('gesperrtes Konto → verweigert, AUCH mit force und Begründung', async () => {
    mockStore.set('cashback_sperren/u1', { gesperrt: true, quelle: 'Entscheidung Patrick 02.10.2026' });
    lege('k');
    const ohne = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(ohne.results[0]).toEqual({ id: 'k', outcome: 'refused', reason: 'konto_gesperrt' });
    const mit = await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'ich will aber' });
    expect(mit.results[0]).toEqual({ id: 'k', outcome: 'refused', reason: 'konto_gesperrt' });
    expect(doc('k').status).toBe('pending');
  });

  it('unklarer Sperr-Eintrag (ohne gesperrt-Feld) → gesperrt wie auf der Gutschrift-Seite, verweigert auch mit force (Prüfrunde 2)', async () => {
    mockStore.set('cashback_sperren/u1', { grund: 'ohne gesperrt-Feld' });
    lege('k');
    expect((await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'x x x' })).results[0]).toMatchObject({ outcome: 'refused', reason: 'konto_gesperrt' });
  });

  it('Sperre nicht lesbar → keine Freigabe (Fehler statt Freigabe)', async () => {
    mockLage.sperreFehler = true;
    lege('k');
    const r = await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'trotzdem' });
    expect(r.results[0].outcome).toBe('error');
    expect(doc('k').status).toBe('pending');
  });

  it('Wochen-Sperre: eigene Freigabe 3 Tage vorher mit anderem Preis → blockiert, mit force + Notiz möglich', async () => {
    lege('alt', { status: 'approved', createdAt: ts(T0 - 3 * TAG_MS), priceOcr: { priceCents: 99 }, marketId: 'netto' });
    lege('k');
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'sperre_woche_gleicher_nutzer' });
    const f = await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'Patrick: neues Rezept' });
    expect(f.results[0].outcome).toBe('approved');
    expect(doc('k').review).toMatchObject({ forced: true, forcedNote: 'Patrick: neues Rezept' });
  });

  it('Barcode-Foto zeigt andere Nummer → blockiert (ein Mensch entscheidet mit Begründung)', async () => {
    lege('k', { eanFotoOcr: { ean: ANDERE, befund: 'abweichend' } });
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_abweichend' });
  });

  it('zwei Lesungen der Runde uneinig → blockiert als ean_unsicher', async () => {
    lege('k', { eanFotoOcr: { ean: ANDERE, befund: 'unsicher', zweit: null } });
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_unsicher' });
  });

  it('Wochen-Sperre über eine andere Schreibweise derselben GTIN („0" + EAN-13) → blockiert (Prüfrunde 02.10.)', async () => {
    lege('alt', { status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    lege('k', { ean: '0' + EAN });
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'sperre_woche_gleicher_nutzer' });
    // und umgekehrt, auch über die nachgelesene EAN
    mockStore.clear();
    lege('alt', { status: 'approved', createdAt: ts(T0 - 2 * TAG_MS), ean: null, eanRescueOcr: '0' + EAN });
    lege('k');
    expect((await entscheide({ ids: ['k'], decision: 'approve' })).results[0]).toMatchObject({ outcome: 'blocked', reason: 'sperre_woche_gleicher_nutzer' });
  });

  it('verschobenes createdAt hebt die Wochen-Sperre nicht auf: es gilt der Server-Zeitpunkt (Prüfrunde 02.10.)', async () => {
    lege('alt', { status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    lege('k', { createdAt: ts(T0 - 40 * TAG_MS) });
    mockCreate.set('crowd_uploads/k', T0);
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'sperre_woche_gleicher_nutzer' });
  });
});

describe('Ablehnung in der Prüfkonsole: Code am Dokument für die App', () => {
  it('Wochen-Sperre → rejectReason doppelt_eingereicht, gewählter Grund in review.reason, Frist gesetzt', async () => {
    lege('alt', { status: 'approved', createdAt: ts(T0 - 2 * TAG_MS) });
    lege('k');
    await entscheide({ ids: ['k'], decision: 'reject', reason: 'sperre_woche_gleicher_nutzer' });
    expect(doc('k')).toMatchObject({ status: 'rejected', rejectReason: 'doppelt_eingereicht', holdReasons: ['doppelt_eingereicht'] });
    expect(doc('k').review).toMatchObject({ reason: 'sperre_woche_gleicher_nutzer', lockUntil: T0 - 2 * TAG_MS + 7 * TAG_MS });
  });

  it('alter 30-Tage-Code aus einer noch nicht neu ausgerollten Oberfläche → ebenfalls doppelt_eingereicht', async () => {
    lege('k');
    await entscheide({ ids: ['k'], decision: 'reject', reason: 'sperre_30_tage_gleicher_nutzer' });
    expect(doc('k')).toMatchObject({ rejectReason: 'doppelt_eingereicht', review: { reason: 'sperre_30_tage_gleicher_nutzer' } });
  });

  it('andere Gründe bleiben unverändert', async () => {
    lege('k');
    await entscheide({ ids: ['k'], decision: 'reject', reason: 'unvollstaendig' });
    expect(doc('k').rejectReason).toBe('unvollstaendig');
  });
});

describe('Warteschlange', () => {
  it('zeigt gesperrte Konten als gesperrt (am Ende), unabhängig vom EAN-Zwischenspeicher', async () => {
    lege('k');
    lege('j', { userId: 'u2', ean: ANDERE, createdAt: ts(T0 + 1000) });
    mockStore.set('cashback_sperren/u1', { gesperrt: true });
    const r = await konsole.reviewQueue({ ...admin, data: { type: 'photos' } });
    expect(r.rows.map((x) => x.id)).toEqual(['j', 'k']);
    expect(r.rows[1]).toMatchObject({ id: 'k', verdict: 'locked', reasons: ['konto_gesperrt'], gesperrt: true });
    expect(r.rows[0].verdict).toBe('ok');
    expect(r.counts.gesperrt).toBe(1);
  });
});

describe('Fallansicht (reviewGetUpload): Nachbarn in jeder Schreibweise', () => {
  it('Freigabe unter „0" + EAN-13 ist Nachbar und Referenz der Wochen-Sperre', async () => {
    lege('alt', { status: 'approved', createdAt: ts(T0 - 2 * TAG_MS), ean: '0' + EAN });
    lege('k');
    const r = await konsole.reviewGetUpload({ ...admin, data: { id: 'k' } });
    expect(r.sameEan.map((x) => x.id)).toEqual(['alt']);
    expect(r.precheck).toMatchObject({ verdict: 'locked', dup: { priorId: 'alt' } });
    expect(r.prior.id).toBe('alt');
  });
});

describe('Befunde der Morgenrunde (review.rundeOffen, Prüfrunde 2, 02.10.2026)', () => {
  const rundeOffen = (code, extra = {}) => ({ review: { rundeOffen: { grund: code, hinweis: 'Gleiches Foto bei anderem Konto: x', sperrend: [code], lauf: '2026-10-02_080000', trocken: false, ...extra } } });

  it('Foto eines anderen Kontos: ohne force blockiert — mit force + Notiz freigegeben, der Eintrag geht mit', async () => {
    lege('k', rundeOffen('foto_fremdes_konto'));
    const r = await entscheide({ ids: ['k'], decision: 'approve' });
    expect(r.results[0]).toMatchObject({ outcome: 'blocked', reason: 'foto_fremdes_konto' });
    expect(doc('k').status).toBe('pending');
    // force ohne Notiz lehnt der Server ab
    await expect(entscheide({ ids: ['k'], decision: 'approve', force: true })).rejects.toThrow(/Notiz/);
    const f = await entscheide({ ids: ['k'], decision: 'approve', force: true, note: 'Familienkonto, gleiches Foto geteilt' });
    expect(f.results[0].outcome).toBe('approved');
    expect(doc('k').review).toMatchObject({ forced: true, forcedNote: 'Familienkonto, gleiches Foto geteilt', precheck: { verdict: 'hold', reasons: ['foto_fremdes_konto'] } });
    expect(doc('k').review.rundeOffen).toBeUndefined();
  });

  it('jeder sperrende Befund blockiert ohne force', async () => {
    for (const code of ['foto_aeltere_offen', 'bilder_wiederverwendet', 'ean_abweichend', 'ean_unsicher']) {
      mockStore.clear();
      lege('k', rundeOffen(code));
      expect((await entscheide({ ids: ['k'], decision: 'approve' })).results[0]).toMatchObject({ outcome: 'blocked', reason: code });
    }
  });

  it('Barcode-Befund nur in rundeOffen (eanFotoOcr nicht gespeichert) → trotzdem blockiert', async () => {
    lege('k', rundeOffen('ean_abweichend', { eanFoto: { befund: 'abweichend', ean: ANDERE, bestaetigt: true } }));
    expect(doc('k').eanFotoOcr).toBeUndefined();
    expect((await entscheide({ ids: ['k'], decision: 'approve' })).results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_abweichend' });
  });

  it('gespeicherter Barcode-Befund mit ungültiger erster Lesung → blockiert als ean_unsicher', async () => {
    lege('k', { eanFotoOcr: { ean: '4013602313647', befund: 'unsicher', zweit: null } });
    expect((await entscheide({ ids: ['k'], decision: 'approve' })).results[0]).toMatchObject({ outcome: 'blocked', reason: 'ean_unsicher' });
  });

  it('nur Information (z. B. Bildprüfung gescheitert) → Freigabe ohne force möglich', async () => {
    lege('k', rundeOffen('bild_audit_gescheitert', { sperrend: [] }));
    expect((await entscheide({ ids: ['k'], decision: 'approve' })).results[0].outcome).toBe('approved');
  });

  it('Ablehnung nimmt den Eintrag mit; „Zurückstellen" (hold) lässt ihn stehen', async () => {
    lege('a', rundeOffen('foto_fremdes_konto'));
    lege('h', rundeOffen('foto_fremdes_konto'));
    await entscheide({ ids: ['a'], decision: 'reject', reason: 'bilder_wiederverwendet' });
    expect(doc('a').review.rundeOffen).toBeUndefined();
    await entscheide({ ids: ['h'], decision: 'hold', reason: 'nachfragen' });
    expect(doc('h').review.rundeOffen).toMatchObject({ sperrend: ['foto_fremdes_konto'] });
  });

  it('Warteschlange und Fallansicht zeigen „zurückhalten" mit dem Grund der Runde', async () => {
    lege('k', rundeOffen('foto_fremdes_konto'));
    const q = await konsole.reviewQueue({ ...admin, data: { type: 'photos' } });
    expect(q.rows[0]).toMatchObject({ id: 'k', verdict: 'hold', reasons: ['foto_fremdes_konto'] });
    const c = await konsole.reviewCases({ ...admin, data: { type: 'photos', ids: ['k'] } });
    expect(c.cases[0].precheck).toMatchObject({ verdict: 'hold', reasons: ['foto_fremdes_konto'], quelle: 'frisch' });
    expect(c.cases[0].row.rundeOffen).toMatchObject({ grund: 'foto_fremdes_konto', hinweis: 'Gleiches Foto bei anderem Konto: x', sperrend: ['foto_fremdes_konto'] });
    const g = await konsole.reviewGetUpload({ ...admin, data: { id: 'k' } });
    expect(g.precheck).toMatchObject({ verdict: 'hold', reasons: ['foto_fremdes_konto'] });
  });
});
