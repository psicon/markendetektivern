'use strict';

/**
 * Regeln des Prozessors (src/regeln.js): Nummernprüfung, Ladencodes, RCN-8,
 * Beanspruchen, Serper-Grenze, Ergebniszuordnung, Kandidatenreihenfolge.
 * Prüfziffern der Beispiele sind nach GS1 gerechnet (Wikipedia-Beispiele
 * 4006381333931, 96385074, 036000291452; Lidl 20003180 aus der Warteschlange).
 */

const r = require('../src/regeln');

describe('istGueltigeGtin', () => {
  it.each([
    ['4006381333931', 'EAN-13'],
    ['96385074', 'EAN-8'],
    ['036000291452', 'UPC-A'],
    ['04006381333931', 'GTIN-14 mit führender 0'],
    ['20003180', 'RCN-8 (Lidl)'],
  ])('%s (%s) ist gültig', (code) => {
    expect(r.istGueltigeGtin(code)).toBe(true);
  });

  it.each([
    ['4006381333932', 'falsche Prüfziffer'],
    ['123456789', 'Länge 9'],
    ['40063813339310', 'Länge 14 mit falscher Prüfziffer'],
    ['00000000', 'nur Nullen'],
    ['0000000000000', 'nur Nullen (13)'],
    ['4006381a33931', 'Buchstabe'],
    ['', 'leer'],
    [undefined, 'fehlt'],
    [4006381333931, 'Zahl statt Text'],
  ])('%s (%s) ist ungültig', (code) => {
    expect(r.istGueltigeGtin(code)).toBe(false);
  });
});

describe('Ladencode und RCN-8', () => {
  it.each([
    ['2001234012348', '13-stellig, Präfix 20'],
    ['0212345678909', '13-stellig, Präfix 02'],
    ['0412345678903', '13-stellig, Präfix 04'],
    ['212345678909', 'UPC-A „2…" = EAN-13 „02…"'],
    ['412345678903', 'UPC-A „4…" = EAN-13 „04…"'],
    ['02001234012348', 'GTIN-14 mit führender 0'],
  ])('%s (%s) ist ein Ladencode', (code) => {
    expect(r.istLadencode(code)).toBe(true);
    expect(r.vorabEntscheidung(code)).toEqual({ art: 'ueberspringen', grund: 'ladencode' });
  });

  it('normale EAN-13 und UPC-A sind keine Ladencodes', () => {
    expect(r.istLadencode('4006381333931')).toBe(false);
    expect(r.istLadencode('036000291452')).toBe(false);
  });

  it('8-stellige „2…" sind RCN-8 — gesucht wird nur bei deutschen Händlern', () => {
    expect(r.istLadencode('20003180')).toBe(false);
    expect(r.istRcn8('20003180')).toBe(true);
    const v = r.vorabEntscheidung('20003180');
    expect(v.art).toBe('suchen');
    expect(v.nurDomains).toEqual(expect.arrayContaining(['lidl.de', 'kaufland.de', 'aldi-sued.de', 'rewe.de', 'dm.de']));
    // Eine Kopie — der Aufrufer darf die Liste nicht verändern.
    v.nurDomains.push('x.de');
    expect(r.RCN8_DOMAINS).not.toContain('x.de');
  });

  it('8-stellige „0…" sind ebenfalls RCN-8', () => {
    expect(r.istRcn8('01234565')).toBe(true);
    expect(r.vorabEntscheidung('01234565').nurDomains).toEqual(r.RCN8_DOMAINS);
  });

  it('andere EAN-8 sind kein RCN-8', () => {
    expect(r.istRcn8('96385074')).toBe(false);
    expect(r.vorabEntscheidung('96385074')).toEqual({ art: 'suchen' });
  });

  it('ungültige Nummern werden vor allem anderen übersprungen', () => {
    expect(r.vorabEntscheidung('2001234012340')).toEqual({ art: 'ueberspringen', grund: 'ungueltige_ean' });
    expect(r.vorabEntscheidung('12345')).toEqual({ art: 'ueberspringen', grund: 'ungueltige_ean' });
    expect(r.vorabEntscheidung(null)).toEqual({ art: 'ueberspringen', grund: 'ungueltige_ean' });
  });
});

