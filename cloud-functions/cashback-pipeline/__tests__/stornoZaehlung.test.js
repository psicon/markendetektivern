'use strict';

/**
 * Anrechenbare Artikel mit Storno-/Rückgabezeilen (08.10.2026, lib/ocr.js
 * countEligibleItems). Prompt v1.5 Regel 16 lässt Stornozeilen als eigene
 * negative Zeile stehen; ohne Aufrechnung zählte der stornierte Artikel mit —
 * an der Schwelle von 6 Artikeln wird daraus eine Zahlung. Die Fälle sind den
 * echten Lesungen nachgebaut (Messung 08.10. und Live-Bons 08.09.–08.10.).
 *
 * Die Aufrechnung hängt am Schalter cashback_config/v1.stornoAufrechnen (nur
 * true wirkt, Prüfrunde 08.10.2026). Ohne Schalter zählt alles exakt wie vor
 * dem 08.10.2026 — der zweite Block unten belegt das an denselben Fällen.
 */

const { countEligibleItems: zaehle, reconcile, stornoModus, stornoWertUngueltig } = require('../lib/ocr');

// Aufrechnung eingeschaltet (Schalter stornoAufrechnen === true).
const countEligibleItems = (p) => zaehle(p, { stornoAufrechnen: true });

const art = (name, cents, extra = {}) => ({ name, priceCents: cents, ...extra });
const bon = (...items) => ({ items });

describe('countEligibleItems — Storno- und Rückgabezeilen', () => {
  test('dm ZEILENSTORNO (v1.5, bon_mumv7kswsr3h16): gekürzter Name, gleicher Betrag → 10 statt 11', () => {
    const p = bon(
      art('Herbal Essences Sh Blütensanft', 395),
      art('ZEILENSTORNO Herbal Essences Sh Blütensan', -395),
      ...Array.from({ length: 10 }, (_, i) => art(`Artikel ${i}`, 100 + i)),
    );
    expect(countEligibleItems(p)).toBe(10);
  });

  test('ALDI Kiwi (v1.5, bon_muo34502ujmnpb): zwei Teil-Stornos heben EINE Zeile auf → 20 statt 21', () => {
    const p = bon(
      art('Kiwi grün Stück', 196),
      art('Artikelstorno Kiwi grün Stück', -49),
      art('Artikelstorno Kiwi grün Stück', -147),
      art('Kiwi gold Stück', 220),
      ...Array.from({ length: 19 }, (_, i) => art(`Ware ${i}`, 100 + i)),
    );
    expect(countEligibleItems(p)).toBe(20);
  });

  test('ALDI Milchreis (v1.4, bon_munkb14475bvlt): Artikelnummern, Betrag bevorzugt → je Storno genau ein Artikel', () => {
    const mr = (c) => art('734384 Müller Milchreis', c);
    const st = (c) => art('Artikelstorno - 734384 Müller Milchreis', c);
    const p = bon(mr(39), mr(39), mr(195), mr(39), mr(39), mr(39), st(-234), st(-39), st(-39), st(-39), st(-39), mr(234), art('Peanuts 300g', 199));
    // 7 Milchreis-Zeilen − 5 stornierte (234 + 4 × 39) = 2, plus Peanuts.
    expect(countEligibleItems(p)).toBe(3);
  });

  test('Rückgabe ohne Storno-Wort, gleicher Name und Betrag (bon_muiepzbxzy5qyk): 6 → 5, keine Zahlung mehr', () => {
    const p = bon(
      art('Del.Boule Rustique', 79),
      art('Del.Boule Rustique', -79),
      ...Array.from({ length: 5 }, (_, i) => art(`Artikel ${i}`, 150)),
    );
    expect(countEligibleItems(p)).toBe(5);
  });

  test('kleiner Nachlass mit Artikelnamen lässt den Artikel stehen (Ferrero 2,79 / −0,21)', () => {
    const p = bon(art('Ferrero Küsschen', 279), art('Ferrero Küsschen', -21), art('Milch', 99));
    expect(countEligibleItems(p)).toBe(2);
  });

  test('Retoure eines anderen Artikels hebt keinen heutigen Kauf auf (Lidl Sodastream)', () => {
    const p = bon(art('SodastreamCO2-Zylin.', 1955), art('RETOURE Sodaw.', -1400), art('Möhren', 161));
    expect(countEligibleItems(p)).toBe(2);
  });

  test('Storno ohne Namenstreffer: nur genau gleicher Betrag; sonst bleibt die Zahl', () => {
    const mitBetrag = bon(art('Gartenservice', 968600), art('Storno 9685', -968600), art('Erde', 499));
    expect(countEligibleItems(mitBetrag)).toBe(1);
    const ohneBetrag = bon(art('Gartenservice', 968600), art('Storno', -500), art('Erde', 499));
    expect(countEligibleItems(ohneBetrag)).toBe(2);
    // „Storno" nur in raw genügt ebenfalls (Name vom Modell gekürzt).
    const imRaw = bon(art('Äpfel lose', 171), art('Granny', -171, { raw: 'Sofortstorno 462912 Granny -1,71' }), art('Brot', 200));
    expect(countEligibleItems(imRaw)).toBe(1);
  });

  test('negative Zeile ohne Namenstreffer und ohne Storno-Wort ändert nichts (Coupon ohne Kategorie, Rabatt)', () => {
    const p = bon(art('Butter', 199), art('Käse', 299), art('Coupon 20%', -199), art('Rabatt', -299));
    expect(countEligibleItems(p)).toBe(2);
  });

  test('zu kurze Namen gelten nicht als gleich (unter 4 Zeichen)', () => {
    const p = bon(art('Eis', 199), art('Eis', -199), art('Brot', 200));
    // „eis" hat nur 3 Zeichen → kein Namenstreffer, kein Storno-Wort → bleibt.
    expect(countEligibleItems(p)).toBe(2);
  });

  test('Pfandrückgabe und Warenkorb-Rabatt werden nie aufgerechnet', () => {
    const p = bon(
      art('Mineralwasser', 25), art('Pfandrückgabe', -25, { category: 'Pfand' }),
      art('Joghurt', 300), art('10% COUPONAKTION Joghurt', -300, { category: 'Warenkorbrabatt' }),
    );
    expect(countEligibleItems(p)).toBe(2);
  });

  test('Rückgabe größer als der Artikel hebt nur diesen einen auf', () => {
    const p = bon(art('Baumwoll-Tasche', 200), art('Baumwoll-Tasche', -400), art('Seife', 95));
    expect(countEligibleItems(p)).toBe(1);
  });

  test('Abgleich (Summen) bleibt unberührt', () => {
    const p = { ...bon(art('Herbal Essences', 395), art('ZEILENSTORNO Herbal Essences', -395), art('Fruchtringe', 225)), totalCents: 225 };
    expect(reconcile(p)).toMatchObject({ ok: true, sumItemsCents: 225 });
  });

  test('ohne negative Zeilen genau wie bisher', () => {
    const p = bon(art('A', 100), art('B', 0), art('Pfand', 25, { category: 'Pfand' }), art('C', 50), { name: null, priceCents: 10 }, art('D', NaN));
    expect(countEligibleItems(p)).toBe(2);
    expect(countEligibleItems(null)).toBe(0);
    expect(countEligibleItems({})).toBe(0);
  });
});

