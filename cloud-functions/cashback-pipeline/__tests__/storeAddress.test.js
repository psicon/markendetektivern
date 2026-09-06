'use strict';

const { deriveStoreAddress, parseAddressLine, titleCaseIfShouting } = require('../lib/storeAddress');

// Alle Zeilen stammen 1:1 aus receipts/*.ocr.parsed.merchantSubtitle (Bestand 05.09.2026).
describe('parseAddressLine — echte Bon-Adresszeilen', () => {
  test('Regelfall „Straße, PLZ Ort" (Lidl DE)', () => {
    expect(parseAddressLine('Hüttenweg 50, 14195 Berlin')).toEqual({
      street: 'Hüttenweg 50', zip: '14195', city: 'Berlin', country: 'DE',
    });
  });

  test('nur PLZ + Ort (Netto)', () => {
    expect(parseAddressLine('51103 Köln')).toEqual({ street: null, zip: '51103', city: 'Köln', country: 'DE' });
  });

  test('Filialnummer vor der Adresse ist keine PLZ und keine Straße (Netto)', () => {
    expect(parseAddressLine('Filiale 7019, Buchforststr. 1-15, 51103 Köln')).toEqual({
      street: 'Buchforststr. 1-15', zip: '51103', city: 'Köln', country: 'DE',
    });
  });

  test('umgekehrte Reihenfolge „PLZ Ort, Straße" (Netto)', () => {
    expect(parseAddressLine('42285 Wuppertal, Fried.-Engels-Allee 225')).toEqual({
      street: 'Fried.-Engels-Allee 225', zip: '42285', city: 'Wuppertal', country: 'DE',
    });
  });

  test('Filialnummer allein ergibt nichts', () => {
    expect(parseAddressLine('Filiale 6100')).toBeNull();
    expect(parseAddressLine('Filiale 6100', 'AT')).toBeNull();
  });

  test('Hausnummern-Bereich + Ortsteil mit Bindestrich', () => {
    expect(parseAddressLine('Unterdoernen 61-63, 42283 Wuppertal-Barmen')).toEqual({
      street: 'Unterdoernen 61-63', zip: '42283', city: 'Wuppertal-Barmen', country: 'DE',
    });
  });

  test('Zeilenumbruch statt Komma, 4-stellige PLZ (SPAR AT)', () => {
    expect(parseAddressLine('Gudrunstraße 102\n1100 Wien', 'AT')).toEqual({
      street: 'Gudrunstraße 102', zip: '1100', city: 'Wien', country: 'AT',
    });
  });

  test('GROSSSCHREIBUNG wird lesbar, PLZ voran (BILLA AT)', () => {
    expect(parseAddressLine('2514 TRAISKIRCHEN, WIENER STRASSE 67/OSKAR HELMER STRASSE', 'AT')).toEqual({
      street: 'Wiener Strasse 67/Oskar Helmer Strasse', zip: '2514', city: 'Traiskirchen', country: 'AT',
    });
  });

  test('Filialnummer „MPREIS 8068" ist keine PLZ; echte PLZ dahinter gewinnt', () => {
    expect(
      parseAddressLine('MPREIS Warenvertriebs GmbH, Filiale MPREIS 8068, 6020 IBK, Suedtiroler Platz 3', 'AT'),
    ).toEqual({ street: 'Suedtiroler Platz 3', zip: '6020', city: 'IBK', country: 'AT' });
  });

  test('nur Firma + Filialnummer ohne Ort → nichts', () => {
    expect(parseAddressLine('MPREIS Warenvertriebs Gmbh, Filiale MPREIS 8068', 'AT')).toBeNull();
  });

  test('Ort mit Abkürzung „St. Pölten" (Hofer AT)', () => {
    expect(parseAddressLine('Kremser Landstraße 87, 3100 St. Pölten', 'AT')).toEqual({
      street: 'Kremser Landstraße 87', zip: '3100', city: 'St. Pölten', country: 'AT',
    });
  });

  test('Stiegen-/Türnummer „6/II/57" und „Wr. Neudorf"', () => {
    expect(parseAddressLine('Am Anningerpark 6/II/57, 2351 Wr. Neudorf', 'AT')).toEqual({
      street: 'Am Anningerpark 6/II/57', zip: '2351', city: 'Wr. Neudorf', country: 'AT',
    });
  });

  test('Slogans und Firmierungen ergeben keine Adresse', () => {
    expect(parseAddressLine('Mein Drogeriemarkt')).toBeNull();
    expect(parseAddressLine('HIER BIN ICH MENSCH HIER KAUF ICH EIN')).toBeNull();
    expect(parseAddressLine('J. Stenten GmbH & Co. KG')).toBeNull();
    expect(parseAddressLine('Belegkopie')).toBeNull();
  });

  test('Ortsteil ohne PLZ ist kein Ort (zu unsicher)', () => {
    expect(parseAddressLine('Dortmund-Kreuzviertel')).toBeNull();
  });

  test('nur Straße → unvollständig, aber die Straße bleibt', () => {
    expect(parseAddressLine('Eppelheimer Straße 78')).toEqual({ street: 'Eppelheimer Straße 78', zip: null, city: null, country: null });
    expect(parseAddressLine('Bahnhofstraße 50')).toEqual({ street: 'Bahnhofstraße 50', zip: null, city: null, country: null });
  });

  test('Slogan + Straße + Ort ohne PLZ (TK Maxx): Straße ja, Ort nein', () => {
    expect(parseAddressLine('big labels. small prices, Steile Straße 1, Stade')).toEqual({
      street: 'Steile Straße 1', zip: null, city: null, country: null,
    });
  });

  test('Länderpräfix „D-" wird entfernt', () => {
    expect(parseAddressLine('Musterstraße 3, D-51103 Köln')).toEqual({
      street: 'Musterstraße 3', zip: '51103', city: 'Köln', country: 'DE',
    });
  });

  test('bei DE-Hinweis ist eine 4-stellige Zahl nie eine PLZ', () => {
    expect(parseAddressLine('Kremser Landstraße 87, 3100 St. Pölten', 'DE')).toEqual({
      street: 'Kremser Landstraße 87', zip: null, city: null, country: 'DE',
    });
  });

  test('ohne Landeshinweis: 5-stellig zuerst, sonst 4-stellig ohne Land', () => {
    expect(parseAddressLine('Kremser Landstraße 87, 3100 St. Pölten')).toEqual({
      street: 'Kremser Landstraße 87', zip: '3100', city: 'St. Pölten', country: null,
    });
  });

  test('Telefonnummer und Ort hinter der PLZ werden getrennt', () => {
    expect(parseAddressLine('Gewerbestraße 1, 69221 Dossenheim Tel. 06221 12345')).toEqual({
      street: 'Gewerbestraße 1', zip: '69221', city: 'Dossenheim', country: 'DE',
    });
  });

  test('Rossmann-Format „PLZ Ort / Straße Nr" trennt Ort und Straße', () => {
    expect(parseAddressLine('Dirk Rossmann GmbH, 23683 Scharbeutz / Hamburger Ring 11')).toEqual({
      street: 'Hamburger Ring 11', zip: '23683', city: 'Scharbeutz', country: 'DE',
    });
    expect(parseAddressLine('VKST-2795 - 53359 Rheinbach / Münstereifeler Str. 5-7')).toEqual({
      street: 'Münstereifeler Str. 5-7', zip: '53359', city: 'Rheinbach', country: 'DE',
    });
  });

  test('Trenner ohne Straße bleibt Teil des Ortsnamens', () => {
    expect(parseAddressLine('Glauchauer Str. 11, 09350 Lichtenstein / Sachsen')).toMatchObject({ city: 'Lichtenstein / Sachsen' });
    expect(parseAddressLine('Am Weidenbach 26-30, 50676 Köln - Altstadt Süd')).toMatchObject({ city: 'Köln - Altstadt Süd' });
    expect(parseAddressLine('Industriestraße 1 B, 61449 Steinbach (Taunus)')).toMatchObject({ street: 'Industriestraße 1 B', city: 'Steinbach (Taunus)' });
  });

  test('GROSSSCHREIBUNG mit Füllwörtern (BILLA AT)', () => {
    expect(parseAddressLine('8600 BRUCK AN DER MUR, GRAZER STRASSE 3 - B 116', 'AT')).toEqual({
      street: 'Grazer Strasse 3 - B 116', zip: '8600', city: 'Bruck an der Mur', country: 'AT',
    });
  });

  test('Filialnummer mit Doppelpunkt und Telefon mit Doppelpunkt sind keine PLZ', () => {
    expect(parseAddressLine('Filiale: 6040', 'AT')).toBeNull();
    expect(parseAddressLine('2514 TRAISKIRCHEN\nTEL: 059915-03063', 'AT')).toEqual({
      street: null, zip: '2514', city: 'Traiskirchen', country: 'AT',
    });
  });

  test('Adresse ohne Komma mit UID-Zeile dahinter (Kaufland)', () => {
    expect(parseAddressLine('Gewerbestraße 19\n69221 Dossenheim\nDE213413670')).toEqual({
      street: 'Gewerbestraße 19', zip: '69221', city: 'Dossenheim', country: 'DE',
    });
    expect(parseAddressLine('Anderslebener Str. 42 39387 Oschersleben (Bode)')).toEqual({
      street: 'Anderslebener Str. 42', zip: '39387', city: 'Oschersleben (Bode)', country: 'DE',
    });
  });

  test('Ortsnamen, die mit „Tel"/„Fax" beginnen, bleiben Orte', () => {
    expect(parseAddressLine('Potsdamer Str. 12, 14513 Teltow')).toEqual({ street: 'Potsdamer Str. 12', zip: '14513', city: 'Teltow', country: 'DE' });
    expect(parseAddressLine('Bahnhofstr. 2, 48291 Telgte Tel. 02504 1234')).toEqual({ street: 'Bahnhofstr. 2', zip: '48291', city: 'Telgte', country: 'DE' });
    expect(deriveStoreAddress({ bonCountry: 'DE', storeAddress: { street: null, zip: '14513', city: 'Teltow' } })).toMatchObject({ zip: '14513', city: 'Teltow' });
  });

  test('Ortsnamen mit „Markt" / Straßen mit „Fil…" sind keine Schlüsselwörter', () => {
    expect(parseAddressLine('Bahnhofstr. 3, 85570 Markt Schwaben')).toEqual({ street: 'Bahnhofstr. 3', zip: '85570', city: 'Markt Schwaben', country: 'DE' });
    expect(parseAddressLine('Filderstraße 5, 70599 Stuttgart')).toEqual({ street: 'Filderstraße 5', zip: '70599', city: 'Stuttgart', country: 'DE' });
  });

  test('GROSSSCHREIBUNG: 4-Buchstaben-Städte werden lesbar, vokallose Kürzel und römische Stiegen bleiben', () => {
    expect(parseAddressLine('GUDRUNSTRASSE 102, 1100 WIEN', 'AT')).toEqual({ street: 'Gudrunstrasse 102', zip: '1100', city: 'Wien', country: 'AT' });
    expect(parseAddressLine('AM ANNINGERPARK 6/II/57, 2351 WR. NEUDORF', 'AT')).toMatchObject({ street: 'Am Anningerpark 6/II/57', city: 'Wr. Neudorf' });
    expect(titleCaseIfShouting('IBK')).toBe('IBK');
    expect(titleCaseIfShouting('LINZ')).toBe('Linz');
    expect(titleCaseIfShouting('ULM')).toBe('ULM'); // bewusster Rest: 3-Buchstaben-Orte
  });

  test('Markenname als Präfix verschwindet aus der Straße', () => {
    expect(parseAddressLine('Kaufland - Aachener Straße 58, 50674 Köln')).toMatchObject({ street: 'Aachener Straße 58', city: 'Köln' });
    expect(deriveStoreAddress({ merchant: 'Lidl', merchantSubtitle: 'Lidl - Hüttenweg 50, 14195 Berlin' })).toMatchObject({ street: 'Hüttenweg 50', zip: '14195' });
  });

  test('Firmensitz vor Filiale: der Treffer hinter dem „Filiale"-Marker gewinnt (MPREIS)', () => {
    expect(parseAddressLine('MPREIS Warenvertriebs GmbH\n6176 Vols, Landesstraße 16\nFiliale MPREIS 8068\n6020 IBK, Suedtiroler Platz 3', 'AT')).toEqual({
      street: 'Suedtiroler Platz 3', zip: '6020', city: 'IBK', country: 'AT',
    });
  });

  test('„PLZ Ort Straße Nr" ohne Trenner wird getrennt', () => {
    expect(parseAddressLine('51103 Köln Buchforststr. 1-15')).toEqual({ street: 'Buchforststr. 1-15', zip: '51103', city: 'Köln', country: 'DE' });
  });

  test('Kassen-/Filialnummern und führende Nullen sind keine Straßen', () => {
    expect(parseAddressLine('Kasse: 8')).toBeNull();
    expect(parseAddressLine('Filiale: 6040 Musterdorf', 'AT')).toBeNull();
    expect(parseAddressLine('Aldi Süd 039-041')).toBeNull();
  });

  test('Land passt zur PLZ-Länge — in beiden Quellen gleich', () => {
    expect(parseAddressLine('Musterweg 1, 39025 Fremdstadt', 'AT')).toMatchObject({ zip: '39025', country: null });
    expect(deriveStoreAddress({ bonCountry: 'AT', storeAddress: { street: null, zip: '39025', city: 'Fremdstadt' } })).toMatchObject({ zip: '39025', country: null });
    expect(deriveStoreAddress({ bonCountry: 'DE', storeAddress: { street: null, zip: '3100', city: 'St. Pölten' } })).toMatchObject({ zip: null, city: 'St. Pölten' });
  });

  test('OCR-Teiltreffer wird mit der Adresszeile gemergt', () => {
    const out = deriveStoreAddress({ bonCountry: 'DE', storeAddress: { street: 'Gewerbestraße 19', zip: null, city: null }, merchantSubtitle: 'Gewerbestraße 19, 69221 Dossenheim' });
    expect(out).toEqual({ street: 'Gewerbestraße 19', zip: '69221', city: 'Dossenheim', country: 'DE', source: 'ocr+subtitle', complete: true });
    expect(deriveStoreAddress({ bonCountry: 'DE', storeAddress: { street: null, zip: null, city: '69221 Dossenheim' } })).toMatchObject({ city: 'Dossenheim', zip: null });
  });

  test('Form „Ort PLZ Land"', () => {
    expect(parseAddressLine('Berlin 10719 DE')).toMatchObject({ zip: '10719', city: 'Berlin', country: 'DE' });
  });

  test('leer / null', () => {
    expect(parseAddressLine('')).toBeNull();
    expect(parseAddressLine(null)).toBeNull();
    expect(parseAddressLine(undefined)).toBeNull();
  });
});

