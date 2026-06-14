import {
  diffTier,
  extractEans,
  extractIngredients,
  extractNaehrwerte,
  formatNutritionValue,
  hasIngredients,
  hasNaehrwerte,
  mergeNaehrwerte,
  NaehrwerteShape,
} from '../productNutrition';

// ---------------------------------------------------------------------------
// extractEans
// ---------------------------------------------------------------------------
describe('extractEans', () => {
  it('returns [] for null/undefined', () => {
    expect(extractEans(null)).toEqual([]);
    expect(extractEans(undefined)).toEqual([]);
  });

  it('returns [] for a product without any EAN-ish fields', () => {
    expect(extractEans({ name: 'Foo', preis: 1.99 })).toEqual([]);
  });

  it('extrahiert aus EANs[]', () => {
    expect(extractEans({ EANs: ['4060800154842'] })).toEqual(['4060800154842']);
  });

  it('extrahiert aus eans[] (lowercase array)', () => {
    expect(extractEans({ eans: ['4060800154842'] })).toEqual(['4060800154842']);
  });

  it('liest die Singles EAN/ean/gtin/GTIN', () => {
    expect(
      extractEans({ EAN: '10000001', ean: '20000002', gtin: '30000003', GTIN: '40000004' }),
    ).toEqual(['10000001', '20000002', '30000003', '40000004']);
  });

  it('respektiert die Reihenfolge: Singles → EANs[] → eans[] → moreInformation', () => {
    const r = extractEans({
      EAN: '11111111',
      ean: '12121212',
      gtin: '13131313',
      GTIN: '14141414',
      EANs: ['20000001', '20000002'],
      eans: ['30000001'],
      moreInformation: { EAN: '40000001', ean: '40000002' },
    });
    expect(r).toEqual([
      '11111111',
      '12121212',
      '13131313',
      '14141414',
      '20000001',
      '20000002',
      '30000001',
      '40000001',
      '40000002',
    ]);
  });

  it('merged Singles + Arrays + moreInformation und dedupt', () => {
    const r = extractEans({
      EAN: '11111111',
      ean: '22222222',
      gtin: '11111111', // dup von EAN
      EANs: ['33333333'],
      eans: ['22222222'], // dup von ean
      moreInformation: { EAN: '44444444' },
    });
    expect(r).toEqual(['11111111', '22222222', '33333333', '44444444']);
  });

  it('filtert Werte < 8 Zeichen raus', () => {
    expect(extractEans({ EAN: '123', ean: '12345678' })).toEqual(['12345678']);
  });

  it('akzeptiert genau 8 Zeichen (>= 8 Grenze inklusiv)', () => {
    expect(extractEans({ EAN: '12345678' })).toEqual(['12345678']);
    expect(extractEans({ EAN: '1234567' })).toEqual([]); // 7 Zeichen → raus
  });

  it('coerced Zahlen zu Strings', () => {
    expect(extractEans({ ean: 4060800154842 })).toEqual(['4060800154842']);
  });

  it('coerced Zahlen in Arrays zu Strings', () => {
    expect(extractEans({ EANs: [4060800154842, 4060800154843] })).toEqual([
      '4060800154842',
      '4060800154843',
    ]);
  });

  it('trimmt String-Werte vor dem Längen-Check', () => {
    expect(extractEans({ EAN: '  4060800154842  ' })).toEqual(['4060800154842']);
  });

  it('verwirft eine getrimmte Zahl die unter 8 Zeichen fällt', () => {
    // "  123  " → trim → "123" → 3 Zeichen → raus
    expect(extractEans({ EAN: '  123  ' })).toEqual([]);
  });

  it('überspringt null/undefined Einträge in den Singles', () => {
    expect(extractEans({ EAN: null, ean: undefined, gtin: '40000004' })).toEqual([
      '40000004',
    ]);
  });

  it('ignoriert nicht-Array EANs/eans', () => {
    // EANs ist hier ein String, kein Array → wird NICHT gespreadet, kein Crash
    expect(extractEans({ EANs: 'nope', ean: '40000004' })).toEqual(['40000004']);
  });

  it('dedupt eine Zahl gegen denselben String', () => {
    // gtin als Zahl, GTIN als String mit gleichem Wert → nur einmal
    expect(extractEans({ gtin: 40000004, GTIN: '40000004' })).toEqual(['40000004']);
  });
});

