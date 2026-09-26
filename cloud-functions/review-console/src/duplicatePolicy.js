'use strict';

/**
 * Doppel-Regel für Produkt-Einreichungen (Produktentscheidung 05.09.2026).
 *
 * Ein Produkt = EAN. Referenz („prior") ist die jüngste FREIGEGEBENE Einreichung
 * desselben Produkts.
 *
 * GRÜNDERENTSCHEIDUNG 20.09.2026 — die Sperre gilt NUR NOCH GEGEN SICH SELBST:
 * Was ein ANDERER Nutzer eingereicht hat, sperrt niemanden mehr. Wer im Laden
 * steht und fotografiert, kann nicht wissen, ob jemand anderes dasselbe Produkt
 * schon erfasst hat — die Ablehnung traf also immer die Falschen und hat aktive
 * Nutzer gekostet. Ziel ist mehr Scannen und mehr Fotografieren.
 *
 * Gegen den SELBEN Nutzer greift die Sperre weiterhin, aber nur für
 * versehentliche Doppel kurz hintereinander (SAME_USER_LOCK_MS, 24 h) — und
 * auch dann nur, wenn die Einreichung KEINE anderen Daten liefert (Preis,
 * Hersteller oder Markt). Eine echte neue Erfassung Wochen später zählt wieder.
 *
 * Liegt eine ÄLTERE eigene Einreichung noch in `pending`, wird gehalten, bis
 * sie entschieden ist (sonst zahlt ein Doppel zweimal). Fremde Pendings halten
 * nichts mehr auf.
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
// Fenster für versehentliche Doppel desselben Nutzers (z. B. zweimal auf
// „Senden" getippt). Alles darüber ist neue Arbeit und wird vergütet.
const SAME_USER_LOCK_MS = 24 * 60 * 60 * 1000;

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

// NUR server-geschriebene Felder als Vergleichswerte — der Aufrufer liefert sie
// über src/werte.js policyOf: Preis vom Namer (`priceOcr`) oder nachgelesen
// (`priceRescueOcr`), Hersteller NUR vom Namer. Beide sind per firestore.rules
// beim Anlegen gesperrt (seit 26.09.2026). Top-Level `priceCents`/
// `manufacturer` wären vom Client frei wählbar — ein Nutzer könnte sich sonst
// durch einen erfundenen Preis aus der Sperre schreiben.
function priceOf(u) {
  const p = u && u.priceOcr && u.priceOcr.priceCents;
  return Number.isFinite(p) && p > 0 ? Math.round(p) : null;
}
function manufacturerOf(u) {
  const m = u && u.manufacturerOcr;
  const name = m && typeof m === 'object' ? m.name : null;
  return (typeof name === 'string' && name.trim()) || null;
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
 *
 * Das Fenster ist SYMMETRISCH (|Kandidat − Referenz| < 30 Tage) und prüft
 * JEDE Freigabe darin, nicht nur die jüngste:
 *  - Backlog-Reihenfolge: wird ein älterer Bon erst nach einem jüngeren
 *    entschieden, ist der jüngere trotzdem eine Referenz — sonst rutscht ein
 *    identisches Doppel durch, nur weil es zuerst eingereicht wurde.
 *  - Mehrere Freigaben: es genügt EINE, zu der es keine anderen Daten gibt →
 *    Sperre. Sonst schriebe sich ein Nutzer über eine zwischenzeitlich
 *    freigegebene Preisänderung an seiner eigenen identischen Wiederholung
 *    vorbei.
 */
