'use strict';

/**
 * Nachprüfung 06.10.2026, zweite Runde (claude/bon-doppelzahlung). Jeder
 * Angriff läuft mit dem ECHTEN index.js gegen die Firestore-Attrappe und
 * scheiterte am Stand davor (zwei Gutschriften für denselben Einkauf).
 *
 *   1  Regel bild zählte nur einen schon BEZAHLTEN Kandidaten: wurde die
 *      Kopie vor dem Original gebucht (oder lag das Original in der Prüfung),
 *      bekamen beide Geld. Jetzt zählt auch ein offener Kandidat; die Kopie
 *      wartet, bis das Original entschieden ist.
 *   2  seiteAbweichend (scharf) wurde nur in der Buchung geprüft — ein
 *      Abschnitt mit niedriger Lese-Sicherheit ging als ocr_confidence_low in
 *      die Prüfung, und die Bon-Runde gab ihn über den Resolver frei.
 *   3  Regeln bild und seite verlangten denselben Markt — ein unlesbarer Kopf
 *      wird über den Tippfehler-Abgleich „dm".
 *   4  Regel bild sah nur die bis zu 3 fein verglichenen Kandidaten.
 *   5  Der Resolver hält bei einem Treffer einer Prüfregel fest („halten"),
 *      statt zu buchen — außer ein Mensch hat den Prüfgrund schon vor sich.
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

const admin = require('firebase-admin');
const fn = require('../index');
const D = require('../lib/doppelBon');
const { bearbeitbar } = require('../../review-console/src/bonRegeln');

const fake = admin.__fake;
const A = 'kontoA';
const B = 'kontoB';
const TAG = 24 * 60 * 60 * 1000;
const SCHLUESSEL = 'admin-key';
const berlinDatum = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
const vorTagen = (n) => berlinDatum(Date.now() - n * TAG);
const GESTERN = vorTagen(1);
const VORGESTERN = vorTagen(2);

const ZEHN = ['Milch', 'Brot', 'Butter', 'Käse', 'Eier', 'Apfel', 'Birne', 'Saft', 'Tee', 'Reis']
  .map((name, i) => ({ name, priceCents: 100 + i * 10, qty: 1 }));
const summe = (items) => items.reduce((s, it) => s + it.priceCents, 0);
// „dm" heißt live genau so — ein leerer Händlername liegt im Tippfehler-
// Abgleich 2 davon entfernt (lib/merchant.js).
const MAERKTE = { netto: 'Netto Marken-Discount', kaufland: 'Kaufland', dm: 'dm', lidl: 'Lidl', rossmann: 'Rossmann' };
// Zwei Bildschirmabschnitte EINES Lidl-Plus-Bons.
const T1 = ['Banane lose', 'Kiwi Gold', 'Trauben hell', 'Mandarinen', 'Arla Kaergarden', 'Danone Actimel', 'Griech.Jogh. Kirsche', 'Mueller Ecke Mandel']
  .map((name, i) => ({ name, priceCents: 157 + i * 31, qty: 1 }));
const T2 = ['Smoothie Apfel-Ban.', 'DerGr.Bauer w.Zu.Erd', 'Mueller Shake Sunny', 'Del.Leberw. fein', 'Ehrmann Gr.De.Toffee', 'Fluess. Pflanzencreme', 'Sauerkirschkonfituere', 'Fusilli', 'Haferflocken kernig']
  .map((name, i) => ({ name, priceCents: 117 + i * 23, qty: 1 }));
// Kopie des Originals: 1 % beschnitten (Feinvergleich bestätigt nicht),
// Datum −1, Uhrzeit geändert, ein Preis und die Endsumme +10 ct — keine
// Textregel greift (nachpruefung0510b.test.js, B).
const KOPIE = ZEHN.map((it, i) => (i === 0 ? { ...it, priceCents: it.priceCents + 10 } : it));
const aehnlich = (...kandidaten) => ({
  bildAehnlich: { kandidat: kandidaten[0], kandidaten, distanz: 2, ssim: 0.52, seitenDiff: 0.012, bestaetigt: false },
});

const ALLE = {
  doppelSumme: true, doppelKonten: true, doppelArtikel: true, doppelBestellnummer: true,
  doppelDatum: true, doppelKontenArtikel: true, doppelKontenDatum: true,
};

function config(extra = {}) {
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, payoutThresholdCents: 1000, consentVersion: 'v1.0-2026-05', ...extra });
}

function ocrVon({ markt = 'kaufland', items = ZEHN, total = summe(items), zeit = '11:05', datum = GESTERN, confidence = 'high', parsed = {} } = {}) {
  const delta = total == null ? null : total - summe(items);
  return {
    engine: 'gemini-robust', model: 'test', promptVersion: 'test',
    parsed: { isReceipt: true, merchant: MAERKTE[markt], bonCountry: 'DE', bonDate: datum, bonTime: zeit, totalCents: total, items, ...parsed },
    robust: { confidence, attempts: 2 },
    ...(delta == null ? {} : { reconciliation: { ok: true, sumItemsCents: summe(items), deltaCents: Math.abs(delta), signedDeltaCents: delta, direction: delta === 0 ? 'exact' : 'undershoot' } }),
  };
}

/** Bon mit gespeicherter Lesung (der Lauf ruft kein Modell). */
function bonAnlegen(id, { uid = A, capture = {}, extra = {}, ...rest } = {}) {
  fake.store.set(`receipts/${id}`, {
    userId: uid,
    status: 'ocr_pending',
    campaignId: 'c1',
    createdAt: fake.zeit(Date.now() - 60 * 60 * 1000),
    storage: { bucket: 'b', path: `cashback-uploads/${uid}/${id}.jpg` },
    capture,
    ocr: ocrVon(rest),
    ...extra,
  });
}

