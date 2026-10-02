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
const policyOf = (id, x, serverZeit = null) => ({
  id, userId: x.userId ?? null, ean: eanOf(x), marketId: x.marketId ?? null,
  status: x.status, createdAt: einreichZeit(x, serverZeit), priceOcr: preisOf(x), manufacturerOcr: x.manufacturerOcr ?? null,
});

/**
 * Einreich-Zeitpunkt für die Regeln: der Server-Zeitpunkt des Dokuments
 * (`createTime` des Snapshots), wo der Aufrufer ihn hat — sonst `createdAt`.
 *
 * Warum (Prüfrunde 02.10.2026): `createdAt` schreibt der Client, und
 * firestore.rules prüft den Wert beim Anlegen nicht. Die App setzt
 * serverTimestamp(); ein veränderter Client könnte das Feld aber um mehr als
 * sieben Tage verschieben und so die Wochen-Sperre und die Regel „ältere
 * eigene noch offen" umgehen. `createTime` setzt Firestore selbst. Gemessen
 * 02.10.2026: bei 0 von 4.102 Einreichungen weichen die beiden um mehr als
 * 10 Minuten ab — die Umstellung ändert am Bestand nichts. Ein Rules-Zwang
 * (`createdAt == request.time`) wäre die Alternative, sperrte aber jede
 * ältere App-Version aus, die das Feld anders setzt.
 */
function einreichZeit(x, serverZeit = null) {
  return ms(serverZeit) ?? ms(x && x.createdAt);
}

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
 * ein Mensch entscheidet. Anlass: Einreichungen mit falschen EANs.
 */
const ziffern = (v) => String(v ?? '').replace(/\D/g, '');
/** GTIN auf 14 Stellen: EAN-13 „0…"/UPC-A und EAN-13 sind dann vergleichbar. */
const gtin14 = (c) => ziffern(c).padStart(14, '0');

/**
 * Gruppenschlüssel einer EAN für die Doppel-Regel: dieselbe GTIN in jeder
 * Schreibweise (führende Nullen, UPC-A als 12 Stellen, EAN-13 mit „0" davor).
 *
 * Warum (Prüfrunde 02.10.2026): die App nimmt beim Eintippen 8–14 Ziffern
 * ohne Normalisierung an. Wer „0" + EAN-13 eintippt, landete in einer eigenen
 * Gruppe — und die Wochen-Sperre griff nicht. Nach GS1 ist die links mit
 * Nullen aufgefüllte 14-stellige Form DIE kanonische GTIN; zwei Schreibweisen
 * mit derselben Form sind dasselbe Produkt. Ohne 8–14 Ziffern bleibt der
 * Rohwert (sonst fielen alle unbrauchbaren Eingaben in EINE Gruppe).
 * @returns {string|null}
 */
function eanSchluessel(e) {
  if (e == null || e === '') return null;
  const z = ziffern(e);
  return z.length >= 8 && z.length <= 14 ? z.padStart(14, '0') : String(e);
}

/**
 * Alle Schreibweisen derselben GTIN, wie sie in `ean`/`eanRescueOcr` stehen
 * können (8–14 Stellen, nur führende Nullen weggelassen) — für Abfragen mit
 * `in` (höchstens 8 Werte, Firestore erlaubt 30). Der Rohwert ist immer dabei.
 */
function eanVarianten(e) {
  const s = eanSchluessel(e);
  if (!s) return [];
  const out = new Set([String(e)]);
  if (/^\d{14}$/.test(s)) {
    for (let n = 8; n <= 14; n++) {
      if (/^0*$/.test(s.slice(0, 14 - n))) out.add(s.slice(14 - n));
    }
  }
  return [...out];
}

/**
 * Waagen-/Händler-Code mit eingerechnetem Gewicht oder Preis (GS1 „variable
 * measure" / Ladennummern): GTIN-13 mit Präfix 02, 04 oder 20–29, UPC-A mit
 * Zahlsystem 2 oder 4. Die Nummer wechselt von Packung zu Packung — liest das
 * Modell so einen Code, ist das kein Beleg für eine falsche EAN. Lose Ware
 * wird angenommen (Entscheidung Patrick 20.09.2026).
 *
 * EAN-8 ist NIE ausgenommen (Prüfrunde 02.10.2026): EAN-8 mit 0 oder 2 vorne
 * sind bei Lidl, Penny und Norma fest gedruckte Produkt-Barcodes der
 * Eigenmarken (294 von 3.910 Einreichungen mit EAN, 7,5 %). Bis dahin fiel
 * für sie der Abgleich ganz weg — auch wenn eine völlig andere EAN gespeichert
 * war, also genau das Muster „falsche EANs".
 */
function istHandelsCode(code) {
  const c = ziffern(code);
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
 *   GTIN zählt als gelesen), Waagen-/Händler-Code gelesen, oder keine
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
 * Eine Abweichung aus der Bildprüfung wird mit einer ZWEITEN, nur auf das
 * Barcode-Foto gerichteten Lesung nachgeprüft (gemessen 02.10.2026 an 273
 * offenen Fällen: 9 Abweichungen in der Bildprüfung, davon 7 echt — eine von
 * einem unscharfen Foto, bei dem jede Lesung eine andere, aber gültige Nummer
 * erfand, eine von einem dunklen Foto mit einer falsch gelesenen Ziffer).
 *
 *  - zweite Lesung = erste       → `abweichend`, `bestaetigt: true`
 *  - zweite Lesung = gespeichert → `gleich` (die erste Lesung war falsch)
 *  - sonst (leer, unsicher, ungültig, eine dritte Nummer) → `unsicher`
 *
 * `unsicher` hält den Fall ebenfalls an (Prüfrunde 02.10.2026). Patricks
 * Vorgabe lautet: weicht die gelesene Nummer ab, bleibt der Fall liegen. Bis
 * dahin wurde ein unbestätigter Fall freigegeben — auch wenn die zweite Lesung
 * die gespeicherte Nummer genauso wenig bestätigte. Ohne Befund geht es nur
 * weiter, wenn eine Lesung die GESPEICHERTE Nummer liefert. Kosten: rund
 * 2 von 270 Fällen zusätzlich für den Menschen.
 *
 * @param {object} befund  eanFotoBefund aus der Bildprüfung
 * @param {string|null} zweitRoh  Ziffern der zweiten Lesung
 */
function eanFotoBestaetigen(befund, zweitRoh) {
  if (!befund || befund.art !== 'abweichend') return befund;
  const zweit = ziffern(zweitRoh);
  const gueltig = !!zweit && pruefzifferOk(zweit);
  if (gueltig && gtin14(zweit) === gtin14(befund.gelesen)) return { ...befund, bestaetigt: true };
  if (gueltig && befund.gespeichert && gtin14(zweit) === gtin14(befund.gespeichert)) {
    return { art: 'gleich', gelesen: zweit, gespeichert: befund.gespeichert, grund: 'zweite_lesung' };
  }
  return { art: 'unsicher', gelesen: befund.gelesen, gespeichert: befund.gespeichert, zweit: gueltig ? zweit : null, grund: gueltig ? 'lesungen_uneinig' : 'zweite_lesung_leer' };
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
  pruefzifferOk, eanOf, nameOf, preisOf, policyOf, einreichZeit, herstellerAnzeige, vollstaendigkeitOf, herkunftOf, preisHinweisOf, PREIS_ARTEN,
  gtin14, eanSchluessel, eanVarianten, istHandelsCode, eanFotoOf, eanFotoBefund, eanFotoBestaetigen,
};
