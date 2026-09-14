'use strict';
const { reconcile } = require('../lib/ocr');

const items = (...cents) => cents.map((c, i) => ({ name: `Artikel ${i + 1}`, priceCents: c }));

describe('reconcile — bisheriges Verhalten bleibt (Haupt-Lesung v1.4)', () => {
  test('Überschuss über 50 ct ohne Rabattzeilen bleibt abgelehnt', () => {
    const r = reconcile({ items: items(3987), subtotalCents: 3987, totalCents: 3787 });
    expect(r).toMatchObject({ ok: false, direction: 'overshoot', deltaCents: 200 });
  });

  test('Pfand-Unterdeckung bis 200 ct bleibt ok', () => {
    expect(reconcile({ items: items(1000), totalCents: 1150 })).toMatchObject({ ok: true, direction: 'undershoot' });
  });

  test('ohne Endbetrag nie ok — auch nicht mit Rabattzeilen', () => {
    const r = reconcile({ items: items(3987), subtotalCents: 3987, totalCents: null, basketDiscounts: [{ label: 'Rabatt', cents: 200 }] });
    expect(r.ok).toBe(false);
  });
});

describe('reconcile — Warenkorb-Rabatt mit Belegkette', () => {
  const netto = { items: items(2000, 1987), subtotalCents: 3987, totalCents: 3787 };

  test('Σ Artikel = Zwischensumme, Zwischensumme − Rabatt = Endbetrag → ok', () => {
    const r = reconcile({ ...netto, basketDiscounts: [{ label: 'Gutschein Netto-App', cents: 200 }] });
    expect(r).toMatchObject({ ok: true, direction: 'basket_discount', basketDiscountCents: 200, signedDeltaCents: -200 });
  });

  test('negativ gelesene Rabattbeträge zählen gleich', () => {
    expect(reconcile({ ...netto, basketDiscounts: [{ label: '5% Rabatt', cents: -150 }, { label: 'Coupon', cents: -50 }] }).ok).toBe(true);
  });

  test('Rabattzeile ohne erkennbare Bezeichnung ist kein Beleg', () => {
    expect(reconcile({ ...netto, basketDiscounts: [{ cents: 200 }] }).ok).toBe(false);
    expect(reconcile({ ...netto, basketDiscounts: [{ label: null, cents: 200 }] }).ok).toBe(false);
    expect(reconcile({ ...netto, basketDiscounts: [{ label: 'Zwischenbetrag', cents: 200 }] }).ok).toBe(false);
  });

  test('doppelt gelesene Artikel + erfundener Rabatt bestehen nicht (Review 14.09.)', () => {
    // Echter Bon: 5 × 2 € = 10 €. Fehl-Lesung: 10 Artikel, Zwischensumme 20 €, „Rabatt" 10 €.
    const r = reconcile({ items: items(200, 200, 200, 200, 200, 200, 200, 200, 200, 200), subtotalCents: 2000, totalCents: 1000, basketDiscounts: [{ label: 'Rabatt', cents: 1000 }] });
    expect(r.ok).toBe(false);
  });

  test('Anteil strikt unter 25 %, höchstens 20 € absolut', () => {
    expect(reconcile({ items: items(1000), subtotalCents: 1000, totalCents: 750, basketDiscounts: [{ label: 'Rabatt', cents: 250 }] }).ok).toBe(false);
    expect(reconcile({ items: items(1000), subtotalCents: 1000, totalCents: 751, basketDiscounts: [{ label: 'Rabatt', cents: 249 }] }).ok).toBe(true);
    expect(reconcile({ items: items(20000), subtotalCents: 20000, totalCents: 17900, basketDiscounts: [{ label: 'Rabatt', cents: 2100 }] }).ok).toBe(false);
  });

  test('±2 ct Rundung werden toleriert, 3 ct nicht', () => {
    expect(reconcile({ ...netto, basketDiscounts: [{ label: 'Gutschein', cents: 198 }] }).ok).toBe(true);
    expect(reconcile({ ...netto, basketDiscounts: [{ label: 'Gutschein', cents: 197 }] }).ok).toBe(false);
  });

  test('ohne gedruckte Zwischensumme keine Anerkennung', () => {
    expect(reconcile({ ...netto, subtotalCents: null, basketDiscounts: [{ label: 'Gutschein', cents: 200 }] }).ok).toBe(false);
  });

  test('Artikelsumme weicht von der Zwischensumme ab → keine Anerkennung', () => {
    expect(reconcile({ ...netto, items: items(2000, 1900), basketDiscounts: [{ label: 'Gutschein', cents: 200 }] }).ok).toBe(false);
  });

  test('leere oder kaputte Rabattliste ändert nichts', () => {
    expect(reconcile({ ...netto, basketDiscounts: [] }).ok).toBe(false);
    expect(reconcile({ ...netto, basketDiscounts: [{ label: 'Rabatt', cents: null }, null] }).ok).toBe(false);
  });
});
