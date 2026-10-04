'use strict';

/**
 * Ablauf eines Prozessor-Laufs (src/lauf.js) gegen eine Firestore-Attrappe:
 * Beanspruchen, Tagesdeckel, Serper-Grenze, Überspringen ohne Geld,
 * Ergebniszuordnung, verlorene Ansprüche, parallele Läufe.
 */

const { erstelleFakeFirestore, Zeit } = require('./helpers/fakeFirestore');
const { erstelleProzessor, SCRAPE_EAN_URL, SERPER_KONTO_URL } = require('../src/lauf');

const T0 = Date.UTC(2026, 9, 4, 10, 0); // 12:00 in Berlin
const TAG = '_meta/produktsuche_tage/tage/2026-10-04';
const KONFIG = '_meta/produktsuche';
const M = (ean) => `external_lookup_misses/${ean}`;

const EAN = '4006381333931';
const EAN2 = '96385074';
const EAN3 = '76123450';

/**
 * @param {object} o
 * @param {object|Function|Error} [o.serper]  Antwort des Serper-Kontos
 * @param {Function} [o.scrape]  (anfrage, umgebung) → { status, body } | { status, text } | Error
 */
function umgebung({
  serper = { status: 200, body: { balance: 5000, rateLimit: 50 } },
  scrape = () => ({ status: 200, body: { result: 'ok', successShop: 'dm' } }),
} = {}) {
  const uhr = { ms: T0 };
  const fake = erstelleFakeFirestore({ jetzt: () => uhr.ms });
  const aufrufe = { scrape: [], serper: 0, adressen: [] };
  const u = { fake, uhr, aufrufe };
  const fetchFn = async (url, opt) => {
    aufrufe.adressen.push(url);
    if (url === SERPER_KONTO_URL) {
      aufrufe.serper += 1;
      const s = typeof serper === 'function' ? serper(u) : serper;
      if (s instanceof Error) throw s;
      return { ok: s.status === 200, status: s.status, json: async () => s.body };
    }
    if (url === SCRAPE_EAN_URL) {
      const anfrage = JSON.parse(opt.body);
      aufrufe.scrape.push(anfrage);
      const a = await scrape(anfrage, u);
      if (a instanceof Error) throw a;
      return { status: a.status, text: async () => (a.text !== undefined ? a.text : JSON.stringify(a.body)) };
    }
    throw new Error(`unerwartete Adresse ${url}`);
  };
  const logs = [];
  const log = { log: (z) => logs.push(String(z)), warn: (z) => logs.push(String(z)), error: (z) => logs.push(String(z)) };
  let n = 0;
  const p = erstelleProzessor({
    db: fake.db,
    FieldValue: fake.FieldValue,
    Timestamp: fake.Timestamp,
    fetchFn,
    jetzt: () => uhr.ms,
    log,
    neueId: () => `lock-${(n += 1)}`,
  });
  u.logs = logs;
  u.lauf = (extra = {}) => p.lauf({ triggerKey: 'trigger-geheim', serperKey: 'serper-geheim', ...extra });
  u.fall = (ean, daten = {}) => fake.setze(M(ean), { ean, status: 'pending', hitCount: 2, rang: 1e13 + T0, ...daten });
  u.konfig = (daten) => fake.setze(KONFIG, daten);
  return u;
}

describe('ein Fund', () => {
  it('neuer Fall: eine bezahlte Suche, Status, Zähler, Schlüssel nur im Body', async () => {
    const u = umgebung();
    u.fall(EAN, { grund: 'neu' });

    const b = await u.lauf();

    expect(b).toMatchObject({ beansprucht: 1, gefunden: 1, keineDaten: 0, fehler: 0, angehalten: null, abbruch: null, serperRest: 5000 });
    expect(u.aufrufe.scrape).toEqual([{ ean: EAN, ohneOpenFoodFacts: true, key: 'trigger-geheim' }]);
    expect(u.aufrufe.adressen).toEqual([SERPER_KONTO_URL, SCRAPE_EAN_URL]);

    const f = u.fake.lies(M(EAN));
    expect(f).toMatchObject({ status: 'resolved', processedResult: 'ok', processedSource: 'dm' });
    expect(f.processedAt).toBeInstanceOf(Zeit);
    expect(f.lockAt).toBeUndefined();
    expect(f.lockId).toBeUndefined();
    expect(f.refreshVersuchtAm).toBeUndefined();

    const t = u.fake.lies(TAG);
    expect(t).toMatchObject({ tag: '2026-10-04', bearbeitet: 1, gefunden: 1, serperRest: 5000, kostenSchaetzungUsd: 0.016 });

    const alles = u.logs.join('\n');
    expect(alles).not.toMatch(/geheim/);
    expect(alles).toMatch(/"evt":"produktsuche_prozessor_lauf"/);
    expect(alles).not.toMatch(/"evt":"produktsuche_lauf"/);
    expect(alles).toMatch(/"evt":"produktsuche_ean"/);
  });

  it('ohne offene Fälle: kein Serper-Abruf, keine Suche', async () => {
    const u = umgebung();
    const b = await u.lauf();
    expect(b.kandidaten).toBe(0);
    expect(u.aufrufe.adressen).toEqual([]);
  });
});

