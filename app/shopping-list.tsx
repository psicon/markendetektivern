// app/shopping-list.tsx
//
// Einkaufszettel — neu im Design-System:
//   • DetailHeader (Back + Title + Filter + Plus) als chrome
//   • SegmentedTabs + PagerView für Marken / NoNames / Alle
//   • FilterSheet statt FixedAndroidModal
//   • Theme-Tokens via useTokens (statt Colors[colorScheme])
//   • Swipe-Gesten auf jedem Eintrag (Pan + Reanimated 3):
//     – Rechts wischen → als gekauft markieren
//     – Links wischen  → löschen
//   • "Alle Produkte"-Tab zeigt Marken + NoNames vermischt für
//     den Einkaufsalltag (kein Tab-Wechsel mehr beim Einkauf)
//   • Bottom-CTA passt sich pro Tab an (Umwandeln / Alle gekauft)
//   • Crossfade-Skeleton während Initial-Load
//
// Funktionalität bleibt 1:1 erhalten:
//   – getShoppingCartItems / convertToNoName / markAsPurchased(WithoutTracking)
//   – removeFromShoppingCart, updateUserStats, updateUserTotalSavings
//   – Achievement-Tracking (convert_product, complete_shopping)
//   – Journey-Tracking, Analytics-Events
//   – BatchActionLoader, AddCustomItemModal, LevelUpOverlay

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import PagerView from 'react-native-pager-view';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BannerAd } from '@/components/ads/BannerAd';
import { DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import {
  FilterSheet,
  OptionList,
} from '@/components/design/FilterSheet';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { Crossfade, Shimmer } from '@/components/design/Skeletons';
import { AddCustomItemModal } from '@/components/ui/AddCustomItemModal';
import BatchActionLoader from '@/components/ui/BatchActionLoader';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { LevelUpOverlay } from '@/components/ui/LevelUpOverlay';
import { TOAST_MESSAGES } from '@/constants/ToastMessages';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { getProductImage } from '@/lib/utils/productImage';
import { calculateSavings } from '@/lib/utils/savings';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useRevenueCat } from '@/lib/contexts/RevenueCatProvider';
import achievementService from '@/lib/services/achievementService';
import { categoryAccessService } from '@/lib/services/categoryAccessService';
import { FirestoreService } from '@/lib/services/firestore';
import {
  showBulkConvertSuccessToast,
  showBulkPurchasedToast,
  showConvertSuccessToast,
  showInfoToast,
  showPurchasedToast,
} from '@/lib/services/ui/toast';
import { updateUserStats } from '@/lib/services/userProfile';
import {
  Einkaufswagen,
  FirestoreDocument,
  MarkenProdukte,
  ProductToConvert,
  Produkte,
} from '@/lib/types/firestore';

// ─── Types ─────────────────────────────────────────────────────────
type Tab = 'brand' | 'noname' | 'all';
type SortBy = 'name' | 'price' | 'savings';

type RowKind = 'brand' | 'noname' | 'custom-brand' | 'custom-noname';

type EnrichedItem = {
  id: string;
  kind: RowKind;
  // brand items
  markenProduktRef?: string;
  product?: any;
  alternatives?: any[];
  bestAlternative?: any;
  potentialSavings?: number;
  // noname items
  savings?: number;
  // custom items
  isCustom?: boolean;
  name?: string;
  customType?: 'brand' | 'noname';
  /** MaterialCommunityIcons name picked by the user when creating
   *  the custom item. Falls back to a generic cart icon if missing
   *  (legacy custom items predating the icon picker). */
  customIcon?: string;
  markt?: { name?: string; land?: string; bild?: string } | null;
};

// Height of the sticky SegmentedTabs row that sits below the DetailHeader.
// Used both to size the absolute container and to pad the scrollable
// content so the first item lands BELOW the bar.
const SEG_BAR_HEIGHT = 64;

const SORT_OPTIONS_BRAND: readonly (readonly [SortBy, string])[] = [
  ['name', 'Name (A–Z)'],
  ['price', 'Preis aufsteigend'],
] as const;

const SORT_OPTIONS_NONAME: readonly (readonly [SortBy, string])[] = [
  ['name', 'Name (A–Z)'],
  ['price', 'Preis aufsteigend'],
  ['savings', 'Höchste Ersparnis'],
] as const;

// ─── Helpers ───────────────────────────────────────────────────────

// Ersparnis-Berechnung delegiert an den shared util
// `lib/utils/savings.ts`. Vorher hatten product-comparison und
// shopping-list zwei verschiedene Implementierungen — der eine
// rechnete absolute Preise, der andere per-pack-unit. Resultat:
// dasselbe Produkt zeigte je nach Screen unterschiedliche
// Ersparnis-Werte. Jetzt single source of truth.
const getSavingsData = (
  brandProduct: any,
  noNameProduct: any,
): { savingsEur: number; savingsPercent: number } => {
  const r = calculateSavings(brandProduct, noNameProduct);
  return {
    savingsEur: Math.round(r.eur * 100) / 100,
    savingsPercent: r.pct,
  };
};

const formatEur = (n: number) =>
  `${(n || 0).toFixed(2).replace('.', ',')} €`;

