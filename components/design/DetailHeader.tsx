import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
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
  /** Reanimated scroll offset of the main ScrollView. Required when
   *  `scrolledTitle` is set. */
  scrollY?: SharedValue<number>;
  /** Scroll offset at which the title-swap completes. Default 120. */
  swapAt?: number;
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
 *  - On Android: a semi-transparent tinted View fallback (BlurView on
 *    Android is visually unreliable across OEMs). Same layering idea
 *    without the GPU-level blur — content is still visible through the
 *    92 %-opaque tint.
 *
 * Optional large-title behavior: pass `scrolledTitle` + `scrollY` to get
 * an iOS-style cross-fade where the H1 (e.g. product name) rises into
 * the nav bar as the user scrolls past it.
 */
export function DetailHeader({
  title,
  scrolledTitle,
  scrollY,
  swapAt = 120,
  onBack,
}: Props) {
  const { theme } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === 'ios';

  // Animated styles — only active when scrollY is supplied AND a
  // scrolledTitle exists. Shared values are cheap; unused hooks just
  // compute a no-op style.
  const hasSwap = !!scrolledTitle && !!scrollY;
  const fadeInRange = [swapAt - 40, swapAt] as const;

  const defaultTitleStyle = useAnimatedStyle(() => {
    if (!hasSwap || !scrollY) return { opacity: 1 };
    return {
      opacity: interpolate(scrollY.value, fadeInRange, [1, 0], Extrapolation.CLAMP),
    };
  });
  const scrolledTitleStyle = useAnimatedStyle(() => {
    if (!hasSwap || !scrollY) return { opacity: 0 };
    return {
      opacity: interpolate(scrollY.value, fadeInRange, [0, 1], Extrapolation.CLAMP),
      transform: [
        {
          translateY: interpolate(
            scrollY.value,
            fadeInRange,
            [10, 0],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });
  const borderStyle = useAnimatedStyle(() => {
    if (!scrollY) return { opacity: 0 };
    return {
      opacity: interpolate(
        scrollY.value,
        [swapAt - 20, swapAt + 10],
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
      {/* Title swap slot — two Animated.Text layered; one fades out while
          the other fades in, giving the iOS large-title → nav-title feel. */}
      <View style={{ flex: 1, position: 'relative', height: 24, justifyContent: 'center' }}>
        <Animated.Text
          numberOfLines={1}
          style={[
            {
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
          <Animated.Text
            numberOfLines={1}
            style={[
              {
                position: 'absolute',
                left: 0,
                right: 0,
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 17,
                color: theme.text,
                letterSpacing: -0.2,
              },
              scrolledTitleStyle,
            ]}
          >
            {scrolledTitle}
          </Animated.Text>
        ) : null}
      </View>
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
