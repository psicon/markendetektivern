'use strict';

/**
 * Online-Bestellungen und Belegart (Prompt v1.5, Entscheidung Patrick
 * 04.10.2026): nur Kassenbons; App-Kassenbons nach Ladeneinkauf zählen;
 * Online-Bestellungen nur bei UNSEREN Märkten (dm, REWE … ja; Picnic, Knuspr,
 * Amazon nein, solange sie kein Markt sind). Eine Lieferanschrift wird nie als
 * Filiale gespeichert.
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
      return { publishMessage: async () => 'msg' };
    }
  },
}));
jest.mock('../lib/push', () => ({ sendCashbackReady: async () => {} }));

const admin = require('firebase-admin');
const fn = require('../index');
const { belegBereinigen, onlineMerkmal, istOnlineBestellung } = require('../lib/belegart');
const { deriveStoreAddress } = require('../lib/storeAddress');
const { resolveMerchant } = require('../lib/merchant');
const PROMPT = require('../lib/prompt');
const REFEREE = require('../lib/prompt_referee');

const fake = admin.__fake;
const UID = 'onlineNutzer';
const TAG = 24 * 60 * 60 * 1000;
const GESTERN = new Date(Date.now() - TAG).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });

const MAERKTE = { netto: 'Netto Marken-Discount', edeka: 'EDEKA', dm: 'dm-drogerie markt', rewe: 'REWE' };

beforeEach(() => {
  fake.zuruecksetzen();
  global.__logs = [];
  const jetzt = Date.now();
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3 });
  fake.store.set('cashback_campaigns/c1', {
    kind: 'receipt', active: true, startAt: fake.zeit(jetzt - 10 * TAG), endAt: fake.zeit(jetzt + 10 * TAG),
    cashbackPerBonCents: 8, budgetRemainingCents: 5000,
  });
  for (const [id, name] of Object.entries(MAERKTE)) fake.store.set(`discounter/${id}`, { name, land: 'DE' });
  fake.store.set(`users/${UID}`, { cashback_balance_cents: 0 });
});

describe('belegBereinigen', () => {
  test('Online-Bestellung: Kundenanschrift raus, Bestellnummer bleibt', () => {
    const p = belegBereinigen({
      merchant: 'dm-drogerie markt', merchantSubtitle: 'Max Muster, Musterweg 1, 12345 Musterstadt',
      storeAddress: { street: 'Musterweg 1', zip: '12345', city: 'Musterstadt' },
      belegart: 'online_bestellung', bestellnummer: ' DM-4711-0815 ', bonComplete: true,
    });
    expect(p).toMatchObject({ belegart: 'online_bestellung', bestellnummer: 'DM-4711-0815', merchantSubtitle: null, storeAddress: null, onlineMerkmal: 'modell', bonComplete: true });
  });

  test('Bestand ohne Belegart: Stichwort „Lieferadresse" im Kopf genügt', () => {
    const p = belegBereinigen({ merchant: 'dm-drogerie markt GmbH + Co. KG', merchantSubtitle: 'Deine Lieferadresse: Musterweg 1, 12345 Musterstadt' });
    expect(p).toMatchObject({ belegart: null, onlineMerkmal: 'stichwort', merchantSubtitle: null, storeAddress: null });
  });

  test('„Onlineshop" im Kopf zählt nur ohne Uhrzeit (BILLA-Ladenbon wirbt damit)', () => {
    expect(onlineMerkmal({ merchant: 'BILLA', merchantSubtitle: 'Onlineshop: billa.at', bonTime: '17:31' })).toBeNull();
    expect(onlineMerkmal({ merchant: 'dm-drogerie markt', merchantSubtitle: 'Onlineshop dm.de', bonTime: null })).toBe('stichwort');
  });

  test('Kassenbon und App-Kassenbon bleiben unverändert; Bestellnummer nur bei Bestellung', () => {
    const k = belegBereinigen({ merchant: 'Lidl', merchantSubtitle: 'Hüttenweg 50, 14195 Berlin', belegart: 'app_kassenbon', bestellnummer: '123456789' });
    expect(k).toMatchObject({ belegart: 'app_kassenbon', bestellnummer: null, merchantSubtitle: 'Hüttenweg 50, 14195 Berlin' });
    expect(k.onlineMerkmal).toBeUndefined();
    expect(belegBereinigen({ belegart: 'Quittung', bonComplete: 'ja' })).toMatchObject({ belegart: null, bonComplete: null });
  });

  test('Online-Rechnung ohne Endbetrag (Seite 1 von 3): Artikelsumme wird Endbetrag, vermerkt', () => {
    const p = belegBereinigen({
      merchant: 'dm-drogerie markt', belegart: 'online_bestellung', totalCents: null, bonComplete: false,
      items: [{ name: 'Zahnpasta', priceCents: 195 }, { name: 'Shampoo', priceCents: 345 }, { name: 'Pfand', priceCents: 25 }],
    });
    expect(p).toMatchObject({ totalCents: 565, summeAusArtikeln: true, bonComplete: false });
    expect(belegBereinigen(p)).toEqual(p);
  });

  test('Ladenbon oder App-Bon ohne Endbetrag bleibt ohne Endbetrag (Teilfoto)', () => {
    for (const belegart of ['kassenbon', 'app_kassenbon', null]) {
      const p = belegBereinigen({ merchant: 'Lidl', belegart, totalCents: null, items: [{ name: 'Milch', priceCents: 119 }] });
      expect(p.totalCents).toBeNull();
      expect(p.summeAusArtikeln).toBeUndefined();
    }
    // gedruckter Endbetrag wird nie ersetzt
    expect(belegBereinigen({ belegart: 'online_bestellung', totalCents: 999, items: [{ name: 'A', priceCents: 100 }] }))
      .toMatchObject({ totalCents: 999 });
  });

  test('idempotent und robust', () => {
    const einmal = belegBereinigen({ merchant: 'Picnic', belegart: 'online_bestellung' });
    expect(belegBereinigen(einmal)).toEqual(einmal);
    expect(belegBereinigen(null)).toBeNull();
    expect(onlineMerkmal({ merchant: 'REWE Markt', merchantSubtitle: 'Hauptstr. 1, 50667 Köln' })).toBeNull();
    expect(istOnlineBestellung({ belegart: 'online_bestellung' })).toBe(true);
  });
});

describe('deriveStoreAddress: Lieferanschrift ist nie eine Filiale', () => {
  test('Online-Bestellung → null, auch mit strukturierter Anschrift', () => {
    expect(deriveStoreAddress({ belegart: 'online_bestellung', storeAddress: { street: 'Musterweg 1', zip: '12345', city: 'Musterstadt' } })).toBeNull();
  });
  test('Bestand: Stichwort im Kopf → null', () => {
    expect(deriveStoreAddress({ merchant: 'dm', merchantSubtitle: 'Lieferanschrift Musterweg 1, 12345 Musterstadt' }, 'DE')).toBeNull();
  });
  test('normaler Bon unverändert', () => {
    expect(deriveStoreAddress({ merchant: 'Lidl', merchantSubtitle: 'Hüttenweg 50, 14195 Berlin', belegart: 'kassenbon' }, 'DE'))
      .toMatchObject({ street: 'Hüttenweg 50', zip: '14195', city: 'Berlin' });
  });
});

describe('resolveMerchant: Eigenmarken-Stufe bei Online-Bestellungen', () => {
  const gg = [{ name: 'G&G Mayonnaise' }, { name: 'G&G H-Milch' }];
  test('Picnic mit G&G-Artikeln: im Laden-Weg EDEKA, ohne Eigenmarke unbekannt', async () => {
    expect((await resolveMerchant('Picnic GmbH', 'DE', gg))?.id).toBe('edeka');
    expect(await resolveMerchant('Picnic GmbH', 'DE', gg, { eigenmarke: false })).toBeNull();
  });
  test('dm online: über den Namen erkannt, unabhängig von der Eigenmarken-Stufe', async () => {
    expect((await resolveMerchant('dm-drogerie markt GmbH + Co. KG', 'DE', [], { eigenmarke: false }))?.id).toBe('dm');
  });
  test('selbstständiger EDEKA-Kaufmann (Laden) bleibt über die Eigenmarke erkannt', async () => {
    expect((await resolveMerchant('Peter Frauen GmbH & Co.KG', 'DE', gg))?.id).toBe('edeka');
  });
});

describe('Prompt v1.5', () => {
  test('Schema: Belegart (Aufzählung), Bestellnummer, Vollständigkeit', () => {
    expect(PROMPT.VERSION).toBe('v1.5');
    expect(PROMPT.RESPONSE_SCHEMA.properties.belegart).toMatchObject({ type: 'string', nullable: true, enum: ['kassenbon', 'app_kassenbon', 'online_bestellung', 'sonstiges'] });
    expect(PROMPT.RESPONSE_SCHEMA.properties.bestellnummer).toEqual({ type: 'string', nullable: true });
    expect(PROMPT.RESPONSE_SCHEMA.properties.bonComplete).toEqual({ type: 'boolean', nullable: true });
    expect(PROMPT.SYSTEM_PROMPT).toMatch(/online_bestellung/);
    expect(PROMPT.SYSTEM_PROMPT).toMatch(/storeAddress und merchantSubtitle IMMER\s+null/);
  });
  test('Zweitprüfung erbt bonComplete aus dem Haupt-Prompt, Version referee-v2+v1.5', () => {
    expect(REFEREE.VERSION).toBe('referee-v2+v1.5');
    expect(REFEREE.SYSTEM_PROMPT.match(/\*\*bonComplete\*\*/g)).toHaveLength(1);
    expect(REFEREE.RESPONSE_SCHEMA.properties.bonComplete).toEqual({ type: 'boolean', nullable: true });
    expect(REFEREE.RESPONSE_SCHEMA.properties.basketDiscounts).toBeDefined();
  });
});

