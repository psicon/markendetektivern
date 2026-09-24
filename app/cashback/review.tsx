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
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ImageZoom } from '@likashefqet/react-native-image-zoom';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { height: SCREEN_H } = Dimensions.get('window');

import { StandortPflichtHinweis } from '@/components/rewards/StandortPflichtHinweis';
import { fontFamilyVariants, fontWeight, radii } from '@/constants/tokens';
import { useStandortPflicht } from '@/hooks/useStandortPflicht';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { enqueueBon } from '@/lib/services/bonUploadQueue';
import { getSelectedCampaignId } from '@/lib/services/cashbackUpload';
import { hashImageFile, verdictFor, type CapturedBon } from '@/lib/utils/cashbackImage';

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

/**
 * Fullscreen gallery-style pinch-to-zoom viewer to verify the bon is
 * legible. Uses the battle-tested @likashefqet/react-native-image-zoom
 * (focal-point pinch, momentum pan, double-tap) instead of a hand-rolled
 * gesture stack.
 */
function ZoomableImageModal({
  uri,
  visible,
  onClose,
}: {
  uri: string;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {uri ? (
          <ImageZoom
            uri={uri}
            style={{ flex: 1 }}
            resizeMode="contain"
            minScale={1}
            maxScale={8}
            doubleTapScale={3}
            isDoubleTapEnabled
            isPinchEnabled
            isPanEnabled
          />
        ) : null}
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={{
            position: 'absolute',
            top: insets.top + 8,
            right: 14,
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: 'rgba(0,0,0,0.5)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name="close" size={24} color="#fff" />
        </Pressable>
        <View
          style={{
            position: 'absolute',
            bottom: insets.bottom + 20,
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            backgroundColor: 'rgba(0,0,0,0.55)',
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 999,
          }}
        >
          <MaterialCommunityIcons name="gesture-spread" size={14} color="#fff" />
          <Text style={{ color: '#fff', fontFamily: fontFamilyVariants.body, fontSize: 12 }}>
            Zwei Finger zum Zoomen · Doppeltipp
          </Text>
        </View>
      </View>
    </Modal>
  );
}

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
  // Standortpflicht (6.0.20): der Scanner prüft beim Öffnen, hier wird vor dem
  // Einreichen erneut geprüft — die Freigabe kann zwischendurch entzogen oder
  // die Ortung über die Schnelleinstellungen abgeschaltet worden sein. Das
  // Bild bleibt erhalten (Routen-Parameter), nach der Freigabe geht es hier
  // weiter.
  const pflicht = useStandortPflicht();

  const [checks, setChecks] = useState<Record<'corners' | 'date' | 'items', boolean>>({
    corners: false,
    date: false,
    items: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);

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
  // 86cb6twnp: hashOk blockiert NICHT mehr — ein fehlender Hash wird in
  // handleSubmit einmal nachgerechnet (Fallback) statt stumm zu sperren.
  // sizeOk bleibt Gate (Storage-Rule 8 MB), ist aber durch die Capture-
  // seitige Verkleinerung praktisch immer erfüllt — und wenn nicht, sieht
  // der Nutzer jetzt WARUM (blockerHint unten + Tap-Erklärung am Button).
  const looksReady = allChecked && verdict.sizeOk;
  const canSubmit = looksReady && !submitting;

  // Sichtbare Erklärung, sobald die Checkboxen bestätigt sind, aber ein
  // File-Gate blockt. Vorher war der EINZIGE Hinweis ein graues Icon.
  const blockerHint = allChecked && !verdict.sizeOk ? verdict.sizeLabel : null;

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

  // No manual crop step in the flow anymore. iOS auto-crops via
  // VisionKit (native scanner) or via bon-edge-detector (gallery).
  // Android sends the raw image to OCR — Gemini handles wide-angle
  // bons reliably. "Nochmal" re-launches the capture flow.

  // Optimistic submit (best-practice): create a placeholder mirror doc
  // in Firestore RIGHT NOW so the bon is immediately visible everywhere
  // (Bons-Verlauf, snapshot listeners, even if the user closes the app
  // mid-upload). Then navigate to the pending screen which subscribes
  // to that same doc + runs the upload+enqueue in the background. The
  // Cloud Function uses our clientUploadId as the receipt doc id so
  // the mirror smoothly transitions through `uploading` → `ocr_pending`
  // → final state without identity changes.
  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    if (!user?.uid) {
      setSubmitError('Bitte melde dich an, um Bons einzureichen.');
      return;
    }
    // Fehlt die Freigabe, zeigt der Screen den Sperrhinweis (Render unten).
    if ((await pflicht.pruefen()) !== 'erfuellt') return;
    setSubmitting(true);
    // Hash-Fallback (86cb6twnp): schlug das Hashen beim Aufnehmen fehl
    // (Heap/IO), einmal nachziehen statt hart zu blockieren. Der Server
    // rechnet ohnehin autoritativ nach — aber Dedup braucht einen Wert.
    let bytesHash = bon.bytesHash;
    if (bytesHash.length !== 64) {
      bytesHash = await hashImageFile(bon.uri);
      if (bytesHash.length !== 64) {
        setSubmitError('Das Bild konnte nicht geprüft werden — bitte nimm den Bon noch einmal auf.');
        setSubmitting(false);
        return;
      }
    }
    // Hand the receipt to the persistent background upload queue: it copies
    // the image to a durable dir + creates the placeholder mirror, then uploads
    // in the background with NetInfo auto-resume. Survives LEAVING this screen
    // and an app kill → no more zombie "Wird hochgeladen" docs. enqueueBon only
    // does local work (file copy + AsyncStorage), so it never hangs offline.
    let localId: string;
    try {
      localId = await enqueueBon({
        uid: user.uid,
        imageUri: bon.uri,
        hash: bytesHash,
        width: bon.width,
        height: bon.height,
        capturedAt: bon.capturedAt,
        source: ((params.source as string) || 'live_camera') as 'live_camera' | 'upload',
        campaignId: getSelectedCampaignId(),
      });
    } catch (e) {
      console.warn('⚠️ enqueueBon failed', e);
      setSubmitError('Konnte nicht vorgemerkt werden — bitte nochmal.');
      setSubmitting(false);
      return;
    }
    // Submit-Feedback — leichte Haptik. Die volle Banner+Celebration kommt erst
    // bei Approval (global über GamificationProvider).
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.replace({
      pathname: '/cashback/pending/[id]' as any,
      params: {
        id: localId,
        uploadUri: bon.uri, // local preview while the upload runs
      },
    });
  }, [bon, canSubmit, user?.uid, params.source, pflicht.pruefen]);

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
          fontFamily: fontFamilyVariants.heading,
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
          fontFamily: fontFamilyVariants.body,
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
          fontFamily: fontFamilyVariants.body,
          fontWeight: fontWeight.bold as any,
          fontSize: 14,
        },
        checkSub: {
          color: theme.textSub,
          fontFamily: fontFamilyVariants.body,
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
          fontFamily: fontFamilyVariants.body,
          fontWeight: fontWeight.bold as any,
        },
        ctaSecondary: {
          borderWidth: 1,
          borderColor: theme.primary ?? '#0d8575',
        },
        ctaSecondaryText: {
          color: theme.primary ?? '#0d8575',
          fontFamily: fontFamilyVariants.body,
          fontWeight: fontWeight.bold as any,
        },
      }),
    [theme, shadows, canSubmit, insets.top, insets.bottom],
  );

  if (pflicht.stand !== null && pflicht.stand !== 'erfuellt') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg ?? '#fff', paddingTop: insets.top + 8 }}>
        <StatusBar barStyle="dark-content" />
        <View style={{ paddingHorizontal: 12 }}>
          <Pressable onPress={handleDismiss} hitSlop={10} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="close" size={26} color={theme.text} />
          </Pressable>
        </View>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <StandortPflichtHinweis
            stand={pflicht.stand}
            art="bon"
            laeuft={pflicht.laeuft}
            onErfuellen={() => void pflicht.erfuellen()}
            onZurueck={handleDismiss}
          />
        </View>
      </View>
    );
  }

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

      {/* Image preview — tap to zoom & verify legibility. */}
      <Pressable
        style={styles.imageBlock}
        onPress={() => bon.uri && setZoomOpen(true)}
        disabled={!bon.uri}
      >
        {bon.uri ? (
          <>
            <Image
              source={{ uri: bon.uri }}
              style={StyleSheet.absoluteFillObject}
              contentFit="contain"
            />
            <View
              style={{
                position: 'absolute',
                bottom: 10,
                right: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: 'rgba(0,0,0,0.55)',
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
              }}
            >
              <MaterialCommunityIcons name="magnify-plus-outline" size={14} color="#fff" />
              <Text style={{ color: '#fff', fontFamily: fontFamilyVariants.body, fontSize: 12 }}>
                Tippen zum Zoomen
              </Text>
            </View>
          </>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
      </Pressable>

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

          {submitError || blockerHint ? (
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
              <Text style={{ color: '#d6603a', fontFamily: fontFamilyVariants.body, fontSize: 13, flex: 1, lineHeight: 18 }}>
                {submitError || blockerHint}
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
            // 86cb6twnp: NIE mehr ein stummer toter Button. Blockiert ein
            // Gate, bleibt der Button tippbar und der Tap zeigt die
            // Erklärung im Fehler-Block — disabled nur während des Submits.
            disabled={submitting}
            onPress={
              canSubmit
                ? handleSubmit
                : () =>
                    setSubmitError(
                      blockerHint ??
                        'Bitte bestätige zuerst die drei Punkte oben — dann kannst du einreichen.',
                    )
            }
            style={[styles.cta, styles.ctaPrimary, { flex: 1.4 }]}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons name="cloud-upload-outline" size={18} color={looksReady ? '#fff' : theme.textMuted ?? '#888'} />
                <Text style={styles.ctaPrimaryText}>
                  {!allChecked
                    ? `Noch ${3 - Object.values(checks).filter(Boolean).length} bestätigen`
                    : blockerHint
                    ? 'Datei zu groß'
                    : 'Einreichen'}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </View>

      <ZoomableImageModal
        uri={bon.uri}
        visible={zoomOpen}
        onClose={() => setZoomOpen(false)}
      />
    </View>
  );
}