describe('deriveStoreAddress — Quellenwahl', () => {
  test('strukturiertes OCR-Feld (Prompt v1.4) hat Vorrang', () => {
    const out = deriveStoreAddress({
      bonCountry: 'DE',
      storeAddress: { street: 'Gewerbestraße 19', zip: '69221', city: 'Dossenheim' },
      merchantSubtitle: 'irgendwas anderes, 12345 Fremdstadt',
    });
    expect(out).toEqual({
      street: 'Gewerbestraße 19', zip: '69221', city: 'Dossenheim', country: 'DE', source: 'ocr', complete: true,
    });
  });

  test('ungültige PLZ im OCR-Feld wird verworfen, Rest bleibt', () => {
    const out = deriveStoreAddress({ bonCountry: 'DE', storeAddress: { street: null, zip: '6922', city: 'Dossenheim' } });
    expect(out).toMatchObject({ zip: null, city: 'Dossenheim', source: 'ocr', complete: false });
  });

  test('leeres OCR-Objekt → Fallback auf merchantSubtitle (Bestand)', () => {
    const out = deriveStoreAddress({ storeAddress: { street: null, zip: null, city: null }, merchantSubtitle: 'Hüttenweg 50, 14195 Berlin' });
    expect(out).toMatchObject({ zip: '14195', city: 'Berlin', source: 'subtitle', complete: true });
  });

  test('ohne bonCountry zählt das Land des Händlers (AT, 4-stellig)', () => {
    const out = deriveStoreAddress({ merchantSubtitle: 'Gudrunstraße 102\n1100 Wien' }, 'AT');
    expect(out).toMatchObject({ zip: '1100', city: 'Wien', country: 'AT', source: 'subtitle' });
  });

  test('Kopfzeile mit Anschrift nur mit PLZ übernehmen', () => {
    expect(deriveStoreAddress({ merchant: 'REWE, 51103 Köln' })).toMatchObject({ zip: '51103', city: 'Köln', source: 'merchant' });
    expect(deriveStoreAddress({ merchant: 'Kaufland Heidelberg-Pfaffengrund' })).toBeNull();
  });

  test('nichts Verwertbares → null', () => {
    expect(deriveStoreAddress({ merchant: 'Lidl', merchantSubtitle: 'Belegkopie' })).toBeNull();
    expect(deriveStoreAddress(null)).toBeNull();
    expect(deriveStoreAddress({})).toBeNull();
  });
});

describe('titleCaseIfShouting', () => {
  test('nur reine GROSSSCHREIBUNG wird umgewandelt, Kürzel bleiben', () => {
    expect(titleCaseIfShouting('WIENER STRASSE 67')).toBe('Wiener Strasse 67');
    expect(titleCaseIfShouting('IBK')).toBe('IBK');
    expect(titleCaseIfShouting('St. Pölten')).toBe('St. Pölten');
  });
});
