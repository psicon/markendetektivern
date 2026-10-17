'use strict';
/**
 * Ablauf der Morgenrunde (src/taeglicheRunde.js) gegen einen kleinen In-Memory-
 * Firestore, eine gemockte Storage-Liste und eine gemockte Bildprüfung. Die
 * Regeln selbst prüft __tests__/fotoRundeRegeln.test.js — hier geht es um die
 * Verdrahtung der Entscheidungen Patrick vom 02.10.2026:
 *  - Wochen-Sperre ohne Ausnahme, am Dokument als App-Code `doppelt_eingereicht`,
 *  - Nummer vom Barcode-Foto gegen die gespeicherte (`eanFotoOcr`, halten),
 *  - Foto-Abgleich gegen ALLE früheren Einreichungen (Storage-Liste),
 *  - gesperrte Konten (`cashback_sperren`), fail-closed für Freigaben,
 *  - `nurLesen`: kein einziger Schreibvorgang.
 */

// ── In-Memory-Firestore ────────────────────────────────────────────────
const mockStore = new Map();
const mockWrites = [];
const mockLage = { sperrenFehler: false, listeFehler: false, configFehler: 0, configLesungen: 0, auditAufrufe: [], auditTexte: [], zweitLesungen: [], leserAufrufe: [], kennungen: [], downloadFehler: () => false, updateFehler: () => false, txUpdateFehler: () => false };
const mockSentinel = { __feld: 'serverTimestamp' };
const mockDelete = { __feld: 'delete' };
const mockListe = new Map(); // Pfad → { md5, size }
const mockAudit = new Map(); // Pfad des ean-Fotos → eanFoto-Antwort
const mockZweit = new Map(); // Pfad des ean-Fotos → Antwort der zweiten Lesung ('FEHLER' = wirft)
// Pfad des ean-Fotos → Ergebnis des Strichcode-Lesers ({gelesen:[…]} | {fehler}). Ohne
// Eintrag liest er, was die Bildprüfung dort liest (falls gültige GTIN), sonst nichts.
const mockStriche = new Map();
const mockCreate = new Map(); // Dokumentpfad → Server-Zeitpunkt (createTime), sonst keiner
const mockKopf = new Map(); // Pfad → Buffer (Anfang der Datei), 'FEHLER' (wirft) oder Funktion (liefert den Buffer); sonst ein Kamerafoto 4:3
const mockQuelle = new Map(); // Pfad des Preisfotos → Antwort preisQuelle der Bildprüfung
const mockNachlese = new Map(); // Pfad des Preisfotos → Antworten der Preis-Nachlesung, der Reihe nach ('FEHLER' = wirft)
// Pfad des Preisfotos → Antwort auf die Unterfragen zum Kassenbon ({belegHaendler, belegMerkmale}, 05.10.2026).
// Ohne Eintrag und bei „kassenbon": ein vollständiger REWE-Bon — so antwortete das Modell bei 100 von 189 Bons.
const mockBeleg = new Map();
const mockDownloads = [];
/** Ohne Angabe: Anfang eines Fotos aus der App-Kamera (JPEG 4:3, ohne EXIF) — die Regel findet nichts. */
function mockKameraKopf() { return require('./helpers/bildKopfDaten').jpeg(3000, 4000); }

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
/** Feldpfad wie Firestore-update („review.rundeOffen") — Zwischenebenen werden kopiert, nie verändert. */
function setzePfad(obj, pfad, v) {
  const teile = pfad.split('.');
  let o = obj;
  for (const t of teile.slice(0, -1)) {
    o[t] = o[t] && typeof o[t] === 'object' ? { ...o[t] } : {};
    o = o[t];
  }
  const letztes = teile[teile.length - 1];
  if (v && v.__feld === 'delete') delete o[letztes];
  else o[letztes] = v;
}
function anwenden(pfad, daten, merge) {
  const vorher = merge ? mockStore.get(pfad) || {} : {};
  const neu = { ...vorher };
  for (const [k, v] of Object.entries(kopie(daten))) setzePfad(neu, k, v);
  // Wie crowd-upload-reward: eine Freigabe wird gebucht (sonst wartete die
  // Runde bis zu 5 Minuten auf die Buchung).
  if (pfad.startsWith('crowd_uploads/') && daten.status === 'approved') Object.assign(neu, { rewardResult: 'credited', rewardCents: 15 });
  mockStore.set(pfad, neu);
}
function docRef(pfad) {
  return {
    path: pfad, id: pfad.split('/').pop(),
    get: async () => {
      // `configFehler`: so viele Lesevorgänge von cashback_config/v1 scheitern.
      if (pfad === 'cashback_config/v1') mockLage.configLesungen++;
      if (pfad === 'cashback_config/v1' && mockLage.configFehler > 0) { mockLage.configFehler--; throw new Error('UNAVAILABLE config'); }
      return snapshot(pfad, mockStore.get(pfad));
    },
    set: async (daten, opts) => { mockWrites.push({ path: pfad, art: 'set', data: kopie(daten) }); anwenden(pfad, daten, opts && opts.merge); },
    update: async (daten) => {
      if (mockLage.updateFehler(pfad, daten)) throw new Error('UNAVAILABLE update');
      if (!mockStore.has(pfad)) throw new Error('NOT_FOUND');
      mockWrites.push({ path: pfad, art: 'update', data: kopie(daten) });
      anwenden(pfad, daten, true);
    },
  };
}
const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v);
function query(sammlung, filter = []) {
  return {
    where: (f, op, v) => query(sammlung, [...filter, [f, op, v]]),
    select: () => query(sammlung, filter),
    limit: () => query(sammlung, filter),
    // Zählabfrage wie Firestore count() (Produktsuche: wartende Barcodes).
    count: () => ({ get: async () => { const r = await query(sammlung, filter).get(); return { data: () => ({ count: r.size }) }; } }),
    get: async () => {
      if (sammlung === 'cashback_sperren' && mockLage.sperrenFehler) throw new Error('UNAVAILABLE');
      if (sammlung === 'discounter' && mockLage.discounterFehler) throw new Error('UNAVAILABLE discounter');
      const docs = [...mockStore.entries()]
        .filter(([p]) => p.startsWith(`${sammlung}/`) && p.split('/').length === 2)
        .filter(([, d]) => filter.every(([f, op, v]) => (op === '==' ? d[f] === v : ms(d[f]) >= ms(v))))
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
    const tx = { get: (ref) => ref.get(), update: (ref, daten) => ops.push([ref.path, daten]) };
    const r = await fn(tx);
    if (ops.some(([p, daten]) => mockLage.txUpdateFehler(p, daten))) throw new Error('ABORTED tx');
    for (const [p, daten] of ops) { mockWrites.push({ path: p, art: 'update', data: kopie(daten) }); anwenden(p, daten, true); }
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
        getFiles: async () => {
          if (mockLage.listeFehler) throw new Error('storage list 503');
          return [[...mockListe.entries()].map(([name, m]) => ({ name, md5Hash: m.md5, size: String(m.size) })), null];
        },
        file: (p) => ({
          getMetadata: async () => { const m = mockListe.get(p); if (!m) throw new Error('No such object'); return [{ md5Hash: m.md5, size: String(m.size) }]; },
          download: async (opts) => {
            // Original für den Strichcode-Leser (ohne Bereich): der „Inhalt" ist der Pfad (der Leser-Mock schlägt damit nach).
            if (!opts) { if (mockLage.downloadFehler(p)) throw new Error('download 503'); return [Buffer.from(p)]; }
            // Kopf des Preisfotos (Bereich): Bildmerkmale der Bildschirm-Regel.
            mockDownloads.push({ p, opts });
            const k = mockKopf.has(p) ? mockKopf.get(p) : mockKameraKopf();
            if (k === 'FEHLER') throw new Error('No such object');
            return [typeof k === 'function' ? k() : k];
          },
        }),
      }),
    }),
  };
});
jest.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => mockSentinel, delete: () => mockDelete } }));
jest.mock('firebase-functions/logger', () => ({ info: () => {}, warn: () => {}, error: () => {} }));
jest.mock('@google/genai', () => ({
  // Einfache Funktion statt jest.fn(): das Root-jest setzt resetMocks.
  GoogleGenAI: function GoogleGenAI() {
    return {
      models: {
        generateContent: async ({ contents, config }) => {
          const parts = contents[0].parts;
          const text = parts.map((p) => p.text || '').join('\n');
          // Kosten-Kennung je Aufrufart (08.10.2026).
          const art = text.includes('Lies die EAN/GTIN') ? 'barcode' : text.includes('Lies zwei Angaben, sonst nichts') ? 'preis' : 'audit';
          mockLage.kennungen.push({ art, labels: config && config.labels });
          const pfade = parts.filter((p) => p.fileData).map((p) => p.fileData.fileUri.replace('gs://b/', ''));
          if (text.includes('Lies die EAN/GTIN')) {
            // Zweite Lesung nur des Barcode-Fotos (nur bei Abweichung).
            mockLage.zweitLesungen.push(pfade);
            const z = mockZweit.has(pfade[0]) ? mockZweit.get(pfade[0]) : mockAudit.get(pfade[0]);
            if (z === 'FEHLER') throw new Error('INVALID_ARGUMENT kaputt');
            return { text: JSON.stringify({ ean: z, sicher: true }) };
          }
          if (text.includes('Lies zwei Angaben, sonst nichts')) {
            // Preis-Nachlesung (nur, wenn kein Preis gelesen ist).
            const liste = mockNachlese.get(pfade.find((p) => p.endsWith('/preis.jpg')));
            if (!liste || !liste.length) throw new Error('unerwarteter Aufruf (Nachlesen sollte nicht nötig sein)');
            const a = liste.shift();
            if (a === 'FEHLER') throw new Error('INVALID_ARGUMENT Nachlesung gescheitert');
            return { text: JSON.stringify(a) };
          }
          if (!text.includes('Du prüfst eine Produkt-Einreichung')) throw new Error('unerwarteter Aufruf (Nachlesen sollte nicht nötig sein)');
          mockLage.auditAufrufe.push(pfade);
          mockLage.auditTexte.push(text);
          const eanPfad = pfade.find((p) => p.includes('/ean'));
          const eanFoto = mockAudit.has(eanPfad) ? mockAudit.get(eanPfad) : (eanPfad || '').split('/')[1];
          if (eanFoto === 'AUDIT_FEHLER') throw new Error('INVALID_ARGUMENT Bild nicht lesbar');
          if (mockLage.nachAudit) mockLage.nachAudit();
          // Zusatzfrage „Woher stammt der Preis?" (04.10.2026) nur, wenn sie gestellt wurde.
          const preisPfad = pfade.find((p) => p.endsWith('/preis.jpg'));
          const quelle = text.includes('"preisQuelle":') && mockQuelle.has(preisPfad) ? { preisQuelle: mockQuelle.get(preisPfad), preisQuelleGrund: 'Statusleiste' } : {};
          const voll = { belegHaendler: 'REWE', belegMerkmale: ['haendler', 'datum', 'summe', 'nummer', 'zahlung', 'steuer'] };
          const beleg = !text.includes('"belegMerkmale":') ? {} : mockBeleg.has(preisPfad) ? mockBeleg.get(preisPfad)
            : quelle.preisQuelle === 'kassenbon' ? voll : { belegHaendler: '', belegMerkmale: [] };
          const antwort = { echt: true, loseWare: false, traegtAngaben: true, gleicheAnsicht: false, preisSichtbar: true, eanFoto, grund: 'ok', ...quelle, ...beleg };
          // 'IN_LISTE': das Objekt in eine Liste verpackt (gemessen 1 von 272 Antworten, 05.10.2026).
          return { text: JSON.stringify(mockLage.antwortInListe ? [antwort] : antwort) };
        },
      },
    };
  },
}));

// Strichcode-Leser (Pflicht-Zeuge der Barcode-Korrektur): ohne WASM, nachgeschlagen über den Pfad.
jest.mock('../src/strichcode', () => {
  const echt = jest.requireActual('../src/strichcode');
  const { pruefzifferOk } = jest.requireActual('../src/werte');
  return {
    ...echt,
    liesBild: async (bild) => {
      const p = Buffer.from(bild).toString();
      mockLage.leserAufrufe.push(p);
      if (mockStriche.has(p)) return mockStriche.get(p);
      const a = mockAudit.has(p) ? mockAudit.get(p) : null;
      return { gelesen: typeof a === 'string' && pruefzifferOk(a) ? [a] : [] };
    },
  };
});

const { taeglicheRunde } = require('../src/taeglicheRunde');

// ── Fixtures ───────────────────────────────────────────────────────────
const TAG_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 3, 6, 0, 0); // 08:00 Berlin
const EAN = '4061464833821';
const ANDERE = '4000417025005';
const SLOTS = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];
const ts = (n) => ({ toMillis: () => n });
let dateSpy;

/** Eine vollständige Einreichung; die Dateien landen in der Storage-Liste (md5 je Datei eindeutig, außer überschrieben). */
function einreichung(id, { uid = 'u1', ean = EAN, status = 'pending', createdAt = T0 - TAG_MS, marketId = 'rewe', preis = 129, md5 = {}, ...rest } = {}) {
  const images = Object.fromEntries(SLOTS.map((s) => [s, `crowduploads/${s === 'ean' ? ean : uid}/${id}/${s}.jpg`]));
  for (const s of SLOTS) mockListe.set(images[s], { md5: md5[s] || `md5_${id}_${s}`, size: 200000 + s.length });
  mockStore.set(`crowd_uploads/${id}`, {
    userId: uid, ean, status, createdAt: ts(createdAt), marketId, marketName: marketId, images,
    productNameOcr: `Produkt ${id}`, priceOcr: { priceCents: preis }, manufacturerOcr: { name: 'Hersteller GmbH' },
    ...rest,
  });
}
const doc = (id) => mockStore.get(`crowd_uploads/${id}`);
/** Was der Strichcode-Leser heute auf dem Barcode-Foto von `id` liest (Pflicht-Zeuge der Korrektur). */
const striche = (id, ...nummern) => mockStriche.set(doc(id).images.ean, { gelesen: nummern });
// Strichcode-Leser liest genau die gespeicherte Nummer → Halt aufgehoben, keine Korrektur (Entscheidung Patrick 09.10.2026).
const gleichDurchLeser = (id, ean = EAN) => {
  expect(doc(id).status).toBe('approved');
  expect(doc(id).eanKorrektur).toBeUndefined();
  expect(doc(id).eanFotoOcr).toMatchObject({ befund: 'gleich', grund: 'strichcode_bestaetigt', ean, zeuge: { art: 'striche', gelesen: [ean] } });
};
const scharf = (extra = {}) => taeglicheRunde({ dryRun: false, projekt: 'p', bucketName: 'b', ausloeser: 'manuell', ...extra });

beforeEach(() => {
  mockStore.clear();
  mockWrites.length = 0;
  mockListe.clear();
  mockAudit.clear();
  mockLage.sperrenFehler = false;
  mockLage.listeFehler = false;
  mockLage.configFehler = 0;
  mockLage.configLesungen = 0;
  mockLage.auditAufrufe = [];
  mockLage.auditTexte = [];
  mockLage.zweitLesungen = [];
  mockLage.leserAufrufe = [];
  mockLage.kennungen = [];
  mockLage.downloadFehler = () => false;
  mockStriche.clear();
  mockLage.updateFehler = () => false;
  mockLage.txUpdateFehler = () => false;
  mockLage.nachAudit = null;
  mockZweit.clear();
  mockCreate.clear();
  mockKopf.clear();
  mockQuelle.clear();
  mockNachlese.clear();
  mockBeleg.clear();
  mockLage.antwortInListe = false;
  mockLage.discounterFehler = false;
  mockDownloads.length = 0;
  dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => T0);
  mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true });
});
afterEach(() => dateSpy.mockRestore());

describe('Kosten-Kennung (08.10.2026, src/ki.js)', () => {
  it('Bildprüfung, Preis-Nachlesung und zweite Barcode-Lesung tragen je ihren Zweck', async () => {
    einreichung('frei');
    einreichung('k', { uid: 'u2', ean: '4250231136474' });
    mockAudit.set(doc('k').images.ean, '4013602313647');
    mockZweit.set(doc('k').images.ean, '');
    einreichung('np', { uid: 'u3', ean: '4006040081107', preis: null });
    mockNachlese.set('crowduploads/u3/np/preis.jpg', [{ priceCents: 129, priceImageKind: 'preisschild' }, { priceCents: 129, priceImageKind: 'preisschild' }]);
    await scharf();
    const nachArt = (art) => mockLage.kennungen.filter((k) => k.art === art).map((k) => k.labels);
    expect(nachArt('audit').length).toBeGreaterThanOrEqual(3);
    for (const l of nachArt('audit')) expect(l).toEqual({ funktion: 'review-console', zweck: 'foto-runde-bildpruefung' });
    expect(nachArt('preis')).toEqual([
      { funktion: 'review-console', zweck: 'foto-runde-nachlesung' },
      { funktion: 'review-console', zweck: 'foto-runde-nachlesung' },
    ]);
    expect(nachArt('barcode')).toEqual([{ funktion: 'review-console', zweck: 'foto-runde-barcode' }]);
  });

  it('alle Zwecke halten das Label-Format ein', () => {
    const { KI_ZWECK, KI_FUNKTION, geminiKennung } = jest.requireActual('../src/ki');
    for (const w of [KI_FUNKTION, ...Object.values(KI_ZWECK)]) expect(w).toMatch(/^[a-z][a-z0-9_-]{0,62}$/);
    expect(geminiKennung(KI_ZWECK.BON_RUNDE)).toEqual({ labels: { funktion: 'review-console', zweck: 'bon-runde' } });
  });
});

describe('Morgenrunde — Entscheidungen Patrick 02.10.2026', () => {
  it('saubere Einreichung → freigegeben, Foto-Nummer gespeichert', async () => {
    einreichung('frei');
    const b = await scharf();
    expect(doc('frei').status).toBe('approved');
    expect(doc('frei').eanFotoOcr).toMatchObject({ ean: EAN, befund: 'gleich' });
    expect(b).toMatchObject({ freigegeben: 1, abgelehnt: 0, offen: 0, eanFoto: { gleich: 1 }, fotoAbgleich: { gescheitert: false } });
  });

  it('Wochen-Sperre: 3 Tage nach eigener Freigabe, anderer Markt und Preis → abgelehnt als doppelt_eingereicht', async () => {
    einreichung('alt', { status: 'approved', createdAt: T0 - 4 * TAG_MS, marketId: 'netto', preis: 99 });
    einreichung('neu', { createdAt: T0 - TAG_MS });
    const b = await scharf();
    expect(doc('neu')).toMatchObject({ status: 'rejected', rejectReason: 'doppelt_eingereicht', holdReasons: ['doppelt_eingereicht'] });
    expect(doc('neu').review).toMatchObject({ reason: 'sperre_woche_gleicher_nutzer', decidedBy: 'worker-fotorunde', lockUntil: T0 - 4 * TAG_MS + 7 * TAG_MS });
    expect(doc('neu').review.precheck.dup).toMatchObject({ verdict: 'locked', priorId: 'alt', updatedFields: ['price', 'market'] });
    expect(b.ablehnGruende).toEqual({ sperre_woche_gleicher_nutzer: 1 });
  });

  it('Wochen-Sperre: 8 Tage später → frei', async () => {
    einreichung('alt', { status: 'approved', createdAt: T0 - 9 * TAG_MS });
    einreichung('neu', { createdAt: T0 - TAG_MS });
    await scharf();
    expect(doc('neu').status).toBe('approved');
  });

  it('gesperrtes Konto → bleibt STUMM liegen: nichts geschrieben, keine Bildprüfung, nicht in „wartet auf dich"', async () => {
    mockStore.set('cashback_sperren/boese', { gesperrt: true, seit: ts(T0 - TAG_MS), grund: 'Fotos zu Hause', quelle: 'Entscheidung Patrick 02.10.2026' });
    einreichung('k', { uid: 'boese', createdAt: T0 - 10 * TAG_MS });
    einreichung('frei', { uid: 'u2' });
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').rejectReason).toBeUndefined();
    expect(doc('k').holdReasons).toBeUndefined();
    expect(mockWrites.filter((w) => w.path === 'crowd_uploads/k')).toEqual([]);
    expect(doc('frei').status).toBe('approved');
    expect(mockLage.auditAufrufe).toHaveLength(1);
    expect(b).toMatchObject({ abgelehnt: 0, offen: 0, wartetAufDich: [], offenGruende: {} });
    expect(b.kontoSperren).toEqual({ aktiv: 1, unlesbar: false, offenEinreichungen: 1 });
    // liegt seit 10 Tagen — trotzdem keine „wartet seit"-Warnung: er wartet auf niemanden
    expect(b.warnungen.map((w) => w.code)).not.toContain('fotos_warten');
  });

  it('aufgehobene Sperre (gesperrt:false) → normal geprüft', async () => {
    mockStore.set('cashback_sperren/u1', { gesperrt: false });
    einreichung('frei');
    await scharf();
    expect(doc('frei').status).toBe('approved');
  });

  it('Sperrliste nicht lesbar → NICHTS freigegeben, nichts wegen Sperre abgelehnt, rote Warnung', async () => {
    mockLage.sperrenFehler = true;
    einreichung('frei');
    einreichung('ohne', { uid: 'u2', ean: ANDERE });
    mockStore.set('crowd_uploads/ohne', { ...doc('ohne'), images: { front: doc('ohne').images.front } });
    const b = await scharf();
    expect(doc('frei').status).toBe('pending');
    expect(b.offenGruende).toEqual({ kontosperre_unbekannt: 1 });
    // Echte Mängel werden trotzdem entschieden.
    expect(doc('ohne')).toMatchObject({ status: 'rejected', rejectReason: 'unvollstaendig' });
    expect(b.warnungen.map((w) => w.code)).toContain('kontosperren_unlesbar');
  });

  it('Konto wird WÄHREND der Runde gesperrt → die Freigabe wird nicht geschrieben', async () => {
    einreichung('frei');
    const orig = mockDb.runTransaction;
    mockDb.runTransaction = async (fn) => { mockStore.set('cashback_sperren/u1', { gesperrt: true }); return orig(fn); };
    try {
      const b = await scharf();
      expect(doc('frei').status).toBe('pending');
      expect(b.offenGruende).toEqual({ konto_gesperrt_im_lauf: 1 });
    } finally { mockDb.runTransaction = orig; }
  });

  it('Barcode-Foto zeigt andere Nummer, zweite Lesung scheitert → bleibt liegen, Hinweis nennt die eigene Freigabe unter der Foto-Nummer', async () => {
    einreichung('unterFoto', { ean: ANDERE, status: 'approved', createdAt: T0 - 2 * TAG_MS });
    einreichung('k', { createdAt: T0 - TAG_MS });
    mockAudit.set(doc('k').images.ean, ANDERE);
    mockZweit.set(doc('k').images.ean, 'FEHLER');
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: ANDERE, befund: 'abweichend', bestaetigt: false });
    expect(doc('k').eanKorrektur).toBeUndefined();
    expect(mockLage.zweitLesungen).toEqual([[doc('k').images.ean]]);
    const f = b.wartetAufDich.find((x) => x.id === 'k');
    expect(f).toMatchObject({ grund: 'ean_abweichend' });
    expect(f.hinweis).toMatch(/eigene Freigabe/);
  });

  it('Barcode-Foto zweimal gleich, eigene Freigabe unter der Foto-Nummer binnen 7 Tagen → korrigiert und als Wochen-Doppel abgelehnt (Entscheidung Patrick 06.10.)', async () => {
    einreichung('unterFoto', { ean: ANDERE, status: 'approved', createdAt: T0 - 2 * TAG_MS });
    einreichung('k', { createdAt: T0 - TAG_MS });
    mockAudit.set(doc('k').images.ean, ANDERE);
    const b = await scharf();
    expect(doc('k')).toMatchObject({ status: 'rejected', rejectReason: 'doppelt_eingereicht', ean: EAN });
    expect(doc('k').review).toMatchObject({ reason: 'sperre_woche_gleicher_nutzer' });
    expect(doc('k').review.precheck.dup).toMatchObject({ verdict: 'locked', priorId: 'unterFoto' });
    expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, vorher: EAN, lesungen: [ANDERE, ANDERE], aus: 'heute' });
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 1, ausHeute: 1, faelle: [{ id: 'k', vorher: EAN, neu: ANDERE, entscheidung: 'ablehnen', grund: 'sperre_woche_gleicher_nutzer' }] });
  });

  it('zweite Lesung liest eine dritte Nummer (unscharfes Foto) → unsicher, bleibt liegen — nie still freigegeben (Prüfrunde 02.10.)', async () => {
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    mockZweit.set(doc('k').images.ean, '4001382088125');
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: ANDERE, befund: 'unsicher', zweit: '4001382088125', grund: 'lesungen_uneinig' });
    expect(b.eanFoto).toEqual({ unsicher: 1 });
    expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_unsicher' });
  });

  it('zweite Lesung liest die GESPEICHERTE Nummer → die erste war falsch gelesen, freigegeben (erster Tag; Entscheidung Patrick 04.10.)', async () => {
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    mockZweit.set(doc('k').images.ean, EAN);
    const b = await scharf();
    expect(doc('k').status).toBe('approved');
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: EAN, befund: 'gleich', grund: 'zweite_lesung' });
    expect(b.eanFoto).toEqual({ gleich: 1 });
  });

  it('Lidl-EAN-8 auf dem Foto (zweimal gleich), gespeichert eine ganz andere EAN → korrigiert (EAN-8 ist kein Waagen-Code) und freigegeben', async () => {
    einreichung('k');
    mockAudit.set(doc('k').images.ean, '20917937');
    await scharf();
    expect(doc('k').status).toBe('approved');
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: '20917937', befund: 'korrigiert', vorher: EAN });
    expect(doc('k').eanKorrektur).toMatchObject({ ean: '20917937', vorher: EAN });
  });

  it('gespeicherte EAN gehört zu einer eigenen Freigabe dieser Woche, das Foto zeigt zweimal etwas anderes → korrigiert, aber liegen lassen (ean_alt_doppelt) — nie ablehnen, nie freigeben', async () => {
    einreichung('alt', { status: 'approved', createdAt: T0 - 3 * TAG_MS });
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, vorher: EAN });
    const f = b.wartetAufDich[0];
    expect(f).toMatchObject({ id: 'k', grund: 'ean_alt_doppelt' });
    expect(f.hinweis).toMatch(new RegExp(`gespeichert war ${EAN}, das Foto zeigt zweimal ${ANDERE}.*eigene Freigabe vom .* \\(Nummer ${EAN}\\)`));
    // Die Konsole hält ebenfalls an (sperrend), und der Bericht zählt die Korrektur.
    expect(doc('k').review.rundeOffen).toMatchObject({ grund: 'ean_alt_doppelt', sperrend: ['ean_alt_doppelt'], eanFoto: null });
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 1, faelle: [{ id: 'k', entscheidung: 'offen', grund: 'ean_alt_doppelt' }] });
  });

  it('zweite Lesung scheitert technisch → Abweichung bleibt, Fall wird gehalten (nie freigegeben)', async () => {
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    mockZweit.set(doc('k').images.ean, 'FEHLER');
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'abweichend', bestaetigt: false });
    expect(b.wartetAufDich[0].hinweis).toMatch(/zweite Lesung gescheitert/);
  });

  it('Barcode-Foto nicht lesbar oder Waagen-Code auf beiden Seiten → kein Urteil, normal freigegeben', async () => {
    einreichung('a');
    einreichung('c', { uid: 'u3', ean: '2112345001500' });
    mockAudit.set(doc('a').images.ean, '');
    mockAudit.set(doc('c').images.ean, '2112345000008');
    const b = await scharf();
    expect(doc('a').status).toBe('approved');
    expect(doc('c').status).toBe('approved');
    expect(b.eanFoto).toEqual({ kein_urteil: 2 });
    expect(mockLage.zweitLesungen).toEqual([]); // nur bei Abweichung
  });

  it('Bildprüfung bekommt die gespeicherte EAN NICHT mit (sonst schreibt das Modell sie ab)', async () => {
    einreichung('frei');
    await scharf();
    expect(mockLage.auditTexte).toHaveLength(1);
    expect(mockLage.auditTexte[0]).not.toContain(EAN);
    expect(mockLage.auditTexte[0]).toContain('eanFoto');
    expect(mockLage.auditAufrufe[0].some((p) => p.endsWith('/ean.jpg'))).toBe(true);
  });

  it('Foto-Abgleich gegen ALLE früheren: identisches Foto einer alten eigenen Freigabe → abgelehnt', async () => {
    einreichung('alt', { status: 'approved', createdAt: T0 - 40 * TAG_MS, ean: ANDERE });
    einreichung('neu', { md5: { zutaten: 'md5_alt_zutaten' } });
    await scharf();
    expect(doc('neu')).toMatchObject({ status: 'rejected', rejectReason: 'bilder_wiederverwendet' });
    expect(doc('alt').status).toBe('approved');
  });

  it('… Preisfoto zählt nicht (gemeinsames Regalschild zweier Sorten)', async () => {
    einreichung('alt', { status: 'approved', createdAt: T0 - 40 * TAG_MS, ean: ANDERE });
    einreichung('neu', { md5: { preis: 'md5_alt_preis' } });
    await scharf();
    expect(doc('neu').status).toBe('approved');
  });

  it('… identisches Foto eines FREMDEN Kontos → liegen lassen für den Menschen', async () => {
    einreichung('fremd', { uid: 'u9', status: 'approved', createdAt: T0 - 40 * TAG_MS, ean: ANDERE });
    einreichung('neu', { md5: { front: 'md5_fremd_front' } });
    const b = await scharf();
    expect(doc('neu').status).toBe('pending');
    expect(b.offenGruende).toEqual({ foto_fremdes_konto: 1 });
  });

  it('… ältere eigene ABGELEHNTE mit gleichem Foto → normal geprüft (erlaubte Korrektur)', async () => {
    einreichung('alt', { status: 'rejected', createdAt: T0 - 3 * TAG_MS, ean: ANDERE });
    einreichung('neu', { md5: { front: 'md5_alt_front' } });
    await scharf();
    expect(doc('neu').status).toBe('approved');
  });

  it('… beide im selben Lauf offen: ältere wird freigegeben, jüngere als wiederverwendet abgelehnt', async () => {
    einreichung('a', { createdAt: T0 - 2 * TAG_MS, ean: ANDERE });
    einreichung('b', { createdAt: T0 - TAG_MS, md5: { rueckseite: 'md5_a_rueckseite' } });
    await scharf();
    expect(doc('a').status).toBe('approved');
    expect(doc('b')).toMatchObject({ status: 'rejected', rejectReason: 'bilder_wiederverwendet' });
  });

  it('Storage-Liste gescheitert → keine Freigabe, rote Warnung', async () => {
    mockLage.listeFehler = true;
    einreichung('frei');
    const b = await scharf();
    expect(doc('frei').status).toBe('pending');
    expect(b.offenGruende).toEqual({ foto_abgleich_gescheitert: 1 });
    expect(b.warnungen.map((w) => w.code)).toContain('foto_abgleich_gescheitert');
  });

  it('nurLesen: kein einziger Schreibvorgang, Plan mit Eingaben je Fall', async () => {
    mockStore.set('cashback_sperren/boese', { gesperrt: true });
    einreichung('alt', { status: 'approved', createdAt: T0 - 4 * TAG_MS });
    einreichung('neu');
    einreichung('k', { uid: 'boese' });
    const r = await taeglicheRunde({ projekt: 'p', bucketName: 'b', nurLesen: true });
    expect(mockWrites).toEqual([]);
    expect(doc('neu').status).toBe('pending');
    // gleicher Zeitpunkt → nach ID (eindeutige Reihenfolge)
    expect(r.plan.map((p) => [p.id, p.entscheidung, p.grund])).toEqual([
      ['k', 'offen', 'konto_gesperrt'],
      ['neu', 'ablehnen', 'sperre_woche_gleicher_nutzer'],
    ]);
    expect(r.plan.find((p) => p.id === 'neu').eingabe.dup).toMatchObject({ verdict: 'locked', priorId: 'alt' });
    expect(r.kontoSperren).toBe(1);
  });

  it('„0" + EAN-13 eingetippt umgeht die Wochen-Sperre nicht (Prüfrunde 02.10.)', async () => {
    einreichung('alt', { status: 'approved', createdAt: T0 - 3 * TAG_MS });
    einreichung('neu', { ean: '0' + EAN });
    const b = await scharf();
    expect(doc('neu')).toMatchObject({ status: 'rejected', rejectReason: 'doppelt_eingereicht', review: { reason: 'sperre_woche_gleicher_nutzer' } });
    expect(b.ablehnGruende).toEqual({ sperre_woche_gleicher_nutzer: 1 });
  });

  it('verschobenes createdAt (veränderter Client) umgeht die Wochen-Sperre nicht: es gilt der Server-Zeitpunkt (Prüfrunde 02.10.)', async () => {
    einreichung('alt', { status: 'approved', createdAt: T0 - 3 * TAG_MS });
    einreichung('neu', { createdAt: T0 - 40 * TAG_MS });
    mockCreate.set('crowd_uploads/neu', T0 - TAG_MS);
    await scharf();
    expect(doc('neu')).toMatchObject({ status: 'rejected', review: { reason: 'sperre_woche_gleicher_nutzer' } });
  });

  it('Fotos einer als Doppel abgelehnten Einreichung eine Woche später erneut eingereicht → wiederverwendet (Prüfrunde 02.10.)', async () => {
    einreichung('a', { status: 'approved', createdAt: T0 - 10 * TAG_MS });
    einreichung('b', { status: 'rejected', createdAt: T0 - 9 * TAG_MS, rejectReason: 'doppelt_eingereicht', review: { reason: 'sperre_woche_gleicher_nutzer' } });
    einreichung('c', { createdAt: T0 - TAG_MS, md5: { front: 'md5_b_front', zutaten: 'md5_b_zutaten' } });
    await scharf();
    expect(doc('c')).toMatchObject({ status: 'rejected', rejectReason: 'bilder_wiederverwendet' });
  });

  it('… nach einer Ablehnung wegen eines behebbaren Mangels bleibt die Korrektur mit denselben Fotos möglich', async () => {
    einreichung('b', { status: 'rejected', createdAt: T0 - 9 * TAG_MS, rejectReason: 'ean_fehlt' });
    einreichung('c', { createdAt: T0 - TAG_MS, md5: { front: 'md5_b_front' } });
    await scharf();
    expect(doc('c').status).toBe('approved');
  });

  it('Referenz-Freigabe im Lauf NICHT geschrieben → die Sperr-Ablehnung, die sich auf sie stützt, auch nicht (Prüfrunde 02.10.)', async () => {
    einreichung('a', { createdAt: T0 - 3 * TAG_MS });
    einreichung('b', { createdAt: T0 - TAG_MS });
    const orig = mockDb.runTransaction;
    let erste = true;
    // Während der Runde entscheidet jemand anderes über a (Status nicht mehr pending) → a wird übersprungen.
    mockDb.runTransaction = async (fn) => {
      if (erste) { erste = false; mockStore.set('crowd_uploads/a', { ...doc('a'), status: 'rejected', rejectReason: 'fotos_unpassend' }); }
      return orig(fn);
    };
    try {
      const b = await scharf();
      expect(doc('b').status).toBe('pending');
      expect(b.wartetAufDich.find((x) => x.id === 'b')).toMatchObject({ grund: 'beleg_nicht_geschrieben', zurueckgehalten: 'sperre_woche_gleicher_nutzer' });
      expect(b.abgelehnt).toBe(0);
    } finally { mockDb.runTransaction = orig; }
  });

  it('… im Normalfall wird die Referenz zuerst geschrieben, dann die Sperre', async () => {
    einreichung('a', { createdAt: T0 - 3 * TAG_MS });
    einreichung('b', { createdAt: T0 - TAG_MS });
    await scharf();
    expect(doc('a').status).toBe('approved');
    expect(doc('b')).toMatchObject({ status: 'rejected', review: { reason: 'sperre_woche_gleicher_nutzer' } });
  });
});

