'use strict';
/**
 * Live-Schatten (src/liveSchatten.js, Entscheidung Patrick 05.11.2026) gegen
 * einen kleinen In-Memory-Firestore, eine gemockte Storage-Liste und eine
 * gemockte Bildprüfung — wie __tests__/taeglicheRunde.test.js. Geprüft wird:
 *  - Einzelfall-Einstieg: dieselbe Entscheidung wie der Stapel (dieselben Funktionen),
 *  - Schalter `fotoLive` (false | 'shadow' | true → wie 'shadow'),
 *  - Betrugsschutz (neue Konten, Vielreicher) ohne Modellaufruf,
 *  - Idempotenz bei doppelter Zustellung,
 *  - der Schatten entscheidet nichts: nur `crowd_live_schatten/{id}` wird geschrieben,
 *  - Abgleich im Tagesbericht, ohne dass sich eine Entscheidung der Runde ändert.
 */

// ── In-Memory-Firestore (Ausschnitt aus taeglicheRunde.test.js, plus tx.set) ──
const mockStore = new Map();
const mockWrites = [];
const mockListe = new Map(); // Pfad → { md5, size }
const mockAudit = new Map(); // Pfad des ean-Fotos → eanFoto-Antwort
const mockCreate = new Map(); // Dokumentpfad → createTime (ms)
const mockLage = { aufrufe: [], labels: [], preisNachlese: new Map() };
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
  return { id: pfad.split('/').pop(), ref: docRef(pfad), exists: d !== undefined, createTime, data: () => (d === undefined ? undefined : kopie(d)), get: (f) => (d === undefined ? undefined : kopie(d[f])) };
}
function setzePfad(obj, pfad, v) {
  const teile = pfad.split('.');
  let o = obj;
  for (const t of teile.slice(0, -1)) { o[t] = o[t] && typeof o[t] === 'object' ? { ...o[t] } : {}; o = o[t]; }
  const letztes = teile[teile.length - 1];
  if (v && v.__feld === 'delete') delete o[letztes]; else o[letztes] = v;
}
function anwenden(pfad, daten, merge) {
  const neu = { ...(merge ? mockStore.get(pfad) || {} : {}) };
  for (const [k, v] of Object.entries(kopie(daten))) setzePfad(neu, k, v);
  if (pfad.startsWith('crowd_uploads/') && daten.status === 'approved') Object.assign(neu, { rewardResult: 'credited', rewardCents: 15 });
  mockStore.set(pfad, neu);
}
function docRef(pfad) {
  return {
    path: pfad, id: pfad.split('/').pop(),
    get: async () => snapshot(pfad, mockStore.get(pfad)),
    set: async (daten, opts) => { mockWrites.push({ path: pfad, art: 'set', data: kopie(daten) }); anwenden(pfad, daten, opts && opts.merge); },
    update: async (daten) => { mockWrites.push({ path: pfad, art: 'update', data: kopie(daten) }); anwenden(pfad, daten, true); },
  };
}
const msVon = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v);
function query(sammlung, filter = []) {
  return {
    where: (f, op, v) => query(sammlung, [...filter, [f, op, v]]),
    select: () => query(sammlung, filter),
    limit: () => query(sammlung, filter),
    count: () => ({ get: async () => { const r = await query(sammlung, filter).get(); return { data: () => ({ count: r.size }) }; } }),
    get: async () => {
      const docs = [...mockStore.entries()]
        .filter(([p]) => p.startsWith(`${sammlung}/`) && p.split('/').length === 2)
        .filter(([, d]) => filter.every(([f, op, v]) => (op === '==' ? d[f] === v : msVon(d[f]) >= msVon(v))))
        .map(([p, d]) => snapshot(p, d));
      return { docs, size: docs.length, empty: !docs.length };
    },
  };
}
const mockDb = {
  collection: (name) => ({ ...query(name), doc: (id) => docRef(`${name}/${id}`) }),
  doc: (pfad) => docRef(pfad),
  getAll: async (...refs) => Promise.all(refs.map((r) => r.get())),
  runTransaction: async (fn) => {
    const ops = [];
    const tx = {
      get: (ref) => ref.get(),
      update: (ref, daten) => ops.push(['update', ref.path, daten]),
      set: (ref, daten, opts) => ops.push(['set', ref.path, daten, opts]),
    };
    const r = await fn(tx);
    for (const [art, p, daten, opts] of ops) {
      mockWrites.push({ path: p, art: art === 'set' && !(opts && opts.merge) ? 'set' : 'update', data: kopie(daten) });
      anwenden(p, daten, art === 'update' || !!(opts && opts.merge));
    }
    return r;
  },
};

