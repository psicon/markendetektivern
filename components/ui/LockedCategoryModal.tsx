import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useRevenueCat } from '@/lib/contexts/RevenueCatProvider';
import { db } from '@/lib/firebase';
import { categoryAccessService } from '@/lib/services/categoryAccessService';
import { rewardedAdService, RewardedAdError } from '@/lib/services/rewardedAdService';
import { showInfoToast } from '@/lib/services/ui/toast';
import { LinearGradient } from 'expo-linear-gradient';
import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
import LottieView from 'lottie-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  InteractionManager,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AndroidSafeModal } from './AndroidSafeModal';
import { IconSymbol } from './IconSymbol';
import { ImageWithShimmer } from './ImageWithShimmer';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface LockedCategoryModalProps {
  visible: boolean;
  categoryId?: string;
  categoryName: string;
  categoryImage?: string;
  requiredLevel: number;
  currentLevel: number;
  onClose: () => void;
  onNavigateToLevels: () => void;
  onUnlockSuccess?: () => void; // Callback nach erfolgreicher Freischaltung
}

export const LockedCategoryModal: React.FC<LockedCategoryModalProps> = ({
  visible,
  categoryId,
  categoryName,
  categoryImage,
  requiredLevel,
  currentLevel,
  onClose,
  onNavigateToLevels,
  onUnlockSuccess,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { presentPaywall, isPremium } = useRevenueCat();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [isLoadingAd, setIsLoadingAd] = useState(false);
  const [adFailureCount, setAdFailureCount] = useState(0);
  const [showAdUnavailableModal, setShowAdUnavailableModal] = useState(false);
  const [isConsentRetrying, setIsConsentRetrying] = useState(false);
  
  const levelsToGo = requiredLevel - currentLevel;

  const handleCategoryUnlocked = useCallback(async (unlockedCategoryId?: string) => {
    const targetId = unlockedCategoryId || categoryId;
    if (!targetId) {
      return;
    }
    
    console.log('🔓 Unlock category via rewarded ad:', targetId);
    await categoryAccessService.unlockCategoryTemporarily(targetId);
    
    if (user?.uid) {
      try {
        const expiresAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
        await addDoc(collection(db, 'users', user.uid, 'ledger'), {
          action: 'unlock_category_rewarded',
          category_id: targetId,
          category_name: categoryName,
          source: 'rewarded_ad',
          unlocked_at: serverTimestamp(),
          expires_at: expiresAt
        });
      } catch (trackingError) {
        console.error('❌ Fehler beim Ledger-Tracking der Kategorie-Freischaltung:', trackingError);
      }
    }
    
    showInfoToast('🎉 Kategorie freigeschaltet! Du hast nun 24 Stunden Zugang zu dieser Kategorie.', 'success');
    setAdFailureCount(0);
    setShowAdUnavailableModal(false);
    
    onClose();
    
    if (onUnlockSuccess) {
      if (Platform.OS === 'android') {
        InteractionManager.runAfterInteractions(() => {
          console.log('🔄 Refreshing categories after unlock...');
          onUnlockSuccess();
        });
      } else {
        setTimeout(() => {
          console.log('🔄 Refreshing categories after unlock...');
          onUnlockSuccess();
        }, 100);
      }
    }
  }, [categoryId, categoryName, onClose, onUnlockSuccess, user?.uid]);

  const runRewardedUnlock = useCallback(async () => {
    if (!categoryId || isLoadingAd) {
      return;
    }
    setIsLoadingAd(true);
    try {
      await rewardedAdService.showForCategory(
        categoryId,
        async (rewardedCategoryId) => {
          try {
            await handleCategoryUnlocked(rewardedCategoryId);
          } finally {
            setIsLoadingAd(false);
            setShowAdUnavailableModal(false);
            setAdFailureCount(0);
          }
        },
        (error) => {
          console.error('❌ Rewarded Ad error:', error);
          setIsLoadingAd(false);
          const typedError = error as RewardedAdError;
          setAdFailureCount((prev) => {
            const next = prev + 1;
            const shouldShowFallback = typedError instanceof RewardedAdError
              ? typedError.code === 'NO_FILL' || typedError.code === 'CONSENT_REQUIRED' || next >= 2
              : next >= 2;
            
            if (shouldShowFallback) {
              setShowAdUnavailableModal(true);
            } else {
              Alert.alert(
                'Werbung nicht verfügbar',
                error.message,
                [{ text: 'OK' }]
              );
            }
            
            return next;
          });
        }
      );
    } catch (error: any) {
      console.error('❌ Error showing rewarded ad:', error);
      setIsLoadingAd(false);
      Alert.alert('Fehler', error?.message || 'Die Werbung konnte nicht angezeigt werden. Bitte versuche es später erneut.');
    }
  }, [categoryId, handleCategoryUnlocked, isLoadingAd]);

  const handleConsentRetry = useCallback(async () => {
    try {
      setIsConsentRetrying(true);
      const module = await import('@/lib/services/consentService');
      await module.consentService.forceShowConsentForm();
      setAdFailureCount(0);
      setShowAdUnavailableModal(false);
      await runRewardedUnlock();
    } catch (error: any) {
      console.error('❌ Consent retry failed:', error);
      Alert.alert('Fehler', `Consent konnte nicht geöffnet werden: ${error?.message || 'Unbekannter Fehler'}`);
    } finally {
      setIsConsentRetrying(false);
    }
  }, [runRewardedUnlock]);

  // Preload Ad wenn Modal geöffnet wird
  useEffect(() => {
    if (visible && categoryId) {
      rewardedAdService.preload();
    }
  }, [visible, categoryId]);

  useEffect(() => {
    if (!visible) {
      setShowAdUnavailableModal(false);
      setAdFailureCount(0);
      setIsLoadingAd(false);
    }
  }, [visible]);
  
  // Shimmer Animation für Premium-Button
  const shimmerAnimatedValue = useRef(new Animated.Value(0)).current;
  
  useEffect(() => {
    const shimmerAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnimatedValue, {
          toValue: 1,
          duration: 2100,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnimatedValue, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    
    shimmerAnimation.start();
    
    return () => shimmerAnimation.stop();
  }, [shimmerAnimatedValue]);
  
  const shimmerTranslateX = shimmerAnimatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-100, 400], // Shimmer bewegt sich über den Button
  });
  
  // Use AndroidSafeModal to fix Android touch issues after modal close
  const ModalComponent = Platform.OS === 'android' ? AndroidSafeModal : Modal;
  
  // Wenn Modal nicht sichtbar ist, nichts rendern (verhindert Layer die Touch-Ereignisse blockieren)
  if (!visible) {
    return null;
  }
  
  return (
    <>
    <ModalComponent
      visible={visible}
      transparent={Platform.OS === 'ios'}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      type={Platform.OS === 'android' ? 'fullscreen' : undefined}
    >
      <View style={[
        styles.container,
        Platform.OS === 'android' && { paddingBottom: insets.bottom }
      ]}>
        <TouchableOpacity 
          style={styles.backdrop} 
          activeOpacity={1}
          onPress={onClose}
        />
        
        <Animated.View style={[
          styles.contentCard,
          { backgroundColor: colors.cardBackground }
        ]}>
          {/* Close Button */}
          <TouchableOpacity 
            style={styles.closeButton}
            onPress={onClose}
          >
            <IconSymbol name="xmark" size={20} color={colors.icon} />
          </TouchableOpacity>
          
          {/* Lock Animation */}
          <View pointerEvents="none" style={styles.lockContainer}>
            <LottieView
              source={require('@/assets/lottie/lock.json')}
              autoPlay
              loop={false}
              style={styles.lockAnimation}
            />
          </View>
          
          {/* Category Info */}
          <View style={styles.categoryInfoContainer}>
            {categoryImage ? (
              <ImageWithShimmer
                source={{ uri: categoryImage }}
                style={styles.categoryImage}
                fallbackIcon="square.grid.2x2"
                fallbackIconSize={40}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.categoryImagePlaceholder, { backgroundColor: colors.border }]}>
                <IconSymbol name="square.grid.2x2" size={40} color={colors.icon} />
              </View>
            )}
            
            <Text style={[styles.categoryName, { color: colors.text }]}>
              {categoryName}
            </Text>
          </View>
          
          {/* Lock Message */}
          {/* <Text style={[styles.lockTitle, { color: colors.text }]}>
            Noch nicht freigeschaltet
          </Text> */}
          
          <Text style={[styles.lockMessage, { color: colors.icon }]}>
            Diese Kategorie wird ab{' '}
            <Text style={{ fontFamily: 'Nunito_700Bold', color: colors.primary }}>
              Level {requiredLevel}
            </Text>{' '}
            freigeschaltet.
          </Text>
          
          {/* Progress Info */}
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
              <LinearGradient
                colors={['#4CAF50', '#66BB6A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[
                  styles.progressFill,
                  { width: `${(currentLevel / requiredLevel) * 100}%` }
                ]}
              />
            </View>
            
            <Text style={[styles.progressText, { color: colors.icon }]}>
              Du bist auf Level {currentLevel} 
            </Text>
          </View>
          
          {/* Motivational Message */}
          <View style={[styles.motivationBox, { backgroundColor: colors.primary + '15' }]}>
            <IconSymbol name="sparkles" size={20} color={colors.primary} />
            <Text style={[styles.motivationText, { color: colors.text }]}>
              Sammle Punkte durch Stöbern, Vergleichen und Einkaufen!
            </Text>
            <TouchableOpacity
              style={styles.motivationInfoButton}
              onPress={onNavigateToLevels}
              accessibilityRole="button"
              accessibilityLabel="Level & Errungenschaften anzeigen"
              accessibilityHint="Öffnet die Seite mit Level- und Errungenschaftsübersicht"
            >
              <IconSymbol name="info.circle" size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
          
          {/* Divider */}
          <View style={[styles.buttonDivider, { backgroundColor: colors.border }]} />
          
          {/* Action Buttons */}
          <View style={styles.buttonContainer}>
            {/* Rewarded Ad Button */}
            {categoryId && (
              <TouchableOpacity 
                style={[
                  styles.adButton, 
                  { backgroundColor: colors.primary }
                ]}
                onPress={runRewardedUnlock}
                disabled={isLoadingAd}
              >
                <View style={styles.adButtonContent}>
                  {isLoadingAd ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <IconSymbol name="play.rectangle.fill" size={18} color="white" />
                  )}
                  {isLoadingAd ? (
                    <Text style={styles.adButtonTextPrimary}>Werbung wird geladen...</Text>
                  ) : (
                    <View style={styles.adButtonTextWrapper}>
                      <Text style={styles.adButtonTextPrimary}>
                      1 Tag kostenlos freischalten
                      </Text>
                      <Text style={styles.adButtonTextSecondary}>
                          Werbung ansehen
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            )}
            
            {/* Premium Button */}
            <TouchableOpacity 
              style={[
                styles.premiumButtonContainer,
                isPremium && { opacity: 0.6 }
              ]}
              onPress={async () => {
                if (isPremium) {
                  console.log('🛒 User ist bereits Premium');
                  return;
                }
                
                console.log('🛒 Premium-Freischaltung für Kategorie:', categoryName);
                
                try {
                  // RevenueCat Paywall anzeigen
                  const result = await presentPaywall('category_unlock');
                  console.log('🛒 Premium Paywall result:', result.result);
                  
                  if (result.result === 'purchased') {
                    // Bei erfolgreichem Kauf Modal schließen
                    onClose();
                    console.log('✅ Premium gekauft - Kategorie freigeschaltet:', categoryName);
                  }
                  // Bei cancelled oder error bleibt Modal offen
                  
                } catch (error) {
                  console.error('❌ Premium Paywall error:', error);
                  // Modal bleibt offen bei Fehlern
                }
              }}
              disabled={isPremium}
            >
              <LinearGradient
                colors={['#FFD700', '#FFA000']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.premiumButton}
              >
                <View style={styles.premiumButtonContent}>
                  <IconSymbol name="crown.fill" size={18} color="#8B4513" />
                  <Text style={styles.premiumButtonText}>
                    {isPremium ? 'Bereits Premium' : 'Jetzt sofort freischalten'}
                  </Text>
                </View>
                
                {/* Shimmer Overlay */}
                <Animated.View 
                  style={[
                    styles.shimmerOverlay,
                    {
                      transform: [{ translateX: shimmerTranslateX }],
                    }
                  ]}
                >
                  <LinearGradient
                    colors={['transparent', 'rgba(221, 238, 70, 0.12)', 'transparent']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.shimmerGradient}
                  />
                </Animated.View>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </ModalComponent>

    <AdUnavailableModal
      visible={showAdUnavailableModal}
      onClose={() => setShowAdUnavailableModal(false)}
      onRetryConsent={handleConsentRetry}
      isProcessing={isConsentRetrying}
      colors={colors}
    />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  contentCard: {
    width: SCREEN_WIDTH * 0.9,
    maxWidth: 380,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 20,
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  lockContainer: {
    position: 'absolute',
    top: 4,
    right: 110,
    width: 70,
    height: 70,
  },
  lockAnimation: {
    width: '100%',
    height: '100%',
  },
  categoryInfoContainer: {
    alignItems: 'center',
    marginBottom: 4,
    marginTop: 10,
  },
  categoryImage: {
    width: 80,
    height: 80,
    borderRadius: 16,
    marginBottom: 10,
    marginTop: 3,
  },
  categoryImagePlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 16,
    marginBottom: 10,
    marginTop: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryName: {
    fontSize: 22,
    fontFamily: 'Nunito_700Bold',
    textAlign: 'center',
    marginBottom: 6,
  },
  lockTitle: {
    fontSize: 18,
    fontFamily: 'Nunito',
    marginBottom: 12,
  },
  lockMessage: {
    fontSize: 16,
    fontFamily: 'Nunito',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 18,
  },
  progressContainer: {
    width: '100%',
    marginBottom: 12,
  },
  progressBar: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: {
    height: '100%',
  },
  progressText: {
    fontSize: 14,
    fontFamily: 'Nunito',
    textAlign: 'center',
    marginBottom: 4,
  },
  motivationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
     gap: 8,
  },
  motivationInfoButton: {
    padding: 6,
  },
  motivationText: {
    fontSize: 14,
    fontFamily: 'Nunito_500Medium',
    flex: 1,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  buttonDivider: {
    height: 1,
    width: '75%',
    alignSelf: 'center',
    marginBottom: 18,
    marginTop: 18,
    opacity: 0.9,
  },
  // Ad Button Styles
  adButton: {
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 0,
  },
  adButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
    gap: 8,
  },
  adButtonTextWrapper: {
    flex: 1,
    alignItems: 'center',
  },
  adButtonTextPrimary: {
    fontSize: 15,
    fontFamily: 'Nunito_700Bold',
    color: 'white',
    textAlign: 'center',
  },
  adButtonTextSecondary: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  // Premium Button Styles
  premiumButtonContainer: {
    borderRadius: 12,
    shadowColor: '#FFD700',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  premiumButton: {
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 215, 0, 0.3)',
    overflow: 'hidden', // Wichtig für Shimmer-Effekt
    position: 'relative',
  },
  premiumButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  premiumButtonText: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
    color: Colors.light.text,
    textAlign: 'center',
    flex: 1,
    lineHeight: 18,
    textShadowColor: 'rgba(255,255,255,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    
  },
  // Shimmer Effect Styles
  shimmerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 100,
  },
  shimmerGradient: {
    flex: 1,
    width: 100,
  },
  fallbackModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  fallbackModalCard: {
    width: '100%',
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    gap: 14,
  },
  fallbackModalTitle: {
    fontSize: 20,
    fontFamily: 'Nunito_700Bold',
    textAlign: 'center',
  },
  fallbackModalText: {
    fontSize: 14,
    fontFamily: 'Nunito',
    textAlign: 'center',
    lineHeight: 20,
  },
  fallbackModalButton: {
    width: '100%',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  fallbackModalButtonText: {
    color: '#fff',
    fontFamily: 'Nunito_700Bold',
    fontSize: 14,
  },
  fallbackModalLink: {
    marginTop: 4,
  },
  fallbackModalLinkText: {
    fontSize: 13,
    fontFamily: 'Nunito_600SemiBold',
    textDecorationLine: 'underline',
  },
});

