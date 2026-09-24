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
    return await Location.hasServicesEnabledAsync();
  } catch {
    return true;
  }
}

export async function pruefeStandortPflicht(): Promise<StandortPflicht> {
  let p: Location.LocationPermissionResponse;
  try {
    p = await Location.getForegroundPermissionsAsync();
  } catch {
    return 'erfuellt';
  }
  if (p.status === 'granted') {
    return (await diensteAn()) ? 'erfuellt' : 'dienste_aus';
  }
  if (p.canAskAgain) return 'fragen';
  // iOS meldet bei global ausgeschalteten Ortungsdiensten „abgelehnt" —
  // dann ist das Einschalten der Dienste der richtige nächste Schritt,
  // nicht die App-Freigabe.
  return (await diensteAn()) ? 'einstellungen' : 'dienste_aus';
}

/**
 * Führt den nächsten Schritt aus und liefert den Stand danach.
 *
 * Nach dem Wechsel in die Einstellungen ändert sich der Stand erst, wenn
 * die App wieder aktiv wird — das fängt `useStandortPflicht` über den
 * AppState ab.
 */
export async function standortPflichtErfuellen(stand: StandortPflicht): Promise<StandortPflicht> {
  if (stand === 'erfuellt') return stand;
  if (stand === 'fragen') {
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      // Stand danach frisch lesen — der entscheidet.
    }
    return pruefeStandortPflicht();
  }
  if (stand === 'dienste_aus' && Platform.OS === 'android') {
    try {
      // Googles Einschalt-Dialog: ein Tipp, kein Umweg über die Einstellungen.
      await Location.enableNetworkProviderAsync();
      return pruefeStandortPflicht();
    } catch {
      // Abgelehnt oder ohne Play-Dienste → Systemseite der Ortung.
      try {
        await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
        return stand;
      } catch {
        // letzter Ausweg unten
      }
    }
  }
  // iOS erlaubt nur den Sprung in die App-Einstellungen (Datenschutz-Seiten
  // sind private URLs und führen zur Ablehnung im Review).
  await Linking.openSettings().catch(() => {});
  return stand;
}
