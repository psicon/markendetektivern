/**
 * Persistent background upload queue for product-photo submissions.
 *
 * Why this exists: the wizard used to block on a foreground "uploading"
 * screen and fire an Alert AFTER all 7 uploads finished. Swiping away
 * orphaned that Alert onto whatever screen you landed on, and N offline
 * submissions meant N overlays. This service makes "Einreichen" instant —
 * the captured images are copied into a persistent dir + the job is queued,
 * then uploaded in the background (sequential, retry-with-backoff, resumes
 * on app-foreground). The product-submit overview is the SINGLE status
 * surface (one list, N rows) — no overlays, even with 20 offline submissions.
 *
 * JS-only by design (AsyncStorage + expo-file-system, both already in the
 * dev-client build) so it ships over Metro without a native rebuild.
 * @react-native-community/netinfo would make reconnect *instant*; that's a
 * native module → deferred to a future native build. Until then, AppState
 * 'active' + a backoff retry timer + an explicit kick from the overview
 * cover the "upload resumes when signal returns" case well enough.
 *
 * Single source of truth for in-flight uploads: this module. The wizard
 * enqueues, the overview subscribes. Storage key is never written directly
 * elsewhere (per the project's state-persistence rule).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { AppState } from 'react-native';

import type { CaptureContext, ClientVersion } from './captureContext';
import { isOnline, refreshNetwork, subscribeNetwork } from './network';
import { submitProduct, uploadProductImage, type ProductPhotoStep } from './productSubmit';
import { showInfoToast } from './ui/toast';

const STORAGE_KEY = 'product_upload_queue_v1';
const QUEUE_DIR = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ''}upload_queue/`;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
// After this many consecutive auto-failures we stop the automatic retry loop
// and leave the job 'failed' until the user taps "Erneut versuchen" — no
// infinite background spin on a permanently broken job (corrupt image, revoked
// auth, server reject).
const MAX_AUTO_ATTEMPTS = 5;

export type UploadJobStatus = 'queued' | 'uploading' | 'failed';

export interface UploadJobStep {
  key: ProductPhotoStep;
  /** Persistent uri (copied into QUEUE_DIR on enqueue). */
  uri: string;
  fileName?: string;
}

export interface UploadJob {
  id: string;
  uid: string;
  sessionId: string;
  productIndex: number;
  marketId: string | null;
  marketName: string | null;
  marketLand: string | null;
  productName: string | null;
  ean: string | null;
  campaignId: string | null;
  steps: UploadJobStep[];
  status: UploadJobStatus;
  /** 0..100, overall across all steps of this job. */
  progress: number;
  attempts: number;
  lastError: string | null;
  createdAt: number;
  /**
   * Orts-/Zeitkontext aus dem Moment der AUFNAHME. Muss mit dem Auftrag
   * mitreisen: diese Warteschlange ist persistent und überlebt
   * App-Neustarts, `runJob` kann also Stunden oder Tage später laufen —
   * dann aber an einem anderen Ort. Erst mit diesem Feld beschreibt die
   * Ortsangabe den Laden und nicht das heimische WLAN.
   *
   * Optional, weil Aufträge, die vor diesem Update eingereiht wurden, es
   * nicht tragen. `submitProduct` fällt dann auf den Live-Stand zurück.
   */
  capture?: CaptureContext | null;
  clientVersion?: ClientVersion | null;
}

export interface EnqueueInput {
  uid: string;
  sessionId: string;
  productIndex: number;
  marketId: string | null;
  marketName: string | null;
  marketLand: string | null;
  productName: string | null;
  ean: string | null;
  campaignId: string | null;
  steps: { key: ProductPhotoStep; uri: string; fileName?: string }[];
  capture?: CaptureContext | null;
  clientVersion?: ClientVersion | null;
}

type Listener = (jobs: UploadJob[]) => void;

let jobs: UploadJob[] = [];
let loaded = false;
let processing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
// Successful uploads since the queue was last drained — used to confirm a
// finished background batch with one toast (even if the user moved on).
let completedInBatch = 0;
const listeners = new Set<Listener>();

// ─── internal state helpers ─────────────────────────────────────────

function snapshot(): UploadJob[] {
  return jobs.map((j) => ({ ...j, steps: j.steps.map((s) => ({ ...s })) }));
}

