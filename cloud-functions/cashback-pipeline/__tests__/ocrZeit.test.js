'use strict';

/**
 * Robust-OCR-Leiter unter Zeitdruck (03.10.2026, hängende Bons):
 *   - Zeitlimit je Lesung (vorher nur bei der Eskalation),
 *   - die ersten beiden Basis-Lesungen laufen gleichzeitig,
 *   - ein Abbruch durch das eigene Zeitlimit verbraucht den Lese-Platz nicht
 *     (bis zu ERSATZ_MAX-mal je Bon),
 *   - Laufbudget: reicht es nicht, gibt es KEIN Ergebnis, sondern einen
 *     Zwischenstand; ein späterer Lauf setzt genau dort fort,
 *   - eine unterbrochene Leiter liefert dasselbe Ergebnis wie eine durchgelaufene.
 */

const ENV_KEYS = [
  'CASHBACK_OCR_PRO_MODEL', 'CASHBACK_OCR_PRO_THINKING_LEVEL', 'CASHBACK_OCR_PRO_FALLBACK_THINKING_LEVEL',
  'CASHBACK_OCR_PRO_LOCATION', 'CASHBACK_OCR_PRO_TIMEOUT_MS', 'CASHBACK_OCR_MAX_FLASH',
  'CASHBACK_OCR_READ_TIMEOUT_MS', 'CASHBACK_OCR_RUN_BUDGET_MS',
];
let gesichert;
let robust;

function laden() {
  jest.isolateModules(() => {
    robust = require('../lib/ocr_robust');
  });
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  gesichert = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  laden();
});

afterEach(() => {
  console.warn.mockRestore();
  for (const k of ENV_KEYS) {
    if (gesichert[k] === undefined) delete process.env[k];
    else process.env[k] = gesichert[k];
  }
});

const lesung = (items, total, over = {}) => ({
  parsed: { isReceipt: true, merchant: 'REWE', bonDate: '2026-09-28', bonTime: '10:00', totalCents: total, items, ...over },
  promptVersion: 'v1.4',
  latencyMs: 1,
  finishReason: 'STOP',
  inputTokens: 1500,
  outputTokens: 400,
  thoughtsTokens: 900,
  // `raw` (Antworttext) geht nicht in den Zwischenstand — er steht doppelt in
  // `parsed`, und nichts hinter der Leiter liest ihn.
  raw: '{"roh":true}',
});
const A = [{ name: 'Milch', priceCents: 119 }, { name: 'Brot', priceCents: 249 }];
const B = [{ name: 'Milch', priceCents: 119 }, { name: 'Brat', priceCents: 249 }];
const C = [{ name: 'Mlich', priceCents: 119 }, { name: 'Brot', priceCents: 249 }];
const D = [{ name: 'Milk', priceCents: 119 }, { name: 'Brod', priceCents: 249 }];
const X = [{ name: 'X', priceCents: 368 }];
const Y = [{ name: 'Y', priceCents: 368 }];

const zeitAbbruch = (ms = 170000) => Object.assign(new Error(`OCR timeout after ${ms} ms (gemini-3.5-flash)`), { code: 'ocr_timeout' });
const quota = () => new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}');
const enhance = async () => Buffer.from('verbessert');

/**
 * Fake-extract mit Uhr: Antworten der Reihe nach (über mehrere Läufe hinweg),
 * je Antwort eine Dauer. Gleichzeitig gestartete Aufrufe enden zur selben Zeit
 * wie der längste (die Uhr springt auf das späteste Ende).
 */
function fakeMitUhr(antworten, { start = 0 } = {}) {
  const uhr = { t: start };
  const aufrufe = [];
  let laufend = 0;
  let maxGleichzeitig = 0;
  const fn = async (bytes, mime, opts) => {
    const i = aufrufe.length;
    const beginn = uhr.t;
    aufrufe.push({ mime, beginn, ...opts });
    const eintrag = antworten[i];
    if (!eintrag) throw new Error('keine Antwort mehr vorgesehen');
    const { a, dauer = 1000 } = eintrag;
    laufend++;
    maxGleichzeitig = Math.max(maxGleichzeitig, laufend);
    await Promise.resolve();
    await Promise.resolve();
    laufend--;
    uhr.t = Math.max(uhr.t, beginn + dauer);
    if (a instanceof Error) throw a;
    return { ...a, model: opts.model };
  };
  fn.aufrufe = aufrufe;
  fn.uhr = uhr;
  fn.maxGleichzeitig = () => maxGleichzeitig;
  return fn;
}
const ant = (a, dauer) => ({ a, dauer });

