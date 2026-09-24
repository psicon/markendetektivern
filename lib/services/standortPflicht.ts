import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';

/**
 * Standortpflicht für das Reward-Programm (Bons, Produktfotos, vergütete
 * Umfragen). Entscheidung 24.09.2026, ab 6.0.20.
 *
 * ═══ Warum es diese Prüfung an den Zielen gibt ═══
 *
 * Bisher fragte nur der Consent-Screen beim ANNEHMEN nach dem Standort.
 * Wer vor August 2026 zugestimmt oder die Freigabe später entzogen hatte,
 * nahm danach ohne sie teil — und der Ort kam nur noch aus der IP-Ortung
 * (Median 60 km daneben). Deshalb prüfen jetzt die Ziele selbst
 * (Bon-Scanner, Foto-Assistent, Umfrage-Sheet) bei jedem Öffnen. Damit ist
 * jeder Einstieg abgedeckt, auch Deep-Links und künftige Knöpfe.
 *
 * ═══ Was „erfüllt" heißt ═══
 *
 * Freigabe erteilt (genau oder ungefähr) UND Ortungsdienste am Gerät an.
 * Ein ausbleibender GPS-Fix im Laden ist KEIN Grund zu sperren — dafür gibt
 * es die Rangfolge Bon-Adresse → GPS → Ortsangabe → IP (serverseitig in
 * `crowd-upload-reward/src/locationGate.js`).
 *
 * ═══ Lesefehler sperren nicht ═══
 *
 * Wirft die Abfrage selbst (praktisch nie), gilt die Pflicht als erfüllt:
 * ein Infrastrukturfehler ist keine Aussage über die Entscheidung des
 * Nutzers. Der Server prüft `capture.gpsStatus` ohnehin noch einmal.
 */
export type StandortPflicht =
  /** Freigabe erteilt, Ortungsdienste an. */
  | 'erfuellt'
  /** Noch nicht gefragt oder erneut fragbar — der Systemdialog kann kommen. */
  | 'fragen'
  /** Abgelehnt, das System fragt nicht mehr — nur über die Einstellungen. */
  | 'einstellungen'
  /** Ortungsdienste am Gerät ausgeschaltet. */
  | 'dienste_aus';

async function diensteAn(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      // Hauptschalter der Ortung, nicht „GPS oder Netzwerk-Anbieter": ein
      // WLAN-Tablet ohne GPS-Chip hätte sonst trotz eingeschalteter Ortung
      // nie Zugang (hasServicesEnabledAsync prüft auf Android nur die Anbieter).
      return (await Location.getProviderStatusAsync()).locationServicesEnabled;
    }
    return await Location.hasServicesEnabledAsync();
  } catch {
    return true;
  }
}

/**
 * Kam eine Absage schneller, als ein Mensch tippen kann, konnte gar kein
 * Dialog erscheinen (etwa ohne Google-Play-Dienste). Nur für den
 * Einschalt-Dialog der Ortungsdienste genutzt — und nur als Abkürzung:
 * ein langsames Gerät landet schlimmstenfalls beim zweiten Tipp in den
 * Einstellungen (siehe `letzteDiensteAbsageMs`), nie in einer Schleife.
 */
const OHNE_DIALOG_MS = 400;
/** Zweiter Tipp nach einer Absage innerhalb dieser Zeit → direkt in die Einstellungen. */
const ZWEITER_TIPP_MS = 2 * 60 * 1000;
let letzteDiensteAbsageMs = 0;

const schlafen = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function pruefeStandortPflicht(): Promise<StandortPflicht> {
  let p: Location.LocationPermissionResponse;
  try {
    p = await Location.getForegroundPermissionsAsync();
  } catch {
    return 'erfuellt';
  }
  // Dienste zuerst: bei global ausgeschalteten Diensten erscheint auf iOS
  // kein Freigabe-Dialog (die Anfrage bliebe unbeantwortet), und iOS meldet
  // die Freigabe dann als „abgelehnt".
  if (!(await diensteAn())) return 'dienste_aus';
  if (p.status === 'granted') return 'erfuellt';
  return p.canAskAgain ? 'fragen' : 'einstellungen';
}

async function einstellungenOeffnen(stand: StandortPflicht): Promise<StandortPflicht | null> {
  // iOS erlaubt nur den Sprung in die App-Einstellungen (Datenschutz-Seiten
  // sind private URLs und führen zur Ablehnung im Review).
  try {
    await Linking.openSettings();
    return null;
  } catch {
    return stand;
  }
}

/** Systemseite der Ortung (Android). NICHT awaiten: RNs sendIntent löst nie auf. */
function ortungsSeiteOeffnen(): null {
  Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => {
    Linking.openSettings().catch(() => {});
  });
  return null;
}

/**
 * Führt den nächsten Schritt aus und liefert den Stand danach — oder `null`,
 * wenn der Nutzer in die Einstellungen gewechselt ist. Dann ändert sich der
 * Stand erst beim Zurückkehren; das fängt `useStandortPflicht` über den
 * AppState ab.
 */
export async function standortPflichtErfuellen(stand: StandortPflicht): Promise<StandortPflicht | null> {
  if (stand === 'erfuellt') return stand;

  if (stand === 'fragen') {
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      // Stand danach frisch lesen — der entscheidet.
    }
    return pruefeStandortPflicht();
  }

  if (stand === 'einstellungen' && Platform.OS === 'android') {
    // Android meldet canAskAgain=false auch nach einem weggetippten
    // Erstdialog oder einer verfallenen „Nur dieses Mal"-Freigabe — dann
    // käme der Dialog noch. Erst versuchen. Entschieden wird am STAND danach,
    // nicht an der Zeit (langsame Geräte brauchen auch ohne Dialog > 400 ms):
    // erteilt → weiter; wieder fragbar → der Dialog lief, Nutzer lehnte ab;
    // weiterhin „einstellungen" → in die Einstellungen, wie der Knopf sagt.
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      // Stand danach frisch lesen — der entscheidet.
    }
    const danach = await pruefeStandortPflicht();
    if (danach !== 'einstellungen') return danach;
    return einstellungenOeffnen(stand);
  }

  if (stand === 'dienste_aus' && Platform.OS === 'android') {
    // Zweiter Tipp kurz nach einer Absage: direkt auf die Systemseite.
    if (letzteDiensteAbsageMs > 0 && Date.now() - letzteDiensteAbsageMs < ZWEITER_TIPP_MS) {
      letzteDiensteAbsageMs = 0;
      return ortungsSeiteOeffnen();
    }
    const t0 = Date.now();
    try {
      // Googles Einschalt-Dialog: ein Tipp, kein Umweg über die Einstellungen.
      await Location.enableNetworkProviderAsync();
      const danach = await pruefeStandortPflicht();
      if (danach !== 'dienste_aus') return danach;
      // Der Anbieter meldet sich nach „OK" manchmal einen Moment verspätet.
      await schlafen(600);
      return pruefeStandortPflicht();
    } catch {
      // Kein Dialog möglich (etwa ohne Play-Dienste) → Systemseite der Ortung.
      if (Date.now() - t0 < OHNE_DIALOG_MS) return ortungsSeiteOeffnen();
      // „Nein danke" im Dialog → nicht ungefragt weiterleiten; ein zweiter
      // Tipp führt direkt auf die Systemseite.
      letzteDiensteAbsageMs = Date.now();
      return pruefeStandortPflicht();
    }
  }

  return einstellungenOeffnen(stand);
}
