/**
 * Filialadresse eines Bons (Straße, PLZ, Ort) — Entscheidung 05.09.2026.
 *
 * Warum: Der Ort eines Bons kam bisher NUR aus der IP-Journey (61–377 km
 * daneben, siehe CLAUDE.md „IP-Ortung"). Die Filialadresse steht aber auf fast
 * jedem Bon-Kopf. Zwei Quellen, die GEMERGT werden (fehlende Felder der einen
 * füllt die andere):
 *
 *   1. `parsed.storeAddress` — strukturiert vom OCR-Prompt (v1.4+). Neue Bons.
 *   2. `parsed.merchantSubtitle` — die wörtliche Zusatzzeile unter dem
 *      Filialnamen, die der Prompt seit v1.0 liefert. Bestand: 6.044 von 6.193
 *      Bons tragen sie, 5.319 davon mit PLZ → der Backfill braucht KEINE
 *      erneute Gemini-Lesung, nur diesen deterministischen Parser.
 *   3. `parsed.merchant` — nur wenn die Kopfzeile selbst eine PLZ trägt.
 *
 * Ausgabe: { street, zip, city, country, source, complete } oder null.
 * Alles sind Angaben zum HÄNDLER (Geschäftsadresse), keine personenbezogenen
 * Daten des Nutzers.
 *
 * Fallen, gegen die der Parser gebaut ist (alle aus echten Bons bzw. dem
 * Rollen-Review vom 05.09.2026):
 *   - Filial-/Marktnummern sehen wie PLZ aus: „Filiale 6100", „MPREIS 8068".
 *     Eine PLZ muss von einem Ortsnamen gefolgt sein und darf nicht hinter
 *     einem Nummern-Schlüsselwort stehen; Hausnummern haben max. 3 Ziffern
 *     und keine führende Null („Aldi Süd 039-041" ist keine Straße).
 *   - Reihenfolge variiert: „Straße, PLZ Ort" (Regel), „PLZ Ort, Straße"
 *     (Netto), „PLZ Ort / Straße Nr" (Rossmann), Zeilenumbruch statt Komma
 *     (SPAR AT), gar kein Trenner („51103 Köln Buchforststr. 1-15").
 *   - Firmensitz VOR der Filiale (MPREIS): steht ein „Filiale …"-Marker
 *     zwischen zwei PLZ-Treffern, gewinnt der Treffer dahinter.
 *   - Ortsnamen, die wie Schlüsselwörter beginnen: Teltow, Telgte, Markt
 *     Schwaben, Filderstraße — Schlüsselwörter zählen nur als GANZE Wörter
 *     bzw. nur, wenn eine Ziffer folgt.
 *   - Länder-Präfix „D-51103", GROSSSCHREIBUNG (BILLA; „WIEN" → „Wien",
 *     vokallose Kürzel wie „IBK" bleiben), römische Stiegen „6/II/57".
 *   - Markenname als Präfix in der Straße („Kaufland - Aachener Straße 58").
 *   - DE = 5-stellig, AT/CH = 4-stellig. Das Land wird NUR gesetzt, wenn es
 *     zur PLZ-Länge passt — sonst null (Fremdland), in beiden Quellen gleich.
 */

'use strict';

const COUNTRIES = new Set(['DE', 'AT', 'CH']);

// Wort direkt VOR einer Zahl, das sie als Filial-/Kassen-/Telefonnummer
// ausweist — dann ist die Zahl keine PLZ. Nur als ganzes Wort (optional ./:).
const NUMBER_KEYWORD_RE =
  /^(filiale|fil|filial-?nr|markt|markt-?nr|nr|no|tel|telefon|fax|kasse|kassen-?nr|bon|bon-?nr|beleg|beleg-?nr|uid|ust|st-?nr|steuer-?nr|kd|kunden-?nr|trace|tse|terminal|ta|pos)[.:]?$/i;
const PHONE_WORD_RE = /^(tel|telefon|fax)[.:]?$/i;
const URL_WORD_RE = /^(www\.|https?:|@)/i;
const COUNTRY_CODE_WORD_RE = /^(de|at|ch|d|a)$/i;
// Wörter, nach denen eine 4-stellige Zahl eher ein Jahr als eine PLZ ist.
const YEAR_CONTEXT_RE = /^(stand|seit|jahr|©|copyright|est\.?|gegr\.?)$/i;

