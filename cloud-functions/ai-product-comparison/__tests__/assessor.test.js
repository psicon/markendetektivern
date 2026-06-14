/**
 * Unit tests for the PURE helpers in src/assessor.js.
 *
 * Covered:
 *   - ASSESSMENT_PROMPT_VERSION (sanity: is a non-empty string)
 *   - snapshotFromDoc  (pure: doc shape -> normalized snapshot)
 *   - isAssessable     (pure: snapshot -> boolean gate)
 *
 * NOT covered: callGeminiAssessment — it constructs a GoogleGenAI client
 * and hits the network. Out of scope for a pure-function unit test.
 *
 * @jest-environment node
 */

'use strict';

const {
  ASSESSMENT_PROMPT_VERSION,
  snapshotFromDoc,
  isAssessable,
  callGeminiAssessment,
} = require('../src/assessor');

describe('module exports', () => {
  test('ASSESSMENT_PROMPT_VERSION is a non-empty string', () => {
    expect(typeof ASSESSMENT_PROMPT_VERSION).toBe('string');
    expect(ASSESSMENT_PROMPT_VERSION.length).toBeGreaterThan(0);
    // Current value — kept loose enough not to be brittle on minor bumps,
    // but asserts the actual shipped version.
    expect(ASSESSMENT_PROMPT_VERSION).toBe('v6');
  });

  test('exports the expected pure helpers + the impure one', () => {
    expect(typeof snapshotFromDoc).toBe('function');
    expect(typeof isAssessable).toBe('function');
    // present in module.exports but intentionally NOT exercised here
    expect(typeof callGeminiAssessment).toBe('function');
  });
});

describe('snapshotFromDoc — null / empty input', () => {
  test('null doc -> null', () => {
    expect(snapshotFromDoc(null)).toBeNull();
  });

  test('undefined doc -> null', () => {
    expect(snapshotFromDoc(undefined)).toBeNull();
  });

  test('empty object -> fully-shaped snapshot with all nutrition null', () => {
    const s = snapshotFromDoc({});
    expect(s).toEqual({
      name: null,
      hersteller: null,
      energy: null,
      fat: null,
      satFat: null,
      carbs: null,
      sugar: null,
      fiber: null,
      protein: null,
      salt: null,
      ingredients: null,
      labels: {
        nutriscore: null,
        ecoscore: null,
        nova: null,
        isVegan: null,
        isVegetarisch: null,
        isBio: null,
      },
    });
  });
});

describe('snapshotFromDoc — energy kJ -> kcal conversion', () => {
  test('unit "kJ" converts: round(2000 / 4.184) = 478', () => {
    expect(snapshotFromDoc({ nutr_Energie_val: 2000, nutr_Energie_unit: 'kJ' }).energy).toBe(478);
  });

  test('unit is lowercased before comparison: "kj" also converts', () => {
    expect(snapshotFromDoc({ nutr_Energie_val: 2000, nutr_Energie_unit: 'kj' }).energy).toBe(478);
  });

  test('unit "KJ" (uppercase) also converts via toLowerCase()', () => {
    expect(snapshotFromDoc({ nutr_Energie_val: 2000, nutr_Energie_unit: 'KJ' }).energy).toBe(478);
  });

  test('conversion rounds (Math.round): 1000 kJ -> round(239.00...) = 239', () => {
    // 1000 / 4.184 = 239.005... -> 239
    expect(snapshotFromDoc({ nutr_Energie_val: 1000, nutr_Energie_unit: 'kJ' }).energy).toBe(239);
  });

  test('unit "kcal" leaves the value untouched', () => {
    expect(snapshotFromDoc({ nutr_Energie_val: 480, nutr_Energie_unit: 'kcal' }).energy).toBe(480);
  });

  test('no unit at all leaves a numeric value untouched (assumed kcal)', () => {
    expect(snapshotFromDoc({ nutr_Energie_val: 480 }).energy).toBe(480);
  });

  test('missing energy value -> null even when unit is kJ', () => {
    expect(snapshotFromDoc({ nutr_Energie_unit: 'kJ' }).energy).toBeNull();
  });

  test('non-string unit (number) is ignored -> no conversion', () => {
    // energyUnit becomes null, so no kJ branch
    expect(snapshotFromDoc({ nutr_Energie_val: 480, nutr_Energie_unit: 12 }).energy).toBe(480);
  });
});

