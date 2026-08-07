#!/usr/bin/env node
'use strict';

/**
 * Nachvergütung für freigegebene Produkt-Einreichungen (crowd_uploads).
 *
 * WARUM ES DAS GIBT: Bis August 2026 gab es KEINEN Pfad, der eine
 * freigegebene Einreichung in Geld verwandelt. Auf `crowd_uploads` liegt
 * nur ein onDocumentCreated-Trigger (Namens-OCR); ins Geld-Ledger
 * schreiben ausschließlich die Bon-Pipeline und survey-reward. Der
 * Kommentar in productSubmit.ts sagt „reward credited later after
 * review" — dieses „later" wurde nie gebaut. Ergebnis: 144 freigegebene
 * Einreichungen, 0 Cent ausgezahlt, während die Aktion in der App
 * „0,15 € pro komplettem Datensatz" verspricht.
 *
 * Dieses Skript holt das einmalig nach. Der laufende Betrieb hängt am
 * neuen onCrowdUploadApproved-Trigger (cloud-functions/crowd-upload-reward).
 *
 * SICHERHEITEN:
 *  - Trockenlauf ist der Standard. Geschrieben wird nur mit --execute.
 *  - Idempotent über eine deterministische Ledger-Doc-ID
 *    (`crowd_<uploadId>`): ein zweiter Lauf findet das Dokument und
 *    überspringt es. Keine Doppelgutschrift, auch nicht bei Abbruch.
 *  - Jede Gutschrift läuft in EINER Transaktion (Ledger + Guthaben +
 *    Aktions-Zähler + Budget), damit nichts halb gebucht bleibt.
 *  - Budget und Per-User-Deckel werden IN der Transaktion frisch gelesen.
 *
 * BEWUSST NICHT angefasst:
 *  - `cashback_campaign_weekly`: das ist der Wochen-Deckel für BONS.
 *    Eine Nachzahlung für Einreichungen aus der Vergangenheit würde dem
 *    Nutzer sonst die laufende Woche blockieren.
 *  - `cashback_monthly`: treibt das Monatslimit. Eine Nachzahlung für
 *    unser Versäumnis soll das Limit des Nutzers nicht aufbrauchen.
 *  Beides ist zugunsten des Nutzers entschieden.
 *
 * EINREICHUNGEN OHNE campaignId bekommen nichts — für sie lief keine
 * Aktion, es wurde also auch nichts versprochen.
 *
 * Aufruf:
 *   node scripts/backfill-crowd-upload-rewards.js            # Trockenlauf
 *   node scripts/backfill-crowd-upload-rewards.js --execute  # bucht
 */

const admin = require('firebase-admin');

const EXECUTE = process.argv.includes('--execute');
const PROJECT = 'markendetektive-895f7';

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

const eur = (c) => (c / 100).toFixed(2).replace('.', ',') + ' €';