describe('Prüfrunde 2 (02.10.2026): Barcode-Befund hält über Tage, Konsole erfährt den Halte-Grund', () => {
  const GESTERN = '2026-10-02_080000';
  const KFS = '4250231136474';
  const FOTO_GESTERN = '4013602136424';
  const rundeOffen = (id) => (doc(id).review || {}).rundeOffen;
  const eanFotoWrites = (id) => mockWrites.filter((w) => w.path === `crowd_uploads/${id}` && w.data.eanFotoOcr);

  it('Kfs5jFA6qqOF8gD9iTEk: gestern abweichend, heute falsche Prüfziffer nah an der gespeicherten (kein Urteil) → bleibt liegen; der Widerspruch wird als `unsicher` festgehalten (Prüfrunde 06.10.)', async () => {
    einreichung('k', { ean: KFS, eanFotoOcr: { ean: FOTO_GESTERN, befund: 'abweichend', bestaetigt: true, lauf: GESTERN } });
    mockAudit.set(doc('k').images.ean, '4250231136470'); // eine Ziffer daneben → kein Urteil
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanKorrektur).toBeUndefined();
    const f = b.wartetAufDich.find((x) => x.id === 'k');
    expect(f).toMatchObject({ grund: 'ean_unsicher' });
    expect(f.hinweis).toMatch(/am 2026-10-02_080000 zweimal 4013602136424 gelesen, heute kein_urteil/);
    expect(f.hinweis).toMatch(/Lesungen uneinig über mehrere Tage/);
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: FOTO_GESTERN, befund: 'unsicher', grund: 'lesungen_uneinig_tage', lauf: b.lauf });
    expect(b.eanFotoVorbefund).toEqual({ haelt: 1 });
    expect(b.eanHaltenNeu ?? 0).toBe(0);
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 0, uneinigUeberTage: 1 });
    expect(rundeOffen('k')).toMatchObject({ grund: 'ean_unsicher', sperrend: ['ean_unsicher'], eanFoto: { befund: 'unsicher', ean: FOTO_GESTERN } });
  });

  it('… dieselbe Lesung wie im zweiten Trockenlauf (4013602313647: Prüfziffer falsch, 12 Stellen anders) → zweite Lesung, ohne gestrigen Befund ebenfalls liegen', async () => {
    einreichung('k', { ean: KFS });
    mockAudit.set(doc('k').images.ean, '4013602313647');
    mockZweit.set(doc('k').images.ean, '');
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(mockLage.zweitLesungen).toHaveLength(1);
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: '4013602313647', befund: 'unsicher', grund: 'zweite_lesung_leer' });
    expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_unsicher' });
  });

  it('falsche Prüfziffer weit weg, die zweite Lesung liefert die gespeicherte Nummer → freigegeben', async () => {
    einreichung('k', { ean: KFS });
    mockAudit.set(doc('k').images.ean, '4013602313647');
    mockZweit.set(doc('k').images.ean, KFS);
    await scharf();
    expect(doc('k').status).toBe('approved');
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: KFS, befund: 'gleich', grund: 'zweite_lesung' });
  });

  it('gestern unsicher, heute liest die Bildprüfung die gespeicherte Nummer (und eine zweite Lesung täte es auch) → bleibt liegen, kein automatisches Aufheben (Schlussprüfung 03.10.)', async () => {
    const vorher = { ean: FOTO_GESTERN, befund: 'unsicher', zweit: null, grund: 'zweite_lesung_leer', lauf: GESTERN };
    einreichung('k', { ean: KFS, eanFotoOcr: vorher });
    mockZweit.set(doc('k').images.ean, KFS);
    const b = await scharf(); // die Bildprüfung liest die gespeicherte Nummer
    expect(mockLage.zweitLesungen).toEqual([]); // keine zweite Lesung — sie könnte nichts mehr aufheben
    expect(doc('k').status).toBe('pending');
    expect(eanFotoWrites('k')).toEqual([]);
    expect(doc('k').eanFotoOcr).toEqual(vorher);
    expect(b.eanFotoVorbefund).toEqual({ haelt: 1 });
    const f = b.wartetAufDich.find((x) => x.id === 'k');
    expect(f.grund).toBe('ean_unsicher');
    expect(f.hinweis).toMatch(/gilt bis zur Entscheidung in der Konsole; heute gleich/);
    expect(rundeOffen('k').sperrend).toEqual(['ean_unsicher']);
  });

  it('… gestern abweichend (unbestätigt), heute die gespeicherte → bleibt liegen, als `unsicher` über Tage festgehalten (Prüfrunde 06.10.)', async () => {
    einreichung('k', { ean: KFS, eanFotoOcr: { ean: FOTO_GESTERN, befund: 'abweichend', bestaetigt: false, lauf: GESTERN } });
    const b = await scharf();
    expect(mockLage.zweitLesungen).toEqual([]);
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: FOTO_GESTERN, befund: 'unsicher', grund: 'lesungen_uneinig_tage', zweit: KFS });
    expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_unsicher' });
    expect(rundeOffen('k').sperrend).toEqual(['ean_unsicher']);
  });

  it('… nur EINE Lesung der gespeicherten Nummer (zweite liest etwas anderes) → bleibt liegen', async () => {
    einreichung('k', { ean: KFS, eanFotoOcr: { ean: FOTO_GESTERN, befund: 'unsicher', zweit: null, lauf: GESTERN } });
    mockZweit.set(doc('k').images.ean, '');
    await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'unsicher', ean: FOTO_GESTERN, lauf: GESTERN });
  });

  it('… gegen eine schon BESTÄTIGTE Abweichung hebt auch das nichts auf (ein Mensch entscheidet)', async () => {
    einreichung('k', { ean: KFS, eanFotoOcr: { ean: FOTO_GESTERN, befund: 'abweichend', bestaetigt: true, lauf: GESTERN } });
    const b = await scharf();
    expect(mockLage.zweitLesungen).toEqual([]); // aufheben ginge ohnehin nicht — keine zweite Lesung bezahlen
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanKorrektur).toBeUndefined();
    expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_unsicher' });
    expect(b.wartetAufDich[0].hinweis).toMatch(/heute gleich \(4250231136474\)/);
  });

  it('heute keine Bildprüfung (Fehler) → der alte Befund steht trotzdem als sperrend am Dokument', async () => {
    einreichung('k', { ean: KFS, eanFotoOcr: { ean: FOTO_GESTERN, befund: 'abweichend', bestaetigt: false, lauf: GESTERN } });
    mockAudit.set(doc('k').images.ean, 'AUDIT_FEHLER');
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_abweichend' });
    expect(rundeOffen('k')).toMatchObject({ sperrend: ['ean_abweichend'] });
  });

  it('zweite Lesung bekommt keine Zeit mehr (Arbeitszeit vorbei) → Abweichung bleibt unbestätigt stehen, nie freigegeben', async () => {
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    mockLage.nachAudit = () => dateSpy.mockImplementation(() => T0 + 23 * 60 * 1000); // hinter ARBEITSZEIT_MS (22 min)
    await scharf();
    expect(mockLage.zweitLesungen).toEqual([]);
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: ANDERE, befund: 'abweichend', bestaetigt: false, fehler: 'zeit_abgelaufen' });
  });

  it('eanFotoOcr nicht speicherbar → Halte-Befund steht in review.rundeOffen; der nächste Lauf hält damit und repariert eanFotoOcr', async () => {
    einreichung('k', { ean: KFS });
    mockAudit.set(doc('k').images.ean, ANDERE);
    mockZweit.set(doc('k').images.ean, 'FEHLER'); // unbestätigt → keine Korrektur
    // Befund ohne Korrektur: seit Prüfrunde 2 zur Barcode-Korrektur in einer Transaktion (nur an offenen Einreichungen)
    mockLage.txUpdateFehler = (pfad, daten) => !!daten.eanFotoOcr;
    const b = await scharf();
    expect(doc('k').eanFotoOcr).toBeUndefined();
    expect(b.eanFotoNichtGespeichert).toBe(1);
    expect(b.warnungen.map((w) => w.code)).toContain('barcode_befund_nicht_gespeichert');
    expect(rundeOffen('k')).toMatchObject({ sperrend: ['ean_abweichend'], eanFoto: { befund: 'abweichend', ean: ANDERE, bestaetigt: false } });
    // nächster Morgen: das Foto ist heute unlesbar — gehalten wird trotzdem
    mockLage.txUpdateFehler = () => false;
    mockAudit.set(doc('k').images.ean, '');
    mockWrites.length = 0;
    const b2 = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(b2.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_abweichend' });
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: ANDERE, befund: 'abweichend', bestaetigt: false });
  });

  it('Foto eines FREMDEN Kontos → review.rundeOffen mit Grund, Hinweis und sperrendem Befund (die Konsole hält damit an); NICHT holdReasons', async () => {
    einreichung('fremd', { uid: 'u9', status: 'approved', createdAt: T0 - 40 * TAG_MS, ean: ANDERE });
    einreichung('neu', { md5: { front: 'md5_fremd_front' } });
    const b = await scharf();
    expect(doc('neu').status).toBe('pending');
    expect(rundeOffen('neu')).toEqual({
      grund: 'foto_fremdes_konto', hinweis: 'Gleiches Foto bei 1 Einreichung eines anderen Kontos — welche, steht im Tagesbericht', zurueckgehalten: null,
      sperrend: ['foto_fremdes_konto'], fotoSeit: b.lauf, eanFoto: null, lauf: b.lauf, trocken: false, at: mockSentinel,
    });
    // die ID der fremden Einreichung steht nur im Bericht (Admins), nicht am Dokument des Einreichers
    expect(b.wartetAufDich.find((x) => x.id === 'neu').hinweis).toMatch(/fremd/);
    expect(JSON.stringify(doc('neu').review)).not.toMatch(/"fremd"|: fremd/);
    expect(doc('neu').holdReasons).toBeUndefined();
    expect(b.rundeOffen).toMatchObject({ geschrieben: 1, fehler: 0 });
  });

  it('… Foto eines fremden Kontos hält bis zur Entscheidung in der Konsole, auch wenn sich die md5-Grundlage ändert (Original überschrieben, Schlussprüfung 03.10.)', async () => {
    einreichung('fremd', { uid: 'u9', status: 'approved', createdAt: T0 - 40 * TAG_MS, ean: ANDERE });
    einreichung('neu', { md5: { front: 'md5_fremd_front' } });
    const b1 = await scharf();
    expect(rundeOffen('neu')).toMatchObject({ sperrend: ['foto_fremdes_konto'], fotoSeit: b1.lauf });
    // das fremde Konto überschreibt sein Original (storage.rules erlaubt es) → heute kein gemeinsames Foto mehr
    mockListe.set(doc('fremd').images.front, { md5: 'md5_fremd_front_neu', size: 1234 });
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    const b2 = await scharf();
    expect(doc('neu').status).toBe('pending');
    expect(rundeOffen('neu')).toMatchObject({ grund: 'foto_fremdes_konto', sperrend: ['foto_fremdes_konto'], fotoSeit: b1.lauf, lauf: b2.lauf });
    expect(rundeOffen('neu').hinweis).toMatch(new RegExp(`Befund vom ${b1.lauf}, gilt bis zur Entscheidung in der Konsole`));
    expect(JSON.stringify(rundeOffen('neu'))).not.toMatch(/fremd"|: fremd/);
    expect(b2.fotoVorbefund).toEqual({ haelt: 1 });
    // auch ein Trockenlauf und eine gescheiterte Bildprüfung lassen ihn stehen
    mockAudit.set(doc('neu').images.ean, 'AUDIT_FEHLER');
    await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(rundeOffen('neu')).toMatchObject({ sperrend: ['foto_fremdes_konto'], fotoSeit: b1.lauf, trocken: true });
    // erst ein Mensch löst ihn: jede Entscheidung in der Konsole ersetzt `review` — hier Ablehnen + Zurückholen
    // (nachgestellt wie index.js 'reopen') → die Runde rechnet neu und gibt frei
    mockStore.set('crowd_uploads/neu', { ...doc('neu'), review: { reopenedBy: 'patrick', wiedereroeffnet: { vorherGrund: 'fotos_unpassend', vorherIntern: 'fotos_unpassend', vorherVon: 'patrick' } } });
    mockAudit.delete(doc('neu').images.ean);
    await scharf();
    expect(doc('neu').status).toBe('approved');
  });

  it('Eintrag ohne Foto-Befund, der heute nicht mehr zutrifft → entfernt (Trockenlauf würde freigeben)', async () => {
    einreichung('neu', { review: { rundeOffen: { grund: 'bild_audit_gescheitert', sperrend: [], lauf: GESTERN } } });
    const b = await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(doc('neu').status).toBe('pending');
    expect(doc('neu').review).toEqual({});
    expect(b.rundeOffen).toMatchObject({ entfernt: 1 });
  });

  it('… ältere eigene offene Einreichung entschieden → foto_aeltere_offen löst sich auf (kein Übernehmen, wenn heute vollständig gerechnet)', async () => {
    einreichung('a', { createdAt: T0 - 2 * TAG_MS, ean: ANDERE, status: 'rejected', rejectReason: 'ean_fehlt' });
    einreichung('b', { createdAt: T0 - TAG_MS, md5: { rueckseite: 'md5_a_rueckseite' }, review: { rundeOffen: { grund: 'foto_aeltere_offen', sperrend: ['foto_aeltere_offen'], lauf: GESTERN } } });
    await scharf();
    expect(doc('b').status).toBe('approved');
  });

  it('M1: Foto-Halt vom Vortag, heute scheitert die Storage-Liste → Halt bleibt in rundeOffen (die Konsole hält weiter an)', async () => {
    for (const code of ['foto_fremdes_konto', 'foto_aeltere_offen', 'bilder_wiederverwendet']) {
      mockStore.clear(); mockWrites.length = 0;
      mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true });
      mockLage.listeFehler = true;
      einreichung('k', { review: { rundeOffen: { grund: code, sperrend: [code], lauf: GESTERN } } });
      const b = await scharf();
      expect(doc('k').status).toBe('pending'); // nie abgelehnt, nie freigegeben
      expect(rundeOffen('k')).toMatchObject({ grund: code, sperrend: [code], fotoSeit: GESTERN });
      expect(rundeOffen('k').hinweis).toMatch(/heute nicht nachprüfbar|gilt bis zur Entscheidung/);
      expect(b.fotoAbgleich).toMatchObject({ gescheitert: true, unvollstaendig: 1 });
    }
  });

  it('M1: … ebenso bei einem nicht abrufbaren oder md5-losen Identitätsfoto des Falls', async () => {
    for (const kaputt of [() => mockListe.delete(doc('k').images.front), () => mockListe.set(doc('k').images.front, { md5: null, size: 5000 })]) {
      mockStore.clear(); mockWrites.length = 0; mockListe.clear();
      mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true });
      einreichung('k', { review: { rundeOffen: { grund: 'foto_aeltere_offen', sperrend: ['foto_aeltere_offen'], lauf: GESTERN } } });
      kaputt();
      const b = await scharf();
      expect(doc('k').status).toBe('pending');
      expect(rundeOffen('k')).toMatchObject({ sperrend: ['foto_aeltere_offen'], fotoSeit: GESTERN });
      expect(b.fotoAbgleich.unvollstaendig).toBe(1);
    }
  });

  it('M1: Gegenprobe — ohne Vortags-Befund und mit vollständigem Abgleich wird nichts übernommen (normal freigegeben)', async () => {
    einreichung('k', { review: { rundeOffen: { grund: 'bild_audit_gescheitert', sperrend: [], lauf: GESTERN } } });
    const b = await scharf();
    expect(doc('k').status).toBe('approved');
    expect(b.fotoVorbefund).toEqual({ haelt: 0 });
    expect(b.fotoAbgleich).toMatchObject({ gescheitert: false, unvollstaendig: 0 });
  });

  it('Trockenlauf: geplante Ablehnung wegen wiederverwendeter Fotos landet mit `geplant` am Dokument (die Konsole hält an)', async () => {
    einreichung('alt', { status: 'approved', createdAt: T0 - 40 * TAG_MS, ean: ANDERE });
    einreichung('neu', { md5: { zutaten: 'md5_alt_zutaten' } });
    await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(doc('neu').status).toBe('pending');
    expect(rundeOffen('neu')).toMatchObject({ grund: 'bilder_wiederverwendet', geplant: 'ablehnen', sperrend: ['bilder_wiederverwendet'], trocken: true });
  });

  it('Halte-Grund nicht speicherbar → rote Warnung (die Konsole sähe den Fall als unauffällig)', async () => {
    einreichung('fremd', { uid: 'u9', status: 'approved', createdAt: T0 - 40 * TAG_MS, ean: ANDERE });
    einreichung('neu', { md5: { front: 'md5_fremd_front' } });
    mockLage.txUpdateFehler = (pfad, daten) => Object.keys(daten).includes('review.rundeOffen');
    const b = await scharf();
    expect(b.rundeOffen).toMatchObject({ fehler: 1, fehlerSperrend: 1 });
    expect(b.warnungen.find((w) => w.code === 'befund_nicht_gespeichert')).toMatchObject({ stufe: 'rot' });
  });

  it('entschiedene Fälle bekommen keinen Eintrag; ein Eintrag vom Vortag verschwindet mit der Entscheidung', async () => {
    einreichung('frei', { review: { rundeOffen: { grund: 'bild_audit_gescheitert', sperrend: [], lauf: GESTERN } } });
    await scharf();
    expect(doc('frei').status).toBe('approved');
    expect(doc('frei').review.rundeOffen).toBeUndefined();
  });

  it('Kopien, von denen keine je bezahlt wurde: Fotos einer als Doppel abgelehnten Einreichung sind KEIN Beleg (Vorfall 10.09., Prüfrunde 2)', async () => {
    einreichung('b', { status: 'rejected', createdAt: T0 - 9 * TAG_MS, rejectReason: 'doppelt_eingereicht' });
    einreichung('c', { createdAt: T0 - TAG_MS, ean: ANDERE, md5: { front: 'md5_b_front' } });
    await scharf();
    expect(doc('c').status).toBe('approved');
  });

  it('gestern gehaltene Einreichung eines inzwischen gesperrten Kontos → nichts geschrieben (liegt stumm)', async () => {
    mockStore.set('cashback_sperren/u1', { gesperrt: true });
    einreichung('k', { ean: KFS, eanFotoOcr: { ean: FOTO_GESTERN, befund: 'abweichend', lauf: GESTERN } });
    await scharf();
    expect(mockWrites.filter((w) => w.path === 'crowd_uploads/k')).toEqual([]);
  });
});

describe('Schlussprüfung 03.10.2026: Kontosperre vor einer Ablehnung', () => {
  it('Sperrliste nicht lesbar, Konto gesperrt, die Runde würde ablehnen → unverändert liegen (stumm), nichts am Dokument', async () => {
    mockLage.sperrenFehler = true;
    mockStore.set('cashback_sperren/boese', { gesperrt: true });
    einreichung('alt', { uid: 'boese', status: 'approved', createdAt: T0 - 3 * TAG_MS });
    einreichung('neu', { uid: 'boese' });
    const b = await scharf();
    expect(doc('neu').status).toBe('pending');
    expect(doc('neu').rejectReason).toBeUndefined();
    expect(doc('neu').review).toBeUndefined();
    expect(mockWrites.filter((w) => w.path === 'crowd_uploads/neu' && !w.data.eanFotoOcr)).toEqual([]);
    expect(b.abgelehnt).toBe(0);
    expect(b.offenGruende).toEqual({ konto_gesperrt_im_lauf: 1 });
  });

  it('… nicht gesperrtes Konto: die Ablehnung wird geschrieben', async () => {
    mockLage.sperrenFehler = true;
    einreichung('alt', { status: 'approved', createdAt: T0 - 3 * TAG_MS });
    einreichung('neu');
    await scharf();
    expect(doc('neu')).toMatchObject({ status: 'rejected', review: { reason: 'sperre_woche_gleicher_nutzer' } });
  });

  it('… Sperre beim Schreiben nicht lesbar → weder Ablehnung noch Freigabe (schreib_fehler)', async () => {
    einreichung('alt', { status: 'approved', createdAt: T0 - 3 * TAG_MS });
    einreichung('neu');
    const orig = mockDb.runTransaction;
    mockDb.runTransaction = async (fn) => orig((tx) => fn({ ...tx, get: (ref) => (ref.path.startsWith('cashback_sperren/') ? Promise.reject(new Error('UNAVAILABLE')) : tx.get(ref)) }));
    try {
      const b = await scharf();
      expect(doc('neu').status).toBe('pending');
      expect(b.offenGruende).toEqual({ schreib_fehler: 1 });
    } finally { mockDb.runTransaction = orig; }
  });
});

