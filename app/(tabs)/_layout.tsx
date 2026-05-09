import MaskedView from '@react-native-masked-view/masked-view';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Tabs, useRouter, useSegments } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
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

// ─── Floating-Pill Tab-Bar mit raised Stöbern-Button ────────────────
// Container = floating Pill (white/dark surface, soft shadow, große
// Border-Radius). Mittlerer Tab (Stöbern) ist ein permanent raised
// Brand-Primary-Kreis der über die Pille hinausragt — wie unsere
// alte Navigation, nur eben über einer schwebenden Pille statt einer
// flachen Bottom-Bar. Side-Tabs (Home, Rewards) sind flache Tabs
// mit Icon oben + Label unten.
//
// Animation: jedes Tab macht beim Aktivieren einen Scale-Wobble
// (squash + spring back mit Overshoot). Der raised Stöbern-Button
// pulst zusätzlich seine Border (cardBackground → brand secondary).
const PILL_HEIGHT = 58;
const PILL_MARGIN_X = 50;
// borderRadius MATCHT radii.xl (= 18) aus dem Design-Tokens-System
// (`constants/tokens/radii.ts`). Das ist der "prominent container /
// hero card"-Tier — derselbe Wert den der MorphingCartButton (FAB
// direkt über uns), die Hero-Cards, MorphingHeader und QuantityPill
// nutzen. Vorher 22 (irgendwo zwischen den Tiers, nirgendwo sonst
// gebraucht — wirkte als Stilbruch). Vorvorher full capsule (= 29),
// auch nicht im Token-System.
const PILL_RADIUS = 18;
const RAISED_SIZE = 56;
const RAISED_LIFT = 22; // wie weit ragt der mittlere Button über die Pille hinaus

// ─── Liquid-Glass-Backdrop ───────────────────────────────────────────
// EINE BlurView mit voller Intensität, MaskedView mit vertikalem
// LinearGradient als Maske → echter weicher Verlauf von TRANSPARENT
// (oben, Mitte der Pille) zu OPAK (unten, Screen-Edge). Genau wie
// das iOS-Liquid-Glass: keine Banding-Kanten, kein hartes Anfang/Ende.
//
// Höhe: nur von der Pillen-Mitte bis zum Screen-Boden. Über der Pille
// passiert nichts mehr (kein "Sichere dir Cashback"-Text wird mehr
// geblurt — das war zu hoch).
//
// Mask:
//   • 0 % von oben → opacity 0 (Blur unsichtbar, Content scharf)
//   • 35 % von oben → leicht eingefadet
//   • 100 % unten   → voll opak (Blur maximal sichtbar)
//
// pointerEvents='none' überall — der Backdrop schluckt nie Touches.
function GlassBackdrop({
  colorScheme,
  pillBottom,
  animatedStyle,
}: {
  colorScheme: 'light' | 'dark';
  /** bottom-Wert der Pille (von Screen-Edge), damit wir die obere
   *  Backdrop-Kante exakt auf die Pillen-Mitte legen können. */
  pillBottom: number;
  animatedStyle: ReturnType<typeof useAnimatedStyle>;
}) {
  const tint = colorScheme === 'dark' ? 'dark' : 'light';
  // Backdrop-Höhe = von der Pillen-Mitte bis zum Screen-Boden.
  // pillBottom (= 35 px) + PILL_HEIGHT/2 (= 29 px) ≈ 64 px Höhe auf
  // iPhone. Das ist genau die untere Hälfte der Pille + safe-area.
  const totalH = pillBottom + PILL_HEIGHT / 2;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: totalH,
        },
        animatedStyle,
      ]}
    >
      <MaskedView
        style={{ flex: 1 }}
        maskElement={
          <LinearGradient
            // Von TRANSPARENT (oben — Pillen-Mitte) zu OPAK (unten
            // — Screen-Edge). Das ist die Mask: wo die Maske
            // schwarz ist, ist der maskierte Inhalt sichtbar. Wo
            // transparent, unsichtbar.
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)', 'rgba(0,0,0,1)']}
            locations={[0, 0.45, 1]}
            style={{ flex: 1 }}
          />
        }
      >
        <View style={{ flex: 1 }}>
          {/* Echter Blur (intensity 50 — vorher 70 war zu stark, der
              Inhalt war zu unkenntlich). */}
          <BlurView
            intensity={50}
            tint={tint}
            experimentalBlurMethod="dimezisBlurView"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
          {/* Tint-Overlay für Kontrast zur Pille:
              - Light-Mode → leichtes Schwarz (12 %) → Backdrop wird
                dunkler, Pille hebt sich stärker ab
              - Dark-Mode → leichtes Weiß (10 %) → Backdrop wird
                heller, Pille (cardBackground = #1c1c1e) hebt sich
                gegen die aufgehellte Frost-Schicht ab
              Beide Werte bewusst niedrig damit der Blur durchschimmert
              und nicht zu einer einfachen Color-Layer wird. */}
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor:
                colorScheme === 'dark'
                  ? 'rgba(255,255,255,0.10)'
                  : 'rgba(0,0,0,0.12)',
            }}
          />
        </View>
      </MaskedView>
    </Animated.View>
  );
}

function FlyingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);

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

  // Pill-Bottom-Wert (in px from screen edge) — exakt derselbe Wert
  // wie unten am Animated.View — wir reichen ihn an den GlassBackdrop
  // damit dort die Backdrop-Höhe = pillBottom + PILL_HEIGHT/2 berechnet
  // werden kann (Backdrop endet auf der Pillen-Mitte).
  const pillBottom = Math.max(insets.bottom + 1, 7);

  return (
    <>
      {/* Liquid-Glass-Backdrop hinter der Pille — Single BlurView mit
          MaskedView-Gradient (transparent oben, opak unten). Fade't
          mit der Pille analog beim Keyboard. */}
      <GlassBackdrop
        colorScheme={colorScheme ?? 'light'}
        pillBottom={pillBottom}
        animatedStyle={containerAnimStyle}
      />
      <Animated.View
        pointerEvents={pointerEvents}
        style={[
          {
            position: 'absolute',
            left: PILL_MARGIN_X,
            right: PILL_MARGIN_X,
          // Pille minimal angehoben (war Math.max(insets.bottom - 2, 4)).
          // Jetzt +3 px luftiger zur Screen-Bottom-Edge (User-Wunsch
          // nach Entfernen des Home-FABs — die Pille darf wieder
          // etwas mehr atmen). Wert wird oben als pillBottom berechnet
          // und an den GlassBackdrop weitergereicht.
          bottom: pillBottom,
          height: PILL_HEIGHT,
          backgroundColor: colors.cardBackground,
          borderRadius: PILL_RADIUS,
          flexDirection: 'row',
          alignItems: 'center',
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
          // overflow visible damit der raised Stöbern-Button + sein
          // Shadow nicht abgeschnitten werden
          overflow: 'visible',
        },
        containerAnimStyle,
      ]}
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const isFocused = state.index === index;
        const label =
          (options.tabBarLabel as string | undefined) ??
          options.title ??
          route.name;

        const onPress = () => {
          // Haptic IMMER feuern — auch wenn das schon-fokussierte Tab
          // angetippt wird. Tactile feedback ist Bestätigung des Taps,
          // nicht der Navigation.
          if (Platform.OS === 'ios') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name as never);
          }
        };

        // Stöbern (route name 'explore') ist immer der raised
        // mittlere Button — egal ob fokussiert oder nicht.
        if (route.name === 'explore') {
          return (
            <RaisedMiddleTab
              key={route.key}
              label={label}
              isFocused={isFocused}
              colors={colors}
              colorScheme={colorScheme ?? 'light'}
              onPress={onPress}
            />
          );
        }

        return (
          <FlatSideTab
            key={route.key}
            routeName={route.name}
            label={label}
            isFocused={isFocused}
            colors={colors}
            onPress={onPress}
          />
        );
      })}
      </Animated.View>
    </>
  );
}

