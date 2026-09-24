'use strict';
/**
 * Ablauf der Bon-Runde (src/bonRunde.js) gegen einen kleinen In-Memory-Firestore.
 * Nichts davon spricht mit Google: Firestore, Storage, Gemini und der Resolver
 * sind gemockt. Die Regeln selbst prüft __tests__/bonRegeln.test.js — hier geht
 * es um die Reihenfolge der Schritte, die Schreibvorgänge und den Bericht.
 */

// ── In-Memory-Firestore ────────────────────────────────────────────────
const mockStore = new Map(); // Pfad → Daten
const mockWrites = []; // jeder set() in Aufruf-Reihenfolge
const mockHooks = { vorQuery: null };
const mockSentinel = { __feld: 'serverTimestamp' };
const mockGenerate = jest.fn();
const mockResolver = jest.fn();
const mockBuckets = [];
const mockDateien = [];

function kopie(v) {
  if (Array.isArray(v)) return v.map(kopie);
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, kopie(x)]));
  }
  return v;
}
function auswahl(daten, felder) {
  if (!felder) return kopie(daten);
  return Object.fromEntries(felder.filter((f) => f in daten).map((f) => [f, kopie(daten[f])]));
}
function snapshot(pfad, daten, felder = null) {
  const d = daten === undefined ? undefined : auswahl(daten, felder);
  return {
    id: pfad.split('/').pop(),
    exists: d !== undefined,
    data: () => (d === undefined ? undefined : kopie(d)),
    get: (f) => (d === undefined ? undefined : kopie(d[f])),
  };
}
function docRef(pfad) {
  return {
    path: pfad,
    id: pfad.split('/').pop(),
    get: async () => snapshot(pfad, mockStore.get(pfad)),
    set: async (daten, opts) => {
      mockWrites.push({ path: pfad, data: kopie(daten), opts: opts || null });
      const vorher = mockStore.get(pfad);
      mockStore.set(pfad, opts && opts.merge && vorher ? { ...vorher, ...kopie(daten) } : kopie(daten));
    },
  };
}
function query(sammlung, filter = [], limit = null, felder = null) {
  return {
    where: (f, op, v) => {
      if (op !== '==') throw new Error(`Mock kennt nur ==, nicht ${op}`);
      return query(sammlung, [...filter, [f, v]], limit, felder);
    },
    limit: (n) => query(sammlung, filter, n, felder),
    select: (...fs) => query(sammlung, filter, limit, fs),
    get: async () => {
      if (mockHooks.vorQuery) mockHooks.vorQuery(sammlung, filter);
      let docs = [...mockStore.entries()]
        .filter(([p]) => p.startsWith(`${sammlung}/`) && p.split('/').length === 2)
        .filter(([, d]) => filter.every(([f, v]) => d[f] === v))
        .map(([p, d]) => snapshot(p, d, felder));
      if (limit != null) docs = docs.slice(0, limit);
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  };
}
const mockDb = {
  collection: (name) => ({ ...query(name), doc: (id) => docRef(`${name}/${id}`) }),
  doc: (pfad) => docRef(pfad),
  getAll: async (...refs) => Promise.all(refs.map((r) => r.get())),
};

jest.mock('firebase-admin', () => ({
  firestore: () => mockDb,
  storage: () => ({
    bucket: (name) => {
      mockBuckets.push(name);
      return {
        file: (pfad) => {
          mockDateien.push(pfad);
          return {
            getMetadata: async () => [{ contentType: 'image/jpeg' }],
            download: async () => [Buffer.from('bon-bild')],
          };
        },
      };
    },
  }),
}));
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => mockSentinel } }));
jest.mock('firebase-functions/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({ models: { generateContent: (...a) => mockGenerate(...a) } })),
  Type: { OBJECT: 'OBJECT', BOOLEAN: 'BOOLEAN', STRING: 'STRING', INTEGER: 'INTEGER' },
}));
jest.mock('../src/resolverAufruf', () => ({ resolverAufruf: (...a) => mockResolver(...a) }));

const { bonRunde } = require('../src/bonRunde');

// ── Fixtures ───────────────────────────────────────────────────────────
const T0 = Date.UTC(2026, 8, 25, 5, 45, 0); // 07:45 Europe/Berlin (Sommerzeit)
const TAG = '2026-09-25';
const LAUF = '2026-09-25_074500';
const uhr = { t: T0 };
let dateSpy;

