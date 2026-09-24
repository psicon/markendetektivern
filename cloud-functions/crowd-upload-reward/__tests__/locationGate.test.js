'use strict';

/**
 * Tests der Ortsanforderung für die Vergütung.
 *
 * Hier hängt Geld dran, deshalb prüfen diese Tests vor allem die zwei
 * Richtungen, die im Betrieb teuer wären: dass niemand ohne Ortsangabe
 * bezahlt wird, WENN seine App danach fragen konnte — und dass niemand
 * leer ausgeht, nur weil er noch nicht aktualisiert hat.
 */

const { pruefeOrtsanforderung, STANDORTPFLICHT_AB_BUILD } = require('../src/locationGate');

const IP = { source: 'ip', city: 'Köln', lat: 50.95, lon: 6.95 };

describe('Ein angegebener Ort erfüllt die Anforderung', () => {
  it('akzeptiert eine Standortmessung', () => {
    const r = pruefeOrtsanforderung({
      clientVersion: { app: '6.0.16' },
      capture: { gps: { lat: 52.52, lon: 13.405 } },
    });
    expect(r.ok).toBe(true);
  });

  it('akzeptiert einen eingetippten Ort gleichwertig', () => {
    // Die Anforderung lautet „sag uns wo", nicht „gib GPS frei". GPS als
    // einzigen Weg zu verlangen wäre nach Art. 5 Abs. 1 lit. c auch nicht
    // zu halten, wenn ein Ortsname den Datensatz erfüllt.
    const r = pruefeOrtsanforderung({
      clientVersion: { app: '6.0.16' },
      capture: { confirmedPlace: { city: 'Ludwigsburg' } },
    });
    expect(r.ok).toBe(true);
  });
});

describe('Ohne Ort keine Vergütung — wenn die App danach fragen konnte', () => {
  it('lehnt eine aktualisierte App ohne Ortsangabe ab', () => {
    const r = pruefeOrtsanforderung({
      clientVersion: { app: '6.0.16', platform: 'ios' },
      capture: { gpsStatus: 'denied' },
    });
    expect(r.ok).toBe(false);
    expect(r.grund).toBe('no_location');
  });

  it('lehnt auch ab, wenn capture ganz fehlt', () => {
    const r = pruefeOrtsanforderung({ clientVersion: { app: '6.0.16' } });
    expect(r.ok).toBe(false);
  });
});

describe('Wer noch nicht aktualisiert hat, geht nicht leer aus', () => {
  it('vergütet eine alte App ohne clientVersion', () => {
    // Diese Leute haben nichts falsch gemacht — ihre App kennt den
    // Pflicht-Schritt schlicht nicht. Genau so entstand schon einmal
    // „144 freigegeben, 0 Cent ausgezahlt".
    const r = pruefeOrtsanforderung({ marketName: 'Aldi Süd', status: 'approved', createdAt: new Date('2026-08-20T10:00:00Z') });
    expect(r.ok).toBe(true);
    expect(r.grund).toBe('gnadenfrist_alter_client');
  });

  it('markiert die Gnadenfrist erkennbar, statt sie stillschweigend zu gewähren', () => {
    const r = pruefeOrtsanforderung({ createdAt: new Date('2026-08-20T10:00:00Z') });
    // Ohne diesen Vermerk ließe sich später nicht messen, wie viele
    // Auszahlungen noch auf der Übergangsregel beruhen — und man wüsste
    // nie, wann man sie gefahrlos abschalten kann.
    expect(r.grund).toBe('gnadenfrist_alter_client');
  });
});