function evaluateDuplicate(candidate, others) {
  const cid = candidate?.id ?? null;
  const cAt = ms(candidate?.createdAt) ?? Date.now();
  const list = (others || []).filter((o) => o && o.id !== cid);

  // Ältere, noch offene Einreichung desselben Produkts → erst die entscheiden.
  const pendingOlder = list
    .filter((o) => o.status === 'pending' && o.userId === candidate.userId && (ms(o.createdAt) ?? Infinity) < cAt)
    .sort((a, b) => (ms(a.createdAt) ?? 0) - (ms(b.createdAt) ?? 0));
  if (pendingOlder.length) {
    const p = pendingOlder[0];
    return { verdict: 'hold', reason: REASON.PENDING_OLDER, priorId: p.id, priorUserId: p.userId ?? null, sameUser: p.userId === candidate.userId, lockUntil: null, updatedFields: [], diff: null };
  }

  // Alle Freigaben im 30-Tage-Fenster um den Kandidaten herum, jüngste zuerst.
  // NUR EIGENE Freigaben sperren, und nur binnen 24 h (versehentliche Doppel).
  const inWindow = list
    .filter(
      (o) =>
        o.status === 'approved'
        && o.userId === candidate.userId
        && Math.abs((ms(o.createdAt) ?? 0) - cAt) < SAME_USER_LOCK_MS,
    )
    .sort((a, b) => (ms(b.createdAt) ?? 0) - (ms(a.createdAt) ?? 0));
  if (!inWindow.length) {
    // Referenz außerhalb des Fensters nur zur Information (priorId), nie sperrend.
    const older = list
      .filter((o) => o.status === 'approved')
      .sort((a, b) => (ms(b.createdAt) ?? 0) - (ms(a.createdAt) ?? 0))[0];
    return {
      verdict: 'ok', reason: null,
      priorId: older ? older.id : null, priorUserId: older ? older.userId ?? null : null,
      sameUser: older ? older.userId === candidate.userId : null,
      lockUntil: older ? (ms(older.createdAt) ?? 0) + LOCK_MS : null,
      updatedFields: older ? ['price', 'manufacturer', 'market'].filter((k) => dataDiffers(candidate, older)[k]) : [],
      diff: older ? dataDiffers(candidate, older).details : null,
    };
  }

  // Sperrend ist die JÜNGSTE Referenz ohne andere Daten (deren Frist gilt).
  const blocking = inWindow.find((p) => !dataDiffers(candidate, p).any);
  const ref = blocking || inWindow[0];
  const pAt = ms(ref.createdAt) ?? 0;
  const lockUntil = pAt + SAME_USER_LOCK_MS;
  const sameUser = ref.userId === candidate.userId;
  const diff = dataDiffers(candidate, ref);
  const updatedFields = ['price', 'manufacturer', 'market'].filter((k) => diff[k]);
  const base = { priorId: ref.id, priorUserId: ref.userId ?? null, sameUser, lockUntil, diff: diff.details };

  if (!blocking) return { verdict: 'ok', reason: null, updatedFields, ...base };
  // `sameUser` ist hier immer true (das Fenster filtert fremde Einreichungen
  // heraus). REASON.OTHER_USER bleibt nur für Altbestand im Export erhalten.
  return { verdict: 'locked', reason: REASON.SAME_USER, updatedFields: [], ...base };
}

/**
 * Doppel-Befund zum Speichern am Dokument (`review.precheck.dup`) — dieselbe
 * Form für Morgenrunde und Prüfkonsole. Ohne ihn fehlt beim Zurückholen einer
 * Sperr-Ablehnung die Referenz („Früher/Anders").
 *
 * Bewusst OHNE `priorUserId` und `diff`: der Einreicher darf sein Dokument
 * lesen (firestore.rules), und die Referenz kann einem anderen Nutzer gehören —
 * dessen uid, Preis und Markt gehören nicht in fremde Dokumente.
 */
function dupZumSpeichern(dup) {
  if (!dup) return null;
  return {
    verdict: dup.verdict ?? 'ok', reason: dup.reason ?? null, priorId: dup.priorId ?? null,
    sameUser: dup.sameUser ?? null, lockUntil: dup.lockUntil ?? null,
    updatedFields: Array.isArray(dup.updatedFields) ? dup.updatedFields : [],
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

module.exports = { LOCK_DAYS, LOCK_MS, SAME_USER_LOCK_MS, REASON, evaluateDuplicate, dataDiffers, manufacturerEqual, completenessCheck, dupZumSpeichern, normText, ms };