jest.mock('firebase-admin', () => {
  const firestore = () => mockDb;
  firestore.Timestamp = { fromMillis: (t) => ({ toMillis: () => t }) };
  return {
    firestore,
    storage: () => ({
      bucket: () => ({
        getFiles: async () => [[...mockListe.entries()].map(([name, m]) => ({ name, md5Hash: m.md5, size: String(m.size) })), null],
        file: (p) => ({
          getMetadata: async () => { const m = mockListe.get(p); if (!m) throw new Error('No such object'); return [{ md5Hash: m.md5, size: String(m.size) }]; },
          download: async (opts) => {
            if (!opts) return [Buffer.from(p)];
            return [require('./helpers/bildKopfDaten').jpeg(3000, 4000)];
          },
        }),
      }),
    }),
  };
});
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => mockSentinel, delete: () => mockDelete } }));
jest.mock('firebase-functions/logger', () => ({ info: () => {}, warn: () => {}, error: () => {} }));
jest.mock('@google/genai', () => ({
  GoogleGenAI: function GoogleGenAI() {
    return {
      models: {
        generateContent: async ({ contents, config }) => {
          const parts = contents[0].parts;
          const text = parts.map((p) => p.text || '').join('\n');
          const pfade = parts.filter((p) => p.fileData).map((p) => p.fileData.fileUri.replace('gs://b/', ''));
          mockLage.labels.push(config && config.labels);
          mockLage.aufrufe.push({ text, pfade, config });
          if (text.includes('Lies die EAN/GTIN')) {
            const z = mockAudit.get(pfade[0]);
            return { text: JSON.stringify({ ean: z, sicher: true }) };
          }
          if (text.includes('Lies zwei Angaben, sonst nichts')) {
            const liste = mockLage.preisNachlese.get(pfade.find((p) => p.endsWith('/preis.jpg'))) || [];
            const a = liste.shift() || { priceCents: 0, priceImageKind: 'produktfoto', manufacturer: '' };
            return { text: JSON.stringify(a) };
          }
          const eanPfad = pfade.find((p) => p.includes('/ean'));
          const eanFoto = mockAudit.has(eanPfad) ? mockAudit.get(eanPfad) : (eanPfad || '').split('/')[1];
          return { text: JSON.stringify({ echt: true, loseWare: false, traegtAngaben: true, gleicheAnsicht: false, preisSichtbar: true, eanFoto, grund: 'ok' }) };
        },
      },
    };
  },
}));
jest.mock('../src/strichcode', () => {
  const echt = jest.requireActual('../src/strichcode');
  return { ...echt, liesBild: async () => ({ gelesen: [] }) };
});

const { GoogleGenAI } = require('@google/genai');
const { taeglicheRunde } = require('../src/taeglicheRunde');
const ls = require('../src/liveSchatten');
const { schattenVergleich, fallKennung, quantil, SCHATTEN_COL } = require('../src/liveSchattenBericht');

// ── Fixtures ───────────────────────────────────────────────────────────
const TAG_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 5, 15, 0, 0); // Nachmittag, Einreichung gerade fertig gelesen
const EAN = '4061464833821';
const ANDERE = '4000417025005';
const SLOTS = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];
const ts = (n) => ({ toMillis: () => n });
const ALTES_KONTO = T0 - 90 * TAG_MS;

function einreichung(id, { uid = 'u1', ean = EAN, status = 'pending', createdAt = T0 - 60 * 1000, preis = 129, ...rest } = {}) {
  const images = Object.fromEntries(SLOTS.map((s) => [s, `crowduploads/${s === 'ean' ? ean : uid}/${id}/${s}.jpg`]));
  for (const s of SLOTS) mockListe.set(images[s], { md5: `md5_${id}_${s}`, size: 200000 + s.length });
  mockStore.set(`crowd_uploads/${id}`, {
    userId: uid, ean, status, createdAt: ts(createdAt), marketId: 'rewe', marketName: 'rewe', images,
    productNameOcr: `Produkt ${id}`, priceOcr: preis ? { priceCents: preis } : null, manufacturerOcr: { name: 'Hersteller GmbH' },
    productNameOcrAt: ts(createdAt + 20000),
    ...rest,
  });
  mockCreate.set(`crowd_uploads/${id}`, createdAt);
}
const upload = (id) => mockStore.get(`crowd_uploads/${id}`);
const schatten = (id) => mockStore.get(`${SCHATTEN_COL}/${id}`);
const werte = { stamp: () => mockSentinel };
const konten = new Map();
const kontoErstellt = async (uid) => { const t = konten.has(uid) ? konten.get(uid) : ALTES_KONTO; if (t === 'FEHLER') throw new Error('user-not-found'); return t; };
const lauf = (id, extra = {}) => ls.schattenFall({ db: mockDb, id, projekt: 'p', bucketName: 'b', ai: new GoogleGenAI(), kontoErstellt, werte, uhr: () => T0, ...extra });
const nurSchattenGeschrieben = () => mockWrites.every((w) => w.path.startsWith(`${SCHATTEN_COL}/`));
let dateSpy;

beforeEach(() => {
  mockStore.clear(); mockWrites.length = 0; mockListe.clear(); mockAudit.clear(); mockCreate.clear();
  mockLage.aufrufe = []; mockLage.labels = []; mockLage.preisNachlese = new Map();
  konten.clear();
  dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => T0);
  // Stichprobe 100 % in den Bestandstests; die Stichprobe selbst prüft ein eigener Block.
  mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true, zweifelFreigabe: false, fotoLive: 'shadow', fotoLiveAnteil: 1 });
});
afterEach(() => dateSpy.mockRestore());

