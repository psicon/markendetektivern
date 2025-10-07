import { pushNotificationService } from '@/lib/services/pushNotificationService';
import * as Notifications from 'expo-notifications';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';

interface PushNotificationContextType {
  isEnabled: boolean;
  pushToken: string | null;
  enablePushNotifications: () => Promise<void>;
  disablePushNotifications: () => Promise<void>;
  sendTestNotification: () => Promise<void>;
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
  const [pushToken, setPushToken] = useState<string | null>(null);

  // Initial Setup wenn User sich ändert
  useEffect(() => {
    if (user?.uid) {
      checkPushStatus();
    }
  }, [user?.uid]);

  const checkPushStatus = async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      setIsEnabled(status === 'granted');
      
      if (status === 'granted') {
        const token = pushNotificationService.getPushToken();
        setPushToken(token);
      }
    } catch (error) {
      console.error('Error checking push status:', error);
    }
  };

  const enablePushNotifications = async () => {
    if (!user?.uid) {
      console.warn('No user for push notifications');
      return;
    }

    try {
      await pushNotificationService.initialize(user.uid);
      await checkPushStatus();
    } catch (error) {
      console.error('Error enabling push notifications:', error);
    }
  };

  const disablePushNotifications = async () => {
    if (!user?.uid) return;

    try {
      await pushNotificationService.disable(user.uid);
      setIsEnabled(false);
      setPushToken(null);
    } catch (error) {
      console.error('Error disabling push notifications:', error);
    }
  };

  const sendTestNotification = async () => {
    await pushNotificationService.sendTestBroadcast();
  };

  const value: PushNotificationContextType = {
    isEnabled,
    pushToken,
    enablePushNotifications,
    disablePushNotifications,
    sendTestNotification,
  };

  return (
    <PushNotificationContext.Provider value={value}>
      {children}
    </PushNotificationContext.Provider>
  );
};
