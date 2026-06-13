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

    // Reward-Betrag AUTORITATIV vom Poll lesen (nicht aus dem Response-
    // Doc — das ist client-geschrieben und nicht vertrauenswürdig).
    let rewardCents = 0;
    try {
      const pollSnap = await db.collection('polls').doc(pollId).get();
      if (pollSnap.exists) {
        const v = pollSnap.data()?.rewardCents;
        if (typeof v === 'number' && v > 0) rewardCents = Math.round(v);
      }
    } catch (e) {
      logger.error('[survey-reward] poll read failed', { pollId, err: e.message });
      return;
    }
    if (rewardCents <= 0) {
      // Umfrage ohne Reward — nichts gutzuschreiben.
      return;
    }

    const userRef = db.collection('users').doc(uid);
    const ledgerCol = userRef.collection('cashback_ledger');

    try {
      await db.runTransaction(async (tx) => {
        // ── Reads zuerst (Firestore-Transaktions-Regel) ──
        // Idempotenz: existiert für diese (uid, pollId) schon ein earn?
        // Single-Field-Query (kein Composite-Index nötig) + in-memory
        // type-Filter — der Ledger pro User ist klein.
        const existing = await tx.get(ledgerCol.where('surveyPollId', '==', pollId));
        const hasEarn = existing.docs.some((d) => d.data()?.type === 'earn');
        if (hasEarn) {
          // Reward bereits vergeben (Doppel-Submit / Trigger-Retry).
          return;
        }
        const userSnap = await tx.get(userRef);
        const u = userSnap.exists ? userSnap.data() : {};
        const balance = u.cashback_balance_cents || 0;
        const lifetime = u.cashback_lifetime_cents || 0;

        // ── Write: earn + Balance/Lifetime ──
        const ref = ledgerCol.doc();
        tx.set(ref, {
          type: 'earn',
          cents: rewardCents,
          surveyPollId: pollId,
          surveyResponseId: event.params.id,
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
      });
      logger.info('[survey-reward] credited', { uid, pollId, rewardCents });
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
