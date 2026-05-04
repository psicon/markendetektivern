/**
 * Cashback consent screen — gate for the cashback flow.
 *
 * User MUST accept here before they can upload any Bons. Consent
 * is recorded with timestamp + version + appVersion to /users/{uid}.
 *
 * UX:
 *  - DetailHeader with back button (cancel = navigate back)
 *  - Hero gradient block explaining the value
 *  - Bullet list with what they're agreeing to (DSGVO §13 minimum)
 *  - "Akzeptieren & weiter" CTA → records consent → routes to /cashback/capture
 *  - "Abbrechen" link → router.back()
 *
 * No emojis in body unless requested. We use MaterialCommunityIcons
 * to stay consistent with the rest of the app.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useNavigation } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import {
  acceptCashbackConsent,
  getCashbackConfig,
  hasValidCashbackConsent,
} from '@/lib/services/cashbackService';

const PRIVACY_URL = 'https://markendetektive.de/datenschutz';
const TERMS_URL = 'https://markendetektive.de/agb';

const BULLETS: { icon: string; title: string; body: string }[] = [
  {
    icon: 'camera-outline',
    title: 'Bon-Foto wird verarbeitet',
    body:
      'Du machst ein Foto deines Kassenbons. Wir senden es verschlüsselt an unseren OCR-Service, um Filiale, Datum und Artikel auszulesen.',
  },
  {
    icon: 'database-check-outline',
    title: 'Wir speichern strukturierte Daten',
    body:
      'Wir speichern Filiale, Datum, gekaufte Produkte und den Endbetrag. Das Bon-Bild selbst wird nach 30 Tagen automatisch gelöscht.',
  },
  {
    icon: 'shield-check-outline',
    title: 'Betrugsschutz',
    body:
      'Wir prüfen Bons automatisch auf Manipulation, Doppel-Uploads und KI-generierte Fakes. Bei Auffälligkeiten halten wir die Auszahlung an.',
  },
  {
    icon: 'cash-multiple',
    title: 'Auszahlung über Tremendous',
    body:
      'Ab 15 € Cashback-Guthaben kannst du dir das Geld via PayPal, SEPA oder Gutschein auszahlen lassen. Steuerliche Pflichten liegen bei dir.',
  },
  {
    icon: 'account-cancel-outline',
    title: 'Du behältst die Kontrolle',
    body:
      'Du kannst deine Einwilligung jederzeit widerrufen. Bereits gesammeltes Guthaben bleibt erhalten und ist auszahlbar.',
  },
];

export default function CashbackConsentScreen() {
  const { theme, shadows } = useTokens();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user, isAnonymous } = useAuth();

  const [consentVersion, setConsentVersion] = useState<string>('…');
  const [isSubmitting, setSubmitting] = useState(false);
  const [hasAccepted, setHasAccepted] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Read the current config + existing consent status.
  useEffect(() => {
    let alive = true;
    (async () => {
      const config = await getCashbackConfig();
      if (!alive) return;
      setConsentVersion(config.consentVersion);

      if (user?.uid) {
        const valid = await hasValidCashbackConsent(user.uid);
        if (alive && valid) {
          // Already consented — go straight to capture.
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
        'Cashback ist nur für angemeldete Konten verfügbar. Logge dich ein oder erstelle ein Konto, um mitzumachen.',
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
        'Cashback brauchst du ein vollständiges Konto. Bei einer anonymen Sitzung ist eine Auszahlung nicht möglich.',
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
      // Forward to the capture screen now that consent landed.
      setTimeout(() => {
        router.replace('/cashback/capture');
      }, 350);
    } catch (error: any) {
      console.warn('⚠️ acceptCashbackConsent failed:', error);
      Alert.alert(
        'Speichern fehlgeschlagen',
        'Wir konnten deine Einwilligung gerade nicht speichern. Bitte prüfe deine Internetverbindung und versuch es erneut.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [user?.uid, isAnonymous]);

  const handleCancel = useCallback(() => {
    router.back();
  }, []);

  const cardBg = theme.surface ?? theme.bg;
  const headerBgEnd = theme.primary ?? '#0d8575';

  const styles = useMemo(
    () => ({
      heroGradient: {
        marginHorizontal: 16,
        marginTop: 12,
        borderRadius: radii.lg,
        padding: 20,
        ...(shadows.md ?? {}),
      },
      heroTitle: {
        color: '#fff',
        fontSize: 22,
        fontFamily: fontFamily.heading,
        fontWeight: fontWeight.bold as any,
        marginTop: 12,
      },
      heroBody: {
        color: 'rgba(255,255,255,0.92)',
        fontSize: 15,
        lineHeight: 22,
        fontFamily: fontFamily.body,
        marginTop: 8,
      },
      sectionTitle: {
        color: theme.text,
        fontSize: 13,
        fontFamily: fontFamily.body,
        fontWeight: fontWeight.bold as any,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.7,
        marginHorizontal: 20,
        marginTop: 24,
        marginBottom: 8,
      },
      bulletCard: {
        marginHorizontal: 16,
        marginVertical: 6,
        backgroundColor: cardBg,
        borderRadius: radii.lg,
        padding: 16,
        flexDirection: 'row' as const,
        gap: 14,
        ...(shadows.md ?? {}),
      },
      bulletIconBox: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        backgroundColor: theme.primary
          ? `${theme.primary}15`
          : 'rgba(13,133,117,0.1)',
      },
      bulletTitle: {
        color: theme.text,
        fontSize: 15,
        fontFamily: fontFamily.body,
        fontWeight: fontWeight.bold as any,
      },
      bulletBody: {
        color: theme.textSub,
        fontSize: 14,
        lineHeight: 20,
        marginTop: 4,
        fontFamily: fontFamily.body,
      },
      legalBlock: {
        marginHorizontal: 20,
        marginTop: 24,
        marginBottom: 12,
      },
      legalText: {
        color: theme.textSub,
        fontSize: 12,
        lineHeight: 18,
        fontFamily: fontFamily.body,
      },
      legalLink: {
        color: theme.primary ?? headerBgEnd,
        textDecorationLine: 'underline' as const,
      },
      footer: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: insets.bottom + 16,
        gap: 10,
        borderTopWidth: 1,
        borderTopColor: theme.border ?? 'rgba(0,0,0,0.06)',
        backgroundColor: theme.bg,
      },
      acceptButton: {
        backgroundColor: theme.primary ?? headerBgEnd,
        borderRadius: 14,
        paddingVertical: 14,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        flexDirection: 'row' as const,
        gap: 8,
        opacity: isSubmitting ? 0.7 : 1,
      },
      acceptButtonText: {
        color: '#fff',
        fontFamily: fontFamily.body,
        fontWeight: fontWeight.bold as any,
        fontSize: 16,
      },
      cancelButton: {
        paddingVertical: 12,
        alignItems: 'center' as const,
      },
      cancelButtonText: {
        color: theme.textSub,
        fontFamily: fontFamily.body,
        fontSize: 14,
      },
      versionBadge: {
        alignSelf: 'flex-start' as const,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.18)',
      },
      versionBadgeText: {
        color: 'rgba(255,255,255,0.9)',
        fontSize: 11,
        fontFamily: fontFamily.body,
        fontWeight: fontWeight.medium as any,
      },
    }),
    [theme, shadows, cardBg, insets.bottom, isSubmitting, headerBgEnd],
  );

  const headerOffset = insets.top + DETAIL_HEADER_ROW_HEIGHT;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Cashback" onBack={handleCancel} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: headerOffset + 8, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={[headerBgEnd, '#0a6e5f']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroGradient}
        >
          <View style={styles.versionBadge}>
            <Text style={styles.versionBadgeText}>Einwilligung {consentVersion}</Text>
          </View>
          <MaterialCommunityIcons name="cash-multiple" size={36} color="#fff" />
          <Text style={styles.heroTitle}>Echtes Cashback. Keine Punkte.</Text>
          <Text style={styles.heroBody}>
            Lade nach dem Einkauf deinen Kassenbon hoch. Wir prüfen die enthaltenen
            Produkte automatisch und schreiben dir Cashback in Euro gut. Auszahlung
            ab 15 € — wahlweise als PayPal, SEPA-Überweisung oder Gutschein.
          </Text>
        </LinearGradient>

        <Text style={styles.sectionTitle}>Was du zustimmst</Text>

        {BULLETS.map((bullet) => (
          <View key={bullet.title} style={styles.bulletCard}>
            <View style={styles.bulletIconBox}>
              <MaterialCommunityIcons
                name={bullet.icon as any}
                size={22}
                color={theme.primary ?? headerBgEnd}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bulletTitle}>{bullet.title}</Text>
              <Text style={styles.bulletBody}>{bullet.body}</Text>
            </View>
          </View>
        ))}

        <View style={styles.legalBlock}>
          <Text style={styles.legalText}>
            Mit der Nutzung von Cashback stimmst du unseren{' '}
            <Text style={styles.legalLink} onPress={() => Linking.openURL(TERMS_URL)}>
              AGB
            </Text>{' '}
            und der{' '}
            <Text style={styles.legalLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
              Datenschutzerklärung
            </Text>{' '}
            zu. Auszahlungen erfolgen über unseren Partner Tremendous, deren Bedingungen
            zusätzlich gelten. Die Verarbeitung deiner Bon-Daten erfolgt auf Servern in
            der Europäischen Union.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cashback-Einwilligung akzeptieren und fortfahren"
          accessibilityState={{ disabled: isSubmitting || hasAccepted }}
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
              <Text style={styles.acceptButtonText}>
                {hasAccepted ? 'Gespeichert' : 'Akzeptieren & Bon scannen'}
              </Text>
            </>
          )}
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abbrechen"
          style={styles.cancelButton}
          onPress={handleCancel}
        >
          <Text style={styles.cancelButtonText}>Jetzt nicht</Text>
        </Pressable>
      </View>
    </View>
  );
}
