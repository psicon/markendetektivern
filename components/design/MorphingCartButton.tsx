// MorphingCartButton — vereint die Cart-Action mit der Quantity-Pill
// in EIN Element. Idle = 48×48 brand.primary cart-check + Anzahl-
// Badge oben-rechts. Tap (wenn schon im Cart) → expandiert nach LINKS
// auf ~140×48 (right-anchored absolute, kein Layout-Shift in der
// umgebenden Row), wechselt die Bg-Farbe von brand.primary → weiß
// (Pill-Style), zeigt [−][N][+] inline. Das + sitzt RECHTS in der
// Pill — am gleichen Spot wo vorher das cart-check Icon war, jetzt
// in einem brand.primary 36×36 Round-Button → "die Pill fährt aus
// dem Button raus".
//
// Auto-Collapse: 3 s nach letzter Interaktion zurück zu Idle. Timer
// startet bei +/− neu.
//
// Tap auf Idle bei anzahl=0: ruft onAddToCart() (KEIN expand, weil
// es eh nichts zu inkrementieren gibt — der initiale Add ist die
// Aktion).

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

const IDLE_W = 48;
const EXPANDED_W = 140;
const HEIGHT = 48;
const MORPH_DURATION = 280;
const AUTO_COLLAPSE_MS = 3000;

interface MorphingCartButtonProps {
  /** anzahl > 0 → in-cart-Modus (cart-check icon + Badge). =0 →
   *  cart-plus icon, surface bg. */
  anzahl: number;
  /** Tap wenn anzahl=0. Parent macht den initialen Add + FlyToCart. */
  onAddToCart: () => void;
  /** Tap auf + in Pill (oder bei initialem Add — Parent handhabt). */
  onIncrement: () => void;
  /** Tap auf − in Pill. Bei anzahl=1 = Trash → Parent macht remove. */
  onDecrement: () => void;
  /** Spinner statt Icon zeigen während pending Firestore-Action. */
  loading?: boolean;
  /** Optional: vom Parent kontrollieren ob expanded gerade möglich
   *  ist (z.B. während FlyToCart-Anim noch läuft). */
  disabled?: boolean;
}

