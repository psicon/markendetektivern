/**
 * Product-photo wizard ("voller Datensatz").
 *
 * Flow: pick market (once per session) → per product: optional name → 7
 * camera steps (front, back, manufacturer, EAN, nutrition, ingredients,
 * price) → review grid → upload + submit → "Mehr in diesem Markt?" → next
 * product (market remembered) or finish.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Camera, CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { router, useNavigation } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MarketSelector } from '@/components/ui/MarketSelector';
import { fontFamilyVariants, fontWeight, radii } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import {
  PRODUCT_PHOTO_STEPS,
  getActiveProductCampaign,
  newSessionId,
  submitProduct,
  uploadProductImage,
  type ActiveProductCampaign,
  type ProductPhotoStep,
} from '@/lib/services/productSubmit';
import { showInfoToast } from '@/lib/services/ui/toast';

const PURPLE = '#5b4f9c';

type Phase = 'market' | 'intro' | 'capture' | 'review' | 'uploading';

export default function ProductWizardScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme } = useTokens();
  const scheme = useColorScheme();
  const { user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [phase, setPhase] = useState<Phase>('market');
  const [sessionId] = useState(() => newSessionId());
  const [marketName, setMarketName] = useState('');
  const [marketId, setMarketId] = useState<string | null>(null);
  const [productIndex, setProductIndex] = useState(1);
  const [productName, setProductName] = useState('');
  const [photos, setPhotos] = useState<Partial<Record<ProductPhotoStep, string>>>({});
  const [stepIdx, setStepIdx] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [campaign, setCampaign] = useState<ActiveProductCampaign | null>(null);
  // MarketSelector calls onClose AFTER onSelect too — guard so a real
  // selection doesn't trigger the cancel (router.back) path.
  const marketChosenRef = useRef(false);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Cashback only while a product-photo campaign runs; otherwise the data
  // is still collected, just without reward.
  useEffect(() => {
    let alive = true;
    getActiveProductCampaign().then((c) => {
      if (alive) setCampaign(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  const step = PRODUCT_PHOTO_STEPS[stepIdx];
  const capturedCount = Object.keys(photos).length;
  const allCaptured = PRODUCT_PHOTO_STEPS.every((s) => photos[s.key]);

  const close = useCallback(() => {
    if (capturedCount > 0) {
      Alert.alert('Wizard verlassen?', 'Deine bisherigen Fotos dieses Produkts gehen verloren.', [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Verlassen', style: 'destructive', onPress: () => router.back() },
      ]);
    } else {
      router.back();
    }
  }, [capturedCount]);

  // ─── Capture ──────────────────────────────────────────────────────
  const ensurePermission = useCallback(async (): Promise<boolean> => {
    const current = await Camera.getCameraPermissionsAsync();
    if (current.status === 'granted') return true;
    if (current.status === 'undetermined') {
      const req = await requestPermission();
      if (req.status === 'granted') return true;
    }
    Alert.alert('Kamera-Zugriff blockiert', 'Bitte erlaube den Zugriff in den Einstellungen.', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Einstellungen', onPress: () => Linking.openSettings() },
    ]);
    return false;
  }, [requestPermission]);

  const startCapture = useCallback(async () => {
    if (!(await ensurePermission())) return;
    // Resume at the first missing step.
    const firstMissing = PRODUCT_PHOTO_STEPS.findIndex((s) => !photos[s.key]);
    setStepIdx(firstMissing === -1 ? 0 : firstMissing);
    setPhase('capture');
  }, [ensurePermission, photos]);

  const shoot = useCallback(async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, skipProcessing: false });
      if (!photo?.uri) throw new Error('no-uri');
      setPhotos((p) => ({ ...p, [step.key]: photo.uri }));
      // Advance to the next missing step, else go to review.
      const next = PRODUCT_PHOTO_STEPS.findIndex((s, i) => i > stepIdx && !photos[s.key]);
      if (next === -1) {
        const anyMissing = PRODUCT_PHOTO_STEPS.findIndex((s) => s.key !== step.key && !photos[s.key]);
        if (anyMissing === -1) setPhase('review');
        else setStepIdx(anyMissing);
      } else {
        setStepIdx(next);
      }
    } catch {
      Alert.alert('Aufnahme fehlgeschlagen', 'Bitte versuch es noch einmal.');
    } finally {
      setCapturing(false);
    }
  }, [capturing, step, stepIdx, photos]);

  // ─── Submit ───────────────────────────────────────────────────────
  const doSubmit = useCallback(async () => {
    if (!user?.uid || !allCaptured) return;
    setPhase('uploading');
    setUploadPct(0);
    try {
      const uploaded: Partial<Record<ProductPhotoStep, string>> = {};
      const steps = PRODUCT_PHOTO_STEPS;
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const local = photos[s.key];
        if (!local) continue;
        const path = await uploadProductImage(local, user.uid, sessionId, productIndex, s.key, {
          onProgress: (pct) => {
            // Overall progress across all steps.
            setUploadPct(Math.round(((i + pct / 100) / steps.length) * 100));
          },
        });
        uploaded[s.key] = path;
      }
      await submitProduct(user.uid, {
        sessionId,
        productIndex,
        marketId,
        marketName,
        productName: productName.trim() || null,
        campaignId: campaign?.campaignId ?? null,
        images: uploaded,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Ask whether to capture more in the same market.
      Alert.alert('Produkt eingereicht 🎉', 'Mehr in diesem Markt erfassen?', [
        {
          text: 'Fertig',
          style: 'cancel',
          // Pop the wizard back to the already-open overview (don't stack
          // a second one). Fallback to replace if there's nothing below.
          onPress: () => {
            if (router.canGoBack()) router.back();
            else router.replace('/product-submit');
          },
        },
        {
          text: 'Weiteres Produkt',
          onPress: () => {
            setPhotos({});
            setProductName('');
            setProductIndex((n) => n + 1);
            setStepIdx(0);
            setPhase('intro');
          },
        },
      ]);
    } catch (e: any) {
      console.warn('product submit failed', e?.message);
      showInfoToast('Einreichen fehlgeschlagen — Verbindung prüfen.', 'error');
      setPhase('review');
    }
  }, [user?.uid, allCaptured, photos, sessionId, productIndex, marketName, productName, campaign?.campaignId]);

  // ─── Render ───────────────────────────────────────────────────────

  const Header = ({ title, sub }: { title: string; sub?: string }) => (
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: theme.bg }]}>
      <Pressable onPress={close} style={styles.iconBtn} hitSlop={10}>
        <MaterialCommunityIcons name="close" size={24} color={theme.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={[styles.hTitle, { color: theme.text }]}>{title}</Text>
        {sub ? <Text style={[styles.hSub, { color: theme.textSub }]}>{sub}</Text> : null}
      </View>
    </View>
  );

  if (phase === 'market') {
    // App-wide market picker with the country (Land) filter.
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
        <MarketSelector
          visible
          title="In welchem Markt bist du?"
          selectedMarketId={marketId ?? undefined}
          onClose={() => {
            // onClose fires on cancel AND right after a selection — only
            // leave the wizard on a real cancel.
            if (marketChosenRef.current) {
              marketChosenRef.current = false;
              return;
            }
            router.back();
          }}
          onSelect={(m) => {
            marketChosenRef.current = true;
            setMarketName(m.name);
            setMarketId(m.id);
            setPhase('intro');
          }}
        />
      </View>
    );
  }

  if (phase === 'intro') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
        <Header title={`Produkt ${productIndex}`} sub={marketName} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View style={[styles.inputRow, { borderColor: theme.border, backgroundColor: theme.surface }]}>
            <MaterialCommunityIcons name="tag-text-outline" size={18} color={theme.textMuted} />
            <TextInput
              value={productName}
              onChangeText={setProductName}
              placeholder="Produktname (optional)"
              placeholderTextColor={theme.textMuted}
              style={{ flex: 1, color: theme.text, fontFamily: fontFamilyVariants.body, fontSize: 15 }}
            />
          </View>
          <Text style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 13 }}>
            Du fotografierst {PRODUCT_PHOTO_STEPS.length} Ansichten:
          </Text>
          <View style={{ gap: 8 }}>
            {PRODUCT_PHOTO_STEPS.map((s, i) => (
              <View key={s.key} style={[styles.stepRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <View style={[styles.stepNum, { backgroundColor: photos[s.key] ? PURPLE : theme.surfaceAlt ?? '#eee' }]}>
                  {photos[s.key] ? (
                    <MaterialCommunityIcons name="check" size={14} color="#fff" />
                  ) : (
                    <Text style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 12 }}>{i + 1}</Text>
                  )}
                </View>
                <MaterialCommunityIcons name={s.icon as any} size={18} color={theme.textSub} />
                <Text style={{ flex: 1, color: theme.text, fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.medium as any, fontSize: 14 }}>
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
          <Pressable onPress={startCapture} style={[styles.cta, { backgroundColor: PURPLE }]}>
            <MaterialCommunityIcons name="camera" size={18} color="#fff" />
            <Text style={styles.ctaText}>{capturedCount > 0 ? 'Weiter fotografieren' : "Los geht's"}</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  if (phase === 'capture') {
    if (!permission?.granted) {
      return (
        <View style={[styles.camRoot, { alignItems: 'center', justifyContent: 'center' }]}>
          <StatusBar barStyle="light-content" />
          <MaterialCommunityIcons name="camera-off-outline" size={56} color="#fff" />
          <Text style={styles.permTitle}>Kamera-Zugriff fehlt</Text>
          <Pressable onPress={ensurePermission} style={[styles.cta, { backgroundColor: PURPLE, marginTop: 16 }]}>
            <Text style={styles.ctaText}>Zugriff erlauben</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.camRoot}>
        <StatusBar barStyle="light-content" />
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={'back' as CameraType} enableTorch={flashOn} />

        {/* top bar */}
        <View style={[styles.camTop, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={() => setPhase('intro')} style={styles.iconBtn} hitSlop={10}>
            <MaterialCommunityIcons name="arrow-left" size={24} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.camTitle}>{step.label}</Text>
            <Text style={styles.camSub}>{step.hint}</Text>
          </View>
          <Pressable onPress={() => setFlashOn((v) => !v)} style={styles.iconBtn} hitSlop={10}>
            <MaterialCommunityIcons name={flashOn ? 'flash' : 'flash-off'} size={22} color={flashOn ? '#ffd44b' : '#fff'} />
          </Pressable>
        </View>

        {/* frame */}
        <View pointerEvents="none" style={styles.frameWrap}>
          <View style={styles.frame}>
            <View style={[styles.corner, styles.cTL]} />
            <View style={[styles.corner, styles.cTR]} />
            <View style={[styles.corner, styles.cBL]} />
            <View style={[styles.corner, styles.cBR]} />
          </View>
        </View>

        {/* step chips */}
        <View style={[styles.chipsRow, { bottom: insets.bottom + 116 }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
            {PRODUCT_PHOTO_STEPS.map((s, i) => {
              const done = !!photos[s.key];
              const active = i === stepIdx;
              return (
                <Pressable key={s.key} onPress={() => setStepIdx(i)} style={[styles.stepChip, { backgroundColor: active ? PURPLE : done ? 'rgba(91,79,156,0.55)' : 'rgba(0,0,0,0.5)' }]}>
                  {done ? <MaterialCommunityIcons name="check" size={12} color="#fff" /> : null}
                  <Text style={styles.stepChipText}>{s.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* bottom bar */}
        <View style={[styles.camBottom, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable onPress={() => setPhase('review')} disabled={capturedCount === 0} style={styles.iconBtn} hitSlop={12}>
            <MaterialCommunityIcons name="view-grid-outline" size={26} color={capturedCount === 0 ? 'rgba(255,255,255,0.4)' : '#fff'} />
          </Pressable>
          <Pressable
            onPress={shoot}
            disabled={capturing}
            style={({ pressed }) => [styles.shutter, (pressed || capturing) && { transform: [{ scale: 0.94 }] }]}
          >
            <View style={styles.shutterInner}>
              {capturing ? <ActivityIndicator color={PURPLE} /> : <MaterialCommunityIcons name="camera-outline" size={28} color={PURPLE} />}
            </View>
          </Pressable>
          <View style={styles.iconBtn} />
        </View>
      </View>
    );
  }

  if (phase === 'review') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
        <Header title={`Produkt ${productIndex} prüfen`} sub={`${marketName}${productName ? ' · ' + productName : ''}`} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {PRODUCT_PHOTO_STEPS.map((s) => {
              const uri = photos[s.key];
              return (
                <Pressable
                  key={s.key}
                  onPress={() => {
                    setStepIdx(PRODUCT_PHOTO_STEPS.findIndex((x) => x.key === s.key));
                    setPhase('capture');
                  }}
                  style={[styles.thumb, { borderColor: uri ? PURPLE : theme.border, backgroundColor: theme.surfaceAlt ?? '#eee' }]}
                >
                  {uri ? (
                    <ExpoImage source={{ uri }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                  ) : (
                    <MaterialCommunityIcons name={s.icon as any} size={26} color={theme.textMuted} />
                  )}
                  <View style={styles.thumbLabel}>
                    <Text numberOfLines={1} style={{ color: '#fff', fontFamily: fontFamilyVariants.body, fontSize: 11, fontWeight: fontWeight.bold as any }}>
                      {s.label}
                    </Text>
                  </View>
                  {uri ? (
                    <View style={styles.thumbCheck}>
                      <MaterialCommunityIcons name="check" size={12} color="#fff" />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: theme.bg, borderColor: theme.border }]}>
          <Pressable onPress={() => setPhase('capture')} style={[styles.cta, styles.ctaOutline, { borderColor: PURPLE, flex: 1 }]}>
            <Text style={[styles.ctaText, { color: PURPLE }]}>Fotos</Text>
          </Pressable>
          <Pressable onPress={doSubmit} disabled={!allCaptured} style={[styles.cta, { backgroundColor: allCaptured ? PURPLE : theme.borderStrong ?? '#ccc', flex: 1.6 }]}>
            <MaterialCommunityIcons name="cloud-upload-outline" size={18} color="#fff" />
            <Text style={styles.ctaText}>{allCaptured ? 'Produkt einreichen' : `Noch ${PRODUCT_PHOTO_STEPS.length - capturedCount}`}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // uploading
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 }}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
      <ActivityIndicator size="large" color={PURPLE} />
      <Text style={{ color: theme.text, fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.bold as any, fontSize: 18 }}>
        Produkt wird hochgeladen
      </Text>
      <Text style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 14 }}>{uploadPct} %</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 10 },
  hTitle: { fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.bold as any, fontSize: 18 },
  hSub: { fontFamily: fontFamilyVariants.body, fontSize: 12, marginTop: 1 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },
  cta: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  ctaOutline: { borderWidth: 1, backgroundColor: 'transparent' },
  ctaText: { color: '#fff', fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 15 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1 },
  stepNum: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  // camera
  camRoot: { flex: 1, backgroundColor: '#000' },
  permTitle: { color: '#fff', fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.bold as any, fontSize: 18, marginTop: 10 },
  camTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, backgroundColor: 'rgba(0,0,0,0.45)' },
  camTitle: { color: '#fff', fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.bold as any, fontSize: 16 },
  camSub: { color: 'rgba(255,255,255,0.8)', fontFamily: fontFamilyVariants.body, fontSize: 12, marginTop: 2, textAlign: 'center' },
  frameWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '78%', height: '52%' },
  corner: { position: 'absolute', width: 26, height: 26, borderColor: '#fff' },
  cTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  cTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  cBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  cBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  chipsRow: { position: 'absolute', left: 0, right: 0 },
  stepChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  stepChipText: { color: '#fff', fontFamily: fontFamilyVariants.body, fontSize: 12, fontWeight: fontWeight.medium as any },
  camBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 16, backgroundColor: 'rgba(0,0,0,0.45)' },
  shutter: { width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#fff' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  // review
  thumb: { width: '31%', aspectRatio: 0.8, borderRadius: 12, borderWidth: 1.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbLabel: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 6, paddingVertical: 4 },
  thumbCheck: { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1 },
});
