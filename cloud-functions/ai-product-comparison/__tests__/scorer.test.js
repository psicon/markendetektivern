/**
 * Unit tests for the deterministic nutrition + label scorer.
 *
 * Source: ../src/scorer.js
 * Every assertion below was traced against the actual implementation
 * (thresholds: EQUAL_THRESHOLD = 0.08, STRONG_THRESHOLD = 0.25;
 *  per-nutrient minAbs/weight from NUTRIENT_CONFIG; combineScore tilt
 *  +2.5 "besser" / -3.5 "schlechter"; strength points slight 1.5 /
 *  clear 3.5 / strong 5.0).
 */

const {
  scoreNutrition,
  scoreLabels,
  combineScore,
  NUTRIENT_CONFIG,
} = require('../src/scorer');

// ───────────────────────────────────────────────────────────────────
// NUTRIENT_CONFIG — the exported config that drives scoreNutrition.
// ───────────────────────────────────────────────────────────────────
describe('NUTRIENT_CONFIG', () => {
  it('exposes the seven scored nutrients', () => {
    expect(Object.keys(NUTRIENT_CONFIG).sort()).toEqual(
      ['energy', 'fat', 'fiber', 'protein', 'salt', 'satFat', 'sugar'].sort(),
    );
  });

  it('marks the "lower is better" nutrients correctly', () => {
    expect(NUTRIENT_CONFIG.salt.lowerBetter).toBe(true);
    expect(NUTRIENT_CONFIG.sugar.lowerBetter).toBe(true);
    expect(NUTRIENT_CONFIG.satFat.lowerBetter).toBe(true);
    expect(NUTRIENT_CONFIG.fat.lowerBetter).toBe(true);
    expect(NUTRIENT_CONFIG.energy.lowerBetter).toBe(true);
  });

  it('marks protein + fiber as positive markers (higher is better)', () => {
    expect(NUTRIENT_CONFIG.protein.lowerBetter).toBe(false);
    expect(NUTRIENT_CONFIG.fiber.lowerBetter).toBe(false);
  });

  it('carries the documented weights and minAbs thresholds', () => {
    expect(NUTRIENT_CONFIG.salt).toMatchObject({ weight: 3.0, minAbs: 0.2 });
    expect(NUTRIENT_CONFIG.sugar).toMatchObject({ weight: 3.0, minAbs: 1.5 });
    expect(NUTRIENT_CONFIG.satFat).toMatchObject({ weight: 2.0, minAbs: 0.8 });
    expect(NUTRIENT_CONFIG.fat).toMatchObject({ weight: 1.0, minAbs: 1.5 });
    expect(NUTRIENT_CONFIG.energy).toMatchObject({ weight: 1.0, minAbs: 20 });
    expect(NUTRIENT_CONFIG.protein).toMatchObject({ weight: 1.5, minAbs: 1.5 });
    expect(NUTRIENT_CONFIG.fiber).toMatchObject({ weight: 1.5, minAbs: 1.0 });
  });
});

