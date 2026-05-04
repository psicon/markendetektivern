/**
 * Merchant resolution — match the OCR'd merchant string from a bon
 * against the project's existing `discounter` collection.
 *
 * The discounter collection (already maintained in production) has
 * docs like: { name: 'REWE', land: 'DE', bild: 'https://…/rewe.png' }.
 * We treat each doc's `name` as the canonical brand and build a
 * regex from common aliases / stop-words so things like
 * "REWE XY GmbH", "*** PENNY-MARKT GMBH ***", "LiDL" all resolve.
 *
 * Cached per Cloud Function instance (5 minutes). Cold starts pull
 * 19 small docs — negligible.
 */

'use strict';

const admin = require('firebase-admin');
const { logger } = require('firebase-functions');

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache = { at: 0, list: null };

// Per-merchant alias hints. Keyed by lowercased canonical-name fragment.
// Each entry: { id, names[] (regex sources), reject? }
//
// Add to this list when you spot a real bon header that doesn't match.
// More aliases is always safer than fewer — false-positive matches are
// caught downstream by the reconciliation gate.
const ALIASES = [
  { id: 'rewe',          tokens: ['rewe'] },
  { id: 'lidl',          tokens: ['lidl'] },
  { id: 'aldi-sued',     tokens: ['aldi süd', 'aldi sued', 'aldi-süd'] },
  { id: 'aldi-nord',     tokens: ['aldi nord'] },
  { id: 'aldi',          tokens: ['aldi'] }, // fallback if neither S/N detected
  { id: 'edeka',         tokens: ['edeka', 'e center', 'e-center'] },
  { id: 'kaufland',      tokens: ['kaufland'] },
  { id: 'penny',         tokens: ['penny'] },
  { id: 'netto',         tokens: ['netto'] },
  { id: 'dm',            tokens: ['dm-drogerie', 'dm drogerie', 'dm filiale', /\bdm\b/] },
  { id: 'rossmann',      tokens: ['rossmann'] },
  { id: 'mueller',       tokens: ['müller', 'mueller'] },
  { id: 'norma',         tokens: ['norma'] },
  { id: 'globus',        tokens: ['globus'] },
  { id: 'hofer',         tokens: ['hofer'] },        // Aldi AT
  { id: 'spar',          tokens: ['spar', 'eurospar', 'interspar'] },
  { id: 'billa',         tokens: ['billa'] },
];

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
        land: String(data.land || 'DE'),
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
 * Find the canonical merchant for a raw OCR string.
 *
 * @param {string|null|undefined} rawMerchant
 * @returns {Promise<{ id, name, logoUrl, land, eligible } | null>}
 */
async function resolveMerchant(rawMerchant) {
  const norm = normalize(rawMerchant);
  if (!norm) return null;

  // 1) Walk the alias list in order. First match wins. We use the
  //    `id` to find the corresponding discounter doc by name (case-insensitive
  //    substring), so we get the official logo + canonical name.
  let match = null;
  for (const alias of ALIASES) {
    for (const t of alias.tokens) {
      const ok =
        t instanceof RegExp ? t.test(norm) : norm.includes(String(t).toLowerCase());
      if (ok) {
        match = alias;
        break;
      }
    }
    if (match) break;
  }
  if (!match) return null;

  // 2) Look up the discounter doc by id-friendly name match.
  // For ambiguous brands that exist in multiple countries (Lidl, dm,
  // Aldi, Spar) we prefer DE first so a German bon doesn't end up
  // with the Austrian / Swiss logo. land='DE' wins; if none found we
  // accept any land.
  const discounters = await loadDiscounters();
  const idTokens = match.id.split('-'); // e.g. 'aldi-sued' → ['aldi','sued']
  const candidates = discounters.filter((d) => {
    const dn = normalize(d.name);
    return idTokens.every(
      (tok) => dn.includes(tok) || (tok === 'sued' && dn.includes('süd')),
    );
  });
  const doc =
    candidates.find((d) => (d.land || '').toUpperCase() === 'DE') ??
    candidates[0] ??
    null;

  return {
    id: match.id,
    name: doc?.name || match.id.toUpperCase(),
    logoUrl: doc?.bild || null,
    land: doc?.land || 'DE',
    eligible: true,
  };
}

module.exports = { resolveMerchant, normalize };
