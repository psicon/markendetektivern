/**
 * Persistent background upload queue for receipts (Bons).
 *
 * Same robustness as the product upload queue (lib/services/uploadQueue.ts),
 * adapted to the single-image receipt flow:
 *   capture → review → enqueueBon() → [background] upload to Storage →
 *   enqueueCashback() HTTPS CF → the CF owns the mirror doc from there.
 *
 * Why a real queue (not the old pending-screen runUpload): the image is copied
 * to a persistent dir + the job is in AsyncStorage, so it survives LEAVING the
 * pending screen AND an app kill. NetInfo resumes it on reconnect globally —
 * no more zombie "Wird hochgeladen …" docs when the user navigates away offline.
 *
 * The mirror doc (users/{uid}/cashback_status/{id}) is still created/updated so
 * "Meine Bons" + the pending screen reflect state. The pending screen prefers
 * this queue's job status while a job is in-flight, and falls back to the mirror
 * doc once the job is gone (CF-owned lifecycle: ocr → review → approved/…).
 *
 * JS-only (AsyncStorage + expo-file-system + netinfo, all in the dev build).
 * NO image compression — full quality is required for OCR (see CLAUDE.md).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { AppState } from 'react-native';

import { prepareForUpload } from '@/lib/utils/cashbackImage';
import journeyTrackingService from './journeyTrackingService';
import { isOnline, refreshNetwork, subscribeNetwork } from './network';
import {
  createPendingMirror,
  deletePendingMirror,
  enqueueCashback,
  setPendingMirrorError,
  setPendingMirrorProgress,
  uploadBonImage,
} from './cashbackUpload';

const STORAGE_KEY = 'bon_upload_queue_v1';
const QUEUE_DIR = `${FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? ''}bon_upload_queue/`;
const MAX_RETRY_DELAY_MS = 5 * 60_000;
const MAX_AUTO_ATTEMPTS = 5;

export type BonJobStatus = 'queued' | 'uploading' | 'enqueueing' | 'failed';

export interface BonJob {
  id: string; // = clientUploadId = mirror doc id
  uid: string;
  imageUri: string; // persistent (copied into QUEUE_DIR)
  hash: string;
  width: number;
  height: number;
  capturedAt: number;
  source: 'live_camera' | 'upload';
  campaignId: string | null;
  status: BonJobStatus;
  progress: number; // 0..100
  attempts: number;
  lastError: string | null;
  createdAt: number;
}

export interface EnqueueBonInput {
  uid: string;
  imageUri: string;
  hash: string;
  width: number;
  height: number;
  capturedAt: number;
  source: 'live_camera' | 'upload';
  campaignId: string | null;
}

type Listener = (jobs: BonJob[]) => void;

let jobs: BonJob[] = [];
let loaded = false;
let processing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

// ─── internal helpers ───────────────────────────────────────────────

function snapshot(): BonJob[] {
  return jobs.map((j) => ({ ...j }));
}

function emit() {
  const snap = snapshot();
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      /* ignore */
    }
  });
}

async function persist() {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch (e: any) {
    console.warn('[bonQueue] persist failed', e?.message);
  }
}

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as BonJob[];
      jobs = parsed.map((j) =>
        j.status === 'uploading' || j.status === 'enqueueing'
          ? { ...j, status: 'queued', progress: 0 }
          : j,
      );
    }
  } catch (e: any) {
    console.warn('[bonQueue] load failed', e?.message);
    jobs = [];
  }
  emit();
}

async function ensureDir() {
  try {
    const info = await FileSystem.getInfoAsync(QUEUE_DIR);
    if (!info.exists) await FileSystem.makeDirectoryAsync(QUEUE_DIR, { intermediates: true });
  } catch {
    /* ignore */
  }
}

