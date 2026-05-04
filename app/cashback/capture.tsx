/**
 * Bon Capture Screen — Phase 1.5.2 (Document Scanner).
 *
 * Primary flow uses react-native-document-scanner-plugin which wraps:
 *   - iOS: Apple VisionKit (VNDocumentCameraViewController) — auto
 *     edge-detection, auto-perspective-correction, auto-rotation
 *     (same engine Apple Notes uses)
 *   - Android: Google ML-Kit Document Scanner — same auto-magic
 *
 * The user gets a NATIVE camera UI with green outline that locks onto
 * the bon, snaps automatically when stable, returns a perspective-
 * corrected JPEG. No more crooked bons, no manual cropping.
 *
 * Fallback: when the native module isn't available (dev-client not
 * rebuilt yet), we drop back to a plain expo-camera + gallery picker.
 *
 * After capture: navigate to /cashback/review with the cropped URI.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Camera, CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, useNavigation } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  InteractionManager,
  Linking,
  NativeModules,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TurboModuleRegistry,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { hasValidCashbackConsent } from '@/lib/services/cashbackService';
import { buildCapturedBon } from '@/lib/utils/cashbackImage';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const FRAME_WIDTH = SCREEN_W * 0.82;
const FRAME_HEIGHT = SCREEN_H * 0.55;
const CORNER_LEN = 28;
const CORNER_THICK = 3;

/**
 * Probe whether the DocumentScanner native module is registered with
 * React Native's bridge. We do this BEFORE attempting to import the JS
 * package because the package's index.ts uses `TurboModuleRegistry
 * .getEnforcing()` at module-eval time — if the native side is
 * missing, that throws and Metro's dev-mode LogBox shows a red
 * full-screen error even if downstream catches it. Probing first lets
 * us skip the import entirely on dev-clients that haven't been rebuilt
 * with the native module linked.
 */
