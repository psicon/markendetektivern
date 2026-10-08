'use strict';

/**
 * Zweitprüfung („Schiedsrichter") — der Modellaufruf (ClickUp 86cbfvwge).
 * Regeln: lib/refereePolicy.js. Verdrahtung: index.js, Durchlauf 2.
 *
 * ═══ Modellwahl (gemessen 14.09.2026 auf Vertex, Projekt markendetektive-895f7) ═══
 * Die Robust-Leiter endet bei gemini-2.5-pro — das hat 42 von 44 der
 * betroffenen Ablehnungen schon zweimal gelesen. Ein Schiedsrichter muss
 * stärker sein: gemini-3.1-pro-preview ist das stärkste erreichbare Modell
 * (nur Location 'global'; 3-pro/3.5-pro/3.1-pro liefern 404).
 * Drei Eigenheiten, die sonst teuer werden:
 *   • `thinkingBudget` wird ignoriert → 4 von 16 Antworten liefen mit reinem
 *     Denken bis MAX_TOKENS (~195 s, kein Ergebnis). `thinkingLevel: LOW`
 *     greift (23 s).
 *   • 429 bei 5 von 21 Aufrufen (Preview-Kontingent) → Rückfall auf
 *     gemini-2.5-pro, aber mit dem Zweitprüfungs-Prompt.
 *   • 23–109 s pro Lesung → hartes Zeitlimit je Lesung und eine Frist für
 *     die ganze Prüfung, damit der Rest der Pipeline im 540-s-Limit bleibt.
 * Kosten mit `thinkingLevel: LOW` gemessen (Live-Test 14.09., 13 Bons):
 * ~3.600 Eingabe- und ~1.000–3.500 Ausgabe-Token pro Lesung, Denk-Token 0 →
 * grob 0,02–0,05 $ pro Lesung (Listenpreise geschätzt, nicht live geprüft).
 *
 * ═══ Rückfall seit 01.10.2026: gemini-3.5-flash statt gemini-2.5-pro ═══
 * gemini-2.5-pro wird auf Vertex am 20.10.2026 abgeschaltet. Eine GA-Pro-
 * Variante gibt es nicht; der Rückfall ist deshalb das stärkste GA-Modell mit
 * langer Restlaufzeit (3.5-flash, bis mindestens 19.05.2027) auf der höchsten
 * Denkstufe — dieselbe Wahl wie die Eskalation der Robust-OCR (Messung und
 * Standort `eu`: lib/geminiModelle.js). Der Rückfall griff in den 30 Tagen
 * vor dem Umbau bei 7 von 110 Zweitprüfungen.
 */

const { extractReceipt } = require('./ocr');
const { refereePromptFuer } = require('./prompt_referee');
const { refereeFingerprint, decideReferee } = require('./refereePolicy');
const { istGemini3, ausweichStandort, ESKALATION_MODELL_STANDARD } = require('./geminiModelle');
const { ZWECK } = require('./geminiKennung');

const REFEREE_MODEL = process.env.CASHBACK_OCR_REFEREE_MODEL || 'gemini-3.1-pro-preview';
const REFEREE_FALLBACK_MODEL = process.env.CASHBACK_OCR_REFEREE_FALLBACK_MODEL || ESKALATION_MODELL_STANDARD;
// Der Rückfall greift gerade dann, wenn `global` überlastet ist (429 beim
// Preview-Modell) — deshalb wie die Eskalation über die Multi-Region eu
// (zweiter Kapazitätspool, Begründung in lib/geminiModelle.js).
const REFEREE_FALLBACK_LOCATION = ausweichStandort(REFEREE_FALLBACK_MODEL, process.env.CASHBACK_OCR_REFEREE_FALLBACK_LOCATION);
// Ungültige Werte ('0', Tippfehler) dürfen das Zeitlimit nicht abschalten —
// dann hinge ein Aufruf bis zum 540-s-Limit der Function.
const READ_TIMEOUT_MS = (() => {
  const v = Number(process.env.CASHBACK_OCR_REFEREE_TIMEOUT_MS);
  return Number.isFinite(v) && v >= 10_000 ? v : 120_000;
})();
// Live-Test 14.09.2026 (13 abgelehnte Bons): Lesungen desselben Bons weichen
// auch beim starken Modell auf Artikelebene ab (ein Netto-Bon: 2 von 3 bzw.
// 1 von 3 Lesungen stimmig), und 3 von ~27 Aufrufen scheiterten an 429. Eine
// vierte Lesung kostet ~0,02 $ und fällt durch den frühen Abbruch nur an, wenn
// sie rechnerisch noch entscheiden kann.
const MAX_READS = 4;
// Frist für die GANZE Zweitprüfung. processCashback hat 540 s; Download,
// Gates, Ledger und Writes brauchen im Normalfall < 15 s.
const DEADLINE_MS = 330_000;
const MIN_READ_WINDOW_MS = 30_000;

