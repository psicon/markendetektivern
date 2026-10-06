'use strict';

/**
 * Regeln des Doppel-Schutzes (lib/doppelBon.js, Entscheidung Patrick
 * 04.10.2026). Die Paritäts-Fälle stammen aus der Messung über 14.369 Bons
 * (scratchpad/bon-rueckblick, c_eval.js) — nur Markt, Summe und Artikel,
 * ohne Nutzer- oder Bon-IDs.
 */

const D = require('../lib/doppelBon');
const PAARE = require('./fixtures/doppelBonPaare.json');

const art = (...paare) => paare.map(([name, priceCents]) => ({ name, priceCents }));

describe('artikelSchluessel', () => {
  test('Name normalisiert + Preis, jeder Artikel nur einmal', () => {
    expect(D.artikelSchluessel(art(['Milch 1,5%', 119], ['MILCH 1.5 %', 119], ['Brot', 249]))).toEqual(['milch15#119', 'brot#249']);
  });

  test('Pfand, Leergut, Rabatt, Gutschein und 0-€-Zeilen zählen nicht', () => {
    const k = D.artikelSchluessel(art(
      ['Pfand 0,25', 25], ['LEERGUT EINWEG', -75], ['Leerg. MW', 15], ['Rabatt 10%', -50], ['Gutschein', -200],
      ['Coupon Netto-App', -100], ['eingelöste Punkte', -300], ['Gratis-Beigabe', 0], ['Butter', 199],
    ));
    expect(k).toEqual(['butter#199']);
  });

  test('zu kurze Namen und kaputte Einträge fallen heraus', () => {
    expect(D.artikelSchluessel([{ name: 'x', priceCents: 100 }, null, {}, { name: 'Ei', priceCents: 30 }, { raw: 'Käse', priceCents: 299 }]))
      .toEqual(['ei#30', 'käse#299']);
    expect(D.artikelSchluessel(null)).toEqual([]);
  });

  test('höchstens 150 Schlüssel zu je höchstens 60 Zeichen', () => {
    const viele = Array.from({ length: 300 }, (_, i) => ({ name: `Artikel ${i} ${'x'.repeat(80)}`, priceCents: 100 + i }));
    const k = D.artikelSchluessel(viele);
    expect(k).toHaveLength(150);
    expect(Math.max(...k.map((x) => x.length))).toBeLessThanOrEqual(60);
  });
});

describe('Bestellnummer', () => {
  test.each([
    ['DM-123456789', 'DM123456789'],
    ['4711 0815', '47110815'],
    ['ab12cd34ef', 'AB12CD34EF'],
  ])('%s → %s', (roh, erwartet) => expect(D.bestellnummerNormal(roh)).toBe(erwartet));

  test.each([
    [null], [''], ['12345'], ['ABCDEFGH1'], ['04.10.2026'], ['2026-10-04'], ['20261004'], ['04102026'], ['X'.repeat(40) + '1234'],
  ])('%s → kein Schlüssel', (roh) => expect(D.bestellnummerNormal(roh)).toBeNull());

  test('Schlüssel braucht Markt und gültige Nummer, je Markt verschieden', () => {
    const a = D.bestellSchluessel('dm', 'DM-123456789');
    expect(a).toMatch(/^bo_[0-9a-f]{24}$/);
    expect(D.bestellSchluessel('rossmann', 'DM-123456789')).not.toBe(a);
    expect(D.bestellSchluessel(null, 'DM-123456789')).toBeNull();
    expect(D.bestellSchluessel('dm', '12')).toBeNull();
  });
});

