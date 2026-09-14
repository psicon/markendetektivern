'use strict';
const { runReferee, REFEREE_MODEL, REFEREE_FALLBACK_MODEL } = require('../lib/ocr_referee');

/** Eine Lesung, wie extractReceipt sie liefert. */
const lesung = (over = {}, parsedOver = {}) => ({
  model: REFEREE_MODEL,
  promptVersion: 'referee-v1+v1.4',
  finishReason: 'STOP',
  inputTokens: 3000,
  outputTokens: 1200,
  thoughtsTokens: 3400,
  parsed: {
    isReceipt: true,
    merchant: 'NETTO',
    bonCountry: 'DE',
    bonDate: '2026-09-10',
    bonTime: '18:02',
    totalCents: 3787,
    subtotalCents: 3987,
    items: [{ name: 'Kaffee', priceCents: 1987 }, { name: 'Butter', priceCents: 2000 }],
    basketDiscounts: [{ label: 'Gutschein Netto-App', cents: 200 }],
    bonComplete: true,
    ...parsedOver,
  },
  ...over,
});

/** Fake-extract: arbeitet eine Liste von Antworten (Objekt oder Error) ab. */
function fakeExtract(antworten) {
  const aufrufe = [];
  const fn = async (bytes, mime, opts) => {
    aufrufe.push(opts);
    const a = antworten[aufrufe.length - 1];
    if (a instanceof Error) throw a;
    if (!a) throw new Error('keine Antwort mehr vorgesehen');
    return { ...a, model: opts.model };
  };
  fn.aufrufe = aufrufe;
  return fn;
}

const ctx = (extract, over = {}) => ({
  reason: 'reconciliation_delta',
  // Erstlesungen, die zur Lesung passen (Endsumme, Artikelzahl) — plausibel().
  prior: [{ isReceipt: true, totalCents: 3787, eligibleItems: 2, bonDate: '2026-09-10' }],
  merchantKeyFor: async (name) => (name ? `id:${String(name).toLowerCase()}` : null),
  extract,
  ...over,
});

