'use strict';

/**
 * Modellwahl und Vertex-Standort der Bon-OCR — EINE Stelle für ocr.js,
 * ocr_cvhybrid.js, ocr_robust.js und ocr_referee.js.
 *
 * ═══ Warum es das gibt (01.10.2026) ═══
 * gemini-2.5-pro wird auf Vertex am 20.10.2026 abgeschaltet (Lifecycle-Seite
 * docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions,
 * abgerufen 01.10.2026; eine ältere Release-Note nannte den 16.10.). Es war die
 * Eskalationsstufe der Robust-OCR und der Rückfall der Zweitprüfung. Die
 * Standortwahl stand bis dahin als Regex `/2\.5-pro/` doppelt in ocr.js und
 * ocr_cvhybrid.js — wer das Modell tauscht, musste beide Stellen finden.
 *
 * ═══ Lebensdauer (Lifecycle-Seite, 01.10.2026) ═══
 *   gemini-3.5-flash        GA, bis mindestens 19.05.2027
 *   gemini-3.5-flash-lite   GA, bis mindestens 21.07.2027
 *   gemini-3.1-pro-preview  Preview, kein Datum zugesagt — nur als Rückfall
 *   gemini-3.6/3.7/3.8-flash  „kürzere Verfügbarkeit": Abschaltung mit nur
 *                           45 Tagen Vorlauf — NICHT als Standard verwenden
 *   gemini-2.5-pro/-flash   Abschaltung 20.10.2026
 *   Eine GA-Pro-Variante gibt es auf Vertex derzeit nicht (gemini-3.1-pro,
 *   gemini-3.5-pro, gemini-3-pro-preview: 404 an allen Standorten).
 *
 * ═══ Erreichbarkeit je Standort (curl generateContent, Projekt
 *     markendetektive-895f7, 01.10.2026; 200 = erreichbar) ═══
 *   gemini-3.5-flash        global, eu, europe-west3   (404: europe-west4, europe-west1)
 *   gemini-3.5-flash-lite   global, eu                 (404: europe-west3/-west4/-west1)
 *   gemini-3.1-pro-preview  nur global
 *   gemini-2.5-pro          global, europe-west4, europe-west1 (404: eu, europe-west3)
 * Laut Modellseite ist 3.5-flash im Standard-PayGo nur unter global und den
 * Multi-Regionen us/eu gelistet — europe-west3 antwortet zwar, ist aber nicht
 * zugesagt. Deshalb `eu`, nicht `europe-west3`.
 *
 * ═══ Messung an echten Bons (01.10.2026, nur lesend) ═══
 * 38 Bons der letzten 21 Tage, bei denen die 2.5-pro-Eskalation tatsächlich
 * lief (geschichtet: 12 mit Einigung, 18 „low", 8 „none"). Je Kandidat zwei
 * Lesungen auf dem verbesserten Bild mit Pipeline-Prompt v1.4 und den
 * Pipeline-Parametern (Temperatur 0.1, 32.768 Ausgabe-Token), verglichen mit
 * dem gespeicherten Endergebnis (Markt, Datum, Endsumme, anrechenbare Artikel).
 *
 *   Kandidat                  Antwort  Σ=Endsumme  4 Geldfelder=Ende  Zeugenpaar*  Median/p90
 *   2.5-pro (bisher)           76/76     40/76       60/76             14/38       57 s/119 s
 *   3.5-flash HIGH, eu         65/76     43/76       59/65             18/38       29 s/ 63 s
 *   3.5-flash MEDIUM, eu       60/76     37/76       50/60             16/38       21 s/ 60 s
 *   3.5-flash LOW, eu          74/76     34/76       61/74             15/38        7 s/ 13 s
 *   3.1-pro-preview LOW        72/76     39/76       56/72             16/38       19 s/ 43 s
 *   HIGH, nach Fehlversuch LOW (simuliert aus denselben Lesungen):
 *                              ≥1 Antwort 37/38, ≥1 stimmig 25/38 (2.5-pro 38 / 24), Zeugenpaar 18/38
 *   * beide Lesungen in sich stimmig und einig über alle vier Geldfelder —
 *     alle 18 Paare der gewählten Variante entsprachen dem Endergebnis.
 * Ausfälle bei 3.5-flash HIGH/MEDIUM: fast nur MAX_TOKENS (Denken bis zum
 * Ausgabelimit, Median 122 s) auf langen, zerknitterten Bons — dagegen die
 * Ausweich-Denkstufe LOW. 2 × 400 bei allen Gemini-3-Modellen: ein bei
 * 512 KiB abgeschnittener Upload, den nur 2.5-pro noch las (1 von 786
 * eskalierten Bons in 30 Tagen). Temperatur 1.0 statt 0.1 brachte nichts
 * (Zeugenpaare 16 statt 17), deshalb Pipeline-Wert.
 * Kosten je erfolgreicher Lesung: 2.5-pro 0,092 $, 3.5-flash HIGH eu 0,084 $,
 * LOW eu 0,024 $; ein MAX_TOKENS-Fehlversuch kostet ~0,33 $. Erwartet je
 * eskaliertem Bon ~0,22 $ statt ~0,18 $ (+~25 $/Monat bei ~790 Bons).
 */