// Segment, das eine Straßenangabe ist: enthält ein Straßen-Schlüsselwort ODER
// endet auf eine Hausnummer (1–3 Ziffern, ohne führende Null, optional
// Buchstabe, Bereich, Stiege/Stock in römischen Zahlen).
const STREET_KEYWORD_RE =
  /(str\.|straße|strasse|stra[sß]e|weg\b|platz|allee|gasse|ring\b|damm\b|ufer\b|chaussee|promenade|steig\b|markt\b|hof\b|zeile\b|berg\b|tor\b|park\b|landstr|hauptstr|bahnhofstr|dorf\b|siedlung|anger\b|wall\b|graben\b|kai\b|lände\b)/i;
// Ein einzelnes WORT, das eine Straße einleitet — für „PLZ Ort Straße Nr" ohne
// Trenner. Bewusst ohne berg/dorf/hof/park (das sind Ortsnamen-Endungen).
const STREET_WORD_RE = /(str\.|straße|strasse|stra[sß]e|weg|platz|allee|gasse|ring|damm|ufer|chaussee|promenade|steig|zeile|landstr|hauptstr|bahnhofstr)$/i;
const HOUSE_NUMBER_TAIL_RE = /\s[1-9]\d{0,2}\s?[a-zA-Z]?(?:\s?[-/]\s?[\dIVX]+[a-zA-Z]?)*$/;
const LEADING_STORE_NO_RE =
  /^(filiale|fil\.|filial-?nr\.?|markt-?nr\.?|nr\.?|tel\.?|telefon|fax|kasse|beleg|belegkopie|bon)(?=[\s:.]|\d|$)/i;
const STORE_MARKER_RE = /^(filiale|fil\.)(?=[\s:.]|\d|$)/i;
const COMPANY_SUFFIX_RE = /\b(gmbh|ag|se|kg|ohg|e\.?k\.?|co\.?|s\.?r\.?l\.?|ltd\.?|mbh)\b/i;
// Generische Händler-/Format-Präfixe vor der Straße („Kaufland - Aachener Str. 58").
const GENERIC_STREET_PREFIX_RE = /^(kaufland|hypermarkt|supermarkt|marken-?discount|e-?center|e center|markthalle|filiale)\s*[-–:]?\s+(?=[A-Za-zÄÖÜäöüß])/i;

// Kleingeschriebene Füllwörter in Ortsnamen („Bruck an der Mur", „St. Anton
// am Arlberg") — nur relevant, wenn der Bon in GROSSSCHREIBUNG druckt.
const LOWER_WORDS = new Set(['an', 'der', 'am', 'im', 'in', 'auf', 'bei', 'die', 'das', 'dem', 'den', 'und', 'zu', 'zur', 'zum', 'a', 'd', 'ob', 'vor', 'unter']);

