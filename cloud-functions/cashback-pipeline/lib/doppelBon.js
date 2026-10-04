'use strict';

/**
 * Doppelzahlungen bei Kassenbons (Entscheidung Patrick 04.10.2026: „ja,
 * abstellen" — dieselbe Person darf denselben Bon nie zweimal bezahlt
 * bekommen). Reine Regeln, ohne I/O; die Buchung (syncLedgerForReceipt in
 * index.js) liest und schreibt.
 *
 * Warum in der Buchung und nicht nur davor: Die Inhaltsprüfung der Pipeline
 * (contentHash/transactionHash/itemsHash, index.js Schritt 5b) läuft NACH dem
 * Lesen und VOR der Buchung, ohne Transaktion. Zwei Fotos desselben Bons, die
 * gleichzeitig verarbeitet werden, sehen einander dort nicht — am 04.10. wurde
 * so ein Kaufland-Bon (30,03 €) zweimal bezahlt, die Gutschriften 0,28 s
 * auseinander. Und Resolver, Prüfkonsole und Bon-Runde buchen ohne diese
 * Prüfung. Die Buchungsfunktion ist die EINE Stelle, durch die jeder Bon geht.
 *
 * Vier Regeln (gemessen an 14.369 Bons aus 95 Tagen, Skripte in
 * scratchpad/bon-rueckblick, c_eval.js):
 *   summe      gleiche Person + Markt + Bon-Tag + Endsumme, gegen BEZAHLTE Bons
 *              des Tages. 615 Paare, 612 derselbe Bon; echte Zweitkäufe nur mit
 *              1–2 Artikeln (nie zahlbar, ab 6 Artikeln 0 Fälle).
 *   konten     Markt + Tag + Uhrzeit + Summe über alle Konten (Schlüssel-
 *              dokument, „der erste gewinnt"). 28 Paare, alle derselbe Bon.
 *              NUR mit Uhrzeit — ohne sie gab es 10 echte Zufallspaare.
 *   artikel    gleiche Person + Markt + Tag, Anteil gleicher Artikel (Name +
 *              Preis, ohne Pfand/Rabatt/0-€-Zeilen, jeder Artikel einmal) am
 *              kleineren Bon ≥ 0,6, beide Bons ≥ 5 verschiedene Artikel.
 *              Höchster Wert unter 964 echten Zweitkäufen: 0,43; niedrigster
 *              Doppelbon: 0,71. Fängt andere Lesung der Summe und Teilfotos.
 *   bestellung Bestellnummer einer Online-Bestellung über alle Konten (nicht
 *              gemessen — nur Beobachtung, bis Treffer durchgesehen sind).
 *
 * Zwei weitere Regeln aus der Prüfrunde (Angriffe nachgestellt, Skripte in
 * scratchpad/betrueger-r1):
 *   datum      gleiche Person + Markt + Uhrzeit (HH:MM), ANDERER Bon-Tag bis
 *              8 Tage daneben, dazu gleiche Summe ODER Artikelanteil ≥ Schwelle.
 *              Fängt die Kopie eines bezahlten Bon-Fotos, in der nur das Datum
 *              geändert ist — alle anderen Regeln enthalten den Tag. 7.403
 *              Paare gleiche Person/Markt/anderer Tag ≤ 8: 0 mit gleicher
 *              Uhrzeit und Summe, 0 mit gleicher Uhrzeit und Anteil ≥ 0,6.
 *              Ohne die Uhrzeit nicht tragfähig: 26 echte Gewohnheitskäufe
 *              liegen über Tage hinweg bei ≥ 0,6.
 *   kontenArtikel  andere Person, gleicher Markt + Tag, Artikelanteil ≥
 *              Schwelle (beide ≥ minArtikel) — ohne Uhrzeit und Summe. Fängt
 *              denselben Bon aus einem zweiten Konto, wenn dort die Uhrzeit
 *              verdeckt oder anders gelesen ist (der Kontenschlüssel braucht
 *              sie). 89.463 Paare verschiedener Konten: alle 21 mit Anteil
 *              ≥ 0,6 waren derselbe Bon, zwei verschiedene Bons höchstens 0,5.
 *
 * Prüfrunde 2 (04.10.2026, Angriffe mit dem echten index.js nachgestellt,
 * Gegenprobe an 6.420 bezahlten Bons aus 95 Tagen, scratchpad/r2-fix/mess.js):
 *   datum      zusätzlich OHNE gleiche Uhrzeit, wenn Summe UND Artikelanteil
 *              passen — eine Kopie mit geändertem Datum und geänderter oder
 *              verdeckter Uhrzeit (beschnitten passiert sie den Feinvergleich).
 *              3.834 Paare gleiche Person/Markt, 1–8 Tage: 0 mit gleicher Summe.
 *   seite      gleiche Person + Markt + Tag, beide Belege Online-Bestellungen,
 *              mindestens einer ohne gedruckten Endbetrag (Summe aus den
 *              Artikeln, lib/belegart.js) — die Seiten EINER mehrseitigen
 *              Rechnung haben verschiedene Artikel und Summen und keine
 *              Uhrzeit, keine andere Regel sieht sie. Zwei verschieden
 *              gelesene Bestellnummern heben die Regel auf. 0 Paare gleiche
 *              Person/Markt/Tag ohne Uhrzeit, beide bezahlt.
 *   kontenDatum  gleicher Markt + Endsumme über alle Konten, anderer Tag bis
 *              8 Tage daneben, dazu gleiche Uhrzeit ODER Artikelanteil ≥
 *              Schwelle (Summen-Index `cashback_bon_summen/{markt}_{summe}`).
 *              Fängt die Kopie aus einem zweiten Konto mit geändertem Datum —
 *              alle anderen Regeln über Konten enthalten den Tag. 577.206
 *              Paare verschiedener Konten, 1–8 Tage: 80 mit gleicher Summe,
 *              davon 0 mit gleicher Uhrzeit und 0 mit Anteil ≥ 0,6.
 *
 * Prüfrunde 3 (04.10.2026, Gegenprobe an denselben 6.420 bezahlten Bons,
 * scratchpad/verif_r3_*.js):
 *   datum      reicht über den Summen-Index bis SUMMEN_AUFBEWAHRUNG_TAGE
 *              zurück (gleiche Person, gleiche Endsumme, dazu gleiche Uhrzeit
 *              ODER Artikelanteil ≥ Schwelle). Echter Fall 02.10.: Netto
 *              93,28 €, 10:44, ein Foto mit „22.10." statt „02.10." gelesen,
 *              in der Prüfung freigegeben, das andere schon bezahlt — 20 Tage
 *              Abstand, Artikelnamen verlesen (Anteil 0,07). 7.608 Paare gleiche
 *              Person/Markt, 9–95 Tage: genau 1 mit gleicher Summe und Uhrzeit
 *              (dieser Fall), 0 mit gleicher Summe und Anteil ≥ 0,6.
 *   kontenDatum  jenseits von 8 Tagen nur noch über die Artikel: 1,82 Mio.
 *              Paare verschiedener Konten, 9–95 Tage: 2 echte Zufälle mit
 *              gleicher Summe und Uhrzeit (dm 23,40 €, ALDI SÜD 16,31 €), 0 mit
 *              gleicher Summe und Anteil ≥ 0,6.
 *   datum      ohne gleiche Uhrzeit zählt statt der gedruckten Endsumme auch
 *              die gleiche Summe der gelesenen Artikel (`artikelSumme`) — eine
 *              Kopie, in der nur eine Ziffer der Endsumme geändert ist, bleibt
 *              im Abgleich (Pfand-Toleranz 200 ct). 3.834 Paare gleiche
 *              Person/Markt, 1–8 Tage: 0 mit gleicher Artikelsumme.
 *   Markt      Regeln derselben Person vergleichen auch über Märkte hinweg (ein
 *              geänderter Händlername im Kopf): Artikel ≥ Schwelle, oder Summe
 *              nur zusammen mit gleicher Uhrzeit. 6.575 Paare gleiche Person,
 *              verschiedener Markt, 0–8 Tage: 0 mit Anteil ≥ 0,5, 0 mit
 *              gleicher Summe und Uhrzeit.
 *
 * Jede Regel hängt an einem Schalter in `cashback_config/v1` (false | 'shadow'
 * | true, Code-Default false = altes Verhalten). Ein Treffer im Modus 'shadow'
 * wird am Bon vermerkt, ändert aber nichts.
 */

