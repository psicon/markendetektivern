/**
 * Cashback / Kassenbon System — TypeScript types
 *
 * Mirrors Firestore schema documented in CASHBACK_ARCHITECTURE.md §3.
 * Keep this file in sync with `firestore-cashback-rules.txt` and the
 * Cloud Function payload contracts under `cloud-functions/cashback-pipeline/`.
 *
 * All amounts are CENTS (integers), never euros (floats).
 */

import type { Timestamp } from '@react-native-firebase/firestore';

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
  /** Mindest-Guthaben (in Cent) ab dem ausgezahlt werden darf. Default 1000 = 10 €. */
  payoutThresholdCents: number;
  /** Max. Cashback pro Kalendermonat (in Cent). 0 = KEIN Limit (Default).
   *  >0 aktiviert die serverseitige Monats-Begrenzung. */
  monthlyMaxCents: number;
  /** Aktions-Modus: wenn true, gibt es Cashback NUR während einer aktiven
   *  Kampagne (cashback_campaigns). Keine Aktion → Bon wird verarbeitet +
   *  Produkte getrackt, aber 0 Vergütung. Default false = Dauer-Cashback. */
  campaignsEnabled: boolean;
  /** GLOBALES Wochen-Limit: max. Bons PRO WOCHE die ein User insgesamt
   *  (über ALLE Aktionen zusammen) für Cashback einreichen darf.
   *  Hard-Ceiling über allem — jeder vergütete Bon zählt dagegen,
   *  egal welche Aktion gewählt wurde. 0 = kein globales Limit (Default).
   *  Die Aktion hat ZUSÄTZLICH ihr eigenes `weeklyBonCap`; es gilt das
   *  jeweils strengere. Server-enforced (TODO: cashback-pipeline). */
  weeklyBonCap: number;
  /** Bon-Aufnahme-Modus (nur iOS relevant).
   *  - 'apple' (Default): Apple VisionKit Document-Scanner mit
   *    Auto-Shutter (snappt automatisch wenn der Bon stabil im Rahmen
   *    ist). Beste Kantenerkennung, aber kein manueller Auslöser.
   *  - 'manual': eigener expo-camera-Stack mit manuellem Auslöser +
   *    nachgelagerter Kantenerkennung (bon-edge-detector). Für User
   *    die den Auto-Shutter als zu hektisch empfinden.
   *  Android nutzt immer den ML-Kit-Scanner (kein Auto-Shutter-Problem),
   *  dieser Flag wird dort ignoriert. */
  captureMode?: 'apple' | 'manual';
}

/** Eine zeitlich begrenzte Cashback-Aktion mit Gesamt-Budget.
 *  Es können mehrere gleichzeitig aktiv sein — der User WÄHLT beim
 *  Einreichen die Aktion. Jeder vergütete Bon zählt sowohl gegen das
 *  pro-Aktion-`weeklyBonCap` als auch gegen das globale
 *  `config.weeklyBonCap`. Geld-/Budget-Logik ist immer serverseitig. */
