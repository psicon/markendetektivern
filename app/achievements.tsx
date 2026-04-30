// app/achievements.tsx
//
// Errungenschaften & Level — same design language as the Belohnungen
// tab so this screen reads as part of the same product:
//   • Custom chrome (BlurView on iOS, tinted View on Android), back
//     button + title + info — NO native stack header.
//   • Level-hero up top (gradient card, fixed HERO_HEIGHT, mirrors
//     the StatusHero pattern from the Rewards tab).
//   • Two horizontal-scroll rows below: Levels + Errungenschaften.
// Top sections from the legacy screen (savings card, leaderboard
// button, streak card) are intentionally GONE — the Belohnungen
// StatusHero already owns those, this screen is the deep-dive.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useNavigation } from 'expo-router';
import LottieView from 'lottie-react-native';
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DETAIL_HEADER_ROW_HEIGHT,
  DetailHeader,
} from '@/components/design/DetailHeader';
import { FilterSheet } from '@/components/design/FilterSheet';
import { AchievementsSkeleton } from '@/components/design/Skeletons';
import AchievementUnlockOverlay from '@/components/ui/AchievementUnlockOverlay';
import { IconSymbol } from '@/components/ui/IconSymbol';
import LevelUpOverlay from '@/components/ui/LevelUpOverlay';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useAchievements } from '@/lib/hooks/useAchievements';
import { achievementService } from '@/lib/services/achievementService';
import {
  LEVEL_GRADIENT_END,
  LEVEL_GRADIENT_START,
  levelGradient,
  mdiForLevelIcon,
} from '@/lib/utils/levelIcon';
import { overlayManager } from '@/lib/services/overlayManager';
import type { Achievement, Level } from '@/lib/types/achievements';

// ────────────────────────────────────────────────────────────────────
// Design helpers — identical to the Rewards screen (single source of
// visual truth; eventually extracted to a shared util file).
// ────────────────────────────────────────────────────────────────────

const HERO_HEIGHT = 144;

// `levelGradient` lives in `lib/utils/levelIcon.ts` — shared with
// the home-tab level card so both surfaces render identical colour
// transitions for the same level.

function difficultyFor(points: number): { label: string; color: string } {
  if (points <= 10) return { label: 'Einfach', color: '#2196F3' };
  if (points <= 20) return { label: 'Mittel', color: '#4CAF50' };
  if (points <= 25) return { label: 'Schwer', color: '#FF9800' };
  return { label: 'Meister', color: '#F44336' };
}

// Format an achievement progress value for display. Most actions
// produce integer counts ("scan 5 products" → 0/5/10), but
// `savings_total` is in € and arrives as a float that needs both
// rounding (so we don't render "31.9099999999999990") and a € suffix.
function formatProgress(value: number, action: string | undefined): string {
  if (action === 'savings_total') {
    return `${value.toFixed(2).replace('.', ',')} €`;
  }
  // Integer-by-default — Math.round catches floating-point noise
  // from any other action without changing meaningful values.
  return Math.round(value).toLocaleString('de-DE');
}

function lottieFor(a: Achievement) {
  try {
    switch (a.trigger?.action) {
      case 'first_action_any':
        return require('@/assets/lottie/rocket.json');
      case 'daily_streak':
        return a.trigger.target >= 7
          ? require('@/assets/lottie/streak-fire.json')
          : require('@/assets/lottie/streak-bonus.json');
      case 'view_comparison':
        return require('@/assets/lottie/comparison.json');
      case 'complete_shopping':
        return require('@/assets/lottie/task.json');
      case 'search_product':
        return require('@/assets/lottie/search.json');
      case 'submit_rating':
        return require('@/assets/lottie/ratingsthumbsup.json');
      case 'create_list':
        return require('@/assets/lottie/task.json');
      case 'convert_product':
        return require('@/assets/lottie/swap.json');
      case 'share_app':
        return require('@/assets/lottie/review.json');
      case 'submit_product':
        return require('@/assets/lottie/favorites.json');
      case 'save_product':
        return require('@/assets/lottie/favorites2.json');
      case 'savings_total':
        return require('@/assets/lottie/savings.json');
      default:
        return require('@/assets/lottie/confetti.json');
    }
  } catch {
    return require('@/assets/lottie/confetti.json');
  }
}

