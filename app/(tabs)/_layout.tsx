import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { Tabs, useRouter, useSegments } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/HapticTab';
import { CustomIcon } from '@/components/ui/CustomIcon';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';

// ─── Flying-Tabs Feature-Flag ────────────────────────────────────────
// Wenn true: Custom Floating-Pill Tab-Bar mit Reanimated-3-Indicator
// (animierter Brand-Primary-Kreis fliegt zwischen den Tabs, aktive Tab
// versteckt sein Label, inaktive zeigen Icon + Label).
// Wenn false: Alte Custom-JS-Tab-Bar mit raised Stöbern-Button.
//
// Rollback einfach durch Flag-Flip auf false. Alte Implementation bleibt
// vollständig erhalten — kein Schaden.
const USE_FLYING_TABS = true;

// ─── Floating-Pill Tab-Bar ───────────────────────────────────────────
// Container = floating Pill (white/dark surface, soft shadow, große
// Border-Radius). Indicator = Brand-Primary-Kreis der per Spring
// zwischen den Tab-Slots animiert. Pro Tab fadet das Label aus wenn
// der Indicator drüber ist + slidet das Icon leicht nach oben (mehr
// Headroom im Kreis). Beim Verlassen kommt das Label per Translate-
// Y-Animation zurück.
const PILL_HEIGHT = 62;
const PILL_MARGIN_X = 36;
const INDICATOR_SIZE = 46;
const INDICATOR_PAD = 8; // (PILL_HEIGHT - INDICATOR_SIZE) / 2

function FlyingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

  // Reanimated state — folgt state.index per Spring mit leichtem
  // Overshoot. damping 13 + stiffness 220 + mass 0.7 gibt einen
  // Wobble von ~10-15% über das Ziel hinaus, schwingt 1× zurück
  // und settled. Fühlt sich "boingy" an, ohne floppy zu sein.
  const activeIndex = useSharedValue(state.index);

  // Indicator-Scale-Pulse — bei jedem Tab-Wechsel macht die Pille
  // ein "boop": shrinkt kurz auf 0.92, springt mit Overshoot
  // zurück auf 1.0. Das ist das eigentliche "Wobble"-Gefühl
  // zusätzlich zum Translate.
  const indicatorScale = useSharedValue(1);

  useEffect(() => {
    activeIndex.value = withSpring(state.index, {
      damping: 13,
      stiffness: 220,
      mass: 0.7,
      overshootClamping: false,
    });
    indicatorScale.value = withSequence(
      withTiming(0.92, { duration: 90 }),
      withSpring(1, {
        damping: 9,
        stiffness: 230,
        mass: 0.5,
        overshootClamping: false,
      }),
    );
  }, [state.index, activeIndex, indicatorScale]);

  // Keyboard-Hide — Tab-Bar fadet weg + slidet runter wenn die
  // Tastatur kommt, kein hartes display:none-Springen.
  const keyboardOpacity = useSharedValue(1);
  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
      keyboardOpacity.value = withTiming(0, { duration: 180 });
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      keyboardOpacity.value = withTiming(1, { duration: 220 });
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardOpacity]);

  const tabCount = state.routes.length;
  const innerWidth = containerWidth; // wir setzen indicator relativ zum container
  const tabWidth = tabCount > 0 ? innerWidth / tabCount : 0;

  // Indicator-X = (activeIndex * tabWidth) + (tabWidth - indicatorSize) / 2
  // + scale-Pulse für den "boop" beim Tab-Wechsel.
  const indicatorStyle = useAnimatedStyle(() => {
    if (tabWidth === 0) return { opacity: 0 };
    const x =
      activeIndex.value * tabWidth + (tabWidth - INDICATOR_SIZE) / 2;
    return {
      opacity: 1,
      transform: [
        { translateX: x },
        { scale: indicatorScale.value },
      ],
    };
  });

  const containerAnimStyle = useAnimatedStyle(() => ({
    opacity: keyboardOpacity.value,
    transform: [
      {
        translateY: interpolate(
          keyboardOpacity.value,
          [0, 1],
          [40, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  // pointerEvents auf 'none' wenn Keyboard zu — sonst klaut die
  // unsichtbare Pille Touches während Eingabefeldern
  const pointerEvents = isKeyboardVisible ? 'none' : 'auto';

  return (
    <Animated.View
      pointerEvents={pointerEvents}
      style={[
        {
          position: 'absolute',
          left: PILL_MARGIN_X,
          right: PILL_MARGIN_X,
          bottom: Math.max(insets.bottom, 8) + 6,
          height: PILL_HEIGHT,
          backgroundColor: colors.cardBackground,
          borderRadius: PILL_HEIGHT / 2,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: INDICATOR_PAD,
          // soft shadow wie ein floating element
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: colorScheme === 'dark' ? 0.4 : 0.12,
          shadowRadius: 18,
          elevation: 14,
          // dezente Border im Dark-Mode für Kontrast gegen schwarzen
          // Hintergrund — sonst verschwindet die Pille fast ganz
          borderWidth: colorScheme === 'dark' ? 1 : 0,
          borderColor: 'rgba(255,255,255,0.06)',
        },
        containerAnimStyle,
      ]}
      onLayout={(e: LayoutChangeEvent) => {
        // innerer Bereich = Container-Width minus padding-Horizontal links+rechts
        setContainerWidth(e.nativeEvent.layout.width - INDICATOR_PAD * 2);
      }}
    >
      {/* Animierter Brand-Primary-Indicator-Kreis */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            top: INDICATOR_PAD,
            left: INDICATOR_PAD,
            width: INDICATOR_SIZE,
            height: INDICATOR_SIZE,
            borderRadius: INDICATOR_SIZE / 2,
            backgroundColor: colors.primary,
            shadowColor: colors.primary,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.35,
            shadowRadius: 8,
            elevation: 6,
          },
          indicatorStyle,
        ]}
      />

      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const isFocused = state.index === index;
        const label =
          (options.tabBarLabel as string | undefined) ??
          options.title ??
          route.name;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            if (Platform.OS === 'ios') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            // navigate without params/merge for tabs (default behaviour)
            navigation.navigate(route.name as never);
          }
        };

        return (
          <FlyingTab
            key={route.key}
            routeName={route.name}
            label={label}
            index={index}
            activeIndex={activeIndex}
            isFocused={isFocused}
            colors={colors}
            onPress={onPress}
          />
        );
      })}
    </Animated.View>
  );
}