describe('Reihenfolge', () => {
  it('nach rang absteigend, proLauf begrenzt, Serper nur einmal je Lauf', async () => {
    const u = umgebung();
    u.konfig({ proLauf: 2 });
    u.fall(EAN, { rang: 1 * 1e13 + T0 });
    u.fall(EAN2, { rang: 3 * 1e13 + T0 });
    u.fall(EAN3, { rang: 2 * 1e13 + T0 });

    const b = await u.lauf();

    expect(u.aufrufe.scrape.map((a) => a.ean)).toEqual([EAN2, EAN3]);
    expect(u.aufrufe.serper).toBe(1);
    expect(b.beansprucht).toBe(2);
    expect(u.fake.lies(M(EAN)).status).toBe('pending');
  });

  it('Fälle ohne rang kommen nach den Fällen mit rang dran (nicht unsichtbar)', async () => {
    const u = umgebung();
    u.konfig({ proLauf: 2 });
    u.fall(EAN, { rang: 1e13 + T0, hitCount: 1 });
    u.fall(EAN2, { rang: undefined, hitCount: 50 });

    const b = await u.lauf();

    expect(u.aufrufe.scrape.map((a) => a.ean)).toEqual([EAN, EAN2]);
    expect(b.ohneRang).toBe(1);
  });

  // Gültige EAN-13 (Präfix 400, laufende Nummer, Prüfziffer).
  const gueltig = (n) => {
    const basis = `400${String(n).padStart(9, '0')}`;
    const summe = basis.split('').reduce((acc, z, i) => acc + Number(z) * (i % 2 === 0 ? 1 : 3), 0);
    return basis + ((10 - (summe % 10)) % 10);
  };

  // Prüfrunde 3: Wartende behalten ihren rang und sammelten sich im festen
  // Fenster (proLauf + 25) — hochgedreht bezahlte der Prozessor stundenlang nichts.
  it('wartende Fälle oben verstopfen das Fenster nicht: es wird weitergelesen', async () => {
    const u = umgebung();
    u.konfig({ proLauf: 10, tagesDeckel: 1000 });
    const wartende = [];
    for (let i = 0; i < 40; i += 1) {
      const ean = gueltig(1000 + i);
      wartende.push(ean);
      u.fall(ean, { rang: 5e13 + i, naechsterVersuchAb: new Zeit(T0 + 6 * 3600_000), fehlerInFolge: 1 });
    }
    const offene = [];
    for (let i = 0; i < 20; i += 1) {
      const ean = gueltig(2000 + i);
      offene.push(ean);
      u.fall(ean, { rang: 1e13 + i });
    }
    const b = await u.lauf();
    expect(b.beansprucht).toBe(10);
    expect(u.aufrufe.scrape.every((a) => offene.includes(a.ean))).toBe(true);
    expect(b.wartend).toBe(40);
    expect(b.kandidatenKnapp).toBeUndefined();
    for (const ean of wartende) expect(u.fake.lies(M(ean)).status).toBe('pending');
  });

  it('auch nach der letzten erlaubten Seite nur Wartende → Stau am Tageszähler vermerkt, nichts bezahlt', async () => {
    const u = umgebung();
    for (let i = 0; i < 560; i += 1) {
      u.fall(gueltig(3000 + i), { rang: 5e13 + i, naechsterVersuchAb: new Zeit(T0 + 3600_000) });
    }
    u.fall(EAN, { rang: 1e13 });
    const b = await u.lauf();
    expect(b.beansprucht).toBe(0);
    expect(u.aufrufe.adressen).toEqual([]);
    expect(b.kandidatenKnapp).toBe(true);
    expect(u.fake.lies(TAG).kandidatenKnapp).toBe(1);
  });

  it('fehlt der Index für rang, gilt die Reihenfolge nach hitCount', async () => {
    const u = umgebung();
    u.fake.scheitern.orderBy.add('rang');
    u.fall(EAN, { rang: 9e13, hitCount: 1 });
    u.fall(EAN2, { rang: 1e13, hitCount: 9 });

    const b = await u.lauf();

    expect(u.aufrufe.scrape.map((a) => a.ean)).toEqual([EAN2]);
    expect(b.rangAbfrageGescheitert).toBe(true);
  });
});

