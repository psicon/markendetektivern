import {
  formatNum,
  formatPack,
  formatPrice,
  normalizeGrade,
} from '../externalProductFormat';

/**
 * Unit-Tests für die reinen Formatter-/Normalisierungs-Helfer der
 * External-Product-Seite. Deutsche Zahlen-Konvention: Komma-Dezimal,
 * `toFixed`-Rundung. Jede Assertion ist gegen den ECHTEN Code-Pfad
 * gerechnet (nicht aus dem Kopf).
 */

describe('formatPrice', () => {
  it('formatiert einen Dezimal-Preis als deutsches Label', () => {
    expect(formatPrice(1.49)).toBe('1,49 €');
  });

  it('füllt ganze Beträge auf zwei Dezimalstellen auf', () => {
    expect(formatPrice(5)).toBe('5,00 €');
  });

  it('rundet kaufmännisch über toFixed(2)', () => {
    expect(formatPrice(1.005)).toBe('1,00 €'); // toFixed(2) → "1.00" (IEEE-754)
    expect(formatPrice(2.345)).toBe('2,35 €'); // toFixed(2) → "2.35"
    expect(formatPrice(0.1)).toBe('0,10 €');
  });

  it('behandelt 0 als gültige Zahl (nicht null)', () => {
    expect(formatPrice(0)).toBe('0,00 €');
  });

  it('behandelt negative Preise', () => {
    expect(formatPrice(-3.2)).toBe('-3,20 €');
  });

  it('gibt null zurück, wenn kein Argument übergeben wird', () => {
    expect(formatPrice()).toBeNull();
  });

  it('gibt null für undefined/null/string-Eingaben zurück', () => {
    expect(formatPrice(undefined)).toBeNull();
    // @ts-expect-error – Laufzeit-Guard für Nicht-Zahl-Eingaben
    expect(formatPrice(null)).toBeNull();
    // @ts-expect-error – Laufzeit-Guard für Nicht-Zahl-Eingaben
    expect(formatPrice('1.49')).toBeNull();
  });
});

describe('formatNum', () => {
  it('formatiert Float mit einer Dezimalstelle + Komma + Einheit', () => {
    expect(formatNum(12.5, 'g')).toBe('12,5 g');
  });

  it('rendert ganze Zahlen OHNE Dezimalstelle', () => {
    expect(formatNum(5, 'g')).toBe('5 g');
  });

  it('rendert 0 als "0" (nicht "0,0")', () => {
    expect(formatNum(0, 'g')).toBe('0 g');
  });

  it('lässt die Einheit weg, wenn keine übergeben wird', () => {
    expect(formatNum(12.5)).toBe('12,5');
    expect(formatNum(7)).toBe('7');
  });

  it('behandelt leere Einheit als "keine Einheit" (falsy)', () => {
    expect(formatNum(7, '')).toBe('7');
  });

  it('rundet Floats auf eine Dezimalstelle (toFixed(1))', () => {
    expect(formatNum(12.34, 'g')).toBe('12,3 g');
    expect(formatNum(12.36, 'g')).toBe('12,4 g');
  });

  it('behandelt negative Floats', () => {
    expect(formatNum(-1.5, 'g')).toBe('-1,5 g');
  });

  it('rendert negative ganze Zahlen ohne Dezimalstelle', () => {
    expect(formatNum(-3, 'g')).toBe('-3 g');
  });

  it('unterstützt beliebige Einheiten-Strings', () => {
    expect(formatNum(100, 'kcal')).toBe('100 kcal');
    expect(formatNum(2.5, 'mg')).toBe('2,5 mg');
  });

  it('gibt null für undefined/null/string-Eingaben zurück', () => {
    expect(formatNum()).toBeNull();
    expect(formatNum(undefined, 'g')).toBeNull();
    // @ts-expect-error – Laufzeit-Guard für Nicht-Zahl-Eingaben
    expect(formatNum(null, 'g')).toBeNull();
    // @ts-expect-error – Laufzeit-Guard für Nicht-Zahl-Eingaben
    expect(formatNum('12.5', 'g')).toBeNull();
  });
});