export interface CashbackCampaign {
  active: boolean;
  startAt: Timestamp;
  endAt: Timestamp;
  budgetTotalCents: number;       // „max verfügbar" gesamt
  budgetRemainingCents: number;   // live, transaktional dekrementiert
  maxPerUserCents?: number;       // optionaler Override (sonst config.monthlyMaxCents)
  title?: string;
  description?: string;
  /** Art der Einreich-Aktion → steuert Icon + Button-Ziel auf der Karte.
   *  'receipt' = Kassenbon scannen (Default), 'product_photos' =
   *  Produktbilder einreichen, 'survey' = Umfrage. */
  kind?: 'receipt' | 'product_photos' | 'survey';
  /** Optionale Tier-Tabelle (mehr Artikel = mehr Cashback) PRO AKTION.
   *  Wenn gesetzt, gewinnt sie über `cashbackPerBonCents` (Flat-Rate).
   *  Beides leer → keine Vergütung (Aktion fehlkonfiguriert). */
  tiers?: CashbackTier[];
  // ── Pro-Aktion konfigurierbar (Override der globalen Config) ──
  /** Cashback (in Cent) pro qualifiziertem Bon dieser Aktion. Wenn
   *  gesetzt, ersetzt es die Tier-Tabelle für diese Aktion (Flat-Rate).
   *  Wenn nicht gesetzt → `tiers` der globalen Config. */
  cashbackPerBonCents?: number;
  /** Mindestanzahl anrechenbarer Artikel damit ein Bon dieser Aktion
   *  vergütet wird. Override von `config.minItemsForPayout`. */
  minItems?: number;
  /** Max. Bons PRO WOCHE die ein User in DIESER Aktion einreichen darf.
   *  Unabhängig vom globalen `config.weeklyBonCap` — es gilt das
   *  strengere der beiden. 0/undefined = nur das globale Limit greift. */
  weeklyBonCap?: number;
  /** Optionaler Override der anrechenbaren Märkte (sonst global /
   *  discounter.cashbackEligible). Slugs der `discounter`-Collection. */
  eligibleMerchants?: string[];
  /** Max. Bon-Alter in TAGEN (bezogen aufs Bon-Datum). Ein Bon wird nur
   *  akzeptiert, wenn er nicht älter als `maxAgeDays` ist — sonst Reject
   *  mit `bon_too_old`. Greift bereits im Eligibility-Gate. 0/undefined =
   *  kein Aktions-Limit (globaler Default greift). */
  maxAgeDays?: number;
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
  // v2.0 = Consent-Text deckt anonymisierte Marktdaten-Verwertung ab
  // (ClickUp 86ca6u6xd). ACHTUNG: das Live-Doc cashback_config/v1 hat
  // ein eigenes consentVersion-Feld, das diesen Default ÜBERSCHREIBT —
  // dort steht noch v1.0-2026-05. Das Doc ist der Aktivierungsschalter:
  // erst auf v2.0-2026-06 setzen, wenn der Build mit dem neuen Consent-
  // Text ausgerollt ist (sonst re-consenten User auf den ALTEN Text).
  // Der Bump invalidiert alle v1-Consents → Re-Consent-Flow greift.
  consentVersion: 'v2.0-2026-06',
  payoutThresholdCents: 1000, // 10 €
  monthlyMaxCents: 0, // 0 = kein Limit (opt-in via Config-Doc)
  campaignsEnabled: false, // false = Dauer-Cashback (opt-in via Config-Doc)
  weeklyBonCap: 0, // 0 = kein globales Wochen-Limit (opt-in via Config-Doc)
  captureMode: 'apple', // 'apple' = VisionKit Auto-Shutter (iOS), 'manual' = expo-camera
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
  /** Vom User gewählte Aktion, gegen die dieser Bon geprüft + vergütet
   *  wird. null/fehlt → keine Aktion (Bon nur zur Ausgabenübersicht,
   *  0 Vergütung). Server ist autoritativ. */
  campaignId?: string | null;
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
 * Bruttto-Cashback (in Cent) für einen Bon im Kontext EINER Aktion,
 * VOR Wochenlimit / Per-User-Cap / Budget-Deckelung.
 *
 * - Aktion mit `tiers` → Tier-Tabelle (mehr Artikel = mehr).
 * - sonst Flat `cashbackPerBonCents`, sofern `minItems` erreicht.
 * - Mindestartikel: campaign.minItems ?? config.minItemsForPayout.
 * Gibt 0 zurück wenn unter Mindestartikel oder Aktion fehlkonfiguriert.
 */
export function campaignReward(
  eligibleItemCount: number,
  campaign: Pick<CashbackCampaign, 'tiers' | 'cashbackPerBonCents' | 'minItems'>,
  config: Pick<CashbackConfigDoc, 'minItemsForPayout'>,
): number {
  const minItems = campaign.minItems ?? config.minItemsForPayout;
  if (eligibleItemCount < minItems) return 0;
  if (campaign.tiers && campaign.tiers.length > 0) {
    return tierFor(eligibleItemCount, { tiers: campaign.tiers } as CashbackConfigDoc);
  }
  if (typeof campaign.cashbackPerBonCents === 'number' && campaign.cashbackPerBonCents > 0) {
    return campaign.cashbackPerBonCents;
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
