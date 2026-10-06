/**
 * Nachpflege Oktober 2026 (scripts/nachpflegePlan.js): was an bestehenden
 * external_products- und external_lookup_misses-Dokumenten nachgetragen wird.
 * Reine Funktionen, kein Firestore. Die Beispiel-Dokumente sind echte Bestände
 * vom 04.10.2026 (nur die Felder, die die Planung liest).
 *
 * @jest-environment node
 */

'use strict';

const { RANG_FAKTOR, rangFuer: rangVon } = require('../lib/abrufPlan');
const {
  QUELLE,
  ausNutritionscrape,
  datenstandVon,
  planeProdukt,
  scanTageUntergrenze,
  planeMiss,
  sichtProdukt,
  sichtMiss,
  felderZumSchreiben,
} = require('../scripts/nachpflegePlan');

const t = (iso) => Date.parse(iso);
const ts = (iso) => ({ toMillis: () => Date.parse(iso) }); // wie ein admin-Timestamp

// external_products/20003180 (Lidl-Kurznummer RCN-8): erst OpenFoodFacts-API,
// dann von der openfoodfacts-WEBSEITE über die Suche ergänzt — der Platzhalter
// 'Produkt' hat den echten Namen überschrieben, raw.product_name hat ihn noch.
const GOLDEN_PUFFS = {
  source: 'openfoodfacts',
  productName: 'Produkt',
  cachedAt: ts('2026-09-22T15:22:27.542Z'),
  brandName: 'Crownfield',
  raw: { product_name: 'Golden Puffs', generic_name: '', scrapedSource: 'scraper', sourceShop: 'openfoodfacts', scrapedAt: ts('2026-07-24T14:11:22.774Z'), code: '20003180', brands: 'Crownfield' },
};
const GOLDEN_PUFFS_ANGELEGT = t('2026-07-24T13:51:11.460Z');

describe('ausNutritionscrape', () => {
  it('Kopie aus der Suche → ja; REWE-Merkmale gewinnen auch bei zusammengeführtem raw', () => {
    expect(ausNutritionscrape({ scrapedSource: 'scraper', sourceShop: 'rossmann.de' })).toBe(true);
    expect(ausNutritionscrape({ scrapedSource: 'scraper', merchant_company: 'Rewe', price_current: 1.99 })).toBe(false);
    expect(ausNutritionscrape({ scrapedSource: 'scraper', thumbnails: ['x'] })).toBe(false);
    expect(ausNutritionscrape({ product_name: 'Milch' })).toBe(false);
    expect(ausNutritionscrape(null)).toBe(false);
  });
});

