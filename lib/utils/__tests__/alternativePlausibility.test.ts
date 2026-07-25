/**
 * Regressionstests für den Alternativen-Guard.
 *
 * Die Fixtures sind ECHTE `catalogProfile`-Werte aus der Produktions-
 * Firestore (Stand 2026-07-25) — genau die Produkte, die in
 * App-Store-Bewertungen als absurde Vorschläge zitiert wurden bzw. die
 * korrekten Gegenbeispiele, die NICHT wegfallen dürfen.
 */

import {
  judgeAlternative,
  rankAlternatives,
  type PlausibilityInput,
} from '../alternativePlausibility';
import { domainFromFreeText, readTaxonomy } from '../productTaxonomy';
import { hasStrongNameSignal, tokenizeProductName } from '../productSimilarity';

// ─── echte Fixtures ───────────────────────────────────────────────
const blasenpflaster: PlausibilityInput = {
  id: 'I11GsJqLyBSKCwBiT57u',
  name: 'Blasenpflaster',
  kategorieId: 'S0kBex9gk8gBLYmBtFxu',
  catalogProfile: {
    derivedMainCategoryIds: ['drogerie', 'haushalt'],
    subCategories: [
      { id: 'gesundheit-und-sport', confidence: 90 },
      { id: 'hygiene', confidence: 80 },
    ],
  },
};

const matcha: PlausibilityInput = {
  id: 'QKkXW9OES8HErBNsIkUf',
  name: 'Bio Grüntee Japanischer Matcha',
  kategorieId: 'u05BDefaEKs2FuHSgg0H',
  catalogProfile: {
    derivedMainCategoryIds: ['fruehstueck-und-kaffee'],
    subCategories: [{ id: 'tee', confidence: 98 }],
  },
};

const geschirrReiniger: PlausibilityInput = {
  id: 'FsgYnwdg89KAGroYC7i0',
  name: 'Geschirr-Reiniger Classic',
  kategorieId: 'S0kBex9gk8gBLYmBtFxu',
  catalogProfile: {
    derivedMainCategoryIds: ['haushalt', 'drogerie'],
    subCategories: [
      { id: 'reinigungsmittel', confidence: 90 },
      { id: 'putzen-und-mehr', confidence: 80 },
    ],
  },
};

const kalbsragout: PlausibilityInput = {
  id: 'CtQLjRnYPBwW9S2ibkuP',
  name: 'Kalbsragout mit Champignons',
  kategorieId: '9HrFSB8Z2rLPIY7YR8CY',
  catalogProfile: {
    derivedMainCategoryIds: ['kuehlregal-und-schnelle-kueche', 'fleisch-und-wurst'],
    subCategories: [
      { id: 'fertiggerichte', confidence: 90 },
      { id: 'convenience', confidence: 85 },
    ],
  },
};

const ziegenfrischkaese: PlausibilityInput = {
  id: 'm7Zcl8Zs1cKLSxJRqHs7',
  name: 'Cappelletti Ziegenfrischkäse mit Honig',
  kategorieId: 'hQWff6NXxtHErDFGwkY3',
  catalogProfile: {
    derivedMainCategoryIds: ['kaese', 'kuehlregal-und-schnelle-kueche'],
    subCategories: [
      { id: 'frischkaese', confidence: 90 },
      { id: 'feinkost-brotaufstriche', confidence: 80 },
    ],
  },
};

const speckknoedel: PlausibilityInput = {
  id: 'x3dtCQOXCZF1rkgUtdq9',
  name: 'Original Bayerische Speckknödel',
  kategorieId: 'hQWff6NXxtHErDFGwkY3',
  catalogProfile: {
    derivedMainCategoryIds: [
      'kuehlregal-und-schnelle-kueche',
      'vorratsschrank-kochen-und-backen',
    ],
    subCategories: [
      { id: 'kartoffelprodukte', confidence: 95 },
      { id: 'fix-und-fertigprodukte', confidence: 85 },
      { id: 'convenience', confidence: 80 },
    ],
  },
};

