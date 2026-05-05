/**
 * Toast helpers — calm card-style design.
 *
 * Design rationale (User: "die levelup meldungen (neu) sind schöner.
 * orientiere dich daran"):
 *  • White / surface card backdrop, NOT a saturated full-width colour
 *    block. The category accent only shows up in a small icon-circle
 *    on the left + the optional action chip on the right.
 *  • Subtle shadow + rounded corners, looks like every other card in
 *    the app.
 *  • Lower vertical presence — the old toasts were 56-px slabs of
 *    primary colour that hijacked the eye. New ones are quiet
 *    confirmations.
 *
 * Position by category (User: "alles was mit gamification zu tun hat
 * soll unten einfliegen. alle anderen meldungen oben"):
 *   • POINTS, STREAK            → BOTTOM (gamification rewards)
 *   • All others                → TOP    (UI feedback / errors / info)
 */
import {
  extractEmoji,
  getToastDuration,
  TOAST_DURATIONS,
  TOAST_MESSAGES,
  ToastCategory,
  interpolateMessage,
} from '@/constants/ToastMessages';
import {
  resolveValue,
  Toast as RNToast,
  toast,
  ToastPosition,
} from '@backpackapp-io/react-native-toast';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

type ToastType = 'success' | 'error' | 'info' | 'points';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Per-category gradient — same vibe as LevelUp / Achievement-Unlock
// overlays (saturated start → slightly darker end, white content on
// top). Toast carries the category identity through its colour, not
// through a tiny tinted circle on a white card.
const CATEGORY_GRADIENT: Record<ToastCategory, [string, string]> = {
  POINTS: ['#f0b938', '#bf9b30'],
  STREAK: ['#ffa940', '#ff7a00'],
  ANTI_ABUSE: ['#ffb340', '#e07b00'],
  RATINGS: ['#b15dd1', '#7e2aa8'],
  FAVORITES: ['#f08a8a', '#c84d4d'],
  SHOPPING: ['#10a18a', '#0a6f62'],
  INFO: ['#3aa4ee', '#1976d2'],
  ERROR: ['#ee5044', '#c0271b'],
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
  const gradient = CATEGORY_GRADIENT[category];
  const { emoji, text } = extractEmoji(message);

  return (
    <LinearGradient
      colors={gradient}
      start={{ x: -0.5, y: 0 }}
      end={{ x: 1.2, y: 1 }}
      style={[styles.card, { width: SCREEN_WIDTH - 24 }]}
    >
      {/* Icon-circle on translucent white — same pattern as the
          LevelUp / Achievement-Unlock overlays so the visual family
          is consistent. */}
      <View style={styles.iconCircle}>
        {emoji ? (
          <Text style={styles.emoji}>{emoji}</Text>
        ) : (
          <MaterialCommunityIcons
            name={mdiForCategory(category)}
            size={18}
            color="#fff"
          />
        )}
      </View>

      {/* Body text — up to 3 lines so longer ANTI_ABUSE / ERROR
          messages don't clip. Font is small enough to fit, big
          enough to read at arm's length. */}
      <Text numberOfLines={3} style={styles.text}>
        {text}
      </Text>

      {/* Optional action chip — translucent white, white text, same
          shape as the icon-circle so the right side feels balanced. */}
      {actionLabel && onActionPress ? (
        <Pressable
          onPress={onActionPress}
          style={({ pressed }) => [
            styles.actionChip,
            { opacity: pressed ? 0.85 : 1 },
          ]}
          hitSlop={6}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </LinearGradient>
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    minHeight: 56,
    marginHorizontal: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 6,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  emoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  text: {
    flex: 1,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    lineHeight: 17,
    color: '#fff',
  },
  actionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    marginLeft: 10,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  actionText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: '#fff',
  },
});
