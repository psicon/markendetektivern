'use strict';

/**
 * Kontosperre setzen (Entscheidung Patrick 02.10.2026, „Ja, dann sperr die
 * Konten"). Legt cashback_sperren/{uid} an — Regel und Leser: lib/kontoSperre.js.
 *
 * STANDARD IST DER TROCKENLAUF: liest nur und zeigt, was geschrieben würde.
 * Geschrieben wird ausschließlich mit SCHREIBEN=1.
 *
 *   cd cloud-functions/cashback-pipeline
 *   node .konto-sperre-0210.js              # Trockenlauf
 *   SCHREIBEN=1 node .konto-sperre-0210.js  # Sperren anlegen
 *
 * Anmeldung über die ADC des Nutzerkontos (siehe CLAUDE.md, „Admin-SDK lokal").
 *
 * - Legt nur an, überschreibt nie (`create`): eine vorhandene Sperre — auch
 *   eine aufgehobene mit `gesperrt: false` — bleibt, wie sie ist.
 * - Bucht nichts zurück, storniert nichts, ändert kein Guthaben.
 * - Wirkt erst, wenn der Code mit den Lesern ausgerollt ist (cashback-pipeline,
 *   crowd-upload-reward, review-console). Vorher ist das Dokument wirkungslos.
 * - Aufheben: `gesperrt: false` setzen (Historie bleibt) oder Dokument löschen.
 */

const admin = require('firebase-admin');
const { sperreRef, istGesperrt } = require('./lib/kontoSperre');

admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();

const QUELLE = 'Entscheidung Patrick 02.10.2026';
const KONTEN = [
  {
    uid: '7onx0TmhFzYG4EttySlO14F73ZB3',
    grund: 'Produktfotos zu Hause, ein Produkt für alle Märkte, falsche EANs; vermutlich dieselbe Person wie tU89tZHxvcOOPLHvOFXna0sZREv1',
  },
  {
    uid: 'tU89tZHxvcOOPLHvOFXna0sZREv1',
    grund: 'Produktfotos zu Hause, ein Produkt für alle Märkte, falsche EANs; vermutlich dieselbe Person wie 7onx0TmhFzYG4EttySlO14F73ZB3',
  },
];

(async () => {
  const schreiben = process.env.SCHREIBEN === '1';
  console.log(schreiben ? 'SCHREIBEN — Sperren werden angelegt' : 'TROCKENLAUF — es wird nichts geschrieben');
  let fehler = 0;
  for (const { uid, grund } of KONTEN) {
    const ref = sperreRef(db, uid);
    const [sperre, nutzer, offeneAuszahlungen] = await Promise.all([
      ref.get(),
      db.doc(`users/${uid}`).get(),
      db.collection('cashback_payouts').where('userId', '==', uid).where('status', '==', 'requested').get(),
    ]);
    const u = nutzer.data() || {};
    console.log(`\n${uid}`);
    console.log(`  Guthaben ${u.cashback_balance_cents ?? 0} ct (bleibt stehen, wird eingefroren), Lebenszeit ${u.cashback_lifetime_cents ?? 0} ct`);
    console.log(`  offene Auszahlungsanfragen: ${offeneAuszahlungen.size}${offeneAuszahlungen.size ? ' → processPayout hält sie nach dem Deploy an und bucht zurück' : ''}`);
    if (sperre.exists) {
      console.log(`  Sperre vorhanden (wirksam: ${istGesperrt(sperre)}) — wird NICHT überschrieben`);
      continue;
    }
    const daten = { gesperrt: true, seit: admin.firestore.FieldValue.serverTimestamp(), grund, quelle: QUELLE };
    if (!schreiben) {
      console.log('  würde anlegen:', { ...daten, seit: '<Serverzeit>' });
      continue;
    }
    try {
      await ref.create(daten);
      console.log('  angelegt');
    } catch (e) {
      fehler += 1;
      console.error('  FEHLER:', e.message);
    }
  }
  process.exit(fehler ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
