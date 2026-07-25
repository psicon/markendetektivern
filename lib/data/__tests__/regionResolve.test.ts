/**
 * Standort: manuelle Auswahl schlägt Schätzung (ClickUp 86cawtkjp).
 *
 * Der gemeldete Bug: der im Profil gewählte Ort landete in `location`,
 * angezeigt wurde aber `city ?? guessedCity` — die manuelle Eingabe
 * wurde also nie gelesen. Klaus W. wählte "Bous" (Saarland) und sah
 * dauerhaft "Leisnig, Sachsen" (die geratene Stadt aus der
 * Journey-History).
 */

import {
  regionFromPickedLocation,
  resolveUserRegion,
} from '../city-to-bundesland';

describe('regionFromPickedLocation — Auswahl → strukturierte Region', () => {
  it('nimmt Geocoder-Felder direkt (Klaus-Fall: kleiner Ort, nicht in der Tabelle)', () => {
    expect(
      regionFromPickedLocation({
        address: 'Saarstraße, Bous, Germany',
        city: 'Bous',
        region: 'Saarland',
      }),
    ).toEqual({ city: 'Bous', bundesland: 'Saarland' });
  });

  it('Geocoder-Region gewinnt gegen die Tabelle', () => {
    // Falls Tabelle und Geocoder je abweichen: der Geocoder kennt den
    // konkreten Punkt, die Tabelle nur den Städtenamen.
    expect(
      regionFromPickedLocation({ city: 'Dresden', region: 'Sachsen' }).bundesland,
    ).toBe('Sachsen');
  });

  it('fällt ohne Geocoder-Region auf die Stadt-Tabelle zurück', () => {
    expect(regionFromPickedLocation({ city: 'Dresden' })).toEqual({
      city: 'Dresden',
      bundesland: 'Sachsen',
    });
  });

  it('parst die Stadt aus dem formatierten String, wenn das Feld fehlt', () => {
    expect(
      regionFromPickedLocation({ address: 'Prager Straße, Dresden, Germany' }),
    ).toEqual({ city: 'Dresden', bundesland: 'Sachsen' });
  });

  it('normalisiert englische Städtenamen (Munich → München)', () => {
    expect(regionFromPickedLocation({ city: 'Munich' }).city).toBe('München');
  });

  it('liefert null statt Leerstring, wenn nichts brauchbar ist', () => {
    expect(regionFromPickedLocation({ address: '', city: '', region: '  ' })).toEqual({
      city: null,
      bundesland: null,
    });
  });

  it('unbekannter kleiner Ort ohne Geocoder-Region: Stadt ja, Bundesland null', () => {
    const r = regionFromPickedLocation({ city: 'Bous' });
    expect(r.city).toBe('Bous');
    expect(r.bundesland).toBeNull();
  });
});

describe('resolveUserRegion — Präzedenz beim Anzeigen', () => {
  it('REGRESSION Klaus-Fall: manuelles Bous schlägt geratenes Leisnig', () => {
    expect(
      resolveUserRegion({
        city: 'Bous',
        bundesland: 'Saarland',
        guessedCity: 'Leisnig',
        guessedBundesland: 'Sachsen',
      }),
    ).toEqual({ city: 'Bous', bundesland: 'Saarland', isManual: true });
  });

  it('ohne manuelle Auswahl greift die Schätzung', () => {
    expect(
      resolveUserRegion({ guessedCity: 'Leisnig', guessedBundesland: 'Sachsen' }),
    ).toEqual({ city: 'Leisnig', bundesland: 'Sachsen', isManual: false });
  });

  it('Altdaten-Leerstring blockiert die Schätzung NICHT (?? -Falle)', () => {
    // Mit `city ?? guessedCity` hätte '' gewonnen → User sah keinen Ort.
    expect(
      resolveUserRegion({
        city: '',
        bundesland: '',
        guessedCity: 'Leipzig',
        guessedBundesland: 'Sachsen',
      }),
    ).toEqual({ city: 'Leipzig', bundesland: 'Sachsen', isManual: false });
  });

  it('manuelle Stadt ohne Bundesland mischt NICHT mit der Schätzung', () => {
    // Sonst entstünde "Bous, Sachsen" — in sich widersprüchlich.
    expect(
      resolveUserRegion({
        city: 'Bous',
        guessedCity: 'Leisnig',
        guessedBundesland: 'Sachsen',
      }),
    ).toEqual({ city: 'Bous', bundesland: null, isManual: true });
  });

  it('leeres/fehlendes Profil ist unkritisch', () => {
    expect(resolveUserRegion(null)).toEqual({
      city: null,
      bundesland: null,
      isManual: false,
    });
    expect(resolveUserRegion({})).toEqual({
      city: null,
      bundesland: null,
      isManual: false,
    });
  });
});
