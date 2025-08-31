import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { extractEmoji, getToastDuration, getToastTheme, interpolateMessage, TOAST_DURATIONS, TOAST_MESSAGES, ToastCategory } from '@/constants/ToastMessages';
import { useColorScheme } from '@/hooks/useColorScheme';
import { resolveValue, Toast as RNToast, toast, ToastPosition } from '@backpackapp-io/react-native-toast';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type ToastType = 'success' | 'error' | 'info' | 'points';  // Legacy für Kompatibilität

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * Base Toast Helper - mit konfigurierbaren Anzeigezeiten
 */
const showToastWithDuration = (
  message: string, 
  category: ToastCategory, 
  options?: {
    actionLabel?: string;
    onActionPress?: () => void;
    spinIcon?: boolean;
    colorScheme?: 'light' | 'dark';
  }
) => {
  const scheme = options?.colorScheme || getCurrentColorScheme();
  
  toast(message, {
    position: ToastPosition.TOP,
    duration: getToastDuration(category), // 🎯 Konfigurierbare Dauer
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast 
        message={resolveValue(t.message, t) as any}
        category={category}
        actionLabel={options?.actionLabel}
        onActionPress={options?.onActionPress}
        spinIcon={options?.spinIcon}
        toast={t}
        colorScheme={scheme}
      />
    ),
  });
};

const StandardToast: React.FC<{
  message: string;
  category?: ToastCategory;
  actionLabel?: string;
  onActionPress?: () => void;
  spinIcon?: boolean;
  toast?: RNToast;  // Toast props für width/height
  colorScheme?: 'light' | 'dark';  // Expliziter colorScheme Parameter
}> = ({ message, category = 'INFO', actionLabel, onActionPress, spinIcon, toast: toastProps, colorScheme: explicitColorScheme }) => {
  const hookColorScheme = useColorScheme();
  const effectiveColorScheme = explicitColorScheme || hookColorScheme || 'light';
  const colors = Colors[effectiveColorScheme];
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (spinIcon) {
      rotateAnim.setValue(0);
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [spinIcon, rotateAnim]);

  // Extrahiere Emoji aus Message
  const { emoji, text } = extractEmoji(message);
  
  // Theme-basierte Farben (Light/Dark Mode Support)
  const toastTheme = getToastTheme(effectiveColorScheme);
  const categoryTheme = toastTheme[category];
  
  const rotate = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={[styles.toastContainer, { 
      backgroundColor: categoryTheme.background, 
      width: SCREEN_WIDTH - 24,
      marginHorizontal: 12  // Gleicher Abstand links/rechts
    }]}>      
      <Animated.View style={[styles.iconContainer, spinIcon ? { transform: [{ rotate }] } : undefined]}>        
        <Text style={styles.emojiIcon}>{emoji}</Text>
      </Animated.View>
      <Text style={[styles.toastText, { color: categoryTheme.text }]} numberOfLines={3}>{text}</Text>
      {actionLabel && onActionPress && (
        <TouchableOpacity 
          style={[styles.actionButton, { backgroundColor: categoryTheme.button.background }]} 
          onPress={onActionPress}
        >
          <Text style={[styles.actionButtonText, { color: categoryTheme.button.text }]}>{actionLabel}</Text>
          <IconSymbol name="chevron.right" size={14} color={categoryTheme.button.text} />
        </TouchableOpacity>
      )}
    </View>
  );
};

// Helper: Bekomme colorScheme für Toast-Funktionen
function getCurrentColorScheme(): 'light' | 'dark' {
  // Da Hook nicht in Funktionen verwendbar ist, nutzen wir System-Detection
  // Oder falls verfügbar: global colorScheme variable
  if (typeof (global as any).__colorScheme !== 'undefined') {
    return (global as any).__colorScheme;
  }
  // Fallback: Light Mode
  return 'light';
}

