/**
 * Tests für src/seitenDaten.js — gegen gekürzte ECHTE Shopseiten
 * (__tests__/fixtures, Herkunft in fixtures/QUELLE.md).
 *
 * @jest-environment node
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  gtin14,
  eanVarianten,
  istKurzerCode,
  gleicheGtin,
  pruefzifferGueltig,
  dekodiereEntities,
  sichtbarerText,
  leseJsonLd,
  sammleProdukte,
  leseMetaDaten,
  analysiereSeite,
  bereinigeName,
  nameGestuetzt,
  pruefeBildUrl,
  ermittleIdentitaet,
  kiInhaltGilt,
  hatVerwertbareDaten,
} = require('../src/seitenDaten');

const seite = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.html`), 'utf8');

// ─── EAN ──────────────────────────────────────────────────────────

describe('EAN-Schreibweisen', () => {
  test('13-stellig → 13 und 14', () => {
    expect(eanVarianten('4006040000000')).toEqual(['04006040000000', '4006040000000']);
  });
  test('12-stellige UPC → 14, 13, 12', () => {
    expect(eanVarianten('012345678905')).toEqual(['00012345678905', '0012345678905', '012345678905']);
  });
  test('8-stellig → 14, 13, 12, 8', () => {
    expect(eanVarianten('20003180')).toEqual(['00000020003180', '0000020003180', '000020003180', '20003180']);
  });
  test('Unsinn → leer', () => {
    expect(eanVarianten('abc')).toEqual([]);
    expect(eanVarianten('1234567')).toEqual([]);
    expect(gtin14(null)).toBeNull();
  });
  test('gleicheGtin über Schreibweisen hinweg', () => {
    expect(gleicheGtin('04006040000000', '4006040000000')).toBe(true);
    expect(gleicheGtin('4006040000000', '4006040000001')).toBe(false);
  });
  test('Prüfziffer', () => {
    expect(pruefzifferGueltig('4311501099278')).toBe(true);
    expect(pruefzifferGueltig('9120082630382')).toBe(true);
    expect(pruefzifferGueltig('4311501099279')).toBe(false);
    expect(pruefzifferGueltig('19782442')).toBe(false); // sku von shop-apotheke
  });
});

describe('Text-Helfer', () => {
  test('Entities inkl. numerischer', () => {
    expect(dekodiereEntities('L&#039;Or&eacute;al &amp; Co &#x2013; 1&nbsp;St')).toBe("L'Oréal & Co – 1 St");
  });
  test('sichtbarer Text ohne Skripte und Adressen', () => {
    const html = '<p>EAN <b>123</b></p><script>var x="4006040000000"</script><a href="/p/4006040000000">x</a>';
    expect(sichtbarerText(html)).toBe('EAN 123 x');
  });
  test('ausgeschriebene Adressen zählen nicht als Text (Fehlerseite von edeka.de)', () => {
    const html = '<p>You don\'t have permission to access "http&#58;&#47;&#47;www&#46;edeka&#46;de&#47;sortiment&#47;4311501170113&#47;" on this server.</p>';
    expect(sichtbarerText(html)).not.toContain('4311501170113');
  });
  test('Markdown ohne Link-Ziele', () => {
    expect(sichtbarerText('Milch [Link](https://shop.de/4006040000000) https://x.de/4006040000000 Ende', { istMarkdown: true }))
      .toBe('Milch [Link] Ende');
  });
});

// ─── JSON-LD / Meta an echten Seiten ──────────────────────────────

describe('JSON-LD', () => {
  test('morgenmarkt: Block mit Steuerzeichen wird repariert', () => {
    const roh = leseJsonLd(seite('morgenmarkt-4311501099278'));
    const produkte = sammleProdukte(roh);
    expect(produkte).toHaveLength(1);
    expect(produkte[0].name).toBe('Gut & Günstig Nuss Nougat Creme - Fındıklı Nuga Kremi 400 g');
    expect(produkte[0].kennungen).toContain('4311501099278');
    expect(produkte[0].gtins).toEqual([]); // nur sku/mpn
    expect(produkte[0].marke).toBe('Gut & Günstig');
    expect(produkte[0].angebote[0]).toEqual({ preis: 2.39, waehrung: 'EUR' });
  });

  test('globus: zwei Blöcke desselben Produkts zählen einmal', () => {
    const produkte = sammleProdukte(leseJsonLd(seite('globus-3600524137564')));
    expect(produkte).toHaveLength(1);
    expect(produkte[0].bilder[0]).toMatch(/^https:\/\/produkte\.globus\.de\/media\/.+3600524137564_/);
  });

  test('verwandte Produkte (isRelatedTo) gehören nicht zur Seite', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product', name: 'Haupt', gtin13: '4311501099278',
      isRelatedTo: [{ '@type': 'Product', name: 'Anderes', gtin13: '4006040000000' }],
    })}</script>`;
    expect(sammleProdukte(leseJsonLd(html)).map((p) => p.name)).toEqual(['Haupt']);
  });

  test('Meta: mehrere og:type, product gewinnt; Währung', () => {
    const meta = leseMetaDaten(seite('morgenmarkt-4311501099278'));
    expect(meta.ogType).toBe('product');
    expect(meta.waehrung).toBe('EUR');
    expect(meta.ogImages[0]).toMatch(/studio_/);
  });
});

// ─── Gehört die Seite zur EAN? ────────────────────────────────────

describe('analysiereSeite an echten Seiten', () => {
  test('globus: EAN nur als sku → jsonld_gtin, KI darf', () => {
    const a = analysiereSeite({ inhalt: seite('globus-3600524137564'), ean: '3600524137564' });
    expect(a.fundstelle).toBe('jsonld_gtin');
    expect(a.kiDarf).toBe(true);
    expect(a.eanImSeitentext).toBe(false); // EAN steht nur in Bildpfaden
    expect(a.rohName).toBe('Elvital Shampoo, Color Glanz');
    expect(a.rohMarke).toBe("L'Oréal Paris");
    expect(a.angebot).toEqual({ preis: 3.79, waehrung: 'EUR' });
  });

  test('shop-apotheke: gtin13 eines anderen Produkts → Widerspruch, keine KI', () => {
    const a = analysiereSeite({ inhalt: seite('shopapotheke-4069365317310'), ean: '4069365317310' });
    expect(a.widerspruch).toBe(true);
    expect(a.kiDarf).toBe(false);
  });

  test('codecheck-Suchseite: EAN nur hinter „Ergebnisse für“ und als searchText → keine KI', () => {
    const a = analysiereSeite({ inhalt: seite('codecheck-suche-4316268640695'), ean: '4316268640695' });
    expect(a.eanImSeitentext).toBe(false);
    expect(a.fundstelle).toBeNull();
    expect(a.kiDarf).toBe(false);
  });

  test('OpenFoodFacts-Seite eines anderen Produkts → keine KI', () => {
    const a = analysiereSeite({ inhalt: seite('openfoodfacts-7610807015843'), ean: '4335619254077' });
    expect(a.kiDarf).toBe(false);
    // dieselbe Seite für die richtige EAN
    const b = analysiereSeite({ inhalt: seite('openfoodfacts-7610807015843'), ean: '7610807015843' });
    expect(b.fundstelle).toBe('seitentext');
  });

  test('violey: Seite eines anderen Produkts → keine KI', () => {
    expect(analysiereSeite({ inhalt: seite('violey-35278'), ean: '4056489845881' }).kiDarf).toBe(false);
  });

  test('atundo: Microdata mainEntity zählt, isRelatedTo nicht; EAN sichtbar unter GTIN', () => {
    const a = analysiereSeite({ inhalt: seite('atundo-4311501421840'), ean: '4311501421840' });
    expect(a.produkte).toHaveLength(0);
    expect(a.produktAnzahl).toBe(1);
    expect(a.fundstelle).toBe('seitentext');
    expect(a.rohName).toBe('Gut&Günstig Erdnuss-Flips Mais-Erdnuss-Snack (200g Tüte)');
  });

  test('olial: Yoast-@graph mit gtin', () => {
    const a = analysiereSeite({ inhalt: seite('olial-4311501051825'), ean: '4311501051825' });
    expect(a.fundstelle).toBe('jsonld_gtin');
    expect(a.passendesProdukt.gtins).toContain('4311501051825');
  });

  test('ehgoo: Angebotspreis 0 zählt nicht', () => {
    const a = analysiereSeite({ inhalt: seite('ehgoo-4070308098821'), ean: '4070308098821' });
    expect(a.fundstelle).toBe('jsonld_gtin');
    expect(a.angebot).toBeNull();
    expect(a.waehrung).toBe('EUR');
  });

  test('EAN nur in einer Adresse zählt nicht (auch kodiert)', () => {
    const html = '<html><body><a href="https://shop.de/p-4311501099278">Produkt</a>'
      + '<img src="/bilder/4311501099278-c.jpg">'
      + '<p>Access Denied "http&#58;&#47;&#47;www&#46;edeka&#46;de&#47;sortiment&#47;4311501099278&#47;"</p>'
      + '<a href="https://x.de/share?u=https%3A%2F%2Fshop.de%2F4311501099278%2F">teilen</a></body></html>';
    expect(analysiereSeite({ inhalt: html, ean: '4311501099278' }).kiDarf).toBe(false);
  });

  test('EAN nur in den Seitendaten (Skript-JSON) reicht nicht — keine KI (Prüfrunde 04.10.2026)', () => {
    const html = '<html><head><meta property="og:title" content="Irgendwas"></head><body>'
      + '<script>window.p={"ean":"4311501099278"}</script></body></html>';
    const a = analysiereSeite({ inhalt: html, ean: '4311501099278' });
    expect(a.fundstelle).toBeNull();
    expect(a.kiDarf).toBe(false);
    expect(a.grundOhneKi).toBe('ean_not_in_html');
  });

  test('atundo: fremde EAN nur in <meta name="keywords"> → keine KI, kein Inhalt unter falscher Nummer', () => {
    // Die Keywords der Erdnuss-Flips-Seite führen 4311501480939 mit. Bis zur
    // Prüfrunde bekam eine Suche danach Zutaten und Preis der Flips.
    const a = analysiereSeite({ inhalt: seite('atundo-4311501421840'), ean: '4311501480939' });
    expect(a.kiDarf).toBe(false);
    expect(a.grundOhneKi).toBe('ean_not_in_html');
    // dieselbe Seite für die eigene EAN (sichtbar unter „GTIN“) bleibt erlaubt
    expect(analysiereSeite({ inhalt: seite('atundo-4311501421840'), ean: '4311501421840' }).kiDarf).toBe(true);
  });

  test('Listenseite: mehrere JSON-LD-Produkte, unsere EAN nur im Text einer Kachel → keine KI', () => {
    const html = `<script type="application/ld+json">${JSON.stringify([
      { '@type': 'Product', name: 'Kakao A', gtin13: '4006040000000' },
      { '@type': 'Product', name: 'Kakao B' },
    ])}</script><ul><li>Kakao B — EAN 4311501099278 — 1,29 €</li></ul>`;
    const a = analysiereSeite({ inhalt: html, ean: '4311501099278' });
    expect(a.eanImSeitentext).toBe(true);
    expect(a.kiDarf).toBe(false);
    expect(a.grundOhneKi).toBe('mehrere_produkte');
  });

  test('14-stellige Schreibweise im Text wird erkannt', () => {
    const html = '<p>GTIN: 04311501099278</p>';
    expect(analysiereSeite({ inhalt: html, ean: '4311501099278' }).eanImSeitentext).toBe(true);
  });

  test('„keine Ergebnisse“ hinter der EAN zählt nicht', () => {
    const html = '<p>Für 4311501099278 wurden keine Produkte gefunden.</p>';
    expect(analysiereSeite({ inhalt: html, ean: '4311501099278' }).eanImSeitentext).toBe(false);
  });
});

// ─── Kurze Codes (EAN-8/RCN-8, Prüfrunde 3) ───────────────────────
//
// Achtstellige Nummern sind oft Artikel-, PZN- oder Shop-Nummern. Die drei
// Fälle stammen aus dem gespeicherten Bestand (nutritionscrape, 04.10.2026).

describe('kurze Codes: nur echte GTIN-Angaben belegen', () => {
  const ld = (o, body = '<h1>Produkt</h1>') =>
    `<html><head><script type="application/ld+json">${JSON.stringify(o)}</script></head><body>${body}</body></html>`;

  test('istKurzerCode: 8-stellig und 13-stellig mit fünf führenden Nullen', () => {
    expect(istKurzerCode('20003180')).toBe(true);
    expect(istKurzerCode('0000020003180')).toBe(true);
    expect(istKurzerCode('4006040000000')).toBe(false);
  });

  test('sku = EAN-8 (Arzneimittel-Shop) ist kein Beleg — vorher jsonld_gtin mit Name und Preis', () => {
    const html = ld({ '@type': 'Product', name: 'Ibuprofen 400 akut', sku: '40123456', offers: { price: '3.95', priceCurrency: 'EUR' } });
    const a = analysiereSeite({ inhalt: html, ean: '40123456' });
    expect(a.passendesProdukt).toBeNull();
    expect(a.fundstelle).toBeNull();
    expect(a.kiDarf).toBe(false);
    expect(ermittleIdentitaet({ analyse: a, ki: { name: 'Ibuprofen 400 akut' } })).toBeNull();
  });

  test('20277994: productID ohne Präfix (nafco, japanischer Grüntee) → kein Beleg', () => {
    const a = analysiereSeite({ inhalt: ld({ '@type': 'Product', name: 'Sencha Japan Grüntee', productID: '20277994' }), ean: '20277994' });
    expect(a.fundstelle).toBeNull();
  });

  test('20006204: sku und „Art.-Nr.“ (gastro-direkt, Hygienereiniger) → kein Beleg', () => {
    const html = ld({ '@type': 'Product', name: 'Winterhalter B2 Hygienereiniger', sku: '20006204' }, '<p>Art.-Nr. 20006204</p>');
    const a = analysiereSeite({ inhalt: html, ean: '20006204' });
    expect(a.fundstelle).toBeNull();
    expect(a.kiDarf).toBe(false);
  });

  test('19549220: „PZN“ im Text (shop-apotheke) → kein Beleg', () => {
    const a = analysiereSeite({ inhalt: '<p>PZN: 19549220</p><p>Nasenspray</p>', ean: '19549220' });
    expect(a.eanImSeitentext).toBe(false);
  });

  test('echte GTIN-Felder und Präfix-productID belegen weiter', () => {
    expect(analysiereSeite({ inhalt: ld({ '@type': 'Product', name: 'Golden Puffs', gtin8: '20003180' }), ean: '20003180' }).fundstelle).toBe('jsonld_gtin');
    expect(analysiereSeite({ inhalt: ld({ '@type': 'Product', name: 'Golden Puffs', productID: 'gtin8:20003180' }), ean: '20003180' }).fundstelle).toBe('jsonld_gtin');
  });

  test.each([
    ['EAN: 20003180', true],
    ['EAN-Code 20003180', true],
    ['GTIN 20003180', true],
    ['Barcode: 20003180', true],
    ['Strichcode: 0000020003180', true],
    ['Nummer 0000020003180', true], // 13-stellige Schreibweise ist selbst eine GTIN-Angabe
    ['20003180', false],
    ['Artikelnummer: 20003180', false],
    ['Bestell-Nr. 20003180', false],
    ['SKU 20003180', false],
    ['Produkt-ID: 20003180', false],
    ['EAN / Art.-Nr.: 20003180', false], // die nächstgelegene Bezeichnung entscheidet
  ])('Text „%s“ → Beleg %s', (t, erwartet) => {
    expect(analysiereSeite({ inhalt: `<p>${t}</p>`, ean: '20003180' }).eanImSeitentext).toBe(erwartet);
  });

  // Schlussprüfung 04.10.2026: die Bezeichnung gehört zur ERSTEN Nummer,
  // wenn zwischen ihr und der kurzen Fundstelle eine weitere Nummer steht.
  test.each([
    ['EAN 4012345678901 | 40123456', false],
    ['EAN: 4012345678901, 40123456', false],
    ['GTIN 1234 40123456', false],
    ['EAN: 40123456', true],
    ['EAN-8: 40123456', true],
    ['EAN (8-stellig): 40123456', true],
    ['EAN-13 4012345678901, EAN-8 40123456', true], // die eigene Bezeichnung steht direkt davor
  ])('kurze Fundstelle „%s“ → Beleg %s', (t, erwartet) => {
    const a = analysiereSeite({ inhalt: `<p>${t}</p>`, ean: '40123456' });
    expect(a.eanImSeitentext).toBe(erwartet);
    expect(a.fundstelle).toBe(erwartet ? 'seitentext' : null);
    expect(a.kiDarf).toBe(erwartet);
  });

  test('13-stellige EAN unverändert: sku und Text ohne Bezeichnung belegen (globus)', () => {
    expect(analysiereSeite({ inhalt: ld({ '@type': 'Product', name: 'X', sku: '4006040000000' }), ean: '4006040000000' }).fundstelle).toBe('jsonld_gtin');
    expect(analysiereSeite({ inhalt: '<p>Art.-Nr. 4006040000000</p>', ean: '4006040000000' }).eanImSeitentext).toBe(true);
  });

  test('Markdown (Apify): dieselbe Bezeichnungsregel', () => {
    expect(analysiereSeite({ inhalt: '| EAN | 20003180 |', ean: '20003180', istMarkdown: true }).eanImSeitentext).toBe(true);
    expect(analysiereSeite({ inhalt: '| Artikelnummer | 20003180 |', ean: '20003180', istMarkdown: true }).eanImSeitentext).toBe(false);
  });
});

// ─── Name ─────────────────────────────────────────────────────────

describe('bereinigeName', () => {
  test.each([
    ['dennree Knusper Mix Dinkel 200 g bei Violey', 'www.violey.com', 'dennree Knusper Mix Dinkel 200 g'],
    ["Elvital Shampoo,  Color Glanz von L&#039;Oreal Paris ⮞ Globus", 'produkte.globus.de', "Elvital Shampoo, Color Glanz von L'Oreal Paris"],
    ['Gut &amp; Günstig Nuss Nougat Creme - Fındıklı Nuga Kremi 400 g - Morgenmarkt.de', 'morgenmarkt.de', 'Gut & Günstig Nuss Nougat Creme - Fındıklı Nuga Kremi 400 g'],
    ['JA! DOPPELKEKSE 500G RL - Depha GmbH', 'depha.eu', 'JA! DOPPELKEKSE 500G RL'],
    ['Silodent Schallzahnbürste Midnight Blue 1 St - Shop Apotheke', 'www.shop-apotheke.com', 'Silodent Schallzahnbürste Midnight Blue 1 St'],
    ['Milka Alpenmilch 100g online kaufen | REWE', 'shop.rewe.de', 'Milka Alpenmilch 100g'],
    ['Coca-Cola Zero - 1,5 l', 'x.de', 'Coca-Cola Zero - 1,5 l'],
  ])('%s', (roh, host, erwartet) => {
    expect(bereinigeName(roh, { host })).toBe(erwartet);
  });

  test.each(['Produkt', 'Client Challenge', 'CodeCheck - Suchergebnisse', '4006040000000', '  ', null])(
    'Platzhalter %p → null', (roh) => {
      expect(bereinigeName(roh, { host: 'x.de' })).toBeNull();
    },
  );
});

describe('nameGestuetzt', () => {
  test('bereinigter Name aus dem Rohnamen ist gestützt', () => {
    expect(nameGestuetzt('Gut & Günstig Nuss Nougat Creme 400 g', 'Gut &amp; Günstig Nuss Nougat Creme - 400 g | Shop')).toBe(true);
  });
  test('erfundener / erwarteter Name ist nicht gestützt', () => {
    expect(nameGestuetzt('Nutella Haselnusscreme 450 g', 'Gut & Günstig Nuss Nougat Creme 400 g')).toBe(false);
  });
});

// ─── Bild ─────────────────────────────────────────────────────────

describe('pruefeBildUrl', () => {
  test('budni: localhost wird verworfen', () => {
    const meta = leseMetaDaten(seite('budni-6832973006'));
    expect(meta.ogImages[0]).toMatch(/^http:\/\/localhost:8080/);
    expect(pruefeBildUrl(meta.ogImages[0], 'https://www.budni.de/x')).toBeNull();
  });
  test('globus: og:image ist ein Hash, keine Adresse', () => {
    expect(pruefeBildUrl('018f810257ba73a98bb153d9d51e498d', 'https://produkte.globus.de/x')).toBeNull();
  });
  test('Logos und SVG werden verworfen', () => {
    expect(pruefeBildUrl('https://static.openfoodfacts.org/images/logos/off-logo-vertical-white-social-media-preview.png')).toBeNull();
    expect(pruefeBildUrl('https://www.shop-apotheke.com/webclient/assets/logo-COM-desktop.svg')).toBeNull();
  });
  test('relative Adresse wird aufgelöst', () => {
    expect(pruefeBildUrl('/media/p/123.jpg', 'https://shop.de/produkt/1')).toBe('https://shop.de/media/p/123.jpg');
  });
  test('data:-URI → null', () => {
    expect(pruefeBildUrl('data:image/png;base64,AAAA')).toBeNull();
  });
});

// ─── Identität ────────────────────────────────────────────────────

describe('ermittleIdentitaet', () => {
  test('globus: Name aus JSON-LD, Bild aus JSON-LD, Beleg jsonld_gtin', () => {
    const a = analysiereSeite({ inhalt: seite('globus-3600524137564'), ean: '3600524137564' });
    const id = ermittleIdentitaet({ analyse: a, ki: {}, basisUrl: 'https://produkte.globus.de/x' });
    expect(id.eanBeleg).toBe('jsonld_gtin');
    expect(id.productName).toBe('Elvital Shampoo, Color Glanz');
    expect(id.shopBildUrl).toMatch(/^https:\/\/produkte\.globus\.de\/media\//);
  });

  test('KI darf die Marke aus JSON-LD ergänzen', () => {
    const a = analysiereSeite({ inhalt: seite('globus-3600524137564'), ean: '3600524137564' });
    const id = ermittleIdentitaet({
      analyse: a,
      ki: { name: "L'Oréal Paris Elvital Shampoo Color Glanz" },
      basisUrl: 'https://produkte.globus.de/x',
    });
    expect(id.productName).toBe("L'Oréal Paris Elvital Shampoo Color Glanz");
  });

  test('KI-Name, der nicht im Rohnamen steht, wird verworfen', () => {
    const a = analysiereSeite({ inhalt: seite('morgenmarkt-4311501099278'), ean: '4311501099278' });
    const id = ermittleIdentitaet({ analyse: a, ki: { name: 'Nutella 450 g' }, basisUrl: 'https://morgenmarkt.de/x' });
    expect(id.productName).toBe('Gut & Günstig Nuss Nougat Creme - Fındıklı Nuga Kremi 400 g');
  });

  test('atundo: seitentext-Beleg mit genau einem Produkt (Microdata)', () => {
    const a = analysiereSeite({ inhalt: seite('atundo-4311501421840'), ean: '4311501421840' });
    const id = ermittleIdentitaet({ analyse: a, ki: {}, basisUrl: 'https://www.atundo.com/shop/x' });
    expect(id).toEqual({
      eanBeleg: 'seitentext',
      productName: 'Gut&Günstig Erdnuss-Flips Mais-Erdnuss-Snack (200g Tüte)',
      shopBildUrl: 'https://www.atundo.com/shop/media/image/product/194200/lg/gutguenstig-erdnuss-flips-mais-erdnuss-snack-200g-tuete.jpg',
    });
  });

  test('fresh-store: og:type product + EAN sichtbar → seitentext', () => {
    const a = analysiereSeite({ inhalt: seite('freshstore-4305615633428'), ean: '4305615633428' });
    const id = ermittleIdentitaet({ analyse: a, ki: {}, basisUrl: 'https://www.fresh-store.eu/de/x' });
    expect(id.eanBeleg).toBe('seitentext');
    expect(id.productName).toBe('ISANA MEN Shampoo Energy Effect 300ml');
  });

  test('og:type product, aber die KI sieht mehrere Produkte → kein Name', () => {
    const a = analysiereSeite({ inhalt: seite('freshstore-4305615633428'), ean: '4305615633428' });
    expect(ermittleIdentitaet({ analyse: a, ki: { einzelprodukt: false }, basisUrl: 'https://www.fresh-store.eu/de/x' })).toBeNull();
  });

  test('ohne Strukturdaten entscheidet die KI über „genau ein Produkt“', () => {
    const html = '<html><head><title>Haferdrink 1 l – Shop</title></head><body><p>EAN 4311501099278</p></body></html>';
    const a = analysiereSeite({ inhalt: html, ean: '4311501099278' });
    expect(ermittleIdentitaet({ analyse: a, ki: { einzelprodukt: false } })).toBeNull();
    expect(ermittleIdentitaet({ analyse: a, ki: { einzelprodukt: true } }).productName).toBe('Haferdrink 1 l');
  });

  test('mehrere Produkte ohne passende gtin → keine KI und kein Name', () => {
    const html = `<script type="application/ld+json">${JSON.stringify([
      { '@type': 'Product', name: 'A' }, { '@type': 'Product', name: 'B' },
    ])}</script><p>EAN 4311501099278</p>`;
    const a = analysiereSeite({ inhalt: html, ean: '4311501099278' });
    expect(a.kiDarf).toBe(false);
    expect(ermittleIdentitaet({ analyse: a, ki: { einzelprodukt: true } })).toBeNull();
  });

  test('Markdown (Apify): Name nur aus dem Text, Bild nur wenn die Adresse dort steht', () => {
    // Synthetisches Markdown im Format von Apify website-content-crawler.
    const md = '# Bio Haferdrink 1 l\n\n![Bio Haferdrink](https://cdn.shop.de/p/haferdrink.jpg)\n\nEAN: 4311501099278\n\nZutaten: Wasser, Hafer';
    const a = analysiereSeite({ inhalt: md, ean: '4311501099278', istMarkdown: true });
    expect(a.fundstelle).toBe('seitentext');
    const id = ermittleIdentitaet({
      analyse: a,
      ki: { name: 'Bio Haferdrink 1 l', einzelprodukt: true, bildUrl: 'https://cdn.shop.de/p/haferdrink.jpg' },
      basisUrl: 'https://www.penny.de/p',
    });
    expect(id).toEqual({
      eanBeleg: 'seitentext',
      productName: 'Bio Haferdrink 1 l',
      shopBildUrl: 'https://cdn.shop.de/p/haferdrink.jpg',
    });
    const erfunden = ermittleIdentitaet({
      analyse: a,
      ki: { name: 'Bio Haferdrink 1 l', einzelprodukt: true, bildUrl: 'https://cdn.shop.de/p/anderes.jpg' },
      basisUrl: 'https://www.penny.de/p',
    });
    expect(erfunden.shopBildUrl).toBeUndefined();
    expect(ermittleIdentitaet({ analyse: a, ki: { name: 'Bio Haferdrink 1 l', einzelprodukt: null } })).toBeNull();
  });
});

describe('hatVerwertbareDaten', () => {
  test('Name allein zählt (Drogerie ohne Nährwerte)', () => {
    expect(hatVerwertbareDaten({ productName: 'Domol Colorwaschmittel' })).toBe(true);
  });
  test('leer zählt nicht', () => {
    expect(hatVerwertbareDaten({ attr_allergene: [], attr_preis: 0 })).toBe(false);
    expect(hatVerwertbareDaten(null)).toBe(false);
  });
});

// ─── Inhalt der KI nur für diese EAN ──────────────────────────────

describe('kiInhaltGilt', () => {
  const html = (produkte, text = '') => `<script type="application/ld+json">${JSON.stringify(produkte)}</script>${text}`;

  test('ein Produkt laut Struktur: gilt, auch wenn die KI „mehrere“ meint (Slider ähnlicher Produkte)', () => {
    const a = analysiereSeite({ inhalt: seite('atundo-4311501421840'), ean: '4311501421840' });
    expect(kiInhaltGilt({ analyse: a, kiEinzelprodukt: false })).toBe(true);
  });

  test('ohne Strukturdaten: KI „mehrere Produkte“ → gilt nicht; KI unsicher → gilt', () => {
    const a = analysiereSeite({ inhalt: seite('freshstore-4305615633428'), ean: '4305615633428' });
    expect(a.produktAnzahl).toBeNull();
    expect(kiInhaltGilt({ analyse: a, kiEinzelprodukt: false })).toBe(false);
    expect(kiInhaltGilt({ analyse: a, kiEinzelprodukt: null })).toBe(true);
  });

  test('passendes JSON-LD-Produkt auf einer Seite mit mehreren: nur wenn die KI nicht „mehrere“ meldet', () => {
    const a = analysiereSeite({
      inhalt: html([{ '@type': 'Product', name: 'Unseres', gtin13: '4311501099278' }, { '@type': 'Product', name: 'Anderes', gtin13: '4006040000000' }]),
      ean: '4311501099278',
    });
    expect(a.kiDarf).toBe(true);
    expect(kiInhaltGilt({ analyse: a, kiEinzelprodukt: true })).toBe(true);
    expect(kiInhaltGilt({ analyse: a, kiEinzelprodukt: false })).toBe(false);
  });

  test('Markdown: die KI entscheidet', () => {
    const a = analysiereSeite({ inhalt: '# Haferdrink\n\nEAN: 4311501099278\n\nZutaten: Wasser', ean: '4311501099278', istMarkdown: true });
    expect(kiInhaltGilt({ analyse: a, kiEinzelprodukt: false })).toBe(false);
    expect(kiInhaltGilt({ analyse: a, kiEinzelprodukt: true })).toBe(true);
  });

  test('Seite ohne Freigabe für die KI → nie', () => {
    const a = analysiereSeite({ inhalt: '<p>nichts</p>', ean: '4311501099278' });
    expect(kiInhaltGilt({ analyse: a, kiEinzelprodukt: true })).toBe(false);
  });
});