// ═══════════════════════════════════════════════════════════════════
// Skeletons
// ═══════════════════════════════════════════════════════════════════
function ShoppingListSkeleton() {
  const { theme } = useTokens();
  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 140 }}
      scrollEnabled={false}
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View
          key={i}
          style={{
            backgroundColor: theme.surface,
            borderRadius: 14,
            padding: 12,
            marginBottom: 10,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          <Shimmer width={62} height={62} radius={10} />
          <View style={{ flex: 1, gap: 6 }}>
            <Shimmer width="40%" height={10} radius={4} />
            <Shimmer width="80%" height={14} radius={4} />
            <Shimmer width="55%" height={12} radius={4} />
          </View>
          <View style={{ gap: 6 }}>
            <Shimmer width={34} height={34} radius={17} />
            <Shimmer width={34} height={34} radius={17} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Chrome — one absolute-positioned chrome surface that holds BOTH the
// back/title row AND the sticky SegmentedTabs in a SINGLE BlurView.
// Two stacked BlurViews on iOS show a visible seam (each samples its
// own backdrop), so we inline the DetailHeader-style row here and put
// SegmentedTabs right below it inside the same surface. Android falls
// back to a tinted opaque View per CLAUDE.md.
// ═══════════════════════════════════════════════════════════════════
type ChromeProps = {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
  /** SegmentedTabs (or any sticky widget) rendered below the title row. */
  bottom: React.ReactNode;
};

function Chrome({ title, onBack, right, bottom }: ChromeProps) {
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
      <View style={{ flex: 1, position: 'relative', height: 24, justifyContent: 'center' }}>
        <Text
          numberOfLines={1}
          style={{
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
      {right ? <View style={{ marginLeft: 4 }}>{right}</View> : null}
    </View>
  );

  const Bottom = (
    <View
      style={{
        height: SEG_BAR_HEIGHT,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 12,
        justifyContent: 'center',
      }}
    >
      {bottom}
    </View>
  );

  const containerStyle = {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingTop: insets.top,
  };

  if (isIOS) {
    return (
      <BlurView
        tint={scheme === 'dark' ? 'dark' : 'light'}
        intensity={80}
        style={containerStyle}
      >
        {Row}
        {Bottom}
      </BlurView>
    );
  }

  return (
    <View
      style={[
        containerStyle,
        {
          backgroundColor:
            scheme === 'dark' ? 'rgba(15,18,20,0.92)' : 'rgba(245,247,248,0.92)',
        },
      ]}
    >
      {Row}
      {Bottom}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SwipeRow — Pan-Gesture wraps a row.
//   • Rechts wischen ≥ THRESH px → onSwipeBought, fling rechts raus
//   • Links wischen  ≤ -THRESH    → onSwipeDelete, fling links raus
//   • Backgrounds zeigen unter dem Row die Aktion
// ═══════════════════════════════════════════════════════════════════
const SWIPE_THRESH = 90;
const SWIPE_FLING_OFFSCREEN = 600;

type SwipeRowProps = {
  children: React.ReactNode;
  onSwipeBought: () => void;
  onSwipeDelete: () => void;
  disabled?: boolean;
};

const ROW_GAP = 10; // marginBottom between rows in normal flow
const SWIPE_FLING_DURATION = 200;
const COLLAPSE_DURATION = 260;

function SwipeRow({ children, onSwipeBought, onSwipeDelete, disabled }: SwipeRowProps) {
  const { theme, brand } = useTokens();
  const tx = useSharedValue(0);
  // collapse: 0 = full row visible, 1 = fully collapsed (height 0, opacity 0)
  const collapse = useSharedValue(0);
  // Measured intrinsic height of the row content. Until measured we
  // don't constrain height (let layout compute naturally).
  const [measuredHeight, setMeasuredHeight] = useState<number>(0);
  // Phase tracking — used to detect the "action failed silently" case
  // and re-open the row so it doesn't disappear from UI on error.
  const [phase, setPhase] = useState<'idle' | 'collapsing'>('idle');

  const onLayout = useCallback(
    (e: any) => {
      // Re-measure auf jedem Layout-Pass während die Row IDLE ist
      // (= nicht im Collapse). Damit reflektiert measuredHeight die
      // tatsächliche aktuelle Höhe — z.B. wenn der User eine
      // BrandCard ausklappt und die Inner-Content von 80 auf 280 px
      // wächst. Während des Collapse-Übergangs ignorieren wir
      // Layout-Updates, sonst springt die Animation mid-flight.
      //
      // User-Bug-Report (vorher "Capture once"): "beim einkaufszettel
      // kann ich nicht mehr ausklappen bei marken — er toggelt aber
      // es ist nichts zu sehen". Der Inhalt wurde gerendert, aber
      // die SwipeRow-Wrapper-Höhe blieb auf dem initial gemessenen
      // collapsed-Wert geklemmt → expand wurde gechlippt.
      if (phase !== 'idle') return;
      const h = e.nativeEvent.layout.height;
      if (h > 0 && h !== measuredHeight) {
        setMeasuredHeight(h);
      }
    },
    [measuredHeight, phase],
  );

  const enterCollapse = () => setPhase('collapsing');

  const triggerBought = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onSwipeBought();
  };
  const triggerDelete = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    onSwipeDelete();
  };

  // Safety net: if the parent doesn't unmount us within ~2.5s after
  // collapse completes (action failed and parent didn't remove the
  // item), re-open the row so it stays visible. The user already saw
  // an error toast — we don't want them to also lose the row from UI.
  useEffect(() => {
    if (phase !== 'collapsing') return;
    const timer = setTimeout(() => {
      // Still mounted → parent didn't remove. Reset.
      tx.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
      collapse.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
      setPhase('idle');
    }, 2500);
    return () => clearTimeout(timer);
  }, [phase, tx, collapse]);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .enabled(!disabled && phase === 'idle')
    .onUpdate((e) => {
      tx.value = e.translationX;
    })
    .onEnd((e) => {
      const dx = e.translationX;
      if (dx >= SWIPE_THRESH) {
        // Fling foreground off (fast) and collapse the WHOLE row in
        // parallel — height + margin + opacity all to 0 over ~260 ms.
        // Action callback fires WHILE collapse is running so the API
        // round-trip overlaps with the visual cleanup, not after it.
        tx.value = withTiming(SWIPE_FLING_OFFSCREEN, {
          duration: SWIPE_FLING_DURATION,
          easing: Easing.in(Easing.cubic),
        });
        collapse.value = withTiming(
          1,
          { duration: COLLAPSE_DURATION, easing: Easing.in(Easing.cubic) },
          (done) => {
            if (done) runOnJS(triggerBought)();
          },
        );
        runOnJS(enterCollapse)();
      } else if (dx <= -SWIPE_THRESH) {
        tx.value = withTiming(-SWIPE_FLING_OFFSCREEN, {
          duration: SWIPE_FLING_DURATION,
          easing: Easing.in(Easing.cubic),
        });
        collapse.value = withTiming(
          1,
          { duration: COLLAPSE_DURATION, easing: Easing.in(Easing.cubic) },
          (done) => {
            if (done) runOnJS(triggerDelete)();
          },
        );
        runOnJS(enterCollapse)();
      } else {
        // Snap back to rest position with a calmer spring-style ease-out.
        tx.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
      }
    });

  const fgStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));
  const boughtBgStyle = useAnimatedStyle(() => ({
    opacity: tx.value > 8 ? 1 : 0,
  }));
  const deleteBgStyle = useAnimatedStyle(() => ({
    opacity: tx.value < -8 ? 1 : 0,
  }));

  // Wrapper animates height + marginBottom + opacity together, so the
  // row collapses into the gap und die rows below sliden hoch.
  //
  // Wichtig: nur DURING dem Collapse (collapse.value > 0) klemmen wir
  // die Höhe auf measuredHeight. Im Idle-State (collapse.value === 0)
  // lassen wir die Höhe frei — sonst würde ein expanded BrandCard
  // (Inner-Content wächst) auf den initial gemessenen Wert geclippt.
  const wrapperStyle = useAnimatedStyle(() => {
    if (measuredHeight === 0 || collapse.value === 0) {
      // Nicht messbar oder im Idle: natürliches Layout, kein Clamp.
      return { marginBottom: ROW_GAP, opacity: 1 };
    }
    return {
      height: interpolate(
        collapse.value,
        [0, 1],
        [measuredHeight, 0],
        Extrapolation.CLAMP,
      ),
      marginBottom: interpolate(
        collapse.value,
        [0, 1],
        [ROW_GAP, 0],
        Extrapolation.CLAMP,
      ),
      opacity: interpolate(collapse.value, [0, 1], [1, 0], Extrapolation.CLAMP),
    };
  });

  return (
    <Animated.View
      onLayout={onLayout}
      style={[{ position: 'relative', overflow: 'hidden' }, wrapperStyle]}
    >
      {/* Action backgrounds — full-bleed, stacked. Each layer fills
          the entire row; opacity is toggled by swipe direction so
          only ONE colour is ever visible (no green/red side-by-side
          cut). The icon+label sit on the side from which the
          foreground is pulled away (left for bought / right for
          delete) so the user "drags toward" the action. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          borderRadius: 14,
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: brand.primary,
              flexDirection: 'row',
              alignItems: 'center',
              paddingLeft: 18,
              gap: 10,
            },
            boughtBgStyle,
          ]}
        >
          <MaterialCommunityIcons name="check-circle" size={26} color="#fff" />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              color: '#fff',
              fontSize: 14,
            }}
          >
            Als gekauft markieren
          </Text>
        </Animated.View>
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: brand.error,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'flex-end',
              paddingRight: 18,
              gap: 10,
            },
            deleteBgStyle,
          ]}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              color: '#fff',
              fontSize: 14,
            }}
          >
            Löschen
          </Text>
          <MaterialCommunityIcons name="trash-can-outline" size={26} color="#fff" />
        </Animated.View>
      </View>

      <GestureDetector gesture={pan}>
        <Animated.View style={fgStyle}>{children}</Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SummaryBanner — pro Tab unterschiedlicher Gradient + Wert
// ═══════════════════════════════════════════════════════════════════
type BannerProps = {
  variant: 'brand' | 'noname' | 'all';
  potential: number;
  earned: number;
};

function SummaryBanner({ variant, potential, earned }: BannerProps) {
  const colors =
    variant === 'brand'
      ? (['#f59332', '#f57a23'] as const)
      : variant === 'noname'
        ? (['#0d8575', '#10a18a'] as const)
        : (['#0d8575', '#42a968'] as const);
  const value = variant === 'brand' ? potential : variant === 'noname' ? earned : potential + earned;
  const title =
    variant === 'brand'
      ? 'Dein Sparpotenzial'
      : variant === 'noname'
        ? 'Einkaufszettel Ersparnis'
        : 'Gesamt-Ersparnis';
  const sub =
    variant === 'brand'
      ? 'Mit aktuell gewählten NoName-Alternativen'
      : variant === 'noname'
        ? 'Durch gewählte NoName-Produkte'
        : 'Potenzial + bereits gewählt';

  return (
    <LinearGradient
      colors={colors as unknown as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={{
        marginHorizontal: 16,
        marginTop: 10,
        marginBottom: 6,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 15,
            color: '#fff',
            letterSpacing: -0.1,
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            color: 'rgba(255,255,255,0.92)',
            marginTop: 1,
          }}
          numberOfLines={1}
        >
          {sub}
        </Text>
      </View>
      <View
        style={{
          backgroundColor: 'rgba(255,255,255,0.22)',
          borderRadius: 20,
          paddingHorizontal: 12,
          paddingVertical: 6,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <MaterialCommunityIcons name="tag-outline" size={16} color="#fff" />
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 16,
            color: '#fff',
          }}
        >
          −{formatEur(value)}
        </Text>
      </View>
    </LinearGradient>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EmptyState
// ═══════════════════════════════════════════════════════════════════
function EmptyState({
  variant,
  onAdd,
}: {
  variant: 'brand' | 'noname' | 'all';
  onAdd: () => void;
}) {
  const { theme, brand } = useTokens();
  const text =
    variant === 'brand'
      ? 'Keine Markenprodukte im Einkaufszettel'
      : variant === 'noname'
        ? 'Keine NoName-Produkte im Einkaufszettel'
        : 'Dein Einkaufszettel ist leer';
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 80,
        paddingHorizontal: 32,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: theme.primaryContainer,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 14,
        }}
      >
        <MaterialCommunityIcons name="cart-outline" size={32} color={brand.primary} />
      </View>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 16,
          color: theme.text,
          textAlign: 'center',
          letterSpacing: -0.2,
        }}
      >
        {text}
      </Text>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 13,
          color: theme.textMuted,
          textAlign: 'center',
          marginTop: 6,
          lineHeight: 18,
        }}
      >
        Füge Produkte über den Scanner, die Suche oder das Plus-Symbol hinzu.
      </Text>
      <Pressable
        onPress={onAdd}
        style={({ pressed }) => ({
          marginTop: 18,
          backgroundColor: brand.primary,
          paddingHorizontal: 18,
          paddingVertical: 10,
          borderRadius: 22,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <MaterialCommunityIcons name="plus" size={18} color="#fff" />
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 14,
            color: '#fff',
          }}
        >
          Produkt hinzufügen
        </Text>
      </Pressable>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Inline action buttons (Check + Trash) — used inside cards
// ═══════════════════════════════════════════════════════════════════
function RowActions({
  onCheck,
  onDelete,
  loadingCheck,
  loadingDelete,
}: {
  onCheck: () => void;
  onDelete: () => void;
  loadingCheck?: boolean;
  loadingDelete?: boolean;
}) {
  const { brand } = useTokens();
  return (
    <View style={{ gap: 6, alignItems: 'center' }}>
      <Pressable
        onPress={onCheck}
        disabled={loadingCheck}
        hitSlop={4}
        style={({ pressed }) => ({
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: brand.primary,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed || loadingCheck ? 0.7 : 1,
        })}
      >
        {loadingCheck ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <MaterialCommunityIcons name="check" size={18} color="#fff" />
        )}
      </Pressable>
      <Pressable
        onPress={onDelete}
        disabled={loadingDelete}
        hitSlop={4}
        style={({ pressed }) => ({
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: brand.error,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed || loadingDelete ? 0.7 : 1,
        })}
      >
        {loadingDelete ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <MaterialCommunityIcons name="trash-can-outline" size={18} color="#fff" />
        )}
      </Pressable>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BrandCard — Markenprodukt mit Expand für NoName-Alternativen
// ═══════════════════════════════════════════════════════════════════
type BrandCardProps = {
  item: EnrichedItem;
  expanded: boolean;
  onToggleExpand: () => void;
  onCheck: () => void;
  onDelete: () => void;
  selectedAltId: string | undefined;
  onSelectAlt: (altId: string) => void;
  /** Tap on the per-alt swap-arrow circle → convert that alt directly. */
  onConvertAlt: (altId: string) => void;
  loadingCheck: boolean;
  loadingDelete: boolean;
  loadingConvert: boolean;
  favoriteMarketId?: string;
  /** When false, expandable section is hidden (used in "Alle"-Tab to keep simple). */
  allowExpand?: boolean;
  /** Hersteller-`infos` Text — wenn vorhanden zeigt die Card ein
   *  (i)-Icon neben dem Hersteller-Namen. Tap triggert
   *  `onInfoPress` — Parent öffnet ein FilterSheet mit dem Text. */
  infos?: string | null;
  onInfoPress?: () => void;
};

function BrandCard({
  item,
  expanded,
  onToggleExpand,
  onCheck,
  onDelete,
  selectedAltId,
  onSelectAlt,
  onConvertAlt,
  loadingCheck,
  loadingDelete,
  loadingConvert,
  favoriteMarketId,
  allowExpand = true,
  infos,
  onInfoPress,
}: BrandCardProps) {
  const { theme, brand } = useTokens();
  const product = item.product;
  const alts: any[] = item.alternatives || [];
  const hasAlts = alts.length > 0;
  const selectedAlt = alts.find((a) => a.id === selectedAltId) || alts[0];
  const potential = item.potentialSavings || 0;

  const canExpand = allowExpand && hasAlts;

  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={canExpand ? onToggleExpand : undefined}
        disabled={!canExpand}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          padding: 10,
          opacity: pressed && canExpand ? 0.7 : 1,
        })}
      >
        <ImageWithShimmer
          source={{ uri: getProductImage(product) ?? undefined }}
          style={{ width: 62, height: 62, borderRadius: 10, backgroundColor: '#ffffff' }}
          resizeMode="contain"
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          {product?.hersteller?.name ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 1 }}>
              {product?.hersteller?.bild ? (
                <ImageWithShimmer
                  source={{ uri: product.hersteller.bild }}
                  style={{ width: 12, height: 12, borderRadius: 2 }}
                />
              ) : null}
              <Text
                numberOfLines={1}
                style={{
                  fontFamily,
                  fontWeight: fontWeight.bold,
                  fontSize: 11,
                  color: brand.primary,
                  letterSpacing: 0.1,
                  flexShrink: 1,
                }}
              >
                {product.hersteller.name}
              </Text>
              {infos && onInfoPress ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation?.();
                    onInfoPress();
                  }}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    padding: 1,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <MaterialCommunityIcons
                    name="information-outline"
                    size={13}
                    color={brand.primary}
                  />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <Text
            numberOfLines={2}
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 14,
              color: theme.text,
              lineHeight: 18,
            }}
          >
            {item.name || product?.name || 'Unbekanntes Produkt'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 13,
                color: theme.text,
              }}
            >
              {formatEur(product?.preis || 0)}
            </Text>
            {selectedAlt ? (
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.bold,
                  fontSize: 11,
                  color: brand.primary,
                }}
              >
                → {formatEur(selectedAlt.preis || 0)}
              </Text>
            ) : null}
          </View>
          {potential > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
              <MaterialCommunityIcons name="tag-outline" size={11} color={brand.primary} />
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.semibold,
                  fontSize: 10,
                  color: brand.primary,
                }}
              >
                Ersparnis möglich: {formatEur(potential)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {canExpand ? (
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={theme.textMuted}
              />
            </View>
          ) : null}
          <RowActions
            onCheck={onCheck}
            onDelete={onDelete}
            loadingCheck={loadingCheck}
            loadingDelete={loadingDelete}
          />
        </View>
      </Pressable>

      {/* Expanded NoName-Alternatives */}
      {allowExpand && expanded && hasAlts ? (
        <View
          style={{
            backgroundColor: theme.surfaceAlt,
            paddingHorizontal: 10,
            paddingTop: 8,
            paddingBottom: 12,
            borderTopWidth: 1,
            borderTopColor: theme.border,
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 12,
              color: theme.text,
              paddingVertical: 6,
            }}
          >
            NoName-Alternative wählen
            {favoriteMarketId ? (
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 10,
                  color: theme.textMuted,
                }}
              >
                {'  '}· Lieblingsmarkt wird bevorzugt
              </Text>
            ) : null}
          </Text>
          {alts.map((alt) => {
            const isSel = selectedAltId === alt.id;
            const isFav = favoriteMarketId && alt.discounter?.id === favoriteMarketId;
            const sd = getSavingsData(product, alt);
            return (
              <Pressable
                key={alt.id}
                onPress={() => onSelectAlt(alt.id)}
                style={({ pressed }) => ({
                  backgroundColor: theme.surface,
                  borderRadius: 10,
                  padding: 8,
                  marginBottom: 6,
                  borderWidth: 2,
                  borderColor: isSel ? brand.primary : 'transparent',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  opacity: pressed ? 0.85 : 1,
                  position: 'relative',
                })}
              >
                {isFav ? (
                  <View
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: 8,
                      backgroundColor: brand.error,
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: 4,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 2,
                    }}
                  >
                    <MaterialCommunityIcons name="heart" size={8} color="#fff" />
                    <Text
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.extraBold,
                        fontSize: 8,
                        color: '#fff',
                      }}
                    >
                      LIEBLINGSMARKT
                    </Text>
                  </View>
                ) : null}
                <ImageWithShimmer
                  source={{ uri: getProductImage(alt) ?? undefined }}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 8,
                    backgroundColor: '#ffffff',
                  }}
                  resizeMode="contain"
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.bold,
                      fontSize: 12,
                      color: theme.text,
                    }}
                  >
                    {alt.produktName || alt.name}
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      marginTop: 2,
                    }}
                  >
                    {alt.discounter?.bild ? (
                      <ImageWithShimmer
                        source={{ uri: alt.discounter.bild }}
                        style={{ width: 12, height: 12, borderRadius: 2 }}
                      />
                    ) : null}
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.medium,
                        fontSize: 10,
                        color: theme.textMuted,
                      }}
                    >
                      {alt.discounter?.name || 'Unbekannt'}
                      {alt.discounter?.land ? ` (${alt.discounter.land})` : ''}
                    </Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.extraBold,
                      fontSize: 12,
                      color: theme.text,
                    }}
                  >
                    {formatEur(alt.preis || 0)}
                  </Text>
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.bold,
                      fontSize: 10,
                      color: brand.primary,
                    }}
                  >
                    −{formatEur(sd.savingsEur)}
                  </Text>
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.semibold,
                      fontSize: 9,
                      color: theme.textMuted,
                    }}
                  >
                    −{sd.savingsPercent}%
                  </Text>
                </View>
                <Pressable
                  onPress={() => onConvertAlt(alt.id)}
                  disabled={loadingConvert}
                  hitSlop={6}
                  style={({ pressed }) => ({
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: brand.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed || loadingConvert ? 0.7 : 1,
                  })}
                >
                  {loadingConvert && isSel ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <MaterialCommunityIcons
                      name="swap-horizontal"
                      size={16}
                      color="#fff"
                    />
                  )}
                </Pressable>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NoNameCard — Handelsmarken-Produkt mit fixer Ersparnis
