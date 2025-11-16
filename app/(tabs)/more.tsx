import { ThemedText } from '@/components/ThemedText';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { LevelBadge } from '@/components/ui/LevelBadge';
import { SimilarityStagesModal } from '@/components/ui/SimilarityStagesModal';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { usePushNotifications } from '@/lib/contexts/PushNotificationProvider';
import { useRevenueCat } from '@/lib/contexts/RevenueCatProvider';
import { useTheme } from '@/lib/contexts/ThemeContext';
import { categoryAccessService } from '@/lib/services/categoryAccessService';
import { gamificationSettingsService } from '@/lib/services/gamificationSettingsService';
import { ratingPromptService } from '@/lib/services/ratingPrompt';
import { useFocusEffect, useRouter } from 'expo-router';
// @ts-ignore
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
// @ts-ignore
import Constants from 'expo-constants';
import React, { useCallback, useEffect, useState } from 'react';
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

const dailyTips = [
  "Vergleiche immer die Zutaten: Oft sind No-Name Produkte vom selben Hersteller mit identischen Zutaten!",
  "Achte auf die Herstellerangabe: Viele Markenprodukte werden in denselben Fabriken wie No-Name Artikel produziert.",
  "Nutze den Scanner bei jedem Einkauf: So entdeckst du versteckte Alternativen direkt im Supermarkt.",
  "Prüfe die Nährwerte: No-Name Produkte haben oft bessere Werte als teure Markenprodukte und somit bessere Qualität.",
  "Kaufe saisonale Produkte: No-Name Artikel sind auch zu Weihnachten, Ostern, etc. besonders günstig.",
  "Vergleiche Grundpreise: Der Kilopreis zeigt dir die wahren Ersparnisse zwischen Marke und No-Name.",
  "Teste verschiedene Märkte: Jede Kette hat eigene No-Name Perlen mit unterschiedlichen Stärken.",
  "Achte auf Aktionen: No-Name Produkte in Kombination mit Rabatten ergeben maximale Ersparnisse.",
  "Lies Kundenbewertungen: Viele No-Name Artikel übertreffen Markenprodukte in Geschmack und Qualität.",
  "Plane deine Einkäufe: Mit der Einkaufsliste und No-Name Alternativen sparst du bis zu 200€ monatlich.",
  "Nutze die Stufen: Stufe 4-5 bedeutet oft identisches Produkt zum halben Preis!",
  "Schaue nach Aktionen: Manche No-Name-Produkte sind zeitlich begrenzt besonders günstig",
  "Dokumentiere deine Ersparnis: Du wirst staunen wie schnell sich das summiert!",
  "Teile deine Erfolge: Zeig Freunden wie viel du schon gespart hast",
  "Erreiche höhere Level: Mit jedem Level schaltest du neue Features und Belohnungen frei",
  "Nutze alle Features: Einkaufszettel, Favoriten, Scanner - alles bringt Punkte und Ersparnis",
  "Sammle täglich Punkte: Login, scannen, stöbern - jede Aktion bringt dich weiter",
  "Markenprodukte sind nicht immer besser: Oft sind No-Name-Produkte genau so gut oder besser!",
  "Laut Stiftung Warentest sind No-Name-Produkte genau so gut oder besser!"
];

