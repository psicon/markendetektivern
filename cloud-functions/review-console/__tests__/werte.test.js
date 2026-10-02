'use strict';
/**
 * Effektive Werte einer Einreichung — die gemeinsame Quelle von Morgenrunde und
 * Prüfkonsole (src/werte.js). Die Fälle stammen aus dem Befund 26.09.2026:
 * 16 nachgelesene Namen standen in der Konsole als „(ohne Name)", 11 nur
 * nachgelesene EANs als „Barcode fehlt".
 */
const { eanOf, nameOf, preisOf, policyOf, herstellerAnzeige, vollstaendigkeitOf, herkunftOf, pruefzifferOk } = require('../src/werte');
const { evaluateDuplicate, completenessCheck } = require('../src/duplicatePolicy');

const GUELTIG = '4061464833821';
const FALSCHE_PRUEFZIFFER = '4061464833828';
const STUNDE = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 25, 8, 0, 0);
const ALLE_FOTOS = { front: 'a', rueckseite: 'b', hersteller: 'c', ean: 'd', naehrwerte: 'e', zutaten: 'f', preis: 'g' };
const REQUIRED = Object.keys(ALLE_FOTOS);

describe('Reihenfolge und Herkunft', () => {
  it('Name: Nutzer vor Namer vor Nachlesung', () => {
    expect(nameOf({ productName: 'Nutzer', productNameOcr: 'Namer', productNameRescueOcr: 'Nachgelesen' })).toBe('Nutzer');
    expect(nameOf({ productNameOcr: 'Namer', productNameRescueOcr: 'Nachgelesen' })).toBe('Namer');
    expect(nameOf({ productNameOcr: null, productNameRescueOcr: 'Nachgelesen' })).toBe('Nachgelesen');
    expect(nameOf({})).toBeNull();
    expect(herkunftOf({ productName: 'N' }).nameQuelle).toBe('nutzer');
    expect(herkunftOf({ productNameOcr: 'N' }).nameQuelle).toBe('ocr');
    expect(herkunftOf({ productNameRescueOcr: 'N' }).nameQuelle).toBe('nachgelesen');
    expect(herkunftOf({}).nameQuelle).toBeNull();
  });

  it('EAN: gescannte vor nachgelesener', () => {
    expect(eanOf({ ean: '4000417025005', eanRescueOcr: GUELTIG })).toBe('4000417025005');
    expect(eanOf({ ean: null, eanRescueOcr: GUELTIG })).toBe(GUELTIG);
    expect(herkunftOf({ ean: null, eanRescueOcr: GUELTIG }).eanNachgelesen).toBe(true);
    expect(herkunftOf({ ean: '4000417025005', eanRescueOcr: GUELTIG }).eanNachgelesen).toBe(false);
  });

  it('Preis: Namer-Preis nur, wenn > 0; sonst der nachgelesene', () => {
    const namer = { priceCents: 199, source: 'preisschild' };
    const gerettet = { priceCents: 229, currency: 'EUR', priceImageKind: 'kassenbon' };
    expect(preisOf({ priceOcr: namer, priceRescueOcr: gerettet })).toBe(namer);
    expect(preisOf({ priceOcr: { priceCents: 0 }, priceRescueOcr: gerettet })).toBe(gerettet);
    expect(preisOf({ priceOcr: null })).toBeNull();
    expect(herkunftOf({ priceRescueOcr: gerettet }).preisNachgelesen).toBe(true);
    expect(herkunftOf({ priceOcr: namer, priceRescueOcr: gerettet }).preisNachgelesen).toBe(false);
    // Ein nachgelesener Preis ohne gültigen Betrag ist keiner.
    expect(herkunftOf({ priceRescueOcr: { priceCents: 0 } }).preisNachgelesen).toBe(false);
  });

  it('Hersteller zur Anzeige: Namer vor Nachlesung, leere Namen zählen nicht', () => {
    expect(herstellerAnzeige({ manufacturerOcr: { name: 'Bauer' }, manufacturerRescueOcr: { name: 'DMK' } })).toBe('Bauer');
    expect(herstellerAnzeige({ manufacturerOcr: { name: '  ' }, manufacturerRescueOcr: { name: 'DMK' } })).toBe('DMK');
    expect(herstellerAnzeige({})).toBeNull();
    expect(herkunftOf({ manufacturerRescueOcr: { name: 'DMK' } }).herstellerNachgelesen).toBe(true);
    expect(herkunftOf({ manufacturerOcr: { name: 'Bauer' }, manufacturerRescueOcr: { name: 'DMK' } }).herstellerNachgelesen).toBe(false);
  });
});