// ─── Bon-Lauf ──────────────────────────────────────────────────────

function bonAnlegen(id, parsed) {
  const items = ['Milch', 'Brot', 'Butter', 'Käse', 'Eier', 'Saft'].map((name, i) => ({ name, priceCents: 100 + i, qty: 1 }));
  const total = items.reduce((s, it) => s + it.priceCents, 0);
  fake.store.set(`receipts/${id}`, {
    userId: UID, status: 'ocr_pending', campaignId: 'c1',
    createdAt: fake.zeit(Date.now() - 60 * 60 * 1000),
    storage: { bucket: 'b', path: `cashback-uploads/${UID}/${id}.jpg` },
    ocr: {
      engine: 'gemini-robust', model: 'test', promptVersion: 'test',
      parsed: { isReceipt: true, bonCountry: 'DE', bonDate: GESTERN, bonTime: null, totalCents: total, items, ...parsed },
      robust: { confidence: 'high', attempts: 2 },
      reconciliation: { ok: true, sumItemsCents: total, deltaCents: 0, signedDeltaCents: 0, direction: 'exact' },
    },
  });
}
const verarbeiten = (id) => fn.processCashback({ id: `ev-${id}`, data: { message: { json: { cashbackId: id, uid: UID } } } });
const ggArtikel = ['G&G Mayonnaise', 'G&G H-Milch', 'G&G Butter', 'Brot', 'Eier', 'Saft'].map((name, i) => ({ name, priceCents: 100 + i, qty: 1 }));
const ggTotal = ggArtikel.reduce((s, it) => s + it.priceCents, 0);