// MDI icon glyph for a Firestore-stored level icon name. Shared
// helper so the home-tab level card and this screen render the
// same icon for the same level — see `lib/utils/levelIcon.ts`.

// ────────────────────────────────────────────────────────────────────
// Screen
// ────────────────────────────────────────────────────────────────────

type ProgressedAchievement = Achievement & {
  progress: number;
  maxProgress: number;
  isCompleted: boolean;
  completedAt?: Date;
};

export default function AchievementsScreen() {
  const { theme } = useTokens();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user, userProfile } = useAuth();
  const {
    achievements,
    userStats,
    getAchievementWithProgress,
    loading: achievementsLoading,
  } = useAchievements();

  const [levels, setLevels] = useState<Level[]>([]);
  const [levelsLoading, setLevelsLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);

  const [showLevelUp, setShowLevelUp] = useState(false);
  const [levelUpData, setLevelUpData] = useState<{
    newLevel: number;
    oldLevel: number;
  } | null>(null);
  const [showAchUnlock, setShowAchUnlock] = useState<{
    visible: boolean;
    achievement: ProgressedAchievement | null;
  }>({ visible: false, achievement: null });

  // Hide the native stack header — we render our own chrome below
  // (BlurView/tinted) so the screen visually matches the Rewards
  // tab (no abrupt "tinted bar at the top → white content" jump).
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    if (!user) {
      setLevelsLoading(false);
      return;
    }
    let alive = true;
    achievementService
      .getAllLevels()
      .then((ls) => {
        if (!alive) return;
        setLevels(ls || []);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLevelsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  const currentLevel: number =
    userStats?.currentLevel ??
    (userProfile as any)?.stats?.currentLevel ??
    (userProfile as any)?.level ??
    1;
  const currentLevelInfo = levels.find((l) => l.id === currentLevel);
  const nextLevel = levels.find((l) => l.id === currentLevel + 1);

  const pts = Number(
    userStats?.pointsTotal ?? (userProfile as any)?.stats?.pointsTotal ?? 0,
  );
  const eur = Number(
    (userProfile as any)?.totalSavings ??
      (userProfile as any)?.stats?.savingsTotal ??
      0,
  );

  const requiredPts = nextLevel?.pointsRequired ?? 0;
  const requiredEur = nextLevel?.savingsRequired ?? 0;
  const ptsPct =
    requiredPts > 0
      ? Math.min(100, Math.max(0, Math.round((pts / requiredPts) * 100)))
      : 100;
  const eurPct =
    requiredEur > 0
      ? Math.min(100, Math.max(0, Math.round((eur / requiredEur) * 100)))
      : 100;

  const processed: ProgressedAchievement[] = useMemo(() => {
    return (achievements || [])
      .filter((a) => a.isActive !== false)
      .map((a) => getAchievementWithProgress(a) as ProgressedAchievement)
      .sort((a, b) => {
        // Primary: by difficulty (points) ascending — Einfach
        // (≤10) first, then Mittel (≤20), Schwer (≤25), Meister.
        if (a.points !== b.points) return a.points - b.points;
        // Secondary within same difficulty: in-progress first
        // (motivating), then completed wins, then untouched.
        const aActive = !a.isCompleted && a.progress > 0;
        const bActive = !b.isCompleted && b.progress > 0;
        if (aActive !== bActive) return aActive ? -1 : 1;
        if (a.isCompleted !== b.isCompleted) return a.isCompleted ? -1 : 1;
        return 0;
      });
  }, [achievements, getAchievementWithProgress]);

  const completedCount = processed.filter((p) => p.isCompleted).length;

  // Chrome height — same row metric as the rest of the app's
  // detail screens (DetailHeader uses DETAIL_HEADER_ROW_HEIGHT
  // below the safe-area inset).
  const chromeHeight = insets.top + DETAIL_HEADER_ROW_HEIGHT;

  // Loading state: render the chrome + a skeleton body instead of a
  // centered ActivityIndicator. Two reasons:
  //   1. The DetailHeader stays visible immediately (no abrupt
  //      "spinner → header pops in" jump) — same pattern the
  //      product-detail / comparison screens use.
  //   2. The skeleton mirrors the page layout (hero card + 2 card
  //      rows) so the eventual data swap doesn't shift content.
  const isLoading = levelsLoading || achievementsLoading;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: chromeHeight,
          paddingBottom: 40,
        }}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!isLoading}
      >
        {isLoading ? (
          <AchievementsSkeleton />
        ) : (
        <>
        {/* ── Current Level Hero ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
          <CurrentLevelHero
            level={currentLevelInfo}
            levelId={currentLevel}
            nextLevel={nextLevel}
            pts={pts}
            eur={eur}
            requiredPts={requiredPts}
            requiredEur={requiredEur}
            ptsPct={ptsPct}
            eurPct={eurPct}
            streak={userStats?.currentStreak ?? 0}
            freezeTokens={userStats?.freezeTokens ?? 0}
          />
        </View>

        <View style={{ height: 22 }} />

        {/* ── Levels ── */}
        <Section
          title="Levels"
          subtitle={`Level ${currentLevel} / ${levels.length}`}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
          >
            {levels.map((level) => (
              <LevelCard
                key={level.id}
                level={level}
                isActive={level.id === currentLevel}
                isUnlocked={level.id <= currentLevel}
                onPress={() => {
                  if (level.id > currentLevel) return;
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  overlayManager.showOverlay(() => {
                    setLevelUpData({
                      newLevel: level.id,
                      oldLevel: Math.max(0, level.id - 1),
                    });
                    setShowLevelUp(true);
                  });
                }}
              />
            ))}
          </ScrollView>
        </Section>

        <View style={{ height: 22 }} />

        {/* ── Errungenschaften ── */}
        <Section
          title="Errungenschaften"
          subtitle={`${completedCount} / ${processed.length}`}
        >
          {processed.length === 0 ? (
            <View
              style={{ paddingHorizontal: 20, paddingVertical: 24 }}
            >
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 13,
                  color: theme.textMuted,
                  textAlign: 'center',
                }}
              >
                Errungenschaften werden geladen …
              </Text>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
            >
              {processed.map((a) => (
                <AchievementCard
                  key={a.id}
                  achievement={a}
                  onPress={() => {
                    if (!a.isCompleted) return;
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    overlayManager.showOverlay(() => {
                      setShowAchUnlock({ visible: true, achievement: a });
                    });
                  }}
                />
              ))}
            </ScrollView>
          )}
        </Section>
        </>
        )}
      </ScrollView>

      {/* Chrome — shared `DetailHeader` (BlurView on iOS, tinted
          View on Android, arrow-left back button, optional right
          slot). One header pattern across all detail screens. */}
      <DetailHeader
        title="Errungenschaften"
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={() => setShowInfo(true)}
            hitSlop={6}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <MaterialCommunityIcons
              name="information-outline"
              size={18}
              color={theme.textMuted}
            />
          </Pressable>
        }
      />

      {/* Info bottom-sheet — same `FilterSheet` component used
          for the Region-Setup on the Belohnungen tab so all sheets
          share the slide-up animation, drag handle, backdrop fade
          and pan-to-dismiss gesture. */}
      <FilterSheet
        visible={showInfo}
        title="Level & Errungenschaften"
        onClose={() => setShowInfo(false)}
      >
        <InfoSheetContent />
      </FilterSheet>

      {/* Overlays */}
      {showLevelUp && levelUpData ? (
        <LevelUpOverlay
          visible={showLevelUp}
          newLevel={levelUpData.newLevel}
          oldLevel={levelUpData.oldLevel}
          onClose={() => {
            setShowLevelUp(false);
            setLevelUpData(null);
          }}
        />
      ) : null}
      {showAchUnlock.visible && showAchUnlock.achievement ? (
        <AchievementUnlockOverlay
          visible={showAchUnlock.visible}
          achievement={showAchUnlock.achievement}
          onClose={() =>
            setShowAchUnlock({ visible: false, achievement: null })
          }
        />
      ) : null}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// CurrentLevelHero — rich level showcase. Taller than the Rewards