/** Zählung vor dem 08.10.2026 (HEAD-Stand), Zeichen für Zeichen nachgebaut. */
const altZaehlung = (parsed) => {
  if (!parsed || !Array.isArray(parsed.items)) return 0;
  const { isPfandItem, istRabattKategorie } = require('../lib/ocr');
  return parsed.items.filter((it) => it && typeof it.name === 'string' && Number.isFinite(it.priceCents) && it.priceCents > 0 && !isPfandItem(it) && !istRabattKategorie(it)).length;
};

describe('ohne Schalter: Zählung wie vor dem 08.10.2026 (alle Schalter aus → Geld unverändert)', () => {
  const faelle = {
    delBoule: bon(art('Del.Boule Rustique', 79), art('Del.Boule Rustique', -79), ...Array.from({ length: 5 }, (_, i) => art(`Artikel ${i}`, 150))),
    dm: bon(art('Herbal Essences Sh Blütensanft', 395), art('ZEILENSTORNO Herbal Essences Sh Blütensan', -395), ...Array.from({ length: 10 }, (_, i) => art(`Artikel ${i}`, 100 + i))),
    kiwi: bon(art('Kiwi grün Stück', 196), art('Artikelstorno Kiwi grün Stück', -49), art('Artikelstorno Kiwi grün Stück', -147), ...Array.from({ length: 20 }, (_, i) => art(`Ware ${i}`, 100 + i))),
    pfandRabatt: bon(art('Mineralwasser', 25), art('Pfandrückgabe', -25, { category: 'Pfand' }), art('Pfand', 25, { category: 'Pfand' }), art('Joghurt', 300), art('Coupon', 50, { category: 'Warenkorbrabatt' })),
  };

  test('Del.Boule an der Schwelle: ohne Schalter 6 (wie live bezahlt), mit Schalter 5', () => {
    expect(zaehle(faelle.delBoule)).toBe(6);
    expect(zaehle(faelle.delBoule, {})).toBe(6);
    expect(zaehle(faelle.delBoule, { stornoAufrechnen: true })).toBe(5);
  });

  test.each(Object.keys(faelle))('%s: ohne Schalter identisch zur alten Zählung', (k) => {
    expect(zaehle(faelle[k])).toBe(altZaehlung(faelle[k]));
  });

  test('nur das boolesche true schaltet ein — \'shadow\', \'true\', 1 zählen wie bisher', () => {
    for (const w of ['shadow', 'true', 1, 'an', null, undefined, false]) {
      expect(zaehle(faelle.dm, { stornoAufrechnen: w })).toBe(11);
    }
    expect(zaehle(faelle.dm, { stornoAufrechnen: true })).toBe(10);
  });

  test('stornoModus: true → an, \'shadow\' → shadow, alles andere aus; Ungültiges wird erkannt', () => {
    expect(stornoModus(true)).toBe('an');
    expect(stornoModus('shadow')).toBe('shadow');
    for (const w of [undefined, null, false, 'true', 'SHADOW', 1, 'an', {}]) expect(stornoModus(w)).toBe('aus');
    expect(stornoWertUngueltig(undefined)).toBe(false);
    expect(stornoWertUngueltig(null)).toBe(false);
    expect(stornoWertUngueltig(false)).toBe(false);
    expect(stornoWertUngueltig(true)).toBe(false);
    expect(stornoWertUngueltig('shadow')).toBe(false);
    expect(stornoWertUngueltig('true')).toBe(true);
    expect(stornoWertUngueltig(1)).toBe(true);
  });

  test('Zweitprüfung: refereeFingerprint zählt ohne Angabe wie bisher, mit Schalter aufgerechnet', () => {
    const { refereeFingerprint } = require('../lib/refereePolicy');
    const read = { parsed: { isReceipt: true, totalCents: 750, ...faelle.delBoule } };
    expect(refereeFingerprint(read).eligibleItems).toBe(6);
    expect(refereeFingerprint(read, { stornoAufrechnen: true }).eligibleItems).toBe(5);
  });
});