/** Gemini-3-Familie (3, 3.1, 3.5 …): Denken über `thinkingLevel`, nie `thinkingBudget`. */
const istGemini3 = (model) => /gemini-3/i.test(String(model || ''));

/** Die Ablösung betrifft genau dieses Modell; es läuft nur regional zuverlässig. */
const istGemini25Pro = (model) => /gemini-2\.5-pro/i.test(String(model || ''));

/**
 * Standard der Eskalationsstufe (Robust-OCR) und des Rückfalls der Zweitprüfung.
 * GA mit langer Restlaufzeit; Messung oben.
 */
const ESKALATION_MODELL_STANDARD = 'gemini-3.5-flash';
const ESKALATION_DENKSTUFE_STANDARD = 'HIGH';
/**
 * Denkstufe des zweiten Eskalationsversuchs, wenn der erste gescheitert ist.
 * Gemessen 01.10.2026: auf langen, zerknitterten Bons denkt 3.5-flash auf
 * HIGH (und auf dem Standard MEDIUM) in ~12–16 % der Lesungen bis zum
 * Ausgabelimit (MAX_TOKENS, 32.768 Token, ~2 min) und liefert NICHTS — genau
 * auf den Bons, auf denen schon die Flash-Lesungen so scheiterten. LOW denkt
 * praktisch nicht und lieferte auf allen 38 Testbons eine Antwort (nur der eine
 * abgeschnittene Upload scheiterte, wie bei jedem Gemini-3-Modell).
 */
const ESKALATION_AUSWEICH_DENKSTUFE_STANDARD = 'LOW';

/**
 * Modelle, die unter der Multi-Region `eu` erreichbar sind (gemessen, s. o.).
 * Nur für diese werden Eskalation und Rückfall der Zweitprüfung standardmäßig
 * dorthin gelegt.
 *
 * Warum nicht `global` wie die Primärlesungen: Vertex verteilt Kapazität je
 * Standort. 2.5-pro lief regional (europe-west4) und war damit ein ZWEITER
 * Kapazitätspool — in den 30 Tagen vor dem Umbau wurden 53 Bons nur dadurch
 * gelesen, dass alle Flash-Lesungen unter `global` scheiterten (429, Netz) und
 * die Eskalation woanders antwortete. gemini-3.5-flash sah in derselben Zeit
 * unter `global` 3.480 × 429 (4 %). Läge die Eskalation ebenfalls auf `global`,
 * fiele dieser Ausweg weg. `eu` ist laut Modellseite für Standard-PayGo
 * zugesagt; Aufpreis +10 % gegenüber global (Preisliste 01.10.2026).
 */
