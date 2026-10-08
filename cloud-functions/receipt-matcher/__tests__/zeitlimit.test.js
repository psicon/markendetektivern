'use strict';

/**
 * Zeitlimit + Kosten-Kennungen der Artikel-Zuordnung (08.10.2026).
 *
 * Anlass: Ab 01.10. brach onPurchasedProductMatch täglich bis zu 550-mal bei
 * 120 s ab, weil der Gemini-Pick ohne eigenes Zeitlimit bis zum 300-s-Limit
 * von Node-fetch wartete. Die Tests sichern drei Dinge:
 *  1. Kein Gemini-Aufruf läuft länger als sein Limit, und die Zeile endet
 *     vor ihrer Frist mit eindeutigem Fehlercode am Dokument.
 *  2. Ein zweiter Versuch nur, wenn er wiederholbar ist und Zeit bleibt.
 *  3. labels nur auf dem Vertex-Pfad (AI Studio lehnt sie ab), nie an
 *     Einbettungen (das SDK gibt sie dort nicht weiter).
 */

const ENV_KEYS = ['GEMINI_USE_VERTEX', 'GEMINI_API_KEY'];
let envVorher;
beforeEach(() => {
  envVorher = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envVorher[k] === undefined) delete process.env[k];
    else process.env[k] = envVorher[k];
  }
  jest.useRealTimers();
});

const ERWARTETE_LABELS = { funktion: 'receipt-matcher', zweck: 'bon-artikel-zuordnung' };

// ─── Test-Aufbau: Firestore, SDK und Logger gemockt ──────────────────
const snapshot = (docs) => ({ docs, empty: !docs.length, forEach: (fn) => docs.forEach(fn) });

function bauFakeDb({ shortlistHaengt = false } = {}) {
  const writes = [];
  const docRef = (path) => ({
    id: path.split('/').pop(),
    path,
    get: async () => ({ exists: false, data: () => undefined }),
    set: async (data) => {
      writes.push({ path, data });
    },
  });
  const kandidat = {
    id: 'p1',
    data: () => ({ name: 'Goldmais 140g', type: 'noname', sourceCollection: 'produkte', preis: 0.99, discounterId: 'd1', _dist: 0.1 }),
  };
  const discounter = [{ id: 'd1', data: () => ({ name: 'Lidl', land: 'DE' }) }];
  const query = (name) => {
    const q = {
      where: () => q,
      limit: () => q,
      findNearest: () => ({
        get: () => (shortlistHaengt ? new Promise(() => {}) : Promise.resolve(snapshot(name === 'productEmbeddings' ? [kandidat] : []))),
      }),
      get: async () => snapshot(name === 'discounter' ? discounter : []),
      doc: (id) => docRef(`${name}/${id}`),
    };
    return q;
  };
  return { db: { collection: (name) => query(name), getAll: async () => [] }, writes };
}

/**
 * Lädt matcher + gemini in einem eigenen Modul-Register mit Mocks.
 * `generateContent(params)` / `embedContent(params)` bestimmen das SDK-Verhalten.
 */
function ladeMatcher({ generateContent, embedContent, shortlistHaengt } = {}) {
  const calls = { generate: [], embed: [], ctor: [] };
  const logs = [];
  const fake = bauFakeDb({ shortlistHaengt });
  let matcher;
  let gemini;
  jest.isolateModules(() => {
    jest.doMock('firebase-admin', () => ({ firestore: () => fake.db }));
    jest.doMock('firebase-admin/firestore', () => ({
      FieldValue: { vector: (v) => v, increment: (n) => ({ increment: n }), serverTimestamp: () => 'SERVER_TS', delete: () => 'DELETE' },
    }));
    jest.doMock('firebase-functions/logger', () => ({
      info: (msg, data) => logs.push({ msg, data }),
      warn: () => {},
      error: () => {},
    }));
    jest.doMock('@google/genai', () => ({
      GoogleGenAI: class {
        constructor(opts) {
          calls.ctor.push(opts);
          this.models = {
            generateContent: async (params) => {
              calls.generate.push(params);
              return generateContent
                ? generateContent(params, calls.generate.length)
                : { text: '{"lineType":"product","candidateIdx":0,"confidence":0.95}' };
            },
            embedContent: async (params) => {
              calls.embed.push(params);
              return embedContent ? embedContent(params) : { embeddings: [{ values: [0.1, 0.2, 0.3] }] };
            },
          };
        }
      },
    }));
    matcher = require('../matcher');
    gemini = require('../gemini');
  });
  return { matcher, gemini, calls, logs, writes: fake.writes };
}

