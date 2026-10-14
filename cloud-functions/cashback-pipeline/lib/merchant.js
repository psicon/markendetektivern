/**
 * Merchant resolution — match the OCR'd merchant string against the
 * project's existing `discounter` collection.
 *
 * Three-stage match (first hit wins):
 *   1) Token-based alias table (fast, deterministic)
 *   2) Levenshtein fuzzy match against discounter `name` (catches OCR
 *      typos like "REME" / "AlDi" / "kanfland")
 *   3) Substring scan over the raw merchant string against discounter
 *      `name` (last-resort)
 *
 * Then we pick the BEST matching discounter doc by country: if the
 * bon's country is known (from the OCR's `bonCountry` field) we
 * prefer that; otherwise we fall back to DE.
 *
 * Cached per Cloud Function instance (5 minutes). Cold starts pull
 * 19 small docs — negligible.
 */

'use strict';

const admin = require('firebase-admin');
const { logger } = require('firebase-functions');

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = { at: 0, list: null };

// Per-merchant alias hints. Each entry: { id, tokens (literal substrings
// or RegExp) }. Iterated in order — first match wins.
const ALIASES = [
  { id: 'rewe',      tokens: ['rewe', 'nahkauf'] },
  { id: 'lidl',      tokens: ['lidl'] },
  { id: 'aldi-sued', tokens: ['aldi süd', 'aldi sued', 'aldi-süd', 'aldisued'] },
  { id: 'aldi-nord', tokens: ['aldi nord'] },
  { id: 'aldi',      tokens: ['aldi'] },
  // Vertriebslinien der EDEKA-Gruppe: auf dem Bonkopf steht oft nur die
  // Linie, nicht "EDEKA". ACHTUNG: "nahkauf" gehört zu REWE, nicht hierher.
  // aliasMatch bekommt den NORMALISIERTEN Namen (normalize() entfernt "&"):
  // „nah & gut" steht hier deshalb als „nah gut".
  { id: 'edeka',     tokens: ['edeka', 'e center', 'e-center', 'e neukauf', 'marktkauf', 'nah gut', 'nah und gut', 'nahundgut', 'nahgut', 'e aktiv', 'e-aktiv', 'neukauf'] },
  { id: 'kaufland',  tokens: ['kaufland'] },
  { id: 'penny',     tokens: ['penny'] },
  { id: 'netto',     tokens: ['netto'] },
  { id: 'dm',        tokens: ['dm-drogerie', 'dm drogerie', 'dm filiale', /\bdm\b/] },
  { id: 'rossmann',  tokens: ['rossmann', 'roßmann'] },
  { id: 'mueller',   tokens: ['müller', 'mueller'] },
  { id: 'norma',     tokens: ['norma'] },
  { id: 'globus',    tokens: ['globus'] },
  { id: 'hofer',     tokens: ['hofer'] },
  { id: 'spar',      tokens: ['eurospar', 'interspar', /\bspar\b/] },
  { id: 'billa',     tokens: ['billa'] },
];


