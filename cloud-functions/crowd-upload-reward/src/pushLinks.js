'use strict';

/**
 * Das Tap-Ziel der Vergütungs-Nachricht — bewusst in einem eigenen Modul
 * OHNE firebase-admin, damit der Vertragstest der App es laden kann:
 * `lib/services/__tests__/pushDeepLinkVertrag.test.ts` prüft, dass der
 * Resolver genau diesen Pfad akzeptiert.
 *
 * WARUM DAS EIN EIGENES MODUL IST: Ein Deep-Link hat zwei Seiten. Vom
 * 19.08. bis 17.09.2026 schickte die Bon-Pipeline ein Schema, das der
 * Resolver nicht kannte — jeder Tap landete auf der Startseite, und niemand
 * merkte es, weil beide Seiten für sich betrachtet richtig aussahen. Seither
 * hängen Server-Link und Whitelist an einem Test statt an gutem Willen.
 *
 * Als PFAD schicken, nie als Schema (`markendetektive://…`).
 */

/** Liste der eigenen Produkt-Einreichungen (app/product-submit/index.tsx). */
const EINREICHUNGEN_LINK = '/product-submit';

module.exports = { EINREICHUNGEN_LINK };