describe('Die App hat den Orts-Schritt übersprungen, der GPS-Fix blieb aus', () => {
  it('vergütet bei gpsStatus unavailable mit IP-Ortung — der Nutzer wurde nie gefragt', () => {
    // Wizard ≤ 6.0.15 (18b8cb6): Berechtigung erteilt → Schritt entfällt →
    // GPS liefert nichts → Einreichung ohne Ort, ohne dass der Nutzer je
    // die Chance hatte, einen einzutippen. 53 von 55 Fällen am 03.09.2026.
    const r = pruefeOrtsanforderung({
      clientVersion: { app: '6.0.15', build: '1234', platform: 'android' },
      capture: { gpsStatus: 'unavailable' },
      journeyLocation: IP,
    });
    expect(r.ok).toBe(true);
    expect(r.grund).toBe('gps_fix_fehlt_schritt_uebersprungen');
  });

  it('vergütet ebenso bei timeout mit IP-Ortung', () => {
    const r = pruefeOrtsanforderung({ clientVersion: { app: '6.0.15' }, capture: { gpsStatus: 'timeout' }, journeyLocation: IP });
    expect(r.ok).toBe(true);
  });

  it('gescheiterte IP-Abfrage ist ein Infrastrukturfehler — vergütet trotzdem (Review 24.09.2026)', () => {
    const ohne = pruefeOrtsanforderung({ clientVersion: { app: '6.0.15' }, capture: { gpsStatus: 'unavailable' } });
    expect(ohne).toEqual({ ok: true, grund: 'gps_fix_fehlt_schritt_uebersprungen' });
    // 'fallback' ist der DACH-Mittelpunkt einer gescheiterten IP-Abfrage.
    const fallback = pruefeOrtsanforderung({ clientVersion: { app: '6.0.15' }, capture: { gpsStatus: 'timeout' }, journeyLocation: { source: 'fallback', lat: 51.15, lon: 10.45 } });
    expect(fallback.ok).toBe(true);
    const leer = pruefeOrtsanforderung({ clientVersion: { app: '6.0.15' }, capture: { gpsStatus: 'timeout' }, journeyLocation: { lat: null, lon: null, city: null, source: null } });
    expect(leer.ok).toBe(true);
  });

  it('IP-Ortung ersetzt keine verweigerte Freigabe', () => {
    const r = pruefeOrtsanforderung({ clientVersion: { app: '6.0.17' }, capture: { gpsStatus: 'denied' }, journeyLocation: IP });
    expect(r).toEqual({ ok: false, grund: 'no_location' });
  });

  it('lehnt weiterhin ab, wenn der Nutzer die Berechtigung verweigert hat', () => {
    // denied = die App hat den Orts-Schritt angeboten, der Nutzer hat ihn
    // übersprungen — das ist eine Entscheidung, keine Lücke der App.
    const r = pruefeOrtsanforderung({ clientVersion: { app: '6.0.15' }, capture: { gpsStatus: 'denied' } });
    expect(r.ok).toBe(false);
    expect(r.grund).toBe('no_location');
  });
});

describe('Robustheit', () => {
  it('kommt mit null/undefined zurecht, statt zu werfen', () => {
    // Ein Fehler hier würde den Trigger abbrechen lassen — und damit eine
    // rechtmäßige Vergütung verhindern.
    expect(() => pruefeOrtsanforderung(null)).not.toThrow();
    expect(() => pruefeOrtsanforderung(undefined)).not.toThrow();
  });

  it('wertet ein leeres capture-Objekt nicht als Ortsangabe', () => {
    const r = pruefeOrtsanforderung({ clientVersion: { app: '6.0.16' }, capture: {} });
    expect(r.ok).toBe(false);
  });
});

describe('Die Gnadenfrist ist datumsbasiert (Orts-Audit 05.09.2026)', () => {
  it('vergütet ein Alt-Client-Dokument von vor dem Stichtag — auch bei später Freigabe', () => {
    const r = pruefeOrtsanforderung({ status: 'approved', createdAt: { toMillis: () => Date.parse('2026-09-01T23:59:00Z') } });
    expect(r.ok).toBe(true);
    expect(r.grund).toBe('gnadenfrist_alter_client');
  });

  it('lehnt ein Dokument ohne clientVersion ab, das NACH dem Stichtag entstand', () => {
    const r = pruefeOrtsanforderung({ status: 'approved', createdAt: { toMillis: () => Date.parse('2026-09-02T00:00:01Z') } });
    expect(r.ok).toBe(false);
    expect(r.grund).toBe('no_location');
  });

  it('behandelt ein Dokument ohne createdAt wie einen aktuellen Client (keine stille Gnade)', () => {
    const r = pruefeOrtsanforderung({ status: 'approved' });
    expect(r.ok).toBe(false);
  });

  it('akzeptiert createdAt als Firestore-Timestamp-Form {seconds}', () => {
    const r = pruefeOrtsanforderung({ status: 'approved', createdAt: { seconds: Math.floor(Date.parse('2026-08-15T00:00:00Z') / 1000) } });
    expect(r.ok).toBe(true);
    expect(r.grund).toBe('gnadenfrist_alter_client');
  });
});

