'use strict';

/**
 * Schalter cashback_config/v1.ocrDenkstufe (08.10.2026) — Denkstufe der
 * normalen Flash-Lesungen der Robust-OCR (Basis-Lesungen und Lesungen am
 * verbesserten Bild). Ab Werk aus.
 *
 * Hier läuft das ECHTE processCashback mit dem ECHTEN SDK @google/genai dieser
 * Codebase: den Anfragekörper baut das SDK selbst, abgefangen wird erst der
 * fetch (es geht nichts ins Netz). Ersetzt sind nur die Anmeldung an Vertex
 * (Schein-Client statt Application Default Credentials), Firestore/Storage
 * (helpers/fakeAdmin) und die Bildverbesserung (sharp kann die Schein-Bytes
 * nicht lesen).
 *
 * Belegt:
 *   - Schalter fehlt oder ungültig → jeder Anfragekörper BYTE-GLEICH zum Stand
 *     vor dem Schalter (SHA-256 in GOLDEN, mit genau diesen Szenarien auf
 *     7ffa95c2 aufgenommen, @google/genai 1.52.0).
 *   - 'LOW' zusammen mit ocrPrompt 'v1.5' → nur Basis- und Verbessert-Lesungen
 *     tragen thinkingConfig {thinkingLevel}; Eskalation und Zweitprüfung
 *     gleich wie ohne Schalter (Prüfrunde 08.10.).
 *   - 'LOW' ohne v1.5 (Prompt fehlt/v1.4) → wirkt nicht, byte-gleich, Warnung
 *     `ocr-denkstufe-ohne-v15`; 'MEDIUM'/'HIGH' sind nicht freigegeben
 *     (ungültig, byte-gleich, Warnung `ocr-denkstufe-ungueltig`).
 *   - Die Stufe steht am Bon (ocr.robust.denkstufe, je Lesung reads[].denkstufe)
 *     und überlebt den Cache-Pfad; ein Zwischenstand einer anderen Stufe wird
 *     verworfen, nie gemischt.
 *   - Vorrang vor CASHBACK_OCR_THINKING_BUDGET; Modelle ohne Denkstufen
 *     (vor Gemini 3) bekommen sie nicht.
 *
 * Neu aufnehmen (nur nach einer GEWOLLTEN Änderung am Anfragekörper, z. B.
 * SDK-Update): DENKSTUFE_AUFNAHME=1 → der Aufnahme-Test gibt die Hashes aus.
 */

jest.mock('firebase-admin', () => require('./helpers/fakeAdmin').erstelleFakeAdmin());
jest.mock('firebase-functions', () => ({
  logger: { info: (...a) => global.__logs.push(a), warn: (...a) => global.__logs.push(a), error: () => {}, debug: () => {} },
}));
jest.mock('firebase-functions/params', () => ({
  defineSecret: (name) => ({ name, value: () => undefined }),
}));
jest.mock('firebase-functions/v2/https', () => ({ onRequest: (_opts, h) => h }));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_opts, h) => h }));
jest.mock('firebase-functions/v2/pubsub', () => ({ onMessagePublished: (_opts, h) => h }));
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (_opts, h) => h }));
jest.mock('@google-cloud/pubsub', () => ({
  PubSub: class {
    topic() {
      return { publishMessage: async () => 'msg' };
    }
  },
}));
jest.mock('../lib/push', () => ({ sendCashbackReady: async () => {} }));
jest.mock('../lib/imageEnhance', () => ({ enhanceForOcr: async () => Buffer.from('verbessert') }));
// Echtes SDK; nur die Vertex-Anmeldung ist ein Schein-Client (sonst holte das
// SDK über google-auth-library ein Token aus dem Netz).
jest.mock('@google/genai', () => {
  const echt = jest.requireActual('@google/genai');
  const scheinAuth = { getRequestHeaders: async () => new Headers({ Authorization: 'Bearer schein' }) };
  class GoogleGenAI extends echt.GoogleGenAI {
    constructor(opts) {
      super(opts && opts.vertexai ? { ...opts, googleAuthOptions: { authClient: scheinAuth } } : opts);
    }
  }
  return { ...echt, GoogleGenAI };
});

