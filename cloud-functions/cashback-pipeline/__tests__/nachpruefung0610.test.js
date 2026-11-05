'use strict';

/**
 * Nachprüfung 06.10.2026 (claude/bon-doppelzahlung, Befunde zum Prompt-
 * Schalter). Jeder Fall läuft mit dem ECHTEN index.js gegen die Firestore-
 * Attrappe bzw. mit den reinen Regeln aus lib/doppelBon.js.
 *
 *   1  Bestandsschutz: eine verworfene Neulesung eines bezahlten Bons
 *      überschrieb dessen Kennung (contentHash, transactionHash, Datum, Markt …)
 *      — danach wurde ein neues Foto desselben Bons ein zweites Mal bezahlt.
 *   2  Coupon-/Leergut-Zeile als Hebel: nur Rabattzeile und Endsumme geändert,
 *      kein Artikel — Regel datum über die Summe der positiven Artikel.
 *   3  Prompt-Wechsel v1.4 → v1.5: der Personen-Index vergleicht bei einem
 *      Warenkorb-Rabatt auch die Artikelnamen (ab Tag 9).
 *   4  Größenbremse des Personen-Index.
 *   5  Regel seiteAbweichend: seite träfe, nur Uhrzeit, Bestellnummer bzw.
 *      (App) der Tag weichen ab — Beobachtung per Default, scharf → Prüfung.
 *   6  Standard-Prompt v1.4: Regel seite sieht keine Abschnitte (festgehalten).
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
const MAERKTE = { netto: 'Netto Marken-Discount', kaufland: 'Kaufland', dm: 'dm-drogerie markt', lidl: 'Lidl', rossmann: 'Rossmann' };

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

const DREI = vorTagen(3);
const ACHT = ['Shampoo', 'Duschgel', 'Zahnpasta', 'Deo Roller', 'Handseife', 'Wattepads', 'Bodylotion', 'Taschentuecher']
  .map((name, i) => ({ name, priceCents: 200 + i * 15, qty: 1 }));
const coupon = (cents) => ({ name: 'Coupon 10%', priceCents: -cents, qty: 1, category: 'Warenkorbrabatt' });

// ─── 1 ────────────────────────────────────────────────────────────────────
describe('1 — Bestandsschutz: die bezahlte Lesung bleibt am Bon', () => {
  const KENNUNG = ['contentHash', 'transactionHash', 'itemsHash', 'bonDate', 'bonTime', 'bonTotalCents', 'merchant', 'items', 'store'];
  const lesungVon = (o) => ocrVon({ markt: 'netto', zeit: '10:15', ...o });
  const neulesungen = [
    ['Datum als 20 Tage alt gelesen', () => lesungVon({ datum: vorTagen(20) })],
    ['Markt unlesbar', () => lesungVon({ parsed: { merchant: null } })],
    // Abgleich geht nicht auf (Summe 9 € daneben) → Ablehnung reconciliation_delta.
    ['Summe verlesen (+9 €)', () => ({
      ...lesungVon({ total: summe(ZEHN) + 900 }),
      reconciliation: { ok: false, sumItemsCents: summe(ZEHN), deltaCents: 900, signedDeltaCents: 900, direction: 'overshoot' },
    })],
  ];
  test.each(neulesungen.flatMap(([n, l]) => [[`${n}, Schalter aus`, l, {}], [`${n}, alle Schalter`, l, ALLE]]))(
    '%s: Bon bleibt bezahlt MIT seiner Kennung, ein neues Foto wird abgelehnt', async (_n, lesung, schalter) => {
      config(schalter);
      bonAnlegen('a', { markt: 'netto', zeit: '10:15' });
      await verarbeiten('a');
      const vorher = bon('a');
      expect(vorher.status).toBe('approved');
      const spiegelVorher = fake.store.get(`users/${A}/cashback_status/a`);
      const posVorher = positionen(A, 'a');
      expect(posVorher.length).toBeGreaterThan(0);

      // Nachverarbeitung mit frischer, abweichender Lesung.
      fake.store.set('receipts/a', { ...vorher, status: 'ocr_pending', ocr: lesung() });
      await verarbeiten('a');
      const nachher = bon('a');
      expect(nachher).toMatchObject({ status: 'approved', cashbackCents: 8, rejectReason: null, reviewReason: null });
      for (const f of KENNUNG) expect([f, nachher[f]]).toEqual([f, vorher[f]]);
      expect(nachher.neulesungVerworfen).toMatchObject({ waereStatus: expect.any(String) });
      expect(nachher.neulesungVerworfen.grund).toBeTruthy();
      // Spiegel: Lesung unverändert, Status bezahlt.
      const spiegel = fake.store.get(`users/${A}/cashback_status/a`);
      expect(spiegel).toMatchObject({ status: 'approved', cashbackCents: 8, rejectReason: null });
      for (const f of ['items', 'bonDate', 'bonTotalCents', 'merchantId', 'merchantRaw']) expect([f, spiegel[f]]).toEqual([f, spiegelVorher[f]]);
      // Keine Positionen der verworfenen Lesung.
      expect(positionen(A, 'a')).toEqual(posVorher);
      expect(ledger().filter((l) => l.type === 'reverse')).toHaveLength(0);
      // Die Gutschrift-Identität (Personen-Index) liest die bezahlte Lesung.
      expect(D.identitaetAusBon(nachher)).toMatchObject({ tag: vorher.bonDate, summe: vorher.bonTotalCents, markt: 'netto' });

      // Neues Foto desselben Bons (Lesung wie das Original).
      bonAnlegen('b', { markt: 'netto', zeit: '10:15' });
      await verarbeiten('b');
      expect(bon('b')).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_self' });
      expect(earns()).toHaveLength(1);
      expect(fake.store.get(`users/${A}`).cashback_balance_cents).toBe(8);
    },
  );

  test('eine spätere normale Ablage (Lesung wieder angenommen) räumt den Vermerk', async () => {
    bonAnlegen('a', { markt: 'netto', zeit: '10:15' });
    await verarbeiten('a');
    const vorher = bon('a');
    fake.store.set('receipts/a', { ...vorher, status: 'ocr_pending', ocr: ocrVon({ markt: 'netto', zeit: '10:15', datum: vorTagen(20) }) });
    await verarbeiten('a');
    expect(bon('a').neulesungVerworfen).toBeTruthy();
    fake.store.set('receipts/a', { ...bon('a'), status: 'ocr_pending', ocr: ocrVon({ markt: 'netto', zeit: '10:15' }) });
    await verarbeiten('a');
    expect(bon('a').status).toBe('approved');
    expect(bon('a').neulesungVerworfen).toBeUndefined();
    expect(earns()).toHaveLength(1);
  });

  test('identitaetAusBon: mit Vermerk gelten die Felder des Bons, nicht `ocr`', () => {
    const b = {
      merchant: { id: 'netto' }, bonDate: '2026-10-01', bonTime: '10:15', bonTotalCents: 1450,
      items: ZEHN.map((it) => ({ raw: it.name, priceCents: it.priceCents })),
      ocr: { parsed: { bonDate: '2026-09-11', bonTime: '10:15', totalCents: 1450, items: [{ name: 'Wein', priceCents: 1450 }] } },
    };
    expect(D.identitaetAusBon(b).artikel).toEqual(['wein#1450']);
    const mitVermerk = D.identitaetAusBon({ ...b, neulesungVerworfen: { grund: 'bon_too_old' } });
    expect(mitVermerk).toMatchObject({ tag: '2026-10-01', summe: 1450 });
    expect(mitVermerk.artikel).toHaveLength(10);
  });
});

// ─── 2 ────────────────────────────────────────────────────────────────────
describe('2 — Coupon-/Leergut-Zeile eingefügt oder geändert (Regel datum, Positivsumme)', () => {
  const MIT_COUPON = [...ACHT, coupon(200)];

  test.each([
    ['3 Tage (Tageszähler)', DREI, 2],
    ['20 Tage (Personen-Index)', vorTagen(21), 20],
  ])('Kopie %s später, Uhrzeit verdeckt, Coupon −1,50 statt −2,00 → abgelehnt', async (_n, datumOriginal, hochgeladen) => {
    config(ALLE);
    bonAnlegen('orig', { markt: 'rossmann', zeit: '10:15', datum: datumOriginal, items: MIT_COUPON, hochgeladenVorTagen: hochgeladen });
    await verarbeiten('orig');
    expect(bon('orig').status).toBe('approved');
    const kopie = [...ACHT, coupon(150)];
    bonAnlegen('kopie', { markt: 'rossmann', zeit: null, datum: GESTERN, items: kopie });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_self', duplicateOf: { receiptId: 'orig', kind: 'datum' } });
    expect(earns()).toHaveLength(1);
  });

  test('dasselbe unter v1.4 mit eingefügter Leergut-Zeile (20 Tage)', async () => {
    config(ALLE);
    bonAnlegen('orig', { markt: 'kaufland', zeit: '09:12', datum: vorTagen(21), items: ACHT, hochgeladenVorTagen: 20 });
    await verarbeiten('orig');
    bonAnlegen('kopie', { markt: 'kaufland', zeit: null, datum: GESTERN, items: [...ACHT, { name: 'Leergut', priceCents: -25, qty: 1 }] });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'rejected', duplicateOf: { kind: 'datum' } });
    expect(earns()).toHaveLength(1);
  });

  test('Gegenprobe: gleiche Positivsumme, aber andere Artikel → kein Treffer', () => {
    const modi = D.doppelModi({ doppelDatum: true });
    const alt = D.identitaet({ merchantId: 'rossmann', bonDate: DREI, totalCents: 1800, bonTime: '10:15', items: MIT_COUPON });
    const andere = ACHT.map((it, i) => ({ ...it, name: `Anderes${i}` }));
    const neu = D.identitaet({ merchantId: 'rossmann', bonDate: GESTERN, totalCents: 1850, bonTime: null, items: [...andere, coupon(150)] });
    expect(neu.positivSumme).toBe(alt.positivSumme);
    expect(D.doppelUrteil({ bonId: 'n', uid: A, neu, andere: [{ id: 'a', eintrag: D.eintragAus(alt), tag: DREI }], modi }).treffer).toEqual([]);
    expect(D.personKandidaten({ bonId: 'n', neu, eintraege: { a: { l: [D.personLesungAus(alt)] } }, modi })).toEqual([]);
  });

  test('Personen-Index trägt Positivsumme, Namens-Hashes und den Rabatt-Vermerk', () => {
    const l = D.personLesungAus(D.identitaet({ merchantId: 'rossmann', bonDate: DREI, totalCents: summe(MIT_COUPON), bonTime: '10:15', items: MIT_COUPON }));
    expect(l).toMatchObject({ s: summe(MIT_COUPON), as: summe(MIT_COUPON), ps: summe(ACHT), k: true });
    expect(summe(ACHT) - summe(MIT_COUPON)).toBe(200);
    expect(l.n).toHaveLength(8);
    const ohne = D.personLesungAus(D.identitaet({ merchantId: 'kaufland', bonDate: DREI, items: ACHT }));
    expect(ohne.k).toBeUndefined();
  });
});

// ─── 3 ────────────────────────────────────────────────────────────────────
describe('3 — Prompt-Wechsel v1.4 → v1.5: Coupon-Bon über den Personen-Index', () => {
  // v1.4 rechnete 10 % Coupon in die Preise ein, v1.5 liest die gedruckten
  // Preise und den Coupon als eigene Zeile.
  const BRUTTO = ZEHN.map((it) => ({ ...it, priceCents: it.priceCents + 100 }));
  const NETTO = BRUTTO.map((it) => ({ ...it, priceCents: Math.round(it.priceCents * 0.9) }));
  const RABATT = summe(BRUTTO) - summe(NETTO);

  test('Kopie unter v1.5, 20 Tage später, Uhrzeit verdeckt, Endsumme +1 € → abgelehnt', async () => {
    config(ALLE);
    bonAnlegen('v14', { markt: 'rossmann', zeit: '10:15', datum: vorTagen(21), items: NETTO, hochgeladenVorTagen: 20 });
    await verarbeiten('v14');
    expect(bon('v14').status).toBe('approved');
    const v15 = [...BRUTTO, coupon(RABATT)];
    expect(summe(v15)).toBe(summe(NETTO));
    bonAnlegen('v15', { markt: 'rossmann', zeit: null, datum: GESTERN, items: v15, total: summe(NETTO) + 100 });
    await verarbeiten('v15');
    expect(bon('v15')).toMatchObject({ status: 'rejected', rejectReason: 'duplicate_content_self', duplicateOf: { receiptId: 'v14', kind: 'datum' } });
    expect(bon('v15').doppelPruefung.treffer).toEqual(expect.arrayContaining([expect.objectContaining({ regel: 'datum', quelle: 'person', gegen: 'v14' })]));
    expect(earns()).toHaveLength(1);
  });

  test('ohne Namens-Hashes (Eintrag vor dem Nachtrag) kein Treffer — darum .backfill-doppel-person.js vor dem Umschalten', () => {
    const modi = D.doppelModi({ doppelDatum: true });
    const alt = D.personLesungAus(D.identitaet({ merchantId: 'rossmann', bonDate: vorTagen(21), totalCents: summe(NETTO), bonTime: '10:15', items: NETTO }));
    const neu = D.identitaet({ merchantId: 'rossmann', bonDate: GESTERN, totalCents: summe(NETTO) + 100, bonTime: null, items: [...BRUTTO, coupon(RABATT)] });
    expect(D.personKandidaten({ bonId: 'n', neu, eintraege: { a: { l: [alt] } }, modi })).toEqual([expect.objectContaining({ id: 'a', anteil: 1 })]);
    const { n, ...ohneNamen } = alt;
    expect(n).toHaveLength(10);
    expect(D.personKandidaten({ bonId: 'n', neu, eintraege: { a: { l: [ohneNamen] } }, modi })).toEqual([]);
  });

  test('Gegenprobe: Namensvergleich nur mit Warenkorb-Rabatt auf einer Seite', () => {
    const modi = D.doppelModi({ doppelDatum: true });
    const alt = D.personLesungAus(D.identitaet({ merchantId: 'rossmann', bonDate: vorTagen(21), totalCents: summe(NETTO), bonTime: '10:15', items: NETTO }));
    // Gleiche Namen, andere Preise, KEIN Rabatt, gleiche Artikelsumme → nicht über Namen.
    const verschoben = BRUTTO.map((it, i) => ({ ...it, priceCents: NETTO[i].priceCents + (i % 2 ? 1 : -1) }));
    const neu = D.identitaet({ merchantId: 'rossmann', bonDate: GESTERN, totalCents: summe(verschoben), bonTime: null, items: verschoben });
    expect(D.personKandidaten({ bonId: 'n', neu, eintraege: { a: { l: [alt] } }, modi })).toEqual([]);
  });
});

// ─── 4 ────────────────────────────────────────────────────────────────────
describe('4 — Größenbremse des Personen-Index', () => {
  const lesung = (t, i) => D.personLesungAus(D.identitaet({
    merchantId: 'kaufland', bonDate: t, totalCents: 5000 + i, bonTime: '10:15',
    items: Array.from({ length: 90 }, (_, k) => ({ name: `Artikel${i}x${k}`, priceCents: 100 + k })),
  }));

  test('speicherGroesse folgt den Firestore-Regeln', () => {
    expect(D.speicherGroesse('abc')).toBe(4);
    expect(D.speicherGroesse(12)).toBe(8);
    expect(D.speicherGroesse(null)).toBe(1);
    expect(D.speicherGroesse({ ab: [true, 'x'] })).toBe(3 + 1 + 2);
  });

  test('300 volle Bons mit je 2 Lesungen, Grenze 500 KB: die ältesten fallen bis unter die Grenze, der eigene nie', () => {
    const e = {};
    for (let i = 0; i < D.MAX_PERSON_EINTRAEGE; i++) {
      const t = vorTagen(1 + (i % 90));
      e[`bon_${String(i).padStart(4, '0')}`] = { l: [lesung(t, i), lesung(vorTagen(2 + (i % 90)), i + 1000)] };
    }
    const groesse = (ids) => ids.reduce((s, id) => s + id.length + 1 + D.speicherGroesse(e[id]), 0);
    const alle = Object.keys(e);
    // Volle Lesungen (80 Artikel-, 40 Namens-Hashes) wiegen ~1,15 KB — 300 Bons
    // mit je 2 Lesungen liegen damit knapp unter der Standardgrenze; gemessen
    // wird die Bremse hier mit einer kleineren.
    expect(groesse(alle)).toBeGreaterThan(600_000);
    // Standardgrenze: nur die Anzahlbremse (300 + neu) — genau einer der ältesten.
    const standard = D.personAufraeumen(e, vorTagen(0), 'neu');
    expect(standard).toHaveLength(1);
    expect(['bon_0089', 'bon_0179', 'bon_0269']).toContain(standard[0]);
    const eigen = 'bon_0089'; // einer der ältesten (vorTagen(90))
    const weg = D.personAufraeumen(e, vorTagen(0), eigen, { neuWert: e[eigen], maxBytes: 500_000 });
    expect(weg).not.toContain(eigen);
    expect(weg.length).toBeGreaterThan(50);
    const bleiben = alle.filter((id) => !weg.includes(id));
    expect(groesse(bleiben)).toBeLessThanOrEqual(500_000);
    // Es fallen die ältesten (jüngste Lesung am weitesten zurück).
    const juengste = (id) => e[id].l.map((x) => x.t).sort().pop();
    const aeltesteBleibende = bleiben.filter((id) => id !== eigen).map(juengste).sort()[0];
    for (const id of weg) expect(juengste(id) <= aeltesteBleibende).toBe(true);
  });

  test('kleine Dokumente: die Bremse greift nicht', () => {
    expect(D.personAufraeumen({ a: { l: [lesung(GESTERN, 1)] } }, vorTagen(0), 'b', { neuWert: { l: [lesung(GESTERN, 2)] } })).toEqual([]);
  });
});

// ─── 5 ────────────────────────────────────────────────────────────────────
describe('5 — Regel seiteAbweichend', () => {
  const id = (o) => D.identitaet({ merchantId: 'lidl', bonDate: GESTERN, items: T1, ...o });

  test('rein: nur Uhrzeit bzw. Bestellnummer verschieden → seiteAbweichend, nie seite', () => {
    const modi = D.doppelModi({});
    const neu = id({ belegart: 'app_kassenbon', summeAusArtikeln: true, bonTime: '18:40' });
    const alt = D.eintragAus(D.identitaet({ merchantId: 'lidl', bonDate: GESTERN, items: T2, bonTime: '18:32', belegart: 'app_kassenbon' }));
    const u = D.doppelUrteil({ bonId: 'n', uid: A, neu, andere: [{ id: 'a', eintrag: alt }], modi });
    expect(u.wirksam).toBeNull();
    expect(u.treffer).toEqual([expect.objectContaining({ regel: 'seiteAbweichend', abweichend: ['uhrzeit'], app: true, modus: 'beobachtung' })]);

    const onNeu = D.identitaet({ merchantId: 'dm', bonDate: GESTERN, items: T1, online: true, summeAusArtikeln: true, bestellnummer: 'DM-123456780' });
    const onAlt = D.eintragAus(D.identitaet({ merchantId: 'dm', bonDate: GESTERN, items: T2, online: true, bestellnummer: 'DM-123456789' }));
    const scharf = D.doppelModi({ doppelSeiteAbweichend: true });
    const v = D.doppelUrteil({ bonId: 'n', uid: A, neu: onNeu, andere: [{ id: 'a', eintrag: onAlt }], modi: scharf });
    expect(v.wirksam).toMatchObject({ regel: 'seiteAbweichend', abweichend: ['bestellnummer'] });
    expect(D.grundFuer(v.wirksam)).toBe('seite_abweichend');
    expect(D.nurPruefung('seiteAbweichend')).toBe(true);
    expect(D.nurPruefung('seite')).toBe(false);
  });

  test('rein: zwei vollständige Belege (beide mit Summe) → nichts; seite-Treffer verdrängt seiteAbweichend', () => {
    const modi = D.doppelModi({ doppelSeiteAbweichend: true });
    const neu = id({ belegart: 'app_kassenbon', bonTime: '18:40', totalCents: summe(T1) });
    const alt = D.eintragAus(D.identitaet({ merchantId: 'lidl', bonDate: GESTERN, items: T2, bonTime: '18:32', totalCents: summe(T2), belegart: 'app_kassenbon' }));
    expect(D.doppelUrteil({ bonId: 'n', uid: A, neu, andere: [{ id: 'a', eintrag: alt }], modi }).treffer).toEqual([]);
    const ohneZeit = id({ belegart: 'app_kassenbon', summeAusArtikeln: true });
    expect(D.doppelUrteil({ bonId: 'n', uid: A, neu: ohneZeit, andere: [{ id: 'a', eintrag: alt }], modi }).treffer.map((t) => t.regel)).toEqual(['seite']);
  });

  test('Code-Default: Abschnitt mit geänderter Uhrzeit wird bezahlt, der Treffer nur vermerkt', async () => {
    ohneSumme('s1', { markt: 'lidl', zeit: '18:32', items: T1 });
    await verarbeiten('s1');
    ohneSumme('s2', { markt: 'lidl', zeit: '18:40', items: T2 });
    await verarbeiten('s2');
    expect(bon('s2').status).toBe('approved');
    expect(bon('s2').doppelPruefung.treffer).toEqual([expect.objectContaining({ regel: 'seiteAbweichend', modus: 'beobachtung', gegen: 's1' })]);
    expect(bon('s2').doppelPruefung.modi.seiteAbweichend).toBe('shadow');
    expect(earns()).toHaveLength(2);
  });

  test.each([
    ['Uhrzeit geändert, selber Tag', { zeit: '18:40' }],
    ['App-Abschnitt mit Datum 1 Tag daneben', { zeit: null, datum: VORGESTERN }],
  ])('scharf: %s → Prüfung statt Gutschrift; eine Freigabe über den Resolver bucht', async (_n, zweiter) => {
    config({ doppelSeiteAbweichend: true });
    ohneSumme('s1', { markt: 'lidl', zeit: '18:32', items: T1 });
    await verarbeiten('s1');
    ohneSumme('s2', { markt: 'lidl', items: T2, ...zweiter });
    await verarbeiten('s2');
    expect(bon('s2')).toMatchObject({ status: 'review', reviewReason: 'seite_abweichend', rejectReason: null });
    expect(fake.store.get(`users/${A}/cashback_status/s2`).status).toBe('review');
    expect(earns()).toHaveLength(1);
    expect(global.__pushes).toHaveLength(1);
    // Ein Mensch entscheidet: Freigabe bucht (die Regel wird dort nur beobachtet).
    const res = await entscheiden('s2');
    expect(res.body).toMatchObject({ ok: true, status: 'approved' });
    expect(earns()).toHaveLength(2);
  });

  test('scharf, App-Abschnitt 2 Tage daneben → keine Prüfung (nur ±1 Tag)', async () => {
    config({ doppelSeiteAbweichend: true });
    ohneSumme('s1', { markt: 'lidl', zeit: null, items: T1, datum: vorTagen(3) });
    await verarbeiten('s1');
    ohneSumme('s2', { markt: 'lidl', zeit: null, items: T2, datum: GESTERN });
    await verarbeiten('s2');
    expect(bon('s2').status).toBe('approved');
    expect(earns()).toHaveLength(2);
  });
});

// ─── 6 ────────────────────────────────────────────────────────────────────
describe('6 — Standard-Prompt v1.4: Regel seite sieht keine Abschnitte (bekannt, festgehalten)', () => {
  test('zwei Scrollbilder unter v1.4 (keine Belegart, Summe = Artikelsumme) werden beide bezahlt', async () => {
    // v1.4 setzt die Artikelsumme selbst als Endbetrag ein, ungekennzeichnet.
    bonAnlegen('v1', { markt: 'lidl', zeit: null, items: T1 });
    await verarbeiten('v1');
    bonAnlegen('v2', { markt: 'lidl', zeit: null, items: T2 });
    await verarbeiten('v2');
    expect(bon('v1').status).toBe('approved');
    expect(bon('v2').status).toBe('approved');
    expect(earns()).toHaveLength(2);
    // Unter v1.5 (Belegart + summeAusArtikeln) greift seite — siehe
    // nachpruefung0510b.test.js, A.
  });
});
