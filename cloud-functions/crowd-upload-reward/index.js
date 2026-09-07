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
 * Fehlt am Dokument die `campaignId`, wird sie SERVERSEITIG für den Zeitpunkt
 * der Einreichung nachgeschlagen (src/campaignFallback.js). Ein fehlendes
 * Kennzeichen heißt nämlich nicht „es lief keine Aktion", sondern meistens
 * „der Client konnte sie nicht auflösen" (86cbet2nw) — der Client-Fix erreicht
 * die Geräte im Feld erst über Wochen. Lief zur Aufnahmezeit wirklich keine
 * Aktion, bleibt es bei null: dann wurde auch nichts versprochen.
 *
 * JEDER Ausstieg schreibt sein Ergebnis ans Dokument (src/ergebnis.js), damit
 * gilt: `status === 'approved'` ohne `rewardResult` = echter Fehler.
 */

const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

const { pruefeOrtsanforderung } = require('./src/locationGate');
const { resolveRegion, matchesTargeting } = require('./src/targeting');
const { ergebnisFelder } = require('./src/ergebnis');
const { campaignZurAufnahmezeit } = require('./src/campaignFallback');

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
    const uploadRef = event.data.after.ref;

    /** Ergebnis ans Dokument — die Invariante trägt `rewardResult`, siehe src/ergebnis.js. */
    const markiere = (opts) =>
      uploadRef.set(ergebnisFelder(admin.firestore.FieldValue, opts), { merge: true }).catch((e) =>
        logger.error('[crowd-reward] Ergebnis-Marker nicht geschrieben', { uploadId, err: e.message }),
      );

    if (!uid) {
      logger.error('[crowd-reward] ohne userId — nicht buchbar', { uploadId });
      await markiere({ result: 'not_credited', reason: 'ohne_user_id' });
      return;
    }

    // DAS LEDGER IST DIE WAHRHEIT, und es wird VOR jedem Gate gelesen. Sonst
    // schreibt ein Gate (Ort, Gebiet, fehlende Aktion) `rewardCents: 0` über
    // eine Einreichung, die längst bezahlt ist — etwa nach einer Nachbuchung
    // per Skript oder nach „ablehnen → zurückholen → freigeben". Die Gates
    // liegen alle vor der Buchungs-Transaktion und sähen den Eintrag sonst nie.
    const userRef = db.collection('users').doc(uid);
    const ledgerRef = userRef.collection('cashback_ledger').doc(`crowd_${uploadId}`);
    try {
      const vorhanden = await ledgerRef.get();
      if (vorhanden.exists) {
        const gebucht = Number(vorhanden.data().cents) || 0;
        const storniert = vorhanden.data().type === 'reverse';
        logger.info('[crowd-reward] bereits gebucht — nur Ergebnis nachtragen', { uploadId, uid, cents: gebucht });
        await markiere(
          storniert || gebucht <= 0
            ? { result: 'not_credited', reason: 'storniert' }
            : { result: 'credited', cents: gebucht },
        );
        return;
      }
    } catch (e) {
      // Ledger nicht lesbar: kein Urteil fällen, sondern erneut zustellen lassen.
      logger.error('[crowd-reward] Ledger nicht lesbar', { uploadId, uid, err: e.message });
      throw e;
    }

    // Aktionskennzeichen. Fehlt es, hat der Client es nicht auflösen können
    // (86cbet2nw) — das heißt NICHT, dass keine Aktion lief. Der Server schaut
    // deshalb selbst nach, und zwar für den ZEITPUNKT DER EINREICHUNG.
    let cid = after.campaignId;
    let campaignQuelle = null;
    let campaignZeitQuelle = null;
    if (!cid) {
      try {
        const alle = await db.collection(CAMPAIGNS_COL).get();
        // Maßgeblich ist die AUFNAHME, nicht der Moment, in dem die
        // Warteschlange das Dokument schrieb: offline erfasste Einreichungen
        // laden Tage später hoch (gemessen bis 68 Stunden), und genau die sind
        // es, bei denen der Client keine Aktion auflösen konnte.
        const aufnahme = after.capture?.capturedAt?.toMillis?.() ?? null;
        const geschrieben = after.createdAt?.toMillis?.() ?? null;
        campaignZeitQuelle = aufnahme != null ? 'capturedAt' : 'createdAt';
        const treffer = campaignZurAufnahmezeit(
          alle.docs.map((d) => ({ id: d.id, ...d.data() })),
          aufnahme ?? geschrieben,
        );
        if (treffer.campaignId) {
          cid = treffer.campaignId;
          campaignQuelle = 'server_fallback';
          logger.warn('[crowd-reward] Aktion serverseitig aufgelöst', { uploadId, uid, cid });
        } else {
          logger.info('[crowd-reward] keine Aktion zur Aufnahmezeit', { uploadId, uid, grund: treffer.grund });
          await markiere({ result: 'not_credited', reason: treffer.grund });
          return;
        }
      } catch (e) {
        // Ein Lesefehler ist keine Aussage über die Einreichung: erneut zustellen.
        logger.error('[crowd-reward] Aktions-Rückfall fehlgeschlagen', { uploadId, err: e.message });
        throw e;
      }
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
      // `rewardSkipped` bleibt der Ortsregel vorbehalten — die ausgelieferte
      // App leitet daraus ihren Standort-Hinweis ab. Für die Invariante kommt
      // `rewardResult` dazu (src/ergebnis.js).
      await markiere({ result: 'not_credited', reason: ort.grund, extra: { rewardSkipped: true, rewardSkippedReason: ort.grund } });
      return;
    }

    // Orts-Audit 05.09.2026: der ok-GRUND wurde bisher verworfen — 731
    // Gnadenfrist- und 54 GPS-Ausnahme-Zahlungen waren in Firestore von
    // regulären nicht unterscheidbar. Ab jetzt steht die angewandte Regel am
    // Doc (rewardLocationRule), ebenso das Buchungsergebnis (rewardResult /
    // rewardCents / rewardNotCreditedReason) — ein still ausbleibender Betrag
    // ist genau das Muster, das niemand merkt.
    const rewardLocationRule = ort.grund || 'ort_vorhanden';

    // Regionale Aktionen (06.09.2026). Produktfotos liefern selbst keine PLZ:
    // die Ortsbestätigung trägt nur einen Ortsnamen, GPS nur Koordinaten.
    // Belegte Quellen sind deshalb (1) ein Kassenbon, den der Nutzer als
    // Preisbild eingereicht hat, und (2) die aus den eigenen Bons abgeleitete
    // Nutzer-Region. Ist beides unbekannt, entscheidet die Aktion selbst
    // (onUnknown, Standard: vergüten — niemand wird für eine fehlende Angabe
    // bestraft).
    let region = resolveRegion({
      bonFotoZip: after.priceReceipt?.zip ?? null,
      country: after.priceReceipt?.country ?? after.marketLand ?? null,
    });
    if (!region.zip) {
      try {
        const uSnap = await db.doc(`users/${uid}`).get();
        const r = uSnap.exists ? uSnap.data().region : null;
        if (r && r.zip) region = resolveRegion({ profilZip: r.zip, country: r.country ?? null });
      } catch (e) {
        logger.warn('[crowd-reward] Nutzer-Region nicht lesbar', { uploadId, err: e.message });
      }
    }

    // Aktion + Region prüfen, bevor gebucht wird. Passt das Gebiet nicht,
    // wird NICHT gebucht — und der Grund steht am Dokument, nie nur im Log.
    try {
      const campSnap = await db.collection(CAMPAIGNS_COL).doc(cid).get();
      const camp = campSnap.exists ? { id: campSnap.id, ...campSnap.data() } : null;
      const treffer = matchesTargeting(camp || {}, region);
      if (!treffer.ok) {
        logger.warn('[crowd-reward] ausserhalb des Aktionsgebiets — keine Vergütung', { uploadId, uid, cid, zip: region.zip, grund: treffer.grund });
        await markiere({
          result: 'not_credited',
          reason: 'ausserhalb_aktionsgebiet',
          extra: {
            rewardSkipped: true,
            rewardSkippedReason: 'ausserhalb_aktionsgebiet',
            rewardRegion: { zip: region.zip, source: region.source, grund: treffer.grund },
          },
        });
        return;
      }
    } catch (e) {
      // Ein Fehler beim Prüfen ist keine Aussage über die Einreichung:
      // weiterlaufen (fail-open) statt jemanden ohne Grund leer ausgehen lassen.
      logger.warn('[crowd-reward] Regionsprüfung fehlgeschlagen — wird vergütet', { uploadId, err: e.message });
    }

    const campRef = db.collection(CAMPAIGNS_COL).doc(cid);

    try {
      const outcome = await db.runTransaction(async (tx) => {
        // ── Reads zuerst (Firestore-Transaktionsregel) ──
        const [ledgerSnap, userSnap, campSnap] = await Promise.all([
          tx.get(ledgerRef),
          tx.get(userRef),
          tx.get(campRef),
        ]);

        // Sicherung gegen zwei gleichzeitige Zustellungen: der Vorab-Check
        // oben fängt den Normalfall, diese Prüfung das Rennen zweier Läufe.
        if (ledgerSnap.exists) return { cents: 0, reason: 'already_booked' };
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
      // Ergebnis ans Doc — messbar, nicht nur im Log. `already_booked` kann
      // hier nicht mehr auftreten: das Ledger wird ganz oben gelesen und der
      // Fall dort abschließend behandelt.
      // Die serverseitig ergänzte `campaignId` wird NUR bei einer echten Buchung
      // ans Dokument geschrieben. Die ausgelieferte App liest bei „angenommen"
      // allein dieses Feld und verspricht daraufhin „die Vergütung liegt in
      // deinem Guthaben" (productSubmissionCopy.ts:80-84) — stünde es auch ohne
      // Buchung dort, wäre das eine Zusage, die niemand einlöst. Für die
      // Nachvollziehbarkeit reicht `campaignQuelle` plus der Grund; beide liest
      // keine App-Version.
      const extra = { rewardLocationRule };
      if (campaignQuelle) {
        extra.campaignQuelle = campaignQuelle;
        extra.campaignIdServer = cid;
        if (campaignZeitQuelle) extra.campaignZeitQuelle = campaignZeitQuelle;
      }
      await markiere(
        credited > 0
          ? { result: 'credited', cents: credited, extra: campaignQuelle ? { ...extra, campaignId: cid } : extra }
          : { result: 'not_credited', reason: outcome.reason, extra },
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