const ts = (n) => ({ toMillis: () => n });
const lege = (pfad, daten) => mockStore.set(pfad, kopie(daten));
// Ein Bon, an dem nichts auszusetzen ist: Feld-Gate mit drei Zeugen einig.
const bon = (id, over = {}) => ({
  status: 'review', reviewReason: 'ocr_confidence_low', userId: 'u1',
  bonDate: '2026-09-23', bonTime: '10:45', bonTotalCents: 9374, cashbackCents: 8, eligibleItemCount: 20,
  createdAt: ts(1000), updatedAt: ts(5000),
  merchant: { id: 'kaufland', name: 'Kaufland' }, campaignId: 'sep', campaignIdAngewandt: 'sep',
  ocrFieldAgreement: { ok: true, zeugen: 3, konflikte: [] },
  storage: { bucket: 'p.appspot.com', path: `cashback-uploads/${id}.jpg` },
  contentHash: `c_${id}`, transactionHash: `t_${id}`, itemsHash: `i_${id}`,
  ...over,
});
const zweit = (over = {}) => ({ istKassenbon: true, manipuliert: false, markt: 'Kaufland', datum: '2026-09-23', endsummeCent: 9374, anzahlPositionen: 22, grund: 'klar lesbar', ...over });
const antwort = (v) => ({ text: JSON.stringify(v) });
const abbruch = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });

// Standard-Resolver: bucht wie der echte (Status + Betrag am Bon, Antwort mit creditedCents).
async function resolverBucht({ receiptId, decision }) {
  const pfad = `receipts/${receiptId}`;
  const d = mockStore.get(pfad);
  if (decision === 'approve') {
    mockStore.set(pfad, { ...d, status: 'approved', rejectReason: null, updatedAt: ts(9999) });
    return { ok: true, http: 200, status: 'approved', creditedCents: d.cashbackCents, capReason: null };
  }
  mockStore.set(pfad, { ...d, status: 'rejected', updatedAt: ts(9999) });
  return { ok: true, http: 200, status: 'rejected', rejectReason: 'x' };
}

const scharf = (extra = {}) => bonRunde({ dryRun: false, projekt: 'p', schluessel: 'k', ...extra });
const trocken = (extra = {}) => bonRunde({ dryRun: true, projekt: 'p', ...extra });
const bericht = () => mockStore.get(`ops_bonrunden/${TAG}`);
const fall = (id) => bericht().faelle.find((f) => f.id === id);
const bonWrites = () => mockWrites.filter((w) => w.path.startsWith('receipts/'));
const opsWrites = () => mockWrites.filter((w) => w.path.startsWith('ops_bonrunden/'));

beforeEach(() => {
  mockStore.clear();
  mockWrites.length = 0;
  mockBuckets.length = 0;
  mockDateien.length = 0;
  mockHooks.vorQuery = null;
  mockGenerate.mockReset();
  mockResolver.mockReset();
  uhr.t = T0;
  dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => uhr.t);
  lege('cashback_config/v1', { minItemsForPayout: 4 });
  lege('cashback_campaigns/sep', { budgetRemainingCents: 1000, minItems: 4, cashbackPerBonCents: 8 });
  mockGenerate.mockResolvedValue(antwort(zweit()));
  mockResolver.mockImplementation(resolverBucht);
});
afterEach(() => dateSpy.mockRestore());

// ── Trockenlauf ────────────────────────────────────────────────────────
describe('Trockenlauf', () => {
  it('entscheidet nichts, schreibt nur den Bericht — Lauf-Dokument zuerst mit laeuft:true', async () => {
    lege('receipts/b1', bon('b1'));
    const r = await trocken();

    expect(mockResolver).not.toHaveBeenCalled();
    expect(bonWrites()).toEqual([]);
    expect(mockStore.get('receipts/b1').status).toBe('review');

    // Erster Schreibvorgang überhaupt: das Lauf-Dokument mit laeuft:true.
    expect(mockWrites[0]).toEqual({
      path: `ops_bonrunden/${LAUF}`,
      data: { tag: TAG, lauf: LAUF, ausloeser: 'zeitplan', dryRun: true, laeuft: true, laufAt: mockSentinel },
      opts: null,
    });
    // Danach nur noch der Bericht: je Lauf und je Tag, derselbe Inhalt.
    expect(mockWrites.map((w) => w.path)).toEqual([`ops_bonrunden/${LAUF}`, `ops_bonrunden/${LAUF}`, `ops_bonrunden/${TAG}`]);
    expect(mockStore.get(`ops_bonrunden/${LAUF}`)).toEqual(bericht());

    expect(bericht()).toMatchObject({
      tag: TAG, lauf: LAUF, dryRun: true, laeuft: false, laufAt: mockSentinel,
      geprueft: 1, freigegeben: 1, gedeckelt: 0, abgelehnt: 0, offen: 0, technikFehler: 0, gebuchtCents: 0,
    });
    expect(bericht().faelle).toEqual([{ id: 'b1', markt: 'Kaufland', datum: '2026-09-23', entscheidung: 'freigeben', grund: null, hinweis: null, ergebnis: null }]);
    // Personenbezug bleibt aus dem Bericht.
    expect(JSON.stringify(bericht())).not.toContain('u1');

    // Das Bild kam aus dem Bucket des Projekts, der Pfad aus storage.path.
    expect(mockBuckets).toEqual(['p.appspot.com']);
    expect(mockDateien).toEqual(['cashback-uploads/b1.jpg']);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(r.laufAt).toEqual(expect.any(String));
  });

  it('vermerkt eine Beanstandung der Zweitlesung NICHT am Bon', async () => {
    lege('receipts/b1', bon('b1'));
    mockGenerate.mockResolvedValue(antwort(zweit({ endsummeCent: 12000 })));
    await trocken();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'summe_widerspricht' });
    expect(bonWrites()).toEqual([]);
    expect(mockStore.get('receipts/b1').bonRundeBeanstandet).toBeUndefined();
  });

  it('Vergleichsmodus schreibt gar nichts, auch kein Lauf-Dokument', async () => {
    lege('receipts/b1', bon('b1', { status: 'approved' }));
    const r = await bonRunde({ projekt: 'p', vergleich: ['b1', 'b1', 'gibtsnicht'] });
    expect(mockWrites).toEqual([]);
    expect(mockResolver).not.toHaveBeenCalled();
    expect(r.dryRun).toBe(true);
    expect(r.plan).toHaveLength(1);
    expect(r.plan[0]).toMatchObject({ id: 'b1', vorher: 'approved', entscheidung: 'freigeben' });
  });
});

