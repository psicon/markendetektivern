// MorphingCartButton — vereint Cart-Action + Quantity-Pill in EIN
// connected Pill-Element. Im Idle ist es ein 48×48 brand.primary
// Cart-Button mit cart-check Icon + Badge. Beim Tap fährt der Button
// SYMMETRISCH zu einer einzigen 140×48 weißen Pill aus (links und
// rechts gleichmäßig vom Slot-Zentrum), genau im Stil der bisherigen
// floating QuantityPill: weißer surface bg, theme.border, − links,
// Anzahl mittig, + rechts (brand.primary 36×36 Round-Button).
//
// Wichtig: ES IST EIN PILL, kein 3-getrenntes-Element. Die − / N / +
// sitzen flexbox-artig innerhalb der gleichen Pill-Surface mit
// space-between Layout. Der Pill-Outer animiert width/left/bgColor/
// borderColor in einem Schritt → gleicher visueller Effekt wie das
// Original-Pill, nur dass es aus dem Cart-Button "rauswächst".

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

const SLOT_SIZE = 48;
// Expanded-Width = 1× heart (48) + gap (8) + 1× cart (48) + gap (8)
// + 1× star (48) = 160. Damit verdeckt die Pill heart und star
// links/rechts EXAKT genausoweit wie sie breit sind (User-Wunsch).
const EXPANDED_W = 160;
const SIDE_GROW = (EXPANDED_W - SLOT_SIZE) / 2; // 56 px je Seite
const AUTO_COLLAPSE_MS = 3000;
const MORPH_MS = 280;

interface MorphingCartButtonProps {
  /** anzahl > 0 → in-cart-Modus mit cart-check + Badge. =0 → cart-plus
   *  Icon, surface bg. */
  anzahl: number;
  /** Tap wenn anzahl=0. Parent macht den initialen Firestore-Add +
   *  FlyToCart-Anim. Sobald anzahl prop sich auf >0 aktualisiert,
   *  auto-expand-Pill. */
  onAddToCart: () => void;
  /** Tap auf + im Pill. */
  onIncrement: () => void;
  /** Tap auf − im Pill. Bei anzahl=1 wird − zum Trash → Parent
   *  entfernt das Item. */
  onDecrement: () => void;
  /** Spinner statt Icon zeigen während pending Firestore-Action. */
  loading?: boolean;
  /** Callback wenn die Pill expanded/idle wechselt. Parent nutzt
   *  das um zIndex/elevation auf seinem Wrapper-View zu setzen
   *  (sonst rendert star/rating ActionButton über das +). */
  onExpansionChange?: (expanded: boolean) => void;
  /** Signal-Counter: wenn dieser Wert sich ändert, kollabiert die
   *  Pill. Parent nutzt das um z.B. bei Scroll oder Tap auf andere
   *  Elemente die Pill explizit zu schließen. */
  collapseSignal?: number;
}

