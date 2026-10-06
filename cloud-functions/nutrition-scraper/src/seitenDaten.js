/**
 * Seitendaten einer Produktseite lesen — OHNE KI, ohne Netz, ohne Firestore.
 *
 * Zwei Fragen beantwortet dieses Modul, bevor Geld ausgegeben oder etwas in
 * unsere Datenbank geschrieben wird:
 *
 *   1. Gehört die Seite überhaupt zu dieser EAN? (vor JEDEM KI-Aufruf)
 *      Bis 04.10.2026 prüfte scrapeEan das nur bei unbekannten Domains. In
 *      nutritionscrape stehen deshalb Daten fremder Produkte, z. B. EAN
 *      4335619254077 mit der OpenFoodFacts-Seite von 7610807015843 oder
 *      4069365317310 mit einer Zahnbürste (gtin13 9120082630382).
 *      Für ALLE Daten der Seite (Zutaten, Nährwerte, Preis, Hersteller) gilt
 *      derselbe Beleg wie für den Namen (Prüfrunde 04.10.2026): Eine EAN nur
 *      in Skript-Daten oder Meta-Tags reicht nicht — atundo führt in
 *      <meta name="keywords"> eine zweite, fremde EAN, eine Suche danach
 *      landete mit den Zutaten und dem Preis der Erdnuss-Flips unter der
 *      falschen Nummer. Ebenso keine Daten von Seiten mit mehreren Produkten.
 *
 *   2. Wie heißt das Produkt, und welches Bild zeigt es? Name und Bild kommen
 *      zuerst aus den maschinenlesbaren Seitendaten (JSON-LD Product, sonst
 *      og:title/og:image, sonst <title>). Die KI bereinigt nur. Übernommen
 *      wird beides NUR mit Beleg, dass die Seite zu dieser EAN gehört:
 *        • 'jsonld_gtin' — ein JSON-LD-Product trägt die EAN als Kennung
 *          (gtin/gtin8/12/13/14, ean, sku, mpn, productID, identifier — in
 *          8/12/13/14-stelliger Schreibweise);
 *        • 'seitentext'  — genau ein Produkt auf der Seite UND die EAN steht im
 *          sichtbaren Text, nicht nur in einer Adresse, einem Suchfeld oder
 *          hinter „Ergebnisse für“.
 *      Ohne Beleg kein Name — sonst landet ein falsches Produkt dauerhaft in
 *      external_products.
 *      Kurze Codes (EAN-8/RCN-8, Prüfrunde 3) belegen strenger: Achtstellige
 *      Nummern sind oft Artikel-, Pharmazentral- (PZN) oder Shop-Nummern
 *      (gespeichert: 20277994 als product_id bei nafco, 19549220 als PZN bei
 *      shop-apotheke). Für sie zählen im JSON-LD nur echte GTIN-Felder (nicht
 *      sku/mpn/productID ohne gtin-/ean-Präfix), und im Text nur eine Nummer
 *      mit der Bezeichnung EAN/GTIN/Barcode direkt davor — nicht nach PZN,
 *      Art.-Nr., SKU, Bestellnummer oder ID.
 *
 * Gesucht wird weiterhin ausschließlich per EAN (CLAUDE.md, Nutrition-Scraper).
 */

'use strict';

// ─── EAN / GTIN ───────────────────────────────────────────────────

function nurZiffern(wert) {
  if (wert == null) return '';
  return String(wert).replace(/\D/g, '');
}

/** 8–14 Ziffern → 14-stellige GTIN-Schreibweise, sonst null. */
function gtin14(wert) {
  if (wert == null) return null;
  const s = typeof wert === 'number' ? String(wert) : String(wert).trim();
  if (!/^\d{8,14}$/.test(s)) return null;
  return s.padStart(14, '0');
}

/** Alle Schreibweisen derselben GTIN mit 8, 12, 13 oder 14 Stellen
 *  (führende Nullen). 4006040000000 → [00040060…, 4006040000000]. */
function eanVarianten(ean) {
  const g = gtin14(ean);
  if (!g) return [];
  const out = [];
  for (const laenge of [14, 13, 12, 8]) {
    const vorne = g.slice(0, 14 - laenge);
    if (/^0*$/.test(vorne)) out.push(g.slice(14 - laenge));
  }
  return out;
}

/** Hat die EAN eine 8-stellige Schreibweise (EAN-8, RCN-8)? Dann gilt die
 *  strengere Belegregel (Kopfkommentar). */
function istKurzerCode(ean) {
  return eanVarianten(ean).some((v) => v.length === 8);
}

function gleicheGtin(a, b) {
  const ga = gtin14(a);
  return !!ga && ga === gtin14(b);
}

