/**
 * nutritionscrape/{ean} (Rohablage der bezahlten Suche) → Eingabe für den
 * einen Schreibweg (lib/speichern.js). Rein, ohne Firestore.
 *
 * nutritionscrape schreibt NUR der nutrition-scraper (Vertrag Teil 1). Wir
 * lesen dort:
 *   • productName / shopBildUrl / eanBeleg — Name und Bild nur mit EAN-Beleg
 *     (prüft der Scraper, bevor er speichert).
 *   • attr_preis + priceShop / priceFetchedAt / priceCurrency — der Scraper
 *     speichert einen Preis nur in EUR aus DE/AT-Shops.
 *   • fetchedAt — wann eine Seite WIRKLICH abgerufen wurde. Ältere Dokumente
 *     kennen nur scrapedAt (springt bei jedem Zusammenführen) → als
 *     Schätzung markiert.
 *   • widerlegtAm — der Scraper hat ungeprüften Altbestand entfernt, weil
 *     seine eigene Quellseite ihm widerspricht (nutrition-scraper,
 *     src/zusammenfuehren.js widerlegeAltbestand).
 *
 * Altbestand = Dokument mit Daten, aber ohne fetchedAt: vor dem 04.10.2026
 * ohne EAN-Beleg gelesen (bei bekannten Shops wurde die EAN nie geprüft).
 * Wird er ersetzt oder widerlegt, nimmt der Trigger die Werte, die er in
 * external_products geliefert hat, wieder heraus (lib/speichern.js
 * ersetzeQuelle).
 *
 * Prüfrunde 2 (04.10.2026) — Altbestand ist UNGEPRÜFT und wird so behandelt:
 *   • Er geht nur in ein Dokument, das noch keine Daten einer anderen Quelle
 *     trägt (`ungeprueft`, lib/speichern.js). Bis dahin überschrieb er beim
 *     Scan die Zutaten und Nährwerte richtiger OpenFoodFacts-Daten (1.193
 *     Dokumente, etwa „Aceto Balsamico" mit Heidelbeer-Zutaten einer fremden
 *     Globus-Seite), weil ein Shop im Rang über OpenFoodFacts steht.
 *   • Was sich ohne Netz als fremd erkennen lässt, wird gar nicht übernommen
 *     und aus external_products entfernt (altbestandAbgelehnt): eine andere
 *     GTIN in der Quell-Adresse, oder ein Händler-Code (Waage/Laden, RCN-8)
 *     von einer Seite, die solche Codes nicht ausgibt. Eine Auffrischung
 *     erreicht diese Fälle oft nie (OpenFoodFacts-Seiten und fremde Domains
 *     schließt die bezahlte Suche aus).
 */

'use strict';