// ═══════════════════════════════════════════════════════════════════
type NoNameCardProps = {
  item: EnrichedItem;
  onCheck: () => void;
  onDelete: () => void;
  loadingCheck: boolean;
  loadingDelete: boolean;
  favoriteMarketId?: string;
};

function NoNameCard({
  item,
  onCheck,
  onDelete,
  loadingCheck,
  loadingDelete,
  favoriteMarketId,
}: NoNameCardProps) {
  const { theme, brand } = useTokens();
  const p = item.product;
  const isFav = favoriteMarketId && p?.discounter?.id === favoriteMarketId;
  const savings = item.savings || 0;

  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        padding: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <ImageWithShimmer
        source={{ uri: getProductImage(p) ?? undefined }}
        style={{ width: 62, height: 62, borderRadius: 10, backgroundColor: '#ffffff' }}
        resizeMode="contain"
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        {p?.handelsmarke?.bezeichnung ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 1 }}>
            <Text
              numberOfLines={1}
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 11,
                color: brand.primary,
                letterSpacing: 0.1,
              }}
            >
              {p.handelsmarke.bezeichnung}
            </Text>
            {isFav ? (
              <MaterialCommunityIcons name="heart" size={10} color={brand.error} />
            ) : null}
          </View>
        ) : null}
        <Text
          numberOfLines={2}
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 14,
            color: theme.text,
            lineHeight: 18,
          }}
        >
          {p?.name || p?.produktName || 'Unbekanntes Produkt'}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            marginTop: 3,
          }}
        >
          {p?.discounter?.bild ? (
            <ImageWithShimmer
              source={{ uri: p.discounter.bild }}
              style={{ width: 12, height: 12, borderRadius: 2 }}
            />
          ) : null}
          <Text
            numberOfLines={1}
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 10,
              color: theme.textMuted,
            }}
          >
            {p?.discounter?.name || 'Unbekannt'}
            {p?.discounter?.land ? ` (${p.discounter.land})` : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 13,
              color: theme.text,
            }}
          >
            {formatEur(p?.preis || 0)}
          </Text>
          {savings > 0 ? (
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 11,
                color: brand.primary,
              }}
            >
              (−{formatEur(savings)})
            </Text>
          ) : null}
        </View>
        {/* Hersteller-Pill am Bottom — `hersteller_new.name`, kompakte
            Chip mit surfaceAlt-bg. User: "in kleiner pill unter dem
            produktnamen (bottom)". */}
        {p?.hersteller?.name ? (
          <View
            style={{
              alignSelf: 'flex-start',
              backgroundColor: theme.surfaceAlt,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 6,
              marginTop: 6,
              maxWidth: '100%',
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontFamily,
                fontWeight: fontWeight.semibold,
                fontSize: 10,
                color: theme.textSub,
                letterSpacing: 0.3,
              }}
            >
              {p.hersteller.name}
            </Text>
          </View>
        ) : null}
      </View>
      <RowActions
        onCheck={onCheck}
        onDelete={onDelete}
        loadingCheck={loadingCheck}
        loadingDelete={loadingDelete}
      />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CustomCard — Freitext-Eintrag (ohne DB-Bezug)
