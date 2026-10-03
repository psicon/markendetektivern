'use strict';

/**
 * Hängende Bons (03.10.2026) — der ECHTE processCashback-Handler mit frischer
 * Texterkennung (Modell-Attrappe) gegen eine Firestore-Attrappe:
 *
 *   - Laufbudget erreicht → Zwischenstand am Bon, sofort neu zugestellt,
 *     NICHTS entschieden (kein Status, kein Ledger, kein Versuchszähler).
 *   - Der nächste Lauf setzt fort und entscheidet wie gewohnt.
 *   - Laufzeitgrenze: ein zu alter Lauf schreibt keine Entscheidung; nach dem
 *     letzten Versuch 'review', nie 'rejected'.
 *   - Fortsetzung nicht zustellbar → Infrastruktur, Zwischenstand bleibt.
 *   - Kehrlauf stellt nicht neben einer frisch angeforderten Fortsetzung zu.
 */

jest.mock('firebase-admin', () => require('./helpers/fakeAdmin').erstelleFakeAdmin());
jest.mock('firebase-functions', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
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
    topic(name) {
      return {
        publishMessage: async (msg) => {
          if (global.__publishFehler) throw new Error('UNAVAILABLE: PubSub');
          global.__published.push({ topic: name, ...msg });
          // Zustellung, noch BEVOR der veröffentlichende Lauf sich abmeldet.
          if (global.__sofortZustellen) await global.__sofortZustellen(msg);
          return 'msg';
        },
      };
    }
  },
}));
jest.mock('../lib/push', () => ({
  sendCashbackReady: async (uid, info) => {
    global.__pushes.push({ uid, info });
  },
}));
// Nur der Modellaufruf ist eine Attrappe — Leiter, Abgleich und Pipeline sind echt.
jest.mock('../lib/ocr', () => {
  const echt = jest.requireActual('../lib/ocr');
  return { ...echt, extractReceipt: (...args) => global.__extract(...args) };
});
jest.mock('../lib/imageEnhance', () => ({ enhanceForOcr: async () => Buffer.from('verbessert') }));

const admin = require('firebase-admin');
const fn = require('../index');

const fake = admin.__fake;
const UID = 'bonUid';
const TAG = 24 * 60 * 60 * 1000;
const berlinDatum = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });

let uhr;
let aufrufe;
let antworten;

/** Eine Lesung, wie sie extractReceipt liefert; Bon über 4 × 1 € bei Netto. */
function lesung() {
  return {
    parsed: {
      isReceipt: true,
      merchant: 'Netto Marken-Discount',
      bonCountry: 'DE',
      bonDate: berlinDatum(Date.now() - TAG),
      bonTime: '10:15',
      totalCents: 400,
      items: ['Milch', 'Brot', 'Butter', 'Käse'].map((name) => ({ name, priceCents: 100, qty: 1 })),
    },
    promptVersion: 'v1.4',
    latencyMs: 1000,
    finishReason: 'STOP',
    inputTokens: 1500,
    outputTokens: 400,
    thoughtsTokens: 900,
    raw: '{}',
  };
}
const haenger = () => Object.assign(new Error('OCR timeout after 170000 ms (gemini-3.5-flash)'), { code: 'ocr_timeout' });

