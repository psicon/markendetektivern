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
    // die zweite Lesung liest die GESPEICHERTE Nummer → trotzdem liegen lassen
    // (Wortlaut Patrick 2a: weicht sie ab, bleibt die Einreichung liegen; Frage (d) vorgelegt 03.10.)
    expect(eanFotoBestaetigen(ab, GUELTIG)).toEqual({ art: 'unsicher', gelesen: ANDERE, gespeichert: GUELTIG, zweit: GUELTIG, grund: 'erste_lesung_abweichend' });
    expect(eanFotoBestaetigen(ab, '0' + GUELTIG).art).toBe('unsicher');
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
      .toEqual({ befund: 'abweichend', gelesen: '4013602136424', gespeichert: '4250231136474', bestaetigt: true, zweit: null, lauf: '2026-10-02_080000', quelle: 'eanFotoOcr' });
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
  it('Kfs5jFA6qqOF8gD9iTEk: heute falsche Prüfziffer (kein Urteil) oder keine Bildprüfung → der alte Befund hält weiter', () => {
    const heute = eanFotoBefund(KFS.ean, '4250231136470'); // eine Ziffer daneben → kein Urteil
    expect(heute.art).toBe('kein_urteil');
    expect(eanFotoMitVorbefund(heute, vorher())).toMatchObject({
      art: 'abweichend', gelesen: '4013602136424', gespeichert: '4250231136474', bestaetigt: false,
      vorbefund: { lauf: '2026-10-02_080000', quelle: 'eanFotoOcr' }, heute: { art: 'kein_urteil', gelesen: null },
    });
    expect(eanFotoMitVorbefund(null, vorher({ befund: 'unsicher', zweit: '4001382088125' }))).toMatchObject({ art: 'unsicher', zweit: '4001382088125', heute: null });
  });
  it('heute die gespeicherte Nummer gelesen — auch zweimal — hebt den alten Befund NICHT auf: nur ein Mensch in der Konsole (Schlussprüfung 03.10.)', () => {
    // auch ein (künstlich) bestätigtes „gleich" — so entstand bis 03.10. das Aufheben
    const zweimal = { ...eanFotoBefund(KFS.ean, KFS.ean), bestaetigt: true };
    for (const v of [vorher(), vorher({ befund: 'unsicher', zweit: null }), vorher({ bestaetigt: true })]) {
      const r = eanFotoMitVorbefund(zweimal, v);
      expect(r).toMatchObject({ art: v.befund, gelesen: '4013602136424', vorbefund: { lauf: '2026-10-02_080000', quelle: 'eanFotoOcr' }, heute: { art: 'gleich', gelesen: KFS.ean } });
      expect(r.grund).toBeUndefined();
    }
  });
  it('… und nicht mit nur EINER Lesung der gespeicherten Nummer', () => {
    const nurEine = eanFotoBestaetigen(eanFotoBefund(KFS.ean, KFS.ean), '');
    expect(eanFotoMitVorbefund(nurEine, vorher()).art).toBe('abweichend');
    const einfach = eanFotoBefund(KFS.ean, KFS.ean); // ohne zweite Lesung
    expect(eanFotoMitVorbefund(einfach, vorher()).art).toBe('abweichend');
    // erste Lesung abweichend, zweite gespeichert → hält schon selbst (Wortlaut 2a, 03.10.) und erst recht gegen einen alten Befund
    const zweiteGleich = eanFotoBestaetigen(eanFotoBefund(KFS.ean, ANDERE), KFS.ean);
    expect(zweiteGleich.art).toBe('unsicher');
    expect(['abweichend', 'unsicher']).toContain(eanFotoMitVorbefund(zweiteGleich, vorher()).art);
  });
  it('heute eine BESTÄTIGTE Abweichung → ersetzt den alten Befund (stärkerer Beleg)', () => {
    const ab = eanFotoBestaetigen(eanFotoBefund(KFS.ean, ANDERE), ANDERE);
    expect(eanFotoMitVorbefund(ab, vorher({ befund: 'unsicher' }))).toBe(ab);
    // eine unbestätigte heutige ersetzt ihn nicht
    const unb = eanFotoBestaetigen(eanFotoBefund(KFS.ean, ANDERE), '');
    expect(eanFotoMitVorbefund(unb, vorher())).toMatchObject({ art: 'abweichend', gelesen: '4013602136424', vorbefund: expect.any(Object) });
  });
  it('eanFotoEintrag: was am Dokument landet — ganze Form, ohne Reste', () => {
    expect(eanFotoEintrag(eanFotoBefund(KFS.ean, KFS.ean))).toEqual({ ean: KFS.ean, befund: 'gleich' });
    expect(eanFotoEintrag(eanFotoBestaetigen(eanFotoBefund(KFS.ean, ANDERE), ANDERE))).toEqual({ ean: ANDERE, befund: 'abweichend', bestaetigt: true });
    expect(eanFotoEintrag(eanFotoBestaetigen(eanFotoBefund(KFS.ean, '4013602313647'), ''))).toEqual({ ean: '4013602313647', befund: 'unsicher', grund: 'zweite_lesung_leer', zweit: null });
    expect(eanFotoEintrag({ art: 'zweifelhaft', roh: '123', gespeichert: KFS.ean })).toMatchObject({ befund: 'unsicher', ean: '123' });
    // erste Lesung abweichend, zweite gespeichert (erster Tag) → unsicher, bleibt liegen
    expect(eanFotoEintrag(eanFotoBestaetigen(eanFotoBefund(KFS.ean, ANDERE), KFS.ean))).toMatchObject({ befund: 'unsicher', grund: 'erste_lesung_abweichend' });
    expect(eanFotoEintrag(eanFotoBefund(KFS.ean, ''))).toEqual({ ean: null, befund: 'kein_urteil', grund: 'nicht_lesbar' });
  });
});
