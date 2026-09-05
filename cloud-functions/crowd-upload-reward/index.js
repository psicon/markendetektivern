'use strict';

/**
 * crowd-upload-reward
 *
 * Schreibt die Vergütung gut, sobald eine Produkt-Einreichung
 * (`crowd_uploads/{id}`) von `pending` auf `approved` wechselt.
 *
 * WARUM ES DAS GIBT: Bis August 2026 existierte dieser Pfad NICHT. Auf
 * `crowd_uploads` lag nur ein onDocumentCreated-Trigger (Namens-OCR),
 * und ins Geld-Ledger schrieben ausschließlich die Bon-Pipeline und
 * survey-reward. Der Kommentar in productSubmit.ts versprach „reward
 * credited later after review" — das „later" wurde nie gebaut. Folge:
 * 144 freigegebene Einreichungen, 0 Cent ausgezahlt, während die App
 * „0,15 € pro komplettem Datensatz" anzeigte. Der Altbestand wurde
 * einmalig per scripts/backfill-crowd-upload-rewards.js nachgezahlt;
 * ab hier übernimmt dieser Trigger.
 *
 * BUCHUNGSFORM: identisch zu survey-reward und der Bon-Pipeline —
 * `earn`-Eintrag im User-Ledger, Guthaben + Lifetime hoch, Aktions-
 * Gesamtzähler hoch, Aktions-Budget runter. Alles in EINER Transaktion.
 *
 * IDEMPOTENZ über die Doc-ID `crowd_<uploadId>`: ein erneuter Trigger
 * (Firestore garantiert nur at-least-once) findet den Eintrag und bricht
 * ab. Dieselbe ID nutzt auch das Backfill-Skript — ein nachgezahlter
 * Datensatz kann hier also nicht ein zweites Mal gutgeschrieben werden.
 *
 * BEWUSST NICHT angefasst (wie im Backfill, zugunsten des Nutzers):
 *  - `cashback_campaign_weekly`: Wochen-Deckel für BONS. Eine
 *    Foto-Freigabe soll dem Nutzer die Bon-Woche nicht wegnehmen.
 *  - `cashback_monthly`: treibt das Monatslimit für Bons.
 *
 * Ohne `campaignId` wird nichts gebucht — dann lief keine Aktion und es
 * wurde auch nichts versprochen.
 */

const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

const { pruefeOrtsanforderung } = require('./src/locationGate');

admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west1';
const CAMPAIGNS_COL = 'cashback_campaigns';

