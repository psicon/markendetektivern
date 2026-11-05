'use strict';

/**
 * Nachprüfung 05.10.2026 zum Doppel-Schutz (claude/bon-doppelzahlung). Jeder
 * Befund wurde vorher mit dem ECHTEN index.js gegen die Firestore-Attrappe
 * nachgestellt (scratchpad/gbr1, scratchpad/betr1-kopie); hier dieselben
 * Angriffe mit dem erwarteten Ergebnis nach dem Fix.
 *
 *   1  Bestandsschutz auch für den Betrag: eine erneute Zustellung rechnet ohne
 *      Deckel und darf weder nach oben (Kopf-Deckel, Budget) noch nach unten
 *      (Teil-Storno) korrigieren.
 *   2  Personen-Index: dieselbe Person, Datum ≥ 9 Tage verschoben UND Endsumme
 *      oder Händlername geändert — die Regel datum greift trotzdem.
 *   3  Bestand vor dem Deploy: `.backfill-doppel-person.js` trägt nach,
 *      `bildFeinvergleich` wartet auf `doppelBestandIndexiert`.
 *   5  Fremde clientUploadId überschreibt nie einen Bon.
 *   6  Regel seite auch an einem anderen Tag im Fenster.
 *   7  App-Kassenbon ohne sichtbare Summe: Artikelsumme wie unter v1.4,
 *      Pflicht nur mit `appSummePflicht: true`.
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
      return { publishMessage: async (m) => { global.__published.push(m); return 'msg'; } };
    }
  },
}));
jest.mock('../lib/push', () => ({ sendCashbackReady: async (uid, info) => { global.__pushes.push({ uid, info }); } }));

const sharp = require('sharp');
const admin = require('firebase-admin');
const fn = require('../index');
const D = require('../lib/doppelBon');
const { computeDHash } = require('../lib/forensics');
const { nachtragen } = require('../.backfill-doppel-person');

const fake = admin.__fake;
const db = admin.firestore();
const A = 'kontoA';
const B = 'kontoB';
const TAG = 24 * 60 * 60 * 1000;
const SCHLUESSEL = 'admin-key';
const berlinDatum = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
const HEUTE = berlinDatum(Date.now());
const GESTERN = berlinDatum(Date.now() - TAG);
const vorTagen = (n) => berlinDatum(Date.now() - n * TAG);

const ZEHN = ['Milch', 'Brot', 'Butter', 'Käse', 'Eier', 'Apfel', 'Birne', 'Saft', 'Tee', 'Reis']
  .map((name, i) => ({ name, priceCents: 100 + i * 10, qty: 1 }));
const summe = (items) => items.reduce((s, it) => s + it.priceCents, 0);
const MAERKTE = { netto: 'Netto Marken-Discount', kaufland: 'Kaufland', dm: 'dm-drogerie markt', lidl: 'Lidl' };

const ALLE = {
  doppelSumme: true, doppelKonten: true, doppelArtikel: true, doppelBestellnummer: true,
  doppelDatum: true, doppelKontenArtikel: true, doppelOnlineSeite: true, doppelKontenDatum: true,
};

function config(extra = {}) {
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, payoutThresholdCents: 1000, consentVersion: 'v1.0-2026-05', ...extra });
}

function ocrVon({ markt = 'kaufland', items = ZEHN, total = summe(items), zeit = '11:05', datum = GESTERN, parsed = {} } = {}) {
  const delta = total == null ? null : total - summe(items);
  return {
    engine: 'gemini-robust', model: 'test', promptVersion: 'test',
    parsed: { isReceipt: true, merchant: MAERKTE[markt], bonCountry: 'DE', bonDate: datum, bonTime: zeit, totalCents: total, items, ...parsed },
    robust: { confidence: 'high', attempts: 2 },
    ...(delta == null ? {} : { reconciliation: { ok: true, sumItemsCents: summe(items), deltaCents: Math.abs(delta), signedDeltaCents: delta, direction: delta === 0 ? 'exact' : 'undershoot' } }),
  };
}

/** Bon mit gespeicherter Lesung (der Lauf ruft kein Modell). */
function bonAnlegen(id, { uid = A, capture = {}, hochgeladenVorTagen = 0, ...rest } = {}) {
  fake.store.set(`receipts/${id}`, {
    userId: uid,
    status: 'ocr_pending',
    campaignId: 'c1',
    createdAt: fake.zeit(Date.now() - hochgeladenVorTagen * TAG - 60 * 60 * 1000),
    storage: { bucket: 'b', path: `cashback-uploads/${uid}/${id}.jpg` },
    capture,
    ocr: ocrVon(rest),
  });
}

/** Bon in der Prüfung (eine Freigabe über den Resolver bezahlt ihn, auch alt). */
function bonInPruefung(id, { uid = A, markt = 'kaufland', items = ZEHN, total = summe(items), zeit = '11:05', datum = GESTERN } = {}) {
  fake.store.set(`receipts/${id}`, {
    userId: uid, status: 'review', reviewReason: 'ocr_confidence_low', cashbackCents: 8,
    bonDate: datum, bonTime: zeit, bonTotalCents: total, campaignId: 'c1', campaignIdAngewandt: 'c1',
    merchant: { id: markt, name: MAERKTE[markt], land: 'DE' },
    ocr: { parsed: { bonDate: datum, bonTime: zeit, totalCents: total, items } },
  });
}