describe('Einzelfall-Einstieg (taeglicheRunde mit nurFaelle)', () => {
  it('bearbeitet nur den genannten Fall, schreibt nichts und liefert die Regelversion', async () => {
    einreichung('a');
    einreichung('b', { uid: 'u2', ean: ANDERE });
    const r = await taeglicheRunde({ projekt: 'p', bucketName: 'b', nurFaelle: ['a'] });
    expect(mockWrites).toEqual([]);
    expect(r.plan.map((p) => [p.id, p.entscheidung])).toEqual([['a', 'freigeben']]);
    expect(r.regelVersion).toMatch(/^[0-9a-f]{10}$/);
    // Nur die Fotos von „a" angesehen.
    expect(mockLage.aufrufe.every((c) => c.pfade.every((p) => p.includes('/a/') || p.includes(`${EAN}/a/`)))).toBe(true);
  });

  it('dieselbe Entscheidung wie der Stapel — je Fall, über verschiedene Regeln', async () => {
    einreichung('frei');
    einreichung('woche_alt', { uid: 'u2', ean: ANDERE, status: 'approved', createdAt: T0 - 3 * TAG_MS });
    einreichung('woche', { uid: 'u2', ean: ANDERE });
    einreichung('ohnepreis', { uid: 'u3', ean: '4006040081107', preis: null });
    mockLage.preisNachlese.set('crowduploads/u3/ohnepreis/preis.jpg', []);
    einreichung('barcode', { uid: 'u4', ean: '4250231136474' });
    mockAudit.set(upload('barcode').images.ean, '4013602313647');
    const ids = ['frei', 'woche', 'ohnepreis', 'barcode'];
    const stapel = await taeglicheRunde({ projekt: 'p', bucketName: 'b', nurLesen: true });
    const vonStapel = new Map(stapel.plan.map((p) => [p.id, [p.entscheidung, p.grund]]));
    for (const id of ids) {
      const einzeln = await taeglicheRunde({ projekt: 'p', bucketName: 'b', nurFaelle: [id] });
      expect([id, einzeln.plan[0].entscheidung, einzeln.plan[0].grund]).toEqual([id, ...vonStapel.get(id)]);
      expect(einzeln.regelVersion).toBe(stapel.regelVersion);
    }
    expect(vonStapel.get('woche')).toEqual(['ablehnen', 'sperre_woche_gleicher_nutzer']);
    expect(mockWrites).toEqual([]);
  });

  it('eine ältere offene Einreichung derselben Person und EAN hält den jüngeren Fall an (live richtig, morgens entscheidet die Runde)', async () => {
    einreichung('alt', { createdAt: T0 - 2 * 60 * 60 * 1000 });
    einreichung('neu');
    const r = await taeglicheRunde({ projekt: 'p', bucketName: 'b', nurFaelle: ['neu'] });
    expect(r.plan.map((p) => p.id)).toEqual(['neu']);
    expect(r.plan[0].entscheidung).toBe('offen');
    expect(r.plan[0].eingabe.dup).toMatchObject({ verdict: 'hold', priorId: 'alt' });
  });
});

describe('Schalter cashback_config/v1.fotoLive', () => {
  it.each([[undefined], [false], ['an'], [1]])('%p → nichts: kein Schreibvorgang, kein Modellaufruf', async (wert) => {
    mockStore.set('cashback_config/v1', { fotoWorker: true, ...(wert === undefined ? {} : { fotoLive: wert }) });
    einreichung('a');
    expect(await lauf('a')).toEqual({ status: 'aus' });
    expect(mockWrites).toEqual([]);
    expect(mockLage.aufrufe).toEqual([]);
  });

  it("'shadow' → rechnet und legt das Ergebnis ab", async () => {
    einreichung('a');
    expect(await lauf('a')).toEqual({ status: 'fertig', ergebnis: 'freigeben' });
    expect(schatten('a')).toMatchObject({ status: 'fertig', modus: 'shadow', scharfAngefragt: false, ergebnis: 'freigeben', wuerdeLive: true, wuerdeMorgenrunde: null });
  });

  it('true → in Schritt 1 wie Schatten, gewarnt geloggt und am Ergebnis vermerkt', async () => {
    mockStore.set('cashback_config/v1', { fotoWorker: true, zweifelFreigabe: false, fotoLive: true });
    einreichung('a');
    const warn = [];
    expect(await lauf('a', { logger: { warn: (m) => warn.push(m), info: () => {} } })).toEqual({ status: 'fertig', ergebnis: 'freigeben' });
    expect(schatten('a')).toMatchObject({ modus: 'shadow', scharfAngefragt: true });
    expect(upload('a').status).toBe('pending');
    expect(warn.join(' ')).toMatch(/fotoLive=true/);
  });

  it('fotoLiveModus: nur shadow und true schalten ein', () => {
    expect(ls.fotoLiveModus('shadow')).toMatchObject({ an: true, modus: 'shadow', scharfAngefragt: false });
    expect(ls.fotoLiveModus(true)).toMatchObject({ an: true, modus: 'shadow', scharfAngefragt: true });
    expect(ls.fotoLiveModus(false)).toMatchObject({ an: false, unbekannt: false });
    expect(ls.fotoLiveModus(null)).toMatchObject({ an: false, unbekannt: false });
    expect(ls.fotoLiveModus('true')).toMatchObject({ an: false, unbekannt: true });
  });
});

