/**
 * Robust OCR wrapper — self-consistency + cross-run agreement confidence.
 *
 * Why: a SINGLE image read is non-deterministic on degraded (creased/faded)
 * thermal bons. Under the pipeline's policy a non-reconciling read is REJECTED
 * outright — so one unlucky read unfairly costs the user their cashback; and a
 * single read that happens to reconcile via a swap/compensating error could
 * auto-pay on wrong data. Both are mitigated by reading the image several times
 * and trusting the result that INDEPENDENT runs agree on.
 *
 * Strategy (cost scales with difficulty — easy bons stop after 2 reads):
 *   1. Up to `maxFlash` flash reads; stop as soon as 2 reconciling reads
 *      produce the IDENTICAL (name#price) sequence → confidence 'high'.
 *   2. If no flash agreement, escalate up to 2× (Eskalationsstufe, intern
 *      weiter „pro" genannt — seit 01.10.2026 gemini-3.5-flash mit Denkstufe
 *      HIGH statt gemini-2.5-pro, s. u.); agreement that includes an
 *      escalation read → 'medium'.
 *   3. No agreement but at least one read reconciles → that read, 'low'.
 *   4. Nothing reconciles → first read, 'none' (the recon gate rejects it).
 *
 * Agreement is on the ORDERED (name#price) sequence, so it catches swaps and
 * compensating errors that Σ==total alone cannot. The returned shape matches
 * extractReceipt() so the downstream pipeline is unchanged; `robust` carries
 * the confidence/method/attempts for observability + an optional approval gate.
 *
 * ═══ Zeit (03.10.2026): Zeitlimit je Lesung, Laufbudget, Fortsetzung ═══
 * Vom 28.09. bis 02.10. lieferte Vertex (global, gemini-3.5-flash) einzelne
 * Antworten minutenlang gar nicht. Die Basis- und Bildverbesserungs-Lesungen
 * hatten kein eigenes Zeitlimit; jede hängende Lesung wartete bis zum festen
 * 300-s-Limit von Node-fetch („fetch failed"). Zwei solche Hänger reichten für
 * die 540 s von processCashback — 304 Läufe in zehn Tagen. Danach rechnete der
 * Code im Hintergrund weiter (bis 37 min), während der Kehrlauf den Bon schon
 * ein zweites Mal zustellte. Seitdem:
 *
 *   • Jede Lesung hat ein Zeitlimit (Standard 170 s). Gemessen an 3.600
 *     erfolgreichen gewählten Lesungen vom 21.09.–03.10.: ALLE 100 Lesungen
 *     über 170 s waren Warteschlange bei Google, nicht Arbeit (erzeugte Token
 *     / Median-Rate 221 Token/s ergibt bei allen < 150 s, Median 12 s). Eine
 *     Lesung, die das Ausgabelimit von 32.768 Token voll nutzt, braucht bei
 *     Median-Rate ~148 s; die ruhigen Tage 25.–27.09. hatten als längste
 *     erfolgreiche Lesung 158 s.
 *   • Ein Abbruch durch DIESES Zeitlimit ist keine Aussage über den Bon. Er
 *     verbraucht den Lese-Platz nicht; bis zu ERSATZ_MAX-mal je Bon wird der
 *     Platz neu gelesen. So entscheidet die Leiter mit so vielen Lesungen wie
 *     ohne Störung — nicht mit weniger, weil Google gerade langsam war.
 *     Alle anderen Fehlversuche (429, MAX_TOKENS, Netz) zählen wie bisher.
 *   • Die ersten beiden Basis-Lesungen laufen gleichzeitig. Kostet nichts
 *     extra (für eine Einigung sind ohnehin zwei Lesungen nötig) und halbiert
 *     die Wartezeit im Normalfall; die Reihenfolge in `reads` bleibt die
 *     Aufruf-Reihenfolge, Einigung und Auswahl sind dieselben wie nacheinander.
 *   • Laufbudget (Standard 400 s ab Start des Laufs, `opts.laufStart`): eine
 *     Lesung beginnt nur, wenn ihr volles Zeitlimit noch ins Budget passt.
 *     Sonst wirft die Funktion `ocr_zeitbudget` mit dem Zwischenstand —
 *     OHNE Ergebnis, also ohne Entscheidung. index.js legt den Zwischenstand
 *     am Bon ab und stellt sofort neu zu; der nächste Lauf setzt genau dort
 *     fort (`opts.zwischenstand`). Eine unterbrochene Leiter liefert bei
 *     gleichen Lesungen exakt dasselbe Ergebnis wie eine durchgelaufene.
 *
 * ═══ Denkstufe der normalen Lesungen (08.10.2026, ab Werk aus) ═══
 * `opts.denkstufe` (Schalter cashback_config/v1.ocrDenkstufe, geprüft über
 * lib/geminiModelle.js ocrDenkstufeWirksam): 'LOW' gibt den Basis-Lesungen und
 * den Lesungen am verbesserten Bild ein `thinkingConfig: { thinkingLevel }`
 * mit — aber NUR, wenn diese Leiter mit Prompt v1.5 oder v1.6 liest (gemessen
 * ist nur v1.5 + LOW, v1.6 ist deren Nachbesserung; sonst
 * `ocr-denkstufe-ohne-v15` und keine Vorgabe). Ohne
 * gültigen Wert bleibt jede Anfrage, wie sie war (keine Denk-Vorgabe). Die
 * Eskalation behält ihre eigene Stufe (HIGH, nach Fehlversuch LOW). Messung
 * 08.10.: LOW ≈ ohne Denken.
 *   • MEDIUM/HIGH sind nicht freigegeben: für die normalen Lesungen gibt es
 *     keine Ausweich-Stufe, und ein Denk-Ausreißer bis MAX_TOKENS verbraucht
 *     den Platz (nur der Zeitabbruch wird ersetzt, `verbraucht` unten).
 *   • Vorrang vor CASHBACK_OCR_THINKING_BUDGET: eine übergebene Denk-Konfiguration
 *     schlägt in lib/ocr.js den Env-Schalter. Gewollt: Vertex lehnt
 *     `thinkingBudget` bei gemini-3.5-flash seit 22.09.2026 teilweise mit 400
 *     ab (gemessen, s. CLAUDE.md), und laut Gemini-3-Doku sind beide Felder in
 *     EINER Anfrage unzulässig (400; nicht selbst gemessen) — es kann also nur
 *     eines gelten. Der Firestore-Schalter ist die gemessene, ohne Deploy
 *     umkehrbare Betriebsentscheidung; die Env-Variable ist Deploy-Stand und
 *     laut lib/ocr.js für Gemini 3 ohnehin nicht zu setzen. Für Modelle vor
 *     Gemini 3 (config.ocrModel auf 2.5) wirkt der Schalter NICHT — sie kennen
 *     keine Denkstufen; dort gilt weiter der Env-Schalter.
 *   • Am Bon: `ocr.robust.denkstufe` (Stufe der normalen Lesungen, null = keine
 *     Vorgabe; fehlt das Feld, stammt der Bon von vor dem Schalter) und je
 *     Lesung `robust.reads[].denkstufe` (tatsächlich gesendete Stufe, bei der
 *     Eskalation deren eigene). So lassen sich Alt und Neu trennen.
 *   • Ein Zwischenstand einer ANDEREN Stufe wird verworfen (wie beim Prompt):
 *     eine Leiter mischt keine Stufen, `robust.denkstufe` bleibt eindeutig.
 *   • Seit 08.10.2026 wirkt LOW mit Prompt v1.5 UND v1.6 (v1.6 = Nachbesserung
 *     dieser Variante, lib/prompt.js).
 *
 * ═══ Unter LOW zählt eine Einigung nur bei exaktem Abgleich (08.10.2026) ═══
 * Messung 2 (268 Bons, LOW + v1.5): 18 Freigaben mit Bewertung 'high' trugen
 * falsche Artikelpreise — 9 davon mit einer Summenabweichung innerhalb der
 * Pfand-Toleranz (Σ bis 2 € unter dem Endbetrag gilt als abgeglichen), 9 mit
 * sich aufhebenden Fehlern. Zwei LOW-Lesungen irren dabei gemeinsam (dasselbe
 * Modell, dieselbe Stufe). Deshalb gilt mit wirksamer Stufe LOW:
 *   • Einigen sich NUR normale LOW-Lesungen (Basis- und Verbessert-Lesungen),
 *     zählen dafür nur Lesungen, deren Abgleich EXAKT aufgeht (Σ Items =
 *     Endbetrag auf den Cent, ohne Pfand-Toleranz; bei Rabattzeilen die
 *     Belegkette auf den Cent). Es braucht zwei solche Lesungen mit derselben
 *     Folge (name#Preis).
 *   • Sonst läuft die Leiter weiter wie bei fehlender Einigung (weitere
 *     Basis-Lesung, Deckel-Prüfung, verbessertes Bild, Eskalation, am Ende
 *     'low'/'none').
 *   • Eine Einigung MIT einer Eskalations-Lesung (eigene Stufe HIGH bzw. deren
 *     Ausweich-Stufe) zählt wie bisher — sie ist die unabhängige Bestätigung,
 *     die zwei LOW-Lesungen allein nicht liefern. Eine Folge, die zwei LOW-
 *     Lesungen nur ungefähr abgleichen, kann so in der Eskalation bestätigt
 *     werden ('pro-agreement').
 *   • Die sich aufhebenden Fehler fängt das NICHT (Σ geht dort exakt auf);
 *     dafür sind die Regeln C/E von Prompt v1.6 da.
 * Ohne LOW (Schalter aus, v1.4, ungültiger Wert, Modell vor Gemini 3) ist die
 * Einigung unverändert (findAgreement ohne Option, Zeichen für Zeichen wie
 * vor dem 08.10.2026). Am Bon nur mit LOW: `robust.einigungNurExakt: true`
 * und je Lesung `robust.reads[].reconExakt` (so lässt sich zählen, wie oft
 * die Regel eine Einigung zurückgestellt hat).
 *
 * ═══ Abgleich je Fassung (08.10.2026) ═══
 * `reconciles()` gleicht jede Lesung mit den Optionen IHRER Fassung ab
 * (lib/punkteZahlung.js abgleichOptionen): nur v1.6 behandelt eingelöste
 * Punkte als Zahlungsmittel. Alle Lesungen einer Leiter haben dieselbe Fassung.
 */

