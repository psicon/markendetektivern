'use strict';

/**
 * Bestandsschutz des Markt-Resolvers (Prüfrunde 2, 04.10.2026): ein Beleg ohne
 * gelesenen Händlernamen wurde bisher über den Tippfehler-Abgleich „dm". Mit
 * `marktNurMitName: true` ist das abgestellt — ein SCHON BEZAHLTER Bon behält
 * aber den Markt, sonst stornierte eine erneute Zustellung seine Gutschrift
 * als unknown_merchant (Gates, die von approved wegführen, hängen an
 * alreadyCredited).
 *
 * Prüfrunde 3: die strenge Fassung traf ehrliche Ladenbons unserer Märkte
 * ohne Logo und hängt deshalb am Schalter (Default aus = altes Verhalten);
 * die gedruckte Umsatzsteuer-ID der Kette erkennt REWE-eBons immer.
 */

jest.mock('firebase-admin', () => require('./helpers/fakeAdmin').erstelleFakeAdmin());
jest.mock('firebase-functions', () => ({
  logger: { info: (...a) => global.__logs.push(a), warn: (...a) => global.__logs.push(a), error: () => {}, debug: () => {} },
}));
jest.mock('firebase-functions/params', () => ({ defineSecret: (name) => ({ name, value: () => undefined }) }));
jest.mock('firebase-functions/v2/https', () => ({ onRequest: (_opts, h) => h }));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_opts, h) => h }));
jest.mock('firebase-functions/v2/pubsub', () => ({ onMessagePublished: (_opts, h) => h }));
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (_opts, h) => h }));
jest.mock('@google-cloud/pubsub', () => ({ PubSub: class { topic() { return { publishMessage: async () => 'msg' }; } } }));
jest.mock('../lib/push', () => ({ sendCashbackReady: async () => {} }));

const admin = require('firebase-admin');
const fn = require('../index');

const fake = admin.__fake;
const U = 'bestandNutzer';
const TAG = 24 * 60 * 60 * 1000;
const GESTERN = new Date(Date.now() - TAG).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
const ZEHN = ['Kürbis', 'Tomaten', 'Paprika', 'Salat', 'Gurken', 'Pommes', 'Kroketten', 'Skyr', 'Hefe', 'Butter']
  .map((name, i) => ({ name, priceCents: 100 + i * 10, qty: 1 }));
const SUMME = ZEHN.reduce((s, i) => s + i.priceCents, 0);

function bonOhneHaendler(id, extra = {}) {
  fake.store.set(`receipts/${id}`, {
    userId: U,
    status: 'ocr_pending',
    campaignId: 'c1',
    createdAt: fake.zeit(Date.now() - 60 * 60 * 1000),
    storage: { bucket: 'b', path: `cashback-uploads/${U}/${id}.jpg` },
    ocr: {
      engine: 'gemini-robust', model: 'test', promptVersion: 'test',
      parsed: { isReceipt: true, merchant: null, bonCountry: 'DE', bonDate: GESTERN, bonTime: '10:15', totalCents: SUMME, items: ZEHN, belegart: 'app_kassenbon' },
      robust: { confidence: 'high', attempts: 2 },
      reconciliation: { ok: true, sumItemsCents: SUMME, deltaCents: 0, signedDeltaCents: 0, direction: 'exact' },
    },
    ...extra,
  });
}
const verarbeiten = (id) => fn.processCashback({ id: `ev-${id}-${Math.random()}`, data: { message: { json: { cashbackId: id, uid: U } } } });
const ledger = () => [...fake.store.entries()].filter(([k]) => k.startsWith(`users/${U}/cashback_ledger/`)).map(([, v]) => v);

beforeEach(() => {
  fake.zuruecksetzen();
  global.__logs = [];
  const jetzt = Date.now();
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3 });
  fake.store.set('cashback_campaigns/c1', {
    kind: 'receipt', active: true, startAt: fake.zeit(jetzt - 10 * TAG), endAt: fake.zeit(jetzt + 10 * TAG),
    cashbackPerBonCents: 8, budgetRemainingCents: 5000,
  });
  // Echter Name wie in der Sammlung: „dm" — ein leerer Name hat Abstand 2.
  fake.store.set('discounter/dm', { name: 'dm', land: 'DE' });
  fake.store.set('discounter/lidl', { name: 'Lidl', land: 'DE' });
  fake.store.set('discounter/rewe', { name: 'REWE', land: 'DE' });
  fake.store.set(`users/${U}`, { cashback_balance_cents: 8, cashback_lifetime_cents: 8 });
});