describe('runReferee', () => {
  test('entscheidet nach zwei übereinstimmenden Lesungen und liest nicht weiter', async () => {
    const extract = fakeExtract([lesung(), lesung()]);
    const { result, chosen } = await runReferee(Buffer.from('x'), 'image/jpeg', ctx(extract));
    expect(extract.aufrufe).toHaveLength(2);
    expect(result).toMatchObject({ verdict: 'decided', grund: 'zwei_lesungen_einig', chosenIndex: 0, paar: [0, 1], attempts: 2, failedAttempts: 0 });
    expect(chosen.parsed.totalCents).toBe(3787);
    expect(result.tokens).toEqual({ input: 6000, output: 2400, thoughts: 6800 });
  });

  test('ruft mit eigenem Prompt, Schema, Denkstufe LOW, Temperatur 1.0 und Zeitlimit auf', async () => {
    const extract = fakeExtract([lesung(), lesung()]);
    await runReferee(Buffer.from('x'), 'image/jpeg', ctx(extract));
    const o = extract.aufrufe[0];
    expect(o.model).toBe(REFEREE_MODEL);
    expect(o.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(o.temperature).toBe(1.0);
    expect(o.timeoutMs).toBeGreaterThan(0);
    expect(o.responseSchema.properties.basketDiscounts).toBeDefined();
    expect(o.userPrompt).toMatch(/Zweitprüfung/);
    expect(o.systemInstruction).toMatch(/basketDiscounts/);
  });

  test('kein Hinweis auf Ablehngrund oder Upload-Datum im Prompt (lädt zum Zurechtbiegen ein)', async () => {
    const extract = fakeExtract([lesung(), lesung()]);
    await runReferee(Buffer.from('x'), 'image/jpeg', ctx(extract, { reason: 'bon_too_old' }));
    const o = extract.aufrufe[0];
    expect(o.userPrompt).not.toMatch(/hochgeladen|Upload|Datum|Summe|Endbetrag/i);
  });

  test('429 → Rückfall auf das Ersatzmodell (gedeckeltes Denken, Temperatur 0.1)', async () => {
    const quota = new Error('got status: 429 RESOURCE_EXHAUSTED');
    const extract = fakeExtract([quota, lesung(), lesung()]);
    const { result } = await runReferee(Buffer.from('x'), 'image/jpeg', ctx(extract));
    expect(extract.aufrufe.map((o) => o.model)).toEqual([REFEREE_MODEL, REFEREE_FALLBACK_MODEL, REFEREE_FALLBACK_MODEL]);
    expect(extract.aufrufe[1].thinkingConfig).toEqual({ thinkingBudget: 4096 });
    expect(extract.aufrufe[1].temperature).toBe(0.1);
    expect(result).toMatchObject({ verdict: 'decided', fallbackModel: REFEREE_FALLBACK_MODEL, failedAttempts: 1 });
  });

  test('404 (Preview-Modell weg) → ebenfalls Rückfall', async () => {
    const weg = new Error('{"error":{"code":404,"message":"Publisher model ... was not found","status":"NOT_FOUND"}}');
    const extract = fakeExtract([weg, lesung(), lesung()]);
    const { result } = await runReferee(Buffer.from('x'), 'image/jpeg', ctx(extract));
    expect(extract.aufrufe[1].model).toBe(REFEREE_FALLBACK_MODEL);
    expect(result.verdict).toBe('decided');
  });

  test('ohne Erstlesungen trägt ein Warenkorb-Rabatt nicht (kein Maßstab)', async () => {
    const extract = fakeExtract([lesung(), lesung(), lesung(), lesung()]);
    const { result } = await runReferee(Buffer.from('x'), 'image/jpeg', ctx(extract, { prior: [] }));
    expect(result.verdict).toBe('undecided');
  });

  test('Lesungen, die den Erstlesungen widersprechen, entscheiden nicht', async () => {
    const extract = fakeExtract([lesung(), lesung(), lesung(), lesung()]);
    const prior = [{ isReceipt: true, totalCents: 9999, eligibleItems: 2, bonDate: '2026-09-10' }];
    const { result } = await runReferee(Buffer.from('x'), 'image/jpeg', ctx(extract, { prior }));
    expect(result).toMatchObject({ verdict: 'undecided', grund: 'widerspricht_erstlesung' });
  });

  test('alle Lesungen scheitern → failed, nicht entschieden', async () => {
    const extract = fakeExtract([new Error('timeout'), new Error('timeout'), new Error('timeout'), new Error('timeout')]);
    const { result, chosen } = await runReferee(Buffer.from('x'), 'image/jpeg', ctx(extract));
    expect(chosen).toBeNull();
    expect(result).toMatchObject({ verdict: 'failed', grund: 'alle_lesungen_fehlgeschlagen', failedAttempts: 3 });
    // Nach drei Fehlschlägen reicht der vierte Versuch rechnerisch nicht mehr für zwei Zeugen.
    expect(extract.aufrufe).toHaveLength(3);
  });

  test('ohne Zeugen nach drei Lesungen → keine vierte, undecided', async () => {
    const kaputt = lesung({}, { bonComplete: false });
    const extract = fakeExtract([kaputt, kaputt, kaputt, lesung()]);
    const { result } = await runReferee(Buffer.from('x'), 'image/jpeg', ctx(extract));
    expect(extract.aufrufe).toHaveLength(3);
    expect(result).toMatchObject({ verdict: 'undecided', grund: 'zu_wenige_zeugen' });
  });

  test('ein Zeuge nach drei Lesungen → die vierte darf noch entscheiden', async () => {
    const kaputt = lesung({}, { bonComplete: false });
    const extract = fakeExtract([kaputt, lesung(), kaputt, lesung()]);
    const { result } = await runReferee(Buffer.from('x'), 'image/jpeg', ctx(extract));
    expect(extract.aufrufe).toHaveLength(4);
    expect(result).toMatchObject({ verdict: 'decided', chosenIndex: 1 });
  });

  test('uneinige Lesungen → dritte Lesung darf entscheiden', async () => {
    const extract = fakeExtract([lesung({}, { totalCents: 3788, subtotalCents: 3988, items: [{ name: 'X', priceCents: 3988 }] }), lesung(), lesung()]);
    const { result } = await runReferee(Buffer.from('x'), 'image/jpeg', ctx(extract));
    expect(extract.aufrufe).toHaveLength(3);
    expect(result).toMatchObject({ verdict: 'decided', chosenIndex: 1 });
  });

  test('Frist erreicht → keine weitere Lesung', async () => {
    let jetzt = 0;
    const extract = fakeExtract([lesung({}, { totalCents: 1 }), lesung()]);
    const langsam = async (...a) => { jetzt += 310_000; return extract(...a); };
    langsam.aufrufe = extract.aufrufe;
    const { result } = await runReferee(Buffer.from('x'), 'image/jpeg', ctx(langsam, { clock: () => jetzt }));
    expect(extract.aufrufe).toHaveLength(1);
    expect(result.failures).toContain('frist_erreicht');
    expect(result.verdict).toBe('undecided');
  });
});
