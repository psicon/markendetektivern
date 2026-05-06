/**
 * Cashback upload + enqueue.
 *
 * Path the user takes after the review screen:
 *   1. uploadBonImage(uri, uid)        — puts the image in
 *      gs://markendetektive-895f7.appspot.com/cashback-uploads/{uid}/{uuid}.jpg
 *   2. enqueueCashback({...})          — POST to the HTTPS Cloud Function
 *      with auth bearer = current ID token. Returns { cashbackId }.
 *   3. caller routes to /cashback/pending/{cashbackId} which listens
 *      via subscribeReceipt() for status changes.
 */

import { auth, storage } from '@/lib/firebase';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from '@react-native-firebase/firestore';
import { ref as storageRef, uploadBytesResumable } from '@react-native-firebase/storage';

import { db } from '@/lib/firebase';
import type { ReceiptDoc } from '@/lib/types/cashback';

// Override via env if you ever run a staging deploy. Region is locked
// to europe-west3 to match the Cloud Function spec.
const FUNCTIONS_BASE =
  process.env.EXPO_PUBLIC_CASHBACK_FN_BASE ||
  'https://europe-west3-markendetektive-895f7.cloudfunctions.net';

// ─── Upload ─────────────────────────────────────────────────────────

export interface UploadResult {
  storagePath: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Upload a JPEG to gs://.../cashback-uploads/{uid}/{filename}.
 *
 * Uses uploadBytesResumable with explicit progress + 60s no-progress
 * timeout. Reports per-state-change ticks via onProgress so the UI
 * can mirror them into Firestore (and other surfaces).
 */
export async function uploadBonImage(
  localUri: string,
  uid: string,
  opts?: {
    onProgress?: (pct: number, transferred: number, total: number) => void;
    timeoutMs?: number;
  },
): Promise<UploadResult> {
  if (!auth.currentUser) {
    const e: any = new Error('not_authenticated');
    e.code = 'not_authenticated';
    throw e;
  }
  const filename = `${randomId()}.jpg`;
  const storagePath = `cashback-uploads/${uid}/${filename}`;

  const response = await fetch(localUri);
  if (!response.ok) {
    const e: any = new Error(`local_read_failed_${response.status}`);
    e.code = 'local_read_failed';
    throw e;
  }
  const blob = await response.blob();
  const sizeBytes = (blob as any).size ?? 0;

  const ref = storageRef(storage, storagePath);
  const timeoutMs = opts?.timeoutMs ?? 60_000;

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(ref, blob, { contentType: 'image/jpeg' });

    let lastTick = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastTick > timeoutMs) {
        clearInterval(watchdog);
        try {
          task.cancel();
        } catch {}
        const err: any = new Error('upload_timeout');
        err.code = 'upload_timeout';
        reject(err);
      }
    }, 5_000);

    task.on(
      'state_changed',
      (snap) => {
        lastTick = Date.now();
        const total = snap.totalBytes || sizeBytes || 1;
        const pct = Math.round((snap.bytesTransferred / total) * 100);
        opts?.onProgress?.(pct, snap.bytesTransferred, total);
      },
      (err) => {
        clearInterval(watchdog);
        reject(err);
      },
      () => {
        clearInterval(watchdog);
        opts?.onProgress?.(100, sizeBytes, sizeBytes);
        resolve();
      },
    );
  });

  return {
    storagePath,
    contentType: 'image/jpeg',
    sizeBytes,
  };
}

