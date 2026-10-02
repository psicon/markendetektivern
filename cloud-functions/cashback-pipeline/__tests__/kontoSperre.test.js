'use strict';

/**
 * Kontosperre auf der Geld-Seite (Entscheidung Patrick 02.10.2026,
 * „Ja, dann sperr die Konten"). Geprüft gegen den ECHTEN index.js mit einer
 * Firestore-Attrappe (helpers/fakeAdmin.js), nicht gegen eine Nachbildung:
 *
 *   - Bons: resolveCashbackReview bucht für ein gesperrtes Konto nichts —
 *     Status no_reward / konto_gesperrt, Bon und Spiegel stimmen mit dem
 *     Ledger überein, keine Nachricht. syncLedgerForReceipt ist dieselbe
 *     Funktion, über die auch processCashback bucht.
 *   - Auszahlung: requestPayout verweigert (403 konto_gesperrt), bei
 *     Lesefehler 503 sperre_unpruefbar, ohne Abbuchung. processPayout hält
 *     eine Anfrage an (failed + Rückbuchung) — aber nie eine, die schon an
 *     Tremendous ging (erneute Zustellung).
 *   - Nicht gesperrte Nutzer: alles wie vorher.
 *   - Bereits Gebuchtes wird durch die Sperre nicht storniert.
 */

jest.mock('firebase-admin', () => require('./helpers/fakeAdmin').erstelleFakeAdmin());
jest.mock('firebase-functions', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
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

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const fn = require('../index');
const {
  istGesperrt,
  sperreRef,
  sperreLesen,
  SPERREN_SAMMLUNG,
  GRUND_KONTO_GESPERRT,
  GRUND_SPERRE_UNPRUEFBAR,
} = require('../lib/kontoSperre');

const fake = admin.__fake;
const db = admin.firestore();
const UID = 'gesperrtUid';
const SCHLUESSEL = 'admin-key';

/** Express-artige Antwort-Attrappe. */
function antwort() {
  const r = { code: 200, body: undefined };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}

function ledger(uid = UID) {
  return [...fake.store.entries()]
    .filter(([k]) => k.startsWith(`users/${uid}/cashback_ledger/`))
    .map(([, v]) => v);
}

function sperren(uid = UID, daten = { gesperrt: true, grund: 'test', quelle: 'Entscheidung Patrick 02.10.2026' }) {
  fake.store.set(`${SPERREN_SAMMLUNG}/${uid}`, daten);
}

beforeEach(() => {
  fake.zuruecksetzen();
  global.__pushes = [];
  global.__secrets = { NUTRITION_SCRAPER_TRIGGER_KEY: SCHLUESSEL, TREMENDOUS_API_KEY: 'tk' };
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, payoutThresholdCents: 1000 });
  fake.store.set('cashback_campaigns/c1', {
    kind: 'receipt', active: true, budgetRemainingCents: 5000, cashbackPerBonCents: 8,
  });
  fake.store.set(`users/${UID}`, { cashback_balance_cents: 40, cashback_lifetime_cents: 1061 });
});

// ─── Regel ───────────────────────────────────────────────────────────

describe('istGesperrt — wann gilt ein Konto als gesperrt', () => {
  const snap = (daten) => ({ exists: daten !== undefined, data: () => daten });

  test('kein Dokument → nicht gesperrt (alle anderen Nutzer)', () => {
    expect(istGesperrt(snap(undefined))).toBe(false);
    expect(istGesperrt(null)).toBe(false);
  });
  test('gesperrt: true → gesperrt', () => {
    expect(istGesperrt(snap({ gesperrt: true, seit: 1, grund: 'x', quelle: 'y' }))).toBe(true);
  });
  test('ausdrücklich gesperrt: false → aufgehoben', () => {
    expect(istGesperrt(snap({ gesperrt: false, grund: 'aufgehoben' }))).toBe(false);
  });
  test('vertipptes oder fehlendes Feld sperrt im Zweifel (Geldpfad)', () => {
    expect(istGesperrt(snap({ gesperrt: 'true' }))).toBe(true);
    expect(istGesperrt(snap({ gesperrt: 'false' }))).toBe(true);
    expect(istGesperrt(snap({ grund: 'Feld vergessen' }))).toBe(true);
  });
  test('Sammlung und Schlüssel', () => {
    expect(sperreRef(db, 'abc').path).toBe('cashback_sperren/abc');
    expect(() => sperreRef(db, '')).toThrow();
    expect(() => sperreRef(db, undefined)).toThrow();
  });
  test('sperreLesen wirft bei Lesefehler — der Aufrufer entscheidet', async () => {
    fake.fehler.add(`cashback_sperren/${UID}`);
    await expect(sperreLesen(db, UID)).rejects.toThrow(/UNAVAILABLE/);
  });
});

