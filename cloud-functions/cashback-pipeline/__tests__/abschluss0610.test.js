'use strict';

/**
 * Abschlussprüfung 06.10.2026 (claude/bon-doppelzahlung). Jeder Fall läuft mit
 * dem ECHTEN index.js gegen die Firestore-Attrappe.
 *
 *   1  Lockvögel: `capture.bildAehnlich.kandidaten` wurde nach „neueste zuerst"
 *      auf 20 gekürzt. 20 frisch hochgeladene, ähnlich aussehende Uploads kurz
 *      vor der bearbeiteten Kopie (noch `ocr_pending`, also Kandidaten)
 *      schoben das bezahlte — oder noch offene — Original aus der Liste; nach
 *      ihrer Ablehnung hatte die Kopie keinen Kandidaten mehr und wurde
 *      bezahlt. Fix: die Liste fasst alle groben Treffer der Bildprüfung
 *      (BILD_MAX_KANDIDATEN ≥ DHASH_DEDUP_LOOKBACK + DHASH_EXAKT_FEIN), beim
 *      Kürzen bezahlte zuerst (lib/doppelBon bildKandidatenOrdnen), auch im
 *      Nachtrag bei gleichzeitigem Hochladen.
 *   2  Bild ohne dHash (PDF, HEIC, abgeschnittene Datei): Bildsperre und Regel
 *      bild waren blind, die Kopie wurde bezahlt. Fix: enqueueCashback vermerkt
 *      `capture.bildNichtLesbar`, processCashback gibt den Bon vor der ersten
 *      Gutschrift an einen Menschen (`bild_nicht_pruefbar`).
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

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const admin = require('firebase-admin');
const fn = require('../index');
const D = require('../lib/doppelBon');
const { computeDHash, hammingDistance } = require('../lib/forensics');
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
const summe = (items) => items.reduce((s, it) => s + it.priceCents, 0);
// Kopie des Originals: Datum −1, Uhrzeit geändert, ein Preis und die Endsumme
// +10 ct — keine Textregel greift, nur Regel bild.
const KOPIE = ZEHN.map((it, i) => (i === 0 ? { ...it, priceCents: it.priceCents + 10 } : it));
const MAERKTE = { kaufland: 'Kaufland', dm: 'dm' };
const ALLE = {
  doppelSumme: true, doppelKonten: true, doppelArtikel: true, doppelBestellnummer: true,
  doppelDatum: true, doppelKontenArtikel: true, doppelKontenDatum: true,
};
const SCHARF = { ...ALLE, bildFeinvergleich: true, doppelBestandIndexiert: true };

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
// Andere, aber für den 64-Bit-dHash nahe Bon-Bilder (App-Bons sehen alle gleich aus).
let LOCKVOEGEL;
beforeAll(async () => {
  ORIG_BILD = await sharp(bonSvg()).jpeg({ quality: 92 }).toBuffer();
  // 1 % unten beschnitten, neu gespeichert — der Feinvergleich bestätigt das nicht.
  KOPIE_BILD = await sharp(bonSvg()).extract({ left: 0, top: 0, width: 900, height: 1584 }).jpeg({ quality: 85 }).toBuffer();
  const kopieHash = await computeDHash(KOPIE_BILD);
  LOCKVOEGEL = [];
  for (let saat = 100; LOCKVOEGEL.length < 20 && saat < 3000; saat++) {
    const b = await sharp(bonSvg({ saat })).jpeg({ quality: 90 }).toBuffer();
    if (hammingDistance(kopieHash, await computeDHash(b)) <= 3) LOCKVOEGEL.push(b);
  }
}, 60_000);

beforeEach(() => {
  fake.zuruecksetzen();
  fake.fehler.clear();
  fake.setzeJetzt(START);
  global.__logs = [];
  global.__pushes = [];
  global.__published = [];
  global.__secrets = { NUTRITION_SCRAPER_TRIGGER_KEY: SCHLUESSEL };
  fake.tokens.set('tok', A);
  config(SCHARF);
  const jetzt = Date.now();
  fake.store.set('cashback_campaigns/c1', {
    kind: 'receipt', active: true,
    startAt: fake.zeit(jetzt - 120 * TAG), endAt: fake.zeit(jetzt + 10 * TAG),
    cashbackPerBonCents: 8, budgetRemainingCents: 5000,
  });
  for (const [id, name] of Object.entries(MAERKTE)) fake.store.set(`discounter/${id}`, { name, land: 'DE' });
  fake.store.set(`users/${A}`, { cashback_balance_cents: 0, cashback_lifetime_cents: 0, cashback_consent: { accepted: true, version: 'v1.0-2026-05' } });
});

async function hochladen(bild, id) {
  const pfad = `cashback-uploads/${A}/${id}.jpg`;
  if (bild) fake.dateien.set(pfad, bild);
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

/** Original vor `vorMs` hochgeladen und bezahlt. */
async function bezahltesOriginal(vorMs = 60 * 60 * 1000) {
  fake.setzeJetzt(START - vorMs);
  await hochladen(ORIG_BILD, 'orig');
  lesungSetzen('orig', {});
  await verarbeiten('orig');
  expect(bon('orig').status).toBe('approved');
  fake.setzeJetzt(START);
}

