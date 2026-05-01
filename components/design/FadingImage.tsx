import React, { useState } from 'react';
import { Image, ImageProps, ImageSourcePropType, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const AnimatedImage = Animated.createAnimatedComponent(Image);

// ─── FadingImage — Image-Wrapper mit weichem Fade-In statt
//     Snap-In, sobald die Bytes geladen sind. Adressiert das
//     "Karten erscheinen, dann ploppen die Bilder rein"-Problem
//     auf Such-/Browse-Listen.
//
//     Verhalten:
//     • Bild startet mit opacity 0 — die `placeholderColor`
//       (default light surface-grey) füllt den Slot, sodass
//       nie ein sichtbar leerer Container entsteht.
//     • onLoad fired → opacity ramped 0 → 1 über 220 ms (out-cubic).
//     • Wenn `source` sich ändert (anderes Bild für dieselbe
//       Card-Slot, z.B. bei Re-Render mit anderem Produkt), wird
//       der Fade-State zurückgesetzt und neu gefadet.
//
//     Warum nicht Shimmer als Placeholder? Bei 6+ gleichzeitig
//     ladenden Karten wäre das Pulsieren visuell unruhig. Eine
//     statische Tönung ist ruhiger und reicht aus, weil das Bild
//     selbst sehr schnell faded und der Slot dadurch nie als
//     "kaputt" gelesen wird.
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
  // sourceKey lets us know when the URI changed → reset fade.
  const sourceKey =
    source && typeof source === 'object' && 'uri' in source
      ? (source.uri ?? '')
      : '';

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const opacity = useSharedValue(0);

  // Reset on source change (uri swap on the same mounted component).
  React.useEffect(() => {
    if (loadedKey !== sourceKey) {
      opacity.value = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

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
            setLoadedKey(sourceKey);
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
