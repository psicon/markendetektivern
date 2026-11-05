'use strict';

/**
 * Prompt-Schalter im ECHTEN processCashback (05.10.2026):
 *
 *   - ohne/ungültiger `cashback_config/v1.ocrPrompt` → jede Lesung mit v1.4,
 *     'v1.5' → jede Lesung mit v1.5; die Version steht am Bon.
 *   - OCR-Cache: ein gespeichertes Ergebnis behält seine Version und wird nicht
 *     neu gelesen; ein Zwischenstand der anderen Version wird verworfen.
 *   - Zweitprüfung liest mit der Version der Erstlesung, nicht des Schalters.
 *   - Coupon-Bon unter v1.5: Rabattzeile mit negativem Preis, bezahlt, die Zeile
 *     zählt nicht als Artikel und wird kein gekauftes Produkt.
 *   - Bestandsschutz und Doppel-Schutz über den Versionswechsel hinweg.
 *
 * Nur der Modellaufruf ist eine Attrappe — Leiter, Abgleich, Gates und Ledger
 * sind echt, Firestore ist die Attrappe aus helpers/fakeAdmin.
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
jest.mock('../lib/ocr', () => {
  const echt = jest.requireActual('../lib/ocr');
  return { ...echt, extractReceipt: (...args) => global.__extract(...args) };
});
jest.mock('../lib/imageEnhance', () => ({ enhanceForOcr: async () => Buffer.from('verbessert') }));

const admin = require('firebase-admin');
const fn = require('../index');
const PROMPT = require('../lib/prompt');
const REFEREE = require('../lib/prompt_referee');
const { identitaet } = require('../lib/doppelBon');

const fake = admin.__fake;
const UID = 'schalterNutzer';
const TAG = 24 * 60 * 60 * 1000;
const GESTERN = new Date(Date.now() - TAG).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });

let aufrufe;
let antworten;

// Ein Rossmann-ähnlicher Coupon-Bon: 5 Artikel à 2 €, Zwischensumme 10 €,
// 10 % Coupon, Endbetrag 9 €.
const ARTIKEL = ['Shampoo', 'Duschgel', 'Zahnpasta', 'Seife', 'Creme'].map((name) => ({ name, priceCents: 200, qty: 1 }));
const KOPF = { isReceipt: true, merchant: 'Netto Marken-Discount', bonCountry: 'DE', bonDate: GESTERN, bonTime: '10:15', subtotalCents: 1000, totalCents: 900 };
/** v1.4 rechnete den Coupon in einen Artikelpreis ein (Netto-Preise, keine Rabattzeile). */
const parsedV14 = () => ({ ...KOPF, items: [...ARTIKEL.slice(0, 4), { ...ARTIKEL[4], priceCents: 100 }] });
/** v1.5: Artikel wie gedruckt, Coupon als negative Zeile. */
const parsedV15 = (coupon = 100, extra = {}) => ({
  ...KOPF,
  totalCents: 1000 - coupon,
  belegart: 'kassenbon',
  bestellnummer: null,
  bonComplete: true,
  items: [...ARTIKEL, { name: '10% COUPONAKTION', priceCents: -coupon, qty: 1, category: 'Warenkorbrabatt', raw: `10% COUPONAKTION -${(coupon / 100).toFixed(2).replace('.', ',')}` }],
  ...extra,
});

/** Antwortet wie extractReceipt: Etikett und Modell aus den Aufruf-Optionen. */
async function extractAttrappe(bytes, mime, opts) {
  aufrufe.push(opts);
  const parsed = antworten.shift();
  if (!parsed) throw new Error('keine Antwort mehr vorgesehen');
  return { parsed: JSON.parse(JSON.stringify(parsed)), model: opts.model, promptVersion: opts.promptVersion, latencyMs: 1, finishReason: 'STOP', inputTokens: 1, outputTokens: 1, thoughtsTokens: 0, raw: '{}' };
}

function konfig(extra = {}) {
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, payoutThresholdCents: 1000, ...extra });
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

/** Am Bon gespeichertes OCR-Ergebnis einer Version (wie buildOcrField es ablegt). */
function gespeicherteOcr(promptVersion, parsed, extra = {}) {
  return {
    engine: 'gemini-robust',
    model: 'gemini-3.5-flash',
    promptVersion,
    parsed,
    robust: { confidence: 'high', attempts: 2, reads: [] },
    reconciliation: null,
    ...extra,
  };
}

