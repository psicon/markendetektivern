/**
 * Product-photo submission ("voller Datensatz") — the crowd-upload wizard.
 *
 * A user stands in a store and photographs one or more products, each as a
 * 7-photo set (front, back, manufacturer, EAN, nutrition, ingredients,
 * price tag). Images go to Storage; one Firestore doc per product captures
 * the metadata + paths with status 'pending' (reward credited later after
 * review). The market is chosen once per session and remembered while the
 * user keeps adding products in the same store.
 *
 * Storage layout:
 *   crowduploads/{uid}/{sessionId}/produkt_{index}/images/{step}.jpg
 */

import { auth, db, storage } from '@/lib/firebase';
import { getActiveCashbackCampaigns, getCashbackConfig } from '@/lib/services/cashbackService';
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  type Unsubscribe,
} from '@react-native-firebase/firestore';
import { putFile, ref as storageRef } from '@react-native-firebase/storage';

// ─── Step config ────────────────────────────────────────────────────

export type ProductPhotoStep =
  | 'front'
  | 'rueckseite'
  | 'hersteller'
  | 'ean'
  | 'naehrwerte'
  | 'zutaten'
  | 'preis';

export interface ProductPhotoStepDef {
  key: ProductPhotoStep;
  label: string;
  hint: string;
  icon: string; // MaterialCommunityIcons name
}

/** User-defined order: front, back, manufacturer, EAN, nutrition,
 *  ingredients, price (market is chosen separately at session start). */
export const PRODUCT_PHOTO_STEPS: ProductPhotoStepDef[] = [
  { key: 'front', label: 'Produktfront', hint: 'Vorderseite — Produktname gut lesbar.', icon: 'package-variant-closed' },
  { key: 'rueckseite', label: 'Rückseite', hint: 'Rückseite der Verpackung.', icon: 'package-variant' },
  { key: 'hersteller', label: 'Hersteller', hint: 'Hersteller-/Adressangabe auf der Verpackung.', icon: 'factory' },
  { key: 'ean', label: 'EAN / Barcode', hint: 'Strichcode scharf und vollständig im Bild.', icon: 'barcode' },
  { key: 'naehrwerte', label: 'Nährwerte', hint: 'Nährwerttabelle vollständig.', icon: 'nutrition' },
  { key: 'zutaten', label: 'Zutaten', hint: 'Zutatenliste vollständig.', icon: 'format-list-bulleted' },
  { key: 'preis', label: 'Preisschild', hint: 'Preisschild am Regal.', icon: 'tag' },
];

export const REQUIRED_STEPS: ProductPhotoStep[] = PRODUCT_PHOTO_STEPS.map((s) => s.key);

// ─── IDs + paths ────────────────────────────────────────────────────

/** Compact id (no dashes) — safe as a Storage path segment / doc id. */
export function newSessionId(): string {
  const buf = new Uint8Array(12);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function productImagePath(
  uid: string,
  sessionId: string,
  index: number,
  step: ProductPhotoStep,
): string {
  return `crowduploads/${uid}/${sessionId}/produkt_${index}/images/${step}.jpg`;
}

// ─── Campaign gating ────────────────────────────────────────────────

export interface ActiveProductCampaign {
  campaignId: string;
  rewardCents: number;
}

/**
 * The currently running product-photo campaign, or null. Cashback for
 * product datasets is ONLY given while such a campaign runs (analogous to
 * receipts in campaign mode) — otherwise data is collected without reward.
 */
export async function getActiveProductCampaign(): Promise<ActiveProductCampaign | null> {
  try {
    const cfg = await getCashbackConfig();
    if (!cfg.campaignsEnabled) return null;
    const all = await getActiveCashbackCampaigns();
    const c = all.find((x) => (x.kind ?? 'receipt') === 'product_photos');
    if (!c) return null;
    // Reward comes ONLY from the campaign config — no hardcoded amount.
    // rewardCents may be 0 (campaign runs but defines no per-dataset reward).
    const rewardCents =
      typeof c.cashbackPerBonCents === 'number' && c.cashbackPerBonCents > 0
        ? c.cashbackPerBonCents
        : 0;
    return { campaignId: c.id, rewardCents };
  } catch {
    return null;
  }
}

function codeErr(code: string, message?: string): Error {
  const e: any = new Error(message || code);
  e.code = code;
  return e;
}

// ─── Upload ─────────────────────────────────────────────────────────

export interface UploadOpts {
  onProgress?: (pct: number) => void;
  timeoutMs?: number;
}

/** Upload one product photo, return its storage path. */
export async function uploadProductImage(
  localUri: string,
  uid: string,
  sessionId: string,
  index: number,
  step: ProductPhotoStep,
  opts?: UploadOpts,
): Promise<string> {
  if (!auth.currentUser) throw codeErr('not_authenticated');
  if (!localUri) throw codeErr('upload_no_uri');

  const storagePath = productImagePath(uid, sessionId, index, step);
  const ref = storageRef(storage, storagePath);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const task = putFile(ref, localUri, { contentType: 'image/jpeg' });
    const timer = setTimeout(() => {
      try {
        task.cancel();
      } catch {
        /* ignore */
      }
      done(() => reject(codeErr('upload_timeout')));
    }, opts?.timeoutMs ?? 60_000);

    task.on(
      'state_changed',
      (snap: any) => {
        const total = snap?.totalBytes ?? 0;
        if (total > 0) opts?.onProgress?.((snap.bytesTransferred / total) * 100);
      },
      (err: any) => done(() => reject(err)),
      () => done(() => resolve()),
    );
  });

  return storagePath;
}

// ─── Submit (one product) ───────────────────────────────────────────

export interface ProductSubmissionInput {
  sessionId: string;
  productIndex: number;
  marketId: string | null;
  marketName: string | null;
  productName?: string | null;
  /** Active product-photo campaign this dataset counts toward (null =
   *  collected without cashback). Server is authoritative for the reward. */
  campaignId?: string | null;
  /** step → storage path */
  images: Partial<Record<ProductPhotoStep, string>>;
}

export async function submitProduct(
  uid: string,
  input: ProductSubmissionInput,
): Promise<string> {
  if (!auth.currentUser) throw codeErr('not_authenticated');
  const docRef = await addDoc(collection(db, 'crowd_uploads'), {
    userId: uid,
    sessionId: input.sessionId,
    productIndex: input.productIndex,
    marketId: input.marketId ?? null,
    marketName: input.marketName ?? null,
    productName: input.productName ?? null,
    campaignId: input.campaignId ?? null,
    images: input.images,
    stepCount: Object.keys(input.images).length,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

// ─── Read (overview) ────────────────────────────────────────────────

export interface ProductSubmissionEntry {
  id: string;
  sessionId?: string;
  productIndex?: number;
  marketId?: string | null;
  marketName?: string | null;
  productName?: string | null;
  images?: Partial<Record<ProductPhotoStep, string>>;
  stepCount?: number;
  status?: 'pending' | 'approved' | 'rejected';
  createdAt?: any;
}

/** Live list of the user's product submissions (newest first). */
export function subscribeUserProductSubmissions(
  onChange: (rows: ProductSubmissionEntry[]) => void,
): Unsubscribe {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    query(collection(db, 'crowd_uploads'), where('userId', '==', uid)),
    (qs: any) => {
      const rows: ProductSubmissionEntry[] = qs.docs.map((d: any) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      rows.sort((a, b) => {
        const aT = a.createdAt?.toMillis?.() ?? 0;
        const bT = b.createdAt?.toMillis?.() ?? 0;
        return bT - aT;
      });
      onChange(rows);
    },
    () => onChange([]),
  );
}
