'use strict';

/**
 * Findet die Journey, zu der eine Einreichung zeitlich gehört.
 *
 * WOZU: Alte App-Versionen schicken weder `journeyLocation` noch
 * `journeyId` mit. Damit die Ortsangaben auch dort gefüllt werden — ohne
 * Backfill, wie gefordert — rekonstruiert der Trigger die Zuordnung über
 * die Zeit: die letzte Journey, die VOR der Einreichung begann.
 *
 * QUALITÄT DIESER ZUORDNUNG: Im einmaligen Backfill über 292 Dokumente lag
 * der Abstand im Median bei 7,0 Minuten (p90 78,8). Im Trigger ist sie
 * deutlich besser, weil er im Moment des Anlegens feuert und damit
 * typischerweise die noch laufende Journey trifft. Der gemessene Abstand
 * wird pro Dokument festgehalten, damit eine Auswertung enger filtern kann.
 *
 * WAS SIE NICHT LEISTET: Die Journey liefert eine IP-Ortung, und die ist
 * als Ortsangabe wertlos (gemessene 61–377 km Abweichung gegen EXIF-GPS).
 * Der Trigger holt sie trotzdem — aber ausschließlich für die LANDES-
 * Aussage, wo sie in 4 von 4 Ground-Truth-Fällen richtig lag.
 *
 * KEIN NEUER INDEX NÖTIG: Bereichsfilter und Sortierung laufen über
 * dasselbe Feld (`startTime`), das deckt der automatische Einzelfeld-Index
 * ab. Ein Filter auf „location vorhanden" würde dagegen einen zusammen-
 * gesetzten Index erzwingen — deshalb wird großzügig geholt und im
 * Speicher gefiltert. (Indizes werden in diesem Projekt ausschließlich
 * über die Console verwaltet, niemals per Deploy.)
 */

/** Über diesen Abstand hinaus gehört die Journey zu einem anderen Einkauf. */
const MAX_ABSTAND_MINUTEN = 360; // 6 h — deckte im Backfill 98 % ab

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} uid
 * @param {number} zeitpunktMs Anlagezeit der Einreichung.
 * @returns {Promise<{location, journeyId, deltaMinutes}|null>}
 */
async function findeJourneyLocation(db, uid, zeitpunktMs) {
  const snap = await db
    .collection('users')
    .doc(uid)
    .collection('journeys')
    .where('startTime', '<=', new Date(zeitpunktMs))
    .orderBy('startTime', 'desc')
    .limit(10)
    .get();

  for (const doc of snap.docs) {
    const d = doc.data();
    if (!d.location || typeof d.location.lat !== 'number') continue;

    const start = d.startTime?.toDate?.().getTime();
    if (!start) continue;

    const deltaMinutes = (zeitpunktMs - start) / 60000;
    if (deltaMinutes > MAX_ABSTAND_MINUTEN) return null; // absteigend sortiert: ältere sind noch weiter weg

    return {
      location: {
        lat: d.location.lat ?? null,
        lon: d.location.lon ?? null,
        city: d.location.city ?? null,
        geohash5: d.location.geohash5 ?? null,
        source: d.location.source ?? null,
      },
      journeyId: d.journeyId || doc.id,
      deltaMinutes: Math.round(deltaMinutes * 10) / 10,
    };
  }

  return null;
}

module.exports = { findeJourneyLocation, MAX_ABSTAND_MINUTEN };
