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

  useEffect(() => {
    // In TestFlight IMMER AdMob initialisieren
    adMobService.initialize().then(() => {
      setIsReady(true);
    }).catch(err => {
      console.error('AdMob init error:', err);
      setIsReady(true); // Trotzdem versuchen anzuzeigen
    });
  }, []);

  // NUR in Expo Go Placeholder zeigen
  if (Constants.appOwnership === 'expo') {
    return (
      <View style={[styles.container, style]}>
        <View style={[styles.placeholder, { backgroundColor: colors.cardBackground }]}>
          <View style={[styles.sponsoredBadge, { backgroundColor: colors.background }]}>
            <Text style={[styles.sponsoredText, { color: colors.text }]}>Sponsored</Text>
          </View>
          <Text style={[styles.placeholderText, { color: colors.text }]}>
            [Ads werden in Expo Go nicht angezeigt]
          </Text>
        </View>
      </View>
    );
  }

  // Zeige dezente Placeholder-Höhe bis SDK bereit ist, damit das Layout nicht springt
  if (!isReady) {
    return (
      <View style={[styles.container, style]}>
        <View style={styles.loadingSpacer} />
      </View>
    );
  }

  const { BannerAd: RNBannerAd, BannerAdSize, TestIds } = require('react-native-google-mobile-ads');
  const adUnitId = adMobService.getAdUnitId('banner');

  console.log('🎯 BannerAd Render:', { 
    platform: Platform.OS, 
    adUnitId, 
    isReady,
    isDev: __DEV__ 
  });

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
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={() => {
          console.log('✅ BannerAd loaded:', { platform: Platform.OS, adUnitId });
          onAdLoaded?.();
        }}
        onAdFailedToLoad={(error: any) => {
          console.error('❌ BannerAd failed:', { 
            platform: Platform.OS, 
            adUnitId, 
            error: error?.message || error 
          });
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