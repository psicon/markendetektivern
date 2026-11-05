'use strict';

/**
 * Deep-Links in Push-Nachrichten — der Vertrag mit der App.
 *
 * ═══ Warum ein eigenes Modul ═══
 *
 * Vom 19.08. bis 17.09.2026 schickte `sendCashbackReady` den Link
 * `markendetektivern://cashback/pending/<id>` (mit „rn"). Die App entfernt in
 * `lib/services/pushDeepLinks.ts` aber nur das Präfix `markendetektive://`
 * (ohne „rn"), machte daraus `/markendetektivern://cashback/…`, fand dafür
 * keine erlaubte Route und schickte jeden Tap auf die Startseite. Der Tap-Fix
 * 86cb7gfc9 hat das Antippen korrekt verdrahtet — nur kam nie ein Link an, den
 * die App versteht, und niemand hat den Weg von Anfang bis Ende geprüft.
 *
 * Deshalb steht der Link hier als eine Funktion, gegen die ein Test der App
 * (`lib/services/__tests__/pushDeepLinkVertrag.test.ts`) den Resolver laufen
 * lässt. Ändert jemand eine Seite, schlägt dieser Test fehl.
 *
 * ═══ Warum ein Pfad und kein Schema ═══
 *
 * `/cashback/pending/<id>` versteht JEDE App-Version, die überhaupt Taps
 * auswertet (ab 6.0.16): der Resolver lässt Pfade mit erlaubtem Stamm
 * unverändert durch. Ein Schema-Präfix wäre nur ein zusätzlicher Weg, falsch
 * zu parsen.
 */

/** Detailseite eines Bons in der App (`app/cashback/pending/[id].tsx`). */
function bonDeepLink(cashbackId) {
  return `/cashback/pending/${encodeURIComponent(String(cashbackId))}`;
}

module.exports = { bonDeepLink };
