'use strict';

/**
 * Vierte Prüfrunde 06.10.2026 (claude/bon-doppelzahlung). Jeder Fall läuft mit
 * dem ECHTEN index.js gegen die Firestore-Attrappe.
 *
 *   1  Gemischte Kandidaten: die Kopie ähnelt einem bezahlten ANDEREN Einkauf
 *      und dem noch offenen Original. Der Grund stand auf
 *      `bild_aehnlich_bezahlt`; der Mensch sah einen anderen Einkauf und gab
 *      frei — der Resolver schaltete Regel bild für ALLE Kandidaten ab, buchte
 *      die Kopie, danach das Original. Zwei Gutschriften für einen Einkauf.
 *   2  bild und seiteAbweichend treffen zugleich: jede Freigabe schaltete nur
 *      die eine Regel ab, die andere hielt wieder fest — endlos, der zweite
 *      echte Einkauf wurde nie bezahlt.
 *   3  Gleichzeitiges Hochladen: die Bildprüfung sucht vor dem Anlegen, keine
 *      Seite sah die andere, kein `capture.bildAehnlich` — beide bezahlt.
 *
 * Fix 1/2: eine Freigabe quittiert die einzelnen Treffer, die der Mensch in
 * der Zeile „Doppel-Prüfung" sah (lib/doppelBon quittierteTreffer), im Stand
 * `doppelPruefung.at`, den die Prüfkonsole mitschickt. Offene Kandidaten und
 * neue Treffer halten weiter fest. Offene Bild-Kandidaten zuerst.
 * Fix 3: nach dem Anlegen ältere Bons mit nahem dHash nachtragen
 * (index.js gleichzeitigeBildKandidaten).
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

const sharp = require('sharp');
const admin = require('firebase-admin');
const fn = require('../index');
const D = require('../lib/doppelBon');
const { bearbeitbar } = require('../../review-console/src/bonRegeln');

const fake = admin.__fake;
const A = 'kontoA';
const TAG = 24 * 60 * 60 * 1000;
const SCHLUESSEL = 'admin-key';
const START = Date.now();
const berlinDatum = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
const vorTagen = (n) => berlinDatum(Date.now() - n * TAG);
const GESTERN = vorTagen(1);
const VORGESTERN = vorTagen(2);

const ZEHN = ['Milch', 'Brot', 'Butter', 'Käse', 'Eier', 'Apfel', 'Birne', 'Saft', 'Tee', 'Reis']
  .map((name, i) => ({ name, priceCents: 100 + i * 10, qty: 1 }));
// Ein ANDERER Einkauf derselben Person, ähnlich aussehender Bon.
const ANDERE = ['Wurst', 'Senf', 'Gurke', 'Ketchup', 'Chips', 'Cola', 'Bier', 'Wasser', 'Brezel', 'Eis']
  .map((name, i) => ({ name, priceCents: 200 + i * 10, qty: 1 }));
const summe = (items) => items.reduce((s, it) => s + it.priceCents, 0);
const MAERKTE = { kaufland: 'Kaufland', dm: 'dm' };
// Kopie des Originals: beschnitten (Feinvergleich bestätigt nicht), Datum −1,
// Uhrzeit geändert, ein Preis und die Endsumme +10 ct — keine Textregel greift.
const KOPIE = ZEHN.map((it, i) => (i === 0 ? { ...it, priceCents: it.priceCents + 10 } : it));
const aehnlich = (...kandidaten) => ({
  bildAehnlich: { kandidat: kandidaten[0], kandidaten, distanz: 2, ssim: 0.52, seitenDiff: 0.012, bestaetigt: false },
});
// Zwei Abschnitte EINES dm-App-Bons bzw. zwei Einkäufe (verschiedene Artikel, keine Summe).
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

const verarbeiten = (id, uid = A) =>
  fn.processCashback({ id: `ev-${id}-${Math.random()}`, data: { message: { json: { cashbackId: id, uid } } } });

function antwort() {
  const r = { code: 200, body: undefined };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
}

const standVon = (id) => {
  const dp = fake.store.get(`receipts/${id}`)?.doppelPruefung;
  return dp && dp.at && typeof dp.at.toMillis === 'function' ? dp.at.toMillis() : null;
};

/**
 * Entscheidung über den Resolver. Wie die Prüfkonsole schickt sie den Stand der
 * Zeile „Doppel-Prüfung" mit, den der Mensch sieht; `stand: null` = ohne
 * (Bon-Runde, Skript), eine Zahl = ein älterer, gesehener Stand.
 */