describe('Betrugsschutz (neue Konten, Vielreicher) — Morgenrunde, keine Simulation', () => {
  it('Konto jünger als 7 Tage → betrugsschutz, kein Modellaufruf', async () => {
    konten.set('u1', T0 - 6 * TAG_MS);
    einreichung('a');
    expect(await lauf('a')).toEqual({ status: 'fertig', ergebnis: 'betrugsschutz' });
    expect(schatten('a')).toMatchObject({ ergebnis: 'betrugsschutz', grund: 'neues_konto', wuerdeMorgenrunde: 'betrugsschutz', wuerdeLive: false, betrugsschutz: { kontoTage: 5 } });
    expect(mockLage.aufrufe).toEqual([]);
  });

  it('Konto genau 7 Tage alt → normal gerechnet', async () => {
    konten.set('u1', T0 - 60 * 1000 - 7 * TAG_MS);
    einreichung('a');
    expect(await lauf('a')).toEqual({ status: 'fertig', ergebnis: 'freigeben' });
  });

  it('Kontoalter nicht ermittelbar → betrugsschutz (vorsichtige Richtung)', async () => {
    konten.set('u1', 'FEHLER');
    einreichung('a');
    expect(await lauf('a')).toEqual({ status: 'fertig', ergebnis: 'betrugsschutz' });
    expect(schatten('a').grund).toBe('kontoalter_unbekannt');
  });

  it('21 Einreichungen in 24 h → vielreicher; 20 → normal', async () => {
    // 19 frühere in den letzten 24 h, eine ältere außerhalb, dazu „a" selbst = 20.
    for (let i = 0; i < 19; i++) einreichung(`v${i}`, { ean: `40000000000${String(i).padStart(2, '0')}`, createdAt: T0 - (i + 1) * 60 * 60 * 1000 });
    einreichung('alt', { ean: ANDERE, createdAt: T0 - 25 * 60 * 60 * 1000 });
    einreichung('jung', { uid: 'u9', ean: ANDERE }); // andere Person zählt nicht
    einreichung('a', { createdAt: T0 - 10 * 60 * 1000 });
    expect(await ls.einreichungen24h(mockDb, 'u1', T0 - 10 * 60 * 1000)).toBe(20);
    expect(await lauf('a')).toEqual({ status: 'fertig', ergebnis: 'freigeben' });
    // Eine weitere frühere: 21 → Morgenrunde, ohne Modellaufruf.
    einreichung('b', { createdAt: T0 - 5 * 60 * 1000, ean: '4000000000990' });
    einreichung('v19', { ean: '4000000000991', createdAt: T0 - 20 * 60 * 60 * 1000 });
    mockLage.aufrufe = [];
    expect(await ls.einreichungen24h(mockDb, 'u1', T0 - 5 * 60 * 1000)).toBe(22);
    expect(await lauf('b')).toEqual({ status: 'fertig', ergebnis: 'betrugsschutz' });
    expect(schatten('b')).toMatchObject({ grund: 'vielreicher', betrugsschutz: { einreichungen24h: 22 } });
    expect(ls.betrugsschutzUrteil({ kontoErstelltMs: ALTES_KONTO, uploadMs: T0, einreichungen24h: 20 })).toBeNull();
    expect(ls.betrugsschutzUrteil({ kontoErstelltMs: ALTES_KONTO, uploadMs: T0, einreichungen24h: 21 })).toEqual({ grund: 'vielreicher', einreichungen24h: 21 });
    expect(mockLage.aufrufe).toEqual([]);
  });

  it('Schwellen stehen an einer Stelle', () => {
    expect(ls.BETRUGSSCHUTZ).toEqual({ kontoMindestTage: 7, hoechstensJe24h: 20 });
    expect(Object.isFrozen(ls.BETRUGSSCHUTZ)).toBe(true);
  });
});

describe('Idempotenz bei doppelter Zustellung', () => {
  it('fertig → zweiter Lauf tut nichts (kein Modellaufruf, kein Schreiben)', async () => {
    einreichung('a');
    await lauf('a');
    const aufrufe = mockLage.aufrufe.length;
    const geschrieben = mockWrites.length;
    expect(await lauf('a')).toEqual({ status: 'fertig' });
    expect(mockLage.aufrufe.length).toBe(aufrufe);
    expect(mockWrites.length).toBe(geschrieben);
  });

  it('frisch laufender anderer Lauf → nichts; hängender (≥ 12 min) → übernommen', async () => {
    einreichung('a');
    mockStore.set(`${SCHATTEN_COL}/a`, { status: 'laeuft', lauf: 'x', startedMs: T0 - 60 * 1000 });
    expect(await lauf('a')).toEqual({ status: 'laeuft' });
    expect(mockLage.aufrufe).toEqual([]);
    mockStore.set(`${SCHATTEN_COL}/a`, { status: 'laeuft', lauf: 'x', startedMs: T0 - 13 * 60 * 1000 });
    expect(await lauf('a')).toEqual({ status: 'fertig', ergebnis: 'freigeben' });
    expect(schatten('a').vorherigerLauf).toMatchObject({ lauf: 'x', status: 'laeuft' });
  });

  it('Wiederholung desselben Auftrags (Abbruch an der Laufzeitgrenze) übernimmt sofort; gleiche Zustellung nicht', async () => {
    einreichung('a');
    mockStore.set(`${SCHATTEN_COL}/a`, { status: 'laeuft', lauf: 'x', startedMs: T0 - 2 * 60 * 1000, auftrag: 't1', versuch: 0 });
    expect(await lauf('a', { auftrag: 't1', versuch: 0 })).toEqual({ status: 'laeuft' });
    expect(await lauf('a', { auftrag: 't2', versuch: 1 })).toEqual({ status: 'laeuft' });
    expect(await lauf('a', { auftrag: 't1', versuch: 1 })).toEqual({ status: 'fertig', ergebnis: 'freigeben' });
    expect(schatten('a')).toMatchObject({ versuch: 1, vorherigerLauf: { lauf: 'x', status: 'laeuft' } });
  });

  it('übernimmt nach einem Fehler; ein fremder Lauf überschreibt kein Ergebnis', async () => {
    einreichung('a');
    mockStore.set(`${SCHATTEN_COL}/a`, { status: 'fehler', lauf: 'x', fehler: 'UNAVAILABLE' });
    expect(await lauf('a')).toEqual({ status: 'fertig', ergebnis: 'freigeben' });
    expect(await ls.abschliessen(mockDb, 'a', 'fremder_lauf', { status: 'fertig', ergebnis: 'ablehnen' })).toBe('fremd');
    expect(schatten('a').ergebnis).toBe('freigeben');
  });

  it('Auftragsname je Einreichung fest und gültig', () => {
    expect(ls.auftragsName('abc')).toBe(ls.auftragsName('abc'));
    expect(ls.auftragsName('abc')).not.toBe(ls.auftragsName('abd'));
    expect(ls.auftragsName('uid/xyz_1')).toMatch(/^[A-Za-z0-9_-]{1,100}$/);
  });
});

