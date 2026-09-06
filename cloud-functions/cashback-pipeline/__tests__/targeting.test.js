'use strict';
const { resolveRegion, matchesTargeting, pickCampaignForRegion } = require('../lib/targeting');

const kampagne = (over = {}) => ({ id: 'bundesweit', endAt: new Date('2026-09-30T22:00:00Z'), ...over });

describe('resolveRegion — Quellen in der Reihenfolge ihrer Verlässlichkeit', () => {
  test('die Bon-Adresse gewinnt vor allem anderen', () => {
    expect(resolveRegion({ bonZip: '50667', bonFotoZip: '10115', profilZip: '80331', country: 'DE' }))
      .toEqual({ zip: '50667', city: null, country: 'DE', source: 'bon' });
  });

  test('ohne Bon zählt der Bon aus dem Produktfoto, dann das Profil', () => {
    expect(resolveRegion({ bonFotoZip: '10115', profilZip: '80331' }).source).toBe('bonfoto');
    expect(resolveRegion({ profilZip: '80331' })).toMatchObject({ zip: '80331', source: 'profil' });
  });

  test('Ortsname wird über die gelernte Tabelle aufgelöst', () => {
    const tabelle = new Map([['schleusingen', '98553'], ['koeln', '50667']]);
    expect(resolveRegion({ ortName: 'Schleusingen', cityToZip: tabelle })).toMatchObject({ zip: '98553', source: 'ort' });
    // Umlaute und Schreibweisen werden normalisiert
    expect(resolveRegion({ ortName: 'Köln', cityToZip: tabelle })).toMatchObject({ zip: '50667', source: 'ort' });
    // Unbekannter Ort → keine PLZ, aber der Name bleibt erhalten
    expect(resolveRegion({ ortName: 'Kleinkleckersdorf', cityToZip: tabelle })).toMatchObject({ zip: null, city: 'Kleinkleckersdorf', source: null });
  });

  test('unbrauchbare PLZ zählt nicht als Region', () => {
    expect(resolveRegion({ bonZip: '12' }).zip).toBeNull();
    expect(resolveRegion({ bonZip: 'abcde' }).zip).toBeNull();
    expect(resolveRegion({}).source).toBeNull();
  });

  test('nur bekannte Länder werden übernommen', () => {
    expect(resolveRegion({ bonZip: '50667', country: 'de' }).country).toBe('DE');
    expect(resolveRegion({ bonZip: '50667', country: 'IT' }).country).toBeNull();
  });
});

describe('matchesTargeting', () => {
  const region = (zip, country = 'DE') => ({ zip, country, source: 'bon' });

  test('ohne Angabe gilt die Aktion überall', () => {
    expect(matchesTargeting(kampagne(), region('50667'))).toEqual({ ok: true, grund: 'kein_targeting' });
    expect(matchesTargeting(kampagne({ targeting: {} }), region(null))).toEqual({ ok: true, grund: 'kein_targeting' });
  });

  test('PLZ-Gebiete: ein Präfix deckt das ganze Gebiet ab', () => {
    const k = kampagne({ targeting: { zipPrefixes: ['0', '1'] } });
    expect(matchesTargeting(k, region('01067')).ok).toBe(true);
    expect(matchesTargeting(k, region('10115')).ok).toBe(true);
    expect(matchesTargeting(k, region('50667'))).toEqual({ ok: false, grund: 'plz_ausserhalb' });
  });

  test('Präfixe sind beliebig fein — Stadt oder einzelne PLZ', () => {
    const koeln = kampagne({ targeting: { zipPrefixes: ['50', '51'] } });
    expect(matchesTargeting(koeln, region('50667')).ok).toBe(true);
    expect(matchesTargeting(koeln, region('52062')).ok).toBe(false);
    const eine = kampagne({ targeting: { zipPrefixes: ['98553'] } });
    expect(matchesTargeting(eine, region('98553')).ok).toBe(true);
    expect(matchesTargeting(eine, region('98554')).ok).toBe(false);
  });

  test('Länder-Beschränkung, auch ohne PLZ', () => {
    const nurAT = kampagne({ targeting: { countries: ['AT'] } });
    expect(matchesTargeting(nurAT, region('1100', 'AT'))).toEqual({ ok: true, grund: 'land_passt' });
    expect(matchesTargeting(nurAT, region('50667', 'DE'))).toEqual({ ok: false, grund: 'land_ausserhalb' });
  });

  test('Land UND PLZ müssen beide passen', () => {
    const k = kampagne({ targeting: { countries: ['DE'], zipPrefixes: ['5'] } });
    expect(matchesTargeting(k, region('50667', 'DE')).ok).toBe(true);
    expect(matchesTargeting(k, region('50667', 'AT')).ok).toBe(false);
    expect(matchesTargeting(k, region('10115', 'DE')).ok).toBe(false);
  });

  test('unbekannte Region ist standardmäßig erlaubt — niemand wird für eine fehlende Adresse bestraft', () => {
    const k = kampagne({ targeting: { zipPrefixes: ['0'] } });
    expect(matchesTargeting(k, region(null))).toEqual({ ok: true, grund: 'region_unbekannt_erlaubt' });
  });

  test('strikte Aktionen können das ausdrücklich abschalten', () => {
    const k = kampagne({ targeting: { zipPrefixes: ['0'], onUnknown: 'deny' } });
    expect(matchesTargeting(k, region(null))).toEqual({ ok: false, grund: 'region_unbekannt' });
    const l = kampagne({ targeting: { countries: ['DE'], onUnknown: 'deny' } });
    expect(matchesTargeting(l, { zip: '50667', country: null }).ok).toBe(false);
  });
});