const EU_ERREICHBAR = new Set(['gemini-3.5-flash', 'gemini-3.5-flash-lite']);

/** Standort für Eskalation/Rückfall: Env-Wert, sonst eu wenn erreichbar, sonst Modell-Standard. */
function ausweichStandort(model, envWert) {
  if (envWert) return envWert;
  return EU_ERREICHBAR.has(model) ? 'eu' : undefined;
}

const ERLAUBTE_DENKSTUFEN = new Set(['MINIMAL', 'LOW', 'MEDIUM', 'HIGH']);

/**
 * ═══ Denkstufe der normalen Flash-Lesungen (08.10.2026) ═══
 * Schalter `cashback_config/v1.ocrDenkstufe`: 'LOW' gibt den Basis-Lesungen
 * und den Lesungen am verbesserten Bild der Robust-OCR (lib/ocr_robust.js) ein
 * `thinkingConfig: { thinkingLevel: 'LOW' }` mit. Fehlt der Wert oder ist er
 * ungültig, gilt das Verhalten wie bisher: KEINE Denk-Vorgabe (das Modell denkt
 * nach seinem eigenen Standard). Ab Werk ist das Feld nicht gesetzt — der
 * Deploy ändert an den Anfragen nichts (byte-gleich belegt in
 * __tests__/ocrDenkstufe.test.js).
 *
 * Nicht betroffen: Eskalation (eskalationsOptionen oben, eigene Stufe HIGH/
 * Ausweich LOW), Zweitprüfung (lib/ocr_referee.js, eigene Stufe) und die
 * Rückfall-Engine cv-hybrid. Sie übergeben ihre Stufe selbst bzw. bleiben wie
 * sie sind.
 *
 * NUR 'LOW' ist freigegeben — der einzige gemessene Wert (Messung 08.10.:
 * LOW ≈ ohne Denken). MEDIUM und HIGH sind für die normalen Lesungen nicht
 * gemessen, und dort gibt es keinen Ausweg auf eine niedrigere Stufe (anders
 * als bei der Eskalation, HIGH → LOW): ein Denk-Ausreißer bis MAX_TOKENS
 * (ocr_json_decode) verbraucht den Lese-Platz ohne Ersatzversuch — ersetzt
 * wird nur der Zeitabbruch (lib/ocr_robust.js `verbraucht`). Gemessen an der
 * Eskalation mit HIGH: 11 von 52 Versuchen bis MAX_TOKENS, 2 am Zeitlimit.
 * Folge wären weniger Lesungen, seltener Einigung, mehr Eskalation und mehr
 * Bons mit Bewertung none/low. MEDIUM/HIGH erst nach eigener Messung UND mit
 * Ausweich-Stufe für die normalen Lesungen freigeben.
 *
 * LOW wirkt NUR zusammen mit Prompt v1.5 (`ocrPrompt: 'v1.5'`) — nur diese
 * Kombination ist an ≥ 268 Bons gemessen. v1.4 + LOW lief nur in der ersten
 * Messung (60 Bons) und lehnte dort 4 von 58 korrekten Bons ab, 3 davon mit
 * Coupon (v1.4 verlangt das Umrechnen auf die Artikel, ohne Denken scheitert es).
 * Die Kopplung steht im Code (`ocrDenkstufeWirksam`), nicht nur in der
 * Anleitung: mit v1.4 wird die Stufe nicht gesendet und gemeldet
 * (`ocr-denkstufe-ohne-v15`). Die Reihenfolge beim Setzen und Entfernen der
 * beiden Felder ist damit gleichgültig; jedes der beiden schaltet LOW ab.
 * Seit 08.10.2026 wirkt LOW auch mit v1.6 — der Nachbesserung genau dieser
 * Variante (lib/prompt.js, gleiches Schema, Regeln aus Messung 2). v1.6 + LOW
 * ist NICHT gemessen. Grund-Code (`ohne_v15`) und Meldung
 * (`ocr-denkstufe-ohne-v15`) behalten ihren Namen, damit Auswertungen der
 * Logs nicht brechen; sie bedeuten „weder v1.5 noch v1.6".
 *
 * Genau geprüft wie `ocrPrompt` (lib/prompt.js promptVersionAus): Groß-
 * schreibung, keine Leerzeichen, nur dieser Wert. MINIMAL kennt Gemini 3
 * zwar, ist aber nicht gemessen und deshalb hier nicht freigegeben. Ein
 * ungültiger Wert wirkt nicht — index.js meldet ihn (`ocr-denkstufe-ungueltig`),
 * damit ein Tippfehler nicht still „aus" bedeutet.
 */
