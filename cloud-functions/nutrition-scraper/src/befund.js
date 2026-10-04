/**
 * Aus dem KI-Ergebnis und den Seitendaten den Befund bauen, der in
 * nutritionscrape geschrieben wird — reine Funktion, ohne Netz/Firestore.
 *
 * Regeln:
 *   • Übernommen werden nur Datenfelder (attr_*, nutr_*) und die Meta-Angaben
 *     des KI-Aufrufs (_confidence, _model, _tokens*). Alles andere, was die
 *     KI zurückgibt, fällt weg — Name, Bild, Herkunft und Pfad setzen nur
 *     die Belegprüfung und der Writer (Prüfrunde 04.10.2026).
 *   • Die Daten der KI nur, wenn sie zu dieser EAN gehören
 *     (seitenDaten.kiInhaltGilt: kein Mehrproduktseiten-Inhalt).
 *   • priceOnly-Quellen (Preis-Aggregatoren) liefern nur den Preis,
 *     noPriceTrust-Quellen (Datenbanken, unbekannte Domains) keinen Preis
 *     (User-Vorgabe 2026-05-19, bis 04.10. nur in scrapeBatch angewandt).
 *   • Preis: Trägt ein JSON-LD-Produkt die EAN und hat es ein Angebot, gilt
 *     dessen Preis — er ist maschinenlesbar genau diesem Produkt zugeordnet,
 *     die KI kann auf einer Seite mit mehreren Angeboten den falschen lesen.
 *     Weicht er vom KI-Preis ab, fallen dessen Packungs-/Grundpreisangaben
 *     weg (sie gehörten zum KI-Preis). Sonst der KI-Preis; fehlt er, das
 *     Angebot des einzigen Produkts der Seite (die KI sieht kein JSON-LD).
 *   • Preis nur > 0, in Euro (falls die Seite eine Währung nennt) und aus
 *     einem DE/AT-Shop (domains.preisLandErlaubt). Dann mit priceShop und
 *     priceCurrency 'EUR'; das Datum setzt der Writer (priceFetchedAt).
 *   • Name, Bild und eanBeleg nur über seitenDaten.ermittleIdentitaet.
 */

'use strict';

const { preisLandErlaubt } = require('./domains');
const { ermittleIdentitaet, kiInhaltGilt } = require('./seitenDaten');
const { PREIS_FELDER } = require('./zusammenfuehren');

const KI_META = ['_confidence', '_model', '_tokensIn', '_tokensOut', '_tokensThought'];
const PREIS_BEGLEITER = ['attr_preisPackgroesse', 'attr_preisPerKg'];

const istDatenfeld = (k) => k.startsWith('attr_') || k.startsWith('nutr_');
const gueltigerPreis = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Reine Nachbearbeitung des KI-Ergebnisses (testbar ohne Netz).
 *
 * @param {object} args
 * @param {object} args.extracted  Ergebnis von extractFromHtml
 * @param {object} args.analyse    Ergebnis von analysiereSeite
 * @param {object} args.kandidat   { shop, priceOnly, noPriceTrust }
 * @param {string} args.finalUrl   tatsächliche Seitenadresse
 * @returns {object} flacher Befund für writeScrapeResult (inkl. _-Feldern)
 */
function bereiteBefund({ extracted, analyse, kandidat, finalUrl }) {
  const befund = {};
  for (const k of KI_META) if (extracted[k] !== undefined) befund[k] = extracted[k];

  const inhaltGilt = kiInhaltGilt({ analyse, kiEinzelprodukt: extracted._kiEinzelprodukt });
  if (inhaltGilt) {
    for (const [k, v] of Object.entries(extracted)) {
      if (istDatenfeld(k)) befund[k] = v;
    }
  }

  // ── Vertrauen der Quelle (User-Vorgabe 2026-05-19) ──
  if (kandidat.priceOnly) {
    // Aggregator (z.B. discounto) → nur Preis-Felder
    for (const k of Object.keys(befund)) {
      if (k.startsWith('_')) continue;
      if (!PREIS_FELDER.includes(k)) delete befund[k];
    }
  }

  // ── Preis: belegtes JSON-LD-Angebot vor KI, in Euro, aus einem DE/AT-Shop ──
  const kiPreis = gueltigerPreis(befund.attr_preis) ? befund.attr_preis : null;
  const ldPreis = analyse.angebot && gueltigerPreis(analyse.angebot.preis) ? analyse.angebot.preis : null;
  let preis = null;
  if (analyse.passendesProdukt && ldPreis != null) {
    preis = ldPreis;
    if (kiPreis !== ldPreis) for (const k of PREIS_BEGLEITER) delete befund[k];
  } else if (kiPreis != null) {
    preis = kiPreis;
  } else if (ldPreis != null && inhaltGilt) {
    preis = ldPreis;
  }
  const waehrungOk = !analyse.waehrung || analyse.waehrung === 'EUR';
  if (preis == null || kandidat.noPriceTrust || !waehrungOk || !preisLandErlaubt(finalUrl)) {
    for (const k of PREIS_FELDER) delete befund[k];
  } else {
    befund.attr_preis = preis;
    befund.priceShop = kandidat.shop || hostVon(finalUrl);
    befund.priceCurrency = 'EUR';
  }

  // ── Name und Bild nur mit Beleg ──
  if (!kandidat.priceOnly) {
    const ident = ermittleIdentitaet({
      analyse,
      ki: {
        name: extracted._kiProduktName,
        einzelprodukt: extracted._kiEinzelprodukt,
        bildUrl: extracted._kiBildUrl,
      },
      basisUrl: finalUrl,
    });
    if (ident) Object.assign(befund, ident);
  }
  return befund;
}

function hostVon(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

module.exports = { bereiteBefund };
