/**
 * EIN Schreibweg für external_products/{ean} (Produktsuche, 04.10.2026).
 *
 * ──────────────────────────────────────────────────────────────────────
 * WARUM
 * ──────────────────────────────────────────────────────────────────────
 * Bis 04.10.2026 schrieb jede Quelle mit `set(…, {merge:true})` direkt in
 * das Dokument. Folgen (Analyse 04.10.2026):
 *   • Der Platzhalter 'Produkt' überschrieb echte Namen (665 Dokumente; der
 *     echte OpenFoodFacts-Name steht dort noch unter raw.product_name).
 *   • `raw` wurde tief zusammengemischt — ein Objekt aus mehreren Quellen.
 *   • `cachedAt` war die Umkopierzeit, nicht der Datenstand. Wann ein
 *     Eintrag zuerst gespeichert wurde, stand nirgends.
 * Patrick will die gefundenen Produkte „wirklich bei uns in der Datenbank,
 * mit einem Timestamp" — und nach zwei Monaten aufgefrischt.
 *
 * ──────────────────────────────────────────────────────────────────────
 * REGELN (Schnittstellen-Vertrag Teil 2)
 * ──────────────────────────────────────────────────────────────────────
 *  • storedAt  — nur beim Anlegen.
 *  • fetchedAt — Datenstand der Quelle: OFF-API → Abrufzeit;
 *    nutritionscrape → dessen fetchedAt (Fallback scrapedAt mit
 *    fetchedAtGeschaetzt:true); REWE-Pipeline → null mit
 *    fetchedAtQuelle:'rewe_pipeline'. Er rückt nur vor, wenn der neue Abruf
 *    tatsächlich Felder geliefert hat und jünger ist.
 *  • cachedAt  — weiter bei jedem Schreiben (ältere App-Versionen, 4-Wochen-
 *    Regel für das erneute Lesen unserer eigenen Kopien).
 *  • Stabile Felder je Feldgruppe nach Quellenrang (lib/normalizers.js);
 *    die Herkunft je Gruppe steht in `feldQuellen`. Ein leerer neuer Wert
 *    ersetzt NIE einen vorhandenen. Der Platzhalter 'Produkt' wird nie NEU
 *    geschrieben; ein gespeicherter Platzhalter wird durch den geretteten
 *    OpenFoodFacts-Namen ersetzt — oder bleibt stehen, wenn es keinen gibt:
 *    alle App-Versionen lesen das Dokument im Rückfall direkt (Funktion
 *    nicht erreichbar, offline aus dem Cache), und ohne productName bleibt
 *    dort der Titel leer und der Scanverlauf-Eintrag fällt weg. Als Name
 *    zählt er nirgends (normalizers.echterName).
 *  • Ersetzen einer Quelle (`neu.ersetzeQuelle`): War der bisherige Fund der
 *    bezahlten Suche ungeprüfter Altbestand (vor dem 04.10.2026 ohne
 *    EAN-Beleg gelesen) und wurde er ersetzt, widerlegt oder ohne Netz als
 *    fremd erkannt (lib/rohablage.js), verschwindet, was er geliefert hat,
 *    BEVOR der neue Fund einfließt — sonst blieben Daten eines fremden
 *    Produkts neben belegten stehen. Entfernt wird je Feld nur der Wert, den
 *    diese Quelle geliefert hat (`ersetzeQuelle.werte`): alte Dokumente ohne
 *    feldQuellen tragen in derselben Gruppe auch OpenFoodFacts-Werte (Bild,
 *    Scores, Marke), die bis zur Prüfrunde 2 mit verschwanden. Bleibt danach
 *    nichts Anzeigbares, wird das Dokument gelöscht (aktion 'loeschen').
 *  • Ungeprüfter Altbestand (`neu.ungeprueft`, lib/rohablage.js) geht nur in
 *    ein Dokument ohne Daten einer anderen Quelle. Er lag im Rang über
 *    OpenFoodFacts und überschrieb beim Scan dessen richtige Zutaten und
 *    Nährwerte (Prüfrunde 2: 1.193 Dokumente). Auch Lücken füllt er nicht:
 *    Nährwerte eines womöglich fremden Produkts neben einem belegten Namen
 *    wären derselbe Fehler, nur leiser.
 *  • Shopbilder (`neu.shopBilder === false`, Schalter _meta/produktsuche):
 *    ein gespeichertes Bild von einer Shopseite (bildVonShop) wird bei jedem
 *    Schreiben entfernt — Ausschalten wirkt so auch rückwirkend; Dokumente,
 *    die niemand schreibt, räumt scripts/shopbilder-entfernen.js.
 *  • Preis vom neuesten Datenstand (priceFetchedAt); ein Abruf ohne Preis
 *    löscht keinen Preis; ein Preis mit Datum schlägt einen ohne.
 *  • `raw` wird nicht mehr gemischt, sondern als Ganzes von der Quelle
 *    ersetzt, die jetzt die beste ist.
 *  • Angelegt wird nur, was die App sinnvoll zeigen kann (istAnzeigbar):
 *    ein Dokument, das es gibt, zeigt JEDE App-Version — auch wenn die
 *    Funktion `product: null` antwortet, liest die App das Dokument direkt
 *    (lib/services/externalProductService.ts lookupByEAN → getCached,
 *    unverändert in 6.0.13–6.0.21). Die Rohdaten bleiben in
 *    nutritionscrape/{ean} erhalten.
 *
 * Diese Datei ist die EINZIGE Stelle dieser Codebase, die external_products
 * schreibt (Daten über speichereExternesProdukt, Zeitstempel über
 * stempeleExternesProdukt). Außerhalb schreibt nur ai-product-comparison das
 * Feld aiAssessment.
 *
 * `fuehreZusammen` ist rein (keine Uhr, kein Firestore). Zeitpunkte gehen als
 * Date hinein und hinaus; die Schreibschicht (`speichereExternesProdukt`)
 * wandelt sie in Firestore-Timestamps um. firebase-admin wird hier NICHT
 * geladen — die Schreibschicht bekommt db/FieldValue/Timestamp übergeben.
 */

