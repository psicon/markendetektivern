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
import { router, useNavigation } from 'expo-router';
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
const STEPS: { icon: string; title: string; sub: string }[] = [
  {
    icon: 'camera-outline',
    title: 'Bon abfotografieren',
    sub: 'Direkt nach dem Einkauf',
  },
  {
    icon: 'auto-fix',
    title: 'Wir lesen ihn aus',
    sub: 'Markt, Datum, Artikel — automatisch',
  },
  {
    icon: 'cash-multiple',
    title: 'Cashback sammeln',
    sub: 'Ab 15 € auszahlen lassen',
  },
];

// Compact privacy/data block. Three rows = the legal minimum users
// need to see up-front (was an essay before, now one line each).
const PRIVACY: { icon: string; title: string; body: string }[] = [
  {
    icon: 'database-check-outline',
    title: 'Daten in der EU verarbeitet',
    body: 'Foto wird nach 30 Tagen gelöscht. Strukturierte Daten bleiben.',
  },
  {
    icon: 'shield-check-outline',
    title: 'DSGVO-konform',
    body: 'Auszahlung über unseren Partner Tremendous (PayPal, SEPA, Gutscheine).',
  },
  {
    icon: 'account-cancel-outline',
    title: 'Jederzeit widerrufbar',
    body: 'Bereits gesammeltes Guthaben bleibt auszahlbar.',
  },
];

export default function CashbackConsentScreen() {
  const { theme } = useTokens();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user, isAnonymous } = useAuth();

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
          router.replace('/cashback/capture');
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.uid]);

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
      setTimeout(() => router.replace('/cashback/capture'), 300);
    } catch (error: any) {
      console.warn('acceptCashbackConsent failed:', error);
      Alert.alert(
        'Speichern fehlgeschlagen',
        'Bitte prüfe deine Internetverbindung und versuch es erneut.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [user?.uid, isAnonymous]);

  const handleCancel = useCallback(() => router.back(), []);

  const chromeHeight = insets.top + DETAIL_HEADER_ROW_HEIGHT;
  const accent = theme.primary ?? '#0d8575';

  const styles = useMemo(
    () => ({
      // Hero — brand-teal gradient (same vector as the Cashback
      // hero on Belohnungen so this screen reads as part of that
      // family). Big "Bis zu …€" headline + 3 stat pills.
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
      pillRow: {
        flexDirection: 'row' as const,
        flexWrap: 'wrap' as const,
        gap: 6,
        marginTop: 14,
      },
      pill: {
        flexDirection: 'row' as const,
        alignItems: 'center' as const,
        gap: 5,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: 'rgba(255,255,255,0.22)',
      },
      pillText: {
        color: '#fff',
        fontSize: 11,
        fontFamily,
        fontWeight: fontWeight.bold as any,
        letterSpacing: 0.2,
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

      // Privacy block — same one-card-with-rows pattern as Profile.
      privacyCard: {
        marginHorizontal: 20,
        backgroundColor: theme.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
        overflow: 'hidden' as const,
      },
      privacyRow: {
        flexDirection: 'row' as const,
        alignItems: 'flex-start' as const,
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
      },
      privacyDivider: {
        height: 1,
        backgroundColor: theme.border ?? 'rgba(0,0,0,0.06)',
        marginLeft: 14 + 30 + 12,
      },
      privacyIconBox: {
        width: 30,
        height: 30,
        borderRadius: 8,
        backgroundColor: accent + '14',
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        marginTop: 1,
      },
      privacyTitle: {
        color: theme.text,
        fontSize: 13,
        fontFamily,
        fontWeight: fontWeight.bold as any,
      },
      privacyBody: {
        color: theme.textSub,
        fontSize: 11,
        lineHeight: 16,
        fontFamily,
        marginTop: 2,
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
        {/* Hero — value pitch + stat pills */}
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
          <Text style={styles.heroEyebrow}>Echtes Cashback in €</Text>
          <Text style={styles.heroTitle}>Hol dir Geld für deine Bons</Text>
          <Text style={styles.heroBody}>
            Bis zu 6 Bons pro Woche → bis zu rund 25 € im Jahr, nur fürs
            Hochladen. Plus extra für Produktbilder & Umfragen.
          </Text>

          <View style={styles.pillRow}>
            <View style={styles.pill}>
              <MaterialCommunityIcons name="receipt" size={11} color="#fff" />
              <Text style={styles.pillText}>0,08 € pro Bon</Text>
            </View>
            <View style={styles.pill}>
              <MaterialCommunityIcons
                name="calendar-week"
                size={11}
                color="#fff"
              />
              <Text style={styles.pillText}>6 Bons/Woche</Text>
            </View>
            <View style={styles.pill}>
              <MaterialCommunityIcons
                name="bank-transfer-out"
                size={11}
                color="#fff"
              />
              <Text style={styles.pillText}>Ab 15 € auszahlen</Text>
            </View>
          </View>
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
        <View style={styles.privacyCard}>
          {PRIVACY.map((row, idx) => (
            <View key={row.title}>
              {idx > 0 ? <View style={styles.privacyDivider} /> : null}
              <View style={styles.privacyRow}>
                <View style={styles.privacyIconBox}>
                  <MaterialCommunityIcons
                    name={row.icon as any}
                    size={16}
                    color={accent}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.privacyTitle}>{row.title}</Text>
                  <Text style={styles.privacyBody}>{row.body}</Text>
                </View>
              </View>
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
                {hasAccepted ? 'Gespeichert' : 'Akzeptieren & Bon scannen'}
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
