'use strict';

/**
 * Nachprüfung 05.10.2026, zweite Runde (claude/bon-doppelzahlung). Jeder
 * Befund wurde vorher mit dem ECHTEN index.js nachgestellt
 * (scratchpad/betr2-r2/n.angriff.test.js, scratchpad/gb2); hier dieselben
 * Fälle mit dem Ergebnis nach dem Fix.
 *
 *   A  App-Kassenbon in mehreren Bildschirmabschnitten ohne Summe: die
 *      Artikelsumme setzt lib/belegart.js OHNE Schalter ein, also zahlte schon
 *      der Deploy jeden Abschnitt (echte Fälle Lidl 16.07. und 21.09.). Regel
 *      seite deckt jetzt App-Bons (nur selber Tag), Code-Default an.
 *   B  Regel bild: beschnittene Kopie eines bezahlten Bons mit geänderten
 *      Preisziffern, Uhrzeit und Datum — keine Textregel greift, der scharfe
 *      Feinvergleich bestätigt Beschnitt nicht. Ein nicht bestätigter
 *      Bildtreffer gegen einen bezahlten Bon (gleicher Markt, ±8 Tage) geht in
 *      die Prüfung.
 *   C  Die bekannte Textlücke (Befund 1) gilt ab 1 Tag Abstand — festgehalten,
 *      damit eine spätere Änderung die Doku mitzieht.
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
const MAERKTE = { netto: 'Netto Marken-Discount', kaufland: 'Kaufland', dm: 'dm-drogerie markt', lidl: 'Lidl' };

// Alle Doppel-Regeln scharf (wie nach dem Ausrollen); seite und bild sind
// ohnehin per Code-Default an.
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

/** App-Abschnitt bzw. Online-Seite ohne Summe: so liefert ihn lib/belegart.js. */
function ohneSumme(id, { belegart = 'app_kassenbon', ...rest } = {}) {
  bonAnlegen(id, { ...rest, total: null, parsed: { belegart, totalCents: null } });
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
const positionen = (uid, id) => [...fake.store.keys()].filter((k) => k.startsWith(`users/${uid}/purchased_products/${id}_`));

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

// Echter Fall 21.09. (bon_mub22qt456uqc9 / bon_mub22xa7q07iev): zwei
// Scrollbilder desselben Lidl-Plus-Bons, Datum in der Kopfzeile, keine Uhrzeit,
// kein gemeinsamer Artikel.
const T1 = ['Banane lose', 'Kiwi Gold', 'Trauben hell', 'Mandarinen', 'Arla Kaergarden', 'Danone Actimel', 'Griech.Jogh. Kirsche', 'Mueller Ecke Mandel']
  .map((name, i) => ({ name, priceCents: 157 + i * 31, qty: 1 }));
const T2 = ['Smoothie Apfel-Ban.', 'DerGr.Bauer w.Zu.Erd', 'Mueller Shake Sunny', 'Del.Leberw. fein', 'Ehrmann Gr.De.Toffee', 'Fluess. Pflanzencreme', 'Sauerkirschkonfituere', 'Fusilli', 'Haferflocken kernig']
  .map((name, i) => ({ name, priceCents: 117 + i * 23, qty: 1 }));

// ─── A ────────────────────────────────────────────────────────────────────
describe('A — App-Kassenbon in Bildschirmabschnitten (Regel seite)', () => {
  test('Deploy-Stand (kein Doppel-Schalter gesetzt): zwei Abschnitte ohne Summe → genau eine Gutschrift', async () => {
    ohneSumme('d1a', { markt: 'lidl', zeit: null, items: T1 });
    await verarbeiten('d1a');
    ohneSumme('d1b', { markt: 'lidl', zeit: null, items: T2 });
    await verarbeiten('d1b');

    expect(bon('d1a')).toMatchObject({ status: 'approved', bonTotalCents: summe(T1) });
    expect(bon('d1b')).toMatchObject({
      status: 'rejected', rejectReason: 'duplicate_content_self', cashbackCents: 0,
      duplicateOf: { receiptId: 'd1a', sameUser: true, kind: 'seite' },
    });
    expect(bon('d1b').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'seite', app: true, modus: 'wirksam' })]);
    expect(earns()).toHaveLength(1);
    expect(fake.store.get(`users/${A}`).cashback_balance_cents).toBe(8);
    expect(global.__pushes).toHaveLength(1);
    expect(positionen(A, 'd1b')).toHaveLength(0);
    // Der Tageseintrag trägt das Merkmal für künftige Vergleiche.
    expect(fake.store.get(`users/${A}/cashback_days/${GESTERN}`).eintraege.d1a).toMatchObject({ app: true, ohneSumme: true });
  });

  test('der Abschnitt MIT Summe nach einem ohne Summe wird ebenfalls abgefangen', async () => {
    ohneSumme('o1', { markt: 'lidl', zeit: null, items: T1 });
    await verarbeiten('o1');
    bonAnlegen('o2', { markt: 'lidl', zeit: '17:40', items: T2, parsed: { belegart: 'app_kassenbon' } });
    await verarbeiten('o2');
    expect(bon('o2')).toMatchObject({ status: 'rejected', duplicateOf: { kind: 'seite' } });
    expect(earns()).toHaveLength(1);
  });

  test('alle Schalter scharf (Angriff N3): ebenfalls genau eine Gutschrift', async () => {
    config(ALLE);
    ohneSumme('n3a', { markt: 'lidl', zeit: '17:40', items: T1 });
    await verarbeiten('n3a');
    ohneSumme('n3b', { markt: 'lidl', zeit: null, items: T2 });
    await verarbeiten('n3b');
    expect(earns()).toHaveLength(1);
    expect(bon('n3b').duplicateOf).toMatchObject({ kind: 'seite' });
  });

  test('Rückweg: doppelOnlineSeite ausdrücklich false → beide bezahlt wie ohne Schutz', async () => {
    config({ doppelOnlineSeite: false });
    ohneSumme('f1', { markt: 'lidl', zeit: null, items: T1 });
    await verarbeiten('f1');
    ohneSumme('f2', { markt: 'lidl', zeit: null, items: T2 });
    await verarbeiten('f2');
    expect(earns()).toHaveLength(2);
  });

  test("'shadow' → beide bezahlt, der Treffer steht am Bon", async () => {
    config({ doppelOnlineSeite: 'shadow' });
    ohneSumme('s1', { markt: 'lidl', zeit: null, items: T1 });
    await verarbeiten('s1');
    ohneSumme('s2', { markt: 'lidl', zeit: null, items: T2 });
    await verarbeiten('s2');
    expect(earns()).toHaveLength(2);
    expect(bon('s2').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'seite', app: true, modus: 'beobachtung' })]);
  });

  test('zwei Einkäufe am selben Tag mit VERSCHIEDENEN Uhrzeiten → beide bezahlt', async () => {
    ohneSumme('z1', { markt: 'lidl', zeit: '09:12', items: T1 });
    await verarbeiten('z1');
    ohneSumme('z2', { markt: 'lidl', zeit: '18:47', items: T2 });
    await verarbeiten('z2');
    expect(earns()).toHaveLength(2);
  });

  test('App-Bons an verschiedenen Tagen (Wocheneinkauf, ohne Uhrzeit) → beide bezahlt', async () => {
    // 36 ehrliche Lidl-Paare derselben Person in 1–8 Tagen, oft ohne Uhrzeit.
    config(ALLE);
    ohneSumme('w1', { markt: 'lidl', zeit: null, items: T1, datum: VORGESTERN });
    await verarbeiten('w1');
    ohneSumme('w2', { markt: 'lidl', zeit: null, items: T2, datum: GESTERN });
    await verarbeiten('w2');
    expect(earns()).toHaveLength(2);
  });

  test('App-Abschnitt und gedruckter Ladenbon am selben Tag → beide bezahlt (andere Belegart)', async () => {
    ohneSumme('m1', { markt: 'lidl', zeit: null, items: T1 });
    await verarbeiten('m1');
    bonAnlegen('m2', { markt: 'lidl', zeit: '18:00', items: T2, parsed: { belegart: 'kassenbon' } });
    await verarbeiten('m2');
    expect(earns()).toHaveLength(2);
  });

  test('anderes Konto mit demselben Abschnitt → nicht diese Regel (nur dieselbe Person)', async () => {
    ohneSumme('k1', { markt: 'lidl', zeit: null, items: T1 });
    await verarbeiten('k1');
    ohneSumme('k2', { uid: B, markt: 'lidl', zeit: null, items: T2 });
    await verarbeiten('k2', B);
    expect(earns(A)).toHaveLength(1);
    expect(earns(B)).toHaveLength(1);
  });

  test('Freigabe über den Resolver: der zweite Abschnitt in der Prüfung wird nicht bezahlt', async () => {
    ohneSumme('r1', { markt: 'lidl', zeit: null, items: T1 });
    await verarbeiten('r1');
    fake.store.set('receipts/r2', {
      userId: A, status: 'review', reviewReason: 'ocr_confidence_low', cashbackCents: 8,
      bonDate: GESTERN, bonTime: null, bonTotalCents: summe(T2), campaignId: 'c1', campaignIdAngewandt: 'c1',
      merchant: { id: 'lidl', name: 'Lidl', land: 'DE' }, belegart: 'app_kassenbon',
      ocr: { parsed: { bonDate: GESTERN, bonTime: null, totalCents: summe(T2), items: T2, belegart: 'app_kassenbon', summeAusArtikeln: true } },
    });
    const res = await entscheiden('r2');
    expect(res.body).toMatchObject({ ok: true, status: 'rejected', creditedCents: 0 });
    expect(earns()).toHaveLength(1);
  });

  test('Online-Seiten: zwei VERSCHIEDENE Uhrzeiten heben die Regel ebenfalls auf', async () => {
    ohneSumme('p1', { markt: 'dm', zeit: '10:01', items: T1, belegart: 'online_bestellung' });
    await verarbeiten('p1');
    ohneSumme('p2', { markt: 'dm', zeit: '16:30', items: T2, belegart: 'online_bestellung' });
    await verarbeiten('p2');
    expect(earns()).toHaveLength(2);
  });
});