describe('Bildschirmfoto als Preisbeleg (Patrick 04.10.2026: „ja, bau das")', () => {
  const { png, jpeg, EXIF } = require('./helpers/bildKopfDaten');
  const { rowOf, precheckOf } = require('../src/einreichung');
  const preisPfad = (id, uid = 'u1') => `crowduploads/${uid}/${id}/preis.jpg`;
  /**
   * Einreichung, deren Preisfoto die Bildprüfung als `quelle` sieht und deren Datei `kopf` beginnt.
   * Der Lesedienst hat das Preisfoto standardmäßig gelesen und ein Preisschild
   * gesehen — so wie bei 26 von 40 gemessenen Bildschirmfotos (Prüfrunde 3:
   * ohne Lesung wird nie abgelehnt).
   */
  function mitPreisfoto(id, quelle, kopf, extra = {}) {
    einreichung(id, { priceImageKind: 'preisschild', ...extra });
    if (quelle) mockQuelle.set(preisPfad(id, extra.uid), quelle);
    if (kopf) mockKopf.set(preisPfad(id, extra.uid), kopf);
  }
  const schalter = (v) => mockStore.set('cashback_config/v1', { fotoWorker: true, ...(v === undefined ? {} : { preisBildschirmRegel: v }) });

  it('ohne Schalter = Beobachtung: Bildschirmfoto wird freigegeben, der Befund steht NUR im Bericht', async () => {
    mitPreisfoto('schirm', 'bildschirm', png(1080, 2400));
    const b = await scharf();
    expect(mockLage.auditTexte[0]).toContain('"preisQuelle":"laden|kassenbon|bildschirm|keiner|unklar"');
    expect(doc('schirm').status).toBe('approved');
    // Gegenprüfung 04.10.2026: das Dokument liest der Einreicher — keine
    // Woche Vorwarnung an jedem bezahlten Bildschirmfoto.
    expect(doc('schirm').review.bildAudit).not.toHaveProperty('preisQuelle');
    expect(doc('schirm').review.bildAudit).not.toHaveProperty('preisQuelleGrund');
    expect(doc('schirm').review).not.toHaveProperty('preisBildschirm');
    expect(JSON.stringify(doc('schirm'))).not.toMatch(/Statusleiste|bildschirm/i);
    expect(b.preisBildschirm).toMatchObject({
      modus: 'shadow', befragt: 1, quellen: { bildschirm: 1 }, merkmal: { ja: 1 }, befundAblehnen: 1, befundHalten: 0, stattFreigabe: 1, kassenbonMitMerkmal: 0,
      faelle: [{ id: 'schirm', befund: 'ablehnen', ohneRegel: 'freigeben', entscheidung: 'freigeben', quelle: 'bildschirm', merkmal: true, lesedienstBon: false, datei: 'png 1080×2400' }],
    });
    // gelesen wird nur der Anfang der Datei
    expect(mockDownloads).toEqual([{ p: preisPfad('schirm'), opts: { start: 0, end: 192 * 1024 - 1 } }]);
  });

  it('scharf (true): Bildschirm UND Merkmale → abgelehnt, am Dokument fotos_unpassend, intern preis_bildschirm', async () => {
    schalter(true);
    mitPreisfoto('schirm', 'bildschirm', jpeg(1080, 2400));
    const b = await scharf();
    expect(doc('schirm')).toMatchObject({
      status: 'rejected', rejectReason: 'fotos_unpassend', holdReasons: ['fotos_unpassend'],
      review: { reason: 'preis_bildschirm' },
    });
    expect(doc('schirm').reviewNote).toMatch(/Bildschirm/);
    expect(JSON.stringify(doc('schirm').review)).not.toMatch(/Statusleiste|merkmal|png|jpg/i);
    expect(b).toMatchObject({ abgelehnt: 1, freigegeben: 0, ablehnGruende: { preis_bildschirm: 1 } });
  });

  it('scharf: Bildschirm, aber Kamerafoto (abfotografierter Bildschirm?) → liegen lassen, die Konsole zeigt denselben Befund', async () => {
    schalter(true);
    mitPreisfoto('kamera', 'bildschirm', jpeg(3000, 4000));
    const b = await scharf();
    const d = doc('kamera');
    expect(d.status).toBe('pending');
    expect(d.review.rundeOffen).toMatchObject({ grund: 'preis_bildschirm_unsicher', sperrend: [], preisBildschirm: { modus: true, befund: 'halten' } });
    expect(JSON.stringify(d.review.rundeOffen)).not.toMatch(/Statusleiste|merkmal|Kamera|format/i);
    expect(d.holdReasons).toBeUndefined(); // die App zeigt „wird geprüft", nicht „zurückgestellt"
    expect(b.offenGruende).toEqual({ preis_bildschirm_unsicher: 1 });
    // Prüfkonsole: Hinweis, keine Sperre
    const pre = precheckOf(rowOf({ id: 'kamera', data: () => d }), []);
    expect(pre).toMatchObject({ verdict: 'ok', hinweise: ['preis_bildschirm_unsicher'] });
  });

  it('scharf: e-Bon als Bildschirmfoto zählt (Kassenbon immer erlaubt) — im Bericht gezählt', async () => {
    schalter(true);
    mitPreisfoto('ebon', 'kassenbon', png(1080, 2400), { priceImageKind: 'kassenbon' });
    const b = await scharf();
    expect(doc('ebon').status).toBe('approved');
    expect(b.preisBildschirm).toMatchObject({ kassenbonMitMerkmal: 1, befundAblehnen: 0, befundHalten: 0, faelle: [] });
  });

  it('scharf: Regalfoto aus der App-Kamera → freigegeben, kein Befund', async () => {
    schalter(true);
    mitPreisfoto('regal', 'laden', jpeg(3000, 4000));
    const b = await scharf();
    expect(doc('regal').status).toBe('approved');
    expect(doc('regal').review).not.toHaveProperty('preisBildschirm');
    expect(b.preisBildschirm).toMatchObject({ quellen: { laden: 1 }, merkmal: { nein: 1 }, faelle: [] });
  });

  it('scharf: Datei nicht lesbar ist kein Urteil — „Bildschirm" ohne Merkmale bleibt liegen, nie abgelehnt', async () => {
    schalter(true);
    mitPreisfoto('weg', 'bildschirm', 'FEHLER');
    const b = await scharf();
    expect(doc('weg').status).toBe('pending');
    expect(doc('weg').review.rundeOffen).toMatchObject({ grund: 'preis_bildschirm_unsicher', preisBildschirm: { modus: true, befund: 'halten' } });
    expect(b.preisBildschirm.merkmal).toEqual({ unbekannt: 1 });
  });

  // Gegenprüfung 04.10.2026: ein Technikfehler darf auch nichts FREIGEBEN.
  it('scharf: „Laden", aber Kopf des Preisfotos nicht abrufbar → liegen lassen (preis_kopf_nicht_lesbar), Warnung ab 3', async () => {
    schalter(true);
    for (const id of ['w1', 'w2', 'w3']) mitPreisfoto(id, 'laden', 'FEHLER', { ean: String(4000000000000 + id.charCodeAt(1) * 97) });
    const b = await scharf();
    for (const id of ['w1', 'w2', 'w3']) {
      expect(doc(id).status).toBe('pending');
      expect(doc(id).review.rundeOffen).toMatchObject({ grund: 'preis_kopf_nicht_lesbar' });
      expect(doc(id).review.rundeOffen.hinweis).toMatch(/nicht abrufbar \(Technik\)/);
      // kein Befund über das Foto → nicht weitergetragen
      expect(doc(id).review.rundeOffen).not.toHaveProperty('preisBildschirm');
    }
    expect(b.preisBildschirm.kopfNichtAbrufbar).toBe(3);
    expect(b.warnungen.map((w) => w.code)).toContain('preisfoto_kopf_nicht_abrufbar');
    expect(b.warnungen.map((w) => w.code)).not.toContain('preisquelle_haelt_viele');
    // Am nächsten Morgen ist Storage wieder da → neu geprüft, freigegeben
    mockKopf.clear();
    await scharf();
    for (const id of ['w1', 'w2', 'w3']) expect(doc(id).status).toBe('approved');
  });

  // Gegenprüfung 04.10.2026: e-Bons tragen die Merkmale immer — ihr Schutz
  // darf nicht an einer einzigen Modellantwort hängen.
  it('scharf: „Bildschirm" + Merkmale, aber der Lesedienst erkannte einen Kassenbon → nie abgelehnt, liegt; Warnung ab 2', async () => {
    schalter(true);
    mitPreisfoto('ebon1', 'bildschirm', png(1080, 2400), { priceImageKind: 'kassenbon' });
    mitPreisfoto('ebon2', 'bildschirm', png(1080, 2400), { ean: '4000000000017', priceReceipt: { merchant: 'Lidl', zip: '10115' } });
    const b = await scharf();
    for (const id of ['ebon1', 'ebon2']) {
      expect(doc(id).status).toBe('pending');
      expect(doc(id).review.rundeOffen).toMatchObject({ grund: 'preis_bildschirm_unsicher', preisBildschirm: { befund: 'halten' } });
    }
    expect(b).toMatchObject({ abgelehnt: 0 });
    expect(b.preisBildschirm).toMatchObject({ bildschirmTrotzBon: 2, bildschirmTrotzBonAusVortagen: 0, befundAblehnen: 0 });
    expect(b.warnungen.map((w) => w.code)).toContain('preisquelle_bon_als_bildschirm');
    // Nachprüfung 06.10.2026: Tag 2 ohne Entscheidung in der Konsole, dieselbe
    // Lesung — dieselben Fälle lösen die Warnung nicht jeden Morgen erneut aus.
    const b2 = await scharf();
    for (const id of ['ebon1', 'ebon2']) expect(doc(id).status).toBe('pending');
    expect(b2.preisBildschirm).toMatchObject({ bildschirmTrotzBon: 0, bildschirmTrotzBonAusVortagen: 2, ausVortagen: 2 });
    expect(b2.warnungen.map((w) => w.code)).not.toContain('preisquelle_bon_als_bildschirm');
  });

  it('scharf: erkennt der Lesedienst während des Laufs einen Kassenbon → die Ablehnung wird nicht geschrieben', async () => {
    schalter(true);
    mitPreisfoto('spaet', 'bildschirm', png(1080, 2400));
    mockLage.nachAudit = () => { const d = doc('spaet'); mockStore.set('crowd_uploads/spaet', { ...d, priceImageKind: 'kassenbon' }); };
    const b = await scharf();
    expect(doc('spaet').status).toBe('pending');
    expect(b).toMatchObject({ abgelehnt: 0 });
  });

  // Nachprüfung 06.10.2026: ein übersprungener Fall hat heute kein Urteil —
  // vorher entfernte die Runde dabei den Eintrag des Vortags samt allem, was
  // weiter gelten sollte (etwa der Sperre gegen eine Ablehnung).
  it('… übersprungen: der Eintrag des Vortags bleibt unverändert', async () => {
    schalter(true);
    const alt = { grund: 'bild_audit_gescheitert', hinweis: 'Bildprüfung gescheitert', sperrend: [], lauf: 'L0', trocken: false, preisBildschirm: { modus: 'shadow', befund: 'halten', seit: 'L0' } };
    mitPreisfoto('spaet', 'bildschirm', png(1080, 2400), { review: { rundeOffen: alt } });
    mockLage.nachAudit = () => { const d = doc('spaet'); mockStore.set('crowd_uploads/spaet', { ...d, priceImageKind: 'kassenbon' }); };
    const b = await scharf();
    expect(doc('spaet').status).toBe('pending');
    expect(b).toMatchObject({ abgelehnt: 0 });
    expect(doc('spaet').review.rundeOffen).toEqual(alt);
    expect(mockWrites.filter((w) => w.path === 'crowd_uploads/spaet' && w.data['review.rundeOffen'] !== undefined)).toEqual([]);
  });

  // Gegenprüfung 04.10.2026: ein angehaltener Fall wird nie automatisch frei.
  it('scharf: Befund vom Vortag hält weiter — auch wenn das Modell heute „Laden" sagt oder die Bildprüfung scheitert', async () => {
    schalter(true);
    mitPreisfoto('halt', 'bildschirm', jpeg(3000, 4000));
    await scharf();
    const tag1 = doc('halt').review.rundeOffen;
    expect(tag1).toMatchObject({ grund: 'preis_bildschirm_unsicher', preisBildschirm: { modus: true, befund: 'halten', seit: tag1.lauf } });

    // Tag 2: Modell liest „Laden" aus einem Kamerafoto — ohne Vorbefund wäre das eine Freigabe.
    mockQuelle.set(preisPfad('halt'), 'laden');
    const b2 = await scharf();
    expect(doc('halt').status).toBe('pending');
    expect(doc('halt').review.rundeOffen).toMatchObject({ grund: 'preis_bildschirm_unsicher', preisBildschirm: { befund: 'halten', seit: tag1.lauf } });
    expect(doc('halt').review.rundeOffen.hinweis).toMatch(/gilt bis zur Entscheidung/);
    expect(b2.preisBildschirm).toMatchObject({ vorbefund: 1, faelle: [{ id: 'halt', vorbefund: tag1.lauf }] });

    // Tag 3: Bildprüfung scheitert — der Befund bleibt für die Konsole stehen.
    mockAudit.set(doc('halt').images.ean, 'AUDIT_FEHLER');
    await scharf();
    expect(doc('halt').status).toBe('pending');
    expect(doc('halt').review.rundeOffen).toMatchObject({ grund: 'bild_audit_gescheitert', preisBildschirm: { modus: true, befund: 'halten', seit: tag1.lauf } });
    const pre = precheckOf(rowOf({ id: 'halt', data: () => doc('halt') }), []);
    expect(pre.hinweise).toContain('preis_bildschirm_unsicher');

    // Schalter zurück auf Beobachtung: der Befund hält nichts mehr.
    mockAudit.delete(doc('halt').images.ean);
    schalter('shadow');
    await scharf();
    expect(doc('halt').status).toBe('approved');
  });

  it('übernommene Befunde lösen die Warnung „hält viele an" nicht jeden Morgen neu aus', async () => {
    schalter(true);
    const gestern = { review: { rundeOffen: { grund: 'preis_bildschirm_unsicher', lauf: 'GESTERN', preisBildschirm: { modus: true, befund: 'halten', seit: 'GESTERN' } } } };
    for (let i = 0; i < 5; i++) mitPreisfoto(`v${i}`, 'laden', jpeg(3000, 4000), { ean: String(4000000000000 + i * 97), ...gestern });
    const b = await scharf();
    expect(b.offenGruende).toEqual({ preis_bildschirm_unsicher: 5 });
    expect(b.preisBildschirm.vorbefund).toBe(5);
    expect(b.warnungen.map((w) => w.code)).not.toContain('preisquelle_haelt_viele');
    // frisch gehaltene dagegen schon
    mockStore.clear(); mockListe.clear(); mockKopf.clear(); mockQuelle.clear(); schalter(true);
    for (let i = 0; i < 5; i++) mitPreisfoto(`f${i}`, 'laden', png(900, 900), { ean: String(4000000000000 + i * 97) });
    expect((await scharf()).warnungen.map((w) => w.code)).toContain('preisquelle_haelt_viele');
  });

  it('Beobachtungs-Befund am offenen Fall hält im scharfen Lauf NICHT (nur scharfe Befunde gelten weiter)', async () => {
    schalter(true);
    mitPreisfoto('alt', 'laden', jpeg(3000, 4000), { review: { rundeOffen: { grund: 'ort_auffaellig', lauf: 'GESTERN', preisBildschirm: { modus: 'shadow', befund: 'ablehnen', seit: 'GESTERN' } } } });
    await scharf();
    expect(doc('alt').status).toBe('approved');
  });

  it('beide Schalter aus (false): keine Zusatzfrage, kein Bildkopf, nichts am Dokument', async () => {
    mockStore.set('cashback_config/v1', { fotoWorker: true, preisBildschirmRegel: false, preisBelegRegel: false });
    mitPreisfoto('schirm', 'bildschirm', png(1080, 2400));
    const b = await scharf();
    expect(mockLage.auditTexte[0]).not.toContain('preisQuelle');
    expect(mockDownloads).toEqual([]);
    expect(doc('schirm').status).toBe('approved');
    expect(doc('schirm').review.preisBildschirm).toBeUndefined();
    expect(doc('schirm').review.bildAudit).not.toHaveProperty('preisQuelle');
    expect(b.preisBildschirm).toMatchObject({ modus: false, befragt: 0, faelle: [], beleg: { modus: false } });
  });
  // Nachprüfung 05.10.2026: der Preisbeleg hat einen eigenen Schalter — die
  // Bildschirm-Regel aus heißt nicht „alles aus".
  it('nur die Bildschirm-Regel aus: kein Bildkopf, kein Bildschirm-Befund — die Preisquelle wird für den Preisbeleg weiter gefragt', async () => {
    schalter(false);
    mitPreisfoto('schirm', 'bildschirm', png(1080, 2400));
    const b = await scharf();
    expect(mockLage.auditTexte[0]).toContain('"preisQuelle":');
    expect(mockLage.auditTexte[0]).toContain('belegMerkmale');
    expect(mockDownloads).toEqual([]);
    expect(doc('schirm').status).toBe('approved');
    expect(b.preisBildschirm).toMatchObject({ modus: false, befragt: 1, befundAblehnen: 0, befundHalten: 0, faelle: [], beleg: { modus: 'shadow' } });
  });

  it('unbekannter Schalterwert („ja") gilt als Beobachtung — nie still scharf', async () => {
    schalter('ja');
    mitPreisfoto('schirm', 'bildschirm', png(1080, 2400));
    const b = await scharf();
    expect(doc('schirm').status).toBe('approved');
    expect(b.preisBildschirm.modus).toBe('shadow');
    expect(b.preisBildschirm.schalterUnbekannt).toBe('"ja" (Text)');
  });

  // Prüfrunde 2 (04.10.2026): die Firebase-Konsole legt ein neues Feld als
  // Text an — "true" sieht aus wie scharf und ist es nicht.
  it('"true" als Text → Beobachtung, aber gelbe Warnung mit dem Wert (nicht still)', async () => {
    schalter('true');
    mitPreisfoto('schirm', 'bildschirm', png(1080, 2400));
    const b = await scharf();
    expect(doc('schirm').status).toBe('approved');
    expect(b.preisBildschirm).toMatchObject({ modus: 'shadow', schalterUnbekannt: '"true" (Text)' });
    expect(b.warnungen.find((w) => w.code === 'preisbildschirm_schalter_unbekannt')).toMatchObject({ stufe: 'gelb' });
    // gültige Werte und ein fehlender Schalter warnen nicht
    for (const v of [undefined, 'shadow', true, false]) {
      mockStore.clear(); mockListe.clear(); mockKopf.clear(); mockQuelle.clear(); schalter(v);
      einreichung('a');
      const w = await scharf();
      expect(w.preisBildschirm).not.toHaveProperty('schalterUnbekannt');
      expect(w.warnungen.map((x) => x.code)).not.toContain('preisbildschirm_schalter_unbekannt');
    }
  });

  // Prüfrunde 2 (04.10.2026): ein nicht lesbarer Schalter ist KEIN Wert — als
  // 'shadow' gälte kein scharfer Befund mehr, angehaltene Fälle würden frei.
  it('Schalter nicht lesbar (Runde liest selbst) → Lauf bricht ab: kein angehaltener Fall frei, kein neues Bildschirmfoto bezahlt', async () => {
    schalter(true);
    mitPreisfoto('halt', 'bildschirm', jpeg(3000, 4000));
    await scharf();
    expect(doc('halt').review.rundeOffen).toMatchObject({ preisBildschirm: { modus: true, befund: 'halten' } });
    mitPreisfoto('neu', 'bildschirm', png(1080, 2400), { ean: '4000000000017' });
    mockQuelle.set(preisPfad('halt'), 'laden');
    mockWrites.length = 0;
    mockLage.configFehler = 1;
    await expect(scharf()).rejects.toThrow(/Schalter preisBildschirmRegel\/preisBelegRegel nicht lesbar/);
    expect(doc('halt').status).toBe('pending');
    expect(doc('neu').status).toBe('pending');
    expect(mockWrites.filter((w) => w.path.startsWith('crowd_uploads/'))).toEqual([]);
  });
  it('index.js-Weg: die Schalter kommen als Werte mit → die Runde liest sie nicht ein zweites Mal', async () => {
    schalter('shadow'); // stünde im Dokument — gilt nicht, der übergebene Wert gilt
    mitPreisfoto('schirm', 'bildschirm', png(1080, 2400));
    const b = await scharf({ preisBildschirmRegel: true, preisBelegRegel: false, barcodeKorrektur: null, haushaltRegel: null });
    // nur das Lesen der Bon-Lage (bonWorker) — kein eigenes für die Schalter
    // (index.js reicht auch barcodeKorrektur und haushaltRegel aus demselben Lesen durch)
    expect(mockLage.configLesungen).toBe(1);
    expect(b.preisBildschirm.modus).toBe(true);
    expect(b.preisBildschirm.beleg.modus).toBe(false);
    expect(mockLage.auditTexte[0]).not.toContain('belegMerkmale');
    expect(doc('schirm')).toMatchObject({ status: 'rejected', review: { reason: 'preis_bildschirm' } });
    // null (Feld fehlt im Dokument) = Beobachtung
    mockStore.clear(); mockListe.clear(); mockKopf.clear(); mockQuelle.clear(); schalter(true);
    mitPreisfoto('s2', 'bildschirm', png(1080, 2400));
    const b2 = await scharf({ preisBildschirmRegel: null, preisBelegRegel: null, barcodeKorrektur: null });
    expect(b2.preisBildschirm.modus).toBe('shadow');
    expect(b2.preisBildschirm.beleg.modus).toBe('shadow');
    expect(doc('s2').status).toBe('approved');
    // fehlt einer der beiden Werte, liest die Runde den Schalter selbst — einmal
    mockStore.clear(); mockListe.clear(); mockKopf.clear(); mockQuelle.clear();
    mockStore.set('cashback_config/v1', { fotoWorker: true, preisBelegRegel: true });
    mockLage.configLesungen = 0;
    einreichung('s3');
    const b3 = await scharf({ preisBildschirmRegel: true });
    expect(mockLage.configLesungen).toBe(2); // Bon-Lage + Schalter
    expect(b3.preisBildschirm).toMatchObject({ modus: true, beleg: { modus: true } });
  });

  it('Schalter-Wechsel ändert die Regelversion (der Bericht meldet ihn wie eine Regeländerung) — auch beim Preisbeleg', async () => {
    einreichung('a');
    const v1 = (await scharf()).regelVersion;
    mockStore.clear(); mockListe.clear(); schalter(true); einreichung('b');
    const v2 = (await scharf()).regelVersion;
    expect(v1).not.toBe(v2);
    mockStore.clear(); mockListe.clear(); mockStore.set('cashback_config/v1', { fotoWorker: true, preisBildschirmRegel: true, preisBelegRegel: true }); einreichung('c');
    const v3 = (await scharf()).regelVersion;
    expect(v3).not.toBe(v2);
  });

  it('hängender Abruf des Bildkopfs → nach der Zeitgrenze „Merkmale unbekannt", kein Urteil', async () => {
    const { preisFotoKopf } = require('../src/taeglicheRunde');
    const haengt = { file: () => ({ download: () => new Promise(() => {}) }) };
    await expect(preisFotoKopf(haengt, { images: { preis: 'p' } }, 10)).resolves.toEqual({ kopf: null, merkmal: null, fehler: 'zeit_abgelaufen' });
    await expect(preisFotoKopf(haengt, { images: {} }, 10)).resolves.toMatchObject({ merkmal: null, fehler: 'kein_preisfoto' });
    const gut = { file: () => ({ download: async () => [png(1080, 2400)] }) };
    await expect(preisFotoKopf(gut, { images: { preis: 'p' } }, 10)).resolves.toMatchObject({ merkmal: true, fehler: null });
  });

  // Prüfrunde 2 (04.10.2026): ohne den Eintrag kennt der nächste Lauf den
  // scharfen Halt nicht und gäbe den Fall bei einer anderen Lesung frei.
  it('scharfer Halt nicht speicherbar → rote Warnung (wie ein sperrender Befund)', async () => {
    schalter(true);
    mitPreisfoto('kamera', 'bildschirm', jpeg(3000, 4000));
    mockLage.txUpdateFehler = (pfad, daten) => Object.keys(daten).includes('review.rundeOffen');
    const b = await scharf();
    expect(doc('kamera').status).toBe('pending');
    expect(b.rundeOffen).toMatchObject({ fehler: 1, fehlerSperrend: 1 });
    expect(b.warnungen.find((w) => w.code === 'befund_nicht_gespeichert')).toMatchObject({ stufe: 'rot' });
  });
  it('… ein Halt nur wegen des nicht abrufbaren Kopfs ist kein Befund → kein Eintrag, keine rote Warnung', async () => {
    schalter(true);
    mitPreisfoto('weg', 'laden', 'FEHLER');
    mockLage.txUpdateFehler = (pfad, daten) => Object.keys(daten).includes('review.rundeOffen');
    const b = await scharf();
    expect(b.rundeOffen.fehlerSperrend).toBe(0);
    expect(b.warnungen.map((w) => w.code)).not.toContain('befund_nicht_gespeichert');
  });

  // Prüfrunde 2 (04.10.2026): Bildschirmfotos außerhalb der gemessenen
  // Merkmal-Klasse (Billa-Online-Shop 1200×2152, zugeschnittener App-Ausschnitt).
  it('scharf: Bildschirmfoto im 16:9-Format mit EXIF-Datum ohne Hersteller → abgelehnt; zugeschnitten mit „Laden" → liegt', async () => {
    schalter(true);
    mitPreisfoto('billa', 'bildschirm', jpeg(1200, 2152, { exif: EXIF.androidBildschirm }));
    mitPreisfoto('ausschnitt', 'laden', jpeg(446, 248, { exif: EXIF.zugeschnitten }), { ean: '4000000000017' });
    mitPreisfoto('ios', 'laden', jpeg(3024, 4032, { exif: EXIF.iosAppKamera }), { ean: '4000000000024' });
    await scharf();
    expect(doc('billa')).toMatchObject({ status: 'rejected', rejectReason: 'fotos_unpassend' });
    expect(doc('ausschnitt')).toMatchObject({ status: 'pending', review: { rundeOffen: { grund: 'preis_bildschirm_unsicher' } } });
    expect(doc('ios').status).toBe('approved'); // App-Kamera mit EXIF-Rest bleibt ein Kamerafoto
  });

  // Prüfrunde 2 (04.10.2026): Gegenzeichen auch in der Richtung, in der bezahlt wird.
  it('scharf: „Kassenbon" + Merkmale, der Lesedienst las ein Preisschild bzw. „sonstiges" → liegt; Warnung ab 2; mit Lesedienst-Bon frei', async () => {
    schalter(true);
    mitPreisfoto('kb1', 'kassenbon', png(1080, 2400), { priceImageKind: 'preisschild' });
    mitPreisfoto('kb2', 'kassenbon', jpeg(1080, 2400), { ean: '4000000000017', priceImageKind: 'sonstiges' });
    mitPreisfoto('ebon', 'kassenbon', png(1080, 2400), { ean: '4000000000024', priceImageKind: 'kassenbon' });
    mitPreisfoto('papier', 'kassenbon', jpeg(3000, 4000), { ean: '4000000000031', priceImageKind: 'preisschild' });
    const b = await scharf();
    for (const id of ['kb1', 'kb2']) {
      expect(doc(id).status).toBe('pending');
      expect(doc(id).review.rundeOffen).toMatchObject({ grund: 'preis_bildschirm_unsicher', preisBildschirm: { modus: true, befund: 'halten' } });
    }
    expect(doc('ebon').status).toBe('approved');
    expect(doc('papier').status).toBe('approved'); // Kamerafoto eines Papierbons
    expect(b.preisBildschirm).toMatchObject({ kassenbonOhneLesedienstBon: 2, kassenbonOhneLesedienstBonLiegt: 2, kassenbonMitMerkmal: 3 });
    expect(b.warnungen.find((w) => w.code === 'preisquelle_bon_widerspruch').text).toMatch(/die Fälle bleiben liegen/);
    // Nachprüfung 06.10.2026: Tag 2 ohne Entscheidung — keine Wiederholung der Warnung
    const b2 = await scharf();
    for (const id of ['kb1', 'kb2']) expect(doc(id).status).toBe('pending');
    expect(b2.preisBildschirm).toMatchObject({ kassenbonOhneLesedienstBon: 0, kassenbonOhneLesedienstBonAusVortagen: 2 });
    expect(b2.warnungen.map((w) => w.code)).not.toContain('preisquelle_bon_widerspruch');
  });

  // Nachprüfung 06.10.2026: in der Beobachtung (Standard nach dem Deploy)
  // werden diese Fälle bezahlt — die Warnung darf nicht „bleiben liegen" sagen.
  it('Beobachtung: „Kassenbon" + Merkmale, Lesedienst sah keinen → freigegeben; Warnung sagt das', async () => {
    schalter(undefined);
    mitPreisfoto('kb1', 'kassenbon', png(1080, 2400), { priceImageKind: 'preisschild' });
    mitPreisfoto('kb2', 'kassenbon', png(1080, 2400), { ean: '4000000000017', priceImageKind: 'preisschild' });
    const b = await scharf();
    for (const id of ['kb1', 'kb2']) expect(doc(id).status).toBe('approved');
    expect(b.preisBildschirm).toMatchObject({ kassenbonOhneLesedienstBon: 2, kassenbonOhneLesedienstBonLiegt: 0 });
    const w = b.warnungen.find((x) => x.code === 'preisquelle_bon_widerspruch');
    expect(w.text).toMatch(/in der Beobachtung hält die Runde sie nicht an/);
    expect(w.text).not.toMatch(/die Fälle bleiben liegen/);
  });

  // Prüfrunde 2 (04.10.2026): Zeitgrenze des ganzen Kopf-Schritts (3 min).
  it('Kopf-Schritt läuft über seine Zeitgrenze → die übrigen „Laden"-Fälle bleiben liegen (preis_kopf_nicht_lesbar), nie frei', async () => {
    schalter(true);
    // Das erste Preisfoto braucht 4 Minuten — danach beginnt der Schritt nichts Neues.
    mitPreisfoto('k0', 'laden', () => { dateSpy.mockImplementation(() => T0 + 4 * 60 * 1000); return jpeg(3000, 4000); });
    mitPreisfoto('k1', 'laden', null, { ean: '4000000000017' });
    mitPreisfoto('k2', 'laden', null, { ean: '4000000000024' });
    const b = await scharf();
    expect(doc('k0').status).toBe('approved');
    for (const id of ['k1', 'k2']) {
      expect(doc(id).status).toBe('pending');
      expect(doc(id).review.rundeOffen).toMatchObject({ grund: 'preis_kopf_nicht_lesbar' });
    }
    expect(mockDownloads.map((d) => d.p)).toEqual([preisPfad('k0')]);
    expect(b.preisBildschirm).toMatchObject({ kopfNichtAbrufbar: 2, merkmal: { nein: 1, unbekannt: 2 } });
    expect(b.preisBildschirm.faelle.map((f) => f.datei)).toEqual(['zeit_abgelaufen', 'zeit_abgelaufen']);
  });

  // Prüfrunde 3 (04.10.2026): Erstlesung ohne Bildart, Nachlesung gescheitert —
  // ein Werkzeugfehler wird nicht zur Ablehnung an EINER Modellantwort.
  it('scharf: Lesedienst hat das Preisfoto nie gelesen, Nachlesung gescheitert → nicht abgelehnt, liegt', async () => {
    schalter(true);
    mitPreisfoto('ungelesen', 'bildschirm', png(1080, 2400), { priceImageKind: undefined, preis: null });
    mockNachlese.set(preisPfad('ungelesen'), ['FEHLER']);
    const b = await scharf();
    expect(doc('ungelesen').status).toBe('pending');
    expect(doc('ungelesen').review.rundeOffen).toMatchObject({ grund: 'preis_bildschirm_unsicher', preisBildschirm: { modus: true, befund: 'halten' } });
    expect(b).toMatchObject({ abgelehnt: 0 });
  });

  // Prüfrunde 3 (04.10.2026): zwei Nachlesungen sahen einen Kassenbon, lasen aber
  // verschiedene Beträge — am Dokument steht dann nichts, das Zeichen zählt trotzdem.
  it('scharf: ungeeinte Nachlesung sah einen Kassenbon → nicht abgelehnt, liegt', async () => {
    schalter(true);
    mitPreisfoto('uneinig', 'bildschirm', png(1080, 2400), { preis: null });
    mockNachlese.set(preisPfad('uneinig'), [{ priceCents: 129, priceImageKind: 'kassenbon' }, { priceCents: 179, priceImageKind: 'kassenbon' }]);
    const b = await scharf();
    expect(doc('uneinig').status).toBe('pending');
    expect(doc('uneinig').priceRescueOcr).toBeUndefined();
    expect(doc('uneinig').review.rundeOffen).toMatchObject({ grund: 'preis_bildschirm_unsicher', preisBildschirm: { befund: 'halten' } });
    expect(b.preisBildschirm.faelle[0]).toMatchObject({ id: 'uneinig', befund: 'halten', lesedienstBon: true });
    // Gegenprobe: sahen beide Lesungen ein Preisschild, gilt die Regel wie sonst
    mockStore.clear(); mockListe.clear(); mockKopf.clear(); mockQuelle.clear(); mockNachlese.clear(); schalter(true);
    mitPreisfoto('uneinig2', 'bildschirm', png(1080, 2400), { preis: null });
    mockNachlese.set(preisPfad('uneinig2'), [{ priceCents: 129, priceImageKind: 'preisschild' }, { priceCents: 179, priceImageKind: 'preisschild' }]);
    await scharf();
    expect(doc('uneinig2')).toMatchObject({ status: 'rejected', review: { reason: 'preis_bildschirm' } });
  });

  // Prüfrunde 3 (04.10.2026): ein liegender Fall wird nicht jeden Morgen neu ausgewürfelt.
  it('scharf: Tag 1 „Laden" + Merkmale (liegt), Tag 2 „Bildschirm" → bleibt liegen, nie automatisch abgelehnt', async () => {
    schalter(true);
    mitPreisfoto('regal', 'laden', png(1200, 900));
    await scharf();
    const tag1 = doc('regal').review.rundeOffen;
    expect(tag1).toMatchObject({ grund: 'preis_bildschirm_unsicher', preisBildschirm: { modus: true, befund: 'halten' } });
    mockQuelle.set(preisPfad('regal'), 'bildschirm');
    const b2 = await scharf();
    expect(doc('regal').status).toBe('pending');
    expect(doc('regal').review.rundeOffen).toMatchObject({ grund: 'preis_bildschirm_unsicher', preisBildschirm: { befund: 'halten', seit: tag1.lauf } });
    expect(b2).toMatchObject({ abgelehnt: 0 });
  });

  // Prüfrunde 3 (04.10.2026): „Kassenbon", den der Lesedienst nicht als Bon las,
  // OHNE Bildschirm-Merkmale (etwa ein zugeschnittener Warenkorb als 4:3 ohne
  // EXIF) — wird bezahlt, steht aber einzeln im Bericht.
  it('„Kassenbon" ohne Merkmale, Lesedienst sah keinen Bon → bezahlt, aber im Bericht gezählt und gelistet', async () => {
    schalter(true);
    mitPreisfoto('warenkorb', 'kassenbon', jpeg(1200, 900), { priceImageKind: 'sonstiges' });
    mitPreisfoto('ebon', 'kassenbon', png(1080, 2400), { ean: '4000000000017', priceImageKind: 'kassenbon' });
    const b = await scharf();
    expect(doc('warenkorb').status).toBe('approved');
    expect(b.preisBildschirm).toMatchObject({
      kassenbonOhneLesedienstBon: 0, kassenbonLesedienstOhneBon: 1,
      kassenbonLesedienstOhneBonFaelle: [{ id: 'warenkorb', entscheidung: 'freigeben', merkmal: false, lesedienst: 'sonstiges', datei: 'jpg 1200×900' }],
    });
  });

  // Prüfrunde 3 (04.10.2026): ohne abrufbaren Kopf gibt die Regel auch einen
  // „Kassenbon" nicht frei, dem der Lesedienst widerspricht.
  it('scharf: „Kassenbon", Kopf nicht abrufbar, Lesedienst sah keinen Bon → liegt (Technik); mit Lesedienst-Bon frei', async () => {
    schalter(true);
    mitPreisfoto('kbweg', 'kassenbon', 'FEHLER');
    mitPreisfoto('ebonweg', 'kassenbon', 'FEHLER', { ean: '4000000000017', priceImageKind: 'kassenbon' });
    await scharf();
    expect(doc('kbweg').status).toBe('pending');
    expect(doc('kbweg').review.rundeOffen).toMatchObject({ grund: 'preis_kopf_nicht_lesbar' });
    expect(doc('kbweg').review.rundeOffen).not.toHaveProperty('preisBildschirm');
    expect(doc('ebonweg').status).toBe('approved');
  });

  // Prüfrunde 3 (04.10.2026): Storage-Störung im scharfen Modus = ein Tag ohne Freigaben → rot.
  it('scharf: Kopf bei mehr als einem Viertel nicht abrufbar → rote Warnung; Beobachtung → gelb', async () => {
    schalter(true);
    for (let i = 0; i < 8; i++) mitPreisfoto(`s${i}`, 'laden', 'FEHLER', { ean: String(4000000000000 + i * 97) });
    const b = await scharf();
    expect(b.warnungen.find((w) => w.code === 'preisfoto_kopf_nicht_abrufbar')).toMatchObject({ stufe: 'rot' });
    mockStore.clear(); mockListe.clear(); mockKopf.clear(); mockQuelle.clear(); schalter('shadow');
    for (let i = 0; i < 8; i++) mitPreisfoto(`s${i}`, 'laden', 'FEHLER', { ean: String(4000000000000 + i * 97) });
    const b2 = await scharf();
    expect(b2.warnungen.find((w) => w.code === 'preisfoto_kopf_nicht_abrufbar')).toMatchObject({ stufe: 'gelb' });
    for (let i = 0; i < 8; i++) expect(doc(`s${i}`).status).toBe('approved');
  });

  it('Bildprüfung beantwortet die Frage nicht (Modelländerung) → gelbe Warnung', async () => {
    for (let i = 0; i < 8; i++) einreichung(`x${i}`, { ean: String(4000000000000 + i * 97) });
    const b = await scharf();
    expect(b.preisBildschirm.quellen).toEqual({ ohne_antwort: 8 });
    expect(b.warnungen.map((w) => w.code)).toContain('preisquelle_ohne_antwort');
  });
});