describe('identitaet', () => {
  test('Kontenschlüssel nur mit Uhrzeit', () => {
    const mit = D.identitaet({ merchantId: 'Kaufland', bonDate: '2026-10-04', totalCents: 3003, bonTime: '8:05:31' });
    expect(mit).toMatchObject({ markt: 'kaufland', tag: '2026-10-04', summe: 3003, uhrzeit: '08:05' });
    expect(mit.kontenId).toMatch(/^tx_[0-9a-f]{16}$/);
    expect(D.identitaet({ merchantId: 'kaufland', bonDate: '2026-10-04', totalCents: 3003, bonTime: null }).kontenId).toBeNull();
    // gleiche Uhrzeit, andere Schreibweise → derselbe Schlüssel
    expect(D.identitaet({ merchantId: 'kaufland', bonDate: '2026-10-04', totalCents: 3003, bonTime: '08:05' }).kontenId).toBe(mit.kontenId);
  });

  test('unbekannter Markt, fehlende Summe → keine Schlüssel', () => {
    expect(D.identitaet({ merchantId: 'unknown', bonDate: '2026-10-04', totalCents: 500, bonTime: '10:00' })).toMatchObject({ markt: null, kontenId: null });
    expect(D.identitaet({ merchantId: 'lidl', bonDate: '2026-10-04', totalCents: 0, bonTime: '10:00' })).toMatchObject({ summe: null, kontenId: null });
  });

  test('identitaetAusBon liest gespeicherte Bons (OCR-Artikel, sonst receipts.items)', () => {
    const bon = {
      merchant: { id: 'lidl' }, bonDate: '2026-10-01', bonTime: '17:02', bonTotalCents: 1234,
      ocr: { parsed: { items: [{ name: 'Milch', priceCents: 119 }], bestellnummer: null } },
    };
    expect(D.identitaetAusBon(bon)).toMatchObject({ markt: 'lidl', tag: '2026-10-01', summe: 1234, uhrzeit: '17:02', artikel: ['milch#119'] });
    expect(D.identitaetAusBon({ merchant: { id: 'lidl' }, bonDate: '2026-10-01', items: [{ raw: 'Brot', priceCents: 249 }] }).artikel).toEqual(['brot#249']);
  });

  test('eintragAus: nur, was die Prüfung braucht', () => {
    const e = D.eintragAus(D.identitaet({ merchantId: 'lidl', bonDate: '2026-10-01', totalCents: 500, bonTime: '10:00', items: art(['Milch', 119]) }));
    expect(e).toEqual({ markt: 'lidl', summe: 500, uhrzeit: '10:00', artikel: ['milch#119'], artikelSumme: 119, positivSumme: 119, bestellHash: null, v: 1 });
  });

  test('artikelSumme: Summe der gelesenen Preise wie im Abgleich, Pfand und Rabatt eingeschlossen', () => {
    expect(D.artikelSummeVon(art(['Milch', 119], ['Pfand', 25], ['Rabatt', -20]))).toBe(124);
    expect(D.artikelSummeVon([])).toBeNull();
    expect(D.artikelSummeVon(null)).toBeNull();
    expect(D.artikelSummeVon(art(['Gutschrift', -50]))).toBeNull();
  });
});

describe('Schalter', () => {
  test.each([[true, true], ['shadow', 'shadow'], [false, false], [undefined, false], ['true', false], [1, false]])('%p → %p', (v, e) => {
    expect(D.schalterModus(v)).toBe(e);
  });

  test('Code-Default: alles aus außer summe, seite und bild (an) und seiteAbweichend (Beobachtung), Schwelle 0,6, mindestens 5 Artikel', () => {
    // seite/bild an (Nachprüfung 05.10.2026): sie sichern nur Zahlwege ab, die
    // ohne Schalter (Artikelsumme) bzw. erst mit scharfem Feinvergleich entstehen.
    // seiteAbweichend (06.10.2026) wird ab dem Deploy nur beobachtet. summe an
    // (dritte Prüfrunde 06.10.2026): der Doppelfall vom 04.10. ab dem Deploy.
    expect(D.doppelModi({})).toEqual({ summe: true, konten: false, artikel: false, bestellung: false, datum: false, kontenArtikel: false, seite: true, kontenDatum: false, bild: true, seiteAbweichend: 'shadow', schwelle: 0.6, minArtikel: 5 });
    expect(D.modiVermerk(D.doppelModi({ doppelSumme: false, doppelDatum: 'shadow', doppelKontenArtikel: true, doppelOnlineSeite: 'shadow', doppelKontenDatum: true, doppelBildAehnlich: false, doppelSeiteAbweichend: true })))
      .toEqual({ summe: false, konten: false, artikel: false, bestellung: false, datum: 'shadow', kontenArtikel: true, seite: 'shadow', kontenDatum: true, bild: false, seiteAbweichend: true });
    expect(D.doppelModi({ doppelSumme: 'shadow' }).summe).toBe('shadow');
    expect(D.doppelModi({ doppelSeiteAbweichend: false }).seiteAbweichend).toBe(false);
    expect(D.doppelModi({ doppelSeiteAbweichend: 'ja' }).seiteAbweichend).toBe(false);
    // Nur ein FEHLENDER Wert gilt als an; alles Unbekannte bleibt aus.
    expect(D.doppelModi({ doppelOnlineSeite: null, doppelBildAehnlich: undefined })).toMatchObject({ seite: true, bild: true });
    expect(D.doppelModi({ doppelOnlineSeite: 'true', doppelBildAehnlich: 0 })).toMatchObject({ seite: false, bild: false });
  });

  test('unsinnige Schwellen fallen auf die gemessenen Werte zurück', () => {
    expect(D.doppelModi({ doppelArtikelSchwelle: 0.06, doppelArtikelMin: 1 })).toMatchObject({ schwelle: 0.6, minArtikel: 5 });
    expect(D.doppelModi({ doppelArtikelSchwelle: 0.7, doppelArtikelMin: 6 })).toMatchObject({ schwelle: 0.7, minArtikel: 6 });
  });
});

const AN = { summe: true, konten: true, artikel: true, bestellung: true, schwelle: 0.6, minArtikel: 5 };
const bonId = (markt, summe, items, extra = {}) => D.identitaet({ merchantId: markt, bonDate: '2026-10-04', totalCents: summe, items, ...extra });