/** Wie Firestore: JSON-Hin-und-Zurück. Wirft bei undefined oder reservierten Feldnamen. */
function wieFirestore(obj) {
  (function pruefen(v, pfad) {
    if (v === undefined) throw new Error(`undefined bei ${pfad}`);
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (Array.isArray(x)) throw new Error(`Array in Array bei ${pfad}`);
        pruefen(x, `${pfad}[${i}]`);
      });
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (/^__.*__$/.test(k)) throw new Error(`reservierter Feldname ${k}`);
        pruefen(x, `${pfad}.${k}`);
      }
    }
  })(obj, 'stand');
  return JSON.parse(JSON.stringify(obj));
}

describe('zeitOptionen', () => {
  test('Standard: 170 s je Lesung, 400 s Laufbudget', () => {
    expect(robust.zeitOptionen({})).toEqual({ budgetMs: 400000, leseLimitMs: 170000, reserveMs: 30000 });
    expect(robust.ZEIT).toEqual({ budgetMs: 400000, leseLimitMs: 170000, reserveMs: 30000 });
  });

  test('ungültige Werte gelten als Standard, nie als „kein Limit"', () => {
    for (const w of ['0', '-1', 'abc', '', '5000']) {
      expect(robust.zeitOptionen({ CASHBACK_OCR_READ_TIMEOUT_MS: w }).leseLimitMs).toBe(170000);
    }
    for (const w of ['0', '100000', '600000', 'x']) {
      expect(robust.zeitOptionen({ CASHBACK_OCR_RUN_BUDGET_MS: w }).budgetMs).toBe(400000);
    }
  });

  test('ein Lese-Fenster passt immer ins Budget (sonst Läufe ohne Fortschritt)', () => {
    const z = robust.zeitOptionen({ CASHBACK_OCR_RUN_BUDGET_MS: '200000', CASHBACK_OCR_READ_TIMEOUT_MS: '400000' });
    expect(z.budgetMs).toBe(200000);
    expect(z.leseLimitMs).toBe(170000);
  });
});

describe('Zeitlimit je Lesung und gleichzeitige erste Lesungen', () => {
  test('Basis- und Bildverbesserungs-Lesungen tragen das Zeitlimit, Eskalation ihr eigenes', async () => {
    const extract = fakeMitUhr([A, B, C, D, B.slice(0, 1).concat(D.slice(1)), A].map((x) => ant(lesung(x, 368))));
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/png', { extract, enhance });
    expect(extract.aufrufe.slice(0, 5).map((a) => a.timeoutMs)).toEqual([170000, 170000, 170000, 170000, 170000]);
    expect(extract.aufrufe[5]).toMatchObject({ timeoutMs: 150000, thinkingConfig: { thinkingLevel: 'HIGH' } });
    expect(out.robust).toMatchObject({ confidence: 'high', method: 'pro-agreement', laeufe: 1, zeitAbbrueche: 0 });
  });

  test('die ersten beiden Basis-Lesungen laufen gleichzeitig, die dritte erst danach', async () => {
    const extract = fakeMitUhr([ant(lesung(A, 368), 20000), ant(lesung(B, 368), 30000), ant(lesung(A, 368), 10000)]);
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance });
    expect(extract.aufrufe.map((a) => a.beginn)).toEqual([0, 0, 30000]);
    expect(extract.maxGleichzeitig()).toBe(2);
    // Reihenfolge der Lesungen = Aufruf-Reihenfolge; gewählt wird Lesung 1 (wie nacheinander).
    expect(out.robust).toMatchObject({ confidence: 'high', method: 'flash-agreement', attempts: 3 });
    expect(out.parsed.items[1].name).toBe('Brot');
  });

  test('zwei einige erste Lesungen → fertig nach zwei Aufrufen (keine Mehrkosten)', async () => {
    const extract = fakeMitUhr([ant(lesung(A, 368)), ant(lesung(A, 368))]);
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance });
    expect(extract.aufrufe).toHaveLength(2);
    expect(out.robust).toMatchObject({ confidence: 'high', method: 'flash-agreement', attempts: 2, failedAttempts: 0 });
  });

  test('nach einer Lesung und einem Fehlversuch folgt EINE weitere (nicht zwei)', async () => {
    const extract = fakeMitUhr([ant(lesung(A, 368)), ant(quota()), ant(lesung(A, 368))]);
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance });
    expect(extract.aufrufe).toHaveLength(3);
    expect(extract.aufrufe[2].beginn).toBeGreaterThan(0);
    expect(out.robust).toMatchObject({ confidence: 'high', attempts: 2, failedAttempts: 1, zeitAbbrueche: 0 });
  });
});

