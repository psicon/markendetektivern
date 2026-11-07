'use strict';
const {
  istGemini3,
  istGemini25Pro,
  vertexStandort,
  ausweichStandort,
  eskalationsOptionen,
  ESKALATION_MODELL_STANDARD,
} = require('../lib/geminiModelle');

describe('vertexStandort', () => {
  test('Primärmodell gemini-3.5-flash → global (wie bisher)', () => {
    expect(vertexStandort('gemini-3.5-flash', { env: {} })).toBe('global');
  });

  test('Zweitprüfung gemini-3.1-pro-preview → global (nur dort erreichbar)', () => {
    expect(vertexStandort('gemini-3.1-pro-preview', { env: {} })).toBe('global');
  });

  test('gemini-2.5-pro (Rückweg bis 20.10.) bleibt regional europe-west4', () => {
    expect(vertexStandort('gemini-2.5-pro', { env: {} })).toBe('europe-west4');
    expect(vertexStandort('gemini-2.5-pro', { env: { GEMINI_VERTEX_LOCATION_PRO: 'europe-west1' } })).toBe('europe-west1');
  });

  test('GEMINI_VERTEX_LOCATION gilt für alle anderen Modelle, nicht für 2.5-pro', () => {
    const env = { GEMINI_VERTEX_LOCATION: 'eu' };
    expect(vertexStandort('gemini-3.5-flash', { env })).toBe('eu');
    expect(vertexStandort('gemini-2.5-pro', { env })).toBe('europe-west4');
  });

  test('ausdrücklicher Standort hat Vorrang vor allem anderen', () => {
    const env = { GEMINI_VERTEX_LOCATION: 'global', GEMINI_VERTEX_LOCATION_PRO: 'europe-west4' };
    expect(vertexStandort('gemini-3.5-flash', { standort: 'eu', env })).toBe('eu');
    expect(vertexStandort('gemini-2.5-pro', { standort: 'global', env })).toBe('global');
  });

  test('ohne Modell → globaler Standard (Client-Cache darf nie undefined bekommen)', () => {
    expect(vertexStandort(undefined, { env: {} })).toBe('global');
  });
});

