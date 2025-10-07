import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { adMobService } from '@/lib/services/adMobService';
import Constants from 'expo-constants';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

interface TestBannerAdProps {
  style?: any;
  onAdLoaded?: () => void;
  onAdFailedToLoad?: (error: any) => void;
}

// Google offizielles Test-Banner
const TEST_BANNER_ID = 'ca-app-pub-3940256099942544/2934735716';

export const TestBannerAd = ({ style, onAdLoaded, onAdFailedToLoad }: TestBannerAdProps) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    adMobService
      .initialize()
      .then(() => setIsReady(true))
      .catch(() => setIsReady(true));
  }, []);

  // In Expo Go nichts rendern
  if (Constants.appOwnership === 'expo') {
    return null;
  }

  if (!isReady) {
    return <View style={[styles.loadingSpacer, style]} />;
  }

  const { BannerAd: RNBannerAd, BannerAdSize } = require('react-native-google-mobile-ads');

  return (
    <View style={[styles.container, style]}
    >
      <RNBannerAd
        unitId={TEST_BANNER_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={() => onAdLoaded?.()}
        onAdFailedToLoad={(error: any) => onAdFailedToLoad?.(error)}
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
  loadingSpacer: {
    width: '100%',
    height: 60,
    backgroundColor: 'transparent',
  },
});