'use strict';

const { echterName, quellenRang, quellenGruppe, normaliseOpenFood } = require('./normalizers');
const { zuMs } = require('./zeit');
const { rohdatenAusSuche, ersetzeQuelleAus } = require('./rohablage');

/** Marker im Patch: Feld löschen. Die Schreibschicht macht daraus FieldValue.delete(). */
const LOESCHEN = Symbol.for('produktsuche.loeschen');

const NAEHRWERTE = [
  'Energie',
  'Fett',
  'FettdavongesttigteFettsuren',
  'Kohlenhydrate',
  'KohlenhydratedavonZucker',
  'Ballaststoffe',
  'Eiwei',
  'Salz',
];

const leer = (v) =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && v.trim() === '') ||
  (typeof v === 'number' && !Number.isFinite(v));

const zahl = (v) => typeof v === 'number' && Number.isFinite(v);
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const gueltigerPreis = (p) => zahl(p) && p > 0;

/** Wertgleichheit für Felder (Objekte per JSON, ohne bei Zyklen zu werfen). */
function gleich(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Echter Name aus OpenFoodFacts-Rohdaten (raw.product_name / generic_name).
 * Nur diese Quelle legt dort einen Namen ab — reweapify und nutritionscrape
 * führen ihn unter productName, den der Normalizer schon übernommen hätte.
 */
function nameAusRohdaten(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return echterName(raw.product_name) ?? echterName(raw.generic_name);
}

/** Name, den die App zeigen kann: echter Name, sonst der gerettete OFF-Name. */
function anzeigeName(doc) {
  if (!doc) return null;
  return echterName(doc.productName) ?? nameAusRohdaten(doc.raw);
}

const hatNaehrwerte = (d) => NAEHRWERTE.some((n) => zahl(d?.[`nutr_${n}_val`]));

/**
 * Kann die App aus diesem Dokument eine sinnvolle Produktseite bauen?
 * Name, Bild, Zutaten oder Nährwerte — Preis/Marke/Packung allein nicht.
 */
function istAnzeigbar(doc) {
  if (!doc) return false;
  return !!(
    anzeigeName(doc) ||
    text(doc.imageUrl) ||
    text(doc.attr_ingredientStatement) ||
    hatNaehrwerte(doc)
  );
}

// ─── Feldgruppen ─────────────────────────────────────────────────────
//
// Je Gruppe entscheidet der Quellenrang, ob die neue Quelle sie liefern
// darf. Innerhalb einer Gruppe gilt feldweise: ein leerer neuer Wert lässt
// den alten stehen. Die Allergene hängen an den Zutaten (aus ihnen
// abgeleitet), die Einheiten an ihrem Nährwert. `felder` sind alle Felder
// der Gruppe (zum Entfernen beim Ersetzen einer Quelle).
const ZUTATEN_FELDER = [
  'attr_ingredientStatement',
  'allergen_gluten',
  'allergen_milk',
  'allergen_egg',
  'allergen_nuts',
  'allergen_soy',
];
const NAEHRWERT_FELDER = [
  ...NAEHRWERTE.flatMap((n) => [`nutr_${n}_val`, `nutr_${n}_unit`]),
  'nutr_serving_size',
  'nutr_serving_unit',
];

const FELDGRUPPEN = {
  name: {
    felder: ['productName'],
    hatWert: (d) => !!echterName(d.productName),
    uebernimm: (erg, neu) => {
      erg.productName = echterName(neu.productName);
    },
  },
  marke: einfacheGruppe(['brandName', 'manufacturerName', 'manufacturerRef'], ['brandName', 'manufacturerName']),
  bild: {
    // bildVonShop: das Bild stammt von einer Shopseite (lib/rohablage.js,
    // nur mit shopBilder-Freigabe) — gehört zum Bild, nicht zur Quelle.
    felder: ['imageUrl', 'bildVonShop'],
    hatWert: (d) => !!text(d.imageUrl),
    uebernimm: (erg, neu) => {
      erg.imageUrl = text(neu.imageUrl);
      if (neu.bildVonShop === true) erg.bildVonShop = true;
      else delete erg.bildVonShop;
    },
  },
  zutaten: {
    felder: ZUTATEN_FELDER,
    hatWert: (d) => !!text(d.attr_ingredientStatement),
    uebernimm: (erg, neu) => kopiereNichtLeere(erg, neu, ZUTATEN_FELDER),
  },
  naehrwerte: {
    felder: NAEHRWERT_FELDER,
    hatWert: hatNaehrwerte,
    uebernimm: (erg, neu) => {
      for (const n of NAEHRWERTE) {
        const val = neu[`nutr_${n}_val`];
        if (!zahl(val)) continue;
        erg[`nutr_${n}_val`] = val;
        if (!leer(neu[`nutr_${n}_unit`])) erg[`nutr_${n}_unit`] = neu[`nutr_${n}_unit`];
      }
      kopiereNichtLeere(erg, neu, ['nutr_serving_size', 'nutr_serving_unit']);
    },
  },
  packung: einfacheGruppe(['packSize']),
  kategorie: einfacheGruppe(['category', 'productDescription']),
  scores: einfacheGruppe(['scoreNutri', 'scoreEco', 'scoreNova']),
  lifestyle: einfacheGruppe(['isVegan', 'isVegetarian', 'isGlutenFree', 'isLactoseFree']),
};

function einfacheGruppe(felder, leitfelder = felder) {
  return {
    felder,
    hatWert: (d) => leitfelder.some((f) => !leer(d[f])),
    uebernimm: (erg, neu) => kopiereNichtLeere(erg, neu, felder),
  };
}

function kopiereNichtLeere(ziel, quelle, felder) {
  for (const f of felder) if (!leer(quelle[f])) ziel[f] = quelle[f];
}

// Felder, an denen man eine von der OpenFoodFacts-API mitkopierte Rohablage
// erkennt (index.js openFoodGetProductByEAN legt genau diese ab).
const OFF_ROH_MERKMALE = ['found', 'code', 'nutriments', 'image_front_url', 'image_url', 'product_name', 'generic_name', 'nutriscore_grade', 'ecoscore_grade', 'nova_group', 'ingredients_text', 'ingredients_text_de', 'allergens_tags'];

const ohneNullen = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '');

