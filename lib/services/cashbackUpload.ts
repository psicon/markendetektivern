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
  doc,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable } from 'firebase/storage';

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
 * In React Native, the most reliable upload path is `fetch(localUri) →
 * .blob() → uploadBytesResumable(blob)`. The Web SDK's plain
 * `uploadBytes(Uint8Array)` is flaky on RN (network task adapter does
 * not always forward the body). Resumable also works on slow / flaky
 * mobile connections.
 */
export async function uploadBonImage(
  localUri: string,
  uid: string,
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
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(ref, blob, { contentType: 'image/jpeg' });
    task.on(
      'state_changed',
      undefined,
      (err) => reject(err),
      () => resolve(),
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

export interface EnqueueArgs {
  storagePath: string;
  bytesHash: string;
  capturedAt: number;
  perceptualHash?: string;
  source: 'live_camera' | 'upload';
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