/** App-Abschnitt ohne Summe: so liefert ihn lib/belegart.js unter Prompt v1.5. */
function ohneSumme(id, { belegart = 'app_kassenbon', parsed = {}, ...rest } = {}) {
  bonAnlegen(id, { ...rest, total: null, parsed: { belegart, totalCents: null, ...parsed } });
}

const verarbeiten = (id, uid = A) =>
  fn.processCashback({ id: `ev-${id}-${Math.random()}`, data: { message: { json: { cashbackId: id, uid } } } });

function antwort() {
  const r = { code: 200, body: undefined };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}

/** Freigabe über den Resolver (Bon-Runde bzw. Prüfkonsole). */
async function entscheiden(id, decision = 'approve') {
  const res = antwort();
  await fn.resolveCashbackReview(
    { get: (h) => (h === 'x-admin-key' ? SCHLUESSEL : undefined), query: { receiptId: id, decision } },
    res,
  );
  return res;
}

const ledger = (uid = A) =>
  [...fake.store.entries()].filter(([k]) => k.startsWith(`users/${uid}/cashback_ledger/`)).map(([, v]) => v);
const earns = (uid = A) => ledger(uid).filter((l) => l.type === 'earn');
const bon = (id) => fake.store.get(`receipts/${id}`);
const log = (name) => global.__logs.filter((l) => l[0] === name).map((l) => l[1]);

