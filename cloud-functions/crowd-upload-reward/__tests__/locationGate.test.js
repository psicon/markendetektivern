'use strict';

/**
 * Tests der Ortsanforderung für die Vergütung.
 *
 * Hier hängt Geld dran, deshalb prüfen diese Tests vor allem die zwei
 * Richtungen, die im Betrieb teuer wären: dass niemand ohne Ortsangabe
 * bezahlt wird, WENN seine App danach fragen konnte — und dass niemand
 * leer ausgeht, nur weil er noch nicht aktualisiert hat.
 */

const { pruefeOrtsanforderung } = require('../src/locationGate');

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
  it('vergütet bei gpsStatus unavailable — der Nutzer wurde nie gefragt', () => {
    // Wizard ≤ 6.0.15 (18b8cb6): Berechtigung erteilt → Schritt entfällt →
    // GPS liefert nichts → Einreichung ohne Ort, ohne dass der Nutzer je
    // die Chance hatte, einen einzutippen. 53 von 55 Fällen am 03.09.2026.
    const r = pruefeOrtsanforderung({
      clientVersion: { app: '6.0.15', build: '1234', platform: 'android' },
      capture: { gpsStatus: 'unavailable' },
    });
    expect(r.ok).toBe(true);
    expect(r.grund).toBe('gps_fix_fehlt_schritt_uebersprungen');
  });

  it('vergütet ebenso bei timeout', () => {
    const r = pruefeOrtsanforderung({ clientVersion: { app: '6.0.15' }, capture: { gpsStatus: 'timeout' } });
    expect(r.ok).toBe(true);
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
