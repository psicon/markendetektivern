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

// Per-category palette — `bg` is a 2-stop pastel gradient applied to
// the pill background, `accent` is the saturated version of the same
// hue used for the icon and the text. Picked so the toast hints at
// its category (gold = reward, green = positive shopping, red =
// removal, gray = neutral) without ever shouting. Direct user spec:
//   "Punkte → minimal goldene Pille"
//   "Favs → minimal rot/lila"
//   "Aus Einkaufsliste entfernen → minimal rot"
//   "Gekauft / umgewandelt → leicht grün"
//   "Anti-Fraud → grau mit Verlauf"
type CategoryStyle = { bg: [string, string]; accent: string };
const CATEGORY_STYLE: Record<ToastCategory, CategoryStyle> = {
  POINTS: { bg: ['#fef3c7', '#fde68a'], accent: '#b45309' },     // gold / amber
  STREAK: { bg: ['#ffedd5', '#fed7aa'], accent: '#c2410c' },     // soft orange
  ANTI_ABUSE: { bg: ['#f3f4f6', '#e5e7eb'], accent: '#4b5563' }, // gray
  RATINGS: { bg: ['#ede9fe', '#ddd6fe'], accent: '#6d28d9' },    // soft purple
  FAVORITES: { bg: ['#fce7f3', '#fbcfe8'], accent: '#be185d' },  // rose / pink
  SHOPPING: { bg: ['#d1fae5', '#a7f3d0'], accent: '#047857' },   // soft green
  INFO: { bg: ['#f3f4f6', '#e5e7eb'], accent: '#374151' },       // gray
  ERROR: { bg: ['#fee2e2', '#fecaca'], accent: '#b91c1c' },      // soft red
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
  // We intentionally keep the same pastel palette for both light and
  // dark schemes — the pill's job is to be a small, attention-getting
  // chip that briefly hovers over the page. The pastels are calm
  // enough to read in light mode and pop just enough on a dark
  // background.
  const { bg, accent } = CATEGORY_STYLE[category];
  const { emoji, text } = extractEmoji(message);
  // Saturated icon + text colour = same hue family as the pill bg,
  // but darker. Reads like a "stamp" on the chip.
  const textColor = accent;
  // Soft 1-px border in the accent at low alpha so the pill has
  // definition without an outline-shouting effect.
  const borderColor = accent + '33'; // ~20% alpha

  return (
    <View style={styles.shell}>
      <LinearGradient
        colors={bg}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.pill, { borderColor }]}
      >
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
          <Text
            numberOfLines={2}
            style={[styles.text, { color: textColor }]}
          >
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
      </LinearGradient>
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

// ─── Retry-Error-Toast ────────────────────────────────────────
//
// Standardpattern für Network-Fail im kritischen Pfad: Toast mit
// User-friendly Message + "Wiederholen"-Action-Chip. User-Wunsch
// aus dem UX-Audit (U2): "Kassenbon-Scan, Login, Receipt-Submit
// bei Network-Fail keine Fehlermeldung". Mit dieser Funktion
// lässt sich überall ein konsistenter Retry-Toast feuern.
//
// Beispiel:
//   try { await uploadReceipt(...); }
//   catch {
//     showRetryableErrorToast(
//       'Bon konnte nicht hochgeladen werden — Verbindung prüfen.',
//       () => uploadReceipt(...),
//     );
//   }
//
// Die Action-Pille bleibt bis User tappt oder Toast manuell wegswiped
// (durationMs: 8000 = lang). Standard-Errors ohne Retry sollten
// stattdessen `showInfoToast(msg, 'error')` nutzen.
export function showRetryableErrorToast(
  message: string,
  onRetry: () => void,
  options?: { actionLabel?: string; colorScheme?: 'light' | 'dark' },
) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  showToast(message, 'ERROR', {
    actionLabel: options?.actionLabel ?? 'Wiederholen',
    onActionPress: onRetry,
    colorScheme: options?.colorScheme,
    durationMs: 8000,
  });
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
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
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
