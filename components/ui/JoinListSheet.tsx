import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { FilterSheet } from '@/components/design/FilterSheet';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

/**
 * Extrahiert den Einladungs-Code aus beliebigem QR-/Text-Input:
 *  - https://markendetektive-895f7.web.app/join-list/<code>  (QR/Link)
 *  - markendetektivern://join-list/<code> (Legacy-Scheme)
 *  - roher Code („ABC123…")
 * Gibt null zurück, wenn nichts Brauchbares drinsteckt.
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
 * „Einer Liste beitreten" — QR-Scanner + manuelle Code-Eingabe (Stufe 5).
 * Macht selbst KEINEN Join: liefert den erkannten Code via onCode an den
 * Parent, der das Sheet schließt und zu /join-list/<code> routet (dort
 * lebt der komplette Join-Flow inkl. Konto-Gate und Fehler-Retry).
 */
export function JoinListSheet({
  visible,
  onClose,
  onCode,
}: {
  visible: boolean;
  onClose: () => void;
  /** Wird mit dem extrahierten Einladungs-Code aufgerufen (genau einmal pro Öffnung). */
  onCode: (code: string) => void;
}) {
  const { theme, brand } = useTokens();
  const [permission, requestPermission] = useCameraPermissions();
  const [manualCode, setManualCode] = useState('');
  const [scanError, setScanError] = useState(false);
  // Ein QR feuert onBarcodeScanned viele Male pro Sekunde — nur der erste
  // Treffer pro Sheet-Öffnung zählt.
  const firedRef = useRef(false);

  const deliver = useCallback(
    (raw: string) => {
      if (firedRef.current) return;
      const code = extractJoinCode(raw);
      if (!code) {
        setScanError(true);
        return;
      }
      firedRef.current = true;
      onCode(code);
    },
    [onCode]
  );

  // Bei jedem Öffnen frisch starten.
  const wasVisible = useRef(false);
  if (visible && !wasVisible.current) {
    firedRef.current = false;
    if (manualCode) setManualCode('');
    if (scanError) setScanError(false);
  }
  wasVisible.current = visible;

  const canScan = !!permission?.granted;
  const manualExtract = extractJoinCode(manualCode);

  return (
    <FilterSheet visible={visible} title="Einer Liste beitreten" onClose={onClose}>
      <View style={{ paddingBottom: 8, gap: 14 }}>
        {/* Kamera / QR-Scanner */}
        <View
          style={{
            height: 240,
            borderRadius: radii.lg,
            overflow: 'hidden',
            backgroundColor: theme.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {visible && canScan ? (
            <>
              <CameraView
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={(r) => {
                  if (r?.data) deliver(r.data);
                }}
              />
              {/* Ziel-Rahmen als dezente Scan-Hilfe */}
              <View
                pointerEvents="none"
                style={{
                  width: 150,
                  height: 150,
                  borderRadius: radii.md,
                  borderWidth: 2,
                  borderColor: 'rgba(255,255,255,0.85)',
                }}
              />
            </>
          ) : (
            <View style={{ alignItems: 'center', paddingHorizontal: 24 }}>
              <MaterialCommunityIcons name="qrcode-scan" size={36} color={theme.textMuted} />
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 13,
                  lineHeight: 18,
                  color: theme.textSub,
                  textAlign: 'center',
                  marginTop: 10,
                }}
              >
                {permission?.granted === false && !permission.canAskAgain
                  ? 'Kamera-Zugriff ist deaktiviert. Du kannst den Code auch unten eintippen.'
                  : 'Scanne den QR-Code der Einladung direkt hier in der App.'}
              </Text>
              {!canScan && (permission?.canAskAgain ?? true) ? (
                <Pressable
                  onPress={() => void requestPermission()}
                  style={({ pressed }) => ({
                    marginTop: 12,
                    height: 38,
                    paddingHorizontal: 18,
                    borderRadius: radii.full,
                    backgroundColor: brand.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.9 : 1,
                  })}
                >
                  <Text
                    style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 13, color: '#fff' }}
                  >
                    Kamera erlauben
                  </Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>

        {scanError ? (
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 12,
              color: theme.textSub,
              textAlign: 'center',
            }}
          >
            Das war kein Einladungs-Code — scanne den QR aus „Liste teilen" oder tippe den Code ein.
          </Text>
        ) : null}

        {/* Manuelle Eingabe — Fallback, Design = app-weiter Search-Input */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              flex: 1,
              height: 38,
              borderRadius: 11,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              paddingHorizontal: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <MaterialCommunityIcons name="ticket-confirmation-outline" size={16} color={theme.textMuted} />
            <TextInput
              value={manualCode}
              onChangeText={(t) => {
                setManualCode(t);
                if (scanError) setScanError(false);
              }}
              placeholder="Oder Einladungs-Code eingeben …"
              placeholderTextColor={theme.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={() => {
                if (manualExtract) deliver(manualCode);
              }}
              style={{
                flex: 1,
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 14,
                color: theme.text,
                paddingVertical: 0,
              }}
            />
          </View>
          <Pressable
            disabled={!manualExtract}
            onPress={() => deliver(manualCode)}
            style={({ pressed }) => ({
              width: 38,
              height: 38,
              borderRadius: 11,
              backgroundColor: manualExtract ? brand.primary : theme.borderStrong,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <MaterialCommunityIcons name="arrow-right" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>
    </FilterSheet>
  );
}