'use strict';

const { extractReceipt: extractReceiptDefault, reconcile, countEligibleItems, DEFAULT_MODEL } = require('./ocr');
const { abgleichOptionen } = require('./punkteZahlung');
const { enhanceForOcr: enhanceForOcrDefault } = require('./imageEnhance');
const { eskalationsOptionen, denkstufeAus, ocrDenkstufeWirksam, istGemini3 } = require('./geminiModelle');
const { ZWECK } = require('./geminiKennung');
// Prompt-Version (Schalter cashback_config/v1.ocrPrompt, 05.10.2026): ohne
// Angabe v1.4 — der Live-Stand. Alle Lesungen einer Leiter (Basis, Bild-
// verbesserung, Eskalation) nutzen DIESELBE Version.
const { promptOptionen, STANDARD_VERSION: PROMPT_STANDARD } = require('./prompt');

// ═══ Eskalationsstufe (01.10.2026): gemini-3.5-flash HIGH statt gemini-2.5-pro ═══
// gemini-2.5-pro wird auf Vertex am 20.10.2026 abgeschaltet; eine GA-Pro-
// Variante gibt es nicht (3.1-pro nur als Preview → bleibt der Zweitprüfung
// vorbehalten, dort mit Rückfall). Die Wahl fiel auf das stärkste GA-Modell mit
// langer Restlaufzeit auf der höchsten Denkstufe — die Flash-Lesungen davor
// laufen auf der Standardstufe MEDIUM, die Eskalation denkt also weiter als
// sie; nach einem Fehlversuch liest sie mit LOW (Denk-Ausreißer). Messung an
// 38 echten Bons, Standort `eu` und Begründung: lib/geminiModelle.js.
// Rückweg bis 20.10. ohne Codeänderung: CASHBACK_OCR_PRO_MODEL=gemini-2.5-pro
// in der .env (dann der alte Aufruf, Standort europe-west4 — seit 03.10.2026
// mit dem allgemeinen Lese-Zeitlimit, damit auch er das Laufbudget einhält).
const ESKALATION = eskalationsOptionen();
const PRO_MODEL = ESKALATION.model;
// Ungültige Werte (Tippfehler, 0, Kommazahl) gelten als Standard 3. Mit NaN
// verwürfe zwischenstandLaden jeden Zwischenstand ('max_flash', NaN !== NaN).
const MAX_FLASH = (() => {
  const n = Number(process.env.CASHBACK_OCR_MAX_FLASH || 3);
  return Number.isInteger(n) && n >= 1 && n <= 7 ? n : 3;
})();

