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
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
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
    title: 'Ab 10 € einlösen',
    sub: 'Gutschein deiner Wahl oder Auszahlung aufs Konto',
  },
];

// Compact privacy/data block — NUR Headlines, kein Kleingedrucktes
// (User-Vorgabe 2026-06-10: "lass nur die fetten schriften").
// Die Langfassung steht in Datenschutzerklärung + AGB, die der User
// über die Links unten mitakzeptiert. v2.0 (ClickUp 86ca6u6xd):
// "Anonyme Marktdaten" = die anonymisierte Verwertung von Einkaufs-
// + Nutzungsdaten (B2B-Insights). Hinweis: ob Headline-only für die
// "informierte" Einwilligung reicht, liegt beim Anwalts-Review.
const PRIVACY: { icon: string; title: string }[] = [
  {
    icon: 'database-check-outline',
    title: 'Daten in der EU verarbeitet',
  },
  {
    icon: 'chart-box-outline',
    title: 'Anonyme Marktdaten',
  },
  {
    icon: 'gift-outline',
    title: 'Attraktive Prämien und Gutscheine',
  },
  {
    icon: 'account-cancel-outline',
    title: 'Jederzeit widerrufbar',
  },
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

      // Privacy block — 2x2-Chip-Grid (Design-System: surface-Chips,
      // radius 12 wie Such-Input/SegmentedTabs, getönter Icon-Kreis).
      privacyGrid: {
        marginHorizontal: 20,
        flexDirection: 'row' as const,
        flexWrap: 'wrap' as const,
        gap: 8,
      },
      privacyChip: {
        flexGrow: 1,
        flexBasis: '46%' as const,
        minHeight: 46,
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
      },
      privacyIconBox: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: accent + '14',
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
      },
      privacyTitle: {
        flex: 1,
        color: theme.text,
        fontSize: 12,
        lineHeight: 16,
        fontFamily,
        fontWeight: fontWeight.bold as any,
      },
      legalText: {
        marginTop: 14,
        marginHorizontal: 20,
        color: theme.textMuted,
        fontSize: 11,
        lineHeight: 16,
        fontFamily,
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

        {/* Privacy / Data — same card-with-rows pattern as Profile */}
        <Text style={styles.sectionLabel}>Daten & Auszahlung</Text>
        {/* 2x2-Chip-Grid statt Karte-mit-Trennlinien: Headline-only-Rows
            sahen in der Karte verloren aus (Leerraum rechts, eingerückte
            Divider). Chips = Design-System-Sprache (surface, radius 12,
            getönter Icon-Kreis), Icon + Text vertikal zentriert. */}
        <View style={styles.privacyGrid}>
          {PRIVACY.map((row) => (
            <View key={row.title} style={styles.privacyChip}>
              <View style={styles.privacyIconBox}>
                <MaterialCommunityIcons
                  name={row.icon as any}
                  size={14}
                  color={accent}
                />
              </View>
              <Text style={styles.privacyTitle}>{row.title}</Text>
            </View>
          ))}
        </View>

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
      </View>
    </View>
  );
}
