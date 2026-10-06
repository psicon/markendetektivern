'use strict';

/**
 * Dritte Prüfrunde 06.10.2026 (claude/bon-doppelzahlung). Jeder Fall läuft mit
 * dem ECHTEN index.js gegen die Firestore-Attrappe; am Stand davor ergaben die
 * Angriffe zwei Gutschriften für denselben Einkauf.
 *
 *   1  `bild_aehnlich_offen` schaltete im Resolver Regel bild ab: gab ein
 *      Mensch die Kopie frei, buchte sie, und das Original (das die Kopie nie
 *      sieht) wurde danach ebenfalls bezahlt — Original in der Prüfung, noch
 *      ocr_pending oder schon von der Bon-Runde bezahlt.
 *   2  Ein Lesefehler auf cashback_config/v1 schaltete über DEFAULT_CONFIG den
 *      Doppel-Schutz und den Aktions-Modus still ab.
 *   3  Der Deploy allein stellte den Doppelfall vom 04.10. nicht ab (summe war
 *      per Default aus).
 *   4  Regel bild nur ±8 Tage um das Original: mit scharfem Feinvergleich war
 *      eine Kopie mit dem Datum „gestern" zu einem älteren Original bezahlt.
 *   5  Regel seite verlangte dieselbe Belegart: eine Rechnungsseite als
 *      Online-Bestellung und ein weiterer Teil als App-Kassenbon wurden beide
 *      bezahlt.
 */