export function MorphingCartButton({
  anzahl,
  onAddToCart,
  onIncrement,
  onDecrement,
  loading,
  disabled,
}: MorphingCartButtonProps) {
  const { theme, brand, shadows } = useTokens();
  const inCart = anzahl > 0;
  const [expanded, setExpanded] = useState(false);
  const t = useSharedValue(0); // 0 = idle, 1 = pill expanded
  const autoCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restartIdleTimer = useCallback(() => {
    if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current);
    autoCollapseTimer.current = setTimeout(() => setExpanded(false), AUTO_COLLAPSE_MS);
  }, []);

  // Wenn anzahl auf 0 fällt (Decrement bis Trash), pill close.
  useEffect(() => {
    if (anzahl <= 0 && expanded) setExpanded(false);
  }, [anzahl, expanded]);

  useEffect(() => {
    t.value = withTiming(expanded ? 1 : 0, {
      duration: MORPH_DURATION,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    });
    if (expanded) restartIdleTimer();
    return () => {
      if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current);
    };
  }, [expanded, t, restartIdleTimer]);

  const handleTap = () => {
    if (loading || disabled) return;
    if (!inCart) {
      onAddToCart();
      return;
    }
    if (!expanded) {
      setExpanded(true);
    }
  };

  const handleIncrement = () => {
    onIncrement();
    restartIdleTimer();
  };
  const handleDecrement = () => {
    onDecrement();
    restartIdleTimer();
  };

  // Strip-Container: Width morpht, Bg-Color cross-fade (brand.primary
  // → weiß), Border 0 → 1 theme.border.
  const stripStyle = useAnimatedStyle(() => {
    const w = interpolate(t.value, [0, 1], [IDLE_W, EXPANDED_W], Extrapolation.CLAMP);
    return { width: w };
  });

  // Idle-Layer (cart icon + badge): fadet aus mit slight scale-down.
  const idleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.45], [1, 0], Extrapolation.CLAMP),
  }));

  // Pill-Layer (− N): fadet ein wenn t > 0.5.
  const pillLeftStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0.5, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(t.value, [0.5, 1], [12, 0], Extrapolation.CLAMP) },
    ],
  }));

  // Background-Fade: idle-bg (brand.primary wenn inCart, sonst surface)
  // → Pill-bg (theme.surface) mit Border.
  const stripBgStyle = useAnimatedStyle(() => {
    // idle bg (color):  brand.primary  (or surface if !inCart)
    // expanded bg (color): theme.surface
    // wir machen es über zwei abs-View Layers (idle-bg unten, pill-bg
    // oben mit opacity) → React-Native unterstützt keine animierten
    // Color-Strings nativ.
    return {};
  });

  const idleBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.4], [1, 0], Extrapolation.CLAMP),
  }));
  const pillBgStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0.4, 1], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    // Layout-Slot 48×48 — die expandierte Pill ragt via absolute
    // right:0 nach LINKS raus, ohne den Layout-Flow zu verändern.
    <View style={{ width: IDLE_W, height: HEIGHT }}>
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 0,
            right: 0,
            height: HEIGHT,
            borderRadius: 14,
            overflow: 'hidden',
            ...shadows.sm,
          },
          stripStyle,
          stripBgStyle,
        ]}
      >
        {/* Idle-Bg: cart-check brand.primary fill (wenn inCart) oder
            theme.surface mit border (wenn nicht im Cart). */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: inCart ? brand.primary : theme.surface,
              borderWidth: inCart ? 0 : 1,
              borderColor: theme.border,
              borderRadius: 14,
            },
            idleBgStyle,
          ]}
        />
        {/* Pill-Bg: weiß (theme.surface) mit border, fadet ein beim
            Expand. */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 14,
            },
            pillBgStyle,
          ]}
        />

        {/* Idle-Content: cart-Icon (rechts in der 48×48 Idle-Box) +
            Badge oben-rechts. Sitzt im RECHTEN Teil der Strip damit
            beim Morph dort wo das Icon war jetzt das + Button sitzt. */}
        <Animated.View
          pointerEvents={expanded ? 'none' : 'auto'}
          style={[
            {
              position: 'absolute',
              top: 0,
              right: 0,
              width: IDLE_W,
              height: HEIGHT,
              alignItems: 'center',
              justifyContent: 'center',
            },
            idleStyle,
          ]}
        >
          <Pressable
            onPress={handleTap}
            disabled={loading || disabled}
            hitSlop={4}
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

        {/* Pill-Content: − und N auf der LINKEN Seite der expandierten
            Strip (fadet von links rein). Das + sitzt fest rechts an
            der gleichen Position wo vorher das cart-check Icon war. */}
        <Animated.View
          pointerEvents={expanded ? 'auto' : 'none'}
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: IDLE_W, // bis vor den + Button
              height: HEIGHT,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingLeft: 6,
              paddingRight: 4,
            },
            pillLeftStyle,
          ]}
        >
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
            {anzahl}
          </Text>
        </Animated.View>

        {/* Plus-Button — sitzt FEST am rechten Strip-Ende (right:0,
            width:IDLE_W). Im Idle-State unsichtbar (Idle-Layer
            überlagert ihn). Im Pill-State sichtbar als brand.primary
            Round-Button — gleicher Spot wie vorher das cart-check Icon. */}
        <Animated.View
          pointerEvents={expanded ? 'auto' : 'none'}
          style={[
            {
              position: 'absolute',
              top: 0,
              right: 0,
              width: IDLE_W,
              height: HEIGHT,
              alignItems: 'center',
              justifyContent: 'center',
            },
            pillLeftStyle, // gleiche fade-in opacity wie linke Pill-Hälfte
          ]}
        >
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
