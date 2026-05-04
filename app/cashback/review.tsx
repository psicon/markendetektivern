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
  Dimensions,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { height: SCREEN_H } = Dimensions.get('window');

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { verdictFor, type CapturedBon } from '@/lib/utils/cashbackImage';

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
  const { user } = useAuth();

  const [checks, setChecks] = useState<Record<'corners' | 'date' | 'items', boolean>>({
    corners: false,
    date: false,
    items: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
  // "Looks ready" drives the visual state (color stays green while
  // submitting). canSubmit gates the actual press handler.
  const looksReady = allChecked && verdict.hashOk && verdict.sizeOk;
  const canSubmit = looksReady && !submitting;

  const handleRetake = useCallback(() => {
    router.replace('/cashback/capture');
  }, []);

  // Top-bar X dismisses the entire cashback flow back to the rewards
  // tab. We navigate to rewards explicitly because router.back() on a
  // freshly-mounted stack with replace-style entry can land on the
  // hidden index splash; navigate is robust either way.
  const handleDismiss = useCallback(() => {
    router.navigate('/(tabs)/rewards');
  }, []);

  const handleCropTap = useCallback(() => {
    router.push({
      pathname: '/cashback/crop',
      params: {
        uri: bon.uri,
        width: String(bon.width),
        height: String(bon.height),
        source: (params.source as any) || 'live_camera',
      },
    });
  }, [bon.uri, bon.width, bon.height, params.source]);

  // Optimistic submit: navigate IMMEDIATELY to pending with a local
  // placeholder ID + the bon metadata in route params. The pending
  // screen runs the upload + enqueue in the background and updates
  // its own state with progress ("Bild wird hochgeladen…" → "Wird
  // geprüft…" → live status). User never stares at a frozen review
  // screen with a spinner.
  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    if (!user?.uid) {
      setSubmitError('Bitte melde dich an, um Bons einzureichen.');
      return;
    }
    const localId = `local-${Date.now()}`;
    router.replace({
      pathname: '/cashback/pending/[id]' as any,
      params: {
        id: localId,
        uploadUri: bon.uri,
        uploadHash: bon.bytesHash,
        uploadWidth: String(bon.width),
        uploadHeight: String(bon.height),
        uploadCapturedAt: String(bon.capturedAt),
        uploadSource: (params.source as string) || 'live_camera',
      },
    });
  }, [bon, canSubmit, user?.uid, params.source]);

  const verdictColor = (ok: boolean) => (ok ? theme.primary ?? '#0d8575' : '#d6603a');

  const styles = useMemo(
    () =>
      StyleSheet.create({
        // Top bar sits OUTSIDE the image block (own row), so the receipt
        // photo never gets clipped behind the status bar / title.
        topBar: {
          paddingTop: insets.top + 6,
          paddingBottom: 10,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#0a0a0a',
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
        imageBlock: {
          height: SCREEN_H * 0.36,
          backgroundColor: '#0a0a0a',
        },
        cropPill: {
          position: 'absolute',
          bottom: 12,
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: 'rgba(0,0,0,0.6)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.18)',
        },
        cropPillText: {
          color: '#fff',
          fontFamily: fontFamily.body,
          fontWeight: fontWeight.medium as any,
          fontSize: 12,
        },
        sheet: {
          flex: 1,
          backgroundColor: theme.bg,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          paddingHorizontal: 18,
          paddingTop: 6,
          marginTop: -16,
          ...(shadows.md ?? {}),
        },
        sectionTitle: {
          color: theme.text,
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
          borderColor: theme.primary ?? '#0d8575',
          alignItems: 'center',
          justifyContent: 'center',
        },
        checkBoxOn: {
          backgroundColor: theme.primary ?? '#0d8575',
        },
        checkLabel: {
          color: theme.text,
          fontFamily: fontFamily.body,
          fontWeight: fontWeight.bold as any,
          fontSize: 14,
        },
        checkSub: {
          color: theme.textSub,
          fontFamily: fontFamily.body,
          fontSize: 12,
          marginTop: 2,
        },
        ctaRow: {
          flexDirection: 'row',
          gap: 10,
          paddingTop: 12,
          paddingBottom: insets.bottom + 12,
          borderTopWidth: 1,
          borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
        },
        cta: {
          flex: 1,
          height: 52,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
        },
        ctaPrimary: {
          backgroundColor: looksReady ? theme.primary ?? '#0d8575' : theme.surfaceAlt ?? '#ddd',
        },
        ctaPrimaryText: {
          color: looksReady ? '#fff' : theme.textMuted ?? '#888',
          fontFamily: fontFamily.body,
          fontWeight: fontWeight.bold as any,
        },
        ctaSecondary: {
          borderWidth: 1,
          borderColor: theme.primary ?? '#0d8575',
        },
        ctaSecondaryText: {
          color: theme.primary ?? '#0d8575',
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
      {/* Standalone top bar — sits ABOVE the image so nothing gets clipped. */}
      <View style={styles.topBar}>
        <Pressable onPress={handleDismiss} style={styles.iconButton} hitSlop={10}>
          <MaterialCommunityIcons name="close" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.topBarTitle}>Foto kontrollieren</Text>
        <View style={styles.iconButton} />
      </View>

      {/* Image preview — fixed height, never overlapped by chrome. */}
      <View style={styles.imageBlock}>
        {bon.uri ? (
          <Image
            source={{ uri: bon.uri }}
            style={StyleSheet.absoluteFillObject}
            contentFit="contain"
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
        <Pressable onPress={handleCropTap} style={styles.cropPill} hitSlop={6}>
          <MaterialCommunityIcons name="crop" size={14} color="#fff" />
          <Text style={styles.cropPillText}>Zuschneiden</Text>
        </Pressable>
      </View>

      {/* Bottom: theme-aware sheet — flex:1 so labels are clearly visible */}
      <View style={styles.sheet}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 16 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionTitle}>Bevor du absendest, bestätige:</Text>

          {CHECK_ITEMS.map((item, idx) => {
            const on = checks[item.key];
            return (
              <Pressable
                key={item.key}
                onPress={() => setChecks((s) => ({ ...s, [item.key]: !s[item.key] }))}
                style={[styles.checkRow, idx === 0 && { borderTopWidth: 0 }]}
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

          {submitError ? (
            <View
              style={{
                marginTop: 12,
                backgroundColor: 'rgba(214,96,58,0.12)',
                borderRadius: 10,
                padding: 12,
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#d6603a" />
              <Text style={{ color: '#d6603a', fontFamily: fontFamily.body, fontSize: 13, flex: 1, lineHeight: 18 }}>
                {submitError}
              </Text>
            </View>
          ) : null}
        </ScrollView>

        {/* Sticky CTA row */}
        <View style={styles.ctaRow}>
          <Pressable onPress={handleRetake} style={[styles.cta, styles.ctaSecondary]}>
            <MaterialCommunityIcons name="camera-retake-outline" size={18} color={theme.primary ?? '#0d8575'} />
            <Text style={styles.ctaSecondaryText}>Nochmal</Text>
          </Pressable>
          <Pressable
            disabled={!canSubmit}
            onPress={handleSubmit}
            style={[styles.cta, styles.ctaPrimary, { flex: 1.4 }]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons name="cloud-upload-outline" size={18} color={looksReady ? '#fff' : theme.textMuted ?? '#888'} />
                <Text style={styles.ctaPrimaryText}>
                  {allChecked ? 'Einreichen' : `Noch ${3 - Object.values(checks).filter(Boolean).length} bestätigen`}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