jest.mock('firebase-admin', () => require('./helpers/fakeAdmin').erstelleFakeAdmin());
jest.mock('firebase-functions', () => ({
  logger: {
    info: (...a) => global.__logs.push(a),
    warn: (...a) => global.__logs.push(a),
    error: (...a) => global.__logs.push(a),
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
const TAG = 24 * 60 * 60 * 1000;
const SCHLUESSEL = 'admin-key';
const berlinDatum = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
const vorTagen = (n) => berlinDatum(Date.now() - n * TAG);
const GESTERN = vorTagen(1);
const VORGESTERN = vorTagen(2);

const ZEHN = ['Milch', 'Brot', 'Butter', 'Käse', 'Eier', 'Apfel', 'Birne', 'Saft', 'Tee', 'Reis']
  .map((name, i) => ({ name, priceCents: 100 + i * 10, qty: 1 }));
const summe = (items) => items.reduce((s, it) => s + it.priceCents, 0);
const MAERKTE = { kaufland: 'Kaufland', dm: 'dm' };
// Kopie des Originals: 1 % beschnitten (Feinvergleich bestätigt nicht),
// Datum −1, Uhrzeit geändert, ein Preis und die Endsumme +10 ct — keine
// Textregel greift (nachpruefung0510b.test.js, B).
const KOPIE = ZEHN.map((it, i) => (i === 0 ? { ...it, priceCents: it.priceCents + 10 } : it));
const aehnlich = (...kandidaten) => ({
  bildAehnlich: { kandidat: kandidaten[0], kandidaten, distanz: 2, ssim: 0.52, seitenDiff: 0.012, bestaetigt: false },
});
// Zwei Teile EINER dm-Online-Bestellung (verschiedene Artikel, keine Summe).
const S1 = ['Balea Duschgel', 'Alverde Shampoo', 'dmBio Haferdrink', 'Mivolis Magnesium', 'Ebelin Watte', 'Babylove Tuecher']
  .map((name, i) => ({ name, priceCents: 95 + i * 40, qty: 1 }));
const S2 = ['Denkmit Spuelmittel', 'Profissimo Folie', 'Balea Creme', 'dmBio Nuesse', 'Sundance Spray', 'Jessa Binden']
  .map((name, i) => ({ name, priceCents: 145 + i * 35, qty: 1 }));

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

/** Teil eines Belegs ohne gedruckte Summe (so liefert ihn Prompt v1.5). */
function teil(id, { belegart, items }) {
  bonAnlegen(id, { markt: 'dm', zeit: null, items, total: null, parsed: { belegart, totalCents: null, bestellnummer: null } });
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

/** Entscheidung über den Resolver (Bon-Runde bzw. Prüfkonsole). */
/**
 * Entscheidung über den Resolver. Wie die Prüfkonsole schickt sie den Stand der
 * Zeile „Doppel-Prüfung" mit, den der Mensch gerade sieht (`doppelStand`,
 * vierte Prüfrunde 06.10.2026); `gesehen: false` = ohne (Bon-Runde, Skript).
 */
async function entscheiden(id, decision = 'approve', { gesehen = true } = {}) {
  const res = antwort();
  const dp = fake.store.get(`receipts/${id}`)?.doppelPruefung;
  const stand = gesehen && dp && dp.at && typeof dp.at.toMillis === 'function' ? String(dp.at.toMillis()) : undefined;
  await fn.resolveCashbackReview(
    { get: (h) => (h === 'x-admin-key' ? SCHLUESSEL : undefined), query: { receiptId: id, decision, ...(stand ? { doppelStand: stand } : {}) } },
    res,
  );
  return res;
}

const ledger = (uid = A) =>
  [...fake.store.entries()].filter(([k]) => k.startsWith(`users/${uid}/cashback_ledger/`)).map(([, v]) => v);
const earns = (uid = A) => ledger(uid).filter((l) => l.type === 'earn');
const bon = (id) => fake.store.get(`receipts/${id}`);

beforeEach(() => {
  fake.zuruecksetzen();
  fake.fehler.clear();
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
});

// ─── 1 ────────────────────────────────────────────────────────────────────
describe('1 — bild_aehnlich_offen: die Freigabe der Kopie prüft erneut', () => {
  /** Original in der Prüfung (Lese-Sicherheit), Kopie nach den Warteläufen als bild_aehnlich_offen. */
  async function kopieGegenOffenesOriginal() {
    config(ALLE);
    bonAnlegen('orig', { confidence: 'low' });
    await verarbeiten('orig');
    expect(bon('orig')).toMatchObject({ status: 'review', reviewReason: 'ocr_confidence_low' });
    bonAnlegen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich('orig') });
    for (let i = 1; i <= 5; i++) await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_OFFEN_GRUND });
  }

  test('a) Mensch gibt die Kopie frei, solange das Original offen ist → festgehalten; danach gibt die Bon-Runde das Original frei → 1 Gutschrift', async () => {
    await kopieGegenOffenesOriginal();
    const r1 = await entscheiden('kopie');
    expect(r1.code).toBe(409);
    expect(r1.body).toEqual({ code: 'halten', reviewReason: D.BILD_OFFEN_GRUND, regel: 'bild', gegen: 'orig' });
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_OFFEN_GRUND });
    expect(bon('kopie').reviewDecision).toBeUndefined();
    expect(earns()).toHaveLength(0);

    expect(bearbeitbar(bon('orig'))).toBe(true);
    expect((await entscheiden('orig')).body).toMatchObject({ ok: true, status: 'approved' });

    // Erneute Freigabe der Kopie: jetzt gegen das BEZAHLTE Original, frischer Vermerk.
    const r2 = await entscheiden('kopie');
    expect(r2.code).toBe(409);
    expect(r2.body).toEqual({ code: 'halten', reviewReason: D.BILD_GRUND, regel: 'bild', gegen: 'orig' });
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(earns().map((e) => e.receiptId)).toEqual(['orig']);
  });

  test('b) die Bon-Runde zahlt zuerst das Original, danach gibt ein Mensch die Kopie frei → festgehalten mit frischem Vermerk, 1 Gutschrift', async () => {
    await kopieGegenOffenesOriginal();
    expect(bon('kopie').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'bild', gegen: 'orig', offen: true })]);
    expect((await entscheiden('orig')).body).toMatchObject({ ok: true, status: 'approved' });

    const r = await entscheiden('kopie');
    expect(r.code).toBe(409);
    expect(r.body).toEqual({ code: 'halten', reviewReason: D.BILD_GRUND, regel: 'bild', gegen: 'orig' });
    const treffer = bon('kopie').doppelPruefung.treffer;
    expect(treffer).toEqual([expect.objectContaining({ regel: 'bild', gegen: 'orig', modus: 'wirksam' })]);
    // Der veraltete Vermerk „noch nicht entschieden" ist ersetzt.
    expect(treffer[0].offen).toBeUndefined();
    expect(earns().map((e) => e.receiptId)).toEqual(['orig']);
    // Der Mensch sieht jetzt das bezahlte Original und lehnt ab.
    expect((await entscheiden('kopie', 'reject')).body).toMatchObject({ ok: true, status: 'rejected' });
    expect(earns().map((e) => e.receiptId)).toEqual(['orig']);
  });

  test('c) Original noch ocr_pending: Freigabe der Kopie hält fest; danach zahlt die Pipeline das Original → 1 Gutschrift', async () => {
    config(ALLE);
    bonAnlegen('orig');
    // Kein Kehrlauf mehr möglich → die Kopie geht sofort in die Prüfung.
    bonAnlegen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich('orig'), extra: { sweepCount: 5 } });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_OFFEN_GRUND });

    const r1 = await entscheiden('kopie');
    expect(r1.body).toMatchObject({ code: 'halten', reviewReason: D.BILD_OFFEN_GRUND });
    expect(earns()).toHaveLength(0);

    await verarbeiten('orig');
    expect(bon('orig').status).toBe('approved');
    const r2 = await entscheiden('kopie');
    expect(r2.body).toMatchObject({ code: 'halten', reviewReason: D.BILD_GRUND });
    expect(earns().map((e) => e.receiptId)).toEqual(['orig']);
  });

  test('Original abgelehnt → die Freigabe der Kopie bucht (ein Einkauf, eine Gutschrift)', async () => {
    await kopieGegenOffenesOriginal();
    expect((await entscheiden('orig', 'reject')).body).toMatchObject({ ok: true, status: 'rejected' });
    expect((await entscheiden('kopie')).body).toMatchObject({ ok: true, status: 'approved', creditedCents: 8 });
    expect(earns().map((e) => e.receiptId)).toEqual(['kopie']);
  });
});

