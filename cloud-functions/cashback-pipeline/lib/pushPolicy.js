'use strict';

/**
 * Darf dieser Nutzer eine Push-Nachricht bekommen? (ClickUp 86cbfdq5j)
 *
 * ═══ Warum es dieses Modul überhaupt gibt ═══
 *
 * Die App hat seit Mai 2026 einen Schalter „Alle Benachrichtigungen" unter
 * /notification-settings. Ausschalten schrieb `pushNotificationsEnabled:
 * false` ans Nutzerdokument — und dieses Feld wurde im gesamten Projekt
 * NIRGENDS gelesen. Der Server holte stumpf alle Token und sendete weiter.
 * Wer Push abbestellte, bekam Push. Ein Widerspruch ist kein Schönheits-
 * fehler: eine Abbestellung, die nichts abbestellt, ist ein Versprechen,
 * das wir gebrochen haben.
 *
 * Hier liegt die Entscheidung als reine Funktion, damit sie ohne
 * Firestore prüfbar ist und jeder künftige Sendeweg dieselbe Regel erbt.
 * Im Repo nutzt sie genau eine Stelle: `lib/push.js sendCashbackReady`.
 *
 * ⚠ ES GIBT ZWEI WEITERE SENDEWEGE, DIE SIE NICHT KENNEN — und die nicht im
 * Repo liegen. `sendPushNotificationsTrigger` (auf `ff_push_notifications`)
 * und `sendUserPushNotificationsTrigger` (auf `ff_user_push_notifications`)
 * sind seit dem 30.01.2025 per Konsole deployt, laufen weiter und lesen die
 * FlutterFlow-Tokensammlung `fcm_tokens` (2.149 Dokumente). Beide prüfen
 * keine Abbestellung. Entschärft ist das nur dadurch, dass ihre
 * Auslöse-Sammlungen in `firestore.rules` fehlen und damit unter das
 * abschließende Verbot fallen — schreiben kann dort also nur das Admin-SDK
 * oder die Konsole. Zuletzt benutzt am 16.11.2023.
 *
 * Das ist exakt das Muster der Legacy-Function `optimizeImage` aus
 * CLAUDE.md: eine per Konsole deployte Function, die man beim Durchsuchen
 * des Repos nicht sieht. Wer hier etwas ändert, muss wissen, dass die Regel
 * dort NICHT gilt. Aufzuräumen ist das getrennt (löschen oder nachziehen).
 *
 * ═══ Die Regel: nur ein ausdrückliches Nein hält zurück ═══
 *
 * Gemessen am 08.09.2026: von 283.756 Konten tragen 283.728 das Feld GAR
 * NICHT — sie haben den Schalter nie angefasst. 22 stehen auf `true`,
 * 6 auf `false`. Würde ein fehlender Wert als „aus" gelten, bekäme mit
 * dem nächsten Deploy praktisch niemand mehr eine Nachricht. Deshalb:
 * fehlt das Feld, wird gesendet. Nur ein gesetztes `false` ist ein Nein.
 *
 * Das ist dieselbe Haltung wie beim Ortsgate der Foto-Vergütung: eine neue
 * Regel darf niemanden treffen, der nie die Gelegenheit hatte, sie zu
 * erfüllen.
 */

/**
 * @param {object|null|undefined} nutzerDaten  Inhalt von users/{uid}, oder
 *   null/undefined wenn das Dokument fehlt bzw. nicht gelesen werden konnte.
 * @returns {{erlaubt: boolean, grund: string}}
 *   grund: 'ok' | 'abbestellt' | 'kein_nutzerdokument'
 */
function pushErlaubt(nutzerDaten) {
  if (!nutzerDaten || typeof nutzerDaten !== 'object') {
    // Kein Dokument oder Lesefehler. Ein Infrastrukturfehler ist keine
    // Aussage über den Willen des Nutzers — also senden (fail-open).
    // Dieselbe Linie wie beim Aktionsgebiet in crowd-upload-reward.
    return { erlaubt: true, grund: 'kein_nutzerdokument' };
  }
  if (nutzerDaten.pushNotificationsEnabled === false) {
    return { erlaubt: false, grund: 'abbestellt' };
  }
  return { erlaubt: true, grund: 'ok' };
}

module.exports = { pushErlaubt };