const eierknoepfleNoName: PlausibilityInput = {
  id: '3N0uNnDRWtsgKiRHl3Ny',
  name: 'Eierknöpfle',
  kategorieId: 'hQWff6NXxtHErDFGwkY3',
  catalogProfile: {
    derivedMainCategoryIds: ['vorratsschrank-kochen-und-backen', 'kuehlregal-und-schnelle-kueche'],
    subCategories: [
      { id: 'teigwaren', confidence: 90 },
      { id: 'convenience', confidence: 85 },
    ],
  },
};

const eierknoepfleMarke: PlausibilityInput = {
  id: 'HBfRZC1pHYPoH9X4CKLt',
  name: 'Schwäbische Eierknöpfle',
  kategorieId: 'hQWff6NXxtHErDFGwkY3',
  catalogProfile: {
    derivedMainCategoryIds: ['vorratsschrank-kochen-und-backen', 'kuehlregal-und-schnelle-kueche'],
    subCategories: [
      { id: 'teigwaren', confidence: 90 },
      { id: 'frische-pasta', confidence: 85 },
    ],
  },
};

/** LEERES derivedMainCategoryIds — der Fail-open-Fall, kommt real vor. */
const knoepfleHenglein: PlausibilityInput = {
  id: 'bU29RTMc0azHKqrRSZiM',
  name: 'Knöpfle',
  kategorieId: 'ziWcBj3Cl4gcBUS0RJh5',
  catalogProfile: {
    derivedMainCategoryIds: [],
    subCategories: [{ id: 'brot-und-broetchen', confidence: 0 }],
  },
};

const katzenfutter: PlausibilityInput = {
  id: 'cat-1',
  name: 'Katzennahrung Truthahn',
  catalogProfile: {
    derivedMainCategoryIds: ['tierbedarf'],
    subCategories: [{ id: 'katzenfutter', confidence: 95 }],
  },
};

const entenbrust: PlausibilityInput = {
  id: 'duck-1',
  name: 'Enten-Brustfilets',
  catalogProfile: {
    derivedMainCategoryIds: ['fleisch-und-wurst'],
    subCategories: [{ id: 'gefluegel', confidence: 92 }],
  },
};

// ─── Die zitierten Absurditäten ───────────────────────────────────
describe('discovery: die in Bewertungen zitierten Fehltreffer werden blockiert', () => {
  it('Blasenpflaster → Matcha (Drogerie vs. Lebensmittel)', () => {
    const v = judgeAlternative(blasenpflaster, matcha, 'discovery');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('domain-mismatch');
  });

  it('Ragout fin → Geschirr-Reiniger (Fertiggericht vs. Haushalt)', () => {
    expect(judgeAlternative(kalbsragout, geschirrReiniger, 'discovery').ok).toBe(false);
  });

  it('Frischkäse → Speckknödel (gleiche Domäne, aber nur Hub-Subkategorien gemeinsam)', () => {
    // Beide sind `kuehlregal-und-schnelle-kueche`, teilen aber nur
    // `convenience`/`fix-und-fertigprodukte` — genau deshalb reicht
    // Domänen- oder Main-Kategorie-Gleichheit als Guard NICHT.
    const v = judgeAlternative(ziegenfrischkaese, speckknoedel, 'discovery');
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('no-signal');
  });

  it('Katzenfutter ↔ Entenbrust: pet ist mit nichts kompatibel', () => {
    expect(judgeAlternative(katzenfutter, entenbrust, 'discovery').ok).toBe(false);
    expect(judgeAlternative(entenbrust, katzenfutter, 'discovery').ok).toBe(false);
  });
});

