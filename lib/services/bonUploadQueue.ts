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
 *
 * ═══ Wem ein Auftrag gehört (Stufe 1 „erst einreichen, dann Konto", 25.09.2026) ═══
 *
 * Ein Auftrag läuft nur für die uid, unter der er eingereiht wurde, oder für
 * ein Konto, in das der Server die Übernahme dieser Gast-uid BESTÄTIGT hat
 * (`GastUebernahme.zielVon`). Früher wurde jeder Auftrag bedingungslos auf die
 * gerade angemeldete uid umgeschrieben — nach einer Abmeldung landete ein Bon
 * so auf der neuen Gast-uid oder bei einer anderen Person am selben Gerät.
 * Aufträge, die (noch) nicht laufen dürfen, bleiben `queued` und warten; sie
 * sind kein Fehler und verbrauchen keine Versuche.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { AppState } from 'react-native';

import { prepareForUpload } from '@/lib/utils/cashbackImage';
import { auth } from '@/lib/firebase';
import { isEffectivelyAnonymous } from '@/lib/utils/authIdentity';
import { GastBestand } from './gastBestand';
import { GastUebernahme } from './gastUebernahme';
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
// 86cb6tx29: Das Retry-Budget ist ein FENSTER, kein Lebenszeit-Zähler.
// Vorher verbrannten die 5 Versuche in ~100 s (linear 10-40 s) und der Job
// lag danach für immer — unsichtbar. Jetzt: nach 30 min Ruhe wird das
// Budget wieder freigegeben (jede Auto-Wiederbelebung — AppState, NetInfo,
// kickBonQueue — prüft das Fenster).
const RETRY_WINDOW_MS = 30 * 60_000;
// Harte Server-Ablehnungen: mit Wiederholen nicht heilbar, darum kein
// Auto-Retry. consent_missing heilt die Einwilligung, konto_erforderlich das
// Anlegen eines Kontos — beide geben ihre Aufträge über gesperrteFreigeben frei.
const TERMINALE_CODES = ['consent_missing', 'rate_limited', 'bon_too_old', 'konto_erforderlich'];

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
  /** Zeitpunkt des letzten Versuchs — Basis fürs Retry-Fenster (86cb6tx29). */
  lastAttemptAt?: number;
  /** Harte Server-Ablehnung (consent_missing/rate_limited): kein Auto-Retry,
   *  nur manuell — verbrennt kein Budget. */
  terminal?: boolean;
  /** Fehlercode der harten Ablehnung — daran hängt gesperrteFreigeben(). */
  terminalCode?: string | null;
  /** Mirror-Write (users/{uid}/cashback_status) schlug fehl — der Job ist
   *  dann NUR über die lokale Queue-Anzeige sichtbar (history.tsx). */
  mirrorFailed?: boolean;
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
// Während eines Kontowechsels startet kein neuer Auftrag (pausiereBonQueue).
let pausiert = false;
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
          : mitSperrcode(j),
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

function aktuelleUid(): string | null {
  return auth.currentUser?.uid ?? null;
}

/**
 * Darf dieser Auftrag JETZT laufen? Nur für die angemeldete uid selbst oder
 * für eine Gast-uid, deren Übernahme in genau dieses Konto der Server
 * bestätigt hat. Eine lokal nur GEMERKTE Zuordnung reicht nicht.
 */
function darfLaufen(job: Pick<BonJob, 'uid'>, currentUid: string | null = aktuelleUid()): boolean {
  return !!currentUid && (job.uid === currentUid || GastUebernahme.zielVon(job.uid) === currentUid);
}

/**
 * Aufträge aus App-Ständen vor `terminalCode` tragen nur den Anzeigetext.
 * Der ist je Code fest (humanError) — daraus lässt sich der Code eindeutig
 * zurückgewinnen, sonst bliebe z. B. ein alter consent_missing-Auftrag nach
 * der Einwilligung für immer gesperrt.
 */
function mitSperrcode(j: BonJob): BonJob {
  if (!j.terminal || j.terminalCode) return j;
  const code = TERMINALE_CODES.find((c) => humanError({ code: c }) === j.lastError);
  return code ? { ...j, terminalCode: code } : j;
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
  if (code === 'upload_timeout' || code === 'enqueue_timeout' || code === 'network_failed')
    return 'Der Upload braucht zu lange. Prüfe deine Verbindung und versuch es erneut.';
  if (code === 'rate_limited') return 'Du hast heute schon einen Bon eingereicht. Morgen geht es weiter.';
  // Server-Alters-Gate beim Einreichen (EXIF-Aufnahmedatum): nicht heilbar durch
  // Wiederholen — dasselbe Foto bleibt gleich alt. Frist positiv nennen.
  if (code === 'bon_too_old') return 'Dieser Bon liegt außerhalb der Frist — wir nehmen Bons der letzten 7 Tage an. Beim nächsten Einkauf lohnt sich das Foto direkt an der Kasse.';
  if (code === 'consent_missing') return 'Bitte bestätige zuerst die Cashback-Einwilligung.';
  if (code === 'konto_erforderlich')
    return 'Mit einem kostenlosen Konto laden wir deinen Bon hoch – deine Belohnung wartet schon.';
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

  // Gast-Merker: ohne ihn wüsste ein späterer Wechsel in ein bestehendes Konto
  // nicht, dass es hier etwas mitzunehmen gibt (Besitznachweis + Dialog).
  if (isEffectivelyAnonymous(auth.currentUser)) await GastBestand.merke(input.uid);

  // Placeholder mirror so the bon shows in history immediately (fire-and-
  // forget — a Firestore write hangs offline). NO human-facing merchantName
  // here: the list derives a status-driven title until the CF resolves the
  // real merchant. Writing "Wird hochgeladen …" as merchantName leaked into
  // the bon TITLE even after the status moved to "Wird geprüft" (Task
  // 86ca5fazh) — status and title contradicted each other.
  void createPendingMirror(input.uid, id).catch((e) => noteMirrorFailure(id, e));

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
  setJob(id, { status: 'queued', attempts: 0, lastError: null, terminal: false, terminalCode: null });
  void processQueue();
}

/** Alle fehlgeschlagenen Jobs erneut anstoßen (manuell — „Alle erneut"-Pill
 *  in „Meine Bons"). Setzt Budget UND terminal zurück, 1:1 wie die
 *  Schwester-Queue (uploadQueue.retryAllFailed). */
export async function retryAllFailedBons() {
  await ensureLoaded();
  let changed = false;
  const uid = aktuelleUid();
  jobs = jobs.map((j) => {
    // Nur die eigenen (sichtbaren) Aufträge — fremde bleiben unangetastet.
    if (j.status !== 'failed' || !darfLaufen(j, uid)) return j;
    changed = true;
    return {
      ...j,
      status: 'queued' as BonJobStatus,
      attempts: 0,
      lastError: null,
      terminal: false,
      terminalCode: null,
    };
  });
  if (changed) {
    emit();
    void persist();
  }
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

/** Kontowechsel läuft: keinen neuen Auftrag starten (ein laufender endet normal). */
export function pausiereBonQueue(): void {
  pausiert = true;
}

export function setzeBonQueueFort(): void {
  pausiert = false;
  void processQueue();
}

/**
 * Hart abgelehnte Aufträge wieder freigeben, sobald ihr Grund behoben ist —
 * z. B. nach der Einwilligung (`consent_missing`) oder nach dem Anlegen eines
 * Kontos (`konto_erforderlich`). Betrifft nur Aufträge, die für die aktuelle
 * uid laufen dürfen.
 */
export async function gesperrteFreigeben(codes: string[]): Promise<void> {
  await ensureLoaded();
  const uid = aktuelleUid();
  let changed = false;
  jobs = jobs.map((j) => {
    if (j.status !== 'failed' || !j.terminal || !j.terminalCode) return j;
    if (!codes.includes(j.terminalCode) || !darfLaufen(j, uid)) return j;
    changed = true;
    return {
      ...j,
      status: 'queued' as BonJobStatus,
      attempts: 0,
      lastError: null,
      terminal: false,
      terminalCode: null,
    };
  });
  if (changed) {
    emit();
    void persist();
  }
  void processQueue();
}

/**
 * Filter für Anzeigen (Meine Bons, Prüfseite): nur Aufträge, die für die
 * angemeldete uid laufen dürfen. Aufträge einer anderen Person am selben
 * Gerät oder einer noch nicht bestätigten Übernahme erscheinen nicht als eigene.
 */
export function sichtbareBonJobs(liste: BonJob[]): BonJob[] {
  const uid = aktuelleUid();
  return liste.filter((j) => darfLaufen(j, uid));
}

// ─── processing ─────────────────────────────────────────────────────

function pickNext(): BonJob | null {
  // Wartende fremde Aufträge werden übersprungen, nicht als Fehler markiert —
  // so endet die Schleife in processQueue, auch wenn sie liegen bleiben.
  const uid = aktuelleUid();
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].status === 'queued' && darfLaufen(jobs[i], uid)) return jobs[i];
  }
  return null;
}