// StatusHero (this screen IS about the level, so it gets more
// vertical real estate). Layout:
//   ┌────────────────────────────────────────────┐
//   │ [icon 64]  ⭐ AKTUELL · LV 3                │
//   │            Actionmaestro                   │
//   │            "Jetzt geht es erst richtig…"   │
//   │                                            │
//   │ ⭐ Lv 4 · Preisjäger          50 / 100      │
//   │ ▰▰▰▰▰▱▱▱▱▱                                 │
//   │ 💵 Ersparnis            32,44 / 20,00 €    │
//   │ ▰▰▰▰▰▰▰▰▰▰                                 │
//   │                                            │
//   │ ✨ Noch X Pkt & Y € bis Lv N+1!            │
//   └────────────────────────────────────────────┘
// "Reward / category-unlock" chip dropped per design feedback —
// the level identity (number, name, character description) is the
// hero content; the levels-list below covers the rest of the
// catalogue.
// ────────────────────────────────────────────────────────────────────

function CurrentLevelHero({
  level,
  levelId,
  nextLevel,
  pts,
  eur,
  requiredPts,
  requiredEur,
  ptsPct,
  eurPct,
  streak,
  freezeTokens,
}: {
  level: Level | undefined;
  levelId: number;
  nextLevel: Level | undefined;
  pts: number;
  eur: number;
  requiredPts: number;
  requiredEur: number;
  ptsPct: number;
  eurPct: number;
  streak: number;
  freezeTokens: number;
}) {
  const gradient = levelGradient(levelId, level?.color);
  const mdiIcon = mdiForLevelIcon(level?.icon);
  const levelName = level?.name ?? `Level ${levelId}`;
  const description = level?.description ?? '';

  // Footer copy — only relevant when we know what's missing.
  const ptsRemaining = Math.max(0, requiredPts - pts);
  const eurRemaining = Math.max(0, requiredEur - eur);
  const showFooter = !!nextLevel && (ptsRemaining > 0 || eurRemaining > 0);
  const footer = (() => {
    if (!showFooter) return '';
    const bits: string[] = [];
    if (ptsRemaining > 0) bits.push(`${ptsRemaining.toLocaleString('de-DE')} Pkt`);
    if (eurRemaining > 0) bits.push(`${eurRemaining.toFixed(2).replace('.', ',')} €`);
    return `Noch ${bits.join(' & ')} bis Lv ${levelId + 1}!`;
  })();

  return (
    <LinearGradient
      colors={gradient}
      start={{ x: -1, y: 0.34 }}
      end={{ x: 1, y: -0.34 }}
      style={{
        borderRadius: 18,
        paddingHorizontal: 16,
        paddingVertical: 16,
        overflow: 'hidden',
      }}
    >
      {/* Identity row — icon + LV pill + name + description */}
      <View style={{ flexDirection: 'row', gap: 14, marginBottom: 12 }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: 'rgba(255,255,255,0.22)',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: 'rgba(255,255,255,0.55)',
          }}
        >
          <MaterialCommunityIcons name={mdiIcon} size={32} color="#fff" />
        </View>
        <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
          <View style={{ alignSelf: 'flex-start', marginBottom: 4 }}>
            <HeroPill
              icon="star-circle"
              label={`AKTUELL · LV ${levelId}`}
            />
          </View>
          <Text
            numberOfLines={1}
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 22,
              color: '#fff',
              letterSpacing: -0.4,
              lineHeight: 26,
            }}
          >
            {levelName}
          </Text>
          {description ? (
            <Text
              numberOfLines={2}
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 12,
                color: '#fff',
                opacity: 0.92,
                lineHeight: 15,
                marginTop: 2,
              }}
            >
              {description}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Progress bars to next level */}
      {nextLevel ? (
        <View style={{ gap: 8 }}>
          <ProgressBar
            icon="star-four-points"
            label={`Lv ${levelId + 1} · ${nextLevel.name}`}
            current={pts.toLocaleString('de-DE')}
            required={requiredPts.toLocaleString('de-DE')}
            pct={requiredPts > 0 ? ptsPct : 100}
          />
          {requiredEur > 0 ? (
            <ProgressBar
              icon="cash"
              label="Ersparnis"
              current={`${eur.toFixed(2).replace('.', ',')} €`}
              required={`${requiredEur.toFixed(2).replace('.', ',')} €`}
              pct={eurPct}
            />
          ) : null}
        </View>
      ) : (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 10,
            backgroundColor: 'rgba(255,255,255,0.18)',
          }}
        >
          <MaterialCommunityIcons name="trophy" size={18} color="#ffd44b" />
          <Text
            style={{
              flex: 1,
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 13,
              color: '#fff',
            }}
          >
            Maximales Level erreicht — du bist ein wahrer MarkenDetektiv!
          </Text>
        </View>
      )}

      {/* Footer status row — three pills in the SAME HeroPill style,
          horizontal with flex-wrap so they reflow gracefully on
          narrow widths instead of overflowing:
            🚀 Noch X Pkt / Y € bis Lv N+1
            🔥 X Tag(e) Streak
            ❄ X/2 Freezes
          Single visual rhythm replaces the old mix of one
          "footer banner" + two stranded top-row pills. */}
      {showFooter || streak > 0 || freezeTokens > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            marginTop: 12,
          }}
        >
          {showFooter ? (
            <HeroPill icon="rocket-launch" label={footer} />
          ) : null}
          <HeroPill
            icon="fire"
            label={`${streak} ${streak === 1 ? 'TAG' : 'TAGE'} STREAK`}
          />
          <HeroPill
            icon="snowflake"
            label={`${freezeTokens}/2 FREEZES`}
          />
        </View>
      ) : null}
    </LinearGradient>
  );
}