describe('vergleiche / doppelUrteil', () => {
  const fuenf = art(['Milch', 119], ['Brot', 249], ['Butter', 199], ['Käse', 299], ['Eier', 279]);

  test('gleiche Summe am selben Markt → Regel summe', () => {
    const u = D.doppelUrteil({ bonId: 'neu', uid: 'u', neu: bonId('lidl', 1234, []), andere: [{ id: 'alt', eintrag: D.eintragAus(bonId('lidl', 1234, [])) }], modi: AN });
    expect(u.wirksam).toMatchObject({ regel: 'summe', gegen: 'alt', sameUser: true, modus: 'wirksam' });
    expect(D.grundFuer(u.wirksam)).toBe('duplicate_content_self');
  });

  test('anderer Markt, gleiche Summe ohne gleiche Uhrzeit, andere Artikel → kein Treffer', () => {
    const anders = art(['Wurst', 319], ['Senf', 89], ['Gurken', 149], ['Chips', 179], ['Cola', 99]);
    const u = D.doppelUrteil({ bonId: 'neu', uid: 'u', neu: bonId('lidl', 1234, fuenf), andere: [{ id: 'alt', eintrag: D.eintragAus(bonId('aldi', 1234, anders)) }], modi: AN });
    expect(u.treffer).toEqual([]);
  });

  test('Prüfrunde 3: Händlername geändert — gleiche Artikel in einem anderen Markt → artikel (andererMarkt)', () => {
    const u = D.doppelUrteil({ bonId: 'neu', uid: 'u', neu: bonId('lidl', 1234, fuenf), andere: [{ id: 'alt', eintrag: D.eintragAus(bonId('aldi', 1234, fuenf)) }], modi: AN });
    expect(u.treffer.map((t) => t.regel)).toEqual(['artikel']);
    expect(u.wirksam).toMatchObject({ regel: 'artikel', gegen: 'alt', sameUser: true, andererMarkt: true, anteil: 1 });
  });

  test('Prüfrunde 3: anderer Markt, gleiche Summe UND gleiche Uhrzeit → summe (andererMarkt); ohne Uhrzeit nicht', () => {
    const mit = (markt, bonTime) => bonId(markt, 1234, [], { bonTime });
    const ja = D.doppelUrteil({ bonId: 'neu', uid: 'u', neu: mit('lidl', '10:15'), andere: [{ id: 'alt', eintrag: D.eintragAus(mit('aldi', '10:15')) }], modi: AN });
    expect(ja.wirksam).toMatchObject({ regel: 'summe', andererMarkt: true });
    const nein = D.doppelUrteil({ bonId: 'neu', uid: 'u', neu: mit('lidl', null), andere: [{ id: 'alt', eintrag: D.eintragAus(mit('aldi', '10:15')) }], modi: AN });
    expect(nein.treffer).toEqual([]);
  });

  test('Artikel: Grenze 0,6 und mindestens 5 verschiedene Artikel je Bon', () => {
    const drei = art(['Milch', 119], ['Brot', 249], ['Butter', 199]);
    expect(D.vergleiche(bonId('lidl', 100, drei), bonId('lidl', 200, drei), { minArtikel: 5 }).anteil).toBeNull();
    const zehn = [...fuenf, ...art(['Apfel', 99], ['Birne', 129], ['Saft', 149], ['Tee', 189], ['Reis', 159])];
    const sechsVonZehn = [...zehn.slice(0, 6), ...art(['A1', 1], ['A2', 2], ['A3', 3], ['A4', 4])];
    const fuenfVonZehn = [...zehn.slice(0, 5), ...art(['B1', 1], ['B2', 2], ['B3', 3], ['B4', 4], ['B5', 5])];
    expect(D.vergleiche(bonId('lidl', 100, zehn), bonId('lidl', 200, sechsVonZehn), {}).anteil).toBeCloseTo(0.6);
    const ja = D.doppelUrteil({ bonId: 'n', uid: 'u', neu: bonId('lidl', 100, zehn), andere: [{ id: 'a', eintrag: D.eintragAus(bonId('lidl', 200, sechsVonZehn)) }], modi: AN });
    expect(ja.wirksam).toMatchObject({ regel: 'artikel', anteil: 0.6 });
    const nein = D.doppelUrteil({ bonId: 'n', uid: 'u', neu: bonId('lidl', 100, zehn), andere: [{ id: 'a', eintrag: D.eintragAus(bonId('lidl', 200, fuenfVonZehn)) }], modi: AN });
    expect(nein.treffer).toEqual([]);
  });

  test('Schalter: aus → kein Treffer; shadow → Beobachtung, nicht wirksam', () => {
    const neu = bonId('lidl', 1234, fuenf);
    const andere = [{ id: 'alt', eintrag: D.eintragAus(bonId('lidl', 1234, fuenf)) }];
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu, andere, modi: { ...AN, summe: false, artikel: false } }).treffer).toEqual([]);
    const u = D.doppelUrteil({ bonId: 'n', uid: 'u', neu, andere, modi: { ...AN, summe: 'shadow', artikel: 'shadow' } });
    expect(u.wirksam).toBeNull();
    expect(u.treffer.map((t) => [t.regel, t.modus])).toEqual([['summe', 'beobachtung'], ['artikel', 'beobachtung']]);
  });

  test('Schlüssel über Konten: nur ein noch bezahlter, fremder Besitzer zählt', () => {
    const neu = bonId('kaufland', 3003, [], { bonTime: '11:05' });
    const s = (besitzer, lebendig) => [{ id: neu.kontenId, regel: 'konten', besitzer, lebendig }];
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu, schluessel: s({ receiptId: 'x', uid: 'v' }, true), modi: AN }).wirksam)
      .toMatchObject({ regel: 'konten', gegen: 'x', sameUser: false });
    expect(D.grundFuer({ sameUser: false })).toBe('duplicate_content_cross_user');
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu, schluessel: s({ receiptId: 'x', uid: 'u' }, true), modi: AN }).wirksam)
      .toMatchObject({ sameUser: true });
    // storniert / nicht mehr im Tageszähler → frei
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu, schluessel: s({ receiptId: 'x', uid: 'v' }, false), modi: AN }).treffer).toEqual([]);
    // eigener Schlüssel → kein Treffer
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu, schluessel: s({ receiptId: 'n', uid: 'u' }, true), modi: AN }).treffer).toEqual([]);
  });
});