// ───────────────────────────────────────────────────────────────────
// scoreNutrition
// ───────────────────────────────────────────────────────────────────
describe('scoreNutrition', () => {
  describe('return shape', () => {
    it('returns nutritionPoints + facts + detail', () => {
      const r = scoreNutrition({}, {});
      expect(r).toHaveProperty('nutritionPoints');
      expect(r).toHaveProperty('facts');
      expect(r).toHaveProperty('detail');
      expect(Array.isArray(r.facts)).toBe(true);
      expect(Array.isArray(r.detail)).toBe(true);
    });

    it('scores nothing for two empty objects', () => {
      const r = scoreNutrition({}, {});
      expect(r.nutritionPoints).toBe(0);
      expect(r.facts).toEqual([]);
      expect(r.detail).toEqual([]);
    });
  });

  describe('missing / non-number values', () => {
    it('ignores a nutrient when the NoName side is missing', () => {
      const r = scoreNutrition({}, { salt: 3 });
      expect(r.nutritionPoints).toBe(0);
      expect(r.detail).toEqual([]);
    });

    it('ignores a nutrient when the Original side is missing', () => {
      const r = scoreNutrition({ salt: 2 }, {});
      expect(r.nutritionPoints).toBe(0);
      expect(r.detail).toEqual([]);
    });

    it('ignores a nutrient given as a numeric string (not typeof number)', () => {
      const r = scoreNutrition({ salt: '2' }, { salt: 3 });
      expect(r.nutritionPoints).toBe(0);
      expect(r.detail).toEqual([]);
    });

    it('ignores null on either side', () => {
      expect(scoreNutrition({ salt: null }, { salt: 3 }).nutritionPoints).toBe(0);
      expect(scoreNutrition({ salt: 2 }, { salt: null }).nutritionPoints).toBe(0);
    });

    it('tolerates null/undefined product arguments', () => {
      expect(scoreNutrition(null, null).nutritionPoints).toBe(0);
      expect(scoreNutrition(undefined, undefined).nutritionPoints).toBe(0);
      expect(scoreNutrition(null, { salt: 3 }).nutritionPoints).toBe(0);
    });
  });

  describe('equal / both-zero handling', () => {
    it('treats both-zero as "no data" (skips entirely, not even in detail)', () => {
      const r = scoreNutrition({ salt: 0 }, { salt: 0 });
      expect(r.nutritionPoints).toBe(0);
      expect(r.detail).toEqual([]);
    });

    it('treats identical non-zero values as gleichwertig', () => {
      const r = scoreNutrition({ salt: 3 }, { salt: 3 });
      expect(r.nutritionPoints).toBe(0);
      expect(r.detail).toEqual([{ key: 'salt', dir: 'equal', n: 3, o: 3 }]);
      expect(r.facts).toEqual([]);
    });
  });

  describe('dual-threshold rule (relative >= 8% AND absolute >= minAbs)', () => {
    it('counts when BOTH thresholds are crossed (salt 2 vs 3)', () => {
      // rel = -1/3 = -0.333 (>= 0.08), absDiff = 1.0 (>= 0.2) → counts.
      // |rel| >= 0.25 → strong (1.5x). lowerBetter, NoName has less → better.
      // delta = weight 3.0 * 1.5 = 4.5
      const r = scoreNutrition({ salt: 2 }, { salt: 3 });
      expect(r.nutritionPoints).toBe(4.5);
      expect(r.detail[0]).toMatchObject({ key: 'salt', dir: 'noname' });
      expect(r.facts).toEqual(['Salz: NoName 2g vs Original 3g (NoName weniger)']);
    });

    it('does NOT count when relative is below 8% even with sizeable abs intent (salt 2.83 vs 3)', () => {
      // rel = -0.0567 < 0.08 → equal, regardless of absolute.
      const r = scoreNutrition({ salt: 2.83 }, { salt: 3.0 });
      expect(r.nutritionPoints).toBe(0);
      expect(r.detail[0]).toMatchObject({ key: 'salt', dir: 'equal' });
      expect(r.facts).toEqual([]);
    });

    it('does NOT count when absolute is below minAbs even with big relative — the small-base problem (satFat 0.7 vs 0.4)', () => {
      // rel = +0.75 (>= 0.08) but absDiff = 0.3 < minAbs 0.8 → equal.
      const r = scoreNutrition({ satFat: 0.7 }, { satFat: 0.4 });
      expect(r.nutritionPoints).toBe(0);
      expect(r.detail[0]).toMatchObject({ key: 'satFat', dir: 'equal' });
      expect(r.facts).toEqual([]);
    });

    it('counts satFat once the absolute difference clears minAbs 0.8 (1.0 vs 2.0)', () => {
      // rel = -0.5 strong, absDiff 1.0 >= 0.8. weight 2.0 * 1.5 = 3.0
      const r = scoreNutrition({ satFat: 1.0 }, { satFat: 2.0 });
      expect(r.nutritionPoints).toBe(3.0);
      expect(r.detail[0]).toMatchObject({ key: 'satFat', dir: 'noname' });
    });
  });

  describe('intensity tiers (>=25% relative → 1.5x weight, else 1x)', () => {
    it('applies 1.0x for a moderate difference (energy 220 vs 250)', () => {
      // rel = -0.12 (8%..25%), absDiff 30 >= 20. intensity 1.0. weight 1.0 → +1.0
      const r = scoreNutrition({ energy: 220 }, { energy: 250 });
      expect(r.nutritionPoints).toBe(1.0);
      expect(r.detail[0]).toMatchObject({ key: 'energy', dir: 'noname' });
    });

    it('applies 1.5x exactly at the 25% strong boundary (salt 3 vs 4)', () => {
      // rel = -0.25 → |rel| >= STRONG_THRESHOLD (inclusive). absDiff 1.0 >= 0.2.
      // weight 3.0 * 1.5 = 4.5
      const r = scoreNutrition({ salt: 3 }, { salt: 4 });
      expect(r.nutritionPoints).toBe(4.5);
    });

    it('applies 1.0x just below the strong boundary (energy 200 vs 250 = -20%)', () => {
      // rel = -0.20 < 0.25 → intensity 1.0. absDiff 50 >= 20. weight 1.0 → +1.0
      const r = scoreNutrition({ energy: 200 }, { energy: 250 });
      expect(r.nutritionPoints).toBe(1.0);
    });
  });

  describe('direction: lowerBetter nutrients', () => {
    it('rewards NoName for having less salt', () => {
      const r = scoreNutrition({ salt: 1 }, { salt: 3 });
      expect(r.nutritionPoints).toBeGreaterThan(0);
      expect(r.detail[0].dir).toBe('noname');
      expect(r.facts[0]).toContain('NoName weniger');
    });

    it('penalises NoName for having more sugar', () => {
      // sugar 10 vs 5: rel +1.0 strong, absDiff 5 >= 1.5. weight 3.0 * 1.5 = -4.5
      const r = scoreNutrition({ sugar: 10 }, { sugar: 5 });
      expect(r.nutritionPoints).toBe(-4.5);
      expect(r.detail[0].dir).toBe('original');
      expect(r.facts[0]).toContain('NoName mehr');
    });
  });

  describe('direction: higher-is-better nutrients (protein, fiber)', () => {
    it('rewards NoName for having more protein', () => {
      // protein 12 vs 8: rel +0.5 strong, absDiff 4 >= 1.5. weight 1.5 * 1.5 = 2.25
      const r = scoreNutrition({ protein: 12 }, { protein: 8 });
      expect(r.nutritionPoints).toBe(2.25);
      expect(r.detail[0].dir).toBe('noname');
      expect(r.facts[0]).toContain('NoName mehr');
    });

    it('penalises NoName for having less fiber', () => {
      // fiber 2 vs 5: rel -0.6 strong, absDiff 3 >= 1.0. weight 1.5 * 1.5 = -2.25
      const r = scoreNutrition({ fiber: 2 }, { fiber: 5 });
      expect(r.nutritionPoints).toBe(-2.25);
      expect(r.detail[0].dir).toBe('original');
      expect(r.facts[0]).toContain('NoName weniger');
    });
  });

  describe('original-is-zero base handling (base = max(|n|, 1))', () => {
    it('penalises NoName when it adds a nutrient the original lacks (sugar 5 vs 0)', () => {
      // o = 0 → base = max(5, 1) = 5, rel = 1.0 strong, absDiff 5 >= 1.5.
      // lowerBetter, NoName has more → worse. weight 3.0 * 1.5 = -4.5
      const r = scoreNutrition({ sugar: 5 }, { sugar: 0 });
      expect(r.nutritionPoints).toBe(-4.5);
      expect(r.detail[0]).toMatchObject({ key: 'sugar', dir: 'original' });
    });

    it('does not count a tiny added amount below minAbs (sugar 1 vs 0)', () => {
      // base = max(1,1)=1, rel = 1.0 (>=0.08) but absDiff 1 < minAbs 1.5 → equal.
      const r = scoreNutrition({ sugar: 1 }, { sugar: 0 });
      expect(r.nutritionPoints).toBe(0);
      expect(r.detail[0]).toMatchObject({ key: 'sugar', dir: 'equal' });
    });
  });

  describe('multi-nutrient accumulation', () => {
    it('sums deltas across all qualifying nutrients', () => {
      // salt 1 vs 3: -0.667 strong, abs 2 → +4.5
      // sugar 5 vs 10: -0.5 strong, abs 5 → +4.5
      // protein 12 vs 6: +1.0 strong, abs 6 → +2.25
      // total = 11.25
      const r = scoreNutrition(
        { salt: 1, sugar: 5, protein: 12 },
        { salt: 3, sugar: 10, protein: 6 },
      );
      expect(r.nutritionPoints).toBeCloseTo(11.25, 5);
      expect(r.facts).toHaveLength(3);
      expect(r.detail).toHaveLength(3);
    });

    it('nets opposing advantages against each other', () => {
      // salt 1 vs 3: +4.5 (NoName better)
      // sugar 10 vs 5: -4.5 (NoName worse)
      // → net 0, but both recorded in facts/detail
      const r = scoreNutrition({ salt: 1, sugar: 10 }, { salt: 3, sugar: 5 });
      expect(r.nutritionPoints).toBeCloseTo(0, 5);
      expect(r.facts).toHaveLength(2);
    });
  });

  describe('fact formatting (German number format, comma decimals, units)', () => {
    it('formats decimals with a comma and appends the unit', () => {
      // salt 2.5 vs 4: counts, label "Salz", unit "g"
      const r = scoreNutrition({ salt: 2.5 }, { salt: 4 });
      expect(r.facts[0]).toBe('Salz: NoName 2,5g vs Original 4g (NoName weniger)');
    });

    it('uses the kcal unit for energy', () => {
      const r = scoreNutrition({ energy: 220 }, { energy: 250 });
      expect(r.facts[0]).toContain('kcal');
      expect(r.facts[0]).toContain('Kalorien');
    });
  });
});

