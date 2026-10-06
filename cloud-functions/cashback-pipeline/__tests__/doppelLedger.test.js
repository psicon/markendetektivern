'use strict';

/**
 * Doppel-Schutz in der Buchung (syncLedgerForReceipt, Entscheidung Patrick
 * 04.10.2026: „ja, abstellen"). Durchläuft den ECHTEN index.js — Bon-Lauf
 * (processCashback, gespeicherte Texterkennung, kein Modellaufruf) und
 * Freigabe-Resolver — gegen die Firestore-Attrappe mit Konfliktprüfung.
 *
 * Geprüft wird das Geld, nicht nur der Status: genau ein Earn, Guthaben,
 * Budget, Tageszähler, Schlüssel, keine Positionen und keine Nachricht für
 * den abgelehnten Zwilling.
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

const admin = require('firebase-admin');
const fn = require('../index');
const { identitaet } = require('../lib/doppelBon');

const fake = admin.__fake;
const U1 = 'nutzerEins';
const U2 = 'nutzerZwei';
const TAG = 24 * 60 * 60 * 1000;
const SCHLUESSEL = 'admin-key';

const berlinDatum = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
const GESTERN = berlinDatum(Date.now() - TAG);
const VORGESTERN = berlinDatum(Date.now() - 2 * TAG);

const ZEHN = ['Milch', 'Brot', 'Butter', 'Käse', 'Eier', 'Apfel', 'Birne', 'Saft', 'Tee', 'Reis']
  .map((name, i) => ({ name, priceCents: 100 + i * 10, qty: 1 }));
const summe = (items) => items.reduce((s, it) => s + it.priceCents, 0);

const MAERKTE = {
  netto: 'Netto Marken-Discount',
  kaufland: 'Kaufland',
  dm: 'dm-drogerie markt',
};

/** Bon mit gespeicherter Lesung (der Lauf ruft kein Modell). */
function bonAnlegen(id, { uid = U1, markt = 'netto', items = ZEHN, total = summe(items), zeit = '10:15', datum = GESTERN, extra = {}, parsedExtra = {} } = {}) {
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
        merchant: MAERKTE[markt],
        bonCountry: 'DE',
        bonDate: datum,
        bonTime: zeit,
        totalCents: total,
        items,
        ...parsedExtra,
      },
      robust: { confidence: 'high', attempts: 2 },
      reconciliation: { ok: true, sumItemsCents: total, deltaCents: 0, signedDeltaCents: 0, direction: 'exact' },
    },
    ...extra,
  });
}

/** Bon in der Prüfung, wie ihn der Resolver vorfindet. */
function bonInPruefung(id, { uid = U1, markt = 'netto', items = ZEHN, total = summe(items), zeit = '10:15', datum = GESTERN, extra = {} } = {}) {
  fake.store.set(`receipts/${id}`, {
    userId: uid,
    status: 'review',
    reviewReason: 'ocr_confidence_low',
    cashbackCents: 8,
    bonDate: datum,
    bonTime: zeit,
    bonTotalCents: total,
    campaignId: 'c1',
    campaignIdAngewandt: 'c1',
    merchant: { id: markt, name: MAERKTE[markt], land: 'DE' },
    ocr: { parsed: { bonDate: datum, bonTime: zeit, totalCents: total, items } },
    ...extra,
  });
}

const verarbeiten = (id, uid = U1) =>
  fn.processCashback({ id: `ev-${id}-${Math.random()}`, data: { message: { json: { cashbackId: id, uid } } } });

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
const positionen = (uid, id) => [...fake.store.keys()].filter((k) => k.startsWith(`users/${uid}/purchased_products/${id}_`));
const schluesselDocs = () => [...fake.store.entries()].filter(([k]) => k.startsWith('cashback_bon_schluessel/'));
const kontenId = (markt, total, zeit, datum = GESTERN) => identitaet({ merchantId: markt, bonDate: datum, totalCents: total, bonTime: zeit }).kontenId;

function config(extra = {}) {
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, payoutThresholdCents: 1000, ...extra });
}

beforeEach(() => {
  fake.zuruecksetzen();
  global.__pushes = [];
  global.__secrets = { NUTRITION_SCRAPER_TRIGGER_KEY: SCHLUESSEL };
  const jetzt = Date.now();
  config({ doppelSumme: true, doppelKonten: true, doppelArtikel: true, doppelBestellnummer: true });
  fake.store.set('cashback_campaigns/c1', {
    kind: 'receipt',
    active: true,
    startAt: fake.zeit(jetzt - 10 * TAG),
    endAt: fake.zeit(jetzt + 10 * TAG),
    cashbackPerBonCents: 8,
    budgetRemainingCents: 5000,
  });
  for (const [id, name] of Object.entries(MAERKTE)) fake.store.set(`discounter/${id}`, { name, land: 'DE' });
  fake.store.set(`users/${U1}`, { cashback_balance_cents: 100, cashback_lifetime_cents: 100 });
  fake.store.set(`users/${U2}`, { cashback_balance_cents: 0, cashback_lifetime_cents: 0 });
});

describe('derselbe Bon, gleichzeitig verarbeitet (Kaufland 04.10.)', () => {
  test('zwei Fotos parallel → genau EINE Gutschrift, der Zwilling abgelehnt', async () => {
    bonAnlegen('k1', { markt: 'kaufland', zeit: '11:05' });
    bonAnlegen('k2', { markt: 'kaufland', zeit: '11:05' });
    await Promise.all([verarbeiten('k1'), verarbeiten('k2')]);

    expect(earns()).toHaveLength(1);
    expect(fake.store.get(`users/${U1}`).cashback_balance_cents).toBe(108);
    expect(fake.store.get('cashback_campaigns/c1').budgetRemainingCents).toBe(4992);
    const status = ['k1', 'k2'].map((id) => fake.store.get(`receipts/${id}`).status).sort();
    expect(status).toEqual(['approved', 'rejected']);
    const zwilling = ['k1', 'k2'].find((id) => fake.store.get(`receipts/${id}`).status === 'rejected');
    const original = zwilling === 'k1' ? 'k2' : 'k1';
    // In der Buchung erkannt (nicht in der Vorprüfung): duplicateOf trägt die Regel.
    expect(fake.store.get(`receipts/${zwilling}`)).toMatchObject({
      rejectReason: 'duplicate_content_self',
      cashbackCents: 0,
      duplicateOf: { receiptId: original, sameUser: true, priorStatus: 'approved', kind: 'summe' },
      doppelPruefung: { treffer: expect.arrayContaining([expect.objectContaining({ regel: 'summe', modus: 'wirksam' })]) },
    });
    expect(fake.store.get(`users/${U1}/cashback_status/${zwilling}`)).toMatchObject({
      status: 'rejected', rejectReason: 'duplicate_content_self', duplicate: { sameUser: true, priorReceiptId: original },
    });
    expect(fake.statistik.wiederholungen).toBeGreaterThanOrEqual(1);
    // Keine Positionen und keine Nachricht für den Zwilling.
    expect(positionen(U1, zwilling)).toHaveLength(0);
    expect(positionen(U1, original).length).toBeGreaterThan(0);
    expect(global.__pushes).toHaveLength(1);
    // Tageszähler: nur das Original, mit Doppel-Eintrag; der Schlüssel gehört ihm.
    const tag = fake.store.get(`users/${U1}/cashback_days/${GESTERN}`);
    expect(tag.receiptIds).toEqual([original]);
    expect(tag.eintraege[original]).toMatchObject({ markt: 'kaufland', summe: summe(ZEHN), uhrzeit: '11:05', v: 1 });
    expect(fake.store.get(`cashback_bon_schluessel/${kontenId('kaufland', summe(ZEHN), '11:05')}`)).toMatchObject({ receiptId: original, uid: U1, regel: 'konten', tag: GESTERN });
    expect(earns()[0].schluessel).toEqual([kontenId('kaufland', summe(ZEHN), '11:05')]);
  });
});