// ═══════════════════════════════════════════════════════════════════
type CustomCardProps = {
  item: EnrichedItem;
  onCheck: () => void;
  onDelete: () => void;
  loadingCheck: boolean;
  loadingDelete: boolean;
};

function CustomCard({
  item,
  onCheck,
  onDelete,
  loadingCheck,
  loadingDelete,
}: CustomCardProps) {
  const { theme, brand } = useTokens();
  const isBrand = item.customType === 'brand';
  // Picked icon takes priority. Fall back to generic glyph for legacy
  // custom items that predate the icon picker.
  const iconName: any = item.customIcon || (isBrand ? 'star' : 'cart-outline');
  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        padding: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <View
        style={{
          width: 62,
          height: 62,
          borderRadius: 10,
          backgroundColor: theme.primaryContainer,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons name={iconName} size={32} color={brand.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            marginBottom: 2,
          }}
        >
          <View
            style={{
              backgroundColor: theme.primaryContainer,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 4,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 9,
                color: brand.primary,
                letterSpacing: 0.4,
              }}
            >
              {isBrand ? 'MARKE' : 'NONAME'}
            </Text>
          </View>
        </View>
        <Text
          numberOfLines={2}
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 14,
            color: theme.text,
            lineHeight: 18,
          }}
        >
          {item.name || 'Freitext-Eintrag'}
        </Text>
        {item.markt?.name ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              marginTop: 3,
            }}
          >
            {item.markt?.bild ? (
              <ImageWithShimmer
                source={{ uri: item.markt.bild }}
                style={{ width: 12, height: 12, borderRadius: 2 }}
              />
            ) : (
              <MaterialCommunityIcons name="storefront-outline" size={10} color={theme.textMuted} />
            )}
            <Text
              numberOfLines={1}
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 10,
                color: theme.textMuted,
              }}
            >
              {item.markt.name}
              {item.markt.land ? ` (${item.markt.land})` : ''}
            </Text>
          </View>
        ) : (
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 10,
              color: theme.textMuted,
              marginTop: 3,
            }}
          >
            Freitext-Eintrag
          </Text>
        )}
      </View>
      <RowActions
        onCheck={onCheck}
        onDelete={onDelete}
        loadingCheck={loadingCheck}
        loadingDelete={loadingDelete}
      />
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════
export default function ShoppingListScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme, brand } = useTokens();
  const { user, userProfile } = useAuth();
  const { isPremium } = useRevenueCat();
  const analytics = useAnalytics();

  const favoriteMarketId: string | undefined = (userProfile as any)?.favoriteMarket;

  // ─── Tab + pager ───────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('brand');
  const pagerRef = useRef<PagerView>(null);
  const tabIndex = (t: Tab) => (t === 'brand' ? 0 : t === 'noname' ? 1 : 2);
  const indexTab = (i: number): Tab => (i === 0 ? 'brand' : i === 1 ? 'noname' : 'all');

  const onTabChange = (next: Tab) => {
    if (next === activeTab) return;
    setActiveTab(next);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    pagerRef.current?.setPage(tabIndex(next));
  };
  const onPageSelected = (e: { nativeEvent: { position: number } }) => {
    const next = indexTab(e.nativeEvent.position);
    setActiveTab((prev) => (prev === next ? prev : next));
  };

  // ─── Data ──────────────────────────────────────────────────────
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [brandProducts, setBrandProducts] = useState<EnrichedItem[]>([]);
  const [noNameProducts, setNoNameProducts] = useState<EnrichedItem[]>([]);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  // Marken-Info-Sheet — getriggered vom (i)-Icon im Hersteller-Chip
  // einer BrandCard. null = zu, Object = sichtbar.
  const [infoSheet, setInfoSheet] = useState<{ title: string; body: string } | null>(null);
  const [selectedConversions, setSelectedConversions] = useState<ProductToConvert[]>([]);
  const [totalPotentialSavings, setTotalPotentialSavings] = useState(0);
  const [totalActualSavings, setTotalActualSavings] = useState(0);

  // ─── Filter ────────────────────────────────────────────────────
  const [showFilter, setShowFilter] = useState(false);
  const [showCustomItemModal, setShowCustomItemModal] = useState(false);
  const [filters, setFilters] = useState<{
    markets: string[];
    categories: string[];
    sortBy: SortBy;
  }>({ markets: [], categories: [], sortBy: 'name' });
  const [availableMarkets, setAvailableMarkets] = useState<{ id: string; name: string }[]>([]);
  const [availableCategories, setAvailableCategories] = useState<
    { id: string; bezeichnung?: string; name?: string }[]
  >([]);

  // ─── Loading states ────────────────────────────────────────────
  const [loadingItems, setLoadingItems] = useState<Set<string>>(new Set());
  const [deletingItems, setDeletingItems] = useState<Set<string>>(new Set());
  const [convertingItems, setConvertingItems] = useState<Set<string>>(new Set());
  const [isConverting, setIsConverting] = useState(false);

  // Batch loaders
  const [purchaseLoaderState, setPurchaseLoaderState] = useState<{
    visible: boolean;
    processedItems: number;
    totalItems: number;
    currentItem: string;
  }>({ visible: false, processedItems: 0, totalItems: 0, currentItem: '' });
  const [convertLoaderState, setConvertLoaderState] = useState<{
    visible: boolean;
    processedItems: number;
    totalItems: number;
    currentItem: string;
  }>({ visible: false, processedItems: 0, totalItems: 0, currentItem: '' });

  // Level-up overlay (currently driven via gamification provider, but we
  // keep the legacy hook here for safety).
  const [showLevelUpOverlay, setShowLevelUpOverlay] = useState(false);
  const [levelUpData] = useState<{ newLevel: number; oldLevel: number }>({
    newLevel: 1,
    oldLevel: 1,
  });

  // ─── Hide native stack header (we render DetailHeader) ─────────
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // ─── Load shopping cart ────────────────────────────────────────
  const loadShoppingCart = useCallback(async () => {
    if (!user?.uid) return;
    try {
      setSelectedConversions([]);
      const items = await FirestoreService.getShoppingCartItems(user.uid);

      const customBrandItems: EnrichedItem[] = [];
      const customNoNameItems: EnrichedItem[] = [];
      const dbItems: FirestoreDocument<Einkaufswagen>[] = [];

      for (const item of items) {
        if (item.customItem) {
          const enriched: EnrichedItem = {
            id: item.id,
            kind: item.customItem.type === 'brand' ? 'custom-brand' : 'custom-noname',
            isCustom: true,
            name: item.customItem.name,
            customType: item.customItem.type,
            customIcon: (item.customItem as any).icon,
            markt:
              item.customItem.type === 'noname'
                ? {
                    name: item.customItem.marketName,
                    land: item.customItem.marketLand,
                    bild: item.customItem.marketBild,
                  }
                : null,
          };
          if (item.customItem.type === 'brand') customBrandItems.push(enriched);
          else customNoNameItems.push(enriched);
        } else {
          dbItems.push(item);
        }
      }

      const processedItems = await Promise.all(
        dbItems.map(async (item) => {
          try {
            if ((item as any).markenProdukt) {
              const ref = (item as any).markenProdukt;
              const [productData, alternatives] = await Promise.all([
                FirestoreService.getDocumentByReference<MarkenProdukte>(ref),
                FirestoreService.getNoNameAlternatives(ref.id, favoriteMarketId),
              ]);
              if (!productData) return null;
              let herstellerData: any = null;
              if ((productData as any).hersteller) {
                try {
                  herstellerData = await FirestoreService.getDocumentByReference(
                    (productData as any).hersteller,
                  );
                } catch {
                  /* ignore */
                }
              }

              let bestAlternative: any = null;
              let maxSavings = 0;
              for (const alt of alternatives) {
                const sd = getSavingsData(productData, alt);
                if (sd.savingsEur > maxSavings) {
                  maxSavings = sd.savingsEur;
                  bestAlternative = alt;
                }
              }

              return {
                kind: 'brand' as const,
                enriched: {
                  id: item.id,
                  kind: 'brand' as const,
                  markenProduktRef: ref.id,
                  product: { ...productData, hersteller: herstellerData },
                  alternatives,
                  bestAlternative,
                  potentialSavings: maxSavings,
                } satisfies EnrichedItem,
                potentialSavings: maxSavings,
                bestAlternative,
              };
            } else if ((item as any).handelsmarkenProdukt) {
              const ref = (item as any).handelsmarkenProdukt;
              const productData = await FirestoreService.getDocumentByReference<Produkte>(ref);
              if (!productData) return null;
              const [handelsmarkeData, discounterData, markenProdukt, herstellerData] = await Promise.all([
                (productData as any).handelsmarke
                  ? FirestoreService.getDocumentByReference(
                      (productData as any).handelsmarke,
                    ).catch(() => null)
                  : Promise.resolve(null),
                (productData as any).discounter
                  ? FirestoreService.getDocumentByReference(
                      (productData as any).discounter,
                    ).catch(() => null)
                  : Promise.resolve(null),
                (productData as any).markenProdukt
                  ? FirestoreService.getDocumentByReference<MarkenProdukte>(
                      (productData as any).markenProdukt,
                    ).catch(() => null)
                  : Promise.resolve(null),
                // hersteller_new für die "tatsächlicher Hersteller"-
                // Zeile unter dem Produktnamen — siehe NoNameCard.
                (productData as any).hersteller
                  ? FirestoreService.getDocumentByReference(
                      (productData as any).hersteller,
                    ).catch(() => null)
                  : Promise.resolve(null),
              ]);

              let finalDiscounter: any = discounterData;
              if (discounterData && (productData as any).discounter) {
                finalDiscounter = {
                  ...(discounterData as any),
                  id: (productData as any).discounter.id,
                };
              }
              let savings = 0;
              if (markenProdukt) {
                const sd = getSavingsData(markenProdukt, productData);
                savings = sd.savingsEur;
              }
              return {
                kind: 'noname' as const,
                enriched: {
                  id: item.id,
                  kind: 'noname' as const,
                  product: {
                    ...productData,
                    handelsmarke: handelsmarkeData,
                    discounter: finalDiscounter,
                    hersteller: herstellerData,
                  },
                  savings,
                  // preserve journey info for bulk purchase
                  ...(item as any),
                } satisfies EnrichedItem,
                savings,
              };
            }
            return null;
          } catch (error) {
            console.error('Error processing shopping cart item:', error);
            return null;
          }
        }),
      );

      const brandItems: EnrichedItem[] = [...customBrandItems];
      const noNameItems: EnrichedItem[] = [...customNoNameItems];
      let potential = 0;
      let actual = 0;
      const newSelected: ProductToConvert[] = [];

      for (const result of processedItems) {
        if (!result) continue;
        if (result.kind === 'brand') {
          brandItems.push(result.enriched);
          potential += result.potentialSavings;
          if (
            result.bestAlternative &&
            result.enriched.markenProduktRef
          ) {
            newSelected.push({
              einkaufswagenRef: result.enriched.id,
              markenProduktRef: result.enriched.markenProduktRef,
              produktRef: result.bestAlternative.id,
            });
          }
        } else {
          noNameItems.push(result.enriched);
          actual += result.savings;
        }
      }

      setSelectedConversions(newSelected);
      setBrandProducts(brandItems);
      setNoNameProducts(noNameItems);
      setTotalPotentialSavings(potential);
      setTotalActualSavings(actual);
    } catch (error: any) {
      console.error('Error loading shopping cart:', error);
      showInfoToast(
        TOAST_MESSAGES.SHOPPING.loadError +
          ' ' +
          (error?.message ? String(error.message) : String(error)),
        'error',
      );
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [user?.uid, favoriteMarketId]);

  useEffect(() => {
    if (user?.uid) loadShoppingCart();
  }, [user?.uid, loadShoppingCart]);

  // ─── Filter options ────────────────────────────────────────────
  const loadFilterOptions = useCallback(async () => {
    try {
      const marketsMap = new Map<string, { id: string; name: string }>();
      const categoriesMap = new Map<string, { id: string; bezeichnung?: string; name?: string }>();
      const all = [...brandProducts, ...noNameProducts];
      all.forEach((item) => {
        const p = item.product;
        if (p?.discounter?.id && p?.discounter?.name) {
          marketsMap.set(p.discounter.id, { id: p.discounter.id, name: p.discounter.name });
        }
        if (p?.kategorie?.id && (p?.kategorie?.bezeichnung || p?.kategorie?.name)) {
          categoriesMap.set(p.kategorie.id, {
            id: p.kategorie.id,
            bezeichnung: p.kategorie.bezeichnung,
            name: p.kategorie.name,
          });
        }
      });
      const marketsArray = Array.from(marketsMap.values());
      const categoriesArray = Array.from(categoriesMap.values());

      const userLevel =
        (userProfile as any)?.stats?.currentLevel || (userProfile as any)?.level || 1;

      if (categoriesArray.length === 0) {
        try {
          const cwa = await categoryAccessService.getAllCategoriesWithAccess(userLevel, isPremium);
          setAvailableCategories(cwa.filter((c: any) => !c.isLocked));
        } catch {
          setAvailableCategories([]);
        }
      } else {
        const filtered: typeof categoriesArray = [];
        for (const cat of categoriesArray) {
          const ok = await categoryAccessService.isCategoryAvailable(cat.id, userLevel, isPremium);
          if (ok) filtered.push(cat);
        }
        setAvailableCategories(filtered);
      }
      setAvailableMarkets(marketsArray);
    } catch (error) {
      console.error('Error loading filter options:', error);
    }
  }, [brandProducts, noNameProducts, userProfile, isPremium]);

  useEffect(() => {
    if (brandProducts.length > 0 || noNameProducts.length > 0) {
      loadFilterOptions();
    }
  }, [brandProducts.length, noNameProducts.length, loadFilterOptions]);

  // ─── Apply filters + sort ──────────────────────────────────────
  const applyFiltersAndSorting = useCallback(
    (products: EnrichedItem[]) => {
      let filtered = [...products];
      // Markets only matter on noname-style entries with discounter
      if (filters.markets.length > 0) {
        filtered = filtered.filter((item) => {
          const did = item.product?.discounter?.id;
          // Items without discounter (brand items, custom items) → bypass market filter
          return !did || filters.markets.includes(did);
        });
      }
      if (filters.categories.length > 0) {
        filtered = filtered.filter((item) => {
          const cid = item.product?.kategorie?.id;
          return !cid || filters.categories.includes(cid);
        });
      }
      filtered.sort((a, b) => {
        switch (filters.sortBy) {
          case 'name': {
            const na = a.name || a.product?.produktName || a.product?.name || '';
            const nb = b.name || b.product?.produktName || b.product?.name || '';
            return na.localeCompare(nb);
          }
          case 'price':
            return (a.product?.preis || 0) - (b.product?.preis || 0);
          case 'savings':
            return (b.savings || 0) - (a.savings || 0);
          default:
            return 0;
        }
      });
      return filtered;
    },
    [filters],
  );

  const filteredBrand = applyFiltersAndSorting(brandProducts);
  const filteredNoName = applyFiltersAndSorting(noNameProducts);
  const filteredAll = applyFiltersAndSorting([...brandProducts, ...noNameProducts]);

  const activeFilterCount =
    filters.markets.length + filters.categories.length + (filters.sortBy !== 'name' ? 1 : 0);

  const clearAllFilters = () =>
    setFilters({ markets: [], categories: [], sortBy: 'name' });

  // ─── Action handlers ───────────────────────────────────────────

  const toggleExpanded = (itemId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setExpandedItems((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId],
    );
  };

  const handleSelectAlternative = (
    einkaufswagenRef: string,
    markenProduktRef: string,
    produktRef: string,
  ) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSelectedConversions((prev) => {
      const existingIndex = prev.findIndex((c) => c.einkaufswagenRef === einkaufswagenRef);
      if (existingIndex !== -1) {
        const next = [...prev];
        if (next[existingIndex].produktRef === produktRef) {
          next.splice(existingIndex, 1);
        } else {
          next[existingIndex] = { einkaufswagenRef, markenProduktRef, produktRef };
        }
        return next;
      }
      return [...prev, { einkaufswagenRef, markenProduktRef, produktRef }];
    });
  };

  const handleConvertSingle = async (
    einkaufswagenRef: string,
    markenProduktRef: string,
    produktRef: string,
  ) => {
    if (!user) return;
    setConvertingItems((prev) => new Set(prev).add(einkaufswagenRef));
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const conversions = [{ einkaufswagenRef, markenProduktRef, produktRef }];
      await FirestoreService.convertToNoName(user.uid, conversions);
      const brandItem = brandProducts.find((i) => i.id === einkaufswagenRef);
      const savingsAmount = brandItem?.potentialSavings || 0;
      await loadShoppingCart();
      setTimeout(() => onTabChange('noname'), 100);
      showConvertSuccessToast(savingsAmount);
      achievementService.trackAction(user.uid, 'convert_product').catch((e) => {
        console.error('Achievement convert_product error', e);
      });
    } catch (error) {
      console.error('Error converting single product:', error);
      showInfoToast(TOAST_MESSAGES.SHOPPING.convertError, 'error');
    } finally {
      setConvertingItems((prev) => {
        const n = new Set(prev);
        n.delete(einkaufswagenRef);
        return n;
      });
    }
  };

  const handleConvertSelected = async () => {
    if (!user?.uid) return;
    if (selectedConversions.length === 0) {
      showInfoToast(TOAST_MESSAGES.SHOPPING.selectFirstPrompt, 'info');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Alert.alert(
      'In NoNames umwandeln?',
      `${selectedConversions.length} Produkt${
        selectedConversions.length > 1 ? 'e' : ''
      } umwandeln und ${formatEur(totalPotentialSavings)} sparen?`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Umwandeln',
          onPress: async () => {
            setIsConverting(true);
            setConvertLoaderState({
              visible: true,
              processedItems: 0,
              totalItems: selectedConversions.length,
              currentItem: '',
            });
            try {
              for (let i = 0; i < selectedConversions.length; i++) {
                const c = selectedConversions[i];
                const bp = brandProducts.find((p) => p.id === c.einkaufswagenRef);
                const name = bp?.product?.name || bp?.name || 'Produkt';
                setConvertLoaderState((prev) => ({ ...prev, currentItem: name, processedItems: i }));
                await new Promise((res) => setTimeout(res, 40));
              }
              setConvertLoaderState((prev) => ({
                ...prev,
                currentItem: 'Umwandlung wird verarbeitet...',
                processedItems: selectedConversions.length,
              }));
              await FirestoreService.convertToNoName(user.uid, selectedConversions);
              await FirestoreService.updateUserTotalSavings(user.uid, totalPotentialSavings);

              const sideEffects: Promise<any>[] = [];
              for (const c of selectedConversions) {
                const bp = brandProducts.find((p) => p.id === c.einkaufswagenRef);
                if (bp) {
                  const { savingsEur, savingsPercent } = getSavingsData(bp.product, {
                    preis: bp.product?.preis ?? 0,
                    packSize: bp.product?.packSize ?? 1,
                  });
                  sideEffects.push(
                    Promise.resolve(
                      analytics?.trackProductConversion?.(
                        c.markenProduktRef,
                        c.produktRef,
                        savingsEur,
                        savingsPercent,
                      ),
                    ),
                  );
                }
                sideEffects.push(
                  Promise.resolve(achievementService?.trackAction?.(user.uid, 'convert_product')),
                );
              }
              await Promise.allSettled(sideEffects);

              setConvertLoaderState((prev) => ({
                ...prev,
                currentItem: 'Abgeschlossen!',
                processedItems: selectedConversions.length,
              }));
              await new Promise((res) => setTimeout(res, 80));
              setConvertLoaderState({ visible: false, processedItems: 0, totalItems: 0, currentItem: '' });

              await loadShoppingCart();
              setTimeout(() => onTabChange('noname'), 100);
              showBulkConvertSuccessToast(totalPotentialSavings);
            } catch (error) {
              console.error('[convert] bulk error', error);
              showInfoToast(TOAST_MESSAGES.SHOPPING.bulkConvertError, 'error');
            } finally {
              setConvertLoaderState({ visible: false, processedItems: 0, totalItems: 0, currentItem: '' });
              setIsConverting(false);
            }
          },
        },
      ],
    );
  };

  const handleMarkAsPurchased = async (itemId: string, savings?: number) => {
    if (!user?.uid) return;
    setLoadingItems((prev) => new Set(prev).add(itemId));
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      const isCustomItem = [...brandProducts, ...noNameProducts].some(
        (item) => item.id === itemId && item.isCustom,
      );

      if (isCustomItem) {
        await FirestoreService.removeFromShoppingCart(user.uid, itemId);
      } else {
        await FirestoreService.markAsPurchased(user.uid, itemId);
      }

      if (!isCustomItem) {
        await updateUserStats(user.uid, {
          savingsToAdd: savings || 0,
          productsToAdd: 1,
        });
        achievementService
          .trackAction(user.uid, 'complete_shopping', {
            productCount: 1,
            totalSavings: savings || 0,
          })
          .catch((error) => console.error('Achievement complete_shopping error:', error));
        if (savings && savings > 0) {
          showPurchasedToast(`Gekauft! Du hast ${formatEur(savings)} gespart - super gemacht!`);
        } else {
          showPurchasedToast(TOAST_MESSAGES.SHOPPING.purchasedSimple);
        }
      } else {
        showInfoToast(TOAST_MESSAGES.SHOPPING.customItemPurchased, 'success');
      }

      // Optimistic local removal
      const customItem = [...brandProducts, ...noNameProducts].find(
        (item) => item.id === itemId && item.isCustom,
      );
      if (customItem) {
        if (customItem.customType === 'noname') {
          setNoNameProducts((prev) => prev.filter((i) => i.id !== itemId));
        } else {
          setBrandProducts((prev) => prev.filter((i) => i.id !== itemId));
        }
      } else if (savings && savings > 0) {
        setNoNameProducts((prev) => prev.filter((i) => i.id !== itemId));
        setTotalActualSavings((prev) => Math.max(0, prev - savings));
      } else {
        setBrandProducts((prev) => prev.filter((i) => i.id !== itemId));
      }
    } catch (error) {
      console.error('Error marking as purchased:', error);
      showInfoToast(TOAST_MESSAGES.SHOPPING.purchaseError, 'error');
    } finally {
      setLoadingItems((prev) => {
        const n = new Set(prev);
        n.delete(itemId);
        return n;
      });
    }
  };

  const handleRemoveFromCart = async (itemId: string) => {
    if (!user?.uid) return;
    setDeletingItems((prev) => new Set(prev).add(itemId));
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await FirestoreService.removeFromShoppingCart(user.uid, itemId);
      showInfoToast(TOAST_MESSAGES.SHOPPING.removedFromCart, 'info');
      // Optimistic update
      setBrandProducts((prev) => prev.filter((i) => i.id !== itemId));
      setNoNameProducts((prev) => {
        const removed = prev.find((i) => i.id === itemId);
        if (removed) {
          setTotalActualSavings((s) => Math.max(0, s - (removed.savings || 0)));
        }
        return prev.filter((i) => i.id !== itemId);
      });
      setSelectedConversions((prev) => prev.filter((c) => c.einkaufswagenRef !== itemId));
    } catch (error) {
      console.error('Error removing from cart:', error);
      showInfoToast(TOAST_MESSAGES.SHOPPING.removeError, 'error');
    } finally {
      setDeletingItems((prev) => {
        const n = new Set(prev);
        n.delete(itemId);
        return n;
      });
    }
  };

  // Confirm-wrapped delete (used on the inline trash button)
  const handleRemoveFromCartConfirm = (itemId: string) => {
    Alert.alert(
      'Produkt entfernen?',
      'Möchtest du dieses Produkt vom Einkaufszettel entfernen?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: () => handleRemoveFromCart(itemId),
        },
      ],
    );
  };

  // ─── "Alle als gekauft markieren" — works for any list of items ──
  const executeMarkAllAsPurchased = async (
    targets: EnrichedItem[],
    sourceLabel: string,
  ) => {
    if (!user || targets.length === 0) return;

    const dbProducts = targets.filter(
      (item) => !item.isCustom && item.kind === 'noname',
    );
    const customItems = targets.filter((item) => item.isCustom);
    const dbBrandItems = targets.filter((item) => !item.isCustom && item.kind === 'brand');

    const totalSavings = dbProducts.reduce((s, item) => s + (item.savings || 0), 0);
    const totalCount = dbProducts.length + customItems.length + dbBrandItems.length;

    setPurchaseLoaderState({
      visible: true,
      processedItems: 0,
      totalItems: totalCount,
      currentItem: 'Wird verarbeitet...',
    });

    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      const journeyTrackingService = await import(
        '@/lib/services/journeyTrackingService'
      ).then((m) => m.default);

      let productsForJourneyTracking: any[] = [];
      let productsWithIndices: any[] = [];

      if (dbProducts.length > 0) {
        productsForJourneyTracking = dbProducts.map((item) => ({
          productId: item.product?.id || '',
          productName:
            item.product?.name || item.product?.produktName || item.name || 'Unbekannt',
          productType: 'noname' as 'brand' | 'noname',
          finalPrice: item.product?.preis || 0,
          finalSavings: item.savings || 0,
          journeyId: (item as any).journeyId,
          viewedProductIndex: (item as any).viewedProductIndex,
        }));
        if (
          productsForJourneyTracking.length > 0 &&
          productsForJourneyTracking[0].journeyId
        ) {
          productsWithIndices = productsForJourneyTracking.map((p) => ({
            ...p,
            viewedProductIndex: journeyTrackingService.getViewedProductIndexAfterAction(
              p.productId,
            ),
          }));
        }
      }

      const promises: Promise<any>[] = [];
      // DB noname: mark as purchased (without journey tracking — we batch it)
      if (dbProducts.length > 0) {
        promises.push(
          ...dbProducts.map((item) =>
            FirestoreService.markAsPurchasedWithoutTracking(user.uid, item.id),
          ),
        );
      }
      // DB brand on this list: mark as purchased too (kept for "Alle"-Tab semantics)
      if (dbBrandItems.length > 0) {
        promises.push(
          ...dbBrandItems.map((item) => FirestoreService.markAsPurchased(user.uid, item.id)),
        );
      }
      // Custom items: simple removal
      if (customItems.length > 0) {
        promises.push(
          ...customItems.map((item) => FirestoreService.removeFromShoppingCart(user.uid, item.id)),
        );
      }

      setPurchaseLoaderState((prev) => ({
        ...prev,
        currentItem: 'Alle Produkte werden verarbeitet...',
        processedItems: Math.floor(totalCount * 0.3),
      }));
      await Promise.all(promises);

      setPurchaseLoaderState((prev) => ({
        ...prev,
        currentItem: 'Ersparnis wird gespeichert...',
        processedItems: Math.floor(totalCount * 0.7),
      }));

      const productsToAdd = dbProducts.length;
      if (totalSavings > 0 || productsToAdd > 0) {
        await updateUserStats(user.uid, {
          savingsToAdd: totalSavings,
          productsToAdd,
        });
      }

      // Local state
      const removedIds = new Set(targets.map((t) => t.id));
      setNoNameProducts((prev) => prev.filter((i) => !removedIds.has(i.id)));
      setBrandProducts((prev) => prev.filter((i) => !removedIds.has(i.id)));
      setTotalActualSavings((prev) => Math.max(0, prev - totalSavings));

      if (productsToAdd > 0) {
        setPurchaseLoaderState((prev) => ({
          ...prev,
          currentItem: 'Achievement wird getrackt...',
          processedItems: totalCount,
        }));
        if (
          productsForJourneyTracking.length > 0 &&
          productsForJourneyTracking[0].journeyId &&
          productsWithIndices
        ) {
          journeyTrackingService
            .trackBulkPurchaseInSpecificJourney(
              productsForJourneyTracking[0].journeyId,
              productsWithIndices,
              totalSavings,
              user.uid,
            )
            .then(() =>
              achievementService.trackAction(user.uid, 'complete_shopping', {
                productCount: productsToAdd,
                totalSavings,
              }),
            )
            .catch((error) => console.error('Sequential tracking error', error));
        } else {
          achievementService
            .trackAction(user.uid, 'complete_shopping', {
              productCount: productsToAdd,
              totalSavings,
            })
            .catch((error) => console.error('Achievement tracking error', error));
        }
      }

      setPurchaseLoaderState((prev) => ({
        ...prev,
        currentItem: 'Abgeschlossen!',
        processedItems: totalCount,
      }));

      // Analytics legacy
      if (productsToAdd > 0) {
        const sourceMix = dbProducts
          .map((item) => (item as any).source || 'unknown')
          .filter((s, i, arr) => arr.indexOf(s) === i);
        analytics.trackPurchaseCompleted?.(
          totalCount,
          totalSavings,
          productsToAdd,
          dbBrandItems.length,
          sourceMix,
        );
      }

      showBulkPurchasedToast(productsToAdd, customItems.length, totalSavings);
    } catch (error) {
      console.error(`Error marking all (${sourceLabel}) as purchased:`, error);
      showInfoToast(TOAST_MESSAGES.SHOPPING.bulkPurchaseError, 'error');
    } finally {
      setPurchaseLoaderState({
        visible: false,
        processedItems: 0,
        totalItems: 0,
        currentItem: '',
      });
    }
  };

  const handleMarkAllAsPurchased = (variant: Tab) => {
    const targets =
      variant === 'noname'
        ? noNameProducts
        : variant === 'all'
          ? [...brandProducts, ...noNameProducts]
          : brandProducts;

    if (targets.length === 0) return;
    const dbCount = targets.filter((t) => !t.isCustom && t.kind === 'noname').length;
    const customCount = targets.filter((t) => t.isCustom).length;
    const brandCount = targets.filter((t) => !t.isCustom && t.kind === 'brand').length;
    const totalSavings = targets.reduce((s, t) => s + (t.savings || 0), 0);

    let message = '';
    if (dbCount > 0 && customCount > 0 && brandCount > 0) {
      message = `Möchtest du alle ${targets.length} Produkte (${brandCount} Marken, ${dbCount} NoNames, ${customCount} Freitext) als erledigt markieren? Du sparst dabei ${formatEur(totalSavings)}.`;
    } else if (dbCount > 0 && customCount > 0) {
      message = `Möchtest du alle ${targets.length} Produkte als erledigt markieren? (${dbCount} NoNames für ${formatEur(totalSavings)} Ersparnis + ${customCount} Freitext-Einträge)`;
    } else if (dbCount > 0) {
      message = `Möchtest du alle ${dbCount} NoName-Produkte als gekauft markieren und ${formatEur(totalSavings)} zu deiner Ersparnis hinzufügen?`;
    } else if (brandCount > 0 && customCount > 0) {
      message = `Möchtest du alle ${targets.length} Einträge (${brandCount} Marken + ${customCount} Freitext) als erledigt markieren?`;
    } else if (brandCount > 0) {
      message = `Möchtest du alle ${brandCount} Markenprodukte als gekauft markieren?`;
    } else {
      message = `Möchtest du alle ${customCount} Freitext-Einträge als erledigt markieren?`;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Alert.alert('Alle als erledigt markieren?', message, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Alle markieren',
        onPress: () => executeMarkAllAsPurchased(targets, variant),
      },
    ]);
  };

  // ─── Render helpers ────────────────────────────────────────────
  const chromeHeight = insets.top + DETAIL_HEADER_ROW_HEIGHT;

  const renderItem = (item: EnrichedItem, opts: { allowExpand: boolean }) => {
    const loadingCheck = loadingItems.has(item.id);
    const loadingDelete = deletingItems.has(item.id);
    const loadingConvert = convertingItems.has(item.id);

    if (item.isCustom) {
      return (
        <SwipeRow
          key={item.id}
          onSwipeBought={() => handleMarkAsPurchased(item.id)}
          onSwipeDelete={() => handleRemoveFromCart(item.id)}
          disabled={loadingCheck || loadingDelete}
        >
          <CustomCard
            item={item}
            onCheck={() => handleMarkAsPurchased(item.id)}
            onDelete={() => handleRemoveFromCartConfirm(item.id)}
            loadingCheck={loadingCheck}
            loadingDelete={loadingDelete}
          />
        </SwipeRow>
      );
    }
    if (item.kind === 'brand') {
      const sel = selectedConversions.find((c) => c.einkaufswagenRef === item.id);
      const expanded = expandedItems.includes(item.id);
      return (
        <SwipeRow
          key={item.id}
          onSwipeBought={() => handleMarkAsPurchased(item.id)}
          onSwipeDelete={() => handleRemoveFromCart(item.id)}
          disabled={loadingCheck || loadingDelete}
        >
          <BrandCard
            item={item}
            expanded={expanded}
            onToggleExpand={() => toggleExpanded(item.id)}
            onCheck={() => handleMarkAsPurchased(item.id)}
            onDelete={() => handleRemoveFromCartConfirm(item.id)}
            selectedAltId={sel?.produktRef}
            onSelectAlt={(altId) =>
              handleSelectAlternative(item.id, item.markenProduktRef!, altId)
            }
            onConvertAlt={(altId) =>
              handleConvertSingle(item.id, item.markenProduktRef!, altId)
            }
            loadingCheck={loadingCheck}
            loadingDelete={loadingDelete}
            loadingConvert={loadingConvert}
            favoriteMarketId={favoriteMarketId}
            allowExpand={opts.allowExpand}
            infos={
              (item.product as any)?.hersteller?.infos ??
              (item.product as any)?.infos ??
              null
            }
            onInfoPress={() => {
              const text =
                (item.product as any)?.hersteller?.infos ??
                (item.product as any)?.infos ??
                null;
              const title =
                (item.product as any)?.hersteller?.name ??
                item.name ??
                item.product?.name ??
                'Info';
              if (typeof text === 'string' && text.trim().length > 0) {
                setInfoSheet({ title, body: text.trim() });
              }
            }}
          />
        </SwipeRow>
      );
    }
    return (
      <SwipeRow
        key={item.id}
        onSwipeBought={() => handleMarkAsPurchased(item.id, item.savings)}
        onSwipeDelete={() => handleRemoveFromCart(item.id)}
        disabled={loadingCheck || loadingDelete}
      >
        <NoNameCard
          item={item}
          onCheck={() => handleMarkAsPurchased(item.id, item.savings)}
          onDelete={() => handleRemoveFromCartConfirm(item.id)}
          loadingCheck={loadingCheck}
          loadingDelete={loadingDelete}
          favoriteMarketId={favoriteMarketId}
        />
      </SwipeRow>
    );
  };

  const renderPage = (variant: Tab) => {
    const items =
      variant === 'brand' ? filteredBrand : variant === 'noname' ? filteredNoName : filteredAll;
    const isEmpty = items.length === 0;
    return (
      <View key={variant} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{
            paddingTop: chromeHeight + SEG_BAR_HEIGHT,
            paddingBottom: 140,
          }}
          contentInsetAdjustmentBehavior="never"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadShoppingCart();
              }}
              progressViewOffset={chromeHeight + SEG_BAR_HEIGHT}
              tintColor={brand.primary}
            />
          }
          showsVerticalScrollIndicator={false}
          scrollIndicatorInsets={{ top: chromeHeight + SEG_BAR_HEIGHT }}
          // Nur die aktive PagerView-Page claimt iOS-Status-Bar-Tap-
          // Scroll-to-Top — sonst deaktiviert iOS das Feature weil
          // mehrere ScrollViews auf scrollsToTop=true (Default) wären.
          scrollsToTop={activeTab === variant}
        >
          {!isPremium ? (
            <View style={{ marginHorizontal: 16, marginTop: 6, marginBottom: 4 }}>
              <BannerAd style={{ marginHorizontal: 0 }} />
            </View>
          ) : null}

          {!isEmpty ? (
            <SummaryBanner
              variant={variant}
              potential={totalPotentialSavings}
              earned={totalActualSavings}
            />
          ) : null}

          {isEmpty ? (
            <EmptyState variant={variant} onAdd={() => setShowCustomItemModal(true)} />
          ) : (
            <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
              {items.map((item) => renderItem(item, { allowExpand: variant === 'brand' }))}
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 11,
                  color: theme.textMuted,
                  textAlign: 'center',
                  paddingVertical: 12,
                }}
              >
                Tipp: Nach rechts wischen = gekauft · Nach links wischen = löschen
              </Text>
            </View>
          )}
        </ScrollView>
      </View>
    );
  };

  // Bottom CTA
  const renderBottomCta = () => {
    if (activeTab === 'brand') {
      const selCount = selectedConversions.length;
      if (brandProducts.length === 0) return null;
      const disabled = selCount === 0 || isConverting;
      return (
        <Pressable
          onPress={handleConvertSelected}
          disabled={disabled}
          style={({ pressed }) => ({
            backgroundColor: disabled ? theme.borderStrong : brand.primary,
            height: 50,
            borderRadius: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: pressed && !disabled ? 0.85 : 1,
          })}
        >
          {isConverting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <MaterialCommunityIcons name="swap-horizontal" size={18} color="#fff" />
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 15,
                  color: '#fff',
                }}
              >
                {selCount === 0
                  ? 'Alternative wählen zum Umwandeln'
                  : `${selCount} Produkt${selCount > 1 ? 'e' : ''} umwandeln`}
              </Text>
            </>
          )}
        </Pressable>
      );
    }
    if (activeTab === 'noname') {
      if (noNameProducts.length === 0) return null;
      return (
        <Pressable
          onPress={() => handleMarkAllAsPurchased('noname')}
          style={({ pressed }) => ({
            backgroundColor: brand.primary,
            height: 50,
            borderRadius: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <MaterialCommunityIcons name="check-circle" size={18} color="#fff" />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 15,
              color: '#fff',
            }}
          >
            Alle als gekauft markieren
          </Text>
        </Pressable>
      );
    }
    // 'all' tab
    if (brandProducts.length + noNameProducts.length === 0) return null;
    return (
      <Pressable
        onPress={() => handleMarkAllAsPurchased('all')}
        style={({ pressed }) => ({
          backgroundColor: brand.primary,
          height: 50,
          borderRadius: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <MaterialCommunityIcons name="check-all" size={18} color="#fff" />
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 15,
            color: '#fff',
          }}
        >
          Alle als gekauft markieren
        </Text>
      </Pressable>
    );
  };

  // ─── Render ────────────────────────────────────────────────────
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Body fills the entire screen so scroll content can extend UP
          behind the chrome (DetailHeader + sticky SegmentedTabs row).
          The ScrollViews inside add `paddingTop: chromeHeight +
          SEG_BAR_HEIGHT` so the first item lands BELOW the chrome
          stack — but as the user scrolls, content slides under both
          and the BlurView shows the blur effect. */}
      <Crossfade
        ready={!initialLoading}
        duration={320}
        fillParent
        style={{ flex: 1 }}
        skeleton={<ShoppingListSkeleton />}
      >
        <PagerView
          ref={pagerRef}
          style={{ flex: 1 }}
          initialPage={0}
          onPageSelected={onPageSelected}
        >
          {renderPage('brand')}
          {renderPage('noname')}
          {renderPage('all')}
        </PagerView>
      </Crossfade>

      {/* Unified chrome — back/title row + SegmentedTabs in ONE
          BlurView so there's no visible seam between header and
          tab bar. zIndex 10, absolute over the scrollable body. */}
      <Chrome
        title="Einkaufszettel"
        onBack={() => router.back()}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable
              onPress={() => setShowFilter(true)}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: theme.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <MaterialCommunityIcons
                name="tune-vertical"
                size={18}
                color={theme.textMuted}
              />
              {activeFilterCount > 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: -2,
                    right: -2,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    paddingHorizontal: 4,
                    backgroundColor: brand.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.extraBold,
                      fontSize: 10,
                      color: '#fff',
                      lineHeight: 14,
                    }}
                  >
                    {activeFilterCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => setShowCustomItemModal(true)}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: brand.primary,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <MaterialCommunityIcons name="plus" size={20} color="#fff" />
            </Pressable>
          </View>
        }
        bottom={
          <SegmentedTabs
            tabs={[
              { key: 'brand', label: `Marken (${brandProducts.length})` },
              { key: 'noname', label: `NoNames (${noNameProducts.length})` },
              { key: 'all', label: `Alle (${brandProducts.length + noNameProducts.length})` },
            ] as const}
            value={activeTab}
            onChange={onTabChange}
          />
        }
      />

      {/* Bottom CTA — sticky, solid bg backplate. Scroll content
          simply clips at the top of this strip; no gradient fade
          (caused a visible "shadow" against white product cards). */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: Math.max(insets.bottom + 8, 16),
          backgroundColor: theme.bg,
        }}
      >
        {renderBottomCta()}
      </View>

      {/* Filter sheet */}
      <FilterSheet
        visible={showFilter}
        title="Filter & Sortierung"
        onClose={() => setShowFilter(false)}
      >
        <FilterSheetBody
          activeTab={activeTab}
          filters={filters}
          setFilters={setFilters}
          availableMarkets={availableMarkets}
          availableCategories={availableCategories}
          onClearAll={clearAllFilters}
          brandCount={brandProducts.length}
          noNameCount={noNameProducts.length}
        />
      </FilterSheet>

      {/* Marken-Info-Sheet — getriggert vom (i)-Icon im
          Hersteller-Chip einer BrandCard. */}
      <FilterSheet
        visible={!!infoSheet}
        title={infoSheet?.title ?? ''}
        onClose={() => setInfoSheet(null)}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.regular,
            fontSize: 14,
            lineHeight: 21,
            color: theme.text,
            paddingBottom: 8,
          }}
        >
          {infoSheet?.body ?? ''}
        </Text>
      </FilterSheet>

      {/* Batch loaders */}
      <BatchActionLoader
        visible={convertLoaderState.visible}
        title="Produkte umwandeln"
        subtitle="Markenprodukte werden zu NoNames"
        icon="arrow.triangle.2.circlepath"
        gradient={['#FF9800', '#F57C00']}
        progress={
          convertLoaderState.totalItems > 0
            ? convertLoaderState.processedItems / convertLoaderState.totalItems
            : 0
        }
        currentItem={convertLoaderState.currentItem}
        totalItems={convertLoaderState.totalItems}
        processedItems={convertLoaderState.processedItems}
      />
      <BatchActionLoader
        visible={purchaseLoaderState.visible}
        title="Als gekauft markieren"
        subtitle="Produkte werden abgehakt"
        icon="checkmark.circle.fill"
        gradient={['#4CAF50', '#2E7D32']}
        progress={
          purchaseLoaderState.totalItems > 0
            ? purchaseLoaderState.processedItems / purchaseLoaderState.totalItems
            : 0
        }
        currentItem={purchaseLoaderState.currentItem}
        totalItems={purchaseLoaderState.totalItems}
        processedItems={purchaseLoaderState.processedItems}
      />

      {/* Level-up overlay */}
      <LevelUpOverlay
        visible={showLevelUpOverlay}
        newLevel={levelUpData.newLevel}
        oldLevel={levelUpData.oldLevel}
        onClose={() => setShowLevelUpOverlay(false)}
      />

      {/* Custom item modal */}
      <AddCustomItemModal
        visible={showCustomItemModal}
        onClose={() => setShowCustomItemModal(false)}
        userId={user?.uid || ''}
        onSuccess={(message) => {
          showInfoToast(message, 'success');
          loadShoppingCart();
        }}
        onError={(message) => showInfoToast(message, 'error')}
      />
    </GestureHandlerRootView>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FilterSheetBody
