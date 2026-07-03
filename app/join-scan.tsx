import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';

/**
 * Extrahiert den Einladungs-Code aus beliebigem QR-/Text-Input:
 *  - https://markendetektive-895f7.web.app/join-list/<code>  (QR/Link)
 *  - markendetektivern://join-list/<code> (Legacy-Scheme)
 *  - roher Code („ABC123…")
 */
export function extractJoinCode(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const urlMatch = s.match(/join-list\/([A-Za-z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[A-Za-z0-9_-]{4,64}$/.test(s)) return s;
  return null;
}

/**
 * Vollbild-QR-Scanner für den Listen-Beitritt (Stufe 5). BEWUSST Vollbild
 * statt im Sheet: Androids Kamera-SurfaceView clippt in einem Modal-Bottom-
 * Sheet nicht (User-Report 2026-07-03, stößt aus der Box) — Vollbild braucht
 * kein Clipping und ist der Standard (WhatsApp/PayPal). Erreichbar in EINEM
 * Tipp aus dem Teilen-Chooser bzw. dem Listen-Chip. Erkennt der Scanner
 * einen gültigen Code (per QR ODER manueller Eingabe), ersetzt er sich durch
 * /join-list/<code> (dort lebt der Join inkl. Konto-Gate + Retry).
 */
export default function JoinScanScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const firedRef = useRef(false);
  const [manualCode, setManualCode] = useState('');
  const [notAQr, setNotAQr] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const deliver = useCallback(
    (raw: string) => {
      if (firedRef.current) return;
      const code = extractJoinCode(raw);
      if (!code) {
        setNotAQr(true);
        return;
      }
      firedRef.current = true;
      router.replace(`/join-list/${code}` as any);
    },
    [router],
  );

  const manualExtract = extractJoinCode(manualCode);

  const CloseButton = () => (
    <Pressable
      onPress={() => router.back()}
      hitSlop={10}
      accessibilityLabel="Schließen"
      style={{
        position: 'absolute',
        top: insets.top + 12,
        left: 16,
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
      }}
    >
      <MaterialCommunityIcons name="close" size={24} color="#fff" />
    </Pressable>
  );

  // Dauerhaft verweigert → Hinweis + Einstellungen (Code-Eingabe bleibt möglich).
  const camDenied = permission && !permission.granted && !permission.canAskAgain;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {permission?.granted ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(r) => {
            if (r?.data) deliver(r.data);
          }}
        />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <MaterialCommunityIcons
            name={camDenied ? 'camera-off-outline' : 'qrcode-scan'}
            size={44}
            color="rgba(255,255,255,0.7)"
          />
          <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.75)', textAlign: 'center', marginTop: 14, maxWidth: 300 }}>
            {camDenied
              ? 'Kamera-Zugriff ist deaktiviert. Erlaube ihn in den Einstellungen oder gib den Code unten ein.'
              : 'Kamera wird vorbereitet …'}
          </Text>
          {camDenied ? (
            <Pressable
              onPress={() => void Linking.openSettings()}
              style={({ pressed }) => ({ marginTop: 18, height: 44, paddingHorizontal: 22, borderRadius: radii.full, backgroundColor: '#0d8575', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.9 : 1 })}
            >
              <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 14, color: '#fff' }}>Einstellungen öffnen</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      <CloseButton />

      {/* Ziel-Rahmen + Hinweis (nur wenn Kamera läuft) */}
      {permission?.granted ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 230, height: 230, borderRadius: radii.lg, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' }} />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 15,
              color: '#fff',
              textAlign: 'center',
              marginTop: 22,
              paddingHorizontal: 24,
              textShadowColor: 'rgba(0,0,0,0.7)',
              textShadowRadius: 6,
            }}
          >
            {notAQr ? 'Das war kein Einladungs-QR-Code.' : 'Einladungs-QR-Code in den Rahmen halten'}
          </Text>
        </View>
      ) : null}

      {/* Manuelle Code-Eingabe unten — Kamera + Tippen in einem Screen */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 14, backgroundColor: 'rgba(0,0,0,0.55)' }}>
          <Text style={{ fontFamily, fontWeight: fontWeight.semibold, fontSize: 12, color: 'rgba(255,255,255,0.8)', marginBottom: 8, textAlign: 'center' }}>
            oder Einladungs-Code eingeben
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View
              style={{
                flex: 1,
                height: 44,
                borderRadius: 12,
                backgroundColor: 'rgba(255,255,255,0.95)',
                paddingHorizontal: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <MaterialCommunityIcons name="ticket-confirmation-outline" size={18} color="#5c676b" />
              <TextInput
                value={manualCode}
                onChangeText={(t) => {
                  setManualCode(t);
                  if (notAQr) setNotAQr(false);
                }}
                placeholder="Einladungs-Code …"
                placeholderTextColor="#8b9498"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={() => {
                  if (manualExtract) deliver(manualCode);
                }}
                style={{ flex: 1, fontFamily, fontWeight: fontWeight.medium, fontSize: 15, color: '#191c1d', paddingVertical: 0 }}
              />
            </View>
            <Pressable
              disabled={!manualExtract}
              onPress={() => deliver(manualCode)}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: manualExtract ? '#0d8575' : 'rgba(255,255,255,0.35)',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <MaterialCommunityIcons name="arrow-right" size={20} color="#fff" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