// ───────── Preisbeleg „Kassenbon" (Entscheidung Claude im Auftrag Patricks, 04.10.2026) ─────────
describe('Preisbeleg „Kassenbon": ohne Kassenbon-Merkmale oder fremder Händler → nur liegen lassen', () => {
  const { jpeg, png } = require('./helpers/bildKopfDaten');
  const { rowOf, precheckOf } = require('../src/einreichung');
  const preisPfad = (id, uid = 'u1') => `crowduploads/${uid}/${id}/preis.jpg`;
  /** „Kassenbon" laut Bildprüfung, Kamerafoto 4:3 (kein Bildschirm-Merkmal), Lesedienst: Kassenbon ohne Kopf. */
  function bon(id, beleg, extra = {}) {
    einreichung(id, { priceImageKind: 'kassenbon', ...extra });
    mockQuelle.set(preisPfad(id, extra.uid), 'kassenbon');
    if (beleg) mockBeleg.set(preisPfad(id, extra.uid), beleg);
    mockKopf.set(preisPfad(id, extra.uid), jpeg(3000, 4000));
  }
  // Beide Regeln mit demselben Wert — wie sie getrennt wirken, prüft der Block
  // „Zwei Schalter" unten (Nachprüfung 05.10.2026).
  const schalter = (v) => mockStore.set('cashback_config/v1', { fotoWorker: true, ...(v === undefined ? {} : { preisBildschirmRegel: v, preisBelegRegel: v }) });
  const VOLL = ['haendler', 'datum', 'summe', 'nummer', 'zahlung', 'steuer'];
  const VERRAET = /warenkorb|händler|haendler|amazon|merkmal|summe|logo/i;

  it('die Unterfragen stehen wortgleich in der Anweisung — nur mit eingeschaltetem Preisbeleg', async () => {
    const { AUDIT_ANWEISUNG_PREISQUELLE, AUDIT_ANWEISUNG_PREISBELEG } = require('../src/taeglicheRunde');
    einreichung('a');
    await scharf();
    expect(mockLage.auditTexte[0]).toContain('"belegHaendler":"…","belegMerkmale":["haendler|datum|summe|nummer|zahlung|steuer"]');
    expect(mockLage.auditTexte[0]).toContain('belegMerkmale: welche dieser Merkmale eines abgeschlossenen Einkaufs');
    expect(mockLage.auditTexte[0]).toContain(AUDIT_ANWEISUNG_PREISBELEG);
    // Preisbeleg aus, Bildschirm-Regel an: die Fassung vom 04.10. (nur Preisquelle), wortgleich
    mockLage.auditTexte = [];
    mockStore.set('cashback_config/v1', { fotoWorker: true, preisBelegRegel: false });
    mockBeleg.set(preisPfad('c'), { belegHaendler: 'Amazon', belegMerkmale: [] });
    einreichung('c', { ean: '4000417025005', priceImageKind: 'kassenbon' });
    mockQuelle.set(preisPfad('c'), 'kassenbon');
    const bOhne = await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(mockLage.auditTexte[0]).toContain(AUDIT_ANWEISUNG_PREISQUELLE);
    expect(mockLage.auditTexte[0]).not.toContain('belegMerkmale');
    expect(bOhne.preisBildschirm.beleg).toMatchObject({ modus: false, kassenbon: 0, ohneMerkmale: 0, fremderHaendler: 0, merkmaleOhneAntwort: 0, faelle: [] });
    expect(bOhne.warnungen.map((w) => w.code)).not.toContain('preisbeleg_ohne_antwort');
    // beide aus: gar keine Zusatzfrage
    mockLage.auditTexte = [];
    schalter(false);
    einreichung('b', { ean: '4000000000017' });
    const b = await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(mockLage.auditTexte).toHaveLength(2); // b und das im Trockenlauf offene c
    for (const t of mockLage.auditTexte) {
      expect(t).not.toContain('belegMerkmale');
      expect(t).not.toContain('preisQuelle');
    }
    expect(b.preisBildschirm.beleg).toMatchObject({ kassenbon: 0, maerkteUnlesbar: false });
  });

  it('Beobachtung (Schalter fehlt): Warenkorb und Amazon werden freigegeben, gezählt und gelistet — nichts am Dokument', async () => {
    bon('korb', { belegHaendler: '', belegMerkmale: [] });
    bon('amazon', { belegHaendler: 'Amazon', belegMerkmale: VOLL }, { ean: '4000000000017', priceReceipt: { merchant: 'Amazon EU S.à r.l.' } });
    bon('rewe', { belegHaendler: 'REWE', belegMerkmale: ['steuer'] }, { ean: '4000417025005' });
    const b = await scharf();
    for (const id of ['korb', 'amazon', 'rewe']) expect(doc(id).status).toBe('approved');
    expect(JSON.stringify(doc('korb'))).not.toMatch(VERRAET);
    expect(b.preisBildschirm.beleg).toMatchObject({
      kassenbon: 3, ohneMerkmale: 1, fremderHaendler: 1, stattFreigabe: 2, merkmaleOhneAntwort: 0, maerkteUnlesbar: false,
    });
    expect(b.preisBildschirm.beleg.faelle).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'korb', befund: 'ohne_merkmale', entscheidung: 'freigeben', ohneRegel: 'freigeben', merkmale: [] }),
      expect.objectContaining({ id: 'amazon', befund: 'fremder_haendler', haendler: 'Amazon', lesedienstHaendler: 'Amazon EU S.à r.l.' }),
    ]));
    // Nachprüfung 05.10.2026: ein reiner Preisbeleg-Fall zählt NICHT in den
    // Zeilen der Bildschirm-Regel — nach deren Zahlen (~1 Fall pro Woche
    // erwartet) wird sie scharf geschaltet — und steht nur in der Liste „Preisbeleg".
    expect(b.preisBildschirm).toMatchObject({ befundAblehnen: 0, befundHalten: 0, stattFreigabe: 0, ausVortagen: 0, vorbefund: 0, faelle: [] });
    // Nachprüfung 05.10.2026: ein Beleg-Befund ist KEIN Widerspruch zum
    // Lesedienst — der sah hier jeweils einen Kassenbon. Die Zahl „Kassenbon,
    // aber Lesedienst sah keinen" und ihre Warnung bleiben stumm.
    expect(b.preisBildschirm.kassenbonOhneLesedienstBon).toBe(0);
    expect(b.warnungen.map((w) => w.code)).not.toContain('preisquelle_bon_widerspruch');
  });

  // Nachprüfung 05.10.2026: der Zähler `kassenbonOhneLesedienstBon` (Warnung
  // preisquelle_bon_widerspruch) zählt nur, was der Lesedienst las und NICHT
  // als Bon sah — auch wenn der Fall über den Preisbeleg liegt, aber nie bloß,
  // weil er über den Preisbeleg liegt.
  it('Zähler „Kassenbon, Lesedienst sah keinen": Beleg-Befund nur mit Lesedienst-Widerspruch; Warnung erst ab 2 echten', async () => {
    schalter(true);
    // Warenkorb: Lesedienst las ein Preisschild → echter Widerspruch, liegt über den Beleg
    bon('korb', { belegHaendler: '', belegMerkmale: [] }, { priceImageKind: 'preisschild' });
    // Amazon und Inhaber-Markt ohne Logo: Lesedienst sah den Bon (Kopf gelesen)
    bon('amazon', { belegHaendler: 'Amazon', belegMerkmale: VOLL }, { ean: '4000000000017', priceReceipt: { merchant: 'Amazon EU S.à r.l.' } });
    bon('krummenerl', { belegHaendler: 'Krummenerl', belegMerkmale: VOLL }, { ean: '4000417025005', priceReceipt: { merchant: 'Krummenerl EH OHG' } });
    const b = await scharf();
    for (const id of ['korb', 'amazon', 'krummenerl']) expect([id, doc(id).status]).toEqual([id, 'pending']);
    expect(b.preisBildschirm).toMatchObject({ kassenbonOhneLesedienstBon: 1, kassenbonLesedienstOhneBon: 1 });
    expect(b.preisBildschirm.beleg).toMatchObject({ ohneMerkmale: 1, fremderHaendler: 2 });
    expect(b.warnungen.map((w) => w.code)).not.toContain('preisquelle_bon_widerspruch');
  });

  it('scharf: beide bleiben liegen (preis_beleg_unsicher, art beleg, neutraler Hinweis); Konsole zeigt den Hinweis; nie abgelehnt', async () => {
    schalter(true);
    bon('korb', { belegHaendler: '', belegMerkmale: [] });
    bon('amazon', { belegHaendler: 'Amazon', belegMerkmale: VOLL }, { ean: '4000000000017', priceReceipt: { merchant: 'Amazon EU S.à r.l.' } });
    const b = await scharf();
    for (const id of ['korb', 'amazon']) {
      const d = doc(id);
      expect(d.status).toBe('pending');
      expect(d.review.rundeOffen).toMatchObject({ grund: 'preis_beleg_unsicher', sperrend: [], preisBildschirm: { modus: true, befund: 'halten', art: 'beleg' } });
      expect(d.review.rundeOffen.hinweis).toMatch(/^Preisbeleg unsicher/);
      expect(JSON.stringify(d.review)).not.toMatch(VERRAET);
      expect(d.holdReasons).toBeUndefined();
      expect(precheckOf(rowOf({ id, data: () => d }), [])).toMatchObject({ verdict: 'ok', hinweise: ['preis_beleg_unsicher'] });
    }
    expect(b).toMatchObject({ abgelehnt: 0, freigegeben: 0, offenGruende: { preis_beleg_unsicher: 2 } });
  });

  it('scharf: echte Bons zählen — Händlerkopf des Lesedienstes, Steuer-Kennzeichen, unsere Märkte online, Inhaber-Name mit Kette', async () => {
    schalter(true);
    // Bildprüfung sah kein Merkmal, der Lesedienst aber den Bon-Kopf
    bon('kopf', { belegHaendler: '', belegMerkmale: [] }, { priceReceipt: { merchant: 'Kaufland', zip: '44534', city: 'Lünen' } });
    // eng zugeschnittener Bon mit Steuer-Kennzeichen
    bon('zeilen', { belegHaendler: '', belegMerkmale: ['steuer'] }, { ean: '4000000000017' });
    bon('dm', { belegHaendler: 'dm', belegMerkmale: ['haendler', 'summe', 'nummer'] }, { ean: '4000417025005', priceReceipt: { merchant: 'dm-drogerie markt GmbH + Co. KG' } });
    bon('inhaber', { belegHaendler: 'REWE', belegMerkmale: VOLL }, { ean: '4061464833838', priceReceipt: { merchant: 'Krummenerl EH OHG' } });
    const b = await scharf();
    for (const id of ['kopf', 'zeilen', 'dm', 'inhaber']) expect([id, doc(id).status]).toEqual([id, 'approved']);
    expect(b.preisBildschirm.beleg).toMatchObject({ ohneMerkmale: 0, fremderHaendler: 0, faelle: [] });
  });

  it('scharf: keine verwertbare Antwort auf die Merkmal-Frage ist kein Freispruch (ohne Bon-Kopf liegt der Fall); Warnung bei vielen', async () => {
    schalter(true);
    for (let i = 0; i < 8; i++) bon(`k${i}`, { belegHaendler: 'REWE' }, { ean: String(4000000000000 + i * 97) });
    const b = await scharf();
    for (let i = 0; i < 8; i++) expect(doc(`k${i}`).status).toBe('pending');
    expect(b.preisBildschirm.beleg).toMatchObject({ kassenbon: 8, merkmaleOhneAntwort: 8, ohneMerkmale: 8 });
    expect(b.warnungen.map((w) => w.code)).toEqual(expect.arrayContaining(['preisbeleg_ohne_antwort', 'preisbeleg_haelt_viele']));
  });

  it('scharf: ein liegender Preisbeleg wird am nächsten Morgen nicht automatisch frei, auch wenn das Modell dann „REWE, alle Merkmale" sagt', async () => {
    schalter(true);
    bon('amazon', { belegHaendler: 'Amazon', belegMerkmale: VOLL });
    await scharf();
    const tag1 = doc('amazon').review.rundeOffen;
    expect(tag1.preisBildschirm).toMatchObject({ befund: 'halten', art: 'beleg' });
    mockBeleg.set(preisPfad('amazon'), { belegHaendler: 'REWE', belegMerkmale: VOLL });
    await scharf();
    expect(doc('amazon').status).toBe('pending');
    expect(doc('amazon').review.rundeOffen).toMatchObject({ grund: 'preis_beleg_unsicher', preisBildschirm: { befund: 'halten', art: 'beleg', seit: tag1.lauf } });
    expect(doc('amazon').review.rundeOffen.hinweis).toMatch(/^Preisbeleg unsicher — Befund vom/);
  });

  it('Märkte aus `discounter`: ein neu aufgenommener Markt gilt sofort; nicht lesbar → feste Ketten + gelbe Warnung', async () => {
    schalter(true);
    mockStore.set('discounter/picnic', { name: 'Picnic' });
    bon('picnic', { belegHaendler: 'Picnic', belegMerkmale: VOLL });
    await scharf();
    expect(doc('picnic').status).toBe('approved');
    mockStore.clear(); mockListe.clear(); mockQuelle.clear(); mockBeleg.clear(); mockKopf.clear(); schalter(true);
    mockLage.discounterFehler = true;
    bon('picnic2', { belegHaendler: 'Picnic', belegMerkmale: VOLL });
    bon('rewe2', { belegHaendler: 'REWE', belegMerkmale: VOLL }, { ean: '4000000000017' });
    const b = await scharf();
    expect(doc('picnic2').status).toBe('pending');
    expect(doc('rewe2').status).toBe('approved');
    expect(b.preisBildschirm.beleg.maerkteUnlesbar).toBe(true);
    expect(b.warnungen.find((w) => w.code === 'preisbeleg_maerkte_unlesbar')).toMatchObject({ stufe: 'gelb' });
  });

  it('Antwort der Bildprüfung in einer Liste verpackt (gemessen 1 von 272) → wird ausgewertet, kein Bildprüfungs-Fehler', async () => {
    schalter(true);
    mockLage.antwortInListe = true;
    bon('liste', { belegHaendler: 'Lidl', belegMerkmale: VOLL });
    const b = await scharf();
    expect(doc('liste').status).toBe('approved');
    expect(b.bildpruefung).toMatchObject({ gescheitert: 0 });
  });

  it('Bildschirm-Regel bleibt unberührt: „bildschirm" + Merkmale → abgelehnt; die Beleg-Fragen gelten nur für „kassenbon"', async () => {
    schalter(true);
    einreichung('schirm', { priceImageKind: 'preisschild' });
    mockQuelle.set(preisPfad('schirm'), 'bildschirm');
    mockKopf.set(preisPfad('schirm'), png(1080, 2400));
    mockBeleg.set(preisPfad('schirm'), { belegHaendler: 'Amazon', belegMerkmale: [] });
    const b = await scharf();
    expect(doc('schirm')).toMatchObject({ status: 'rejected', rejectReason: 'fotos_unpassend' });
    expect(b.preisBildschirm.beleg).toMatchObject({ kassenbon: 0, ohneMerkmale: 0, fremderHaendler: 0 });
  });
});

// ───────── Zwei Schalter (Nachprüfung 05.10.2026) ─────────
// Hingen Bildschirm-Regel und Preisbeleg an EINEM Schalter, gab das
// Zurücknehmen des Preisbelegs (zu viele Bons inhabergeführter Märkte?) am
// nächsten Morgen auch jedes angehaltene Bildschirmfoto frei — ohne Menschen.
describe('Zwei Schalter: preisBildschirmRegel und preisBelegRegel wirken und enden getrennt', () => {
  const { jpeg, png } = require('./helpers/bildKopfDaten');
  const preisPfad = (id, uid = 'u1') => `crowduploads/${uid}/${id}/preis.jpg`;
  const VOLL = ['haendler', 'datum', 'summe', 'nummer', 'zahlung', 'steuer'];
  const schalter = (bildschirm, beleg) => mockStore.set('cashback_config/v1', {
    fotoWorker: true, ...(bildschirm === undefined ? {} : { preisBildschirmRegel: bildschirm }), ...(beleg === undefined ? {} : { preisBelegRegel: beleg }),
  });
  /** Abfotografierter Bildschirm (Kamerafoto 4:3, „bildschirm") → Bildschirm-Halt. */
  function kamera(id, ean) {
    einreichung(id, { ean, priceImageKind: 'preisschild' });
    mockQuelle.set(preisPfad(id), 'bildschirm');
    mockKopf.set(preisPfad(id), jpeg(3000, 4000));
  }
  /** Warenkorb als „Kassenbon" ohne jedes Merkmal → Preisbeleg-Halt. */
  function korb(id, ean) {
    einreichung(id, { ean, priceImageKind: 'kassenbon' });
    mockQuelle.set(preisPfad(id), 'kassenbon');
    mockBeleg.set(preisPfad(id), { belegHaendler: '', belegMerkmale: [] });
    mockKopf.set(preisPfad(id), jpeg(3000, 4000));
  }
  /** Am nächsten Morgen liest das Modell beide unauffällig. */
  function unauffaellig() {
    mockQuelle.set(preisPfad('kamera'), 'laden');
    mockQuelle.set(preisPfad('korb'), 'kassenbon');
    mockBeleg.set(preisPfad('korb'), { belegHaendler: 'REWE', belegMerkmale: VOLL });
  }
  async function tag1() {
    schalter(true, true);
    kamera('kamera', '4000417025005');
    korb('korb', '4000000000017');
    await scharf();
    expect(doc('kamera').review.rundeOffen).toMatchObject({ grund: 'preis_bildschirm_unsicher', preisBildschirm: { modus: true, befund: 'halten', regeln: ['bildschirm'] } });
    expect(doc('korb').review.rundeOffen).toMatchObject({ grund: 'preis_beleg_unsicher', preisBildschirm: { modus: true, befund: 'halten', regeln: ['beleg'], art: 'beleg' } });
    return doc('kamera').review.rundeOffen.lauf;
  }

  it('Preisbeleg zurück auf Beobachtung oder aus → angehaltene Bildschirmfotos bleiben liegen; nur die Preisbelege werden frei', async () => {
    for (const beleg of ['shadow', false]) {
      mockStore.clear(); mockListe.clear(); mockQuelle.clear(); mockBeleg.clear(); mockKopf.clear();
      const lauf1 = await tag1();
      unauffaellig();
      schalter(true, beleg);
      const b = await scharf();
      expect([beleg, doc('kamera').status]).toEqual([beleg, 'pending']);
      expect(doc('kamera').review.rundeOffen).toMatchObject({ grund: 'preis_bildschirm_unsicher', preisBildschirm: { modus: true, befund: 'halten', seit: lauf1, regeln: ['bildschirm'] } });
      // dokumentierter Rückweg: die eigene Regel zurückgenommen → ihre Fälle frei
      expect([beleg, doc('korb').status]).toEqual([beleg, 'approved']);
      expect(b.preisBildschirm).toMatchObject({ modus: true, beleg: { modus: beleg } });
    }
  });

  it('Bildschirm-Regel zurück auf Beobachtung oder aus → angehaltene Preisbelege bleiben liegen; nur die Bildschirmfotos werden frei', async () => {
    for (const bildschirm of ['shadow', false]) {
      mockStore.clear(); mockListe.clear(); mockQuelle.clear(); mockBeleg.clear(); mockKopf.clear();
      const lauf1 = await tag1();
      unauffaellig();
      schalter(bildschirm, true);
      mockDownloads.length = 0;
      await scharf();
      expect([bildschirm, doc('korb').status]).toEqual([bildschirm, 'pending']);
      expect(doc('korb').review.rundeOffen).toMatchObject({ grund: 'preis_beleg_unsicher', preisBildschirm: { modus: true, befund: 'halten', seit: lauf1, regeln: ['beleg'] } });
      expect(doc('korb').review.rundeOffen.hinweis).toMatch(/^Preisbeleg unsicher — Befund vom/);
      expect([bildschirm, doc('kamera').status]).toEqual([bildschirm, 'approved']);
      // ohne Bildschirm-Regel kein Bildkopf
      if (bildschirm === false) expect(mockDownloads).toEqual([]);
    }
  });

  // Nachprüfung 05.10.2026: mit `preisBelegRegel: false` fiel der Vorbefund
  // ganz weg, und eine einzige neue „bildschirm"-Lesung lehnte den gehaltenen
  // Fall endgültig ab — mit 'shadow' blieb er liegen. Beide Rückwege gleich.
  it('Preisbeleg-Halt, Preisbeleg zurückgenommen (shadow oder false), heute „bildschirm" → bleibt liegen, nie abgelehnt', async () => {
    for (const zurueck of ['shadow', false]) {
      mockStore.clear(); mockListe.clear(); mockQuelle.clear(); mockBeleg.clear(); mockKopf.clear();
      // Tag 1: Lesedienst hat das Preisfoto noch nicht eingeordnet; Bildprüfung „Kassenbon" ohne Merkmale → Preisbeleg hält
      schalter(true, true);
      einreichung('k', { ean: '4000000000017' });
      mockQuelle.set(preisPfad('k'), 'kassenbon');
      mockBeleg.set(preisPfad('k'), { belegHaendler: '', belegMerkmale: [] });
      mockKopf.set(preisPfad('k'), png(1170, 2532));
      await scharf();
      expect(doc('k')).toMatchObject({ status: 'pending', review: { rundeOffen: { grund: 'preis_beleg_unsicher', preisBildschirm: { modus: true, befund: 'halten', regeln: ['beleg'] } } } });
      // Tag 2: Preisbeleg zurückgenommen; der Lesedienst trägt inzwischen „sonstiges" ein, die Bildprüfung sagt „bildschirm"
      schalter(true, zurueck);
      mockStore.set('crowd_uploads/k', { ...doc('k'), priceImageKind: 'sonstiges' });
      mockQuelle.set(preisPfad('k'), 'bildschirm');
      const b2 = await scharf();
      expect([zurueck, doc('k').status]).toEqual([zurueck, 'pending']);
      expect(doc('k').rejectReason).toBeUndefined();
      expect(b2.ablehnGruende).toEqual({});
      expect(b2.offenGruende).toEqual({ preis_bildschirm_unsicher: 1 });
      const lauf2 = doc('k').review.rundeOffen.lauf;
      expect(doc('k').review.rundeOffen).toMatchObject({ grund: 'preis_bildschirm_unsicher', preisBildschirm: { modus: true, befund: 'halten', seit: lauf2, regeln: ['bildschirm'] } });
      // Tag 3: dieselbe Lesung — der neue Halt der Bildschirm-Regel wird nicht zur Ablehnung
      const b3 = await scharf();
      expect([zurueck, doc('k').status]).toEqual([zurueck, 'pending']);
      expect(b3.ablehnGruende).toEqual({});
      expect(doc('k').review.rundeOffen.preisBildschirm).toMatchObject({ befund: 'halten', seit: lauf2, regeln: ['bildschirm'] });
    }
  });

  // Nachprüfung 06.10.2026: die Sperre gegen eine automatische Ablehnung
  // stand nur im Speicher des Laufs. Gespeichert wurde sie nur, wenn am
  // Rücknahme-Morgen ein neuer scharfer Befund entstand — scheiterte an dem
  // Morgen die Bildprüfung (429, Zeitgrenze) oder lag der Fall aus anderem
  // Grund und wurde ohne Befund gelesen, war sie am nächsten Morgen weg, und
  // eine einzige „bildschirm"-Lesung lehnte den gehaltenen Fall endgültig ab.
  /** Tag 1: beide Regeln scharf, „Kassenbon" ohne Merkmale → Preisbeleg hält. */
  async function belegHaltTag1(extra = {}) {
    schalter(true, true);
    einreichung('k', { ean: '4000000000017', ...extra });
    mockQuelle.set(preisPfad('k'), 'kassenbon');
    mockBeleg.set(preisPfad('k'), { belegHaendler: '', belegMerkmale: [] });
    mockKopf.set(preisPfad('k'), png(1170, 2532));
    await scharf();
    expect(doc('k')).toMatchObject({ status: 'pending', review: { rundeOffen: { preisBildschirm: { modus: true, befund: 'halten', regeln: ['beleg'], ablehnenGesperrt: true } } } });
    return doc('k').review.rundeOffen.lauf;
  }
  /** Lesedienst „sonstiges", Bildprüfung „bildschirm", PNG im Bildschirmformat → ohne Sperre eine Ablehnung. */
  function bildschirmLesung() {
    mockStore.set('crowd_uploads/k', { ...doc('k'), priceImageKind: 'sonstiges' });
    mockQuelle.set(preisPfad('k'), 'bildschirm');
  }

  it('Preisbeleg-Halt; Tag 2 Rücknahme (shadow oder false) und die Bildprüfung scheitert; Tag 3 „bildschirm" → bleibt liegen, nie abgelehnt', async () => {
    for (const zurueck of ['shadow', false]) {
      mockStore.clear(); mockListe.clear(); mockQuelle.clear(); mockBeleg.clear(); mockKopf.clear(); mockAudit.clear();
      const lauf1 = await belegHaltTag1();
      // Tag 2: Preisbeleg zurückgenommen, die Bildprüfung scheitert für diesen Fall
      schalter(true, zurueck);
      mockAudit.set('crowduploads/4000000000017/k/ean.jpg', 'AUDIT_FEHLER');
      await scharf();
      expect([zurueck, doc('k').status]).toEqual([zurueck, 'pending']);
      // Die Sperre steht am Fall. Bei false ist sie der ganze Eintrag (kein Befund, die
      // Konsole zeigt dazu keinen Hinweis); bei 'shadow' reist an diesem Morgen
      // zusätzlich der Vorbefund als Beobachtung mit.
      const pb2 = doc('k').review.rundeOffen.preisBildschirm;
      if (zurueck === false) expect(pb2).toEqual({ ablehnenGesperrt: true, gesperrtSeit: lauf1 });
      else expect(pb2).toEqual({ modus: 'shadow', befund: 'halten', seit: lauf1, art: 'beleg', ablehnenGesperrt: true, gesperrtSeit: lauf1 });
      // Tag 3: Bildprüfung wieder da, sie liest „bildschirm"
      mockAudit.delete('crowduploads/4000000000017/k/ean.jpg');
      bildschirmLesung();
      const b3 = await scharf();
      expect([zurueck, doc('k').status]).toEqual([zurueck, 'pending']);
      expect(doc('k').rejectReason).toBeUndefined();
      expect(b3.ablehnGruende).toEqual({});
      expect(doc('k').review.rundeOffen).toMatchObject({ grund: 'preis_bildschirm_unsicher', preisBildschirm: { modus: true, befund: 'halten', regeln: ['bildschirm'], ablehnenGesperrt: true, gesperrtSeit: lauf1 } });
      // Tag 4: dieselbe Lesung — weiter nur gehalten
      await scharf();
      expect([zurueck, doc('k').status]).toEqual([zurueck, 'pending']);
    }
  });

  it('Preisbeleg-Halt; Fall liegt am Rücknahme-Morgen aus anderem Grund (Ort auffällig) und wird ohne Befund gelesen → Tag 3 „bildschirm" lehnt nicht ab', async () => {
    for (const zurueck of ['shadow', false]) {
      mockStore.clear(); mockListe.clear(); mockQuelle.clear(); mockBeleg.clear(); mockKopf.clear(); mockAudit.clear();
      // Aufnahmeort in Belgien, Markt DE → ort_auffaellig (liegt, bis ein Mensch entscheidet)
      const lauf1 = await belegHaltTag1({ capture: { gps: { lat: 50.85, lon: 4.35, accuracyM: 5 } }, marketLand: 'DE' });
      // Tag 2: Preisbeleg zurückgenommen; die Bildprüfung liest einen vollständigen Bon vom Kamerafoto → kein Befund
      schalter(true, zurueck);
      mockBeleg.set(preisPfad('k'), { belegHaendler: 'REWE', belegMerkmale: VOLL });
      mockKopf.set(preisPfad('k'), jpeg(3000, 4000));
      await scharf();
      expect([zurueck, doc('k').status]).toEqual([zurueck, 'pending']);
      expect([zurueck, doc('k').review.rundeOffen.grund]).toEqual([zurueck, 'ort_auffaellig']);
      expect([zurueck, doc('k').review.rundeOffen.preisBildschirm]).toMatchObject([zurueck, { ablehnenGesperrt: true, gesperrtSeit: lauf1 }]);
      // Tag 3: „bildschirm" auf einem Bildschirmformat — ohne Sperre stünde hier „fotos_unpassend"
      mockKopf.set(preisPfad('k'), png(1170, 2532));
      bildschirmLesung();
      const b3 = await scharf();
      expect([zurueck, doc('k').status]).toEqual([zurueck, 'pending']);
      expect(b3.ablehnGruende).toEqual({});
      expect(doc('k').review.rundeOffen).toMatchObject({ grund: 'ort_auffaellig', preisBildschirm: { befund: 'halten', ablehnenGesperrt: true, gesperrtSeit: lauf1 } });
    }
  });

  it('ein Trockenlauf mit geplanter Freigabe löscht die Sperre nicht', async () => {
    const lauf1 = await belegHaltTag1();
    // Tag 2: Preisbeleg aus, unauffällige Lesung — scharf wäre der Fall jetzt bezahlt; als Trockenlauf bleibt er liegen
    schalter(true, false);
    mockBeleg.set(preisPfad('k'), { belegHaendler: 'REWE', belegMerkmale: VOLL });
    mockKopf.set(preisPfad('k'), jpeg(3000, 4000));
    await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(doc('k').status).toBe('pending');
    expect(doc('k').review.rundeOffen).toMatchObject({ geplant: 'freigeben', trocken: true, preisBildschirm: { ablehnenGesperrt: true, gesperrtSeit: lauf1 } });
    // Tag 3 scharf: „bildschirm" → nur gehalten
    mockKopf.set(preisPfad('k'), png(1170, 2532));
    bildschirmLesung();
    await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').review.rundeOffen.grund).toBe('preis_bildschirm_unsicher');
  });

  it('ohne früheren Halt lehnt dieselbe Lesung ab — die Sperre hängt nur am gehaltenen Fall', async () => {
    schalter(true, false);
    einreichung('k', { ean: '4000000000017' });
    mockKopf.set(preisPfad('k'), png(1170, 2532));
    bildschirmLesung();
    await scharf();
    expect(doc('k')).toMatchObject({ status: 'rejected', rejectReason: 'fotos_unpassend', review: { reason: 'preis_bildschirm' } });
  });

  it('nur der Preisbeleg scharf, Bildschirm-Regel aus: Preisbeleg hält, Bildschirmfotos werden wie vor der Regel freigegeben', async () => {
    schalter(false, true);
    korb('korb', '4000000000017');
    einreichung('schirm', { ean: '4000417025005', priceImageKind: 'preisschild' });
    mockQuelle.set(preisPfad('schirm'), 'bildschirm');
    mockKopf.set(preisPfad('schirm'), png(1080, 2400));
    const b = await scharf();
    expect(doc('korb')).toMatchObject({ status: 'pending', review: { rundeOffen: { grund: 'preis_beleg_unsicher' } } });
    expect(doc('schirm').status).toBe('approved');
    expect(mockDownloads).toEqual([]);
    expect(b.preisBildschirm).toMatchObject({ modus: false, befundAblehnen: 0, beleg: { modus: true, ohneMerkmale: 1, stattFreigabe: 1 } });
  });

  it('nur die Bildschirm-Regel scharf: Preisbeleg wird beobachtet, nicht angehalten; Bildschirmfotos werden abgelehnt', async () => {
    schalter(true, 'shadow');
    korb('korb', '4000000000017');
    einreichung('schirm', { ean: '4000417025005', priceImageKind: 'preisschild' });
    mockQuelle.set(preisPfad('schirm'), 'bildschirm');
    mockKopf.set(preisPfad('schirm'), png(1080, 2400));
    const b = await scharf();
    expect(doc('korb').status).toBe('approved');
    expect(doc('schirm')).toMatchObject({ status: 'rejected', review: { reason: 'preis_bildschirm' } });
    expect(b.preisBildschirm.beleg).toMatchObject({ modus: 'shadow', ohneMerkmale: 1, stattFreigabe: 1 });
    expect(b.preisBildschirm.beleg.faelle.find((f) => f.id === 'korb')).toMatchObject({ wirkt: false, entscheidung: 'freigeben', ohneRegel: 'freigeben' });
    expect(b.preisBildschirm.faelle.find((f) => f.id === 'korb')).toBeUndefined();
    expect(b.preisBildschirm.faelle.find((f) => f.id === 'schirm')).toMatchObject({ wirkt: true, entscheidung: 'ablehnen' });
    expect(b.preisBildschirm).toMatchObject({ befundAblehnen: 1, befundHalten: 0, stattFreigabe: 1 });
  });

  it('unbekannter Wert von preisBelegRegel ("true" als Text) → Beobachtung, gelbe Warnung mit dem Wert; gültige Werte warnen nicht', async () => {
    schalter(true, 'true');
    korb('korb', '4000000000017');
    const b = await scharf();
    expect(doc('korb').status).toBe('approved');
    expect(b.preisBildschirm.beleg).toMatchObject({ modus: 'shadow', schalterUnbekannt: '"true" (Text)' });
    expect(b.warnungen.find((w) => w.code === 'preisbeleg_schalter_unbekannt')).toMatchObject({ stufe: 'gelb' });
    expect(b.warnungen.map((w) => w.code)).not.toContain('preisbildschirm_schalter_unbekannt');
    for (const v of [undefined, 'shadow', true, false]) {
      mockStore.clear(); mockListe.clear(); mockKopf.clear(); mockQuelle.clear(); mockBeleg.clear(); schalter(true, v);
      einreichung('a');
      const w = await scharf();
      expect(w.preisBildschirm.beleg).not.toHaveProperty('schalterUnbekannt');
      expect(w.warnungen.map((x) => x.code)).not.toContain('preisbeleg_schalter_unbekannt');
    }
  });

  // ── Nachprüfung 05.10.2026: der Tagesbericht zählt je Regel und jeden Fall
  // nur an EINEM Morgen. Nach diesen Zahlen wird entschieden, ob eine Regel
  // scharf geschaltet wird — ein reiner Preisbeleg-Fall gehört nicht in die
  // Zeilen der Bildschirm-Regel, und ein Fall, der auf Patrick wartet, nicht
  // jeden Morgen erneut unter „statt Freigabe".
  it('Bericht: ein Fall, den BEIDE Regeln halten, zählt in beiden Abschnitten; ein reiner Preisbeleg nur beim Preisbeleg', async () => {
    schalter('shadow', 'shadow');
    korb('korb', '4000000000017');
    // „Kassenbon" mit Bildschirm-Merkmalen, der Lesedienst las ein Preisschild,
    // und kein Kassenbon-Merkmal → Bildschirm-Verdacht UND Preisbeleg
    einreichung('beide', { ean: '4000417025005', priceImageKind: 'preisschild' });
    mockQuelle.set(preisPfad('beide'), 'kassenbon');
    mockBeleg.set(preisPfad('beide'), { belegHaendler: '', belegMerkmale: [] });
    mockKopf.set(preisPfad('beide'), png(1080, 2400));
    const b = await scharf();
    for (const id of ['korb', 'beide']) expect(doc(id).status).toBe('approved');
    expect(b.preisBildschirm).toMatchObject({ befundAblehnen: 0, befundHalten: 1, stattFreigabe: 1, ausVortagen: 0, vorbefund: 0, nachRuecknahmeFrei: 0 });
    expect(b.preisBildschirm.faelle.map((f) => f.id)).toEqual(['beide']);
    expect(b.preisBildschirm.beleg).toMatchObject({ ohneMerkmale: 2, stattFreigabe: 2, ausVortagen: 0 });
    expect(b.preisBildschirm.beleg.faelle.map((f) => f.id).sort()).toEqual(['beide', 'korb']);
  });

  it('Bericht, Preisbeleg scharf: Tag 1 „statt Freigabe", danach nur noch „aus Vortagen" — die Zahl wächst nicht mit den Tagen', async () => {
    schalter('shadow', true);
    korb('korb', '4000000000017');
    const b1 = await scharf();
    expect(doc('korb').status).toBe('pending');
    expect(b1.preisBildschirm.beleg).toMatchObject({ ohneMerkmale: 1, stattFreigabe: 1, ausVortagen: 0 });
    expect(b1.preisBildschirm).toMatchObject({ befundHalten: 0, stattFreigabe: 0, ausVortagen: 0, vorbefund: 0 });
    const lauf1 = doc('korb').review.rundeOffen.lauf;
    // Tag 2 und 3: das Modell liest einen vollständigen Bon — kein heutiger Befund, der Vorbefund hält
    mockBeleg.set(preisPfad('korb'), { belegHaendler: 'REWE', belegMerkmale: VOLL });
    for (let tag = 2; tag <= 3; tag++) {
      const b = await scharf();
      expect([tag, doc('korb').status]).toEqual([tag, 'pending']);
      expect([tag, b.preisBildschirm.beleg]).toMatchObject([tag, { ohneMerkmale: 0, fremderHaendler: 0, stattFreigabe: 0, ausVortagen: 1 }]);
      expect([tag, b.preisBildschirm]).toMatchObject([tag, { befundHalten: 0, stattFreigabe: 0, ausVortagen: 0, vorbefund: 1, nachRuecknahmeFrei: 0, faelle: [] }]);
      expect(b.preisBildschirm.beleg.faelle).toEqual([expect.objectContaining({ id: 'korb', befund: null, entscheidung: 'offen', vorbefund: lauf1 })]);
      // die Warnung „hält viele an" zählt nur frische Halte
      expect(b.offenGruende).toEqual({ preis_beleg_unsicher: 1 });
    }
  });

  it('Bericht, Bildschirm-Regel scharf: Tag 2 „aus Vortagen"; Tag 3 Regel zurückgenommen → „nach Rücknahme freigegeben", nicht „hält weiter"', async () => {
    for (const zurueck of ['shadow', false]) {
      mockStore.clear(); mockListe.clear(); mockQuelle.clear(); mockBeleg.clear(); mockKopf.clear();
      schalter(true, 'shadow');
      kamera('kamera', '4000417025005');
      const b1 = await scharf();
      expect(b1.preisBildschirm).toMatchObject({ befundHalten: 1, stattFreigabe: 1, ausVortagen: 0, vorbefund: 0 });
      const lauf1 = doc('kamera').review.rundeOffen.lauf;
      // Tag 2: dieselbe Lesung — der Fall lag schon, heute ändert sich nichts
      const b2 = await scharf();
      expect(doc('kamera').status).toBe('pending');
      expect(b2.preisBildschirm).toMatchObject({ befundHalten: 0, stattFreigabe: 0, ausVortagen: 1, vorbefund: 1, nachRuecknahmeFrei: 0 });
      expect(b2.preisBildschirm.faelle).toEqual([expect.objectContaining({ id: 'kamera', vorbefund: lauf1, entscheidung: 'offen', wirkt: true })]);
      // Tag 3: Regel zurückgenommen → bezahlt; der Kasten meldet das, statt „hält weiter"
      schalter(zurueck, 'shadow');
      const b3 = await scharf();
      expect([zurueck, doc('kamera').status]).toEqual([zurueck, 'approved']);
      expect([zurueck, b3.preisBildschirm]).toMatchObject([zurueck, { ausVortagen: 0, vorbefund: 0, nachRuecknahmeFrei: 1, befundHalten: 0, stattFreigabe: 0 }]);
      if (zurueck === 'shadow') expect(b3.preisBildschirm.faelle).toEqual([expect.objectContaining({ id: 'kamera', vorbefund: lauf1, entscheidung: 'freigeben', wirkt: false })]);
    }
  });

  it('Bericht: eine von der Notbremse zurückgehaltene Ablehnung zählt nur am ersten Morgen als „Befund ablehnen"', async () => {
    schalter(true, 'shadow');
    // vier Personen → Bremse der Bildschirm-Regel (mindestens 4 Personen, > 2,5 %)
    for (let i = 0; i < 4; i++) {
      const uid = `p${i}`;
      einreichung(`s${i}`, { uid, ean: String(4000000000000 + i * 97), priceImageKind: 'preisschild' });
      mockQuelle.set(preisPfad(`s${i}`, uid), 'bildschirm');
      mockKopf.set(preisPfad(`s${i}`, uid), png(1080, 2400));
    }
    const b1 = await scharf();
    expect(b1.notbremse.bildschirm).toBe(true);
    for (let i = 0; i < 4; i++) expect(doc(`s${i}`).status).toBe('pending');
    expect(b1.preisBildschirm).toMatchObject({ befundAblehnen: 4, stattFreigabe: 4, ausVortagen: 0, vorbefund: 0 });
    expect(b1.warnungen.find((w) => w.code === 'notbremse').text).toMatch(/Bildschirmfoto.*Sie bleiben liegen, bis du sie in der Konsole entscheidest/);
    // Echter Lauf: Sperre gegen eine Ablehnung am Fall (Entscheidung Patrick 06.10.2026).
    for (let i = 0; i < 4; i++) expect(doc(`s${i}`).review.rundeOffen).toMatchObject({ grund: 'notbremse_preis_bildschirm', preisBildschirm: { befund: 'ablehnen', ablehnenGesperrt: true, gesperrtSeit: b1.lauf } });
    // Zweiter Lauf: dieselben vier halten gesperrt (keine Ablehnung mehr
    // möglich) und zählen für das Ob weiter mit, aber kein zweiter roter
    // Alarm: nur eine gelbe Zeile „warten seit …".
    const b2 = await scharf();
    expect(b2.notbremse).toMatchObject({ bildschirm: true, ausVortagen: { bildschirm: 4 } });
    for (let i = 0; i < 4; i++) expect(doc(`s${i}`)).toMatchObject({ status: 'pending', review: { rundeOffen: { grund: 'preis_bildschirm_unsicher', notbremseEcht: 'notbremse_preis_bildschirm', preisBildschirm: { ablehnenGesperrt: true, gesperrtSeit: b1.lauf } } } });
    expect(b2.preisBildschirm).toMatchObject({ befundAblehnen: 0, stattFreigabe: 0, ausVortagen: 4, vorbefund: 4 });
    expect(b2.warnungen.map((w) => w.code)).not.toContain('notbremse');
    const gelb = b2.warnungen.find((w) => w.code === 'notbremse_vortage_bildschirm');
    expect(gelb).toMatchObject({ stufe: 'gelb' });
    expect(gelb.text).toBe(`Notbremse: 4 Fälle (4 Personen, Bildschirmfoto als Preis) warten seit ${b1.lauf} auf deine Entscheidung in der Konsole.`);
  });

  // Nachprüfung 06.10.2026: eine anhaltende Fehllesung mit WENIGEN neuen
  // Fällen gab die gestern zurückgehaltenen zur endgültigen Ablehnung frei —
  // ohne jede Warnung. Jetzt zählen die übernommenen für das Ob mit.
  it('zwei Morgen: Fehllesung hält an, Tag 2 drei neue Personen → alle sieben bleiben liegen, gelb statt rot', async () => {
    schalter(true, 'shadow');
    const schirm = (i) => {
      const uid = `p${i}`;
      einreichung(`s${i}`, { uid, ean: String(4000000000000 + i * 97), priceImageKind: 'preisschild' });
      mockQuelle.set(preisPfad(`s${i}`, uid), 'bildschirm');
      mockKopf.set(preisPfad(`s${i}`, uid), png(1080, 2400));
    };
    for (let i = 0; i < 4; i++) schirm(i);
    const b1 = await scharf();
    expect(b1.notbremse.bildschirm).toBe(true);
    for (let i = 4; i < 7; i++) schirm(i);
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    const b2 = await scharf();
    for (let i = 0; i < 4; i++) expect(doc(`s${i}`)).toMatchObject({ status: 'pending', review: { rundeOffen: { grund: 'preis_bildschirm_unsicher', trocken: false, preisBildschirm: { ablehnenGesperrt: true } } } });
    for (let i = 4; i < 7; i++) expect(doc(`s${i}`)).toMatchObject({ status: 'pending', review: { rundeOffen: { grund: 'notbremse_preis_bildschirm', trocken: false, preisBildschirm: { ablehnenGesperrt: true } } } });
    expect(b2).toMatchObject({ abgelehnt: 0, notbremse: { bildschirm: true, ausVortagen: { bildschirm: 4 } } });
    expect(b2.preisBildschirm).toMatchObject({ befundAblehnen: 3, ausVortagen: 4 });
    expect(b2.warnungen.map((w) => w.code)).not.toContain('notbremse');
    expect(b2.warnungen.find((w) => w.code === 'notbremse_vortage_bildschirm').text)
      .toMatch(/4 Fälle \(4 Personen, Bildschirmfoto als Preis\) warten seit .* — heute 3 neue \(3 Personen\) mitgehalten\.$/);
    // Tag 3: nichts Neues, niemand hat entschieden — liegen weiter, weiter nur gelb
    dateSpy.mockImplementation(() => T0 + 2 * TAG_MS);
    const b3 = await scharf();
    for (let i = 0; i < 7; i++) expect(doc(`s${i}`).status).toBe('pending');
    expect(b3.notbremse).toMatchObject({ bildschirm: true, ausVortagen: { bildschirm: 7 } });
    expect(b3.warnungen.map((w) => w.code)).not.toContain('notbremse');
    expect(b3.warnungen.map((w) => w.code)).toContain('notbremse_vortage_bildschirm');
  });

  // Bis zur Abschlussprüfung 06.10.2026 stand hier: „greift die Bremse nicht
  // mehr (ein Fall heute anders gelesen), werden die übrigen übernommenen
  // abgelehnt". Eine schwankende Lesung ist aber gerade das Zeichen, dass dem
  // Modell nicht zu trauen ist — der gesperrt haltende Fall zählt jetzt weiter
  // mit (Test „Befund 1: ebenso, wenn ein übernommener Fall heute anders
  // gelesen wird" unten).

  it('ein manueller Trockenlauf zwischen zwei Morgen löscht den Merker „schon zurückgehalten" nicht (kein zweites Rot)', async () => {
    schalter(true, 'shadow');
    for (let i = 0; i < 4; i++) {
      const uid = `p${i}`;
      einreichung(`s${i}`, { uid, ean: String(4000000000000 + i * 97), priceImageKind: 'preisschild' });
      mockQuelle.set(preisPfad(`s${i}`, uid), 'bildschirm');
      mockKopf.set(preisPfad(`s${i}`, uid), png(1080, 2400));
    }
    expect((await scharf()).warnungen.map((w) => w.code)).toContain('notbremse');
    await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(doc('s0').review.rundeOffen).toMatchObject({ trocken: true, grund: 'preis_bildschirm_unsicher', notbremseEcht: 'notbremse_preis_bildschirm', preisBildschirm: { ablehnenGesperrt: true } });
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    const b2 = await scharf();
    for (let i = 0; i < 4; i++) expect(doc(`s${i}`)).toMatchObject({ status: 'pending', review: { rundeOffen: { trocken: false, grund: 'preis_bildschirm_unsicher', notbremseEcht: 'notbremse_preis_bildschirm', preisBildschirm: { ablehnenGesperrt: true } } } });
    expect(b2.notbremse).toMatchObject({ bildschirm: true, ausVortagen: { bildschirm: 4 } });
    expect(b2.warnungen.map((w) => w.code)).not.toContain('notbremse');
    expect(b2.warnungen.map((w) => w.code)).toContain('notbremse_vortage_bildschirm');
  });

  // Bis 06.10.2026 plante ein Trockenlauf hier die Ablehnung der übrigen drei.
  it('Trockenlauf nach einer Teilentscheidung: die übrigen würde auch ein scharfer Lauf nicht ablehnen, nichts Neues vermerkt', async () => {
    schalter(true, 'shadow');
    for (let i = 0; i < 4; i++) {
      const uid = `p${i}`;
      einreichung(`s${i}`, { uid, ean: String(4000000000000 + i * 97), priceImageKind: 'preisschild' });
      mockQuelle.set(preisPfad(`s${i}`, uid), 'bildschirm');
      mockKopf.set(preisPfad(`s${i}`, uid), png(1080, 2400));
    }
    expect((await scharf()).notbremse.bildschirm).toBe(true);
    // Einer wird in der Konsole entschieden → drei Personen, unter der Schwelle
    mockStore.set('crowd_uploads/s0', { ...doc('s0'), status: 'approved', review: { decidedBy: 'admin', forced: false } });
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    const vorher = [1, 2, 3].map((i) => doc(`s${i}`).review.rundeOffen.preisBildschirm);
    const t = await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    for (let i = 1; i < 4; i++) expect(doc(`s${i}`)).toMatchObject({ status: 'pending', review: { rundeOffen: { trocken: true, notbremseEcht: 'notbremse_preis_bildschirm' } } });
    for (let i = 1; i < 4; i++) expect(doc(`s${i}`).review.rundeOffen).not.toHaveProperty('geplant');
    // Die Sperre reist unverändert weiter (seit dem echten Lauf), nichts Neues.
    expect([1, 2, 3].map((i) => doc(`s${i}`).review.rundeOffen.preisBildschirm.gesperrtSeit)).toEqual(vorher.map((v) => v.gesperrtSeit));
    expect(t.notbremse).toMatchObject({ bildschirm: false, ausVortagen: { bildschirm: 3 } });
    expect(t.notbremse).not.toHaveProperty('ausVortagenAbgelehnt');
    expect(t.warnungen.map((x) => x.code)).toContain('notbremse_vortage_bildschirm');
  });

  it('Notbremse an Tag 2 nur wegen frischer Fälle; die übernommenen werden dann mitgehalten', async () => {
    schalter(true, 'shadow');
    const schirm = (i) => {
      const uid = `p${i}`;
      einreichung(`s${i}`, { uid, ean: String(4000000000000 + i * 97), priceImageKind: 'preisschild' });
      mockQuelle.set(preisPfad(`s${i}`, uid), 'bildschirm');
      mockKopf.set(preisPfad(`s${i}`, uid), png(1080, 2400));
    };
    for (let i = 0; i < 4; i++) schirm(i);
    expect((await scharf()).notbremse.bildschirm).toBe(true);
    for (let i = 4; i < 8; i++) schirm(i);
    const b2 = await scharf();
    expect(b2.notbremse).toMatchObject({ bildschirm: true, ausVortagen: { bildschirm: 4 } });
    for (let i = 0; i < 8; i++) expect(doc(`s${i}`).status).toBe('pending');
    expect(b2.preisBildschirm).toMatchObject({ befundAblehnen: 4, ausVortagen: 4 });
  });

  it('nach einem Trockenlauf zählt der erste scharfe Lauf dieselben Fälle voll (der Trockenlauf hielt nichts zurück)', async () => {
    schalter(true, 'shadow');
    for (let i = 0; i < 4; i++) {
      const uid = `p${i}`;
      einreichung(`s${i}`, { uid, ean: String(4000000000000 + i * 97), priceImageKind: 'preisschild' });
      mockQuelle.set(preisPfad(`s${i}`, uid), 'bildschirm');
      mockKopf.set(preisPfad(`s${i}`, uid), png(1080, 2400));
    }
    const t = await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(t.notbremse.bildschirm).toBe(true);
    expect(doc('s0').review.rundeOffen).toMatchObject({ grund: 'notbremse_preis_bildschirm', trocken: true });
    const b = await scharf();
    expect(b.notbremse).toMatchObject({ bildschirm: true });
    expect(b.notbremse).not.toHaveProperty('ausVortagen');
    for (let i = 0; i < 4; i++) expect(doc(`s${i}`).status).toBe('pending');
  });
});

