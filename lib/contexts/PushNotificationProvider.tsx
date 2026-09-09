import { PrePermissionSheet } from '@/components/notifications/PrePermissionSheet';
import { wireFcmNotificationTaps } from '@/lib/services/fcmDeepLinks';
import { harteBerechtigungAnfragen, registerFcmTokenForUser } from '@/lib/services/fcmTokenService';
import {
  darfFragen,
  frageVermerkt,
  ladeStand,
  sitzungBeginnt,
} from '@/lib/services/pushPermissionGate';
import { CoachmarkService } from '@/lib/services/coachmarkService';
import { isAnySheetOpen, isSurveyVisible, onPresentationIdle } from '@/lib/services/sheetPresence';
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

/**
 * `provisional` = still zugestellt, ohne dass je ein Dialog erschien
 * (iOS ab 12). Nachrichten kommen an, aber leise: nur Mitteilungszentrale,
 * kein Banner, kein Ton.
 *
 * WICHTIG: expo meldet diesen Zustand als `undetermined` — die Abbildung
 * `UNAuthorizationStatusProvisional` → granted/denied fehlt dort bewusst
 * (EXUserFacingNotificationsPermissionsRequester.m:38-42). Deshalb lesen wir
 * den genauen iOS-Wert selbst aus `perm.ios.status` (3 = provisorisch).
 * Ohne diese Unterscheidung stünde der Schalter auf AUS, während sehr wohl
 * Nachrichten ankommen.
 */
