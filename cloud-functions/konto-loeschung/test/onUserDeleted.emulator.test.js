'use strict';

/**
 * Emulator-Test für onUserDeleted (Auth + Firestore + Functions).
 *
 * Läuft NUR gegen die Emulatoren — die Umgebungsvariablen
 * FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST setzt
 * `emulators:exec`; ohne sie bricht der Test sofort ab, damit er nie
 * versehentlich gegen Produktion läuft. Projekt-ID mit `demo-`-Präfix =
 * Emulator-only.
 *
 * Ausführen (Node 22, Java 21+) aus dem Repo-Root, mit einer Mini-Konfiguration,
 * die NUR diese Codebase enthält (`--only functions:<codebase>` filtert im
 * Emulator nicht). `source` muss RELATIV zur Konfigurationsdatei stehen —
 * ein absoluter Pfad wird an deren Ordner angehängt. Die Datei nicht
 * einchecken, danach löschen:
 *
 *   cat > firebase.konto-emu.json <<'EOF'
 *   { "functions": [{ "source": "cloud-functions/konto-loeschung",
 *                     "codebase": "konto-loeschung", "runtime": "nodejs22",
 *                     "disallowLegacyRuntimeConfig": true,
 *                     "ignore": ["node_modules", "test"] }],
 *     "emulators": { "auth": { "port": 19099 }, "firestore": { "port": 18080 },
 *                    "functions": { "port": 15001 }, "hub": { "port": 14400 },
 *                    "logging": { "port": 14500 }, "ui": { "enabled": false } } }
 *   EOF
 *   JAVA_HOME=… npx firebase-tools@15.15.0 emulators:exec \
 *     --config firebase.konto-emu.json --project demo-konto-loeschung \
 *     --only auth,firestore,functions \
 *     "node --test cloud-functions/konto-loeschung/test/onUserDeleted.emulator.test.js"
 *   rm firebase.konto-emu.json
 *
 * Abgenommen am 01.10.2026: 3/3 grün; identisch grün gegen den Original-
 * Quelltext (FlutterFlow, Version 8); mit leerem Handler (Negativkontrolle)
 * scheitern die beiden Auslöser-Tests wie erwartet.
 *
 * Zusätzlich am 01.10.2026 (einmalig, nicht Teil dieses Tests): Aufruf wie
 * auf GCF 1st gen über das Google Functions Framework 3.5.1 und 5.0.5
 * (`--signature-type=event`, Legacy-Ereignis user.delete in beiden
 * Formaten {context,data} und flach), Quelle frisch per `npm ci` aus dem
 * Lockfile, Firestore-Emulator: HTTP 204, Dokument weg, Nachbar und
 * Unterordner unberührt, fehlendes Dokument → 204. Leerer und werfender
 * Handler wurden als Negativkontrollen erkannt.
 */

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Emulator-Test: FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST fehlen — nur über emulators:exec starten.');
}
const PROJECT = process.env.GCLOUD_PROJECT || '';
if (!PROJECT.startsWith('demo-')) {
  throw new Error(`Emulator-Test: Projekt „${PROJECT}" ist kein demo-Projekt.`);
}

// Erst NACH den Schutzprüfungen laden: index.js legt die Default-App an.
// Der Test benutzt daneben eine eigene, benannte App.
const { onUserDeleted } = require('../index.js');

let db;
let auth;

before(() => {
  const app = admin.initializeApp({ projectId: PROJECT }, 'emulator-test');
  db = app.firestore();
  auth = app.auth();
});

/** Wartet, bis `pruefe()` true liefert, höchstens `ms` Millisekunden. */
async function warteBis(pruefe, ms = 20000, schritt = 250) {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    if (await pruefe()) return true;
    await new Promise((r) => setTimeout(r, schritt));
  }
  return false;
}

test('Konto löschen entfernt users/{uid} — und nur dieses Dokument', async () => {
  const uid = `del_${Date.now()}`;
  const nachbar = `nachbar_${Date.now()}`;

  await auth.createUser({ uid, email: `${uid}@example.com` });
  await db.doc(`users/${uid}`).set({ displayName: 'Test', cashback_balance_cents: 42 });
  await db.doc(`users/${uid}/cashback_ledger/e1`).set({ type: 'earn', cents: 42 });
  await db.doc(`users/${nachbar}`).set({ displayName: 'Nachbar' });

  await auth.deleteUser(uid);

  const weg = await warteBis(async () => !(await db.doc(`users/${uid}`).get()).exists);
  assert.equal(weg, true, 'users/{uid} wurde nach dem Löschen des Kontos nicht entfernt');

  // Fremde Dokumente bleiben unberührt.
  assert.equal((await db.doc(`users/${nachbar}`).get()).exists, true);

  // Heutiges Verhalten, bewusst unverändert übernommen: Unterordner bleiben
  // liegen (offene Entscheidung, Geld-Ledger evtl. aufbewahrungspflichtig).
  assert.equal((await db.doc(`users/${uid}/cashback_ledger/e1`).get()).exists, true);
});

test('Konto ohne Profil-Dokument: Auslöser läuft, ohne etwas anzulegen', async () => {
  const uid = `ohnedoc_${Date.now()}`;
  await auth.createUser({ uid });
  await auth.deleteUser(uid);

  // Danach muss die Funktion für ein weiteres Konto noch normal arbeiten
  // (ein Fehler im Lauf oben darf nichts kaputt hinterlassen).
  const uid2 = `danach_${Date.now()}`;
  await auth.createUser({ uid: uid2 });
  await db.doc(`users/${uid2}`).set({ x: 1 });
  await auth.deleteUser(uid2);
  assert.equal(
    await warteBis(async () => !(await db.doc(`users/${uid2}`).get()).exists),
    true,
  );
  assert.equal((await db.doc(`users/${uid}`).get()).exists, false);
});

test('Handler direkt: fehlendes Dokument wirft keinen Fehler', async () => {
  await assert.doesNotReject(onUserDeleted.run({ uid: `nie_angelegt_${Date.now()}` }, {}));
});