describe('EAN-Rettung mit falscher Prüfziffer wird ignoriert', () => {
  it('Prüfziffer', () => {
    expect(pruefzifferOk(GUELTIG)).toBe(true);
    expect(pruefzifferOk(FALSCHE_PRUEFZIFFER)).toBe(false);
  });

  it('eingeschleuste oder falsch gelesene EAN zählt weder als EAN noch als nachgelesen', () => {
    const x = { images: ALLE_FOTOS, productNameOcr: 'Milsani Skyr', eanRescueOcr: FALSCHE_PRUEFZIFFER };
    expect(eanOf(x)).toBeNull();
    expect(herkunftOf(x).eanNachgelesen).toBe(false);
    expect(policyOf('k', x).ean).toBeNull();
    expect(completenessCheck(vollstaendigkeitOf(x), REQUIRED).problems).toContain('ean_fehlt');
    // Gegenprobe: dieselbe Einreichung mit gültiger Nachlesung ist vollständig.
    expect(completenessCheck(vollstaendigkeitOf({ ...x, eanRescueOcr: GUELTIG }), REQUIRED)).toMatchObject({ ok: true, problems: [] });
  });

  it('auch ein Nicht-String wird ignoriert', () => {
    expect(eanOf({ eanRescueOcr: 4061464833821 })).toBeNull();
  });
});

describe('Vollständigkeit sieht nachgelesene Werte', () => {
  it('nachgelesener Name → kein „kein_produktname"', () => {
    const x = { images: ALLE_FOTOS, ean: GUELTIG, productName: null, productNameOcr: null, productNameRescueOcr: 'K-Classic Gouda' };
    expect(completenessCheck(vollstaendigkeitOf(x), REQUIRED)).toMatchObject({ ok: true, problems: [] });
    expect(completenessCheck(vollstaendigkeitOf({ ...x, productNameRescueOcr: null }), REQUIRED).problems).toEqual(['kein_produktname']);
  });
});

describe('Doppel-Regel: Nachlesungen lösen KEINE Sperre mehr (Wochen-Regel 02.10.2026)', () => {
  // Referenz: eigene, freigegebene Einreichung binnen einer Woche, gleicher Markt.
  const referenz = {
    userId: 'u1', ean: GUELTIG, marketId: 'm1', status: 'approved', createdAt: T0,
    priceOcr: { priceCents: 199, source: 'preisschild' }, manufacturerOcr: { name: 'Kaufland Stiftung & Co. KG', source: 'hersteller' },
  };
  const kandidat = (extra) => ({ userId: 'u1', ean: GUELTIG, marketId: 'm1', status: 'pending', createdAt: T0 + 2 * STUNDE, ...extra });
  const urteil = (k) => evaluateDuplicate(policyOf('k', k), [policyOf('ref', referenz)]);

  it('ohne andere Daten → gesperrt', () => {
    expect(urteil(kandidat({})).verdict).toBe('locked');
  });

  it('geretteter anderer Preis → trotzdem gesperrt, der Unterschied steht nur noch als Information da', () => {
    const r = urteil(kandidat({ priceOcr: null, priceRescueOcr: { priceCents: 229, currency: 'EUR', priceImageKind: 'preisschild' } }));
    expect(r.verdict).toBe('locked');
    expect(r.updatedFields).toEqual(['price']);
  });

  it('anderer Hersteller (Namer oder nachgelesen) → trotzdem gesperrt', () => {
    expect(urteil(kandidat({ manufacturerOcr: null, manufacturerRescueOcr: { name: 'DMK Deutsches Milchkontor GmbH' } })).verdict).toBe('locked');
    expect(urteil(kandidat({ manufacturerOcr: { name: 'DMK Deutsches Milchkontor GmbH', source: 'hersteller' } })).verdict).toBe('locked');
    // Für die Anzeige bleibt der nachgelesene Hersteller außen vor (20.09.).
    expect(policyOf('k', kandidat({ manufacturerOcr: null, manufacturerRescueOcr: { name: 'DMK' } })).manufacturerOcr).toBeNull();
  });

  it('nachgelesene EAN macht die Einreichung zum Nachbarn der Referenz', () => {
    const k = kandidat({ ean: null, eanRescueOcr: GUELTIG });
    expect(policyOf('k', k).ean).toBe(GUELTIG);
    expect(urteil(k).verdict).toBe('locked');
  });
});