// ═══ Zeit (Begründung im Kopf der Datei) ═══
const LESE_ZEITLIMIT_MS_STANDARD = 170_000;
const LESE_ZEITLIMIT_MS_MIN = 30_000;
const LAUF_BUDGET_MS_STANDARD = 400_000;
// Unter 200 s passen keine zwei vollen Lese-Fenster mehr in einen Lauf; über
// 450 s bliebe nach der OCR zu wenig Zeit bis zur Laufzeitgrenze in index.js
// (480 s) und dem harten Ende der Function (540 s).
const LAUF_BUDGET_MS_MIN = 200_000;
const LAUF_BUDGET_MS_MAX = 450_000;
// Ein Lese-Fenster muss immer ins Budget passen, sonst gäbe es Läufe ohne
// jeden Fortschritt (Fortsetzung ohne Ende).
const BUDGET_RESERVE_MS = 30_000;
/** So oft je Bon ersetzt ein Zeitabbruch den Lese-Platz, statt ihn zu verbrauchen. */
const ERSATZ_MAX = 3;

const ZWISCHENSTAND_VERSION = 1;
/** Älter ist er nicht verwertbar (z. B. Nachverarbeitung Tage später) → frisch lesen. */
const ZWISCHENSTAND_MAX_ALTER_MS = 6 * 60 * 60 * 1000;

/**
 * Zeitlimit je Lesung und Laufbudget aus der Env. Ungültige Werte gelten als
 * Standard, nie als „kein Limit".
 *   CASHBACK_OCR_READ_TIMEOUT_MS  Zeitlimit je Basis-/Bildverbesserungs-Lesung
 *   CASHBACK_OCR_RUN_BUDGET_MS    Laufbudget der ganzen Leiter je Lauf
 */
function zeitOptionen(env = process.env) {
  const b = Number(env.CASHBACK_OCR_RUN_BUDGET_MS);
  const budgetMs = Number.isFinite(b) && b >= LAUF_BUDGET_MS_MIN && b <= LAUF_BUDGET_MS_MAX ? b : LAUF_BUDGET_MS_STANDARD;
  const l = Number(env.CASHBACK_OCR_READ_TIMEOUT_MS);
  const leseLimitMs = Math.min(
    Number.isFinite(l) && l >= LESE_ZEITLIMIT_MS_MIN ? l : LESE_ZEITLIMIT_MS_STANDARD,
    budgetMs - BUDGET_RESERVE_MS,
  );
  return { budgetMs, leseLimitMs, reserveMs: BUDGET_RESERVE_MS };
}
const ZEIT = zeitOptionen();

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sigOf = (items) => (items || []).map((i) => `${norm(i.name)}#${i.priceCents}`).join('|');

// Abgleich mit den Optionen der Fassung DIESER Lesung (v1.6: eingelöste Punkte
// als Zahlungsmittel; jede andere Fassung: {} → wie bisher).
const abgleichVon = (read) => reconcile(read.parsed, abgleichOptionen(read.promptVersion));

function reconciles(read) {
  return !!read && read.parsed && read.parsed.isReceipt !== false && abgleichVon(read).ok;
}

/** Geht der Abgleich auf den Cent auf (ohne Pfand-Toleranz)? */
function exakt(read) {
  if (!reconciles(read)) return false;
  return abgleichVon(read).signedDeltaCents === 0;
}

/**
 * A (name#price) sequence shared by ≥2 reconciling reads → return one such read.
 * `opts.nurExakt` (wirksame Denkstufe LOW, Begründung im Kopf der Datei):
 * findAgreementNurExakt. Ohne Option unverändert.
 */
function findAgreement(reads, opts = {}) {
  if (opts && opts.nurExakt === true) return findAgreementNurExakt(reads);
  const counts = new Map();
  for (const r of reads) {
    if (!reconciles(r)) continue;
    const s = sigOf(r.parsed.items);
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [s, c] of counts) {
    if (c > bestCount) {
      best = s;
      bestCount = c;
    }
  }
  if (bestCount >= 2) return reads.find((r) => reconciles(r) && sigOf(r.parsed.items) === best);
  return null;
}

/**
 * Einigung unter Denkstufe LOW. Je Folge (name#Preis) der abgeglichenen
 * Lesungen:
 *   • enthält sie eine Eskalations-Lesung, zählen alle ihre Lesungen (wie
 *     bisher);
 *   • sonst (nur normale LOW-Lesungen) zählen nur die exakt abgeglichenen.
 * Gewählt wird wie bisher die Folge mit den meisten zählenden Lesungen (bei
 * Gleichstand die zuerst gelesene), ab zwei; zurück kommt ihre erste zählende
 * Lesung. Bei einer Folge mit Eskalations-Lesung ist das dieselbe Lesung wie
 * in findAgreement — die Bewertung ('high'/'medium') bleibt also gleich.
 */
function findAgreementNurExakt(reads) {
  const folgen = new Map();
  for (const r of reads) {
    if (!reconciles(r)) continue;
    const s = sigOf(r.parsed.items);
    if (!folgen.has(s)) folgen.set(s, []);
    folgen.get(s).push(r);
  }
  let beste = null;
  for (const lesungen of folgen.values()) {
    const mitEskalation = lesungen.some((r) => r.__pro);
    const zaehlend = mitEskalation ? lesungen : lesungen.filter(exakt);
    if (!beste || zaehlend.length > beste.length) beste = zaehlend;
  }
  return beste && beste.length >= 2 ? beste[0] : null;
}

/**
 * Fingerabdruck EINER Lesung über die prämienrelevanten Größen (86cbet2w1).
 *
 * Bis hierher wurden alle nicht gewählten Lesungen in pack() verworfen — die
 * einzige Aussage über die Stabilität der Erkennung war damit die SEQUENZ-
 * Übereinstimmung (name#priceCents über ALLE Positionen). Bei 30 bis 70
 * Positionen kippt die schon eine abweichend gelesene Artikelbezeichnung,
 * obwohl an Markt, Datum, Endsumme und Betrag nichts wackelt.
 *
 * Bewusst ROHWERTE statt eines fertigen Urteils: so bleibt der Vergleich am
 * Dokument nachvollziehbar und auf dem Cache-/Wiederholungspfad neu
 * berechenbar, ohne das Bild noch einmal zu lesen.
 */
function readFingerprint(r, zaehl = {}) {
  const p = (r && r.parsed) || {};
  return {
    isReceipt: p.isReceipt !== false,
    merchant: p.merchant == null ? null : String(p.merchant).slice(0, 120),
    bonCountry: p.bonCountry == null ? null : String(p.bonCountry).slice(0, 8),
    bonDate: typeof p.bonDate === 'string' ? p.bonDate.slice(0, 10) : null,
    bonTime: typeof p.bonTime === 'string' ? p.bonTime.slice(0, 5) : null,
    totalCents: Number.isFinite(p.totalCents) ? p.totalCents : null,
    itemCount: Array.isArray(p.items) ? p.items.length : 0,
    // Zählung je nach Schalter stornoAufrechnen (opts.stornoAufrechnen, nur
    // true rechnet auf; lib/ocr.js). Das Feld-Gate 6w vergleicht den daraus
    // folgenden Betrag — es muss so zählen wie die Geldentscheidung.
    eligibleItems: countEligibleItems(p, zaehl),
    reconOk: reconciles(r),
    model: r && r.__pro ? 'pro' : r && r.__enh ? 'flash-enhanced' : r && r.__haiku ? 'haiku' : 'flash',
    // Gesendete Denkstufe dieser Lesung (08.10.2026): null = keine Vorgabe.
    // Fehlt das Feld, kam die Lesung aus einem Zwischenstand von vor dem
    // Schalter — die Stufe ist dann unbekannt, nicht „keine".
    ...(r && r.__denkstufe !== undefined ? { denkstufe: r.__denkstufe } : {}),
  };
}