describe('datenstandVon — fetchedAt nach Quelle', () => {
  it('OpenFoodFacts-API: cachedAt ist die Abrufzeit, genau — auch mit Resten einer Such-Kopie in raw', () => {
    expect(datenstandVon({ source: 'openfood', cachedAtMs: 1000, raw: { product_name: 'x' } })).toEqual({ fetchedAtMs: 1000, geschaetzt: false, quelle: QUELLE.OPENFOOD_API });
    expect(datenstandVon({ source: 'openfood', cachedAtMs: 1000, raw: { product_name: 'x', scrapedSource: 'scraper', scrapedAtMs: 1 } })).toEqual({ fetchedAtMs: 1000, geschaetzt: false, quelle: QUELLE.OPENFOOD_API });
  });

  it('Suche mit fetchedAt der Kopie → genau', () => {
    expect(datenstandVon({ source: 'rossmann', cachedAtMs: 9000, raw: { scrapedSource: 'scraper', scrapedAtMs: 8000, fetchedAtMs: 7000 } })).toEqual({ fetchedAtMs: 7000, geschaetzt: false, quelle: QUELLE.NUTRITIONSCRAPE });
  });

  it('Suche nur mit scrapedAt → Schätzung, NICHT cachedAt (das ist die Umkopierzeit)', () => {
    const s = datenstandVon(sichtProdukt(GOLDEN_PUFFS, GOLDEN_PUFFS_ANGELEGT));
    expect(s).toEqual({ fetchedAtMs: t('2026-07-24T14:11:22.774Z'), geschaetzt: true, quelle: QUELLE.NUTRITIONSCRAPE });
  });

  it('Suche ohne jeden Zeitpunkt in der Kopie → cachedAt als Schätzung', () => {
    expect(datenstandVon({ source: 'budni', cachedAtMs: 5000, raw: { scrapedSource: 'scraper' } })).toEqual({ fetchedAtMs: 5000, geschaetzt: true, quelle: QUELLE.NUTRITIONSCRAPE });
  });

  it('REWE-Pipeline (reweapify, scraped_products) → unbekannt, null', () => {
    const erwartet = { fetchedAtMs: null, geschaetzt: false, quelle: QUELLE.REWE_PIPELINE };
    expect(datenstandVon({ source: 'rewe', cachedAtMs: 5000, raw: { merchant_company: 'Rewe', price_current: 1.29, url: 'u' } })).toEqual(erwartet);
    expect(datenstandVon({ source: 'rewe', cachedAtMs: 5000, raw: { thumbnails: ['a'], url: 'u' } })).toEqual(erwartet);
    expect(datenstandVon({ source: 'rewe', cachedAtMs: 5000, raw: { url: 'u' } })).toEqual(erwartet);
    // zusammengeführt: früher Suche, später reweapify → REWE gewinnt
    expect(datenstandVon({ source: 'rewe', cachedAtMs: 5000, raw: { scrapedSource: 'scraper', scrapedAtMs: 1, merchant_company: 'Rewe' } })).toEqual(erwartet);
  });

  it('nicht zuzuordnen → cachedAt als Schätzung, ohne Quellenangabe (heute kein Fall)', () => {
    expect(datenstandVon({ source: 'globus', cachedAtMs: 4000, raw: { thumbnails: undefined } })).toEqual({ fetchedAtMs: 4000, geschaetzt: true, quelle: null });
    expect(planeProdukt(sichtProdukt({ source: 'globus', cachedAt: { toMillis: () => 4000 } }, 1)).setzen).toEqual({ storedAtMs: 1, fetchedAtMs: 4000, fetchedAtGeschaetzt: true });
  });
});

