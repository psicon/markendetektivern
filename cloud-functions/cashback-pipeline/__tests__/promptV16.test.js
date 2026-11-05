'use strict';

/**
 * Prompt v1.6 (08.10.2026) — Nachbesserung der Variante „Denkstufe LOW + v1.5"
 * (Auftrag Patrick 08.10.2026). Ab Werk AUS; wählbar nur über
 * `cashback_config/v1.ocrPrompt === 'v1.6'`.
 *
 * Belegt:
 *   - v1.4 und v1.5 (Haupt-Prompt und Zweitprüfung) Zeichen für Zeichen
 *     unverändert (SHA-256 vom Stand 7ffa95c2).
 *   - v1.6 = v1.5 bis auf die Regeln 5 (a: Kassenzeit statt TSE-/UTC-Zeit),
 *     6/A/C/E (b: Artikelrabatt nie aufs Pfand, Wiederholzeilen einzeln),
 *     8/16/17 (c: eingelöste Punkte als Zahlungsmittel); Schema identisch.
 *   - c im Abgleich: nur für v1.6-Lesungen (auch 'referee-v2+v1.6') zählt eine
 *     negative Punkte-/Payback-Zeile nicht zur Summe; jede andere Fassung
 *     gleicht ab wie vor dem 08.10.2026.
 *   - d: unter wirksamer Denkstufe LOW zählt eine Einigung zweier LOW-Lesungen
 *     nur bei exaktem Abgleich; sonst läuft die Leiter weiter. Ohne LOW
 *     unverändert.
 *   - Echtes SDK @google/genai, nur fetch abgefangen (wie ocrDenkstufe.test.js):
 *     alle Schalter aus → Anfragen byte-gleich (GOLDEN, Stand 7ffa95c2);
 *     ocrPrompt 'v1.5' mit und ohne LOW → byte-gleich zum Stand VOR diesem Bau
 *     (aufgenommen am 08.10.2026 vor der ersten Änderung); 'v1.6' ändert an
 *     jeder Anfrage nur den Systemtext.
 *
 * Wiederholbare Gegenprobe der Entscheidungen (einmalig, nicht dauerhaft, weil
 * Datum/Hashes tagesabhängig sind): PROMPT16_AUFNAHME_DATEI=<pfad> schreibt die
 * Bon-Dokumente der Standard-Szenarien als JSON — vor und nach einer Änderung
 * am selben Tag aufnehmen und vergleichen (latencyMs/Zeitstempel ausblenden).
 */

jest.mock('firebase-admin', () => require('./helpers/fakeAdmin').erstelleFakeAdmin());
jest.mock('firebase-functions', () => ({
  logger: { info: (...a) => global.__logs.push(a), warn: (...a) => global.__logs.push(a), error: () => {}, debug: () => {} },
}));
jest.mock('firebase-functions/params', () => ({
  defineSecret: (name) => ({ name, value: () => undefined }),
}));
jest.mock('firebase-functions/v2/https', () => ({ onRequest: (_opts, h) => h }));
jest.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_opts, h) => h }));
jest.mock('firebase-functions/v2/pubsub', () => ({ onMessagePublished: (_opts, h) => h }));
jest.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (_opts, h) => h }));
jest.mock('@google-cloud/pubsub', () => ({
  PubSub: class {
    topic() {
      return { publishMessage: async () => 'msg' };
    }
  },
}));
jest.mock('../lib/push', () => ({ sendCashbackReady: async () => {} }));
jest.mock('../lib/imageEnhance', () => ({ enhanceForOcr: async () => Buffer.from('verbessert') }));
// Echtes SDK; nur die Vertex-Anmeldung ist ein Schein-Client.
jest.mock('@google/genai', () => {
  const echt = jest.requireActual('@google/genai');
  const scheinAuth = { getRequestHeaders: async () => new Headers({ Authorization: 'Bearer schein' }) };
  class GoogleGenAI extends echt.GoogleGenAI {
    constructor(opts) {
      super(opts && opts.vertexai ? { ...opts, googleAuthOptions: { authClient: scheinAuth } } : opts);
    }
  }
  return { ...echt, GoogleGenAI };
});

// Alles, was Modell, Standort, Denken oder Leiter steuert, auf den Code-Standard
// — VOR dem Laden der Module.
const ENV = [
  'GEMINI_USE_VERTEX', 'GEMINI_API_KEY', 'GEMINI_VERTEX_LOCATION', 'GEMINI_VERTEX_LOCATION_PRO',
  'CASHBACK_OCR_ENGINE', 'CASHBACK_OCR_MODEL', 'CASHBACK_OCR_THINKING_BUDGET', 'CASHBACK_OCR_MAX_FLASH',
  'CASHBACK_OCR_READ_TIMEOUT_MS', 'CASHBACK_OCR_RUN_BUDGET_MS', 'CASHBACK_OCR_ESCALATION_CAP',
  'CASHBACK_OCR_PRO_MODEL', 'CASHBACK_OCR_PRO_THINKING_LEVEL', 'CASHBACK_OCR_PRO_LOCATION',
  'CASHBACK_OCR_PRO_FALLBACK_THINKING_LEVEL', 'CASHBACK_OCR_PRO_TIMEOUT_MS', 'CASHBACK_ESCALATE_DOCAI',
  'CASHBACK_OCR_REFEREE_MODEL', 'CASHBACK_OCR_REFEREE_FALLBACK_MODEL', 'CASHBACK_OCR_REFEREE_FALLBACK_LOCATION',
];
const gesichert = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
for (const k of ENV) delete process.env[k];
afterAll(() => {
  for (const k of ENV) {
    if (gesichert[k] === undefined) delete process.env[k];
    else process.env[k] = gesichert[k];
  }
});

const crypto = require('crypto');
const admin = require('firebase-admin');
const fn = require('../index');
const PROMPT = require('../lib/prompt');
const REFEREE = require('../lib/prompt_referee');
const { reconcile } = require('../lib/ocr');
const { belegBereinigen } = require('../lib/belegart');
const { abgleichOptionen, istPunkteZahlungZeile } = require('../lib/punkteZahlung');
const { ocrDenkstufeWirksam } = require('../lib/geminiModelle');
const { refereeFingerprint } = require('../lib/refereePolicy');
const robust = require('../lib/ocr_robust');

const fake = admin.__fake;
const UID = 'v16Nutzer';
const TAG = 24 * 60 * 60 * 1000;
const GESTERN = new Date(Date.now() - TAG).toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

beforeEach(() => {
  global.__logs = [];
});

// ─── Prüfsummen (Stand 7ffa95c2 bzw. vor diesem Bau, 08.10.2026) ──────────

