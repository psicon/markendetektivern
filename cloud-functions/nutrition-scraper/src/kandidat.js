/**
 * EINE Kandidaten-Seite lesen — der gemeinsame Weg für scrapeEan,
 * scrapeBatch und scrapeSingleUrl (bis 04.10.2026 hatte jeder Endpunkt seine
 * eigene, unterschiedlich strenge Fassung: scrapeEan prüfte die EAN nur bei
 * unbekannten Domains und behielt Preise auch aus „noPriceTrust“-Quellen).
 *
 * Reihenfolge — erst das Billige, dann das Bezahlte:
 *   1. Seite holen (Abruffehler → 'abrufFehler', kein Urteil über das Produkt)
 *   2. gehört die Seite zur EAN? (seitenDaten.analysiereSeite: EAN als
 *      JSON-LD-Kennung oder im sichtbaren Text, nicht mehrere Produkte) —
 *      sonst KEIN KI-Aufruf
 *   3. unbekannte Domain: Qualitätsprüfung (EAN + Nährwert-Stichwort + Größe)
 *   4. KI-Auslesen
 *   5. Daten nur, wenn sie zu dieser EAN gehören (keine Mehrproduktseite laut
 *      KI), Vertrauen der Quelle (priceOnly / noPriceTrust), Preis nur in
 *      Euro aus DE/AT-Shops, Name/Bild nur mit EAN-Beleg
 *
 * Scheiterte beim Abruf das Apify-Rendern einer dünnen Seite und belegt die
 * direkt geholte Fassung die EAN nicht, ist das ein Abruffehler — kein
 * „Seite gehört nicht zur EAN“ (sonst würde ein Apify-Ausfall den Shop in
 * der Telemetrie sperren und die EAN als „nichts gefunden“ enden).
 *
 * Ein Infrastrukturfehler (KI, Apify-Konto) wird weitergeworfen.
 */

'use strict';

const { fetchHtml } = require('./fetcher');
const { extractFromHtml } = require('./extractor');
const { SeiteNichtAbrufbarError } = require('./fehler');
const { isPageGoodCandidate } = require('./domains');
const { analysiereSeite, hatVerwertbareDaten, kiInhaltGilt } = require('./seitenDaten');
const { bereiteBefund } = require('./befund');
const { incrementTelemetryFail } = require('./writer');

/**
 * @returns {Promise<
 *   | { status: 'treffer', befund: object, finalUrl: string }
 *   | { status: 'abrufFehler', httpStatus: number|null, grund: string }
 *   | { status: 'keineSeite' }
 *   | { status: 'verworfen', grund: 'quality_check'|'ean_not_in_html'|'gtin_widerspruch'|'mehrere_produkte' }
 *   | { status: 'keineDaten', grund: 'ki_null'|'nichts_verwertbar'|'mehrere_produkte' }
 * >}
 * @param {string} [auftrag] nur für die Kosten-Logzeile des Extractors
 */
async function leseKandidat({ kandidat, ean, productName = null, apifyToken, verbrauch = null, db = null, auftrag = null }) {
  const eanStr = String(ean);
  let fetched;
  try {
    fetched = await fetchHtml(kandidat.url, { requiresJS: kandidat.requiresJS, apifyToken, verbrauch });
  } catch (e) {
    if (e instanceof SeiteNichtAbrufbarError) {
      console.warn(`[kandidat] ${kandidat.shop}: nicht abrufbar (${e.status ?? e.grund})`);
      return { status: 'abrufFehler', httpStatus: e.status, grund: e.grund };
    }
    throw e;
  }
  if (!fetched) return { status: 'keineSeite' };

  const verwirf = (grund) => {
    // Die direkt geholte Fassung war dünn und Apify konnte sie nicht
    // rendern: was fehlt, ist die Seite, nicht der Beleg. Nennt aber schon
    // die dünne Fassung eine ANDERE GTIN, ist das ein Urteil über die Seite.
    if (fetched.apifyGescheitert && grund !== 'gtin_widerspruch') {
      console.warn(`[kandidat] ${kandidat.shop}: ${grund} nach gescheitertem Apify-Rendern → Abruffehler`);
      return { status: 'abrufFehler', httpStatus: null, grund: fetched.apifyGescheitert };
    }
    if (db) incrementTelemetryFail(db, kandidat.shop, eanStr, grund).catch(() => {});
    console.log(`[kandidat] skip ${kandidat.shop} (${grund})`);
    return { status: 'verworfen', grund };
  };

  // Gehört die Seite zur EAN? Zuerst — auch vor der Qualitätsprüfung, damit
  // der Grund stimmt: „andere GTIN“/„EAN fehlt“ widerlegt eine gespeicherte
  // Quellseite (src/suche.js), „zu dünn“ nicht.
  const analyse = analysiereSeite({ inhalt: fetched.html, ean: eanStr, istMarkdown: fetched.via === 'apify' });
  if (!analyse.kiDarf) return verwirf(analyse.grundOhneKi);

  // Quality-Check für UNKNOWN-Domain-Hits (serper-unknown): bevor wir
  // KI-Token verbrennen, prüfen ob die Page überhaupt verwertbar ist.
  if (kandidat.requiresQualityCheck && !isPageGoodCandidate(fetched.html, eanStr)) {
    return verwirf('quality_check');
  }

  const extracted = await extractFromHtml({
    html: fetched.html,
    productName,
    ean: eanStr,
    rohName: analyse.rohName,
    verbrauch,
    auftrag,
  });
  if (!extracted) return { status: 'keineDaten', grund: 'ki_null' };

  const befund = bereiteBefund({ extracted, analyse, kandidat, finalUrl: fetched.finalUrl });
  if (!hatVerwertbareDaten(befund)) {
    const inhaltGilt = kiInhaltGilt({ analyse, kiEinzelprodukt: extracted._kiEinzelprodukt });
    return { status: 'keineDaten', grund: inhaltGilt ? 'nichts_verwertbar' : 'mehrere_produkte' };
  }
  return { status: 'treffer', befund, finalUrl: fetched.finalUrl };
}

module.exports = { leseKandidat };
