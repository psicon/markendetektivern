'use strict';

/**
 * Tests für das Ortungs-Scoring.
 *
 * Der Schwerpunkt liegt auf den INVARIANTEN, nicht auf Einzelwerten: Das
 * Modell darf sich in seinen Schwellen ändern, aber niemals darin, dass
 * ein schwaches Signal ein starkes verdrängt oder dass eine Koordinate
 * ausgegeben wird, die keine Messung trägt. Genau diese beiden Fehler
 * wären in den Daten unsichtbar — ein falscher Ort sieht aus wie ein
 * richtiger.
 */

const { bewerteLocation, distanzKm, landAusKoordinate } = require('../src/scorer');

/** Bequemer Aufbau eines Rohsignal-Satzes. */
const roh = (over = {}) => ({
  submittedAtMs: Date.parse('2026-08-11T10:00:00Z'),
  marketLand: 'DE',
  ...over,
});

const GPS_BERLIN = { lat: 52.52, lon: 13.405, accuracyM: 20, ageMinutes: 2 };
const GPS_MUENCHEN = { lat: 48.137, lon: 11.575, accuracyM: 20, ageMinutes: 2 };

describe('Die IP-Ortung darf niemals den Ort bestimmen', () => {
  it('gewinnt nicht, auch wenn sie das einzige Signal mit Koordinate ist', () => {
    const r = bewerteLocation(
      roh({
        ipLocation: { lat: 51.15, lon: 10.45, city: 'Erfurt', source: 'ip' },
        ipLand: 'DE',
      }),
    );
    // Sieger ist die Landesaussage, nicht die IP-Stadt.
    expect(r.source).toBe('market_country');
    expect(r.granularity).toBe('country');
    expect(r.city).toBeNull();
    expect(r.lat).toBeNull();
    expect(r.lon).toBeNull();
  });

  it('taucht als Signal auf, aber ohne Koordinate — sonst wird sie doch als Ort gelesen', () => {
    const r = bewerteLocation(
      roh({ ipLocation: { lat: 51.15, lon: 10.45, city: 'Erfurt', source: 'ip' } }),
    );
    const ip = r.signals.find((s) => s.kind === 'ip_region');
    expect(ip).toBeDefined();
    expect(ip.city).toBe('Erfurt');
    expect(ip.lat).toBeUndefined();
    expect(ip.lon).toBeUndefined();
  });

  it('wertet ein GPS-Signal NICHT ab, obwohl sie fast immer widerspricht', () => {
    // Gemessen: 0 von 64 Übereinstimmungen, Fehler 61–377 km. Würde die
    // IP demotieren dürfen, wäre jedes GPS-Signal dauerhaft entwertet.
    const ohne = bewerteLocation(roh({ captureGps: GPS_BERLIN }));
    const mit = bewerteLocation(
      roh({
        captureGps: GPS_BERLIN,
        ipLocation: { lat: 48.137, lon: 11.575, city: 'München', source: 'ip' },
        ipLand: 'DE',
      }),
    );
    expect(mit.confidence).toBe(ohne.confidence);
    expect(mit.confidence).toBe('high');
    expect(mit.conflicts).toEqual([]);
  });

  it('behandelt den DACH-Fallback als Nicht-Ort', () => {
    const r = bewerteLocation(
      roh({ ipLocation: { lat: 51.15, lon: 10.45, city: null, source: 'fallback' } }),
    );
    expect(r.signals.some((s) => s.kind === 'ip_fallback')).toBe(true);
    expect(r.signals.some((s) => s.kind === 'ip_region')).toBe(false);
  });
});

describe('Rangfolge — die beste Messung gewinnt allein', () => {
  it('GPS schlägt EXIF', () => {
    const r = bewerteLocation(
      roh({
        captureGps: GPS_BERLIN,
        exifGps: { lat: 48.137, lon: 11.575, accuracyM: 9, ageMinutes: 5 },
      }),
    );
    expect(r.source).toBe('gps_capture');
  });

  it('EXIF schlägt eine bestätigte Ortsangabe', () => {
    const r = bewerteLocation(
      roh({
        exifGps: { lat: 52.52, lon: 13.405, accuracyM: 9, ageMinutes: 5 },
        confirmedPlace: { city: 'Hamburg', lat: 53.55, lon: 9.99 },
      }),
    );
    expect(r.source).toBe('exif_gps');
  });

  it('eine bestätigte Ortsangabe schlägt die Profil-Selbstauskunft', () => {
    const r = bewerteLocation(
      roh({
        confirmedPlace: { city: 'Hamburg', lat: 53.55, lon: 9.99 },
        profileRegion: { city: 'Stuttgart', bundesland: 'Baden-Württemberg' },
      }),
    );
    expect(r.source).toBe('user_confirmed_place');
    expect(r.city).toBe('Hamburg');
  });

  it('mischt niemals zwei Koordinaten', () => {
    const r = bewerteLocation(
      roh({ captureGps: GPS_BERLIN, exifGps: { lat: 48.137, lon: 11.575, ageMinutes: 5 } }),
    );
    // Exakt die GPS-Koordinate, kein Mittelwert irgendwo dazwischen.
    expect(r.lat).toBeCloseTo(52.52, 4);
    expect(r.lon).toBeCloseTo(13.405, 4);
  });
});

