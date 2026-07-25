/**
 * Regressionstests für die Alternativen-Suche bei gescannten
 * Fremdprodukten.
 *
 * Die Fälle unten sind die fünf Fehltreffer, die live gegen den
 * Produktions-Algolia-Index reproduziert wurden — plus die legitimen
 * Gegenbeispiele, die NICHT wegfallen dürfen.
 */

import {
  buildAlternativeQueries,
  filterExternalAlternatives,
  filterExternalByDomainOnly,
  hasKnownDomain,
  judgeExternalAlternative,
  preFilterByNameSignal,
  significantWords,
  stripBrandFromName,
  stripGenericWords,
  MAX_WORD_QUERIES,
} from '../externalAlternativeQuery';
import type { PlausibilityInput } from '../alternativePlausibility';

// Katalog-Kandidaten mit echten Profil-Formen
const cand = (
  id: string,
  name: string,
  mains: string[],
  subs: string[] = [],
): PlausibilityInput => ({
  id,
  name,
  catalogProfile: {
    derivedMainCategoryIds: mains,
    subCategories: subs.map((s) => ({ id: s, confidence: 90 })),
  },
});

const mineralwasser = cand('mw', 'Mineralwasser Classic', ['getraenke'], ['wasser']);
const apfelsaft = cand('as', 'Apfel-Kirsch-Mehrfruchtsaft', ['getraenke'], ['saft']);
const haarspray = cand('hs', 'Haarspray Classic', ['drogerie'], ['haarpflege']);
const mundspuelung = cand('ms', 'Mundspülung Zahnfleischschutz', ['drogerie'], ['zahnpflege']);
const activDrink = cand('ad', 'Active Drink Erdbeere', ['getraenke'], ['saft']);

describe('die fünf live reproduzierten Fehltreffer werden blockiert', () => {
  it('Garnier Mineral Deo → Mineralwasser', () => {
    const src = {
      productName: 'Garnier Mineral Deo Roll-On',
      brandName: 'Garnier',
      category: 'Drogerie > Deo',
    };
    expect(judgeExternalAlternative(src, mineralwasser).ok).toBe(false);
    expect(filterExternalAlternatives(src, [mineralwasser], 6)).toEqual([]);
  });

  it('Elmex Kinder-Zahnpasta → Apfelsaft', () => {
    const src = {
      productName: 'Elmex Kinder-Zahnpasta',
      brandName: 'Elmex',
      category: 'Drogerie > Zahnpflege',
    };
    expect(judgeExternalAlternative(src, apfelsaft).ok).toBe(false);
  });

  it('Scholl Fußschutz Spray → Haarspray (gleiche Domäne! nur über stripGenericWords fangbar)', () => {
    const src = {
      productName: 'Scholl Fußschutz Spray',
      brandName: 'Scholl',
      category: 'Drogerie > Fußpflege',
    };
    // Beide sind nonfood — der Domänen-Guard allein würde das
    // durchlassen. Erst das Entfernen von „spray" auf beiden Seiten
    // nimmt dem Treffer sein Signal.
    expect(judgeExternalAlternative(src, haarspray).ok).toBe(false);
  });

  it('NIVEA Sun Schutz & Pflege → Mundspülung Zahnfleischschutz', () => {
    const src = {
      productName: 'NIVEA Sun Schutz & Pflege LSF 50+',
      brandName: 'NIVEA',
      category: 'Drogerie > Sonnenschutz',
    };
    expect(judgeExternalAlternative(src, mundspuelung).ok).toBe(false);
  });

  it('Blink Oxi Active Vorwaschspray → Active Drink', () => {
    const src = {
      productName: 'Blink Oxi Active Vorwaschspray',
      brandName: 'Blink',
      category: 'Haushalt > Waschmittel',
    };
    expect(judgeExternalAlternative(src, activDrink).ok).toBe(false);
  });
});