let ev = 0;
const verarbeiten = (id = 'b1') => fn.processCashback({ id: `ev-${id}-${++ev}`, data: { message: { json: { cashbackId: id, uid: UID } } } });
const ledger = () => [...fake.store.entries()].filter(([k]) => k.startsWith(`users/${UID}/cashback_ledger/`)).map(([, v]) => v);
const gekauft = (id) => [...fake.store.entries()].filter(([k, v]) => k.startsWith(`users/${UID}/purchased_products/`) && v.receiptId === id).map(([, v]) => v);

beforeEach(() => {
  fake.zuruecksetzen();
  global.__logs = [];
  global.__extract = extractAttrappe;
  aufrufe = [];
  antworten = [];
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  konfig();
  const jetzt = Date.now();
  fake.store.set('cashback_campaigns/c1', {
    kind: 'receipt', active: true, startAt: fake.zeit(jetzt - 10 * TAG), endAt: fake.zeit(jetzt + 10 * TAG),
    cashbackPerBonCents: 8, budgetRemainingCents: 5000,
  });
  fake.store.set('discounter/netto', { name: 'Netto Marken-Discount', land: 'DE' });
  fake.store.set(`users/${UID}`, { cashback_balance_cents: 0, cashback_lifetime_cents: 0 });
});

afterEach(() => jest.restoreAllMocks());

describe('Schalter ocrPrompt → Version jeder Lesung', () => {
  test.each([
    ['fehlt', undefined, 'v1.4'],
    ['v1.4', 'v1.4', 'v1.4'],
    ['v1.5', 'v1.5', 'v1.5'],
    // Seit 08.10.2026 gültig (lib/prompt.js v1.6, Schema wie v1.5).
    ['v1.6', 'v1.6', 'v1.6'],
    ['ungültig (V1.5)', 'V1.5', 'v1.4'],
    ['ungültig (V1.6)', 'V1.6', 'v1.4'],
    ['ungültig (v1.7)', 'v1.7', 'v1.4'],
  ])('Schalter %s → %s', async (_name, wert, version) => {
    konfig(wert === undefined ? {} : { ocrPrompt: wert });
    bonAnlegen();
    antworten = version === 'v1.4' ? [parsedV14(), parsedV14()] : [parsedV15(), parsedV15()];
    await verarbeiten();

    const p = PROMPT.promptFuer(version);
    expect(aufrufe).toHaveLength(2);
    for (const o of aufrufe) {
      expect(o).toMatchObject({ promptVersion: version, systemInstruction: p.SYSTEM_PROMPT, responseSchema: p.RESPONSE_SCHEMA });
    }
    const bon = fake.store.get('receipts/b1');
    expect(bon.ocr.promptVersion).toBe(version);
    expect(bon).toMatchObject({ status: 'approved', cashbackCents: 8 });
    if (version === 'v1.4') {
      // Eine v1.4-Lesung bekommt keine v1.5-Felder dazu.
      for (const k of ['belegart', 'bestellnummer', 'bonComplete', 'summeAusArtikeln', 'onlineMerkmal']) expect(bon.ocr.parsed).not.toHaveProperty(k);
    }
  });
});