describe('katalogVarianten', () => {
  it('EAN-13: 14- und 13-stellig plus Zahl', () => {
    expect(r.katalogVarianten('4006381333931')).toEqual(['04006381333931', '4006381333931', 4006381333931]);
  });

  it('UPC-A: auch als EAN-13 mit führender 0 und ohne die eigene führende 0', () => {
    expect(r.katalogVarianten('036000291452')).toEqual([
      '00036000291452', '0036000291452', '036000291452', '36000291452', 36000291452,
    ]);
  });

  it('EAN-8: alle Längen von 8 bis 14', () => {
    expect(r.katalogVarianten('20003180')).toEqual([
      '00000020003180', '0000020003180', '000020003180', '00020003180', '0020003180', '020003180', '20003180', 20003180,
    ]);
  });

  it('GTIN-14 mit Packungsindikator bleibt nur 14-stellig', () => {
    expect(r.katalogVarianten('14006381333938')).toEqual(['14006381333938', 14006381333938]);
  });

  it('ungültige Nummer → keine Varianten', () => {
    expect(r.katalogVarianten('4006381333932')).toEqual([]);
  });
});

describe('beanspruchenUrteil', () => {
  const konfig = { aktiv: true, tagesDeckel: 120 };

  it('offener Fall unter dem Deckel → ok', () => {
    expect(r.beanspruchenUrteil({ status: 'pending', konfig, tagBearbeitet: 119 })).toEqual({ ok: true });
  });

  it('Deckel erreicht → Halt, auch wenn der Fall offen ist', () => {
    expect(r.beanspruchenUrteil({ status: 'pending', konfig, tagBearbeitet: 120 }))
      .toEqual({ ok: false, grund: 'tagesdeckel', halt: true });
  });

  it('ausgeschaltet → Halt', () => {
    expect(r.beanspruchenUrteil({ status: 'pending', konfig: { ...konfig, aktiv: false }, tagBearbeitet: 0 }))
      .toEqual({ ok: false, grund: 'aus', halt: true });
  });

  it.each(['processing', 'resolved', 'no-data', 'error', 'uebersprungen', undefined])(
    'Status %s → nicht beanspruchen, aber weitermachen',
    (status) => {
      expect(r.beanspruchenUrteil({ status, konfig, tagBearbeitet: 0 }))
        .toEqual({ ok: false, grund: 'nicht_pending', halt: false });
    },
  );

  it('fehlender Zähler zählt als 0, Deckel 0 hält sofort', () => {
    expect(r.beanspruchenUrteil({ status: 'pending', konfig, tagBearbeitet: undefined }).ok).toBe(true);
    expect(r.beanspruchenUrteil({ status: 'pending', konfig: { ...konfig, tagesDeckel: 0 } }).grund).toBe('tagesdeckel');
  });
});

describe('serperUrteil', () => {
  it('genug Guthaben → ok', () => {
    expect(r.serperUrteil(1000, 1000)).toEqual({ ok: true });
  });
  it('unter der Grenze → Halt', () => {
    expect(r.serperUrteil(999, 1000)).toEqual({ ok: false, grund: 'serper_guthaben' });
  });
  it.each([null, undefined, NaN, '5000'])('unbekanntes Guthaben (%s) → Halt', (g) => {
    expect(r.serperUrteil(g, 1000)).toEqual({ ok: false, grund: 'serper_guthaben_unbekannt' });
  });
});