/**
 * Normalisierte OpenFoodFacts-Werte aus `raw`, wenn dort eine API-Antwort
 * liegt — und, falls `raw.code` gesetzt ist, zu dieser EAN gehört.
 */
function offWerteAusRohdaten(raw, ean) {
  if (!raw || typeof raw !== 'object') return null;
  if (!OFF_ROH_MERKMALE.some((k) => raw[k] !== undefined && raw[k] !== null)) return null;
  if (raw.code != null && ean != null && ohneNullen(raw.code) !== ohneNullen(ean)) return null;
  try {
    return normaliseOpenFood(raw);
  } catch {
    return null;
  }
}

/** Stammt der Inhalt einer Gruppe von OpenFoodFacts? Jedes belegte Feld muss
 *  genau dem OFF-Wert entsprechen (mindestens eines). */
function gruppeAusOpenFood(def, doc, off) {
  if (!off) return false;
  let gesehen = 0;
  for (const f of def.felder) {
    if (leer(doc[f])) continue;
    if (!gleich(doc[f], off[f])) return false;
    gesehen += 1;
  }
  return gesehen > 0;
}

/** Hat die Rohablage der Suche (mitkopiert in raw) in dieser Gruppe etwas
 *  geliefert, das NICHT auch von OpenFoodFacts stammen kann? */
function gruppeVonSuche(def, doc, such, off) {
  if (!such) return false;
  return def.felder.some((f) => !leer(doc[f]) && gleich(doc[f], such[f]) && !(off && gleich(doc[f], off[f])));
}

/**
 * Herkunft je Feldgruppe eines gespeicherten Dokuments. Gruppen ohne Eintrag
 * in `feldQuellen` (Dokumente von vor dem 04.10.2026, oder die Nachpflege
 * schrieb nur feldQuellen.name) werden an den mitkopierten Rohdaten erkannt:
 *   1. trägt die Gruppe einen Wert, den nur die Rohablage der Suche hatte →
 *      deren Shop (auch wenn andere Felder der Gruppe von OFF stammen);
 *   2. entspricht jedes Feld den OpenFoodFacts-Rohdaten → 'openfood';
 *   3. sonst `source`.
 * Warum (Prüfrunde 2): writeThrough schrieb mit merge nacheinander die
 * OFF-API und die Rohablage der Suche in dasselbe Dokument, und `source`
 * zeigte nur den LETZTEN Schreiber. 68 Dokumente trugen ein OFF-Bild unter
 * einer Shop-Quelle — beim Ersetzen dieser Quelle verschwand es mit; und
 * Shop-Zutaten unter `source` 'openfood' hätte das Entfernen nie gefunden.
 */