const crypto = require('crypto');
const { computeTransactionHash } = require('./forensics');
const { onlineMerkmal } = require('./belegart');

// Dieselbe Liste wie in der Messung (c_eval.js) — Pfand, Leergut, eingelöste
// Punkte, Rabatt- und Gutscheinzeilen sagen nichts darüber, ob zwei Bons
// derselbe Einkauf sind, und stehen auf vielen Bons gleich.
const NICHT_ARTIKEL_RE = /pfand|leergut|leerg\b|leerg\.|einweg.?leer|eingel(ö|o)ste punkte|billa bon|rabatt|gutschein|coupon/i;
const MAX_ARTIKEL = 150;
const MAX_SCHLUESSEL_LAENGE = 60;

const SCHLUESSEL_SAMMLUNG = 'cashback_bon_schluessel';
const EINTRAG_VERSION = 1;
// Tages-Index für die Regel kontenArtikel: `cashback_bon_tage/{markt}_{tag}`
// = { eintraege: { [receiptId]: { u: uid, a: [Artikel-Hashes] } } }, nur für
// den Server (kein Rules-Block, das abschließende deny-all greift). Je Eintrag
// typisch ~300 Byte, gemessen höchstens 82 Bons je Markt und Tag — das
// Dokument bleibt weit unter 1 MB. Ab MAX_TAGES_EINTRAEGE wird nicht mehr
// eingetragen (eine zu große Datei ließe sonst die Buchung scheitern).
// Geschrieben wird er nur, solange die Regel läuft ('shadow' oder true) — nur
// dann wird er auch gelesen, und nur so greift die Größenbremse (Prüfrunde 3).
const TAGE_SAMMLUNG = 'cashback_bon_tage';
const MAX_TAGES_EINTRAEGE = 600;
const HASH_LAENGE = 8;
// Regel datum: so viele Tage vor und nach dem Bon-Tag.
const DATUM_FENSTER_TAGE = 8;
// Summen-Index für die Regeln kontenDatum und datum:
// `cashback_bon_summen/{markt}_{summe}` = { eintraege: { [receiptId]: { u: uid,
// t: Tag, z: Uhrzeit|null, a: [Artikel-Hashes] } } }, nur für den Server.
// Gleiche Summe im selben Markt ist selten: über 95 Tage höchstens 3 bezahlte
// Bons je Dokument (6.416 Bons, 6.078 Dokumente, größtes ~750 Byte). Einträge,
// deren Tag mehr als SUMMEN_AUFBEWAHRUNG_TAGE zurückliegt, räumt die nächste
// Gutschrift weg. Die Aufbewahrung bestimmt, wie weit ein geändertes oder
// verlesenes Datum noch erkannt wird (Prüfrunde 3: Fehllesung 02 ↔ 22 = 20
// Tage); 95 Tage = der gemessene Zeitraum — länger nur mit neuer Messung.
const SUMMEN_SAMMLUNG = 'cashback_bon_summen';
const MAX_SUMMEN_EINTRAEGE = 400;
const SUMMEN_AUFBEWAHRUNG_TAGE = 95;

