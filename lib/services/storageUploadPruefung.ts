/**
 * Ist ein Storage-Upload vollständig angekommen? (26.09.2026)
 *
 * ═══ Warum es das braucht ═══
 *
 * firebase-storage 22.0.1 auf Android (über RNFB 23.8.8, BoM 34.10.0) lädt in
 * Blöcken hoch (256 KiB, 512 KiB, 1 MiB …). Scheitert ausgerechnet der Block
 * mit dem Dateiende kurz (Funkloch, 5xx), schickt das SDK beim internen
 * Neuversuch nur noch 256 KiB — aber mit „Datei ist fertig". Der Server
 * schließt die Datei ab, das SDK meldet Erfolg. Ergebnis: Objekte mit exakt
 * 512 KiB bzw. 1 MiB ohne JPEG-Ende (9 Produktfotos und 2 Bons seit 12.08.,
 * nur Android). Upstream: firebase/firebase-android-sdk#8614, in keinem Release.
 *
 * Die Erfolgsmeldung beweist also nichts. Der Abschluss-Snapshot trägt aber die
 * Größe, die der SERVER gespeichert hat (`metadata.size`) — die vergleichen wir
 * mit der lokalen Datei. Zusätzlich reist die lokale Größe als
 * `customMetadata.clientSize` mit, damit auch der Server Altbestände und
 * alte App-Stände nachprüfen kann.
 *
 * ═══ Regeln ═══
 *
 * - Abweichung → Fehler mit code `upload_unvollstaendig`. Der Code ist bewusst
 *   NICHT endgültig: die Warteschlangen versuchen es mit Wartezeit erneut.
 * - Die lokale Größe gilt nur für echte Dateien (`file://`, absoluter Pfad).
 *   `ph://`/`assets-library://` wandelt RNFB auf iOS vor dem Upload um (HEIC →
 *   JPEG); dort wiche die Größe immer ab und der Upload käme nie durch.
 * - Nicht prüfbar ist NICHT „kaputt": durchlassen und warnen. Eine Prüfung,
 *   die im Zweifel sperrt, blockierte jeden Upload, sobald eine SDK-Version
 *   `metadata.size` einmal nicht liefert.
 *
 * ═══ Für Server und Überwachung ═══
 *
 * - `clientSize` ist eine Angabe des Clients und lässt sich fälschen: nur als
 *   Messwert verwenden, nie als Freigabe- oder Ausnahmegrund. Ob eine Datei
 *   abgeschnitten ist, belegt der Server selbst (Endmarke, 256-KiB-Vielfaches).
 * - Ein Bon-Objekt mit `clientSize` ≠ Größe ist ein Upload, den die App erkannt
 *   und unter neuem Namen wiederholt hat — kein neuer Ausfall. Es bleibt
 *   liegen, weil storage.rules das Löschen nicht erlaubt. Echte Treffer sind
 *   abgeschnittene Objekte ohne `clientSize` (alte App) oder solche, auf die
 *   ein Bon bzw. eine Einreichung verweist. Produktfotos überschreibt der
 *   Neuversuch unter demselben Pfad; dort bleibt keine Spur.
 */
import * as FileSystem from 'expo-file-system';

export const UPLOAD_UNVOLLSTAENDIG = 'upload_unvollstaendig';

/** Die Felder des RNFB-Abschluss-Snapshots, die hier zählen. Locker typisiert:
 *  je nach Plattform und Version fehlen sie oder kommen als 0/-1. */
export interface AbschlussSnapshot {
  bytesTransferred?: unknown;
  totalBytes?: unknown;
  metadata?: { size?: unknown } | null;
}

export type UploadBefund =
  | { vollstaendig: true; grundlage: 'server' | 'fortschritt' | 'ungeprueft' }
  | {
      vollstaendig: false;
      grundlage: 'server' | 'fortschritt';
      erwartetBytes: number;
      angekommenBytes: number;
    };

export interface UploadMetadaten {
  contentType: string;
  customMetadata?: { clientSize: string };
}

