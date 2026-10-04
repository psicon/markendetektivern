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
const mockLage = { sperrenFehler: false, listeFehler: false, auditAufrufe: [], auditTexte: [], zweitLesungen: [], updateFehler: () => false, txUpdateFehler: () => false };
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
          if (eanFoto === 'AUDIT_FEHLER') throw new Error('INVALID_ARGUMENT Bild nicht lesbar');
          if (mockLage.nachAudit) mockLage.nachAudit();
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
  mockLage.updateFehler = () => false;
  mockLage.txUpdateFehler = () => false;
  mockLage.nachAudit = null;
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