function isDocumentScannerLinked(): boolean {
  try {
    if ((NativeModules as any)?.DocumentScanner) return true;
    const tm: any = TurboModuleRegistry as any;
    if (typeof tm?.get === 'function' && tm.get('DocumentScanner')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Try the native Document Scanner. Returns 'unavailable' if the
 * package isn't linked into the dev-client (caller falls back to
 * expo-camera + manual capture).
 */
async function tryDocumentScanner(): Promise<string | null | 'cancel' | 'unavailable'> {
  if (!isDocumentScannerLinked()) return 'unavailable';
  try {
    const mod: any = await import('react-native-document-scanner-plugin');
    const Scanner = mod?.default ?? mod;
    if (!Scanner?.scanDocument) return 'unavailable';

    const result = await Scanner.scanDocument({
      croppedImageQuality: 90,
      maxNumDocuments: 1,
      responseType: 'imageFilePath',
    });

    if (result?.status === 'cancel') return 'cancel';
    const uri = result?.scannedImages?.[0];
    return uri ? String(uri) : null;
  } catch (e: any) {
    const msg = String(e?.message || e?.code || '');
    if (/not.*registered|nativemodule|TurboModule|requireNativeModule/i.test(msg)) {
      return 'unavailable';
    }
    console.warn('⚠️ Document Scanner failed:', msg);
    return null;
  }
}

export default function CashbackCaptureScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user } = useAuth();
  const { theme } = useTokens();

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [capturing, setCapturing] = useState(false);
  // 'unknown' = haven't tried scanner yet. 'available' = use native.
  // 'unavailable' = drop to expo-camera fallback UI.
  const [scannerState, setScannerState] = useState<'unknown' | 'available' | 'unavailable'>('unknown');
  const cameraRef = useRef<CameraView>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Defer camera mount until interactions settle (avoids first-paint
  // jank that bites Android, same trick as barcode-scanner).
  useEffect(() => {
    const t = InteractionManager.runAfterInteractions(() => setCameraReady(true));
    return () => t.cancel();
  }, []);

  // Hard guard: redirect back to consent if user hasn't accepted.
  useEffect(() => {
    let alive = true;
    if (!user?.uid) {
      router.replace('/cashback/consent');
      return;
    }
    (async () => {
      const valid = await hasValidCashbackConsent(user.uid);
      if (alive && !valid) router.replace('/cashback/consent');
    })();
    return () => {
      alive = false;
    };
  }, [user?.uid]);

  const goReview = useCallback(
    async (uri: string, source: 'live_camera' | 'upload') => {
      // We don't get pixel dimensions back from the doc scanner —
      // buildCapturedBon will pull file size + hash, dimensions stay 0
      // and the review/crop screens compute aspect ratio from the
      // image itself.
      const bon = await buildCapturedBon(uri, 0, 0);
      router.replace({
        pathname: '/cashback/review',
        params: {
          uri: bon.uri,
          width: String(bon.width),
          height: String(bon.height),
          hash: bon.bytesHash,
          brightness: String(bon.approxBrightness),
          size: String(bon.sizeBytes),
          source,
        },
      });
    },
    [],
  );

  // On mount: just probe for the native scanner so we know which UI
  // to render. We do NOT auto-launch — that bites the navigation
  // animation (capture page slides in from rewards while the native
  // modal opens, leading to a confusing reveal on cancel).
  useEffect(() => {
    if (scannerState !== 'unknown') return;
    setScannerState(isDocumentScannerLinked() ? 'available' : 'unavailable');
  }, [scannerState]);

  const launchScannerAgain = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const result = await tryDocumentScanner();
      if (result === 'unavailable') {
        setScannerState('unavailable');
        return;
      }
      // On cancel: just stay on the picker UI — user can try again
      // or pick from gallery instead.
      if (typeof result === 'string') {
        await goReview(result, 'live_camera');
      }
    } finally {
      setCapturing(false);
    }
  }, [capturing, goReview]);

  // ─── Fallback flow (expo-camera) ─────────────────────────────────

  const ensurePermission = useCallback(async (): Promise<boolean> => {
    const current = await Camera.getCameraPermissionsAsync();
    if (current.status === 'granted') return true;
    if (current.status === 'undetermined') {
      const requested = await requestPermission();
      if (requested.status === 'granted') return true;
    }
    Alert.alert(
      'Kamera-Zugriff blockiert',
      'Bitte erlaube den Zugriff in den Einstellungen, um deinen Bon zu fotografieren.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Einstellungen', onPress: () => Linking.openSettings() },
      ],
    );
    return false;
  }, [requestPermission]);

  const handleCaptureFallback = useCallback(async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
        exif: false,
      });
      if (!photo?.uri) throw new Error('takePictureAsync returned no URI');
      await goReview(photo.uri, 'live_camera');
    } catch (error: any) {
      console.warn('⚠️ Bon capture failed:', error);
      Alert.alert('Aufnahme fehlgeschlagen', 'Bitte versuch es noch einmal.');
    } finally {
      setCapturing(false);
    }
  }, [capturing, goReview]);

  const handlePickFromGallery = useCallback(async () => {
    try {
      const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!lib.granted) {
        Alert.alert(
          'Kein Foto-Zugriff',
          'Wir brauchen Zugriff auf deine Fotos, um einen bestehenden Bon-Scan auszuwählen.',
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.9,
        exif: false,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const a = result.assets[0];

      // Try iOS auto edge-detection + perspective correction first
      // (Apple VisionKit). On success we skip the manual crop screen
      // and go straight to review with a clean, flat bon image.
      // On Android (where the native module is a stub) and on iOS
      // when no clear quad is found, the JS layer falls back to
      // the manual crop screen.
      try {
        const { detectAndCropDocument } = await import('bon-edge-detector');
        const auto = await detectAndCropDocument(a.uri);
        if (auto) {
          await goReview(auto.uri, 'upload');
          return;
        }
      } catch (e: any) {
        console.warn('⚠️ auto-crop unavailable:', e?.message);
      }

      // Fallback: manual crop screen.
      router.replace({
        pathname: '/cashback/crop',
        params: {
          uri: a.uri,
          width: String(a.width ?? 0),
          height: String(a.height ?? 0),
          source: 'upload',
        },
      });
    } catch (error: any) {
      console.warn('⚠️ Gallery pick failed:', error);
    }
  }, [goReview]);

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  // ─── Render: primary state is a thin "opening scanner" splash ─────

  if (scannerState === 'unknown') {
    return (
      <View style={[styles.permGate, { backgroundColor: theme.bg ?? '#fff' }]}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.permCenter}>
          <ActivityIndicator color={theme.primary ?? '#0d8575'} size="large" />
          <Text style={[styles.permBody, { marginTop: 14, color: theme.textSub ?? '#5c6769' }]}>
            Bon-Scanner wird geöffnet …
          </Text>
        </View>
      </View>
    );
  }

  if (scannerState === 'available') {
    // Picker UI — shown either before the user opens the scanner for
    // the first time (rare; scanner auto-launches on mount) or AFTER
    // they cancel out of the native scanner. Two clear options: scan
    // a new bon, or pick a photo from the gallery.
    return (
      <View style={[styles.permGate, { backgroundColor: theme.bg ?? '#fff' }]}>
        <StatusBar barStyle="dark-content" />
        <View
          style={[
            styles.topBar,
            { paddingTop: insets.top + 8, backgroundColor: 'transparent' },
          ]}
        >
          <Pressable onPress={handleBack} style={styles.iconButton} hitSlop={10}>
            <MaterialCommunityIcons name="close" size={26} color={theme.text ?? '#191c1d'} />
          </Pressable>
        </View>
        <View style={styles.permCenter}>
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              backgroundColor: (theme.primary ?? '#0d8575') + '18',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 4,
            }}
          >
            <MaterialCommunityIcons
              name="line-scan"
              size={42}
              color={theme.primary ?? '#0d8575'}
            />
          </View>
          <Text style={[styles.permTitle, { color: theme.text ?? '#191c1d' }]}>
            Bon einreichen
          </Text>
          <Text
            style={[
              styles.permBody,
              { color: theme.textSub ?? '#5c6769', maxWidth: 320 },
            ]}
          >
            Wähle, wie du deinen Bon übermitteln möchtest. Der Scanner erkennt Ränder
            automatisch und richtet das Bild gerade aus.
          </Text>
          <Pressable
            onPress={launchScannerAgain}
            style={[
              styles.primaryButton,
              { backgroundColor: theme.primary ?? '#0d8575', width: '80%', marginTop: 24, flexDirection: 'row', gap: 8, justifyContent: 'center' },
            ]}
            disabled={capturing}
          >
            {capturing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialCommunityIcons name="line-scan" size={18} color="#fff" />
                <Text style={styles.primaryButtonText}>Bon scannen</Text>
              </>
            )}
          </Pressable>
          <Pressable
            onPress={handlePickFromGallery}
            style={{
              marginTop: 10,
              width: '80%',
              paddingVertical: 14,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.border ?? 'rgba(0,0,0,0.1)',
              alignItems: 'center',
              flexDirection: 'row',
              gap: 8,
              justifyContent: 'center',
              backgroundColor: 'transparent',
            }}
          >
            <MaterialCommunityIcons
              name="image-outline"
              size={18}
              color={theme.text ?? '#191c1d'}
            />
            <Text
              style={{
                color: theme.text ?? '#191c1d',
                fontFamily: fontFamily.body,
                fontWeight: fontWeight.bold as any,
                fontSize: 15,
              }}
            >
              Aus Galerie wählen
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── Fallback: classic expo-camera (no native scanner installed) ───

  if (!permission) {
    return (
      <View style={styles.permLoading}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.permGate}>
        <StatusBar barStyle="light-content" />
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={handleBack} style={styles.iconButton} hitSlop={10}>
            <MaterialCommunityIcons name="close" size={26} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.permCenter}>
          <MaterialCommunityIcons name="camera-off-outline" size={56} color="#fff" />
          <Text style={styles.permTitle}>Kamera-Zugriff fehlt</Text>
          <Text style={styles.permBody}>
            Wir brauchen Zugriff auf deine Kamera, um deinen Bon zu fotografieren.
          </Text>
          <Pressable onPress={ensurePermission} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Zugriff erlauben</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      {cameraReady ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={'back' as CameraType}
          enableTorch={flashOn}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
      )}

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={handleBack} style={styles.iconButton} hitSlop={10}>
          <MaterialCommunityIcons name="close" size={26} color="#fff" />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Bon scannen</Text>
          <Text style={styles.subtitle}>Halte den Bon flach im Rahmen</Text>
        </View>
        <Pressable onPress={() => setFlashOn((v) => !v)} style={styles.iconButton} hitSlop={10}>
          <MaterialCommunityIcons name={flashOn ? 'flash' : 'flash-off'} size={24} color={flashOn ? '#ffd44b' : '#fff'} />
        </Pressable>
      </View>

      <View pointerEvents="none" style={styles.frameWrap}>
        <View style={styles.frame}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
      </View>

      <View style={styles.helperWrap} pointerEvents="none">
        <View style={styles.helperBubble}>
          <MaterialCommunityIcons name="information-outline" size={14} color="#fff" />
          <Text style={styles.helperText}>
            Alle 4 Ecken sichtbar · Hand ruhig halten · Reflexionen vermeiden
          </Text>
        </View>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable onPress={handlePickFromGallery} style={styles.iconButton} hitSlop={12}>
          <MaterialCommunityIcons name="image-outline" size={26} color="#fff" />
        </Pressable>
        <Pressable
          onPress={handleCaptureFallback}
          disabled={capturing || !cameraReady}
          style={({ pressed }) => [
            styles.shutter,
            (pressed || capturing) && { transform: [{ scale: 0.94 }] },
            (capturing || !cameraReady) && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Bon fotografieren"
        >
          <View style={styles.shutterInner}>
            {capturing ? (
              <ActivityIndicator color="#0d8575" />
            ) : (
              <MaterialCommunityIcons name="camera-outline" size={28} color="#0d8575" />
            )}
          </View>
        </Pressable>
        <View style={styles.iconButton} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  permLoading: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  permGate: { flex: 1, backgroundColor: '#0a0a0a' },
  permCenter: { flex: 1, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center', gap: 14 },
  permTitle: { color: '#fff', fontFamily: fontFamily.heading, fontWeight: fontWeight.bold as any, fontSize: 20, marginTop: 8 },
  permBody: { color: 'rgba(255,255,255,0.78)', fontFamily: fontFamily.body, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  primaryButton: { marginTop: 20, backgroundColor: '#0d8575', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14 },
  primaryButtonText: { color: '#fff', fontFamily: fontFamily.body, fontWeight: fontWeight.bold as any },
  secondaryButton: { marginTop: 6, paddingHorizontal: 24, paddingVertical: 12 },
  secondaryButtonText: { color: 'rgba(255,255,255,0.78)', fontFamily: fontFamily.body, fontSize: 14 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1, alignItems: 'center' },
  title: { color: '#fff', fontFamily: fontFamily.heading, fontWeight: fontWeight.bold as any, fontSize: 16 },
  subtitle: { color: 'rgba(255,255,255,0.78)', fontFamily: fontFamily.body, fontSize: 12, marginTop: 2 },
  frameWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  frame: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
  corner: { position: 'absolute', width: CORNER_LEN, height: CORNER_LEN, borderColor: '#ffd44b' },
  cornerTL: { top: 0, left: 0, borderTopWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK },
  cornerTR: { top: 0, right: 0, borderTopWidth: CORNER_THICK, borderRightWidth: CORNER_THICK },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_THICK, borderRightWidth: CORNER_THICK },
  helperWrap: { position: 'absolute', top: '12%', left: 0, right: 0, alignItems: 'center' },
  helperBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  helperText: { color: '#fff', fontFamily: fontFamily.body, fontSize: 12 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
