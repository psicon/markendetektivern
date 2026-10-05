'use strict';
/**
 * Bildschirmfotos als Preisbeleg (Patrick 04.10.2026: „ja, bau das") — reine
 * Funktionen aus src/preisBildschirm.js. Die Verdrahtung in der Runde prüft
 * __tests__/taeglicheRunde.test.js, die Entscheidung __tests__/fotoRundeRegeln.test.js.
 */
const {
  modusPreisBildschirm, schalterRohOf, preisQuelleOf, lesedienstBonOf, lesedienstOhneBonOf, bildKopf, bildschirmMerkmal, preisBildschirmBefund, preisBildschirmHalteGrund,
  preisBildschirmHinweis, preisBildschirmEintrag, preisBildschirmVorbefund, preisBildschirmMitVorbefund, preisBildschirmLage, modusPreisBeleg,
  PREIS_QUELLEN, KOPF_BYTES,
} = require('../src/preisBildschirm');
const { png, jpeg, EXIF } = require('./helpers/bildKopfDaten');

describe('Schalter preisBildschirmRegel und preisBelegRegel', () => {
  it('false = aus, true = scharf, sonst immer Beobachtung (auch Tippfehler) — für beide Schalter', () => {
    for (const modus of [modusPreisBildschirm, modusPreisBeleg]) {
      expect(modus(false)).toBe(false);
      expect(modus(true)).toBe(true);
      for (const v of ['shadow', undefined, null, 'true', 'ja', 1, 0, 'false']) expect(modus(v)).toBe('shadow');
    }
  });
  // Prüfrunde 2 (04.10.2026): ein unbekannter Wert darf nicht STILL als Beobachtung gelten.
  it('Rohwert für den Bericht: fehlt / gültig / unbekannt (mit Typ)', () => {
    expect(schalterRohOf(undefined)).toEqual({ art: 'fehlt', roh: null });
    expect(schalterRohOf(null)).toEqual({ art: 'fehlt', roh: null });
    for (const v of [true, false, 'shadow']) expect(schalterRohOf(v).art).toBe('gueltig');
    expect(schalterRohOf('true')).toEqual({ art: 'unbekannt', roh: '"true" (Text)' });
    expect(schalterRohOf(1)).toEqual({ art: 'unbekannt', roh: '1 (number)' });
    expect(schalterRohOf('x'.repeat(50)).roh).toHaveLength('"" (Text)'.length + 20);
  });
});

describe('Antwort der Bildprüfung', () => {
  it('nur die fünf bekannten Werte, sonst null', () => {
    expect(PREIS_QUELLEN).toEqual(['laden', 'kassenbon', 'bildschirm', 'keiner', 'unklar']);
    expect(preisQuelleOf(' Bildschirm ')).toBe('bildschirm');
    expect(preisQuelleOf('kassenbon')).toBe('kassenbon');
    for (const v of [null, undefined, '', 'screenshot', 'laden|kassenbon', 7]) expect(preisQuelleOf(v)).toBeNull();
  });
});

describe('Bildkopf ohne Bibliothek', () => {
  it('PNG: Maße aus IHDR, kein Hersteller', () => {
    expect(bildKopf(png(1080, 2400))).toEqual({ format: 'png', breite: 1080, hoehe: 2400, kameraHersteller: null, exifSpur: false });
  });
  it('JPEG: Maße aus SOF0, EXIF-Hersteller in beiden Byte-Reihenfolgen', () => {
    expect(bildKopf(jpeg(4000, 3000))).toEqual({ format: 'jpg', breite: 4000, hoehe: 3000, kameraHersteller: null, exifSpur: false });
    expect(bildKopf(jpeg(4000, 3000, { hersteller: 'samsung' })).kameraHersteller).toBe('samsung');
    expect(bildKopf(jpeg(3000, 4000, { hersteller: 'Apple', bigEndian: true })).kameraHersteller).toBe('Apple');
    // Hersteller mit höchstens 4 Zeichen steht direkt im Eintrag.
    expect(bildKopf(jpeg(4000, 3000, { hersteller: 'HMD' })).kameraHersteller).toBe('HMD');
  });
  it('SOF hinter großen APP-Abschnitten wird gefunden; fehlt er im gelesenen Stück → Maße unbekannt', () => {
    expect(bildKopf(jpeg(1080, 2400, { fuellBytes: 60000 }))).toMatchObject({ breite: 1080, hoehe: 2400 });
    expect(bildKopf(jpeg(1080, 2400, { hersteller: 'Xiaomi', bisSof: false }))).toEqual({ format: 'jpg', breite: null, hoehe: null, kameraHersteller: 'Xiaomi', exifSpur: false });
    expect(bildKopf(jpeg(1080, 2400).subarray(0, 10)).breite).toBeNull();
  });
  it('WebP, HEIC, Unsinn, leer → kein Absturz, Maße unbekannt', () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    const heic = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(8)]);
    expect(bildKopf(webp).format).toBe('webp');
    expect(bildKopf(heic).format).toBe('heic');
    expect(bildKopf(Buffer.from('kein bild, nur text')).format).toBe('unbekannt');
    expect(bildKopf(Buffer.alloc(0)).format).toBe('unbekannt');
    expect(bildKopf(null).format).toBe('unbekannt');
  });
  it('kaputter EXIF-Block → Hersteller null, Maße trotzdem', () => {
    const b = jpeg(4000, 3000, { hersteller: 'samsung' });
    b.write('XX', 2 + 4 + 6, 'ascii'); // Byte-Reihenfolge des TIFF-Kopfs zerstört
    expect(bildKopf(b)).toMatchObject({ breite: 4000, hoehe: 3000, kameraHersteller: null });
  });
  // Prüfrunde 2 (04.10.2026): Software oder Aufnahmedatum ohne Hersteller.
  // Ein bloßer EXIF-Block zählt NICHT — die App-Kamera auf iOS schreibt einen
  // Rest aus Ausrichtung, Auflösung und Pixelmaßen (49 von 294 Stichproben).
  it('EXIF-Spur: Software (IFD0) oder Aufnahmedatum (EXIF-Unterverzeichnis); der iOS-App-Kamera-Rest ist keine', () => {
    for (const bigEndian of [false, true]) {
      expect(bildKopf(jpeg(3024, 4032, { exif: EXIF.iosAppKamera, bigEndian }))).toMatchObject({ kameraHersteller: null, exifSpur: false });
      expect(bildKopf(jpeg(1200, 2152, { exif: EXIF.androidBildschirm, bigEndian }))).toMatchObject({ kameraHersteller: null, exifSpur: true });
      expect(bildKopf(jpeg(446, 248, { exif: EXIF.zugeschnitten, bigEndian }))).toMatchObject({ kameraHersteller: null, exifSpur: true });
      expect(bildKopf(jpeg(4000, 3000, { exif: EXIF.kamera, bigEndian }))).toMatchObject({ kameraHersteller: 'samsung', exifSpur: true });
    }
    // nur Datum im IFD0 (0x0132) ist keine Spur — gemessen wurde 0x9003/0x0131
    expect(bildKopf(jpeg(3024, 4032, { exif: { ifd0: [{ tag: 0x0132, text: '2026:10:04 08:00:00' }] } })).exifSpur).toBe(false);
    // PNG mit eXIf-Abschnitt
    expect(bildKopf(png(1080, 2400, { exif: EXIF.androidBildschirm }))).toMatchObject({ format: 'png', exifSpur: true, breite: 1080 });
  });
  it('EXIF-Zeiger ins Leere oder abgeschnittenes Unterverzeichnis → keine Spur, kein Absturz', () => {
    const b = jpeg(1200, 2152, { exif: EXIF.zugeschnitten });
    // Zeiger 0x8769 auf weit hinter das Ende
    const p = b.indexOf(Buffer.from([0x69, 0x87]));
    b.writeUInt32LE(0x7fffffff, p + 8);
    expect(bildKopf(b)).toMatchObject({ breite: 1200, hoehe: 2152, exifSpur: false });
  });
  it('liest genug: 192 KB', () => {
    expect(KOPF_BYTES).toBe(192 * 1024);
  });
});

