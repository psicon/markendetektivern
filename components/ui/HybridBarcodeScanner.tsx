import { BarcodeResult, nativeBarcodeScannerService } from '@/lib/services/scanner/NativeBarcodeScanner';
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

export interface HybridScannerProps {
  onBarcodeScanned: (result: { type: string; data: string }) => void;
  style: any;
  isActive: boolean;
  flashEnabled: boolean;
  cameraType: 'back' | 'front';
  onCameraReady?: () => void;
  onError?: (error: string) => void;
}

/**
 * Hybrid Barcode Scanner - switches between expo-camera and native iOS based on build type
 */
export const HybridBarcodeScanner: React.FC<HybridScannerProps> = ({
  onBarcodeScanned,
  style,
  isActive,
  flashEnabled,
  cameraType,
  onCameraReady,
  onError,
}) => {
  const [permission, requestPermission] = useCameraPermissions();
  const [nativeScannerReady, setNativeScannerReady] = useState(false);
  const [lastTorchState, setLastTorchState] = useState(false);

  // TEMP: Erzwinge Expo-Camera in allen Builds, da der native Scanner
  // in TestFlight kein View rendert und weiß bleibt. Damit ist der
  // Scanner sofort stabil. (Kann später wieder auf native umgestellt werden.)
  const useExpoGoScanner = true;

  // 📱 EXPO GO PATH: expo-camera
  const handleExpoCameraBarcode = useCallback((result: any) => {
    if (result && result.data && result.type) {
      onBarcodeScanned({
        type: result.type.toLowerCase(),
        data: result.data
      });
    }
  }, [onBarcodeScanned]);

  // 🍎 NATIVE iOS PATH: AVFoundation  
  const handleNativeBarcodeResult = useCallback((result: BarcodeResult) => {
    onBarcodeScanned({
      type: result.type,
      data: result.data
    });
  }, [onBarcodeScanned]);

  const handleNativeCameraReady = useCallback(() => {
    setNativeScannerReady(true);
    if (onCameraReady) {
      onCameraReady();
    }
  }, [onCameraReady]);

  const handleNativeError = useCallback((error: string) => {
    console.error('Native scanner error:', error);
    if (onError) {
      onError(error);
    }
  }, [onError]);

  // 🎥 NATIVE SCANNER SETUP
  useEffect(() => {
    if (!useExpoGoScanner && Platform.OS === 'ios') {
      // Erst Berechtigung prüfen, dann Scanner initialisieren
      if (!permission?.granted) {
        requestPermission();
        return;
      }

      const cleanup = nativeBarcodeScannerService.registerListeners({
        onBarcodeDetected: handleNativeBarcodeResult,
        onCameraReady: handleNativeCameraReady,
        onError: handleNativeError,
      });

      nativeBarcodeScannerService.initializeCamera()
        .catch(error => {
          console.error('Failed to initialize native camera:', error);
          if (onError) {
            onError(error.message);
          }
        });

      return cleanup;
    }
  }, [useExpoGoScanner, permission?.granted, handleNativeBarcodeResult, handleNativeCameraReady, handleNativeError]);

  // 🔍 SCANNING CONTROL
  useEffect(() => {
    if (!useExpoGoScanner && nativeScannerReady) {
      if (isActive) {
        nativeBarcodeScannerService.startScanning();
      } else {
        nativeBarcodeScannerService.stopScanning();
      }
    }
  }, [useExpoGoScanner, isActive, nativeScannerReady]);

  // 🔦 FLASH/TORCH CONTROL
  useEffect(() => {
    if (!useExpoGoScanner && nativeScannerReady && flashEnabled !== lastTorchState) {
      // Only toggle if state actually changed
      if (flashEnabled) {
        nativeBarcodeScannerService.toggleTorch();
      } else if (lastTorchState) {
        nativeBarcodeScannerService.toggleTorch();
      }
      setLastTorchState(flashEnabled);
    }
  }, [useExpoGoScanner, flashEnabled, nativeScannerReady, lastTorchState]);

  // 📱 EXPO GO: expo-camera
  if (useExpoGoScanner) {
    if (!permission) {
      return <View style={style} />;
    }

    if (!permission.granted) {
      // Permission will be handled by parent component
      return <View style={style} />;
    }

    return (
      <CameraView
        style={style}
        facing={cameraType}
        enableTorch={flashEnabled}
        onBarcodeScanned={isActive ? handleExpoCameraBarcode : undefined}
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a'],
        }}
      />
    );
  }

  // 🍎 NATIVE iOS: AVFoundation (rendered via native layer)
  return (
    <View style={style}>
      {/* Native camera view will be rendered by iOS */}
      {/* This is just a placeholder - actual camera view comes from native layer */}
    </View>
  );
};

export default HybridBarcodeScanner;
