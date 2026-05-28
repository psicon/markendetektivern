import { pushNotificationService } from '@/lib/services/pushNotificationService';
import * as Notifications from 'expo-notifications';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAuth } from './AuthContext';

type PermissionStatus = 'undetermined' | 'granted' | 'denied' | 'unknown';

interface PushNotificationContextType {
  isEnabled: boolean;
  /**
   * 'undetermined' = User wurde noch nie gefragt → System-Dialog erscheint
   * beim ersten `enablePushNotifications()`-Call. 'granted'/'denied'
   * heißt der User hat schon entschieden. 'unknown' = noch nicht geladen.
   */
  permissionStatus: PermissionStatus;
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
  const { user } = useAuth();
  const [isEnabled, setIsEnabled] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('unknown');
  const [pushToken, setPushToken] = useState<string | null>(null);

  // Initial Setup wenn User sich ändert
  useEffect(() => {
    if (user?.uid) {
      checkPushStatus();
    }
  }, [user?.uid]);

  // Cold-Start: wenn die App durch eine Push-Notification geöffnet
  // wurde, holen wir den Response NACH dem ersten Mount nach und
  // routen den User. Einmal kurz warten damit der Root-Navigator
  // mounted ist.
  useEffect(() => {
    const t = setTimeout(() => {
      void pushNotificationService.handleColdStartNotification();
    }, 500);
    return () => clearTimeout(t);
  }, []);

  // Permission-Status auch refreshen wenn User aus den iOS-Settings
  // zurückkommt (z.B. nach manueller Aktivierung). AppState-Listener
  // fängt das ab.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        void refreshPermissionStatus();
      }
    });
    return () => sub.remove();
  }, []);

  const refreshPermissionStatus = async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      const mapped: PermissionStatus =
        status === 'granted' ? 'granted'
          : status === 'denied' ? 'denied'
          : 'undetermined';
      setPermissionStatus(mapped);
      setIsEnabled(mapped === 'granted');
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
      await pushNotificationService.initialize(user.uid);
      await refreshPermissionStatus();
    } catch (error) {
      console.error('[push-provider] enable failed:', error);
    }
  };

  const disablePushNotifications = async () => {
    if (!user?.uid) return;
    try {
      await pushNotificationService.disable(user.uid);
      setIsEnabled(false);
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