describe('Robust-Leiter: Fingerabdrücke folgen dem Schalter (Feld-Gate 6w vergleicht deren Betrag)', () => {
  const { extractReceiptRobust } = require('../lib/ocr_robust');
  const lesung = () => ({
    parsed: { isReceipt: true, merchant: 'Netto', bonDate: '2026-10-07', bonTime: '10:15', totalCents: 750, items: [art('Del.Boule Rustique', 79), art('Del.Boule Rustique', -79), ...Array.from({ length: 5 }, (_, i) => art(`Artikel ${i}`, 150))] },
    promptVersion: 'v1.4',
    latencyMs: 1,
  });
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => console.warn.mockRestore());

  test('ohne Schalter: eligibleItems 6, kein Vermerk am robust-Block', async () => {
    const out = await extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract: async () => lesung(), model: 'gemini-3.5-flash' });
    expect(out.robust.confidence).toBe('high');
    expect(out.robust.reads.map((r) => r.eligibleItems)).toEqual([6, 6]);
    expect(out.robust).not.toHaveProperty('stornoAufrechnen');
  });

  test('mit Schalter (true): eligibleItems 5 und Vermerk stornoAufrechnen', async () => {
    const out = await extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract: async () => lesung(), model: 'gemini-3.5-flash', stornoAufrechnen: true });
    expect(out.robust.reads.map((r) => r.eligibleItems)).toEqual([5, 5]);
    expect(out.robust.stornoAufrechnen).toBe(true);
  });

  test('\'shadow\' an die Leiter durchgereicht wirkt nicht (nur true)', async () => {
    const out = await extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract: async () => lesung(), model: 'gemini-3.5-flash', stornoAufrechnen: 'shadow' });
    expect(out.robust.reads.map((r) => r.eligibleItems)).toEqual([6, 6]);
  });
});