describe('Zeitabbruch verbraucht den Lese-Platz nicht', () => {
  test('drei Hänger werden ersetzt — die Leiter entscheidet mit so vielen Lesungen wie ohne Störung', async () => {
    const T = zeitAbbruch();
    const extract = fakeMitUhr([ant(T), ant(T), ant(T), ant(lesung(A, 368)), ant(lesung(A, 368))]);
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance });
    expect(extract.aufrufe).toHaveLength(5);
    expect(extract.aufrufe.every((a) => a.model === 'gemini-3.5-flash' && a.thinkingConfig === undefined)).toBe(true);
    expect(out.robust).toMatchObject({ confidence: 'high', method: 'flash-agreement', attempts: 2, failedAttempts: 3, zeitAbbrueche: 3 });
  });

  test('andere Fehlversuche (429, MAX_TOKENS) verbrauchen den Platz wie bisher', async () => {
    const maxTok = Object.assign(new Error('OCR JSON parse failed (MAX_TOKENS)'), { code: 'ocr_json_decode' });
    const extract = fakeMitUhr([ant(quota()), ant(maxTok), ant(lesung(A, 368)), ant(lesung(B, 368)), ant(lesung(C, 368)), ant(lesung(D, 368)), ant(lesung(C, 999)), ant(lesung(X, 368)), ant(lesung(Y, 368))]);
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance });
    // 3 Basis-Plätze (2 verbraucht durch Fehlversuche), 2 verbessert, 2 Eskalation.
    expect(extract.aufrufe).toHaveLength(7);
    expect(out.robust).toMatchObject({ failedAttempts: 2, zeitAbbrueche: 0 });
  });

  test('nach ERSATZ_MAX Zeitabbrüchen zählen weitere wie jeder Fehlversuch; Totalausfall → ocr_unavailable', async () => {
    const extract = fakeMitUhr(Array.from({ length: 10 }, () => ant(zeitAbbruch())));
    await expect(robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance }))
      .rejects.toMatchObject({ code: 'ocr_unavailable' });
    // 7 Plätze + 3 Ersatzversuche — begrenzt, keine Endlosschleife.
    expect(extract.aufrufe).toHaveLength(7 + robust.ERSATZ_MAX);
  });

  test('Zeitabbruch der Eskalation verbraucht den Platz (wie seit 01.10.): danach EINE Lesung mit LOW', async () => {
    // Dort fängt das 150-s-Limit die Denk-Ausreißer der hohen Denkstufe ab —
    // ein Ersatzversuch mit derselben Stufe liefe vermutlich wieder hinein.
    const extract = fakeMitUhr([A, B, C, D].map((x) => ant(lesung(x, 368)))
      .concat([ant(lesung(C, 999)), ant(zeitAbbruch(150000)), ant(lesung(X, 368)), ant(lesung(Y, 368))]));
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance });
    expect(extract.aufrufe.slice(5).map((a) => a.thinkingConfig)).toEqual([{ thinkingLevel: 'HIGH' }, { thinkingLevel: 'LOW' }]);
    expect(out.robust).toMatchObject({ failedAttempts: 1, zeitAbbrueche: 1, escalationFallbackThinking: 'LOW' });
  });
});

