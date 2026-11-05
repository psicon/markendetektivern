'use strict';

/**
 * Server-Rückfall für Einreichungen ohne Aktionskennzeichen (86cbet2nw).
 *
 * Der Client löst die laufende Aktion einmal beim Öffnen des Wizards auf. Jeder
 * Fehlschlag dieses einen Versuchs ist im Ergebnis von „es läuft keine Aktion"
 * nicht zu unterscheiden — der Wert `null` wird dann in den Auftrag eingefroren
 * und landet so im Dokument. Der Client-Fix behebt das, erreicht die Geräte im
 * Feld aber erst über Wochen (Android-Rollout). Bis dahin — und als dauerhafte
 * zweite Linie — löst der Server die Aktion selbst auf.
 *
 * ENTSCHEIDEND: maßgeblich ist der ZEITPUNKT DER AUFNAHME, nicht „jetzt" und
 * auch nicht der Moment, in dem die Warteschlange das Dokument schreibt. Eine
 * offline erfasste Einreichung kann Tage später hochgeladen werden (gemessen:
 * bis 68 Stunden) — und offline ist zugleich der häufigste Grund, warum der
 * Client die Aktion nicht auflösen konnte. Beide Populationen fallen also
 * zusammen. Lief zur Aufnahmezeit keine Aktion, bleibt es dabei: dann wurde dem
 * Menschen auch nichts versprochen.
 *
 * Die Auswahl folgt denselben Regeln wie überall sonst im Projekt: `active`
 * muss gelten, ein `deactivatedAt` schließt nur aus, wenn es VOR der Aufnahme
 * lag (so rechnet auch die Bon-Pipeline), und eine Aktion ohne Restbudget wird
 * gar nicht erst gewählt — sonst würde ein Nicht-Ergebnis als Treffer verbucht
 * und der Mensch ginge leer aus, obwohl daneben eine echte Aktion läuft.
 */

const ms = (v) => {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return null;
};

/**
 * Alle Aktionen, die zur Aufnahmezeit galten — beste zuerst.
 *
 * @param {Array} kampagnen      ALLE Aktionen (der Aufrufer lädt sie).
 * @param {number} aufnahmeAt    Zeitpunkt der Aufnahme in ms.
 * @returns {Array} passende Aktionen in der Reihenfolge, in der sie versucht
 *   werden sollen.
 */
function kandidatenZurAufnahmezeit(kampagnen, aufnahmeAt) {
  if (!Number.isFinite(aufnahmeAt)) return [];

  const passend = (Array.isArray(kampagnen) ? kampagnen : []).filter((c) => {
    if (!c || (c.kind ?? 'receipt') !== 'product_photos') return false;
    if (!(Number(c.cashbackPerBonCents) > 0)) return false;
    if (c.active === false) return false;
    // Ein Zeitfenster ist Pflicht: ohne Grenzen ist nicht entscheidbar, ob die
    // Aktion zur Aufnahmezeit galt.
    const start = ms(c.startAt);
    const end = ms(c.endAt);
    if (start == null || end == null) return false;
    if (aufnahmeAt < start || aufnahmeAt > end) return false;
    // Nachträglich gestoppt: nur ausschließen, wenn der Stopp VOR der Aufnahme
    // lag — genauso rechnet die Bon-Pipeline.
    const gestoppt = ms(c.deactivatedAt);
    if (gestoppt != null && aufnahmeAt > gestoppt) return false;
    // Kein Restbudget heißt: hier ist nichts zu holen. Eine solche Aktion zu
    // wählen hieße, den Vorgang mit „Budget erschöpft" abzuschließen, obwohl
    // daneben eine zahlende Aktion läuft.
    const rest = Number(c.budgetRemainingCents);
    if (Number.isFinite(rest) && rest <= 0) return false;
    return true;
  });

  passend.sort((a, b) => {
    // NIEDRIGSTE Vergütung zuerst — dieselbe Voreinstellung wie im Client
    // (`guenstigsteAktion` in lib/services/productCampaignPick.ts,
    // User-Vorgabe 09.09.2026).
    //
    // Bis dahin stand hier das früheste Enddatum vorn und die HÖHERE Vergütung
    // als Gleichstand-Entscheid. Die Begründung dafür war, dass der
    // Einspringer nicht weniger zahlen soll als die App in Aussicht gestellt
    // hat. Genau die kehrt sich jetzt um: die App stellt ab sofort die
    // günstigste Aktion in Aussicht, also wäre die teurere hier MEHR als
    // versprochen. Beide Seiten müssen dieselbe Wahl treffen, sonst bucht der
    // Server etwas anderes, als der Mensch auf dem Bildschirm gesehen hat.
    const ba = Number(a.cashbackPerBonCents) || 0;
    const bb = Number(b.cashbackPerBonCents) || 0;
    if (ba !== bb) return ba - bb;
    // Bei gleichem Betrag die frühere Frist zuerst — wie bisher, damit die
    // Reihenfolge nicht von der Sortierung der Datenbankabfrage abhängt.
    return ms(a.endAt) - ms(b.endAt);
  });

  return passend;
}

/** Bequemer Einzeltreffer — für Aufrufer, die nur die beste Aktion brauchen. */
function campaignZurAufnahmezeit(kampagnen, aufnahmeAt) {
  if (!Number.isFinite(aufnahmeAt)) return { campaignId: null, grund: 'kein_aufnahmedatum' };
  const liste = kandidatenZurAufnahmezeit(kampagnen, aufnahmeAt);
  if (!liste.length) return { campaignId: null, grund: 'keine_aktion_zur_aufnahmezeit' };
  return { campaignId: liste[0].id, grund: 'server_fallback' };
}

module.exports = { kandidatenZurAufnahmezeit, campaignZurAufnahmezeit, ms };
