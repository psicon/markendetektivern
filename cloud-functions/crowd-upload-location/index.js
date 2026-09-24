'use strict';

/**
 * crowd-upload-location
 *
 * Bestimmt für jede Produkt-Einreichung, WO sie entstanden ist — und wie
 * sicher diese Aussage ist. Schreibt `probableLocation` auf
 * `crowd_uploads/{id}`.
 *
 * ═══ Warum serverseitig ═══
 *
 * Der Client kann das allein nicht leisten. Die Ortsfelder wurden zwar im
 * Client ergänzt (Commit 16752ec), aber ein Blick in die Daten zeigt: von
 * 298 Einreichungen trägt KEINE eine `journeyId` — der Vorwärtspfad ist
 * nie ausgeliefert worden. Und selbst nach einem Update reichen Nutzer
 * monatelang aus älteren Versionen ein. Ein Trigger auf `onCreate` deckt
 * beide Fälle ab, ohne dass je wieder ein Backfill nötig wird.
 *
 * ═══ Wer schreibt was ═══
 *
 * Klare Eigentümerschaft, damit sich Client und Function nicht gegenseitig
 * überschreiben können:
 *   • Der Client liefert ROHSIGNALE (`capture.gps`, `capture.confirmedPlace`,
 *     `capture.capturedAt`, `clientVersion`) — und nur die.
 *   • Diese Function schreibt AUSSCHLIESSLICH die Ableitung
 *     (`probableLocation`) sowie fehlende Rohsignale, die sie selbst
 *     rekonstruieren kann (`journeyLocation`, `userLocation`).
 * Ein Race ist ausgeschlossen: `submitProduct` legt das Dokument mit EINEM
 * `addDoc` an, der Create-Snapshot enthält also bereits alles, was der
 * Client mitgeschickt hat.
 *
 * ═══ Wiederholbarkeit ═══
 *
 * `probableLocation` ist eine reine Funktion der Rohsignale (`src/scorer.js`,
 * ohne I/O). Ändert sich das Modell, genügt ein Neuberechnen aus Firestore —
 * kein einziges Byte aus Storage. Deshalb trägt das Feld eine
 * `modelVersion`, und die Rohsignale bleiben unangetastet daneben stehen.
 *
 * ═══ Was dieser Trigger NICHT kann ═══
 *
 * Er sieht die IP des Einreichenden nicht — ein Firestore-Event trägt keinen
 * Netzwerkkontext (nur ein HTTPS-Callable hätte ihn, und der bräuchte
 * wieder eine neue App-Version). Er kann die IP-Ortung also nur ÜBERNEHMEN,
 * nicht neu vornehmen. Das ist kein Verlust: die IP-Ortung liegt gemessen
 * 61–377 km daneben und geht ohnehin nur als Landes-Signal ein.
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

const { MODEL_VERSION } = require('./src/scorer');
const { findeExifGps } = require('./src/exif');
const { findeJourneyLocation } = require('./src/journey');
const { bonAdresseGeaendert } = require('./src/bonAdresse');
const { bewerteDokument, minutenZwischen } = require('./src/bewerten');
const PLZ = require('./data/plz.json');

admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west1'; // wie die übrigen crowd_uploads-Trigger
const MAX_BILDER_FUER_EXIF = 8;

exports.onCrowdUploadCreated = onDocumentCreated(
  { document: 'crowd_uploads/{id}', region: REGION, memory: '512MiB', timeoutSeconds: 120 },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const doc = snap.data();
    const id = event.params.id;
    const uid = doc.userId;

    // Idempotenz: Firestore-Trigger garantieren nur at-least-once.
    if (doc.probableLocationAt) {
      logger.info('bereits bewertet, übersprungen', { id });
      return;
    }
    if (!uid) {
      logger.warn('ohne userId — keine Bewertung möglich', { id });
      return;
    }

    const submittedAtMs = doc.createdAt?.toDate?.().getTime() ?? Date.now();
    // Der Aufnahmezeitpunkt ist der ehrlichere Bezugspunkt, aber nur neue
    // Clients liefern ihn. Ohne ihn bleibt die Anlagezeit — bei Uploads aus
    // der Warteschlange kann die deutlich später liegen.
    const capturedAtMs = doc.capture?.capturedAt?.toDate?.().getTime() ?? submittedAtMs;

    const nachtrag = {}; // Rohsignale, die der Client nicht geliefert hat

    // ── Journey-Ortung: vom Client übernehmen oder rekonstruieren ────────
    let ipLocation = doc.journeyLocation ?? null;
    if (!ipLocation) {
      try {
        const treffer = await findeJourneyLocation(db, uid, submittedAtMs);
        if (treffer) {
          ipLocation = treffer.location;
          nachtrag.journeyLocation = treffer.location;
          nachtrag.journeyLocationMatch = {
            method: 'server_trigger_nearest_preceding_journey',
            journeyId: treffer.journeyId,
            deltaMinutes: treffer.deltaMinutes,
            windowMinutes: 360,
          };
        }
      } catch (e) {
        logger.warn('Journey-Zuordnung fehlgeschlagen', { id, error: e.message });
      }
    }

    // ── Selbstauskunft: vom Client übernehmen oder aus dem Profil holen ──
    let profileRegion = doc.userLocation ?? null;
    if (!profileRegion) {
      try {
        const u = (await db.collection('users').doc(uid).get()).data() || {};
        if (u.location || u.city || u.bundesland) {
          profileRegion = {
            address: u.location ?? null,
            city: u.city ?? null,
            bundesland: u.bundesland ?? null,
          };
          nachtrag.userLocation = profileRegion;
          // Der Stand von HEUTE, nicht der zum Aufnahmezeitpunkt — wer
          // seinen Wohnort seither geändert hat, bekommt den neuen. Die
          // Auswertung muss das unterscheiden können.
          nachtrag.userLocationBackfilled = true;
        }
      } catch (e) {
        logger.warn('Profil nicht lesbar', { id, error: e.message });
      }
    }

    // ── EXIF: selten, aber die einzige Ground Truth ──────────────────────
    let exifGps = null;
    const bilder = Object.values(doc.images || {})
      .filter((p) => typeof p === 'string')
      .slice(0, MAX_BILDER_FUER_EXIF);
    if (bilder.length > 0) {
      try {
        const gefunden = await findeExifGps(
          admin.storage().bucket(),
          bilder,
          (m, d) => logger.debug(m, { id, ...d }),
        );
        if (gefunden) {
          exifGps = {
            lat: gefunden.lat,
            lon: gefunden.lon,
            accuracyM: gefunden.accuracyM,
            ageMinutes: minutenZwischen(gefunden.takenAtMs, capturedAtMs),
          };
          nachtrag.exifGps = {
            ...exifGps,
            takenAt: gefunden.takenAtMs ? new Date(gefunden.takenAtMs) : null,
            sourceImage: gefunden.pfad,
            matchCount: gefunden.anzahlTreffer,
          };
        }
      } catch (e) {
        logger.warn('EXIF-Lesung fehlgeschlagen', { id, error: e.message });
      }
    }

    // ── Bewerten und schreiben ───────────────────────────────────────────
    await bewertenUndSchreiben(snap.ref, id, { nachtrag, ipLocation, profileRegion, exifGps, capturedAtMs });
  },
);

/**
 * Neu bewerten, sobald die Filialadresse vom Kassenbon eintrifft (ploc-v2).
 *
 * `priceReceipt` schreibt crowd-upload-namer erst NACH der Anlage — der
 * onCreate-Trigger oben sieht sie in aller Regel noch nicht. Ohne diesen
 * Trigger käme die wichtigste Ortsquelle nie zum Zug. Er reagiert NUR auf
 * eine Änderung der Bon-Adresse; das eigene Schreiben von probableLocation
 * ändert sie nicht, eine Schleife ist ausgeschlossen.
 */
