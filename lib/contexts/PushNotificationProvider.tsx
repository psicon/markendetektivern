import { wireFcmNotificationTaps } from '@/lib/services/fcmDeepLinks';
import { pushNotificationService } from '@/lib/services/pushNotificationService';
import {
  abgleichenMitServer,
  getPushPreference,
  setPushPreference,
} from '@/lib/services/pushPreference';
import * as Notifications from 'expo-notifications';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAuth } from './AuthContext';

type PermissionStatus = 'undetermined' | 'granted' | 'denied' | 'unknown';

interface PushNotificationContextType {
  /**
   * Bekommt der Nutzer Nachrichten? Nur wahr, wenn BEIDES stimmt: das
   * System erlaubt es UND der Nutzer hat nicht abbestellt.
   *
   * Bis 08.09.2026 stand hier allein die Systemberechtigung. Wer den
   * Schalter ausschaltete, sah ihn beim nächsten Wechsel in den
   * Vordergrund wieder auf AN — `refreshPermissionStatus` überschrieb den
   * Wunsch des Nutzers mit dem, was iOS gerade sagte (86cbfdq5j).
   */
  isEnabled: boolean;
  /**
   * 'undetermined' = User wurde noch nie gefragt → System-Dialog erscheint
   * beim ersten `enablePushNotifications()`-Call. 'granted'/'denied'
   * heißt der User hat schon entschieden. 'unknown' = noch nicht geladen.
   */
  permissionStatus: PermissionStatus;
  /** Der Wunsch des Nutzers, unabhängig von der Systemberechtigung. */
  userPreference: boolean;
  pushToken: string | null;
  enablePushNotifications: () => Promise<void>;
  disablePushNotifications: () => Promise<void>;
  sendTestNotification: () => Promise<void>;
  refreshPermissionStatus: () => Promise<void>;
}

const PushNotificationContext = createContext<PushNotificationContextType | undefined>(undefined);

export const usePushNotifications = () => {
  const context = useContext(PushNotificationContext);
  if (!context) {
    throw new Error('usePushNotifications must be used within PushNotificationProvider');
  }
  return context;
};

interface PushNotificationProviderProps {
  children: React.ReactNode;
}