async function entscheiden(id, decision = 'approve', { stand } = {}) {
  const res = antwort();
  const s = stand === undefined ? standVon(id) : stand;
  await fn.resolveCashbackReview(
    { get: (h) => (h === 'x-admin-key' ? SCHLUESSEL : undefined), query: { receiptId: id, decision, ...(s != null ? { doppelStand: String(s) } : {}) } },
    res,
  );
  return res;
}

const ledger = (uid = A) =>
  [...fake.store.entries()].filter(([k]) => k.startsWith(`users/${uid}/cashback_ledger/`)).map(([, v]) => v);
const earns = (uid = A) => ledger(uid).filter((l) => l.type === 'earn');
const netto = (id, uid = A) => ledger(uid).filter((l) => l.receiptId === id)
  .reduce((s, l) => s + (l.type === 'earn' ? l.cents : l.type === 'reverse' ? -l.cents : 0), 0);
const bon = (id) => fake.store.get(`receipts/${id}`);
const trefferKurz = (id) => (bon(id).doppelPruefung?.treffer || [])
  .map((t) => `${t.regel}:${t.gegen}:${t.offen ? 'offen' : 'entschieden'}:${t.modus}`);

beforeEach(() => {
  fake.zuruecksetzen();
  fake.fehler.clear();
  fake.setzeJetzt(START);
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
describe('1 — Kopie ähnelt einem bezahlten ANDEREN Einkauf und dem offenen Original', () => {
  /** a1 bezahlt (anderer Einkauf), a2 = Original in der Prüfung (Lese-Sicherheit). */
  async function ausgangslage() {
    config(ALLE);
    bonAnlegen('a1', { datum: vorTagen(5), zeit: '09:00', items: ANDERE });
    await verarbeiten('a1');
    expect(bon('a1').status).toBe('approved');
    bonAnlegen('a2', { confidence: 'low' });
    await verarbeiten('a2');
    expect(bon('a2')).toMatchObject({ status: 'review', reviewReason: 'ocr_confidence_low' });
  }

  test('Nachstellung aus der Prüfung: die Kopie wartet auf das Original statt sofort als bild_aehnlich_bezahlt an einen Menschen zu gehen; am Ende 2 Gutschriften für 2 Einkäufe', async () => {
    await ausgangslage();
    bonAnlegen('b', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich('a2', 'a1') });
    await verarbeiten('b');
    expect(bon('b')).toMatchObject({ status: 'ocr_pending', bildWartet: { gegen: 'a2', versuche: 1 } });
    for (let i = 2; i <= 5; i++) await verarbeiten('b');
    expect(bon('b')).toMatchObject({ status: 'review', reviewReason: D.BILD_OFFEN_GRUND });
    expect(trefferKurz('b')).toEqual(['bild:a2:offen:wirksam', 'bild:a1:entschieden:wirksam']);

    // Mensch gibt trotzdem frei: hält fest, solange a2 offen ist — und quittiert
    // bei `bild_aehnlich_offen` auch a1 nicht („erst den offenen entscheiden").
    const r1 = await entscheiden('b');
    expect(r1.code).toBe(409);
    expect(r1.body).toEqual({ code: 'halten', reviewReason: D.BILD_OFFEN_GRUND, regel: 'bild', gegen: 'a2' });
    expect(trefferKurz('b')).toEqual(['bild:a2:offen:wirksam', 'bild:a1:entschieden:wirksam']);
    expect(earns().map((e) => e.receiptId)).toEqual(['a1']);

    // Die Bon-Runde gibt das Original frei (es trägt keinen Vermerk).
    expect(bearbeitbar(bon('a2'))).toBe(true);
    expect((await entscheiden('a2', 'approve', { stand: null })).body).toMatchObject({ ok: true, status: 'approved' });

    // Erneute Freigabe der Kopie: a2 ist jetzt bezahlt → festhalten, beide Zeilen zum Vergleich.
    const r2 = await entscheiden('b');
    expect(r2.body).toEqual({ code: 'halten', reviewReason: D.BILD_GRUND, regel: 'bild', gegen: 'a2' });
    expect(trefferKurz('b')).toEqual(['bild:a2:entschieden:wirksam', 'bild:a1:entschieden:wirksam']);
    // Der Mensch vergleicht mit a2: derselbe Einkauf → ablehnen.
    expect((await entscheiden('b', 'reject')).body).toMatchObject({ ok: true, status: 'rejected' });
    expect(earns().map((e) => e.receiptId)).toEqual(['a1', 'a2']);
  });

  test('Kopie mit niedriger Lese-Sicherheit (Prüfpfad): wartet ebenfalls auf das Original, danach bild_aehnlich_offen; die Freigabe hält fest', async () => {
    await ausgangslage();
    bonAnlegen('b', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, confidence: 'low', capture: aehnlich('a2', 'a1') });
    await verarbeiten('b');
    expect(bon('b')).toMatchObject({ status: 'ocr_pending', bildWartet: { gegen: 'a2', versuche: 1 } });
    for (let i = 2; i <= 5; i++) await verarbeiten('b');
    expect(bon('b')).toMatchObject({ status: 'review', reviewReason: D.BILD_OFFEN_GRUND });
    expect(bearbeitbar(bon('b'))).toBe(false);
    expect((await entscheiden('b')).body).toEqual({ code: 'halten', reviewReason: D.BILD_OFFEN_GRUND, regel: 'bild', gegen: 'a2' });
    expect((await entscheiden('a2', 'approve', { stand: null })).body).toMatchObject({ ok: true, status: 'approved' });
    expect((await entscheiden('b')).body).toMatchObject({ code: 'halten', reviewReason: D.BILD_GRUND, gegen: 'a2' });
    expect(earns().map((e) => e.receiptId)).toEqual(['a1', 'a2']);
  });

  test('Bestand mit dem alten Grund: Kopie steht als bild_aehnlich_bezahlt gegen a1 in der Prüfung, a2 offen → Freigabe hält mit bild_aehnlich_offen; nach a2 mit bild_aehnlich_bezahlt gegen a2', async () => {
    await ausgangslage();
    // So stand sie mit der Reihenfolge „bezahlte zuerst" am Bon.
    bonAnlegen('b', { zeit: '12:31', datum: VORGESTERN, items: KOPIE, capture: aehnlich('a2', 'a1') });
    fake.store.set('receipts/b', {
      ...bon('b'),
      status: 'review',
      reviewReason: D.BILD_GRUND,
      cashbackCents: 8,
      bonDate: VORGESTERN,
      merchant: { id: 'kaufland', name: 'Kaufland' },
      doppelPruefung: {
        modi: {},
        at: fake.zeit(START - 1000),
        treffer: [
          { regel: 'bild', gegen: 'a1', sameUser: true, modus: 'wirksam', abstand: 3 },
          { regel: 'bild', gegen: 'a2', sameUser: true, modus: 'wirksam', abstand: 1, offen: true },
        ],
      },
    });
    const r1 = await entscheiden('b');
    expect(r1.body).toEqual({ code: 'halten', reviewReason: D.BILD_OFFEN_GRUND, regel: 'bild', gegen: 'a2' });
    expect(earns().map((e) => e.receiptId)).toEqual(['a1']);
    expect(trefferKurz('b')).toContain('bild:a1:entschieden:quittiert');

    expect((await entscheiden('a2', 'approve', { stand: null })).body).toMatchObject({ ok: true, status: 'approved' });
    // Freigabe unter `bild_aehnlich_offen`: trägt die Quittung für a1 weiter, a2 hält fest.
    const r2 = await entscheiden('b');
    expect(r2.body).toEqual({ code: 'halten', reviewReason: D.BILD_GRUND, regel: 'bild', gegen: 'a2' });
    expect(trefferKurz('b')).toEqual(['bild:a2:entschieden:wirksam', 'bild:a1:entschieden:quittiert']);
    expect(earns().map((e) => e.receiptId)).toEqual(['a1', 'a2']);
    expect(netto('b')).toBe(0);
  });

  test('drei verschiedene Einkäufe: nach dem Original gibt der Mensch auch b frei → gebucht, sobald er jede Zeile entschieden gesehen hat', async () => {
    await ausgangslage();
    const DRITTE = ['Mehl', 'Zucker', 'Hefe', 'Salz', 'Öl', 'Essig', 'Nudeln', 'Tomaten', 'Zwiebeln', 'Knoblauch']
      .map((name, i) => ({ name, priceCents: 150 + i * 7, qty: 1 }));
    bonAnlegen('b', { zeit: '12:31', datum: VORGESTERN, items: DRITTE, capture: aehnlich('a2', 'a1'), extra: { sweepCount: 5 } });
    await verarbeiten('b');
    expect(bon('b')).toMatchObject({ status: 'review', reviewReason: D.BILD_OFFEN_GRUND });
    expect((await entscheiden('a2', 'approve', { stand: null })).body).toMatchObject({ ok: true, status: 'approved' });
    // Freigabe 1 (unter `bild_aehnlich_offen`): quittiert nichts, a2 ist inzwischen
    // bezahlt, aber nie als bezahlt gesehen → festhalten mit beiden Zeilen.
    expect((await entscheiden('b')).body).toMatchObject({ code: 'halten', reviewReason: D.BILD_GRUND, gegen: 'a2' });
    // Freigabe 2: der Mensch hat a1 und a2 als bezahlt gesehen → bucht.
    expect((await entscheiden('b')).body).toMatchObject({ ok: true, status: 'approved', creditedCents: 8 });
    expect(earns().map((e) => e.receiptId)).toEqual(['a1', 'a2', 'b']);
  });
});