describe('formatPack — sizeLabel', () => {
  it('hängt die Einheit ohne Leerzeichen an (Masse/Volumen)', () => {
    expect(formatPack(170, 'g', 0.99).sizeLabel).toBe('170g');
  });

  it('behält Dezimal-Größen unverändert im Label', () => {
    expect(formatPack(1.5, 'l', 0.55).sizeLabel).toBe('1.5l');
  });

  it('setzt ein Leerzeichen für Stück-Einheiten ("stk")', () => {
    expect(formatPack(25, 'Stk', 1.19).sizeLabel).toBe('25 Stk');
  });

  it('setzt ein Leerzeichen für "stück"', () => {
    expect(formatPack(6, 'Stück', 1.2).sizeLabel).toBe('6 Stück');
  });

  it('erkennt Stück auch mit angehängtem Punkt ("Stk.")', () => {
    // u = "stk." → replace(/\.$/) → "stk" → isStk; Label nutzt das Original-unit
    expect(formatPack(25, 'Stk.', 1.19).sizeLabel).toBe('25 Stk.');
  });

  it('gibt beide Felder null zurück, wenn size fehlt/0 ist', () => {
    expect(formatPack(undefined, 'g', 0.99)).toEqual({
      sizeLabel: null,
      unitPriceLabel: null,
    });
    expect(formatPack(0, 'g', 0.99)).toEqual({
      sizeLabel: null,
      unitPriceLabel: null,
    });
  });

  it('gibt beide Felder null zurück, wenn unit fehlt/leer ist', () => {
    expect(formatPack(170, undefined, 0.99)).toEqual({
      sizeLabel: null,
      unitPriceLabel: null,
    });
    expect(formatPack(170, '', 0.99)).toEqual({
      sizeLabel: null,
      unitPriceLabel: null,
    });
  });
});

describe('formatPack — unitPriceLabel (Grundpreis)', () => {
  it('g → €/kg über (price/size)*1000', () => {
    expect(formatPack(170, 'g', 0.99)).toEqual({
      sizeLabel: '170g',
      unitPriceLabel: '5,82€/kg',
    });
  });

  it('kg → €/kg über price/size', () => {
    expect(formatPack(2, 'kg', 5).unitPriceLabel).toBe('2,50€/kg');
  });

  it('ml → €/L über (price/size)*1000', () => {
    expect(formatPack(500, 'ml', 1).unitPriceLabel).toBe('2,00€/L');
  });

  it('l → €/L über price/size', () => {
    expect(formatPack(1.5, 'l', 0.55)).toEqual({
      sizeLabel: '1.5l',
      unitPriceLabel: '0,37€/L',
    });
  });

  it('stk → €/Stk. über price/size', () => {
    expect(formatPack(25, 'Stk', 1.19)).toEqual({
      sizeLabel: '25 Stk',
      unitPriceLabel: '0,05€/Stk.',
    });
  });

  it('rundet den Grundpreis auf zwei Dezimalstellen (toFixed(2))', () => {
    // 0.99 / 170 * 1000 = 5.8235… → "5.82"
    expect(formatPack(170, 'g', 0.99).unitPriceLabel).toBe('5,82€/kg');
    // 1.00 / 333 * 1000 = 3.003… → "3.00"
    expect(formatPack(333, 'g', 1).unitPriceLabel).toBe('3,00€/kg');
  });

  it('ist case-insensitiv für die Einheit', () => {
    expect(formatPack(170, 'G', 0.99).unitPriceLabel).toBe('5,82€/kg');
    expect(formatPack(500, 'ML', 1).unitPriceLabel).toBe('2,00€/L');
    expect(formatPack(2, 'KG', 5).unitPriceLabel).toBe('2,50€/kg');
  });

  it('liefert sizeLabel, aber unitPriceLabel=null wenn price<=0', () => {
    expect(formatPack(170, 'g', 0)).toEqual({
      sizeLabel: '170g',
      unitPriceLabel: null,
    });
    expect(formatPack(170, 'g', -1)).toEqual({
      sizeLabel: '170g',
      unitPriceLabel: null,
    });
  });

  it('liefert sizeLabel, aber unitPriceLabel=null wenn price fehlt', () => {
    expect(formatPack(170, 'g')).toEqual({
      sizeLabel: '170g',
      unitPriceLabel: null,
    });
  });

  it('liefert unitPriceLabel=null für unbekannte Einheiten', () => {
    // sizeLabel wird gebaut (kein isStk → kein Leerzeichen), aber keine
    // der Grundpreis-Verzweigungen greift → unitPriceLabel bleibt null.
    expect(formatPack(3, 'pieces', 1.5)).toEqual({
      sizeLabel: '3pieces',
      unitPriceLabel: null,
    });
  });
});