function bisherigeQuellen(doc) {
  const out = {};
  const gespeichert = doc.feldQuellen && typeof doc.feldQuellen === 'object' ? doc.feldQuellen : {};
  let roh;
  for (const [gruppe, def] of Object.entries(FELDGRUPPEN)) {
    if (!def.hatWert(doc)) continue;
    const eingetragen = text(gespeichert[gruppe]);
    if (eingetragen) {
      out[gruppe] = eingetragen;
      continue;
    }
    if (roh === undefined) {
      const such = rohdatenAusSuche(doc.raw) ? ersetzeQuelleAus(doc.raw) : null;
      roh = { off: offWerteAusRohdaten(doc.raw, doc.ean), such };
    }
    if (roh.such && gruppeVonSuche(def, doc, roh.such.werte, roh.off)) out[gruppe] = roh.such.quelle;
    else if (gruppeAusOpenFood(def, doc, roh.off)) out[gruppe] = 'openfood';
    else out[gruppe] = text(doc.source) ?? null;
  }
  return out;
}

/**
 * Quelle der Gruppen, die von der OpenFoodFacts-WEBSEITE stammen (Altbestand
 * der bezahlten Suche, `source` bzw. feldQuellen 'openfoodfacts'), oder null.
 * Diese Daten prüft die Abfrage einmal kostenlos gegen die OFF-API
 * (lib/abrufPlan.js openfoodAuffrischenFaellig, index.js tryOpenFood).
 */
function offWebseitenQuelle(doc) {
  if (!doc) return null;
  for (const q of Object.values(bisherigeQuellen(doc))) {
    if (q && q !== 'openfood' && quellenGruppe(q) === 'openfood') return q;
  }
  return null;
}

/** Beste Quelle unter den beteiligten; bei Gleichstand die bevorzugte. */
function besteQuelle(quellen, bevorzugt) {
  let beste = null;
  for (const q of quellen) {
    if (!q) continue;
    if (beste === null || quellenRang(q) < quellenRang(beste)) beste = q;
  }
  if (beste === null) return null;
  const tie = bevorzugt.find((q) => q && quellenRang(q) === quellenRang(beste));
  return tie ?? beste;
}

/**
 * Führt einen neuen Quellen-Treffer mit dem gespeicherten Dokument zusammen.
 *
 * @param {object|null} alt  gespeichertes external_products-Dokument (oder null)
 * @param {object} neu
 *   quelle              'rewe' | 'globus' | Shop-Name | 'openfood' | …
 *   daten               normalisierte Felder (lib/normalizers.js)
 *   fetchedAtMs         Datenstand der Quelle (null bei der REWE-Pipeline)
 *   fetchedAtQuelle     'openfood_api' | 'nutritionscrape' | 'rewe_pipeline'
 *   fetchedAtGeschaetzt true, wenn nur scrapedAt bekannt war
 *   priceShop           Shop des Preises (optional)
 *   priceFetchedAtMs    Stand des Preises (optional; null = unbekannt)
 *   raw                 Rohdaten der Quelle (optional)
 *   meta                weitere Felder, die unverändert mitgeschrieben werden
 *   ersetzeQuelle       {quelle, sourceShop, adresse?, werte?, offZurueck?} —
 *                       was diese Quelle geliefert hat, vorher entfernen
 *                       (Kopfkommentar, entferneQuelle)
 *   ungeprueft          true → nur in ein Dokument ohne Daten anderer Quellen
 *   shopBilder          false → gespeichertes Shopbild entfernen
 * @param {number} jetztMs
 * @returns {{aktion:'anlegen'|'aktualisieren'|'loeschen'|'nichts', grund?:string,
 *   patch:object, ansicht:object|null, genommen:string[], preisGenommen:boolean,
 *   entfernt:string[]}}
 */