// ────────────────────────────────────────────────────────────────────
// Hero-card sub-components — same shape + style as on Rewards.
// ────────────────────────────────────────────────────────────────────

function HeroPill({
  icon,
  label,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
}) {
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        backgroundColor: 'rgba(255,255,255,0.22)',
      }}
    >
      <MaterialCommunityIcons name={icon} size={11} color="#ffd44b" />
      <Text
        numberOfLines={1}
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 10,
          color: '#fff',
          letterSpacing: 0.4,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function ProgressBar({
  icon,
  label,
  current,
  required,
  pct,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  current: string;
  required: string;
  pct: number;
}) {
  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginBottom: 5,
        }}
      >
        <MaterialCommunityIcons
          name={icon}
          size={13}
          color="#fff"
          style={{ opacity: 0.95 }}
        />
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            marginLeft: 6,
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 12,
            color: '#fff',
            opacity: 0.95,
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 12,
            color: '#fff',
          }}
        >
          {current} / {required}
        </Text>
      </View>
      <View
        style={{
          height: 5,
          backgroundColor: 'rgba(255,255,255,0.22)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${Math.max(0, Math.min(100, pct))}%`,
            height: '100%',
            backgroundColor: '#fff',
            borderRadius: 3,
          }}
        />
      </View>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// Section header