describe('snapshotFromDoc — nutr_* numeric mapping', () => {
  test('maps every nutr_* field to its snapshot key', () => {
    const s = snapshotFromDoc({
      nutr_Fett_val: 10,
      nutr_FettdavongesttigteFettsuren_val: 4,
      nutr_Kohlenhydrate_val: 20,
      nutr_KohlenhydratedavonZucker_val: 8,
      nutr_Ballaststoffe_val: 3,
      nutr_Eiwei_val: 6,
      nutr_Salz_val: 1.2,
    });
    expect(s.fat).toBe(10);
    expect(s.satFat).toBe(4);
    expect(s.carbs).toBe(20);
    expect(s.sugar).toBe(8);
    expect(s.fiber).toBe(3);
    expect(s.protein).toBe(6);
    expect(s.salt).toBe(1.2);
  });

  test('zero is a valid value and is preserved (not treated as missing)', () => {
    const s = snapshotFromDoc({ nutr_Salz_val: 0, nutr_KohlenhydratedavonZucker_val: 0 });
    expect(s.salt).toBe(0);
    expect(s.sugar).toBe(0);
  });
});

describe('snapshotFromDoc — numOrNull behaviour', () => {
  test('string-number coerces to null (no implicit parsing)', () => {
    expect(snapshotFromDoc({ nutr_Fett_val: '10' }).fat).toBeNull();
  });

  test('NaN -> null (Number.isFinite gate)', () => {
    expect(snapshotFromDoc({ nutr_Salz_val: NaN }).salt).toBeNull();
  });

  test('Infinity -> null (Number.isFinite gate)', () => {
    expect(snapshotFromDoc({ nutr_Eiwei_val: Infinity }).protein).toBeNull();
  });

  test('-Infinity -> null', () => {
    expect(snapshotFromDoc({ nutr_Fett_val: -Infinity }).fat).toBeNull();
  });

  test('null/undefined/boolean/object -> null', () => {
    expect(snapshotFromDoc({ nutr_Fett_val: null }).fat).toBeNull();
    expect(snapshotFromDoc({ nutr_Fett_val: undefined }).fat).toBeNull();
    expect(snapshotFromDoc({ nutr_Fett_val: true }).fat).toBeNull();
    expect(snapshotFromDoc({ nutr_Fett_val: {} }).fat).toBeNull();
  });

  test('finite negative numbers are kept (numOrNull only filters non-finite)', () => {
    expect(snapshotFromDoc({ nutr_Fett_val: -5 }).fat).toBe(-5);
  });
});

describe('snapshotFromDoc — name fallback (name || productName || bezeichnung)', () => {
  test('prefers name', () => {
    expect(snapshotFromDoc({ name: 'A', productName: 'B', bezeichnung: 'C' }).name).toBe('A');
  });

  test('falls back to productName', () => {
    expect(snapshotFromDoc({ productName: 'B', bezeichnung: 'C' }).name).toBe('B');
  });

  test('falls back to bezeichnung', () => {
    expect(snapshotFromDoc({ bezeichnung: 'C' }).name).toBe('C');
  });

  test('empty-string name is falsy -> falls through to productName', () => {
    expect(snapshotFromDoc({ name: '', productName: 'B' }).name).toBe('B');
  });

  test('no name source -> null', () => {
    expect(snapshotFromDoc({ nutr_Fett_val: 1 }).name).toBeNull();
  });
});

describe('snapshotFromDoc — hersteller fallback (herstellerName || producerName)', () => {
  test('prefers herstellerName', () => {
    expect(snapshotFromDoc({ herstellerName: 'H', producerName: 'P' }).hersteller).toBe('H');
  });

  test('falls back to producerName', () => {
    expect(snapshotFromDoc({ producerName: 'P' }).hersteller).toBe('P');
  });

  test('no source -> null', () => {
    expect(snapshotFromDoc({}).hersteller).toBeNull();
  });
});