function fuehreZusammen(alt, neu, jetztMs) {
  const altDoc = alt || {};
  const neuDaten = (neu && neu.daten) || {};
  const neuQuelle = text(neu && neu.quelle) || 'scraper';
  const neuRang = quellenRang(neuQuelle);
  const jetzt = new Date(jetztMs);

  const erg = { ...altDoc };
  const quellen = bisherigeQuellen(altDoc);

  // Altbestand: Platzhalter gilt als leer; ein echter OFF-Name unter raw
  // wird gerettet, BEVOR raw ersetzt werden kann. Ohne Rettung bleibt ein
  // gespeicherter Platzhalter stehen (Kopfkommentar) — er zählt nicht als
  // Name, ein echter Name ersetzt ihn jederzeit.
  const gespeicherterName = echterName(altDoc.productName);
  if (!gespeicherterName) {
    const gerettet = nameAusRohdaten(altDoc.raw);
    if (gerettet) {
      erg.productName = gerettet;
      quellen.name = 'openfood';
    } else {
      delete quellen.name;
    }
  }

  // Ungeprüfter Altbestand neben Daten einer anderen Quelle → nichts
  // (Kopfkommentar). Gleiche Quelle darf erneuern (dieselbe Rohablage).
  if (alt && neu && neu.ungeprueft === true && Object.values(quellen).some((q) => q && q !== neuQuelle)) {
    return { aktion: 'nichts', grund: 'ungeprueft_neben_anderer_quelle', patch: {}, ansicht: null, genommen: [], preisGenommen: false, entfernt: [] };
  }

  // Quelle ersetzen bzw. widerlegt (nur mit gespeichertem Dokument).
  const entfernt = alt ? entferneQuelle(erg, quellen, neu && neu.ersetzeQuelle, altDoc) : [];

  // Shopbild nicht (mehr) freigegeben → weg, bevor eine andere Quelle ein
  // Bild liefern kann.
  if (neu && neu.shopBilder === false && erg.bildVonShop === true) {
    delete erg.imageUrl;
    delete erg.bildVonShop;
    delete quellen.bild;
    entfernt.push('shopbild');
  }

  // Stabile Felder je Gruppe nach Quellenrang.
  const genommen = [];
  for (const [gruppe, def] of Object.entries(FELDGRUPPEN)) {
    if (!def.hatWert(neuDaten)) continue;
    if (def.hatWert(erg) && neuRang > quellenRang(quellen[gruppe])) continue;
    def.uebernimm(erg, neuDaten);
    quellen[gruppe] = neuQuelle;
    genommen.push(gruppe);
  }

  // Preis: neuester Datenstand gewinnt; ohne Preis bleibt der alte stehen.
  let preisGenommen = false;
  if (gueltigerPreis(neuDaten.price)) {
    const neuStand = zahl(neu.priceFetchedAtMs) ? neu.priceFetchedAtMs : null;
    const altStand = zuMs(erg.priceFetchedAt);
    const altGueltig = gueltigerPreis(erg.price);
    if (!altGueltig || (neuStand ?? -Infinity) >= (altStand ?? -Infinity)) {
      erg.price = neuDaten.price;
      setzeOderEntferne(erg, 'priceShop', text(neu.priceShop));
      setzeOderEntferne(erg, 'priceFetchedAt', neuStand !== null ? new Date(neuStand) : null);
      preisGenommen = true;
    }
  }
  const beigetragen = genommen.length > 0 || preisGenommen;

  // Herkunft + beste Quelle.
  const feldQuellen = {};
  for (const [gruppe, q] of Object.entries(quellen)) if (q) feldQuellen[gruppe] = q;
  erg.feldQuellen = feldQuellen;
  // Eine gerade entfernte Quelle bleibt nicht `source` (auch nicht als
  // Gleichstand-Vorzug) — sonst stünde „Daten via violey" über Daten, die
  // nicht mehr von dort stammen.
  const altQuelle = text(altDoc.source);
  const ersetzt = entfernt.length > 0 && neu && neu.ersetzeQuelle ? text(neu.ersetzeQuelle.quelle) : null;
  const altBevorzugt = altQuelle && altQuelle !== ersetzt ? altQuelle : null;
  const source =
    besteQuelle(Object.values(feldQuellen), [beigetragen ? neuQuelle : null, altBevorzugt]) ??
    altBevorzugt ??
    neuQuelle;
  erg.source = source;

  // Datenstand (erg: nach dem Entfernen einer ersetzten Quelle).
  const neuStand = zahl(neu.fetchedAtMs) ? neu.fetchedAtMs : null;
  if (!alt) {
    erg.fetchedAt = neuStand !== null ? new Date(neuStand) : null;
    if (neu.fetchedAtQuelle) erg.fetchedAtQuelle = neu.fetchedAtQuelle;
    if (neu.fetchedAtGeschaetzt === true) erg.fetchedAtGeschaetzt = true;
  } else if (beigetragen) {
    const altStand = zuMs(erg.fetchedAt);
    if (neuStand !== null && (altStand === null || neuStand > altStand)) {
      erg.fetchedAt = new Date(neuStand);
      setzeOderEntferne(erg, 'fetchedAtQuelle', neu.fetchedAtQuelle || null);
      setzeOderEntferne(erg, 'fetchedAtGeschaetzt', neu.fetchedAtGeschaetzt === true ? true : null);
    } else if (neuStand === null && altStand === null && !erg.fetchedAtQuelle && neu.fetchedAtQuelle) {
      // Altbestand ohne Datenstand, neu von der REWE-Pipeline gelesen.
      erg.fetchedAt = null;
      erg.fetchedAtQuelle = neu.fetchedAtQuelle;
    }
  }

  // Quell-Adresse und Rohdaten gehören zur Quelle, die jetzt die beste ist.
  if (beigetragen && source === neuQuelle && text(neuDaten.sourceUrl)) {
    erg.sourceUrl = text(neuDaten.sourceUrl);
  }
  if (neu.raw !== undefined && (source === neuQuelle || altDoc.raw === undefined)) {
    erg.raw = neu.raw;
  }

  if (neu.meta && typeof neu.meta === 'object') Object.assign(erg, neu.meta);
  erg.cachedAt = jetzt;
  if (!alt) {
    erg.storedAt = jetzt;
  }

  if (!alt && !istAnzeigbar(erg)) {
    return { aktion: 'nichts', grund: 'nicht_anzeigbar', patch: {}, ansicht: null, genommen, preisGenommen, entfernt };
  }
  if (alt && entfernt.length > 0 && !istAnzeigbar(erg)) {
    // Was blieb, kann die App nicht zeigen — eine leere Hülle läse sie
    // trotzdem direkt (Kopfkommentar „Angelegt wird nur, was …").
    return { aktion: 'loeschen', grund: `nicht_mehr_anzeigbar:${entfernt.join(',')}`, patch: {}, ansicht: null, genommen, preisGenommen, entfernt };
  }

  const patch = alt ? differenz(altDoc, erg) : { ...erg };
  return { aktion: alt ? 'aktualisieren' : 'anlegen', patch, ansicht: erg, genommen, preisGenommen, entfernt };
}

