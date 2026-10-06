/**
 * GTIN-Regeln für die Prüfung von Altbestand der bezahlten Suche — rein,
 * ohne Seiteneffekte (Prüfrunde 2, 04.10.2026).
 *
 * WARUM: Daten, die vor dem 04.10.2026 ohne EAN-Beleg gelesen wurden, lassen
 * sich in vielen Fällen ohne Netz und ohne Kosten als fremd erkennen:
 *   • Die gespeicherte Quell-Adresse nennt eine ANDERE gültige GTIN
 *     (gemessen: 60 Altbestand-Dokumente ohne Katalogbezug, 31 davon in
 *     external_products — etwa produkte.globus.de/…/4260237970446/… als
 *     Quelle für 3560070417148).
 *   • Die EAN ist ein Händler-Code (Waage/Laden, 8-stellige Kurznummer), und
 *     die Seite stammt nicht von einem Händler, der solche Codes ausgibt.
 *
 * Kopie aus external-misses-processor/src/regeln.js (istGueltigeGtin,
 * als13Stellen, istLadencode, istRcn8, RCN8_DOMAINS) — Codebases teilen keinen
 * Code; bei Änderungen beide nachziehen.
 */

'use strict';

const { eanVarianten } = require('./katalog');

const GTIN_LAENGEN = [8, 12, 13, 14];

const istZiffernfolge = (s) => typeof s === 'string' && /^\d+$/.test(s);

/**
 * Gültige GTIN: nur Ziffern, Länge 8/12/13/14, GS1-Prüfziffer stimmt, nicht
 * nur Nullen.
 */
function istGueltigeGtin(code) {
  if (!istZiffernfolge(code) || !GTIN_LAENGEN.includes(code.length)) return false;
  if (/^0+$/.test(code)) return false;
  const ziffern = code.split('').map(Number);
  const pruef = ziffern.pop();
  let summe = 0;
  for (let i = ziffern.length - 1, gewicht = 3; i >= 0; i -= 1, gewicht = 4 - gewicht) {
    summe += ziffern[i] * gewicht;
  }
  return (10 - (summe % 10)) % 10 === pruef;
}

/** 13-stellige Schreibweise einer GTIN-12/13/14 oder null. */
function als13Stellen(code) {
  if (!istZiffernfolge(code)) return null;
  if (code.length === 13) return code;
  if (code.length === 12) return `0${code}`;
  if (code.length === 14 && code[0] === '0') return code.slice(1);
  return null;
}

/** Händler-interner Code (Waage/Laden): 13-stellig mit Präfix 2, 02 oder 04. */
function istLadencode(code) {
  if (!istGueltigeGtin(code)) return false;
  const k13 = als13Stellen(code);
  return !!k13 && /^(2|02|04)/.test(k13);
}

/** RCN-8: 8-stellige, gültige GTIN mit führender 2 oder 0. */
function istRcn8(code) {
  return istGueltigeGtin(code) && code.length === 8 && (code[0] === '2' || code[0] === '0');
}

/** Deutsche Handelsketten, die RCN-8-Codes ausgeben (Kopie, siehe oben). */
const RCN8_DOMAINS = Object.freeze([
  'lidl.de', 'kaufland.de', 'aldi-nord.de', 'aldi-sued.de', 'mein-aldi.de', 'penny.de',
  'netto-online.de', 'netto.de', 'norma-online.de', 'rewe.de', 'edeka.de', 'edeka24.de',
  'marktkauf.de', 'globus.de', 'tegut.de', 'mytime.de', 'dm.de', 'rossmann.de', 'mueller.de',
  'budni.de',
]);

/** Gehört der Host zu einer der Domains (gleich oder Unterdomain)? */
function hostGehoertZu(host, domains) {
  if (typeof host !== 'string' || !host) return false;
  const h = host.toLowerCase().replace(/^www\./, '');
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

/** OpenFoodFacts-/OpenBeautyFacts-Seite (jede Sprachdomain)? */
function istOpenFactsHost(host) {
  return typeof host === 'string' && /(^|\.)open(food|beauty|petfood|products)facts\.org$/i.test(host);
}

/** Nur OpenFoodFacts selbst (jede Sprachdomain) — die Datenbank, die die
 *  kostenlose API (world.openfoodfacts.org) liefert. Schwester-Datenbanken
 *  (OpenBeautyFacts & Co.) fragt die Abfrage nicht ab. */
function istOpenFoodFactsHost(host) {
  return typeof host === 'string' && /(^|\.)openfoodfacts\.org$/i.test(host);
}

/**
 * Gleicher Artikel, andere Verpackungsebene: eine GTIN-14 mit
 * Packungsindikator 1–8 (Karton, Tray) trägt dieselbe Artikelnummer wie die
 * Einzel-EAN — nur Indikator und Prüfziffer unterscheiden sich. Eine
 * Shopseite, die den Karton nennt, beschreibt dasselbe Produkt.
 */
function gleicherArtikel(gtin14, ean) {
  if (typeof gtin14 !== 'string' || gtin14.length !== 14) return false;
  const e = String(ean ?? '').replace(/\D/g, '');
  if (!e || e.length > 13) return false;
  return gtin14.slice(1, 13) === e.padStart(13, '0').slice(0, 12);
}

/**
 * Nennt eine Quell-Adresse eine ANDERE gültige GTIN als die EAN?
 *
 * Gezählt werden nur Ziffernfolgen mit 12–14 Stellen im Pfad oder in der
 * Abfrage, deren Prüfziffer stimmt — achtstellige Folgen sind in Adressen
 * meist Artikel- oder Pharmazentralnummern (gemessen: beautifulbalance-
 * drogerie /product/13709938/, medklick /07243059/ — beides zufällig gültige
 * GTIN-8, beide Seiten passten zur EAN). Ausnahme: OpenFoodFacts führt den
 * Code selbst im Pfad (/produkt/<code>, /product/<code>), dort zählt jede
 * Länge.
 *
 * Steht die EAN selbst (in irgendeiner Schreibweise) in der Adresse, gilt
 * sie nie als fremd.
 *
 * @returns {string|null} die fremde GTIN oder null
 */
function fremdeGtinInAdressen(adressen, ean) {
  const eigene = new Set(eanVarianten(ean));
  if (eigene.size === 0) return null;
  const fremde = [];
  for (const adresse of adressen) {
    if (typeof adresse !== 'string' || !adresse.trim()) continue;
    let url;
    try {
      url = new URL(adresse.trim());
    } catch {
      continue;
    }
    const teil = `${url.pathname}${url.search}`;
    const folgen = [...teil.matchAll(/(?<!\d)(\d{12,14})(?!\d)/g)].map((m) => m[1]);
    if (istOpenFactsHost(url.hostname)) {
      const m = url.pathname.match(/\/(?:produkt|product|produit|producto|prodotto)\/(\d{8,14})(?!\d)/i);
      if (m) folgen.push(m[1]);
    }
    for (const f of folgen) {
      if (eigene.has(f) || gleicherArtikel(f, ean)) return null;
      if (istGueltigeGtin(f)) fremde.push(f);
    }
  }
  return fremde[0] ?? null;
}

module.exports = {
  istGueltigeGtin,
  istLadencode,
  istRcn8,
  RCN8_DOMAINS,
  hostGehoertZu,
  istOpenFactsHost,
  istOpenFoodFactsHost,
  fremdeGtinInAdressen,
};