describe('Bildmerkmale wie gemessen (analysen-0410/schirm.js, Klasse „schirm")', () => {
  it('Bildschirmfoto: PNG, oder Telefon-Format ohne Kamerahersteller', () => {
    expect(bildschirmMerkmal(bildKopf(png(1080, 2400)))).toBe(true);
    expect(bildschirmMerkmal(bildKopf(png(1200, 900)))).toBe(true); // PNG, auch im 4:3-Format
    expect(bildschirmMerkmal(bildKopf(jpeg(1080, 2400)))).toBe(true);
    expect(bildschirmMerkmal(bildKopf(jpeg(1170, 2532)))).toBe(true);
    expect(bildschirmMerkmal(bildKopf(jpeg(800, 800)))).toBe(true); // zugeschnitten, ohne Kamera
  });
  it('Kamerafoto: 4:3 oder 16:9 (App-Kamera ohne EXIF), oder mit Kamerahersteller', () => {
    expect(bildschirmMerkmal(bildKopf(jpeg(3000, 4000)))).toBe(false);
    expect(bildschirmMerkmal(bildKopf(jpeg(1080, 1440)))).toBe(false);
    expect(bildschirmMerkmal(bildKopf(jpeg(1920, 1080)))).toBe(false);
    expect(bildschirmMerkmal(bildKopf(jpeg(4000, 1848, { hersteller: 'samsung' })))).toBe(false); // Galerie 20:9
    expect(bildschirmMerkmal(bildKopf(jpeg(1000, 700, { hersteller: 'Apple' })))).toBe(false); // zugeschnitten mit Kamera
  });
  it('Toleranz ±0,012 wie in der Messung', () => {
    expect(bildschirmMerkmal({ format: 'jpg', breite: 1000, hoehe: 1340, kameraHersteller: null })).toBe(false); // 0,746
    expect(bildschirmMerkmal({ format: 'jpg', breite: 1000, hoehe: 1300, kameraHersteller: null })).toBe(true); // 0,769
  });
  // Prüfrunde 2 (04.10.2026): zwei bezahlte Bildschirmfotos lagen außerhalb
  // der gemessenen Klasse — Billa-Online-Shop 1200×2152 (≈ 16:9) und ein auf
  // den Preis zugeschnittener App-Ausschnitt 446×248 (16:9), beide mit
  // EXIF-Datum ohne Hersteller.
  it('EXIF-Spur ohne Hersteller → passt, auch im Kameraformat; mit Hersteller oder iOS-App-Kamera-Rest → nicht', () => {
    expect(bildschirmMerkmal(bildKopf(jpeg(1200, 2152, { exif: EXIF.androidBildschirm })))).toBe(true);
    expect(bildschirmMerkmal(bildKopf(jpeg(446, 248, { exif: EXIF.zugeschnitten })))).toBe(true);
    expect(bildschirmMerkmal(bildKopf(jpeg(2468, 1832, { exif: EXIF.zugeschnitten })))).toBe(true); // nachbearbeitetes Regalfoto: „laden" → nur liegen lassen
    expect(bildschirmMerkmal(bildKopf(jpeg(3024, 4032, { exif: EXIF.iosAppKamera })))).toBe(false);
    expect(bildschirmMerkmal(bildKopf(jpeg(3000, 4000, { exif: EXIF.kamera })))).toBe(false);
    expect(bildschirmMerkmal(bildKopf(jpeg(1080, 2400, { exif: EXIF.kamera })))).toBe(false);
    // Maße unbekannt bleibt unbekannt, auch mit Spur
    expect(bildschirmMerkmal(bildKopf(jpeg(1200, 2152, { exif: EXIF.androidBildschirm, bisSof: false })))).toBeNull();
  });
  it('Maße unbekannt → null (zählt nie als „passt")', () => {
    expect(bildschirmMerkmal(null)).toBeNull();
    expect(bildschirmMerkmal(bildKopf(jpeg(1080, 2400, { bisSof: false })))).toBeNull();
    expect(bildschirmMerkmal({ format: 'webp', breite: null, hoehe: null, kameraHersteller: null })).toBeNull();
  });
});