// ────────────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const { theme } = useTokens();
  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          paddingHorizontal: 20,
          marginBottom: 10,
        }}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 20,
            color: theme.text,
            letterSpacing: -0.2,
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 12,
              color: theme.textMuted,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// LevelCard — horizontal scroll item.
// White surface card with level color as accent. NO reward chip
// anymore (the "Veggie und Vegan freigeschaltet" type lines were
// removed per design feedback) — instead the level's motivational
// description is shown so each card carries personality.
// ────────────────────────────────────────────────────────────────────

const LEVEL_CARD_W = 168;
const LEVEL_CARD_H = 184;

function LevelCard({
  level,
  isActive,
  isUnlocked,
  onPress,
}: {
  level: Level;
  isActive: boolean;
  isUnlocked: boolean;
  onPress: () => void;
}) {
  const { theme, shadows } = useTokens();
  const isLocked = !isUnlocked;
  const mdiIcon = mdiForLevelIcon(level.icon);
  const accent = level.color || '#FFA500';

  return (
    <Pressable
      onPress={onPress}
      disabled={isLocked}
      style={({ pressed }) => ({
        opacity: pressed && !isLocked ? 0.92 : 1,
      })}
    >
      <View
        style={{
          width: LEVEL_CARD_W,
          height: LEVEL_CARD_H,
          borderRadius: 14,
          padding: 14,
          backgroundColor: theme.surface,
          borderWidth: isActive ? 2 : 1,
          borderColor: isActive
            ? accent
            : isUnlocked
              ? accent + '40'
              : theme.border,
          ...(isActive || isUnlocked ? shadows.sm : {}),
        }}
      >
        {/* Top: icon + status indicator */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: isLocked ? theme.surfaceAlt : accent + '22',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: isLocked ? 0.55 : 1,
            }}
          >
            <MaterialCommunityIcons
              name={mdiIcon}
              size={24}
              color={isLocked ? theme.textMuted : accent}
            />
          </View>
          {isActive ? (
            <View
              style={{
                paddingHorizontal: 7,
                paddingVertical: 3,
                borderRadius: 6,
                backgroundColor: accent,
              }}
            >
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 9,
                  color: '#fff',
                  letterSpacing: 0.5,
                }}
              >
                AKTUELL
              </Text>
            </View>
          ) : isUnlocked ? (
            <MaterialCommunityIcons
              name="check-circle"
              size={20}
              color="#4CAF50"
            />
          ) : (
            <MaterialCommunityIcons
              name="lock"
              size={18}
              color={theme.textMuted}
            />
          )}
        </View>

        {/* LV badge */}
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 10,
            color: isLocked ? theme.textMuted : accent,
            letterSpacing: 0.6,
            marginBottom: 2,
          }}
        >
          LV {level.id}
        </Text>

        {/* Name */}
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 15,
            color: isLocked ? theme.textMuted : theme.text,
            lineHeight: 18,
            letterSpacing: -0.2,
            opacity: isLocked ? 0.65 : 1,
            marginBottom: 6,
          }}
        >
          {level.name}
        </Text>

        {/* Description (replaces the old reward chip) */}
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Text
            numberOfLines={3}
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 11,
              color: isLocked ? theme.textMuted : theme.textSub,
              lineHeight: 14,
              opacity: isLocked ? 0.55 : 0.9,
            }}
          >
            {level.description || ''}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────────────