describe('fehlerFolgen (Prüfrunde 04.10.2026)', () => {
  it('am Barcode: bis zum fünften Fehler offen, dann error', () => {
    expect(r.fehlerFolgen({ code: 'fetch_unavailable', vorher: {} })).toMatchObject({ status: 'pending', dienstweit: false, errorCountPlus: 1, fehlerInFolge: 1 });
    expect(r.fehlerFolgen({ code: 'fetch_unavailable', vorher: { errorCount: 3 } }).status).toBe('pending');
    expect(r.fehlerFolgen({ code: 'anspruch_verloren', vorher: { errorCount: 4 } })).toMatchObject({ status: 'error', errorGrund: 'am_barcode' });
  });

  it.each(['extract_unavailable', 'search_unavailable', 'nicht_autorisiert', 'http_400', 'http_403', 'http_404', 'http_500', 'http_502', 'netz', 'nicht_verfuegbar', 'unerwartetes_ergebnis', 'infrastruktur'])(
    'dienstweit (%s): zählt nicht gegen den Barcode — auch nicht beim fünften', (code) => {
      const f = r.fehlerFolgen({ code, vorher: { errorCount: 4, fehlerInFolge: 4 } });
      expect(f).toMatchObject({ status: 'pending', dienstweit: true, errorCountPlus: 0, fehlerInFolge: 5 });
    },
  );

  it.each(['fetch_unavailable', 'anspruch_verloren'])('%s liegt am Barcode', (code) => {
    expect(r.istDienstweit(code)).toBe(false);
  });

  // Prüfrunde 2: ein Hänger (KI, Apify) ist kein Fehler am Barcode.
  it.each(['zeitlimit', 'zeitlimit_aufruf'])('%s ist dienstweit', (code) => {
    expect(r.istDienstweit(code)).toBe(true);
    expect(r.fehlerFolgen({ code, vorher: { errorCount: 4 } })).toMatchObject({ status: 'pending', errorCountPlus: 0, errorGrund: null });
  });

  it('zweimal in Folge alle Shopseiten gesperrt → error/abruf_gesperrt (Zyklus endet, Prüfrunde 2)', () => {
    const erst = r.fehlerFolgen({ code: 'fetch_unavailable', vorher: {} });
    expect(erst).toMatchObject({ status: 'pending', abrufGesperrtInFolge: 1, wartenMs: 6 * 3_600_000 });
    const zweit = r.fehlerFolgen({ code: 'fetch_unavailable', vorher: { errorCount: 1, fehlerInFolge: 1, abrufGesperrtInFolge: 1 } });
    expect(zweit).toMatchObject({ status: 'error', errorGrund: 'abruf_gesperrt', abrufGesperrtInFolge: 2 });
    // dazwischen ein anderer Fehler → zählt neu
    expect(r.fehlerFolgen({ code: 'anspruch_verloren', vorher: { abrufGesperrtInFolge: 1 } }).abrufGesperrtInFolge).toBe(0);
    // Apify-Konto (dienstweit erzwungen) zählt nicht als gesperrte Shopseite
    expect(r.fehlerFolgen({ code: 'fetch_unavailable', vorher: { abrufGesperrtInFolge: 1 }, dienstweit: true })).toMatchObject({ status: 'pending', abrufGesperrtInFolge: 0 });
  });

  it('Sicherheitsnetz: 12 Fehler jeder Art in Folge → error', () => {
    expect(r.fehlerFolgen({ code: 'extract_unavailable', vorher: { fehlerInFolge: 10 } }).status).toBe('pending');
    expect(r.fehlerFolgen({ code: 'extract_unavailable', vorher: { fehlerInFolge: 11 } }).status).toBe('error');
  });

  it('Wartezeit wächst: 30 min, 1 h, 2 h … höchstens 24 h', () => {
    const MIN = 60_000;
    expect([1, 2, 3, 4, 6, 7, 20].map(r.wartezeitMs)).toEqual([30 * MIN, 60 * MIN, 120 * MIN, 240 * MIN, 960 * MIN, 1440 * MIN, 1440 * MIN]);
  });

  it('Pause erst ab dem zweiten dienstweiten Fehler in Folge, wachsend bis 6 h', () => {
    const MIN = 60_000;
    expect([0, 1, 2, 3, 4, 5, 9].map(r.pauseNachDienstAusfall)).toEqual([0, 0, 30 * MIN, 60 * MIN, 120 * MIN, 240 * MIN, 360 * MIN]);
  });

  it('wartet', () => {
    expect(r.wartet(2000, 1000)).toBe(true);
    expect(r.wartet(1000, 1000)).toBe(false);
    expect(r.wartet(null, 1000)).toBe(false);
  });

  it('beanspruchenUrteil: wartender Fall wird übergangen, ohne den Lauf anzuhalten', () => {
    const konfig = { aktiv: true, tagesDeckel: 10 };
    expect(r.beanspruchenUrteil({ status: 'pending', konfig, tagBearbeitet: 0, naechsterVersuchAbMs: 2000, jetztMs: 1000 }))
      .toEqual({ ok: false, grund: 'wartet', halt: false });
    expect(r.beanspruchenUrteil({ status: 'pending', konfig, tagBearbeitet: 0, naechsterVersuchAbMs: 500, jetztMs: 1000 })).toEqual({ ok: true });
  });
});

