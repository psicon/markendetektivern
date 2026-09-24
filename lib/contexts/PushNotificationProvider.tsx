import { PrePermissionSheet } from '@/components/notifications/PrePermissionSheet';
import { wireFcmNotificationTaps } from '@/lib/services/fcmDeepLinks';
import {
  initialeRouteGesetzt,
  initialeRouteZuruecksetzen,
  istErsteEchteRoute,
} from '@/lib/services/pushDeepLinks';
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
import {
  berechtigungAusExpo,
  einschaltenMitEinerFrage,
  wirdZugestellt,
  type PermissionStatus,
} from '@/lib/services/pushPermissionStatus';
import * as Notifications from 'expo-notifications';
import { useSegments } from 'expo-router';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { useAuth } from './AuthContext';

// `PermissionStatus` lebt in pushPermissionStatus.ts — dort steht auch,
// warum `provisional` (iOS, still zugestellt) und der Android-13+-Fall
// („denied", obwohl nie gefragt) eigens behandelt werden.

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
  /**
   * Wunsch „an" speichern und — falls noch nicht erteilt — nach der
   * Systemberechtigung fragen. Liefert den Stand danach.
   */
  enablePushNotifications: () => Promise<PermissionStatus>;
  disablePushNotifications: () => Promise<void>;
  sendTestNotification: () => Promise<void>;
  /** Liest die Systemberechtigung neu und liefert den abgebildeten Stand. */
  refreshPermissionStatus: () => Promise<PermissionStatus>;
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
  /**
   * Für späte Rückrufe (AppState-Hörer mit leerer Abhängigkeitsliste):
   * die aktuelle uid und der zuletzt gelesene Berechtigungsstand. Ohne Ref
   * sähe der Hörer für immer die uid des ersten Renders (CLAUDE.md,
   * „Callback-Props … capturen").
   */
  const uidRef = useRef<string | null>(null);
  uidRef.current = user?.uid ?? null;
  const letzterStandRef = useRef<PermissionStatus>('unknown');
  /** Der Wunsch des Nutzers für den spät laufenden Frage-Rückruf. */
  const praeferenzRef = useRef(userPreference);
  praeferenzRef.current = userPreference;

  // Erste echte Route steht (keine Startseite, kein Onboarding, keine
  // Anmeldung — die leiten selbst weiter) und ein Nutzer ist da →
  // vorgemerkte Ziele aus Nachrichten-Taps dürfen jetzt öffnen
  // (pushDeepLinks.ts).
  const segmente = useSegments();
  const ersteRouteSteht = istErsteEchteRoute(segmente);
  useEffect(() => {
    if (ersteRouteSteht && user?.uid) initialeRouteGesetzt();
  }, [ersteRouteSteht, user?.uid]);
  // Wird die Wurzel neu aufgebaut (Android: Activity weg, JS-Prozess lebt),
  // läuft die Startseite erneut — Ziele müssen dann wieder warten.
  useEffect(() => () => initialeRouteZuruecksetzen(), []);

  /**
   * Kennen wir den Wunsch des Nutzers schon verlässlich — auch den vom
   * Server? Bis dahin wird NICHT gefragt: wer auf einem anderen Gerät
   * abbestellt hat, hat lokal noch den Startwert „an".
   */
  const [praeferenzBekannt, setPraeferenzBekannt] = useState(false);
  useEffect(() => {
    setPraeferenzBekannt(false);
  }, [user?.uid]);
  /** Ein laufendes Einschalten — ein zweiter Tipp wartet darauf, statt neu zu fragen. */
  const laufendesEinschalten = useRef<Promise<PermissionStatus> | null>(null);

  // Zwei getrennte Fragen, bewusst zwei getrennte Zustände:
  //   permissionStatus — DÜRFEN wir? (Auskunft des Betriebssystems)
  //   userPreference   — WILL er? (Entscheidung des Nutzers, von uns
  //                      gespeichert und vom Server gelesen)
  // Der Schalter zeigt die Und-Verknüpfung.
  // Provisorisch heißt: es kommt an, nur leise. Für „bekommt der Nutzer
  // Nachrichten?" zählt das mit — sonst zeigte der Schalter AUS, während in
  // der Mitteilungszentrale Nachrichten liegen.
  const zugestellt = wirdZugestellt(permissionStatus);
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
    // Beim Kontowechsel liegt kurz noch das Profil des vorigen Kontos an —
    // dessen Abbestellung darf weder übernommen noch als „bekannt" gewertet
    // werden. Ältere Profile ohne uid werden wie bisher behandelt.
    const profilUid = (userProfile as { uid?: string }).uid;
    if (profilUid && profilUid !== user.uid) return;
    const meine = schaltEpoche.current;
    const abgleichFuer = user.uid;
    void abgleichenMitServer(
      user.uid,
      (userProfile as { pushNotificationsEnabled?: boolean }).pushNotificationsEnabled,
    ).then((wert) => {
      // Hat der Nutzer zwischenzeitlich selbst geschaltet, ist diese
      // Antwort überholt und wird verworfen.
      if (schaltEpoche.current === meine) setUserPreference(wert);
      // Nur für das Konto, für das abgeglichen wurde.
      if (uidRef.current === abgleichFuer) setPraeferenzBekannt(true);
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
    // Android: den Kanal anlegen, den der Server für Cashback-Nachrichten
    // nennt. Ohne ihn landeten sie im Ersatzkanal „Sonstiges".
    void pushNotificationService.androidKanaeleAnlegen();
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
    // Erst nach dem Server-Abgleich — sonst übersähe die Frage eine
    // Abbestellung von einem anderen Gerät. Der Effekt läuft danach neu.
    if (!praeferenzBekannt) return;

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
            abbestellt: !praeferenzRef.current,
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
            abbestellt: !praeferenzRef.current,
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
  }, [permissionStatus, user?.uid, praeferenzBekannt]);

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
  const refreshPermissionStatus = async (): Promise<PermissionStatus> => {
    try {
      const perm = await Notifications.getPermissionsAsync();
      const mapped = berechtigungAusExpo(perm, Platform.OS, Platform.Version);
      const vorher = letzterStandRef.current;
      letzterStandRef.current = mapped;
      setPermissionStatus(mapped);
      if (mapped === 'granted') {
        setPushToken(pushNotificationService.getPushToken());
      } else {
        setPushToken(null);
      }

      // Erlaubnis ist NEU da (Sheet, Einstellungsseite oder Rückkehr aus den
      // Systemeinstellungen): jetzt den FCM-Token holen und den Hörer
      // verdrahten. Bis 17.09.2026 geschah das nur beim nächsten Kaltstart —
      // wer in den Einstellungen zustimmte, blieb bis dahin unerreichbar.
      // Bewusst NICHT beim ersten Lesen (`vorher === 'unknown'`): den Start
      // deckt der AuthContext ab, ein zweiter Aufruf kostete nur einen
      // weiteren Lese- und Schreibvorgang.
      // Auch leise → voll (iOS provisorisch → erteilt): scheiterte der Token
      // beim Start, holt der Hörer ihn so nach (Kosten: einmalig).
      const uid = uidRef.current;
      const neuErlaubt =
        (!wirdZugestellt(vorher) && wirdZugestellt(mapped)) ||
        (vorher === 'provisional' && mapped === 'granted');
      if (uid && vorher !== 'unknown' && neuErlaubt) {
        void registerFcmTokenForUser(uid);
      }
      return mapped;
    } catch (e) {
      console.warn('[push-provider] refreshPermissionStatus failed', e);
      letzterStandRef.current = 'unknown';
      setPermissionStatus('unknown');
      return 'unknown';
    }
  };

  const checkPushStatus = async () => {
    await refreshPermissionStatus();
  };

  const enablePushNotifications = (): Promise<PermissionStatus> => {
    // Zweiter Tipp, während der erste noch fragt: auf dessen Ergebnis warten.
    // Sonst reiht expo die zweite Anfrage ein, und Android zeigt den Dialog
    // gleich noch einmal — die zweite Ablehnung wäre endgültig.
    if (laufendesEinschalten.current) return laufendesEinschalten.current;
    const lauf = einschaltenAblauf().finally(() => {
      laufendesEinschalten.current = null;
    });
    laufendesEinschalten.current = lauf;
    // Offline löst der Firestore-Schreibvorgang im Token-Pfad nie auf
    // (Projektregel) — ohne diese Frist bliebe der Schalter für den Rest der
    // Sitzung stumm. Danach darf der Nutzer es erneut versuchen.
    setTimeout(() => {
      if (laufendesEinschalten.current === lauf) laufendesEinschalten.current = null;
    }, 15000);
    return lauf;
  };

  const einschaltenAblauf = async (): Promise<PermissionStatus> => {
    if (!user?.uid) {
      console.warn('[push-provider] no user');
      return permissionStatus;
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
      // Noch keine volle Erlaubnis: über DENSELBEN Weg fragen wie das Sheet
      // des Providers — er holt nach dem Ja auch den FCM-Token, den der Server
      // liest. Bis 17.09.2026 lief die Einstellungsseite nur über den
      // Expo-Weg darunter, der ausschließlich einen Expo-Token speichert.
      // Fragen über den Weg, der auch den FCM-Token holt; der Expo-Weg
      // (Tap-Hörer, Android-Kanal 'default') nur mit Erlaubnis — sonst fragt
      // er ein zweites Mal (pushPermissionStatus.ts). Das Neu-Einlesen
      // verdrahtet beim Übergang auf „erlaubt" den Token-Hörer.
      const uid = user.uid;
      return await einschaltenMitEinerFrage({
        aktuellerStand: permissionStatus,
        fragen: () => harteBerechtigungAnfragen(uid),
        expoWegEinrichten: () => pushNotificationService.initialize(uid),
        standNeuLesen: refreshPermissionStatus,
      });
    } catch (error) {
      console.error('[push-provider] enable failed:', error);
      return permissionStatus;
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
          // Den Erneuerungs-Hörer verdrahtet `refreshPermissionStatus` unten
          // beim Übergang auf „erlaubt" — eine Stelle für alle drei Wege
          // (dieses Sheet, Einstellungsseite, Systemeinstellungen).
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
