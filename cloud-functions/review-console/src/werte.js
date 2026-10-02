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

/* ── Barcode-Nummer vom Foto (Entscheidung Patrick 02.10.2026, „Super-Vorschlag") ──
 * Die Morgenrunde liest die Ziffern unter dem Strichcode des Barcode-Fotos
 * mit (im Aufruf der Bildprüfung) und legt sie in `eanFotoOcr` ab. Weicht die
 * gelesene Nummer von der gespeicherten ab, bleibt die Einreichung liegen —
 * ein Mensch entscheidet. Anlass: Einreichungen mit falschen EANs, und eine
 * falsch getippte EAN umginge die Wochen-Sperre.
 */
const ziffern = (v) => String(v ?? '').replace(/\D/g, '');
/** GTIN auf 14 Stellen: EAN-13 „0…"/UPC-A und EAN-13 sind dann vergleichbar. */
const gtin14 = (c) => ziffern(c).padStart(14, '0');

/**
 * Händler-/Waagen-Code (GS1 „restricted circulation"): GTIN-13-Präfix 02, 04
 * und 20–29, bei EAN-8 die Präfixe 0 und 2. Gilt nur in einem Markt, trägt bei
 * Waage-Etiketten Gewicht oder Preis. Lose Ware wird angenommen (Entscheidung
 * Patrick 20.09.2026) — liest das Modell so einen Code, ist das kein Beleg für
 * eine falsche EAN.
 */
function istHandelsCode(code) {
  const c = ziffern(code);
  if (c.length === 8) return c[0] === '0' || c[0] === '2';
  if (c.length < 12 || c.length > 14) return false;
  return /^(02|04|2)/.test(gtin14(c).slice(1));
}

/** Die vom Barcode-Foto gelesene Nummer — nur mit gültiger Prüfziffer. */
function eanFotoOf(x) {
  const e = x && x.eanFotoOcr && typeof x.eanFotoOcr === 'object' ? ziffern(x.eanFotoOcr.ean) : '';
  return e && pruefzifferOk(e) ? e : null;
}

/**
 * Gespeicherte EAN gegen die Nummer vom Barcode-Foto.
 *
 * Verglichen wird mit `ean` — der Nummer, die die App gescannt oder der Nutzer
 * eingetippt hat. Eine nur nachgelesene EAN (`eanRescueOcr`) stammt selbst aus
 * den Fotos; dort gäbe es nichts zu prüfen.
 *
 * @returns {{art:'gleich'|'abweichend'|'kein_urteil', gelesen:string|null, gespeichert:string|null, grund?:string}}
 *   `kein_urteil`: Foto nicht lesbar bzw. Prüfziffer falsch (nur eine gültige
 *   GTIN zählt als gelesen), Händler-/Waagen-Code gelesen, oder keine
 *   gespeicherte EAN. Daraus folgt weder Halten noch Freigeben.
 */
function eanFotoBefund(gespeichertRoh, gelesenRoh) {
  const gelesen = ziffern(gelesenRoh);
  const gespeichert = ziffern(gespeichertRoh) || null;
  if (!gelesen || !pruefzifferOk(gelesen)) return { art: 'kein_urteil', gelesen: null, gespeichert, grund: gelesen ? 'pruefziffer' : 'nicht_lesbar' };
  if (istHandelsCode(gelesen)) return { art: 'kein_urteil', gelesen, gespeichert, grund: 'handelscode' };
  if (!gespeichert) return { art: 'kein_urteil', gelesen, gespeichert, grund: 'nichts_gespeichert' };
  if (gtin14(gelesen) === gtin14(gespeichert)) return { art: 'gleich', gelesen, gespeichert };
  return { art: 'abweichend', gelesen, gespeichert };
}

/**
 * Eine Abweichung zählt erst, wenn eine ZWEITE, nur auf das Barcode-Foto
 * gerichtete Lesung dieselbe Nummer liefert (gemessen 02.10.2026 an 273
 * offenen Fällen: 9 Abweichungen in der Bildprüfung, davon 7 echt — eine von
 * einem unscharfen Foto, bei dem jede Lesung eine andere, aber gültige Nummer
 * erfand, eine von einem dunklen Foto mit einer falsch gelesenen Ziffer). Eine
 * Prüfziffer allein schützt nicht: das Modell erfindet gültige Nummern.
 * Wie bei der EAN-Rettung (zwei übereinstimmende Lesungen).
 * @param {object} befund  eanFotoBefund aus der Bildprüfung
 * @param {string|null} zweitRoh  Ziffern der zweiten Lesung
 * @returns {object} `abweichend` mit `bestaetigt: true`, oder `kein_urteil` (`lesungen_uneinig`)
 */
function eanFotoBestaetigen(befund, zweitRoh) {
  if (!befund || befund.art !== 'abweichend') return befund;
  const zweit = ziffern(zweitRoh);
  if (zweit && pruefzifferOk(zweit) && gtin14(zweit) === gtin14(befund.gelesen)) return { ...befund, bestaetigt: true };
  return { art: 'kein_urteil', gelesen: null, gespeichert: befund.gespeichert, grund: 'lesungen_uneinig' };
}

/** Bildarten, auf denen ein Preis steht (Lesedienst und Nachlesung benutzen dieselben Namen). */
const PREIS_ARTEN = ['preisschild', 'kassenbon', 'beides'];

/**
 * Anzeichen, dass im Bild doch ein Preis ist, obwohl keiner gelesen wurde: der
 * Lesedienst hat beim Anlegen ein Preisschild oder einen Kassenbon erkannt.
 * Widerspricht das einer Bildprüfung, die „kein Preis" sagt, lehnt die
 * Morgenrunde NICHT ab, sondern lässt den Fall liegen (Preis-Pflicht 26.09.2026).
 * @returns {string|null} kurzer Hinweis für den Menschen
 */
function preisHinweisOf(x) {
  const art = String(x.priceImageKind || '').toLowerCase();
  if (PREIS_ARTEN.includes(art)) return `Lesedienst sah auf dem Preisfoto: ${art}`;
  const b = x.priceReceipt;
  if (b && (b.zip || b.city || b.merchant || b.street)) return 'Lesedienst erkannte einen Kassenbon';
  return null;
}

module.exports = {
  pruefzifferOk, eanOf, nameOf, preisOf, policyOf, herstellerAnzeige, vollstaendigkeitOf, herkunftOf, preisHinweisOf, PREIS_ARTEN,
  gtin14, istHandelsCode, eanFotoOf, eanFotoBefund, eanFotoBestaetigen,
};
