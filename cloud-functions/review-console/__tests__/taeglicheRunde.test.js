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
const mockLage = { sperrenFehler: false, listeFehler: false, auditAufrufe: [], auditTexte: [], zweitLesungen: [] };
const mockSentinel = { __feld: 'serverTimestamp' };
const mockDelete = { __feld: 'delete' };
const mockListe = new Map(); // Pfad → { md5, size }
const mockAudit = new Map(); // Pfad des ean-Fotos → eanFoto-Antwort
const mockZweit = new Map(); // Pfad des ean-Fotos → Antwort der zweiten Lesung ('FEHLER' = wirft)
const mockCreate = new Map(); // Dokumentpfad → Server-Zeitpunkt (createTime), sonst keiner

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
function anwenden(pfad, daten, merge) {
  const vorher = merge ? mockStore.get(pfad) || {} : {};
  const neu = { ...vorher };
  for (const [k, v] of Object.entries(kopie(daten))) {
    if (v && v.__feld === 'delete') delete neu[k];
    else neu[k] = v;
  }
  // Wie crowd-upload-reward: eine Freigabe wird gebucht (sonst wartete die
  // Runde bis zu 5 Minuten auf die Buchung).
  if (pfad.startsWith('crowd_uploads/') && daten.status === 'approved') Object.assign(neu, { rewardResult: 'credited', rewardCents: 15 });
  mockStore.set(pfad, neu);
}
function docRef(pfad) {
  return {
    path: pfad, id: pfad.split('/').pop(),
    get: async () => snapshot(pfad, mockStore.get(pfad)),
    set: async (daten, opts) => { mockWrites.push({ path: pfad, art: 'set', data: kopie(daten) }); anwenden(pfad, daten, opts && opts.merge); },
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
        file: (p) => ({ getMetadata: async () => { const m = mockListe.get(p); if (!m) throw new Error('No such object'); return [{ md5Hash: m.md5, size: String(m.size) }]; } }),
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
          if (!text.includes('Du prüfst eine Produkt-Einreichung')) throw new Error('unerwarteter Aufruf (Nachlesen sollte nicht nötig sein)');
          mockLage.auditAufrufe.push(pfade);
          mockLage.auditTexte.push(text);
          const eanPfad = pfade.find((p) => p.includes('/ean'));
          const eanFoto = mockAudit.has(eanPfad) ? mockAudit.get(eanPfad) : (eanPfad || '').split('/')[1];
          return { text: JSON.stringify({ echt: true, loseWare: false, traegtAngaben: true, gleicheAnsicht: false, preisSichtbar: true, eanFoto, grund: 'ok' }) };
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
  mockLage.auditAufrufe = [];
  mockLage.auditTexte = [];
  mockLage.zweitLesungen = [];
  mockZweit.clear();
  mockCreate.clear();
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

  it('zweite Lesung liest die GESPEICHERTE Nummer → die erste war falsch gelesen, freigegeben', async () => {
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

  it('Barcode-Foto nicht lesbar oder Waagen-Code → kein Urteil, normal freigegeben', async () => {
    einreichung('a');
    einreichung('c', { uid: 'u3', ean: ANDERE });
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