// ── Scharf: Freigabe und Antwort des Resolvers ───────────────────────────
describe('scharf — Freigabe', () => {
  it('stimmiger Bon → Resolver approve, Bericht zählt die echte Buchung', async () => {
    lege('receipts/b1', bon('b1'));
    await scharf();

    expect(mockResolver).toHaveBeenCalledTimes(1);
    expect(mockResolver).toHaveBeenCalledWith({ receiptId: 'b1', schluessel: 'k', decision: 'approve' });
    expect(mockWrites[0].data).toMatchObject({ dryRun: false, laeuft: true });
    expect(bericht()).toMatchObject({ dryRun: false, freigegeben: 1, gedeckelt: 0, budgetEnde: 0, offen: 0, technikFehler: 0, gebuchtCents: 8 });
    expect(fall('b1')).toMatchObject({ entscheidung: 'freigeben', ergebnis: { http: 200, status: 'approved', grund: null, gebuchtCents: 8 } });
    // Einziger Schreibvorgang am Bon: wer entschieden hat.
    expect(bonWrites()).toEqual([{
      path: 'receipts/b1',
      data: { reviewConsole: { decidedBy: 'worker-bonrunde', decision: 'approve', reason: null, at: mockSentinel } },
      opts: { merge: true },
    }]);
  });

  it('Antwort no_reward mit Deckel-Grund → gedeckelt, NICHT freigegeben', async () => {
    lege('receipts/b1', bon('b1'));
    mockResolver.mockResolvedValueOnce({ ok: true, http: 200, status: 'no_reward', creditedCents: 0, capReason: 'daily_cap_reached' });
    await scharf();
    expect(bericht()).toMatchObject({ freigegeben: 0, gedeckelt: 1, budgetEnde: 0, gebuchtCents: 0 });
    expect(fall('b1').ergebnis).toEqual({ http: 200, status: 'no_reward', grund: 'daily_cap_reached', gebuchtCents: 0 });
  });

  it('Antwort no_reward ohne Deckel-Grund → Grund vom Bon nachgelesen, Budget-Ende gezählt', async () => {
    lege('receipts/b1', bon('b1'));
    mockResolver.mockImplementationOnce(async ({ receiptId }) => {
      const d = mockStore.get(`receipts/${receiptId}`);
      mockStore.set(`receipts/${receiptId}`, { ...d, status: 'no_reward', cashbackCents: 0, rejectReason: 'campaign_budget_exhausted' });
      return { ok: true, http: 200, status: 'no_reward', creditedCents: 0, capReason: null };
    });
    await scharf();
    expect(bericht()).toMatchObject({ freigegeben: 0, gedeckelt: 1, budgetEnde: 1, gebuchtCents: 0 });
    expect(fall('b1').ergebnis.grund).toBe('campaign_budget_exhausted');
  });

  it('Antwort approved ohne Betrag zählt als Freigabe mit 0 ct (Betrag nur aus creditedCents)', async () => {
    lege('receipts/b1', bon('b1'));
    mockResolver.mockResolvedValueOnce({ ok: true, http: 200, status: 'approved' });
    await scharf();
    expect(bericht()).toMatchObject({ freigegeben: 1, gebuchtCents: 0 });
  });
});