describe('Regel datum (Kopie mit geändertem Datum, gleiche Person)', () => {
  const zehn = art(['Milch', 119], ['Brot', 249], ['Butter', 199], ['Käse', 299], ['Eier', 279], ['Apfel', 99], ['Birne', 129], ['Saft', 149], ['Tee', 189], ['Reis', 159]);
  const am = (tag, extra = {}) => D.identitaet({ merchantId: 'kaufland', bonDate: tag, totalCents: 1870, bonTime: '11:05', items: zehn, ...extra });
  const AN_D = { ...AN, datum: true };

  test('anderer Tag, gleiche Uhrzeit und Summe → datum', () => {
    const u = D.doppelUrteil({ bonId: 'n', uid: 'u', neu: am('2026-10-02'), andere: [{ id: 'alt', eintrag: D.eintragAus(am('2026-10-03')), tag: '2026-10-03' }], modi: AN_D });
    expect(u.wirksam).toMatchObject({ regel: 'datum', gegen: 'alt', sameUser: true, tag: '2026-10-03', anteil: 1 });
    expect(D.grundFuer(u.wirksam)).toBe('duplicate_content_self');
  });

  test('anderer Tag, gleiche Uhrzeit, Summe anders gelesen, Artikel ≥ Schwelle → datum', () => {
    const u = D.doppelUrteil({ bonId: 'n', uid: 'u', neu: am('2026-10-02', { totalCents: 1871 }), andere: [{ id: 'alt', eintrag: D.eintragAus(am('2026-10-03')), tag: '2026-10-03' }], modi: AN_D });
    expect(u.wirksam).toMatchObject({ regel: 'datum' });
  });

  test('Gewohnheitskauf: anderer Tag, meist gleiche Artikel, ANDERE Uhrzeit, Summe und Artikelsumme → kein Treffer', () => {
    const korb = [...zehn.slice(0, 7), ...art(['Joghurt', 79], ['Nudeln', 129], ['Kaffee', 499])];
    const u = D.doppelUrteil({ bonId: 'n', uid: 'u', neu: am('2026-10-02', { bonTime: '18:40', totalCents: 2155, items: korb }), andere: [{ id: 'alt', eintrag: D.eintragAus(am('2026-10-03')), tag: '2026-10-03' }], modi: AN_D });
    expect(u.treffer).toEqual([]);
  });

  test('Prüfrunde 3: nur die gedruckte Endsumme geändert, Uhrzeit verdeckt → datum über die Artikelsumme', () => {
    const alt = [{ id: 'alt', eintrag: D.eintragAus(am('2026-10-03')), tag: '2026-10-03' }];
    const u = D.doppelUrteil({ bonId: 'n', uid: 'u', neu: am('2026-10-02', { bonTime: null, totalCents: 1880 }), andere: alt, modi: AN_D });
    expect(u.wirksam).toMatchObject({ regel: 'datum', ohneUhrzeit: true, nurArtikelSumme: true, anteil: 1 });
    // Eintrag aus der Zeit vor Prüfrunde 3 (ohne artikelSumme, ohne
    // positivSumme) → kein Treffer über sie.
    const { artikelSumme, positivSumme, ...ohne } = alt[0].eintrag;
    expect(artikelSumme).toBe(1870);
    expect(positivSumme).toBe(1870);
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu: am('2026-10-02', { bonTime: null, totalCents: 1880 }), andere: [{ ...alt[0], eintrag: ohne }], modi: AN_D }).treffer).toEqual([]);
  });

  test('Prüfrunde 2: Datum UND Uhrzeit geändert oder verdeckt, Summe und Artikel gleich → datum (ohneUhrzeit)', () => {
    const alt = [{ id: 'alt', eintrag: D.eintragAus(am('2026-10-03')), tag: '2026-10-03' }];
    for (const bonTime of ['11:06', null]) {
      const u = D.doppelUrteil({ bonId: 'n', uid: 'u', neu: am('2026-10-02', { bonTime }), andere: alt, modi: AN_D });
      expect(u.wirksam).toMatchObject({ regel: 'datum', gegen: 'alt', ohneUhrzeit: true, anteil: 1 });
    }
  });

  test('ohne gleiche Uhrzeit reicht Summe ODER Artikel allein nicht', () => {
    const alt = [{ id: 'alt', eintrag: D.eintragAus(am('2026-10-03')), tag: '2026-10-03' }];
    // gleiche Summe, aber zu wenige Artikel für einen Anteil
    const wenig = am('2026-10-02', { bonTime: null, items: zehn.slice(0, 3) });
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu: wenig, andere: alt, modi: AN_D }).treffer).toEqual([]);
    // Artikel ≥ Schwelle, aber andere Endsumme UND andere Artikelsumme
    const acht = [...zehn.slice(0, 8), ...art(['Joghurt', 79], ['Nudeln', 129])];
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu: am('2026-10-02', { bonTime: null, totalCents: 1871, items: acht }), andere: alt, modi: AN_D }).treffer).toEqual([]);
  });

  test('Schalter aus → kein Treffer; andere Tage nie über summe/artikel', () => {
    const alt = [{ id: 'alt', eintrag: D.eintragAus(am('2026-10-03')), tag: '2026-10-03' }];
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu: am('2026-10-02'), andere: alt, modi: AN }).treffer).toEqual([]);
  });

  test('Prüfrunde 3: anderer Markt (Händlername geändert) → datum mit andererMarkt; anderer Einkauf dort → nichts', () => {
    const alt = [{ id: 'alt', eintrag: D.eintragAus(am('2026-10-03')), tag: '2026-10-03' }];
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu: am('2026-10-02', { merchantId: 'lidl' }), andere: alt, modi: AN_D }).wirksam)
      .toMatchObject({ regel: 'datum', andererMarkt: true });
    const anders = art(['Wurst', 319], ['Senf', 89], ['Gurken', 149], ['Chips', 179], ['Cola', 99]);
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu: am('2026-10-02', { merchantId: 'lidl', bonTime: '17:00', totalCents: 835, items: anders }), andere: alt, modi: AN_D }).treffer).toEqual([]);
  });

  test('Eintrag eines anderen Tages zählt nie über summe/artikel — auch wenn der neue Bon kein Datum hat', () => {
    const ohneDatum = am(null);
    const u = D.doppelUrteil({ bonId: 'n', uid: 'u', neu: ohneDatum, andere: [{ id: 'alt', eintrag: D.eintragAus(am('2026-10-03')), tag: '2026-10-03' }], modi: AN });
    expect(u.treffer).toEqual([]);
  });

  test('tageImFenster: ±8 Tage ohne den Tag selbst, über Monatsgrenzen', () => {
    const t = D.tageImFenster('2026-10-02');
    expect(t).toHaveLength(16);
    expect(t).toEqual(expect.arrayContaining(['2026-10-01', '2026-10-03', '2026-09-24', '2026-10-10']));
    expect(t).not.toContain('2026-10-02');
    expect(D.tageImFenster('kaputt')).toEqual([]);
  });
});

