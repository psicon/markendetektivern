
import { AuthRequiredModal } from '@/components/ui/AuthRequiredModal';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { LevelBadge } from '@/components/ui/LevelBadge';
import { Colors } from '@/constants/Colors';
import { getNavigationHeaderOptions } from '@/constants/HeaderConfig';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation, useRouter } from 'expo-router';
import React, { useLayoutEffect, useState } from 'react';
import {
    Alert,
    Image,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { user, userProfile, logout, refreshUserProfile, isAnonymous } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);


  // Helper function to get country flag emoji (copied from explore.tsx)
  const getCountryFlag = (country: string): string => {
    const flagMap: {[key: string]: string} = {
      'Deutschland': '🇩🇪',
      'DE': '🇩🇪',
      'Schweiz': '🇨🇭',
      'CH': '🇨🇭',
      'Österreich': '🇦🇹',
      'AT': '🇦🇹',
      'Austria': '🇦🇹',
      'Switzerland': '🇨🇭',
      'Germany': '🇩🇪',
    };
    
    return flagMap[country] || '🏳️';
  };
  
  // Configure header with standard options
  useLayoutEffect(() => {
    navigation.setOptions({
      ...getNavigationHeaderOptions(colorScheme, 'Profil'),
      headerRight: () => (
        <TouchableOpacity
          onPress={() => {
            if (isAnonymous) {
              setShowAuthModal(true);
            } else {
              router.push('/edit-profile' as any);
            }
          }}
          style={{ paddingRight: 16 }}
        >
          <IconSymbol name="square.and.pencil" size={20} color="white" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, colorScheme, router, isAnonymous, setShowAuthModal]);

  // Note: Profile refresh happens automatically via AuthContext when data changes
  // Manual refresh is called after profile edits in edit-profile.tsx

  // Get user data
  const displayName = userProfile?.display_name || user?.displayName || 'Benutzer';
  const realName = userProfile?.real_name || '';
  const email = userProfile?.email || user?.email || '';
  const photoUrl = userProfile?.photo_url || user?.photoURL || null;
  const totalSavings = userProfile?.totalSavings || 238.78;
  const productsSaved = userProfile?.productsSaved || 23;
  // Level kommt jetzt aus stats.currentLevel (korrekte Berechnung)
  const level = (userProfile as any)?.stats?.currentLevel || userProfile?.level || 1;
  const favoriteMarket = userProfile?.favoriteMarketName || '';
  const favoriteMarketId = userProfile?.favoriteMarket || '';
  
  // Get favorite market display with emoji (if available)
  const getFavoriteMarketDisplay = () => {
    if (!favoriteMarket) return '';
    
    // The favoriteMarketName only contains the market name
    // We need to get the country from a lookup or pattern matching
    const marketName = favoriteMarket;
    let country = 'Deutschland'; // Default
    
    // Simple pattern matching based on common market names
    if (marketName.toLowerCase().includes('spar') || marketName.toLowerCase().includes('billa')) {
      country = 'Österreich';
    } else if (marketName.toLowerCase().includes('migros') || marketName.toLowerCase().includes('coop')) {
      country = 'Schweiz';
    }
    
    return `${getCountryFlag(country)} ${marketName}`;
  };
  
  // Get stats for level progress
  const currentPoints = (userProfile as any)?.stats?.totalPoints || 0;
  const currentSavings = userProfile?.totalSavings || 0;

  const handleLogout = () => {
    if (isAnonymous) {
      // Für anonyme User: Zeige Auth Modal für Registrierung
      setShowAuthModal(true);
    } else {
      // Für registrierte User: Normaler Logout
      Alert.alert(
        'Abmelden',
        'Möchtest du dich wirklich abmelden?',
        [
          {
            text: 'Abbrechen',
            style: 'cancel'
          },
          {
            text: 'Abmelden',
            style: 'destructive',
            onPress: async () => {
              try {
                await logout();
                // Navigation wird automatisch durch AuthContext/Tab Layout gehandelt
                // Kein manueller Navigation-Call nötig
              } catch (error) {
                Alert.alert('Fehler', 'Beim Abmelden ist ein Fehler aufgetreten.');
              }
            }
          }
        ]
      );
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Account löschen',
      'Bist du sicher, dass du deinen Account dauerhaft löschen möchtest? Diese Aktion kann nicht rückgängig gemacht werden.',
      [
        {
          text: 'Abbrechen',
          style: 'cancel'
        },
        {
          text: 'Account löschen',
          style: 'destructive',
          onPress: () => {
            // TODO: Implement account deletion
            Alert.alert('Info', 'Account-Löschung wird in Kürze implementiert.');
          }
        }
      ]
    );
  };

  const MenuItem = ({ 
    icon, 
    title, 
    onPress, 
    showArrow = true, 
    isFirst = false, 
    isLast = false,
    rightElement,
    iconColor
  }: any) => (
    <TouchableOpacity 
      style={[
        styles.menuItem,
        { backgroundColor: colors.cardBackground },
        isFirst && styles.menuItemFirst,
        isLast && styles.menuItemLast,
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.menuItemContent}>
        <IconSymbol 
          name={icon} 
          size={24} 
          color={iconColor || colors.primary} 
        />
        <Text style={[styles.menuText, { color: colors.text }]}>
          {title}
        </Text>
        {rightElement}
        {showArrow && !rightElement && (
          <IconSymbol 
            name="chevron.right" 
            size={14} 
            color={colors.icon} 
          />
        )}
      </View>
      {!isLast && <View style={[styles.separator, { backgroundColor: colors.border }]} />}
    </TouchableOpacity>
  );

  // Für anonyme User: Zeige spezielle Ansicht
  if (isAnonymous) {
    return (
      <>
        <ScrollView 
          style={[styles.container, { backgroundColor: colors.background }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Anonymous User Info */}
          <View style={styles.userSection}>
            <View style={styles.userInfo}>
              <View style={[styles.avatar, { borderColor: colors.primary }]}>
                <IconSymbol name="person.crop.circle.badge.questionmark" size={56} color={colors.primary} />
              </View>
              <View style={styles.userDetails}>
                <Text style={[styles.userName, { color: colors.text }]}>
                  Anonymer Nutzer
                </Text>
                <Text style={[styles.userEmail, { color: colors.icon }]}>
                  Nicht alle Features verfügbar
                </Text>
              </View>
            </View>
          </View>

          {/* Subtle Registration CTA - Focus on data security */}
          <TouchableOpacity 
            style={[styles.upgradeCard, { borderColor: colors.primary, backgroundColor: colors.cardBackground }]}
            onPress={() => router.push('/auth/register?from=app')}
            activeOpacity={0.8}
          >
            <View style={styles.upgradeContent}>
              <IconSymbol name="icloud.and.arrow.up" size={24} color={colors.primary} />
              <View style={styles.upgradeText}>
                <Text style={[styles.upgradeTitle, { color: colors.text }]}>
                  Daten sichern & synchronisieren
                </Text>
                <Text style={[styles.upgradeSubtitle, { color: colors.icon }]}>
                  Account erstellen für Backup & geräteübergreifenden Sync
                </Text>
              </View>
              <IconSymbol name="chevron.right" size={16} color={colors.icon} />
            </View>
          </TouchableOpacity>

          {/* Level Card - Same as registered users */}
          <TouchableOpacity 
            style={styles.levelCard}
            onPress={() => router.push('/achievements')}
            activeOpacity={0.8}
          >
            <LevelBadge 
              level={level}
              size="large"
              showDescription={true}
            />
          </TouchableOpacity>

          {/* Savings Card - Same as registered users */}
          <View style={styles.savingsCard}>
            <LinearGradient
              colors={['#FF9800', '#FF5722']}
              start={{ x: 1, y: 0 }}
              end={{ x: 0, y: 0 }}
              style={styles.savingsGradient}
            >
              <View style={styles.savingsContent}>
                <TouchableOpacity onPress={() => router.push('/achievements' as any)}>
                  <Text style={styles.savingsLabel}>Deine Gesamtersparnis</Text>
                  <Text style={styles.savingsAmount}>€ {totalSavings.toFixed(2)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.productsBadge} onPress={() => router.push('/purchase-history' as any)}>
                  <IconSymbol name="number" size={14} color={colors.warning} />
                  <Text style={styles.productsText}>{productsSaved} gekaufte Produkte</Text>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </View>

          {/* Menu Section 1 - Same as registered users */}
          <View style={styles.menuSection}>
            <MenuItem
              icon="trophy"
              title="Levelübersicht & Fortschritt"
              onPress={() => router.push('/achievements')}
              isFirst={true}
              isLast={true}
            />
          </View>

          {/* Menu Section 2 - Almost same but no Lieblingsmarkt */}
          <View style={styles.menuSection}>
            <MenuItem
              icon="cart"
              title="Einkaufszettel"
              onPress={() => router.push('/shopping-list')}
              isFirst={true}
            />
            <MenuItem
              icon="heart"
              title="Deine Lieblingsprodukte"
              onPress={() => router.push('/favorites' as any)}
            />
            <MenuItem
              icon="clock.badge.checkmark"
              title="Kaufhistorie"
              onPress={() => router.push('/purchase-history' as any)}
            />
            <MenuItem
              icon="clock"
              title="Such- & Scanverlauf"
              onPress={() => router.push('/history' as any)}
              isLast={true}
            />
          </View>

          {/* Login Button */}
          <TouchableOpacity 
            style={[styles.logoutButton, { backgroundColor: colors.cardBackground }]}
            onPress={() => router.push('/auth/login')}
          >
            <Text style={[styles.logoutText, { color: colors.primary }]}>
              Mit bestehendem Account anmelden
            </Text>
          </TouchableOpacity>

          <View style={{ height: 50 }} />
        </ScrollView>

        {/* Auth Required Modal */}
        <AuthRequiredModal
          visible={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          feature="Profil bearbeiten"
          message="Erstelle einen Account um dein Profil vollständig zu bearbeiten und alle Features zu nutzen."
        />
      </>
    );
  }

  // Normale Ansicht für registrierte User
  return (
    <ScrollView 
      style={[styles.container, { backgroundColor: colors.background }]}
      showsVerticalScrollIndicator={false}
    >
      {/* User Info Section */}
      <View style={styles.userSection}>
        <View style={styles.userInfo}>
          <View style={[styles.avatar, { borderColor: colors.primary }]}>
            {photoUrl ? (
              <Image source={{ uri: photoUrl }} style={styles.avatarImage} />
            ) : (
              <IconSymbol name="person.circle.fill" size={56} color={colors.primary} />
            )}
          </View>
          <View style={styles.userDetails}>
            <Text style={[styles.userName, { color: colors.text }]}>
              {displayName}
            </Text>
            {realName && (
              <Text style={[styles.userRealName, { color: colors.icon }]}>
                {realName}
              </Text>
            )}
            <Text style={[styles.userEmail, { color: colors.icon }]}>
              {email}
            </Text>
            {favoriteMarket && (
              <View style={styles.favoriteMarketContainer}>
                <IconSymbol name="storefront" size={16} color={colors.primary} />
                <Text style={[styles.favoriteMarketText, { color: colors.primary }]}>
                  {getFavoriteMarketDisplay()}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Premium Banner (if not premium) */}
      {!userProfile?.isPremium && (
        <TouchableOpacity 
          style={[styles.premiumBanner, { borderColor: colors.primary }]}
          onPress={() => router.push('/premium' as any)}
        >
          <LinearGradient
            colors={[colors.primary, colors.secondary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.premiumGradient}
          >
            <IconSymbol name="star.fill" size={24} color="white" />
            <Text style={styles.premiumText}>Jetzt alles sofort freischalten</Text>
            <IconSymbol name="sparkles" size={24} color="#FFD700" />
          </LinearGradient>
        </TouchableOpacity>
      )}

      {/* Level Card */}
      <TouchableOpacity 
        style={styles.levelCard}
        onPress={() => router.push('/achievements')}
        activeOpacity={0.8}
      >
        <LevelBadge 
          level={level}
          size="large"
          showDescription={true}
        />
      </TouchableOpacity>

      {/* Savings Card - ACHIEVEMENTS STIL */}
      <View style={styles.savingsCard}>
        <LinearGradient
          colors={['#FF9800', '#FF5722']}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 0 }}
          style={styles.savingsGradient}
        >
          <View style={styles.savingsContent}>
            <TouchableOpacity onPress={() => router.push('/achievements' as any)}>
              <Text style={styles.savingsLabel}>Deine Gesamtersparnis</Text>
              <Text style={styles.savingsAmount}>€ {totalSavings.toFixed(2)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.productsBadge} onPress={() => router.push('/purchase-history' as any)}>
              <IconSymbol name="number" size={14} color={colors.warning} />
              <Text style={styles.productsText}>{productsSaved} gekaufte Produkte</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </View>

      {/* Menu Section 1 */}
      <View style={styles.menuSection}>
        <MenuItem
          icon="trophy"
          title="Levelübersicht & Fortschritt"
          onPress={() => router.push('/achievements')}
          isFirst={true}
          isLast={true}
        />
      </View>

      {/* Menu Section 2 */}
      <View style={styles.menuSection}>
        <MenuItem
          icon="cart"
          title="Einkaufszettel"
          onPress={() => router.push('/shopping-list')}
          isFirst={true}
        />
        <MenuItem
          icon="heart"
          title="Deine Lieblingsprodukte"
          onPress={() => router.push('/favorites' as any)}
        />
        <MenuItem
          icon="clock.badge.checkmark"
          title="Kaufhistorie"
          onPress={() => router.push('/purchase-history' as any)}
        />
        <MenuItem
          icon="clock"
          title="Such- & Scanverlauf"
          onPress={() => router.push('/history' as any)}
          isLast={true}
        />
      </View>



      {/* Logout Button */}
      <TouchableOpacity 
        style={[styles.logoutButton, { backgroundColor: colors.cardBackground }]}
        onPress={handleLogout}
      >
        <Text style={[styles.logoutText, { color: colors.error }]}>
          Abmelden
        </Text>
      </TouchableOpacity>

      {/* Delete Account Link */}
      <TouchableOpacity 
        style={styles.deleteAccountButton}
        onPress={handleDeleteAccount}
      >
        <Text style={[styles.deleteAccountText, { color: colors.icon }]}>
          Account löschen
        </Text>
      </TouchableOpacity>

      <View style={{ height: 50 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  userSection: {
    padding: 16,
    marginBottom: 8,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarImage: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 24,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 1,
  },
  userRealName: {
    fontSize: 16,
    fontFamily: 'Nunito_500Medium',
   },
  userEmail: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
  },
  favoriteMarketContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 6,
  },
  favoriteMarketText: {
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  premiumBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 2,
    overflow: 'hidden',
  },
  premiumGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  premiumText: {
    color: 'white',
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    flex: 1,
    marginHorizontal: 12,
  },
  levelCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  levelGradient: {
    padding: 12,
  },
  levelContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  levelIcon: {
    width: 61,
    height: 61,
    borderRadius: 30.5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 2,
    borderColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  levelInfo: {
    flex: 1,
  },
  levelTitle: {
    color: 'white',
    fontSize: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  levelName: {
    color: 'white',
    fontSize: 23,
    fontFamily: 'Nunito_600SemiBold',
  },
  levelDescription: {
    color: 'white',
    fontSize: 12,
    fontFamily: 'Nunito_300Light',
  },
  infoButton: {
    padding: 8,
  },
  savingsCard: {
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
  savingsGradient: {
    padding: 10,
    borderRadius: 16,
    overflow: 'hidden',
  },
  savingsContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  savingsLabel: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
    lineHeight: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  savingsAmount: {
    color: 'white',
    fontSize: 23,
    fontWeight: '600',
    lineHeight: 26,
    fontFamily: 'Nunito_600SemiBold',
  },
  productsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    gap: 2,
  },
  productsText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF9800',
    lineHeight: 14,
    fontFamily: 'Nunito_600SemiBold',
  },
  menuSection: {
    marginHorizontal: 16,
    marginBottom: 20,
  },
  menuItem: {
    minHeight: 50,
  },
  menuItemFirst: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  menuItemLast: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
  },
  menuItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  menuIcon: {
    // Gap wird durch das gap-Property im parent gehandhabt
  },
  menuText: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Nunito_400Regular',
  },
  separator: {
    height: 1,
    marginLeft: 52,
  },
  logoutButton: {
    marginHorizontal: 16,
    marginBottom: 20,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  deleteAccountButton: {
    alignItems: 'center',
    marginBottom: 30,
  },
  deleteAccountText: {
    fontSize: 12,
    fontFamily: 'Nunito_400Regular',
    textDecorationLine: 'underline',
  },
  
  // Anonymous User Styles
  registrationCTA: {
    padding: 20,
    alignItems: 'center',
  },
  registrationTitle: {
    fontSize: 20,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    marginTop: 12,
    marginBottom: 8,
    textAlign: 'center',
  },
  registrationSubtitle: {
    fontSize: 15,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.9)',
    marginBottom: 16,
    textAlign: 'center',
  },
  featureList: {
    marginBottom: 20,
  },
  featureItem: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    color: 'white',
    marginVertical: 4,
  },
  registrationButton: {
    backgroundColor: 'white',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 8,
  },
  registrationButtonText: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: '#3498db',
  },
  
  // Neue Styles für subtile upgrade CTA
  upgradeCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  upgradeContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  upgradeText: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  upgradeTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 2,
  },
  upgradeSubtitle: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
  },
});