// ── Scharf: Fehler des Resolvers ─────────────────────────────────────────
describe('scharf — Resolver-Fehler', () => {
  it('409 → offen, kein technischer Fehler, keine Markierung am Bon', async () => {
    lege('receipts/b1', bon('b1'));
    mockResolver.mockResolvedValueOnce({ ok: false, http: 409, code: 'processing_in_progress', status: 'review' });
    await scharf();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'resolver_processing_in_progress', ergebnis: null });
    expect(bericht()).toMatchObject({ freigegeben: 0, offen: 1, technikFehler: 0, offenGruende: { resolver_processing_in_progress: 1 } });
    expect(bonWrites()).toEqual([]);
  });

  it.each([
    ['504 von Cloud Run', { ok: false, http: 504, raw: 'upstream request timeout' }],
    ['500 intern', { ok: false, http: 500, code: 'internal' }],
    ['Netzwerk-Abbruch', { ok: false, http: 0, code: 'netzwerk', message: 'The operation was aborted' }],
  ])('%s, der Resolver hat aber gebucht → nachgelesen, nicht „offen"', async (_, fehler) => {
    lege('receipts/b1', bon('b1'));
    mockResolver.mockImplementationOnce(async ({ receiptId }) => {
      const d = mockStore.get(`receipts/${receiptId}`);
      // Der Resolver rechnet den Betrag neu — gezählt wird, was am Bon steht.
      mockStore.set(`receipts/${receiptId}`, { ...d, status: 'approved', cashbackCents: 7, rejectReason: null, updatedAt: ts(9999) });
      return fehler;
    });
    await scharf();
    expect(fall('b1')).toMatchObject({ entscheidung: 'freigeben', ergebnis: { http: 0, status: 'approved', grund: null, gebuchtCents: 7, nachgelesen: true } });
    expect(bericht()).toMatchObject({ freigegeben: 1, gebuchtCents: 7, technikFehler: 0, offen: 0 });
  });

  it.each([
    ['504', { ok: false, http: 504, raw: 'upstream request timeout' }, 'resolver_504'],
    ['500', { ok: false, http: 500, code: 'internal' }, 'resolver_internal'],
    ['Netzwerk', { ok: false, http: 0, code: 'netzwerk', message: 'fetch failed' }, 'resolver_netzwerk'],
  ])('%s und der Bon steht noch in review → offen mit Technik-Fehler', async (_, fehler, grund) => {
    lege('receipts/b1', bon('b1'));
    mockResolver.mockResolvedValueOnce(fehler);
    await scharf();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund, ergebnis: null });
    expect(bericht()).toMatchObject({ freigegeben: 0, offen: 1, technikFehler: 1, gebuchtCents: 0 });
    expect(bonWrites()).toEqual([]);
  });

  it('403 (falscher Schlüssel) → offen mit Technik-Fehler', async () => {
    lege('receipts/b1', bon('b1'));
    mockResolver.mockResolvedValueOnce({ ok: false, http: 403, code: 'forbidden' });
    await scharf();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'resolver_forbidden' });
    expect(bericht().technikFehler).toBe(1);
  });
});