type ThemeColors = typeof Colors.light;

interface AdUnavailableModalProps {
  visible: boolean;
  onClose: () => void;
  onRetryConsent: () => void | Promise<void>;
  isProcessing: boolean;
  colors: ThemeColors;
}

const AdUnavailableModal: React.FC<AdUnavailableModalProps> = ({
  visible,
  onClose,
  onRetryConsent,
  isProcessing,
  colors,
}) => {
  if (!visible) return null;
  
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.fallbackModalBackdrop}>
        <View style={[styles.fallbackModalCard, { backgroundColor: colors.cardBackground }]}>
          <IconSymbol name="exclamationmark.triangle.fill" size={28} color={colors.warning} />
          
          <Text style={[styles.fallbackModalTitle, { color: colors.text }]}>
            Werbung gerade nicht verfügbar
          </Text>
          
          <Text style={[styles.fallbackModalText, { color: colors.icon }]}>
            Werbung konnte nicht geladen werden. Ohne Zustimmung können nur wenige Partner Non-Personalized Ads liefern. Du kannst zustimmen oder es später erneut versuchen.
          </Text>
          
          <TouchableOpacity
            style={[styles.fallbackModalButton, { backgroundColor: colors.primary }]}
            onPress={onRetryConsent}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.fallbackModalButtonText}>Werbung zustimmen</Text>
            )}
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.fallbackModalLink}
            onPress={onClose}
          >
            <Text style={[styles.fallbackModalLinkText, { color: colors.icon }]}>
              Später versuchen
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};
