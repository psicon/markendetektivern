'use strict';

/**
 * Kontosperre im Bon-Lauf (processCashback) — Entscheidung Patrick 02.10.2026.
 * Durchläuft den ECHTEN Handler mit gespeicherter Texterkennung (kein
 * Modellaufruf) gegen eine Firestore-Attrappe:
 *
 *   - gesperrt → Bon bleibt gespeichert, Status no_reward / konto_gesperrt,
 *     Bon und Spiegel stimmen mit dem Ledger überein, keine Nachricht.
 *   - nicht gesperrt → Gutschrift wie bisher.
 *   - Sperre nicht lesbar → nichts gebucht; der Bon bleibt ocr_pending (Kehrlauf
 *     stellt neu zu) und landet nach dem letzten Versuch in 'review' —
 *     NIE in 'rejected' (Infrastruktur ist keine Aussage über den Bon).
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
    topic() {
      return { publishMessage: async () => 'msg' };
    }
  },
}));
jest.mock('../lib/push', () => ({
  sendCashbackReady: async (uid, info) => {
    global.__pushes.push({ uid, info });
  },
}));

const admin = require('firebase-admin');
const fn = require('../index');

const fake = admin.__fake;
const UID = 'bonUid';
const TAG = 24 * 60 * 60 * 1000;

const berlinDatum = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });

function bonAnlegen(id = 'b1', extra = {}) {
  const jetzt = Date.now();
  const artikel = ['Milch', 'Brot', 'Butter', 'Käse'].map((name) => ({ name, priceCents: 100, qty: 1 }));
  fake.store.set(`receipts/${id}`, {
    userId: UID,
    status: 'ocr_pending',
    campaignId: 'c1',
    createdAt: fake.zeit(jetzt - 60 * 60 * 1000),
    storage: { bucket: 'b', path: `cashback-uploads/${UID}/${id}.jpg` },
    ocr: {
      engine: 'gemini-robust',
      model: 'test',
      promptVersion: 'test',
      parsed: {
        isReceipt: true,
        merchant: 'Netto Marken-Discount',
        bonCountry: 'DE',
        bonDate: berlinDatum(jetzt - TAG),
        bonTime: '10:15',
        totalCents: 400,
        items: artikel,
      },
      robust: { confidence: 'high', attempts: 2 },
      reconciliation: { ok: true, sumItemsCents: 400, deltaCents: 0, signedDeltaCents: 0, direction: 'exact' },
    },
    ...extra,
  });
}

const verarbeiten = (id = 'b1') =>
  fn.processCashback({ id: `ev-${id}-${Math.random()}`, data: { message: { json: { cashbackId: id, uid: UID } } } });

const ledger = () =>
  [...fake.store.entries()].filter(([k]) => k.startsWith(`users/${UID}/cashback_ledger/`)).map(([, v]) => v);

beforeEach(() => {
  fake.zuruecksetzen();
  global.__pushes = [];
  const jetzt = Date.now();
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

describe('processCashback: gesperrtes Konto', () => {
  test('Bon gespeichert, no_reward / konto_gesperrt, nichts gebucht, Spiegel = Ledger', async () => {
    fake.store.set(`cashback_sperren/${UID}`, { gesperrt: true, quelle: 'Entscheidung Patrick 02.10.2026' });
    bonAnlegen();
    await verarbeiten();

    expect(fake.store.get('receipts/b1')).toMatchObject({ status: 'no_reward', rejectReason: 'konto_gesperrt', cashbackCents: 0 });
    expect(fake.store.get(`users/${UID}/cashback_status/b1`)).toMatchObject({
      status: 'no_reward', rejectReason: 'konto_gesperrt', cashbackCents: 0,
    });
    expect(ledger()).toHaveLength(0);
    expect(fake.store.get(`users/${UID}`)).toMatchObject({ cashback_balance_cents: 505, cashback_lifetime_cents: 505 });
    expect(fake.store.get('cashback_campaigns/c1').budgetRemainingCents).toBe(5000);
    expect(global.__pushes).toHaveLength(0);
  });

  test('nicht gesperrt → Gutschrift wie bisher', async () => {
    bonAnlegen();
    await verarbeiten();

    expect(fake.store.get('receipts/b1')).toMatchObject({ status: 'approved', cashbackCents: 8 });
    expect(ledger()).toEqual([expect.objectContaining({ type: 'earn', cents: 8, receiptId: 'b1' })]);
    expect(fake.store.get(`users/${UID}`).cashback_balance_cents).toBe(513);
    expect(global.__pushes).toHaveLength(1);
  });

  test('Sperre nicht lesbar → nichts gebucht, Bon bleibt ocr_pending (Kehrlauf stellt neu zu)', async () => {
    fake.fehler.add(`cashback_sperren/${UID}`);
    bonAnlegen();
    await expect(verarbeiten()).rejects.toMatchObject({ code: 'ledger_tx_failed' });

    const bon = fake.store.get('receipts/b1');
    expect(bon.status).toBe('ocr_pending');
    expect(bon.attempts).toBe(1);
    expect(ledger()).toHaveLength(0);
  });

  test('Sperre nach dem letzten Versuch weiter nicht lesbar → review, nie rejected', async () => {
    fake.fehler.add(`cashback_sperren/${UID}`);
    bonAnlegen('b1', { attempts: 4 });
    await verarbeiten();

    expect(fake.store.get('receipts/b1')).toMatchObject({ status: 'review', reviewReason: 'ledger_tx_failed' });
    expect(fake.store.get(`users/${UID}/cashback_status/b1`)).toMatchObject({ status: 'review', reviewReason: 'ledger_tx_failed' });
    expect(ledger()).toHaveLength(0);
  });
});