async function main() {
  console.log(EXECUTE ? '### ECHTLAUF — es wird gebucht ###' : '### TROCKENLAUF — nichts wird geschrieben ###');
  console.log(`Projekt: ${PROJECT}\n`);

  const snap = await db
    .collection('crowd_uploads')
    .where('status', '==', 'approved')
    .get();

  const withCampaign = snap.docs.filter((d) => d.data().campaignId);
  const withoutCampaign = snap.docs.length - withCampaign.length;
  console.log(`Freigegebene Einreichungen: ${snap.docs.length}`);
  console.log(`  mit Aktion:  ${withCampaign.length}  -> Anspruch`);
  console.log(`  ohne Aktion: ${withoutCampaign}  -> kein Anspruch (kein Versprechen)\n`);

  // Aktionen einmal laden (Betrag + Deckel je Aktion).
  const campaignIds = [...new Set(withCampaign.map((d) => d.data().campaignId))];
  const campaigns = {};
  for (const cid of campaignIds) {
    const c = await db.collection('cashback_campaigns').doc(cid).get();
    if (!c.exists) {
      console.log(`  ! Aktion ${cid} existiert nicht — diese Einreichungen werden übersprungen`);
      continue;
    }
    campaigns[cid] = c.data();
    console.log(
      `Aktion ${cid}: ${eur(c.data().cashbackPerBonCents || 0)} pro Datensatz, ` +
        `Budget übrig ${eur(c.data().budgetRemainingCents || 0)}, ` +
        `Deckel pro Nutzer ${eur(c.data().maxPerUserCents || 0)}`,
    );
  }
  console.log('');

  const stats = { gebucht: 0, cents: 0, schonGebucht: 0, deckel: 0, budgetLeer: 0, fehler: 0, keineAktion: 0 };

  for (const doc of withCampaign) {
    const up = doc.data();
    const uid = up.userId;
    const cid = up.campaignId;
    const camp = campaigns[cid];
    if (!camp) { stats.keineAktion++; continue; }
    if (!uid) { stats.fehler++; continue; }

    const betrag = Number(camp.cashbackPerBonCents) || 0;
    if (betrag <= 0) { stats.keineAktion++; continue; }

    const userRef = db.collection('users').doc(uid);
    const ledgerRef = userRef.collection('cashback_ledger').doc(`crowd_${doc.id}`);
    const campRef = db.collection('cashback_campaigns').doc(cid);

    try {
      const ergebnis = await db.runTransaction(async (tx) => {
        // ── Reads zuerst (Firestore-Transaktionsregel) ──
        const [ledgerSnap, userSnap, campSnap] = await Promise.all([
          tx.get(ledgerRef),
          tx.get(userRef),
          tx.get(campRef),
        ]);

        if (ledgerSnap.exists) return { art: 'schonGebucht' };

        const u = userSnap.exists ? userSnap.data() : {};
        const balance = u.cashback_balance_cents || 0;
        const lifetime = u.cashback_lifetime_cents || 0;

        // Per-User-Deckel der Aktion — gleiche Rechnung wie die Bon-Pipeline.
        let pay = betrag;
        const perUserCap = Number(campSnap.data()?.maxPerUserCents) || 0;
        if (perUserCap > 0) {
          const earned = (u.cashback_campaign_totals || {})[cid] || 0;
          const headroom = Math.max(0, perUserCap - earned);
          pay = Math.min(pay, headroom);
          if (pay <= 0) return { art: 'deckel' };
        }

        // Budget frisch in der Transaktion (race-frei).
        const remaining = Number(campSnap.data()?.budgetRemainingCents);
        if (Number.isFinite(remaining)) {
          pay = Math.min(pay, Math.max(0, remaining));
          if (pay <= 0) return { art: 'budgetLeer' };
        }

        if (!EXECUTE) return { art: 'gebucht', cents: pay, probe: true };

        const inc = admin.firestore.FieldValue.increment;
        tx.set(ledgerRef, {
          type: 'earn',
          cents: pay,
          campaignId: cid,
          crowdUploadId: doc.id,
          balanceAfterCents: balance + pay,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: 'product_photos',
          backfill: true, // Nachvergütung, kein Live-Vorgang
        });
        tx.set(
          userRef,
          {
            cashback_balance_cents: balance + pay,
            cashback_lifetime_cents: lifetime + pay,
            cashback_campaign_totals: { [cid]: inc(pay) },
          },
          { merge: true },
        );
        tx.set(campRef, { budgetRemainingCents: inc(-pay) }, { merge: true });

        return { art: 'gebucht', cents: pay };
      });

      if (ergebnis.art === 'gebucht') {
        stats.gebucht++;
        stats.cents += ergebnis.cents;
      } else {
        stats[ergebnis.art]++;
      }
    } catch (e) {
      stats.fehler++;
      console.log(`  ! Fehler bei ${doc.id} (uid ${String(uid).slice(0, 8)}): ${e.message}`);
    }
  }

  console.log('=== Ergebnis ===');
  console.log(`  ${EXECUTE ? 'gebucht' : 'würde buchen'}: ${stats.gebucht} Einreichungen = ${eur(stats.cents)}`);
  console.log(`  bereits gebucht (übersprungen): ${stats.schonGebucht}`);
  console.log(`  am Nutzer-Deckel gestoppt:      ${stats.deckel}`);
  console.log(`  Budget erschöpft:               ${stats.budgetLeer}`);
  console.log(`  Aktion fehlt/ohne Betrag:       ${stats.keineAktion}`);
  console.log(`  Fehler:                         ${stats.fehler}`);
  if (!EXECUTE) console.log('\nZum Buchen erneut mit --execute aufrufen.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Abbruch:', e);
    process.exit(1);
  });