describe('Der Schatten entscheidet nichts', () => {
  it('freigabefähiger Fall: Status bleibt offen, nur crowd_live_schatten geschrieben, Einreichung unverändert', async () => {
    einreichung('a');
    const vorher = JSON.stringify(upload('a'));
    await lauf('a');
    expect(JSON.stringify(upload('a'))).toBe(vorher);
    expect(upload('a').status).toBe('pending');
    expect(nurSchattenGeschrieben()).toBe(true);
    expect(mockWrites.map((w) => w.path)).toEqual([`${SCHATTEN_COL}/a`, `${SCHATTEN_COL}/a`]);
    // Keine Buchung, kein Push-Merker, kein Bericht.
    expect([...mockStore.keys()].filter((p) => p.startsWith('ops_') || p.startsWith('cashback_ledger'))).toEqual([]);
  });

  it('ablehnungsreifer Fall (Wochen-Sperre) und Fall mit Nachlesung: ebenfalls nichts am Bestand', async () => {
    einreichung('alt', { status: 'approved', createdAt: T0 - 3 * TAG_MS });
    einreichung('a');
    einreichung('np', { uid: 'u3', ean: ANDERE, preis: null });
    mockLage.preisNachlese.set('crowduploads/u3/np/preis.jpg', [{ priceCents: 199, priceImageKind: 'preisschild', manufacturer: 'X' }, { priceCents: 199, priceImageKind: 'preisschild', manufacturer: 'X' }]);
    const vorher = JSON.stringify([...mockStore.entries()].filter(([p]) => p.startsWith('crowd_uploads/')));
    await lauf('a');
    await lauf('np');
    expect(JSON.stringify([...mockStore.entries()].filter(([p]) => p.startsWith('crowd_uploads/')))).toBe(vorher);
    expect(nurSchattenGeschrieben()).toBe(true);
    expect(schatten('a')).toMatchObject({ ergebnis: 'ablehnen', grund: 'sperre_woche_gleicher_nutzer', wuerdeLive: false, wuerdeMorgenrunde: 'ablehnung' });
    // Nachgelesen nur im Speicher — und mit dem gelesenen Preis frei.
    expect(schatten('np')).toMatchObject({ ergebnis: 'freigeben' });
    expect(upload('np').priceRescueOcr).toBeUndefined();
  });

  it('Messwerte je Fall und dieselben Modell-Einstellungen wie die Runde (nur die Kosten-Kennung bekommt weg=live-schatten)', async () => {
    einreichung('a', { createdAt: T0 - 45 * 1000 });
    let t = T0;
    await lauf('a', { uhr: () => { t += 1000; return t; } });
    const s = schatten('a');
    expect(s).toMatchObject({ status: 'fertig', uploadMs: T0 - 45 * 1000, startedMs: T0 + 1000, lauf: expect.stringMatching(/^schatten_/), regelVersion: expect.stringMatching(/^[0-9a-f]{10}$/), modellAufrufe: 1, ladeMs: expect.any(Number), listeMs: expect.any(Number) });
    expect(s.gesamtMs).toBe(s.fertigMs - (T0 - 45 * 1000));
    expect(s.dauerMs).toBe(s.fertigMs - s.startedMs);
    expect(Number.isFinite(s.modelMs)).toBe(true);
    const audit = mockLage.aufrufe[0].config;
    expect(audit).toMatchObject({ temperature: 0, thinkingConfig: { thinkingLevel: 'LOW' }, responseMimeType: 'application/json' });
    expect(audit.labels).toEqual({ funktion: 'review-console', zweck: 'foto-runde-bildpruefung', weg: 'live-schatten' });
    // Die Anweisung ist wortgleich die der Runde.
    // (Schalter der Preisfoto-Regeln fehlen → 'shadow' → die Fassung mit Preisquelle und Kassenbon.)
    expect(mockLage.aufrufe[0].text).toContain(require('../src/taeglicheRunde').AUDIT_ANWEISUNG_PREISBELEG);
  });

  it('technischer Rückfall (Bildprüfung gescheitert) wird als Code vermerkt, nicht als Regel-Ergebnis', async () => {
    einreichung('a');
    const runde = async () => ({ regelVersion: 'abc', plan: [{ id: 'a', entscheidung: 'offen', grund: 'bildpruefung_fehlgeschlagen', auditFehler: 'zeit_abgelaufen', eingabe: { rettungFehler: { preis: 'lesungen_uneinig' } } }] });
    await lauf('a', { runde });
    expect(schatten('a')).toMatchObject({ ergebnis: 'offen', technisch: { bildpruefung: 'zeit_abgelaufen' }, wuerdeMorgenrunde: 'offen' });
    expect(ls.ergebnisAusPlan({ entscheidung: 'offen', grund: 'x', eingabe: { rettungFehler: { preis: 'lesungen_uneinig' } } }).technisch).toBeNull();
    expect(ls.ergebnisAusPlan({ entscheidung: 'offen', grund: 'x', eingabe: { rettungFehler: { name: '429 RESOURCE_EXHAUSTED quota', preis: 'lesungen_uneinig' } } }).technisch).toEqual({ nachlesen: ['name'] });
  });

  it('schon entschiedene Einreichung → nur vermerkt, nichts gerechnet', async () => {
    einreichung('a', { status: 'approved' });
    expect(await lauf('a')).toEqual({ status: 'fertig', ergebnis: 'schon_entschieden' });
    expect(mockLage.aufrufe).toEqual([]);
  });

  it('Fehler der Runde → Fehler am Schatten-Dokument; wiederholt, solange Versuche übrig sind', async () => {
    einreichung('a');
    const runde = async () => { throw new Error('UNAVAILABLE firestore'); };
    await expect(lauf('a', { runde, versuch: 0 })).rejects.toThrow('UNAVAILABLE');
    // Nur ein Code am Dokument, kein Fehlertext (der kann Pfade mit der uid tragen).
    expect(schatten('a')).toMatchObject({ status: 'fehler', fehler: 'UNAVAILABLE', versuch: 0 });
    expect(await lauf('a', { runde, versuch: ls.VERSUCHE - 1 })).toEqual({ status: 'fehler' });
    expect(upload('a').status).toBe('pending');
    expect(nurSchattenGeschrieben()).toBe(true);
  });
});