// ─── 2 ────────────────────────────────────────────────────────────────────
describe('2 — cashback_config/v1 nicht lesbar', () => {
  // Bon b ist ein zweites Foto von a, Datum −1 Tag gelesen (Vorprüfung 5b
  // greift nicht, Regel datum schon).
  async function lauf() {
    config(ALLE);
    bonAnlegen('a', { zeit: '11:05' });
    await verarbeiten('a');
    bonAnlegen('b', { zeit: '11:05', datum: VORGESTERN });
  }

  test('Kontrolle: lesbar → Regel datum lehnt ab', async () => {
    await lauf();
    await verarbeiten('b');
    expect(bon('b')).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_self' });
    expect(earns().map((e) => e.receiptId)).toEqual(['a']);
  });

  test('Lesefehler → kein Rückfall auf DEFAULT_CONFIG: nichts gebucht, Neuversuch; nach den Versuchen Prüfung config_unavailable', async () => {
    await lauf();
    fake.fehler.add('cashback_config/v1');
    await expect(verarbeiten('b')).rejects.toMatchObject({ code: 'config_unavailable' });
    expect(bon('b')).toMatchObject({ status: 'ocr_pending', attempts: 1 });
    expect(earns().map((e) => e.receiptId)).toEqual(['a']);
    expect(fake.store.get(`users/${A}/cashback_status/b`)).toBeUndefined();

    for (let i = 2; i <= 4; i++) await expect(verarbeiten('b')).rejects.toMatchObject({ code: 'config_unavailable' });
    await verarbeiten('b'); // 5. Versuch: Prüfung statt Ablehnung, kein Wurf
    expect(bon('b')).toMatchObject({ status: 'review', reviewReason: 'config_unavailable', attempts: 5 });
    expect(fake.store.get(`users/${A}/cashback_status/b`)).toMatchObject({ status: 'review', reviewReason: 'config_unavailable' });
    expect(earns().map((e) => e.receiptId)).toEqual(['a']);
    // Die Bon-Runde fasst den technischen Grund nicht an.
    expect(bearbeitbar(bon('b'))).toBe(false);

    // Konfiguration wieder lesbar. Freigeben lässt sich der Bon nicht (kein
    // Betrag berechnet, wie bei ocr_unavailable); erneut verarbeitet greifen
    // die Doppel-Regeln.
    fake.fehler.delete('cashback_config/v1');
    expect((await entscheiden('b')).body).toEqual({ code: 'no_cashback_computed', reviewReason: 'config_unavailable' });
    fake.store.set('receipts/b', { ...bon('b'), status: 'ocr_pending', attempts: 0 });
    await verarbeiten('b');
    expect(bon('b')).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_self' });
    expect(earns().map((e) => e.receiptId)).toEqual(['a']);
  });
});