// Abschlussprüfung 06.10.2026 — drei Befunde, je mit dem echten Ablauf nachgestellt.
describe('Abschlussprüfung 06.10.2026: Notbremse-Kohorte und Meldungen nach einem Trockenlauf', () => {
  const { jpeg, png } = require('./helpers/bildKopfDaten');
  const preisPfad = (id, uid = 'u1') => `crowduploads/${uid}/${id}/preis.jpg`;
  const schalter = (bildschirm, beleg) => mockStore.set('cashback_config/v1', {
    fotoWorker: true, ...(bildschirm === undefined ? {} : { preisBildschirmRegel: bildschirm }), ...(beleg === undefined ? {} : { preisBelegRegel: beleg }),
  });
  const eanVon = (i) => String(4000000000000 + i * 97);
  /** Person p<i> reicht ein Bildschirmfoto ein (Merkmale + „bildschirm" → Ablehn-Befund). */
  const schirm = (i) => {
    const uid = `p${i}`;
    einreichung(`s${i}`, { uid, ean: eanVon(i), priceImageKind: 'preisschild' });
    mockQuelle.set(preisPfad(`s${i}`, uid), 'bildschirm');
    mockKopf.set(preisPfad(`s${i}`, uid), png(1080, 2400));
  };
  const zeitplan = (dryRun) => taeglicheRunde({ dryRun, projekt: 'p', bucketName: 'b', ausloeser: 'zeitplan' });

  // Befund 1: Ob die Bremse greift, zählte nur Fälle, die HEUTE „ablehnen"
  // lesen. Scheiterte für einen übernommenen Fall die Bildprüfung, fiel er aus
  // der Zählung — und die übrigen drei wurden endgültig abgelehnt. Ein
  // Technikfehler entschied so mittelbar über drei Ablehnungen.
  it('Befund 1: Tag 2 scheitert die Bildprüfung für einen übernommenen Fall → die übrigen bleiben liegen (gelb), auch an Tag 3', async () => {
    schalter(true, 'shadow');
    for (let i = 0; i < 4; i++) schirm(i);
    expect((await scharf()).notbremse.bildschirm).toBe(true);
    mockAudit.set(`crowduploads/${eanVon(0)}/s0/ean.jpg`, 'AUDIT_FEHLER');
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    const b2 = await scharf();
    for (let i = 0; i < 4; i++) expect(doc(`s${i}`).status).toBe('pending');
    expect(b2).toMatchObject({ abgelehnt: 0, notbremse: { bildschirm: true, ausVortagen: { bildschirm: 4 } } });
    // Merker und Sperre überleben einen Tag, an dem der Fall aus anderem Grund offen ist.
    expect(doc('s0').review.rundeOffen).toMatchObject({ grund: 'bild_audit_gescheitert', trocken: false, notbremseEcht: 'notbremse_preis_bildschirm', preisBildschirm: { ablehnenGesperrt: true } });
    expect(b2.warnungen.map((w) => w.code)).not.toContain('notbremse');
    expect(b2.warnungen.find((w) => w.code === 'notbremse_vortage_bildschirm').text)
      .toMatch(/^Notbremse: 4 Fälle \(4 Personen, Bildschirmfoto als Preis\) warten seit /);
    // Tag 3: Bildprüfung wieder da — s0 hält gesperrt, die übrigen weiter nur von der Bremse.
    mockAudit.clear();
    dateSpy.mockImplementation(() => T0 + 2 * TAG_MS);
    const b3 = await scharf();
    for (let i = 0; i < 4; i++) expect(doc(`s${i}`).status).toBe('pending');
    expect(b3.notbremse).toMatchObject({ bildschirm: true, ausVortagen: { bildschirm: 4 } });
    expect(doc('s0').review.rundeOffen).toMatchObject({ grund: 'preis_bildschirm_unsicher', notbremseEcht: 'notbremse_preis_bildschirm', preisBildschirm: { ablehnenGesperrt: true } });
  });

  it('Befund 1: ebenso, wenn ein übernommener Fall heute anders gelesen wird (er hält gesperrt) — die übrigen bleiben liegen', async () => {
    schalter(true, 'shadow');
    for (let i = 0; i < 4; i++) schirm(i);
    expect((await scharf()).notbremse.bildschirm).toBe(true);
    mockQuelle.set(preisPfad('s0', 'p0'), 'preisschild');
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    const b2 = await scharf();
    expect(doc('s0')).toMatchObject({ status: 'pending', review: { rundeOffen: { grund: 'preis_bildschirm_unsicher', notbremseEcht: 'notbremse_preis_bildschirm', preisBildschirm: { ablehnenGesperrt: true } } } });
    for (let i = 1; i < 4; i++) expect(doc(`s${i}`)).toMatchObject({ status: 'pending', review: { rundeOffen: { grund: 'preis_bildschirm_unsicher', notbremseEcht: 'notbremse_preis_bildschirm', preisBildschirm: { ablehnenGesperrt: true } } } });
    expect(b2).toMatchObject({ abgelehnt: 0, notbremse: { bildschirm: true, ausVortagen: { bildschirm: 4 } } });
    expect(b2.warnungen.find((w) => w.code === 'notbremse_vortage_bildschirm').text).toMatch(/^Notbremse: 4 Fälle /);
  });

  // Bis zur Entscheidung Patricks (06.10.2026: „ja") lehnte die Runde hier die
  // übernommenen ab, sobald die Bremse nicht mehr griff.
  it('Befund 1, Gegenprobe: mehr geprüfte Einreichungen als am Vortag → die Bremse greift nicht mehr, die übernommenen bleiben trotzdem liegen', async () => {
    schalter(true, 'shadow');
    for (let i = 0; i < 4; i++) schirm(i);
    expect((await scharf()).notbremse.bildschirm).toBe(true);
    // 160 unauffällige neue: 4 Personen bei 164 geprüften = 2,4 % ≤ 2,5 %
    for (let i = 0; i < 160; i++) einreichung(`n${i}`, { uid: `n${i}`, ean: String(4100000000000 + i * 97) });
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    const b2 = await scharf();
    for (let i = 0; i < 4; i++) expect(doc(`s${i}`)).toMatchObject({ status: 'pending', review: { rundeOffen: { preisBildschirm: { ablehnenGesperrt: true } } } });
    expect(b2).toMatchObject({ abgelehnt: 0, notbremse: { bildschirm: false, ausVortagen: { bildschirm: 4 } } });
    expect(b2.notbremse).not.toHaveProperty('ausVortagenAbgelehnt');
    expect(b2.warnungen.map((w) => w.code)).not.toContain('notbremse');
    expect(b2.warnungen.find((w) => w.code === 'notbremse_vortage_bildschirm')).toMatchObject({ stufe: 'gelb' });
  });

  // Befund 2 (Abschlussprüfung 06.10.2026), entschieden von Patrick am
  // 06.10.2026 („ja"): hält die Bremse mehrere Fälle an und entscheidet er nur
  // einen davon, warten die übrigen weiter auf ihn — sie werden nicht am
  // Morgen darauf automatisch abgelehnt, egal wie viele neue Fälle kommen.
  // (Vorher hielt dieser Test fest, dass die übrigen abgelehnt wurden.)
  it('Befund 2: Tag 1 Bremse hält 4, Tag 2 entscheidet Patrick einen, Tag 3 viele neue Fälle → die übrigen 3 bleiben liegen', async () => {
    schalter(true, 'shadow');
    for (let i = 0; i < 4; i++) schirm(i);
    const b1 = await scharf();
    expect(b1.notbremse.bildschirm).toBe(true);
    expect(b1.warnungen.find((w) => w.code === 'notbremse').text).toMatch(/Sie bleiben liegen, bis du sie in der Konsole entscheidest — auch einzeln/);
    expect(b1.warnungen.find((w) => w.code === 'notbremse').text).not.toMatch(/alle auf einmal|lässt die übrigen ablehnen/);
    // Tag 2: Patrick gibt s0 in der Konsole frei (das Modell las ein echtes Preisschild falsch).
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    mockStore.set('crowd_uploads/s0', { ...doc('s0'), status: 'approved', review: { decidedBy: 'admin', forced: false } });
    const b2 = await scharf();
    expect(doc('s0').status).toBe('approved');
    for (let i = 1; i < 4; i++) expect(doc(`s${i}`)).toMatchObject({ status: 'pending', review: { rundeOffen: { notbremseEcht: 'notbremse_preis_bildschirm', preisBildschirm: { ablehnenGesperrt: true, gesperrtSeit: b1.lauf } } } });
    expect(b2).toMatchObject({ abgelehnt: 0, notbremse: { bildschirm: false, ausVortagen: { bildschirm: 3 } } });
    expect(b2.warnungen.find((w) => w.code === 'notbremse_vortage_bildschirm').text)
      .toBe(`Notbremse: 3 Fälle (3 Personen, Bildschirmfoto als Preis) warten seit ${b1.lauf} auf deine Entscheidung in der Konsole.`);
    // Trockenlauf zwischendurch: plant keine Ablehnung, vermerkt nichts Neues.
    const vorTrocken = [1, 2, 3].map((i) => doc(`s${i}`).review.rundeOffen.preisBildschirm);
    const t = await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(t.notbremse).toMatchObject({ ausVortagen: { bildschirm: 3 } });
    for (let i = 1; i < 4; i++) {
      expect(doc(`s${i}`)).toMatchObject({ status: 'pending', review: { rundeOffen: { trocken: true } } });
      expect(doc(`s${i}`).review.rundeOffen).not.toHaveProperty('geplant');
      expect(doc(`s${i}`).review.rundeOffen.preisBildschirm).toEqual(vorTrocken[i - 1]);
    }
    // Tag 3: 200 unauffällige neue (die Kohorte allein läge weit unter der Schwelle)
    for (let i = 0; i < 200; i++) einreichung(`n${i}`, { uid: `n${i}`, ean: String(4100000000000 + i * 97) });
    dateSpy.mockImplementation(() => T0 + 2 * TAG_MS);
    const b3 = await scharf();
    for (let i = 1; i < 4; i++) expect(doc(`s${i}`)).toMatchObject({ status: 'pending', review: { rundeOffen: { trocken: false, notbremseEcht: 'notbremse_preis_bildschirm', preisBildschirm: { ablehnenGesperrt: true, gesperrtSeit: b1.lauf } } } });
    expect(doc('n0').status).toBe('approved');
    expect(b3).toMatchObject({ abgelehnt: 0, notbremse: { bildschirm: false, ausVortagen: { bildschirm: 3 } } });
    expect(b3.warnungen.map((w) => w.code)).not.toContain('notbremse');
    expect(b3.warnungen.filter((w) => w.code.startsWith('notbremse_vortage'))).toHaveLength(1);
    // Der Mensch kann weiter frei entscheiden: Ablehnung …
    mockStore.set('crowd_uploads/s1', { ...doc('s1'), status: 'rejected', rejectReason: 'fotos_unpassend', review: { decidedBy: 'admin', reason: 'preis_bildschirm' } });
    // … und Freigabe; danach wartet nur noch einer.
    mockStore.set('crowd_uploads/s2', { ...doc('s2'), status: 'approved', review: { decidedBy: 'admin', forced: false } });
    dateSpy.mockImplementation(() => T0 + 3 * TAG_MS);
    const b4 = await scharf();
    expect([doc('s1').status, doc('s2').status, doc('s3').status]).toEqual(['rejected', 'approved', 'pending']);
    expect(b4.notbremse).toMatchObject({ ausVortagen: { bildschirm: 1 } });
    expect(b4.warnungen.find((w) => w.code === 'notbremse_vortage_bildschirm').text).toMatch(/^Notbremse: 1 Fall \(1 Person, Bildschirmfoto als Preis\) wartet seit /);
  });

  // Befund 3: ein manueller Trockenlauf schreibt `review.rundeOffen`, aber nie
  // `ops_tagesberichte/aktuell`. Galt sein Eintrag als „schon gemeldet", fehlte
  // der Fingerabdruck des wahrscheinlichsten Modellfehlers im Morgen-Chat.
  it('Befund 3: manueller Trockenlauf vor der Morgenrunde → die Widerspruchs-Warnung steht trotzdem in `aktuell`', async () => {
    schalter(true, 'shadow');
    einreichung('ebon1', { priceImageKind: 'kassenbon' });
    mockQuelle.set(preisPfad('ebon1'), 'bildschirm'); mockKopf.set(preisPfad('ebon1'), png(1080, 2400));
    einreichung('ebon2', { ean: '4000000000017', priceImageKind: 'preisschild', priceReceipt: { merchant: 'Lidl', zip: '10115' } });
    mockQuelle.set(preisPfad('ebon2'), 'bildschirm'); mockKopf.set(preisPfad('ebon2'), png(1080, 2400));
    const t = await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(t.warnungen.map((w) => w.code)).toContain('preisquelle_bon_als_bildschirm');
    expect(doc('ebon1').review.rundeOffen).toMatchObject({ trocken: true, preisBildschirm: { befund: 'halten' } });
    expect(doc('ebon1').review.rundeOffen).not.toHaveProperty('preisBildschirmGemeldet');
    const b = await zeitplan(false);
    expect(b.preisBildschirm).toMatchObject({ bildschirmTrotzBon: 2, bildschirmTrotzBonAusVortagen: 0 });
    expect(mockStore.get('ops_tagesberichte/aktuell').warnungen.map((w) => w.code)).toContain('preisquelle_bon_als_bildschirm');
    // Danach gemeldet: ein Trockenlauf trägt das weiter, der nächste Morgen wiederholt die Warnung nicht.
    await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(doc('ebon1').review.rundeOffen).toMatchObject({ trocken: true, preisBildschirmGemeldet: b.lauf });
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    const b2 = await zeitplan(false);
    expect(b2.preisBildschirm).toMatchObject({ bildschirmTrotzBon: 0, bildschirmTrotzBonAusVortagen: 2 });
    expect(b2.warnungen.map((w) => w.code)).not.toContain('preisquelle_bon_als_bildschirm');
  });

  it('Befund 3, gleiche Klasse: ein Halt, den nur ein Trockenlauf gesehen hat, zählt am Morgen als heutiger Befund („hält viele" bleibt sichtbar)', async () => {
    schalter(true, 'shadow');
    // Fünf abfotografierte Bildschirme (Kamerafoto 4:3, „bildschirm") → je ein Halt.
    for (let i = 0; i < 5; i++) {
      einreichung(`k${i}`, { uid: `k${i}`, ean: String(4200000000000 + i * 97), priceImageKind: 'preisschild' });
      mockQuelle.set(preisPfad(`k${i}`, `k${i}`), 'bildschirm');
      mockKopf.set(preisPfad(`k${i}`, `k${i}`), jpeg(3000, 4000));
    }
    const t = await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(t.warnungen.map((w) => w.code)).toContain('preisquelle_haelt_viele');
    const b = await zeitplan(false);
    for (let i = 0; i < 5; i++) expect(doc(`k${i}`).status).toBe('pending');
    expect(b.preisBildschirm).toMatchObject({ befundHalten: 5, stattFreigabe: 5, ausVortagen: 0 });
    expect(mockStore.get('ops_tagesberichte/aktuell').warnungen.map((w) => w.code)).toContain('preisquelle_haelt_viele');
    // Am Morgen darauf (gemeldet): nur noch „aus Vortagen", keine Wiederholung.
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    const b2 = await zeitplan(false);
    expect(b2.preisBildschirm).toMatchObject({ befundHalten: 0, stattFreigabe: 0, ausVortagen: 5 });
    expect(b2.warnungen.map((w) => w.code)).not.toContain('preisquelle_haelt_viele');
  });
});