function clean(s) {
  return String(s ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** GROSSSCHREIBUNG (BILLA, MPREIS) → Groß-/Kleinschreibung; vokallose Kürzel („IBK", „HH") bleiben. */
function titleCaseIfShouting(s) {
  const t = clean(s);
  if (!t) return t;
  const letters = t.replace(/[^A-Za-zÄÖÜäöüß]/g, '');
  if (letters.length < 3 || letters !== letters.toUpperCase()) return t;
  const words = t.split(' ');
  // Kürzel wie „IBK", „HH", „FFM" bleiben; ab 4 Buchstaben ist es ein Ortsname
  // („WIEN" → „Wien"). Bewusster Rest: 3-Buchstaben-Orte in Großschrift („ULM").
  if (words.length === 1 && letters.length <= 3) return t;
  return words
    .map((w, i) =>
      w.replace(/[A-Za-zÄÖÜäöüß]+/g, (m) => {
        if (/^[IVX]{1,4}$/.test(m) && /[\d/]/.test(w)) return m; // Stiege/Stock „6/II/57"
        const lower = m.toLowerCase();
        if (i > 0 && LOWER_WORDS.has(lower)) return lower;
        return m.charAt(0) + lower.slice(1);
      }),
    )
    .join(' ');
}

function normalizeCountry(c) {
  const u = String(c ?? '').trim().toUpperCase();
  return COUNTRIES.has(u) ? u : null;
}

/** Land NUR, wenn es zur PLZ-Länge passt — identisch für OCR- und Subtitle-Pfad. */
function countryFor(zip, hint) {
  if (!zip) return hint;
  if (zip.length === 5) return hint === 'AT' || hint === 'CH' ? null : 'DE';
  return hint === 'AT' || hint === 'CH' ? hint : null;
}

/** Zerlegt eine Adresszeile in Segmente (Komma, Zeilenumbruch, Semikolon, Pipe). */
function segmentsOf(raw) {
  return String(raw ?? '')
    .split(/[\n\r,;|·•]+/)
    .map(clean)
    .filter(Boolean);
}

/**
 * Ortsname = Wörter bis zum ersten Wort mit Ziffer, Telefon-/URL-Marker,
 * Ländercode oder Nummern-Schlüsselwort MIT folgender Ziffer. Erkennt
 * außerdem eine angehängte Straße („Köln Buchforststr. 1-15") und gibt sie
 * getrennt zurück.
 */
function splitCityAndStreet(text) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  const cityWords = [];
  let streetRest = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1] ?? '';
    if (/\d/.test(w)) break;
    if (PHONE_WORD_RE.test(w) || URL_WORD_RE.test(w)) break;
    if (NUMBER_KEYWORD_RE.test(w) && /\d/.test(next)) break; // „Markt 8068" ja, „Markt Schwaben" nein
    if (/^[A-Z]{2,3}\d{6,}/.test(w)) break; // UID/Steuernummern wie DE213413670
    if (COUNTRY_CODE_WORD_RE.test(w) && (cityWords.length || words.length === 1)) break; // „Berlin DE"
    if (cityWords.length && STREET_WORD_RE.test(w) && /\d/.test(words.slice(i).join(' '))) {
      streetRest = words.slice(i).join(' ');
      break;
    }
    cityWords.push(w);
  }
  const city = titleCaseIfShouting(cityWords.join(' ').replace(/[\s\-–:/]+$/, ''));
  return { city: /^[A-Za-zÄÖÜäöüß]/.test(city) ? city : null, streetRest };
}

function cityFrom(text) {
  return splitCityAndStreet(text).city;
}

function looksLikeStreet(segment) {
  const s = clean(segment);
  if (!s || !/^[A-Za-zÄÖÜäöüß]/.test(s)) return false; // Straßen beginnen mit Buchstabe
  if (LEADING_STORE_NO_RE.test(s)) return false;
  if (!/\d/.test(s)) return false;
  if (!/[A-Za-zÄÖÜäöüß]{3,}/.test(s)) return false;
  if (COMPANY_SUFFIX_RE.test(s) && !STREET_KEYWORD_RE.test(s)) return false;
  return STREET_KEYWORD_RE.test(s) || HOUSE_NUMBER_TAIL_RE.test(s);
}

function streetFrom(segment) {
  let s = clean(segment);
  if (!s) return null;
  if (LEADING_STORE_NO_RE.test(s) && !STORE_MARKER_RE.test(s)) return null; // „Tel. …", „Kasse: 8"
  s = s.replace(/^(filiale|fil\.)\s*[:.]?\s*\d*\s*/i, ''); // „Filiale 7019 Buchforststr. 1" → Straße
  s = s.replace(/\b(filiale|fil\.)\s*:?\s*\d{3,5}\b/gi, ' '); // Filial-Token mittendrin
  s = clean(s).replace(GENERIC_STREET_PREFIX_RE, '');
  s = clean(s).replace(/^[\s,;:\-–]+|[\s,;:\-–]+$/g, '');
  if (!looksLikeStreet(s)) return null;
  return titleCaseIfShouting(s);
}

/**
 * Sucht in einem Segment eine PLZ: 5-stellig (DE) bzw. 4-stellig (AT/CH).
 * Gültig nur, wenn die Zahl allein steht, nicht hinter einem Nummern-
 * Schlüsselwort und von einem Ortsnamen (Buchstaben) gefolgt wird — im selben
 * Segment oder (bei leerem Rest) im nächsten, rein alphabetischen Segment.
 * Erkennt außerdem eine Straße HINTER dem Ort („PLZ Ort / Straße Nr").
 * @returns {{zip:string, city:string, before:string, afterStreet:string|null}|null}
 */