export function MorphingCartButton({
  anzahl,
  onAddToCart,
  onIncrement,
  onDecrement,
  loading,
  onExpansionChange,
  collapseSignal,
}: MorphingCartButtonProps) {
  const { theme, brand, shadows } = useTokens();
  const inCart = anzahl > 0;
  const [expanded, setExpanded] = useState(false);
  const t = useSharedValue(0);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAnzahl = useRef(anzahl);

  const restartAutoTimer = useCallback(() => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => setExpanded(false), AUTO_COLLAPSE_MS);
  }, []);

  useEffect(() => {
    t.value = withTiming(expanded ? 1 : 0, {
      duration: MORPH_MS,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    });
    if (expanded) restartAutoTimer();
    onExpansionChange?.(expanded);
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, [expanded, t, restartAutoTimer, onExpansionChange]);

  // Auto-Collapse wenn anzahl auf 0 fällt (Item entfernt via Trash).
  // KEIN Auto-Expand bei Prop-Change mehr — sonst würde die Pill
  // beim Page-Mount jedesmal aus- und einfahren wenn Firestore
  // den initial anzahl-Wert nachlädt (User-Bug). Expansion läuft
  // nur über handleTap = aktive User-Aktion.
  useEffect(() => {
    if (anzahl === 0 && expanded) {
      setExpanded(false);
    }
    prevAnzahl.current = anzahl;
  }, [anzahl, expanded]);

  // Collapse via Signal vom Parent (Scroll, Tap auf andere Elemente).
  useEffect(() => {
    if (collapseSignal === undefined) return;
    if (expanded) setExpanded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseSignal]);

  const handleTap = () => {
    if (loading) return;
    if (anzahl === 0) {
      // Initialer Add — Parent macht Firestore-Call + FlyToCart.
      // Wir expandieren SOFORT (nicht via Prop-Change-useEffect, weil
      // das auch beim Datenlade-Update feuern würde).
      onAddToCart();
      setExpanded(true);
      return;
    }
    if (!expanded) setExpanded(true);
  };

  const handleIncrement = () => {
    onIncrement();
    restartAutoTimer();
  };
  const handleDecrement = () => {
    onDecrement();
    restartAutoTimer();
  };

  // ─── Animated Styles ───────────────────────────────────────────

  // Pill-Outer: width/left/bg-color/border-color animieren in EINEM
  // verbundenen Layer → "der Button fährt aus zur Pill".
  const pillOuterStyle = useAnimatedStyle(() => ({
    width: interpolate(t.value, [0, 1], [SLOT_SIZE, EXPANDED_W], Extrapolation.CLAMP),
    left: interpolate(t.value, [0, 1], [0, -SIDE_GROW], Extrapolation.CLAMP),
    backgroundColor: interpolateColor(
      t.value,
      [0, 1],
      [inCart ? brand.primary : theme.surface, theme.surface],
    ),
    borderColor: interpolateColor(
      t.value,
      [0, 1],
      [inCart ? brand.primary : theme.border, theme.border],
    ),
  }));

  // Idle-Content (Cart-Icon + Badge): fadet aus beim Expand. Bleibt
  // dank symmetrischem Grow zentriert auf der ursprünglichen Cart-
  // Button-Position.
  const idleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.45], [1, 0], Extrapolation.CLAMP),
  }));

  // Expanded-Content (− N +): fadet ein, leichte scale-up von 0.85→1
  // damit es "frisch erscheint".
  const pillContentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0.5, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(t.value, [0.5, 1], [0.85, 1], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <View
      style={{
        width: SLOT_SIZE,
        height: SLOT_SIZE,
        // Hoher z-index/elevation wenn expanded — sonst werden die
        // ausgefahrenen Pill-Ränder von surrounding heart/star
        // ActionButtons überdeckt (siehe User-Bug "+ nicht sichtbar").
        zIndex: expanded ? 100 : 1,
        elevation: expanded ? 24 : 2,
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            height: SLOT_SIZE,
            borderRadius: 14,
            borderWidth: 1,
            overflow: 'hidden',
            ...shadows.sm,
          },
          pillOuterStyle,
        ]}
      >
        {/* Idle-Layer: Cart-Icon + (bei inCart) Badge. Pressable
            füllt die ganze Pill-Outer in idle (kein Tap-Konflikt
            mit − / + weil die im idle opacity 0 sind). */}
        <Animated.View
          pointerEvents={expanded ? 'none' : 'auto'}
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
            },
            idleStyle,
          ]}
        >
          <Pressable
            onPress={handleTap}
            disabled={loading}
            style={({ pressed }) => ({
              width: '100%',
              height: '100%',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {loading ? (
              <ActivityIndicator size="small" color={inCart ? '#fff' : brand.primary} />
            ) : (
              <MaterialCommunityIcons
                name={inCart ? 'cart-check' : 'cart-plus'}
                size={22}
                color={inCart ? '#fff' : theme.text}
              />
            )}
            {inCart && anzahl > 0 ? (
              <View
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: '#fff',
                  paddingHorizontal: 4,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: brand.primary,
                }}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 10,
                    color: brand.primary,
                  }}
                >
                  {anzahl}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </Animated.View>

        {/* Expanded-Layer: connected Pill-Inhalt − [N] +.
            Layout: row mit space-between, paddingHorizontal:4. In
            idle (Pill 48 wide) sind die drei Elemente cramped, aber
            opacity 0 → unsichtbar. In expanded (140 wide) sind sie
            schön verteilt. */}
        <Animated.View
          pointerEvents={expanded ? 'auto' : 'none'}
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 4,
            },
            pillContentStyle,
          ]}
        >
          {/* − Button (oder Trash bei anzahl=1) */}
          <Pressable
            onPress={handleDecrement}
            hitSlop={6}
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

          {/* Anzahl (Pill-Mitte) */}
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 16,
              color: theme.text,
              minWidth: 24,
              textAlign: 'center',
              letterSpacing: -0.2,
            }}
          >
            {Math.max(1, anzahl)}
          </Text>

          {/* + Button (brand.primary, weißes Plus) */}
          <Pressable
            onPress={handleIncrement}
            hitSlop={6}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? brand.primaryContainer ?? brand.primary : brand.primary,
            })}
          >
            <MaterialCommunityIcons name="plus" size={18} color="#fff" />
          </Pressable>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
