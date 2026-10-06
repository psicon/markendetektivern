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
const mockLage = { sperrenFehler: false, listeFehler: false, configFehler: 0, configLesungen: 0, auditAufrufe: [], auditTexte: [], zweitLesungen: [], updateFehler: () => false, txUpdateFehler: () => false };
const mockSentinel = { __feld: 'serverTimestamp' };
const mockDelete = { __feld: 'delete' };
const mockListe = new Map(); // Pfad → { md5, size }
const mockAudit = new Map(); // Pfad des ean-Fotos → eanFoto-Antwort
const mockZweit = new Map(); // Pfad des ean-Fotos → Antwort der zweiten Lesung ('FEHLER' = wirft)
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
        generateContent: async ({ contents }) => {
          const parts = contents[0].parts;
          const text = parts.map((p) => p.text || '').join('\n');
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
  mockStore.set('cashback_config/v1', { fotoWorker: true });
});
afterEach(() => dateSpy.mockRestore());

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

  it('Barcode-Foto zeigt andere Nummer → bleibt liegen, Hinweis nennt die eigene Freigabe unter der Foto-Nummer', async () => {
    einreichung('unterFoto', { ean: ANDERE, status: 'approved', createdAt: T0 - 2 * TAG_MS });
    einreichung('k', { createdAt: T0 - TAG_MS });
    mockAudit.set(doc('k').images.ean, ANDERE);
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: ANDERE, befund: 'abweichend', bestaetigt: true });
    expect(mockLage.zweitLesungen).toEqual([[doc('k').images.ean]]);
    const f = b.wartetAufDich.find((x) => x.id === 'k');
    expect(f).toMatchObject({ grund: 'ean_abweichend' });
    expect(f.hinweis).toMatch(/eigene Freigabe/);
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

  it('Lidl-EAN-8 auf dem Foto, gespeichert eine ganz andere EAN → bleibt liegen (vorher: kein Urteil, Prüfrunde 02.10.)', async () => {
    einreichung('k');
    mockAudit.set(doc('k').images.ean, '20917937');
    await scharf();
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: '20917937', befund: 'abweichend', bestaetigt: true });
  });

  it('Abweichung geht der Wochen-Sperre vor: gespeicherte EAN gehört zu einer eigenen Freigabe, das Foto zeigt etwas anderes → liegen lassen', async () => {
    einreichung('alt', { status: 'approved', createdAt: T0 - 3 * TAG_MS });
    einreichung('k');
    mockAudit.set(doc('k').images.ean, ANDERE);
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_abweichend' });
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

  it('Kfs5jFA6qqOF8gD9iTEk: gestern abweichend, heute falsche Prüfziffer nah an der gespeicherten (kein Urteil) → bleibt liegen, Befund unverändert', async () => {
    einreichung('k', { ean: KFS, eanFotoOcr: { ean: FOTO_GESTERN, befund: 'abweichend', bestaetigt: true, lauf: GESTERN } });
    mockAudit.set(doc('k').images.ean, '4250231136470'); // eine Ziffer daneben → kein Urteil
    const b = await scharf();
    expect(doc('k').status).toBe('pending');
    const f = b.wartetAufDich.find((x) => x.id === 'k');
    expect(f).toMatchObject({ grund: 'ean_abweichend' });
    expect(f.hinweis).toMatch(/Befund vom 2026-10-02_080000/);
    expect(f.hinweis).toMatch(/heute kein Urteil/);
    expect(eanFotoWrites('k')).toEqual([]); // der alte Befund bleibt, wie er war
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: FOTO_GESTERN, befund: 'abweichend', lauf: GESTERN });
    expect(b.eanFotoVorbefund).toEqual({ haelt: 1 });
    expect(rundeOffen('k')).toMatchObject({ grund: 'ean_abweichend', sperrend: ['ean_abweichend'], eanFoto: { befund: 'abweichend', ean: FOTO_GESTERN, bestaetigt: true } });
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
    for (const vorher of [
      { ean: FOTO_GESTERN, befund: 'unsicher', zweit: null, grund: 'zweite_lesung_leer', lauf: GESTERN },
      { ean: FOTO_GESTERN, befund: 'abweichend', bestaetigt: false, lauf: GESTERN },
    ]) {
      mockStore.clear(); mockWrites.length = 0; mockLage.zweitLesungen = [];
      mockStore.set('cashback_config/v1', { fotoWorker: true });
      einreichung('k', { ean: KFS, eanFotoOcr: vorher });
      mockZweit.set(doc('k').images.ean, KFS);
      const b = await scharf(); // die Bildprüfung liest die gespeicherte Nummer
      expect(mockLage.zweitLesungen).toEqual([]); // keine zweite Lesung — sie könnte nichts mehr aufheben
      expect(doc('k').status).toBe('pending');
      expect(eanFotoWrites('k')).toEqual([]);
      expect(doc('k').eanFotoOcr).toEqual(vorher);
      expect(b.eanFotoVorbefund).toEqual({ haelt: 1 });
      const f = b.wartetAufDich.find((x) => x.id === 'k');
      expect(f.grund).toBe(vorher.befund === 'unsicher' ? 'ean_unsicher' : 'ean_abweichend');
      expect(f.hinweis).toMatch(/gilt bis zur Entscheidung in der Konsole; heute gleich/);
      expect(rundeOffen('k').sperrend).toEqual([vorher.befund === 'unsicher' ? 'ean_unsicher' : 'ean_abweichend']);
    }
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
    expect(b.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_abweichend' });
    expect(b.wartetAufDich[0].hinweis).toMatch(/heute gleich/);
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
    mockLage.nachAudit = () => dateSpy.mockImplementation(() => T0 + 19 * 60 * 1000);
    await scharf();
    expect(mockLage.zweitLesungen).toEqual([]);
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: ANDERE, befund: 'abweichend', bestaetigt: false, fehler: 'zeit_abgelaufen' });
  });

  it('eanFotoOcr nicht speicherbar → Halte-Befund steht in review.rundeOffen; der nächste Lauf hält damit und repariert eanFotoOcr', async () => {
    einreichung('k', { ean: KFS });
    mockAudit.set(doc('k').images.ean, ANDERE);
    mockLage.updateFehler = (pfad, daten) => !!daten.eanFotoOcr;
    const b = await scharf();
    expect(doc('k').eanFotoOcr).toBeUndefined();
    expect(b.eanFotoNichtGespeichert).toBe(1);
    expect(b.warnungen.map((w) => w.code)).toContain('barcode_befund_nicht_gespeichert');
    expect(rundeOffen('k')).toMatchObject({ sperrend: ['ean_abweichend'], eanFoto: { befund: 'abweichend', ean: ANDERE, bestaetigt: true } });
    // nächster Morgen: das Foto ist heute unlesbar — gehalten wird trotzdem
    mockLage.updateFehler = () => false;
    mockAudit.set(doc('k').images.ean, '');
    mockWrites.length = 0;
    const b2 = await scharf();
    expect(doc('k').status).toBe('pending');
    expect(b2.wartetAufDich[0]).toMatchObject({ id: 'k', grund: 'ean_abweichend' });
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: ANDERE, befund: 'abweichend', bestaetigt: true });
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
      mockStore.set('cashback_config/v1', { fotoWorker: true });
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
      mockStore.set('cashback_config/v1', { fotoWorker: true });
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
    expect(b.preisBildschirm).toMatchObject({ bildschirmTrotzBon: 2, befundAblehnen: 0 });
    expect(b.warnungen.map((w) => w.code)).toContain('preisquelle_bon_als_bildschirm');
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
    const b = await scharf({ preisBildschirmRegel: true, preisBelegRegel: false });
    // nur das Lesen der Bon-Lage (bonWorker) — kein eigenes für die Schalter
    expect(mockLage.configLesungen).toBe(1);
    expect(b.preisBildschirm.modus).toBe(true);
    expect(b.preisBildschirm.beleg.modus).toBe(false);
    expect(mockLage.auditTexte[0]).not.toContain('belegMerkmale');
    expect(doc('schirm')).toMatchObject({ status: 'rejected', review: { reason: 'preis_bildschirm' } });
    // null (Feld fehlt im Dokument) = Beobachtung
    mockStore.clear(); mockListe.clear(); mockKopf.clear(); mockQuelle.clear(); schalter(true);
    mitPreisfoto('s2', 'bildschirm', png(1080, 2400));
    const b2 = await scharf({ preisBildschirmRegel: null, preisBelegRegel: null });
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
    expect(b.preisBildschirm).toMatchObject({ kassenbonOhneLesedienstBon: 2, kassenbonMitMerkmal: 3 });
    expect(b.warnungen.map((w) => w.code)).toContain('preisquelle_bon_widerspruch');
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
    const b2 = await scharf();
    expect(b2.notbremse.bildschirm).toBe(true);
    for (let i = 0; i < 4; i++) expect(doc(`s${i}`).status).toBe('pending');
    expect(b2.preisBildschirm).toMatchObject({ befundAblehnen: 0, stattFreigabe: 0, ausVortagen: 4, vorbefund: 4 });
  });
});