describe('fundNachAbbruch', () => {
  const ABBRUCH = 1_000_000;
  it('nach Zeitlimit/Netzfehler: Fund jünger als der Versuch → ja', () => {
    expect(r.fundNachAbbruch({ letzterFehlerCode: 'zeitlimit_aufruf', processedAtMs: ABBRUCH }, ABBRUCH + 30_000)).toBe(true);
    expect(r.fundNachAbbruch({ letzterFehlerCode: 'netz', processedAtMs: ABBRUCH }, ABBRUCH - 60_000)).toBe(true);
  });
  it('alter Fund, anderer Fehler oder kein Fund → nein', () => {
    expect(r.fundNachAbbruch({ letzterFehlerCode: 'zeitlimit_aufruf', processedAtMs: ABBRUCH }, ABBRUCH - 3_600_000)).toBe(false);
    expect(r.fundNachAbbruch({ letzterFehlerCode: 'extract_unavailable', processedAtMs: ABBRUCH }, ABBRUCH + 1)).toBe(false);
    expect(r.fundNachAbbruch({ letzterFehlerCode: 'zeitlimit_aufruf', processedAtMs: ABBRUCH }, null)).toBe(false);
  });
});

describe('waehleBevorzugteUrl', () => {
  it('nimmt sourceUrl, sonst scrapedUrl', () => {
    expect(r.waehleBevorzugteUrl({ sourceUrl: 'https://www.dm.de/p/123' })).toBe('https://www.dm.de/p/123');
    expect(r.waehleBevorzugteUrl({ scrapedUrl: 'https://produkte.globus.de/x' })).toBe('https://produkte.globus.de/x');
  });
  it('nie openfoodfacts, nie kaputte oder fremde Schemata', () => {
    expect(r.waehleBevorzugteUrl({ sourceUrl: 'https://de.openfoodfacts.org/produkt/1' })).toBeNull();
    expect(r.waehleBevorzugteUrl({ sourceUrl: 'kein link' })).toBeNull();
    expect(r.waehleBevorzugteUrl({ sourceUrl: 'javascript:alert(1)' })).toBeNull();
    expect(r.waehleBevorzugteUrl(undefined)).toBeNull();
  });
});

