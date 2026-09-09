'use strict';
const { ergebnisFelder } = require('../src/ergebnis');
const { campaignZurAufnahmezeit } = require('../src/campaignFallback');

// Platzhalter statt firebase-admin — geprüft wird die Form, nicht Firestore.
const FV = {
  delete: () => '<<DELETE>>',
  serverTimestamp: () => '<<NOW>>',
};

describe('ergebnisFelder — die Invariante „approved ohne rewardResult = Fehler"', () => {
  test('jede Buchung trägt Betrag und Ergebnis', () => {
    const f = ergebnisFelder(FV, { result: 'credited', cents: 12 });
    expect(f.rewardResult).toBe('credited');
    expect(f.rewardCents).toBe(12);
    expect(f.rewardCheckedAt).toBe('<<NOW>>');
  });

  test('eine Buchung räumt einen alten Skip-Vermerk weg', () => {
    // Ohne das trüge ein Dokument nach „ablehnen → zurückholen → freigeben"
    // gleichzeitig rewardCents: 12 und rewardSkipped: true, und die App zeigte
    // dem Nutzer den Standort-Hinweis, obwohl das Geld gebucht ist.
    const f = ergebnisFelder(FV, { result: 'credited', cents: 12 });
    expect(f.rewardSkipped).toBe('<<DELETE>>');
    expect(f.rewardSkippedReason).toBe('<<DELETE>>');
    expect(f.rewardNotCreditedReason).toBe('<<DELETE>>');
  });

  test('ohne Buchung stehen Grund und Null-Betrag da', () => {
    const f = ergebnisFelder(FV, { result: 'not_credited', reason: 'per_user_cap_reached' });
    expect(f.rewardResult).toBe('not_credited');
    expect(f.rewardCents).toBe(0);
    expect(f.rewardNotCreditedReason).toBe('per_user_cap_reached');
  });

  test('rewardSkipped wird NIE nebenbei gesetzt — nur wenn der Aufrufer es ausdrücklich mitgibt', () => {
    // Die ausgelieferte App liest rewardSkipped und leitet daraus genau einen
    // Satz ab: „…braucht deinen Standort". Ein Sammelflag würde Menschen, die
    // ihren Standort geliefert haben, eine falsche Erklärung geben.
    const deckel = ergebnisFelder(FV, { result: 'not_credited', reason: 'per_user_cap_reached' });
    expect(deckel.rewardSkipped).toBeUndefined();

    const ort = ergebnisFelder(FV, {
      result: 'not_credited',
      reason: 'no_location',
      extra: { rewardSkipped: true, rewardSkippedReason: 'no_location' },
    });
    expect(ort.rewardSkipped).toBe(true);
  });

  test('extra-Felder überschreiben nichts, was die Invariante trägt', () => {
    const f = ergebnisFelder(FV, { result: 'credited', cents: 16, extra: { rewardLocationRule: 'ort_vorhanden' } });
    expect(f.rewardResult).toBe('credited');
    expect(f.rewardLocationRule).toBe('ort_vorhanden');
  });
});

describe('campaignZurAufnahmezeit — der Server springt für den Client ein', () => {
  const k = (id, von, bis, over = {}) => ({
    id, kind: 'product_photos', cashbackPerBonCents: 12,
    startAt: new Date(von), endAt: new Date(bis), ...over,
  });
  const am = (d) => new Date(d).getTime();

  test('nimmt die Aktion, die zur EINREICHUNGSZEIT lief', () => {
    const alle = [k('juli', '2026-07-01', '2026-08-31'), k('september', '2026-08-31', '2026-09-30')];
    expect(campaignZurAufnahmezeit(alle, am('2026-07-15')).campaignId).toBe('juli');
  });

  test('eine echte Lücke wird NICHT nachträglich vergütet', () => {
    // Sonst zahlte eine späte Freigabe für eine Zeit, in der nichts versprochen war.
    const alle = [k('september', '2026-09-01', '2026-09-30')];
    expect(campaignZurAufnahmezeit(alle, am('2026-08-15'))).toEqual({
      campaignId: null, grund: 'keine_aktion_zur_aufnahmezeit',
    });
  });

  test('Bon-Aktionen und Aktionen ohne Betrag zählen nicht', () => {
    const alle = [
      k('bons', '2026-09-01', '2026-09-30', { kind: 'receipt' }),
      k('ohne-betrag', '2026-09-01', '2026-09-30', { cashbackPerBonCents: 0 }),
    ];
    expect(campaignZurAufnahmezeit(alle, am('2026-09-15')).campaignId).toBeNull();
  });

  test('die GÜNSTIGSTE gewinnt — dieselbe Voreinstellung, die der Client zeigt', () => {
    // User-Vorgabe 09.09.2026. Vorher entschied das frühere Enddatum, und die
    // höhere Vergütung war der Gleichstand-Entscheid — beim Geld ein
    // Zufallsergebnis. Laufen „Milchprodukte 0,16 €" und „Produkt-Fotos
    // 0,12 €" parallel, kostete jede stumm eingeordnete Einreichung die
    // Differenz.
    const alle = [
      k('teuer', '2026-09-01', '2026-09-15', { cashbackPerBonCents: 16 }),
      k('guenstig', '2026-09-01', '2026-09-30', { cashbackPerBonCents: 12 }),
    ];
    // Die teure endet FRÜHER und stünde nach der alten Regel vorn.
    expect(campaignZurAufnahmezeit(alle, am('2026-09-10')).campaignId).toBe('guenstig');
  });

  test('bei gleichem Betrag entscheidet weiter das frühere Ende', () => {
    // Sonst hinge die Auswahl an der Sortierung der Datenbankabfrage.
    const alle = [
      k('spaet', '2026-09-01', '2026-09-30', { cashbackPerBonCents: 16 }),
      k('frueh', '2026-09-01', '2026-09-15', { cashbackPerBonCents: 16 }),
    ];
    expect(campaignZurAufnahmezeit(alle, am('2026-09-10')).campaignId).toBe('frueh');
  });

  test('eine Aktion ohne Restbudget wird auch dann nicht genommen, wenn sie die günstigste wäre', () => {
    // Sie zu wählen hiesse, den Vorgang mit „Budget erschöpft" abzuschliessen,
    // während nebenan eine zahlende Aktion läuft.
    const alle = [
      k('leer', '2026-09-01', '2026-09-30', { cashbackPerBonCents: 5, budgetRemainingCents: 0 }),
      k('zahlt', '2026-09-01', '2026-09-30', { cashbackPerBonCents: 12 }),
    ];
    expect(campaignZurAufnahmezeit(alle, am('2026-09-10')).campaignId).toBe('zahlt');
  });

  test('ohne Aufnahmedatum wird nicht geraten', () => {
    expect(campaignZurAufnahmezeit([k('a', '2026-09-01', '2026-09-30')], null)).toEqual({
      campaignId: null, grund: 'kein_aufnahmedatum',
    });
  });
});

