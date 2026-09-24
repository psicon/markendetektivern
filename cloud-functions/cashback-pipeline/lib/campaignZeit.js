'use strict';
/**
 * Welche Bon-Aktion galt zu einem Zeitpunkt? (Gegenprüfung 24.09.2026)
 *
 * Anlass: Monatswechsel. Die App merkt sich die gewählte Aktion beim Öffnen
 * der Bon-Erfassung (und hält die Aktionsliste bis zu 5 Minuten im Speicher).
 * Wer um 23:58 am letzten Tag des Monats startet und um 00:01 absendet,
 * schickt die September-Aktion mit — deren Zeitraum ist beim Eingang aber
 * vorbei. Ohne Ausweichen endete das als `no_active_campaign`, obwohl die
 * Oktober-Aktion lief. Dieselbe Klasse wie bei den Produktfotos
 * (crowd-upload-reward/src/campaignFallback.js), gleiche Regeln:
 *  - `active` muss gelten; ein `deactivatedAt` schließt nur aus, wenn der
 *    Stopp VOR dem Zeitpunkt lag,
 *  - Zeitfenster ist Pflicht (ohne Grenzen nicht entscheidbar),
 *  - keine Aktion ohne Restbudget (sonst wäre ein Nicht-Ergebnis ein Treffer),
 *  - bei mehreren: frühestes Ende zuerst (wie die App-Liste), dann ID.
 * Reine Funktion; der Aufrufer lädt die Aktionen.
 */

const ms = (v) => {
  if (v == null) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  return null;
};

/**
 * @param {Array<object>} kampagnen  alle Aktionen (mit id)
 * @param {number} zeitpunkt        ms
 * @param {string} kind             'receipt' | 'product_photos'
 * @returns {object|null}
 */
function aktionZumZeitpunkt(kampagnen, zeitpunkt, kind = 'receipt') {
  if (!Number.isFinite(zeitpunkt)) return null;
  const passend = (Array.isArray(kampagnen) ? kampagnen : []).filter((c) => {
    if (!c || (c.kind ?? 'receipt') !== kind) return false;
    if (c.active === false) return false;
    const start = ms(c.startAt);
    const ende = ms(c.endAt);
    if (start == null || ende == null) return false;
    if (zeitpunkt < start || zeitpunkt > ende) return false;
    const gestoppt = ms(c.deactivatedAt);
    if (gestoppt != null && zeitpunkt > gestoppt) return false;
    if (c.budgetRemainingCents != null && !(Number(c.budgetRemainingCents) > 0)) return false;
    return true;
  });
  passend.sort((a, b) => (ms(a.endAt) - ms(b.endAt)) || String(a.id).localeCompare(String(b.id)));
  return passend[0] || null;
}

/**
 * Welche Aktion gilt für einen Bon im Prüf-Resolver? Die vom SERVER
 * angewandte (`campaignIdAngewandt`, geschrieben von processCashback nach
 * Monatswechsel- und Regionskorrektur), sonst die in der App gewählte.
 * Ohne das buchte eine Freigabe in der Prüfkonsole einen umgeleiteten Bon
 * gegen die abgelaufene Aktion — bei leerem Budget 0 ct / 409 (Hinweis
 * APP_ORIGINAL 24.09.). `null` ist eine gültige Antwort des Servers („keine
 * Aktion passt"), nur ein FEHLENDES Feld (Altbestand) fällt auf die Wahl der App zurück.
 */
function wirksameAktionId(receipt) {
  if (!receipt) return null;
  if (Object.prototype.hasOwnProperty.call(receipt, 'campaignIdAngewandt')) return receipt.campaignIdAngewandt || null;
  return receipt.campaignId || null;
}

module.exports = { aktionZumZeitpunkt, wirksameAktionId };