describe('andere Lesung der Summe / Teilfoto (Artikelregel)', () => {
  test('zweites Foto mit anderer Summe, 9 von 10 Artikeln gleich → abgelehnt (artikel)', async () => {
    bonAnlegen('d1', { markt: 'dm', zeit: '16:47' });
    await verarbeiten('d1');
    expect(fake.store.get('receipts/d1').status).toBe('approved');

    const anders = [...ZEHN.slice(0, 9), { name: 'Postkarte', priceCents: 150, qty: 1 }];
    bonAnlegen('d2', { markt: 'dm', items: anders, zeit: '16:48' });
    await verarbeiten('d2');

    expect(fake.store.get('receipts/d2')).toMatchObject({
      status: 'rejected',
      rejectReason: 'duplicate_content_self',
      duplicateOf: { receiptId: 'd1', kind: 'artikel' },
    });
    expect(fake.store.get('receipts/d2').doppelPruefung.treffer[0]).toMatchObject({ regel: 'artikel', anteil: 0.9 });
    expect(earns()).toHaveLength(1);
    expect(global.__pushes).toHaveLength(1);
  });

  test('echter Zweitkauf am selben Tag (wenig Überschneidung) → beide bezahlt', async () => {
    bonAnlegen('z1', { markt: 'netto', zeit: '09:00' });
    await verarbeiten('z1');
    const anderer = ['Nudeln', 'Soße', 'Wein', 'Chips', 'Kaffee', 'Zucker', 'Mehl', 'Milch', 'Brot', 'Salz']
      .map((name, i) => ({ name, priceCents: 300 + i, qty: 1 }));
    bonAnlegen('z2', { markt: 'netto', items: anderer, zeit: '18:00' });
    await verarbeiten('z2');
    expect(fake.store.get('receipts/z2').status).toBe('approved');
    expect(earns()).toHaveLength(2);
  });
});

describe('Beobachtungs-Modus', () => {
  test("'shadow' bucht beide und vermerkt den Treffer", async () => {
    config({ doppelSumme: 'shadow', doppelKonten: 'shadow', doppelArtikel: 'shadow' });
    bonAnlegen('s1', { zeit: '10:15' });
    await verarbeiten('s1');
    bonInPruefung('s2', { zeit: '10:15' });
    const res = await freigeben('s2');

    expect(res.body).toMatchObject({ ok: true, status: 'approved', creditedCents: 8 });
    expect(earns()).toHaveLength(2);
    const vermerk = fake.store.get('receipts/s2').doppelPruefung;
    // seite und bild sind per Code-Default an (Nachprüfung 05.10.2026).
    // seiteAbweichend wird per Code-Default beobachtet (Nachprüfung 06.10.2026).
    expect(vermerk.modi).toEqual({ summe: 'shadow', konten: 'shadow', artikel: 'shadow', bestellung: false, datum: false, kontenArtikel: false, seite: true, kontenDatum: false, bild: true, seiteAbweichend: 'shadow' });
    expect(vermerk.treffer.map((t) => [t.regel, t.modus])).toEqual(expect.arrayContaining([['summe', 'beobachtung'], ['konten', 'beobachtung'], ['artikel', 'beobachtung']]));
    // Der Schlüssel bleibt beim ersten Bon („der erste gewinnt").
    expect(fake.store.get(`cashback_bon_schluessel/${kontenId('netto', summe(ZEHN), '10:15')}`).receiptId).toBe('s1');
    expect(earns().find((e) => e.receiptId === 's2').schluessel).toEqual([]);
  });

  test('Code-Default (keine Schalter) → altes Verhalten, Einträge und Schlüssel werden trotzdem geschrieben', async () => {
    fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3 });
    bonAnlegen('o1');
    await verarbeiten('o1');
    bonInPruefung('o2');
    expect((await freigeben('o2')).body).toMatchObject({ status: 'approved' });
    expect(earns()).toHaveLength(2);
    expect(fake.store.get(`users/${U1}/cashback_days/${GESTERN}`).eintraege.o1).toBeDefined();
    expect(schluesselDocs()).toHaveLength(1);
    // Tages-Index (Regel kontenArtikel): bei ausgeschalteter Regel weder
    // gelesen noch geschrieben (Prüfrunde 3 — sonst ohne Größenbremse).
    expect(fake.store.get(`cashback_bon_tage/netto_${GESTERN}`)).toBeUndefined();
    expect(earns().find((e) => e.receiptId === 'o1').tagesIndex).toEqual([]);
    // Summen-Index (Regel kontenDatum, Prüfrunde 2) ebenso — mit Tag und Uhrzeit, ohne Namen.
    const summen = fake.store.get(`cashback_bon_summen/netto_${summe(ZEHN)}`);
    expect(Object.keys(summen.eintraege).sort()).toEqual(['o1', 'o2']);
    expect(summen.eintraege.o1).toMatchObject({ u: U1, t: GESTERN, z: '10:15' });
    expect(JSON.stringify(summen)).not.toMatch(/Milch/);
    expect(earns().find((e) => e.receiptId === 'o1').summenIndex).toEqual([`netto_${summe(ZEHN)}`]);
  });
});