describe('Regel kontenArtikel (anderes Konto, Uhrzeit verdeckt)', () => {
  const zehn = art(['Milch', 119], ['Brot', 249], ['Butter', 199], ['Käse', 299], ['Eier', 279], ['Apfel', 99], ['Birne', 129], ['Saft', 149], ['Tee', 189], ['Reis', 159]);
  const neu = D.identitaet({ merchantId: 'kaufland', bonDate: '2026-10-03', totalCents: 1870, bonTime: null, items: zehn });
  const AN_K = { ...AN, kontenArtikel: true };

  test('Index-Eintrag: keine Artikelnamen, nur kurze Hashes; ID aus Markt und Tag', () => {
    const e = D.tagesEintragAus('v', neu);
    expect(e.u).toBe('v');
    expect(e.a).toHaveLength(10);
    for (const h of e.a) expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(neu.tagesIndex).toBe('kaufland_2026-10-03');
    expect(D.tagesIndexId('aldi-sued', '2026-10-03')).toBe('aldi-sued_2026-10-03');
    expect(D.tagesIndexId(null, '2026-10-03')).toBeNull();
  });

  test('fremdes Konto mit ≥ 0,6 gleichen Artikeln → Kandidat; eigenes Konto und eigener Bon nie', () => {
    const eintraege = {
      fremd: D.tagesEintragAus('v', neu),
      eigen: D.tagesEintragAus('u', neu),
      n: D.tagesEintragAus('v', neu),
      wenig: D.tagesEintragAus('w', D.identitaet({ merchantId: 'kaufland', bonDate: '2026-10-03', items: zehn.slice(0, 4) })),
      anders: D.tagesEintragAus('x', D.identitaet({ merchantId: 'kaufland', bonDate: '2026-10-03', items: [...zehn.slice(0, 5), ...art(['Nudeln', 301], ['Wein', 302], ['Chips', 303], ['Kaffee', 304], ['Zucker', 305])] })),
    };
    const k = D.kontenArtikelKandidaten({ bonId: 'n', uid: 'u', neu, eintraege, modi: AN_K });
    expect(k).toEqual([{ id: 'fremd', uid: 'v', anteil: 1 }]);
    const u = D.doppelUrteil({ bonId: 'n', uid: 'u', neu, kontenArtikel: k.map((x) => ({ ...x, lebendig: true })), modi: AN_K });
    expect(u.wirksam).toMatchObject({ regel: 'kontenArtikel', gegen: 'fremd', sameUser: false, anteil: 1 });
    expect(D.grundFuer(u.wirksam)).toBe('duplicate_content_cross_user');
  });

  test('storniert (nicht mehr lebendig) oder Schalter aus → kein Treffer', () => {
    const k = [{ id: 'fremd', uid: 'v', anteil: 1, lebendig: false }];
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu, kontenArtikel: k, modi: AN_K }).treffer).toEqual([]);
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu, kontenArtikel: [{ ...k[0], lebendig: true }], modi: AN }).treffer).toEqual([]);
  });
});

