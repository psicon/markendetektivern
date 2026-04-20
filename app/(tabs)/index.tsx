import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BannerAd } from '@/components/ads/BannerAd';
import { DetectiveMark } from '@/components/design/DetectiveMark';
import {
  MorphingHeader,
  MORPHING_HEADER_ROW_HEIGHT,
} from '@/components/design/MorphingHeader';
import { ProductCard } from '@/components/design/ProductCard';
import { QuickAccessCard } from '@/components/design/QuickAccessCard';
import { SearchBottomSheet } from '@/components/ui/SearchBottomSheet';
import { Colors } from '@/constants/Colors';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAnalytics } from '@/lib/contexts/AnalyticsProvider';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useRevenueCat } from '@/lib/contexts/RevenueCatProvider';
import { achievementService } from '@/lib/services/achievementService';
import { FirestoreService } from '@/lib/services/firestore';
import searchHistoryService from '@/lib/services/searchHistoryService';
import WordPressService, { WordPressPost } from '@/lib/services/wordpress';
import { Level } from '@/lib/types/achievements';
import { FirestoreDocument, Handelsmarken, Produkte } from '@/lib/types/firestore';

type DiscounterInfo = { color: string; short: string };

export default function HomeScreen() {
  const { top: insetTop } = useSafeAreaInsets();
  const { theme, shadows, brand } = useTokens();
  const colorScheme = useColorScheme();
  const legacyColors = Colors[colorScheme ?? 'light'];

  const { user, userProfile } = useAuth();
  const { isPremium, refreshPremiumStatus } = useRevenueCat();
  const analytics = useAnalytics();

  // Scroll-driven header
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  // Search
  const [showSearchSheet, setShowSearchSheet] = useState(false);

  // Products
  const [enttarnteProdukte, setEnttarnteProdukte] = useState<FirestoreDocument<Produkte>[]>([]);
  const [discounterMap, setDiscounterMap] = useState<Record<string, DiscounterInfo>>({});
  const [handelsmarken, setHandelsmarken] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Gamification
  const [levels, setLevels] = useState<Level[]>([]);
  const [levelsLoading, setLevelsLoading] = useState(true);

  // News
  const [newsPosts, setNewsPosts] = useState<WordPressPost[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);

  // ─── UMP consent (Android only) ─────────────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'ios') return;
      let cancelled = false;
      (async () => {
        try {
          await new Promise(r => setTimeout(r, 1500));
          if (cancelled) return;
          const { OnboardingService } = await import('@/lib/services/onboardingService');
          if (!(await OnboardingService.hasPassedOnboarding())) return;
          const { consentService } = await import('@/lib/services/consentService');
          if (await consentService.hasConsent()) return;
          const status = await consentService.initialize();
          if (cancelled) return;
          if (status === 'REQUIRED') await consentService.showConsentFormIfRequired();
        } catch {}
      })();
      return () => { cancelled = true; };
    }, [])
  );

  // ─── Pending onboarding paywall ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const flag = await AsyncStorage.getItem('pending_onboarding_paywall');
        if (flag !== '1') return;
        await AsyncStorage.removeItem('pending_onboarding_paywall');
        await refreshPremiumStatus();
        const { remoteConfigService } = await import('@/lib/services/remoteConfigService');
        if (!(await remoteConfigService.shouldShowOnboardingPaywall())) return;
        if (isPremium) return;
        try {
          const { revenueCatService } = await import('@/lib/services/revenueCatService');
          let tries = 0;
          while (!revenueCatService.isInitialized && tries < 25) {
            await new Promise(r => setTimeout(r, 200));
            tries++;
          }
        } catch {}
        const { InteractionManager } = await import('react-native');
        await new Promise<void>(r => InteractionManager.runAfterInteractions(() => r()));
        if (cancelled) return;
        try {
          const Haptics = await import('expo-haptics');
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          const { revenueCatService } = await import('@/lib/services/revenueCatService');
          await revenueCatService.presentPaywall('onboarding');
        } catch {}
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [isPremium]);

  // ─── Load levels ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) { setLevelsLoading(false); return; }
    achievementService.getAllLevels()
      .then(setLevels)
      .catch(() => {})
      .finally(() => setLevelsLoading(false));
  }, [user]);

  // ─── Load products + discounters ────────────────────────────────────────────
  useEffect(() => {
    import('@/lib/services/remoteConfigService').then(m =>
      m.remoteConfigService.initialize().catch(() => {})
    );

    (async () => {
      try {
        setLoading(true);
        const [discounters, produkteData] = await Promise.all([
          FirestoreService.getDiscounter(),
          FirestoreService.getLatestEnttarnteProdukte(10),
        ]);

        const dMap: Record<string, DiscounterInfo> = {};
        discounters.forEach(d => {
          const n = d.name ?? '';
          dMap[d.id] = {
            color: d.color ?? '#888888',
            short: n.length <= 2 ? n : n[0].toUpperCase(),
          };
        });
        setDiscounterMap(dMap);
        setEnttarnteProdukte(produkteData);

        const hMap: Record<string, string> = {};
        await Promise.all(
          produkteData.map(async p => {
            if (!p.handelsmarke) return;
            try {
              const hm = await FirestoreService.getDocumentByReference<Handelsmarken>(p.handelsmarke);
              if (hm && (hm as any).bezeichnung) hMap[p.id] = (hm as any).bezeichnung;
            } catch {}
          })
        );
        setHandelsmarken(hMap);
      } catch {
        setError('Fehler beim Laden der Daten');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ─── Load news ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const svc = new WordPressService();
        const { posts } = await svc.getLatestPosts(5);
        setNewsPosts(posts);
      } catch {}
      finally { setNewsLoading(false); }
    })();
  }, []);

  // ─── Handlers ───────────────────────────────────────────────────────────────
  const handleSearch = async (term: string) => {
    const t = term.trim();
    if (!t || t.length < 3) return;
    if (user?.uid) await searchHistoryService.saveSearchTerm(user.uid, t);
    router.push(`/search-results?query=${encodeURIComponent(t)}` as any);
  };

  const handleProductPress = (product: FirestoreDocument<Produkte>, index: number) => {
    analytics.trackProductViewWithJourney(
      product.id,
      'noname',
      product.name ?? 'NoName Produkt',
      index
    );
    const stufe = parseInt(product.stufe) || 1;
    if (stufe <= 2) {
      router.push(`/noname-detail/${product.id}` as any);
    } else {
      router.push(`/product-comparison/${product.id}?type=noname` as any);
    }
  };

  const openNewsArticle = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
        controlsColor: theme.primary,
      });
    } catch {}
  };

  // ─── Animated styles ────────────────────────────────────────────────────────
  const searchBarAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 30], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [0, 30], [0, -8], Extrapolation.CLAMP) },
    ],
  }));

  // ─── Level card data ────────────────────────────────────────────────────────
  const levelNum = (userProfile as any)?.stats?.currentLevel ?? userProfile?.level ?? 1;
  const currentPoints = (userProfile as any)?.stats?.pointsTotal ?? (userProfile as any)?.stats?.totalPoints ?? 0;
  const currentSavings = userProfile?.totalSavings ?? 0;
  const levelInfo = levels.find(l => l.id === levelNum) ?? levels[0];
  const nextLevel = levels.find(l => l.id === levelNum + 1);
  const levelGradient = (() => {
    if (!levelInfo) return [theme.primary, theme.primary];
    const c = levelInfo.color;
    switch (levelNum) {
      case 1: return [c, '#9e6b50'];
      case 2: return [c, '#ff9800'];
      case 3: return [c, '#4caf50'];
      case 4: return [c, '#ffc107'];
      case 5: return [c, '#ff5252'];
      default: return [c, '#9e6b50'];
    }
  })();

  const scrollContentPaddingTop = insetTop + MORPHING_HEADER_ROW_HEIGHT;

  // ─── Schnellzugriff items ────────────────────────────────────────────────────
  const schnellzugriff = [
    { icon: 'barcode-scan' as const, label: 'Barcode\nscannen', background: brand.accent, dark: true as const, onPress: () => router.push('/barcode-scanner') },
    { icon: 'magnify' as const, label: 'Produkt\nsuchen', background: brand.primary, dark: true as const, onPress: () => setShowSearchSheet(true) },
    { icon: 'cart-outline' as const, label: 'Einkaufs-\nliste', background: theme.surfaceAlt, dark: false as const, onPress: () => router.push('/shopping-list') },
    { icon: 'trophy-outline' as const, label: 'Mein\nLevel', background: theme.surfaceAlt, dark: false as const, onPress: () => router.push('/achievements') },
    { icon: 'newspaper-variant-outline' as const, label: 'Neuig-\nkeiten', background: theme.surfaceAlt, dark: false as const, onPress: () => router.push('/profile') },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <MorphingHeader
        scrollY={scrollY}
        insetTop={insetTop}
        onPressSearch={() => setShowSearchSheet(true)}
        onPressScanner={() => router.push('/barcode-scanner')}
        onPressProfile={() => router.push(user ? ('/profile' as any) : ('/auth/welcome' as any))}
      />

      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: scrollContentPaddingTop, paddingBottom: 100 }}
      >
        {/* ── Below-header search bar ── */}
        <Animated.View style={[{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 }, searchBarAnimStyle]}>
          <Pressable
            onPress={() => setShowSearchSheet(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: theme.surface,
              borderRadius: radii.full,
              height: 48,
              paddingHorizontal: 16,
              gap: 10,
              ...shadows.sm,
            }}
          >
            <MaterialCommunityIcons name="magnify" size={20} color={theme.textMuted} />
            <Text
              style={{ flex: 1, fontFamily, fontWeight: fontWeight.regular, fontSize: 14, color: theme.textMuted }}
              numberOfLines={1}
            >
              Marken oder Produkte suchen…
            </Text>
            <Pressable onPress={() => router.push('/barcode-scanner')}>
              <MaterialCommunityIcons name="barcode-scan" size={20} color={theme.primary} />
            </Pressable>
          </Pressable>
        </Animated.View>

        {/* ── Schnellzugriff ── */}
        <View style={{ marginTop: 20 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 13,
              color: theme.textMuted,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              marginBottom: 12,
              paddingHorizontal: 20,
            }}
          >
            Schnellzugriff
          </Text>
          <Animated.ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
          >
            {schnellzugriff.map((item, i) => (
              <QuickAccessCard
                key={i}
                icon={item.icon}
                label={item.label}
                background={item.background}
                dark={item.dark}
                onPress={item.onPress}
              />
            ))}
          </Animated.ScrollView>
        </View>

        {/* ── Level card ── */}
        {levelsLoading || levels.length === 0 ? (
          <View
            style={{
              marginHorizontal: 20,
              marginTop: 20,
              borderRadius: radii.lg,
              backgroundColor: theme.surface,
              height: 72,
              justifyContent: 'center',
              alignItems: 'center',
              ...shadows.sm,
            }}
          >
            <ActivityIndicator size="small" color={theme.primary} />
          </View>
        ) : (
          <LinearGradient
            colors={levelGradient as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              marginHorizontal: 20,
              marginTop: 20,
              borderRadius: radii.lg,
              overflow: 'hidden',
            }}
          >
            <Pressable
              onPress={() => router.push('/achievements')}
              style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <MaterialCommunityIcons name="trophy" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 15, color: '#fff' }}
                >
                  Level {levelNum}{levelInfo ? ` · ${levelInfo.name}` : ''}
                </Text>
                <Text
                  style={{ fontFamily, fontWeight: fontWeight.regular, fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}
                  numberOfLines={1}
                >
                  {nextLevel
                    ? `${Math.max(0, nextLevel.savingsRequired - currentSavings).toFixed(2)} € Ersparnis zum Aufstieg`
                    : 'Maximales Level erreicht!'}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={20} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </LinearGradient>
        )}

        {/* ── Banner Ad ── */}
        {!isPremium && (
          <View style={{ marginTop: 16, marginHorizontal: -0 }}>
            <BannerAd
              onAdLoaded={() => {}}
              onAdFailedToLoad={() => {}}
            />
          </View>
        )}

        {/* ── Investigation Update / Products ── */}
        <View style={{ marginTop: 24 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 11,
              color: brand.accent,
              letterSpacing: 1,
              textTransform: 'uppercase',
              paddingHorizontal: 20,
              marginBottom: 4,
            }}
          >
            Investigation Update
          </Text>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: 20,
              marginBottom: 12,
            }}
          >
            <Text
              style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 20, color: theme.text }}
            >
              Neu für dich enttarnt
            </Text>
            <Pressable onPress={() => router.push('/(tabs)/explore' as any)}>
              <Text
                style={{ fontFamily, fontWeight: fontWeight.semibold, fontSize: 14, color: theme.primary }}
              >
                Alle →
              </Text>
            </Pressable>
          </View>

          {loading ? (
            <Animated.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            >
              {[0, 1, 2, 3].map(i => (
                <View
                  key={i}
                  style={{
                    width: 168,
                    height: 240,
                    borderRadius: radii.lg,
                    backgroundColor: theme.shimmer1,
                  }}
                />
              ))}
            </Animated.ScrollView>
          ) : error ? (
            <Text
              style={{
                paddingHorizontal: 20,
                fontFamily,
                fontSize: 14,
                color: theme.textMuted,
              }}
            >
              {error}
            </Text>
          ) : (
            <Animated.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            >
              {enttarnteProdukte.map((product, index) => {
                const disc = product.discounter ? discounterMap[(product.discounter as any).id] : null;
                return (
                  <ProductCard
                    key={product.id}
                    title={product.name ?? ''}
                    brand={handelsmarken[product.id] ?? null}
                    imageUri={product.bild ?? null}
                    price={product.preis ?? 0}
                    stufe={parseInt(product.stufe) || 1}
                    marketShort={disc?.short ?? null}
                    marketColor={disc?.color ?? null}
                    variant="horizontal"
                    onPress={() => handleProductPress(product, index)}
                  />
                );
              })}
            </Animated.ScrollView>
          )}
        </View>

        {/* ── Neuigkeiten ── */}
        <View style={{ marginTop: 28 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingHorizontal: 20,
              marginBottom: 12,
            }}
          >
            <Text
              style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 20, color: theme.text }}
            >
              Neuigkeiten
            </Text>
          </View>

          {newsLoading ? (
            <Animated.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            >
              {[0, 1, 2].map(i => (
                <View
                  key={i}
                  style={{
                    width: 240,
                    height: 180,
                    borderRadius: radii.lg,
                    backgroundColor: theme.shimmer1,
                  }}
                />
              ))}
            </Animated.ScrollView>
          ) : newsPosts.length === 0 ? (
            <Text
              style={{ paddingHorizontal: 20, fontFamily, fontSize: 14, color: theme.textMuted }}
            >
              Keine Neuigkeiten verfügbar
            </Text>
          ) : (
            <Animated.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            >
              {newsPosts.map(post => (
                <NewsCard
                  key={post.id}
                  post={post}
                  onPress={openNewsArticle}
                  theme={theme}
                />
              ))}
            </Animated.ScrollView>
          )}
        </View>

        {/* ── Cashback CTA ── */}
        <View style={{ paddingHorizontal: 20, marginTop: 28 }}>
          <LinearGradient
            colors={[brand.primary, brand.primaryDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: radii.xl ?? radii.lg, overflow: 'hidden' }}
          >
            <Pressable
              onPress={() => router.push('/achievements' as any)}
              style={{ padding: 24, flexDirection: 'row', alignItems: 'center' }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 18,
                    color: '#fff',
                    marginBottom: 6,
                  }}
                >
                  Cashback aktivieren
                </Text>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.regular,
                    fontSize: 13,
                    color: 'rgba(255,255,255,0.8)',
                    marginBottom: 16,
                  }}
                >
                  Spare beim nächsten Einkauf extra!
                </Text>
                <View
                  style={{
                    alignSelf: 'flex-start',
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    borderRadius: radii.full,
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                  }}
                >
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.semibold,
                      fontSize: 14,
                      color: '#fff',
                    }}
                  >
                    Jetzt starten →
                  </Text>
                </View>
              </View>
              <View style={{ opacity: 0.15, position: 'absolute', right: 16, bottom: -8 }}>
                <DetectiveMark size={100} color="#fff" />
              </View>
            </Pressable>
          </LinearGradient>
        </View>
      </Animated.ScrollView>

      <SearchBottomSheet
        visible={showSearchSheet}
        onClose={() => setShowSearchSheet(false)}
        searchBarY={insetTop + MORPHING_HEADER_ROW_HEIGHT + 12}
        searchBarHeight={48}
        colors={legacyColors}
        onSearch={handleSearch}
      />
    </View>
  );
}

