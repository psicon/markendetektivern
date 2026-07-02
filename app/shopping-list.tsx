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

import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRouter } from 'expo-router';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
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
  FadeIn,
  FadeOut,
  LinearTransition,
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
  CartSnapshotService,
  type CartSnapshot,
  type CartSnapshotItem,
} from '@/lib/services/cartSnapshotService';
import { isOnline, subscribeNetwork } from '@/lib/services/network';
import { CartOutboxService } from '@/lib/services/cartOutboxService';
import {
  FilterSheet,
  OptionList,
} from '@/components/design/FilterSheet';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { Crossfade, Shimmer } from '@/components/design/Skeletons';
import { AddCustomItemModal } from '@/components/ui/AddCustomItemModal';
import BatchActionLoader from '@/components/ui/BatchActionLoader';
import { ImageWithShimmer } from '@/components/ui/ImageWithShimmer';
import { TOAST_MESSAGES } from '@/constants/ToastMessages';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { getProductImage } from '@/lib/utils/productImage';
import { calculateSavings } from '@/lib/utils/savings';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { usePreferenceProfile, dominantDimension } from '@/hooks/usePreferenceProfile';
import { useRevenueCat } from '@/lib/contexts/RevenueCatProvider';
import achievementService from '@/lib/services/achievementService';
import { categoryAccessService } from '@/lib/services/categoryAccessService';
import { FirestoreService } from '@/lib/services/firestore';
import journeyTrackingService from '@/lib/services/journeyTrackingService';
import {
  showBulkConvertSuccessToast,
  showBulkPurchasedToast,
  showConvertSuccessToast,
  showInfoToast,
  showPurchasedToast,
  showRetryableErrorToast,
} from '@/lib/services/ui/toast';
import { updateUserStats } from '@/lib/services/userProfile';
import {
  SharedListService,
  type SharedListDoc,
  type SharedListItem,
} from '@/lib/services/sharedListService';
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
  /** Prozent-Wert aus der gleichen calculateSavings-Berechnung wie
   *  potentialSavings (eur). Verwendung: BrandCard "Ersparnis möglich:
   *  X%" Display zeigt dieselbe Zahl wie der Alt-Banner "−X%" auf
   *  der besten Alternative — vorher wurden zwei verschiedene Formeln
   *  verwendet (eur/preis × 100 vs. per-pack-unit normalized). */
  potentialSavingsPercent?: number;
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
  /** NEU (2026-05-07): Cart-Anzahl. Default 1 für Backwards-Compat
   *  mit Legacy-Auto-ID-Docs ohne anzahl-Feld. */
  anzahl?: number;
  /** NEU (2026-05-07): Produkt-ID explizit (für Quantity-Operations).
   *  getDocumentByReference returnt nur doc.data() ohne .id, daher
   *  müssen wir die ID separat halten. */
  productId?: string;
  /** NEU: Journey-Tracking-Daten (vom cart-doc). Werden beim Remove
   *  als Payload mitgegeben → kein getDoc mehr im Critical-Path. */
  journeyId?: string;
  viewedProductIndex?: number;
  /** Cart-Schema v1→v2 Legacy-Migration: zusätzliche cart-doc-IDs
   *  für dasselbe Produkt, die durch read-side merge konsolidiert
   *  wurden. Bei Mark-as-Purchased / Remove müssen alle davon
   *  mitmarkiert/-gelöscht werden, sonst bleiben Geister-Docs in
   *  Firestore und tauchen beim nächsten Refresh wieder auf. */
  legacyIds?: string[];
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

/** Pack-Details im "185g | 9,68€/kg" Stil. Returns null wenn keine Daten. */
function formatPack(size?: number, unit?: string, price?: number): string | null {
  if (!size || !unit) return null;
  const u = String(unit).toLowerCase().replace(/\.$/, '');
  const isStk = u === 'stk' || u === 'stück';
  const sizeLabel = isStk ? `${size} ${unit}` : `${size}${unit}`;
  let unitPrice: string | null = null;
  if (price && price > 0) {
    if (u === 'g') unitPrice = `${((price / size) * 1000).toFixed(2).replace('.', ',')}€/kg`;
    else if (u === 'kg') unitPrice = `${(price / size).toFixed(2).replace('.', ',')}€/kg`;
    else if (u === 'ml') unitPrice = `${((price / size) * 1000).toFixed(2).replace('.', ',')}€/L`;
    else if (u === 'l') unitPrice = `${(price / size).toFixed(2).replace('.', ',')}€/L`;
    else if (isStk) unitPrice = `${(price / size).toFixed(2).replace('.', ',')}€/${unit}`;
  }
  return unitPrice ? `${sizeLabel} | ${unitPrice}` : sizeLabel;
}

const formatEur = (n: number) =>
  `${(n || 0).toFixed(2).replace('.', ',')} €`;

// ─── Extern teilen: Einkaufszettel als schöner Text ──────────────────
// (Produktname · Marke · Markt · Preis, mit Anzahl + Summe). Reine
// Read-Side-Formatierung der bereits geladenen Items — kein Datenmodell.
function shareItemLine(it: EnrichedItem): string {
  const qty = it.anzahl ?? 1;
  const name = it.name || it.product?.name || it.product?.produktName || 'Produkt';
  const brand =
    it.product?.marke?.name ||
    it.product?.hersteller?.name ||
    it.product?.handelsmarke?.bezeichnung ||
    '';
  const marketName = it.product?.discounter?.name || it.markt?.name || '';
  const land = it.product?.discounter?.land || it.markt?.land || '';
  const market = marketName ? `${marketName}${land ? ` (${land})` : ''}` : '';
  const preis = typeof it.product?.preis === 'number' ? it.product.preis : null;
  const meta = [brand, market, preis != null ? formatEur(preis) : '']
    .filter(Boolean)
    .join(' · ');
  return `• ${qty}× ${name}${meta ? ` — ${meta}` : ''}`;
}

export function buildShoppingListShareText(
  brand: EnrichedItem[],
  noname: EnrichedItem[],
): string {
  const lines: string[] = ['🛒 Mein Einkaufszettel'];
  const section = (title: string, arr: EnrichedItem[]) => {
    if (!arr.length) return;
    lines.push('', title);
    for (const it of arr) lines.push(shareItemLine(it));
  };
  section('MARKEN', brand);
  section('EIGENMARKEN', noname);

  let totalQty = 0;
  let totalEur = 0;
  for (const it of [...brand, ...noname]) {
    const qty = it.anzahl ?? 1;
    totalQty += qty;
    if (typeof it.product?.preis === 'number') totalEur += it.product.preis * qty;
  }
  lines.push('', `${totalQty} Artikel${totalEur > 0 ? ` · ca. ${formatEur(totalEur)}` : ''}`);
  lines.push('', 'Geteilt aus der MarkenDetektive-App');
  return lines.join('\n');
}

