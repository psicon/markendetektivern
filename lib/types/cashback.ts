/**
 * Cashback / Kassenbon System — TypeScript types
 *
 * Mirrors Firestore schema documented in CASHBACK_ARCHITECTURE.md §3.
 * Keep this file in sync with `firestore-cashback-rules.txt` and the
 * Cloud Function payload contracts under `cloud-functions/cashback-pipeline/`.
 *
 * All amounts are CENTS (integers), never euros (floats).
 */

import type { Timestamp } from 'firebase/firestore';

// ─── Config ─────────────────────────────────────────────────────────

export interface CashbackTier {
  minItems: number;
  cents: number;
}

export interface CashbackConfigDoc {
  tiers: CashbackTier[];
  dailyCap: number;
  throttleHours: number;
  minItemsForPayout: number;
  eligibleMerchants: string[];
  ocrModel: string;
  ocrPromptVersion: string;
  manualReviewThreshold: number;
  autoApproveThreshold: number;
  kycRequiredAt: number;
  consentVersion: string;
}

export const DEFAULT_CASHBACK_CONFIG: CashbackConfigDoc = {
  tiers: [
    { minItems: 4, cents: 5 },
    { minItems: 8, cents: 8 },
  ],
  dailyCap: 1,
  throttleHours: 24,
  minItemsForPayout: 4,
  eligibleMerchants: ['aldi', 'lidl', 'edeka', 'rewe', 'kaufland', 'penny', 'netto', 'dm', 'rossmann'],
  ocrModel: 'gemini-2.5-flash',
  ocrPromptVersion: 'v1.0',
  manualReviewThreshold: 0.65,
  autoApproveThreshold: 0.85,
  kycRequiredAt: 2000,
  consentVersion: 'v1.0-2026-05',
};

// ─── User-side state ────────────────────────────────────────────────

export interface CashbackConsentState {
  accepted: boolean;
  version: string;
  acceptedAt: Timestamp | null;
  ip?: string | null;
  appVersion: string;
}

export interface CashbackMonthlyEntry {
  earnedCents: number;
  bonsCount: number;
  lastBonAt: Timestamp;
}

export interface CashbackUserFields {
  cashback_balance_cents: number;
  cashback_lifetime_cents: number;
  cashback_pending_cents: number;
  cashback_consent: CashbackConsentState;
  cashback_monthly: Record<string, CashbackMonthlyEntry>;
  cashback_last_bon_date: string | null;
  trust_score: number;
  trust_score_components?: {
    tenure: number;
    behavioral: number;
    ocrAgreement: number;
    reviewHistory: number;
  };
  kyc?: {
    status: 'none' | 'requested' | 'passed' | 'failed';
    passedAt?: Timestamp;
  };
}

// ─── Receipt (top-level collection) ─────────────────────────────────

export type ReceiptStatus =
  | 'uploaded'
  | 'ocr_pending'
  | 'ocr_done'
  | 'matched'
  | 'review'
  | 'approved'
  | 'rejected'
  | 'paid';

export interface ReceiptItem {
  raw: string;
  productId?: string;
  brandId?: string;
  hersteller?: string;
  qty: number;
  priceCents: number;
  eligible: boolean;
  matchScore?: number;
}

export interface ReceiptCapture {
  source: 'live_camera' | 'upload';
  deviceAttest?: boolean;
  appCheck?: boolean;
  exifTimestamp?: Timestamp;
  hash: string;
  perceptualHash?: string;
  capturedAt: Timestamp;
}

export interface ReceiptStorage {
  bucket: string;
  path: string;
  contentType: string;
  sizeBytes: number;
}

export interface ReceiptOcrResult {
  model: string;
  promptVersion: string;
  latencyMs: number;
  raw?: string;
  parsed: Record<string, unknown>;
  confidence: number;
}

export interface ReceiptMerchant {
  id: string;
  matchedScore: number;
}

export interface ReceiptFraudSignals {
  duplicateHash: boolean;
  photoshopRisk: number;
  aiGenerated: number;
  behavioral: number;
  total: number;
}

