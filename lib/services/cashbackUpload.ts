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
  getFirestore,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import * as FileSystem from 'expo-file-system';

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
 * The filename is a v4-uuid-ish random string; the server validates
 * the prefix matches the authenticated uid.
 */
export async function uploadBonImage(
  localUri: string,
  uid: string,
): Promise<UploadResult> {
  const filename = `${randomId()}.jpg`;
  const storagePath = `cashback-uploads/${uid}/${filename}`;

  // expo-file-system → ArrayBuffer
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const bytes = base64ToUint8Array(base64);

  const ref = storageRef(storage, storagePath);
  await uploadBytes(ref, bytes, { contentType: 'image/jpeg' });

  return {
    storagePath,
    contentType: 'image/jpeg',
    sizeBytes: bytes.byteLength,
  };
}

function base64ToUint8Array(b64: string): Uint8Array {
  // RN doesn't ship Buffer by default. Implement a small decoder.
  const cleaned = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  const padded = cleaned + '==='.slice((cleaned.length + 3) % 4);
  const bin =
    typeof atob === 'function'
      ? atob(padded)
      : globalThis.Buffer
      ? globalThis.Buffer.from(padded, 'base64').toString('binary')
      : '';
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
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

// ─── Snapshot subscription on the receipt doc ───────────────────────

export function subscribeReceipt(
  cashbackId: string,
  onChange: (data: (Partial<ReceiptDoc> & { id: string }) | null) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'receipts', cashbackId),
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
