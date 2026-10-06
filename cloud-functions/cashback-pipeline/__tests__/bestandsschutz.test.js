'use strict';

/**
 * Bestandsschutz bezahlter Bons (05.10.2026). Regel aus den Money-Ops vom
 * 02.09.: Gates, die einen Status VON approved WEG bewegen, hängen an
 * `alreadyCredited` — eine erneute Zustellung (Pub/Sub, Kehrlauf,
 * Nachverarbeitung) storniert nie eine Gutschrift. Storno gibt es nur noch
 * durch einen Menschen (reviewDecision reject/no_reward bzw. Resolver).
 *
 * Altfehler: Die Vorprüfung in Schritt 5b (contentHash/transactionHash/
 * itemsHash) fragte nicht, ob der Bon selbst schon bezahlt ist. Lag eine
 * zweite Kopie desselben Bons in einem „lebenden" Status (bezahlt, in der
 * Prüfung, wartend), stornierte die erneute Zustellung des Originals dessen
 * Gutschrift. Dieselbe Lücke hatten alle Gates, die von Zustand außerhalb
 * des Bons abhängen (Aktion geändert, Freigabe durch einen Menschen bei
 * Zukunftsdatum) — die Buchung hält die Gutschrift jetzt selbst fest.
 *
 * Durchläuft den ECHTEN index.js gegen die Firestore-Attrappe.
 */

