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
  });
  it('falsche Prüfziffer, aber höchstens 2 von 14 Stellen anders → kein Urteil (Lesefehler derselben Nummer)', () => {
    // Fälle aus den Trockenläufen 02.10.2026
    expect(eanFotoBefund('4311501450956', '4311501430956')).toMatchObject({ art: 'kein_urteil', grund: 'pruefziffer' }); // 1 Ziffer
    expect(eanFotoBefund('3153126826003', '353126826003')).toMatchObject({ art: 'kein_urteil', grund: 'pruefziffer' }); // eine Ziffer verloren → 2 Stellen
    expect(eanFotoBefund('20003166', '20002166')).toMatchObject({ art: 'kein_urteil' });
  });
  it('falsche Prüfziffer und mehr als 2 Stellen anders → zweifelhaft, Rohziffern bleiben sichtbar (Prüfrunde 2, Kfs5…)', () => {
    const { stellenAbstand, MAX_LESEFEHLER_STELLEN } = require('../src/werte');
    expect(MAX_LESEFEHLER_STELLEN).toBe(2);
    expect(eanFotoBefund('4250231136474', '4013602313647')).toEqual({
      art: 'zweifelhaft', gelesen: null, roh: '4013602313647', gespeichert: '4250231136474', grund: 'pruefziffer_weit_weg', abstand: 12,
    });
    expect(eanFotoBefund(GUELTIG, '40614648')).toMatchObject({ art: 'zweifelhaft', roh: '40614648' }); // 8 Ziffern, Prüfziffer falsch, ganz andere Stellen
    expect(eanFotoBefund('4068706503566', '5303612').art).toBe('zweifelhaft'); // abgeschnittene Lesung
    // genau 3 Stellen → zweifelhaft, 2 → nicht
    expect(stellenAbstand('4061464833821', '4061464833000')).toBe(3);
    expect(eanFotoBefund('4061464833821', '4061464833000').art).toBe('zweifelhaft');
    expect(stellenAbstand('012345678905', '0012345678905')).toBe(0);
    // ohne gespeicherte Nummer gibt es nichts zu vergleichen
    expect(eanFotoBefund(null, '4013602313647')).toMatchObject({ art: 'kein_urteil', grund: 'pruefziffer' });
  });
  it('Händler-/Waagen-Code auf BEIDEN Seiten (lose Ware, 20.09.) → kein Urteil', () => {
    // 2112345000008: Präfix 21, gültige Prüfziffer
    const waage = '2112345000008';
    expect(pruefzifferOk(waage)).toBe(true);
    expect(istHandelsCode(waage)).toBe(true);
    expect(eanFotoBefund('2112345001500', waage)).toMatchObject({ art: 'kein_urteil', grund: 'handelscode' });
    expect(eanFotoBefund(null, waage)).toMatchObject({ art: 'kein_urteil', grund: 'handelscode' });
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
  it('gespeichert ist ein Hersteller-Barcode, das Foto zeigt einen Waagen-Code → abweichend (Prüfrunde 2: vorher kein Urteil)', () => {
    expect(eanFotoBefund(GUELTIG, '2112345000008')).toEqual({ art: 'abweichend', gelesen: '2112345000008', gespeichert: GUELTIG });
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
    expect(eanFotoBestaetigen(eanFotoBefund(GUELTIG, ''), GUELTIG)).toMatchObject({ art: 'kein_urteil' });
  });
  it('zweite Lesung nach zweifelhafter Lesung: die gespeicherte → gleich; alles andere → unsicher (Prüfrunde 2)', () => {
    const { eanFotoBestaetigen } = require('../src/werte');
    const zw = eanFotoBefund('4250231136474', '4013602313647');
    expect(eanFotoBestaetigen(zw, '4250231136474')).toEqual({ art: 'gleich', gelesen: '4250231136474', gespeichert: '4250231136474', grund: 'zweite_lesung' });
    // eine andere gültige Nummer bestätigt nichts — die erste Lesung war keine gültige
    expect(eanFotoBestaetigen(zw, '4013602136424')).toEqual({ art: 'unsicher', gelesen: null, roh: '4013602313647', gespeichert: '4250231136474', zweit: '4013602136424', grund: 'lesungen_uneinig' });
    expect(eanFotoBestaetigen(zw, '4013602313647')).toMatchObject({ art: 'unsicher', zweit: null, grund: 'zweite_lesung_leer' });
    expect(eanFotoBestaetigen(zw, null).art).toBe('unsicher');
  });
  it('„gleich" bekommt keine zweite Lesung mehr (das automatische Aufheben ist weg, Schlussprüfung 03.10.) → unverändert', () => {
    const { eanFotoBestaetigen } = require('../src/werte');
    const gl = eanFotoBefund(GUELTIG, GUELTIG);
    expect(eanFotoBestaetigen(gl, GUELTIG)).toBe(gl);
    expect(eanFotoBestaetigen(gl, ANDERE)).toBe(gl);
  });
  it('zweite Lesung kam nicht zustande (Technik, Zeit) → nie Freigabe: Abweichung bleibt, zweifelhaft wird unsicher', () => {
    const { eanFotoOhneZweitlesung } = require('../src/werte');
    expect(eanFotoOhneZweitlesung(eanFotoBefund(GUELTIG, ANDERE), 'zeit_abgelaufen')).toMatchObject({ art: 'abweichend', bestaetigt: false, fehler: 'zeit_abgelaufen' });
    expect(eanFotoOhneZweitlesung(eanFotoBefund('4250231136474', '4013602313647'), '429')).toMatchObject({ art: 'unsicher', roh: '4013602313647', grund: 'zweite_lesung_gescheitert' });
    const gl = eanFotoBefund(GUELTIG, GUELTIG);
    expect(eanFotoOhneZweitlesung(gl, 'x')).toBe(gl);
    expect(eanFotoOhneZweitlesung(eanFotoBefund(GUELTIG, ''), 'x')).toMatchObject({ art: 'kein_urteil' });
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

describe('Halte-Befund früherer Läufe (Prüfrunde 2, 02.10.2026)', () => {
  const { eanFotoBefund, eanFotoBestaetigen, eanFotoVorbefund, eanFotoMitVorbefund, eanFotoEintrag } = require('../src/werte');
  const ANDERE = '4000417025005';
  const KFS = { ean: '4250231136474' };

  it('eanFotoVorbefund: nur abweichend/unsicher halten; Quelle eanFotoOcr', () => {
    expect(eanFotoVorbefund({ ...KFS, eanFotoOcr: { ean: '4013602136424', befund: 'abweichend', bestaetigt: true, lauf: '2026-10-02_080000' } }))
      .toEqual({ befund: 'abweichend', gelesen: '4013602136424', gespeichert: '4250231136474', bestaetigt: true, zweit: null, lauf: '2026-10-02_080000', quelle: 'eanFotoOcr', vertraut: false, korrekturfaehig: false });
    expect(eanFotoVorbefund({ ...KFS, eanFotoOcr: { ean: ANDERE, befund: 'unsicher', zweit: '4001382088125' } })).toMatchObject({ befund: 'unsicher', zweit: '4001382088125' });
    for (const befund of ['gleich', 'kein_urteil', 'zweifelhaft', undefined]) expect(eanFotoVorbefund({ ...KFS, eanFotoOcr: { ean: ANDERE, befund } })).toBeNull();
    expect(eanFotoVorbefund(KFS)).toBeNull();
    expect(eanFotoVorbefund(null)).toBeNull();
  });
  it('… Rückfall review.rundeOffen.eanFoto, wenn eanFotoOcr nicht gespeichert wurde; hält EINE Quelle an, gilt der Halt (Schlussprüfung 03.10.)', () => {
    const ro = { review: { rundeOffen: { lauf: '2026-10-03_080000', eanFoto: { befund: 'abweichend', ean: ANDERE, bestaetigt: false } } } };
    expect(eanFotoVorbefund({ ...KFS, ...ro })).toMatchObject({ befund: 'abweichend', gelesen: ANDERE, quelle: 'rundeOffen', lauf: '2026-10-03_080000' });
    // ein „gleich" in eanFotoOcr verdrängt den Halt nicht — weder älter noch jünger (vorher galt der jüngere Lauf)
    for (const lauf of ['2026-10-02_080000', '2026-10-03_080000', '2026-10-04_080000']) {
      expect(eanFotoVorbefund({ ...KFS, ...ro, eanFotoOcr: { ean: KFS.ean, befund: 'gleich', lauf } })).toMatchObject({ befund: 'abweichend', quelle: 'rundeOffen' });
    }
    // halten beide, geht eanFotoOcr vor
    expect(eanFotoVorbefund({ ...KFS, ...ro, eanFotoOcr: { ean: '4001382088125', befund: 'unsicher', lauf: '2026-10-02_080000' } })).toMatchObject({ befund: 'unsicher', quelle: 'eanFotoOcr' });
    // ein Rückfall ohne Halte-Befund hält nicht
    expect(eanFotoVorbefund({ ...KFS, review: { rundeOffen: { lauf: 'L', eanFoto: null } } })).toBeNull();
  });

  const vorher = (b = {}) => ({ befund: 'abweichend', gelesen: '4013602136424', gespeichert: '4250231136474', bestaetigt: false, zweit: null, lauf: '2026-10-02_080000', quelle: 'eanFotoOcr', ...b });

  it('ohne alten Befund → der heutige', () => {
    const h = eanFotoBefund(KFS.ean, KFS.ean);
    expect(eanFotoMitVorbefund(h, null)).toBe(h);
  });
  it('Kfs5jFA6qqOF8gD9iTEk: keine Bildprüfung oder Foto nicht lesbar → der alte Befund hält unverändert', () => {
    for (const heute of [null, eanFotoBefund(KFS.ean, '')]) {
      expect(eanFotoMitVorbefund(heute, vorher())).toMatchObject({
        art: 'abweichend', gelesen: '4013602136424', gespeichert: '4250231136474', bestaetigt: false,
        vorbefund: { lauf: '2026-10-02_080000', quelle: 'eanFotoOcr' }, heute: heute ? { art: 'kein_urteil', gelesen: null } : null,
      });
    }
    expect(eanFotoMitVorbefund(null, vorher({ befund: 'unsicher', zweit: '4001382088125' }))).toMatchObject({ art: 'unsicher', zweit: '4001382088125', heute: null });
  });
  it('… heute dieselbe Nummer nur EINMAL (zweite Lesung leer oder gescheitert) → unverändert, kein Widerspruch', () => {
    const N = '4013602136424';
    for (const heute of [eanFotoBestaetigen(eanFotoBefund(KFS.ean, N), ''), { ...eanFotoBefund(KFS.ean, N), bestaetigt: false, fehler: 'zeit' }]) {
      expect(eanFotoMitVorbefund(heute, vorher({ bestaetigt: true }))).toMatchObject({ art: 'abweichend', gelesen: N, bestaetigt: true, vorbefund: expect.any(Object) });
    }
  });
  it('Prüfrunde 06.10.: heute ein WIDERSPRUCH zum alten Abweichungs-Befund → `unsicher` über Tage, neu zu speichern (nie mehr korrigierbar)', () => {
    const N = '4013602136424';
    const widersprueche = [
      eanFotoBefund(KFS.ean, KFS.ean), // die gespeicherte
      { ...eanFotoBefund(KFS.ean, KFS.ean), bestaetigt: true }, // auch „zweimal"
      eanFotoBestaetigen(eanFotoBefund(KFS.ean, ANDERE), KFS.ean), // erste andere, zweite gespeichert (am ersten Tag „gleich")
      eanFotoBefund(KFS.ean, '4250231136470'), // falsche Prüfziffer nah an der gespeicherten
      eanFotoBestaetigen(eanFotoBefund(KFS.ean, ANDERE), ANDERE), // eine ANDERE, zweimal gelesen
      eanFotoBestaetigen(eanFotoBefund(KFS.ean, ANDERE), ''), // eine andere, einmal
      eanFotoBestaetigen(eanFotoBefund(KFS.ean, N), '4001382088125'), // N und eine dritte
    ];
    for (const heute of widersprueche) {
      for (const v of [vorher(), vorher({ bestaetigt: true })]) {
        const r = eanFotoMitVorbefund(heute, v);
        expect(r).toMatchObject({ art: 'unsicher', gelesen: N, gespeichert: KFS.ean, grund: 'lesungen_uneinig_tage', frueher: { lauf: '2026-10-02_080000', ean: N, bestaetigt: v.bestaetigt } });
        expect(r.vorbefund).toBeUndefined(); // wird neu gespeichert
        expect(eanFotoEintrag(r)).toMatchObject({ ean: N, befund: 'unsicher', grund: 'lesungen_uneinig_tage' });
      }
    }
    // die heutige Nummer steht als zweite Lesung da
    expect(eanFotoMitVorbefund(eanFotoBestaetigen(eanFotoBefund(KFS.ean, ANDERE), ANDERE), vorher()).zweit).toBe(ANDERE);
  });
  it('alter `unsicher` bleibt `unsicher` — auch gegen zwei gleiche heutige Lesungen (Prüfrunde 06.10.: ean_unsicher bleibt beim Menschen)', () => {
    const ab = eanFotoBestaetigen(eanFotoBefund(KFS.ean, ANDERE), ANDERE);
    for (const heute of [ab, eanFotoBefund(KFS.ean, KFS.ean), null]) {
      expect(eanFotoMitVorbefund(heute, vorher({ befund: 'unsicher', zweit: null }))).toMatchObject({ art: 'unsicher', gelesen: '4013602136424', vorbefund: expect.any(Object) });
    }
  });
  it('heute dieselbe Nummer BESTÄTIGT → ersetzt den alten Abweichungs-Befund; ein Bremsvermerk bleibt', () => {
    const N = '4013602136424';
    const ab = eanFotoBestaetigen(eanFotoBefund(KFS.ean, N), N);
    expect(eanFotoMitVorbefund(ab, vorher())).toBe(ab);
    const r = eanFotoMitVorbefund(ab, vorher({ bestaetigt: true, gebremst: 'L0' }));
    expect(r).toMatchObject({ art: 'abweichend', gelesen: N, bestaetigt: true, korrekturGebremst: 'L0' });
    expect(eanFotoEintrag(r)).toEqual({ ean: N, befund: 'abweichend', bestaetigt: true, zweit: N, korrekturfaehig: true, korrekturGebremst: 'L0' });
    // übernommen (ohne heutige Bestätigung): der Vermerk bleibt ebenfalls
    expect(eanFotoMitVorbefund(null, vorher({ bestaetigt: true, gebremst: 'L0' }))).toMatchObject({ korrekturGebremst: 'L0', vorbefund: expect.any(Object) });
  });
  it('eanFotoEintrag: was am Dokument landet — ganze Form, ohne Reste', () => {
    expect(eanFotoEintrag(eanFotoBefund(KFS.ean, KFS.ean))).toEqual({ ean: KFS.ean, befund: 'gleich' });
    expect(eanFotoEintrag(eanFotoBestaetigen(eanFotoBefund(KFS.ean, ANDERE), ANDERE))).toEqual({ ean: ANDERE, befund: 'abweichend', bestaetigt: true, zweit: ANDERE, korrekturfaehig: true });
    // unbestätigt (zweite Lesung gescheitert): ohne zweite Lesung, Vermerk trotzdem (trägt ohnehin keine Korrektur)
    expect(eanFotoEintrag({ ...eanFotoBefund(KFS.ean, ANDERE), bestaetigt: false, fehler: 'zeit' })).toEqual({ ean: ANDERE, befund: 'abweichend', bestaetigt: false, zweit: null, korrekturfaehig: true, fehler: 'zeit' });
    expect(eanFotoEintrag(eanFotoBestaetigen(eanFotoBefund(KFS.ean, '4013602313647'), ''))).toEqual({ ean: '4013602313647', befund: 'unsicher', grund: 'zweite_lesung_leer', zweit: null });
    expect(eanFotoEintrag({ art: 'zweifelhaft', roh: '123', gespeichert: KFS.ean })).toMatchObject({ befund: 'unsicher', ean: '123' });
    // erste Lesung abweichend, zweite gespeichert (erster Tag) → gleich, ohne Reste
    expect(eanFotoEintrag(eanFotoBestaetigen(eanFotoBefund(KFS.ean, ANDERE), KFS.ean))).toEqual({ ean: KFS.ean, befund: 'gleich', grund: 'zweite_lesung' });
    expect(eanFotoEintrag(eanFotoBefund(KFS.ean, ''))).toEqual({ ean: null, befund: 'kein_urteil', grund: 'nicht_lesbar' });
  });
});

describe('Barcode-Korrektur (Entscheidung Patrick 06.10.2026)', () => {
  const {
    eanKorrekturOf, eanAbgleichOf, eanKorrekturAus, durchKorrekturErledigt, eanKorrigierbar, eanFotoKorrigiert, eanKorrekturEintrag,
    eanFotoBefund, eanFotoBestaetigen, eanFotoOhneZweitlesung, eanFotoVorbefund, eanFotoEintrag, herkunftOf: herkunft, EAN_HALTEN,
  } = require('../src/werte');
  const S = '4061464833821'; // gespeichert (vom Scanner)
  const X = '4000417025005'; // vom Foto, zweimal gleich
  const korr = (extra = {}) => ({ ean: S, eanKorrektur: { ean: X, vorher: S, lesungen: [X, X], aus: 'heute', ...extra } });

  it('eanKorrigierbar: gültige GTIN, kein Waagen-/Händlercode; EAN-8 mit 2 vorne bleibt korrigierbar', () => {
    expect(eanKorrigierbar(X)).toBe(true);
    expect(eanKorrigierbar('20917937')).toBe(true);
    expect(eanKorrigierbar('4000417025006')).toBe(false); // Prüfziffer
    expect(eanKorrigierbar('2112345001500')).toBe(false); // Waage (GTIN-13, 2x)
    expect(eanKorrigierbar('0212345001509')).toBe(false); // 02
    expect(eanKorrigierbar('')).toBe(false);
    // GTIN-14 mit Packungsindikator (Umkarton/ITF-14) nie; mit führender 0 = GTIN-13, korrigierbar
    expect(eanKorrigierbar('14061464833828')).toBe(false);
    expect(eanKorrigierbar('0' + X)).toBe(true);
  });

  it('eanKorrekturOf: nur in sich stimmig — korrigierbar, `vorher` = gespeicherte EAN, nicht dieselbe Nummer', () => {
    expect(eanKorrekturOf(korr())).toBe(X);
    expect(eanKorrekturOf(korr({ vorher: '0' + S }))).toBe(X); // Schreibweise egal
    expect(eanKorrekturOf({ ...korr(), ean: '4001382088125' })).toBeNull(); // korrigiert eine andere Nummer
    expect(eanKorrekturOf(korr({ ean: '4000417025006' }))).toBeNull();
    expect(eanKorrekturOf(korr({ ean: '2112345001500' }))).toBeNull();
    expect(eanKorrekturOf(korr({ ean: S }))).toBeNull();
    expect(eanKorrekturOf({ ean: S })).toBeNull();
    expect(eanKorrekturOf({ eanKorrektur: { ean: X, vorher: S } })).toBeNull(); // ohne gespeicherte EAN
  });

  it('eanOf: korrigiert vor gespeichert vor nachgelesen; ungültige Korrektur zählt nicht', () => {
    expect(eanOf(korr())).toBe(X);
    expect(eanOf({ ...korr({ ean: '4000417025006' }) })).toBe(S);
    expect(eanOf({ ...korr(), eanRescueOcr: '4001382088125' })).toBe(X);
    expect(eanAbgleichOf(korr())).toBe(X);
    expect(eanAbgleichOf({ ean: S })).toBe(S);
    expect(herkunft(korr())).toMatchObject({ eanKorrigiert: true, eanNachgelesen: false });
    expect(policyOf('k', korr()).ean).toBe(X);
    expect(vollstaendigkeitOf(korr()).ean).toBe(X);
  });

  it('eanKorrekturAus ohne alten Befund: nur abweichend UND bestätigt UND korrigierbar', () => {
    const ab = eanFotoBestaetigen(eanFotoBefund(S, X), X);
    expect(eanKorrekturAus({ ean: S }, ab)).toEqual({ ean: X, vorher: S, lesungen: [X, X], aus: 'heute', befundVom: null });
    // zweite Lesung in anderer Schreibweise (UPC/0-Präfix) — dieselbe GTIN, beide Lesungen gemerkt
    expect(eanKorrekturAus({ ean: S }, eanFotoBestaetigen(eanFotoBefund(S, X), '0' + X))).toMatchObject({ ean: X, lesungen: [X, '0' + X] });
    expect(eanKorrekturAus({ ean: S }, eanFotoBestaetigen(eanFotoBefund(S, X), ''))).toBeNull(); // unsicher
    expect(eanKorrekturAus({ ean: S }, eanFotoBestaetigen(eanFotoBefund(S, X), '4001382088125'))).toBeNull();
    expect(eanKorrekturAus({ ean: S }, eanFotoOhneZweitlesung(eanFotoBefund(S, X), 'zeit'))).toBeNull(); // nur eine Lesung
    expect(eanKorrekturAus({ ean: S }, eanFotoBefund(S, S))).toBeNull();
    expect(eanKorrekturAus({ ean: S }, eanFotoBefund(S, ''))).toBeNull();
    expect(eanKorrekturAus({ ean: S }, null)).toBeNull();
    // Waagen-Code auf dem Foto gegen Hersteller-Barcode: abweichend + bestätigt, aber nicht korrigierbar
    const waage = eanFotoBestaetigen(eanFotoBefund(S, '2112345001500'), '2112345001500');
    expect(waage).toMatchObject({ art: 'abweichend', bestaetigt: true });
    expect(eanKorrekturAus({ ean: S }, waage)).toBeNull();
    // ohne gespeicherte EAN gibt es nichts zu korrigieren
    expect(eanKorrekturAus({ eanRescueOcr: S }, ab)).toBeNull();
  });

  it('… höchstens EINE Korrektur je Einreichung', () => {
    const y = '4001382088125';
    const gegenX = eanFotoBestaetigen(eanFotoBefund(X, y), y);
    expect(eanKorrekturAus(korr(), gegenX)).toBeNull();
  });

  it('eanKorrekturAus mit altem Halte-Befund: alle Quellen abweichend + bestätigt + dieselbe Nummer, heute kein Widerspruch', () => {
    // Vom Code seit der Korrektur geschrieben: Vermerk + beide Lesungen (vertraut).
    const gestern = { ean: S, eanFotoOcr: { ean: X, befund: 'abweichend', bestaetigt: true, zweit: X, korrekturfaehig: true, lauf: 'L1' } };
    const nichtLesbar = eanFotoBefund(S, '');
    expect(eanKorrekturAus(gestern, nichtLesbar)).toEqual({ ean: X, vorher: S, lesungen: [X, X], aus: 'vorbefund', befundVom: 'L1' });
    expect(eanKorrekturAus(gestern, eanFotoBestaetigen(eanFotoBefund(S, X), X))).toMatchObject({ ean: X, aus: 'vorbefund' });
    expect(eanKorrekturAus(gestern, eanFotoOhneZweitlesung(eanFotoBefund(S, X), 'zeit'))).toMatchObject({ ean: X });
    // dieselbe Nummer, zweite Lesung leer: kein Widerspruch
    expect(eanKorrekturAus(gestern, eanFotoBestaetigen(eanFotoBefund(S, X), ''))).toMatchObject({ ean: X });
    // Prüfrunde 06.10.: heute KEINE Bildprüfung → keine Korrektur aus dem alten Befund
    expect(eanKorrekturAus(gestern, null)).toBeNull();
    // Widerspruch heute: gespeicherte gelesen, eine dritte, falsche Prüfziffer nah an S, uneinig
    for (const heute of [
      eanFotoBefund(S, S),
      eanFotoBestaetigen(eanFotoBefund(S, '4001382088125'), '4001382088125'),
      eanFotoBefund(S, '4061464833820'),
      eanFotoBestaetigen(eanFotoBefund(S, X), '4001382088125'),
      eanFotoBestaetigen(eanFotoBefund(S, '4001382088125'), ''),
    ]) expect(eanKorrekturAus(gestern, heute)).toBeNull();
    // alter Befund unbestätigt oder unsicher → nie
    expect(eanKorrekturAus({ ean: S, eanFotoOcr: { ean: X, befund: 'abweichend', bestaetigt: false } }, nichtLesbar)).toBeNull();
    expect(eanKorrekturAus({ ean: S, eanFotoOcr: { ean: X, befund: 'unsicher', zweit: X } }, nichtLesbar)).toBeNull();
    expect(eanKorrekturAus({ ean: S, eanFotoOcr: { ean: X, befund: 'unsicher', grund: 'lesungen_uneinig_tage', zweit: S } }, eanFotoBestaetigen(eanFotoBefund(S, X), X))).toBeNull();
    // Bremsvermerk an einer Quelle → nie (Prüfrunde 06.10.)
    expect(eanKorrekturAus({ ean: S, eanFotoOcr: { ean: X, befund: 'abweichend', bestaetigt: true, korrekturGebremst: 'L0' } }, eanFotoBestaetigen(eanFotoBefund(S, X), X))).toBeNull();
    expect(eanKorrekturAus({ ...gestern, review: { rundeOffen: { lauf: 'L2', eanFoto: { befund: 'abweichend', ean: X, bestaetigt: true, korrekturGebremst: 'L2' } } } }, nichtLesbar)).toBeNull();
    // … auch ohne alten Befund, wenn der heutige ihn trägt
    expect(eanKorrekturAus({ ean: S }, { ...eanFotoBestaetigen(eanFotoBefund(S, X), X), korrekturGebremst: 'L0' })).toBeNull();
    // Rückfall in review.rundeOffen genügt, wenn er allein steht …
    const nurRo = { ean: S, review: { rundeOffen: { lauf: 'L2', eanFoto: { befund: 'abweichend', ean: X, bestaetigt: true, zweit: X, korrekturfaehig: true } } } };
    expect(eanKorrekturAus(nurRo, nichtLesbar)).toMatchObject({ ean: X, befundVom: 'L2' });
    // … und zwei uneinige Quellen verhindern sie
    expect(eanKorrekturAus({ ...gestern, review: { rundeOffen: { lauf: 'L2', eanFoto: { befund: 'abweichend', ean: '4001382088125', bestaetigt: true } } } }, nichtLesbar)).toBeNull();
    expect(eanKorrekturAus({ ...gestern, review: { rundeOffen: { lauf: 'L2', eanFoto: { befund: 'unsicher', ean: X } } } }, nichtLesbar)).toBeNull();
  });

  it('nach der Korrektur hält der Befund, aus dem sie entstand, nicht mehr — ein späterer gegen die korrigierte Nummer schon', () => {
    const x = { ...korr(), eanFotoOcr: { ean: X, befund: 'korrigiert', vorher: S }, review: { rundeOffen: { lauf: 'L1', eanFoto: { befund: 'abweichend', ean: X, bestaetigt: true } } } };
    expect(durchKorrekturErledigt(x, { befund: 'abweichend', ean: X })).toBe(true);
    expect(eanFotoVorbefund(x)).toBeNull();
    const spaeter = { ...korr(), eanFotoOcr: { ean: '4001382088125', befund: 'abweichend', bestaetigt: true, lauf: 'L3' } };
    expect(eanFotoVorbefund(spaeter)).toMatchObject({ befund: 'abweichend', gelesen: '4001382088125', gespeichert: X });
    expect(EAN_HALTEN.has('korrigiert')).toBe(false);
  });

  it('eanFotoKorrigiert / eanFotoEintrag / eanKorrekturEintrag: was am Dokument landet', () => {
    const k = { ean: X, vorher: S, lesungen: [X, X], aus: 'vorbefund', befundVom: 'L1' };
    const b = eanFotoKorrigiert(k);
    expect(b).toMatchObject({ art: 'korrigiert', gelesen: X, gespeichert: S, bestaetigt: true });
    expect(eanFotoEintrag(b)).toEqual({ ean: X, befund: 'korrigiert', vorher: S, korrekturAus: 'vorbefund' });
    expect(eanKorrekturEintrag(k)).toEqual({ ean: X, vorher: S, lesungen: [X, X], aus: 'vorbefund', befundVom: 'L1', regel: expect.stringMatching(/06\.10\.2026/) });
    expect(eanKorrekturEintrag({ ...k, befundVom: null, aus: 'heute' })).not.toHaveProperty('befundVom');
  });

  it('eanVorher / eanNummern / teilenNummer: die ursprüngliche Nummer bleibt für die verwandten Einreichungen erhalten', () => {
    const { eanNummern, teilenNummer, eanVorherOf, eanSchluessel } = require('../src/werte');
    expect(eanVorherOf(korr())).toBe(S);
    expect(eanVorherOf({ ean: S })).toBeNull();
    expect(eanVorherOf(korr({ ean: '4000417025006' }))).toBeNull(); // ungültige Korrektur
    const pk = policyOf('k', korr());
    expect(pk).toMatchObject({ ean: X, eanVorher: S });
    expect(eanNummern(pk)).toEqual([eanSchluessel(X), eanSchluessel(S)]);
    expect(eanNummern(policyOf('a', { ean: S }))).toEqual([eanSchluessel(S)]);
    expect(eanNummern(policyOf('a', {}))).toEqual([]);
    expect(teilenNummer(pk, policyOf('a', { ean: S }))).toBe(true); // meine alte = deine
    expect(teilenNummer(pk, policyOf('a', { ean: '0' + X }))).toBe(true); // meine neue = deine (andere Schreibweise)
    expect(teilenNummer(pk, policyOf('a', { ean: S, eanKorrektur: { ean: '4001382088125', vorher: S } }))).toBe(true); // dieselbe alte
    expect(teilenNummer(pk, policyOf('a', { ean: '4001382088125' }))).toBe(false);
    expect(teilenNummer(policyOf('a', {}), policyOf('b', {}))).toBe(false);
  });

  it('Doppel-Regel gruppiert nach der korrigierten Nummer (dieselbe Funktion wie Runde und Konsole)', () => {
    const frei = { ...policyOf('ref', { userId: 'u1', ean: X, status: 'approved', createdAt: T0 - 2 * 24 * STUNDE }) };
    const kand = policyOf('k', { ...korr(), userId: 'u1', status: 'pending', createdAt: T0 });
    expect(evaluateDuplicate(kand, [frei])).toMatchObject({ verdict: 'locked', priorId: 'ref' });
  });
});

describe('Prüfrunde 06.10.2026 (Rückweg, Übergangslücke): wem ein alter Barcode-Befund trauen darf', () => {
  const {
    eanKorrekturAus, eanKorrekturOf, eanFotoBefund, eanFotoBestaetigen, eanFotoVorbefund, eanFotoMitVorbefund, eanFotoEintrag,
    eanFotoHalteQuellen, eanKorrekturVerworfen, durchKorrekturErledigt, eanVorherOf, LETZTER_LAUF_OHNE_VERMERK, eanKorrekturEintrag,
  } = require('../src/werte');
  const S = '4061464833821'; // gespeichert
  const X = '4000417025005'; // vom Foto
  const Y = '4001382088125'; // eine dritte
  const ALT = LETZTER_LAUF_OHNE_VERMERK;
  const SPAETER = '2026-10-07_080001'; // ein Lauf des alten Codes NACH dem 06.10.
  const nichtLesbar = eanFotoBefund(S, '');
  const zweimal = (n) => eanFotoBestaetigen(eanFotoBefund(S, n), n);
  /** Was der alte Code (fe89647e) schreibt: eanFotoOcr ohne Vermerk/zweit, Rückfall ohne Vermerk. */
  const altCode = (ean, lauf, { befund = 'abweichend', bestaetigt = true, ro = true } = {}) => ({
    ean: S,
    eanFotoOcr: { ean, befund, ...(befund === 'abweichend' ? { bestaetigt } : { zweit: null }), lauf },
    ...(ro ? { review: { rundeOffen: { lauf, eanFoto: { befund, ean, ...(befund === 'abweichend' ? { bestaetigt } : { zweit: null }) } } } } : {}),
  });

  it('der Lauf vom 06.10. (einziger Blick, an den Daten geprüft) ist ohne Vermerk vertraut: nicht lesbar heute → korrigiert', () => {
    expect(ALT).toBe('2026-10-06_080038');
    const x = altCode(X, ALT);
    expect(eanFotoHalteQuellen(x).map((q) => q.vertraut)).toEqual([true, true]);
    expect(eanFotoVorbefund(x)).toMatchObject({ vertraut: true, korrekturfaehig: true });
    expect(eanKorrekturAus(x, nichtLesbar)).toEqual({ ean: X, vorher: S, lesungen: [X, X], aus: 'vorbefund', befundVom: ALT });
  });

  it('Befund des alten Codes aus einem SPÄTEREN Lauf (Übergang): nicht lesbar reicht NICHT, nur heute selbst zweimal dieselbe Nummer', () => {
    const x = altCode(X, SPAETER);
    expect(eanFotoVorbefund(x)).toMatchObject({ vertraut: false, korrekturfaehig: false });
    expect(eanKorrekturAus(x, nichtLesbar)).toBeNull();
    expect(eanKorrekturAus(x, eanFotoBestaetigen(eanFotoBefund(S, X), ''))).toBeNull(); // nur einmal
    expect(eanKorrekturAus(x, zweimal(Y))).toBeNull();
    expect(eanKorrekturAus(x, zweimal(X))).toEqual({ ean: X, vorher: S, lesungen: [X, X], aus: 'vorbefund', befundVom: SPAETER, heuteBestaetigt: true });
    expect(eanKorrekturEintrag(eanKorrekturAus(x, zweimal(X)))).toMatchObject({ heuteBestaetigt: true });
  });

  it('… dasselbe, wenn nur der Rückfall vom späteren Lauf stammt (der alte Code schrieb ihn jeden Morgen neu — auch über einen Widerspruch hinweg)', () => {
    const x = { ...altCode(X, ALT), review: { rundeOffen: { lauf: SPAETER, eanFoto: { befund: 'abweichend', ean: X, bestaetigt: true } } } };
    expect(eanFotoHalteQuellen(x).map((q) => q.vertraut)).toEqual([true, false]);
    expect(eanKorrekturAus(x, nichtLesbar)).toBeNull();
    expect(eanKorrekturAus(x, zweimal(X))).toMatchObject({ ean: X, heuteBestaetigt: true });
  });

  it('Delverde Eliche (otzruv…_4): 06.10. `unsicher`, der alte Code ersetzt das am 07.10. durch „abweichend, bestätigt M" → am 08.10. bei unlesbarem Foto KEINE Korrektur', () => {
    const M = '8002270014512'; // gültige Prüfziffer, vom unscharfen Foto erfunden
    const gespeichert = '8000270013122';
    const nach07 = { ...altCode(M, SPAETER), ean: gespeichert };
    expect(eanKorrekturAus(nach07, eanFotoBefund(gespeichert, ''))).toBeNull();
    // Gegenprobe: mit dem neuen Code durchgehend bleibt der alte `unsicher` `unsicher` — nie korrigierbar
    const unsicher = { ...altCode(M, ALT, { befund: 'unsicher' }), ean: gespeichert };
    const heute = eanFotoBestaetigen(eanFotoBefund(gespeichert, M), M);
    const r = eanFotoMitVorbefund(heute, eanFotoVorbefund(unsicher));
    expect(r).toMatchObject({ art: 'unsicher', vorbefund: expect.any(Object) });
    expect(eanKorrekturAus(unsicher, heute)).toBeNull();
  });

  it('mit Vermerk vertraut nur, wenn eine bestätigte Abweichung beide gleichen Lesungen trägt; `korrekturfaehig: false` nie — auch nicht aus dem Lauf vom 06.10.', () => {
    const mit = (o) => ({ ean: S, eanFotoOcr: { ean: X, befund: 'abweichend', bestaetigt: true, lauf: SPAETER, ...o } });
    expect(eanFotoVorbefund(mit({ korrekturfaehig: true, zweit: X }))).toMatchObject({ vertraut: true });
    expect(eanFotoVorbefund(mit({ korrekturfaehig: true, zweit: '0' + X }))).toMatchObject({ vertraut: true }); // Schreibweise egal
    expect(eanFotoVorbefund(mit({ korrekturfaehig: true }))).toMatchObject({ vertraut: false }); // zweite Lesung fehlt
    expect(eanFotoVorbefund(mit({ korrekturfaehig: true, zweit: Y }))).toMatchObject({ vertraut: false });
    expect(eanFotoVorbefund(mit({ korrekturfaehig: false, zweit: X, lauf: ALT }))).toMatchObject({ vertraut: false });
    expect(eanKorrekturAus(mit({ korrekturfaehig: false, zweit: X, lauf: ALT }), nichtLesbar)).toBeNull();
    // unsicher ist nie vertraut
    expect(eanFotoHalteQuellen({ ean: S, eanFotoOcr: { ean: X, befund: 'unsicher', zweit: null, lauf: ALT } })[0].vertraut).toBe(false);
  });

  it('eanFotoVorbefund: korrekturfaehig nur, wenn ALLE Quellen vertraut UND einig sind', () => {
    const fo = { ean: X, befund: 'abweichend', bestaetigt: true, zweit: X, korrekturfaehig: true, lauf: 'L1' };
    expect(eanFotoVorbefund({ ean: S, eanFotoOcr: fo, review: { rundeOffen: { lauf: 'L1', eanFoto: { befund: 'abweichend', ean: X, bestaetigt: true, zweit: X, korrekturfaehig: true } } } }).korrekturfaehig).toBe(true);
    expect(eanFotoVorbefund({ ean: S, eanFotoOcr: fo, review: { rundeOffen: { lauf: 'L1', eanFoto: { befund: 'abweichend', ean: Y, bestaetigt: true, zweit: Y, korrekturfaehig: true } } } }).korrekturfaehig).toBe(false);
    expect(eanFotoVorbefund({ ean: S, eanFotoOcr: fo, review: { rundeOffen: { lauf: SPAETER, eanFoto: { befund: 'abweichend', ean: X, bestaetigt: true } } } }).korrekturfaehig).toBe(false);
  });

  it('übernommener Befund: der Vermerk geht mit; ein nicht vertrauter bleibt beim Neuschreiben ausdrücklich nicht vertraut (kein Waschen)', () => {
    const vertraut = eanFotoMitVorbefund(nichtLesbar, eanFotoVorbefund(altCode(X, ALT)));
    expect(vertraut).toMatchObject({ art: 'abweichend', korrekturfaehig: true, zweit: X, vorbefund: expect.any(Object) });
    expect(eanFotoEintrag(vertraut)).toMatchObject({ befund: 'abweichend', bestaetigt: true, zweit: X, korrekturfaehig: true });
    const fremd = eanFotoMitVorbefund(nichtLesbar, eanFotoVorbefund(altCode(X, SPAETER)));
    expect(fremd).toMatchObject({ korrekturfaehig: false });
    expect(eanFotoEintrag(fremd)).toMatchObject({ korrekturfaehig: false });
    // … und so neu geschrieben ist er auch am nächsten Morgen nicht vertraut
    const neu = { ean: S, eanFotoOcr: { ...eanFotoEintrag(fremd), lauf: '2026-10-08_080000' } };
    expect(eanKorrekturAus(neu, nichtLesbar)).toBeNull();
  });

  it('verworfene Korrektur: gilt nicht mehr, nie wieder korrigiert, der Befund, aus dem sie entstand, hält wieder', () => {
    const k = { ean: X, vorher: S, lesungen: [X, X], aus: 'heute' };
    const x = { ean: S, eanKorrektur: k, eanKorrekturVerworfen: { by: 'patrick', notiz: 'Scanner-Nummer stimmt' }, review: { rundeOffen: { lauf: 'L1', eanFoto: { befund: 'abweichend', ean: X, bestaetigt: true, zweit: X, korrekturfaehig: true } } } };
    expect(eanKorrekturVerworfen(x)).toBe(true);
    expect(eanKorrekturOf(x)).toBeNull();
    expect(eanOf(x)).toBe(S);
    expect(policyOf('k', x)).toMatchObject({ ean: S, eanVorher: null });
    expect(eanVorherOf(x)).toBeNull();
    expect(durchKorrekturErledigt(x, { befund: 'abweichend', ean: X })).toBe(false);
    expect(eanFotoVorbefund(x)).toMatchObject({ befund: 'abweichend', gelesen: X });
    // nie wieder — weder aus dem alten Befund noch aus zwei heutigen Lesungen
    expect(eanKorrekturAus(x, zweimal(X))).toBeNull();
    expect(eanKorrekturAus({ ean: S, eanKorrekturVerworfen: { by: 'p' } }, zweimal(X))).toBeNull();
    // ohne Verwerfen derselbe Fall: korrigiert
    expect(eanKorrekturOf({ ean: S, eanKorrektur: k })).toBe(X);
  });
});