beforeEach(() => {
  fake.zuruecksetzen();
  global.__logs = [];
  global.__pushes = [];
  global.__published = [];
  global.__secrets = { NUTRITION_SCRAPER_TRIGGER_KEY: SCHLUESSEL };
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
describe('1 — Regel bild: das Original ist noch nicht entschieden', () => {
  test('Kontrolle: Original zuerst bezahlt → Kopie in die Prüfung, 1 Gutschrift', async () => {
    config(ALLE);
    bonAnlegen('orig');
    await verarbeiten('orig');
    bonAnlegen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich('orig') });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(bon('kopie').bildWartet).toBeUndefined();
    expect(earns()).toHaveLength(1);
  });

  test('Angriff A2: Kopie vor dem Original verarbeitet → sie wartet; nach dem Original holt der Kehrlauf sie → Prüfung, 1 Gutschrift', async () => {
    config(ALLE);
    bonAnlegen('orig');
    bonAnlegen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich('orig') });
    await verarbeiten('kopie');
    // Nichts gebucht, nichts entschieden — der Bon wartet auf das Original.
    expect(bon('kopie')).toMatchObject({ status: 'ocr_pending', bildWartet: { gegen: 'orig', versuche: 1 } });
    expect(earns()).toHaveLength(0);
    expect(global.__pushes).toHaveLength(0);
    expect(fake.store.get(`users/${A}/cashback_status/kopie`)).toBeUndefined();
    expect(log('bild-wartet-auf-original')).toEqual([expect.objectContaining({ cashbackId: 'kopie', gegen: 'orig', versuch: 1, pfad: 'buchung' })]);

    await verarbeiten('orig');
    expect(bon('orig').status).toBe('approved');

    // Der Kehrlauf stellt die wartende Kopie neu zu (die Lesung liegt im Cache).
    global.__published = [];
    await fn.sweepStuckReceipts();
    expect(global.__published.map((m) => m.json.cashbackId)).toEqual(['kopie']);
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(bearbeitbar(bon('kopie'))).toBe(false);
    expect(earns().map((e) => e.receiptId)).toEqual(['orig']);
  });

  test('Original wird abgelehnt → die wartende Kopie wird danach bezahlt (Neuversuch erlaubt)', async () => {
    config(ALLE);
    // Das „Original" ist zu alt und wird abgelehnt; bis dahin ist es offen.
    bonAnlegen('orig', { datum: vorTagen(20) });
    bonAnlegen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich('orig') });
    await verarbeiten('kopie');
    expect(bon('kopie').status).toBe('ocr_pending');
    await verarbeiten('orig');
    expect(bon('orig').status).toBe('rejected');
    await verarbeiten('kopie');
    expect(bon('kopie').status).toBe('approved');
    expect(earns().map((e) => e.receiptId)).toEqual(['kopie']);
  });

  test('Original bleibt offen (Prüfung bei einem Menschen) → nach den Warteläufen Prüfung bild_aehnlich_offen; die Bon-Runde fasst sie nicht an', async () => {
    config(ALLE);
    bonAnlegen('orig', { confidence: 'low' });
    await verarbeiten('orig');
    expect(bon('orig')).toMatchObject({ status: 'review', reviewReason: 'ocr_confidence_low' });
    bonAnlegen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich('orig') });
    for (let i = 1; i <= 4; i++) {
      await verarbeiten('kopie');
      expect(bon('kopie')).toMatchObject({ status: 'ocr_pending', bildWartet: { versuche: i } });
    }
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_OFFEN_GRUND, cashbackCents: 8 });
    expect(bon('kopie').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'bild', gegen: 'orig', offen: true, modus: 'wirksam' })]);
    expect(bearbeitbar(bon('kopie'))).toBe(false);
    expect(earns()).toHaveLength(0);
    // Ein Mensch hat den Grund vor sich und gibt frei → bucht.
    const res = await entscheiden('kopie');
    expect(res.body).toMatchObject({ ok: true, status: 'approved', creditedCents: 8 });
    expect(earns().map((e) => e.receiptId)).toEqual(['kopie']);
  });

  test('kein Kehrlauf mehr möglich (sweepCount 5) → sofort Prüfung statt warten (sonst bliebe der Bon für immer „wird geprüft")', async () => {
    config(ALLE);
    bonAnlegen('orig');
    bonAnlegen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich('orig'), extra: { sweepCount: 5 } });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_OFFEN_GRUND });
    expect(earns()).toHaveLength(0);
  });

  test('Angriff A1: Original in der Prüfung (Lese-Sicherheit), die Bon-Runde gibt es frei → die wartende Kopie geht in die Prüfung, 1 Gutschrift', async () => {
    config(ALLE);
    bonAnlegen('orig', { confidence: 'low' });
    await verarbeiten('orig');
    expect(bearbeitbar(bon('orig'))).toBe(true);
    bonAnlegen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich('orig') });
    await verarbeiten('kopie');
    expect(bon('kopie').status).toBe('ocr_pending');
    const res = await entscheiden('orig'); // = Aufruf der Bon-Runde
    expect(res.body).toMatchObject({ ok: true, status: 'approved' });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(earns().map((e) => e.receiptId)).toEqual(['orig']);
  });

  test('Kopie mit niedriger Lese-Sicherheit, Original noch offen → wartet ebenfalls; danach bild_aehnlich_bezahlt (nicht ocr_confidence_low)', async () => {
    config({ ...ALLE, ocrFieldGate: false });
    bonAnlegen('orig');
    bonAnlegen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, confidence: 'low', capture: aehnlich('orig') });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'ocr_pending', bildWartet: { gegen: 'orig', versuche: 1 } });
    expect(log('bild-wartet-auf-original')).toEqual([expect.objectContaining({ pfad: 'pruefung' })]);
    await verarbeiten('orig');
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(bon('kopie').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'bild', gegen: 'orig', modus: 'wirksam' })]);
    expect(bearbeitbar(bon('kopie'))).toBe(false);
    expect(earns()).toHaveLength(1);
  });

  test("'shadow' → kein Warten, bezahlt, der Treffer gegen den offenen Kandidaten steht am Bon", async () => {
    config({ ...ALLE, doppelBildAehnlich: 'shadow' });
    bonAnlegen('orig');
    bonAnlegen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich('orig') });
    await verarbeiten('kopie');
    expect(bon('kopie').status).toBe('approved');
    expect(bon('kopie').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'bild', offen: true, modus: 'beobachtung' })]);
  });
});