exports.onCrowdUploadApproved = onDocumentUpdated(
  { document: 'crowd_uploads/{id}', region: REGION },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    // Nur die Flanke nach `approved`. Ein erneutes Speichern eines
    // bereits freigegebenen Dokuments (z.B. durch den OCR-Trigger oder
    // eine Korrektur am Produktnamen) darf nichts auslösen.
    if (before.status === 'approved' || after.status !== 'approved') return;

    const uploadId = event.params.id;
    const uid = after.userId;
    const cid = after.campaignId;

    if (!uid) {
      logger.warn('[crowd-reward] ohne userId — übersprungen', { uploadId });
      return;
    }
    if (!cid) {
      logger.info('[crowd-reward] ohne Aktion — keine Vergütung', { uploadId, uid });
      return;
    }

    // Ortsanforderung des Reward-Programms. Der Wizard verlangt den Ort
    // verpflichtend, aber nur bei aktualisierten Apps — eine Geld-Regel,
    // die nur im Client steht, ist keine Regel.
    const ort = pruefeOrtsanforderung(after);
    if (!ort.ok) {
      // AUSDRÜCKLICH ins Dokument schreiben, nicht nur loggen. Ein still
      // ausbleibender Betrag ist genau das Muster, das schon einmal zu
      // „144 freigegeben, 0 Cent ausgezahlt" geführt hat: niemand sieht
      // einen Fehler, der Nutzer wartet, und es fällt monatelang nicht auf.
      logger.warn('[crowd-reward] ohne Ortsangabe — keine Vergütung', {
        uploadId,
        uid,
        grund: ort.grund,
      });
      await event.data.after.ref.set(
        { rewardSkipped: true, rewardSkippedReason: ort.grund },
        { merge: true },
      );
      return;
    }

    // Orts-Audit 05.09.2026: der ok-GRUND wurde bisher verworfen — 731
    // Gnadenfrist- und 54 GPS-Ausnahme-Zahlungen waren in Firestore von
    // regulären nicht unterscheidbar. Ab jetzt steht die angewandte Regel am
    // Doc (rewardLocationRule), ebenso das Buchungsergebnis (rewardResult /
    // rewardCents / rewardNotCreditedReason) — ein still ausbleibender Betrag
    // ist genau das Muster, das niemand merkt.
    const rewardLocationRule = ort.grund || 'ort_vorhanden';

    const userRef = db.collection('users').doc(uid);
    const ledgerRef = userRef.collection('cashback_ledger').doc(`crowd_${uploadId}`);
    const campRef = db.collection(CAMPAIGNS_COL).doc(cid);

    try {
      const outcome = await db.runTransaction(async (tx) => {
        // ── Reads zuerst (Firestore-Transaktionsregel) ──
        const [ledgerSnap, userSnap, campSnap] = await Promise.all([
          tx.get(ledgerRef),
          tx.get(userRef),
          tx.get(campRef),
        ]);

        if (ledgerSnap.exists) return { cents: 0, reason: 'already_booked' }; // Retry oder Backfill
        if (!campSnap.exists) return { cents: 0, reason: 'campaign_missing' };

        const camp = campSnap.data();
        let pay = Number(camp.cashbackPerBonCents) || 0;
        if (pay <= 0) return { cents: 0, reason: 'no_reward_configured' };

        const u = userSnap.exists ? userSnap.data() : {};
        const balance = u.cashback_balance_cents || 0;
        const lifetime = u.cashback_lifetime_cents || 0;

        // Per-User-Gesamtdeckel der Aktion — gleiche Rechnung wie die
        // Bon-Pipeline (cappt auf den verbleibenden Spielraum).
        const perUserCap = Number(camp.maxPerUserCents) || 0;
        if (perUserCap > 0) {
          const earned = (u.cashback_campaign_totals || {})[cid] || 0;
          pay = Math.min(pay, Math.max(0, perUserCap - earned));
          if (pay <= 0) return { cents: 0, reason: 'per_user_cap_reached' };
        }

        // Budget frisch IN der Transaktion lesen — sonst überzieht ein
        // zweiter paralleler Trigger den letzten Budget-Rest.
        const remaining = Number(camp.budgetRemainingCents);
        if (Number.isFinite(remaining)) {
          pay = Math.min(pay, Math.max(0, remaining));
          if (pay <= 0) return { cents: 0, reason: 'campaign_budget_exhausted' };
        }

        const inc = admin.firestore.FieldValue.increment;
        tx.set(ledgerRef, {
          type: 'earn',
          cents: pay,
          campaignId: cid,
          crowdUploadId: uploadId,
          balanceAfterCents: balance + pay,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: 'product_photos',
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

        return { cents: pay, reason: null };
      });

      const credited = outcome.cents;
      if (credited > 0) {
        logger.info('[crowd-reward] gutgeschrieben', { uploadId, uid, cid, cents: credited, rewardLocationRule });
      } else if (outcome.reason === 'campaign_missing') {
        logger.warn('[crowd-reward] Aktion existiert nicht', { uploadId, cid });
      } else {
        logger.info('[crowd-reward] nichts zu buchen', { uploadId, uid, cid, reason: outcome.reason });
      }
      // Ergebnis ans Doc — messbar, nicht nur im Log. Ein bereits gebuchter
      // Retry (already_booked) überschreibt ein vorhandenes 'credited' NICHT.
      const rewardDoc = { rewardLocationRule, rewardCheckedAt: admin.firestore.FieldValue.serverTimestamp() };
      if (credited > 0) {
        Object.assign(rewardDoc, { rewardResult: 'credited', rewardCents: credited, rewardNotCreditedReason: admin.firestore.FieldValue.delete() });
      } else if (outcome.reason !== 'already_booked') {
        Object.assign(rewardDoc, { rewardResult: 'not_credited', rewardCents: 0, rewardNotCreditedReason: outcome.reason });
      }
      await event.data.after.ref.set(rewardDoc, { merge: true }).catch((e) =>
        logger.warn('[crowd-reward] Ergebnis-Marker nicht geschrieben', { uploadId, err: e.message }),
      );
    } catch (e) {
      // Werfen, damit Firestore erneut zustellt — die Idempotenz über die
      // feste Doc-ID macht einen Retry gefahrlos.
      logger.error('[crowd-reward] Transaktion fehlgeschlagen', {
        uploadId,
        uid,
        err: e.message,
      });
      throw e;
    }
  },
);