const kurz = (e) => String(e && e.message ? e.message : e).slice(0, 160);
// Rückfall bei Kontingent (429) UND wenn das Preview-Modell nicht (mehr)
// erreichbar ist (404/NOT_FOUND) — sonst verbrennt eine Umbenennung beim
// Anbieter jede Prüfung als „failed".
const brauchtRueckfall = (e) => /\b429\b|RESOURCE_EXHAUSTED|quota|\b404\b|NOT_FOUND/i.test(kurz(e));

const istGen3 = istGemini3;
const istGen3Pro = (model) => /gemini-3(\.\d+)?-pro/i.test(String(model));

function thinkingFor(model) {
  // Pro-Preview: HIGH/Standard liefen bis MAX_TOKENS (Messung 14.09., s. o.).
  if (istGen3Pro(model)) return { thinkingLevel: 'LOW' };
  // Rückfall 3.5-flash: höchste Denkstufe. Gemessen 01.10.2026 mit diesem
  // Prompt an 28 echten Zweitprüfungen (Preview-Modell per simuliertem 429
  // übersprungen): von 20 Fällen, die 3.1-pro-preview entschieden hatte,
  // entschied der Rückfall 15 — 14 mit identischen Geldfeldern, 1 mit anderem
  // Datum, und dort zeigt das Bild das Datum des Rückfalls (16.09., nicht
  // 16.08.). 7 von 62 Lesungen liefen ins 120-s-Limit, 5 bekamen 429 (die
  // Messung lief noch über `global`; der Rückfall nutzt jetzt `eu`). Zum
  // Vergleich: der alte Rückfall 2.5-pro entschied in 30 Tagen 1 von 7 Fällen.
  if (istGen3(model)) return { thinkingLevel: 'HIGH' };
  // Nur noch über Env erreichbar (2.5-pro bis 20.10.2026): frei denkend
  // ~115 s pro Lesung (11k Denk-Token, Live-Test 14.09.) — bei 120 s
  // Zeitlimit und 330 s Frist passten kaum zwei Lesungen. Gedeckelt.
  return { thinkingBudget: 4096 };
}

// Google empfiehlt für Gemini 3 ausdrücklich die Standard-Temperatur 1.0
// (niedrigere Werte können Schleifen/Qualitätsverlust verursachen). Nebeneffekt,
// der hier erwünscht ist: zwei Lesungen sind weniger korreliert, ihre
// Übereinstimmung sagt mehr. Gilt auch für den Rückfall 3.5-flash; nur ein
// per Env gesetztes 2.5-pro bliebe beim Pipeline-Wert 0.1.
function temperatureFor(model) {
  return istGen3(model) ? 1.0 : 0.1;
}

/**
 * @param {Buffer} imageBytes
 * @param {string} mimeType
 * @param {object} ctx
 * @param {string} ctx.reason                 Ablehngrund aus Durchlauf 1.
 * @param {Array} ctx.prior                   Erstlesungen (robust.reads) für plausibel().
 * @param {(name: string|null, country: string|null) => Promise<string|null>} ctx.merchantKeyFor
 * @param {string|null} [ctx.erstlesungVersion] ocr.promptVersion der Erstlesung — wählt
 *                                            den Prompt (lib/prompt_referee.js); ohne
 *                                            Angabe der Live-Stand v1.4.
 * @param {Function} [ctx.extract]            Testnaht; Standard extractReceipt.
 * @param {() => number} [ctx.clock]          Testnaht; Standard Date.now.
 * @returns {Promise<{result: object, chosen: object|null}>}
 */