jest.mock('firebase-admin', () => require('./helpers/fakeAdmin').erstelleFakeAdmin());
jest.mock('firebase-functions', () => ({
  logger: {
    info: (...a) => global.__logs.push(a),
    warn: (...a) => global.__logs.push(a),
    error: () => {},
    debug: () => {},
  },
}));
jest.mock('firebase-functions/params', () => ({
  defineSecret: (name) => ({ name, value: () => (global.__secrets || {})[name] }),
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
const db = admin.firestore();
const U1 = 'nutzerEins';
const U2 = 'nutzerZwei';
const TAG = 24 * 60 * 60 * 1000;
const SCHLUESSEL = 'admin-key';

const berlinDatum = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
const GESTERN = berlinDatum(Date.now() - TAG);
const vorTagen = (n) => berlinDatum(Date.now() - n * TAG);
const inTagen = (n) => berlinDatum(Date.now() + n * TAG);

const ZEHN = ['Milch', 'Brot', 'Butter', 'Käse', 'Eier', 'Apfel', 'Birne', 'Saft', 'Tee', 'Reis']
  .map((name, i) => ({ name, priceCents: 100 + i * 10, qty: 1 }));
const SUMME = ZEHN.reduce((s, it) => s + it.priceCents, 0);

const ALLE = {
  doppelSumme: true, doppelKonten: true, doppelArtikel: true, doppelBestellnummer: true,
  doppelDatum: true, doppelKontenArtikel: true, doppelOnlineSeite: true, doppelKontenDatum: true,
};

/** Bon mit gespeicherter Lesung (der Lauf ruft kein Modell). */
function bonAnlegen(id, { uid = U1, datum = GESTERN, zeit = '10:15', extra = {} } = {}) {
  fake.store.set(`receipts/${id}`, {
    userId: uid,
    status: 'ocr_pending',
    campaignId: 'c1',
    createdAt: fake.zeit(Date.now() - 60 * 60 * 1000),
    storage: { bucket: 'b', path: `cashback-uploads/${uid}/${id}.jpg` },
    ocr: {
      engine: 'gemini-robust',
      model: 'test',
      promptVersion: 'test',
      parsed: {
        isReceipt: true,
        merchant: 'Netto Marken-Discount',
        bonCountry: 'DE',
        bonDate: datum,
        bonTime: zeit,
        totalCents: SUMME,
        items: ZEHN,
      },
      robust: { confidence: 'high', attempts: 2 },
      reconciliation: { ok: true, sumItemsCents: SUMME, deltaCents: 0, signedDeltaCents: 0, direction: 'exact' },
    },
    ...extra,
  });
}

/**
 * Zweite Kopie eines schon verarbeiteten Bons, mit gleichen Inhalts-Schlüsseln
 * (contentHash/transactionHash/itemsHash) — so, wie sie die Pipeline am Bon
 * ablegt. `bezahlt`: mit aktivem Earn im Ledger und im Tageszähler (wie die
 * vier echten Doppelzahlungen bis 04.10., die vor dem Doppel-Schutz liefen).
 */
function kopieVon(vorlage, id, { status = 'approved', bezahlt = true, uid = U1 } = {}) {
  const v = fake.store.get(`receipts/${vorlage}`);
  fake.store.set(`receipts/${id}`, {
    ...v,
    userId: uid,
    status,
    storage: { bucket: 'b', path: `cashback-uploads/${uid}/${id}.jpg` },
    ...(status === 'review' ? { reviewReason: 'ocr_confidence_low' } : {}),
  });
  if (bezahlt) {
    fake.store.set(`users/${uid}/cashback_ledger/earn-${id}`, {
      type: 'earn', cents: 8, receiptId: id, campaignId: 'c1', bonDate: v.bonDate,
    });
    const u = fake.store.get(`users/${uid}`);
    fake.store.set(`users/${uid}`, {
      ...u,
      cashback_balance_cents: (u.cashback_balance_cents || 0) + 8,
      cashback_lifetime_cents: (u.cashback_lifetime_cents || 0) + 8,
    });
    const tagPfad = `users/${uid}/cashback_days/${v.bonDate}`;
    const tag = fake.store.get(tagPfad) || { bonDate: v.bonDate, receiptIds: [] };
    fake.store.set(tagPfad, { ...tag, receiptIds: [...tag.receiptIds, id] });
  }
}

const verarbeiten = (id, uid = U1) =>
  fn.processCashback({ id: `ev-${id}-${Math.random()}`, data: { message: { json: { cashbackId: id, uid } } } });

/** Erneute Zustellung, wie sie der Kehrlauf oder ein Nachverarbeitungs-Skript auslöst. */
async function erneutZustellen(id, uid = U1) {
  fake.store.set(`receipts/${id}`, { ...fake.store.get(`receipts/${id}`), status: 'ocr_pending' });
  await verarbeiten(id, uid);
}

function antwort() {
  const r = { code: 200, body: undefined };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}

async function freigeben(id) {
  const res = antwort();
  await fn.resolveCashbackReview(
    { get: (h) => (h === 'x-admin-key' ? SCHLUESSEL : undefined), query: { receiptId: id, decision: 'approve' } },
    res,
  );
  return res;
}

const ledger = (uid = U1) =>
  [...fake.store.entries()].filter(([k]) => k.startsWith(`users/${uid}/cashback_ledger/`)).map(([, v]) => v);
const earns = (uid = U1) => ledger(uid).filter((l) => l.type === 'earn');
const stornos = (uid = U1) => ledger(uid).filter((l) => l.type === 'reverse');
const guthaben = (uid = U1) => fake.store.get(`users/${uid}`).cashback_balance_cents;
const log = (name) => global.__logs.filter((l) => l[0] === name).map((l) => l[1]);

function config(extra = {}) {
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, payoutThresholdCents: 1000, ...extra });
}

beforeEach(() => {
  fake.zuruecksetzen();
  global.__logs = [];
  global.__pushes = [];
  global.__secrets = { NUTRITION_SCRAPER_TRIGGER_KEY: SCHLUESSEL };
  const jetzt = Date.now();
  config();
  fake.store.set('cashback_campaigns/c1', {
    kind: 'receipt',
    active: true,
    startAt: fake.zeit(jetzt - 30 * TAG),
    endAt: fake.zeit(jetzt + 30 * TAG),
    cashbackPerBonCents: 8,
    budgetRemainingCents: 5000,
  });
  fake.store.set('discounter/netto', { name: 'Netto Marken-Discount', land: 'DE' });
  fake.store.set(`users/${U1}`, { cashback_balance_cents: 100, cashback_lifetime_cents: 100 });
  fake.store.set(`users/${U2}`, { cashback_balance_cents: 0, cashback_lifetime_cents: 0 });
});

describe('Vorprüfung 5b und schon bezahlte Bons (Altfehler)', () => {
  test.each([['Schalter aus (live heute)', {}], ['Doppel-Schutz scharf', ALLE]])(
    'zwei Kopien desselben Bons sind BEIDE bezahlt — erneute Zustellung storniert keine von beiden (%s)',
    async (_t, schalter) => {
      config(schalter);
      bonAnlegen('a');
      await verarbeiten('a');
      expect(fake.store.get('receipts/a').status).toBe('approved');
      kopieVon('a', 'b');
      expect(earns()).toHaveLength(2);
      expect(guthaben()).toBe(116);

      await erneutZustellen('a');
      await erneutZustellen('b');

      expect(stornos()).toHaveLength(0);
      expect(earns()).toHaveLength(2);
      expect(guthaben()).toBe(116);
      expect(fake.store.get('cashback_campaigns/c1').budgetRemainingCents).toBe(4992);
      for (const id of ['a', 'b']) {
        expect(fake.store.get(`receipts/${id}`)).toMatchObject({ status: 'approved', cashbackCents: 8, rejectReason: null, duplicateOf: null });
        expect(fake.store.get(`users/${U1}/cashback_status/${id}`)).toMatchObject({ status: 'approved', cashbackCents: 8, duplicate: null });
      }
      // Die Doppelzahlung bleibt sichtbar (Log), wird aber nicht zurückgeholt.
      expect(log('vorpruefung-doppel-schon-bezahlt')).toEqual(expect.arrayContaining([
        expect.objectContaining({ cashbackId: 'a', gegen: 'b', sameUser: true, priorStatus: 'approved' }),
        expect.objectContaining({ cashbackId: 'b', gegen: 'a', sameUser: true, priorStatus: 'approved' }),
      ]));
      // Keine Nachricht für eine erneute Zustellung.
      expect(global.__pushes).toHaveLength(1);
    },
  );

  test('bezahltes Original, eine Kopie liegt in der Prüfung → erneute Zustellung des Originals storniert nicht', async () => {
    bonAnlegen('a');
    await verarbeiten('a');
    kopieVon('a', 'k', { status: 'review', bezahlt: false });

    await erneutZustellen('a');

    expect(stornos()).toHaveLength(0);
    expect(fake.store.get('receipts/a')).toMatchObject({ status: 'approved', duplicateOf: null });
    expect(guthaben()).toBe(108);
  });

  test('über Konten: dieselbe Kopie bei einer anderen Person (gleiche Uhrzeit) ist bezahlt → das Original bleibt bezahlt, keine fremde ID im Log', async () => {
    bonAnlegen('a');
    await verarbeiten('a');
    kopieVon('a', 'f', { uid: U2 });

    await erneutZustellen('a');

    expect(stornos()).toHaveLength(0);
    expect(fake.store.get('receipts/a').status).toBe('approved');
    expect(log('vorpruefung-doppel-schon-bezahlt')).toEqual([
      expect.objectContaining({ cashbackId: 'a', sameUser: false, gegen: null, priorStatus: 'approved' }),
    ]);
  });

  test.each([['Schalter aus', {}], ['Doppel-Schutz scharf', ALLE]])(
    'eine NEUE, noch unbezahlte Kopie wird weiter abgelehnt, nichts gebucht (%s)',
    async (_t, schalter) => {
      config(schalter);
      bonAnlegen('a');
      await verarbeiten('a');
      bonAnlegen('n');
      await verarbeiten('n');
      expect(fake.store.get('receipts/n')).toMatchObject({
        status: 'rejected',
        rejectReason: 'duplicate_content_self',
        cashbackCents: 0,
        duplicateOf: { receiptId: 'a', sameUser: true, priorStatus: 'approved' },
      });
      expect(earns()).toHaveLength(1);
      expect(stornos()).toHaveLength(0);
      expect(guthaben()).toBe(108);
      expect(log('bestandsschutz-gutschrift')).toHaveLength(0);
    },
  );

  test('über Konten: neue, unbezahlte Kopie bei einer anderen Person → duplicate_content_cross_user, nichts gebucht', async () => {
    bonAnlegen('a');
    await verarbeiten('a');
    bonAnlegen('x', { uid: U2 });
    await verarbeiten('x', U2);
    expect(fake.store.get('receipts/x')).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_cross_user' });
    expect(earns(U2)).toHaveLength(0);
    expect(earns(U1)).toHaveLength(1);
  });

  test('Gutschrift entsteht zwischen Vorprüfung und Buchung (paralleler Lauf mit anderer Event-ID) → die Buchung storniert sie nicht', async () => {
    bonAnlegen('o');
    await verarbeiten('o');
    bonAnlegen('k');
    // Ein anderer Lauf bucht `k`, nachdem dieser Lauf das Ledger vorab gelesen
    // hat (alreadyCredited = false) — die Vorprüfung 5b lehnt `k` deshalb als
    // Kopie von `o` ab. Nachgestellt: direkt vor dem ersten Lesen des Ledgers
    // in der Buchungs-Transaktion steht der Earn plötzlich da.
    const original = db.runTransaction;
    let eingespielt = false;
    db.runTransaction = (cb) => original((tx) => cb({
      ...tx,
      get: async (r) => {
        if (!eingespielt && r.__abfrage && r.__pfad === `users/${U1}/cashback_ledger`) {
          eingespielt = true;
          fake.store.set(`users/${U1}/cashback_ledger/parallel-k`, { type: 'earn', cents: 8, receiptId: 'k', campaignId: 'c1', bonDate: GESTERN });
        }
        return tx.get(r);
      },
    }));
    try {
      await verarbeiten('k');
    } finally {
      db.runTransaction = original;
    }
    expect(eingespielt).toBe(true);
    expect(stornos()).toHaveLength(0);
    expect(fake.store.get('receipts/k')).toMatchObject({ status: 'approved', cashbackCents: 8, rejectReason: null, duplicateOf: null });
    expect(fake.store.get(`users/${U1}/cashback_status/k`)).toMatchObject({ status: 'approved', cashbackCents: 8 });
    expect(log('bestandsschutz-gutschrift')).toEqual([
      expect.objectContaining({ cashbackId: 'k', waereStatus: 'rejected', waereGrund: 'duplicate_content_self', gutgeschriebenCents: 8 }),
    ]);
  });
});

describe('weitere Gates, die von approved wegführen', () => {
  test('von Hand freigegebener Bon mit Zukunftsdatum → erneute Zustellung hält ihn nicht wieder an, kein Storno', async () => {
    bonAnlegen('z', { datum: inTagen(19) });
    await verarbeiten('z');
    expect(fake.store.get('receipts/z')).toMatchObject({ status: 'review', reviewReason: 'bon_date_future', cashbackCents: 8 });
    expect((await freigeben('z')).body).toMatchObject({ status: 'approved', creditedCents: 8 });
    expect(guthaben()).toBe(108);

    await erneutZustellen('z');

    expect(stornos()).toHaveLength(0);
    expect(guthaben()).toBe(108);
    expect(fake.store.get('receipts/z')).toMatchObject({ status: 'approved', reviewReason: null, reviewDecision: 'approve', cashbackCents: 8 });
    expect(fake.store.get(`users/${U1}/cashback_status/z`)).toMatchObject({ status: 'approved' });
  });

  test('Aktion nachträglich auf kürzere Frist gestellt → bezahlter Bon wird nicht als bon_too_old storniert', async () => {
    fake.store.set('cashback_campaigns/c1', { ...fake.store.get('cashback_campaigns/c1'), maxAgeDays: 14 });
    bonAnlegen('t', { datum: vorTagen(10) });
    await verarbeiten('t');
    expect(fake.store.get('receipts/t').status).toBe('approved');
    fake.store.set('cashback_campaigns/c1', { ...fake.store.get('cashback_campaigns/c1'), maxAgeDays: 7 });

    await erneutZustellen('t');

    expect(stornos()).toHaveLength(0);
    expect(fake.store.get('receipts/t')).toMatchObject({ status: 'approved', rejectReason: null, cashbackCents: 8 });
    expect(log('bestandsschutz-gutschrift')).toEqual([
      expect.objectContaining({ cashbackId: 't', waereStatus: 'rejected', waereGrund: 'bon_too_old' }),
    ]);
  });

  test('Aktionszeitraum nachträglich verkürzt (Upload liegt jetzt außerhalb) → kein Storno als no_active_campaign', async () => {
    bonAnlegen('w');
    await verarbeiten('w');
    fake.store.set('cashback_campaigns/c1', { ...fake.store.get('cashback_campaigns/c1'), endAt: fake.zeit(Date.now() - 2 * 60 * 60 * 1000) });

    await erneutZustellen('w');

    expect(stornos()).toHaveLength(0);
    expect(fake.store.get('receipts/w')).toMatchObject({ status: 'approved', rejectReason: null, cashbackCents: 8 });
    expect(guthaben()).toBe(108);
  });

  test.each([['reject', 'rejected'], ['no_reward', 'no_reward']])(
    'ein Mensch hat entschieden (reviewDecision %s) → Storno wie bisher',
    async (entscheidung, status) => {
      config(ALLE);
      bonAnlegen('m');
      await verarbeiten('m');
      fake.store.set('receipts/m', { ...fake.store.get('receipts/m'), reviewDecision: entscheidung, rejectReason: entscheidung === 'reject' ? 'manual_review_rejected' : 'daily_cap_reached' });

      await erneutZustellen('m');

      expect(fake.store.get('receipts/m').status).toBe(status);
      expect(stornos()).toHaveLength(1);
      expect(stornos()[0]).toMatchObject({ cents: 8, receiptId: 'm', reason: `reprocess_to_${status}` });
      expect(guthaben()).toBe(100);
      expect(log('bestandsschutz-gutschrift')).toHaveLength(0);
    },
  );
});
