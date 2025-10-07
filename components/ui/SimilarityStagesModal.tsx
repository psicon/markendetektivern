import { ThemedText } from '@/components/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import React from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

interface SimilarityStagesModalProps {
  visible: boolean;
  onClose: () => void;
}

// Hilfsfunktionen für Stufen
const getStufenColor = (stufe: number): string => {
  switch (stufe) {
    case 0: return '#8E8E93'; // Grau
    case 1: return '#E53E3E'; // Rot
    case 2: return '#F59E0B'; // Orange
    case 3: return '#ECC94B'; // Gelb
    case 4: return '#10B981'; // Grün
    case 5: return '#059669'; // Dunkelgrün
    default: return '#8E8E93';
  }
};

const getStufenTitle = (stufe: number): string => {
  switch (stufe) {
    case 0: return 'Produkt ist (noch) unbekannt';
    case 1: return 'Reiner NoName-Hersteller';
    case 2: return 'Markenhersteller ohne vergleichbares Produkt';
    case 3: return 'Vergleichbar zum Markenprodukt';
    case 4: return 'Sehr ähnlich zum Markenprodukt';
    case 5: return 'Identisch zum Markenprodukt';
    default: return 'Unbekannte Stufe';
  }
};

const getStufenDescription = (stufe: number): string => {
  switch (stufe) {
    case 0: return 'Bei diesem Produkt ist uns (noch) keine Stufe bzw. kein Hersteller bekannt. Wir aktualisieren unsere Datenbank kontinuierlich, um Ihnen die bestmöglichen Informationen zu liefern.';
    case 1: return 'Dieser Hersteller hat nach unseren Recherchen keine Verbindungen zu Markenherstellern oder -produkten. Das Produkt wird ausschließlich als Handelsmarke produziert.';
    case 2: return 'Dieser Hersteller produziert auch für bekannte Marken, aber aktuell kein mit dem NoName-Produkt vergleichbares Markenprodukt. Es besteht jedoch eine Verbindung zu Markenprodukten.';
    case 3: return 'Dieser Hersteller stellt sowohl ein NoName-Produkt als auch ein Markenprodukt her, die sich in Nährwerten und Geschmack ähneln, aber dennoch Unterschiede aufweisen können.';
    case 4: return 'Dieser Hersteller stellt sowohl das NoName-Produkt als auch das Markenprodukt her, die sich in Nährwerten und Geschmack sehr ähnlich sind. Nur minimale Unterschiede sind feststellbar.';
    case 5: return 'Dieser Hersteller stellt sowohl das NoName-Produkt als auch das Markenprodukt her, bei denen die Zusammensetzung und der Geschmack praktisch identisch sind. Sie erhalten die gleiche Qualität zum günstigeren Preis.';
    default: return 'Keine Beschreibung verfügbar.';
  }
};

export const SimilarityStagesModal: React.FC<SimilarityStagesModalProps> = ({
  visible,
  onClose
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.bottomSheetContainer, { backgroundColor: colors.background }]}>
        {/* Bottom Sheet Header */}
        <View style={styles.bottomSheetHeader}>
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>
          <View style={styles.headerRow}>
            <TouchableOpacity 
              style={styles.closeButtonLeft}
              onPress={onClose}
            >
              <IconSymbol name="xmark" size={24} color={colors.icon} />
            </TouchableOpacity>
            <View style={styles.titleSection}>
              <ThemedText style={styles.bottomSheetTitle}>
                Ähnlichkeitsstufen
              </ThemedText>
              <ThemedText style={[styles.bottomSheetSubtitle, { color: colors.icon }]}>
                Bewertung der Produktähnlichkeit
              </ThemedText>
            </View>
            <View style={styles.spacer} />
          </View>
        </View>

        {/* Content */}
        <ScrollView style={styles.bottomSheetContent} showsVerticalScrollIndicator={false}>
          {/* Stages Cards */}
          {[0, 1, 2, 3, 4, 5].map((stage) => (
            <View key={stage} style={[styles.stageInfoCard, { backgroundColor: colors.cardBackground }]}>
              <View style={styles.stageInfoHeader}>
                <View style={[styles.stageInfoBadge, { backgroundColor: getStufenColor(stage) }]}>
                  <ThemedText style={styles.stageInfoNumber}>{stage}</ThemedText>
                </View>
                <View style={styles.stageInfoTextContainer}>
                  <ThemedText style={styles.stageInfoTitle}>
                    {getStufenTitle(stage)}
                  </ThemedText>
                  <ThemedText style={[styles.stageInfoDescription, { color: colors.icon }]}>
                    {getStufenDescription(stage)}
                  </ThemedText>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  bottomSheetContainer: {
    flex: 1,
    paddingTop: 20,
  },
  bottomSheetHeader: {
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  handleContainer: {
    alignItems: 'center',
    paddingBottom: 16,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  closeButtonLeft: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleSection: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 16,
  },
  bottomSheetTitle: {
    fontSize: 20,
    fontWeight: '600',
    fontFamily: 'Nunito_600SemiBold',
    textAlign: 'center',
  },
  bottomSheetSubtitle: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
    marginTop: 2,
  },
  spacer: {
    width: 40,
  },
  bottomSheetContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  stageInfoCard: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  stageInfoHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stageInfoBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  stageInfoNumber: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Nunito_700Bold',
  },
  stageInfoTextContainer: {
    flex: 1,
  },
  stageInfoTitle: {
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 4,
  },
  stageInfoDescription: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 20,
  },
});