describe('planeProdukt', () => {
  it('echter Bestand Golden Puffs: storedAt, geschätzter Datenstand, Name repariert', () => {
    const p = planeProdukt(sichtProdukt(GOLDEN_PUFFS, GOLDEN_PUFFS_ANGELEGT));
    expect(p.setzen).toEqual({
      storedAtMs: GOLDEN_PUFFS_ANGELEGT,
      fetchedAtMs: t('2026-07-24T14:11:22.774Z'),
      fetchedAtQuelle: 'nutritionscrape',
      fetchedAtGeschaetzt: true,
      productName: 'Golden Puffs',
      nameQuelle: 'openfood',
    });
    expect(p.nameRepariert).toEqual({ alt: 'Produkt', neu: 'Golden Puffs' });
  });

  it('schon vom neuen Code geschrieben → nichts (auch fetchedAt: null zählt als vorhanden)', () => {
    const p = planeProdukt(sichtProdukt({ ...GOLDEN_PUFFS, productName: 'Golden Puffs', storedAt: ts('2026-07-24T13:51:11Z'), fetchedAt: null }, GOLDEN_PUFFS_ANGELEGT));
    expect(p.setzen).toEqual({});
    expect(p.quelle).toBeNull();
  });

  it('Platzhalter ohne echten Namen in raw → bleibt stehen, wird gezählt', () => {
    const p = planeProdukt(sichtProdukt({ source: 'rossmann', productName: 'Produkt', storedAt: ts('2026-01-01T00:00:00Z'), fetchedAt: null, raw: { scrapedSource: 'scraper', product_name: '   ' } }, 1));
    expect(p.setzen).toEqual({});
    expect(p.platzhalterOhneErsatz).toBe(true);
  });

  it('wie der Schreibweg: ohne product_name zählt generic_name', () => {
    expect(planeProdukt(sichtProdukt({ source: 'openfoodfacts', productName: 'Produkt', raw: { scrapedSource: 'scraper', product_name: '', generic_name: 'Gewürzgurken' } }, 1)).setzen.productName).toBe('Gewürzgurken');
  });

  it('auch „Unbekannt" ist ein Platzhalter; echte Namen bleiben unberührt', () => {
    expect(planeProdukt(sichtProdukt({ source: 'openfood', productName: 'unbekannt', raw: { product_name: 'Hafer Drink' } }, 1)).setzen.productName).toBe('Hafer Drink');
    expect(planeProdukt(sichtProdukt({ source: 'openfood', productName: 'Milka Alpenmilch', raw: { product_name: 'Anderer Name' } }, 1)).setzen.productName).toBeUndefined();
  });

  it('kein Name gespeichert → kein Platzhalter, nichts zu reparieren', () => {
    const p = planeProdukt(sichtProdukt({ source: 'openfood', raw: { product_name: 'X' } }, 1));
    expect(p.nameRepariert).toBeNull();
    expect(p.platzhalterOhneErsatz).toBe(false);
  });

  // Prüfrunde 2: kein glaubwürdiger Name über fremden Daten.
  it('fremder Altbestand (20006204, Reiniger-Zutaten von gastro-direkt) → Name NICHT gerettet, gemeldet', () => {
    const { altbestand } = require('./helfer/altbestand');
    const { ep } = altbestand('20006204');
    const p = planeProdukt(sichtProdukt(ep, 1, '20006204'));
    expect(p.altbestandAbgelehnt).toBe('haendlercode_fremder_shop');
    expect(p.setzen.productName).toBeUndefined();
    expect(p.nameRepariert).toBeNull();
    expect(p.setzen.storedAtMs).toBe(1); // die Zeitstempel trägt sie trotzdem nach
  });

  it('Golden Puffs (RCN-8 von der OpenFoodFacts-Webseite) bleibt: dort entscheidet die API', () => {
    const p = planeProdukt(sichtProdukt(GOLDEN_PUFFS, GOLDEN_PUFFS_ANGELEGT, '20003180'));
    expect(p.altbestandAbgelehnt).toBeNull();
    expect(p.setzen.productName).toBe('Golden Puffs');
  });
});

describe('scanTageUntergrenze — Kalendertage Europe/Berlin', () => {
  it('über Mitternacht UTC, aber derselbe Berliner Tag → 1', () => {
    expect(scanTageUntergrenze(t('2026-10-03T22:30:00Z'), t('2026-10-04T10:00:00Z'))).toBe(1);
  });
  it('derselbe UTC-Tag, aber Berliner Mitternacht dazwischen → 2', () => {
    expect(scanTageUntergrenze(t('2026-10-03T21:30:00Z'), t('2026-10-03T22:30:00Z'))).toBe(2);
  });
  it('fehlender Zeitpunkt → 1', () => {
    expect(scanTageUntergrenze(null, 5)).toBe(1);
  });
});

