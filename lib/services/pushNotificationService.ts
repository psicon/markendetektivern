import { isExpoGo } from '@/lib/utils/platform';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { doc, setDoc, updateDoc } from '@react-native-firebase/firestore';
import { Platform } from 'react-native';
import { db } from '../firebase';
import { extractDeepLink, navigateToDeepLink } from './pushDeepLinks';

// Notification Handler Konfiguration
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    // SDK 53+: shouldShowAlert ist deprecated und wird von neuen
    // expo-notifications-Versionen ignoriert — ohne Banner/List-Flags
    // erscheinen Foreground-Pushes sonst gar nicht (86cb7gfc9).
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

interface PushToken {
  token: string;
  platform: 'ios' | 'android';
  deviceName: string;
  lastUpdated: Date;
  userId?: string;
}

class PushNotificationService {
  private static instance: PushNotificationService;
  private pushToken: string | null = null;
  private notificationListener: any = null;
  private responseListener: any = null;

  private constructor() {}

  static getInstance(): PushNotificationService {
    if (!PushNotificationService.instance) {
      PushNotificationService.instance = new PushNotificationService();
    }
    return PushNotificationService.instance;
  }

  /**
   * Service initialisieren
   */
  async initialize(userId?: string): Promise<void> {
    try {
      console.log('🔔 Initialisiere Push Notifications...');

      // Skip in Expo Go für jetzt (braucht extra Setup)
      if (isExpoGo()) {
        console.log('📱 Push Notifications in Expo Go übersprungen');
        return;
      }

      // Prüfe ob Device Push unterstützt
      if (!Device.isDevice) {
        console.log('⚠️ Push Notifications nur auf echten Geräten verfügbar');
        return;
      }

      // Berechtigung anfragen
      const permission = await this.requestPermission();
      if (!permission) {
        console.log('❌ Push Notification Berechtigung verweigert');
        return;
      }

      // Push Token holen
      const token = await this.registerForPushNotifications();
      if (token && userId) {
        await this.savePushToken(token, userId);
      }

      // Listener einrichten
      this.setupListeners();

      console.log('✅ Push Notifications initialisiert');
    } catch (error) {
      console.error('❌ Push Notification Fehler:', error);
    }
  }

  /**
   * Berechtigung anfragen
   */
  private async requestPermission(): Promise<boolean> {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    return finalStatus === 'granted';
  }