describe('Konfidenz spiegelt die Messgüte', () => {
  it('frisches, genaues GPS ist hoch', () => {
    expect(bewerteLocation(roh({ captureGps: GPS_BERLIN })).confidence).toBe('high');
  });

  it('Androids „ungefährer Standort" (km-Bereich) ist nur mittel', () => {
    const r = bewerteLocation(
      roh({ captureGps: { lat: 52.52, lon: 13.405, accuracyM: 2500, ageMinutes: 1 } }),
    );
    expect(r.confidence).toBe('medium');
    // 2,5 km Radius legt die Stadt fest, aber nicht die Filiale — deshalb
    // 'city' und NICHT 'point'/'store'. Und die Koordinate wird nur auf
    // 3 Nachkommastellen gespeichert, damit sie nicht genauer aussieht,
    // als die Messung ist.
    expect(r.granularity).toBe('city');
    expect(r.usableFor).toContain('city');
    expect(r.usableFor).not.toContain('store');
  });

  it('ein altes Galeriefoto belegt den Aufnahme-, nicht den Einreichungsort', () => {
    // Der reale Fall: EXIF-Aufnahme 10,8 Tage vor der Einreichung.
    const r = bewerteLocation(
      roh({ exifGps: { lat: 49.19, lon: 11.33, accuracyM: 9, ageMinutes: 15552 } }),
    );
    expect(r.confidence).toBe('low');
    expect(r.lat).toBeNull(); // low trägt nie eine Koordinate
  });

  it('frisches EXIF ist hoch', () => {
    const r = bewerteLocation(
      roh({ exifGps: { lat: 49.19, lon: 11.33, accuracyM: 9, ageMinutes: 12 } }),
    );
    expect(r.confidence).toBe('high');
    expect(r.lat).toBeCloseTo(49.19, 4);
  });
});

describe('Obergrenzen — eine Quelle kann nicht mehr behaupten, als sie weiß', () => {
  it('die Selbstauskunft bleibt bei „low", auch wenn alles sie bestätigt', () => {
    const r = bewerteLocation(
      roh({
        profileRegion: { city: 'Stuttgart', bundesland: 'Baden-Württemberg', land: 'DE' },
        ipLocation: { lat: 48.78, lon: 9.18, city: 'Stuttgart', source: 'ip' },
        ipLand: 'DE',
      }),
    );
    expect(r.source).toBe('user_profile_region');
    expect(r.confidence).toBe('low');
    expect(r.lat).toBeNull();
  });

  it('eine bestätigte Ortsangabe kommt nie über „medium"', () => {
    const r = bewerteLocation(
      roh({ confirmedPlace: { city: 'Hamburg', lat: 53.55, lon: 9.99, accuracyM: 500 } }),
    );
    expect(r.confidence).toBe('medium');
  });
});

describe('Ohne Messung keine Koordinate', () => {
  it('gibt bei „low" niemals lat/lon aus', () => {
    const r = bewerteLocation(roh({ profileRegion: { city: 'Stuttgart' } }));
    expect(r.confidence).toBe('low');
    expect(r.lat).toBeNull();
    expect(r.lon).toBeNull();
  });

  it('erfindet für eine reine Landesaussage keinen Mittelpunkt', () => {
    const r = bewerteLocation(roh({ marketLand: 'DE', ipLand: 'DE' }));
    expect(r.granularity).toBe('country');
    expect(r.land).toBe('DE');
    expect(r.lat).toBeNull();
  });
});

describe('Der Negativfall wird geschrieben, nicht weggelassen', () => {
  it('liefert ein vollständiges Objekt, wenn gar nichts bekannt ist', () => {
    const r = bewerteLocation({ submittedAtMs: 0 });
    expect(r.granularity).toBe('none');
    expect(r.confidence).toBe('none');
    expect(r.source).toBe('none');
    expect(r.usableFor).toEqual([]);
    expect(r).toHaveProperty('modelVersion');
    // „nicht ermittelbar" muss von „nie verarbeitet" unterscheidbar sein.
  });
});

