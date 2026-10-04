/**
 * external-product-lookup — EAN-Abfrage für Produkte außerhalb unseres
 * Katalogs (external_products) und Warteschlange der bezahlten Suche
 * (external_lookup_misses).
 *
 * ──────────────────────────────────────────────────────────────────────
 * WARUM DIESE FUNKTION EXISTIERT
 * ──────────────────────────────────────────────────────────────────────
 * `external_products/{ean}` und `external_lookup_misses/{ean}` dürfen nur
 * mit Admin-Rechten geschrieben werden (firestore.rules). Die Kaskade lief
 * früher im Client (lib/services/externalProductService.ts, dort heute als
 * @deprecated toter Code); seit 14.06.2026 läuft sie hier.
 *
 * ──────────────────────────────────────────────────────────────────────
 * PRODUKTSUCHE (Umbau 04.10.2026)
 * ──────────────────────────────────────────────────────────────────────
 * Patrick: „…die Produkte dann auch wirklich bei uns in der Datenbank
 * aufnehmen, mit einem Timestamp. Wenn der Timestamp älter ist als
 * 2 Monate, soll es auch aktualisiert werden, wenn dieses Produkt wieder
 * hochkommt."
 *   • EIN Schreibweg für external_products (lib/speichern.js): storedAt,
 *     fetchedAt (echter Datenstand), feldweises Zusammenführen nach
 *     Quellenrang, nie der Platzhalter 'Produkt', Preis mit Shop + Stand.
 *   • Funde der bezahlten Suche landen SOFORT in external_products
 *     (Trigger onNutritionScrapeFuerExterne) — nicht erst beim nächsten
 *     Scan (80 von 132 Funden fehlten dort).
 *   • Jeder Aufruf von resolveExternalProduct plant per Transaktion, ob
 *     gesucht oder aufgefrischt werden muss (lib/abrufPlan.js).
 *   • OpenFoodFacts-Daten älter als die Frist holt die Abfrage kostenlos
 *     neu von der API.
 *   • Ein Fremddienst-Fehler (OpenFoodFacts 429/5xx/Zeitlimit) ist nie
 *     „nicht vorhanden": nichts wird negativ gespeichert. Für die bezahlte
 *     Suche wird der Barcode trotzdem eingeplant (sie sucht ohne
 *     OpenFoodFacts).
 *   • `force` löscht nichts mehr und gilt nur für Admins.
 *   • Prüfrunde 2: Altbestand der Suche (vor dem 04.10.2026 ohne EAN-Beleg
 *     gelesen) überschreibt keine Daten anderer Quellen mehr; was sich ohne
 *     Netz als fremd erkennen lässt, entfernt der Scan (OFF-Werte kommen aus
 *     raw zurück); Daten der OpenFoodFacts-Webseite prüft er einmal gegen
 *     die kostenlose API (lib/rohablage.js, lib/speichern.js).
 *   • Prüfrunde 3: Altbestand von OpenFoodFacts-Seiten übernimmt die Abfrage
 *     nie mehr aus nutritionscrape — dieselben Daten liefert die API. Bis
 *     dahin wurde ein solches Dokument abwechselnd gelöscht (API kennt die EAN
 *     nicht) und beim nächsten Scan neu angelegt, jedes Mal mit einer
 *     bezahlten KI-Bewertung.
 *   • Schlussprüfung (04.10.2026): Ein Lesefehler von _meta/produktsuche
 *     macht shopBilder und auffrischenNachTagen UNBEKANNT, nicht zum
 *     Standard — vorher löschte shopBilder:false gespeicherte Shopbilder
 *     (lib/konfiguration.js). OpenFoodFacts' „anderer Produkttyp"
 *     (OpenBeautyFacts & Co.) entscheidet nichts (openFoodGetProductByEAN).
 *     Textfelder erreichen external_products nur als Text (lib/speichern.js).
 *
 * ──────────────────────────────────────────────────────────────────────
 * SERVER-SEITIGE BESONDERHEITEN
 * ──────────────────────────────────────────────────────────────────────
 *  • Alle Schreibvorgänge werden VOR der Antwort abgewartet — eine Cloud
 *    Function endet mit der Antwort, fire-and-forget ginge verloren.
 *  • Globus ist deaktiviert (GLOBUS_ENABLED=false). Kein Globus-Aufruf.
 *  • OpenFoodFacts: Node-fetch mit Zeitlimit. Nach 429/5xx/Zeitlimit eine
 *    kurze Pause in `_meta/openFoodRateLimit` (über alle Instanzen).
 *  • Das Antwortformat ({product, fromCache, refreshed}) ist unverändert —
 *    die App-Versionen 6.0.13–6.0.21 lesen es. Zusätzliche Felder (etwa
 *    „Name fehlt" oder „Quelle gerade nicht erreichbar") kommen erst dazu,
 *    wenn eine App-Version sie liest (Prüfrunde 04.10.2026: ein Feld ohne
 *    Leser ist ein toter Pfad); bis dahin zeigt die App bei einem
 *    Fremddienst-Fehler wie bisher „nicht gefunden".
 */

'use strict';

const admin = require('firebase-admin');
const { logger } = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');

