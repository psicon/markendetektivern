import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { adMobService } from '@/lib/services/adMobService';
import Constants from 'expo-constants';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

interface BannerAdProps {
  style?: any;
  onAdLoaded?: () => void;
  onAdFailedToLoad?: (error: any) => void;
}

export const BannerAd = ({ style, onAdLoaded, onAdFailedToLoad }: BannerAdProps) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [isReady, setIsReady] = useState(false);
  const [adLoaded, setAdLoaded] = useState(false);
  const [adFailed, setAdFailed] = useState(false);
  const [canShowAds, setCanShowAds] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimeout: NodeJS.Timeout | null = null;

    const scheduleRetry = (reason: string, delay = 2000) => {
      if (cancelled) return;
      console.log(`⏳ BannerAd wartet: ${reason}. Neuer Versuch in ${delay}ms`);
      retryTimeout = setTimeout(() => {
        retryTimeout = null;
        initAds();
      }, delay);
    };

    const initAds = async () => {
      try {
        if (cancelled) return;

        if (Platform.OS === 'ios') {
          setCanShowAds(true);
          await adMobService.initialize();
          if (!cancelled) {
            setIsReady(true);
          }
          return;
        }
        
        const { OnboardingService } = await import('@/lib/services/onboardingService');
        const hasPassedOnboarding = await OnboardingService.hasPassedOnboarding();
        if (!hasPassedOnboarding) {
          scheduleRetry('Onboarding noch nicht abgeschlossen');
          return;
        }

        const { consentService } = await import('@/lib/services/consentService');
        const consentStatus = consentService.getConsentStatus();
        if (consentStatus === 'UNKNOWN') {
          console.log('🔄 BannerAd: Initializing consent service...');
          await consentService.initialize();
        }
        
        const hasConsent = consentService.canShowAds();
        if (!cancelled) {
          setCanShowAds(hasConsent);
        }
        
        console.log('📊 BannerAd Consent Check:', {
          consentStatus: consentService.getConsentStatus(),
          canShowAds: hasConsent
        });
        
        if (!hasConsent) {
          scheduleRetry('keine Einwilligung', 3000);
          return;
        }
        
        if (!adMobService.isAvailable()) {
          scheduleRetry('AdMob noch nicht bereit', 1500);
          return;
        }

        if (!cancelled) {
          setIsReady(true);
        }
      } catch (err) {
        console.error('AdMob init error:', err);
        if (!cancelled) {
          setIsReady(true);
          setCanShowAds(true);
        }
      }
    };
    
    initAds();

    return () => {
      cancelled = true;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
  }, []);

  // Bei Ad-Fehler (no fill), Expo Go oder kein Consent: Nichts anzeigen
  if (Constants.appOwnership === 'expo' || adFailed || !canShowAds) {
    return null; // Komplett ausblenden
  }

  // Zeige dezente Placeholder-Höhe bis SDK bereit ist, damit das Layout nicht springt
  if (!isReady) {
    return (
      <View style={[styles.container, style]}>
        <View style={styles.loadingSpacer} />
      </View>
    );
  }

  // Safe dynamic import with error handling
  let RNBannerAd, BannerAdSize;
  try {
    const mobileAds = require('react-native-google-mobile-ads');
    RNBannerAd = mobileAds.BannerAd;
    BannerAdSize = mobileAds.BannerAdSize;
  } catch (error) {
    console.warn('Failed to load Google Mobile Ads:', error);
    return null;
  }
  
  if (!RNBannerAd || !BannerAdSize) {
    console.warn('BannerAd components not available');
    return null;
  }
  
  const adUnitId = adMobService.getAdUnitId('banner');

  console.log('🎯 BannerAd Render:', { 
    platform: Platform.OS, 
    adUnitId, 
    isReady,
    isDev: __DEV__ 
  });

  // Wenn Ad geladen: Zeige Ad mit "Sponsored" Badge
  // Wenn Ad failed: Zeige nichts (return null oben)
  if (adLoaded) {
    return (
      <View style={[styles.container, style]}>
        <View style={[styles.sponsoredBadge, { backgroundColor: colors.background }]}>
          <Text style={[styles.sponsoredText, { color: colors.text }]}>
            {__DEV__ ? 'Test Ad' : 'Sponsored'}
          </Text>
        </View>
        <RNBannerAd
          unitId={adUnitId}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={(() => {
            // iOS: NON-Personalized Ads (kein UMP = kein Consent = non-personalized required)
            if (Platform.OS === 'ios') {
              return { requestNonPersonalizedAdsOnly: true };
            }
            // Android: Dynamisch basierend auf Consent Status
            try {
              const { consentService } = require('@/lib/services/consentService');
              return consentService.getAdRequestOptions();
            } catch {
              // Fallback: non-personalized für Safety
              return { requestNonPersonalizedAdsOnly: true };
            }
          })()}
          onAdLoaded={() => {
            console.log('✅ BannerAd loaded:', { platform: Platform.OS, adUnitId });
            setAdLoaded(true);
            onAdLoaded?.();
          }}
          onAdFailedToLoad={(error: any) => {
            console.log('ℹ️ BannerAd no fill (normal):', { 
              platform: Platform.OS, 
              adUnitId, 
              error: error?.message || error 
            });
            setAdFailed(true); // Ad ausblenden
            onAdFailedToLoad?.(error);
          }}
        />
      </View>
    );
  }
  
  // Während des Ladens: Zeige nichts (oder optionalen Spacer)
  return (
    <View style={[styles.container, style]}>
      <RNBannerAd
        unitId={adUnitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={(() => {
          // iOS: NON-Personalized Ads (kein UMP = kein Consent = non-personalized required)
          if (Platform.OS === 'ios') {
            return { requestNonPersonalizedAdsOnly: true };
          }
          // Android: Dynamisch basierend auf Consent Status
          try {
            const { consentService } = require('@/lib/services/consentService');
            return consentService.getAdRequestOptions();
          } catch {
            // Fallback: non-personalized für Safety
            return { requestNonPersonalizedAdsOnly: true };
          }
        })()}
        onAdLoaded={() => {
          console.log('✅ BannerAd loaded:', { platform: Platform.OS, adUnitId });
          setAdLoaded(true);
          onAdLoaded?.();
        }}
        onAdFailedToLoad={(error: any) => {
          console.log('ℹ️ BannerAd no fill (normal):', { 
            platform: Platform.OS, 
            adUnitId, 
            error: error?.message || error 
          });
          setAdFailed(true); // Ad ausblenden
          onAdFailedToLoad?.(error);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    overflow: 'hidden',
  },
  placeholder: {
    width: '100%',
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  loadingSpacer: {
    width: '100%',
    height: 60,
  },
  placeholderText: {
    fontSize: 14,
    fontFamily: 'Nunito_400Regular',
    opacity: 0.6,
  },
  sponsoredBadge: {
    position: 'absolute',
    top: 4,
    left: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    zIndex: 1,
  },
  sponsoredText: {
    fontSize: 10,
    fontFamily: 'Nunito_600SemiBold',
    opacity: 0.7,
  },
});