interface FlyingTabProps {
  routeName: string;
  label: string;
  index: number;
  activeIndex: SharedValue<number>;
  isFocused: boolean;
  colors: (typeof Colors)['light'];
  onPress: () => void;
}

function FlyingTab({
  routeName,
  label,
  index,
  activeIndex,
  isFocused,
  colors,
  onPress,
}: FlyingTabProps) {
  // Distance vom aktiven Tab — 0 = aktiv, 1+ = entfernt. Wird für
  // Label-Opacity + Icon-Translate-Y benutzt damit das aktive Tab
  // nur das Icon zeigt und das Label sanft rein-/rausfaded.
  const distance = useDerivedValue(() =>
    Math.abs(activeIndex.value - index),
  );

  const labelStyle = useAnimatedStyle(() => {
    // Label fadet schnell raus (0.5 Distance schon unsichtbar) und
    // schiebt sich beim Erscheinen leicht von unten nach oben rein.
    const opacity = interpolate(
      distance.value,
      [0, 0.5, 1],
      [0, 0, 1],
      Extrapolation.CLAMP,
    );
    const translateY = interpolate(
      distance.value,
      [0, 1],
      [4, 0],
      Extrapolation.CLAMP,
    );
    return { opacity, transform: [{ translateY }] };
  });

  const iconStyle = useAnimatedStyle(() => {
    // Inaktives Icon: oberhalb der Mitte (Platz für Label drunter).
    // Aktives Icon: rutscht runter zur Pill-Mitte = Indicator-Kreis-
    // Mitte und zoomed deutlich rein (1.30) — das ist das gewünschte
    // "zoomed"-Gefühl. translateY 12 verschiebt das Icon von y=20
    // (inactive top) nach y=32 (Pill-Center, Circle-Center).
    const translateY = interpolate(
      distance.value,
      [0, 1],
      [12, 0],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      distance.value,
      [0, 1],
      [1.3, 1],
      Extrapolation.CLAMP,
    );
    return { transform: [{ translateY }, { scale }] };
  });

  const iconColor = isFocused ? '#ffffff' : colors.text;

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{
        color: 'rgba(0,0,0,0.05)',
        borderless: true,
        radius: 32,
      }}
      style={{
        flex: 1,
        height: '100%',
        position: 'relative',
      }}
    >
      {/* Icon — absolut positioniert oben (top 8), shifted nach unten
          + scaled wenn aktiv (per iconStyle). */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 8,
            alignItems: 'center',
          },
          iconStyle,
        ]}
      >
        {renderTabIcon(routeName, iconColor, isFocused)}
      </Animated.View>
      {/* Label — absolut positioniert unten (bottom 7), fadet aus
          wenn aktiv. */}
      <Animated.Text
        numberOfLines={1}
        style={[
          {
            position: 'absolute',
            bottom: 7,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 10,
            fontFamily: 'Nunito_600SemiBold',
            color: colors.tabIconDefault,
            letterSpacing: 0.2,
          },
          labelStyle,
        ]}
      >
        {label}
      </Animated.Text>
    </Pressable>
  );
}

