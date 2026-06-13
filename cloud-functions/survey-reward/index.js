/**
 * survey-reward (ClickUp 86ca8fbpz)
 *
 * Firestore onCreate-Trigger auf `poll_responses/{id}`. Schreibt den
 * Cashback-Taler-Reward einer abgeschlossenen Umfrage IDEMPOTENT in den
 * User-Ledger (`users/{uid}/cashback_ledger`) + erhöht Balance/Lifetime.
 *
 * Warum server-seitig: der Ledger ist client-write-locked (Firestore-
 * Rules `allow write: if false`); Gutschriften gehören aus Anti-Abuse-
 * Gründen auf den Server. Die App schreibt nur die Antwort
 * (poll_responses), nie den Ledger.
 *
 * Idempotenz: pro (uid, pollId) genau EIN earn — ein zweites Response-
 * Doc (Doppel-Submit) oder ein doppelt gefeuerter Trigger findet den
 * bestehenden earn und macht no-op. Der Reward-Betrag kommt vom Poll
 * (`polls/{pollId}.rewardCents`), NICHT aus dem (client-geschriebenen)
 * Response-Doc — der Client kann den Betrag nicht fälschen.
 *
 * Deployment-Codebase: survey-reward
 */

const admin = require('firebase-admin');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Konsistent mit der Cashback-Pipeline (gleicher Ledger).
const REGION = 'europe-west3';

exports.onPollResponseCreated = onDocumentCreated(
  {
    document: 'poll_responses/{id}',
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 60,
    maxInstances: 10,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const resp = snap.data() || {};
    const uid = resp.userId;
    const pollId = resp.pollId;
    if (!uid || !pollId) {
      logger.warn('[survey-reward] missing userId/pollId', { id: event.params.id });
      return;
    }

    // Reward-Quelle AUTORITATIV vom Poll lesen (nicht aus dem Response-
    // Doc — das ist client-geschrieben und nicht vertrauenswürdig).
    //   • campaignId gesetzt → Reward aus der Aktion (cashbackPerBonCents),
    //     gedeckelt aufs verbleibende Budget; Budget wird dekrementiert.
    //   • sonst → poll.rewardCents (Fallback).
    let fallbackReward = 0;
    let campaignId = null;
    let rewardTrigger = 'completion';
    try {
      const pollSnap = await db.collection('polls').doc(pollId).get();
      if (pollSnap.exists) {
        const pd = pollSnap.data() || {};
        const v = pd.rewardCents;
        if (typeof v === 'number' && v > 0) fallbackReward = Math.round(v);
        if (typeof pd.campaignId === 'string' && pd.campaignId) campaignId = pd.campaignId;
        if (pd.rewardTrigger === 'per_answer' || pd.rewardTrigger === 'none') {
          rewardTrigger = pd.rewardTrigger;
        }
      }
    } catch (e) {
      logger.error('[survey-reward] poll read failed', { pollId, err: e.message });
      return;
    }
    if (rewardTrigger === 'none') {
      // Reine Datensammlung — keine Vergütung.
      return;
    }
    if (!campaignId && fallbackReward <= 0) {
      // Umfrage ohne Reward (kein Budget-Topf, kein Fallback) — nichts zu tun.
      return;
    }

    const userRef = db.collection('users').doc(uid);
    const ledgerCol = userRef.collection('cashback_ledger');
    const campaignRef = campaignId ? db.collection('cashback_campaigns').doc(campaignId) : null;
    const responseId = event.params.id;
    // Idempotenz-Schlüssel:
    //   • completion → EINMAL pro (uid, pollId)
    //   • per_answer → EINMAL pro Antwort (responseId) — jede Antwort zahlt
    const perAnswer = rewardTrigger === 'per_answer';

    try {
      let creditedCents = 0;
      await db.runTransaction(async (tx) => {
        // ── Reads zuerst (Firestore-Transaktions-Regel) ──
        // Idempotenz: Single-Field-Query (kein Composite-Index nötig) +
        // in-memory Filter — der Ledger pro User ist klein.
        const dupField = perAnswer ? 'surveyResponseId' : 'surveyPollId';
        const dupValue = perAnswer ? responseId : pollId;
        const existing = await tx.get(ledgerCol.where(dupField, '==', dupValue));
        const hasEarn = existing.docs.some((d) => d.data()?.type === 'earn');
        if (hasEarn) {
          // Reward bereits vergeben (Doppel-Submit / Trigger-Retry).
          return;
        }
        const userSnap = await tx.get(userRef);
        // Aktion frisch IN der Transaktion lesen → Budget race-frei cappen.
        const campaignSnap = campaignRef ? await tx.get(campaignRef) : null;

        // Reward bestimmen.
        let rewardCents = fallbackReward;
        if (campaignSnap && campaignSnap.exists) {
          const c = campaignSnap.data() || {};
          const perBon = typeof c.cashbackPerBonCents === 'number' ? c.cashbackPerBonCents : 0;
          const remaining = typeof c.budgetRemainingCents === 'number' ? c.budgetRemainingCents : 0;
          rewardCents = Math.max(0, Math.min(perBon, remaining));
        }
        if (rewardCents <= 0) {
          // Budget erschöpft / Aktion liefert 0 → kein Reward (kein no-op-Fehler).
          return;
        }

        const u = userSnap.exists ? userSnap.data() : {};
        const balance = u.cashback_balance_cents || 0;
        const lifetime = u.cashback_lifetime_cents || 0;

        // ── Writes: earn + Balance/Lifetime (+ Budget-Decrement) ──
        const ref = ledgerCol.doc();
        tx.set(ref, {
          type: 'earn',
          cents: rewardCents,
          surveyPollId: pollId,
          surveyResponseId: event.params.id,
          campaignId: campaignId || null,
          balanceAfterCents: balance + rewardCents,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: 'survey',
        });
        tx.set(
          userRef,
          {
            cashback_balance_cents: balance + rewardCents,
            cashback_lifetime_cents: lifetime + rewardCents,
          },
          { merge: true },
        );
        if (campaignRef) {
          // Budget transaktional dekrementieren (merge+increment → race-frei).
          tx.set(
            campaignRef,
            { budgetRemainingCents: admin.firestore.FieldValue.increment(-rewardCents) },
            { merge: true },
          );
        }
        creditedCents = rewardCents;
      });
      if (creditedCents > 0) {
        logger.info('[survey-reward] credited', { uid, pollId, creditedCents, campaignId });
      }
    } catch (e) {
      logger.error('[survey-reward] ledger tx failed', {
        uid,
        pollId,
        err: e.message,
      });
      // Kein Re-throw: ein fehlgeschlagener Reward darf keine Trigger-
      // Retry-Schleife auslösen (der User hat trotzdem geantwortet).
    }
  },
);