function findZipInSegment(segment, digits, nextSegment, hint) {
  const re = new RegExp(`(?:^|[^\\d\\-/.])((?:D|A|CH)-)?(\\d{${digits}})(?![\\d\\-/.])`, 'g');
  let m;
  while ((m = re.exec(segment)) !== null) {
    const zip = m[2];
    const start = m.index + m[0].length - zip.length;
    const before = clean(segment.slice(0, start - (m[1] ? m[1].length : 0)));
    const after = clean(segment.slice(start + zip.length).replace(/^[\s\-–:]+/, ''));
    const prevWord = before.split(/\s+/).pop() || '';
    if (prevWord && NUMBER_KEYWORD_RE.test(prevWord)) continue;
    if (digits === 4 && !hint && /^(19|20)\d\d$/.test(zip) && YEAR_CONTEXT_RE.test(prevWord)) continue;

    // Rossmann/VKST-Format „PLZ Ort / Straße Nr": hinter dem Trenner steht
    // die Straße, nicht mehr der Ort. Trenner ohne Straße („Lichtenstein /
    // Sachsen", „Köln - Altstadt Süd") bleiben Teil des Ortsnamens.
    let cityPart = after;
    let afterStreet = null;
    const sep = after.match(/\s[/\-–]\s/);
    if (sep) {
      const head = after.slice(0, sep.index);
      const tail = after.slice(sep.index + sep[0].length);
      if (looksLikeStreet(tail)) {
        cityPart = head;
        afterStreet = streetFrom(tail);
      }
    }
    const split = splitCityAndStreet(cityPart);
    let city = split.city;
    if (!afterStreet && split.streetRest) afterStreet = streetFrom(split.streetRest);
    if (!city && !after && nextSegment && /^[A-Za-zÄÖÜäöüß]/.test(nextSegment) && !/\d/.test(nextSegment)) {
      city = cityFrom(nextSegment);
    }
    // Form „Ort PLZ Land" („Berlin 10719 DE"): der Ort steht VOR der PLZ.
    if (!city && after && COUNTRY_CODE_WORD_RE.test(after.split(/\s+/)[0]) && before && !/\d/.test(before) && !looksLikeStreet(before)) {
      city = cityFrom(before.split(/\s+/).slice(-2).join(' '));
      if (city) return { zip, city, before: '', afterStreet: null };
    }
    if (!city) continue;
    return { zip, city, before, afterStreet };
  }
  return null;
}

/**
 * Deterministischer Parser für eine Adresszeile (merchantSubtitle).
 * @param {string} raw
 * @param {string|null} [countryHint] 'DE' | 'AT' | 'CH'
 * @returns {{street:string|null, zip:string|null, city:string|null, country:string|null}|null}
 */
function parseAddressLine(raw, countryHint = null) {
  const hint = normalizeCountry(countryHint);
  const segs = segmentsOf(raw);
  if (!segs.length) return null;

  const order = hint === 'AT' || hint === 'CH' ? [4, 5] : hint === 'DE' ? [5] : [5, 4];
  const hits = [];
  for (const digits of order) {
    for (let i = 0; i < segs.length; i++) {
      const hit = findZipInSegment(segs[i], digits, segs[i + 1] ?? null, hint);
      if (hit) hits.push({ ...hit, segIdx: i });
    }
    if (hits.length) break;
  }
  let zipHit = null;
  if (hits.length) {
    // Firmensitz vor Filiale (MPREIS): steht ein „Filiale …"-Marker vor einem
    // späteren Treffer, ist DER die Filialadresse.
    const markerIdx = segs.findIndex((s) => STORE_MARKER_RE.test(s));
    zipHit = (markerIdx >= 0 && hits.find((h) => h.segIdx > markerIdx)) || hits[0];
  }
  const zipSegIdx = zipHit ? zipHit.segIdx : -1;

  let street = null;
  if (zipHit && zipHit.before) street = streetFrom(zipHit.before);
  if (!street && zipHit && zipHit.afterStreet) street = zipHit.afterStreet;
  if (!street) {
    // Erst die Segmente NACH der PLZ (Filialblock), dann die davor (Firmensitz).
    const idx = segs.map((_, i) => i).filter((i) => i !== zipSegIdx);
    const ordered = zipSegIdx >= 0 ? [...idx.filter((i) => i > zipSegIdx), ...idx.filter((i) => i < zipSegIdx)] : idx;
    for (const i of ordered) {
      const s = streetFrom(segs[i]);
      if (s) {
        street = s;
        break;
      }
    }
  }

  const zip = zipHit ? zipHit.zip : null;
  const city = zipHit ? zipHit.city : null;
  if (!zip && !city && !street) return null;
  return { street, zip, city, country: countryFor(zip, hint) };
}