// Nährwert-Einheiten und Portionsangaben gehören zu ihren Werten: OFF und
// Shop schreiben beide 'g'/'kcal'/100 — ein Wertvergleich allein nähme einem
// OFF-Nährwert seine Einheit.
const NAEHRWERT_BEGLEITER = new Set([...NAEHRWERTE.map((n) => `nutr_${n}_unit`), 'nutr_serving_size', 'nutr_serving_unit']);

/** Entfernt aus einer Gruppe die Felder, deren Wert genau `werte` entspricht;
 *  ohne `werte` alle. Einheiten folgen ihrem Nährwert. @returns {boolean} etwas entfernt */
function entferneWerte(erg, gruppe, def, werte) {
  let geloescht = false;
  for (const f of def.felder) {
    if (gruppe === 'naehrwerte' && NAEHRWERT_BEGLEITER.has(f)) continue;
    if (erg[f] === undefined) continue;
    if (werte && !gleich(erg[f], werte[f])) continue;
    delete erg[f];
    geloescht = true;
  }
  if (gruppe === 'naehrwerte') {
    for (const n of NAEHRWERTE) if (!zahl(erg[`nutr_${n}_val`])) delete erg[`nutr_${n}_unit`];
    if (!hatNaehrwerte(erg)) {
      delete erg.nutr_serving_size;
      delete erg.nutr_serving_unit;
    }
  }
  if (!def.hatWert(erg)) for (const f of def.felder) delete erg[f];
  return geloescht;
}

/** Füllt in einer Gruppe die leeren Felder aus den OpenFoodFacts-Rohdaten
 *  (Nährwerte samt Einheit; Portionsangaben nur zu vorhandenen Nährwerten). */
function fuelleAusOpenFood(erg, gruppe, def, off) {
  if (!off) return;
  if (gruppe === 'naehrwerte') {
    for (const n of NAEHRWERTE) {
      if (zahl(erg[`nutr_${n}_val`]) || !zahl(off[`nutr_${n}_val`])) continue;
      erg[`nutr_${n}_val`] = off[`nutr_${n}_val`];
      if (!leer(off[`nutr_${n}_unit`])) erg[`nutr_${n}_unit`] = off[`nutr_${n}_unit`];
    }
    if (hatNaehrwerte(erg)) kopiereInLeere(erg, off, ['nutr_serving_size', 'nutr_serving_unit']);
    return;
  }
  kopiereInLeere(erg, off, def.felder);
}

function kopiereInLeere(ziel, quelle, felder) {
  for (const f of felder) if (leer(ziel[f]) && !leer(quelle[f])) ziel[f] = quelle[f];
}

/**
 * Entfernt aus `erg` alles, was die zu ersetzende Quelle geliefert hat:
 * in ihren Feldgruppen (laut feldQuellen, sonst bisherigeQuellen) die Werte
 * aus `ersetze.werte` — ohne `werte` die ganze Gruppe —, ihren Preis, ihre
 * Rohdaten, ihre Quell-Adresse und einen Datenstand, der von ihr stammt.
 * Was in einer Gruppe stehen bleibt, stammt nicht von ihr: es gilt als
 * OpenFoodFacts, wenn es den mitkopierten OFF-Rohdaten entspricht, sonst
 * als unbekannt (jede Quelle darf es dann ersetzen).
 * Was dabei leer wird, bekommt die OpenFoodFacts-Werte zurück, die das alte
 * writeThrough in `raw` liegen ließ (dieselbe EAN, von der API): der
 * Altbestand hatte sie überschrieben — etwa die Brötchen-Zutaten von
 * 20006204 mit denen eines Hygienereinigers.
 * @returns {string[]} geänderte Gruppen (+ 'preis', 'raw')
 */