describe('scrapeAnfrage', () => {
  it('neuer Fall: nur EAN und ohne OpenFoodFacts', () => {
    expect(r.scrapeAnfrage({ ean: '4006381333931', vorab: { art: 'suchen' }, grund: 'neu' }))
      .toEqual({ ean: '4006381333931', ohneOpenFoodFacts: true });
  });
  it('RCN-8: nurDomains', () => {
    const a = r.scrapeAnfrage({ ean: '20003180', vorab: r.vorabEntscheidung('20003180'), grund: 'nur_openfood' });
    expect(a.nurDomains).toEqual(r.RCN8_DOMAINS);
    expect(a.auffrischen).toBeUndefined();
  });
  it('Auffrischen: auffrischen + bevorzugteUrl', () => {
    expect(r.scrapeAnfrage({
      ean: '4006381333931', vorab: { art: 'suchen' }, grund: 'auffrischen', bevorzugteUrl: 'https://www.dm.de/p/1',
    })).toEqual({
      ean: '4006381333931', ohneOpenFoodFacts: true, auffrischen: true, bevorzugteUrl: 'https://www.dm.de/p/1',
    });
  });
  it('bevorzugteUrl nur beim Auffrischen', () => {
    expect(r.scrapeAnfrage({ ean: '1', vorab: {}, grund: 'neu', bevorzugteUrl: 'https://x.de' }).bevorzugteUrl).toBeUndefined();
  });
});

