'use strict';
/**
 * Bildschirmfotos als Preisbeleg (Patrick 04.10.2026: „ja, bau das") — reine
 * Funktionen aus src/preisBildschirm.js. Die Verdrahtung in der Runde prüft
 * __tests__/taeglicheRunde.test.js, die Entscheidung __tests__/fotoRundeRegeln.test.js.
 */
const {
  modusPreisBildschirm, schalterRohOf, preisQuelleOf, lesedienstBonOf, lesedienstOhneBonOf, bildKopf, bildschirmMerkmal, preisBildschirmBefund, preisBildschirmHalteGrund,
  preisBildschirmHinweis, preisBildschirmEintrag, preisBildschirmVorbefund, preisBildschirmMitVorbefund,
  PREIS_QUELLEN, KOPF_BYTES,
} = require('../src/preisBildschirm');
const { png, jpeg, EXIF } = require('./helpers/bildKopfDaten');

describe('Schalter preisBildschirmRegel', () => {
  it('false = aus, true = scharf, sonst immer Beobachtung (auch Tippfehler)', () => {
    expect(modusPreisBildschirm(false)).toBe(false);
    expect(modusPreisBildschirm(true)).toBe(true);
    for (const v of ['shadow', undefined, null, 'true', 'ja', 1, 0, 'false']) expect(modusPreisBildschirm(v)).toBe('shadow');
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
    expect(preisBildschirmVorbefund(ro({ modus: true, befund: 'halten', seit: 'L0' }))).toEqual({ befund: 'halten', seit: 'L0' });
    expect(preisBildschirmVorbefund(ro({ modus: true, befund: 'ablehnen' }))).toEqual({ befund: 'ablehnen', seit: 'L1' });
    expect(preisBildschirmVorbefund(ro({ modus: 'shadow', befund: 'halten' }))).toBeNull();
    expect(preisBildschirmVorbefund(ro({ modus: true, befund: null }))).toBeNull();
    expect(preisBildschirmVorbefund({ review: { rundeOffen: { grund: 'x' } } })).toBeNull();
    expect(preisBildschirmVorbefund({})).toBeNull();
  });
  const heute = (befund, extra = {}) => ({ modus: true, quelle: 'laden', merkmal: false, befund, ...extra });
  const vorher = { befund: 'halten', seit: 'L1' };
  it('heute anders gelesen oder keine Bildprüfung → hält weiter (nie automatisch frei)', () => {
    expect(preisBildschirmMitVorbefund(heute(null), vorher, true)).toMatchObject({ modus: true, befund: 'halten', vorbefund: { seit: 'L1' }, heute: null });
    expect(preisBildschirmMitVorbefund(null, vorher, true)).toMatchObject({ modus: true, befund: 'halten', vorbefund: { seit: 'L1' }, quelle: null });
  });
  it('ein zurückgehaltener Ablehn-Befund wird morgen ohne neue Lesung nur noch gehalten', () => {
    expect(preisBildschirmMitVorbefund(heute(null), { befund: 'ablehnen', seit: 'L1' }, true)).toMatchObject({ befund: 'halten' });
  });
  // Prüfrunde 3 (04.10.2026): ein liegender Fall wird nicht jeden Morgen neu
  // ausgewürfelt — die widersprechende Antwort des Vortags steht nicht am Dokument.
  it('Vorbefund „halten" + heute „ablehnen" → bleibt liegen (nur ein Mensch entscheidet)', () => {
    expect(preisBildschirmMitVorbefund(heute('ablehnen'), vorher, true)).toMatchObject({ befund: 'halten', vorbefund: { befund: 'halten', seit: 'L1' }, heute: 'ablehnen' });
  });
  it('Vorbefund „ablehnen" (von der Notbremse zurückgehalten) + heute „ablehnen" → gilt', () => {
    expect(preisBildschirmMitVorbefund(heute('ablehnen'), { befund: 'ablehnen', seit: 'L1' }, true)).toMatchObject({ befund: 'ablehnen', vorbefundSeit: 'L1' });
  });
  it('Schalter aus → nichts; Beobachtung → Befund reist nur mit (hält nichts, siehe freigabe)', () => {
    expect(preisBildschirmMitVorbefund(heute(null), vorher, false)).toBeNull();
    expect(preisBildschirmMitVorbefund(heute(null), vorher, 'shadow')).toMatchObject({ modus: 'shadow', befund: 'halten' });
    expect(preisBildschirmMitVorbefund(heute('halten'), null, true)).toEqual(heute('halten'));
    expect(preisBildschirmMitVorbefund(null, null, true)).toBeNull();
  });
});

describe('Hinweis und Eintrag am Dokument (der Einreicher liest sein Dokument — Gegenprüfung 04.10.2026)', () => {
  const VERRAET = /kamera|format|png|jpg|exif|seitenverh|merkmal|statusleiste|warenkorb|4:3|16:9/i;
  it('Hinweis: nur das Urteil, nie woran es hängt (Datei, Begründung des Modells)', () => {
    const faelle = [
      { quelle: 'bildschirm', merkmal: true, grund: 'Statusleiste, Warenkorb-Knopf', befund: 'ablehnen' },
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
      modus: true, quelle: 'bildschirm', grund: 'Statusleiste', merkmal: true, lesedienstBon: false, befund: 'ablehnen',
      kopf: { format: 'png', breite: 1080, hoehe: 2400, kameraHersteller: null }, kopfFehler: null,
    }, { lauf: 'L2' });
    expect(e).toEqual({ modus: true, befund: 'ablehnen', seit: 'L2' });
    expect(JSON.stringify(e)).not.toMatch(VERRAET);
    // ein übernommener Befund behält seinen ersten Lauf
    expect(preisBildschirmEintrag({ modus: true, befund: 'halten', vorbefund: { befund: 'halten', seit: 'L1' } }, { lauf: 'L2' }))
      .toEqual({ modus: true, befund: 'halten', seit: 'L1' });
    expect(preisBildschirmEintrag({ modus: 'irgendwas', befund: 'halten' }, {})).toEqual({ modus: 'shadow', befund: 'halten', seit: null });
    expect(preisBildschirmEintrag({ modus: true, befund: 'loeschen' })).toBeNull();
    expect(preisBildschirmEintrag({ modus: true, befund: null })).toBeNull();
    expect(preisBildschirmEintrag(null)).toBeNull();
  });
  it('ein Halt nur wegen des nicht abrufbaren Bildkopfs ist kein Befund über das Foto → kein Eintrag (wird morgen neu geprüft)', () => {
    expect(preisBildschirmEintrag({ modus: true, quelle: 'laden', merkmal: null, kopfGescheitert: true, befund: 'halten' }, { lauf: 'L' })).toBeNull();
    expect(preisBildschirmEintrag({ modus: true, quelle: 'bildschirm', merkmal: null, kopfGescheitert: true, befund: 'halten' }, { lauf: 'L' }))
      .toEqual({ modus: true, befund: 'halten', seit: 'L' });
  });
});
