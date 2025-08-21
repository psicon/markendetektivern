import { ThemedText } from '@/components/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { LevelBadge } from '@/components/ui/LevelBadge';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useTheme } from '@/lib/contexts/ThemeContext';
import { useRouter } from 'expo-router';
// @ts-ignore
import { LinearGradient } from 'expo-linear-gradient';
// @ts-ignore
import React, { useEffect, useState } from 'react';
import {
    Alert,
    Linking,
    Platform,
    SafeAreaView,
    ScrollView,
    Share,
    StatusBar,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { version as packageVersion } from '../../package.json';

export default function MoreScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user, userProfile, logout } = useAuth();
  const { isDarkMode, toggleDarkMode, themeMode, setThemeMode } = useTheme();
  const router = useRouter();
  const [appVersion, setAppVersion] = useState('1.0.0');

  useEffect(() => {
    // Get app version from package.json
    setAppVersion(packageVersion || '1.0.0');
  }, []);

  const handleDarkModeToggle = (value: boolean) => {
    toggleDarkMode();
    console.log(`✅ Theme toggled to: ${value ? 'dark' : 'light'} mode`);
  };



  const handleMoreTips = () => {
    Linking.openURL('https://www.markendetektive.de/blog/');
  };

  const handlePremiumUpgrade = () => {
    // TODO: Navigate to premium upgrade page
    console.log('Navigate to premium upgrade');
  };

  const handleShoppingCart = () => {
    // TODO: Navigate to shopping cart
    console.log('Navigate to shopping cart');
  };

  const handleFavoriteProducts = () => {
    router.push('/favorites' as any);
  };

  const handleIdentityDatabase = () => {
    // TODO: Navigate to identity database
    console.log('Navigate to identity database');
  };

  const handleTieredSystemInfo = () => {
    Alert.alert(
      'Stufensystem erklärt',
      'Stufe 1-2: Eigenmarken\nStufe 3: Verdächtig ähnlich\nStufe 4: Sehr wahrscheinlich identisch\nStufe 5: Bestätigt identisch',
      [{ text: 'OK', style: 'default' }]
    );
  };

  const handleTipsAndTricks = () => {
    // TODO: Navigate to tips and tricks page
    console.log('Navigate to tips and tricks');
  };

  const handleNews = () => {
    Linking.openURL('https://www.markendetektive.de/blog/');
  };

  const handleSocialMedia = () => {
    Alert.alert(
      'Social Media',
      'Folge uns auf unseren Social Media Kanälen!',
      [
        { text: 'Instagram', onPress: () => Linking.openURL('https://instagram.com/markendetektive') },
        { text: 'Facebook', onPress: () => Linking.openURL('https://facebook.com/markendetektive') },
        { text: 'Abbrechen', style: 'cancel' }
      ]
    );
  };

  const handleRateApp = () => {
    // TODO: Open app store rating
    Alert.alert('App bewerten', 'Vielen Dank für dein Feedback!');
  };

  const handleShareApp = () => {
    Share.share({
      message: 'Schau dir die Markendetektive App an! Spare Geld mit NoName-Produkten.',
      url: 'https://markendetektive.de'
    });
  };

  const handlePrivacyPolicy = () => {
    Linking.openURL('https://www.markendetektive.de/datenschutzerklaerung-haftungsausschluss/');
  };

  const handleTermsOfService = () => {
    Linking.openURL('https://www.markendetektive.de/agb/');
  };

  const handleContact = () => {
    Linking.openURL('https://www.markendetektive.de/kontakt/');
  };

  // Real data from user profile
  const totalSavings = userProfile?.totalSavings || 0;
  const productCount = userProfile?.productsSaved || 0;
  const isPremium = userProfile?.isPremium || false;
  const level = (userProfile as any)?.stats?.currentLevel || userProfile?.level || 1;
  const currentPoints = (userProfile as any)?.stats?.totalPoints || 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      
      {/* Fixed Header */}
      <View style={[styles.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <ThemedText style={styles.headerTitle}>
          {user?.displayName || 'Weitere Inhalte'}
        </ThemedText>
      </View>
      
      <ScrollView 
        style={[styles.scrollView, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >

        {/* Level Badge */}
        <TouchableOpacity 
          style={styles.levelBadgeContainer}
          onPress={() => router.push('/achievements' as any)}
          activeOpacity={0.8}
        >
          <LevelBadge 
            level={level}
            size="medium"
            showDescription={true}
            showProgress={false}
            currentSavings={totalSavings}
            currentPoints={currentPoints}
          />
        </TouchableOpacity>

        {/* Gesamtersparnis Card - ACHIEVEMENTS STIL */}
        <View style={styles.savingsCardContainer}>
          <LinearGradient
            colors={['#FF9800', '#FF5722']}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 0 }}
            style={styles.savingsCardGradient}
          >
            <View style={styles.savingsCardContent}>
              <TouchableOpacity onPress={() => router.push('/achievements' as any)}>
                <ThemedText style={styles.savingsCardLabel}>Deine Gesamtersparnis</ThemedText>
                <ThemedText style={styles.savingsCardAmount}>€ {totalSavings.toFixed(2)}</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity style={styles.productsCardBadge} onPress={() => router.push('/purchase-history' as any)}>
                <IconSymbol name="number" size={14} color={colors.warning} />
                <ThemedText style={styles.productsCardText}>{productCount} gekaufte Produkte</ThemedText>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>

        {/* Tipp des Tages Card */}
        <View style={styles.cardContainer}>
          <LinearGradient
            colors={[colors.primary, colors.secondary]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 0 }}
            style={styles.tipCard}
          >
            <View style={styles.tipContent}>
              <View style={styles.tipHeader}>
                <IconSymbol name="lightbulb" size={18} color="white" />
                <ThemedText style={styles.tipTitle}>Tipp des Tages</ThemedText>
              </View>
              <ThemedText style={styles.tipText}>
                Vergleiche immer die Zutaten: Oft sind No-Name Produkte vom selben Hersteller mit identischen Zutaten!
              </ThemedText>
              <TouchableOpacity style={styles.moreTipsButton} onPress={handleMoreTips}>
                <IconSymbol name="arrow.right" size={16} color={colors.secondary} />
                <ThemedText style={styles.moreTipsText}>Mehr Tipps</ThemedText>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>

        {/* Premium Card - nur anzeigen wenn nicht Premium */}
        {!isPremium && (
          <TouchableOpacity style={styles.cardContainer} onPress={handlePremiumUpgrade}>
            <View style={[styles.premiumCard, { borderColor: colors.secondary }]}>
              <View style={styles.premiumContent}>
                <IconSymbol name="crown" size={24} color={colors.secondary} />
                <ThemedText style={[styles.premiumText, { color: colors.text }]}>
                  Jetzt Premium Mitglied werden
                </ThemedText>
                <IconSymbol name="star" size={24} color="#F59E0B" />
              </View>
            </View>
          </TouchableOpacity>
        )}

        {/* Nützliches Section */}
        <View style={styles.sectionContainer}>
          <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>Nützliches</ThemedText>
          
          <View style={[styles.menuGroup, { backgroundColor: colors.cardBackground }]}>
            <TouchableOpacity style={styles.menuItem} onPress={handleShoppingCart}>
              <IconSymbol name="cart" size={24} color={colors.secondary} />
              <ThemedText style={[styles.menuItemText, { color: colors.text }]}>Einkaufszettel</ThemedText>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
            
            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            
            <TouchableOpacity style={styles.menuItem} onPress={handleFavoriteProducts}>
              <IconSymbol name="heart" size={24} color={colors.secondary} />
              <ThemedText style={[styles.menuItemText, { color: colors.text }]}>Deine Lieblingsprodukte</ThemedText>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
            
            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            
            <TouchableOpacity style={styles.menuItem} onPress={handleIdentityDatabase}>
              <IconSymbol name="doc.text" size={24} color={colors.secondary} />
              <ThemedText style={[styles.menuItemText, { color: colors.text }]}>Identitätskennzeichen-Datenbank</ThemedText>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
            
            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            
            <TouchableOpacity style={styles.menuItem} onPress={handleTieredSystemInfo}>
              <IconSymbol name="chart.bar" size={24} color={colors.secondary} />
              <ThemedText style={[styles.menuItemText, { color: colors.text }]}>Stufensystem erklärt</ThemedText>
              <View style={styles.stufenIcons}>
                <IconSymbol name="cube" size={18} color="#F59E0B" />
                <IconSymbol name="cube" size={18} color="#10B981" />
                <IconSymbol name="cube" size={18} color={colors.secondary} />
              </View>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
            
            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            
            <TouchableOpacity style={styles.menuItem} onPress={handleTipsAndTricks}>
              <IconSymbol name="lightbulb" size={24} color={colors.secondary} />
              <ThemedText style={[styles.menuItemText, { color: colors.text }]}>Tipps & Tricks</ThemedText>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
            
            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            
            <TouchableOpacity style={styles.menuItemLast} onPress={handleNews}>
              <IconSymbol name="newspaper" size={24} color={colors.secondary} />
              <ThemedText style={[styles.menuItemText, { color: colors.text }]}>Neuigkeiten</ThemedText>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Mehr Section */}
        <View style={styles.sectionContainer}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Mehr</Text>
          
          <View style={[styles.menuGroup, { backgroundColor: colors.cardBackground }]}>
            {/* Mein Profil / Login Button */}
            <TouchableOpacity 
              style={styles.menuItem} 
              onPress={() => {
                if (user) {
                  router.push('/profile');
                } else {
                  router.push('/auth/welcome');
                }
              }}
            >
              <IconSymbol 
                name={user ? "person.circle" : "person.badge.plus"} 
                size={24} 
                color={colors.secondary} 
              />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                {user ? "Mein Profil" : "Login / Registrieren"}
              </Text>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
            
            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            
            <TouchableOpacity style={styles.menuItem} onPress={handleSocialMedia}>
              <IconSymbol name="person.2" size={24} color={colors.secondary} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>Find us on social media</Text>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
            
            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            
            <TouchableOpacity style={styles.menuItem} onPress={handleRateApp}>
              <IconSymbol name="star" size={24} color={colors.secondary} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>App bewerten</Text>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
            
            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            
            <TouchableOpacity style={styles.menuItemLast} onPress={handleShareApp}>
              <IconSymbol name="square.and.arrow.up" size={24} color={colors.secondary} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>App teilen</Text>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Kontakt & Rechtliches Section */}
        <View style={styles.sectionContainer}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Kontakt & Rechtliches</Text>
          
          <View style={[styles.menuGroup, { backgroundColor: colors.cardBackground }]}>
            <TouchableOpacity style={styles.menuItem} onPress={handlePrivacyPolicy}>
              <IconSymbol name="shield" size={24} color={colors.secondary} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>Datenschutz & Haftungsausschluss</Text>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
            
            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            
            <TouchableOpacity style={styles.menuItem} onPress={handleTermsOfService}>
              <IconSymbol name="doc" size={24} color={colors.secondary} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>AGB</Text>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
            
            <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            
            <TouchableOpacity style={styles.menuItemLast} onPress={handleContact}>
              <IconSymbol name="envelope" size={24} color={colors.secondary} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>Kontakt</Text>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Dark Mode Toggle als separate Menu-Gruppe */}
        <View style={styles.sectionContainer}>
          <View style={[styles.menuGroup, { backgroundColor: colors.cardBackground }]}>
            <TouchableOpacity 
              style={styles.menuItemLast} 
              onPress={toggleDarkMode}
              activeOpacity={0.7}
            >
              <IconSymbol 
                name={isDarkMode ? "moon" : "sun.max"} 
                size={24} 
                color={colors.secondary} 
              />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                Dunkler Modus
              </Text>
              <Switch
                value={isDarkMode}
                onValueChange={toggleDarkMode}
                trackColor={{ 
                  false: colors.border, 
                  true: colors.secondary 
                }}
                thumbColor={isDarkMode ? colors.cardBackground : colors.secondary}
                ios_backgroundColor={colors.border}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Version */}
        <View style={styles.versionContainer}>
          <ThemedText style={[styles.versionText, { color: colors.icon }]}>
            Version [{appVersion}]
          </ThemedText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: 'Nunito_700Bold',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 100 : 20,
  },
  cardContainer: {
    marginHorizontal: 16,
    marginBottom: 12,
  },
  // Neue Savings Card Styles - ACHIEVEMENTS STIL
  levelBadgeContainer: {
    marginHorizontal: 16,
    marginBottom: 16,
  },
  savingsCardContainer: {
    marginHorizontal: 16,
    marginBottom: 25,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.09,
    shadowRadius: 2,
    elevation: 2,
    // KEIN overflow hier - Shadow muss sichtbar bleiben
  },
  savingsCardGradient: {
    padding: 10,
    borderRadius: 16,
    overflow: 'hidden',
  },
  savingsCardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  savingsCardLabel: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
    lineHeight: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  savingsCardAmount: {
    color: 'white',
    fontSize: 23,
    fontWeight: '600',
    lineHeight: 26,
    fontFamily: 'Nunito_600SemiBold',
  },
  productsCardBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    gap: 2,
  },
  productsCardText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF9800',
    lineHeight: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  tipCard: {
    borderRadius: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  tipContent: {
    flex: 1,
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  tipTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: 'Nunito_600SemiBold',
  },
  tipText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '300',
    fontFamily: 'Nunito_300Light',
    lineHeight: 20,
    marginBottom: 12,
  },
  moreTipsButton: {
    backgroundColor: 'white',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-end',
  },
  moreTipsText: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'Nunito_600SemiBold',
  },
  premiumCard: {
    borderRadius: 16,
    borderWidth: 2,
    height: 50,
    justifyContent: 'center',
  },
  premiumContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  premiumText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    fontFamily: 'Nunito_500Medium',
  },
  sectionContainer: {
    marginTop: 25,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '500',
    fontFamily: 'Nunito_500Medium',
    marginLeft: 24,
    marginBottom: 12,
  },
  menuGroup: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  menuItemLast: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  menuItemText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '400',
    fontFamily: 'Nunito_400Regular',
  },
  menuDivider: {
    height: 1,
    marginLeft: 52,
  },
  stufenIcons: {
    flexDirection: 'row',
    gap: 4,
    marginRight: 8,
  },

  versionContainer: {
    alignItems: 'center',
    marginTop: 25,
    marginBottom: 25,
  },
  versionText: {
    fontSize: 16,
    fontWeight: '400',
    fontFamily: 'Nunito_400Regular',
  },
});