const OCR_DENKSTUFEN = new Set(['LOW']);

/** Prompt-Fassungen, mit denen die Denkstufe wirkt (v1.5 gemessen, v1.6 = deren Nachbesserung). */
const OCR_DENKSTUFE_PROMPTE = new Set(['v1.5', 'v1.6']);

/** Wert von `cashback_config/v1.ocrDenkstufe` → 'LOW' | null (keine Vorgabe). */
function denkstufeAus(wert) {
  return typeof wert === 'string' && OCR_DENKSTUFEN.has(wert) ? wert : null;
}

/**
 * Wirksame Denkstufe einer Leiter: gültiger Wert UND Prompt v1.5 oder v1.6.
 * @param {*} wert Schalterwert `ocrDenkstufe`
 * @param {string} promptVersion bereits geprüfte Version (lib/prompt.js promptVersionAus)
 * @returns {{ denkstufe: 'LOW'|null, grund: null|'ungueltig'|'ohne_v15' }}
 *   grund null = nichts zu melden (Wert fehlt, oder er wirkt).
 */
function ocrDenkstufeWirksam(wert, promptVersion) {
  if (wert == null) return { denkstufe: null, grund: null };
  const stufe = denkstufeAus(wert);
  if (!stufe) return { denkstufe: null, grund: 'ungueltig' };
  if (!OCR_DENKSTUFE_PROMPTE.has(promptVersion)) return { denkstufe: null, grund: 'ohne_v15' };
  return { denkstufe: stufe, grund: null };
}

/**
 * Zeitlimit je Eskalationslesung. gemini-2.5-pro lief ohne Limit (gemessen
 * 01.10.2026 an 38 eskalierten Bons: Median 57 s, p90 119 s, Maximum 198 s).
 * 3.5-flash HIGH ist im Mittel schneller (erfolgreiche Lesungen ≤ 140 s),
 * Denk-Ausreißer bis MAX_TOKENS liefen aber bis 236 s. processCashback hat
 * 540 s für ALLES — bis zu fünf Flash-Lesungen liegen davor. Das Limit
 * begrenzt die Eskalation hart; ein abgebrochener Versuch zählt wie jeder
 * Fehlversuch (`failedAttempts`), der nächste liest mit der Ausweich-Denkstufe.
 */
const ESKALATION_ZEITLIMIT_MS_STANDARD = 150_000;
const ESKALATION_ZEITLIMIT_MS_MIN = 30_000;

/**
 * Vertex-Standort für einen Aufruf.
 *
 * @param {string} model
 * @param {object} [opts]
 * @param {string} [opts.standort]  Ausdrücklich gewünschter Standort (hat Vorrang).
 * @param {object} [opts.env]       Testnaht; Standard process.env.
 */
function vertexStandort(model, { standort, env = process.env } = {}) {
  if (standort) return standort;
  // Nur noch als Rückweg bis zur Abschaltung am 20.10.2026 (Env-Override
  // CASHBACK_OCR_PRO_MODEL=gemini-2.5-pro): dort, wo es bisher lief.
  if (istGemini25Pro(model)) return env.GEMINI_VERTEX_LOCATION_PRO || 'europe-west4';
  return env.GEMINI_VERTEX_LOCATION || 'global';
}

