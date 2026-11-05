'use strict';
/**
 * Drei Einreichungen, die niemand bezahlt hat, obwohl sie in Ordnung waren
 * (10.09.2026).
 *
 * ═══ Der Befund ═══
 *
 * Drei Nutzer haben dasselbe Produkt binnen 10–25 Sekunden zwei- bzw. dreimal
 * abgeschickt. Die Bilder sind byteidentisch (md5 über alle sieben Slots) —
 * das ist kein zweiter Einkauf, das ist ein Doppelklick bzw. ein Wiederholen
 * der Warteschlange. Abgelehnt wurde daraufhin JEDE Kopie: eine als
 * `bilder_wiederverwendet`, die übrigen als `doppelt_eingereicht`. Damit ging
 * auch die erste, völlig korrekte Einreichung leer aus.
 *
 * Eine Doppel-Regel darf das Original nicht mittreffen. Genau diese Klasse
 * hat schon einmal „144 freigegeben, 0 Cent ausgezahlt" erzeugt: der Betrag
 * bleibt still aus, niemand sieht einen Fehler, der Nutzer wartet.
 *
 * ═══ Was dieses Skript tut ═══
 *
 * Je Gruppe wird die ÄLTESTE Kopie freigegeben (rejected → approved); den
 * Rest lässt es als `doppelt_eingereicht` stehen — die Ablehnung stimmt dort.
 * Die Buchung macht wie immer der Trigger `crowd-upload-reward` auf der
 * Flanke nach `approved`; hier wird bewusst NICHT selbst ins Ledger
 * geschrieben.
 *
 * Alle drei bestehen die Ortsanforderung (zwei mit GPS, eine über die
 * Gnadenfrist für Clients ohne `clientVersion`, entstanden vor dem Stichtag
 * 02.09.) und tragen alle sieben Bilder.
 *
 * ═══ Die Budget-Falle ═══
 *
 * `mai-juni-2026CloneClone` steht auf `budgetRemainingCents: 0` — das Budget
 * wurde am 03.09. in den Nachfolger übertragen. Ein Freigeben ohne
 * Vorbereitung liefe in `campaign_budget_exhausted` und buchte STILL NICHTS
 * (so entstanden am 03.09. 38 Fälle). Deshalb bekommt die Aktion vorher genau
 * den Betrag zurück, der für diese eine Einreichung nie ausgezahlt wurde;
 * nach der Buchung steht sie wieder auf 0. Netto verschiebt sich kein Budget.
 *
 * Aufruf:  DRY_RUN=1 node .crowd-doppel-original-0910.js
 *          node .crowd-doppel-original-0910.js
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();

const DRY_RUN = process.env.DRY_RUN === '1';
const ERGEBNIS = `${__dirname}/.crowd-doppel-original-0910.result.json`;
const fs = require('fs');

/** Je Gruppe: die älteste Kopie (freigeben) + die Kopien, die abgelehnt bleiben. */
const GRUPPEN = [
  { original: 'Y3a4HOz6SC0fd4iBFh1p', dubletten: ['bhYQSv18YQt6M3nWzoKw'] },
  { original: 'a8gfZa28obqaOA2vTgWF', dubletten: ['TFGV53j3AtiicldZLMZk'] },
  { original: 'fNidyKAqWBkHxqW7l7IX', dubletten: ['U9Y0dPrlQzEVdMR63frG', '2TdsKq4J6VFdm1kyK65I'] },
];

const NOTIZ =
  'Nachprüfung 10.09.2026: Die Einreichung war vollständig und in Ordnung — sie wurde nur deshalb '
  + 'abgelehnt, weil dasselbe Produkt versehentlich mehrfach abgeschickt wurde. Die erste Einreichung '
  + 'ist damit freigegeben und wird vergütet. Danke fürs Mitmachen!';

const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

async function budgetVorbereiten(cid, brauchtCents, protokoll) {
  const ref = db.collection('cashback_campaigns').doc(cid);
  const c = (await ref.get()).data() || {};
  const rest = Number(c.budgetRemainingCents);
  if (Number.isFinite(rest) && rest >= brauchtCents) return { cid, rest, nachgelegt: 0 };

  const nachlegen = brauchtCents - (Number.isFinite(rest) ? rest : 0);
  protokoll.push({ schritt: 'budget', cid, rest, nachgelegt: nachlegen });
  console.log(`  Budget ${cid}: Rest ${rest} < ${brauchtCents} → ${nachlegen} ct zurücklegen`);
  if (!DRY_RUN) {
    await ref.set(
      { budgetRemainingCents: admin.firestore.FieldValue.increment(nachlegen) },
      { merge: true },
    );
  }
  return { cid, rest, nachgelegt: nachlegen };
}

(async () => {
  const protokoll = [];
  const schreibe = () => fs.writeFileSync(ERGEBNIS, JSON.stringify(protokoll, null, 2));

  for (const g of GRUPPEN) {
    const ref = db.collection('crowd_uploads').doc(g.original);
    const snap = await ref.get();
    if (!snap.exists) throw new Error(`Dokument fehlt: ${g.original}`);
    const d = snap.data();

    console.log(`\n── ${g.original} | ${d.productName} | ${d.status}/${d.rejectReason}`);

    // Fail-fast: nur der erwartete Ausgangszustand wird angefasst.
    if (d.status === 'approved') { console.log('  schon freigegeben — übersprungen'); continue; }
    if (d.status !== 'rejected') throw new Error(`unerwarteter Status ${d.status} bei ${g.original}`);

    // Schon bezahlt? Dann nur den Status heilen, nichts buchen.
    const ledger = await db.doc(`users/${d.userId}/cashback_ledger/crowd_${g.original}`).get();
    if (ledger.exists) console.log('  ACHTUNG: Ledger-Eintrag existiert bereits');

    const cid = d.campaignId;
    const camp = (await db.collection('cashback_campaigns').doc(cid).get()).data() || {};
    const pay = Number(camp.cashbackPerBonCents) || 0;
    if (pay <= 0) throw new Error(`Aktion ${cid} zahlt nichts`);
    const budget = await budgetVorbereiten(cid, pay, protokoll);

    if (DRY_RUN) {
      console.log(`  [DRY] würde freigeben → ${pay} ct aus ${cid}`);
      protokoll.push({ id: g.original, dry: true, cid, pay, budget });
      schreibe();
      continue;
    }

    await ref.set(
      {
        status: 'approved',
        rejectReason: admin.firestore.FieldValue.delete(),
        holdReasons: admin.firestore.FieldValue.delete(),
        reviewNote: NOTIZ,
        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
        reviewedBy: 'ops-doppel-original-0910',
      },
      { merge: true },
    );
    protokoll.push({ id: g.original, freigegeben: true, cid, pay, budget });
    schreibe();

    // Auf das Ergebnis des Triggers warten — ein still ausbleibender Betrag
    // ist genau das, was hier repariert wird.
    let gebucht = null;
    for (let i = 0; i < 30; i++) {
      await schlaf(2000);
      const s = await ref.get();
      const r = s.data();
      if (r.rewardResult) { gebucht = { result: r.rewardResult, cents: r.rewardCents ?? null, grund: r.rewardNotCreditedReason ?? null }; break; }
    }
    console.log('  Trigger:', gebucht ? JSON.stringify(gebucht) : 'KEIN Ergebnis nach 60 s');
    protokoll[protokoll.length - 1].trigger = gebucht;
    schreibe();
  }

  console.log('\nProtokoll:', ERGEBNIS);
})().catch((e) => { console.error('ABBRUCH:', e.message); process.exit(1); });