/** Prompt v1.5 und Zweitprüfung v1.5, Text/Nutzer-Text/Schema. */
const V15_TEXT = {
  system: '23ccce29cffc9e7f688acb86cd0ca194bbfbd1f4d26e42cbce11cda68746226b',
  user: '8b891c4497671f17f0e9884a352a4a9bf4a4c9a1dd7a262bc363a2b7c3fb9542',
  schema: 'd746ad022706d75f5d818d9ad24afffeb361311732c0dfcb1b5d1e65322ae219',
};
const REFEREE_V15_TEXT = {
  system: '2a52e293774b80fc549d2eaff36523423e957722c59fa14cf6a8d831bfd11a55',
  user: 'fe1cbf6f7583edd0854ce2b31035da86e6869e08024a5e4e534c52266f29bd03',
  schema: '607bfe1615513024fdd94325323f11bc845d699ac2d39f725772e968a4d6510c',
};

/**
 * SHA-256 der Anfragekörper je Stufe (labels.zweck). `aus` = Stand 7ffa95c2
 * (dieselben Werte wie GOLDEN in ocrDenkstufe.test.js); `v15`/`v15low` am
 * 08.10.2026 VOR der ersten Änderung dieses Baus aufgenommen (zweimal, gleich).
 */
const ANFRAGEN = {
  aus: {
    'bon-ocr': 'de662049c6e359f0bc4e5f05f4857f498b64d707126be69c1044a9c6034b2e3a',
    'bon-ocr-verbessert': 'f029bc917c755ec9de06bfaefdffab3625dd43c23ae2c3aa654547764a4c91be',
    'bon-ocr-eskalation': '88ab626974232ef8cb6fbd1529e4493bc48d2c0b4d5a1774e29c771fbc15211d',
    'bon-zweitpruefung': '4e6af74d58863db40f761ae78ead8a5ed99ef56f6fb6ee39157e5decb3555432',
  },
  v15: {
    'bon-ocr': '845e4ebf55278d4e4963a8cac0477d85a677889625a1845010b8b9b83d4b56f3',
    'bon-ocr-verbessert': 'e573af613e2eb4dd173b17be98176a02c9bff2c3871cd4f0d63a9f4f2f4b98f5',
    'bon-ocr-eskalation': 'aaa19b9634c325d56aea7cc08dddab61338644526e46a8514dc9cfa1cfc52717',
    'bon-zweitpruefung': 'c59046bb1744df91efd00b92c39f00ebdf08628987363f725b0a276b1c42bcdf',
  },
  v15low: {
    'bon-ocr': 'b32ed1c3b7caf917a2e31917df9cbc041535a0f4e040a248694efa02d01c0fb9',
    'bon-ocr-verbessert': 'e926fd0e02ab2e45708cab1f3001738e562af051fcd4b77688ab796c32cf0cc1',
    'bon-ocr-eskalation': 'aaa19b9634c325d56aea7cc08dddab61338644526e46a8514dc9cfa1cfc52717',
  },
};

// ═══ 1. Prompt-Texte ═══════════════════════════════════════════════════════