describe('Regel (Patrick 04.10.2026): Bildschirm UND Merkmale → ablehnen, nur eins → liegen lassen', () => {
  // Wie bei den gemessenen Bildschirmfotos: der Lesedienst las das Preisfoto
  // und sah keinen Bon (26× preisschild, 13× sonstiges von 40).
  const b = (quelle, merkmal) => preisBildschirmBefund({ quelle, merkmal, lesedienstOhneBon: true });
  it('bildschirm + Merkmale → ablehnen; ohne oder unbekannt → halten', () => {
    expect(b('bildschirm', true)).toBe('ablehnen');
    expect(b('bildschirm', false)).toBe('halten');
    expect(b('bildschirm', null)).toBe('halten');
  });
  // Prüfrunde 3 (04.10.2026): Erstlesung gescheitert, Nachlesung an 429 oder
  // Zeitgrenze gescheitert — dann fehlt das Gegenzeichen, das e-Bons schützt.
  it('bildschirm + Merkmale, aber der Lesedienst hat das Preisfoto NICHT gelesen → halten, nie ablehnen', () => {
    expect(preisBildschirmBefund({ quelle: 'bildschirm', merkmal: true })).toBe('halten');
    expect(preisBildschirmBefund({ quelle: 'bildschirm', merkmal: true, lesedienstOhneBon: false, lesedienstBon: false })).toBe('halten');
    expect(preisBildschirmHalteGrund({ quelle: 'bildschirm', merkmal: true })).toBe('preis_bildschirm_unsicher');
    // „gelesen, kein Bon" zählt nur ohne Bon-Zeichen
    expect(preisBildschirmBefund({ quelle: 'bildschirm', merkmal: true, lesedienstOhneBon: true, lesedienstBon: true })).toBe('halten');
  });
  it('laden mit Merkmalen → halten (zugeschnittenes Regalfoto oder doch Bildschirm); ohne → nichts', () => {
    expect(b('laden', true)).toBe('halten');
    expect(b('laden', false)).toBeNull();
    expect(b('laden', null)).toBeNull();
  });
  it('unklar → immer halten', () => {
    expect(b('unklar', true)).toBe('halten');
    expect(b('unklar', false)).toBe('halten');
    expect(b('unklar', null)).toBe('halten');
  });
  it('Kassenbon zählt immer — auch als Bildschirmfoto (e-Bon, App-Bon)', () => {
    expect(preisBildschirmBefund({ quelle: 'kassenbon', merkmal: true, lesedienstBon: true })).toBeNull();
    expect(preisBildschirmBefund({ quelle: 'kassenbon', merkmal: true })).toBeNull(); // Lesedienst sagte nichts
    expect(preisBildschirmBefund({ quelle: 'kassenbon', merkmal: false, lesedienstOhneBon: true })).toBeNull(); // Kamerafoto
  });
  // Prüfrunde 2 (04.10.2026): in der Richtung, in der bezahlt wird, braucht
  // „Kassenbon" ein Gegenzeichen, sobald die Datei wie ein Bildschirm aussieht.
  it('„Kassenbon" + Merkmale, der Lesedienst las das Foto und sah KEINEN Bon → liegen lassen', () => {
    const kb = (merkmal, e) => preisBildschirmBefund({ quelle: 'kassenbon', merkmal, ...e });
    expect(kb(true, { lesedienstOhneBon: true })).toBe('halten');
    expect(kb(false, { lesedienstOhneBon: true })).toBeNull(); // Kamerafoto eines Papierbons
    // Prüfrunde 3: ohne abrufbaren Kopf gibt die Regel auch einen „Kassenbon" nicht frei, dem der Lesedienst widerspricht
    expect(kb(null, { lesedienstOhneBon: true, kopfGescheitert: true })).toBe('halten');
    expect(preisBildschirmHalteGrund({ quelle: 'kassenbon', merkmal: null, kopfGescheitert: true, lesedienstOhneBon: true })).toBe('preis_kopf_nicht_lesbar');
    expect(kb(null, { lesedienstOhneBon: false, kopfGescheitert: true })).toBeNull(); // Lesedienst sagte nichts
    expect(kb(null, { lesedienstOhneBon: true, lesedienstBon: true, kopfGescheitert: true })).toBeNull();
    expect(kb(null, { lesedienstOhneBon: true })).toBeNull(); // Kopf gelesen, nur keine Maße (WebP/HEIC)
    expect(kb(true, { lesedienstOhneBon: false })).toBeNull(); // Lesedienst sagte nichts
    expect(kb(true, { lesedienstOhneBon: true, lesedienstBon: true })).toBeNull(); // eine Lesung sah doch einen Bon
    expect(preisBildschirmHalteGrund({ quelle: 'kassenbon', merkmal: true, lesedienstOhneBon: true })).toBe('preis_bildschirm_unsicher');
  });
  // Prüfrunde 3 (04.10.2026): las der Lesedienst trotzdem einen Preis, wäre die
  // Preis-Pflicht erfüllt und es würde bezahlt — wie eine fehlende Antwort.
  it('„keiner" mit Merkmalen → halten (wie fehlende Antwort); ohne Merkmale → nichts (Preis-Pflicht)', () => {
    expect(b('keiner', true)).toBe('halten');
    expect(b('keiner', false)).toBeNull();
    expect(b('keiner', null)).toBeNull();
  });
  it('Antwort fehlt: mit Merkmalen halten (kein Freispruch), sonst nichts', () => {
    expect(b(null, true)).toBe('halten');
    expect(b('screenshot', true)).toBe('halten');
    expect(b(null, false)).toBeNull();
    expect(b(null, null)).toBeNull();
    expect(preisBildschirmBefund()).toBeNull();
  });

  // Gegenprüfung 04.10.2026: e-Bons tragen die Merkmale immer — ohne zweites
  // Zeichen hinge ihr Schutz an einer einzigen Modellantwort.
  it('Lesedienst sah einen Kassenbon → „Bildschirm" wird nie abgelehnt, nur gehalten', () => {
    const mitBon = (quelle, merkmal) => preisBildschirmBefund({ quelle, merkmal, lesedienstBon: true });
    expect(mitBon('bildschirm', true)).toBe('halten');
    expect(mitBon('bildschirm', false)).toBe('halten');
    expect(mitBon('kassenbon', true)).toBeNull();
    expect(mitBon('laden', false)).toBeNull();
    expect(mitBon('laden', true)).toBe('halten');
  });
  it('Kopf des Preisfotos nicht abrufbar (Technik) → keine Freigabe: „laden" und fehlende Antwort halten', () => {
    const ohneKopf = (quelle) => preisBildschirmBefund({ quelle, merkmal: null, kopfGescheitert: true });
    expect(ohneKopf('laden')).toBe('halten');
    expect(ohneKopf(null)).toBe('halten');
    expect(ohneKopf('bildschirm')).toBe('halten'); // nie ablehnen ohne Merkmale
    expect(ohneKopf('kassenbon')).toBeNull(); // Lesedienst sagte nichts
    expect(ohneKopf('keiner')).toBe('halten');
    // Kopf gelesen, nur kein auswertbares Format (WebP, HEIC) → kein Technikfehler
    expect(preisBildschirmBefund({ quelle: 'laden', merkmal: null, kopfGescheitert: false })).toBeNull();
  });
  it('Halte-Grund: nur der fehlende Kopf → preis_kopf_nicht_lesbar, sonst preis_bildschirm_unsicher', () => {
    expect(preisBildschirmHalteGrund({ quelle: 'laden', merkmal: null, kopfGescheitert: true })).toBe('preis_kopf_nicht_lesbar');
    expect(preisBildschirmHalteGrund({ quelle: null, merkmal: null, kopfGescheitert: true })).toBe('preis_kopf_nicht_lesbar');
    expect(preisBildschirmHalteGrund({ quelle: 'bildschirm', merkmal: null, kopfGescheitert: true })).toBe('preis_bildschirm_unsicher');
    expect(preisBildschirmHalteGrund({ quelle: 'laden', merkmal: true })).toBe('preis_bildschirm_unsicher');
    expect(preisBildschirmHalteGrund({ quelle: 'laden', merkmal: null, kopfGescheitert: true, vorbefund: { seit: 'L1' } })).toBe('preis_bildschirm_unsicher');
    expect(preisBildschirmHalteGrund({ quelle: 'keiner', merkmal: null, kopfGescheitert: true })).toBe('preis_kopf_nicht_lesbar');
    expect(preisBildschirmHalteGrund({ quelle: 'unklar', merkmal: null, kopfGescheitert: true })).toBe('preis_bildschirm_unsicher');
  });
});