// ── Scharf: Gründe, NICHT zu entscheiden ─────────────────────────────────
describe('scharf — liegen lassen', () => {
  it('Bon zwischen Laden und Entscheidung neu verarbeitet (updatedAt) → offen „veraendert", kein Resolver', async () => {
    lege('receipts/b1', bon('b1'));
    mockGenerate.mockImplementation(async () => {
      // Während der Zweitlesung rechnet die Pipeline den Bon neu.
      mockStore.set('receipts/b1', { ...mockStore.get('receipts/b1'), bonTotalCents: 9999, updatedAt: ts(6000) });
      return antwort(zweit());
    });
    await scharf();
    expect(mockResolver).not.toHaveBeenCalled();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'veraendert', hinweis: 'Status jetzt review' });
    expect(bonWrites()).toEqual([]);
  });

  it('Bon inzwischen von Hand entschieden (Status) → offen „veraendert", kein Resolver', async () => {
    lege('receipts/b1', bon('b1'));
    mockGenerate.mockImplementation(async () => {
      mockStore.set('receipts/b1', { ...mockStore.get('receipts/b1'), status: 'approved' });
      return antwort(zweit());
    });
    await scharf();
    expect(mockResolver).not.toHaveBeenCalled();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'veraendert', hinweis: 'Status jetzt approved' });
  });

  it('Budget reicht nur für einen von zwei parallel entschiedenen Bons → der zweite bleibt offen', async () => {
    lege('cashback_campaigns/sep', { budgetRemainingCents: 10, minItems: 4 });
    lege('receipts/a1', bon('a1', { userId: 'a' }));
    lege('receipts/b1', bon('b1', { userId: 'b' }));
    // Der Resolver bucht erst, wenn beide die Prüfung hinter sich haben (parallel).
    mockResolver.mockImplementation(async (a) => {
      const r = await resolverBucht(a);
      const c = mockStore.get('cashback_campaigns/sep');
      mockStore.set('cashback_campaigns/sep', { ...c, budgetRemainingCents: c.budgetRemainingCents - 8 });
      return r;
    });
    await scharf();
    expect(mockResolver).toHaveBeenCalledTimes(1);
    const offen = ['a1', 'b1'].map(fall).filter((f) => f.entscheidung === 'offen');
    expect(offen).toHaveLength(1);
    expect(offen[0].grund).toBe('budget_leer');
  });

  it('eigene Buchung wird nicht doppelt abgezogen, wenn sie schon im frisch gelesenen Budget steckt (Prüfrunde 4)', async () => {
    lege('cashback_campaigns/sep', { budgetRemainingCents: 20, minItems: 4 });
    lege('receipts/a1', bon('a1', { userId: 'a' }));
    lege('receipts/b1', bon('b1', { userId: 'b' }));
    // Reihenfolge erzwingen: a1 bucht beim Resolver das Budget (20 → 12) und
    // antwortet noch nicht; erst DANN liest b1 die Aktion frisch. Die
    // Reservierung von a1 steht dann noch — die alte Rechnung „frisch −
    // reserviert" ergab 4 ct und ließ b1 fälschlich liegen.
    let a1Gebucht; const a1HatGebucht = new Promise((r) => { a1Gebucht = r; });
    let a1Weiter; const a1Antwort = new Promise((r) => { a1Weiter = r; });
    let lesungen = 0;
    mockGenerate.mockImplementation(async () => {
      if (++lesungen === 2) await a1HatGebucht; // die zweite Lesung (b1) wartet auf a1s Buchung
      return antwort(zweit());
    });
    mockResolver.mockImplementation(async (a) => {
      const c = mockStore.get('cashback_campaigns/sep');
      mockStore.set('cashback_campaigns/sep', { ...c, budgetRemainingCents: c.budgetRemainingCents - 8 });
      if (a.receiptId === 'a1') { a1Gebucht(); await a1Antwort; } else a1Weiter();
      return resolverBucht(a);
    });
    await scharf();
    expect(mockResolver.mock.calls.map(([a]) => a.receiptId).sort()).toEqual(['a1', 'b1']);
    expect(['a1', 'b1'].map((id) => fall(id).entscheidung)).toEqual(['freigeben', 'freigeben']);
  });

  it('Budget reicht nicht → offen „budget_leer", kein Resolver', async () => {
    lege('receipts/b1', bon('b1'));
    lege('cashback_campaigns/sep', { budgetRemainingCents: 5, minItems: 4 });
    await scharf();
    expect(mockResolver).not.toHaveBeenCalled();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'budget_leer', hinweis: 'sep: 5 ct übrig' });
    expect(bericht().offenGruende).toEqual({ budget_leer: 1 });
  });

  it('Budget-Feld fehlt an der Aktion → zählt als 0 wie im Resolver', async () => {
    lege('receipts/b1', bon('b1'));
    lege('cashback_campaigns/sep', { minItems: 4 });
    await scharf();
    expect(mockResolver).not.toHaveBeenCalled();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'budget_leer', hinweis: 'sep: 0 ct übrig' });
  });

  it('Aktion existiert nicht → offen „keine_aktion"', async () => {
    lege('receipts/b1', bon('b1'));
    mockStore.delete('cashback_campaigns/sep');
    await scharf();
    expect(mockResolver).not.toHaveBeenCalled();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'keine_aktion', hinweis: 'sep' });
  });

  it('Prüfgrund außerhalb der Lese-Sicherheit → offen, ohne Zweitlesung', async () => {
    lege('receipts/b1', bon('b1', { reviewReason: 'bon_date_future' }));
    await scharf();
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockResolver).not.toHaveBeenCalled();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'pruefgrund_bon_date_future' });
  });

  it('gleicher Markt/Tag/Endsumme bei einer anderen Person (gleicher contentHash, andere Uhrzeit) → offen', async () => {
    lege('receipts/b1', bon('b1', { contentHash: 'k|2026-09-23|9374' }));
    lege('receipts/x9', bon('x9', { userId: 'u2', status: 'approved', createdAt: ts(500), contentHash: 'k|2026-09-23|9374', bonTime: '18:02' }));
    await scharf();
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockResolver).not.toHaveBeenCalled();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'inhalt_wie_bon_anderer_person', hinweis: 'x9' });
  });
});

