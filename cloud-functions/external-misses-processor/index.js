/**
 * external-misses-processor — Hintergrundsuche für gescannte, uns unbekannte
 * Barcodes (Collection `external_lookup_misses`).
 *
 * ─── Was das tut ─────────────────────────────────────────────────────
 *
 * Findet die App für einen gescannten Barcode keine guten Daten, legt die
 * Abfrage (external-product-lookup, `planeAbruf`) den Fall
 * `external_lookup_misses/{ean}` an bzw. öffnet ihn wieder:
 *   status 'pending', grund 'neu' | 'nur_openfood' | 'auffrischen',
 *   rang = scanTage · 1e13 + lastSeenAt (höher = früher dran).
 *
 * Diese Funktion läuft alle 10 Minuten und sucht für bis zu `proLauf` Fälle
 * über scrapeEan (nutrition-scraper) im Netz — NUR per EAN, nie per Name.
 * Funde landen in `nutritionscrape/{ean}`; von dort übernimmt sie
 * external-product-lookup (Trigger) in `external_products/{ean}`.
 *
 * Steuerung ohne Deploy über `_meta/produktsuche` (src/konfig.js):
 * aktiv, proLauf, tagesDeckel, serperMindestGuthaben. Zähler je Tag unter
 * `_meta/produktsuche_tage/tage/{YYYY-MM-DD}` (Tagesbericht der review-console).
 *
 * ─── Status-Übergänge ─────────────────────────────────────────────────
 *
 *   pending → uebersprungen   ungültige Nummer, Ladencode (Waage/Laden),
 *                             steht schon im Katalog — ohne bezahlte Suche
 *   pending → processing      Beanspruchung (Transaktion, Tagesdeckel)
 *   pending → resolved        Fund nach abgebrochenem Aufruf (ohne Suche)
 *   processing → resolved     Fund; oder Auffrischung ohne Fund bei einem
 *                             früheren Fund (alte Daten bleiben)
 *            → no-data        die Suche lief und fand nichts (inhaltlich),
 *                             oder die Quellseite widerlegte die alten Daten
 *            → pending        Fehler (503, Netz, Zeitlimit) — mit
 *                             wachsender Wartezeit später erneut
 *            → error          nach MAX_ERRORS Fehlern am Barcode in Folge
 *                             (dienstweite Fehler zählen nicht, src/regeln.js)
 *
 * Ein Fremddienst-Fehler ist nie „nichts gefunden" (Vorfall
 * 18.08.–01.10.2026: ~5.400 EANs fälschlich 'no-data'). Die Regeln stehen
 * als reine Funktionen in src/regeln.js, der Ablauf in src/lauf.js.
 */

const functions = require('firebase-functions/v2');
const params = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

const { erstelleProzessor } = require('./src/lauf');

if (!admin.apps.length) admin.initializeApp();

const REGION = 'europe-west1';

// scrapeEan verlangt denselben Schlüssel wie der nutrition-scraper.
const TRIGGER_KEY = params.defineSecret('NUTRITION_SCRAPER_TRIGGER_KEY');
// Nur zum LESEN des Serper-Guthabens (Prepaid, CLAUDE.md: Überwachung
// Pflicht). Gesucht wird ausschließlich in scrapeEan.
const SERPER_API_KEY = params.defineSecret('SERPER_API_KEY');

const LAUF_OPTIONEN = {
  region: REGION,
  timeoutSeconds: 540,
  memory: '256MiB',
  // Ein Lauf zur Zeit genügt; die Beanspruchung ist trotzdem transaktional
  // (Zeitplan und Handaufruf können gleichzeitig laufen).
  maxInstances: 1,
  secrets: [TRIGGER_KEY, SERPER_API_KEY],
};

const prozessor = erstelleProzessor({
  db: admin.firestore(),
  FieldValue: admin.firestore.FieldValue,
  Timestamp: admin.firestore.Timestamp,
});

// ════════════════════════════════════════════════════════════════════
// Zeitplan — alle 10 Minuten
// ════════════════════════════════════════════════════════════════════

exports.processExternalMisses = functions.scheduler.onSchedule(
  { ...LAUF_OPTIONEN, schedule: 'every 10 minutes' },
  async () => {
    await prozessor.lauf({
      triggerKey: TRIGGER_KEY.value(),
      serperKey: SERPER_API_KEY.value(),
      quelle: 'zeitplan',
    });
  },
);

// ════════════════════════════════════════════════════════════════════
// Handaufruf — derselbe Lauf, dieselbe Beanspruchung, derselbe Deckel
// ════════════════════════════════════════════════════════════════════
//
//   curl -X POST -H 'Content-Type: application/json' \
//     -d "{\"key\":\"$TRIGGER_KEY\"}" \
//     https://europe-west1-markendetektive-895f7.cloudfunctions.net/processExternalMissesManual
//
// Der Schlüssel geht nur im Body: Adressen stehen im Klartext in den
// Zugriffsprotokollen (Befund Funktionsinventar 01.10.2026).

function schluesselStimmt(erwartet, gegeben) {
  if (typeof erwartet !== 'string' || !erwartet || typeof gegeben !== 'string') return false;
  const a = Buffer.from(erwartet);
  const b = Buffer.from(gegeben);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.processExternalMissesManual = functions.https.onRequest(LAUF_OPTIONEN, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('POST mit {"key": …} im Body');
    return;
  }
  const triggerKey = TRIGGER_KEY.value();
  if (!schluesselStimmt(triggerKey, req.body && req.body.key)) {
    res.status(401).send('Unauthorized');
    return;
  }
  try {
    const bericht = await prozessor.lauf({
      triggerKey,
      serperKey: SERPER_API_KEY.value(),
      quelle: 'hand',
    });
    res.status(200).json(bericht);
  } catch (e) {
    console.error('processExternalMissesManual:', e);
    res.status(500).send(String((e && e.message) || e));
  }
});
