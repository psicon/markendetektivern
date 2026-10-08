'use strict';

/**
 * Prompt-Schalter `cashback_config/v1.ocrPrompt` (05.10.2026): v1.4 bleibt
 * byte-gleich der Live-Prompt, v1.5 nur nach ausdrücklichem Umschalten, und
 * eine Leiter liest nie mit zwei Versionen.
 *
 * Die SHA-256-Werte stammen aus dem AUSGEROLLTEN Stand von processCashback
 * (Quelle gs://gcf-v2-sources-139509881339-europe-west3/processCashback/
 * function-source.zip, Deploy 03.10.2026 18:37 UTC, lib/prompt.js und
 * lib/prompt_referee.js identisch mit Commit 7220a7c5). Neu erzeugen:
 *   node -e "const c=require('crypto');const p=require('./lib/prompt');
 *     console.log(c.createHash('sha256').update(p.SYSTEM_PROMPT).digest('hex'))"
 * — aber NUR gegen den Live-Stand, nie gegen den Arbeitsstand.
 */

const crypto = require('crypto');
const PROMPT = require('../lib/prompt');
const REFEREE = require('../lib/prompt_referee');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const LIVE_V14 = {
  system: '228dd8e4a8857cfa88c1f17c0f5442b9809eb592ad17eada04c1faa3ed1cc2ff',
  user: '8b891c4497671f17f0e9884a352a4a9bf4a4c9a1dd7a262bc363a2b7c3fb9542',
  schema: 'e1bfbd014b5663fb6c68f695575a02a9d6dad4e3fa247c74b0bf0270b4669acd',
};
const LIVE_REFEREE_V14 = {
  system: 'd49bbe26e1ec552f6ae51e828e4b94c16e899296ec2de3fca16150b2bba3be46',
  user: 'fe1cbf6f7583edd0854ce2b31035da86e6869e08024a5e4e534c52266f29bd03',
  schema: 'cdbb6f95ad40c3ad41ff0a39d4f32c6ce70167dd8572e6ac2b3737a437e021eb',
};

describe('v1.4 ist byte-gleich der Live-Prompt', () => {
  test('Haupt-Prompt: System, Nutzer-Text und Schema', () => {
    const p = PROMPT.promptFuer('v1.4');
    expect(p.VERSION).toBe('v1.4');
    expect(sha(p.SYSTEM_PROMPT)).toBe(LIVE_V14.system);
    expect(sha(p.USER_PROMPT)).toBe(LIVE_V14.user);
    expect(sha(JSON.stringify(p.RESPONSE_SCHEMA))).toBe(LIVE_V14.schema);
  });

  test('die bisherigen Einzel-Exporte sind v1.4 (cv-hybrid, Skripte, extractReceipt ohne Optionen)', () => {
    expect(PROMPT.VERSION).toBe('v1.4');
    expect(sha(PROMPT.SYSTEM_PROMPT)).toBe(LIVE_V14.system);
    expect(sha(PROMPT.USER_PROMPT)).toBe(LIVE_V14.user);
    expect(sha(JSON.stringify(PROMPT.RESPONSE_SCHEMA))).toBe(LIVE_V14.schema);
    // cv-hybrid teilt das Schema mit dem Haupt-Prompt.
    expect(sha(JSON.stringify(require('../lib/prompt_text').RESPONSE_SCHEMA))).toBe(LIVE_V14.schema);
  });

  test('Zweitprüfung zur v1.4-Erstlesung: referee-v2+v1.4 wie live', () => {
    for (const r of [REFEREE, REFEREE.refereePromptFuer('v1.4'), REFEREE.refereePromptFuer(undefined)]) {
      expect(r.VERSION).toBe('referee-v2+v1.4');
      expect(sha(r.SYSTEM_PROMPT)).toBe(LIVE_REFEREE_V14.system);
      expect(sha(r.USER_PROMPT)).toBe(LIVE_REFEREE_V14.user);
      expect(sha(JSON.stringify(r.RESPONSE_SCHEMA))).toBe(LIVE_REFEREE_V14.schema);
    }
  });

  test('v1.4 kennt weder Belegart noch Rabattzeilen', () => {
    const p = PROMPT.promptFuer('v1.4');
    expect(p.SYSTEM_PROMPT).not.toMatch(/belegart|Warenkorbrabatt|Regel 16/);
    expect(p.RESPONSE_SCHEMA.properties.belegart).toBeUndefined();
  });
});