describe('vor dem Bezahlen überspringen', () => {
  it('ungültige Nummer und Ladencode: ohne Geld, zählen nicht gegen proLauf', async () => {
    const u = umgebung();
    u.fall('4006381333932', { rang: 3e13 }); // falsche Prüfziffer
    u.fall('2001234012348', { rang: 2e13, errorCount: 2, processingError: 'alt' }); // Waage/Laden
    u.fall(EAN, { rang: 1e13 });

    const b = await u.lauf();

    expect(b).toMatchObject({ uebersprungen: 2, beansprucht: 1, gefunden: 1 });
    expect(u.aufrufe.scrape.map((a) => a.ean)).toEqual([EAN]);
    expect(u.fake.lies(M('4006381333932'))).toMatchObject({ status: 'uebersprungen', uebersprungenGrund: 'ungueltige_ean', processedResult: 'uebersprungen' });
    const laden = u.fake.lies(M('2001234012348'));
    expect(laden).toMatchObject({ status: 'uebersprungen', uebersprungenGrund: 'ladencode' });
    expect(laden.processedAt).toBeInstanceOf(Zeit);
    expect(laden.errorCount).toBeUndefined();
    expect(laden.processingError).toBeUndefined();
    expect(u.fake.lies(TAG)).toMatchObject({ uebersprungen: 2, bearbeitet: 1 });
  });

  it('nur zu Überspringendes: kein Serper-Abruf', async () => {
    const u = umgebung();
    u.fall('212345678909'); // UPC-A „2…" = Ladencode
    await u.lauf();
    expect(u.aufrufe.adressen).toEqual([]);
    expect(u.fake.lies(M('212345678909')).uebersprungenGrund).toBe('ladencode');
  });

  it('steht schon im Katalog (andere Schreibweise, anderes Feld) → im_katalog', async () => {
    const u = umgebung();
    u.fall('036000291452', { rang: 2e13 }); // UPC-A, Katalog führt die EAN-13
    u.fall(EAN, { rang: 1e13 });
    u.fake.setze('produkte/p1', { name: 'X', EANs: ['0036000291452'] });
    u.fake.setze('markenProdukte/m1', { name: 'Y', moreInformation: { EAN } });

    const b = await u.lauf();

    expect(b).toMatchObject({ uebersprungen: 2, beansprucht: 0 });
    expect(u.aufrufe.adressen).toEqual([]);
    expect(u.fake.lies(M('036000291452')).uebersprungenGrund).toBe('im_katalog');
    expect(u.fake.lies(M(EAN)).uebersprungenGrund).toBe('im_katalog');
    expect(u.logs.join('\n')).toMatch(/produktsuche_im_katalog.*produkte\/p1/);
  });

  it('Katalogprüfung nicht lesbar → keine Suche, Fall bleibt offen', async () => {
    const u = umgebung();
    u.fall(EAN);
    u.fake.scheitern.sammlungen.add('markenProdukte');

    const b = await u.lauf();

    expect(b.abbruch).toBe('katalog_unlesbar');
    expect(u.aufrufe.adressen).toEqual([]);
    expect(u.fake.lies(M(EAN)).status).toBe('pending');
  });
});

describe('Suchparameter', () => {
  it('RCN-8 sucht nur bei deutschen Händlern', async () => {
    const u = umgebung();
    u.fall('20003180', { grund: 'nur_openfood', bestSource: 'openfood' });
    await u.lauf();
    const a = u.aufrufe.scrape[0];
    expect(a.ohneOpenFoodFacts).toBe(true);
    expect(a.nurDomains).toEqual(expect.arrayContaining(['lidl.de', 'kaufland.de']));
    expect(a.auffrischen).toBeUndefined();
  });

  it('Auffrischen: gespeicherte Quellseite zuerst; ohne Fund bleibt der Fall resolved', async () => {
    const u = umgebung({ scrape: () => ({ status: 200, body: { result: 'all_failed', triedUrls: 4 } }) });
    u.fall(EAN, { grund: 'auffrischen', processedSource: 'globus', processedResult: 'ok' });
    u.fake.setze(`nutritionscrape/${EAN}`, { gtin: EAN, sourceUrl: 'https://produkte.globus.de/p/1', sourceShop: 'globus' });

    const b = await u.lauf();

    expect(u.aufrufe.scrape[0]).toMatchObject({ auffrischen: true, bevorzugteUrl: 'https://produkte.globus.de/p/1' });
    expect(b.keineDaten).toBe(1);
    const f = u.fake.lies(M(EAN));
    expect(f).toMatchObject({ status: 'resolved', processedResult: 'auffrischen_ohne_fund', processedSource: 'globus' });
    expect(f.refreshVersuchtAm).toBeInstanceOf(Zeit);
  });

  it('neu angelegte Auffrischung ohne Fund: Daten in nutritionscrape → resolved, nie no-data', async () => {
    const u = umgebung({ scrape: () => ({ status: 200, body: { result: 'all_failed' } }) });
    // So legt planeAbruf (external-product-lookup) den Fall an: ohne processedSource/processedResult.
    u.fall(EAN, { grund: 'auffrischen' });
    u.fake.setze(`nutritionscrape/${EAN}`, {
      gtin: EAN, scrapedSource: 'scraper', sourceUrl: 'https://www.rossmann.de/p/1', sourceShop: 'rossmann',
    });

    await u.lauf();

    expect(u.aufrufe.scrape[0]).toMatchObject({ auffrischen: true, bevorzugteUrl: 'https://www.rossmann.de/p/1' });
    const f = u.fake.lies(M(EAN));
    expect(f).toMatchObject({ status: 'resolved', processedResult: 'auffrischen_ohne_fund' });
    expect(f.refreshVersuchtAm).toBeInstanceOf(Zeit);
  });

  it('Auffrischen ohne gespeicherte Seite: volle Suche; Fund ersetzt die Quelle', async () => {
    const u = umgebung({ scrape: () => ({ status: 200, body: { result: 'ok', successShop: 'rossmann' } }) });
    u.fall(EAN, { grund: 'auffrischen', processedSource: 'globus', processedResult: 'ok' });

    await u.lauf();

    expect(u.aufrufe.scrape[0].bevorzugteUrl).toBeUndefined();
    expect(u.aufrufe.scrape[0].auffrischen).toBe(true);
    expect(u.fake.lies(M(EAN))).toMatchObject({ status: 'resolved', processedSource: 'rossmann', processedResult: 'ok' });
  });

  it('neuer Fall ohne Fund → no-data', async () => {
    const u = umgebung({ scrape: () => ({ status: 200, body: { result: 'no_urls' } }) });
    u.fall(EAN, { grund: 'neu', errorCount: 2, processingError: 'alt' });

    await u.lauf();

    const f = u.fake.lies(M(EAN));
    expect(f).toMatchObject({ status: 'no-data', processedResult: 'no_urls' });
    expect(f.errorCount).toBeUndefined();
    expect(f.processingError).toBeUndefined();
    expect(u.fake.lies(TAG)).toMatchObject({ keineDaten: 1, kostenSchaetzungUsd: 0.016 });
  });
});