// ─── Flat Side-Tab (Home, Rewards) ──────────────────────────────────
// Icon oben + Label unten. Beim Aktivieren: kurzer Squash-Spring
// (Wobble) auf den ganzen Inhalt. Icon-Color shiftet von textMuted
// auf brand primary. Label-Color analog.
interface FlatSideTabProps {
  routeName: string;
  label: string;
  isFocused: boolean;
  colors: (typeof Colors)['light'];
  onPress: () => void;
}

function FlatSideTab({
  routeName,
  label,
  isFocused,
  colors,
  onPress,
}: FlatSideTabProps) {
  const wobble = useSharedValue(1);

  // wenn dieses Tab BECOMES focused → squash + spring back
  useEffect(() => {
    if (isFocused) {
      wobble.value = withSequence(
        withTiming(0.88, { duration: 90 }),
        withSpring(1, {
          damping: 9,
          stiffness: 230,
          mass: 0.5,
          overshootClamping: false,
        }),
      );
    }
  }, [isFocused, wobble]);

  const wobbleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: wobble.value }],
  }));

  const accent = isFocused ? colors.primary : colors.tabIconDefault;

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
      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
          },
          wobbleStyle,
        ]}
      >
        {renderTabIcon(routeName, accent, isFocused)}
        <Text
          numberOfLines={1}
          style={{
            marginTop: 3,
            fontSize: 10,
            fontFamily: 'Nunito_600SemiBold',
            color: accent,
            letterSpacing: 0.2,
          }}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// ─── Raised Middle-Tab (Stöbern) ────────────────────────────────────
// Permanent über die Pille hinausragender Brand-Primary-Kreis mit
// weißem CustomIcon (Markendetektive-Glyph). Border = cardBackground
// (matcht die Pille → wirkt wie ein "Knopf in der Pille"), wird beim
// Aktivieren auf brand secondary umgefärbt + macht Wobble-Pulse.
// Stöbern-Label sitzt unter dem raised Button im Pill-Bereich.
interface RaisedMiddleTabProps {
  label: string;
  isFocused: boolean;
  colors: (typeof Colors)['light'];
  colorScheme: 'light' | 'dark';
  onPress: () => void;
}

function RaisedMiddleTab({
  label,
  isFocused,
  colors,
  colorScheme,
  onPress,
}: RaisedMiddleTabProps) {
  const wobble = useSharedValue(1);

  useEffect(() => {
    if (isFocused) {
      wobble.value = withSequence(
        withTiming(0.92, { duration: 90 }),
        withSpring(1, {
          damping: 8,
          stiffness: 240,
          mass: 0.5,
          overshootClamping: false,
        }),
      );
    }
  }, [isFocused, wobble]);

  const wobbleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: wobble.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        height: '100%',
        position: 'relative',
        alignItems: 'center',
      }}
    >
      {/* Raised Brand-Button — ragt RAISED_LIFT px über die Pille hinaus */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: -RAISED_LIFT,
            width: RAISED_SIZE,
            height: RAISED_SIZE,
            borderRadius: RAISED_SIZE / 2,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 3,
            borderColor: isFocused
              ? colors.secondary
              : colors.cardBackground,
            // Brand-getintete Schlagschatten — markiert den Button als
            // "premium/lifted" und matcht die alte Navigation
            shadowColor: colors.primary,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: colorScheme === 'dark' ? 0.45 : 0.32,
            shadowRadius: 10,
            elevation: 8,
          },
          wobbleStyle,
        ]}
      >
        <CustomIcon name="iconBlack" size={30} color="#ffffff" />
      </Animated.View>
      {/* Stöbern-Label unten in der Pille — direkt unter dem raised
          Button. Color shiftet auf primary wenn aktiv. */}
      <Text
        numberOfLines={1}
        style={{
          position: 'absolute',
          bottom: 8,
          fontSize: 10,
          fontFamily: 'Nunito_600SemiBold',
          color: isFocused ? colors.primary : colors.tabIconDefault,
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
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