describe('Nummer vom Barcode-Foto (Entscheidung Patrick 02.10.2026)', () => {
  const { eanFotoBefund, eanFotoOf, istHandelsCode, gtin14 } = require('../src/werte');
  const ANDERE = '4000417025005';

  it('gleiche Nummer → gleich; UPC-A (12) und EAN-13 mit führender 0 sind dieselbe', () => {
    expect(eanFotoBefund(GUELTIG, GUELTIG)).toMatchObject({ art: 'gleich' });
    expect(gtin14('012345678905')).toBe(gtin14('0012345678905'));
    expect(eanFotoBefund('0012345678905', '012345678905')).toMatchObject({ art: 'gleich' });
  });
  it('andere gültige Nummer → abweichend', () => {
    expect(eanFotoBefund(GUELTIG, ANDERE)).toEqual({ art: 'abweichend', gelesen: ANDERE, gespeichert: GUELTIG });
  });
  it('gespeicherte Nummer mit falscher Prüfziffer (vertippt), Foto gültig → abweichend', () => {
    expect(eanFotoBefund(FALSCHE_PRUEFZIFFER, GUELTIG).art).toBe('abweichend');
  });
  it('nur eine gültige GTIN zählt als gelesen; nicht lesbar → kein Urteil', () => {
    expect(eanFotoBefund(GUELTIG, FALSCHE_PRUEFZIFFER)).toMatchObject({ art: 'kein_urteil', grund: 'pruefziffer' });
    expect(eanFotoBefund(GUELTIG, '')).toMatchObject({ art: 'kein_urteil', grund: 'nicht_lesbar' });
    expect(eanFotoBefund(GUELTIG, null)).toMatchObject({ art: 'kein_urteil' });
    expect(eanFotoBefund(GUELTIG, '40614648')).toMatchObject({ art: 'kein_urteil' }); // 8 Ziffern, Prüfziffer falsch
  });
  it('Händler-/Waagen-Code gelesen (lose Ware, 20.09.) → kein Urteil', () => {
    // 2112345000008: Präfix 21, gültige Prüfziffer
    const waage = '2112345000008';
    expect(pruefzifferOk(waage)).toBe(true);
    expect(istHandelsCode(waage)).toBe(true);
    expect(eanFotoBefund(GUELTIG, waage)).toMatchObject({ art: 'kein_urteil', grund: 'handelscode' });
    expect(istHandelsCode('0212345678909')).toBe(true);
    expect(istHandelsCode('0412345678904')).toBe(true);
    expect(istHandelsCode('412345678903')).toBe(true); // UPC-A, Zahlsystem 4 (Ladennummer)
    expect(istHandelsCode(GUELTIG)).toBe(false);
    expect(istHandelsCode(ANDERE)).toBe(false);
  });
  it('EAN-8 mit 0 oder 2 vorne ist KEIN Waagen-Code: Lidl/Penny/Norma-Eigenmarken werden verglichen (Prüfrunde 02.10.)', () => {
    for (const ean8 of ['20917937', '20005269', '02345673']) {
      expect(pruefzifferOk(ean8)).toBe(true);
      expect(istHandelsCode(ean8)).toBe(false);
    }
    // gespeichert ganz andere EAN, Foto zeigt die Lidl-EAN-8 → abweichend (vorher: kein Urteil)
    expect(eanFotoBefund('4006381333931', '20917937')).toMatchObject({ art: 'abweichend', gelesen: '20917937' });
    expect(eanFotoBefund('20005269', '20917937').art).toBe('abweichend');
    expect(eanFotoBefund('20917937', '20917937').art).toBe('gleich');
    expect(eanFotoBefund('020917937', '20917937').art).toBe('gleich'); // führende Null eingetippt
  });
  it('gespeichert ist ein Waagen-Code, das Foto zeigt eine echte EAN → abweichend (ein Mensch sieht hin)', () => {
    expect(eanFotoBefund('2112345000008', GUELTIG).art).toBe('abweichend');
  });
  it('nichts gespeichert → kein Urteil', () => {
    expect(eanFotoBefund(null, GUELTIG)).toMatchObject({ art: 'kein_urteil', grund: 'nichts_gespeichert' });
  });
  it('zweite Lesung: dieselbe Nummer → bestätigt; die gespeicherte → gleich; sonst → unsicher (halten), nie still frei (Prüfrunde 02.10.)', () => {
    const { eanFotoBestaetigen } = require('../src/werte');
    const ab = eanFotoBefund(GUELTIG, ANDERE);
    expect(eanFotoBestaetigen(ab, ANDERE)).toMatchObject({ art: 'abweichend', bestaetigt: true });
    // die zweite Lesung liest die GESPEICHERTE Nummer → die erste war falsch gelesen
    expect(eanFotoBestaetigen(ab, GUELTIG)).toEqual({ art: 'gleich', gelesen: GUELTIG, gespeichert: GUELTIG, grund: 'zweite_lesung' });
    expect(eanFotoBestaetigen(ab, '0' + GUELTIG).art).toBe('gleich');
    // erfundene, aber gültige dritte Nummer bei unscharfem Foto (gemessen 02.10.)
    expect(eanFotoBestaetigen(ab, '4001382088125')).toEqual({ art: 'unsicher', gelesen: ANDERE, gespeichert: GUELTIG, zweit: '4001382088125', grund: 'lesungen_uneinig' });
    // eine Ziffer falsch gelesen → Prüfziffer falsch; leer → ebenfalls unsicher
    expect(eanFotoBestaetigen(ab, '4000417025006')).toMatchObject({ art: 'unsicher', zweit: null, grund: 'zweite_lesung_leer' });
    expect(eanFotoBestaetigen(ab, '')).toMatchObject({ art: 'unsicher', grund: 'zweite_lesung_leer' });
    expect(eanFotoBestaetigen(ab, null).art).toBe('unsicher');
    // nichts zu bestätigen
    expect(eanFotoBestaetigen(eanFotoBefund(GUELTIG, GUELTIG), '')).toMatchObject({ art: 'gleich' });
  });
  it('eanFotoOf liest nur gültige Nummern aus eanFotoOcr', () => {
    expect(eanFotoOf({ eanFotoOcr: { ean: GUELTIG } })).toBe(GUELTIG);
    expect(eanFotoOf({ eanFotoOcr: { ean: FALSCHE_PRUEFZIFFER } })).toBeNull();
    expect(eanFotoOf({ eanFotoOcr: { ean: null } })).toBeNull();
    expect(eanFotoOf({})).toBeNull();
  });
});

