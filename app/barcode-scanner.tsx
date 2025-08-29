import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ShimmerSkeleton } from '@/components/ui/ShimmerSkeleton';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { achievementService } from '@/lib/services/achievementService';
import { FirestoreService } from '@/lib/services/firestore';
import scanHistoryService, { ScanHistoryItem } from '@/lib/services/scanHistoryService';
import { CameraType, CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { getDoc } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Dimensions, Image, InteractionManager, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function BarcodeScannerScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [hasNavigated, setHasNavigated] = useState(false);
  const [scanHistory, setScanHistory] = useState<ScanHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [scanningLoading, setScanningLoading] = useState(false); // 🚀 Sofortiger Loading-State
  const [cameraReady, setCameraReady] = useState(false); // 🎥 Kamera-Initialisierung State
  // 🔥 ROBUSTE SCAN-PRÄVENTION (StackOverflow Lösung)
  const lastScannedTimestampRef = useRef<number>(0);
  const lastScannedEANRef = useRef<string>('');  
  const [isSmallDevice, setIsSmallDevice] = useState(false);

  const { width, height } = Dimensions.get('window');
  const scanAreaWidth = width * 0.75; // Kompakter für mehr Platz
  const scanAreaHeight = scanAreaWidth * 0.45; // Etwas kleiner
  
  // Responsive Layout für kleine Geräte
  useEffect(() => {
    setIsSmallDevice(height < 700); // iPhone SE Detection
  }, [height]);
  
  // 🎥 Kamera-Initialisierung nach Navigation optimieren  
  useEffect(() => {
    if (!permission?.granted) return;
    
    // Kamera erst nach allen Navigationsinteraktionen initialisieren
    const interaction = InteractionManager.runAfterInteractions(() => {
      setCameraReady(true);
    });
    
    return () => interaction.cancel();
  }, [permission?.granted]);
  
  const topOffset = isSmallDevice ? height * 0.08 + 90 : height * 0.12 + 140;
  const bottomSpaceAvailable = height - topOffset - scanAreaHeight - 100; // Space für Content

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    }
  }, [permission]);

  // Lade Scanhistorie beim Mount und Focus
  useFocusEffect(
    useCallback(() => {
      if (user?.uid) {
        loadScanHistory();
        // Subscribe für Live-Updates
        const unsubscribe = scanHistoryService.subscribeToScanHistory(
          user.uid,
          10,
          (items: ScanHistoryItem[]) => setScanHistory(items)
        );
        return () => {
          unsubscribe();
          // Reset Scanner-Status beim Verlassen
          setScanned(false);
          setHasNavigated(false);
          setScanningLoading(false);
          setCameraReady(false); // 🎥 Kamera-Status zurücksetzen
          lastScannedTimestampRef.current = 0;
          lastScannedEANRef.current = '';
        };
      }
    }, [user])
  );

  const loadScanHistory = async () => {
    if (!user?.uid) return;
    setIsLoadingHistory(true);
    try {
      const history = await scanHistoryService.getRecentScans(user.uid, 10);
      setScanHistory(history);
    } catch (error) {
      console.error('Fehler beim Laden der Scanhistorie:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const searchProductByEAN = async (ean: string) => {
    // 🔥 ROBUSTE MEHRFACHSCAN-PRÄVENTION (StackOverflow Lösung)
    const timestamp = Date.now();
    
    // Kritische Guards
    if (isSearching || hasNavigated) {
      console.log(`🚫 BLOCKED: Already searching (${isSearching}) or navigated (${hasNavigated})`);
      return;
    }
    
    // 🕐 TIMESTAMP-BASIERTER SCHUTZ (2 Sekunden Minimum)
    if (timestamp - lastScannedTimestampRef.current < 2000) {
      console.log(`🚫 BLOCKED: Too soon after last scan (${timestamp - lastScannedTimestampRef.current}ms ago)`);
      return;
    }
    
    // 🔒 ZUSÄTZLICHER EAN-SCHUTZ
    if (lastScannedEANRef.current === ean && timestamp - lastScannedTimestampRef.current < 5000) {
      console.log(`🚫 BLOCKED: Same EAN recently scanned: ${ean}`);
      return;
    }
    
    // ⚡ UPDATE REFS SOFORT (vor async Operationen!)
    lastScannedTimestampRef.current = timestamp;
    lastScannedEANRef.current = ean;
    
    // 🚀 SOFORTIGER LOADING-STATE
    setScanningLoading(true);
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
        
        // Speichere in Scanhistorie
        if (user?.uid) {
          // Für NoName-Produkte: Handelsmarken-Name + Discounter-Logo
          let brandName = '';
          let brandImage = '';
          
          // 1. Hole Handelsmarken-Name (falls vorhanden)
          if ((product as any).handelsmarke) {
            if (typeof (product as any).handelsmarke === 'string') {
              brandName = (product as any).handelsmarke;
            }
          }
          
          // 2. Hole IMMER das Discounter-Logo für NoName-Produkte
          if ((product as any).discounter) {
            try {
              const discounterValue = (product as any).discounter;
              
              // Ist es eine Referenz?
              if (discounterValue && typeof discounterValue === 'object' && discounterValue.path) {
                const discounterDoc = await getDoc(discounterValue);
                if (discounterDoc.exists()) {
                  const discounterData = discounterDoc.data() as any;
                  brandImage = discounterData?.bild || '';
                  // Falls kein Handelsmarken-Name, nutze Discounter-Name
                  if (!brandName) {
                    brandName = discounterData?.name || '';
                  }
                  console.log(`✅ Discounter-Logo geladen: ${discounterData?.name}`);
                }
              }
            } catch (err) {
              console.error('Fehler beim Laden des Discounter-Logos:', err);
            }
          }
          
          await scanHistoryService.saveScan(user.uid, {
            ean,
            productId: product.id,
            productName: product.name,
            productImage: product.bild,
            productType: 'noname',
            brandName,
            brandImage,
            price: product.preis
          });
          
          // 🎯 TRACK ACTION: scan_product
          try {
            await achievementService.trackAction(user.uid, 'scan_product', {
              productId: product.id,
              productName: product.name,
              ean: ean,
              productType: 'noname'
            });
            console.log('✅ Action tracked: scan_product (NoName)');
          } catch (error) {
            console.error('Error tracking scan_product action:', error);
          }
        }
        
        // 🎉 SUCCESS HAPTIC FEEDBACK
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        
        setHasNavigated(true);
        setIsSearching(false);
        setScanningLoading(false);
        
        // Navigiere zum Produktvergleich
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
        
        // Lade Markeninformationen
        let brandName = 'Unbekannt';
        let brandImage = '';
        if ((product as any).hersteller) {
          const brandInfo = await scanHistoryService.getBrandInfo((product as any).hersteller);
          if (brandInfo) {
            brandName = brandInfo.name;
            brandImage = brandInfo.image;
          }
        }
        
        // Speichere in Scanhistorie
        if (user?.uid) {
          await scanHistoryService.saveScan(user.uid, {
            ean,
            productId: product.id,
            productName: product.name,
            productImage: product.bild,
            productType: 'markenprodukt',
            brandName,
            brandImage,
            price: product.preis
          });
          
          // 🎯 TRACK ACTION: scan_product
          try {
            await achievementService.trackAction(user.uid, 'scan_product', {
              productId: product.id,
              productName: product.name,
              ean: ean,
              productType: 'markenprodukt'
            });
            console.log('✅ Action tracked: scan_product (Markenprodukt)');
          } catch (error) {
            console.error('Error tracking scan_product action:', error);
          }
        }
        
        // 🎉 SUCCESS HAPTIC FEEDBACK
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        
        setHasNavigated(true);
        setIsSearching(false);
        setScanningLoading(false);
        
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
      setScanningLoading(false);

    Alert.alert(
        'Produkt nicht gefunden',
        `Das Produkt mit dem Barcode ${ean} ist noch nicht in unserer Datenbank.`,
      [
        {
          text: 'Erneut scannen',
            onPress: () => {
              setScanned(false);
              setHasNavigated(false);
              setScanningLoading(false);
              lastScannedTimestampRef.current = 0;
              lastScannedEANRef.current = '';
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
                  setHasNavigated(false);
                  lastScannedTimestampRef.current = 0;
                  lastScannedEANRef.current = '';
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
      setScanningLoading(false);
      
      Alert.alert(
        'Fehler',
        'Beim Suchen des Produkts ist ein Fehler aufgetreten. Bitte versuche es erneut.',
        [
          {
                        text: 'Erneut versuchen',
            onPress: () => {
              setScanned(false);
              setHasNavigated(false);
              setScanningLoading(false);
              lastScannedTimestampRef.current = 0;
              lastScannedEANRef.current = '';
          },
        },
      ]
    );
    }
  };

  const handleBarCodeScanned = ({ type, data }: { type: string; data: string }) => {
    const timestamp = Date.now();
    
    // 🔥 ROBUSTE MEHRFACHSCAN-PRÄVENTION
    if (scanned || isSearching || hasNavigated) {
      console.log(`🚫 SCAN BLOCKED: scanned(${scanned}) searching(${isSearching}) navigated(${hasNavigated})`);
      return;
    }
    
    // 🕐 TIMESTAMP-SCHUTZ DIREKT IM HANDLER (1 Sekunde minimum zwischen Scans)
    if (timestamp - lastScannedTimestampRef.current < 1000) {
      console.log(`🚫 SCAN BLOCKED: Too recent (${timestamp - lastScannedTimestampRef.current}ms ago)`);
      return;
    }
    
    // Filtere nur EAN-Codes (EAN-8, EAN-13, UPC-A)
    const allowedTypes = ['ean13', 'ean8', 'upc_a', 'org.gs1.EAN-13', 'org.gs1.EAN-8', 'org.gs1.UPC-A'];
    if (!allowedTypes.includes(type)) {
      console.log(`🚫 SCAN IGNORED: Non-EAN barcode type: ${type}`);
      return;
    }
    
    // Validiere EAN-Format
    if (!isValidEAN(data)) {
      console.log(`🚫 SCAN IGNORED: Invalid EAN format: ${data}`);
      return;
    }
    
    setScanned(true);
    console.log(`📱 SINGLE EAN scan: ${data} (Type: ${type})`);
    
    // 📳 SCAN DETECTED HAPTIC FEEDBACK
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // SOFORTIGE Ausführung
    searchProductByEAN(data);
  };

  // Validiere EAN-Format
  const isValidEAN = (ean: string): boolean => {
    // Entferne Whitespace
    ean = ean.trim();
    
    // Prüfe ob nur Zahlen
    if (!/^\d+$/.test(ean)) return false;
    
    // Prüfe Länge (EAN-8, EAN-12, EAN-13)
    if (![8, 12, 13].includes(ean.length)) return false;
    
    return true;
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
        {/* Custom Back Button */}
              <TouchableOpacity 
                onPress={() => router.back()}
          style={[styles.backButton, { top: insets.top + 10 }]}
              >
          <IconSymbol name="chevron.left" size={28} color="white" />
              </TouchableOpacity>
        
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
      <View style={styles.cameraContainer}>
        {cameraReady ? (
        <CameraView
          style={styles.camera}
          facing={facing}
            enableTorch={flashEnabled}
            onBarcodeScanned={(scanned || hasNavigated) ? undefined : handleBarCodeScanned}
          barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'upc_a'], // Nur EAN/UPC Codes
            }}
          />
        ) : (
          <View style={[styles.camera, { backgroundColor: 'black', alignItems: 'center', justifyContent: 'center' }]}>
            <ActivityIndicator size="large" color="white" />
            <Text style={{ color: 'white', marginTop: 10, fontFamily: 'Nunito_400Regular' }}>
              Kamera wird vorbereitet...
            </Text>
          </View>
        )}

        {/* Overlay */}
        <View style={styles.overlay}>
          {/* Top overlay - jetzt viel kleiner */}
          <View style={[styles.overlayTop, { height: topOffset }]} />
          
          <View style={styles.overlayMiddle}>
            {/* Left overlay */}
            <View style={[styles.overlaySide, { width: (width - scanAreaWidth) / 2 }]} />
            
            {/* Scan area - jetzt rechteckig */}
            <View style={[styles.scanArea, { width: scanAreaWidth, height: scanAreaHeight }]}>
              <View style={styles.scanCorners}>
                <View style={[styles.corner, styles.topLeft, { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.topRight, { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.bottomLeft, { borderColor: colors.primary }]} />
                <View style={[styles.corner, styles.bottomRight, { borderColor: colors.primary }]} />
              </View>
            </View>
            
            {/* Right overlay */}
            <View style={[styles.overlaySide, { width: (width - scanAreaWidth) / 2 }]} />
          </View>
          
                              {/* Bottom overlay - Einfaches Layout */}
          <View style={[styles.overlayBottom, { height: height - topOffset - scanAreaHeight }]}>
            {/* Instructions und Manual Button oben */}
            <View style={styles.instructionsContent}>
            <View style={styles.instructions}>
              <ThemedText style={styles.instructionTitle}>
                  {scanningLoading ? 'Scanne...' : 'Barcode scannen'}
                </ThemedText>
                {!scanningLoading && (
                <ThemedText style={styles.instructionText}>
                    Halte den Barcode in den Rahmen
                  </ThemedText>
                )}
                {scanningLoading && (
                  <View style={styles.scanningIndicator}>
                    <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                    <ThemedText style={styles.scanningText}>
                      Produkt wird erkannt...
                    </ThemedText>
                  </View>
                )}
              </View>

              {/* Manual Input Button - direkt unter Instructions */}
              <TouchableOpacity 
                style={[styles.manualInputButton, { 
                  backgroundColor: (isSearching || hasNavigated || !cameraReady) ? 'rgba(66, 169, 104, 0.5)' : colors.primary,
                  opacity: cameraReady ? 1 : 0.5, // Visueller Hinweis für deaktiviert
                }]}
                onPress={() => {
                  if (!cameraReady) return;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowManualInput(true);
                }}
                disabled={isSearching || hasNavigated || !cameraReady}
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

          {/* Scanhistorie - ganz unten außerhalb des Overlays */}
          {!scanningLoading && (scanHistory.length > 0 || isLoadingHistory) && (
            <View style={styles.historyBottomContainer}>
              <View style={[styles.historySection, isSmallDevice && styles.historyCompact]}>
                <View style={styles.historyHeader}>
                  <ThemedText style={styles.historyTitle}>Zuletzt gescannt</ThemedText>
                                      <TouchableOpacity
                      onPress={() => {
                        if (user?.uid) {
                          scanHistoryService.markAllAsDeleted(user.uid);
                        }
                      }}
                    >
                    <ThemedText style={[styles.historyClear, { color: colors.primary }]}>Löschen</ThemedText>
                  </TouchableOpacity>
                </View>
                
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.historyScrollContent}
                  style={styles.historyScrollView}
                >
                  {isLoadingHistory ? (
                    // Weniger Skeletons auf kleinen Geräten
                    [...Array(isSmallDevice ? 2 : 3)].map((_, index) => (
                      <View key={`skeleton-${index}`} style={[styles.historyCard, { backgroundColor: colors.cardBackground }]}>
                        <ShimmerSkeleton width={50} height={50} borderRadius={8} />
                        <View style={styles.historyInfo}>
                          <ShimmerSkeleton width={80} height={12} borderRadius={4} />
                          <ShimmerSkeleton width={60} height={10} borderRadius={3} style={{ marginTop: 4 }} />
                        </View>
                      </View>
                    ))
                  ) : (
                    scanHistory.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.historyCard, { backgroundColor: colors.cardBackground }]}
                        onPress={() => {
                          // Navigiere zum Produkt
                          const route = item.productType === 'noname' 
                            ? `/product-comparison/${item.productId}?type=noname`
                            : `/product-comparison/${item.productId}?type=brand`;
                          router.push(route as any);
                        }}
                        activeOpacity={0.7}
                      >
                        {/* Produktbild */}
                        <View style={styles.historyImageContainer}>
                          {item.productImage ? (
                            <Image
                              source={{ uri: item.productImage }}
                              style={styles.historyImage}
                              resizeMode="contain"
                            />
                          ) : (
                            <View style={[styles.historyImagePlaceholder, { backgroundColor: colors.background }]}>
                              <IconSymbol name="barcode" size={24} color={colors.icon} />
                            </View>
                          )}
                        </View>
                        
                        {/* Produktinfo */}
                        <View style={styles.historyInfo}>
                          {/* Marke/Handelsmarke */}
                          {item.brandName && (
                            <View style={styles.historyBrand}>
                              {item.brandImage && (
                                <Image 
                                  source={{ uri: item.brandImage }} 
                                  style={styles.historyBrandImage}
                                  resizeMode="contain"
                                />
                              )}
                              <Text style={[styles.historyBrandName, { color: colors.icon }]} numberOfLines={1}>
                                {item.brandName}
                              </Text>
                            </View>
                          )}
                          {/* Produktname */}
                          <Text style={[styles.historyProductName, { color: colors.text }]} numberOfLines={2}>
                            {item.productName}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>
              </View>
            </View>
          )}
        </View>

        {/* 🚀 SCANNING LOADING OVERLAY */}
        {scanningLoading && (
          <View style={styles.scanningOverlay}>
            <View style={[styles.scanningCard, { backgroundColor: colors.cardBackground }]}>
              <ActivityIndicator size="large" color={colors.primary} />
              <ThemedText style={[styles.scanningCardTitle, { color: colors.text }]}>
                Produkt erkennen...
              </ThemedText>
              <ThemedText style={[styles.scanningCardText, { color: colors.icon }]}>
                Einen Moment bitte
              </ThemedText>
            </View>
          </View>
        )}

                {/* Custom Back Button - top left */}
          <TouchableOpacity 
          style={[styles.backButton, { top: insets.top + 10 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.back();
          }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <IconSymbol name="chevron.left" size={28} color="white" />
          </TouchableOpacity>

        {/* Controls - positioned above scan area */}
        <View style={[styles.controls, { top: topOffset - 80 }]}>
          {/* Flash Toggle */}
          <TouchableOpacity 
            disabled={!cameraReady}
            style={[styles.controlButton, { 
              backgroundColor: flashEnabled ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.7)',
              borderWidth: flashEnabled ? 2 : 0,
              borderColor: colors.primary,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.25,
              shadowRadius: 4,
              elevation: 5,
              opacity: cameraReady ? 1 : 0.5, // Visueller Hinweis für deaktiviert
            }]}
            onPress={() => {
              if (!cameraReady) return;
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
            disabled={!cameraReady}
            style={[styles.controlButton, { 
              backgroundColor: 'rgba(0,0,0,0.7)',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.25,
              shadowRadius: 4,
              elevation: 5,
              opacity: cameraReady ? 1 : 0.5, // Visueller Hinweis für deaktiviert
            }]}
            onPress={() => {
              if (!cameraReady) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              toggleCameraFacing();
            }}
          >
            <IconSymbol name="camera.rotate" size={24} color="white" />
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
     marginTop: 0,
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
    borderWidth: 4
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
  },
  instructionsContent: {
    alignItems: 'center',
    paddingTop: 30, // 20% mehr Abstand zum Scanner
    paddingHorizontal: 20,
  },
  historyBottomContainer: {
    position: 'absolute',
    bottom: 80, // 20pt Abstand zum Seitenende
    left: 0,
    right: 0,
    paddingHorizontal: 20,
  },
  instructions: {
    alignItems: 'center',
  },
  instructionTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 0,
    textAlign: 'center',
  },
  instructionText: {
    color: 'white',
    fontSize: 12,
    textAlign: 'center',
    opacity: 0.8,
  },
  backButton: {
    position: 'absolute',
    left: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
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
    marginTop: 40, // 20pt Abstand zu Instructions
    width: '100%',
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
  // Scanhistorie Styles
  historySection: {
    width: '100%',
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: 'white',
  },
  historyClear: {
    fontSize: 13,
    fontWeight: '500',
  },
  historyScrollView: {
    marginHorizontal: -20,
  },
  historyScrollContent: {
    paddingHorizontal: 20,
    gap: 10,
  },
  historyCard: {
    flexDirection: 'row',
    padding: 6,
    borderRadius: 10,
    width: 146, // +3pt breiter für längere Markennamen
    gap: 8,
  },
  historyImageContainer: {
    width: 50,
    height: 50,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  historyImage: {
    width: '100%',
    height: '100%',
  },
  historyImagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  historyInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  historyBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 2,
  },
  historyBrandImage: {
    width: 11,
    height: 11,
  },
  historyBrandName: {
    fontSize: 10,
    fontFamily: 'Nunito_500Medium',
  },
  historyProductName: {
    fontSize: 11,
    fontFamily: 'Nunito_600SemiBold',
    lineHeight: 14,
  },
  // Loading & Responsive Styles
  scanningIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  scanningText: {
    color: 'white',
    fontSize: 13,
    fontFamily: 'Nunito_500Medium',
  },
  scanningOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  scanningCard: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  scanningCardTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    marginTop: 16,
    marginBottom: 4,
  },
  scanningCardText: {
    fontSize: 13,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
  },
  historyCompact: {
    marginTop: 8,
  },
});