if (!admin.apps.length) admin.initializeApp();

// KRITISCH: Die Normalizer produzieren `undefined`-Felder (price/nutr_*/
// brandName, wenn eine Source ein Feld nicht liefert). firebase-admin
// Firestore WIRFT bei undefined-Werten → ignoreUndefinedProperties strippt
// sie beim Write — Pflicht, MUSS vor der ersten Firestore-Op gesetzt werden.
admin.firestore().settings({ ignoreUndefinedProperties: true });

const REGION = 'europe-west1';

const COLLECTION = 'external_products';
const MISSES_COLLECTION = 'external_lookup_misses';

// Wie lange nach einem (erfolglosen) Aufwertungsversuch für eine schwache
// Quelle (OpenFoodFacts) unsere eigenen besseren Ablagen NICHT erneut gelesen
// werden. Kostet nur Firestore-Lesevorgänge, kein Netz. (7 Tage)
const UPGRADE_RETRY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

// Globus ist deaktiviert — kein globus-Endpoint. tryGlobus ist ein No-Op.
const GLOBUS_ENABLED = false;

// Wie lange der Trigger bei technischen Fehlern wiederholen lässt (Eventarc
// stellt mit `retry: true` erneut zu). Danach: Fehler loggen, nicht werfen —
// die Rohdaten bleiben in nutritionscrape, die nächste Abfrage des Barcodes
// übernimmt sie (tryNutritionScrape).
const WIEDERHOLUNG_MAX_MS = 6 * 60 * 60 * 1000;

const {
  normaliseEan,
  isExternalCacheStale,
  istSchwacheQuelle,
  normaliseScraped,
  normaliseOpenFood,
  normaliseReweapify,
} = require('./lib/normalizers');
const {
  istAnzeigbar,
  fuehreZusammen,
  fuerFirestore,
  ansichtMitTimestamps,
  speichereExternesProdukt,
  stempeleExternesProdukt,
  fuerAntwort,
  offWebseitenQuelle,
} = require('./lib/speichern');
const { planeAbruf, lageAusProdukt, openfoodAuffrischenFaellig } = require('./lib/abrufPlan');
const {
  ausRohablage,
  uebernahmeNoetig,
  abgelehnterAltbestandIm,
  altbestandAbgelehnt,
  istOffWebseitenAltbestand,
} = require('./lib/rohablage');
const { istImKatalog } = require('./lib/katalog');
const { ladeKonfiguration, shopBildSchalter } = require('./lib/konfiguration');

// ─── Firestore helpers ──────────────────────────────────────────────────

function db() {
  return admin.firestore();
}

/** db + Werkzeuge für die Schreibschicht (lib/speichern.js lädt firebase-admin nicht selbst). */
function fsWerkzeug() {
  return {
    db: db(),
    FieldValue: admin.firestore.FieldValue,
    Timestamp: admin.firestore.Timestamp,
  };
}

function konfigWarnung(e) {
  logger.warn('_meta/produktsuche nicht lesbar → Shopbild-Schalter und Frist unbekannt (nichts übernehmen, nichts entfernen)', {
    err: e && e.message,
  });
}

/**
 * Liest das external_products-Dokument. null = keins da ODER Lesefehler
 * (dann läuft die Kaskade; der Schreibweg liest in seiner Transaktion
 * ohnehin den echten Stand, es geht nichts verloren).
 */
async function getCached(norm) {
  try {
    const snap = await db().collection(COLLECTION).doc(norm).get();
    return snap.exists ? snap.data() : null;
  } catch (e) {
    logger.warn('getCached failed', { err: e && e.message });
    return null;
  }
}

/**
 * Schreibt einen Quellen-Treffer über den EINEN Schreibweg. Scheitert die
 * Transaktion, bekommt der Nutzer trotzdem die Daten (im Speicher
 * zusammengeführt) — gespeichert wird beim nächsten Aufruf.
 * @returns {Promise<object|null>} Dokument nach dem Schreiben (oder null,
 *   wenn nichts anzeigbar war und nichts angelegt wurde)
 */
async function speichere(norm, neuOhneSchalter, ctx) {
  // Shopbild-Schalter bei JEDEM Schreiben mitgeben: ausgeschaltet entfernt
  // der Schreibweg ein gespeichertes Shopbild (lib/speichern.js). Dreiwertig:
  // nach einem Lesefehler von _meta/produktsuche ist er unbekannt (undefined)
  // — dann wird weder ein Bild übernommen noch eins entfernt.
  const neu = { shopBilder: shopBildSchalter(ctx.konfig), ...neuOhneSchalter };
  try {
    const r = await speichereExternesProdukt(fsWerkzeug(), norm, neu, ctx.jetztMs);
    if (r.aktion === 'loeschen') {
      logger.info('[speichern] gelöscht', { ean: norm, quelle: neu.quelle, grund: r.grund });
      ctx.aktuell = null;
      return null;
    }
    if (r.aktion === 'nichts') {
      logger.info('[speichern] nicht angelegt', { ean: norm, quelle: neu.quelle, grund: r.grund });
      return null;
    }
    logger.info('[speichern]', {
      ean: norm,
      quelle: neu.quelle,
      aktion: r.aktion,
      genommen: r.genommen.join(','),
      preis: r.preisGenommen,
    });
    ctx.aktuell = r.ansicht;
    return r.ansicht;
  } catch (e) {
    logger.warn('[speichern] fehlgeschlagen — Antwort aus dem Speicher', {
      ean: norm,
      err: e && e.message,
    });
    const r = fuehreZusammen(ctx.aktuell, { ...neu, meta: { ...(neu.meta || {}), ean: norm } }, ctx.jetztMs);
    if (r.aktion === 'nichts' || r.aktion === 'loeschen') return null;
    return ansichtMitTimestamps(r.ansicht, fsWerkzeug());
  }
}