  /**
   * Für Push Notifications registrieren
   */
  private async registerForPushNotifications(): Promise<string | null> {
    try {
      // Expo Push Token holen
      const token = await Notifications.getExpoPushTokenAsync({
        projectId: '5b645e59-c337-44e5-81cd-7681b4515623' // EAS Project ID
      });

      this.pushToken = token.data;
      console.log('📱 Push Token:', this.pushToken);

      // Platform-spezifische Einstellungen
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
        });
      }

      return this.pushToken;
    } catch (error) {
      console.error('❌ Token Registration Fehler:', error);
      return null;
    }
  }

  /**
   * Push Token in Firestore speichern
   */
  private async savePushToken(token: string, userId: string): Promise<void> {
    try {
      const tokenData: PushToken = {
        token,
        platform: Platform.OS as 'ios' | 'android',
        deviceName: `${Device.modelName} (${Device.osName} ${Device.osVersion})`,
        lastUpdated: new Date(),
        userId,
      };

      // In User-Dokument speichern.
      //
      // `pushNotificationsEnabled` wird hier BEWUSST NICHT gesetzt
      // (86cbfdq5j). Bis 08.09.2026 schrieb diese Zeile ein hartes `true`
      // — und damit hätte jedes Token-Speichern eine Abbestellung wieder
      // aufgehoben, ohne dass der Nutzer irgendetwas getan hätte. Die
      // Einstellung gehört allein dem Nutzer; sie lebt in
      // lib/services/pushPreference.ts und wird nur von dort geschrieben.
      // BEIDE Schreibvorgänge bewusst ohne await: sie hängen offline
      // unbegrenzt, ohne je zu scheitern (Projektregel). Vorher wartete der
      // Einschalt-Pfad darauf — im Funkloch erteilte der Nutzer die
      // Berechtigung und der Schalter blieb trotzdem AUS, weil der
      // anschließende `refreshPermissionStatus()` nie an die Reihe kam.
      const userRef = doc(db, 'users', userId);
      void updateDoc(userRef, { pushToken: tokenData }).catch((e: any) =>
        console.warn('[push] Token am Nutzerdokument speichern fehlgeschlagen:', e?.message),
      );

      // Auch in globale Token-Collection für Admin-Broadcasts
      const tokenRef = doc(db, 'pushTokens', token);
      void setDoc(tokenRef, { ...tokenData, active: true }).catch((e: any) =>
        console.warn('[push] Token-Sammlung schreiben fehlgeschlagen:', e?.message),
      );
    } catch (error) {
      console.error('❌ Token Speicher-Fehler:', error);
    }
  }

  /**
   * Notification Listener einrichten
   */
  private setupListeners(): void {
    // Vorhandene Hörer zuerst entfernen: jedes Einschalten in den
    // Einstellungen ruft `initialize` erneut auf, und ohne das hingen danach
    // mehrere Tap-Hörer — ein Tap öffnete sein Ziel dann mehrfach.
    try {
      this.notificationListener?.remove?.();
      this.responseListener?.remove?.();
    } catch {
      /* Aufräumen darf das Einrichten nicht verhindern */
    }
    // Notification erhalten (App im Vordergrund)
    this.notificationListener = Notifications.addNotificationReceivedListener(notification => {
      console.log('📬 Notification erhalten:', notification);
      // Hier können wir In-App Benachrichtigungen zeigen
    });

    // Notification geklickt
    this.responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('👆 Notification geklickt:', response);
      // Hier können wir zur entsprechenden Seite navigieren
      this.handleNotificationResponse(response);
    });
  }

  /**
   * Handle Notification Click — Deep-Link-Routing via expo-router.
   *
   * Erwarteter Payload (aus Firebase Console "Erweiterte Optionen →
   * Custom Data" ODER aus CF mit `data.deepLink`):
   *   { deepLink: '/noname-detail/abc123' }
   *
   * Whitelist laut pushDeepLinks.ts. Ohne gültigen deepLink passiert nichts
   * weiter — der Tap öffnet nur die App. Gilt nur noch für LOKALE
   * Nachrichten; FCM-Taps routet fcmDeepLinks.ts.
   */
  private handleNotificationResponse(response: Notifications.NotificationResponse): void {
    try {
      // Remote-Nachrichten (FCM) routet lib/services/fcmDeepLinks.ts. expo
      // meldet denselben Tap zusätzlich — unter iOS ohne Daten (dann ersetzte
      // der alte Default-`replace` die gerade geöffnete Bon-Seite), unter
      // Android als Doppel. Hier also nur noch lokale Nachrichten.
      if ((response.notification.request.trigger as { type?: string } | null)?.type === 'push') return;
      const data = response.notification.request.content.data;
      const deepLink = extractDeepLink(data);
      console.log('[push-tap] deepLink=', deepLink, 'data=', data);
      navigateToDeepLink(deepLink);
    } catch (e: any) {
      console.warn('[push-tap] handleNotificationResponse failed:', e?.message);
    }
  }

  /**
   * Cold-Start-Handler: wenn die App durch eine Push-Notification
   * geöffnet wurde, wird der Response erst gesetzt nachdem die App
   * läuft. Wir fragen das beim ersten Mount ab und routen.
   *
   * Wird vom PushNotificationProvider aufgerufen sobald der
   * Root-Navigator ready ist.
   */
  async handleColdStartNotification(): Promise<void> {
    try {
      const last = await Notifications.getLastNotificationResponseAsync();
      if (!last) return;
      console.log('[push-tap] cold-start response found');
      this.handleNotificationResponse(last);
      // expo hält die Antwort für die ganze Prozesslaufzeit. Ohne Leeren
      // öffnete ein Neuaufbau der Wurzel (Android: Activity weg, Prozess lebt)
      // das alte Ziel erneut.
      await Notifications.clearLastNotificationResponseAsync();
    } catch (e: any) {
      console.warn('[push-tap] cold-start handler failed:', e?.message);
    }
  }

  /**
   * Android-Benachrichtigungskanäle anlegen, die der Server benutzt.
   *
   * `sendCashbackReady` (cashback-pipeline/lib/push.js) schickt Android-
   * Nachrichten mit `channelId: 'cashback'`. Angelegt hat diesen Kanal bis
   * 17.09.2026 niemand — Android stellte die Nachrichten deshalb in den
   * Ersatzkanal des FCM-SDK („Sonstiges"), den Nutzer nicht zuordnen können.
   *
   * Das Anlegen fragt NICHT nach der Berechtigung (targetSdk ≥ 33) und ist
   * idempotent; Android übernimmt Wichtigkeit und Ton nur beim ersten Mal,
   * danach gehören sie dem Nutzer.
   */
  async androidKanaeleAnlegen(): Promise<void> {
    if (Platform.OS !== 'android') return;
    try {
      await Notifications.setNotificationChannelAsync('cashback', {
        name: 'Cashback & Bons',
        description: 'Wenn dein Cashback gutgeschrieben ist',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
      });
    } catch (e: any) {
      // Ohne Kanal kommt die Nachricht trotzdem an (Ersatzkanal).
      console.warn('[push] Android-Kanal anlegen fehlgeschlagen:', e?.message);
    }
  }

  /**
   * Lokale Notification senden (für Tests)
   */
  async sendLocalNotification(
    title: string,
    body: string,
    data?: any
  ): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data,
        sound: true,
      },
      trigger: null, // Sofort senden
    });
  }

  /**
   * Badge-Zahl am App-Symbol setzen (iOS; auf Android ohne Wirkung).
   */
  async setBadgeCount(count: number): Promise<void> {
    if (Platform.OS !== 'ios') return;
    try {
      await Notifications.setBadgeCountAsync(count);
    } catch (e: any) {
      // Darf nie einen Aufrufer mitreißen — der Badge ist Beiwerk.
      console.warn('[push] Badge setzen fehlgeschlagen:', e?.message);
    }
  }

  /**
   * Die rote Zahl am App-Symbol entfernen (86cbfdq5j).
   *
   * Bis 08.09.2026 gab es diese Handlung im gesamten Projekt nicht — auf
   * keinem der 19 lokalen und 7 entfernten Zweige und in keiner Zeile
   * nativen Codes. `setBadgeCount` existierte, hatte aber KEINEN einzigen
   * Aufrufer, während der Server bei jeder Cashback-Gutschrift `badge: 1`
   * mitschickte. APNs setzt diesen Wert absolut; die 1 blieb, bis jemand
   * eine 0 schreibt. Niemand tat es. Ergebnis: eine rote Eins, die sich
   * durch nichts entfernen ließ — nicht durch Wegwischen der Mitteilung,
   * nicht durch Neustart, nicht durch Ausloggen.
   *
   * Aufgerufen vom PushNotificationProvider beim Start und bei jedem
   * Wechsel in den Vordergrund. Das deckt beide Wege ab, auf denen ein
   * Nutzer nach einer Nachricht in die App kommt: aus dem Hintergrund
   * (AppState wird 'active') und aus dem beendeten Zustand (Start).
   */
  async clearBadge(): Promise<void> {
    await this.setBadgeCount(0);
  }

  /**
   * Geräteseitig aufräumen, wenn der Nutzer Nachrichten abbestellt.
   *
   * Nimmt bewusst KEINE userId mehr entgegen: die Abbestellung selbst
   * schreibt `setPushPreference` — hätte diese Methode weiterhin ein
   * eigenes Feld ans Nutzerdokument geschrieben, gäbe es wieder zwei
   * Stellen für dieselbe Aussage.
   */
  async disable(): Promise<void> {
    // Die eigentliche Abbestellung schreibt der Aufrufer über
    // `setPushPreference` (pushPreference.ts) — das ist das Feld, das der
    // Server liest. Hier bleibt nur das Aufräumen auf dem Gerät.
    //
    // Der frühere Rahmen `if (this.pushToken) { … }` machte diese Methode
    // meistens zum Nichtstuer: `this.pushToken` füllt allein
    // `registerForPushNotifications()`, und lief das in DERSELBEN Sitzung
    // nicht, war das Feld null und der ganze Block wurde übersprungen —
    // Firestore-Schreibvorgang inklusive. Der Nutzer legte den Schalter um,
    // und es passierte buchstäblich nichts (86cbfdq5j).

    // Rote Zahl weg — wer Nachrichten abbestellt, will auch die nicht mehr.
    await this.clearBadge();

    // Listener zuerst entfernen — und die Referenzen mit, sonst greift ein
    // späteres `remove()` auf ein bereits entferntes Abo.
    try {
      this.notificationListener?.remove?.();
      this.responseListener?.remove?.();
    } catch (error: any) {
      console.warn('[push] Listener entfernen fehlgeschlagen:', error?.message);
    }
    this.notificationListener = null;
    this.responseListener = null;

    if (this.pushToken) {
      // Nur Hygiene: dieses Dokument gehört zum Expo-Token-Weg, den der
      // Server für Cashback-Nachrichten gar nicht liest (er liest
      // users/{uid}/fcmTokens/*). Es abzuräumen hält den Bestand sauber,
      // stoppt aber für sich genommen keinen einzigen Versand.
      //
      // BEWUSST nicht abgewartet: Firestore-Schreibvorgänge lösen offline
      // nie auf und werfen auch nicht (Projektregel). Ein `await` hier
      // hätte im Funkloch dazu geführt, dass diese Methode nie zurückkehrt
      // — und das Aufräumen oben nie liefe.
      const tokenRef = doc(db, 'pushTokens', this.pushToken);
      void updateDoc(tokenRef, { active: false }).catch((e: any) =>
        console.warn('[push] Token-Dokument abräumen fehlgeschlagen:', e?.message),
      );
    }
    this.pushToken = null;

    console.log('🔕 Push-Nachrichten auf diesem Gerät abbestellt');
  }

  /**
   * Test: Notification an alle User senden (Admin-Funktion)
   * Später über Cloud Function implementieren
   */
  async sendTestBroadcast(): Promise<void> {
    // Dies würde über eine Cloud Function laufen die alle aktiven Tokens lädt
    // und dann über Expo Push API sendet
    console.log('📢 Broadcast würde über Cloud Function gesendet...');
    
    // Für lokalen Test:
    await this.sendLocalNotification(
      '🎉 Neue NoName Produkte entdeckt!',
      'Schau dir die neuesten Entdeckungen in deinem Lieblingsmarkt an.',
      { type: 'new_products' }
    );
  }

  /**
   * Getter für Push Token
   */
  getPushToken(): string | null {
    return this.pushToken;
  }
}

export const pushNotificationService = PushNotificationService.getInstance();
