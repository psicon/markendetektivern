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
import {
  getActiveCashbackCampaigns,
  getActiveCashbackCampaignsStrict,
  getCashbackConfig,
  getCashbackConfigStrict,
} from '@/lib/services/cashbackService';
import {
  pickProductCampaign,
  resolveSubmitCampaign,
  type ActiveProductCampaign,
  type CampaignResolveState,
  type SubmitCampaignResolution,
} from '@/lib/services/productCampaignPick';
import { getChosenProductCampaignId } from '@/lib/services/productCampaignChoice';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Unsubscribe,
} from '@react-native-firebase/firestore';
import { putFile, ref as storageRef } from '@react-native-firebase/storage';
import journeyTrackingService from '@/lib/services/journeyTrackingService';
import type { CaptureContext, ClientVersion } from '@/lib/services/captureContext';

// ─── Step config ────────────────────────────────────────────────────

export type ProductPhotoStep =
  | 'front'
  | 'rueckseite'
  | 'hersteller'
  | 'ean'
  | 'naehrwerte'
  | 'zutaten'
  | 'preis';

/** Capture mode per step:
 *  - 'photo'    plain camera (whole 3D product).
 *  - 'document' live readability assist (BonScanner with rawCapture) —
 *               live overlay + "näher/lesbar" hint for text panels, but
 *               saves a NORMAL photo (no deskew/crop), ideal for labels.
 *  - 'barcode'  live EAN/barcode scanner. */
export type ProductCaptureMode = 'photo' | 'document' | 'barcode';

export interface ProductPhotoStepDef {
  key: ProductPhotoStep;
  label: string;
  hint: string;
  icon: string; // MaterialCommunityIcons name
  mode: ProductCaptureMode;
}

/** User-defined order: front, back, manufacturer, EAN, nutrition,
 *  ingredients, price (market is chosen separately at session start). */
export const PRODUCT_PHOTO_STEPS: ProductPhotoStepDef[] = [
  { key: 'front', label: 'Produktfront', hint: 'Vorderseite — Produktname gut lesbar.', icon: 'package-variant-closed', mode: 'photo' },
  { key: 'rueckseite', label: 'Rückseite', hint: 'Rückseite der Verpackung.', icon: 'package-variant', mode: 'photo' },
  { key: 'hersteller', label: 'Hersteller', hint: 'Hersteller-/Adressangabe auf der Verpackung.', icon: 'factory', mode: 'document' },
  { key: 'ean', label: 'EAN / Barcode', hint: 'Strichcode in den Rahmen halten.', icon: 'barcode', mode: 'barcode' },
  { key: 'naehrwerte', label: 'Nährwerte', hint: 'Nährwerttabelle vollständig.', icon: 'nutrition', mode: 'document' },
  { key: 'zutaten', label: 'Zutaten', hint: 'Zutatenliste vollständig.', icon: 'format-list-bulleted', mode: 'document' },
  { key: 'preis', label: 'Preisschild', hint: 'Preisschild am Regal.', icon: 'tag', mode: 'document' },
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

/** Sanitize an EAN (or any code) for use inside a storage filename. */
export function sanitizeForFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
}

/**
 * Kurzer, global eindeutiger Token pro Produkt-Einreichung. Wird an JEDEN
 * Bild-Dateinamen gehängt (front_<batch>.jpg, zutaten_<batch>.jpg …), sodass
 * KEIN Basename je über Einreichungen/User hinweg kollidiert. Alle Bilder EINER
 * Einreichung teilen denselben Token → als Set erkennbar / nachordenbar.
 *
 * Schutz gegen Basename-gekeyte Server-Verarbeitung: die Legacy-Storage-Function
 * `optimizeImage` nutzte `path.basename` für ihren Temp-Pfad (/tmp/front.jpg),
 * was bei gleichzeitigen Uploads gleicher Dateinamen Bilder über Accounts hinweg
 * vertauschte (Vorfall 2026-07-03). Eindeutige Basenames machen diese Fehlerklasse
 * strukturell unmöglich — unabhängig davon, welcher Prozess den Basename als
 * Schlüssel verwendet.
 */
