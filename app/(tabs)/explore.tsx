import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

export default function ExploreScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [activeTab, setActiveTab] = useState('märkte');

  const tabs = [
    { id: 'märkte', title: 'Märkte', icon: 'house.fill' },
    { id: 'kategorien', title: 'Kategorien', icon: 'shopping.cart' },
    { id: 'markenprodukte', title: 'Marken-\nProdukte', icon: 'heart.fill' },
    { id: 'nonames', title: 'NoName-\nProdukte', icon: 'star.fill' },
    { id: 'marken', title: 'Marken', icon: 'barcode' },
  ];

  const categories = [
    { title: 'Alkohol', count: '99 Produkte', icon: '🍷', color: colors.primary },
    { title: 'Backwaren / Fertigteig', count: '875 Produkte', icon: '🥖', color: colors.primary },
    { title: 'Butter, Margarine etc.', count: '85 Produkte', icon: '🧈', color: colors.primary },
    { title: 'Drogerie & Haushalt', count: '464 Produkte', icon: '🧴', color: colors.primary },
    { title: 'Fertiggerichte', count: '499 Produkte', icon: '🍝', color: colors.primary },
    { title: 'Festliches', count: '584 Produkte', icon: '🎄', color: colors.primary },
    { title: 'Fisch, Feinkost & mehr', count: '1556 Produkte', icon: '🐟', color: colors.primary },
  ];

  const märkte = [
    { 
      title: 'Aldi Nord - (DE)', 
      count: '1120 Produkte', 
      logo: '🏪',
      description: 'Als Aldi bekannt sind die zwei aus einem gemeinsamen Unternehmen hervorgegangenen, rechtlich selbständigen Unternehmensgruppen und Discount-Einzelhandelsketten Aldi Nord und Aldi Süd.',
      flag: '🇩🇪'
    },
    { 
      title: 'Aldi Süd - (DE)', 
      count: '1127 Produkte', 
      logo: '🏪',
      description: 'Als Aldi bekannt sind die zwei aus einem gemeinsamen Unternehmen hervorgegangenen, rechtlich selbständigen Unternehmensgruppen und Discount-Einzelhandelsketten Aldi Nord und Aldi Süd.',
      flag: '🇩🇪'
    },
    { 
      title: 'EDEKA - (DE)', 
      count: '71 Produkte', 
      logo: '🛒',
      description: 'Die Edeka-Gruppe ist ein genossenschaftlich organisierter kooperativer Unternehmensverbund im deutschen Einzelhandel.',
      flag: '🇩🇪'
    },
  ];

  const marken = [
    {
      title: '11er elfer',
      logo: '🏷️',
      description: 'Wir sind ein modernes Familienunternehmen aus dem Westen Österreichs, das sich ganz der Kartoffel verschrieben hat.',
    },
    {
      title: 'ACETUM',
      logo: '🫒',
      description: 'ACETUM hat seinen Sitz im Herzen einer der reichsten, kulinarischen Region Italiens und ist der weltweit größte Hersteller von zertifiziertem Balsamico-Essig aus Modena PGI.',
    },
    {
      title: 'AHAMA',
      logo: '🌾',
      description: 'Mit über 70 Jahren Erfahrung steht AHAMA für höchste Qualitätsstandards in der Herstellung von Naturprodukten.',
    },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'kategorien':
        return (
          <View style={styles.contentSection}>
            {categories.map((category, index) => (
              <TouchableOpacity key={index} style={[styles.listItem, { borderBottomColor: colors.border }]}>
                <View style={[styles.itemIcon, { backgroundColor: colors.primary + '20' }]}>
                  <ThemedText style={styles.itemEmoji}>{category.icon}</ThemedText>
                </View>
                <View style={styles.itemContent}>
                  <ThemedText style={styles.itemTitle}>{category.title}</ThemedText>
                  <ThemedText style={styles.itemSubtitle}>{category.count}</ThemedText>
                </View>
                <IconSymbol name="chevron.right" size={20} color={colors.icon} />
              </TouchableOpacity>
            ))}
          </View>
        );
      case 'märkte':
        return (
          <View style={styles.contentSection}>
            {märkte.map((markt, index) => (
              <TouchableOpacity key={index} style={[styles.marketItem, { borderBottomColor: colors.border }]}>
                <View style={[styles.marketLogo, { backgroundColor: colors.cardBackground }]}>
                  <ThemedText style={styles.marketEmoji}>{markt.logo}</ThemedText>
                </View>
                <View style={styles.marketContent}>
                  <View style={styles.marketHeader}>
                    <ThemedText style={styles.marketTitle}>{markt.title}</ThemedText>
                    <ThemedText style={styles.marketFlag}>{markt.flag}</ThemedText>
                  </View>
                  <ThemedText style={styles.marketCount}>{markt.count}</ThemedText>
                  <ThemedText style={styles.marketDescription}>{markt.description}</ThemedText>
                </View>
                <IconSymbol name="chevron.right" size={20} color={colors.icon} />
              </TouchableOpacity>
            ))}
          </View>
        );
      case 'marken':
        return (
          <View style={styles.contentSection}>
            {marken.map((marke, index) => (
              <TouchableOpacity key={index} style={[styles.brandItem, { borderBottomColor: colors.border }]}>
                <View style={[styles.brandLogo, { backgroundColor: colors.cardBackground }]}>
                  <ThemedText style={styles.brandEmoji}>{marke.logo}</ThemedText>
                </View>
                <View style={styles.brandContent}>
                  <ThemedText style={styles.brandTitle}>{marke.title}</ThemedText>
                  <ThemedText style={styles.brandDescription}>{marke.description}</ThemedText>
                </View>
                <IconSymbol name="chevron.right" size={20} color={colors.icon} />
              </TouchableOpacity>
            ))}
          </View>
        );
      default:
        return (
          <View style={styles.emptyState}>
            <ThemedText style={styles.emptyText}>Inhalte für {activeTab} werden geladen...</ThemedText>
          </View>
        );
    }
  };

  return (
    <ThemedView style={styles.container}>
      {/* Tab Navigation */}
      <View style={[styles.tabContainer, { backgroundColor: colors.cardBackground, borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={[
                styles.tab,
                activeTab === tab.id && { borderBottomColor: colors.primary }
              ]}
              onPress={() => setActiveTab(tab.id)}
            >
              <IconSymbol 
                name={tab.icon} 
                size={20} 
                color={activeTab === tab.id ? colors.primary : colors.icon} 
              />
              <ThemedText 
                style={[
                  styles.tabText,
                  { color: activeTab === tab.id ? colors.primary : colors.icon }
                ]}
              >
                {tab.title}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Search Bar */}
      <View style={styles.searchSection}>
        <View style={[styles.searchContainer, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <IconSymbol name="magnifyingglass" size={20} color={colors.icon} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Suche in Liste..."
            placeholderTextColor={colors.icon}
          />
        </View>
      </View>

      {/* Content */}
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {renderContent()}
      </ScrollView>

      {/* Floating Action Button */}
      <TouchableOpacity style={[styles.fab, { backgroundColor: colors.primary }]}>
        <IconSymbol name="magnifyingglass" size={24} color="white" />
      </TouchableOpacity>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabContainer: {
    paddingTop: 60,
    borderBottomWidth: 1,
  },
  tabScroll: {
    paddingHorizontal: 20,
  },
  tab: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginRight: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    minWidth: 80,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 14,
  },
  searchSection: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
  },
  scrollView: {
    flex: 1,
  },
  contentSection: {
    paddingHorizontal: 20,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    gap: 16,
  },
  itemIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemEmoji: {
    fontSize: 24,
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  itemSubtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
  marketItem: {
    flexDirection: 'row',
    paddingVertical: 20,
    borderBottomWidth: 1,
    gap: 16,
  },
  marketLogo: {
    width: 60,
    height: 60,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  marketEmoji: {
    fontSize: 24,
  },
  marketContent: {
    flex: 1,
  },
  marketHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  marketTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  marketFlag: {
    fontSize: 20,
  },
  marketCount: {
    fontSize: 14,
    opacity: 0.7,
    marginBottom: 8,
  },
  marketDescription: {
    fontSize: 14,
    opacity: 0.8,
    lineHeight: 20,
  },
  brandItem: {
    flexDirection: 'row',
    paddingVertical: 20,
    borderBottomWidth: 1,
    gap: 16,
  },
  brandLogo: {
    width: 60,
    height: 60,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandEmoji: {
    fontSize: 24,
  },
  brandContent: {
    flex: 1,
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  brandDescription: {
    fontSize: 14,
    opacity: 0.8,
    lineHeight: 20,
  },
  emptyState: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    opacity: 0.7,
  },
  fab: {
    position: 'absolute',
    bottom: 100,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
});