export function showPointsToast(message: string, points: number, colorScheme?: 'light' | 'dark') {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  const finalMessage = `+${points} Punkte • ${message}`;
  
  // 🎯 Verwende neue konfigurierbare Anzeigezeit (3000ms für POINTS)
  showToastWithDuration(finalMessage, 'POINTS', { colorScheme });
}

export function showFavoriteAddedToast(productName: string, colorScheme?: 'light' | 'dark') {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  const message = interpolateMessage(TOAST_MESSAGES.FAVORITES.added, { productName });
  const scheme = colorScheme || getCurrentColorScheme();
  const category: ToastCategory = 'FAVORITES';
  
  toast(message, {
    position: ToastPosition.TOP,
    duration: getToastDuration(category),
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast message={resolveValue(t.message, t) as any} category={category} toast={t} colorScheme={scheme} />
    ),
  });
}

export function showFavoriteRemovedToast(productName: string, colorScheme?: 'light' | 'dark') {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  const message = interpolateMessage(TOAST_MESSAGES.FAVORITES.removed, { productName });
  const scheme = colorScheme || getCurrentColorScheme();
  const category: ToastCategory = 'FAVORITES';
  
  toast(message, {
    position: ToastPosition.TOP,
    duration: getToastDuration(category),
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast message={resolveValue(t.message, t) as any} category={category} toast={t} colorScheme={scheme} />
    ),
  });
}

export function showCartAddedToast(message?: string, onOpenCart?: () => void, colorScheme?: 'light' | 'dark') {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  const msg = (message && message.trim().length > 0) ? message : TOAST_MESSAGES.SHOPPING.addedToCart.replace('{productName}', 'Produkt');
  const scheme = colorScheme || getCurrentColorScheme();
  
  toast(msg, {
    position: ToastPosition.TOP,
    duration: 4000,
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast
        message={resolveValue(t.message, t) as any}
        category="SHOPPING"
        actionLabel="Einkaufszettel"
        onActionPress={onOpenCart}
        toast={t}
        colorScheme={scheme}
       />
    ),
  });
}

export function showInfoToast(message: string, type: ToastType | ToastCategory = 'info', colorScheme?: 'light' | 'dark') {
  // Legacy ToastType Support + neue ToastCategory Support
  let category: ToastCategory;
  if (type === 'error') {
    category = 'ERROR';
  } else if (type === 'info') {
    category = 'INFO';
  } else if (typeof type === 'string' && type in TOAST_DURATIONS) {
    category = type as ToastCategory; // Direkte Kategorie-Übergabe (für ANTI_ABUSE etc.)
  } else {
    category = 'INFO'; // Fallback
  }
  
  Haptics.impactAsync(category === 'ERROR' ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light);
  showToastWithDuration(message, category, { colorScheme });
}

export function showPurchasedToast(message: string, colorScheme?: 'light' | 'dark') {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  const scheme = colorScheme || getCurrentColorScheme();
  
  toast(message, {
    position: ToastPosition.TOP,
    duration: 2500,
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast message={resolveValue(t.message, t) as any} category="SHOPPING" spinIcon toast={t} colorScheme={scheme} />
    ),
  });
}

// 🛒 SPEZIELLE SHOPPING-TOAST HELPERS  
export function showConvertSuccessToast(savings: number, colorScheme?: 'light' | 'dark') {
  const message = interpolateMessage(TOAST_MESSAGES.SHOPPING.convertedWithSavings, { 
    savings: savings.toFixed(2) 
  });
  const scheme = colorScheme || getCurrentColorScheme();
  
  toast(message, {
    position: ToastPosition.TOP,
    duration: 2500,
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast message={resolveValue(t.message, t) as any} category="SHOPPING" toast={t} colorScheme={scheme} />
    ),
  });
}

export function showBulkConvertSuccessToast(savings: number, colorScheme?: 'light' | 'dark') {
  const message = interpolateMessage(TOAST_MESSAGES.SHOPPING.bulkConvertSuccess, { 
    savings: savings.toFixed(2) 
  });
  const scheme = colorScheme || getCurrentColorScheme();
  
  toast(message, {
    position: ToastPosition.TOP,
    duration: 2500,
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast message={resolveValue(t.message, t) as any} category="SHOPPING" toast={t} colorScheme={scheme} />
    ),
  });
}