/** Wie in der Messung: klein, nur a–z, 0–9, äöüß. */
function normName(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
}

/**
 * Artikel-Schlüssel eines Bons: „name#preisCent", jeder nur einmal.
 * Nimmt Bon-Artikel in beiden Formen: `name` (OCR) oder `raw` (receipts.items).
 * @param {Array<{name?:string, raw?:string, priceCents?:number}>} items
 * @returns {string[]}
 */
function artikelSchluessel(items) {
  if (!Array.isArray(items)) return [];
  const gesehen = new Set();
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const name = it.name ?? it.raw ?? '';
    const p = it.priceCents;
    if (!Number.isInteger(p) || p <= 0) continue;
    if (NICHT_ARTIKEL_RE.test(String(name))) continue;
    const n = normName(name);
    if (n.length < 2) continue;
    const preis = String(p);
    const schluessel = `${n.slice(0, MAX_SCHLUESSEL_LAENGE - 1 - preis.length)}#${preis}`;
    gesehen.add(schluessel);
    if (gesehen.size >= MAX_ARTIKEL) break;
  }
  return [...gesehen];
}

/** „8:05", „08:05:31" → „08:05"; sonst null. */
function uhrzeitNormal(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

function tagNormal(d) {
  const s = String(d ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * Bestellnummer einer Online-Bestellung, normalisiert. Kunden-, Kassen- oder
 * Telefonnummern liest das Modell laut Prompt nicht hierher; die Form-Prüfung
 * fängt zusätzlich, was sicher keine Bestellnummer ist (zu kurz, kaum Ziffern,
 * ein Datum). Lieber kein Schlüssel als ein falscher — ein falscher Schlüssel
 * sperrt einen fremden Bon.
 * @returns {string|null}
 */
function bestellnummerNormal(roh) {
  if (roh == null) return null;
  const text = String(roh).trim();
  if (!text) return null;
  // Datumsformen: 04.10.2026, 2026-10-04, 4/10/26 …
  if (/^\d{1,4}[.\-/]\d{1,2}[.\-/]\d{1,4}$/.test(text)) return null;
  const n = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (n.length < 6 || n.length > 30) return null;
  if ((n.match(/\d/g) || []).length < 4) return null;
  // Reine 8-stellige Zahl, die ein Datum ist (20261004 / 04102026).
  if (/^\d{8}$/.test(n)) {
    const jmt = /^(20\d\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(n);
    const tmj = /^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])(20\d\d)$/.test(n);
    if (jmt || tmj) return null;
  }
  return n;
}

/** Schlüssel-ID der Bestellnummer (über alle Konten). */
function bestellSchluessel(markt, nummer) {
  const nr = bestellnummerNormal(nummer);
  if (!markt || !nr) return null;
  return 'bo_' + crypto.createHash('sha256').update(`${String(markt).toLowerCase()}|${nr}`).digest('hex').slice(0, 24);
}

/** Schlüssel-ID Markt + Tag + Uhrzeit + Summe (über alle Konten); nur mit Uhrzeit. */
function kontenSchluessel(markt, tag, uhrzeit, summe) {
  if (!uhrzeit) return null;
  const h = computeTransactionHash(markt, tag, uhrzeit, summe);
  return h ? `tx_${h}` : null;
}

/** ID des Tages-Index-Dokuments (Regel kontenArtikel); null ohne Markt/Tag. */
function tagesIndexId(markt, tag) {
  if (!markt || !tag) return null;
  return `${String(markt).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60)}_${tag}`;
}

/** ID des Summen-Index-Dokuments (Regel kontenDatum); null ohne Markt/Summe. */
function summenIndexId(markt, summe) {
  if (!markt || !Number.isInteger(summe) || summe <= 0) return null;
  return `${String(markt).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60)}_${summe}`;
}

/** Tage zwischen zwei YYYY-MM-DD (Betrag); null, wenn eines fehlt. */
function tageAbstand(a, b) {
  const x = Date.parse(`${tagNormal(a)}T12:00:00Z`);
  const y = Date.parse(`${tagNormal(b)}T12:00:00Z`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.round(Math.abs(x - y) / 86400000);
}

/**
 * Artikel-Schlüssel als kurze Hashes für den kontenübergreifenden Tages-Index:
 * dort stehen Einträge FREMDER Konten, darum keine Artikelnamen. 8 Hex-Zeichen
 * (32 Bit) — eine Zufallsgleichheit unter den ~2.500 Artikeln eines Markt-Tags
 * ist praktisch ausgeschlossen und verschöbe den Anteil um höchstens 1 Artikel.
 */
function artikelHashes(artikel) {
  if (!Array.isArray(artikel)) return [];
  const out = new Set();
  for (const k of artikel) {
    if (typeof k !== 'string' || !k) continue;
    out.add(crypto.createHash('sha256').update(k).digest('hex').slice(0, HASH_LAENGE));
    if (out.size >= MAX_ARTIKEL) break;
  }
  return [...out];
}

/** Die Tage im Fenster der Regel datum (ohne den Tag selbst), als YYYY-MM-DD. */
function tageImFenster(tag, n = DATUM_FENSTER_TAGE) {
  const t = tagNormal(tag);
  if (!t) return [];
  const basis = Date.parse(`${t}T12:00:00Z`);
  if (!Number.isFinite(basis)) return [];
  const out = [];
  for (let d = 1; d <= n; d++) {
    out.push(new Date(basis - d * 86400000).toISOString().slice(0, 10));
    out.push(new Date(basis + d * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Summe der gelesenen Artikelpreise — dieselbe Rechnung wie der Abgleich
 * (lib/ocr.js reconcile). Ändert jemand nur die gedruckte Endsumme, bleibt sie
 * gleich (Prüfrunde 3). null ohne Artikel.
 */
function artikelSummeVon(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const s = items.reduce((acc, it) => acc + (it && Number.isFinite(it.priceCents) ? it.priceCents : 0), 0);
  return Number.isInteger(s) && s > 0 ? s : null;
}

/**
 * Identität eines Bons für die Doppel-Prüfung.
 * @returns {{markt:string|null, tag:string|null, summe:number|null, uhrzeit:string|null,
 *            artikel:string[], artikelSumme:number|null, bestellHash:string|null,
 *            kontenId:string|null, tagesIndex:string|null}}
 */
function identitaet({ merchantId, bonDate, totalCents, bonTime, items, bestellnummer, online, summeAusArtikeln } = {}) {
  const markt = merchantId && merchantId !== 'unknown' ? String(merchantId).toLowerCase() : null;
  const tag = tagNormal(bonDate);
  const summe = Number.isInteger(totalCents) && totalCents > 0 ? totalCents : null;
  const uhrzeit = uhrzeitNormal(bonTime);
  return {
    markt,
    tag,
    summe,
    uhrzeit,
    artikel: artikelSchluessel(items),
    artikelSumme: artikelSummeVon(items),
    bestellHash: bestellSchluessel(markt, bestellnummer),
    kontenId: markt && tag && summe ? kontenSchluessel(markt, tag, uhrzeit, summe) : null,
    tagesIndex: tagesIndexId(markt, tag),
    summenIndex: tag ? summenIndexId(markt, summe) : null,
    // Regel seite: Online-Bestellung (lib/belegart.js onlineMerkmal) und ob der
    // Endbetrag nur aus den Artikeln stammt (Seite ohne gedruckte Summe).
    online: online === true,
    ohneSumme: summeAusArtikeln === true,
  };
}

/**
 * Identität aus einem gespeicherten `receipts`-Dokument (Resolver, Altbestand
 * ohne Tageseintrag).
 */
function identitaetAusBon(bon) {
  const b = bon || {};
  const parsed = (b.ocr && b.ocr.parsed) || {};
  const items = Array.isArray(parsed.items) && parsed.items.length
    ? parsed.items
    : Array.isArray(b.items) ? b.items : [];
  return identitaet({
    merchantId: b.merchant && b.merchant.id,
    bonDate: b.bonDate ?? parsed.bonDate,
    totalCents: Number.isInteger(b.bonTotalCents) ? b.bonTotalCents : parsed.totalCents,
    bonTime: b.bonTime ?? parsed.bonTime,
    items,
    bestellnummer: parsed.bestellnummer,
    online: Boolean(onlineMerkmal(parsed)),
    summeAusArtikeln: parsed.summeAusArtikeln === true,
  });
}

/** Was am Tageszähler je bezahltem Bon steht (`cashback_days/{Tag}.eintraege`). */
function eintragAus(id) {
  return {
    markt: id.markt ?? null,
    summe: id.summe ?? null,
    uhrzeit: id.uhrzeit ?? null,
    artikel: Array.isArray(id.artikel) ? id.artikel.slice(0, MAX_ARTIKEL) : [],
    // Regel datum ohne Uhrzeit (Prüfrunde 3); fehlt in Einträgen davor.
    ...(Number.isInteger(id.artikelSumme) ? { artikelSumme: id.artikelSumme } : {}),
    bestellHash: id.bestellHash ?? null,
    // Nur gesetzt, wenn wahr (Regel seite) — spart Platz am Tageszähler.
    ...(id.online ? { online: true } : {}),
    ...(id.ohneSumme ? { ohneSumme: true } : {}),
    v: EINTRAG_VERSION,
  };
}

/**
 * Gleiche Person (das stellt der Aufrufer sicher): wie ähnlich sind zwei Bons?
 * Seit Prüfrunde 3 auch über Märkte hinweg — ob ein anderer Markt reicht,
 * entscheidet doppelUrteil (`gleicherMarkt`).
 * @returns {{summe:boolean, artikelSumme:boolean, anteil:number|null, gleicherMarkt:boolean}}
 */
function vergleiche(neu, alt, { minArtikel = 5 } = {}) {
  const out = { summe: false, artikelSumme: false, anteil: null, gleicherMarkt: false };
  if (!neu || !alt || !neu.markt || !alt.markt) return out;
  out.gleicherMarkt = neu.markt === alt.markt;
  out.summe = Number.isInteger(neu.summe) && neu.summe > 0 && neu.summe === alt.summe;
  out.artikelSumme = Number.isInteger(neu.artikelSumme) && neu.artikelSumme > 0 && neu.artikelSumme === alt.artikelSumme;
  const a = Array.isArray(neu.artikel) ? neu.artikel : [];
  const b = new Set(Array.isArray(alt.artikel) ? alt.artikel : []);
  if (a.length >= minArtikel && b.size >= minArtikel) {
    let gemeinsam = 0;
    for (const k of a) if (b.has(k)) gemeinsam++;
    out.anteil = gemeinsam / Math.min(a.length, b.size);
  }
  return out;
}

/** false | 'shadow' | true — alles andere gilt als aus. */
function schalterModus(v) {
  if (v === true) return true;
  if (v === 'shadow') return 'shadow';
  return false;
}

/** Schalter und Schwellen aus `cashback_config/v1`. */
function doppelModi(config = {}) {
  const schwelle = Number(config.doppelArtikelSchwelle);
  const minArtikel = Number(config.doppelArtikelMin);
  return {
    summe: schalterModus(config.doppelSumme),
    konten: schalterModus(config.doppelKonten),
    artikel: schalterModus(config.doppelArtikel),
    bestellung: schalterModus(config.doppelBestellnummer),
    datum: schalterModus(config.doppelDatum),
    kontenArtikel: schalterModus(config.doppelKontenArtikel),
    seite: schalterModus(config.doppelOnlineSeite),
    kontenDatum: schalterModus(config.doppelKontenDatum),
    // Untergrenze 0,5: darunter lag in der Messung kein Wert mehr gemessen, und
    // ein Tippfehler (0.06) sperrte sonst echte Zweitkäufe.
    schwelle: Number.isFinite(schwelle) && schwelle >= 0.5 && schwelle <= 1 ? schwelle : 0.6,
    minArtikel: Number.isInteger(minArtikel) && minArtikel >= 3 ? minArtikel : 5,
  };
}

/** Schalterstand für den Vermerk am Bon (`receipts.doppelPruefung.modi`). */
function modiVermerk(modi = {}) {
  const { summe, konten, artikel, bestellung, datum, kontenArtikel, seite, kontenDatum } = modi;
  return {
    summe: summe ?? false,
    konten: konten ?? false,
    artikel: artikel ?? false,
    bestellung: bestellung ?? false,
    datum: datum ?? false,
    kontenArtikel: kontenArtikel ?? false,
    seite: seite ?? false,
    kontenDatum: kontenDatum ?? false,
  };
}

const REGEL_REIHENFOLGE = ['summe', 'konten', 'bestellung', 'seite', 'artikel', 'datum', 'kontenArtikel', 'kontenDatum'];

/**
 * Regel kontenArtikel, erster Schritt: welche Einträge des Tages-Index
 * (FREMDE Konten) erreichen die Schwelle? Ob ihr Bon noch bezahlt ist, prüft
 * der Aufrufer danach — nur für diese wenigen Einträge.
 * @param {object} o
 * @param {string} o.bonId
 * @param {string} o.uid
 * @param {object} o.neu         identitaet()
 * @param {object} o.eintraege   `cashback_bon_tage/{…}.eintraege`
 * @param {object} o.modi        doppelModi()
 * @returns {Array<{id:string, uid:string, anteil:number}>}
 */
function kontenArtikelKandidaten({ bonId, uid, neu, eintraege, modi = {} }) {
  const minArtikel = modi.minArtikel ?? 5;
  const schwelle = modi.schwelle ?? 0.6;
  const a = artikelHashes(neu && neu.artikel);
  if (a.length < minArtikel || !eintraege || typeof eintraege !== 'object') return [];
  const out = [];
  for (const [id, e] of Object.entries(eintraege)) {
    if (!e || id === bonId || !e.u || e.u === uid) continue;
    const b = new Set(Array.isArray(e.a) ? e.a : []);
    if (b.size < minArtikel) continue;
    let gemeinsam = 0;
    for (const k of a) if (b.has(k)) gemeinsam++;
    const anteil = gemeinsam / Math.min(a.length, b.size);
    if (anteil >= schwelle) out.push({ id, uid: e.u, anteil: Math.round(anteil * 1000) / 1000 });
  }
  return out.sort((x, y) => y.anteil - x.anteil);
}

/** Eintrag eines Bons im Tages-Index (Regel kontenArtikel). */
function tagesEintragAus(uid, id) {
  return { u: uid, a: artikelHashes(id && id.artikel) };
}

/** Eintrag eines Bons im Summen-Index (Regel kontenDatum). */
function summenEintragAus(uid, id) {
  return { u: uid, t: (id && id.tag) || null, z: (id && id.uhrzeit) || null, a: artikelHashes(id && id.artikel) };
}

/**
 * Summen-Index, erster Schritt: welche Einträge (alle Konten, gleiche Summe
 * und gleicher Markt stecken schon im Dokument) liegen an einem ANDEREN Tag
 * und passen? Ob ihr Bon noch bezahlt ist, prüft der Aufrufer.
 *
 *   gleiche Person (`uid`, Regel datum)   bis SUMMEN_AUFBEWAHRUNG_TAGE:
 *                                         gleiche Uhrzeit ODER Artikel ≥ Schwelle
 *   anderes Konto (Regel kontenDatum)     bis DATUM_FENSTER_TAGE: ebenso;
 *                                         darüber nur Artikel ≥ Schwelle
 *
 * Warum so (Prüfrunde 3, 6.420 bezahlte Bons, 9–95 Tage Abstand): dieselbe
 * Person mit gleicher Summe und Uhrzeit — genau 1 Paar, die echte
 * Doppelzahlung vom 02.10.; verschiedene Konten mit gleicher Summe und Uhrzeit
 * — 2 echte Zufälle, mit Artikeln ≥ 0,6 — 0.
 * `gleichePerson`/`fremde` = false lassen die jeweilige Seite weg (Regel aus).
 * @returns {Array<{id:string, uid:string, tag:string, abstand:number, anteil:number|null, gleicheZeit:boolean}>}
 */
function kontenDatumKandidaten({ bonId, uid = null, neu, eintraege, modi = {}, gleichePerson = true, fremde = true }) {
  const minArtikel = modi.minArtikel ?? 5;
  const schwelle = modi.schwelle ?? 0.6;
  if (!neu || !neu.tag || !eintraege || typeof eintraege !== 'object') return [];
  const a = artikelHashes(neu.artikel);
  const out = [];
  for (const [id, e] of Object.entries(eintraege)) {
    if (!e || id === bonId || !e.u || !e.t || e.t === neu.tag) continue;
    const abstand = tageAbstand(neu.tag, e.t);
    if (abstand == null || abstand > SUMMEN_AUFBEWAHRUNG_TAGE) continue;
    const selbe = Boolean(uid) && e.u === uid;
    if (selbe ? !gleichePerson : !fremde) continue;
    const gleicheZeit = Boolean(neu.uhrzeit) && neu.uhrzeit === e.z;
    let anteil = null;
    const b = new Set(Array.isArray(e.a) ? e.a : []);
    if (a.length >= minArtikel && b.size >= minArtikel) {
      let gemeinsam = 0;
      for (const k of a) if (b.has(k)) gemeinsam++;
      anteil = Math.round((gemeinsam / Math.min(a.length, b.size)) * 1000) / 1000;
    }
    const artikelPasst = anteil != null && anteil >= schwelle;
    const trifft = selbe || abstand <= DATUM_FENSTER_TAGE ? gleicheZeit || artikelPasst : artikelPasst;
    if (trifft) out.push({ id, uid: e.u, tag: e.t, abstand, anteil, gleicheZeit });
  }
  return out.sort((x, y) => Number(y.gleicheZeit) - Number(x.gleicheZeit) || (y.anteil ?? 0) - (x.anteil ?? 0));
}

/**
 * Einträge des Summen-Index, die zu alt sind, um noch zu zählen (Tag mehr als
 * SUMMEN_AUFBEWAHRUNG_TAGE vor `heute`). Die IDs räumt die Gutschrift weg.
 */
function veralteteSummenEintraege(eintraege, heute, tage = SUMMEN_AUFBEWAHRUNG_TAGE) {
  if (!eintraege || typeof eintraege !== 'object') return [];
  const h = tagNormal(heute);
  if (!h) return [];
  return Object.entries(eintraege)
    .filter(([, e]) => !e || !e.t || (e.t < h && tageAbstand(h, e.t) > tage))
    .map(([id]) => id);
}

/**
 * Das Urteil über einen noch nicht gebuchten Bon.
 *
 * @param {object} o
 * @param {string} o.bonId
 * @param {string} o.uid
 * @param {object} o.neu         identitaet() des Bons
 * @param {Array<{id:string, eintrag:object, tag?:string}>} o.andere  BEZAHLTE
 *        Bons derselben Person (eigener Bon ausgeschlossen), jeder Markt.
 *        Ohne `tag` bzw. mit dem Tag des Bons: Regeln summe/artikel/seite.
 *        Mit einem anderen Tag: Regel datum.
 * @param {Array<{id:string, regel:'konten'|'bestellung', besitzer:{receiptId:string, uid:string}|null, lebendig:boolean}>} o.schluessel
 * @param {Array<{id:string, uid:string, anteil:number, lebendig:boolean}>} o.kontenArtikel
 * @param {Array<{id:string, uid:string, tag:string, abstand?:number, anteil:number|null, gleicheZeit:boolean, lebendig:boolean}>} o.kontenDatum
 *        Kandidaten aus dem Summen-Index (kontenDatumKandidaten): eigene →
 *        Regel datum, fremde → Regel kontenDatum.
 * @param {object} o.modi        doppelModi()
 * @returns {{treffer: Array<{regel:string, gegen:string, sameUser:boolean, anteil?:number, modus:'wirksam'|'beobachtung'}>, wirksam: object|null}}
 */
function doppelUrteil({ bonId, uid, neu, andere = [], schluessel = [], kontenArtikel = [], kontenDatum = [], modi = {} }) {
  const treffer = [];
  const modusVon = (regel) => (modi[regel] === true ? 'wirksam' : modi[regel] === 'shadow' ? 'beobachtung' : null);
  const schwelle = modi.schwelle ?? 0.6;
  const rund = (v) => Math.round(v * 1000) / 1000;
  if (neu && neu.markt) {
    for (const { id, eintrag, tag } of andere) {
      if (!eintrag || id === bonId || !eintrag.markt) continue;
      const v = vergleiche(neu, eintrag, modi);
      const artikelPasst = v.anteil != null && v.anteil >= schwelle;
      const gleicheZeit = Boolean(neu.uhrzeit) && neu.uhrzeit === eintrag.uhrzeit;
      // Anderer Markt (Prüfrunde 3: Händlername im Kopf geändert): am Treffer
      // vermerkt, damit die Beobachtung ihn getrennt auswerten kann.
      const marktFeld = v.gleicherMarkt ? {} : { andererMarkt: true };
      const andererTag = Boolean(tag) && tag !== neu.tag;
      if (andererTag) {
        // Regel datum. Mit derselben Uhrzeit genügt Summe ODER Artikel; ohne
        // sie (verdeckt, geändert) braucht es Summe UND Artikel — Gewohnheits-
        // käufe über Tage hinweg erreichen den Artikelanteil, aber nie
        // dieselbe Summe (0 von 3.834 Paaren). Als Summe zählt auch die
        // gleiche Artikelsumme (nur die gedruckte Endsumme geändert; 0 von
        // 3.834 Paaren).
        if (!modusVon('datum')) continue;
        const summePasst = v.summe || v.artikelSumme;
        if (gleicheZeit ? (v.summe || artikelPasst) : (summePasst && artikelPasst)) {
          treffer.push({
            regel: 'datum', gegen: id, sameUser: true, tag,
            ...(v.anteil != null ? { anteil: rund(v.anteil) } : {}),
            ...(gleicheZeit ? {} : { ohneUhrzeit: true }),
            ...(!gleicheZeit && !v.summe ? { nurArtikelSumme: true } : {}),
            ...marktFeld,
            modus: modusVon('datum'),
          });
        }
        continue;
      }
      // Regel summe: im selben Markt allein; in einem anderen Markt nur mit
      // gleicher Uhrzeit (0 von 6.575 Paaren gleiche Person, anderer Markt).
      if (v.summe && (v.gleicherMarkt || gleicheZeit) && modusVon('summe')) {
        treffer.push({ regel: 'summe', gegen: id, sameUser: true, ...marktFeld, modus: modusVon('summe') });
      }
      if (artikelPasst && modusVon('artikel')) {
        treffer.push({ regel: 'artikel', gegen: id, sameUser: true, anteil: rund(v.anteil), ...marktFeld, modus: modusVon('artikel') });
      }
      // Regel seite: zwei Seiten derselben Online-Rechnung. Nur, wenn beide
      // Online-Bestellungen desselben Markts sind und mindestens eine ohne
      // gedruckten Endbetrag — zwei vollständige Rechnungen sind zwei
      // Bestellungen. Zwei VERSCHIEDEN gelesene Bestellnummern heben sie auf.
      if (modusVon('seite') && v.gleicherMarkt && neu.online && eintrag.online && (neu.ohneSumme || eintrag.ohneSumme)) {
        const andereNummer = Boolean(neu.bestellHash) && Boolean(eintrag.bestellHash) && neu.bestellHash !== eintrag.bestellHash;
        if (!andereNummer) treffer.push({ regel: 'seite', gegen: id, sameUser: true, modus: modusVon('seite') });
      }
    }
  }
  for (const s of schluessel) {
    if (!s || !s.besitzer || !s.lebendig) continue;
    if (s.besitzer.receiptId === bonId) continue;
    const modus = modusVon(s.regel);
    if (!modus) continue;
    treffer.push({ regel: s.regel, gegen: s.besitzer.receiptId, sameUser: s.besitzer.uid === uid, modus });
  }
  for (const k of kontenArtikel) {
    if (!k || !k.lebendig || k.id === bonId || k.uid === uid) continue;
    const modus = modusVon('kontenArtikel');
    if (!modus) continue;
    treffer.push({ regel: 'kontenArtikel', gegen: k.id, sameUser: false, anteil: k.anteil, modus });
  }
  // Summen-Index: Einträge derselben Person gehören zur Regel datum (Schalter
  // doppelDatum, reicht so über das Fenster des Tageszählers hinaus —
  // Prüfrunde 3), Einträge anderer Konten zur Regel kontenDatum. Einen Bon,
  // den der Tageszähler schon unter derselben Regel gemeldet hat, nicht doppelt.
  for (const k of kontenDatum) {
    if (!k || !k.lebendig || k.id === bonId) continue;
    const selbe = Boolean(uid) && k.uid === uid;
    const regel = selbe ? 'datum' : 'kontenDatum';
    const modus = modusVon(regel);
    if (!modus) continue;
    if (treffer.some((t) => t.regel === regel && t.gegen === k.id)) continue;
    treffer.push({
      regel, gegen: k.id, sameUser: selbe, tag: k.tag,
      ...(k.anteil != null ? { anteil: k.anteil } : {}),
      ...(k.gleicheZeit ? {} : { ohneUhrzeit: true }),
      ...(Number.isInteger(k.abstand) && k.abstand > DATUM_FENSTER_TAGE ? { abstand: k.abstand } : {}),
      modus,
    });
  }
  treffer.sort((a, b) => REGEL_REIHENFOLGE.indexOf(a.regel) - REGEL_REIHENFOLGE.indexOf(b.regel));
  const wirksam = treffer.find((t) => t.modus === 'wirksam') || null;
  return { treffer, wirksam };
}

/** Grund-Code am Bon — dieselben Codes wie die Inhaltsprüfung, kein neuer. */
function grundFuer(t) {
  return t && t.sameUser === false ? 'duplicate_content_cross_user' : 'duplicate_content_self';
}

module.exports = {
  SCHLUESSEL_SAMMLUNG,
  TAGE_SAMMLUNG,
  SUMMEN_SAMMLUNG,
  MAX_TAGES_EINTRAEGE,
  MAX_SUMMEN_EINTRAEGE,
  SUMMEN_AUFBEWAHRUNG_TAGE,
  DATUM_FENSTER_TAGE,
  NICHT_ARTIKEL_RE,
  normName,
  artikelSchluessel,
  artikelSummeVon,
  artikelHashes,
  uhrzeitNormal,
  bestellnummerNormal,
  bestellSchluessel,
  kontenSchluessel,
  tagesIndexId,
  summenIndexId,
  tageAbstand,
  tageImFenster,
  identitaet,
  identitaetAusBon,
  eintragAus,
  tagesEintragAus,
  summenEintragAus,
  vergleiche,
  schalterModus,
  doppelModi,
  modiVermerk,
  kontenArtikelKandidaten,
  kontenDatumKandidaten,
  veralteteSummenEintraege,
  doppelUrteil,
  grundFuer,
};