describe('ordneErgebnisZu', () => {
  const ok = (body) => ({ httpStatus: 200, body });

  it('Fund → resolved mit Shop', () => {
    expect(r.ordneErgebnisZu({ antwort: ok({ result: 'ok', successShop: 'dm' }), vorher: {} })).toEqual({
      art: 'fund', status: 'resolved', processedResult: 'ok', processedSource: 'dm',
      zaehler: 'gefunden', kostenAngefallen: true, laufAbbrechen: false,
    });
  });

  it('Fund ohne Shopnamen → scraper', () => {
    expect(r.ordneErgebnisZu({ antwort: ok({ result: 'ok' }), vorher: {} }).processedSource).toBe('scraper');
  });

  it.each(['all_failed', 'no_urls'])('%s ohne früheren Fund → no-data', (result) => {
    const e = r.ordneErgebnisZu({ antwort: ok({ result }), vorher: { grund: 'neu' } });
    expect(e).toMatchObject({ art: 'kein_fund', status: 'no-data', processedResult: result, zaehler: 'keineDaten' });
  });

  it('kein Fund bei früherem Fund → bleibt resolved, alte Daten bleiben', () => {
    const e = r.ordneErgebnisZu({
      antwort: ok({ result: 'all_failed' }),
      vorher: { grund: 'auffrischen', processedSource: 'globus', processedResult: 'ok' },
    });
    expect(e).toMatchObject({ art: 'kein_fund', status: 'resolved', processedResult: 'auffrischen_ohne_fund' });
    expect(e.processedSource).toBeUndefined();
  });

  it('auch eine zweite Auffrischung ohne Fund erkennt den früheren Fund', () => {
    expect(r.hatFruehererFund({ processedResult: 'auffrischen_ohne_fund' })).toBe(true);
    expect(r.hatFruehererFund({ processedSource: null, processedResult: 'all_failed' })).toBe(false);
  });

  it('neu angelegte Auffrischung (noch nie verarbeitet) mit Daten in nutritionscrape → nie no-data', () => {
    // Die Abfrage legt pending/auffrischen auch ohne früheren Fall an, wenn
    // bezahlt gefundene Daten älter als die Frist sind.
    const e = r.ordneErgebnisZu({
      antwort: ok({ result: 'all_failed' }),
      vorher: { grund: 'auffrischen', rohdatenVorhanden: true },
    });
    expect(e).toMatchObject({ art: 'kein_fund', status: 'resolved', processedResult: 'auffrischen_ohne_fund' });
    // Wieder geöffnetes 'no-data' ohne Daten bleibt no-data.
    expect(r.ordneErgebnisZu({
      antwort: ok({ result: 'all_failed' }),
      vorher: { grund: 'auffrischen', processedResult: 'all_failed', rohdatenVorhanden: false },
    }).status).toBe('no-data');
  });

  it('rohdatenVorhanden: Daten ja, reiner Fehlversuch-Marker nein', () => {
    expect(r.rohdatenVorhanden({ scrapedSource: 'scraper', attr_preis: 1.29 })).toBe(true);
    expect(r.rohdatenVorhanden({ gtin: '1', _failed: true, _failCount: 2 })).toBe(false);
    expect(r.rohdatenVorhanden(null)).toBe(false);
  });

  // Prüfrunde 3: Die Abfrage übernimmt ungeprüften Altbestand von
  // OpenFoodFacts-Seiten nie — als „früherer Fund" hielte er den Fall auf 'resolved'.
  it('rohdatenVorhanden: ungeprüfter Altbestand einer OpenFoodFacts-Seite zählt nicht', () => {
    const off = { scrapedSource: 'scraper', scrapedAt: 1, sourceShop: 'openfoodfacts', scrapedUrl: 'https://de.openfoodfacts.org/produkt/4000540031874/x' };
    expect(r.rohdatenVorhanden(off)).toBe(false);
    expect(r.rohdatenVorhanden({ ...off, scrapedUrl: undefined })).toBe(false); // nur der Shop-Name
    expect(r.rohdatenVorhanden({ ...off, sourceShop: 'world.openbeautyfacts.org', scrapedUrl: undefined })).toBe(false);
    // Belegter Fund (fetchedAt) bleibt ein Fund, ebenso Altbestand eines Shops.
    expect(r.rohdatenVorhanden({ ...off, fetchedAt: 2 })).toBe(true);
    expect(r.rohdatenVorhanden({ scrapedSource: 'scraper', scrapedAt: 1, sourceShop: 'globus', scrapedUrl: 'https://www.globus.de/p/1' })).toBe(true);
  });

  it.each([
    ['extract_unavailable', true], ['search_unavailable', true], ['fetch_unavailable', false], ['zeitlimit', true],
  ])('503 %s → Fehler, nie no-data; Lauf endet nur bei dienstweiten', (code, dienstweit) => {
    const e = r.ordneErgebnisZu({ antwort: { httpStatus: 503, body: { result: code } }, vorher: { errorCount: 1 } });
    expect(e).toMatchObject({
      art: 'fehler', status: 'pending', fehlerCode: code, zaehler: 'fehler', kostenAngefallen: true,
      dienstweit, laufAbbrechen: dienstweit, errorCountPlus: dienstweit ? 0 : 1, fehlerInFolge: 1,
    });
    // gesperrte Shopseiten: frühestens nach 6 h wieder (ein kurzer Apify-Ausfall sieht genauso aus)
    expect(e.wartenMs).toBe(code === 'fetch_unavailable' ? 6 * 3_600_000 : 30 * 60_000);
  });

  it('fetch_unavailable nach Infrastrukturfehler (Apify-Konto) → dienstweit; ohne → am Barcode', () => {
    const konto = r.ordneErgebnisZu({ antwort: { httpStatus: 503, body: { result: 'fetch_unavailable', extractErrors: 2 } }, vorher: {} });
    expect(konto).toMatchObject({ dienstweit: true, errorCountPlus: 0, laufAbbrechen: true });
    const gesperrt = r.ordneErgebnisZu({ antwort: { httpStatus: 503, body: { result: 'fetch_unavailable', extractErrors: 0, abrufFehler: 3 } }, vorher: {} });
    expect(gesperrt).toMatchObject({ dienstweit: false, errorCountPlus: 1, laufAbbrechen: false });
  });

  it('Quellseite hat Altdaten widerlegt → no-data (kein „alte Daten bleiben"), processedSource weg', () => {
    const e = r.ordneErgebnisZu({
      antwort: ok({ result: 'all_failed', altdatenWiderlegt: true }),
      vorher: { grund: 'auffrischen', processedSource: 'violey', processedResult: 'ok', rohdatenVorhanden: true },
    });
    expect(e).toMatchObject({ art: 'kein_fund', status: 'no-data', processedResult: 'quelle_widerlegt', processedSourceLoeschen: true });
  });

  it('fünfter Fehler in Folge → error', () => {
    const e = r.ordneErgebnisZu({ antwort: { httpStatus: 503, body: { result: 'fetch_unavailable' } }, vorher: { errorCount: 4 } });
    expect(e.status).toBe('error');
  });

  it('auch bei früherem Fund bleibt ein Fehler ein Fehler (kein resolved, kein no-data)', () => {
    const e = r.ordneErgebnisZu({
      antwort: { httpStatus: 503, body: { result: 'extract_unavailable' } },
      vorher: { processedSource: 'dm', grund: 'auffrischen' },
    });
    expect(e.status).toBe('pending');
    expect(e.processedResult).toBeUndefined();
  });

  it('401 → Fehler ohne Kosten, dienstweit (Schlüssel betrifft jeden Barcode)', () => {
    expect(r.ordneErgebnisZu({ antwort: { httpStatus: 401, text: 'Unauthorized' }, vorher: { errorCount: 4 } }))
      .toMatchObject({ art: 'fehler', fehlerCode: 'nicht_autorisiert', kostenAngefallen: false, laufAbbrechen: true, status: 'pending', errorCountPlus: 0 });
  });

  it('500 → Fehler mit Kosten (scrapeEan kann schon gesucht haben)', () => {
    expect(r.ordneErgebnisZu({ antwort: { httpStatus: 500, text: 'boom' }, vorher: {} }))
      .toMatchObject({ art: 'fehler', fehlerCode: 'http_500', kostenAngefallen: true });
  });

  it('Netzfehler und Zeitlimit des Aufrufs → Fehler', () => {
    expect(r.ordneErgebnisZu({ antwort: { netzFehler: 'ECONNRESET' }, vorher: {} }))
      .toMatchObject({ art: 'fehler', fehlerCode: 'netz', status: 'pending' });
    expect(r.ordneErgebnisZu({ antwort: { netzFehler: 'aborted', zeitlimit: true }, vorher: {} }))
      .toMatchObject({ art: 'fehler', fehlerCode: 'zeitlimit_aufruf' });
  });

  it('unbekanntes Ergebnis bei 200 → Fehler, nie no-data', () => {
    expect(r.ordneErgebnisZu({ antwort: ok({ result: 'neu_erfunden' }), vorher: {} }))
      .toMatchObject({ art: 'fehler', fehlerCode: 'unerwartetes_ergebnis', status: 'pending' });
    expect(r.ordneErgebnisZu({ antwort: { httpStatus: 200, text: '<html>' }, vorher: {} }).art).toBe('fehler');
  });

  it('Fehlertext ist begrenzt', () => {
    const e = r.ordneErgebnisZu({ antwort: { netzFehler: 'x'.repeat(2000) }, vorher: {} });
    expect(e.fehlerText.length).toBeLessThanOrEqual(500);
  });
});

