'use strict';

/**
 * ═══ Eingelöste Punkte sind ein Zahlungsmittel (Prompt v1.6, 08.10.2026) ═══
 *
 * Prompt v1.6 Regel 17: PAYBACK-, dm-, DeutschlandCard- oder Bonuspunkte, die
 * beim Einkauf EINGELÖST werden, sind ein Zahlungsmittel wie Bargeld — keine
 * Artikelzeile, kein Rabatt; totalCents ist der Betrag VOR der Punkte-
 * verrechnung. Anlass (Messung 2, 268 Bons, LOW + v1.5): v1.5 las dm
 * „Eingelöste Punkte -380 = EUR -3,80" als Rabattzeile auf den ganzen Einkauf
 * (bon_mupp8gdg5lgyyz) — die Belegkette fand dafür keine Rabatt-Bezeichnung,
 * der Bon wurde abgelehnt; der Betrieb (v1.4) hatte die Punkte vom Preis eines
 * Artikels abgezogen.
 *
 * Damit eine Lesung, die sich nicht an Regel 17 hält und die Zeile doch
 * aufführt, den Abgleich nicht verbiegt, zählt eine NEGATIVE Zeile mit
 * „Punkte"/„Payback" im Namen oder in der wörtlichen Zeile unter v1.6 nicht
 * zur Summe der Items (lib/ocr.js reconcile, lib/belegart.js Artikelsumme) —
 * so, wie eine Zahlungszeile (BAR, EC) nie in der Summe steht. Folge:
 *   • Endbetrag VOR den Punkten (wie Regel 17 es verlangt) → der Abgleich geht
 *     ohne die Zeile auf, auch wenn das Modell sie als 'Warenkorbrabatt'
 *     kennzeichnet.
 *   • Endbetrag NACH den Punkten („zu zahlender Betrag") und Zeile in items →
 *     die Zeile deckt den Unterschied NICHT mehr; Σ Artikel liegt um die
 *     Punkte über dem Endbetrag — die Lesung widerspricht Regel 17 und gilt
 *     ab 51 ct Punkten als nicht abgeglichen (Überdeckung > 50 ct). Gewollt:
 *     ein Zahlungsmittel macht keine Überzahl von Artikeln glatt.
 * Positive Zeilen (ein Artikel mit „Punkte" im Namen) bleiben unberührt.
 *
 * Gilt NUR für Lesungen der Fassung v1.6 (auch deren Zweitprüfung
 * 'referee-v2+v1.6'). Für jede andere Fassung liefert abgleichOptionen {}:
 * Abgleich und Artikelsumme exakt wie vor dem 08.10.2026.
 */

const { basisVersion } = require('./prompt');

/** Fassungen, in denen eingelöste Punkte ein Zahlungsmittel sind (Regel 17). */
const PUNKTE_ALS_ZAHLUNG = new Set(['v1.6']);

// Bewusst eng: nur Punkte und PAYBACK. Rabatt-, Coupon- und Gutscheinzeilen
// tragen diese Wörter nicht; ein Payback-„Coupon" bringt Punkte, keinen Abzug.
const PUNKTE_RE = /punkte|payback/i;

/**
 * Negative Zeile, die eingelöste Punkte bezeichnet (Name oder raw).
 * @param {object} it  Item einer Lesung
 * @returns {boolean}
 */
function istPunkteZahlungZeile(it) {
  return Boolean(it)
    && Number.isFinite(it.priceCents)
    && it.priceCents < 0
    && PUNKTE_RE.test(`${typeof it.name === 'string' ? it.name : ''} ${typeof it.raw === 'string' ? it.raw : ''}`);
}

/**
 * Abgleich-Optionen zur Fassung einer Lesung (`ocr.promptVersion`, auch die
 * Fassung einer Zweitprüfungs-Lesung). Nur v1.6 → { punkteAlsZahlung: true };
 * sonst {} (kein Unterschied zum Stand vor dem 08.10.2026).
 * @param {*} promptVersion
 * @returns {{punkteAlsZahlung?: true}}
 */
function abgleichOptionen(promptVersion) {
  return PUNKTE_ALS_ZAHLUNG.has(basisVersion(promptVersion)) ? { punkteAlsZahlung: true } : {};
}

/**
 * Items ohne Punkte-Zahlungszeilen — nur mit `opts.punkteAlsZahlung === true`,
 * sonst DASSELBE Array (keine Kopie, kein Unterschied).
 * @param {Array} items
 * @param {{punkteAlsZahlung?: boolean}} [opts]
 * @returns {Array}
 */
function itemsOhnePunkteZahlung(items, opts) {
  if (!opts || opts.punkteAlsZahlung !== true || !Array.isArray(items)) return items;
  return items.filter((it) => !istPunkteZahlungZeile(it));
}

module.exports = { PUNKTE_ALS_ZAHLUNG, PUNKTE_RE, istPunkteZahlungZeile, abgleichOptionen, itemsOhnePunkteZahlung };