describe('Regel seite (Seiten derselben Online-Rechnung, Prüfrunde 2)', () => {
  const s1 = art(['Cremedusche', 55], ['Koerperlotion', 155], ['Babypuder', 255], ['Feuchttuecher', 355], ['Shampoo', 455], ['Deo Roll-on', 555], ['Windeln Gr4', 655]);
  const s2 = art(['Bad Shampoo', 125], ['Schubladensicherung', 155], ['Schrankschloss', 185], ['Steckdosenschutz', 215], ['Eckenschutz', 245], ['Duschgel', 275]);
  const seite = (items, extra = {}) => D.identitaet({ merchantId: 'dm', bonDate: '2026-10-03', totalCents: items.reduce((x, i) => x + i.priceCents, 0), bonTime: null, items, online: true, summeAusArtikeln: true, ...extra });
  const AN_S = { ...AN, seite: true };

  test('zwei Seiten ohne gedruckten Endbetrag → seite, auch ohne Bestellnummer', () => {
    const u = D.doppelUrteil({ bonId: 'p2', uid: 'u', neu: seite(s2), andere: [{ id: 'p1', eintrag: D.eintragAus(seite(s1)) }], modi: AN_S });
    expect(u.wirksam).toMatchObject({ regel: 'seite', gegen: 'p1', sameUser: true });
    expect(D.grundFuer(u.wirksam)).toBe('duplicate_content_self');
  });

  test('gleiche Bestellnummer auf beiden Seiten → seite; zwei VERSCHIEDENE Nummern → kein Treffer', () => {
    const gleich = D.doppelUrteil({ bonId: 'p2', uid: 'u', neu: seite(s2, { bestellnummer: 'B-2026-778812' }), andere: [{ id: 'p1', eintrag: D.eintragAus(seite(s1, { bestellnummer: 'B-2026-778812' })) }], modi: AN_S });
    expect(gleich.wirksam).toMatchObject({ regel: 'seite' });
    const verschieden = D.doppelUrteil({ bonId: 'p2', uid: 'u', neu: seite(s2, { bestellnummer: 'B-2026-778812' }), andere: [{ id: 'p1', eintrag: D.eintragAus(seite(s1, { bestellnummer: 'B-2026-999001' })) }], modi: AN_S });
    expect(verschieden.treffer).toEqual([]);
  });

  test('zwei vollständige Online-Rechnungen, Ladenbon + Online-Bestellung, Schalter aus → kein Treffer', () => {
    const voll = (items) => seite(items, { summeAusArtikeln: false });
    expect(D.doppelUrteil({ bonId: 'p2', uid: 'u', neu: voll(s2), andere: [{ id: 'p1', eintrag: D.eintragAus(voll(s1)) }], modi: AN_S }).treffer).toEqual([]);
    expect(D.doppelUrteil({ bonId: 'p2', uid: 'u', neu: seite(s2), andere: [{ id: 'p1', eintrag: D.eintragAus(seite(s1, { online: false, summeAusArtikeln: false })) }], modi: AN_S }).treffer).toEqual([]);
    expect(D.doppelUrteil({ bonId: 'p2', uid: 'u', neu: seite(s2), andere: [{ id: 'p1', eintrag: D.eintragAus(seite(s1)) }], modi: AN }).treffer).toEqual([]);
  });

  test('Eintrag führt die Merkmale nur, wenn sie zutreffen; identitaetAusBon liest sie', () => {
    expect(D.eintragAus(seite(s1))).toMatchObject({ online: true, ohneSumme: true });
    const bon = { merchant: { id: 'dm' }, bonDate: '2026-10-03', bonTotalCents: 2485, ocr: { parsed: { items: s1, belegart: 'online_bestellung', onlineMerkmal: 'modell', summeAusArtikeln: true } } };
    expect(D.identitaetAusBon(bon)).toMatchObject({ online: true, ohneSumme: true });
    expect(D.identitaetAusBon({ merchant: { id: 'dm' }, bonDate: '2026-10-03', ocr: { parsed: { items: s1 } } })).toMatchObject({ online: false, ohneSumme: false });
  });
});

