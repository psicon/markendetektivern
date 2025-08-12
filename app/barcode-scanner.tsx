import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';

export default function BarcodeScannerScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');

  const { width, height } = Dimensions.get('window');
  const scanAreaSize = width * 0.7;

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission]);

  const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    setScanned(true);
    
    // Simuliere Produkterkennung
    const mockProducts = [
      { barcode: '4013900013457', name: 'Bio Tofu Natur', brand: 'Berief' },
      { barcode: '4306188820123', name: 'Vollmilch Schokolade', brand: 'Ritter Sport' },
      { barcode: '4000417025005', name: 'Nutella', brand: 'Ferrero' },
    ];

    const foundProduct = mockProducts.find(p => p.barcode === data) || {
      barcode: data,
      name: 'Unbekanntes Produkt',
      brand: 'Nicht gefunden'
    };

    Alert.alert(
      'Produkt erkannt!',
      `${foundProduct.brand}\n${foundProduct.name}\nBarcode: ${data}`,
      [
        {
          text: 'Erneut scannen',
          onPress: () => setScanned(false),
        },
        {
          text: 'Produktvergleich anzeigen',
          onPress: () => {
            router.replace('/product-comparison/1');
          },
        },
      ]
    );
  };

  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  if (!permission) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText>Kamera-Berechtigung wird geladen...</ThemedText>
      </ThemedView>
    );
  }

  if (!permission.granted) {
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen 
          options={{
            title: 'Barcode Scanner',
            headerStyle: { backgroundColor: colors.primary },
            headerTintColor: 'white',
            headerTitleStyle: { color: 'white', fontFamily: 'Nunito_600SemiBold' },
            headerBackVisible: false,
            gestureEnabled: true,
            animation: 'slide_from_right',
            headerLeft: () => (
              <TouchableOpacity 
                onPress={() => router.back()}
                style={{ paddingLeft: 16, paddingRight: 8, paddingVertical: 8 }}
              >
                <IconSymbol name="chevron.left" size={24} color="white" />
              </TouchableOpacity>
            ),
          }} 
        />
        <View style={styles.permissionContainer}>
          <IconSymbol name="barcode" size={80} color={colors.icon} />
          <ThemedText style={styles.permissionTitle}>
            Kamera-Zugriff erforderlich
          </ThemedText>
          <ThemedText style={styles.permissionText}>
            Um Barcodes zu scannen, benötigt die App Zugriff auf deine Kamera.
          </ThemedText>
          <TouchableOpacity 
            style={[styles.permissionButton, { backgroundColor: colors.primary }]}
            onPress={requestPermission}
          >
            <ThemedText style={styles.permissionButtonText}>
              Kamera-Zugriff erlauben
            </ThemedText>
          </TouchableOpacity>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen 
        options={{
          title: 'Barcode Scanner',
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: 'white',
          headerTitleStyle: { color: 'white', fontWeight: '600' },
          headerBackVisible: false,
          gestureEnabled: true,
          animation: 'slide_from_right',
          headerLeft: () => (
            <TouchableOpacity 
              onPress={() => router.back()}
              style={{ paddingLeft: 16, paddingRight: 8, paddingVertical: 8 }}
            >
              <IconSymbol name="chevron.left" size={24} color="white" />
            </TouchableOpacity>
          ),
        }} 
      />

      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          facing={facing}
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ['ean13', 'ean8', 'upc_a', 'code128', 'code39'],
          }}
        />

        {/* Overlay */}
        <View style={styles.overlay}>
          {/* Top overlay */}
          <View style={[styles.overlayTop, { height: (height - scanAreaSize) / 2 }]} />
          
          <View style={styles.overlayMiddle}>
            {/* Left overlay */}
            <View style={[styles.overlaySide, { width: (width - scanAreaSize) / 2 }]} />
            
            {/* Scan area */}
            <View style={[styles.scanArea, { width: scanAreaSize, height: scanAreaSize }]}>
              <View style={styles.scanCorners}>
                <View style={[styles.corner, styles.topLeft, { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.topRight, { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.bottomLeft, { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.bottomRight, { borderColor: colors.primary }]} />
              </View>
            </View>
            
            {/* Right overlay */}
            <View style={[styles.overlaySide, { width: (width - scanAreaSize) / 2 }]} />
          </View>
          
          {/* Bottom overlay */}
          <View style={[styles.overlayBottom, { height: (height - scanAreaSize) / 2 }]}>
            <View style={styles.instructions}>
              <ThemedText style={styles.instructionTitle}>
                Barcode scannen
              </ThemedText>
              <ThemedText style={styles.instructionText}>
                Halte den Barcode in den Rahmen, um Produktinformationen zu erhalten
              </ThemedText>
            </View>
          </View>
        </View>

        {/* Controls */}
        <View style={styles.controls}>
          <TouchableOpacity 
            style={[styles.controlButton, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
            onPress={() => router.back()}
          >
            <IconSymbol name="chevron.right" size={24} color="white" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.flashButton, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
            onPress={toggleCameraFacing}
          >
            <IconSymbol name="star.fill" size={24} color="white" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.controlButton, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
            onPress={() => router.push('/shopping-list')}
          >
            <IconSymbol name="shopping.cart" size={24} color="white" />
          </TouchableOpacity>
        </View>

        {/* Manual Input Button */}
        <TouchableOpacity 
          style={[styles.manualInputButton, { backgroundColor: colors.primary }]}
          onPress={() => {
            Alert.alert(
              'Manuelle Eingabe',
              'Barcode manuell eingeben',
              [
                { text: 'Abbrechen', style: 'cancel' },
                { 
                  text: 'Eingeben', 
                  onPress: () => {
                    // Hier würde ein TextInput Modal geöffnet werden
                    handleBarCodeScanned({ type: 'manual', data: '4013900013457' });
                  }
                },
              ]
            );
          }}
        >
          <IconSymbol name="star.fill" size={20} color="white" />
          <ThemedText style={styles.manualInputText}>
            Manuell eingeben
          </ThemedText>
        </TouchableOpacity>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 24,
    marginBottom: 16,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
    opacity: 0.8,
  },
  permissionButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
  },
  permissionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  cameraContainer: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  overlayTop: {
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  overlayMiddle: {
    flexDirection: 'row',
  },
  overlaySide: {
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  scanArea: {
    position: 'relative',
  },
  scanCorners: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  corner: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderWidth: 4,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  topRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
  },
  overlayBottom: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  instructions: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  instructionTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  instructionText: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.8,
    lineHeight: 22,
  },
  controls: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 30,
  },
  controlButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  flashButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  manualInputButton: {
    position: 'absolute',
    bottom: 50,
    left: 30,
    right: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  manualInputText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