// ─── Korrekte Treffer dürfen NICHT wegfallen ──────────────────────
describe('discovery: legitime Treffer bleiben', () => {
  it('Eierknöpfle ↔ Schwäbische Eierknöpfle (Sub teigwaren geteilt)', () => {
    const v = judgeAlternative(eierknoepfleNoName, eierknoepfleMarke, 'discovery');
    expect(v.ok).toBe(true);
    expect(v.reason).toBe('shared-subcategory');
  });

  it('Ziegenfrischkäse ↔ anderer Frischkäse (Namens-Signal ab 5 Zeichen)', () => {
    const frischkaesering: PlausibilityInput = {
      id: 'fk-2',
      name: 'Frischkäsering Kräuter',
      catalogProfile: {
        derivedMainCategoryIds: ['kaese'],
        subCategories: [{ id: 'frischkaese', confidence: 88 }],
      },
    };
    expect(judgeAlternative(ziegenfrischkaese, frischkaesering, 'discovery').ok).toBe(true);
  });

  it('FAIL-OPEN: leeres derivedMainCategoryIds blockiert nicht', () => {
    // Knöpfle (Henglein) hat kein Domänen-Signal — der Treffer muss
    // über das Namens-Signal durchkommen, nicht lautlos verschwinden.
    const v = judgeAlternative(eierknoepfleNoName, knoepfleHenglein, 'discovery');
    expect(v.ok).toBe(true);
    expect(v.reason).toBe('name-signal');
  });
});

// ─── Curated-Modus: kuratierte Links sind fast unantastbar ────────
describe('curated: nur der grobe Domänenbruch fällt', () => {
  it('blockiert Blasenpflaster → Matcha auch hier', () => {
    expect(judgeAlternative(blasenpflaster, matcha, 'curated').ok).toBe(false);
  });

  it('behält den Frischkäse/Speckknödel-Link (kuratiert = redaktionell gewollt)', () => {
    // Im curated-Modus KEIN Positiv-Nachweis nötig — die Domäne passt.
    expect(judgeAlternative(ziegenfrischkaese, speckknoedel, 'curated').ok).toBe(true);
  });

  it('behält einen Link, dessen Legacy-Kategorie am Markenprodukt falsch ist', () => {
    // Echter Fall: korrektes Käse-Paar, Marken-Seite trägt fälschlich
    // „Drogerie & Haushalt" als Legacy-Kategorie. Ein Guard auf
    // Kategorie-Gleichheit hätte diesen richtigen Link zerstört.
    const kashkaval: PlausibilityInput = {
      id: '6l4sQVtkUhJkYmjzrOcF',
      name: 'Kashkaval Käse',
      kategorieId: 'kaese-legacy',
      catalogProfile: {
        derivedMainCategoryIds: ['kaese'],
        subCategories: [{ id: 'hartkaese', confidence: 85 }],
      },
    };
    const bavarella: PlausibilityInput = {
      id: 'NTk6MzTTXUhnt2WJj7as',
      name: 'Pasta Filata Bavarella',
      kategorieId: 'drogerie-haushalt-legacy', // falsch gepflegt!
      catalogProfile: {
        derivedMainCategoryIds: ['kaese'],
        subCategories: [{ id: 'weichkaese', confidence: 80 }],
      },
    };
    expect(judgeAlternative(kashkaval, bavarella, 'curated').ok).toBe(true);
  });
});