describe('Regel kontenDatum (Summen-Index, Prüfrunde 2)', () => {
  const zehn = art(['Milch', 119], ['Brot', 249], ['Butter', 199], ['Käse', 299], ['Eier', 279], ['Apfel', 99], ['Birne', 129], ['Saft', 149], ['Tee', 189], ['Reis', 159]);
  const am = (tag, extra = {}) => D.identitaet({ merchantId: 'kaufland', bonDate: tag, totalCents: 1870, bonTime: '11:05', items: zehn, ...extra });
  const AN_KD = { ...AN, kontenDatum: true };

  test('ID aus Markt und Summe; Eintrag ohne Artikelnamen', () => {
    expect(am('2026-10-03').summenIndex).toBe('kaufland_1870');
    expect(D.identitaet({ merchantId: 'kaufland', bonDate: '2026-10-03', totalCents: null }).summenIndex).toBeNull();
    expect(D.identitaet({ merchantId: 'kaufland', bonDate: null, totalCents: 1870 }).summenIndex).toBeNull();
    const e = D.summenEintragAus('v', am('2026-10-03'));
    expect(e).toMatchObject({ u: 'v', t: '2026-10-03', z: '11:05' });
    for (const h of e.a) expect(h).toMatch(/^[0-9a-f]{8}$/);
  });

  test('zweites Konto, Datum −1, gleiche Uhrzeit oder verdeckt → Kandidat und Treffer (cross_user)', () => {
    const eintraege = { orig: D.summenEintragAus('v', am('2026-10-03')) };
    for (const bonTime of ['11:05', null]) {
      const neu = am('2026-10-02', { bonTime });
      const k = D.kontenDatumKandidaten({ bonId: 'n', neu, eintraege, modi: AN_KD });
      expect(k).toEqual([expect.objectContaining({ id: 'orig', uid: 'v', tag: '2026-10-03', gleicheZeit: bonTime === '11:05' })]);
      const u = D.doppelUrteil({ bonId: 'n', uid: 'u', neu, kontenDatum: k.map((x) => ({ ...x, lebendig: true })), modi: AN_KD });
      expect(u.wirksam).toMatchObject({ regel: 'kontenDatum', gegen: 'orig', sameUser: false });
      expect(D.grundFuer(u.wirksam)).toBe('duplicate_content_cross_user');
    }
  });

  test('gleicher Tag, mehr als 8 Tage, andere Uhrzeit ohne Artikel, storniert, Schalter aus → nichts', () => {
    const neu = am('2026-10-02', { bonTime: '17:00', items: zehn.slice(0, 3) });
    const eintraege = {
      gleicherTag: D.summenEintragAus('v', am('2026-10-02')),
      weit: D.summenEintragAus('v', am('2026-09-20')),
      andereZeit: D.summenEintragAus('v', am('2026-10-03')),
    };
    expect(D.kontenDatumKandidaten({ bonId: 'n', neu, eintraege, modi: AN_KD })).toEqual([]);
    const k = [{ id: 'x', uid: 'v', tag: '2026-10-03', anteil: 1, gleicheZeit: true }];
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu, kontenDatum: [{ ...k[0], lebendig: false }], modi: AN_KD }).treffer).toEqual([]);
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu, kontenDatum: [{ ...k[0], lebendig: true }], modi: AN }).treffer).toEqual([]);
  });

  test('veraltete Einträge (Tag älter als 95 Tage) werden zum Aufräumen gemeldet', () => {
    expect(D.SUMMEN_AUFBEWAHRUNG_TAGE).toBe(95);
    const eintraege = { alt: { u: 'v', t: '2026-06-30' }, jung: { u: 'v', t: '2026-07-01' }, kaputt: null };
    expect(D.veralteteSummenEintraege(eintraege, '2026-10-04').sort()).toEqual(['alt', 'kaputt']);
  });

  test('Prüfrunde 3, echter Fall 02.10.: gleiche Person, Datum 20 Tage daneben (02 ↔ 22), Artikel verlesen → datum', () => {
    const verlesen = art(['HSchwand', 410], ['Kaffeeweisser 2', 447], ['Noisette', 484], ['Alpenmilch', 521], ['Biscoff', 558], ['Nuss 95', 595]);
    const original = D.identitaet({ merchantId: 'netto', bonDate: '2026-10-02', totalCents: 9328, bonTime: '10:44', items: zehn });
    const zwilling = D.identitaet({ merchantId: 'netto', bonDate: '2026-10-22', totalCents: 9328, bonTime: '10:44', items: verlesen });
    const eintraege = { orig: D.summenEintragAus('u', original) };
    const k = D.kontenDatumKandidaten({ bonId: 'n', uid: 'u', neu: zwilling, eintraege, modi: { ...AN, datum: true }, gleichePerson: true, fremde: false });
    expect(k).toEqual([expect.objectContaining({ id: 'orig', uid: 'u', abstand: 20, gleicheZeit: true })]);
    const u = D.doppelUrteil({ bonId: 'n', uid: 'u', neu: zwilling, kontenDatum: k.map((x) => ({ ...x, lebendig: true })), modi: { ...AN, datum: true } });
    expect(u.wirksam).toMatchObject({ regel: 'datum', gegen: 'orig', sameUser: true, abstand: 20 });
    expect(D.grundFuer(u.wirksam)).toBe('duplicate_content_self');
    // Regel datum aus → der Eintrag derselben Person zählt nicht (auch nicht als kontenDatum).
    expect(D.doppelUrteil({ bonId: 'n', uid: 'u', neu: zwilling, kontenDatum: k.map((x) => ({ ...x, lebendig: true })), modi: AN_KD }).treffer).toEqual([]);
  });

  test('Prüfrunde 3: anderes Konto jenseits von 8 Tagen nur über die Artikel — gleiche Uhrzeit und Summe allein sind Zufall', () => {
    const anders = art(['Wurst', 319], ['Senf', 89], ['Gurken', 149], ['Chips', 179], ['Cola', 99], ['Brezel', 59]);
    const eintraege = {
      zufall: D.summenEintragAus('v', am('2026-09-20', { items: anders })),
      kopie: D.summenEintragAus('w', am('2026-09-15')),
      zuAlt: D.summenEintragAus('w', am('2026-06-01')),
    };
    const k = D.kontenDatumKandidaten({ bonId: 'n', uid: 'u', neu: am('2026-10-02'), eintraege, modi: AN_KD });
    expect(k.map((x) => [x.id, x.abstand])).toEqual([['kopie', 17]]);
    // Innerhalb von 8 Tagen reicht die gleiche Uhrzeit weiter.
    const nah = { zufall: D.summenEintragAus('v', am('2026-09-28', { items: anders })) };
    expect(D.kontenDatumKandidaten({ bonId: 'n', uid: 'u', neu: am('2026-10-02'), eintraege: nah, modi: AN_KD }).map((x) => x.id)).toEqual(['zufall']);
    // Dieselbe Person darf jenseits von 8 Tagen auch über die Uhrzeit treffen.
    const eigen = { eigen: D.summenEintragAus('u', am('2026-09-20', { items: anders })) };
    expect(D.kontenDatumKandidaten({ bonId: 'n', uid: 'u', neu: am('2026-10-02'), eintraege: eigen, modi: AN_KD }).map((x) => x.id)).toEqual(['eigen']);
    expect(D.kontenDatumKandidaten({ bonId: 'n', uid: 'u', neu: am('2026-10-02'), eintraege: eigen, modi: AN_KD, gleichePerson: false })).toEqual([]);
  });
});