describe('Kopie in crowd-upload-reward ist identisch', () => {
  test('nur der KOPIE-Kopf unterscheidet sich', () => {
    const quelle = fs.readFileSync(path.join(__dirname, '..', 'lib', 'kontoSperre.js'), 'utf8');
    const kopie = fs.readFileSync(
      path.join(__dirname, '..', '..', 'crowd-upload-reward', 'src', 'kontoSperre.js'),
      'utf8',
    );
    expect(kopie).toMatch(/KOPIE von cloud-functions\/cashback-pipeline\/lib\/kontoSperre\.js/);
    const ohneKopf = kopie.replace(/\/\* ─+\n[\s\S]*?─+ \*\/\n\n/, '');
    expect(ohneKopf).toBe(quelle);
  });
});

// ─── Bons: Freigabe über den Resolver ───────────────────────────────

function bonInPruefung(id = 'r1', extra = {}) {
  fake.store.set(`receipts/${id}`, {
    userId: UID,
    status: 'review',
    reviewReason: 'ocr_confidence_low',
    cashbackCents: 8,
    bonDate: '2026-10-01',
    campaignId: 'c1',
    campaignIdAngewandt: 'c1',
    merchant: { id: 'netto', name: 'Netto', land: 'DE' },
    ocr: { parsed: { bonDate: '2026-10-01', items: [{ name: 'Milch', priceCents: 99, qty: 1 }] } },
    ...extra,
  });
}

async function freigeben(id = 'r1') {
  const res = antwort();
  await fn.resolveCashbackReview(
    { get: (h) => (h === 'x-admin-key' ? SCHLUESSEL : undefined), query: { receiptId: id, decision: 'approve' } },
    res,
  );
  return res;
}

describe('Bons: gesperrtes Konto bekommt keine Gutschrift', () => {
  test('Freigabe → no_reward / konto_gesperrt, nichts gebucht, Spiegel = Ledger', async () => {
    sperren();
    bonInPruefung();
    const res = await freigeben();

    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, status: 'no_reward', creditedCents: 0, capReason: GRUND_KONTO_GESPERRT });
    expect(ledger()).toHaveLength(0);
    const u = fake.store.get(`users/${UID}`);
    expect(u.cashback_balance_cents).toBe(40);
    expect(u.cashback_lifetime_cents).toBe(1061);
    expect(fake.store.get('cashback_campaigns/c1').budgetRemainingCents).toBe(5000);
    const bon = fake.store.get('receipts/r1');
    expect(bon).toMatchObject({ status: 'no_reward', cashbackCents: 0, rejectReason: GRUND_KONTO_GESPERRT });
    expect(fake.store.get(`users/${UID}/cashback_status/r1`)).toMatchObject({
      status: 'no_reward', cashbackCents: 0, rejectReason: GRUND_KONTO_GESPERRT,
    });
    // Kein Tageszähler-Eintrag: der Bon zählt nicht als vergüteter Bon des Tages.
    expect(fake.store.get(`users/${UID}/cashback_days/2026-10-01`)).toBeUndefined();
    // Keine „Ka-ching!"-Nachricht.
    expect(global.__pushes).toHaveLength(0);
    // Der Bon bleibt gespeichert (Positionen im Tracking).
    expect([...fake.store.keys()].some((k) => k.startsWith(`users/${UID}/purchased_products/r1_`))).toBe(true);
  });

  test('nicht gesperrt → Gutschrift wie bisher', async () => {
    bonInPruefung();
    const res = await freigeben();

    expect(res.body).toMatchObject({ ok: true, status: 'approved', creditedCents: 8, capReason: null });
    const eintraege = ledger();
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]).toMatchObject({ type: 'earn', cents: 8, receiptId: 'r1', campaignId: 'c1' });
    expect(fake.store.get(`users/${UID}`).cashback_balance_cents).toBe(48);
    expect(fake.store.get('cashback_campaigns/c1').budgetRemainingCents).toBe(4992);
    expect(global.__pushes).toHaveLength(1);
  });

  test('Sperre aufgehoben (gesperrt: false) → Gutschrift wie bisher', async () => {
    sperren(UID, { gesperrt: false, grund: 'aufgehoben' });
    bonInPruefung();
    const res = await freigeben();
    expect(res.body).toMatchObject({ status: 'approved', creditedCents: 8 });
  });

  test('Sperre nicht lesbar → nichts gebucht, nichts entschieden (500, Bon bleibt in Prüfung)', async () => {
    bonInPruefung();
    fake.fehler.add(`cashback_sperren/${UID}`);
    const res = await freigeben();

    expect(res.code).toBe(500);
    expect(ledger()).toHaveLength(0);
    expect(fake.store.get(`users/${UID}`).cashback_balance_cents).toBe(40);
    const bon = fake.store.get('receipts/r1');
    expect(bon.status).toBe('review');
    // Der eigene Entscheidungs-Anspruch ist wieder frei → später erneut versuchbar.
    expect(bon.entscheidungLaeuft).toBeUndefined();
  });

  test('bestehende Gutschrift wird durch die Sperre NICHT storniert', async () => {
    // Bon wurde vor der Sperre gebucht; ein Teilfehler ließ ihn in 'review'.
    bonInPruefung();
    fake.store.set(`users/${UID}/cashback_ledger/alt`, {
      type: 'earn', cents: 8, receiptId: 'r1', campaignId: 'c1', bonDate: '2026-10-01',
    });
    sperren();
    const res = await freigeben();

    expect(res.body).toMatchObject({ status: 'approved', creditedCents: 8 });
    const eintraege = ledger();
    expect(eintraege).toHaveLength(1);
    expect(eintraege.some((e) => e.type === 'reverse')).toBe(false);
  });

  test('keine Aufwärts-Korrektur bei gesperrtem Konto — Bon zeigt den gebuchten Betrag', async () => {
    // Gebucht wurden 5 ct, die Neuberechnung ergäbe 8 ct.
    bonInPruefung();
    fake.store.set(`users/${UID}/cashback_ledger/alt`, {
      type: 'earn', cents: 5, receiptId: 'r1', campaignId: 'c1', bonDate: '2026-10-01',
    });
    sperren();
    const res = await freigeben();

    expect(res.body).toMatchObject({ status: 'approved', creditedCents: 5, capReason: GRUND_KONTO_GESPERRT });
    expect(ledger()).toHaveLength(1);
    expect(fake.store.get('receipts/r1')).toMatchObject({ status: 'approved', cashbackCents: 5 });
  });

  test('ohne Sperre läuft die Aufwärts-Korrektur wie bisher', async () => {
    bonInPruefung();
    fake.store.set(`users/${UID}/cashback_ledger/alt`, {
      type: 'earn', cents: 5, receiptId: 'r1', campaignId: 'c1', bonDate: '2026-10-01',
    });
    const res = await freigeben();
    expect(res.body).toMatchObject({ status: 'approved', creditedCents: 8 });
    expect(ledger().map((e) => e.cents).sort()).toEqual([3, 5]);
  });

  test('Ablehnen bleibt für gesperrte Konten möglich (Mensch entscheidet)', async () => {
    sperren();
    bonInPruefung();
    const res = antwort();
    await fn.resolveCashbackReview(
      { get: () => SCHLUESSEL, query: { receiptId: 'r1', decision: 'reject' } },
      res,
    );
    expect(res.body).toMatchObject({ ok: true, status: 'rejected' });
  });
});