export const PushNotificationProvider: React.FC<PushNotificationProviderProps> = ({ children }) => {
  const { user, userProfile } = useAuth();
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('unknown');
  const [userPreference, setUserPreference] = useState(true);
  const [pushToken, setPushToken] = useState<string | null>(null);
  /**
   * Zähler für jede bewusste Entscheidung des Nutzers.
   *
   * Der Abgleich mit dem Server ist asynchron und kann jederzeit feuern —
   * `userProfile` wird bei jedem `refreshUserProfile()` neu erzeugt, und das
   * hängt global am Achievement-Rückruf. Legt jemand den Schalter um,
   * während ein Abgleich unterwegs ist, träfe dessen späte Antwort mit dem
   * Wert von VOR dem Umschalten ein und stellte den Schalter zurück. Der
   * Nutzer tippt dann erneut — und abonniert sich damit versehentlich
   * wieder. Genau diese Klasse (später Rückruf gegen gewechselten Kontext)
   * verlangt laut CLAUDE.md einen monotonen Zähler vor jedem setState.
   */
  const schaltEpoche = useRef(0);

  // Zwei getrennte Fragen, bewusst zwei getrennte Zustände:
  //   permissionStatus — DÜRFEN wir? (Auskunft des Betriebssystems)
  //   userPreference   — WILL er? (Entscheidung des Nutzers, von uns
  //                      gespeichert und vom Server gelesen)
  // Der Schalter zeigt die Und-Verknüpfung.
  const isEnabled = permissionStatus === 'granted' && userPreference;

  // Initial Setup wenn User sich ändert
  useEffect(() => {
    if (user?.uid) {
      checkPushStatus();
    }
  }, [user?.uid]);

  // Schritt 1: der lokale Stand, sofort — damit der Schalter beim Öffnen
  // der Seite nicht erst auf AN steht und dann umspringt. Gilt auch ohne
  // angemeldeten Nutzer.
  useEffect(() => {
    void getPushPreference().then(setUserPreference);
  }, []);

  // Schritt 2: mit dem Server abgleichen, sobald das Profil geladen ist.
  //
  // Der Serverwert kommt aus dem ohnehin geladenen `userProfile` — kein
  // zusätzlicher Firestore-Zugriff. Ohne diesen Abgleich gäbe es einen
  // stillen Totalausfall: wer auf einem Gerät abbestellt und die App auf
  // einem zweiten neu installiert, sähe dort „Aktiv" bei einem Server, der
  // dauerhaft nichts mehr sendet — und hätte keinen Anlass, etwas dagegen
  // zu tun. Ein offener eigener Umschaltvorgang gewinnt (siehe
  // pushPreference.ts).
  useEffect(() => {
    if (!user?.uid || !userProfile) return;
    const meine = schaltEpoche.current;
    void abgleichenMitServer(
      user.uid,
      (userProfile as { pushNotificationsEnabled?: boolean }).pushNotificationsEnabled,
    ).then((wert) => {
      // Hat der Nutzer zwischenzeitlich selbst geschaltet, ist diese
      // Antwort überholt und wird verworfen.
      if (schaltEpoche.current === meine) setUserPreference(wert);
    });
  }, [user?.uid, userProfile]);

  // Cold-Start: wenn die App durch eine Push-Notification geöffnet
  // wurde, holen wir den Response NACH dem ersten Mount nach und
  // routen den User. Einmal kurz warten damit der Root-Navigator
  // mounted ist.
  //
  // 86cb7gfc9: FCM-Pushes werden von @react-native-firebase/messaging
  // zugestellt — expo-notifications sieht deren Taps NIE. Deshalb hier
  // zusätzlich die RNFB-Kanäle verdrahten (Hintergrund-Tap + Cold Start),
  // im selben 500-ms-Fenster.
  useEffect(() => {
    let cleanupFcmTaps: (() => void) | undefined;
    // 86cbfdq5j: Die rote Zahl am App-Symbol beim Start räumen. Deckt den
    // Fall ab, dass die App aus dem beendeten Zustand geöffnet wurde —
    // egal ob über das Symbol oder über die Nachricht selbst. Sofort, nicht
    // erst nach den 500 ms: das Symbol ist zu diesem Zeitpunkt schon sichtbar.
    void pushNotificationService.clearBadge();
    const t = setTimeout(() => {
      void pushNotificationService.handleColdStartNotification();
      void wireFcmNotificationTaps().then((cleanup) => {
        cleanupFcmTaps = cleanup;
      });
    }, 500);
    return () => {
      clearTimeout(t);
      cleanupFcmTaps?.();
    };
  }, []);

  // Permission-Status auch refreshen wenn User aus den iOS-Settings
  // zurückkommt (z.B. nach manueller Aktivierung). AppState-Listener
  // fängt das ab.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        void refreshPermissionStatus();
        // Zweiter Teil des Badge-Fixes: der Weg aus dem Hintergrund
        // zurück in die App. Das ist der Moment, in dem jemand die
        // Nachricht antippt — und damit der richtige Zeitpunkt, die Zahl
        // wieder auf 0 zu setzen. Absichtlich HIER und nicht zusätzlich in
        // den Tap-Handlern (fcmDeepLinks): jeder Tap führt über genau
        // diesen Zustandswechsel, ein zweiter Aufrufer wäre eine zweite
        // Stelle für dieselbe Aufgabe.
        void pushNotificationService.clearBadge();
      }
    });
    return () => sub.remove();
  }, []);

  /**
   * Nur die Systemberechtigung nachschlagen. Fasst `userPreference`
   * BEWUSST nicht an — genau das war der Fehler, der den Schalter
   * zurückspringen ließ.
   */
  const refreshPermissionStatus = async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      const mapped: PermissionStatus =
        status === 'granted' ? 'granted'
          : status === 'denied' ? 'denied'
          : 'undetermined';
      setPermissionStatus(mapped);
      if (mapped === 'granted') {
        setPushToken(pushNotificationService.getPushToken());
      } else {
        setPushToken(null);
      }
    } catch (e) {
      console.warn('[push-provider] refreshPermissionStatus failed', e);
      setPermissionStatus('unknown');
    }
  };

  const checkPushStatus = async () => {
    await refreshPermissionStatus();
  };

  const enablePushNotifications = async () => {
    if (!user?.uid) {
      console.warn('[push-provider] no user');
      return;
    }
    try {
      // Erst den Wunsch festhalten, dann die Technik. Bricht die
      // Registrierung ab (Berechtigung verweigert), bleibt der Wunsch
      // trotzdem gespeichert — der Schalter zeigt dann korrekt AUS, weil
      // die Berechtigung fehlt, und greift von selbst, sobald der Nutzer
      // sie in den Systemeinstellungen erteilt.
      schaltEpoche.current += 1;
      await setPushPreference(user.uid, true);
      setUserPreference(true);
      await pushNotificationService.initialize(user.uid);
      await refreshPermissionStatus();
    } catch (error) {
      console.error('[push-provider] enable failed:', error);
    }
  };

  const disablePushNotifications = async () => {
    try {
      // Reihenfolge: erst speichern, dann anzeigen. Andersherum liest ein
      // Effekt, den das Umschalten weckt, noch den alten Wert (dieselbe
      // Falle wie beim Coachmark-Dismiss, siehe CLAUDE.md).
      schaltEpoche.current += 1;
      await setPushPreference(user?.uid ?? null, false);
      setUserPreference(false);
      await pushNotificationService.disable();
      setPushToken(null);
    } catch (error) {
      console.error('[push-provider] disable failed:', error);
    }
  };

  const sendTestNotification = async () => {
    await pushNotificationService.sendTestBroadcast();
  };

  const value: PushNotificationContextType = {
    isEnabled,
    permissionStatus,
    userPreference,
    pushToken,
    enablePushNotifications,
    disablePushNotifications,
    sendTestNotification,
    refreshPermissionStatus,
  };

  return (
    <PushNotificationContext.Provider value={value}>
      {children}
    </PushNotificationContext.Provider>
  );
};