describe('Parität mit der Messung (anonymisierte echte Bon-Paare)', () => {
  const id = (b) => D.identitaet({ merchantId: b.merchantId, bonDate: '2026-10-04', totalCents: b.totalCents, items: b.items });

  test.each(PAARE.map((p) => [p.name, p]))('%s', (_name, p) => {
    const u = D.doppelUrteil({ bonId: 'b', uid: 'u', neu: id(p.b), andere: [{ id: 'a', eintrag: D.eintragAus(id(p.a)) }], modi: AN });
    expect(Boolean(u.wirksam)).toBe(p.doppel);
  });

  test('Kennwerte: echter Zweitkauf 0,43; dm mit anderer Summe 0,897; Teilfoto 1,0; Saftpaar < 5 Artikel', () => {
    const v = (name) => {
      const p = PAARE.find((x) => x.name === name);
      return D.vergleiche(id(p.a), id(p.b), { minArtikel: 5 });
    };
    expect(v('echter_zweitkauf_rewe_0_43').anteil).toBeCloseTo(0.4286, 3);
    expect(v('andere_summe_dm_0_897')).toMatchObject({ summe: false });
    expect(v('andere_summe_dm_0_897').anteil).toBeCloseTo(0.8966, 3);
    expect(v('teilfoto_lidl').anteil).toBe(1);
    expect(v('gleichzeitig_kaufland').summe).toBe(true);
    // Die einfache Fassung (alle Zeilen, ohne Bereinigung) traf dieses Paar mit
    // 92 % — mit Geld. Bereinigt bleiben zu wenige verschiedene Artikel.
    expect(v('saft_edeka_einfache_fassung_92').anteil).toBeNull();
  });
});