function entferneQuelle(erg, quellen, ersetze, altDoc) {
  if (!ersetze || typeof ersetze !== 'object') return [];
  const q = text(ersetze.quelle);
  const shop = text(ersetze.sourceShop);
  const werte = ersetze.werte && typeof ersetze.werte === 'object' ? ersetze.werte : null;
  const entfernt = [];
  if (q) {
    // offZurueck: false — die OFF-API hat die EAN gerade nicht gefunden;
    // dann keine alten OFF-Werte aus raw zurückholen (index.js tryOpenFood).
    const off = ersetze.offZurueck === false ? null : offWerteAusRohdaten(altDoc.raw, altDoc.ean);
    for (const [gruppe, def] of Object.entries(FELDGRUPPEN)) {
      if (quellen[gruppe] !== q) continue;
      if (!entferneWerte(erg, gruppe, def, werte)) continue;
      entfernt.push(gruppe);
      fuelleAusOpenFood(erg, gruppe, def, off);
      if (def.hatWert(erg) && gruppeAusOpenFood(def, erg, off)) quellen[gruppe] = 'openfood';
      else delete quellen[gruppe];
    }
  }
  const preisShop = text(erg.priceShop);
  const preisVonIhr = werte
    ? gleich(erg.price, werte.price)
    : (shop && preisShop === shop) || (!preisShop && q && text(altDoc.source) === q);
  if (erg.price !== undefined && preisVonIhr) {
    delete erg.price;
    delete erg.priceShop;
    delete erg.priceFetchedAt;
    entfernt.push('preis');
  }
  // Rohdaten derselben Rohablage (gleicher Shop; ohne Shop-Angabe auf beiden
  // Seiten ebenso — sonst schlüge die Prüfung der Abfrage bei jedem Scan neu an).
  const raw = erg.raw;
  if (raw && typeof raw === 'object' && raw.scrapedSource && text(raw.sourceShop) === shop) {
    delete erg.raw;
    entfernt.push('raw');
  }
  const adresse = text(ersetze.adresse);
  if (adresse && text(erg.sourceUrl) === adresse) delete erg.sourceUrl;
  if (entfernt.length > 0 && erg.fetchedAtQuelle === 'nutritionscrape') {
    delete erg.fetchedAt;
    delete erg.fetchedAtQuelle;
    delete erg.fetchedAtGeschaetzt;
  }
  return entfernt;
}

function setzeOderEntferne(obj, feld, wert) {
  if (wert === null || wert === undefined) delete obj[feld];
  else obj[feld] = wert;
}

/** Patch = was sich gegenüber dem gespeicherten Dokument ändert (inkl. Löschungen). */
function differenz(alt, neu) {
  const patch = {};
  for (const k of Object.keys(neu)) {
    if (k === 'raw') {
      if (neu.raw !== alt.raw) patch.raw = neu.raw;
      continue;
    }
    if (!gleich(alt[k], neu[k])) patch[k] = neu[k];
  }
  for (const k of Object.keys(alt)) {
    if (!(k in neu)) patch[k] = LOESCHEN;
  }
  return patch;
}

// ─── Schreibschicht ──────────────────────────────────────────────────

/** Date → Timestamp, LOESCHEN → FieldValue.delete() (nur oberste Ebene). */
function fuerFirestore(werte, { FieldValue, Timestamp }) {
  const out = {};
  for (const [k, v] of Object.entries(werte)) {
    if (v === LOESCHEN) out[k] = FieldValue.delete();
    else if (v instanceof Date) out[k] = Timestamp.fromDate(v);
    else out[k] = v;
  }
  return out;
}

/** Ansicht (mit Date) → Firestore-Form für die Antwort (Timestamps wie bisher). */
function ansichtMitTimestamps(ansicht, { Timestamp }) {
  if (!ansicht) return null;
  const out = {};
  for (const [k, v] of Object.entries(ansicht)) {
    out[k] = v instanceof Date ? Timestamp.fromDate(v) : v;
  }
  return out;
}

/**
 * Schreibt einen Quellen-Treffer in einer Transaktion. Die Transaktion liest
 * den aktuellen Stand, sodass gleichzeitige Schreiber (Abfrage, Trigger,
 * KI-Bewertung) nichts überschreiben: `update` ersetzt nur die geänderten
 * Felder; aiAssessment, lastUpgradeAttemptAt usw. bleiben unberührt.
 *
 * @param {{db, FieldValue, Timestamp}} fs
 * @returns {Promise<{aktion, grund?, ansicht, genommen, preisGenommen}>}
 *   ansicht ist das Dokument NACH dem Schreiben (Timestamps), oder null.
 */
