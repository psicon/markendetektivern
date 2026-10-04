'use strict';

/**
 * Markt-Resolver nach Prüfrunde 2 (04.10.2026): ohne gelesenen Händlernamen
 * keine Namensstufen, kein Tippfehler-Abgleich bei Online-Bestellungen.
 * Echte Discounter-Namen wie in der Sammlung `discounter`.
 */

jest.mock('firebase-admin', () => require('./helpers/fakeAdmin').erstelleFakeAdmin());
jest.mock('firebase-functions', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const admin = require('firebase-admin');
const { resolveMerchant } = require('../lib/merchant');

const fake = admin.__fake;
const MAERKTE = { dm: 'dm', penny: 'Penny', rossmann: 'Rossmann', lidl: 'Lidl', edeka: 'EDEKA', norma: 'Norma', rewe: 'REWE' };

beforeAll(() => {
  fake.zuruecksetzen();
  for (const [id, name] of Object.entries(MAERKTE)) fake.store.set(`discounter/${id}`, { name, land: 'DE' });
});

const ARTIKEL = [{ name: 'Kürbis Hok Biol', priceCents: 144 }, { name: 'Eisbergsalat', priceCents: 65 }];
const id = (m) => (m ? m.docId || m.id : null);

describe('ohne gelesenen Händlernamen', () => {
  test.each([[null], [''], ['  '], ['1'], ['eu'], ['A.']])('%p mit Artikeln → kein Markt (früher „dm" über den Tippfehler-Abgleich)', async (name) => {
    expect(await resolveMerchant(name, 'DE', ARTIKEL)).toBeNull();
  });

  test('Eigenmarken-Stufe bleibt: ohne Namen, aber mit Lidl-Eigenmarke → Lidl', async () => {
    const m = await resolveMerchant(null, 'DE', [{ name: 'Milbona Skyr', priceCents: 129 }]);
    expect(m && m.matchVia).toBe('eigenmarke');
  });

  test("nachsichtig (Bestandsschutz) → das alte Ergebnis", async () => {
    const m = await resolveMerchant(null, 'DE', ARTIKEL, { nachsichtig: true });
    expect(m && m.matchVia).toBe('fuzzy');
  });

  test('„DM" und „Lidl" werden weiter erkannt', async () => {
    expect((await resolveMerchant('DM', 'DE', ARTIKEL)).matchVia).toBe('alias');
    expect((await resolveMerchant('Lidl', 'DE', ARTIKEL)).matchVia).toBe('alias');
  });
});

describe('Online-Bestellung: kein Tippfehler-Abgleich (fuzzy: false)', () => {
  test.each([['Denns Online-Shop'], ['DAS FUTTERHAUS'], ['Der Bioladen'], ['aktiv irma'], ['Getränke Hoffmann']])('%s → kein Markt', async (name) => {
    expect(await resolveMerchant(name, 'DE', ARTIKEL, { fuzzy: false })).toBeNull();
  });

  test('gedruckte Namen unserer Märkte bleiben', async () => {
    for (const [name, erwartet] of [['dm.de', 'dm'], ['dm-drogerie markt GmbH + Co. KG', 'dm'], ['Rossmann Online-Shop', 'rossmann'], ['REWE Lieferservice', 'rewe']]) {
      const m = await resolveMerchant(name, 'DE', ARTIKEL, { fuzzy: false });
      expect(m && m.name.toLowerCase()).toBe(MAERKTE[erwartet].toLowerCase());
    }
  });

  test('bei Ladenbons bleibt der Tippfehler-Abgleich (Fehllesungen auf Thermopapier)', async () => {
    expect((await resolveMerchant('PENNV', 'DE', ARTIKEL)).matchVia).toBe('fuzzy');
  });
});

describe('Prüfrunde 3: gedruckte Umsatzsteuer-ID der Kette (Stufe 1b)', () => {
  const { ketteAusUstId } = require('../lib/merchant');

  test.each([
    ['UID Nr.: DE812706034', 'rewe'],
    ['USt-IdNr. DE 812 706 034', 'rewe'],
    ['Steuer-Nr. 123/456 · UST-ID: DE132748925', 'norma'],
    ['DE202748117', 'penny'],
    ['UID Nr.: DE999999999', null],
    ['DE812706034 / DE202748117', null],
    [null, null],
  ])('%p → %p', (kopf, erwartet) => {
    expect(ketteAusUstId(kopf)).toBe(erwartet);
  });

  test('REWE-eBon ohne Namen → REWE über die UID, streng und nachsichtig (vor dem „dm" des Tippfehler-Abgleichs)', async () => {
    for (const nachsichtig of [false, true]) {
      const m = await resolveMerchant(null, 'DE', ARTIKEL, { kopf: 'UID Nr.: DE812706034', nachsichtig });
      expect(m).toMatchObject({ id: 'rewe', matchVia: 'ust_id', land: 'DE' });
    }
  });

  test('ein gelesener Name geht vor; ohne Kopf bleibt es beim bisherigen Ergebnis', async () => {
    expect((await resolveMerchant('Lidl', 'DE', ARTIKEL, { kopf: 'UID Nr.: DE812706034' })).matchVia).toBe('alias');
    expect(await resolveMerchant(null, 'DE', ARTIKEL, { kopf: null })).toBeNull();
    expect(await resolveMerchant(null, 'DE', null, { kopf: 'UID Nr.: DE812706034' })).toMatchObject({ id: 'rewe' });
  });
});