export function showBulkPurchasedToast(dbCount: number, customCount: number, savings: number, colorScheme?: 'light' | 'dark') {
  let message = '';
  if (dbCount > 0 && customCount > 0) {
    message = interpolateMessage(TOAST_MESSAGES.SHOPPING.bulkPurchasedMixed, {
      totalCount: String(dbCount + customCount),
      dbCount: String(dbCount),
      customCount: String(customCount),
      savings: savings.toFixed(2)
    });
  } else if (dbCount > 0) {
    message = interpolateMessage(TOAST_MESSAGES.SHOPPING.bulkPurchasedProducts, {
      count: String(dbCount),
      savings: savings.toFixed(2)
    });
  } else {
    message = interpolateMessage(TOAST_MESSAGES.SHOPPING.bulkPurchasedCustom, {
      count: String(customCount)
    });
  }
  showPurchasedToast(message, colorScheme);
}

// 🔥 STREAK-TOAST HELPER (neue Library, STREAK-Farbe)
export function showStreakToast(streakDays: number, bonusPoints?: number, colorScheme?: 'light' | 'dark') {
  const dayText = streakDays === 1 ? 'Tag' : 'Tage';
  const message = bonusPoints && bonusPoints > 0
    ? interpolateMessage(TOAST_MESSAGES.STREAK.withPoints, { 
        days: String(streakDays), 
        dayText, 
        points: String(bonusPoints) 
      })
    : interpolateMessage(TOAST_MESSAGES.STREAK.withoutPoints, { 
        days: String(streakDays), 
        dayText 
      });

  const scheme = colorScheme || getCurrentColorScheme();
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  
  toast(message, {
    position: ToastPosition.TOP,
    duration: 3000,
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast message={resolveValue(t.message, t) as any} category="STREAK" toast={t} colorScheme={scheme} />
    ),
  });
}

// ⭐ RATING-TOAST HELPER (RATINGS-Farbe)
export function showRatingToast(message: string, type: ToastType = 'success', colorScheme?: 'light' | 'dark') {
  const category: ToastCategory = type === 'error' ? 'ERROR' : 'RATINGS';
  const scheme = colorScheme || getCurrentColorScheme();
  
  toast(message, {
    position: ToastPosition.TOP,
    duration: 2000,
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast message={resolveValue(t.message, t) as any} category={category} toast={t} colorScheme={scheme} />
    ),
  });
}

// 🛒 SPEZIAL: "Bereits im Einkaufszettel" mit CTA-Button
export function showAlreadyInCartToast(onOpenCart?: () => void, colorScheme?: 'light' | 'dark') {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  const scheme = colorScheme || getCurrentColorScheme();
  
  toast(TOAST_MESSAGES.SHOPPING.alreadyInCart, {
    position: ToastPosition.TOP,
    duration: 4000,
    disableShadow: false,
    width: SCREEN_WIDTH,
    styles: { view: { backgroundColor: 'transparent' } },
    customToast: (t: RNToast) => (
      <StandardToast
        message={resolveValue(t.message, t) as any}
        category="INFO"
        actionLabel="Einkaufszettel"
        onActionPress={onOpenCart}
        toast={t}
        colorScheme={scheme}
      />
    ),
  });
}

const styles = StyleSheet.create({
  toastContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    minHeight: 56,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  iconContainer: {
    marginRight: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastText: {
    fontSize: 15,
    fontFamily: 'Nunito_600SemiBold',
    flex: 1,
    // color wird dynamisch über Theme gesetzt
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginLeft: 12,
    gap: 4,
    // backgroundColor wird dynamisch über Theme gesetzt
  },
  actionButtonText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    // color wird dynamisch über Theme gesetzt
  },
  emojiIcon: {
    fontSize: 20,
    textAlign: 'center',
    lineHeight: 24,  // Für perfekte Zentrierung
  },
});