describe('Laufbudget und Fortsetzung', () => {
  const ZEIT = { budgetMs: 400000, leseLimitMs: 170000, reserveMs: 30000 };

  test('Budget erreicht → KEIN Ergebnis, sondern Zwischenstand; keine Lesung ragt über das Budget', async () => {
    const T = zeitAbbruch();
    const extract = fakeMitUhr([ant(T, 170000), ant(T, 170000), ant(T, 170000), ant(lesung(A, 368), 170000)]);
    const versuch = robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', {
      extract, enhance, laufStart: 0, zeit: ZEIT, clock: () => extract.uhr.t,
    });
    const err = await versuch.then(() => null, (e) => e);
    expect(err).toMatchObject({ code: 'ocr_zeitbudget' });
    expect(extract.aufrufe).toHaveLength(4);
    for (const a of extract.aufrufe) expect(a.beginn + a.timeoutMs).toBeLessThanOrEqual(ZEIT.budgetMs);
    const stand = wieFirestore(err.zwischenstand);
    expect(stand).toMatchObject({ v: 1, laeufe: 1, flash: 1, enh: 0, esk: 0, ersatz: 3, zeitAbbrueche: 3, maxFlash: 3, promptVersion: require('../lib/prompt').VERSION });
    expect(stand.reads).toHaveLength(1);
    expect(stand.reads[0]).toMatchObject({ stufe: 'flash', parsed: { totalCents: 368 } });
    expect(stand.reads[0].raw).toBeUndefined();
    expect(stand.failed).toHaveLength(3);
  });

  test('Fortsetzung im nächsten Lauf: dort weiter, wo der erste aufhörte', async () => {
    const T = zeitAbbruch();
    const antworten = [ant(T, 170000), ant(T, 170000), ant(T, 170000), ant(lesung(A, 368), 170000), ant(lesung(A, 368), 15000)];
    const extract = fakeMitUhr(antworten);
    const clock = () => extract.uhr.t;
    const err = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance, laufStart: 0, zeit: ZEIT, clock })
      .then(() => null, (e) => e);
    const laufStart2 = extract.uhr.t + 2000;
    extract.uhr.t = laufStart2;
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', {
      extract, enhance, laufStart: laufStart2, zeit: ZEIT, clock, zwischenstand: wieFirestore(err.zwischenstand),
    });
    // Im zweiten Lauf genau EINE Lesung (die fehlende zweite), nicht wieder ein Paar.
    expect(extract.aufrufe).toHaveLength(5);
    expect(extract.aufrufe[4].beginn).toBe(laufStart2);
    expect(out.robust).toMatchObject({ confidence: 'high', method: 'flash-agreement', attempts: 2, failedAttempts: 3, zeitAbbrueche: 3, laeufe: 2 });
    expect(out.robust.reads.map((r) => r.model)).toEqual(['flash', 'flash']);
  });

  test('Bericht des Zeugen (Haiku-Lesung) übersteht die Fortsetzung — nur abgelegt, nicht neu gefragt (15.10.2026)', async () => {
    const T = zeitAbbruch();
    const extract = fakeMitUhr([ant(T, 170000), ant(T, 170000), ant(T, 170000), ant(lesung(A, 368), 170000), ant(lesung(A, 368), 15000)]);
    const clock = () => extract.uhr.t;
    const ersterLeser = jest.fn(async () => ({ ...lesung(A, 368), model: 'claude-haiku-5-5' }));
    // `zeit: undefined` steht so nie in Firestore — die Ablage muss es entfernen.
    const zeuge = jest.fn(async () => ({ status: 'ok', bestaetigt: false, grund: 'geldfelder', ergebnis: { markt: 'REWE', datum: '2026-09-28', zeit: undefined, summe: 999, preise: [119, 249] } }));
    const err = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance, laufStart: 0, zeit: ZEIT, clock, zeuge, ersterLeser })
      .then(() => null, (e) => e);
    expect(err).toMatchObject({ code: 'ocr_zeitbudget' });
    const stand = wieFirestore(err.zwischenstand);
    expect(stand.zeuge).toMatchObject({ grund: 'geldfelder', ersterLeser: 'claude-haiku-5-5', ersteLesung: { summe: 368, artikel: 2, summenprobe: true } });
    expect(stand.zeuge.ergebnis).not.toHaveProperty('zeit');
    const laufStart2 = extract.uhr.t + 2000;
    extract.uhr.t = laufStart2;
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', {
      extract, enhance, laufStart: laufStart2, zeit: ZEIT, clock, zeuge, ersterLeser, zwischenstand: stand,
    });
    expect(ersterLeser).toHaveBeenCalledTimes(1);
    expect(zeuge).toHaveBeenCalledTimes(1);
    expect(out.robust).toMatchObject({ method: 'flash-agreement', laeufe: 2 });
    expect(out.robust.zeuge).toEqual(stand.zeuge);
  });

  test('ohne laufStart kein Laufbudget (Skripte/Messungen) — nur das Zeitlimit je Lesung', async () => {
    const extract = fakeMitUhr([A, B, C, D, B.slice(0, 1).concat(D.slice(1)), A].map((x) => ant(lesung(x, 368), 160000)));
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance, zeit: ZEIT, clock: () => extract.uhr.t });
    expect(out.robust.confidence).toBe('high');
    expect(extract.uhr.t).toBeGreaterThan(ZEIT.budgetMs);
  });

  // Jede Unterbrechungsstelle: ein Lauf schafft genau EIN Lese-Fenster.
  const SZENARIEN = {
    'Einigung in der Basis-Phase': [lesung(A, 368), lesung(B, 368), lesung(A, 368)],
    'Einigung auf dem verbesserten Bild': [lesung(A, 368), lesung(B, 368), lesung(C, 368), lesung(D, 368), lesung(C, 368)],
    'Einigung der Eskalation, erster Versuch scheitert (LOW)': [lesung(A, 368), lesung(B, 368), lesung(C, 368), lesung(D, 368), lesung(C, 999),
      Object.assign(new Error('OCR JSON parse failed (MAX_TOKENS)'), { code: 'ocr_json_decode' }), lesung(B, 368)],
    'Eskalation zweimal einig (medium)': [lesung(A, 368), lesung(B, 368), lesung(C, 368), lesung(D, 368), lesung(C, 999), lesung(X, 368), lesung(X, 368)],
    'Hänger überall, Ersatzversuche aufgebraucht': [zeitAbbruch(), lesung(A, 368), zeitAbbruch(), lesung(B, 368), lesung(C, 368),
      zeitAbbruch(), lesung(D, 368), lesung(C, 999), zeitAbbruch(150000), lesung(X, 368)],
    'keine Einigung, eine stimmige Lesung (low)': [lesung(A, 368), lesung(B, 999), lesung(C, 999), lesung(D, 999), lesung(C, 998), lesung(X, 1), lesung(Y, 2)],
    'nichts stimmt (none)': [lesung(A, 999), lesung(B, 999), lesung(C, 999), lesung(D, 999), lesung(C, 998), lesung(X, 1), lesung(Y, 2)],
  };

  test.each(Object.entries(SZENARIEN))('%s: unterbrochen an jeder Stelle = durchgelaufen', async (_name, folge) => {
    const ohne = fakeMitUhr(folge.map((a) => ant(a, 10)));
    const erwartet = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract: ohne, enhance });

    // Budget 15, Fenster 10, jede Lesung 10 → genau ein Fenster je Lauf.
    const eng = { budgetMs: 15, leseLimitMs: 10, reserveMs: 5 };
    const mit = fakeMitUhr(folge.map((a) => ant(a, 10)));
    const clock = () => mit.uhr.t;
    let stand = null;
    let out = null;
    let laeufe = 0;
    while (!out) {
      laeufe++;
      if (laeufe > 20) throw new Error('keine Fortsetzung ohne Ende erwartet');
      try {
        out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', {
          extract: mit, enhance, laufStart: mit.uhr.t, zeit: eng, clock, zwischenstand: stand,
        });
      } catch (e) {
        if (e.code !== 'ocr_zeitbudget') throw e;
        stand = wieFirestore(e.zwischenstand);
      }
    }
    expect(laeufe).toBeGreaterThan(1);
    expect(mit.aufrufe.map((a) => [a.model, a.thinkingConfig || null, a.location || null]))
      .toEqual(ohne.aufrufe.map((a) => [a.model, a.thinkingConfig || null, a.location || null]));
    const ohneLaeufe = (o) => ({ ...o, raw: undefined, robust: { ...o.robust, laeufe: undefined } });
    expect(ohneLaeufe(out)).toEqual(ohneLaeufe(erwartet));
    expect(out.robust.laeufe).toBe(laeufe);
  });

  test('Eskalations-Deckel wird über eine Unterbrechung hinweg nur einmal gefragt', async () => {
    const eng = { budgetMs: 15, leseLimitMs: 10, reserveMs: 5 };
    const mit = fakeMitUhr([lesung(A, 368), lesung(B, 368), lesung(C, 368), lesung(D, 368), lesung(C, 368)].map((a) => ant(a, 10)));
    const clock = () => mit.uhr.t;
    const gate = jest.fn(async () => null);
    let stand = null;
    let out = null;
    while (!out) {
      try {
        out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract: mit, enhance, laufStart: mit.uhr.t, zeit: eng, clock, zwischenstand: stand, escalationGate: gate });
      } catch (e) {
        if (e.code !== 'ocr_zeitbudget') throw e;
        stand = wieFirestore(e.zwischenstand);
      }
    }
    expect(gate).toHaveBeenCalledTimes(1);
    expect(out.robust.method).toBe('enhanced-agreement');
  });
});

