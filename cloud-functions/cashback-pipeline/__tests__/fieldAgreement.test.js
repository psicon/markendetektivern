'use strict';
const { moneyFieldAgreement } = require('../lib/fieldAgreement');

/** Eine in sich stimmige Lesung. */
const lesung = (over = {}) => ({
  isReceipt: true,
  merchant: 'REWE',
  bonCountry: 'DE',
  bonDate: '2026-09-05',
  bonTime: '14:32',
  totalCents: 4711,
  itemCount: 37,
  eligibleItems: 30,
  reconOk: true,
  model: 'flash',
  ...over,
});

describe('moneyFieldAgreement — Artikelnamen dürfen keine Freigabe kosten', () => {
  test('gleiche Geldfelder trotz verschiedener Artikelzahl im selben Betragsbereich', () => {
    // Genau der Fall, der 137 Bons in 30 Tagen zurückhielt: die Sequenz wich ab,
    // aber Markt, Datum, Endsumme und Betrag waren identisch.
    const r = moneyFieldAgreement([lesung(), lesung({ eligibleItems: 31, itemCount: 38 })], {
      betragFuer: () => 8, // Flat-Vergütung: die Artikelzahl ändert am Geld nichts
    });
    expect(r.ok).toBe(true);
    expect(r.zeugen).toBe(2);
    expect(r.konflikte).toEqual([]);
  });

  test('kippt die Artikelzahl über eine Stufengrenze, ist das ein Konflikt', () => {
    // Pfand wird über den NAMEN erkannt — eine andere Lesung kann die Zahl
    // anrechenbarer Artikel verschieben und damit den Betrag verändern.
    const betragFuer = (n) => (n >= 8 ? 8 : 0);
    const r = moneyFieldAgreement([lesung({ eligibleItems: 8 }), lesung({ eligibleItems: 7 })], { betragFuer });
    expect(r.ok).toBe(false);
    expect(r.konflikte).toContain('betrag');
  });

  test('abweichende Endsumme hält den Bon zurück', () => {
    const r = moneyFieldAgreement([lesung(), lesung({ totalCents: 4712 })], { betragFuer: () => 8 });
    expect(r.ok).toBe(false);
    expect(r.konflikte).toContain('totalCents');
  });

  test('abweichendes Bon-Datum hält den Bon zurück', () => {
    const r = moneyFieldAgreement([lesung(), lesung({ bonDate: '2026-09-04' })], { betragFuer: () => 8 });
    expect(r.ok).toBe(false);
    expect(r.konflikte).toContain('bonDate');
  });

  test('Schreibweisen desselben Marktes sind kein Konflikt — verglichen wird über den Resolver', () => {
    const merchantKey = (m) => (/rewe/i.test(String(m)) ? 'id:rewe' : `roh:${m}`);
    const r = moneyFieldAgreement([lesung({ merchant: 'REWE' }), lesung({ merchant: 'REWE Markt GmbH' })], {
      merchantKey,
      betragFuer: () => 8,
    });
    expect(r.ok).toBe(true);
  });

  test('zwei wirklich verschiedene Märkte sind ein Konflikt', () => {
    const merchantKey = (m) => `id:${String(m).toLowerCase()}`;
    const r = moneyFieldAgreement([lesung({ merchant: 'REWE' }), lesung({ merchant: 'EDEKA' })], {
      merchantKey,
      betragFuer: () => 8,
    });
    expect(r.ok).toBe(false);
    expect(r.konflikte).toContain('markt');
  });

  test('ein fehlender Wert gilt als eigener Wert, nicht als Übereinstimmung', () => {
    const r = moneyFieldAgreement([lesung(), lesung({ bonDate: null })], { betragFuer: () => 8 });
    expect(r.ok).toBe(false);
    expect(r.konflikte).toContain('bonDate');
  });

  test('nur in sich stimmige Lesungen sind Zeugen', () => {
    // Eine Lesung, deren Positionssumme nicht zur eigenen Endsumme passt, taugt
    // als Beleg für diese Endsumme nicht.
    const r = moneyFieldAgreement([lesung(), lesung({ reconOk: false, totalCents: 9999 })], { betragFuer: () => 8 });
    expect(r.zeugen).toBe(1);
    expect(r.ok).toBe(false);
    expect(r.grund).toBe('zu_wenige_zeugen');
  });

  test('eine einzelne Lesung ist keine Übereinstimmung', () => {
    // Fail-closed: ohne zweite Meinung wird nicht automatisch freigegeben.
    const r = moneyFieldAgreement([lesung()], { betragFuer: () => 8 });
    expect(r.ok).toBe(false);
    expect(r.grund).toBe('zu_wenige_zeugen');
  });

  test('isReceipt false zählt nicht als Zeuge', () => {
    const r = moneyFieldAgreement([lesung(), lesung({ isReceipt: false })], { betragFuer: () => 8 });
    expect(r.zeugen).toBe(1);
    expect(r.ok).toBe(false);
  });

  test('ohne Lesungen wird nichts behauptet', () => {
    expect(moneyFieldAgreement([]).ok).toBe(false);
    expect(moneyFieldAgreement([]).grund).toBe('keine_lesungen');
    expect(moneyFieldAgreement(null).grund).toBe('keine_lesungen');
  });

  test('drei einige Zeugen tragen ebenfalls', () => {
    const r = moneyFieldAgreement([lesung(), lesung(), lesung({ itemCount: 39 })], { betragFuer: () => 8 });
    expect(r.ok).toBe(true);
    expect(r.zeugen).toBe(3);
  });

  test('Uhrzeit-Abweichungen sind bewusst kein Konflikt', () => {
    // Die Uhrzeit trägt nur zur Doppel-Erkennung bei, nicht zur Prämie.
    const r = moneyFieldAgreement([lesung({ bonTime: '14:32' }), lesung({ bonTime: '14:33' })], { betragFuer: () => 8 });
    expect(r.ok).toBe(true);
  });
});
