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

type DiscounterInfo = { color: string; short: string; bild?: string };

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
          // Pool of the 200 most-recent Stufe 3/4/5 products, then
          // pick 10 at random. Each Home visit rotates the sample so
          // the section doesn't feel static, but the pool is still
          // bounded to the high-quality hits.
          FirestoreService.getTopEnttarnteProdukteRandomized(200, 10),
        ]);

        const dMap: Record<string, DiscounterInfo> = {};
        discounters.forEach(d => {
          const n = d.name ?? '';
          dMap[d.id] = {
            color: d.color ?? '#888888',
            short: n.length <= 2 ? n : n[0].toUpperCase(),
            bild: (d as any).bild,
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

  // Scan-icon-in-the-search-bar handoff: while the header scan button
  // is appearing (see MorphingHeader.scannerStyle, scrollY 30→95), this
  // icon simultaneously translates UP and shrinks, giving the visual
  // impression of the icon "flying" into the header. It fades before
  // the header button's landing-pop at scrollY ≈ 72, so the arrival
  // there reads as the same icon reaching its destination.
  const bigScanIconAnimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, 50, 68], [1, 0.5, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollY.value, [0, 68], [0, -72], Extrapolation.CLAMP) },
      { scale: interpolate(scrollY.value, [0, 68], [1, 0.7], Extrapolation.CLAMP) },
    ],
  }));

  // ─── Level card data ────────────────────────────────────────────────────────
  const levelNum = (userProfile as any)?.stats?.currentLevel ?? userProfile?.level ?? 1;
  const currentSavings = userProfile?.totalSavings ?? 0;
  const levelInfo = levels.find(l => l.id === levelNum) ?? levels[0];
  const nextLevel = levels.find(l => l.id === levelNum + 1);
  const levelBg = levelInfo?.color ?? brand.primary;
  // Savings-based progress toward the next level threshold.
  const levelProgress = (() => {
    if (!nextLevel) return 1;
    const current = levelInfo?.savingsRequired ?? 0;
    const span = Math.max(1, nextLevel.savingsRequired - current);
    return Math.max(0, Math.min(1, (currentSavings - current) / span));
  })();
  const remainingToNext = nextLevel
    ? Math.max(0, nextLevel.savingsRequired - currentSavings)
    : 0;

  const scrollContentPaddingTop = insetTop + MORPHING_HEADER_ROW_HEIGHT;

  // ─── Schnellzugriff items ────────────────────────────────────────────────────
  // Matches prototype Home.jsx. Backgrounds are prototype-specific brand accents
  // (mint for Kassenbon, lavender for Produkte, neutral for the rest).
  // TODO: route Kassenbon / Produkte / Umfragen to real Rewards screen once built
  // (currently /achievements is the closest existing surface).
  const schnellzugriff = [
    { icon: 'receipt' as const, label: 'Kassenbon\nscannen', background: '#95cfc4', dark: true as const,  onPress: () => router.push('/achievements' as any) },
    { icon: 'camera-plus-outline'  as const, label: 'Produkte\neinreichen', background: '#a89cdf', dark: true as const,  onPress: () => router.push('/achievements' as any) },
    { icon: 'heart-outline'        as const, label: 'Deine\nFavoriten',    background: theme.surfaceAlt, dark: false as const, onPress: () => router.push('/favorites' as any) },
    { icon: 'poll'                 as const, label: 'Umfragen',            background: theme.surfaceAlt, dark: false as const, onPress: () => router.push('/achievements' as any) },
    { icon: 'format-list-checks'   as const, label: 'Einkaufs-\nliste',    background: theme.surfaceAlt, dark: false as const, onPress: () => router.push('/shopping-list' as any) },
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
        {/* ── Below-header search bar ── The scan-icon is pulled out of
            the searchBarAnimStyle wrapper so it can travel up to the
            header position independently of the pill's fade. That way
            the icon looks like it's physically flying into the chrome
            instead of vanishing with the pill and re-appearing above. */}
        <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 }}>
          <Animated.View style={searchBarAnimStyle}>
            <Pressable
              onPress={() => setShowSearchSheet(true)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: theme.surface,
                borderRadius: radii.full,
                height: 48,
                paddingLeft: 16,
                paddingRight: 48, // reserve space where the scan icon visually sits
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
            </Pressable>
          </Animated.View>
          <Animated.View
            style={[
              {
                position: 'absolute',
                // top = 12 (wrapper paddingTop) + (48 pill height - 20 icon) / 2
                top: 26,
                // right = 20 (wrapper paddingRight) + 16 (pill paddingRight)
                right: 36,
              },
              bigScanIconAnimStyle,
            ]}
          >
            <Pressable onPress={() => router.push('/barcode-scanner')} hitSlop={10}>
              <MaterialCommunityIcons name="barcode-scan" size={20} color={theme.primary} />
            </Pressable>
          </Animated.View>
        </View>

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
            scrollsToTop={false}
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
          <Pressable
            onPress={() => router.push('/achievements' as any)}
            style={{
              marginHorizontal: 20,
              marginTop: 20,
              borderRadius: radii.lg,
              overflow: 'hidden',
              backgroundColor: levelBg,
              paddingHorizontal: 16,
              paddingVertical: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 13, color: '#fff', marginBottom: 8 }}
                numberOfLines={1}
              >
                Level {levelNum}
                {levelInfo ? `: ${levelInfo.name}` : ''}
              </Text>
              <View
                style={{
                  height: 8,
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    width: `${levelProgress * 100}%`,
                    height: '100%',
                    backgroundColor: '#fff',
                    borderRadius: 4,
                  }}
                />
              </View>
              <Text
                style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 11, color: 'rgba(255,255,255,0.9)', marginTop: 6 }}
                numberOfLines={1}
              >
                {nextLevel
                  ? `Noch ${remainingToNext.toFixed(2)} € bis zum nächsten Rang`
                  : 'Maximales Level erreicht!'}
              </Text>
            </View>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: 'rgba(255,255,255,0.2)',
                justifyContent: 'center',
                alignItems: 'center',
                flexShrink: 0,
              }}
            >
              <MaterialCommunityIcons name="trophy-outline" size={22} color="#fff" />
            </View>
          </Pressable>
        )}

        {/* ── Banner Ad ── */}
        {!isPremium && (
          <View style={{ marginTop: 16 }}>
            <BannerAd
              onAdLoaded={() => {}}
              onAdFailedToLoad={() => {}}
            />
          </View>
        )}

        {/* ── Neue Funde — typography matches the "Schnellzugriff"
            section-eyebrow further up the page for a consistent
            rhythm across the Home sections (same size, same muted
            grey, same letter-spacing). */}
        <View style={{ marginTop: 24 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 13,
              color: theme.textMuted,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              paddingHorizontal: 20,
              marginBottom: 4,
            }}
          >
            Neue Funde
          </Text>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingHorizontal: 20,
              marginBottom: 12,
            }}
          >
            <Text
              style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 22, color: theme.text, letterSpacing: -0.2 }}
            >
              Für dich enttarnt
            </Text>
            <Pressable onPress={() => router.push('/(tabs)/explore' as any)}>
              <Text
                style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 13, color: theme.primary }}
              >
                Alle anzeigen
              </Text>
            </Pressable>
          </View>

          {loading ? (
            <Animated.ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollsToTop={false}
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
              scrollsToTop={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            >
              {enttarnteProdukte.map((product, index) => {
                const disc = product.discounter ? discounterMap[(product.discounter as any).id] : null;
                return (
                  <ProductCard
                    key={product.id}
                    title={product.name ?? ''}
                    brand={handelsmarken[product.id] ?? null}
                    eyebrowLogoUri={disc?.bild ?? null}
                    imageUri={product.bild ?? null}
                    price={product.preis ?? 0}
                    stufe={parseInt(product.stufe) || 1}
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
              scrollsToTop={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            >
              {[0, 1, 2].map(i => (
                <View
                  key={i}
                  style={{
                    width: 270,
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
              scrollsToTop={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
            >
              {newsPosts.map(post => (
                <NewsCard
                  key={post.id}
                  post={post}
                  onPress={openNewsArticle}
                />
              ))}
            </Animated.ScrollView>
          )}
        </View>

        {/* ── Cashback CTA ── */}
        <View style={{ paddingHorizontal: 20, marginTop: 28 }}>
          <LinearGradient
            colors={[brand.primaryDark, brand.primary]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: radii.xl, overflow: 'hidden', ...shadows.fab }}
          >
            <Pressable
              onPress={() => router.push('/barcode-scanner' as any)}
              style={{ padding: 24 }}
            >
              <View style={{ opacity: 0.18, position: 'absolute', right: -30, bottom: -20 }}>
                <DetectiveMark size={140} color="#fff" />
              </View>
              <View>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 22,
                    lineHeight: 26,
                    color: '#fff',
                    letterSpacing: -0.2,
                    marginBottom: 10,
                  }}
                >
                  Sichere dir Cashback &{'\n'}Rewards!
                </Text>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.regular,
                    fontSize: 13,
                    lineHeight: 19,
                    color: 'rgba(255,255,255,0.92)',
                    marginBottom: 16,
                    maxWidth: 260,
                  }}
                >
                  Scanne deinen Kassenbeleg oder nimm an Umfragen teil, um dir Gutscheine oder Cashback zu sichern.
                </Text>
                <View
                  style={{
                    alignSelf: 'flex-start',
                    backgroundColor: theme.surface,
                    borderRadius: radii.full,
                    paddingHorizontal: 18,
                    height: 44,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <MaterialCommunityIcons name="barcode-scan" size={16} color={brand.primary} />
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.bold,
                      fontSize: 13,
                      color: brand.primary,
                    }}
                  >
                    Beleg scannen
                  </Text>
                </View>
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
};

function NewsCard({ post, onPress }: NewsCardProps) {
  const { theme, shadows } = useTokens();
  const cleanTitle = WordPressService.cleanHtml(post.title.rendered);
  const formattedDate = WordPressService.formatDate(post.date);

  return (
    <Pressable
      onPress={() => onPress(post.link)}
      style={({ pressed }) => ({
        width: 270,
        borderRadius: radii.lg,
        backgroundColor: theme.surface,
        overflow: 'hidden',
        opacity: pressed ? 0.92 : 1,
        ...shadows.md,
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
      <View style={{ padding: 14 }}>
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
