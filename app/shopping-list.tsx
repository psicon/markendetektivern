import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useNavigation, useRouter } from 'expo-router';
import React, { useLayoutEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

export default function ShoppingListScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const router = useRouter();
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState<'marken' | 'nonames'>('nonames');

  // Header konfigurieren
  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Einkaufszettel',
      headerStyle: { 
        backgroundColor: colors.primary,
        borderBottomWidth: 0,
        elevation: 0,
        shadowOpacity: 0,
      },
      headerTintColor: 'white',
      headerTitleStyle: { 
        color: 'white',
        fontFamily: 'Nunito_600SemiBold',
        fontSize: 16
      },
      headerShadowVisible: false,
      headerBackVisible: false,
      headerTransparent: false,
      headerBlurEffect: 'none',
      headerLargeTitle: false,
      headerSearchBarOptions: undefined,
      headerBackTitleVisible: false,
      gestureEnabled: true,
      animation: 'slide_from_right',
      headerLeft: () => (
        <TouchableOpacity 
          onPress={() => router.back()}
          style={{ 
            paddingLeft: 0, 
            paddingRight: 8, 
            paddingVertical: 8 
          }}
        >
          <IconSymbol name="chevron.left" size={24} color="white" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, colors.primary]);
  const [showConversionModal, setShowConversionModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  const markenProducts = [
    {
      id: '1',
      name: 'Aachener Pflümli',
      brand: 'Zentis',
      price: 2.49,
      image: '🫙',
      checked: false
    },
    {
      id: '2',
      name: 'Spül-Lotion Aloe Vera',
      brand: 'Frosch',
      price: 1.85,
      image: '🧴',
      checked: false
    },
    {
      id: '3',
      name: 'Hähnchen-Salami',
      brand: 'Gutfried',
      price: 1.99,
      image: '🥓',
      checked: false
    },
    {
      id: '4',
      name: 'Natural Compact Powder 02 Neutral Beige',
      brand: 'Sante Naturkosmetik',
      price: 9.65,
      image: '💄',
      checked: false
    },
  ];

  const nonameProducts = [
    {
      id: '1',
      name: 'Delikatess Geflügel-Salami fettreduziert',
      brand: 'MÜHLENHOF',
      market: 'Penny (DE)',
      price: 1.99,
      discount: -38,
      image: '🥓',
      checked: true
    },
    {
      id: '2',
      name: 'Bio Gewürzgurken',
      brand: 'K-Bio',
      market: 'Kaufland (DE)',
      price: 2.19,
      discount: -46,
      image: '🥒',
      checked: true
    },
    {
      id: '3',
      name: 'Hähnchen-Salami',
      brand: 'REWE Beste Wahl',
      market: 'REWE (DE)',
      price: 1.69,
      discount: -15,
      image: '🥓',
      checked: true
    },
    {
      id: '4',
      name: 'Compact Powder Natural Beige',
      brand: 'Terra Naturi',
      market: 'Müller (DE)',
      price: 3.95,
      discount: -59,
      image: '💄',
      checked: true
    },
    {
      id: '5',
      name: 'Pflaumenmus fein gewürzt',
      brand: 'ja!',
      market: 'REWE (DE)',
      price: 1.39,
      discount: -57,
      image: '🫙',
      checked: true
    },
  ];

  const totalSavings = nonameProducts.reduce((sum, product) => {
    if (product.checked) {
      const originalPrice = product.price / (1 + product.discount / 100);
      return sum + (originalPrice - product.price);
    }
    return sum;
  }, 0);

  const handleConvertProducts = () => {
    setShowConversionModal(true);
  };

  const confirmConversion = () => {
    setShowConversionModal(false);
    setShowSuccessModal(true);
    setTimeout(() => {
      setShowSuccessModal(false);
    }, 2000);
  };

  const renderProduct = (product: any, isMarken: boolean = false) => (
    <View key={product.id} style={[styles.productItem, { backgroundColor: colors.background }]}>
      <View style={styles.productContent}>
        <View style={styles.productImage}>
          <ThemedText style={styles.productEmoji}>{product.image}</ThemedText>
        </View>
        <View style={styles.productInfo}>
          <ThemedText style={styles.productName}>{product.name}</ThemedText>
          <ThemedText style={[styles.productBrand, { color: colors.primary }]}>
            {product.brand}
          </ThemedText>
          {product.market && (
            <ThemedText style={styles.productMarket}>
              {product.market}
            </ThemedText>
          )}
          {product.discount && (
            <ThemedText style={[styles.discount, { color: colors.success }]}>
              {product.discount}%
            </ThemedText>
          )}
        </View>
        <View style={styles.productPrice}>
          <ThemedText style={[styles.price, { color: isMarken ? colors.error : colors.success }]}>
            € {product.price.toFixed(2)}
          </ThemedText>
        </View>
        <TouchableOpacity style={[styles.checkbox, product.checked && { backgroundColor: colors.primary }]}>
          {product.checked && (
            <IconSymbol name="star.fill" size={16} color="white" />
          )}
        </TouchableOpacity>
      </View>

      {!isMarken && (
        <TouchableOpacity style={[styles.expandButton, { borderTopColor: colors.border }]}>
          <IconSymbol name="star.fill" size={16} color={colors.primary} />
          <ThemedText style={[styles.expandText, { color: colors.primary }]}>
            Eigenmarken zur Umwandlung gefunden
          </ThemedText>
          <IconSymbol name="chevron.right" size={16} color={colors.icon} />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <ThemedView style={styles.container}>


      {/* Tab Navigation */}
      <View style={[styles.tabContainer, { backgroundColor: colors.cardBackground }]}>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'marken' && { backgroundColor: colors.background }
          ]}
          onPress={() => setActiveTab('marken')}
        >
          <ThemedText style={[
            styles.tabText,
            activeTab === 'marken' && { color: colors.text }
          ]}>
            Marken ({markenProducts.length})
          </ThemedText>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            activeTab === 'nonames' && { backgroundColor: colors.background }
          ]}
          onPress={() => setActiveTab('nonames')}
        >
          <ThemedText style={[
            styles.tabText,
            activeTab === 'nonames' && { color: colors.text }
          ]}>
            NoNames ({nonameProducts.length})
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* Savings Banner */}
      {activeTab === 'nonames' && (
        <View style={styles.savingsBanner}>
          <View style={styles.savingsContent}>
            <ThemedText style={styles.savingsLabel}>Einkaufszettel Ersparnis</ThemedText>
          </View>
          <View style={styles.savingsAmount}>
            <IconSymbol name="star.fill" size={16} color="#ff9500" />
            <ThemedText style={styles.savingsText}>€ {totalSavings.toFixed(2)}</ThemedText>
          </View>
        </View>
      )}

      {/* Product List */}
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {activeTab === 'marken' ? (
          <View style={styles.productList}>
            {markenProducts.map(product => renderProduct(product, true))}
          </View>
        ) : (
          <View style={styles.productList}>
            {nonameProducts.map(product => renderProduct(product, false))}
          </View>
        )}
      </ScrollView>

      {/* Convert Button */}
      {activeTab === 'marken' && (
        <TouchableOpacity 
          style={[styles.convertButton, { backgroundColor: colors.primary }]}
          onPress={handleConvertProducts}
        >
          <IconSymbol name="star.fill" size={20} color="white" />
          <ThemedText style={styles.convertButtonText}>
            Produkte umwandeln
          </ThemedText>
        </TouchableOpacity>
      )}

      {/* Mark All as Bought Button */}
      {activeTab === 'nonames' && (
        <TouchableOpacity 
          style={[styles.convertButton, { backgroundColor: colors.primary }]}
        >
          <IconSymbol name="star.fill" size={20} color="white" />
          <ThemedText style={styles.convertButtonText}>
            Alle als gekauft markieren
          </ThemedText>
        </TouchableOpacity>
      )}

      {/* Conversion Confirmation Modal */}
      <Modal
        visible={showConversionModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConversionModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
            <ThemedText style={styles.modalTitle}>
              In NoNames umwandeln
            </ThemedText>
            <ThemedText style={styles.modalText}>
              Die Produkte jetzt in NoName-Produkte umwandeln und zum Ersparnisrechner hinzufügen?
            </ThemedText>
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: colors.border }]}
                onPress={() => setShowConversionModal(false)}
              >
                <ThemedText style={styles.modalButtonText}>Abbrechen</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalButton, { backgroundColor: colors.primary }]}
                onPress={confirmConversion}
              >
                <ThemedText style={[styles.modalButtonText, { color: 'white' }]}>Ja</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Success Modal */}
      <Modal
        visible={showSuccessModal}
        transparent
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.successModal, { backgroundColor: colors.background }]}>
            <View style={[styles.successIcon, { backgroundColor: colors.primary }]}>
              <IconSymbol name="star.fill" size={32} color="white" />
            </View>
            <ThemedText style={styles.successTitle}>
              Deine Markenprodukte wurden erfolgreich in NoName-Produkte umgewandelt!
            </ThemedText>
            <ThemedText style={styles.successSubtitle}>Du hast</ThemedText>
            <ThemedText style={[styles.successAmount, { color: colors.primary }]}>
              € 11,71
            </ThemedText>
            <ThemedText style={styles.successSubtitle}>
              mit der Umwandlung gespart.
            </ThemedText>
            <TouchableOpacity 
              style={[styles.successButton, { backgroundColor: colors.primary }]}
              onPress={() => setShowSuccessModal(false)}
            >
              <ThemedText style={styles.successButtonText}>
                Jetzt ansehen
              </ThemedText>
            </TouchableOpacity>
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
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  headerButton: {
    padding: 8,
  },
  tabContainer: {
    flexDirection: 'row',
    padding: 4,
    margin: 16,
    borderRadius: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    opacity: 0.7,
  },
  savingsBanner: {
    backgroundColor: '#ff9500',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  savingsContent: {
    flex: 1,
  },
  savingsLabel: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  savingsAmount: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  savingsText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  scrollView: {
    flex: 1,
  },
  productList: {
    padding: 16,
    gap: 8,
  },
  productItem: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  productContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  productImage: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  productEmoji: {
    fontSize: 32,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  productBrand: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 2,
  },
  productMarket: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 2,
  },
  discount: {
    fontSize: 12,
    fontWeight: '600',
  },
  productPrice: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  price: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ddd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  expandText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  convertButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    margin: 16,
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  convertButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    padding: 24,
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalText: {
    fontSize: 16,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 24,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '500',
  },
  successModal: {
    padding: 32,
    borderRadius: 16,
    alignItems: 'center',
    width: '100%',
    maxWidth: 400,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 24,
  },
  successSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 8,
  },
  successAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  successButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginTop: 24,
  },
  successButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