describe('snapshotFromDoc — ingredients fallback (attr_ingredientStatement || zutaten)', () => {
  test('prefers attr_ingredientStatement', () => {
    expect(
      snapshotFromDoc({ attr_ingredientStatement: 'Zucker, Milch', zutaten: 'X' }).ingredients,
    ).toBe('Zucker, Milch');
  });

  test('falls back to zutaten', () => {
    expect(snapshotFromDoc({ zutaten: 'Mehl' }).ingredients).toBe('Mehl');
  });

  test('no source -> null', () => {
    expect(snapshotFromDoc({}).ingredients).toBeNull();
  });
});

describe('snapshotFromDoc — labels (produkte field convention)', () => {
  test('reads nutriscore/ecoscore/nova + attr_isVegan/attr_isVegetarisch/attr_isBio', () => {
    const s = snapshotFromDoc({
      nutriscore: 'B',
      ecoscore: 'A',
      nova: 4,
      attr_isVegan: true,
      attr_isVegetarisch: false,
      attr_isBio: true,
    });
    expect(s.labels).toEqual({
      nutriscore: 'b', // lowercased
      ecoscore: 'a', // lowercased
      nova: '4', // numeric coerced to String
      isVegan: true,
      isVegetarisch: false,
      isBio: true,
    });
  });

  test('nova given as a string is kept as a string', () => {
    expect(snapshotFromDoc({ nova: '4' }).labels.nova).toBe('4');
  });

  test('nova given as a number is String()-coerced', () => {
    const nova = snapshotFromDoc({ nova: 4 }).labels.nova;
    expect(nova).toBe('4');
    expect(typeof nova).toBe('string');
  });
});

describe('snapshotFromDoc — labels (external_products field convention)', () => {
  test('reads scoreNutri/scoreEco/scoreNova + isVegan/isVegetarian/isBio', () => {
    const s = snapshotFromDoc({
      scoreNutri: 'C',
      scoreEco: 'D',
      scoreNova: '3',
      isVegan: false,
      isVegetarian: true,
      isBio: false,
    });
    expect(s.labels).toEqual({
      nutriscore: 'c', // lowercased
      ecoscore: 'd', // lowercased
      nova: '3',
      isVegan: false,
      isVegetarisch: true, // mapped from isVegetarian
      isBio: false,
    });
  });

  test('scoreNova numeric is String()-coerced', () => {
    expect(snapshotFromDoc({ scoreNova: 3 }).labels.nova).toBe('3');
  });
});

describe('snapshotFromDoc — labels precedence + type guards', () => {
  test('produkte convention wins over external when both present (?? short-circuit)', () => {
    const s = snapshotFromDoc({
      nutriscore: 'A',
      scoreNutri: 'E',
      ecoscore: 'A',
      scoreEco: 'E',
      nova: 1,
      scoreNova: 9,
    });
    expect(s.labels.nutriscore).toBe('a');
    expect(s.labels.ecoscore).toBe('a');
    expect(s.labels.nova).toBe('1');
  });

  test('attr_isVegan (boolean) takes precedence over isVegan', () => {
    expect(snapshotFromDoc({ attr_isVegan: true, isVegan: false }).labels.isVegan).toBe(true);
  });

  test('non-string nutriscore -> null', () => {
    expect(snapshotFromDoc({ nutriscore: 5 }).labels.nutriscore).toBeNull();
  });

  test('non-string/number nova (object) -> null', () => {
    expect(snapshotFromDoc({ nova: {} }).labels.nova).toBeNull();
  });

  test('non-boolean vegan flags -> null (only real booleans accepted)', () => {
    expect(snapshotFromDoc({ isVegan: 'true' }).labels.isVegan).toBeNull();
    expect(snapshotFromDoc({ attr_isVegetarisch: 1 }).labels.isVegetarisch).toBeNull();
    expect(snapshotFromDoc({ isBio: 'yes' }).labels.isBio).toBeNull();
  });

  test('isBio === false is preserved (not coerced to null)', () => {
    expect(snapshotFromDoc({ attr_isBio: false }).labels.isBio).toBe(false);
  });
});

