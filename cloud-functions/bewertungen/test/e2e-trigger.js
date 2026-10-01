'use strict';

/**
 * Durchstich über den ECHTEN Trigger: Firestore-Emulator + Functions-Emulator.
 * Prüft, was test/aggregation.test.js nicht sieht — dass die Funktion
 * geladen, für productRatings registriert und mit einem echten Ereignis
 * aufgerufen wird (inkl. Umwandlung der Referenzfelder productID /
 * brandProductID in DocumentReferences).
 *
 * Aufruf: eine Mini-Konfiguration NUR mit dieser Codebase anlegen (die
 * firebase.json im Repo-Wurzelordner lädt im Emulator sonst alle Codebases,
 * `--only functions:<codebase>` filtert dort nicht), z. B. /tmp/emu/firebase.json:
 *   { "emulators": { "firestore": {"port": 8795}, "functions": {"port": 5095},
 *                    "ui": {"enabled": false} },
 *     "functions": [{ "source": "<repo>/cloud-functions/bewertungen",
 *                     "codebase": "bewertungen", "runtime": "nodejs22" }] }
 * und darin:
 *   firebase emulators:exec --only functions,firestore --project demo-bewertungen \
 *     'node <repo>/cloud-functions/bewertungen/test/e2e-trigger.js'
 * (Java 21+ für den Firestore-Emulator.)
 *
 * Gibt am Ende den Endstand als JSON aus (Zeile „ENDSTAND …"), damit sich
 * zwei Läufe — Nachbau gegen Version 15 — Feld für Feld vergleichen lassen.
 */

const assert = require('node:assert/strict');
const path = require('node:path');

const PROJEKT = process.env.GCLOUD_PROJECT || '';
if (!process.env.FIRESTORE_EMULATOR_HOST || !PROJEKT.startsWith('demo-')) {
  console.error('Nur gegen den Emulator mit demo-Projekt (FIRESTORE_EMULATOR_HOST, GCLOUD_PROJECT=demo-…).');
  process.exit(2);
}

const admin = require(path.join(__dirname, '..', 'node_modules', 'firebase-admin'));
const app = admin.initializeApp({ projectId: PROJEKT }, 'e2e');
const db = app.firestore();

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wartet, bis für diese Bewertung `anzahl` Ereignisse verarbeitet sind. */
async function warteAufMarker(ratingId, anzahl, frist = 30000) {
  const start = Date.now();
  while (Date.now() - start < frist) {
    const n = (await db.collection('processedRatingEvents').where('ratingId', '==', ratingId).get()).size;
    if (n >= anzahl) {
      if (n > anzahl) throw new Error(`${ratingId}: ${n} Marker statt ${anzahl}`);
      return;
    }
    await warte(150);
  }
  throw new Error(`${ratingId}: nach ${frist} ms erst ${(await db.collection('processedRatingEvents').where('ratingId', '==', ratingId).get()).size} von ${anzahl} Ereignissen verarbeitet`);
}

const bewertung = (ziel, werte) => ({
  userID: 'u-e2e', ratingOverall: null, ratingPriceValue: null, ratingTasteFunction: null,
  ratingSimilarity: null, ratingContent: null, comment: null,
  ratedate: new Date('2026-10-01T10:00:00Z'), updatedate: new Date('2026-10-01T10:00:00Z'),
  ...ziel, ...werte,
});

const felder = (d) => d && Object.fromEntries(Object.entries(d)
  .filter(([k]) => k === 'name' || /^(ratingCount|ratingSum|averageRating)/.test(k))
  .sort(([a], [b]) => a.localeCompare(b)));