describe('OCR-Cache und Zwischenstand beim Umschalten', () => {
  test('gespeicherte v1.4-Lesung, Schalter jetzt v1.5 → kein neuer Modellaufruf, Version bleibt v1.4', async () => {
    konfig({ ocrPrompt: 'v1.5' });
    bonAnlegen('b1', { ocr: gespeicherteOcr('v1.4', parsedV14()) });
    await verarbeiten();

    expect(aufrufe).toHaveLength(0);
    const bon = fake.store.get('receipts/b1');
    expect(bon.ocr.promptVersion).toBe('v1.4');
    expect(bon.ocr.parsed).not.toHaveProperty('belegart');
    expect(bon).toMatchObject({ status: 'approved', cashbackCents: 8 });
  });

  test('gespeicherte v1.5-Lesung, Schalter zurück auf v1.4 → bleibt v1.5 (mit Rabattzeile), kein Modellaufruf', async () => {
    konfig({ ocrPrompt: 'v1.4' });
    bonAnlegen('b1', { ocr: gespeicherteOcr('v1.5', parsedV15()) });
    await verarbeiten();

    expect(aufrufe).toHaveLength(0);
    const bon = fake.store.get('receipts/b1');
    expect(bon.ocr.promptVersion).toBe('v1.5');
    expect(bon.ocr.reconciliation).toMatchObject({ ok: true, direction: 'basket_discount', basketDiscountCents: 100 });
    expect(bon).toMatchObject({ status: 'approved', cashbackCents: 8 });
  });

  test('Zwischenstand der Leiter unter v1.4, Schalter jetzt v1.5 → verworfen, frisch mit v1.5, keine v1.4-Lesung im Ergebnis', async () => {
    konfig({ ocrPrompt: 'v1.5' });
    const v14Lesung = { stufe: 'flash', parsed: parsedV14(), model: 'gemini-3.5-flash', promptVersion: 'v1.4', latencyMs: 1, finishReason: 'STOP', inputTokens: 1, outputTokens: 1, thoughtsTokens: 0 };
    bonAnlegen('b1', {
      ocrZwischenstand: {
        v: 1, model: 'gemini-3.5-flash', eskModel: require('../lib/ocr_robust').ESKALATION.model, promptVersion: 'v1.4',
        maxFlash: require('../lib/ocr_robust').MAX_FLASH, gespeichertMs: Date.now() - 1000, laeufe: 1,
        flash: 1, enh: 0, esk: 0, ersatz: 0, zeitAbbrueche: 0, failed: [], reads: [v14Lesung],
      },
      ocrFortsetzungen: 1,
    });
    // Die gespeicherte v1.4-Lesung stimmt mit KEINER v1.5-Lesung überein (Netto- vs. Brutto-Preise)
    // — würde sie mitgezählt, bliebe es trotzdem eindeutig; entscheidend ist die Zahl der Lesungen.
    antworten = [parsedV15(), parsedV15()];
    await verarbeiten();

    expect(aufrufe.map((o) => o.promptVersion)).toEqual(['v1.5', 'v1.5']);
    const bon = fake.store.get('receipts/b1');
    expect(bon.ocr.promptVersion).toBe('v1.5');
    expect(bon.ocr.robust).toMatchObject({ attempts: 2, method: 'flash-agreement', laeufe: 2 });
    expect(bon.ocrZwischenstand).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith('ocr-zwischenstand-verworfen', { grund: 'prompt' });
  });
});

describe('Zweitprüfung liest mit der Version der Erstlesung', () => {
  test.each([['v1.4', 'v1.5'], ['v1.5', 'v1.4']])('Erstlesung %s, Schalter %s', async (erst, schalter) => {
    konfig({ ocrPrompt: schalter, ocrReferee: true });
    const falsch = erst === 'v1.5' ? parsedV15(100, { totalCents: 1234 }) : { ...parsedV14(), totalCents: 1234 };
    bonAnlegen('b1', {
      ocr: gespeicherteOcr(erst, falsch, {
        robust: { confidence: 'none', attempts: 7, reads: [] },
        refereeRequest: { reason: 'reconciliation_delta', confidence: 'none' },
      }),
    });
    // Die Prüfung liest die richtige Summe — wie sie entscheidet, ist hier egal.
    const richtig = erst === 'v1.5' ? parsedV15() : parsedV14();
    antworten = [richtig, richtig, richtig, richtig];
    await verarbeiten();

    const r = REFEREE.refereePromptFuer(erst);
    expect(aufrufe.length).toBeGreaterThan(0);
    for (const o of aufrufe) {
      expect(o).toMatchObject({ promptVersion: `referee-v2+${erst}`, systemInstruction: r.SYSTEM_PROMPT, responseSchema: r.RESPONSE_SCHEMA });
    }
    expect(fake.store.get('receipts/b1').ocr.referee).toMatchObject({ promptVersion: `referee-v2+${erst}` });
  });
});