// ---------------------------------------------------------------------------
// extractIngredients
// ---------------------------------------------------------------------------
describe('extractIngredients', () => {
  it('returns "" for null/undefined', () => {
    expect(extractIngredients(null)).toBe('');
    expect(extractIngredients(undefined)).toBe('');
  });

  it('returns "" wenn keine Zutaten vorhanden', () => {
    expect(extractIngredients({ name: 'Foo' })).toBe('');
  });

  it('bevorzugt neues Schema attr_ingredientStatement', () => {
    expect(
      extractIngredients({
        attr_ingredientStatement: 'Zucker, Glukosesirup',
        zutaten: 'LEGACY sollte nicht gewinnen',
      }),
    ).toBe('Zucker, Glukosesirup');
  });

  it('fällt auf legacy zutaten zurück', () => {
    expect(extractIngredients({ zutaten: 'Wasser, Salz' })).toBe('Wasser, Salz');
  });

  it('fällt auf ingredients (legacy alt) zurück', () => {
    expect(extractIngredients({ ingredients: 'Milch, Kakao' })).toBe('Milch, Kakao');
  });

  it('fällt auf moreInformation.zutaten zurück', () => {
    expect(extractIngredients({ moreInformation: { zutaten: 'Mehl, Hefe' } })).toBe(
      'Mehl, Hefe',
    );
  });

  it('kollabiert Whitespace und trimmt', () => {
    expect(
      extractIngredients({ attr_ingredientStatement: '  Zucker,\n\t Glukose   sirup  ' }),
    ).toBe('Zucker, Glukose sirup');
  });

  it('überspringt ein leeres / nur-Whitespace Feld und nimmt das nächste', () => {
    expect(
      extractIngredients({ attr_ingredientStatement: '   ', zutaten: 'Wasser' }),
    ).toBe('Wasser');
  });

  it('ignoriert nicht-string Kandidaten', () => {
    // attr_ingredientStatement als number → ignoriert, fällt auf zutaten
    expect(
      extractIngredients({ attr_ingredientStatement: 123, zutaten: 'Wasser' }),
    ).toBe('Wasser');
  });

  it('returns "" wenn alle Kandidaten leer/whitespace sind', () => {
    expect(
      extractIngredients({
        attr_ingredientStatement: '   ',
        zutaten: '',
        moreInformation: { zutaten: '\n\t' },
      }),
    ).toBe('');
  });
});