// ─── 2 ────────────────────────────────────────────────────────────────────
describe('2 — bild und seiteAbweichend zugleich: kein endloses Festhalten', () => {
  async function zweiterAbschnitt() {
    config({ ...ALLE, doppelSeiteAbweichend: true });
    bonAnlegen('p1', { markt: 'dm', zeit: '11:00', items: S1, total: null, parsed: { belegart: 'app_kassenbon', totalCents: null, bestellnummer: null } });
    await verarbeiten('p1');
    expect(bon('p1').status).toBe('approved');
    bonAnlegen('p2', {
      markt: 'dm', zeit: '12:00', items: S2, total: null, confidence: 'low', capture: aehnlich('p1'),
      parsed: { belegart: 'app_kassenbon', totalCents: null, bestellnummer: null },
    });
    await verarbeiten('p2');
    expect(bon('p2')).toMatchObject({ status: 'review', reviewReason: D.SEITE_GRUND });
    expect(trefferKurz('p2')).toEqual(['seiteAbweichend:p1:entschieden:wirksam', 'bild:p1:entschieden:wirksam']);
  }

  test('der Mensch sieht beide Zeilen und gibt frei → genau eine Gutschrift für p2', async () => {
    await zweiterAbschnitt();
    const r = await entscheiden('p2');
    expect(r.body).toMatchObject({ ok: true, status: 'approved', creditedCents: 8 });
    expect(earns().map((e) => e.receiptId)).toEqual(['p1', 'p2']);
    expect(trefferKurz('p2')).toEqual(['seiteAbweichend:p1:entschieden:quittiert', 'bild:p1:entschieden:quittiert']);
    // Ein zweiter Aufruf bucht nichts mehr (nicht mehr in der Prüfung).
    expect((await entscheiden('p2')).code).toBe(409);
    expect(earns()).toHaveLength(2);
  });

  test('ohne gesehenen Stand (Skript, Bon-Runde) quittiert nichts → festhalten, kein Grundwechsel', async () => {
    await zweiterAbschnitt();
    for (let i = 0; i < 3; i++) {
      const r = await entscheiden('p2', 'approve', { stand: null });
      expect(r.body).toEqual({ code: 'halten', reviewReason: D.SEITE_GRUND, regel: 'seiteAbweichend', gegen: 'p1' });
    }
    expect(earns().map((e) => e.receiptId)).toEqual(['p1']);
    // Danach mit gesehenem Stand: bucht.
    expect((await entscheiden('p2')).body).toMatchObject({ ok: true, status: 'approved' });
    expect(earns().map((e) => e.receiptId)).toEqual(['p1', 'p2']);
  });

  test('veralteter Stand: der Vermerk wurde nach dem Ansehen neu geschrieben → nichts quittiert, festhalten; mit dem neuen Stand bucht', async () => {
    await zweiterAbschnitt();
    const gesehen = standVon('p2');
    // Inzwischen hält ein anderer Prüfer ohne Stand fest — neuer Vermerk.
    fake.setzeJetzt(START + 60_000);
    expect((await entscheiden('p2', 'approve', { stand: null })).body).toMatchObject({ code: 'halten' });
    expect(standVon('p2')).not.toBe(gesehen);
    // Freigabe mit dem alten Stand: nichts quittiert.
    expect((await entscheiden('p2', 'approve', { stand: gesehen })).body).toMatchObject({ code: 'halten', reviewReason: D.SEITE_GRUND });
    expect(earns()).toHaveLength(1);
    expect((await entscheiden('p2')).body).toMatchObject({ ok: true, status: 'approved' });
    expect(earns().map((e) => e.receiptId)).toEqual(['p1', 'p2']);
  });
});