describe('Gegenzeichen des Lesedienstes (lesedienstBonOf)', () => {
  it('Kassenbon/beides oder eine gelesene Bon-Kopfzeile → ja', () => {
    expect(lesedienstBonOf({ priceImageKind: 'kassenbon' })).toBe(true);
    expect(lesedienstBonOf({ priceImageKind: ' Beides ' })).toBe(true);
    expect(lesedienstBonOf({ priceReceipt: { zip: '10115' } })).toBe(true);
    expect(lesedienstBonOf({ priceReceipt: { merchant: 'Lidl' } })).toBe(true);
    expect(lesedienstBonOf({ priceImageKind: 'sonstiges', priceRescueOcr: { priceImageKind: 'kassenbon' } })).toBe(true);
    // Prüfrunde 2: die Nachlesung ergänzt, sie ersetzt nicht
    expect(lesedienstBonOf({ priceImageKind: 'kassenbon', priceRescueOcr: { priceImageKind: 'preisschild' } })).toBe(true);
  });
  it('Lesedienst las das Foto und sah KEINEN Bon (preisschild/produktfoto/sonstiges) — nicht bei fehlt/unklar/nichts', () => {
    for (const art of ['preisschild', 'produktfoto', ' Sonstiges ']) expect(lesedienstOhneBonOf({ priceImageKind: art })).toBe(true);
    expect(lesedienstOhneBonOf({ priceRescueOcr: { priceImageKind: 'preisschild' } })).toBe(true);
    for (const x of [{ priceImageKind: 'fehlt' }, { priceImageKind: 'unklar' }, {}, null]) expect(lesedienstOhneBonOf(x)).toBe(false);
    // ein Bon-Zeichen geht immer vor
    expect(lesedienstOhneBonOf({ priceImageKind: 'preisschild', priceRescueOcr: { priceImageKind: 'kassenbon' } })).toBe(false);
    expect(lesedienstOhneBonOf({ priceImageKind: 'sonstiges', priceReceipt: { zip: '10115' } })).toBe(false);
  });
  // Prüfrunde 3 (04.10.2026): die Nachlesung des Laufs las verschiedene Preise —
  // ihre Bildart steht nicht am Dokument, ein Bon-Zeichen darin zählt trotzdem.
  it('Bildarten einer ungeeinten Nachlesung: ein Bon darin ist ein Gegenzeichen, sonst zählen sie nicht', () => {
    expect(lesedienstBonOf({ priceImageKind: 'preisschild' }, ['kassenbon', 'preisschild'])).toBe(true);
    expect(lesedienstBonOf({}, [' Beides '])).toBe(true);
    expect(lesedienstBonOf(null, ['kassenbon'])).toBe(true);
    expect(lesedienstOhneBonOf({ priceImageKind: 'preisschild' }, ['kassenbon'])).toBe(false);
    // nur in diese Richtung: ungeeinte „preisschild"-Lesungen machen nichts ablehnbar
    expect(lesedienstBonOf({}, ['preisschild', 'sonstiges'])).toBe(false);
    expect(lesedienstOhneBonOf({}, ['preisschild', 'preisschild'])).toBe(false);
    expect(lesedienstBonOf({ priceImageKind: 'sonstiges' }, 'kassenbon')).toBe(false); // kein Array → ignoriert
  });
  it('„preisschild" zählt NICHT (so hielt der Lesedienst 26 von 40 Bildschirmfotos), leer/kaputt → nein', () => {
    expect(lesedienstBonOf({ priceImageKind: 'preisschild' })).toBe(false);
    expect(lesedienstBonOf({ priceImageKind: 'sonstiges', priceReceipt: {} })).toBe(false);
    expect(lesedienstBonOf({ priceReceipt: 'Lidl' })).toBe(false);
    expect(lesedienstBonOf({})).toBe(false);
    expect(lesedienstBonOf(null)).toBe(false);
  });
});

describe('Befund eines früheren scharfen Laufs (Gegenprüfung 04.10.2026)', () => {
  const ro = (pb, lauf = 'L1') => ({ review: { rundeOffen: { grund: 'preis_bildschirm_unsicher', lauf, preisBildschirm: pb } } });
  it('nur scharfe Befunde zählen; seit aus dem Eintrag, sonst Lauf', () => {
    expect(preisBildschirmVorbefund(ro({ modus: true, befund: 'halten', seit: 'L0' }))).toEqual({ befund: 'halten', seit: 'L0', regeln: ['bildschirm'] });
    expect(preisBildschirmVorbefund(ro({ modus: true, befund: 'ablehnen' }))).toEqual({ befund: 'ablehnen', seit: 'L1', regeln: ['bildschirm'] });
    expect(preisBildschirmVorbefund(ro({ modus: 'shadow', befund: 'halten' }))).toBeNull();
    expect(preisBildschirmVorbefund(ro({ modus: true, befund: null }))).toBeNull();
    expect(preisBildschirmVorbefund({ review: { rundeOffen: { grund: 'x' } } })).toBeNull();
    expect(preisBildschirmVorbefund({})).toBeNull();
  });
  // Eingabe der Runde: Antwort „laden", Kamerafoto → kein Befund; mit
  // `schirm` eine Ablehn-Lesung (Bildschirm + Merkmale + Lesedienst ohne Bon).
  const heute = (art = null, extra = {}) => ({
    modus: true, belegModus: true, quelle: art === 'ablehnen' ? 'bildschirm' : 'laden', merkmal: art === 'ablehnen', lesedienstOhneBon: art === 'ablehnen', ...extra,
  });
  const vorher = { befund: 'halten', seit: 'L1', regeln: ['bildschirm'] };
  const BEIDE = { bildschirm: true, beleg: true };
  it('heute anders gelesen oder keine Bildprüfung → hält weiter (nie automatisch frei)', () => {
    expect(preisBildschirmMitVorbefund(heute(), vorher, BEIDE)).toMatchObject({ modus: true, befund: 'halten', vorbefund: { seit: 'L1', regeln: ['bildschirm'] }, heute: null });
    expect(preisBildschirmMitVorbefund(null, vorher, BEIDE)).toMatchObject({ modus: true, belegModus: true, befund: 'halten', vorbefund: { seit: 'L1' }, quelle: null });
  });
  it('ein zurückgehaltener Ablehn-Befund wird morgen ohne neue Lesung nur noch gehalten', () => {
    expect(preisBildschirmMitVorbefund(heute(), { befund: 'ablehnen', seit: 'L1', regeln: ['bildschirm'] }, BEIDE)).toMatchObject({ befund: 'halten' });
  });
  // Prüfrunde 3 (04.10.2026): ein liegender Fall wird nicht jeden Morgen neu
  // ausgewürfelt — die widersprechende Antwort des Vortags steht nicht am Dokument.
  it('Vorbefund „halten" + heute „ablehnen" → bleibt liegen (nur ein Mensch entscheidet)', () => {
    const v = preisBildschirmMitVorbefund(heute('ablehnen'), vorher, BEIDE);
    expect(v).toMatchObject({ befund: 'halten', vorbefund: { befund: 'halten', seit: 'L1' }, heute: 'ablehnen' });
    expect(preisBildschirmLage(v, { scharf: true })).toMatchObject({ befund: 'halten', regeln: ['bildschirm'] });
  });
  it('Vorbefund „ablehnen" (von der Notbremse zurückgehalten) + heute „ablehnen" → gilt', () => {
    const v = preisBildschirmMitVorbefund(heute('ablehnen'), { befund: 'ablehnen', seit: 'L1', regeln: ['bildschirm'] }, BEIDE);
    expect(v).toMatchObject({ vorbefundSeit: 'L1' });
    expect(preisBildschirmLage(v, { scharf: true })).toMatchObject({ befund: 'ablehnen' });
  });
  it('Schalter beider Regeln aus → nichts; Beobachtung → Befund reist nur mit (hält nichts, siehe preisBildschirmLage)', () => {
    expect(preisBildschirmMitVorbefund(heute(), vorher, { bildschirm: false, beleg: false })).toBeNull();
    const beob = preisBildschirmMitVorbefund(heute(), vorher, { bildschirm: 'shadow', beleg: 'shadow' });
    expect(beob).toMatchObject({ modus: 'shadow', belegModus: 'shadow', befund: 'halten' });
    expect(preisBildschirmLage(beob, { scharf: true }).befund).toBeNull();
    expect(preisBildschirmMitVorbefund(heute(), null, BEIDE)).toEqual(heute());
    expect(preisBildschirmMitVorbefund(null, null, BEIDE)).toBeNull();
  });
  it('ohne Schalter je Regel → Programmierfehler, kein stilles Raten', () => {
    expect(() => preisBildschirmMitVorbefund(heute(), vorher, true)).toThrow(TypeError);
  });
});