function emit() {
  const snap = snapshot();
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      /* ignore listener errors */
    }
  });
}

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch (e: any) {
    console.warn('[uploadQueue] persist failed', e?.message);
  }
}

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UploadJob[];
      // A job left mid-upload (app killed) is reset to 'queued' so it
      // resumes cleanly rather than being stuck on 'uploading' forever.
      jobs = parsed.map((j) =>
        j.status === 'uploading' ? { ...j, status: 'queued', progress: 0 } : j,
      );
    }
  } catch (e: any) {
    console.warn('[uploadQueue] load failed', e?.message);
    jobs = [];
  }
  emit();
}

async function ensureDir() {
  try {
    const info = await FileSystem.getInfoAsync(QUEUE_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(QUEUE_DIR, { intermediates: true });
  } catch {
    /* ignore — copy falls back to the original cache uri */
  }
}

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function getJob(id: string): UploadJob | null {
  return jobs.find((j) => j.id === id) ?? null;
}

/** Patch a job's status fields → emit + persist (durable change). */
function setJob(id: string, patch: Partial<UploadJob>) {
  let changed = false;
  jobs = jobs.map((j) => {
    if (j.id !== id) return j;
    changed = true;
    return { ...j, ...patch };
  });
  if (changed) {
    emit();
    void persist();
  }
}

/** Progress-only update → emit (ephemeral, NOT persisted to avoid hammering
 *  AsyncStorage; on restart a job resets to 'queued' anyway). */
function setProgress(id: string, progress: number) {
  const j = getJob(id);
  if (!j || j.progress === progress) return;
  jobs = jobs.map((x) => (x.id === id ? { ...x, progress } : x));
  emit();
}

// ─── image persistence ──────────────────────────────────────────────

async function copyStepImage(
  jobId: string,
  step: { key: ProductPhotoStep; uri: string },
): Promise<string> {
  const dir = `${QUEUE_DIR}${jobId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const dest = `${dir}${step.key}.jpg`;
  await FileSystem.copyAsync({ from: step.uri, to: dest });
  return dest;
}

async function deleteJobFiles(jobId: string) {
  await FileSystem.deleteAsync(`${QUEUE_DIR}${jobId}/`, { idempotent: true }).catch(() => {});
}

// ─── public API ─────────────────────────────────────────────────────

/** Queue one product submission for background upload. Returns instantly
 *  after copying images + writing the queue (no network). */
export async function enqueueProductUpload(input: EnqueueInput): Promise<string> {
  await ensureLoaded();
  await ensureDir();
  const id = randomId();

  const steps: UploadJobStep[] = [];
  for (const s of input.steps) {
    try {
      const uri = await copyStepImage(id, s);
      steps.push({ key: s.key, uri, fileName: s.fileName });
    } catch {
      // Persistence failed → keep the original cache uri. Upload can still
      // succeed this session; it just won't survive a cache purge.
      steps.push({ key: s.key, uri: s.uri, fileName: s.fileName });
    }
  }

  const job: UploadJob = {
    id,
    uid: input.uid,
    sessionId: input.sessionId,
    productIndex: input.productIndex,
    marketId: input.marketId,
    marketName: input.marketName,
    marketLand: input.marketLand,
    productName: input.productName,
    ean: input.ean,
    campaignId: input.campaignId,
    steps,
    status: 'queued',
    progress: 0,
    attempts: 0,
    lastError: null,
    createdAt: Date.now(),
    capture: input.capture ?? null,
    clientVersion: input.clientVersion ?? null,
  };

  jobs = [job, ...jobs];
  await persist();
  emit();
  void processQueue();
  return id;
}

/** Subscribe to queue changes. Fires immediately with the current state. */
export function subscribeUploadQueue(fn: Listener): () => void {
  listeners.add(fn);
  void ensureLoaded().then(() => fn(snapshot()));
  return () => {
    listeners.delete(fn);
  };
}

/** Re-attempt a failed job now (user tapped "Erneut versuchen"). Resets the
 *  auto-retry budget so the automatic loop is available again too. */
export async function retryJob(id: string) {
  await ensureLoaded();
  setJob(id, { status: 'queued', attempts: 0, lastError: null });
  void processQueue();
}

/** Re-attempt ALL failed jobs (user tapped "Alle erneut"). */
export async function retryAllFailed() {
  await ensureLoaded();
  let changed = false;
  jobs = jobs.map((j) => {
    if (j.status !== 'failed') return j;
    changed = true;
    return { ...j, status: 'queued' as UploadJobStatus, attempts: 0, lastError: null };
  });
  if (changed) {
    emit();
    void persist();
  }
  void processQueue();
}

/** Drop a job (and its images) from the queue. */
export async function removeJob(id: string) {
  await ensureLoaded();
  await deleteJobFiles(id);
  jobs = jobs.filter((j) => j.id !== id);
  await persist();
  emit();
}

/** Kick the queue — called by the overview on mount and on app-foreground. */
export function kickUploadQueue() {
  requeueFailed();
  void processQueue();
}

// ─── processing ─────────────────────────────────────────────────────

function pickNext(): UploadJob | null {
  // Oldest-first: jobs are stored newest-first, so iterate from the end.
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].status === 'queued') return jobs[i];
  }
  return null;
}

function requeueFailed() {
  let changed = false;
  jobs = jobs.map((j) => {
    // Don't auto-requeue jobs that exhausted their auto-retry budget — those
    // wait for an explicit user retry.
    if (j.status !== 'failed' || j.attempts >= MAX_AUTO_ATTEMPTS) return j;
    changed = true;
    return { ...j, status: 'queued' as UploadJobStatus };
  });
  if (changed) {
    emit();
    void persist();
  }
}

function scheduleRetry(attempts: number) {
  const delay = Math.min(MAX_RETRY_DELAY_MS, 10_000 * Math.max(1, attempts));
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    requeueFailed();
    void processQueue();
  }, delay);
}

async function runJob(job: UploadJob) {
  setJob(job.id, { status: 'uploading', progress: 0, lastError: null });
  try {
    const uploaded: Partial<Record<ProductPhotoStep, string>> = {};
    const steps = job.steps;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const path = await uploadProductImage(s.uri, job.uid, job.sessionId, job.productIndex, s.key, {
        fileName: s.fileName,
        onProgress: (pct) => {
          setProgress(job.id, Math.round(((i + pct / 100) / steps.length) * 100));
        },
      });
      uploaded[s.key] = path;
    }
    await submitProduct(job.uid, {
      sessionId: job.sessionId,
      productIndex: job.productIndex,
      marketId: job.marketId,
      marketName: job.marketName,
      marketLand: job.marketLand,
      productName: job.productName,
      ean: job.ean,
      campaignId: job.campaignId,
      images: uploaded,
      capture: job.capture ?? null,
      clientVersion: job.clientVersion ?? null,
    });
    // Success → the submission now lives in Firestore (status 'pending')
    // and shows up in the overview list. Drop the local job + its files.
    await deleteJobFiles(job.id);
    jobs = jobs.filter((j) => j.id !== job.id);
    await persist();
    emit();
    completedInBatch += 1;
  } catch (e: any) {
    const attempts = (getJob(job.id)?.attempts ?? job.attempts) + 1;
    setJob(job.id, { status: 'failed', attempts, lastError: e?.message ?? 'upload_failed' });
    // Auto-retry with backoff only up to the cap; beyond it, wait for a manual
    // retry so we never spin forever on a permanently broken job.
    if (attempts < MAX_AUTO_ATTEMPTS) scheduleRetry(attempts);
  }
}

export async function processQueue(): Promise<void> {
  await ensureLoaded();
  if (processing) return;
  // Don't burn per-image upload timeouts when we're clearly offline — leave
  // jobs 'queued' (the overview shows the offline hint) and let the network
  // listener resume us on reconnect. A fresh probe avoids stalling on a stale
  // "offline" reading right after the app wakes.
  if (!isOnline()) {
    await refreshNetwork();
    if (!isOnline()) return;
  }
  processing = true;
  try {
    let next = pickNext();
    while (next) {
      await runJob(next);
      next = pickNext();
    }
  } finally {
    processing = false;
  }
  // Batch drained → confirm completions once. Fires even if the user navigated
  // away (the queue is module-level), closing the feedback loop.
  if (completedInBatch > 0 && !jobs.some((j) => j.status === 'queued' || j.status === 'uploading')) {
    const n = completedInBatch;
    completedInBatch = 0;
    try {
      showInfoToast(n === 1 ? 'Produkt hochgeladen ✓' : `${n} Produkte hochgeladen ✓`, 'success');
    } catch {
      /* toast provider may not be mounted yet */
    }
  }
}

// Resume uploads whenever the app comes back to the foreground. (Failed
// jobs are re-queued so a reconnect after a flaky upload picks them up.)
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    requeueFailed();
    void processQueue();
  }
});

// Resume the moment connectivity returns — event-driven, no polling. This is
// what makes "lädt automatisch hoch, sobald du wieder online bist" actually
// happen without the user doing anything.
subscribeNetwork((s) => {
  if (s.online) {
    requeueFailed();
    void processQueue();
  }
});