// ─── Leiste „Geteilte Listen" (oben im Zettel) ──────────────────────
// Additiv: zeigt die geteilten Listen des Users als horizontale Karten. Antippen
// öffnet die geteilte Liste. Rein präsentational (Daten kommen vom Parent), damit
// der persönliche Zettel-Datenpfad unangetastet bleibt.
function ShoppingSharedListsStrip({
  lists,
  myUid,
  theme,
  brand,
  onOpen,
}: {
  lists: SharedListDoc[];
  myUid?: string;
  theme: any;
  brand: any;
  onOpen: (id: string) => void;
}) {
  if (!lists.length) return null;
  return (
    <View style={{ marginTop: 8, marginBottom: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginBottom: 8 }}>
        <MaterialCommunityIcons name="account-multiple" size={15} color={theme.textSub} />
        <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 12, color: theme.textSub, letterSpacing: 0.4, textTransform: 'uppercase' }}>
          Geteilte Listen
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollsToTop={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
      >
        {lists.map((l) => {
          const count = l.memberIds?.length ?? 1;
          const mine = l.ownerId === myUid;
          return (
            <Pressable
              key={l.id}
              onPress={() => onOpen(l.id)}
              style={({ pressed }) => ({
                width: 172,
                backgroundColor: theme.surface,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: theme.border,
                padding: 12,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name="cart-outline" size={16} color={brand.primary} />
                </View>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily, fontWeight: fontWeight.extraBold, fontSize: 13, color: theme.text, letterSpacing: -0.2 }}>
                  {l.name}
                </Text>
              </View>
              <Text numberOfLines={1} style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 11, color: theme.textMuted, marginTop: 8 }}>
                {count} {count === 1 ? 'Mitglied' : 'Mitglieder'}
                {mine ? ' · von dir' : l.ownerName ? ` · ${l.ownerName}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Skeletons
// ═══════════════════════════════════════════════════════════════════
function ShoppingListSkeleton({ topInset }: { topInset: number }) {
  const { theme } = useTokens();
  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: 16,
        // Skeleton sits inside Crossfade which fills the full screen
        // (incl. behind the chrome). Push the first card DOWN past
        // the chrome so it doesn't get clipped behind DetailHeader +
        // sticky tabs row.
        paddingTop: topInset + 12,
        paddingBottom: 140,
      }}
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
//   • Rechts wischen ≥ THRESH px → onSwipeDelete, fling rechts raus
//   • Links wischen  ≤ -THRESH    → onSwipeBought, fling links raus
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

export type SwipeRowHandle = {
  /** Triggers the same "marked as bought" animation that swipe-left
   *  uses — strikethrough + pop-out + collapse — and fires
   *  onSwipeBought when the animation completes. Used by the
   *  EdgeCheckButton (Tap = gekauft markieren) so the visual
   *  feedback ist identisch zur Swipe-Geste. */
  playBought: () => void;
};

const ROW_GAP = 10; // marginBottom between rows in normal flow
const SWIPE_FLING_DURATION = 200;
const COLLAPSE_DURATION = 260;
// Bought-Animation Timing (Strike + Pop-Out)
const BOUGHT_STRIKE_DURATION = 220;   // Stiftstrich zieht durch
// User-Feedback: 'verschwindet minimal zu schnell 400-500ms länger
// anzeigen wär cool'. Hold von 90 → 540 ms (+450 ms) — die fertig-
// gestrichene Zeile bleibt jetzt deutlich länger stehen damit der
// User den Strike-Effekt würdigen kann bevor sie raus-poppt.
const BOUGHT_HOLD_DURATION = 540;     // gestrichene Zeile sehen
const BOUGHT_POP_DURATION = 260;      // scale + fade + collapse
const BOUGHT_TOTAL = BOUGHT_STRIKE_DURATION + BOUGHT_HOLD_DURATION + BOUGHT_POP_DURATION;

const SwipeRow = forwardRef<SwipeRowHandle, SwipeRowProps>(function SwipeRow(
  { children, onSwipeBought, onSwipeDelete, disabled },
  ref,
) {
  const { theme, brand } = useTokens();
  const tx = useSharedValue(0);
  // collapse: 0 = full row visible, 1 = fully collapsed (height 0, opacity 0)
  const collapse = useSharedValue(0);
  // Bought-Animation Progress: 0 = idle, 1 = fully struck-through+popped.
  // Phasen-Mapping (bei TOTAL = strike+hold+pop ms):
  //   t ∈ [0, strike/total]                → strike line draws 0→1
  //   t ∈ [strike/total, (strike+hold)/total] → hold (line at 1)
  //   t ∈ [(strike+hold)/total, 1]         → pop: scale+fade+collapse 0→1
  const boughtAnim = useSharedValue(0);
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

  // Spielt die Bought-Animation: erst Strike-Line zieht durch, dann
  // pop-out (scale + fade + collapse). Triggered sowohl bei Swipe
  // links als auch bei EdgeCheckButton-Tap → konsistente Visual.
  const playBoughtAnimation = () => {
    if (phase !== 'idle') return;
    setPhase('collapsing');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    boughtAnim.value = withTiming(
      1,
      { duration: BOUGHT_TOTAL, easing: Easing.bezier(0.25, 0.1, 0.25, 1) },
      (done) => {
        if (done) runOnJS(triggerBought)();
      },
    );
  };

  useImperativeHandle(
    ref,
    () => ({
      playBought: playBoughtAnimation,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase],
  );

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
      boughtAnim.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
      setPhase('idle');
    }, 2500);
    return () => clearTimeout(timer);
  }, [phase, tx, collapse, boughtAnim]);

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
        // Rechts wischen → DELETE.
        // Fling foreground off (fast) and collapse the WHOLE row in
        // parallel — height + margin + opacity all to 0 over ~260 ms.
        tx.value = withTiming(SWIPE_FLING_OFFSCREEN, {
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
      } else if (dx <= -SWIPE_THRESH) {
        // Links wischen → BOUGHT. Card fliegt nach links raus,
        // Höhe kollabiert parallel — die Strike-Anim ist NUR für den
        // Tap-Pfad (EdgeCheckButton), Swipes haben ihr eigenes
        // Visual-Feedback durch die Geste selbst.
        tx.value = withTiming(-SWIPE_FLING_OFFSCREEN, {
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
      } else {
        // Snap back to rest position with a calmer spring-style ease-out.
        tx.value = withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) });
      }
    });

  const fgStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));
  // Drag rechts → Delete-BG sichtbar; Drag links → Bought-BG sichtbar.
  const deleteBgStyle = useAnimatedStyle(() => ({
    opacity: tx.value > 8 ? 1 : 0,
  }));
  const boughtBgStyle = useAnimatedStyle(() => ({
    opacity: tx.value < -8 ? 1 : 0,
  }));

  // Wrapper animates height + marginBottom + opacity together, so the
  // row collapses into the gap und die rows below sliden hoch.
  //
  // Wichtig: nur DURING dem Collapse (collapse.value > 0) klemmen wir
  // die Höhe auf measuredHeight. Im Idle-State (collapse.value === 0)
  // lassen wir die Höhe frei — sonst würde ein expanded BrandCard
  // (Inner-Content wächst) auf den initial gemessenen Wert geclippt.
  // Phasen-Cutoffs für die Bought-Animation
  const STRIKE_END = BOUGHT_STRIKE_DURATION / BOUGHT_TOTAL;
  const POP_START = (BOUGHT_STRIKE_DURATION + BOUGHT_HOLD_DURATION) / BOUGHT_TOTAL;

  const wrapperStyle = useAnimatedStyle(() => {
    // Während der Bought-Animation kollabiert die Höhe in Phase 3
    // (POP_START → 1). Vorher behält die Row volle Höhe damit der
    // Strike-Strich auf der vollen Breite gezogen werden kann.
    const popT = interpolate(boughtAnim.value, [POP_START, 1], [0, 1], Extrapolation.CLAMP);
    const popOpacity = interpolate(popT, [0, 1], [1, 0], Extrapolation.CLAMP);
    const popScale = interpolate(popT, [0, 1], [1, 0.92], Extrapolation.CLAMP);

    if (boughtAnim.value > 0 && measuredHeight > 0) {
      return {
        height: interpolate(popT, [0, 1], [measuredHeight, 0], Extrapolation.CLAMP),
        marginBottom: interpolate(popT, [0, 1], [ROW_GAP, 0], Extrapolation.CLAMP),
        opacity: popOpacity,
        transform: [{ scale: popScale }],
      };
    }

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

  // Strike-Line Overlay: zieht von links nach rechts während der
  // ersten Phase. Verwendet scaleX mit transformOrigin:'left center'
  // statt width:%-Animation — so läuft die Anim auf der UI-thread
  // ohne Layout-Recalc und ohne Integer-Stepping. Der Strich ist
  // dezent (theme.text statt brand.primary), 5 px dick mit Round-
  // Caps via borderRadius, leicht schräg gestellt für "wie mit Stift"
  // Feel.
  const strikeStyle = useAnimatedStyle(() => {
    if (boughtAnim.value <= 0) return { transform: [{ scaleX: 0 }] };
    const drawT = interpolate(boughtAnim.value, [0, STRIKE_END], [0, 1], Extrapolation.CLAMP);
    return { transform: [{ scaleX: drawT }] };
  });

  // Check-Icon-Flourish: erscheint kurz NACH dem Strike (ab STRIKE_END)
  // mit Spring-Bounce in der Mitte der Card. Gibt der Animation einen
  // satisfying "Erledigt!"-Moment bevor die Row rauspoppt.
  const checkStyle = useAnimatedStyle(() => {
    if (boughtAnim.value <= STRIKE_END) return { opacity: 0, transform: [{ scale: 0.4 }] };
    // Bounce-In von STRIKE_END → POP_START, dann konstant bis kurz
    // vor Ende, dann fade mit dem Pop-Out.
    const bounceT = interpolate(boughtAnim.value, [STRIKE_END, POP_START], [0, 1], Extrapolation.CLAMP);
    const fadeT = interpolate(boughtAnim.value, [POP_START, 1], [1, 0], Extrapolation.CLAMP);
    // Overshoot + settle: 0 → 1.15 (auf 0.7 von Bounce) → 1.0
    const scale = bounceT < 0.7
      ? interpolate(bounceT, [0, 0.7], [0.4, 1.15], Extrapolation.CLAMP)
      : interpolate(bounceT, [0.7, 1], [1.15, 1], Extrapolation.CLAMP);
    return { opacity: bounceT * fadeT, transform: [{ scale }] };
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
        {/* Delete-BG: zeigt sich beim Rechts-Wischen, Icon+Label
            sitzen links (= Seite, von der gezogen wird). */}
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
              paddingLeft: 18,
              gap: 10,
            },
            deleteBgStyle,
          ]}
        >
          <MaterialCommunityIcons name="trash-can-outline" size={26} color="#fff" />
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
        </Animated.View>
        {/* Bought-BG: zeigt sich beim Links-Wischen, Icon+Label
            sitzen rechts. */}
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
              justifyContent: 'flex-end',
              paddingRight: 18,
              gap: 10,
            },
            boughtBgStyle,
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
            Gekauft
          </Text>
          <MaterialCommunityIcons name="check-circle" size={26} color="#fff" />
        </Animated.View>
      </View>

      <GestureDetector gesture={pan}>
        <Animated.View style={fgStyle}>{children}</Animated.View>
      </GestureDetector>

      {/* Strike-Line Overlay: dezenter Stift-Strich, theme.text mit
          reduzierter Opacity. Inset 90 px von links (skip Image),
          70 px von rechts (skip EdgeCheckButton). Leichter Schräg-
          Effekt (-1.2°) für "handgezeichnet" Feel. scaleX mit
          transformOrigin:'left center' simuliert Stift-Bewegung von
          links nach rechts ohne Layout-Recalc.
          pointerEvents:none damit Taps nicht blockiert werden. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 90,
          right: 70,
          top: '50%',
          height: 5,
          marginTop: -2.5,
          transform: [{ rotate: '-1.2deg' }],
        }}
      >
        <Animated.View
          style={[
            {
              width: '100%',
              height: '100%',
              backgroundColor: theme.text,
              opacity: 0.7,
              borderRadius: 3,
              transformOrigin: 'left center',
            } as any,
            strikeStyle,
          ]}
        />
      </View>
      {/* Check-Icon-Flourish: scale-bouncing primary-Circle in der
          Card-Mitte, erscheint nach dem Strike und holdet bis Pop. */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: 44,
            height: 44,
            marginTop: -22,
            marginLeft: -22,
            borderRadius: 22,
            backgroundColor: brand.primary,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.18,
            shadowRadius: 4,
            elevation: 4,
          },
          checkStyle,
        ]}
      >
        <MaterialCommunityIcons name="check-bold" size={26} color="#fff" />
      </Animated.View>
    </Animated.View>
  );
});

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
// ShoppingRowWithBoughtAnim — kleiner Wrapper der jedem Item-Row
// einen eigenen SwipeRow-Ref + `playBought()`-Trigger gibt. Damit
// kann der inline EdgeCheckButton (Tap = gekauft markieren) die
// gleiche Strike+Pop-Animation auslösen wie der Swipe-links — der
// optimistische Remove fired erst NACH der Animation am Anim-Ende
// (siehe SwipeRow.playBought).
// ═══════════════════════════════════════════════════════════════════
function ShoppingRowWithBoughtAnim({
  onSwipeBought,
  onSwipeDelete,
  disabled,
  renderChild,
}: {
  onSwipeBought: () => void;
  onSwipeDelete: () => void;
  disabled?: boolean;
  renderChild: (playBought: () => void) => React.ReactNode;
}) {
  const swipeRef = useRef<SwipeRowHandle>(null);
  const play = useCallback(() => swipeRef.current?.playBought(), []);
  return (
    <SwipeRow
      ref={swipeRef}
      onSwipeBought={onSwipeBought}
      onSwipeDelete={onSwipeDelete}
      disabled={disabled}
    >
      {renderChild(play)}
    </SwipeRow>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EdgeCheckButton — Gekauft-Button als vertikaler Strip am rechten
// Card-Rand. 48 px breit, volle Card-Höhe, brand.primary bg.
// Spart die ~60 px die der inline-Check-Button vorher in der Row
// belegte → mehr Platz für den Produktnamen.
// ═══════════════════════════════════════════════════════════════════
function EdgeCheckButton({ onPress, loading }: { onPress: () => void; loading?: boolean }) {
  const { brand, theme } = useTokens();
  // Schlanker (56 → 44 wide) — gibt mehr horizontalen Platz für
  // den Produktnamen. Subtler Gradient von transparent links →
  // ~5% grau rechts bleibt für den weichen Übergang. hitSlop 6
  // erweitert die Tap-Area auf 56 effektive px.
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      hitSlop={6}
      style={({ pressed }) => ({
        alignSelf: 'stretch',
        width: 44,
        opacity: loading ? 0.7 : 1,
        backgroundColor: pressed ? theme.surfaceAlt : 'transparent',
      })}
    >
      <LinearGradient
        colors={['rgba(0,0,0,0.0)', 'rgba(0,0,0,0.045)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {loading ? (
          <ActivityIndicator size="small" color={brand.primary} />
        ) : (
          <MaterialCommunityIcons name="check-bold" size={22} color={brand.primary} />
        )}
      </LinearGradient>
    </Pressable>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CompactQuantityPill — kompaktes − N + Pill (~70 px breit) für die
// inline-Position rechts im Card-Row vor dem EdgeCheckButton.
// Gleicher Look wie die alte RowActions-Pill, nur kompakter.
// ═══════════════════════════════════════════════════════════════════
function CompactQuantityPill({
  anzahl,
  onIncrement,
  onDecrement,
}: {
  anzahl: number;
  onIncrement?: () => void;
  onDecrement?: () => void;
}) {
  const { brand, theme } = useTokens();
  if (!onIncrement || !onDecrement) return null;
  // Mittelgroß: Buttons 36×36, Container-Height 46, Icon 18, N
  // font 16, minWidth 22 — gut tap-bar ohne zu klobig.
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 23,
        paddingHorizontal: 3,
        height: 46,
      }}
    >
      <Pressable
        onPress={onDecrement}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed
            ? anzahl <= 1
              ? '#fee2e2'
              : theme.surfaceAlt
            : 'transparent',
        })}
      >
        <MaterialCommunityIcons
          name={anzahl <= 1 ? 'trash-can-outline' : 'minus'}
          size={18}
          color={anzahl <= 1 ? '#dc2626' : theme.text}
        />
      </Pressable>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 16,
          color: theme.text,
          minWidth: 22,
          textAlign: 'center',
          letterSpacing: -0.2,
        }}
      >
        {anzahl}
      </Text>
      <Pressable
        onPress={onIncrement}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? brand.primaryContainer ?? theme.surfaceAlt : brand.primary,
        })}
      >
        <MaterialCommunityIcons name="plus" size={18} color="#fff" />
      </Pressable>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Inline action buttons (Check + Trash) — used inside cards
// ═══════════════════════════════════════════════════════════════════
function RowActions({
  onCheck,
  onDelete: _onDelete, // beibehalten für API-Kompat (Custom-Items, Bulk), aber nicht mehr im UI
  loadingCheck,
  loadingDelete: _loadingDelete,
  anzahl,
  onIncrement,
  onDecrement,
}: {
  onCheck: () => void;
  onDelete: () => void;
  loadingCheck?: boolean;
  loadingDelete?: boolean;
  /** NEU (2026-05-07): wenn definiert, wird inline +/− gezeigt. */
  anzahl?: number;
  onIncrement?: () => void;
  onDecrement?: () => void;
}) {
  const { brand, theme } = useTokens();
  // Layout (User-Vorgabe 2026-05-07):
  //   [ - N + ]  [    ✓ Gekauft    ]
  // Quantity-Pill links, größerer Check-Button rechts. Kein Lösch-
  // Button mehr — Löschen läuft via Swipe (oder via "−" wenn anzahl=1
  // → Pill zeigt dann Mülleimer-Icon statt "−").
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {/* Quantity-Pill (nur bei DB-Items mit anzahl-Feld) */}
      {anzahl !== undefined && onIncrement && onDecrement && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 18,
            paddingHorizontal: 2,
            height: 36,
          }}
        >
          <Pressable
            onPress={onDecrement}
            hitSlop={4}
            style={({ pressed }) => ({
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed
                ? anzahl <= 1
                  ? '#fee2e2'
                  : theme.surfaceAlt
                : 'transparent',
            })}
          >
            <MaterialCommunityIcons
              name={anzahl <= 1 ? 'trash-can-outline' : 'minus'}
              size={16}
              color={anzahl <= 1 ? '#dc2626' : theme.text}
            />
          </Pressable>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 14,
              color: theme.text,
              minWidth: 20,
              textAlign: 'center',
              letterSpacing: -0.2,
            }}
          >
            {anzahl}
          </Text>
          <Pressable
            onPress={onIncrement}
            hitSlop={4}
            style={({ pressed }) => ({
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? brand.primaryContainer ?? theme.surfaceAlt : brand.primary,
            })}
          >
            <MaterialCommunityIcons name="plus" size={16} color="#fff" />
          </Pressable>
        </View>
      )}

      {/* Großer Check-Button (Gekauft markieren) */}
      <Pressable
        onPress={onCheck}
        disabled={loadingCheck}
        hitSlop={4}
        style={({ pressed }) => ({
          height: 44,
          minWidth: 44,
          paddingHorizontal: 12,
          borderRadius: 22,
          backgroundColor: brand.primary,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed || loadingCheck ? 0.7 : 1,
        })}
      >
        {loadingCheck ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <MaterialCommunityIcons name="check" size={22} color="#fff" />
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
  /** #1: Profil ist preis-dominant → NoName-Alternativen preislich vorsortieren. */
  priceDominant?: boolean;
  /** When false, expandable section is hidden (used in "Alle"-Tab to keep simple). */
  allowExpand?: boolean;
  /** Hersteller-`infos` Text — wenn vorhanden zeigt die Card ein
   *  (i)-Icon neben dem Hersteller-Namen. Tap triggert
   *  `onInfoPress` — Parent öffnet ein FilterSheet mit dem Text. */
  infos?: string | null;
  onInfoPress?: () => void;
  /** NEU (2026-05-07): Anzahl-Steuerung. */
  onIncrement?: () => void;
  onDecrement?: () => void;
};

function BrandCard({
  item,
  expanded,
  onToggleExpand,
  onCheck,
  onDelete,
  onIncrement,
  onDecrement,
  selectedAltId,
  onSelectAlt,
  onConvertAlt,
  loadingCheck,
  loadingDelete,
  loadingConvert,
  favoriteMarketId,
  priceDominant = false,
  allowExpand = true,
  infos,
  onInfoPress,
}: BrandCardProps) {
  const { theme, brand } = useTokens();
  const product = item.product;
  // #1: bei Preis-Dominanz Alternativen preislich sortieren — Lieblingsmarkt
  // bleibt vorn (kein Widerspruch zum „Lieblingsmarkt wird bevorzugt"-Label).
  const alts: any[] = useMemo(() => {
    const base = item.alternatives || [];
    if (!priceDominant || base.length < 2) return base;
    const favRank = (x: any) => (favoriteMarketId && x?.discounter?.id === favoriteMarketId ? 0 : 1);
    return [...base].sort((a, b) => favRank(a) - favRank(b) || ((a?.preis ?? 0) - (b?.preis ?? 0)));
  }, [item.alternatives, priceDominant, favoriteMarketId]);
  const hasAlts = alts.length > 0;
  const selectedAlt = alts.find((a) => a.id === selectedAltId) || alts[0];
  const potential = item.potentialSavings || 0;

  const canExpand = allowExpand && hasAlts;

  return (
    <Animated.View
      // Timing-basiert (kein Spring) damit Card-Höhe und Content-Fade
      // synchron laufen. Spring mit damping 20 / stiffness 200 war
      // underdamped und schwingte 1.5+ s nach — passte nicht zum
      // 220 ms FadeIn. 240 ms timing-basiert mit Material-Standard-
      // Easing fühlt sich snappy + abgestimmt an.
      layout={LinearTransition.duration(240).easing(Easing.out(Easing.cubic))}
      style={{
        backgroundColor: theme.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        overflow: 'hidden',
      }}
    >
      {/* Action-Top-Section: Body-Row + Footer als linke Spalte
          (flex:1), EdgeCheckButton als rechte Spalte (full Höhe
          beider zusammen). So füllt der Edge-Strip die komplette
          Card-Höhe ohne durch den Footer abgeschnitten zu werden. */}
      <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
      <View style={{ flex: 1, position: 'relative' }}>
      <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
      <Pressable
        onPress={canExpand ? onToggleExpand : undefined}
        disabled={!canExpand}
        style={({ pressed }) => ({
          flex: 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingTop: 10,
          paddingBottom: 10,
          paddingLeft: 10,
          // paddingRight reserviert Platz für die absolut positionierte
          // Pill rechts (Pill ~110 wide + 8 right-offset). Damit der
          // Content nicht unter der Pill verschwindet.
          paddingRight: 120,
          opacity: pressed && canExpand ? 0.7 : 1,
        })}
      >
        <ImageWithShimmer
          source={{ uri: getProductImage(product) ?? undefined }}
          style={{ width: 62, height: 62, borderRadius: 10, backgroundColor: '#ffffff' }}
          resizeMode="contain"
          thumb={(product as any)?.bildThumb}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          {(() => {
            // Prefer marke (Markenname + Markenlogo) über hersteller
            // (Manufacturer-Daten). Beispiel: "Coca-Cola" statt "The
            // Coca-Cola Company". Nur wenn keine marke-Doc vorhanden
            // ist (kein herstellerref-Chain), fällt der Chip auf
            // hersteller zurück.
            const brandLogo: any = (product as any)?.marke ?? (product as any)?.hersteller;
            if (!brandLogo?.name) return null;
            return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2 }}>
              {brandLogo?.bild ? (
                <ImageWithShimmer
                  source={{ uri: brandLogo.bild }}
                  style={{ width: 16, height: 16, borderRadius: 3 }}
                  resizeMode="contain"
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
                {brandLogo.name}
              </Text>
            </View>
            );
          })()}
          <Text
            numberOfLines={2}
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 14,
              color: theme.text,
              lineHeight: 18,
              // 2 Zeilen ZWINGEND (auch bei kurzem Text) damit alle
              // Cards exakt gleich hoch sind und nicht variieren.
              minHeight: 36,
            }}
          >
            {item.name || product?.name || 'Unbekanntes Produkt'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
            {(() => {
              const pack = formatPack(
                (product as any)?.packSize,
                (product as any)?.packTypInfo?.typKurz ?? (product as any)?.packTypInfo?.typ,
                product?.preis,
              );
              return pack ? (
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 11,
                    color: theme.textMuted,
                  }}
                  numberOfLines={1}
                >
                  {pack}
                </Text>
              ) : null;
            })()}
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 13,
                color: theme.text,
              }}
            >
              {formatEur((product?.preis || 0) * (item.anzahl ?? 1))}
            </Text>
          </View>
          {/* "Ersparnis möglich"-Zeile entfernt — der Footer-Button
              "Alternativen" zusammen mit den −X% Bannern auf den
              Alt-Cards kommuniziert das schon klarer. Card-Höhe
              wird dadurch um eine Row geringer. */}
        </View>
      </Pressable>
      </View>{/* /Body-Row */}
      {/* Footer "Alternativen" — paddingLeft kompensiert die
          EdgeCheckButton-Breite rechts → Text+Chevron landen exakt
          auf Card-Mitte statt auf Mitte-der-linken-Spalte. */}
      {canExpand ? (
        <Pressable
          onPress={onToggleExpand}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingTop: 4,
            paddingBottom: 8,
            paddingLeft: 44,
            opacity: pressed ? 0.55 : 1,
          })}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.semibold,
              fontSize: 12,
              color: brand.primary,
              letterSpacing: 0.1,
            }}
          >
            Alternativen
          </Text>
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={brand.primary}
          />
        </Pressable>
      ) : null}
      {/* Pill absolut auf leftCol-Level: top:0 bottom:0 spannt
          BODY+FOOTER zusammen → Pill-Mitte ist exakt auf der
          gleichen vertikalen Linie wie die EdgeCheckButton-Mitte
          (beide laufen über die volle Card-Höhe). right:8 schafft
          Abstand zum Edge-Strip. */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 8,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CompactQuantityPill
          anzahl={item.anzahl ?? 1}
          onIncrement={onIncrement}
          onDecrement={onDecrement}
        />
      </View>
      </View>{/* /Linke Spalte (Body+Footer) */}
      <EdgeCheckButton onPress={onCheck} loading={loadingCheck} />
      </View>{/* /Action-Top-Section */}

      {/* Expanded NoName-Alternatives — animiertes Ein-/Ausblenden
          via FadeIn/FadeOut. Card-Höhe morpht parallel via
          LinearTransition am Card-Outer (240 ms cubic-out).
          Timings:
          - FadeIn 200 ms, leicht KÜRZER als Layout 240 ms → Content
            fadet ein während Card noch wächst, kommt damit "an"
            statt zu spät zu erscheinen.
          - FadeOut 140 ms, deutlich kürzer → Content ist sauber weg
            bevor Card fertig schrumpft, kein "leerer Bereich der
            verschwindet"-Effekt. */}
      {allowExpand && expanded && hasAlts ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(140)}
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
                {/* Image-Wrapper mit absolutem Spar-Banner oben links —
                    zeigt den potentiellen Discount % wenn der User
                    diese Alternative wählt. */}
                <View style={{ position: 'relative' }}>
                  <ImageWithShimmer
                    thumb={(alt as any)?.bildThumb}
                    source={{ uri: getProductImage(alt) ?? undefined }}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 8,
                      backgroundColor: '#ffffff',
                    }}
                    resizeMode="contain"
                  />
                  {sd.savingsPercent > 0 ? (
                    <View
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        top: -5,
                        left: -8,
                        backgroundColor: brand.primary,
                        paddingHorizontal: 5,
                        paddingVertical: 1.5,
                        borderRadius: 4,
                        transform: [{ rotate: '-14deg' }],
                        shadowColor: '#000',
                        shadowOpacity: 0.18,
                        shadowOffset: { width: 0, height: 1 },
                        shadowRadius: 2,
                        elevation: 3,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily,
                          fontWeight: fontWeight.extraBold,
                          fontSize: 9,
                          color: '#fff',
                          letterSpacing: 0.2,
                        }}
                      >
                        −{sd.savingsPercent}%
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {/* Zeile 1: Name + Preis (gleiche Baseline) */}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        fontFamily,
                        fontWeight: fontWeight.bold,
                        fontSize: 12,
                        color: theme.text,
                      }}
                    >
                      {alt.produktName || alt.name}
                    </Text>
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
                  </View>
                  {/* Zeile 2: Markt + −X% (gleiche Baseline) */}
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
                        flex: 1,
                        fontFamily,
                        fontWeight: fontWeight.medium,
                        fontSize: 10,
                        color: theme.textMuted,
                      }}
                    >
                      {alt.discounter?.name || 'Unbekannt'}
                      {alt.discounter?.land ? ` (${alt.discounter.land})` : ''}
                    </Text>
                    {/* Absoluter Spar-Betrag in € — den Banner zeigt
                        nur das %, hier kommt der konkrete Euro-Wert. */}
                    {sd.savingsEur > 0 ? (
                      <Text
                        style={{
                          fontFamily,
                          fontWeight: fontWeight.extraBold,
                          fontSize: 10,
                          color: brand.primary,
                          letterSpacing: 0.1,
                        }}
                      >
                        {`spar ${formatEur(sd.savingsEur)}`}
                      </Text>
                    ) : null}
                  </View>
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
        </Animated.View>
      ) : null}
    </Animated.View>
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
  /** NEU (2026-05-07): Anzahl-Steuerung. */
  onIncrement?: () => void;
  onDecrement?: () => void;
};

function NoNameCard({
  item,
  onCheck,
  onDelete,
  loadingCheck,
  loadingDelete,
  favoriteMarketId,
  onIncrement,
  onDecrement,
}: NoNameCardProps) {
  const { theme, brand } = useTokens();
  const p = item.product;
  const isFav = favoriteMarketId && p?.discounter?.id === favoriteMarketId;
  const savings = item.savings || 0;
  // Gespart-% berechnen (relativ zum Brand-Originalpreis):
  // savings / (preis + savings) × 100. Wir kennen den Brand-Preis
  // nicht direkt, aber savings + noname_preis = brand_preis.
  const nonamePreis = p?.preis ?? 0;
  const savingsPercent =
    savings > 0 && nonamePreis + savings > 0
      ? Math.round((savings / (nonamePreis + savings)) * 100)
      : 0;

  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        flexDirection: 'row',
        alignItems: 'stretch',
        overflow: 'hidden',
      }}
    >
      {/* leftCol mit position:relative damit die Pill absolute
          positioniert vertikal mittig zur Card-Höhe sitzt. */}
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingBottom: 10, paddingLeft: 10, paddingRight: 120, position: 'relative' }}>
      {/* Image-Wrapper mit absolutem Spar-Banner oben links —
          zeigt das % was bei diesem NoName-Kauf vs. dem
          Brand-Original gespart wird. */}
      <View style={{ position: 'relative' }}>
        <ImageWithShimmer
          source={{ uri: getProductImage(p) ?? undefined }}
          style={{ width: 62, height: 62, borderRadius: 10, backgroundColor: '#ffffff' }}
          resizeMode="contain"
          thumb={(p as any)?.bildThumb}
        />
        {savingsPercent > 0 ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -4,
              left: -8,
              backgroundColor: brand.primary,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 4,
              transform: [{ rotate: '-14deg' }],
              shadowColor: '#000',
              shadowOpacity: 0.18,
              shadowOffset: { width: 0, height: 1 },
              shadowRadius: 2,
              elevation: 3,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 10,
                color: '#fff',
                letterSpacing: 0.2,
              }}
            >
              −{savingsPercent}%
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* Eyebrow-Row: Discounter (Markt) zuerst, dann Handelsmarke
            in EINER Zeile. Spart eine Row → Card kompakter. */}
        {p?.handelsmarke?.bezeichnung || p?.discounter?.name ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 2, flexWrap: 'wrap' }}>
            {p?.discounter?.bild ? (
              <ImageWithShimmer
                source={{ uri: p.discounter.bild }}
                style={{ width: 14, height: 14, borderRadius: 3 }}
              />
            ) : null}
            {p?.discounter?.name ? (
              <Text
                numberOfLines={1}
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 11,
                  color: theme.textMuted,
                  flexShrink: 1,
                }}
              >
                {p.discounter.name}
                {p?.discounter?.land ? ` (${p.discounter.land})` : ''}
              </Text>
            ) : null}
            {p?.handelsmarke?.bezeichnung ? (
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
            ) : null}
            {isFav ? (
              <MaterialCommunityIcons name="heart" size={11} color={brand.error} />
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
            // 2 Zeilen ZWINGEND damit Cards alle gleich hoch sind.
            minHeight: 36,
          }}
        >
          {p?.name || p?.produktName || 'Unbekanntes Produkt'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
          {(() => {
            const pack = formatPack(
              (p as any)?.packSize,
              (p as any)?.packTypInfo?.typKurz ?? (p as any)?.packTypInfo?.typ,
              p?.preis,
            );
            return pack ? (
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 11,
                  color: theme.textMuted,
                }}
                numberOfLines={1}
              >
                {pack}
              </Text>
            ) : null;
          })()}
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 13,
              color: theme.text,
            }}
          >
            {formatEur((p?.preis || 0) * (item.anzahl ?? 1))}
          </Text>
        </View>
        {/* Gespart-% liegt jetzt als Banner auf dem Image-Sticker. */}
      </View>
      {/* Pill absolut positioniert in leftCol → exakt vertikal mittig
          zur Card-Höhe (= Höhe des EdgeCheckButton-Strips). */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 8,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CompactQuantityPill
          anzahl={item.anzahl ?? 1}
          onIncrement={onIncrement}
          onDecrement={onDecrement}
        />
      </View>
      </View>
      <EdgeCheckButton onPress={onCheck} loading={loadingCheck} />
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
  onIncrement?: () => void;
  onDecrement?: () => void;
};

function CustomCard({
  item,
  onCheck,
  onDelete,
  loadingCheck,
  loadingDelete,
  onIncrement,
  onDecrement,
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
        flexDirection: 'row',
        alignItems: 'stretch',
        overflow: 'hidden',
      }}
    >
      <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 }}>
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
            // 2 Zeilen ZWINGEND damit alle Cards gleich hoch sind.
            minHeight: 36,
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
        {/* T17.40: CompactQuantityPill INNERHALB der content-body
            (flex:1 wrapper), nicht als Sibling vom EdgeCheckButton —
            sonst überlappt right:8 die Check-Edge-Spalte. Gleiches
            Pattern wie BrandCard/NoNameCard. */}
        {onIncrement && onDecrement ? (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              right: 8,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CompactQuantityPill
              anzahl={item.anzahl ?? 1}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
            />
          </View>
        ) : null}
      </View>
      <EdgeCheckButton onPress={onCheck} loading={loadingCheck} />
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
  const { user, userProfile, isAnonymous } = useAuth();
  const { isPremium } = useRevenueCat();
  const analytics = useAnalytics();

  const favoriteMarketId: string | undefined = (userProfile as any)?.favoriteMarket;

  // #1: Konsum — Preis-Dominanz aus dem Präferenz-Profil. Wenn ja, werden die
  // NoName-Alternativen je Marken-Artikel preislich vorsortiert (Lieblingsmarkt
  // bleibt vorn). Order-only, nur ein Tiebreak — versteckt nichts.
  const prefProfile = usePreferenceProfile();
  const priceDominant = useMemo(() => {
    const d = dominantDimension(prefProfile);
    return !!(d && d.dim === 'price' && d.value >= 0.3 && d.confidence >= 0.3);
  }, [prefProfile]);

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
  // Offline-Fallback (86ca7uhg7): letzter AsyncStorage-Snapshot der
  // Liste, wenn der Firestore-Load ohne Netz scheitert (Android hat
  // bewusst keine Disk-Persistenz). Read-only-Ansicht.
  const [offlineSnapshot, setOfflineSnapshot] = useState<CartSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [brandProducts, setBrandProducts] = useState<EnrichedItem[]>([]);
  const [noNameProducts, setNoNameProducts] = useState<EnrichedItem[]>([]);
  // Anzahl-aware abgeleitete Totals (vorher useState mit manuellen
  // Setter-Calls in jedem Handler). Erspart sync-Bugs wie "Pill +1
  // ändert anzahl, aber Total bleibt gleich".
  const totalPotentialSavings = useMemo(
    () =>
      brandProducts.reduce(
        (sum, it) => sum + (it.potentialSavings ?? 0) * (it.anzahl ?? 1),
        0,
      ),
    [brandProducts],
  );
  const totalActualSavings = useMemo(
    () =>
      noNameProducts.reduce(
        (sum, it) => sum + (it.savings ?? 0) * (it.anzahl ?? 1),
        0,
      ),
    [noNameProducts],
  );
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  // Marken-Info-Sheet — getriggered vom (i)-Icon im Hersteller-Chip
  // einer BrandCard. null = zu, Object = sichtbar.
  const [infoSheet, setInfoSheet] = useState<{ title: string; body: string } | null>(null);
  const [selectedConversions, setSelectedConversions] = useState<ProductToConvert[]>([]);
  // Totals werden aus brandProducts/noNameProducts ABGELEITET (per
  // useMemo) — anzahl-aware Multiplikation. Damit bleiben sie
  // automatisch synchron bei +/− Quantity-Changes ohne separate
  // Setter-Calls in den Handlern.

  // ─── Filter ────────────────────────────────────────────────────
  const [showFilter, setShowFilter] = useState(false);
  const [showCustomItemModal, setShowCustomItemModal] = useState(false);

  // ─── Teilen: Chooser (verschicken ODER gemeinsame Liste erstellen) ───
  // Additive Brücke in das isolierte Shared-Lists-Feature (Stufe 5). Der
  // persönliche Zettel bleibt unangetastet — wir LESEN nur die bereits
  // geladenen Items und befüllen daraus einmalig eine neue shared_lists-Liste.
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [creatingShared, setCreatingShared] = useState(false);

  // Meine geteilten Listen (Live) — für die Leiste ganz oben im Zettel, damit man
  // direkt sieht, welche Listen geteilt sind. Bis die Rules deployt sind, feuert der
  // Listener permission-denied → Service liefert [] → Leiste bleibt leer (graceful).
  const [mySharedLists, setMySharedLists] = useState<SharedListDoc[]>([]);
  useEffect(() => {
    if (!user?.uid) {
      setMySharedLists([]);
      return;
    }
    return SharedListService.subscribeMySharedLists(user.uid, setMySharedLists);
  }, [user?.uid]);

  const myDisplayName =
    (userProfile as any)?.display_name ||
    (user as any)?.displayName ||
    'Ich';

  /** Aktuelle Zettel-Items → self-contained SharedListItems (Read-Side-Map,
   *  kein Datenmodell-Touch am persönlichen Zettel). */
  const buildSharedItems = useCallback((): Omit<SharedListItem, 'id'>[] => {
    const map = (arr: EnrichedItem[], kind: 'brand' | 'noname') =>
      arr.map((it) => ({
        name: it.name || it.product?.name || it.product?.produktName || 'Produkt',
        kind,
        anzahl: it.anzahl ?? 1,
        marketName: it.product?.discounter?.name || it.markt?.name || null,
        savings: kind === 'noname' ? (it.savings ?? null) : null,
        productId: it.productId || it.product?.id || null,
        bild: it.product?.bild || it.markt?.bild || null,
        addedByName: myDisplayName,
      }));
    return [...map(brandProducts, 'brand'), ...map(noNameProducts, 'noname')];
  }, [brandProducts, noNameProducts, myDisplayName]);

  /** Option A — Liste als schöner Text ins native Share-Sheet. Erst das
   *  FilterSheet schließen, DANN präsentieren: iOS darf kein
   *  UIActivityViewController über einem noch präsentierten RN-Modal öffnen
   *  (sonst "already presenting"). */
  const handleShareAsText = useCallback(() => {
    setShowShareSheet(false);
    setTimeout(() => {
      Share.share({
        message: buildShoppingListShareText(brandProducts, noNameProducts),
      }).catch(() => {});
    }, 350);
  }, [brandProducts, noNameProducts]);

  /** Option B — aus dem aktuellen Zettel eine gemeinsame Liste erstellen und
   *  hinein navigieren (dort: Einladen + Umbenennen). Konto-Pflicht wie in der
   *  Übersicht (anonyme Owner verlieren die Liste beim Reinstall). */
  const handleCreateSharedList = useCallback(async () => {
    if (creatingShared) return;
    if (isAnonymous || !user) {
      setShowShareSheet(false);
      showInfoToast('Für eine gemeinsame Liste brauchst du ein kostenloses Konto.', 'info');
      router.push('/auth/welcome' as any);
      return;
    }
    setCreatingShared(true);
    try {
      const items = buildSharedItems();
      const id = await SharedListService.createSharedList(
        'Gemeinsamer Einkauf',
        items,
        myDisplayName,
      );
      setShowShareSheet(false);
      showInfoToast('Gemeinsame Liste erstellt — jetzt Freunde einladen! 🎉', 'info');
      // ?share=1 → im Ziel-Screen öffnet sich das Teilen-Sheet (QR + Link) sofort.
      router.push(`/shared-list/${id}?share=1` as any);
    } catch {
      showInfoToast('Die gemeinsame Liste konnte gerade nicht erstellt werden.', 'error');
    } finally {
      setCreatingShared(false);
    }
  }, [creatingShared, isAnonymous, user, buildSharedItems, myDisplayName, router]);
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

  // Level-Up wird zentral via GamificationProvider durchs Banner
  // angezeigt — kein lokaler State mehr (war eh nie wirklich befeuert,
  // setShowLevelUpOverlay wurde nirgends aufgerufen).

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
            anzahl: ((item as any).anzahl ?? 1) as number,
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
              // Markenprodukt-Hersteller-Auflösung mit Marke-vs-
              // -Hersteller-Split (analog firestore.ts Z.1755):
              //   • productData.hersteller-Ref → erstmal lookuppen
              //   • Hat `herstellerref` → Marke-Doc (in DB
              //     `hersteller`-Coll, "MARKEN" in User-Lingo, mit
              //     `infos`-Feld). Resolve real hersteller daraus.
              //   • Sonst: direkt Hersteller-Doc.
              // Hersteller (Marke ↔ Manufacturer-Chain) und packTypInfo
              // PARALLEL holen statt seriell — beide hängen nur vom
              // productData ab und sind unabhängig voneinander.
              const resolveHersteller = async (): Promise<{
                markeData: any;
                herstellerData: any;
              }> => {
                if (!(productData as any).hersteller) {
                  return { markeData: null, herstellerData: null };
                }
                try {
                  const herstellerOrMarke = await FirestoreService.getDocumentByReference<any>(
                    (productData as any).hersteller,
                  );
                  if (herstellerOrMarke?.herstellerref) {
                    const real = await FirestoreService.getDocumentByReference<any>(
                      herstellerOrMarke.herstellerref,
                    ).catch(() => null);
                    return { markeData: herstellerOrMarke, herstellerData: real };
                  }
                  return { markeData: null, herstellerData: herstellerOrMarke };
                } catch {
                  return { markeData: null, herstellerData: null };
                }
              };
              const resolvePackTypInfo = async (): Promise<any> => {
                if (!(productData as any).packTypInfo) return null;
                try {
                  return await FirestoreService.getDocumentByReference<any>(
                    (productData as any).packTypInfo,
                  );
                } catch {
                  return null;
                }
              };
              const [{ markeData, herstellerData }, packTypInfo] = await Promise.all([
                resolveHersteller(),
                resolvePackTypInfo(),
              ]);

              let bestAlternative: any = null;
              let maxSavings = 0;
              let maxSavingsPercent = 0;
              for (const alt of alternatives) {
                const sd = getSavingsData(productData, alt);
                if (sd.savingsEur > maxSavings) {
                  maxSavings = sd.savingsEur;
                  maxSavingsPercent = sd.savingsPercent;
                  bestAlternative = alt;
                }
              }

              return {
                kind: 'brand' as const,
                enriched: {
                  id: item.id,
                  kind: 'brand' as const,
                  markenProduktRef: ref.id,
                  productId: ref.id, // explizit für Quantity-Ops
                  product: {
                    ...productData,
                    id: ref.id, // FIX: getDocumentByReference returnt nur data()
                    hersteller: herstellerData,
                    marke: markeData, // Für info-icon → mp.marke.infos
                    packTypInfo, // resolved für Pack-Details-Anzeige
                  },
                  alternatives,
                  bestAlternative,
                  potentialSavings: maxSavings,
                  potentialSavingsPercent: maxSavingsPercent,
                  anzahl: ((item as any).anzahl ?? 1) as number,
                  // Journey-Tracking-Daten aus dem cart-doc übernehmen,
                  // damit der Remove-Fast-Path keinen zusätzlichen
                  // getDoc braucht.
                  journeyId: (item as any).journeyId,
                  viewedProductIndex: (item as any).viewedProductIndex,
                  // Legacy-Dupe-IDs aus dem read-side merge — beim
                  // Mark/Remove müssen alle mit weggeräumt werden.
                  legacyIds: (item as any).legacyIds ?? [],
                  name: productData?.name,
                } satisfies EnrichedItem,
                potentialSavings: maxSavings,
                bestAlternative,
              };
            } else if ((item as any).handelsmarkenProdukt) {
              const ref = (item as any).handelsmarkenProdukt;
              const productData = await FirestoreService.getDocumentByReference<Produkte>(ref);
              if (!productData) return null;
              const [handelsmarkeData, discounterData, markenProdukt, herstellerData, packTypInfoData] = await Promise.all([
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
                // packTypInfo für Pack-Details (XYg · X€/kg)
                (productData as any).packTypInfo
                  ? FirestoreService.getDocumentByReference(
                      (productData as any).packTypInfo,
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
                  productId: ref.id, // explizit für Quantity-Ops
                  product: {
                    ...productData,
                    id: ref.id, // FIX: getDocumentByReference returnt nur data()
                    handelsmarke: handelsmarkeData,
                    discounter: finalDiscounter,
                    hersteller: herstellerData,
                    packTypInfo: packTypInfoData,
                  },
                  savings,
                  // preserve journey info for bulk purchase
                  ...(item as any),
                  anzahl: ((item as any).anzahl ?? 1) as number,
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
      const newSelected: ProductToConvert[] = [];

      for (const result of processedItems) {
        if (!result) continue;
        if (result.kind === 'brand') {
          brandItems.push(result.enriched);
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
        }
      }

      setSelectedConversions(newSelected);
      setBrandProducts(brandItems);
      setNoNameProducts(noNameItems);
      setOfflineSnapshot(null);
      // Kompakten Snapshot fuer den Offline-Fallback spiegeln
      // (86ca7uhg7) — fire-and-forget.
      const toSnap = (it: EnrichedItem): CartSnapshotItem => ({
        id: it.id,
        name: it.isCustom
          ? (it.name ?? 'Eigenes Produkt')
          : ((it.product as any)?.name ?? it.name ?? 'Produkt'),
        anzahl: ((it as any).anzahl ?? 1) as number,
        kind: it.kind,
        marketName: (it as any)?.markt?.name ?? null,
      });
      CartSnapshotService.save(user.uid, {
        brand: brandItems.map(toSnap),
        noname: noNameItems.map(toSnap),
      });
      // Totals werden via useMemo derived → keine Setter nötig.
    } catch (error: any) {
      console.error('Error loading shopping cart:', error);
      // Offline-Fallback (86ca7uhg7): ohne Netz den letzten Stand aus
      // AsyncStorage zeigen statt Fehler-Toast + leerer Liste.
      if (!isOnline()) {
        const snap = await CartSnapshotService.load(user.uid);
        if (snap && (snap.brand.length > 0 || snap.noname.length > 0)) {
          setOfflineSnapshot(snap);
          return;
        }
      }
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

  // 3.2 (Stufe 3): Outbox-Replay. subscribeNetwork feuert einmal sofort (Mount)
  // und danach bei jeder Netz-Änderung — so werden offline (auch vor einem
  // App-Kill) gemerkte Abhak-Aktionen nachgespielt, sobald wieder Netz da ist.
  // Idempotent + fail-open im Service; nur bei online. Ein Refetch danach zieht
  // die Liste sauber nach.
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    const unsub = subscribeNetwork((s) => {
      if (!s.online) return;
      void CartOutboxService.flush(uid, async (op) => {
        if (op.kind === 'markPurchased') {
          await FirestoreService.markAsPurchased(uid, op.itemId);
        } else {
          await FirestoreService.removeFromShoppingCart(uid, op.itemId, {
            productId: op.itemId,
            productName: op.productName,
            productType: op.productType,
            isCustomItem: true,
          });
        }
      })
        .then((n) => {
          if (n > 0) void loadShoppingCart();
        })
        .catch(() => {});
    });
    return unsub;
    // loadShoppingCart bewusst nicht in den Deps — ein evtl. leicht veralteter
    // Refetch ist harmlos, und wir wollen den Listener nur bei uid-Wechsel neu
    // aufsetzen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

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
    // 3.5 (Stufe 3): offline würde der convert-Write ewig hängen (Android
    // persistence:false → keine lokale Write-Queue). Sauber abfangen statt
    // einfrieren.
    if (!isOnline()) {
      showInfoToast('Gerade kein Empfang — das Umwandeln klappt, sobald du wieder online bist.', 'info');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const conversions = [{ einkaufswagenRef, markenProduktRef, produktRef }];
    const brandItem = brandProducts.find((i) => i.id === einkaufswagenRef);
    const savingsAmount = brandItem?.potentialSavings || 0;

    // Optimistisch: Marken-Item sofort aus der Liste nehmen (wird zu NoName).
    setBrandProducts((prev) => prev.filter((i) => i.id !== einkaufswagenRef));

    try {
      // Den Convert-WRITE awaiten (Batch, schnell) — Erfolg NICHT vortäuschen
      // (Bug 86ca5fjhn: „meldet umgewandelt, dann schlägt fehl"). NUR der
      // schwere loadShoppingCart-Refetch bleibt fire-and-forget → kein Freeze.
      await FirestoreService.convertToNoName(user.uid, conversions);
      void loadShoppingCart();
      setTimeout(() => onTabChange('noname'), 100);
      showConvertSuccessToast(savingsAmount);
      achievementService.trackAction(user.uid, 'convert_product').catch((e) => {
        console.error('Achievement convert_product error', e);
      });
    } catch (error) {
      console.error('Error converting single product:', error);
      showInfoToast(TOAST_MESSAGES.SHOPPING.convertError, 'error');
      void loadShoppingCart(); // Liste zurücksetzen (Item wieder rein)
    }
  };

  const handleConvertSelected = async () => {
    if (!user?.uid) return;
    if (selectedConversions.length === 0) {
      showInfoToast(TOAST_MESSAGES.SHOPPING.selectFirstPrompt, 'info');
      return;
    }
    // 3.5 (Stufe 3): offline nicht in den hängenden convert-Write laufen.
    if (!isOnline()) {
      showInfoToast('Gerade kein Empfang — das Umwandeln klappt, sobald du wieder online bist.', 'info');
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
              // Side-effects (Analytics/Achievement) vorbereiten.
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

              // Optimistisch: konvertierte Marken-Items sofort raus + Auswahl leeren.
              const convIds = new Set(selectedConversions.map((c) => c.einkaufswagenRef));
              setBrandProducts((prev) => prev.filter((i) => !convIds.has(i.id)));
              setSelectedConversions([]);

              // FIRE-AND-FORGET (Task 86ca5fjhn): Convert-Write +
              // updateUserTotalSavings + der schwere loadShoppingCart-Refetch
              // NICHT im UI-Pfad awaiten — sonst hängt der Loader bis zum
              // Server-Ack (Freeze). Loader schließt + Toast/Tab-Switch sofort;
              // Reload (zeigt die neuen NoNames) im Hintergrund nach dem Write.
              FirestoreService.convertToNoName(user.uid, selectedConversions)
                .then(() => FirestoreService.updateUserTotalSavings(user.uid, totalPotentialSavings))
                .then(() => {
                  Promise.allSettled(sideEffects);
                  return loadShoppingCart();
                })
                .catch((error) => {
                  console.error('[convert] bulk write failed (bg):', error);
                  showInfoToast(TOAST_MESSAGES.SHOPPING.bulkConvertError, 'error');
                  loadShoppingCart();
                });

              setConvertLoaderState({ visible: false, processedItems: 0, totalItems: 0, currentItem: '' });
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

  const handleMarkAsPurchased = async (itemId: string, unitSavings?: number) => {
    if (!user?.uid) return;

    // ─── Pre-Capture für Optimistic-Removal + Revert ───────────────
    // Item-Daten + Index in seiner Liste merken BEVOR wir den State
    // ändern. Damit können wir bei Firestore-Fehler exakt an die
    // alte Position revertieren statt nur ans Ende anzuhängen.
    const inBrand = brandProducts.findIndex((i) => i.id === itemId);
    const inNoName = noNameProducts.findIndex((i) => i.id === itemId);
    const matched =
      inBrand >= 0
        ? brandProducts[inBrand]
        : inNoName >= 0
          ? noNameProducts[inNoName]
          : null;
    if (!matched) {
      // Item ist nicht (mehr) in der Liste — z.B. weil schon entfernt.
      // Defensiver Early-Exit, kein Crash.
      return;
    }

    // Welche Liste ist betroffen — basierend auf item.kind (sauber)
    // statt unitSavings-Heuristik (bug bei savings=0):
    //   - 'brand' / 'custom-brand'  → brandProducts
    //   - 'noname' / 'custom-noname' → noNameProducts
    const targetIsNoName =
      matched.kind === 'noname' || matched.kind === 'custom-noname';
    const isCustomItem = !!matched.isCustom;
    const anz = matched.anzahl ?? 1;
    const totalSavings = (unitSavings || 0) * anz;

    // ─── OPTIMISTIC LOCAL REMOVAL (vor Firestore-Write!) ───────────
    // Bug-Fix für ClickUp 86c9qkn1w: vorher wurde erst NACH dem
    // await markAsPurchased(...) entfernt. Bei langsamem Firestore-
    // Write (>1480 ms) fired die SwipeRow-Safety-Net (2500 ms
    // timeout) und reset'tete die Animation → Row poppte wieder auf
    // bevor die finale Local-Removal griff. User musste refreshen.
    //
    // Jetzt: Local-Removal SOFORT → Row unmount'et sofort nach der
    // Animation → kein Safety-Net-Trigger. Firestore-Write läuft
    // im Hintergrund; bei Fehler revertieren wir.
    if (targetIsNoName) {
      setNoNameProducts((prev) => prev.filter((i) => i.id !== itemId));
    } else {
      setBrandProducts((prev) => prev.filter((i) => i.id !== itemId));
    }

    // Haptics fire-and-forget (kein await — blockt sonst den UI-Pfad).
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    // Revert: Item zurück an die alte Position, falls der Write failed.
    const revert = () => {
      if (targetIsNoName) {
        setNoNameProducts((prev) => {
          if (prev.some((i) => i.id === matched.id)) return prev;
          const next = [...prev];
          next.splice(Math.min(inNoName, next.length), 0, matched);
          return next;
        });
      } else {
        setBrandProducts((prev) => {
          if (prev.some((i) => i.id === matched.id)) return prev;
          const next = [...prev];
          next.splice(Math.min(inBrand, next.length), 0, matched);
          return next;
        });
      }
    };

    // ─── FIRE-AND-FORGET Firestore-Write (Task 86ca5fjhn / Forbidden
    // Pattern): NIEMALS den Write im UI-Pfad awaiten — die Promise löst erst
    // bei Server-Ack auf (auf langsamem Android = Sekunden), während Toast,
    // Stats und Folge-UI warten und die App „einfriert"/nichts nachlädt. Der
    // lokale State (optimistische Removal oben) treibt die UI; bei Fehler
    // revertieren wir. Genau diese Regression war Ursache des Reports.
    const writeP = isCustomItem
      ? FirestoreService.removeFromShoppingCart(user.uid, itemId, {
          productId: itemId,
          productName: matched.name ?? 'Custom item',
          productType: matched.customType === 'brand' ? 'brand' : 'noname',
          isCustomItem: true,
        })
      : FirestoreService.markAsPurchased(user.uid, itemId);
    writeP.catch((error: unknown) => {
      console.error('Error marking as purchased:', error);
      // 3.2 (Stufe 3): offline (Android hat keine native Write-Queue) → NICHT
      // revertieren, sondern in die Outbox legen und die optimistische Entfernung
      // behalten. Wird beim Reconnect (auch nach App-Kill) nachgespielt. Punkte/
      // Ersparnis sind oben bereits einmal optimistisch vergeben — der Replay
      // macht nur den DB-Write nach.
      if (!isOnline()) {
        void CartOutboxService.enqueue(
          user.uid,
          isCustomItem
            ? {
                kind: 'removeCustom',
                itemId,
                productName: matched.name ?? 'Custom item',
                productType: matched.customType === 'brand' ? 'brand' : 'noname',
                ts: Date.now(),
              }
            : { kind: 'markPurchased', itemId, ts: Date.now() },
        );
        showInfoToast('Als gekauft gemerkt — wird gespeichert, sobald du wieder online bist.', 'info');
        return;
      }
      revert();
      showRetryableErrorToast(TOAST_MESSAGES.SHOPPING.purchaseError, () => {
        void handleMarkAsPurchased(itemId, unitSavings);
      });
    });

    // 86ca2rt88: Freitext-Eintrag als GEKAUFT in der Journey festhalten
    // (fire-and-forget — der gemeinsame removeFromShoppingCart kann
    // gekauft/gelöscht nicht unterscheiden, daher hier wo die Absicht klar ist).
    if (isCustomItem) {
      try {
        journeyTrackingService.trackCustomItem(
          'purchased',
          { name: matched.name ?? 'Custom item', type: matched.customType, marketName: (matched as any).market?.name },
          user.uid,
        );
      } catch {
        /* fire-and-forget */
      }
    }

    // Legacy-Dupes (cart-schema v1 auto-IDs für dasselbe Produkt) ebenfalls
    // markieren — fire-and-forget.
    const legacyIds = matched.legacyIds ?? [];
    for (const legacyId of legacyIds) {
      FirestoreService.markAsPurchasedWithoutTracking(user.uid, legacyId).catch((e) => {
        console.warn('[mark-purchased] legacy dupe fail:', legacyId, (e as Error)?.message);
      });
    }

    // ─── Optimistischer Erfolg SOFORT (nicht auf den Server-Ack warten) ──
    if (!isCustomItem) {
      updateUserStats(user.uid, {
        savingsToAdd: totalSavings,
        productsToAdd: anz,
      }).catch((e) => console.warn('[mark-purchased] updateUserStats bg-fail:', e));
      achievementService
        .trackAction(user.uid, 'complete_shopping', { productCount: anz, totalSavings })
        .catch((error) => console.error('Achievement complete_shopping error:', error));
      if (totalSavings > 0) {
        showPurchasedToast(`Gekauft! Du hast ${formatEur(totalSavings)} gespart - super gemacht!`);
      } else {
        showPurchasedToast(TOAST_MESSAGES.SHOPPING.purchasedSimple);
      }
    } else {
      showInfoToast(TOAST_MESSAGES.SHOPPING.customItemPurchased, 'success');
    }
  };

  const handleRemoveFromCart = async (itemId: string) => {
    if (!user?.uid) return;
    // 3.2 (Stufe 3): offline würde der awaited deleteDoc ewig hängen (Android
    // persistence:false). Sauber abfangen statt Endlos-Spinner.
    if (!isOnline()) {
      showInfoToast('Gerade kein Empfang — die Änderung klappt, sobald du wieder online bist.', 'info');
      return;
    }
    setDeletingItems((prev) => new Set(prev).add(itemId));
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      // Tracking-Payload aus dem UI-State bauen (KEIN getDoc nötig).
      // Macht den Critical-Path identisch zu Favoriten-Remove: 1 awaited
      // deleteDoc auf det-ID, fertig.
      const matched = [...brandProducts, ...noNameProducts].find((it) => it.id === itemId);
      const payload = matched
        ? {
            productId: matched.productId ?? matched.id,
            productName:
              matched.product?.name ?? matched.name ?? (matched.kind === 'brand' ? 'Markenprodukt' : 'NoName-Produkt'),
            productType:
              matched.kind === 'brand' || matched.customType === 'brand'
                ? ('brand' as const)
                : ('noname' as const),
            journeyId: matched.journeyId,
            viewedProductIndex: matched.viewedProductIndex,
            isCustomItem: !!matched.isCustom,
          }
        : undefined;
      await FirestoreService.removeFromShoppingCart(user.uid, itemId, payload);
      // 86ca2rt88: Freitext-Eintrag als GELÖSCHT in der Journey festhalten.
      if (matched?.isCustom) {
        try {
          journeyTrackingService.trackCustomItem(
            'deleted',
            { name: matched.name ?? 'Custom item', type: matched.customType, marketName: (matched as any).market?.name },
            user.uid,
          );
        } catch {
          /* fire-and-forget */
        }
      }
      // Legacy-Dupes (cart-schema v1) auch löschen, sonst tauchen sie
      // beim nächsten Refresh wieder auf. Fire-and-forget, ohne
      // Tracking-Payload (kein zweites Tracking-Event).
      const legacyIds = matched?.legacyIds ?? [];
      for (const legacyId of legacyIds) {
        FirestoreService.removeFromShoppingCart(user.uid, legacyId).catch((e) => {
          console.warn('[remove] legacy dupe fail:', legacyId, (e as Error)?.message);
        });
      }
      showInfoToast(TOAST_MESSAGES.SHOPPING.removedFromCart, 'ERROR');
      // Optimistic update — Totals werden automatisch via useMemo
      // aus brandProducts/noNameProducts neu derived.
      setBrandProducts((prev) => prev.filter((i) => i.id !== itemId));
      setNoNameProducts((prev) => prev.filter((i) => i.id !== itemId));
      setSelectedConversions((prev) => prev.filter((c) => c.einkaufswagenRef !== itemId));
    } catch (error) {
      console.error('Error removing from cart:', error);
      showRetryableErrorToast(
        TOAST_MESSAGES.SHOPPING.removeError,
        () => {
          void handleRemoveFromCart(itemId);
        },
      );
    } finally {
      setDeletingItems((prev) => {
        const n = new Set(prev);
        n.delete(itemId);
        return n;
      });
    }
  };

  // ─── NEU (2026-05-07): Quantity-Steuerung ───
  // Optimistisches +1 / -1 auf den im State gehaltenen anzahl-Wert,
  // dahinter der Firestore-Sync via addToShoppingCart bzw. decrementCartQuantity.
  const handleIncrementCart = async (item: EnrichedItem) => {
    if (!user?.uid) return;
    // 3.2 (Stufe 3): offline hängt der awaited Mengen-Write ewig (Android
    // persistence:false) → sauber abfangen.
    if (!isOnline()) {
      showInfoToast('Gerade kein Empfang — die Änderung klappt, sobald du wieder online bist.', 'info');
      return;
    }
    if (item.isCustom) {
      // T17.39: Custom-Items haben kein productId — wir adressieren
      // direkt über die cart-doc-id (item.id) via updateCustomItemQuantity.
      const prevAnzahl = item.anzahl ?? 1;
      const newAnzahl = Math.min(99, prevAnzahl + 1);
      const isBrand = item.customType === 'brand';
      // Optimistic
      if (isBrand) {
        setBrandProducts((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, anzahl: newAnzahl } : it)),
        );
      } else {
        setNoNameProducts((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, anzahl: newAnzahl } : it)),
        );
      }
      try {
        await FirestoreService.updateCustomItemQuantity(user.uid, item.id, newAnzahl);
      } catch (e) {
        // Revert
        if (isBrand) {
          setBrandProducts((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, anzahl: prevAnzahl } : it)),
          );
        } else {
          setNoNameProducts((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, anzahl: prevAnzahl } : it)),
          );
        }
        showInfoToast('Fehler — bitte erneut versuchen');
      }
      return;
    }
    const productData = item.product;
    // Fix (2026-05-07): explicit productId Feld nutzen, NICHT product.id
    // (getDocumentByReference returnt nur doc.data() ohne id-Feld).
    const productId = item.productId ?? productData?.id;
    const isMarke = item.kind === 'brand';
    if (!productId) {
      console.warn('[cart] handleIncrementCart: kein productId gefunden', { item });
      return;
    }
    const prevAnzahl = item.anzahl ?? 1;
    // Optimistisch
    if (isMarke) {
      setBrandProducts((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, anzahl: prevAnzahl + 1 } : it)),
      );
    } else {
      setNoNameProducts((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, anzahl: prevAnzahl + 1 } : it)),
      );
    }
    try {
      await FirestoreService.addToShoppingCart(
        user.uid,
        productId,
        productData?.name ?? item.name ?? 'Produkt',
        isMarke,
        'shopping_list_increment' as any,
        { screenName: 'shopping-list' },
        { price: productData?.preis ?? 0, savings: 0 },
      );
    } catch (e) {
      // Revert
      if (isMarke) {
        setBrandProducts((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, anzahl: prevAnzahl } : it)),
        );
      } else {
        setNoNameProducts((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, anzahl: prevAnzahl } : it)),
        );
      }
      showInfoToast('Fehler — bitte erneut versuchen');
    }
  };

  const handleDecrementCart = async (item: EnrichedItem) => {
    if (!user?.uid) return;
    // 3.2 (Stufe 3): offline hängt der awaited Mengen-Write ewig → abfangen.
    if (!isOnline()) {
      showInfoToast('Gerade kein Empfang — die Änderung klappt, sobald du wieder online bist.', 'info');
      return;
    }
    if (item.isCustom) {
      // T17.39: Custom-Items haben jetzt anzahl-Konzept. Bei anzahl > 1
      // dekrementieren, bei anzahl == 1 ganz entfernen (wie bei DB-Items
      // wo die Pill dann den Trash-Icon zeigt).
      const prevAnzahl = item.anzahl ?? 1;
      if (prevAnzahl <= 1) {
        handleRemoveFromCart(item.id);
        return;
      }
      const newAnzahl = prevAnzahl - 1;
      const isBrand = item.customType === 'brand';
      // Optimistic
      if (isBrand) {
        setBrandProducts((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, anzahl: newAnzahl } : it)),
        );
      } else {
        setNoNameProducts((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, anzahl: newAnzahl } : it)),
        );
      }
      try {
        await FirestoreService.updateCustomItemQuantity(user.uid, item.id, newAnzahl);
      } catch (e) {
        // Revert
        if (isBrand) {
          setBrandProducts((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, anzahl: prevAnzahl } : it)),
          );
        } else {
          setNoNameProducts((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, anzahl: prevAnzahl } : it)),
          );
        }
        showInfoToast('Fehler — bitte erneut versuchen');
      }
      return;
    }
    const productData = item.product;
    const productId = item.productId ?? productData?.id;
    const isMarke = item.kind === 'brand';
    if (!productId) {
      console.warn('[cart] handleDecrementCart: kein productId gefunden', { item });
      return;
    }
    const prevAnzahl = item.anzahl ?? 1;
    const newAnzahl = prevAnzahl - 1;
    // Optimistisch
    if (newAnzahl <= 0) {
      // Aus Liste entfernen — die echte Logik macht decrementCartQuantity → removeFromShoppingCart
      if (isMarke) {
        setBrandProducts((prev) => prev.filter((it) => it.id !== item.id));
      } else {
        setNoNameProducts((prev) => prev.filter((it) => it.id !== item.id));
      }
    } else {
      if (isMarke) {
        setBrandProducts((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, anzahl: newAnzahl } : it)),
        );
      } else {
        setNoNameProducts((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, anzahl: newAnzahl } : it)),
        );
      }
    }
    try {
      // Fast-Path: anzahl + Tracking-Payload aus dem UI-State.
      // → kein getDoc, kein zusätzlicher Read. 1 awaited Op auf 1 Doc.
      const trackingPayload = newAnzahl <= 0
        ? {
            productId,
            productName: productData?.name ?? item.name ?? 'Produkt',
            productType: isMarke ? ('brand' as const) : ('noname' as const),
            journeyId: item.journeyId,
            viewedProductIndex: item.viewedProductIndex,
          }
        : undefined;
      await FirestoreService.decrementCartQuantity(
        user.uid,
        productId,
        isMarke,
        prevAnzahl,
        trackingPayload,
      );
      // Wenn voll-entfernt: gleichen Toast wie Swipe-to-delete zeigen
      if (newAnzahl <= 0) {
        showInfoToast(TOAST_MESSAGES.SHOPPING.removedFromCart, 'ERROR');
      }
    } catch (e) {
      // Revert
      if (newAnzahl <= 0) {
        // Re-add (best effort — full reload würde besser passen)
        loadShoppingCart();
      } else {
        if (isMarke) {
          setBrandProducts((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, anzahl: prevAnzahl } : it)),
          );
        } else {
          setNoNameProducts((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, anzahl: prevAnzahl } : it)),
          );
        }
      }
      showInfoToast('Fehler — bitte erneut versuchen');
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
    // 3.2 (Stufe 3): Bulk-Abhaken ist NICHT outbox-backed (nur der Einzel-Check-
    // off) → offline würde es die Items still verlieren. Sauber abfangen; einzeln
    // abhaken funktioniert offline weiterhin (Outbox).
    if (!isOnline()) {
      showInfoToast('Gerade kein Empfang — einzeln abhaken geht, „alle" klappt wieder online.', 'info');
      return;
    }

    const dbProducts = targets.filter(
      (item) => !item.isCustom && item.kind === 'noname',
    );
    const customItems = targets.filter((item) => item.isCustom);
    const dbBrandItems = targets.filter((item) => !item.isCustom && item.kind === 'brand');

    // Anzahl-aware: total savings = Σ (per-unit-savings × anzahl)
    // damit User-Stats / Achievements korrekt mit der gekauften Menge
    // skaliert. Vorher: nur Σ unit-savings (Bug bei anzahl > 1).
    const totalSavings = dbProducts.reduce(
      (s, item) => s + (item.savings || 0) * (item.anzahl ?? 1),
      0,
    );
    const totalProducts = dbProducts.reduce((s, item) => s + (item.anzahl ?? 1), 0);
    // totalCount für die Loader-Bar (Σ anzahl über alle Targets),
    // damit die "X von Y verarbeitet"-Anzeige im Loader korrekt
    // skaliert mit der gekauften Menge statt nur unique products.
    const totalCount =
      dbProducts.reduce((s, item) => s + (item.anzahl ?? 1), 0) +
      customItems.reduce((s, item) => s + (item.anzahl ?? 1), 0) +
      dbBrandItems.reduce((s, item) => s + (item.anzahl ?? 1), 0);

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
          productId: (item as any).productId || item.product?.id || '',
          productName:
            item.product?.name || item.product?.produktName || item.name || 'Unbekannt',
          productType: 'noname' as 'brand' | 'noname',
          finalPrice: item.product?.preis || 0,
          finalSavings: item.savings || 0,
          journeyId: (item as any).journeyId,
          viewedProductIndex: (item as any).viewedProductIndex,
          quantity: (item as any).anzahl ?? 1, // NEU: Bulk-Purchase weiß wieviele
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
      // Helper: zusätzlich zu item.id auch alle legacyIds (Cart-
      // Schema v1 Auto-ID-Dupes) mitmarken — sonst bleiben Geister-
      // Docs in Firestore die beim Refresh wieder auftauchen.
      const allIdsForItem = (item: EnrichedItem): string[] => [
        item.id,
        ...((item.legacyIds ?? []) as string[]),
      ];
      // DB noname: mark as purchased (without journey tracking — we batch it)
      if (dbProducts.length > 0) {
        for (const item of dbProducts) {
          for (const id of allIdsForItem(item)) {
            promises.push(FirestoreService.markAsPurchasedWithoutTracking(user.uid, id));
          }
        }
      }
      // DB brand on this list: mark as purchased too (kept for "Alle"-Tab semantics)
      if (dbBrandItems.length > 0) {
        for (const item of dbBrandItems) {
          // Primary mit Tracking, Legacy-Dupes ohne (sonst Doppel-Tracking).
          promises.push(FirestoreService.markAsPurchased(user.uid, item.id));
          for (const legacyId of (item.legacyIds ?? []) as string[]) {
            promises.push(FirestoreService.markAsPurchasedWithoutTracking(user.uid, legacyId));
          }
        }
      }
      // Custom items: simple removal — Fast-Path ohne getDoc.
      if (customItems.length > 0) {
        promises.push(
          ...customItems.map((item) =>
            FirestoreService.removeFromShoppingCart(user.uid, item.id, {
              productId: item.id,
              productName: item.name ?? 'Custom item',
              productType: item.customType === 'brand' ? 'brand' : 'noname',
              isCustomItem: true,
            }),
          ),
        );
        // 86ca2rt88: jeder Freitext-Eintrag im Bulk-Kauf wird als GEKAUFT in
        // der Journey festgehalten (fire-and-forget, je Eintrag ein Log).
        for (const item of customItems) {
          try {
            journeyTrackingService.trackCustomItem(
              'purchased',
              { name: item.name ?? 'Custom item', type: item.customType, marketName: (item as any).market?.name },
              user.uid,
            );
          } catch {
            /* fire-and-forget */
          }
        }
      }

      setPurchaseLoaderState((prev) => ({
        ...prev,
        currentItem: 'Alle Produkte werden verarbeitet...',
        processedItems: Math.floor(totalCount * 0.3),
      }));
      // FIRE-AND-FORGET (Task 86ca5fjhn): die Cart-Writes NICHT awaiten — sonst
      // hängt der BatchActionLoader bis zum Server-Ack aller N Writes (auf
      // langsamem Android Sekunden, App „friert ein"). Die optimistische
      // Local-Removal unten + die Toasts laufen sofort; bei Write-Fehler
      // reconcilet der nächste loadShoppingCart, plus Error-Toast.
      Promise.all(promises).catch((error) => {
        console.error('[bulk-purchase] writes failed (bg):', error);
        showInfoToast(TOAST_MESSAGES.SHOPPING.bulkPurchaseError, 'error');
      });

      setPurchaseLoaderState((prev) => ({
        ...prev,
        currentItem: 'Ersparnis wird gespeichert...',
        processedItems: Math.floor(totalCount * 0.7),
      }));

      const productsToAdd = totalProducts; // anzahl-aware Summe (vorher: dbProducts.length)
      if (totalSavings > 0 || productsToAdd > 0) {
        // Fire-and-forget: schreibt auf user-doc parallel zu den
        // gerade ausgeführten cart-Updates. Awaiten würde den
        // native-WriteStream zusätzlich blockieren ohne UI-Mehrwert
        // (die optimistische Local-State-Removal weiter unten ist
        // unabhängig vom Server-ACK).
        updateUserStats(user.uid, {
          savingsToAdd: totalSavings,
          productsToAdd,
        }).catch((e) => console.warn('[bulk-purchase] updateUserStats bg-fail:', e));
      }

      // Local state
      const removedIds = new Set(targets.map((t) => t.id));
      setNoNameProducts((prev) => prev.filter((i) => !removedIds.has(i.id)));
      setBrandProducts((prev) => prev.filter((i) => !removedIds.has(i.id)));
      // totalActualSavings wird via useMemo aus noNameProducts derived.

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
    // Anzahl-aware: jedes Produkt wird mit seiner anzahl multipliziert,
    // damit die Confirmation-Message dem User korrekt sagt wieviele
    // Items er tatsächlich als gekauft markiert (nicht wieviele
    // unique products).
    const sumAnzahl = (arr: EnrichedItem[]) =>
      arr.reduce((s, t) => s + (t.anzahl ?? 1), 0);
    const dbCount = sumAnzahl(targets.filter((t) => !t.isCustom && t.kind === 'noname'));
    const customCount = sumAnzahl(targets.filter((t) => t.isCustom));
    const brandCount = sumAnzahl(targets.filter((t) => !t.isCustom && t.kind === 'brand'));
    const targetsTotal = sumAnzahl(targets);
    const totalSavings = targets.reduce(
      (s, t) => s + (t.savings || 0) * (t.anzahl ?? 1),
      0,
    );

    let message = '';
    if (dbCount > 0 && customCount > 0 && brandCount > 0) {
      message = `Möchtest du alle ${targetsTotal} Produkte (${brandCount} Marken, ${dbCount} NoNames, ${customCount} Freitext) als erledigt markieren? Du sparst dabei ${formatEur(totalSavings)}.`;
    } else if (dbCount > 0 && customCount > 0) {
      message = `Möchtest du alle ${targetsTotal} Produkte als erledigt markieren? (${dbCount} NoNames für ${formatEur(totalSavings)} Ersparnis + ${customCount} Freitext-Einträge)`;
    } else if (dbCount > 0) {
      message = `Möchtest du alle ${dbCount} NoName-Produkte als gekauft markieren und ${formatEur(totalSavings)} zu deiner Ersparnis hinzufügen?`;
    } else if (brandCount > 0 && customCount > 0) {
      message = `Möchtest du alle ${targetsTotal} Einträge (${brandCount} Marken + ${customCount} Freitext) als erledigt markieren?`;
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
        <ShoppingRowWithBoughtAnim
          key={item.id}
          onSwipeBought={() => handleMarkAsPurchased(item.id)}
          onSwipeDelete={() => handleRemoveFromCart(item.id)}
          disabled={loadingCheck || loadingDelete}
          renderChild={(playBought) => (
            <CustomCard
              item={item}
              onCheck={playBought}
              onDelete={() => handleRemoveFromCartConfirm(item.id)}
              loadingCheck={loadingCheck}
              loadingDelete={loadingDelete}
              onIncrement={() => handleIncrementCart(item)}
              onDecrement={() => handleDecrementCart(item)}
            />
          )}
        />
      );
    }
    if (item.kind === 'brand') {
      const sel = selectedConversions.find((c) => c.einkaufswagenRef === item.id);
      const expanded = expandedItems.includes(item.id);
      return (
        <ShoppingRowWithBoughtAnim
          key={item.id}
          onSwipeBought={() => handleMarkAsPurchased(item.id)}
          onSwipeDelete={() => handleRemoveFromCart(item.id)}
          disabled={loadingCheck || loadingDelete}
          renderChild={(playBought) => (
          <BrandCard
            item={item}
            expanded={expanded}
            onToggleExpand={() => toggleExpanded(item.id)}
            onCheck={playBought}
            onDelete={() => handleRemoveFromCartConfirm(item.id)}
            onIncrement={() => handleIncrementCart(item)}
            onDecrement={() => handleDecrementCart(item)}
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
            priceDominant={priceDominant}
            allowExpand={opts.allowExpand}
            infos={(item.product as any)?.marke?.infos ?? null}
            onInfoPress={() => {
              // `infos` liegt auf dem MARKE-Doc (= hersteller-
              // Collection in der DB).
              const markeDoc = (item.product as any)?.marke;
              const raw = markeDoc?.infos ?? (item.product as any)?.infos;
              const infosText =
                typeof raw === 'string' && raw.trim().length > 0
                  ? raw.trim()
                  : null;
              const fallbackLines = [
                markeDoc?.adresse ? String(markeDoc.adresse) : null,
                [markeDoc?.plz, markeDoc?.stadt].filter(Boolean).join(' ') || null,
                markeDoc?.land ? String(markeDoc.land) : null,
              ].filter(Boolean) as string[];
              const body =
                infosText ??
                (fallbackLines.length > 0
                  ? fallbackLines.join('\n')
                  : 'Zu dieser Marke sind aktuell keine Zusatz-Informationen hinterlegt.');
              const title =
                markeDoc?.name ??
                item.name ??
                item.product?.name ??
                'Info';
              setInfoSheet({ title, body });
            }}
          />
          )}
        />
      );
    }
    return (
      <ShoppingRowWithBoughtAnim
        key={item.id}
        onSwipeBought={() => handleMarkAsPurchased(item.id, item.savings)}
        onSwipeDelete={() => handleRemoveFromCart(item.id)}
        disabled={loadingCheck || loadingDelete}
        renderChild={(playBought) => (
        <NoNameCard
          item={item}
          onCheck={playBought}
          onDelete={() => handleRemoveFromCartConfirm(item.id)}
          onIncrement={() => handleIncrementCart(item)}
          onDecrement={() => handleDecrementCart(item)}
          loadingCheck={loadingCheck}
          loadingDelete={loadingDelete}
          favoriteMarketId={favoriteMarketId}
        />
        )}
      />
    );
  };

  const renderPage = (variant: Tab) => {
    const items =
      variant === 'brand' ? filteredBrand : variant === 'noname' ? filteredNoName : filteredAll;
    const isEmpty = items.length === 0;
    const allowExpand = variant === 'brand';
    return (
      <View key={variant} style={{ flex: 1 }}>
        {/* FlatList statt ScrollView+map → Virtualization. Bei vielen
            Items werden nur sichtbare Cards (+windowSize) gemountet,
            nicht alle gleichzeitig. initialNumToRender:6 = sofort
            zeigen die ersten 6 Cards, Rest lädt beim Scrollen.
            removeClippedSubviews offboardet komplett offscreen Cards. */}
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => renderItem(item, { allowExpand })}
          ListHeaderComponent={
            <>
              <ShoppingSharedListsStrip
                lists={mySharedLists}
                myUid={user?.uid}
                theme={theme}
                brand={brand}
                onOpen={(sid) => router.push(`/shared-list/${sid}` as any)}
              />
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
            </>
          }
          ListFooterComponent={
            !isEmpty ? (
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
            ) : null
          }
          ListEmptyComponent={
            <EmptyState variant={variant} onAdd={() => setShowCustomItemModal(true)} />
          }
          contentContainerStyle={{
            paddingTop: chromeHeight + SEG_BAR_HEIGHT,
            paddingBottom: 140,
            paddingHorizontal: isEmpty ? 0 : 16,
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
          scrollsToTop={activeTab === variant}
          // ─── Performance / Virtualization ────────────────────────
          initialNumToRender={6}
          maxToRenderPerBatch={4}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
          // Memo: bei häufigen Re-Renders werden inactive items
          // weniger gemountet/unmountet.
          updateCellsBatchingPeriod={50}
        />
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

  // ─── Offline-Fallback-Render (86ca7uhg7) ───────────────────────
  // Read-only-Ansicht aus dem AsyncStorage-Snapshot, wenn der
  // Firestore-Load offline scheiterte. Nach allen Hooks platziert
  // (Hooks-Regel). Mutationen sind hier bewusst deaktiviert — V1.
  if (offlineSnapshot && brandProducts.length === 0 && noNameProducts.length === 0) {
    const sections: { title: string; items: CartSnapshotItem[] }[] = [
      { title: 'Markenprodukte', items: offlineSnapshot.brand },
      { title: 'NoName-Produkte', items: offlineSnapshot.noname },
    ].filter((sec) => sec.items.length > 0);
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + 16,
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 40,
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 24,
              letterSpacing: -0.3,
              color: theme.text,
            }}
          >
            Einkaufszettel
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginTop: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor: theme.surfaceAlt,
            }}
          >
            <MaterialCommunityIcons name="wifi-off" size={16} color={theme.textMuted} />
            <Text
              style={{
                flex: 1,
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 12,
                lineHeight: 17,
                color: theme.textSub,
              }}
            >
              Kein Empfang — das ist dein letzter gespeicherter Stand. Abhaken
              geht wieder, sobald du online bist.
            </Text>
          </View>
          {sections.map((sec) => (
            <View key={sec.title} style={{ marginTop: 20 }}>
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 16,
                  letterSpacing: -0.2,
                  color: theme.text,
                  marginBottom: 8,
                }}
              >
                {sec.title}
              </Text>
              <View
                style={{
                  backgroundColor: theme.surface,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.border,
                  overflow: 'hidden',
                }}
              >
                {sec.items.map((it, i) => (
                  <View
                    key={it.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: theme.border,
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        fontFamily,
                        fontWeight: fontWeight.bold,
                        fontSize: 14,
                        color: theme.text,
                      }}
                    >
                      {it.name}
                    </Text>
                    {it.anzahl > 1 ? (
                      <Text
                        style={{
                          fontFamily,
                          fontWeight: fontWeight.extraBold,
                          fontSize: 12,
                          color: theme.textMuted,
                        }}
                      >
                        ×{it.anzahl}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ))}
          <Pressable
            onPress={() => {
              setOfflineSnapshot(null);
              setInitialLoading(true);
              void loadShoppingCart();
            }}
            style={({ pressed }) => ({
              marginTop: 24,
              height: 46,
              borderRadius: 12,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 13,
                color: theme.primary,
              }}
            >
              Erneut laden
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

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
        skeleton={<ShoppingListSkeleton topInset={chromeHeight + SEG_BAR_HEIGHT} />}
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
              onPress={() => {
                if (!brandProducts.length && !noNameProducts.length) {
                  showInfoToast('Dein Einkaufszettel ist noch leer.', 'info');
                  return;
                }
                setShowShareSheet(true);
              }}
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
              {/* Plattform-konventionelles Teilen-Icon: iOS = Quadrat+Pfeil-hoch
                  (Ionicons), Android = verbundene Punkte (Material). */}
              {Platform.OS === 'ios' ? (
                <Ionicons name="share-outline" size={20} color={theme.textMuted} />
              ) : (
                <MaterialCommunityIcons name="share-variant" size={18} color={theme.textMuted} />
              )}
            </Pressable>
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
        bottom={(() => {
          // Anzahl-aware Tab-Counts: Σ anzahl statt Σ unique-products.
          // Damit zeigt der Tab-Counter dieselbe Zahl wie der
          // FloatingShoppingListButton (Doc-Count) und das matcht
          // dem User-Mental-Model "wieviele Items hab ich im
          // Wagen". Einzelne Produkte werden in der Liste nach
          // wie vor als 1 Card pro unique product gerendert (mit
          // Anzahl-Pill rechts).
          const sumAnzahl = (items: EnrichedItem[]) =>
            items.reduce((s, it) => s + (it.anzahl ?? 1), 0);
          const brandCount = sumAnzahl(brandProducts);
          const nonameCount = sumAnzahl(noNameProducts);
          return (
            <SegmentedTabs
              tabs={[
                { key: 'brand', label: `Marken (${brandCount})` },
                { key: 'noname', label: `NoNames (${nonameCount})` },
                { key: 'all', label: `Alle (${brandCount + nonameCount})` },
              ] as const}
              value={activeTab}
              onChange={onTabChange}
            />
          );
        })()}
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

      {/* Teilen-Chooser — verschicken ODER gemeinsame Liste erstellen.
          Brücke in das isolierte Shared-Lists-Feature (Stufe 5). */}
      <FilterSheet
        visible={showShareSheet}
        title="Einkaufszettel teilen"
        onClose={() => setShowShareSheet(false)}
      >
        <View style={{ paddingBottom: 8, gap: 10 }}>
          <Pressable
            onPress={handleShareAsText}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              backgroundColor: theme.surface,
              borderRadius: radii.lg,
              borderWidth: 1,
              borderColor: theme.border,
              padding: 14,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: theme.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons name="share-variant" size={22} color={theme.text} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 15, color: theme.text, letterSpacing: -0.2 }}>
                Als Nachricht verschicken
              </Text>
              <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 12, lineHeight: 17, color: theme.textMuted, marginTop: 2 }}>
                Sende deine Liste als Text an Familie oder Freunde.
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={theme.textMuted} />
          </Pressable>

          <Pressable
            onPress={handleCreateSharedList}
            disabled={creatingShared}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              backgroundColor: theme.primaryContainer ?? theme.surface,
              borderRadius: radii.lg,
              borderWidth: 1.5,
              borderColor: brand.primary,
              padding: 14,
              opacity: pressed || creatingShared ? 0.9 : 1,
            })}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: brand.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {creatingShared ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialCommunityIcons name="account-multiple-plus" size={22} color="#fff" />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 15, color: theme.text, letterSpacing: -0.2 }}>
                {creatingShared ? 'Wird erstellt …' : 'Gemeinsame Liste erstellen'}
              </Text>
              <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 12, lineHeight: 17, color: theme.textSub, marginTop: 2 }}>
                Alle bearbeiten dieselbe Liste — in Echtzeit, gemeinsam.
              </Text>
            </View>
            {!creatingShared ? (
              <MaterialCommunityIcons name="chevron-right" size={22} color={brand.primary} />
            ) : null}
          </Pressable>
        </View>
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