function renderTabIcon(
  routeName: string,
  color: string,
  focused: boolean,
): React.ReactElement {
  if (routeName === 'index') {
    return <IconSymbol size={24} name="house.fill" color={color} />;
  }
  if (routeName === 'explore') {
    // Custom Brand-Glyph (Markendetektive-Logo) — bewusst behalten,
    // weil das die markenspezifische Stöbern-Identität ist.
    return <CustomIcon name="iconBlack" size={26} color={color} />;
  }
  if (routeName === 'rewards') {
    return (
      <IconSymbol
        size={24}
        name={focused ? 'trophy.fill' : 'trophy'}
        color={color}
      />
    );
  }
  return <IconSymbol size={24} name="house.fill" color={color} />;
}

// ─── Legacy Custom-JS Tab-Bar (raised Stöbern-Button) ────────────────
// Bleibt für USE_FLYING_TABS=false stehen als Rollback.
function CustomTabBarButton({ children, onPress, accessibilityState }: any) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const segments = useSegments();
  const selected = segments[1] === 'explore';

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
    >
      <TouchableOpacity
        style={{
          top: Platform.OS === 'ios' ? -36 : -24,
          justifyContent: 'center',
          alignItems: 'center',
          width: Platform.OS === 'ios' ? 70 : 56,
          height: Platform.OS === 'ios' ? 70 : 56,
          borderRadius: Platform.OS === 'ios' ? 35 : 28,
          backgroundColor: colors.primary,
          elevation: Platform.OS === 'ios' ? 0 : 6,
          shadowColor: colorScheme === 'dark' ? colors.primary : '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: Platform.OS === 'ios' ? (colorScheme === 'dark' ? 0.4 : 0.25) : 0,
          shadowRadius: Platform.OS === 'ios' ? 6 : 0,
          borderWidth: 3,
          borderColor: selected ? colors.secondary : Colors[colorScheme ?? 'light'].background,
        }}
        onPress={onPress}
      >
        <CustomIcon
          name="iconBlack"
          size={Platform.OS === 'ios' ? 42 : 36}
          color="white"
        />
      </TouchableOpacity>
      <Text
        style={{
          marginTop: Platform.OS === 'ios' ? -33 : -20,
          fontSize: 11,
          fontFamily: 'Nunito_500Medium',
          color: selected ? colors.primary : colors.tabIconDefault,
        }}
      >
        Stöbern
      </Text>
    </View>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { user, loading } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

  // Tab Bar ausblenden wenn Keyboard sichtbar (iOS + Android)
  // (nur für Legacy-Path — der FlyingTabBar managed das selbst)
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const keyboardShow = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
    });
    const keyboardHide = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });

    return () => {
      keyboardShow.remove();
      keyboardHide.remove();
    };
  }, []);

  // Escape-hatch — if auth resolved (loading done) but the user
  // is null, the auto-anonymous-login refused (e.g. registered
  // backup exists in AsyncStorage and Firebase didn't restore the
  // session). Without an explicit redirect the tab layout would
  // render a blank background forever. Push the user to the
  // welcome screen so they can log in, register, or skip to
  // anonymous mode — anything but stuck.
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/auth/welcome' as any);
    }
  }, [loading, user, router]);

  // Auto-anonymous login typically resolves in <300 ms. We
  // deliberately do NOT show a centered ActivityIndicator here —
  // it flashes as a "spinner on the homepage" because the native
  // splash has just faded and the user expects content. Instead,
  // render a quiet themed background while we wait. If the wait
  // is short (the hot path), this is invisible — first paint is
  // the actual home tab. If the wait is long, the user sees a
  // calm coloured screen, not a noisy spinner.
  if (loading || !user) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors[colorScheme ?? 'light'].background,
        }}
      />
    );
  }

  // ─── Flying-Pill Tab-Bar ────────────────────────────────────────────
  if (USE_FLYING_TABS) {
    return (
      <Tabs
        tabBar={(props) => <FlyingTabBar {...props} />}
        screenOptions={{
          // Lazy + freezeOnBlur — gleiche Begründung wie im Legacy-
          // Path (Stöbern-Subtree friert beim Tab-Wechsel ein,
          // useEffects der inaktiven Tabs feuern erst beim Mount).
          lazy: true,
          freezeOnBlur: true,
          headerShown: false,
          // tabBarStyle wird vom custom tabBar-Renderer ignoriert,
          // aber expo-router reserviert immer noch Platz dafür wenn
          // wir es nicht explizit verstecken. Wir setzen es display:
          // 'none' damit kein Phantom-Spacing entsteht.
          tabBarStyle: { display: 'none' },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="explore" options={{ title: 'Stöbern' }} />
        <Tabs.Screen name="rewards" options={{ title: 'Rewards' }} />
      </Tabs>
    );
  }

  // ─── Legacy Custom JS Tab-Bar (raised Stöbern-Button) ───────────────
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      enabled={Platform.OS === 'ios'}
    >
      <Tabs
        screenOptions={{
        lazy: true,
        freezeOnBlur: true,
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tabIconSelected,
        tabBarInactiveTintColor: Colors[colorScheme ?? 'light'].tabIconDefault,
        headerShown: false,
        headerTitleStyle: {
          fontFamily: 'Nunito_600SemiBold',
        },
        tabBarButton: HapticTab,
        tabBarStyle: Platform.select({
          ios: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 90,
            backgroundColor: Colors[colorScheme ?? 'light'].cardBackground,
            borderTopLeftRadius: 25,
            borderTopRightRadius: 25,
            borderTopWidth: 0,
            paddingHorizontal: 10,
            paddingTop: 10,
            paddingBottom: insets.bottom,
            shadowColor: colorScheme === 'dark' ? '#000' : '#000',
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: colorScheme === 'dark' ? 0.3 : 0.15,
            shadowRadius: 12,
            display: isKeyboardVisible ? 'none' : 'flex',
          },
          android: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 62 + insets.bottom,
            backgroundColor: Colors[colorScheme ?? 'light'].cardBackground,
            borderTopLeftRadius: 25,
            borderTopRightRadius: 25,
            borderTopWidth: 0,
            paddingHorizontal: 10,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 8),
            elevation: 0,
            display: isKeyboardVisible ? 'none' : 'flex',
          },
        }),
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: 'Nunito_500Medium',
          marginTop: 2,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="house.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Stöbern',
          tabBarButton: (props) => <CustomTabBarButton {...props} />,
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: 'Rewards',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol
              size={24}
              name={focused ? 'trophy.fill' : 'trophy'}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
    </KeyboardAvoidingView>
  );
}
