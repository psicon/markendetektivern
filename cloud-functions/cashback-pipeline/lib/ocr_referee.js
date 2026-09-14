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
 * Der Rückfall auf 2.5-pro denkt dagegen frei (11k Denk-Token, 115 s).
 */

const { extractReceipt } = require('./ocr');
const PROMPT = require('./prompt_referee');
const { refereeFingerprint, decideReferee } = require('./refereePolicy');

const REFEREE_MODEL = process.env.CASHBACK_OCR_REFEREE_MODEL || 'gemini-3.1-pro-preview';
const REFEREE_FALLBACK_MODEL = process.env.CASHBACK_OCR_REFEREE_FALLBACK_MODEL || 'gemini-2.5-pro';
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

const istGen3 = (model) => /gemini-3/i.test(String(model));

function thinkingFor(model) {
  if (istGen3(model)) return { thinkingLevel: 'LOW' };
  // Rückfall 2.5-pro: frei denkend ~115 s pro Lesung (11k Denk-Token, Live-Test
  // 14.09.) — bei 120 s Zeitlimit und 330 s Frist passten kaum zwei Lesungen,
  // ein Ausfall hätte die Entscheidung verhindert (Review Runde 3). Gedeckelt.
  return { thinkingBudget: 4096 };
}

// Google empfiehlt für Gemini 3 ausdrücklich die Standard-Temperatur 1.0
// (niedrigere Werte können Schleifen/Qualitätsverlust verursachen). Nebeneffekt,
// der hier erwünscht ist: zwei Lesungen sind weniger korreliert, ihre
// Übereinstimmung sagt mehr. 2.5-pro bleibt beim Pipeline-Wert 0.1.
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
 * @param {Function} [ctx.extract]            Testnaht; Standard extractReceipt.
 * @param {() => number} [ctx.clock]          Testnaht; Standard Date.now.
 * @returns {Promise<{result: object, chosen: object|null}>}
 */
async function runReferee(imageBytes, mimeType, ctx) {
  const extract = ctx.extract || extractReceipt;
  const clock = ctx.clock || Date.now;
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
        timeoutMs: Math.min(READ_TIMEOUT_MS, rest - 10_000),
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

module.exports = { runReferee, REFEREE_MODEL, REFEREE_FALLBACK_MODEL, MAX_READS, DEADLINE_MS };