export interface ReceiptDoc {
  userId: string;
  status: ReceiptStatus;
  capture: ReceiptCapture;
  storage: ReceiptStorage;
  ocr?: ReceiptOcrResult;
  merchant?: ReceiptMerchant;
  bonDate?: string;
  bonTime?: string;
  bonTotalCents?: number;
  items?: ReceiptItem[];
  eligibleItemCount?: number;
  tierApplied?: number;
  cashbackCents?: number;
  fraudSignals?: ReceiptFraudSignals;
  trustScore?: number;
  reviewerId?: string;
  reviewedAt?: Timestamp;
  reviewNote?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── Payouts ────────────────────────────────────────────────────────

export type PayoutMethod = 'paypal' | 'sepa' | 'giftcard';
export type PayoutStatus = 'requested' | 'sent' | 'delivered' | 'failed';

export interface CashbackPayoutDoc {
  userId: string;
  amountCents: number;
  method: PayoutMethod;
  tremendousOrderId?: string;
  status: PayoutStatus;
  kycPassed: boolean;
  createdAt: Timestamp;
  completedAt?: Timestamp;
}

// ─── Review queue ──────────────────────────────────────────────────

export type ReviewMode = 'ai' | 'human_holdback';
export type ReviewStatus = 'open' | 'in_progress' | 'resolved';
export type ReviewResolution = 'approved' | 'rejected' | 'partial';
export type ReviewReason =
  | 'low_trust'
  | 'duplicate_suspect'
  | 'merchant_unknown'
  | 'manual_flag'
  | 'high_payout';

export interface CashbackReviewQueueDoc {
  receiptId: string;
  mode: ReviewMode;
  reason: ReviewReason;
  assigneeId?: string;
  status: ReviewStatus;
  resolution?: ReviewResolution;
  aiVerdict?: {
    decision: ReviewResolution;
    confidence: number;
    reasons: string[];
    flaggedItems?: number[];
    suggestedTrustDelta?: number;
  };
  createdAt: Timestamp;
  resolvedAt?: Timestamp;
}

// ─── Ledger (sub-collection under user) ─────────────────────────────

export type LedgerEntryType = 'earn' | 'payout' | 'reverse' | 'admin_adjust';

export interface CashbackLedgerEntry {
  type: LedgerEntryType;
  cents: number;
  receiptId?: string;
  payoutId?: string;
  balanceAfterCents: number;
  createdAt: Timestamp;
  reason?: string;
}

// ─── Purchased products (sub-collection under user) ─────────────────

export interface PurchasedProductEntry {
  productId: string;
  firstPurchasedAt: Timestamp;
  lastPurchasedAt: Timestamp;
  purchaseCount: number;
  totalSpentCents: number;
  lastReceiptId: string;
}

// ─── Merchants ──────────────────────────────────────────────────────

export interface MerchantDoc {
  canonicalName: string;
  aliases: string[];
  logoUrl?: string;
  country: 'DE' | 'AT' | 'CH';
  eligible: boolean;
  ocrFingerprints: string[];
}

// ─── Cloud Function payload contracts ───────────────────────────────

export interface EnqueueCashbackRequest {
  imagePath: string;
  bytesHash: string;
  capturedAt: number;
  perceptualHash?: string;
  source: 'live_camera' | 'upload';
}

export interface EnqueueCashbackResponse {
  cashbackId: string;
  estimatedReadyBy: number;
  status: 'processing';
}

export interface EnqueueCashbackError {
  code:
    | 'unauthenticated'
    | 'consent_missing'
    | 'rate_limited'
    | 'duplicate'
    | 'invalid_image'
    | 'internal';
  message: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Calculate the cashback in cents for a given eligible-item count.
 * Returns 0 if below the minimum tier (no payout).
 */
export function tierFor(eligibleItemCount: number, config: CashbackConfigDoc): number {
  const sortedTiers = [...config.tiers].sort((a, b) => b.minItems - a.minItems);
  for (const tier of sortedTiers) {
    if (eligibleItemCount >= tier.minItems) {
      return tier.cents;
    }
  }
  return 0;
}

/**
 * Format cents to a localized euro string (de-DE).
 * 8 -> "0,08 €", 1200 -> "12,00 €"
 */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}
