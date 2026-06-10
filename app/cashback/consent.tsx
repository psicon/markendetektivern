/**
 * Cashback consent — gate before any Bon upload.
 *
 * Design intent: pitch the value first ("hier kommt Geld zurück"),
 * walk through the 3-step flow visually, THEN cover the legal
 * minimums in a compact bullet list. Keeps users from bouncing on
 * a wall of DSGVO text.
 *
 * If consent is already valid (current version + recorded), the
 * mount effect routes straight to /cashback/capture so this screen
 * shows up exactly once.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  type ImageSourcePropType,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DETAIL_HEADER_ROW_HEIGHT,
  DetailHeader,
} from '@/components/design/DetailHeader';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import {
  acceptCashbackConsent,
  getCashbackConfig,
  hasValidCashbackConsent,
} from '@/lib/services/cashbackService';

const PRIVACY_URL = 'https://markendetektive.de/datenschutz';
const TERMS_URL = 'https://markendetektive.de/agb';

// Three-step "so einfach" flow — numbered circles + crisp labels.
// Concrete (not "wie magisch"), but the magic of the auto-OCR is the
// hero, so middle step is a tiny aha-moment.
// T17.29: "So einfach geht's"-Steps mit klarer Zeitachse — User wollte
// wissen "wann bekomme ich was?". Schritt 1+2 sind Aktionen, Schritt 3
// die Belohnung. Mit Hinweis dass Cashback automatisch gutgeschrieben
// wird sobald der Bon geprüft ist (meist Minuten).
const STEPS: { icon: string; title: string; sub: string }[] = [
  {
    icon: 'camera-outline',
    title: 'Foto vom Bon machen',
    sub: 'Direkt nach dem Einkauf',
  },
  {
    icon: 'auto-fix',
    title: 'Cashback wird gutgeschrieben',
    sub: 'Sobald der Bon geprüft ist — meist in wenigen Minuten',
  },
  {
    icon: 'gift-outline',
    title: 'Attraktive Prämien & Gutscheine',
    sub: 'Ab 10 € einlösen — Gutschein deiner Wahl oder Auszahlung aufs Konto',
  },
];

// Prämien-Katalog für den Auto-Marquee unter Schritt 3. `image` ist
// optional vorbereitet: sobald echte Logo-Assets definiert sind
// (kleine PNGs, ~32×32), hier eintragen — der Chip rendert dann das
// Bild statt des Icons. Bis dahin Icon + Label. Reihenfolge =
// Anzeige-Reihenfolge im Loop. "Oder spenden ❤" gehört bewusst dazu
// (User-Vorgabe 2026-06-10).
const REWARDS: {
  key: string;
  label: string;
  icon: string;
  image?: ImageSourcePropType;
  /** Abweichende Render-Größe für Wortmarken (Default 24×24). */
  imageWidth?: number;
  imageHeight?: number;
}[] = [
  {
    key: 'rewe',
    label: 'REWE',
    icon: 'cart-outline',
    image: require('@/assets/rewards/rewe.png'),
  },
  {
    key: 'kaufland',
    label: 'Kaufland',
    icon: 'cart-outline',
    image: require('@/assets/rewards/kaufland.png'),
  },
  {
    key: 'rossmann',
    label: 'Rossmann',
    icon: 'cart-outline',
    image: require('@/assets/rewards/rossmann.png'),
  },
  {
    key: 'amazon',
    label: 'Amazon',
    icon: 'shopping-outline',
    image: require('@/assets/rewards/amazon.png'),
  },
  {
    // Wortmarke sagt schon "VISA" — Label ergänzt nur "Prepaid".
    key: 'visa',
    label: 'Prepaid',
    icon: 'credit-card-outline',
    image: require('@/assets/rewards/visa.png'),
    imageWidth: 37,
    imageHeight: 12,
  },
  { key: 'bank', label: 'Bankkonto', icon: 'bank-outline' },
  { key: 'spende', label: 'Oder spenden', icon: 'hand-heart-outline' },
];

/**
 * Endlos durchlaufender Prämien-Strip (Reanimated 3, UI-Thread).
 * Zwei identische Chip-Reihen nebeneinander; translateX läuft linear
 * von 0 auf -Reihenbreite und springt nahtlos zurück → Endlos-Loop.
 * Nicht interaktiv — reine Appetit-Anzeige der Einlöse-Optionen.
 */