const haengtBisAbbruch = (params) =>
  new Promise((_, reject) => {
    params.config.abortSignal.addEventListener('abort', () => {
      const e = new Error('This operation was aborted');
      e.name = 'AbortError';
      reject(e);
    });
  });

const KANDIDATEN = [{ id: 'p1', name: 'Goldmais 140g', type: 'noname', tier: 1, source: 'produkte' }];

// ─── 1. Kosten-Kennungen ─────────────────────────────────────────────
describe('Kosten-Kennungen am Pick', () => {
  it('Vertex: der Pick trägt labels { funktion, zweck } und ein Zeitlimit', async () => {
    delete process.env.GEMINI_USE_VERTEX;
    const { matcher, calls } = ladeMatcher();
    await matcher.geminiPick('G&G Goldmais', 'lidl', 99, KANDIDATEN, '140g', { timeoutMs: 25_000 });
    expect(calls.ctor[0]).toMatchObject({ vertexai: true });
    const cfg = calls.generate[0].config;
    expect(cfg.labels).toEqual(ERWARTETE_LABELS);
    expect(cfg.abortSignal).toBeInstanceOf(AbortSignal);
    // SDK-Zeitgeber eine Sekunde später als unserer → unser Fehlercode gewinnt.
    expect(cfg.httpOptions).toEqual({ timeout: 26_000 });
    // Bestehende Einstellungen unverändert
    expect(cfg.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
    expect(cfg.maxOutputTokens).toBe(2048);
    expect(cfg.temperature).toBe(0.1);
  });

  it('AI Studio (GEMINI_USE_VERTEX=false): keine labels, Zeitlimit bleibt', async () => {
    process.env.GEMINI_USE_VERTEX = 'false';
    process.env.GEMINI_API_KEY = 'test-key';
    const { matcher, calls } = ladeMatcher();
    await matcher.geminiPick('G&G Goldmais', 'lidl', 99, KANDIDATEN, null, { timeoutMs: 25_000 });
    expect(calls.ctor[0]).toEqual({ apiKey: 'test-key' });
    const cfg = calls.generate[0].config;
    expect(cfg).not.toHaveProperty('labels');
    expect(cfg.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('Einbettung: Zeitlimit ja, labels nein (das SDK gibt sie dort nicht weiter)', async () => {
    delete process.env.GEMINI_USE_VERTEX;
    const { matcher, calls } = ladeMatcher();
    const v = await matcher.embedQuery('Goldmais');
    expect(v).toEqual([0.1, 0.2, 0.3]);
    const cfg = calls.embed[0].config;
    expect(cfg).not.toHaveProperty('labels');
    expect(cfg.outputDimensionality).toBe(768);
    expect(cfg.abortSignal).toBeInstanceOf(AbortSignal);
    expect(cfg.httpOptions).toEqual({ timeout: 11_000 });
  });

  it('alle Kennungen erfüllen die Vertex-Regeln', () => {
    const { gemini } = ladeMatcher();
    expect(gemini.FUNKTION).toBe('receipt-matcher');
    for (const labels of Object.values(gemini.KOSTEN_LABELS)) {
      for (const [k, v] of Object.entries(labels)) {
        expect(k).toMatch(/^[a-z][a-z0-9_-]{0,62}$/);
        expect(v).toMatch(/^[a-z][a-z0-9_-]{0,62}$/);
      }
    }
    expect(gemini.KOSTEN_LABELS[gemini.ZWECK.ZUORDNUNG]).toEqual(ERWARTETE_LABELS);
  });
});

// Gegen das ECHTE SDK (1.52.0), nur fetch gemockt: begründet, warum labels
// nur auf dem Vertex-Pfad gehen dürfen, und dass Kennung + Server-Zeitlimit
// tatsächlich im Request landen.
describe('SDK-Vertrag (echtes @google/genai, fetch gemockt)', () => {
  const { GoogleGenAI } = require('@google/genai');
  const okResponse = () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  let fetchVorher;
  beforeEach(() => {
    fetchVorher = global.fetch;
  });
  afterEach(() => {
    global.fetch = fetchVorher;
  });

  it('Vertex: labels im Body, X-Server-Timeout im Kopf', async () => {
    const gesendet = [];
    global.fetch = async (url, init) => {
      gesendet.push({ url, init });
      return okResponse();
    };
    const sdk = new GoogleGenAI({ vertexai: true, apiKey: 'test-key' });
    const signal = new AbortController().signal;
    await sdk.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: 'x',
      config: { temperature: 0.1, labels: ERWARTETE_LABELS, abortSignal: signal, httpOptions: { timeout: 26_000 } },
    });
    expect(gesendet).toHaveLength(1);
    const body = JSON.parse(gesendet[0].init.body);
    expect(body.labels).toEqual(ERWARTETE_LABELS);
    expect(body).not.toHaveProperty('abortSignal');
    expect(body).not.toHaveProperty('httpOptions');
    expect(gesendet[0].init.headers.get('X-Server-Timeout')).toBe('26');
    expect(gesendet[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('AI Studio: das SDK lehnt labels ab — deshalb gehen sie dort nie mit', async () => {
    let aufrufe = 0;
    global.fetch = async () => {
      aufrufe++;
      return okResponse();
    };
    const sdk = new GoogleGenAI({ apiKey: 'test-key' });
    await expect(
      sdk.models.generateContent({ model: 'gemini-3.5-flash', contents: 'x', config: { labels: ERWARTETE_LABELS } }),
    ).rejects.toThrow(/labels parameter is not supported/);
    expect(aufrufe).toBe(0);
  });
});

// ─── 2. Zeitlimit je Aufruf ──────────────────────────────────────────
describe('Zeitlimit je Gemini-Aufruf', () => {
  it('ein hängender Pick wirft nach dem Limit mit code pick_timeout und bricht die Anfrage ab', async () => {
    const unbehandelt = [];
    const merke = (e) => unbehandelt.push(e);
    process.on('unhandledRejection', merke);
    try {
      const { matcher, calls } = ladeMatcher({ generateContent: haengtBisAbbruch });
      const t = Date.now();
      await expect(matcher.geminiPick('x', 'lidl', 99, KANDIDATEN, null, { timeoutMs: 40 })).rejects.toMatchObject({ code: 'pick_timeout' });
      expect(Date.now() - t).toBeLessThan(1000);
      expect(calls.generate[0].config.abortSignal.aborted).toBe(true);
      expect(matcher.pickFehlerArt({ code: 'pick_timeout' })).toBe('pick-timeout');
      // Die verspätete Ablehnung der abgebrochenen Anfrage darf nicht unbehandelt bleiben.
      await new Promise((r) => setTimeout(r, 30));
      expect(unbehandelt).toEqual([]);
    } finally {
      process.off('unhandledRejection', merke);
    }
  });

  it('leere Antwort → code pick_json (wiederholbar), kein TypeError', async () => {
    const { matcher } = ladeMatcher({ generateContent: async () => ({ text: '', candidates: [{ finishReason: 'MAX_TOKENS' }] }) });
    const err = await matcher.geminiPick('x', 'lidl', 99, KANDIDATEN, null, { timeoutMs: 1000 }).catch((e) => e);
    expect(err.code).toBe('pick_json');
    expect(err.message).toMatch(/MAX_TOKENS/);
    expect(matcher.pickWiederholbar(err)).toBe(true);
  });

  it('eine hängende Einbettung wird ebenfalls begrenzt und endet als null', async () => {
    jest.useFakeTimers();
    const { matcher, calls } = ladeMatcher({ embedContent: haengtBisAbbruch });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const p = matcher.embedQuery('x');
    // 3 Versuche (10 s, 20 s, 20 s) + Pausen 1,2 s und 2,4 s = 53,6 s
    await jest.advanceTimersByTimeAsync(60_000);
    await expect(p).resolves.toBeNull();
    expect(calls.embed).toHaveLength(3);
    expect(calls.embed.map((c) => c.config.httpOptions.timeout)).toEqual([11_000, 21_000, 21_000]);
    expect(calls.embed.every((c) => c.config.abortSignal.aborted)).toBe(true);
    warn.mockRestore();
  });

  it('Einbettung: nach einem Zeitlimit rettet der längere zweite Versuch (Anlauf ~11 s)', async () => {
    jest.useFakeTimers();
    // Jeder Versuch braucht 11 s (wie vom Mac gemessen: erster Request je neuer Verbindung).
    const elfSekunden = (params) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ embeddings: [{ values: [1, 2, 3] }] }), 11_000);
        params.config.abortSignal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    const { matcher, calls } = ladeMatcher({ embedContent: elfSekunden });
    const p = matcher.embedQuery('x');
    await jest.advanceTimersByTimeAsync(30_000);
    await expect(p).resolves.toEqual([1, 2, 3]);
    expect(calls.embed).toHaveLength(2);
  });

  it('Einbettung hält die Frist der Zeile ein', async () => {
    jest.useFakeTimers();
    const { matcher, calls } = ladeMatcher({ embedContent: haengtBisAbbruch });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const start = Date.now();
    const p = matcher.embedQuery('x', { deadlineAt: start + 12_000 });
    await jest.advanceTimersByTimeAsync(20_000);
    await expect(p).resolves.toBeNull();
    // Versuch 1: 10 s; danach reicht der Rest (2 s − 1,2 s Pause) nicht → Schluss.
    expect(calls.embed).toHaveLength(1);
    warn.mockRestore();
  });
});

// ─── 3. Budget-Regeln des Picks (pure, mit injizierter Uhr) ──────────
describe('pickMitBudget', () => {
  const { pickMitBudget, PICK_TIMEOUT_MS, PICK_RETRY_MIN_MS } = ladeMatcher().matcher;
  const uhr = () => {
    const u = { jetzt: 0 };
    u.fn = () => u.jetzt;
    return u;
  };
  const fehler = (over) => Object.assign(new Error(over.message || 'x'), over);

  it('Zeitlimit beim ersten Versuch, genug Rest → zweiter Versuch; beide hängen → pick-timeout nach 2 × 25 s', async () => {
    const u = uhr();
    const versuch = jest.fn(async (ms) => {
      u.jetzt += ms;
      throw fehler({ code: 'pick_timeout' });
    });
    const r = await pickMitBudget(versuch, 100_000, { jetzt: u.fn, pause: async () => {} });
    expect(versuch.mock.calls.map((c) => c[0])).toEqual([PICK_TIMEOUT_MS, PICK_TIMEOUT_MS]);
    expect(r).toMatchObject({ pick: null, versuche: 2, ms: 50_000 });
    expect(r.fehler.code).toBe('pick_timeout');
  });

  it('zweiter Versuch rettet die Zeile', async () => {
    const u = uhr();
    const versuch = jest.fn(async (ms) => {
      if (versuch.mock.calls.length === 1) {
        u.jetzt += ms;
        throw fehler({ code: 'pick_timeout' });
      }
      u.jetzt += 3_000;
      return { lineType: 'product', candidateIdx: 0, confidence: 0.95 };
    });
    const r = await pickMitBudget(versuch, 100_000, { jetzt: u.fn, pause: async () => {} });
    expect(r).toMatchObject({ versuche: 2, fehler: null, ms: 28_000 });
    expect(r.pick.confidence).toBe(0.95);
  });

  it(`kein zweiter Versuch, wenn danach weniger als ${PICK_RETRY_MIN_MS / 1000} s bleiben`, async () => {
    const u = uhr();
    const versuch = jest.fn(async (ms) => {
      u.jetzt += ms;
      throw fehler({ code: 'pick_timeout' });
    });
    const r = await pickMitBudget(versuch, 50_000, { jetzt: u.fn, pause: async () => {} });
    expect(versuch).toHaveBeenCalledTimes(1);
    expect(r.versuche).toBe(1);
  });

  it('das Limit des Versuchs wird auf die Frist gekürzt', async () => {
    const u = uhr();
    const versuch = jest.fn(async (ms) => {
      u.jetzt += ms;
      throw fehler({ code: 'pick_timeout' });
    });
    await pickMitBudget(versuch, 12_000, { jetzt: u.fn, pause: async () => {} });
    expect(versuch.mock.calls[0][0]).toBe(12_000);
  });

  it('reicht die Restzeit nicht für einen Versuch, wird gar nicht erst gefragt', async () => {
    const versuch = jest.fn();
    const r = await pickMitBudget(versuch, 4_000, { jetzt: () => 0, pause: async () => {} });
    expect(versuch).not.toHaveBeenCalled();
    expect(r).toMatchObject({ pick: null, versuche: 0, fehler: null });
  });

  it('400 wird nicht wiederholt', async () => {
    const versuch = jest.fn(async () => {
      throw fehler({ status: 400, message: '{"error":{"code":400}}' });
    });
    const r = await pickMitBudget(versuch, 100_000, { jetzt: () => 0, pause: async () => {} });
    expect(versuch).toHaveBeenCalledTimes(1);
    expect(r.versuche).toBe(1);
  });

  it('429: kurze Pause (1–2 s), dann zweiter Versuch', async () => {
    const pausen = [];
    const versuch = jest.fn(async () => {
      if (versuch.mock.calls.length === 1) throw fehler({ status: 429, message: 'RESOURCE_EXHAUSTED' });
      return { lineType: 'product', candidateIdx: 0, confidence: 0.8 };
    });
    const r = await pickMitBudget(versuch, 100_000, { jetzt: () => 0, pause: async (ms) => pausen.push(ms) });
    expect(r.versuche).toBe(2);
    expect(pausen).toHaveLength(1);
    expect(pausen[0]).toBeGreaterThanOrEqual(1000);
    expect(pausen[0]).toBeLessThan(2000);
  });
});

describe('Fehler-Einordnung', () => {
  const { pickFehlerArt, pickWiederholbar } = ladeMatcher().matcher;
  const fehler = (over) => Object.assign(new Error(over.message || 'x'), over);

  it.each([
    [{ code: 'pick_timeout' }, 'pick-timeout', true],
    [{ name: 'AbortError' }, 'pick-timeout', true],
    [{ status: 429 }, 'pick-429', true],
    [{ message: '{"error":{"status":"RESOURCE_EXHAUSTED"}}' }, 'pick-429', true],
    [{ status: 503 }, 'pick-failed', true],
    [{ status: 504, message: '{"error":{"code":504,"status":"DEADLINE_EXCEEDED"}}' }, 'pick-timeout', true],
    [{ message: 'DEADLINE_EXCEEDED' }, 'pick-timeout', true],
    [{ status: 500 }, 'pick-failed', true],
    [{ message: 'fetch failed', cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } }, 'pick-failed', true],
    [{ message: 'read ECONNRESET' }, 'pick-failed', true],
    [{ code: 'pick_json' }, 'pick-failed', true],
    [{ status: 400 }, 'pick-failed', false],
    [{ status: 403 }, 'pick-failed', false],
    [{ message: "Cannot read properties of undefined (reading 'x')" }, 'pick-failed', false],
  ])('%j → %s, wiederholbar=%s', (over, art, wdh) => {
    expect(pickFehlerArt(fehler(over))).toBe(art);
    expect(pickWiederholbar(fehler(over))).toBe(wdh);
  });
});

// ─── 4. Ganze Zeile: endet vor der Frist mit Status am Dokument ──────
describe('matchLine mit Frist', () => {
  const ctx = (writes) => ({
    itemName: 'G&G Goldmais 140g',
    marktSlug: 'lidl',
    priceCents: 99,
    userId: null,
    receiptId: null,
    ppRef: { id: 'pp1', set: async (data) => writes.push({ path: 'pp', data }) },
  });

  it('Pick hängt zweimal → matchError pick-timeout am Dokument, weit vor der Frist', async () => {
    jest.useFakeTimers();
    const { matcher, writes, logs, calls } = ladeMatcher({ generateContent: haengtBisAbbruch });
    const start = Date.now();
    const deadlineAt = start + 100_000;
    let fertigUm = null;
    const p = matcher.matchLine(ctx(writes), { deadlineAt }).then((r) => {
      fertigUm = Date.now();
      return r;
    });
    await jest.advanceTimersByTimeAsync(60_000);
    const r = await p;
    expect(r).toMatchObject({ status: 'error', reason: 'pick-timeout' });
    expect(fertigUm - start).toBeLessThanOrEqual(deadlineAt - start);
    expect(calls.generate).toHaveLength(2);
    const pp = writes.filter((w) => w.path === 'pp').map((w) => w.data);
    expect(pp).toHaveLength(1);
    expect(pp[0]).toMatchObject({
      matchStatus: 'error',
      matchError: 'pick-timeout',
      pickAttempts: 2,
      matchVersion: matcher.MATCH_VERSION,
    });
    expect(pp[0].matchErrorDetail).toMatch(/pick_timeout/);
    expect(pp[0].pickMs).toBe(50_000);
    const log = logs.find((l) => l.msg === 'zuordnung-ki');
    expect(log.data).toMatchObject({ status: 'error', reason: 'pick-timeout', pickAttempts: 2 });
    expect(log.data.stufenMs).toHaveProperty('pick', 50_000);
    expect(log.data.stufenMs).toHaveProperty('embed');
  });

  it('erster Pick hängt, zweiter trifft → normale Zuordnung (Verhalten danach unverändert)', async () => {
    jest.useFakeTimers();
    const { matcher, writes } = ladeMatcher({
      generateContent: (params, n) => (n === 1 ? haengtBisAbbruch(params) : { text: '{"lineType":"product","candidateIdx":0,"confidence":0.95}' }),
    });
    const p = matcher.matchLine(ctx(writes), { deadlineAt: Date.now() + 100_000 });
    await jest.advanceTimersByTimeAsync(30_000);
    const r = await p;
    expect(r).toMatchObject({ status: 'matched', productId: 'p1' });
    const pp = writes.filter((w) => w.path === 'pp').map((w) => w.data);
    expect(pp[0]).toMatchObject({ matchStatus: 'matched', productId: 'p1', matchSource: 'ai' });
    // Ein fertiger Status räumt Fehlerspuren eines früheren Laufs (Nachlauf, nachlauf.js).
    expect(pp[0].matchError).toBe('DELETE');
    const alias = writes.find((w) => w.path.startsWith('receiptAliases/'));
    expect(alias.data).toMatchObject({ productId: 'p1', resolvedBy: 'ai-auto' });
  });

  it('Einbettung hängt → embed-failed, weit vor der Frist, kein Pick', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { matcher, writes, calls } = ladeMatcher({ embedContent: haengtBisAbbruch });
    const start = Date.now();
    let fertigUm = null;
    const p = matcher.matchLine(ctx(writes), { deadlineAt: start + 100_000 }).then((r) => {
      fertigUm = Date.now();
      return r;
    });
    await jest.advanceTimersByTimeAsync(100_000);
    await expect(p).resolves.toMatchObject({ status: 'error', reason: 'embed-failed' });
    expect(fertigUm - start).toBeLessThan(60_000);
    expect(calls.generate).toHaveLength(0);
    expect(writes.find((w) => w.path === 'pp').data).toMatchObject({ matchStatus: 'error', matchError: 'embed-failed' });
    warn.mockRestore();
  });

  it('Vektorsuche hängt → shortlist-timeout nach 15 s statt Plattform-Abbruch', async () => {
    jest.useFakeTimers();
    const { matcher, writes, calls } = ladeMatcher({ shortlistHaengt: true });
    const start = Date.now();
    let fertigUm = null;
    const p = matcher.matchLine(ctx(writes), { deadlineAt: start + 100_000 }).then((r) => {
      fertigUm = Date.now();
      return r;
    });
    await jest.advanceTimersByTimeAsync(20_000);
    await expect(p).resolves.toMatchObject({ status: 'error', reason: 'shortlist-timeout' });
    expect(fertigUm - start).toBe(15_000);
    expect(calls.generate).toHaveLength(0);
    expect(writes.find((w) => w.path === 'pp').data).toMatchObject({ matchStatus: 'error', matchError: 'shortlist-timeout' });
  });

  it('Frist schon fast verbraucht → kein Pick, pick-timeout mit pickAttempts 0', async () => {
    jest.useFakeTimers();
    const { matcher, writes, calls } = ladeMatcher();
    const r = await matcher.matchLine(ctx(writes), { deadlineAt: Date.now() + 3_000 });
    expect(r).toMatchObject({ status: 'error', reason: 'pick-timeout' });
    expect(calls.generate).toHaveLength(0);
    expect(writes.find((w) => w.path === 'pp').data).toMatchObject({ matchError: 'pick-timeout', pickAttempts: 0 });
  });

  it('ohne übergebene Frist gilt je Zeile das Standardbudget (Hand-Endpunkte)', async () => {
    jest.useFakeTimers();
    const { matcher, writes } = ladeMatcher({ generateContent: haengtBisAbbruch });
    const start = Date.now();
    let fertigUm = null;
    const p = matcher.matchLine(ctx(writes)).then((r) => {
      fertigUm = Date.now();
      return r;
    });
    await jest.advanceTimersByTimeAsync(120_000);
    await expect(p).resolves.toMatchObject({ status: 'error', reason: 'pick-timeout' });
    expect(fertigUm - start).toBeLessThanOrEqual(100_000);
  });
});

// ─── 5. Trigger: Frist hängt am Function-Timeout ─────────────────────
describe('onPurchasedProductMatch übergibt die Frist', () => {
  function ladeIndex() {
    const matchLine = jest.fn(async () => ({ status: 'matched' }));
    let index;
    jest.isolateModules(() => {
      jest.doMock('firebase-admin', () => ({ apps: [], initializeApp: () => {}, firestore: () => ({}) }));
      jest.doMock('firebase-functions/v2/firestore', () => ({
        onDocumentWritten: (opts, handler) => ({ opts, handler }),
        onDocumentCreated: (opts, handler) => ({ opts, handler }),
      }));
      jest.doMock('firebase-functions/v2/https', () => ({
        onRequest: (opts, handler) => ({ opts, handler }),
        onCall: (opts, handler) => ({ opts, handler }),
        HttpsError: class extends Error {},
      }));
      jest.doMock('firebase-functions/v2/scheduler', () => ({ onSchedule: (opts, handler) => ({ opts, handler }) }));
      jest.doMock('firebase-functions/params', () => ({ defineSecret: () => ({ value: () => 'x' }) }));
      jest.doMock('../admin', () => ({}));
      jest.doMock('../gemini', () => ({ ai: () => ({}) }));
      jest.doMock('../matcher', () => ({ matchLine, MATCH_VERSION: 1, SCHREIB_RESERVE_MS: 20_000, parseSize: () => null }));
      index = require('../index');
    });
    return { index, matchLine };
  }
  const event = (data) => ({ data: { data: () => data, ref: { set: async () => {} } }, params: { uid: 'u1', ppId: 'pp1' } });

  it('Frist = Start + Function-Timeout − Schreibreserve, auch mit noClose', async () => {
    const { index, matchLine } = ladeIndex();
    const fn = index.onPurchasedProductMatch;
    expect(fn.opts.timeoutSeconds).toBe(120);
    const vorher = Date.now();
    await fn.handler(event({ itemName: 'X', merchantId: 'lidl' }));
    await fn.handler(event({ itemName: 'Y', merchantId: 'lidl', backfilled: true }));
    const nachher = Date.now();
    const [frisch, nachgezogen] = matchLine.mock.calls.map((c) => c[1]);
    for (const o of [frisch, nachgezogen]) {
      expect(o.deadlineAt).toBeGreaterThanOrEqual(vorher + 100_000);
      expect(o.deadlineAt).toBeLessThanOrEqual(nachher + 100_000);
    }
    expect(frisch).not.toHaveProperty('noClose');
    expect(nachgezogen.noClose).toBe(true);
  });

  it('bereits gematchte und nicht vergütete Zeilen bleiben unberührt', async () => {
    const { index, matchLine } = ladeIndex();
    await index.onPurchasedProductMatch.handler(event({ itemName: 'X', matchVersion: 1 }));
    await index.onPurchasedProductMatch.handler(event({ itemName: 'X', rewardEligible: false }));
    expect(matchLine).not.toHaveBeenCalled();
  });
});