describe('Freigabe über den Resolver (Prüfkonsole, Bon-Runde)', () => {
  test('Mensch gibt einen zurückgehaltenen Zwilling frei → abgelehnt, nichts gebucht', async () => {
    bonAnlegen('r1');
    await verarbeiten('r1');
    bonInPruefung('r2');
    const res = await freigeben('r2');

    expect(res.body).toEqual({ ok: true, status: 'rejected', rejectReason: 'duplicate_content_self', creditedCents: 0, capReason: 'duplicate_content_self' });
    expect(fake.store.get('receipts/r2')).toMatchObject({
      status: 'rejected', cashbackCents: 0, reviewDecision: 'approve',
      duplicateOf: { receiptId: 'r1', sameUser: true, priorStatus: 'approved', kind: 'summe' },
    });
    expect(fake.store.get('receipts/r2').entscheidungLaeuft).toBeUndefined();
    expect(fake.store.get(`users/${U1}/cashback_status/r2`)).toMatchObject({ status: 'rejected', duplicate: { sameUser: true, priorReceiptId: 'r1' } });
    expect(earns()).toHaveLength(1);
    expect(positionen(U1, 'r2')).toHaveLength(0);
    expect(global.__pushes).toHaveLength(1);
  });

  test('Bestand ohne Doppel-Eintrag (gebucht vor dem Umbau) → Vergleich über das Bon-Dokument', async () => {
    // r0 wurde vor dem Umbau gebucht: Tageszähler ohne `eintraege`, kein Schlüssel.
    fake.store.set('receipts/r0', {
      userId: U1, status: 'approved', bonDate: GESTERN, bonTime: '10:15', bonTotalCents: summe(ZEHN),
      merchant: { id: 'netto', name: 'Netto' }, ocr: { parsed: { items: ZEHN } },
    });
    fake.store.set(`users/${U1}/cashback_days/${GESTERN}`, { bonDate: GESTERN, receiptIds: ['r0'] });
    fake.store.set(`users/${U1}/cashback_ledger/alt`, { type: 'earn', cents: 8, receiptId: 'r0', campaignId: 'c1', bonDate: GESTERN });
    bonInPruefung('r3', { zeit: '10:16' });
    const res = await freigeben('r3');
    expect(res.body).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_self' });
    expect(fake.store.get('receipts/r3').duplicateOf).toMatchObject({ receiptId: 'r0', kind: 'summe' });
  });

  test('über Konten: gleicher Markt, Tag, Uhrzeit und Summe bei einer anderen Person → cross_user, keine fremde ID im Spiegel', async () => {
    bonAnlegen('x1', { uid: U1, markt: 'kaufland', zeit: '11:05' });
    await verarbeiten('x1', U1);
    bonInPruefung('x2', { uid: U2, markt: 'kaufland', zeit: '11:05' });
    const res = await freigeben('x2');

    expect(res.body).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_cross_user' });
    expect(fake.store.get('receipts/x2').duplicateOf).toMatchObject({ receiptId: 'x1', sameUser: false, kind: 'konten' });
    expect(fake.store.get(`users/${U2}/cashback_status/x2`).duplicate).toEqual({ sameUser: false, priorReceiptId: null });
    expect(earns(U2)).toHaveLength(0);
    expect(fake.store.get(`users/${U2}`).cashback_balance_cents).toBe(0);
  });

  test('über Konten ohne Uhrzeit → kein Schlüssel, beide Personen bezahlt', async () => {
    bonAnlegen('y1', { uid: U1, markt: 'kaufland', zeit: null });
    await verarbeiten('y1', U1);
    bonInPruefung('y2', { uid: U2, markt: 'kaufland', zeit: null });
    expect((await freigeben('y2')).body).toMatchObject({ status: 'approved', creditedCents: 8 });
    expect(schluesselDocs()).toHaveLength(0);
  });

  test('Bestellnummer einer Online-Bestellung sperrt über Konten', async () => {
    const online = { belegart: 'online_bestellung', bestellnummer: 'DM-4711-0815' };
    bonAnlegen('o1', { uid: U1, markt: 'dm', zeit: null, parsedExtra: online });
    await verarbeiten('o1', U1);
    expect(fake.store.get('receipts/o1')).toMatchObject({ status: 'approved', belegart: 'online_bestellung', store: null });
    fake.store.set('receipts/o2', {
      userId: U2, status: 'review', reviewReason: 'ocr_confidence_low', cashbackCents: 8,
      bonDate: GESTERN, bonTime: null, bonTotalCents: summe(ZEHN) + 1, campaignId: 'c1', campaignIdAngewandt: 'c1',
      merchant: { id: 'dm', name: 'dm', land: 'DE' },
      ocr: { parsed: { bonDate: GESTERN, totalCents: summe(ZEHN) + 1, items: ZEHN, ...online } },
    });
    const res = await freigeben('o2');
    expect(res.body).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_cross_user' });
    expect(fake.store.get('receipts/o2').duplicateOf).toMatchObject({ receiptId: 'o1', kind: 'bestellung' });
  });
});