/**
 * Beide Bildprüfungen laufen, bevor einer anlegt (wie zwei Geräte bzw. ein
 * Skript gleichzeitig) — wie __tests__/nachpruefung0610d.test.js.
 */
async function gleichzeitig(paare) {
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

// ─── 1 ────────────────────────────────────────────────────────────────────
describe('1 — Lockvögel verdrängen das Original nicht mehr aus den Bild-Kandidaten', () => {
  test('Vertrag: BILD_MAX_KANDIDATEN fasst alle groben Treffer der Bildprüfung (Rückschau + exakte)', () => {
    const quelle = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
    const zahl = (name) => Number((new RegExp(`const ${name} = (\\d+);`).exec(quelle) || [])[1]);
    const rueckschau = zahl('DHASH_DEDUP_LOOKBACK');
    const exakt = zahl('DHASH_EXAKT_FEIN');
    expect(rueckschau).toBeGreaterThan(0);
    expect(exakt).toBeGreaterThan(0);
    expect(quelle).toContain('.limit(feinModus ? DHASH_EXAKT_FEIN : 1)');
    expect(D.BILD_MAX_KANDIDATEN).toBeGreaterThanOrEqual(rueckschau + exakt);
  });

  test('rein: bildKandidatenOrdnen — bezahlte vor offenen vor dem Rest, je neueste zuerst; eigener Bon und Doppelte raus; gekürzt', () => {
    const liste = [
      { id: 'offen-neu', status: 'ocr_pending', ms: 900 },
      { id: 'bezahlt-alt', status: 'approved', ms: 100 },
      { id: 'pruefung', status: 'review', ms: 500 },
      { id: 'bezahlt-neu', status: 'paid', ms: 300 },
      { id: 'unbekannt', status: null, ms: 999 },
      { id: 'self', status: 'approved', ms: 1000 },
      { id: 'bezahlt-alt', status: 'ocr_pending', ms: 5 },
      { id: '', status: 'approved', ms: 1 },
      null,
    ];
    expect(D.bildKandidatenOrdnen(liste, 'self')).toEqual(['bezahlt-neu', 'bezahlt-alt', 'offen-neu', 'pruefung', 'unbekannt']);
    // Bezahlte überleben jede Flut offener Bons.
    const flut = Array.from({ length: D.BILD_MAX_KANDIDATEN + 10 }, (_, i) => ({ id: `j${i}`, status: 'ocr_pending', ms: 2000 + i }));
    const gekuerzt = D.bildKandidatenOrdnen([...flut, { id: 'orig', status: 'approved', ms: 1 }]);
    expect(gekuerzt).toHaveLength(D.BILD_MAX_KANDIDATEN);
    expect(gekuerzt[0]).toBe('orig');
  });

  test('NACHSTELLUNG: 20 frische Lockvögel kurz vor der Kopie, Original BEZAHLT → Original bleibt Kandidat, Kopie in der Prüfung, 1 Gutschrift', async () => {
    expect(LOCKVOEGEL).toHaveLength(20);
    await bezahltesOriginal();
    for (let k = 1; k <= 20; k++) {
      fake.setzeJetzt(START + k * 1000);
      const r = await hochladen(LOCKVOEGEL[k - 1], `j${k}`);
      expect(r.body).toMatchObject({ cashbackId: `j${k}`, status: 'ocr_pending' });
    }
    fake.setzeJetzt(START + 30_000);
    await hochladen(KOPIE_BILD, 'kopie');
    const ba = bon('kopie').capture.bildAehnlich;
    // Vorher: j20…j1, „orig" fehlte.
    expect(ba.kandidaten[0]).toBe('orig');
    expect(ba.kandidaten).toHaveLength(21);

    // Lockvögel: dieselbe Lesung wie das Original → als Doppel abgelehnt.
    for (let k = 1; k <= 20; k++) lesungSetzen(`j${k}`, {});
    for (let k = 1; k <= 20; k++) await verarbeiten(`j${k}`);
    expect(new Set(Array.from({ length: 20 }, (_, i) => bon(`j${i + 1}`).status))).toEqual(new Set(['rejected']));
    lesungSetzen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(earns().map((e) => e.receiptId)).toEqual(['orig']);
  });

  test('NACHSTELLUNG: 20 Lockvögel zwischen noch OFFENEM Original und Kopie → das Original bleibt Kandidat; nach seiner Gutschrift hält Regel bild die Kopie fest', async () => {
    fake.setzeJetzt(START - 60_000);
    await hochladen(ORIG_BILD, 'orig');
    for (let k = 1; k <= 20; k++) {
      fake.setzeJetzt(START + k * 1000);
      await hochladen(LOCKVOEGEL[k - 1], `j${k}`);
    }
    fake.setzeJetzt(START + 30_000);
    await hochladen(KOPIE_BILD, 'kopie');
    expect(bon('kopie').capture.bildAehnlich.kandidaten).toContain('orig');
    expect(bon('kopie').capture.bildAehnlich.kandidaten).toHaveLength(21);

    // Lockvögel werden abgelehnt (kein Kassenbon), dann das Original bezahlt.
    for (let k = 1; k <= 20; k++) lesungSetzen(`j${k}`, { parsed: { isReceipt: false } });
    for (let k = 1; k <= 20; k++) await verarbeiten(`j${k}`);
    expect(new Set(Array.from({ length: 20 }, (_, i) => bon(`j${i + 1}`).status))).toEqual(new Set(['rejected']));
    lesungSetzen('orig', {});
    await verarbeiten('orig');
    expect(bon('orig').status).toBe('approved');
    lesungSetzen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: D.BILD_GRUND });
    expect(earns().map((e) => e.receiptId)).toEqual(['orig']);
  });

  test('Nachtrag bei gleichzeitigem Hochladen: erst zusammenführen, dann ordnen — das bezahlte Original steht vor dem nachgetragenen offenen Bon', async () => {
    await bezahltesOriginal();
    // „a-lock" ist bei gleichem Zeitpunkt der ältere (Bon-ID), wird bei der
    // Kopie also nachgetragen.
    await gleichzeitig([[LOCKVOEGEL[0], 'a-lock'], [KOPIE_BILD, 'kopie']]);
    const ba = bon('kopie').capture.bildAehnlich;
    expect(ba.gleichzeitig).toEqual(['a-lock']);
    // Vorher [...nachgetragen, ...bekannt]: ['a-lock', 'orig'].
    expect(ba.kandidaten).toEqual(['orig', 'a-lock']);
  });
});