function pack(chosen, confidence, method, reads, failedAttempts = 0, zaehl = {}) {
  const proAttempts = reads.filter((r) => r && r.__pro).length;
  const usedEnhanced = reads.some((r) => r && r.__enh);
  const eskalation = reads.find((r) => r && r.__pro);
  const out = { ...chosen };
  delete out.__pro;
  delete out.__enh;
  delete out.__denkstufe;
  delete out.__haiku;
  out.engine = 'gemini-robust';
  out.robust = {
    confidence, // 'high' | 'medium' | 'low' | 'none'
    method, // how the result was chosen
    attempts: reads.length,
    failedAttempts, // geworfene (nicht gezählte) Lese-Versuche — Observability
    proAttempts,
    // Welches Modell die Eskalationsstufe tatsächlich gelesen hat — seit dem
    // Wechsel 01.10.2026 sagt `proAttempts` allein nicht mehr, ob 2.5-pro oder
    // 3.5-flash lief (`reads[].model` bleibt 'pro' für die Vergleichbarkeit).
    escalationModel: eskalation ? eskalation.model || null : null,
    enhanced: usedEnhanced,
    agreement: confidence === 'high' || confidence === 'medium',
    // Alle Lesungen als Fingerabdruck — Grundlage der feldweisen Prüfung im
    // Freigabe-Gate. Kostet keinen zusätzlichen Modell-Aufruf.
    reads: reads.map((r) => readFingerprint(r, zaehl)),
  };
  return out;
}

// ─── Zwischenstand (Fortsetzung über mehrere Läufe) ─────────────────────────

const zahlOderNull = (v) => (Number.isFinite(v) ? v : null);

/** Eine Lesung Firestore-tauglich: ohne `raw` (doppelt zu `parsed`), ohne undefined. */
function lesungSichern(r) {
  return {
    stufe: r.__pro ? 'pro' : r.__enh ? 'enh' : 'flash',
    parsed: r.parsed,
    model: r.model ?? null,
    promptVersion: r.promptVersion ?? null,
    latencyMs: zahlOderNull(r.latencyMs),
    finishReason: r.finishReason ?? null,
    inputTokens: zahlOderNull(r.inputTokens),
    outputTokens: zahlOderNull(r.outputTokens),
    thoughtsTokens: zahlOderNull(r.thoughtsTokens),
    // Firestore nimmt kein undefined — unbekannte Stufe (Lesung aus einem
    // älteren Zwischenstand) bleibt ohne Feld.
    ...(r.__denkstufe !== undefined ? { denkstufe: r.__denkstufe } : {}),
  };
}

function lesungLaden(s) {
  const r = {
    parsed: s.parsed,
    model: s.model ?? null,
    promptVersion: s.promptVersion ?? null,
    latencyMs: s.latencyMs ?? null,
    finishReason: s.finishReason ?? null,
    inputTokens: s.inputTokens ?? null,
    outputTokens: s.outputTokens ?? null,
    thoughtsTokens: s.thoughtsTokens ?? null,
  };
  if (s.stufe === 'pro') r.__pro = true;
  if (s.stufe === 'enh') r.__enh = true;
  if (s.denkstufe === null || typeof s.denkstufe === 'string') r.__denkstufe = s.denkstufe;
  return r;
}

const ganzzahlIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/**
 * Prüft einen am Bon abgelegten Zwischenstand. Verwertbar nur, wenn er zu
 * DIESER Leiter passt (gleiches Modell, gleiche Eskalation, gleicher Prompt,
 * gleiche Zahl an Basis-Lesungen) und frisch ist. Sonst: frisch lesen — ein
 * verworfener Zwischenstand kostet Lesungen, nie eine falsche Entscheidung.
 * Gleicher Prompt heißt seit dem Schalter (05.10.2026): die Version, mit der
 * DIESER Lauf liest — Lesungen von v1.4, v1.5 und v1.6 werden nie gemischt.
 * Ebenso die Denkstufe der normalen Lesungen (08.10.2026, `denkstufe`, null =
 * keine Vorgabe). Ein Zwischenstand von vor dem Schalter trägt kein Feld und
 * gilt als „keine Vorgabe" — ohne Schalter wird er also wie bisher fortgesetzt.
 *
 * @returns {{stand: object|null, grund: string|null}}
 */
function zwischenstandLaden(roh, { model, eskModel, maxFlash, jetzt, promptVersion = PROMPT_STANDARD, denkstufe = null }) {
  if (!roh || typeof roh !== 'object') return { stand: null, grund: null };
  const nein = (grund) => ({ stand: null, grund });
  if (roh.v !== ZWISCHENSTAND_VERSION) return nein('version');
  if (roh.model !== model || roh.eskModel !== eskModel) return nein('modell');
  if (roh.promptVersion !== promptVersion) return nein('prompt');
  if ((roh.denkstufe ?? null) !== (denkstufe ?? null)) return nein('denkstufe');
  if (roh.maxFlash !== maxFlash) return nein('max_flash');
  if (!Number.isFinite(roh.gespeichertMs) || jetzt - roh.gespeichertMs > ZWISCHENSTAND_MAX_ALTER_MS) return nein('alter');
  if (!ganzzahlIn(roh.flash, 0, maxFlash) || !ganzzahlIn(roh.enh, 0, 2) || !ganzzahlIn(roh.esk, 0, 2)
    || !ganzzahlIn(roh.ersatz, 0, ERSATZ_MAX) || !ganzzahlIn(roh.laeufe, 1, 1000)) return nein('zaehler');
  if (!Array.isArray(roh.reads) || !Array.isArray(roh.failed)) return nein('form');
  if (roh.reads.length > roh.flash + roh.enh + roh.esk) return nein('zaehler');
  // `parsed: null` kommt auch im ungestörten Lauf vor (Antwort ohne
  // verwertbares JSON) — die Leiter führt solche Lesungen mit. Sie beim Laden
  // zu verwerfen hieße: jede Fortsetzung beginnt neu (Review 03.10.2026).
  if (!roh.reads.every((s) => s && typeof s === 'object'
    && (s.parsed === null || (typeof s.parsed === 'object' && !Array.isArray(s.parsed)))
    && ['flash', 'enh', 'pro'].includes(s.stufe))) return nein('form');
  return {
    grund: null,
    stand: {
      reads: roh.reads.map(lesungLaden),
      failed: roh.failed.map((f) => String(f)),
      flash: roh.flash,
      enh: roh.enh,
      esk: roh.esk,
      ersatz: roh.ersatz,
      zeitAbbrueche: Number.isInteger(roh.zeitAbbrueche) ? roh.zeitAbbrueche : 0,
      nachFlashGeprueft: roh.nachFlashGeprueft === true,
      nachEnhGeprueft: roh.nachEnhGeprueft === true,
      eskalationGescheitert: roh.eskalationGescheitert === true,
      ausweichGenutzt: typeof roh.ausweichGenutzt === 'string' ? roh.ausweichGenutzt : null,
      // Dieser Lauf ist ein weiterer.
      laeufe: roh.laeufe + 1,
    },
  };
}

