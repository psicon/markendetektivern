/**
 * Toast helpers — compact pill design.
 *
 * After a few iterations (white / vibrant / dark), the user landed
 * on: small, transluzent, NOT in your face. So the toast is now an
 * iOS-Dynamic-Island-style PILL:
 *   • Auto-width (only as wide as the content needs)
 *   • Pill-shaped (borderRadius 999), centered
 *   • BlurView backdrop (iOS) / tinted View (Android), light or dark
 *     based on color scheme
 *   • Category identity carried by the small accent icon — NO full
 *     coloured fills
 *
 * Position (gamification ↓, rest ↑) is unchanged from the previous
 * iteration:
 *   • POINTS, STREAK, ANTI_ABUSE  → BOTTOM
 *   • All others                  → TOP
 */
import { BlurView } from 'expo-blur';
import {
  extractEmoji,
  getToastDuration,
  TOAST_DURATIONS,
  TOAST_MESSAGES,
  ToastCategory,
  interpolateMessage,
} from '@/constants/ToastMessages';
import { useColorScheme } from '@/hooks/useColorScheme';
import {
  resolveValue,
  Toast as RNToast,
  toast,
  ToastPosition,
} from '@backpackapp-io/react-native-toast';
import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

type ToastType = 'success' | 'error' | 'info' | 'points';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Per-category accent — only used for the icon glyph (small, ~16-18 px).
// The pill itself is BlurView/tint, NOT coloured. Category identity
// comes through the icon, not a saturated fill.
const CATEGORY_ACCENT: Record<ToastCategory, string> = {
  POINTS: '#0d8575',     // brand teal — points are brand currency
  STREAK: '#f97316',     // soft orange — streak warmth
  ANTI_ABUSE: '#b45309', // amber — warning
  RATINGS: '#a855f7',    // purple
  FAVORITES: '#e11d48',  // rose — heart
  SHOPPING: '#0d8575',   // brand teal
  INFO: '#0d8575',       // brand teal — neutral but on-brand
  ERROR: '#dc2626',      // red
};

// Where the toast flies in from. Anything tied to the gamification
// economy (points, streaks, anti-spam cooldowns) drops in from the
// bottom — those are reward/feedback animations that belong near the
// score zone, not over the title bar. UI feedback (favourites,
// shopping, info, errors) stays at the top.
function positionForCategory(category: ToastCategory): ToastPosition {
  switch (category) {
    case 'POINTS':
    case 'STREAK':
    case 'ANTI_ABUSE':
      return ToastPosition.BOTTOM;
    default:
      return ToastPosition.TOP;
  }
}