describe('A — Regeln rein', () => {
  const id = (o) => D.identitaet({ merchantId: 'lidl', bonDate: GESTERN, items: T1, ...o });
  test('identitaet/eintragAus/identitaetAusBon tragen das App-Merkmal', () => {
    expect(id({ belegart: 'app_kassenbon' }).app).toBe(true);
    expect(id({ belegart: 'kassenbon' }).app).toBe(false);
    expect(D.eintragAus(id({ belegart: 'app_kassenbon', summeAusArtikeln: true }))).toMatchObject({ app: true, ohneSumme: true });
    expect(D.eintragAus(id({ belegart: 'kassenbon' })).app).toBeUndefined();
    expect(D.identitaetAusBon({ merchant: { id: 'lidl' }, bonDate: GESTERN, ocr: { parsed: { belegart: 'app_kassenbon', items: T1 } } }).app).toBe(true);
    // Top-level-Feld am Bon reicht auch (Altbestand ohne parsed.belegart).
    expect(D.identitaetAusBon({ merchant: { id: 'lidl' }, bonDate: GESTERN, belegart: 'app_kassenbon', ocr: { parsed: { items: T1 } } }).app).toBe(true);
  });

  test('App-Paar an einem ANDEREN Tag trifft nie, ein Online-Paar schon', () => {
    const modi = D.doppelModi({});
    const neuApp = { ...id({ belegart: 'app_kassenbon', summeAusArtikeln: true }), tag: GESTERN };
    const altApp = D.eintragAus(D.identitaet({ merchantId: 'lidl', bonDate: VORGESTERN, items: T2, belegart: 'app_kassenbon' }));
    expect(D.doppelUrteil({ bonId: 'n', uid: A, neu: neuApp, andere: [{ id: 'a', eintrag: altApp, tag: VORGESTERN }], modi }).treffer).toEqual([]);
    const neuOn = { ...id({ online: true, summeAusArtikeln: true }) };
    const altOn = D.eintragAus(D.identitaet({ merchantId: 'lidl', bonDate: VORGESTERN, items: T2, online: true }));
    expect(D.doppelUrteil({ bonId: 'n', uid: A, neu: neuOn, andere: [{ id: 'a', eintrag: altOn, tag: VORGESTERN }], modi }).wirksam)
      .toMatchObject({ regel: 'seite', tag: VORGESTERN });
  });
});