/**
 * Aufruf-Optionen der Eskalationsstufe der Robust-OCR.
 *
 * Env (alle optional, Deploy-Zeit über cloud-functions/cashback-pipeline/.env):
 *   CASHBACK_OCR_PRO_MODEL           Modell (Standard gemini-3.5-flash)
 *   CASHBACK_OCR_PRO_THINKING_LEVEL  Denkstufe für Gemini 3 (Standard HIGH)
 *   CASHBACK_OCR_PRO_LOCATION        Vertex-Standort (Standard: eu, wenn das
 *                                    Modell dort erreichbar ist, sonst der
 *                                    Modell-Standard aus vertexStandort)
 *   CASHBACK_OCR_PRO_FALLBACK_THINKING_LEVEL
 *                                    Denkstufe nach einem Fehlversuch der
 *                                    Eskalation (Standard LOW)
 *   CASHBACK_OCR_PRO_TIMEOUT_MS      Zeitlimit je Lesung für Gemini 3
 *                                    (Standard 150000, Minimum 30000)
 *
 * @returns {{model: string, thinkingConfig?: object, ausweichThinkingConfig?: object,
 *            standort?: string, timeoutMs?: number}}
 */
function eskalationsOptionen(env = process.env) {
  const model = env.CASHBACK_OCR_PRO_MODEL || ESKALATION_MODELL_STANDARD;
  const out = { model };
  if (istGemini3(model)) {
    const stufe = String(env.CASHBACK_OCR_PRO_THINKING_LEVEL || ESKALATION_DENKSTUFE_STANDARD).toUpperCase();
    // Ein Tippfehler darf die Eskalation nicht in einen 400 laufen lassen.
    out.thinkingConfig = { thinkingLevel: ERLAUBTE_DENKSTUFEN.has(stufe) ? stufe : ESKALATION_DENKSTUFE_STANDARD };
    const ausweich = String(env.CASHBACK_OCR_PRO_FALLBACK_THINKING_LEVEL || ESKALATION_AUSWEICH_DENKSTUFE_STANDARD).toUpperCase();
    out.ausweichThinkingConfig = { thinkingLevel: ERLAUBTE_DENKSTUFEN.has(ausweich) ? ausweich : ESKALATION_AUSWEICH_DENKSTUFE_STANDARD };
    // Ungültige Werte ('0', Tippfehler) dürfen das Limit nicht abschalten.
    const t = Number(env.CASHBACK_OCR_PRO_TIMEOUT_MS);
    out.timeoutMs = Number.isFinite(t) && t >= ESKALATION_ZEITLIMIT_MS_MIN ? t : ESKALATION_ZEITLIMIT_MS_STANDARD;
  }
  // gemini-2.5-pro (Rückweg bis 20.10.) bekommt KEINE Denk-Konfiguration —
  // exakt wie bis zum Umbau (freies Denken, Modell-Standort europe-west4).
  const standort = ausweichStandort(model, env.CASHBACK_OCR_PRO_LOCATION);
  if (standort) out.standort = standort;
  return out;
}

module.exports = {
  istGemini3,
  istGemini25Pro,
  vertexStandort,
  ausweichStandort,
  eskalationsOptionen,
  denkstufeAus,
  ocrDenkstufeWirksam,
  OCR_DENKSTUFEN,
  OCR_DENKSTUFE_PROMPTE,
  ESKALATION_MODELL_STANDARD,
  ESKALATION_DENKSTUFE_STANDARD,
  ESKALATION_AUSWEICH_DENKSTUFE_STANDARD,
  ESKALATION_ZEITLIMIT_MS_STANDARD,
  EU_ERREICHBAR,
};
