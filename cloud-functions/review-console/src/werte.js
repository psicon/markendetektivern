'use strict';
/**
 * Effektive Werte einer Produktfoto-Einreichung (`crowd_uploads`) — EINE Quelle
 * für Morgenrunde (taeglicheRunde.js) und Prüfkonsole (einreichung.js).
 *
 * Warum: Bis 26.09.2026 las die Runde die nachgelesenen Felder (*RescueOcr) mit,
 * die Konsole nicht. Derselbe Fall hieß im Tagesbericht „K-Classic Gouda" und in
 * der Konsole „(ohne Name) · Kein Name erkennbar"; einmal wurde deshalb „trotz
 * Sperre" freigegeben, obwohl nichts gesperrt war. Wer eine Regel hier ändert,
 * ändert sie für beide.
 *
 * Reihenfolge je Angabe: was der Nutzer eingetragen hat → was der Namer beim
 * Anlegen las → was später nachgelesen wurde. Die nachgelesenen Felder schreibt
 * nur der Server (firestore.rules sperrt sie beim Anlegen).
 */
const { ms } = require('./duplicatePolicy');

/** GTIN-Prüfziffer (8/12/13/14 Stellen). */
function pruefzifferOk(code) {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(code)) return false;
  const z = code.split('').map(Number);
  const p = z.pop();
  let summe = 0;
  z.reverse().forEach((v, i) => { summe += v * (i % 2 === 0 ? 3 : 1); });
  return (10 - (summe % 10)) % 10 === p;
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const gueltigerPreis = (p) => !!p && Number.isFinite(p.priceCents) && p.priceCents > 0;

/** Nachgelesene EAN nur mit gültiger Prüfziffer. Die Rettung schreibt nur
 *  solche (eanAusLesungen); eine andere wäre eingeschleust oder Altbestand. */
function gerettetEan(x) {
  const e = x.eanRescueOcr;
  return typeof e === 'string' && pruefzifferOk(e) ? e : null;
}

const eanOf = (x) => x.ean || gerettetEan(x) || null;
const nameOf = (x) => x.productName || x.productNameOcr || x.productNameRescueOcr || null;
/** Liefert das Preis-OBJEKT ({priceCents, …}); ob es gültig ist, prüft die Doppel-Regel (priceOf). */
const preisOf = (x) => (gueltigerPreis(x.priceOcr) ? x.priceOcr : x.priceRescueOcr || null);

/**
 * Hersteller für die ANZEIGE — inklusive Nachlesung. Für die Doppel-Regel gilt
 * er NICHT, siehe policyOf.
 */
const herstellerAnzeige = (x) =>
  text(x.manufacturerOcr && x.manufacturerOcr.name) || text(x.manufacturerRescueOcr && x.manufacturerRescueOcr.name);

/**
 * Eingabe der Doppel-Regel (evaluateDuplicate).
 *
 * `manufacturerOcr` bleibt AUSSCHLIESSLICH der Wert des Namers: ein
 * nachgelesener Hersteller löst keine Sperre. „Kaufland Stiftung & Co."
 * (Markeninhaber) und „DMK" (Produzent) stehen auf derselben Packung — als
 * „andere Daten" gewertet gäbe das eine echte Dublette frei (CLAUDE.md,
 * Produktfoto-Runde 20.09.2026). Ein nachgelesener PREIS darf dagegen lösen:
 * der Preis vom Schild ist eindeutig.
 */
const policyOf = (id, x) => ({
  id, userId: x.userId ?? null, ean: eanOf(x), marketId: x.marketId ?? null,
  status: x.status, createdAt: ms(x.createdAt), priceOcr: preisOf(x), manufacturerOcr: x.manufacturerOcr ?? null,
});

/** Eingabe der Vollständigkeitsprüfung (completenessCheck) mit effektiver EAN und effektivem Namen. */
const vollstaendigkeitOf = (x) => ({
  images: x.images, ean: eanOf(x), productName: x.productName, productNameOcr: x.productNameOcr || x.productNameRescueOcr,
});

/** Woher die angezeigten Werte stammen — damit ein nachgelesener Wert als solcher erkennbar bleibt. */
function herkunftOf(x) {
  const nameQuelle = x.productName ? 'nutzer' : x.productNameOcr ? 'ocr' : x.productNameRescueOcr ? 'nachgelesen' : null;
  return {
    nameQuelle,
    eanNachgelesen: !x.ean && !!gerettetEan(x),
    preisNachgelesen: !gueltigerPreis(x.priceOcr) && gueltigerPreis(x.priceRescueOcr),
    herstellerNachgelesen: !text(x.manufacturerOcr && x.manufacturerOcr.name) && !!text(x.manufacturerRescueOcr && x.manufacturerRescueOcr.name),
  };
}

module.exports = { pruefzifferOk, eanOf, nameOf, preisOf, policyOf, herstellerAnzeige, vollstaendigkeitOf, herkunftOf };
