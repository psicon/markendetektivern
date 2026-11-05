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

// ─── Prompt v1.5, Coupon-Fix (05.10.2026): Rabattzeilen als negative Items ──

describe('reconcile — Rabattzeilen in items (category Warenkorbrabatt)', () => {
  const { countEligibleItems } = require('../lib/ocr');
  const rz = (name, cents, extra = {}) => ({ name, priceCents: cents, category: 'Warenkorbrabatt', ...extra });
  // Echter Rossmann-Aufbau: Artikel brutto, Zwischensumme, zwei Coupons, Endbetrag.
  const rossmann = {
    items: [...items(2500, 2000, 1500, 1000, 1000), rz('10% COUPONAKTION', -500), rz('Coupon 20% ISANA', -300)],
    subtotalCents: 8000,
    totalCents: 7200,
  };

  test('Belegkette erfüllt → ok, Rabatt ausgewiesen; Rabattzeilen zählen nie als Artikel', () => {
    expect(reconcile(rossmann)).toMatchObject({ ok: true, direction: 'basket_discount', basketDiscountCents: 800, sumItemsCents: 7200, signedDeltaCents: 0 });
    expect(countEligibleItems(rossmann)).toBe(5);
  });

  test('Artikel brutto ≠ gedruckte Zwischensumme → nicht belegt (doppelt gelesener Artikel + passender Rabatt)', () => {
    const doppelt = { ...rossmann, items: [...items(2500, 2000, 1500, 1000, 1000, 1000), rz('Coupon', -1800)] };
    // Σ aller Items = 7200 = Endbetrag, aber Σ Artikel 9000 ≠ Zwischensumme 8000.
    expect(reconcile(doppelt)).toMatchObject({ ok: false, direction: 'basket_discount_unbelegt' });
  });

  test('Zwischensumme − Rabatt ≠ Endbetrag → nicht belegt', () => {
    expect(reconcile({ ...rossmann, totalCents: 7100 }).ok).toBe(false);
  });

  test('Grenzen bleiben: Rabatt ab 25 % oder über 20 € → nicht belegt', () => {
    const viertel = { items: [...items(1000), rz('Rabatt', -250)], subtotalCents: 1000, totalCents: 750 };
    expect(reconcile(viertel)).toMatchObject({ ok: false, direction: 'basket_discount_unbelegt' });
    expect(reconcile({ ...viertel, items: [...items(1000), rz('Rabatt', -249)], totalCents: 751 }).ok).toBe(true);
    const gross = { items: [...items(20000), rz('Coupon', -2100)], subtotalCents: 20000, totalCents: 17900 };
    expect(reconcile(gross).ok).toBe(false);
    expect(reconcile({ ...gross, items: [...items(20000), rz('Coupon', -2000)], totalCents: 18000 }).ok).toBe(true);
  });

  test('Rabattzeile ohne erkennbare Bezeichnung (Name oder raw) ist kein Beleg', () => {
    expect(reconcile({ ...rossmann, items: [...items(2500, 2000, 1500, 1000, 1000), rz('Zwischenbetrag', -800)] }).ok).toBe(false);
    expect(reconcile({ ...rossmann, items: [...items(2500, 2000, 1500, 1000, 1000), rz('9823219330109', -800, { raw: '9823219330109 10% COUPONAKTION €8,00' })] }).ok).toBe(true);
  });

  test('±2 ct Rundung in der Kette, 3 ct nicht', () => {
    expect(reconcile({ ...rossmann, subtotalCents: 8002, totalCents: 7202 }).ok).toBe(true);
    expect(reconcile({ ...rossmann, subtotalCents: 8003 }).ok).toBe(false);
  });

  test('keine eigene Zwischensumme (fehlt oder = Endbetrag): Summe aller Items wie bisher, Grenzen gelten', () => {
    const inline = { items: [...items(1000, 1000), rz('App-Coupon 10%', -200)], totalCents: 1800 };
    expect(reconcile(inline)).toMatchObject({ ok: true, direction: 'basket_discount', basketDiscountCents: 200 });
    expect(reconcile({ ...inline, subtotalCents: 1800 }).ok).toBe(true);
    // Pfand-Toleranz wie bisher: Σ bis 2 € unter dem Endbetrag.
    expect(reconcile({ ...inline, totalCents: 1950 }).ok).toBe(true);
    // Überschuss wie bisher nur bis 50 ct.
    expect(reconcile({ ...inline, totalCents: 1750 }).ok).toBe(true);
    expect(reconcile({ ...inline, totalCents: 1749 }).ok).toBe(false);
    // Grenze auch hier (Bezug: Summe der übrigen Items, auch wenn die gedruckte
    // „Zwischensumme" schon der Endbetrag ist).
    expect(reconcile({ items: [...items(1000), rz('Coupon 10€', -1000)], totalCents: 0 }).ok).toBe(false);
    expect(reconcile({ items: [...items(1000), rz('Coupon', -240)], subtotalCents: 760, totalCents: 760 }).ok).toBe(true);
    expect(reconcile({ items: [...items(1000), rz('Coupon', -250)], subtotalCents: 750, totalCents: 750 }).ok).toBe(false);
  });

  test('ohne Endbetrag nie ok', () => {
    expect(reconcile({ ...rossmann, totalCents: null }).ok).toBe(false);
  });

  test('Kategorie in anderer Schreibweise zählt gleich; positive Rabattzeile ist nie ein Artikel', () => {
    const p = { ...rossmann, items: [...items(2500, 2000, 1500, 1000, 1000), rz('10% COUPONAKTION', -500, { category: 'Warenkorb-Rabatt' }), rz('Coupon 20% ISANA', -300, { category: ' warenkorb rabatt ' })] };
    expect(reconcile(p).ok).toBe(true);
    const positiv = { items: [...items(1000, 1000), rz('Coupon', 200)], totalCents: 1800, subtotalCents: 2000 };
    expect(countEligibleItems(positiv)).toBe(2);
    // Positiver Betrag widerspricht Regel 16 → kein Rabatt, Überschuss → nicht ok.
    expect(reconcile(positiv).ok).toBe(false);
  });
});