describe('Storno, Sperre, Bestand', () => {
  test('Storno gibt Eintrag und Schlüssel frei; danach wird der Zwilling bezahlt', async () => {
    bonAnlegen('a1', { zeit: '12:00' });
    await verarbeiten('a1');
    const id = kontenId('netto', summe(ZEHN), '12:00');
    expect(fake.store.get(`cashback_bon_schluessel/${id}`).receiptId).toBe('a1');

    // Ein Mensch lehnt a1 nachträglich ab; die erneute Zustellung storniert.
    const a1 = fake.store.get('receipts/a1');
    fake.store.set('receipts/a1', { ...a1, status: 'ocr_pending', reviewDecision: 'reject', rejectReason: 'manual_review_rejected' });
    await verarbeiten('a1');
    expect(fake.store.get('receipts/a1').status).toBe('rejected');
    expect(ledger().filter((l) => l.type === 'reverse')).toHaveLength(1);
    const tag = fake.store.get(`users/${U1}/cashback_days/${GESTERN}`);
    expect(tag.receiptIds).toEqual([]);
    expect(tag.eintraege.a1).toBeUndefined();
    expect(fake.store.get(`cashback_bon_schluessel/${id}`)).toBeUndefined();

    bonInPruefung('a2', { zeit: '12:00' });
    expect((await freigeben('a2')).body).toMatchObject({ status: 'approved', creditedCents: 8 });
    expect(fake.store.get(`cashback_bon_schluessel/${id}`).receiptId).toBe('a2');
  });

  test('ein Schlüssel, dessen Bon nicht mehr bezahlt ist, sperrt nicht (z. B. Storno durch einen alten Stand)', async () => {
    const id = kontenId('kaufland', summe(ZEHN), '11:05');
    fake.store.set(`cashback_bon_schluessel/${id}`, { receiptId: 'weg', uid: U2, regel: 'konten', tag: GESTERN });
    bonInPruefung('f1', { markt: 'kaufland', zeit: '11:05' });
    expect((await freigeben('f1')).body).toMatchObject({ status: 'approved' });
    expect(fake.store.get(`cashback_bon_schluessel/${id}`)).toMatchObject({ receiptId: 'f1', uid: U1 });
  });

  test('Sperre geht vor Doppel: gesperrtes Konto → no_reward / konto_gesperrt', async () => {
    bonAnlegen('g1');
    await verarbeiten('g1');
    fake.store.set(`cashback_sperren/${U1}`, { gesperrt: true });
    bonInPruefung('g2');
    const res = await freigeben('g2');
    expect(res.body).toMatchObject({ status: 'no_reward', capReason: 'konto_gesperrt' });
    expect(fake.store.get('receipts/g2').doppelPruefung).toBeUndefined();
  });

  test('ein schon gebuchter Bon wird nie storniert, auch wenn der Schalter später scharf wird', async () => {
    // Zwei Fotos desselben Bons, die Summe einmal anders gelesen: die
    // Vorprüfung (exakte Schlüssel) sieht sie nicht, nur die Artikelregel —
    // im Beobachtungs-Modus werden beide gebucht.
    config({ doppelArtikel: 'shadow' });
    bonAnlegen('b1');
    bonAnlegen('b2', { zeit: '10:16', items: [...ZEHN.slice(0, 9), { name: 'Postkarte', priceCents: 150, qty: 1 }] });
    await verarbeiten('b1');
    await verarbeiten('b2');
    expect(earns()).toHaveLength(2);
    expect(fake.store.get('receipts/b2').doppelPruefung.treffer[0]).toMatchObject({ regel: 'artikel', modus: 'beobachtung' });
    config({ doppelSumme: true, doppelArtikel: true, doppelKonten: true });
    // erneute Zustellung beider Bons: kein Storno, keine neue Buchung
    for (const id of ['b1', 'b2']) {
      const b = fake.store.get(`receipts/${id}`);
      fake.store.set(`receipts/${id}`, { ...b, status: 'ocr_pending' });
      await verarbeiten(id);
    }
    expect(ledger().filter((l) => l.type === 'reverse')).toHaveLength(0);
    expect(earns()).toHaveLength(2);
    expect(['b1', 'b2'].map((id) => fake.store.get(`receipts/${id}`).status)).toEqual(['approved', 'approved']);
  });

  test('erneute Zustellung eines Bestands-Bons trägt den Doppel-Eintrag nach', async () => {
    bonAnlegen('n1');
    fake.store.set(`users/${U1}/cashback_days/${GESTERN}`, { bonDate: GESTERN, receiptIds: ['n1'] });
    fake.store.set(`users/${U1}/cashback_ledger/alt`, { type: 'earn', cents: 8, receiptId: 'n1', campaignId: 'c1', bonDate: GESTERN });
    await verarbeiten('n1');
    expect(earns()).toHaveLength(1);
    expect(fake.store.get(`users/${U1}/cashback_days/${GESTERN}`).eintraege.n1).toMatchObject({ markt: 'netto', summe: summe(ZEHN) });
  });

  test('liest die neue Lesung ein anderes Datum, wandert das Tageslimit mit dem Bon — der Doppel-Eintrag bleibt auch im alten Tag', async () => {
    bonAnlegen('m1');
    await verarbeiten('m1');
    const b = fake.store.get('receipts/m1');
    fake.store.set('receipts/m1', { ...b, status: 'ocr_pending', ocr: { ...b.ocr, parsed: { ...b.ocr.parsed, bonDate: VORGESTERN } } });
    await verarbeiten('m1');
    expect(fake.store.get(`users/${U1}/cashback_days/${GESTERN}`)).toMatchObject({ receiptIds: [] });
    expect(fake.store.get(`users/${U1}/cashback_days/${GESTERN}`).eintraege.m1).toBeDefined();
    expect(fake.store.get(`users/${U1}/cashback_days/${VORGESTERN}`)).toMatchObject({ receiptIds: ['m1'] });
    expect(fake.store.get(`users/${U1}/cashback_days/${VORGESTERN}`).eintraege.m1).toBeDefined();
  });

  test('Prüfrunde 2: ohne Uhrzeit — Zweitfoto mit der ALTEN Lesung nach neuer Datumslesung → abgelehnt (summe)', async () => {
    bonAnlegen('m1', { zeit: null });
    await verarbeiten('m1');
    const b = fake.store.get('receipts/m1');
    fake.store.set('receipts/m1', { ...b, status: 'ocr_pending', ocr: { ...b.ocr, parsed: { ...b.ocr.parsed, bonDate: VORGESTERN } } });
    await verarbeiten('m1');
    expect(fake.store.get('receipts/m1')).toMatchObject({ status: 'approved', bonDate: VORGESTERN });
    bonAnlegen('m2', { zeit: null });
    await verarbeiten('m2');
    expect(fake.store.get('receipts/m2')).toMatchObject({
      status: 'rejected', rejectReason: 'duplicate_content_self',
      duplicateOf: { receiptId: 'm1', sameUser: true, kind: 'summe' },
    });
    expect(earns()).toHaveLength(1);
  });

  test('ein verwaister Eintrag, dessen Bon storniert ist, sperrt nicht (Ledger entscheidet)', async () => {
    bonAnlegen('w1', { zeit: null });
    await verarbeiten('w1');
    // Eintrag steht, aber der Bon zählt nicht mehr im Tageszähler und ist storniert.
    const tag = fake.store.get(`users/${U1}/cashback_days/${GESTERN}`);
    fake.store.set(`users/${U1}/cashback_days/${GESTERN}`, { ...tag, receiptIds: [] });
    fake.store.set(`users/${U1}/cashback_ledger/storno-w1`, { type: 'reverse', cents: 8, receiptId: 'w1' });
    fake.store.set('receipts/w1', { ...fake.store.get('receipts/w1'), status: 'rejected', rejectReason: 'manual_review_rejected' });
    bonAnlegen('w2', { zeit: null });
    await verarbeiten('w2');
    expect(fake.store.get('receipts/w2').status).toBe('approved');
  });

  test('Schlüssel nicht lesbar → nichts gebucht, nach dem letzten Versuch review, nie rejected', async () => {
    const id = kontenId('netto', summe(ZEHN), '10:15');
    fake.fehler.add(`cashback_bon_schluessel/${id}`);
    bonAnlegen('e1', { extra: { attempts: 4 } });
    await verarbeiten('e1');
    expect(fake.store.get('receipts/e1')).toMatchObject({ status: 'review', reviewReason: 'ledger_tx_failed' });
    expect(ledger()).toHaveLength(0);

    bonInPruefung('e2');
    const res = await freigeben('e2');
    expect(res.code).toBe(500);
    expect(fake.store.get('receipts/e2').status).toBe('review');
    expect(ledger()).toHaveLength(0);
  });
});

