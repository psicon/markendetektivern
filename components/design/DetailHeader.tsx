import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import React from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';

type Props = {
  /** Always-visible label below the safe-area (default "Produktdetails"). */
  title: string;
  /** Optional long title that fades IN over `title` once the content
   *  scrolls past `swapAt`. Typical use: the screen's big H1 moving into
   *  the nav bar as the user scrolls. */
  scrolledTitle?: string;
  /** Optional small logo URL to render inline before `scrolledTitle`. */
  scrolledLogoUri?: string | null;
  /** Reanimated scroll offset of the main ScrollView. Required when
   *  `scrolledTitle` is set. */
  scrollY?: SharedValue<number>;
  /** Scroll offset at which the title-swap completes. Default 120. */
  swapAt?: number;
  onBack?: () => void;
  /** Optional right-side slot — rendered after the title with the
   *  same vertical alignment as the back button. Use for screen
   *  actions (info, share, settings, …). */
  right?: React.ReactNode;
};

/** Height of the row below the safe-area inset. Used by screens to pad
 *  their ScrollView so content starts below the header while still being
 *  allowed to scroll UNDER it for the blur effect. */
export const DETAIL_HEADER_ROW_HEIGHT = 48;

/**
 * Detail-screen header built for iOS Dynamic-Island feel:
 *  - iOS: BlurView surface, scroll content behind gets a native tint.
 *  - Android: tinted semi-transparent View fallback.
 *  - Optional UINavigationBar-style large-title dismissal: pass scrollY
 *    + scrolledTitle + an optional scrolledLogoUri, and the product
 *    logo+name will rise into the nav bar as the hero scrolls out.
 */
export function DetailHeader({
  title,
  scrolledTitle,
  scrolledLogoUri,
  scrollY,
  swapAt = 120,
  onBack,
  right,
}: Props) {
  const { theme } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === 'ios';

  // "hasSwap" gates ONLY whether we render the scrolled-in second title.
  // The default title's fade-out is driven purely by scrollY (if
  // provided) so callers that only want the default to fade out can
  // pass scrollY + swapAt without also passing scrolledTitle — which
  // is what the detail screens now do, since they render their own
  // morph-title overlay above the chrome instead of letting the
  // header crossfade a second Text element in.
  const hasSwap = !!scrolledTitle && !!scrollY;
  const outRange = [swapAt - 40, swapAt - 10] as const;
  const inRange = [swapAt - 30, swapAt] as const;

  const defaultTitleStyle = useAnimatedStyle(() => {
    if (!scrollY) {
      return { opacity: 1, transform: [{ translateY: 0 }] };
    }
    const t = interpolate(scrollY.value, outRange, [1, 0], Extrapolation.CLAMP);
    return {
      opacity: t,
      transform: [{ translateY: (1 - t) * -4 }],
    };
  });
  const scrolledGroupStyle = useAnimatedStyle(() => {
    if (!hasSwap || !scrollY) {
      return { opacity: 0, transform: [{ translateY: 8 }] };
    }
    const t = interpolate(scrollY.value, inRange, [0, 1], Extrapolation.CLAMP);
    return {
      opacity: t,
      transform: [{ translateY: (1 - t) * 8 }],
    };
  });
  const borderStyle = useAnimatedStyle(() => {
    if (!scrollY) return { opacity: 0 };
    return {
      opacity: interpolate(
        scrollY.value,
        [swapAt - 20, swapAt],
        [0, 1],
        Extrapolation.CLAMP,
      ),
    };
  });

  const commonContainerStyle = {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingTop: insets.top,
  };

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
      {/* Title slot — two overlapping absolute groups crossfade. Default
          is the chrome label ("Produktdetails"); scrolled is the H1 that
          rose from the content, optionally prefixed with a tiny logo. */}
      <View style={{ flex: 1, position: 'relative', height: 24, justifyContent: 'center' }}>
        <Animated.Text
          numberOfLines={1}
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 20,
              color: theme.text,
              letterSpacing: -0.2,
            },
            defaultTitleStyle,
          ]}
        >
          {title}
        </Animated.Text>
        {hasSwap ? (
          <Animated.View
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              },
              scrolledGroupStyle,
            ]}
          >
            {scrolledLogoUri ? (
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  backgroundColor: '#ffffff',
                  overflow: 'hidden',
                  borderWidth: 0.5,
                  borderColor: theme.border,
                }}
              >
                <Image
                  source={{ uri: scrolledLogoUri }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              </View>
            ) : null}
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 17,
                color: theme.text,
                letterSpacing: -0.2,
              }}
            >
              {scrolledTitle}
            </Text>
          </Animated.View>
        ) : null}
      </View>
      {right ? <View style={{ marginLeft: 4 }}>{right}</View> : null}
    </View>
  );

  const Border = (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 1,
          backgroundColor: theme.border,
        },
        borderStyle,
      ]}
    />
  );

  if (isIOS) {
    return (
      <BlurView
        tint={scheme === 'dark' ? 'dark' : 'light'}
        intensity={80}
        style={commonContainerStyle}
      >
        {Row}
        {Border}
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
      {Border}
    </View>
  );
}