// Alles, was Modell, Standort, Denken oder Leiter steuert, auf den Code-Standard
// — VOR dem Laden der Module (ocr.js und ocr_robust.js lesen die Env beim Laden).
const ENV = [
  'GEMINI_USE_VERTEX', 'GEMINI_API_KEY', 'GEMINI_VERTEX_LOCATION', 'GEMINI_VERTEX_LOCATION_PRO',
  'CASHBACK_OCR_ENGINE', 'CASHBACK_OCR_MODEL', 'CASHBACK_OCR_THINKING_BUDGET', 'CASHBACK_OCR_MAX_FLASH',
  'CASHBACK_OCR_READ_TIMEOUT_MS', 'CASHBACK_OCR_RUN_BUDGET_MS', 'CASHBACK_OCR_ESCALATION_CAP',
  'CASHBACK_OCR_PRO_MODEL', 'CASHBACK_OCR_PRO_THINKING_LEVEL', 'CASHBACK_OCR_PRO_LOCATION',
  'CASHBACK_OCR_PRO_FALLBACK_THINKING_LEVEL', 'CASHBACK_OCR_PRO_TIMEOUT_MS', 'CASHBACK_ESCALATE_DOCAI',
  'CASHBACK_OCR_REFEREE_MODEL', 'CASHBACK_OCR_REFEREE_FALLBACK_MODEL', 'CASHBACK_OCR_REFEREE_FALLBACK_LOCATION',
];
const gesichert = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
for (const k of ENV) delete process.env[k];
afterAll(() => {
  for (const k of ENV) {
    if (gesichert[k] === undefined) delete process.env[k];
    else process.env[k] = gesichert[k];
  }
});

const crypto = require('crypto');
const admin = require('firebase-admin');
const fn = require('../index');
const robustModul = require('../lib/ocr_robust');

const fake = admin.__fake;
const UID = 'denkstufeNutzer';
const TAG = 24 * 60 * 60 * 1000;
const GESTERN = new Date(Date.now() - TAG).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
const AUFNAHME = process.env.DENKSTUFE_AUFNAHME === '1';

/**
 * SHA-256 der Anfragekörper je Stufe (labels.zweck), aufgenommen am 08.10.2026
 * auf 7ffa95c2 — dem Stand VOR dem Schalter.
 */
const GOLDEN = {
  'bon-ocr': 'de662049c6e359f0bc4e5f05f4857f498b64d707126be69c1044a9c6034b2e3a',
  'bon-ocr-verbessert': 'f029bc917c755ec9de06bfaefdffab3625dd43c23ae2c3aa654547764a4c91be',
  'bon-ocr-eskalation': '88ab626974232ef8cb6fbd1529e4493bc48d2c0b4d5a1774e29c771fbc15211d',
  'bon-zweitpruefung': '4e6af74d58863db40f761ae78ead8a5ed99ef56f6fb6ee39157e5decb3555432',
};
/** Standort je Stufe (Teil der URL, nicht des Körpers) — ebenfalls unverändert. */
const STANDORT = {
  'bon-ocr': 'global',
  'bon-ocr-verbessert': 'global',
  'bon-ocr-eskalation': 'eu',
  'bon-zweitpruefung': 'global',
};
const standortVon = (url) => (/\/locations\/([^/]+)\//.exec(url) || [])[1] || null;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ─── fetch-Attrappe: nimmt jede Anfrage auf, antwortet wie Vertex ───────────

const echtesFetch = globalThis.fetch;
let anfragen;
let zaehler;
let einig;
/** Testnaht: läuft nach jeder Anfrage (z. B. Uhr vorstellen). */
let nachAnfrage;

/**
 * Jede Lesung mit anderen Artikelnamen → keine Einigung → die ganze Leiter
 * läuft (3 Basis, 2 verbessert, 2 Eskalation). Mit `einig` lesen alle gleich.
 */
function bonParsed(n) {
  const kennung = einig ? '' : String(n);
  return {
    isReceipt: true,
    merchant: 'Netto Marken-Discount',
    bonCountry: 'DE',
    bonDate: GESTERN,
    bonTime: '10:15',
    subtotalCents: 1000,
    totalCents: 1000,
    items: ['A', 'B', 'C', 'D', 'E'].map((b) => ({ name: `Artikel ${b}${kennung}`, priceCents: 200, qty: 1 })),
  };
}

beforeAll(() => {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    // global: aiplatform.googleapis.com, Multi-Region eu: aiplatform.eu.rep.googleapis.com
    if (!/aiplatform[^/]*\.googleapis\.com\/.*:generateContent$/.test(u)) throw new Error(`Netz im Test nicht erlaubt: ${u}`);
    const body = init && typeof init.body === 'string' ? init.body : '';
    const p = JSON.parse(body);
    anfragen.push({ url: u, body, json: p, zweck: (p.labels && p.labels.zweck) || null });
    zaehler += 1;
    if (nachAnfrage) nachAnfrage();
    const text = JSON.stringify(bonParsed(zaehler));
    const antwort = {
      candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 0 },
    };
    return new Response(JSON.stringify(antwort), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});
afterAll(() => {
  globalThis.fetch = echtesFetch;
});

// ─── Firestore-Aufbau und Lauf ─────────────────────────────────────────────

function konfig(extra = {}) {
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, payoutThresholdCents: 1000, ...extra });
}

function aufbauen(konfigExtra = {}) {
  fake.zuruecksetzen();
  konfig(konfigExtra);
  const jetzt = Date.now();
  fake.store.set('cashback_campaigns/c1', {
    kind: 'receipt', active: true, startAt: fake.zeit(jetzt - 10 * TAG), endAt: fake.zeit(jetzt + 10 * TAG),
    cashbackPerBonCents: 8, budgetRemainingCents: 5000,
  });
  fake.store.set('discounter/netto', { name: 'Netto Marken-Discount', land: 'DE' });
  fake.store.set(`users/${UID}`, { cashback_balance_cents: 0, cashback_lifetime_cents: 0 });
}