describe('Auslöser (Trigger-Seite)', () => {
  const fertig = { status: 'pending', productNameOcrAt: ts(T0) };
  it('nur beim Übergang „Namer fertig" an einer offenen Einreichung', () => {
    expect(ls.schattenAusloesen({ status: 'pending' }, fertig)).toBe(true);
    // Namer hat einen Nachlauf geplant → erst wenn der fertig ist.
    expect(ls.schattenAusloesen({ status: 'pending' }, { ...fertig, namerNachlesenAb: ts(T0 + 900000) })).toBe(false);
    expect(ls.schattenAusloesen({ ...fertig, namerNachlesenAb: ts(T0) }, fertig)).toBe(true);
    // Jedes spätere Update (Ortsbewertung, Runde) löst nicht erneut aus.
    expect(ls.schattenAusloesen(fertig, { ...fertig, probableLocation: {} })).toBe(false);
    expect(ls.schattenAusloesen({ status: 'pending' }, { ...fertig, status: 'approved' })).toBe(false);
    expect(ls.schattenAusloesen(null, null)).toBe(false);
  });

  it('stellt je Einreichung einen Auftrag ein — nur mit Schalter, doppelt = kein Fehler', async () => {
    const eingestellt = [];
    const einstellen = async (daten, name) => {
      if (eingestellt.some((e) => e.name === name)) { const e = new Error(`A task with ID ${name} already exists`); e.code = 'functions/task-already-exists'; throw e; }
      eingestellt.push({ daten, name });
    };
    const o = { db: mockDb, id: 'a', vorher: { status: 'pending' }, nachher: fertig, einstellen };
    expect(await ls.ausloeserFall(o)).toBe('eingestellt');
    expect(await ls.ausloeserFall(o)).toBe('schon_eingestellt');
    expect(eingestellt).toEqual([{ daten: { id: 'a' }, name: ls.auftragsName('a') }]);
    expect(await ls.ausloeserFall({ ...o, vorher: fertig })).toBe('kein_uebergang');
    mockStore.set('cashback_config/v1', { fotoLive: false });
    expect(await ls.ausloeserFall({ ...o, id: 'b' })).toBe('aus');
    expect(eingestellt.length).toBe(1);
    expect(mockWrites).toEqual([]);
  });

  it('Stichprobe fotoLiveAnteil: außerhalb kein Auftrag, Standard 0,5, deterministisch je ID', async () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `uid${i % 37}_sess${i}_${i % 5}`);
    const anteil = (a) => ids.filter((id) => ls.inStichprobe(id, a)).length / ids.length;
    expect(anteil(0.5)).toBeGreaterThan(0.45);
    expect(anteil(0.5)).toBeLessThan(0.55);
    expect(anteil(1)).toBe(1);
    expect(anteil(0)).toBe(0);
    // Fehlt oder ungültig → 0,5.
    for (const roh of [undefined, null, 'halb', 1.5, -0.1, NaN]) expect(ls.anteilVon(roh)).toBe(0.5);
    expect(ls.ANTEIL_STANDARD).toBe(0.5);
    // Deterministisch und unsigned (nie negativ).
    for (const id of ids.slice(0, 50)) {
      expect(ls.hash32(id)).toBe(ls.hash32(id));
      expect(ls.hash32(id)).toBeGreaterThanOrEqual(0);
      expect(ls.hash32(id)).toBeLessThan(2 ** 32);
    }
    expect(ls.hash32('a')).toBe(0xe40c292c); // FNV-1a 32 Bit, Referenzwert
    // Wer bei 0,3 drin ist, ist es auch bei 0,5 (wachsender Anteil nimmt nur dazu).
    expect(ids.filter((id) => ls.inStichprobe(id, 0.3)).every((id) => ls.inStichprobe(id, 0.5))).toBe(true);
    // Trigger: außerhalb der Stichprobe kein Auftrag.
    const drin = ids.find((id) => ls.inStichprobe(id, 0.5));
    const draussen = ids.find((id) => !ls.inStichprobe(id, 0.5));
    mockStore.set('cashback_config/v1', { fotoLive: 'shadow' });
    const eingestellt = [];
    const o = (id) => ({ db: mockDb, id, vorher: { status: 'pending' }, nachher: fertig, einstellen: async (d, name) => eingestellt.push(name) });
    expect(await ls.ausloeserFall(o(draussen))).toBe('ausserhalb_stichprobe');
    expect(await ls.ausloeserFall(o(drin))).toBe('eingestellt');
    expect(eingestellt).toEqual([ls.auftragsName(drin)]);
    mockStore.set('cashback_config/v1', { fotoLive: 'shadow', fotoLiveAnteil: 0 });
    expect(await ls.ausloeserFall(o(drin))).toBe('ausserhalb_stichprobe');
  });

  it('Schalter nicht lesbar → kein Auftrag (vorsichtige Richtung)', async () => {
    const db = { doc: () => ({ get: async () => { throw new Error('UNAVAILABLE'); } }) };
    const einstellen = async () => { throw new Error('darf nicht eingestellt werden'); };
    expect(await ls.ausloeserFall({ db, id: 'a', vorher: { status: 'pending' }, nachher: fertig, einstellen })).toBe('aus');
  });
});