// ─── Auszahlung anfragen ─────────────────────────────────────────────

function kontoMitEmail(uid = UID) {
  fake.tokens.set('tok', uid);
  fake.benutzer.set(uid, { uid, email: 'a@b.de', providerData: [{ providerId: 'password' }] });
}

async function anfragen(body = {}) {
  const res = antwort();
  await fn.requestPayout(
    { method: 'POST', headers: { authorization: 'Bearer tok' }, body },
    res,
  );
  return res;
}

function payouts() {
  return [...fake.store.entries()].filter(([k]) => k.startsWith('cashback_payouts/'));
}

describe('requestPayout: gesperrtes Konto kann nicht auszahlen', () => {
  beforeEach(() => {
    kontoMitEmail();
    fake.store.set(`users/${UID}`, { cashback_balance_cents: 1505, cashback_lifetime_cents: 1505 });
  });

  test('gesperrt → 403 konto_gesperrt, keine Abbuchung, kein Payout-Dokument', async () => {
    sperren();
    const res = await anfragen();
    expect(res.code).toBe(403);
    expect(res.body).toEqual({ code: GRUND_KONTO_GESPERRT });
    expect(fake.store.get(`users/${UID}`).cashback_balance_cents).toBe(1505);
    expect(payouts()).toHaveLength(0);
    expect(ledger()).toHaveLength(0);
  });

  test('Sperre nicht lesbar → 503 sperre_unpruefbar (wiederholbar), keine Abbuchung', async () => {
    fake.fehler.add(`cashback_sperren/${UID}`);
    const res = await anfragen();
    expect(res.code).toBe(503);
    expect(res.body).toEqual({ code: GRUND_SPERRE_UNPRUEFBAR });
    expect(fake.store.get(`users/${UID}`).cashback_balance_cents).toBe(1505);
    expect(payouts()).toHaveLength(0);
  });

  test('nicht gesperrt → Auszahlung wie bisher', async () => {
    const res = await anfragen();
    expect(res.code).toBe(200);
    expect(res.body).toMatchObject({ ok: true, amountCents: 1505 });
    expect(fake.store.get(`users/${UID}`).cashback_balance_cents).toBe(0);
    expect(payouts()).toHaveLength(1);
  });

  test('unter der Schwelle bleibt es bei below_threshold (Sperre ändert nichts daran)', async () => {
    fake.store.set(`users/${UID}`, { cashback_balance_cents: 505 });
    const res = await anfragen();
    expect(res.code).toBe(400);
    expect(res.body.code).toBe('below_threshold');
  });
});