/** Zeitstempel auf ein bestehendes Dokument (lib/speichern.js, Best-Effort). */
function stempele(norm, feld) {
  return stempeleExternesProdukt(fsWerkzeug(), norm, feld);
}

/**
 * Plant per Transaktion, ob der Barcode gesucht/aufgefrischt werden muss
 * (lib/abrufPlan.js), und zählt den Scan. Ersetzt recordMiss. Throwt NIE —
 * der Nutzer bekommt seine Antwort auch, wenn die Warteschlange hakt.
 */
async function planeAbrufFuer(norm, lage, ctx) {
  const ref = db().collection(MISSES_COLLECTION).doc(norm);
  const werkzeug = fsWerkzeug();
  try {
    const plan = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const p = planeAbruf({
        ean: norm,
        alt: snap.exists ? snap.data() : null,
        lage,
        jetztMs: ctx.jetztMs,
        auffrischenNachTagen: ctx.konfig.auffrischenNachTagen,
      });
      if (p.aktion === 'anlegen') tx.set(ref, fuerFirestore(p.felder, werkzeug));
      else if (p.aktion === 'aktualisieren') tx.update(ref, fuerFirestore(p.felder, werkzeug));
      return p;
    });
    if (plan.uebergang) {
      logger.info('[abruf] eingeplant', { ean: norm, uebergang: plan.uebergang, daten: lage.daten });
    }
  } catch (e) {
    logger.warn('[abruf] planen fehlgeschlagen (nicht blockierend)', { ean: norm, err: e && e.message });
  }
}

// ─── OpenFood (API v2) ──────────────────────────────────────────────────

const OPENFOOD_BASE_URL = 'https://world.openfoodfacts.org/api/v2/product';
const OPENFOOD_FIELDS = [
  'code',
  'product_name',
  'brands',
  'categories',
  'ingredients_text_de',
  'ingredients_text',
  'nutriments',
  'nutriscore_grade',
  'ecoscore_grade',
  'nova_group',
  'image_url',
  'image_front_url',
  'quantity',
  'allergens_tags',
  'manufacturing_places',
  'generic_name',
].join(',');
// Hardcoded UA — OFF rate-limits anonymous (no-UA) requests aggressively.
const OPENFOOD_USER_AGENT = 'MarkenDetektive-CF/1.0 (+patrick@markendetektive.de)';
const OPENFOOD_RATE_LIMIT_BACKOFF_MS = 30 * 1000; // 30 s
const OPENFOOD_RATE_LIMIT_DOC = '_meta/openFoodRateLimit';
// Der Nutzer wartet auf diese Antwort (Scanner) — lieber „gerade nicht
// erreichbar" als ein hängender Scan. Die Funktion selbst hat 30 s.
const OPENFOOD_ZEITLIMIT_MS = 5000;