const streng = () => fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, marktNurMitName: true });

test('Schalter aus (Default): Ladenbon ohne Händlernamen wie vor Prüfrunde 2 — „dm", bezahlt', async () => {
  bonOhneHaendler('a1');
  await verarbeiten('a1');
  expect(fake.store.get('receipts/a1')).toMatchObject({ status: 'approved', merchant: { id: 'dm' } });
  expect(ledger()).toHaveLength(1);
});

test("Schalter 'shadow': bezahlt wie bisher, die strenge Fassung wird protokolliert", async () => {
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, marktNurMitName: 'shadow' });
  bonOhneHaendler('s1');
  await verarbeiten('s1');
  expect(fake.store.get('receipts/s1')).toMatchObject({ status: 'approved', merchant: { id: 'dm' } });
  expect(global.__logs.find((l) => l[0] === 'markt-ohne-namen')[1])
    .toMatchObject({ cashbackId: 's1', jetzt: 'dm', jetztVia: 'fuzzy', streng: null, wuerde: 'unknown_merchant', belegart: 'app_kassenbon', mitUhrzeit: true });
});

test('neuer Beleg ohne Händlernamen, Schalter true → unknown_merchant statt dm, nichts gebucht', async () => {
  streng();
  bonOhneHaendler('n1');
  await verarbeiten('n1');
  expect(fake.store.get('receipts/n1')).toMatchObject({ status: 'rejected', rejectReason: 'unknown_merchant' });
  expect(ledger()).toHaveLength(0);
});

test.each([[false], [true]])('REWE-eBon ohne Händlernamen, „UID Nr.: DE812706034" im Kopf (marktNurMitName %p) → REWE, bezahlt', async (scharf) => {
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, marktNurMitName: scharf });
  bonOhneHaendler('x');
  fake.store.get('receipts/x').ocr.parsed.merchantSubtitle = 'UID Nr.: DE812706034';
  await verarbeiten('x');
  expect(fake.store.get('receipts/x')).toMatchObject({ status: 'approved', merchant: { id: 'rewe' } });
});

test('Online-Bestellung ohne Händlernamen bleibt auch mit Schalter aus streng (Patricks Regel)', async () => {
  bonOhneHaendler('o1');
  fake.store.get('receipts/o1').ocr.parsed.belegart = 'online_bestellung';
  await verarbeiten('o1');
  expect(fake.store.get('receipts/o1')).toMatchObject({ status: 'rejected', rejectReason: 'unknown_merchant' });
});

test('schon bezahlter Beleg ohne Händlernamen, erneut zugestellt → bleibt bezahlt, kein Storno', async () => {
  streng();
  bonOhneHaendler('b1');
  fake.store.set(`users/${U}/cashback_ledger/e1`, { type: 'earn', cents: 8, receiptId: 'b1', campaignId: 'c1', bonDate: GESTERN });
  fake.store.set(`users/${U}/cashback_days/${GESTERN}`, { bonDate: GESTERN, receiptIds: ['b1'] });
  await verarbeiten('b1');
  expect(fake.store.get('receipts/b1').status).toBe('approved');
  expect(ledger().filter((l) => l.type === 'reverse')).toHaveLength(0);
  expect(global.__logs.find((l) => l[0] === 'markt-bestandsschutz')[1]).toMatchObject({ cashbackId: 'b1', markt: 'dm', matchVia: 'fuzzy' });
});

test('Ledger nicht lesbar beim Bestandsschutz → kein Urteil (Wiederholung), nie unknown_merchant', async () => {
  streng();
  bonOhneHaendler('b2');
  fake.fehler.add(`users/${U}/cashback_ledger`);
  await verarbeiten('b2').catch(() => {});
  expect(fake.store.get('receipts/b2').status).toBe('ocr_pending');
  expect(global.__logs.find((l) => l[0] === 'ledger-precheck-failed')[1]).toMatchObject({ stelle: 'markt-bestandsschutz' });
});