describe('Prüfrunde 04.10.: neue Datumslesung eines bezahlten Bons', () => {
  test('Bestellnummer: Datum wandert, der Schlüssel sperrt weiter (Ledger entscheidet, nicht der Tag)', async () => {
    const online = { belegart: 'online_bestellung', bestellnummer: 'DM-4711-0815' };
    bonAnlegen('o1', { uid: U1, markt: 'dm', zeit: null, parsedExtra: online });
    await verarbeiten('o1', U1);
    const b = fake.store.get('receipts/o1');
    fake.store.set('receipts/o1', { ...b, status: 'ocr_pending', ocr: { ...b.ocr, parsed: { ...b.ocr.parsed, bonDate: VORGESTERN } } });
    await verarbeiten('o1', U1);
    expect(earns()).toHaveLength(1);
    expect(fake.store.get(`users/${U1}/cashback_days/${VORGESTERN}`).receiptIds).toEqual(['o1']);
    const [[, schl]] = schluesselDocs();
    expect(schl).toMatchObject({ receiptId: 'o1', regel: 'bestellung', tag: VORGESTERN });

    fake.store.set('receipts/o2', {
      userId: U2, status: 'review', reviewReason: 'ocr_confidence_low', cashbackCents: 8,
      bonDate: GESTERN, bonTime: null, bonTotalCents: summe(ZEHN), campaignId: 'c1', campaignIdAngewandt: 'c1',
      merchant: { id: 'dm', name: 'dm', land: 'DE' },
      ocr: { parsed: { bonDate: GESTERN, totalCents: summe(ZEHN), items: ZEHN, ...online } },
    });
    const res = await freigeben('o2');
    expect(res.body).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_cross_user', creditedCents: 0 });
    expect(earns(U2)).toHaveLength(0);
  });

  test('Kontenschlüssel: der Bon sperrt unter der alten UND der neuen Lesung', async () => {
    bonAnlegen('k1', { uid: U1, markt: 'kaufland', zeit: '11:05' });
    await verarbeiten('k1', U1);
    const b = fake.store.get('receipts/k1');
    fake.store.set('receipts/k1', { ...b, status: 'ocr_pending', ocr: { ...b.ocr, parsed: { ...b.ocr.parsed, bonDate: VORGESTERN } } });
    await verarbeiten('k1', U1);
    const alt = kontenId('kaufland', summe(ZEHN), '11:05', GESTERN);
    const neu = kontenId('kaufland', summe(ZEHN), '11:05', VORGESTERN);
    expect(fake.store.get(`cashback_bon_schluessel/${alt}`)).toMatchObject({ receiptId: 'k1' });
    expect(fake.store.get(`cashback_bon_schluessel/${neu}`)).toMatchObject({ receiptId: 'k1', tag: VORGESTERN });
    expect(earns().find((e) => e.receiptId === 'k1').schluessel.sort()).toEqual([alt, neu].sort());

    bonInPruefung('k2', { uid: U2, markt: 'kaufland', zeit: '11:05', datum: GESTERN });
    expect((await freigeben('k2')).body).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_cross_user' });
    bonInPruefung('k3', { uid: U2, markt: 'kaufland', zeit: '11:05', datum: VORGESTERN });
    expect((await freigeben('k3')).body).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_cross_user' });
    expect(earns(U2)).toHaveLength(0);

    // Storno gibt BEIDE Schlüssel frei.
    const k1 = fake.store.get('receipts/k1');
    fake.store.set('receipts/k1', { ...k1, status: 'ocr_pending', reviewDecision: 'reject', rejectReason: 'manual_review_rejected' });
    await verarbeiten('k1', U1);
    expect(fake.store.get(`cashback_bon_schluessel/${alt}`)).toBeUndefined();
    expect(fake.store.get(`cashback_bon_schluessel/${neu}`)).toBeUndefined();
    // Regel kontenArtikel ist hier aus → kein Tages-Index geführt.
    expect(fake.store.get(`cashback_bon_tage/kaufland_${GESTERN}`)).toBeUndefined();
  });
});