export interface UploadPruefung {
  /** Lokale Dateigröße in Bytes, null = nicht ermittelbar. */
  lokaleBytes: number | null;
  /** Metadaten für `putFile` (contentType + clientSize, falls bekannt). */
  metadata: UploadMetadaten;
  /** Im complete-Callback aufrufen: null = vollständig oder nicht prüfbar,
   *  sonst der Fehler, mit dem der Upload scheitern soll. */
  pruefeAbschluss(snap: AbschlussSnapshot | null | undefined): Error | null;
}

function positiveZahl(wert: unknown): number | null {
  const n = typeof wert === 'string' ? Number(wert) : wert;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Reine Bewertung des Abschlusses.
 *
 * 1. Lokale Größe und Servergröße bekannt → sie müssen gleich sein.
 * 2. Sonst Fortschritt: nur „weniger übertragen als gesamt" ist das
 *    Abschneide-Muster. Mehr als gesamt ist kein Datenverlust und wird nicht
 *    als Fehler gewertet.
 * 3. Sonst nicht prüfbar → durchlassen.
 */
export function bewerteUploadAbschluss(
  lokaleBytes: number | null,
  snap: AbschlussSnapshot | null | undefined,
): UploadBefund {
  const lokal = positiveZahl(lokaleBytes);
  const server = positiveZahl(snap?.metadata?.size);
  if (lokal !== null && server !== null) {
    return lokal === server
      ? { vollstaendig: true, grundlage: 'server' }
      : { vollstaendig: false, grundlage: 'server', erwartetBytes: lokal, angekommenBytes: server };
  }

  const gesamt = positiveZahl(snap?.totalBytes);
  const uebertragen = positiveZahl(snap?.bytesTransferred);
  if (gesamt !== null && uebertragen !== null) {
    return uebertragen < gesamt
      ? { vollstaendig: false, grundlage: 'fortschritt', erwartetBytes: gesamt, angekommenBytes: uebertragen }
      : { vollstaendig: true, grundlage: 'fortschritt' };
  }

  return { vollstaendig: true, grundlage: 'ungeprueft' };
}

/**
 * Größe einer lokalen Datei; null für alles, was keine echte Datei ist.
 * Bewusst nicht `getFileSize` (cashbackImage.ts): das meldet 0 statt
 * „unbekannt", filtert keine `ph://`-URIs und zöge Bildbearbeitung, Crypto
 * und react-native in den Produktfoto-Upload.
 */
async function lokaleDateigroesse(uri: string): Promise<number | null> {
  const dateiUri = uri.startsWith('file://') ? uri : uri.startsWith('/') ? `file://${uri}` : null;
  if (!dateiUri) return null;
  try {
    const info = await FileSystem.getInfoAsync(dateiUri, { size: true });
    return info.exists ? positiveZahl(info.size) : null;
  } catch {
    return null;
  }
}

/**
 * Vor `putFile` aufrufen. Liefert die Metadaten für den Upload und die
 * Prüfung für den complete-Callback.
 */
export async function uploadPruefungVorbereiten(
  localUri: string,
  storagePath: string,
  contentType: string,
): Promise<UploadPruefung> {
  const lokaleBytes = await lokaleDateigroesse(localUri);
  const metadata: UploadMetadaten = lokaleBytes
    ? { contentType, customMetadata: { clientSize: String(lokaleBytes) } }
    : { contentType };

  return {
    lokaleBytes,
    metadata,
    pruefeAbschluss(snap) {
      const befund = bewerteUploadAbschluss(lokaleBytes, snap);
      if (befund.vollstaendig) {
        if (befund.grundlage === 'ungeprueft') {
          console.warn('[uploadPruefung] Vollständigkeit nicht prüfbar — durchgelassen', {
            storagePath,
            lokaleBytes,
          });
        }
        return null;
      }
      console.error('[uploadPruefung] Upload unvollständig angekommen', { storagePath, ...befund });
      const fehler: Error & { code?: string; erwartetBytes?: number; angekommenBytes?: number } =
        new Error(UPLOAD_UNVOLLSTAENDIG);
      fehler.code = UPLOAD_UNVOLLSTAENDIG;
      fehler.erwartetBytes = befund.erwartetBytes;
      fehler.angekommenBytes = befund.angekommenBytes;
      return fehler;
    },
  };
}