describe('Morgenrunde — Zeile „Produktsuche" (unbekannte Barcodes)', () => {
  // T0 = 03.10.2026 08:00 Berlin → Vortag 02.10.
  const GESTERN = '_meta/produktsuche_tage/tage/2026-10-02';

  it('Zahlen des Vortags stehen im Bericht, knappes Serper-Guthaben warnt', async () => {
    einreichung('frei');
    mockStore.set(GESTERN, { bearbeitet: 118, gefunden: 57, keineDaten: 49, fehler: 0, uebersprungen: 12, serperRest: 2500, kostenSchaetzungUsd: 1.89 });
    mockStore.set('external_lookup_misses/4006040000011', { status: 'pending' });
    mockStore.set('external_lookup_misses/4006040000028', { status: 'resolved' });
    const b = await scharf();
    expect(b.produktsuche).toMatchObject({ tag: '2026-10-02', wartend: 1, serperRest: 2500, unlesbar: false, gestern: { bearbeitet: 118, gefunden: 57 } });
    expect(b.produktsuche.zeile).toBe('Produktsuche gestern: 118 bearbeitet, 57 gefunden, 49 ohne Daten, 12 übersprungen, 0 Fehler · ≈ 1,89 $ · Serper-Rest 2.500');
    expect(b.warnungen.map((w) => w.code)).toContain('serper_knapp');
    // Derselbe Stand landet im gespeicherten Bericht (Dashboard + Morgen-Chat).
    const gespeichert = [...mockStore.entries()].find(([p]) => p.startsWith('ops_tagesberichte/'))[1];
    expect(gespeichert.produktsuche.zeile).toBe(b.produktsuche.zeile);
  });

  it('Lesefehler kostet den Bericht nicht — nur eine gelbe Warnung', async () => {
    einreichung('frei');
    const orig = mockDb.doc;
    mockDb.doc = (pfad) => (pfad.startsWith('_meta/') ? { get: async () => { throw new Error('UNAVAILABLE'); } } : orig(pfad));
    try {
      const b = await scharf();
      expect(doc('frei').status).toBe('approved');
      expect(b.produktsuche).toMatchObject({ unlesbar: true });
      expect(b.warnungen.find((w) => w.code === 'produktsuche_unbekannt')).toMatchObject({ stufe: 'gelb' });
    } finally { mockDb.doc = orig; }
  });
});

describe('Barcode-Korrektur (Entscheidung Patrick 06.10.2026: „ja")', () => {
  const GESTERN = '2026-10-05_080000';
  /** Gültige GTIN-13 aus 12 Ziffern (Prüfziffer angehängt). */
  const gtin = (zwoelf) => {
    const z = zwoelf.split('').map(Number);
    const s = z.reverse().reduce((a, v, i) => a + v * (i % 2 === 0 ? 3 : 1), 0);
    return zwoelf + ((10 - (s % 10)) % 10);
  };

  it('zweimal gleich gelesen, gültig, kein Waagen-Code → korrigiert, freigegeben; `ean` bleibt die gespeicherte (Audit)', async () => {
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    const b = await scharf();
    expect(doc('k').status).toBe('approved');
    expect(doc('k').ean).toBe(EAN);
    expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, vorher: EAN, lesungen: [ANDERE, ANDERE], aus: 'heute', lauf: b.lauf, at: mockSentinel });
    expect(doc('k').eanKorrektur.regel).toMatch(/Barcode-Korrektur 06\.10\.2026/);
    expect(doc('k').eanKorrektur.regel).not.toMatch(/Patrick/); // Dokument liest der Einreicher selbst
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: ANDERE, befund: 'korrigiert', vorher: EAN, korrekturAus: 'heute' });
    // Korrektur und Befund in EINEM Schreibvorgang
    const w = mockWrites.find((x) => x.path === 'crowd_uploads/k' && x.data.eanKorrektur);
    expect(w.data.eanFotoOcr).toBeDefined();
    // Die Freigabe stützt sich auf die korrigierte Nummer (Doppel-Befund mit ihr gerechnet)
    expect(b).toMatchObject({ freigegeben: 1, offen: 0, eanFoto: { korrigiert: 1 }, notbremse: { korrektur: false } });
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 1, ausHeute: 1, ausVorbefund: 0, gebremst: false, faelle: [{ id: 'k', vorher: EAN, neu: ANDERE, aus: 'heute', entscheidung: 'freigeben' }] });
    expect(b.offenGruende).toEqual({});
  });

  it('… und die Wochen-Sperre rechnet danach mit der korrigierten Nummer: eine spätere Einreichung mit der RICHTIGEN Nummer wird gesperrt', async () => {
    einreichung('k', { createdAt: T0 - 2 * TAG_MS });
    mockAudit.set(doc('k').images.ean, ANDERE);
    await scharf();
    expect(doc('k').status).toBe('approved');
    einreichung('spaeter', { ean: ANDERE, createdAt: T0 - TAG_MS });
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    await scharf();
    expect(doc('spaeter')).toMatchObject({ status: 'rejected', rejectReason: 'doppelt_eingereicht' });
    expect(doc('spaeter').review.precheck.dup).toMatchObject({ verdict: 'locked', priorId: 'k' });
  });

  it('… eine spätere Einreichung mit derselben FALSCHEN Nummer (Scanner liest wieder falsch) wird ebenfalls korrigiert und dann gesperrt', async () => {
    einreichung('k', { createdAt: T0 - 2 * TAG_MS });
    mockAudit.set(doc('k').images.ean, ANDERE);
    await scharf();
    einreichung('spaeter', { createdAt: T0 - TAG_MS });
    mockAudit.set(doc('spaeter').images.ean, ANDERE);
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    await scharf();
    expect(doc('spaeter')).toMatchObject({ status: 'rejected', rejectReason: 'doppelt_eingereicht' });
    expect(doc('spaeter').eanKorrektur).toMatchObject({ ean: ANDERE, vorher: EAN });
  });

  it('zwei offene eigene Einreichungen, beide mit derselben falschen Nummer → die ältere wird freigegeben, die jüngere als Wochen-Doppel abgelehnt (gleicher Lauf)', async () => {
    einreichung('a', { createdAt: T0 - 2 * TAG_MS });
    einreichung('b', { createdAt: T0 - TAG_MS });
    mockAudit.set(doc('a').images.ean, ANDERE);
    mockAudit.set(doc('b').images.ean, ANDERE);
    await scharf();
    expect(doc('a').status).toBe('approved');
    expect(doc('b')).toMatchObject({ status: 'rejected', rejectReason: 'doppelt_eingereicht' });
  });

  it('ältere eigene Einreichung unter der ALTEN Nummer, im selben Lauf abgelehnt → unter der alten Nummer bleibt nichts, korrigiert und freigegeben', async () => {
    einreichung('alt', { createdAt: T0 - 3 * TAG_MS });
    mockStore.set('crowd_uploads/alt', { ...doc('alt'), images: { front: 'x/front.jpg' } }); // unvollständig → wird abgelehnt
    mockListe.set('x/front.jpg', { md5: 'md5_x_front', size: 1234 });
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    const b = await scharf();
    expect(doc('alt')).toMatchObject({ status: 'rejected', rejectReason: 'unvollstaendig' });
    // abgelehnt im selben Lauf → unter der alten Nummer bleibt nichts Bezahltes oder Offenes
    expect(doc('k').status).toBe('approved');
    expect(b.eanKorrektur.korrigiert).toBe(1);
  });

  it('… bleibt die ältere unter der alten Nummer offen (Datei nicht abrufbar) → korrigiert, aber liegen lassen (ean_alt_doppelt), bis sie entschieden ist', async () => {
    einreichung('alt', { createdAt: T0 - 3 * TAG_MS });
    mockListe.delete(doc('alt').images.front); // Datei nicht abrufbar → bleibt offen (Technik)
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    const b = await scharf();
    expect(doc('alt').status).toBe('pending');
    expect(doc('k').status).toBe('pending');
    const f = b.wartetAufDich.find((x) => x.id === 'k');
    expect(f).toMatchObject({ grund: 'ean_alt_doppelt' });
    expect(f.hinweis).toMatch(/ältere eigene, noch offene Einreichung/);
  });

  it('Waagen-Code auf dem Foto (zweimal gleich) gegen gespeicherten Hersteller-Barcode → KEINE Korrektur, bleibt liegen (ean_abweichend)', async () => {
    einreichung('k');
    const waage = gtin('211234500150');
    mockAudit.set(doc('k').images.ean, waage);
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanKorrektur).toBeUndefined();
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: waage, befund: 'abweichend', bestaetigt: true });
    expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_abweichend' });
    expect(b.eanKorrektur.korrigiert).toBe(0);
  });

  it('zweite Lesung uneinig oder leer → KEINE Korrektur (ean_unsicher bleibt beim Menschen)', async () => {
    einreichung('a');
    einreichung('b', { uid: 'u2' });
    mockAudit.set(doc('a').images.ean, ANDERE);
    mockZweit.set(doc('a').images.ean, '4001382088125');
    mockAudit.set(doc('b').images.ean, ANDERE);
    mockZweit.set(doc('b').images.ean, '');
    const b = await scharf();
    for (const id of ['a', 'b']) {
      expect(doc(id).status).toBe('pending');
      expect(doc(id).eanKorrektur).toBeUndefined();
    }
    expect(b.offenGruende).toEqual({ ean_unsicher: 2 });
  });

  it('Korrektur nicht speicherbar → gilt nicht: der Fall liegt wie bisher (ean_abweichend), Halte-Grund am Dokument, gelbe Warnung', async () => {
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    mockLage.txUpdateFehler = (pfad, daten) => !!daten.eanKorrektur;
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanKorrektur).toBeUndefined();
    expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_abweichend' });
    expect(doc('k').review.rundeOffen).toMatchObject({ sperrend: ['ean_abweichend'], eanFoto: { befund: 'abweichend', ean: ANDERE, bestaetigt: true } });
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 0, nichtGespeichert: 1 });
    expect(b.warnungen.map((w) => w.code)).toEqual(expect.arrayContaining(['barcode_korrektur_nicht_gespeichert', 'barcode_befund_nicht_gespeichert']));
    // nächster Morgen: Speichern geht wieder → aus dem Halte-Befund (review.rundeOffen) korrigiert
    mockLage.txUpdateFehler = () => false;
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    const b2 = await scharf();
    expect(doc('k').status).toBe('approved');
    expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, vorher: EAN });
    expect(b2.eanKorrektur).toMatchObject({ korrigiert: 1 });
  });

  it('Korrektur steht beim Schreiben der Entscheidung nicht am Dokument → nicht entschieden, liegt mit Barcode-Befund (fail-closed)', async () => {
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    const orig = mockDb.runTransaction;
    mockDb.runTransaction = async (fn) => {
      const x = doc('k');
      if (x && x.eanKorrektur && x.status === 'pending' && !x.review) { const { eanKorrektur, ...rest } = x; mockStore.set('crowd_uploads/k', rest); }
      return orig(fn);
    };
    try {
      const b = await scharf();
      expect(doc('k').status).toBe('pending');
      expect(b.offenGruende).toEqual({ ean_korrektur_fehlt: 1 });
      expect(doc('k').review.rundeOffen).toMatchObject({ sperrend: ['ean_abweichend'] });
      expect(b.eanKorrektur.korrigiert).toBe(0);
    } finally { mockDb.runTransaction = orig; }
  });

  describe('schon angehaltene Fälle (Halte-Befund eines früheren Laufs)', () => {
    // Vom Code seit der Korrektur geschrieben: mit Vermerk und beiden Lesungen (vertraut, werte.eanFotoHalteQuellen).
    const gestern = (extra = {}) => ({ eanFotoOcr: { ean: ANDERE, befund: 'abweichend', bestaetigt: true, zweit: ANDERE, korrekturfaehig: true, lauf: GESTERN, ...extra } });

    it('gestern zweimal gleich, heute nicht lesbar, der Strichcode-Leser liest die Foto-Nummer → korrigiert aus dem alten Befund, freigegeben', async () => {
      einreichung('k', gestern());
      mockAudit.set(doc('k').images.ean, '');
      striche('k', ANDERE);
      const b = await scharf();
      expect(doc('k').status).toBe('approved');
      expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, vorher: EAN, aus: 'vorbefund', befundVom: GESTERN, zeuge: { art: 'striche', gelesen: [ANDERE], leser: 'zxing-wasm 2.2.4' } });
      expect(b.eanKorrektur).toMatchObject({ korrigiert: 1, ausHeute: 0, ausVorbefund: 1 });
      expect(b.eanFotoVorbefund).toEqual({ haelt: 0 });
    });

    it('… der Leser liest heute nichts, die gespeicherte oder scheitert → KEINE Korrektur aus dem alten Befund (Prüfrunde 06.10., Pflicht-Zeuge)', async () => {
      for (const ergebnis of [{ gelesen: [] }, { gelesen: [EAN] }, { fehler: 'download: 503' }]) {
        mockStore.clear(); mockWrites.length = 0; mockStriche.clear();
        mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true });
        einreichung('k', gestern());
        mockAudit.set(doc('k').images.ean, '');
        mockStriche.set(doc('k').images.ean, ergebnis);
        const b = await scharf();
        // Liest er genau die gespeicherte: Halt aufgehoben, keine Korrektur (09.10.2026).
        if (ergebnis.gelesen && ergebnis.gelesen[0] === EAN) { gleichDurchLeser('k'); continue; }
        expect(doc('k').status).toBe('pending');
        expect(doc('k').eanKorrektur).toBeUndefined();
        expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_abweichend' });
        expect(b.wartetAufDich[0].hinweis).toMatch(/Strichcode-Leser/);
      }
    });

    it('… heute dieselbe Nummer → korrigiert', async () => {
      einreichung('k', gestern());
      mockAudit.set(doc('k').images.ean, ANDERE);
      await scharf();
      expect(doc('k').status).toBe('approved');
      expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE });
    });

    it('… heute die GESPEICHERTE Nummer, eine dritte, oder eine Lesung mit falscher Prüfziffer → widerspricht: keine Korrektur, bleibt beim Menschen', async () => {
      for (const heute of [EAN, '4001382088125', '4061464833820']) {
        mockStore.clear(); mockWrites.length = 0;
        mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true });
        einreichung('k', gestern());
        mockAudit.set(doc('k').images.ean, heute);
        const b = await scharf();
        // Der Leser (Mock: liest, was das Modell liest) liest die gespeicherte → Halt aufgehoben (09.10.2026).
        if (heute === EAN) { gleichDurchLeser('k'); continue; }
        expect(doc('k').status).toBe('pending');
        expect(doc('k').eanKorrektur).toBeUndefined();
        expect(b.wartetAufDich[0].grund).toMatch(/^ean_/);
      }
    });

    it('… gestern unbestätigt oder unsicher → keine Korrektur', async () => {
      for (const v of [gestern({ bestaetigt: false }), { eanFotoOcr: { ean: ANDERE, befund: 'unsicher', zweit: null, lauf: GESTERN } }]) {
        mockStore.clear(); mockWrites.length = 0;
        mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true });
        einreichung('k', v);
        mockAudit.set(doc('k').images.ean, '');
        await scharf();
        expect(doc('k').status).toBe('pending');
        expect(doc('k').eanKorrektur).toBeUndefined();
      }
    });

    it('… zwei Quellen uneinig (eanFotoOcr sagt X bestätigt, review.rundeOffen eine andere Nummer) → keine Korrektur (fail-closed)', async () => {
      einreichung('k', { ...gestern(), review: { rundeOffen: { lauf: GESTERN, eanFoto: { befund: 'abweichend', ean: '4001382088125', bestaetigt: true } } } });
      mockAudit.set(doc('k').images.ean, '');
      await scharf();
      expect(doc('k').status).toBe('pending');
      expect(doc('k').eanKorrektur).toBeUndefined();
    });
  });

  describe('nach einer Korrektur (Fall blieb offen)', () => {
    const korrigiert = { eanKorrektur: { ean: ANDERE, vorher: EAN, aus: 'heute', lauf: GESTERN, zeuge: { art: 'striche', gelesen: [ANDERE] } }, eanFotoOcr: { ean: ANDERE, befund: 'korrigiert', vorher: EAN, lauf: GESTERN } };

    it('heute bestätigt das Foto die korrigierte Nummer → kein Halt, freigegeben; keine zweite Korrektur', async () => {
      einreichung('k', korrigiert);
      mockAudit.set(doc('k').images.ean, ANDERE);
      const b = await scharf();
      expect(doc('k').status).toBe('approved');
      expect(mockLage.zweitLesungen).toEqual([]);
      expect(b.eanFoto).toEqual({ gleich: 1 });
      expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, vorher: EAN, lauf: GESTERN });
    });

    it('heute zeigt das Foto zweimal eine DRITTE Nummer → keine zweite Korrektur, hält (Lesungen über Tage uneinig: gestern zweimal die korrigierte, heute die dritte)', async () => {
      // Bis zur Prüfrunde 06.10. (Befund „frühere Lesung") hielt das als `ean_abweichend`; jetzt als
      // `ean_unsicher` — die frühere gültige Foto-Lesung widerspricht der heutigen (werte.eanFotoGegenFrueher).
      einreichung('k', korrigiert);
      mockAudit.set(doc('k').images.ean, '4001382088125');
      const b = await scharf();
      expect(doc('k').status).toBe('pending');
      expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE });
      expect(doc('k').eanFotoOcr).toMatchObject({ ean: '4001382088125', befund: 'unsicher', grund: 'lesungen_uneinig_tage' });
      expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_unsicher' });
      expect(b.wartetAufDich[0].hinweis).toMatch(new RegExp(`am ${GESTERN} ${ANDERE} gelesen, heute abweichend \\(4001382088125\\), gespeichert ist ${ANDERE}`));
      // Keine zweite Korrektur; der Leser läuft nur für 4d (Bestätigung der gespeicherten Nummer, 09.10.2026) und liest sie nicht.
      expect(mockLage.leserAufrufe).toEqual([doc('k').images.ean]);
      expect(b.eanKorrektur.leser).toEqual({ bestaetigt: 0, widerspricht: 0, nicht_gelesen: 0, fehler: 0 });
    });

    it('alter Rückfall in review.rundeOffen (der Befund, aus dem die Korrektur entstand) hält NICHT mehr', async () => {
      einreichung('k', { ...korrigiert, review: { rundeOffen: { lauf: GESTERN, eanFoto: { befund: 'abweichend', ean: ANDERE, bestaetigt: true }, sperrend: ['ean_abweichend'] } } });
      mockAudit.set(doc('k').images.ean, '');
      await scharf();
      expect(doc('k').status).toBe('approved');
    });
  });

  it('Notbremse: korrigiert die Runde heute auffällig viel (≥ 8 und > 10 %) → KEINE Korrektur, alle liegen wie früher, rote Warnung', async () => {
    for (let i = 0; i < 8; i++) {
      einreichung(`k${i}`, { uid: `u${i}` });
      mockAudit.set(doc(`k${i}`).images.ean, gtin(`40013820881${i}`));
    }
    const b = await scharf();
    for (let i = 0; i < 8; i++) {
      expect(doc(`k${i}`).status).toBe('pending');
      expect(doc(`k${i}`).eanKorrektur).toBeUndefined();
    }
    expect(b.offenGruende).toEqual({ ean_abweichend: 8 });
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 0, gebremst: true, gebremstAnzahl: 8 });
    expect(b.notbremse.korrektur).toBe(true);
    expect(b.warnungen.find((w) => w.code === 'barcode_korrektur_gebremst')).toMatchObject({ stufe: 'rot' });
  });

  it('… 7 von vielen geprüften → keine Bremse', async () => {
    for (let i = 0; i < 7; i++) {
      einreichung(`k${i}`, { uid: `u${i}` });
      mockAudit.set(doc(`k${i}`).images.ean, gtin(`40013820881${i}`));
    }
    const b = await scharf();
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 7, gebremst: false });
  });

  it('nurLesen: Korrektur nur im Speicher — kein Schreibvorgang, der Plan rechnet mit der korrigierten Nummer', async () => {
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    const r = await taeglicheRunde({ projekt: 'p', bucketName: 'b', nurLesen: true });
    expect(mockWrites).toEqual([]);
    expect(doc('k').eanKorrektur).toBeUndefined();
    expect(r.plan[0]).toMatchObject({ id: 'k', entscheidung: 'freigeben', policy: { ean: ANDERE }, eingabe: { eanFoto: { art: 'korrigiert', gelesen: ANDERE, gespeichert: EAN } } });
    expect(r.eanKorrektur).toMatchObject({ korrigiert: 1, faelle: [{ id: 'k', vorher: EAN, neu: ANDERE }] });
  });

  it('Trockenlauf (Schalter aus): die Korrektur wird NICHT gespeichert, der Halt bleibt in der Konsole; der nächste scharfe Lauf korrigiert (Prüfrunde 06.10.)', async () => {
    mockStore.set('cashback_config/v1', { fotoWorker: false, barcodeKorrektur: true });
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    const b = await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanKorrektur).toBeUndefined();
    expect(mockWrites.some((w) => w.path.startsWith('crowd_uploads/') && w.data.eanKorrektur)).toBe(false);
    // der Befund davor ist abgelegt (Tatsache über die Fotos) …
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: ANDERE, befund: 'abweichend', bestaetigt: true });
    // … und die Konsole hält weiter an; `geplant` sagt, was die Runde täte
    expect(doc('k').review.rundeOffen).toMatchObject({ geplant: 'freigeben', sperrend: ['ean_abweichend'], eanFoto: { befund: 'abweichend', ean: ANDERE, bestaetigt: true }, trocken: true });
    // der Bericht zeigt die geplante Korrektur
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 1, gespeichert: false, faelle: [{ id: 'k', vorher: EAN, neu: ANDERE, entscheidung: 'freigeben' }] });
    // Schalter an, nächster Morgen, Foto unlesbar, der Leser liest die Striche → aus dem alten Befund korrigiert, freigegeben
    mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true });
    mockAudit.set(doc('k').images.ean, '');
    striche('k', ANDERE);
    dateSpy.mockImplementation(() => T0 + TAG_MS);
    await scharf();
    expect(doc('k').status).toBe('approved');
    expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, vorher: EAN, aus: 'vorbefund' });
  });

  it('… ein bestehender Halt in der Konsole bleibt im Trockenlauf stehen (geplante Korrektur aus dem alten Befund)', async () => {
    mockStore.set('cashback_config/v1', { fotoWorker: false, barcodeKorrektur: true });
    // Mit Vermerk (vom neuen Code geschrieben) — ohne Vermerk aus GESTERN gälte er als Befund des alten Codes (gebremst, Prüfrunde 06.10.).
    einreichung('k', { eanFotoOcr: { ean: ANDERE, befund: 'abweichend', bestaetigt: true, zweit: ANDERE, korrekturfaehig: true, lauf: GESTERN }, review: { rundeOffen: { lauf: GESTERN, grund: 'ean_abweichend', sperrend: ['ean_abweichend'], eanFoto: { befund: 'abweichend', ean: ANDERE, bestaetigt: true, zweit: ANDERE, korrekturfaehig: true } } } });
    mockAudit.set(doc('k').images.ean, ANDERE);
    await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(doc('k').eanKorrektur).toBeUndefined();
    expect(doc('k').review.rundeOffen).toMatchObject({ sperrend: ['ean_abweichend'], geplant: 'freigeben' });
  });
});