describe('Prüfrunde 04.10.: Angriffe (alle Regeln scharf)', () => {
  beforeEach(() => {
    config({ doppelSumme: true, doppelKonten: true, doppelArtikel: true, doppelBestellnummer: true, doppelDatum: true, doppelKontenArtikel: true });
  });

  test('gleiche Person, Kopie mit um einen Tag geändertem Datum → abgelehnt (datum)', async () => {
    bonAnlegen('d1', { markt: 'kaufland', zeit: '11:05', datum: GESTERN });
    await verarbeiten('d1');
    bonAnlegen('d2', { markt: 'kaufland', zeit: '11:05', datum: VORGESTERN });
    await verarbeiten('d2');
    expect(fake.store.get('receipts/d2')).toMatchObject({
      status: 'rejected', rejectReason: 'duplicate_content_self', cashbackCents: 0,
      duplicateOf: { receiptId: 'd1', sameUser: true, kind: 'datum' },
    });
    expect(earns()).toHaveLength(1);
    expect(global.__pushes).toHaveLength(1);
  });

  test('gleiche Person, gleicher Markt, anderer Tag, andere Uhrzeit (Gewohnheitskauf, andere Summe) → bezahlt', async () => {
    bonAnlegen('g1', { markt: 'kaufland', zeit: '11:05', datum: GESTERN });
    await verarbeiten('g1');
    // Dieselben Artikel plus einer — eine echte Wiederholung hat nie dieselbe
    // Endsumme (0 von 3.834 Paaren, Prüfrunde 2).
    bonAnlegen('g2', { markt: 'kaufland', zeit: '17:40', datum: VORGESTERN, items: [...ZEHN, { name: 'Kaffee', priceCents: 499, qty: 1 }] });
    await verarbeiten('g2');
    expect(fake.store.get('receipts/g2').status).toBe('approved');
    expect(earns()).toHaveLength(2);
  });

  test.each([['Minute geändert', '11:06'], ['Uhrzeit verdeckt', null]])(
    'Prüfrunde 2: gleiche Person, Datum −1 Tag und %s → abgelehnt (datum ohne Uhrzeit)',
    async (_titel, zeit) => {
      bonAnlegen('a1', { markt: 'kaufland', zeit: '11:05', datum: GESTERN });
      await verarbeiten('a1');
      bonAnlegen('a2', { markt: 'kaufland', zeit, datum: VORGESTERN });
      await verarbeiten('a2');
      expect(fake.store.get('receipts/a2')).toMatchObject({
        status: 'rejected', rejectReason: 'duplicate_content_self',
        duplicateOf: { receiptId: 'a1', sameUser: true, kind: 'datum' },
      });
      expect(fake.store.get('receipts/a2').doppelPruefung.treffer[0]).toMatchObject({ regel: 'datum', ohneUhrzeit: true });
      expect(earns()).toHaveLength(1);
    },
  );

  test('zweites Konto, Uhrzeit verdeckt → abgelehnt (kontenArtikel), keine fremde ID im Spiegel', async () => {
    bonAnlegen('k1', { uid: U1, markt: 'kaufland', zeit: '11:05' });
    await verarbeiten('k1', U1);
    bonAnlegen('k2', { uid: U2, markt: 'kaufland', zeit: null });
    await verarbeiten('k2', U2);
    expect(fake.store.get('receipts/k2')).toMatchObject({
      status: 'rejected', rejectReason: 'duplicate_content_cross_user',
      duplicateOf: { receiptId: 'k1', sameUser: false, kind: 'kontenArtikel' },
    });
    expect(fake.store.get(`users/${U2}/cashback_status/k2`).duplicate).toEqual({ sameUser: false, priorReceiptId: null });
    expect(earns(U2)).toHaveLength(0);
  });

  test('zweites Konto, Minute der Uhrzeit geändert → abgelehnt (kontenArtikel)', async () => {
    bonAnlegen('m1', { uid: U1, markt: 'kaufland', zeit: '11:05' });
    await verarbeiten('m1', U1);
    bonAnlegen('m2', { uid: U2, markt: 'kaufland', zeit: '11:06' });
    await verarbeiten('m2', U2);
    expect(fake.store.get('receipts/m2')).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_cross_user' });
    expect(earns(U2)).toHaveLength(0);
  });

  test('zweites Konto, anderer Einkauf am selben Markt und Tag → bezahlt', async () => {
    bonAnlegen('a1', { uid: U1, markt: 'kaufland', zeit: '11:05' });
    await verarbeiten('a1', U1);
    const anderer = ['Nudeln', 'Soße', 'Wein', 'Chips', 'Kaffee', 'Zucker', 'Mehl', 'Milch', 'Brot', 'Salz']
      .map((name, i) => ({ name, priceCents: 300 + i, qty: 1 }));
    bonAnlegen('a2', { uid: U2, markt: 'kaufland', items: anderer, zeit: null });
    await verarbeiten('a2', U2);
    expect(fake.store.get('receipts/a2').status).toBe('approved');
  });

  test('stornierter Bon im Tages-Index sperrt nicht (Ledger entscheidet)', async () => {
    bonAnlegen('s1', { uid: U1, markt: 'kaufland', zeit: '11:05' });
    await verarbeiten('s1', U1);
    // Storno an der Buchung vorbei (alter Stand, Test-Reset): Eintrag bleibt stehen.
    fake.store.set(`users/${U1}/cashback_ledger/storno-alt`, { type: 'reverse', cents: 8, receiptId: 's1' });
    expect(fake.store.get(`cashback_bon_tage/kaufland_${GESTERN}`).eintraege.s1).toBeDefined();
    bonAnlegen('s2', { uid: U2, markt: 'kaufland', zeit: null });
    await verarbeiten('s2', U2);
    expect(fake.store.get('receipts/s2').status).toBe('approved');
  });

  test('voller Tages-Index: der Bon wird trotzdem bezahlt, nur nicht eingetragen', async () => {
    const eintraege = {};
    for (let i = 0; i < 600; i++) eintraege[`x${i}`] = { u: `w${i}`, a: ['00000000'] };
    fake.store.set(`cashback_bon_tage/kaufland_${GESTERN}`, { eintraege });
    bonAnlegen('v1', { uid: U1, markt: 'kaufland', zeit: '11:05' });
    await verarbeiten('v1', U1);
    expect(fake.store.get('receipts/v1').status).toBe('approved');
    expect(fake.store.get(`cashback_bon_tage/kaufland_${GESTERN}`).eintraege.v1).toBeUndefined();
    expect(earns().find((e) => e.receiptId === 'v1').tagesIndex).toEqual([]);
  });
});

describe('Prüfrunde 2: zweites Konto mit geändertem Datum (kontenDatum)', () => {
  beforeEach(() => {
    config({ doppelSumme: true, doppelKonten: true, doppelArtikel: true, doppelDatum: true, doppelKontenArtikel: true, doppelKontenDatum: true });
  });

  test.each([['gleiche Uhrzeit', '11:05'], ['Uhrzeit verdeckt', null]])('Datum −1 Tag, %s → abgelehnt (cross_user), keine fremde ID im Spiegel', async (_t, zeit) => {
    bonAnlegen('c1', { uid: U1, markt: 'kaufland', zeit: '11:05', datum: GESTERN });
    await verarbeiten('c1', U1);
    bonAnlegen('c2', { uid: U2, markt: 'kaufland', zeit, datum: VORGESTERN });
    await verarbeiten('c2', U2);
    expect(fake.store.get('receipts/c2')).toMatchObject({
      status: 'rejected', rejectReason: 'duplicate_content_cross_user',
      duplicateOf: { receiptId: 'c1', sameUser: false, kind: 'kontenDatum' },
    });
    expect(earns(U2)).toHaveLength(0);
    expect(JSON.stringify(fake.store.get(`users/${U2}/cashback_status/c2`) || {})).not.toMatch(/c1/);
  });

  test("Schalter 'shadow' → bezahlt, Treffer vermerkt", async () => {
    config({ doppelSumme: true, doppelKontenDatum: 'shadow' });
    bonAnlegen('c1', { uid: U1, markt: 'kaufland', zeit: '11:05', datum: GESTERN });
    await verarbeiten('c1', U1);
    bonAnlegen('c2', { uid: U2, markt: 'kaufland', zeit: null, datum: VORGESTERN });
    await verarbeiten('c2', U2);
    expect(fake.store.get('receipts/c2').status).toBe('approved');
    expect(fake.store.get('receipts/c2').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'kontenDatum', modus: 'beobachtung', gegen: 'c1' })]);
  });

  test('anderer Einkauf mit zufällig gleicher Summe an einem anderen Tag → bezahlt', async () => {
    bonAnlegen('c1', { uid: U1, markt: 'kaufland', zeit: '11:05', datum: GESTERN });
    await verarbeiten('c1', U1);
    const andere = ['Nudeln', 'Wein', 'Chips', 'Kaffee', 'Zucker', 'Mehl', 'Salz', 'Senf', 'Essig', 'Öl']
      .map((name, i) => ({ name, priceCents: 100 + i * 10, qty: 1 }));
    bonAnlegen('c2', { uid: U2, markt: 'kaufland', zeit: '17:20', datum: VORGESTERN, items: andere });
    await verarbeiten('c2', U2);
    expect(fake.store.get('receipts/c2').status).toBe('approved');
  });

  test('Storno des Originals gibt den Summen-Eintrag frei; veraltete Einträge räumt die nächste Gutschrift', async () => {
    fake.store.set(`cashback_bon_summen/kaufland_${summe(ZEHN)}`, { eintraege: { uralt: { u: 'x', t: '2025-01-01', z: null, a: [] } } });
    bonAnlegen('c1', { uid: U1, markt: 'kaufland', zeit: '11:05', datum: GESTERN });
    await verarbeiten('c1', U1);
    const idx = fake.store.get(`cashback_bon_summen/kaufland_${summe(ZEHN)}`);
    expect(Object.keys(idx.eintraege)).toEqual(['c1']);
    const b = fake.store.get('receipts/c1');
    fake.store.set('receipts/c1', { ...b, status: 'ocr_pending', reviewDecision: 'reject', rejectReason: 'manual_review_rejected' });
    await verarbeiten('c1', U1);
    expect(fake.store.get(`cashback_bon_summen/kaufland_${summe(ZEHN)}`).eintraege.c1).toBeUndefined();
    bonAnlegen('c2', { uid: U2, markt: 'kaufland', zeit: null, datum: VORGESTERN });
    await verarbeiten('c2', U2);
    expect(fake.store.get('receipts/c2').status).toBe('approved');
  });
});

