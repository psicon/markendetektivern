/**
 * Bon Review Screen — Phase 1.5.
 *
 * Shows the captured image full-bleed with a quality verdict on top
 * and a 3-checkbox self-confirm (alle Ecken / Datum lesbar / Artikel
 * lesbar). Submit becomes active once all three are ticked.
 *
 * Submit currently routes to a placeholder /cashback/pending/[id] —
 * Phase 2 swaps the placeholder for the real `enqueueCashback`
 * Cloud Function call.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import {
  prepareForUpload,
  verdictFor,
  type CapturedBon,
} from '@/lib/utils/cashbackImage';

const CHECK_ITEMS: { key: 'corners' | 'date' | 'items'; label: string; sub: string }[] = [
  {
    key: 'corners',
    label: 'Alle 4 Ecken sichtbar',
    sub: 'Der gesamte Bon ist im Bild — keine Kante abgeschnitten.',
  },
  {
    key: 'date',
    label: 'Datum lesbar',
    sub: 'Bon-Datum ist klar erkennbar (z. B. oben oder unten auf dem Beleg).',
  },
  {
    key: 'items',
    label: 'Artikel lesbar',
    sub: 'Produktnamen und Preise sind nicht verwaschen oder verdeckt.',
  },
];

export default function CashbackReviewScreen() {
  const params = useLocalSearchParams<{
    uri: string;
    width?: string;
    height?: string;
    hash?: string;
    brightness?: string;
    size?: string;
    source?: 'live_camera' | 'upload';
  }>();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme, shadows } = useTokens();

  const [checks, setChecks] = useState<Record<'corners' | 'date' | 'items', boolean>>({
    corners: false,
    date: false,
    items: false,
  });
  const [submitting, setSubmitting] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const bon: CapturedBon = useMemo(
    () => ({
      uri: String(params.uri ?? ''),
      width: Number(params.width ?? 0),
      height: Number(params.height ?? 0),
      bytesHash: String(params.hash ?? ''),
      approxBrightness: Number(params.brightness ?? 128),
      sizeBytes: Number(params.size ?? 0),
      capturedAt: Date.now(),
    }),
    [params.uri, params.width, params.height, params.hash, params.brightness, params.size],
  );

  const verdict = useMemo(() => verdictFor(bon), [bon]);
  const allChecked = checks.corners && checks.date && checks.items;
  const canSubmit = allChecked && verdict.hashOk && verdict.sizeOk && !submitting;

  const handleRetake = useCallback(() => {
    router.replace('/cashback/capture');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Phase 1.5 stub: prepare the image for upload locally so the
      // resize/compress path is exercised end-to-end. Phase 2 hands
      // this off to `enqueueCashback`.
      const prepared = await prepareForUpload(bon.uri, 2000, bon.width, bon.height);
      console.log('[cashback] prepared for upload', prepared);

      // Stub navigation — Phase 2 replaces with real ID from the
      // enqueue Cloud Function response.
      const stubId = `local-${Date.now()}`;
      router.replace({ pathname: '/cashback/pending/[id]' as any, params: { id: stubId } });
    } catch (error) {
      console.warn('⚠️ submit failed:', error);
    } finally {
      setSubmitting(false);
    }
  }, [bon, canSubmit]);

  const verdictColor = (ok: boolean) => (ok ? theme.brandPrimary ?? '#0d8575' : '#d6603a');

  const styles = useMemo(
    () =>
      StyleSheet.create({
        topBar: {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          paddingTop: insets.top + 8,
          paddingBottom: 12,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.45)',
          zIndex: 10,
        },
        topBarTitle: {
          flex: 1,
          textAlign: 'center',
          color: '#fff',
          fontFamily: fontFamily.heading,
          fontWeight: fontWeight.bold as any,
          fontSize: 16,
        },
        iconButton: {
          width: 40,
          height: 40,
          alignItems: 'center',
          justifyContent: 'center',
        },
        verdictRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: theme.surfaceAlt ?? 'rgba(0,0,0,0.05)',
          alignSelf: 'flex-start',
          marginBottom: 8,
        },
        verdictText: {
          color: theme.textPrimary,
          fontFamily: fontFamily.body,
          fontSize: 12,
          fontWeight: fontWeight.medium as any,
        },
        sheet: {
          backgroundColor: theme.background,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: insets.bottom + 12,
          ...(shadows.card ?? {}),
        },
        sectionTitle: {
          color: theme.textPrimary,
          fontFamily: fontFamily.body,
          fontWeight: fontWeight.bold as any,
          fontSize: 14,
          marginBottom: 8,
        },
        checkRow: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 12,
          paddingVertical: 10,
          borderTopWidth: 1,
          borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
        },
        checkBox: {
          width: 24,
          height: 24,
          borderRadius: 6,
          borderWidth: 1.5,
          borderColor: theme.brandPrimary ?? '#0d8575',
          alignItems: 'center',
          justifyContent: 'center',
        },
        checkBoxOn: {
          backgroundColor: theme.brandPrimary ?? '#0d8575',
        },
        checkLabel: {
          color: theme.textPrimary,
          fontFamily: fontFamily.body,
          fontWeight: fontWeight.bold as any,
          fontSize: 14,
        },
        checkSub: {
          color: theme.textSecondary,
          fontFamily: fontFamily.body,
          fontSize: 12,
          marginTop: 2,
        },
        ctaRow: {
          flexDirection: 'row',
          gap: 10,
          marginTop: 14,
        },
        cta: {
          flex: 1,
          height: 50,
          borderRadius: radii.pill,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
        },
        ctaPrimary: {
          backgroundColor: canSubmit ? theme.brandPrimary ?? '#0d8575' : theme.surfaceAlt ?? '#ddd',
        },
        ctaPrimaryText: {
          color: canSubmit ? '#fff' : theme.textMuted ?? '#888',
          fontFamily: fontFamily.body,
          fontWeight: fontWeight.bold as any,
        },
        ctaSecondary: {
          borderWidth: 1,
          borderColor: theme.brandPrimary ?? '#0d8575',
        },
        ctaSecondaryText: {
          color: theme.brandPrimary ?? '#0d8575',
          fontFamily: fontFamily.body,
          fontWeight: fontWeight.bold as any,
        },
      }),
    [theme, shadows, canSubmit, insets.top, insets.bottom],
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar barStyle="light-content" />

      {/* Image fills the top half, sheet sits on top. */}
      <View style={{ flex: 1 }}>
        {bon.uri ? (
          <Image
            source={{ uri: bon.uri }}
            style={{ flex: 1, width: '100%' }}
            contentFit="contain"
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
      </View>

      <View style={styles.topBar}>
        <Pressable onPress={handleRetake} style={styles.iconButton} hitSlop={10}>
          <MaterialCommunityIcons name="arrow-left" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.topBarTitle}>Bon prüfen</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView
        style={styles.sheet}
        contentContainerStyle={{ paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.verdictRow}>
          <MaterialCommunityIcons
            name={verdict.brightnessOk ? 'brightness-6' : 'alert-circle-outline'}
            size={14}
            color={verdictColor(verdict.brightnessOk)}
          />
          <Text style={styles.verdictText}>{verdict.brightnessLabel}</Text>
        </View>
        <View style={styles.verdictRow}>
          <MaterialCommunityIcons
            name={verdict.sizeOk ? 'check-circle-outline' : 'alert-circle-outline'}
            size={14}
            color={verdictColor(verdict.sizeOk)}
          />
          <Text style={styles.verdictText}>{verdict.sizeLabel}</Text>
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 14 }]}>
          Bestätige bitte:
        </Text>

        {CHECK_ITEMS.map((item) => {
          const on = checks[item.key];
          return (
            <Pressable
              key={item.key}
              onPress={() => setChecks((s) => ({ ...s, [item.key]: !s[item.key] }))}
              style={styles.checkRow}
            >
              <View style={[styles.checkBox, on && styles.checkBoxOn]}>
                {on ? <MaterialCommunityIcons name="check" size={16} color="#fff" /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.checkLabel}>{item.label}</Text>
                <Text style={styles.checkSub}>{item.sub}</Text>
              </View>
            </Pressable>
          );
        })}

        <View style={styles.ctaRow}>
          <Pressable onPress={handleRetake} style={[styles.cta, styles.ctaSecondary]}>
            <MaterialCommunityIcons name="camera-retake-outline" size={18} color={theme.brandPrimary ?? '#0d8575'} />
            <Text style={styles.ctaSecondaryText}>Nochmal</Text>
          </Pressable>
          <Pressable
            disabled={!canSubmit}
            onPress={handleSubmit}
            style={[styles.cta, styles.ctaPrimary]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons name="cloud-upload-outline" size={18} color={canSubmit ? '#fff' : theme.textMuted ?? '#888'} />
                <Text style={styles.ctaPrimaryText}>
                  {allChecked ? 'Einreichen' : `Noch ${3 - Object.values(checks).filter(Boolean).length} bestätigen`}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
