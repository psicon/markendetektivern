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

// Reward-Grace nach endDate: wer einen Tick nach Ablauf submittet (5-Min-
// Anzeige-Cache + Ausfüllzeit + kurze Offline-Sync-Verzögerung) bekommt den
// Taler noch. Die ANZEIGE ist strikt (surveyService.isWithinWindow), hier nur
// eine kleine Toleranz gegen Frust. 0 = strikt.
const REWARD_GRACE_MS = 60 * 60 * 1000; // 1 h

/**
 * Poll-Zeitfeld robust nach ms. Die DATEN sind Firestore-Timestamps (RevealyIQ),
 * NICHT die im Typ deklarierten ISO-Strings → `Date.parse(timestamp)` wäre NaN.
 * Deckt Timestamp (.toMillis/.toDate), serialisierten Timestamp, ISO-String,
 * ms-Zahl und Date ab. null = leer/unbekannt.
 */
function pollTimeMs(v) {
  if (v == null) return null;
  if (typeof v.toMillis === 'function') { try { const m = v.toMillis(); return Number.isFinite(m) ? m : null; } catch { /* */ } }
  if (typeof v.toDate === 'function') { try { const t = v.toDate().getTime(); return Number.isFinite(t) ? t : null; } catch { /* */ } }
  if (typeof v._seconds === 'number') return v._seconds * 1000 + Math.floor((v._nanoseconds || 0) / 1e6);
  if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  if (v instanceof Date) { const t = v.getTime(); return Number.isFinite(t) ? t : null; }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
}

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

      // ── Zeitfenster server-autoritativ prüfen (Bug-Fix: endDate wurde
      // NIRGENDS beachtet). endDate/startDate sind Firestore-Timestamps, NICHT
      // die deklarierten ISO-Strings → via pollTimeMs auflösen (Date.parse wäre
      // NaN). Gegen den SERVER-Zeitpunkt des Response-Writes (event.time)
      // prüfen, nicht gegen client-Zeit. endDate mit Grace; Antwort bleibt in
      // jedem Fall gespeichert (RevealyIQ-Auswertung), nur kein Taler.
      const respMs = event.time ? Date.parse(event.time) : Date.now();
      const startMs = pollTimeMs(pd.startDate);
      const endMs = pollTimeMs(pd.endDate);
      if (startMs != null && Number.isFinite(respMs) && respMs < startMs) {
        logger.info('[survey-reward] skip: poll not started', { pollId });
        return;
      }
      if (endMs != null && Number.isFinite(respMs) && respMs > endMs + REWARD_GRACE_MS) {
        logger.info('[survey-reward] skip: poll ended', { pollId });
        return;
      }
    } catch (e) {
      logger.error('[survey-reward] poll read failed', { pollId, err: e.message });
      return;
    }
    if (rewardTrigger === 'none' || rewardCents <= 0) {
      // Reine Datensammlung / kein Betrag — nichts gutzuschreiben.
      return;
    }

    // ── Cashback-Berechtigung (ClickUp 86ca8fbpz) ──
    // Taler NUR für registrierte User MIT aktivem Markt-Consent (gleiche
    // Regel wie die Bon-Pipeline). Anonyme / Consent-lose User dürfen die
    // Umfrage beantworten (Antwort wird gespeichert), bekommen aber kein
    // Cashback. So lügt die App-Meldung nie + es entsteht kein Geister-
    // Guthaben, das nie ausgezahlt werden kann.
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      const u = userSnap.exists ? userSnap.data() : {};
      const consent = u.cashback_consent || {};
      let requiredVersion = 'v2.0-2026-06'; // Fallback = aktuelle Version; primär aus cashback_config/v1
      try {
        const cfg = await db.collection('cashback_config').doc('v1').get();
        if (cfg.exists && typeof cfg.data()?.consentVersion === 'string') {
          requiredVersion = cfg.data().consentVersion;
        }
      } catch {
        /* Fallback: Code-Default */
      }
      if (!consent.accepted || consent.version !== requiredVersion) {
        logger.info('[survey-reward] skip: no/old consent', { uid });
        return;
      }
      // Registrierung: anonyme Auth-User haben keine providerData.
      try {
        const rec = await admin.auth().getUser(uid);
        if (!rec || rec.providerData.length === 0) {
          logger.info('[survey-reward] skip: anonymous user', { uid });
          return;
        }
      } catch (e) {
        logger.warn('[survey-reward] auth lookup failed, skip reward', { uid, err: e.message });
        return;
      }
    } catch (e) {
      logger.error('[survey-reward] eligibility check failed', { uid, err: e.message });
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