describe('campaignZurAufnahmezeit — Ausschlüsse, die überall sonst gelten', () => {
  const { kandidatenZurAufnahmezeit } = require('../src/campaignFallback');

  const k = (id, over = {}) => ({
    id, kind: 'product_photos', cashbackPerBonCents: 12,
    startAt: new Date('2026-09-01'), endAt: new Date('2026-09-30'), ...over,
  });
  const am = (d) => new Date(d).getTime();

  test('eine abgeschaltete Aktion wird nie gewählt', () => {
    expect(campaignZurAufnahmezeit([k('aus', { active: false })], am('2026-09-10')).campaignId).toBeNull();
  });

  test('nachträglich gestoppt: gilt für Aufnahmen VOR dem Stopp, nicht danach', () => {
    // Genauso rechnet die Bon-Pipeline — der Stopp wirkt nicht rückwirkend.
    const gestoppt = [k('gestoppt', { deactivatedAt: new Date('2026-09-15') })];
    expect(campaignZurAufnahmezeit(gestoppt, am('2026-09-10')).campaignId).toBe('gestoppt');
    expect(campaignZurAufnahmezeit(gestoppt, am('2026-09-20')).campaignId).toBeNull();
  });

  test('eine Aktion ohne Restbudget wird übersprungen, nicht gewählt', () => {
    // Sonst endete der Vorgang mit „Budget erschöpft", obwohl daneben eine
    // zahlende Aktion lief — genau die ausbleibende Buchung, die der Rückfall
    // beseitigen soll.
    const alle = [k('leer', { budgetRemainingCents: 0 }), k('voll', { budgetRemainingCents: 50000, cashbackPerBonCents: 10 })];
    expect(campaignZurAufnahmezeit(alle, am('2026-09-10')).campaignId).toBe('voll');
  });

  test('ohne Zeitfenster ist nicht entscheidbar, ob die Aktion galt', () => {
    expect(campaignZurAufnahmezeit([{ id: 'offen', kind: 'product_photos', cashbackPerBonCents: 12 }], am('2026-09-10')).campaignId).toBeNull();
  });

  test('bei gleichem Ende gewinnt die NIEDRIGERE Vergütung', () => {
    // Umgekehrt seit dem 09.09.2026. Vorher galt: der Server springt für den
    // Client ein und soll nicht weniger zahlen, als die App in Aussicht
    // gestellt hat. Genau diese Begründung hat sich gedreht — die App stellt
    // jetzt selbst die günstigste Aktion in Aussicht, die teurere wäre also
    // MEHR als versprochen. Beide Seiten müssen dieselbe Wahl treffen.
    const alle = [k('billig', { cashbackPerBonCents: 12 }), k('teuer', { cashbackPerBonCents: 16 })];
    expect(campaignZurAufnahmezeit(alle, am('2026-09-10')).campaignId).toBe('billig');
  });

  test('die Kandidatenliste steht vollständig zur Verfügung', () => {
    // Passt die erste Aktion später nicht (Gebiet, Deckel), kann der Aufrufer
    // die nächste nehmen, statt gar nicht zu buchen.
    const alle = [k('a', { endAt: new Date('2026-09-15') }), k('b')];
    expect(kandidatenZurAufnahmezeit(alle, am('2026-09-10')).map((c) => c.id)).toEqual(['a', 'b']);
  });
});