function bonAnlegen(id = 'b1', extra = {}) {
  fake.store.set(`receipts/${id}`, {
    userId: UID,
    status: 'ocr_pending',
    campaignId: 'c1',
    createdAt: fake.zeit(Date.now() - 60 * 60 * 1000),
    storage: { bucket: 'b', path: `cashback-uploads/${UID}/${id}.jpg` },
    ...extra,
  });
}

let ev = 0;
const verarbeiten = (id = 'b1') => fn.processCashback({ id: `ev-${id}-${++ev}`, data: { message: { json: { cashbackId: id, uid: UID } } } });

/** Ein frischer Bon, ganze Leiter. `wert` undefined = Feld fehlt in der Konfiguration. */
async function frischerLauf(wert, extra = {}) {
  aufbauen({ ...extra, ...(wert === undefined ? {} : { ocrDenkstufe: wert }) });
  bonAnlegen();
  await verarbeiten();
  return { anfragen: anfragen.slice(), bon: fake.store.get('receipts/b1') };
}

/** Gespeicherte Erstlesung mit angeforderter Zweitprüfung, Schalter ocrReferee an. */
async function zweitpruefungsLauf(wert, extra = {}) {
  aufbauen({ ocrReferee: true, ...extra, ...(wert === undefined ? {} : { ocrDenkstufe: wert }) });
  const falsch = { ...bonParsed(0), totalCents: 1234 };
  bonAnlegen('b1', {
    ocr: {
      engine: 'gemini-robust', model: 'gemini-3.5-flash', promptVersion: 'v1.4', parsed: falsch,
      robust: { confidence: 'none', attempts: 7, reads: [] },
      reconciliation: null,
      refereeRequest: { reason: 'reconciliation_delta', confidence: 'none' },
    },
  });
  await verarbeiten();
  return { anfragen: anfragen.slice(), bon: fake.store.get('receipts/b1') };
}

const nachZweck = (liste) => {
  const out = {};
  for (const a of liste) (out[a.zweck] = out[a.zweck] || []).push(a);
  return out;
};

/** Anfragekörper ohne die Denk-Konfiguration — für den Vergleich mit „fehlt". */
function ohneDenken(json) {
  const k = JSON.parse(JSON.stringify(json));
  if (k.generationConfig) delete k.generationConfig.thinkingConfig;
  return k;
}