// ─── 5 (Resolver) ─────────────────────────────────────────────────────────
describe('5 — Resolver hält bei einer Prüfregel fest, statt zu buchen', () => {
  test('Kopie liegt ohne Vermerk als ocr_confidence_low in der Prüfung (Stand vor diesem Bau), Original bezahlt → Bon-Runde: 409 halten; ein Mensch gibt danach frei → bucht', async () => {
    config({ ...ALLE, ocrFieldGate: false });
    bonAnlegen('orig');
    await verarbeiten('orig');
    // Ohne Bild-Vermerk verarbeitet (wie vor dem Scharfschalten), dann trägt
    // der Bon ihn — die Prüfung auf dem Prüfpfad hat nie stattgefunden.
    bonAnlegen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, confidence: 'low' });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: 'ocr_confidence_low' });
    fake.store.set('receipts/kopie', { ...bon('kopie'), capture: aehnlich('orig') });

    const res = await entscheiden('kopie');
    expect(res.code).toBe(409);
    expect(res.body).toEqual({ code: 'halten', reviewReason: D.BILD_GRUND, regel: 'bild', gegen: 'orig' });
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(bon('kopie').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'bild', gegen: 'orig', modus: 'wirksam' })]);
    expect(bon('kopie').entscheidungLaeuft).toBeUndefined();
    expect(bon('kopie').reviewDecision).toBeUndefined();
    expect(earns()).toHaveLength(1);
    expect(bearbeitbar(bon('kopie'))).toBe(false);

    // Ein Mensch sieht jetzt die Zeile „Doppel-Prüfung" und entscheidet.
    const res2 = await entscheiden('kopie');
    expect(res2.body).toMatchObject({ ok: true, status: 'approved', creditedCents: 8 });
    expect(earns()).toHaveLength(2);
  });

  test('modiFuerEntscheidung: Prüfgrund am Bon → Prüfregeln nur beobachten; sonst bleiben sie, wie geschaltet', () => {
    const modi = D.doppelModi({ doppelSeiteAbweichend: true, doppelSumme: true });
    expect(D.modiFuerEntscheidung(modi, 'ocr_confidence_low')).toMatchObject({ bild: true, seiteAbweichend: true, summe: true });
    for (const g of [D.BILD_GRUND, D.BILD_OFFEN_GRUND, D.SEITE_GRUND]) {
      expect(D.modiFuerEntscheidung(modi, g)).toMatchObject({ bild: 'shadow', seiteAbweichend: 'shadow', summe: true });
    }
    // Ausgeschaltet bleibt aus.
    expect(D.modiFuerEntscheidung(D.doppelModi({ doppelBildAehnlich: false }), D.BILD_GRUND)).toMatchObject({ bild: false, seiteAbweichend: 'shadow' });
  });
});