describe('Ortsangabe aus dem Kassenbon (06.09.2026)', () => {
  const basis = { clientVersion: { app: '6.0.15' }, createdAt: new Date('2026-09-06T10:00:00Z'), capture: { gpsStatus: 'denied' } };

  test('vollständige Bon-Adresse erfüllt die Ortspflicht', () => {
    const r = pruefeOrtsanforderung({ ...basis, priceReceipt: { zip: '46325', city: 'Borken', street: 'Otto-Hahn-Str. 18', complete: true } });
    expect(r).toEqual({ ok: true, grund: 'ort_aus_kassenbon' });
  });

  test('unvollständige Bon-Angabe zählt nicht', () => {
    expect(pruefeOrtsanforderung({ ...basis, priceReceipt: { zip: null, city: 'Borken', complete: false } }).ok).toBe(false);
    expect(pruefeOrtsanforderung({ ...basis, priceReceipt: { merchant: 'ALDI', complete: false } }).ok).toBe(false);
    expect(pruefeOrtsanforderung({ ...basis, priceReceipt: null }).ok).toBe(false);
  });

  test('Kassenbon hat Vorrang vor Ortsangabe und GPS (Rangfolge 24.09.2026)', () => {
    const bon = { zip: '46325', city: 'Borken', complete: true };
    expect(pruefeOrtsanforderung({ ...basis, capture: { confirmedPlace: { city: 'Köln' } }, priceReceipt: bon })).toEqual({ ok: true, grund: 'ort_aus_kassenbon' });
    expect(pruefeOrtsanforderung({ ...basis, capture: { gps: { lat: 51.8, lon: 6.8 }, gpsStatus: 'granted_precise' }, priceReceipt: bon })).toEqual({ ok: true, grund: 'ort_aus_kassenbon' });
  });

  test('ohne lesbaren Bon: GPS vor Ortsangabe, beide mit dem bisherigen Grund', () => {
    expect(pruefeOrtsanforderung({ ...basis, capture: { gps: { lat: 51.8, lon: 6.8 }, confirmedPlace: { city: 'Köln' } } })).toEqual({ ok: true });
    expect(pruefeOrtsanforderung({ ...basis, capture: { confirmedPlace: { city: 'Köln' } }, priceReceipt: { city: 'Borken', complete: false } })).toEqual({ ok: true });
  });
});

describe('Harte Standortfreigabe-Pflicht (Entscheidung 24.09.2026)', () => {
  const ab = { android: 1250, ios: 1280 };
  const doc = (platform, build, capture, extra = {}) => ({ clientVersion: { app: '6.1.0', platform, build: String(build) }, capture, ...extra });

  test('greift ab 6.0.20 (Android 1244, iOS 1270) — ältere Versionen unberührt', () => {
    expect(STANDORTPFLICHT_AB_BUILD).toEqual({ android: 1244, ios: 1270 });
    const getippt = { gpsStatus: 'denied', confirmedPlace: { city: 'Köln' } };
    // 6.0.19 bzw. 6.0.18 bieten „Ort eintippen" noch an → weiter vergütet
    expect(pruefeOrtsanforderung(doc('android', 1243, getippt))).toEqual({ ok: true });
    expect(pruefeOrtsanforderung(doc('ios', 1269, getippt))).toEqual({ ok: true });
    // ab 6.0.20 zählt ohne Freigabe nichts
    expect(pruefeOrtsanforderung(doc('android', 1244, getippt))).toEqual({ ok: false, grund: 'no_location' });
    expect(pruefeOrtsanforderung(doc('ios', 1270, getippt))).toEqual({ ok: false, grund: 'no_location' });
    // mit Freigabe normal
    expect(pruefeOrtsanforderung(doc('ios', 1270, { gpsStatus: 'granted_precise', gps: { lat: 51, lon: 7 } })).ok).toBe(true);
  });

  test('ab dem Build: ohne Freigabe keine Vergütung — auch nicht mit eingetipptem Ort oder Bon', () => {
    const bon = { zip: '46325', city: 'Borken', complete: true };
    expect(pruefeOrtsanforderung(doc('ios', 1280, { gpsStatus: 'denied', confirmedPlace: { city: 'Köln' } }), { standortpflichtAb: ab }).ok).toBe(false);
    expect(pruefeOrtsanforderung(doc('android', 1251, { gpsStatus: 'not_asked' }, { priceReceipt: bon }), { standortpflichtAb: ab }).ok).toBe(false);
  });

  test('ab dem Build: mit Freigabe gilt die Rangfolge, auch der Rückfall bei fehlendem Fix', () => {
    expect(pruefeOrtsanforderung(doc('android', 1250, { gpsStatus: 'timeout', confirmedPlace: { city: 'Köln' } }), { standortpflichtAb: ab })).toEqual({ ok: true });
    expect(pruefeOrtsanforderung(doc('android', 1250, { gpsStatus: 'unavailable' }, { journeyLocation: IP }), { standortpflichtAb: ab }).ok).toBe(true);
    expect(pruefeOrtsanforderung(doc('ios', 1280, { gpsStatus: 'granted_coarse', gps: { lat: 1, lon: 2 } }), { standortpflichtAb: ab })).toEqual({ ok: true });
  });

  test('ältere Builds bleiben unberührt (Übergang, bis das Update verbreitet ist)', () => {
    expect(pruefeOrtsanforderung(doc('ios', 1269, { gpsStatus: 'denied', confirmedPlace: { city: 'Köln' } }), { standortpflichtAb: ab })).toEqual({ ok: true });
  });
});
