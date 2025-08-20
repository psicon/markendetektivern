import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { FirestoreService } from '@/lib/services/firestore';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Modal, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

export default function BarcodeScannerScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [hasNavigated, setHasNavigated] = useState(false); // Verhindert mehrfache Navigation

  const { width, height } = Dimensions.get('window');
  const scanAreaSize = width * 0.65; // Etwas kleiner für bessere Proportionen
  
  // Verschiebe alles 80% höher - scanArea beginnt früher
  const topOffset = height * 0.15; // Nur 15% von oben statt 50% mittig

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission]);

  // Debug State Changes
  useEffect(() => {
    console.log(`🔍 Scanner State: scanned(${scanned}) searching(${isSearching}) navigated(${hasNavigated})`);
  }, [scanned, isSearching, hasNavigated]);

  const searchProductByEAN = async (ean: string) => {
    // KRITISCHER GUARD: Verhindere jegliche weitere Ausführung
    if (isSearching || hasNavigated) {
      console.log(`🚫 BLOCKED: Already searching (${isSearching}) or navigated (${hasNavigated})`);
      return;
    }
    
    setIsSearching(true);
    console.log(`🔍 Searching for product with EAN: ${ean}`);
    
    try {
      // Suche in NoName-Produkten (produkte Collection)
      const noNameProducts = await FirestoreService.searchProductsByEAN(ean);
      
      if (noNameProducts.length > 0) {
        const product = noNameProducts[0];
        console.log(`✅ Found NoName product: ${product.name}`);
        
        // KRITISCHER GUARD: Nur einmal navigieren!
        if (hasNavigated) {
          console.log(`🚫 BLOCKED: Already navigated!`);
          return;
        }
        
        // 🎉 SUCCESS HAPTIC FEEDBACK
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        
        setHasNavigated(true); // Sofort setzen BEVOR Navigation
        setIsSearching(false);
        
        // Navigiere zum Produktvergleich (für alle Produkte!)
        console.log(`🚀 NAVIGATING to: /product-comparison/${product.id}?type=noname`);
        router.replace(`/product-comparison/${product.id}?type=noname`);
        return;
      }
      
      // Suche in Markenprodukten (markenProdukte Collection)  
      const brandProducts = await FirestoreService.searchBrandProductsByEAN(ean);
      
      if (brandProducts.length > 0) {
        const product = brandProducts[0];
        console.log(`✅ Found brand product: ${product.name}`);
        
        // KRITISCHER GUARD: Nur einmal navigieren!
        if (hasNavigated) {
          console.log(`🚫 BLOCKED: Already navigated!`);
          return;
        }
        
        // 🎉 SUCCESS HAPTIC FEEDBACK
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        
        setHasNavigated(true); // Sofort setzen BEVOR Navigation
        setIsSearching(false);
        
        // Navigiere zum Produktvergleich
        console.log(`🚀 NAVIGATING to: /product-comparison/${product.id}?type=brand`);
        router.replace(`/product-comparison/${product.id}?type=brand`);
        return;
      }
      
      // Produkt nicht gefunden
      console.log(`❌ No product found for EAN: ${ean}`);
      
      // KRITISCHER FIX: hasNavigated auch bei "nicht gefunden" setzen!
      if (hasNavigated) {
        console.log(`🚫 BLOCKED: Alert already shown!`);
        return;
      }
      
      // ⚠️ WARNING HAPTIC FEEDBACK
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      
      setHasNavigated(true); // Verhindert mehrfache "nicht gefunden" Dialoge
      setIsSearching(false);
      
      Alert.alert(
        'Produkt nicht gefunden',
        `Das Produkt mit dem Barcode ${ean} ist noch nicht in unserer Datenbank.`,
        [
          {
            text: 'Erneut scannen',
            onPress: () => {
              setScanned(false);
              setHasNavigated(false); // Reset für neuen Scan
            },
          },
          {
            text: 'Produkt melden',
            onPress: () => {
              Alert.alert(
                'Produkt melden',
                'Danke für den Hinweis! Wir werden das Produkt in unsere Datenbank aufnehmen.',
                [{ text: 'OK', onPress: () => {
                  setScanned(false);
                  setHasNavigated(false); // Reset für neuen Scan
                }}]
              );
            },
          },
        ]
      );
      
    } catch (error) {
      console.error('❌ CRITICAL ERROR searching for product:', error);
      
      // KRITISCHER FIX: hasNavigated auch bei Fehlern setzen!
      if (hasNavigated) {
        console.log(`🚫 BLOCKED: Error alert already shown!`);
        return;
      }
      
      // 🚨 ERROR HAPTIC FEEDBACK
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      
      setHasNavigated(true); // Verhindert mehrfache Error-Dialoge
      setIsSearching(false);
      
      Alert.alert(
        'Fehler',
        'Beim Suchen des Produkts ist ein Fehler aufgetreten. Bitte versuche es erneut.',
        [
          {
            text: 'Erneut versuchen',
            onPress: () => {
              setScanned(false);
              setHasNavigated(false); // Reset für neuen Scan
            },
          },
        ]
      );
    }
  };

  const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    // KRITISCHER GUARD: Mehrfacher Schutz
    if (scanned || isSearching || hasNavigated) {
      console.log(`🚫 SCAN BLOCKED: scanned(${scanned}) searching(${isSearching}) navigated(${hasNavigated})`);
      return;
    }
    
    setScanned(true);
    console.log(`📱 SINGLE Barcode scan: ${data} (Type: ${type})`);
    
    // 📳 SCAN DETECTED HAPTIC FEEDBACK
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // SOFORTIGE Ausführung - kein Timeout mehr!
    searchProductByEAN(data);
  };

  const handleManualInput = () => {
    if (!manualBarcode.trim() || hasNavigated) return;
    
    setShowManualInput(false);
    console.log(`⌨️ Manual barcode input: ${manualBarcode}`);
    
    // Starte Produktsuche mit manueller Eingabe
    searchProductByEAN(manualBarcode.trim());
    setManualBarcode('');
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
          enableTorch={flashEnabled}
          onBarcodeScanned={(scanned || hasNavigated) ? undefined : handleBarCodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ['ean13', 'ean8', 'upc_a', 'code128', 'code39'],
          }}
        />

        {/* Overlay */}
        <View style={styles.overlay}>
          {/* Top overlay - jetzt viel kleiner */}
          <View style={[styles.overlayTop, { height: topOffset }]} />
          
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
          
          {/* Bottom overlay - jetzt viel größer */}
          <View style={[styles.overlayBottom, { height: height - topOffset - scanAreaSize }]}>
            <View style={styles.bottomContent}>
              <View style={styles.instructions}>
                <ThemedText style={styles.instructionTitle}>
                  Barcode scannen
                </ThemedText>
                <ThemedText style={styles.instructionText}>
                  Halte den Barcode in den Rahmen, um Produktinformationen zu erhalten
                </ThemedText>
              </View>
              
              {/* Manual Input Button - moved into overlay */}
              <TouchableOpacity 
                style={[styles.manualInputButton, { 
                  backgroundColor: (isSearching || hasNavigated) ? 'rgba(66, 169, 104, 0.5)' : colors.primary 
                }]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowManualInput(true);
                }}
                disabled={isSearching || hasNavigated}
              >
                {isSearching ? (
                  <>
                    <ActivityIndicator size="small" color="white" />
                    <ThemedText style={styles.manualInputText}>
                      Suche läuft...
                    </ThemedText>
                  </>
                ) : hasNavigated ? (
                  <>
                    <IconSymbol name="checkmark" size={20} color="white" />
                    <ThemedText style={styles.manualInputText}>
                      Produkt gefunden
                    </ThemedText>
                  </>
                ) : (
                  <>
                    <IconSymbol name="keyboard" size={20} color="white" />
                    <ThemedText style={styles.manualInputText}>
                      Manuell eingeben
                    </ThemedText>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Controls - positioned above scan area */}
        <View style={[styles.controls, { top: topOffset - 60 }]}>
          {/* Flash Toggle */}
          <TouchableOpacity 
            style={[styles.controlButton, { 
              backgroundColor: flashEnabled ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.7)',
              borderWidth: flashEnabled ? 2 : 0,
              borderColor: colors.primary,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.25,
              shadowRadius: 4,
              elevation: 5,
            }]}
            onPress={() => {
              console.log(`💡 Flash toggled: ${!flashEnabled}`);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setFlashEnabled(!flashEnabled);
            }}
          >
            <IconSymbol 
              name={flashEnabled ? "bolt.fill" : "bolt"} 
              size={24} 
              color={flashEnabled ? colors.primary : "white"} 
            />
          </TouchableOpacity>

          {/* Camera Flip */}
          <TouchableOpacity 
            style={[styles.controlButton, { 
              backgroundColor: 'rgba(0,0,0,0.7)',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.25,
              shadowRadius: 4,
              elevation: 5,
            }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              toggleCameraFacing();
            }}
          >
            <IconSymbol name="camera.rotate" size={24} color="white" />
          </TouchableOpacity>

          {/* Shopping List */}
          <TouchableOpacity 
            style={[styles.controlButton, { 
              backgroundColor: 'rgba(0,0,0,0.7)',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.25,
              shadowRadius: 4,
              elevation: 5,
            }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/shopping-list');
            }}
          >
            <IconSymbol name="cart" size={24} color="white" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Manual Input Modal */}
      <Modal
        visible={showManualInput && !hasNavigated}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowManualInput(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowManualInput(false);
              }}
              style={styles.modalCloseButton}
            >
              <IconSymbol name="xmark" size={24} color={colors.text} />
            </TouchableOpacity>
            <ThemedText style={styles.modalTitle}>Barcode eingeben</ThemedText>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                handleManualInput();
              }}
              style={[styles.modalDoneButton, { 
                backgroundColor: manualBarcode.trim() ? colors.primary : colors.icon 
              }]}
              disabled={!manualBarcode.trim()}
            >
              <ThemedText style={styles.modalDoneText}>Suchen</ThemedText>
            </TouchableOpacity>
          </View>
          
          <View style={styles.modalContent}>
            <ThemedText style={styles.modalDescription}>
              Gib den Barcode des Produkts manuell ein:
            </ThemedText>
            <TextInput
              style={[styles.barcodeInput, { 
                backgroundColor: colors.cardBackground,
                color: colors.text,
                borderColor: colors.border 
              }]}
              value={manualBarcode}
              onChangeText={setManualBarcode}
              placeholder="z.B. 4013900013457"
              placeholderTextColor={colors.icon}
              keyboardType="numeric"
              maxLength={20}
              autoFocus
            />
          </View>
        </View>
      </Modal>
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
  bottomContent: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 20,
    gap: 24,
  },
  instructions: {
    alignItems: 'center',
    paddingHorizontal: 20,
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
  manualInputButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    gap: 8,
    marginHorizontal: 20,
  },
  manualInputText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  
  // Modal Styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  modalCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  modalDoneButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  modalDoneText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  modalContent: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  modalDescription: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    opacity: 0.8,
  },
  barcodeInput: {
    height: 60,
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 20,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 1,
  },
});

