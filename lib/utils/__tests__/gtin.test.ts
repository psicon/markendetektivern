import { gleicheGtin, istGtinForm, istRisikoform, pruefzifferStimmt, vergleichsform } from '../gtin';

describe('pruefzifferStimmt', () => {
  it('erkennt gültige Nummern aller Längen', () => {
    expect(pruefzifferStimmt('4337256984164')).toBe(true); // EAN-13
    expect(pruefzifferStimmt('20117221')).toBe(true); // EAN-8 (Milbona Hirtenkäse)
    expect(pruefzifferStimmt('036000291452')).toBe(true); // UPC-A
    expect(pruefzifferStimmt('00036000291452')).toBe(true); // GTIN-14
    expect(pruefzifferStimmt('3392590205376')).toBe(true);
  });

  it('lehnt falsche Prüfziffer, falsche Länge und Nicht-Ziffern ab', () => {
    expect(pruefzifferStimmt('4337256984165')).toBe(false);
    expect(pruefzifferStimmt('431150113523')).toBe(false); // abgeschnittene Feldlesung
    expect(pruefzifferStimmt('25504300005')).toBe(false); // 11 Stellen
    expect(pruefzifferStimmt('1234567')).toBe(false);
    expect(pruefzifferStimmt('43372569841a4')).toBe(false);
    expect(pruefzifferStimmt('')).toBe(false);
  });

  it('trimmt Leerzeichen', () => {
    expect(pruefzifferStimmt(' 4337256984164 ')).toBe(true);
  });
});

describe('vergleichsform / gleicheGtin', () => {
  it('setzt 12- und 13-stellig gleich (iPhone streicht die führende 0)', () => {
    expect(vergleichsform('036000291452')).toBe('0036000291452');
    expect(gleicheGtin('036000291452', '0036000291452')).toBe(true);
    expect(gleicheGtin('00036000291452', '036000291452')).toBe(true);
  });

  it('lässt andere Nummern unverändert und unterscheidet sie', () => {
    expect(vergleichsform('4337256984164')).toBe('4337256984164');
    expect(vergleichsform('20117221')).toBe('20117221');
    expect(gleicheGtin('4337256900355', '4337256944755')).toBe(false);
  });
});

describe('istGtinForm', () => {
  it('prüft nur Form, nicht Prüfziffer', () => {
    expect(istGtinForm('4337256984165')).toBe(true);
    expect(istGtinForm('123456789')).toBe(false);
  });
});

describe('istRisikoform', () => {
  it('8- und 12-stellig sind Risikoformen', () => {
    expect(istRisikoform('20117221')).toBe(true);
    expect(istRisikoform('321542697856')).toBe(true);
  });

  it('Präfix 000–139 ist Risikoform', () => {
    expect(istRisikoform('0131970289790')).toBe(true);
    expect(istRisikoform('1577776979735')).toBe(true);
  });

  it('nicht vergebene Präfixe sind Risikoform', () => {
    expect(istRisikoform('1400000000000')).toBe(true); // 140
    expect(istRisikoform('6640531369408')).toBe(true); // 664
    expect(istRisikoform('9640531369408')).toBe(false); // 964 (GS1 UK) ist vergeben
  });

  it('übliche Handelsnummern sind normal', () => {
    expect(istRisikoform('4337256984164')).toBe(false); // DE
    expect(istRisikoform('8000270016161')).toBe(false); // IT
    expect(istRisikoform('9001234567893')).toBe(false); // AT
    expect(istRisikoform('2012345678909')).toBe(false); // Ladencode / lose Ware
  });
});