function neuerStand() {
  return {
    reads: [],
    failed: [],
    flash: 0, // verbrauchte Basis-Plätze
    enh: 0, // verbrauchte Bildverbesserungs-Plätze
    esk: 0, // verbrauchte Eskalations-Plätze
    ersatz: 0, // genutzte Ersatzversuche nach Zeitabbruch
    zeitAbbrueche: 0,
    nachFlashGeprueft: false, // Eskalations-Deckel nach Phase 1 schon gefragt
    nachEnhGeprueft: false, // … und nach den Bildverbesserungs-Lesungen
    eskalationGescheitert: false,
    ausweichGenutzt: null,
    laeufe: 1,
  };
}

/**
 * @param {Buffer} imageBytes
 * @param {string} mimeType
 * @param {object} [opts] {model, proModel, maxFlash, escalationGate, extract, enhance,
 *                         laufStart, zwischenstand, zeit, clock}
 *   proModel: anderes Eskalationsmodell (Optionen dann wie per Env bestimmt).
 *   extract / enhance: Testnähte; Standard extractReceipt / enhanceForOcr.
 *   laufStart: Start des Function-Laufs (ms). Ohne Angabe kein Laufbudget —
 *     nur das Zeitlimit je Lesung (Skripte, Messungen).
 *   zwischenstand: am Bon abgelegter Stand eines früheren Laufs (roh, wie aus
 *     Firestore) — wird geprüft; unpassend → frisch lesen.
 *   zeit / clock: Testnähte; Standard zeitOptionen() / Date.now.
 *   promptVersion: 'v1.4' | 'v1.5' | 'v1.6' (lib/prompt.js promptVersionAus); fehlt
 *     sie oder ist sie ungültig, liest die Leiter mit v1.4.
 *   stornoAufrechnen: nur `true` (Schalter cashback_config/v1.stornoAufrechnen)
 *     zählt die anrechenbaren Artikel der Fingerabdrücke mit Storno-Aufrechnung
 *     (lib/ocr.js countEligibleItems); sonst wie vor dem 08.10.2026.
 *   denkstufe: 'LOW' (lib/geminiModelle.js ocrDenkstufeWirksam) für Basis-
 *     und Verbessert-Lesungen, nur zusammen mit promptVersion 'v1.5' oder
 *     'v1.6'; fehlt sie, ist sie ungültig oder liest die Leiter mit v1.4: ohne
 *     Denk-Vorgabe wie bisher (Begründung im Kopf der Datei). Wirkt LOW, zählt
 *     eine Einigung zweier LOW-Lesungen nur bei exaktem Abgleich.
 *   escalationGate: optionale async Funktion (reads) => string|null.
 *   Eskalations-Deckel (Kosten, 86cb-Nachtrag 19.08.2026): Liefert sie einen
 *   Grund (z.B. 'bon_too_old'), wird die TEURE Leiter (Enhance-Lesungen +
 *   Pro-Modell) übersprungen und das beste vorhandene Ergebnis zurückgegeben —
 *   der Bon scheitert ohnehin an einem Policy-Gate, jede weitere Lesung wäre
 *   verschwendet. Die eigentliche Ablehnung trifft weiterhin NUR der
 *   Gate-Block in index.js (gleiche Resolver/Berechnungen, kein Drift).
 *   Gate-Fehler führen NIE zum Kappen (fail-open zu voller Qualität).
 * @returns extractReceipt()-shaped result + `robust` metadata.
 * @throws code 'ocr_zeitbudget' (+ `zwischenstand`) — Budget erreicht, KEIN Ergebnis;
 *         code 'ocr_unavailable' — keine einzige Lesung kam zurück.
 */
