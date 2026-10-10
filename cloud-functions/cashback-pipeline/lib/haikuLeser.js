'use strict';
/**
 * Claude Haiku 5.5 (über Vertex, unser Google-Projekt) als ERSTE Lesung eines
 * Bons — Patrick 10.10.2026: „ja auf jeden fall“.
 *
 * Lesetest 10.10.2026 (150 freigegebene Bons, dieselbe Leseanleitung wie
 * Gemini, Prompt v1.4): Geldfelder 99 %, alle Preise 88 %, Uhrzeit 96 %,
 * ~0,23 ct je Lesung (Gemini 3.5 Flash ~5–6 ct). Mit dem Mistral-Zeugen und
 * Summenprobe 77 % bestätigt, darunter 0 Geldfehler, 5 % mit einem falschen
 * Artikelpreis.
 *
 * Schalter `cashback_config/v1.haikuLeser`:
 *   'shadow' → Parallelbetrieb: Haiku liest NACH der fertigen Entscheidung,
 *              Ergebnis nur in `receipts.zeugeHaiku` (index.js Schritt 9).
 *   true     → scharf: Haiku ist die erste Lesung der Leiter; bestätigt Mistral
 *              (Schalter mistralZeuge === true nötig), gilt sie. Sonst läuft die
 *              Gemini-Leiter genau wie bisher.
 *   fehlt    → aus.
 * Rückweg ohne Deploy: 'shadow' oder entfernen.
 *
 * Liefert dieselbe Form wie lib/ocr.js extractReceipt (parsed, model,
 * promptVersion, latencyMs, finishReason, Token), damit Summenprobe,
 * Artikelzählung und Fingerabdruck unverändert funktionieren. Wirft bei jedem
 * Problem — der Aufrufer liest dann mit Gemini wie bisher.
 */

const admin = require('firebase-admin');
const { promptOptionen } = require('./prompt');
const { belegBereinigen } = require('./belegart');
const { abgleichOptionen } = require('./punkteZahlung');

const MODELL = 'claude-haiku-5-5';
const ORT = 'global';
const ZEITLIMIT_MS = 60000;
// Anthropic nimmt je Bild höchstens 5 MB (gemessen: ein 5,2-MB-Bon scheiterte).
const MAX_BYTES = 4.9e6;
const AUFWAND = 'medium';

/** Bildtyp aus den ersten Bytes — die Angabe der App stimmt nicht immer (Test: 5 von 150). */
function bildTyp(bytes) {
  const b = bytes || Buffer.alloc(0);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.slice(0, 6).toString('ascii'))) return 'image/gif';
  return null;
}

let tokenCache = null;
async function zugangsToken() {
  if (tokenCache && tokenCache.bis > Date.now() + 60000) return tokenCache.wert;
  const t = await admin.credential.applicationDefault().getAccessToken();
  tokenCache = { wert: t.access_token, bis: Date.now() + (Number(t.expires_in) || 300) * 1000 };
  return tokenCache.wert;
}

function fehler(code, text) {
  const e = new Error(`${code}: ${text}`);
  e.code = code;
  return e;
}

/**
 * Einen Bon mit Haiku 5.5 lesen.
 * @param {Buffer} bytes
 * @param {object} [o] { promptVersion, projekt, fetchImpl, token, zeitlimitMs }
 */
async function haikuLesen(bytes, o = {}) {
  const typ = bildTyp(bytes);
  if (!typ) throw fehler('haiku_bildformat', 'kein JPEG/PNG/WebP/GIF');
  if (bytes.length > MAX_BYTES) throw fehler('haiku_bild_zu_gross', `${bytes.length} Bytes`);
  const prompt = promptOptionen(o.promptVersion);
  const projekt = o.projekt || process.env.GCLOUD_PROJECT || 'markendetektive-895f7';
  const token = o.token || (await zugangsToken());
  const fetchImpl = o.fetchImpl || fetch;
  const url = `https://aiplatform.googleapis.com/v1/projects/${projekt}/locations/${ORT}/publishers/anthropic/models/${MODELL}:rawPredict`;
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), o.zeitlimitMs || ZEITLIMIT_MS);
  const t0 = Date.now();
  let j;
  try {
    const r = await fetchImpl(url, {
      method: 'POST',
      signal: abbruch.signal,
      headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': projekt, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anthropic_version: 'vertex-2023-10-16',
        max_tokens: 16000,
        output_config: { effort: AUFWAND },
        system: prompt.systemInstruction,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: typ, data: Buffer.from(bytes).toString('base64') } },
            { type: 'text', text: `${prompt.userPrompt}\nJSON-Schema der Antwort:\n${JSON.stringify(prompt.responseSchema)}` },
          ],
        }],
      }),
    });
    const text = await r.text();
    if (!r.ok) throw fehler('haiku_http', `${r.status} ${text.slice(0, 160)}`);
    j = JSON.parse(text);
  } catch (e) {
    if (e && e.name === 'AbortError') throw fehler('haiku_zeitlimit', `${o.zeitlimitMs || ZEITLIMIT_MS} ms`);
    throw e;
  } finally {
    clearTimeout(uhr);
  }
  const antwort = (j.content || []).filter((c) => c && c.type === 'text').map((c) => c.text || '').join('');
  const m = antwort.match(/\{[\s\S]*\}/);
  let parsed;
  try {
    parsed = JSON.parse(m ? m[0] : antwort);
  } catch (e) {
    throw fehler('haiku_json', `${j.stop_reason || '?'} ${e.message}`.slice(0, 160));
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) throw fehler('haiku_form', 'items fehlt');
  parsed = belegBereinigen(parsed, abgleichOptionen(prompt.promptVersion));
  return {
    parsed,
    model: MODELL,
    promptVersion: prompt.promptVersion,
    latencyMs: Date.now() - t0,
    finishReason: j.stop_reason ?? null,
    inputTokens: j.usage?.input_tokens ?? null,
    outputTokens: j.usage?.output_tokens ?? null,
    thoughtsTokens: null,
  };
}

module.exports = { haikuLesen, bildTyp, MODELL, MAX_BYTES };