// ─── Quittung: Grenzen ────────────────────────────────────────────────────
describe('Quittung ändert nur Prüfregeln gegen entschiedene Bons', () => {
  test('rein: ablehnende Regel und offener Kandidat bleiben wirksam, auch wenn ihr Schlüssel quittiert ist', () => {
    const neu = { ...D.identitaet({ merchantId: 'kaufland', bonDate: GESTERN, items: ZEHN, totalCents: summe(ZEHN), bonTime: '11:05' }) };
    const andere = [{ id: 'x', eintrag: D.eintragAus(neu) }];
    const modi = D.doppelModi({ doppelSumme: true });
    const quittiert = ['summe:x', 'bild:offen', 'bild:alt'];
    const u = D.doppelUrteil({
      bonId: 'n', uid: A, neu, andere, modi, quittiert,
      bild: [
        { id: 'offen', tag: GESTERN, lebendig: false, offen: true },
        { id: 'alt', tag: GESTERN, lebendig: true },
      ],
    });
    expect(u.treffer.map((t) => `${t.regel}:${t.gegen}:${t.modus}`)).toEqual(['summe:x:wirksam', 'bild:offen:wirksam', 'bild:alt:quittiert']);
    expect(u.wirksam).toMatchObject({ regel: 'summe', gegen: 'x' });
    // Ohne summe: der offene hält fest.
    const u2 = D.doppelUrteil({
      bonId: 'n', uid: A, neu, modi, quittiert,
      bild: [
        { id: 'offen', tag: GESTERN, lebendig: false, offen: true },
        { id: 'alt', tag: GESTERN, lebendig: true },
      ],
    });
    expect(u2.wirksam).toMatchObject({ regel: 'bild', gegen: 'offen', offen: true });
  });

  test('Freigabe eines Prüfgrund-Bons, der inzwischen ein Doppel ist (Regel summe) → abgelehnt, nicht gebucht', async () => {
    config(ALLE);
    bonAnlegen('orig');
    await verarbeiten('orig');
    // Ein zweites Foto desselben Bons, (künstlich) als Prüfregel-Fall in der Prüfung.
    bonAnlegen('b', { capture: aehnlich('orig') });
    fake.store.set('receipts/b', {
      ...bon('b'),
      status: 'review', reviewReason: D.BILD_GRUND, cashbackCents: 8, bonDate: GESTERN,
      merchant: { id: 'kaufland', name: 'Kaufland' },
      doppelPruefung: { modi: {}, at: fake.zeit(START), treffer: [{ regel: 'bild', gegen: 'orig', sameUser: true, modus: 'wirksam' }] },
    });
    const r = await entscheiden('b');
    expect(r.body).toMatchObject({ ok: true, status: 'rejected', rejectReason: 'duplicate_content_self' });
    expect(earns().map((e) => e.receiptId)).toEqual(['orig']);
  });
});

