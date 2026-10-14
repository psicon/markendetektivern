'use strict';
const { chainFromItems, normalize, aliasMatch } = require('../lib/merchant');

// Selbstständige Kaufleute drucken ihre Firma in den Bonkopf, nicht die Kette.
// Eigenmarken sind kettenexklusiv und verraten die Kette trotzdem.
describe('chainFromItems', () => {
  test('ein einziger G&G-Artikel genügt für EDEKA', () => {
    expect(chainFromItems([{ name: 'G&G Mayonnaise' }])).toMatchObject({ id: 'edeka', hits: 1 });
  });

  test('realer Bon Rüger/Glückstadt (Kopf: „Peter Frauen GmbH & Co.KG")', () => {
    const items = [
      { name: 'Herz.Jogh.Him' }, { name: 'Müller Jogh.E' }, { name: 'Herz.Jogh.Pfi.Mar.' },
      { name: 'Mül.Knusp.Joghurt' }, { name: 'Frau.Weizenm.Brot' }, { name: 'G&G Mayonnaise' },
    ];
    expect(chainFromItems(items)).toMatchObject({ id: 'edeka' });
  });

  test('Schreibweisen von Gut&Günstig', () => {
    expect(chainFromItems([{ name: 'Gut&Günstig H-Milch' }]).id).toBe('edeka');
    expect(chainFromItems([{ name: 'GUT UND GÜNSTIG Butter' }]).id).toBe('edeka');
    expect(chainFromItems([{ name: 'G & G Mehl' }]).id).toBe('edeka');
  });

  test('andere Ketten an ihren Eigenmarken', () => {
    expect(chainFromItems([{ name: 'K-Classic Mandeln' }]).id).toBe('kaufland');
    expect(chainFromItems([{ name: 'Milbona Schlagsahne' }]).id).toBe('lidl');
    expect(chainFromItems([{ name: 'Milsani Joghurt' }]).id).toBe('aldi');
    expect(chainFromItems([{ name: 'REWE Bio Tomaten' }]).id).toBe('rewe');
    expect(chainFromItems([{ name: 'Elkos Spülmittel' }]).id).toBe('netto');
  });

  test('Markenartikel allein verraten nichts', () => {
    expect(chainFromItems([{ name: 'Nutella' }, { name: 'Arla Skyr Drink' }])).toBeNull();
  });

  test('widersprüchliche Eigenmarken → lieber nichts erkennen', () => {
    expect(chainFromItems([{ name: 'G&G Mayo' }, { name: 'Milbona Sahne' }])).toBeNull();
  });

  test('leere und kaputte Eingaben', () => {
    expect(chainFromItems([])).toBeNull();
    expect(chainFromItems(null)).toBeNull();
    expect(chainFromItems([{}, { name: '' }, { name: null }])).toBeNull();
  });
});

// aliasMatch bekommt den normalisierten Namen; normalize() entfernt „&".
// Ein Token mit „&" trifft deshalb nie (Fall Tempelmann 14.10.2026).
describe('Alias EDEKA-Vertriebslinien über normalize()', () => {
  test.each([
    'nah & gut Hohlfeldt',
    'NAH & GUT',
    'nah&gut Schiwietz',
    'Nah und Gut George',
    'E Center Cramer',
    'Marktkauf Göppingen',
  ])('%s → edeka', (raw) => {
    expect(aliasMatch(normalize(raw))).toMatchObject({ id: 'edeka' });
  });

  test('nahkauf bleibt REWE', () => {
    expect(aliasMatch(normalize('nahkauf Hohlfeldt'))).toMatchObject({ id: 'rewe' });
  });
});