// ─── 2 ────────────────────────────────────────────────────────────────────
describe('2 — Bild ohne dHash (PDF, HEIC, abgeschnitten) geht vor der Gutschrift an einen Menschen', () => {
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

  test('NACHSTELLUNG: bearbeitete Kopie als PDF → vermerkt, Prüfung bild_nicht_pruefbar statt Gutschrift; die Bon-Runde fasst sie nicht an', async () => {
    await bezahltesOriginal();
    const r = await hochladen(PDF, 'kopie');
    expect(r.body).toMatchObject({ cashbackId: 'kopie', status: 'ocr_pending' });
    expect(bon('kopie').capture.perceptualHashServer).toBeNull();
    expect(bon('kopie').capture.bildNichtLesbar).toEqual({ fehler: expect.any(String) });
    expect(global.__logs.find((l) => l[0] === 'forensics-failed')[1]).toMatchObject({ bildNichtLesbar: true });
    lesungSetzen('kopie', { zeit: '12:31', datum: VORGESTERN, items: KOPIE });
    await verarbeiten('kopie');
    expect(bon('kopie')).toMatchObject({ status: 'review', reviewReason: 'bild_nicht_pruefbar' });
    expect(bearbeitbar(bon('kopie'))).toBe(false);
    expect(earns().map((e) => e.receiptId)).toEqual(['orig']);
  });

  test('ehrlicher Fall: abgeschnittener JPEG-Upload (wie 14.09./21.09., 512 KiB) → Prüfung; geht der Mensch frei, wird gebucht', async () => {
    const abgeschnitten = ORIG_BILD.subarray(0, Math.floor(ORIG_BILD.length / 2));
    await hochladen(abgeschnitten, 'kurz');
    expect(bon('kurz').capture.bildNichtLesbar).toBeTruthy();
    lesungSetzen('kurz', {});
    await verarbeiten('kurz');
    expect(bon('kurz')).toMatchObject({ status: 'review', reviewReason: 'bild_nicht_pruefbar' });
    expect(earns()).toHaveLength(0);
    const res = await entscheiden('kurz');
    expect(res.code).toBe(200);
    expect(bon('kurz').status).toBe('approved');
    expect(earns().map((e) => e.receiptId)).toEqual(['kurz']);
  });

  test('Notaus bildNichtLesbarPruefen: false → wie vorher gelesen und bezahlt', async () => {
    config({ ...SCHARF, bildNichtLesbarPruefen: false });
    await hochladen(PDF, 'pdf');
    expect(bon('pdf').capture.bildNichtLesbar).toBeTruthy();
    lesungSetzen('pdf', {});
    await verarbeiten('pdf');
    expect(bon('pdf').status).toBe('approved');
    expect(earns().map((e) => e.receiptId)).toEqual(['pdf']);
  });

  test('ein LADEFEHLER (Speicher nicht erreichbar) ist kein Urteil: kein Vermerk, der Bon wird gelesen und bezahlt', async () => {
    fake.dateien.set(`cashback-uploads/${A}/lade.jpg`, ORIG_BILD);
    fake.fehler.add(`storage:cashback-uploads/${A}/lade.jpg`);
    const r = await hochladen(null, 'lade');
    fake.fehler.clear();
    expect(r.body).toMatchObject({ cashbackId: 'lade', status: 'ocr_pending' });
    expect(bon('lade').capture.bildNichtLesbar).toBeUndefined();
    expect(global.__logs.find((l) => l[0] === 'forensics-failed')[1]).toMatchObject({ bildNichtLesbar: false });
    lesungSetzen('lade', {});
    await verarbeiten('lade');
    expect(bon('lade').status).toBe('approved');
  });

  test('nur auf dem Zahlweg: ein ohnehin abgelehnter Bon bleibt abgelehnt (keine Prüfung)', async () => {
    await hochladen(PDF, 'alt');
    lesungSetzen('alt', { datum: vorTagen(30) });
    await verarbeiten('alt');
    expect(bon('alt')).toMatchObject({ status: 'rejected', rejectReason: 'bon_too_old' });
  });

  test('ein schon bezahlter Bon (erneute Zustellung) wird nicht zurück in die Prüfung genommen', async () => {
    config({ ...SCHARF, bildNichtLesbarPruefen: false });
    await hochladen(PDF, 'pdf');
    lesungSetzen('pdf', {});
    await verarbeiten('pdf');
    expect(bon('pdf').status).toBe('approved');
    config(SCHARF);
    await verarbeiten('pdf');
    expect(bon('pdf').status).toBe('approved');
    expect(earns().map((e) => e.receiptId)).toEqual(['pdf']);
  });
});