describe('Fehler sind nie „keine Daten"', () => {
  it('503 dienstweit (KI): Fall bleibt offen, zählt NICHT gegen den Barcode, wartet; Lauf endet', async () => {
    const u = umgebung({ scrape: () => ({ status: 503, body: { result: 'extract_unavailable', error: 'Vertex 429' } }) });
    u.konfig({ proLauf: 3 });
    u.fall(EAN, { rang: 2e13 });
    u.fall(EAN2, { rang: 1e13 });

    const b = await u.lauf();

    expect(u.aufrufe.scrape).toHaveLength(1);
    expect(b).toMatchObject({ fehler: 1, abbruch: 'extract_unavailable' });
    const f = u.fake.lies(M(EAN));
    expect(f).toMatchObject({ status: 'pending', fehlerInFolge: 1, letzterFehlerCode: 'extract_unavailable' });
    expect(f.errorCount).toBeUndefined();
    expect(f.naechsterVersuchAb.toMillis()).toBe(T0 + 30 * 60_000);
    expect(f.processingError).toMatch(/extract_unavailable/);
    expect(f.processedResult).toBeUndefined();
    expect(u.fake.lies(M(EAN2)).status).toBe('pending');
    expect(u.fake.lies(TAG)).toMatchObject({ bearbeitet: 1, fehler: 1, kostenSchaetzungUsd: 0.016 });
  });

  it('fünfter Fehler am Barcode in Folge → error', async () => {
    const u = umgebung({ scrape: () => ({ status: 503, body: { result: 'fetch_unavailable' } }) });
    u.fall(EAN, { errorCount: 4, fehlerInFolge: 4 });
    await u.lauf();
    expect(u.fake.lies(M(EAN))).toMatchObject({ status: 'error', errorCount: 5, fehlerInFolge: 5 });
  });

  it('Fehler bei früherem Fund lässt das letzte inhaltliche Ergebnis stehen', async () => {
    const u = umgebung({ scrape: () => ({ status: 503, body: { result: 'search_unavailable' } }) });
    u.fall(EAN, { grund: 'auffrischen', processedSource: 'dm', processedResult: 'ok' });
    await u.lauf();
    expect(u.fake.lies(M(EAN))).toMatchObject({ status: 'pending', processedSource: 'dm', processedResult: 'ok', fehlerInFolge: 1 });
  });

  it('401: Lauf endet, keine Kosten', async () => {
    const u = umgebung({ scrape: () => ({ status: 401, text: 'Unauthorized' }) });
    u.fall(EAN);
    const b = await u.lauf();
    expect(b.abbruch).toBe('nicht_autorisiert');
    const t = u.fake.lies(TAG);
    expect(t.fehler).toBe(1);
    expect(t.kostenSchaetzungUsd).toBeUndefined();
  });

  it('Zeitlimit des Aufrufs → dienstweit (Prüfrunde 2): zählt nicht gegen den Barcode, Lauf endet', async () => {
    const e = new Error('The operation was aborted due to timeout');
    e.name = 'TimeoutError';
    const u = umgebung({ scrape: () => e });
    u.konfig({ proLauf: 3 });
    u.fall(EAN, { rang: 2e13 });
    u.fall(EAN2, { rang: 1e13 });
    const b = await u.lauf();
    expect(b.fehler).toBe(1);
    expect(b.abbruch).toBe('zeitlimit_aufruf');
    expect(u.aufrufe.scrape).toHaveLength(1);
    const f = u.fake.lies(M(EAN));
    expect(f).toMatchObject({ status: 'pending', letzterFehlerCode: 'zeitlimit_aufruf', fehlerInFolge: 1 });
    expect(f.errorCount).toBeUndefined();
  });

  it('zweimal in Folge alle Shopseiten gesperrt → error/abruf_gesperrt (keine weiteren bezahlten Wiederholungen)', async () => {
    const u = umgebung({ scrape: () => ({ status: 503, body: { result: 'fetch_unavailable', extractErrors: 0, abrufFehler: 2 } }) });
    u.fall(EAN);
    await u.lauf();
    expect(u.fake.lies(M(EAN))).toMatchObject({ status: 'pending', abrufGesperrtInFolge: 1, errorCount: 1 });
    // Nicht schon nach 30 min: ein kurzer Apify-Ausfall sähe genauso aus.
    u.uhr.ms += 31 * 60_000;
    await u.lauf();
    expect(u.aufrufe.scrape).toHaveLength(1);
    u.uhr.ms += 6 * 3_600_000;
    await u.lauf();
    const f = u.fake.lies(M(EAN));
    expect(f).toMatchObject({ status: 'error', errorGrund: 'abruf_gesperrt', abrufGesperrtInFolge: 2 });
    u.uhr.ms += 24 * 3_600_000;
    await u.lauf();
    expect(u.aufrufe.scrape).toHaveLength(2);
  });
});