describe('Prüfrunde 2: Seiten einer Online-Rechnung (doppelOnlineSeite)', () => {
  const S1 = ['Cremedusche', 'Koerperlotion', 'Babypuder', 'Feuchttuecher', 'Shampoo', 'Deo Roll-on', 'Windeln Gr4']
    .map((name, i) => ({ name, priceCents: 55 + i * 100, qty: 1 }));
  const S2 = ['Bad Shampoo', 'Schubladensicherung', 'Schrankschloss', 'Steckdosenschutz', 'Eckenschutz', 'Multisicherung', 'Duschgel', 'Entkalker']
    .map((name, i) => ({ name, priceCents: 125 + i * 30, qty: 1 }));
  /** Seite einer dm.de-Rechnung ohne gedruckten Endbetrag, ohne Uhrzeit. */
  function seite(id, items, bestellnummer = null) {
    bonAnlegen(id, { markt: 'dm', zeit: null, items, parsedExtra: { belegart: 'online_bestellung', bestellnummer, totalCents: null } });
    delete fake.store.get(`receipts/${id}`).ocr.reconciliation;
  }

  test('zwei Seiten, keine Bestellnummer lesbar → genau eine Gutschrift (seite)', async () => {
    config({ doppelSumme: true, doppelOnlineSeite: true });
    seite('p1', S1);
    await verarbeiten('p1');
    seite('p2', S2);
    await verarbeiten('p2');
    expect(fake.store.get('receipts/p1')).toMatchObject({ status: 'approved' });
    expect(fake.store.get('receipts/p2')).toMatchObject({
      status: 'rejected', rejectReason: 'duplicate_content_self',
      duplicateOf: { receiptId: 'p1', sameUser: true, kind: 'seite' },
    });
    expect(earns()).toHaveLength(1);
  });

  test("gleiche Bestellnummer, Bestellnummer-Regel nur 'shadow' → die Seiten-Regel greift trotzdem", async () => {
    config({ doppelSumme: true, doppelBestellnummer: 'shadow', doppelOnlineSeite: true });
    seite('q1', S1, 'B-2026-778812');
    await verarbeiten('q1');
    seite('q2', S2, 'B-2026-778812');
    await verarbeiten('q2');
    expect(fake.store.get('receipts/q2')).toMatchObject({ status: 'rejected', duplicateOf: { kind: 'seite' } });
    expect(earns()).toHaveLength(1);
  });

  test('zwei Bestellungen mit verschiedenen Bestellnummern am selben Tag → beide bezahlt', async () => {
    config({ doppelSumme: true, doppelOnlineSeite: true });
    seite('r1', S1, 'B-2026-778812');
    await verarbeiten('r1');
    seite('r2', S2, 'B-2026-990011');
    await verarbeiten('r2');
    expect(earns()).toHaveLength(2);
  });

  test('Schalter ausdrücklich false → beide bezahlt, Merkmale stehen am Tageseintrag', async () => {
    config({ doppelSumme: true, doppelOnlineSeite: false });
    seite('t1', S1);
    await verarbeiten('t1');
    seite('t2', S2);
    await verarbeiten('t2');
    expect(earns()).toHaveLength(2);
    expect(fake.store.get(`users/${U1}/cashback_days/${GESTERN}`).eintraege.t1).toMatchObject({ online: true, ohneSumme: true });
  });

  test('Nachprüfung 05.10.: Schalter fehlt (Deploy-Stand) → Code-Default an, eine Gutschrift', async () => {
    // Die Artikelsumme der Seite ohne Endbetrag setzt lib/belegart.js ohne
    // Schalter ein — ohne Schutz zahlte schon der Deploy jede Seite einzeln.
    config({});
    seite('u1', S1);
    await verarbeiten('u1');
    seite('u2', S2);
    await verarbeiten('u2');
    expect(fake.store.get('receipts/u2')).toMatchObject({ status: 'rejected', duplicateOf: { receiptId: 'u1', kind: 'seite' } });
    expect(earns()).toHaveLength(1);
  });
});