// ─── Ranking ──────────────────────────────────────────────────────
describe('rankAlternatives', () => {
  const source = ziegenfrischkaese;
  const good: PlausibilityInput = {
    id: 'b-good',
    name: 'Frischkäsezubereitung Kräuter',
    stufe: 3,
    preis: 1.5,
    catalogProfile: {
      derivedMainCategoryIds: ['kaese'],
      subCategories: [{ id: 'frischkaese', confidence: 90 }],
    },
  };
  const alsoGood: PlausibilityInput = {
    id: 'a-good',
    name: 'Frischkäsering Natur',
    stufe: 3,
    preis: 0.99,
    catalogProfile: {
      derivedMainCategoryIds: ['kaese'],
      subCategories: [{ id: 'frischkaese', confidence: 90 }],
    },
  };

  it('filtert Unsinn heraus und behält Plausibles', () => {
    const out = rankAlternatives(source, [speckknoedel, good, matcha, alsoGood], 5, 'discovery');
    expect(out.map((x) => x.id)).not.toContain(speckknoedel.id);
    expect(out.map((x) => x.id)).not.toContain(matcha.id);
    expect(out.length).toBe(2);
  });

  it('ist DETERMINISTISCH — kein Math.random-Tiebreaker mehr', () => {
    const runs = Array.from({ length: 8 }, () =>
      rankAlternatives(source, [good, alsoGood], 5, 'discovery')
        .map((x) => x.id)
        .join(','),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it('sortiert bei Score-Gleichstand nach Stufe, dann Preis', () => {
    const out = rankAlternatives(source, [good, alsoGood], 5, 'discovery');
    // gleicher Score + gleiche Stufe → billigeres zuerst
    expect(out[0].id).toBe('a-good');
  });

  it('respektiert das Limit', () => {
    expect(rankAlternatives(source, [good, alsoGood], 1, 'discovery').length).toBe(1);
  });

  it('leere Kandidatenliste ist unkritisch', () => {
    expect(rankAlternatives(source, [], 5, 'discovery')).toEqual([]);
  });
});

// ─── Bausteine ────────────────────────────────────────────────────
describe('hasStrongNameSignal — strenger als der Ranking-Score', () => {
  const t = (s: string) => tokenizeProductName(s);

  it('greift bei Compound ab 5 Zeichen', () => {
    expect(hasStrongNameSignal(t('Eierknöpfle'), t('Knöpfle'))).toBe(true);
  });

  it('greift NICHT bei kurzem Stamm wie "käse"', () => {
    // Sonst wäre jedes Käseprodukt Alternative zu jedem anderen.
    expect(hasStrongNameSignal(t('Kashkaval Käse'), t('Butterkäse'))).toBe(false);
  });

  it('greift bei exaktem Token', () => {
    expect(hasStrongNameSignal(t('Toastbrot Weizen'), t('Toastbrot Körner'))).toBe(true);
  });

  it('leere Seiten ergeben kein Signal', () => {
    expect(hasStrongNameSignal([], t('Toastbrot'))).toBe(false);
  });
});

describe('readTaxonomy / domainFromFreeText', () => {
  it('filtert Hub-Subkategorien aus', () => {
    const facts = readTaxonomy(speckknoedel);
    expect(facts.subIds).toContain('kartoffelprodukte');
    expect(facts.subIds).not.toContain('convenience');
    expect(facts.subIds).not.toContain('fix-und-fertigprodukte');
  });

  it('mappt Mains auf Domänen und dedupt', () => {
    expect(readTaxonomy(blasenpflaster).domains).toEqual(['nonfood']);
    expect(readTaxonomy(kalbsragout).domains).toEqual(['food']);
    expect(readTaxonomy(katzenfutter).domains).toEqual(['pet']);
  });

  it('unbekanntes/leeres Profil ergibt keine Domäne (fail-open-Basis)', () => {
    expect(readTaxonomy(undefined).domains).toEqual([]);
    expect(readTaxonomy({ catalogProfile: { derivedMainCategoryIds: ['gibtsnicht'] } }).domains).toEqual([]);
  });

  it('erkennt Domänen aus Freitext für gescannte Fremdprodukte', () => {
    expect(domainFromFreeText('Drogerie > Zahnpflege > Zahnpasta')).toBe('nonfood');
    expect(domainFromFreeText('Lebensmittel > Getränke')).toBe('food');
    expect(domainFromFreeText('Tierbedarf > Katzenfutter')).toBe('pet');
    expect(domainFromFreeText('')).toBeNull();
    expect(domainFromFreeText('Irgendwas Unbekanntes')).toBeNull();
  });
});