type PermissionStatus = 'undetermined' | 'provisional' | 'granted' | 'denied' | 'unknown';

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
  /** Das erklärende Sheet vor der einmaligen System-Frage. */
  const [fragesheetOffen, setFragesheetOffen] = useState(false);
  /** Nur EIN Anlauf pro Sitzung, egal wie oft ein Effekt neu läuft. */
  const inDieserSitzungGefragt = useRef(false);

  // Zwei getrennte Fragen, bewusst zwei getrennte Zustände:
  //   permissionStatus — DÜRFEN wir? (Auskunft des Betriebssystems)
  //   userPreference   — WILL er? (Entscheidung des Nutzers, von uns
  //                      gespeichert und vom Server gelesen)
  // Der Schalter zeigt die Und-Verknüpfung.
  // Provisorisch heißt: es kommt an, nur leise. Für „bekommt der Nutzer
  // Nachrichten?" zählt das mit — sonst zeigte der Schalter AUS, während in
  // der Mitteilungszentrale Nachrichten liegen.
  const zugestellt = permissionStatus === 'granted' || permissionStatus === 'provisional';
  const isEnabled = zugestellt && userPreference;

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
    // Sitzung zählen: „zweite Sitzung" ist einer der beiden Auslöser für
    // die harte Frage (pushPermissionGate.ts). Einmal pro App-Start.
    void sitzungBeginnt();
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

  /**
   * Die harte Frage — genau einmal, und nur bei erkennbarem Interesse.
   *
   * Läuft NICHT beim Start, sondern erst wenn der Berechtigungsstand
   * bekannt ist und die Oberfläche zur Ruhe gekommen ist. Der Puffer von
   * vier Sekunden ist kein Schmuck: direkt nach dem Start konkurrieren
   * Coachmarks, Umfragen und der Erst-Fall-Banner um dieselbe Bühne, und
   * zwei gleichzeitig sichtbare Sheets frieren iOS hart ein (CLAUDE.md,
   * 86ca8g2p9).
   */
  useEffect(() => {
    if (permissionStatus === 'unknown') return;
    if (inDieserSitzungGefragt.current) return;
    if (!user?.uid) return;

    let abgebrochen = false;
    const t = setTimeout(() => {
      void (async () => {
        if (abgebrochen || inDieserSitzungGefragt.current) return;
        const stand = await ladeStand();
        const urteil = darfFragen(
          {
            berechtigung:
              permissionStatus === 'granted'
                ? 'erteilt'
                : permissionStatus === 'denied'
                  ? 'abgelehnt'
                  : 'offen',
            // DREI Quellen, weil keine die anderen kennt:
            //  • isAnySheetOpen — die registrierten Sheets
            //  • isSurveyVisible — das Umfrage-Sheet zählt im Zähler
            //    bewusst NICHT mit (registerPresence={false})
            //  • CoachmarkService.isAnyActive — die Touren sind für BEIDE
            //    unsichtbar, obwohl DemoProductSpotlight ein rohes
            //    RN-<Modal> ist. Ohne diesen dritten Wächter legt sich das
            //    Frage-Sheet über eine laufende Tour, und zwei sichtbare
            //    Modals frieren iOS hart ein (CLAUDE.md, 86ca8g2p9) —
            //    genau das, was der Puffer oben verhindern soll.
            //    ratingPrompt.ts:140/220 prüft dieselbe Kombination.
            etwasOffen: isAnySheetOpen() || isSurveyVisible() || CoachmarkService.isAnyActive(),
            jetzt: Date.now(),
          },
          stand,
        );
        if (abgebrochen || !urteil.fragen) return;
        inDieserSitzungGefragt.current = true;
        // VOR dem Anzeigen vermerken: ein Absturz oder Wegwischen zwischen
        // Anzeige und Notiz würde sonst beim nächsten Start sofort erneut
        // fragen. Gleiche Reihenfolge wie beim Bewertungs-Dialog.
        await frageVermerkt(Date.now());
        if (!abgebrochen) setFragesheetOffen(true);
      })();
    }, 4000);

    // Gegenkante (Projektregel: „jedes Gate braucht eine Gegenkante").
    // War zum Prüfzeitpunkt etwas offen, ginge der Anlauf sonst ersatzlos
    // verloren — der Effekt läuft nur bei Wechsel von permissionStatus oder
    // Kennung neu. `onPresentationIdle` weckt uns, sobald die Bühne frei
    // ist, und dann wird erneut ausgewertet.
    const wiederholen = onPresentationIdle(() => {
      if (abgebrochen || inDieserSitzungGefragt.current) return;
      void (async () => {
        const stand = await ladeStand();
        const urteil = darfFragen(
          {
            berechtigung:
              permissionStatus === 'granted'
                ? 'erteilt'
                : permissionStatus === 'denied'
                  ? 'abgelehnt'
                  : 'offen',
            etwasOffen: isAnySheetOpen() || isSurveyVisible() || CoachmarkService.isAnyActive(),
            jetzt: Date.now(),
          },
          stand,
        );
        if (abgebrochen || !urteil.fragen) return;
        inDieserSitzungGefragt.current = true;
        await frageVermerkt(Date.now());
        if (!abgebrochen) setFragesheetOffen(true);
      })();
    });

    return () => {
      abgebrochen = true;
      clearTimeout(t);
      wiederholen();
    };
  }, [permissionStatus, user?.uid]);

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
      const perm = await Notifications.getPermissionsAsync();
      const iosStatus = (perm as { ios?: { status?: number } }).ios?.status;
      const mapped: PermissionStatus =
        perm.status === 'granted' ? 'granted'
          : perm.status === 'denied' ? 'denied'
            // 3 = UNAuthorizationStatusProvisional. expo wirft ihn mit
            // „noch nicht gefragt" in einen Topf, fachlich ist es das
            // Gegenteil: es wird bereits zugestellt.
            : iosStatus === 3 ? 'provisional'
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
      {/*
        Das erklärende Sheet vor der einmaligen System-Frage. Es lebt hier
        und nicht auf einem Bildschirm, weil die Frage vom Verhalten abhängt
        und nicht davon, wo jemand gerade ist.

        „Später" ist folgenlos: der Vermerk steht schon (siehe oben), der
        nächste Anlauf kommt nach der Frist aus pushPermissionGate.ts. Nur
        „Ja" gibt die einmalige Gelegenheit aus.
      */}
      <PrePermissionSheet
        visible={fragesheetOffen}
        onClose={() => setFragesheetOffen(false)}
        onAllow={async () => {
          setFragesheetOffen(false);
          if (!user?.uid) return;
          const voll = await harteBerechtigungAnfragen(user.uid);
          // Erst jetzt den Erneuerungs-Hörer verdrahten. Beim App-Start ist
          // `registerFcmTokenForUser` ohne Erlaubnis ein Nichtstuer und
          // steigt vor dem Hörer aus — ohne diesen Aufruf liefe die
          // laufende Sitzung ohne ihn weiter.
          if (voll) void registerFcmTokenForUser(user.uid);
          // Der Wunsch des Nutzers ist damit ausdrücklich ein Ja — auch
          // wenn der System-Dialog danach scheitert. Sonst stünde der
          // Schalter auf AUS, obwohl er gerade zugestimmt hat.
          await setPushPreference(user.uid, true);
          setUserPreference(true);
          await refreshPermissionStatus();
          console.log('[push] harte Berechtigung nach Sheet:', voll ? 'erteilt' : 'nicht erteilt');
        }}
        onDecline={() => setFragesheetOffen(false)}
      />
    </PushNotificationContext.Provider>
  );
};