// ───────────────────────────────────────────────────────────────────
// scoreLabels (incl. the grade() helper behavior)
// ───────────────────────────────────────────────────────────────────
describe('scoreLabels', () => {
  describe('return shape & empty handling', () => {
    it('returns labelPoints + facts', () => {
      const r = scoreLabels({}, {});
      expect(r).toEqual({ labelPoints: 0, facts: [] });
    });

    it('tolerates undefined products', () => {
      expect(scoreLabels(undefined, undefined)).toEqual({ labelPoints: 0, facts: [] });
    });

    it('tolerates missing labels objects', () => {
      expect(scoreLabels({ foo: 1 }, { bar: 2 })).toEqual({ labelPoints: 0, facts: [] });
    });
  });

  describe('nutriscore (grade helper: a=0..e=4, lower better)', () => {
    it('rewards NoName for a better grade and is case-insensitive (A vs c)', () => {
      const r = scoreLabels({ labels: { nutriscore: 'A' } }, { labels: { nutriscore: 'c' } });
      expect(r.labelPoints).toBe(1.5);
      expect(r.facts[0]).toBe('Nutri-Score: NoName A vs Original C');
    });

    it('penalises NoName for a worse grade (d vs b)', () => {
      const r = scoreLabels({ labels: { nutriscore: 'd' } }, { labels: { nutriscore: 'b' } });
      expect(r.labelPoints).toBe(-1.5);
    });

    it('scores nothing for equal grades', () => {
      const r = scoreLabels({ labels: { nutriscore: 'a' } }, { labels: { nutriscore: 'a' } });
      expect(r.labelPoints).toBe(0);
      expect(r.facts).toEqual([]);
    });

    it('ignores an unknown grade string (grade() returns -1)', () => {
      const r = scoreLabels({ labels: { nutriscore: 'x' } }, { labels: { nutriscore: 'a' } });
      expect(r.labelPoints).toBe(0);
      expect(r.facts).toEqual([]);
    });

    it('ignoriert nutriscore wenn BEIDE Grades Nicht-Strings sind (grade() → -1, -1 !== -1 ist false)', () => {
      const r = scoreLabels({ labels: { nutriscore: 1 } }, { labels: { nutriscore: 2 } });
      expect(r.labelPoints).toBe(0);
      expect(r.facts).toEqual([]);
    });

    // Regressionsschutz für den gefixten null>=0-Coercion-Bug: ein Nicht-
    // String-Grade auf EINER Seite (valider String auf der anderen) darf
    // NICHT mehr werfen — grade() liefert -1, der Guard greift nicht, die
    // Dimension wird übersprungen (0 Punkte, kein .toUpperCase() auf Nicht-String).
    it('wirft NICHT wenn genau eine Seite einen Nicht-String-Grade hat (Bug-Fix)', () => {
      let r1;
      expect(() => {
        r1 = scoreLabels({ labels: { nutriscore: 1 } }, { labels: { nutriscore: 'a' } });
      }).not.toThrow();
      expect(r1.labelPoints).toBe(0);
      expect(r1.facts).toEqual([]);

      let r2;
      expect(() => {
        r2 = scoreLabels({ labels: { nutriscore: 'a' } }, { labels: { nutriscore: 2 } });
      }).not.toThrow();
      expect(r2.labelPoints).toBe(0);
      expect(r2.facts).toEqual([]);
    });

    it('handles whitespace in grade strings via trim', () => {
      const r = scoreLabels({ labels: { nutriscore: ' a ' } }, { labels: { nutriscore: 'c' } });
      expect(r.labelPoints).toBe(1.5);
    });
  });

  describe('nova group (1..4, lower better, parsed as int)', () => {
    it('rewards a lower NOVA group, accepting string or number (1 vs 4)', () => {
      const r = scoreLabels({ labels: { nova: '1' } }, { labels: { nova: 4 } });
      expect(r.labelPoints).toBe(1.0);
      expect(r.facts[0]).toBe('NOVA: NoName Gruppe 1 vs Original Gruppe 4');
    });

    it('penalises a higher NOVA group (4 vs 2)', () => {
      const r = scoreLabels({ labels: { nova: 4 } }, { labels: { nova: 2 } });
      expect(r.labelPoints).toBe(-1.0);
    });

    it('scores nothing for equal NOVA groups', () => {
      const r = scoreLabels({ labels: { nova: 2 } }, { labels: { nova: 2 } });
      expect(r.labelPoints).toBe(0);
    });

    it('ignores a non-numeric NOVA (parseInt → NaN)', () => {
      const r = scoreLabels({ labels: { nova: 'foo' } }, { labels: { nova: 2 } });
      expect(r.labelPoints).toBe(0);
    });
  });

  describe('bio (boolean, +/-2)', () => {
    it('rewards NoName when only it is Bio', () => {
      const r = scoreLabels({ labels: { isBio: true } }, { labels: { isBio: false } });
      expect(r.labelPoints).toBe(2.0);
      expect(r.facts[0]).toBe('NoName ist Bio-zertifiziert, Original nicht');
    });

    it('penalises NoName when only the original is Bio', () => {
      const r = scoreLabels({ labels: { isBio: false } }, { labels: { isBio: true } });
      expect(r.labelPoints).toBe(-2.0);
      expect(r.facts[0]).toBe('Original ist Bio-zertifiziert, NoName nicht');
    });

    it('scores nothing when both are Bio', () => {
      const r = scoreLabels({ labels: { isBio: true } }, { labels: { isBio: true } });
      expect(r.labelPoints).toBe(0);
    });

    it('scores nothing when bio is missing on one side (not boolean)', () => {
      const r = scoreLabels({ labels: { isBio: true } }, { labels: {} });
      expect(r.labelPoints).toBe(0);
    });
  });

  describe('combined labels accumulate', () => {
    it('sums nutriscore + nova + bio advantages', () => {
      const r = scoreLabels(
        { labels: { nutriscore: 'a', nova: 1, isBio: true } },
        { labels: { nutriscore: 'c', nova: 3, isBio: false } },
      );
      // 1.5 + 1.0 + 2.0 = 4.5
      expect(r.labelPoints).toBe(4.5);
      expect(r.facts).toHaveLength(3);
    });

    it('nets mixed advantages (NoName better nutriscore, worse bio)', () => {
      const r = scoreLabels(
        { labels: { nutriscore: 'a', isBio: false } },
        { labels: { nutriscore: 'c', isBio: true } },
      );
      // +1.5 (nutri) - 2.0 (bio) = -0.5
      expect(r.labelPoints).toBe(-0.5);
      expect(r.facts).toHaveLength(2);
    });
  });
});