const StandardToast: React.FC<{
  message: string;
  category: ToastCategory;
  actionLabel?: string;
  onActionPress?: () => void;
}> = ({ message, category, actionLabel, onActionPress }) => {
  const scheme = useColorScheme() ?? 'light';
  const accent = CATEGORY_ACCENT[category];
  const { emoji, text } = extractEmoji(message);
  const textColor = scheme === 'dark' ? '#f5f5f5' : '#191c1d';
  const isIOS = Platform.OS === 'ios';

  // Body — auto-width pill: BlurView (iOS) / opaque tinted card
  // (Android). Padding gives the icon + text breathing room without
  // making the pill bulky. maxWidth caps long messages so the pill
  // doesn't go full-screen.
  const Inner = (
    <View style={styles.inner}>
      {emoji ? (
        <Text style={styles.emoji}>{emoji}</Text>
      ) : (
        <MaterialCommunityIcons
          name={mdiForCategory(category)}
          size={16}
          color={accent}
        />
      )}
      <Text numberOfLines={3} style={[styles.text, { color: textColor }]}>
        {text}
      </Text>
      {actionLabel && onActionPress ? (
        <Pressable
          onPress={onActionPress}
          style={({ pressed }) => [
            styles.actionChip,
            { backgroundColor: accent, opacity: pressed ? 0.85 : 1 },
          ]}
          hitSlop={6}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (isIOS) {
    return (
      <View style={styles.shell}>
        <BlurView
          tint={scheme === 'dark' ? 'dark' : 'light'}
          intensity={70}
          style={styles.pill}
        >
          {Inner}
        </BlurView>
      </View>
    );
  }
  // Android: BlurView's quality on Android is poor — fall back to a
  // tinted opaque pill (slightly different from light theme.bg so
  // it reads as "above the page" rather than blending in).
  return (
    <View style={styles.shell}>
      <View
        style={[
          styles.pill,
          {
            backgroundColor:
              scheme === 'dark'
                ? 'rgba(28,30,33,0.96)'
                : 'rgba(252,252,253,0.96)',
            borderWidth: 1,
            borderColor:
              scheme === 'dark'
                ? 'rgba(255,255,255,0.08)'
                : 'rgba(0,0,0,0.08)',
          },
        ]}
      >
        {Inner}
      </View>
    </View>
  );
};

function mdiForCategory(
  category: ToastCategory,
): keyof typeof MaterialCommunityIcons.glyphMap {
  switch (category) {
    case 'POINTS':
      return 'star-four-points';
    case 'FAVORITES':
      return 'heart';
    case 'SHOPPING':
      return 'cart-outline';
    case 'RATINGS':
      return 'star-outline';
    case 'STREAK':
      return 'fire';
    case 'ERROR':
      return 'alert-circle-outline';
    case 'INFO':
      return 'information-outline';
    case 'ANTI_ABUSE':
      return 'shield-alert-outline';
    default:
      return 'information-outline';
  }
}

// Single render path used by every helper below. Every toast goes
// through here so position + visual style are consistent everywhere.
function showToast(
  message: string,
  category: ToastCategory,
  options?: {
    actionLabel?: string;
    onActionPress?: () => void;
    durationMs?: number;
    id?: string;
  },
) {
  const duration = options?.durationMs ?? getToastDuration(category);

  toast(message, {
    id: options?.id,
    position: positionForCategory(category),
    duration,
    disableShadow: true, // we draw our own shadow on the card
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast
        message={resolveValue(t.message, t) as any}
        category={category}
        actionLabel={options?.actionLabel}
        onActionPress={options?.onActionPress}
      />
    ),
  });
}

// ─── Public API (unchanged signatures) ─────────────────────────────────

export function showPointsToast(
  message: string,
  points: number,
  colorScheme?: 'light' | 'dark',
) {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  showToast(`+${points} Punkte • ${message}`, 'POINTS', { colorScheme });
}

export function showFavoriteAddedToast(
  productName: string,
  colorScheme?: 'light' | 'dark',
) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  showToast(
    interpolateMessage(TOAST_MESSAGES.FAVORITES.added, { productName }),
    'FAVORITES',
    { colorScheme },
  );
}

export function showFavoriteRemovedToast(
  productName: string,
  colorScheme?: 'light' | 'dark',
) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  showToast(
    interpolateMessage(TOAST_MESSAGES.FAVORITES.removed, { productName }),
    'FAVORITES',
    { colorScheme },
  );
}

export function showCartAddedToast(
  message?: string,
  onOpenCart?: () => void,
  colorScheme?: 'light' | 'dark',
) {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  const msg =
    message && message.trim().length > 0
      ? message
      : TOAST_MESSAGES.SHOPPING.addedToCart.replace('{productName}', 'Produkt');
  showToast(msg, 'SHOPPING', {
    actionLabel: onOpenCart ? 'Einkaufszettel' : undefined,
    onActionPress: onOpenCart,
    colorScheme,
    durationMs: 4000,
  });
}

export function showInfoToast(
  message: string,
  type: ToastType | ToastCategory = 'info',
  colorScheme?: 'light' | 'dark',
) {
  let category: ToastCategory;
  if (type === 'error') {
    category = 'ERROR';
  } else if (type === 'info') {
    category = 'INFO';
  } else if (typeof type === 'string' && type in TOAST_DURATIONS) {
    category = type as ToastCategory;
  } else {
    category = 'INFO';
  }

  Haptics.impactAsync(
    category === 'ERROR'
      ? Haptics.ImpactFeedbackStyle.Heavy
      : Haptics.ImpactFeedbackStyle.Light,
  );
  showToast(message, category, { colorScheme });
}