describe('Tagesdeckel und Schalter', () => {
  it('Deckel erreicht: weder Serper noch Suche, Halt vermerkt', async () => {
    const u = umgebung();
    u.fall(EAN);
    u.fake.setze(TAG, { tag: '2026-10-04', bearbeitet: 120 });

    const b = await u.lauf();

    expect(b.angehalten).toBe('tagesdeckel');
    expect(u.aufrufe.adressen).toEqual([]);
    expect(u.fake.lies(TAG).angehalten).toBe('tagesdeckel');
    expect(u.fake.lies(M(EAN)).status).toBe('pending');
  });

  it('gedeckelter Lauf fragt den Katalog gar nicht mehr ab', async () => {
    const u = umgebung();
    u.fall(EAN);
    u.fake.setze(TAG, { tag: '2026-10-04', bearbeitet: 120 });
    u.fake.scheitern.sammlungen.add('produkte'); // würde jede Katalogabfrage scheitern lassen
    const b = await u.lauf();
    expect(b).toMatchObject({ angehalten: 'tagesdeckel', abbruch: null });
  });

  it('Deckel gilt über mehrere Läufe', async () => {
    const u = umgebung();
    u.konfig({ proLauf: 5, tagesDeckel: 2 });
    [EAN, EAN2, EAN3].forEach((e, i) => u.fall(e, { rang: (3 - i) * 1e13 }));

    const b1 = await u.lauf();
    const b2 = await u.lauf();

    expect(b1).toMatchObject({ beansprucht: 2, angehalten: 'tagesdeckel' });
    expect(b2).toMatchObject({ beansprucht: 0, angehalten: 'tagesdeckel' });
    expect(u.aufrufe.scrape).toHaveLength(2);
    expect(u.fake.lies(TAG).bearbeitet).toBe(2);
  });

  it('neuer Kalendertag (Berlin) → neuer Zähler', async () => {
    const u = umgebung();
    u.konfig({ tagesDeckel: 1 });
    u.fall(EAN, { rang: 2e13 });
    u.fall(EAN2, { rang: 1e13 });
    await u.lauf();
    u.uhr.ms = Date.UTC(2026, 9, 4, 22, 5); // 00:05 Berlin am 05.10.
    await u.lauf();
    expect(u.aufrufe.scrape).toHaveLength(2);
    expect(u.fake.lies('_meta/produktsuche_tage/tage/2026-10-05').bearbeitet).toBe(1);
  });

  it('zwei gleichzeitige Läufe: dieselbe EAN nie doppelt, der Deckel hält', async () => {
    const u = umgebung({
      scrape: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { status: 200, body: { result: 'ok', successShop: 'dm' } };
      },
    });
    u.konfig({ proLauf: 2, tagesDeckel: 3 });
    [EAN, EAN2, EAN3].forEach((e, i) => u.fall(e, { rang: (3 - i) * 1e13 }));

    await Promise.all([u.lauf(), u.lauf({ quelle: 'hand' }), u.lauf()]);

    const eans = u.aufrufe.scrape.map((a) => a.ean);
    expect(eans).toHaveLength(3);
    expect(new Set(eans).size).toBe(3);
    expect(u.fake.lies(TAG).bearbeitet).toBe(3);
  });

  it('aktiv: false → nichts, kein fremder Aufruf, Halt vermerkt', async () => {
    const u = umgebung();
    u.konfig({ aktiv: false });
    u.fall(EAN);
    const b = await u.lauf();
    expect(b.angehalten).toBe('aus');
    expect(u.aufrufe.adressen).toEqual([]);
    expect(u.fake.lies(TAG).angehalten).toBe('aus');
  });

  it('ungültige Geld-Grenze (Text statt Zahl) → Halt konfig_ungueltig, kein Geld, laut vermerkt', async () => {
    const u = umgebung();
    u.konfig({ tagesDeckel: 'zwanzig' });
    u.fall(EAN);
    const b = await u.lauf();
    expect(b.angehalten).toBe('konfig_ungueltig');
    expect(u.aufrufe.adressen).toEqual([]);
    expect(u.fake.lies(TAG)).toMatchObject({ angehalten: 'konfig_ungueltig', ungueltigeFelder: 'tagesDeckel' });
  });

  it('Ziffern als Text wirken (die Console legt Felder als Text an): tagesDeckel "1" hält nach einer Suche', async () => {
    const u = umgebung();
    u.konfig({ tagesDeckel: '1', proLauf: '5' });
    u.fall(EAN, { rang: 2e13 });
    u.fall(EAN2, { rang: 1e13 });
    const b = await u.lauf();
    expect(b.beansprucht).toBe(1);
    expect(b.angehalten).toBe('tagesdeckel');
  });

  it('proLauf 0 → Pause, ohne Halt am Tageszähler (steht in der Konfiguration)', async () => {
    const u = umgebung();
    u.konfig({ proLauf: 0 });
    u.fall(EAN);
    const b = await u.lauf();
    expect(b.angehalten).toBe('pausiert');
    expect(u.aufrufe.adressen).toEqual([]);
    expect(u.fake.lies(TAG)).toBeUndefined();
  });

  it('aktiv: false mitten im Lauf wirkt bei der nächsten Beanspruchung', async () => {
    const u = umgebung({
      scrape: (_a, umg) => {
        umg.fake.setze(KONFIG, { aktiv: false, proLauf: 3 });
        return { status: 200, body: { result: 'ok', successShop: 'dm' } };
      },
    });
    u.konfig({ proLauf: 3 });
    [EAN, EAN2, EAN3].forEach((e, i) => u.fall(e, { rang: (3 - i) * 1e13 }));

    const b = await u.lauf();

    expect(u.aufrufe.scrape).toHaveLength(1);
    expect(b.angehalten).toBe('aus');
  });

  it('Konfiguration nicht lesbar → kein Lauf (ein Lesefehler hebt keinen Halt auf)', async () => {
    const u = umgebung();
    u.fall(EAN);
    u.fake.scheitern.dokumente.add(KONFIG);
    const b = await u.lauf();
    expect(b.abbruch).toBe('konfig_unlesbar');
    expect(u.aufrufe.adressen).toEqual([]);
  });
});

