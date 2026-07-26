/**
 * Regressionen aus dem adversarialen Release-Review vor 6.0.12.
 *
 * Beide Defekte hier haben den Alternativen-Guard genau dort ausgehebelt,
 * wo er gebaut wurde: bei den absurden Produktvorschlaegen. Sie sind
 * bewusst in einer eigenen Datei, damit die Herkunft dokumentiert bleibt
 * und niemand die Faelle beim Aufraeumen fuer redundant haelt.
 */

import { domainFromFreeText } from '../productTaxonomy';
import {
  hasStrongNameSignal,
  tokenizeProductName,
} from '../productSimilarity';

describe('domainFromFreeText — Substring-Falle bei Komposita', () => {
  // Der nackte Stamm 'creme' matchte in "SchokoladenCREMEs" und schob
  // Lebensmittel nach nonfood. Folge: die Alternativen-Liste eines
  // gescannten Nuss-Nougat-Aufstrichs blieb leer ODER zeigte Drogerie.
  it.each([
    ['Brotaufstriche, Schokoladencremes', 'food'],
    ['Lebensmittel > Eiscreme', 'food'],
    ['Käse > Frischkäsecreme', 'food'],
    ['Nutella Nuss-Nougat-Creme 400g', 'food'],
  ])('%s ⇒ %s (nicht nonfood)', (text, expected) => {
    expect(domainFromFreeText(text)).toBe(expected);
  });

  // 'deo' matchte in "RoDEO".
  it('Rodeo Nussriegel wird nicht als nonfood klassifiziert', () => {
    expect(domainFromFreeText('Rodeo Nussriegel')).not.toBe('nonfood');
  });

  it('echte Drogerie-Artikel bleiben nonfood', () => {
    expect(domainFromFreeText('Nivea Handcreme')).toBe('nonfood');
    expect(domainFromFreeText('Zahncreme Sensitive')).toBe('nonfood');
    expect(domainFromFreeText('Drogerie > Sonnenschutz')).toBe('nonfood');
    expect(domainFromFreeText('Vollwaschmittel Pulver')).toBe('nonfood');
  });

  it('exklusive nonfood-Marker entscheiden auch neben Food-Woertern', () => {
    // 'duschgel' / 'zahnpasta' sind nie Lebensmittel — auch wenn im selben
    // Text "Milch" bzw. (als Teilwort) "pasta" steht.
    expect(domainFromFreeText('Duschgel mit Milch-Extrakt')).toBe('nonfood');
    expect(domainFromFreeText('Drogerie > Zahnpflege > Zahnpasta')).toBe('nonfood');
  });

  it('mehrdeutiges Kompositum ⇒ null (fail-open statt falsch geraten)', () => {
    // 'haushalt' steckt in "Haushaltszucker" — hier ist die Domaene nicht
    // sicher bestimmbar. null ist fail-open, eine falsch geratene Domaene
    // wuerde legitime Alternativen verwerfen.
    expect(domainFromFreeText('Haushaltszucker fein')).toBeNull();
  });

  it('unbekannter Text bleibt null', () => {
    expect(domainFromFreeText('Zackzack Wunderding')).toBeNull();
    expect(domainFromFreeText('')).toBeNull();
    expect(domainFromFreeText(null)).toBeNull();
  });
});

describe('hasStrongNameSignal — generische Tokens sind kein hartes Signal', () => {
  const t = (s: string) => tokenizeProductName(s);

  it('geteiltes "Bio" macht Frischkäse und Speckknödel NICHT vergleichbar', () => {
    expect(
      hasStrongNameSignal(t('Bio Ziegenfrischkäse mit Honig'), t('Bio Speckknödel')),
    ).toBe(false);
  });

  it('gleiche Packungsgröße ist kein Signal', () => {
    expect(hasStrongNameSignal(t('Gouda 400g'), t('Waschmittel 400g'))).toBe(false);
    expect(hasStrongNameSignal(t('Cola 1l'), t('Motoröl 1l'))).toBe(false);
  });

  it('weitere generische Qualifizierer tragen kein Signal', () => {
    expect(hasStrongNameSignal(t('Vegan Aufstrich'), t('Vegan Duschgel'))).toBe(false);
    expect(hasStrongNameSignal(t('Classic Chips'), t('Classic Rasierschaum'))).toBe(false);
  });

  it('echte Produktart-Treffer funktionieren weiterhin', () => {
    expect(hasStrongNameSignal(t('Bio Toastbrot'), t('Toastbrot hell'))).toBe(true);
    // Compound-Match, kuerzeres Token >= 5 Zeichen
    expect(hasStrongNameSignal(t('Ziegenfrischkäse'), t('Frischkäse Kräuter'))).toBe(true);
  });

  it('Größenangaben werden tokenisiert weggefiltert, Namen mit Ziffern nicht', () => {
    expect(tokenizeProductName('Gouda 400g 6er')).toEqual(['gouda']);
    expect(tokenizeProductName('7up Limonade')).toContain('7up');
  });
});