export function newImageBatchId(): string {
  const buf = new Uint8Array(8);
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
  fileName?: string,
): string {
  const name = fileName || `${step}.jpg`;
  return `crowduploads/${uid}/${sessionId}/produkt_${index}/images/${name}`;
}

/**
 * Der fachliche Schlüssel einer Einreichung: EIN Produkt-Slot EINER
 * Wizard-Sitzung = EIN Dokument.
 *
 * ═══ Warum das kein `addDoc` mehr sein darf ═══
 *
 * `addDoc` prägt bei jedem Aufruf eine neue Zufalls-ID. Damit wird JEDE
 * Wiederholung zwangsläufig ein zusätzliches Dokument — es gibt keinen
 * Schlüssel, an dem ein zweiter Schreibvorgang scheitern könnte.
 *
 * Gemessen am 10.09.2026: drei Nutzer haben so je 2–3 byteidentische Kopien
 * derselben Einreichung erzeugt (gleicher Session-Ordner, gleicher Slot,
 * gleiches `capturedAt`, nur je ein neuer Bild-Token). Ausgelöst hat es der
 * Einreichen-Knopf, der im ausgelieferten Stand (build 1234, `18b8cb6`) nur
 * gegen unvollständige Fotos gesperrt war und während ≥4 s GPS-Wartezeit plus
 * sieben Dateikopien keinerlei Rückmeldung gab — jeder weitere Tipp startete
 * einen eigenen Lauf. Die 10–13 s zwischen den Kopien sind keine Frist,
 * sondern die Laufzeit EINES Auftrags in der seriellen Warteschlange.
 *
 * Abgelehnt wurde daraufhin jede Kopie, auch die erste korrekte — niemand
 * bekam etwas. Eine Oberflächensperre allein kuriert nur den Auslöser.
 *
 * ═══ Warum ausgerechnet dieser Schlüssel ═══
 *
 * `firestore.rules` erlaubt auf `crowd_uploads` `create`, aber
 * `update, delete: if false`. Eine deterministische ID macht den zweiten
 * Schreibvorgang deshalb zu einem verbotenen `update`: „der erste gewinnt"
 * ist damit SERVERSEITIG erzwungen und hängt nicht an der Disziplin des
 * Clients — auch nicht an der einer künftigen zweiten Aufrufstelle.
 *
 * An den drei echten Vorfällen gegengeprüft: alle Kopien einer Gruppe fallen
 * auf genau einen Schlüssel.
 *
 * ═══ Was die Regel NICHT prüft (ehrlich benannt) ═══
 *
 * `create` prüft die Nutzlast (`data.userId == auth.uid`), NICHT die Dokument-
 * ID. Wer uid, `sessionId` UND Slot-Nummer eines anderen kennt, könnte dessen
 * Slot also vorab besetzen und eine einzelne Einreichung blockieren. Die ID im
 * Regelwerk an die uid zu binden wäre naheliegend — und wäre falsch: die
 * Regeln gelten für ALLE Clients, auch die im Feld, die weiter Zufalls-IDs
 * schreiben. Ein Formatzwang sperrte sie sofort aus, und ein App-Update
 * braucht Wochen.
 *
 * Die praktische Schranke ist stattdessen, dass `sessionId` (12 Bytes Hex)
 * vor der Einreichung bekannt sein müsste. Auf `crypto.getRandomValues`, wo
 * vorhanden; ohne Polyfill fällt `newSessionId` auf `Math.random()` zurück —
 * also KEINE kryptografische Zusage. Der mögliche Schaden ist eine einzelne
 * blockierte Einreichung, kein Geldfluss und kein Datenzugriff (`read` hängt
 * weiter an `data.userId`). Sobald die ID-Bindung gefahrlos möglich ist (alle
 * Clients aktualisiert), gehört sie in die Regeln nachgezogen.
 */