// ─── 3 ────────────────────────────────────────────────────────────────────
describe('3 — Deploy-Stand (keine Doppel-Schalter in cashback_config/v1)', () => {
  test('zwei Fotos desselben Bons gleichzeitig verarbeitet (Kaufland 04.10.) → 1 Gutschrift', async () => {
    bonAnlegen('k1');
    bonAnlegen('k2');
    await Promise.all([verarbeiten('k1'), verarbeiten('k2')]);
    expect(earns()).toHaveLength(1);
    expect(['k1', 'k2'].map((id) => bon(id).status).sort()).toEqual(['approved', 'rejected']);
    const zwilling = ['k1', 'k2'].find((id) => bon(id).status === 'rejected');
    expect(bon(zwilling)).toMatchObject({ rejectReason: 'duplicate_content_self', duplicateOf: { kind: 'summe' } });
  });

  test("Kontrolle: doppelSumme ausdrücklich false → wie vor dem Zweig zwei Gutschriften (der Fall war echt)", async () => {
    config({ doppelSumme: false });
    bonAnlegen('k1');
    bonAnlegen('k2');
    await Promise.all([verarbeiten('k1'), verarbeiten('k2')]);
    expect(earns()).toHaveLength(2);
  });
});

// ─── 4 ────────────────────────────────────────────────────────────────────
describe('4 — Regel bild außerhalb von ±8 Tagen', () => {
  test('Original vor 15 Tagen bezahlt, Kopie mit Datum gestern (Anteil 0,9) → Prüfung, 1 Gutschrift', async () => {
    config(ALLE);
    fake.store.set('cashback_campaigns/c1', { ...fake.store.get('cashback_campaigns/c1'), maxAgeDays: 30 });
    bonAnlegen('orig', { datum: vorTagen(15) });
    await verarbeiten('orig');
    expect(bon('orig').status).toBe('approved');
    fake.store.set('cashback_campaigns/c1', { ...fake.store.get('cashback_campaigns/c1'), maxAgeDays: 7 });
    bonAnlegen('kopie', { zeit: '12:31', datum: GESTERN, items: KOPIE, capture: aehnlich('orig') });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(bon('kopie').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'bild', gegen: 'orig', abstand: 14, anteil: 0.9 })]);
    expect(earns().map((e) => e.receiptId)).toEqual(['orig']);
  });

  test('ebenso auf dem Prüfpfad (Kopie mit niedriger Lese-Sicherheit): Prüfgrund bild statt ocr_confidence_low', async () => {
    config({ ...ALLE, ocrFieldGate: false });
    fake.store.set('cashback_campaigns/c1', { ...fake.store.get('cashback_campaigns/c1'), maxAgeDays: 30 });
    bonAnlegen('orig', { datum: vorTagen(15) });
    await verarbeiten('orig');
    bonAnlegen('kopie', { zeit: '12:31', datum: GESTERN, items: KOPIE, confidence: 'low', capture: aehnlich('orig') });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(bearbeitbar(bon('kopie'))).toBe(false);
  });

  test('offenes Original 12 Tage daneben, Anteil 0,9 → die Kopie wartet', async () => {
    config(ALLE);
    bonAnlegen('orig', { datum: vorTagen(13), confidence: 'low' });
    fake.store.set('receipts/orig', { ...bon('orig'), status: 'review', bonDate: vorTagen(13), merchant: { id: 'kaufland' } });
    bonAnlegen('kopie', { zeit: '12:31', datum: GESTERN, items: KOPIE, capture: aehnlich('orig') });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'ocr_pending', bildWartet: { gegen: 'orig', versuche: 1 } });
    expect(earns()).toHaveLength(0);
  });

  test('bildTrifft/bildAnteil: im Fenster immer, außerhalb nur ab 0,8 (bzw. der höheren Schwelle)', () => {
    const neu = D.identitaet({ merchantId: 'kaufland', bonDate: '2026-10-05', totalCents: 1000, items: KOPIE });
    const alt = D.identitaet({ merchantId: 'kaufland', bonDate: '2026-09-20', totalCents: 1000, items: ZEHN });
    const anteil = D.bildAnteil(neu, alt, D.doppelModi({}));
    expect(anteil).toBe(0.9);
    expect(D.bildTrifft(neu, { tag: '2026-09-28', anteil: 0 })).toEqual({ abstand: 7 });
    expect(D.bildTrifft(neu, { tag: '2026-09-20', anteil })).toEqual({ abstand: 15, fern: true });
    expect(D.bildTrifft(neu, { tag: '2026-09-20', anteil: 0.79 })).toBeNull();
    expect(D.bildTrifft(neu, { tag: '2026-09-20', anteil: null })).toBeNull();
    expect(D.bildTrifft(neu, { tag: '2026-09-20', anteil }, { schwelle: 0.95 })).toBeNull();
    // Markt egal (Regel bild ist marktunabhängig).
    expect(D.bildAnteil(neu, { ...alt, markt: null }, D.doppelModi({}))).toBe(0.9);
  });
});

