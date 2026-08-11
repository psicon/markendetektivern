import * as Location from 'expo-location';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

import journeyTrackingService from '@/lib/services/journeyTrackingService';

/**
 * Sammelt den Orts- und Zeitkontext im Moment der AUFNAHME.
 *
 * ═══ Warum es diesen Service gibt ═══
 *
 * Bis hierher wurde der Kontext erst in `submitProduct` gelesen — und das
 * läuft NICHT beim Einreichen, sondern erst beim Flush der persistenten
 * Upload-Warteschlange (`uploadQueue.runJob`). Die Warteschlange überlebt
 * App-Neustarts und wird erst wieder aktiv, wenn jemand `/product-submit`
 * öffnet. Ein Foto, das gestern im Laden ohne Netz aufgenommen wurde,
 * bekam damit die Ortung von heute, zuhause. Der Kontext muss dort
 * entstehen, wo das Foto entsteht, und mit dem Auftrag mitreisen.
 *
 * ═══ Die Kamera darf nie warten ═══
 *
 * `getCurrentPositionAsync` kann in Innenräumen 30–60 s ohne Fix laufen —
 * genau deshalb wurde GPS im `analyticsService` seinerzeit durch die
 * IP-Ortung ersetzt. Hier wird deshalb zuerst die zuletzt BEKANNTE Position
 * genommen (liegt sofort vor) und eine frische Messung nur im Rennen gegen
 * ein kurzes Zeitlimit versucht. Läuft das Limit ab, wird ohne GPS
 * eingereicht — eine Ortsangabe darf eine Einreichung niemals verzögern
 * oder verhindern.
 *
 * ═══ Dieser Service fragt NIE nach der Berechtigung ═══
 *
 * Er prüft nur, ob sie bereits erteilt ist (`getForegroundPermissionsAsync`
 * fragt nicht nach). Der Systemdialog erscheint auf iOS genau EINMAL im
 * Leben der App — ein „Nein" ist praktisch endgültig und nur noch über die
 * Systemeinstellungen umkehrbar. Dieser eine Versuch gehört an eine Stelle,
 * an der der Nutzer versteht, wofür er gefragt wird, nicht in einen
 * Hintergrundaufruf beim Auslösen der Kamera.
 *
 * ═══ Was hier NICHT passiert ═══
 *
 * Es wird nichts bewertet und nichts interpretiert. Der Client liefert
 * ausschließlich Rohsignale; welche Quelle am Ende gewinnt und wie sicher
 * das ist, entscheidet `cloud-functions/crowd-upload-location`. Das ist
 * Absicht: eine Änderung am Bewertungsmodell braucht damit kein
 * App-Update, und die Bewertung bleibt jederzeit aus den Rohsignalen
 * nachvollziehbar.
 */

/** Kurz genug, dass niemand ein Warten bemerkt. */
const GPS_TIMEOUT_MS = 4000;
/** Ältere Fixes sind für „wo stehe ich gerade" nicht mehr brauchbar. */
const MAX_FIX_ALTER_MS = 10 * 60 * 1000;

export type GpsStatus =
  | 'granted_precise'
  | 'granted_coarse'
  | 'denied'
  | 'not_asked'
  | 'timeout'
  | 'unavailable';

export interface CaptureGps {
  lat: number;
  lon: number;
  accuracyM: number | null;
  fixAt: number;
}

export interface CaptureContext {
  /** Zeitpunkt der Aufnahme — NICHT der des Uploads. */
  capturedAt: number;
  gps: CaptureGps | null;
  /**
   * Warum kein GPS vorliegt, ist genauso wichtig wie das GPS selbst:
   * ohne diesen Wert ist „Nutzer hat abgelehnt" nicht von „alte
   * App-Version" zu unterscheiden, und die Abdeckung wird unmessbar.
   */
  gpsStatus: GpsStatus;
  /** Die vom Nutzer im Wizard bestätigte Ortsangabe, falls vorhanden. */
  confirmedPlace: {
    city?: string | null;
    bundesland?: string | null;
    land?: string | null;
    lat?: number | null;
    lon?: number | null;
    accuracyM?: number | null;
  } | null;
  /** Momentaufnahme der Journey-Ortung zur AUFNAHMEZEIT. */
  journeyLocation: {
    lat: number | null;
    lon: number | null;
    city: string | null;
    geohash5: string | null;
    source: string | null;
  } | null;
  journeyId: string | null;
}

export interface ClientVersion {
  app: string | null;
  build: string | null;
  platform: string;
}

/**
 * Liest die App-Version mit. Heute trägt KEIN Dokument in `crowd_uploads`,
 * `users` oder `pushTokens` ein Versionsfeld — dadurch lässt sich weder die
 * Verbreitung eines Updates messen noch unterscheiden, ob ein fehlendes
 * Feld an einer alten App oder an einer Ablehnung liegt.
 */
export function clientVersion(): ClientVersion {
  return {
    app: Application.nativeApplicationVersion ?? null,
    build: Application.nativeBuildVersion ?? null,
    platform: Platform.OS,
  };
}