// Nachprüfung 05.10.2026: hingen Bildschirm-Regel und Preisbeleg an EINEM
// Schalter, gab das Zurücknehmen des Preisbelegs am nächsten Morgen auch jedes
// angehaltene Bildschirmfoto frei — ohne dass ein Mensch es gesehen hatte.
describe('Zwei Schalter: jede Regel hält nur unter ihrem eigenen', () => {
  const ro = (pb) => ({ review: { rundeOffen: { lauf: 'L1', preisBildschirm: pb } } });
  // Kamerafoto „laden" heute: keine neue Lesung, nur der Vorbefund kann halten.
  const heute = (modi) => ({ modus: modi.bildschirm, belegModus: modi.beleg, quelle: 'laden', merkmal: false });
  const morgen = (eintrag, modi) => preisBildschirmLage(preisBildschirmMitVorbefund(heute(modi), preisBildschirmVorbefund(ro(eintrag)), modi), { scharf: true });
  const schirmHalt = { modus: true, befund: 'halten', seit: 'L1', regeln: ['bildschirm'] };
  const schirmAblehnen = { modus: true, befund: 'ablehnen', seit: 'L1', regeln: ['bildschirm'] };
  const belegHalt = { modus: true, befund: 'halten', seit: 'L1', regeln: ['beleg'], art: 'beleg' };
  const beideHalt = { modus: true, befund: 'halten', seit: 'L1', regeln: ['bildschirm', 'beleg'] };

  it('Preisbeleg zurückgenommen (shadow oder false) → Bildschirm-Halte und zurückgehaltene Ablehnungen bleiben liegen', () => {
    for (const beleg of ['shadow', false]) {
      expect(morgen(schirmHalt, { bildschirm: true, beleg })).toMatchObject({ befund: 'halten', grund: 'preis_bildschirm_unsicher', regeln: ['bildschirm'] });
      expect(morgen(schirmAblehnen, { bildschirm: true, beleg })).toMatchObject({ befund: 'halten', regeln: ['bildschirm'] });
    }
  });
  it('Bildschirm-Regel zurückgenommen → Preisbeleg-Halte bleiben liegen', () => {
    for (const bildschirm of ['shadow', false]) {
      expect(morgen(belegHalt, { bildschirm, beleg: true })).toMatchObject({ befund: 'halten', grund: 'preis_beleg_unsicher', regeln: ['beleg'] });
    }
  });
  it('ein Fall, den beide Regeln halten, bleibt liegen, solange eine der beiden scharf ist', () => {
    expect(morgen(beideHalt, { bildschirm: 'shadow', beleg: true })).toMatchObject({ befund: 'halten', grund: 'preis_beleg_unsicher', regeln: ['beleg'] });
    expect(morgen(beideHalt, { bildschirm: true, beleg: false })).toMatchObject({ befund: 'halten', grund: 'preis_bildschirm_unsicher', regeln: ['bildschirm'] });
    expect(morgen(beideHalt, { bildschirm: 'shadow', beleg: 'shadow' }).befund).toBeNull();
  });
  it('die EIGENE Regel zurückgenommen → ihr Halt endet (dokumentierter Rückweg, WISSEN-FOTORUNDE.md)', () => {
    expect(morgen(schirmHalt, { bildschirm: 'shadow', beleg: true }).befund).toBeNull();
    expect(morgen(schirmAblehnen, { bildschirm: false, beleg: true }).befund).toBeNull();
    expect(morgen(belegHalt, { bildschirm: true, beleg: 'shadow' }).befund).toBeNull();
  });
  it('ältere Einträge ohne `regeln`: `art: beleg` = Preisbeleg, sonst Bildschirm-Regel; „ablehnen" immer Bildschirm-Regel', () => {
    const { regeln: _r1, ...schirmAlt } = schirmHalt;
    const { regeln: _r2, ...belegAlt } = belegHalt;
    expect(preisBildschirmVorbefund(ro(schirmAlt)).regeln).toEqual(['bildschirm']);
    expect(preisBildschirmVorbefund(ro(belegAlt)).regeln).toEqual(['beleg']);
    expect(preisBildschirmVorbefund(ro({ modus: true, befund: 'ablehnen', regeln: ['beleg'], art: 'beleg' })).regeln).toEqual(['bildschirm']);
    expect(morgen(belegAlt, { bildschirm: 'shadow', beleg: true })).toMatchObject({ befund: 'halten', regeln: ['beleg'] });
    expect(morgen(schirmAlt, { bildschirm: true, beleg: 'shadow' })).toMatchObject({ befund: 'halten', regeln: ['bildschirm'] });
  });
  it('heute: jede Regel wirkt nur unter ihrem Schalter, beobachtet wird jede, die nicht aus ist', () => {
    const korb = { quelle: 'kassenbon', merkmal: false, lesedienstBon: true, belegGrund: 'ohne_merkmale' };
    const schirm = { quelle: 'bildschirm', merkmal: true, lesedienstOhneBon: true, belegGrund: null };
    expect(preisBildschirmLage({ ...korb, modus: true, belegModus: 'shadow' }, { scharf: true }).befund).toBeNull();
    expect(preisBildschirmLage({ ...korb, modus: true, belegModus: 'shadow' })).toMatchObject({ befund: 'halten', grund: 'preis_beleg_unsicher' });
    expect(preisBildschirmLage({ ...korb, modus: 'shadow', belegModus: true }, { scharf: true })).toMatchObject({ befund: 'halten', regeln: ['beleg'] });
    expect(preisBildschirmLage({ ...korb, modus: true, belegModus: false }).befund).toBeNull();
    expect(preisBildschirmLage({ ...schirm, modus: 'shadow', belegModus: true }, { scharf: true }).befund).toBeNull();
    expect(preisBildschirmLage({ ...schirm, modus: true, belegModus: false }, { scharf: true })).toMatchObject({ befund: 'ablehnen', regeln: ['bildschirm'] });
    expect(preisBildschirmLage({ ...schirm, modus: false, belegModus: true }).befund).toBeNull();
    // fehlt belegModus, gilt Beobachtung — der Schalter der Bildschirm-Regel schaltet den Preisbeleg nie mit
    expect(preisBildschirmLage({ ...korb, modus: true }, { scharf: true }).befund).toBeNull();
  });
  it('Eintrag: `regeln` nur mit scharfem Befund; ein Kassenbon, den beide Regeln halten, trägt beide', () => {
    const beide = { modus: true, belegModus: true, quelle: 'kassenbon', merkmal: true, lesedienstOhneBon: true, belegGrund: 'fremder_haendler' };
    expect(preisBildschirmEintrag(beide, { lauf: 'L2' })).toEqual({ modus: true, befund: 'halten', seit: 'L2', regeln: ['bildschirm', 'beleg'] });
    // Bildschirm-Regel nur beobachtet: es wirkt nur der Preisbeleg
    expect(preisBildschirmEintrag({ ...beide, modus: 'shadow' }, { lauf: 'L2' })).toEqual({ modus: true, befund: 'halten', seit: 'L2', regeln: ['beleg'], art: 'beleg' });
    // nichts scharf → Beobachtungs-Eintrag, wird nie übernommen
    const beob = preisBildschirmEintrag({ ...beide, modus: 'shadow', belegModus: 'shadow' }, { lauf: 'L2' });
    expect(beob).toEqual({ modus: 'shadow', befund: 'halten', seit: 'L2' });
    expect(preisBildschirmVorbefund(ro(beob))).toBeNull();
  });
});

