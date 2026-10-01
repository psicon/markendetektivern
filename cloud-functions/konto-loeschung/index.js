/**
 * onUserDeleted — räumt beim Löschen eines Firebase-Auth-Kontos das
 * Profil-Dokument `users/{uid}` weg.
 *
 * Herkunft: Die Funktion wurde 2024 aus FlutterFlow deployt und lag nie im
 * Repo (us-central1, 1st gen, nodejs18, Codebase-Label „functions",
 * Version 8 vom 28.09.2024). Node 18 ist abgelaufen; diese Codebase holt sie
 * ins Repo und hebt sie auf nodejs22. Der Quelltext von Version 8 war:
 *
 *   exports.onUserDeleted = functions.auth.user().onDelete(async (user) => {
 *     let firestore = admin.firestore();
 *     let userRef = firestore.doc('users/' + user.uid);   // ungenutzt
 *     await firestore.collection("users").doc(user.uid).delete();
 *   });
 *
 * Das Verhalten ist BEWUSST 1:1 übernommen (nur die ungenutzte Variable ist
 * weg). Insbesondere:
 *   - Gelöscht wird NUR das Dokument `users/{uid}`. Unterordner
 *     (`cashback_ledger`, `ledger`, `purchased_products`, `journeys`, …)
 *     bleiben liegen — Firestore löscht sie beim Löschen des Elterndokuments
 *     nicht mit. Das ist eine bekannte Lücke und eine offene Entscheidung,
 *     weil das Geld-Ledger aufbewahrungspflichtig sein kann. Nicht hier
 *     „nebenbei" erweitern.
 *   - Existiert das Dokument nicht, ist `delete()` ein No-op ohne Fehler.
 *   - Keine Wiederholung bei Fehlern (wie live: failurePolicy ohne retry).
 *
 * Warum 1st gen: Für „Konto gelöscht" gibt es keinen 2nd-gen-Auslöser
 * (Identity Platform kennt nur blockierende beforeCreate/beforeSignIn). Und
 * die Firebase CLI erlaubt kein Upgrade 1st → 2nd gen in place. Deshalb
 * v1-API über `firebase-functions/v1` (in v6 nicht mehr der Default-Export).
 * Der Laufzeitpfad ist dabei derselbe wie in firebase-functions 5.1.1, mit
 * dem `aggregateLeaderboard` seit August 2026 auf 1st gen + nodejs22 läuft:
 * `lib/v1/cloud-functions.js`, `function-builder.js`, `onInit.js` sind
 * byte-gleich; `v1/providers/auth.js` unterscheidet sich nur bei den
 * blockierenden Funktionen (beforeCreate/beforeSignIn/…), nicht bei onDelete.
 *
 * Name, Region und Auslöser sind identisch zur Live-Funktion, damit der
 * Deploy sie AN ORT UND STELLE aktualisiert statt eine zweite anzulegen
 * (die CLI ordnet bestehende Funktionen zuerst über den NAMEN der Codebase
 * zu, nicht über das Codebase-Label). Speicher und Zeitlimit sind auf die
 * Live-Werte festgeschrieben.
 *
 * Deploy: `firebase deploy --only functions:konto-loeschung` (Node 22, vorher
 * `npm ci` in diesem Ordner). Emulator-Test: siehe test/.
 *
 * ACHTUNG beim Deploy: Das Artifact-Registry-Repo `gcf-artifacts` in
 * us-central1 hat (Stand 01.10.2026) keine Aufräumregel. Die CLI aktualisiert
 * die Funktion und bricht DANACH mit Exit 1 ab („Functions successfully
 * deployed but could not set up cleanup policy … Pass the --force option").
 * NICHT mit --force wiederholen: Das setzt auf dem Repo, das die Images ALLER
 * us-central1-Funktionen hält (Algolia-/Bild-Extensions, FlutterFlow-
 * Funktionen auf nicht mehr baubaren Runtimes), die Regel „Images älter als
 * 1 Tag löschen" und bestätigt jede weitere Rückfrage ungefragt. Erfolg an
 * der Zeile „Successful update operation." und an `gcloud functions
 * describe` erkennen, nicht am Exit-Code (solange die Regel fehlt, immer 1).
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

exports.onUserDeleted = functions
  .region('us-central1')
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .auth.user()
  .onDelete(async (user) => {
    const firestore = admin.firestore();
    await firestore.collection('users').doc(user.uid).delete();
  });