// AchievementCard — horizontal scroll item.
//
// White surface card with difficulty colour as accent. Two states:
//   • Done: gold-ringed Lottie animation autoplay + "+X Pkt"
//   • In-progress: difficulty-tinted IconSymbol (renders the SF
//     symbol stored in `achievement.icon` from Firestore — same
//     icons the legacy screen used) + progress bar
//
// The achievement DESCRIPTION is shown directly under the title so
// the user sees what the task actually is — was missing in the
// previous version.
// ────────────────────────────────────────────────────────────────────

const ACH_CARD_W = 168;
const ACH_CARD_H = 184;

function AchievementCard({
  achievement,
  onPress,
}: {
  achievement: ProgressedAchievement;
  onPress: () => void;
}) {
  const { theme, shadows } = useTokens();
  const diff = difficultyFor(achievement.points);
  const unlocked = achievement.isCompleted;
  const pct =
    achievement.maxProgress > 0
      ? Math.min(
          100,
          Math.round((achievement.progress / achievement.maxProgress) * 100),
        )
      : 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
    >
      <View
        style={{
          width: ACH_CARD_W,
          height: ACH_CARD_H,
          borderRadius: 14,
          padding: 14,
          backgroundColor: theme.surface,
          borderWidth: unlocked ? 2 : 1,
          borderColor: unlocked ? '#FFA500' : theme.border,
          ...shadows.sm,
        }}
      >
        {/* Top: icon + difficulty pill */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: unlocked ? '#FFD700' : diff.color + '22',
              borderWidth: unlocked ? 2 : 0,
              borderColor: '#FFA500',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            {unlocked ? (
              <LottieView
                source={lottieFor(achievement)}
                style={{ width: 38, height: 38 }}
                autoPlay
                loop
                speed={0.8}
              />
            ) : (
              <IconSymbol
                name={(achievement.icon || 'star.fill') as any}
                size={22}
                color={diff.color}
              />
            )}
          </View>
          <View
            style={{
              paddingHorizontal: 7,
              paddingVertical: 3,
              borderRadius: 6,
              backgroundColor: diff.color,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 9,
                color: '#fff',
                letterSpacing: 0.5,
              }}
            >
              {diff.label}
            </Text>
          </View>
        </View>

        {/* Title */}
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 15,
            color: theme.text,
            lineHeight: 18,
            letterSpacing: -0.2,
          }}
        >
          {achievement.name}
        </Text>

        {/* Description */}
        <Text
          numberOfLines={3}
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            color: theme.textSub ?? theme.textMuted,
            lineHeight: 14,
            marginTop: 3,
          }}
        >
          {achievement.description}
        </Text>

        {/* Bottom: done state OR progress.
            Was `flex: 1, justifyContent: flex-end` which pushed
            the progress block hard against the card bottom and
            left a big air gap below the description. Tighter
            stack now: just a small marginTop after the
            description so the eye flows description → progress
            without the awkward void between them. */}
        <View style={{ marginTop: 8 }}>
          {unlocked ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <MaterialCommunityIcons
                name="check-circle"
                size={14}
                color="#4CAF50"
              />
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 11,
                  color: '#4CAF50',
                }}
              >
                +{achievement.points} Pkt
              </Text>
            </View>
          ) : (
            <View>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 4,
                }}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.bold,
                    fontSize: 9,
                    color: theme.textMuted,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                  }}
                >
                  Fortschritt
                </Text>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 11,
                    color: theme.text,
                  }}
                >
                  {/* For savings achievements the target (100 €) is
                      already in the achievement name + description, so
                      "/ 100,00 €" is just clutter. Show only the
                      current value. For count targets ("Scanne 50
                      Produkte") the "X / Y" reading carries
                      proportional info the user actually needs. */}
                  {achievement.trigger?.action === 'savings_total'
                    ? formatProgress(
                        achievement.progress,
                        achievement.trigger?.action,
                      )
                    : `${formatProgress(
                        achievement.progress,
                        achievement.trigger?.action,
                      )} / ${formatProgress(
                        achievement.maxProgress,
                        achievement.trigger?.action,
                      )}`}
                </Text>
              </View>
              <View
                style={{
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: theme.border,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    width: `${Math.max(2, pct)}%`,
                    height: '100%',
                    backgroundColor: diff.color,
                    borderRadius: 3,
                  }}
                />
              </View>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// ────────────────────────────────────────────────────────────────────