// ─── 2 ────────────────────────────────────────────────────────────────────
describe('2 — seiteAbweichend auf dem Prüfpfad', () => {
  test('scharf: Abschnitt mit niedriger Lese-Sicherheit → seite_abweichend am Bon, die Bon-Runde fasst ihn nicht an', async () => {
    config({ ...ALLE, doppelSeiteAbweichend: true, ocrFieldGate: false });
    ohneSumme('s1', { markt: 'lidl', zeit: '10:15', items: T1 });
    await verarbeiten('s1');
    expect(bon('s1').status).toBe('approved');
    ohneSumme('s2', { markt: 'lidl', zeit: '10:16', items: T2, confidence: 'low' });
    await verarbeiten('s2');
    expect(bon('s2')).toMatchObject({ status: 'review', reviewReason: D.SEITE_GRUND });
    expect(bon('s2').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'seiteAbweichend', gegen: 's1', abweichend: ['uhrzeit'], modus: 'wirksam' })]);
    expect(bearbeitbar(bon('s2'))).toBe(false);
    expect(earns()).toHaveLength(1);
    // Ein Mensch gibt frei → bucht (er hat den Grund vor sich).
    expect((await entscheiden('s2')).body).toMatchObject({ ok: true, status: 'approved' });
    expect(earns()).toHaveLength(2);
  });

  test('Code-Default (Beobachtung): der Grund der Texterkennung bleibt, der Treffer steht am Bon', async () => {
    config({ ocrFieldGate: false });
    ohneSumme('s1', { markt: 'lidl', zeit: '10:15', items: T1 });
    await verarbeiten('s1');
    ohneSumme('s2', { markt: 'lidl', zeit: '10:16', items: T2, confidence: 'low' });
    await verarbeiten('s2');
    expect(bon('s2')).toMatchObject({ status: 'review', reviewReason: 'ocr_confidence_low' });
    expect(bon('s2').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'seiteAbweichend', modus: 'beobachtung' })]);
    expect(bearbeitbar(bon('s2'))).toBe(true);
    // Die Bon-Runde gibt ihn frei — beobachtet, ohne Wirkung.
    expect((await entscheiden('s2')).body).toMatchObject({ ok: true, status: 'approved' });
  });

  test('Wettlauf: Abschnitt 2 lag schon in der Prüfung, als Abschnitt 1 bezahlt wurde → Bon-Runde: 409 halten; Mensch → bucht', async () => {
    config({ ...ALLE, doppelSeiteAbweichend: true, ocrFieldGate: false });
    ohneSumme('s2', { markt: 'lidl', zeit: '10:16', items: T2, confidence: 'low' });
    await verarbeiten('s2');
    expect(bon('s2')).toMatchObject({ status: 'review', reviewReason: 'ocr_confidence_low' });
    ohneSumme('s1', { markt: 'lidl', zeit: '10:15', items: T1 });
    await verarbeiten('s1');
    expect(bon('s1').status).toBe('approved');

    const res = await entscheiden('s2'); // Bon-Runde
    expect(res.code).toBe(409);
    expect(res.body).toMatchObject({ code: 'halten', reviewReason: D.SEITE_GRUND, regel: 'seiteAbweichend', gegen: 's1' });
    expect(bon('s2')).toMatchObject({ status: 'review', reviewReason: D.SEITE_GRUND });
    expect(earns()).toHaveLength(1);
    expect(bearbeitbar(bon('s2'))).toBe(false);
    expect((await entscheiden('s2')).body).toMatchObject({ ok: true, status: 'approved' });
    expect(earns()).toHaveLength(2);
  });

  test('scharf, App-Abschnitt einen Tag daneben, niedrige Lese-Sicherheit → seite_abweichend', async () => {
    config({ doppelSeiteAbweichend: true, ocrFieldGate: false });
    ohneSumme('s1', { markt: 'lidl', zeit: null, items: T1, datum: VORGESTERN });
    await verarbeiten('s1');
    ohneSumme('s2', { markt: 'lidl', zeit: null, items: T2, datum: GESTERN, confidence: 'low' });
    await verarbeiten('s2');
    expect(bon('s2')).toMatchObject({ status: 'review', reviewReason: D.SEITE_GRUND });
    expect(bon('s2').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'seiteAbweichend', abweichend: ['tag'] })]);
  });
});