/** Liest das (best-effort) Pausenfenster aus Firestore. */
async function readOpenFoodRateLimitUntilMs() {
  try {
    const snap = await db().doc(OPENFOOD_RATE_LIMIT_DOC).get();
    if (!snap.exists) return 0;
    const v = snap.data()?.rateLimitUntilMs;
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

/** Setzt ein Pausenfenster nach 429/5xx/Zeitlimit. Best-effort. */
async function writeOpenFoodRateLimit(untilMs, grund) {
  try {
    await db()
      .doc(OPENFOOD_RATE_LIMIT_DOC)
      .set(
        {
          rateLimitUntilMs: untilMs,
          grund,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
  } catch {
    // egal — Pause ist Best-Effort
  }
}

/**
 * „product found with a different product type: beauty" — OpenFoodFacts kennt
 * die EAN, aber in einer Schwester-Datenbank (OpenBeautyFacts,
 * OpenPetFoodFacts, Open Products Facts). Live geprüft 04.10.2026
 * (4066447870237: HTTP 404 mit genau diesem status_verbose).
 */
function istAndererProdukttyp(body) {
  const v = body && typeof body === 'object' ? body.status_verbose : null;
  return typeof v === 'string' && /different product type/i.test(v);
}

/**
 * Lädt ein Produkt von der OpenFoodFacts-API.
 * @returns {Promise<{status:'gefunden', product:object} | {status:'nicht_vorhanden'}
 *   | {status:'anderer_typ'} | {status:'nicht_erreichbar', grund:string}>}
 * 'nicht_erreichbar' (Pause aktiv, 429, 5xx, Zeitlimit, Netz) ist KEINE
 * Aussage über das Produkt — Vorfall-Regel aus CLAUDE.md: ein Fremddienst-
 * Fehler wird nie als „nichts gefunden" weitergegeben.
 * 'anderer_typ' (Schlussprüfung 04.10.2026): die EAN gibt es, nur nicht als
 * Lebensmittel — das ist kein „nicht vorhanden". Bis dahin galten so echte
 * OpenBeautyFacts-Daten (Balea Bodylotion, Dontodent …) als widerlegt.
 */
async function openFoodGetProductByEAN(ean) {
  const pauseBisMs = await readOpenFoodRateLimitUntilMs();
  if (Date.now() < pauseBisMs) {
    logger.warn('OpenFood pausiert — kein Abruf', {
      ean,
      secsLeft: Math.ceil((pauseBisMs - Date.now()) / 1000),
    });
    return { status: 'nicht_erreichbar', grund: 'pause' };
  }

  let response;
  try {
    response = await fetch(`${OPENFOOD_BASE_URL}/${ean}.json?fields=${OPENFOOD_FIELDS}`, {
      headers: { 'User-Agent': OPENFOOD_USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(OPENFOOD_ZEITLIMIT_MS),
    });
  } catch (e) {
    const grund = e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'zeitlimit' : 'netz';
    await writeOpenFoodRateLimit(Date.now() + OPENFOOD_RATE_LIMIT_BACKOFF_MS, grund);
    logger.warn('OpenFood nicht erreichbar', { ean, grund, err: e && e.message });
    return { status: 'nicht_erreichbar', grund };
  }

  // 404/400/410 = „EAN nicht in OpenFood" (normaler Fall). Alles andere ab
  // 400 — 429, 5xx, aber auch 401/403 (wir sind gesperrt) oder 408 — sagt
  // nichts über das Produkt: nicht erreichbar, kurze Pause.
  if (response.status === 404 || response.status === 400 || response.status === 410) {
    let body = null;
    try {
      body = await response.json();
    } catch {
      // kein JSON — wie bisher „nicht vorhanden"
    }
    if (istAndererProdukttyp(body)) {
      logger.info('OpenFood: EAN in einer anderen Open-Facts-Datenbank', { ean, status: response.status, verbose: body.status_verbose });
      return { status: 'anderer_typ' };
    }
    logger.info('OpenFood: EAN nicht vorhanden', { ean, status: response.status });
    return { status: 'nicht_vorhanden' };
  }
  if (response.status >= 400) {
    const grund = `http_${response.status}`;
    await writeOpenFoodRateLimit(Date.now() + OPENFOOD_RATE_LIMIT_BACKOFF_MS, grund);
    logger.warn('OpenFood nicht erreichbar — Pause aktiviert', { ean, grund });
    return { status: 'nicht_erreichbar', grund };
  }

  let result;
  try {
    result = await response.json();
  } catch (e) {
    logger.warn('OpenFood: Antwort nicht lesbar', { ean, err: e && e.message });
    return { status: 'nicht_erreichbar', grund: 'antwort_unlesbar' };
  }
  if (result.status !== 1 || !result.product) {
    if (istAndererProdukttyp(result)) {
      logger.info('OpenFood: EAN in einer anderen Open-Facts-Datenbank (body status)', { ean, verbose: result.status_verbose });
      return { status: 'anderer_typ' };
    }
    logger.info('OpenFood: EAN nicht vorhanden (body status)', { ean, status: result.status });
    return { status: 'nicht_vorhanden' };
  }

  const p = result.product;
  return {
    status: 'gefunden',
    product: {
      code: ean,
      product_name: p.product_name,
      brands: p.brands,
      categories: p.categories,
      ingredients_text_de: p.ingredients_text_de,
      ingredients_text: p.ingredients_text,
      nutriments: p.nutriments,
      nutriscore_grade: p.nutriscore_grade ? p.nutriscore_grade.toUpperCase() : undefined,
      ecoscore_grade: p.ecoscore_grade ? p.ecoscore_grade.toUpperCase() : undefined,
      nova_group: p.nova_group,
      image_url: p.image_url,
      image_front_url: p.image_front_url,
      quantity: p.quantity,
      allergens_tags: p.allergens_tags,
      manufacturing_places: p.manufacturing_places,
      generic_name: p.generic_name,
      found: true,
    },
  };
}

// ─── Quellen ────────────────────────────────────────────────────────────
//
// Jede Quelle liefert { status: 'gefunden' | 'nicht_vorhanden' | 'fehler',
// produkt? } — 'fehler' heißt „konnte nicht nachsehen" und macht aus einem
// leeren Ergebnis die Lage 'unbekannt' statt 'keine'. tryOpenFood kennt
// zusätzlich 'anderer_typ' (EAN nur in einer Schwester-Datenbank): keine
// Daten, aber auch kein Beleg gegen gespeicherte Daten.

async function tryReweapify(norm, ctx) {
  let docData = null;
  let fehler = false;
  // String-Query (Standard — gtin ist als String gespeichert), dann Zahl.
  for (const wert of [norm, Number(norm)]) {
    if (docData || (typeof wert === 'number' && !Number.isFinite(wert))) continue;
    try {
      const snap = await db().collection('reweapify').where('gtin', '==', wert).limit(1).get();
      if (!snap.empty) docData = snap.docs[0].data();
    } catch (e) {
      fehler = true;
      logger.warn('[reweapify] Abfrage fehlgeschlagen', { ean: norm, code: e && e.code, msg: e && e.message });
    }
  }
  if (!docData) return { status: fehler ? 'fehler' : 'nicht_vorhanden' };

  const daten = normaliseReweapify(docData);
  if (!istAnzeigbar(daten)) {
    logger.info('[reweapify] Dokument ohne verwertbare Daten', { ean: norm });
    return { status: 'nicht_vorhanden' };
  }
  const produkt = await speichere(
    norm,
    {
      quelle: 'rewe',
      daten,
      fetchedAtMs: null,
      fetchedAtQuelle: 'rewe_pipeline',
      priceShop: 'rewe',
      priceFetchedAtMs: null,
      raw: docData,
    },
    ctx,
  );
  return produkt ? { status: 'gefunden', produkt } : { status: 'nicht_vorhanden' };
}

async function tryNutritionScrape(norm, ctx) {
  let data;
  try {
    const snap = await db().collection('nutritionscrape').doc(norm).get();
    if (!snap.exists) return { status: 'nicht_vorhanden' };
    data = snap.data();
  } catch (e) {
    logger.warn('[nutritionscrape] Lesen fehlgeschlagen', { ean: norm, err: e && e.message });
    return { status: 'fehler' };
  }
  // Fremder Altbestand → nicht übernehmen, aber der Warteschlange melden
  // (lib/abrufPlan.js: der alte „Fund" zählt nicht).
  if (altbestandAbgelehnt(data, norm)) ctx.altbestandAbgelehnt = true;
  // Ungeprüfter Altbestand einer OpenFoodFacts-Seite wird nie übernommen
  // (Prüfrunde 3, lib/rohablage.js istOffWebseitenAltbestand): ob er zu
  // dieser EAN gehört, sagt gleich die kostenlose API (tryOpenFood).
  if (istOffWebseitenAltbestand(data)) ctx.offWebseitenAltbestand = true;
  const neu = ausRohablage(data, ctx.konfig, norm);
  if (!neu || !istAnzeigbar(neu.daten)) {
    // Fehlversuchs-Markierungen (failed/failCount), Dokumente ohne Name,
    // Bild, Zutaten und Nährwerte, Altbestand, der sich ohne Netz als fremd
    // erkennen lässt (lib/rohablage.js altbestandAbgelehnt), und Altbestand
    // von OpenFoodFacts-Seiten.
    return { status: 'nicht_vorhanden' };
  }
  const produkt = await speichere(norm, neu, ctx);
  return produkt ? { status: 'gefunden', produkt } : { status: 'nicht_vorhanden' };
}

async function tryRewe(norm, ctx) {
  let scraped = null;
  try {
    const snap = await db().collection('scraped_products').where('gtin', '==', norm).limit(1).get();
    if (!snap.empty) scraped = { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (e) {
    logger.warn('[scraped_products] Abfrage fehlgeschlagen', { ean: norm, err: e && e.message });
    return { status: 'fehler' };
  }
  if (!scraped) return { status: 'nicht_vorhanden' };
  const daten = normaliseScraped(scraped);
  if (!istAnzeigbar(daten)) return { status: 'nicht_vorhanden' };
  const produkt = await speichere(
    norm,
    {
      quelle: 'rewe',
      daten,
      fetchedAtMs: null,
      fetchedAtQuelle: 'rewe_pipeline',
      priceShop: 'rewe',
      priceFetchedAtMs: null,
      raw: scraped,
    },
    ctx,
  );
  return produkt ? { status: 'gefunden', produkt } : { status: 'nicht_vorhanden' };
}

// Globus ist deaktiviert. No-Op, KEIN HTTP-Call.
async function tryGlobus() {
  return { status: 'nicht_vorhanden' };
}

/**
 * OpenFoodFacts-API. `stempeln`: nur wenn schon ein Dokument existiert —
 * der Versuch wird vermerkt (openfoodVersuchtAm), damit die kostenlose
 * Auffrischung höchstens einmal je Frist läuft.
 *
 * Kennt die API die EAN nicht, trägt das Dokument aber Daten der
 * OpenFoodFacts-WEBSEITE (Altbestand der Suche), gehörte diese Seite zu einem
 * anderen Code — API und Webseite sind dieselbe Datenbank. Diese Daten
 * entfernt der Schreibweg dann (Prüfrunde 2; bleibt nichts, wird das Dokument
 * gelöscht). Ein Fehler der API (nicht erreichbar) ändert nichts.
 * Damit das hält, übernimmt die Abfrage solchen Altbestand auch nicht mehr aus
 * nutritionscrape (Prüfrunde 3, tryNutritionScrape) — bis dahin legte der
 * nächste Scan das Dokument neu an. Widerlegte Webseiten-Daten (im Dokument
 * oder in der Rohablage) meldet die Abfrage der Warteschlange wie fremden
 * Altbestand: der frühere „Fund" zählt nicht (lib/abrufPlan.js).
 *
 * „Anderer Produkttyp" (die EAN steht in OpenBeautyFacts & Co.) entscheidet
 * nichts: nichts entfernen, kein fremder Altbestand — nur den Versuch
 * vermerken, damit die kostenlose Prüfung höchstens einmal je Frist läuft
 * (Schlussprüfung 04.10.2026).
 */
async function tryOpenFood(norm, ctx, { stempeln = false } = {}) {
  const off = await openFoodGetProductByEAN(norm);
  if (off.status === 'nicht_erreichbar') return { status: 'fehler' };
  if (off.status === 'anderer_typ') {
    if (stempeln) await stempele(norm, 'openfoodVersuchtAm');
    return { status: 'anderer_typ' };
  }
  if (off.status === 'nicht_vorhanden') {
    const webseite = stempeln ? offWebseitenQuelle(ctx.aktuell) : null;
    if (webseite || ctx.offWebseitenAltbestand === true) ctx.altbestandAbgelehnt = true;
    if (webseite) {
      logger.info('[openfood] EAN unbekannt — Daten der OFF-Webseite entfernt', { ean: norm, quelle: webseite });
      // bereinigt: das Dokument nach dem Entfernen (null = gelöscht) — die
      // Antwort an die App zeigt schon diese Fassung.
      const bereinigt = await speichere(
        norm,
        {
          quelle: 'openfood',
          daten: {},
          ersetzeQuelle: { quelle: webseite, sourceShop: webseite, offZurueck: false },
          meta: { openfoodVersuchtAm: new Date(ctx.jetztMs) },
        },
        ctx,
      );
      return { status: 'nicht_vorhanden', bereinigt };
    }
    if (stempeln) await stempele(norm, 'openfoodVersuchtAm');
    return { status: 'nicht_vorhanden' };
  }
  const produkt = await speichere(
    norm,
    {
      quelle: 'openfood',
      daten: normaliseOpenFood(off.product),
      fetchedAtMs: ctx.jetztMs,
      fetchedAtQuelle: 'openfood_api',
      raw: off.product,
      meta: stempeln ? { openfoodVersuchtAm: new Date(ctx.jetztMs) } : undefined,
    },
    ctx,
  );
  return produkt ? { status: 'gefunden', produkt } : { status: 'nicht_vorhanden' };
}

/** Nur Quellen über OpenFoodFacts (Aufwertungs-/Neu-Lese-Pfad). */
async function tryHigherPrioritySources(norm, ctx) {
  const tried = [];
  let fehler = false;
  const quellen = [
    ['reweapify', tryReweapify],
    ['nutritionscrape', tryNutritionScrape],
    ['scraped_products', tryRewe],
    [GLOBUS_ENABLED ? 'globus-cf' : 'globus-cf(disabled)', tryGlobus],
  ];
  for (const [name, versuch] of quellen) {
    const r = await versuch(norm, ctx);
    tried.push(name);
    if (r.status === 'fehler') fehler = true;
    if (r.status === 'gefunden') return { produkt: r.produkt, tried, fehler };
  }
  return { produkt: null, tried, fehler };
}

/**
 * Volle Kaskade: reweapify → nutritionscrape → scraped_products →
 * globus(aus) → OpenFoodFacts. Erster Treffer gewinnt (und wird mit dem
 * gespeicherten Dokument zusammengeführt).
 * `fehler` = eine eigene Ablage war nicht lesbar; ein Ausfall von
 * OpenFoodFacts steht getrennt in `fehlerOpenFood` (lib/abrufPlan.js:
 * nur der erste macht „nichts gefunden" zur Nicht-Aussage).
 */
async function runFullCascade(norm, ctx) {
  const hoch = await tryHigherPrioritySources(norm, ctx);
  if (hoch.produkt) return hoch;
  const off = await tryOpenFood(norm, ctx, { stempeln: !!ctx.aktuell });
  hoch.tried.push('openfood');
  return {
    produkt: off.status === 'gefunden' ? off.produkt : null,
    bereinigt: off.bereinigt,
    tried: hoch.tried,
    fehler: hoch.fehler,
    fehlerOpenFood: off.status === 'fehler',
  };
}

const onCooldown = (doc, jetztMs) => {
  const letzter = doc.lastUpgradeAttemptAt?.toMillis?.() ?? 0;
  return jetztMs - letzter < UPGRADE_RETRY_COOLDOWN_MS;
};

/**
 * Abfrage eines Barcodes. Garantie: throwt NIE.
 *
 *  0. Trägt das Dokument Altbestand der Suche, der sich ohne Netz als fremd
 *     erkennen lässt (lib/rohablage.js abgelehnterAltbestandIm) → entfernen,
 *     danach weiter wie mit dem bereinigten Dokument.
 *  1. Kein / nicht anzeigbares Dokument → volle Kaskade (bei einem
 *     vorhandenen, nicht anzeigbaren Dokument höchstens einmal je 7 Tage).
 *  2. Schwache Quelle (OpenFoodFacts) → unsere besseren Ablagen lesen
 *     (7-Tage-Cooldown).
 *  3. OpenFoodFacts-Daten älter als die Frist → kostenlos neu von der API.
 *  4. Hochwertiges Dokument, cachedAt älter als 4 Wochen → unsere eigenen
 *     Kopien neu lesen (kein Netz).
 *  5. Abruf planen + Scan zählen (Warteschlange).
 * `erzwingen` (nur Admin-force): Kaskade ohne Cooldown, Auffrischung sofort
 * einplanen. force löscht NIE etwas (bis 04.10.2026 löschte es das Dokument).
 *
 * @returns {Promise<{produkt:object|null, fromCache:boolean, refreshed:boolean}>}
 */
async function lookupByEAN(norm, { erzwingen = false } = {}) {
  const jetztMs = Date.now();
  const konfig = await ladeKonfiguration(db(), jetztMs, konfigWarnung);
  let cached = await getCached(norm);
  const ctx = { jetztMs, konfig, aktuell: cached };

  // Fremder Altbestand im Dokument → zuerst entfernen (Prüfrunde 2). Ohne
  // Lesevorgang: die Prüfung braucht nur das Dokument selbst. Danach geht es
  // mit dem bereinigten Dokument weiter (null = gelöscht, nichts blieb).
  const abgelehnt = cached ? abgelehnterAltbestandIm(cached, norm) : null;
  if (abgelehnt) {
    logger.info('[external-lookup] fremder Altbestand — entfernt', { ean: norm, grund: abgelehnt.grund, quelle: abgelehnt.ersetzeQuelle.quelle });
    // Reines Entfernen: keine neuen Daten. 'scraper' statt der entfernten
    // Quelle — sonst stünde sie als `source` da, wenn nur Werte ohne
    // erkennbare Herkunft übrig bleiben.
    cached = await speichere(
      norm,
      { quelle: 'scraper', daten: {}, ersetzeQuelle: abgelehnt.ersetzeQuelle },
      ctx,
    );
    ctx.aktuell = cached;
  }

  let produkt = cached;
  let fromCache = !!cached;
  let refreshed = false;
  let fehler = false;
  let tried = [];
  const uebernimm = (r) => {
    tried = tried.concat(r.tried || []);
    if (r.fehler) fehler = true;
    if (r.produkt) {
      produkt = r.produkt;
      fromCache = false;
      refreshed = !!cached;
    } else if (r.bereinigt !== undefined) {
      // Daten der OFF-Webseite entfernt (tryOpenFood) — nicht die alte Fassung zeigen.
      produkt = r.bereinigt;
    }
  };

  try {
    logger.info('[external-lookup] start', { ean: norm, cache: cached ? cached.source : null, erzwingen });

    if (!cached || erzwingen || (!istAnzeigbar(cached) && !onCooldown(cached, jetztMs))) {
      if (cached) await stempele(norm, 'lastUpgradeAttemptAt');
      uebernimm(await runFullCascade(norm, ctx));
    } else if (istAnzeigbar(cached)) {
      if (istSchwacheQuelle(cached.source) && !onCooldown(cached, jetztMs)) {
        await stempele(norm, 'lastUpgradeAttemptAt');
        uebernimm(await tryHigherPrioritySources(norm, ctx));
      }
      if (openfoodAuffrischenFaellig(produkt, jetztMs, konfig.auffrischenNachTagen)) {
        // Ein OFF-Ausfall ist hier keine Aussage über eigene Daten (fehler bleibt).
        const off = await tryOpenFood(norm, ctx, { stempeln: true });
        uebernimm({ produkt: off.produkt, bereinigt: off.bereinigt, tried: ['openfood'] });
      }
      if (!refreshed && !istSchwacheQuelle(cached.source) && isExternalCacheStale(cached.cachedAt)) {
        uebernimm(await tryHigherPrioritySources(norm, ctx));
      }
    }
  } catch (e) {
    // Darf nie passieren (jede Quelle fängt selbst) — aber die Antwort an
    // den Nutzer hat Vorrang vor der Kaskade.
    logger.error('[external-lookup] unerwarteter Fehler', { ean: norm, err: e && e.message });
    fehler = true;
  }
  // Der Schreibweg hat das Dokument gelöscht (nichts Anzeigbares mehr, etwa
  // nach dem Entfernen eines nicht freigegebenen Shopbilds) → nicht die
  // alte Fassung zurückgeben.
  if (cached && ctx.aktuell === null) produkt = null;

  await planeAbrufFuer(
    norm,
    lageAusProdukt(produkt, { fehler, tried, erzwingen, altbestandAbgelehnt: !!abgelehnt || ctx.altbestandAbgelehnt === true }),
    ctx,
  );
  return { produkt, fromCache, refreshed };
}

// ─── Auth ───────────────────────────────────────────────────────────────

async function verifyAuthFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    return await admin.auth().verifyIdToken(m[1]);
  } catch (e) {
    logger.warn('verifyIdToken-failed', { err: e.message });
    return null;
  }
}

// ─── HTTPS handler ──────────────────────────────────────────────────────

exports.resolveExternalProduct = onRequest(
  { region: REGION, timeoutSeconds: 30, memory: '256MiB', cors: true, invoker: 'public' },
  async (req, res) => {
    try {
      // Bearer-Auth (anonyme Firebase-User haben einen gültigen idToken).
      const decoded = await verifyAuthFromRequest(req);
      if (!decoded?.uid) {
        res.status(401).json({ error: 'unauthenticated' });
        return;
      }

      const body = req.body || {};
      const eanRaw = body.ean ?? req.query?.ean;
      const forceRaw = body.force ?? req.query?.force;
      const forceGewuenscht =
        forceRaw === true || forceRaw === 1 || forceRaw === '1' || forceRaw === 'true';
      // force nur für Admins (Claim admin:true). Bis 04.10.2026 löschte force
      // für JEDEN angemeldeten Nutzer — auch anonyme — das Dokument; jede
      // Neuanlage stieß wieder eine bezahlte KI-Bewertung an. Ein Nicht-Admin-
      // force wird ignoriert (die App schickt es nur aus einem __DEV__-Knopf).
      const erzwingen = forceGewuenscht && decoded.admin === true;

      const norm = normaliseEan(eanRaw);
      if (!norm) {
        res.status(400).json({ error: 'invalid_ean' });
        return;
      }
      // Ohne Nutzerkennung: für den Zweck (sehen, dass force ankommt) reicht
      // die EAN — keine personenbezogenen Daten in neuen Logs.
      if (forceGewuenscht && !erzwingen) logger.info('force ignoriert (kein Admin)', { ean: norm });

      const r = await lookupByEAN(norm, { erzwingen });
      const product = fuerAntwort(r.produkt);
      if (!product) {
        // product:null wie bisher. Ein Fremddienst-Fehler wird trotzdem nie
        // als „nicht vorhanden" gespeichert (lageAusProdukt 'unbekannt').
        res.status(200).json({ product: null });
        return;
      }
      res.status(200).json({ product, fromCache: r.fromCache, refreshed: r.refreshed });
    } catch (e) {
      logger.error('resolveExternalProduct failed', { err: e && e.message });
      res.status(500).json({ error: (e && e.message) || 'internal' });
    }
  },
);

// ─── Trigger: Funde der bezahlten Suche sofort übernehmen ───────────────
//
// Bis 04.10.2026 kam ein Fund aus nutritionscrape erst beim NÄCHSTEN Scan
// in external_products (80 von 132 neuen Funden fehlten dort). Der Trigger
// übernimmt jeden echten Abruf (fetchedAt geändert) über den einen
// Schreibweg — aber nur für Barcodes, die nicht im Katalog stehen
// (productPath leer und keine Katalog-EAN in irgendeiner Schreibweise);
// Katalogprodukte bekommen ihre Daten über onNutritionScrapeWrite
// (nutrition-backfill), daran ändert sich nichts.
// Ersetzt oder widerlegt der Schreibvorgang ungeprüften Altbestand (vor dem
// 04.10.2026 ohne EAN-Beleg gelesen), nimmt der Schreibweg dessen
// Feldgruppen aus external_products heraus (lib/rohablage.js
// uebernahmeNoetig → ersetzeQuelle); bleibt nichts Anzeigbares, wird das
// Dokument gelöscht.
exports.onNutritionScrapeFuerExterne = onDocumentWritten(
  { document: 'nutritionscrape/{ean}', region: REGION, retry: true, memory: '256MiB', timeoutSeconds: 60 },
  async (event) => {
    const norm = normaliseEan(event.params.ean);
    if (!norm) return;
    const vorher = event.data?.before?.exists ? event.data.before.data() : null;
    const nachher = event.data?.after?.exists ? event.data.after.data() : null;
    const entscheidung = uebernahmeNoetig(vorher, nachher);
    if (!entscheidung.noetig) return;

    try {
      if (await istImKatalog(db(), norm)) {
        logger.info('[uebernahme] im Katalog — nicht übernommen', { ean: norm });
        return;
      }
      const jetztMs = Date.now();
      const konfig = await ladeKonfiguration(db(), jetztMs, konfigWarnung);
      // null: fremder Altbestand (lib/rohablage.js altbestandAbgelehnt) —
      // dann nur noch Entfernen, wenn etwas zu ersetzen ist.
      const basis = ausRohablage(nachher, konfig, norm);
      if (!basis && !entscheidung.ersetzeQuelle) {
        logger.info('[uebernahme] Altbestand abgelehnt — nicht übernommen', { ean: norm });
        return;
      }
      const neu = {
        ...(basis || { quelle: entscheidung.ersetzeQuelle.quelle, daten: {}, shopBilder: shopBildSchalter(konfig) }),
        ersetzeQuelle: entscheidung.ersetzeQuelle,
      };
      const r = await speichereExternesProdukt(fsWerkzeug(), norm, neu, jetztMs);
      logger.info('[uebernahme]', {
        ean: norm,
        anlass: entscheidung.grund,
        aktion: r.aktion,
        grund: r.grund ?? null,
        genommen: (r.genommen || []).join(','),
        entfernt: (r.entfernt || []).join(','),
        preis: r.preisGenommen,
      });
    } catch (e) {
      const alterMs = Date.now() - Date.parse(event.time);
      if (!Number.isFinite(alterMs) || alterMs < WIEDERHOLUNG_MAX_MS) throw e;
      logger.error('[uebernahme] aufgegeben nach Wiederholungen', { ean: norm, err: e && e.message });
    }
  },
);
