'use strict';

/**
 * Darf dieser Nutzer eine Push-Nachricht bekommen?
 *
 * ⚠ KOPIE von cloud-functions/cashback-pipeline/lib/pushPolicy.js.
 * Die Codebases teilen keinen Code — bei Änderungen BEIDE nachziehen.
 * Gleiche Drift-Falle wie `extractEans` und `targeting.js` (CLAUDE.md).
 *
 * Die ausführliche Begründung steht im Original. Kurz: die App hat seit
 * Mai 2026 einen Schalter „Alle Benachrichtigungen", der
 * `pushNotificationsEnabled: false` schreibt — und das Feld wurde bis
 * 08.09.2026 nirgends gelesen. Wer abbestellte, bekam trotzdem Push.
 *
 * Nur ein ausdrückliches `false` hält zurück: von 283.756 Konten tragen
 * 283.728 das Feld gar nicht. Ein fehlender Wert oder ein Lesefehler ist
 * keine Aussage über den Willen des Nutzers — also senden (fail-open),
 * dieselbe Linie wie beim Ortsgate dieser Codebase.
 *
 * @param {object|null|undefined} nutzerDaten Inhalt von users/{uid}
 * @returns {{erlaubt: boolean, grund: string}} grund: 'ok' | 'abbestellt' | 'kein_nutzerdokument'
 */
function pushErlaubt(nutzerDaten) {
  if (!nutzerDaten || typeof nutzerDaten !== 'object') {
    return { erlaubt: true, grund: 'kein_nutzerdokument' };
  }
  if (nutzerDaten.pushNotificationsEnabled === false) {
    return { erlaubt: false, grund: 'abbestellt' };
  }
  return { erlaubt: true, grund: 'ok' };
}

module.exports = { pushErlaubt };
