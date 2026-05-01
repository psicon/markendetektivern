import React, { useEffect } from 'react';
import { Image, ImageProps, ImageSourcePropType, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const AnimatedImage = Animated.createAnimatedComponent(Image);

// ─── FadingImage — Image-Wrapper mit weichem Fade-In statt
//     hartem Snap, sobald die Bytes geladen sind. Adressiert das
//     "Karten erscheinen, dann ploppen die Bilder rein"-Problem
//     auf Such-/Browse-Listen.
//
//     Verhalten:
//     • Bild startet mit opacity 0; der `placeholderColor`-View
//       hinter dem Bild füllt den Slot bis zum Load.
//     • onLoad fired → opacity ramped 0 → 1 über 220 ms (out-cubic).
//     • Wenn die URI sich ändert (selber Card-Slot bekommt anderes
//       Produkt im List-Reordering / Re-Search), wird die Opacity
//       SOFORT auf 0 zurückgesetzt — das nächste onLoad fired den
//       Fade neu.
//
//     Performance-Notizen (warum so minimal):
//     • Keine React-State (kein useState/setLoadedKey), kein Re-
//       Render der Komponente bei Image-Load. Nur ein UI-Thread-
//       Worklet-Update via Reanimated. Wichtig im Stöbern-Grid wo
//       20+ Cards gleichzeitig laden können — jeder unnötige Re-
//       Render verstärkt sonst Scroll-Jank.
//     • Der useAnimatedStyle ist memoiziert auf shared value;
//       läuft nur wenn sich der Wert ändert (nicht pro Render).
//     • Container ist ein einziger `<View>` mit `placeholderColor`
//       als Background — keine zweite View-Layer für den
//       Placeholder, das spart ein Element pro Card.
//     • Statische Tönung statt Shimmer: bei 6+ gleichzeitig
//       ladenden Karten wäre Shimmer visuell unruhig.
// ───

type FadingImageProps = Omit<ImageProps, 'source' | 'onLoad'> & {
  source: ImageSourcePropType | null | undefined;
  /** Background of the slot while loading. Default: light grey. */
  placeholderColor?: string;
  /** Children rendered on top of image (e.g. badges). */
  children?: React.ReactNode;
  containerStyle?: ViewStyle;
};

export function FadingImage({
  source,
  placeholderColor = '#f1f3f5',
  children,
  containerStyle,
  style,
  ...rest
}: FadingImageProps) {
  const sourceKey =
    source && typeof source === 'object' && 'uri' in source
      ? (source.uri ?? '')
      : '';

  const opacity = useSharedValue(0);

  // URI-Wechsel im selben Slot → Fade resetten. useEffect läuft
  // ausschließlich wenn sich sourceKey ändert (deps-Vergleich
  // string-equality), kein Render-Overhead pro Frame.
  useEffect(() => {
    opacity.value = 0;
  }, [sourceKey, opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <View
      style={[
        { width: '100%', height: '100%', backgroundColor: placeholderColor },
        containerStyle,
      ]}
    >
      {source ? (
        <AnimatedImage
          {...rest}
          source={source}
          onLoad={() => {
            opacity.value = withTiming(1, {
              duration: 220,
              easing: Easing.out(Easing.cubic),
            });
          }}
          style={[
            { width: '100%', height: '100%' },
            style as object,
            animStyle,
          ]}
        />
      ) : null}
      {children}
    </View>
  );
}