describe('eskalationsOptionen', () => {
  test('Standard: gemini-3.5-flash, Denkstufe HIGH, Multi-Region eu', () => {
    expect(ESKALATION_MODELL_STANDARD).toBe('gemini-3.5-flash');
    expect(eskalationsOptionen({})).toEqual({
      model: 'gemini-3.5-flash',
      thinkingConfig: { thinkingLevel: 'HIGH' },
      ausweichThinkingConfig: { thinkingLevel: 'LOW' },
      standort: 'eu',
      timeoutMs: 150000,
    });
  });

  test('Ausweich-Denkstufe per Env setzbar, ungültig → LOW', () => {
    expect(eskalationsOptionen({ CASHBACK_OCR_PRO_FALLBACK_THINKING_LEVEL: 'minimal' }).ausweichThinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' });
    expect(eskalationsOptionen({ CASHBACK_OCR_PRO_FALLBACK_THINKING_LEVEL: 'niedrig' }).ausweichThinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  test('Zeitlimit je Lesung: per Env setzbar, ungültig/zu klein → Standard', () => {
    expect(eskalationsOptionen({ CASHBACK_OCR_PRO_TIMEOUT_MS: '90000' }).timeoutMs).toBe(90000);
    expect(eskalationsOptionen({ CASHBACK_OCR_PRO_TIMEOUT_MS: '0' }).timeoutMs).toBe(150000);
    expect(eskalationsOptionen({ CASHBACK_OCR_PRO_TIMEOUT_MS: 'abc' }).timeoutMs).toBe(150000);
    expect(eskalationsOptionen({ CASHBACK_OCR_PRO_TIMEOUT_MS: '5000' }).timeoutMs).toBe(150000);
  });

  test('kein Kurzläufer und kein auslaufendes Modell als Standard', () => {
    const { model } = eskalationsOptionen({});
    expect(model).not.toMatch(/gemini-2\.5|gemini-3\.[678]-flash|preview/);
  });

  test('Gemini 3 bekommt nie thinkingBudget (Vertex lehnt es mit 400 ab)', () => {
    const o = eskalationsOptionen({ CASHBACK_OCR_PRO_THINKING_LEVEL: 'medium' });
    expect(o.thinkingConfig).toEqual({ thinkingLevel: 'MEDIUM' });
    expect(o.thinkingConfig.thinkingBudget).toBeUndefined();
  });

  test('ungültige Denkstufe fällt auf HIGH zurück statt einen 400 zu provozieren', () => {
    expect(eskalationsOptionen({ CASHBACK_OCR_PRO_THINKING_LEVEL: 'hoch' }).thinkingConfig).toEqual({ thinkingLevel: 'HIGH' });
  });

  test('Standort per Env übersteuerbar (z. B. Rückweg auf global)', () => {
    expect(eskalationsOptionen({ CASHBACK_OCR_PRO_LOCATION: 'global' }).standort).toBe('global');
  });

  test('Rückweg gemini-2.5-pro per Env: exakt das alte Verhalten (kein Denk-Schalter, Modell-Standort)', () => {
    const o = eskalationsOptionen({ CASHBACK_OCR_PRO_MODEL: 'gemini-2.5-pro' });
    expect(o).toEqual({ model: 'gemini-2.5-pro' });
    expect(vertexStandort(o.model, { standort: o.standort, env: {} })).toBe('europe-west4');
  });

  test('Modell ohne eu-Erreichbarkeit (3.1-pro-preview) wird NICHT nach eu gelegt', () => {
    const o = eskalationsOptionen({ CASHBACK_OCR_PRO_MODEL: 'gemini-3.1-pro-preview' });
    expect(o.standort).toBeUndefined();
    expect(vertexStandort(o.model, { standort: o.standort, env: {} })).toBe('global');
    expect(o.thinkingConfig).toEqual({ thinkingLevel: 'HIGH' });
  });
});

describe('ausweichStandort', () => {
  test('eu für eu-fähige Modelle, sonst kein Vorschlag; Env hat Vorrang', () => {
    expect(ausweichStandort('gemini-3.5-flash')).toBe('eu');
    expect(ausweichStandort('gemini-3.1-pro-preview')).toBeUndefined();
    expect(ausweichStandort('gemini-2.5-pro')).toBeUndefined();
    expect(ausweichStandort('gemini-3.5-flash', 'global')).toBe('global');
  });
});

describe('Modellklassen', () => {
  test('istGemini3 / istGemini25Pro', () => {
    expect(istGemini3('gemini-3.5-flash')).toBe(true);
    expect(istGemini3('gemini-3.1-pro-preview')).toBe(true);
    expect(istGemini3('gemini-2.5-pro')).toBe(false);
    expect(istGemini25Pro('gemini-2.5-pro')).toBe(true);
    expect(istGemini25Pro('gemini-2.5-flash')).toBe(false);
    expect(istGemini25Pro(null)).toBe(false);
  });
});

describe('gemini-3.8-flash als Grundleser (07.11.2026)', () => {
  const { ocrDenkstufeWirksam } = require('../lib/geminiModelle');

  test('3.8-flash liest ohne Env-Standort in eu, 3.5-flash bleibt global', () => {
    expect(vertexStandort('gemini-3.8-flash', { env: {} })).toBe('eu');
    expect(vertexStandort('gemini-3.5-flash', { env: {} })).toBe('global');
  });

  test('Env-Standort und ausdrücklicher Standort haben weiter Vorrang', () => {
    expect(vertexStandort('gemini-3.8-flash', { env: { GEMINI_VERTEX_LOCATION: 'global' } })).toBe('global');
    expect(vertexStandort('gemini-3.8-flash', { standort: 'global', env: {} })).toBe('global');
  });

  test('LOW wirkt mit v1.4 nur bei gemini-3.8-flash', () => {
    expect(ocrDenkstufeWirksam('LOW', 'v1.4', 'gemini-3.8-flash')).toEqual({ denkstufe: 'LOW', grund: null });
    expect(ocrDenkstufeWirksam('LOW', 'v1.4', 'gemini-3.5-flash')).toEqual({ denkstufe: null, grund: 'ohne_v15' });
    expect(ocrDenkstufeWirksam('LOW', 'v1.4')).toEqual({ denkstufe: null, grund: 'ohne_v15' });
  });

  test('ohne Schalter und mit ungültigem Wert ändert sich auch bei 3.8 nichts', () => {
    expect(ocrDenkstufeWirksam(undefined, 'v1.4', 'gemini-3.8-flash')).toEqual({ denkstufe: null, grund: null });
    expect(ocrDenkstufeWirksam('MEDIUM', 'v1.4', 'gemini-3.8-flash')).toEqual({ denkstufe: null, grund: 'ungueltig' });
    expect(ocrDenkstufeWirksam('LOW', 'v1.6', 'gemini-3.8-flash')).toEqual({ denkstufe: 'LOW', grund: null });
  });
});
