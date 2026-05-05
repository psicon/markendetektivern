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
import { Colors } from '@/constants/Colors';
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
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

type ToastType = 'success' | 'error' | 'info' | 'points';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Per-category accent colour. Used for the icon-circle tint + the
// optional action chip background. The card itself stays neutral
// (theme.surface) regardless of category.
const CATEGORY_ACCENT: Record<ToastCategory, string> = {
  POINTS: '#bf9b30',
  FAVORITES: '#e87676',
  SHOPPING: '#0d8575',
  RATINGS: '#9c27b0',
  STREAK: '#ff9800',
  ERROR: '#dc2626',
  INFO: '#2196f3',
  ANTI_ABUSE: '#FF9500',
};

// Where the toast flies in from. Gamification rewards appear at the
// bottom; everything else (UI feedback, errors, info) appears at the
// top. Single source of truth — change here, propagates everywhere.
function positionForCategory(category: ToastCategory): ToastPosition {
  return category === 'POINTS' || category === 'STREAK'
    ? ToastPosition.BOTTOM
    : ToastPosition.TOP;
}

function getCurrentColorScheme(): 'light' | 'dark' {
  if (typeof (global as any).__colorScheme !== 'undefined') {
    return (global as any).__colorScheme;
  }
  return 'light';
}

const StandardToast: React.FC<{
  message: string;
  category: ToastCategory;
  actionLabel?: string;
  onActionPress?: () => void;
  colorScheme?: 'light' | 'dark';
}> = ({
  message,
  category,
  actionLabel,
  onActionPress,
  colorScheme: explicitColorScheme,
}) => {
  const hookColorScheme = useColorScheme();
  const scheme = explicitColorScheme || hookColorScheme || 'light';
  const colors = Colors[scheme];
  const accent = CATEGORY_ACCENT[category];
  const { emoji, text } = extractEmoji(message);

  // Card surface — surface from the palette, never the saturated
  // category colour. Border + shadow give it definition without
  // shouting.
  const surface = colors.surface ?? (scheme === 'dark' ? '#1a1d1f' : '#ffffff');
  const borderColor =
    scheme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const textColor = colors.text ?? (scheme === 'dark' ? '#f5f5f5' : '#191c1d');

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: surface,
          borderColor,
          width: SCREEN_WIDTH - 24,
        },
      ]}
    >
      {/* Icon-circle — accent colour at 18% alpha so the card stays
          calm but the category is still clearly recognisable. */}
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: hexWithAlpha(accent, 0.18) },
        ]}
      >
        {emoji ? (
          <Text style={styles.emoji}>{emoji}</Text>
        ) : (
          <MaterialCommunityIcons
            name={mdiForCategory(category)}
            size={18}
            color={accent}
          />
        )}
      </View>

      {/* Body text — single line of crisp message. numberOfLines=2
          for the rare case a translated string spills over. */}
      <Text
        numberOfLines={2}
        style={[styles.text, { color: textColor }]}
      >
        {text}
      </Text>

      {/* Optional action chip — accent-coloured, white text. */}
      {actionLabel && onActionPress ? (
        <Pressable
          onPress={onActionPress}
          style={({ pressed }) => [
            styles.actionChip,
            {
              backgroundColor: accent,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          hitSlop={6}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
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

// Append an alpha to a 6-char hex colour. `#0d8575` + 0.18 → '#0d857529'.
function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

// Single render path used by every helper below. Every toast goes
// through here so position + visual style are consistent everywhere.
function showToast(
  message: string,
  category: ToastCategory,
  options?: {
    actionLabel?: string;
    onActionPress?: () => void;
    colorScheme?: 'light' | 'dark';
    durationMs?: number;
    id?: string;
  },
) {
  const scheme = options?.colorScheme || getCurrentColorScheme();
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
        colorScheme={scheme}
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
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    minHeight: 52,
    borderWidth: 1,
    marginHorizontal: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  emoji: {
    fontSize: 18,
    lineHeight: 22,
  },
  text: {
    flex: 1,
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 14,
    lineHeight: 18,
  },
  actionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    marginLeft: 10,
  },
  actionText: {
    fontFamily: 'Nunito_600SemiBold',
    fontSize: 13,
    color: '#fff',
  },
});