// ── Widerspruchs-Merker ──────────────────────────────────────────────────
describe('Beanstandung der Zweitlesung', () => {
  it('scharf: Merker mit updatedAtMs am Bon; am nächsten Lauf keine neue Lesung', async () => {
    lege('receipts/b1', bon('b1'));
    mockGenerate.mockResolvedValue(antwort(zweit({ endsummeCent: 12000, grund: 'Endsumme 120,00' })));
    await scharf();

    expect(mockResolver).not.toHaveBeenCalled();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'summe_widerspricht' });
    expect(bonWrites()).toEqual([{
      path: 'receipts/b1',
      data: {
        bonRundeBeanstandet: {
          tag: TAG,
          gruende: ['summe_widerspricht'],
          zweit: { datum: '2026-09-23', endsummeCent: 12000, markt: 'Kaufland', anzahlPositionen: 22 },
          grundText: 'Endsumme 120,00',
          updatedAtMs: 5000,
        },
      },
      opts: { merge: true },
    }]);

    // Späterer Lauf: der Merker gilt, es wird nicht so lange gelesen, bis es passt.
    uhr.t = T0 + 60 * 60 * 1000;
    mockGenerate.mockClear();
    mockGenerate.mockResolvedValue(antwort(zweit()));
    await scharf();
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockResolver).not.toHaveBeenCalled();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'frueher_beanstandet', hinweis: `${TAG}: summe_widerspricht` });
  });

  it('der Merker gilt nicht mehr, sobald der Bon neu verarbeitet wurde', async () => {
    lege('receipts/b1', bon('b1', {
      bonRundeBeanstandet: { tag: '2026-09-24', gruende: ['datum_widerspricht'], updatedAtMs: 4000 },
    }));
    await scharf();
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockResolver).toHaveBeenCalledWith({ receiptId: 'b1', schluessel: 'k', decision: 'approve' });
  });

  it('„nicht gelesen" wird ebenfalls gemerkt (sonst liest die Runde, bis es zufällig passt)', async () => {
    lege('receipts/b1', bon('b1'));
    mockGenerate.mockResolvedValue(antwort(zweit({ datum: '' })));
    await scharf();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'datum_nicht_gelesen' });
    expect(bonWrites()).toHaveLength(1);
    expect(bonWrites()[0].data.bonRundeBeanstandet).toMatchObject({ gruende: ['datum_nicht_gelesen'] });
  });

  it('Grenzlage, Budget und Technik werden NICHT gemerkt (sagen nichts über das Bild)', async () => {
    lege('cashback_campaigns/sep', { budgetRemainingCents: 0, minItems: 4 });
    lege('receipts/b1', bon('b1'));
    await scharf();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'budget_leer' });
    expect(bonWrites()).toEqual([]);
  });
});

// ── Doppel ───────────────────────────────────────────────────────────────
describe('Doppel', () => {
  it('gegen eine entschiedene eigene Kopie → reject duplicate_content_self mit duplicateOf', async () => {
    lege('receipts/b0', bon('b0', { status: 'approved', createdAt: ts(500), contentHash: 'gleich' }));
    lege('receipts/b1', bon('b1', { contentHash: 'gleich' }));
    await scharf();

    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockResolver).toHaveBeenCalledTimes(1);
    expect(mockResolver).toHaveBeenCalledWith({
      receiptId: 'b1', schluessel: 'k', decision: 'reject', reason: 'duplicate_content_self', duplicateOf: 'b0', priorStatus: 'approved',
    });
    expect(bericht()).toMatchObject({ abgelehnt: 1, freigegeben: 0, gebuchtCents: 0 });
    expect(fall('b1')).toMatchObject({ entscheidung: 'ablehnen', grund: 'duplicate_content_self', ergebnis: { http: 200, status: 'rejected' } });
    expect(bonWrites()[0].data.reviewConsole).toMatchObject({ decision: 'reject', reason: 'duplicate_content_self' });
  });

  it('gegen eine entschiedene fremde Kopie mit gleicher Transaktion → duplicate_content_cross_user', async () => {
    lege('receipts/x0', bon('x0', { userId: 'u2', status: 'paid', createdAt: ts(500), transactionHash: 'tx' }));
    lege('receipts/b1', bon('b1', { transactionHash: 'tx' }));
    await scharf();
    expect(mockResolver).toHaveBeenCalledWith({
      receiptId: 'b1', schluessel: 'k', decision: 'reject', reason: 'duplicate_content_cross_user', duplicateOf: 'x0', priorStatus: 'paid',
    });
  });

  it('zwei offene Kopien derselben Person: das Original zuerst freigegeben, die Kopie dann dagegen abgelehnt', async () => {
    lege('receipts/b0', bon('b0', { createdAt: ts(500), contentHash: 'gleich' }));
    lege('receipts/b1', bon('b1', { contentHash: 'gleich' }));
    await scharf();
    expect(mockResolver.mock.calls.map(([a]) => `${a.receiptId}:${a.decision}`)).toEqual(['b0:approve', 'b1:reject']);
    expect(fall('b1')).toMatchObject({ entscheidung: 'ablehnen', grund: 'duplicate_content_self' });
    expect(mockResolver).toHaveBeenLastCalledWith(expect.objectContaining({ duplicateOf: 'b0', priorStatus: 'approved' }));
  });

  it('bleibt das Original offen, sperrt es die Kopie nicht — beide warten', async () => {
    lege('receipts/b0', bon('b0', { createdAt: ts(500), contentHash: 'gleich' }));
    lege('receipts/b1', bon('b1', { contentHash: 'gleich' }));
    mockGenerate.mockResolvedValue(antwort(zweit({ endsummeCent: 12000 })));
    await scharf();
    expect(mockResolver).not.toHaveBeenCalled();
    expect(fall('b0')).toMatchObject({ entscheidung: 'offen', grund: 'summe_widerspricht' });
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'zwilling_unentschieden', hinweis: 'b0' });
  });

  it('Nachlesen nach Zeitüberschreitung: hat inzwischen ein Mensch entschieden, ist es nicht unser Ergebnis', async () => {
    lege('receipts/b1', bon('b1'));
    mockResolver.mockImplementation(async ({ receiptId }) => {
      const d = mockStore.get(`receipts/${receiptId}`);
      mockStore.set(`receipts/${receiptId}`, { ...d, status: 'approved', reviewConsole: { decidedBy: 'patrick-uid', decision: 'approve' } });
      return { ok: false, http: 0, code: 'netzwerk' };
    });
    await scharf();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'veraendert_nach_aufruf' });
    expect(mockStore.get('receipts/b1').reviewConsole.decidedBy).toBe('patrick-uid');
  });

  it('eine abgelehnte Kopie zählt nicht als Zwilling', async () => {
    lege('receipts/b0', bon('b0', { status: 'rejected', createdAt: ts(500), contentHash: 'gleich', bonTotalCents: 1 }));
    lege('receipts/b1', bon('b1', { contentHash: 'gleich' }));
    await scharf();
    expect(mockResolver).toHaveBeenCalledWith({ receiptId: 'b1', schluessel: 'k', decision: 'approve' });
  });
});