// ─── 5 ────────────────────────────────────────────────────────────────────
describe('5 — Teile eines Belegs mit gemischter Belegart (Online-Rechnung + App-Bon)', () => {
  test('Kontrolle: beide Online-Bestellung → Regel seite lehnt ab', async () => {
    teil('p1', { belegart: 'online_bestellung', items: S1 });
    await verarbeiten('p1');
    teil('p2', { belegart: 'online_bestellung', items: S2 });
    await verarbeiten('p2');
    expect(bon('p2')).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_self' });
    expect(earns()).toHaveLength(1);
  });

  test("Deploy-Stand (seiteAbweichend 'shadow'): bezahlt, der Treffer steht mit abweichend belegart am Bon", async () => {
    teil('p1', { belegart: 'online_bestellung', items: S1 });
    await verarbeiten('p1');
    teil('p2', { belegart: 'app_kassenbon', items: S2 });
    await verarbeiten('p2');
    expect(bon('p2').status).toBe('approved');
    expect(bon('p2').doppelPruefung.treffer).toEqual([
      expect.objectContaining({ regel: 'seiteAbweichend', gegen: 'p1', abweichend: ['belegart'], modus: 'beobachtung' }),
    ]);
  });

  test('scharf (doppelSeiteAbweichend: true): Prüfung seite_abweichend, 1 Gutschrift', async () => {
    config({ ...ALLE, doppelSeiteAbweichend: true });
    teil('p1', { belegart: 'online_bestellung', items: S1 });
    await verarbeiten('p1');
    teil('p2', { belegart: 'app_kassenbon', items: S2 });
    await verarbeiten('p2');
    expect(bon('p2')).toMatchObject({ status: 'review', reviewReason: D.SEITE_GRUND });
    expect(bearbeitbar(bon('p2'))).toBe(false);
    expect(earns().map((e) => e.receiptId)).toEqual(['p1']);
  });

  test('doppelUrteil: gemischte Art mit gedruckter Summe auf beiden Seiten → kein Treffer (zwei vollständige Belege)', () => {
    const modi = D.doppelModi({ doppelSeiteAbweichend: true });
    const neu = D.identitaet({ merchantId: 'dm', bonDate: '2026-10-05', totalCents: 500, items: S2, belegart: 'app_kassenbon' });
    const online = D.eintragAus(D.identitaet({ merchantId: 'dm', bonDate: '2026-10-05', totalCents: 700, items: S1, online: true }));
    expect(D.doppelUrteil({ bonId: 'n', uid: A, neu, andere: [{ id: 'o', eintrag: online }], modi }).treffer).toEqual([]);
    const ohne = D.eintragAus(D.identitaet({ merchantId: 'dm', bonDate: '2026-10-05', totalCents: 700, items: S1, online: true, summeAusArtikeln: true }));
    expect(D.doppelUrteil({ bonId: 'n', uid: A, neu, andere: [{ id: 'o', eintrag: ohne }], modi }).wirksam)
      .toMatchObject({ regel: 'seiteAbweichend', abweichend: ['belegart'] });
  });
});
