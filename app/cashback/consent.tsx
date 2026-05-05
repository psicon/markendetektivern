/**
 * Cashback consent — gate before any Bon upload.
 *
 * Kept short on purpose: a long DSGVO essay drives users away. The
 * regulator wants the user to know (a) what data is processed, (b)
 * the legal basis, (c) where to read more — three bullets + a link
 * to the full Datenschutzerklärung covers that.
 *
 * If the user already accepted (valid version + timestamp), we skip
 * straight to /cashback/capture in the mount effect — they don't see
 * this screen on second-and-onwards taps.
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

// Three plain-language bullets — the legal minimum, not marketing.
// Order: WHAT we do → WHAT we keep → HOW you opt out.
const BULLETS: { icon: string; title: string; body: string }[] = [
  {
    icon: 'camera-outline',
    title: 'Bon-Foto wird ausgelesen',
    body: 'Filiale, Datum und Artikel werden aus deinem Foto extrahiert.',
  },
  {
    icon: 'database-check-outline',
    title: 'Bild wird nach 30 Tagen gelöscht',
    body: 'Die strukturierten Daten bleiben gespeichert, das Foto nicht.',
  },
  {
    icon: 'account-cancel-outline',
    title: 'Jederzeit widerrufbar',
    body: 'Bereits gesammeltes Cashback bleibt auszahlbar.',
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

  // Skip the screen entirely if consent is already valid + current.
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
      hero: {
        marginHorizontal: 20,
        marginTop: 6,
        borderRadius: 18,
        paddingHorizontal: 18,
        paddingVertical: 22,
        overflow: 'hidden' as const,
      },
      heroIcon: {
        width: 44,
        height: 44,
        borderRadius: 12,
        backgroundColor: 'rgba(255,255,255,0.22)',
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
      },
      heroTitle: {
        color: '#fff',
        fontSize: 20,
        fontFamily,
        fontWeight: fontWeight.extraBold as any,
        letterSpacing: -0.3,
        marginTop: 14,
      },
      heroBody: {
        color: 'rgba(255,255,255,0.92)',
        fontSize: 13,
        lineHeight: 19,
        fontFamily,
        marginTop: 6,
      },
      bulletList: {
        marginTop: 18,
        marginHorizontal: 20,
        backgroundColor: theme.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
        overflow: 'hidden' as const,
      },
      bulletRow: {
        flexDirection: 'row' as const,
        alignItems: 'flex-start' as const,
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
      },
      bulletDivider: {
        height: 1,
        backgroundColor: theme.border ?? 'rgba(0,0,0,0.06)',
        marginLeft: 14 + 32 + 12, // align under text, after icon column
      },
      bulletIconBox: {
        width: 32,
        height: 32,
        borderRadius: 8,
        backgroundColor: accent + '18',
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        marginTop: 1,
      },
      bulletTitle: {
        color: theme.text,
        fontSize: 14,
        fontFamily,
        fontWeight: fontWeight.bold as any,
      },
      bulletBody: {
        color: theme.textSub,
        fontSize: 12,
        lineHeight: 17,
        fontFamily,
        marginTop: 2,
      },
      legalText: {
        marginTop: 16,
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
        gap: 8,
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
        <LinearGradient
          colors={['#0a6f62', '#0d8575', '#10a18a']}
          start={{ x: -1, y: 0.34 }}
          end={{ x: 1, y: -0.34 }}
          style={styles.hero}
        >
          <View style={styles.heroIcon}>
            <MaterialCommunityIcons
              name="cash-multiple"
              size={22}
              color="#fff"
            />
          </View>
          <Text style={styles.heroTitle}>Cashback freischalten</Text>
          <Text style={styles.heroBody}>
            Bon hochladen, automatisch auswerten lassen, ab 15 € auszahlen.
          </Text>
        </LinearGradient>

        <View style={styles.bulletList}>
          {BULLETS.map((bullet, idx) => (
            <View key={bullet.title}>
              {idx > 0 ? <View style={styles.bulletDivider} /> : null}
              <View style={styles.bulletRow}>
                <View style={styles.bulletIconBox}>
                  <MaterialCommunityIcons
                    name={bullet.icon as any}
                    size={17}
                    color={accent}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.bulletTitle}>{bullet.title}</Text>
                  <Text style={styles.bulletBody}>{bullet.body}</Text>
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
          {' '}zu. Verarbeitung in der EU. Auszahlung über Tremendous.
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
                {hasAccepted ? 'Gespeichert' : 'Akzeptieren & weiter'}
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
