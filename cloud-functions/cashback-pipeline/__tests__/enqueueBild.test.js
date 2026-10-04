'use strict';

/**
 * Bildprüfung beim Hochladen (enqueueCashback) mit Feinvergleich —
 * Entscheidung Patrick 04.10.2026: „dHash entschärfen, sonst lesen".
 * Echter Handler, Firestore- und Storage-Attrappe, echte Bilder (sharp).
 *
 *   - Sperre nur, wenn der Feinvergleich DASSELBE Bild bestätigt.
 *   - Nie gegen abgelehnte oder unvergütete Bons (Neuversuch erlaubt).
 *   - Nicht bestätigt, Fehler oder Zeitlimit → Bon wird angelegt und gelesen.
 *   - 'shadow' bzw. Schalter aus → Verhalten wie bisher.
 *   - true wirkt erst mit doppelSumme, doppelArtikel UND doppelDatum === true
 *     (Geld zuerst schützen: was der Feinvergleich durchlässt, muss in der
 *     Buchung hängen bleiben).
 *   - Bearbeitete Kopien (Helligkeit) gelten als dasselbe Bild.
 *   - Dieselbe Datei nach einem Lesefehler: einmal neu lesen.
 */

jest.mock('firebase-admin', () => require('./helpers/fakeAdmin').erstelleFakeAdmin());
jest.mock('firebase-functions', () => ({
  logger: { info: (...a) => global.__logs.push(a), warn: (...a) => global.__logs.push(a), error: () => {}, debug: () => {} },
}));
jest.mock('firebase-functions/params', () => ({
  defineSecret: (name) => ({ name, value: () => undefined }),
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
jest.mock('../lib/push', () => ({ sendCashbackReady: async () => {} }));

const sharp = require('sharp');
const admin = require('firebase-admin');
const fn = require('../index');
const { computeDHash } = require('../lib/forensics');

const fake = admin.__fake;
const UID = 'bildNutzer';

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
let BILD_NEU_GESPEICHERT;
let ANDERES_BILD;
let DHASH;
beforeAll(async () => {
  BILD = await sharp(bonSvg()).jpeg({ quality: 92 }).toBuffer();
  BILD_NEU_GESPEICHERT = await sharp(bonSvg()).jpeg({ quality: 70 }).toBuffer();
  ANDERES_BILD = await sharp(bonSvg({ saat: 5 })).jpeg({ quality: 92 }).toBuffer();
  DHASH = await computeDHash(BILD);
});

function antwort() {
  const r = { code: 200, body: undefined };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

/** Früherer Bon derselben Person mit (scheinbar) gleichem dHash. */
function frueher(id, status, bild) {
  const pfad = `cashback-uploads/${UID}/${id}.jpg`;
  if (bild) fake.dateien.set(pfad, bild);
  fake.store.set(`receipts/${id}`, {
    userId: UID,
    status,
    createdAt: fake.zeit(Date.now() - 3 * 60 * 60 * 1000),
    capture: { hash: `hash-${id}`, perceptualHashServer: DHASH },
    storage: { path: pfad },
  });
}

async function hochladen(bild = BILD_NEU_GESPEICHERT, id = 'neu1') {
  const pfad = `cashback-uploads/${UID}/${id}.jpg`;
  fake.dateien.set(pfad, bild);
  const res = antwort();
  await fn.enqueueCashback({
    method: 'POST',
    headers: { authorization: 'Bearer tok' },
    body: { storagePath: pfad, bytesHash: `bytes-${id}`, clientUploadId: id },
  }, res);
  return res;
}

const SCHARF = { bildFeinvergleich: true, doppelSumme: true, doppelArtikel: true, doppelDatum: true };

function config(extra) {
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, ...extra });
}

beforeEach(() => {
  fake.zuruecksetzen();
  global.__logs = [];
  global.__published = [];
  fake.tokens.set('tok', UID);
  fake.store.set(`users/${UID}`, { cashback_consent: { accepted: true, version: 'v1.0-2026-05' } });
  config(SCHARF);
});

describe('Feinvergleich scharf (bildFeinvergleich und die Doppel-Regeln true)', () => {
  test('dasselbe Bild wie ein bezahlter Bon → gesperrt wie bisher', async () => {
    frueher('alt', 'approved', BILD);
    const res = await hochladen();
    expect(res.body).toMatchObject({ cashbackId: 'alt', duplicate: true });
    expect(fake.store.get('receipts/neu1')).toBeUndefined();
    expect(fake.store.get(`users/${UID}/cashback_status/neu1`)).toMatchObject({ status: 'superseded', supersededBy: 'alt' });
    expect(global.__published).toHaveLength(0);
  });

  test('anderes Bild, nur der grobe Vergleich schlägt an → Bon wird angelegt und gelesen', async () => {
    frueher('alt', 'approved', ANDERES_BILD);
    const res = await hochladen();
    expect(res.body).toMatchObject({ cashbackId: 'neu1', status: 'ocr_pending' });
    const bon = fake.store.get('receipts/neu1');
    expect(bon.capture.bildAehnlich).toMatchObject({ kandidat: 'alt', distanz: 0, bestaetigt: false });
    expect(bon.capture.bildAehnlich.ssim).toBeLessThan(0.98);
    expect(global.__published).toHaveLength(1);
  });

  test.each([['rejected'], ['no_reward']])('früherer Bon %s → nie gesperrt (Neuversuch erlaubt)', async (status) => {
    frueher('alt', status, BILD);
    const res = await hochladen();
    expect(res.body).toMatchObject({ cashbackId: 'neu1', status: 'ocr_pending' });
    expect(fake.store.get('receipts/neu1').capture.bildAehnlich).toMatchObject({ kandidat: 'alt', bestaetigt: false, grund: 'nur_abgelehnte_oder_unverguetete' });
  });

  test('früheres Bild nicht ladbar → kein Urteil, der Bon wird gelesen', async () => {
    frueher('alt', 'review', null);
    fake.fehler.add(`storage:cashback-uploads/${UID}/alt.jpg`);
    const res = await hochladen();
    expect(res.body).toMatchObject({ cashbackId: 'neu1' });
    expect(fake.store.get('receipts/neu1').capture.bildAehnlich).toMatchObject({ kandidat: 'alt', bestaetigt: false, fehler: expect.stringMatching(/UNAVAILABLE/) });
  });

  test('Kopie eines bezahlten Bons mit veränderter Helligkeit → gesperrt (dasselbe Bild)', async () => {
    frueher('alt', 'approved', BILD);
    const heller = await sharp(BILD).modulate({ brightness: 1.08 }).jpeg({ quality: 90 }).toBuffer();
    const res = await hochladen(heller);
    expect(res.body).toMatchObject({ cashbackId: 'alt', duplicate: true });
    expect(fake.store.get('receipts/neu1')).toBeUndefined();
  });

  test('kein ähnlicher Bon → wie bisher, ohne Vermerk', async () => {
    const res = await hochladen(ANDERES_BILD);
    expect(res.body).toMatchObject({ cashbackId: 'neu1' });
    expect(fake.store.get('receipts/neu1').capture.bildAehnlich).toBeUndefined();
  });
});

describe('Verhalten wie bisher', () => {
  test("'shadow': ein abgelehnter früherer Bon sperrt weiter, der Feinvergleich wird protokolliert", async () => {
    config({ ...SCHARF, bildFeinvergleich: 'shadow' });
    frueher('alt', 'rejected', ANDERES_BILD);
    const res = await hochladen();
    expect(res.body).toMatchObject({ cashbackId: 'alt', duplicate: true });
    const log = global.__logs.find((l) => l[0] === 'forensics-feinvergleich');
    expect(log[1]).toMatchObject({ modus: 'beobachtung', neuWuerde: 'lesen', statusBisher: 'rejected' });
  });

  test.each([['doppelSumme'], ['doppelArtikel'], ['doppelDatum']])('true, aber %s nicht true → wirkt wie shadow (erst das Geld schützen)', async (regel) => {
    config({ ...SCHARF, [regel]: 'shadow' });
    frueher('alt', 'approved', ANDERES_BILD);
    const res = await hochladen();
    expect(res.body).toMatchObject({ cashbackId: 'alt', duplicate: true });
    const log = global.__logs.find((l) => l[0] === 'bildfeinvergleich-wartet-auf-doppelregeln');
    expect(log[1]).toMatchObject({ fehlt: [regel] });
  });

  test('Schalter aus → kein Feinvergleich, Sperre wie bisher', async () => {
    config({});
    frueher('alt', 'rejected', ANDERES_BILD);
    const res = await hochladen();
    expect(res.body).toMatchObject({ cashbackId: 'alt', duplicate: true });
    expect(global.__logs.some((l) => l[0] === 'forensics-feinvergleich')).toBe(false);
  });
});

describe('dieselbe Datei noch einmal (Byte-Prüfung)', () => {
  /** Früherer Bon mit DERSELBEN Datei (gleicher capture.hash wie der neue Upload). */
  function gleicheDatei(id, status, rejectReason = null, extra = {}) {
    fake.store.set(`receipts/${id}`, {
      userId: UID,
      status,
      rejectReason,
      createdAt: fake.zeit(Date.now() - 60 * 60 * 1000),
      capture: { hash: 'bytes-neu1', perceptualHashServer: DHASH, ...extra },
      storage: { path: `cashback-uploads/${UID}/${id}.jpg` },
    });
  }

  test('nach einem Lesefehler (no_bon_date) → einmal neu gelesen, vermerkt', async () => {
    gleicheDatei('alt', 'rejected', 'no_bon_date');
    const res = await hochladen(BILD, 'neu1');
    expect(res.body).toMatchObject({ cashbackId: 'neu1', status: 'ocr_pending' });
    expect(fake.store.get('receipts/neu1').capture).toMatchObject({ neuversuchVon: 'alt' });
    expect(global.__published).toHaveLength(1);
  });

  test('zweiter Neuversuch derselben Datei → gesperrt, die Antwort verweist auf den Neuversuch (Prüfrunde 2)', async () => {
    gleicheDatei('alt', 'rejected', 'no_bon_date');
    fake.store.set('receipts/erster', {
      userId: UID, status: 'rejected', rejectReason: 'no_bon_date',
      createdAt: fake.zeit(Date.now() - 30 * 60 * 1000),
      capture: { hash: 'anders', perceptualHashServer: 'x', neuversuchVon: 'alt' },
    });
    const res = await hochladen(BILD, 'neu1');
    expect(res.body).toMatchObject({ cashbackId: 'erster', duplicate: true, duplicateMode: 'exact' });
    expect(fake.store.get(`users/${UID}/cashback_status/neu1`)).toMatchObject({ status: 'superseded', supersededBy: 'erster' });
    expect(global.__published).toHaveLength(0);
  });

  test('Prüfrunde 2: die App wiederholt den Aufruf des schon BEZAHLTEN Neuversuchs → dieselbe ID, Spiegel unverändert', async () => {
    gleicheDatei('alt', 'rejected', 'no_bon_date');
    const erst = await hochladen(BILD, 'neu1');
    expect(erst.body).toMatchObject({ cashbackId: 'neu1', status: 'ocr_pending' });
    // Inzwischen gelesen und bezahlt.
    fake.store.set('receipts/neu1', { ...fake.store.get('receipts/neu1'), status: 'approved' });
    fake.store.set(`users/${UID}/cashback_status/neu1`, { status: 'approved', cashbackCents: 8 });
    global.__published = [];
    const wiederholt = await hochladen(BILD, 'neu1');
    expect(wiederholt.body).toEqual({ cashbackId: 'neu1', status: 'approved' });
    expect(fake.store.get(`users/${UID}/cashback_status/neu1`)).toEqual({ status: 'approved', cashbackCents: 8 });
    expect(global.__published).toHaveLength(0);
  });

  test('die ID gehört einer anderen Person → kein Abkürzen, der bisherige Weg läuft', async () => {
    fake.store.set('receipts/neu1', { userId: 'jemandAnderes', status: 'approved', capture: { hash: 'zzz' } });
    await hochladen(ANDERES_BILD, 'neu1');
    expect(global.__logs.some((l) => l[0] === 'enqueue-wiederholung')).toBe(false);
  });

  test.each([['rejected', 'bon_too_old'], ['rejected', 'unknown_merchant'], ['approved', null], ['no_reward', 'daily_cap_reached']])(
    'früherer Bon %s/%s → gesperrt wie bisher (eine neue Lesung änderte nichts)',
    async (status, grund) => {
      gleicheDatei('alt', status, grund);
      const res = await hochladen(BILD, 'neu1');
      expect(res.body).toMatchObject({ cashbackId: 'alt', duplicate: true, duplicateMode: 'exact' });
    },
  );

  test("'shadow' → gesperrt wie bisher", async () => {
    config({ ...SCHARF, bildFeinvergleich: 'shadow' });
    gleicheDatei('alt', 'rejected', 'no_bon_date');
    const res = await hochladen(BILD, 'neu1');
    expect(res.body).toMatchObject({ cashbackId: 'alt', duplicate: true });
  });
});