describe('Hinweis und Eintrag am Dokument (der Einreicher liest sein Dokument — Gegenprüfung 04.10.2026)', () => {
  const VERRAET = /kamera|format|png|jpg|exif|seitenverh|merkmal|statusleiste|warenkorb|4:3|16:9/i;
  it('Hinweis: nur das Urteil, nie woran es hängt (Datei, Begründung des Modells)', () => {
    const faelle = [
      { quelle: 'bildschirm', merkmal: true, lesedienstOhneBon: true, grund: 'Statusleiste, Warenkorb-Knopf', befund: 'ablehnen' },
      { quelle: 'laden', merkmal: true, grund: 'Regal, Preisschild', befund: 'halten' },
      { quelle: 'bildschirm', merkmal: false, grund: 'Statusleiste', befund: 'halten' },
      { quelle: 'laden', merkmal: null, kopfGescheitert: true, befund: 'halten' },
      { quelle: null, merkmal: true, befund: 'halten', vorbefund: { seit: '2026-10-05_08:00' } },
    ];
    for (const f of faelle) expect(preisBildschirmHinweis(f)).not.toMatch(VERRAET);
    expect(preisBildschirmHinweis(faelle[0])).toMatch(/zeigt einen Bildschirm/);
    expect(preisBildschirmHinweis(faelle[1])).toMatch(/vielleicht ein Bildschirmfoto/);
    expect(preisBildschirmHinweis(faelle[3])).toMatch(/nicht abrufbar \(Technik\)/);
    expect(preisBildschirmHinweis(faelle[4])).toMatch(/Befund vom 2026-10-05_08:00, gilt bis zur Entscheidung/);
  });
  it('Eintrag: nur Modus, Befund und seit — ohne Antwort, Begründung, Merkmal, Datei', () => {
    const e = preisBildschirmEintrag({
      modus: true, quelle: 'bildschirm', grund: 'Statusleiste', merkmal: true, lesedienstBon: false, lesedienstOhneBon: true, befund: 'ablehnen',
      kopf: { format: 'png', breite: 1080, hoehe: 2400, kameraHersteller: null }, kopfFehler: null,
    }, { lauf: 'L2' });
    expect(e).toEqual({ modus: true, befund: 'ablehnen', seit: 'L2', regeln: ['bildschirm'] });
    expect(JSON.stringify(e)).not.toMatch(VERRAET);
    // ein übernommener Befund behält seinen ersten Lauf
    expect(preisBildschirmEintrag({ modus: true, befund: 'halten', vorbefund: { befund: 'halten', seit: 'L1', regeln: ['bildschirm'] } }, { lauf: 'L2' }))
      .toEqual({ modus: true, befund: 'halten', seit: 'L1', regeln: ['bildschirm'] });
    // unbekannter Schalterwert = Beobachtung
    expect(preisBildschirmEintrag({ modus: 'irgendwas', quelle: 'laden', merkmal: true, befund: 'halten' }, {})).toEqual({ modus: 'shadow', befund: 'halten', seit: null });
    // ein gespeicherter Gesamtbefund zählt nicht — nur, was die Felder hergeben
    expect(preisBildschirmEintrag({ modus: true, befund: 'loeschen' })).toBeNull();
    expect(preisBildschirmEintrag({ modus: true, befund: 'halten' })).toBeNull();
    expect(preisBildschirmEintrag({ modus: true, befund: null })).toBeNull();
    expect(preisBildschirmEintrag(null)).toBeNull();
  });
  it('ein Halt nur wegen des nicht abrufbaren Bildkopfs ist kein Befund über das Foto → kein Eintrag (wird morgen neu geprüft)', () => {
    expect(preisBildschirmEintrag({ modus: true, quelle: 'laden', merkmal: null, kopfGescheitert: true, befund: 'halten' }, { lauf: 'L' })).toBeNull();
    expect(preisBildschirmEintrag({ modus: true, quelle: 'bildschirm', merkmal: null, kopfGescheitert: true, befund: 'halten' }, { lauf: 'L' }))
      .toEqual({ modus: true, befund: 'halten', seit: 'L', regeln: ['bildschirm'] });
  });
});

/* ───────── Preisbeleg „Kassenbon" (Entscheidung Claude im Auftrag Patricks, 04.10.2026) ───────── */
describe('Preisbeleg: Antworten der Bildprüfung', () => {
  const { belegMerkmaleOf, belegHaendlerOf, lesedienstKopfOf, BELEG_MERKMALE } = require('../src/preisBildschirm');
  it('belegMerkmale: bekannte Werte ohne Doppel; leere Liste ist eine Antwort; sonst null', () => {
    expect(BELEG_MERKMALE).toEqual(['haendler', 'datum', 'summe', 'nummer', 'zahlung', 'steuer']);
    expect(belegMerkmaleOf(['Haendler', 'summe', 'summe'])).toEqual(['haendler', 'summe']);
    // die Vorlage in der Anweisung trennt mit | — so zurückgegeben wird zerlegt
    expect(belegMerkmaleOf(['haendler|steuer'])).toEqual(['haendler', 'steuer']);
    expect(belegMerkmaleOf([])).toEqual([]);
    expect(belegMerkmaleOf(['steuer', 'logo'])).toEqual(['steuer']);
    // nur Unbekanntes, oder gar keine Liste → keine verwertbare Antwort
    for (const v of [['ja'], 'haendler', null, undefined, {}, 3]) expect(belegMerkmaleOf(v)).toBeNull();
  });
  it('belegHaendler: Name oder null (leer, „unbekannt", „nicht erkennbar", Strich)', () => {
    expect(belegHaendlerOf('  Amazon ')).toBe('Amazon');
    for (const v of ['', ' ', '-', '…', 'unbekannt', 'Nicht erkennbar', 'keiner', 'n/a', null, 7]) expect(belegHaendlerOf(v)).toBeNull();
    expect(belegHaendlerOf('x'.repeat(100))).toHaveLength(60);
  });
  it('Händlerkopf des Lesedienstes: Name oder Anschrift in priceReceipt', () => {
    expect(lesedienstKopfOf({ priceReceipt: { merchant: 'REWE' } })).toBe(true);
    expect(lesedienstKopfOf({ priceReceipt: { zip: '44534' } })).toBe(true);
    expect(lesedienstKopfOf({ priceReceipt: { bonDate: '2026-10-01' } })).toBe(false);
    expect(lesedienstKopfOf({ priceImageKind: 'kassenbon' })).toBe(false);
    expect(lesedienstKopfOf(null)).toBe(false);
  });
});

