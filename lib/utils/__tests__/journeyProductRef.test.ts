import { collectionForProductType, JourneyProductType } from '../journeyProductRef';

describe('collectionForProductType', () => {
  it("maps 'brand' → 'markenProdukte'", () => {
    expect(collectionForProductType('brand')).toBe('markenProdukte');
  });

  it("maps 'noname' → 'produkte'", () => {
    expect(collectionForProductType('noname')).toBe('produkte');
  });

  it("maps 'external' → 'external_products' (NOT 'produkte' — Bogus-Ref-Guard)", () => {
    expect(collectionForProductType('external')).toBe('external_products');
    // Kritisch: externe Produkte (productId = EAN) dürfen NIE auf produkte/{EAN}
    // zeigen — das wäre eine nicht-existente Bogus-Ref.
    expect(collectionForProductType('external')).not.toBe('produkte');
  });

  it('covers all three JourneyProductType cases exhaustively', () => {
    const expected: Record<JourneyProductType, string> = {
      brand: 'markenProdukte',
      noname: 'produkte',
      external: 'external_products',
    };
    (Object.keys(expected) as JourneyProductType[]).forEach((t) => {
      expect(collectionForProductType(t)).toBe(expected[t]);
    });
  });
});