async function speichereExternesProdukt(fs, ean, neu, jetztMs) {
  const ref = fs.db.collection('external_products').doc(ean);
  const ergebnis = await fs.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const alt = snap.exists ? snap.data() : null;
    const r = fuehreZusammen(alt, { ...neu, meta: { ...(neu.meta || {}), ean } }, jetztMs);
    if (r.aktion === 'anlegen') {
      tx.set(ref, fuerFirestore(r.patch, fs));
    } else if (r.aktion === 'aktualisieren' && Object.keys(r.patch).length > 0) {
      tx.update(ref, fuerFirestore(r.patch, fs));
    } else if (r.aktion === 'loeschen') {
      tx.delete(ref);
    }
    return r;
  });
  return {
    aktion: ergebnis.aktion,
    grund: ergebnis.grund,
    genommen: ergebnis.genommen,
    preisGenommen: ergebnis.preisGenommen,
    entfernt: ergebnis.entfernt,
    ansicht: ansichtMitTimestamps(ergebnis.ansicht, fs),
  };
}

/**
 * Stempelt einen Zeitpunkt auf ein BESTEHENDES Dokument (update, nie set):
 * lastUpgradeAttemptAt (Aufwertungs-Cooldown) oder openfoodVersuchtAm
 * (OFF-Auffrischung höchstens einmal je Frist). Ein zwischenzeitlich
 * gelöschtes Dokument darf nicht als leere Hülle mit nur diesem Stempel
 * wiederauferstehen — die App würde es anzeigen. Best-Effort: wirft nie.
 */
const STEMPEL_FELDER = new Set(['lastUpgradeAttemptAt', 'openfoodVersuchtAm']);

async function stempeleExternesProdukt(fs, ean, feld) {
  if (!STEMPEL_FELDER.has(feld)) throw new Error(`unbekanntes Stempelfeld ${feld}`);
  try {
    await fs.db.collection('external_products').doc(ean).update({ [feld]: fs.FieldValue.serverTimestamp() });
    return true;
  } catch {
    return false;
  }
}

// ─── Antwort an die App ──────────────────────────────────────────────
//
// Anzeigeregel (geprüft gegen app/external-product/[ean].tsx,
// app/barcode-scanner.tsx und lib/services/externalProductService.ts —
// alle drei unverändert in 6.0.13–6.0.21 und heute):
//   • Jedes gespeicherte Dokument ist ein Treffer. Ein `product: null` der
//     Funktion würde nichts verbergen: die App liest dann das Dokument
//     direkt (lookupByEAN → getCached) und zeigt es OHNE die Korrekturen
//     hier. Der einzige wirksame Hebel ist deshalb das Anlegen — angelegt
//     wird nur, was istAnzeigbar ist (fuehreZusammen).
//   • Fehlt ein echter Name, bekommt die Antwort den Anzeigenamen
//     'Produkt'. Genau das zeigten diese Dokumente bisher (gespeicherter
//     Platzhalter); Scanverlauf, Journey und Alternativen-Suche der älteren
//     Versionen bleiben so auf dem bekannten Pfad (ohne Namen fiele dort die
//     Journey-Erfassung weg und der Titel bliebe leer). Neu gespeichert wird
//     der Platzhalter nie. Ein Kennzeichen „Name fehlt" gibt es bewusst
//     nicht, solange keine App-Version es liest (Prüfrunde 04.10.2026).
//   • `raw` geht nicht über die Leitung (Debug, ggf. DocumentReferences).
const ANZEIGENAME_OHNE_NAMEN = 'Produkt';

function fuerAntwort(doc) {
  if (!doc) return null;
  const { raw: _raw, ...rest } = doc;
  return { ...rest, productName: anzeigeName(doc) ?? ANZEIGENAME_OHNE_NAMEN };
}

/**
 * Ergebnis von fuehreZusammen, das ein Shopbild aus einem gespeicherten
 * Dokument entfernt (scripts/shopbilder-entfernen.js) — dieselbe Regel wie
 * beim Schreiben (aktion 'aktualisieren' oder 'loeschen', wenn danach nichts
 * Anzeigbares bleibt). null, wenn das Dokument kein Shopbild trägt.
 */
function shopBildEntfernen(doc, jetztMs) {
  if (!doc || doc.bildVonShop !== true) return null;
  return fuehreZusammen(doc, { quelle: doc.source, daten: {}, shopBilder: false }, jetztMs);
}

module.exports = {
  LOESCHEN,
  ANZEIGENAME_OHNE_NAMEN,
  bisherigeQuellen,
  offWebseitenQuelle,
  nameAusRohdaten,
  anzeigeName,
  istAnzeigbar,
  fuehreZusammen,
  fuerFirestore,
  ansichtMitTimestamps,
  speichereExternesProdukt,
  stempeleExternesProdukt,
  fuerAntwort,
  shopBildEntfernen,
};
