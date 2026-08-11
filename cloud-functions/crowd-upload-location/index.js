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

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

const { bewerteLocation, landAusKoordinate, MODEL_VERSION } = require('./src/scorer');
const { findeExifGps } = require('./src/exif');
const { findeJourneyLocation } = require('./src/journey');

admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west1'; // wie die übrigen crowd_uploads-Trigger
const MAX_BILDER_FUER_EXIF = 8;

/** Millisekunden zwischen zwei Zeitpunkten, in Minuten und gerundet. */
const minutenZwischen = (aMs, bMs) =>
  aMs == null || bMs == null ? null : Math.round(Math.abs(aMs - bMs) / 60000);

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

    // ── Bewerten ─────────────────────────────────────────────────────────
    const captureGps = doc.capture?.gps
      ? {
          lat: doc.capture.gps.lat,
          lon: doc.capture.gps.lon,
          accuracyM: doc.capture.gps.accuracyM ?? null,
          ageMinutes: minutenZwischen(
            doc.capture.gps.fixAt?.toDate?.().getTime() ?? capturedAtMs,
            capturedAtMs,
          ),
        }
      : null;

    const probableLocation = bewerteLocation({
      submittedAtMs,
      captureGps,
      exifGps,
      confirmedPlace: doc.capture?.confirmedPlace ?? null,
      profileRegion,
      marketLand: doc.marketLand ?? null,
      ipLand: ipLocation?.source === 'ip' ? landAusIpOrtung(ipLocation) : null,
      ipLocation,
    });

    await snap.ref.set(
      {
        ...nachtrag,
        probableLocation: {
          ...probableLocation,
          computedAt: admin.firestore.FieldValue.serverTimestamp(),
          resolvedBy: doc.capture?.gps || doc.capture?.confirmedPlace ? 'client' : 'server',
        },
        probableLocationAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    logger.info('bewertet', {
      id,
      source: probableLocation.source,
      confidence: probableLocation.confidence,
      granularity: probableLocation.granularity,
      modelVersion: MODEL_VERSION,
      nachgetragen: Object.keys(nachtrag),
    });
  },
);

/**
 * Landeszuordnung der IP-Ortung. Die Stadt ist wertlos, das Land war in
 * allen vier Ground-Truth-Fällen korrekt — also wird genau das und nicht
 * mehr daraus abgeleitet.
 *
 * Die Boxen liegen bewusst NICHT hier, sondern in `scorer.landAusKoordinate`:
 * eine zweite Kopie würde früher oder später abweichen, und zwar still.
 */
function landAusIpOrtung(loc) {
  const { lat, lon } = loc || {};
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  // Der DACH-Fallback (51.15/10.45) ist kein Ort und darf auch kein Land
  // begründen — er steht genau dann im Feld, wenn die IP-Abfrage scheiterte.
  if (Math.abs(lat - 51.15) < 0.01 && Math.abs(lon - 10.45) < 0.01) return null;
  return landAusKoordinate(lat, lon);
}