// ═══════════════════════════════════════════════════════════════════
type FilterSheetBodyProps = {
  activeTab: Tab;
  filters: { markets: string[]; categories: string[]; sortBy: SortBy };
  setFilters: React.Dispatch<
    React.SetStateAction<{ markets: string[]; categories: string[]; sortBy: SortBy }>
  >;
  availableMarkets: { id: string; name: string }[];
  availableCategories: { id: string; bezeichnung?: string; name?: string }[];
  onClearAll: () => void;
  brandCount: number;
  noNameCount: number;
};

function FilterSheetBody({
  activeTab,
  filters,
  setFilters,
  availableMarkets,
  availableCategories,
  onClearAll,
  brandCount,
  noNameCount,
}: FilterSheetBodyProps) {
  const { theme, brand } = useTokens();
  const sortOptions =
    activeTab === 'brand' ? SORT_OPTIONS_BRAND : SORT_OPTIONS_NONAME;

  const showMarkets = activeTab !== 'brand' && availableMarkets.length > 0;
  const activeCount =
    filters.markets.length + filters.categories.length + (filters.sortBy !== 'name' ? 1 : 0);

  const toggleMarket = (id: string) =>
    setFilters((prev) => ({
      ...prev,
      markets: prev.markets.includes(id)
        ? prev.markets.filter((m) => m !== id)
        : [...prev.markets, id],
    }));
  const toggleCategory = (id: string) =>
    setFilters((prev) => ({
      ...prev,
      categories: prev.categories.includes(id)
        ? prev.categories.filter((c) => c !== id)
        : [...prev.categories, id],
    }));

  return (
    <View style={{ paddingTop: 4 }}>
      {/* Sort */}
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 14,
          color: theme.text,
          marginBottom: 6,
        }}
      >
        Sortierung
      </Text>
      <OptionList
        value={filters.sortBy}
        options={sortOptions}
        onChange={(v) => setFilters((prev) => ({ ...prev, sortBy: v }))}
      />

      {/* Markets */}
      {showMarkets ? (
        <>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 14,
              color: theme.text,
              marginTop: 16,
              marginBottom: 8,
            }}
          >
            Märkte
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {availableMarkets.map((m) => {
              const on = filters.markets.includes(m.id);
              return (
                <Pressable
                  key={m.id}
                  onPress={() => toggleMarket(m.id)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 18,
                    backgroundColor: on ? brand.primary : theme.surfaceAlt,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.bold,
                      fontSize: 12,
                      color: on ? '#fff' : theme.text,
                    }}
                  >
                    {m.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {/* Categories */}
      {availableCategories.length > 0 ? (
        <>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 14,
              color: theme.text,
              marginTop: 16,
              marginBottom: 8,
            }}
          >
            Kategorien
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {availableCategories.map((c) => {
              const on = filters.categories.includes(c.id);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => toggleCategory(c.id)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 18,
                    backgroundColor: on ? brand.primary : theme.surfaceAlt,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.bold,
                      fontSize: 12,
                      color: on ? '#fff' : theme.text,
                    }}
                  >
                    {c.bezeichnung || c.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {/* Footer: clear-all + counter */}
      <View
        style={{
          marginTop: 22,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            color: theme.textMuted,
          }}
        >
          {brandCount + noNameCount} Produkte gesamt
        </Text>
        <Pressable
          onPress={onClearAll}
          disabled={activeCount === 0}
          style={({ pressed }) => ({
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 18,
            backgroundColor: activeCount === 0 ? theme.surfaceAlt : theme.primaryContainer,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 12,
              color: activeCount === 0 ? theme.textMuted : brand.primary,
            }}
          >
            Zurücksetzen
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
