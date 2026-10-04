/**
 * Ablauf von scrapeEan für EINE EAN: erst die bevorzugte Seite (ohne Suche),
 * dann die Serper-Suche, Kandidaten nacheinander bis zum ersten Treffer.
 *
 * Die Abhängigkeiten (Seite lesen, Kandidaten suchen) kommen als `deps`
 * herein, damit der Ablauf ohne Netz testbar ist.
 *
 * Zählt getrennt:
 *   • infraFehler  — KI oder Apify-Konto ausgefallen (InfrastrukturFehler).
 *                    KI ausgefallen → sofort abbrechen (jede weitere Seite
 *                    bräuchte sie; Prüfrunde 2: bei hängender KI kostet ein
 *                    Kandidat ~151 s, ein zweiter riss den Abbruch des
 *                    Prozessors nach 240 s); Apify-Konto → zwei in Folge.
 *                    Später erneut (503).
 *   • abrufFehler  — eine Seite war nicht abrufbar (403/429/5xx/Zeitlimit);
 *                    die Suche geht weiter
 *   • beantwortet  — Kandidaten, die eine Antwort lieferten (Seite, 404,
 *                    „gehört nicht zur EAN“, „keine Daten“)
 * Dieselben Zähler noch einmal NUR für die belegten Kandidaten (Serper-
 * Treffer und die bevorzugte Seite — nicht die Rückfall-Adressen von
 * Codecheck/OpenFoodFacts, die für jede EAN angehängt werden): Codecheck
 * antwortet auf jede unbekannte EAN mit einer Suchseite und galt damit als
 * „beantwortet“ — scheiterten alle Shopseiten an 403, endete die EAN trotzdem
 * als 'no-data' (Prüfrunde 2: seit 02.10. bis zu 52 von 260 Suchen).
 * Entscheidung ohne Treffer: anfrage.entscheideErgebnis.
 *
 * Die Suche endet beim ersten VOLLEN Treffer (istVollerTreffer): Zutaten
 * oder Nährwerte, oder ein belegter Name zusammen mit Preis/Hersteller. Ein
 * Teilfund — nur Name/Bild (bis 04.10. „nichts gefunden“) oder nur
 * Preis/Hersteller ohne Namen (bis zur Prüfrunde 04.10. das Ende der Suche,
 * obwohl die App daraus nichts zeigen kann) — wird gemerkt und mit späteren
 * Teilfunden zusammengeführt: findet sich nichts Besseres, ist er das
 * Ergebnis; sonst ergänzt er den vollen Treffer.
 *
 * Verwirft die Suche die bevorzugte Seite (gespeicherte Quellseite einer
 * Auffrischung), weil sie eine andere GTIN trägt, unsere EAN nicht zeigt oder
 * mehrere Produkte zeigt, meldet sie das (`bevorzugteUrlWiderlegt`): Daten,
 * die vor dem 04.10.2026 ohne EAN-Beleg von dort gelesen wurden, gelten dann
 * als widerlegt (src/zusammenfuehren.js widerlegeAltbestand).
 */

'use strict';

const { InfrastrukturFehler } = require('./fehler');
const { entscheideErgebnis, istRatekandidat } = require('./anfrage');
const { hatInhaltsdaten } = require('./seitenDaten');
const { ergaenzeBefund } = require('./zusammenfuehren');

// Gründe, aus denen die bevorzugte Seite die dort früher gelesenen Daten
// widerlegt (src/kandidat.js). Abruffehler, 404 oder „KI liest nichts“ sind
// KEIN Widerspruch.
const WIDERLEGT_GRUENDE = new Set(['gtin_widerspruch', 'ean_not_in_html', 'mehrere_produkte']);

const text = (v) => typeof v === 'string' && v.trim().length > 0;

/** Kann die App aus dem Befund ein Produkt zeigen UND trägt er Daten? */
function istVollerTreffer(b) {
  if (!b) return false;
  const zutaten = text(b.attr_ingredientStatement);
  const naehrwerte = ['nutr_Energie_val', 'nutr_Fett_val', 'nutr_Kohlenhydrate_val', 'nutr_Eiwei_val']
    .some((f) => typeof b[f] === 'number');
  return zutaten || naehrwerte || (text(b.productName) && hatInhaltsdaten(b));
}

// Der external-misses-processor bricht seinen Aufruf nach 240 s ab. Danach
// keine neuen Kandidaten mehr anfangen, sondern ehrlich „später erneut“.
const FRIST_MS = 190_000;