// ─── 3 ────────────────────────────────────────────────────────────────────
describe('3 — Markt nur unsicher erkannt (unlesbarer Kopf → „dm")', () => {
  test('Angriff C1: Kopie ohne lesbaren Händlerkopf mit Bildtreffer → Prüfung (Regel bild ohne Marktbedingung)', async () => {
    config(ALLE);
    bonAnlegen('orig');
    await verarbeiten('orig');
    bonAnlegen('kopie', { items: ZEHN.map((it, i) => (i < 5 ? { ...it, priceCents: it.priceCents + 1 } : it)), capture: aehnlich('orig'), parsed: { merchant: null } });
    await verarbeiten('kopie');
    expect(bon('kopie').merchant).toMatchObject({ id: 'dm', matchVia: 'fuzzy', sicher: false });
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(bon('kopie').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'bild', gegen: 'orig', andererMarkt: true })]);
    expect(earns()).toHaveLength(1);
  });

  test('Angriff D1: zweiter App-Abschnitt ohne lesbaren Kopf (→ dm) → Regel seite trifft, abgelehnt', async () => {
    ohneSumme('s1', { markt: 'lidl', zeit: null, items: T1 });
    await verarbeiten('s1');
    bonAnlegen('s2', { markt: 'lidl', zeit: null, items: T2, parsed: { belegart: 'app_kassenbon', merchant: null } });
    await verarbeiten('s2');
    expect(bon('s2').merchant).toMatchObject({ id: 'dm', sicher: false });
    expect(bon('s2')).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_self' });
    expect(bon('s2').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'seite', gegen: 's1', andererMarkt: true, modus: 'wirksam' })]);
    expect(earns()).toHaveLength(1);
  });

  test('dasselbe umgekehrt: der BEZAHLTE Abschnitt war ohne lesbaren Kopf → seite trifft auch', async () => {
    ohneSumme('s1', { markt: 'lidl', zeit: null, items: T1, parsed: { merchant: null } });
    await verarbeiten('s1');
    expect(bon('s1').merchant).toMatchObject({ id: 'dm', sicher: false });
    expect(fake.store.get(`users/${A}/cashback_days/${GESTERN}`).eintraege.s1).toMatchObject({ marktUnsicher: true });
    bonAnlegen('s2', { markt: 'lidl', zeit: null, items: T2, parsed: { belegart: 'app_kassenbon' } });
    await verarbeiten('s2');
    expect(bon('s2')).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_self' });
  });

  test('Kontrolle: zwei App-Belege verschiedener, sicher erkannter Märkte am selben Tag → beide bezahlt', async () => {
    ohneSumme('s1', { markt: 'lidl', zeit: null, items: T1 });
    await verarbeiten('s1');
    bonAnlegen('s2', { markt: 'netto', zeit: null, items: T2, parsed: { belegart: 'app_kassenbon' } });
    await verarbeiten('s2');
    expect(bon('s2').merchant).toMatchObject({ id: 'netto', sicher: true });
    expect(bon('s2').status).toBe('approved');
    expect(earns()).toHaveLength(2);
  });

  test('rein: marktIstSicher, identitaetAusBon, eintragAus', () => {
    expect(D.marktIstSicher('alias', false)).toBe(true);
    expect(D.marktIstSicher('ust_id', false)).toBe(true);
    expect(D.marktIstSicher('substring', true)).toBe(true);
    expect(D.marktIstSicher('fuzzy', true)).toBe(true);
    expect(D.marktIstSicher('fuzzy', false)).toBe(false);
    expect(D.marktIstSicher('eigenmarke', true)).toBe(false);
    expect(D.marktIstSicher(undefined, false)).toBe(true);
    expect(D.identitaetAusBon({ merchant: { id: 'dm', sicher: false }, bonDate: GESTERN }).marktUnsicher).toBe(true);
    // Altbestand ohne Feld: sicher (wie vor dieser Regel).
    expect(D.identitaetAusBon({ merchant: { id: 'dm' }, bonDate: GESTERN }).marktUnsicher).toBe(false);
    expect(D.identitaet({ merchantId: null, marktSicher: false }).marktUnsicher).toBe(false);
    expect(D.eintragAus(D.identitaet({ merchantId: 'dm', marktSicher: false }))).toMatchObject({ marktUnsicher: true });
    expect(D.eintragAus(D.identitaet({ merchantId: 'dm' }))).not.toHaveProperty('marktUnsicher');
  });
});