export function productSubmissionDocId(
  uid: string,
  sessionId: string,
  productIndex: number,
): string {
  // Ohne verwertbaren Schlüssel KEINE Idempotenz erzwingen: zwei
  // verschiedene Einreichungen auf derselben ID würden bedeuten, dass die
  // zweite verworfen wird — also genau der Schaden, der hier behoben wird.
  // Eine Dublette ist das kleinere Übel als eine verlorene Einreichung, und
  // die serverseitige Doppel-Regel fängt sie auf.
  const sitzung = String(sessionId ?? '').replace(/[^A-Za-z0-9_-]/g, '');
  const slot = Number(productIndex);
  if (!uid || !sitzung || !Number.isFinite(slot)) {
    console.warn('[productSubmit] kein Slot-Schlüssel möglich — eigene ID', { sessionId, productIndex });
    return `fallback_${newImageBatchId()}${newImageBatchId()}`;
  }
  // Ein Schrägstrich im Schlüssel ergäbe einen verschachtelten Pfad statt
  // einer Dokument-ID — deshalb wird oben gefiltert, nicht gehofft.
  return `${uid}_${sitzung}_${slot}`;
}

// ─── Campaign gating ────────────────────────────────────────────────

export type { ActiveProductCampaign, CampaignResolveState } from './productCampaignPick';

/**
 * ALLE laufenden Produktfoto-Aktionen (Reihenfolge: frühestes Enddatum zuerst,
 * wie `getActiveCashbackCampaigns`). Leer, wenn keine läuft oder Aktionen
 * global aus sind. Der Reward kommt NUR aus der Aktion — kein Hardcode;
 * 0 ist erlaubt (Aktion läuft, definiert aber keinen Betrag pro Datensatz).
 */
export async function getActiveProductCampaigns(): Promise<ActiveProductCampaign[]> {
  try {
    return await getActiveProductCampaignsStrict();
  } catch {
    return [];
  }
}

/**
 * Wie {@link getActiveProductCampaigns}, WIRFT aber bei jedem Lesefehler.
 *
 * Nötig, weil die duldsame Variante „konnte nicht nachsehen" und „es läuft
 * keine Aktion" auf dasselbe leere Array abbildet — und `campaignId: null` im
 * Dokument bedeutet für den Server bis heute „nichts versprochen, nichts
 * gebucht". Verschärfend: `DEFAULT_CASHBACK_CONFIG.campaignsEnabled` ist
 * `false`, live steht `true` — ein Config-Lesefehler kehrt die Wahrheit also um
 * und schaltet die Aktion für diese Sitzung stumm ab (86cbet2nw).
 */
export async function getActiveProductCampaignsStrict(): Promise<ActiveProductCampaign[]> {
  const cfg = await getCashbackConfigStrict();
  if (!cfg.campaignsEnabled) return [];
  const all = await getActiveCashbackCampaignsStrict();
  return all
    .filter((x) => (x.kind ?? 'receipt') === 'product_photos')
    .map((c) => ({
      campaignId: c.id,
      rewardCents:
        typeof c.cashbackPerBonCents === 'number' && c.cashbackPerBonCents > 0 ? c.cashbackPerBonCents : 0,
      title: (typeof c.title === 'string' && c.title.trim()) || c.id,
    }));
}

/**
 * Löst die Aktion im MOMENT DES ABSENDENS auf, statt den beim Öffnen des
 * Wizards geladenen Stand zu verwenden.
 *
 * Zeitlich gedeckelt wie der GPS-Fix: ein Firestore-Read ohne Netz löst auf
 * Android nicht ab (die App läuft dort bewusst ohne Disk-Cache), der
 * Absende-Knopf wäre sonst offline tot. Läuft die Frist ab, gilt der beim
 * Öffnen gemerkte Stand — und `state` hält fest, worauf die Entscheidung beruht.
 */
export async function resolveProductCampaignForSubmit(
  gemerkt: ActiveProductCampaign | null | undefined,
  timeoutMs = 4000,
): Promise<SubmitCampaignResolution> {
  let live: ActiveProductCampaign | null | undefined;
  try {
    const liste = await Promise.race([
      getActiveProductCampaignsStrict(),
      new Promise<undefined>((res) => setTimeout(() => res(undefined), timeoutMs)),
    ]);
    // undefined = Frist abgelaufen, [] = Server sagt „es läuft keine".
    live = liste === undefined ? undefined : pickProductCampaign(liste, await getChosenProductCampaignId());
  } catch {
    live = undefined; // nicht nachsehen können ist nicht dasselbe wie „keine"
  }
  return resolveSubmitCampaign(live, gemerkt);
}