describe('Preisbeleg: ist der Händler einer unserer Märkte?', () => {
  const { unserMarkt, marktSchluessel } = require('../src/preisBildschirm');
  // Namen der Collection `discounter` am 05.10.2026.
  const NAMEN = ['Aldi Nord', 'GLOBUS', 'EDEKA', 'Müller', 'LiDL', 'Rossmann', 'Aldi Suisse', 'HOFER', 'Kaufland', 'Spar', 'REWE', 'Aldi Süd', 'dm', 'Penny', 'Norma', 'Netto Markendiscount', 'Billa'];
  const S = marktSchluessel(NAMEN);
  it('unsere Märkte, auch Online, Vertriebslinien und Schreibweisen der Bon-Köpfe', () => {
    for (const n of ['REWE', 'R E W E', 'REWE Lieferservice', 'Netto Marken-Discount', 'netto filiale 7978', 'dm-drogerie markt', 'Dirk Rossmann GmbH', 'Müller', 'Mueller',
      'ALDI SÜD', 'Hofer KG', 'penny-markt gmbh', 'Kaufland.de', 'Lidl Plus', 'E center', 'E-Center Breil', 'EDEKA Center', 'Edekamarkt', 'Marktkauf Nientied', 'nahkauf', 'nah & gut', 'diska Freiberg', 'EUROSPAR', 'Billa']) {
      expect([n, unserMarkt(n, S)]).toEqual([n, true]);
    }
  });
  it('fremde Händler — und keine Teilwort-Treffer, keine Tippfehler-Toleranz', () => {
    for (const n of ['Amazon', 'Amazon EU S.à r.l., Niederlassung Deutschland', 'TK Maxx', 'Wreesmann Sonderpostenmarkt', 'Picnic', 'HIT', 'tegut',
      'Sparkasse', 'Admiral', 'Das', 'denns BioMarkt', 'Krummenerl', 'NK Südfilialen GmbH']) {
      expect([n, unserMarkt(n, S)]).toEqual([n, false]);
    }
    expect(unserMarkt('', S)).toBeNull();
    expect(unserMarkt('  ', S)).toBeNull();
  });
  it('ein neuer Markt in `discounter` gilt ohne Codeänderung; ohne lesbare Liste die festen Ketten', () => {
    expect(unserMarkt('Picnic', marktSchluessel([...NAMEN, 'Picnic']))).toBe(true);
    expect(unserMarkt('Picnic', marktSchluessel(null))).toBe(false);
    expect(unserMarkt('Netto', marktSchluessel(null))).toBe(true);
  });
});

describe('Preisbeleg: Befund (nur bei „kassenbon")', () => {
  const { preisBelegBefund, marktSchluessel } = require('../src/preisBildschirm');
  const S = marktSchluessel(['REWE', 'EDEKA', 'Kaufland', 'dm', 'Netto Markendiscount']);
  const VOLL = ['haendler', 'datum', 'summe', 'nummer', 'zahlung', 'steuer'];
  const bef = (e) => preisBelegBefund({ quelle: 'kassenbon', merkmale: VOLL, haendler: 'REWE', lesedienstKopf: false, lesedienstHaendler: null, schluessel: S, ...e });
  it('andere Antworten als „kassenbon" → nichts', () => {
    for (const q of ['laden', 'bildschirm', 'keiner', 'unklar', null]) expect(bef({ quelle: q, merkmale: [], haendler: 'Amazon' }).grund).toBeNull();
  });
  it('Warenkorb-Lücke: kein Kassenbon-Merkmal laut Bildprüfung UND kein Händlerkopf des Lesedienstes → ohne_merkmale', () => {
    expect(bef({ merkmale: [], haendler: null })).toMatchObject({ grund: 'ohne_merkmale', ohneMerkmale: true, fremd: false });
    // keine verwertbare Antwort ist kein Freispruch
    expect(bef({ merkmale: null, haendler: null }).grund).toBe('ohne_merkmale');
    // ein Merkmal genügt — auch nur die Steuer-Kennzeichen eines zugeschnittenen Bons
    for (const m of VOLL) expect(bef({ merkmale: [m] }).grund).toBeNull();
    // ein Händlerkopf des Lesedienstes genügt (kein echter Bon hängt an EINER Modellantwort)
    expect(bef({ merkmale: [], lesedienstKopf: true }).grund).toBeNull();
    expect(bef({ merkmale: null, lesedienstKopf: true }).grund).toBeNull();
  });
  it('eine genannte Kette allein ist KEIN Merkmal (das Modell kann sie aus dem Produkt erschließen)', () => {
    expect(bef({ merkmale: [], haendler: 'Kaufland' }).grund).toBe('ohne_merkmale');
  });
  it('fremder Händler: die Bildprüfung nennt einen, und kein Name löst auf einen unserer Märkte auf', () => {
    expect(bef({ haendler: 'Amazon', lesedienstHaendler: 'Amazon EU S.à r.l.', lesedienstKopf: true })).toMatchObject({ grund: 'fremder_haendler', fremd: true, unser: false });
    expect(bef({ haendler: 'Wreesmann' }).grund).toBe('fremder_haendler');
    // fremd geht vor „ohne Merkmale"
    expect(bef({ haendler: 'Amazon', merkmale: [] })).toMatchObject({ grund: 'fremder_haendler', ohneMerkmale: true });
    // nennt die Bildprüfung keinen, zählt der Filialname des Lesedienstes (TK Maxx, gemessen 05.10.)
    expect(bef({ haendler: '', lesedienstHaendler: 'TK Maxx', lesedienstKopf: true }).grund).toBe('fremder_haendler');
  });
  it('unsere Märkte gelten — auch online und mit Inhaber-Namen im Bon-Kopf, wenn ein Name auflöst', () => {
    expect(bef({ haendler: 'dm', lesedienstHaendler: 'dm.de' }).grund).toBeNull();
    expect(bef({ haendler: 'REWE', lesedienstHaendler: 'Krummenerl EH OHG', lesedienstKopf: true })).toMatchObject({ grund: null, unser: true });
    expect(bef({ haendler: 'EDEKA', lesedienstHaendler: 'NK Südfilialen GmbH', lesedienstKopf: true }).grund).toBeNull();
    // widersprechen sich die Namen, genügt der eine, der auflöst (die mildere Richtung)
    expect(bef({ haendler: 'Amazon', lesedienstHaendler: 'REWE Markt GmbH', lesedienstKopf: true }).grund).toBeNull();
    // kein Name → kein Urteil über den Händler
    expect(bef({ haendler: null, lesedienstHaendler: null })).toMatchObject({ grund: null, unser: null });
  });
  it('bekannte Grenze: ein Bon ohne Kettenlogo mit Inhabernamen gilt als fremd (gemessen 5 von 23, ein REWE-Markt) — liegt nur', () => {
    expect(bef({ haendler: 'Krummenerl', lesedienstHaendler: 'Krummenerl', lesedienstKopf: true }).grund).toBe('fremder_haendler');
  });
});