export function showPurchasedToast(
  message: string,
  colorScheme?: 'light' | 'dark',
) {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  showToast(message, 'SHOPPING', { colorScheme, durationMs: 2500 });
}

export function showConvertSuccessToast(
  savings: number,
  colorScheme?: 'light' | 'dark',
) {
  showToast(
    interpolateMessage(TOAST_MESSAGES.SHOPPING.convertedWithSavings, {
      savings: savings.toFixed(2),
    }),
    'SHOPPING',
    { colorScheme, durationMs: 2500 },
  );
}

export function showBulkConvertSuccessToast(
  savings: number,
  colorScheme?: 'light' | 'dark',
) {
  showToast(
    interpolateMessage(TOAST_MESSAGES.SHOPPING.bulkConvertSuccess, {
      savings: savings.toFixed(2),
    }),
    'SHOPPING',
    { colorScheme, durationMs: 2500 },
  );
}

export function showBulkPurchasedToast(
  dbCount: number,
  customCount: number,
  savings: number,
  colorScheme?: 'light' | 'dark',
) {
  let message = '';
  if (dbCount > 0 && customCount > 0) {
    message = interpolateMessage(TOAST_MESSAGES.SHOPPING.bulkPurchasedMixed, {
      totalCount: String(dbCount + customCount),
      dbCount: String(dbCount),
      customCount: String(customCount),
      savings: savings.toFixed(2),
    });
  } else if (dbCount > 0) {
    message = interpolateMessage(
      TOAST_MESSAGES.SHOPPING.bulkPurchasedProducts,
      { count: String(dbCount), savings: savings.toFixed(2) },
    );
  } else {
    message = interpolateMessage(TOAST_MESSAGES.SHOPPING.bulkPurchasedCustom, {
      count: String(customCount),
    });
  }
  showPurchasedToast(message, colorScheme);
}

export function showStreakToast(
  streakDays: number,
  bonusPoints?: number,
  colorScheme?: 'light' | 'dark',
) {
  const dayText = streakDays === 1 ? 'Tag' : 'Tage';
  const message =
    bonusPoints && bonusPoints > 0
      ? interpolateMessage(TOAST_MESSAGES.STREAK.withPoints, {
          days: String(streakDays),
          dayText,
          points: String(bonusPoints),
        })
      : interpolateMessage(TOAST_MESSAGES.STREAK.withoutPoints, {
          days: String(streakDays),
          dayText,
        });

  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  showToast(message, 'STREAK', {
    colorScheme,
    durationMs: 3000,
    id: 'streak-toast',
  });
}

export function showRatingToast(
  message: string,
  type: ToastType = 'success',
  colorScheme?: 'light' | 'dark',
) {
  const category: ToastCategory = type === 'error' ? 'ERROR' : 'RATINGS';
  showToast(message, category, { colorScheme, durationMs: 2000 });
}

export function showAlreadyInCartToast(
  onOpenCart?: () => void,
  colorScheme?: 'light' | 'dark',
) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  showToast(TOAST_MESSAGES.SHOPPING.alreadyInCart, 'INFO', {
    actionLabel: onOpenCart ? 'Einkaufszettel' : undefined,
    onActionPress: onOpenCart,
    colorScheme,
    durationMs: 4000,
  });
}

const styles = StyleSheet.create({
  // Outer wrapper — centers the auto-width pill inside the toast lib's
  // full-width container.
  shell: {
    width: SCREEN_WIDTH,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  // Pill — auto-width, max-width 90% of the screen so very long
  // messages still fit without going edge-to-edge.
  pill: {
    maxWidth: SCREEN_WIDTH * 0.9,
    borderRadius: 999,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 9,
    gap: 8,
  },
  emoji: {
    fontSize: 16,
    lineHeight: 20,
  },
  text: {
    flexShrink: 1,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    lineHeight: 17,
  },
  actionChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    marginLeft: 4,
  },
  actionText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 12,
    color: '#fff',
  },
});
