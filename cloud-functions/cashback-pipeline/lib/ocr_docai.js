/**
 * Document AI Expense Parser fallback engine.
 *
 * Used as the *escalation path* when the primary CV-Hybrid OCR fails
 * the reconciliation gate (Σ items doesn't match total). DocAI is a
 * specialized model trained on receipts/invoices — slower and more
 * expensive ($0.05/page) but very accurate on hard DACH bons.
 *
 * Auto-disabled if the required env vars aren't set on the Cloud
 * Function — the pipeline keeps working with CV-Hybrid alone.
 *
 * Setup (one-time, in Firebase / GCP Console):
 *   1) Enable Document AI API for the project.
 *   2) Create an Expense Parser processor in europe-west3 (or `eu`).
 *   3) firebase functions:config:set ... OR set env vars on the function:
 *        DOCUMENTAI_PROCESSOR_ID=<processor-id>
 *        DOCUMENTAI_LOCATION=eu               (or europe-west3)
 *        GOOGLE_CLOUD_PROJECT=markendetektive-895f7
 *
 * Returns the same shape as `extractReceiptCVHybrid` so the caller
 * can swap engines without branching.
 */

'use strict';

const { logger } = require('firebase-functions');

const DEFAULT_LOCATION = process.env.DOCUMENTAI_LOCATION || 'eu';
const PROCESSOR_ID = process.env.DOCUMENTAI_PROCESSOR_ID || null;
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || null;
const PROMPT_VERSION = 'docai-expense-v1.0';

// Lazy-loaded so we don't pay the gRPC import cost on cold start when
// DocAI isn't configured at all.
let _ClientCtor = null;
let _client = null;

function isConfigured() {
  return Boolean(PROCESSOR_ID && PROJECT_ID);
}

function getClient() {
  if (_client) return _client;
  if (!_ClientCtor) {
    // Defer-require: only loaded when DocAI is actually invoked.
    _ClientCtor = require('@google-cloud/documentai').v1.DocumentProcessorServiceClient;
  }
  _client = new _ClientCtor({
    apiEndpoint: `${DEFAULT_LOCATION}-documentai.googleapis.com`,
  });
  return _client;
}

function processorName() {
  return `projects/${PROJECT_ID}/locations/${DEFAULT_LOCATION}/processors/${PROCESSOR_ID}`;
}

// ─── Helpers (ports of docai.py utility fns) ────────────────────────

function toCents(value) {
  if (value == null) return null;
  let s = String(value).trim();
  if (!s) return null;
  // Strip currency markers + whitespace
  s = s.replace(/€|EUR|\$|USD|CHF/gi, '').replace(/\s+/g, '');
  // German "1.234,56" → strip dots, swap comma. Pure "1,29" → "1.29".
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  s = s.replace(/−/g, '-'); // unicode minus
  const f = parseFloat(s);
  if (!Number.isFinite(f)) return null;
  return Math.round(f * 100);
}

function toIsoDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  // Already ISO
  if (s.length === 10 && s[4] === '-' && s[7] === '-') return s;
  // German DD.MM.YYYY
  if (s.length === 10 && s[2] === '.' && s[5] === '.') {
    return `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;
  }
  // German DD.MM.YY
  if (s.length === 8 && s[2] === '.' && s[5] === '.') {
    return `20${s.slice(6, 8)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;
  }
  // DD/MM/YYYY (DACH convention)
  if (s.length === 10 && s[2] === '/' && s[5] === '/') {
    return `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;
  }
  // ISO with time appended
  if (s.length >= 10 && s[4] === '-' && s[7] === '-') return s.slice(0, 10);
  return s;
}

function toHhMm(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (s.length >= 5 && s[2] === ':') return s.slice(0, 5);
  return s;
}

function entityText(entity) {
  // Prefer normalized text (DocAI's own normalization), fall back to mention_text
  return entity?.normalizedValue?.text || entity?.mentionText || '';
}

function buildLineItem(entity) {
  let name = null;
  let qty = 1;
  let priceCents = null;
  let unitPriceCents = null;

  for (const prop of entity.properties || []) {
    const ptype = prop.type;
    const ptext = entityText(prop);
    if (ptype === 'line_item/description') {
      name = ptext.trim();
    } else if (ptype === 'line_item/quantity') {
      const f = parseFloat(ptext.replace(',', '.'));
      qty = Number.isFinite(f) ? f : 1;
    } else if (ptype === 'line_item/amount') {
      priceCents = toCents(ptext);
    } else if (ptype === 'line_item/unit_price') {
      unitPriceCents = toCents(ptext);
    }
  }

  if (!name) return null;
  if (priceCents == null) {
    if (unitPriceCents != null) {
      priceCents = Math.round(unitPriceCents * qty);
    } else {
      return null;
    }
  }
  return { name, qty, priceCents, unitPriceCents, category: null };
}

function docToReceipt(doc) {
  const out = {
    isReceipt: true,
    notReceiptReason: null,
    merchant: null,
    merchantSubtitle: null,
    bonDate: null,
    bonTime: null,
    items: [],
    subtotalCents: null,
    totalCents: null,
    paymentMethod: null,
    suspiciousManipulation: false,
    manipulationNotes: null,
    ocrConfidence: null,
    bonCountry: null,
  };

  const confidences = [];
  for (const entity of doc.entities || []) {
    if (Number.isFinite(entity.confidence)) confidences.push(entity.confidence);
    const etype = entity.type;
    const etext = entityText(entity);

    switch (etype) {
      case 'supplier_name':
        out.merchant = etext.trim() || out.merchant;
        break;
      case 'supplier_address':
        out.merchantSubtitle = etext.trim() || out.merchantSubtitle;
        break;
      case 'receipt_date':
      case 'purchase_date':
        out.bonDate = toIsoDate(etext);
        break;
      case 'purchase_time':
        out.bonTime = toHhMm(etext);
        break;
      case 'total_amount':
        out.totalCents = toCents(etext);
        break;
      case 'subtotal_amount':
        out.subtotalCents = toCents(etext);
        break;
      case 'payment_type':
        out.paymentMethod = etext.trim();
        break;
      case 'line_item': {
        const li = buildLineItem(entity);
        if (li) out.items.push(li);
        break;
      }
      default:
        // ignore tax, net_amount, etc.
        break;
    }
  }
  out.ocrConfidence = confidences.length
    ? confidences.reduce((s, c) => s + c, 0) / confidences.length
    : null;
  return out;
}

// ─── Public entry point ─────────────────────────────────────────────

/**
 * Run DocAI Expense Parser on the given image.
 * Returns null if DocAI isn't configured (caller should fall back).
 */
async function extractReceiptDocAI(imageBytes, mimeType) {
  if (!isConfigured()) {
    return null;
  }
  const startedTotal = Date.now();
  try {
    const client = getClient();
    const request = {
      name: processorName(),
      rawDocument: {
        content: Buffer.isBuffer(imageBytes) ? imageBytes : Buffer.from(imageBytes),
        mimeType: mimeType || 'image/jpeg',
      },
    };
    const [response] = await client.processDocument(request);
    const doc = response.document;
    const parsed = docToReceipt(doc);
    return {
      parsed,
      model: 'docai/expense',
      engine: 'docai',
      promptVersion: PROMPT_VERSION,
      latencyMs: Date.now() - startedTotal,
      cvLatencyMs: 0,
      geminiLatencyMs: 0,
      inputTokens: null,
      outputTokens: null,
      raw: '',
      ocrText: doc.text || '',
      pages: doc.pages?.length || 1,
    };
  } catch (err) {
    logger.warn('docai-extract-failed', { err: err.message, code: err.code });
    return null;
  }
}

module.exports = { extractReceiptDocAI, isConfigured };