describe('waehleKandidaten', () => {
  const k = (id, data) => ({ id, data });

  it('zuerst nach rang, dann Fälle ohne rang, ohne Dubletten', () => {
    const nachRang = [k('a', { rang: 3 }), k('b', { rang: 2 })];
    const nachHitCount = [k('c', { hitCount: 9 }), k('a', { rang: 3, hitCount: 5 }), k('d', { hitCount: 1 })];
    expect(r.waehleKandidaten({ nachRang, nachHitCount, grenze: 10 }).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('Grenze gilt für die Gesamtliste', () => {
    const nachRang = [k('a', { rang: 3 }), k('b', { rang: 2 })];
    expect(r.waehleKandidaten({ nachRang, nachHitCount: [k('c', {})], grenze: 2 }).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('Abfrage nach rang gescheitert → Reihenfolge nach hitCount, auch Fälle mit rang', () => {
    const nachHitCount = [k('c', { rang: 1, hitCount: 9 }), k('d', { hitCount: 1 })];
    expect(r.waehleKandidaten({ nachRang: null, nachHitCount, grenze: 10 }).map((x) => x.id)).toEqual(['c', 'd']);
  });

  it('beide gescheitert → leer', () => {
    expect(r.waehleKandidaten({ nachRang: null, nachHitCount: null, grenze: 5 })).toEqual([]);
  });
});