async function extractReceiptRobust(imageBytes, mimeType, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const esk = opts.proModel && opts.proModel !== ESKALATION.model
    ? eskalationsOptionen({ ...process.env, CASHBACK_OCR_PRO_MODEL: opts.proModel })
    : ESKALATION;
  const extractReceipt = opts.extract || extractReceiptDefault;
  const enhanceForOcr = opts.enhance || enhanceForOcrDefault;
  const maxFlash = opts.maxFlash || MAX_FLASH;
  // Prompt, Schema und Versions-Etikett — für JEDE Lesung dieser Leiter gleich.
  const prompt = promptOptionen(opts.promptVersion);
  // Denkstufe der normalen Lesungen (08.10.2026). Wirkt nur mit Prompt v1.5
  // oder v1.6 (gemessen ist nur v1.5; v1.6 ist deren Nachbesserung; lib/geminiModelle.js
  // ocrDenkstufeWirksam) — die Regel steht HIER, wo die Stufe gesendet wird,
  // damit auch Aufrufer außer index.js sie nicht umgehen. Nur Gemini 3 kennt
  // Denkstufen (`thinkingLevel`); ein älteres Modell nimmt nur `thinkingBudget`
  // — dann wirkt der Schalter nicht. Beides sichtbar gemeldet, der Bon
  // dokumentiert null.
  const denkWahl = ocrDenkstufeWirksam(opts.denkstufe, prompt.promptVersion);
  if (denkWahl.grund === 'ohne_v15') console.warn('ocr-denkstufe-ohne-v15', { promptVersion: prompt.promptVersion, denkstufe: denkstufeAus(opts.denkstufe) });
  const denkstufe = denkWahl.denkstufe && istGemini3(model) ? denkWahl.denkstufe : null;
  if (denkWahl.denkstufe && !denkstufe) console.warn('ocr-denkstufe-ignoriert', { model, denkstufe: denkWahl.denkstufe });
  // Ohne Stufe: KEIN Feld — die Aufruf-Optionen bleiben exakt wie bisher.
  const denkVorgabe = denkstufe ? { thinkingConfig: { thinkingLevel: denkstufe } } : {};
  // Unter der WIRKSAMEN Stufe LOW zählt eine Einigung zweier LOW-Lesungen nur
  // bei exaktem Abgleich (Kopf der Datei). Hängt an `denkstufe`, nicht am
  // Schalter: wo die Stufe nicht gesendet wird, gilt die Einigung wie bisher.
  const nurExakt = denkstufe === 'LOW';
  const einigung = { nurExakt };
  // Storno-Aufrechnung beim Zählen der Fingerabdrücke (Schalter
  // cashback_config/v1.stornoAufrechnen, 08.10.2026): nur `true` wirkt, sonst
  // zählen die Fingerabdrücke wie vor dem 08.10.2026. Ändert keine Anfrage.
  const stornoAn = opts.stornoAufrechnen === true;
  const zaehl = stornoAn ? { stornoAufrechnen: true } : {};
  const zeit = opts.zeit || ZEIT;
  const clock = opts.clock || Date.now;
  const frist = Number.isFinite(opts.laufStart) ? opts.laufStart + zeit.budgetMs : null;
  const leseLimit = zeit.leseLimitMs;
  // Eskalation: ihr eigenes Limit (geminiModelle.js, 150 s); ein Modell ohne
  // eigenes (2.5-pro-Rückweg) bekommt das allgemeine. Nie größer als ein
  // Fenster im Budget.
  const eskLimit = Math.min(esk.timeoutMs > 0 ? esk.timeoutMs : leseLimit, zeit.budgetMs - zeit.reserveMs);

  const geladen = zwischenstandLaden(opts.zwischenstand, { model, eskModel: esk.model, maxFlash, jetzt: clock(), promptVersion: prompt.promptVersion, denkstufe });
  if (geladen.grund) console.warn('ocr-zwischenstand-verworfen', { grund: geladen.grund });
  const st = geladen.stand || neuerStand();
  // Auch ein verworfener Stand zählt als Lauf — sonst begänne die Zählung bei
  // jedem Verwerfen wieder bei 1 (Review 03.10.2026). Die harte Grenze hängt
  // zusätzlich am Bon selbst (index.js, ocrFortsetzungen).
  if (geladen.grund && opts.zwischenstand && ganzzahlIn(opts.zwischenstand.laeufe, 1, 1000)) {
    st.laeufe = opts.zwischenstand.laeufe + 1;
  }

  // Incident 19.08.2026: geworfene Versuche wurden hier still verschluckt.
  // Bei Totalausfall (z.B. 429 Spending-Cap) blieb `reads` leer → Phase 4
  // lieferte den isReceipt:false-Stub → Nutzer sah fälschlich „kein
  // Kassenbon". Jetzt: jeden Fehlversuch loggen + sammeln; bleibt ALLES
  // leer, ist das ein Infrastrukturfehler → werfen (Retry/Review), nie Stub.
  const noteFailure = (phase, e) => {
    st.failed.push(`${phase}: ${String(e && e.message ? e.message : e).slice(0, 160)}`);
    console.warn('ocr-attempt-failed', { phase, err: String(e && e.message ? e.message : e).slice(0, 300) });
  };

  /** Ein Lese-Versuch; wirft nie. */
  const versuch = async (phase, bytes, mime, callOpts) => {
    try {
      return { r: await extractReceipt(bytes, mime, callOpts) };
    } catch (e) {
      noteFailure(phase, e);
      return { r: null, zeit: !!e && e.code === 'ocr_timeout' };
    }
  };

  /**
   * Verbraucht der Versuch seinen Lese-Platz? Eine Lesung ja; ein Abbruch durch
   * das eigene Zeitlimit bei Basis- und Bildverbesserungs-Lesungen nicht,
   * solange Ersatzversuche übrig sind; jeder andere Fehlversuch ja (wie bisher).
   * Bei der Eskalation verbraucht auch der Zeitabbruch den Platz: dort fängt das
   * 150-s-Limit die Denk-Ausreißer der hohen Denkstufe ab, und der nächste
   * Versuch liest mit der Ausweich-Stufe (lib/geminiModelle.js, 01.10.2026).
   */
  const verbraucht = (e, { eskalation = false } = {}) => {
    if (e.r) return true;
    if (e.zeit) {
      st.zeitAbbrueche++;
      if (!eskalation && st.ersatz < ERSATZ_MAX) {
        st.ersatz++;
        return false;
      }
    }
    return true;
  };

  /** Passt ein volles Lese-Fenster noch ins Laufbudget? */
  const fensterFrei = (limit) => frist == null || frist - clock() >= limit;

  /** Budget erreicht: Zwischenstand mitgeben, kein Ergebnis — also keine Entscheidung. */
  const anhalten = () => {
    const err = new Error(`ocr_zeitbudget: Laufbudget erreicht nach ${st.reads.length} Lesungen (${st.failed.length} Fehlversuche, Lauf ${st.laeufe})`);
    err.code = 'ocr_zeitbudget';
    err.zwischenstand = {
      v: ZWISCHENSTAND_VERSION,
      model,
      eskModel: esk.model,
      promptVersion: prompt.promptVersion,
      denkstufe,
      maxFlash,
      gespeichertMs: clock(),
      laeufe: st.laeufe,
      flash: st.flash,
      enh: st.enh,
      esk: st.esk,
      ersatz: st.ersatz,
      zeitAbbrueche: st.zeitAbbrueche,
      nachFlashGeprueft: st.nachFlashGeprueft,
      nachEnhGeprueft: st.nachEnhGeprueft,
      eskalationGescheitert: st.eskalationGescheitert,
      ausweichGenutzt: st.ausweichGenutzt,
      failed: st.failed.slice(),
      reads: st.reads.map(lesungSichern),
    };
    throw err;
  };

  const zeugeBerichtRef = { wert: null };
  const fertig = (out) => {
    // Stufe der normalen Lesungen dieser Leiter (null = keine Vorgabe) — trennt
    // Bons vor und nach dem Umschalten (08.10.2026).
    out.robust.denkstufe = denkstufe;
    // Nur bei eingeschalteter Aufrechnung vermerkt (sonst kein Feld → der Bon
    // sieht aus wie vor dem Schalter). Zeigt, wie `reads[].eligibleItems` zählt.
    if (stornoAn) out.robust.stornoAufrechnen = true;
    // Nur unter LOW vermerkt (sonst kein Feld → Bon wie vor dem 08.10.2026):
    // dass die strengere Einigung galt, und je Lesung, ob sie exakt abglich.
    if (nurExakt) {
      out.robust.einigungNurExakt = true;
      out.robust.reads.forEach((fp, i) => {
        if (st.reads[i]) fp.reconExakt = exakt(st.reads[i]);
      });
    }
    out.robust.laeufe = st.laeufe;
    out.robust.zeitAbbrueche = st.zeitAbbrueche;
    // Bericht des Mistral-Zeugen (Phase 0), auch wenn er nicht bestätigt hat.
    if (zeugeBerichtRef.wert && !out.robust.zeuge) out.robust.zeuge = zeugeBerichtRef.wert;
    if (st.ausweichGenutzt) out.robust.escalationFallbackThinking = st.ausweichGenutzt;
    return out;
  };

  // Phase 0 — Mistral-Zeuge (Patrick 10.10.2026, Schalter
  // cashback_config/v1.mistralZeuge === true; index.js reicht `opts.zeuge` nur
  // dann). EINE Basis-Lesung statt zwei gleichzeitig; besteht sie ihre eigene
  // Summenprobe, wird der Zeuge gefragt. Bestätigt er (Summe, Tag/Monat,
  // Uhrzeit; Markt und Betrag prüft der Aufrufer), gilt diese Lesung —
  // Bewertung 'high', Methode 'zeuge-agreement'. Sonst zählt die Lesung als
  // erste Basis-Lesung, und Phase 1 läuft genau wie bisher weiter (kostet
  // nichts extra, nur die Wartezeit des Zeugen). Nur auf frischer Leiter: eine
  // Fortsetzung (Zwischenstand) fragt nicht erneut. Ein Fehler des Zeugen ist
  // nie ein Urteil über den Bon — dann ebenfalls wie bisher weiter.
  const zeugeFenster = Number.isFinite(opts.zeugeFensterMs) ? opts.zeugeFensterMs : 30000;
  // Erste Lesung durch einen anderen, billigen Leser (Haiku 5.5, Schalter
  // cashback_config/v1.haikuLeser === true, Patrick 10.10.2026). Bestätigt der
  // Zeuge, gilt sie (Methode 'zeuge-agreement', robust.ersterLeser). Sonst wird
  // sie VERWORFEN — sie mischt sich nie in die Einigung der Gemini-Lesungen —,
  // und die Leiter läuft exakt wie ohne Zeugen (zwei Basis-Lesungen gleichzeitig).
  if (typeof opts.zeuge === 'function' && typeof opts.ersterLeser === 'function'
    && st.reads.length === 0 && st.flash === 0 && maxFlash >= 2
    && fensterFrei(leseLimit + zeugeFenster + (Number.isFinite(opts.ersterLeserFensterMs) ? opts.ersterLeserFensterMs : 60000))) {
    let h = null;
    try {
      h = await opts.ersterLeser();
    } catch (err) {
      zeugeBerichtRef.wert = { status: 'erster_leser_fehler', fehler: String(err && err.message ? err.message : err).slice(0, 200) };
      console.warn('ocr-erster-leser-fehler', { err: String(err && err.message ? err.message : err).slice(0, 200) });
    }
    if (h && h.parsed) {
      h.__haiku = true;
      h.__denkstufe = null;
      if (reconciles(h) && (!nurExakt || exakt(h))) {
        let bericht = null;
        try {
          bericht = await opts.zeuge(h);
        } catch (err) {
          bericht = { status: 'fehler', fehler: String(err && err.message ? err.message : err).slice(0, 200) };
        }
        if (bericht) bericht.ersterLeser = h.model || 'haiku';
        zeugeBerichtRef.wert = bericht;
        if (bericht && bericht.bestaetigt === true) {
          const out = pack(h, 'high', 'zeuge-agreement', [h], st.failed.length, zaehl);
          out.robust.zeuge = bericht;
          out.robust.ersterLeser = h.model || 'haiku';
          return fertig(out);
        }
      } else {
        zeugeBerichtRef.wert = { status: 'nicht_gefragt', grund: 'summenprobe', ersterLeser: h.model || 'haiku' };
      }
    }
  } else if (typeof opts.zeuge === 'function' && st.reads.length === 0 && st.flash === 0 && maxFlash >= 2
    && fensterFrei(leseLimit + zeugeFenster)) {
    const e = await versuch(`flash-${st.flash + 1}`, imageBytes, mimeType, { model, timeoutMs: leseLimit, ...prompt, ...denkVorgabe, zweck: ZWECK.BON_OCR });
    if (verbraucht(e)) st.flash++;
    if (e.r) {
      e.r.__denkstufe = denkstufe;
      st.reads.push(e.r);
      if (reconciles(e.r) && (!nurExakt || exakt(e.r))) {
        let zeugeBericht = null;
        try {
          zeugeBericht = await opts.zeuge(e.r);
        } catch (err) {
          zeugeBericht = { status: 'fehler', fehler: String(err && err.message ? err.message : err).slice(0, 200) };
        }
        zeugeBerichtRef.wert = zeugeBericht;
        if (zeugeBericht && zeugeBericht.bestaetigt === true) {
          const out = pack(e.r, 'high', 'zeuge-agreement', st.reads, st.failed.length, zaehl);
          out.robust.zeuge = zeugeBericht;
          return fertig(out);
        }
      } else {
        zeugeBerichtRef.wert = { status: 'nicht_gefragt', grund: 'summenprobe' };
      }
    }
  }

  // Phase 1 — flash self-consistency with early stop on agreement. Solange
  // noch keine zwei Lesungen da sind, laufen die fehlenden gleichzeitig (eine
  // Einigung braucht ohnehin zwei); danach eine nach der anderen.
  while (st.flash < maxFlash) {
    if (!fensterFrei(leseLimit)) anhalten();
    const n = Math.max(1, Math.min(2 - st.reads.length, maxFlash - st.flash));
    const ergebnisse = await Promise.all(
      Array.from({ length: n }, (_, k) => versuch(`flash-${st.flash + k + 1}`, imageBytes, mimeType, { model, timeoutMs: leseLimit, ...prompt, ...denkVorgabe, zweck: ZWECK.BON_OCR })),
    );
    for (const e of ergebnisse) {
      if (verbraucht(e)) st.flash++;
      if (e.r) {
        e.r.__denkstufe = denkstufe;
        st.reads.push(e.r);
      }
    }
    const agreed = findAgreement(st.reads, einigung);
    if (agreed) return fertig(pack(agreed, 'high', 'flash-agreement', st.reads, st.failed.length, zaehl));
  }

  // Eskalations-Deckel: Vor der teuren Leiter (Enhance + Pro) prüfen, ob der
  // Bon laut ≥2 unabhängigen Basis-Lesungen ohnehin an einem Policy-Gate
  // scheitern wird. Wenn ja: bestes vorhandenes Ergebnis zurückgeben, Leiter
  // sparen. Confidence bleibt ehrlich (low/none) — sollte der Bon wider
  // Erwarten alle Gates passieren, hält das Review-Gate ihn (nie Auto-Payout).
  const checkCap = async () => {
    if (typeof opts.escalationGate !== 'function') return null;
    try {
      return await opts.escalationGate(st.reads);
    } catch (e) {
      console.warn('escalation-gate-failed', { err: String(e && e.message ? e.message : e).slice(0, 200) });
      return null; // fail-open: volle Qualität
    }
  };
  const gekappt = (capReason) => {
    const best = st.reads.find(reconciles) || st.reads[0];
    if (!best) return null;
    const out = pack(best, reconciles(best) ? 'low' : 'none', `escalation-capped:${capReason}`, st.reads, st.failed.length, zaehl);
    out.robust.cappedReason = capReason;
    return fertig(out);
  };
  if (!st.nachFlashGeprueft) {
    const capReason = await checkCap();
    const out = capReason ? gekappt(capReason) : null;
    if (out) return out;
    st.nachFlashGeprueft = true;
  }

  // Phase 1.5 — no agreement on the ORIGINAL → enhance the image (upscale +
  // sharpen + contrast) and read it again. Image quality, not reasoning, is
  // the bottleneck on creased bons. Best-effort: fall back to original bytes.
  // In einem Folgelauf wird das Bild erneut verbessert (gleiche Umrechnung).
  let enhanced = null;
  try {
    enhanced = await enhanceForOcr(imageBytes);
  } catch (e) {
    enhanced = null;
  }
  const escImg = enhanced || imageBytes;
  if (enhanced) {
    while (st.enh < 2) {
      if (!fensterFrei(leseLimit)) anhalten();
      const e = await versuch(`enhanced-${st.enh + 1}`, escImg, 'image/jpeg', { model, timeoutMs: leseLimit, ...prompt, ...denkVorgabe, zweck: ZWECK.BON_OCR_VERBESSERT });
      if (verbraucht(e)) st.enh++;
      if (!e.r) continue;
      e.r.__enh = true;
      e.r.__denkstufe = denkstufe;
      st.reads.push(e.r);
      const agreed = findAgreement(st.reads, einigung);
      if (agreed) return fertig(pack(agreed, 'high', 'enhanced-agreement', st.reads, st.failed.length, zaehl));
    }
  }

  // Eskalations-Deckel, zweiter Check-Punkt: die Enhance-Lesungen können das
  // Policy-Signal erhärtet haben; die Pro-Phase ist die teuerste Stufe.
  if (!st.nachEnhGeprueft) {
    const capReason2 = await checkCap();
    const out = capReason2 ? gekappt(capReason2) : null;
    if (out) return out;
    st.nachEnhGeprueft = true;
  }

  // Phase 2 — escalate on the (enhanced) image; agreement incl. an
  // escalation read. Scheitert ein Versuch (Denk-Ausreißer bis MAX_TOKENS,
  // Zeitlimit, 429), liest der nächste mit der Ausweich-Denkstufe (LOW) —
  // sonst bliebe ausgerechnet auf den schwersten Bons gar keine Lesung übrig.
  while (st.esk < 2) {
    if (!fensterFrei(eskLimit)) anhalten();
    const ausweichen = st.eskalationGescheitert && !!esk.ausweichThinkingConfig;
    const denken = ausweichen ? esk.ausweichThinkingConfig : esk.thinkingConfig;
    const e = await versuch(`pro-${st.esk + 1}`, escImg, enhanced ? 'image/jpeg' : mimeType, {
      model: esk.model,
      ...prompt,
      // Ausdrücklich gesetzt → hat Vorrang vor CASHBACK_OCR_THINKING_BUDGET
      // (ein `thinkingBudget` würde Gemini 3 mit 400 ablehnen).
      ...(denken ? { thinkingConfig: denken } : {}),
      ...(esk.standort ? { location: esk.standort } : {}),
      ...(Number.isFinite(esk.temperature) ? { temperature: esk.temperature } : {}),
      // Hartes Zeitlimit je Lesung (lib/geminiModelle.js), nie über das Budget.
      timeoutMs: eskLimit,
      // Kosten-Kennung: die Eskalation steht in der Rechnung als eigene Stufe.
      zweck: ZWECK.BON_OCR_ESKALATION,
    });
    if (verbraucht(e, { eskalation: true })) st.esk++;
    if (!e.r) {
      st.eskalationGescheitert = true;
      continue;
    }
    e.r.__pro = true;
    // Eigene Stufe der Eskalation (unabhängig vom Schalter); 2.5-pro-Rückweg ohne.
    e.r.__denkstufe = (denken && denken.thinkingLevel) || null;
    if (ausweichen) st.ausweichGenutzt = denken.thinkingLevel;
    st.reads.push(e.r);
    const agreed = findAgreement(st.reads, einigung);
    if (agreed) {
      const conf = agreed.__pro ? 'medium' : 'high';
      return fertig(pack(agreed, conf, 'pro-agreement', st.reads, st.failed.length, zaehl));
    }
  }

  // Infrastruktur-Gate (Incident 19.08.2026): KEIN einziger Versuch hat eine
  // Antwort geliefert → das Bild wurde nie angesehen. Das ist ein Backend-
  // Ausfall (429/Netz/Auth/Zeitlimit), NIEMALS eine Aussage über den Bon.
  // Werfen statt Stub → index.js behandelt es als transient (Retry, danach
  // 'review').
  if (st.reads.length === 0) {
    const err = new Error(`ocr_unavailable: all ${st.failed.length} read attempts failed — last: ${st.failed[st.failed.length - 1] || 'n/a'}`);
    err.code = 'ocr_unavailable';
    throw err;
  }

  // Phase 3 — no agreement. Prefer any reconciling read (best-effort), low conf.
  const anyRec = st.reads.find(reconciles);
  if (anyRec) return fertig(pack(anyRec, 'low', 'reconcile-no-agreement', st.reads, st.failed.length, zaehl));

  // Phase 4 — nothing reconciles; hand back the first read for the recon gate.
  // `reads` ist hier garantiert nicht leer (Infrastruktur-Gate oben) — der
  // Stub-Fallback bleibt nur als Form-Sicherheit erhalten.
  const first = st.reads[0] || { parsed: { isReceipt: false, items: [] }, model, promptVersion: null, latencyMs: 0 };
  return fertig(pack(first, 'none', 'no-reconcile', st.reads, st.failed.length, zaehl));
}

module.exports = {
  extractReceiptRobust,
  sigOf,
  zeitOptionen,
  zwischenstandLaden,
  PRO_MODEL,
  ESKALATION,
  ZEIT,
  ERSATZ_MAX,
  MAX_FLASH,
  ZWISCHENSTAND_VERSION,
};
