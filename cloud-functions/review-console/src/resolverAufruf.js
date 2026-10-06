'use strict';
/**
 * Der eine Weg zum Bon-Resolver (cashback-pipeline/resolveCashbackReview) —
 * für die Prüfkonsole (reviewDecideReceipt) und die Bon-Runde. Der Resolver
 * rechnet Deckel und Budget in der Ledger-Transaktion; hier wird nur gefragt.
 * Schlüssel NUR im Header: Query-Parameter landen in den Cloud-Run-Logs.
 */
const RESOLVER_URL = process.env.CASHBACK_RESOLVER_URL || 'https://europe-west3-markendetektive-895f7.cloudfunctions.net/resolveCashbackReview';
const REJECT_REASONS = new Set(['manual_review_rejected', 'duplicate_content_self', 'duplicate_content_cross_user']);
const NO_REWARD_REASONS = new Set(['daily_cap_reached', 'weekly_cap_reached', 'per_user_cap_reached']);

function gueltig(decision, reason) {
  return decision === 'approve'
    || (decision === 'reject' && (!reason || REJECT_REASONS.has(reason)))
    || (decision === 'no_reward' && NO_REWARD_REASONS.has(reason));
}

/**
 * @param {object} o
 * @param {number|null} [o.doppelStand]  `doppelPruefung.at` (ms), wie ihn der
 *        Mensch in der Prüfkonsole sah. Nur damit quittiert eine Freigabe die
 *        Treffer der Prüfregeln aus der Zeile „Doppel-Prüfung" (vierte
 *        Prüfrunde 06.10.2026, cashback-pipeline/lib/doppelBon
 *        quittierteTreffer). Die Bon-Runde schickt ihn nie.
 */
async function resolverAufruf({ receiptId, decision, reason = '', duplicateOf = null, priorStatus = null, doppelStand = null, schluessel }) {
  if (!gueltig(decision, reason)) return { ok: false, http: 0, code: 'ungueltige_entscheidung' };
  if (!schluessel) return { ok: false, http: 0, code: 'kein_schluessel' };
  const url = new URL(RESOLVER_URL);
  url.searchParams.set('receiptId', receiptId);
  url.searchParams.set('decision', decision);
  if (reason) url.searchParams.set('reason', reason);
  if (duplicateOf) url.searchParams.set('duplicateOf', String(duplicateOf));
  if (priorStatus) url.searchParams.set('priorStatus', String(priorStatus));
  const stand = doppelStand == null || doppelStand === '' ? NaN : Number(doppelStand);
  if (decision === 'approve' && Number.isFinite(stand)) url.searchParams.set('doppelStand', String(stand));
  let res;
  try {
    res = await fetch(url.toString(), { method: 'POST', headers: { 'x-admin-key': schluessel }, signal: AbortSignal.timeout(75000) });
  } catch (e) {
    // 75 s > Laufzeitgrenze des Resolvers (60 s): läuft der Aufruf trotzdem ab,
    // kann der Resolver schon gebucht haben — Aufrufer müssen nachlesen.
    return { ok: false, http: 0, code: 'netzwerk', message: String(e.message || e).slice(0, 160) };
  }
  // Auch das Lesen der Antwort kann abbrechen (Zeitlimit mitten im Body) —
  // dann ist unklar, ob gebucht wurde: wie ein Netzfehler behandeln, damit der
  // Aufrufer nachliest.
  let text;
  try { text = await res.text(); } catch (e) {
    return { ok: false, http: res.status, code: 'netzwerk', message: String(e.message || e).slice(0, 160) };
  }
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 400) }; }
  return { ok: res.ok, http: res.status, ...body };
}

module.exports = { resolverAufruf, gueltig, REJECT_REASONS, NO_REWARD_REASONS };
