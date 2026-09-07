// Nachzahlung für freigegebene Produktfoto-Einreichungen, die WÄHREND einer
// laufenden Aktion eingereicht wurden, aber mit campaignId null im Dokument
// landeten (Client-Bug, ClickUp 86cbet2nw) — und deshalb vom Backfill vom
// 07.08.2026 bewusst übersprungen wurden ("ohne campaignId lief keine Aktion").
//
// Diese Annahme ist widerlegt: die Aktion `mai-juni-2026CloneClone` lief
// vom 01.07. bis 31.08.2026 mit 15 ct je Datensatz. 58 vollständige (7 Fotos),
// freigegebene Einreichungen von 43 Nutzern fielen in dieses Fenster.
//
// Buchungsform wie überall: EINE Transaktion, Ledger-ID crowd_<uploadId>
// (idempotent — derselbe Schlüssel, den Trigger und Backfill nutzen).
// Perioden-Zähler (cashback_campaign_weekly, cashback_monthly) werden BEWUSST
// NICHT erhöht: eine Nachzahlung für unser Versäumnis darf dem Nutzer nicht
// seine laufende Woche wegnehmen. Der Per-User-Deckel der ALTEN Aktion wird
// dagegen eingehalten.
//
//   DRY_RUN=1 node .nachzahlung-juli-august.js   # zählt nur
//   node .nachzahlung-juli-august.js             # bucht
'use strict';
const fs = require('fs');
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const DRY = process.env.DRY_RUN === '1';
const OUT = '.nachzahlung-juli-august.result.json';

(async () => {
  const kandidaten = JSON.parse(fs.readFileSync('.nachzahlung-kandidaten.json', 'utf8'));
  const erledigt = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const fertig = new Set(erledigt.map((x) => x.id));
  const offen = kandidaten.filter((k) => !fertig.has(k.id));
  console.log(`${offen.length} nachzuzahlen${DRY ? ' (TROCKENLAUF)' : ''}`);

  let summe = 0;
  const zaehl = {};
  for (const k of offen) {
    const campRef = db.collection('cashback_campaigns').doc(k.aktion);
    const userRef = db.doc(`users/${k.uid}`);
    const ledgerRef = db.doc(`users/${k.uid}/cashback_ledger/crowd_${k.id}`);
    const uploadRef = db.collection('crowd_uploads').doc(k.id);

    const ergebnis = await db.runTransaction(async (tx) => {
      const [led, user, camp, upload] = await Promise.all([
        tx.get(ledgerRef), tx.get(userRef), tx.get(campRef), tx.get(uploadRef),
      ]);
      if (led.exists) return { cents: 0, grund: 'bereits_gebucht' };
      if (!upload.exists || upload.data().status !== 'approved') return { cents: 0, grund: 'nicht_freigegeben' };
      if (!camp.exists) return { cents: 0, grund: 'aktion_fehlt' };

      const c = camp.data();
      let pay = Number(c.cashbackPerBonCents) || 0;
      if (pay <= 0) return { cents: 0, grund: 'kein_betrag' };

      const u = user.exists ? user.data() : {};
      const cap = Number(c.maxPerUserCents) || 0;
      if (cap > 0) {
        const bisher = (u.cashback_campaign_totals || {})[k.aktion] || 0;
        pay = Math.min(pay, Math.max(0, cap - bisher));
        if (pay <= 0) return { cents: 0, grund: 'nutzerdeckel' };
      }

      const balance = u.cashback_balance_cents || 0;
      const lifetime = u.cashback_lifetime_cents || 0;
      const inc = admin.firestore.FieldValue.increment;
      if (DRY) return { cents: pay, grund: 'wuerde_buchen' };

      tx.set(ledgerRef, {
        type: 'earn', cents: pay, campaignId: k.aktion, crowdUploadId: k.id,
        balanceAfterCents: balance + pay, createdAt: admin.firestore.FieldValue.serverTimestamp(),
        reason: 'product_photos', backfilled: true, backfillGrund: 'client_ohne_campaignId_86cbet2nw',
      });
      tx.set(userRef, {
        cashback_balance_cents: balance + pay,
        cashback_lifetime_cents: lifetime + pay,
        cashback_campaign_totals: { [k.aktion]: inc(pay) },
      }, { merge: true });
      // Budget der alten Aktion steht auf 0 (in den September-Topf übertragen).
      // Nicht ins Minus schreiben — die Nachzahlung ist eine Altlast, kein
      // laufender Verbrauch; der Vermerk am Dokument macht sie auffindbar.
      tx.set(uploadRef, {
        campaignId: k.aktion,
        rewardResult: 'credited',
        rewardCents: pay,
        rewardNachgezahltAm: admin.firestore.FieldValue.serverTimestamp(),
        rewardNachzahlungGrund: 'client_ohne_campaignId_86cbet2nw',
      }, { merge: true });
      return { cents: pay, grund: null };
    });

    summe += ergebnis.cents;
    const key = ergebnis.grund || 'gebucht';
    zaehl[key] = (zaehl[key] || 0) + 1;
    if (!DRY) {
      erledigt.push({ id: k.id, uid: k.uid, cents: ergebnis.cents, grund: ergebnis.grund });
      fs.writeFileSync(OUT, JSON.stringify(erledigt, null, 1));
    }
  }
  console.log(`Ergebnis: ${JSON.stringify(zaehl)} | Summe ${(summe / 100).toFixed(2)} €`);
})().catch((e) => { console.error('ABBRUCH', e.message); process.exit(1); });