describe('pickCampaignForRegion — der Server korrigiert die Wahl der App', () => {
  const bund = kampagne({ id: 'bundesweit' });
  const nord = kampagne({ id: 'nord', targeting: { zipPrefixes: ['2'] } });
  const koeln = kampagne({ id: 'koeln', targeting: { zipPrefixes: ['50', '51'] }, endAt: new Date('2026-12-31T22:00:00Z') });
  const region = (zip) => ({ zip, country: 'DE', source: 'bon' });

  test('passt die gewählte Aktion, bleibt sie', () => {
    expect(pickCampaignForRegion([bund, nord], region('22765'), 'nord')).toMatchObject({ campaign: nord, korrigiert: false });
  });

  test('passt sie nicht, springt der Bon auf eine passende — das merkt der Datensatz', () => {
    const r = pickCampaignForRegion([bund, nord], region('50667'), 'nord');
    expect(r.campaign).toBe(bund);
    expect(r.korrigiert).toBe(true);
  });

  test('die engste passende Aktion gewinnt vor der bundesweiten', () => {
    expect(pickCampaignForRegion([bund, koeln], region('50667'), null).campaign).toBe(koeln);
    expect(pickCampaignForRegion([bund, koeln], region('10115'), null).campaign).toBe(bund);
  });

  test('ohne Wahl und ohne passende Aktion gibt es keine', () => {
    expect(pickCampaignForRegion([nord], region('50667'), null)).toMatchObject({ campaign: null, grund: 'keine_passende_aktion' });
    expect(pickCampaignForRegion([nord], region('50667'), 'nord')).toMatchObject({ campaign: null, grund: 'region_ausserhalb' });
    expect(pickCampaignForRegion([], region('50667'), null)).toMatchObject({ campaign: null, grund: 'keine_aktion' });
  });

  test('unbekannte Region: die gewählte Aktion bleibt bestehen', () => {
    expect(pickCampaignForRegion([bund, nord], region(null), 'nord')).toMatchObject({ campaign: nord, korrigiert: false });
  });

  test('bei gleich engem Gebiet entscheidet das frühere Ende', () => {
    const a = kampagne({ id: 'a', targeting: { zipPrefixes: ['5'] }, endAt: new Date('2026-09-30T22:00:00Z') });
    const b = kampagne({ id: 'b', targeting: { zipPrefixes: ['5'] }, endAt: new Date('2026-10-31T22:00:00Z') });
    expect(pickCampaignForRegion([b, a], region('50667'), null).campaign).toBe(a);
  });
});
