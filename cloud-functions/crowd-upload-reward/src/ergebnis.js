'use strict';

/**
 * Das Ergebnis-Feldset einer Freigabe (86cbet2ry).
 *
 * ZIEL-INVARIANTE — nach jedem Lauf gilt:
 *   status === 'approved' && !rewardResult   ==>   echter Fehler
 *
 * Vorher galt sie nicht: zwei frühe Ausstiege (`!uid`, `!cid`) und der
 * `already_booked`-Zweig ließen das Dokument ohne jede Spur zurück. Eine
 * Freigabe ohne Buchung war dann nur durch einen Abgleich gegen das Ledger
 * zu finden — genau das Muster, das zu „144 freigegeben, 0 Cent ausgezahlt"
 * geführt hat.
 *
 * WARUM NICHT `rewardSkipped` ALS SAMMELFLAG: die ausgelieferte App liest
 * genau dieses Feld und leitet daraus EINEN festen Satz ab — „Für eine
 * Vergütung braucht die Aktion beim nächsten Mal deinen Standort im
 * Orts-Schritt" (lib/utils/productSubmissionCopy.ts:80). In Produktion trägt
 * es ausschließlich `no_location`. Würde es künftig auch bei erreichtem
 * Nutzerdeckel gesetzt, bekämen Menschen, die ihren Standort geliefert haben,
 * eine falsche Erklärung — und zwar auf jedem Gerät, das die neue App noch
 * nicht hat. `rewardSkipped` bleibt deshalb der Ortsregel vorbehalten;
 * getragen wird die Invariante von `rewardResult`, das jeder Pfad schreibt.
 *
 * FieldValue wird übergeben, damit die Funktion ohne firebase-admin testbar
 * ist.
 */
function ergebnisFelder(FieldValue, { result, reason = null, cents = 0, extra = null }) {
  const gebucht = result === 'credited';
  const felder = {
    rewardResult: result, // 'credited' | 'not_credited'
    rewardCents: gebucht ? cents : 0,
    rewardNotCreditedReason: gebucht ? FieldValue.delete() : reason,
    rewardCheckedAt: FieldValue.serverTimestamp(),
  };
  // Eine erfolgreiche Nachbuchung räumt einen alten Skip-Vermerk weg. Ohne das
  // trüge ein Dokument nach „ablehnen → zurückholen → freigeben" gleichzeitig
  // `rewardCents: 12` und `rewardSkipped: true` — und die App zeigte dem
  // Nutzer den Standort-Hinweis, obwohl das Geld längst gebucht ist.
  if (gebucht) {
    felder.rewardSkipped = FieldValue.delete();
    felder.rewardSkippedReason = FieldValue.delete();
  }
  return extra ? { ...felder, ...extra } : felder;
}

module.exports = { ergebnisFelder };
