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

    // Umfrage-Felder AUTORITATIV vom Poll lesen (das Response-Doc ist
    // client-geschrieben, nicht vertrauenswürdig). Umfragen sind jetzt
    // EIGENSTÄNDIG: eigener rewardCents + optionales eigenes Budget +
    // optionales Per-User-Limit. KEINE Campaign-Verknüpfung mehr.
    let rewardCents = 0;
    let rewardTrigger = 'completion';
    let hasBudget = false;
    let maxPerUser = 0; // 0 = unbegrenzt
    try {
      const pollSnap = await db.collection('polls').doc(pollId).get();
      if (!pollSnap.exists) return;
      const pd = pollSnap.data() || {};
      if (typeof pd.rewardCents === 'number' && pd.rewardCents > 0) rewardCents = Math.round(pd.rewardCents);
      if (pd.rewardTrigger === 'per_answer' || pd.rewardTrigger === 'none') rewardTrigger = pd.rewardTrigger;
      if (typeof pd.budgetCents === 'number') hasBudget = true;
      if (typeof pd.maxPerUser === 'number' && pd.maxPerUser > 0) maxPerUser = Math.round(pd.maxPerUser);
    } catch (e) {
      logger.error('[survey-reward] poll read failed', { pollId, err: e.message });
      return;
    }
    if (rewardTrigger === 'none' || rewardCents <= 0) {
      // Reine Datensammlung / kein Betrag — nichts gutzuschreiben.
      return;
    }

    const userRef = db.collection('users').doc(uid);
    const ledgerCol = userRef.collection('cashback_ledger');
    const pollRef = db.collection('polls').doc(pollId);
    const responseId = event.params.id;
    // Idempotenz: completion → EINMAL pro (uid, pollId); per_answer →
    // EINMAL pro Antwort (responseId), aber gedeckelt durch maxPerUser.
    const perAnswer = rewardTrigger === 'per_answer';

    try {
      let creditedCents = 0;
      await db.runTransaction(async (tx) => {
        // ── Reads zuerst (Firestore-Transaktions-Regel) ──
        const responseDup = await tx.get(ledgerCol.where('surveyResponseId', '==', responseId));
        if (responseDup.docs.some((d) => d.data()?.type === 'earn')) return; // Doppel-Trigger

        // Alle earns dieser Umfrage des Users → Per-User-Count (+ completion-Dup).
        const pollEarnsSnap = await tx.get(ledgerCol.where('surveyPollId', '==', pollId));
        const pollEarns = pollEarnsSnap.docs.filter((d) => d.data()?.type === 'earn');
        if (!perAnswer && pollEarns.length > 0) return; // completion: schon vergeben
        if (maxPerUser > 0 && pollEarns.length >= maxPerUser) return; // Per-User-Limit erreicht

        // Budget frisch IN der Transaktion (race-frei).
        const pollSnap = hasBudget ? await tx.get(pollRef) : null;
        let pay = rewardCents;
        if (pollSnap) {
          const remaining = typeof pollSnap.data()?.budgetRemainingCents === 'number'
            ? pollSnap.data().budgetRemainingCents
            : (typeof pollSnap.data()?.budgetCents === 'number' ? pollSnap.data().budgetCents : 0);
          pay = Math.max(0, Math.min(rewardCents, remaining));
        }
        if (pay <= 0) return; // Budget erschöpft

        const userSnap = await tx.get(userRef);
        const u = userSnap.exists ? userSnap.data() : {};
        const balance = u.cashback_balance_cents || 0;
        const lifetime = u.cashback_lifetime_cents || 0;

        // ── Writes: earn + Balance/Lifetime (+ Poll-Budget-Decrement) ──
        const ref = ledgerCol.doc();
        tx.set(ref, {
          type: 'earn',
          cents: pay,
          surveyPollId: pollId,
          surveyResponseId: responseId,
          balanceAfterCents: balance + pay,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: 'survey',
        });
        tx.set(
          userRef,
          {
            cashback_balance_cents: balance + pay,
            cashback_lifetime_cents: lifetime + pay,
          },
          { merge: true },
        );
        if (hasBudget) {
          // budgetRemainingCents initialisieren (= budgetCents) falls fehlt, dann dekrementieren.
          const cur = pollSnap && typeof pollSnap.data()?.budgetRemainingCents === 'number'
            ? pollSnap.data().budgetRemainingCents
            : (pollSnap && typeof pollSnap.data()?.budgetCents === 'number' ? pollSnap.data().budgetCents : 0);
          tx.set(pollRef, { budgetRemainingCents: cur - pay }, { merge: true });
        }
        creditedCents = pay;
      });
      if (creditedCents > 0) {
        logger.info('[survey-reward] credited', { uid, pollId, creditedCents });
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