// ─── Auszahlung verarbeiten ──────────────────────────────────────────

describe('processPayout: zweite Schranke vor Tremendous', () => {
  let bestellungen;
  beforeEach(() => {
    kontoMitEmail();
    bestellungen = [];
    global.fetch = async (url, opts = {}) => {
      if (String(url).endsWith('/funding_sources')) {
        return { ok: true, json: async () => ({ funding_sources: [{ id: 'fs1', method: 'balance' }] }) };
      }
      bestellungen.push({ url, body: opts.body });
      return {
        ok: true,
        json: async () => ({ order: { id: 'o1', rewards: [{ id: 'rw1', delivery: { link: 'https://x' } }] } }),
      };
    };
    // Zustand NACH requestPayout: Guthaben abgebucht, Anfrage angelegt.
    fake.store.set(`users/${UID}`, { cashback_balance_cents: 0, cashback_lifetime_cents: 1505 });
    fake.store.set('cashback_payouts/p1', { userId: UID, amountCents: 1505, status: 'requested' });
  });
  afterEach(() => {
    delete global.fetch;
  });

  const ereignis = () => ({
    params: { payoutId: 'p1' },
    data: {
      data: () => ({ userId: UID, amountCents: 1505, status: 'requested' }),
      ref: db.doc('cashback_payouts/p1'),
    },
  });

  test('gesperrt (nach der Anfrage gesetzt) → failed + Rückbuchung, keine Bestellung', async () => {
    sperren();
    await fn.processPayout(ereignis());
    expect(bestellungen).toHaveLength(0);
    expect(fake.store.get('cashback_payouts/p1')).toMatchObject({ status: 'failed', error: GRUND_KONTO_GESPERRT });
    expect(fake.store.get(`users/${UID}`).cashback_balance_cents).toBe(1505);
    const rueck = ledger().filter((e) => e.type === 'admin_adjust');
    expect(rueck).toHaveLength(1);
    expect(rueck[0]).toMatchObject({ cents: 1505, payoutId: 'p1', anlass: GRUND_KONTO_GESPERRT });
  });

  test('Sperre nicht lesbar → genauso angehalten (fail-closed), Nutzer kann neu anfragen', async () => {
    fake.fehler.add(`cashback_sperren/${UID}`);
    await fn.processPayout(ereignis());
    expect(bestellungen).toHaveLength(0);
    expect(fake.store.get('cashback_payouts/p1')).toMatchObject({ status: 'failed', error: GRUND_SPERRE_UNPRUEFBAR });
    expect(fake.store.get(`users/${UID}`).cashback_balance_cents).toBe(1505);
  });

  test('erneute Zustellung einer schon verschickten Auszahlung: KEINE Rückbuchung', async () => {
    fake.store.set('cashback_payouts/p1', { userId: UID, amountCents: 1505, status: 'sent' });
    sperren();
    await fn.processPayout(ereignis());
    expect(bestellungen).toHaveLength(0);
    expect(fake.store.get('cashback_payouts/p1').status).toBe('sent');
    expect(fake.store.get(`users/${UID}`).cashback_balance_cents).toBe(0);
    expect(ledger()).toHaveLength(0);
  });

  test('doppelt angehalten bucht nur einmal zurück', async () => {
    sperren();
    await fn.processPayout(ereignis());
    fake.store.set('cashback_payouts/p1', { ...fake.store.get('cashback_payouts/p1'), status: 'requested' });
    await fn.processPayout(ereignis());
    expect(ledger().filter((e) => e.type === 'admin_adjust')).toHaveLength(1);
    expect(fake.store.get(`users/${UID}`).cashback_balance_cents).toBe(1505);
  });

  test('nicht gesperrt → Bestellung wie bisher', async () => {
    await fn.processPayout(ereignis());
    expect(bestellungen).toHaveLength(1);
    expect(fake.store.get('cashback_payouts/p1')).toMatchObject({ status: 'sent', tremendousOrderId: 'o1' });
    expect(fake.store.get(`users/${UID}`).cashback_balance_cents).toBe(0);
  });
});