// ───────────────────────────────────────────────────────────────────
// combineScore
// ───────────────────────────────────────────────────────────────────
describe('combineScore', () => {
  describe('return shape', () => {
    it('returns score + total + ingredientPoints', () => {
      const r = combineScore({ nutritionPoints: 0, labelPoints: 0, ingredientVerdict: 'equal' });
      expect(r).toHaveProperty('score');
      expect(r).toHaveProperty('total');
      expect(r).toHaveProperty('ingredientPoints');
    });
  });

  describe('ingredient verdict → ingredientPoints (strength scaling)', () => {
    it('adds +1.5 for a slight NoName ingredient advantage', () => {
      const r = combineScore({
        nutritionPoints: 0,
        labelPoints: 0,
        ingredientVerdict: 'noname',
        ingredientStrength: 'slight',
      });
      expect(r.ingredientPoints).toBe(1.5);
      expect(r.total).toBe(1.5);
    });

    it('adds +3.5 for a clear NoName advantage', () => {
      const r = combineScore({
        nutritionPoints: 0,
        labelPoints: 0,
        ingredientVerdict: 'noname',
        ingredientStrength: 'clear',
      });
      expect(r.ingredientPoints).toBe(3.5);
    });

    it('adds +5.0 for a strong NoName advantage', () => {
      const r = combineScore({
        nutritionPoints: 0,
        labelPoints: 0,
        ingredientVerdict: 'noname',
        ingredientStrength: 'strong',
      });
      expect(r.ingredientPoints).toBe(5.0);
    });

    it('subtracts for an original ingredient advantage', () => {
      const r = combineScore({
        nutritionPoints: 0,
        labelPoints: 0,
        ingredientVerdict: 'original',
        ingredientStrength: 'clear',
      });
      expect(r.ingredientPoints).toBe(-3.5);
    });

    it('contributes 0 for an equal verdict', () => {
      const r = combineScore({
        nutritionPoints: 1,
        labelPoints: 2,
        ingredientVerdict: 'equal',
        ingredientStrength: 'strong',
      });
      expect(r.ingredientPoints).toBe(0);
      expect(r.total).toBe(3);
    });

    it('defaults to slight (1.5) for an unknown / missing strength', () => {
      const unknown = combineScore({
        nutritionPoints: 0,
        labelPoints: 0,
        ingredientVerdict: 'noname',
        ingredientStrength: 'weird',
      });
      expect(unknown.ingredientPoints).toBe(1.5);

      const missing = combineScore({
        nutritionPoints: 0,
        labelPoints: 0,
        ingredientVerdict: 'noname',
      });
      expect(missing.ingredientPoints).toBe(1.5);
    });
  });

  describe('score mapping thresholds', () => {
    it('maps total >= 5.0 to 5 (klar besser)', () => {
      expect(combineScore({ nutritionPoints: 5, labelPoints: 0, ingredientVerdict: 'equal' }).score).toBe(5);
      expect(combineScore({ nutritionPoints: 100, labelPoints: 0, ingredientVerdict: 'equal' }).score).toBe(5);
    });

    it('maps total >= 2.5 (and < 5.0) to 4 (etwas besser)', () => {
      expect(combineScore({ nutritionPoints: 2.5, labelPoints: 0, ingredientVerdict: 'equal' }).score).toBe(4);
      expect(combineScore({ nutritionPoints: 4.99, labelPoints: 0, ingredientVerdict: 'equal' }).score).toBe(4);
    });

    it('maps just below 2.5 down to 3 (gleichwertig)', () => {
      expect(combineScore({ nutritionPoints: 2.49, labelPoints: 0, ingredientVerdict: 'equal' }).score).toBe(3);
    });

    it('keeps small original advantages at 3 thanks to the asymmetric tilt (> -3.5)', () => {
      // total -3.49 is still gleichwertig.
      expect(combineScore({ nutritionPoints: -3.49, labelPoints: 0, ingredientVerdict: 'equal' }).score).toBe(3);
      expect(combineScore({ nutritionPoints: -2, labelPoints: 0, ingredientVerdict: 'equal' }).score).toBe(3);
    });

    it('drops to 2 at exactly -3.5 (boundary is exclusive on the 3-side)', () => {
      // total > -3.5 is the 3-branch; -3.5 is NOT > -3.5 → falls to the 2-branch.
      expect(combineScore({ nutritionPoints: -3.5, labelPoints: 0, ingredientVerdict: 'equal' }).score).toBe(2);
    });

    it('maps the (-6, -3.5] band to 2 (etwas schlechter)', () => {
      expect(combineScore({ nutritionPoints: -5.99, labelPoints: 0, ingredientVerdict: 'equal' }).score).toBe(2);
      expect(combineScore({ nutritionPoints: -4, labelPoints: 0, ingredientVerdict: 'equal' }).score).toBe(2);
    });

    it('maps total <= -6.0 to 1 (klar schlechter)', () => {
      // -6 is NOT > -6 → score 1.
      expect(combineScore({ nutritionPoints: -6, labelPoints: 0, ingredientVerdict: 'equal' }).score).toBe(1);
      expect(combineScore({ nutritionPoints: -20, labelPoints: 0, ingredientVerdict: 'equal' }).score).toBe(1);
    });

    it('demonstrates the tilt asymmetry: +2.5 lifts to 4 but -2.5 stays 3', () => {
      const better = combineScore({ nutritionPoints: 2.5, labelPoints: 0, ingredientVerdict: 'equal' });
      const worse = combineScore({ nutritionPoints: -2.5, labelPoints: 0, ingredientVerdict: 'equal' });
      expect(better.score).toBe(4);
      expect(worse.score).toBe(3);
    });
  });

  describe('ingredient-quality cap (verdict + strength override the raw score)', () => {
    it('caps a strong original ingredient disadvantage at 3 even with great nutrition', () => {
      // nutrition +20, ingredients original strong -5 → total 15 → raw score 5.
      // cap: original + strong + score>3 → 3.
      const r = combineScore({
        nutritionPoints: 20,
        labelPoints: 0,
        ingredientVerdict: 'original',
        ingredientStrength: 'strong',
      });
      expect(r.score).toBe(3);
      expect(r.total).toBe(15);
    });

    it('caps a clear original ingredient disadvantage at 4', () => {
      // nutrition +20, ingredients original clear -3.5 → total 16.5 → raw 5.
      // cap: original + clear + score>4 → 4.
      const r = combineScore({
        nutritionPoints: 20,
        labelPoints: 0,
        ingredientVerdict: 'original',
        ingredientStrength: 'clear',
      });
      expect(r.score).toBe(4);
    });

    it('floors a strong NoName ingredient advantage at 3 even with terrible nutrition', () => {
      // nutrition -20, ingredients noname strong +5 → total -15 → raw 1.
      // cap: noname + strong + score<3 → 3.
      const r = combineScore({
        nutritionPoints: -20,
        labelPoints: 0,
        ingredientVerdict: 'noname',
        ingredientStrength: 'strong',
      });
      expect(r.score).toBe(3);
    });

    it('floors a clear NoName ingredient advantage at 2', () => {
      // nutrition -20, ingredients noname clear +3.5 → total -16.5 → raw 1.
      // cap: noname + clear + score<2 → 2.
      const r = combineScore({
        nutritionPoints: -20,
        labelPoints: 0,
        ingredientVerdict: 'noname',
        ingredientStrength: 'clear',
      });
      expect(r.score).toBe(2);
    });

    it('does not apply the clear-original cap when the raw score is already <= 4', () => {
      // nutrition +2.5, original clear -3.5 → total -1 → raw 3. cap only fires if score>4.
      const r = combineScore({
        nutritionPoints: 2.5,
        labelPoints: 0,
        ingredientVerdict: 'original',
        ingredientStrength: 'clear',
      });
      expect(r.score).toBe(3);
    });
  });

  describe('stufe (trust) cap', () => {
    it('lifts stufe 5 products to at least 3', () => {
      const r = combineScore({
        nutritionPoints: -20,
        labelPoints: 0,
        ingredientVerdict: 'equal',
        stufe: 5,
      });
      expect(r.score).toBe(3);
    });

    it('lifts stufe 4 products to at least 2', () => {
      const r = combineScore({
        nutritionPoints: -20,
        labelPoints: 0,
        ingredientVerdict: 'equal',
        stufe: 4,
      });
      expect(r.score).toBe(2);
    });

    it('does not lift stufe 3 products', () => {
      const r = combineScore({
        nutritionPoints: -20,
        labelPoints: 0,
        ingredientVerdict: 'equal',
        stufe: 3,
      });
      expect(r.score).toBe(1);
    });

    it('leaves an already-high score untouched at stufe 5', () => {
      const r = combineScore({
        nutritionPoints: 20,
        labelPoints: 0,
        ingredientVerdict: 'equal',
        stufe: 5,
      });
      expect(r.score).toBe(5);
    });
  });

  describe('clamping to the 1..5 range', () => {
    it('never exceeds 5 for extreme positive input', () => {
      const r = combineScore({
        nutritionPoints: 1000,
        labelPoints: 1000,
        ingredientVerdict: 'noname',
        ingredientStrength: 'strong',
      });
      expect(r.score).toBe(5);
    });

    it('never drops below 1 for extreme negative input', () => {
      const r = combineScore({
        nutritionPoints: -1000,
        labelPoints: -1000,
        ingredientVerdict: 'original',
        ingredientStrength: 'strong',
      });
      expect(r.score).toBe(1);
    });
  });

  describe('integration with scoreNutrition / scoreLabels output', () => {
    it('combines real nutrition + label points into a 4 (one clear NoName advantage)', () => {
      const nut = scoreNutrition({ salt: 2 }, { salt: 3 }); // +4.5
      const lab = scoreLabels({}, {}); // 0
      const r = combineScore({
        nutritionPoints: nut.nutritionPoints,
        labelPoints: lab.labelPoints,
        ingredientVerdict: 'equal',
      });
      expect(r.total).toBe(4.5);
      expect(r.score).toBe(4);
    });
  });

  describe('degenerate / empty input', () => {
    it('produces NaN total and falls through to score 1 for an empty object', () => {
      // undefined + undefined + 0 = NaN; every comparison with NaN is false → else → 1.
      const r = combineScore({});
      expect(Number.isNaN(r.total)).toBe(true);
      expect(r.score).toBe(1);
      expect(r.ingredientPoints).toBe(0);
    });
  });
});
