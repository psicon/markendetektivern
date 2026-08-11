#!/usr/bin/env node
'use strict';

/**
 * Ortsangaben + Lieblingsmarkt auf bestehende Produkt-Einreichungen
 * (`crowd_uploads`) nachtragen.
 *
 * Neue Einreichungen bekommen den Kontext seit `productSubmit.collectContext`
 * direkt beim Anlegen. Dieses Skript holt den Altbestand nach.
 *
 * WICHTIGER UNTERSCHIED, der im Dokument festgehalten wird:
 * Bei neuen Einreichungen ist der Lieblingsmarkt der Stand ZUM ZEITPUNKT
 * DER AUFNAHME. Beim Nachtragen ist er der Stand VON HEUTE — wer seinen
 * Lieblingsmarkt seither geändert hat, bekommt rückwirkend den neuen.
 * Deshalb setzt dieses Skript zusätzlich `contextBackfilled: true`. Wer
 * die Daten auswertet, kann beide Fälle trennen; ohne das Flag würde ein
 * nachgetragener Wert wie eine Aufnahme-Beobachtung aussehen.
 *
 * NICHT nachgetragen wird `journeyLocation`: die gehört zu einer
 * konkreten Sitzung, und eine alte Einreichung lässt sich keiner Journey
 * verlässlich zuordnen. Ein geratener Ort wäre schlimmer als keiner.
 *
 * Idempotent: Dokumente, die bereits `favoriteMarket` ODER `userLocation`
 * tragen, werden übersprungen.
 *
 * Aufruf:
 *   node scripts/backfill-crowd-upload-context.js            # Trockenlauf
 *   node scripts/backfill-crowd-upload-context.js --execute  # schreibt
 */

const admin = require('firebase-admin');

const EXECUTE = process.argv.includes('--execute');
const PROJECT = 'markendetektive-895f7';

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

async function main() {
  console.log(EXECUTE ? '### ECHTLAUF ###' : '### TROCKENLAUF — nichts wird geschrieben ###');

  const ups = await db.collection('crowd_uploads').get();
  const uids = [...new Set(ups.docs.map((d) => d.data().userId).filter(Boolean))];

  // Nutzerprofile einmal laden statt pro Einreichung.
  const profil = {};
  for (const uid of uids) {
    const s = await db.collection('users').doc(uid).get();
    const u = s.exists ? s.data() : {};
    const ctx = {};
    if (u.favoriteMarket || u.favoriteMarketName) {
      ctx.favoriteMarket = {
        id: u.favoriteMarket ?? null,
        name: u.favoriteMarketName ?? null,
      };
    }
    if (u.location || u.city || u.bundesland) {
      ctx.userLocation = {
        address: u.location ?? null,
        city: u.city ?? null,
        bundesland: u.bundesland ?? null,
      };
    }
    profil[uid] = ctx;
  }

  const stats = { markt: 0, ort: 0, geschrieben: 0, schonDa: 0, nichtsBekannt: 0 };
  let batch = db.batch();
  let offen = 0;

  for (const d of ups.docs) {
    const x = d.data();
    const ctx = profil[x.userId];
    if (!ctx || Object.keys(ctx).length === 0) {
      stats.nichtsBekannt++;
      continue;
    }
    if (x.favoriteMarket || x.userLocation) {
      stats.schonDa++;
      continue;
    }

    if (ctx.favoriteMarket) stats.markt++;
    if (ctx.userLocation) stats.ort++;
    stats.geschrieben++;

    if (EXECUTE) {
      batch.set(d.ref, { ...ctx, contextBackfilled: true }, { merge: true });
      if (++offen >= 400) {
        await batch.commit();
        batch = db.batch();
        offen = 0;
      }
    }
  }
  if (EXECUTE && offen > 0) await batch.commit();

  console.log('\n=== Ergebnis ===');
  console.log(`  Einreichungen gesamt:            ${ups.size}`);
  console.log(`  ${EXECUTE ? 'ergänzt' : 'würde ergänzen'}:${' '.repeat(EXECUTE ? 25 : 18)}${stats.geschrieben}`);
  console.log(`    davon mit Lieblingsmarkt:      ${stats.markt}`);
  console.log(`    davon mit Selbstauskunft-Ort:  ${stats.ort}`);
  console.log(`  trugen den Kontext schon:        ${stats.schonDa}`);
  console.log(`  Nutzer ohne beides:              ${stats.nichtsBekannt}`);
  if (!EXECUTE) console.log('\nZum Schreiben erneut mit --execute aufrufen.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Abbruch:', e);
    process.exit(1);
  });
