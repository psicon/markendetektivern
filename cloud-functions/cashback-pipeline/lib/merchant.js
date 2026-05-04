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
  { id: 'rewe',      tokens: ['rewe'] },
  { id: 'lidl',      tokens: ['lidl'] },
  { id: 'aldi-sued', tokens: ['aldi süd', 'aldi sued', 'aldi-süd', 'aldisued'] },
  { id: 'aldi-nord', tokens: ['aldi nord'] },
  { id: 'aldi',      tokens: ['aldi'] },
  { id: 'edeka',     tokens: ['edeka', 'e center', 'e-center', 'e neukauf'] },
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

// ─── Helpers ─────────────────────────────────────────────────────

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
 * @returns {Promise<{
 *   id, name, displayName, logoUrl, land, eligible, matchVia
 * } | null>}
 */
async function resolveMerchant(rawMerchant, bonCountry) {
  const norm = normalize(rawMerchant);
  if (!norm) return null;

  const all = await loadDiscounters();
  if (!all.length) return null;

  let doc = null;
  let matchVia = null;
  let aliasId = null;

  // 1) Alias
  const alias = aliasMatch(norm);
  if (alias) {
    aliasId = alias.id;
    const candidates = discountersForAliasId(alias.id, all);
    doc = pickByCountry(candidates, bonCountry);
    if (doc) matchVia = 'alias';
  }

  // 2) Fuzzy
  if (!doc) {
    const fuzzy = fuzzyMatch(norm, all);
    if (fuzzy) {
      doc = fuzzy;
      matchVia = 'fuzzy';
    }
  }

  // 3) Substring
  if (!doc) {
    const sub = substringMatch(norm, all);
    if (sub) {
      doc = sub;
      matchVia = 'substring';
    }
  }

  if (!doc) return null;

  // If we matched fuzzy/substring without considering country, but
  // there are sibling docs with different countries, re-pick by
  // bonCountry across the same canonical-name family. Cheap re-pick
  // by looking up siblings sharing the same nameNorm.
  if (matchVia !== 'alias' && bonCountry) {
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
    name: baseName,
    displayName,
    logoUrl: doc.bild || null,
    land,
    eligible: true,
    matchVia,
  };
}

module.exports = { resolveMerchant, normalize, levenshtein };