// ─── Eigenmarken als Ketten-Signal (Stufe 4) ─────────────────────
//
// Viele EDEKA-, REWE- und SPAR-Märkte werden von selbstständigen Kaufleuten
// geführt: Im Bonkopf steht die Firma des Inhabers ("Peter Frauen GmbH & Co.KG"),
// nicht die Kette. Tokens helfen da nicht — die Namen sind beliebig.
//
// Eigenmarken sind dagegen KETTENEXKLUSIV: "G&G" gibt es nur in der
// EDEKA-Gruppe, "K-Classic" nur bei Kaufland, "Milbona" nur bei Lidl. Steht
// so ein Artikel auf dem Bon, ist die Kette damit bestimmt.
//
// Ein einziger Treffer genügt (auf kleinen Bons steht oft nur eine Eigenmarke),
// ABER nur, wenn keine zweite Kette widerspricht — dann lieber nichts erkennen.
const STORE_BRANDS = [
  { id: 'edeka',    patterns: [/\bg\s*&\s*g\b/, /\bgut\s*&\s*g[üu]nstig\b/, /\bgut\s+und\s+g[üu]nstig\b/] },
  { id: 'rewe',     patterns: [/\brewe\s+(bio|beste\s+wahl|feine\s+welt)\b/] },
  { id: 'kaufland', patterns: [/\bk-?classic\b/, /\bk-?bio\b/, /\bk-?favourites\b/, /\bk-?purland\b/] },
  { id: 'lidl',     patterns: [/\bmilbona\b/, /\bfreshona\b/, /\bvemondo\b/, /\bcombino\b/, /\balesto\b/, /\bdulano\b/, /\bpilos\b/, /\bcrownfield\b/, /\bsolevita\b/, /\bgelatelli\b/, /\bsondey\b/, /\bbelbake\b/, /\bmetzgerfrisch\b/, /\bfavorina\b/] },
  { id: 'aldi',     patterns: [/\bmilsani\b/, /\bsun\s+snacks\b/, /\bmoser\s+roth\b/, /\bchoceur\b/, /\bmamia\b/, /\btandil\b/, /\bombia\b/, /\bfin\s+carr[ée]\b/, /\bback\s+family\b/, /\bwintertraum\b/] },
  { id: 'netto',    patterns: [/\belkos\b/, /\bbiobio\b/] },
];

/**
 * Kette aus den Artikelnamen ableiten. Nur eindeutige Treffer zählen.
 * @param {Array<{name?:string}>|null|undefined} items
 * @returns {{id:string, hits:number, brand:string}|null}
 */
function chainFromItems(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const hits = new Map();
  for (const it of items) {
    // NICHT normalize(): das entfernt "&" und macht aus "G&G" ein "g g".
    // Eigenmarken brauchen die Sonderzeichen, deshalb nur klein + entspannte
    // Leerzeichen.
    const name = String((it && it.name) || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!name) continue;
    for (const brand of STORE_BRANDS) {
      if (brand.patterns.some((re) => re.test(name))) {
        const cur = hits.get(brand.id) || { id: brand.id, hits: 0, brand: name };
        cur.hits += 1;
        hits.set(brand.id, cur);
      }
    }
  }
  if (hits.size !== 1) return null; // 0 = kein Signal, >1 = widersprüchlich
  return [...hits.values()][0];
}

// ─── Gedruckte Umsatzsteuer-ID der Kette (Stufe 1b) ──────────────
//
// Prüfrunde 3 (04.10.2026): Auf REWE-eBons (PDF, App-Screenshot) steht oft
// kein Händlername, nur „UID Nr.: DE812706034" — die Umsatzsteuer-ID der
// REWE Markt GmbH. Ohne Namen fand der Resolver dort nichts (bzw. früher
// über den Tippfehler-Abgleich „dm"). Eine gedruckte Kennung der Kette ist
// kein Schluss aus Artikeln (Picnic führt keine REWE-ID), deshalb hier.
// Nur IDs, die in 95 Tagen auf ≥ 50 Bons standen und dort zu ≥ 98 % genau
// einem Markt gehörten (scratchpad/verif_r3_ust.js, 14.369 Bons):
//   DE812706034 REWE   133 von 136 (die 3 übrigen: ohne gelesenen Namen,
//                      2× als „dm", 1× ohne Markt — genau dieser Fehler)
//   DE132748925 Norma  100 von 100
//   DE202748117 Penny   54 von 55 (1 ohne Markt)
// Kaufland druckt je Filiale eine eigene ID und immer den Namen — nicht nötig.
const UST_KETTE = new Map([
  ['DE812706034', 'rewe'],
  ['DE132748925', 'norma'],
  ['DE202748117', 'penny'],
]);

/**
 * Kette aus einer gedruckten Umsatzsteuer-ID im Bonkopf (merchantSubtitle).
 * Zwei verschiedene Ketten → keine (lieber nichts als falsch).
 * @param {string|string[]|null|undefined} kopf
 * @returns {string|null} Alias-ID ('rewe', 'norma', 'penny')
 */