describe('Schalterwert → Version', () => {
  test.each([
    [undefined, 'v1.4'], [null, 'v1.4'], ['', 'v1.4'], ['v1.4', 'v1.4'], ['v1.5', 'v1.5'],
    ['V1.5', 'v1.4'], [' v1.5', 'v1.4'], ['v1.6', 'v1.6'], ['V1.6', 'v1.4'], ['v1.7', 'v1.4'], ['1.5', 'v1.4'], [true, 'v1.4'], [1.5, 'v1.4'],
    ['toString', 'v1.4'], ['__proto__', 'v1.4'],
  ])('%p → %s', (wert, version) => {
    expect(PROMPT.promptVersionAus(wert)).toBe(version);
    expect(PROMPT.promptFuer(wert).VERSION).toBe(version);
  });

  test('promptOptionen: Prompt, Schema und Etikett gehören zusammen', () => {
    for (const v of PROMPT.VERSIONEN) {
      const o = PROMPT.promptOptionen(v);
      const p = PROMPT.promptFuer(v);
      expect(o).toEqual({ systemInstruction: p.SYSTEM_PROMPT, userPrompt: p.USER_PROMPT, responseSchema: p.RESPONSE_SCHEMA, promptVersion: v });
    }
  });

  test('Zweitprüfung folgt der Erstlesung, Unbekanntes → v1.4', () => {
    expect(REFEREE.refereePromptFuer('v1.5').VERSION).toBe('referee-v2+v1.5');
    for (const v of ['v1.3', 'docai-expense-v1.0', 'cvhybrid-v1.1', 'referee-v2+v1.5', null, 'test']) {
      expect(REFEREE.refereePromptFuer(v).VERSION).toBe('referee-v2+v1.4');
    }
  });
});

describe('v1.5: Coupon-Regel', () => {
  const V15 = PROMPT.promptFuer('v1.5');
  test('Regel 16: Rabattzeile als negatives Item mit Kategorie Warenkorbrabatt, Artikel wie gedruckt', () => {
    expect(V15.SYSTEM_PROMPT).toMatch(/16\. Rabatt-, Coupon- und Gutscheinzeilen/);
    expect(V15.SYSTEM_PROMPT).toMatch(/category='Warenkorbrabatt'/);
    expect(V15.SYSTEM_PROMPT).toMatch(/priceCents NEGATIV/);
    expect(V15.SYSTEM_PROMPT).toMatch(/Preis WIE GEDRUCKT/);
    // Regel 6 und Selbstkontrolle E verweisen darauf.
    expect(V15.SYSTEM_PROMPT).toMatch(/einzige Ausnahme sind Rabatte und\s+Coupons auf den GANZEN Einkauf \(Regel 16\)/);
    expect(V15.SYSTEM_PROMPT).toMatch(/inkl\. Pfand und der\s+negativen Rabattzeilen nach Regel 16/);
  });

  test('Zweitprüfung v1.5 führt Rabatte weiter in basketDiscounts (Regel 16 gilt dort nicht)', () => {
    const r = REFEREE.refereePromptFuer('v1.5');
    expect(r.SYSTEM_PROMPT).toMatch(/Regel 16 gilt in der Zweitprüfung NICHT/);
    expect(r.SYSTEM_PROMPT.match(/\*\*bonComplete\*\*/g)).toHaveLength(1);
    expect(r.RESPONSE_SCHEMA.properties.basketDiscounts).toBeDefined();
  });
});

// ─── Robust-Leiter: jede Lesung mit DERSELBEN Version ─────────────────────