// ─── 4 ────────────────────────────────────────────────────────────────────
describe('4 — Regel bild sieht alle groben Treffer, nicht nur die 3 verglichenen', () => {
  test('Original an Position 4 hinter drei älteren bezahlten Bons außerhalb des Fensters → Prüfung', async () => {
    config(ALLE);
    for (const [i, id] of ['alt1', 'alt2', 'alt3'].entries()) {
      bonAnlegen(id, { datum: vorTagen(20 + i), zeit: `09:0${i}`, items: T1.map((it) => ({ ...it, priceCents: it.priceCents + i })), extra: { createdAt: fake.zeit(Date.now() - (20 + i) * TAG) } });
      fake.store.set(`receipts/${id}`, { ...bon(id), status: 'approved', merchant: { id: 'kaufland' }, bonDate: vorTagen(20 + i) });
      fake.store.set(`users/${A}/cashback_ledger/e_${id}`, { type: 'earn', cents: 8, receiptId: id });
    }
    bonAnlegen('orig');
    await verarbeiten('orig');
    bonAnlegen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich('alt1', 'alt2', 'alt3', 'orig') });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(bon('kopie').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'bild', gegen: 'orig' })]);
  });

  test('bildKandidatenIds: eigener Bon raus, ohne Doppelte, höchstens BILD_MAX_KANDIDATEN', () => {
    expect(D.bildKandidatenIds({ kandidat: 'a', kandidaten: ['b', 'a', 'self', 'c', 7, ''] }, 'self')).toEqual(['b', 'a', 'c']);
    expect(D.bildKandidatenIds(null, 'x')).toEqual([]);
    const viele = Array.from({ length: 30 }, (_, i) => `k${i}`);
    expect(D.bildKandidatenIds({ kandidaten: viele }, 'x')).toHaveLength(D.BILD_MAX_KANDIDATEN);
  });

  test('rein: bezahlte Kandidaten vor offenen; nur bezahlt oder offen zählt', () => {
    const neu = D.identitaet({ merchantId: 'kaufland', bonDate: GESTERN, items: ZEHN });
    const modi = D.doppelModi({});
    const u = D.doppelUrteil({
      bonId: 'n', uid: A, neu, modi,
      bild: [
        { id: 'offen1', markt: null, tag: null, lebendig: false, offen: true },
        { id: 'weg', markt: 'kaufland', tag: GESTERN, lebendig: false, offen: false },
        { id: 'bezahlt', markt: 'netto', tag: VORGESTERN, lebendig: true },
      ],
    });
    expect(u.treffer.map((t) => t.gegen)).toEqual(['bezahlt', 'offen1']);
    expect(u.wirksam).toMatchObject({ gegen: 'bezahlt', andererMarkt: true });
    expect(D.grundFuer(u.wirksam)).toBe(D.BILD_GRUND);
    expect(D.grundFuer(u.treffer[1])).toBe(D.BILD_OFFEN_GRUND);
    expect(u.treffer[1]).toMatchObject({ offen: true, abstand: null });
  });
});
