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

      // In User-Dokument speichern
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        pushToken: tokenData,
        pushNotificationsEnabled: true,
      });

      // Auch in globale Token-Collection für Admin-Broadcasts
      const tokenRef = doc(db, 'pushTokens', token);
      await setDoc(tokenRef, {
        ...tokenData,
        active: true,
      });

      console.log('✅ Push Token gespeichert');
    } catch (error) {
      console.error('❌ Token Speicher-Fehler:', error);
    }
  }

  /**
   * Notification Listener einrichten
   */
  private setupListeners(): void {
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
   * Whitelist + Fallback laut pushDeepLinks.ts. Wenn kein deepLink
   * gesetzt ist, landet der User auf der Home-Tab.
   */
  private handleNotificationResponse(response: Notifications.NotificationResponse): void {
    try {
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
    } catch (e: any) {
      console.warn('[push-tap] cold-start handler failed:', e?.message);
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
   * Badge Zahl setzen (iOS)
   */
  async setBadgeCount(count: number): Promise<void> {
    if (Platform.OS === 'ios') {
      await Notifications.setBadgeCountAsync(count);
    }
  }

  /**
   * Push Notifications deaktivieren
   */
  async disable(userId: string): Promise<void> {
    try {
      if (this.pushToken) {
        // Token aus Firestore entfernen
        const tokenRef = doc(db, 'pushTokens', this.pushToken);
        await updateDoc(tokenRef, { active: false });

        // User-Einstellung updaten
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, { pushNotificationsEnabled: false });
      }

      // Listener entfernen
      if (this.notificationListener) {
        this.notificationListener.remove();
      }
      if (this.responseListener) {
        this.responseListener.remove();
      }

      console.log('🔕 Push Notifications deaktiviert');
    } catch (error) {
      console.error('❌ Fehler beim Deaktivieren:', error);
    }
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