exports.onCrowdUploadBonAdresse = onDocumentUpdated(
  // retry: dieser Trigger ist praktisch der einzige Weg, auf dem die
  // Bon-Adresse zum Ort wird — ein einzelner Transaktionsfehler darf sie
  // nicht dauerhaft verlieren. Gefahrlos: fremde Änderungen enden sofort
  // am Filter, und die Bewertung ist deterministisch.
  { document: 'crowd_uploads/{id}', region: REGION, memory: '256MiB', timeoutSeconds: 60, retry: true },
  async (event) => {
    const vorher = event.data?.before?.data();
    const nachher = event.data?.after?.data();
    if (!vorher || !nachher) return;
    if (!bonAdresseGeaendert(vorher, nachher)) return;
    await bewertenUndSchreiben(event.data.after.ref, event.params.id, {});
  },
);

/**
 * Bewertet aus dem FRISCHEN Dokumentstand und schreibt in einer Transaktion.
 *
 * Zwei Trigger schreiben probableLocation (Anlage und Bon-Adresse), und der
 * Namer schreibt die Bon-Adresse zeitlich dazwischen. Rechnete jeder mit
 * seinem eigenen Schnappschuss, könnte der langsamere den besseren Stand
 * überschreiben. Darum liest jeder Schreibvorgang das Dokument in der
 * Transaktion neu; Zusatz-Eingaben, die nur die Anlage kennt (rekonstruierte
 * IP-Ortung, Profil, EXIF), werden hereingereicht, sonst aus dem Dokument
 * genommen.
 */
async function bewertenUndSchreiben(ref, id, zusatz) {
  const ergebnis = await db.runTransaction(async (tx) => {
    const frisch = await tx.get(ref);
    if (!frisch.exists) return null;
    const doc = frisch.data();
    const { probableLocation, resolvedBy } = bewerteDokument(doc, zusatz, PLZ);

    tx.set(
      ref,
      {
        ...(zusatz.nachtrag || {}),
        probableLocation: {
          ...probableLocation,
          computedAt: admin.firestore.FieldValue.serverTimestamp(),
          resolvedBy,
        },
        probableLocationAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return probableLocation;
  });
  if (!ergebnis) return;
  logger.info('bewertet', {
    id,
    source: ergebnis.source,
    confidence: ergebnis.confidence,
    granularity: ergebnis.granularity,
    modelVersion: MODEL_VERSION,
    nachgetragen: Object.keys(zusatz.nachtrag || {}),
  });
}
