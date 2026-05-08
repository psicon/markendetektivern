// MorphingCartButton — vereint Cart-Action + Quantity-Pill in EIN
// Element. Layout-Slot bleibt fest 48×48 in der Action-Row. Beim
// Expand poppen DREI Elemente in Bewegung:
//   • Center-Button: cart-check Icon + Badge → fadet aus, Anzahl
//     erscheint groß zentriert IM Button.
//   • − bzw. Trash-Icon: pops nach LINKS aus dem Button raus
//     (translateX SIDE_OFFSET → 0, scale 0.4 → 1, mit Spring-Bounce).
//   • + Icon: pops nach RECHTS aus dem Button raus (mirror).
//
// Idle (anzahl=0): cart-plus Icon, surface bg, theme.border. Tap →
// onAddToCart() (Parent macht Firestore-Add + FlyToCart). Sobald
// anzahl prop sich auf >0 aktualisiert, auto-expand → Pill öffnet
// sich automatisch nach erstem Add (User-Wunsch).
//
// Idle (anzahl>0): cart-check Icon weiß, brand.primary bg, weißes
// Anzahl-Badge oben-rechts. Tap → expandiert.
//
// Auto-Collapse: 3 s nach letzter Interaktion → side-Buttons
// retracten zurück Richtung Center, fadeen aus.
//
// Side-Button-Overlap: Im expanded Zustand überlagern − und +
// die surrounding heart/star ActionButtons. Z-Index erhöht damit
// sie on top rendern. Auto-Collapse stellt den Zustand wieder her.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

const SLOT_SIZE = 48;
const SIDE_BTN_SIZE = 40;
// Wie weit die seitlichen Buttons rauspoppen — gemessen vom inneren
// Slot-Rand. 46 = 40 SIDE_BTN_SIZE + 6 Gap.
const SIDE_OFFSET = 46;
const AUTO_COLLAPSE_MS = 3000;
const CENTER_FADE_MS = 220;

interface MorphingCartButtonProps {
  /** anzahl > 0 → in-cart-Modus mit cart-check + Badge. =0 → cart-plus
   *  Icon, surface bg. */
  anzahl: number;
  /** Tap wenn anzahl=0. Parent macht den initialen Firestore-Add +
   *  FlyToCart-Anim. Nach Update auf anzahl>0 auto-expand-Pill. */
  onAddToCart: () => void;
  /** Tap auf + im Pill. */
  onIncrement: () => void;
  /** Tap auf − im Pill. Bei anzahl=1 wird − zum Trash-Icon → Parent
   *  entfernt das Item. */
  onDecrement: () => void;
  /** Spinner statt Icon zeigen während pending Firestore-Action. */
  loading?: boolean;
}