async function sucheEan({
  ean,
  productName = null,
  bevorzugteUrl = null,
  filter = {},
  serper = null,
  apifyToken = null,
  db = null,
  verbrauch = null,
  deps,
  fristMs = FRIST_MS,
  jetzt = Date.now,
  auftrag = null,
}) {
  const start = jetzt();
  const zustand = {
    infraFehler: 0,
    inFolge: 0,
    kiAusfall: false,
    letzterFehlerCode: null,
    zeitlimit: false,
    abrufFehler: 0,
    beantwortet: 0,
    belegteKandidaten: 0,
    belegteAbrufFehler: 0,
    belegteBeantwortet: 0,
    versucht: 0,
  };

  const abgebrochen = () => zustand.zeitlimit || zustand.kiAusfall || zustand.inFolge >= 2;
  let teilfund = null;
  let bevorzugteUrlWiderlegt = null;

  const probiere = async (liste, { bevorzugt = false } = {}) => {
    for (const kandidat of liste) {
      if (jetzt() - start > fristMs) {
        zustand.zeitlimit = true;
        return null;
      }
      // KI ausgefallen, oder zweimal hintereinander Apify-Konto → der Dienst
      // ist gerade weg; keine weiteren Seiten holen, später erneut.
      if (abgebrochen()) return null;
      const belegt = !istRatekandidat(kandidat);
      if (belegt) zustand.belegteKandidaten += 1;
      zustand.versucht += 1;
      let r;
      try {
        r = await deps.leseKandidat({ kandidat, ean, productName, apifyToken, verbrauch, db, auftrag });
      } catch (e) {
        if (!(e instanceof InfrastrukturFehler)) throw e;
        zustand.infraFehler += 1;
        zustand.inFolge += 1;
        if (e.code === 'extract_unavailable') zustand.kiAusfall = true;
        zustand.letzterFehlerCode = e.code;
        console.warn(`[scrapeEan] ${e.code} (${kandidat.shop}): ${e.message}`);
        continue;
      }
      if (r.status === 'abrufFehler') {
        zustand.abrufFehler += 1;
        if (belegt) zustand.belegteAbrufFehler += 1;
        continue;
      }
      zustand.beantwortet += 1;
      if (belegt) zustand.belegteBeantwortet += 1;
      if (r.status === 'treffer' || r.status === 'keineDaten') zustand.inFolge = 0;
      if (bevorzugt && WIDERLEGT_GRUENDE.has(r.grund) && (r.status === 'verworfen' || r.status === 'keineDaten')) {
        bevorzugteUrlWiderlegt = { url: kandidat.url, grund: r.grund };
      }
      if (r.status !== 'treffer') continue;
      if (!istVollerTreffer(r.befund)) {
        teilfund = teilfund
          ? { ...teilfund, befund: ergaenzeBefund(teilfund.befund, r.befund) }
          : { ...r, kandidat };
        continue;
      }
      return teilfund
        ? { ...r, kandidat, befund: ergaenzeBefund(r.befund, teilfund.befund) }
        : { ...r, kandidat };
    }
    return null;
  };

  let kandidaten = 0;
  let treffer = null;
  let bevorzugterKandidat = null;
  const schonVersucht = new Set();

  if (bevorzugteUrl) {
    bevorzugterKandidat = await deps.kandidatFuerUrl(bevorzugteUrl, { filter });
    if (bevorzugterKandidat) {
      kandidaten += 1;
      schonVersucht.add(bevorzugterKandidat.url);
      treffer = await probiere([bevorzugterKandidat], { bevorzugt: true });
    }
  }

  if (!treffer && !abgebrochen()) {
    // Wirft InfrastrukturFehler, wenn die Suche selbst ausfällt (Serper).
    const liste = (await deps.resolveCandidates([String(ean)], {
      serper,
      ohneOpenFoodFacts: !!filter.ohneOpenFoodFacts,
      nurDomains: filter.nurDomains || null,
      verbrauch,
    })).filter((k) => !schonVersucht.has(k.url));
    kandidaten += liste.length;
    treffer = await probiere(liste);
  }
  // Teilfund als Ergebnis — aber nicht, wenn unterwegs KI/Apify ausfiel
  // oder die Frist ablief: dann fehlte womöglich nur der Dienst, und ein
  // „resolved“ würde die EAN für die Auffrischungsfrist schließen.
  if (!treffer && teilfund && zustand.infraFehler === 0 && !zustand.zeitlimit) {
    treffer = teilfund;
  }

  const ergebnis = treffer
    ? null
    : entscheideErgebnis({
      kandidaten,
      infraFehler: zustand.infraFehler,
      letzterFehlerCode: zustand.letzterFehlerCode,
      zeitlimit: zustand.zeitlimit,
      abrufFehler: zustand.abrufFehler,
      beantwortet: zustand.beantwortet,
      belegteKandidaten: zustand.belegteKandidaten,
      belegteAbrufFehler: zustand.belegteAbrufFehler,
      belegteBeantwortet: zustand.belegteBeantwortet,
    });

  return {
    treffer,
    ueberBevorzugteUrl: !!treffer && !!bevorzugterKandidat && treffer.kandidat.url === bevorzugterKandidat.url,
    kandidaten,
    versucht: zustand.versucht,
    abrufFehler: zustand.abrufFehler,
    infraFehler: zustand.infraFehler,
    bevorzugteUrlWiderlegt,
    ergebnis,
  };
}

module.exports = { sucheEan, FRIST_MS };