describe('normalizeGrade — kind="letter"', () => {
  it('gibt den großgeschriebenen ersten Buchstaben für a–e zurück', () => {
    expect(normalizeGrade('a', 'letter')).toBe('A');
    expect(normalizeGrade('C', 'letter')).toBe('C');
    expect(normalizeGrade('e', 'letter')).toBe('E');
  });

  it('validiert nur das erste Zeichen (Rest wird ignoriert)', () => {
    expect(normalizeGrade('B-plus', 'letter')).toBe('B');
    expect(normalizeGrade('a-grade', 'letter')).toBe('A');
  });

  it('gibt null für Buchstaben außerhalb a–e zurück', () => {
    expect(normalizeGrade('f', 'letter')).toBeNull();
    expect(normalizeGrade('z', 'letter')).toBeNull();
  });

  it('gibt null für die OpenFood-Platzhalter zurück', () => {
    expect(normalizeGrade('not-applicable', 'letter')).toBeNull();
    expect(normalizeGrade('unknown', 'letter')).toBeNull();
    expect(normalizeGrade('na', 'letter')).toBeNull();
    expect(normalizeGrade('n/a', 'letter')).toBeNull();
  });

  it('gibt null für leere/whitespace-only Strings zurück', () => {
    expect(normalizeGrade('', 'letter')).toBeNull();
    expect(normalizeGrade('   ', 'letter')).toBeNull();
  });

  it('gibt null für undefined zurück', () => {
    expect(normalizeGrade(undefined, 'letter')).toBeNull();
  });

  it('trimmt führende/abschließende Whitespaces vor der Prüfung', () => {
    expect(normalizeGrade('  b  ', 'letter')).toBe('B');
  });
});

describe('normalizeGrade — kind="nova"', () => {
  it('gibt eine einzelne Ziffer 1–4 unverändert zurück', () => {
    expect(normalizeGrade('1', 'nova')).toBe('1');
    expect(normalizeGrade('4', 'nova')).toBe('4');
  });

  it('extrahiert die NOVA-Gruppe aus einem zusammengesetzten String', () => {
    expect(normalizeGrade('nova-group-3', 'nova')).toBe('3');
    expect(normalizeGrade('group 2', 'nova')).toBe('2');
  });

  it('gibt null zurück, wenn keine Ziffer 1–4 vorhanden ist', () => {
    expect(normalizeGrade('5', 'nova')).toBeNull();
    expect(normalizeGrade('0', 'nova')).toBeNull();
    expect(normalizeGrade('abc', 'nova')).toBeNull();
  });

  it('gibt null für die OpenFood-Platzhalter zurück', () => {
    expect(normalizeGrade('not-applicable', 'nova')).toBeNull();
    expect(normalizeGrade('unknown', 'nova')).toBeNull();
    expect(normalizeGrade('na', 'nova')).toBeNull();
    expect(normalizeGrade('n/a', 'nova')).toBeNull();
  });

  it('gibt null für leere Strings und undefined zurück', () => {
    expect(normalizeGrade('', 'nova')).toBeNull();
    expect(normalizeGrade(undefined, 'nova')).toBeNull();
  });

  it('nimmt die erste passende Ziffer, wenn mehrere vorkommen', () => {
    // "13" → /[^1-4]/g strip → "13" → charAt(0) → "1"
    expect(normalizeGrade('13', 'nova')).toBe('1');
  });
});