/**
 * Die Aktion, für die JETZT erfasst wird: die vom Nutzer gewählte (Übersicht
 * `/product-submit`), sofern sie noch läuft — sonst die erste. Cashback für
 * Produktdatensätze gibt es nur, während eine Aktion läuft; ohne Aktion wird
 * ohne Vergütung gesammelt (null).
 */
export async function getActiveProductCampaign(): Promise<ActiveProductCampaign | null> {
  const list = await getActiveProductCampaigns();
  if (!list.length) return null;
  return pickProductCampaign(list, await getChosenProductCampaignId());
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
  /** Override the filename (e.g. `ean_4012345678901.jpg` for the EAN step). */
  fileName?: string;
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

  const storagePath = productImagePath(uid, sessionId, index, step, opts?.fileName);
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
  /** Market country (e.g. "Deutschland" / "DE"), for display. */
  marketLand?: string | null;
  productName?: string | null;
  /** Scanned EAN/barcode (null if not captured). */
  ean?: string | null;
  /** Active product-photo campaign this dataset counts toward (null =
   *  collected without cashback). Server is authoritative for the reward. */
  campaignId?: string | null;
  /** Worauf `campaignId` beruht — siehe CampaignResolveState. Fehlt bei Altaufträgen. */
  campaignResolve?: CampaignResolveState | null;
  /** step → storage path */
  images: Partial<Record<ProductPhotoStep, string>>;
  /**
   * Orts-/Zeitkontext aus dem Moment der AUFNAHME (siehe
   * `lib/services/captureContext.ts`). Wird im Wizard erfasst und reist mit
   * dem Warteschlangen-Auftrag mit — hier ihn erst zu lesen wäre falsch,
   * weil diese Funktion beim Flush läuft, nicht beim Einreichen.
   */
  capture?: CaptureContext | null;
  /** App-Version des schreibenden Clients (Rollout messbar machen). */
  clientVersion?: ClientVersion | null;
}

/**
 * Ortsangaben + Lieblingsmarkt für die Einreichung sammeln.
 *
 * Bewusst DENORMALISIERT ins Einreichungs-Dokument: die Auswertung soll
 * nicht pro Datensatz das Nutzerprofil nachladen müssen, und ein später
 * geänderter Lieblingsmarkt darf alte Einreichungen nicht rückwirkend
 * umdeuten — der Wert gehört zum Zeitpunkt der Aufnahme.
 *
 * ZWEI VERSCHIEDENE QUELLEN, absichtlich getrennt gehalten:
 *  - `userLocation` ist die SELBSTAUSKUNFT aus dem Profil (LocationPicker
 *    in edit-profile / Registrierung). Verlässlich, aber nur bei einem
 *    kleinen Teil der Nutzer gesetzt.
 *  - `journeyLocation` ist IP-GELOKALISIERT (ipapi.co) bzw. ein
 *    DACH-Fallback, gerundet auf ~5 km. Sagt, wo das Gerät ins Netz
 *    geht — nicht, wo jemand wohnt oder einkauft.
 * Wer beide in einen Topf wirft, misst Unsinn. Das `source`-Feld bleibt
 * deshalb erhalten.
 *
 * ZEITPUNKT — der Grund für den `capture`-Parameter: Diese Funktion läuft
 * NICHT beim Einreichen, sondern erst beim Flush der persistenten
 * Upload-Warteschlange (`uploadQueue.runJob`). Die überlebt App-Neustarts
 * und wird erst wieder aktiv, wenn `/product-submit` geöffnet wird. Ein
 * offline im Laden aufgenommenes Foto bekäme also die Ortung von später,
 * zuhause. Deshalb wird der Kontext im Wizard erfasst und hier nur noch
 * durchgereicht; die Live-Abfrage ist ausschließlich der Notnagel, wenn
 * kein Aufnahme-Kontext mitgeliefert wurde (Aufträge, die vor diesem
 * Update in der Warteschlange lagen).
 *
 * INTERPRETIERT WIRD HIER NICHTS. Der Client liefert Rohsignale, die
 * Bewertung macht `cloud-functions/crowd-upload-location`. So braucht eine
 * Modelländerung kein App-Update.
 *
 * Nie werfen: fehlende Ortsangaben dürfen eine Einreichung niemals
 * verhindern — es sind Zusatzdaten, kein Pflichtfeld.
 */