/** Die Anmeldung hat während des Laufs gewechselt: zurück in die Warteschlange,
 *  ohne einen Versuch zu verbrauchen. Ob und für wen er weiterläuft,
 *  entscheidet pickNext beim nächsten Durchgang. */
function zurueckstellen(jobId: string) {
  setJob(jobId, { status: 'queued', progress: 0, lastError: null });
}

function requeueFailed() {
  const now = Date.now();
  let changed = false;
  jobs = jobs.map((j) => {
    if (j.status !== 'failed' || j.terminal) return j;
    const windowElapsed = !j.lastAttemptAt || now - j.lastAttemptAt > RETRY_WINDOW_MS;
    if (j.attempts >= MAX_AUTO_ATTEMPTS && !windowElapsed) return j;
    changed = true;
    // Ruhefenster abgelaufen → Budget auffrischen, sonst nur re-queuen.
    return {
      ...j,
      status: 'queued' as BonJobStatus,
      ...(j.attempts >= MAX_AUTO_ATTEMPTS ? { attempts: 0 } : {}),
    };
  });
  if (changed) {
    emit();
    void persist();
  }
}

function scheduleRetry(attempts: number) {
  // Exponentiell (10/20/40/80/160 s, Deckel 5 min) statt linear — vorher
  // war MAX_RETRY_DELAY_MS unerreichbar und das Budget in ~100 s verbrannt.
  const delay = Math.min(MAX_RETRY_DELAY_MS, 10_000 * 2 ** Math.max(0, attempts - 1));
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    requeueFailed();
    void processQueue();
  }, delay);
}