describe('Robust-Leiter', () => {
  let robust;
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    robust = require('../lib/ocr_robust');
  });
  afterEach(() => console.warn.mockRestore());

  const lesung = (items, total, promptVersion) => ({
    parsed: { isReceipt: true, merchant: 'REWE', bonDate: '2026-09-28', bonTime: '10:00', totalCents: total, items },
    promptVersion,
    latencyMs: 1,
  });
  // Antwortet wie extractReceipt: das Etikett kommt aus den Aufruf-Optionen.
  function fakeExtract(listen) {
    const aufrufe = [];
    const fn = async (bytes, mime, opts) => {
      aufrufe.push(opts);
      const a = listen[aufrufe.length - 1];
      if (!a) throw new Error('keine Antwort mehr vorgesehen');
      return { ...lesung(a.items, a.total, opts.promptVersion), model: opts.model };
    };
    fn.aufrufe = aufrufe;
    return fn;
  }
  const enhance = async () => Buffer.from('verbessert');
  const X = (n) => ({ items: [{ name: `Artikel${n}`, priceCents: 100 }], total: 100 });

  test.each([[undefined, 'v1.4'], ['v1.4', 'v1.4'], ['v1.5', 'v1.5'], ['quatsch', 'v1.4']])(
    'promptVersion %p → alle Basis-, Bild- und Eskalations-Lesungen mit %s',
    async (wert, version) => {
      // Sieben uneinige Lesungen: 3 Basis, 2 verbessert, 2 Eskalation.
      const extract = fakeExtract([X(1), X(2), X(3), X(4), X(5), X(6), X(7)]);
      const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance, promptVersion: wert });
      expect(extract.aufrufe).toHaveLength(7);
      const p = PROMPT.promptFuer(version);
      for (const o of extract.aufrufe) {
        expect(o).toMatchObject({ promptVersion: version, systemInstruction: p.SYSTEM_PROMPT, userPrompt: p.USER_PROMPT, responseSchema: p.RESPONSE_SCHEMA });
      }
      expect(out.promptVersion).toBe(version);
    },
  );

  async function zwischenstand(version) {
    // Ein Fenster (15 ms Budget, 10 ms Lesung): zwei uneinige Lesungen, dann Zwischenstand.
    let t = 0;
    let n = 0;
    const extract = async (bytes, mime, opts) => {
      t += 10;
      n += 1;
      return { ...lesung(X(n).items, 100, opts.promptVersion), model: opts.model };
    };
    const err = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', {
      extract, enhance, promptVersion: version, laufStart: 0, zeit: { budgetMs: 15, leseLimitMs: 10, reserveMs: 5 }, clock: () => t,
    }).then(() => null, (e) => e);
    expect(err).toMatchObject({ code: 'ocr_zeitbudget' });
    return JSON.parse(JSON.stringify(err.zwischenstand));
  }

  test('Zwischenstand trägt die Version der Leiter', async () => {
    expect((await zwischenstand('v1.5')).promptVersion).toBe('v1.5');
    expect((await zwischenstand(undefined)).promptVersion).toBe('v1.4');
  });

  test.each([['v1.4', 'v1.5'], ['v1.5', 'v1.4'], ['v1.5', undefined]])(
    'Zwischenstand %s, Schalter jetzt %p → verworfen, frisch gelesen (keine gemischten Lesungen)',
    async (vorher, jetzt) => {
      const stand = await zwischenstand(vorher);
      const extract = fakeExtract([X(1), X(1)]);
      const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance, promptVersion: jetzt, zwischenstand: stand, clock: () => stand.gespeichertMs + 1 });
      expect(console.warn).toHaveBeenCalledWith('ocr-zwischenstand-verworfen', { grund: 'prompt' });
      expect(out.robust.attempts).toBe(2); // nur die zwei frischen Lesungen
      expect(out.promptVersion).toBe(PROMPT.promptVersionAus(jetzt));
    },
  );

  test('Zwischenstand derselben Version wird fortgesetzt', async () => {
    const stand = await zwischenstand('v1.5');
    const extract = fakeExtract([X(1)]);
    const out = await robust.extractReceiptRobust(Buffer.from('x'), 'image/jpeg', { extract, enhance, promptVersion: 'v1.5', zwischenstand: stand, clock: () => stand.gespeichertMs + 1 });
    expect(console.warn).not.toHaveBeenCalledWith('ocr-zwischenstand-verworfen', expect.anything());
    expect(extract.aufrufe).toHaveLength(1);
    expect(out.robust).toMatchObject({ attempts: 3, method: 'flash-agreement', laeufe: 2 });
    expect(out.promptVersion).toBe('v1.5');
  });

  test('zwischenstandLaden ohne Versionsangabe prüft gegen v1.4', async () => {
    const stand = await zwischenstand('v1.5');
    const g = robust.zwischenstandLaden(stand, { model: stand.model, eskModel: stand.eskModel, maxFlash: stand.maxFlash, jetzt: stand.gespeichertMs });
    expect(g).toEqual({ stand: null, grund: 'prompt' });
  });
});

// ─── Zweitprüfung: Prompt zur Version der Erstlesung ──────────────────────

describe('runReferee', () => {
  const { runReferee } = require('../lib/ocr_referee');
  const fp = { isReceipt: true, totalCents: 400, eligibleItems: 4, bonDate: '2026-09-10' };
  const leseLesung = (opts) => ({
    parsed: { isReceipt: true, merchant: 'Netto', bonDate: '2026-09-10', totalCents: 400, bonComplete: true, items: ['A', 'B', 'C', 'D'].map((n) => ({ name: n, priceCents: 100 })) },
    model: opts.model, promptVersion: opts.promptVersion, latencyMs: 1,
  });
  test.each([[undefined, 'v1.4'], ['v1.4', 'v1.4'], ['v1.5', 'v1.5'], ['docai-expense-v1.0', 'v1.4']])(
    'Erstlesung %p → Prompt referee-v2+%s',
    async (erst, basis) => {
      const aufrufe = [];
      const extract = async (b, m, opts) => { aufrufe.push(opts); return leseLesung(opts); };
      const { result } = await runReferee(Buffer.from('x'), 'image/jpeg', {
        reason: 'reconciliation_delta', prior: [fp], merchantKeyFor: async () => 'id:netto', extract, erstlesungVersion: erst,
      });
      const r = REFEREE.refereePromptFuer(basis);
      expect(aufrufe.length).toBeGreaterThan(0);
      for (const o of aufrufe) {
        expect(o).toMatchObject({ promptVersion: `referee-v2+${basis}`, systemInstruction: r.SYSTEM_PROMPT, userPrompt: r.USER_PROMPT, responseSchema: r.RESPONSE_SCHEMA });
      }
      expect(result).toMatchObject({ verdict: 'decided', promptVersion: `referee-v2+${basis}` });
    },
  );
});