describe('preisHinweisOf (Gegenzeichen zur Preis-Pflicht, 26.09.2026)', () => {
  const { preisHinweisOf } = require('../src/werte');
  it('Lesedienst sah Preisschild oder Kassenbon → Hinweis', () => {
    expect(preisHinweisOf({ priceImageKind: 'preisschild' })).toMatch(/preisschild/);
    expect(preisHinweisOf({ priceImageKind: 'Kassenbon' })).toMatch(/kassenbon/);
    expect(preisHinweisOf({ priceImageKind: 'unklar', priceReceipt: { city: 'Köln' } })).toMatch(/Kassenbon/);
  });
  it('Produktfoto, fehlt oder nichts bekannt → kein Hinweis', () => {
    expect(preisHinweisOf({ priceImageKind: 'produktfoto' })).toBeNull();
    expect(preisHinweisOf({ priceImageKind: 'fehlt', priceReceipt: {} })).toBeNull();
    expect(preisHinweisOf({})).toBeNull();
  });
});

describe('EAN-Schreibweisen: dieselbe GTIN ist dasselbe Produkt (Prüfrunde 02.10.2026)', () => {
  const { eanSchluessel, eanVarianten } = require('../src/werte');
  it('„0" + EAN-13, UPC-A und EAN-13 haben denselben Schlüssel', () => {
    expect(eanSchluessel('4006381333931')).toBe(eanSchluessel('04006381333931'));
    expect(eanSchluessel('012345678905')).toBe(eanSchluessel('0012345678905'));
    expect(eanSchluessel('20917937')).toBe(eanSchluessel('020917937'));
    expect(eanSchluessel('4006381333931')).not.toBe(eanSchluessel('4000417025005'));
  });
  it('unbrauchbare Eingaben bleiben bei sich (fallen nicht in eine gemeinsame Gruppe)', () => {
    expect(eanSchluessel('123')).toBe('123');
    expect(eanSchluessel('123')).not.toBe(eanSchluessel('456'));
    expect(eanSchluessel('')).toBeNull();
    expect(eanSchluessel(null)).toBeNull();
  });
  it('Varianten für Abfragen: jede Länge 8–14 mit nur weggelassenen führenden Nullen, Rohwert immer dabei, höchstens 8', () => {
    expect(eanVarianten('4006381333931').sort()).toEqual(['04006381333931', '4006381333931']);
    expect(eanVarianten('04006381333931').sort()).toEqual(['04006381333931', '4006381333931']);
    const v8 = eanVarianten('20917937');
    expect(v8).toHaveLength(7);
    expect(v8).toContain('20917937');
    expect(v8).toContain('00000020917937');
    for (const e of ['4006381333931', '20917937', '012345678905', '123', ' 4006381333931']) {
      const v = eanVarianten(e);
      expect(v).toContain(e);
      expect(v.length).toBeLessThanOrEqual(8);
      v.filter((x) => /^\d+$/.test(x)).forEach((x) => expect(eanSchluessel(x)).toBe(eanSchluessel(e)));
    }
    expect(eanVarianten(null)).toEqual([]);
  });
});

describe('Einreich-Zeitpunkt: Server-Zeit statt Client-Feld (Prüfrunde 02.10.2026)', () => {
  const { einreichZeit } = require('../src/werte');
  it('createTime des Dokuments geht vor createdAt', () => {
    expect(einreichZeit({ createdAt: { toMillis: () => 1 } }, { toMillis: () => 5000 })).toBe(5000);
    expect(policyOf('a', { createdAt: { toMillis: () => 1 } }, { toMillis: () => 5000 }).createdAt).toBe(5000);
  });
  it('ohne createTime (Tests, Altaufrufer) → createdAt', () => {
    expect(einreichZeit({ createdAt: { toMillis: () => 7 } })).toBe(7);
    expect(policyOf('a', { createdAt: 7 }).createdAt).toBe(7);
    expect(einreichZeit({})).toBeNull();
  });
});