describe('legitime Treffer bleiben', () => {
  it('Alpro Joghurtalternative Soja → Soja-Joghurt (Signal über die Produktart)', () => {
    const src = {
      productName: 'Alpro Joghurtalternative Soja Natur 400g',
      brandName: 'Alpro',
      category: 'Lebensmittel > Kühlregal',
    };
    const sojaJoghurt = cand('sj', 'Soja-Joghurt Natur', ['kuehlregal-und-schnelle-kueche'], ['joghurt']);
    expect(judgeExternalAlternative(src, sojaJoghurt).ok).toBe(true);
  });

  it('Zahnpasta → andere Zahnpasta', () => {
    const src = {
      productName: 'Elmex Kinder-Zahnpasta',
      brandName: 'Elmex',
      category: 'Drogerie > Zahnpflege',
    };
    const zp = cand('zp', 'Zahnpasta Junior', ['drogerie'], ['zahnpflege']);
    expect(judgeExternalAlternative(src, zp).ok).toBe(true);
  });

  it('ohne erkennbare Quell-Domäne entscheidet allein das Namens-Signal', () => {
    const src = { productName: 'Irgendwas Toastbrot', brandName: null, category: null };
    const toast = cand('tb', 'Toastbrot Weizen', ['brot-und-backwaren'], ['brot-und-broetchen']);
    const seife = cand('sf', 'Handseife Zitrone', ['drogerie'], ['hygiene']);
    expect(judgeExternalAlternative(src, toast).ok).toBe(true);
    expect(judgeExternalAlternative(src, seife).ok).toBe(false);
  });
});

describe('buildAlternativeQueries', () => {
  it('kein Last-Resort mit dem markenhaltigen Originalnamen', () => {
    const qs = buildAlternativeQueries({
      productName: 'Garnier Mineral Deo Roll-On',
      brandName: 'Garnier',
      category: 'Drogerie > Deo',
    });
    expect(qs.some((x) => x.q.toLowerCase().includes('garnier'))).toBe(false);
  });

  it('sperrt die schädlichen Tokens als Query', () => {
    const qs = buildAlternativeQueries({
      productName: 'Garnier Mineral Deo Roll-On',
      brandName: 'Garnier',
      category: null,
    });
    expect(qs.map((x) => x.q)).not.toContain('mineral');
    expect(qs.map((x) => x.q)).not.toContain('roll');
  });

  it('nimmt das längste Produktwort zuerst (Produktart vor Eigenschaft)', () => {
    const qs = buildAlternativeQueries({
      productName: 'Alpro Joghurtalternative Soja Natur 400g',
      brandName: 'Alpro',
      category: null,
    });
    // Erst der markenfreie Gesamtname, dann das lange Compound.
    expect(qs[0].q).toContain('joghurtalternative');
    expect(qs[0].kind).toBe('name');
    expect(qs[1].q).toBe('joghurtalternative');
  });

  it('deckelt die Einzelwort-Queries', () => {
    const qs = buildAlternativeQueries({
      productName: 'Wort Zweiwort Dreiwort Vierwort Fuenfwort Sechswort',
      brandName: null,
      category: null,
    });
    // 1 Gesamtname + max. MAX_WORD_QUERIES Einzelwörter
    expect(qs.length).toBeLessThanOrEqual(1 + MAX_WORD_QUERIES);
  });

  it('nimmt die Kategorie als letzte Stufe', () => {
    const qs = buildAlternativeQueries({
      productName: 'Xyz',
      brandName: null,
      category: 'Lebensmittel > Molkerei > Joghurt',
    });
    expect(qs[qs.length - 1]).toEqual({ q: 'Joghurt', kind: 'category' });
  });

  it('leerer Name ergibt keine Queries', () => {
    expect(buildAlternativeQueries({ productName: '', brandName: null })).toEqual([]);
    expect(buildAlternativeQueries({ productName: null })).toEqual([]);
  });
});

describe('Bausteine', () => {
  it('stripBrandFromName entfernt Marke und Packungsgröße', () => {
    expect(stripBrandFromName('Alpro Joghurt Soja 400g', 'Alpro')).toBe('joghurt soja');
  });

  it('stripBrandFromName ohne Marke ist unkritisch', () => {
    expect(stripBrandFromName('Joghurt Soja', null)).toBe('joghurt soja');
  });

  it('stripGenericWords behält die Produktart', () => {
    expect(stripGenericWords('Fußschutz Spray')).toBe('Fußschutz');
    expect(stripGenericWords('Haarspray Classic')).toBe('Haarspray');
    expect(stripGenericWords('Soja-Joghurt Natur')).toBe('Soja Joghurt');
  });

  it('significantWords filtert Stopwords und Zahlen', () => {
    const w = significantWords('mineral deo 400g bio joghurt');
    expect(w).not.toContain('mineral');
    expect(w).not.toContain('bio');
    expect(w).toContain('joghurt');
  });
});