describe('Preisbeleg in der Regel: nur liegen lassen, nie ablehnen', () => {
  const { PREIS_BELEG_UNSICHER, PREIS_BILDSCHIRM_UNSICHER, PREIS_KOPF_NICHT_LESBAR } = require('../src/preisBildschirm');
  it('„kassenbon" mit Beleg-Befund → halten; ohne → wie bisher', () => {
    for (const g of ['ohne_merkmale', 'fremder_haendler']) {
      expect(preisBildschirmBefund({ quelle: 'kassenbon', merkmal: false, belegGrund: g })).toBe('halten');
      expect(preisBildschirmBefund({ quelle: 'kassenbon', merkmal: true, lesedienstOhneBon: true, belegGrund: g })).toBe('halten');
    }
    expect(preisBildschirmBefund({ quelle: 'kassenbon', merkmal: false, belegGrund: null })).toBeNull();
    expect(preisBildschirmBefund({ quelle: 'kassenbon', merkmal: false, belegGrund: 'irgendwas' })).toBeNull();
    // andere Antworten: der Beleg-Befund ändert nichts (es gibt ihn dort nicht)
    expect(preisBildschirmBefund({ quelle: 'bildschirm', merkmal: true, lesedienstOhneBon: true, belegGrund: 'fremder_haendler' })).toBe('ablehnen');
    expect(preisBildschirmBefund({ quelle: 'laden', merkmal: false, belegGrund: 'ohne_merkmale' })).toBeNull();
  });
  it('Grund: preis_beleg_unsicher — außer Bildschirm-Verdacht (Merkmale + Lesedienst ohne Bon); vor dem Technikfehler', () => {
    expect(preisBildschirmHalteGrund({ quelle: 'kassenbon', merkmal: false, belegGrund: 'ohne_merkmale' })).toBe(PREIS_BELEG_UNSICHER);
    expect(preisBildschirmHalteGrund({ quelle: 'kassenbon', merkmal: true, lesedienstOhneBon: true, belegGrund: 'ohne_merkmale' })).toBe(PREIS_BILDSCHIRM_UNSICHER);
    // fehlt nur der Kopf, wäre es Technik — mit Beleg-Befund ist es ein Urteil über das Foto (wird weitergetragen)
    expect(preisBildschirmHalteGrund({ quelle: 'kassenbon', merkmal: null, kopfGescheitert: true, lesedienstOhneBon: true, belegGrund: 'fremder_haendler' })).toBe(PREIS_BELEG_UNSICHER);
    expect(preisBildschirmHalteGrund({ quelle: 'kassenbon', merkmal: null, kopfGescheitert: true, lesedienstOhneBon: true })).toBe(PREIS_KOPF_NICHT_LESBAR);
    expect(preisBildschirmHalteGrund({ vorbefund: { befund: 'halten', seit: 'L1', art: 'beleg' } })).toBe(PREIS_BELEG_UNSICHER);
    expect(preisBildschirmHalteGrund({ vorbefund: { befund: 'halten', seit: 'L1' } })).toBe(PREIS_BILDSCHIRM_UNSICHER);
  });
  it('Hinweis am Dokument verrät nicht, woran es hing (kein Warenkorb, kein Händler, keine Merkmale)', () => {
    const VERRAET = /warenkorb|händler|haendler|amazon|merkmal|summe|datum|kopf|logo|bildschirm/i;
    const h1 = preisBildschirmHinweis({ quelle: 'kassenbon', merkmal: false, belegGrund: 'fremder_haendler', befund: 'halten' });
    const h2 = preisBildschirmHinweis({ befund: 'halten', vorbefund: { befund: 'halten', seit: 'L1', art: 'beleg' } });
    expect(h1).toMatch(/^Preisbeleg unsicher/);
    expect(h2).toMatch(/^Preisbeleg unsicher — Befund vom L1, gilt bis zur Entscheidung/);
    for (const h of [h1, h2]) expect(h).not.toMatch(VERRAET);
  });
  it('Eintrag trägt `art: beleg` (nur das), Vorbefund übernimmt sie, ein Bildschirm-Befund bleibt ohne', () => {
    const e = preisBildschirmEintrag({ modus: true, belegModus: true, quelle: 'kassenbon', merkmal: false, belegGrund: 'ohne_merkmale', befund: 'halten', beleg: { haendler: 'Amazon' } }, { lauf: 'L1' });
    expect(e).toEqual({ modus: true, befund: 'halten', seit: 'L1', regeln: ['beleg'], art: 'beleg' });
    expect(preisBildschirmEintrag({ modus: 'shadow', belegModus: 'shadow', quelle: 'kassenbon', merkmal: false, belegGrund: 'fremder_haendler', befund: 'halten' }, { lauf: 'L1' }))
      .toEqual({ modus: 'shadow', befund: 'halten', seit: 'L1', art: 'beleg' });
    expect(preisBildschirmEintrag({ modus: true, belegModus: true, quelle: 'laden', merkmal: true, befund: 'halten' }, { lauf: 'L1' })).toEqual({ modus: true, befund: 'halten', seit: 'L1', regeln: ['bildschirm'] });
    const x = { review: { rundeOffen: { lauf: 'L1', preisBildschirm: e } } };
    const vor = preisBildschirmVorbefund(x);
    expect(vor).toEqual({ befund: 'halten', seit: 'L1', regeln: ['beleg'] });
    // am nächsten Morgen sagt das Modell „REWE, alle Merkmale" — der Fall bleibt liegen, mit seiner Art
    const heute = { modus: true, belegModus: true, quelle: 'kassenbon', merkmal: false, belegGrund: null, befund: null };
    const verbunden = preisBildschirmMitVorbefund(heute, vor, { bildschirm: true, beleg: true });
    expect(verbunden).toMatchObject({ befund: 'halten', vorbefund: { befund: 'halten', seit: 'L1', regeln: ['beleg'] } });
    expect(preisBildschirmHalteGrund(verbunden)).toBe(PREIS_BELEG_UNSICHER);
    expect(preisBildschirmEintrag(verbunden, { lauf: 'L2' })).toEqual({ modus: true, befund: 'halten', seit: 'L1', regeln: ['beleg'], art: 'beleg' });
    // aus der Beobachtung wird nichts übernommen; ein „ablehnen" ist immer die Bildschirm-Regel
    expect(preisBildschirmVorbefund({ review: { rundeOffen: { preisBildschirm: { ...e, modus: 'shadow' } } } })).toBeNull();
    expect(preisBildschirmVorbefund({ review: { rundeOffen: { preisBildschirm: { modus: true, befund: 'ablehnen', art: 'beleg', seit: 'L1' } } } })).toEqual({ befund: 'ablehnen', seit: 'L1', regeln: ['bildschirm'] });
  });
});