// Info bottom-sheet content — rendered inside `FilterSheet` (which
// provides the chrome: title, close button, drag handle, backdrop,
// animations). This component just hosts the four info blocks.
// ────────────────────────────────────────────────────────────────────

function InfoSheetContent() {
  return (
    <View style={{ paddingBottom: 8 }}>
      <InfoBlock
        icon="star-circle"
        title="Levels"
        body="Sammle Punkte und Ersparnisse, um aufzusteigen. Jedes neue Level schaltet weitere Produktkategorien frei (Veggie & Vegan, Getränke, Baby, …)."
      />
      <InfoBlock
        icon="trophy-outline"
        title="Errungenschaften"
        body={
          'Besondere Aufgaben — z. B. „5 Vergleiche ansehen" oder „erste Bewertung schreiben" — geben Bonus-Punkte. Sortiert nach Schwierigkeit (Einfach → Meister).'
        }
      />
      <InfoBlock
        icon="plus-circle-outline"
        title="So sammelst du Punkte"
        body="Produkt scannen +2 · Suchen +1 · Vergleich anschauen +3 · Einkaufszettel abschließen +5 · Bewertung schreiben +2 · erste Aktion +10."
      />
      <InfoBlock
        icon="clock-outline"
        title="Fair-Play-Limits"
        body="Max. 10 Scans + 10 Vergleiche pro Tag, max. 5 Einkaufszettel pro Woche — damit niemand durch die Level rast."
      />
    </View>
  );
}

function InfoBlock({
  icon,
  title,
  body,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  body: string;
}) {
  const { theme } = useTokens();
  return (
    <View style={{ marginBottom: 14 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <MaterialCommunityIcons name={icon} size={16} color={theme.primary} />
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 14,
            color: theme.text,
          }}
        >
          {title}
        </Text>
      </View>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 13,
          lineHeight: 18,
          color: theme.textSub ?? theme.textMuted,
        }}
      >
        {body}
      </Text>
    </View>
  );
}