describe('Prüfrunde 06.10.2026 zur Barcode-Korrektur: Lücken über mehrere Läufe', () => {
  const GESTERN = '2026-10-05_080000';
  const DRITTE = '4001382088125';
  const morgen = (n = 1) => dateSpy.mockImplementation(() => T0 + n * TAG_MS);
  const gtin = (zwoelf) => {
    const z = zwoelf.split('').map(Number);
    const s = z.reverse().reduce((a, v, i) => a + v * (i % 2 === 0 ? 3 : 1), 0);
    return zwoelf + ((10 - (s % 10)) % 10);
  };

  describe('Doppel-Regel über verwandte Nummern (ean_alt_doppelt) gilt an JEDEM Tag', () => {
    it('eigene Freigabe unter der gespeicherten Nummer: Tag 1 liegen, Tag 2 WEITER liegen (vorher am Folgetag freigegeben)', async () => {
      einreichung('alt', { status: 'approved', createdAt: T0 - 3 * TAG_MS });
      einreichung('k');
      mockAudit.set(doc('k').images.ean, ANDERE);
      const b1 = await scharf();
      expect(doc('k').status).toBe('pending');
      expect(b1.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_alt_doppelt' });
      expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, vorher: EAN });
      morgen();
      const b2 = await scharf(); // heute bestätigt das Foto die korrigierte Nummer („gleich")
      expect(doc('k').status).toBe('pending');
      expect(b2.wartetAufDich.find((x) => x.id === 'k')).toMatchObject({ grund: 'ean_alt_doppelt' });
      expect(b2.wartetAufDich.find((x) => x.id === 'k').hinweis).toMatch(new RegExp(`Barcode früher korrigiert: gespeichert ist ${EAN}, es gilt ${ANDERE} — eigene Freigabe vom`));
      expect(doc('k').review.rundeOffen).toMatchObject({ sperrend: ['ean_alt_doppelt'] });
    });

    it('ältere eigene unter der gespeicherten Nummer offen: Tag 1 liegen; Tag 2 wird sie freigegeben → die korrigierte bleibt liegen (nicht doppelt bezahlt)', async () => {
      einreichung('alt', { createdAt: T0 - 3 * TAG_MS });
      const front = doc('alt').images.front;
      const meta = mockListe.get(front);
      mockListe.delete(front); // Datei nicht abrufbar → bleibt offen (Technik)
      einreichung('k');
      mockAudit.set(doc('k').images.ean, ANDERE);
      await scharf();
      expect(doc('alt').status).toBe('pending');
      expect(doc('k').status).toBe('pending');
      mockListe.set(front, meta); // Tag 2: Datei wieder da
      morgen();
      await scharf();
      expect(doc('alt').status).toBe('approved');
      expect(doc('k').status).toBe('pending');
      expect(doc('k').review.rundeOffen).toMatchObject({ grund: 'ean_alt_doppelt', sperrend: ['ean_alt_doppelt'] });
    });

    it('… Gegenprobe: wird die ältere stattdessen abgelehnt, gibt Tag 2 die korrigierte frei', async () => {
      einreichung('alt', { createdAt: T0 - 3 * TAG_MS });
      mockListe.delete(doc('alt').images.front);
      einreichung('k');
      mockAudit.set(doc('k').images.ean, ANDERE);
      await scharf();
      expect(doc('k').status).toBe('pending');
      mockStore.set('crowd_uploads/alt', { ...doc('alt'), status: 'rejected', rejectReason: 'unvollstaendig' });
      morgen();
      await scharf();
      expect(doc('k').status).toBe('approved');
    });

    it('frühere eigene Freigabe wurde VON dieser Nummer weg korrigiert, die neue trägt wieder die falsche Nummer, Foto unlesbar → liegen (vorher freigegeben)', async () => {
      einreichung('k', { createdAt: T0 - 2 * TAG_MS });
      mockAudit.set(doc('k').images.ean, ANDERE);
      await scharf();
      expect(doc('k').status).toBe('approved');
      einreichung('k2', { createdAt: T0 });
      mockAudit.set(doc('k2').images.ean, ''); // Foto heute unlesbar → kein Barcode-Befund
      morgen();
      const b = await scharf();
      expect(doc('k2').status).toBe('pending');
      const f = b.wartetAufDich.find((x) => x.id === 'k2');
      expect(f).toMatchObject({ grund: 'ean_alt_doppelt' });
      expect(f.hinweis).toMatch(new RegExp(`gespeichert ${EAN}, korrigiert auf ${ANDERE}`));
      expect(doc('k2').review.rundeOffen).toMatchObject({ sperrend: ['ean_alt_doppelt'] });
    });

    it('… Gegenprobe: dieselbe Lage bei einem FREMDEN Konto sperrt nichts', async () => {
      einreichung('k', { createdAt: T0 - 2 * TAG_MS });
      mockAudit.set(doc('k').images.ean, ANDERE);
      await scharf();
      einreichung('k2', { uid: 'u2', createdAt: T0 });
      mockAudit.set(doc('k2').images.ean, '');
      morgen();
      await scharf();
      expect(doc('k2').status).toBe('approved');
    });

    it('zwei eigene Einreichungen mit derselben FALSCHEN Nummer, auf verschiedene Nummern korrigiert → die zweite liegt (fremden Strichcode fotografiert?)', async () => {
      einreichung('s1', { createdAt: T0 - 2 * TAG_MS });
      mockAudit.set(doc('s1').images.ean, ANDERE);
      await scharf();
      expect(doc('s1').status).toBe('approved');
      einreichung('s2', { createdAt: T0 });
      mockAudit.set(doc('s2').images.ean, DRITTE);
      morgen();
      const b = await scharf();
      expect(doc('s2').eanKorrektur).toMatchObject({ ean: DRITTE, vorher: EAN });
      expect(doc('s2').status).toBe('pending');
      expect(b.wartetAufDich.find((x) => x.id === 's2')).toMatchObject({ grund: 'ean_alt_doppelt' });
    });
  });

  describe('Notbremse der Korrektur hält über Tage', () => {
    it('Tag 1 gebremst, Tag 2 dieselben Lesungen → 0 Korrekturen, Vermerk bleibt, alle liegen', async () => {
      for (let i = 0; i < 8; i++) {
        einreichung(`k${i}`, { uid: `u${i}` });
        mockAudit.set(doc(`k${i}`).images.ean, gtin(`40013820881${i}`));
      }
      const b1 = await scharf();
      expect(b1.eanKorrektur).toMatchObject({ korrigiert: 0, gebremst: true, gebremstAnzahl: 8 });
      for (let i = 0; i < 8; i++) expect(doc(`k${i}`).eanFotoOcr).toMatchObject({ befund: 'abweichend', bestaetigt: true, korrekturGebremst: b1.lauf });
      expect(doc('k0').review.rundeOffen.eanFoto).toMatchObject({ korrekturGebremst: b1.lauf });
      morgen();
      const b2 = await scharf();
      for (let i = 0; i < 8; i++) {
        expect(doc(`k${i}`).status).toBe('pending');
        expect(doc(`k${i}`).eanKorrektur).toBeUndefined();
        expect(doc(`k${i}`).eanFotoOcr).toMatchObject({ korrekturGebremst: b1.lauf });
      }
      expect(b2.eanKorrektur).toMatchObject({ korrigiert: 0, ausVorbefund: 0, gebremstHaelt: 8 });
      expect(b2.warnungen.find((w) => w.code === 'barcode_korrektur_gebremst_wartet')).toMatchObject({ stufe: 'gelb' });
      expect(b2.offenGruende).toEqual({ ean_abweichend: 8 });
      expect(b2.wartetAufDich[0].hinweis).toMatch(/von der Notbremse angehalten/);
    });

    it('… auch wenn Tag 2 die Bildprüfung nichts lesen kann (Vermerk am übernommenen Befund)', async () => {
      for (let i = 0; i < 8; i++) {
        einreichung(`k${i}`, { uid: `u${i}` });
        mockAudit.set(doc(`k${i}`).images.ean, gtin(`40013820881${i}`));
      }
      await scharf();
      for (let i = 0; i < 8; i++) mockAudit.set(doc(`k${i}`).images.ean, '');
      morgen();
      const b2 = await scharf();
      expect(b2.eanKorrektur).toMatchObject({ korrigiert: 0 });
      for (let i = 0; i < 8; i++) expect(doc(`k${i}`).status).toBe('pending');
    });

    it('Prüfrunde 06.10. (Ausrollen): 8 bestätigte Altfälle + 80 frische, davon 4 Abweichungen → KEINE Bremse, 12 Korrekturen (Quote nur über frische Fälle)', async () => {
      for (let i = 0; i < 8; i++) {
        const n = gtin(`40013820881${i}`);
        einreichung(`v${i}`, { uid: `v${i}`, eanFotoOcr: { ean: n, befund: 'abweichend', bestaetigt: true, zweit: n, korrekturfaehig: true, lauf: GESTERN } });
        mockAudit.set(doc(`v${i}`).images.ean, '');
        striche(`v${i}`, n);
      }
      for (let i = 0; i < 80; i++) {
        einreichung(`f${i}`, { uid: `f${i}`, ean: gtin(`40012345${String(i).padStart(4, '0')}`) });
        if (i < 4) mockAudit.set(doc(`f${i}`).images.ean, gtin(`40099999000${i}`));
      }
      const b = await scharf();
      expect(b.eanKorrektur).toMatchObject({ korrigiert: 12, ausHeute: 4, ausVorbefund: 8, gebremst: false, quote: { korrigiert: 4, geprueft: 80 } });
      for (let i = 0; i < 8; i++) expect(doc(`v${i}`).eanKorrektur).toMatchObject({ aus: 'vorbefund' });
      expect(b.warnungen.map((w) => w.code)).not.toContain('barcode_korrektur_gebremst');
    });

    it('… vorher (alle geplanten über alle geprüften) hätte schon das Ausrollen die Bremse gezogen: 8 Altfälle + 20 saubere frische → trotzdem KEINE Bremse', async () => {
      for (let i = 0; i < 8; i++) {
        const n = gtin(`40013820881${i}`);
        einreichung(`v${i}`, { uid: `v${i}`, eanFotoOcr: { ean: n, befund: 'abweichend', bestaetigt: true, zweit: n, korrekturfaehig: true, lauf: GESTERN } });
        mockAudit.set(doc(`v${i}`).images.ean, '');
        striche(`v${i}`, n);
      }
      for (let i = 0; i < 20; i++) einreichung(`f${i}`, { uid: `f${i}`, ean: gtin(`40012345${String(i).padStart(4, '0')}`) });
      const b = await scharf(); // 8 von 28 = 29 % — mit dem alten Nenner gebremst, für immer
      expect(b.eanKorrektur).toMatchObject({ korrigiert: 8, gebremst: false, quote: { korrigiert: 0, geprueft: 20 } });
    });

    it('frische Fälle schlagen an (8 von 10 neu geprüften) → ALLE gebremst, auch die aus alten Befunden, Vermerk am Befund', async () => {
      for (let i = 0; i < 5; i++) {
        const n = gtin(`40013820881${i}`);
        einreichung(`v${i}`, { uid: `v${i}`, eanFotoOcr: { ean: n, befund: 'abweichend', bestaetigt: true, zweit: n, korrekturfaehig: true, lauf: GESTERN } });
        mockAudit.set(doc(`v${i}`).images.ean, '');
      }
      for (let i = 0; i < 10; i++) {
        einreichung(`h${i}`, { uid: `h${i}`, ean: gtin(`40012345${String(i).padStart(4, '0')}`) });
        if (i < 8) mockAudit.set(doc(`h${i}`).images.ean, gtin(`40099999000${i}`));
      }
      const b = await scharf();
      expect(b.eanKorrektur).toMatchObject({ korrigiert: 0, gebremst: true, gebremstAnzahl: 13, gebremstVermerkt: true, quote: { korrigiert: 8, geprueft: 10 } });
      expect(doc('v0').eanFotoOcr).toMatchObject({ befund: 'abweichend', korrekturGebremst: b.lauf });
      expect(doc('h0').eanFotoOcr).toMatchObject({ befund: 'abweichend', korrekturGebremst: b.lauf });
      const w = b.warnungen.find((x) => x.code === 'barcode_korrektur_gebremst');
      expect(w).toMatchObject({ stufe: 'rot' });
      expect(w.text).toMatch(/8 von 10 neu geprüften/);
    });

    it('Trockenlauf mit ausgelöster Bremse → KEIN Vermerk am Dokument; die heute gelesenen Befunde sind nur nicht vertraut; der nächste scharfe Lauf korrigiert nach neuer doppelter Lesung', async () => {
      mockStore.set('cashback_config/v1', { fotoWorker: false, barcodeKorrektur: true });
      for (let i = 0; i < 8; i++) {
        einreichung(`k${i}`, { uid: `u${i}` });
        mockAudit.set(doc(`k${i}`).images.ean, gtin(`40013820881${i}`));
      }
      const b1 = await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
      expect(b1.eanKorrektur).toMatchObject({ korrigiert: 0, gebremst: true, gebremstVermerkt: false });
      for (let i = 0; i < 8; i++) {
        expect(doc(`k${i}`).eanFotoOcr).toMatchObject({ befund: 'abweichend', bestaetigt: true, korrekturfaehig: false });
        expect(doc(`k${i}`).eanFotoOcr.korrekturGebremst).toBeUndefined();
        expect(doc(`k${i}`).review.rundeOffen.eanFoto).toMatchObject({ korrekturfaehig: false });
        expect(doc(`k${i}`).review.rundeOffen.eanFoto.korrekturGebremst).toBeUndefined();
      }
      expect(b1.warnungen.find((w) => w.code === 'barcode_korrektur_gebremst').text).toMatch(/Trockenlauf/);
      // nächster Morgen, scharf: Foto unlesbar → KEINE Korrektur (Befund des gebremsten Tages nicht vertraut)
      mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true });
      for (let i = 0; i < 8; i++) mockAudit.set(doc(`k${i}`).images.ean, '');
      morgen();
      const b2 = await scharf();
      expect(b2.eanKorrektur).toMatchObject({ korrigiert: 0 });
      for (let i = 0; i < 8; i++) expect(doc(`k${i}`).status).toBe('pending');
      // übermorgen: dieselbe Nummer heute zweimal gelesen → korrigiert (aus dem alten Befund, heute bestätigt)
      for (let i = 0; i < 8; i++) mockAudit.set(doc(`k${i}`).images.ean, gtin(`40013820881${i}`));
      morgen(2);
      const b3 = await scharf();
      expect(b3.eanKorrektur).toMatchObject({ korrigiert: 8, ausVorbefund: 8, gebremst: false });
      expect(doc('k0').eanKorrektur).toMatchObject({ aus: 'vorbefund', heuteBestaetigt: true });
    });
  });

  describe('Widerspruch an einem Zwischentag bleibt festgehalten', () => {
    const halt = { eanFotoOcr: { ean: ANDERE, befund: 'abweichend', bestaetigt: true, zweit: ANDERE, korrekturfaehig: true, lauf: GESTERN } };

    it('2a: Halt (ANDERE zweimal), Tag 1 liest die gespeicherte, Tag 2 nichts lesbar → nie korrigiert', async () => {
      einreichung('k', halt);
      striche('k'); // Strichcode-Leser liest nichts — sonst hebt 4d den Halt auf (eigener Test unten, 09.10.2026)
      mockAudit.set(doc('k').images.ean, EAN);
      await scharf();
      expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'unsicher', grund: 'lesungen_uneinig_tage', ean: ANDERE, zweit: EAN });
      mockAudit.set(doc('k').images.ean, '');
      morgen();
      const b = await scharf();
      expect(doc('k').status).toBe('pending');
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_unsicher' });
    });

    it('2b: Halt (ANDERE zweimal), Tag 1 zweimal eine DRITTE, Tag 2 nichts lesbar → nie korrigiert (Muster: unscharfes Foto erfindet Nummern)', async () => {
      einreichung('k', halt);
      mockAudit.set(doc('k').images.ean, DRITTE);
      await scharf();
      expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'unsicher', grund: 'lesungen_uneinig_tage', ean: ANDERE, zweit: DRITTE });
      expect(doc('k').eanKorrektur).toBeUndefined();
      mockAudit.set(doc('k').images.ean, '');
      morgen();
      await scharf();
      expect(doc('k').status).toBe('pending');
      expect(doc('k').eanKorrektur).toBeUndefined();
      // … und auch nicht, wenn danach wieder zweimal die DRITTE gelesen wird
      mockAudit.set(doc('k').images.ean, DRITTE);
      morgen(2);
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
    });

    it('2a′: Halt (ANDERE zweimal), Tag 1 liest das Modell die gespeicherte UND der Strichcode-Leser genau sie → Halt aufgehoben, freigegeben, nie korrigiert (Entscheidung Patrick 09.10.2026)', async () => {
      einreichung('k', halt);
      mockAudit.set(doc('k').images.ean, EAN);
      const b = await scharf();
      gleichDurchLeser('k');
      expect(doc('k').eanFotoOcr.aufgehoben).toMatchObject({ art: 'unsicher', ean: ANDERE }); // heutiger Widerspruch machte den Halt erst `unsicher`
      expect(b.eanKorrektur.leserGleich).toMatchObject({ geprueft: 1, bestaetigt: 1, angewandt: 1 });
    });

    it('2c: Halt, Tag 1 Widerspruch, Tag 2 Bildprüfung scheitert, Tag 3 nichts lesbar → nie korrigiert', async () => {
      einreichung('k', halt);
      striche('k'); // Strichcode-Leser liest nichts (sonst 4d, siehe 2a′)
      mockAudit.set(doc('k').images.ean, EAN);
      await scharf();
      mockAudit.set(doc('k').images.ean, 'AUDIT_FEHLER');
      morgen();
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      mockAudit.set(doc('k').images.ean, '');
      morgen(2);
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
    });

    it('Halt, heute scheitert die Bildprüfung → heute KEINE Korrektur (ein Ausfall ist keine Bestätigung); am Folgetag mit lesbarem/unlesbarem Foto schon', async () => {
      einreichung('k', halt);
      mockAudit.set(doc('k').images.ean, 'AUDIT_FEHLER');
      const b1 = await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(b1.eanKorrektur.korrigiert).toBe(0);
      mockAudit.set(doc('k').images.ean, '');
      striche('k', ANDERE);
      morgen();
      await scharf();
      expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, aus: 'vorbefund' });
      expect(doc('k').status).toBe('approved');
    });

    it('`ean_unsicher` von gestern, heute zweimal gleich → bleibt unsicher; auch am Folgetag keine Korrektur', async () => {
      einreichung('k', { eanFotoOcr: { ean: ANDERE, befund: 'unsicher', zweit: null, grund: 'zweite_lesung_leer', lauf: GESTERN } });
      mockAudit.set(doc('k').images.ean, ANDERE);
      const b1 = await scharf();
      expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'unsicher', lauf: GESTERN }); // unverändert
      expect(b1.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_unsicher' });
      morgen();
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
    });

    it('gestern zweimal Y, heute zweimal Z → unsicher (über Tage uneinig); am Folgetag keine Korrektur', async () => {
      einreichung('k', halt);
      mockAudit.set(doc('k').images.ean, DRITTE);
      const b1 = await scharf();
      expect(b1.eanKorrektur).toMatchObject({ korrigiert: 0, uneinigUeberTage: 1 });
      expect(doc('k').review.rundeOffen).toMatchObject({ sperrend: ['ean_unsicher'], eanFoto: { befund: 'unsicher', ean: ANDERE } });
      morgen();
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
    });

    it('Gegenprobe: Halt, Tag 1 zweimal DIESELBE Nummer → korrigiert', async () => {
      einreichung('k', halt);
      mockAudit.set(doc('k').images.ean, ANDERE);
      await scharf();
      expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, aus: 'vorbefund' });
    });
  });
});

describe('Prüfrunde 06.10.2026 (Datenintegrität): Kartonnummer und Entscheidung während der Runde', () => {
  const GESTERN = '2026-10-05_080000';
  it('Barcode-Foto zeigt zweimal die GTIN-14 des Umkartons (Indikator 1) → KEINE Korrektur, bleibt beim Menschen', async () => {
    einreichung('k');
    const z = ('1' + EAN.slice(0, 12)).split('').map(Number);
    const sum = z.reverse().reduce((a, v, i) => a + v * (i % 2 === 0 ? 3 : 1), 0);
    const karton = '1' + EAN.slice(0, 12) + ((10 - (sum % 10)) % 10);
    mockAudit.set(doc('k').images.ean, karton);
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanKorrektur).toBeUndefined();
    expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_abweichend' });
  });

  it('ein Mensch entscheidet WÄHREND der Runde (force, „Scanner-Nummer stimmt") → die Runde schreibt KEINE Korrektur an das entschiedene Dokument', async () => {
    einreichung('k', { eanFotoOcr: { ean: ANDERE, befund: 'abweichend', bestaetigt: true, zweit: ANDERE, korrekturfaehig: true, lauf: GESTERN } });
    mockAudit.set(doc('k').images.ean, '');
    striche('k', ANDERE);
    mockLage.nachAudit = () => {
      const x = doc('k');
      if (x.status === 'pending') mockStore.set('crowd_uploads/k', { ...x, status: 'approved', review: { decidedBy: 'konsole', forced: true, note: 'Scanner-Nummer stimmt' } });
    };
    const b = await scharf();
    expect(doc('k').status).toBe('approved');
    expect(doc('k').eanKorrektur).toBeUndefined();
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: ANDERE, befund: 'abweichend', lauf: GESTERN }); // unverändert
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 0, entschiedenInzwischen: 1 });
  });
});

describe('Prüfrunde 06.10.2026 (Übergang, Rückweg, Schalter)', () => {
  const ALT = '2026-10-06_080038'; // letzter Lauf des alten Codes, an den Daten geprüft (werte.LETZTER_LAUF_OHNE_VERMERK)
  const SPAETER = '2026-10-07_080001'; // ein Lauf des alten Codes nach dem 06.10.
  const morgen = (n = 1) => dateSpy.mockImplementation(() => T0 + n * TAG_MS);
  const gtin = (zwoelf) => {
    const z = zwoelf.split('').map(Number);
    const s = z.reverse().reduce((a, v, i) => a + v * (i % 2 === 0 ? 3 : 1), 0);
    return zwoelf + ((10 - (s % 10)) % 10);
  };
  /** Was der alte Code (fe89647e) an einer offenen Einreichung hinterlässt: Befund + Rückfall, ohne Vermerk. */
  const altCode = (ean, lauf, { befund = 'abweichend', bestaetigt = true } = {}) => {
    const eanFoto = { befund, ean, ...(befund === 'abweichend' ? { bestaetigt } : { zweit: null }) };
    return {
      eanFotoOcr: { ...eanFoto, lauf },
      review: { rundeOffen: { lauf, grund: befund === 'abweichend' ? 'ean_abweichend' : 'ean_unsicher', sperrend: [befund === 'abweichend' ? 'ean_abweichend' : 'ean_unsicher'], eanFoto } },
    };
  };

  describe('Übergangslücke: Befunde des alten Codes', () => {
    it('Patricks 8 Fälle (Lauf vom 06.10., zweimal gleich) → beim ersten Lauf des neuen Codes korrigiert, auch bei unlesbarem Foto (wenn der Strichcode-Leser die Nummer liest)', async () => {
      einreichung('k', altCode(ANDERE, ALT));
      mockAudit.set(doc('k').images.ean, '');
      striche('k', ANDERE);
      const b = await scharf();
      expect(doc('k').status).toBe('approved');
      expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, vorher: EAN, aus: 'vorbefund', befundVom: ALT });
      expect(doc('k').eanKorrektur.heuteBestaetigt).toBeUndefined();
      expect(b.eanKorrektur).toMatchObject({ korrigiert: 1, ausVorbefund: 1 });
    });

    it('Delverde Eliche: 06.10. `unsicher`, der alte Code macht am 07.10. daraus „abweichend, bestätigt M" (beide Quellen) → am 08.10. bei unlesbarem Foto KEINE Korrektur, liegt', async () => {
      const M = '8002270014512';
      const gespeichert = '8000270013122';
      einreichung('k', { ean: gespeichert, ...altCode(M, SPAETER) });
      mockAudit.set(doc('k').images.ean, '');
      morgen(); // 08.10.
      const b = await scharf();
      expect(doc('k').status).toBe('pending');
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(b.wartetAufDich.find((x) => x.id === 'k')).toMatchObject({ grund: 'ean_abweichend' });
      // der neu geschriebene Rückfall bleibt ausdrücklich nicht vertraut — auch übermorgen keine Korrektur ohne neue doppelte Lesung
      expect(doc('k').review.rundeOffen.eanFoto).toMatchObject({ befund: 'abweichend', ean: M, korrekturfaehig: false });
      morgen(2);
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
    });

    it('… auch wenn der neue Code die Nummer heute selbst zweimal liest und der Strichcode-Leser sie bestätigt: Befund des alten Codes → nie korrigiert, gelbe Warnung (Prüfrunde 06.10., Code-Schutz)', async () => {
      // Bis zur Prüfrunde 06.10. wurde hier korrigiert (`heuteBestaetigt`). Ob der Fall vorher `unsicher`
      // war, hat der alte Code überschrieben — ein Mensch entscheidet.
      einreichung('k', altCode(ANDERE, SPAETER));
      mockAudit.set(doc('k').images.ean, ANDERE);
      const b = await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
      // Kein Kandidat der Korrektur; der Leser läuft nur für 4d (09.10.2026) und liest nicht die gespeicherte.
      expect(mockLage.leserAufrufe).toEqual([doc('k').images.ean]);
      expect(b.eanKorrektur.leser).toEqual({ bestaetigt: 0, widerspricht: 0, nicht_gelesen: 0, fehler: 0 });
      const f = b.wartetAufDich.find((x) => x.id === 'k');
      expect(f).toMatchObject({ grund: 'ean_abweichend' });
      expect(f.hinweis).toMatch(/Befund des alten Codes ohne Vermerk/);
      expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'abweichend', korrekturGebremst: `altcode_${SPAETER}` });
      expect(doc('k').review.rundeOffen.eanFoto).toMatchObject({ korrekturGebremst: `altcode_${SPAETER}` });
      expect(b.warnungen.find((w) => w.code === 'barcode_altcode_wartet')).toMatchObject({ stufe: 'gelb' });
      expect(b.warnungen.map((w) => w.code)).not.toContain('barcode_korrektur_gebremst_wartet');
      // auch am Folgetag nicht
      morgen();
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
    });

    it('alter Code überschreibt `unsicher` → nie korrigiert (Prüfrunde 06.10., Übergangslücke)', async () => {
      // 06.10.: unsicher (Lauf vom 06.10.). 07.10. 08:00 läuft der alte Code noch einmal und macht
      // daraus „abweichend, bestätigt M" in BEIDEN Quellen. 08.10.: neuer Code, M zweimal, Leser liest M.
      const M = '8002270014512';
      const gespeichert = '8000270013122';
      einreichung('k', { ean: gespeichert, ...altCode(M, SPAETER) });
      mockAudit.set(doc('k').images.ean, M);
      striche('k', M);
      morgen();
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
      morgen(2);
      mockAudit.set(doc('k').images.ean, '');
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
    });

    it('Befund vom 06.10., aber der alte Code hat den Rückfall am 07.10. neu geschrieben (Widerspruch dort womöglich verschluckt) → unlesbar: keine Korrektur', async () => {
      const x = altCode(ANDERE, ALT);
      x.review.rundeOffen.lauf = SPAETER;
      einreichung('k', x);
      mockAudit.set(doc('k').images.ean, '');
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
    });

    it('der neue Code gibt das Vertrauen weiter: Fall vom 06.10., heute scheitert die Bildprüfung → morgen bei unlesbarem Foto korrigiert', async () => {
      einreichung('k', altCode(ANDERE, ALT));
      mockAudit.set(doc('k').images.ean, 'AUDIT_FEHLER');
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      // Rückfall vom neuen Code neu geschrieben — mit Vermerk und rekonstruierter zweiter Lesung
      expect(doc('k').review.rundeOffen.eanFoto).toMatchObject({ befund: 'abweichend', ean: ANDERE, bestaetigt: true, zweit: ANDERE, korrekturfaehig: true });
      expect(doc('k').eanFotoOcr).toMatchObject({ lauf: ALT }); // unverändert
      mockAudit.set(doc('k').images.ean, '');
      striche('k', ANDERE);
      morgen();
      await scharf();
      expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, aus: 'vorbefund' });
    });
  });

  describe('Schalter barcodeKorrektur (nur true wendet an)', () => {
    it('Schalter aus → im scharfen Lauf KEINE Korrektur: liegt wie vor dem 06.10., Bericht nennt den Vorschlag; Befund vertraut gespeichert, nach dem Einschalten korrigiert', async () => {
      mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: false });
      einreichung('k');
      mockAudit.set(doc('k').images.ean, ANDERE);
      const b = await scharf();
      expect(doc('k').status).toBe('pending');
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(mockWrites.some((w) => w.path.startsWith('crowd_uploads/') && w.data.eanKorrektur)).toBe(false);
      expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_abweichend' });
      expect(b.eanKorrektur).toMatchObject({ korrigiert: 0, schalter: false, vorgeschlagen: 1, vorgeschlagenFaelle: [{ id: 'k', vorher: EAN, neu: ANDERE, aus: 'heute', zeuge: [ANDERE] }], gespeichert: false, leser: { bestaetigt: 1 } });
      expect(b.wartetAufDich[0].hinweis).toMatch(new RegExp(`Strichcode-Leser bestätigt ${ANDERE}`));
      expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'abweichend', bestaetigt: true, zweit: ANDERE, korrekturfaehig: true });
      expect(b.warnungen.map((w) => w.code)).not.toContain('barcode_korrektur_schalter_unbekannt');
      mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true });
      mockAudit.set(doc('k').images.ean, '');
      striche('k', ANDERE);
      morgen();
      await scharf();
      expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, aus: 'vorbefund' });
      expect(doc('k').status).toBe('approved');
    });

    it('Schalter fehlt oder hat einen unbekannten Wert → aus; ein unbekannter Wert gelb im Bericht', async () => {
      for (const [cfg, warnung] of [[{ fotoWorker: true }, false], [{ fotoWorker: true, barcodeKorrektur: 'ja' }, true], [{ fotoWorker: true, barcodeKorrektur: 1 }, true]]) {
        mockStore.clear(); mockWrites.length = 0; mockAudit.clear();
        mockStore.set('cashback_config/v1', cfg);
        einreichung('k');
        mockAudit.set(doc('k').images.ean, ANDERE);
        const b = await scharf();
        expect(doc('k').eanKorrektur).toBeUndefined();
        expect(b.eanKorrektur.vorgeschlagen).toBe(1);
        expect(b.warnungen.map((w) => w.code).includes('barcode_korrektur_schalter_unbekannt')).toBe(warnung);
      }
    });

    it('der übergebene Rohwert (index.js liest die Konfiguration selbst) gilt vor der Konfiguration', async () => {
      mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: false });
      einreichung('k');
      mockAudit.set(doc('k').images.ean, ANDERE);
      await scharf({ barcodeKorrektur: true });
      expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE });
    });

    it('Schalter aus, Bremse schlägt an → nichts vermerkt, heute gelesene Befunde nicht vertraut', async () => {
      mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: false });
      for (let i = 0; i < 8; i++) {
        einreichung(`k${i}`, { uid: `u${i}` });
        mockAudit.set(doc(`k${i}`).images.ean, gtin(`40013820881${i}`));
      }
      const b = await scharf();
      expect(b.eanKorrektur).toMatchObject({ gebremst: true, gebremstVermerkt: false, vorgeschlagen: 0 });
      expect(doc('k0').eanFotoOcr).toMatchObject({ korrekturfaehig: false });
      expect(doc('k0').eanFotoOcr.korrekturGebremst).toBeUndefined();
    });
  });

  describe('Rückweg: Korrektur verworfen (Prüfkonsole)', () => {
    it('verworfene Korrektur an einer offenen Einreichung → es gilt die gespeicherte Nummer, nie wieder korrigiert, liegt beim Menschen', async () => {
      einreichung('k', {
        eanKorrektur: { ean: ANDERE, vorher: EAN, lesungen: [ANDERE, ANDERE], aus: 'heute', lauf: 'L1', zeuge: { art: 'striche', gelesen: [ANDERE] } },
        eanFotoOcr: { ean: ANDERE, befund: 'korrigiert', vorher: EAN, lauf: 'L1' },
        eanKorrekturVerworfen: { by: 'patrick', notiz: 'Scanner-Nummer stimmt', ean: ANDERE, vorher: EAN },
      });
      mockAudit.set(doc('k').images.ean, ANDERE);
      const b = await scharf();
      expect(doc('k').status).toBe('pending');
      expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, lauf: 'L1' }); // Audit bleibt
      expect(doc('k').eanFotoOcr).toMatchObject({ ean: ANDERE, befund: 'abweichend', bestaetigt: true });
      expect(b.eanKorrektur).toMatchObject({ korrigiert: 0 });
      const f = b.wartetAufDich.find((x) => x.id === 'k');
      expect(f).toMatchObject({ grund: 'ean_abweichend' });
      expect(f.hinweis).toMatch(new RegExp(`gespeichert ist ${EAN}`));
    });

    it('… eine verworfene Korrektur einer FREIGABE zählt für die Wochen-Sperre wieder unter der gespeicherten Nummer', async () => {
      einreichung('alt', {
        status: 'approved', createdAt: T0 - 3 * TAG_MS,
        eanKorrektur: { ean: ANDERE, vorher: EAN, aus: 'heute', zeuge: { art: 'striche', gelesen: [ANDERE] } }, eanKorrekturVerworfen: { by: 'patrick', notiz: 'stimmt' },
      });
      einreichung('neu', { createdAt: T0 - TAG_MS });
      await scharf();
      expect(doc('neu')).toMatchObject({ status: 'rejected', rejectReason: 'doppelt_eingereicht' });
      expect(doc('neu').review.precheck.dup).toMatchObject({ verdict: 'locked', priorId: 'alt' });
    });
  });

  it('Tagesgrenze: mehr als 25 Korrekturen aus alten Befunden → die ältesten 25, der Rest wartet ohne Vermerk, gelbe Warnung', async () => {
    for (let i = 0; i < 26; i++) {
      const n = gtin(`40013820${String(i).padStart(4, '0')}`);
      einreichung(`v${String(i).padStart(2, '0')}`, { uid: `v${i}`, createdAt: T0 - (30 - i) * 60 * 60 * 1000, eanFotoOcr: { ean: n, befund: 'abweichend', bestaetigt: true, zweit: n, korrekturfaehig: true, lauf: 'L1' } });
      mockAudit.set(doc(`v${String(i).padStart(2, '0')}`).images.ean, '');
      striche(`v${String(i).padStart(2, '0')}`, n);
    }
    const b = await scharf();
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 25, aufgeschoben: 1, gebremst: false });
    expect(doc('v25').eanKorrektur).toBeUndefined();
    expect(doc('v25').eanFotoOcr.korrekturGebremst).toBeUndefined();
    expect(doc('v00').eanKorrektur).toMatchObject({ aus: 'vorbefund' });
    expect(b.warnungen.find((w) => w.code === 'barcode_korrektur_aufgeschoben')).toMatchObject({ stufe: 'gelb' });
    morgen();
    const b2 = await scharf();
    expect(doc('v25').eanKorrektur).toMatchObject({ aus: 'vorbefund' });
    expect(b2.eanKorrektur.aufgeschoben).toBe(0);
  });
});

describe('Prüfrunde 06.10.2026 (Runde 3): Strichcode-Leser als Pflicht-Zeuge und offene Befunde', () => {
  const GESTERN = '2026-10-05_080000';
  const DRITTE = '4001382088125';
  const morgen = (n = 1) => dateSpy.mockImplementation(() => T0 + n * TAG_MS);

  it('Leser bestätigt → korrigiert; der Zeuge steht an der Korrektur und im Bericht', async () => {
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    const b = await scharf();
    expect(doc('k').status).toBe('approved');
    expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE, vorher: EAN, zeuge: { art: 'striche', gelesen: [ANDERE], leser: 'zxing-wasm 2.2.4' } });
    expect(doc('k').eanKorrektur.regel).toMatch(/Strichcode-Leser/);
    expect(mockLage.leserAufrufe).toEqual([doc('k').images.ean]); // das ORIGINAL des Barcode-Fotos
    expect(b.eanKorrektur).toMatchObject({ kandidaten: 1, leser: { bestaetigt: 1, widerspricht: 0, nicht_gelesen: 0, fehler: 0 }, faelle: [{ id: 'k', zeuge: [ANDERE] }] });
  });

  it('Leser liest nichts, die gespeicherte, beide oder eine dritte, oder scheitert → KEINE Korrektur, liegt (ean_abweichend); Bericht zählt, Hinweis sagt es', async () => {
    const faelle = [
      ['nichts', { gelesen: [] }, 'nicht_gelesen', /findet keinen Strichcode/],
      ['gespeichert', { gelesen: [EAN] }, 'widerspricht', /darunter die gespeicherte Nummer/],
      ['beide', { gelesen: [ANDERE, EAN] }, 'widerspricht', /darunter die gespeicherte Nummer/],
      ['dritte', { gelesen: [DRITTE] }, 'widerspricht', new RegExp(`liest ${DRITTE}`)],
      ['fehler', { fehler: 'bild: Failed to load image from memory' }, 'fehler', /gescheitert/],
    ];
    faelle.forEach(([id], i) => {
      einreichung(id, { uid: `u${i}` });
      mockAudit.set(doc(id).images.ean, ANDERE);
    });
    for (const [id, ergebnis] of faelle) mockStriche.set(doc(id).images.ean, ergebnis);
    const b = await scharf();
    // Liest der Leser genau die gespeicherte → Halt aufgehoben (09.10.2026); alle anderen liegen.
    gleichDurchLeser('gespeichert');
    for (const [id, , , text] of faelle.filter(([fid]) => fid !== 'gespeichert')) {
      expect(doc(id).status).toBe('pending');
      expect(doc(id).eanKorrektur).toBeUndefined();
      const f = b.wartetAufDich.find((x) => x.id === id);
      expect(f).toMatchObject({ grund: 'ean_abweichend' });
      expect(f.hinweis).toMatch(text);
      // die Konsole sieht dasselbe (review.rundeOffen)
      expect(doc(id).review.rundeOffen).toMatchObject({ sperrend: ['ean_abweichend'] });
      expect(doc(id).review.rundeOffen.hinweis).toMatch(/Strichcode-Leser/);
    }
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 0, kandidaten: 5, leser: { bestaetigt: 0, widerspricht: 3, nicht_gelesen: 1, fehler: 1 } });
    expect(b.eanKorrektur.leserFaelle.find((x) => x.id === 'beide')).toMatchObject({ urteil: 'widerspricht', gelesen: [ANDERE, EAN], vorher: EAN, neu: ANDERE });
    expect(b.warnungen.find((w) => w.code === 'barcode_leser_fehler')).toMatchObject({ stufe: 'gelb' });
  });

  it('Download des Originals scheitert → Fehler, keine Korrektur; nur Kandidaten werden gelesen', async () => {
    einreichung('k');
    einreichung('sauber', { uid: 'u2', ean: '4006040052104' });
    mockAudit.set(doc('k').images.ean, ANDERE);
    mockLage.downloadFehler = (p) => p === doc('k').images.ean;
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanKorrektur).toBeUndefined();
    expect(doc('sauber').status).toBe('approved');
    expect(mockLage.leserAufrufe).toEqual([]); // Download scheiterte vor dem Lesen; `sauber` ist kein Kandidat
    expect(b.eanKorrektur.leser).toMatchObject({ fehler: 1 });
    expect(b.eanKorrektur.leserFaelle[0].fehler).toMatch(/download/);
  });

  it('Fusilli/Vollkornbrot (Befund „hoch"): beide Lesungen erfinden dieselbe Nummer für zwei Produkte derselben Person — der Leser hält beide auf, nichts abgelehnt', async () => {
    const ERFUNDEN = '4311501358917';
    einreichung('vollkorn', { ean: '4311501799130', createdAt: T0 - 2 * TAG_MS });
    einreichung('fusilli', { ean: '4311596410620', createdAt: T0 - TAG_MS });
    mockAudit.set(doc('vollkorn').images.ean, ERFUNDEN);
    mockAudit.set(doc('fusilli').images.ean, ERFUNDEN);
    striche('vollkorn', '4311501799130'); // die Striche zeigen die gespeicherte (richtige) Nummer
    striche('fusilli'); // keine lesbaren Striche
    const b = await scharf();
    // Vollkornbrot: die Striche zeigen genau die gespeicherte Nummer → Halt aufgehoben, freigegeben (09.10.2026, echter Fall).
    gleichDurchLeser('vollkorn', '4311501799130');
    expect(doc('fusilli').status).toBe('pending');
    expect(doc('fusilli').eanKorrektur).toBeUndefined();
    expect(b.abgelehnt).toBe(0);
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 0, kandidaten: 2, leser: { widerspricht: 1, nicht_gelesen: 1 }, leserGleich: { bestaetigt: 1, angewandt: 1, nichtGelesen: 1 } });
  });

  it('Korrektur verworfen, Fall offen, Foto heute nicht lesbar → liegt (ean_abweichend), wird nicht freigegeben (Befund „mittel")', async () => {
    einreichung('k', {
      eanKorrektur: { ean: ANDERE, vorher: EAN, lesungen: [ANDERE, ANDERE], aus: 'heute', lauf: GESTERN, zeuge: { art: 'striche', gelesen: [ANDERE] } },
      eanFotoOcr: { ean: ANDERE, befund: 'korrigiert', vorher: EAN, lauf: GESTERN },
      eanKorrekturVerworfen: { by: 'patrick', notiz: 'Scanner-Nummer stimmt', ean: ANDERE, vorher: EAN },
    });
    mockAudit.set(doc('k').images.ean, '');
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(b.wartetAufDich.find((x) => x.id === 'k')).toMatchObject({ grund: 'ean_abweichend' });
    // der Halt steht danach auch am Dokument (eanFotoOcr) — nicht vertraut, nie korrigierbar
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: ANDERE, befund: 'abweichend', korrekturfaehig: false });
    expect(doc('k').review.rundeOffen).toMatchObject({ sperrend: ['ean_abweichend'] });
    // nächster Morgen, wieder unlesbar → weiter liegen
    morgen();
    await scharf();
    expect(doc('k').status).toBe('pending');
  });

  it('… erste Lesung die verworfene Nummer, zweite die gespeicherte → liegt (unsicher), nicht freigegeben', async () => {
    einreichung('k', {
      eanKorrektur: { ean: ANDERE, vorher: EAN, lesungen: [ANDERE, ANDERE], aus: 'heute', lauf: GESTERN, zeuge: { art: 'striche', gelesen: [ANDERE] } },
      eanFotoOcr: { ean: ANDERE, befund: 'korrigiert', vorher: EAN, lauf: GESTERN },
      eanKorrekturVerworfen: { by: 'patrick', notiz: 'Scanner-Nummer stimmt', ean: ANDERE, vorher: EAN },
    });
    mockAudit.set(doc('k').images.ean, ANDERE);
    mockZweit.set(doc('k').images.ean, EAN);
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(b.wartetAufDich.find((x) => x.id === 'k')).toMatchObject({ grund: 'ean_unsicher' });
    expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'unsicher', grund: 'lesungen_uneinig_tage' });
    expect(doc('k').eanKorrektur).toMatchObject({ ean: ANDERE }); // Audit bleibt, gilt aber nicht
  });

  it('frühere Lesung „gleich" (Scanner und Foto stimmten überein), heute zweimal eine andere Nummer → ean_unsicher, keine Korrektur, auch nicht am Folgetag (Befund „niedrig")', async () => {
    einreichung('k', { eanFotoOcr: { ean: EAN, befund: 'gleich', lauf: GESTERN } });
    mockAudit.set(doc('k').images.ean, ANDERE);
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanKorrektur).toBeUndefined();
    // Nur 4d (09.10.2026) liest, und nicht die gespeicherte → kein Korrektur-Kandidat, Halt bleibt.
    expect(mockLage.leserAufrufe).toEqual([doc('k').images.ean]);
    expect(b.eanKorrektur.leser).toEqual({ bestaetigt: 0, widerspricht: 0, nicht_gelesen: 0, fehler: 0 });
    const f = b.wartetAufDich.find((x) => x.id === 'k');
    expect(f).toMatchObject({ grund: 'ean_unsicher' });
    expect(f.hinweis).toMatch(new RegExp(`am ${GESTERN} ${EAN} \\(= gespeichert\\) gelesen, heute abweichend \\(${ANDERE}\\)`));
    expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'unsicher', grund: 'lesungen_uneinig_tage', ean: ANDERE });
    expect(b.eanKorrektur.uneinigUeberTage).toBe(1);
    morgen();
    await scharf();
    expect(doc('k').eanKorrektur).toBeUndefined();
    expect(doc('k').status).toBe('pending');
  });

  it('eigene Freigabe mit bestätigt abweichender Foto-Nummer (force, nie korrigiert) → neue Einreichung mit der Foto-Nummer liegt (ean_alt_doppelt), nie abgelehnt (Befund „niedrig")', async () => {
    const K = '070012398358'; const FK = '4012448397358';
    einreichung('frei', { ean: K, status: 'approved', createdAt: T0 - 2 * TAG_MS, eanFotoOcr: { ean: FK, befund: 'abweichend', bestaetigt: true, lauf: GESTERN } });
    einreichung('neu', { ean: FK });
    const b = await scharf();
    expect(doc('neu').status).toBe('pending');
    const f = b.wartetAufDich.find((x) => x.id === 'neu');
    expect(f).toMatchObject({ grund: 'ean_alt_doppelt' });
    expect(f.hinweis).toMatch(new RegExp(`Nummer ${K}, Barcode-Foto ${FK}`));
    expect(b.abgelehnt).toBe(0);
    // Gegenprobe: ein anderes Konto → frei
    mockStore.set('crowd_uploads/neu', { ...doc('neu'), userId: 'u9', review: {} });
    morgen();
    await scharf();
    expect(doc('neu').status).toBe('approved');
  });
});