async function collectContext(
  uid: string,
  capture: CaptureContext | null,
): Promise<Record<string, any>> {
  const ctx: Record<string, any> = {};

  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const u = (snap.exists() ? snap.data() : {}) as Record<string, any>;

    if (u.favoriteMarket || u.favoriteMarketName) {
      ctx.favoriteMarket = {
        id: u.favoriteMarket ?? null,
        name: u.favoriteMarketName ?? null,
      };
    }
    if (u.location || u.city || u.bundesland) {
      ctx.userLocation = {
        address: u.location ?? null,
        city: u.city ?? null,
        bundesland: u.bundesland ?? null,
      };
    }
  } catch (e) {
    console.warn('[productSubmit] Profil-Kontext nicht lesbar (non-fatal):', e);
  }

  try {
    // Der Aufnahme-Kontext aus dem Wizard hat immer Vorrang — er beschreibt
    // den Moment, um den es geht. Nur wenn er fehlt (Altauftrag aus der
    // Warteschlange), wird der aktuelle Stand als Notnagel gelesen.
    const loc =
      capture?.journeyLocation ?? journeyTrackingService.getCurrentJourneyLocation() ?? null;

    if (loc) {
      // lat/lon sind BEREITS auf ~5 km gerundet — anonymousLocationService
      // rechnet `Math.round(wert * 20) / 20`, bevor der Wert die App
      // überhaupt erreicht. Rasterpunkte, keine Präzisionskoordinaten;
      // `geohash5` ist nichts anderes als `lat_lon` dieser Werte.
      //
      // `city` ist die Stadt des NETZZUGANGS, nicht der Aufenthaltsort:
      // gegen die vier Dokumente mit echtem EXIF-GPS liegt sie 61,7 / 61,7 /
      // 99,5 / 377,2 km daneben, und in 64 Vergleichen mit der
      // Selbstauskunft stimmte sie kein einziges Mal. Verwertbar ist sie
      // ausschließlich auf LANDESEBENE (dort 4 von 4 richtig) — die
      // Bewertung in `crowd-upload-location` nutzt sie auch nur dafür.
      ctx.journeyLocation = {
        lat: typeof loc.lat === 'number' ? loc.lat : null,
        lon: typeof loc.lon === 'number' ? loc.lon : null,
        city: loc.city ?? null,
        geohash5: loc.geohash5 ?? null,
        // 'ip' = echte Geolokalisierung. 'fallback' = DACH-Mittelpunkt
        // (51.15/10.45), weil die IP-Abfrage scheiterte — kein Ort.
        source: loc.source ?? null,
      };
    }

    const jid = capture?.journeyId ?? journeyTrackingService.getCurrentJourneyId();
    if (jid) ctx.journeyId = jid;
  } catch (e) {
    console.warn('[productSubmit] Journey-Kontext nicht lesbar (non-fatal):', e);
  }

  // Rohsignale der Aufnahme — unverändert, uninterpretiert. `gpsStatus`
  // wird auch ohne GPS geschrieben: ohne ihn ist „Nutzer hat abgelehnt"
  // nicht von „alte App-Version" zu unterscheiden, und die Abdeckung der
  // Standortfreigabe bliebe unmessbar.
  if (capture) {
    ctx.capture = {
      capturedAt: new Date(capture.capturedAt),
      gpsStatus: capture.gpsStatus,
      ...(capture.gps
        ? {
            gps: {
              lat: capture.gps.lat,
              lon: capture.gps.lon,
              accuracyM: capture.gps.accuracyM,
              fixAt: new Date(capture.gps.fixAt),
            },
          }
        : {}),
      ...(capture.confirmedPlace ? { confirmedPlace: capture.confirmedPlace } : {}),
    };
  }

  return ctx;
}

