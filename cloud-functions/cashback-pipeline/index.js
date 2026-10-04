/**
 * Cashback / Kassenbon Async Pipeline — Phase 2.
 *
 *   App                                        Cloud Functions
 *   ┌──────────────────┐  cashbackEnqueue   ┌──────────────────────┐
 *   │ /cashback/review │ ──── HTTPS ──────▶ │ enqueueCashback()    │
 *   │ uploads to GCS   │  { storagePath, …} │ • auth + consent gate│
 *   │ + calls function │ ◀──── 200 ──────── │ • idempotency        │
 *   └──────────────────┘  { cashbackId, … } │ • daily cap          │
 *                                            │ • create Firestore   │
 *                                            │ • publish PubSub     │
 *                                            └──────────┬───────────┘
 *                                                       │ async
 *                                                       ▼
 *                                            ┌──────────────────────┐
 *                                            │ processCashback()    │
 *                                            │ • download image     │
 *                                            │ • Gemini OCR         │
 *                                            │ • reconciliation     │
 *                                            │ • tier formula       │
 *                                            │ • write back doc     │
 *                                            │ • FCM push (stub)    │
 *                                            └──────────────────────┘
 *
 * Deploy:
 *   firebase deploy --only functions:cashback-pipeline
 *
 * Env vars (set via `firebase functions:config:set` or Secret Manager):
 *   GEMINI_API_KEY     — for the OCR call
 *   CASHBACK_OCR_MODEL — optional override (default gemini-3.5-flash)
 *
 * Region: europe-west3 (matches existing cashback architecture spec).
 *
 * Phase 2.1 follow-ups:
 *   - Real FCM via admin.messaging() once @react-native-firebase/messaging
 *     lands in the app bundle.
 *   - DocAI Expense Parser fallback when Σ-vs-total reconciliation fails.
 *   - BigQuery cost-event streaming.
 *   - Catalog match (productId / brandId per item) — Phase 3.
 */

'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { logger } = require('firebase-functions');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onMessagePublished } = require('firebase-functions/v2/pubsub');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { PubSub } = require('@google-cloud/pubsub');

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
// Tremendous-API-Key (Sandbox ODER Production — je nach env TREMENDOUS_ENV).
// Secret setzen: firebase functions:secrets:set TREMENDOUS_API_KEY
const TREMENDOUS_API_KEY = defineSecret('TREMENDOUS_API_KEY');
// Webhook-Signing-Key (Tremendous „Private key") für die Signaturprüfung.
const TREMENDOUS_WEBHOOK_SECRET = defineSecret('TREMENDOUS_WEBHOOK_SECRET');
// Admin-Key für resolveCashbackReview — wiederverwendet das projektweite
// Trigger-Secret (kein neues Secret nötig). ClickUp 86caf62v6.
const CASHBACK_ADMIN_KEY = defineSecret('NUTRITION_SCRAPER_TRIGGER_KEY');

const { extractReceipt, reconcile, countEligibleItems, tierFor, isPfandItem, DEFAULT_MODEL } = require('./lib/ocr');
const { extractReceiptCVHybrid } = require('./lib/ocr_cvhybrid');
const { extractReceiptRobust } = require('./lib/ocr_robust');
const { uebernehmeClientKontext, logZusammenfassung: clientKontextLog } = require('./lib/clientKontext');
const { moneyFieldAgreement, normMerchant } = require('./lib/fieldAgreement');
const { refereeMode, shouldRequestReferee, infraVerhindert: refereeInfraVerhindert, einheitlicheUhrzeit } = require('./lib/refereePolicy');
const { runReferee } = require('./lib/ocr_referee');
const { extractReceiptDocAI, isConfigured: isDocAIConfigured } = require('./lib/ocr_docai');
const { deriveStoreAddress } = require('./lib/storeAddress');
const { resolveRegion, pickCampaignForRegion, matchesTargeting, targetingStamp } = require('./lib/targeting');
const { aktionZumZeitpunkt, wirksameAktionId } = require('./lib/campaignZeit');
const { laufBeginnen, laufBeenden, entscheidungBeanspruchen, entscheidungFreigeben, aktiveLaeufe, laufFeld, LAUF_MAX_MS } = require('./lib/laufAnspruch');
const { resolveMerchant, nameVerwertbar } = require('./lib/merchant');
const { sendCashbackReady } = require('./lib/push');
const { erstelleGastUebernahme, kontoPruefen, tokenPruefen } = require('./lib/gastUebernahme');
const { sperreRef, istGesperrt, GRUND_KONTO_GESPERRT, GRUND_SPERRE_UNPRUEFBAR } = require('./lib/kontoSperre');
const {
  SCHLUESSEL_SAMMLUNG: DOPPEL_SCHLUESSEL,
  TAGE_SAMMLUNG: DOPPEL_TAGE,
  SUMMEN_SAMMLUNG: DOPPEL_SUMMEN,
  MAX_TAGES_EINTRAEGE,
  MAX_SUMMEN_EINTRAEGE,
  identitaet: bonIdentitaet,
  identitaetAusBon,
  eintragAus,
  tagesEintragAus,
  summenEintragAus,
  tageImFenster,
  uhrzeitNormal,
  doppelModi,
  modiVermerk,
  kontenArtikelKandidaten,
  kontenDatumKandidaten,
  veralteteSummenEintraege,
  doppelUrteil,
  grundFuer: doppelGrund,
  schalterModus,
} = require('./lib/doppelBon');
const { pruefeKandidaten: bildKandidatenPruefen } = require('./lib/bildVergleich');
const { istOnlineBestellung, belegBereinigen, onlineMerkmal } = require('./lib/belegart');
const {
  computeDHash,
  hammingDistance,
  readExifMeta,
  deriveForensicFlags,
  computeContentHash,
  computeTransactionHash,
  computeItemsHash,
} = require('./lib/forensics');

// Parse "HH:MM[:SS]" → minutes-of-day, else null.
function parseHHMM(t) {
  if (typeof t !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
// True when two bonTimes are within `maxMinutes`. When either time is
// missing we can't apply the window → block conservatively (same items +
// market + day is already a very strong duplicate signal).
function bonTimesWithin(a, b, maxMinutes) {
  const pa = parseHHMM(a);
  const pb = parseHHMM(b);
  if (pa == null || pb == null) return true;
  return Math.abs(pa - pb) <= maxMinutes;
}

// OCR engine selection. Default = gemini-direct (Gemini-on-image with the
// v1.3 image prompt + gemini-3.5-flash).
//
// Why NOT cv-hybrid anymore (2026-06-08): cv-hybrid feeds Cloud Vision's FLAT
// linearized text to Gemini. On the (very common) thermal bons whose price
// column prints vertically OFFSET from the item names, Vision linearizes the
// columns in the wrong interleaving — e.g. REWE: "CHORIZO\nSERRANO\n2,49\n4,99"
// (names even reversed) — and the geometry that would pair them correctly is
// already lost in the flat text. No text prompt can recover it. The image
// path SEES the layout, and the v1.3 prompt's order/offset rules pair it
// right. Benchmarked on 37 real bons: gemini-direct(3.5,v1.3) = 30/37
// reconciliation-clean vs cv-hybrid's wrong stored pairings; the exact bon
// the user reported (LiDL 22,34 €) → cv-hybrid mispaired, gemini-direct Δ=0.
// cv-hybrid stays available via CASHBACK_OCR_ENGINE=cv-hybrid for A/B.
const OCR_ENGINE = (process.env.CASHBACK_OCR_ENGINE || 'gemini-direct').toLowerCase();

// When the primary OCR fails reconciliation (asymmetric tolerance),
// re-run via DocAI Expense Parser as a fallback. Cost: $0.05/page only
// on the bons that need it. Auto-no-op if DocAI env vars unset.
const ESCALATE_ON_RECON_FAIL = process.env.CASHBACK_ESCALATE_DOCAI !== 'false';
// Eskalations-Deckel (Kosten, 19.08.2026): teure OCR-Leiter (Enhance/Pro/
// DocAI) überspringen, wenn ≥2 unabhängige Basis-Lesungen zeigen, dass der
// Bon ohnehin an einem Policy-Gate scheitert (deutlich zu alt / Markt
// unbekannt). Kill-Switch: CASHBACK_OCR_ESCALATION_CAP=false. Die Alters-
// Marge schützt gegen Datums-Fehllesungen (Kappen erst DEUTLICH über Limit).
const ESCALATION_CAP_ENABLED = String(process.env.CASHBACK_OCR_ESCALATION_CAP ?? 'true') !== 'false';
const ESCALATION_CAP_AGE_MARGIN_DAYS = Number(process.env.CASHBACK_OCR_ESCALATION_CAP_AGE_MARGIN || 14);

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west3';
const PUBSUB_TOPIC = 'cashback-ocr-jobs';
const CONFIG_DOC_PATH = 'cashback_config/v1';

// Bon must be no older than this many days (server-time check, not
// client). Avoids backdated bons + bons forgotten in a drawer for
// months. Go-Live (ClickUp 86caf62v6): echtes Limit aktiviert (vorher 9999 =
// quasi aus, nur fürs Testen). Das aktions-spezifische maxAgeDays hat weiterhin
// Vorrang (effectiveMaxAgeDays); per cashback_config tunebar machbar (future).
const MAX_BON_AGE_DAYS = 7;

// Der EXIF-Alters-HARD-REJECT am enqueue (vor OCR/Campaign-Auflösung) nutzt
// bewusst eine GROSSZÜGIGE Obergrenze statt MAX_BON_AGE_DAYS. Grund: das echte,
// aktionsspezifische Limit (effectiveMaxAgeDays) ist erst in processCashback
// bekannt — würde der enqueue-Gate mit den globalen 7 Tagen hart ablehnen,
// blockt er bei einer langlaufenden Aktion (maxAgeDays>7) legitime Bons VOR der
// Campaign-Auflösung. Deshalb fängt der enqueue-Gate nur absurd alte Foto-
// Uploads (>90 Tage) + Zukunfts-Datierungen (Clock-Tamper, limit-unabhängig)
// ab; die präzise Kauf-Alters-Prüfung besitzt der bonDate-Gate in
// processCashback (campaign-aware). Go-Live-Härtung (ClickUp 86caf62v6).
const MAX_BON_AGE_DAYS_EXIF_CEILING = 90;

// Hamming-distance threshold for "near-duplicate" dHash matches.
// 0 = bit-identical (same image, possibly re-encoded at different
// JPEG quality). ≤5 still very likely the same image. We pick a
// conservative ≤3 so we catch obvious re-uploads without false-flagging
// distinct bons that happen to be visually similar (two Aldi bons
// with mostly the same items).
const DHASH_DUPLICATE_THRESHOLD = 3;

// How many recent receipts to load for the near-duplicate scan.
// Bigger = better recall, more cost per upload. 50 covers typical
// power users (50 days @ 1 bon/day, or 50 last bons of any cadence).
const DHASH_DEDUP_LOOKBACK = 50;

// 86ca0wbg7 — B: zusätzlich zur Count-Grenze den Fuzzy-Dedup-Scan auf ein
// ZEITFENSTER bounden (createdAt), damit die Prüfung auch bei Tausenden Bons
// klein bleibt. Großzügig (länger als jedes plausible maxAgeDays), damit die
// Dedup-Abdeckung praktisch nicht leidet — nur unbegrenztes Wachstum verhindert.
const DHASH_DEDUP_LOOKBACK_DAYS = 120;

// Feinvergleich der dHash-Treffer (04.10.2026, lib/bildVergleich.js): nur
// gegen Bons, die noch laufen oder Geld bekommen haben. Gegen abgelehnte und
// unvergütete Bons ist ein Neuversuch erlaubt (wie bei der Inhaltsprüfung).
const BILD_SPERR_STATUS = new Set(['approved', 'paid', 'matched', 'review', 'ocr_pending']);
// Zusammen für alle Kandidaten (Download + Vergleich); danach wird gelesen.
const BILD_FEINVERGLEICH_BUDGET_MS = 15_000;
// Dieselbe DATEI noch einmal nach einer Ablehnung wegen eines Lesefehlers:
// einmal neu lesen statt „schon eingereicht" (Prüfrunde 04.10.: 25 solche
// Sperren in 30 Tagen, der App-Text „dein erster Eintrag bleibt gültig" stimmte
// dort nicht). Nur diese Gründe — bei bon_too_old oder unknown_merchant liest
// eine neue Lesung dasselbe, und jede Lesung kostet.
const BYTE_NEUVERSUCH_GRUENDE = new Set([
  'no_bon_date', 'reconciliation_delta', 'not_a_receipt', 'process_error', 'max_retries_exceeded',
]);
// Regeln der Buchung, ohne die der Feinvergleich nicht scharf wird: er lässt
// Kopien durch, die der grobe dHash sperrte (Beschnitt, anders gelesene Summe,
// geändertes Datum) — die müssen dann in der Buchung hängen bleiben.
const BILD_FEIN_VORAUSSETZUNGEN = ['doppelSumme', 'doppelArtikel', 'doppelDatum'];

/** Modus des Bild-Feinvergleichs: true nur mit allen Voraussetzungen, sonst wie 'shadow'. */
function bildFeinModus(config = {}) {
  const roh = schalterModus(config.bildFeinvergleich);
  const fehlt = roh === true ? BILD_FEIN_VORAUSSETZUNGEN.filter((k) => schalterModus(config[k]) !== true) : [];
  return { modus: fehlt.length ? 'shadow' : roh, fehlt };
}

// 86ca0wbg7 — A: Max. Verarbeitungs-Versuche pro Bon. Nach so vielen
// fehlgeschlagenen Retries wird der Bon endgültig abgelehnt (poison message),
// statt bis zur PubSub-TTL (~7 Tage) immer wieder (teuer) verarbeitet zu werden.
const MAX_PROCESS_ATTEMPTS = 5;

// ═══ Laufzeit eines processCashback-Laufs (03.10.2026) ═══
// Vom 28.09. bis 02.10. überzogen 304 Läufe die 540 s, weil einzelne Gemini-
// Lesungen minutenlang nicht beantwortet wurden. Cloud Run beendet nach 540 s
// nur die Anfrage, nicht den Code: 260 dieser Läufe rechneten im Hintergrund
// weiter und schrieben ihr Ergebnis 9–37 min nach Start — während der
// Lauf-Anspruch (lib/laufAnspruch.js, 10 min) schon verfallen war und der
// Kehrlauf denselben Bon ein zweites Mal zugestellt hatte. Seitdem:
//   • Die OCR-Leiter hält ein Laufbudget ein (lib/ocr_robust.js, 400 s ab
//     LAUF-Start). Reicht es nicht, legt sie den Zwischenstand am Bon ab
//     (`ocrZwischenstand`) und dieser Lauf stellt den Bon sofort neu zu —
//     der nächste setzt fort. Ohne Ergebnis wird nichts entschieden.
//   • Nach LAUF_ZEITGRENZE_MS beginnt kein Lauf mehr einen Schritt, der
//     Entscheidungen schreibt (Anforderung der Zweitprüfung, Buchung). So
//     schreibt kein Lauf mehr nach dem Ende seines Anspruchs.
const LAUF_ZEITGRENZE_MS = 480_000;
// Obergrenze der Läufe, über die sich EINE OCR-Leiter verteilen darf. Die Leiter
// hat höchstens 7 Plätze + 3 Ersatzversuche und macht in jedem Lauf Fortschritt;
// mehr Läufe deuten auf einen Fehler — dann wie ein Ausfall behandeln.
const OCR_LAEUFE_MAX = 8;

/**
 * Wirft, wenn der Lauf zu alt ist, um noch Entscheidungen zu schreiben. Der Bon
 * bleibt `ocr_pending` (OCR ist schon gespeichert), der Kehrlauf stellt neu zu;
 * nach MAX_PROCESS_ATTEMPTS landet er in 'review', nie in 'rejected'.
 */
function laufzeitPruefen(laufStart, schritt) {
  const ms = Date.now() - laufStart;
  if (ms > LAUF_ZEITGRENZE_MS) {
    const err = new Error(`lauf_zeitgrenze: ${Math.round(ms / 1000)} s seit Laufbeginn, vor ${schritt}`);
    err.code = 'lauf_zeitgrenze';
    throw err;
  }
}

/**
 * 86ca0wbg7 — Baut das `ocr`-Feld fürs Bon-Doc. Einmal definiert, damit der
 * frühe Idempotenz-Persist (nach der OCR) und der finale Write identisch sind.
 */
function buildOcrField(ocr, recon, escalation) {
  return {
    model: ocr.model,
    engine: ocr.engine ?? null,
    promptVersion: ocr.promptVersion,
    latencyMs: ocr.latencyMs,
    cvLatencyMs: ocr.cvLatencyMs ?? null,
    geminiLatencyMs: ocr.geminiLatencyMs ?? null,
    parsed: ocr.parsed,
    confidence: ocr.parsed.ocrConfidence ?? null,
    // Self-consistency confidence from the robust engine (high/medium/low/none)
    // + attempts — for monitoring + an optional approval gate.
    robust: ocr.robust ?? null,
    // Token-Verbrauch der GEWÄHLTEN Lesung (nicht Summe aller Versuche —
    // dafür steht robust.attempts daneben). `thoughts` sind die unsichtbaren
    // Denk-Token: 60-69 % der Output-Token und damit der Hauptkostentreiber
    // der Pipeline, bis 16.08.2026 nirgends erfasst und deshalb monatelang
    // nur per Nachmessung sichtbar. Ab jetzt je Bon ablesbar.
    chosenReadTokens: {
      input: ocr.inputTokens ?? null,
      output: ocr.outputTokens ?? null,
      thoughts: ocr.thoughtsTokens ?? null,
    },
    escalation: escalation?.fired ? escalation : null,
    // Zweitprüfung (86cbfvwge). Beide Felder MÜSSEN hier stehen: diese
    // Funktion ist eine Whitelist, und der Final-Write ersetzt `ocr` komplett.
    // Fehlte `refereeRequest`/`referee`, wäre die Schleifensperre nach dem
    // ersten Write weg (derselbe Fehlertyp wie `robust` am 02.09.).
    refereeRequest: ocr.refereeRequest ?? null,
    referee: ocr.referee ?? null,
    reconciliation: {
      ok: recon.ok,
      sumItemsCents: recon.sumItemsCents,
      totalCents: ocr.parsed.totalCents ?? null,
      deltaCents: recon.deltaCents,
      signedDeltaCents: recon.signedDeltaCents,
      direction: recon.direction,
      basketDiscountCents: recon.basketDiscountCents ?? null,
    },
  };
}

/**
 * Baut `ocr`/`recon`/`escalation` aus dem am Bon gespeicherten OCR-Feld —
 * ohne Modellaufruf. Einmal definiert, weil die Zweitprüfung denselben Weg
 * mit einem frisch gelesenen Stand noch einmal gehen muss.
 */
function ocrFromCache(cachedOcr) {
  const ocr = {
    parsed: cachedOcr.parsed,
    engine: cachedOcr.engine ?? null,
    model: cachedOcr.model ?? null,
    promptVersion: cachedOcr.promptVersion ?? null,
    latencyMs: cachedOcr.latencyMs ?? null,
    cvLatencyMs: cachedOcr.cvLatencyMs ?? null,
    geminiLatencyMs: cachedOcr.geminiLatencyMs ?? null,
    // Self-Consistency-Ergebnis MIT übernehmen (Money-Ops-Review 02.09.):
    // ohne `robust` sah das Review-Gate 6w bei jedem Retry/Reprocessing
    // conf=null → kein Halt → ungeprüfte Gutschrift, und der Final-Write
    // überschrieb robust am Doc mit null.
    robust: cachedOcr.robust ?? null,
    inputTokens: cachedOcr.chosenReadTokens?.input ?? null,
    outputTokens: cachedOcr.chosenReadTokens?.output ?? null,
    thoughtsTokens: cachedOcr.chosenReadTokens?.thoughts ?? null,
    refereeRequest: cachedOcr.refereeRequest ?? null,
    referee: cachedOcr.referee ?? null,
    ocrText: '',
  };
  const recon =
    cachedOcr.reconciliation && typeof cachedOcr.reconciliation.ok === 'boolean'
      ? cachedOcr.reconciliation
      : reconcile(ocr.parsed);
  const escalation = cachedOcr.escalation || { fired: false };
  return { ocr, recon, escalation };
}

// Zweitprüfung: so lange gilt ein Anspruch als „läuft gerade". Länger als die
// Frist der Prüfung (lib/ocr_referee.js, 330 s) plus Puffer, kürzer als der
// Sweeper-Takt (20 min), damit ein abgestürzter Lauf wieder aufgenommen wird.
const REFEREE_CLAIM_MS = 8 * 60 * 1000;

/** Tagesdeckel der Zweitprüfung; ungültige Werte gelten als Standard, nie als „unbegrenzt". */
function refereeTagesDeckel(value) {
  const v = typeof value === 'number' ? value : Number.NaN;
  return Number.isInteger(v) && v >= 0 ? v : DEFAULT_CONFIG.ocrRefereeMaxPerDay;
}

/**
 * Nimmt die Zweitprüfung eines Bons transaktional in Anspruch. PubSub stellt
 * mindestens einmal zu, und der Sweeper legt ältere Bons erneut auf — ohne
 * Anspruch liefen zwei teure Prüfungen parallel. Zählt die Läufe pro Berliner
 * Tag gegen `ocrRefereeMaxPerDay` (Kostendeckel).
 *
 * Wiederaufnahme des EIGENEN Anspruchs (Review 14.09.): nur bei derselben
 * Event-ID UND gestiegenem `attempts` (der catch-Block zählt hoch). Eine
 * gleichzeitige Doppelzustellung trägt dieselbe Event-ID, aber denselben
 * Zähler → „läuft gerade"; sonst liefen zwei bezahlte Prüfungen parallel.
 * Achtung: der Trigger hat KEINEN PubSub-Retry (DO_NOT_RETRY) — dieser Zweig
 * greift nur bei einer verspäteten Doppelzustellung. Die reguläre
 * Wiederaufnahme ist der Sweeper: neue Event-ID, frühestens nach 20 min, der
 * Anspruch (8 min) ist dann abgelaufen und wird neu genommen.
 *
 * Beim Tagesdeckel wird NICHTS geschrieben: die Anfrage bleibt offen, eine
 * spätere Nachverarbeitung kann die Prüfung noch holen.
 *
 * @returns {Promise<{state: 'claimed'|'busy'|'done'|'gone'|'daily_cap', ocr?: object}>}
 */
async function claimRefereeRun(docRef, maxPerDay, eventId) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const data = snap.exists ? snap.data() : {};
    const o = data.ocr || null;
    if (!o || !o.parsed) return { state: 'gone' };
    if (o.referee) return { state: 'done', ocr: o };
    const req = o.refereeRequest;
    if (!req) return { state: 'gone' };
    const versuche = data.attempts || 0;
    const claimedMs = req.claimedAt?.toMillis?.() ?? 0;
    const laeuft = claimedMs && Date.now() - claimedMs < REFEREE_CLAIM_MS;
    const wiederaufnahme = Boolean(laeuft && eventId && req.claimedBy === eventId
      && Number.isFinite(req.claimedAttempt) && versuche > req.claimedAttempt);
    if (laeuft && !wiederaufnahme) return { state: 'busy' };
    const dayRef = db.doc(`cashback_referee_usage/${todayBerlin()}`);
    const daySnap = await tx.get(dayRef);
    const runs = daySnap.exists ? daySnap.data().runs || 0 : 0;
    const deckel = refereeTagesDeckel(maxPerDay);
    if (!wiederaufnahme && deckel > 0 && runs >= deckel) return { state: 'daily_cap' };
    const claimedAt = admin.firestore.Timestamp.now();
    const anspruch = { claimedAt, claimedBy: eventId || null, claimedAttempt: versuche };
    tx.update(docRef, {
      'ocr.refereeRequest.claimedAt': anspruch.claimedAt,
      'ocr.refereeRequest.claimedBy': anspruch.claimedBy,
      'ocr.refereeRequest.claimedAttempt': anspruch.claimedAttempt,
    });
    if (!wiederaufnahme) {
      tx.set(dayRef, { runs: admin.firestore.FieldValue.increment(1), updatedAt: claimedAt }, { merge: true });
    }
    return { state: 'claimed', ocr: { ...o, refereeRequest: { ...req, ...anspruch } } };
  });
}

/**
 * Legt das Ergebnis der Zweitprüfung ab — nur, wenn der Anspruch noch UNSER
 * ist und noch kein Ergebnis dasteht. Sonst hat ein anderer Lauf übernommen:
 * steht dessen Ergebnis schon da, mit DEM weiterrechnen (`done`); fehlt es,
 * gehört der Bon gerade dem anderen Lauf (`verloren`).
 *
 * @returns {Promise<{state: 'ok'}|{state: 'done', ocr: object}|{state: 'verloren'}>}
 */
async function persistRefereeResult(docRef, fields, anspruch) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const o = snap.exists ? snap.data().ocr : null;
    if (o && o.parsed && o.referee) return { state: 'done', ocr: o };
    const req = o?.refereeRequest;
    const unserer = req
      && req.claimedBy === anspruch.claimedBy
      && req.claimedAttempt === anspruch.claimedAttempt
      && req.claimedAt?.toMillis?.() === anspruch.claimedAt?.toMillis?.();
    if (!unserer) return { state: 'verloren' };
    tx.update(docRef, fields);
    return { state: 'ok' };
  });
}

/**
 * Schreibt das `ocr`-Feld NUR, wenn am Dokument noch keine Zweitprüfung
 * angefordert oder abgelegt ist (Review 14.09., Befund „Überschreiben"). Das
 * `ocr`-Feld wird immer ganz ersetzt; ein paralleler Lauf mit älterem Stand
 * (z. B. frische OCR nach Reprocessing + Sweeper) würde sonst Anspruch und
 * Ergebnis der Prüfung löschen — mit der Folge paralleler, bezahlter Prüfungen
 * und im schlimmsten Fall einer Storno-Buchung gegen eine entschiedene
 * Gutschrift.
 *
 * @returns {Promise<'ok'|'ueberholt'>}
 */
async function writeOcrIfNoReferee(docRef, fields) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const o = snap.exists ? snap.data().ocr : null;
    // Ohne `parsed` ist der gespeicherte Stand unbrauchbar (z. B. Ops hat nur
    // die Lesung geleert) — dann darf die frische OCR ihn ersetzen, sonst
    // bliebe der Bon für immer hängen.
    if (o && o.parsed && (o.refereeRequest || o.referee)) return 'ueberholt';
    tx.update(docRef, fields);
    return 'ok';
  });
}

// In-memory PubSub publisher (re-used across invocations).
const pubsub = new PubSub();

/**
 * OCR-Leiter hat ihr Laufbudget erreicht (lib/ocr_robust.js, code
 * 'ocr_zeitbudget'): Zwischenstand am Bon ablegen und den Bon sofort neu
 * zustellen — derselbe Weg wie die Anforderung der Zweitprüfung. Es wird
 * nichts entschieden; die App zeigt weiter „Bon wird geprüft".
 *
 * Transaktional: hat ein anderer Lauf die OCR inzwischen fertig gespeichert,
 * ist der Zwischenstand überholt — dann weder ablegen noch neu zustellen. In
 * derselben Transaktion gibt dieser Lauf seinen Anspruch ab: solange ein
 * Zwischenstand steht, lässt laufBeginnen nur EINEN Lauf zu
 * ('fortsetzung_laeuft'), und der Nachfolger darf nicht an seinem Vorgänger
 * hängen bleiben, falls die Zustellung schneller ist als dessen Abmeldung.
 * Wirft bei Firestore-/PubSub-Fehlern (der normale Retry greift; der
 * Zwischenstand bleibt, falls er schon abgelegt war).
 */