describe('Coupon-Bon unter v1.5', () => {
  test('Rabattzeile negativ, Belegkette erfüllt → bezahlt; die Zeile ist kein Artikel und kein gekauftes Produkt', async () => {
    konfig({ ocrPrompt: 'v1.5' });
    bonAnlegen();
    antworten = [parsedV15(), parsedV15()];
    await verarbeiten();

    const bon = fake.store.get('receipts/b1');
    expect(bon).toMatchObject({ status: 'approved', cashbackCents: 8, eligibleItemCount: 5 });
    expect(bon.ocr.reconciliation).toMatchObject({ ok: true, direction: 'basket_discount', basketDiscountCents: 100, totalCents: 900 });
    expect(gekauft('b1').map((p) => p.itemName).sort()).toEqual(ARTIKEL.map((a) => a.name).sort());
  });

  test('Coupon über der Grenze (25 %) → Abgleich nicht belegt, abgelehnt wie bisher bei nicht aufgehender Summe', async () => {
    konfig({ ocrPrompt: 'v1.5' });
    bonAnlegen();
    antworten = Array.from({ length: 7 }, () => parsedV15(300));
    await verarbeiten();

    const bon = fake.store.get('receipts/b1');
    expect(bon.ocr.reconciliation).toMatchObject({ ok: false, direction: 'basket_discount_unbelegt', basketDiscountCents: 300 });
    expect(bon).toMatchObject({ status: 'rejected', rejectReason: 'reconciliation_delta' });
    expect(ledger()).toHaveLength(0);
  });
});

describe('Bestandsschutz und Doppel-Schutz über den Versionswechsel', () => {
  test('unter v1.4 bezahlt; nach dem Umschalten neu gelesen (v1.5, Abgleich scheitert) → bleibt bezahlt, kein Storno', async () => {
    bonAnlegen('b1', { ocr: gespeicherteOcr('v1.4', parsedV14()) });
    await verarbeiten();
    expect(fake.store.get('receipts/b1')).toMatchObject({ status: 'approved', cashbackCents: 8 });
    expect(ledger()).toHaveLength(1);

    // Nachverarbeitung nach dem Umschalten: OCR gelöscht, frisch gelesen.
    konfig({ ocrPrompt: 'v1.5' });
    const bon = fake.store.get('receipts/b1');
    delete bon.ocr;
    fake.store.set('receipts/b1', { ...bon, status: 'ocr_pending' });
    antworten = Array.from({ length: 7 }, () => parsedV15(300));
    await verarbeiten();

    const nach = fake.store.get('receipts/b1');
    expect(nach.ocr.promptVersion).toBe('v1.5');
    expect(nach.ocr.reconciliation.ok).toBe(false);
    expect(nach).toMatchObject({ status: 'approved', cashbackCents: 8 });
    expect(ledger()).toEqual([expect.objectContaining({ type: 'earn', cents: 8, receiptId: 'b1' })]);
    expect(global.__logs.some(([m]) => m === 'bestandsschutz-gutschrift')).toBe(true);
  });

  test.each([['v1.4', 'v1.5'], ['v1.5', 'v1.4']])('derselbe Bon: bezahlt unter %s, erneut eingereicht unter %s → nicht noch einmal bezahlt', async (erst, dann) => {
    const leseFuer = (v) => (v === 'v1.5' ? parsedV15() : parsedV14());
    konfig({ ocrPrompt: erst });
    bonAnlegen('b1');
    antworten = [leseFuer(erst), leseFuer(erst)];
    await verarbeiten('b1');
    expect(fake.store.get('receipts/b1')).toMatchObject({ status: 'approved' });

    konfig({ ocrPrompt: dann });
    bonAnlegen('b2');
    antworten = [leseFuer(dann), leseFuer(dann)];
    await verarbeiten('b2');

    expect(fake.store.get('receipts/b2').ocr.promptVersion).toBe(dann);
    expect(fake.store.get('receipts/b2')).toMatchObject({ status: 'rejected' });
    expect(fake.store.get('receipts/b2').rejectReason).toMatch(/^duplicate_content_/);
    expect(ledger()).toHaveLength(1);
  });

  test('Identität für die Doppel-Regeln: Markt, Tag, Uhrzeit, Summe gleich; Rabattzeile ist kein Artikel-Schlüssel', () => {
    const a = identitaet({ merchantId: 'netto', ...parsedV14() });
    const b = identitaet({ merchantId: 'netto', ...parsedV15() });
    expect(b.kontenId).toBe(a.kontenId);
    expect(b.summe).toBe(a.summe);
    expect(b.artikelSumme).toBe(a.artikelSumme);
    expect(b.artikel.some((k) => /coupon/.test(k))).toBe(false);
    // v1.4-Lesung: keine Seiten-/App-Regel, keine Bestellnummer.
    expect(a).toMatchObject({ online: false, ohneSumme: false, app: false, bestellHash: null });
  });
});
