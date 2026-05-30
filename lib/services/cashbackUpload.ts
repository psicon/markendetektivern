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
  getCountFromServer,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from '@react-native-firebase/firestore';
// L Migration: putFile statt uploadBytesResumable. RNFirebase Storage
// auf Native unterstützt Blob-Upload zwar grundsätzlich, ist aber
// memory-ineffizient und auf großen Bildern unzuverlässig. putFile
// nutzt direkt den nativen Datei-Pfad ohne Blob-Konversion.
import { ref as storageRef, putFile } from '@react-native-firebase/storage';

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
  if (!localUri || typeof localUri !== 'string') {
    const e: any = new Error('upload_no_uri');
    e.code = 'upload_no_uri';
    throw e;
  }

  const filename = `${randomId()}.jpg`;
  const storagePath = `cashback-uploads/${uid}/${filename}`;

  console.error('[bonUpload] start', {
    uri: localUri.slice(0, 80),
    uid: uid.slice(0, 8),
    storagePath,
  });

  // L Migration: putFile mit lokalem URI statt Blob. RNFirebase
  // akzeptiert sowohl `file://`-prefix als auch absolute Pfade
  // (toFilePath strippt den prefix intern + dekodiert URL-encoding).
  let ref: any;
  try {
    ref = storageRef(storage, storagePath);
  } catch (err: any) {
    console.error('[bonUpload] ref_failed', err);
    const e: any = new Error(err?.message || 'storage_ref_failed');
    e.code = err?.code || 'storage_ref_failed';
    throw e;
  }

  // Watchdog tickt erst wenn bereits Progress lief — sonst würde ein
  // langsamer Connect-Handshake (z.B. EU-RTT, ColdStart) fälschlich
  // als timeout enden bevor RNFirebase überhaupt das erste Event
  // gefeuert hat. firstTickWaitMs = großzügiges Initial-Budget bis
  // zum ersten state_changed.
  const timeoutMs = opts?.timeoutMs ?? 60_000;
  const firstTickWaitMs = Math.max(timeoutMs, 30_000);
  let sizeBytes = 0;

  await new Promise<void>((resolve, reject) => {
    let task: any;
    try {
      task = putFile(ref, localUri, { contentType: 'image/jpeg' });
    } catch (err: any) {
      console.error('[bonUpload] putFile_threw', {
        code: err?.code,
        message: err?.message,
        uri: localUri.slice(0, 80),
      });
      const e: any = new Error(err?.message || 'putFile_failed');
      e.code = err?.code || 'storage/unknown';
      reject(e);
      return;
    }

    if (!task || typeof task.on !== 'function') {
      console.error('[bonUpload] task_invalid', { task: typeof task });
      const e: any = new Error('upload_task_invalid');
      e.code = 'upload_task_invalid';
      reject(e);
      return;
    }

    let firstTickSeen = false;
    let lastTick = Date.now();
    const watchdog = setInterval(() => {
      const elapsed = Date.now() - lastTick;
      const budget = firstTickSeen ? timeoutMs : firstTickWaitMs;
      if (elapsed > budget) {
        clearInterval(watchdog);
        console.error('[bonUpload] timeout', {
          elapsed,
          budget,
          firstTickSeen,
        });
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
      (snap: any) => {
        firstTickSeen = true;
        lastTick = Date.now();
        sizeBytes = snap?.totalBytes || sizeBytes;
        const total = snap?.totalBytes || sizeBytes || 1;
        const transferred = snap?.bytesTransferred || 0;
        const pct = Math.round((transferred / total) * 100);
        opts?.onProgress?.(pct, transferred, total);
      },
      (err: any) => {
        clearInterval(watchdog);
        console.error('[bonUpload] state_changed_error', {
          code: err?.code,
          message: err?.message,
          nativeErrorCode: err?.nativeErrorCode,
        });
        reject(err);
      },
      () => {
        clearInterval(watchdog);
        console.error('[bonUpload] complete', { sizeBytes });
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
  /** Vom User gewählte Aktion (cashback_campaigns/{id}), gegen die dieser
   *  Bon geprüft + vergütet wird. null → keine Aktion (nur Übersicht). */
  campaignId?: string | null;
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

// ─── Selected-campaign holder ──────────────────────────────────────
// Der Scan-Flow läuft über mehrere Screens (rewards → consent → capture
// → review → pending). Statt die campaignId brüchig durch 4 Routen-Params
// zu fädeln (consent macht router.replace OHNE Params), halten wir die
// beim Scan-Start gewählte Aktion hier modul-lokal. Bei jedem Scan-Start
// frisch gesetzt (oder null), beim enqueue gelesen. Reload mitten im
// Flow → verloren, dann startet der User den Scan eh neu.
let _selectedCampaignId: string | null = null;
export function setSelectedCampaignId(id: string | null): void {
  _selectedCampaignId = id;
}
export function getSelectedCampaignId(): string | null {
  return _selectedCampaignId;
}

export async function enqueueCashback(args: EnqueueArgs): Promise<EnqueueResult> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('not_authenticated');
  }
  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch (err: any) {
    console.error('[bonUpload] getIdToken_failed', {
      code: err?.code,
      message: err?.message,
    });
    const e: any = new Error(err?.message || 'token_failed');
    e.code = 'token_failed';
    throw e;
  }
  const url = `${FUNCTIONS_BASE}/enqueueCashback`;
  console.error('[bonUpload] enqueue_post', {
    url,
    storagePath: args.storagePath,
    hasHash: Boolean(args.bytesHash),
    source: args.source,
  });
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(args),
    });
  } catch (err: any) {
    console.error('[bonUpload] fetch_failed', {
      code: err?.code,
      message: err?.message,
    });
    const e: any = new Error(err?.message || 'network_failed');
    e.code = 'network_failed';
    throw e;
  }
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  console.error('[bonUpload] enqueue_response', {
    status: res.status,
    code: payload?.code,
    message: payload?.message,
    cashbackId: payload?.cashbackId,
  });
  if (!res.ok) {
    const err: any = new Error(payload?.message || `enqueue_${res.status}`);
    err.code = payload?.code || `http_${res.status}`;
    throw err;
  }
  return payload as EnqueueResult;
}

// ─── Payout request ─────────────────────────────────────────────────

export type PayoutMethodKey = 'paypal' | 'giftcard' | 'sepa';

export interface RequestPayoutResult {
  ok?: boolean;
  payoutId?: string;
  amountCents?: number;
  method?: string;
  // Fehlerfall:
  code?: string;
  balanceCents?: number;
  thresholdCents?: number;
}

/**
 * Auszahlung anfragen. Der Server prüft die Schwelle, debitiert das
 * Guthaben transaktional und legt ein cashback_payouts-Doc (status
 * 'requested') an. Zahlt die GANZE Balance aus. Wirft mit `code` bei
 * Fehlern (below_threshold / invalid_method / unauthenticated / internal).
 */
export async function requestPayout(method?: PayoutMethodKey): Promise<RequestPayoutResult> {
  const user = auth.currentUser;
  if (!user) {
    const e: any = new Error('not_authenticated');
    e.code = 'unauthenticated';
    throw e;
  }
  const idToken = await user.getIdToken();
  const res = await fetch(`${FUNCTIONS_BASE}/requestPayout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(method ? { method } : {}),
  });
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const err: any = new Error(payload?.message || payload?.code || `payout_${res.status}`);
    err.code = payload?.code || `http_${res.status}`;
    err.payload = payload;
    throw err;
  }
  return payload as RequestPayoutResult;
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
      const rows: CashbackStatusEntry[] = qs.docs.map((d: any) => ({
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

/**
 * Live + lazy: realtime-Query mit wachsendem `limit` (statt alle Bons auf
 * einmal zu laden). Bleibt realtime (neue Bons + Status-Flips erscheinen
 * sofort), lädt aber nur `pageLimit` Docs. „Load more" = pageLimit erhöhen
 * → neue Subscription. Sortiert serverseitig nach updatedAt desc.
 */
export function subscribeUserCashbackHistoryPaged(
  pageLimit: number,
  onChange: (entries: CashbackStatusEntry[]) => void,
): Unsubscribe {
  const uid = auth.currentUser?.uid;
  if (!uid) {
    onChange([]);
    return () => {};
  }
  const q = query(
    collection(db, `users/${uid}/cashback_status`),
    orderBy('updatedAt', 'desc'),
    fsLimit(pageLimit),
  );
  return onSnapshot(
    q,
    (qs) => {
      const rows: CashbackStatusEntry[] = qs.docs.map((d: any) => ({
        id: d.id,
        ...(d.data() as any),
      }));
      onChange(rows);
    },
    (error) => {
      console.warn('⚠️ subscribeUserCashbackHistoryPaged error:', error);
      onChange([]);
    },
  );
}

/** Gesamtanzahl der Bons (für die Header-Anzeige) — 1 günstiger Count-Read. */
export async function getCashbackCount(): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;
  try {
    const snap = await getCountFromServer(
      collection(db, `users/${uid}/cashback_status`),
    );
    return (snap.data().count as number) ?? 0;
  } catch (e) {
    console.warn('⚠️ getCashbackCount error:', (e as any)?.message);
    return 0;
  }
}

/**
 * Einmaliger Voll-Fetch aller Bon-Status-Docs des Users für die
 * Ausgabenstatistik. Kein Realtime — die Statistik ist eine Momentaufnahme.
 * Aggregation (Händler/Monat/Summe) passiert client-seitig im Screen.
 */
export async function fetchAllCashbackEntries(): Promise<CashbackStatusEntry[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  try {
    const qs = await getDocs(collection(db, `users/${uid}/cashback_status`));
    return qs.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
  } catch (e) {
    console.warn('⚠️ fetchAllCashbackEntries error:', (e as any)?.message);
    return [];
  }
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