const { normaliseReweapify, quellenGruppe } = require('./normalizers');
const { zuMs } = require('./zeit');
const { shopBildSchalter } = require('./konfiguration');
const {
  istGueltigeGtin,
  istLadencode,
  istRcn8,
  RCN8_DOMAINS,
  hostGehoertZu,
  istOpenFoodFactsHost,
  fremdeGtinInAdressen,
} = require('./gtin');

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * `source`-Wert aus sourceShop ('globus', 'budni.de', 'shop.kastner', …).
 * Wie bisher (Anzeige „Daten via …" in der App): REWE/Globus/Metro als
 * Gruppenname, sonst das erste Etikett. Den Rang regelt lib/normalizers.js.
 */
function quelleAusShop(sourceShop) {
  const shop = String(sourceShop ?? '').trim().toLowerCase();
  if (!shop) return 'scraper';
  if (/(^|[.\-])rewe([.\-]|$)/.test(shop)) return 'rewe';
  if (shop.includes('globus')) return 'globus';
  if (/(^|[.\-])metro([.\-]|$)/.test(shop)) return 'metro';
  return shop.split('.')[0] || 'scraper';
}

/** Host aus einer Adresse ('https://www.globus.de/p/…' → 'globus.de'). */
function hostAus(adresse) {
  const a = text(adresse);
  if (!a) return null;
  try {
    return new URL(/^https?:\/\//i.test(a) ? a : `https://${a}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Länder-Domain außer DE/AT (.ch, .pl, .nl, .co.uk, .fr …)? Generische
 * Domains (.com, .eu, .shop …) gelten nicht als Ausland — viele deutsche
 * Shops laufen dort (shop-apotheke.com, lebensmittel-versand.eu).
 */
function istAuslandsDomain(host) {
  if (!host) return false;
  const tld = host.split('.').pop();
  return /^[a-z]{2}$/.test(tld) && tld !== 'de' && tld !== 'at' && tld !== 'eu';
}

/** Daten aus der Zeit vor v4: vorhanden, aber ohne fetchedAt. */
function istAltbestand(data) {
  return !!data && !!(data.scrapedSource || data.scrapedAt) && data.fetchedAt == null;
}

/** Host der Quelle: aus der Adresse, sonst aus einem Shop-Eintrag mit Domain
 *  ('violey.com') — ein bloßer Name ('globus') sagt über den Host nichts. */
function quellHost(data) {
  const adresse = text(data && data.scrapedUrl) || text(data && data.sourceUrl);
  const shop = text(data && data.sourceShop);
  return hostAus(adresse) || (shop && shop.includes('.') ? hostAus(shop) : null);
}

/**
 * Ungeprüfter Altbestand von einer OpenFoodFacts-Seite (Webseite, nicht API)?
 * Solche Daten übernimmt die Abfrage NICHT mehr aus der Rohablage (Prüfrunde 3,
 * ausRohablage): dieselbe Datenbank liefert die kostenlose API, und deren
 * Antwort entscheidet. Bis dahin entfernte tryOpenFood die Webseiten-Daten,
 * wenn die API die EAN nicht kannte — und der nächste Scan übernahm sie
 * wieder aus nutritionscrape: das Dokument wurde abwechselnd gelöscht und neu
 * angelegt, jede Neuanlage kostete eine KI-Bewertung (ai-product-comparison).
 *
 * Der HOST entscheidet zuerst (Schlussprüfung 04.10.2026): nur
 * openfoodfacts.org-Domains. Seiten von OpenBeautyFacts, OpenPetFoodFacts und
 * Open Products Facts tragen als sourceShop ebenfalls 'openfoodfacts', aber
 * die API, die hier entscheiden soll, kennt nur die Lebensmittel-Datenbank —
 * sie antwortet dort „anderer Produkttyp", und richtige Daten (Balea
 * Bodylotion …) galten als widerlegt. Nur ohne erkennbaren Host zählt der
 * Shop-Name.
 * Kopie: external-misses-processor/src/regeln.js istOffWebseitenAltbestand —
 * beide gleich halten (Test vergleicht sie).
 */
function istOffWebseitenAltbestand(data) {
  if (!istAltbestand(data)) return false;
  const host = quellHost(data);
  if (host) return istOpenFoodFactsHost(host);
  return quellenGruppe(quelleAusShop(data.sourceShop)) === 'openfood';
}

/**
 * Preis aus der Rohablage — oder null.
 *   • Neue Dokumente (v4, mit fetchedAt) tragen zum Preis priceCurrency,
 *     priceShop und priceFetchedAt: nur 'EUR' gilt (DE/AT prüft der Scraper
 *     vor dem Speichern). Ein v4-Dokument mit Preis OHNE priceCurrency hat
 *     keine zuordenbare Herkunft (scrapedUrl/sourceShop/fetchedAt gehören
 *     zum letzten Abruf, der Preis womöglich zu einem früheren) → kein Preis.
 *   • Reiner Altbestand (ohne fetchedAt): Preise von Länder-Domains außer
 *     DE/AT verwerfen. Gemessen 04.10.2026: 9 von 447 Preisen stammten aus
 *     .ch/.pl/.uk/.nl/.fr-Shops und standen als EUR da (zdroweslodycze.pl
 *     24,69 …). Shop und Stand dann aus sourceShop/scrapedAt.
 *   • OpenFoodFacts hat keine Preise.
 */
function preisAusRohablage(data) {
  if (!data) return null;
  const wert = data.attr_preis;
  if (typeof wert !== 'number' || !Number.isFinite(wert) || wert <= 0) return null;
  if (quellenGruppe(quelleAusShop(data.sourceShop)) === 'openfood') return null;
  const altbestand = data.fetchedAt == null;
  if (data.priceCurrency != null) {
    if (String(data.priceCurrency).toUpperCase() !== 'EUR') return null;
  } else {
    if (!altbestand) return null;
    const host = hostAus(data.scrapedUrl) || hostAus(data.sourceUrl) || hostAus(data.sourceShop);
    if (istAuslandsDomain(host)) return null;
  }
  const standMs = zuMs(data.priceFetchedAt) ?? (altbestand ? zuMs(data.scrapedAt) : null);
  const shop = text(data.priceShop) ?? (altbestand ? text(data.sourceShop) : null);
  return { wert, shop, standMs };
}

/**
 * Stempel eines echten Abrufs: fetchedAt, bei Altbestand scrapedAt.
 * @returns {{ms:number|null, geschaetzt:boolean}}
 */
function abrufStempel(data) {
  const exakt = zuMs(data?.fetchedAt);
  if (exakt !== null) return { ms: exakt, geschaetzt: false };
  const geschaetzt = zuMs(data?.scrapedAt);
  return { ms: geschaetzt, geschaetzt: geschaetzt !== null };
}

/**
 * Lässt sich Altbestand ohne Netz als fremd erkennen? Nur für Altbestand
 * (ohne fetchedAt) — belegte Funde hat der Scraper selbst geprüft.
 *   • 'fremde_gtin_in_adresse': die Quell-Adresse nennt eine andere gültige
 *     GTIN und nicht die EAN (lib/gtin.js fremdeGtinInAdressen).
 *   • 'ungueltige_ean' / 'ladencode': solche Nummern gelten nur in einem Markt,
 *     eine Seite eines beliebigen Shops beschreibt bestenfalls ein fremdes
 *     Produkt (die bezahlte Suche überspringt sie deshalb).
 *   • 'haendlercode_fremder_shop': 8-stellige Händlernummer (RCN-8) von einer
 *     Seite außerhalb der Ketten, die solche Nummern ausgeben.
 * OpenFoodFacts-Seiten prüfen die Händler-Regeln nicht: dieselben Daten
 * liefert die kostenlose API, und deren Antwort entscheidet (index.js,
 * tryOpenFood). Übernommen werden sie trotzdem nie (istOffWebseitenAltbestand,
 * ausRohablage).
 *
 * @returns {{grund:string, adresse:string|null, gtin?:string}|null}
 */
function altbestandAbgelehnt(data, ean) {
  if (!istAltbestand(data)) return null;
  const code = String(ean ?? '').replace(/\D/g, '');
  if (!code) return null;
  const adresse = text(data.scrapedUrl) || text(data.sourceUrl);
  const fremd = fremdeGtinInAdressen([data.scrapedUrl, data.sourceUrl], code);
  if (fremd) return { grund: 'fremde_gtin_in_adresse', adresse, gtin: fremd };
  if (istOffWebseitenAltbestand(data)) return null;
  const host = quellHost(data);
  if (!istGueltigeGtin(code)) return { grund: 'ungueltige_ean', adresse };
  if (istLadencode(code)) return { grund: 'ladencode', adresse };
  // Ohne bekannten Host lässt sich die Herkunft nicht beurteilen → bleibt.
  if (istRcn8(code) && host && !hostGehoertZu(host, RCN8_DOMAINS)) return { grund: 'haendlercode_fremder_shop', adresse };
  return null;
}

/**
 * Was ein Rohablage-Dokument in external_products geliefert hat — zum
 * Ersetzen/Entfernen (lib/speichern.js ersetzeQuelle). `werte` sind die
 * normalisierten Felder: entfernt wird nur, was genau diesen Wert trägt, damit
 * Bild, Scores oder Marke einer anderen Quelle in derselben Feldgruppe stehen
 * bleiben (bei alten Dokumenten ohne feldQuellen lagen beide gemischt).
 */
function ersetzeQuelleAus(data) {
  if (!data) return null;
  const { raw: _raw, ...werte } = normaliseReweapify(data);
  // Ein Shopbild trägt das Dokument nur mit Freigabe (ausRohablage); der
  // Preis steht so da, wie ihn das alte writeThrough ungefiltert kopierte.
  const bild = text(data.shopBildUrl);
  if (bild) werte.imageUrl = bild;
  return {
    quelle: quelleAusShop(data.sourceShop),
    sourceShop: text(data.sourceShop),
    adresse: text(data.sourceUrl) || text(data.scrapedUrl),
    werte,
  };
}

/** Rohdaten der bezahlten Suche (nutritionscrape-Kopie) in external_products.raw?
 *  Die REWE-Pipeline erkennt man an ihren eigenen Feldern (reweapify:
 *  merchant_company/price_current, scraped_products: thumbnails) — die
 *  gewinnen. Gemessen 04.10.2026: alle 740 Dokumente mit Shop-/OFF-Webseiten-
 *  Quelle tragen scrapedSource 'scraper', keines der 7.183 REWE-Dokumente. */
function rohdatenAusSuche(raw) {
  if (!raw || typeof raw !== 'object' || raw.scrapedSource !== 'scraper') return false;
  const reweMerkmal = raw.merchant_company != null || raw.price_current != null || raw.thumbnails != null;
  return !reweMerkmal;
}

/**
 * Trägt ein external_products-Dokument abgelehnten Altbestand (mitkopiert in
 * `raw`)? Dann bekommt der Schreibweg ihn als ersetzeQuelle zum Entfernen —
 * die Abfrage prüft das bei jedem Scan, ohne Lesevorgang. Nach dem Entfernen
 * ist `raw` weg, die Prüfung schlägt nicht wieder an.
 * @returns {{grund:string, ersetzeQuelle:object}|null}
 */
function abgelehnterAltbestandIm(doc, ean) {
  const raw = doc && doc.raw;
  if (!rohdatenAusSuche(raw)) return null;
  const abgelehnt = altbestandAbgelehnt(raw, ean);
  if (!abgelehnt) return null;
  return { grund: abgelehnt.grund, ersetzeQuelle: ersetzeQuelleAus(raw) };
}

/**
 * Eingabe für fuehreZusammen aus einem nutritionscrape-Dokument.
 * @param {object} data   nutritionscrape-Dokument
 * @param {{shopBilder:boolean|null}} konfig  _meta/produktsuche (shopBilder
 *   null = nach einem Lesefehler unbekannt, lib/konfiguration.js)
 * @param {string} [ean]  normalisierte EAN — ohne sie keine Ablehnungsprüfung
 * @returns {object|null} null: nichts zu übernehmen (auch: abgelehnter
 *   Altbestand und ungeprüfter Altbestand von OpenFoodFacts-Seiten)
 */
function ausRohablage(data, konfig, ean) {
  if (!data) return null;
  if (ean && altbestandAbgelehnt(data, ean)) return null;
  if (istOffWebseitenAltbestand(data)) return null;
  const daten = normaliseReweapify(data);
  // Bilder aus Shops sind meist Herstellerbilder (Urheberrecht, Frage an
  // Patrick offen): nur mit ausdrücklicher Freigabe _meta/produktsuche.
  // shopBilder. Andere Bildfelder kennt die Rohablage nicht (die KI las bis
  // 04.10.2026 kein Bild aus: 0 von 7.636 Einträgen). bildVonShop markiert
  // das Bild, damit Ausschalten es wieder entfernt (lib/speichern.js).
  // Der Schalter geht dreiwertig weiter: true übernimmt ein neues Bild,
  // false entfernt ein gespeichertes, unbekannt (Lesefehler) tut beides
  // nicht — ein Infrastrukturfehler ist keine Aussage (Schlussprüfung).
  const shopBilder = shopBildSchalter(konfig);
  daten.imageUrl = shopBilder === true ? text(data.shopBildUrl) ?? undefined : undefined;
  daten.bildVonShop = daten.imageUrl ? true : undefined;
  const preis = preisAusRohablage(data);
  daten.price = preis ? preis.wert : undefined;
  const stempel = abrufStempel(data);
  return {
    quelle: quelleAusShop(data.sourceShop),
    daten,
    fetchedAtMs: stempel.ms,
    fetchedAtQuelle: 'nutritionscrape',
    fetchedAtGeschaetzt: stempel.geschaetzt,
    priceShop: preis ? preis.shop : null,
    priceFetchedAtMs: preis ? preis.standMs : null,
    raw: data,
    shopBilder,
    // Ungeprüfter Altbestand füllt nur ein Dokument ohne Daten anderer
    // Quellen (lib/speichern.js) — Kopfkommentar.
    ungeprueft: istAltbestand(data),
  };
}

/**
 * Soll der Trigger onNutritionScrapeFuerExterne diesen Schreibvorgang
 * übernehmen? Nur für Barcodes ohne Katalogbezug (productPath), und nur
 *   • bei einem neuen echten Abruf (fetchedAt bzw. scrapedAt geändert) oder
 *   • wenn der Scraper Altbestand widerlegt hat (widerlegtAm geändert).
 * Reines Zusammenführen ohne neuen Abruf löst nichts aus → idempotent.
 *
 * `ersetzeQuelle`: war das Dokument VORHER ungeprüfter Altbestand, hat
 * dieser Schreibvorgang ihn ersetzt oder widerlegt — dann nimmt der
 * Schreibweg die Feldgruppen dieser Quelle aus external_products heraus.
 */
function uebernahmeNoetig(vorher, nachher) {
  if (!nachher) return { noetig: false, grund: 'geloescht' };
  if (text(nachher.productPath)) return { noetig: false, grund: 'katalog_verknuepft' };
  const ersetzeQuelle = istAltbestand(vorher) && !istAltbestand(nachher) ? ersetzeQuelleAus(vorher) : null;
  const widerlegt = zuMs(nachher.widerlegtAm);
  if (widerlegt !== null && widerlegt !== zuMs(vorher && vorher.widerlegtAm)) {
    return { noetig: true, grund: 'widerlegt', ersetzeQuelle };
  }
  const neu = abrufStempel(nachher).ms;
  if (neu === null) return { noetig: false, grund: 'kein_abruf' };
  const alt = vorher ? abrufStempel(vorher).ms : null;
  if (alt !== null && alt === neu) return { noetig: false, grund: 'unveraendert' };
  return { noetig: true, grund: 'neuer_abruf', ersetzeQuelle };
}

module.exports = {
  quelleAusShop,
  hostAus,
  quellHost,
  istAuslandsDomain,
  istAltbestand,
  istOffWebseitenAltbestand,
  preisAusRohablage,
  abrufStempel,
  altbestandAbgelehnt,
  ersetzeQuelleAus,
  rohdatenAusSuche,
  abgelehnterAltbestandIm,
  ausRohablage,
  uebernahmeNoetig,
};