describe('Zwischenstand prüfen', () => {
  async function standNachEinemLauf() {
    const extract = fakeMitUhr([ant(lesung(A, 368), 10), ant(lesung(B, 368), 10)]);
    const err = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', {
      extract, enhance, laufStart: 0, zeit: { budgetMs: 15, leseLimitMs: 10, reserveMs: 5 }, clock: () => extract.uhr.t,
    }).then(() => null, (e) => e);
    return wieFirestore(err.zwischenstand);
  }

  test.each([
    ['anderer Prompt', (s) => ({ ...s, promptVersion: 'v1.3' }), 'prompt'],
    ['anderes Modell', (s) => ({ ...s, model: 'gemini-2.5-flash' }), 'modell'],
    ['andere Eskalation', (s) => ({ ...s, eskModel: 'gemini-2.5-pro' }), 'modell'],
    ['andere Zahl Basis-Lesungen', (s) => ({ ...s, maxFlash: 5 }), 'max_flash'],
    ['zu alt', (s) => ({ ...s, gespeichertMs: s.gespeichertMs - 7 * 60 * 60 * 1000 }), 'alter'],
    ['mehr Lesungen als Plätze', (s) => ({ ...s, flash: 0 }), 'zaehler'],
    ['kaputte Lesung', (s) => ({ ...s, reads: [{ stufe: 'flash' }] }), 'form'],
    ['andere Version', (s) => ({ ...s, v: 2 }), 'version'],
  ])('%s → verworfen, frisch gelesen', async (_name, aendern, grund) => {
    const stand = aendern(await standNachEinemLauf());
    const extract = fakeMitUhr([ant(lesung(A, 368)), ant(lesung(A, 368))]);
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', {
      extract, enhance, zwischenstand: stand, clock: () => 20,
    });
    expect(extract.aufrufe).toHaveLength(2);
    // Auch ein verworfener Stand zählt als Lauf (sonst begänne die Zählung neu).
    expect(out.robust).toMatchObject({ laeufe: stand.laeufe + 1, attempts: 2, method: 'flash-agreement' });
    expect(console.warn).toHaveBeenCalledWith('ocr-zwischenstand-verworfen', { grund });
  });

  test('Lesung ohne verwertbares JSON (parsed: null) wird mitgeführt, nicht verworfen', async () => {
    const stand = await standNachEinemLauf();
    stand.reads.push({ ...stand.reads[0], parsed: null });
    stand.flash += 1;
    const geladen = robust.zwischenstandLaden(wieFirestore(stand), {
      model: stand.model, eskModel: stand.eskModel, maxFlash: stand.maxFlash, jetzt: stand.gespeichertMs,
    });
    expect(geladen.grund).toBeNull();
    expect(geladen.stand.reads).toHaveLength(3);
    expect(geladen.stand.reads[2].parsed).toBeNull();
  });

  test('Bericht des Zeugen: nur ein Objekt wird übernommen, ein verworfener Stand bringt keinen mit', async () => {
    const stand = await standNachEinemLauf();
    const opts = { model: stand.model, eskModel: stand.eskModel, maxFlash: stand.maxFlash, jetzt: stand.gespeichertMs };
    expect(robust.zwischenstandLaden(stand, opts).zeuge).toBeNull();
    expect(robust.zwischenstandLaden({ ...stand, zeuge: 'x' }, opts).zeuge).toBeNull();
    expect(robust.zwischenstandLaden({ ...stand, zeuge: [1] }, opts).zeuge).toBeNull();
    expect(robust.zwischenstandLaden({ ...stand, zeuge: { status: 'ok' } }, opts).zeuge).toEqual({ status: 'ok' });
    expect(robust.zwischenstandLaden({ ...stand, v: 2, zeuge: { status: 'ok' } }, opts).zeuge).toBeUndefined();
  });

  test('vertippte Zahl Basis-Lesungen (CASHBACK_OCR_MAX_FLASH) gilt als Standard 3, nie als NaN', () => {
    for (const wert of ['3x', '0', '2.5', '']) {
      process.env.CASHBACK_OCR_MAX_FLASH = wert;
      laden();
      expect(robust.MAX_FLASH).toBe(3);
    }
    process.env.CASHBACK_OCR_MAX_FLASH = '4';
    laden();
    expect(robust.MAX_FLASH).toBe(4);
  });

  test('passender Zwischenstand wird übernommen (Lesungen werden nicht wiederholt)', async () => {
    const stand = await standNachEinemLauf();
    const extract = fakeMitUhr([ant(lesung(A, 368))]);
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance, zwischenstand: stand, clock: () => 20 });
    expect(extract.aufrufe).toHaveLength(1);
    expect(out.robust).toMatchObject({ laeufe: 2, attempts: 3, method: 'flash-agreement' });
  });
});
