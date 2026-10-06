#!/usr/bin/env node
/**
 * Shopbilder aus external_products entfernen — nach dem Ausschalten von
 * _meta/produktsuche.shopBilder (Prüfrunde 04.10.2026: „Ein Schalter, der
 * nichts abschaltet“, CLAUDE.md).
 *
 * WARUM: Bilder von Shopseiten sind meist Herstellerbilder (Urheberrecht).
 * Patrick hat sie am 04.10.2026 erlaubt („ja“); dieses Skript ist der Rückweg,
 * falls die Erlaubnis zurückgenommen wird. Mit shopBilder: true übernimmt der Schreibweg sie
 * (lib/rohablage.js, Markierung bildVonShop). Wird der Schalter wieder
 * ausgeschaltet, entfernt lib/speichern.js das Bild beim NÄCHSTEN Schreiben
 * des Dokuments — Dokumente, die niemand mehr scannt, behielten es. Dieses
 * Skript räumt sie sofort: dieselbe Regel (speichern.shopBildEntfernen), je
 * Dokument in einer Transaktion; bleibt danach nichts Anzeigbares, wird das
 * Dokument gelöscht (wie im Schreibweg).
 *
 * Bricht ab, wenn shopBilder gerade eingeschaltet ist.
 *
 * AUFRUF (aus cloud-functions/external-product-lookup, ADC des Nutzerkontos):
 *   node scripts/shopbilder-entfernen.js              # Trockenlauf (Standard)
 *   SCHREIBEN=1 node scripts/shopbilder-entfernen.js  # schreibt
 * Ergebnisdatei: ERGEBNIS=<pfad> (Standard: Temp-Ordner), nach jedem Block.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const admin = require('firebase-admin');
const { shopBildEntfernen, fuerFirestore } = require('../lib/speichern');
const { mitStandard } = require('../lib/konfiguration');

const PROJEKT = process.env.PROJEKT || 'markendetektive-895f7';
if (PROJEKT !== 'markendetektive-895f7' && !PROJEKT.startsWith('demo-')) {
  throw new Error(`PROJEKT=${PROJEKT}: nur markendetektive-895f7 oder ein demo-Projekt (Emulator)`);
}
const SCHREIBEN = process.env.SCHREIBEN === '1';
const ERGEBNIS = process.env.ERGEBNIS || path.join(os.tmpdir(), `shopbilder-entfernen.${SCHREIBEN ? 'schreiben' : 'trocken'}.json`);
const BLOCK = 200;

if (!admin.apps.length) admin.initializeApp({ projectId: PROJEKT });
const db = admin.firestore();
const werkzeug = { FieldValue: admin.firestore.FieldValue, Timestamp: admin.firestore.Timestamp };

function speichere(stand) {
  stand.aktualisiert = new Date().toISOString();
  fs.writeFileSync(`${ERGEBNIS}.tmp`, JSON.stringify(stand, null, 1));
  fs.renameSync(`${ERGEBNIS}.tmp`, ERGEBNIS);
}

/** Ein Dokument in einer Transaktion: frisch lesen, planen, schreiben. */
async function raeume(ref, jetztMs) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'weg';
    const r = shopBildEntfernen(snap.data(), jetztMs);
    if (!r) return 'ohne_shopbild';
    if (!SCHREIBEN) return r.aktion;
    if (r.aktion === 'loeschen') tx.delete(ref);
    else if (Object.keys(r.patch).length > 0) tx.update(ref, fuerFirestore(r.patch, werkzeug));
    return r.aktion;
  });
}

async function main() {
  const konfig = await db.doc('_meta/produktsuche').get();
  if (mitStandard(konfig.exists ? konfig.data() : null).shopBilder) {
    console.error('shopBilder ist eingeschaltet — erst in _meta/produktsuche ausschalten. Nichts getan.');
    process.exitCode = 1;
    return;
  }
  const stand = { skript: 'shopbilder-entfernen', schreiben: SCHREIBEN, projekt: PROJEKT, gestartet: new Date().toISOString(), zaehler: {}, geloescht: [] };
  const jetztMs = Date.now();
  let cursor = null;
  try {
    for (;;) {
      let q = db.collection('external_products').where('bildVonShop', '==', true)
        .orderBy(admin.firestore.FieldPath.documentId()).select().limit(BLOCK);
      if (cursor) q = q.startAfter(cursor);
      const s = await q.get();
      for (const d of s.docs) {
        const aktion = await raeume(d.ref, jetztMs);
        stand.zaehler[aktion] = (stand.zaehler[aktion] || 0) + 1;
        if (aktion === 'loeschen') stand.geloescht.push(d.id);
      }
      speichere(stand);
      // Im Trockenlauf bleiben die Dokumente in der Abfrage — weiterblättern.
      // Beim Schreiben fallen sie heraus; trotzdem blättern, damit ein
      // zwischendurch verändertes Dokument die Schleife nicht festhält.
      if (s.docs.length) cursor = s.docs[s.docs.length - 1].id;
      if (s.docs.length < BLOCK) break;
    }
    stand.fertig = true;
    speichere(stand);
    console.log(`${SCHREIBEN ? 'GESCHRIEBEN' : 'TROCKENLAUF'} · ${JSON.stringify(stand.zaehler)} · Ergebnis ${ERGEBNIS}`);
  } catch (e) {
    speichere(stand);
    console.error(`FEHLER: ${e && e.message} — Stand in ${ERGEBNIS}`);
    process.exitCode = 1;
  }
}

main();