const verarbeiten = (id, uid = A) =>
  fn.processCashback({ id: `ev-${id}-${Math.random()}`, data: { message: { json: { cashbackId: id, uid } } } });

async function erneutZustellen(id, uid = A) {
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

async function entscheiden(id, decision = 'approve') {
  const res = antwort();
  await fn.resolveCashbackReview(
    { get: (h) => (h === 'x-admin-key' ? SCHLUESSEL : undefined), query: { receiptId: id, decision } },
    res,
  );
  return res;
}

async function hochladen({ tok, uid, bild, bytesHash, clientUploadId }) {
  const pfad = `cashback-uploads/${uid}/${clientUploadId}-${Math.random().toString(36).slice(2)}.jpg`;
  fake.dateien.set(pfad, bild);
  const res = antwort();
  await fn.enqueueCashback({
    method: 'POST',
    headers: { authorization: `Bearer ${tok}` },
    body: { storagePath: pfad, bytesHash, clientUploadId, campaignId: 'c1' },
  }, res);
  return { res, pfad };
}

const ledger = (uid = A) =>
  [...fake.store.entries()].filter(([k]) => k.startsWith(`users/${uid}/cashback_ledger/`)).map(([, v]) => v);
const earns = (uid = A) => ledger(uid).filter((l) => l.type === 'earn');
const stornos = (uid = A) => ledger(uid).filter((l) => l.type === 'reverse');
const log = (name) => global.__logs.filter((l) => l[0] === name).map((l) => l[1]);
const person = (uid = A) => (fake.store.get(`cashback_bon_person/${uid}`) || {}).eintraege || {};

/** Was der alte Code (vor dem Deploy) nicht schrieb, entfernen: Bestand. */
function zumBestandMachen(uid = A) {
  for (const k of [...fake.store.keys()]) if (k.startsWith('cashback_bon_')) fake.store.delete(k);
  for (const [k, v] of fake.store.entries()) {
    if (k.startsWith(`users/${uid}/cashback_days/`)) delete v.eintraege;
    if (k.startsWith(`users/${uid}/cashback_ledger/`)) { delete v.schluessel; delete v.summenIndex; delete v.tagesIndex; }
  }
}

function bonSvg({ saat = 1 } = {}) {
  let r = saat;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const teile = [];
  for (let i = 0; i < 50; i++) {
    teile.push(`<rect x="40" y="${60 + i * 28}" width="${80 + Math.floor(rnd() * 300)}" height="14" fill="#222"/>`);
    teile.push(`<rect x="760" y="${60 + i * 28}" width="${60 + Math.floor(rnd() * 40)}" height="14" fill="#222"/>`);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600"><rect width="100%" height="100%" fill="#f4f2ec"/>${teile.join('')}</svg>`);
}

let BILD;
let JUNK;
beforeAll(async () => {
  BILD = await sharp(bonSvg()).jpeg({ quality: 92 }).toBuffer();
  JUNK = await sharp(bonSvg({ saat: 9 })).jpeg({ quality: 92 }).toBuffer();
});

beforeEach(() => {
  fake.zuruecksetzen();
  global.__logs = [];
  global.__pushes = [];
  global.__published = [];
  global.__secrets = { NUTRITION_SCRAPER_TRIGGER_KEY: SCHLUESSEL };
  fake.tokens.set('tokA', A);
  fake.tokens.set('tokB', B);
  config();
  const jetzt = Date.now();
  fake.store.set('cashback_campaigns/c1', {
    kind: 'receipt', active: true,
    startAt: fake.zeit(jetzt - 120 * TAG), endAt: fake.zeit(jetzt + 10 * TAG),
    cashbackPerBonCents: 8, budgetRemainingCents: 5000,
  });
  for (const [id, name] of Object.entries(MAERKTE)) fake.store.set(`discounter/${id}`, { name, land: 'DE' });
  const consent = { cashback_consent: { accepted: true, version: 'v1.0-2026-05' } };
  fake.store.set(`users/${A}`, { cashback_balance_cents: 0, cashback_lifetime_cents: 0, ...consent });
  fake.store.set(`users/${B}`, { cashback_balance_cents: 0, cashback_lifetime_cents: 0, ...consent });
});

// ─── 1 ────────────────────────────────────────────────────────────────────
describe('1 — Bestandsschutz auch für den Betrag', () => {
  test('Kopf-Deckel 5 ct, Prämie 8 ct: erneute Zustellung bucht NICHT die restlichen 3 ct nach', async () => {
    fake.store.set('cashback_campaigns/c1', { ...fake.store.get('cashback_campaigns/c1'), maxPerUserCents: 5 });
    bonAnlegen('bon_a', { datum: GESTERN });
    await verarbeiten('bon_a');
    expect(earns()).toEqual([expect.objectContaining({ cents: 5 })]);

    await erneutZustellen('bon_a');

    expect(earns()).toHaveLength(1);
    expect(stornos()).toHaveLength(0);
    expect(fake.store.get(`users/${A}`)).toMatchObject({
      cashback_balance_cents: 5,
      cashback_campaign_totals: { c1: 5 },
    });
    expect(fake.store.get('cashback_campaigns/c1').budgetRemainingCents).toBe(4995);
    expect(fake.store.get('receipts/bon_a')).toMatchObject({ status: 'approved', cashbackCents: 5 });
    expect(fake.store.get(`users/${A}/cashback_status/bon_a`)).toMatchObject({ status: 'approved', cashbackCents: 5 });
    expect(log('bestandsschutz-betrag')).toEqual([{ cashbackId: 'bon_a', gutgeschriebenCents: 5, waereCents: 8 }]);
    expect(global.__pushes).toHaveLength(1);
  });

  test('Budget-Rest 5 ct: erneute Zustellung treibt das Budget nicht unter 0', async () => {
    fake.store.set('cashback_campaigns/c1', { ...fake.store.get('cashback_campaigns/c1'), budgetRemainingCents: 5 });
    bonAnlegen('bon_a', { datum: GESTERN });
    await verarbeiten('bon_a');
    await erneutZustellen('bon_a');
    expect(ledger().map((l) => [l.type, l.cents])).toEqual([['earn', 5]]);
    expect(fake.store.get('cashback_campaigns/c1').budgetRemainingCents).toBe(0);
  });

  test('Aktion senkt die Prämie nach der Gutschrift (8 → 5 ct): kein Teil-Storno durch einen automatischen Lauf', async () => {
    bonAnlegen('bon_a', { datum: GESTERN });
    await verarbeiten('bon_a');
    fake.store.set('cashback_campaigns/c1', { ...fake.store.get('cashback_campaigns/c1'), cashbackPerBonCents: 5 });
    await erneutZustellen('bon_a');
    expect(stornos()).toHaveLength(0);
    expect(fake.store.get(`users/${A}`).cashback_balance_cents).toBe(8);
    expect(fake.store.get('receipts/bon_a')).toMatchObject({ status: 'approved', cashbackCents: 8 });
  });

  test('ohne Abweichung: keine Meldung, nichts geschrieben', async () => {
    bonAnlegen('bon_a', { datum: GESTERN });
    await verarbeiten('bon_a');
    await erneutZustellen('bon_a');
    expect(ledger()).toHaveLength(1);
    expect(log('bestandsschutz-betrag')).toHaveLength(0);
  });
});

// ─── 2 ────────────────────────────────────────────────────────────────────
describe('2 — Personen-Index: dieselbe Person, Datum ≥ 9 Tage verschoben', () => {
  test('jede Gutschrift trägt sich ein — auch mit allen Schaltern aus', async () => {
    bonAnlegen('bon_a', { datum: GESTERN });
    await verarbeiten('bon_a');
    const e = person();
    expect(Object.keys(e)).toEqual(['bon_a']);
    expect(e.bon_a.l).toEqual([expect.objectContaining({ t: GESTERN, m: 'kaufland', z: '11:05', s: summe(ZEHN), as: summe(ZEHN) })]);
    expect(e.bon_a.l[0].a).toHaveLength(10);
    // keine Artikelnamen im Index
    expect(JSON.stringify(e)).not.toMatch(/Milch|Brot/);
  });

  test.each([
    ['Endsumme +1 ct, gleiche Uhrzeit (Kopie über den Resolver bezahlt)', { total: summe(ZEHN) + 1 }],
    ['Endsumme +10 ct, gleiche Uhrzeit', { total: summe(ZEHN) + 10 }],
    ['Händlername geändert (Kaufland → Netto), gleiche Uhrzeit', { markt: 'netto' }],
    ['Endsumme +1 ct UND Uhrzeit verdeckt (Artikelsumme gleich)', { total: summe(ZEHN) + 1, zeit: null }],
    ['Händlername UND Uhrzeit geändert', { markt: 'netto', zeit: '17:42' }],
  ])('%s → abgelehnt, eine Gutschrift', async (_t, kopie) => {
    config(ALLE);
    bonInPruefung('o1', { datum: vorTagen(13) });
    expect((await entscheiden('o1')).body).toMatchObject({ status: 'approved' });
    bonAnlegen('o2', { datum: GESTERN, ...kopie });
    await verarbeiten('o2');
    expect(fake.store.get('receipts/o2')).toMatchObject({
      status: 'rejected',
      rejectReason: 'duplicate_content_self',
      duplicateOf: expect.objectContaining({ receiptId: 'o1', kind: 'datum' }),
    });
    expect(earns()).toHaveLength(1);
    expect(fake.store.get('receipts/o2').doppelPruefung.treffer).toEqual(expect.arrayContaining([
      expect.objectContaining({ regel: 'datum', gegen: 'o1', quelle: 'person', abstand: 12 }),
    ]));
  });

  test('gezeigte Prüfrunde-Fälle: Original über die Pipeline bezahlt, +10 Tage, Kaufland → Netto', async () => {
    config(ALLE);
    bonAnlegen('bon_a', { markt: 'kaufland', datum: vorTagen(12), hochgeladenVorTagen: 11 });
    await verarbeiten('bon_a');
    bonAnlegen('bon_b', { markt: 'netto', datum: vorTagen(2) });
    await verarbeiten('bon_b');
    expect(fake.store.get('receipts/bon_a').status).toBe('approved');
    expect(fake.store.get('receipts/bon_b').status).toBe('rejected');
    expect(earns()).toHaveLength(1);
  });

  test("'shadow': bezahlt, Treffer vermerkt", async () => {
    config({ ...ALLE, doppelDatum: 'shadow' });
    bonInPruefung('o1', { datum: vorTagen(13) });
    await entscheiden('o1');
    bonAnlegen('o2', { datum: GESTERN, markt: 'netto' });
    await verarbeiten('o2');
    expect(fake.store.get('receipts/o2').status).toBe('approved');
    expect(fake.store.get('receipts/o2').doppelPruefung.treffer).toEqual([
      expect.objectContaining({ regel: 'datum', quelle: 'person', modus: 'beobachtung', andererMarkt: true }),
    ]);
    expect(earns()).toHaveLength(2);
  });

  test('echter Zweitkauf (anderer Warenkorb, andere Uhrzeit und Summe, 12 Tage) → bezahlt', async () => {
    config(ALLE);
    bonInPruefung('o1', { datum: vorTagen(13) });
    await entscheiden('o1');
    // 6 von 10 gleiche Artikel (Gewohnheitskauf), aber andere Uhrzeit und Summe.
    const zweit = [...ZEHN.slice(0, 6), ...['Nudeln', 'Mehl', 'Zucker', 'Salz'].map((name, i) => ({ name, priceCents: 300 + i, qty: 1 }))];
    bonAnlegen('o2', { datum: GESTERN, items: zweit, zeit: '18:20' });
    await verarbeiten('o2');
    expect(fake.store.get('receipts/o2').status).toBe('approved');
    expect(earns()).toHaveLength(2);
  });

  test('Datum > 95 Tage daneben → kein Treffer (Aufbewahrung)', async () => {
    config(ALLE);
    // Eintrag 100 Tage alt (von Hand gesetzt, die Aktion lief damals).
    fake.store.set(`cashback_bon_person/${A}`, {
      eintraege: { alt: { l: [D.personLesungAus(D.identitaet({ merchantId: 'kaufland', bonDate: vorTagen(100), totalCents: summe(ZEHN), bonTime: '11:05', items: ZEHN }))] } },
    });
    fake.store.set(`users/${A}/cashback_ledger/earn-alt`, { type: 'earn', cents: 8, receiptId: 'alt', campaignId: 'c1', bonDate: vorTagen(100) });
    bonAnlegen('neu', { datum: GESTERN });
    await verarbeiten('neu');
    expect(fake.store.get('receipts/neu').status).toBe('approved');
    // … und der abgelaufene Eintrag ist weggeräumt.
    expect(Object.keys(person())).toEqual(['neu']);
  });

  test('ein Eintrag zählt nur, solange das Ledger den Bon als bezahlt führt; Storno durch einen Menschen räumt ihn', async () => {
    config(ALLE);
    bonInPruefung('o1', { datum: vorTagen(13) });
    await entscheiden('o1');
    expect(Object.keys(person())).toEqual(['o1']);
    // Ein Mensch storniert die Gutschrift.
    fake.store.set('receipts/o1', { ...fake.store.get('receipts/o1'), status: 'review' });
    expect((await entscheiden('o1', 'reject')).code).toBe(200);
    expect(stornos()).toHaveLength(1);
    expect(person()).toEqual({});
    // Danach ist dieselbe Lesung frei.
    bonAnlegen('o2', { datum: GESTERN, markt: 'netto' });
    await verarbeiten('o2');
    expect(fake.store.get('receipts/o2').status).toBe('approved');
  });

  test('erneute Zustellung mit anderer Datumslesung ERGÄNZT den Eintrag (der Bon sperrt unter beiden)', async () => {
    bonAnlegen('bon_a', { datum: vorTagen(3) });
    await verarbeiten('bon_a');
    const r = fake.store.get('receipts/bon_a');
    fake.store.set('receipts/bon_a', { ...r, ocr: ocrVon({ datum: vorTagen(2) }) });
    await erneutZustellen('bon_a');
    expect(person().bon_a.l.map((x) => x.t)).toEqual([vorTagen(3), vorTagen(2)]);
  });
});

describe('2 — Personen-Index, reine Regeln', () => {
  const id = (o) => D.identitaet({ merchantId: 'kaufland', bonDate: GESTERN, totalCents: summe(ZEHN), bonTime: '11:05', items: ZEHN, ...o });
  const eintrag = (o) => ({ l: [D.personLesungAus(id(o))] });
  const modi = D.doppelModi({ doppelDatum: true });

  test('Bedingung wie im Fenster des Tageszählers', () => {
    const neu = id({});
    const k = (o) => D.personKandidaten({ bonId: 'n', neu, eintraege: { a: eintrag(o) }, modi });
    expect(k({ bonDate: vorTagen(20) })).toEqual([expect.objectContaining({ id: 'a', abstand: 19, gleicheZeit: true, anteil: 1 })]);
    // gleiche Uhrzeit + gleiche Summe genügt ohne Artikel (Netto 02.10.: Namen verlesen)
    expect(k({ bonDate: vorTagen(20), items: ZEHN.map((x) => ({ ...x, name: x.name + 'x' })) })).toHaveLength(1);
    // ohne gleiche Uhrzeit: Summe bzw. Artikelsumme UND Artikel
    expect(k({ bonDate: vorTagen(20), bonTime: '09:00' })).toHaveLength(1);
    expect(k({ bonDate: vorTagen(20), bonTime: '09:00', totalCents: summe(ZEHN) + 300, items: [...ZEHN.slice(0, 9), { name: 'Wein', priceCents: 499 }] })).toHaveLength(0);
    // gleicher Tag → nicht diese Regel; > 95 Tage → nicht mehr
    expect(k({})).toHaveLength(0);
    expect(k({ bonDate: vorTagen(97) })).toHaveLength(0);
    // eigener Bon nie
    expect(D.personKandidaten({ bonId: 'a', neu, eintraege: { a: eintrag({ bonDate: vorTagen(20) }) }, modi })).toHaveLength(0);
  });

  test('Artikel ≥ 0,6 und Endsumme ±2 € allein reichen NICHT (echter REWE-Zweitkauf in der Messung)', () => {
    const neu = id({ bonTime: '19:35', totalCents: 688 });
    const alt = eintrag({ bonDate: vorTagen(2), bonTime: '19:45', totalCents: 603, items: [...ZEHN.slice(0, 7), { name: 'Saft2', priceCents: 95 }, { name: 'Joghurt', priceCents: 98 }] });
    expect(D.personKandidaten({ bonId: 'n', neu, eintraege: { a: alt }, modi })).toHaveLength(0);
  });

  test('personEintragWert ergänzt, ersetzt nie, höchstens zwei Lesungen', () => {
    const l1 = D.personLesungAus(id({ bonDate: vorTagen(3) }));
    const l2 = D.personLesungAus(id({ bonDate: vorTagen(2) }));
    const l3 = D.personLesungAus(id({ bonDate: vorTagen(1) }));
    expect(D.personEintragWert(undefined, l1)).toEqual({ l: [l1] });
    expect(D.personEintragWert({ l: [l1] }, l1)).toBeNull();
    expect(D.personEintragWert({ l: [l1] }, l2)).toEqual({ l: [l1, l2] });
    expect(D.personEintragWert({ l: [l1, l2] }, l3)).toEqual({ l: [l1, l3] });
    expect(D.personEintragWert({ l: [l1] }, null)).toBeNull();
  });

  test('personAufraeumen: abgelaufen weg, bei vollem Dokument die ältesten', () => {
    const e = {};
    for (let i = 0; i < D.MAX_PERSON_EINTRAEGE; i++) e[`b${i}`] = { l: [{ t: vorTagen(1 + (i % 90)) }] };
    e.uralt = { l: [{ t: vorTagen(120) }] };
    const weg = D.personAufraeumen(e, HEUTE, 'neu');
    expect(weg).toContain('uralt');
    // 300 gültige + neu → einer der ältesten (89/90 Tage) muss weichen
    expect(weg).toHaveLength(2);
    const zweiter = weg.find((x) => x !== 'uralt');
    expect(e[zweiter].l[0].t).toBe(vorTagen(90));
    expect(D.personAufraeumen({ a: { l: [{ t: GESTERN }] } }, HEUTE, 'a')).toEqual([]);
  });

  test('80 Artikel-Hashes je Lesung — die Dokumentgröße bleibt begrenzt', () => {
    const viele = Array.from({ length: 140 }, (_, i) => ({ name: `Artikel${i}`, priceCents: 100 + i }));
    expect(D.personLesungAus(id({ items: viele })).a).toHaveLength(D.MAX_PERSON_ARTIKEL);
  });
});

// ─── 3 ────────────────────────────────────────────────────────────────────
describe('3 — Bestand vor dem Deploy', () => {
  async function bestandOriginal() {
    // Original vor 13 Tagen, gebucht mit dem alten Code: kein Eintrag, kein Index.
    bonInPruefung('b1', { datum: vorTagen(13) });
    await entscheiden('b1');
    zumBestandMachen();
    fake.store.set(`users/${A}`, { ...fake.store.get(`users/${A}`), cashback_lifetime_cents: 8 });
    expect(person()).toEqual({});
  }

  test('ohne Nachtrag: die Kopie mit geändertem Datum wird bezahlt (darum wartet bildFeinvergleich)', async () => {
    await bestandOriginal();
    config(ALLE);
    bonAnlegen('b2', { datum: GESTERN });
    await verarbeiten('b2');
    expect(fake.store.get('receipts/b2').status).toBe('approved');
    expect(earns()).toHaveLength(2);
  });

  test('nach dem Nachtrag: dieselbe Kopie wird abgelehnt; VERIFY grün, SCHALTER setzt doppelBestandIndexiert', async () => {
    await bestandOriginal();
    const still = () => {};
    const trocken = await nachtragen({ db, FV: admin.firestore.FieldValue, tag: HEUTE, log: still });
    expect(trocken.st).toMatchObject({ personen: 1, imFenster: 1, nachgetragen: 1 });
    expect(person()).toEqual({});

    const rot = await nachtragen({ db, FV: admin.firestore.FieldValue, VERIFY: true, SCHALTER: true, tag: HEUTE, log: still });
    expect(rot).toMatchObject({ gruen: false, st: expect.objectContaining({ fehlend: 1 }) });
    expect(fake.store.get('cashback_config/v1').doppelBestandIndexiert).toBeUndefined();

    await nachtragen({ db, FV: admin.firestore.FieldValue, SCHREIBEN: true, tag: HEUTE, log: still });
    expect(Object.keys(person())).toEqual(['b1']);
    const gruen = await nachtragen({ db, FV: admin.firestore.FieldValue, VERIFY: true, SCHALTER: true, tag: HEUTE, log: still });
    expect(gruen.gruen).toBe(true);
    expect(fake.store.get('cashback_config/v1')).toMatchObject({ doppelBestandIndexiert: true });

    config(ALLE);
    bonAnlegen('b2', { datum: GESTERN });
    await verarbeiten('b2');
    expect(fake.store.get('receipts/b2')).toMatchObject({ status: 'rejected', duplicateOf: expect.objectContaining({ receiptId: 'b1', kind: 'datum' }) });
    expect(earns()).toHaveLength(1);
  });

  test('Nachtrag: stornierte Bons, Bons außerhalb von 95 Tagen und fremde Dokumente werden nicht eingetragen; idempotent', async () => {
    const still = () => {};
    const anlegen = (id, datum, { cents = 8, uid = A } = {}) => {
      fake.store.set(`receipts/${id}`, {
        userId: uid, status: 'approved', bonDate: datum, bonTime: '10:00', bonTotalCents: summe(ZEHN),
        merchant: { id: 'kaufland', name: 'Kaufland', land: 'DE' }, ocr: { parsed: { bonDate: datum, bonTime: '10:00', totalCents: summe(ZEHN), items: ZEHN } },
      });
      fake.store.set(`users/${A}/cashback_ledger/earn-${id}`, { type: 'earn', cents, receiptId: id, campaignId: 'c1', bonDate: datum });
    };
    fake.store.set(`users/${A}`, { ...fake.store.get(`users/${A}`), cashback_lifetime_cents: 40 });
    anlegen('aktiv', vorTagen(20));
    anlegen('storniert', vorTagen(21));
    fake.store.set(`users/${A}/cashback_ledger/rev-storniert`, { type: 'reverse', cents: 8, receiptId: 'storniert' });
    anlegen('uralt', vorTagen(120));
    anlegen('ueberschrieben', vorTagen(22), { uid: B });
    const r1 = await nachtragen({ db, FV: admin.firestore.FieldValue, SCHREIBEN: true, tag: HEUTE, log: still });
    expect(Object.keys(person())).toEqual(['aktiv']);
    expect(r1.st).toMatchObject({ bezahlt: 3, imFenster: 1, nachgetragen: 1, fremd: 1 });
    expect(r1.beispiele.fremd).toEqual(['ueberschrieben']);
    const r2 = await nachtragen({ db, FV: admin.firestore.FieldValue, SCHREIBEN: true, tag: HEUTE, log: still });
    expect(r2.st).toMatchObject({ nachgetragen: 0, schonDa: 1 });
    expect((await nachtragen({ db, FV: admin.firestore.FieldValue, VERIFY: true, tag: HEUTE, log: still })).gruen).toBe(true);
  });
});

// ─── 5 ────────────────────────────────────────────────────────────────────
describe('5 — fremde clientUploadId', () => {
  async function bezahltesOriginal() {
    const dhash = await computeDHash(BILD);
    bonAnlegen('bon_a1', { capture: { hash: 'hashX', perceptualHashServer: dhash } });
    fake.dateien.set(`cashback-uploads/${A}/bon_a1.jpg`, BILD);
    await verarbeiten('bon_a1');
    expect(fake.store.get('receipts/bon_a1').status).toBe('approved');
  }

  test.each([['alle Schalter aus', {}], ['alle Schalter scharf', ALLE]])(
    'Konto B schickt die ID des bezahlten Bons von A → 409, A`s Bon bleibt; A`s zweite Einreichung derselben Datei bleibt gesperrt (%s)',
    async (_t, schalter) => {
      config(schalter);
      await bezahltesOriginal();
      const vorher = JSON.stringify(fake.store.get('receipts/bon_a1'));
      const { res: rb } = await hochladen({ tok: 'tokB', uid: B, bild: JUNK, bytesHash: 'hashJunk', clientUploadId: 'bon_a1' });
      expect(rb.code).toBe(409);
      expect(rb.body).toEqual({ code: 'invalid_upload_id' });
      expect(JSON.stringify(fake.store.get('receipts/bon_a1'))).toBe(vorher);
      expect(global.__published).toHaveLength(0);
      const { res: ra } = await hochladen({ tok: 'tokA', uid: A, bild: BILD, bytesHash: 'hashX', clientUploadId: 'bon_a2' });
      expect(ra.body).toMatchObject({ cashbackId: 'bon_a1', duplicate: true, duplicateMode: 'exact' });
      expect(fake.store.get('receipts/bon_a2')).toBeUndefined();
      expect(earns()).toHaveLength(1);
    },
  );

  test('Wettlauf: der Bon entsteht zwischen Vorabprüfung und Anlegen — create() überschreibt nie', async () => {
    config();
    const fremd = { userId: B, status: 'approved', capture: { hash: 'h' } };
    const original = fake.dateien.get.bind(fake.dateien);
    let eingespielt = false;
    fake.dateien.get = (k) => {
      if (!eingespielt && k.includes('/neu-')) { eingespielt = true; fake.store.set('receipts/neu', fremd); }
      return original(k);
    };
    try {
      const { res } = await hochladen({ tok: 'tokA', uid: A, bild: BILD, bytesHash: 'hashY', clientUploadId: 'neu' });
      expect(eingespielt).toBe(true);
      expect(res.code).toBe(409);
      expect(fake.store.get('receipts/neu')).toEqual(fremd);
      expect(global.__published).toHaveLength(0);
    } finally {
      fake.dateien.get = original;
    }
  });

  test('Wettlauf derselben Person (die App wiederholt, der erste Aufruf läuft noch) → derselbe Bon zurück, nichts doppelt', async () => {
    config();
    const original = fake.dateien.get.bind(fake.dateien);
    let eingespielt = false;
    fake.dateien.get = (k) => {
      if (!eingespielt && k.includes('/neu-')) { eingespielt = true; fake.store.set('receipts/neu', { userId: A, status: 'ocr_pending' }); }
      return original(k);
    };
    try {
      const { res } = await hochladen({ tok: 'tokA', uid: A, bild: BILD, bytesHash: 'hashY', clientUploadId: 'neu' });
      expect(res.body).toEqual({ cashbackId: 'neu', status: 'ocr_pending' });
      expect(global.__published).toHaveLength(0);
    } finally {
      fake.dateien.get = original;
    }
  });

  test('Altfall: unter der eigenen Gutschrift liegt ein fremdes Dokument → nicht verglichen, gemeldet', async () => {
    config(ALLE);
    // A's bezahlter Bestands-Bon wurde (vor dem Fix) von B überschrieben.
    fake.store.set('receipts/ueber', { userId: B, status: 'ocr_pending', bonDate: GESTERN, ocr: { parsed: { bonDate: GESTERN, items: ZEHN, totalCents: summe(ZEHN), bonTime: '11:05' } }, merchant: { id: 'kaufland' } });
    fake.store.set(`users/${A}/cashback_ledger/earn-ueber`, { type: 'earn', cents: 8, receiptId: 'ueber', campaignId: 'c1', bonDate: GESTERN });
    fake.store.set(`users/${A}/cashback_days/${GESTERN}`, { bonDate: GESTERN, receiptIds: ['ueber'] });
    bonAnlegen('neu', { datum: GESTERN, items: ZEHN.map((x) => ({ ...x, name: `${x.name}2` })), zeit: '15:00', total: summe(ZEHN) + 100 });
    await verarbeiten('neu');
    expect(log('doppel-bestand-fremder-bon')).toEqual([expect.objectContaining({ cashbackId: 'neu', bestand: 'ueber' })]);
  });
});

// ─── 6 ────────────────────────────────────────────────────────────────────
describe('6 — Regel seite an einem anderen Tag', () => {
  const S1 = ['Cremedusche', 'Koerperlotion', 'Babypuder', 'Feuchttuecher', 'Shampoo', 'Deo Roll-on', 'Windeln Gr4']
    .map((name, i) => ({ name, priceCents: 55 + i * 100, qty: 1 }));
  const S2 = ['Bad Shampoo', 'Schubladensicherung', 'Schrankschloss', 'Steckdosenschutz', 'Eckenschutz', 'Multisicherung', 'Duschgel', 'Entkalker']
    .map((name, i) => ({ name, priceCents: 125 + i * 30, qty: 1 }));
  function seite(id, items, datum, { nummer = null, mitSumme = false, hochgeladenVorTagen = 0 } = {}) {
    bonAnlegen(id, { markt: 'dm', zeit: null, items, datum, hochgeladenVorTagen, total: mitSumme ? summe(items) : null, parsed: { belegart: 'online_bestellung', bestellnummer: nummer } });
  }

  test('Seite 2 mit Datum −1 Tag → eine Gutschrift', async () => {
    config(ALLE);
    seite('p1', S1, GESTERN); await verarbeiten('p1');
    seite('p2', S2, vorTagen(2)); await verarbeiten('p2');
    expect(fake.store.get('receipts/p1').status).toBe('approved');
    expect(fake.store.get('receipts/p2')).toMatchObject({ status: 'rejected', duplicateOf: expect.objectContaining({ receiptId: 'p1', kind: 'seite' }) });
    expect(earns()).toHaveLength(1);
  });

  test('Kontrolle: zwei Bestellungen mit verschiedenen Bestellnummern an zwei Tagen → beide bezahlt', async () => {
    config(ALLE);
    seite('p1', S1, vorTagen(3), { nummer: 'DM-2026-48151623' }); await verarbeiten('p1');
    seite('p2', S2, GESTERN, { nummer: 'DM-2026-99887766' }); await verarbeiten('p2');
    expect(earns()).toHaveLength(2);
  });

  test('Kontrolle: zwei vollständige Rechnungen (beide mit Summe) an zwei Tagen → beide bezahlt', async () => {
    config(ALLE);
    seite('p1', S1, vorTagen(3), { mitSumme: true }); await verarbeiten('p1');
    seite('p2', S2, GESTERN, { mitSumme: true }); await verarbeiten('p2');
    expect(earns()).toHaveLength(2);
  });

  test('mehr als 8 Tage → nicht diese Regel', async () => {
    config(ALLE);
    seite('p1', S1, vorTagen(11), { hochgeladenVorTagen: 10 }); await verarbeiten('p1');
    seite('p2', S2, GESTERN); await verarbeiten('p2');
    expect(fake.store.get('receipts/p1').status).toBe('approved');
    expect(earns()).toHaveLength(2);
  });

  test("Regel aus bzw. 'shadow' → bezahlt (shadow vermerkt)", async () => {
    config({ ...ALLE, doppelOnlineSeite: 'shadow' });
    seite('p1', S1, GESTERN); await verarbeiten('p1');
    seite('p2', S2, vorTagen(2)); await verarbeiten('p2');
    expect(earns()).toHaveLength(2);
    expect(fake.store.get('receipts/p2').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'seite', modus: 'beobachtung', tag: GESTERN })]);
  });
});