function RewardsMarquee({
  theme,
  accent,
}: {
  theme: any;
  accent: string;
}) {
  const [rowWidth, setRowWidth] = useState(0);
  const offset = useSharedValue(0);

  useEffect(() => {
    if (rowWidth > 0) {
      offset.value = 0;
      // ~33 px/s — gemütlich lesbar, nicht hektisch.
      offset.value = withRepeat(
        withTiming(-rowWidth, {
          duration: rowWidth * 30,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
    }
  }, [rowWidth, offset]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const chip = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
    marginRight: 10,
  };
  const label = {
    color: theme.text,
    fontSize: 13,
    fontFamily,
    fontWeight: fontWeight.bold as any,
  };

  const renderRow = (measure: boolean) => (
    <View
      style={{ flexDirection: 'row' }}
      onLayout={
        measure
          ? (e) => setRowWidth(Math.round(e.nativeEvent.layout.width))
          : undefined
      }
    >
      {REWARDS.map((item) => (
        <View key={item.key} style={chip}>
          {item.image ? (
            <Image
              source={item.image}
              style={{
                width: item.imageWidth ?? 24,
                height: item.imageHeight ?? 24,
                borderRadius: 5,
              }}
              resizeMode="contain"
            />
          ) : (
            <MaterialCommunityIcons
              name={item.icon as any}
              size={18}
              color={accent}
            />
          )}
          <Text style={label}>{item.label}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={{ overflow: 'hidden', marginTop: 12 }}>
      <Animated.View style={[{ flexDirection: 'row' }, animatedStyle]}>
        {renderRow(true)}
        {renderRow(false)}
      </Animated.View>
    </View>
  );
}

// Trust-Badges — sitzen DIREKT über dem Akzeptieren-Button (Best
// Practice: Safety-Signale am Entscheidungspunkt, nicht als eigene
// Listen-Sektion). Nur Headlines (User-Vorgabe 2026-06-10), die
// Langfassung steht in Datenschutzerklärung + AGB (Links darüber).
// v2.0 (ClickUp 86ca6u6xd): "Anonyme Marktdaten" = anonymisierte
// Verwertung von Einkaufs- + Nutzungsdaten (B2B-Insights). Ob
// Headline-only für die "informierte" Einwilligung reicht → Anwalt.
const TRUST: { icon: string; label: string }[] = [
  { icon: 'shield-check-outline', label: 'EU-Datenschutz' },
  { icon: 'chart-box-outline', label: 'Anonyme Marktdaten' },
  { icon: 'account-cancel-outline', label: 'Jederzeit widerrufbar' },
];

export default function CashbackConsentScreen() {
  const { theme } = useTokens();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user, isAnonymous } = useAuth();
  // from=settings (Profil-Toggle, ClickUp 86ca6u6xd [5]): nach Accept
  // zurück zu den Einstellungen statt in den Kamera-Flow.
  const params = useLocalSearchParams<{ from?: string }>();
  const fromSettings = params.from === 'settings';

  const [, setConsentVersion] = useState<string>('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [hasAccepted, setHasAccepted] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const config = await getCashbackConfig();
      if (!alive) return;
      setConsentVersion(config.consentVersion);
      if (user?.uid) {
        const valid = await hasValidCashbackConsent(user.uid);
        if (alive && valid) {
          // Aus den Einstellungen kommend gibt es keinen Auto-Sprung
          // in den Kamera-Flow — Consent ist schon da, zurück.
          if (fromSettings) {
            router.back();
          } else {
            router.replace('/cashback/capture');
          }
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.uid, fromSettings]);

  const handleAccept = useCallback(async () => {
    if (!user?.uid) {
      Alert.alert(
        'Bitte erst anmelden',
        'Cashback ist nur für angemeldete Konten verfügbar.',
        [
          { text: 'Abbrechen', style: 'cancel' },
          { text: 'Zum Login', onPress: () => router.push('/auth/login') },
        ],
      );
      return;
    }
    if (isAnonymous) {
      Alert.alert(
        'Konto erforderlich',
        'Für Cashback brauchst du ein vollständiges Konto.',
        [
          { text: 'Abbrechen', style: 'cancel' },
          { text: 'Konto erstellen', onPress: () => router.push('/auth/register') },
        ],
      );
      return;
    }

    setSubmitting(true);
    try {
      await acceptCashbackConsent(user.uid);
      setHasAccepted(true);
      setTimeout(() => {
        if (fromSettings) {
          router.back();
        } else {
          router.replace('/cashback/capture');
        }
      }, 300);
    } catch (error: any) {
      console.warn('acceptCashbackConsent failed:', error);
      Alert.alert(
        'Speichern fehlgeschlagen',
        'Bitte prüfe deine Internetverbindung und versuch es erneut.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [user?.uid, isAnonymous, fromSettings]);

  const handleCancel = useCallback(() => router.back(), []);

  const chromeHeight = insets.top + DETAIL_HEADER_ROW_HEIGHT;
  const accent = theme.primary ?? '#0d8575';

  const styles = useMemo(
    () => ({
      // Hero — brand-teal gradient (same vector as the Cashback
      // hero on Belohnungen so this screen reads as part of that
      // family). Big headline, Konditionen bewusst ohne harte Zahlen.
      hero: {
        marginHorizontal: 20,
        marginTop: 6,
        borderRadius: 18,
        paddingHorizontal: 18,
        paddingVertical: 18,
        overflow: 'hidden' as const,
      },
      heroIcon: {
        width: 48,
        height: 48,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.22)',
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
      },
      heroEyebrow: {
        color: 'rgba(255,255,255,0.85)',
        fontSize: 11,
        fontFamily,
        fontWeight: fontWeight.bold as any,
        letterSpacing: 0.8,
        textTransform: 'uppercase' as const,
        marginTop: 14,
      },
      heroTitle: {
        color: '#fff',
        fontSize: 24,
        fontFamily,
        fontWeight: fontWeight.extraBold as any,
        letterSpacing: -0.4,
        marginTop: 4,
      },
      heroBody: {
        color: 'rgba(255,255,255,0.92)',
        fontSize: 13,
        lineHeight: 19,
        fontFamily,
        marginTop: 6,
      },
      sectionLabel: {
        color: theme.textMuted,
        fontSize: 11,
        fontFamily,
        fontWeight: fontWeight.bold as any,
        letterSpacing: 0.7,
        textTransform: 'uppercase' as const,
        marginHorizontal: 20,
        marginTop: 22,
        marginBottom: 10,
      },

      // Step row — circle with the step number + title + sub. Three
      // of these stacked, no card chrome — keeps the page airy.
      stepRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 12,
        paddingHorizontal: 20,
        paddingVertical: 8,
      },
      stepCircle: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: accent + '18',
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        position: 'relative' as const,
      },
      stepNumber: {
        position: 'absolute' as const,
        top: -4,
        right: -4,
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: accent,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
      },
      stepNumberText: {
        color: '#fff',
        fontSize: 10,
        fontFamily,
        fontWeight: fontWeight.extraBold as any,
      },
      stepTitle: {
        color: theme.text,
        fontSize: 14,
        fontFamily,
        fontWeight: fontWeight.bold as any,
      },
      stepSub: {
        color: theme.textSub,
        fontSize: 12,
        fontFamily,
        marginTop: 2,
      },

      // Trust-Badges über dem CTA — drei gleichbreite Icon-Spalten,
      // bewusst ohne Karten-Chrome (Tonalität der Step-Kreise).
      trustRow: {
        flexDirection: 'row' as const,
        alignItems: 'flex-start' as const,
        paddingHorizontal: 4,
        paddingTop: 4,
        paddingBottom: 6,
      },
      trustItem: {
        flex: 1,
        alignItems: 'center' as const,
        gap: 3,
      },
      trustLabel: {
        color: theme.textSub,
        fontSize: 10,
        fontFamily,
        fontWeight: fontWeight.semibold as any,
        textAlign: 'center' as const,
      },
      // Klein + zentriert ganz unten im Footer, unter "Jetzt nicht".
      legalText: {
        marginTop: 2,
        paddingHorizontal: 8,
        color: theme.textMuted,
        fontSize: 10,
        lineHeight: 14,
        fontFamily,
        textAlign: 'center' as const,
      },
      legalLink: {
        color: accent,
        textDecorationLine: 'underline' as const,
      },

      footer: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: insets.bottom + 12,
        gap: 6,
        borderTopWidth: 1,
        borderTopColor: theme.border ?? 'rgba(0,0,0,0.06)',
        backgroundColor: theme.bg,
      },
      acceptButton: {
        backgroundColor: accent,
        borderRadius: 14,
        height: 52,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        flexDirection: 'row' as const,
        gap: 8,
        opacity: isSubmitting ? 0.7 : 1,
      },
      acceptText: {
        color: '#fff',
        fontFamily,
        fontWeight: fontWeight.extraBold as any,
        fontSize: 15,
        letterSpacing: 0.2,
      },
      cancelText: {
        color: theme.textSub,
        fontFamily,
        fontSize: 13,
        textAlign: 'center' as const,
        paddingVertical: 8,
      },
    }),
    [theme, accent, insets.bottom, isSubmitting],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Cashback" onBack={handleCancel} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: chromeHeight + 4,
          paddingBottom: 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — value pitch */}
        <LinearGradient
          colors={['#0a6f62', '#0d8575', '#10a18a']}
          start={{ x: -1, y: 0.34 }}
          end={{ x: 1, y: -0.34 }}
          style={styles.hero}
        >
          <View style={styles.heroIcon}>
            <MaterialCommunityIcons
              name="cash-multiple"
              size={24}
              color="#fff"
            />
          </View>
          <Text style={styles.heroEyebrow}>Geld zurück fürs Einkaufen</Text>
          <Text style={styles.heroTitle}>Hol dir Geld für deine Bons</Text>
          {/* Keine hardcodierten Konditionen (Cent-Beträge, Wochen-Limits)
              — die sind config-/aktionsgetrieben und würden hier veralten.
              Einzige stabile Aussage: bis zu 1 € pro Bon (User-Vorgabe
              2026-06-10). Aktuelle Aktionen zeigt der Rewards-Tab. */}
          <Text style={styles.heroBody}>
            Lade deine Kassenbons hoch und sichere dir bis zu 1 € pro Bon —
            die aktuellen Aktionen siehst du in der App.
          </Text>
        </LinearGradient>

        {/* So einfach geht's */}
        <Text style={styles.sectionLabel}>So einfach geht's</Text>
        <View>
          {STEPS.map((step, idx) => (
            <View key={step.title} style={styles.stepRow}>
              <View style={styles.stepCircle}>
                <MaterialCommunityIcons
                  name={step.icon as any}
                  size={18}
                  color={accent}
                />
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>{idx + 1}</Text>
                </View>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepSub}>{step.sub}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Prämien-Marquee — die Einlöse-Optionen laufen als Appetit-
            Strip unter Schritt 3 durch (REWE/Kaufland/Rossmann/Amazon/
            VISA/Bankkonto/Spenden). */}
        <RewardsMarquee theme={theme} accent={accent} />
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting || hasAccepted}
          style={styles.acceptButton}
          onPress={handleAccept}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <MaterialCommunityIcons
                name={hasAccepted ? 'check-circle' : 'arrow-right-circle'}
                size={18}
                color="#fff"
              />
              <Text style={styles.acceptText}>
                {hasAccepted
                  ? 'Gespeichert'
                  : fromSettings
                    ? 'Akzeptieren'
                    : 'Akzeptieren & Bon scannen'}
              </Text>
            </>
          )}
        </Pressable>

        <Pressable accessibilityRole="button" onPress={handleCancel}>
          <Text style={styles.cancelText}>Jetzt nicht</Text>
        </Pressable>

        {/* Trust-Badges UNTER den Buttons (User-Vorgabe 2026-06-10:
            nicht vom Akzeptieren ablenken) — drei dezente Icon-
            Spalten, gleiche Tonalität wie die Step-Kreise. */}
        <View style={styles.trustRow}>
          {TRUST.map((item) => (
            <View key={item.label} style={styles.trustItem}>
              <MaterialCommunityIcons
                name={item.icon as any}
                size={16}
                color={accent}
              />
              <Text style={styles.trustLabel}>{item.label}</Text>
            </View>
          ))}
        </View>

        {/* Legal-Zeile ganz unten, klein unter "Jetzt nicht"
            (User-Vorgabe 2026-06-10). */}
        <Text style={styles.legalText}>
          Mit "Akzeptieren" stimmst du unseren{' '}
          <Text
            style={styles.legalLink}
            onPress={() => Linking.openURL(TERMS_URL)}
          >
            AGB
          </Text>
          {' '}und der{' '}
          <Text
            style={styles.legalLink}
            onPress={() => Linking.openURL(PRIVACY_URL)}
          >
            Datenschutzerklärung
          </Text>
          {' '}zu.
        </Text>
      </View>
    </View>
  );
}
