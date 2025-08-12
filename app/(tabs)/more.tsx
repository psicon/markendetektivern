import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { router } from 'expo-router';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';

export default function MoreScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user, logout } = useAuth();

  const handleLogout = () => {
    Alert.alert(
      'Abmelden',
      'Möchtest du dich wirklich abmelden?',
      [
        { text: 'Abbrechen', style: 'cancel' },
        { 
          text: 'Abmelden', 
          style: 'destructive',
          onPress: async () => {
            try {
              await logout();
              router.replace('/auth/welcome');
            } catch (error) {
              console.error('Logout error:', error);
              Alert.alert('Fehler', 'Abmeldung fehlgeschlagen.');
            }
          }
        }
      ]
    );
  };

  const handleMenuItemPress = (item: any) => {
    // If user is not logged in and tries to access profile, redirect to login
    if (!user && item.title === 'Profil') {
      router.push('/auth/welcome');
      return;
    }

    // Handle other menu items
    if (item.title === 'Level & Errungenschaften') {
      router.push('/achievements');
    } else if (item.title === 'Einkaufszettel') {
      router.push('/shopping-list');
    }
    // Add more navigation cases as needed
  };

  const menuItems = [
    { icon: 'person.circle', title: 'Profil', subtitle: user ? 'Dein Profil verwalten' : 'Anmelden erforderlich' },
    { icon: 'shopping.cart', title: 'Einkaufszettel', subtitle: 'Deine Listen verwalten' },
    { icon: 'heart.fill', title: 'Gespeicherte Produkte', subtitle: 'Deine Favoriten' },
    { icon: 'star.fill', title: 'Level & Errungenschaften', subtitle: 'Dein Fortschritt' },
    { icon: 'barcode', title: 'Such- & Scanverlauf', subtitle: 'Letzte Suchen' },
  ];

  return (
    <ThemedView style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.primary }]}>
        <ThemedText style={styles.headerTitle}>Mehr</ThemedText>
      </View>

      {/* Profile Card */}
      <View style={[styles.profileCard, { backgroundColor: colors.cardBackground }]}>
        <View style={styles.profileInfo}>
          <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
            <ThemedText style={styles.avatarText}>
              {user?.displayName ? user.displayName.charAt(0).toUpperCase() : '?'}
            </ThemedText>
          </View>
          <View style={styles.profileText}>
            <ThemedText style={styles.profileName}>
              {user?.displayName || 'Nicht angemeldet'}
            </ThemedText>
            <ThemedText style={styles.profileEmail}>
              {user?.email || 'Melde dich an, um alle Features zu nutzen'}
            </ThemedText>
          </View>
        </View>

        {/* Level Info */}
        <View style={[styles.levelCard, { backgroundColor: colors.warning + '20' }]}>
          <View style={styles.levelInfo}>
            <View style={[styles.levelIcon, { backgroundColor: colors.warning }]}>
              <IconSymbol name="star.fill" size={20} color="white" />
            </View>
            <View>
              <ThemedText style={styles.levelTitle}>Level 1 Sparanfänger</ThemedText>
              <ThemedText style={styles.levelSubtitle}>Der erste Schritt zu mehr Ersparnis</ThemedText>
            </View>
          </View>
        </View>

        {/* Savings Summary */}
        <View style={[styles.savingsCard, { backgroundColor: colors.warning }]}>
          <ThemedText style={styles.savingsTitle}>Deine Gesamtersparnis</ThemedText>
          <ThemedText style={styles.savingsAmount}>238,78 €</ThemedText>
          <View style={styles.savingsTag}>
            <ThemedText style={styles.savingsTagText}># 23 gekaufte Produkte</ThemedText>
          </View>
        </View>
      </View>

      {/* Menu Items */}
      <View style={styles.menuSection}>
        {menuItems.map((item, index) => (
                      <TouchableOpacity
            key={index}
            style={[styles.menuItem, { borderBottomColor: colors.border }]}
            onPress={() => handleMenuItemPress(item)}
          >
            <IconSymbol name={item.icon} size={24} color={colors.primary} />
            <View style={styles.menuItemText}>
              <ThemedText style={styles.menuItemTitle}>{item.title}</ThemedText>
              <ThemedText style={styles.menuItemSubtitle}>{item.subtitle}</ThemedText>
            </View>
            <IconSymbol name="chevron.right" size={20} color={colors.icon} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Dark Mode Toggle */}
      <View style={[styles.darkModeSection, { borderTopColor: colors.border }]}>
        <View style={styles.darkModeItem}>
          <IconSymbol name="star.fill" size={24} color={colors.primary} />
          <ThemedText style={styles.darkModeText}>Light- / Dark-Mode</ThemedText>
          <View style={[styles.toggle, { backgroundColor: colors.primary }]}>
            <View style={styles.toggleButton} />
          </View>
        </View>
      </View>

      {/* Sign Out - only show if user is logged in */}
      {user && (
        <TouchableOpacity style={styles.signOutButton} onPress={handleLogout}>
          <ThemedText style={[styles.signOutText, { color: colors.error }]}>Abmelden</ThemedText>
        </TouchableOpacity>
      )}

      {/* Sign In - only show if user is not logged in */}
      {!user && (
        <TouchableOpacity 
          style={[styles.signOutButton, { backgroundColor: colors.primary }]} 
          onPress={() => router.push('/auth/welcome')}
        >
          <ThemedText style={[styles.signOutText, { color: 'white' }]}>Anmelden</ThemedText>
        </TouchableOpacity>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
  },
  profileCard: {
    margin: 20,
    padding: 20,
    borderRadius: 16,
    gap: 16,
  },
  profileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  profileText: {
    flex: 1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  profileEmail: {
    fontSize: 14,
    opacity: 0.7,
  },
  levelCard: {
    padding: 16,
    borderRadius: 12,
  },
  levelInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  levelIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  levelTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  levelSubtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
  savingsCard: {
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
  },
  savingsTitle: {
    fontSize: 16,
    color: 'white',
    marginBottom: 8,
  },
  savingsAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 12,
  },
  savingsTag: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  savingsTagText: {
    fontSize: 14,
    color: 'white',
    fontWeight: '500',
  },
  menuSection: {
    margin: 20,
    marginTop: 0,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    gap: 16,
  },
  menuItemText: {
    flex: 1,
  },
  menuItemTitle: {
    fontSize: 16,
    fontWeight: '500',
  },
  menuItemSubtitle: {
    fontSize: 14,
    opacity: 0.7,
  },
  darkModeSection: {
    marginHorizontal: 20,
    paddingTop: 20,
    borderTopWidth: 1,
  },
  darkModeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  darkModeText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  toggle: {
    width: 60,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: 2,
  },
  toggleButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'white',
  },
  signOutButton: {
    marginHorizontal: 20,
    marginTop: 30,
    alignItems: 'center',
    paddingVertical: 16,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '500',
  },
});