function ketteAusUstId(kopf) {
  const texte = (Array.isArray(kopf) ? kopf : [kopf]).filter((t) => typeof t === 'string' && t);
  const ketten = new Set();
  for (const t of texte) {
    const kompakt = t.toUpperCase().replace(/[\s.:/-]/g, '');
    for (const m of kompakt.matchAll(/DE\d{9}/g)) {
      const k = UST_KETTE.get(m[0]);
      if (k) ketten.add(k);
    }
  }
  return ketten.size === 1 ? [...ketten][0] : null;
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Ist genug vom Händlernamen gelesen, um ihn abzugleichen (≥ 3 Zeichen)? */
function nameVerwertbar(raw) {
  return normalize(raw).length >= 3;
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\*]/g, ' ')
    .replace(/[^a-zäöüß\s\-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classic Levenshtein distance — minimum number of single-character
 * edits to turn `a` into `b`. We use it to absorb common OCR errors
 * (REME → REWE, kanfland → kaufland, etc.).
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const t = prev;
    prev = curr;
    curr = t;
  }
  return prev[n];
}

async function loadDiscounters() {
  const now = Date.now();
  if (_cache.list && now - _cache.at < CACHE_TTL_MS) return _cache.list;
  try {
    const snap = await admin.firestore().collection('discounter').get();
    const list = snap.docs.map((d) => {
      const data = d.data();
      return {
        docId: d.id,
        name: String(data.name || ''),
        nameNorm: normalize(data.name || ''),
        land: String(data.land || 'DE').toUpperCase(),
        bild: String(data.bild || ''),
      };
    });
    _cache = { at: now, list };
    return list;
  } catch (e) {
    logger.warn('discounter-load-failed', { err: e.message });
    return _cache.list || [];
  }
}

/**
 * Pick the best discounter doc among a set of candidates given the
 * bon's country. Country match wins; otherwise DE; otherwise first.
 */
function pickByCountry(candidates, bonCountry) {
  if (!candidates.length) return null;
  const want = (bonCountry || 'DE').toUpperCase();
  const exact = candidates.find((d) => d.land === want);
  if (exact) return exact;
  const de = candidates.find((d) => d.land === 'DE');
  if (de) return de;
  return candidates[0];
}

// ─── Stage 1: alias-based match ──────────────────────────────────

function aliasMatch(norm) {
  for (const alias of ALIASES) {
    for (const t of alias.tokens) {
      const ok =
        t instanceof RegExp ? t.test(norm) : norm.includes(String(t).toLowerCase());
      if (ok) return alias;
    }
  }
  return null;
}

function discountersForAliasId(id, all) {
  const idTokens = id.split('-'); // 'aldi-sued' → ['aldi','sued']
  return all.filter((d) => {
    const dn = d.nameNorm;
    return idTokens.every(
      (tok) => dn.includes(tok) || (tok === 'sued' && dn.includes('süd')),
    );
  });
}

// ─── Stage 2: Levenshtein fuzzy match ─────────────────────────────

function fuzzyMatch(norm, all, maxDist = 2) {
  // Tokenize the raw merchant string and compare each token to each
  // discounter name. Best (lowest) distance wins; threshold scales
  // gently with name length (longer names allow 1 extra edit).
  const tokens = norm.split(/\s+/).filter((t) => t.length >= 3);
  let best = { dist: Infinity, doc: null };
  for (const d of all) {
    const target = d.nameNorm;
    if (!target) continue;
    const allowed = Math.min(maxDist + Math.floor(target.length / 6), 3);
    // Whole-string distance (handles short names like "DM", "Spar")
    const dWhole = levenshtein(norm, target);
    if (dWhole <= allowed && dWhole < best.dist) {
      best = { dist: dWhole, doc: d };
      continue;
    }
    // Per-token distance (handles long headers like "EDEKA E.J. Sondermann")
    for (const tok of tokens) {
      const d2 = levenshtein(tok, target);
      if (d2 <= allowed && d2 < best.dist) {
        best = { dist: d2, doc: d };
      }
    }
  }
  return best.doc;
}

