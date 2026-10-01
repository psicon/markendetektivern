'use strict';

/**
 * Verhaltenstests für aggregateRatingsByPath gegen den Firestore-EMULATOR.
 *
 * Die erwarteten Werte beschreiben das Verhalten der Console-Version 15
 * (11.09.2025). Dieselbe Datei läuft auch gegen eine Kopie von Version 15
 * (Umgebungsvariable BEWERTUNGEN_HANDLER=<pfad>/index.js) — bestehen beide,
 * verhält sich der Nachbau in diesen Fällen wie das Original.
 *
 * Aufruf aus cloud-functions/bewertungen (Java 21+ für den Emulator):
 *   npx firebase-tools@15.15.0 emulators:exec --only firestore \
 *     --project demo-bewertungen 'GCLOUD_PROJECT=demo-bewertungen npm test'
 *
 * Die Datei weigert sich, ohne Emulator oder mit einer echten Projekt-ID zu
 * laufen: der Handler schreibt Produkt-Dokumente.
 *
 * Ausgelöst wird der Handler direkt (`.run(change, context)`) mit echten
 * Firestore-Snapshots vor/nach dem Schreiben — so lassen sich Ereignis-IDs
 * wiederholen (Doppelzustellung) und Läufe gleichzeitig starten. Den
 * vollständigen Weg über den Trigger prüft test/e2e-trigger.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const PROJEKT = process.env.GCLOUD_PROJECT || '';
if (!process.env.FIRESTORE_EMULATOR_HOST || !PROJEKT.startsWith('demo-')) {
  throw new Error(
    'Diese Tests laufen nur gegen den Firestore-Emulator mit einem demo-Projekt '
    + '(FIRESTORE_EMULATOR_HOST gesetzt, GCLOUD_PROJECT=demo-…).',
  );
}

const HANDLER_MODUL = process.env.BEWERTUNGEN_HANDLER || '../index.js';
const { aggregateRatingsByPath } = require(HANDLER_MODUL);
const admin = require('firebase-admin');

const app = admin.apps.length ? admin.app() : admin.initializeApp({ projectId: PROJEKT });
const db = app.firestore();

const LAUF = `${Date.now().toString(36)}`;
let zaehler = 0;
const neueId = (praefix) => `${praefix}-${LAUF}-${++zaehler}`;

/** Schreibt in productRatings und ruft den Handler mit dem echten Vorher/Nachher auf. */
async function schreibe(ratingId, aenderung, { eventId, nurAusfuehren } = {}) {
  const ref = db.collection('productRatings').doc(ratingId);
  const before = await ref.get();
  if (aenderung === null) await ref.delete();
  else if (before.exists) await ref.update(aenderung);
  else await ref.set(aenderung);
  const after = await ref.get();
  const ev = eventId || neueId('ev');
  if (!nurAusfuehren) {
    await aggregateRatingsByPath.run({ before, after }, { eventId: ev, params: { ratingId } });
  }
  return { ev, before, after };
}

const bewertung = (ziel, werte = {}) => ({
  userID: 'u-test',
  ratingOverall: null,
  ratingPriceValue: null,
  ratingTasteFunction: null,
  ratingSimilarity: null,
  ratingContent: null,
  comment: null,
  ratedate: new Date('2026-10-01T10:00:00Z'),
  updatedate: new Date('2026-10-01T10:00:00Z'),
  ...ziel,
  ...werte,
});

const produktRef = (id) => db.collection('produkte').doc(id);
const markeRef = (id) => db.collection('markenProdukte').doc(id);
const lies = async (ref) => (await ref.get()).data();
const nurBewertungsfelder = (d) => Object.fromEntries(
  Object.entries(d || {}).filter(([k]) => /^(ratingCount|ratingSum|averageRating)/.test(k)),
);

test('neue Bewertung legt Zähler, Summe und Schnitt je Kriterium an', async () => {
  const pid = neueId('p');
  await produktRef(pid).set({ name: 'Testprodukt' });
  const rid = neueId('r');
  const { ev } = await schreibe(rid, bewertung({ productID: produktRef(pid) }, { ratingOverall: 4, ratingPriceValue: 5 }));

  const p = await lies(produktRef(pid));
  assert.equal(p.name, 'Testprodukt');
  assert.deepEqual(nurBewertungsfelder(p), {
    ratingCountOverall: 1, ratingSumOverall: 4, averageRatingOverall: 4,
    ratingCountPriceValue: 1, ratingSumPriceValue: 5, averageRatingPriceValue: 5,
    ratingCount: 1,
  });

  const marker = await lies(db.collection('processedRatingEvents').doc(ev));
  assert.equal(marker.status, 'Success');
  assert.equal(marker.ratingId, rid);
  assert.equal(marker.productPath, `produkte/${pid}`);
  assert.equal(marker.collectionName, 'produkte');
  assert.ok(marker.processedAt && typeof marker.processedAt.toDate === 'function');
});