describe('reconcile — v1.4-Lesungen mit negativen Zeilen bleiben wie bisher', () => {
  // Echte Formen aus gespeicherten v1.4-Lesungen (21.09.–04.10.2026): Rabatte
  // mit Kategorie 'Rabatt', 'Discount' oder ohne, Storno, Retoure, Leergut.
  test.each([
    ['Rossmann-Coupons (Kategorie Rabatt), über 20 €', [...items(5000, 5818), { name: '10% COUPONAKTION', priceCents: -969, category: 'Rabatt' }, { name: 'Coupon 20% Bio', priceCents: -1126, category: 'Rabatt' }], 10818, 8723],
    ['REWE Rabatt über 50 % (ohne Kategorie)', [...items(7525), { name: 'Summe Rabatt Gesamtpositionen', priceCents: -4000 }, { name: 'Eingelöstes Bonus-Guthaben', priceCents: -405 }], 7525, 3120],
    ['dm Coupon 10 € (Discount)', [...items(1625), { name: 'Coupon 10€', priceCents: -1000, category: 'Discount' }], 1625, 625],
    ['Storno', [...items(234, 39), { name: 'Artikelstorno Milchreis', priceCents: -39 }], 234, 234],
    ['Leergut', [...items(500), { name: 'Leergut', priceCents: -75, category: 'Pfand' }], null, 425],
  ])('%s → Summe aller Items gegen Endbetrag', (_n, its, sub, total) => {
    const r = reconcile({ items: its, subtotalCents: sub, totalCents: total });
    expect(r.ok).toBe(true);
    expect(r.direction).toBe('match');
    expect(r.basketDiscountCents).toBeUndefined();
  });
});
