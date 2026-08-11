#!/usr/bin/env node
'use strict';

/**
 * IP-basierte Ortsangabe (`journeyLocation`) auf bestehende
 * Produkt-Einreichungen nachtragen.
 *
 * ZWECK: den Abgleich „was hat der Nutzer als Wohnort angegeben" gegen
 * „wo hat er die Fotos gemacht" ermöglichen. `userLocation` (Profil,
 * Selbstauskunft) steht bereits im Dokument; hier kommt die zweite
 * Seite dazu.
 *
 * ZUORDNUNG ÜBER DIE ZEIT — und warum das nötig ist:
 * 95 der 132 Einreicher haben über ihre Journeys hinweg MEHRERE
 * verschiedene Orte. „Der Ort des Nutzers" existiert also nicht; jede
 * Einreichung braucht die Journey, die zu IHR gehört. Genommen wird die
 * zeitlich nächste Journey VOR dem Upload, die eine Location trägt.
 *
 * Gemessene Abstände Upload → passende Journey:
 *   Median 7,2 Min · p75 22,7 · p90 107 · p95 238
 *   ≤15 Min: 70 % · ≤60 Min: 84 % · ≤3 h: 92 % · ≤6 h: 98 %
 * Das Fenster steht deshalb auf 6 Stunden. Der tatsächliche Abstand wird
 * je Dokument mitgeschrieben (`journeyLocationMatch.deltaMinutes`), damit
 * die Auswertung enger filtern kann, ohne neu zuordnen zu müssen.
 *
 * WAS DIE DATEN NICHT SIND — beim Auswerten beachten:
 *  - `lat`/`lon` sind BEREITS auf ~5 km gerundet (anonymousLocationService
 *    rechnet `Math.round(wert * 20) / 20`, bevor der Wert die App
 *    erreicht). Rasterpunkte, keine Präzisionskoordinaten. `geohash5` ist
 *    `lat_lon` derselben gerundeten Werte.
 *  - `source: 'fallback'` heißt: die IP-Abfrage schlug fehl, eingetragen
 *    ist der DACH-Mittelpunkt (51.15/10.45). Für einen Ortsvergleich
 *    WERTLOS und auszuschließen.
 *  - `city` ist die Stadt des NETZZUGANGS, nicht der Aufenthaltsort.
 *    Am Ergebnis dieses Laufs gemessen: von 64 Einreichungen mit
 *    Selbstauskunft UND IP-Stadt stimmte KEINE überein, und 7 Nutzer
 *    „sprangen" bis 651 km — einer 479 km (Aachen/Erfurt/Dachau) in
 *    28 Stunden. Das sind Mobilfunk-Gateways, keine Reisen. Die Frage
 *    „wohnt hier, kauft dort" lässt sich mit dem Stadtfeld NICHT
 *    beantworten; brauchbar ist es als pro Nutzer stabiler
 *    Regionsschlüssel (115 von 127 Nutzern: durchgehend eine Stadt).
 *  - Es wird NICHTS neu aufgelöst. Übernommen wird ausschließlich, was
 *    in der Journey bereits steht.
 *
 * Idempotent: Dokumente mit vorhandener `journeyLocation` werden
 * übersprungen.
 *
 * Aufruf:
 *   node scripts/backfill-crowd-upload-journeyloc.js            # Trockenlauf
 *   node scripts/backfill-crowd-upload-journeyloc.js --execute  # schreibt
 */

const admin = require('firebase-admin');

const EXECUTE = process.argv.includes('--execute');
const WINDOW_MIN = 360; // 6 Stunden

admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();

const ms = (v) => (v && v.toDate ? v.toDate().getTime() : typeof v === 'number' ? v : null);