async function runReferee(imageBytes, mimeType, ctx) {
  const extract = ctx.extract || extractReceipt;
  const clock = ctx.clock || Date.now;
  // Prompt zur Version der Erstlesung (05.10.2026): die Zweitprüfung ersetzt
  // deren Lesung — sie liest mit derselben Fassung, nicht mit dem Schalter.
  const PROMPT = refereePromptFuer(ctx.erstlesungVersion);
  const started = clock();
  const lesungen = [];
  const fps = [];
  const fehler = [];
  const keys = new Map();
  const merchantKey = (m) => keys.get(m ?? null) ?? null;
  let model = REFEREE_MODEL;
  let rueckfall = false;
  let aufrufe = 0;
  let entscheidung = { decided: false, chosenIndex: null, grund: 'keine_lesung', zeugen: 0, konflikte: [] };

  for (let i = 0; i < MAX_READS; i++) {
    const rest = DEADLINE_MS - (clock() - started);
    if (rest < MIN_READ_WINDOW_MS) {
      fehler.push('frist_erreicht');
      break;
    }
    aufrufe++;
    let r;
    try {
      r = await extract(imageBytes, mimeType, {
        model,
        systemInstruction: PROMPT.SYSTEM_PROMPT,
        userPrompt: PROMPT.USER_PROMPT,
        responseSchema: PROMPT.RESPONSE_SCHEMA,
        promptVersion: PROMPT.VERSION,
        thinkingConfig: thinkingFor(model),
        temperature: temperatureFor(model),
        ...(rueckfall && REFEREE_FALLBACK_LOCATION ? { location: REFEREE_FALLBACK_LOCATION } : {}),
        timeoutMs: Math.min(READ_TIMEOUT_MS, rest - 10_000),
        // Kosten-Kennung — auch der Rückfall auf 3.5-flash zählt als Zweitprüfung.
        zweck: ZWECK.BON_ZWEITPRUEFUNG,
      });
    } catch (e) {
      fehler.push(`${model}: ${kurz(e)}`);
      if (brauchtRueckfall(e) && !rueckfall && REFEREE_FALLBACK_MODEL && REFEREE_FALLBACK_MODEL !== model) {
        model = REFEREE_FALLBACK_MODEL;
        rueckfall = true;
      }
    }
    if (r) {
      lesungen.push(r);
      const fp = refereeFingerprint(r);
      fps.push(fp);
      if (!keys.has(fp.merchant ?? null)) {
        keys.set(fp.merchant ?? null, await ctx.merchantKeyFor(fp.merchant, fp.bonCountry));
      }
      entscheidung = decideReferee(fps, { merchantKey, prior: ctx.prior || [], reason: ctx.reason });
      if (entscheidung.decided) break;
    }
    // Früher Abbruch: reichen die verbleibenden Versuche rechnerisch nicht
    // mehr für zwei Zeugen, ist jede weitere Lesung verschwendet.
    const nochMoeglich = MAX_READS - (i + 1);
    const zeugenBisher = entscheidung.zeugen || 0;
    if (zeugenBisher + nochMoeglich < 2) break;
  }

  const chosen = entscheidung.decided ? lesungen[entscheidung.chosenIndex] : null;
  const summe = (feld) => lesungen.reduce((a, r) => a + (Number.isFinite(r[feld]) ? r[feld] : 0), 0);
  const result = {
    verdict: entscheidung.decided ? 'decided' : lesungen.length ? 'undecided' : 'failed',
    grund: lesungen.length ? entscheidung.grund : 'alle_lesungen_fehlgeschlagen',
    konflikte: entscheidung.konflikte || [],
    zeugen: entscheidung.zeugen || 0,
    model: REFEREE_MODEL,
    fallbackModel: rueckfall ? REFEREE_FALLBACK_MODEL : null,
    promptVersion: PROMPT.VERSION,
    attempts: aufrufe,
    failedAttempts: fehler.filter((f) => f !== 'frist_erreicht').length,
    failures: fehler.slice(0, 5),
    reads: fps,
    chosenIndex: entscheidung.decided ? entscheidung.chosenIndex : null,
    // Das Zeugen-Paar der Entscheidung — das Freigabe-Gate 6w prüft genau diese zwei.
    paar: entscheidung.decided ? entscheidung.paar : null,
    latencyMs: clock() - started,
    tokens: { input: summe('inputTokens'), output: summe('outputTokens'), thoughts: summe('thoughtsTokens') },
  };
  return { result, chosen };
}

module.exports = { runReferee, REFEREE_MODEL, REFEREE_FALLBACK_MODEL, REFEREE_FALLBACK_LOCATION, MAX_READS, DEADLINE_MS };