// ─── 7 ────────────────────────────────────────────────────────────────────
describe('7 — App-Kassenbon ohne sichtbare Summe', () => {
  // Lesung wie unter v1.5: belegart app_kassenbon, totalCents null. Die Pipeline
  // nimmt die gespeicherte Lesung und bereinigt sie (wie bei jeder Gemini-Lesung).
  function appBon(id) {
    bonAnlegen('tmp', { markt: 'lidl', zeit: null, total: null, parsed: { belegart: 'app_kassenbon' } });
    const r = fake.store.get('receipts/tmp');
    fake.store.delete('receipts/tmp');
    delete r.ocr.reconciliation;
    fake.store.set(`receipts/${id}`, r);
  }

  test('Default: bezahlt wie unter v1.4 (Artikelsumme, vermerkt)', async () => {
    appBon('app1');
    await verarbeiten('app1');
    expect(fake.store.get('receipts/app1')).toMatchObject({ status: 'approved', cashbackCents: 8 });
    expect(fake.store.get('receipts/app1').ocr.parsed).toMatchObject({ totalCents: summe(ZEHN), summeAusArtikeln: true });
    expect(log('app-ohne-summe')).toEqual([{ cashbackId: 'app1', modus: false }]);
  });

  test("'shadow': bezahlt, gemeldet", async () => {
    config({ appSummePflicht: 'shadow' });
    appBon('app1');
    await verarbeiten('app1');
    expect(fake.store.get('receipts/app1').status).toBe('approved');
    expect(log('app-ohne-summe')).toEqual([{ cashbackId: 'app1', modus: 'shadow' }]);
  });

  test('appSummePflicht: true → reconciliation_delta, nichts gebucht', async () => {
    config({ appSummePflicht: true });
    appBon('app1');
    await verarbeiten('app1');
    expect(fake.store.get('receipts/app1')).toMatchObject({ status: 'rejected', rejectReason: 'reconciliation_delta' });
    expect(earns()).toHaveLength(0);
  });

  test('ein gedruckter Ladenbon ohne Summe bleibt ein Teilfoto (unverändert)', async () => {
    bonAnlegen('l1', { markt: 'lidl', total: null, parsed: { belegart: 'kassenbon' } });
    delete fake.store.get('receipts/l1').ocr.reconciliation;
    await verarbeiten('l1');
    expect(fake.store.get('receipts/l1')).toMatchObject({ status: 'rejected', rejectReason: 'reconciliation_delta' });
  });
});