/** Modell-Attrappe mit Uhr: gleichzeitige Aufrufe enden mit dem längsten. */
function extractAttrappe(bytes, mime, opts) {
  const beginn = uhr;
  const eintrag = antworten.shift();
  aufrufe.push({ beginn, timeoutMs: opts.timeoutMs, model: opts.model });
  if (!eintrag) return Promise.reject(new Error('keine Antwort mehr vorgesehen'));
  return Promise.resolve().then(() => {
    uhr = Math.max(uhr, beginn + eintrag.dauer);
    if (eintrag.a instanceof Error) throw eintrag.a;
    return { ...eintrag.a, model: opts.model };
  });
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
const verarbeiten = (id = 'b1') =>
  fn.processCashback({ id: `ev-${id}-${++ev}`, data: { message: { json: { cashbackId: id, uid: UID } } } });

const ledger = () =>
  [...fake.store.entries()].filter(([k]) => k.startsWith(`users/${UID}/cashback_ledger/`)).map(([, v]) => v);

beforeEach(() => {
  fake.zuruecksetzen();
  global.__pushes = [];
  global.__published = [];
  global.__publishFehler = false;
  global.__sofortZustellen = null;
  aufrufe = [];
  antworten = [];
  uhr = Date.now();
  // Erst NACH dem Zurücksetzen der Mocks (resetMocks) anlegen.
  jest.spyOn(Date, 'now').mockImplementation(() => uhr);
  global.__extract = extractAttrappe;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  const jetzt = uhr;
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, payoutThresholdCents: 1000 });
  fake.store.set('cashback_campaigns/c1', {
    kind: 'receipt',
    active: true,
    startAt: fake.zeit(jetzt - 10 * TAG),
    endAt: fake.zeit(jetzt + 10 * TAG),
    cashbackPerBonCents: 8,
    budgetRemainingCents: 5000,
  });
  fake.store.set('discounter/netto', { name: 'Netto', land: 'DE' });
  fake.store.set(`users/${UID}`, { cashback_balance_cents: 505, cashback_lifetime_cents: 505 });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('processCashback: Laufbudget und Fortsetzung', () => {
  test('Budget erreicht → Zwischenstand am Bon, sofort neu zugestellt, nichts entschieden', async () => {
    bonAnlegen();
    antworten = [
      { a: haenger(), dauer: 170000 }, { a: haenger(), dauer: 170000 },
      { a: haenger(), dauer: 170000 }, { a: lesung(), dauer: 170000 },
    ];
    const start = uhr;
    await verarbeiten();

    // Keine Lesung ragte über das Laufbudget (400 s ab Laufbeginn).
    for (const a of aufrufe) expect(a.beginn + a.timeoutMs).toBeLessThanOrEqual(start + 400000);
    const bon = fake.store.get('receipts/b1');
    expect(bon.status).toBe('ocr_pending');
    expect(bon.ocr).toBeUndefined();
    expect(bon.attempts).toBeUndefined();
    expect(bon.ocrZwischenstand).toMatchObject({ laeufe: 1, flash: 1, ersatz: 3, zeitAbbrueche: 3 });
    expect(bon.ocrZwischenstand.reads).toHaveLength(1);
    // Kein offener Lauf-Anspruch: der Kehrlauf darf später übernehmen.
    expect(Object.keys(bon.verarbeitung || {})).toHaveLength(0);
    expect(global.__published).toEqual([
      expect.objectContaining({ topic: 'cashback-ocr-jobs', json: { cashbackId: 'b1', uid: UID, fortsetzung: 1 } }),
    ]);
    expect(ledger()).toHaveLength(0);
    expect(fake.store.get(`users/${UID}/cashback_status/b1`)).toBeUndefined();
    expect(global.__pushes).toHaveLength(0);
  });

  test('der nächste Lauf setzt fort und entscheidet wie gewohnt', async () => {
    bonAnlegen();
    antworten = [
      { a: haenger(), dauer: 170000 }, { a: haenger(), dauer: 170000 },
      { a: haenger(), dauer: 170000 }, { a: lesung(), dauer: 170000 },
      { a: lesung(), dauer: 12000 },
    ];
    await verarbeiten();
    uhr += 3000; // Zustellung der Fortsetzung
    await verarbeiten();

    expect(aufrufe).toHaveLength(5);
    const bon = fake.store.get('receipts/b1');
    expect(bon).toMatchObject({ status: 'approved', cashbackCents: 8 });
    expect(bon.ocr.robust).toMatchObject({ confidence: 'high', laeufe: 2, zeitAbbrueche: 3, failedAttempts: 3, attempts: 2 });
    expect(bon.ocrZwischenstand).toBeUndefined();
    expect(bon.attempts).toBeUndefined();
    expect(ledger()).toEqual([expect.objectContaining({ type: 'earn', cents: 8, receiptId: 'b1' })]);
    expect(global.__pushes).toHaveLength(1);
  });

  test('Nachfolger wird zugestellt, bevor der Vorgänger sich abmeldet → läuft trotzdem (Anspruch beim Ablegen abgegeben)', async () => {
    bonAnlegen();
    antworten = [
      { a: haenger(), dauer: 170000 }, { a: haenger(), dauer: 170000 },
      { a: haenger(), dauer: 170000 }, { a: lesung(), dauer: 170000 },
      { a: lesung(), dauer: 12000 },
    ];
    let einmal = true;
    global.__sofortZustellen = async (msg) => {
      if (!einmal) return;
      einmal = false;
      uhr += 500;
      await fn.processCashback({ id: 'ev-fortsetzung', data: { message: { json: msg.json } } });
    };
    await verarbeiten();

    expect(aufrufe).toHaveLength(5);
    expect(fake.store.get('receipts/b1')).toMatchObject({ status: 'approved', cashbackCents: 8 });
    expect(ledger()).toHaveLength(1);
  });

  test('verspätete Zustellung mit anderer Event-ID, während die Fortsetzung rechnet → kein zweiter Lauf', async () => {
    bonAnlegen('b1', {
      ocrZwischenstand: { v: 1, gespeichertMs: uhr - 1000, laeufe: 1 },
      verarbeitung: { 'eev-fortsetzung-laeuft': fake.zeit(Date.now() - 5000) },
    });
    antworten = [{ a: lesung(), dauer: 1000 }, { a: lesung(), dauer: 1000 }];
    await verarbeiten();

    expect(aufrufe).toHaveLength(0);
    expect(fake.store.get('receipts/b1').status).toBe('ocr_pending');
    expect(ledger()).toHaveLength(0);
  });

  test('Normalfall unverändert: zwei einige Lesungen, ein Lauf, keine Fortsetzung', async () => {
    bonAnlegen();
    antworten = [{ a: lesung(), dauer: 15000 }, { a: lesung(), dauer: 18000 }];
    await verarbeiten();

    expect(aufrufe.map((a) => a.beginn)).toEqual([aufrufe[0].beginn, aufrufe[0].beginn]);
    expect(fake.store.get('receipts/b1')).toMatchObject({ status: 'approved', cashbackCents: 8 });
    expect(fake.store.get('receipts/b1').ocr.robust).toMatchObject({ laeufe: 1, zeitAbbrueche: 0 });
    expect(global.__published).toHaveLength(0);
  });

  test('Fortsetzung nicht zustellbar → Infrastruktur (Wiederholung), Zwischenstand bleibt', async () => {
    bonAnlegen();
    global.__publishFehler = true;
    antworten = [
      { a: haenger(), dauer: 170000 }, { a: haenger(), dauer: 170000 },
      { a: haenger(), dauer: 170000 }, { a: lesung(), dauer: 170000 },
    ];
    await expect(verarbeiten()).rejects.toMatchObject({ code: 'ocr_unavailable' });

    const bon = fake.store.get('receipts/b1');
    expect(bon.status).toBe('ocr_pending');
    expect(bon.attempts).toBe(1);
    expect(bon.ocrZwischenstand).toMatchObject({ laeufe: 1, flash: 1 });
    expect(ledger()).toHaveLength(0);
  });

  test('… und nach dem letzten Versuch: review, nie rejected', async () => {
    bonAnlegen('b1', { attempts: 4 });
    global.__publishFehler = true;
    antworten = [
      { a: haenger(), dauer: 170000 }, { a: haenger(), dauer: 170000 },
      { a: haenger(), dauer: 170000 }, { a: lesung(), dauer: 170000 },
    ];
    await verarbeiten();

    expect(fake.store.get('receipts/b1')).toMatchObject({ status: 'review', reviewReason: 'ocr_unavailable' });
    expect(fake.store.get(`users/${UID}/cashback_status/b1`)).toMatchObject({ status: 'review', reviewReason: 'ocr_unavailable' });
    expect(ledger()).toHaveLength(0);
  });

  test('Folgelauf kann nicht zustellen → sein neuer Zwischenstand bleibt stehen (nicht gelöscht)', async () => {
    bonAnlegen();
    antworten = [
      { a: haenger(), dauer: 170000 }, { a: haenger(), dauer: 170000 },
      { a: haenger(), dauer: 170000 }, { a: lesung(), dauer: 170000 },
      // Lauf 2: Ersatzversuche sind aufgebraucht, die Hänger verbrauchen ihre Plätze.
      { a: haenger(), dauer: 170000 }, { a: haenger(), dauer: 170000 },
    ];
    await verarbeiten();
    uhr += 3000;
    global.__publishFehler = true;
    await expect(verarbeiten()).rejects.toMatchObject({ code: 'ocr_unavailable' });

    const bon = fake.store.get('receipts/b1');
    expect(bon.attempts).toBe(1);
    expect(bon.ocrZwischenstand).toMatchObject({ laeufe: 2, flash: 3, reads: [expect.objectContaining({ stufe: 'flash' })] });
    expect(ledger()).toHaveLength(0);
  });

  test('fortgesetzte Leiter endet in der Anforderung der Zweitprüfung → Zwischenstand ist weg', async () => {
    fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, payoutThresholdCents: 1000, ocrReferee: true });
    bonAnlegen();
    const falsch = () => ({ ...lesung(), parsed: { ...lesung().parsed, totalCents: 999 } });
    antworten = [
      { a: haenger(), dauer: 170000 }, { a: haenger(), dauer: 170000 },
      { a: haenger(), dauer: 170000 }, { a: falsch(), dauer: 170000 },
      ...Array.from({ length: 6 }, () => ({ a: falsch(), dauer: 1000 })),
    ];
    await verarbeiten();
    uhr += 3000;
    await verarbeiten();

    const bon = fake.store.get('receipts/b1');
    expect(bon.status).toBe('ocr_pending');
    expect(bon.ocr.refereeRequest).toMatchObject({ reason: 'reconciliation_delta' });
    expect(bon.ocr.robust).toMatchObject({ confidence: 'none', laeufe: 2 });
    expect(bon.ocrZwischenstand).toBeUndefined();
    expect(global.__published.map((m) => m.json.fortsetzung ?? 'zweitpruefung')).toEqual([1, 'zweitpruefung']);
  });

  test('alle Lesungen gescheitert → ocr_unavailable, der verbrauchte Zwischenstand wird gelöscht', async () => {
    bonAnlegen();
    // Erster Lauf: Zwischenstand nach zwei Fenstern.
    antworten = [
      { a: haenger(), dauer: 170000 }, { a: haenger(), dauer: 170000 },
      { a: haenger(), dauer: 170000 }, { a: haenger(), dauer: 170000 },
    ];
    await verarbeiten();
    expect(fake.store.get('receipts/b1').ocrZwischenstand).toMatchObject({ flash: 1, ersatz: 3 });
    // Zweiter Lauf: alles scheitert schnell (429) — die Leiter endet ohne Lesung.
    uhr += 3000;
    antworten = Array.from({ length: 6 }, () => ({ a: new Error('429 RESOURCE_EXHAUSTED'), dauer: 1000 }));
    await expect(verarbeiten()).rejects.toMatchObject({ code: 'ocr_unavailable' });

    const bon = fake.store.get('receipts/b1');
    expect(bon.status).toBe('ocr_pending');
    expect(bon.attempts).toBe(1);
    expect(bon.ocrZwischenstand).toBeUndefined();
    expect(ledger()).toHaveLength(0);
  });
});