describe('filterExternalAlternatives', () => {
  const src = {
    productName: 'Alpro Joghurtalternative Soja Natur',
    brandName: 'Alpro',
    category: 'Lebensmittel > Kühlregal',
  };

  it('gibt die ORIGINAL-Objekte zurück (echter Name für die UI)', () => {
    const sojaJoghurt = cand('sj', 'Soja-Joghurt Natur', ['kuehlregal-und-schnelle-kueche'], ['joghurt']);
    const out = filterExternalAlternatives(src, [sojaJoghurt, mineralwasser], 6);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Soja-Joghurt Natur'); // NICHT der bereinigte Name
    expect(out[0]).toBe(sojaJoghurt); // Objekt-Identität erhalten
  });

  it('respektiert das Limit', () => {
    const a = cand('a', 'Soja-Joghurt Natur', ['kuehlregal-und-schnelle-kueche'], ['joghurt']);
    const b = cand('b', 'Soja-Joghurt Vanille', ['kuehlregal-und-schnelle-kueche'], ['joghurt']);
    expect(filterExternalAlternatives(src, [a, b], 1)).toHaveLength(1);
  });

  it('leere Kandidaten sind unkritisch', () => {
    expect(filterExternalAlternatives(src, [], 6)).toEqual([]);
  });
});

describe('preFilterByNameSignal — billiger Vorfilter, verliert nichts', () => {
  const src = {
    productName: 'Alpro Joghurtalternative Soja Natur',
    brandName: 'Alpro',
    category: 'Lebensmittel > Kühlregal',
  };

  it('behält genau die Kandidaten, die der volle Guard akzeptieren KÖNNTE', () => {
    const sojaJoghurt = cand('sj', 'Soja-Joghurt Natur', ['kuehlregal-und-schnelle-kueche'], ['joghurt']);
    const kept = preFilterByNameSignal(src, [sojaJoghurt, mineralwasser, haarspray]);
    expect(kept.map((k) => k.id)).toEqual(['sj']);
  });

  it('ist eine OBERMENGE des vollen Guards (nichts geht verloren)', () => {
    // Ein Kandidat mit Namens-Signal aber falscher Domäne überlebt den
    // Vorfilter und wird erst vom vollen Guard verworfen — genau so soll
    // es sein (der Vorfilter darf nie strenger sein).
    const sojaDrink = cand('sd', 'Soja Waschmittel', ['haushalt'], ['reinigungsmittel']);
    expect(preFilterByNameSignal(src, [sojaDrink]).map((k) => k.id)).toEqual(['sd']);
    expect(filterExternalAlternatives(src, [sojaDrink], 6)).toEqual([]);
  });

  it('ohne verwertbare Quell-Tokens wird nichts angereichert', () => {
    const only = preFilterByNameSignal({ productName: 'Bio Natur', brandName: null }, [mineralwasser]);
    expect(only).toEqual([]);
  });
});