describe('isAssessable — falsy / not-enough cases', () => {
  test('null snapshot -> false', () => {
    expect(isAssessable(null)).toBe(false);
  });

  test('undefined snapshot -> false', () => {
    expect(isAssessable(undefined)).toBe(false);
  });

  test('empty snapshot (all null) -> false', () => {
    expect(isAssessable(snapshotFromDoc({}))).toBe(false);
  });

  test('name only -> false (name alone is not assessable)', () => {
    expect(isAssessable(snapshotFromDoc({ name: 'Cola' }))).toBe(false);
  });

  test('ingredients of length exactly 5 -> false (strictly > 5 required)', () => {
    // "Milch" trims to 5 chars
    expect(isAssessable(snapshotFromDoc({ zutaten: 'Milch' }))).toBe(false);
  });

  test('ingredients that trim to <= 5 -> false (length is measured after trim)', () => {
    expect(isAssessable(snapshotFromDoc({ zutaten: '  abc  ' }))).toBe(false);
  });

  test('fiber alone -> false (fiber is NOT part of the nutrition gate)', () => {
    expect(isAssessable(snapshotFromDoc({ nutr_Ballaststoffe_val: 3 }))).toBe(false);
  });

  test('satFat alone -> false (satFat is NOT part of the nutrition gate)', () => {
    expect(isAssessable(snapshotFromDoc({ nutr_FettdavongesttigteFettsuren_val: 3 }))).toBe(false);
  });
});

describe('isAssessable — true via a single nutrition value', () => {
  const cases = [
    ['energy', { nutr_Energie_val: 480 }],
    ['fat', { nutr_Fett_val: 1 }],
    ['carbs', { nutr_Kohlenhydrate_val: 1 }],
    ['sugar', { nutr_KohlenhydratedavonZucker_val: 1 }],
    ['protein', { nutr_Eiwei_val: 1 }],
    ['salt', { nutr_Salz_val: 1 }],
  ];
  test.each(cases)('%s present -> true', (_label, doc) => {
    expect(isAssessable(snapshotFromDoc(doc))).toBe(true);
  });

  test('salt === 0 still counts as present -> true (0 != null)', () => {
    expect(isAssessable(snapshotFromDoc({ nutr_Salz_val: 0 }))).toBe(true);
  });
});

describe('isAssessable — true via ingredients length > 5', () => {
  test('6-char ingredient string -> true', () => {
    // "Milche" = 6 chars
    expect(isAssessable(snapshotFromDoc({ zutaten: 'Milche' }))).toBe(true);
  });

  test('long ingredient statement -> true', () => {
    expect(
      isAssessable(snapshotFromDoc({ attr_ingredientStatement: 'Zucker, Glukosesirup' })),
    ).toBe(true);
  });

  test('ingredients trimmed to > 5 (surrounding whitespace ignored)', () => {
    // "  Milchpulver  " trims to 11 chars
    expect(isAssessable(snapshotFromDoc({ zutaten: '  Milchpulver  ' }))).toBe(true);
  });

  test('nutrition OR ingredients: either alone is enough', () => {
    // nutrition present, ingredients too short -> still true via nutrition
    expect(isAssessable(snapshotFromDoc({ nutr_Fett_val: 1, zutaten: 'X' }))).toBe(true);
  });

  test('non-string ingredients on a hand-built snapshot -> guarded false', () => {
    // isAssessable guards `typeof s.ingredients === 'string'`. A snapshot
    // with no nutrition and a numeric ingredients field is not assessable.
    expect(
      isAssessable({
        name: null,
        energy: null,
        fat: null,
        carbs: null,
        sugar: null,
        protein: null,
        salt: null,
        ingredients: 12345,
      }),
    ).toBe(false);
  });
});
