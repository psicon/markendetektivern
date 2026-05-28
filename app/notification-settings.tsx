/**
 * Notification-Settings — Master-Toggle + System-Permission-Check +
 * Test-Push-Button (DEV-only).
 *
 * Phase 1 (jetzt): nur Master-On/Off + Permission-Status.
 * Phase 2 (später): 4 Kategorie-Toggles + Quiet-Hours.
 *
 * Routing-Pfad: /notification-settings (von Profile / Settings aus
 * verlinkt).
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRouter } from 'expo-router';
import React, { useLayoutEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { PrePermissionSheet } from '@/components/notifications/PrePermissionSheet';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { usePushNotifications } from '@/lib/contexts/PushNotificationProvider';

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme, brand, shadows } = useTokens();
  const {
    isEnabled,
    permissionStatus,
    pushToken,
    enablePushNotifications,
    disablePushNotifications,
    sendTestNotification,
    refreshPermissionStatus,
  } = usePushNotifications();

  const [sheetVisible, setSheetVisible] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const handleToggle = async (value: boolean) => {
    if (value) {
      if (permissionStatus === 'denied') {
        // System hat schon geantwortet — User muss in die Settings
        Alert.alert(
          'Benachrichtigungen sind blockiert',
          'Du hast Push-Benachrichtigungen für MarkenDetektive in den System-Einstellungen deaktiviert. Aktiviere sie dort, um wieder Push zu bekommen.',
          [
            { text: 'Abbrechen', style: 'cancel' },
            {
              text: 'Einstellungen öffnen',
              onPress: () => Linking.openSettings(),
            },
          ],
        );
        return;
      }
      if (permissionStatus === 'undetermined' || permissionStatus === 'unknown') {
        // Pre-Permission-Sheet zeigen
        setSheetVisible(true);
        return;
      }
      // Schon granted → einfach reaktivieren (Token re-registern)
      await enablePushNotifications();
    } else {
      await disablePushNotifications();
    }
  };

  const handleAllow = async () => {
    // System-Dialog triggern + Token holen
    await enablePushNotifications();
    await refreshPermissionStatus();
  };

  const statusLabel =
    permissionStatus === 'granted'
      ? 'Aktiv'
      : permissionStatus === 'denied'
        ? 'Blockiert (System-Einstellungen)'
        : permissionStatus === 'undetermined'
          ? 'Nicht aktiviert'
          : '—';

  const statusColor =
    permissionStatus === 'granted'
      ? '#2e7d32'
      : permissionStatus === 'denied'
        ? '#c62828'
        : theme.textMuted;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Benachrichtigungen" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + DETAIL_HEADER_ROW_HEIGHT + 12,
          paddingBottom: insets.bottom + 32,
          paddingHorizontal: 16,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — Status + Master-Toggle */}
        <View
          style={{
            backgroundColor: theme.surface,
            borderRadius: radii.lg,
            padding: 16,
            borderWidth: 1,
            borderColor: theme.border,
            ...shadows.sm,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: brand.primary + '22',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons name="bell-ring" size={22} color={brand.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 15,
                  color: theme.text,
                  letterSpacing: -0.1,
                }}
              >
                Alle Benachrichtigungen
              </Text>
              <Text
                style={{
                  marginTop: 2,
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 12,
                  color: statusColor,
                  letterSpacing: 0.2,
                }}
              >
                {statusLabel}
              </Text>
            </View>
            <Switch
              value={isEnabled}
              onValueChange={handleToggle}
              trackColor={{ false: theme.borderStrong, true: brand.primary + 'aa' }}
              thumbColor={isEnabled ? brand.primary : '#f4f3f4'}
              ios_backgroundColor={theme.borderStrong}
            />
          </View>

          {/* Info-Hinweis bei Denied */}
          {permissionStatus === 'denied' ? (
            <Pressable
              onPress={() => Linking.openSettings()}
              style={({ pressed }) => ({
                marginTop: 12,
                padding: 10,
                borderRadius: radii.md,
                backgroundColor: '#fff3e0',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <MaterialCommunityIcons name="information" size={16} color="#e65100" />
              <Text
                style={{
                  flex: 1,
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 12,
                  color: '#e65100',
                  lineHeight: 16,
                }}
              >
                Push ist in den iOS/Android-Einstellungen blockiert. Tippe hier
                um die System-Einstellungen zu öffnen.
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Phase-2-Vorschau: Kategorien-Hinweis */}
        <View
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: radii.lg,
            backgroundColor: theme.surfaceAlt,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold as any,
              fontSize: 12,
              color: theme.textSub,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Was wir senden
          </Text>
          <CategoryLine icon="cash-multiple" color={brand.primary} label="Cashback & Bon-Status" />
          <CategoryLine icon="cart-outline" color="#fb8c00" label="Lifecycle-Erinnerungen" />
          <CategoryLine icon="tag-outline" color="#43a047" label="Preis-Drops bei Favoriten" />
          <CategoryLine icon="bullhorn-outline" color="#7e57c2" label="Aktionen & App-Hinweise" />
          <Text
            style={{
              marginTop: 8,
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 11,
              color: theme.textMuted,
              lineHeight: 15,
            }}
          >
            Detaillierte Kategorie-Toggles folgen bald. Max 3 Nachrichten pro Tag.
          </Text>
        </View>

        {/* Dev-Only: Test-Push + Token-Anzeige */}
        {__DEV__ ? (
          <View
            style={{
              marginTop: 16,
              padding: 14,
              borderRadius: radii.lg,
              backgroundColor: '#fff8e1',
              borderWidth: 1,
              borderColor: '#ffe082',
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold as any,
                fontSize: 12,
                color: '#e65100',
                letterSpacing: 0.3,
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              Dev-Tools
            </Text>
            <Pressable
              onPress={sendTestNotification}
              disabled={!isEnabled}
              style={({ pressed }) => ({
                height: 40,
                borderRadius: radii.full,
                backgroundColor: isEnabled ? brand.primary : theme.borderStrong,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.bold as any,
                  fontSize: 13,
                  color: '#fff',
                }}
              >
                Test-Push senden (lokal)
              </Text>
            </Pressable>
            {pushToken ? (
              <View style={{ marginTop: 10 }}>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 10,
                    color: theme.textMuted,
                    letterSpacing: 0.3,
                    textTransform: 'uppercase',
                  }}
                >
                  Push-Token
                </Text>
                <Text
                  selectable
                  style={{
                    marginTop: 2,
                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                    fontSize: 10,
                    color: theme.textSub,
                  }}
                >
                  {pushToken}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <PrePermissionSheet
        visible={sheetVisible}
        onClose={() => setSheetVisible(false)}
        onAllow={handleAllow}
      />
    </View>
  );
}

function CategoryLine({ icon, color, label }: { icon: any; color: string; label: string }) {
  const { theme } = useTokens();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
      <MaterialCommunityIcons name={icon} size={14} color={color} />
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 13,
          color: theme.text,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
