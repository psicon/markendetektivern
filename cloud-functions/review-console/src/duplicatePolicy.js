'use strict';

/**
 * Doppel-Regel für Produkt-Einreichungen (Produktentscheidung 05.09.2026).
 *
 * Ein Produkt = EAN. Referenz („prior") ist die jüngste FREIGEGEBENE Einreichung
 * desselben Produkts. Innerhalb von 30 Tagen nach dieser Referenz wird eine
 * neue Einreichung nur freigegeben, wenn sie ANDERE Daten liefert (Preis,
 * Hersteller oder Markt) — egal ob vom selben oder einem anderen Nutzer.
 * Sonst: Sperre (Grund je nach Nutzer). Liegt die Referenz noch in `pending`,
 * wird gehalten, bis die ältere entschieden ist.
 *
 * Reine Funktionen, keine Firestore-Abhängigkeit — der Aufrufer liefert die
 * Kandidaten. Die Bewertung nutzt den EINREICH-Zeitpunkt (createdAt), nicht
 * „jetzt": ein Doppel, das 5 Tage nach der Referenz eingereicht wurde, wird
 * nicht dadurch freigabefähig, dass die Prüfung erst Wochen später stattfindet.
 *
 * Fehlt ein Vergleichswert auf einer Seite, gilt er als GLEICH (fail-closed:
 * fehlende OCR-Daten sind kein Beleg für „andere Daten").
 */

const LOCK_DAYS = 30;
const LOCK_MS = LOCK_DAYS * 24 * 60 * 60 * 1000;

const REASON = Object.freeze({
  SAME_USER: 'sperre_30_tage_gleicher_nutzer',
  OTHER_USER: 'sperre_30_tage_anderer_nutzer',
  PENDING_OLDER: 'doppelt_eingereicht',
});

function ms(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function normText(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\b(gmbh|ag|se|kg|ohg|co|mbh|e\.?k\.?|&)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/** Hersteller gleich? Leichte OCR-Abweichungen (≤2 Edits) oder Enthaltensein zählen als gleich. */
function manufacturerEqual(a, b) {
  const x = normText(a), y = normText(b);
  if (!x || !y) return true; // fehlend = gleich (fail-closed)
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return levenshtein(x, y) <= 2;
}

function priceOf(u) {
  const p = u && (u.priceCents ?? u.priceOcr?.priceCents ?? u.priceOcrCents);
  return Number.isFinite(p) && p > 0 ? Math.round(p) : null;
}
function manufacturerOf(u) {
  return (u && (u.manufacturer ?? u.manufacturerOcr?.name ?? u.manufacturerOcr)) || null;
}

/**
 * Welche Daten unterscheiden sich zwischen Kandidat und Referenz?
 * @returns {{price:boolean, manufacturer:boolean, market:boolean, any:boolean, details:object}}
 */
function dataDiffers(candidate, prior) {
  const pc = priceOf(candidate), pp = priceOf(prior);
  const price = pc != null && pp != null && pc !== pp;
  const mc = manufacturerOf(candidate), mp = manufacturerOf(prior);
  const manufacturer = !!(mc && mp) && !manufacturerEqual(mc, mp);
  const market = !!(candidate?.marketId && prior?.marketId) && candidate.marketId !== prior.marketId;
  return {
    price, manufacturer, market, any: price || manufacturer || market,
    details: { price: [pp, pc], manufacturer: [mp, mc], market: [prior?.marketId ?? null, candidate?.marketId ?? null] },
  };
}

/**
 * @param {object} candidate  die zu prüfende Einreichung (mit id, userId, ean, marketId, createdAt, status)
 * @param {object[]} others   alle anderen Einreichungen mit derselben EAN (beliebiger Status)
 * @returns {{verdict:'ok'|'locked'|'hold', reason:string|null, priorId:string|null, priorUserId:string|null,
 *            sameUser:boolean|null, lockUntil:number|null, updatedFields:string[], diff:object|null}}
 */
function evaluateDuplicate(candidate, others) {
  const cid = candidate?.id ?? null;
  const cAt = ms(candidate?.createdAt) ?? Date.now();
  const list = (others || []).filter((o) => o && o.id !== cid);

  // Ältere, noch offene Einreichung desselben Produkts → erst die entscheiden.
  const pendingOlder = list
    .filter((o) => o.status === 'pending' && (ms(o.createdAt) ?? Infinity) < cAt)
    .sort((a, b) => (ms(a.createdAt) ?? 0) - (ms(b.createdAt) ?? 0));
  if (pendingOlder.length) {
    const p = pendingOlder[0];
    return { verdict: 'hold', reason: REASON.PENDING_OLDER, priorId: p.id, priorUserId: p.userId ?? null, sameUser: p.userId === candidate.userId, lockUntil: null, updatedFields: [], diff: null };
  }

  const approved = list
    .filter((o) => o.status === 'approved' && (ms(o.createdAt) ?? 0) <= cAt)
    .sort((a, b) => (ms(b.createdAt) ?? 0) - (ms(a.createdAt) ?? 0));
  const prior = approved[0];
  if (!prior) return { verdict: 'ok', reason: null, priorId: null, priorUserId: null, sameUser: null, lockUntil: null, updatedFields: [], diff: null };

  const pAt = ms(prior.createdAt) ?? 0;
  const lockUntil = pAt + LOCK_MS;
  const sameUser = prior.userId === candidate.userId;
  const diff = dataDiffers(candidate, prior);
  const updatedFields = ['price', 'manufacturer', 'market'].filter((k) => diff[k]);

  if (cAt >= lockUntil) {
    return { verdict: 'ok', reason: null, priorId: prior.id, priorUserId: prior.userId ?? null, sameUser, lockUntil, updatedFields, diff: diff.details };
  }
  if (diff.any) {
    return { verdict: 'ok', reason: null, priorId: prior.id, priorUserId: prior.userId ?? null, sameUser, lockUntil, updatedFields, diff: diff.details };
  }
  return {
    verdict: 'locked',
    reason: sameUser ? REASON.SAME_USER : REASON.OTHER_USER,
    priorId: prior.id, priorUserId: prior.userId ?? null, sameUser, lockUntil, updatedFields: [], diff: diff.details,
  };
}

/** Vollständigkeits-Vorprüfung (dieselben Regeln wie die manuellen Freigabe-Runden 08/2026). */
function completenessCheck(u, requiredSteps) {
  const problems = [];
  const images = (u && u.images) || {};
  const missing = (requiredSteps || []).filter((s) => !images[s]);
  if (missing.length) problems.push('unvollstaendig');
  const ean = String((u && u.ean) || '').replace(/\D/g, '');
  if (!(ean.length >= 8 && ean.length <= 14)) problems.push('ean_fehlt');
  if (!String((u && (u.productName || u.productNameOcr)) || '').trim()) problems.push('kein_produktname');
  return { ok: problems.length === 0, problems, missing };
}

module.exports = { LOCK_DAYS, LOCK_MS, REASON, evaluateDuplicate, dataDiffers, manufacturerEqual, completenessCheck, normText, ms };