describe('usableFor schützt vor Fehlgebrauch der Ebene', () => {
  it('lässt eine Landesangabe nicht als Stadt durchgehen', () => {
    const r = bewerteLocation(roh({ marketLand: 'DE', ipLand: 'DE' }));
    expect(r.usableFor).toContain('country');
    expect(r.usableFor).not.toContain('city');
    expect(r.usableFor).not.toContain('point');
  });

  it('gibt eine genaue GPS-Messung für jede Ebene frei', () => {
    const r = bewerteLocation(roh({ captureGps: GPS_BERLIN }));
    expect(r.usableFor).toContain('point');
    expect(r.usableFor).toContain('city');
  });

  it('gibt eine schwache Selbstauskunft nicht für die Stadtebene frei', () => {
    const r = bewerteLocation(roh({ profileRegion: { city: 'Stuttgart' } }));
    expect(r.usableFor).not.toContain('city');
    expect(r.usableFor).not.toContain('point');
  });

  it('MEHR Information darf die Verwertbarkeit nie verschlechtern', () => {
    // Der Fehler, den erst der Trockenlauf über 299 Bestandsdokumente
    // zutage förderte: Mit Selbstauskunft gewinnt `user_profile_region`
    // (gedeckelt auf „low") das Rennen um die Position — die Landesaussage
    // aus Markt und IP gilt aber unverändert weiter. Vorher fielen genau
    // diese 94 Dokumente aus jeder Länder-Auswertung heraus.
    const ohne = bewerteLocation(roh({ marketLand: 'DE', ipLand: 'DE' }));
    const mit = bewerteLocation(
      roh({ marketLand: 'DE', ipLand: 'DE', profileRegion: { city: 'Stuttgart' } }),
    );
    expect(ohne.usableFor).toContain('country');
    expect(mit.usableFor).toContain('country');
    expect(mit.land).toBe('DE');
  });

  it('lässt die Landesebene weg, wenn die Quellen sich widersprechen', () => {
    const r = bewerteLocation(roh({ marketLand: 'DE', ipLand: 'AT' }));
    expect(r.usableFor).not.toContain('country');
    expect(r.conflicts).toContain('laender_quellen_uneins');
  });
});

describe('Kreuzvalidierung', () => {
  it('bestätigt, wenn zwei unabhängige Messungen zusammenpassen', () => {
    const r = bewerteLocation(
      roh({
        captureGps: GPS_BERLIN,
        exifGps: { lat: 52.521, lon: 13.407, accuracyM: 9, ageMinutes: 4 },
      }),
    );
    expect(r.agreement).toBe('corroborated');
  });

  it('meldet einen Konflikt, wenn zwei Messungen weit auseinanderliegen', () => {
    const r = bewerteLocation(
      roh({
        captureGps: GPS_BERLIN,
        exifGps: { lat: 48.137, lon: 11.575, accuracyM: 9, ageMinutes: 4 },
      }),
    );
    expect(r.agreement).toBe('conflicting');
    expect(r.conflicts.length).toBeGreaterThan(0);
    // Aber der Sieger bleibt der Sieger — GPS beschreibt die Einreichung.
    expect(r.source).toBe('gps_capture');
  });

  it('entwertet eine echte Messung nie bis auf „none"', () => {
    // Selbst bei mehreren Widersprüchen bleibt eine Messung eine Messung.
    const r = bewerteLocation(
      roh({
        captureGps: { lat: 52.52, lon: 13.405, accuracyM: 5000, ageMinutes: 600 },
        exifGps: { lat: 48.137, lon: 11.575, accuracyM: 9, ageMinutes: 4 },
        confirmedPlace: { city: 'Hamburg', lat: 53.55, lon: 9.99 },
      }),
    );
    expect(r.confidence).not.toBe('none');
  });

  it('vermerkt eine Messung außerhalb des gewählten Marktlandes, ohne sie abzuwerten', () => {
    // Österreichische Koordinate bei deutschem Markt: eher ist das
    // Marktfeld falsch als die GPS-Messung.
    const r = bewerteLocation(
      roh({ marketLand: 'DE', captureGps: { lat: 47.101, lon: 11.335, accuracyM: 20, ageMinutes: 2 } }),
    );
    expect(r.conflicts.some((c) => c.includes('land_gemessen'))).toBe(true);
    expect(r.confidence).toBe('high');
  });
});

describe('Hilfsfunktionen', () => {
  it('rechnet Entfernungen plausibel (Berlin–München ≈ 504 km)', () => {
    const d = distanzKm({ lat: 52.52, lon: 13.405 }, { lat: 48.137, lon: 11.575 });
    expect(d).toBeGreaterThan(495);
    expect(d).toBeLessThan(515);
  });

  it('ordnet eindeutige Koordinaten einem Land zu', () => {
    expect(landAusKoordinate(52.52, 13.405)).toBe('DE'); // Berlin
    expect(landAusKoordinate(48.21, 16.37)).toBe('AT'); // Wien
  });

  it('gibt bei mehrdeutiger Grenzlage lieber null zurück als eine falsche Zuordnung', () => {
    expect(landAusKoordinate(47.5, 9.7)).toBeNull(); // Bodensee-Dreiländereck
  });
});