describe('Bon-Lauf mit Online-Bestellungen', () => {
  test('dm-Online-Bestellung: bezahlt, aber ohne Filiale, ohne Nutzer-Region, keine Anschrift am Bon', async () => {
    bonAnlegen('d1', {
      merchant: 'dm-drogerie markt GmbH + Co. KG', merchantSubtitle: 'Lieferadresse: Max Muster, Musterweg 1, 12345 Musterstadt',
      storeAddress: { street: 'Musterweg 1', zip: '12345', city: 'Musterstadt' }, belegart: 'online_bestellung',
    });
    await verarbeiten('d1');
    const bon = fake.store.get('receipts/d1');
    expect(bon).toMatchObject({ status: 'approved', belegart: 'online_bestellung', store: null });
    expect(bon.ocr.parsed).toMatchObject({ merchantSubtitle: null, storeAddress: null, onlineMerkmal: 'modell' });
    expect(fake.store.get(`users/${UID}/cashback_status/d1`)).toMatchObject({ storeCity: null, storeZip: null, belegart: 'online_bestellung' });
    expect(fake.store.get(`users/${UID}`).region).toBeUndefined();
    const positionen = [...fake.store.entries()].filter(([k]) => k.startsWith(`users/${UID}/purchased_products/d1_`)).map(([, v]) => v);
    expect(positionen.length).toBeGreaterThan(0);
    for (const p of positionen) expect(p).toMatchObject({ storeStreet: null, storeZip: null, storeCity: null, belegart: 'online_bestellung' });
  });

  test("Picnic-Rechnung mit G&G-Artikeln, eigenmarkeNurLadenbon true → unknown_merchant", async () => {
    fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, eigenmarkeNurLadenbon: true });
    bonAnlegen('p1', { merchant: 'Picnic GmbH', belegart: 'online_bestellung', items: ggArtikel, totalCents: ggTotal });
    const b = fake.store.get('receipts/p1');
    b.ocr.reconciliation = { ok: true, sumItemsCents: ggTotal, deltaCents: 0, signedDeltaCents: 0, direction: 'exact' };
    await verarbeiten('p1');
    expect(fake.store.get('receipts/p1')).toMatchObject({ status: 'rejected', rejectReason: 'unknown_merchant', cashbackCents: 0 });
  });

  test("'shadow': Picnic wird wie bisher als EDEKA bezahlt und protokolliert", async () => {
    fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, eigenmarkeNurLadenbon: 'shadow' });
    bonAnlegen('p2', { merchant: 'Picnic GmbH', belegart: 'online_bestellung', items: ggArtikel, totalCents: ggTotal });
    await verarbeiten('p2');
    expect(fake.store.get('receipts/p2')).toMatchObject({ status: 'approved', merchant: { id: 'edeka' } });
    const log = global.__logs.find((l) => l[0] === 'eigenmarke-beobachtung');
    expect(log[1]).toMatchObject({ markt: 'edeka', grund: 'online_bestellung', wuerde: 'unknown_merchant' });
  });

  test('Ladenbon eines selbstständigen EDEKA-Kaufmanns (mit Uhrzeit) bleibt bezahlt, auch mit scharfem Schalter', async () => {
    fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, eigenmarkeNurLadenbon: true });
    bonAnlegen('e1', { merchant: 'Peter Frauen GmbH & Co.KG', merchantSubtitle: 'Am Markt 3, 25348 Glückstadt', belegart: 'kassenbon', bonTime: '09:12', items: ggArtikel, totalCents: ggTotal });
    await verarbeiten('e1');
    expect(fake.store.get('receipts/e1')).toMatchObject({ status: 'approved', merchant: { id: 'edeka' }, store: { zip: '25348' } });
    expect(fake.store.get(`users/${UID}`).region).toMatchObject({ zip: '25348' });
  });

  test('Picnic mit abgeschnittenem Kopf (liest sich als App-Bon ohne Händler, ohne Uhrzeit) → unknown_merchant', async () => {
    // Prüfrunde 04.10.: echte Lesung v1.5 — belegart app_kassenbon, merchant null.
    fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, eigenmarkeNurLadenbon: true });
    bonAnlegen('p3', { merchant: null, belegart: 'app_kassenbon', bonTime: null, items: ggArtikel, totalCents: ggTotal });
    await verarbeiten('p3');
    expect(fake.store.get('receipts/p3')).toMatchObject({ status: 'rejected', rejectReason: 'unknown_merchant' });
  });

  test('schon bezahlter Picnic-Bon: Schalter wird scharf, erneute Zustellung storniert NICHT', async () => {
    bonAnlegen('p4', { merchant: 'Picnic GmbH', belegart: 'online_bestellung', items: ggArtikel, totalCents: ggTotal });
    await verarbeiten('p4');
    expect(fake.store.get('receipts/p4')).toMatchObject({ status: 'approved', merchant: { id: 'edeka' } });
    const saldo = fake.store.get(`users/${UID}`).cashback_balance_cents;
    fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, eigenmarkeNurLadenbon: true });
    fake.store.set('receipts/p4', { ...fake.store.get('receipts/p4'), status: 'ocr_pending' });
    await verarbeiten('p4');
    expect(fake.store.get('receipts/p4')).toMatchObject({ status: 'approved', merchant: { id: 'edeka' } });
    const ledger = [...fake.store.entries()].filter(([k]) => k.startsWith(`users/${UID}/cashback_ledger/`)).map(([, v]) => v);
    expect(ledger.filter((l) => l.type === 'reverse')).toHaveLength(0);
    expect(fake.store.get(`users/${UID}`).cashback_balance_cents).toBe(saldo);
  });

  test('Ledger nicht lesbar bei scharfem Schalter → Wiederholung, nie eine Ablehnung', async () => {
    fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, eigenmarkeNurLadenbon: true });
    bonAnlegen('p5', { merchant: 'Picnic GmbH', belegart: 'online_bestellung', items: ggArtikel, totalCents: ggTotal });
    fake.fehler.add(`users/${UID}/cashback_ledger`);
    await verarbeiten('p5').catch(() => {});
    const bon = fake.store.get('receipts/p5');
    expect(bon.status).not.toBe('rejected');
    expect(bon.lastError || '').toMatch(/ledger precheck failed/);
  });

  test('dm-Online-Rechnung, Seite 1 ohne Endbetrag (v1.5-Lesung) → Artikelsumme, bezahlt wie unter v1.4', async () => {
    bonAnlegen('d2', { merchant: 'dm-drogerie markt GmbH + Co. KG', belegart: 'online_bestellung', totalCents: null, bonComplete: false });
    // Gespeicherte v1.5-Lesung ohne Endbetrag samt gescheitertem Abgleich: die
    // Bereinigung auf dem Cache-Pfad setzt die Summe ein und rechnet neu ab.
    fake.store.get('receipts/d2').ocr.reconciliation = { ok: false, sumItemsCents: 615, deltaCents: null, signedDeltaCents: null, direction: 'unknown' };
    await verarbeiten('d2');
    expect(fake.store.get('receipts/d2')).toMatchObject({ status: 'approved', bonTotalCents: 615 });
    expect(fake.store.get('receipts/d2').ocr.parsed).toMatchObject({ totalCents: 615, summeAusArtikeln: true });
  });
});