describe('Prüfrunde 3: verlesenes oder geändertes Datum jenseits von 8 Tagen, geänderte Endsumme, anderer Markt', () => {
  const vorTagen = (n) => berlinDatum(Date.now() - n * TAG);
  const inTagen = (n) => berlinDatum(Date.now() + n * TAG);
  const ALLE = {
    doppelSumme: true, doppelKonten: true, doppelArtikel: true, doppelBestellnummer: true,
    doppelDatum: true, doppelKontenArtikel: true, doppelOnlineSeite: true, doppelKontenDatum: true,
  };

  test('echter Fall 02.10.: Netto 93,28 €, 10:44, ein Foto mit Datum +20 Tage gelesen und in der Prüfung, das andere bezahlt → Freigabe zahlt nicht (datum)', async () => {
    // Nur die Regeln derselben Person — der Fall hängt an doppelDatum, nicht an doppelKontenDatum.
    config({ doppelSumme: true, doppelArtikel: true, doppelDatum: true });
    const gelesen = ['Obstsalat', 'Kaffeeweisser', 'Chiasam', 'Alpensalz', 'Kaffeeschoko', 'Ganze Nuss', 'Linsen', 'Cafet Grande']
      .map((name, i) => ({ name, priceCents: 400 + i * 37, qty: 1 }));
    const verlesen = ['HSchwand', 'Kaffeeweisser 2', 'Noisette', 'Alpenmilch', 'Biscoff', 'Nuss 95', 'Luflee', 'Cafet 16']
      .map((name, i) => ({ name, priceCents: 410 + i * 37, qty: 1 }));
    bonAnlegen('n2', { markt: 'netto', zeit: '10:44', datum: GESTERN, items: gelesen, total: 9328 });
    await verarbeiten('n2');
    expect(fake.store.get('receipts/n2').status).toBe('approved');
    bonInPruefung('n1', { markt: 'netto', zeit: '10:44', datum: inTagen(19), items: verlesen, total: 9328 });
    const res = await freigeben('n1');
    expect(res.body).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_self', creditedCents: 0 });
    expect(fake.store.get('receipts/n1').duplicateOf).toMatchObject({ receiptId: 'n2', sameUser: true, kind: 'datum' });
    expect(fake.store.get('receipts/n1').doppelPruefung.treffer[0]).toMatchObject({ regel: 'datum', abstand: 20 });
    expect(earns()).toHaveLength(1);
  });

  test.each([[12], [20]])('gleiche Person, bezahltes Original vor %i Tagen, beschnittene Kopie mit Datum gestern → abgelehnt (datum)', async (n) => {
    config(ALLE);
    bonInPruefung('o1', { markt: 'kaufland', zeit: '11:05', datum: vorTagen(n + 1) });
    expect((await freigeben('o1')).body).toMatchObject({ status: 'approved' });
    bonAnlegen('o2', { markt: 'kaufland', zeit: '11:05', datum: GESTERN });
    await verarbeiten('o2');
    expect(fake.store.get('receipts/o2')).toMatchObject({
      status: 'rejected', rejectReason: 'duplicate_content_self',
      duplicateOf: { receiptId: 'o1', sameUser: true, kind: 'datum' },
    });
    expect(earns()).toHaveLength(1);
  });

  test('zweites Konto, bezahltes Original vor 20 Tagen, gleiche Artikel, Uhrzeit verdeckt → abgelehnt (kontenDatum)', async () => {
    config(ALLE);
    bonInPruefung('p1', { uid: U1, markt: 'kaufland', zeit: '11:05', datum: vorTagen(21) });
    await freigeben('p1');
    bonAnlegen('p2', { uid: U2, markt: 'kaufland', zeit: null, datum: GESTERN });
    await verarbeiten('p2', U2);
    expect(fake.store.get('receipts/p2')).toMatchObject({
      status: 'rejected', rejectReason: 'duplicate_content_cross_user',
      duplicateOf: { sameUser: false, kind: 'kontenDatum' },
    });
    expect(JSON.stringify(fake.store.get(`users/${U2}/cashback_status/p2`) || {})).not.toMatch(/p1/);
    expect(earns(U2)).toHaveLength(0);
  });

  test('zweites Konto, 12 Tage, zufällig gleiche Summe und Uhrzeit, andere Artikel → bezahlt (Zufall wie ALDI SÜD 16,31 €)', async () => {
    config(ALLE);
    bonInPruefung('z1', { uid: U1, markt: 'kaufland', zeit: '14:01', datum: vorTagen(13) });
    await freigeben('z1');
    const andere = ['Nudeln', 'Wein', 'Chips', 'Kaffee', 'Zucker', 'Mehl', 'Salz', 'Senf', 'Essig', 'Öl']
      .map((name, i) => ({ name, priceCents: 100 + i * 10, qty: 1 }));
    bonAnlegen('z2', { uid: U2, markt: 'kaufland', zeit: '14:01', datum: GESTERN, items: andere });
    await verarbeiten('z2', U2);
    expect(fake.store.get('receipts/z2').status).toBe('approved');
    expect(earns(U2)).toHaveLength(1);
  });

  test('gleiche Person, Datum −1 Tag, Uhrzeit verdeckt, Endsumme +0,10 € (Pfand-Toleranz) → abgelehnt (datum über die Artikelsumme)', async () => {
    config(ALLE);
    bonAnlegen('s1', { markt: 'kaufland', zeit: '11:05', datum: GESTERN });
    await verarbeiten('s1');
    bonAnlegen('s2', { markt: 'kaufland', zeit: null, datum: VORGESTERN, total: summe(ZEHN) + 10 });
    fake.store.get('receipts/s2').ocr.reconciliation = { ok: true, sumItemsCents: summe(ZEHN), deltaCents: 10, signedDeltaCents: 10, direction: 'undershoot' };
    await verarbeiten('s2');
    expect(fake.store.get('receipts/s2')).toMatchObject({ status: 'rejected', duplicateOf: { receiptId: 's1', kind: 'datum' } });
    expect(fake.store.get('receipts/s2').doppelPruefung.treffer[0]).toMatchObject({ nurArtikelSumme: true, ohneUhrzeit: true });
    expect(earns()).toHaveLength(1);
  });

  test('gleiche Person, Händlername im Kopf geändert (Kaufland → Netto), sonst gleich → abgelehnt (andererMarkt)', async () => {
    config(ALLE);
    bonAnlegen('h1', { markt: 'kaufland', zeit: '11:05', datum: GESTERN });
    await verarbeiten('h1');
    bonAnlegen('h2', { markt: 'netto', zeit: '11:05', datum: GESTERN });
    await verarbeiten('h2');
    expect(fake.store.get('receipts/h2')).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_self', duplicateOf: { receiptId: 'h1' } });
    expect(fake.store.get('receipts/h2').doppelPruefung.treffer.every((t) => t.andererMarkt === true)).toBe(true);
    expect(earns()).toHaveLength(1);
  });

  test("Tages-Index nur mit laufender Regel: 'shadow' trägt ein, aus trägt nichts ein", async () => {
    config({ doppelSumme: true, doppelKontenArtikel: 'shadow' });
    bonAnlegen('t1', { markt: 'kaufland', zeit: '11:05' });
    await verarbeiten('t1');
    const index = fake.store.get(`cashback_bon_tage/kaufland_${GESTERN}`);
    expect(index.eintraege.t1).toMatchObject({ u: U1, a: expect.arrayContaining([expect.stringMatching(/^[0-9a-f]{8}$/)]) });
    expect(JSON.stringify(index)).not.toMatch(/Milch/);
    config({ doppelSumme: true });
    bonAnlegen('t2', { uid: U2, markt: 'kaufland', zeit: '12:00', items: ZEHN.slice(0, 8) });
    await verarbeiten('t2', U2);
    expect(fake.store.get(`cashback_bon_tage/kaufland_${GESTERN}`).eintraege.t2).toBeUndefined();
  });
});