export default function MoreScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user, userProfile, logout } = useAuth();
  const { isDarkMode, toggleDarkMode, themeMode, setThemeMode } = useTheme();
  const { presentPaywall, isPremium, refreshPremiumStatus, restorePurchases } = useRevenueCat();
  const { isEnabled: pushEnabled, enablePushNotifications, disablePushNotifications, sendTestNotification } = usePushNotifications();
  const router = useRouter();
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [showOnboardingButton, setShowOnboardingButton] = useState(false);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const [showSimilarityModal, setShowSimilarityModal] = useState(false);
  const [gamificationNotificationsDisabled, setGamificationNotificationsDisabled] = useState(false);

  useEffect(() => {
    // Get app version from app.json via Constants
    const version = Constants.expoConfig?.version || '1.0.0';
    const buildNumber = Constants.expoConfig?.ios?.buildNumber || '0';
    setAppVersion(`${version}.${buildNumber}`);
    
    // Rotiere Tipps täglich
    const today = new Date().getDate();
    setCurrentTipIndex(today % dailyTips.length);
  }, []);

  // Prüfe Onboarding-Status und Gamification-Einstellungen jedes Mal wenn der Screen fokussiert wird
  useFocusEffect(
    useCallback(() => {
      const checkSettings = async () => {
        const { OnboardingService } = await import('@/lib/services/onboardingService');
        const isSkipped = await OnboardingService.isOnboardingSkipped();
        const isCompleted = await OnboardingService.isOnboardingCompleted();
        // Zeige Button nur wenn übersprungen UND nicht abgeschlossen
        setShowOnboardingButton(isSkipped && !isCompleted);
        
        // Lade Gamification Notifications Einstellung
        const notificationsDisabled = await gamificationSettingsService.areNotificationsDisabled();
        setGamificationNotificationsDisabled(notificationsDisabled);
      };
      
      checkSettings();
    }, [])
  );

  const handleDarkModeToggle = (value: boolean) => {
    toggleDarkMode();
    console.log(`✅ Theme toggled to: ${value ? 'dark' : 'light'} mode`);
  };



  const handleMoreTips = () => {
    // Öffne die Tipps & Tricks Seite (gleich wie der Menüpunkt)
    router.push('/tipps-und-tricks' as any);
  };

  const handlePremiumUpgrade = async () => {
    console.log('🛒 Premium Upgrade Button geklickt - isPremium:', isPremium);
    
    if (isPremium) {
      console.log('🛒 User ist bereits Premium - keine Paywall nötig');
      return;
    }
    
    try {
      console.log('🛒 Zeige RevenueCat Paywall für Profile Upgrade...');
      
      // RevenueCat Paywall anzeigen
      const result = await presentPaywall('profile_upgrade');
      console.log('🛒 Premium Upgrade Paywall result:', result.result);
      
      if (result.result === 'purchased') {
        console.log('✅ Premium erfolgreich gekauft!');
        // Premium Status wird automatisch aktualisiert durch RevenueCat Provider
      } else if (result.result === 'cancelled') {
        console.log('🛒 Premium Kauf abgebrochen');
      } else if (result.result === 'error') {
        console.log('❌ Premium Kauf Fehler');
      }
      
    } catch (error) {
      console.error('❌ Premium Upgrade Paywall error:', error);
    }
  };

  const handleShoppingCart = () => {
    console.log('Navigate to shopping list');
    router.push('/shopping-list' as any);
  };

  const handleFavoriteProducts = () => {
    router.push('/favorites' as any);
  };

  const handleCompleteOnboarding = async () => {
    try {
      // Lösche Skip-Flag und navigiere zum Onboarding
      const { OnboardingService } = await import('@/lib/services/onboardingService');
      await OnboardingService.resetOnboarding();
      setShowOnboardingButton(false);
      router.push('/onboarding');
    } catch (error) {
      console.error('Error starting onboarding:', error);
    }
  };


  const handleTieredSystemInfo = () => {
    setShowSimilarityModal(true);
  };

  const handleGamificationNotificationsToggle = async (value: boolean) => {
    try {
      await gamificationSettingsService.setNotificationsDisabled(value);
      setGamificationNotificationsDisabled(value);
      console.log(`✅ Gamification Benachrichtigungen ${value ? 'deaktiviert' : 'aktiviert'}`);
    } catch (error) {
      console.error('Error toggling gamification notifications:', error);
    }
  };

  const handleTipsAndTricks = () => {
    console.log('Navigate to tips and tricks');
    router.push('/tipps-und-tricks' as any);
  };

  const handleNews = async () => {
    try {
      await WebBrowser.openBrowserAsync('https://www.markendetektive.de/blog/', {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
        controlsColor: colors.primary,
        toolbarColor: colors.background
      });
    } catch (error) {
      // Fallback zu externem Browser
      Linking.openURL('https://www.markendetektive.de/blog/');
    }
  };

  const handleSocialMedia = () => {
    Alert.alert(
      'Social Media',
      'Folge uns auf unseren Social Media Kanälen!',
      [
        { text: '📸 Instagram', onPress: () => WebBrowser.openBrowserAsync('https://instagram.com/markendetektive') },
        { text: '👥 Facebook', onPress: () => WebBrowser.openBrowserAsync('https://facebook.com/markendetektive') },
        { text: '📺 YouTube', onPress: () => WebBrowser.openBrowserAsync('https://www.youtube.com/@markendetektive') },
        { text: '🎵 TikTok', onPress: () => WebBrowser.openBrowserAsync('https://www.tiktok.com/@markendetektive') },
        { text: 'Abbrechen', style: 'cancel' }
      ]
    );
  };

  const handleLeaderboard = () => {
    router.push('/leaderboard' as any);
  };



  const handleShareApp = () => {
    Share.share({
      message: 'Schau dir die Markendetektive App an! Spare Geld mit NoName-Produkten.',
      url: 'https://markendetektive.de'
    });
  };

  const handlePrivacyPolicy = async () => {
    try {
      await WebBrowser.openBrowserAsync('https://www.markendetektive.de/datenschutzerklaerung-haftungsausschluss/', {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
        controlsColor: colors.primary,
        toolbarColor: colors.background
      });
    } catch (error) {
      Linking.openURL('https://www.markendetektive.de/datenschutzerklaerung-haftungsausschluss/');
    }
  };

  const handleTermsOfService = async () => {
    try {
      await WebBrowser.openBrowserAsync('https://www.markendetektive.de/agb/', {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
        controlsColor: colors.primary,
        toolbarColor: colors.background
      });
    } catch (error) {
      Linking.openURL('https://www.markendetektive.de/agb/');
    }
  };

  const handleContact = async () => {
    try {
      await WebBrowser.openBrowserAsync('https://www.markendetektive.de/kontakt/', {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
        controlsColor: colors.primary,
        toolbarColor: colors.background
      });
    } catch (error) {
      Linking.openURL('https://www.markendetektive.de/kontakt/');
    }
  };

  const handleResetOnboarding = async () => {
    Alert.alert(
      'Onboarding zurücksetzen',
      'Dies wird das Onboarding zurücksetzen und beim nächsten App-Start erneut anzeigen. Fortfahren?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Zurücksetzen',
          style: 'destructive',
          onPress: async () => {
            try {
              const { OnboardingService } = await import('@/lib/services/onboardingService');
              await OnboardingService.resetOnboarding();
              Alert.alert(
                'Erfolgreich',
                'Onboarding wurde zurückgesetzt. Starten Sie die App neu, um das Onboarding zu sehen.',
                [{ text: 'OK' }]
              );
            } catch (error) {
              console.error('Error resetting onboarding:', error);
              Alert.alert('Fehler', 'Onboarding konnte nicht zurückgesetzt werden.');
            }
          }
        }
      ]
    );
  };

  // Real data from user profile
  const totalSavings = userProfile?.totalSavings || 0;
  const productCount = userProfile?.productsSaved || 0;
  const level = (userProfile as any)?.stats?.currentLevel || userProfile?.level || 1;
  const currentPoints = (userProfile as any)?.stats?.pointsTotal || (userProfile as any)?.stats?.totalPoints || 0;

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
              <TouchableOpacity onPress={() => router.push('/purchase-history' as any)}>
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
                {dailyTips[currentTipIndex]}
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
            
            <TouchableOpacity style={styles.menuItem} onPress={handleLeaderboard}>
              <IconSymbol name="trophy" size={24} color={colors.secondary} />
              <ThemedText style={[styles.menuItemText, { color: colors.text }]}>Bestenlisten</ThemedText>
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
            {/* Onboarding Button - nur wenn übersprungen */}
            {showOnboardingButton && (
              <>
                <TouchableOpacity style={styles.menuItem} onPress={handleCompleteOnboarding}>
                  <IconSymbol name="person.crop.circle.badge.plus" size={24} color={colors.primary} />
                  <ThemedText style={[styles.menuItemText, { color: colors.text }]}>Onboarding abschließen</ThemedText>
                  <IconSymbol name="chevron.right" size={14} color={colors.icon} />
                </TouchableOpacity>
                
                <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
              </>
            )}
            
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
            
            <TouchableOpacity style={styles.menuItem} onPress={() => {
              console.log('⭐ App bewerten clicked');
              // Direkt das Modal zeigen
              const handler = ratingPromptService['showRatingModal'];
              if (handler) {
                console.log('✅ Modal handler found - showing rating modal');
                handler(true);
              } else {
                console.error('❌ No modal handler found!');
                Alert.alert('Fehler', 'Bewertung konnte nicht geöffnet werden');
              }
            }}>
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
            
            <TouchableOpacity style={styles.menuItem} onPress={handleContact}>
              <IconSymbol name="envelope" size={24} color={colors.secondary} />
              <Text style={[styles.menuItemText, { color: colors.text }]}>Kontakt</Text>
              <IconSymbol name="chevron.right" size={14} color={colors.icon} />
            </TouchableOpacity>
            
            {__DEV__ && (
              <>
                <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
                <TouchableOpacity style={styles.menuItemLast} onPress={handleResetOnboarding}>
                  <IconSymbol name="arrow.clockwise" size={24} color={colors.secondary} />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Onboarding zurücksetzen (DEV)</Text>
                  <IconSymbol name="chevron.right" size={14} color={colors.icon} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* Einstellungen als separate Menu-Gruppe */}
        <View style={styles.sectionContainer}>
          <View style={[styles.menuGroup, { backgroundColor: colors.cardBackground }]}>
            {/* Dark Mode Toggle */}
            <TouchableOpacity 
              style={styles.menuItem} 
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
            
            {/* Gamification Notifications Toggle */}
            <TouchableOpacity 
              style={styles.menuItemLast} 
              onPress={() => handleGamificationNotificationsToggle(!gamificationNotificationsDisabled)}
              activeOpacity={0.7}
            >
              <IconSymbol 
                name={gamificationNotificationsDisabled ? "bell.slash" : "bell"} 
                size={24} 
                color={colors.secondary} 
              />
              <Text style={[styles.menuItemText, { color: colors.text }]}>
                Gamification Benachrichtigungen deaktivieren
              </Text>
              <Switch
                value={gamificationNotificationsDisabled}
                onValueChange={handleGamificationNotificationsToggle}
                trackColor={{ 
                  false: colors.border, 
                  true: colors.secondary 
                }}
                thumbColor={gamificationNotificationsDisabled ? colors.cardBackground : colors.secondary}
                ios_backgroundColor={colors.border}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Version + Debug */}
        <View style={styles.versionContainer}>
          <ThemedText style={[styles.versionText, { color: colors.icon }]}>
            Version [{appVersion}]
          </ThemedText>
          
          {/* 🔧 DEBUG: UMP Consent testen (nur für Entwickler sichtbar) */}
          {__DEV__ && (
            <View style={{ marginTop: 8, gap: 8 }}>
              <TouchableOpacity
                style={{ padding: 8, backgroundColor: colors.error, borderRadius: 8 }}
                onPress={async () => {
                  try {
                    console.log('🔧 Force showing consent form...');
                    const { consentService } = await import('@/lib/services/consentService');
                    await consentService.forceShowConsentForm();
                  } catch (error) {
                    console.error('❌ Error showing consent form:', error);
                    Alert.alert('Fehler', 'Consent Form konnte nicht angezeigt werden: ' + error.message);
                  }
                }}
              >
                <ThemedText style={{ color: 'white', fontSize: 12, textAlign: 'center' }}>
                  🔧 TEST: Consent Form anzeigen
                </ThemedText>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={{ padding: 8, backgroundColor: colors.secondary, borderRadius: 8 }}
                onPress={async () => {
                  try {
                    console.log('🔄 Resetting consent...');
                    const { consentService } = await import('@/lib/services/consentService');
                    await consentService.resetConsent();
                    Alert.alert(
                      'Consent zurückgesetzt',
                      'Die Consent-Einstellungen wurden zurückgesetzt. Beim nächsten App-Start wird das Consent-Formular erneut angezeigt.',
                      [{ text: 'OK' }]
                    );
                  } catch (error) {
                    console.error('❌ Error resetting consent:', error);
                    Alert.alert('Fehler', 'Consent konnte nicht zurückgesetzt werden: ' + error.message);
                  }
                }}
              >
                <ThemedText style={{ color: 'white', fontSize: 12, textAlign: 'center' }}>
                  🗑️ Consent zurücksetzen
                </ThemedText>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={{ padding: 8, backgroundColor: colors.primary, borderRadius: 8 }}
                onPress={async () => {
                  try {
                    console.log('📊 Getting consent status...');
                    const { consentService } = await import('@/lib/services/consentService');
                    
                    // Initialisiere falls noch nicht geschehen
                    await consentService.initialize();
                    
                    const detailedStatus = await consentService.getDetailedStatus();
                    
                    console.log('📊 Detailed Consent Status:', detailedStatus);
                    
                    Alert.alert(
                      'Consent Status Details',
                      `🔹 Platform: ${Platform.OS}\n` +
                      `🔹 Status: ${detailedStatus.status}\n` +
                      `🔹 Is Initialized: ${detailedStatus.isInitialized ? '✅' : '❌'}\n\n` +
                      
                      `📱 SDK Info:\n` +
                      `🔹 Can Show Ads: ${detailedStatus.canShowAds ? '✅' : '❌'}\n` +
                      `🔹 Can Show Personalized: ${detailedStatus.canShowPersonalizedAds ? '✅' : '❌'}\n` +
                      `🔹 Privacy Options Required: ${detailedStatus.privacyOptionsRequirementStatus || 'N/A'}\n` +
                      `🔹 Can Request Ads: ${detailedStatus.canRequestAds !== undefined ? (detailedStatus.canRequestAds ? '✅' : '❌') : 'N/A'}\n\n` +
                      
                      `💾 Stored Info:\n` +
                      `🔹 Has Saved Status: ${detailedStatus.hasSavedStatus ? '✅' : '❌'}\n` +
                      `🔹 Saved Status: ${detailedStatus.savedStatus || 'None'}\n` +
                      `🔹 Raw Consent Info: ${detailedStatus.rawConsentInfo ? 'Available' : 'None'}\n\n` +
                      
                      `🎯 Request Options:\n` +
                      `🔹 Non-Personalized Only: ${detailedStatus.adRequestOptions?.requestNonPersonalizedAdsOnly ? '✅' : '❌'}`,
                      [{ text: 'OK' }]
                    );
                  } catch (error) {
                    console.error('❌ Error getting consent status:', error);
                    Alert.alert('Fehler', 'Status konnte nicht abgerufen werden: ' + error.message);
                  }
                }}
              >
                <ThemedText style={{ color: 'white', fontSize: 12, textAlign: 'center' }}>
                  📊 Consent Status anzeigen
                </ThemedText>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ padding: 8, backgroundColor: colors.warning, borderRadius: 8 }}
                onPress={async () => {
                  try {
                    console.log('🔓 Resetting temporary category unlocks via debug button...');
                    await categoryAccessService.resetAllTemporaryUnlocks();
                    Alert.alert(
                      'Freischaltungen zurückgesetzt',
                      'Alle temporär freigeschalteten Kategorien wurden entfernt.',
                      [{ text: 'OK' }]
                    );
                  } catch (error: any) {
                    console.error('❌ Error resetting temporary unlocks:', error);
                    Alert.alert('Fehler', `Kategorien konnten nicht zurückgesetzt werden: ${error.message || error}`);
                  }
                }}
              >
                <ThemedText style={{ color: 'white', fontSize: 12, textAlign: 'center' }}>
                  🔄 Temporäre Kategorie-Freischaltungen löschen
                </ThemedText>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Similarity Stages Modal */}
      <SimilarityStagesModal
        visible={showSimilarityModal}
        onClose={() => setShowSimilarityModal(false)}
      />
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
    marginBottom: 12, // Konsistenter Abstand zwischen Cards
  },
  // Neue Savings Card Styles - ACHIEVEMENTS STIL
  levelBadgeContainer: {
    marginHorizontal: 16,
    marginBottom: 12, // Reduziert von 16 auf 12
  },
  savingsCardContainer: {
    marginHorizontal: 16,
    marginBottom: 12, // Reduziert von 25 auf 12
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
    color: Colors.light.primary,
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
    marginTop: 12, // Konsistenter Abstand zwischen Sektionen (reduziert von 25 auf 12)
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '500',
    fontFamily: 'Nunito_500Medium',
    marginLeft: 24,
    marginBottom: 14, // 20% mehr (12 × 1.2 = 14.4 ≈ 14)
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
    marginBottom: 115,
  },
  versionText: {
    fontSize: 16,
    fontWeight: '400',
    fontFamily: 'Nunito_400Regular',
  },
});