// ---------------------------------------------------------------------------
// extractNaehrwerte — neues nutr_* Schema
// ---------------------------------------------------------------------------
describe('extractNaehrwerte (nutr_* Schema)', () => {
  it('returns null for null/undefined', () => {
    expect(extractNaehrwerte(null)).toBeNull();
    expect(extractNaehrwerte(undefined)).toBeNull();
  });

  it('returns null wenn kein Feld gesetzt', () => {
    expect(extractNaehrwerte({ name: 'Foo' })).toBeNull();
  });

  it('liest ein vollständiges nutr_* Doc', () => {
    const result = extractNaehrwerte({
      nutr_Energie_val: 395,
      nutr_Energie_unit: 'kcal',
      nutr_Fett_val: 7.4,
      nutr_FettdavongesttigteFettsuren_val: 2.1,
      nutr_Kohlenhydrate_val: 70,
      nutr_KohlenhydratedavonZucker_val: 55,
      nutr_Eiwei_val: 4.2,
      nutr_Ballaststoffe_val: 1.5,
      nutr_Salz_val: 0.2,
      nutr_serving_size: 100,
      nutr_serving_unit: 'g',
    });
    expect(result).toEqual({
      brennwertKcal: 395,
      fett: 7.4,
      gesaettigteFettsaeuren: 2.1,
      kohlenhydrate: 70,
      zucker: 55,
      eiweiss: 4.2,
      ballaststoffe: 1.5,
      salz: 0.2,
      servingSize: 100,
      servingUnit: 'g',
    });
  });

  it('rundet kcal-Energie auf eine ganze Zahl', () => {
    expect(extractNaehrwerte({ nutr_Energie_val: 395.7, nutr_Energie_unit: 'kcal' })).toEqual(
      { brennwertKcal: 396 },
    );
  });

  it('konvertiert kJ → kcal (1 kcal = 4.184 kJ)', () => {
    // 1653 kJ / 4.184 = 395.07 → round → 395
    expect(extractNaehrwerte({ nutr_Energie_val: 1653, nutr_Energie_unit: 'kJ' })).toEqual({
      brennwertKcal: 395,
    });
  });

  it('konvertiert kilojoule (Langform, case-insensitive)', () => {
    expect(
      extractNaehrwerte({ nutr_Energie_val: 1653, nutr_Energie_unit: 'KILOJOULE' }),
    ).toEqual({ brennwertKcal: 395 });
  });

  it('behandelt fehlende/unbekannte Energie-Unit als kcal (rundet)', () => {
    expect(extractNaehrwerte({ nutr_Energie_val: 200.4 })).toEqual({ brennwertKcal: 200 });
  });

  it('parst string-Werte mit Komma als Dezimaltrenner', () => {
    expect(extractNaehrwerte({ nutr_Fett_val: '7,4' })).toEqual({ fett: 7.4 });
  });

  it('liest die korrigierte gesättigte-Fettsäuren-Variante (gesaettigte)', () => {
    expect(
      extractNaehrwerte({ nutr_FettdavongesaettigteFettsaeuren_val: 1.1 }),
    ).toEqual({ gesaettigteFettsaeuren: 1.1 });
  });

  it('priorisiert die Tippfehler-Variante (gesttigte) vor Korrekturen', () => {
    expect(
      extractNaehrwerte({
        nutr_FettdavongesttigteFettsuren_val: 2.2,
        nutr_FettdavongesaettigteFettsaeuren_val: 9.9,
      }),
    ).toEqual({ gesaettigteFettsaeuren: 2.2 });
  });

  it('liest Eiweiss aus der Korrektur-Variante nutr_Eiweiss_val', () => {
    expect(extractNaehrwerte({ nutr_Eiweiss_val: 3.3 })).toEqual({ eiweiss: 3.3 });
  });

  it('setzt servingUnit nur wenn es ein string ist', () => {
    const r = extractNaehrwerte({ nutr_Fett_val: 1, nutr_serving_unit: 100 as any });
    expect(r).toEqual({ fett: 1 });
    expect(r?.servingUnit).toBeUndefined();
  });

  it('ignoriert leere Strings (toNum → undefined)', () => {
    expect(extractNaehrwerte({ nutr_Fett_val: '', nutr_Salz_val: 0.5 })).toEqual({
      salz: 0.5,
    });
  });

  it('behält den Wert 0 (0 ist != null)', () => {
    expect(extractNaehrwerte({ nutr_Salz_val: 0 })).toEqual({ salz: 0 });
  });
});

