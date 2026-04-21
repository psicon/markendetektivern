import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';

type Props = {
  title: string;
  onBack?: () => void;
};

/** Height of the row below the safe-area inset. Used by screens to pad
 *  their ScrollView so content starts below the header while still being
 *  allowed to scroll UNDER it for the blur effect. */
export const DETAIL_HEADER_ROW_HEIGHT = 48;

/**
 * Detail-screen header built for iOS Dynamic-Island feel:
 *  - On iOS: rendered in a BlurView, so scroll content passing behind it
 *    gets a native translucent tint. The status-bar area (insets.top) is
 *    part of the same blurred surface — the island "flows into" it.
 *  - On Android: a solid tinted View (BlurView on Android is unreliable).
 *  - Always absolute-positioned on top so the ScrollView's contentInset
 *    can extend all the way to y=0 without shifting the real content.
 */
export function DetailHeader({ title, onBack }: Props) {
  const { theme } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === 'ios';

  const Row = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: DETAIL_HEADER_ROW_HEIGHT,
        paddingHorizontal: 16,
        gap: 8,
      }}
    >
      {onBack ? (
        <Pressable
          onPress={onBack}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1,
          })}
          hitSlop={6}
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={theme.text} />
        </Pressable>
      ) : null}
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 20,
          color: theme.text,
          letterSpacing: -0.2,
        }}
      >
        {title}
      </Text>
    </View>
  );

  const commonContainerStyle = {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingTop: insets.top,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  };

  if (isIOS) {
    return (
      <BlurView
        tint={scheme === 'dark' ? 'dark' : 'light'}
        intensity={80}
        style={commonContainerStyle}
      >
        {Row}
      </BlurView>
    );
  }

  return (
    <View
      style={[
        commonContainerStyle,
        {
          backgroundColor:
            scheme === 'dark' ? 'rgba(15,18,20,0.92)' : 'rgba(245,247,248,0.92)',
        },
      ]}
    >
      {Row}
    </View>
  );
}