/** Ob die Standortfreigabe bereits erteilt ist — OHNE nachzufragen. */
export async function standortStatus(): Promise<GpsStatus> {
  try {
    const p = await Location.getForegroundPermissionsAsync();
    if (!p.granted) return p.canAskAgain ? 'not_asked' : 'denied';

    // Android 12+ meldet eine bewusst ungenaue Freigabe direkt.
    if (p.android?.accuracy === 'coarse') return 'granted_coarse';

    // iOS legt die reduzierte Genauigkeit ("Ungefährer Ort") im
    // Permission-Objekt NICHT offen — `ios.scope` sagt nur whenInUse/always.
    // Dort verrät erst der Messwert die Wahrheit: ein reduzierter Fix kommt
    // mit ~1–3 km statt ~10 m zurück. Deshalb wird `accuracyM` immer
    // mitgeschrieben, und die serverseitige Bewertung stuft danach ab.
    // Hier zu raten wäre schlechter als das Feld ehrlich offenzulassen.
    return 'granted_precise';
  } catch {
    return 'unavailable';
  }
}

/**
 * Fordert die Standortfreigabe an — löst also den SYSTEM-DIALOG aus.
 *
 * Bewusst getrennt von `standortStatus()`: Der Dialog erscheint auf iOS
 * genau einmal im Leben der App, ein „Nein" ist danach nur noch über die
 * Einstellungen umkehrbar. Diese Funktion darf deshalb ausschließlich aus
 * einem Moment heraus aufgerufen werden, in dem der Nutzer gerade erklärt
 * bekommen hat, wofür gefragt wird — nie beiläufig aus einem
 * Hintergrundpfad.
 *
 * Wichtig für die Behandlung des Ergebnisses: Wurde früher schon endgültig
 * abgelehnt (`canAskAgain === false`), kehrt der Aufruf SOFORT und ohne
 * jeden sichtbaren Dialog zurück. Wer darauf nicht reagiert, hinterlässt
 * beim Nutzer den Eindruck, der Knopf sei kaputt.
 */
export async function standortAnfordern(): Promise<GpsStatus> {
  try {
    const p = await Location.requestForegroundPermissionsAsync();
    if (!p.granted) return p.canAskAgain ? 'not_asked' : 'denied';
    if (p.android?.accuracy === 'coarse') return 'granted_coarse';
    return 'granted_precise';
  } catch {
    return 'unavailable';
  }
}

async function holeGps(status: GpsStatus): Promise<{ gps: CaptureGps | null; status: GpsStatus }> {
  if (status !== 'granted_precise' && status !== 'granted_coarse') {
    return { gps: null, status };
  }

  const alsFix = (p: Location.LocationObject | null): CaptureGps | null => {
    if (!p?.coords || typeof p.coords.latitude !== 'number') return null;
    return {
      lat: p.coords.latitude,
      lon: p.coords.longitude,
      accuracyM: p.coords.accuracy ?? null,
      fixAt: p.timestamp ?? Date.now(),
    };
  };

  try {
    // Zuerst das, was ohne Wartezeit vorliegt.
    const bekannt = alsFix(await Location.getLastKnownPositionAsync({}));
    if (bekannt && Date.now() - bekannt.fixAt <= MAX_FIX_ALTER_MS) {
      return { gps: bekannt, status };
    }

    // Sonst eine frische Messung — aber nur gegen die Uhr. Der Timer wird
    // danach ausdrücklich abgeräumt: gewinnt die Messung das Rennen, bliebe
    // er sonst bis zum Ablauf am Leben und hielte die Ereignisschleife auf.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frisch = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(alsFix),
      new Promise<null>((r) => {
        timer = setTimeout(() => r(null), GPS_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    if (frisch) return { gps: frisch, status };

    // Ein veralteter Fix ist besser als nichts — sein Alter steht in
    // `fixAt`, die Bewertung stuft ihn serverseitig entsprechend herab.
    if (bekannt) return { gps: bekannt, status };
    return { gps: null, status: 'timeout' };
  } catch {
    return { gps: null, status: 'unavailable' };
  }
}

/**
 * Erfasst den Kontext zum Aufnahme-/Einreichzeitpunkt.
 *
 * Wirft nie: fehlende Ortsangaben sind Zusatzdaten und dürfen eine
 * Einreichung unter keinen Umständen blockieren.
 */
export async function erfasseCaptureContext(opts?: {
  capturedAt?: number;
  confirmedPlace?: CaptureContext['confirmedPlace'];
}): Promise<CaptureContext> {
  const capturedAt = opts?.capturedAt ?? Date.now();
  const basis: CaptureContext = {
    capturedAt,
    gps: null,
    gpsStatus: 'unavailable',
    confirmedPlace: opts?.confirmedPlace ?? null,
    journeyLocation: null,
    journeyId: null,
  };

  try {
    const status = await standortStatus();
    const { gps, status: endStatus } = await holeGps(status);
    basis.gps = gps;
    basis.gpsStatus = endStatus;
  } catch (e) {
    console.warn('[captureContext] Standort nicht ermittelbar (non-fatal):', e);
  }

  try {
    const loc = journeyTrackingService.getCurrentJourneyLocation();
    if (loc) {
      basis.journeyLocation = {
        lat: typeof loc.lat === 'number' ? loc.lat : null,
        lon: typeof loc.lon === 'number' ? loc.lon : null,
        city: loc.city ?? null,
        geohash5: loc.geohash5 ?? null,
        source: loc.source ?? null,
      };
    }
    basis.journeyId = journeyTrackingService.getCurrentJourneyId() ?? null;
  } catch (e) {
    console.warn('[captureContext] Journey-Kontext nicht lesbar (non-fatal):', e);
  }

  return basis;
}