/** GS1-Prüfziffer (Modulo 10) für 8/12/13/14 Stellen. */
function pruefzifferGueltig(code) {
  const s = String(code ?? '');
  if (!/^\d+$/.test(s) || ![8, 12, 13, 14].includes(s.length)) return false;
  const ziffern = s.split('').map(Number);
  const pruef = ziffern.pop();
  let summe = 0;
  for (let i = ziffern.length - 1, gewicht = 3; i >= 0; i--, gewicht = gewicht === 3 ? 1 : 3) {
    summe += ziffern[i] * gewicht;
  }
  return (10 - (summe % 10)) % 10 === pruef;
}

// ─── Text-Helfer ──────────────────────────────────────────────────

const BENANNTE_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  szlig: 'ß', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü',
  eacute: 'é', egrave: 'è', ndash: '–', mdash: '—', hellip: '…', reg: '®',
  trade: '™', copy: '©', euro: '€', middot: '·', laquo: '«', raquo: '»',
};

function dekodiereEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => sicheresZeichen(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => sicheresZeichen(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (n in BENANNTE_ENTITIES ? BENANNTE_ENTITIES[n] : m));
}

function sicheresZeichen(code) {
  try { return String.fromCodePoint(code); } catch { return ' '; }
}

/** Sichtbarer Text: ohne Skripte, Stile, Tags und Adressen. Bei Markdown
 *  (Apify) ohne Link-Ziele. Ausgeschriebene Adressen fallen in beiden Fällen
 *  weg — Fehlerseiten zeigen gern die angefragte Adresse samt EAN an
 *  (edeka.de: „Access Denied … /sortiment/4311501170113/“). */
