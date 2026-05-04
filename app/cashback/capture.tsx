/**
 * Bon Capture Screen — Phase 1.5 (expo-camera based).
 *
 * Pragmatic capture flow that ships now without a dev-client rebuild.
 * Phase 1.5.1 will swap the camera for ML-Kit Document Scanner and
 * keep the same screen shell.
 *
 * Flow:
 *   - Permission gate (handled by useCameraPermissions)
 *   - Full-screen camera preview
 *   - Overlay frame guide (4-corner brackets) so user aligns the bon
 *   - Helper text: "Bon flach hinlegen, alle 4 Ecken im Rahmen"
 *   - Capture button → expo-camera takePictureAsync → buildCapturedBon
 *   - On capture → router.push('/cashback/review?...') with the URI
 *   - Manual override: "Aus Galerie wählen" via expo-image-picker
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
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontWeight } from '@/constants/tokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import {
  hasValidCashbackConsent,
} from '@/lib/services/cashbackService';
import { buildCapturedBon } from '@/lib/utils/cashbackImage';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Bon-frame proportions: typical thermal bons are 80mm wide × 200-400mm
// long. We use a 0.55-aspect frame (taller than barcode-scanner's 0.45)
// to encourage users to capture more vertical content.
const FRAME_WIDTH = SCREEN_W * 0.82;
const FRAME_HEIGHT = SCREEN_H * 0.55;
const CORNER_LEN = 28;
const CORNER_THICK = 3;

export default function CashbackCaptureScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user } = useAuth();

  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [capturing, setCapturing] = useState(false);
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

  const handleCapture = useCallback(async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
        exif: false,
      });
      if (!photo?.uri) {
        throw new Error('takePictureAsync returned no URI');
      }
      const bon = await buildCapturedBon(photo.uri, photo.width ?? 0, photo.height ?? 0);
      router.push({
        pathname: '/cashback/review',
        params: {
          uri: bon.uri,
          width: String(bon.width),
          height: String(bon.height),
          hash: bon.bytesHash,
          brightness: String(bon.approxBrightness),
          size: String(bon.sizeBytes),
          source: 'live_camera',
        },
      });
    } catch (error: any) {
      console.warn('⚠️ Bon capture failed:', error);
      Alert.alert('Aufnahme fehlgeschlagen', 'Bitte versuch es noch einmal.');
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

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
      const bon = await buildCapturedBon(a.uri, a.width ?? 0, a.height ?? 0);
      router.push({
        pathname: '/cashback/review',
        params: {
          uri: bon.uri,
          width: String(bon.width),
          height: String(bon.height),
          hash: bon.bytesHash,
          brightness: String(bon.approxBrightness),
          size: String(bon.sizeBytes),
          source: 'upload',
        },
      });
    } catch (error: any) {
      console.warn('⚠️ Gallery pick failed:', error);
    }
  }, []);

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  // Permission states
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

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={handleBack} style={styles.iconButton} hitSlop={10}>
          <MaterialCommunityIcons name="close" size={26} color="#fff" />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Bon scannen</Text>
          <Text style={styles.subtitle}>Halte den Bon flach im Rahmen</Text>
        </View>
        <Pressable
          onPress={() => setFlashOn((v) => !v)}
          style={styles.iconButton}
          hitSlop={10}
        >
          <MaterialCommunityIcons
            name={flashOn ? 'flash' : 'flash-off'}
            size={24}
            color={flashOn ? '#ffd44b' : '#fff'}
          />
        </Pressable>
      </View>

      {/* Frame overlay — 4 corner brackets defining the bon area */}
      <View pointerEvents="none" style={styles.frameWrap}>
        <View style={styles.frame}>
          {/* corners */}
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
      </View>

      {/* Helper text */}
      <View style={styles.helperWrap} pointerEvents="none">
        <View style={styles.helperBubble}>
          <MaterialCommunityIcons name="information-outline" size={14} color="#fff" />
          <Text style={styles.helperText}>
            Alle 4 Ecken sichtbar · Hand ruhig halten · Reflexionen vermeiden
          </Text>
        </View>
      </View>

      {/* Bottom bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          onPress={handlePickFromGallery}
          style={styles.iconButton}
          hitSlop={12}
        >
          <MaterialCommunityIcons name="image-outline" size={26} color="#fff" />
        </Pressable>
        <Pressable
          onPress={handleCapture}
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
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  permLoading: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  permGate: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  permCenter: {
    flex: 1,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  permTitle: {
    color: '#fff',
    fontFamily: fontFamily.heading,
    fontWeight: fontWeight.bold as any,
    fontSize: 20,
    marginTop: 8,
  },
  permBody: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: fontFamily.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 20,
    backgroundColor: '#0d8575',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 999,
  },
  primaryButtonText: {
    color: '#fff',
    fontFamily: fontFamily.body,
    fontWeight: fontWeight.bold as any,
  },
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
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: { flex: 1, alignItems: 'center' },
  title: {
    color: '#fff',
    fontFamily: fontFamily.heading,
    fontWeight: fontWeight.bold as any,
    fontSize: 16,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: fontFamily.body,
    fontSize: 12,
    marginTop: 2,
  },
  frameWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
  },
  corner: {
    position: 'absolute',
    width: CORNER_LEN,
    height: CORNER_LEN,
    borderColor: '#ffd44b',
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK },
  cornerTR: { top: 0, right: 0, borderTopWidth: CORNER_THICK, borderRightWidth: CORNER_THICK },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_THICK, borderRightWidth: CORNER_THICK },
  helperWrap: {
    position: 'absolute',
    top: '12%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  helperBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  helperText: {
    color: '#fff',
    fontFamily: fontFamily.body,
    fontSize: 12,
  },
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