export function MorphingCartButton({
  anzahl,
  onAddToCart,
  onIncrement,
  onDecrement,
  loading,
}: MorphingCartButtonProps) {
  const { theme, brand, shadows } = useTokens();
  const inCart = anzahl > 0;
  const [expanded, setExpanded] = useState(false);
  // Center cross-fade Progress (idle-content ↔ Anzahl-Number).
  const t = useSharedValue(0);
  // Side-Buttons Spring-Pop Progress. Eigener SharedValue damit
  // wir Spring statt Timing nutzen können → bouncy "Pop"-Feel.
  const sideT = useSharedValue(0);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAnzahl = useRef(anzahl);

  const restartAutoTimer = useCallback(() => {
    if (autoTimer.current) clearTimeout(autoTimer.current);
    autoTimer.current = setTimeout(() => setExpanded(false), AUTO_COLLAPSE_MS);
  }, []);

  // Animationen synchron zum expanded-State
  useEffect(() => {
    t.value = withTiming(expanded ? 1 : 0, {
      duration: CENTER_FADE_MS,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
    });
    sideT.value = withSpring(expanded ? 1 : 0, {
      damping: 14,
      stiffness: 220,
      mass: 0.7,
      overshootClamping: false,
    });
    if (expanded) restartAutoTimer();
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
  }, [expanded, t, sideT, restartAutoTimer]);

  // Auto-Expand wenn anzahl von 0 → >0 wechselt (= initialer Add
  // durch onAddToCart). Auto-Collapse wenn anzahl auf 0 fällt
  // (= User hat über − bis zum Trash dekrementiert).
  useEffect(() => {
    if (prevAnzahl.current === 0 && anzahl > 0 && !expanded) {
      setExpanded(true);
    }
    if (anzahl === 0 && expanded) {
      setExpanded(false);
    }
    prevAnzahl.current = anzahl;
  }, [anzahl, expanded]);

  const handleTap = () => {
    if (loading) return;
    if (anzahl === 0) {
      // Initialer Add — Parent macht Firestore-Call + FlyToCart.
      // Auto-Expand kommt via useEffect sobald anzahl prop > 0 wird.
      onAddToCart();
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

  // Idle-Layer (cart icon + badge): full opacity wenn nicht expanded.
  const idleStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.5], [1, 0], Extrapolation.CLAMP),
  }));

  // Expanded-Center (große Anzahl-Zahl): fadet ein wenn expanded.
  const numberStyle = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0.5, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(t.value, [0.5, 1], [0.6, 1], Extrapolation.CLAMP) },
    ],
  }));

  // − Button: startet überlagert mit Center (translateX +SIDE_OFFSET),
  // popt nach links zur Endposition (translateX 0).
  const minusStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sideT.value, [0, 0.4, 1], [0, 0.4, 1], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(sideT.value, [0, 1], [SIDE_OFFSET, 0], Extrapolation.CLAMP) },
      { scale: interpolate(sideT.value, [0, 1], [0.4, 1], Extrapolation.CLAMP) },
    ],
  }));

  // + Button: startet überlagert mit Center (translateX -SIDE_OFFSET),
  // popt nach rechts zur Endposition.
  const plusStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sideT.value, [0, 0.4, 1], [0, 0.4, 1], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(sideT.value, [0, 1], [-SIDE_OFFSET, 0], Extrapolation.CLAMP) },
      { scale: interpolate(sideT.value, [0, 1], [0.4, 1], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <View
      style={{
        width: SLOT_SIZE,
        height: SLOT_SIZE,
        // Z-Index hochziehen wenn expanded damit die seitlichen Pop-
        // Buttons über die surrounding heart/star ActionButtons rendern.
        zIndex: expanded ? 10 : 1,
        elevation: expanded ? 10 : 2,
      }}
    >
      {/* Center-Button (Layout-Slot) */}
      <Pressable
        onPress={handleTap}
        disabled={loading}
        style={({ pressed }) => ({
          width: SLOT_SIZE,
          height: SLOT_SIZE,
          borderRadius: 14,
          backgroundColor: inCart ? brand.primary : theme.surface,
          borderWidth: inCart ? 0 : 1,
          borderColor: theme.border,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.85 : 1,
          ...shadows.sm,
        })}
      >
        {/* Idle-Content: Cart-Icon + (bei inCart) Badge */}
        <Animated.View
          pointerEvents="none"
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
        </Animated.View>

        {/* Expanded-Content: große Anzahl im Button-Zentrum */}
        <Animated.View
          pointerEvents="none"
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
            numberStyle,
          ]}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 22,
              color: '#fff',
              letterSpacing: -0.4,
            }}
          >
            {Math.max(1, anzahl)}
          </Text>
        </Animated.View>
      </Pressable>

      {/* − Pop-Out (links) */}
      <Animated.View
        pointerEvents={expanded ? 'auto' : 'none'}
        style={[
          {
            position: 'absolute',
            top: (SLOT_SIZE - SIDE_BTN_SIZE) / 2,
            left: -SIDE_OFFSET,
            width: SIDE_BTN_SIZE,
            height: SIDE_BTN_SIZE,
          },
          minusStyle,
        ]}
      >
        <Pressable
          onPress={handleDecrement}
          hitSlop={6}
          style={({ pressed }) => ({
            width: SIDE_BTN_SIZE,
            height: SIDE_BTN_SIZE,
            borderRadius: SIDE_BTN_SIZE / 2,
            backgroundColor: pressed
              ? anzahl <= 1
                ? '#fee2e2'
                : theme.surfaceAlt
              : theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            alignItems: 'center',
            justifyContent: 'center',
            ...shadows.sm,
          })}
        >
          <MaterialCommunityIcons
            name={anzahl <= 1 ? 'trash-can-outline' : 'minus'}
            size={18}
            color={anzahl <= 1 ? '#dc2626' : theme.text}
          />
        </Pressable>
      </Animated.View>

      {/* + Pop-Out (rechts) */}
      <Animated.View
        pointerEvents={expanded ? 'auto' : 'none'}
        style={[
          {
            position: 'absolute',
            top: (SLOT_SIZE - SIDE_BTN_SIZE) / 2,
            right: -SIDE_OFFSET,
            width: SIDE_BTN_SIZE,
            height: SIDE_BTN_SIZE,
          },
          plusStyle,
        ]}
      >
        <Pressable
          onPress={handleIncrement}
          hitSlop={6}
          style={({ pressed }) => ({
            width: SIDE_BTN_SIZE,
            height: SIDE_BTN_SIZE,
            borderRadius: SIDE_BTN_SIZE / 2,
            backgroundColor: pressed ? brand.primaryContainer ?? brand.primary : brand.primary,
            alignItems: 'center',
            justifyContent: 'center',
            ...shadows.sm,
          })}
        >
          <MaterialCommunityIcons name="plus" size={18} color="#fff" />
        </Pressable>
      </Animated.View>
    </View>
  );
}