describe('Serper-Guthaben', () => {
  it('unter der Mindestgrenze → Halt, Guthaben am Tageszähler', async () => {
    const u = umgebung({ serper: { status: 200, body: { balance: 999 } } });
    u.fall(EAN);
    const b = await u.lauf();
    expect(b).toMatchObject({ angehalten: 'serper_guthaben', serperRest: 999, beansprucht: 0 });
    expect(u.aufrufe.scrape).toHaveLength(0);
    expect(u.fake.lies(TAG)).toMatchObject({ angehalten: 'serper_guthaben', serperRest: 999 });
    expect(u.fake.lies(M(EAN)).status).toBe('pending');
  });

  it('Mindestgrenze aus der Konfiguration', async () => {
    const u = umgebung({ serper: { status: 200, body: { balance: 999 } } });
    u.konfig({ serperMindestGuthaben: 500 });
    u.fall(EAN);
    expect((await u.lauf()).beansprucht).toBe(1);
  });

  it.each([
    ['HTTP 500', { status: 500, body: {} }],
    ['Antwort ohne balance', { status: 200, body: { credits: 5 } }],
    ['Netzfehler', new Error('ECONNRESET')],
  ])('nicht lesbar (%s) → Halt', async (_n, serper) => {
    const u = umgebung({ serper });
    u.fall(EAN);
    const b = await u.lauf();
    expect(b.angehalten).toBe('serper_guthaben_unbekannt');
    expect(u.aufrufe.scrape).toHaveLength(0);
  });

  it('kein Schlüssel → Halt ohne Abruf', async () => {
    const u = umgebung();
    u.fall(EAN);
    const b = await u.lauf({ serperKey: '' });
    expect(b.angehalten).toBe('serper_guthaben_unbekannt');
    expect(u.aufrufe.adressen).toEqual([]);
  });

  it('ein früherer Halt wird mit der nächsten Beanspruchung aufgehoben', async () => {
    const u = umgebung();
    u.fall(EAN);
    u.fake.setze(TAG, { tag: '2026-10-04', angehalten: 'serper_guthaben', serperRest: 800 });
    await u.lauf();
    const t = u.fake.lies(TAG);
    expect(t.angehalten).toBeUndefined();
    expect(t.serperRest).toBe(5000);
  });
});

describe('Ansprüche', () => {
  it('Fall wurde zwischen Abfrage und Beanspruchung abgeschlossen → wird übergangen', async () => {
    const u = umgebung({
      serper: (umg) => {
        umg.fake.setze(M(EAN), { ean: EAN, status: 'resolved', rang: 2e13 });
        return { status: 200, body: { balance: 5000 } };
      },
    });
    u.fall(EAN, { rang: 2e13 });
    u.fall(EAN2, { rang: 1e13 });

    await u.lauf();

    expect(u.aufrufe.scrape.map((a) => a.ean)).toEqual([EAN2]);
    expect(u.fake.lies(M(EAN)).status).toBe('resolved');
  });

  it('fremder Anspruch während der Suche → Fall bleibt unberührt, Zähler zählen trotzdem', async () => {
    const u = umgebung({
      scrape: (_a, umg) => {
        const f = umg.fake.lies(M(EAN));
        umg.fake.setze(M(EAN), { ...f, lockId: 'fremd' });
        return { status: 200, body: { result: 'ok', successShop: 'dm' } };
      },
    });
    u.fall(EAN);

    await u.lauf();

    expect(u.fake.lies(M(EAN))).toMatchObject({ status: 'processing', lockId: 'fremd' });
    expect(u.fake.lies(TAG).gefunden).toBe(1);
    expect(u.logs.join('\n')).toMatch(/"anspruchVerloren":true/);
  });

  it('verlorene Ansprüche (älter als 30 min) werden freigegeben und zählen als Fehler', async () => {
    const u = umgebung();
    u.konfig({ aktiv: false });
    u.fake.setze(M(EAN), { ean: EAN, status: 'processing', lockAt: new Zeit(T0 - 31 * 60_000), lockId: 'alt', errorCount: 1 });
    u.fake.setze(M(EAN2), { ean: EAN2, status: 'processing', lockAt: new Zeit(T0 - 40 * 60_000), errorCount: 4 });
    u.fake.setze(M(EAN3), { ean: EAN3, status: 'processing', lockAt: new Zeit(T0 - 5 * 60_000), lockId: 'laeuft' });

    const b = await u.lauf();

    expect(b.freigegebeneAnsprueche).toBe(2);
    const a = u.fake.lies(M(EAN));
    expect(a).toMatchObject({ status: 'pending', errorCount: 2, fehlerInFolge: 1, letzterFehlerCode: 'anspruch_verloren' });
    expect(a.naechsterVersuchAb.toMillis()).toBe(T0 + 30 * 60_000);
    expect(a.lockAt).toBeUndefined();
    expect(a.lockId).toBeUndefined();
    expect(u.fake.lies(M(EAN2))).toMatchObject({ status: 'error', errorCount: 5 });
    expect(u.fake.lies(M(EAN3))).toMatchObject({ status: 'processing', lockId: 'laeuft' });
    expect(u.fake.lies(TAG).fehler).toBe(2);
  });

  it('nach 280 s Laufzeit beginnt keine neue Suche', async () => {
    const u = umgebung({
      scrape: (_a, umg) => {
        umg.uhr.ms += 300_000;
        return { status: 200, body: { result: 'ok', successShop: 'dm' } };
      },
    });
    u.konfig({ proLauf: 3 });
    u.fall(EAN, { rang: 2e13 });
    u.fall(EAN2, { rang: 1e13 });

    const b = await u.lauf();

    expect(b).toMatchObject({ beansprucht: 1, zeitbudgetErreicht: true });
    expect(u.fake.lies(M(EAN2)).status).toBe('pending');
  });
});