function randomId(): string {
  return `bon_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function getJob(id: string): BonJob | null {
  return jobs.find((j) => j.id === id) ?? null;
}

function setJob(id: string, patch: Partial<BonJob>) {
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

function setProgress(id: string, progress: number) {
  const j = getJob(id);
  if (!j || j.progress === progress) return;
  jobs = jobs.map((x) => (x.id === id ? { ...x, progress } : x));
  emit();
}

async function deleteJobFiles(jobId: string) {
  await FileSystem.deleteAsync(`${QUEUE_DIR}${jobId}.jpg`, { idempotent: true }).catch(() => {});
}

function humanError(e: any): string {
  const code = e?.code as string | undefined;
  const message = e?.message as string | undefined;
  if (code === 'upload_timeout')
    return 'Der Upload braucht zu lange. Prüfe deine Verbindung und versuch es erneut.';
  if (code === 'rate_limited') return 'Du hast heute schon einen Bon eingereicht. Morgen geht es weiter.';
  if (code === 'consent_missing') return 'Bitte bestätige zuerst die Cashback-Einwilligung.';
  if (code === 'unauthenticated' || code === 'not_authenticated')
    return 'Bitte melde dich an, um Bons einzureichen.';
  if (code?.startsWith('storage/')) return `Upload abgelehnt: ${code}`;
  if (code?.startsWith('http_')) return `Backend antwortet nicht (${code}).`;
  return `Einreichen fehlgeschlagen: ${code || message || 'unbekannter Fehler'}`;
}

// ─── public API ─────────────────────────────────────────────────────

/** Queue a receipt for background upload. Returns the client upload id (=
 *  mirror doc id) so the caller can navigate to the pending screen. */
export async function enqueueBon(input: EnqueueBonInput): Promise<string> {
  await ensureLoaded();
  await ensureDir();
  const id = randomId();

  let imageUri = input.imageUri;
  try {
    const dest = `${QUEUE_DIR}${id}.jpg`;
    await FileSystem.copyAsync({ from: input.imageUri, to: dest });
    imageUri = dest;
  } catch {
    // Keep the original cache uri if the copy fails — uploads this session
    // still work, just may not survive a cache purge.
  }

  const job: BonJob = {
    id,
    uid: input.uid,
    imageUri,
    hash: input.hash,
    width: input.width,
    height: input.height,
    capturedAt: input.capturedAt,
    source: input.source,
    campaignId: input.campaignId,
    status: 'queued',
    progress: 0,
    attempts: 0,
    lastError: null,
    createdAt: Date.now(),
  };

  jobs = [job, ...jobs];
  await persist();
  emit();

  // Placeholder mirror so the bon shows in history immediately (fire-and-
  // forget — a Firestore write hangs offline).
  void createPendingMirror(input.uid, id, { merchantName: 'Wird hochgeladen …' }).catch(() => {});

  void processQueue();
  return id;
}

export function subscribeBonQueue(fn: Listener): () => void {
  listeners.add(fn);
  void ensureLoaded().then(() => fn(snapshot()));
  return () => {
    listeners.delete(fn);
  };
}

/** Synchronous read of the current job for an id (null once it's gone). */
export function getBonJob(id: string): BonJob | null {
  return getJob(id);
}

export async function retryBonJob(id: string) {
  await ensureLoaded();
  setJob(id, { status: 'queued', attempts: 0, lastError: null });
  void processQueue();
}

export async function removeBonJob(id: string) {
  await ensureLoaded();
  await deleteJobFiles(id);
  jobs = jobs.filter((j) => j.id !== id);
  await persist();
  emit();
}

export function kickBonQueue() {
  requeueFailed();
  void processQueue();
}

// ─── processing ─────────────────────────────────────────────────────

function pickNext(): BonJob | null {
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].status === 'queued') return jobs[i];
  }
  return null;
}

function requeueFailed() {
  let changed = false;
  jobs = jobs.map((j) => {
    if (j.status !== 'failed' || j.attempts >= MAX_AUTO_ATTEMPTS) return j;
    changed = true;
    return { ...j, status: 'queued' as BonJobStatus };
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

async function runJob(job: BonJob) {
  setJob(job.id, { status: 'uploading', progress: 0, lastError: null });
  // Reset the mirror status back to 'uploading' (a previous fail may have left
  // it 'upload_failed'). Fire-and-forget.
  void setPendingMirrorProgress(job.uid, job.id, 0).catch(() => {});

  try {
    const prepared = await prepareForUpload(job.imageUri, 2000, job.width, job.height);

    let lastWrittenPct = 0;
    const upload = await uploadBonImage(prepared.uri, job.uid, {
      onProgress: (pct) => {
        setProgress(job.id, pct);
        if (pct - lastWrittenPct >= 5 || pct === 100) {
          lastWrittenPct = pct;
          void setPendingMirrorProgress(job.uid, job.id, pct).catch(() => {});
        }
      },
      timeoutMs: 60_000,
    });

    setJob(job.id, { status: 'enqueueing' });

    let journey: any = null;
    try {
      const j = journeyTrackingService.getCurrentJourney?.();
      if (j) {
        journey = {
          journeyId: j.journeyId,
          discoveryMethod: j.discoveryMethod,
          startedAt: j.startTime,
          location: j.location ?? null,
          motivationSignals: j.motivationSignals ?? null,
          filterMetricsMotivation: j.filterMetrics?.motivation ?? null,
          viewedProductsCount: j.viewedProducts?.length ?? 0,
        };
      }
    } catch {
      /* journey is best-effort */
    }

    const result = await enqueueCashback({
      clientUploadId: job.id,
      storagePath: upload.storagePath,
      bytesHash: job.hash,
      capturedAt: job.capturedAt,
      source: job.source,
      campaignId: job.campaignId,
      journey,
    });

    // Dedup: the CF folded this into an existing receipt → drop our placeholder.
    if (result.duplicate && result.cashbackId !== job.id) {
      void deletePendingMirror(job.uid, job.id).catch(() => {});
    }

    // Success → the CF owns the mirror lifecycle now. Drop the local job + file.
    await deleteJobFiles(job.id);
    jobs = jobs.filter((j) => j.id !== job.id);
    await persist();
    emit();
  } catch (e: any) {
    const attempts = (getJob(job.id)?.attempts ?? job.attempts) + 1;
    const human = humanError(e);
    setJob(job.id, { status: 'failed', attempts, lastError: human });
    // Persist failure to the mirror so history/other screens don't show a
    // forever-"uploading" zombie (fire-and-forget — hangs offline).
    void setPendingMirrorError(job.uid, job.id, human).catch(() => {});
    if (attempts < MAX_AUTO_ATTEMPTS) scheduleRetry(attempts);
  }
}

export async function processQueue(): Promise<void> {
  await ensureLoaded();
  if (processing) return;
  // Don't burn the 60s upload watchdog / enqueue when clearly offline; jobs
  // stay 'queued' and the network listener resumes on reconnect.
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
}

// Resume on app-foreground …
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    requeueFailed();
    void processQueue();
  }
});

// … and the moment connectivity returns (event-driven, no polling).
subscribeNetwork((s) => {
  if (s.online) {
    requeueFailed();
    void processQueue();
  }
});