function randomId(): string {
  // Fast UUIDv4-ish, no extra deps.
  const buf = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Enqueue HTTPS call ─────────────────────────────────────────────

/**
 * Write a thin placeholder mirror doc the moment the user taps
 * "Einreichen" — before upload even starts. This makes the bon
 * visible in /cashback/history immediately + survives app close
 * + lets the pending screen subscribe like any other bon.
 *
 * Status starts as 'uploading'. The Cloud Function later updates
 * the same doc (we pass `localId` as `clientUploadId` to the
 * function so it uses our id as the receipt doc id).
 */
export async function createPendingMirror(
  uid: string,
  localId: string,
  initial?: { merchantName?: string | null },
): Promise<void> {
  await setDoc(
    doc(db, `users/${uid}/cashback_status/${localId}`),
    {
      status: 'uploading',
      receiptId: localId,
      cashbackCents: 0,
      eligibleItemCount: 0,
      merchantName: initial?.merchantName ?? null,
      isClientPlaceholder: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function deletePendingMirror(uid: string, localId: string): Promise<void> {
  // Soft-delete: just mark as superseded. Avoids race with CF write.
  try {
    await setDoc(
      doc(db, `users/${uid}/cashback_status/${localId}`),
      { status: 'superseded', updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (e) {
    console.warn('⚠️ deletePendingMirror failed:', e);
  }
}

/**
 * Update the placeholder mirror with upload progress so the UI shows
 * a real progress bar. Called from the pending screen during upload.
 */
export async function setPendingMirrorProgress(
  uid: string,
  localId: string,
  progress: number,
): Promise<void> {
  try {
    await setDoc(
      doc(db, `users/${uid}/cashback_status/${localId}`),
      { uploadProgress: Math.max(0, Math.min(100, Math.round(progress))), updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (e) {
    // Non-fatal — progress is purely cosmetic
  }
}

/**
 * Mark a placeholder as failed so the pending screen can render a
 * "Erneut versuchen" CTA. Avoids the user being stuck with a forever-
 * loading placeholder.
 */
export async function setPendingMirrorError(
  uid: string,
  localId: string,
  error: string,
): Promise<void> {
  try {
    await setDoc(
      doc(db, `users/${uid}/cashback_status/${localId}`),
      {
        status: 'upload_failed',
        uploadError: String(error || 'unknown_error'),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (e) {
    // Non-fatal — caller already knows about the error
  }
}

export interface EnqueueArgs {
  /** Client-generated id used for both the placeholder mirror AND the
   *  Cloud Function's receipt doc. Lets the same UI subscription work
   *  through the entire lifecycle. */
  clientUploadId: string;
  storagePath: string;
  bytesHash: string;
  capturedAt: number;
  perceptualHash?: string;
  source: 'live_camera' | 'upload';
  /** Best-effort journey snapshot at upload time — gets stored on the
   *  receipt doc so the admin audit + future B2B analytics see what
   *  the user was doing in-app right before submitting. */
  journey?: {
    journeyId?: string;
    discoveryMethod?: string;
    startedAt?: number;
    location?: any | null;
    motivationSignals?: any | null;
    filterMetricsMotivation?: any | null;
    viewedProductsCount?: number;
  } | null;
}

export interface EnqueueResult {
  cashbackId: string;
  status: string;
  estimatedReadyBy?: number;
  duplicate?: boolean;
}

export async function enqueueCashback(args: EnqueueArgs): Promise<EnqueueResult> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('not_authenticated');
  }
  const idToken = await user.getIdToken();
  const url = `${FUNCTIONS_BASE}/enqueueCashback`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(args),
  });
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const err: any = new Error(payload?.message || `enqueue_${res.status}`);
    err.code = payload?.code || `http_${res.status}`;
    throw err;
  }
  return payload as EnqueueResult;
}

// ─── Snapshot subscription on the user-sub-collection mirror ────────
//
// The Cloud Function mirrors a slim status into
// /users/{uid}/cashback_status/{cashbackId} that the existing user-doc
// rules cover automatically — no top-level /receipts/* rule needed.

export interface CashbackStatusEntry {
  id: string;
  status?: string;
  cashbackCents?: number;
  tierApplied?: number;
  eligibleItemCount?: number;
  merchantId?: string | null;
  merchantName?: string | null;
  merchantDisplayName?: string | null;
  merchantLogoUrl?: string | null;
  merchantRaw?: string | null;
  // Legacy:
  merchant?: string | null;
  bonDate?: string | null;
  bonTotalCents?: number | null;
  rejectReason?: string | null;
  createdAt?: any;
  updatedAt?: any;
}

/**
 * Live list of the current user's bons (status mirrors). Sorted by
 * updatedAt desc on the client side.
 */
export function subscribeUserCashbackHistory(
  onChange: (entries: CashbackStatusEntry[]) => void,
): Unsubscribe {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    onChange([]);
    return () => {};
  }
  return onSnapshot(
    collection(db, `users/${uid}/cashback_status`),
    (qs) => {
      const rows: CashbackStatusEntry[] = qs.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      rows.sort((a, b) => {
        const aT = a.updatedAt?.toMillis?.() ?? 0;
        const bT = b.updatedAt?.toMillis?.() ?? 0;
        return bT - aT;
      });
      onChange(rows);
    },
    (error) => {
      console.warn('⚠️ subscribeUserCashbackHistory error:', error);
      onChange([]);
    },
  );
}

export function subscribeReceipt(
  cashbackId: string,
  onChange: (data: (Partial<ReceiptDoc> & { id: string }) | null) => void,
): Unsubscribe {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    onChange(null);
    return () => {};
  }
  return onSnapshot(
    doc(db, `users/${uid}/cashback_status/${cashbackId}`),
    (snap) => {
      if (!snap.exists()) {
        onChange(null);
        return;
      }
      onChange({ id: snap.id, ...(snap.data() as any) });
    },
    (error) => {
      console.warn('⚠️ subscribeReceipt error:', error);
      onChange(null);
    },
  );
}