describe('Prüfrunde 1 zur Barcode-Korrektur (06.10.2026): Verwerfen während des Laufs, Bremse aus dem Rückfall, verworfene Nummer einer Freigabe', () => {
  const GESTERN = '2026-10-05_080000';
  const ALT = '2026-10-06_080038'; // letzter Lauf des alten Codes (werte.LETZTER_LAUF_OHNE_VERMERK)
  const SPAETER = '2026-10-07_080001'; // ein Lauf des alten Codes nach dem 06.10.
  const morgen = (n = 1) => dateSpy.mockImplementation(() => T0 + n * TAG_MS);
  const ZEUGE = { art: 'striche', gelesen: [ANDERE] };
  const VERWORFEN = { by: 'patrick', notiz: 'Scanner-Nummer stimmt', ean: ANDERE, vorher: EAN };
  /** Während der Bildprüfung verwirft ein Mensch in der Konsole die gespeicherte Korrektur von `id`. */
  const verwerfeWaehrendDesLaufs = (id) => {
    mockLage.nachAudit = () => {
      if (!doc(id).eanKorrekturVerworfen) mockStore.set(`crowd_uploads/${id}`, { ...doc(id), eanKorrekturVerworfen: VERWORFEN });
    };
  };

  describe('Korrektur verworfen, während die Runde läuft (Befund „niedrig")', () => {
    it('eigene, früher gespeicherte Korrektur → keine Freigabe mit der verworfenen Nummer; morgen liegt der Fall (ean_abweichend)', async () => {
      einreichung('k', {
        eanKorrektur: { ean: ANDERE, vorher: EAN, lesungen: [ANDERE, ANDERE], aus: 'heute', lauf: GESTERN, zeuge: ZEUGE },
        eanFotoOcr: { ean: ANDERE, befund: 'korrigiert', vorher: EAN, lauf: GESTERN },
      });
      mockAudit.set(doc('k').images.ean, ANDERE); // das Foto bestätigt die korrigierte Nummer → ohne Verwerfen frei
      verwerfeWaehrendDesLaufs('k');
      const b = await scharf();
      // bis zu dieser Prüfrunde: approved, gerechnet mit der verworfenen Nummer
      expect(doc('k').status).toBe('pending');
      expect(doc('k').reviewedBy).toBeUndefined();
      expect(b.freigegeben).toBe(0);
      expect(doc('k').eanKorrekturVerworfen).toMatchObject({ ean: ANDERE });
      mockLage.nachAudit = null;
      morgen();
      const b2 = await scharf();
      expect(doc('k').status).toBe('pending');
      expect(b2.wartetAufDich.find((x) => x.id === 'k')).toMatchObject({ grund: 'ean_abweichend' });
    });

    it('Beleg einer Ablehnung (eigene Freigabe, Wochen-Sperre unter der korrigierten Nummer) wird während des Laufs verworfen → keine Ablehnung; morgen hält der Fall (ean_alt_doppelt)', async () => {
      einreichung('a', {
        status: 'approved', createdAt: T0 - 3 * TAG_MS,
        eanKorrektur: { ean: ANDERE, vorher: EAN, lesungen: [ANDERE, ANDERE], aus: 'heute', lauf: GESTERN, zeuge: ZEUGE },
        eanFotoOcr: { ean: ANDERE, befund: 'korrigiert', vorher: EAN, lauf: GESTERN },
      });
      einreichung('p', { ean: ANDERE });
      verwerfeWaehrendDesLaufs('a');
      const b = await scharf();
      // bis zu dieser Prüfrunde: rejected (doppelt_eingereicht) gegen eine Nummer, die nicht mehr gilt
      expect(doc('p').status).toBe('pending');
      expect(doc('p').rejectReason).toBeUndefined();
      expect(b.abgelehnt).toBe(0);
      mockLage.nachAudit = null;
      morgen();
      const b2 = await scharf();
      expect(doc('p').status).toBe('pending');
      expect(b2.wartetAufDich.find((x) => x.id === 'p')).toMatchObject({ grund: 'ean_alt_doppelt' });
      expect(b2.abgelehnt).toBe(0);
    });

    it('Gegenprobe: ohne Verwerfen wird die Ablehnung mit der Korrektur des Belegs geschrieben, die Freigabe einer korrigierten Einreichung ebenso', async () => {
      einreichung('a', {
        status: 'approved', createdAt: T0 - 3 * TAG_MS,
        eanKorrektur: { ean: ANDERE, vorher: EAN, aus: 'heute', zeuge: ZEUGE },
        eanFotoOcr: { ean: ANDERE, befund: 'korrigiert', vorher: EAN },
      });
      einreichung('p', { ean: ANDERE });
      einreichung('k', {
        uid: 'u2', ean: '4006040052104',
        eanKorrektur: { ean: '4001382088125', vorher: '4006040052104', aus: 'heute', zeuge: { art: 'striche', gelesen: ['4001382088125'] } },
        eanFotoOcr: { ean: '4001382088125', befund: 'korrigiert', vorher: '4006040052104' },
      });
      mockAudit.set(doc('k').images.ean, '4001382088125');
      await scharf();
      expect(doc('p')).toMatchObject({ status: 'rejected', rejectReason: 'doppelt_eingereicht' });
      expect(doc('k').status).toBe('approved');
    });
  });

  describe('Bremse, die nur im Rückfall review.rundeOffen steht, gilt auf Dauer (Befund „mittel")', () => {
    // Der alte Code am 07.10.: eanFotoOcr vom 06.10. behalten (heute widersprochen oder nichts lesbar —
    // beides behält er still), den Rückfall mit Lauf 07.10. ohne Vermerk neu geschrieben.
    const altRueckfall = () => ({
      eanFotoOcr: { befund: 'abweichend', ean: ANDERE, bestaetigt: true, lauf: ALT },
      review: { rundeOffen: { lauf: SPAETER, grund: 'ean_abweichend', sperrend: ['ean_abweichend'], eanFoto: { befund: 'abweichend', ean: ANDERE, bestaetigt: true } } },
    });

    it('S1a: Tag 1 Foto unlesbar → Vermerk an BEIDEN Quellen, Hinweis und gelbe Warnung schon heute; Tag 2 zweimal ANDERE + Leser ANDERE → nie korrigiert', async () => {
      einreichung('k', altRueckfall());
      mockAudit.set(doc('k').images.ean, '');
      striche('k', ANDERE);
      morgen();
      const b1 = await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
      expect(doc('k').review.rundeOffen.eanFoto).toMatchObject({ befund: 'abweichend', ean: ANDERE, korrekturGebremst: `altcode_${SPAETER}`, korrekturfaehig: false });
      expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'abweichend', ean: ANDERE, korrekturGebremst: `altcode_${SPAETER}`, korrekturfaehig: false });
      expect(b1.warnungen.find((w) => w.code === 'barcode_altcode_wartet')).toMatchObject({ stufe: 'gelb' });
      expect(b1.wartetAufDich.find((x) => x.id === 'k').hinweis).toMatch(/Befund des alten Codes ohne Vermerk/);
      mockAudit.set(doc('k').images.ean, ANDERE);
      morgen(2);
      const b2 = await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
      expect(b2.wartetAufDich.find((x) => x.id === 'k')).toMatchObject({ grund: 'ean_abweichend' });
      expect(b2.warnungen.find((w) => w.code === 'barcode_altcode_wartet')).toMatchObject({ stufe: 'gelb' });
      // dritter Tag, wieder unlesbar → weiter nicht
      mockAudit.set(doc('k').images.ean, '');
      morgen(3);
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
    });

    it('S1b: Tag 1 zweimal ANDERE (Leser ANDERE) → keine Korrektur, Vermerk bleibt; Tag 2 unlesbar + Leser ANDERE → nie korrigiert', async () => {
      einreichung('k', altRueckfall());
      mockAudit.set(doc('k').images.ean, ANDERE);
      striche('k', ANDERE);
      morgen();
      const b1 = await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').eanFotoOcr).toMatchObject({ korrekturGebremst: `altcode_${SPAETER}` });
      expect(doc('k').review.rundeOffen.eanFoto).toMatchObject({ korrekturGebremst: `altcode_${SPAETER}` });
      expect(b1.warnungen.find((w) => w.code === 'barcode_altcode_wartet')).toMatchObject({ stufe: 'gelb' });
      mockAudit.set(doc('k').images.ean, '');
      morgen(2);
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
    });

    it('S3: Notbremsen-Vermerk nur im Rückfall (eanFotoOcr konnte nicht gespeichert werden) → am Folgetag weiter gebremst, gelbe Warnung, nie korrigiert', async () => {
      const befund = { befund: 'abweichend', ean: ANDERE, bestaetigt: true, zweit: ANDERE, korrekturfaehig: true };
      einreichung('k', {
        eanFotoOcr: { ...befund, lauf: GESTERN },
        review: { rundeOffen: { lauf: GESTERN, grund: 'ean_abweichend', sperrend: ['ean_abweichend'], eanFoto: { ...befund, korrekturGebremst: GESTERN } } },
      });
      mockAudit.set(doc('k').images.ean, '');
      striche('k', ANDERE);
      const b1 = await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').eanFotoOcr).toMatchObject({ korrekturGebremst: GESTERN });
      expect(doc('k').review.rundeOffen.eanFoto).toMatchObject({ korrekturGebremst: GESTERN });
      expect(b1.warnungen.find((w) => w.code === 'barcode_korrektur_gebremst_wartet')).toMatchObject({ stufe: 'gelb' });
      expect(b1.wartetAufDich.find((x) => x.id === 'k').hinweis).toMatch(new RegExp(`am ${GESTERN} von der Notbremse angehalten`));
      morgen();
      await scharf();
      morgen(2);
      mockAudit.set(doc('k').images.ean, ANDERE);
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
    });
  });

  it('verworfene Korrektur einer FREIGABE, keine Runde dazwischen (eanFotoOcr noch `korrigiert`) → eigene Einreichung mit der Foto-Nummer liegt (ean_alt_doppelt), wie mit Runde dazwischen (Befund „niedrig")', async () => {
    const frei = {
      status: 'approved', createdAt: T0 - 2 * TAG_MS,
      eanKorrektur: { ean: ANDERE, vorher: EAN, aus: 'heute', zeuge: ZEUGE }, eanKorrekturVerworfen: VERWORFEN,
    };
    einreichung('a', { ...frei, eanFotoOcr: { ean: ANDERE, befund: 'korrigiert', vorher: EAN } });
    einreichung('b', { ean: ANDERE });
    const b = await scharf();
    // bis zu dieser Prüfrunde: approved (die Foto-Nummer fiel aus den Nummern der Freigabe)
    expect(doc('b').status).toBe('pending');
    const f = b.wartetAufDich.find((x) => x.id === 'b');
    expect(f).toMatchObject({ grund: 'ean_alt_doppelt' });
    expect(f.hinweis).toMatch(new RegExp(`Nummer ${EAN}, Barcode-Foto ${ANDERE}`));
    expect(b.abgelehnt).toBe(0);
    // dasselbe, wenn eine Runde den Befund dazwischen als `abweichend` geschrieben hatte
    mockStore.clear(); mockListe.clear(); mockAudit.clear();
    mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true });
    einreichung('a', { ...frei, eanFotoOcr: { ean: ANDERE, befund: 'abweichend', bestaetigt: true, zweit: ANDERE, korrekturfaehig: false } });
    einreichung('b', { ean: ANDERE });
    const b2 = await scharf();
    expect(doc('b').status).toBe('pending');
    expect(b2.wartetAufDich.find((x) => x.id === 'b')).toMatchObject({ grund: 'ean_alt_doppelt' });
  });
});

describe('Prüfrunde 2 zur Barcode-Korrektur (06.10.2026): mehrdeutiger Leser, `unsicher` nur im Rückfall, Freigabe während des Laufs', () => {
  const GESTERN = '2026-10-05_080000';
  const DRITTE = '4001382088125';
  const morgen = (n = 1) => dateSpy.mockImplementation(() => T0 + n * TAG_MS);
  const BEFUND = { befund: 'abweichend', ean: ANDERE, bestaetigt: true, zweit: ANDERE, korrekturfaehig: true };
  const mitHalt = (extra = {}) => ({
    eanFotoOcr: { ...BEFUND, lauf: GESTERN },
    review: { rundeOffen: { lauf: GESTERN, grund: 'ean_abweichend', sperrend: ['ean_abweichend'], eanFoto: { ...BEFUND } } },
    ...extra,
  });
  /** Speichern von eanFotoOcr scheitert (vorübergehend) — der Befund steht dann nur im Rückfall review.rundeOffen. */
  const eanFotoOcrScheitert = () => { mockLage.txUpdateFehler = (pfad, daten) => !!daten.eanFotoOcr; };

  it('Leser liest F und eine weitere Nummer (keine davon die gespeicherte) → keine Korrektur, liegt; Hinweis und Bericht nennen es', async () => {
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE); // Modell: zweimal ANDERE
    striche('k', ANDERE, DRITTE); // etwa der Code einer Nachbarpackung
    const b = await scharf();
    // bis zu dieser Prüfrunde: korrigiert und freigegeben
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanKorrektur).toBeUndefined();
    const f = b.wartetAufDich.find((x) => x.id === 'k');
    expect(f).toMatchObject({ grund: 'ean_abweichend' });
    expect(f.hinweis).toMatch(/mehrere Strichcodes, nicht eindeutig/);
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 0, kandidaten: 1, leser: { bestaetigt: 0, widerspricht: 1, nicht_gelesen: 0, fehler: 0 } });
    expect(b.eanKorrektur.leserFaelle).toEqual([{ id: 'k', vorher: EAN, neu: ANDERE, aus: 'heute', urteil: 'widerspricht', gelesen: [ANDERE, DRITTE], mehrdeutig: true }]);
    // Treffergrenze des Lesers erreicht → ebenso
    mockStore.clear(); mockListe.clear(); mockAudit.clear(); mockStriche.clear();
    mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true });
    einreichung('v');
    mockAudit.set(doc('v').images.ean, ANDERE);
    mockStriche.set(doc('v').images.ean, { gelesen: [ANDERE], voll: true });
    await scharf();
    expect(doc('v').status).toBe('pending');
    expect(doc('v').eanKorrektur).toBeUndefined();
  });

  describe('`unsicher` nur im Rückfall (Speichern von eanFotoOcr scheiterte) bleibt `unsicher`', () => {
    it('Tag 2 zweimal F, Tag 3 unlesbar — der Leser liest jeweils F → nie korrigiert, eanFotoOcr wird `unsicher`', async () => {
      einreichung('k', mitHalt());
      // Tag 1: das Foto zeigt heute die GESPEICHERTE Nummer → Widerspruch über Tage → unsicher; eanFotoOcr nicht speicherbar
      striche('k'); // Strichcode-Leser liest nichts (sonst hebt 4d den Halt auf, 09.10.2026)
      mockAudit.set(doc('k').images.ean, EAN);
      eanFotoOcrScheitert();
      await scharf();
      expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'abweichend', ean: ANDERE });
      expect(doc('k').review.rundeOffen.eanFoto).toMatchObject({ befund: 'unsicher' });
      mockLage.txUpdateFehler = () => false;
      // Tag 2: zweimal ANDERE, Leser ANDERE
      mockAudit.set(doc('k').images.ean, ANDERE);
      striche('k', ANDERE);
      morgen();
      const b2 = await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(b2.wartetAufDich.find((x) => x.id === 'k')).toMatchObject({ grund: 'ean_unsicher' });
      // der Halt steht jetzt auch in eanFotoOcr (bis dahin: `abweichend`, korrekturfähig)
      expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'unsicher', ean: ANDERE });
      expect(doc('k').review.rundeOffen.eanFoto).toMatchObject({ befund: 'unsicher' });
      // Tag 3: unlesbar, Leser ANDERE — bis zu dieser Prüfrunde: korrigiert und freigegeben
      mockAudit.set(doc('k').images.ean, '');
      morgen(2);
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
    });

    it('Tag 2 unlesbar, Tag 3 zweimal F + Leser F → nie korrigiert', async () => {
      einreichung('k', mitHalt());
      striche('k'); // Strichcode-Leser liest nichts (sonst hebt 4d den Halt auf, 09.10.2026)
      mockAudit.set(doc('k').images.ean, EAN);
      eanFotoOcrScheitert();
      await scharf();
      mockLage.txUpdateFehler = () => false;
      mockAudit.set(doc('k').images.ean, '');
      striche('k', ANDERE);
      morgen();
      await scharf();
      expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'unsicher' });
      mockAudit.set(doc('k').images.ean, ANDERE);
      morgen(2);
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
    });

    it('Gegenprobe: Widerspruch ohne Schreibfehler gespeichert → ebenso nie korrigiert', async () => {
      einreichung('k', mitHalt());
      striche('k'); // Strichcode-Leser liest nichts (sonst hebt 4d den Halt auf, 09.10.2026)
      mockAudit.set(doc('k').images.ean, EAN);
      await scharf();
      expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'unsicher' });
      mockAudit.set(doc('k').images.ean, ANDERE);
      striche('k', ANDERE);
      morgen();
      await scharf();
      mockAudit.set(doc('k').images.ean, '');
      morgen(2);
      await scharf();
      expect(doc('k').eanKorrektur).toBeUndefined();
      expect(doc('k').status).toBe('pending');
    });
  });

  describe('Freigabe durch einen Menschen während des Laufs: der Barcode-Befund wird nicht mehr überschrieben', () => {
    it('Konsole gibt C (Foto bestätigt ANDERE) mit force frei, die Runde liest heute die gespeicherte → eanFotoOcr bleibt; morgen liegt die eigene Einreichung mit ANDERE', async () => {
      einreichung('c', mitHalt({ createdAt: T0 - 2 * TAG_MS }));
      mockAudit.set(doc('c').images.ean, EAN); // heute: Widerspruch über Tage → `unsicher`
      mockLage.nachAudit = () => {
        if (doc('c').status === 'pending') mockStore.set('crowd_uploads/c', { ...doc('c'), status: 'approved', review: { forced: true, forcedNote: 'Foto zeigt ANDERE', decidedBy: 'patrick' } });
      };
      const b = await scharf();
      mockLage.nachAudit = null;
      // bis zu dieser Prüfrunde: eanFotoOcr `unsicher` → ANDERE fiel aus den Nummern der Freigabe
      expect(doc('c').status).toBe('approved');
      expect(doc('c').eanFotoOcr).toMatchObject({ befund: 'abweichend', ean: ANDERE, bestaetigt: true, lauf: GESTERN });
      expect(b.eanFotoEntschiedenInzwischen).toBe(1);
      expect(b.eanFotoNichtGespeichert).toBe(0);
      morgen();
      einreichung('n', { ean: ANDERE, createdAt: T0 + TAG_MS - 3600 * 1000 });
      const b2 = await scharf();
      expect(doc('n').status).toBe('pending');
      expect(b2.wartetAufDich.find((x) => x.id === 'n')).toMatchObject({ grund: 'ean_alt_doppelt' });
    });

    it('Gegenprobe: Freigabe nach dem Lauf (Befund unverändert) → die eigene Einreichung mit ANDERE liegt ebenso', async () => {
      einreichung('c', { createdAt: T0 - 2 * TAG_MS, status: 'approved', eanFotoOcr: { ...BEFUND, lauf: GESTERN } });
      morgen();
      einreichung('n', { ean: ANDERE, createdAt: T0 + TAG_MS - 3600 * 1000 });
      const b = await scharf();
      expect(doc('n').status).toBe('pending');
      expect(b.wartetAufDich.find((x) => x.id === 'n')).toMatchObject({ grund: 'ean_alt_doppelt' });
    });

    it('offene Einreichung: Befund wird wie bisher geschrieben (in einer Transaktion)', async () => {
      einreichung('k', mitHalt());
      striche('k'); // Strichcode-Leser liest nichts (sonst hebt 4d den Halt auf, 09.10.2026)
      mockAudit.set(doc('k').images.ean, EAN);
      const b = await scharf();
      expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'unsicher', grund: 'lesungen_uneinig_tage' });
      expect(b.eanFotoEntschiedenInzwischen).toBe(0);
    });
  });
});

describe('4d: Strichcode-Leser bestätigt die gespeicherte Nummer (Entscheidung Patrick 09.10.2026)', () => {
  const GESTERN = '2026-10-05_080000';
  const morgen = (n = 1) => dateSpy.mockImplementation(() => T0 + n * TAG_MS);
  const unsicherGestern = { eanFotoOcr: { ean: ANDERE, befund: 'unsicher', zweit: null, lauf: GESTERN } };

  it('alter `unsicher`-Halt, heute nichts lesbar, Leser liest genau die gespeicherte → freigegeben, ohne Korrektur; Bericht zählt', async () => {
    einreichung('k', unsicherGestern);
    mockAudit.set(doc('k').images.ean, '');
    striche('k', EAN);
    const b = await scharf();
    gleichDurchLeser('k');
    expect(b.eanKorrektur.leserGleich).toMatchObject({ geprueft: 1, bestaetigt: 1, angewandt: 1, faelle: [{ id: 'k', ean: EAN, aufgehoben: 'unsicher', angewandt: true }] });
    expect(b.freigegeben).toBe(1);
  });

  it('heutige Abweichung (Modell liest zweimal etwas anderes), Leser liest die gespeicherte → freigegeben, keine Korrektur', async () => {
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    striche('k', EAN);
    await scharf();
    gleichDurchLeser('k');
  });

  it('Schalter `barcodeKorrektur` aus → nur im Bericht, der Fall liegt weiter', async () => {
    mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: false });
    einreichung('k', unsicherGestern);
    mockAudit.set(doc('k').images.ean, '');
    striche('k', EAN);
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(b.wartetAufDich.find((x) => x.id === 'k')).toMatchObject({ grund: 'ean_unsicher' });
    expect(b.eanKorrektur.leserGleich).toMatchObject({ bestaetigt: 1, angewandt: 0, faelle: [{ id: 'k', angewandt: false }] });
  });

  it('zwei Strichcodes auf dem Foto (darunter die gespeicherte) → Halt bleibt', async () => {
    einreichung('k', unsicherGestern);
    mockAudit.set(doc('k').images.ean, '');
    striche('k', EAN, '4001382088125');
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(b.eanKorrektur.leserGleich).toMatchObject({ geprueft: 1, bestaetigt: 0, andere: 1 });
  });

  it('übrige Regeln gelten danach unverändert: eigene Freigabe derselben Nummer vor 3 Tagen → abgelehnt als doppelt', async () => {
    einreichung('alt', { status: 'approved', createdAt: T0 - 4 * TAG_MS });
    einreichung('k', unsicherGestern);
    mockAudit.set(doc('k').images.ean, '');
    striche('k', EAN);
    await scharf();
    expect(doc('k')).toMatchObject({ status: 'rejected', rejectReason: 'doppelt_eingereicht' });
    expect(doc('k').eanKorrektur).toBeUndefined();
  });

  it('gesperrtes Konto: der Leser läuft gar nicht, der Fall bleibt stumm liegen', async () => {
    mockStore.set('cashback_sperren/u1', { gesperrt: true });
    einreichung('k', unsicherGestern);
    mockAudit.set(doc('k').images.ean, '');
    striche('k', EAN);
    await scharf();
    expect(doc('k').status).toBe('pending');
    expect(mockLage.leserAufrufe).toEqual([]);
  });

  it('Trockenlauf: wird gerechnet, nichts gespeichert', async () => {
    einreichung('k', unsicherGestern);
    mockAudit.set(doc('k').images.ean, '');
    striche('k', EAN);
    const b = await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanFotoOcr).toMatchObject({ befund: 'unsicher' });
    expect(b.eanKorrektur.leserGleich).toMatchObject({ bestaetigt: 1 });
    morgen(0);
  });
});

describe('Haushalts-Regel (Entscheidung Patrick 17.10.2026)', () => {
  const MIN = 60 * 1000;
  const ORT = { lat: 51.315, lon: 10.315, accuracyM: 15 };
  const NEBENAN = { lat: 51.3151, lon: 10.3151, accuracyM: 12 };

  it('zwei Konten, dieselbe EAN, selber Ort, 3 min nacheinander → die erste bezahlt, die zweite abgelehnt', async () => {
    einreichung('frau', { uid: 'u1', createdAt: T0 - TAG_MS, capture: { gps: ORT } });
    einreichung('mann', { uid: 'u2', createdAt: T0 - TAG_MS + 3 * MIN, capture: { gps: NEBENAN } });
    const b = await scharf();
    expect(doc('frau').status).toBe('approved');
    expect(doc('mann')).toMatchObject({ status: 'rejected', rejectReason: 'produkt_bereits_verguetet', holdReasons: ['produkt_bereits_verguetet'] });
    expect(doc('mann').review).toMatchObject({ reason: 'doppelt_haushalt', decidedBy: 'worker-fotorunde' });
    expect(doc('mann').review.precheck).toMatchObject({ verdict: 'locked', reasons: ['doppelt_haushalt'], haushalt: { verdict: 'locked', reason: 'doppelt_haushalt' } });
    expect(doc('mann').reviewNote).toContain('anderes Konto');
    // keine fremde Doc-ID und kein fremder Standort am Dokument, das der Einreicher liest
    expect(JSON.stringify(doc('mann'))).not.toContain('frau');
    expect(b.ablehnGruende).toEqual({ doppelt_haushalt: 1 });
  });

  it('gestern schon bezahlte Einreichung des anderen Kontos (Rückstau) → heute abgelehnt', async () => {
    einreichung('frau', { uid: 'u1', status: 'approved', createdAt: T0 - TAG_MS, capture: { gps: ORT } });
    einreichung('mann', { uid: 'u2', createdAt: T0 - TAG_MS + 20 * MIN, capture: { gps: NEBENAN } });
    await scharf();
    expect(doc('mann')).toMatchObject({ status: 'rejected', rejectReason: 'produkt_bereits_verguetet' });
  });

  it('anderer Ort (gut 500 m) oder zwei Stunden auseinander → beide bezahlt', async () => {
    einreichung('a1', { uid: 'u1', createdAt: T0 - TAG_MS, capture: { gps: ORT } });
    einreichung('a2', { uid: 'u2', createdAt: T0 - TAG_MS + 3 * MIN, capture: { gps: { lat: 51.32, lon: 10.315, accuracyM: 10 } } });
    einreichung('b1', { uid: 'u3', ean: ANDERE, createdAt: T0 - TAG_MS, capture: { gps: ORT } });
    einreichung('b2', { uid: 'u4', ean: ANDERE, createdAt: T0 - TAG_MS + 120 * MIN, capture: { gps: NEBENAN } });
    await scharf();
    for (const id of ['a1', 'a2', 'b1', 'b2']) expect(doc(id).status).toBe('approved');
  });

  it('ohne Gerätestandort (ältere App) → Regel greift nicht', async () => {
    einreichung('frau', { uid: 'u1', createdAt: T0 - TAG_MS });
    einreichung('mann', { uid: 'u2', createdAt: T0 - TAG_MS + 3 * MIN });
    await scharf();
    expect(doc('frau').status).toBe('approved');
    expect(doc('mann').status).toBe('approved');
  });

  it('Schalter haushaltRegel === false → Regel aus (Rückweg ohne Deploy); fehlt er → an', async () => {
    mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true, haushaltRegel: false });
    einreichung('frau', { uid: 'u1', createdAt: T0 - TAG_MS, capture: { gps: ORT } });
    einreichung('mann', { uid: 'u2', createdAt: T0 - TAG_MS + 3 * MIN, capture: { gps: NEBENAN } });
    const b = await scharf();
    expect(doc('mann').status).toBe('approved');
    expect(b.ablehnGruende).toEqual({});
  });

  it('Trockenlauf schreibt nichts', async () => {
    einreichung('frau', { uid: 'u1', createdAt: T0 - TAG_MS, capture: { gps: ORT } });
    einreichung('mann', { uid: 'u2', createdAt: T0 - TAG_MS + 3 * MIN, capture: { gps: NEBENAN } });
    const b = await taeglicheRunde({ dryRun: true, projekt: 'p', bucketName: 'b', ausloeser: 'manuell' });
    expect(doc('mann').status).toBe('pending');
    expect(b.ablehnGruende).toEqual({ doppelt_haushalt: 1 });
  });
});