describe('Fehlerklassen und Pause (Prüfrunde 04.10.2026)', () => {
  const ZUSTAND = '_meta/produktsuche_tage';

  it('12 Läufe mit 401 bringen die meistgefragten Barcodes NICHT auf error; ab dem zweiten in Folge pausiert der Prozessor', async () => {
    const u = umgebung({ scrape: () => ({ status: 401, text: 'Unauthorized' }) });
    u.fall(EAN, { rang: 2e13 });
    u.fall(EAN2, { rang: 1e13 });

    const berichte = [];
    for (let i = 0; i < 12; i += 1) {
      berichte.push(await u.lauf());
      u.uhr.ms += 10 * 60_000;
    }

    expect(u.fake.lies(M(EAN)).status).toBe('pending');
    expect(u.fake.lies(M(EAN2)).status).toBe('pending');
    expect(u.fake.lies(M(EAN)).errorCount).toBeUndefined();
    // Lauf 1: EAN, Lauf 2: EAN2 (EAN wartet) → zweiter in Folge → Pause 30 min
    expect(u.aufrufe.scrape.map((a) => a.ean).slice(0, 2)).toEqual([EAN, EAN2]);
    expect(berichte[1].angehalten).toBe('dienst_ausfall');
    expect(berichte[2]).toMatchObject({ angehalten: 'dienst_ausfall', beansprucht: 0 });
    expect(u.aufrufe.scrape.length).toBeLessThan(6);
    expect(u.fake.lies(TAG).angehalten).toBe('dienst_ausfall');
    expect(u.fake.lies(ZUSTAND).dienstAusfallInFolge).toBeGreaterThanOrEqual(2);
  });

  it('ein einzelner dienstweiter Fehler pausiert nicht; ein Erfolg setzt den Zähler zurück', async () => {
    let n = 0;
    const u = umgebung({
      scrape: () => ((n += 1) === 1
        ? { status: 503, body: { result: 'extract_unavailable' } }
        : { status: 200, body: { result: 'ok', successShop: 'dm' } }),
    });
    u.fall(EAN, { rang: 2e13 });
    u.fall(EAN2, { rang: 1e13 });
    const b1 = await u.lauf();
    expect(b1.angehalten).toBeNull();
    expect(u.fake.lies(ZUSTAND)).toMatchObject({ dienstAusfallInFolge: 1 });
    u.uhr.ms += 10 * 60_000;
    const b2 = await u.lauf();
    expect(b2).toMatchObject({ gefunden: 1, wartend: 1 });
    expect(u.aufrufe.scrape.map((a) => a.ean)).toEqual([EAN, EAN2]);
    expect(u.fake.lies(ZUSTAND).dienstAusfallInFolge).toBe(0);
  });

  it('wartender Fall wird übergangen, nach Ablauf der Wartezeit wieder versucht', async () => {
    const u = umgebung();
    u.fall(EAN, { rang: 2e13, naechsterVersuchAb: new Zeit(T0 + 60_000), fehlerInFolge: 1, letzterFehlerCode: 'fetch_unavailable' });
    u.fall(EAN2, { rang: 1e13 });
    const b = await u.lauf();
    expect(b.wartend).toBe(1);
    expect(u.aufrufe.scrape.map((a) => a.ean)).toEqual([EAN2]);
    u.uhr.ms += 2 * 60_000;
    await u.lauf();
    expect(u.aufrufe.scrape.map((a) => a.ean)).toEqual([EAN2, EAN]);
    const f = u.fake.lies(M(EAN));
    expect(f).toMatchObject({ status: 'resolved' });
    for (const k of ['naechsterVersuchAb', 'fehlerInFolge', 'letzterFehlerCode']) expect(f[k]).toBeUndefined();
  });

  // Prüfrunde 2: 28.09.–02.10.2026 beantwortete Vertex Anfragen minutenlang
  // nicht. Ein Hänger kommt als Abbruch nach 240 s an, nicht als 503.
  it('hängende KI über 12 Läufe: kein Barcode auf error, ab dem zweiten Abbruch in Folge Pause', async () => {
    const haenger = new Error('The operation was aborted due to timeout');
    haenger.name = 'TimeoutError';
    const u = umgebung({ scrape: () => haenger });
    u.konfig({ proLauf: 3 });
    for (const [i, ean] of [EAN, EAN2, EAN3].entries()) u.fall(ean, { rang: (3 - i) * 1e13 });

    const berichte = [];
    for (let i = 0; i < 12; i += 1) {
      berichte.push(await u.lauf());
      u.uhr.ms += 10 * 60_000;
    }

    for (const ean of [EAN, EAN2, EAN3]) {
      const f = u.fake.lies(M(ean));
      expect(f.status).toBe('pending');
      expect(f.errorCount).toBeUndefined();
    }
    expect(berichte[0]).toMatchObject({ beansprucht: 1, abbruch: 'zeitlimit_aufruf' });
    expect(berichte[1].angehalten).toBe('dienst_ausfall');
    expect(berichte[2]).toMatchObject({ angehalten: 'dienst_ausfall', beansprucht: 0 });
    expect(u.aufrufe.scrape.length).toBeLessThan(6);
  });

  it('Pause gilt über Mitternacht (Zustand nicht am Tageszähler)', async () => {
    const u = umgebung();
    u.fall(EAN);
    // Pause gesetzt am 04.10. 21:55 Berlin für eine Stunde, bis 05.10. 00:55 Berlin
    u.fake.setze(ZUSTAND, { dienstAusfallInFolge: 3, pausiertBisMs: Date.UTC(2026, 9, 4, 22, 55) });
    u.uhr.ms = Date.UTC(2026, 9, 4, 22, 30); // 00:30 Berlin am 05.10., Pause läuft noch
    const b = await u.lauf();
    expect(b.angehalten).toBe('dienst_ausfall');
    expect(u.aufrufe.adressen).toEqual([]);
  });
});