/** Mirror-Write-Fehler NICHT verschlucken: loggen + am Job markieren, damit
 *  die Queue-Anzeige in „Meine Bons" den Job trotzdem sichtbar macht. */
function noteMirrorFailure(jobId: string, e: any) {
  console.warn('[bonQueue] mirror write failed', jobId, e?.message);
  const j = getJob(jobId);
  if (j && !j.mirrorFailed) setJob(jobId, { mirrorFailed: true });
}

async function runJob(job: BonJob) {
  // Umschreiben NUR bei einer vom Server bestätigten Übernahme (Gast → Konto).
  // storage.rules verlangt request.auth.uid == userId, der Auftrag muss also
  // unter der neuen uid hochladen. Den Platzhalter der alten uid räumt der
  // Server bei der Übernahme auf — hier wird dort nichts mehr geschrieben.
  const currentUid = aktuelleUid();
  if (!currentUid || !darfLaufen(job, currentUid)) return; // pickNext filtert schon
  if (job.uid !== currentUid) {
    console.log('[bonQueue] bestätigte Übernahme — Auftrag zieht ins Konto', job.id);
    setJob(job.id, { uid: currentUid });
    job = { ...job, uid: currentUid };
    void createPendingMirror(currentUid, job.id).catch((e) => noteMirrorFailure(job.id, e));
  }

  setJob(job.id, { status: 'uploading', progress: 0, lastError: null });
  // Reset the mirror status back to 'uploading' (a previous fail may have left
  // it 'upload_failed'). Fire-and-forget.
  void setPendingMirrorProgress(job.uid, job.id, 0).catch((e) => noteMirrorFailure(job.id, e));

  try {
    const prepared = await prepareForUpload(job.imageUri, 2000, job.width, job.height);
    // Sicherheitsnetz-Fall (Datei war > Upload-Limit und wurde eben doch
    // skaliert): Hash der TATSÄCHLICH hochgeladenen Bytes nachziehen —
    // Server-Dedup + Forensik vergleichen capture.hash gegen den Upload.
    let effectiveHash = job.hash;
    if (prepared.resized && prepared.uri !== job.imageUri) {
      const { hashImageFile } = await import('@/lib/utils/cashbackImage');
      const rehashed = await hashImageFile(prepared.uri);
      if (rehashed) {
        effectiveHash = rehashed;
        setJob(job.id, { hash: rehashed });
      }
    }

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

    // Kontowechsel während des Hochladens: nicht mit fremdem Token einreichen.
    if (aktuelleUid() !== job.uid) {
      zurueckstellen(job.id);
      return;
    }
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
      bytesHash: effectiveHash,
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
    // Fehlschlag, weil die Anmeldung mitten im Lauf gewechselt hat: kein
    // Versuch verbraucht, der Auftrag wartet auf seine uid oder die Übernahme.
    if (aktuelleUid() !== job.uid) {
      zurueckstellen(job.id);
      return;
    }
    // Fehlerklassen trennen (86cb6tx29): harte Server-Ablehnungen sind mit
    // Wiederholen NICHT heilbar — sie verbrennen kein Budget und werden
    // nicht auto-retried (consent_missing braucht die Einwilligung des
    // Nutzers, rate_limited löst sich erst am Folgetag). Manueller Retry
    // (retryBonJob / retryAllFailedBons) setzt terminal zurück,
    // gesperrteFreigeben gibt gezielt nach terminalCode frei.
    const code = e?.code as string | undefined;
    const terminal = !!code && TERMINALE_CODES.includes(code);
    const prevAttempts = getJob(job.id)?.attempts ?? job.attempts;
    const attempts = terminal ? prevAttempts : prevAttempts + 1;
    const human = humanError(e);
    setJob(job.id, {
      status: 'failed',
      attempts,
      lastError: human,
      lastAttemptAt: Date.now(),
      ...(terminal ? { terminal: true, terminalCode: code } : {}),
    });
    // Persist failure to the mirror so history/other screens don't show a
    // forever-"uploading" zombie (fire-and-forget — hangs offline).
    void setPendingMirrorError(job.uid, job.id, human).catch((err) => noteMirrorFailure(job.id, err));
    if (!terminal && attempts < MAX_AUTO_ATTEMPTS) scheduleRetry(attempts);
  }
}