describe('Abgleich im Tagesbericht (src/liveSchattenBericht.js)', () => {
  const s = (ergebnis, grund = null, gesamtMs = 30000, modelMs = 9000) => ({ status: 'fertig', ergebnis, grund, gesamtMs, modelMs });
  it('Übereinstimmung gesamt und je Grund, lockerer/strenger, McNemar, Dauer, Fehler und Rückfälle', () => {
    const plan = [
      { id: 'a', entscheidung: 'freigeben', grund: null },
      { id: 'b', entscheidung: 'ablehnen', grund: 'preis_fehlt' },
      { id: 'c', entscheidung: 'ablehnen', grund: 'preis_fehlt' },
      { id: 'd', entscheidung: 'freigeben', grund: null },
      { id: 'e', entscheidung: 'offen', grund: 'ean_abweichend' },
      { id: 'f', entscheidung: 'freigeben', grund: null },
      { id: 'g', entscheidung: 'freigeben', grund: null },
      { id: 'h', entscheidung: 'freigeben', grund: null },
      { id: 'i', entscheidung: 'freigeben', grund: null, uebersprungen: true },
    ];
    const sv = new Map([
      ['a', s('freigeben', null, 20000)],
      ['b', s('ablehnen', 'preis_fehlt', 40000)],
      ['c', s('freigeben', null, 60000)], // lockerer
      ['d', s('offen', 'doppelt_eingereicht', 50000)], // strenger / Rückfall
      ['e', s('offen', 'ean_abweichend', 400000)],
      ['f', { status: 'fertig', ergebnis: 'betrugsschutz', grund: 'neues_konto' }],
      ['g', { status: 'fehler', fehler: 'UNAVAILABLE' }],
      ['i', s('freigeben')],
    ]);
    const v = schattenVergleich(plan, sv);
    expect(v).toMatchObject({
      aktiv: true, faelleRunde: 9, verglichen: 5, gleich: 3, gleichMitGrund: 3, uebereinstimmung: 0.6,
      paare: { 'freigeben|freigeben': 1, 'ablehnen|ablehnen': 1, 'freigeben|ablehnen': 1, 'offen|freigeben': 1, 'offen|offen': 1 },
      jeGrund: { freigegeben: { anzahl: 2, gleich: 1 }, preis_fehlt: { anzahl: 2, gleich: 1 }, ean_abweichend: { anzahl: 1, gleich: 1 } },
      schattenFreiRundeNicht: 1, rundeFreiSchattenNicht: 1,
      lockerer: [{ f: fallKennung('c'), runde: 'ablehnen', rundeGrund: 'preis_fehlt' }],
      strenger: [{ f: fallKennung('d'), schatten: 'offen', schattenGrund: 'doppelt_eingereicht' }],
      mcnemar: { b: 1, c: 1, chi2: 0.5, signifikant: false },
      betrugsschutz: { anzahl: 1, gruende: { neues_konto: 1 } },
      rueckfaelle: { anzahl: 2, gruende: { doppelt_eingereicht: 1, ean_abweichend: 1 } },
      fehler: 1, fehlt: 1, uebersprungen: 1,
      dauer: { gemessen: 6, gesamtMedianMs: 40000, gesamtP99Ms: 400000 },
    });
    // Keine Rohkennungen im Bericht.
    expect(JSON.stringify(v)).not.toMatch(/:"(a|b|c|d|e|f|g|h|i)"/);
  });

  it('jedes Ergebnis zählt an genau einem Morgen; technische Rückfälle und hängende Läufe getrennt', () => {
    const plan = [
      { id: 'heute', entscheidung: 'freigeben', grund: null },
      { id: 'gestern', entscheidung: 'offen', grund: 'ean_abweichend' },
      { id: 'spaet', entscheidung: 'freigeben', grund: null },
      { id: 'tech', entscheidung: 'freigeben', grund: null },
      { id: 'haengt', entscheidung: 'freigeben', grund: null },
      { id: 'laeuft', entscheidung: 'freigeben', grund: null },
    ];
    const sv = new Map([
      ['heute', { ...s('freigeben'), fertigMs: T0 - 3 * 60 * 60 * 1000 }],
      ['gestern', { ...s('offen', 'ean_abweichend'), fertigMs: T0 - 25 * 60 * 60 * 1000 }],
      ['spaet', { ...s('freigeben'), fertigMs: T0 + 30000 }],
      ['tech', { ...s('offen', 'bildpruefung_fehlgeschlagen'), technisch: { bildpruefung: 'zeit_abgelaufen' }, fertigMs: T0 - 60000 }],
      ['haengt', { status: 'laeuft', startedMs: T0 - 13 * 60 * 1000 }],
      ['laeuft', { status: 'laeuft', startedMs: T0 - 60 * 1000 }],
    ]);
    const v = schattenVergleich(plan, sv, { jetzt: T0 });
    expect(v).toMatchObject({
      verglichen: 1, gleich: 1, schonVerglichen: 1, nachRundenstart: 1, haengt: 1, laeuft: 1,
      technisch: { anzahl: 1, gruende: { zeit_abgelaufen: 1 } }, rueckfaelle: { anzahl: 0 }, rundeFreiSchattenNicht: 0,
    });
  });

  it('Bericht-Teil wirft nie: Lesefehler → unlesbar', async () => {
    const { schattenFuerBericht } = require('../src/liveSchattenBericht');
    const db = { collection: () => ({ doc: (id) => ({ id }) }), getAll: async () => { throw new Error('UNAVAILABLE'); } };
    expect(await schattenFuerBericht(db, [{ id: 'a', entscheidung: 'freigeben' }], null, T0)).toEqual({ aktiv: null, unlesbar: true });
  });

  it('Berichtsgröße: über 900 KB fallen die Einzelfälle weg, die Kennzahlen bleiben', () => {
    const { schattenFuerGroesse, BERICHT_MAX_BYTES } = require('../src/liveSchattenBericht');
    const ls0 = { verglichen: 3, gleich: 2, faelle: [{ f: 'x' }], lockerer: [{ f: 'y' }], strenger: [] };
    expect(BERICHT_MAX_BYTES).toBe(900 * 1024);
    expect(schattenFuerGroesse({ a: 1, liveSchatten: ls0 }, 'liveSchatten')).toBe(ls0);
    const gross = { wartetAufDich: 'x'.repeat(950 * 1024), liveSchatten: ls0 };
    const r = schattenFuerGroesse(gross, 'liveSchatten');
    expect(r).toEqual({ verglichen: 3, gleich: 2, einzelfaelleWeggelassen: true, berichtBytes: expect.any(Number) });
    expect(r.berichtBytes).toBeGreaterThan(BERICHT_MAX_BYTES);
    expect(schattenFuerGroesse({ liveSchatten: { unlesbar: true } }, 'liveSchatten')).toEqual({ unlesbar: true });
  });

  it('fehlerCode: nur Codes, kein Freitext', () => {
    const { fehlerCode } = require('../src/liveSchattenBericht');
    expect(fehlerCode(new Error('5 NOT_FOUND: no entity crowd_uploads/uid123_x'))).toBe('NOT_FOUND');
    expect(fehlerCode(Object.assign(new Error('x'), { code: 'functions/task-already-exists' }))).toBe('functions/task-already-exists');
    expect(fehlerCode(new Error('kaputt bei uid123'))).toBe('fehler');
  });

  it('quantil: Rang-Verfahren', () => {
    expect(quantil([], 0.5)).toBeNull();
    expect(quantil([5, 1, 3], 0.5)).toBe(3);
    expect(quantil(Array.from({ length: 100 }, (_, i) => i + 1), 0.99)).toBe(99);
  });

  it('Morgenrunde: Entscheidungen Byte für Byte gleich mit und ohne Schatten-Ergebnisse, Abgleich im Bericht', async () => {
    const aufbauen = () => {
      mockStore.clear(); mockWrites.length = 0; mockListe.clear(); mockCreate.clear(); mockAudit.clear();
      mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true, zweifelFreigabe: false, fotoLive: 'shadow' });
      einreichung('alt', { status: 'approved', createdAt: T0 - 3 * TAG_MS });
      einreichung('a', { createdAt: T0 - TAG_MS });
      einreichung('b', { uid: 'u2', ean: ANDERE, createdAt: T0 - TAG_MS });
    };
    const runde = () => taeglicheRunde({ dryRun: false, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    const entscheidungen = () => mockWrites.filter((w) => w.path.startsWith('crowd_uploads/')).map((w) => JSON.stringify(w));
    aufbauen();
    const ohne = await runde();
    const ohneW = entscheidungen();
    aufbauen();
    mockStore.set(`${SCHATTEN_COL}/a`, s('ablehnen', 'sperre_woche_gleicher_nutzer'));
    mockStore.set(`${SCHATTEN_COL}/b`, s('freigeben'));
    const mit = await runde();
    expect(entscheidungen()).toEqual(ohneW);
    expect(ohne.liveSchatten).toMatchObject({ aktiv: false, fehlt: 2 });
    expect(mit.liveSchatten).toMatchObject({ aktiv: true, verglichen: 2, gleich: 2, uebereinstimmung: 1, schattenFreiRundeNicht: 0 });
    expect(mockStore.get(`ops_tagesberichte/${mit.lauf}`).liveSchatten).toMatchObject({ verglichen: 2 });
  });
});
