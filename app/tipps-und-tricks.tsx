import { ThemedText } from '@/components/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useNavigation } from 'expo-router';
import React, { useLayoutEffect } from 'react';
import {
  Dimensions,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface TipCardProps {
  icon: string;
  iconColor: string;
  title: string;
  description: string;
  tips: string[];
  colors: any;
}

const TipCard: React.FC<TipCardProps> = ({ icon, iconColor, title, description, tips, colors }) => (
  <View style={[styles.tipCard, { backgroundColor: colors.cardBackground, borderColor: colors.border }]}>
    <View style={styles.tipHeader}>
      <View style={[styles.iconContainer, { backgroundColor: iconColor + '15' }]}>
        <IconSymbol name={icon as any} size={28} color={iconColor} />
      </View>
      <View style={styles.headerText}>
        <ThemedText style={[styles.tipTitle, { color: colors.text }]}>{title}</ThemedText>
        <ThemedText style={[styles.tipDescription, { color: colors.icon }]}>{description}</ThemedText>
      </View>
    </View>
    <View style={styles.tipsList}>
      {tips.map((tip, index) => (
        <View key={index} style={styles.tipItem}>
          <View style={[styles.bulletPoint, { backgroundColor: iconColor }]} />
          <ThemedText style={[styles.tipText, { color: colors.text }]}>{tip}</ThemedText>
        </View>
      ))}
    </View>
  </View>
);

interface QuickTipProps {
  emoji: string;
  text: string;
  colors: any;
}

const QuickTip: React.FC<QuickTipProps> = ({ emoji, text, colors }) => (
  <View style={[styles.quickTip, { backgroundColor: colors.cardBackground }]}>
    <Text style={styles.quickTipEmoji}>{emoji}</Text>
    <ThemedText style={[styles.quickTipText, { color: colors.text }]}>{text}</ThemedText>
  </View>
);

export default function TippsUndTricksScreen() {
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  // Header konfigurieren im App-Stil (wie shopping-list)
  useLayoutEffect(() => {
    navigation.setOptions({
      ...getNavigationHeaderOptions(colorScheme, 'Tipps & Tricks'),
    });
  }, [colorScheme, navigation]);

  const tipCategories = [
    {
      icon: 'magnifyingglass.circle',
      iconColor: '#007AFF',
      title: 'Stöbern & Entdecken',
      description: 'Finde versteckte Schätte beim Einkaufen',
      tips: [
        'Nutze "Stöbern" täglich: Neue Produkte werden ständig hinzugefügt - verpasse keine Deals!',
        'Filtere nach deinen Lieblings-Märkten: Sieh nur Produkte die du auch wirklich in deinem Supermarkt kaufen kannst',
        'Durchstöbere alle Kategorien: Oft findest du Alternativen wo du sie nicht erwartest',
        'Schaue regelmäßig vorbei: Die besten NoName-Funde sind oft zeitlich begrenzt',
        'Nutze die Suchfunktion: Tippe einfach ein was du suchst - wir finden die günstigsten Alternativen'
      ]
    },
    {
      icon: 'camera.fill',
      iconColor: '#34C759',
      title: 'Scanner wie ein Profi nutzen',
      description: 'Maximal sparen durch clever scannen',
      tips: [
        'Scanne ALLES was dich interessiert: Auch bei Produkten wo du denkst "das gibt es sicher nicht" - oft wirst du überrascht!',
        'Scanne im Gang: Direkt beim Einkaufen - sieh sofort ob es günstigere Alternativen gibt',
        'Scanne zu Hause: Checke deine Vorräte - welche Markenprodukte kannst du ersetzen?',
        'Scanne Freunde ein: Gemeinsam entdeckt ihr mehr Spar-Möglichkeiten',
        'Scanne täglich: Je mehr du scannst, desto mehr Punkte und Belohnungen erhältst du'
      ]
    },
    {
      icon: 'eurosign.circle',
      iconColor: '#FF9500',
      title: 'Geld sparen ohne Verzicht',
      description: 'So sparst du richtig viel Geld',
      tips: [
        'Starte mit den Basics: Reis, Nudeln, Mehl - hier sparst du sofort 50-70% ohne Qualitätsverlust',
        'Teste systematisch: Ersetze 1-2 Markenprodukte pro Woche durch NoName-Alternativen',
        'Nutze die Stufen: Stufe 4-5 bedeutet oft identisches Produkt zum halben Preis!',
        'Schaue nach Aktionen: Manche NoName-Produkte sind zeitlich begrenzt besonders günstig',
        'Dokumentiere mit MarkenDetektive deine Ersparnis: Du wirst staunen wie schnell sich das summiert wenn du Produkte als gekauft markierst!'
      ]
    },
    {
      icon: 'heart.fill',
      iconColor: '#FF3B30',
      title: 'Favoriten sammeln',
      description: 'Sammle deine besten Funde',
      tips: [
        'Speichere Top-Funde: Jedes Produkt das dich überzeugt gehört in deine Favoriten',
        'Teile Favoriten: Freunde und Familie profitieren von deinen Entdeckungen',
        'Organisiere nach Kategorien: Sortiere deine Favoriten für schnelleren Überblick',
        'Checke Favoriten regelmäßig: Preise und Verfügbarkeit ändern sich',
        'Baue deine Sammlung auf: Je mehr Favoriten, desto günstiger wird dein Einkauf'
      ]
    },
    {
      icon: 'star.fill',
      iconColor: '#30D158',
      title: 'Level Up dein Sparverhalten',
      description: 'Werde zum Spar-Champion',
      tips: [
        'Sammle täglich Punkte: Login, scannen, stöbern - jede Aktion bringt dich weiter',
        'Erreiche höhere Level: Mit jedem Level schaltest du neue Features und Belohnungen frei',
        'Halte deine Streak: Tägliche Nutzung verdoppelt deine Punkte',
        'Teile deine Erfolge: Zeig Freunden wie viel du schon gespart hast',
        'Nutze alle Features: Einkaufszettel, Favoriten, Scanner - alles bringt Punkte und Ersparnis'
      ]
    },
    {
      icon: 'target',
      iconColor: '#AF52DE',
      title: 'Der Weg zu 200€ Ersparnis',
      description: 'So schaffst du es garantiert',
      tips: [
        'Woche 1-2: Scanne 10 Produkte täglich und ersetze die 5 besten Funde',
        'Woche 3-4: Stöbere durch alle Kategorien und baue deine Favoriten-Liste auf',
        'Monat 2: Nutze Einkaufszettel-Funktion für organisierten Spar-Einkauf',
        'Monat 3: Du bist jetzt Profi! 200€ weniger Ausgaben bei gleichem Einkaufserlebnis',
        'Dauerhaft: Halte die App aktuell - neue Produkte bedeuten neue Spar-Chancen!'
      ]
    }
  ];

  const quickTips = [
    { emoji: '🛒', text: 'Füge Produkte dem Einkaufszettel hinzu und markiere sie als gekauft.' },
    { emoji: '🛒', text: 'Nur gekaufte NoName-Produkte werden in der Ersparnis berücksichtigt.' },
    { emoji: '💰', text: 'Spare bis zu 200€ pro Monat als 2-Personen-Haushalt' },
    { emoji: '🔍', text: 'Entdecke über 50.000 Produkte beim Stöbern' },
    { emoji: '⚡', text: 'Enttarne täglich neue NoName-Alternativen zu Markenprodukten' },
    { emoji: '🎯', text: 'Stufe 5 = Identisches Produkt, deutlich günstigerer Preis' },
    { emoji: '📱', text: 'Nutze Barcodescanner und Stöbern für maximale Spar-Power' }
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView 
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingTop: 20, paddingBottom: insets.bottom + 30 }]}
      >
        {/* Intro Section */}
        <View style={styles.introSection}>
          <ThemedText style={[styles.introTitle, { color: colors.text }]}>
            Spare bis zu 200€ pro Monat
          </ThemedText>
          <ThemedText style={[styles.introSubtitle, { color: colors.icon }]}>
            Entdecke versteckte Schätze beim Einkaufen
          </ThemedText>
        </View>
        {/* Quick Tips Banner */}
        <View style={styles.quickTipsSection}>
          <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>💡 Wusstest du schon?</ThemedText>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickTipsContainer}
          >
            {quickTips.map((tip, index) => (
              <QuickTip key={index} {...tip} colors={colors} />
            ))}
          </ScrollView>
        </View>

        {/* Hauptkategorien */}
        <View style={styles.mainContent}>
          {tipCategories.map((category, index) => (
            <TipCard key={index} {...category} colors={colors} />
          ))}
        </View>

        {/* Stöbern Call-to-Action */}
        <View style={[styles.ctaSection, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}>
          <View style={styles.ctaHeader}>
            <IconSymbol name="magnifyingglass.circle.fill" size={28} color={colors.primary} />
            <ThemedText style={[styles.ctaTitle, { color: colors.text }]}>Jetzt gleich stöbern!</ThemedText>
          </View>
          <ThemedText style={[styles.ctaText, { color: colors.text }]}>
            Gehe zu "Stöbern" und entdecke tausende NoName-Alternativen. Jede Minute stöbern spart dir beim Einkauf später bares Geld.
            Füge die Produkte zu deinem Einkaufszettel und markiere sie als gekauft wenn du sie gekauft hast. Nur dann wird deine Ersparnis richtig berechnet!
          </ThemedText>
          <View style={[styles.ctaHighlight, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
            <Text style={styles.ctaHighlightText}>
              🎯 Ziel: 200€ pro Monat sparen mit nur 10 Minuten stöbern täglich
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  introSection: {
    alignItems: 'center',
    marginBottom: 30,
    paddingHorizontal: 20,
  },
  introTitle: {
    fontSize: 24,
    fontFamily: 'Nunito_700Bold',
    marginBottom: 12,
    textAlign: 'center',
    lineHeight: 30,
  },
  introSubtitle: {
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
    textAlign: 'center',
    lineHeight: 22,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },
  quickTipsSection: {
    marginBottom: 30,
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 16,
  },
  quickTipsContainer: {
    paddingRight: 20,
    gap: 12,
  },
  quickTip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    width: SCREEN_WIDTH * 0.8,
    gap: 12,
  },
  quickTipEmoji: {
    fontSize: 24,
  },
  quickTipText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    flex: 1,
    lineHeight: 20,
  },
  mainContent: {
    gap: 24,
  },
  tipCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
  },
  tipHeader: {
    flexDirection: 'row',
    marginBottom: 20,
    gap: 16,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
  },
  tipTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 6,
  },
  tipDescription: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 20,
  },
  tipsList: {
    gap: 16,
  },
  tipItem: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  bulletPoint: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    flexShrink: 0,
  },
  tipText: {
    fontSize: 15,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 22,
    flex: 1,
  },
  ctaSection: {
    marginTop: 30,
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  ctaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  ctaTitle: {
    fontSize: 20,
    fontFamily: 'Nunito_700Bold',
  },
  ctaText: {
    fontSize: 15,
    fontFamily: 'Nunito_400Regular',
    lineHeight: 22,
    marginBottom: 16,
  },
  ctaHighlight: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  ctaHighlightText: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
    textAlign: 'center',
    lineHeight: 22,
    color: 'white',
  },
});