describe('planeMiss', () => {
  // Echte offene Fälle vom 04.10.2026: viele Treffer in 90 Sekunden (eine Person
  // scannt mehrfach) gegen wenige Treffer über acht Wochen.
  const OFT_KURZ = { status: 'pending', hitCount: 8, firstSeenAt: ts('2026-10-04T14:47:27.421Z'), lastSeenAt: ts('2026-10-04T14:48:47.916Z') };
  const LANG = { status: 'pending', hitCount: 9, firstSeenAt: ts('2026-08-07T08:02:12.328Z'), lastSeenAt: ts('2026-10-04T14:46:52.602Z') };

  it('offener Fall ohne Felder → scanTage (geschätzt), letzterScanTag, rang', () => {
    const p = planeMiss(sichtMiss(LANG, 1));
    expect(p.setzen).toEqual({
      scanTage: 2,
      scanTageGeschaetzt: true,
      letzterScanTag: '2026-10-04',
      rang: 2 * RANG_FAKTOR + t('2026-10-04T14:46:52.602Z'),
    });
  });

  it('mehrere Tage schlagen viele Treffer an einem Tag — trotz späterem letzten Scan', () => {
    expect(planeMiss(sichtMiss(LANG, 1)).rang).toBeGreaterThan(planeMiss(sichtMiss(OFT_KURZ, 1)).rang);
  });

  it('abgeschlossene Fälle bekommen nichts', () => {
    for (const status of ['resolved', 'no-data', 'error', 'uebersprungen', null]) {
      expect(planeMiss(sichtMiss({ ...LANG, status }, 1))).toMatchObject({ offen: false, setzen: {} });
    }
  });

  it('processing gilt als offen', () => {
    expect(planeMiss(sichtMiss({ ...LANG, status: 'processing' }, 1)).offen).toBe(true);
  });

  it('vom neuen Code schon gezählte scanTage bleiben; fehlender Rang wird daraus gerechnet', () => {
    const p = planeMiss(sichtMiss({ ...LANG, scanTage: 5, letzterScanTag: '2026-10-04' }, 1));
    expect(p.setzen).toEqual({ rang: rangVon(5, t('2026-10-04T14:46:52.602Z')) });
  });

  it('alles vorhanden → nichts', () => {
    expect(planeMiss(sichtMiss({ ...LANG, scanTage: 3, letzterScanTag: '2026-10-04', rang: 7 }, 1)).setzen).toEqual({});
  });

  it('ganz ohne Scan-Zeit → Anlagezeit des Dokuments', () => {
    const p = planeMiss(sichtMiss({ status: 'pending' }, t('2026-06-01T10:00:00Z')));
    expect(p).toMatchObject({ zeitAusAnlage: true, scanTage: 1 });
    expect(p.setzen).toMatchObject({ letzterScanTag: '2026-06-01', rang: rangVon(1, t('2026-06-01T10:00:00Z')) });
  });

  it('Rang bleibt eine exakte ganze Zahl', () => {
    expect(Number.isSafeInteger(rangVon(900, t('2026-10-04T14:46:52.602Z')))).toBe(true);
  });
});

describe('felderZumSchreiben', () => {
  const zs = (ms) => ({ zeit: ms });

  it('external_products: Timestamps gebaut, fetchedAt null wird ausdrücklich geschrieben', () => {
    expect(felderZumSchreiben('produkte', { storedAtMs: 1, fetchedAtMs: null, fetchedAtQuelle: 'rewe_pipeline' }, zs)).toEqual({ storedAt: { zeit: 1 }, fetchedAt: null, fetchedAtQuelle: 'rewe_pipeline' });
    expect(felderZumSchreiben('produkte', { fetchedAtMs: 5, fetchedAtQuelle: 'nutritionscrape', fetchedAtGeschaetzt: true, productName: 'X', nameQuelle: 'openfood' }, zs)).toEqual({ fetchedAt: { zeit: 5 }, fetchedAtQuelle: 'nutritionscrape', fetchedAtGeschaetzt: true, productName: 'X', 'feldQuellen.name': 'openfood' });
    expect(felderZumSchreiben('produkte', {}, zs)).toEqual({});
  });

  it('Warteschlange: nur die vier Felder', () => {
    expect(felderZumSchreiben('misses', { scanTage: 1, scanTageGeschaetzt: true, letzterScanTag: '2026-10-04', rang: 3, fremd: 1 }, zs)).toEqual({ scanTage: 1, scanTageGeschaetzt: true, letzterScanTag: '2026-10-04', rang: 3 });
  });
});