/** RNFirebase meldet den Regelverstoß als `firestore/permission-denied`. */
function istZugriffVerweigert(e: any): boolean {
  return String(e?.code ?? '').includes('permission-denied');
}

/**
 * Liegt das Dokument wirklich schon? Mit Zeitdeckel, weil ein Firestore-Read
 * ohne Netz auf Android nie auflöst (die Disk-Persistenz ist dort bewusst
 * abgeschaltet, siehe CLAUDE.md). Ein Lesefehler ist KEINE Aussage über die
 * Einreichung: dann bleibt der Auftrag lieber in der Warteschlange liegen und
 * wird sichtbar wiederholt, statt still als erledigt zu gelten.
 */
async function liegtSchonVor(ref: any, timeoutMs = 8000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snap = await Promise.race([
      getDoc(ref),
      new Promise<undefined>((res) => {
        timer = setTimeout(() => res(undefined), timeoutMs);
      }),
    ]);
    return snap !== undefined && (snap as any).exists();
  } catch {
    return false;
  } finally {
    // Sonst hängt der Timer noch Sekunden nach der Antwort — im Test als
    // offener Handle sichtbar, im Betrieb als unnötig wach gehaltener Timer.
    if (timer) clearTimeout(timer);
  }
}

export async function submitProduct(
  uid: string,
  input: ProductSubmissionInput,
): Promise<string> {
  if (!auth.currentUser) throw codeErr('not_authenticated');
  const context = await collectContext(uid, input.capture ?? null);
  const id = productSubmissionDocId(uid, input.sessionId, input.productIndex);
  const ref = doc(db, 'crowd_uploads', id);
  try {
    await setDoc(ref, {
      userId: uid,
      sessionId: input.sessionId,
      productIndex: input.productIndex,
      marketId: input.marketId ?? null,
      marketName: input.marketName ?? null,
      marketLand: input.marketLand ?? null,
      productName: input.productName ?? null,
      ean: input.ean ?? null,
      campaignId: input.campaignId ?? null,
      ...(input.campaignResolve ? { campaignResolve: input.campaignResolve } : {}),
      images: input.images,
      stepCount: Object.keys(input.images).length,
      status: 'pending',
      ...(input.clientVersion ? { clientVersion: input.clientVersion } : {}),
      ...context,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (e: any) {
    // Der Slot ist schon geschrieben → die Regeln lehnen den zweiten Versuch
    // als `update` ab. Das IST der Duplikat-Schutz, kein Fehler.
    //
    // Ein echtes `permission-denied` (abgelaufene Anmeldung, fremdes Dokument
    // auf demselben Pfad) darf dagegen NIEMALS als Erfolg durchgehen — sonst
    // verschwände eine Einreichung lautlos, und genau dieses Muster hat schon
    // einmal „144 freigegeben, 0 Cent ausgezahlt" erzeugt. Deshalb wird
    // nachgesehen, ob das Dokument wirklich da ist; nur dann gilt es als
    // erledigt.
    if (!istZugriffVerweigert(e) || !(await liegtSchonVor(ref))) throw e;
    console.log('[productSubmit] Slot war schon eingereicht — kein zweites Dokument:', id);
  }
  return id;
}

// ─── Read (overview) ────────────────────────────────────────────────

export interface ProductSubmissionEntry {
  id: string;
  sessionId?: string;
  productIndex?: number;
  marketId?: string | null;
  marketName?: string | null;
  marketLand?: string | null;
  productName?: string | null;
  ean?: string | null;
  campaignId?: string | null;
  images?: Partial<Record<ProductPhotoStep, string>>;
  stepCount?: number;
  status?: 'pending' | 'approved' | 'rejected';
  createdAt?: any;
  // Freigabe-Metadaten (86cbam5ep): maschinenlesbare Gründe aus der Review-
  // Runde; `reviewNote` ist interner Freitext und wird NICHT angezeigt.
  holdReasons?: string[];
  rejectReason?: string | null;
  reviewedAt?: any;
  rewardSkipped?: boolean;
  rewardSkippedReason?: string | null;
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