async function ocrFortsetzen({ docRef, cashbackId, uid, eventId, stand }) {
  const grenze = (laeufe) => {
    const err = new Error(`ocr_unavailable: Leiter nach ${laeufe} Läufen nicht fertig (${stand.failed.length} Fehlversuche)`);
    err.code = 'ocr_unavailable';
    return err;
  };
  if (!(stand.laeufe < OCR_LAEUFE_MAX)) throw grenze(stand.laeufe);
  // Die Grenze hängt zusätzlich am Bon (`ocrFortsetzungen`), nicht nur am
  // Zwischenstand: wird der beim Laden verworfen, begänne sein Zähler neu, und
  // ein Bon könnte ohne Ende neu gelesen werden — jede Runde mit bezahlten
  // Modell-Aufrufen, ohne dass attempts oder sweepCount steigen (Review
  // 03.10.2026). Gelöscht wird der Zähler zusammen mit dem Zwischenstand.
  let bisher = 0;
  const ergebnis = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return 'weg';
    const d = snap.data();
    const o = d.ocr;
    if (o && o.parsed) return 'ueberholt';
    bisher = Number.isInteger(d.ocrFortsetzungen) ? d.ocrFortsetzungen : 0;
    if (bisher + 1 >= OCR_LAEUFE_MAX) return 'grenze';
    tx.update(docRef, {
      ocrZwischenstand: stand,
      ocrFortsetzungen: bisher + 1,
      ...(eventId ? { [`verarbeitung.${laufFeld(eventId)}`]: admin.firestore.FieldValue.delete() } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return 'ok';
  });
  if (ergebnis === 'grenze') throw grenze(bisher + 1);
  if (ergebnis !== 'ok') {
    logger.warn('ocr-fortsetzung-ueberholt', { cashbackId, ergebnis });
    return;
  }
  await pubsub.topic(PUBSUB_TOPIC).publishMessage({
    json: { cashbackId, uid, fortsetzung: stand.laeufe },
    attributes: { uid, cashbackId },
  });
  logger.warn('ocr-fortsetzung', {
    cashbackId,
    lauf: stand.laeufe,
    lesungen: stand.reads.length,
    fehlversuche: stand.failed.length,
    zeitAbbrueche: stand.zeitAbbrueche,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  // Sicherer Rückfall: kommt die Konfiguration nicht durch, gilt das ALTE
  // Verhalten. `loadConfig()` fällt bei jedem Lesefehler hierher zurück — ohne
  // diesen Eintrag wäre ausgerechnet die neue Lockerung dann aktiv (86cbet2w1).
  // Scharfschalten geschieht ausdrücklich in `cashback_config/v1`, wo auch
  // `'shadow'` möglich ist: rechnen und protokollieren, aber nicht wirken.
  ocrFieldGate: false,
  // Zweitprüfung vor der Ablehnung unsicher gelesener Bons (86cbfvwge).
  // Gleiches Muster: Default aus, scharf nur über `cashback_config/v1`.
  // false = aus, 'shadow' = prüfen und am Bon ablegen, Entscheidung unverändert,
  // true = das Ergebnis der Prüfung gilt.
  ocrReferee: false,
  // Kostendeckel: höchstens so viele Prüfungen pro Berliner Tag (0 = kein
  // Deckel). Gemessen 14.09.: ~0,02–0,05 $ pro Lesung, bis zu 4 Lesungen →
  // im Extremfall ~8 $ pro Tag; real fielen seit 01.09. ~5–6 Bons pro Tag in
  // die Regel (77 in 14 Tagen).
  ocrRefereeMaxPerDay: 40,
  tiers: [
    { minItems: 4, cents: 5 },
    { minItems: 8, cents: 8 },
  ],
  dailyCap: 1,
  throttleHours: 24,
  minItemsForPayout: 4,
  eligibleMerchants: ['aldi', 'lidl', 'edeka', 'rewe', 'kaufland', 'penny', 'netto', 'dm', 'rossmann'],
  ocrModel: DEFAULT_MODEL,
  ocrPromptVersion: 'v1.0',
  manualReviewThreshold: 0.65,
  autoApproveThreshold: 0.85,
  kycRequiredAt: 2000,
  consentVersion: 'v1.0-2026-05',
  // Auszahlung erst ab diesem Guthaben (Cent). 1000 = 10 €.
  payoutThresholdCents: 1000,
  // Max. Cashback pro User + Kalendermonat (Cent) im Dauer-Modus. 0 = KEIN
  // Limit. Go-Live (86caf62v6): konservativer Sicherheits-Default 2000 (20 €/
  // User/Monat) gegen Account-Missbrauch — legitime Nutzer erreichen das im
  // Dauer-Modus nicht (Tageslimit 1 Bon → ~2 €/Monat). Cappt cashbackCents auf
  // die Rest-Headroom (Teilbetrag bleibt approved). PRODUKT-ENTSCHEIDUNG: in
  // cashback_config/v1 ohne Deploy anpassbar. Globales Gesamt-Dach gegen
  // Runaway-Spend = Tremendous-Funding-Balance.
  monthlyMaxCents: 2000,
  // Aktions-Modus: true → Cashback NUR während aktiver Kampagne
  // (cashback_campaigns). Keine Aktion → Bon verarbeitet + Produkte
  // getrackt, aber 0 Vergütung. Default false = Dauer-Cashback (kein Change).
  campaignsEnabled: false,
  // Übernahme von Gast-Einreichungen in ein bestehendes Konto (Umbau „erst
  // einreichen, dann Konto"). Aus = Tickets werden geprüft, aber nicht
  // eingelöst (`pausiert`). Scharf nur über cashback_config/v1, ohne Deploy.
  gastUebernahmeAktiv: false,
  // Doppel-Schutz in der Buchung (Entscheidung Patrick 04.10.2026,
  // lib/doppelBon.js). Je Regel false | 'shadow' | true; aus = altes
  // Verhalten. Einträge und Schlüssel schreibt die Buchung unabhängig davon.
  doppelSumme: false,
  doppelKonten: false,
  doppelArtikel: false,
  doppelArtikelSchwelle: 0.6,
  doppelArtikelMin: 5,
  doppelBestellnummer: false,
  // Gleiche Person, anderer Tag, gleiche Uhrzeit (Kopie mit geändertem Datum).
  doppelDatum: false,
  // Andere Person, gleicher Markt + Tag, gleiche Artikel (Uhrzeit verdeckt).
  doppelKontenArtikel: false,
  // Feinvergleich der dHash-Treffer beim Hochladen (lib/bildVergleich.js).
  // true wirkt erst, wenn doppelSumme, doppelArtikel UND doppelDatum true sind.
  bildFeinvergleich: false,
  // Eigenmarken-Stufe des Markt-Resolvers nur noch für Ladenbons mit Uhrzeit
  // (Picnic mit G&G ist nicht EDEKA). Ein schon bezahlter Bon behält seinen Markt.
  eigenmarkeNurLadenbon: false,
  // Prüfrunde 2/3: gleiche Person, Seiten einer Online-Rechnung; anderes Konto,
  // anderer Tag (Summen-Index).
  doppelOnlineSeite: false,
  doppelKontenDatum: false,
  // Ladenbon ohne verwertbaren Händlernamen streng prüfen (keine Namensstufen,
  // kein Tippfehler-Abgleich → unknown_merchant statt meist „dm"). Aus = wie
  // vor Prüfrunde 2. Vor true mit Patrick klären: trifft ehrliche Bons
  // unserer Märkte ohne Logo (Lidl, Netto; REWE rettet die Umsatzsteuer-ID).
  marktNurMitName: false,
};

const CAMPAIGNS_COL = 'cashback_campaigns';

// Aktuell laufende Aktion laden (active==true UND now in [startAt, endAt]).
// Bei mehreren: die mit dem frühesten Ende (läuft zuerst aus). null = keine.
/** Lade EINE Aktion per Doc-ID (die vom User gewählte). */
/**
 * Alle laufenden Aktionen einer Art (Default: Bons). Wird für die regionale
 * Auswahl gebraucht: passt die vom Client gewählte Aktion nicht zur Region des
 * Bons, muss der Server eine passende Alternative kennen.
 */
async function loadActiveCampaigns(kind = 'receipt') {
  try {
    const snap = await db.collection(CAMPAIGNS_COL).where('active', '==', true).get();
    const now = Date.now();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => (c.kind ?? 'receipt') === kind)
      .filter((c) => now >= toMs(c.startAt) && now <= toMs(c.endAt));
  } catch (e) {
    logger.warn('active-campaigns-failed', { err: e.message });
    return [];
  }
}

/** Alle Aktionen (kleine Sammlung) — für die Frage „was galt zum Zeitpunkt X". */
async function loadAllCampaigns() {
  try {
    const snap = await db.collection(CAMPAIGNS_COL).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    logger.warn('all-campaigns-failed', { err: e.message });
    return [];
  }
}

async function loadCampaignById(id) {
  if (!id) return null;
  try {
    const snap = await db.collection(CAMPAIGNS_COL).doc(id).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  } catch (e) {
    logger.warn('campaign-by-id-failed', { id, err: e.message });
    return null;
  }
}

/** Timestamp → ms (0 wenn fehlt). */
function toMs(ts) {
  return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0;
}

/**
 * Brutto-Cashback (Cent) für einen Bon im Kontext EINER Aktion, VOR
 * Wochenlimit / Per-User-Cap / Budget. Spiegel von `campaignReward` in
 * lib/types/cashback.ts — bei Änderung BEIDE anpassen.
 */
function campaignRewardCents(eligibleItemCount, campaign, config) {
  const minItems = Number.isFinite(campaign.minItems) ? campaign.minItems : config.minItemsForPayout;
  if (eligibleItemCount < minItems) return 0;
  if (Array.isArray(campaign.tiers) && campaign.tiers.length > 0) {
    return tierFor(eligibleItemCount, campaign.tiers);
  }
  const flat = Number(campaign.cashbackPerBonCents) || 0;
  return flat > 0 ? flat : 0;
}

/**
 * ISO-Wochen-Key (Mo–So) für ein Bon-Datum 'YYYY-MM-DD' → 'YYYY-Www'.
 * Donnerstag-Regel (ISO-8601). Bon-Datum ist bereits Berlin-Datum.
 */
function isoWeekKey(iso) {
  const base = /^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? String(iso).slice(0, 10) : todayBerlin();
  const d = new Date(base + 'T12:00:00Z');
  const dayNr = (d.getUTCDay() + 6) % 7; // Mo=0 … So=6
  d.setUTCDate(d.getUTCDate() - dayNr + 3); // Donnerstag dieser Woche
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((d - firstThu) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function loadConfig(opts = {}) {
  try {
    const snap = await db.doc(CONFIG_DOC_PATH).get();
    if (!snap.exists) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...snap.data() };
  } catch (e) {
    logger.warn('config-load-failed', { err: e.message });
    // strict (Resolver): NICHT auf DEFAULT_CONFIG (campaignsEnabled:false)
    // zurückfallen — ein Aktions-Bon würde sonst im Dauer-Modus verbucht.
    if (opts.strict) throw e;
    return DEFAULT_CONFIG;
  }
}

function todayBerlin() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
}

/**
 * Parse an ISO bon-date (YYYY-MM-DD) at noon-local-Berlin. Returns
 * null if unparseable.
 *
 * Why noon: the bon usually only carries a date, not a time. Anchoring
 * at 12:00 dodges DST + edge-of-day timezone weirdness when computing
 * age in days.
 */
function parseBonDateMs(iso) {
  if (typeof iso !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  // 12:00 UTC is "today" for any DACH timezone (CET/CEST is UTC+1/+2).
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Alter des Bons in Tagen — bezogen auf `refMs` (Default: jetzt). Die Pipeline
 * übergibt den UPLOAD-Zeitpunkt: die Pflicht des Nutzers ist „innerhalb von
 * N Tagen nach dem Kauf hochladen"; Verarbeitungsverzögerungen (Retries,
 * Incidents, Reprocessing) dürfen den Bon nicht nachträglich „zu alt" machen.
 */
function bonAgeDays(iso, refMs = Date.now()) {
  const ms = parseBonDateMs(iso);
  if (ms == null) return null;
  return Math.floor((refMs - ms) / (24 * 60 * 60 * 1000));
}

/**
 * 86cb9zuq1: Jahres-Fehllesung erkennen. Liest die OCR „24.08.26" als
 * 2020-08-24, landet der Bon als bon_too_old — obwohl Tag+Monat exakt dem
 * Upload-Tag entsprechen (37 Live-Fälle, alle dieses Musters; niemand lädt
 * Jahre später am selben Kalendertag hoch). Regel: Tag+Monat == Upload-Tag
 * (Berlin) UND Jahr != Upload-Jahr → Jahr auf das Upload-Jahr korrigieren.
 * @returns {{ bonDate: string|null, corrected: null|{from:string,to:string,reason:string} }}
 */
function plausibilizeBonDate(iso, uploadedAt) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { bonDate: iso ?? null, corrected: null };
  }
  const up = uploadedAt instanceof Date && Number.isFinite(uploadedAt.getTime()) ? uploadedAt : new Date();
  const upIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(up); // YYYY-MM-DD
  const upYear = upIso.slice(0, 4);
  if (iso.slice(5) === upIso.slice(5) && iso.slice(0, 4) !== upYear) {
    const to = `${upYear}-${iso.slice(5)}`;
    return { bonDate: to, corrected: { from: iso, to, reason: 'year_misread_same_day' } };
  }
  return { bonDate: iso, corrected: null };
}

/**
 * Per-user purchased-products trail (architecture §3.2). One doc per
 * (receiptId × item-name-slug) so reprocesses are idempotent (same
 * input → same doc-id → set with merge, no dupes).
 */
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-zäöüß0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// 86caf62v6 (B2B): Reject-Gründe mit VERLÄSSLICHEN Items — deren Bons werden
// trotz Ablehnung ins purchased_products-Trail geschrieben (rewardEligible=false),
// damit sie später im B2B ausgewertet werden können. Ausgeschlossen bleiben
// Gründe mit suspekten/fehlenden/doppelten Items (not_a_receipt,
// reconciliation_delta, duplicate*, no_bon_date, max_retries_exceeded).
const RELIABLE_REJECT_REASONS = new Set(['bon_too_old', 'unknown_merchant', 'below_min_items']);

async function writePurchasedProducts(uid, cashbackId, parsed, merchantInfo, meta = {}) {
  if (!parsed || !Array.isArray(parsed.items)) return;
  const col = db.collection(`users/${uid}/purchased_products`);
  // Filialadresse laut Bon (05.09.2026) — als flache Felder je Artikel, damit
  // B2B-Auswertungen nach PLZ/Ort direkt über purchased_products laufen.
  const store = deriveStoreAddress(parsed, merchantInfo?.land || null);
  const writes = [];
  for (const it of parsed.items) {
    if (!it || !Number.isFinite(it.priceCents) || it.priceCents <= 0) continue;
    const slug = slugify(it.name);
    if (!slug) continue;
    const id = `${cashbackId}_${slug}`;
    writes.push(
      col.doc(id).set(
        {
          itemName: String(it.name || ''),
          priceCents: it.priceCents,
          qty: Number.isFinite(it.qty) ? it.qty : 1,
          receiptId: cashbackId,
          bonDate: parsed.bonDate || null,
          merchantId: merchantInfo?.id || null,
          // 86ca0wbg7: echte discounter-DocID → direktes Markt-Matching gegen produkte.discounter
          discounterId: merchantInfo?.discounterId || null,
          merchantName: merchantInfo?.name || null,
          merchantLand: merchantInfo?.land || null,
          storeZip: store?.zip ?? null,
          storeCity: store?.city ?? null,
          storeStreet: store?.street ?? null,
          // Prompt v1.5: Online-Bestellungen tragen keine Filiale (store ist dann null).
          belegart: parsed.belegart ?? null,
          // B2B-Marker (86caf62v6): bonStatus = finaler Bon-Status; rewardEligible
          // = war der Bon angenommen/vergütet. rewardEligible=false markiert
          // valide-aber-abgelehnte Bons → der Matcher auto-matcht/Journey-schließt
          // sie NICHT (kein Cart-/receiptMatch-Side-Effect), sie bleiben aber für
          // die spätere B2B-Produktauswertung gespeichert.
          bonStatus: meta.status || null,
          rejectReason: meta.rejectReason || null,
          rewardEligible: meta.rewardEligible !== false,
          // Nachträglich geschrieben (Review-Freigabe/Backfill): der Matcher
          // matcht + lernt, schließt aber KEINE Journey/keinen Zettel (noClose).
          ...(meta.backfilled ? { backfilled: true } : {}),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
    );
  }
  await Promise.all(writes).catch((e) =>
    logger.warn('purchased-products-write-failed', { cashbackId, err: e.message }),
  );
}

/**
 * Netto gutgeschriebener Betrag eines Bons laut Ledger (Earn − Storno), außerhalb
 * einer Transaktion. Wirft bei einem Lesefehler — die Aufrufer behandeln das
 * fail-closed (ledger_precheck_failed → Wiederholung, nie eine Ablehnung).
 */
async function nettoGutgeschrieben(uid, cashbackId) {
  const ledgerCol = db.collection(`users/${uid}/cashback_ledger`);
  const [earnsSnap, reversesSnap] = await Promise.all([
    ledgerCol.where('receiptId', '==', cashbackId).where('type', '==', 'earn').get(),
    ledgerCol.where('receiptId', '==', cashbackId).where('type', '==', 'reverse').get(),
  ]);
  const sum = (snap) => snap.docs.reduce((a, d) => a + (d.data().cents || 0), 0);
  return sum(earnsSnap) - sum(reversesSnap);
}

/**
 * Idempotent ledger sync: enforce that a receiptId has AT MOST one
 * active 'earn' entry, and that the earn matches the current status.
 *
 * Cases handled:
 *   - First-time approved: write 'earn', bump balance + lifetime.
 *   - Already approved before, status still approved: noop (PubSub
 *     redelivery; previous earn is the source of truth).
 *   - Already approved, status now rejected/review: write 'reverse'
 *     for the prior cents, decrement balance + lifetime.
 *   - Status not approved + no prior earn: noop.
 *
 * Runs in a transaction so concurrent re-publishes can't race.
 *
 * Kontosperre (Entscheidung Patrick 02.10.2026, lib/kontoSperre.js): die
 * Transaktion liest `cashback_sperren/{uid}` mit. Gesperrt → KEIN neuer Earn
 * (capReason `konto_gesperrt`, der Aufrufer setzt daraus `no_reward`) und keine
 * Aufwärts-Korrektur. Bestehende Gutschriften bleiben, wie sie sind — die Sperre
 * storniert nichts. Weil dies die EINZIGE Stelle ist, an der ein Bon Geld
 * bekommt, gilt das für processCashback und resolveCashbackReview gleichermaßen.
 *
 * Doppel-Schutz (Entscheidung Patrick 04.10.2026, lib/doppelBon.js): Aus
 * demselben Grund prüft die Transaktion vor JEDER ersten Gutschrift, ob
 * derselbe Bon schon bezahlt ist — gegen die bezahlten Bons der Person
 * (`cashback_days/{Tag}.eintraege`; derselbe Tag, bei Regel datum ±8 Tage),
 * gegen die Schlüsseldokumente `cashback_bon_schluessel/{tx_…|bo_…}` und den
 * Tages-Index `cashback_bon_tage/{markt}_{tag}` (beide über alle Konten, „der
 * erste gewinnt", beim Storno wieder frei). Nur der Zweig ohne aktiven Earn
 * prüft — die Regel storniert also nie eine Gutschrift. Wirksam nur mit
 * Schalter (`opts.doppel`, 'shadow' = nur vermerken); Einträge, Schlüssel und
 * Summen-Index werden bei jeder Gutschrift geschrieben, damit sie beim
 * Scharfschalten schon da sind (der Tages-Index nur, solange seine Regel
 * läuft — Prüfrunde 3), und bei einer erneuten Zustellung um die Werte der neuen
 * Lesung ERGÄNZT (nie ersetzt): liest sie ein anderes Datum, sperrt der Bon
 * unter beiden Lesungen.
 * Ob ein fremder Schlüssel oder Index-Eintrag noch gilt, entscheidet das
 * LEDGER seines Besitzers (Earn − Storno > 0), nicht der Tageszähler — der ist
 * abgeleitet und wandert mit einer neuen Datumslesung (Prüfrunde 04.10.: ein
 * Schlüssel mit altem Tag galt nach dem Umhängen als frei → zweite Zahlung).
 * Dasselbe gilt für den eigenen Tageseintrag (Prüfrunde 2): wandert ein Bon
 * mit einer neuen Datumslesung in einen anderen Tag, bleibt sein Eintrag im
 * alten Tag stehen (nur `receiptIds` — das Tageslimit — räumt ihn), und die
 * Prüfung vergleicht auch gegen solche Einträge, sofern ihr Bon laut Ledger
 * noch bezahlt ist. Summen-Index `cashback_bon_summen/{markt}_{summe}` (Regel
 * kontenDatum, und für dieselbe Person Regel datum bis 95 Tage zurück): bei
 * jeder Gutschrift ergänzt, beim Storno entfernt, Ledger entscheidet.
 * opts.bon = lib/doppelBon identitaet() des Bons (fehlt → keine Prüfung).
 */
async function syncLedgerForReceipt(userRef, cashbackId, status, cashbackCents, bonDateIso, campaignId, campaignMode, caps = null, opts = {}) {
  const ledgerCol = userRef.collection('cashback_ledger');
  // Tatsächlich gutgeschriebener Betrag — kann durch Budget-Deckelung IN
  // der Transaktion < cashbackCents sein (+ ob das Budget dabei leer war).
  let creditedCents = cashbackCents;
  let budgetExhausted = false;
  // 86cb7ygjh + Audit R6#1: Wochen-/Per-User-/Monats-/Tageslimit werden
  // ebenfalls HIER, gegen den frischen userSnap der Transaktion, geprüft —
  // race-frei (zwei parallele Bons sehen nicht denselben stalen Zähler) und
  // selbst-exklusiv (dieser Zweig läuft nur ohne aktiven Earn; das Tages-
  // limit ignoriert den eigenen receiptId). capReason → Status außen.
  let capReason = null;
  // Hat GENAU DIESE Transaktion den Earn geschrieben? Nur dann darf der Aufrufer
  // „Ka-ching!" schicken (Push-Prüfung 24.09.2026). Ein vorab gelesenes
  // `alreadyCredited` reicht nicht: zwei gleichzeitige Läufe sehen beide
  // „noch nicht gebucht", einer bucht, der andere landet im Noop-Zweig — und
  // meldete bisher trotzdem `creditedCents > 0`.
  let frischGebucht = false;
  // Doppel-Prüfung (04.10.2026): der wirksame Treffer bzw. der erste aus der
  // Beobachtung, alle Treffer, und ob überhaupt geprüft wurde.
  let doppel = null;
  let doppelTreffer = [];
  let doppelGeprueft = false;
  const neu = opts.bon && typeof opts.bon === 'object' ? opts.bon : null;
  const modi = opts.doppel || doppelModi({});
  const eintraegeVon = (snap) => {
    const e = snap && snap.exists ? snap.data().eintraege : null;
    return e && typeof e === 'object' ? e : {};
  };

  await db.runTransaction(async (tx) => {
    // Firestore wiederholt den Callback bei Konflikt → Ergebnisfelder pro
    // Versuch zurücksetzen, sonst bleibt z.B. capReason aus dem verworfenen
    // ersten Versuch stehen (Backlog-Audit 02.09.).
    creditedCents = cashbackCents;
    budgetExhausted = false;
    capReason = null;
    frischGebucht = false;
    doppel = null;
    doppelTreffer = [];
    doppelGeprueft = false;
    // ── Alle Reads ZUERST (Firestore-Transaktions-Regel) ──
    const earns = await tx.get(
      ledgerCol.where('receiptId', '==', cashbackId).where('type', '==', 'earn'),
    );
    const reverses = await tx.get(
      ledgerCol.where('receiptId', '==', cashbackId).where('type', '==', 'reverse'),
    );
    const userSnap = await tx.get(userRef);
    // Kontosperre IN der Transaktion: eine während des Laufs gesetzte Sperre
    // kann nicht zwischen Prüfung und Buchung durchrutschen. Scheitert der
    // Lesevorgang, scheitert die Buchung als Ganzes (Wiederholungsweg des
    // Aufrufers) — gebucht wird nie, solange die Sperre unbekannt ist.
    const gesperrt = istGesperrt(await tx.get(sperreRef(db, userRef.id)));
    // Aktions-Budget FRISCH in der Transaktion lesen → race-frei cappen.
    const campaignRef = campaignId ? db.collection(CAMPAIGNS_COL).doc(campaignId) : null;
    const campaignSnap = campaignMode && campaignRef ? await tx.get(campaignRef) : null;
    // Tageszähler (Money-Ops 05.09.2026): users/{uid}/cashback_days/{YYYY-MM-DD}
    // = { bonDate, receiptIds[] } ist die Quelle der Wahrheit fürs Tageslimit.
    // Ersetzt das Vorwärts-Feld cashback_last_bon_date, das nur das JÜNGSTE
    // Datum kannte — jeder nachgereichte ältere Bon umging so das Limit.
    // Gelesen VOR allen Writes (Transaktions-Regel); der eigene Bon zählt nie.
    const bonDay = (bonDateIso || todayBerlin()).slice(0, 10);
    const dayRef = userRef.collection('cashback_days').doc(bonDay);
    const daySnap = await tx.get(dayRef);
    const dayIds = Array.isArray(daySnap.data()?.receiptIds) ? daySnap.data().receiptIds : [];
    const dayOthers = dayIds.filter((id) => id !== cashbackId);
    // Reverse: der Bon kann unter MEHREREN Tagen stehen (Datum zwischen Earn
    // und Reverse geändert, Altbestand ohne ledger.bonDate, Backfill-Schlüssel
    // = gespeichertes receipts.bonDate). Darum ALLE Kandidaten-Tage lesen —
    // Ledger-Earns, Aufrufer-Datum, opts.extraDays — und überall entfernen.
    const candidateDays = new Set([
      bonDay,
      ...(Array.isArray(opts.extraDays) ? opts.extraDays : []).filter((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)),
      ...earns.docs.map((d) => d.data().bonDate).filter((v) => typeof v === 'string' && v),
    ]);
    const daySnaps = new Map([[bonDay, daySnap]]);
    for (const day of candidateDays) {
      if (!daySnaps.has(day)) daySnaps.set(day, await tx.get(userRef.collection('cashback_days').doc(day)));
    }

    const totalEarned = earns.docs.reduce((s, d) => s + (d.data().cents || 0), 0);
    const totalReversed = reverses.docs.reduce((s, d) => s + (d.data().cents || 0), 0);
    const netActive = totalEarned - totalReversed;
    const wantApproved = status === 'approved' && cashbackCents > 0;

    // ── Doppel-Prüfung: Lesen (alles vor dem ersten Schreiben) ──
    // Geprüft wird nur vor einer ERSTEN Gutschrift. Ein gesperrtes Konto bucht
    // dort ohnehin nichts — die Sperre bleibt der einzige Grund am Bon.
    // Bei einem schon bezahlten Bon (erneute Zustellung) werden nur seine
    // Schlüssel und sein Index-Eintrag ergänzt — dafür dieselben Lesevorgänge.
    const ersteBuchung = wantApproved && netActive === 0;
    const pruefen = Boolean(neu && ersteBuchung && !gesperrt);
    const ergaenzen = Boolean(neu && wantApproved && netActive > 0);
    // Gilt ein fremder Schlüssel / Index-Eintrag noch? Das Ledger des Besitzers
    // entscheidet (Earn − Storno > 0) — nicht der Tageszähler, der mit einer
    // neuen Datumslesung wandert. Nur für Treffer gelesen, also selten.
    const lebendigMerk = new Map();
    const lebtLautLedger = async (besitzerUid, receiptId) => {
      const k = `${besitzerUid}/${receiptId}`;
      if (lebendigMerk.has(k)) return lebendigMerk.get(k);
      let netto = 0;
      if (besitzerUid === userRef.id && receiptId === cashbackId) {
        netto = netActive;
      } else {
        const snap = await tx.get(
          db.collection(`users/${besitzerUid}/cashback_ledger`).where('receiptId', '==', receiptId),
        );
        for (const d of snap.docs) {
          const x = d.data();
          if (x.type === 'earn') netto += x.cents || 0;
          else if (x.type === 'reverse') netto -= x.cents || 0;
        }
      }
      lebendigMerk.set(k, netto > 0);
      return netto > 0;
    };
    const schluesselStand = [];
    const andere = [];
    const kontenArtikelStand = [];
    const kontenDatumStand = [];
    // Tages-Index (Regel kontenArtikel): nur, solange die Regel läuft ('shadow'
    // oder true) — dann gelesen (Kandidaten, Größenbremse) und ergänzt. Ist sie
    // aus, wird er weder gelesen noch geschrieben (Prüfrunde 3: vorher schrieb
    // jede Gutschrift blind und ohne wirksame Bremse hinein, und ein zu großes
    // Dokument hätte jede weitere Buchung dieses Markt-Tages scheitern lassen).
    let tagesIndexStand = null;
    if ((pruefen || ergaenzen) && modi.kontenArtikel && neu.tagesIndex) {
      const ref = db.collection(DOPPEL_TAGE).doc(neu.tagesIndex);
      const eintraege = eintraegeVon(await tx.get(ref));
      tagesIndexStand = { ref, eintraege, anzahl: Object.keys(eintraege).length };
    }
    // Summen-Index: bei jeder (möglichen) Gutschrift gelesen — für die Regel,
    // die Größenbremse und das Aufräumen alter Einträge. Ein Dokument je Markt
    // und Summe, Konflikte also nur bei exakt gleicher Summe im selben Markt.
    let summenStand = null;
    if ((pruefen || ergaenzen) && neu.summenIndex) {
      const ref = db.collection(DOPPEL_SUMMEN).doc(neu.summenIndex);
      const snap = await tx.get(ref);
      summenStand = { ref, eintraege: eintraegeVon(snap) };
    }
    if (pruefen || ergaenzen) {
      for (const [id, regel] of [[neu.kontenId, 'konten'], [neu.bestellHash, 'bestellung']]) {
        if (!id) continue;
        const ref = db.collection(DOPPEL_SCHLUESSEL).doc(id);
        const snap = await tx.get(ref);
        const daten = snap.exists ? snap.data() : null;
        // Gehört der Schlüssel noch einem BEZAHLTEN Bon? Ein stornierter oder
        // nie gebuchter Bon (Storno durch einen Stand vor diesem Umbau,
        // Test-Reset) sperrt nichts mehr. Unvollständige Schlüssel gelten
        // vorsichtshalber als belegt.
        let lebendig = false;
        if (daten && daten.receiptId && daten.receiptId !== cashbackId) {
          lebendig = typeof daten.uid === 'string' && daten.uid
            ? await lebtLautLedger(daten.uid, daten.receiptId)
            : true;
        }
        schluesselStand.push({ id, regel, ref, daten, lebendig });
      }
    }
    if (pruefen) {
      // Bezahlte Bons derselben Person: derselbe Tag (summe/artikel) und — bei
      // Regel datum — die Tage im Fenster. Bestand ohne Eintrag (gebucht vor
      // diesem Umbau): die Identität aus dem Bon-Dokument, höchstens 10 Bons.
      // `tag` nur bei ANDEREN Tagen (Regel datum); derselbe Tag ohne.
      let bonLesungen = 0;
      let waisenPruefungen = 0;
      const ausTag = async (snap, andererTag) => {
        const eintr = eintraegeVon(snap);
        const ids = Array.isArray(snap.data()?.receiptIds) ? snap.data().receiptIds : [];
        const tagFeld = andererTag ? { tag: andererTag } : {};
        for (const id of ids) {
          if (id === cashbackId) continue;
          if (eintr[id]) {
            andere.push({ id, eintrag: eintr[id], ...tagFeld });
          } else if (bonLesungen < 10) {
            bonLesungen++;
            const bonSnap = await tx.get(db.doc(`receipts/${id}`));
            if (bonSnap.exists) andere.push({ id, eintrag: identitaetAusBon(bonSnap.data()), ...tagFeld });
          }
        }
        // Einträge ohne Platz im Tageszähler: ein bezahlter Bon, den eine neue
        // Datumslesung in einen anderen Tag gehängt hat (Prüfrunde 2: sonst
        // war derselbe Bon unter der alten Lesung wieder frei), oder ein Rest
        // von .backfill-cashback-days.js. Ob er noch zählt, sagt das Ledger —
        // je Prüfung höchstens 5 solcher Abfragen.
        for (const [id, e] of Object.entries(eintr)) {
          if (id === cashbackId || ids.includes(id) || !e || waisenPruefungen >= 5) continue;
          waisenPruefungen++;
          if (await lebtLautLedger(userRef.id, id)) andere.push({ id, eintrag: e, ...tagFeld });
        }
      };
      if (modi.summe || modi.artikel || modi.seite) await ausTag(daySnap, null);
      // Nur mit gelesenem Bon-Datum: ohne es wäre bonDay „heute" und jeder Tag
      // im Fenster ein Zufall. Ohne Uhrzeit nur, wenn Summe und genug Artikel
      // da sind — sonst kann die Regel nicht treffen (lib/doppelBon.js).
      const datumKannTreffen = Boolean(neu.uhrzeit) || (Boolean(neu.summe) && neu.artikel.length >= modi.minArtikel);
      if (modi.datum && datumKannTreffen && neu.markt && neu.tag === bonDay) {
        for (const tag of tageImFenster(bonDay)) {
          if (!daySnaps.has(tag)) daySnaps.set(tag, await tx.get(userRef.collection('cashback_days').doc(tag)));
          const snap = daySnaps.get(tag);
          if (snap.exists) await ausTag(snap, tag);
        }
      }
      // Tages-Index (Regel kontenArtikel): gelesen ist er oben schon, wenn die
      // Regel läuft. Nur die besten Treffer auf „noch bezahlt" prüfen (je eine
      // Ledger-Abfrage).
      if (tagesIndexStand) {
        const kandidaten = kontenArtikelKandidaten({ bonId: cashbackId, uid: userRef.id, neu, eintraege: tagesIndexStand.eintraege, modi }).slice(0, 5);
        for (const k of kandidaten) kontenArtikelStand.push({ ...k, lebendig: await lebtLautLedger(k.uid, k.id) });
      }
      // Summen-Index: Regel kontenDatum (andere Konten) und — Prüfrunde 3 —
      // Regel datum über das Fenster des Tageszählers hinaus (dieselbe Person,
      // bis SUMMEN_AUFBEWAHRUNG_TAGE; echter Fall 02.10.: Datum als 22. statt
      // 02. gelesen, 20 Tage). Gelesen ist er oben schon (Größe, Aufräumen).
      if ((modi.datum || modi.kontenDatum) && summenStand) {
        const kandidaten = kontenDatumKandidaten({
          bonId: cashbackId,
          uid: userRef.id,
          neu,
          eintraege: summenStand.eintraege,
          modi,
          gleichePerson: Boolean(modi.datum),
          fremde: Boolean(modi.kontenDatum),
        }).slice(0, 5);
        for (const k of kandidaten) kontenDatumStand.push({ ...k, lebendig: await lebtLautLedger(k.uid, k.id) });
      }
      doppelGeprueft = true;
      const urteil = doppelUrteil({
        bonId: cashbackId,
        uid: userRef.id,
        neu,
        andere,
        schluessel: schluesselStand.map((x) => ({
          id: x.id,
          regel: x.regel,
          besitzer: x.daten && x.daten.receiptId ? { receiptId: x.daten.receiptId, uid: x.daten.uid ?? null } : null,
          lebendig: x.lebendig,
        })),
        kontenArtikel: kontenArtikelStand,
        kontenDatum: kontenDatumStand,
        modi,
      });
      doppelTreffer = urteil.treffer;
      doppel = urteil.wirksam || urteil.treffer[0] || null;
    }
    // Was die Gutschrift dieses Bons schon belegt hat (alle Earns zusammen).
    const bisherSchluessel = [...new Set(earns.docs.flatMap((d) => (Array.isArray(d.data().schluessel) ? d.data().schluessel : [])))]
      .filter((id) => typeof id === 'string' && id);
    const bisherTagesIndex = [...new Set(earns.docs.flatMap((d) => (Array.isArray(d.data().tagesIndex) ? d.data().tagesIndex : [])))]
      .filter((id) => typeof id === 'string' && id);
    const bisherSummenIndex = [...new Set(earns.docs.flatMap((d) => (Array.isArray(d.data().summenIndex) ? d.data().summenIndex : [])))]
      .filter((id) => typeof id === 'string' && id);
    // Storno: die Schlüssel, die dieser Bon belegt hat.
    const stornoSchluessel = [];
    if (!wantApproved && netActive > 0) {
      for (const id of bisherSchluessel.slice(0, 10)) {
        const ref = db.collection(DOPPEL_SCHLUESSEL).doc(id);
        stornoSchluessel.push({ ref, snap: await tx.get(ref) });
      }
    }

    const u = userSnap.exists ? userSnap.data() : {};
    const balance = u.cashback_balance_cents || 0;
    const lifetime = u.cashback_lifetime_cents || 0;
    // Kalendermonat des Bons → Monats-Zähler (für Monats-Limit + Anzeige).
    const monthKey = (bonDateIso || todayBerlin()).slice(0, 7); // YYYY-MM
    const inc = admin.firestore.FieldValue.increment;
    const monthlyDelta = (cents, bons) => ({
      cashback_monthly: {
        [monthKey]: {
          earnedCents: inc(cents),
          bonsCount: inc(bons),
          lastBonAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
    });
    // Pro-Aktion-Zähler: Wochen-Bons (Mo–So Berlin) + Gesamt-Cents.
    // Treiben das Wochenlimit + den Per-User-Cap der Aktion.
    const weekKey = isoWeekKey(bonDateIso || todayBerlin());
    const campaignDelta = (cid, cents, bons) =>
      cid
        ? {
            cashback_campaign_weekly: { [cid]: { [weekKey]: { count: inc(bons) } } },
            cashback_campaign_totals: { [cid]: inc(cents) },
          }
        : {};
    // Aktions-Budget transaktional anpassen (merge+increment → race-frei,
    // sicher auch wenn Feld fehlt). Negativ = verbraucht, positiv = Refund.
    const adjustBudget = (cid, cents) => {
      if (!cid || !cents) return;
      tx.set(
        db.collection(CAMPAIGNS_COL).doc(cid),
        { budgetRemainingCents: inc(cents) },
        { merge: true },
      );
    };
    // Doppel-Schlüssel dieses Bons (Schreibphase): eigene behalten (Tag der
    // aktuellen Lesung nachziehen), freie oder verwaiste übernehmen, einen
    // noch bezahlten fremden nie anfassen. Gibt die IDs zurück, die ihm gehören.
    const schluesselBelegen = () => {
      const eigene = [];
      for (const x of schluesselStand) {
        if (x.daten && x.daten.receiptId === cashbackId) {
          if (x.daten.tag !== bonDay) tx.set(x.ref, { tag: bonDay }, { merge: true });
          eigene.push(x.id);
        } else if (!x.daten || !x.daten.receiptId || !x.lebendig) {
          tx.set(x.ref, {
            receiptId: cashbackId,
            uid: userRef.id,
            regel: x.regel,
            tag: bonDay,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          eigene.push(x.id);
        }
      }
      return eigene;
    };
    // Eintrag im Tages-Index (Regel kontenArtikel): nur, wenn er oben gelesen
    // wurde (Regel läuft) — so greift die Größenbremse immer. Mit weniger als
    // 3 verschiedenen Artikeln kann er nie treffen — dann keiner.
    const tagesIndexEintragen = () => {
      if (!neu || !neu.tagesIndex || !tagesIndexStand) return [];
      const eintrag = tagesEintragAus(userRef.id, neu);
      if (eintrag.a.length < 3) return [];
      if (tagesIndexStand.anzahl >= MAX_TAGES_EINTRAEGE && !tagesIndexStand.eintraege[cashbackId]) {
        logger.warn('doppel-tagesindex-voll', { cashbackId, index: neu.tagesIndex, anzahl: tagesIndexStand.anzahl });
        return [];
      }
      tx.set(
        db.collection(DOPPEL_TAGE).doc(neu.tagesIndex),
        { eintraege: { [cashbackId]: eintrag }, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
      return [neu.tagesIndex];
    };
    // Eintrag im Summen-Index (Regel kontenDatum), dabei veraltete Einträge
    // (Tag älter als SUMMEN_AUFBEWAHRUNG_TAGE) entfernen. Voll → nicht
    // eintragen, nur melden.
    const summenIndexEintragen = () => {
      if (!neu || !summenStand || !neu.tag) return [];
      const alt = veralteteSummenEintraege(summenStand.eintraege, todayBerlin());
      const anzahl = Object.keys(summenStand.eintraege).length - alt.length;
      if (anzahl >= MAX_SUMMEN_EINTRAEGE && !summenStand.eintraege[cashbackId]) {
        logger.warn('doppel-summenindex-voll', { cashbackId, index: neu.summenIndex, anzahl });
        return [];
      }
      const entfernen = Object.fromEntries(alt.filter((id) => id !== cashbackId).map((id) => [id, admin.firestore.FieldValue.delete()]));
      tx.set(
        summenStand.ref,
        { eintraege: { ...entfernen, [cashbackId]: summenEintragAus(userRef.id, neu) }, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true },
      );
      return [neu.summenIndex];
    };

    if (wantApproved && netActive === 0) {
      // First-time approval (or reapproval after a reverse).
      // Aktions-Modus: Betrag ATOMAR auf das verbleibende Budget cappen —
      // das schließt die Race-Lücke (2 Bons am letzten Budget-Rest).
      let earnCents = cashbackCents;
      if (gesperrt) {
        // Gesperrtes Konto: nichts buchen. Alle Prüfungen unten hängen an
        // `earnCents > 0` und entfallen damit; budgetExhausted bleibt false,
        // weil capReason gesetzt ist — der Grund am Bon ist die Sperre.
        earnCents = 0;
        capReason = GRUND_KONTO_GESPERRT;
      }
      if (earnCents > 0 && doppel && doppel.modus === 'wirksam') {
        // Derselbe Bon ist schon bezahlt (lib/doppelBon.js). Vor den Deckeln:
        // ein Doppel soll nicht als „Tageslimit" am Bon stehen.
        earnCents = 0;
        capReason = doppelGrund(doppel);
      }
      if (caps) {
        if (earnCents > 0 && campaignMode && campaignId && caps.weeklyBonCap > 0) {
          const used = (((u.cashback_campaign_weekly || {})[campaignId] || {})[weekKey] || {}).count || 0;
          if (used >= caps.weeklyBonCap) {
            earnCents = 0;
            capReason = 'weekly_cap_reached';
          }
        }
        if (earnCents > 0 && campaignMode && campaignId && caps.maxPerUserCents > 0) {
          const earnedSoFar = (u.cashback_campaign_totals || {})[campaignId] || 0;
          const headroom = Math.max(0, caps.maxPerUserCents - earnedSoFar);
          if (earnCents > headroom) {
            earnCents = headroom;
            if (earnCents === 0) capReason = 'per_user_cap_reached';
          }
        }
        if (earnCents > 0 && !campaignMode && caps.monthlyMaxCents > 0) {
          const earnedThisMonth = ((u.cashback_monthly || {})[monthKey] || {}).earnedCents || 0;
          const headroom = Math.max(0, caps.monthlyMaxCents - earnedThisMonth);
          if (earnCents > headroom) {
            earnCents = headroom;
            if (earnCents === 0) capReason = 'monthly_cap_reached';
          }
        }
        // Tageslimit = max. `dailyCap` vergütete Bons pro Bon-Datum (echter
        // Zähler, eigener Bon ausgeschlossen). Übergangs-Fallback bei
        // dailyCap === 1: das alte Vorwärts-Feld zählt weiter mit, damit ein
        // Earn aus dem Fenster zwischen Backfill und Deploy nicht durchrutscht
        // (bei dailyCap > 1 würde der Fallback fälschlich blocken → nur bei 1).
        if (earnCents > 0 && caps.dailyCap > 0) {
          // Sunset: caps.legacyFallback (= config.dailyCapLegacyFallback, Default
          // true) wird nach Backfill 2 + VERIFY auf false gesetzt — ohne Deploy.
          const legacyHit =
            caps.legacyFallback !== false
            && caps.dailyCap === 1
            && u.cashback_last_bon_date === bonDay
            && u.cashback_last_bon_receiptId !== cashbackId;
          if (dayOthers.length >= caps.dailyCap || legacyHit) {
            earnCents = 0;
            capReason = 'daily_cap_reached';
          }
        }
      }
      if (earnCents > 0 && campaignMode && campaignSnap) {
        const remaining = Number.isFinite(campaignSnap.data()?.budgetRemainingCents)
          ? campaignSnap.data().budgetRemainingCents
          : 0;
        earnCents = Math.max(0, Math.min(earnCents, remaining));
      }
      creditedCents = earnCents;
      budgetExhausted = campaignMode && earnCents === 0 && cashbackCents > 0 && !capReason;

      if (earnCents > 0) {
        frischGebucht = true;
        // Doppel-Schlüssel und Tages-Index belegen — unabhängig vom Schalter,
        // damit sie beim Scharfschalten schon da sind. Nie einen Schlüssel
        // überschreiben, der einem anderen, noch bezahlten Bon gehört („der
        // erste gewinnt").
        const eigeneSchluessel = neu ? schluesselBelegen() : [];
        const eigeneTagesIndex = neu ? tagesIndexEintragen() : [];
        const eigeneSummenIndex = neu ? summenIndexEintragen() : [];
        const ref = ledgerCol.doc();
        tx.set(ref, {
          type: 'earn',
          cents: earnCents,
          receiptId: cashbackId,
          campaignId: campaignId || null, // für Budget-Refund beim Reverse
          bonDate: bonDay, // Tag des Tageszählers (für den Reverse)
          balanceAfterCents: balance + earnCents,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          ...(neu ? { schluessel: eigeneSchluessel, tagesIndex: eigeneTagesIndex, summenIndex: eigeneSummenIndex } : {}),
        });
        tx.set(
          dayRef,
          {
            bonDate: bonDay,
            receiptIds: [...dayOthers, cashbackId],
            // Was die Doppel-Prüfung künftiger Bons dieses Tages vergleicht.
            ...(neu ? { eintraege: { [cashbackId]: eintragAus(neu) } } : {}),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        tx.set(
          userRef,
          {
            cashback_balance_cents: balance + earnCents,
            cashback_lifetime_cents: lifetime + earnCents,
            // Nur VORWÄRTS bewegen (ein nachverarbeiteter älterer Bon darf das
            // Tageslimit eines späteren Tages nicht aufweichen) + merken, WELCHER
            // Bon das Datum gesetzt hat (Selbst-Ausschluss beim Tageslimit).
            ...(() => {
              const bonDayIso = bonDateIso || todayBerlin();
              const prevDay = u.cashback_last_bon_date || '';
              return prevDay > bonDayIso
                ? {}
                : { cashback_last_bon_date: bonDayIso, cashback_last_bon_receiptId: cashbackId };
            })(),
            ...monthlyDelta(earnCents, 1),
            ...campaignDelta(campaignId, earnCents, 1),
          },
          { merge: true },
        );
        adjustBudget(campaignId, -earnCents);
      }
      // earnCents === 0 → keine Gutschrift; Status wird außen auf
      // no_reward / campaign_budget_exhausted gesetzt.
    } else if (wantApproved && netActive > 0) {
      // Already credited (PubSub redelivery). Noop unless cents changed.
      // Tageszähler: liest eine NEUE OCR-Lesung ein anderes Bon-Datum als der
      // Earn kannte (Reprocessing), hängt der Bon in den neuen Tag um — der Tag,
      // den Receipt/Mirror zeigen, ist die Wahrheit; alle alten Tage werden geräumt.
      const earnDays = new Set(earns.docs.map((d) => d.data().bonDate).filter((v) => typeof v === 'string' && v));
      if (!earnDays.has(bonDay)) {
        for (const [day, snap] of daySnaps) {
          if (day === bonDay) continue;
          const ids = Array.isArray(snap.data()?.receiptIds) ? snap.data().receiptIds : [];
          if (!ids.includes(cashbackId)) continue;
          tx.set(
            userRef.collection('cashback_days').doc(day),
            {
              bonDate: day,
              // Nur das Tageslimit räumt den alten Tag. Der Doppel-Eintrag
              // bleibt stehen (Prüfrunde 2): sonst wäre ein zweites Foto mit
              // der ALTEN Lesung frei. Er zählt, solange das Ledger den Bon
              // als bezahlt führt (ausTag oben).
              receiptIds: ids.filter((id) => id !== cashbackId),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          );
        }
        tx.set(
          dayRef,
          {
            bonDate: bonDay,
            receiptIds: [...dayOthers, cashbackId],
            ...(neu ? { eintraege: { [cashbackId]: eintragAus(neu) } } : {}),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        earns.docs.forEach((d) => tx.set(d.ref, { bonDate: bonDay }, { merge: true }));
      } else if (neu && dayIds.includes(cashbackId) && !eintraegeVon(daySnap)[cashbackId]) {
        // Bestand (gebucht vor dem Doppel-Schutz): den Eintrag nachtragen,
        // damit spätere Bons dieses Tages gegen ihn verglichen werden.
        tx.set(dayRef, { eintraege: { [cashbackId]: eintragAus(neu) } }, { merge: true });
      }
      if (ergaenzen) {
        // Schlüssel und Index-Eintrag der AKTUELLEN Lesung ergänzen (Bestand
        // ohne Schlüssel, neue Datums- oder Summenlesung). Die bisherigen
        // bleiben: der Bon sperrt unter jeder Lesung, bis er storniert wird —
        // sonst wäre derselbe Bon unter der alten Lesung wieder frei.
        const schluessel = schluesselBelegen();
        const index = neu.tagesIndex && !bisherTagesIndex.includes(neu.tagesIndex) ? tagesIndexEintragen() : [];
        const summen = neu.summenIndex && !bisherSummenIndex.includes(neu.summenIndex) ? summenIndexEintragen() : [];
        const alleS = [...new Set([...bisherSchluessel, ...schluessel])];
        const alleI = [...new Set([...bisherTagesIndex, ...index])];
        const alleSu = [...new Set([...bisherSummenIndex, ...summen])];
        if (alleS.length !== bisherSchluessel.length || alleI.length !== bisherTagesIndex.length || alleSu.length !== bisherSummenIndex.length) {
          tx.set(earns.docs[0].ref, { schluessel: alleS, tagesIndex: alleI, summenIndex: alleSu }, { merge: true });
        }
      }
      if (gesperrt && cashbackCents > netActive) {
        // Eine Aufwärts-Korrektur wäre eine NEUE Gutschrift — bei gesperrtem
        // Konto unterbleibt sie. Der bestehende Betrag bleibt (keine Storno-
        // Wirkung der Sperre); dem Aufrufer wird der tatsächlich aktive Betrag
        // gemeldet, damit Bon und Spiegel dasselbe zeigen wie das Ledger.
        creditedCents = netActive;
        capReason = GRUND_KONTO_GESPERRT;
      } else if (netActive !== cashbackCents) {
        const delta = cashbackCents - netActive;
        // Adjust to match current cents — write a delta entry.
        const ref = ledgerCol.doc();
        tx.set(ref, {
          type: delta > 0 ? 'earn' : 'reverse',
          cents: Math.abs(delta),
          receiptId: cashbackId,
          balanceAfterCents: balance + delta,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          reason: 'amount_correction',
        });
        tx.set(
          userRef,
          {
            cashback_balance_cents: balance + delta,
            cashback_lifetime_cents: lifetime + Math.max(0, delta),
            ...monthlyDelta(delta, 0),
            ...campaignDelta(earns.docs[0]?.data()?.campaignId || campaignId, delta, 0),
          },
          { merge: true },
        );
        adjustBudget(earns.docs[0]?.data()?.campaignId || campaignId, -delta);
      }
    } else if (!wantApproved && netActive > 0) {
      // Was approved, now isn't (reprocess flipped to rejected/review).
      // Reverse the active credit.
      const ref = ledgerCol.doc();
      tx.set(ref, {
        type: 'reverse',
        cents: netActive,
        receiptId: cashbackId,
        balanceAfterCents: Math.max(0, balance - netActive),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        reason: 'reprocess_to_' + status,
      });
      const reverseCid = earns.docs[0]?.data()?.campaignId || campaignId;
      tx.set(
        userRef,
        {
          cashback_balance_cents: Math.max(0, balance - netActive),
          cashback_lifetime_cents: Math.max(0, lifetime - netActive),
          ...monthlyDelta(-netActive, -1),
          ...campaignDelta(reverseCid, -netActive, -1),
          // Übergangs-Fallback neutral halten: zeigt das Vorwärts-Feld auf
          // genau diesen (jetzt stornierten) Bon, darf es den Tag nicht sperren.
          ...(u.cashback_last_bon_receiptId === cashbackId
            ? { cashback_last_bon_date: admin.firestore.FieldValue.delete(), cashback_last_bon_receiptId: admin.firestore.FieldValue.delete() }
            : {}),
        },
        { merge: true },
      );
      // Budget zurück an die Kampagne, die ursprünglich gutgeschrieben hat.
      adjustBudget(reverseCid, netActive);
      // Tageszähler: dieser Bon zählt an keinem Kandidaten-Tag mehr — und sein
      // Doppel-Eintrag verschwindet mit (ein stornierter Bon sperrt nichts).
      for (const [day, snap] of daySnaps) {
        const ids = Array.isArray(snap.data()?.receiptIds) ? snap.data().receiptIds : [];
        if (!ids.includes(cashbackId) && !eintraegeVon(snap)[cashbackId]) continue;
        tx.set(
          userRef.collection('cashback_days').doc(day),
          {
            bonDate: day,
            receiptIds: ids.filter((id) => id !== cashbackId),
            eintraege: { [cashbackId]: admin.firestore.FieldValue.delete() },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      // Doppel-Schlüssel und Index-Einträge freigeben, die dieser Bon belegt hatte.
      for (const { ref, snap } of stornoSchluessel) {
        if (snap.exists && snap.data().receiptId === cashbackId) tx.delete(ref);
      }
      for (const id of bisherTagesIndex.slice(0, 10)) {
        tx.set(
          db.collection(DOPPEL_TAGE).doc(id),
          { eintraege: { [cashbackId]: admin.firestore.FieldValue.delete() } },
          { merge: true },
        );
      }
      for (const id of bisherSummenIndex.slice(0, 10)) {
        tx.set(
          db.collection(DOPPEL_SUMMEN).doc(id),
          { eintraege: { [cashbackId]: admin.firestore.FieldValue.delete() } },
          { merge: true },
        );
      }
    }
    // else: not approved + no prior earn — noop.
  });

  return { creditedCents, budgetExhausted, capReason, frischGebucht, doppel, doppelTreffer, doppelGeprueft };
}

async function verifyAuthFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(m[1]);
    return decoded;
  } catch (e) {
    logger.warn('verifyIdToken-failed', { err: e.message });
    return null;
  }
}

// ─── enqueueCashback (HTTPS) ────────────────────────────────────────

exports.enqueueCashback = onRequest(
  // 512MiB + 60s: forensics step downloads the bon image, runs sharp
  // (native) for dHash, parses EXIF, scans last 50 receipts for
  // near-duplicates. ~500-800ms typical, headroom for cold-start.
  { region: REGION, timeoutSeconds: 60, memory: '512MiB', cors: true, invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ code: 'method_not_allowed' });
      return;
    }

    const decoded = await verifyAuthFromRequest(req);
    if (!decoded?.uid) {
      res.status(401).json({ code: 'unauthenticated' });
      return;
    }
    const uid = decoded.uid;

    const body = req.body || {};
    const {
      storagePath,
      bytesHash,
      capturedAt,
      perceptualHash,
      source,
      journey,
      campaignId, // optional: vom User gewählte Aktion (cashback_campaigns/{id})
      clientUploadId, // optional: client's pre-allocated id for the receipt doc
    } = body;
    if (!storagePath || !bytesHash) {
      res.status(400).json({ code: 'invalid_image', message: 'storagePath + bytesHash required' });
      return;
    }
    // Defense-in-depth: storagePath must live under cashback-uploads/{uid}/.
    if (!storagePath.startsWith(`cashback-uploads/${uid}/`)) {
      res.status(403).json({ code: 'invalid_image', message: 'storagePath outside user prefix' });
      return;
    }

    const config = await loadConfig();

    // Consent gate
    const userSnap = await db.doc(`users/${uid}`).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    const consent = userData.cashback_consent || {};
    if (!consent.accepted || consent.version !== config.consentVersion) {
      res.status(403).json({ code: 'consent_missing' });
      return;
    }

    // Wiederholter Aufruf mit derselben clientUploadId (die Antwort ging bei
    // schwachem Empfang verloren, die App wiederholt): die bestehende
    // Einreichung unverändert zurückgeben, BEVOR eine Dedup-Schicht läuft
    // (Prüfrunde 2, 04.10.2026). Seit dem Neuversuch gibt es zwei Bons derselben
    // Person mit derselben Datei; die Byte-Prüfung fand dann das ältere,
    // abgelehnte Original und setzte den Spiegel des schon BEZAHLTEN
    // Neuversuchs auf superseded — der Bon verschwand aus „Meine Bons".
    // Gehört die ID einer anderen Person oder scheitert das Lesen, bleibt es
    // beim bisherigen Weg (eine Störung ist kein Urteil).
    if (typeof clientUploadId === 'string' && clientUploadId && !clientUploadId.includes('/')) {
      try {
        const eigen = await db.collection('receipts').doc(clientUploadId).get();
        if (eigen.exists && eigen.get('userId') === uid) {
          logger.info('enqueue-wiederholung', { uid, cashbackId: eigen.id, status: eigen.get('status') || null });
          res.status(200).json({ cashbackId: eigen.id, status: eigen.get('status') });
          return;
        }
      } catch (e) {
        logger.warn('enqueue-wiederholung-lesen-fehlgeschlagen', { uid, err: e.message });
      }
    }

    // KEIN Daily-Cap-Block mehr beim Upload (ClickUp 86ca8hr90): der Bon soll
    // IMMER eingereicht + getrackt werden (OCR, Positionen, Journey, Ausgaben-
    // übersicht), auch wenn das Tageslimit schon erreicht ist. Das Tageslimit
    // gated nur noch die CASHBACK-Gutschrift — processCashback setzt dann
    // 'no_reward' (Bon-Datum-Semantik gegen cashback_last_bon_date), statt den
    // Upload zu verwerfen.

    // Bildprüfung mit Feinvergleich (Entscheidung Patrick 04.10.2026, siehe
    // Layer 2): Modus einmal bestimmen, er gilt für beide Schichten.
    const fein = bildFeinModus(config);
    const feinModus = fein.modus;
    if (fein.fehlt.length) logger.warn('bildfeinvergleich-wartet-auf-doppelregeln', { uid, fehlt: fein.fehlt });

    // ─── Layer 1: exact-byte duplicate (sha256) ──────────────────────
    // Cheapest check first: caught the trivial "user retry-tapped" case
    // without any image processing.
    const dedupQuery = await db
      .collection('receipts')
      .where('userId', '==', uid)
      .where('capture.hash', '==', bytesHash)
      .limit(1)
      .get();
    // Neuversuch derselben Datei nach einem Lesefehler (nur mit scharfem
    // Feinvergleich): höchstens einmal je Original, vermerkt am neuen Bon. Ein
    // Fehler bei dieser Abfrage ist kein Urteil — dann bleibt es bei der Sperre
    // wie bisher (gegen Doppelzahlung schützt ohnehin die Buchung).
    let neuversuchVon = null;
    // Gibt es den Neuversuch schon, verweist die Sperre auf IHN (den Bon, der
    // zählt), nicht auf das abgelehnte Original (Prüfrunde 2).
    let juengsterVersuch = null;
    if (!dedupQuery.empty && feinModus === true) {
      const existing = dedupQuery.docs[0];
      if (existing.get('status') === 'rejected' && BYTE_NEUVERSUCH_GRUENDE.has(existing.get('rejectReason'))) {
        try {
          const schon = await db
            .collection('receipts')
            .where('userId', '==', uid)
            .where('capture.neuversuchVon', '==', existing.id)
            .limit(1)
            .get();
          if (schon.empty) neuversuchVon = existing.id;
          else juengsterVersuch = schon.docs[0];
        } catch (e) {
          logger.warn('bon-neuversuch-abfrage-fehlgeschlagen', { uid, err: e.message });
        }
      }
      if (neuversuchVon) {
        logger.info('bon-neuversuch-gleiche-datei', { uid, original: existing.id, grund: existing.get('rejectReason') });
      }
    }
    if (!dedupQuery.empty && !neuversuchVon) {
      const existing = juengsterVersuch || dedupQuery.docs[0];
      // If the client wrote a placeholder mirror doc with a different
      // id, mark it as superseded so it disappears from the user's
      // history (the canonical existing receipt is the source of truth).
      if (clientUploadId && clientUploadId !== existing.id) {
        await db
          .doc(`users/${uid}/cashback_status/${clientUploadId}`)
          .set(
            {
              status: 'superseded',
              supersededBy: existing.id,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
          .catch(() => {});
      }
      res.status(200).json({
        cashbackId: existing.id,
        status: existing.get('status'),
        duplicate: true,
        duplicateMode: 'exact',
      });
      return;
    }

    // ─── Layer 2: server-side image forensics (dHash + EXIF) ─────────
    // This is the meaningful anti-fraud step — catches:
    //   - same bon re-encoded at different JPEG quality (sha256 misses)
    //   - same bon cropped slightly differently (sha256 misses)
    //   - bons photographed weeks ago (EXIF age cross-check)
    //   - bons edited in Photoshop/GIMP (EXIF software flag)
    //
    // Costs ~500-800ms (storage download + sharp resize + Firestore
    // dedup lookup of last 50 receipts). Done BEFORE PubSub publish
    // so we don't waste OCR cents on known-bad uploads.
    let serverDhash = null;
    let exifMeta = null;
    let forensicFlags = null;
    let serverBytesSize = 0;
    // Nicht bestätigter dHash-Treffer (Feinvergleich) — landet am Bon.
    let bildAehnlich = null;
    try {
      const bucket = admin.storage().bucket();
      const file = bucket.file(storagePath);
      const [bytes] = await file.download();
      serverBytesSize = bytes.length;

      // Compute server-trusted hash + read EXIF in parallel
      const [dHash, exif] = await Promise.all([
        computeDHash(bytes),
        readExifMeta(bytes),
      ]);
      serverDhash = dHash;
      exifMeta = exif;
      forensicFlags = deriveForensicFlags(exif, Date.now(), MAX_BON_AGE_DAYS_EXIF_CEILING);

      // Hard reject am enqueue NUR für absurd alte Foto-Uploads (>Ceiling) oder
      // Zukunfts-Datierung. Das präzise Kauf-Alters-Limit (global 7 / Aktion)
      // erzwingt der bonDate-Gate in processCashback — hier NICHT vorgreifen,
      // sonst werden langlaufende Aktionen vor der Campaign-Auflösung geblockt.
      if (forensicFlags.exifAgeRejectable) {
        logger.warn('forensics-reject-exif-age', {
          uid,
          exifAgeDays: forensicFlags.exifAgeDays,
          maxBonAgeDays: MAX_BON_AGE_DAYS_EXIF_CEILING,
        });
        res.status(422).json({
          code: 'bon_too_old',
          message: forensicFlags.exifAgeDays > 0
            ? `Bon ist ${Math.round(forensicFlags.exifAgeDays)} Tage alt — max. ${MAX_BON_AGE_DAYS} Tage erlaubt.`
            : 'Bon-Aufnahmezeit liegt in der Zukunft — bitte Geräte-Uhr prüfen.',
          exifAgeDays: forensicFlags.exifAgeDays,
        });
        return;
      }

      // Near-duplicate scan: dHash equality first (Firestore exact match,
      // catches the bit-identical pHash case after JPEG re-encoding).
      // Then Hamming-distance scan over the user's recent receipts to
      // catch crop/resave attacks where bits flip a little.
      //
      // Feinvergleich (Entscheidung Patrick 04.10.2026, lib/bildVergleich.js):
      // Der grobe dHash sperrte in 30 Tagen 200 Uploads, nur 8 der 118 Bilder
      // dahinter waren dasselbe Bild — App-Bons, Screenshots und A4-Rechnungen
      // sehen für 64 Bit alle gleich aus, auch Abstand 0 irrt. Mit
      // `bildFeinvergleich === true` sperrt ein Treffer nur noch, wenn ein
      // Feinvergleich DASSELBE Bild bestätigt, und nie gegen einen abgelehnten
      // oder unvergüteten Bon (dort ist ein Neuversuch erlaubt, wie bei der
      // Inhaltsprüfung, LIVE_STATUSES). Alles andere wird gelesen; gegen eine
      // Doppelzahlung schützt die Buchung (lib/doppelBon.js). Darum wirkt der
      // Schalter erst, wenn doppelSumme, doppelArtikel UND doppelDatum true
      // sind (bildFeinModus) — sonst wie 'shadow'. Der Feinvergleich erkennt
      // Neuspeichern, Helligkeit und Kontrast, aber keinen Beschnitt (2 % unten
      // weg: SSIM ~0,5); solche Kopien fängt erst die Buchung — gleicher Tag
      // über Summe/Artikel, geändertes Datum über die Uhrzeit oder —
      // auch mit geänderter/verdeckter Uhrzeit — über Summe UND Artikel (Regel
      // datum, Prüfrunde 2).
      // 'shadow' = Verhalten wie bisher, der Feinvergleich wird nur
      // protokolliert ('forensics-feinvergleich').
      const exactDhashQuery = await db
        .collection('receipts')
        .where('userId', '==', uid)
        .where('capture.perceptualHashServer', '==', serverDhash)
        .limit(feinModus ? 5 : 1)
        .get();

      // Alle Treffer ≤ Schwelle sammeln (für den Feinvergleich nächste zuerst);
      // das bisherige Verhalten nimmt wie gehabt den ersten.
      const treffer = exactDhashQuery.docs.map((d) => ({ doc: d, distance: 0, mode: 'dhash_exact' }));
      if (!treffer.length || feinModus) {
        // Hamming-distance scan: pull last N receipts that have a
        // server-dHash, compute distance client-side. This is bounded
        // by DHASH_DEDUP_LOOKBACK so cost is predictable.
        // 86ca0wbg7 (B): zusätzlich zur Count-Grenze auf ein Zeitfenster bounden
        // (range auf dem ohnehin sortierten createdAt → KEIN neuer Index nötig),
        // damit der Scan auch bei Tausenden Bons pro User klein bleibt.
        const dedupCutoff = admin.firestore.Timestamp.fromMillis(
          Date.now() - DHASH_DEDUP_LOOKBACK_DAYS * 86400000,
        );
        const recentSnap = await db
          .collection('receipts')
          .where('userId', '==', uid)
          .where('createdAt', '>=', dedupCutoff)
          .orderBy('createdAt', 'desc')
          .limit(DHASH_DEDUP_LOOKBACK)
          .get();
        for (const d of recentSnap.docs) {
          if (treffer.some((t) => t.doc.id === d.id)) continue;
          const otherHash = d.get('capture.perceptualHashServer');
          if (typeof otherHash !== 'string' || otherHash.length !== serverDhash.length) continue;
          const dist = hammingDistance(serverDhash, otherHash);
          if (dist >= 0 && dist <= DHASH_DUPLICATE_THRESHOLD) {
            treffer.push({ doc: d, distance: dist, mode: dist === 0 ? 'dhash_exact' : 'dhash_near' });
            if (!feinModus) break;
          }
        }
      }

      let nearDuplicate = treffer[0] || null;
      if (nearDuplicate && feinModus) {
        // Nur Bons, gegen die eine Sperre überhaupt sinnvoll ist.
        const kandidaten = treffer
          .filter((t) => BILD_SPERR_STATUS.has(t.doc.get('status')))
          .map((t) => ({ id: t.doc.id, distanz: t.distance, pfad: t.doc.get('storage.path') || null, treffer: t }));
        const fein = kandidaten.length
          ? await bildKandidatenPruefen({
              neuBytes: bytes,
              kandidaten,
              laden: async (pfad) => (await bucket.file(pfad).download())[0],
              budgetMs: BILD_FEINVERGLEICH_BUDGET_MS,
            })
          : { bestaetigt: null, ergebnisse: [] };
        const naechster = treffer.slice().sort((x, y) => x.distance - y.distance)[0];
        logger.info('forensics-feinvergleich', {
          uid,
          modus: feinModus === true ? 'wirksam' : 'beobachtung',
          treffer: treffer.length,
          gesperrtBisher: nearDuplicate.doc.id,
          statusBisher: nearDuplicate.doc.get('status') || null,
          neuWuerde: fein.bestaetigt ? 'sperren' : 'lesen',
          ergebnisse: fein.ergebnisse,
        });
        if (feinModus === true) {
          if (fein.bestaetigt) {
            nearDuplicate = kandidaten.find((k) => k.id === fein.bestaetigt.kandidat).treffer;
          } else {
            nearDuplicate = null;
            // Am Bon festhalten, wie nah das Bild war — für die Prüfkonsole und
            // die Auswertung. Ein Fehler/Zeitlimit ist kein Urteil: gelesen wird
            // trotzdem.
            const erster = fein.ergebnisse[0] || null;
            bildAehnlich = {
              kandidat: erster ? erster.kandidat : naechster.doc.id,
              distanz: erster ? erster.distanz : naechster.distance,
              ssim: erster && Number.isFinite(erster.ssim) ? erster.ssim : null,
              abweichung: erster && Number.isFinite(erster.abweichung) ? erster.abweichung : null,
              seitenDiff: erster && Number.isFinite(erster.seitenDiff) ? erster.seitenDiff : null,
              bestaetigt: false,
              ...(erster && erster.fehler ? { fehler: erster.fehler } : {}),
              ...(kandidaten.length ? {} : { grund: 'nur_abgelehnte_oder_unverguetete' }),
            };
          }
        }
      }

      if (nearDuplicate) {
        const existing = nearDuplicate.doc;
        if (clientUploadId && clientUploadId !== existing.id) {
          await db
            .doc(`users/${uid}/cashback_status/${clientUploadId}`)
            .set(
              {
                status: 'superseded',
                supersededBy: existing.id,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true },
            )
            .catch(() => {});
        }
        logger.info('forensics-duplicate', {
          uid,
          existingId: existing.id,
          mode: nearDuplicate.mode,
          distance: nearDuplicate.distance,
        });
        res.status(200).json({
          cashbackId: existing.id,
          status: existing.get('status'),
          duplicate: true,
          duplicateMode: nearDuplicate.mode,
          duplicateDistance: nearDuplicate.distance,
        });
        return;
      }
    } catch (e) {
      // Non-fatal: if forensics fail (e.g. storage IAM hiccup), log
      // and continue without the signal. Better to under-flag than to
      // block legit users on infra glitches.
      logger.warn('forensics-failed', { uid, err: e.message });
    }

    // Use the client-provided id (so the placeholder mirror doc and
    // the receipt doc share the id, and the live snapshot keeps working
    // through the entire lifecycle without identity changes).
    const docRef = clientUploadId
      ? db.collection('receipts').doc(clientUploadId)
      : db.collection('receipts').doc();
    const cashbackId = docRef.id;
    const now = admin.firestore.FieldValue.serverTimestamp();
    const estimatedReadyBy = Date.now() + 30_000;

    // Sanitize journey snapshot — strip anything that isn't a primitive
    // or plain object (DocumentReferences from the client would explode
    // here). We only persist what's safe for analytics + audit.
    const safeJourney =
      journey && typeof journey === 'object'
        ? {
            journeyId: journey.journeyId ? String(journey.journeyId) : null,
            discoveryMethod: journey.discoveryMethod ? String(journey.discoveryMethod) : null,
            startedAt: Number.isFinite(journey.startedAt) ? Number(journey.startedAt) : null,
            location:
              journey.location && typeof journey.location === 'object'
                ? {
                    lat: Number(journey.location.lat) || null,
                    lon: Number(journey.location.lon) || null,
                    city: journey.location.city ? String(journey.location.city) : null,
                    geohash5: journey.location.geohash5 ? String(journey.location.geohash5) : null,
                    source: journey.location.source ? String(journey.location.source) : null,
                  }
                : null,
            motivationSignals:
              journey.motivationSignals && typeof journey.motivationSignals === 'object'
                ? {
                    priceSignals: Number(journey.motivationSignals.priceSignals) || 0,
                    brandSignals: Number(journey.motivationSignals.brandSignals) || 0,
                    contentSignals: Number(journey.motivationSignals.contentSignals) || 0,
                    marketSignals: Number(journey.motivationSignals.marketSignals) || 0,
                    searchTerms: Array.isArray(journey.motivationSignals.searchTerms)
                      ? journey.motivationSignals.searchTerms.slice(0, 20).map(String)
                      : [],
                  }
                : null,
            filterMetricsMotivation: journey.filterMetricsMotivation
              ? String(journey.filterMetricsMotivation)
              : null,
            viewedProductsCount: Number(journey.viewedProductsCount) || 0,
          }
        : null;

    // Geräte-Standort + App-Version aus dem Moment der Aufnahme (26.09.2026,
    // rein additiv, Feldnamen wie crowd_uploads). Nicht vertrauenswürdig:
    // lib/clientKontext.js übernimmt nur geprüfte Werte und wirft nie. Alte
    // Apps schicken nichts → der Bon sieht exakt aus wie bisher.
    const kontext = uebernehmeClientKontext(body, { jetztMs: Date.now() });
    if (kontext.verworfen) {
      // Nie Koordinaten loggen.
      logger.info('bon-gps-verworfen', { cashbackId, ...clientKontextLog(kontext) });
    }

    await docRef.set({
      userId: uid,
      status: 'ocr_pending',
      // Vom User gewählte Aktion — Quelle der Wahrheit für die Vergütung
      // in processCashback (campaignsEnabled-Modus). null = keine Aktion.
      campaignId: typeof campaignId === 'string' && campaignId ? campaignId : null,
      ...(kontext.clientVersion ? { clientVersion: kontext.clientVersion } : {}),
      capture: {
        // NUR gpsStatus / gps / gpsError — die Serverfelder danach gewinnen immer.
        ...kontext.capture,
        source: source || 'live_camera',
        appCheck: false, // wire when the App Check token lands
        deviceAttest: false,
        hash: bytesHash,
        perceptualHash: perceptualHash || null,           // client-provided, untrusted
        perceptualHashServer: serverDhash,                // server-computed, authoritative
        capturedAt: capturedAt ? new Date(capturedAt) : new Date(),
        // EXIF forensic signals — null when EXIF was missing/unreadable.
        exif: exifMeta
          ? {
              capturedAtMs: exifMeta.capturedAtMs,
              make: exifMeta.make,
              model: exifMeta.model,
              software: exifMeta.software,
              present: exifMeta.present,
            }
          : null,
        forensicFlags: forensicFlags || null,
        // dHash-Treffer, den der Feinvergleich NICHT bestätigt hat (04.10.2026).
        ...(bildAehnlich ? { bildAehnlich } : {}),
        // Dieselbe Datei wie ein wegen eines Lesefehlers abgelehnter Bon —
        // einmal neu gelesen (04.10.2026).
        ...(neuversuchVon ? { neuversuchVon } : {}),
      },
      storage: {
        bucket: admin.storage().bucket().name,
        path: storagePath,
        contentType: 'image/jpeg',
        sizeBytes: serverBytesSize, // we now know it from the forensics download
      },
      journey: safeJourney,
      createdAt: now,
      updatedAt: now,
    });

    // Update the user-side mirror to ocr_pending. If the client wrote
    // a placeholder mirror earlier ('uploading'), this merges into it;
    // if not, it creates the doc fresh.
    await db.doc(`users/${uid}/cashback_status/${cashbackId}`).set(
      {
        status: 'ocr_pending',
        receiptId: cashbackId,
        cashbackCents: 0,
        isClientPlaceholder: false,
        updatedAt: now,
      },
      { merge: true },
    );

    // Publish PubSub
    try {
      const topic = pubsub.topic(PUBSUB_TOPIC);
      await topic
        .publishMessage({
          json: { cashbackId, uid },
          attributes: { uid, cashbackId },
        })
        .catch(async (e) => {
          if (e.code === 5) {
            // NOT_FOUND — auto-create on first call.
            await pubsub.createTopic(PUBSUB_TOPIC).catch(() => {});
            await pubsub.topic(PUBSUB_TOPIC).publishMessage({
              json: { cashbackId, uid },
              attributes: { uid, cashbackId },
            });
          } else {
            throw e;
          }
        });
    } catch (e) {
      logger.error('pubsub-publish-failed', { err: e.message, cashbackId });
      await docRef.update({ status: 'rejected', updatedAt: now, rejectReason: 'pubsub_publish_failed' });
      res.status(500).json({ code: 'internal' });
      return;
    }

    res.status(200).json({
      cashbackId,
      status: 'ocr_pending',
      estimatedReadyBy,
    });
  },
);

// ─── processCashback (PubSub) ───────────────────────────────────────

exports.processCashback = onMessagePublished(
  {
    region: REGION,
    topic: PUBSUB_TOPIC,
    // 19.08.2026: 120 s reichten nach der Vertex-Umstellung nicht mehr — ein
    // langer Bon (52 Positionen) lief in "maximum request timeout". Die
    // robuste OCR liest bis zu 6-mal (2 Flash + 2 enhanced + 2 Pro), dazu
    // Forensik + ggf. DocAI-Eskalation. 540 s = Maximum fuer event-driven
    // Functions, gibt Luft ohne Verhaltensaenderung im Normalfall (~10-20 s).
    // Seit 03.10.2026 hält die OCR ein eigenes Laufbudget ein und setzt bei
    // Bedarf in einem neuen Lauf fort (LAUF_ZEITGRENZE_MS, lib/ocr_robust.js)
    // — die 540 s sind damit nur noch die äußere Sicherung.
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets: [GEMINI_API_KEY],
  },
  async (event) => {
    // Uhr des Laufs: ab hier zählen Laufbudget der OCR und Laufzeitgrenze.
    const laufStart = Date.now();
    // Push-Prüfung 24.09.2026 (lib/laufAnspruch.js): Pub/Sub stellt dieselbe
    // Nachricht gelegentlich doppelt zu. Laufen beide Zustellungen parallel,
    // kann die zweite mit eigener, abweichender OCR-Lesung eine schon gemeldete
    // Gutschrift stornieren. Darum meldet sich jeder Lauf am Bon an; eine
    // zweite Zustellung DERSELBEN Nachricht, solange der erste Lauf läuft, tut
    // nichts. Ebenso wird nicht gerechnet, solange die Prüfkonsole entscheidet.
    let payload = {};
    try {
      payload = event.data.message.json || {};
    } catch (e) {
      // Kaputte Nutzlast: die Verarbeitung unten meldet sie wie bisher.
    }
    const anspruchRef = payload.cashbackId ? db.doc(`receipts/${payload.cashbackId}`) : null;
    const anspruch = anspruchRef
      ? await laufBeginnen({ db, admin, docRef: anspruchRef, eventId: event.id })
      : { urteil: 'frei', angemeldet: false };
    if (anspruch.urteil !== 'frei') {
      logger.warn('process-uebersprungen', { cashbackId: payload.cashbackId, eventId: event.id, grund: anspruch.urteil });
      return;
    }
    if (anspruch.fehler) {
      logger.warn('lauf-anspruch-fehlgeschlagen', { cashbackId: payload.cashbackId, err: anspruch.fehler });
    }
    try {
      await verarbeiteCashback(event, { laufStart });
    } finally {
      if (anspruch.angemeldet && !(await laufBeenden({ admin, docRef: anspruchRef, eventId: event.id }))) {
        // Der Anspruch verfällt nach LAUF_MAX_MS von selbst; bis dahin meldet
        // die Konsole für diesen Bon processing_in_progress.
        logger.warn('lauf-abmeldung-fehlgeschlagen', { cashbackId: payload.cashbackId, eventId: event.id });
      }
    }
  },
);

/**
 * Die eigentliche Bon-Verarbeitung (bis 24.09.2026 direkt der Handler oben).
 * Die Einrückung ist bewusst unverändert geblieben, damit parallele Zweige an
 * diesem Block ohne Konflikte zusammenfinden.
 */
async function verarbeiteCashback(event, { laufStart = Date.now() } = {}) {
    const data = event.data.message.json || {};
    const { cashbackId, uid } = data;
    if (!cashbackId || !uid) {
      logger.error('process-bad-payload', { data });
      return;
    }

    const docRef = db.doc(`receipts/${cashbackId}`);
    const snap = await docRef.get();
    if (!snap.exists) {
      logger.warn('process-no-doc', { cashbackId });
      return;
    }
    const receipt = snap.data();
    if (receipt.userId !== uid) {
      logger.warn('process-uid-mismatch', { cashbackId, expected: receipt.userId, got: uid });
      return;
    }

    const config = await loadConfig();
    const now = admin.firestore.FieldValue.serverTimestamp();

    try {
      // 1) Download image bytes from Storage
      const bucket = admin.storage().bucket(receipt.storage.bucket);
      const file = bucket.file(receipt.storage.path);
      const [bytes] = await file.download();
      const [metadata] = await file.getMetadata();
      const sizeBytes = Number(metadata.size) || bytes.length;
      const mimeType = metadata.contentType || 'image/jpeg';

      // 2) Primary OCR — engine selected via CASHBACK_OCR_ENGINE env var
      //    (default: cv-hybrid, the Phase-0 validated winner).
      // 86ca0wbg7 (A): Idempotenz — hat ein früherer Versuch die OCR schon
      // gemacht (am Doc gespeichert), wiederverwenden statt erneut (teuer)
      // Gemini/DocAI zu rufen. Spart bei Retries die OCR-Kosten komplett.
      let ocr;
      let recon;
      let escalation = { fired: false };
      const cachedOcr = receipt.ocr && receipt.ocr.parsed ? receipt.ocr : null;
      // Eigenmarken-Stufe des Markt-Resolvers (Prompt v1.5, 04.10.2026): sie
      // erkennt selbstständige EDEKA-/REWE-Kaufleute, deren Bonkopf die Kette
      // nicht nennt, an den Eigenmarken. Ein Lieferdienst mit G&G-Artikeln
      // (Picnic) ist aber nicht EDEKA — mit
      // `cashback_config/v1.eigenmarkeNurLadenbon === true` gilt die Stufe nur
      // noch für Ladenbons MIT Uhrzeit: nicht für Online-Bestellungen und nicht
      // für Belege ohne Uhrzeit (ein Picnic-Beleg mit abgeschnittenem Kopf liest
      // sich als App-Kassenbon ohne Händler; alle Picnic-/Knuspr-Belege der
      // Messung hatten keine Uhrzeit, 26 von 28 bezahlten Bons ohne Kettennamen
      // im Kopf hatten eine). 'shadow' protokolliert nur.
      // Ein SCHON BEZAHLTER Bon behält die Stufe immer (Prüfrunde 04.10.): sonst
      // würde eine erneute Zustellung nach dem Umschalten seine Gutschrift als
      // unknown_merchant stornieren — Gates, die von approved wegführen, hängen
      // an alreadyCredited. Die Abfrage kostet zwei Lesevorgänge und läuft nur
      // bei scharfem Schalter; scheitert sie, wird wiederholt (fail-closed wie
      // der Ledger-Precheck unten).
      const eigenmarkeModus = schalterModus(config.eigenmarkeNurLadenbon);
      const eigenmarkeWuerdeFehlen = (p) => istOnlineBestellung(p) || !uhrzeitNormal(p && p.bonTime);
      // Schon bezahlt? Einmal je Lauf gefragt, nur wenn es eine Regel braucht
      // (Eigenmarke scharf, Bestandsschutz des Markt-Resolvers unten).
      let _schonBezahlt = null;
      const schonBezahlt = async (stelle) => {
        if (_schonBezahlt === null) {
          try {
            _schonBezahlt = await nettoGutgeschrieben(uid, cashbackId) > 0;
          } catch (e) {
            logger.warn('ledger-precheck-failed', { cashbackId, err: e.message, stelle });
            const err = new Error(`ledger precheck failed: ${e.message}`);
            err.code = 'ledger_precheck_failed';
            throw err;
          }
        }
        return _schonBezahlt;
      };
      const bonSchonBezahlt = eigenmarkeModus === true ? await schonBezahlt('eigenmarke') : false;
      const eigenmarkeFuer = (p) => bonSchonBezahlt || !(eigenmarkeModus === true && eigenmarkeWuerdeFehlen(p));
      // Markt-Resolver (Prüfrunde 2, 04.10.2026, lib/merchant.js): bei einer
      // Online-Bestellung kein Tippfehler-Abgleich (fremde Shops wie „Denns"
      // trafen Penny) und ohne gelesenen Händlernamen keine Namensstufen —
      // ohne Schalter, das ist Patricks Regel für Online-Bestellungen.
      // Ladenbons ohne verwertbaren Namen (Prüfrunde 3): die strenge Fassung
      // traf ehrliche Bons UNSERER Märkte (REWE-eBon, Lidl/Netto mit
      // abgeschnittenem Logo; ~4 Fälle in 7 Tagen) und meldete „Markt nicht
      // dabei". Deshalb hängt sie an `cashback_config/v1.marktNurMitName`
      // (false | 'shadow' | true, Default false = Verhalten vor Prüfrunde 2:
      // Namensstufen auch ohne Namen, meist „dm"). Ausnahme: mit scharfem
      // `eigenmarkeNurLadenbon` bleibt ein Beleg OHNE Uhrzeit streng — das ist
      // der Picnic-Beleg mit abgeschnittenem Kopf (eigenmarkeFuer). Die
      // gedruckte Umsatzsteuer-ID der Kette (Stufe 1b, `kopf`) gilt immer.
      const marktModus = schalterModus(config.marktNurMitName);
      const marktNachsichtig = (p) => !istOnlineBestellung(p) && marktModus !== true && eigenmarkeFuer(p);
      const marktOptionen = (p) => ({
        eigenmarke: eigenmarkeFuer(p),
        fuzzy: !istOnlineBestellung(p),
        nachsichtig: marktNachsichtig(p),
        kopf: p ? p.merchantSubtitle ?? null : null,
      });
      if (cachedOcr) {
        // Bestand vor v1.5: eine Lieferanschrift im Kopf auch hier entfernen,
        // bevor der Final-Write das OCR-Feld neu schreibt (idempotent). Setzt
        // die Bereinigung erst hier die Artikelsumme als Endbetrag einer
        // Online-Rechnung ein, gilt der gespeicherte Abgleich nicht mehr.
        const parsedBereinigt = belegBereinigen(cachedOcr.parsed);
        const summeNeu = Boolean(parsedBereinigt && parsedBereinigt.summeAusArtikeln && !cachedOcr.parsed.summeAusArtikeln);
        ({ ocr, recon, escalation } = ocrFromCache({
          ...cachedOcr,
          parsed: parsedBereinigt,
          ...(summeNeu ? { reconciliation: null } : {}),
        }));
      } else {
        if (OCR_ENGINE === 'cv-hybrid') {
          ocr = await extractReceiptCVHybrid(bytes, mimeType, { model: config.ocrModel });
        } else {
          // Eskalations-Deckel: Gate-Closure für den Robust-Wrapper. Nutzt
          // EXAKT dieselben Resolver/Berechnungen wie der Gate-Block unten
          // (bonAgeDays, resolveMerchant, Kampagnen-maxAgeDays) — kein Drift.
          // Kappt nur, wenn das Signal über ALLE Lesungen stabil ist:
          //  (a) Bon auf jeder Lesung deutlich älter als Limit + Marge, oder
          //  (b) Markt auf jeder Lesung ausgefüllt UND vom Resolver unbekannt.
          // Kampagnen-Limit lazy laden (nur harte Bons zahlen den Read).
          let _maxAgePromise = null;
          const lazyEffectiveMaxAge = () => {
            if (!_maxAgePromise) {
              const capCid = config.campaignsEnabled ? (receipt.campaignId || null) : null;
              _maxAgePromise = (capCid ? loadCampaignById(capCid) : Promise.resolve(null))
                .then((c) => {
                  const m = Number(c?.maxAgeDays);
                  return Number.isFinite(m) && m > 0 ? m : MAX_BON_AGE_DAYS;
                })
                .catch(() => MAX_BON_AGE_DAYS);
            }
            return _maxAgePromise;
          };
          const escalationGate = ESCALATION_CAP_ENABLED
            ? async (reads) => {
                const parsedReads = reads.map((r) => r && r.parsed).filter((p) => p && p.isReceipt !== false);
                if (parsedReads.length < 2) return null;
                const ages = parsedReads.map((p) => bonAgeDays(p.bonDate));
                if (ages.every((a) => a != null)) {
                  const maxAge = await lazyEffectiveMaxAge();
                  if (Math.min(...ages) > maxAge + ESCALATION_CAP_AGE_MARGIN_DAYS) return 'bon_too_old';
                }
                if (parsedReads.every((p) => String(p.merchant || '').trim())) {
                  const infos = await Promise.all(
                    parsedReads.map((p) => resolveMerchant(p.merchant, p.bonCountry, p.items, marktOptionen(p))),
                  );
                  if (infos.every((m) => !m)) return 'unknown_merchant';
                }
                return null;
              }
            : undefined;

          // Primary path — ROBUST Gemini-on-image: reads the image several
          // times and trusts what independent runs AGREE on (sequence-level,
          // so it catches swaps/compensating errors Σ alone misses). Rescues
          // flaky/creased bons that a single read would mis-read → reject.
          // Confidence (high/medium/low/none) lands in ocr.robust. Validated
          // on 42 real bons: 40/40 reconcile, 0 high-confident-but-wrong.
          // Laufbudget + Fortsetzung (03.10.2026): reicht die Zeit dieses
          // Laufs nicht, kommt KEIN Ergebnis zurück, sondern ein Zwischenstand
          // — ablegen, neu zustellen, nichts entscheiden.
          try {
            ocr = await extractReceiptRobust(bytes, mimeType, {
              model: config.ocrModel,
              escalationGate,
              laufStart,
              zwischenstand: receipt.ocrZwischenstand || null,
            });
          } catch (e) {
            if (e && e.code === 'ocr_zeitbudget' && e.zwischenstand) {
              try {
                await ocrFortsetzen({ docRef, cashbackId, uid, eventId: event.id, stand: e.zwischenstand });
              } catch (f) {
                if (f && f.code === 'ocr_unavailable') throw f;
                // Ablegen oder Zustellen scheiterte (Firestore/PubSub): eine
                // Infrastruktur-Störung, nie ein Urteil über den Bon — und nach
                // dem letzten Versuch 'review', nicht 'rejected'. Ein schon
                // abgelegter Zwischenstand bleibt für den Kehrlauf stehen.
                const err = new Error(`ocr_unavailable: Fortsetzung nicht möglich — ${String(f && f.message ? f.message : f).slice(0, 200)}`);
                err.code = 'ocr_unavailable';
                err.zwischenstandBehalten = true;
                throw err;
              }
              return;
            }
            throw e;
          }
          ocr.cvLatencyMs = 0;
          ocr.geminiLatencyMs = ocr.latencyMs;
          ocr.ocrText = '';
        }
        // Belegart normalisieren, Lieferanschrift entfernen — für jede Engine
        // (die Gemini-Lesungen tun es schon in lib/ocr.js; idempotent).
        ocr.parsed = belegBereinigen(ocr.parsed);

        // 3) Reconciliation — asymmetric tolerance (Σ < total: ±200¢ for
        //    Pfand; Σ > total: only ±50¢ — that's the suspicious direction).
        recon = reconcile(ocr.parsed);

        // 3a) Escalation: if primary failed recon AND DocAI is configured,
        //     re-run the bon through DocAI Expense Parser. Take whichever
        //     result has the smaller |signedDelta| (or DocAI if it passes
        //     and primary doesn't).
        if (
          !recon.ok
          && ESCALATE_ON_RECON_FAIL
          && isDocAIConfigured()
          && ocr.parsed?.isReceipt !== false
          // Eskalations-Deckel: reject-gebundener Bon → auch DocAI sparen.
          && !ocr.robust?.cappedReason
        ) {
          try {
            const docai = await extractReceiptDocAI(bytes, mimeType);
            if (docai && docai.parsed) {
              const docaiRecon = reconcile(docai.parsed);
              const primaryAbsDelta = recon.deltaCents == null ? Infinity : recon.deltaCents;
              const docaiAbsDelta = docaiRecon.deltaCents == null ? Infinity : docaiRecon.deltaCents;
              const swap =
                docaiRecon.ok && !recon.ok
                  ? true
                  : docaiAbsDelta < primaryAbsDelta;
              escalation = {
                fired: true,
                swapped: swap,
                primaryEngine: ocr.engine,
                primaryDeltaCents: recon.deltaCents,
                primaryDirection: recon.direction,
                docaiDeltaCents: docaiRecon.deltaCents,
                docaiDirection: docaiRecon.direction,
                docaiLatencyMs: docai.latencyMs,
              };
              if (swap) {
                ocr = docai;
                recon = docaiRecon;
              }
            } else {
              escalation = { fired: true, swapped: false, reason: 'docai_no_result' };
            }
          } catch (e) {
            logger.warn('escalation-failed', { cashbackId, err: e.message });
            escalation = { fired: true, swapped: false, reason: e.message };
          }
        }

        // 86ca0wbg7 (A): OCR-Ergebnis SOFORT persistieren (vor Gates/Dedup/
        // Merchant). Schlägt ein späterer Schritt fehl, nutzt der Retry diese
        // OCR und ruft Gemini/DocAI NICHT erneut.
        // Transaktional: hat ein paralleler Lauf inzwischen eine Zweitprüfung
        // angefordert oder abgelegt, gehört der Bon diesem Lauf — diese frische
        // OCR darf deren Stand nicht überschreiben (Review 14.09.).
        // Der Zwischenstand einer über mehrere Läufe verteilten Leiter ist mit
        // der fertigen OCR erledigt.
        const fruehPersist = await writeOcrIfNoReferee(docRef, {
          ocr: buildOcrField(ocr, recon, escalation),
          ocrZwischenstand: admin.firestore.FieldValue.delete(),
          ocrFortsetzungen: admin.firestore.FieldValue.delete(),
          updatedAt: now,
        }).catch(() => 'fehler');
        if (fruehPersist === 'ueberholt') {
          logger.warn('ocr-ueberholt-von-zweitpruefung', { cashbackId });
          if (receipt.ocrZwischenstand) {
            await docRef.update({
              ocrZwischenstand: admin.firestore.FieldValue.delete(),
              ocrFortsetzungen: admin.firestore.FieldValue.delete(),
            }).catch(() => {});
          }
          return;
        }
      }

      // 3b) Zweitprüfung, Durchlauf 2 (86cbfvwge). Durchlauf 1 (Schritt 6v)
      // hat festgestellt, dass dieser Bon abgelehnt würde, obwohl die Lesung
      // unsicher war, und die Prüfung angefordert. Hier liest ein stärkeres
      // Modell nach — auf dem Cache-Pfad, damit die Prüfung ihre eigenen 540 s
      // hat und nicht nach bis zu 7 Robust-Lesungen im selben Lauf steckt.
      // Danach laufen ALLE Gates ganz normal über das (ggf. ersetzte) Ergebnis.
      // Der Schalter gilt, wie er JETZT steht — ein Notaus zwischen Anforderung
      // und Prüfung wirkt sofort. Übersprungen (Schalter aus, Tagesdeckel,
      // menschliche Entscheidung) wird NICHTS abgelegt: die Anfrage bleibt
      // offen, der Bon läuft diesmal ohne Prüfung durch die Gates, und eine
      // spätere Nachverarbeitung kann die Prüfung noch holen. Ein abgelegtes
      // „skipped" hätte die Prüfung für immer verbraucht (Review 14.09.).
      const refereeModus = refereeMode(config.ocrReferee);
      // Hat IN DIESEM LAUF eine Zweitprüfung die Lesung ersetzt (selbst oder
      // frisch von einem parallelen Lauf übernommen)? Dann passt ein früherer
      // Jahres-Korrektur-Vermerk nicht mehr zur Lesung (siehe Final-Write).
      let lesungErsetzt = false;
      if (cachedOcr && ocr.refereeRequest && !ocr.referee && !refereeModus) {
        logger.info('referee-skip', { cashbackId, grund: 'abgeschaltet' });
      } else if (cachedOcr && ocr.refereeRequest && !ocr.referee && receipt.reviewDecision) {
        logger.info('referee-skip', { cashbackId, grund: 'mensch_entschied' });
      } else if (cachedOcr && ocr.refereeRequest && !ocr.referee) {
        const anspruch = await claimRefereeRun(docRef, config.ocrRefereeMaxPerDay, event.id);
        if (anspruch.state === 'busy' || anspruch.state === 'gone') {
          // Ein anderer Lauf prüft gerade (oder die Anfrage ist weg) — dieser
          // Zustellung nichts tun. Stirbt der andere Lauf, übernimmt der
          // Sweeper nach Ablauf des Anspruchs.
          logger.info('referee-skip-delivery', { cashbackId, state: anspruch.state });
          return;
        }
        if (anspruch.state === 'done') {
          // Ein anderer Lauf hat die Prüfung schon abgelegt: mit DEM Stand weiter.
          ({ ocr, recon, escalation } = ocrFromCache(anspruch.ocr));
          lesungErsetzt = anspruch.ocr.referee?.applied === true;
        } else if (anspruch.state === 'daily_cap') {
          logger.warn('referee-skip', { cashbackId, grund: 'tageslimit' });
        } else {
          ocr.refereeRequest = anspruch.ocr.refereeRequest;
          const anfrage = ocr.refereeRequest;
          // Erstlesungen als Maßstab für plausibel() (lib/refereePolicy.js).
          // Ältere Bons ohne Einzel-Fingerabdrücke: die gespeicherte Lesung.
          const erstlesungen = Array.isArray(ocr.robust?.reads) && ocr.robust.reads.length
            ? ocr.robust.reads
            : [{
                isReceipt: ocr.parsed?.isReceipt !== false,
                totalCents: Number.isFinite(ocr.parsed?.totalCents) ? ocr.parsed.totalCents : null,
                bonDate: ocr.parsed?.bonDate ?? null,
                eligibleItems: countEligibleItems(ocr.parsed),
              }];
          const { result, chosen } = await runReferee(bytes, mimeType, {
            reason: anfrage.reason,
            prior: erstlesungen,
            // Marktnamen über den Resolver vergleichen, wie im Gate 6w.
            merchantKeyFor: async (name, land) => {
              const roh = normMerchant(name);
              if (!roh) return null;
              try {
                const t = await resolveMerchant(name, land ?? null);
                if (t && t.id) return `id:${t.id}`;
              } catch (e) {
                logger.warn('referee-merchant-failed', { cashbackId, err: e.message });
              }
              return `roh:${roh}`;
            },
          });
          // Hat die Infrastruktur die Entscheidung verhindert? Keine Lesung kam
          // zurück — oder die ausgefallenen Lesungen (429/Timeout/Frist) hätten
          // rechnerisch die fehlenden Zeugen stellen können. Dann ist
          // „unentschieden" keine Aussage über den Bon (Regel seit Incident
          // 19.08., Review Runde 3). Nur wenn die Prüfung WIRKT: NICHTS
          // ablegen, den Platz im Tagesdeckel zurückgeben, werfen. Es gibt
          // keinen PubSub-Retry (DO_NOT_RETRY) — der Bon bleibt `ocr_pending`,
          // der Sweeper stellt ihn neu zu, nach MAX_PROCESS_ATTEMPTS landet er
          // in 'review', nie in 'rejected'. Im Beobachtungs-Modus darf ein
          // Ausfall das Ergebnis nicht verändern: dort nur protokollieren und
          // ohne Prüfung weiter.
          const infraVerhindert = refereeInfraVerhindert(result);
          if (infraVerhindert) {
            logger.warn('referee-unavailable', { cashbackId, verdict: result.verdict, failures: result.failures, mode: refereeModus });
            db.doc(`cashback_referee_usage/${todayBerlin()}`)
              .set({ runs: admin.firestore.FieldValue.increment(-1), infraFehler: admin.firestore.FieldValue.increment(1) }, { merge: true })
              .catch(() => {});
          }
          if (infraVerhindert && refereeModus === true) {
            const err = new Error(`referee_unavailable: ${String(result.failures?.[0] || 'keine Lesung').slice(0, 160)}`);
            err.code = 'referee_unavailable';
            throw err;
          }
          // Beobachtungs-Modus mit Ausfall: nichts ablegen, ohne Prüfung weiter.
          if (!infraVerhindert) {
            const angewandt = refereeModus === true && result.verdict === 'decided' && !!chosen;
            const vorher = {
              merchant: ocr.parsed?.merchant ?? null,
              bonDate: ocr.parsed?.bonDate ?? null,
              totalCents: ocr.parsed?.totalCents ?? null,
              subtotalCents: ocr.parsed?.subtotalCents ?? null,
              itemCount: Array.isArray(ocr.parsed?.items) ? ocr.parsed.items.length : 0,
              reconDirection: recon?.direction ?? null,
              model: ocr.model ?? null,
              promptVersion: ocr.promptVersion ?? null,
            };
            ocr.referee = {
              ...result,
              mode: refereeModus,
              applied: angewandt,
              reason: anfrage.reason ?? null,
              priorConfidence: anfrage.confidence ?? null,
              previous: angewandt ? vorher : null,
              at: admin.firestore.Timestamp.now(),
            };
            if (angewandt) {
              ocr.parsed = chosen.parsed;
              // Uhrzeit aus den einheitlichen Erstlesungen übernehmen (Review
              // 19.09.): sie ist Teil des kontenübergreifenden Doppel-Schlüssels
              // und wird von keiner Prüfung der Zweitprüfung abgesichert.
              const uhr = einheitlicheUhrzeit(erstlesungen);
              if (uhr && ocr.parsed.bonTime !== uhr) {
                logger.info('referee-uhrzeit-aus-erstlesung', { cashbackId, vonPruefung: ocr.parsed.bonTime ?? null, ausErstlesung: uhr });
                ocr.parsed = { ...ocr.parsed, bonTime: uhr };
                ocr.referee.bonTimeAusErstlesung = uhr;
              }
              ocr.model = chosen.model;
              ocr.promptVersion = chosen.promptVersion;
              ocr.inputTokens = chosen.inputTokens ?? null;
              ocr.outputTokens = chosen.outputTokens ?? null;
              ocr.thoughtsTokens = chosen.thoughtsTokens ?? null;
              recon = reconcile(ocr.parsed);
            }
            // Sofort ablegen: eine spätere Wiederaufnahme (Sweeper) darf die
            // bezahlte Prüfung nicht wiederholen. Transaktional, nur mit eigenem
            // Anspruch (sonst überschriebe die zuletzt fertige Prüfung die
            // andere). Scheitert das Ablegen, NICHT in die Geld-Schritte
            // weiterlaufen — werfen; der Bon bleibt `ocr_pending` für den Sweeper.
            // Ersetzt die Prüfung die Lesung, gehört ein früherer Jahres-
            // Korrektur-Vermerk zur alten Lesung → gleich mit löschen.
            const abgelegt = await persistRefereeResult(
              docRef,
              {
                ocr: buildOcrField(ocr, recon, escalation),
                ...(angewandt ? { bonDateCorrection: null } : {}),
                updatedAt: now,
              },
              anfrage,
            );
            if (abgelegt.state === 'verloren') {
              logger.warn('referee-anspruch-verloren', { cashbackId });
              return;
            }
            if (abgelegt.state === 'done') {
              ({ ocr, recon, escalation } = ocrFromCache(abgelegt.ocr));
              lesungErsetzt = abgelegt.ocr.referee?.applied === true;
            } else {
              lesungErsetzt = angewandt;
            }
            logger.info('referee-done', {
              cashbackId,
              verdict: result.verdict,
              grund: result.grund,
              applied: angewandt,
              mode: refereeModus,
              reason: anfrage.reason,
              attempts: result.attempts,
              latencyMs: result.latencyMs ?? null,
            });
          }
        }
      }

      // 4) Bon-Datum freshness check (server-side, Berlin-anchored).
      // Bons older than MAX_BON_AGE_DAYS are rejected — protects
      // against backdated bons + the "drawer treasure" case where a
      // user submits a 6-month-old bon all at once.
      // 86cb9zuq1: Jahres-Fehllesung (DD.MM.YY → falsches Jahrhundert) VOR dem
      // Alters-Gate korrigieren; die Korrektur landet am Doc (bonDateCorrection).
      // Läuft auch über den OCR-Cache — Reprocessing braucht keinen Gemini-Call.
      const uploadedAt = receipt.createdAt?.toDate ? receipt.createdAt.toDate() : new Date();
      const plaus = plausibilizeBonDate(ocr.parsed.bonDate, uploadedAt);
      const bonDateCorrection = plaus.corrected;
      if (bonDateCorrection) {
        ocr.parsed.bonDate = plaus.bonDate;
        logger.info('bon-date-corrected', { cashbackId, ...bonDateCorrection });
      }
      const ageDays = bonAgeDays(ocr.parsed.bonDate, uploadedAt.getTime());
      // Bon-Datum in der Zukunft (> 1 Tag Toleranz) ist IMMER eine Fehllesung —
      // nie ablehnen, sondern in die Prüfung (Status-Entscheidung unten).
      const bonDateFuture = ageDays != null && ageDays < -1;

      // 5) Merchant resolution against /discounter, country-aware.
      let merchantInfo = await resolveMerchant(
        ocr.parsed.merchant,
        ocr.parsed.bonCountry,
        // Artikel mitgeben: nennt der Bonkopf die Kette nicht (selbstständige
        // EDEKA-/REWE-Kaufleute), erkennt der Resolver sie an den Eigenmarken.
        ocr.parsed.items,
        // Online-Bestellung (Entscheidung 04.10.2026): zählt nur, wenn der
        // HÄNDLER einer unserer Märkte ist — ein Lieferdienst mit G&G-Artikeln
        // (Picnic) ist nicht EDEKA. Dann unknown_merchant mit dem vorhandenen
        // App-Text („Diesen Markt unterstützen wir aktuell noch nicht").
        marktOptionen(ocr.parsed),
      );
      if (!merchantInfo) {
        // Bestandsschutz: hätte der Resolver VOR der Prüfrunde 2 einen Markt
        // gefunden und ist der Bon schon bezahlt, bleibt es dabei — sonst
        // stornierte eine erneute Zustellung die Gutschrift als
        // unknown_merchant (Gates, die von approved wegführen, hängen an
        // alreadyCredited). Kostet die Ledger-Abfrage nur in diesem Fall.
        const vorher = await resolveMerchant(ocr.parsed.merchant, ocr.parsed.bonCountry, ocr.parsed.items, { eigenmarke: true, nachsichtig: true });
        if (vorher && await schonBezahlt('markt-bestandsschutz')) {
          merchantInfo = vorher;
          logger.info('markt-bestandsschutz', { cashbackId, markt: vorher.id, matchVia: vorher.matchVia });
        }
      }
      if (marktModus === 'shadow' && marktNachsichtig(ocr.parsed) && !nameVerwertbar(ocr.parsed.merchant)) {
        // Beobachtung (Prüfrunde 3): was die strenge Fassung bei diesem
        // Ladenbon ohne Händlernamen ergäbe. Auswertung vor dem Umschalten:
        // gcloud logging read 'jsonPayload.message="markt-ohne-namen"'.
        const streng = await resolveMerchant(
          ocr.parsed.merchant, ocr.parsed.bonCountry, ocr.parsed.items,
          { ...marktOptionen(ocr.parsed), nachsichtig: false },
        );
        if ((streng?.id ?? null) !== (merchantInfo?.id ?? null)) {
          logger.info('markt-ohne-namen', {
            cashbackId,
            jetzt: merchantInfo?.id ?? null,
            jetztVia: merchantInfo?.matchVia ?? null,
            streng: streng?.id ?? null,
            strengVia: streng?.matchVia ?? null,
            belegart: ocr.parsed.belegart ?? null,
            mitUhrzeit: Boolean(uhrzeitNormal(ocr.parsed.bonTime)),
            wuerde: streng ? null : 'unknown_merchant',
          });
        }
      }
      if (eigenmarkeModus === 'shadow' && merchantInfo?.matchVia === 'eigenmarke' && eigenmarkeWuerdeFehlen(ocr.parsed)) {
        logger.info('eigenmarke-beobachtung', {
          cashbackId,
          markt: merchantInfo.id,
          grund: istOnlineBestellung(ocr.parsed) ? 'online_bestellung' : 'ohne_uhrzeit',
          wuerde: 'unknown_merchant',
        });
      }
      // 5a) Filialadresse (Straße/PLZ/Ort) — Entscheidung 05.09.2026: der
      //     Einkaufsort kommt vom Bon-Kopf (OCR v1.4 `storeAddress`, sonst
      //     Parser über `merchantSubtitle`), nicht aus der IP-Journey. Läuft
      //     auch über den OCR-Cache (Retry/Reprocessing) — kein Gemini-Call.
      const store = deriveStoreAddress(ocr.parsed, merchantInfo?.land ?? null);

      // 5b) Content-based duplicate detection (Layer 1.5).
      //     Catches the case image-forensics can't see: same physical
      //     bon re-photographed via Document Scanner produces different
      //     bytes / dHash / EXIF — but the OCR'd content is identical.
      //
      //     Two layers:
      //       - contentHash      (merchant + date + total)        per-user check
      //       - transactionHash  (merchant + date + time + total) cross-user check
      //
      //     Only counts as a match against a prior receipt that is in
      //     a "live" status (approved | review | matched | ocr_pending).
      //     Rejected/superseded prior receipts don't block — a previously
      //     rejected bon shouldn't lock out a legitimate re-attempt.
      const contentHash = computeContentHash(
        merchantInfo?.id,
        ocr.parsed.bonDate,
        ocr.parsed.totalCents,
      );
      const transactionHash = computeTransactionHash(
        merchantInfo?.id,
        ocr.parsed.bonDate,
        ocr.parsed.bonTime,
        ocr.parsed.totalCents,
      );

      // Jeder bereits ANGENOMMENE Bon blockt ein Re-Submit — egal ob
      // vergütet (approved/paid) oder angenommen-ohne-Vergütung
      // (no_reward, z.B. Aktions-Modus). Nur 'rejected'/'superseded'
      // blocken NICHT (legitimer Neuversuch nach Ablehnung).
      const LIVE_STATUSES = new Set([
        'approved', 'paid', 'no_reward', 'review', 'matched', 'ocr_pending',
      ]);
      const itemsHash = computeItemsHash(
        merchantInfo?.id,
        ocr.parsed.bonDate,
        ocr.parsed.items,
      );
      let duplicateOf = null;

      // Per-user check
      if (contentHash) {
        try {
          const dupQ = await db.collection('receipts')
            .where('userId', '==', uid)
            .where('contentHash', '==', contentHash)
            .limit(5).get();
          for (const doc of dupQ.docs) {
            if (doc.id === cashbackId) continue;
            if (LIVE_STATUSES.has(doc.get('status'))) {
              duplicateOf = {
                receiptId: doc.id,
                sameUser: true,
                priorStatus: doc.get('status'),
              };
              break;
            }
          }
        } catch (e) {
          logger.warn('content-dedup-self-failed', { cashbackId, err: e.message });
        }
      }

      // Cross-user check (only when bonTime present — see helper docstring)
      if (!duplicateOf && transactionHash) {
        try {
          const dupQ = await db.collection('receipts')
            .where('transactionHash', '==', transactionHash)
            .limit(5).get();
          for (const doc of dupQ.docs) {
            if (doc.id === cashbackId) continue;
            if (doc.get('userId') === uid) continue; // already covered above
            if (LIVE_STATUSES.has(doc.get('status'))) {
              duplicateOf = {
                receiptId: doc.id,
                sameUser: false,
                priorStatus: doc.get('status'),
              };
              logger.warn('cross-user-duplicate', {
                cashbackId,
                uid,
                otherUid: doc.get('userId'),
                otherReceiptId: doc.id,
                transactionHash,
              });
              break;
            }
          }
        } catch (e) {
          logger.warn('content-dedup-cross-failed', { cashbackId, err: e.message });
        }
      }

      // Items-Fingerprint (User-Regel 2): gleicher Markt + gleiche
      // Produkte + gleiches Datum, Uhrzeit ≤5min auseinander → Duplikat.
      // Robuster als contentHash, weil unabhängig vom (OCR-schwankenden)
      // Total — fängt Neu-Abfotografieren auch bei Total-Jitter.
      // (userId== + itemsHash== sind zwei Equality-Filter → Firestore
      // bedient das per Zigzag-Merge ohne Composite-Index.)
      if (!duplicateOf && itemsHash) {
        try {
          const dupQ = await db.collection('receipts')
            .where('userId', '==', uid)
            .where('itemsHash', '==', itemsHash)
            .limit(5).get();
          for (const doc of dupQ.docs) {
            if (doc.id === cashbackId) continue;
            if (!LIVE_STATUSES.has(doc.get('status'))) continue;
            if (!bonTimesWithin(ocr.parsed.bonTime, doc.get('bonTime'), 5)) continue;
            duplicateOf = {
              receiptId: doc.id,
              sameUser: true,
              priorStatus: doc.get('status'),
            };
            break;
          }
        } catch (e) {
          logger.warn('items-dedup-failed', { cashbackId, err: e.message });
        }
      }

      // 6) Gates + Vergütung. Zwei Modi:
      //    • campaignsEnabled=false → Dauer-Cashback über globale Tiers
      //      (+ optionales Monats-Limit). Bisheriges Verhalten, unverändert.
      //    • campaignsEnabled=true  → Vergütung NUR im Kontext der vom User
      //      gewählten Aktion (receipt.campaignId). Die Aktion definiert
      //      Tiers/Flat, minItems, Wochenlimit, Per-User-Cap und Budget.
      //      Keine globalen Earning-Regeln mehr.
      const eligibleItemCount = countEligibleItems(ocr.parsed);

      // Aktion FRÜH laden (vor dem Gate), damit ihr `maxAgeDays` bereits im
      // Alters-Gate greift (Config aus cashback_campaigns). 86ca0wbg7.
      const cid = config.campaignsEnabled ? (receipt.campaignId || null) : null;
      let selectedCampaign = cid ? await loadCampaignById(cid) : null;

      // 5b) Monatswechsel (Gegenprüfung 24.09.2026). Die App merkt sich die
      //     Aktion beim Öffnen der Erfassung; wer um 23:58 startet und um 00:01
      //     absendet, schickt die abgelaufene Monatsaktion mit. Liegt die
      //     gewählte Aktion zum EINGANG außerhalb ihres Zeitraums, gilt die
      //     Bon-Aktion, die zu diesem Zeitpunkt lief (lib/campaignZeit.js).
      //     Nur das Zeitfenster wird korrigiert — eine vor dem Eingang
      //     GESTOPPTE Aktion bleibt ein Ausschluss (bewusster Stopp).
      let aktionZeitKorrektur = null;
      if (config.campaignsEnabled && selectedCampaign) {
        const eingang = uploadedAt.getTime();
        const imZeitraum = toMs(selectedCampaign.startAt) <= eingang && eingang <= toMs(selectedCampaign.endAt);
        if (!imZeitraum) {
          const ersatz = aktionZumZeitpunkt(await loadAllCampaigns(), eingang, 'receipt');
          if (ersatz && ersatz.id !== selectedCampaign.id) {
            aktionZeitKorrektur = { von: selectedCampaign.id, nach: ersatz.id, eingangAt: new Date(eingang).toISOString() };
            logger.info('campaign-zeit-korrigiert', { cashbackId, ...aktionZeitKorrektur });
            selectedCampaign = ersatz;
          }
        }
      }

      // 5c) Regionale Aktionen (06.09.2026). Die App wählt die Aktion, BEVOR
      //     irgendjemand die Filialadresse kennt — die steht erst nach der
      //     Texterkennung fest. Passt die gewählte Aktion nicht zum Gebiet des
      //     Bons, korrigiert der Server auf eine passende; gibt es keine, wird
      //     der Bon ohne Prämie erfasst (Grund am Doc, kein stiller Ausfall).
      let targeting = null;
      if (config.campaignsEnabled) {
        const region = resolveRegion({
          bonZip: store?.zip ?? null,
          country: store?.country ?? merchantInfo?.land ?? ocr.parsed.bonCountry ?? null,
        });
        const aktive = await loadActiveCampaigns('receipt');
        const hatTargeting = aktive.some((c) => c.targeting && (c.targeting.zipPrefixes?.length || c.targeting.countries?.length));
        if (hatTargeting) {
          const pick = pickCampaignForRegion(aktive, region, cid);
          targeting = { ...targetingStamp(pick.campaign || selectedCampaign, region, matchesTargeting(pick.campaign || selectedCampaign || {}, region)), korrigiert: pick.korrigiert, gewaehlt: cid || null, angewandt: pick.campaign ? pick.campaign.id : null };
          if (!pick.campaign) {
            selectedCampaign = null;
            targeting.grund = pick.grund;
          } else if (pick.campaign.id !== (selectedCampaign && selectedCampaign.id)) {
            logger.info('campaign-region-korrigiert', { cashbackId, von: cid, nach: pick.campaign.id, zip: region.zip });
            selectedCampaign = pick.campaign;
          }
        }
      }
      // Effektives Max-Bon-Alter in TAGEN (bezogen aufs Bon-Datum): der Aktions-
      // Wert überschreibt den globalen Default; 0/undefined → globaler Default
      // (kein Aktions-Limit).
      const campaignMaxAge = Number(selectedCampaign?.maxAgeDays);
      const effectiveMaxAgeDays =
        Number.isFinite(campaignMaxAge) && campaignMaxAge > 0 ? campaignMaxAge : MAX_BON_AGE_DAYS;

      const gatesOk =
        merchantInfo
        && recon.ok
        && !duplicateOf
        && (ageDays == null || ageDays <= effectiveMaxAgeDays);

      // 86cb7ygjh: Ein Bon, der SCHON gutgeschrieben ist (PubSub-Redelivery,
      // Reprocessing, App-Retry), darf sich nicht an seinen eigenen Zählern
      // deckeln — sonst storniert syncLedgerForReceipt die eigene Gutschrift
      // (Live-Schaden 19.08. + 26.08.). Bei bestehendem Netto-Earn werden alle
      // Cap-Pre-Checks übersprungen; die Transaktion behandelt den Bon als
      // Noop bzw. amount_correction. Race-Schutz liegt zusätzlich IN der
      // Transaktion (caps-Parameter von syncLedgerForReceipt).
      let alreadyCredited = false;
      try {
        alreadyCredited = await nettoGutgeschrieben(uid, cashbackId) > 0;
      } catch (e) {
        // FAIL-CLOSED (Backlog-Audit 02.09.): ohne diese Antwort dürfen die
        // Cap-Pre-Checks nicht laufen — sie sähen die eigene Gutschrift in den
        // Zählern und würden sie stornieren. Transienter Fehler → PubSub-Retry.
        logger.warn('ledger-precheck-failed', { cashbackId, err: e.message });
        const err = new Error(`ledger precheck failed: ${e.message}`);
        err.code = 'ledger_precheck_failed';
        throw err;
      }

      let cashbackCents = 0;
      // no_active_campaign | below_min_items | weekly_cap_reached |
      // per_user_cap_reached | campaign_budget_exhausted | monthly_cap_reached
      let zeroReason = null;

      if (config.campaignsEnabled) {
        // cid + selectedCampaign bereits oben bestimmt (für das Alters-Gate).
        // Kampagnenfenster gegen den UPLOAD-Zeitpunkt prüfen, nicht gegen
        // „jetzt": ein pünktlich eingereichter Bon behält seine Aktion auch bei
        // späterer Verarbeitung (Retry/Incident/Reprocessing) und nach dem
        // Auslaufen der Aktion. `active:false` ist nur dann ein Ausschluss,
        // wenn die Aktion VOR dem Upload gestoppt wurde (deactivatedAt).
        const refMs = uploadedAt.getTime();
        const killedAtMs = selectedCampaign?.deactivatedAt ? toMs(selectedCampaign.deactivatedAt) : null;
        const inWindow =
          selectedCampaign
          && toMs(selectedCampaign.startAt) <= refMs
          && refMs <= toMs(selectedCampaign.endAt)
          && (killedAtMs == null || refMs <= killedAtMs);

        if (!gatesOk) {
          cashbackCents = 0; // harter Gate (Merchant/recon/dup/alt) → Section 7
        } else if (!cid || !selectedCampaign || !inWindow) {
          cashbackCents = 0;
          // Regionale Aktion: der Bon kommt aus einem Gebiet, für das gerade
          // keine Aktion läuft. Eigener Grund, damit die App das erklären kann
          // und die Auswertung es von „gar keine Aktion" unterscheidet.
          zeroReason = targeting && (targeting.grund === 'region_ausserhalb' || targeting.grund === 'keine_passende_aktion')
            ? 'ausserhalb_aktionsgebiet'
            : 'no_active_campaign';
        } else {
          let reward = campaignRewardCents(eligibleItemCount, selectedCampaign, config);
          if (reward <= 0) {
            zeroReason = 'below_min_items';
          } else {
            // Frische User-Zähler für Wochen-/Per-User-Cap.
            let uData = {};
            try {
              const uSnap = await db.doc(`users/${uid}`).get();
              uData = uSnap.exists ? uSnap.data() : {};
            } catch (e) {
              logger.warn('campaign-counters-read-failed', { cashbackId, err: e.message });
            }
            // Wochenlimit der Aktion (pro User, Mo–So Berlin). Gezählt gegen die
            // TATSÄCHLICH geltende Aktion (selectedCampaign.id), nicht gegen die
            // Wahl der App (cid) — nach Monatswechsel- oder Regionskorrektur
            // unterscheiden sich beide (Hinweis APP_ORIGINAL 24.09.).
            const weeklyCap = Number(selectedCampaign.weeklyBonCap) || 0;
            if (!alreadyCredited && weeklyCap > 0) {
              const wk = isoWeekKey(ocr.parsed.bonDate || todayBerlin());
              const used = (((uData.cashback_campaign_weekly || {})[selectedCampaign.id] || {})[wk] || {}).count || 0;
              if (used >= weeklyCap) {
                reward = 0;
                zeroReason = 'weekly_cap_reached';
              }
            }
            // Per-User-Gesamtdeckel der Aktion (cappt auf Headroom).
            if (!alreadyCredited && reward > 0) {
              const perUserCap = Number(selectedCampaign.maxPerUserCents) || 0;
              if (perUserCap > 0) {
                const earned = (uData.cashback_campaign_totals || {})[selectedCampaign.id] || 0;
                const headroom = Math.max(0, perUserCap - earned);
                if (reward > headroom) {
                  reward = headroom;
                  if (reward === 0) zeroReason = 'per_user_cap_reached';
                }
              }
            }
            // Budget-Deckelung passiert NICHT hier (stale read → Race bei
            // 2 parallelen Bons am letzten Budget-Rest), sondern atomar in
            // der Ledger-Transaktion (syncLedgerForReceipt liest das Budget
            // im tx.get und cappt dort). Hier nur der Brutto-Reward nach
            // Wochen-/Per-User-Cap.
            cashbackCents = reward;
          }
        }
      } else {
        // ── Dauer-Cashback (bisheriges Verhalten): globale Tiers ──
        cashbackCents = gatesOk ? tierFor(eligibleItemCount, config.tiers) : 0;

        // Monats-Limit nur im Dauer-Modus (im Aktions-Modus gilt der
        // Per-User-Cap der Aktion statt eines globalen Monatslimits).
        if (!alreadyCredited && config.monthlyMaxCents > 0 && cashbackCents > 0) {
          const month = (ocr.parsed.bonDate || todayBerlin()).slice(0, 7); // YYYY-MM
          let earnedThisMonth = 0;
          try {
            const uSnap = await db.doc(`users/${uid}`).get();
            earnedThisMonth = uSnap.exists
              ? uSnap.data()?.cashback_monthly?.[month]?.earnedCents || 0
              : 0;
          } catch (e) {
            logger.warn('monthly-read-failed', { cashbackId, err: e.message });
          }
          const headroom = Math.max(0, config.monthlyMaxCents - earnedThisMonth);
          if (cashbackCents > headroom) {
            cashbackCents = headroom; // Teilbetrag bleibt approved
            if (cashbackCents === 0) zeroReason = 'monthly_cap_reached';
          }
        }
      }

      // 6y) Tageslimit (ClickUp 86ca8hr90): max. config.dailyCap vergütete Bons
      // pro BON-DATUM (Bon-Datum-Semantik). Seit 05.09.2026 ein echter Zähler
      // (users/{uid}/cashback_days/{Tag}.receiptIds) statt des Vorwärts-Felds
      // cashback_last_bon_date — nachgereichte ältere Bons zählen damit korrekt.
      // Der Bon wird angenommen + getrackt (no_reward statt Verwerfen). Der
      // Pre-Check ist nur Vorsortierung; autoritativ entscheidet die Ledger-
      // Transaktion (caps.dailyCap) gegen dasselbe Doc.
      if (!alreadyCredited && cashbackCents > 0 && Number(config.dailyCap) > 0) {
        try {
          const bonDay = (ocr.parsed.bonDate || todayBerlin()).slice(0, 10);
          const daySnap = await db.doc(`users/${uid}/cashback_days/${bonDay}`).get();
          const dayIds = Array.isArray(daySnap.data()?.receiptIds) ? daySnap.data().receiptIds : [];
          const cap = Number(config.dailyCap);
          // Übergangs-Fallback (nur bei Cap 1): altes Vorwärts-Feld, siehe Tx.
          let legacyHit = false;
          if (cap === 1 && config.dailyCapLegacyFallback !== false) {
            const uSnap = await db.doc(`users/${uid}`).get();
            const u = uSnap.exists ? uSnap.data() : {};
            legacyHit = u.cashback_last_bon_date === bonDay && u.cashback_last_bon_receiptId !== cashbackId;
          }
          // Eigener Bon zählt nicht als „schon vergüteter Bon des Tages".
          if (dayIds.filter((id) => id !== cashbackId).length >= cap || legacyHit) {
            cashbackCents = 0;
            zeroReason = 'daily_cap_reached';
          }
        } catch (e) {
          logger.warn('daily-cap-read-failed', { cashbackId, err: e.message });
        }
      }

      // 7) Decide status (priority: not-a-receipt > unknown-merchant >
      //                  too-old > duplicate > recon > below-min)
      let status = 'matched';
      let rejectReason = null;
      let rejectDetail = null; // Freitext zum Code (z.B. OCR-Begründung bei not_a_receipt)
      if (!ocr.parsed.isReceipt) {
        status = 'rejected';
        // 04.09.2026: rejectReason ist ein CODE, den die App mappt (pending/[id].tsx
        // → „Kein Kassenbon erkannt"). Der OCR-Freitext („Das Bild ist komplett
        // schwarz …") stand bisher direkt im Feld und fiel in der App auf den
        // generischen Fallback „Bon abgelehnt". Freitext jetzt separat.
        rejectReason = 'not_a_receipt';
        rejectDetail = ocr.parsed.notReceiptReason || null;
      } else if (!merchantInfo) {
        status = 'rejected';
        rejectReason = 'unknown_merchant';
      } else if (ageDays != null && ageDays > effectiveMaxAgeDays) {
        status = 'rejected';
        rejectReason = 'bon_too_old';
      } else if (bonDateFuture) {
        // Zukunfts-Datum = Fehllesung → prüfen statt ablehnen (86cb9zuq1).
        status = 'review';
      } else if (ageDays == null) {
        // Bon-Datum nicht erkannt → ABLEHNEN (keine manuelle Prüfung).
        status = 'rejected';
        rejectReason = 'no_bon_date';
      } else if (duplicateOf) {
        status = 'rejected';
        rejectReason = duplicateOf.sameUser
          ? 'duplicate_content_self'
          : 'duplicate_content_cross_user';
      } else if (!recon.ok) {
        // Σ Items ≠ Total → ABLEHNEN (nie 'review' / manuelle Prüfung).
        status = 'rejected';
        rejectReason = 'reconciliation_delta';
      } else if (cashbackCents === 0) {
        // Gültiger Bon, aber 0 Vergütung.
        // • Aktions-Modus: IMMER 'no_reward' → Bon wird angenommen +
        //   Positionen getrackt (Ausgabenübersicht), nur ohne Geld.
        // • Dauer-Modus: bisheriges Verhalten (Monats-Cap → no_reward,
        //   sonst below_min_items → rejected).
        if (config.campaignsEnabled) {
          status = 'no_reward';
          rejectReason = zeroReason || 'below_min_items';
        } else if (zeroReason === 'monthly_cap_reached' || zeroReason === 'daily_cap_reached') {
          // Cap erreicht → Bon trotzdem annehmen + tracken (86ca8hr90).
          status = 'no_reward';
          rejectReason = zeroReason;
        } else {
          status = 'rejected';
          rejectReason = 'below_min_items';
        }
      } else {
        status = 'approved';
      }

      // 6w) Go-Live (86caf62v6): risiko-gegate Auto-Freigabe. Ein Bon, der sonst
      // SOFORT echtes Geld bekäme (status 'approved'), wird stattdessen auf
      // 'review' GEHALTEN — NICHT abgelehnt, NICHT gutgeschrieben (syncLedger
      // creditet nur bei status==='approved', verifiziert) → die App zeigt
      // „Bon wird geprüft". Trigger: Self-Consistency-Confidence der Robust-OCR
      // ist nicht 'high' (medium/low/none) ODER die Forensik markiert das Bild
      // als bearbeitet (suspiciousSoftware, Photoshop/GIMP-EXIF). Der berechnete
      // cashbackCents bleibt erhalten; resolveCashbackReview gibt später frei
      // (→ approved + Gutschrift) oder lehnt ab. Rejected/no_reward bleiben
      // unverändert — durch DIESES Gate wird KEIN Bon abgelehnt.
      let reviewReason = null;
      // Ergebnis der feldweisen Prüfung — landet am Bon, damit die Wirkung des
      // Gates messbar ist und eine Stichprobe nachvollziehen kann, worauf die
      // Freigabe beruhte.
      let ocrFieldAgreement = null;
      if (status === 'review' && bonDateFuture) reviewReason = 'bon_date_future';
      // Money-Ops-Review 02.09.: das Gate darf einen bereits gutgeschriebenen
      // oder per Resolver freigegebenen Bon NIE wieder halten — sonst würde eine
      // PubSub-Redelivery (Cache-Pfad trägt jetzt robust) die Gutschrift über
      // syncLedgerForReceipt(status='review') stornieren (Selbststorno-Klasse).
      // Eine ABLEHNUNG durch einen Menschen wird nie automatisch überstimmt.
      // Sie wirkt VOR dem Halte-Block, nicht als Übersprung: wer den Block
      // überspringt, umgeht auch die Forensik-Bremse darin — dann führte eine
      // erneute Zustellung eines von Hand abgelehnten Bons zu Status
      // 'approved' und `syncLedgerForReceipt` bucht erneut (der stornierte
      // Earn steht auf netto 0, der Zweig legt einen neuen an).
      // Unabhängig davon, was die Neuberechnung ergibt: hat ein Mensch abgelehnt
      // oder auf „ohne Prämie" gesetzt, gilt sein Beschluss. Vorher hing dieser
      // Zweig am neu berechneten Status 'approved' — ergab die Neuberechnung
      // etwas anderes (etwa 'review' wegen niedriger Bewertung), lief der Bon
      // an der Wiederherstellung vorbei und landete wieder in der Warteschlange.
      if (receipt.reviewDecision === 'reject' || receipt.reviewDecision === 'no_reward') {
        // Den Endzustand des Menschen WIEDERHERSTELLEN, nicht auf 'review'
        // setzen: 'review' machte die Ablehnung wieder zu einer offenen Frage,
        // der Fall käme erneut in die Warteschlange und die App zeigte dem
        // Nutzer wieder „wird geprüft". Fürs Ledger ist beides gleich (kein
        // wantApproved, also Storno bzw. nichts) — für Warteschlange und App
        // nicht.
        status = receipt.reviewDecision === 'no_reward' ? 'no_reward' : 'rejected';
        reviewReason = null;
        cashbackCents = 0;
        if (!rejectReason && status === 'rejected') rejectReason = receipt.rejectReason || 'manual_review_rejected';
      }

      // Laufzeitgrenze (03.10.2026): ab hier schreibt der Lauf Entscheidungen.
      laufzeitPruefen(laufStart, 'Zweitprüfung/Buchung');

      // 6v) Zweitprüfung anfordern, Durchlauf 1 (86cbfvwge). Würde der Bon
      // wegen eines LESE-abhängigen Grunds abgelehnt, obwohl die Mehrfach-
      // Lesung sich nicht sicher war, entscheidet vorher ein stärkeres Modell.
      // Hier wird nur angefordert: Anfrage am Bon ablegen (volles `ocr`-Feld,
      // damit der nächste Lauf garantiert den Cache-Pfad nimmt), neu
      // zustellen, fertig. Bis dahin wurde nichts geschrieben — kein Ledger,
      // kein Mirror; die App zeigt weiter „Bon wird geprüft".
      // Die Regeln (wann, wann nicht) stehen in lib/refereePolicy.js.
      // Liegt überhaupt ein gelesenes Datum in der Frist? Nur dann kann eine
      // Prüfung an `bon_too_old` etwas ändern (sie wählt nur zwischen
      // gelesenen Daten). Dieselbe Jahres-Plausibilisierung wie oben.
      const gelesenesAlter = (Array.isArray(ocr.robust?.reads) ? ocr.robust.reads : [])
        .filter((r) => r && r.isReceipt !== false && r.bonDate)
        .map((r) => bonAgeDays(plausibilizeBonDate(r.bonDate, uploadedAt).bonDate, uploadedAt.getTime()));
      const einDatumInFrist = gelesenesAlter.length
        ? gelesenesAlter.some((a) => a != null && a <= effectiveMaxAgeDays)
        : null;
      const refereeAnfrage = shouldRequestReferee({
        mode: config.ocrReferee,
        status,
        rejectReason,
        confidence: ocr.robust?.confidence ?? null,
        reads: ocr.robust?.reads,
        parsed: ocr.parsed,
        reviewDecision: receipt.reviewDecision ?? null,
        alreadyCredited,
        hasRequest: Boolean(ocr.refereeRequest || receipt.ocr?.refereeRequest),
        hasReferee: Boolean(ocr.referee || receipt.ocr?.referee),
        einDatumInFrist,
      });
      if (refereeAnfrage.request) {
        ocr.refereeRequest = {
          requestedAt: admin.firestore.Timestamp.now(),
          reason: rejectReason,
          confidence: ocr.robust?.confidence ?? null,
          grund: refereeAnfrage.grund,
          mode: refereeMode(config.ocrReferee),
        };
        // Transaktional und nur, wenn noch keine Prüfung angefordert/abgelegt
        // ist — sonst zwei Anfragen und zwei bezahlte Prüfungen, wenn zwei
        // Läufe parallel hier ankommen (Review 14.09.). Die Jahres-Korrektur
        // mit ablegen: `parsed.bonDate` ist oben schon korrigiert, im zweiten
        // Durchlauf gäbe es sonst nichts mehr zu korrigieren und der Vermerk
        // ginge verloren. Ohne .catch: schlägt das Ablegen fehl, greift der
        // normale Retry — lieber noch einmal als eine Anfrage ohne Spur.
        // Zwischenstand + Fortsetzungs-Zähler einer verteilten Leiter sind mit
        // der fertigen Lesung erledigt — auch dann, wenn das frühe Speichern
        // oben scheiterte (sonst übersprang Durchlauf 2 den Bon als
        // 'fortsetzung_laeuft', bis der Kehrlauf kam; Gegenprüfung 03.10.).
        const anfrageGeschrieben = await writeOcrIfNoReferee(docRef, {
          ocr: buildOcrField(ocr, recon, escalation),
          ...(bonDateCorrection ? { bonDateCorrection } : {}),
          ocrZwischenstand: admin.firestore.FieldValue.delete(),
          ocrFortsetzungen: admin.firestore.FieldValue.delete(),
          updatedAt: now,
        });
        if (anfrageGeschrieben === 'ueberholt') {
          logger.warn('referee-request-ueberholt', { cashbackId });
          return;
        }
        await pubsub.topic(PUBSUB_TOPIC).publishMessage({
          json: { cashbackId, uid },
          attributes: { uid, cashbackId },
        });
        logger.info('referee-requested', {
          cashbackId,
          reason: rejectReason,
          confidence: ocr.robust?.confidence ?? null,
          grund: refereeAnfrage.grund,
        });
        return;
      }

      if (status === 'approved' && !alreadyCredited && receipt.reviewDecision !== 'approve') {
        // Hat die Zweitprüfung den Bon entschieden, ist er nicht mehr
        // abgelehnt — die AUSZAHLUNG läuft aber durch dasselbe Gate wie jeder
        // andere unsichere Bon: Bewertung `medium`, feldweise Prüfung über die
        // Zeugen der Zweitprüfung. Bewusst NICHT `high` (Review 14.09.): zwei
        // Lesungen desselben Modells sind korreliert, und sonst würden gerade
        // die schwächsten Erstlesungen am wenigsten geprüft und am Notaus
        // `ocrFieldGate` vorbei ausgezahlt. Mit `ocrFieldGate: true` gibt das
        // Gate sie automatisch frei, im Beobachtungs-Modus hält es sie.
        const refereeEntschied = ocr.referee?.applied === true && ocr.referee?.verdict === 'decided';
        const conf = refereeEntschied ? 'medium' : ocr.robust?.confidence || null;
        const feldLesungen = refereeEntschied
          // Genau das Zeugen-Paar, auf dem die Entscheidung beruht — eine
          // dritte, als unplausibel verworfene Lesung darf das Gate nicht kippen.
          ? (Array.isArray(ocr.referee.reads) && Array.isArray(ocr.referee.paar)
            ? ocr.referee.paar.map((i) => ocr.referee.reads[i]).filter(Boolean)
            : null)
          : ocr.robust?.reads;
        const editedImage = receipt.capture?.forensicFlags?.suspiciousSoftware === true;

        // 86cbet2w1 — die Bewertung der Robust-OCR entsteht aus dem Vergleich
        // der ARTIKELSEQUENZ. Bei 30 bis 70 Positionen kippt sie schon eine
        // abweichend gelesene Bezeichnung, obwohl an Markt, Datum, Endsumme und
        // Betrag nichts wackelt. Gemessen über 30 Tage: 137 Bons gehalten, 120
        // davon später von Hand freigegeben, 2 abgelehnt — beide wegen
        // Doppeleinreichung, die die Dedup-Prüfung ohnehin fängt.
        //
        // Deshalb: bei `low`/`medium` zusätzlich feldweise nachsehen. Stimmen
        // Markt, Datum, Endsumme und Betrag über mindestens zwei in sich
        // stimmige Lesungen überein, wird freigegeben. `none` hält IMMER — dort
        // besteht keine einzige Lesung ihre eigene Summenprobe, und ein
        // fehlendes `robust` heißt, die Erkennung ist gar nicht gelaufen.
        //
        // Notaus ohne Deploy: `cashback_config/v1.ocrFieldGate`. Steht es auf
        // `false`, gilt bitgenau das alte Verhalten. `loadConfig()` läuft
        // ohnehin bei jedem Bon, das kostet keinen zusätzlichen Read.
        // Drei Zustände: false = altes Verhalten, 'shadow' = rechnen und ans
        // Dokument schreiben, aber die Entscheidung NICHT ändern, true = wirksam.
        // Der Beobachtungs-Modus ist der einzige Weg, die Wirkung an echten Bons
        // zu sehen, bevor Geld daran hängt — `robust.reads` entsteht erst mit
        // diesem Stand, an historischen Bons lässt sich nichts messen.
        const gateSchalter = config.ocrFieldGate;
        const feldGateAn = gateSchalter === true || gateSchalter === 'shadow';
        const feldGateWirkt = gateSchalter === true;
        let felder = null;
        if (feldGateAn && (conf === 'low' || conf === 'medium') && Array.isArray(feldLesungen)) {
          // Marktnamen ÜBER DEN RESOLVER vergleichen, nicht über den Rohtext:
          // „REWE" und „REWE Markt GmbH" sind derselbe Markt. Die Auflösung ist
          // asynchron, deshalb hier vorab je eindeutigem Namen einmal — bei
          // zwei bis drei Lesungen sind das ein bis zwei Aufrufe gegen den
          // modulweit zwischengespeicherten Discounter-Index.
          const namen = [...new Set(feldLesungen.map((r) => r.merchant ?? null))];
          const schluessel = new Map();
          for (const nm of namen) {
            let key = `roh:${String(nm || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
            try {
              const t = await resolveMerchant(nm, ocr.parsed?.bonCountry ?? null);
              if (t && t.id) key = `id:${t.id}`;
            } catch (e) {
              logger.warn('field-agreement-merchant-failed', { cashbackId, err: e.message });
            }
            schluessel.set(nm, key);
          }
          felder = moneyFieldAgreement(feldLesungen, {
            merchantKey: (m) => schluessel.get(m ?? null) ?? null,
            // Derselbe Betragsweg wie oben — ein Unterschied in der Artikelzahl
            // zählt nur, wenn er den Betrag verändert (Pfand wird über den
            // NAMEN erkannt, eine andere Lesung kann die Zahl also verschieben).
            // Denselben Weg nehmen, den auch das Geld nimmt: mit Aktion die
            // Aktions-Rechnung, ohne Aktion die Stufen aus der Konfiguration.
            // Nur die Mindest-Artikelzahl zu prüfen ließe einen Unterschied
            // durch, der zwischen zwei Stufen liegt und sehr wohl Geld kostet.
            betragFuer: (n) => (selectedCampaign
              ? campaignRewardCents(n, selectedCampaign, config)
              : tierFor(n, config.tiers)),
          });
        }

        const felderTragen = felder != null && felder.ok === true;
        // Fehlt die Bewertung ganz, hängt es an der Engine: `gemini-robust`
        // liefert sie immer — fehlt sie dort, ist die Erkennung nicht gelaufen
        // und der Bon gehört geprüft. Die Rückfall-Engine `cv-hybrid` kennt
        // dagegen konstruktionsbedingt gar keine Bewertung; würde ein fehlendes
        // Feld dort als Verlust gelten, hielte ein Engine-Rollback SÄMTLICHE
        // Bons zurück.
        // Auf den GELAUFENEN Pfad prüfen, nicht auf die Engine des Endergebnisses:
        // die DocAI-Eskalation ersetzt `ocr` komplett (engine 'docai', `robust`
        // verschwindet), und die Rückfall-Engine 'cv-hybrid' kennt gar keine
        // Bewertung. Beides darf nicht als „Bewertung fehlt" gelten.
        const engineLiefertBewertung = OCR_ENGINE !== 'cv-hybrid' && (ocr.engine || OCR_ENGINE) !== 'docai';
        // Auch diese Verschärfung hängt am Schalter: steht `ocrFieldGate` auf
        // `false`, verhält sich der Block bitgenau wie vor dem Umbau. Ein
        // Notaus, der nur die Hälfte zurücknimmt, ist keiner.
        // Auch im Beobachtungs-Modus rechnen, aber nur im Dauer-Modus wirken —
        // sonst bliebe ausgerechnet die einzige Verschärfung ungemessen.
        const bewertungFehltErkannt = feldGateAn && conf == null && engineLiefertBewertung;
        const bewertungFehlt = feldGateWirkt && bewertungFehltErkannt;
        const haltenWegenLesung = conf === 'none' || bewertungFehlt
          ? true
          : conf === 'high' || conf == null
            ? false
            : feldGateWirkt
              ? !felderTragen
              : true; // Beobachtungs-Modus: rechnen, aber wie bisher halten

        if (haltenWegenLesung || editedImage) {
          status = 'review';
          reviewReason = editedImage ? 'forensics_software' : `ocr_confidence_${conf}`;
        }
        if (felder) {
          ocrFieldAgreement = {
            ok: felder.ok, zeugen: felder.zeugen, konflikte: felder.konflikte,
            confidence: conf, modus: feldGateWirkt ? 'wirksam' : 'beobachtung',
            // Was das Gate im Dauer-Modus entschieden HÄTTE — die Zahl, an der
            // sich vor dem Scharfschalten ablesen lässt, was passieren wird.
            haetteFreigegeben: felder.ok === true,
          };
        }
      }

      // 6y2) Überholt? (Review 14.09., zwei Runden) Steht am Dokument
      // inzwischen ein Prüf-Ergebnis, das dieser Lauf nicht kennt — oder eine
      // Anfrage, obwohl dieser Lauf von gar keiner Prüfung weiß —, hat ein
      // paralleler Lauf mit neuerem Stand übernommen. Dieser Lauf rechnete mit
      // der alten Lesung; bucht er jetzt, könnte er eine von der Prüfung
      // entschiedene Gutschrift stornieren. Ein Lesevorgang pro Bon.
      {
        const aktuell = (await docRef.get()).data()?.ocr;
        const fremdesErgebnis = Boolean(aktuell?.referee) && !ocr.referee;
        const fremdeAnfrage = Boolean(aktuell?.refereeRequest) && !ocr.refereeRequest && !ocr.referee;
        if (fremdesErgebnis || fremdeAnfrage) {
          logger.warn('ledger-ueberholt-von-zweitpruefung', { cashbackId, status });
          return;
        }
      }

      // Zweite Prüfung direkt vor der Buchung (dazwischen liegen Lesevorgänge).
      laufzeitPruefen(laufStart, 'Buchung');

      // 6z) Ledger + Budget ATOMAR verbuchen — VOR dem Mirror/Receipt-Write,
      // weil die Budget-Deckelung in der Transaktion den Betrag (und damit
      // den Status) noch ändern kann. Idempotent per receiptId.
      const userRef = db.doc(`users/${uid}`);
      const campaignMode = config.campaignsEnabled && !!selectedCampaign;
      let settle;
      try {
        settle = await syncLedgerForReceipt(
          userRef,
          cashbackId,
          status,
          cashbackCents,
          ocr.parsed.bonDate,
          selectedCampaign?.id || null,
          campaignMode,
          {
            weeklyBonCap: campaignMode ? Number(selectedCampaign.weeklyBonCap) || 0 : 0,
            maxPerUserCents: campaignMode ? Number(selectedCampaign.maxPerUserCents) || 0 : 0,
            monthlyMaxCents: !campaignMode ? Number(config.monthlyMaxCents) || 0 : 0,
            dailyCap: Number(config.dailyCap) || 0,
            legacyFallback: config.dailyCapLegacyFallback !== false,
          },
          // Reverse-Kandidat: das GESPEICHERTE Bon-Datum (Backfill-Schlüssel),
          // falls die frische OCR-Lesung ein anderes Datum liefert.
          // bon/doppel: Doppel-Schutz in der Buchung (04.10.2026).
          {
            extraDays: [receipt.bonDate],
            bon: bonIdentitaet({
              merchantId: merchantInfo?.id,
              bonDate: ocr.parsed.bonDate,
              totalCents: ocr.parsed.totalCents,
              bonTime: ocr.parsed.bonTime,
              items: ocr.parsed.items,
              bestellnummer: ocr.parsed.bestellnummer,
              // Regel seite (Prüfrunde 2): Seiten einer Online-Rechnung.
              online: Boolean(onlineMerkmal(ocr.parsed)),
              summeAusArtikeln: ocr.parsed.summeAusArtikeln === true,
            }),
            doppel: doppelModi(config),
          },
        );
      } catch (e) {
        // Eine gescheiterte Ledger-Transaktion ist Infrastruktur, keine Aussage
        // über den Bon (seit 02.10.2026 liest sie auch die Kontosperre mit).
        // Bisher endete sie nach MAX_PROCESS_ATTEMPTS als 'rejected /
        // max_retries_exceeded' — ein normaler Nutzer verlor damit seinen Bon
        // wegen einer Störung. Mit eigenem Code landet sie stattdessen auf
        // 'review' (Mensch), wie ocr_unavailable und ledger_precheck_failed.
        const err = new Error(`ledger tx failed: ${e.message}`);
        err.code = 'ledger_tx_failed';
        throw err;
      }
      // Doppel-Schutz (04.10.2026): derselbe Bon ist schon bezahlt — dieselbe
      // Ablehnung wie bei der Inhaltsprüfung (Schritt 5b), nur in der Buchung
      // erkannt (gleichzeitiger Lauf, andere Lesung der Summe, Teilfoto).
      // Keine Positionen (duplicate* steht nicht in RELIABLE_REJECT_REASONS),
      // kein Push (frischGebucht ist false).
      if (settle.doppelTreffer && settle.doppelTreffer.length) {
        for (const t of settle.doppelTreffer) {
          // Nie eine fremde uid loggen; die fremde Bon-ID nur bei derselben Person.
          logger.warn('doppel-treffer', {
            cashbackId,
            regel: t.regel,
            modus: t.modus,
            sameUser: t.sameUser,
            gegen: t.sameUser ? t.gegen : null,
            anteil: t.anteil ?? null,
            // Prüfrunde 3: in der Beobachtung getrennt auswerten.
            andererMarkt: t.andererMarkt === true,
            abstand: t.abstand ?? null,
          });
        }
      }
      if (status === 'approved' && settle.doppel && settle.doppel.modus === 'wirksam') {
        status = 'rejected';
        rejectReason = settle.capReason || doppelGrund(settle.doppel);
        cashbackCents = 0;
        duplicateOf = {
          receiptId: settle.doppel.gegen,
          sameUser: settle.doppel.sameUser,
          priorStatus: 'approved',
          kind: settle.doppel.regel,
        };
      }
      // Transaktion hat den Betrag gedeckelt (Budget leer, ein Limit race-frei
      // erkannt ODER das Konto gesperrt) → Betrag + Status korrigieren, damit
      // Mirror/Receipt das echte Ergebnis zeigen (kein „approved +X" ohne
      // Gutschrift). Bei gesperrtem Konto: no_reward / konto_gesperrt.
      if (status === 'approved' && settle.creditedCents !== cashbackCents) {
        cashbackCents = settle.creditedCents;
        if (cashbackCents === 0) {
          status = 'no_reward';
          rejectReason = settle.capReason || 'campaign_budget_exhausted';
        }
      }

      // 6a) Mirror the status into the user sub-collection (so the
      // app's pending screen can listen without top-level rules).
      // Includes items + the bucket+path of the bon image so the
      // client can resolve a download URL via Firebase Storage SDK
      // (storage rules permit the owner to read their own bons —
      // simpler + more reliable than admin-side signed URLs which
      // need iam.serviceAccountTokenCreator on the runtime SA).
      const slimItems = Array.isArray(ocr.parsed.items)
        ? ocr.parsed.items.map((it) => ({
            name: String(it.name ?? ''),
            qty: Number.isFinite(it.qty) ? it.qty : 1,
            priceCents: Number.isFinite(it.priceCents) ? it.priceCents : 0,
            eligible: Number.isFinite(it.priceCents) && it.priceCents > 0 && !isPfandItem(it),
          }))
        : [];

      await db
        .doc(`users/${uid}/cashback_status/${cashbackId}`)
        .set(
          {
            status,
            receiptId: cashbackId,
            cashbackCents,
            tierApplied: cashbackCents,
            eligibleItemCount,
            merchantRaw: ocr.parsed.merchant ?? null,
            // Filiale laut Bon (05.09.2026) — schlank für die App: Ort + PLZ.
            storeCity: store?.city ?? null,
            storeZip: store?.zip ?? null,
            // Nur was die App zeigen muss: wurde die Aktion regional gewechselt.
            campaignRegionSwitched: targeting?.korrigiert === true ? true : null,
            merchantId: merchantInfo?.id ?? null,
            discounterId: merchantInfo?.discounterId ?? null, // 86ca0wbg7
            merchantName: merchantInfo?.name ?? null,
            merchantDisplayName: merchantInfo?.displayName ?? null,
            merchantLogoUrl: merchantInfo?.logoUrl ?? null,
            merchantLand: merchantInfo?.land ?? null,
            merchantMatchVia: merchantInfo?.matchVia ?? null,
            bonCountry: ocr.parsed.bonCountry ?? null,
            bonDate: ocr.parsed.bonDate || null,
            bonAgeDays: ageDays,
            // 86ca0wbg7: angewandte Max-Alter-Grenze (Tage) → die App zeigt die
            // ECHTE Grenze statt einer hardcodierten Zahl. Seit dem Go-Live ist
            // der globale Default 7 (Entscheidung 05.09.2026: 7 Tage, endgültig)
            // — der frühere Guard „nur wenn strenger als global" ließ die App
            // bei jedem bon_too_old ohne Zahl dastehen. Immer die Grenze senden.
            maxAgeDays: effectiveMaxAgeDays,
            bonTotalCents: ocr.parsed.totalCents ?? null,
            items: slimItems,
            storageBucket: receipt.storage?.bucket ?? null,
            storagePath: receipt.storage?.path ?? null,
            reconciliationDeltaCents: recon.deltaCents ?? null,
            reconciliationDirection: recon.direction ?? null,
            ocrEngine: ocr.engine ?? null,
            escalation: escalation?.fired ? escalation : null,
            // Mirror only carries minimal duplicate info — never the
            // foreign user's id (privacy).
            duplicate: duplicateOf
              ? { sameUser: duplicateOf.sameUser, priorReceiptId: duplicateOf.sameUser ? duplicateOf.receiptId : null }
              : null,
            rejectReason,
            rejectDetail: rejectDetail ?? null,
            // Prompt v1.5: kassenbon | app_kassenbon | online_bestellung | sonstiges.
            belegart: ocr.parsed.belegart ?? null,
            updatedAt: now,
          },
          { merge: true },
        );

      // 7) Write authoritative doc to top-level /receipts/*
      await docRef.update({
        status,
        rejectReason,
        rejectDetail: rejectDetail ?? null,
        reviewReason,
        // Worauf die Freigabe-Entscheidung beruhte, wenn die Sequenz-Bewertung
        // allein nicht gereicht hätte (86cbet2w1). Null, solange das Gate nicht
        // greifen musste — dann entschied die Bewertung wie bisher.
        ocrFieldAgreement,
        ocr: buildOcrField(ocr, recon, escalation),
        // Falls das frühe Speichern oben scheiterte, steht er noch da.
        ...(receipt.ocrZwischenstand || receipt.ocrFortsetzungen != null
          ? { ocrZwischenstand: admin.firestore.FieldValue.delete(), ocrFortsetzungen: admin.firestore.FieldValue.delete() }
          : {}),
        merchant: merchantInfo
          ? {
              id: merchantInfo.id,
              // 86ca0wbg7: echte discounter-DocID (= produkte.discounter) + Land,
              // direkt im merchant-Objekt des Haupt-Bon-Docs.
              discounterId: merchantInfo.discounterId ?? null,
              land: merchantInfo.land ?? null,
              name: merchantInfo.name,
              raw: ocr.parsed.merchant ?? null,
              matchedScore: 1,
            }
          : ocr.parsed.merchant
          ? { id: 'unknown', raw: ocr.parsed.merchant, matchedScore: 0 }
          : null,
        bonDate: ocr.parsed.bonDate || null,
        // Eine im ersten Durchlauf (oder früheren Lauf) abgelegte Jahres-
        // Korrektur bleibt stehen: `parsed.bonDate` ist dann schon korrigiert,
        // dieser Lauf hat nichts mehr zu korrigieren. Ersetzt die Zweitprüfung
        // die Lesung, gilt deren Datum — der alte Vermerk passt nicht mehr.
        bonDateCorrection: bonDateCorrection
          ?? (cachedOcr && !lesungErsetzt ? receipt.bonDateCorrection ?? null : null),
        // Welche Aktion galt regional und warum (06.09.2026). null, solange
        // keine laufende Aktion ein Gebiet einschränkt.
        targeting: targeting ?? null,
        aktionZeitKorrektur: aktionZeitKorrektur ?? null,
        // Die vom Server angewandte Aktion (nach Monatswechsel-/Regionskorrektur).
        // Der Prüf-Resolver bucht gegen DIESE, nicht gegen die Wahl der App.
        campaignIdAngewandt: config.campaignsEnabled ? (selectedCampaign?.id ?? null) : null,
        // Filialadresse laut Bon-Kopf (05.09.2026): {street, zip, city,
        // country, source: 'ocr'|'subtitle'|'merchant', complete}. Unabhängig
        // vom Merchant-Resolver — auch ein unbekannter Markt hat eine Anschrift.
        store: store ?? null,
        bonTime: ocr.parsed.bonTime || null,
        bonTotalCents: ocr.parsed.totalCents ?? null,
        contentHash: contentHash ?? null,
        transactionHash: transactionHash ?? null,
        itemsHash: itemsHash ?? null,
        duplicateOf: duplicateOf ?? null,
        // Doppel-Schutz in der Buchung (04.10.2026): was geprüft wurde und was
        // getroffen hätte bzw. hat — auch im Beobachtungs-Modus. Nur wenn die
        // Buchung geprüft hat (erste Gutschrift); eine erneute Zustellung lässt
        // den Vermerk stehen.
        ...(settle.doppelGeprueft
          ? {
              doppelPruefung: {
                modi: modiVermerk(doppelModi(config)),
                treffer: settle.doppelTreffer,
                at: admin.firestore.Timestamp.now(),
              },
            }
          : {}),
        // Prompt v1.5: Belegart und ob der Bon vollständig im Bild ist (vorerst
        // nur gemessen, ohne Wirkung).
        belegart: ocr.parsed.belegart ?? null,
        bonVollstaendig: typeof ocr.parsed.bonComplete === 'boolean' ? ocr.parsed.bonComplete : null,
        items: Array.isArray(ocr.parsed.items)
          ? ocr.parsed.items.map((it) => ({
              raw: it.name,
              qty: it.qty ?? 1,
              priceCents: it.priceCents,
              eligible: Number.isFinite(it.priceCents) && it.priceCents > 0 && !isPfandItem(it),
            }))
          : [],
        eligibleItemCount,
        tierApplied: cashbackCents,
        cashbackCents,
        'storage.sizeBytes': sizeBytes,
        updatedAt: now,
      });

      // 7a) Produkt-Tracking: jeder gültige Bon (approved/no_reward) schreibt
      // seine Positionen fürs Matching/Tracking. ZUSÄTZLICH (86caf62v6, B2B):
      // valide-aber-abgelehnte Bons (zu alt / Markt unbekannt / zu wenige
      // Positionen) werden AUCH erfasst — mit rewardEligible=false, damit sie
      // für die spätere B2B-Produktauswertung verfügbar sind. Geld/Ledger bleibt
      // unberührt (nur approved bekommt Cashback); der Matcher überspringt
      // rewardEligible=false beim Auto-Match (keine Journey-/Geld-Side-Effects).
      // Nutzer-Region fortschreiben (06.09.2026): Die Filialadresse eines Bons
      // ist die einzige belegte Regionsangabe, die wir von einem Nutzer haben —
      // 84 % der Bons tragen sie, aber nur 4 % der Profile eine Ortsangabe und
      // kein einziges eine PLZ. Aus ihr steuern sich später auch Produktfoto-
      // und Umfrage-Aktionen, die selbst keine PLZ liefern. Fire-and-forget:
      // ein Fehler hier darf einen Bon nie aufhalten.
      if (store?.zip && uid) {
        void db.doc(`users/${uid}`).set({
          region: {
            zip: store.zip,
            city: store.city ?? null,
            country: store.country ?? null,
            source: 'bon',
            receiptId: cashbackId,
            at: now,
          },
        }, { merge: true }).catch((e) => logger.warn('user-region-write-failed', { uid, err: e.message }));
      }

      const rewardEligible = status === 'approved' || status === 'no_reward';
      const captureProducts =
        rewardEligible || (status === 'rejected' && RELIABLE_REJECT_REASONS.has(rejectReason));
      if (captureProducts) {
        await writePurchasedProducts(uid, cashbackId, ocr.parsed, merchantInfo, {
          status,
          rejectReason,
          rewardEligible,
        });
      }

      if (status === 'approved' && cashbackCents > 0 && settle.frischGebucht) {
        // 8) Push — echt, seit b00c71a (Mai 2026). Der alte Kommentar an
        //    dieser Stelle sagte „stub-logs" und stimmte danach nie wieder;
        //    wer nur ihn las, hielt den Aufruf für wirkungslos (86cbfdq5j).
        //    `settle.frischGebucht` (24.09.2026) statt des vorab gelesenen
        //    `alreadyCredited`: nur der Lauf, dessen Transaktion den Earn
        //    geschrieben hat, meldet sich. Zwei gleichzeitige Läufe sahen beide
        //    „noch nicht gebucht" und schickten beide. Dazu setzt
        //    sendCashbackReady einen Merker am Bon (lib/pushMerker.js). Brach
        //    ein früherer Lauf NACH der Buchung, aber VOR dem Push ab, fehlt die
        //    Nachricht — die fehlende ist der kleinere Schaden.
        //    Das `.catch` hält jeden Push-Fehler aus dem Geld-Zweig heraus: ein
        //    Wurf hier würde sonst im umgebenden try landen und einen längst
        //    gutgeschriebenen Bon in die Wiederholung schicken.
        await sendCashbackReady(uid, {
          cashbackId,
          cents: cashbackCents,
          markt: merchantInfo?.name,
          schwelle: config?.payoutThresholdCents,
        }).catch((e) => logger.warn('cashback-push-failed', { cashbackId, err: e.message }));
      }

      logger.info('process-done', {
        cashbackId,
        status,
        engine: ocr.engine,
        latencyMs: ocr.latencyMs,
        cvLatencyMs: ocr.cvLatencyMs ?? null,
        geminiLatencyMs: ocr.geminiLatencyMs ?? null,
        cashbackCents,
        eligibleItemCount,
        deltaCents: recon.deltaCents,
        signedDeltaCents: recon.signedDeltaCents,
        direction: recon.direction,
        escalated: escalation?.fired ? escalation.swapped : false,
        duplicateOfReceiptId: duplicateOf?.receiptId ?? null,
        duplicateSameUser: duplicateOf?.sameUser ?? null,
      });
    } catch (err) {
      // 86ca0wbg7 (A): transienten Fehler NICHT voreilig als 'rejected' zeigen
      // (sonst sieht der User „abgelehnt", obwohl gleich ein Retry läuft). Nur
      // attempts/lastError tracken + werfen → PubSub redelivert; der Retry nutzt
      // die bereits persistierte OCR (kein erneuter Gemini-Call). Erst nach
      // MAX_PROCESS_ATTEMPTS endgültig ablehnen (poison message) → kein weiterer
      // (teurer) Retry bis zur PubSub-TTL.
      const attempts = (receipt.attempts || 0) + 1;
      const lastError = String(err && err.message ? err.message : err).slice(0, 300);
      logger.error('process-failed', { cashbackId, err: err.message, attempts, code: err?.code ?? null });
      // Ist die OCR-Leiter ohne eine einzige Lesung zu Ende gegangen, ist ein
      // abgelegter Zwischenstand verbraucht — der nächste Versuch liest frisch.
      // Mit ihm geht der Fortsetzungs-Zähler — die nächste Leiter ist eine neue,
      // und attempts (hier hochgezählt) begrenzt die Zahl der Leitern.
      const zwischenstandWeg = err && err.code === 'ocr_unavailable' && !err.zwischenstandBehalten
        && (receipt.ocrZwischenstand || receipt.ocrFortsetzungen != null)
        ? { ocrZwischenstand: admin.firestore.FieldValue.delete(), ocrFortsetzungen: admin.firestore.FieldValue.delete() }
        : {};
      if (attempts >= MAX_PROCESS_ATTEMPTS) {
        // Incident 19.08.2026: War die OCR-Infrastruktur down (ocr_unavailable —
        // alle Lesungen geworfen, z.B. 429 Spending-Cap), wurde der Bon NIE
        // angesehen → niemals endgültig ablehnen. Auf 'review' halten; die App
        // zeigt „wird geprüft", Auflösung per Reprocessing (ocr-Feld leeren +
        // republishen) oder resolveCashbackReview. Nur echte Poison-Messages
        // (Bild kaputt, Parser-Crash) enden weiterhin als 'rejected'.
        // `lauf_zeitgrenze` (03.10.2026): der Lauf war zu langsam, um noch zu
        // entscheiden — ebenfalls keine Aussage über den Bon.
        const infraCode =
          err && (err.code === 'ocr_unavailable' || err.code === 'ledger_precheck_failed' || err.code === 'referee_unavailable' || err.code === 'ledger_tx_failed' || err.code === 'lauf_zeitgrenze' || err.code === 'ocr_zeitbudget')
            ? err.code
            : null;
        const infra = !!infraCode;
        const finalDoc = infra
          ? { status: 'review', reviewReason: infraCode, attempts, lastError, updatedAt: now, ...zwischenstandWeg }
          : { status: 'rejected', rejectReason: 'max_retries_exceeded', attempts, lastError, updatedAt: now };
        const finalMirror = infra
          ? { status: 'review', reviewReason: infraCode, attempts, updatedAt: now }
          : { status: 'rejected', rejectReason: 'max_retries_exceeded', attempts, updatedAt: now };
        await docRef.update(finalDoc).catch(() => {});
        await db
          .doc(`users/${uid}/cashback_status/${cashbackId}`)
          .set(finalMirror, { merge: true })
          .catch(() => {});
        return; // ack → stoppt den PubSub-Retry (kein throw)
      }
      // Unter dem Limit: in-progress lassen (Mirror NICHT auf 'rejected' setzen,
      // App zeigt weiter „wird geprüft"), nur Zähler/Fehler festhalten, dann
      // werfen → PubSub-Retry.
      await docRef.update({ attempts, lastError, updatedAt: now, ...zwischenstandWeg }).catch(() => {});
      throw err;
    }
}

// ─── requestPayout (HTTPS) ──────────────────────────────────────────
//
// Auszahlungs-Anfrage. Prüft die Schwelle serverseitig, debitiert das
// Guthaben TRANSAKTIONAL (race-/doppel-fest: die Transaktion auf userRef
// serialisiert konkurrierende Anfragen — die zweite liest die schon
// debitierte Balance und fällt unter die Schwelle) und legt an:
//   • cashback_payouts/{id} (status 'requested')
//   • users/{uid}/cashback_ledger/{id} (type 'payout')
// Die eigentliche Tremendous-Order-Erstellung passiert SPÄTER (separater
// Worker, der 'requested' → 'sent'/'delivered' flippt). KYC erledigt
// Tremendous bei der Order-Erstellung. Zahlt immer die GANZE Balance aus.
const VALID_PAYOUT_METHODS = ['paypal', 'giftcard', 'sepa'];

exports.requestPayout = onRequest(
  { region: REGION, timeoutSeconds: 30, memory: '256MiB', cors: true, invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ code: 'method_not_allowed' });
      return;
    }
    const decoded = await verifyAuthFromRequest(req);
    if (!decoded?.uid) {
      res.status(401).json({ code: 'unauthenticated' });
      return;
    }
    const uid = decoded.uid;
    // Auszahlen nur mit Konto (Umbau „erst einreichen, dann Konto", Schritt 9).
    // Gäste sammeln Guthaben, auszahlen kann erst, wer sich registriert hat.
    // Maßgeblich ist getUser().providerData, NIE der Token-Claim
    // sign_in_provider: direkt nach linkWithCredential kann er noch
    // 'anonymous' tragen. Die Rückbuchung in processPayout bleibt als zweite
    // Schranke. Scheitert die Prüfung technisch → 503, keine Buchung.
    const kontoFehler = await kontoPruefen(admin, uid, { emailPflicht: true });
    if (kontoFehler) {
      logger.info('payout-konto-abgelehnt', { uid, code: kontoFehler.body.code });
      res.status(kontoFehler.http).json(kontoFehler.body);
      return;
    }
    // Methode ist OPTIONAL — die konkrete Auszahlungsart wählt der User auf
    // der Tremendous-Hosted-Page. Kommt doch eine gültige mit, speichern
    // wir sie als Hinweis; sonst null.
    const rawMethod = String((req.body || {}).method || '');
    const method = VALID_PAYOUT_METHODS.includes(rawMethod) ? rawMethod : null;

    const config = await loadConfig();
    const threshold = Number.isFinite(config.payoutThresholdCents) ? config.payoutThresholdCents : 1000;
    // Gewünschter Teil-Betrag (optional). Fehlt/ungültig → ganze Balance.
    const requestedCents = Math.round(Number((req.body || {}).amountCents));

    // Kontosperre (Entscheidung Patrick 02.10.2026, lib/kontoSperre.js): IN der
    // Abbuchungs-Transaktion gelesen, damit eine gerade gesetzte Sperre nicht
    // zwischen Prüfung und Abbuchung durchrutscht. Lesefehler → fail-closed mit
    // wiederholbarem 503 (`sperre_unpruefbar`): keine Abbuchung, kein Payout-
    // Dokument, die App bittet um einen späteren Versuch. Merker pro Versuch
    // zurücksetzen — Firestore wiederholt den Callback bei Konflikten.
    let sperreLesefehler = false;
    try {
      const result = await db.runTransaction(async (tx) => {
        sperreLesefehler = false;
        const userRef = db.doc(`users/${uid}`);
        const userSnap = await tx.get(userRef);
        let sperreSnap;
        try {
          sperreSnap = await tx.get(sperreRef(db, uid));
        } catch (e) {
          sperreLesefehler = true;
          throw e;
        }
        if (istGesperrt(sperreSnap)) {
          return { error: GRUND_KONTO_GESPERRT };
        }
        const u = userSnap.exists ? userSnap.data() : {};
        const balance = u.cashback_balance_cents || 0;

        if (balance < threshold) {
          return { error: 'below_threshold', balanceCents: balance, thresholdCents: threshold };
        }

        // Betrag: gewünschter Teil-Betrag (auf Balance gedeckelt) oder ganze
        // Balance. Muss >= Schwelle sein. Debit passiert atomar im selben
        // tx → konkurrierende Anfragen werden serialisiert.
        let amountCents =
          Number.isFinite(requestedCents) && requestedCents > 0 ? Math.min(requestedCents, balance) : balance;
        if (amountCents < threshold) {
          return { error: 'below_min_amount', thresholdCents: threshold, balanceCents: balance };
        }
        const payoutRef = db.collection('cashback_payouts').doc();
        const ledgerRef = userRef.collection('cashback_ledger').doc();
        const ts = admin.firestore.FieldValue.serverTimestamp();

        tx.set(payoutRef, {
          userId: uid,
          amountCents,
          method,
          status: 'requested',
          kycPassed: false, // Tremendous übernimmt KYC bei Order-Erstellung
          createdAt: ts,
        });
        tx.set(ledgerRef, {
          type: 'payout',
          cents: amountCents,
          payoutId: payoutRef.id,
          balanceAfterCents: balance - amountCents,
          createdAt: ts,
        });
        tx.set(userRef, { cashback_balance_cents: balance - amountCents }, { merge: true });

        return { ok: true, payoutId: payoutRef.id, amountCents, method };
      });

      if (result.error === GRUND_KONTO_GESPERRT) {
        // Nur der Code, kein Guthaben/keine Schwelle in der Antwort. Die
        // ausgelieferte App zeigt für unbekannte Codes „Auszahlung konnte nicht
        // angefragt werden. Bitte versuch es später nochmal." — nichts Falsches.
        logger.warn('payout-konto-gesperrt', { uid });
        res.status(403).json({ code: GRUND_KONTO_GESPERRT });
        return;
      }
      if (result.error) {
        res.status(400).json({ code: result.error, ...result });
        return;
      }
      logger.info('payout-requested', { uid, payoutId: result.payoutId, amountCents: result.amountCents, method });
      res.status(200).json(result);
    } catch (e) {
      if (sperreLesefehler) {
        logger.error('payout-sperre-unpruefbar', { uid, err: e.message });
        res.status(503).json({ code: GRUND_SPERRE_UNPRUEFBAR });
        return;
      }
      logger.error('requestPayout-failed', { uid, err: e.message });
      res.status(500).json({ code: 'internal' });
    }
  },
);

// ─── processPayout (Tremendous) ─────────────────────────────────────
//
// Firestore-Trigger auf cashback_payouts/{id}. Erstellt für jede
// 'requested'-Anfrage eine Tremendous-ORDER mit delivery=EMAIL +
// campaign_id → Tremendous mailt dem User die fertige Redeem-Seite
// (User wählt DORT die Auszahlungsart, wir bauen keine UI dafür).
//
// Idempotent: external_id = payoutId → Tremendous dedupt; zusätzlich
// Status-Guard (nur 'requested' wird verarbeitet). Bei Fehler:
// Guthaben transaktional zurückbuchen (refund) + status 'failed'.
//
// PRODUCTION ist der DEFAULT — Sandbox NUR bei explizitem TREMENDOUS_ENV=sandbox.
// Bewusst fail-safe-to-production: ein Redeploy aus einem Clean-Checkout (ohne
// die gitignorierte .env), ein fehlendes/vertipptes env darf NIEMALS still auf
// Sandbox fallen und echte Auszahlungen brechen. Sandbox ist die deliberate
// Ausnahme (lokales Testen via TREMENDOUS_ENV=sandbox), nicht der Default.
// Go-Live-Härtung R3 (ClickUp 86caf62v6). TREMENDOUS_CAMPAIGN_ID überschreibt
// die Default-Campaign (Default ist bereits die Prod-Campaign).
const TREMENDOUS_SANDBOX = process.env.TREMENDOUS_ENV === 'sandbox';
const TREMENDOUS_BASE = TREMENDOUS_SANDBOX
  ? 'https://testflight.tremendous.com/api/v2'
  : 'https://api.tremendous.com/api/v2';
const TREMENDOUS_CAMPAIGN_ID = process.env.TREMENDOUS_CAMPAIGN_ID || 'FPJPQK8WTF8O';

/** Fehlgeschlagene Auszahlung → Guthaben transaktional zurückbuchen. */
async function refundFailedPayout(uid, payoutId, amountCents) {
  if (!uid || !amountCents) return;
  const userRef = db.doc(`users/${uid}`);
  await db.runTransaction(async (tx) => {
    // Idempotenz: nur zurückbuchen, wenn für diese payoutId noch kein
    // Refund existiert.
    const existing = await tx.get(
      userRef.collection('cashback_ledger').where('payoutId', '==', payoutId).where('type', '==', 'admin_adjust'),
    );
    if (!existing.empty) return;
    const userSnap = await tx.get(userRef);
    const balance = userSnap.exists ? userSnap.data().cashback_balance_cents || 0 : 0;
    tx.set(userRef.collection('cashback_ledger').doc(), {
      type: 'admin_adjust',
      cents: amountCents,
      payoutId,
      balanceAfterCents: balance + amountCents,
      reason: 'payout_failed_refund',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(userRef, { cashback_balance_cents: balance + amountCents }, { merge: true });
  });
}

/**
 * Schreibteil des Anhaltens: 'requested' → 'failed' und Guthaben zurück.
 * Läuft IN der Transaktion des Aufrufers, nachdem dieser alles gelesen hat
 * (Firestore: erst lesen, dann schreiben). Höchstens eine Rückbuchung je
 * payoutId — derselbe admin_adjust-Merker wie refundFailedPayout.
 */
function anhaltenSchreiben(tx, { payoutRef, payout, userRef, userSnap, ledgerCol, vorhandeneRueckbuchung, grund }) {
  const ts = admin.firestore.FieldValue.serverTimestamp();
  const amountCents = Number(payout.amountCents) || 0;
  tx.update(payoutRef, { status: 'failed', error: grund, updatedAt: ts });
  if (vorhandeneRueckbuchung.empty && amountCents > 0) {
    const balance = userSnap.exists ? userSnap.data().cashback_balance_cents || 0 : 0;
    tx.set(ledgerCol.doc(), {
      type: 'admin_adjust',
      cents: amountCents,
      payoutId: payoutRef.id,
      balanceAfterCents: balance + amountCents,
      reason: 'payout_failed_refund',
      anlass: grund,
      createdAt: ts,
    });
    tx.set(userRef, { cashback_balance_cents: balance + amountCents }, { merge: true });
  }
}

/** Liest, was anhaltenSchreiben braucht (in derselben Transaktion). */
async function anhaltenLesen(tx, uid, payoutRef) {
  const userRef = db.doc(`users/${uid}`);
  const ledgerCol = userRef.collection('cashback_ledger');
  const vorhandeneRueckbuchung = await tx.get(
    ledgerCol.where('payoutId', '==', payoutRef.id).where('type', '==', 'admin_adjust'),
  );
  const userSnap = await tx.get(userRef);
  return { userRef, ledgerCol, vorhandeneRueckbuchung, userSnap };
}

/**
 * Bestellung beanspruchen — Status, Kontosperre und Anspruch in EINER
 * Transaktion, bevor Tremendous gerufen wird (Entscheidung Patrick 02.10.2026
 * zur Sperre; Anspruch aus der Prüfrunde desselben Tages).
 *
 * Warum der Anspruch: Firestore stellt das Anlege-Ereignis mindestens einmal
 * zu, auch doppelt und parallel mit DERSELBEN Event-ID. Ohne Anspruch konnte
 * eine zweite Zustellung die Auszahlung anhalten (failed + Rückbuchung),
 * während die erste schon bei Tremendous bestellte und danach 'sent' schrieb —
 * Gutschein UND Guthaben. Mit Anspruch tut jede weitere Zustellung nichts,
 * auch eine mit derselben Event-ID (es gibt keine Wiederholung, die ihn
 * bräuchte: der Trigger läuft ohne retry).
 *
 * Der Anspruch steht als `bestellung: { eventId, seit }` am Dokument und
 * bleibt als Spur. Der Status bleibt 'requested' — die App kennt keinen
 * weiteren Wert („Wird vorbereitet"). Stirbt der Lauf zwischen Anspruch und
 * Bestellung, bleibt die Anfrage stehen wie vorher bei jedem Absturz; das
 * Dashboard zeigt sie nach 15 Minuten unter „hängt" (review-console
 * src/auszahlung.js).
 *
 * `merker.sperreLesefehler` sagt dem Aufrufer, ob ein Wurf vom Lesen der
 * Sperre kam (pro Versuch zurückgesetzt — Firestore wiederholt den Callback).
 *
 * @returns {Promise<'frei'|'nicht_offen'|'belegt'|'angehalten'>}
 */
async function auszahlungBeanspruchen(uid, payoutRef, eventId, merker) {
  return db.runTransaction(async (tx) => {
    merker.sperreLesefehler = false;
    const payoutSnap = await tx.get(payoutRef);
    if (!payoutSnap.exists || payoutSnap.data().status !== 'requested') return 'nicht_offen';
    const payout = payoutSnap.data();
    if (payout.bestellung) return 'belegt';
    if (uid) {
      let sperreSnap;
      try {
        sperreSnap = await tx.get(sperreRef(db, uid));
      } catch (e) {
        merker.sperreLesefehler = true;
        throw e;
      }
      if (istGesperrt(sperreSnap)) {
        const gelesen = await anhaltenLesen(tx, uid, payoutRef);
        anhaltenSchreiben(tx, { payoutRef, payout, ...gelesen, grund: GRUND_KONTO_GESPERRT });
        return 'angehalten';
      }
    }
    tx.update(payoutRef, {
      bestellung: { eventId: eventId || null, seit: admin.firestore.Timestamp.now() },
    });
    return 'frei';
  });
}

/**
 * Auszahlung anhalten, wenn der Anspruch selbst scheiterte (z. B. Sperre nicht
 * lesbar). Status FRISCH gelesen; angehalten wird nur eine Anfrage, die noch
 * 'requested' ist UND die kein anderer Lauf beansprucht hat — sonst könnte
 * diese Zustellung eine Auszahlung zurückbuchen, die der andere Lauf gerade
 * bei Tremendous bestellt.
 *
 * @returns {Promise<boolean>} true = angehalten
 */
async function auszahlungAnhalten(uid, payoutRef, grund) {
  return db.runTransaction(async (tx) => {
    const payoutSnap = await tx.get(payoutRef);
    if (!payoutSnap.exists) return false;
    const payout = payoutSnap.data();
    if (payout.status !== 'requested' || payout.bestellung) return false;
    const gelesen = await anhaltenLesen(tx, uid, payoutRef);
    anhaltenSchreiben(tx, { payoutRef, payout, ...gelesen, grund });
    return true;
  });
}

exports.processPayout = onDocumentCreated(
  {
    document: 'cashback_payouts/{payoutId}',
    region: REGION,
    timeoutSeconds: 30,
    secrets: [TREMENDOUS_API_KEY],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const payout = snap.data() || {};
    if (payout.status !== 'requested') return; // nur frische Anfragen
    const payoutId = event.params.payoutId;
    const uid = payout.userId;
    const amountCents = Number(payout.amountCents) || 0;

    // Anspruch + Kontosperre (Entscheidung Patrick 02.10.2026,
    // lib/kontoSperre.js) — VOR der Tremendous-Bestellung, in einer
    // Transaktion (auszahlungBeanspruchen). requestPayout prüft die Sperre
    // schon; diese zweite Schranke fängt eine Sperre, die zwischen Anfrage und
    // Verarbeitung gesetzt wurde, und jede Auszahlung, die nicht über
    // requestPayout entstand (Admin-Skript). Gesperrt → `failed` + Guthaben
    // zurück (es bleibt eingefroren, weil keine neue Anfrage durchkommt).
    //
    // Scheitert der Anspruch (meist: Sperre nicht lesbar) → anhalten, sofern
    // kein anderer Lauf beansprucht hat (fail-closed). Bewusst nicht
    // „liegen lassen": der Trigger läuft ohne Wiederholung, die Anfrage bliebe
    // mit abgebuchtem Guthaben auf 'requested'. So kommt das Geld zurück und
    // ein nicht gesperrter Nutzer fragt einfach erneut an. Scheitert auch das
    // Anhalten, bleibt die Anfrage stehen (Dashboard: „hängt").
    const merker = { sperreLesefehler: false };
    let anspruch;
    try {
      anspruch = await auszahlungBeanspruchen(uid, snap.ref, event.id, merker);
    } catch (e) {
      const grund = merker.sperreLesefehler ? GRUND_SPERRE_UNPRUEFBAR : 'vorpruefung_fehlgeschlagen';
      logger.error('payout-anspruch-failed', { payoutId, uid, grund, err: e.message });
      try {
        const angehalten = uid ? await auszahlungAnhalten(uid, snap.ref, grund) : false;
        logger.warn('payout-angehalten', { payoutId, uid, grund, amountCents, angehalten });
      } catch (e2) {
        // Nichts verschickt; die Anfrage bleibt 'requested' und ist im
        // Dashboard (Guthaben & Auszahlungen) unter „hängt" sichtbar.
        logger.error('payout-anhalten-failed', { payoutId, uid, grund, err: e2.message });
      }
      return;
    }
    if (anspruch !== 'frei') {
      if (anspruch === 'angehalten') {
        logger.warn('payout-angehalten', { payoutId, uid, grund: GRUND_KONTO_GESPERRT, amountCents, angehalten: true });
      } else {
        logger.info('payout-uebersprungen', { payoutId, uid, anspruch });
      }
      return;
    }

    const apiKey = TREMENDOUS_API_KEY.value();
    if (!apiKey) {
      logger.error('payout-no-api-key', { payoutId });
      await snap.ref.update({ status: 'failed', error: 'no_api_key', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return;
    }

    // Empfänger-E-Mail aus Firebase Auth (für EMAIL-Delivery zwingend).
    let email = null;
    let name = 'MarkenDetektive';
    try {
      const u = await admin.auth().getUser(uid);
      email = u.email || null;
      name = u.displayName || name;
    } catch (e) {
      logger.warn('payout-auth-lookup-failed', { payoutId, err: e.message });
    }
    if (!email) {
      await refundFailedPayout(uid, payoutId, amountCents);
      await snap.ref.update({ status: 'failed', error: 'no_email', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return;
    }

    try {
      // Funding-Source dynamisch holen (Sandbox hat eine Default-Balance).
      const fsRes = await fetch(`${TREMENDOUS_BASE}/funding_sources`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const fsJson = await fsRes.json();
      const sources = fsJson?.funding_sources || [];
      const fundingSourceId = (sources.find((f) => f.method === 'balance') || sources[0])?.id;
      if (!fundingSourceId) {
        await refundFailedPayout(uid, payoutId, amountCents);
        await snap.ref.update({ status: 'failed', error: 'no_funding_source', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        return;
      }

      const orderRes = await fetch(`${TREMENDOUS_BASE}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          external_id: payoutId, // Idempotenz gegen Doppel-Order
          payment: { funding_source_id: fundingSourceId },
          rewards: [
            {
              value: { denomination: Number((amountCents / 100).toFixed(2)), currency_code: 'EUR' },
              campaign_id: TREMENDOUS_CAMPAIGN_ID,
              // LINK statt EMAIL: Tremendous liefert den Redemption-Link in
              // der Antwort (delivery.link) → App öffnet ihn direkt in-app +
              // persistiert ihn (Statusseite „Meine Auszahlungen"). EMAIL
              // gäbe keinen API-Link zurück.
              delivery: { method: 'LINK' },
              recipient: { name, email },
            },
          ],
        }),
      });
      const orderJson = await orderRes.json();
      if (!orderRes.ok) {
        logger.error('tremendous-order-failed', { payoutId, status: orderRes.status, body: orderJson });
        await refundFailedPayout(uid, payoutId, amountCents);
        await snap.ref.update({
          status: 'failed',
          error: orderJson?.errors?.message || `tremendous_http_${orderRes.status}`,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      const reward = orderJson?.order?.rewards?.[0] || {};
      const orderId = orderJson?.order?.id || null;
      const rewardId = reward?.id || null;
      // Redemption-Link defensiv aus mehreren möglichen Feldern ziehen
      // (Feldname variiert je nach Delivery/Version). Wenn vorhanden,
      // öffnet ihn die App direkt im In-App-Browser; die E-Mail bleibt
      // als Backup-Kanal (delivery: EMAIL).
      const redemptionLink =
        reward?.delivery?.link ||
        reward?.redemption?.link ||
        reward?.redemption_link ||
        reward?.link ||
        null;
      // SECURITY (Go-Live): KEIN Log des vollen reward-Objekts hier — es enthält
      // den einlösbaren Redemption-Link (delivery.link), der sonst bei JEDEM
      // Payout im Cloud Logging landet (= auslesbarer Geldwert). Wir loggen
      // unten nur `hasLink` (Boolean), nie den Link selbst.
      await snap.ref.update({
        status: 'sent',
        tremendousOrderId: orderId,
        tremendousRewardId: rewardId,
        redemptionLink,
        recipientEmail: email,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      logger.info('payout-sent', { payoutId, orderId, hasLink: !!redemptionLink, env: TREMENDOUS_BASE });
    } catch (e) {
      logger.error('processPayout-failed', { payoutId, err: e.message });
      await refundFailedPayout(uid, payoutId, amountCents);
      await snap.ref
        .update({ status: 'failed', error: e.message, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        .catch(() => {});
    }
  },
);

// ─── tremendousWebhook (HTTPS) ──────────────────────────────────────
//
// Empfängt Tremendous-Webhook-Events (Redeem-Status). Die GET-API liefert
// den Redeem-Status NICHT — nur Webhooks. URL im Tremendous-Dashboard
// registrieren:
//   https://europe-west3-markendetektive-895f7.cloudfunctions.net/tremendousWebhook
// Bei einem Redeem-Event suchen wir den Payout per tremendousRewardId und
// setzen status 'delivered' + redeemedForm + redeemedAt → die Statusseite
// (Live-Subscription) zieht automatisch nach.
//
// Signatur wird verifiziert (HMAC-SHA256 `sha256=<hex>` über den rohen Body,
// timingSafeEqual) → unsignierte/ungültige Events werden NICHT verarbeitet.
// Idempotent (Marker pro Event-Typ+Resource-ID). REWARDS.DELIVERY.SUCCEEDED →
// status 'delivered'; FAILED/CANCELED/ORDERS.FAILED/CANCELED → Guthaben
// zurückbuchen (refundFailedPayout) + status 'failed'.
exports.tremendousWebhook = onRequest(
  { region: REGION, timeoutSeconds: 20, memory: '256MiB', cors: false, invoker: 'public', secrets: [TREMENDOUS_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('method_not_allowed');
      return;
    }
    // ── Signaturprüfung (Tremendous-Doku-Schema, Go-Live):
    // Header `Tremendous-Webhook-Signature` = `sha256=<hex>`, HMAC-SHA256 über
    // den ROHEN Request-Body, hexadezimal. Konstantzeit-Vergleich
    // (timingSafeEqual über gleich-lange Buffer). KEIN JSON.stringify-Fallback
    // (würde nie matchen → Bypass-Risiko) und KEIN Logging des Digests.
    let sigOk = false;
    try {
      const secret = TREMENDOUS_WEBHOOK_SECRET.value();
      const raw = req.rawBody; // Firebase v2 liefert den rohen Body als Buffer
      const header = req.get('Tremendous-Webhook-Signature') || '';
      const provided = header.startsWith('sha256=') ? header.slice('sha256='.length).trim() : header.trim();
      if (secret && raw && provided) {
        const computed = crypto.createHmac('sha256', secret).update(raw).digest('hex');
        const a = Buffer.from(provided, 'utf8');
        const b = Buffer.from(computed, 'utf8');
        sigOk = a.length === b.length && crypto.timingSafeEqual(a, b);
      }
    } catch (e) {
      logger.warn('tremendous-webhook-sig-failed', { err: e.message });
    }
    if (!sigOk) {
      // 200, damit Tremendous nicht endlos retried; unsignierte/ungültige
      // Events werden NICHT verarbeitet (kein Status, kein Geld).
      logger.warn('tremendous-webhook-unsigned');
      res.status(200).send('ignored_unsigned');
      return;
    }

    const body = req.body || {};
    const ev = String(body.event || '').toUpperCase();
    const resource = body.payload?.resource || {};
    const resourceType = resource.type || null; // 'rewards' | 'orders' | …
    const resourceId = resource.id || null;
    logger.info('tremendous-webhook', { event: body.event || null, resourceType, resourceId });

    // Idempotenz: jedes (Event-Typ + Resource-ID) nur einmal verarbeiten.
    // Marker wird ERST nach erfolgreicher Verarbeitung geschrieben (crash-sicher),
    // hier nur prüfen → Replays eines bereits verarbeiteten Events früh raus.
    const evKey = ev && resourceId ? `${ev}_${resourceId}` : null;
    if (evKey) {
      const seen = await db.collection('cashback_webhook_events').doc(evKey).get();
      if (seen.exists) {
        res.status(200).send('already_processed');
        return;
      }
    }

    try {
      const rewardId = resourceType === 'rewards' ? resourceId : null;
      const orderId = resourceType === 'orders' ? resourceId : null;

      // Payout per Reward-ID ODER Order-ID finden.
      let doc = null;
      if (rewardId) {
        const qs = await db.collection('cashback_payouts').where('tremendousRewardId', '==', rewardId).limit(1).get();
        if (!qs.empty) doc = qs.docs[0];
      }
      if (!doc && orderId) {
        const qs = await db.collection('cashback_payouts').where('tremendousOrderId', '==', orderId).limit(1).get();
        if (!qs.empty) doc = qs.docs[0];
      }

      if (!doc) {
        logger.info('tremendous-webhook-no-match', { rewardId, orderId, event: body.event });
      } else {
        const cur = doc.data();
        const ts = admin.firestore.FieldValue.serverTimestamp();
        // Endgültiger Fehlschlag/Storno → das beim Payout-Request bereits
        // debitierte Guthaben zurückbuchen (refundFailedPayout ist idempotent
        // per admin_adjust-Guard) + status 'failed'.
        const FAIL_EVENTS = ['REWARDS.DELIVERY.FAILED', 'REWARDS.CANCELED', 'ORDERS.FAILED', 'ORDERS.CANCELED'];
        if (FAIL_EVENTS.includes(ev)) {
          if (cur.status !== 'failed') {
            await refundFailedPayout(cur.userId, doc.id, Number(cur.amountCents) || 0);
            await doc.ref.set(
              { status: 'failed', error: `tremendous_${ev.toLowerCase()}`, lastWebhookEvent: body.event || null, updatedAt: ts },
              { merge: true },
            );
          }
        } else if (ev === 'REWARDS.DELIVERY.SUCCEEDED') {
          const redeemedForm =
            resource?.products?.[0]?.name ||
            body.payload?.reward?.products?.[0]?.name ||
            cur.redeemedForm ||
            null;
          await doc.ref.set(
            { status: 'delivered', redeemedForm, redeemedAt: ts, lastWebhookEvent: body.event || null, updatedAt: ts },
            { merge: true },
          );
        } else {
          // Informative Events (ORDERS.CREATED/APPROVED, REWARDS.FLAGGED, …) →
          // nur protokollieren, kein Status-/Geld-Change.
          await doc.ref.set({ lastWebhookEvent: body.event || null, updatedAt: ts }, { merge: true });
        }
      }

      // Erst NACH erfolgreicher Verarbeitung den Idempotenz-Marker setzen.
      if (evKey) {
        await db
          .collection('cashback_webhook_events')
          .doc(evKey)
          .set({ event: body.event || null, processedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    } catch (e) {
      logger.error('tremendous-webhook-failed', { err: e.message });
      // 5xx → Tremendous stellt das Event erneut zu. Der Idempotenz-Marker
      // wird NUR nach erfolgreicher Verarbeitung gesetzt (oben), also
      // verarbeitet ein Retry sauber neu — refundFailedPayout (admin_adjust-
      // Guard) + die Status-Writes (merge/Status-Check) sind idempotent. Ohne
      // Retry ginge bei einem transienten Fehler z.B. eine FAILED-Rückbuchung
      // still verloren (User bekäme sein Guthaben nicht zurück).
      res.status(500).send('error_will_retry');
      return;
    }
    res.status(200).send('ok');
  },
);

// ─── resolveCashbackReview (HTTPS, Admin) ───────────────────────────
//
// ClickUp 86caf62v6. Gibt einen auf 'review' GEHALTENEN Bon (Gate-Schritt 6w:
// low-confidence ODER suspiciousSoftware) manuell frei oder lehnt ihn ab.
//   approve → syncLedgerForReceipt('approved') (idempotent per receiptId) →
//             Gutschrift; Status 'approved' (bzw. 'no_reward' falls Aktions-
//             Budget leer).
//   reject  → Status 'rejected' (keine Gutschrift — es war nie eine).
// Nur Bons im Status 'review' sind auflösbar (schützt vor Doppel-Credit).
// Key-gated (Secret NUTRITION_SCRAPER_TRIGGER_KEY). Aufruf:
//   …/resolveCashbackReview?key=…&receiptId=…&decision=approve|reject
exports.resolveCashbackReview = onRequest(
  { region: REGION, timeoutSeconds: 60, memory: '256MiB', cors: false, secrets: [CASHBACK_ADMIN_KEY] },
  async (req, res) => {
    // Key bevorzugt aus dem Header — ein Query-Parameter landet in den
    // Cloud-Run-Request-Logs. Query bleibt für bestehende Skripte gültig.
    const providedKey = String(req.get('x-admin-key') || req.query.key || '');
    if (providedKey !== CASHBACK_ADMIN_KEY.value()) {
      res.status(403).json({ code: 'forbidden' });
      return;
    }
    const receiptId = String(req.query.receiptId || '');
    const decision = String(req.query.decision || '');
    // 02.09.2026: zwei weitere Entscheidungen, damit die Auflösung eines
    // Review-Rückstaus dieselben Ergebnisse produziert wie die Pipeline selbst
    // (statt nur „manual_review_rejected"):
    //   reject    + reason=duplicate_content_self (+duplicateOf=<receiptId>)
    //   no_reward + reason=daily_cap_reached|weekly_cap_reached|per_user_cap_reached
    //               (valider Bon, aber ein Limit greift → purchased_products
    //               werden wie bei der Pipeline geschrieben, kein Geld)
    const reason = String(req.query.reason || '');
    const duplicateOfId = String(req.query.duplicateOf || '');
    const PRIOR_STATUSES = new Set(['approved', 'paid', 'no_reward', 'review', 'matched', 'ocr_pending']);
    const priorStatusParam = String(req.query.priorStatus || '');
    const priorStatus = PRIOR_STATUSES.has(priorStatusParam) ? priorStatusParam : 'approved';
    const REJECT_REASONS = new Set(['manual_review_rejected', 'duplicate_content_self', 'duplicate_content_cross_user']);
    const NO_REWARD_REASONS = new Set(['daily_cap_reached', 'weekly_cap_reached', 'per_user_cap_reached']);
    const validDecision =
      decision === 'approve'
      || (decision === 'reject' && (!reason || REJECT_REASONS.has(reason)))
      || (decision === 'no_reward' && NO_REWARD_REASONS.has(reason));
    if (!receiptId || !validDecision) {
      res.status(400).json({
        code: 'bad_request',
        message: 'receiptId + decision=approve|reject[&reason=manual_review_rejected|duplicate_content_self]|no_reward&reason=daily_cap_reached|weekly_cap_reached|per_user_cap_reached',
      });
      return;
    }
    const ref = db.collection('receipts').doc(receiptId);
    // Nach einem Fehler den EIGENEN Anspruch sofort freigeben, damit ein
    // erneuter Klick nicht 2 Minuten lang „entscheidet gerade jemand" meldet.
    // Das Geld bleibt dabei konsistent: das Ledger ist idempotent je Bon, ein
    // zweiter Versuch bucht nichts doppelt.
    let anspruchToken = null;
    const anspruchFreigeben = async () => {
      if (!anspruchToken) return;
      const ok = await entscheidungFreigeben({ db, admin, ref, token: anspruchToken });
      if (!ok) logger.warn('entscheidung-freigabe-fehlgeschlagen', { receiptId });
    };
    try {
      // Nur 'review' ist auflösbar → kein Doppel-Credit/Zustandsfehler. Seit
      // 24.09.2026 (Push-Prüfung) werden Statusprüfung und Anmeldung der
      // Entscheidung in EINER Transaktion gemacht (lib/laufAnspruch.js):
      // vorher meldeten gleichzeitiges Freigeben und Ablehnen beide Erfolg —
      // am Ende stand „Ka-ching!" beim Nutzer und ein Storno im Ledger. Und
      // solange die Pipeline den Bon noch rechnet, wird nicht entschieden.
      const anspruch = await entscheidungBeanspruchen({ db, admin, ref, decision });
      if (anspruch.urteil === 'not_found') {
        res.status(404).json({ code: 'not_found' });
        return;
      }
      if (anspruch.urteil !== 'frei') {
        const code = anspruch.urteil === 'in_verarbeitung' ? 'processing_in_progress' : anspruch.urteil;
        res.status(409).json({ code, status: anspruch.status ?? null });
        return;
      }
      // Frisch gelesen NACH der Anmeldung: seit dem Aufruf kann die Pipeline den
      // Bon neu gerechnet haben (anderer Betrag, andere Aktion).
      anspruchToken = anspruch.token;
      const r = (await ref.get()).data() || {};
      const uid = r.userId;
      const ts = admin.firestore.FieldValue.serverTimestamp();
      const mirrorRef = db.doc(`users/${uid}/cashback_status/${receiptId}`);
      // Filialadresse (05.09.2026) auch bei Review-Auflösung mitschreiben —
      // Bons aus dem Catch-Pfad (ledger_precheck_failed/ocr_unavailable) haben
      // Schritt 6a/7 nie durchlaufen und tragen sonst weder store noch storeCity.
      const store = r.ocr?.parsed ? deriveStoreAddress(r.ocr.parsed, r.merchant?.land ?? null) : null;
      const storeMirror = { storeCity: store?.city ?? null, storeZip: store?.zip ?? null };
      const userRef = db.doc(`users/${uid}`);
      // Config STRIKT (kein Fallback auf campaignsEnabled:false) + Kampagne —
      // für alle drei Zweige: approve bucht, reject/no_reward REVERSEN einen
      // evtl. vorhandenen Earn (z.B. Wiederanlauf nach Teilfehler NACH der
      // Transaktion), genau wie die Pipeline bei nicht-approved Status.
      const config = await loadConfig({ strict: true });
      const wirksameAktion = wirksameAktionId(r);
      const campaign = wirksameAktion ? await loadCampaignById(wirksameAktion) : null;
      if (wirksameAktion && !campaign) {
        await anspruchFreigeben();
        res.status(409).json({ code: 'campaign_missing', campaignId: wirksameAktion });
        return;
      }
      const campaignMode = !!config.campaignsEnabled && !!campaign;

      if (decision === 'reject') {
        const rejectReason = reason || 'manual_review_rejected';
        // Duplikat-Form wie in processCashback (Content-Dedup-Self) — der Mirror
        // trägt nur sameUser + priorReceiptId (nie fremde uid).
        const isDup = rejectReason === 'duplicate_content_self' || rejectReason === 'duplicate_content_cross_user';
        const sameUser = rejectReason === 'duplicate_content_self';
        const duplicateOf =
          isDup && duplicateOfId ? { receiptId: duplicateOfId, sameUser, priorStatus } : null;
        await syncLedgerForReceipt(userRef, receiptId, 'rejected', 0, r.bonDate || null, campaign?.id || null, campaignMode);
        await ref.update({
          status: 'rejected',
          rejectReason,
          ...(duplicateOf ? { duplicateOf } : {}),
          reviewDecision: 'reject',
          entscheidungLaeuft: admin.firestore.FieldValue.delete(),
          store: store ?? null,
          reviewResolvedAt: ts,
          updatedAt: ts,
        });
        await mirrorRef.set(
          {
            status: 'rejected',
            rejectReason,
            ...storeMirror,
            ...(duplicateOf
              ? { duplicate: { sameUser, priorReceiptId: sameUser ? duplicateOf.receiptId : null } }
              : {}),
            updatedAt: ts,
          },
          { merge: true },
        );
        logger.info('cashback-review-rejected', { receiptId, uid, rejectReason });
        res.json({ ok: true, status: 'rejected', rejectReason });
        return;
      }

      if (decision === 'no_reward') {
        // Valider Bon ohne Geld (Limit) — exakt das Pipeline-Ergebnis 6y)/6z):
        // Status no_reward + Grund, cashbackCents 0, Positionen ins Tracking.
        await syncLedgerForReceipt(userRef, receiptId, 'no_reward', 0, r.bonDate || null, campaign?.id || null, campaignMode);
        await ref.update({
          status: 'no_reward',
          cashbackCents: 0,
          rejectReason: reason,
          reviewDecision: 'no_reward',
          entscheidungLaeuft: admin.firestore.FieldValue.delete(),
          store: store ?? null,
          reviewResolvedAt: ts,
          updatedAt: ts,
        });
        await mirrorRef.set(
          { status: 'no_reward', cashbackCents: 0, rejectReason: reason, ...storeMirror, updatedAt: ts },
          { merge: true },
        );
        if (r.ocr?.parsed) {
          await writePurchasedProducts(uid, receiptId, r.ocr.parsed, r.merchant || null, {
            status: 'no_reward',
            rejectReason: reason,
            rewardEligible: true,
            backfilled: true,
          });
        }
        logger.info('cashback-review-no-reward', { receiptId, uid, reason });
        res.json({ ok: true, status: 'no_reward', rejectReason: reason });
        return;
      }

      // approve: gutschreiben. syncLedgerForReceipt ist idempotent per receiptId
      // (netActive===0-Guard) → ein versehentlicher Doppel-Aufruf erzeugt keinen
      // zweiten earn; zudem ist der Bon danach 'approved' (oben 409).
      //
      // 02.09.2026: Die Freigabe läuft mit DENSELBEN Caps wie processCashback
      // (Wochen-/Per-User-/Monats-/Tageslimit in der Ledger-Transaktion) —
      // vorher wurden Review-Bons ohne jede Limit-Prüfung gutgeschrieben, obwohl
      // der User seit dem Halten längst weitere Bons vergütet bekommen haben
      // kann. Und: purchased_products werden nachgezogen — beim Halten (status
      // 'review') schreibt die Pipeline sie nicht, ein freigegebener Bon fehlte
      // damit im B2B-Trail und im receipt-matcher.
      const cents = Number(r.cashbackCents) || 0;
      if (cents <= 0) {
        // Kein berechnetes Cashback (z.B. ocr_unavailable-Hold ohne OCR) →
        // NICHT still als „Budget erschöpft" final schreiben.
        await anspruchFreigeben();
        res.status(409).json({ code: 'no_cashback_computed', reviewReason: r.reviewReason || null });
        return;
      }
      const settle = await syncLedgerForReceipt(
        userRef,
        receiptId,
        'approved',
        cents,
        r.bonDate || null,
        campaign?.id || null,
        campaignMode,
        {
          weeklyBonCap: campaignMode ? Number(campaign.weeklyBonCap) || 0 : 0,
          maxPerUserCents: campaignMode ? Number(campaign.maxPerUserCents) || 0 : 0,
          monthlyMaxCents: !campaignMode ? Number(config.monthlyMaxCents) || 0 : 0,
          dailyCap: Number(config.dailyCap) || 0,
          legacyFallback: config.dailyCapLegacyFallback !== false,
        },
        // Doppel-Schutz (04.10.2026): auch eine Freigabe durch einen Menschen
        // oder die Bon-Runde bucht keinen Bon, der schon bezahlt ist.
        { bon: identitaetAusBon(r), doppel: doppelModi(config) },
      );
      if (settle?.doppelTreffer?.length) {
        for (const t of settle.doppelTreffer) {
          logger.warn('doppel-treffer', { cashbackId: receiptId, quelle: 'resolver', regel: t.regel, modus: t.modus, sameUser: t.sameUser, gegen: t.sameUser ? t.gegen : null, anteil: t.anteil ?? null, andererMarkt: t.andererMarkt === true, abstand: t.abstand ?? null });
        }
      }
      const doppelPruefung = settle?.doppelGeprueft
        ? {
            modi: modiVermerk(doppelModi(config)),
            treffer: settle.doppelTreffer,
            at: admin.firestore.Timestamp.now(),
          }
        : null;
      if (settle?.doppel && settle.doppel.modus === 'wirksam') {
        // Derselbe Bon ist schon bezahlt: Ablehnung wie in der Pipeline. Die
        // Entscheidung des Menschen (approve) bleibt als reviewDecision stehen
        // — eine erneute Zustellung rechnet damit dasselbe Ergebnis.
        const rejectReason = settle.capReason || doppelGrund(settle.doppel);
        const sameUser = settle.doppel.sameUser === true;
        const duplicateOf = { receiptId: settle.doppel.gegen, sameUser, priorStatus: 'approved', kind: settle.doppel.regel };
        await ref.update({
          status: 'rejected',
          cashbackCents: 0,
          rejectReason,
          duplicateOf,
          doppelPruefung,
          reviewDecision: 'approve',
          entscheidungLaeuft: admin.firestore.FieldValue.delete(),
          store: store ?? null,
          reviewResolvedAt: ts,
          updatedAt: ts,
        });
        await mirrorRef.set(
          {
            status: 'rejected',
            cashbackCents: 0,
            rejectReason,
            ...storeMirror,
            duplicate: { sameUser, priorReceiptId: sameUser ? duplicateOf.receiptId : null },
            updatedAt: ts,
          },
          { merge: true },
        );
        logger.info('cashback-review-doppel', { receiptId, uid, rejectReason, regel: settle.doppel.regel });
        res.json({ ok: true, status: 'rejected', rejectReason, creditedCents: 0, capReason: rejectReason });
        return;
      }
      const credited = Number(settle?.creditedCents) || 0;
      const finalStatus = credited > 0 ? 'approved' : 'no_reward';
      const finalReason = credited > 0 ? null : settle?.capReason || 'campaign_budget_exhausted';
      await ref.update({
        status: finalStatus,
        cashbackCents: credited,
        rejectReason: finalReason,
        ...(doppelPruefung ? { doppelPruefung } : {}),
        reviewDecision: 'approve',
        entscheidungLaeuft: admin.firestore.FieldValue.delete(),
        store: store ?? null,
        reviewResolvedAt: ts,
        updatedAt: ts,
      });
      await mirrorRef.set(
        { status: finalStatus, cashbackCents: credited, rejectReason: finalReason, ...storeMirror, updatedAt: ts },
        { merge: true },
      );
      // Spiegel von processCashback 7a): approved UND no_reward gelten als valide
      // Bons (rewardEligible=true) → Positionen fürs Matching/B2B nachziehen.
      if (r.ocr?.parsed) {
        await writePurchasedProducts(uid, receiptId, r.ocr.parsed, r.merchant || null, {
          status: finalStatus,
          rejectReason: finalReason,
          rewardEligible: true,
          backfilled: true, // nachgezogen → Matcher darf keinen heutigen Zettel abhaken
        });
      }
      // Anders als in processCashback genügt hier `credited > 0`: ein Bon im
      // Status 'review' mit schon aktiver Gutschrift entsteht nur, wenn ein
      // früherer Lauf nach der Buchung abbrach (catch-Zweig) oder eine Freigabe
      // nach der Buchung scheiterte — in beiden Fällen kam noch keine
      // Nachricht. Doppelte verhindert der Merker in sendCashbackReady.
      if (credited > 0) {
        await sendCashbackReady(uid, {
          cashbackId: receiptId,
          cents: credited,
          markt: r.merchant?.name,
          schwelle: config?.payoutThresholdCents,
        }).catch((e) => logger.warn('cashback-push-failed', { receiptId, err: e.message }));
      }
      logger.info('cashback-review-approved', { receiptId, uid, credited, finalStatus, capReason: settle?.capReason || null });
      res.json({ ok: true, status: finalStatus, creditedCents: credited, capReason: settle?.capReason || null });
    } catch (e) {
      logger.error('resolveCashbackReview-failed', { receiptId, err: e.message });
      await anspruchFreigeben();
      res.status(500).json({ code: 'internal' });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────
// Sweeper: verhungerte Bons (03.09.2026)
//
// Befund: 9 Bons standen bis zu 41 Tage in 'ocr_pending' mit attempts=0 und
// updatedAt === createdAt — processCashback hat sie NIE gesehen (kein einziger
// process-*-Logeintrag), obwohl enqueueCashback den Publish als Erfolg
// gemeldet hat. Rate ~1 pro 5 Tage. Ein Bon, den niemand anfasst, bleibt in
// der App für immer „wird geprüft" — genau die Klasse „Status ohne
// Mechanismus". Der Sweeper legt solche Bons erneut auf das Topic. Das ist
// gefahrlos: OCR-Cache (falls vorhanden) + Ledger-Idempotenz + alreadyCredited-
// Precheck machen eine Doppelzustellung zum Noop.
// Query nur auf status (kein Composite-Index nötig), Alter im Speicher.
const SWEEP_MIN_AGE_MS = 20 * 60 * 1000;
const SWEEP_MAX_PER_RUN = 50;
exports.sweepStuckReceipts = onSchedule(
  { region: REGION, schedule: 'every 15 minutes', timeoutSeconds: 120, memory: '256MiB' },
  async () => {
    const snap = await db.collection('receipts').where('status', '==', 'ocr_pending').limit(500).get();
    const jetzt = Date.now();
    const cutoff = jetzt - SWEEP_MIN_AGE_MS;
    const stuck = snap.docs.filter((d) => {
      const x = d.data();
      const created = x.createdAt?.toMillis?.() ?? 0;
      const lastSweep = x.sweptAt?.toMillis?.() ?? 0;
      // Nicht öfter als alle 20 min pro Bon; nach 5 Sweeps aufgeben (dann ist
      // es kein verlorener Publish mehr, sondern ein echter Verarbeitungsfehler).
      // Und nie neben einem Lauf, der gerade rechnet (24.09.2026): zwei Läufe
      // mit frischer OCR können verschieden lesen, und der zweite stornierte
      // dann die Gutschrift, die der erste schon gemeldet hatte. Der nächste
      // Kehrlauf holt den Bon, falls er danach noch hängt.
      // Ebenso nicht, solange eine OCR-Fortsetzung frisch angefordert ist
      // (03.10.2026): zwischen dem Ende des einen und dem Start des nächsten
      // Laufs hält niemand einen Anspruch. Ging die Zustellung verloren, holt
      // ein späterer Kehrlauf den Bon (der Zwischenstand bleibt verwertbar).
      const fortsetzungFrisch = Number(x.ocrZwischenstand?.gespeichertMs) > jetzt - LAUF_MAX_MS;
      return created && created < cutoff && lastSweep < cutoff && (x.sweepCount || 0) < 5
        && aktiveLaeufe(x.verarbeitung, jetzt).length === 0
        && !fortsetzungFrisch;
    }).slice(0, SWEEP_MAX_PER_RUN);
    if (!stuck.length) return;
    const topic = pubsub.topic(PUBSUB_TOPIC);
    let n = 0;
    for (const d of stuck) {
      const x = d.data();
      try {
        await d.ref.update({
          sweptAt: admin.firestore.FieldValue.serverTimestamp(),
          sweepCount: admin.firestore.FieldValue.increment(1),
        });
        await topic.publishMessage({ json: { cashbackId: d.id, uid: x.userId }, attributes: { uid: x.userId, cashbackId: d.id } });
        n++;
      } catch (e) {
        logger.warn('sweep-republish-failed', { cashbackId: d.id, err: e.message });
      }
    }
    logger.warn('sweep-stuck-receipts', { candidates: stuck.length, republished: n, oldestMin: Math.round((Date.now() - Math.min(...stuck.map((d) => d.data().createdAt.toMillis()))) / 60000) });
  },
);

// ─── Gast-Übernahme: Ticket vorbereiten / einlösen (Stufe 1) ────────
//
// Umbau „erst einreichen, dann Konto" (Schritte 12, 13, 17). Meldet sich ein
// Gast bei einem BESTEHENDEN Konto an, sichert die App vorher (noch als Gast)
// einen Besitznachweis: nur den SHA-256-Hash eines Geheimnisses. Nach dem
// Wechsel löst das Zielkonto das Geheimnis ein.
//
// Stufe 1 prüft beim Einlösen alles und antwortet dann `pausiert` — gebunden
// und umgebucht wird erst mit Stufe 2, auch wenn gastUebernahmeAktiv schon
// true ist. Logik und Begründungen: lib/gastUebernahme.js.
//
// Beide Endpunkte: nur POST, Bearer mit checkRevoked, Fehler als JSON {code}.
// Geheimnis und Hash werden nie geloggt — auch nicht im Fehlerfall.
const gastUebernahme = erstelleGastUebernahme({ db, admin, logger, loadConfig, zeit: () => Date.now() });

exports.gastUebernahmeVorbereiten = onRequest(
  { region: REGION, timeoutSeconds: 30, memory: '512MiB', cors: true, invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ code: 'method_not_allowed' });
      return;
    }
    const auth = await tokenPruefen(admin, req, logger);
    if (auth.fehler) {
      res.status(auth.fehler.http).json(auth.fehler.body);
      return;
    }
    try {
      const { http, body } = await gastUebernahme.vorbereiten({
        gastUid: auth.uid,
        ticketHash: (req.body || {}).ticketHash,
      });
      res.status(http).json(body);
    } catch (e) {
      logger.error('gastUebernahmeVorbereiten-failed', { uid: auth.uid, err: e.message });
      res.status(500).json({ code: 'internal' });
    }
  },
);

exports.gastUebernahmeEinloesen = onRequest(
  { region: REGION, timeoutSeconds: 120, memory: '512MiB', cors: true, invoker: 'public' },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ code: 'method_not_allowed' });
      return;
    }
    const auth = await tokenPruefen(admin, req, logger);
    if (auth.fehler) {
      res.status(auth.fehler.http).json(auth.fehler.body);
      return;
    }
    const body = req.body || {};
    try {
      const { http, body: antwortBody } = await gastUebernahme.einloesen({
        zielUid: auth.uid,
        gastUid: body.vonUid,
        geheimnis: body.geheimnis,
      });
      res.status(http).json(antwortBody);
    } catch (e) {
      logger.error('gastUebernahmeEinloesen-failed', { uid: auth.uid, err: e.message });
      res.status(500).json({ code: 'internal' });
    }
  },
);
