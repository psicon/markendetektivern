import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { FirestoreService } from '@/lib/services/firestore';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { IconSymbol } from './IconSymbol';
import { MarketSelector } from './MarketSelector';

interface AddCustomItemModalProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export const AddCustomItemModal: React.FC<AddCustomItemModalProps> = ({
  visible,
  onClose,
  userId,
  onSuccess,
  onError
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  // Form States
  const [itemName, setItemName] = useState('');
  const [itemType, setItemType] = useState<'brand' | 'noname'>('brand');
  const [selectedMarket, setSelectedMarket] = useState<any>(null);
  const [showMarketSelector, setShowMarketSelector] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Helper function to get country flag emoji
  const getCountryFlag = (country: string): string => {
    const flagMap: {[key: string]: string} = {
      'Deutschland': '🇩🇪',
      'DE': '🇩🇪',
      'Schweiz': '🇨🇭',
      'CH': '🇨🇭',
      'Österreich': '🇦🇹',
      'AT': '🇦🇹'
    };
    return flagMap[country] || '🏪';
  };

  // Reset form when modal opens
  useEffect(() => {
    if (visible) {
      setItemName('');
      setItemType('brand');
      setSelectedMarket(null);
    }
  }, [visible]);

  const handleSubmit = async () => {
    // Validation
    if (!itemName.trim()) {
      Alert.alert('Fehler', 'Bitte gib einen Produktnamen ein.');
      return;
    }

    if (itemType === 'noname' && !selectedMarket) {
      Alert.alert('Fehler', 'Bitte wähle einen Markt für NoName-Produkte aus.');
      return;
    }

    setIsSubmitting(true);

    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const customItem = {
        name: itemName.trim(),
        type: itemType,
        ...(itemType === 'noname' && selectedMarket && {
          marketId: selectedMarket.id,
          marketName: selectedMarket.name,
          marketLand: selectedMarket.land,
          marketBild: selectedMarket.bild
        })
      };

      await FirestoreService.addCustomItemToShoppingCart(userId, customItem);
      
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess(`📝 "${itemName}" wurde hinzugefügt!`);
      onClose();
    } catch (error) {
      console.error('Error adding custom item:', error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      onError('Fehler beim Hinzufügen des Produkts');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>
          <View style={styles.headerRow}>
            <TouchableOpacity 
              style={styles.closeButton}
              onPress={onClose}
            >
              <IconSymbol name="xmark" size={24} color={colors.icon} />
            </TouchableOpacity>
            <View style={styles.titleSection}>
              <Text style={[styles.title, { color: colors.text }]}>
                Manuell hinzufügen
              </Text>
              <Text style={[styles.subtitle, { color: colors.icon }]}>
                Freitext-Produkt erstellen
              </Text>
            </View>
          </View>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Product Name Input */}
          <View style={[styles.section, { backgroundColor: colors.cardBackground }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Produktname *
            </Text>
            <TextInput
              style={[
                styles.textInput,
                { 
                  backgroundColor: colors.background,
                  color: colors.text,
                  borderColor: colors.border
                }
              ]}
              value={itemName}
              onChangeText={setItemName}
              placeholder="z.B. Butter, Milch, Brot..."
              placeholderTextColor={colors.icon}
              autoCapitalize="words"
              autoComplete="off"
              maxLength={50}
            />
          </View>

          {/* Product Type Selection */}
          <View style={[styles.section, { backgroundColor: colors.cardBackground }]}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Produkttyp *
            </Text>
            <View style={styles.typeButtons}>
              <TouchableOpacity
                style={[
                  styles.typeButton,
                  itemType === 'brand' && { backgroundColor: colors.primary },
                  { borderColor: colors.border }
                ]}
                onPress={() => setItemType('brand')}
              >
                <IconSymbol 
                  name="star.fill" 
                  size={20} 
                  color={itemType === 'brand' ? 'white' : colors.icon} 
                />
                <Text style={[
                  styles.typeButtonText,
                  { color: itemType === 'brand' ? 'white' : colors.text }
                ]}>
                  Markenprodukt
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.typeButton,
                  itemType === 'noname' && { backgroundColor: colors.primary },
                  { borderColor: colors.border }
                ]}
                onPress={() => setItemType('noname')}
              >
                <IconSymbol 
                  name="storefront" 
                  size={20} 
                  color={itemType === 'noname' ? 'white' : colors.icon} 
                />
                <Text style={[
                  styles.typeButtonText,
                  { color: itemType === 'noname' ? 'white' : colors.text }
                ]}>
                  NoName-Produkt
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Market Selection (only for NoName) */}
          {itemType === 'noname' && (
            <View style={[styles.section, { backgroundColor: colors.cardBackground }]}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Markt für dieses Produkt auswählen *
              </Text>
              <TouchableOpacity 
                style={[
                  styles.marketSelector,
                  { 
                    backgroundColor: colors.background,
                    borderColor: colors.border
                  }
                ]}
                onPress={() => setShowMarketSelector(true)}
              >
                <Text style={[
                  styles.marketSelectorText, 
                  { 
                    color: selectedMarket ? colors.text : colors.icon 
                  }
                ]}>
                  {selectedMarket ? 
                    `${getCountryFlag(selectedMarket.land)} ${selectedMarket.name}` : 
                    'Markt auswählen'
                  }
                </Text>
                <IconSymbol name="storefront" size={20} color={colors.icon} />
              </TouchableOpacity>
            </View>
          )}

          {/* Info Box */}
          <View style={[styles.infoBox, { backgroundColor: colors.cardBackground }]}>
            <IconSymbol name="info.circle" size={20} color={colors.primary} />
            <View style={styles.infoText}>
              <Text style={[styles.infoTitle, { color: colors.text }]}>
                {itemType === 'brand' ? 'Markenprodukt' : 'NoName-Produkt'}
              </Text>
              <Text style={[styles.infoDescription, { color: colors.icon }]}>
                {itemType === 'brand' 
                  ? 'Freitext-Eintrag ohne Preisinformationen oder Alternativen.'
                  : 'NoName-Produkt aus dem gewählten Markt ohne Preisinformationen.'
                }
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Submit Button */}
        <View style={[styles.footer, { backgroundColor: colors.cardBackground }]}>
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary },
              (!itemName.trim() || (itemType === 'noname' && !selectedMarket) || isSubmitting) && {
                opacity: 0.5
              }
            ]}
            onPress={handleSubmit}
            disabled={!itemName.trim() || (itemType === 'noname' && !selectedMarket) || isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <>
                <IconSymbol name="plus" size={20} color="white" />
                <Text style={styles.submitButtonText}>
                  Hinzufügen
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Market Selector Modal */}
        <MarketSelector
          visible={showMarketSelector}
          onClose={() => setShowMarketSelector(false)}
          onSelect={(market) => {
            setSelectedMarket(market);
            console.log(`✅ Market selected: ${market.name} (${market.land})`);
          }}
          selectedMarketId={selectedMarket?.id}
          title="Markt für dieses Produkt wählen"
        />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#DDD',
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    gap: 16,
  },
  closeButton: {
    marginTop: -4,
  },
  titleSection: {
    flex: 1,
  },
  title: {
    fontSize: 17,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Nunito_400Regular',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 12,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
  },
  typeButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
  },
  typeButtonText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  infoBox: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 12,
    alignItems: 'flex-start',
    gap: 12,
  },
  infoText: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 4,
  },
  infoDescription: {
    fontSize: 13,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 18,
  },
  footer: {
    padding: 16,
    paddingTop: 12,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  marketSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  marketSelectorText: {
    fontSize: 15,
    fontFamily: 'Nunito_400Regular',
    flex: 1,
  },
});
