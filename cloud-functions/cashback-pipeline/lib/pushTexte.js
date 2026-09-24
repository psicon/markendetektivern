'use strict';

/**
 * „Ka-ching!"-Texte der Bon-Nachricht (Entscheidung Patrick, 24.09.2026).
 *
 * Nach drei Runden festgelegt: Das GELD gehört in die Überschrift, mit
 * „Ka-ching" und Emoji — das ist, was motiviert. Abgelehnt wurden sachliche
 * Zeilen wie „Dein Guthaben wächst" und reine Markenwitze ohne Betrag.
 * Die Detektiv-Sprache steht in der zweiten Zeile.
 *
 * Reine Funktionen ohne firebase-admin, damit sie ohne Firestore testbar sind.
 *
 * ⚠ Die Produktfoto-Nachricht in cloud-functions/crowd-upload-reward/src/push.js
 * nutzt dieselbe Form (`betragText`, `auszahlbarGeworden`, Titelaufbau). Die
 * Codebases teilen keinen Code — ändert sich der Ton, BEIDE nachziehen.
 */

/** Auszahlungsschwelle, falls die Konfiguration keine liefert. */
const SCHWELLE_STANDARD = 1000;

/** Marktnamen darüber passen nicht mehr sauber in die zweite Zeile. */
const MARKT_MAX_ZEICHEN = 24;

/** „8" → „0,08 €" — deutsche Schreibweise wie überall in der App (CLAUDE.md). */
function betragText(cents) {
  const zahl = Number(cents) || 0;
  return `${(zahl / 100).toFixed(2).replace('.', ',')} €`;
}

/**
 * Hat genau diese Gutschrift das Guthaben über die Auszahlungsschwelle
 * gehoben? Nur dann kommt der Zahltag-Text — wer schon vorher darüber lag,
 * bekäme sonst bei jeder weiteren Gutschrift erneut „jetzt auszahlbar".
 *
 * Das Guthaben stammt aus dem Nutzerdokument zum Sendezeitpunkt, also nach
 * der Buchung. Liegt dazwischen eine Auszahlung oder eine zweite Gutschrift,
 * kann der Vergleich danebenliegen — dann kommt der normale Text statt des
 * Zahltags oder umgekehrt. Beides ist harmlos; eine Lesung in der
 * Buchungs-Transaktion wäre ein Eingriff in den Geldpfad nur für einen Text.
 */
function auszahlbarGeworden(guthabenNachher, cents, schwelle) {
  const nachher = Number(guthabenNachher);
  const betrag = Number(cents);
  const grenze = Number(schwelle);
  if (!Number.isFinite(nachher) || !Number.isFinite(betrag) || !(grenze > 0)) return false;
  const vorher = nachher - betrag;
  return vorher < grenze && nachher >= grenze;
}

/** Marktname für „Dein Bon von …" — oder null, wenn er fehlt oder zu lang ist. */
function marktFuerText(markt) {
  const name = typeof markt === 'string' ? markt.trim() : '';
  if (!name || [...name].length > MARKT_MAX_ZEICHEN) return null;
  return name;
}

/**
 * Titel und Text der Bon-Nachricht.
 *
 * „Dein Bon von Lidl" statt „Dein Lidl-Bon": die zweite Form wird bei Namen
 * wie „Netto Marken-Discount" oder „EDEKA Center" hässlich, die erste passt
 * zu jedem Namen.
 *
 * @param {object} p
 * @param {number} p.cents              gutgeschriebener Betrag, > 0
 * @param {string} [p.markt]            Marktname vom Bon
 * @param {number} [p.guthabenNachher]  Guthaben nach der Buchung, in Cent
 * @param {number} [p.schwelle]         Auszahlungsschwelle in Cent
 */
function bonNachricht({ cents, markt, guthabenNachher, schwelle }) {
  const grenze = Number(schwelle) > 0 ? Number(schwelle) : SCHWELLE_STANDARD;
  const name = marktFuerText(markt);
  const bon = name ? `Dein Bon von ${name}` : 'Dein Bon';

  if (auszahlbarGeworden(guthabenNachher, cents, grenze)) {
    return {
      title: `Ka-ching! 🎉 ${betragText(guthabenNachher)} zum Auszahlen`,
      body: `${bon} ist geprüft – dein Guthaben kannst du dir jetzt auszahlen lassen.`,
    };
  }
  return {
    title: `Ka-ching! 💰 +${betragText(cents)} für dich`,
    body: `${bon} ist geprüft. Weiter so, Spürnase!`,
  };
}

module.exports = { bonNachricht, betragText, auszahlbarGeworden, SCHWELLE_STANDARD };