export async function processQueue(): Promise<void> {
  await ensureLoaded();
  if (pausiert || processing) return;
  // Don't burn the 60s upload watchdog / enqueue when clearly offline; jobs
  // stay 'queued' and the network listener resumes on reconnect.
  if (!isOnline()) {
    await refreshNetwork();
    if (!isOnline()) return;
  }
  processing = true;
  try {
    let next = pickNext();
    while (next && !pausiert) {
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

// … and as soon as the server confirms a guest → account takeover (waiting
// jobs of that guest uid may now run under the account).
GastUebernahme.beiAenderung(() => kickBonQueue());

// ─── Vor dem Wechsel in ein bestehendes Konto ───────────────────────

/** Offen = noch nicht hochgeladen und nicht endgültig abgelehnt (auch ein
 *  vorübergehend gescheiterter Auftrag, der auf seine Wiederholung wartet). */
function offeneBonsVon(uid: string): number {
  return jobs.filter((j) => j.uid === uid && !(j.status === 'failed' && j.terminal)).length;
}

/**
 * Lädt die Aufträge des NOCH angemeldeten Gastes jetzt hoch, bevor die uid
 * wechselt (Prüfrunden 1+2): danach dürften sie bis zur Server-Übernahme
 * (Stufe 2) nicht mehr laufen, und ein Bon würde womöglich zu alt.
 * Vorübergehend gescheiterte Aufträge werden sofort erneut versucht (auch
 * mit aufgebrauchtem Wiederholungs-Budget) und zählen als offen. Liefert
 * true, sobald nur noch endgültig abgelehnte übrig sind, sonst false nach
 * Ablauf der Zeit.
 */
export async function bonsVorWechselAbarbeiten(uid: string, timeoutMs: number): Promise<boolean> {
  await ensureLoaded();
  let changed = false;
  jobs = jobs.map((j) => {
    if (j.uid !== uid || j.status !== 'failed' || j.terminal) return j;
    changed = true;
    return { ...j, status: 'queued' as BonJobStatus, attempts: 0, lastError: null };
  });
  if (changed) {
    emit();
    void persist();
  }
  void processQueue();
  if (offeneBonsVon(uid) === 0) return true;
  return new Promise<boolean>((resolve) => {
    let erledigt = false;
    const pruefe = () => {
      if (offeneBonsVon(uid) === 0) fertig(true);
    };
    const timer = setTimeout(() => fertig(offeneBonsVon(uid) === 0), timeoutMs);
    function fertig(ok: boolean) {
      if (erledigt) return;
      erledigt = true;
      clearTimeout(timer);
      listeners.delete(pruefe);
      resolve(ok);
    }
    listeners.add(pruefe);
    pruefe();
  });
}