describe('processCashback: Laufzeitgrenze', () => {
  test('zu alter Lauf schreibt keine Entscheidung; OCR bleibt gespeichert, der nächste Lauf entscheidet ohne neue Lesung', async () => {
    bonAnlegen();
    // Lesungen dauern (hier künstlich) 490 s — danach wäre die Grenze überschritten.
    antworten = [{ a: lesung(), dauer: 490000 }, { a: lesung(), dauer: 490000 }];
    await expect(verarbeiten()).rejects.toMatchObject({ code: 'lauf_zeitgrenze' });

    let bon = fake.store.get('receipts/b1');
    expect(bon.status).toBe('ocr_pending');
    expect(bon.attempts).toBe(1);
    expect(bon.ocr.parsed.totalCents).toBe(400);
    expect(ledger()).toHaveLength(0);
    expect(global.__pushes).toHaveLength(0);

    uhr += 20 * 60 * 1000;
    await verarbeiten();
    bon = fake.store.get('receipts/b1');
    expect(aufrufe).toHaveLength(2);
    expect(bon).toMatchObject({ status: 'approved', cashbackCents: 8 });
    expect(ledger()).toHaveLength(1);
  });

  test('auch die Anforderung der Zweitprüfung schreibt ein zu alter Lauf nicht', async () => {
    fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, payoutThresholdCents: 1000, ocrReferee: true });
    bonAnlegen();
    const falsch = () => ({ ...lesung(), parsed: { ...lesung().parsed, totalCents: 999 } });
    // Sieben unstimmige Lesungen; die letzte dauert (künstlich) bis über die Grenze.
    antworten = [...Array.from({ length: 6 }, () => ({ a: falsch(), dauer: 1000 })), { a: falsch(), dauer: 490000 }];
    await expect(verarbeiten()).rejects.toMatchObject({ code: 'lauf_zeitgrenze' });

    const bon = fake.store.get('receipts/b1');
    expect(bon.status).toBe('ocr_pending');
    expect(bon.ocr.refereeRequest).toBeNull();
    expect(global.__published).toHaveLength(0);
  });

  test('nach dem letzten Versuch: review (lauf_zeitgrenze), nie rejected', async () => {
    bonAnlegen('b1', { attempts: 4 });
    antworten = [{ a: lesung(), dauer: 490000 }, { a: lesung(), dauer: 490000 }];
    await verarbeiten();

    expect(fake.store.get('receipts/b1')).toMatchObject({ status: 'review', reviewReason: 'lauf_zeitgrenze' });
    expect(ledger()).toHaveLength(0);
  });
});

describe('sweepStuckReceipts neben einer Fortsetzung', () => {
  test('frisch angeforderte Fortsetzung → kein zweiter Lauf; abgelaufene → wird geholt', async () => {
    const alt = uhr - 60 * 60 * 1000;
    bonAnlegen('frisch', { createdAt: fake.zeit(alt), ocrZwischenstand: { v: 1, gespeichertMs: uhr - 2 * 60 * 1000 } });
    bonAnlegen('liegengeblieben', { createdAt: fake.zeit(alt), ocrZwischenstand: { v: 1, gespeichertMs: uhr - 11 * 60 * 1000 } });
    bonAnlegen('ohne', { createdAt: fake.zeit(alt) });
    await fn.sweepStuckReceipts();

    const zugestellt = global.__published.map((m) => m.json.cashbackId).sort();
    expect(zugestellt).toEqual(['liegengeblieben', 'ohne']);
  });
});