// ─── Inline news card ────────────────────────────────────────────────────────

type NewsCardProps = {
  post: WordPressPost;
  onPress: (url: string) => void;
  theme: ReturnType<typeof useTokens>['theme'];
};

function NewsCard({ post, onPress, theme }: NewsCardProps) {
  const cleanTitle = WordPressService.cleanHtml(post.title.rendered);
  const formattedDate = WordPressService.formatDate(post.date);

  return (
    <Pressable
      onPress={() => onPress(post.link)}
      style={({ pressed }) => ({
        width: 240,
        borderRadius: radii.lg,
        backgroundColor: theme.surface,
        overflow: 'hidden',
        opacity: pressed ? 0.9 : 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
      })}
    >
      {post.featured_image_url ? (
        <Image
          source={{ uri: post.featured_image_url }}
          style={{ width: '100%', height: 130 }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{
            width: '100%',
            height: 130,
            backgroundColor: theme.surfaceAlt,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <MaterialCommunityIcons name="newspaper" size={32} color={theme.textMuted} />
        </View>
      )}
      <View style={{ padding: 12 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            color: theme.textMuted,
            marginBottom: 6,
          }}
        >
          {formattedDate}
        </Text>
        <Text
          numberOfLines={2}
          style={{
            fontFamily,
            fontWeight: fontWeight.semibold,
            fontSize: 14,
            lineHeight: 19,
            color: theme.text,
          }}
        >
          {cleanTitle}
        </Text>
      </View>
    </Pressable>
  );
}
