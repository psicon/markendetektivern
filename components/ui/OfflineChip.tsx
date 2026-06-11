import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useNetworkStatus } from '@/lib/services/network';

/**
 * Globaler Offline-Hinweis (ClickUp 86ca7uhxd): dezenter Chip über der
 * Tab-Bar, sobald die App ≥2 s offline ist. Vorher wussten User nur in
 * den Upload-Screens, dass kein Netz da ist — überall sonst sah ein
 * Funkloch aus wie "die App spinnt".
 *
 * - 2 s Debounce gegen Funkloch-Flackern (kurze Aussetzer im Markt
 *   sollen keinen Banner-Blink erzeugen); Reconnect blendet sofort aus.
 * - pointerEvents none — rein informativ, blockiert keine Taps.
 * - Copy-Ton positiv (was geht), kein Alarm-Rot (Projekt-Regel).
 */
export function OfflineChip({ bottomOffset = 76 }: { bottomOffset?: number }) {
  const { theme } = useTokens();
  const insets = useSafeAreaInsets();
  const net = useNetworkStatus();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (net.online) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), 2000);
    return () => clearTimeout(t);
  }, [net.online]);

  if (!visible) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: insets.bottom + bottomOffset,
        alignItems: 'center',
        zIndex: 9999,
      }}
    >
      <Animated.View
        entering={FadeInDown.duration(220)}
        exiting={FadeOutDown.duration(180)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: radii.md,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        }}
      >
        <MaterialCommunityIcons name="wifi-off" size={13} color={theme.textMuted} />
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 11,
            color: theme.textSub,
          }}
        >
          Kein Empfang — gespeicherte Inhalte werden gezeigt
        </Text>
      </Animated.View>
    </View>
  );
}