beforeEach(() => {
  global.__logs = [];
  anfragen = [];
  zaehler = 0;
  einig = false;
  nachAnfrage = null;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ─── Aufnahme (nur mit DENKSTUFE_AUFNAHME=1) ───────────────────────────────

(AUFNAHME ? test : test.skip)('Aufnahme der Hashes (Stand vor dem Schalter)', async () => {
  const frisch = nachZweck((await frischerLauf(undefined)).anfragen);
  anfragen = [];
  const pruefung = nachZweck((await zweitpruefungsLauf(undefined)).anfragen);
  const alle = { ...frisch, ...pruefung };
  const aufnahme = {};
  for (const [zweck, liste] of Object.entries(alle)) {
    const hashes = [...new Set(liste.map((a) => sha(a.body)))];
    aufnahme[zweck] = { anzahl: liste.length, hashes, urls: [...new Set(liste.map((a) => a.url))] };
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(aufnahme, null, 2));
});

// ─── Tests ─────────────────────────────────────────────────────────────────

const golden = AUFNAHME ? describe.skip : describe;

golden('Schalter fehlt oder ungültig → Anfragen byte-gleich zum Stand vor dem Schalter', () => {
  test.each([
    ['fehlt', undefined],
    ['null', null],
    ['kleingeschrieben (low)', 'low'],
    ['MINIMAL (nicht freigegeben)', 'MINIMAL'],
    ['MEDIUM (nicht freigegeben)', 'MEDIUM'],
    ['HIGH (nicht freigegeben)', 'HIGH'],
    ['Tippfehler', 'LOWW'],
    ['Zahl', 0],
    ['Objekt', { thinkingLevel: 'LOW' }],
  ])('%s', async (_name, wert) => {
    const { anfragen: liste, bon } = await frischerLauf(wert);
    const z = nachZweck(liste);
    expect(Object.keys(z).sort()).toEqual(['bon-ocr', 'bon-ocr-eskalation', 'bon-ocr-verbessert']);
    expect(z['bon-ocr']).toHaveLength(3);
    expect(z['bon-ocr-verbessert']).toHaveLength(2);
    expect(z['bon-ocr-eskalation']).toHaveLength(2);
    for (const a of liste) {
      expect(sha(a.body)).toBe(GOLDEN[a.zweck]);
      expect(standortVon(a.url)).toBe(STANDORT[a.zweck]);
    }
    for (const a of [...z['bon-ocr'], ...z['bon-ocr-verbessert']]) {
      expect(a.json.generationConfig).not.toHaveProperty('thinkingConfig');
    }

    // Am Bon: keine Vorgabe; die Eskalation dokumentiert ihre eigene Stufe.
    expect(bon.ocr.robust.denkstufe).toBeNull();
    expect(bon.ocr.robust.reads).toHaveLength(7);
    for (const r of bon.ocr.robust.reads) {
      expect(r.denkstufe).toBe(r.model === 'pro' ? 'HIGH' : null);
    }
    const warnung = global.__logs.find(([m]) => m === 'ocr-denkstufe-ungueltig');
    if (wert === undefined || wert === null) expect(warnung).toBeUndefined();
    else expect(warnung).toBeDefined();
  });

  test.each([
    ['ocrPrompt fehlt', {}],
    ["ocrPrompt 'v1.4'", { ocrPrompt: 'v1.4' }],
    ['ocrPrompt ungültig', { ocrPrompt: 'V1.5' }],
  ])("'LOW' ohne Prompt v1.5 (%s) → wirkt nicht: byte-gleich, Warnung ocr-denkstufe-ohne-v15", async (_name, extra) => {
    const { anfragen: liste, bon } = await frischerLauf('LOW', extra);
    const z = nachZweck(liste);
    expect(z['bon-ocr']).toHaveLength(3);
    expect(z['bon-ocr-verbessert']).toHaveLength(2);
    for (const a of liste) {
      expect(sha(a.body)).toBe(GOLDEN[a.zweck]);
      expect(standortVon(a.url)).toBe(STANDORT[a.zweck]);
    }
    expect(bon.ocr.promptVersion).toBe('v1.4');
    expect(bon.ocr.robust.denkstufe).toBeNull();
    const warnung = global.__logs.find(([m]) => m === 'ocr-denkstufe-ohne-v15');
    expect(warnung).toBeDefined();
    expect(warnung[1]).toMatchObject({ denkstufe: 'LOW', promptVersion: 'v1.4' });
    expect(global.__logs.find(([m]) => m === 'ocr-denkstufe-ungueltig')).toBeUndefined();
  });

  test('Zweitprüfung ohne Schalter: Anfragen byte-gleich', async () => {
    const { anfragen: liste } = await zweitpruefungsLauf(undefined);
    expect(liste.length).toBeGreaterThan(0);
    for (const a of liste) {
      expect(a.zweck).toBe('bon-zweitpruefung');
      expect(sha(a.body)).toBe(GOLDEN['bon-zweitpruefung']);
      expect(standortVon(a.url)).toBe(STANDORT['bon-zweitpruefung']);
    }
  });
});

golden("Schalter 'LOW' mit Prompt v1.5 → nur Basis- und Verbessert-Lesungen denken mit LOW", () => {
  const V15 = { ocrPrompt: 'v1.5' };
  test('LOW', async () => {
    const stufe = 'LOW';
    // Vergleich: derselbe Lauf mit v1.5, aber ohne Denkstufe.
    const vorher = nachZweck((await frischerLauf(undefined, V15)).anfragen);
    anfragen = [];
    zaehler = 0;
    const { anfragen: liste, bon } = await frischerLauf(stufe, V15);
    const z = nachZweck(liste);
    expect(z['bon-ocr']).toHaveLength(3);
    expect(z['bon-ocr-verbessert']).toHaveLength(2);
    expect(z['bon-ocr-eskalation']).toHaveLength(2);
    expect(bon.ocr.promptVersion).toBe('v1.5');

    // Normale Lesungen: genau eine Änderung — thinkingConfig {thinkingLevel}.
    for (const a of liste) expect(standortVon(a.url)).toBe(STANDORT[a.zweck]);
    for (const zweck of ['bon-ocr', 'bon-ocr-verbessert']) {
      z[zweck].forEach((a, i) => {
        expect(a.json.generationConfig.thinkingConfig).toEqual({ thinkingLevel: stufe });
        expect(a.body).not.toMatch(/thinkingBudget/);
        expect(ohneDenken(a.json)).toEqual(vorher[zweck][i].json);
      });
    }
    // Eskalation: byte-gleich zum v1.5-Lauf ohne Schalter (eigene Stufe HIGH).
    z['bon-ocr-eskalation'].forEach((a, i) => {
      expect(a.body).toBe(vorher['bon-ocr-eskalation'][i].body);
      expect(a.json.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'HIGH' });
    });

    // Am Bon: Stufe der Leiter + je Lesung.
    expect(bon.ocr.robust.denkstufe).toBe(stufe);
    for (const r of bon.ocr.robust.reads) {
      expect(r.denkstufe).toBe(r.model === 'pro' ? 'HIGH' : stufe);
    }
    expect(global.__logs.find(([m]) => m === 'ocr-denkstufe-ungueltig')).toBeUndefined();
    expect(global.__logs.find(([m]) => m === 'ocr-denkstufe-ohne-v15')).toBeUndefined();
  });

  test("Zweitprüfung mit 'LOW' (+ v1.5): Anfragen byte-gleich zum Stand vor dem Schalter", async () => {
    const ohne = await zweitpruefungsLauf(undefined);
    anfragen = [];
    zaehler = 0;
    const mit = await zweitpruefungsLauf('LOW', V15);
    expect(mit.anfragen.length).toBe(ohne.anfragen.length);
    expect(mit.anfragen.length).toBeGreaterThan(0);
    for (const a of mit.anfragen) {
      expect(a.zweck).toBe('bon-zweitpruefung');
      expect(sha(a.body)).toBe(GOLDEN['bon-zweitpruefung']);
    }
  });
});

golden('Cache-Pfad und Zwischenstand', () => {
  /** Am Bon gespeichertes Ergebnis, wie buildOcrField es ablegt. */
  const gespeicherteOcr = (denkstufe) => ({
    engine: 'gemini-robust', model: 'gemini-3.5-flash', promptVersion: 'v1.4',
    parsed: { ...bonParsed(0), items: bonParsed(0).items.slice(0, 4).concat([{ name: 'Artikel E0', priceCents: 200, qty: 1 }]) },
    robust: {
      confidence: 'high', method: 'flash-agreement', attempts: 2, denkstufe,
      reads: [{ model: 'flash', denkstufe, reconOk: true }, { model: 'flash', denkstufe, reconOk: true }],
    },
    reconciliation: null,
  });

  test.each([[undefined, 'LOW'], ['LOW', 'LOW'], ['LOW', undefined], [null, 'HIGH']])(
    'gespeicherte Lesung (Stufe %s), Schalter jetzt %s → kein Modellaufruf, die gespeicherte Stufe bleibt am Bon',
    async (gespeichert, schalter) => {
      aufbauen(schalter === undefined ? {} : { ocrDenkstufe: schalter });
      const ocr = gespeicherteOcr(gespeichert ?? null);
      if (gespeichert === undefined) {
        // Bon von vor dem Schalter: das Feld gibt es gar nicht.
        delete ocr.robust.denkstufe;
        for (const r of ocr.robust.reads) delete r.denkstufe;
      }
      bonAnlegen('b1', { ocr });
      await verarbeiten();

      expect(anfragen).toHaveLength(0);
      const bon = fake.store.get('receipts/b1');
      expect(bon.status).toBe('approved');
      if (gespeichert === undefined) {
        expect(bon.ocr.robust).not.toHaveProperty('denkstufe');
      } else {
        expect(bon.ocr.robust.denkstufe).toBe(gespeichert);
        expect(bon.ocr.robust.reads.map((r) => r.denkstufe)).toEqual([gespeichert, gespeichert]);
      }
    },
  );

  /** Zwischenstand nach einer Basis-Lesung (wie ocr_robust ihn ablegt). */
  function zwischenstand(denkstufe, promptVersion = 'v1.4') {
    const lesung = {
      stufe: 'flash', parsed: bonParsed(0), model: 'gemini-3.5-flash', promptVersion,
      latencyMs: 1, finishReason: 'STOP', inputTokens: 1, outputTokens: 1, thoughtsTokens: 0,
    };
    const stand = {
      v: 1, model: 'gemini-3.5-flash', eskModel: robustModul.ESKALATION.model, promptVersion,
      maxFlash: robustModul.MAX_FLASH, gespeichertMs: Date.now() - 1000, laeufe: 1,
      flash: 1, enh: 0, esk: 0, ersatz: 0, zeitAbbrueche: 0, failed: [], reads: [lesung],
    };
    if (denkstufe !== undefined) {
      stand.denkstufe = denkstufe;
      lesung.denkstufe = denkstufe;
    }
    return stand;
  }

  test('Zwischenstand von vor dem Schalter, Schalter fehlt → fortgesetzt wie bisher', async () => {
    aufbauen();
    bonAnlegen('b1', { ocrZwischenstand: zwischenstand(undefined), ocrFortsetzungen: 1 });
    await verarbeiten();

    const z = nachZweck(anfragen);
    expect(z['bon-ocr']).toHaveLength(2);
    for (const a of z['bon-ocr']) expect(sha(a.body)).toBe(GOLDEN['bon-ocr']);
    expect(console.warn).not.toHaveBeenCalledWith('ocr-zwischenstand-verworfen', expect.anything());
    const bon = fake.store.get('receipts/b1');
    expect(bon.ocr.robust).toMatchObject({ laeufe: 2, attempts: 7, denkstufe: null });
    // Die gespeicherte Lesung von vor dem Schalter: Stufe unbekannt, kein Feld.
    expect(bon.ocr.robust.reads[0]).not.toHaveProperty('denkstufe');
    expect(bon.ocrZwischenstand).toBeUndefined();
  });

  test("Zwischenstand ohne Stufe (v1.5), Schalter jetzt 'LOW' → verworfen, frisch mit LOW gelesen (nie gemischt)", async () => {
    aufbauen({ ocrDenkstufe: 'LOW', ocrPrompt: 'v1.5' });
    bonAnlegen('b1', { ocrZwischenstand: zwischenstand(undefined, 'v1.5'), ocrFortsetzungen: 1 });
    await verarbeiten();

    const z = nachZweck(anfragen);
    expect(z['bon-ocr']).toHaveLength(3);
    for (const a of z['bon-ocr']) expect(a.json.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(console.warn).toHaveBeenCalledWith('ocr-zwischenstand-verworfen', { grund: 'denkstufe' });
    const bon = fake.store.get('receipts/b1');
    expect(bon.ocr.robust).toMatchObject({ laeufe: 2, attempts: 7, denkstufe: 'LOW' });
    expect(bon.ocr.robust.reads.filter((r) => r.model !== 'pro').every((r) => r.denkstufe === 'LOW')).toBe(true);
  });

  test("Zwischenstand unter 'LOW', Schalter weiter 'LOW' → fortgesetzt, auch die gespeicherte Lesung trägt LOW", async () => {
    aufbauen({ ocrDenkstufe: 'LOW', ocrPrompt: 'v1.5' });
    bonAnlegen('b1', { ocrZwischenstand: zwischenstand('LOW', 'v1.5'), ocrFortsetzungen: 1 });
    await verarbeiten();

    const z = nachZweck(anfragen);
    expect(z['bon-ocr']).toHaveLength(2);
    expect(console.warn).not.toHaveBeenCalledWith('ocr-zwischenstand-verworfen', expect.anything());
    const bon = fake.store.get('receipts/b1');
    expect(bon.ocr.robust).toMatchObject({ laeufe: 2, denkstufe: 'LOW' });
    expect(bon.ocr.robust.reads[0].denkstufe).toBe('LOW');
  });

  test("Zwischenstand unter 'LOW', Schalter zurückgenommen → verworfen, frisch ohne Vorgabe", async () => {
    aufbauen();
    bonAnlegen('b1', { ocrZwischenstand: zwischenstand('LOW'), ocrFortsetzungen: 1 });
    await verarbeiten();

    const z = nachZweck(anfragen);
    expect(z['bon-ocr']).toHaveLength(3);
    for (const a of z['bon-ocr']) expect(sha(a.body)).toBe(GOLDEN['bon-ocr']);
    expect(console.warn).toHaveBeenCalledWith('ocr-zwischenstand-verworfen', { grund: 'denkstufe' });
    expect(fake.store.get('receipts/b1').ocr.robust.denkstufe).toBeNull();
  });

  test("Zwischenstand unter 'LOW' (v1.5), nur die Stufe entfernt → verworfen, frisch v1.5 ohne Vorgabe", async () => {
    aufbauen({ ocrPrompt: 'v1.5' });
    bonAnlegen('b1', { ocrZwischenstand: zwischenstand('LOW', 'v1.5'), ocrFortsetzungen: 1 });
    await verarbeiten();

    const z = nachZweck(anfragen);
    expect(z['bon-ocr']).toHaveLength(3);
    for (const a of z['bon-ocr']) expect(a.json.generationConfig).not.toHaveProperty('thinkingConfig');
    expect(console.warn).toHaveBeenCalledWith('ocr-zwischenstand-verworfen', { grund: 'denkstufe' });
    const bon = fake.store.get('receipts/b1');
    expect(bon.ocr.promptVersion).toBe('v1.5');
    expect(bon.ocr.robust.denkstufe).toBeNull();
  });

  test("Zwischenstand unter 'LOW' (v1.5), nur der Prompt zurückgenommen → verworfen, frisch wie vor dem Schalter", async () => {
    aufbauen({ ocrDenkstufe: 'LOW' });
    bonAnlegen('b1', { ocrZwischenstand: zwischenstand('LOW', 'v1.5'), ocrFortsetzungen: 1 });
    await verarbeiten();

    const z = nachZweck(anfragen);
    expect(z['bon-ocr']).toHaveLength(3);
    for (const a of z['bon-ocr']) expect(sha(a.body)).toBe(GOLDEN['bon-ocr']);
    // Der Prompt passt zuerst nicht — verworfen wird also wegen des Prompts.
    expect(console.warn).toHaveBeenCalledWith('ocr-zwischenstand-verworfen', { grund: 'prompt' });
    expect(global.__logs.find(([m]) => m === 'ocr-denkstufe-ohne-v15')).toBeDefined();
    const bon = fake.store.get('receipts/b1');
    expect(bon.ocr.promptVersion).toBe('v1.4');
    expect(bon.ocr.robust.denkstufe).toBeNull();
  });
});

golden('Robust-Leiter direkt', () => {
  test('Vorrang vor CASHBACK_OCR_THINKING_BUDGET: Env 0 + Schalter LOW → nur thinkingLevel; ohne Schalter wie heute thinkingBudget 0', async () => {
    process.env.CASHBACK_OCR_THINKING_BUDGET = '0';
    let robust;
    try {
      jest.isolateModules(() => {
        robust = require('../lib/ocr_robust');
      });
      einig = true;
      await robust.extractReceiptRobust(Buffer.from('bon'), 'image/jpeg', { denkstufe: 'LOW', promptVersion: 'v1.5' });
      await robust.extractReceiptRobust(Buffer.from('bon'), 'image/jpeg', {});
    } finally {
      delete process.env.CASHBACK_OCR_THINKING_BUDGET;
    }
    expect(anfragen).toHaveLength(4);
    for (const a of anfragen.slice(0, 2)) {
      expect(a.json.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
      expect(a.body).not.toMatch(/thinkingBudget/);
    }
    for (const a of anfragen.slice(2)) expect(a.json.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  test('Modell ohne Denkstufen (vor Gemini 3) → Schalter wirkt nicht, Bon dokumentiert keine Stufe, Warnung', async () => {
    einig = true;
    const out = await robustModul.extractReceiptRobust(Buffer.from('bon'), 'image/jpeg', { model: 'gemini-2.5-flash', denkstufe: 'LOW', promptVersion: 'v1.5' });
    expect(anfragen).toHaveLength(2);
    for (const a of anfragen) expect(a.json.generationConfig).not.toHaveProperty('thinkingConfig');
    expect(out.robust.denkstufe).toBeNull();
    expect(out.robust.reads.map((r) => r.denkstufe)).toEqual([null, null]);
    expect(console.warn).toHaveBeenCalledWith('ocr-denkstufe-ignoriert', { model: 'gemini-2.5-flash', denkstufe: 'LOW' });
  });

  test('ungültiger Wert direkt an die Leiter → wie fehlt', async () => {
    einig = true;
    const out = await robustModul.extractReceiptRobust(Buffer.from('bon'), 'image/jpeg', { denkstufe: 'low' });
    for (const a of anfragen) {
      expect(a.json.generationConfig).not.toHaveProperty('thinkingConfig');
      // Gleiche Bytes ('bon'), gleicher Prompt, gleiche Stufe wie die Basis-Lesung im Lauf.
      expect(sha(a.body)).toBe(GOLDEN['bon-ocr']);
    }
    expect(out.robust.denkstufe).toBeNull();
  });

  test.each([
    ['ohne promptVersion (v1.4)', {}],
    ["promptVersion 'v1.4'", { promptVersion: 'v1.4' }],
  ])("'LOW' direkt an die Leiter %s → keine Vorgabe, byte-gleich, Warnung ocr-denkstufe-ohne-v15", async (_name, extra) => {
    einig = true;
    const out = await robustModul.extractReceiptRobust(Buffer.from('bon'), 'image/jpeg', { denkstufe: 'LOW', ...extra });
    expect(anfragen).toHaveLength(2);
    for (const a of anfragen) {
      expect(a.json.generationConfig).not.toHaveProperty('thinkingConfig');
      expect(sha(a.body)).toBe(GOLDEN['bon-ocr']);
    }
    expect(out.robust.denkstufe).toBeNull();
    expect(out.robust.reads.map((r) => r.denkstufe)).toEqual([null, null]);
    expect(console.warn).toHaveBeenCalledWith('ocr-denkstufe-ohne-v15', { promptVersion: 'v1.4', denkstufe: 'LOW' });
  });

  test("'MEDIUM'/'HIGH' direkt an die Leiter (auch mit v1.5) → nicht freigegeben, keine Vorgabe", async () => {
    einig = true;
    for (const stufe of ['MEDIUM', 'HIGH']) {
      const out = await robustModul.extractReceiptRobust(Buffer.from('bon'), 'image/jpeg', { denkstufe: stufe, promptVersion: 'v1.5' });
      expect(out.robust.denkstufe).toBeNull();
    }
    expect(anfragen).toHaveLength(4);
    for (const a of anfragen) expect(a.json.generationConfig).not.toHaveProperty('thinkingConfig');
  });

  test('Laufbudget erreicht → Zwischenstand trägt die Stufe (Stand + je Lesung, Firestore-tauglich) und wird damit fortgesetzt', async () => {
    let uhr = 1_000_000;
    const zeit = { budgetMs: 200_000, leseLimitMs: 170_000, reserveMs: 30_000 };
    const opts = { denkstufe: 'LOW', promptVersion: 'v1.5', zeit, clock: () => uhr, enhance: async () => null };
    // Jede Lesung „dauert" 40 s: nach den ersten beiden passt kein Fenster mehr.
    nachAnfrage = () => { uhr += 40_000; };
    let fehler = null;
    try {
      await robustModul.extractReceiptRobust(Buffer.from('bon'), 'image/jpeg', { ...opts, laufStart: uhr });
    } catch (e) {
      fehler = e;
    }
    expect(fehler && fehler.code).toBe('ocr_zeitbudget');
    const stand = fehler.zwischenstand;
    expect(stand.denkstufe).toBe('LOW');
    expect(stand.reads.map((r) => r.denkstufe)).toEqual(['LOW', 'LOW']);
    // Keine undefined-Werte (Firestore lehnte sie ab; toEqual sähe sie nicht).
    const undefinedPfade = (o, pfad = '') => (o && typeof o === 'object'
      ? Object.entries(o).flatMap(([k, v]) => (v === undefined ? [`${pfad}${k}`] : undefinedPfade(v, `${pfad}${k}.`)))
      : []);
    expect(undefinedPfade(stand)).toEqual([]);

    // Nächster Lauf: dieselbe Stufe → fortgesetzt (Basis 3, Eskalation 2).
    nachAnfrage = null;
    anfragen = [];
    const out = await robustModul.extractReceiptRobust(Buffer.from('bon'), 'image/jpeg', { ...opts, laufStart: uhr, zwischenstand: JSON.parse(JSON.stringify(stand)) });
    expect(anfragen.map((a) => a.zweck)).toEqual(['bon-ocr', 'bon-ocr-eskalation', 'bon-ocr-eskalation']);
    expect(anfragen[0].json.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(out.robust).toMatchObject({ denkstufe: 'LOW', laeufe: 2, attempts: 5 });
    expect(out.robust.reads.map((r) => r.denkstufe)).toEqual(['LOW', 'LOW', 'LOW', 'HIGH', 'HIGH']);
    expect(console.warn).not.toHaveBeenCalledWith('ocr-zwischenstand-verworfen', expect.anything());
  });

  test('zwischenstandLaden: andere Stufe → grund denkstufe; fehlendes Feld zählt als „keine Vorgabe"', () => {
    const basis = {
      v: 1, model: 'gemini-3.5-flash', eskModel: robustModul.ESKALATION.model, promptVersion: 'v1.4',
      maxFlash: robustModul.MAX_FLASH, gespeichertMs: 1000, laeufe: 1,
      flash: 0, enh: 0, esk: 0, ersatz: 0, zeitAbbrueche: 0, failed: [], reads: [],
    };
    const laden = (roh, denkstufe) => robustModul.zwischenstandLaden(roh, {
      model: 'gemini-3.5-flash', eskModel: robustModul.ESKALATION.model, maxFlash: robustModul.MAX_FLASH, jetzt: 2000, denkstufe,
    });
    expect(laden(basis, null).grund).toBeNull();
    expect(laden(basis, undefined).grund).toBeNull();
    expect(laden(basis, 'LOW').grund).toBe('denkstufe');
    expect(laden({ ...basis, denkstufe: 'LOW' }, 'LOW').grund).toBeNull();
    expect(laden({ ...basis, denkstufe: 'LOW' }, null).grund).toBe('denkstufe');
    expect(laden({ ...basis, denkstufe: 'HIGH' }, 'LOW').grund).toBe('denkstufe');
  });
});

describe('denkstufeAus', () => {
  const { denkstufeAus } = require('../lib/geminiModelle');
  test.each([
    // Nur LOW ist gemessen und freigegeben (Prüfrunde 08.10.).
    ['LOW', 'LOW'], ['MEDIUM', null], ['HIGH', null],
    [undefined, null], [null, null], ['', null], ['low', null], ['MINIMAL', null], [' LOW', null],
    [0, null], [true, null], [{ thinkingLevel: 'LOW' }, null], [['LOW'], null],
  ])('%p → %p', (wert, erwartet) => {
    expect(denkstufeAus(wert)).toBe(erwartet);
  });
});

describe('ocrDenkstufeWirksam (Kopplung an Prompt v1.5)', () => {
  const { ocrDenkstufeWirksam } = require('../lib/geminiModelle');
  test.each([
    [undefined, 'v1.5', { denkstufe: null, grund: null }],
    [null, 'v1.4', { denkstufe: null, grund: null }],
    ['LOW', 'v1.5', { denkstufe: 'LOW', grund: null }],
    ['LOW', 'v1.4', { denkstufe: null, grund: 'ohne_v15' }],
    ['LOW', undefined, { denkstufe: null, grund: 'ohne_v15' }],
    ['MEDIUM', 'v1.5', { denkstufe: null, grund: 'ungueltig' }],
    ['HIGH', 'v1.5', { denkstufe: null, grund: 'ungueltig' }],
    ['low', 'v1.5', { denkstufe: null, grund: 'ungueltig' }],
    ['HIGH', 'v1.4', { denkstufe: null, grund: 'ungueltig' }],
  ])('%p mit %p → %p', (wert, pv, erwartet) => {
    expect(ocrDenkstufeWirksam(wert, pv)).toEqual(erwartet);
  });
});