// ---------------------------------------------------------------------------
// extractNaehrwerte — legacy Schema
// ---------------------------------------------------------------------------
describe('extractNaehrwerte (legacy Schema)', () => {
  it('liest aus naehrwerte{} wenn kein nutr_* da ist', () => {
    const result = extractNaehrwerte({
      naehrwerte: {
        brennwertKcal: 250,
        fett: 5,
        gesaettigteFettsaeuren: 2,
        kohlenhydrate: 30,
        zucker: 10,
        eiweiss: 8,
        ballaststoffe: 3,
        salz: 1,
      },
    });
    expect(result).toEqual({
      brennwertKcal: 250,
      fett: 5,
      gesaettigteFettsaeuren: 2,
      kohlenhydrate: 30,
      zucker: 10,
      eiweiss: 8,
      ballaststoffe: 3,
      salz: 1,
    });
  });

  it('liest die alternativen legacy-Keys (energie/gesaettigt/eiweis)', () => {
    expect(
      extractNaehrwerte({
        naehrwerte: { energie: 300, gesaettigt: 1.2, eiweis: 9 },
      }),
    ).toEqual({ brennwertKcal: 300, gesaettigteFettsaeuren: 1.2, eiweiss: 9 });
  });

  it('liest aus moreInformation wenn naehrwerte fehlt', () => {
    expect(extractNaehrwerte({ moreInformation: { fett: 4, salz: 0.5 } })).toEqual({
      fett: 4,
      salz: 0.5,
    });
  });

  it('parst legacy-Strings mit Komma', () => {
    expect(extractNaehrwerte({ naehrwerte: { fett: '4,5' } })).toEqual({ fett: 4.5 });
  });

  it('returns null wenn naehrwerte ein leeres Objekt ist', () => {
    expect(extractNaehrwerte({ naehrwerte: {} })).toBeNull();
  });

  it('bevorzugt das neue nutr_* Schema vor legacy naehrwerte', () => {
    // Beide vorhanden → nutr_* gewinnt komplett (legacy wird nicht gemerged)
    const r = extractNaehrwerte({
      nutr_Fett_val: 7.4,
      naehrwerte: { fett: 99, salz: 5 },
    });
    expect(r).toEqual({ fett: 7.4 });
    expect(r?.salz).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hasIngredients / hasNaehrwerte
// ---------------------------------------------------------------------------
describe('hasIngredients', () => {
  it('true wenn Zutaten vorhanden (neues Schema)', () => {
    expect(hasIngredients({ attr_ingredientStatement: 'Wasser' })).toBe(true);
  });

  it('true für legacy zutaten', () => {
    expect(hasIngredients({ zutaten: 'Wasser, Salz' })).toBe(true);
  });

  it('false wenn keine Zutaten', () => {
    expect(hasIngredients({ name: 'Foo' })).toBe(false);
  });

  it('false für null', () => {
    expect(hasIngredients(null)).toBe(false);
  });

  it('false wenn Zutaten nur Whitespace', () => {
    expect(hasIngredients({ zutaten: '   ' })).toBe(false);
  });
});

describe('hasNaehrwerte', () => {
  it('true wenn nutr_* Werte vorhanden', () => {
    expect(hasNaehrwerte({ nutr_Fett_val: 5 })).toBe(true);
  });

  it('true für legacy naehrwerte', () => {
    expect(hasNaehrwerte({ naehrwerte: { fett: 5 } })).toBe(true);
  });

  it('false wenn keine Naehrwerte', () => {
    expect(hasNaehrwerte({ name: 'Foo' })).toBe(false);
  });

  it('false für null', () => {
    expect(hasNaehrwerte(null)).toBe(false);
  });

  it('true wenn nur ein Wert 0 ist (0 zählt als gesetzt)', () => {
    expect(hasNaehrwerte({ nutr_Salz_val: 0 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatNutritionValue
// ---------------------------------------------------------------------------
describe('formatNutritionValue', () => {
  it('returns null für null/undefined', () => {
    expect(formatNutritionValue(null)).toBeNull();
    expect(formatNutritionValue(undefined)).toBeNull();
  });

  it('returns null für NaN/Infinity', () => {
    expect(formatNutritionValue(NaN)).toBeNull();
    expect(formatNutritionValue(Infinity)).toBeNull();
    expect(formatNutritionValue(-Infinity)).toBeNull();
  });

  it('rundet auf 2 Dezimalstellen (Default)', () => {
    expect(formatNutritionValue(8.347)).toBe('8,35');
  });

  it('strippt trailing Nullen ("8,50" → "8,5")', () => {
    expect(formatNutritionValue(8.5)).toBe('8,5');
  });

  it('strippt alle Nachkommastellen einer Ganzzahl ("8,00" → "8")', () => {
    expect(formatNutritionValue(8)).toBe('8');
  });

  it('nutzt deutsches Dezimal-Komma', () => {
    expect(formatNutritionValue(0.2)).toBe('0,2');
  });

  it('formatiert 0 korrekt', () => {
    expect(formatNutritionValue(0)).toBe('0');
  });

  it('respektiert ein custom decimals-Argument', () => {
    expect(formatNutritionValue(8.347, 1)).toBe('8,3');
    expect(formatNutritionValue(8.347, 0)).toBe('8');
  });

  it('behandelt negative Werte', () => {
    expect(formatNutritionValue(-3.456)).toBe('-3,46');
  });
});

// ---------------------------------------------------------------------------
// diffTier
// ---------------------------------------------------------------------------
describe('diffTier', () => {
  it('"none" wenn ein Wert kein number ist', () => {
    expect(diffTier('5' as any, 10)).toBe('none');
    expect(diffTier(5, null)).toBe('none');
    expect(diffTier(undefined, 10)).toBe('none');
  });

  it('"none" für NaN/Infinity', () => {
    expect(diffTier(NaN, 10)).toBe('none');
    expect(diffTier(5, Infinity)).toBe('none');
  });

  it('"none" wenn beide 0 sind (max === 0)', () => {
    expect(diffTier(0, 0)).toBe('none');
  });

  it('"none" für identische Werte', () => {
    expect(diffTier(10, 10)).toBe('none');
  });

  it('"none" bei Diff < 2 %', () => {
    // |100-101| / 101 = 0.99 % → none
    expect(diffTier(100, 101)).toBe('none');
  });

  it('"warn" bei 2 % <= Diff < 10 %', () => {
    // |100-95| / 100 = 5 % → warn
    expect(diffTier(100, 95)).toBe('warn');
  });

  it('"warn" exakt an der 2 %-Grenze', () => {
    // |100-98| / 100 = 2 % → warn (>= 2)
    expect(diffTier(100, 98)).toBe('warn');
  });

  it('"crit" bei Diff >= 10 %', () => {
    // |100-90| / 100 = 10 % → crit
    expect(diffTier(100, 90)).toBe('crit');
  });

  it('"crit" wenn ein Wert 0 und der andere != 0 (100 % Diff)', () => {
    expect(diffTier(0, 5)).toBe('crit');
  });

  it('ist symmetrisch (Argumentreihenfolge egal)', () => {
    expect(diffTier(95, 100)).toBe(diffTier(100, 95));
  });

  it('nutzt max(|a|,|b|) als Nenner (negative Werte)', () => {
    // |(-100)-(-90)| / 100 = 10 % → crit
    expect(diffTier(-100, -90)).toBe('crit');
  });
});

// ---------------------------------------------------------------------------
// mergeNaehrwerte
// ---------------------------------------------------------------------------
describe('mergeNaehrwerte', () => {
  it('nimmt alle primary-Werte wenn vorhanden, usedFallback=false', () => {
    const primary: NaehrwerteShape = { fett: 5, salz: 1 };
    const fallback: NaehrwerteShape = { fett: 99, salz: 99 };
    expect(mergeNaehrwerte(primary, fallback)).toEqual({
      merged: { fett: 5, salz: 1 },
      usedFallback: false,
    });
  });

  it('füllt fehlende Felder aus dem Fallback, usedFallback=true', () => {
    const primary: NaehrwerteShape = { fett: 5 };
    const fallback: NaehrwerteShape = { fett: 99, salz: 1, eiweiss: 8 };
    expect(mergeNaehrwerte(primary, fallback)).toEqual({
      merged: { fett: 5, salz: 1, eiweiss: 8 },
      usedFallback: true,
    });
  });

  it('behandelt primary=null (alles aus Fallback)', () => {
    const fallback: NaehrwerteShape = { fett: 4, salz: 0.5 };
    expect(mergeNaehrwerte(null, fallback)).toEqual({
      merged: { fett: 4, salz: 0.5 },
      usedFallback: true,
    });
  });

  it('behandelt fallback=null (nur primary)', () => {
    const primary: NaehrwerteShape = { fett: 4 };
    expect(mergeNaehrwerte(primary, null)).toEqual({
      merged: { fett: 4 },
      usedFallback: false,
    });
  });

  it('beide null → leerer merge, usedFallback=false', () => {
    expect(mergeNaehrwerte(null, null)).toEqual({ merged: {}, usedFallback: false });
  });

  it('behält den primary-Wert 0 (0 != null) und nutzt den Fallback NICHT', () => {
    const primary: NaehrwerteShape = { salz: 0 };
    const fallback: NaehrwerteShape = { salz: 5 };
    expect(mergeNaehrwerte(primary, fallback)).toEqual({
      merged: { salz: 0 },
      usedFallback: false,
    });
  });

  it('überspringt einen leeren servingUnit-String im primary und nimmt den Fallback', () => {
    const primary: NaehrwerteShape = { servingUnit: '' };
    const fallback: NaehrwerteShape = { servingUnit: 'g' };
    expect(mergeNaehrwerte(primary, fallback)).toEqual({
      merged: { servingUnit: 'g' },
      usedFallback: true,
    });
  });

  it('überspringt auch leeren servingUnit-String im Fallback', () => {
    const primary: NaehrwerteShape = { fett: 5 };
    const fallback: NaehrwerteShape = { servingUnit: '' };
    expect(mergeNaehrwerte(primary, fallback)).toEqual({
      merged: { fett: 5 },
      usedFallback: false,
    });
  });

  it('merged Felder aus beiden Quellen gemischt', () => {
    const primary: NaehrwerteShape = { brennwertKcal: 250, fett: 5 };
    const fallback: NaehrwerteShape = { kohlenhydrate: 30, zucker: 10, fett: 99 };
    const { merged, usedFallback } = mergeNaehrwerte(primary, fallback);
    expect(merged).toEqual({ brennwertKcal: 250, fett: 5, kohlenhydrate: 30, zucker: 10 });
    expect(usedFallback).toBe(true);
  });
});