// ── Zweitlesung: Wiederholung und leere Antwort ─────────────────────────
describe('Zweitlesung', () => {
  it('AbortError einmal → genau eine Wiederholung, danach Erfolg', async () => {
    lege('receipts/b1', bon('b1'));
    mockGenerate.mockReset();
    mockGenerate.mockRejectedValueOnce(abbruch()).mockResolvedValueOnce(antwort(zweit()));
    await scharf();
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    // Jeder Versuch mit eigenem Zeitlimit.
    const [a1, a2] = mockGenerate.mock.calls.map(([arg]) => arg.config.abortSignal);
    expect(a1).toBeDefined();
    expect(a1).not.toBe(a2);
    expect(mockResolver).toHaveBeenCalledWith({ receiptId: 'b1', schluessel: 'k', decision: 'approve' });
    expect(bericht().freigegeben).toBe(1);
  });

  it('AbortError zweimal → offen „zweitlesung_gescheitert", keine dritte Lesung', async () => {
    lege('receipts/b1', bon('b1'));
    mockGenerate.mockReset();
    mockGenerate.mockRejectedValueOnce(abbruch()).mockRejectedValueOnce(abbruch()).mockResolvedValue(antwort(zweit()));
    await scharf();
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockResolver).not.toHaveBeenCalled();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'zweitlesung_gescheitert' });
    expect(fall('b1').hinweis).toMatch(/aborted/);
    // Ein Ausfall der Zweitlesung ist Technik — sonst bliebe ein Gemini-Ausfall ohne rote Warnung.
    expect(bericht().technikFehler).toBe(1);
  });

  it('400 INVALID_ARGUMENT wird nicht wiederholt → „bild_defekt" mit Merker, kein Technikfehler', async () => {
    lege('receipts/b1', bon('b1'));
    mockGenerate.mockReset();
    mockGenerate.mockRejectedValue(new Error('400 INVALID_ARGUMENT: Failed to decode image data'));
    await scharf();
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'bild_defekt' });
    expect(bericht().technikFehler).toBe(0);
    expect(bonWrites()[0].data.bonRundeBeanstandet).toMatchObject({ gruende: ['bild_defekt'] });
  });

  it('leere Antwort (text leer) ist nie „geprüft"', async () => {
    lege('receipts/b1', bon('b1'));
    mockGenerate.mockResolvedValue({ text: '' });
    await scharf();
    expect(mockResolver).not.toHaveBeenCalled();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'zweitlesung_gescheitert', hinweis: 'Zweitlesung ohne Inhalt' });
  });

  it('ohne Bildpfad keine Lesung', async () => {
    lege('receipts/b1', bon('b1', { storage: { bucket: 'p.appspot.com' } }));
    await scharf();
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'zweitlesung_gescheitert', hinweis: 'kein Bildpfad' });
  });
});

