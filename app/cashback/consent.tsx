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
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
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
  /** Abweichende Render-Größe für Wortmarken (Default 30×30). */
  imageWidth?: number;
  imageHeight?: number;
  /** Einkaufsgutschein-Partner → kleines schräges Ticket-Badge überm Logo. */
  voucher?: boolean;
}[] = [
  {
    key: 'rewe',
    label: 'REWE',
    icon: 'cart-outline',
    image: require('@/assets/rewards/rewe.png'),
    voucher: true,
  },
  {
    key: 'kaufland',
    label: 'Kaufland',
    icon: 'cart-outline',
    image: require('@/assets/rewards/kaufland.png'),
    voucher: true,
  },
  {
    key: 'rossmann',
    label: 'Rossmann',
    icon: 'cart-outline',
    image: require('@/assets/rewards/rossmann.png'),
    voucher: true,
  },
  {
    key: 'amazon',
    label: 'Amazon',
    icon: 'shopping-outline',
    image: require('@/assets/rewards/amazon.png'),
    voucher: true,
  },
  {
    // Wortmarke sagt schon "VISA" — Label ergänzt nur "Prepaid".
    key: 'visa',
    label: 'VISA Prepaid',
    icon: 'credit-card-outline',
    image: require('@/assets/rewards/visa.png'),
    imageWidth: 52,
    imageHeight: 17,
  },
  {
    key: 'paypal',
    label: 'PayPal',
    icon: 'wallet-outline',
    image: require('@/assets/rewards/paypal.png'),
  },
  { key: 'bank', label: 'Bankkonto', icon: 'bank-outline' },
  { key: 'spende', label: 'Oder spenden', icon: 'hand-heart-outline' },
  { key: 'mehr', label: 'und viele mehr', icon: 'dots-horizontal' },
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
  compact,
}: {
  theme: any;
  accent: string;
  compact: boolean;
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

  // Leichter Shimmer auf den Logos (User-Vorgabe 2026-06-10):
  // sanfter Opacity-Puls im Tempo des Skeleton-Shimmers — lebendig,
  // ohne unruhig zu werden.
  const shine = useSharedValue(0);
  useEffect(() => {
    shine.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1200, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [shine]);
  const shineStyle = useAnimatedStyle(() => ({
    opacity: 0.78 + shine.value * 0.22,
  }));

  // Logo-Strip statt Chip-Pills: jedes Item ist eine schmale Spalte
  // (Logo bzw. Icon oben, dezente 10px-Caption darunter) — die
  // "Partner-Logos"-Optik aus Fintech-/Cashback-Apps. Keine Rahmen,
  // keine Button-Anmutung.
  const itemColumn = {
    width: 84,
    alignItems: 'center' as const,
    gap: 5,
  };
  const logoBox = {
    width: 56,
    height: 38,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  };
  // Kleines, schräg gestelltes Gutschein-Ticket in Primary — sitzt
  // in der oberen Ecke über den Einkaufsgutschein-Logos.
  const voucherBadge = {
    position: 'absolute' as const,
    top: -6,
    right: -2,
    width: 21,
    height: 21,
    borderRadius: 10.5,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    transform: [{ rotate: '-18deg' }],
  };
  const caption = {
    color: theme.textSub,
    fontSize: 10,
    fontFamily,
    fontWeight: fontWeight.semibold as any,
    textAlign: 'center' as const,
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
        <View key={item.key} style={itemColumn}>
          <Animated.View style={[logoBox, shineStyle]}>
            {item.image ? (
              <Image
                source={item.image}
                style={{
                  width: item.imageWidth ?? 30,
                  height: item.imageHeight ?? 30,
                  borderRadius: 6,
                }}
                resizeMode="contain"
              />
            ) : (
              <MaterialCommunityIcons
                name={item.icon as any}
                size={26}
                color={accent}
              />
            )}
            {item.voucher ? (
              <View style={voucherBadge}>
                <MaterialCommunityIcons
                  name="ticket-percent"
                  size={13}
                  color={accent}
                />
              </View>
            ) : null}
          </Animated.View>
          <Text style={caption} numberOfLines={1}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={{ overflow: 'hidden' }}>
      <Animated.View style={[{ flexDirection: 'row' }, animatedStyle]}>
        {renderRow(true)}
        {renderRow(false)}
      </Animated.View>
      {/* Edge-Fades — der Loop taucht weich aus dem Seitenhintergrund
          auf statt hart an der Kante zu schneiden. */}
      <LinearGradient
        colors={[theme.bg, `${theme.bg}00`]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 32,
        }}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[`${theme.bg}00`, theme.bg]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 32,
        }}
        pointerEvents="none"
      />
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
  // Kompakt-Modus für kleine Displays (iPhone SE-Klasse): engere
  // Paddings, damit Hero + alle 3 Steps ohne Scrollen sichtbar sind.
  const { height: winHeight } = useWindowDimensions();
  const compact = winHeight < 700;
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
        marginTop: 4,
        borderRadius: 18,
        paddingHorizontal: 18,
        paddingVertical: 12,
        overflow: 'hidden' as const,
      },
      heroIcon: {
        width: 38,
        height: 38,
        borderRadius: 12,
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
        marginTop: compact ? 8 : 9,
      },
      heroTitle: {
        color: '#fff',
        fontSize: compact ? 21 : 24,
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
        marginTop: 0,
        marginBottom: compact ? 6 : 10,
      },

      // Step row — circle with the step number + title + sub. Three
      // of these stacked, no card chrome — keeps the page airy.
      stepsCard: {
        marginHorizontal: 20,
        backgroundColor: theme.surface,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
        paddingHorizontal: 14,
        paddingVertical: compact ? 8 : 10,
      },
      stepRow: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 12,
        paddingHorizontal: 4,
        paddingVertical: compact ? 4 : 6,
      },
      // Timeline-Segment zwischen den Step-Kreisen (Kreis 38px,
      // Zentrum bei 4 + 19 = 23 -> Linie bei 22).
      stepConnector: {
        width: 2,
        height: compact ? 8 : 12,
        backgroundColor: `${accent}30`,
        marginLeft: 22,
        borderRadius: 1,
      },
      heroPill: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        backgroundColor: 'rgba(255,255,255,0.22)',
      },
      heroPillText: {
        color: '#fff',
        fontSize: 10,
        fontFamily,
        fontWeight: fontWeight.extraBold as any,
        letterSpacing: 0.4,
      },
      marqueeLabel: {
        color: theme.textMuted,
        fontSize: 11,
        fontFamily,
        fontWeight: fontWeight.bold as any,
        letterSpacing: 0.7,
        textTransform: 'uppercase' as const,
        textAlign: 'center' as const,
        marginBottom: compact ? 5 : 8,
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
        paddingTop: compact ? 2 : 4,
        paddingBottom: compact ? 3 : 6,
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
        paddingTop: compact ? 8 : 10,
        paddingBottom: insets.bottom + (compact ? 6 : 10),
        gap: compact ? 4 : 6,
        borderTopWidth: 1,
        borderTopColor: theme.border ?? 'rgba(0,0,0,0.06)',
        backgroundColor: theme.bg,
      },
      acceptButton: {
        backgroundColor: accent,
        borderRadius: 14,
        height: compact ? 48 : 52,
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
        paddingVertical: compact ? 5 : 8,
      },
    }),
    [theme, accent, insets.bottom, isSubmitting, compact],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Cashback" onBack={handleCancel} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: chromeHeight + 4,
          paddingBottom: compact ? 16 : 24,
          // Auf hohen Displays (Pro Max/Plus) waechst der Content auf
          // die volle Viewport-Hoehe; die flexiblen Spacer zwischen
          // den Sektionen verteilen den Ueberschuss gleichmaessig,
          // statt ihn als Loch vorm Footer zu sammeln. Auf kleinen
          // Displays kollabieren die Spacer auf ihre minHeight.
          flexGrow: 1,
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
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons
                name="cash-multiple"
                size={20}
                color="#fff"
              />
            </View>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                gap: 6,
                flexShrink: 1,
              }}
            >
              <View style={styles.heroPill}>
                <MaterialCommunityIcons name="cash" size={11} color="#ffd44b" />
                <Text style={styles.heroPillText}>Bis zu 1 € pro Bon</Text>
              </View>
              <View style={styles.heroPill}>
                <MaterialCommunityIcons name="gift-outline" size={11} color="#ffd44b" />
                <Text style={styles.heroPillText}>Ab 10 € einlösbar</Text>
              </View>
            </View>
          </View>
          <Text style={styles.heroEyebrow}>Geld zurück fürs Einkaufen</Text>
          <Text style={styles.heroTitle}>Hol dir Geld für deine Bons</Text>
          {/* Keine hardcodierten Konditionen (Cent-Beträge, Wochen-Limits)
              — die sind config-/aktionsgetrieben und würden hier veralten.
              Einzige stabile Aussage: bis zu 1 € pro Bon (User-Vorgabe
              2026-06-10). Aktuelle Aktionen zeigt der Rewards-Tab. */}
          <Text style={styles.heroBody}>
            Bon fotografieren, hochladen, kassieren — die aktuellen Aktionen
            siehst du in der App.
          </Text>
        </LinearGradient>

        <View style={{ flexGrow: 1, minHeight: compact ? 10 : 14 }} />

        {/* So einfach geht's — Surface-Card mit Timeline-Linie
            zwischen den Step-Kreisen (Design-System: Card radius 18,
            Border, shadows.sm wie die Belohnungen-Cards). */}
        <Text style={styles.sectionLabel}>So einfach geht's</Text>
        <View style={styles.stepsCard}>
          {STEPS.map((step, idx) => (
            <View key={step.title}>
            {idx > 0 ? <View style={styles.stepConnector} /> : null}
            <View style={styles.stepRow}>
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
            </View>
          ))}
        </View>

        <View style={{ flexGrow: 1, minHeight: compact ? 8 : 12 }} />

        {/* Prämien-Marquee mit eigenem Label — die Einlöse-Optionen
            haengen nicht mehr beziehungslos im Raum. */}
        <Text style={styles.marqueeLabel}>Einlösbar bei</Text>
        <RewardsMarquee theme={theme} accent={accent} compact={compact} />

        <View style={{ flexGrow: 1.4, minHeight: 4 }} />
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
        <Text
          style={styles.legalText}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.82}
        >
          Mit "Akzeptieren" stimmst du{' '}
          <Text
            style={styles.legalLink}
            onPress={() => Linking.openURL(TERMS_URL)}
          >
            AGB
          </Text>
          {' '}&{' '}
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
