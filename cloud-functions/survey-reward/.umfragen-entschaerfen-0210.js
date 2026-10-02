'use strict';

/**
 * Sofortmaßnahme ohne Deploy (Prüfrunde 02.10.2026): abgelaufene bezahlte
 * Umfragen auf `rewardTrigger: 'none'` setzen.
 *
 * Warum: Der ausgerollte survey-reward (Stand 0215e957, 13.06.) prüft weder
 * Status noch Zeitraum der Umfrage, und die Regeln erlauben jedem angemeldeten
 * Nutzer, `poll_responses` mit beliebiger pollId anzulegen. Am 02.10. lagen
 * 9 bezahlte, längst abgelaufene Umfragen vor — zusammen rund 14,50 € je
 * frischem Konto mit Einwilligung, über der Auszahlungsschwelle von 10 €.
 * Echte Antworten nach Umfrageende: keine (alle 9 geprüft).
 * Der Code-Fix (Status 'active' + Zeitraum + Kontosperre) liegt in index.js;
 * dieses Skript schließt die Lücke bis zu dessen Deploy. `rewardTrigger:
 * 'none'` liest der ausgerollte Code schon (keine Gutschrift).
 *
 * STANDARD IST DER TROCKENLAUF. Geschrieben wird nur mit SCHREIBEN=1.
 *
 *   cd cloud-functions/survey-reward
 *   node .umfragen-entschaerfen-0210.js
 *   SCHREIBEN=1 node .umfragen-entschaerfen-0210.js
 *
 * Erfasst nur Umfragen mit rewardCents > 0, deren endDate VOR jetzt liegt.
 * Der alte Wert bleibt in `rewardTriggerVorher` stehen (rückgängig machbar).
 * Laufende Umfragen werden nie angefasst.
 */

const admin = require('firebase-admin');

admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();

const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : null);

(async () => {
  const schreiben = process.env.SCHREIBEN === '1';
  console.log(schreiben ? 'SCHREIBEN' : 'TROCKENLAUF — es wird nichts geschrieben');
  const jetzt = Date.now();
  const snap = await db.collection('polls').get();
  let treffer = 0;
  let fehler = 0;
  for (const d of snap.docs) {
    const p = d.data() || {};
    if (!(Number(p.rewardCents) > 0)) continue;
    const ende = ms(p.endDate);
    const trigger = p.rewardTrigger ?? 'completion';
    const zeile = `${d.id.padEnd(28)} ${String(p.rewardCents).padStart(5)} ct  ${trigger.padEnd(10)} status=${p.status ?? '-'} Ende=${ende ? new Date(ende).toISOString().slice(0, 10) : '-'}`;
    if (trigger === 'none') { console.log(`  schon aus   ${zeile}`); continue; }
    if (ende == null || ende >= jetzt) { console.log(`  läuft/offen ${zeile} — bleibt unangetastet`); continue; }
    treffer += 1;
    if (!schreiben) { console.log(`  würde aus   ${zeile}`); continue; }
    try {
      await d.ref.update({
        rewardTrigger: 'none',
        rewardTriggerVorher: trigger,
        rewardEntschaerftAm: admin.firestore.FieldValue.serverTimestamp(),
        rewardEntschaerftGrund: 'Prüfrunde 02.10.2026: abgelaufen, ausgerollter survey-reward prüft den Zeitraum nicht',
      });
      console.log(`  aus         ${zeile}`);
    } catch (e) {
      fehler += 1;
      console.error(`  FEHLER      ${zeile}: ${e.message}`);
    }
  }
  console.log(`\n${treffer} Umfrage(n) ${schreiben ? 'entschärft' : 'würden entschärft'}.`);
  process.exit(fehler ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