describe('v1.4 und v1.5 bleiben Zeichen für Zeichen, v1.6 ist wählbar', () => {
  test('v1.5 und Zweitprüfung v1.5: Prüfsummen unverändert', () => {
    const p = PROMPT.promptFuer('v1.5');
    expect(sha(p.SYSTEM_PROMPT)).toBe(V15_TEXT.system);
    expect(sha(p.USER_PROMPT)).toBe(V15_TEXT.user);
    expect(sha(JSON.stringify(p.RESPONSE_SCHEMA))).toBe(V15_TEXT.schema);
    const r = REFEREE.refereePromptFuer('v1.5');
    expect(r.VERSION).toBe('referee-v2+v1.5');
    expect(sha(r.SYSTEM_PROMPT)).toBe(REFEREE_V15_TEXT.system);
    expect(sha(r.USER_PROMPT)).toBe(REFEREE_V15_TEXT.user);
    expect(sha(JSON.stringify(r.RESPONSE_SCHEMA))).toBe(REFEREE_V15_TEXT.schema);
  });

  test("Schalter: nur genau 'v1.6' wählt v1.6; Standard bleibt v1.4", () => {
    expect(PROMPT.VERSIONEN).toEqual(['v1.4', 'v1.5', 'v1.6']);
    expect(PROMPT.STANDARD_VERSION).toBe('v1.4');
    expect(PROMPT.VERSION).toBe('v1.4');
    for (const [wert, version] of [['v1.6', 'v1.6'], ['V1.6', 'v1.4'], [' v1.6', 'v1.4'], ['1.6', 'v1.4'], ['v1.6 ', 'v1.4'], [undefined, 'v1.4']]) {
      expect(PROMPT.promptVersionAus(wert)).toBe(version);
    }
    expect(PROMPT.promptOptionen('v1.6')).toEqual({
      systemInstruction: PROMPT.PROMPTS['v1.6'].SYSTEM_PROMPT,
      userPrompt: PROMPT.PROMPTS['v1.5'].USER_PROMPT,
      responseSchema: PROMPT.PROMPTS['v1.5'].RESPONSE_SCHEMA,
      promptVersion: 'v1.6',
    });
  });

  test('v1.6: Schema und Nutzer-Text wie v1.5 (dieselben Felder → Belegart, Rabattzeilen, seite-Regeln gelten)', () => {
    const v15 = PROMPT.promptFuer('v1.5');
    const v16 = PROMPT.promptFuer('v1.6');
    expect(v16.RESPONSE_SCHEMA).toBe(v15.RESPONSE_SCHEMA);
    expect(v16.USER_PROMPT).toBe(v15.USER_PROMPT);
    expect(v16.SYSTEM_PROMPT).not.toBe(v15.SYSTEM_PROMPT);
  });

  /** Regelblöcke eines Systemtexts: Nummer/Buchstabe → Text bis zur nächsten Regel oder Überschrift. */
  function regeln(text) {
    const out = {};
    const zeilen = text.split('\n');
    let schluessel = null;
    for (const z of zeilen) {
      const m = /^(\d{1,2}|[A-F])\. /.exec(z);
      if (m) {
        schluessel = m[1];
        out[schluessel] = z;
      } else if (/^## /.test(z)) {
        schluessel = null;
      } else if (schluessel) {
        out[schluessel] += `\n${z}`;
      }
    }
    for (const k of Object.keys(out)) out[k] = out[k].replace(/\s+$/, '');
    return out;
  }

  test('v1.6 ändert genau die Regeln 5, 6, 8, 16, A, C, E und ergänzt 17 — alle anderen wortgleich zu v1.5', () => {
    const r15 = regeln(PROMPT.promptFuer('v1.5').SYSTEM_PROMPT);
    const r16 = regeln(PROMPT.promptFuer('v1.6').SYSTEM_PROMPT);
    const geaendert = ['5', '6', '8', '16', 'A', 'C', 'E'];
    expect(Object.keys(r16).sort()).toEqual([...Object.keys(r15), '17'].sort());
    for (const k of Object.keys(r15)) {
      if (geaendert.includes(k)) expect(r16[k]).not.toBe(r15[k]);
      else expect(r16[k]).toBe(r15[k]);
    }
    // Regel 16: inhaltlich nur der Verweis auf Regel 17 in der Liste der
    // Zahlungszeilen (Zeilenumbrüche dürfen sich verschieben).
    const flach = (t) => t.replace(/\s+/g, ' ');
    expect(flach(r16['16']).replace('oder Guthaben — siehe Regel 17, Rückgeld', 'oder Guthaben, Rückgeld')).toBe(flach(r15['16']));
    // Kopf und Abschnittsüberschriften bleiben; neu ist nur der Punkte-Abschnitt.
    const ueber = (t) => t.split('\n').filter((z) => /^## /.test(z));
    expect(ueber(PROMPT.promptFuer('v1.6').SYSTEM_PROMPT)).toEqual([
      ...ueber(PROMPT.promptFuer('v1.5').SYSTEM_PROMPT).slice(0, 3),
      '## Eingelöste Punkte (Zahlungsmittel)',
      ...ueber(PROMPT.promptFuer('v1.5').SYSTEM_PROMPT).slice(3),
    ]);
  });

  const V16 = () => PROMPT.promptFuer('v1.6').SYSTEM_PROMPT;

  test('a) Uhrzeit: Kassenzeit in Ortszeit, nie TSE-/UTC-Zeit, nie Kartenzahlungsbeleg', () => {
    const r5 = regeln(V16())['5'];
    expect(r5).toMatch(/Kassenzeit in ORTSZEIT/);
    expect(r5).toMatch(/22\.09\.26 {2}19:07/); // Beispiel aus bon_mucxkt2yxdzoe7 (Lidl)
    expect(r5).toMatch(/NIE eine Zeit aus dem TSE-\/Signatur-Block/);
    expect(r5).toMatch(/2026-09-22T17:07:59\.000Z/);
    expect(r5).toMatch(/UTC und liegt dann ein bis zwei Stunden zu früh/);
    expect(r5).toMatch(/Kartenzahlungsbelegs/);
    expect(r5).toMatch(/NICHT als UTC gekennzeichnet/);
    expect(r5).toMatch(/Start: 2026-09-30 10:13:30" → 10:13/); // dm: TSE in Ortszeit
    expect(r5).toMatch(/bonTime=null/);
    // Regel 4 (Datum) bleibt — das TSE-Datum hat weiter Vorrang.
    expect(regeln(V16())['4']).toBe(regeln(PROMPT.promptFuer('v1.5').SYSTEM_PROMPT)['4']);
  });

  test('b) Artikelrabatt zur Artikelzeile darüber, nie aufs Pfand; Wiederholzeilen einzeln', () => {
    const r = regeln(V16());
    expect(r.C).toMatch(/gehören zur darüberstehenden\s+ARTIKEL-Zeile/);
    expect(r.C).toMatch(/Pfand und Leergut bekommen NIE einen Rabatt/);
    expect(r.C).toMatch(/MuelMilch {2}0,69 \/\s+EW-Pfand 0,25 EUR {2}0,25 \/ 0\.10€ Rabatt {2}-0,10/); // Netto, Messung 2
    expect(r.C).toMatch(/Artikel ÜBER dem Pfand, und das Pfand bleibt genau wie gedruckt/);
    expect(r.C).toMatch(/nie einem Artikel weiter oben oder weiter unten/);
    expect(r['6']).toMatch(/JEDE dieser Zeilen ein eigenes\s+Item — nicht zusammenfassen, keine auslassen/);
    expect(r['6']).toMatch(/Mengenzeile wie „3 x 0,69"/);
    expect(r.A).toMatch(/Wiederholt\s+sich derselbe Artikel in mehreren eigenen Zeilen/);
    expect(r.E).toMatch(/einen Artikelrabatt beim falschen Artikel oder beim Pfand\s+abgezogen oder eine Wiederholzeile ausgelassen/);
    expect(r.E).toMatch(/erfinde KEINE Werte/);
  });

  test('c) eingelöste Punkte: Zahlungsmittel, Endbetrag VOR der Punkteverrechnung', () => {
    const r = regeln(V16());
    expect(r['8']).toMatch(/VOR der\s+Verrechnung eingelöster Punkte \(Regel 17\)/);
    expect(r['17']).toMatch(/ZAHLUNGSMITTEL/);
    expect(r['17']).toMatch(/Eingelöste Punkte {2}-380 {2}= EUR -3,80/); // dm, bon_mupp8gdg5lgyyz
    expect(r['17']).toMatch(/NIE als Item aufnehmen \(auch nicht als Rabattzeile nach Regel 16\)/);
    expect(r['17']).toMatch(/NIE von einem Artikelpreis abziehen/);
    expect(r['17']).toMatch(/totalCents = zu zahlender Betrag \+ eingelöste\s+Punkte/);
    expect(r.E).toMatch(/OHNE eingelöste Punkte nach\s+Regel 17/);
  });

  test('Zweitprüfung zur v1.6-Erstlesung: v1.6-Grundlage + derselbe Zusatz wie v1.5', () => {
    const r16 = REFEREE.refereePromptFuer('v1.6');
    const r15 = REFEREE.refereePromptFuer('v1.5');
    expect(r16.VERSION).toBe('referee-v2+v1.6');
    expect(r16.BASIS_VERSION).toBe('v1.6');
    const zusatz = (r, basis) => r.SYSTEM_PROMPT.slice(PROMPT.promptFuer(basis).SYSTEM_PROMPT.length);
    expect(r16.SYSTEM_PROMPT.startsWith(PROMPT.promptFuer('v1.6').SYSTEM_PROMPT)).toBe(true);
    expect(zusatz(r16, 'v1.6')).toBe(zusatz(r15, 'v1.5'));
    expect(r16.USER_PROMPT).toBe(r15.USER_PROMPT);
    expect(r16.RESPONSE_SCHEMA).toEqual(r15.RESPONSE_SCHEMA);
    // Unbekanntes bleibt bei v1.4 (wie bisher).
    for (const v of ['referee-v2+v1.6', 'V1.6', 'v1.7', null]) expect(REFEREE.refereePromptFuer(v).VERSION).toBe('referee-v2+v1.4');
  });
});

// ═══ 2. Fassung → Abgleich-Optionen, Denkstufe ═════════════════════════════

describe('Version der Lesung → Sonderverhalten', () => {
  test.each([
    ['v1.6', 'v1.6', { punkteAlsZahlung: true }],
    ['referee-v2+v1.6', 'v1.6', { punkteAlsZahlung: true }],
    ['v1.5', 'v1.5', {}],
    ['referee-v2+v1.5', 'v1.5', {}],
    ['v1.4', 'v1.4', {}],
    ['v1.3', null, {}],
    ['docai-expense-v1.0', null, {}],
    ['cvhybrid-v1.1', null, {}],
    ['V1.6', null, {}],
    [null, null, {}],
    [undefined, null, {}],
    ['__proto__', null, {}],
  ])('%p → Grundlage %p, Abgleich %p', (version, basis, optionen) => {
    expect(PROMPT.basisVersion(version)).toBe(basis);
    expect(abgleichOptionen(version)).toEqual(optionen);
  });

  test('Denkstufe LOW wirkt mit v1.5 und v1.6, sonst nicht (grund ohne_v15 bleibt der Name)', () => {
    expect(ocrDenkstufeWirksam('LOW', 'v1.6')).toEqual({ denkstufe: 'LOW', grund: null });
    expect(ocrDenkstufeWirksam('LOW', 'v1.5')).toEqual({ denkstufe: 'LOW', grund: null });
    expect(ocrDenkstufeWirksam('LOW', 'v1.4')).toEqual({ denkstufe: null, grund: 'ohne_v15' });
    expect(ocrDenkstufeWirksam('MEDIUM', 'v1.6')).toEqual({ denkstufe: null, grund: 'ungueltig' });
    expect(ocrDenkstufeWirksam(undefined, 'v1.6')).toEqual({ denkstufe: null, grund: null });
  });
});

// ═══ 3. c) Punkte im Abgleich ══════════════════════════════════════════════

/** dm-Bon aus Messung 2 (bon_mupp8gdg5lgyyz), Artikel wie gedruckt, Σ 98,95 €. */
const DM_ARTIKEL = [['Spontex Tuchschwamm Co', 330], ['Spontex Badputzer Schwamm', 175], ['Prof. 10L Müllb. Biofolie TR', 155], ['Prof. 1L Gefrierb. Schnellv.', 115], ['Prof. Backpapier Zuschnitte', 95], ['Profissimo Rec. Spülbürste', 45], ['Frosch Vollwaschm. Flüssig Alo', 545], ['Dr.Beckmann Geruchsentf. 500ml', 275], ['babylove Pants Prem. G', 1335], ['dmBio Schwangerschaftstee', 195], ['dmBio Acerolasaft 330ml', 345], ['dmBio Sanddornsaft 330ml', 345], ['dmBio 90% Bitterschoko', 1365], ['dmBio Bliss Balls Nuss', 310], ['dmBio Leinsamen geschrotet*', 165], ['dmBio Dinkel Spirelli', 290], ['dmBio Gemüsebrühe Nachf. 500g*', 345], ['dmBio Tomatensauce Kla', 270], ['dmBio Tomatensauce Klassik*', 175], ['Dontodent ZB Kinder Erste', 85], ['Estrid Klingen 8St', 2295], ['Fructis Shampoo FATS Coco Wat.', 345], ['ebelin Haarbürste schmal 1St', 295]]
  .map(([name, priceCents]) => ({ name, priceCents }));
const DM_COUPONS = [
  { name: '3 x Coupon 20% babylove', priceCents: -267, category: 'Warenkorbrabatt', raw: '3 x Coupon 20% babylove -2,67' },
  { name: '19 x Coupon 10% dmBio', priceCents: -390, category: 'Warenkorbrabatt', raw: '19 x Coupon 10% dmBio -3,90' },
  { name: 'Coupon 20% Spontex', priceCents: -105, category: 'Warenkorbrabatt', raw: 'Coupon 20% Spontex -1,05' },
];
const DM_PUNKTE = { name: 'Eingelöste Punkte', priceCents: -380, category: 'Warenkorbrabatt', raw: 'Eingelöste Punkte -380 = EUR -3,80' };
const dm = (totalCents, mitPunkten = true) => ({
  isReceipt: true, merchant: 'dm-drogerie markt', bonDate: '2026-09-30', bonTime: '10:13',
  subtotalCents: 9895, totalCents, items: [...DM_ARTIKEL, ...DM_COUPONS, ...(mitPunkten ? [DM_PUNKTE] : [])],
});

describe('c) Abgleich: eingelöste Punkte als Zahlungsmittel — nur v1.6', () => {
  const V16 = abgleichOptionen('v1.6');
  const V15 = abgleichOptionen('v1.5');

  test('dm, wie v1.5 ihn las (Punkte als Rabattzeile, Endbetrag NACH den Punkten): unter v1.5 unbelegt (abgelehnt), wie im Betrieb', () => {
    const r = reconcile(dm(8753), V15);
    expect(r).toMatchObject({ ok: false, direction: 'basket_discount_unbelegt' });
    expect(r).not.toHaveProperty('punkteZahlungCents');
  });

  test('dm, wie v1.6 ihn lesen soll (Endbetrag VOR den Punkten = 87,53 + 3,80): exakt abgeglichen — auch wenn die Punkte-Zeile doch in items steht', () => {
    const mitZeile = reconcile(dm(9133), V16);
    expect(mitZeile).toMatchObject({ ok: true, direction: 'basket_discount', signedDeltaCents: 0, basketDiscountCents: 762, punkteZahlungCents: 380 });
    const ohneZeile = reconcile(dm(9133, false), V16);
    expect(ohneZeile).toEqual({ ...reconcile(dm(9133, false)), basketDiscountCents: 762 });
    expect(ohneZeile).not.toHaveProperty('punkteZahlungCents');
    const { punkteZahlungCents, ...rest } = mitZeile;
    expect(rest).toEqual(ohneZeile);
  });

  test('Endbetrag NACH den Punkten und Zeile in items: unter v1.6 NICHT abgeglichen — ein Zahlungsmittel macht keine Überzahl glatt', () => {
    const r = reconcile(dm(8753), V16);
    expect(r).toMatchObject({ ok: false, punkteZahlungCents: 380 });
    // Ohne Rabattzeilen: Σ Artikel liegt um die Punkte über dem Endbetrag.
    const einfach = { isReceipt: true, totalCents: 800, items: [{ name: 'A', priceCents: 1000 }, { name: 'PAYBACK Punkte eingelöst', priceCents: -200 }] };
    expect(reconcile(einfach, V15)).toMatchObject({ ok: true, direction: 'match' });
    expect(reconcile(einfach, V16)).toMatchObject({ ok: false, direction: 'overshoot', signedDeltaCents: -200, punkteZahlungCents: 200 });
  });

  test('erkannt werden nur NEGATIVE Zeilen mit „Punkte"/„Payback" (Name oder raw)', () => {
    expect(istPunkteZahlungZeile({ name: 'Eingelöste Punkte', priceCents: -380 })).toBe(true);
    expect(istPunkteZahlungZeile({ name: 'Einlösung', raw: 'PAYBACK Einlösung -2,00', priceCents: -200 })).toBe(true);
    expect(istPunkteZahlungZeile({ name: 'DeutschlandCard Punkte', priceCents: -100 })).toBe(true);
    expect(istPunkteZahlungZeile({ name: 'Punkte-Kekse', priceCents: 199 })).toBe(false);
    expect(istPunkteZahlungZeile({ name: 'Coupon 20% Spontex', priceCents: -105 })).toBe(false);
    expect(istPunkteZahlungZeile({ name: 'Pfand', priceCents: -25 })).toBe(false);
    expect(istPunkteZahlungZeile({ name: 'Eingelöste Punkte', priceCents: 0 })).toBe(false);
    const artikel = { isReceipt: true, totalCents: 199, items: [{ name: 'Punkte-Kekse', priceCents: 199 }] };
    expect(reconcile(artikel, V16)).toEqual(reconcile(artikel));
  });

  test('ohne Punkte-Zeile: jede Option liefert exakt das Ergebnis von heute', () => {
    const lesungen = [
      { isReceipt: true, totalCents: 1000, items: [{ name: 'A', priceCents: 1000 }] },
      { isReceipt: true, totalCents: 1000, items: [{ name: 'A', priceCents: 900 }] },
      { isReceipt: true, totalCents: 1000, items: [{ name: 'A', priceCents: 1100 }] },
      { isReceipt: true, totalCents: 1000, items: [{ name: 'A', priceCents: 1060 }] },
      dm(9133, false),
      { isReceipt: true, totalCents: 1605, subtotalCents: 2000, basketDiscounts: [{ label: '5% Rabatt', cents: 395 }], items: [{ name: 'A', priceCents: 2000 }] },
      { isReceipt: true, totalCents: null, items: [{ name: 'A', priceCents: 100 }] },
      { isReceipt: true, items: [{ name: 'Storno A', priceCents: -100 }, { name: 'A', priceCents: 100 }], totalCents: 0 },
      null,
      { isReceipt: false },
    ];
    for (const p of lesungen) {
      const heute = reconcile(p);
      expect(reconcile(p, {})).toEqual(heute);
      expect(reconcile(p, V15)).toEqual(heute);
      expect(reconcile(p, V16)).toEqual(heute);
    }
  });

  test('Artikelsumme einer Rechnung/App-Ansicht ohne Endbetrag (lib/belegart.js): unter v1.6 ohne Punkte, sonst wie bisher', () => {
    const app = { belegart: 'app_kassenbon', items: [{ name: 'A', priceCents: 500 }, { name: 'B', priceCents: 300 }, { name: 'Eingelöste Punkte', priceCents: -100 }] };
    expect(belegBereinigen(app, abgleichOptionen('v1.6'))).toMatchObject({ totalCents: 800, summeAusArtikeln: true });
    expect(belegBereinigen(app, abgleichOptionen('v1.5'))).toMatchObject({ totalCents: 700, summeAusArtikeln: true });
    expect(belegBereinigen(app)).toEqual(belegBereinigen(app, abgleichOptionen('v1.5')));
    // Dieselbe Summe wie der Abgleich mit denselben Optionen → geht auf.
    expect(reconcile(belegBereinigen(app, abgleichOptionen('v1.6')), abgleichOptionen('v1.6'))).toMatchObject({ ok: true, direction: 'match' });
  });

  test('Zweitprüfung: Fingerabdruck gleicht nach der Fassung der Prüf-Lesung ab', () => {
    const p = dm(9133);
    expect(refereeFingerprint({ parsed: p, promptVersion: 'referee-v2+v1.6' }).reconOk).toBe(true);
    expect(refereeFingerprint({ parsed: p, promptVersion: 'referee-v2+v1.5' }).reconOk).toBe(false);
    expect(refereeFingerprint({ parsed: p }).reconOk).toBe(false);
  });
});

// ═══ 4. d) Einigung unter LOW nur bei exaktem Abgleich ═════════════════════

const LESUNG_PREISE = [200, 200, 200, 200, 200];
/** Eine Lesung: 5 Artikel, Endbetrag 10 €. `luecke` macht Σ kleiner (Pfand-Toleranz), `kennung` die Folge anders. */
const lesung = ({ luecke = 0, kennung = '', total = 1000, extra = [] } = {}) => ({
  isReceipt: true, merchant: 'Netto Marken-Discount', bonDate: '2026-10-07', bonTime: '10:15', totalCents: total,
  items: [
    ...LESUNG_PREISE.map((p, i) => ({ name: `Artikel ${String.fromCharCode(65 + i)}${kennung}`, priceCents: i === 0 ? p - luecke : p, qty: 1 })),
    ...extra,
  ],
});

/** Schein-extractReceipt: antwort(zweck, n je Stufe) → parsed; trägt die Fassung der Aufruf-Optionen wie das echte. */
function leiter(antwort) {
  const aufrufe = [];
  const f = async (bytes, mime, opts) => {
    aufrufe.push(opts);
    const n = aufrufe.filter((o) => o.zweck === opts.zweck).length;
    const parsed = antwort(opts.zweck, n);
    if (!parsed) throw new Error('keine Antwort vorgesehen');
    return { parsed: JSON.parse(JSON.stringify(parsed)), model: opts.model, promptVersion: opts.promptVersion, latencyMs: 1 };
  };
  f.aufrufe = aufrufe;
  f.zwecke = () => aufrufe.map((o) => o.zweck);
  return f;
}
const lauf = (antwort, opts) => {
  const extract = leiter(antwort);
  return robust.extractReceiptRobust(Buffer.from('bon'), 'image/jpeg', { extract, ...opts }).then((out) => ({ out, extract }));
};
const LOW16 = { promptVersion: 'v1.6', denkstufe: 'LOW' };

describe('d) Unter Denkstufe LOW zählt eine Einigung zweier LOW-Lesungen nur bei exaktem Abgleich', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test('exakt abgeglichen → wie bisher nach zwei Lesungen high', async () => {
    const { out, extract } = await lauf(() => lesung(), LOW16);
    expect(extract.aufrufe).toHaveLength(2);
    expect(out.robust).toMatchObject({ confidence: 'high', method: 'flash-agreement', denkstufe: 'LOW', einigungNurExakt: true });
    expect(out.robust.reads.map((r) => r.reconExakt)).toEqual([true, true]);
    expect(extract.aufrufe[0].thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  test.each([['v1.6', LOW16], ['v1.5', { promptVersion: 'v1.5', denkstufe: 'LOW' }]])(
    'Σ 50 ct unter dem Endbetrag (Pfand-Toleranz), alle Lesungen gleich (%s) → keine high-Einigung der LOW-Lesungen; die Leiter läuft weiter, bis die Eskalation bestätigt',
    async (_v, opts) => {
      const { out, extract } = await lauf(() => lesung({ luecke: 50 }), opts);
      expect(extract.zwecke()).toEqual(['bon-ocr', 'bon-ocr', 'bon-ocr', 'bon-ocr-verbessert', 'bon-ocr-verbessert', 'bon-ocr-eskalation']);
      // Die Eskalations-Lesung (HIGH) bestätigt die Folge → Einigung wie bisher
      // bei einer Bestätigung durch die Eskalation (gewählt: erste Lesung).
      expect(out.robust).toMatchObject({ confidence: 'high', method: 'pro-agreement', attempts: 6, proAttempts: 1, einigungNurExakt: true });
      expect(out.robust.reads.map((r) => r.reconExakt)).toEqual([false, false, false, false, false, false]);
      expect(out.robust.reads.map((r) => r.reconOk)).toEqual([true, true, true, true, true, true]);
    },
  );

  test.each([
    ['ohne Denkstufe (v1.6)', { promptVersion: 'v1.6' }],
    ["'LOW' mit v1.4 (wirkt nicht)", { promptVersion: 'v1.4', denkstufe: 'LOW' }],
    ["'LOW' mit Modell vor Gemini 3 (wirkt nicht)", { promptVersion: 'v1.6', denkstufe: 'LOW', model: 'gemini-2.5-flash' }],
  ])('%s → Einigung unverändert: high nach zwei Lesungen, keine neuen Felder', async (_n, opts) => {
    const { out, extract } = await lauf(() => lesung({ luecke: 50 }), opts);
    expect(extract.aufrufe).toHaveLength(2);
    expect(out.robust).toMatchObject({ confidence: 'high', method: 'flash-agreement', denkstufe: null });
    expect(out.robust).not.toHaveProperty('einigungNurExakt');
    for (const r of out.robust.reads) expect(r).not.toHaveProperty('reconExakt');
  });

  test('zwei ungefähre + später zwei exakte LOW-Lesungen derselben anderen Folge → die exakte Folge gewinnt (verbessertes Bild)', async () => {
    const { out, extract } = await lauf((zweck, n) => {
      if (zweck === 'bon-ocr') return n <= 2 ? lesung({ luecke: 50 }) : lesung({ kennung: 'x' });
      if (zweck === 'bon-ocr-verbessert') return lesung({ kennung: 'x' });
      return null;
    }, LOW16);
    expect(extract.aufrufe).toHaveLength(4);
    expect(out.robust).toMatchObject({ confidence: 'high', method: 'enhanced-agreement' });
    expect(out.parsed.items[0].name).toBe('Artikel Ax');
    expect(out.robust.reads.map((r) => r.reconExakt)).toEqual([false, false, true, true]);
  });

  test('dieselbe Folge, eine Lesung exakt, eine mit anderem Endbetrag → erst die zweite exakte Lesung einigt', async () => {
    const { out, extract } = await lauf((zweck, n) => (n === 2 ? lesung({ total: 1050 }) : lesung()), LOW16);
    expect(extract.aufrufe).toHaveLength(3);
    expect(out.robust).toMatchObject({ confidence: 'high', method: 'flash-agreement' });
    expect(out.parsed.totalCents).toBe(1000);
    expect(out.robust.reads.map((r) => r.reconExakt)).toEqual([true, false, true]);
  });

  test('LOW-Lesungen ungefähr einig, beide Eskalations-Lesungen exakt mit anderer Folge → medium aus der Eskalation (die LOW-Folge zählt nicht)', async () => {
    const { out } = await lauf((zweck) => (zweck === 'bon-ocr-eskalation' ? lesung({ kennung: 'p' }) : lesung({ luecke: 50 })), LOW16);
    expect(out.robust).toMatchObject({ confidence: 'medium', method: 'pro-agreement', attempts: 7 });
    expect(out.parsed.items[0].name).toBe('Artikel Ap');
  });

  test('nichts bestätigt → wie bei fehlender Einigung: low aus der ersten abgeglichenen Lesung', async () => {
    const { out } = await lauf((zweck, n) => (zweck === 'bon-ocr-eskalation' ? lesung({ kennung: `p${n}` }) : lesung({ luecke: 50 })), LOW16);
    expect(out.robust).toMatchObject({ confidence: 'low', method: 'reconcile-no-agreement', attempts: 7 });
    expect(out.parsed.items[0].name).toBe('Artikel A');
  });

  test('Zwischenstand: unterbrochene Leiter unter LOW endet genauso wie die durchgelaufene', async () => {
    const antwort = () => lesung({ luecke: 50 });
    const durch = (await lauf(antwort, LOW16)).out;
    let t = 0;
    const extract = leiter((...a) => {
      t += 10;
      return antwort(...a);
    });
    const err = await robust.extractReceiptRobust(Buffer.from('bon'), 'image/jpeg', {
      extract, ...LOW16, laufStart: 0, zeit: { budgetMs: 15, leseLimitMs: 10, reserveMs: 5 }, clock: () => t,
    }).then(() => null, (e) => e);
    expect(err).toMatchObject({ code: 'ocr_zeitbudget' });
    const stand = JSON.parse(JSON.stringify(err.zwischenstand));
    expect(stand.reads).toHaveLength(2); // zwei ungefähr einige LOW-Lesungen — NICHT entschieden
    const weiter = await lauf(antwort, { ...LOW16, zwischenstand: stand, clock: () => stand.gespeichertMs + 1 });
    expect(weiter.extract.zwecke()).toEqual(['bon-ocr', 'bon-ocr-verbessert', 'bon-ocr-verbessert', 'bon-ocr-eskalation']);
    const ohneLauf = (r) => ({ ...r, laeufe: undefined });
    expect(ohneLauf(weiter.out.robust)).toEqual(ohneLauf(durch.robust));
    expect(weiter.out.robust.laeufe).toBe(2);
    expect(weiter.out.parsed).toEqual(durch.parsed);
  });

  test('Punkte-Zeile in beiden Lesungen: unter v1.6 exakt → high; dieselben Lesungen unter v1.5 gleichen gar nicht ab', async () => {
    const payback = { name: 'PAYBACK Punkte eingelöst', priceCents: -200, category: 'Warenkorbrabatt', raw: 'PAYBACK Punkte eingelöst -2,00' };
    const mitPunkten = () => lesung({ extra: [payback] });
    const v16 = await lauf(mitPunkten, LOW16);
    expect(v16.extract.aufrufe).toHaveLength(2);
    expect(v16.out.robust).toMatchObject({ confidence: 'high', method: 'flash-agreement' });
    expect(v16.out.robust.reads.map((r) => r.reconExakt)).toEqual([true, true]);
    const v15 = await lauf(mitPunkten, { promptVersion: 'v1.5', denkstufe: 'LOW' });
    expect(v15.extract.aufrufe).toHaveLength(7);
    expect(v15.out.robust).toMatchObject({ confidence: 'none', method: 'no-reconcile' });
  });
});

// ═══ 5. Echtes SDK, fetch abgefangen — processCashback ═════════════════════

const echtesFetch = globalThis.fetch;
let anfragen;
let zaehler;
let antwortVon;

function bonParsed(n, { einig = false, luecke = 0, extra = [] } = {}) {
  const kennung = einig ? '' : String(n);
  return {
    isReceipt: true,
    merchant: 'Netto Marken-Discount',
    bonCountry: 'DE',
    bonDate: GESTERN,
    bonTime: '10:15',
    subtotalCents: 1000,
    totalCents: 1000,
    items: [
      ...['A', 'B', 'C', 'D', 'E'].map((b, i) => ({ name: `Artikel ${b}${kennung}`, priceCents: i === 0 ? 200 - luecke : 200, qty: 1 })),
      ...extra,
    ],
  };
}

beforeAll(() => {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!/aiplatform[^/]*\.googleapis\.com\/.*:generateContent$/.test(u)) throw new Error(`Netz im Test nicht erlaubt: ${u}`);
    const body = init && typeof init.body === 'string' ? init.body : '';
    const p = JSON.parse(body);
    anfragen.push({ url: u, body, json: p, zweck: (p.labels && p.labels.zweck) || null });
    zaehler += 1;
    const text = JSON.stringify(antwortVon(zaehler));
    const antwort = {
      candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 0 },
    };
    return new Response(JSON.stringify(antwort), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});
afterAll(() => {
  globalThis.fetch = echtesFetch;
});

function aufbauen(konfigExtra = {}) {
  fake.zuruecksetzen();
  fake.store.set('cashback_config/v1', { campaignsEnabled: true, dailyCap: 3, payoutThresholdCents: 1000, ...konfigExtra });
  const jetzt = Date.now();
  fake.store.set('cashback_campaigns/c1', {
    kind: 'receipt', active: true, startAt: fake.zeit(jetzt - 10 * TAG), endAt: fake.zeit(jetzt + 10 * TAG),
    cashbackPerBonCents: 8, budgetRemainingCents: 5000,
  });
  fake.store.set('discounter/netto', { name: 'Netto Marken-Discount', land: 'DE' });
  fake.store.set(`users/${UID}`, { cashback_balance_cents: 0, cashback_lifetime_cents: 0 });
}

function bonAnlegen(id = 'b1', extra = {}) {
  fake.store.set(`receipts/${id}`, {
    userId: UID,
    status: 'ocr_pending',
    campaignId: 'c1',
    createdAt: fake.zeit(Date.now() - 60 * 60 * 1000),
    storage: { bucket: 'b', path: `cashback-uploads/${UID}/${id}.jpg` },
    ...extra,
  });
}

let ev = 0;
const verarbeiten = (id = 'b1') => fn.processCashback({ id: `ev-${id}-${++ev}`, data: { message: { json: { cashbackId: id, uid: UID } } } });

async function frischerLauf(konfig, antwort = (n) => bonParsed(n)) {
  anfragen = [];
  zaehler = 0;
  antwortVon = antwort;
  aufbauen(konfig);
  bonAnlegen();
  await verarbeiten();
  return { anfragen: anfragen.slice(), bon: fake.store.get('receipts/b1') };
}

async function zweitpruefungsLauf(konfig, version) {
  anfragen = [];
  zaehler = 0;
  antwortVon = (n) => bonParsed(n);
  aufbauen({ ocrReferee: true, ...konfig });
  const falsch = { ...bonParsed(0), totalCents: 1234 };
  bonAnlegen('b1', {
    ocr: {
      engine: 'gemini-robust', model: 'gemini-3.5-flash', promptVersion: version, parsed: falsch,
      robust: { confidence: 'none', attempts: 7, reads: [] },
      reconciliation: null,
      refereeRequest: { reason: 'reconciliation_delta', confidence: 'none' },
    },
  });
  await verarbeiten();
  return { anfragen: anfragen.slice(), bon: fake.store.get('receipts/b1') };
}

const nachZweck = (liste) => {
  const out = {};
  for (const a of liste) (out[a.zweck] = out[a.zweck] || []).push(a);
  return out;
};
const systemText = (json) => json.systemInstruction.parts.map((p) => p.text).join('');
const ohneSystem = (json) => {
  const k = JSON.parse(JSON.stringify(json));
  delete k.systemInstruction;
  return k;
};

describe('Echtes SDK: Anfragen', () => {
  beforeEach(() => {
    global.__logs = [];
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test.each([
    ['alle Schalter fehlen', {}],
    ["ocrPrompt 'v1.4'", { ocrPrompt: 'v1.4' }],
    ["ocrPrompt 'V1.6' (Tippfehler → v1.4)", { ocrPrompt: 'V1.6' }],
    ['alle Schalter ausdrücklich aus', { ocrPrompt: 'v1.4', ocrDenkstufe: null, stornoAufrechnen: false }],
  ])('%s → jede Anfrage byte-gleich zum Stand 7ffa95c2 (ganze Leiter und Einigung)', async (_n, konfig) => {
    const uneinig = await frischerLauf(konfig);
    const z = nachZweck(uneinig.anfragen);
    expect(Object.keys(z).sort()).toEqual(['bon-ocr', 'bon-ocr-eskalation', 'bon-ocr-verbessert']);
    expect(z['bon-ocr']).toHaveLength(3);
    for (const a of uneinig.anfragen) expect(sha(a.body)).toBe(ANFRAGEN.aus[a.zweck]);
    expect(uneinig.bon.ocr.promptVersion).toBe('v1.4');
    expect(uneinig.bon.ocr.robust).not.toHaveProperty('einigungNurExakt');
    expect(uneinig.bon.ocr.reconciliation).not.toHaveProperty('punkteZahlungCents');

    // Pfand-Toleranz: ohne LOW unverändert nach zwei Lesungen high.
    const pfand = await frischerLauf(konfig, (n) => bonParsed(n, { einig: true, luecke: 50 }));
    expect(pfand.anfragen).toHaveLength(2);
    for (const a of pfand.anfragen) expect(sha(a.body)).toBe(ANFRAGEN.aus[a.zweck]);
    expect(pfand.bon).toMatchObject({ status: 'approved', cashbackCents: 8 });
    expect(pfand.bon.ocr.robust).toMatchObject({ confidence: 'high', method: 'flash-agreement' });
  });

  test('Zweitprüfung ohne Schalter: byte-gleich', async () => {
    const { anfragen: liste } = await zweitpruefungsLauf({}, 'v1.4');
    expect(liste.length).toBeGreaterThan(0);
    for (const a of liste) expect(sha(a.body)).toBe(ANFRAGEN.aus['bon-zweitpruefung']);
  });

  test.each([
    ["ocrPrompt 'v1.5'", { ocrPrompt: 'v1.5' }, 'v15'],
    ["ocrPrompt 'v1.5' + Denkstufe 'LOW'", { ocrPrompt: 'v1.5', ocrDenkstufe: 'LOW' }, 'v15low'],
  ])('%s → Anfragen byte-gleich zum Stand vor diesem Bau', async (_n, konfig, golden) => {
    const { anfragen: liste, bon } = await frischerLauf(konfig);
    expect(liste).toHaveLength(7);
    for (const a of liste) expect(sha(a.body)).toBe(ANFRAGEN[golden][a.zweck]);
    expect(bon.ocr.promptVersion).toBe('v1.5');
  });

  test('Zweitprüfung zur v1.5-Erstlesung: byte-gleich zum Stand vor diesem Bau', async () => {
    const { anfragen: liste } = await zweitpruefungsLauf({}, 'v1.5');
    expect(liste.length).toBeGreaterThan(0);
    for (const a of liste) expect(sha(a.body)).toBe(ANFRAGEN.v15['bon-zweitpruefung']);
  });

  test.each([
    ["ocrPrompt 'v1.6'", { ocrPrompt: 'v1.6' }, { ocrPrompt: 'v1.5' }],
    ["ocrPrompt 'v1.6' + Denkstufe 'LOW'", { ocrPrompt: 'v1.6', ocrDenkstufe: 'LOW' }, { ocrPrompt: 'v1.5', ocrDenkstufe: 'LOW' }],
  ])('%s → jede Anfrage gleich der v1.5-Anfrage bis auf den Systemtext (= Prompt v1.6)', async (_n, konfig, vergleich) => {
    const v15 = nachZweck((await frischerLauf(vergleich)).anfragen);
    const { anfragen: liste, bon } = await frischerLauf(konfig);
    const z = nachZweck(liste);
    expect(Object.keys(z).sort()).toEqual(Object.keys(v15).sort());
    for (const [zweck, l] of Object.entries(z)) {
      expect(l).toHaveLength(v15[zweck].length);
      l.forEach((a, i) => {
        expect(systemText(a.json)).toBe(PROMPT.promptFuer('v1.6').SYSTEM_PROMPT);
        expect(ohneSystem(a.json)).toEqual(ohneSystem(v15[zweck][i].json));
        expect(a.url).toBe(v15[zweck][i].url);
      });
    }
    expect(bon.ocr.promptVersion).toBe('v1.6');
    if (konfig.ocrDenkstufe) {
      expect(z['bon-ocr'][0].json.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
      expect(bon.ocr.robust.denkstufe).toBe('LOW');
    } else {
      expect(z['bon-ocr'][0].json.generationConfig).not.toHaveProperty('thinkingConfig');
    }
    expect(global.__logs.find(([m]) => m === 'ocr-denkstufe-ohne-v15')).toBeUndefined();
  });

  test('Zweitprüfung zur v1.6-Erstlesung: Prompt referee-v2+v1.6, sonst gleich der v1.5-Prüfung', async () => {
    const v15 = (await zweitpruefungsLauf({}, 'v1.5')).anfragen;
    const { anfragen: liste, bon } = await zweitpruefungsLauf({}, 'v1.6');
    expect(liste).toHaveLength(v15.length);
    liste.forEach((a, i) => {
      expect(a.zweck).toBe('bon-zweitpruefung');
      expect(systemText(a.json)).toBe(REFEREE.refereePromptFuer('v1.6').SYSTEM_PROMPT);
      expect(ohneSystem(a.json)).toEqual(ohneSystem(v15[i].json));
    });
    expect(bon.ocr.referee.promptVersion).toBe('referee-v2+v1.6');
  });
});

describe('Echtes SDK: Entscheidungen', () => {
  beforeEach(() => {
    global.__logs = [];
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const payback = { name: 'PAYBACK Punkte eingelöst', priceCents: -200, category: 'Warenkorbrabatt', raw: 'PAYBACK Punkte eingelöst -2,00' };

  test('c) Netto mit eingelösten PAYBACK-Punkten (Zeile doch in items, Endbetrag vor den Punkten): v1.6 gutgeschrieben, v1.5 abgelehnt', async () => {
    const antwort = (n) => bonParsed(n, { einig: true, extra: [payback] });
    const v16 = await frischerLauf({ ocrPrompt: 'v1.6' }, antwort);
    expect(v16.anfragen).toHaveLength(2);
    expect(v16.bon).toMatchObject({ status: 'approved', cashbackCents: 8 });
    expect(v16.bon.ocr.reconciliation).toMatchObject({ ok: true, direction: 'match', signedDeltaCents: 0, punkteZahlungCents: 200 });
    // Die Punkte-Zeile wird kein gekauftes Produkt.
    const produkte = [...fake.store.keys()].filter((k) => k.startsWith(`users/${UID}/purchased_products/`)).map((k) => fake.store.get(k));
    expect(produkte.length).toBe(5);
    expect(produkte.every((p) => p.priceCents > 0)).toBe(true);

    const v15 = await frischerLauf({ ocrPrompt: 'v1.5' }, antwort);
    expect(v15.bon).toMatchObject({ status: 'rejected', rejectReason: 'reconciliation_delta' });
    expect(v15.bon.ocr.reconciliation).not.toHaveProperty('punkteZahlungCents');
  });

  test("d) v1.6 + 'LOW', Σ in der Pfand-Toleranz, alle Lesungen gleich → erst die Eskalation bestätigt (6 Aufrufe statt 2)", async () => {
    const antwort = (n) => bonParsed(n, { einig: true, luecke: 50 });
    const ohne = await frischerLauf({ ocrPrompt: 'v1.6' }, antwort);
    expect(ohne.anfragen).toHaveLength(2);
    const mit = await frischerLauf({ ocrPrompt: 'v1.6', ocrDenkstufe: 'LOW' }, antwort);
    expect(mit.anfragen.map((a) => a.zweck)).toEqual(['bon-ocr', 'bon-ocr', 'bon-ocr', 'bon-ocr-verbessert', 'bon-ocr-verbessert', 'bon-ocr-eskalation']);
    expect(mit.bon.ocr.robust).toMatchObject({ confidence: 'high', method: 'pro-agreement', einigungNurExakt: true });
    expect(mit.bon.status).toBe('approved');
  });
});

// ─── Gegenprobe der Entscheidungen (nur mit PROMPT16_AUFNAHME_DATEI) ───────

(process.env.PROMPT16_AUFNAHME_DATEI ? test : test.skip)('Aufnahme der Bon-Dokumente (Gegenprobe vorher/nachher)', async () => {
  const out = {};
  const hashes = (liste) => {
    const h = {};
    for (const a of liste) {
      h[a.zweck] = h[a.zweck] || [];
      if (!h[a.zweck].includes(sha(a.body))) h[a.zweck].push(sha(a.body));
    }
    return h;
  };
  const szenarien = { aus: {}, v14: { ocrPrompt: 'v1.4' }, v15: { ocrPrompt: 'v1.5' }, v15low: { ocrPrompt: 'v1.5', ocrDenkstufe: 'LOW' } };
  for (const [name, k] of Object.entries(szenarien)) {
    for (const [art, antwort] of [
      ['uneinig', (n) => bonParsed(n)],
      ['einig', (n) => bonParsed(n, { einig: true })],
      ['pfand', (n) => bonParsed(n, { einig: true, luecke: 50 })],
    ]) {
      const r = await frischerLauf(k, antwort);
      out[`${name}:${art}`] = { hashes: hashes(r.anfragen), bon: r.bon };
    }
  }
  for (const [name, v] of [['ref14', 'v1.4'], ['ref15', 'v1.5']]) {
    const r = await zweitpruefungsLauf({}, v);
    out[name] = { hashes: hashes(r.anfragen), bon: r.bon };
  }
  require('fs').writeFileSync(process.env.PROMPT16_AUFNAHME_DATEI, JSON.stringify(out, null, 1));
});