async function main() {
  console.log(EXECUTE ? '### ECHTLAUF ###' : '### TROCKENLAUF — nichts wird geschrieben ###');
  console.log(`Zuordnungsfenster: ${WINDOW_MIN} Minuten\n`);

  const ups = await db.collection('crowd_uploads').get();
  const byUser = {};
  ups.docs.forEach((d) => {
    const u = d.data().userId;
    if (u) (byUser[u] = byUser[u] || []).push(d);
  });

  const stats = { gesetzt: 0, schonDa: 0, keineJourney: 0, zuAlt: 0, ip: 0, fallback: 0 };
  const deltas = [];
  let batch = db.batch();
  let offen = 0;

  for (const [uid, docs] of Object.entries(byUser)) {
    const js = await db.collection('users').doc(uid).collection('journeys').get();
    const kandidaten = js.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((x) => x.location && x.startTime)
      .map((x) => ({ id: x.journeyId || x.id, t: ms(x.startTime), loc: x.location }))
      .filter((x) => x.t);

    for (const d of docs) {
      const x = d.data();
      if (x.journeyLocation) {
        stats.schonDa++;
        continue;
      }
      const ct = ms(x.createdAt);
      if (!ct) {
        stats.keineJourney++;
        continue;
      }
      const vor = kandidaten.filter((c) => c.t <= ct);
      if (!vor.length) {
        stats.keineJourney++;
        continue;
      }
      const best = vor.reduce((a, b) => (Math.abs(ct - b.t) < Math.abs(ct - a.t) ? b : a));
      const deltaMin = (ct - best.t) / 60000;
      if (deltaMin > WINDOW_MIN) {
        stats.zuAlt++;
        continue;
      }

      const L = best.loc;
      // Gleiche Feldform wie der Vorwärtspfad in productSubmit.collectContext
      // — die Auswertung soll nicht zwei Varianten kennen müssen.
      const journeyLocation = {
        lat: typeof L.lat === 'number' ? L.lat : null,
        lon: typeof L.lon === 'number' ? L.lon : null,
        city: L.city ?? null,
        geohash5: L.geohash5 ?? null,
        source: L.source ?? null,
      };
      if (L.source === 'ip') stats.ip++;
      else stats.fallback++;
      deltas.push(deltaMin);
      stats.gesetzt++;

      if (EXECUTE) {
        batch.set(
          d.ref,
          {
            journeyLocation,
            // Herkunft getrennt halten: beim Vorwärtspfad stammt die
            // Location aus der laufenden Journey, hier ist sie über die
            // Zeit erschlossen. Ohne diesen Vermerk sähe beides gleich aus.
            journeyLocationMatch: {
              method: 'nearest_preceding_journey',
              journeyId: best.id ?? null,
              deltaMinutes: Math.round(deltaMin * 10) / 10,
              windowMinutes: WINDOW_MIN,
            },
          },
          { merge: true },
        );
        if (++offen >= 400) {
          await batch.commit();
          batch = db.batch();
          offen = 0;
        }
      }
    }
  }
  if (EXECUTE && offen > 0) await batch.commit();

  deltas.sort((a, b) => a - b);
  const q = (p) => (deltas.length ? deltas[Math.floor(deltas.length * p)] : 0);

  console.log('=== Ergebnis ===');
  console.log(`  Einreichungen gesamt:        ${ups.size}`);
  console.log(`  ${EXECUTE ? 'gesetzt' : 'würde setzen'}:${' '.repeat(EXECUTE ? 21 : 17)}${stats.gesetzt}`);
  console.log(`    davon source='ip':         ${stats.ip}   (verwertbar)`);
  console.log(`    davon source='fallback':   ${stats.fallback}   (DACH-Mittelpunkt, NICHT verwertbar)`);
  console.log(`  trugen schon eine:           ${stats.schonDa}`);
  console.log(`  keine Journey davor:         ${stats.keineJourney}`);
  console.log(`  Journey zu alt (>${WINDOW_MIN} Min):  ${stats.zuAlt}`);
  if (deltas.length) {
    console.log(
      `  Abstand: Median ${q(0.5).toFixed(1)} Min · p90 ${q(0.9).toFixed(1)} · max ${deltas[deltas.length - 1].toFixed(1)}`,
    );
  }
  if (!EXECUTE) console.log('\nZum Schreiben erneut mit --execute aufrufen.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Abbruch:', e);
    process.exit(1);
  });