function normalizeZip(zip, hint) {
  const z = clean(zip).replace(/^(D|A|CH)-/i, '').replace(/\s+/g, '');
  if (!/^\d{4,5}$/.test(z)) return null;
  if (hint === 'DE' && z.length !== 5) return null; // in DE ist 4-stellig nie eine PLZ
  return z;
}

/** Händlername als Präfix aus der Straße entfernen („Kaufland - Aachener Straße 58"). */
function stripMerchantPrefix(street, merchantName) {
  if (!street) return null;
  const m = clean(merchantName);
  if (!m || m.length < 2) return street;
  const re = new RegExp('^' + escapeRe(m) + '\\s*[-–:,]?\\s+(?=[A-Za-zÄÖÜäöüß])', 'i');
  const stripped = clean(street.replace(re, ''));
  if (stripped === street) return street;
  return looksLikeStreet(stripped) ? titleCaseIfShouting(stripped) : null;
}

/**
 * Filialadresse aus einem OCR-Ergebnis ableiten — EINE Stelle für Pipeline,
 * Resolver und Backfill. OCR-Objekt (v1.4) und merchantSubtitle werden
 * gemergt: jedes Feld, das die OCR nicht liefert, kommt aus der Zeile.
 * @param {object} parsed  ocr.parsed (Gemini/DocAI/Cache)
 * @param {string|null} [fallbackCountry]  z.B. merchantInfo.land
 * @returns {{street:string|null, zip:string|null, city:string|null,
 *            country:string|null, source:'ocr'|'ocr+subtitle'|'subtitle'|'merchant',
 *            complete:boolean}|null}
 */
function deriveStoreAddress(parsed, fallbackCountry = null) {
  if (!parsed || typeof parsed !== 'object') return null;
  const hint = normalizeCountry(parsed.bonCountry) || normalizeCountry(fallbackCountry);
  const merchantName = clean(parsed.merchant);

  const sub = parseAddressLine(parsed.merchantSubtitle, hint);
  const sa = parsed.storeAddress && typeof parsed.storeAddress === 'object' ? parsed.storeAddress : null;
  let ocr = null;
  if (sa) {
    const zip = normalizeZip(sa.zip, hint);
    const cityRaw = clean(sa.city).replace(/^(?:D-|A-|CH-)?\d{4,5}\s+/i, ''); // „69221 Dossenheim"
    const city = cityRaw ? cityFrom(cityRaw) : null;
    const street = sa.street ? streetFrom(sa.street) : null;
    if (zip || city || street) ocr = { zip, city, street };
  }

  let picked = null;
  let source = null;
  if (ocr || sub) {
    const zip = (ocr && ocr.zip) || (sub && sub.zip) || null;
    const city = (ocr && ocr.city) || (sub && sub.city) || null;
    const street = (ocr && ocr.street) || (sub && sub.street) || null;
    const fromSub =
      (!(ocr && ocr.zip) && sub && sub.zip ? 1 : 0) +
      (!(ocr && ocr.city) && sub && sub.city ? 1 : 0) +
      (!(ocr && ocr.street) && sub && sub.street ? 1 : 0);
    source = ocr ? (fromSub ? 'ocr+subtitle' : 'ocr') : 'subtitle';
    picked = { zip, city, street };
  } else {
    // Manche Bons drucken die Anschrift in die Kopfzeile selbst
    // („REWE, 51103 Köln"). Nur mit PLZ übernehmen — ein bloßer Name ist kein Ort.
    const m = parseAddressLine(parsed.merchant, hint);
    if (m && m.zip) {
      picked = m;
      source = 'merchant';
    }
  }
  if (!picked) return null;
  picked.street = stripMerchantPrefix(picked.street, merchantName);
  if (!picked.zip && !picked.city && !picked.street) return null;
  return finish({ ...picked, country: countryFor(picked.zip, hint) }, source);
}

function finish(a, source) {
  return {
    street: a.street || null,
    zip: a.zip || null,
    city: a.city || null,
    country: a.country || null,
    source,
    complete: Boolean(a.zip && a.city),
  };
}

module.exports = { deriveStoreAddress, parseAddressLine, titleCaseIfShouting, countryFor };