test('Ändern, Leeren und Löschen rechnen nur die Differenz ein', async () => {
  const pid = neueId('p');
  await produktRef(pid).set({ name: 'Testprodukt' });
  const ziel = { productID: produktRef(pid) };
  const r1 = neueId('r'); const r2 = neueId('r'); const r3 = neueId('r');
  await schreibe(r1, bewertung(ziel, { ratingOverall: 4, ratingPriceValue: 5 }));
  await schreibe(r2, bewertung(ziel, { ratingOverall: 3 }));
  await schreibe(r3, bewertung(ziel, { ratingOverall: 3 }));

  let p = await lies(produktRef(pid));
  // 10 / 3 = 3,333… → auf eine Stelle gerundet
  assert.deepEqual([p.ratingCountOverall, p.ratingSumOverall, p.averageRatingOverall, p.ratingCount], [3, 10, 3.3, 3]);

  // Änderung 4 → 2 (wie updateProductRating in der App: Teil-Update)
  await schreibe(r1, { ratingOverall: 2, updatedate: new Date() });
  p = await lies(produktRef(pid));
  assert.deepEqual([p.ratingCountOverall, p.ratingSumOverall, p.averageRatingOverall], [3, 8, 2.7]);

  // Preis-Leistung auf null: Kriterium leer, Schnitt 0, Felder bleiben stehen
  await schreibe(r1, { ratingPriceValue: null });
  p = await lies(produktRef(pid));
  assert.deepEqual([p.ratingCountPriceValue, p.ratingSumPriceValue, p.averageRatingPriceValue], [0, 0, 0]);

  // Löschen zieht den alten Wert ab
  await schreibe(r2, null);
  p = await lies(produktRef(pid));
  assert.deepEqual([p.ratingCountOverall, p.ratingSumOverall, p.averageRatingOverall, p.ratingCount], [2, 5, 2.5, 2]);

  await schreibe(r1, null);
  await schreibe(r3, null);
  p = await lies(produktRef(pid));
  assert.deepEqual(nurBewertungsfelder(p), {
    ratingCountOverall: 0, ratingSumOverall: 0, averageRatingOverall: 0,
    ratingCountPriceValue: 0, ratingSumPriceValue: 0, averageRatingPriceValue: 0,
    ratingCount: 0,
  });
});

test('dieselbe Ereignis-ID zweimal zugestellt zählt nur einmal', async () => {
  const pid = neueId('p');
  await produktRef(pid).set({ name: 'Testprodukt' });
  const rid = neueId('r');
  const { ev, before, after } = await schreibe(rid, bewertung({ productID: produktRef(pid) }, { ratingOverall: 5 }));
  // zweite Zustellung desselben Ereignisses (Pub/Sub at-least-once)
  await aggregateRatingsByPath.run({ before, after }, { eventId: ev, params: { ratingId: rid } });
  const p = await lies(produktRef(pid));
  assert.deepEqual([p.ratingCountOverall, p.ratingSumOverall, p.averageRatingOverall, p.ratingCount], [1, 5, 5, 1]);
});

test('gleichzeitige Bewertungen desselben Produkts gehen nicht verloren', async () => {
  const pid = neueId('p');
  await produktRef(pid).set({ name: 'Testprodukt' });
  const ziel = { productID: produktRef(pid) };
  const laeufe = [];
  const werte = [5, 4, 3, 2, 1, 5, 4, 3];
  for (const w of werte) {
    const rid = neueId('r');
    const { before, after } = await schreibe(rid, bewertung(ziel, { ratingOverall: w }), { nurAusfuehren: true });
    laeufe.push({ before, after, rid });
  }
  await Promise.all(laeufe.map(({ before, after, rid }) => aggregateRatingsByPath.run(
    { before, after }, { eventId: neueId('ev'), params: { ratingId: rid } },
  )));
  const p = await lies(produktRef(pid));
  assert.deepEqual([p.ratingCountOverall, p.ratingSumOverall, p.averageRatingOverall], [8, 27, 3.4]);
});

test('Markenprodukt über brandProductID', async () => {
  const mid = neueId('m');
  await markeRef(mid).set({ name: 'Marke' });
  const { ev } = await schreibe(neueId('r'), bewertung({ brandProductID: markeRef(mid) }, {
    ratingOverall: 4, ratingTasteFunction: 5, ratingSimilarity: 3, ratingContent: 2, ratingPriceValue: 1,
  }));
  const m = await lies(markeRef(mid));
  assert.deepEqual(nurBewertungsfelder(m), {
    ratingCountOverall: 1, ratingSumOverall: 4, averageRatingOverall: 4,
    ratingCountPriceValue: 1, ratingSumPriceValue: 1, averageRatingPriceValue: 1,
    ratingCountTasteFunction: 1, ratingSumTasteFunction: 5, averageRatingTasteFunction: 5,
    ratingCountSimilarity: 1, ratingSumSimilarity: 3, averageRatingSimilarity: 3,
    ratingCountContent: 1, ratingSumContent: 2, averageRatingContent: 2,
    ratingCount: 1,
  });
  const marker = await lies(db.collection('processedRatingEvents').doc(ev));
  assert.equal(marker.collectionName, 'markenProdukte');
});