describe('Kategorie-Stufe: Domänen-Filter statt Namens-Signal', () => {
  // Real gemessene Löcher der strengen Variante: Eigenmarken heißen
  // „Zahncreme" (nicht Zahnpasta) und „Fruchtgummi" (nicht Goldbären).
  const zahncreme = cand('zc', 'Zahncreme Fresh', ['drogerie'], ['zahnpflege']);
  const fruchtgummi = cand('fg', 'Fruchtgummi Bärchen', ['snacks-und-suesses'], ['fruchtgummi']);

  it('Zahnpasta → Zahncreme: strenger Filter verfehlt es, Domänen-Filter fängt es', () => {
    const src = {
      productName: 'Elmex Kinder-Zahnpasta',
      brandName: 'Elmex',
      category: 'Drogerie > Zahnpflege',
    };
    // Streng: kein gemeinsames Wort („zahnpasta" vs „zahncreme")
    expect(judgeExternalAlternative(src, zahncreme).ok).toBe(false);
    // Kategorie-Stufe: gleiche Domäne (nonfood) → akzeptiert
    expect(filterExternalByDomainOnly(src, [zahncreme], 5).map((x) => x.id)).toEqual(['zc']);
  });

  it('Goldbären → Fruchtgummi über die Kategorie', () => {
    const src = {
      productName: 'Haribo Goldbären 200g',
      brandName: 'Haribo',
      category: 'Süßwaren > Fruchtgummi',
    };
    expect(filterExternalByDomainOnly(src, [fruchtgummi], 5).map((x) => x.id)).toEqual(['fg']);
  });

  it('die Domänen-Grenze hält auch in der Kategorie-Stufe', () => {
    const src = {
      productName: 'Elmex Kinder-Zahnpasta',
      brandName: 'Elmex',
      category: 'Drogerie > Zahnpflege',
    };
    // nonfood-Quelle, food-Kandidat → bleibt draußen
    expect(filterExternalByDomainOnly(src, [apfelsaft, mineralwasser], 5)).toEqual([]);
  });

  it('OHNE bekannte Quell-Domäne liefert der Domänen-Filter NICHTS (kein Blindflug)', () => {
    const src = { productName: 'Zzz Xyz', brandName: null, category: null };
    expect(hasKnownDomain(src)).toBe(false);
    expect(filterExternalByDomainOnly(src, [zahncreme, apfelsaft], 5)).toEqual([]);
  });

  it('zu breite Kategorie-Segmente werden nicht als Query genutzt', () => {
    const qs = buildAlternativeQueries({
      productName: 'Xyz Abc',
      brandName: null,
      category: 'Lebensmittel',
    });
    expect(qs.some((x) => x.kind === 'category')).toBe(false);
  });

  it('hasKnownDomain erkennt die Domäne aus der Kategorie', () => {
    expect(hasKnownDomain({ category: 'Drogerie > Zahnpflege' })).toBe(true);
    expect(hasKnownDomain({ category: null, productName: 'Bio Grüntee' })).toBe(true);
  });
});

describe('Kategorie-Stufe: Reihenfolge', () => {
  it('messbares Namens-Match kommt zuerst', () => {
    const src = {
      productName: 'Elmex Kinder-Zahnpasta',
      brandName: 'Elmex',
      category: 'Drogerie > Zahnpflege',
    };
    const zahnbuerste = cand('zb', 'Zahnbürsten Interdental', ['drogerie'], ['zahnpflege']);
    const zahnpasta = cand('zp', 'Zahnpasta Junior', ['drogerie'], ['zahnpflege']);
    const out = filterExternalByDomainOnly(src, [zahnbuerste, zahnpasta], 5);
    expect(out.map((x) => x.id)).toEqual(['zp', 'zb']);
  });

  it('DOKUMENTIERTE GRENZE: Vokabular-Synonyme kann die Sortierung nicht erkennen', () => {
    // „zahnpasta" und „zahncreme" teilen nur das Präfix „zahn" — genau
    // wie „zahnbürste". Der Token-Scorer sieht also KEINEN Unterschied;
    // dass Creme ≈ Pasta ist, wäre semantisches Wissen. Die
    // Kategorie-Stufe liefert dann „gleiche Kategorie, nach Stufe/Preis
    // sortiert" — deutlich besser als der frühere Apfelsaft, aber kein
    // Treffer-Ranking. Der Test hält das bewusst fest, damit niemand
    // eine Fähigkeit annimmt, die der Code nicht hat.
    const src = {
      productName: 'Elmex Zahnpasta',
      brandName: 'Elmex',
      category: 'Drogerie > Zahnpflege',
    };
    const zahnbuerste = cand('zb', 'Zahnbürsten Interdental', ['drogerie'], ['zahnpflege']);
    const zahncreme = cand('zc', 'Zahncreme Fresh', ['drogerie'], ['zahnpflege']);
    const out = filterExternalByDomainOnly(src, [zahnbuerste, zahncreme], 5);
    // Beide Score 0 → stabile ID-Reihenfolge, KEINE Bevorzugung.
    expect(out.map((x) => x.id)).toEqual(['zb', 'zc']);
  });

  it('ist deterministisch', () => {
    const src = { productName: 'Xyz Zahnpasta', brandName: null, category: 'Drogerie > Zahnpflege' };
    const a = cand('a', 'Zahncreme A', ['drogerie'], ['zahnpflege']);
    const b = cand('b', 'Zahncreme B', ['drogerie'], ['zahnpflege']);
    const runs = Array.from({ length: 6 }, () =>
      filterExternalByDomainOnly(src, [a, b], 5).map((x) => x.id).join(','),
    );
    expect(new Set(runs).size).toBe(1);
  });
});