// ─── B ────────────────────────────────────────────────────────────────────
describe('B — Regel bild (Feinvergleich hat einen Bildtreffer nicht bestätigt)', () => {
  // Kopie des bezahlten Bons: 1 % beschnitten (darum nicht bestätigt), Datum
  // −1 Tag, Uhrzeit geändert, ein Artikelpreis und die Endsumme +10 ct.
  const KOPIE = ZEHN.map((it, i) => (i === 0 ? { ...it, priceCents: it.priceCents + 10 } : it));
  const aehnlich = (kandidat = 'orig', extra = {}) => ({
    bildAehnlich: { kandidat, kandidaten: [kandidat], distanz: 2, ssim: 0.52, seitenDiff: 0.012, bestaetigt: false, ...extra },
  });
  async function original(extra = {}) {
    bonAnlegen('orig', { markt: 'kaufland', zeit: '11:05', datum: GESTERN, ...extra });
    await verarbeiten('orig');
    expect(bon('orig').status).toBe('approved');
  }

  test('Kontrolle (Befund 1): ohne Bildtreffer zahlt die Kopie — keine Textregel greift, auch alle scharf', async () => {
    config(ALLE);
    await original();
    bonAnlegen('kopie', { markt: 'kaufland', zeit: '12:31', datum: VORGESTERN, items: KOPIE });
    await verarbeiten('kopie');
    expect(bon('kopie').status).toBe('approved');
    expect(bon('kopie').doppelPruefung.treffer).toEqual([]);
    expect(earns()).toHaveLength(2);
  });

  test('mit Bildtreffer gegen den bezahlten Bon → Prüfung statt Gutschrift', async () => {
    config(ALLE);
    await original();
    bonAnlegen('kopie', { markt: 'kaufland', zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich() });
    await verarbeiten('kopie');

    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND, rejectReason: null, cashbackCents: 8 });
    expect(bon('kopie').doppelPruefung.treffer).toEqual([
      expect.objectContaining({ regel: 'bild', gegen: 'orig', sameUser: true, abstand: 1, modus: 'wirksam' }),
    ]);
    expect(fake.store.get(`users/${A}/cashback_status/kopie`)).toMatchObject({ status: 'review' });
    expect(earns()).toHaveLength(1);
    expect(fake.store.get(`users/${A}`).cashback_balance_cents).toBe(8);
    expect(global.__pushes).toHaveLength(1);
    expect(positionen(A, 'kopie')).toHaveLength(0);
    // Die Bon-Runde entscheidet diesen Grund nicht — ein Mensch sieht ihn.
    expect(bearbeitbar(bon('kopie'))).toBe(false);
    expect(log('doppel-treffer')).toEqual(expect.arrayContaining([expect.objectContaining({ cashbackId: 'kopie', regel: 'bild', modus: 'wirksam' })]));
  });

  // Angriff N1: selber Tag und Uhrzeit, 5 von 10 Preisen +1 ct, Endsumme mit —
  // Artikelanteil 0,5 < 0,6, keine Textregel am selben Tag.
  const N1 = ZEHN.map((it, i) => (i < 5 ? { ...it, priceCents: it.priceCents + 1 } : it));
  test.each([[false, 'approved'], [true, 'review']])('Angriff N1 (selber Tag, 5 von 10 Preisen geändert), Bildtreffer %p → %p', async (mitBild, erwartet) => {
    config(ALLE);
    await original();
    bonAnlegen('kopie', { markt: 'kaufland', zeit: '11:05', datum: GESTERN, items: N1, ...(mitBild ? { capture: aehnlich() } : {}) });
    await verarbeiten('kopie');
    expect(bon('kopie').status).toBe(erwartet);
    if (mitBild) {
      expect(bon('kopie')).toMatchObject({ reviewReason: D.BILD_GRUND });
      expect(bon('kopie').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'bild', abstand: 0, modus: 'wirksam' })]);
      expect(earns()).toHaveLength(1);
    }
  });

  test('wirkt auch im Deploy-Stand der Doppel-Regeln (bild ist per Code-Default an)', async () => {
    await original();
    bonAnlegen('kopie', { markt: 'kaufland', zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich() });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(earns()).toHaveLength(1);
  });

  test('ein Mensch gibt den gehaltenen Bon frei → er wird gebucht (er hat entschieden)', async () => {
    config(ALLE);
    await original();
    bonAnlegen('kopie', { markt: 'kaufland', zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich() });
    await verarbeiten('kopie');
    const res = await entscheiden('kopie');
    expect(res.body).toMatchObject({ ok: true, status: 'approved', creditedCents: 8 });
    expect(earns()).toHaveLength(2);
    // Eine erneute Zustellung danach storniert nichts und hält nicht erneut.
    fake.store.set('receipts/kopie', { ...bon('kopie'), status: 'ocr_pending' });
    await verarbeiten('kopie');
    expect(bon('kopie').status).toBe('approved');
    expect(earns()).toHaveLength(2);
    expect(ledger().filter((l) => l.type === 'reverse')).toHaveLength(0);
  });

  test('ein Mensch lehnt ab → bleibt abgelehnt, nichts gebucht', async () => {
    await original();
    bonAnlegen('kopie', { markt: 'kaufland', zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich() });
    await verarbeiten('kopie');
    const res = await entscheiden('kopie', 'reject');
    expect(res.body).toMatchObject({ ok: true, status: 'rejected' });
    expect(earns()).toHaveLength(1);
  });

  test('erneut fotografierter, schon bezahlter Bon (gleicher Text) → abgelehnt, nicht Prüfung', async () => {
    config(ALLE);
    await original();
    bonAnlegen('retake', { markt: 'kaufland', zeit: '11:05', datum: GESTERN, capture: aehnlich() });
    await verarbeiten('retake');
    expect(bon('retake')).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_self' });
    expect(earns()).toHaveLength(1);
  });

  test('der Bon geht ohnehin wegen der Lese-Sicherheit in die Prüfung → Prüfgrund bild, die Bon-Runde gibt ihn nicht frei', async () => {
    config(ALLE);
    await original();
    bonAnlegen('kopie', { markt: 'kaufland', zeit: '12:31', datum: VORGESTERN, items: KOPIE, confidence: 'low', capture: aehnlich() });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(bon('kopie').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'bild', gegen: 'orig', modus: 'wirksam' })]);
    expect(bearbeitbar(bon('kopie'))).toBe(false);
    expect(earns()).toHaveLength(1);
  });

  test('Kontrolle: Lese-Sicherheit niedrig, kein Bildtreffer → Prüfgrund der Texterkennung wie bisher', async () => {
    await original();
    bonAnlegen('kopie', { markt: 'kaufland', zeit: '12:31', datum: VORGESTERN, items: KOPIE, confidence: 'low' });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: 'ocr_confidence_low' });
    expect(bearbeitbar(bon('kopie'))).toBe(true);
  });

  test("'shadow' → bezahlt, der Treffer steht am Bon", async () => {
    config({ ...ALLE, doppelBildAehnlich: 'shadow' });
    await original();
    bonAnlegen('kopie', { markt: 'kaufland', zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich() });
    await verarbeiten('kopie');
    expect(bon('kopie').status).toBe('approved');
    expect(bon('kopie').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'bild', modus: 'beobachtung' })]);
    expect(earns()).toHaveLength(2);
  });

  test('ausdrücklich false → bezahlt (und der Feinvergleich fällt auf shadow zurück, siehe enqueueBild)', async () => {
    config({ ...ALLE, doppelBildAehnlich: false });
    await original();
    bonAnlegen('kopie', { markt: 'kaufland', zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich() });
    await verarbeiten('kopie');
    expect(bon('kopie').status).toBe('approved');
    expect(earns()).toHaveLength(2);
  });

  test('Kandidat nicht (mehr) bezahlt → bezahlt', async () => {
    await original();
    // Gutschrift des Originals storniert (z. B. durch einen Menschen).
    const earn = earns()[0];
    fake.store.set(`users/${A}/cashback_ledger/storno1`, { type: 'reverse', cents: earn.cents, receiptId: 'orig' });
    bonAnlegen('kopie', { markt: 'kaufland', zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich() });
    await verarbeiten('kopie');
    expect(bon('kopie').status).toBe('approved');
  });

  test('anderer Markt → bezahlt (die Regel vergleicht nur denselben Markt)', async () => {
    await original();
    bonAnlegen('kopie', { markt: 'netto', zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich() });
    await verarbeiten('kopie');
    expect(bon('kopie').status).toBe('approved');
  });

  test('Bon-Tag mehr als 8 Tage vom Original entfernt → bezahlt (bekannte Lücke, siehe CLAUDE.md)', async () => {
    // Das Original wurde damals frisch eingereicht und bezahlt.
    await original({ datum: vorTagen(10), hochgeladenVorTagen: 10 });
    bonAnlegen('kopie', { markt: 'kaufland', zeit: '12:31', datum: GESTERN, items: KOPIE, capture: aehnlich() });
    await verarbeiten('kopie');
    expect(bon('kopie').status).toBe('approved');
    expect(earns()).toHaveLength(2);
  });

  test('Kandidat eines anderen Kontos → nie verglichen', async () => {
    bonAnlegen('fremd', { uid: B, markt: 'kaufland', zeit: '11:05', datum: GESTERN });
    await verarbeiten('fremd', B);
    bonAnlegen('kopie', { markt: 'kaufland', zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich('fremd') });
    await verarbeiten('kopie');
    expect(bon('kopie').status).toBe('approved');
  });

  test('der NÄCHSTE Kandidat ist ein offener Bon, ein weiterer bezahlt → trotzdem Prüfung', async () => {
    await original();
    bonAnlegen('offen', { markt: 'kaufland', zeit: '19:00', datum: GESTERN });
    fake.store.set('receipts/offen', { ...bon('offen'), status: 'review', merchant: { id: 'kaufland' }, bonDate: GESTERN });
    bonAnlegen('kopie', {
      markt: 'kaufland', zeit: '12:31', datum: VORGESTERN, items: KOPIE,
      capture: aehnlich('offen', { kandidaten: ['offen', 'orig'] }),
    });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(bon('kopie').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'bild', gegen: 'orig' })]);
  });

  test('Regel rein: Markt, Tag ±8, Reihenfolge nach allen ablehnenden Regeln', () => {
    const neu = D.identitaet({ merchantId: 'kaufland', bonDate: GESTERN, items: ZEHN });
    expect(D.bildTrifft(neu, { markt: 'Kaufland', tag: vorTagen(9) })).toEqual({ abstand: 8 });
    expect(D.bildTrifft(neu, { markt: 'kaufland', tag: vorTagen(10) })).toBeNull();
    expect(D.bildTrifft(neu, { markt: 'netto', tag: GESTERN })).toBeNull();
    expect(D.bildTrifft(neu, { markt: null, tag: GESTERN })).toBeNull();
    expect(D.bildTrifft({ ...neu, markt: null }, { markt: 'kaufland', tag: GESTERN })).toBeNull();
    const modi = D.doppelModi({ doppelSumme: true });
    const u = D.doppelUrteil({
      bonId: 'n', uid: A, neu: { ...neu, summe: 1000 },
      andere: [{ id: 'o', eintrag: D.eintragAus({ ...neu, summe: 1000 }) }],
      bild: [{ id: 'o', markt: 'kaufland', tag: GESTERN, lebendig: true }],
      modi,
    });
    expect(u.treffer.map((t) => t.regel)).toEqual(['summe', 'bild']);
    expect(u.wirksam).toMatchObject({ regel: 'summe' });
    expect(D.grundFuer({ regel: 'bild', sameUser: true })).toBe('bild_aehnlich_bezahlt');
    // Nicht bezahlt → kein Treffer.
    expect(D.doppelUrteil({ bonId: 'n', uid: A, neu, bild: [{ id: 'o', markt: 'kaufland', tag: GESTERN, lebendig: false }], modi }).treffer).toEqual([]);
  });
});

// ─── C ────────────────────────────────────────────────────────────────────
describe('C — bekannte Textlücke (Befund 1) gilt ab 1 Tag, nicht erst ab 9', () => {
  test('Datum −1, Uhrzeit geändert, ein Preis und die Endsumme +10 ct: keine Textregel trifft', () => {
    const modi = D.doppelModi({ ...ALLE });
    const alt = D.identitaet({ merchantId: 'kaufland', bonDate: GESTERN, bonTime: '11:05', totalCents: summe(ZEHN), items: ZEHN });
    const items = ZEHN.map((it, i) => (i === 0 ? { ...it, priceCents: it.priceCents + 10 } : it));
    const neu = D.identitaet({ merchantId: 'kaufland', bonDate: VORGESTERN, bonTime: '12:31', totalCents: summe(items), items });
    const u = D.doppelUrteil({ bonId: 'n', uid: A, neu, andere: [{ id: 'o', eintrag: D.eintragAus(alt), tag: GESTERN }], modi });
    expect(u.treffer).toEqual([]);
    const p = D.personKandidaten({ bonId: 'n', neu, eintraege: { o: { l: [D.personLesungAus(alt)] } }, modi });
    expect(p).toEqual([]);
  });
});