test('productID hat Vorrang vor brandProductID', async () => {
  const pid = neueId('p'); const mid = neueId('m');
  await produktRef(pid).set({ name: 'NoName' });
  await markeRef(mid).set({ name: 'Marke' });
  await schreibe(neueId('r'), bewertung({ productID: produktRef(pid), brandProductID: markeRef(mid) }, { ratingOverall: 5 }));
  assert.equal((await lies(produktRef(pid))).ratingCountOverall, 1);
  assert.deepEqual(nurBewertungsfelder(await lies(markeRef(mid))), {});
});

test('productID auf markenProdukte (Altfehler der App) wird ignoriert, ohne Marker', async () => {
  // So liegt productRatings/osUp0OivfBdZUBLudjiu in Produktion (11.09.2025).
  const mid = neueId('m');
  await markeRef(mid).set({ name: 'Marke' });
  const { ev } = await schreibe(neueId('r'), bewertung({ productID: markeRef(mid), brandProductID: markeRef(mid) }, { ratingOverall: 4 }));
  assert.deepEqual(nurBewertungsfelder(await lies(markeRef(mid))), {});
  assert.equal((await db.collection('processedRatingEvents').doc(ev).get()).exists, false);
});

test('Bewertung ohne Produktbezug schreibt nichts, auch keinen Marker', async () => {
  const { ev } = await schreibe(neueId('r'), bewertung({}, { ratingOverall: 4 }));
  assert.equal((await db.collection('processedRatingEvents').doc(ev).get()).exists, false);
});

test('nur Zahlen von 1 bis 5 zählen, auch Kommazahlen', async () => {
  const pid = neueId('p');
  await produktRef(pid).set({ name: 'Testprodukt' });
  const ziel = { productID: produktRef(pid) };
  // 6, 0 und "5" (Text) zählen nicht → kein Kriterium ändert sich → Produkt bleibt unberührt
  const { ev } = await schreibe(neueId('r'), bewertung(ziel, { ratingOverall: 6, ratingPriceValue: 0, ratingContent: '5' }));
  assert.deepEqual(await lies(produktRef(pid)), { name: 'Testprodukt' });
  assert.equal((await lies(db.collection('processedRatingEvents').doc(ev))).status, 'Success');

  await schreibe(neueId('r'), bewertung(ziel, { ratingOverall: 4.5, ratingContent: '5' }));
  const p = await lies(produktRef(pid));
  assert.deepEqual(nurBewertungsfelder(p), {
    ratingCountOverall: 1, ratingSumOverall: 4.5, averageRatingOverall: 4.5, ratingCount: 1,
  });
});

test('vorhandene Felder bleiben erhalten (auch die Null-Vorbelegung aus adminPromote)', async () => {
  const pid = neueId('p');
  const vorbelegt = {
    name: 'Neu angelegt', rating: 0, ratingCount: 0,
    averageRatingOverall: 0, averageRatingContent: 0, averageRatingPriceValue: 0,
    averageRatingSimilarity: 0, averageRatingTasteFunction: 0,
    ratingCountOverall: 0, ratingCountContent: 0, ratingCountPriceValue: 0,
    ratingCountSimilarity: 0, ratingCountTasteFunction: 0,
    ratingSumOverall: 0, ratingSumContent: 0, ratingSumPriceValue: 0,
    ratingSumSimilarity: 0, ratingSumTasteFunction: 0,
  };
  await produktRef(pid).set(vorbelegt);
  await schreibe(neueId('r'), bewertung({ productID: produktRef(pid) }, { ratingOverall: 5 }));
  assert.deepEqual(await lies(produktRef(pid)), {
    ...vorbelegt,
    ratingCountOverall: 1, ratingSumOverall: 5, averageRatingOverall: 5, ratingCount: 1,
  });
});

test('Kommentar-Änderung ohne neuen Wert lässt die Zahlen stehen', async () => {
  const pid = neueId('p');
  await produktRef(pid).set({ name: 'Testprodukt' });
  const rid = neueId('r');
  await schreibe(rid, bewertung({ productID: produktRef(pid) }, { ratingOverall: 3 }));
  const vorher = await lies(produktRef(pid));
  const { ev } = await schreibe(rid, { comment: 'nachgetragen', updatedate: new Date() });
  assert.deepEqual(await lies(produktRef(pid)), vorher);
  assert.equal((await lies(db.collection('processedRatingEvents').doc(ev))).status, 'Success');
});

test('fehlendes Produkt wird mit den Zählern angelegt (so macht es Version 15)', async () => {
  // Bewusst festgehalten, nicht gutgeheißen: so entstehen namenlose
  // Dokumente in produkte (in Produktion drei Stück vom 10./11.09.2025).
  const pid = neueId('fehlt');
  await schreibe(neueId('r'), bewertung({ productID: produktRef(pid) }, { ratingOverall: 5 }));
  assert.deepEqual(await lies(produktRef(pid)), {
    ratingCountOverall: 1, ratingSumOverall: 5, averageRatingOverall: 5, ratingCount: 1,
  });
});