// ─── Stage 3: substring scan (last resort) ────────────────────────

function substringMatch(norm, all) {
  // Long discounter names embedded somewhere in the merchant header
  // (e.g. "Netto Markendiscount AG & Co. KG" → contains "netto markendiscount").
  const sorted = [...all].sort((a, b) => b.nameNorm.length - a.nameNorm.length);
  for (const d of sorted) {
    if (d.nameNorm.length >= 4 && norm.includes(d.nameNorm)) return d;
  }
  return null;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Find the canonical merchant for a raw OCR string + optional country.
 *
 * @param {string|null|undefined} rawMerchant
 * @param {string|null|undefined} bonCountry  'DE' | 'AT' | 'CH' | null
 * @param {Array<{name?:string}>} [items]     Artikel für Stufe 4 (Eigenmarke)
 * @param {object} [opts]
 * @param {boolean} [opts.eigenmarke=true]    false = Stufe 4 aus. Für Online-
 *   Bestellungen (Entscheidung 04.10.2026): ein Lieferdienst, der Eigenmarken
 *   einer Kette verkauft (Picnic führt G&G), ist nicht diese Kette — sonst
 *   wurde eine Picnic-Rechnung als EDEKA-Bon bezahlt. Ein selbstständiger
 *   EDEKA-Kaufmann hat dagegen einen LADEN; dort bleibt die Stufe an.
 * @param {boolean} [opts.fuzzy=true]  false = Stufe 2 (Tippfehler-Abgleich) aus.
 *   Für Online-Bestellungen (Prüfrunde 2, 04.10.2026): ein gedruckter Shopname
 *   braucht keine Tippfehler-Toleranz, und die Stufe ordnet fremde Händler über
 *   kurze Wörter unseren Märkten zu („Denns" → Penny, „Das Futterhaus" → dm).
 *   Bei Ladenbons bleibt sie (Fehllesungen auf Thermopapier) — dort ist die
 *   Schärfung eine eigene Aufgabe, gemessen am Bestand.
 * @param {boolean} [opts.nachsichtig=false]  Verhalten VOR der Prüfrunde 2
 *   (Namensstufen auch ohne verwertbaren Namen, Tippfehler-Abgleich immer).
 *   Für den Bestandsschutz schon bezahlter Bons und — bis zur Entscheidung
 *   über `cashback_config/v1.marktNurMitName` (Prüfrunde 3) — für Ladenbons
 *   (index.js). Ein Gate, das von approved wegführt, hängt an alreadyCredited.
 * @param {string|string[]|null} [opts.kopf]  Zusatzzeilen des Bonkopfs
 *   (merchantSubtitle) für Stufe 1b (gedruckte Umsatzsteuer-ID der Kette).
 * @returns {Promise<{
 *   id, name, displayName, logoUrl, land, eligible, matchVia
 * } | null>}
 */
async function resolveMerchant(rawMerchant, bonCountry, items, { eigenmarke = true, fuzzy = true, nachsichtig = false, kopf = null } = {}) {
  const norm = normalize(rawMerchant);
  const all = await loadDiscounters();
  if (!all.length) return null;
  if (!norm && !Array.isArray(items) && !kopf) return null;

  let doc = null;
  let matchVia = null;
  let aliasId = null;

  // Ohne verwertbaren Namen keine Namensstufen (Prüfrunde 2, 04.10.2026): der
  // Tippfehler-Abgleich verglich einen LEEREN Namen mit „dm" (Abstand 2,
  // erlaubt 2) — jeder Beleg ohne gelesenen Händler, aber mit Artikeln, wurde
  // dm. Unter Prompt v1.5 traf das ehrliche Lidl-Plus-Screenshots ohne Logo.
  // Ein Name aus ein bis zwei Zeichen liegt von „dm" nie weiter als 2 weg —
  // der Tippfehler-Abgleich braucht deshalb mindestens drei. „DM" selbst
  // erkennt der Alias.
  const nameDa = nachsichtig || norm.length >= 2;
  const fuzzyDa = nachsichtig || (fuzzy !== false && norm.length >= 3);

  // 1) Alias
  const alias = nameDa ? aliasMatch(norm) : null;
  if (alias) {
    aliasId = alias.id;
    const candidates = discountersForAliasId(alias.id, all);
    doc = pickByCountry(candidates, bonCountry);
    if (doc) matchVia = 'alias';
  }

  // 1b) Gedruckte Umsatzsteuer-ID der Kette — nur ohne verwertbaren Namen
  //     (ein gelesener Name geht vor) und VOR dem Tippfehler-Abgleich, der
  //     einen leeren Namen sonst zu „dm" macht (Prüfrunde 3, 04.10.2026).
  if (!doc && !nameVerwertbar(rawMerchant) && kopf) {
    const kette = ketteAusUstId(kopf);
    if (kette) {
      // Eine DE-Umsatzsteuer-ID gehört zum deutschen Markt der Kette.
      const picked = pickByCountry(discountersForAliasId(kette, all), 'DE');
      if (picked) {
        doc = picked;
        aliasId = kette;
        matchVia = 'ust_id';
      }
    }
  }

  // 2) Fuzzy
  if (!doc && fuzzyDa) {
    const fuzzyDoc = fuzzyMatch(norm, all);
    if (fuzzyDoc) {
      doc = fuzzyDoc;
      matchVia = 'fuzzy';
    }
  }

  // 3) Substring
  if (!doc && nameDa) {
    const sub = substringMatch(norm, all);
    if (sub) {
      doc = sub;
      matchVia = 'substring';
    }
  }

  // 4) Eigenmarke auf dem Bon → Kette (selbstständige Kaufleute, deren
  //    Bonkopf die Kette nicht nennt). Nicht bei Online-Bestellungen (opts).
  if (!doc && eigenmarke !== false) {
    const chain = chainFromItems(items);
    if (chain) {
      const candidates = discountersForAliasId(chain.id, all);
      const picked = pickByCountry(candidates, bonCountry);
      if (picked) {
        doc = picked;
        aliasId = chain.id;
        matchVia = 'eigenmarke';
        logger.info('[merchant] über Eigenmarke erkannt', {
          raw: rawMerchant || null, chain: chain.id, hits: chain.hits,
        });
      }
    }
  }

  if (!doc) return null;

  // If we matched fuzzy/substring without considering country, but
  // there are sibling docs with different countries, re-pick by
  // bonCountry across the same canonical-name family. Cheap re-pick
  // by looking up siblings sharing the same nameNorm.
  // Nicht bei Stufe 1b: eine DE-Umsatzsteuer-ID legt das Land schon fest.
  if (matchVia !== 'alias' && matchVia !== 'ust_id' && bonCountry) {
    const siblings = all.filter((d) => d.nameNorm === doc.nameNorm);
    if (siblings.length > 1) {
      const better = pickByCountry(siblings, bonCountry);
      if (better) doc = better;
    }
  }

  const land = (doc.land || 'DE').toUpperCase();
  const baseName = doc.name;
  // Display: "LiDL (DE)" / "Penny (AT)" — country always rendered for
  // transparency. If land unknown, just the name.
  const displayName = land ? `${baseName} (${land})` : baseName;

  return {
    id: aliasId || normalize(baseName).replace(/\s+/g, '-'),
    // Echte Firestore-DocID aus der `discounter`-Sammlung (= dieselbe ID, auf
    // die produkte.discounter zeigt). Damit matcht das Bon-Matching den Markt
    // DIREKT per ID, ohne Slug↔ID-Brücke. (86ca0wbg7)
    discounterId: doc.docId || null,
    name: baseName,
    displayName,
    logoUrl: doc.bild || null,
    land,
    eligible: true,
    matchVia,
  };
}

module.exports = { resolveMerchant, normalize, nameVerwertbar, levenshtein, chainFromItems, aliasMatch, ketteAusUstId };