(async () => {
  const R = db.collection('productRatings');
  const P1 = db.doc('produkte/e2e-p1');
  const P2 = db.doc('produkte/e2e-p2');
  const M1 = db.doc('markenProdukte/e2e-m1');
  const FEHLT = db.doc('produkte/e2e-fehlt');
  await P1.set({ name: 'NoName Eins' });
  await P2.set({ name: 'NoName Zwei' });
  await M1.set({ name: 'Marke Eins' });

  // Anlegen, Ändern, Leeren, Löschen auf demselben Produkt
  await R.doc('e2e-r1').set(bewertung({ productID: P1 }, { ratingOverall: 4, ratingPriceValue: 5 }));
  await warteAufMarker('e2e-r1', 1);
  await R.doc('e2e-r2').set(bewertung({ productID: P1 }, { ratingOverall: 3 }));
  await warteAufMarker('e2e-r2', 1);
  let p1 = (await P1.get()).data();
  assert.deepEqual([p1.ratingCountOverall, p1.ratingSumOverall, p1.averageRatingOverall, p1.ratingCount], [2, 7, 3.5, 2]);

  await R.doc('e2e-r1').update({ ratingOverall: 2, updatedate: new Date() });
  await warteAufMarker('e2e-r1', 2);
  await R.doc('e2e-r1').update({ ratingPriceValue: null });
  await warteAufMarker('e2e-r1', 3);
  await R.doc('e2e-r2').delete();
  await warteAufMarker('e2e-r2', 2);

  // Markenprodukt mit allen fünf Kriterien
  await R.doc('e2e-r3').set(bewertung({ brandProductID: M1 }, {
    ratingOverall: 4, ratingPriceValue: 1, ratingTasteFunction: 5, ratingSimilarity: 3, ratingContent: 2,
  }));
  await warteAufMarker('e2e-r3', 1);

  // Bewertung für ein Produkt, das es nicht gibt
  await R.doc('e2e-r4').set(bewertung({ productID: FEHLT }, { ratingOverall: 5 }));
  await warteAufMarker('e2e-r4', 1);

  // Kommentar nachgetragen, Werte unverändert
  await R.doc('e2e-r5').set(bewertung({ productID: P2 }, { ratingOverall: 3, ratingContent: 4 }));
  await warteAufMarker('e2e-r5', 1);
  await R.doc('e2e-r5').update({ comment: 'nachgetragen' });
  await warteAufMarker('e2e-r5', 2);

  const ende = {};
  for (const ref of [P1, P2, M1, FEHLT]) ende[ref.path] = felder((await ref.get()).data()) || null;
  const marker = await db.collection('processedRatingEvents').get();
  ende.marker = marker.docs.map((d) => {
    const x = d.data();
    return `${x.ratingId}|${x.status}|${x.productPath}|${x.collectionName}|${x.processedAt ? 'zeit' : '-'}`;
  }).sort();

  assert.deepEqual(ende['produkte/e2e-p1'], {
    averageRatingOverall: 2, averageRatingPriceValue: 0, name: 'NoName Eins',
    ratingCount: 1, ratingCountOverall: 1, ratingCountPriceValue: 0,
    ratingSumOverall: 2, ratingSumPriceValue: 0,
  });
  assert.deepEqual(ende['produkte/e2e-p2'], {
    averageRatingContent: 4, averageRatingOverall: 3, name: 'NoName Zwei',
    ratingCount: 1, ratingCountContent: 1, ratingCountOverall: 1, ratingSumContent: 4, ratingSumOverall: 3,
  });
  assert.deepEqual(ende['markenProdukte/e2e-m1'], {
    averageRatingContent: 2, averageRatingOverall: 4, averageRatingPriceValue: 1,
    averageRatingSimilarity: 3, averageRatingTasteFunction: 5, name: 'Marke Eins', ratingCount: 1,
    ratingCountContent: 1, ratingCountOverall: 1, ratingCountPriceValue: 1, ratingCountSimilarity: 1,
    ratingCountTasteFunction: 1, ratingSumContent: 2, ratingSumOverall: 4, ratingSumPriceValue: 1,
    ratingSumSimilarity: 3, ratingSumTasteFunction: 5,
  });
  assert.deepEqual(ende['produkte/e2e-fehlt'], {
    averageRatingOverall: 5, ratingCount: 1, ratingCountOverall: 1, ratingSumOverall: 5,
  });
  assert.equal(ende.marker.length, 9);

  console.log('ENDSTAND ' + JSON.stringify(ende));
  console.log('E2E OK');
  await app.delete();
})().catch((e) => { console.error('E2E FEHLER', e); process.exit(1); });