function sichtbarerText(inhalt, { istMarkdown = false } = {}) {
  if (!inhalt) return '';
  let s = String(inhalt);
  if (istMarkdown) {
    s = s.replace(/\]\([^)]*\)/g, '] ');
  } else {
    s = s
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
  }
  return dekodiereEntities(s)
    .replace(/(https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── JSON-LD ──────────────────────────────────────────────────────

const LD_RE = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;

/** Alle JSON-LD-Blöcke einer Seite, geparst. Kaputte Blöcke werden einmal
 *  repariert (Steuerzeichen in Zeichenketten — z. B. morgenmarkt.de) und
 *  sonst übersprungen. */
function leseJsonLd(html) {
  if (!html) return [];
  const out = [];
  let m;
  LD_RE.lastIndex = 0;
  while ((m = LD_RE.exec(html))) {
    let roh = m[1].trim()
      .replace(/^<!--/, '').replace(/-->$/, '')
      .replace(/^\/\*\s*<!\[CDATA\[\s*\*\//, '').replace(/\/\*\s*\]\]>\s*\*\/$/, '')
      .trim();
    if (!roh) continue;
    let wert = null;
    try {
      wert = JSON.parse(roh);
    } catch {
      try {
        wert = JSON.parse(roh.replace(/[\u0000-\u001f]+/g, ' '));
      } catch {
        wert = null;
      }
    }
    if (wert != null) out.push(wert);
  }
  return out;
}

function typen(knoten) {
  const t = knoten?.['@type'];
  const liste = Array.isArray(t) ? t : t ? [t] : [];
  return liste.map((x) => String(x).split(/[/:#]/).pop());
}

// Echte GTIN-Felder: nur sie dürfen einen WIDERSPRUCH begründen.
const GTIN_FELDER = ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'ean'];
// Händlerkennungen: Globus und morgenmarkt führen die EAN nur als sku/mpn.
// Stimmen sie mit der EAN überein, ist das ein ebenso starker Beleg; weichen
// sie ab, sagt das nichts (shop-apotheke: sku 19782442).
const WEITERE_KENNUNG_FELDER = ['sku', 'mpn', 'productID'];

function ziffernKennungen(werte) {
  const out = [];
  const nimm = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach(nimm); return; }
    if (typeof v === 'object') { nimm(v.value); return; }
    // productID kommt als „ean:4006…“ oder „gtin13:4006…“ vor
    const s = String(v).trim().replace(/^[a-z0-9]+:/i, '');
    if (/^\d{8,14}$/.test(s)) out.push(s);
  };
  werte.forEach(nimm);
  return out;
}

function gtinsVon(p) {
  const ids = Array.isArray(p.identifier) ? p.identifier : p.identifier ? [p.identifier] : [];
  const gtinIds = ids.filter((i) => i && typeof i === 'object' && /gtin|ean/i.test(String(i.propertyID || '')));
  return ziffernKennungen([...GTIN_FELDER.map((f) => p[f]), gtinIds]);
}

function weitereKennungenVon(p) {
  return ziffernKennungen(WEITERE_KENNUNG_FELDER.map((f) => p[f]));
}

// productID mit ausdrücklichem GTIN-/EAN-Präfix („gtin8:40123456“) ist eine
// GTIN, auch für kurze Codes; ohne Präfix eine Händlernummer.
const GTIN_PRAEFIX = /^\s*(gtin\d*|ean\d*|upc)\s*:/i;

function praefixGtinsVon(p) {
  const liste = Array.isArray(p.productID) ? p.productID : p.productID != null ? [p.productID] : [];
  return ziffernKennungen(liste.filter((v) => typeof v === 'string' && GTIN_PRAEFIX.test(v)));
}

function markeVon(p) {
  const b = p.brand;
  const name = typeof b === 'string' ? b : b && typeof b === 'object' ? b.name : null;
  return typeof name === 'string' && name.trim() ? dekodiereEntities(name).trim() : null;
}

function bilderVon(p) {
  const out = [];
  const nimm = (v) => {
    if (!v) return;
    if (Array.isArray(v)) { v.forEach(nimm); return; }
    if (typeof v === 'string') { out.push(v); return; }
    if (typeof v === 'object') nimm(v.url || v.contentUrl);
  };
  nimm(p.image);
  return out;
}

function preisZahl(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s/g, '');
  if (!s) return null;
  // „3,79“ / „3.79“ / „1.234,50“
  const norm = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

function angeboteVon(p) {
  const out = [];
  const nimm = (o) => {
    if (!o) return;
    if (Array.isArray(o)) { o.forEach(nimm); return; }
    if (typeof o !== 'object') return;
    const preis = preisZahl(o.price ?? o.lowPrice);
    const waehrung = typeof o.priceCurrency === 'string' ? o.priceCurrency.trim().toUpperCase() : null;
    if (preis != null) out.push({ preis, waehrung });
    if (Array.isArray(o.priceSpecification)) nimm(o.priceSpecification);
    if (o.offers) nimm(o.offers);
  };
  nimm(p.offers);
  return out;
}

const VERWANDTE_PRODUKTE = new Set(['isRelatedTo', 'isSimilarTo', 'isAccessoryOrSparePartFor', 'isConsumableFor']);

/** Product-Knoten aus allen JSON-LD-Blöcken (auch in @graph, mainEntity,
 *  itemListElement …). Doppelte Beschreibungen desselben Produkts — Globus
 *  liefert zwei Blöcke mit identischem Namen und sku — zählen einmal. */
function sammleProdukte(wurzeln) {
  const roh = [];
  const besucht = new Set();
  const laufe = (k) => {
    if (!k || typeof k !== 'object' || besucht.has(k)) return;
    besucht.add(k);
    if (Array.isArray(k)) { k.forEach(laufe); return; }
    if (typen(k).some((t) => t === 'Product' || t === 'IndividualProduct' || t === 'ProductModel')) {
      roh.push(k);
    }
    for (const [schluessel, wert] of Object.entries(k)) {
      // Angebote sind keine Produkte; „ähnliche/passende Produkte“ gehören
      // nicht zur Seite — steht unsere EAN nur dort, ist die Seite die eines
      // anderen Produkts.
      if (schluessel === 'offers' || VERWANDTE_PRODUKTE.has(schluessel)) continue;
      if (wert && typeof wert === 'object') laufe(wert);
    }
  };
  wurzeln.forEach(laufe);

  const nachSchluessel = new Map();
  for (const p of roh) {
    const name = typeof p.name === 'string' ? dekodiereEntities(p.name).replace(/\s+/g, ' ').trim() : null;
    const gtins = [...new Set(gtinsVon(p))];
    const weitere = [...new Set(weitereKennungenVon(p))].filter((k) => !gtins.includes(k));
    const schluessel = `${(name || '').toLowerCase()}|${[...gtins, ...weitere].sort().join(',')}`;
    const vorhanden = nachSchluessel.get(schluessel);
    if (vorhanden) {
      vorhanden.bilder.push(...bilderVon(p).filter((b) => !vorhanden.bilder.includes(b)));
      vorhanden.angebote.push(...angeboteVon(p));
      if (!vorhanden.marke) vorhanden.marke = markeVon(p);
      continue;
    }
    nachSchluessel.set(schluessel, {
      name,
      marke: markeVon(p),
      gtins,
      kennungen: [...gtins, ...weitere],
      // Beleg für kurze Codes: nur GTIN-Felder (Kopfkommentar).
      gtinKennungen: [...new Set([...gtins, ...praefixGtinsVon(p)])],
      bilder: bilderVon(p),
      angebote: angeboteVon(p),
    });
  }
  return [...nachSchluessel.values()];
}

// ─── Meta-Tags ────────────────────────────────────────────────────

function attributeVon(tag) {
  const out = {};
  const re = /([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}

function leseMetaDaten(html) {
  const meta = { ogTitle: null, ogImages: [], ogType: null, titel: null, waehrung: null };
  if (!html) return meta;
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const a = attributeVon(tag);
    const schluessel = (a.property || a.name || '').toLowerCase();
    const inhalt = a.content != null ? dekodiereEntities(a.content).trim() : '';
    if (!inhalt) continue;
    if (schluessel === 'og:title' && !meta.ogTitle) meta.ogTitle = inhalt;
    else if (schluessel === 'og:image' || schluessel === 'og:image:secure_url') {
      if (!meta.ogImages.includes(inhalt)) meta.ogImages.push(inhalt);
    } else if (schluessel === 'og:type' && !meta.ogType) meta.ogType = inhalt.toLowerCase();
    else if ((schluessel === 'product:price:currency' || schluessel === 'og:price:currency') && !meta.waehrung) {
      meta.waehrung = inhalt.toUpperCase();
    }
  }
  // Mehrere og:type kommen vor (morgenmarkt: website UND product) — ein
  // 'product' irgendwo gewinnt.
  if (tags.some((t) => /og:type/i.test(t) && /content\s*=\s*["']?(og:)?product/i.test(t))) meta.ogType = 'product';
  const t = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (t) meta.titel = dekodiereEntities(t[1]).replace(/\s+/g, ' ').trim() || null;
  return meta;
}

/** Microdata-Produkte der Seite, ohne „verwandte Produkte“-Leisten
 *  (atundo: mainEntity + isRelatedTo im Slider). */
function zaehleMicrodataProdukte(html) {
  if (!html) return 0;
  const tags = html.match(/<[^>]*itemtype\s*=\s*["']https?:\/\/schema\.org\/Product["'][^>]*>/gi) || [];
  return tags.filter((t) => !/itemprop\s*=\s*["'](isRelatedTo|isSimilarTo|isAccessoryOrSparePartFor|isConsumableFor)["']/i.test(t)).length;
}

// ─── Fundstellen der EAN ──────────────────────────────────────────

// Text vor einer Fundstelle, der auf Suche statt Produktseite hindeutet
// („Ergebnisse für "4316268640695"“ bei codecheck, searchText = "…" im Skript).
const SUCH_KONTEXT_DAVOR = /(such|search|ergebnis|result|treffer|query|keyword|gesucht)/i;
const SUCH_KONTEXT_DANACH = /(nicht gefunden|keine (produkte|ergebnisse|treffer)|no results|not found)/i;

function fundstellen(text, varianten) {
  const out = [];
  for (const v of varianten) {
    const re = new RegExp(`(?<!\\d)${v}(?!\\d)`, 'g');
    let m;
    while ((m = re.exec(text))) out.push({ index: m.index, laenge: v.length });
  }
  return out;
}

function imSuchKontext(text, f) {
  const davor = text.slice(Math.max(0, f.index - 80), f.index);
  const danach = text.slice(f.index + f.laenge, f.index + f.laenge + 60);
  return SUCH_KONTEXT_DAVOR.test(davor) || SUCH_KONTEXT_DANACH.test(danach);
}

// Bezeichnungen direkt vor einer kurzen Nummer (Kopfkommentar). Die
// nächstgelegene entscheidet: „EAN/Art.-Nr.: 40123456“ belegt nichts.
const EAN_BEZEICHNUNG = /\b(?:ean(?:[-\s]?(?:8|13|code|nummer|nr))?|gtin(?:[-\s]?(?:8|12|13|14))?|barcode|strichcode|upc)\b/gi;
const FREMDE_BEZEICHNUNG = /\b(?:pzn|sku|mpn|art(?:ikel)?[-.\s]*(?:nr|nummer|no)|bestell[-.\s]*(?:nr|nummer)|produkt[-.\s]*(?:nr|nummer|id)|product[-_.\s]*(?:id|no|number)|item[-_.\s]*(?:id|no|number)|hersteller[-.\s]*(?:nr|nummer)|modell(?:nummer)?|id)\b/gi;
const BEZEICHNUNG_ABSTAND = 25;

function letzteStelle(re, s) {
  let letzte = -1;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(s))) letzte = m.index + m[0].length;
  return letzte;
}

// Eine weitere Nummer zwischen Bezeichnung und Fundstelle: dann gehört die
// Bezeichnung zu IHR („EAN 4012345678901 | 40123456“ — die acht Ziffern sind
// etwas anderes). Ab 4 Ziffern; „EAN-8“, „(8-stellig)“ bleiben Bezeichnungen.
const ZWISCHEN_NUMMER = /\d{4,}/;

/** Steht direkt vor der Fundstelle „EAN“/„GTIN“/„Barcode“ — keine andere
 *  Nummernbezeichnung näher dran und keine andere Nummer dazwischen
 *  (Schlussprüfung 04.10.2026)? */
function alsEanBezeichnet(text, f) {
  const davor = text.slice(Math.max(0, f.index - BEZEICHNUNG_ABSTAND), f.index);
  const ean = letzteStelle(EAN_BEZEICHNUNG, davor);
  if (ean < 0 || ean <= letzteStelle(FREMDE_BEZEICHNUNG, davor)) return false;
  return !ZWISCHEN_NUMMER.test(davor.slice(ean));
}

/** Die EAN steht im sichtbaren Text — nicht hinter „Suche/Ergebnisse“. Für
 *  kurze Codes zählt eine 8-stellige Fundstelle nur mit der Bezeichnung
 *  EAN/GTIN/Barcode davor; die 12–14-stellige Schreibweise (mit führenden
 *  Nullen) ist selbst schon eine GTIN-Angabe. */
function eanImText(text, varianten, { kurz = false } = {}) {
  return fundstellen(text, varianten).some(
    (f) => !imSuchKontext(text, f) && (!kurz || f.laenge >= 12 || alsEanBezeichnet(text, f)),
  );
}

/**
 * Liest die Seite einmal und beantwortet alles, was vor dem KI-Aufruf und bei
 * der Übernahme von Name/Bild/Preis gebraucht wird.
 *
 * Vor dem KI-Aufruf (kiDarf) muss die Seite belegt zu dieser EAN gehören:
 *   • ein JSON-LD-Produkt trägt die EAN als Kennung ('jsonld_gtin'), oder
 *   • die EAN steht im sichtbaren Text ('seitentext') UND die Seite zeigt laut
 *     Strukturdaten nicht mehrere Produkte.
 * `grundOhneKi` sagt, warum nicht: 'gtin_widerspruch' | 'mehrere_produkte' |
 * 'ean_not_in_html'. Ob die KI selbst „mehrere Produkte“ meldet, entscheidet
 * danach kiInhaltGilt.
 *
 * @returns {{
 *   produkte: Array, produktAnzahl: number|null, meta: object,
 *   passendesProdukt: object|null, widerspruch: boolean,
 *   eanImSeitentext: boolean, fundstelle: 'jsonld_gtin'|'seitentext'|null,
 *   kiDarf: boolean, grundOhneKi: string|null,
 *   rohName: string|null, rohMarke: string|null, rohBilder: string[],
 *   angebot: {preis:number, waehrung:string|null}|null, waehrung: string|null,
 *   text: string, rohInhalt: string|null, istMarkdown: boolean
 * }}
 */
function analysiereSeite({ inhalt, ean, istMarkdown = false } = {}) {
  const varianten = eanVarianten(ean);
  const kurz = istKurzerCode(ean);
  const html = String(inhalt || '');
  const text = sichtbarerText(html, { istMarkdown });
  const produkte = istMarkdown ? [] : sammleProdukte(leseJsonLd(html));
  const meta = istMarkdown ? leseMetaDaten('') : leseMetaDaten(html);

  // Kurze Codes: nur GTIN-Felder belegen (sku/mpn/productID sind dort oft
  // Händlernummern, Kopfkommentar).
  const passendesProdukt =
    produkte.find((p) => (kurz ? p.gtinKennungen : p.kennungen).some((k) => varianten.includes(k) || gleicheGtin(k, ean))) || null;

  // Genau ein Produkt mit Kennungen, keine davon ist unsere EAN → die Seite
  // beschreibt ein anderes Produkt (shop-apotheke: gtin13 9120082630382 für
  // gesuchte 4069365317310). Kein KI-Aufruf, keine Daten.
  const widerspruch =
    !passendesProdukt && produkte.length === 1 && produkte[0].gtins.some((k) => pruefzifferGueltig(k));

  let produktAnzahl = null;
  if (produkte.length > 0) produktAnzahl = produkte.length;
  else if (!istMarkdown) {
    const md = zaehleMicrodataProdukte(html);
    if (md > 0) produktAnzahl = md;
  }

  const eanImSeitentext = varianten.length > 0 && eanImText(text, varianten, { kurz });
  let fundstelle = null;
  if (passendesProdukt) fundstelle = 'jsonld_gtin';
  else if (eanImSeitentext) fundstelle = 'seitentext';

  // Warum die Seite KEINE KI bekommt (null = sie darf).
  let grundOhneKi = null;
  if (widerspruch) grundOhneKi = 'gtin_widerspruch';
  else if (!fundstelle) grundOhneKi = 'ean_not_in_html';
  else if (!passendesProdukt && produktAnzahl !== null && produktAnzahl > 1) grundOhneKi = 'mehrere_produkte';

  // Rohname/-bild: aus dem belegten Produkt; die Seiten-Metadaten nur, wenn
  // die Seite höchstens EIN Produkt beschreibt (sonst gehören og:title und
  // og:image womöglich zu einem anderen).
  const einzigesProdukt = produkte.length === 1 ? produkte[0] : null;
  const quelle = passendesProdukt || einzigesProdukt;
  const metaErlaubt = !istMarkdown && produkte.length <= 1;
  const rohName = (quelle && quelle.name) || (metaErlaubt ? meta.ogTitle || meta.titel : null) || null;
  const rohMarke = quelle?.marke || null;
  const rohBilder = [...(quelle ? quelle.bilder : []), ...(metaErlaubt ? meta.ogImages : [])];

  const angebot = (quelle && quelle.angebote.find((a) => a.preis > 0)) || null;
  const waehrung = angebot?.waehrung || (quelle?.angebote.find((a) => a.waehrung)?.waehrung) || meta.waehrung || null;

  return {
    produkte,
    produktAnzahl,
    meta,
    passendesProdukt,
    widerspruch,
    eanImSeitentext,
    fundstelle,
    kiDarf: grundOhneKi === null,
    grundOhneKi,
    rohName,
    rohMarke,
    rohBilder,
    angebot,
    waehrung,
    text,
    // Markdown behält Adressen nur im Rohinhalt (für die Bildprüfung).
    rohInhalt: istMarkdown ? html : null,
    istMarkdown,
  };
}

// ─── Name ─────────────────────────────────────────────────────────

const PLATZHALTER_NAME =
  /^(produkt|produkte|artikel|startseite|home|suche|suchergebnisse|404|seite nicht gefunden|client challenge|access denied|forbidden|just a moment.*|attention required.*|willkommen.*)$/i;
// Barcode-Datenbanken (06.10.2026, erster Lauf nach dem Ausrollen): opengtindb
// lieferte als Namen seinen Seitentitel „4068706509612 Open EAN Database -
// Datenbank und Produktbewertung“.
const VERDAECHTIGER_NAME = /(suchergebnis|search result|not found|nicht gefunden|client challenge|captcha|cookie|open ean database|ean[- ]?datenbank|barcode[- ]?datenbank|produktbewertung)/i;
// Ein Name, der mit einer Strichcode-Nummer (8–14 Ziffern) BEGINNT, ist der
// Seitentitel einer Barcode-Seite oder nur die Nummer selbst, nie ein
// Produktname. Gemessen 06.10.2026: 3 von 21.109 Namen in external_products,
// alle drei unbrauchbar. Kopie: external-product-lookup/lib/normalizers.js
// (echterName) — bei Änderungen beide nachziehen.
const NAME_BEGINNT_MIT_NUMMER = /^\d{8,14}\b/;
const SHOP_WOERTER = /\b(shop|online[- ]?shop|kaufen|bestellen|gro(ß|ss)handel|versand|apotheke)\b|\.(de|at|com|eu|net|shop)\b/i;

function hostWoerter(host) {
  if (!host) return [];
  const teile = String(host).toLowerCase().replace(/^www\./, '').split('.');
  teile.pop(); // Endung
  return teile
    .filter((t) => t.length >= 4 && !['shop', 'produkte', 'store'].includes(t))
    .flatMap((t) => [t, t.replace(/-/g, ' ')]);
}

/** „Gut &amp; Günstig Nuss Nougat Creme - … 400 g - Morgenmarkt.de“ →
 *  „Gut & Günstig Nuss Nougat Creme - … 400 g“. Nur hinten angehängte
 *  Shop-Teile werden entfernt; null bei Platzhaltern („Produkt“, „Client
 *  Challenge“, reine Ziffern). */
function bereinigeName(roh, { host = null } = {}) {
  if (roh == null) return null;
  let s = dekodiereEntities(String(roh)).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const shopTeil = (teil) => {
    const t = teil.toLowerCase();
    return SHOP_WOERTER.test(t) || hostWoerter(host).some((w) => t.includes(w));
  };
  const TRENNER = /\s+(?:\||–|—|-|•|·|⮞|»|::)\s+/;
  let teile = s.split(TRENNER);
  let abgeschnitten = 0;
  while (teile.length > 1 && abgeschnitten < 2 && shopTeil(teile[teile.length - 1])) {
    // Den Trenner mitsamt Rest abschneiden, Original-Trenner davor erhalten
    const letzter = teile.pop();
    s = s.slice(0, s.lastIndexOf(letzter)).replace(/\s*(?:\||–|—|-|•|·|⮞|»|::)\s*$/, '').trim();
    teile = s.split(TRENNER);
    abgeschnitten += 1;
  }
  // „… bei Violey“ / „… ⮞ Globus“ ohne Leerzeichen-Trenner
  for (const w of hostWoerter(host)) {
    s = s.replace(new RegExp(`\\s+(bei|von|im|auf)\\s+${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*$`, 'i'), '').trim();
  }
  s = s.replace(/\s*[⮞»|]\s*$/, '').trim();
  // „… online kaufen“ / „… jetzt bestellen“ am Ende
  s = s.replace(/\s+(jetzt\s+)?(online\s+)?(günstig\s+)?(kaufen|bestellen)$/i, '').trim();
  if (s.length > 200) s = s.slice(0, 200).trim();
  if (s.length < 3) return null;
  if (/^[\d\s.-]+$/.test(s)) return null;
  if (PLATZHALTER_NAME.test(s) || VERDAECHTIGER_NAME.test(s) || NAME_BEGINNT_MIT_NUMMER.test(s)) return null;
  return s;
}

function woerter(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2);
}

/** Die KI darf einen Namen bereinigen, aber nichts erfinden: mindestens 80 %
 *  seiner Wörter müssen in der Quelle stehen (Rohname bzw. Seitentext). So
 *  rutscht auch der mitgegebene „erwartete Produktname“ nicht als Name durch. */
function nameGestuetzt(name, quelle) {
  const w = woerter(name);
  if (w.length === 0) return false;
  const q = new Set(woerter(quelle));
  return w.filter((x) => q.has(x)).length / w.length >= 0.8;
}

// ─── Bild ─────────────────────────────────────────────────────────

const KEIN_PRODUKTBILD = /(^|[/_.-])(logo|favicon|placeholder|platzhalter|no[-_]?image|noimage|dummy|sprite|opengraph-image)([/_.-]|$)/i;

/** Öffentliche http(s)-Adresse eines Produktbilds oder null. Verworfen:
 *  Logos/Platzhalter, SVG, data:-URIs, interne Hosts (budni liefert
 *  „http://localhost:8080/…“) und Werte, die keine Adresse sind (globus:
 *  og:image = „018f8102…“). */
function pruefeBildUrl(wert, basisUrl) {
  if (!wert || typeof wert !== 'string') return null;
  const roh = wert.trim();
  if (!roh || /^data:/i.test(roh)) return null;
  if (!/^(https?:)?\/\//i.test(roh) && !roh.includes('/')) return null;
  let u;
  try {
    u = new URL(roh, basisUrl || undefined);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || /^(127\.|10\.|192\.168\.|0\.)/.test(host) || !host.includes('.')) {
    return null;
  }
  if (/\.svg$/i.test(u.pathname) || KEIN_PRODUKTBILD.test(u.pathname)) return null;
  return u.toString();
}

// ─── Identität (Name, Bild, Beleg) ────────────────────────────────

/**
 * Entscheidet nach dem KI-Aufruf, ob Name und Bild übernommen werden.
 *
 * @param {object} args
 * @param {object} args.analyse   Ergebnis von analysiereSeite
 * @param {object} [args.ki]      { name, einzelprodukt, bildUrl } aus der KI
 * @param {string} [args.basisUrl] tatsächliche Seitenadresse (für relative Bilder)
 * @returns {{productName?:string, shopBildUrl?:string, eanBeleg:string}|null}
 */
function ermittleIdentitaet({ analyse, ki = {}, basisUrl = null } = {}) {
  if (!analyse) return null;
  let host = null;
  try { host = basisUrl ? new URL(basisUrl).host : null; } catch { host = null; }
  const kiName = typeof ki.name === 'string' && ki.name.trim() ? ki.name.trim() : null;

  let beleg = null;
  let name = null;
  let bild = null;

  if (analyse.istMarkdown) {
    // Markdown (Apify) hat keine Seitendaten — Name nur aus dem Text, und nur
    // mit 'seitentext'-Beleg; ob es genau ein Produkt ist, sagt die KI.
    if (!(analyse.eanImSeitentext && ki.einzelprodukt === true)) return null;
    beleg = 'seitentext';
    if (kiName && nameGestuetzt(kiName, analyse.text)) name = bereinigeName(kiName, { host });
    const kiBild = typeof ki.bildUrl === 'string' ? ki.bildUrl.trim() : '';
    // Nur eine Adresse, die wirklich im Markdown steht — nichts Erfundenes.
    if (kiBild && typeof analyse.rohInhalt === 'string' && analyse.rohInhalt.includes(kiBild)) {
      bild = pruefeBildUrl(kiBild, basisUrl);
    }
  } else {
    if (analyse.passendesProdukt) {
      beleg = 'jsonld_gtin';
    } else {
      // Strukturdaten entscheiden; ohne sie og:type=product oder das Urteil
      // der KI — sagt die KI ausdrücklich „mehrere Produkte“, gilt das.
      const einzelprodukt =
        analyse.produktAnzahl === 1 ||
        (analyse.produktAnzahl === null &&
          ki.einzelprodukt !== false &&
          (analyse.meta?.ogType === 'product' || ki.einzelprodukt === true));
      if (!(analyse.eanImSeitentext && einzelprodukt)) return null;
      beleg = 'seitentext';
    }
    const roh = analyse.rohName;
    // Die Marke aus JSON-LD darf die KI ergänzen („L'Oréal Paris Elvital …“).
    const stuetze = [roh, analyse.rohMarke].filter(Boolean).join(' ');
    if (kiName && roh && nameGestuetzt(kiName, stuetze)) name = bereinigeName(kiName, { host });
    if (!name && roh) name = bereinigeName(roh, { host });
    for (const b of analyse.rohBilder || []) {
      bild = pruefeBildUrl(b, basisUrl);
      if (bild) break;
    }
  }

  if (!name && !bild) return null;
  const out = { eanBeleg: beleg };
  if (name) out.productName = name;
  if (bild) out.shopBildUrl = bild;
  return out;
}

// ─── Inhalt der KI (Zutaten, Nährwerte, Preis, Hersteller …) ──────

/**
 * Gehören die Daten, die die KI gelesen hat, zu DIESER EAN? Nach dem
 * KI-Aufruf (analysiereSeite.kiDarf hat die Seite schon zugelassen):
 *   • ohne passendes JSON-LD-Produkt: die Seite muss genau ein Produkt zeigen
 *     — Strukturdaten entscheiden (ein Produkt), ohne sie darf die KI nicht
 *     ausdrücklich „mehrere Produkte“ melden.
 *   • mit passendem JSON-LD-Produkt: nur dann nicht, wenn die Seite laut
 *     Strukturdaten UND KI mehrere Produkte zeigt (Listen-/Suchseite mit
 *     unserem Produkt als einem Eintrag) — dann stammen gelesene Zutaten oder
 *     Preise womöglich von einem anderen Eintrag. Name, Bild und Preis aus
 *     dem JSON-LD des passenden Produkts gelten trotzdem (befund.js).
 */
function kiInhaltGilt({ analyse, kiEinzelprodukt = null } = {}) {
  if (!analyse || !analyse.kiDarf) return false;
  const mehrereLautStruktur = analyse.produktAnzahl !== null && analyse.produktAnzahl > 1;
  if (analyse.passendesProdukt) return !(mehrereLautStruktur && kiEinzelprodukt === false);
  if (analyse.produktAnzahl === 1) return true;
  return !mehrereLautStruktur && kiEinzelprodukt !== false;
}

// ─── Verwertbarkeit ───────────────────────────────────────────────

/** Inhalt im bisherigen Sinn (bis 04.10.2026 die einzige Bedingung):
 *  Zutaten, Nährwerte, ein Preis oder ein Hersteller. */
function hatInhaltsdaten(befund) {
  if (!befund) return false;
  const hasIngredients =
    typeof befund.attr_ingredientStatement === 'string' && befund.attr_ingredientStatement.trim().length > 0;
  const hasNutrition =
    typeof befund.nutr_Energie_val === 'number' ||
    typeof befund.nutr_Fett_val === 'number' ||
    typeof befund.nutr_Kohlenhydrate_val === 'number' ||
    typeof befund.nutr_Eiwei_val === 'number';
  const hasPrice = typeof befund.attr_preis === 'number' && befund.attr_preis > 0;
  const hasManufacturer = typeof befund.attr_hersteller === 'string' && befund.attr_hersteller.trim().length > 0;
  return hasIngredients || hasNutrition || hasPrice || hasManufacturer;
}

/** Ein Fund zählt, wenn er Inhaltsdaten ODER einen belegten Produktnamen
 *  hat. Der Name ist neu (04.10.2026): auch ein Artikel, zu dem keine Seite
 *  Zutaten oder Preis zeigt, gehört mit Namen in die Datenbank. */
function hatVerwertbareDaten(befund) {
  if (!befund) return false;
  const hasName = typeof befund.productName === 'string' && befund.productName.trim().length > 0;
  return hatInhaltsdaten(befund) || hasName;
}

module.exports = {
  nurZiffern,
  gtin14,
  eanVarianten,
  istKurzerCode,
  gleicheGtin,
  pruefzifferGueltig,
  dekodiereEntities,
  sichtbarerText,
  leseJsonLd,
  sammleProdukte,
  leseMetaDaten,
  zaehleMicrodataProdukte,
  analysiereSeite,
  bereinigeName,
  nameGestuetzt,
  pruefeBildUrl,
  ermittleIdentitaet,
  kiInhaltGilt,
  hatInhaltsdaten,
  hatVerwertbareDaten,
};