// ─── 3 ────────────────────────────────────────────────────────────────────
describe('3 — gleichzeitiges Hochladen', () => {
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
  let ORIG_BILD;
  let KOPIE_BILD;
  let FREMD_BILD;
  beforeAll(async () => {
    ORIG_BILD = await sharp(bonSvg()).jpeg({ quality: 92 }).toBuffer();
    // 1 % unten beschnitten, neu gespeichert — der Feinvergleich bestätigt das nicht.
    KOPIE_BILD = await sharp(bonSvg()).extract({ left: 0, top: 0, width: 900, height: 1584 }).jpeg({ quality: 85 }).toBuffer();
    // Wirklich ein anderes Bild: dieselbe Bon-Vorlage mit anderen Zufallszeilen
    // liegt für den 64-Bit-dHash noch bei Abstand 2 (App-Bons sehen alle gleich aus).
    FREMD_BILD = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="300" cy="500" r="200" fill="#000"/><circle cx="650" cy="1100" r="180" fill="#fff"/></svg>')).jpeg({ quality: 92 }).toBuffer();
  });

  const SCHARF = { ...ALLE, bildFeinvergleich: true, doppelBestandIndexiert: true };

  async function hochladen(bild, id) {
    const pfad = `cashback-uploads/${A}/${id}.jpg`;
    fake.dateien.set(pfad, bild);
    const res = antwort();
    await fn.enqueueCashback({
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: { storagePath: pfad, bytesHash: `bytes-${id}`, clientUploadId: id, campaignId: 'c1' },
    }, res);
    return res;
  }
  function lesungSetzen(id, rest) {
    fake.store.set(`receipts/${id}`, { ...bon(id), ocr: ocrVon(rest) });
  }

  /**
   * Beide Bildprüfungen laufen, bevor einer anlegt (wie zwei Geräte bzw. ein
   * Skript gleichzeitig). `vorAnlegen(id)` läuft direkt vor dem jeweiligen Anlegen.
   */
  async function gleichzeitig(paare, vorAnlegen = () => {}) {
    const db = admin.firestore();
    const original = db.collection;
    let wartende = 0;
    let freigeben;
    const schranke = new Promise((r) => { freigeben = r; });
    const ids = new Set(paare.map(([, id]) => id));
    db.collection = (name) => {
      const c = original(name);
      if (name !== 'receipts') return c;
      return {
        ...c,
        doc: (id) => {
          const r = c.doc(id);
          if (!ids.has(id)) return r;
          return {
            ...r,
            create: async (d) => {
              wartende += 1;
              if (wartende >= ids.size) freigeben();
              await schranke;
              await vorAnlegen(id);
              return r.create(d);
            },
          };
        },
      };
    };
    try {
      return await Promise.all(paare.map(([bild, id]) => hochladen(bild, id)));
    } finally {
      db.collection = original;
    }
  }

  test('scharf: genau EINE Einreichung trägt die andere als Kandidaten (die jüngere); verarbeitet in beiden Reihenfolgen → 1 Gutschrift', async () => {
    for (const reihenfolge of [['orig', 'kopie'], ['kopie', 'orig']]) {
      fake.zuruecksetzen();
      fake.setzeJetzt(START);
      fake.tokens.set('tok', A);
      config(SCHARF);
      const jetzt = Date.now();
      fake.store.set('cashback_campaigns/c1', { kind: 'receipt', active: true, startAt: fake.zeit(jetzt - 120 * TAG), endAt: fake.zeit(jetzt + 10 * TAG), cashbackPerBonCents: 8, budgetRemainingCents: 5000 });
      for (const [id, name] of Object.entries(MAERKTE)) fake.store.set(`discounter/${id}`, { name, land: 'DE' });
      fake.store.set(`users/${A}`, { cashback_balance_cents: 0, cashback_lifetime_cents: 0, cashback_consent: { accepted: true, version: 'v1.0-2026-05' } });

      const [r1, r2] = await gleichzeitig([[ORIG_BILD, 'orig'], [KOPIE_BILD, 'kopie']]);
      expect(r1.body).toMatchObject({ status: 'ocr_pending' });
      expect(r2.body).toMatchObject({ status: 'ocr_pending' });
      // Gleicher Zeitpunkt in der Attrappe → die Bon-ID entscheidet: „kopie" ist älter.
      expect(bon('kopie').capture.bildAehnlich).toBeUndefined();
      expect(bon('orig').capture.bildAehnlich).toMatchObject({ kandidaten: ['kopie'], gleichzeitig: ['kopie'], bestaetigt: false });

      lesungSetzen('orig', {});
      lesungSetzen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE });
      for (const id of reihenfolge) await verarbeiten(id);
      for (const id of reihenfolge) await verarbeiten(id);
      expect(earns()).toHaveLength(1);
    }
  });

  test('Schalter aus (Standard): ohne Vermerk wurden beide bezahlt — jetzt trägt die jüngere den Vermerk, 1 Gutschrift', async () => {
    fake.tokens.set('tok', A);
    config(ALLE);
    await gleichzeitig([[ORIG_BILD, 'orig'], [KOPIE_BILD, 'kopie']]);
    expect(bon('orig').capture.bildAehnlich).toMatchObject({ kandidaten: ['kopie'], gleichzeitig: ['kopie'] });
    lesungSetzen('orig', {});
    lesungSetzen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE });
    await verarbeiten('kopie');
    await verarbeiten('orig');
    expect(earns().map((e) => e.receiptId)).toEqual(['kopie']);
    expect(bon('orig')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
  });

  test('Richtung: ein älterer Bon, der zwischen Bildprüfung und Anlegen entsteht, wird nachgetragen; ein jüngerer nie', async () => {
    fake.tokens.set('tok', A);
    config(SCHARF);
    const dhash = await require('../lib/forensics').computeDHash(ORIG_BILD);
    const anderer = (id, versatzMs) => fake.store.set(`receipts/${id}`, {
      userId: A, status: 'ocr_pending', campaignId: 'c1',
      createdAt: fake.zeit(START + versatzMs),
      capture: { hash: `h-${id}`, perceptualHashServer: dhash },
      storage: { bucket: 'b', path: `cashback-uploads/${A}/${id}.jpg` },
    });
    await gleichzeitig([[KOPIE_BILD, 'kopie']], () => { anderer('aelter', -500); anderer('juenger', 500); });
    expect(bon('kopie').capture.bildAehnlich).toMatchObject({ kandidaten: ['aelter'], gleichzeitig: ['aelter'] });
  });

  test('nacheinander hochgeladen: kein Nachtrag (die Bildprüfung sah das Original schon)', async () => {
    fake.tokens.set('tok', A);
    config(SCHARF);
    await hochladen(ORIG_BILD, 'orig');
    fake.setzeJetzt(START + 5000);
    await hochladen(KOPIE_BILD, 'kopie');
    expect(bon('kopie').capture.bildAehnlich).toMatchObject({ kandidaten: ['orig'] });
    expect(bon('kopie').capture.bildAehnlich.gleichzeitig).toBeUndefined();
    expect(bon('orig').capture.bildAehnlich).toBeUndefined();
  });

  test('anderes Bild gleichzeitig hochgeladen → kein Vermerk; Lesefehler beim Nachsehen → kein Urteil, der Bon wird gelesen', async () => {
    fake.tokens.set('tok', A);
    config(SCHARF);
    await gleichzeitig([[ORIG_BILD, 'orig'], [FREMD_BILD, 'fremd']]);
    expect(bon('orig').capture.bildAehnlich).toBeUndefined();
    expect(bon('fremd').capture.bildAehnlich).toBeUndefined();

    fake.zuruecksetzen();
    fake.setzeJetzt(START);
    global.__published = [];
    global.__logs = [];
    fake.tokens.set('tok', A);
    config(SCHARF);
    fake.store.set(`users/${A}`, { cashback_balance_cents: 0, cashback_lifetime_cents: 0, cashback_consent: { accepted: true, version: 'v1.0-2026-05' } });
    // Die Abfrage nach dem Anlegen scheitert (Sammlung nicht lesbar), sobald der eigene Bon steht.
    const r = await gleichzeitig([[ORIG_BILD, 'orig']], () => { fake.fehler.add('receipts'); });
    fake.fehler.delete('receipts');
    expect(r[0].body).toMatchObject({ cashbackId: 'orig', status: 'ocr_pending' });
    expect(global.__logs.some((l) => l[0] === 'bild-gleichzeitig-pruefung-fehlgeschlagen')).toBe(true);
    expect(global.__published).toHaveLength(1);
  });
});
