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
const mockLage = { sperrenFehler: false, listeFehler: false, auditAufrufe: [], auditTexte: [], zweitLesungen: [], leserAufrufe: [], downloadFehler: () => false, updateFehler: () => false, txUpdateFehler: () => false };
const mockSentinel = { __feld: 'serverTimestamp' };
const mockDelete = { __feld: 'delete' };
const mockListe = new Map(); // Pfad → { md5, size }
const mockAudit = new Map(); // Pfad des ean-Fotos → eanFoto-Antwort
const mockZweit = new Map(); // Pfad des ean-Fotos → Antwort der zweiten Lesung ('FEHLER' = wirft)
// Pfad des ean-Fotos → Ergebnis des Strichcode-Lesers ({gelesen:[…]} | {fehler}). Ohne
// Eintrag liest er, was die Bildprüfung dort liest (falls gültige GTIN), sonst nichts.
const mockStriche = new Map();
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
    get: async () => snapshot(pfad, mockStore.get(pfad)),
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
          // Original für den Strichcode-Leser: der „Inhalt" ist der Pfad (der Leser-Mock schlägt damit nach).
          download: async () => { if (mockLage.downloadFehler(p)) throw new Error('download 503'); return [Buffer.from(p)]; },
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
          if (!text.includes('Du prüfst eine Produkt-Einreichung')) throw new Error('unerwarteter Aufruf (Nachlesen sollte nicht nötig sein)');
          mockLage.auditAufrufe.push(pfade);
          mockLage.auditTexte.push(text);
          const eanPfad = pfade.find((p) => p.includes('/ean'));
          const eanFoto = mockAudit.has(eanPfad) ? mockAudit.get(eanPfad) : (eanPfad || '').split('/')[1];
          if (eanFoto === 'AUDIT_FEHLER') throw new Error('INVALID_ARGUMENT Bild nicht lesbar');
          if (mockLage.nachAudit) mockLage.nachAudit();
          return { text: JSON.stringify({ echt: true, loseWare: false, traegtAngaben: true, gleicheAnsicht: false, preisSichtbar: true, eanFoto, grund: 'ok' }) };
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
  mockLage.leserAufrufe = [];
  mockLage.downloadFehler = () => false;
  mockStriche.clear();
  mockLage.updateFehler = () => false;
  mockLage.txUpdateFehler = () => false;
  mockLage.nachAudit = null;
  mockZweit.clear();
  mockCreate.clear();
  dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => T0);
  mockStore.set('cashback_config/v1', { fotoWorker: true, barcodeKorrektur: true });
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
    mockLage.nachAudit = () => dateSpy.mockImplementation(() => T0 + 19 * 60 * 1000);
    await scharf();
    expect(mockLage.zweitLesungen).toEqual([]);
    expect(doc('k').status).toBe('pending');
    expect(doc('k').eanFotoOcr).toMatchObject({ ean: ANDERE, befund: 'abweichend', bestaetigt: false, fehler: 'zeit_abgelaufen' });
  });

  it('eanFotoOcr nicht speicherbar → Halte-Befund steht in review.rundeOffen; der nächste Lauf hält damit und repariert eanFotoOcr', async () => {
    einreichung('k', { ean: KFS });
    mockAudit.set(doc('k').images.ean, ANDERE);
    mockZweit.set(doc('k').images.ean, 'FEHLER'); // unbestätigt → keine Korrektur
    mockLage.updateFehler = (pfad, daten) => !!daten.eanFotoOcr;
    const b = await scharf();
    expect(doc('k').eanFotoOcr).toBeUndefined();
    expect(b.eanFotoNichtGespeichert).toBe(1);
    expect(b.warnungen.map((w) => w.code)).toContain('barcode_befund_nicht_gespeichert');
    expect(rundeOffen('k')).toMatchObject({ sperrend: ['ean_abweichend'], eanFoto: { befund: 'abweichend', ean: ANDERE, bestaetigt: false } });
    // nächster Morgen: das Foto ist heute unlesbar — gehalten wird trotzdem
    mockLage.updateFehler = () => false;
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
      expect(mockLage.leserAufrufe).toEqual([]); // keine zweite Korrektur → kein Leser
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

    it('2c: Halt, Tag 1 Widerspruch, Tag 2 Bildprüfung scheitert, Tag 3 nichts lesbar → nie korrigiert', async () => {
      einreichung('k', halt);
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
      expect(mockLage.leserAufrufe).toEqual([]); // kein Kandidat → der Leser läuft gar nicht
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
    for (const [id, , , text] of faelle) {
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
    for (const id of ['vollkorn', 'fusilli']) {
      expect(doc(id).status).toBe('pending');
      expect(doc(id).eanKorrektur).toBeUndefined();
    }
    expect(b.abgelehnt).toBe(0);
    expect(b.eanKorrektur).toMatchObject({ korrigiert: 0, kandidaten: 2, leser: { widerspricht: 1, nicht_gelesen: 1 } });
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
    expect(mockLage.leserAufrufe).toEqual([]);
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
