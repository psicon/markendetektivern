/**
 * Was bedeutet die Antwort von `Notifications.getPermissionsAsync()` für uns?
 *
 * Eine reine Funktion — die EINE Stelle, die aus der Systemauskunft den
 * Zustand macht, mit dem Provider, Einstellungsseite und Token-Diagnose
 * arbeiten.
 *
 * ═══ Der Android-13+-Fall (17.09.2026) ═══
 *
 * expo-notifications meldet unter Android 13+ eine NIE angefragte
 * Benachrichtigungs-Berechtigung als `denied` — nicht als `undetermined`.
 * Grund ist die Reihenfolge in `getPermissionsWithPromiseImplApi33`
 * (NotificationPermissionsModule.kt): der Zweig `!areNotificationsEnabled()
 * → DENIED` greift vor `→ UNDETERMINED`, und ohne erteilte POST_NOTIFICATIONS
 * sind Benachrichtigungen auf Android 13+ immer aus. Bekannt als
 * expo/expo#23908, ohne Fix geschlossen.
 *
 * Folge bis 6.0.17: die App hielt jeden Android-13+-Nutzer für „abgelehnt".
 * Das erklärende Sheet (pushPermissionGate) erschien nie, der Schalter in den
 * Einstellungen schickte nur in die Systemeinstellungen, und ohne Erlaubnis
 * holt die App keinen Token. Gemessen am 17.09.: 7.362 Android-Konten auf
 * 6.0.16/6.0.17 standen auf „keine Erlaubnis beim Start" — gefragt wurde
 * keines davon.
 *
 * Unterscheiden lässt sich das über `canAskAgain`: expo setzt es für eine nie
 * angefragte Berechtigung auf true, nach der ersten Ablehnung auf
 * `shouldShowRequestPermissionRationale` (Android erlaubt genau eine zweite
 * Frage) und nach der zweiten Ablehnung auf false. Solange Android den Dialog
 * noch zeigen würde, ist die Lage für uns „offen" — wie oft wir das Sheet
 * davor zeigen, regelt pushPermissionGate (höchstens 3×, 7 Tage Abstand).
 *
 * Unter Android 12 und älter gibt es keine Laufzeit-Berechtigung: `denied`
 * heißt dort, der Nutzer hat Benachrichtigungen in den Systemeinstellungen
 * abgeschaltet, und keine Abfrage kann das ändern (expo liefert dann
 * `canAskAgain: false`). Die Versionsprüfung macht das zusätzlich explizit.
 */

export type PermissionStatus = 'undetermined' | 'provisional' | 'granted' | 'denied' | 'unknown';

export interface ExpoPermissionAntwort {
  status: string;
  canAskAgain?: boolean;
  ios?: { status?: number } | null;
}

/** Ab dieser API-Stufe fragt Android zur Laufzeit nach (POST_NOTIFICATIONS). */
export const ANDROID_LAUFZEIT_BERECHTIGUNG_AB = 33;

export function berechtigungAusExpo(
  perm: ExpoPermissionAntwort,
  os: string,
  osVersion: number | string | undefined,
): Exclude<PermissionStatus, 'unknown'> {
  if (perm.status === 'granted') return 'granted';

  if (perm.status === 'denied') {
    const api = Number(osVersion);
    const androidMitLaufzeitFrage =
      os === 'android' && Number.isFinite(api) && api >= ANDROID_LAUFZEIT_BERECHTIGUNG_AB;
    return androidMitLaufzeitFrage && perm.canAskAgain === true ? 'undetermined' : 'denied';
  }

  // 3 = UNAuthorizationStatusProvisional. expo wirft ihn mit „noch nicht
  // gefragt" in einen Topf, fachlich ist es das Gegenteil: es wird bereits
  // zugestellt.
  if (perm.ios?.status === 3) return 'provisional';
  return 'undetermined';
}

/** Kommen Nachrichten bei diesem Zustand an (laut oder leise)? */
export function wirdZugestellt(status: PermissionStatus): boolean {
  return status === 'granted' || status === 'provisional';
}

/**
 * Ablauf „Nutzer schaltet Nachrichten ein" — GENAU EINE Systemabfrage.
 *
 * `fragen` ist der Einwilligungsweg, der auch den FCM-Token holt
 * (`harteBerechtigungAnfragen`). `expoWegEinrichten` ist
 * `pushNotificationService.initialize`, das bei fehlender Erlaubnis selbst
 * noch einmal fragt — deshalb läuft es nur mit Erlaubnis. Bis 17.09.2026 lief
 * es immer: nach einer Ablehnung erschien der Android-Dialog sofort ein
 * zweites Mal, und eine zweite Ablehnung ist unter Android endgültig.
 */
export async function einschaltenMitEinerFrage(schritte: {
  aktuellerStand: PermissionStatus;
  fragen: () => Promise<boolean>;
  expoWegEinrichten: () => Promise<void>;
  standNeuLesen: () => Promise<PermissionStatus>;
}): Promise<PermissionStatus> {
  const erteilt = schritte.aktuellerStand === 'granted' || (await schritte.fragen());
  if (erteilt) await schritte.expoWegEinrichten();
  return schritte.standNeuLesen();
}