// ── Frist, Reihenfolge, Abbruch ──────────────────────────────────────────
describe('Frist und Abbruch', () => {
  it('Frist je Bon: nach Ablauf wird auch bei derselben Person nichts Neues begonnen', async () => {
    lege('receipts/b1', bon('b1', { createdAt: ts(1000) }));
    lege('receipts/b2', bon('b2', { createdAt: ts(2000), bonTotalCents: 4321, bonDate: '2026-09-22' }));
    mockResolver.mockImplementation(async (a) => { uhr.t = T0 + 9 * 60 * 1000 + 1; return resolverBucht(a); });
    await scharf();
    expect(mockResolver).toHaveBeenCalledTimes(1);
    expect(mockResolver).toHaveBeenCalledWith(expect.objectContaining({ receiptId: 'b1' }));
    expect(fall('b2')).toMatchObject({ entscheidung: 'offen', grund: 'zeit_abgelaufen' });
    expect(bericht()).toMatchObject({ geprueft: 2, freigegeben: 1, offenGruende: { zeit_abgelaufen: 1 }, dauerSekunden: 540 });
  });

  it('Personen, die nach der Frist erst drankämen, bleiben liegen (zeit_abgelaufen)', async () => {
    ['a', 'b', 'c', 'd'].forEach((u, i) => lege(`receipts/${u}1`, bon(`${u}1`, { userId: u, createdAt: ts(1000 + i), bonTotalCents: 9374 + i })));
    let erster = true;
    mockResolver.mockImplementation(async (a) => { if (erster) { erster = false; uhr.t = T0 + 10 * 60 * 1000; } return resolverBucht(a); });
    await scharf();
    // Drei Personen liefen schon (3 gleichzeitig), die vierte wird nicht mehr begonnen.
    expect(mockResolver).toHaveBeenCalledTimes(3);
    expect(fall('d1')).toMatchObject({ entscheidung: 'offen', grund: 'zeit_abgelaufen' });
    expect(bericht().geprueft).toBe(4);
  });

  it('Pro Person nacheinander, älteste zuerst; mehr Freigaben desselben Tages als das Tageslimit werden ausgewiesen', async () => {
    lege('receipts/b2', bon('b2', { createdAt: ts(2000), bonTotalCents: 9375 }));
    lege('receipts/b1', bon('b1', { createdAt: ts(1000) }));
    await scharf();
    expect(mockResolver.mock.calls.map(([a]) => a.receiptId)).toEqual(['b1', 'b2']);
    expect(fall('b1').hinweis).toBe('mehr Bons desselben Tages als das Tageslimit');
    expect(bericht().tagesKollisionen).toBe(1);
  });

  it('… nicht, solange das Tageslimit reicht (dailyCap 3)', async () => {
    lege('cashback_config/v1', { minItemsForPayout: 4, dailyCap: 3 });
    lege('receipts/b2', bon('b2', { createdAt: ts(2000), bonTotalCents: 9375 }));
    lege('receipts/b1', bon('b1', { createdAt: ts(1000) }));
    await scharf();
    expect(fall('b1').hinweis).toBeNull();
    expect(bericht().tagesKollisionen).toBe(0);
  });

  it('nach 12½ min wird der Resolver nicht mehr aufgerufen', async () => {
    lege('receipts/b1', bon('b1'));
    mockGenerate.mockImplementation(async () => { uhr.t = T0 + 12.5 * 60 * 1000 + 1; return antwort(zweit()); });
    await scharf();
    expect(mockResolver).not.toHaveBeenCalled();
    expect(fall('b1')).toMatchObject({ entscheidung: 'offen', grund: 'zeit_abgelaufen' });
  });

  it('bricht der Lauf ab, bleibt das Lauf-Dokument mit laeuft:true stehen, kein Tagesbericht', async () => {
    lege('receipts/b1', bon('b1'));
    mockHooks.vorQuery = (sammlung, filter) => {
      if (sammlung === 'receipts' && filter.some(([f]) => f === 'status')) throw new Error('DEADLINE_EXCEEDED');
    };
    await expect(scharf()).rejects.toThrow('DEADLINE_EXCEEDED');
    expect(mockStore.get(`ops_bonrunden/${LAUF}`)).toMatchObject({ laeuft: true, dryRun: false });
    expect(mockStore.has(`ops_bonrunden/${TAG}`)).toBe(false);
    expect(mockResolver).not.toHaveBeenCalled();
    expect(opsWrites()).toHaveLength(1);
  });

  it('ein Fehler an einem Bon (z. B. Lesefehler der Aktion) hält die Runde nicht an', async () => {
    lege('receipts/a1', bon('a1', { userId: 'a', campaignIdAngewandt: 'kaputt', bonTotalCents: 1111 }));
    lege('receipts/b1', bon('b1', { userId: 'b' }));
    const orig = mockDb.doc;
    mockDb.doc = (pfad) => (pfad === 'cashback_campaigns/kaputt'
      ? { ...orig(pfad), get: async () => { throw new Error('UNAVAILABLE'); } }
      : orig(pfad));
    try {
      await scharf();
    } finally {
      mockDb.doc = orig;
    }
    expect(fall('a1')).toMatchObject({ entscheidung: 'offen', grund: 'technik', hinweis: 'UNAVAILABLE' });
    expect(fall('b1')).toMatchObject({ entscheidung: 'freigeben' });
    expect(bericht()).toMatchObject({ technikFehler: 1, freigegeben: 1 });
  });
});
