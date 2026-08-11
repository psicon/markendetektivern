/**
 * Product-photo wizard ("voller Datensatz").
 *
 * Flow: pick market (once per session) → per product: optional name → 7
 * camera steps (front, back, manufacturer, EAN, nutrition, ingredients,
 * price) → review grid → upload + submit → "Mehr in diesem Markt?" → next
 * product (market remembered) or finish.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Camera, CameraType, CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { router, useNavigation } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
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

import {
  BonScanner,
  DEFAULT_SCANNER_TUNING,
  isBonScannerAvailable,
  scanBarcodeFromImage,
  type BonScannerHandle,
  type BonScannerQuality,
  type ScannerTuning,
} from 'bon-edge-detector';

import { MarketSelector } from '@/components/ui/MarketSelector';
import { fontFamilyVariants, fontWeight, radii } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import {
  PRODUCT_PHOTO_STEPS,
  getActiveProductCampaign,
  newImageBatchId,
  newSessionId,
  sanitizeForFilename,
  type ActiveProductCampaign,
  type ProductPhotoStep,
} from '@/lib/services/productSubmit';
import { isOnline } from '@/lib/services/network';
import { clientVersion, erfasseCaptureContext } from '@/lib/services/captureContext';
import { enqueueProductUpload } from '@/lib/services/uploadQueue';
import { showInfoToast } from '@/lib/services/ui/toast';

const PURPLE = '#5b4f9c';
const SCREEN_W = Dimensions.get('window').width;

// Readability tuning for PRODUCT LABELS (not receipts). The shipped defaults
// only accept tall, receipt-shaped documents (docMaxWHRatio 0.85) and demand
// the doc fill 55% of the frame height — a wide/square nutrition panel never
// qualifies, so the hint would be stuck on "Näher ran". These params accept
// any orientation and trigger "lesbar" once the label reasonably fills the
// frame. Device-independent (JS-driven), so the hint behaves the same on all
// phones.
const LABEL_TUNING: ScannerTuning = {
  ...DEFAULT_SCANNER_TUNING,
  docMinConfidence: 0.15,
  docMinArea: 0.1,
  docMaxArea: 0.99,
  docMaxWHRatio: 3.0,
  minReadableHeight: 0.44,
};

type Phase = 'market' | 'intro' | 'capture' | 'review';

export default function ProductWizardScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme } = useTokens();
  const scheme = useColorScheme();
  const { user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const docScannerRef = useRef<BonScannerHandle>(null);
  const barcodeHandledRef = useRef(false);
  const chipsScrollRef = useRef<ScrollView>(null);
  const chipXRef = useRef<number[]>([]);

  const [phase, setPhase] = useState<Phase>('market');
  const [sessionId] = useState(() => newSessionId());
  const [marketName, setMarketName] = useState('');
  const [marketId, setMarketId] = useState<string | null>(null);
  const [marketLand, setMarketLand] = useState<string | null>(null);
  const [productIndex, setProductIndex] = useState(1);
  const [productName, setProductName] = useState('');
  const [photos, setPhotos] = useState<Partial<Record<ProductPhotoStep, string>>>({});
  /** Wann das erste Foto dieser Einreichung entstand (siehe onCaptured). */
  const firstCaptureAtRef = useRef<number | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [capturing, setCapturing] = useState(false);
  // expo-camera MUSS bereit sein, bevor takePictureAsync aufgerufen wird —
  // sonst liefert CameraX den letzten Puffer der VORHERIGEN Kamera-Session
  // zurück (Foto des vorherigen Produkts). Das war die Ursache der
  // vertauschten Produktfotos (crowd_uploads-Kontamination, 2026-07-03):
  // der Wizard löste bei rapiden Einreichungen aus, bevor die Kamera streamte.
  // Der Cashback-Scanner gated genau so — nur der Wizard tat es bisher nicht.
  const [cameraReady, setCameraReady] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [campaign, setCampaign] = useState<ActiveProductCampaign | null>(null);
  const [quality, setQuality] = useState<BonScannerQuality>('none');
  const [eanCode, setEanCode] = useState<string | null>(null);
  // Galerie-EAN: iOS kann Strichcodes NICHT aus einem Standbild lesen
  // (expo-camera scanFromURLAsync = QR-only). Schlägt die Auto-Erkennung fehl,
  // hält dieser State das gewählte Bild + öffnet ein Zahlenfeld für die EAN.
  const [eanEntryUri, setEanEntryUri] = useState<string | null>(null);
  const [eanEntryValue, setEanEntryValue] = useState('');
  // True when the capture screen was opened to RE-shoot one photo from the
  // review grid — capturing then returns straight to review (no advancing),
  // and the top-left button reads "Abbrechen".
  const [editingFromReview, setEditingFromReview] = useState(false);
  // expo-camera (EAN/barcode) may only mount AFTER the native scanner's
  // AVCaptureSession has actually stopped — otherwise both sessions contend
  // for the back camera and AVFoundation deadlocks the main thread (whole-app
  // freeze on the hersteller→EAN handoff). The native scanner stays mounted
  // the whole capture phase; we toggle its session via isActive and wait for
  // its onSessionStopped event before mounting expo-camera.
  const [expoActive, setExpoActive] = useState(false);
  const stopFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Native scanner camera for everything EXCEPT the EAN step (it needs the
  // expo-camera barcode scanner). The native view has continuous autofocus,
  // which expo-camera's "focus-once-then-lock" lacks — so front/back stay
  // sharp too. rawCapture keeps it a plain photo (no doc overlay/crop).
  const useNativeCam = step.mode !== 'barcode' && isBonScannerAvailable;
  // The readability hint pill is only meaningful for flat text labels.
  const showReadability = step.mode === 'document' && useNativeCam;

  // Deterministic camera-stack handoff state.
  const nativeAvailable = isBonScannerAvailable;
  const wantBarcode = phase === 'capture' && step.mode === 'barcode';
  // Native scanner runs for every non-barcode step; its session is stopped the
  // moment we move to the EAN step.
  const bonActive = phase === 'capture' && nativeAvailable && !wantBarcode;
  // Show expo-camera for every step on platforms WITHOUT the native scanner,
  // or only for the barcode step (once the native session stopped) when it is
  // available.
  const showExpoCam = !nativeAvailable || (wantBarcode && expoActive);
  // Auslösen blockieren, solange die expo-Kamera aktiv, aber noch nicht bereit
  // ist (Stale-Frame-Schutz). Beim nativen Scanner (iOS non-EAN) irrelevant —
  // der hat seine eigene Bereitschaft, expo-cameraReady bleibt dort ungenutzt.
  const expoNotReady = showExpoCam && !cameraReady;

  // Re-arm the barcode scanner + reset the live hint whenever the step
  // changes (so re-entering the EAN step can scan again).
  useEffect(() => {
    barcodeHandledRef.current = false;
    setQuality('none');
  }, [stepIdx]);

  // Kamera-Bereitschaft zurücksetzen, sobald die expo-CameraView abgebaut
  // wird (iOS: nativ↔expo-Handoff pro EAN-Step; auch beim Verlassen der
  // Capture-Phase). Die neu gemountete Kamera muss onCameraReady erneut
  // feuern, bevor wieder ausgelöst werden darf — sonst Stale-Frame.
  useEffect(() => {
    if (!showExpoCam) setCameraReady(false);
  }, [showExpoCam]);

  // Keep the active step's pill scrolled into view (centered) so the user
  // always sees where they are in the strip.
  useEffect(() => {
    if (phase !== 'capture') return;
    const x = chipXRef.current[stepIdx];
    if (x == null) return;
    chipsScrollRef.current?.scrollTo({ x: Math.max(0, x - SCREEN_W / 2 + 50), animated: true });
  }, [stepIdx, phase]);

  // expo-camera mounts only after the native scanner confirms its session
  // stopped (onSessionStopped). The fallback timer keeps the flow working on
  // dev clients built before the native event existed.
  const onBonStopped = useCallback(() => {
    if (stopFallbackRef.current) {
      clearTimeout(stopFallbackRef.current);
      stopFallbackRef.current = null;
    }
    setExpoActive(true);
  }, []);

  useEffect(() => {
    if (!wantBarcode) {
      // Not on the barcode step → keep expo-camera torn down so its session
      // releases before the native scanner (re)starts.
      setExpoActive(false);
      if (stopFallbackRef.current) {
        clearTimeout(stopFallbackRef.current);
        stopFallbackRef.current = null;
      }
      return;
    }
    if (!nativeAvailable) {
      // expo is the only stack on this platform — nothing to hand off from.
      setExpoActive(true);
      return;
    }
    // Entering the barcode step with the native scanner mounted: bonActive is
    // now false, so BonScanner is stopping. Wait for its onSessionStopped
    // event (deterministic). The fallback covers builds without the event yet.
    const t = setTimeout(() => setExpoActive(true), 900);
    stopFallbackRef.current = t;
    return () => {
      clearTimeout(t);
      stopFallbackRef.current = null;
    };
  }, [wantBarcode, nativeAvailable]);

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
    setEditingFromReview(false);
    // Resume at the first missing step.
    const firstMissing = PRODUCT_PHOTO_STEPS.findIndex((s) => !photos[s.key]);
    setStepIdx(firstMissing === -1 ? 0 : firstMissing);
    setPhase('capture');
  }, [ensurePermission, photos]);

  // Jump to a specific step (from a thumbnail/pill tap) during the normal
  // capture flow. If it's already captured, an overwrite hint shows inline.
  const goToStep = useCallback((i: number) => {
    setStepIdx(i);
    setPhase('capture');
  }, []);

  // Store the captured uri for the current step. In edit-from-review mode we
  // go straight back to review; otherwise advance to the next missing step
  // (or review when nothing is missing).
  const onCaptured = useCallback(
    (uri: string) => {
      // Zeitpunkt des ERSTEN Fotos dieser Einreichung festhalten. Er ist der
      // ehrliche Bezugspunkt für jede Ortsangabe — das Firestore-Dokument
      // entsteht erst beim Flush der Warteschlange und kann Tage später und
      // an einem ganz anderen Ort angelegt werden.
      if (firstCaptureAtRef.current == null) firstCaptureAtRef.current = Date.now();
      setPhotos((p) => ({ ...p, [step.key]: uri }));
      if (editingFromReview) {
        setEditingFromReview(false);
        setPhase('review');
        return;
      }
      const next = PRODUCT_PHOTO_STEPS.findIndex((s, i) => i > stepIdx && !photos[s.key]);
      if (next === -1) {
        const anyMissing = PRODUCT_PHOTO_STEPS.findIndex((s) => s.key !== step.key && !photos[s.key]);
        if (anyMissing === -1) setPhase('review');
        else setStepIdx(anyMissing);
      } else {
        setStepIdx(next);
      }
    },
    [step, stepIdx, photos, editingFromReview],
  );

  const shootCamera = useCallback(async () => {
    if (!cameraRef.current) return;
    // HART: nie auslösen, bevor CameraX bereit ist (Stale-Frame-Schutz).
    // Ohne diese Zeile liefert takePictureAsync den letzten Frame der
    // vorherigen Kamera-Session zurück → vertauschte Produktfotos.
    if (!cameraReady) return;
    setCapturing(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, skipProcessing: false });
      if (!photo?.uri) throw new Error('no-uri');
      onCaptured(photo.uri);
    } catch {
      Alert.alert('Aufnahme fehlgeschlagen', 'Bitte versuch es noch einmal.');
    } finally {
      setCapturing(false);
    }
  }, [onCaptured, cameraReady]);

  // Shutter dispatches by capture mode: document → native doc scanner
  // (flat OCR-friendly crop), else the plain camera.
  const onShutter = useCallback(async () => {
    if (capturing) return;
    if (useNativeCam) {
      if (!docScannerRef.current) return;
      setCapturing(true);
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        const res = await docScannerRef.current.capture();
        if (res?.uri) onCaptured(res.uri);
      } catch {
        Alert.alert('Aufnahme fehlgeschlagen', 'Bitte versuch es noch einmal.');
      } finally {
        setCapturing(false);
      }
    } else {
      await shootCamera();
    }
  }, [capturing, useNativeCam, onCaptured, shootCamera]);

  // EAN/barcode auto-capture: on the first valid scan of the EAN step,
  // store the code + grab the frame (the code rides into the filename).
  const handleBarcode = useCallback(
    async (e: { data?: string }) => {
      if (step.key !== 'ean' || barcodeHandledRef.current || capturing) return;
      // Kamera noch nicht bereit → Scan NICHT konsumieren (Ref nicht setzen),
      // damit der nächste Frame ihn erneut liefern kann, sobald bereit.
      if (!cameraReady) return;
      const code = (e?.data || '').trim();
      if (!code) return;
      barcodeHandledRef.current = true;
      setEanCode(code);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      await shootCamera();
    },
    [step.key, capturing, cameraReady, shootCamera],
  );

  // Bild aus der Galerie wählen — Alternative zur Live-Aufnahme (war in der
  // alten App möglich). VOLLE Qualität, keine Kompression (CLAUDE.md: die
  // Server-Analyse braucht scharfe Labels für OCR/EAN). Für den EAN-Schritt
  // wird der Barcode aus dem gewählten Bild gelesen (scanFromURLAsync); ist
  // keiner lesbar, bleibt der Live-Scan die Option.
  const pickFromGallery = useCallback(async () => {
    if (capturing) return;
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Kein Foto-Zugriff',
          'Wir brauchen Zugriff auf deine Fotos, um ein Bild aus der Galerie zu wählen. Du kannst das in den Einstellungen erlauben.',
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1, // volle Qualität für die Analyse — NICHT komprimieren
        exif: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;
      const uri = result.assets[0].uri;
      // EAN-Schritt: Barcode aus dem gewählten Bild lesen. Klappt auf Android
      // (ML Kit); auf iOS liest scanFromURLAsync NUR QR-Codes → 1D-EAN wird nie
      // erkannt. Schlägt die Auto-Erkennung fehl, öffnen wir das EAN-Zahlenfeld
      // (statt einer Sackgasse) und übernehmen das Bild nach der Eingabe.
      if (step.mode === 'barcode') {
        setCapturing(true);
        let code = '';
        try {
          // 1) Native Apple Vision (iOS) — liest 1D-EAN aus dem Standbild.
          //    Im aktuellen Dev-Binary evtl. noch nicht vorhanden → null.
          code = (await scanBarcodeFromImage(uri)) || '';
          // 2) Fallback expo-camera (Android = ML Kit ✓; iOS = QR-only).
          if (!code) {
            const scans = await scanFromURLAsync(uri, ['ean13', 'ean8', 'upc_a', 'upc_e']);
            code = (scans?.[0]?.data || '').trim();
          }
        } catch {
          code = '';
        } finally {
          setCapturing(false);
        }
        if (!code) {
          setEanEntryValue('');
          setEanEntryUri(uri); // öffnet das Eingabe-Overlay
          return;
        }
        setEanCode(code);
        barcodeHandledRef.current = true;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      onCaptured(uri);
    } catch {
      Alert.alert('Galerie-Auswahl fehlgeschlagen', 'Bitte versuch es noch einmal.');
    }
  }, [capturing, step.mode, onCaptured]);

  // Manuell eingegebene EAN übernehmen (Fallback, wenn der Code nicht aus dem
  // Galeriebild gelesen werden konnte). Akzeptiert 8–14 Ziffern (EAN-8/13,
  // UPC-A/E). Das gewählte Bild wird als EAN-Foto übernommen.
  const confirmManualEan = useCallback(() => {
    const digits = eanEntryValue.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 14) {
      Alert.alert('Ungültige EAN', 'Bitte gib die 8–13-stellige Nummer unter dem Strichcode ein.');
      return;
    }
    const uri = eanEntryUri;
    setEanCode(digits);
    barcodeHandledRef.current = true;
    setEanEntryUri(null);
    setEanEntryValue('');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (uri) onCaptured(uri);
  }, [eanEntryValue, eanEntryUri, onCaptured]);

  // ─── Submit ───────────────────────────────────────────────────────
  const doSubmit = useCallback(async () => {
    if (!user?.uid || !allCaptured) return;
    // Hand the captured set to the background upload queue. Enqueue is
    // near-instant (copies images to a persistent dir + writes the queue,
    // no network), so we never block on a foreground "uploading" screen.
    // Progress + retry live in the product-submit overview — one status
    // surface, no orphaned overlays even with many offline submissions.
    // Eindeutiger Batch-Token pro Einreichung → hängt an JEDEN Bild-Dateinamen
    // (front_<batch>.jpg, zutaten_<batch>.jpg …). Verhindert Basename-Kollisionen
    // über Einreichungen/User hinweg (Schutz gegen Basename-gekeyte Server-
    // Verarbeitung; siehe newImageBatchId). Alle Bilder dieser Einreichung teilen
    // denselben Token → als Set erkennbar / nachordenbar.
    const batchId = newImageBatchId();
    const steps = PRODUCT_PHOTO_STEPS.reduce<
      { key: ProductPhotoStep; uri: string; fileName?: string }[]
    >((acc, s) => {
      const local = photos[s.key];
      if (!local) return acc;
      // EAN-Basisname trägt zusätzlich den gescannten Code.
      const base = s.key === 'ean' && eanCode ? `ean_${sanitizeForFilename(eanCode)}` : s.key;
      acc.push({ key: s.key, uri: local, fileName: `${base}_${batchId}.jpg` });
      return acc;
    }, []);

    // Orts-/Zeitkontext HIER erfassen, nicht beim Upload: `submitProduct`
    // läuft erst, wenn die Warteschlange flusht — unter Umständen Tage
    // später und an einem anderen Ort. Blockiert nie länger als ein paar
    // Sekunden und wirft nie.
    const capture = await erfasseCaptureContext({
      capturedAt: firstCaptureAtRef.current ?? Date.now(),
    });

    try {
      await enqueueProductUpload({
        uid: user.uid,
        sessionId,
        productIndex,
        marketId,
        marketName,
        marketLand,
        productName: productName.trim() || null,
        ean: eanCode,
        campaignId: campaign?.campaignId ?? null,
        steps,
        capture,
        clientVersion: clientVersion(),
      });
    } catch (e: any) {
      console.warn('enqueue product upload failed', e?.message);
      showInfoToast('Konnte nicht vorgemerkt werden — bitte nochmal.', 'error');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const online = isOnline();
    showInfoToast(
      online
        ? 'Produkt eingereicht — lädt im Hintergrund hoch.'
        : 'Gespeichert — lädt automatisch hoch, sobald du wieder online bist.',
      'success',
    );
    // Fires instantly (we're still on the wizard at this moment), so it's
    // never an orphan overlay on another screen.
    Alert.alert(
      'Produkt eingereicht 🎉',
      online
        ? 'Es lädt im Hintergrund hoch. Weiteres Produkt in diesem Markt erfassen?'
        : 'Kein Internet gerade — es lädt automatisch hoch, sobald du wieder online bist. Weiteres Produkt in diesem Markt erfassen?',
      [
      {
        text: 'Fertig',
        style: 'cancel',
        // Pop the wizard back to the already-open overview (don't stack a
        // second one). Fallback to replace if there's nothing below.
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
          setEanCode(null);
          setProductIndex((n) => n + 1);
          setStepIdx(0);
          setPhase('intro');
        },
      },
    ]);
  }, [user?.uid, allCaptured, photos, sessionId, productIndex, marketId, marketName, marketLand, productName, eanCode, campaign?.campaignId]);

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
            setMarketLand((m as any).land ?? null);
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
    const captured = !!photos[step.key];
    let subText: string;
    let subColor: string;
    if (step.mode === 'barcode') {
      if (captured) {
        subText = `Neuaufnahme — bisher EAN ${eanCode ?? '—'}. Neuen Barcode einlesen.`;
        subColor = '#ffd44b';
      } else if (eanCode) {
        subText = `EAN erkannt: ${eanCode}`;
        subColor = '#5ee0a0';
      } else {
        subText = 'Über den EAN-Barcode heben, bis er automatisch eingelesen wird.';
        subColor = 'rgba(255,255,255,0.82)';
      }
    } else if (captured) {
      subText = 'Neuaufnahme — überschreibt das bisherige Bild';
      subColor = '#ffd44b';
    } else if (showReadability) {
      // Static guidance in the subtitle; the live readability state is shown
      // as its own pill (below) so this never reads like a doc scanner.
      subText = step.hint;
      subColor = 'rgba(255,255,255,0.82)';
    } else {
      subText = step.hint;
      subColor = 'rgba(255,255,255,0.82)';
    }

    return (
      <View style={styles.camRoot}>
        <StatusBar barStyle="light-content" />
        {/* Native scanner stays mounted for the whole capture phase; its
            session is toggled via isActive. expo-camera (barcode) is mounted
            only once the native session has stopped (onBonStopped / fallback),
            so the two AVCaptureSessions never overlap → no main-thread
            deadlock on the hersteller→EAN handoff. */}
        {nativeAvailable ? (
          <BonScanner
            ref={docScannerRef}
            style={StyleSheet.absoluteFill}
            isActive={bonActive}
            torch={flashOn && bonActive}
            rawCapture
            tuning={LABEL_TUNING}
            onQuality={setQuality}
            onSessionStopped={onBonStopped}
          />
        ) : null}
        {!showExpoCam && nativeAvailable && !bonActive ? (
          // Brief gap while the native session releases and before expo mounts.
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />
        ) : null}
        {showExpoCam ? (
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={'back' as CameraType}
            autofocus="on"
            enableTorch={flashOn}
            // Erst wenn CameraX wirklich streamt, darf ausgelöst werden
            // (sonst Stale-Frame der vorherigen Session).
            onCameraReady={() => setCameraReady(true)}
            barcodeScannerSettings={
              step.mode === 'barcode'
                ? { barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }
                : undefined
            }
            onBarcodeScanned={step.mode === 'barcode' ? handleBarcode : undefined}
          />
        ) : null}

        {/* top bar */}
        <View style={[styles.camTop, { paddingTop: insets.top + 8 }]}>
          {editingFromReview ? (
            <Pressable
              onPress={() => {
                setEditingFromReview(false);
                setPhase('review');
              }}
              hitSlop={10}
              style={styles.cancelBtn}
            >
              <Text style={styles.cancelText}>Abbrechen</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setPhase('intro')} style={styles.iconBtn} hitSlop={10}>
              <MaterialCommunityIcons name="arrow-left" size={24} color="#fff" />
            </Pressable>
          )}
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.camTitle}>{step.label}</Text>
            <Text style={[styles.camSub, { color: subColor }]}>{subText}</Text>
          </View>
          <Pressable onPress={() => setFlashOn((v) => !v)} style={styles.iconBtn} hitSlop={10}>
            <MaterialCommunityIcons name={flashOn ? 'flash' : 'flash-off'} size={22} color={flashOn ? '#ffd44b' : '#fff'} />
          </Pressable>
        </View>

        {/* framing guide — a rectangle for label steps (panel-shaped) and a
            smaller horizontal one for the EAN step (barcode-shaped). Anchored
            between the header and the thumbnail strip so it never sits behind
            the pills, on any screen size. NOT shown for front/back. */}
        {step.mode === 'document' || step.mode === 'barcode' ? (
          <View
            pointerEvents="none"
            style={[styles.guideWrap, { top: insets.top + 72, bottom: insets.bottom + 278 }]}
          >
            <View style={step.mode === 'barcode' ? styles.guideBarcode : styles.guideDoc} />
          </View>
        ) : null}

        {/* readability pill — ONLY for text/label steps. A plain hint of
            whether the label is big/clear enough; NOT a doc scanner. */}
        {showReadability && !captured ? (
          <View pointerEvents="none" style={[styles.readPillWrap, { bottom: insets.bottom + 232 }]}>
            <View
              style={[
                styles.readPill,
                { backgroundColor: quality === 'ok' ? 'rgba(46,170,120,0.94)' : 'rgba(0,0,0,0.62)' },
              ]}
            >
              <MaterialCommunityIcons
                name={quality === 'ok' ? 'check-circle' : 'image-filter-center-focus-weak'}
                size={15}
                color="#fff"
              />
              <Text style={styles.readPillText}>
                {quality === 'ok' ? 'Gut lesbar' : 'Näher ran — Label größer'}
              </Text>
            </View>
          </View>
        ) : null}

        {/* step thumbnails + pills — preview above each pill, tap to (re)shoot */}
        <View style={[styles.chipsRow, { bottom: insets.bottom + 112 }]}>
          <ScrollView ref={chipsScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16, alignItems: 'flex-end' }}>
            {PRODUCT_PHOTO_STEPS.map((s, i) => {
              const done = !!photos[s.key];
              const active = i === stepIdx;
              return (
                <Pressable
                  key={s.key}
                  onPress={() => goToStep(i)}
                  onLayout={(e) => {
                    chipXRef.current[i] = e.nativeEvent.layout.x;
                  }}
                  style={{ alignItems: 'center', gap: 5 }}
                >
                  <View
                    style={[
                      styles.chipThumb,
                      { borderColor: active ? '#fff' : done ? PURPLE : 'rgba(255,255,255,0.3)' },
                    ]}
                  >
                    {done ? (
                      <ExpoImage source={{ uri: photos[s.key] }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                    ) : (
                      <MaterialCommunityIcons name={s.icon as any} size={20} color="rgba(255,255,255,0.6)" />
                    )}
                    {done ? (
                      <View style={styles.chipThumbCheck}>
                        <MaterialCommunityIcons name="check" size={10} color="#fff" />
                      </View>
                    ) : null}
                  </View>
                  <View style={[styles.stepChip, { backgroundColor: active ? PURPLE : done ? 'rgba(91,79,156,0.55)' : 'rgba(0,0,0,0.5)' }]}>
                    <Text style={styles.stepChipText}>{s.label}</Text>
                  </View>
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
            onPress={onShutter}
            disabled={capturing || expoNotReady}
            style={({ pressed }) => [
              styles.shutter,
              captured && { borderColor: '#ffd44b' },
              quality === 'ok' && { borderColor: '#5ee0a0' },
              expoNotReady && { opacity: 0.5 },
              (pressed || capturing) && { transform: [{ scale: 0.94 }] },
            ]}
          >
            <View style={styles.shutterInner}>
              {capturing || expoNotReady ? <ActivityIndicator color={PURPLE} /> : <MaterialCommunityIcons name="camera-outline" size={28} color={PURPLE} />}
            </View>
          </Pressable>
          <Pressable onPress={pickFromGallery} disabled={capturing} style={styles.iconBtn} hitSlop={12}>
            <MaterialCommunityIcons
              name="image-multiple-outline"
              size={26}
              color={capturing ? 'rgba(255,255,255,0.4)' : '#fff'}
            />
          </Pressable>
        </View>

        {/* EAN-Eingabe-Overlay — Fallback, wenn der Code nicht aus dem
            Galeriebild gelesen werden konnte (v.a. iOS: 1D-Barcodes aus
            Standbild nicht auto-lesbar). Oben positioniert, damit das
            Zahlenfeld die Karte nicht verdeckt. */}
        {eanEntryUri ? (
          <View style={[styles.eanOverlay, { paddingTop: insets.top + 96 }]}>
            <View style={styles.eanCard}>
              <Text style={styles.eanTitle}>EAN eingeben</Text>
              <Text style={styles.eanSub}>
                Der Strichcode ließ sich aus dem Bild nicht automatisch lesen. Tippe die Nummer
                unter dem Barcode ein — dein Bild wird trotzdem übernommen.
              </Text>
              <TextInput
                style={styles.eanInput}
                value={eanEntryValue}
                onChangeText={(t) => setEanEntryValue(t.replace(/\D/g, '').slice(0, 14))}
                keyboardType="number-pad"
                placeholder="z. B. 4337256984164"
                placeholderTextColor="rgba(0,0,0,0.35)"
                autoFocus
                maxLength={14}
                returnKeyType="done"
                onSubmitEditing={confirmManualEan}
              />
              <View style={styles.eanBtnRow}>
                <Pressable
                  onPress={() => {
                    setEanEntryUri(null);
                    setEanEntryValue('');
                  }}
                  style={[styles.eanBtn, styles.eanBtnGhost]}
                >
                  <Text style={styles.eanBtnGhostText}>Abbrechen</Text>
                </Pressable>
                <Pressable onPress={confirmManualEan} style={[styles.eanBtn, styles.eanBtnPrimary]}>
                  <Text style={styles.eanBtnPrimaryText}>Übernehmen</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
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
                    setEditingFromReview(true);
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
          <Pressable onPress={doSubmit} disabled={!allCaptured} style={[styles.cta, { backgroundColor: allCaptured ? PURPLE : theme.borderStrong ?? '#ccc', flex: 1 }]}>
            <MaterialCommunityIcons name="cloud-upload-outline" size={18} color="#fff" />
            <Text style={styles.ctaText}>{allCaptured ? 'Produkt einreichen' : `Noch ${PRODUCT_PHOTO_STEPS.length - capturedCount}`}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Submitting is handled by the background upload queue now
  // (lib/services/uploadQueue.ts) — the wizard returns to the overview
  // immediately, so there is no in-wizard "uploading" screen. This default
  // return is unreachable: phase is always one of the four branches above.
  return null;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 10 },
  hTitle: { fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.bold as any, fontSize: 18 },
  hSub: { fontFamily: fontFamilyVariants.body, fontSize: 12, marginTop: 1 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },
  cta: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  ctaText: { color: '#fff', fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 15 },
  cancelBtn: { height: 40, paddingHorizontal: 6, alignItems: 'flex-start', justifyContent: 'center' },
  cancelText: { color: '#fff', fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 15 },
  readPillWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  readPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  readPillText: { color: '#fff', fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 13 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1 },
  stepNum: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  // camera
  camRoot: { flex: 1, backgroundColor: '#000' },
  permTitle: { color: '#fff', fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.bold as any, fontSize: 18, marginTop: 10 },
  camTop: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, backgroundColor: 'rgba(0,0,0,0.45)' },
  camTitle: { color: '#fff', fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.bold as any, fontSize: 16 },
  camSub: { color: 'rgba(255,255,255,0.8)', fontFamily: fontFamilyVariants.body, fontSize: 12, marginTop: 2, textAlign: 'center' },
  guideWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  guideDoc: { width: '80%', height: '64%', borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.9)', borderRadius: 16 },
  guideBarcode: { width: '74%', height: 92, borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.9)', borderRadius: 12 },
  chipsRow: { position: 'absolute', left: 0, right: 0 },
  stepChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  stepChipText: { color: '#fff', fontFamily: fontFamilyVariants.body, fontSize: 12, fontWeight: fontWeight.medium as any },
  camBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingTop: 16, backgroundColor: 'rgba(0,0,0,0.45)' },
  chipThumb: { width: 42, height: 56, borderRadius: 7, overflow: 'hidden', borderWidth: 2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  chipThumbCheck: { position: 'absolute', top: 2, right: 2, width: 15, height: 15, borderRadius: 8, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#fff' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  // EAN manual-entry overlay (gallery fallback)
  eanOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', paddingHorizontal: 24 },
  eanCard: { width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: 18, padding: 20, gap: 12 },
  eanTitle: { fontSize: 18, fontWeight: '800', color: '#191c1d', letterSpacing: -0.2 },
  eanSub: { fontSize: 13, fontWeight: '500', color: '#5a6166', lineHeight: 18 },
  eanInput: { height: 52, borderRadius: 12, borderWidth: 1.5, borderColor: '#d5dadd', backgroundColor: '#f6f8f9', paddingHorizontal: 14, fontSize: 18, fontWeight: '700', color: '#191c1d', letterSpacing: 1 },
  eanBtnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  eanBtn: { flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  eanBtnGhost: { backgroundColor: '#eef1f2' },
  eanBtnGhostText: { fontSize: 15, fontWeight: '700', color: '#5a6166' },
  eanBtnPrimary: { backgroundColor: PURPLE },
  eanBtnPrimaryText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  // review
  thumb: { width: '31%', aspectRatio: 0.8, borderRadius: 12, borderWidth: 1.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbLabel: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 6, paddingVertical: 4 },
  thumbCheck: { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1 },
});