describe('Auffrischen: widerlegte Quellseite und Lesefehler', () => {
  it('altdatenWiderlegt → no-data/quelle_widerlegt, früherer Fund vergessen', async () => {
    const u = umgebung({ scrape: () => ({ status: 200, body: { result: 'all_failed', altdatenWiderlegt: true } }) });
    u.fall(EAN, { grund: 'auffrischen', processedSource: 'violey', processedResult: 'ok' });
    u.fake.setze(`nutritionscrape/${EAN}`, { gtin: EAN, scrapedSource: 'scraper', sourceUrl: 'https://www.violey.com/p', sourceShop: 'violey.com' });
    await u.lauf();
    const f = u.fake.lies(M(EAN));
    expect(f).toMatchObject({ status: 'no-data', processedResult: 'quelle_widerlegt' });
    expect(f.processedSource).toBeUndefined();
  });

  it('gespeicherter Fund nicht lesbar → nichts bezahlt, Fall bleibt offen (nie no-data aus einem Lesefehler)', async () => {
    const u = umgebung({ scrape: () => ({ status: 200, body: { result: 'all_failed' } }) });
    u.fall(EAN, { grund: 'auffrischen' });
    u.fake.scheitern.dokumente.add(`nutritionscrape/${EAN}`);
    const b = await u.lauf();
    expect(b.abbruch).toBe('fund_unlesbar');
    expect(u.aufrufe.scrape).toHaveLength(0);
    expect(u.fake.lies(M(EAN)).status).toBe('pending');
    expect(u.fake.lies(TAG)).toBeUndefined();
  });
});

describe('Fund nach abgebrochenem Aufruf', () => {
  it('scrapeEan lief nach dem Abbruch weiter und fand etwas → resolved ohne neue Suche', async () => {
    const u = umgebung();
    u.fall(EAN, { letzterFehlerCode: 'zeitlimit_aufruf', processedAt: new Zeit(T0 - 40 * 60_000), errorCount: 1, fehlerInFolge: 1, naechsterVersuchAb: new Zeit(T0 - 10 * 60_000) });
    u.fake.setze(`nutritionscrape/${EAN}`, { gtin: EAN, scrapedSource: 'scraper', fetchedAt: new Zeit(T0 - 38 * 60_000), sourceShop: 'rossmann' });
    const b = await u.lauf();
    expect(b).toMatchObject({ nachgetragen: 1, beansprucht: 0 });
    expect(u.aufrufe.adressen).toEqual([]);
    const f = u.fake.lies(M(EAN));
    expect(f).toMatchObject({ status: 'resolved', processedResult: 'ok_nach_zeitlimit', processedSource: 'rossmann' });
    for (const k of ['errorCount', 'fehlerInFolge', 'naechsterVersuchAb', 'letzterFehlerCode']) expect(f[k]).toBeUndefined();
  });

  it('kein neuerer Fund → normal bezahlt suchen', async () => {
    const u = umgebung();
    u.fall(EAN, { letzterFehlerCode: 'zeitlimit_aufruf', processedAt: new Zeit(T0 - 40 * 60_000) });
    u.fake.setze(`nutritionscrape/${EAN}`, { gtin: EAN, scrapedSource: 'scraper', fetchedAt: new Zeit(T0 - 90 * 24 * 3_600_000) });
    const b = await u.lauf();
    expect(b).toMatchObject({ nachgetragen: 0, beansprucht: 1 });
  });
});
