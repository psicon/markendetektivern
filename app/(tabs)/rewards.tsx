import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { safePush } from '@/lib/utils/safeNav';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image as RNImage,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { doc, updateDoc } from 'firebase/firestore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CoachmarkOverlay } from '@/components/coachmarks/CoachmarkOverlay';
import { getTour } from '@/components/coachmarks/tours';
import { FilterSheet } from '@/components/design/FilterSheet';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useCoachmark } from '@/hooks/useCoachmark';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useGamificationEnabled } from '@/hooks/useGamificationEnabled';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { useCashbackUserState } from '@/lib/hooks/useCashbackUserState';
import {
  getAggregateUpdatedAt,
  getBundeslandRanks,
  getCityRanks,
  getOverallUsers,
  getUserPosition,
  type LbPosition,
  type LbRow,
  type LbUser,
  userContributionFromProfile,
} from '@/lib/services/leaderboard';
import { useAchievements } from '@/lib/hooks/useAchievements';
import { achievementService } from '@/lib/services/achievementService';
import type { Level } from '@/lib/types/achievements';

// ─── Cashback fallback ─────────────────────────────────────────────────
// Wenn kein User eingeloggt ist (oder das Cashback-Backend offline)
// rendert die UI mit einem 0,00 € Fallback. Live-Werte kommen aus
// `useCashbackUserState()` via Firestore-Snapshot — siehe
// CASHBACK_ARCHITECTURE.md §3.3 (User-Felder).
const CASHBACK_FALLBACK_EUR = 0.0;
const PAYOUT_THRESHOLD = 15.0;

// Shared height for both hero cards (Cashback in Einlösen +
// StatusHero in Bestenliste). Fixed so the page geometry doesn't
// jump on tab swipe. Tuned to fit a TopRow (52 px avatar) +
// gap + up to two ProgressBars + breathing room.
const HERO_HEIGHT = 144;

// The reward catalogue (15+ partner brands) was previously rendered
// inline as a 2-column grid here. Per-product UX moved to a single
// big "Cashback einlösen" CTA below; the catalogue lives behind that
// button on a third-party provider page (separate flow, not
// implemented yet).

const RECEIPT_LIMIT = { perWeek: 6, eurEach: 0.08, usedThisWeek: 2 };
const PHOTO_LIMIT = { perWeek: 20, eurEach: 0.1, usedThisWeek: 14 };
const SURVEY_AVAILABLE = false;

type EarnAction = {
  k: 'survey' | 'receipt' | 'photo';
  i: keyof typeof MaterialCommunityIcons.glyphMap;
  l: string;
  sub: string;
  reward: string;
  available: boolean;
  limitLabel: string;
  limitProgress?: number;
};
const CASHBACK_EARN: EarnAction[] = [
  {
    k: 'survey',
    i: 'poll',
    l: 'Umfrage beantworten',
    sub: 'Nur wenn verfügbar · 2-5 Min',
    reward: '0,20 - 2,00 €',
    available: SURVEY_AVAILABLE,
    limitLabel: SURVEY_AVAILABLE ? 'Verfügbar' : 'Aktuell keine Umfrage',
  },
  {
    k: 'receipt',
    i: 'receipt',
    l: 'Kassenbon hochladen',
    sub: `${RECEIPT_LIMIT.eurEach.toFixed(2).replace('.', ',')} € pro Bon · max. ${RECEIPT_LIMIT.perWeek}/Woche`,
    reward: `${RECEIPT_LIMIT.eurEach.toFixed(2).replace('.', ',')} €`,
    available: RECEIPT_LIMIT.usedThisWeek < RECEIPT_LIMIT.perWeek,
    limitLabel:
      RECEIPT_LIMIT.usedThisWeek < RECEIPT_LIMIT.perWeek
        ? `Noch verfügbar · ${RECEIPT_LIMIT.usedThisWeek}/${RECEIPT_LIMIT.perWeek} diese Woche`
        : `Limit erreicht · ${RECEIPT_LIMIT.perWeek}/${RECEIPT_LIMIT.perWeek} diese Woche`,
    limitProgress: RECEIPT_LIMIT.usedThisWeek / RECEIPT_LIMIT.perWeek,
  },
  {
    k: 'photo',
    i: 'camera-outline',
    l: 'Produktbilder einreichen',
    sub: 'Wizard: 7 Fotos – Front, Rückseite, Barcode, Zutaten, Nährwerte, Hersteller, Preis',
    reward: `${PHOTO_LIMIT.eurEach.toFixed(2).replace('.', ',')} €`,
    available: PHOTO_LIMIT.usedThisWeek < PHOTO_LIMIT.perWeek,
    limitLabel:
      PHOTO_LIMIT.usedThisWeek < PHOTO_LIMIT.perWeek
        ? `Noch verfügbar · ${PHOTO_LIMIT.usedThisWeek}/${PHOTO_LIMIT.perWeek} diese Woche`
        : `Limit erreicht · ${PHOTO_LIMIT.perWeek}/${PHOTO_LIMIT.perWeek} diese Woche`,
    limitProgress: PHOTO_LIMIT.usedThisWeek / PHOTO_LIMIT.perWeek,
  },
];

type QuickAction = {
  k: 'receipt' | 'photo' | 'survey';
  i: keyof typeof MaterialCommunityIcons.glyphMap;
  l: string;
  bg: string;
  dark: boolean;
  reward: string;
};
const QUICK_ACTIONS: QuickAction[] = [
  { k: 'receipt', i: 'receipt', l: 'Kassenbon\nscannen', bg: '#95cfc4', dark: true, reward: '0,08 €' },
  { k: 'photo', i: 'camera-plus-outline', l: 'Produkte\neinreichen', bg: '#a89cdf', dark: true, reward: '0,10 €' },
  { k: 'survey', i: 'poll', l: 'Umfragen', bg: '#dde2e4', dark: false, reward: 'wenn verfügb.' },
];

// ─── Sub-tab plumbing ──────────────────────────────────────────────────
type RewardsTab = 'redeem' | 'ranks';
const HEADER_ROW_HEIGHT = 52;

export default function RewardsScreen() {
  const { theme } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const { user, userProfile } = useAuth();

  // Per-Screen Coachmark.
  const rewardsCoachmark = useCoachmark('rewards');

  // Spielerische Inhalte-Toggle. Wenn aus, blenden wir die
  // Bestenliste-Tab + die Position-Sticky-Bar aus. Cashback-
  // Auszahlung (Einlösen-Tab) bleibt sichtbar — das ist echtes
  // Geld, kein Spielelement.
  const gamificationEnabled = useGamificationEnabled();

  const [tab, setTab] = useState<RewardsTab>('redeem');

  // Wenn der User die Toggle deaktiviert während er gerade auf
  // dem ranks-Tab ist, sollen wir ihn sanft zurück auf redeem
  // schubsen. Sonst wäre der ranks-Page-Slot leer und der
  // Pager visuell konfus.
  useEffect(() => {
    if (!gamificationEnabled && tab === 'ranks') {
      setTab('redeem');
      pagerRef.current?.setPage(0);
    }
  }, [gamificationEnabled, tab]);
  const pagerRef = useRef<PagerView | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // Lifted from RanksTab so the floating PositionStickyBar (rendered
  // OUTSIDE the ScrollView, as a screen-fixed overlay) knows whether
  // to show the user's individual standing or their region's
  // standing. RanksTab still owns all the leaderboard fetching;
  // these two values just decide which "slice" the sticky bar reads.
  const [outerScope, setOuterScope] = useState<LbScopeOuter>('overall');
  const [geo, setGeo] = useState<RegionGeo>('bundesland');

  // Level + userStats lifted up too so both StatusHero (inside
  // RanksTab) AND PositionStickyBar (outside the ScrollView) can
  // colour-tint themselves with the user's current level. Single
  // fetch shared between both.
  const { userStats } = useAchievements();
  const [levels, setLevels] = useState<Level[]>([]);
  useEffect(() => {
    let alive = true;
    achievementService
      .getAllLevels()
      .then((ls) => {
        if (alive) setLevels(ls || []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Tap on a pill → drive PagerView to the matching page (animated
  // page-swipe — UIPageViewController on iOS, ViewPager2 on Android).
  // Swipe gesture in the other direction → onPageSelected reflects
  // back into the pill's `value`. Both stay in lock-step.
  const onTabChange = useCallback((next: RewardsTab) => {
    setTab(next);
    pagerRef.current?.setPage(next === 'redeem' ? 0 : 1);
  }, []);
  const onPageSelected = useCallback(
    (e: { nativeEvent: { position: number } }) => {
      const next: RewardsTab = e.nativeEvent.position === 0 ? 'redeem' : 'ranks';
      setTab((prev) => (prev === next ? prev : next));
    },
    [],
  );

  const chromeHeight = insets.top + HEADER_ROW_HEIGHT + 12 + 40 + 14;

  const ChromeContent = (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: HEADER_ROW_HEIGHT,
        }}
      >
        <Text
          style={{
            flex: 1,
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 26,
            letterSpacing: -0.4,
            color: theme.text,
          }}
        >
          Belohnungen
        </Text>

        <Pressable
          onPress={() => setHelpOpen(true)}
          style={({ pressed }) => ({
            height: 34,
            paddingHorizontal: 12,
            borderRadius: 17,
            backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            opacity: pressed ? 0.7 : 1,
          })}
          hitSlop={6}
        >
          <MaterialCommunityIcons
            name="help-circle-outline"
            size={15}
            color={theme.primary}
          />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 12,
              color: theme.primary,
            }}
          >
            So geht's
          </Text>
        </Pressable>

        <Pressable
          onPress={() =>
            safePush(user ? ('/profile' as any) : ('/auth/welcome' as any))
          }
          style={({ pressed }) => ({
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: theme.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          {(userProfile as any)?.photo_url || user?.photoURL ? (
            <RNImage
              source={{
                uri: ((userProfile as any)?.photo_url || user?.photoURL) as string,
              }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />
          ) : (
            <MaterialCommunityIcons
              name="account-outline"
              size={20}
              color={theme.textMuted}
            />
          )}
        </Pressable>
      </View>

      {/* SegmentedTabs nur wenn Gamification aktiv ist — sonst gibt's
          nur den Einlösen-Tab und ein 1-Item-Segmented-Control wäre
          visuelles Theater. Das chromeHeight bleibt unverändert
          damit das ScrollView-Padding stabil bleibt; statt der Tabs
          ist da einfach nur Atemraum. */}
      {gamificationEnabled ? (
        <SegmentedTabs
          tabs={[
            { key: 'redeem', label: 'Einlösen' },
            { key: 'ranks', label: 'Bestenliste' },
          ] as const}
          value={tab}
          onChange={onTabChange}
        />
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Pages: Einlösen (Cashback — IMMER sichtbar, echtes Geld)
          + Bestenliste (nur wenn Spielerische Inhalte aktiv).
          Wenn aus, läuft PagerView mit nur einem Child — kein
          horizontales Wischen mehr, was richtig ist (es gibt ja
          nichts zum Wischen). */}
      <PagerView
        ref={pagerRef}
        style={{ flex: 1 }}
        initialPage={0}
        onPageSelected={onPageSelected}
        scrollEnabled={gamificationEnabled}
      >
        <View key="redeem" style={{ flex: 1 }}>
          <ScrollView
            scrollsToTop={tab === 'redeem'}
            contentContainerStyle={{
              paddingTop: chromeHeight,
              paddingBottom: 120,
            }}
            showsVerticalScrollIndicator={false}
          >
            <RedeemTab />
          </ScrollView>
        </View>

        {gamificationEnabled ? (
        <View key="ranks" style={{ flex: 1 }}>
          <ScrollView
            scrollsToTop={tab === 'ranks'}
            contentContainerStyle={{
              paddingTop: chromeHeight,
              // Extra room at the bottom: the floating
              // PositionStickyBar sits ~95 px above the safe-area
              // (tab bar + raised Stöbern button), and is itself
              // ~50 px tall. 220 keeps the last list row visible
              // above the bar.
              paddingBottom: 220,
            }}
            showsVerticalScrollIndicator={false}
          >
            <RanksTab
              outerScope={outerScope}
              setOuterScope={setOuterScope}
              geo={geo}
              setGeo={setGeo}
              userStats={userStats}
              levels={levels}
            />
          </ScrollView>
        </View>
        ) : null}
      </PagerView>

      {/* Floating "Deine Position" — only on the Bestenliste tab.
          Rendered as a sibling of the PagerView so it stays put
          against the screen, not the scroll content.
          Wenn Gamification aus, ist Bestenliste eh weg → die
          Sticky-Bar muss auch verschwinden. */}
      {gamificationEnabled && tab === 'ranks' && userProfile ? (
        <PositionStickyBar
          userProfile={userProfile}
          outerScope={outerScope}
          geo={geo}
          userStats={userStats}
          levels={levels}
        />
      ) : null}

      {/* Chrome — absolute from y=0 (covers status-bar zone too) so
          scrolling content doesn't bleed up into the Dynamic Island
          area. paddingTop applies to the chrome material itself, not
          a wrapper above it — that was the bug in v1. */}
      {Platform.OS === 'ios' ? (
        <BlurView
          tint={scheme === 'dark' ? 'dark' : 'light'}
          intensity={80}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            paddingTop: insets.top,
          }}
        >
          {ChromeContent}
        </BlurView>
      ) : (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            paddingTop: insets.top,
            backgroundColor:
              scheme === 'dark'
                ? 'rgba(15,18,20,0.92)'
                : 'rgba(245,247,248,0.92)',
          }}
        >
          {ChromeContent}
        </View>
      )}

      {/* "So geht's" help sheet — same FilterSheet component used
          for the Region-Setup + Achievements info, so all bottom
          sheets in the app share the slide-up animation, drag
          handle, backdrop fade and pan-to-dismiss gesture. */}
      <FilterSheet
        visible={helpOpen}
        title="So funktioniert's"
        onClose={() => setHelpOpen(false)}
      >
        <RewardsHelpContent />
      </FilterSheet>

      {/* Per-Screen Coachmark (Belohnungen). */}
      <CoachmarkOverlay
        tour={getTour('rewards')}
        visible={rewardsCoachmark.visible}
        onDismiss={rewardsCoachmark.dismiss}
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
// EINLÖSEN TAB
// ────────────────────────────────────────────────────────────────────────

function RedeemTab() {
  const { theme } = useTokens();
  // Live cashback state from Firestore. Falls back to 0,00 € when
  // the user isn't signed in or the backend hasn't seeded the field
  // yet (Phase 1 deploys the fields lazy via the Cloud Function).
  const cashback = useCashbackUserState();
  const cashbackEur = cashback.uid
    ? cashback.balanceCents / 100
    : CASHBACK_FALLBACK_EUR;
  const pct = Math.min(
    100,
    Math.round((cashbackEur / PAYOUT_THRESHOLD) * 100),
  );
  const canRedeem = cashbackEur >= PAYOUT_THRESHOLD;
  const gapEur = (PAYOUT_THRESHOLD - cashbackEur)
    .toFixed(2)
    .replace('.', ',');

  // Tap target for "Bon scannen" — routes through consent gate first.
  // If the user already accepted the current consent version we skip
  // straight to the capture screen.
  const onScanBon = useCallback(() => {
    if (!cashback.uid) {
      router.push('/auth/login');
      return;
    }
    if (cashback.hasConsent) {
      router.push('/cashback/capture');
    } else {
      router.push('/cashback/consent');
    }
  }, [cashback.uid, cashback.hasConsent]);

  return (
    <>
      {/* ── Hero: Cashback-Taler ──
          1:1 mirror of the StatusHero on the Bestenliste tab so the
          two heroes have IDENTICAL height + structure (no layout
          jump on tab swipe, both cards read the same way):
            • 52 px circle on the left (money icon ↔ user avatar)
            • Middle column: title + status chip
            • Right column: big number + matching "currency pill"
            • One progress bar (here: payout threshold)
            • Bottom row of three info chips
          The currency pill (💰 CASHBACK-TALER) sits where the
          STATUS-PKT pill sits on the StatusHero — same shape, same
          position, so the user pattern-matches between the two. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <LinearGradient
          colors={['#0a6f62', '#0d8575', '#10a18a']}
          start={{ x: -1, y: 0.34 }}
          end={{ x: 1, y: -0.34 }}
          style={{
            borderRadius: 18,
            paddingHorizontal: 14,
            paddingVertical: 12,
            overflow: 'hidden',
            // Fixed hero height — locks the Cashback hero (Einlösen
            // tab) and the StatusHero (Bestenliste tab) to the SAME
            // total height so the layout doesn't jump on tab swipe.
            // Content inside uses `justifyContent: space-between` so
            // the TopRow sits at the top and the progress bar(s)
            // sit at the bottom, regardless of how much content
            // each card actually has.
            height: HERO_HEIGHT,
          }}
        ><View style={{ flex: 1, justifyContent: 'space-between' }}>
          {/* Top row: 52 px money-icon-circle | title + status chip
              | big balance + currency pill — mirrors StatusHero's
              "avatar | name+level chip | big pts + label" layout. */}
          {/* `alignItems: stretch` makes both content columns
              fill the row's height (= 52 from the avatar). Each
              column then uses `justifyContent: space-between` so
              its pill sits at the BOTTOM. Both pills end up on
              the same baseline → guaranteed alignment. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'stretch',
              gap: 12,
              minHeight: 52,
            }}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: 'rgba(255,255,255,0.22)',
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: 'rgba(255,255,255,0.55)',
              }}
            >
              <MaterialCommunityIcons
                name="cash-multiple"
                size={26}
                color="#ffd44b"
              />
            </View>
            <View
              style={{
                flex: 1,
                minWidth: 0,
                justifyContent: 'space-between',
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 17,
                  color: '#fff',
                  letterSpacing: -0.2,
                }}
              >
                Cashback-Konto
              </Text>
              <HeroPill
                icon={canRedeem ? 'gift-outline' : 'progress-clock'}
                label={
                  canRedeem
                    ? 'Bereit zur Auszahlung'
                    : `Noch ${gapEur} € bis Auszahlung`
                }
              />
            </View>
            <View
              style={{
                alignItems: 'flex-end',
                justifyContent: 'space-between',
              }}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  gap: 2,
                }}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 24,
                    lineHeight: 28,
                    letterSpacing: -0.4,
                    color: '#fff',
                  }}
                >
                  {cashbackEur.toFixed(2).replace('.', ',')}
                </Text>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 14,
                    lineHeight: 20,
                    color: '#fff',
                    opacity: 0.95,
                    marginBottom: 1,
                  }}
                >
                  €
                </Text>
              </View>
              <HeroPill icon="cash" label="Cashback-Taler" />
            </View>
          </View>

          {/* Progress bar to next payout — uses the same `ProgressBar`
              helper as the StatusHero so the two cards literally
              share their progress visual. */}
          <ProgressBar
            icon="gift-outline"
            label={
              canRedeem ? 'Bereit zur Auszahlung' : 'Auszahlungs-Schwelle'
            }
            current={`${cashbackEur.toFixed(2).replace('.', ',')} €`}
            required={`${PAYOUT_THRESHOLD.toFixed(2).replace('.', ',')} €`}
            pct={pct}
          />
          </View>
        </LinearGradient>
      </View>

      {/* ── Quick actions row ── */}
      <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 11,
            color: theme.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            marginBottom: 8,
          }}
        >
          Schnellzugriff · Mehr Taler & Punkte sammeln
        </Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {QUICK_ACTIONS.map((a) => (
            <QuickActionTile
              key={a.k}
              action={a}
              onCashbackTap={a.k === 'receipt' ? onScanBon : undefined}
            />
          ))}
        </View>
      </View>

      {/* ── Earn list ── */}
      <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
        <SectionHeader
          title="Taler verdienen"
          sub="Nur diese Aktionen geben Cashback"
        />
        <View
          style={{
            backgroundColor: theme.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme.border,
            overflow: 'hidden',
            marginTop: 10,
          }}
        >
          {CASHBACK_EARN.map((e, i) => (
            <EarnRow key={e.k} action={e} isFirst={i === 0} />
          ))}
        </View>
      </View>

      {/* ── Einlösen CTA ──
          Single tile, no in-app catalogue. The actual partner picker
          (gift cards / PayPal / Visa / charity) lives on a 3rd-party
          provider page that this button will route to once the
          integration exists. The button is disabled until the user
          has hit the PAYOUT_THRESHOLD; the disabled copy explains
          how much is still missing so the user gets actionable
          feedback instead of a dead CTA. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 28, paddingBottom: 8 }}>
        <View
          style={{
            backgroundColor: theme.surface,
            borderRadius: 18,
            padding: 22,
            borderWidth: 1,
            borderColor: theme.border,
          }}
        >
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
            }}
          >
            <MaterialCommunityIcons
              name="gift-outline"
              size={28}
              color={theme.primary}
            />
          </View>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 22,
              color: theme.text,
              letterSpacing: -0.3,
            }}
          >
            Cashback einlösen
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 14,
              lineHeight: 20,
              color: theme.textSub,
              marginTop: 6,
            }}
          >
            {canRedeem
              ? 'Tausche deine Cashback-Taler bei unseren Partnern gegen Gutscheine (Amazon, Rewe, Apple…), PayPal-Auszahlung, Visa-Prepaid oder Spenden ein.'
              : `Sobald du die ${PAYOUT_THRESHOLD.toFixed(2).replace('.', ',')} €-Schwelle erreichst, kannst du deine Taler hier einlösen — bei Gutschein-Partnern, PayPal, Visa-Prepaid oder als Spende.`}
          </Text>

          <Pressable
            disabled={!canRedeem}
            onPress={() => {
              // 3rd-party provider integration goes here.
            }}
            style={({ pressed }) => ({
              marginTop: 18,
              height: 52,
              borderRadius: 14,
              backgroundColor: canRedeem ? theme.primary : theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              opacity: pressed && canRedeem ? 0.9 : 1,
            })}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 15,
                color: canRedeem ? '#fff' : theme.textMuted,
                letterSpacing: 0.2,
              }}
            >
              {canRedeem
                ? 'Jetzt einlösen'
                : `Noch ${gapEur} € sammeln`}
            </Text>
            {canRedeem ? (
              <MaterialCommunityIcons
                name="arrow-right"
                size={18}
                color="#fff"
              />
            ) : null}
          </Pressable>

          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 11,
              color: theme.textMuted,
              marginTop: 10,
              textAlign: 'center',
            }}
          >
            Auswahl der Belohnungen erfolgt extern bei unserem Partner.
          </Text>
        </View>
      </View>
    </>
  );
}

// ─── "So geht's" help sheet content ─────────────────────────────────────
//
// Rendered inside the shared `FilterSheet` (which provides chrome:
// drag handle, title row, animations, backdrop). The body is split
// into TWO sections matching the screen's two tabs:
//   • Einlösen — Cashback-Taler model + earn methods + payout
//   • Bestenliste — Detektiv-Punkte, Levels, Streak, Liga
// Each section gets a small icon-prefix header so the user can
// jump straight to the half they care about.

function RewardsHelpContent() {
  return (
    <View style={{ paddingBottom: 8 }}>
      {/* ── Einlösen / Cashback-Taler ── */}
      <HelpSectionHeader
        icon="treasure-chest"
        title="Einlösen — Cashback-Taler"
      />
      <HelpBlock
        icon="treasure-chest"
        iconColor="#0d8575"
        title="Cashback-Taler"
        body="Sammle Cashback-Taler bei jeder Aktion (Bons hochladen, Produktbilder einreichen, Umfragen beantworten). Ab 15 € Guthaben kannst du auszahlen lassen."
      />
      <HelpBlock
        icon="receipt"
        iconColor="#95cfc4"
        title="Kassenbon hochladen"
        body="0,08 € pro Bon, max. 6 Bons pro Woche. Wir erkennen automatisch den Markt und die gekauften Produkte für unsere Markt-Insights."
      />
      <HelpBlock
        icon="camera-outline"
        iconColor="#a89cdf"
        title="Produktbilder einreichen"
        body="0,10 € pro Produkt-Set (7 Fotos: Front, Rückseite, Barcode, Zutaten, Nährwerte, Hersteller, Preis). Hilft uns, die Datenbank vollständig zu halten."
      />
      <HelpBlock
        icon="poll"
        iconColor="#dde2e4"
        title="Umfragen"
        body="0,20 € – 2,00 € je nach Länge. Nur verfügbar, wenn gerade eine passende Umfrage aktiv ist — wir benachrichtigen dich automatisch."
      />
      <HelpBlock
        icon="gift-outline"
        iconColor="#0d8575"
        title="Auszahlung"
        body="Tausche dein Cashback bei unseren Partnern in Gutscheine (Amazon, Rewe, Apple…), eine PayPal-Auszahlung, eine Visa-Prepaid oder eine Spende um."
      />

      {/* ── Bestenliste / Detektiv-Punkte ── */}
      <HelpSectionHeader
        icon="trophy-outline"
        title="Bestenliste — Detektiv-Punkte"
      />
      <HelpBlock
        icon="star-four-points"
        iconColor="#f5b301"
        title="Detektiv-Punkte sammeln"
        body="Produkt scannen +2 · Suchen +1 · Vergleich anschauen +3 · Einkaufszettel abschließen +5 · Bewertung schreiben +2 · erste Aktion +10."
      />
      <HelpBlock
        icon="star-circle"
        iconColor="#bf8636"
        title="Levels & Aufstieg"
        body="Mit Punkten und Ersparnissen steigst du im Level auf. Jedes Level schaltet eine neue Produktkategorie frei (Veggie, Getränke, Baby, …)."
      />
      <HelpBlock
        icon="fire"
        iconColor="#ffb84a"
        title="Streak & Freezes"
        body="Sei jeden Tag aktiv und deine Streak wächst. Verpasst du einen Tag, schützt dich ein Freeze-Token (alle 14 Tage gibt's einen, max. 2 gleichzeitig)."
      />
      <HelpBlock
        icon="map-marker-radius"
        iconColor="#0d6efd"
        title="Liga & Region"
        body="In der Bestenliste vergleichst du dich mit ganz Deutschland — als einzelner Detektiv (Overall) oder als Region (Bundesländer + Städte). Wird täglich aktualisiert."
      />
    </View>
  );
}

function HelpSectionHeader({
  icon,
  title,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
}) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 14,
        // Extra top-margin only when this header doesn't sit at the
        // very top of the sheet (i.e. for the second section). The
        // first one already has padding via FilterSheet content.
        marginTop: 4,
      }}
    >
      <MaterialCommunityIcons name={icon} size={16} color={theme.primary} />
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 13,
          color: theme.primary,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
        }}
      >
        {title}
      </Text>
      <View
        style={{
          flex: 1,
          height: 1,
          backgroundColor: theme.border,
          marginLeft: 4,
        }}
      />
    </View>
  );
}

function HelpBlock({
  icon,
  iconColor,
  title,
  body,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconColor: string;
  title: string;
  body: string;
}) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 12,
        marginBottom: 14,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: theme.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        <MaterialCommunityIcons name={icon} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 14,
            color: theme.text,
            marginBottom: 2,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 12,
            lineHeight: 17,
            color: theme.textSub ?? theme.textMuted,
          }}
        >
          {body}
        </Text>
      </View>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
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
      {sub ? (
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 12,
            color: theme.textMuted,
          }}
        >
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function QuickActionTile({ action, onCashbackTap }: { action: QuickAction; onCashbackTap?: () => void }) {
  const fg = action.dark ? '#fff' : '#191c1d';
  return (
    <Pressable
      onPress={() => {
        if (action.k === 'receipt') {
          if (onCashbackTap) {
            onCashbackTap();
          } else {
            safePush('/barcode-scanner' as any);
          }
        }
        // photo + survey wire up later
      }}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 112,
        backgroundColor: action.bg,
        borderRadius: 14,
        padding: 12,
        justifyContent: 'space-between',
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          backgroundColor: action.dark ? 'rgba(255,255,255,0.22)' : '#fff',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons
          name={action.i}
          size={17}
          color={action.dark ? '#fff' : '#0d8575'}
        />
      </View>
      <View>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 12,
            lineHeight: 14,
            color: fg,
          }}
        >
          {action.l}
        </Text>
        <View
          style={{
            alignSelf: 'flex-start',
            marginTop: 6,
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 4,
            backgroundColor: action.dark
              ? 'rgba(255,255,255,0.2)'
              : 'rgba(13,133,117,0.14)',
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 9,
              letterSpacing: 0.4,
              color: action.dark ? '#fff' : '#0d8575',
            }}
          >
            {action.reward}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function EarnRow({
  action,
  isFirst,
}: {
  action: EarnAction;
  isFirst: boolean;
}) {
  const { theme } = useTokens();
  return (
    <Pressable
      onPress={() => {
        if (action.k === 'receipt') safePush('/barcode-scanner' as any);
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        padding: 12,
        paddingHorizontal: 14,
        borderTopWidth: isFirst ? 0 : 1,
        borderTopColor: theme.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 2,
        }}
      >
        <MaterialCommunityIcons
          name={action.i}
          size={20}
          color={theme.primary}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <Text
            style={{
              flex: 1,
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 14,
              color: theme.text,
            }}
            numberOfLines={1}
          >
            {action.l}
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 12,
              color: theme.primary,
            }}
          >
            {action.reward}
          </Text>
        </View>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            lineHeight: 15,
            color: theme.textMuted,
            marginTop: 2,
          }}
        >
          {action.sub}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            marginTop: 7,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 7,
              paddingVertical: 2,
              borderRadius: 4,
              backgroundColor: action.available
                ? theme.primaryContainer ?? theme.surfaceAlt
                : 'rgba(220,38,38,0.1)',
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: action.available ? '#16a34a' : '#dc2626',
              }}
            />
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 10,
                letterSpacing: 0.3,
                color: action.available ? theme.primary : '#dc2626',
              }}
            >
              {action.limitLabel}
            </Text>
          </View>
          {typeof action.limitProgress === 'number' ? (
            <View
              style={{
                flex: 1,
                height: 4,
                backgroundColor: theme.border,
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${Math.min(100, Math.round(action.limitProgress * 100))}%`,
                  height: '100%',
                  backgroundColor: action.available ? theme.primary : '#dc2626',
                }}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}



// ════════════════════════════════════════════════════════════════════════
// BESTENLISTE (Rewards Tab "Bestenliste")
// ════════════════════════════════════════════════════════════════════════
//
// Structure:
//   [Overall | Regionenkampf]            ← top scope (PagerView, swipe)
//
//   Overall:                              | Regionenkampf:
//     [Punkte | Ersparnisse]              |   [Bundesländer | Städte]
//     [Legendär | Champion | Rising Star] |   [Legendär | Champion | Rising Star]
//     [Yellow Hero context card]          |   [Yellow Hero card]
//     [Top-3 medal podium]                |   [Top-3 medal podium]
//     [Rank 4+ list]                      |   [Rank 4+ list]
//     [Refresh hint]                      |   [Refresh hint]
//     [Deine Position card]               |   [Deine Position card]
//
// Data: ONE Firestore doc (aggregates/leaderboard_v1) prebuilt by the
// Cloud Function (cloud-functions/leaderboard-aggregator) every night
// at 03:00 Berlin time. App reads once per session and caches in
// memory — instant on Tab open.
//
// Periods:
//   • Legendär (Aller Zeiten) — real data, populated today
//   • Champion (Dieses Jahr) — empty state, Cloud Function will add
//     yearly counters once we deploy that schema upgrade
//   • Rising Star (Diese Woche) — same; weekly rolling counter

type LbScopeOuter = 'overall' | 'region';
type OverallMetric = 'pts' | 'eur';
type RegionGeo = 'bundesland' | 'stadt';
// 'year' (Champion) was dropped — month + week cover the
// motivational use case, year would duplicate lifetime visually.
type Period = 'all' | 'month' | 'week';

// How many overall-users to show on first paint. "Mehr laden" reveals
// the next chunk in 10-row jumps. Lifetime list goes up to top-100;
// live week/month lists are capped at 50 server-side.
const INITIAL_VISIBLE = 10;
const LOAD_MORE_STEP = 10;

function RanksTab({
  outerScope,
  setOuterScope,
  geo,
  setGeo,
  userStats,
  levels,
}: {
  outerScope: LbScopeOuter;
  setOuterScope: (v: LbScopeOuter) => void;
  geo: RegionGeo;
  setGeo: (v: RegionGeo) => void;
  userStats: ReturnType<typeof useAchievements>['userStats'];
  levels: Level[];
}) {
  const { theme } = useTokens();
  const { user, userProfile, refreshUserProfile } = useAuth();

  const userBL: string | null =
    (userProfile as any)?.bundesland ??
    (userProfile as any)?.guessedBundesland ??
    null;
  const userCity: string | null =
    (userProfile as any)?.city ??
    (userProfile as any)?.guessedCity ??
    null;
  const userNick = userProfile?.display_name ?? null;
  const hasExplicitCity = !!(userProfile as any)?.city;

  // ─── Outer scope: Overall | Regionenkampf ──────────
  // `outerScope`/`geo` are controlled from RewardsScreen so the
  // floating PositionStickyBar (rendered outside this ScrollView)
  // can read them. Pure state-driven (no inner PagerView).
  const onOuterChange = (next: LbScopeOuter) => {
    setOuterScope(next);
  };

  // ─── Overall: metric + period ─────────────────────────────────
  const [metric, setMetric] = useState<OverallMetric>('pts');
  const [overallPeriod, setOverallPeriod] = useState<Period>('all');

  // ─── Regionenkampf: metric ────────────────────────────────────
  // No period switcher here — region duels are always lifetime
  // ("Aller Zeiten"). The two axes the user wants to compare are
  // BL vs City (lifted state) and Punkte vs Ersparnis (local).
  const [regionMetric, setRegionMetric] = useState<OverallMetric>('pts');

  // ─── Data ─────────────────────────────────────────────────────
  // The user's own percentile + motivational message used to live
  // here so the StatusHero could show it. Now that it lives only in
  // the floating PositionStickyBar (which fetches it itself), we
  // don't need the state in this tab anymore.
  const [overallUsers, setOverallUsers] = useState<LbUser[]>([]);
  const [blRows, setBlRows] = useState<LbRow[]>([]);
  const [cityRows, setCityRows] = useState<LbRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  // How many of the overall-list rows are revealed. Reset whenever
  // the metric/period changes so we don't carry over a "show all"
  // state into a list that doesn't have those rows yet.
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [metric, overallPeriod]);

  useEffect(() => {
    let alive = true;
    getOverallUsers(userNick, overallPeriod, metric).then(
      (r) => alive && setOverallUsers(r),
    );
    return () => {
      alive = false;
    };
  }, [userNick, metric, overallPeriod]);

  useEffect(() => {
    let alive = true;
    if (geo === 'bundesland') {
      getBundeslandRanks(userBL, 'all', regionMetric).then(
        (r) => alive && setBlRows(r),
      );
    } else {
      getCityRanks(userCity, 'all', regionMetric).then(
        (r) => alive && setCityRows(r),
      );
    }
    return () => {
      alive = false;
    };
  }, [userBL, userCity, geo, regionMetric]);

  useEffect(() => {
    getAggregateUpdatedAt().then(setUpdatedAt);
  }, []);

  const contribution = userContributionFromProfile(userProfile);

  const [setupOpen, setSetupOpen] = useState(false);
  const saveRegion = useCallback(
    async (bl: string, city: string) => {
      if (!user?.uid) return;
      try {
        await updateDoc(doc(db, 'users', user.uid), { bundesland: bl, city });
        await refreshUserProfile();
      } catch (e) {
        console.warn('Rewards: saveRegion failed', e);
      }
    },
    [user?.uid, refreshUserProfile],
  );

  // The user's rank within the region lists — used by the
  // "Deine Position" card on the Regionenkampf side. Overall uses
  // `position` from getUserPosition() instead, which can interpolate
  // beyond the top-100.
  const userBLRank = blRows.find((r) => r.isMe)?.rank ?? null;
  const userCityRank = cityRows.find((r) => r.isMe)?.rank ?? null;

  return (
    <>
      {/* ─── Status-Hero: user's own level / pts / streak ───
          The first thing on the Bestenliste page so the user is
          oriented to THEIR own context before scanning the rankings.
          Mirrors the prototype's green status card.

          Reads from the SAME sources as the legacy /achievements
          screen: `useAchievements()` for currentLevel/streak/freeze,
          `achievementService.getAllLevels()` for the next-level
          threshold so the progress bar reflects the real curve. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <StatusHero
          name={userProfile?.display_name ?? 'Detektiv'}
          photoUrl={(userProfile as any)?.photo_url ?? null}
          userStats={userStats}
          userProfile={userProfile}
          levels={levels}
        />
      </View>

      {/* ─── Outer scope: 2 SCOPE-CARDS (NOT pills) ───
          Card-style selector visually distinct from the parent
          "Einlösen | Bestenliste" pill, so we don't have stacked
          identical-looking tab rows. Same family as the period
          cards below. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <ScopeCard
            active={outerScope === 'overall'}
            onPress={() => onOuterChange('overall')}
            icon="account-multiple"
            title="Overall"
            sub="Detektive Deutschland"
          />
          <ScopeCard
            active={outerScope === 'region'}
            onPress={() => onOuterChange('region')}
            icon="map-marker-radius"
            title="Regionenkampf"
            sub="Städte vs. Bundesländer"
          />
        </View>
      </View>

      {/* Setup nudge — only when explicit city not set yet (Regionenkampf
          works without it via guessedCity, but the user gets a softer
          "Wo wohnst du?" hint that gives them a better DU-highlight.) */}
      {!hasExplicitCity ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <SetupNudge
            guessedCity={userCity}
            onPress={() => setSetupOpen(true)}
          />
        </View>
      ) : null}

      {/* ─── Outer pager (Overall / Regionenkampf) ─── */}
      {/* No inner PagerView — its fixed height was clipping content
          and swallowing the parent ScrollView's vertical gesture, so
          users couldn't scroll the leaderboard. ScopeCards above
          drive `outerScope` directly via state. */}
      {outerScope === 'overall' ? (
        <View>
          <View style={{ paddingTop: 10 }}>
            <PeriodSwitcher value={overallPeriod} onChange={setOverallPeriod} />
          </View>
          <HeroBanner
            icon={metric === 'pts' ? 'trophy' : 'cash-multiple'}
            title={metric === 'pts' ? 'Punkte Bestenliste' : 'Ersparnis-Bestenliste'}
            inlineSelector={
              <InlineToggle
                value={metric}
                onChange={setMetric}
                options={[
                  { key: 'pts', label: 'Punkte' },
                  { key: 'eur', label: 'Ersparnisse' },
                ]}
              />
            }
          />
          <UserBoard
            users={overallUsers}
            metric={metric}
            period={overallPeriod}
            visibleCount={visibleCount}
            onLoadMore={() =>
              setVisibleCount((c) =>
                Math.min(c + LOAD_MORE_STEP, overallUsers.length),
              )
            }
          />
        </View>
      ) : (
        <View>
          {/* BL vs Städte — primary axis. Pill row at the top of
              the region tab, replacing the period switcher (region
              duels are always lifetime). */}
          <View style={{ paddingTop: 10, paddingHorizontal: 20 }}>
            <RegionGeoSwitch value={geo} onChange={setGeo} />
          </View>
          <HeroBanner
            icon={geo === 'bundesland' ? '🗺️' : '🏙️'}
            title={geo === 'bundesland' ? 'Bundesländer-Liga' : 'Städte-Liga'}
            inlineSelector={
              <InlineToggle
                value={regionMetric}
                onChange={setRegionMetric}
                options={[
                  { key: 'pts', label: 'Punkte' },
                  { key: 'eur', label: 'Ersparnisse' },
                ]}
              />
            }
          />
          <RegionBoard
            rows={geo === 'bundesland' ? blRows : cityRows}
            metric={regionMetric}
            showBundesland={geo === 'stadt'}
            myRank={geo === 'bundesland' ? userBLRank : userCityRank}
            myLabel={geo === 'bundesland' ? userBL : userCity}
          />
        </View>
      )}

      {/* Errungenschaften leben jetzt komplett auf /achievements
          (erreichbar über den StatusHero oben). Hält die Bestenliste
          fokussiert auf die Liga und vermeidet eine zweite schwere
          Sektion mit Lottie-Loops auf demselben Screen. */}

      <RefreshHint updatedAt={updatedAt} />

      {/* ─── Region-Setup-Sheet ─── */}
      <FilterSheet
        visible={setupOpen}
        title="Spiel für deine Stadt"
        onClose={() => setSetupOpen(false)}
      >
        <RegionSetupContent
          suggestion={{ city: userCity, bundesland: userBL }}
          onAccept={async () => {
            if (userBL && userCity) await saveRegion(userBL, userCity);
            setSetupOpen(false);
          }}
          onPickOther={() => setSetupOpen(false)}
        />
      </FilterSheet>
    </>
  );
}

// ─── Setup nudge (kept) ─────────────────────────────────────────────────

function SetupNudge({
  guessedCity,
  onPress,
}: {
  guessedCity: string | null;
  onPress: () => void;
}) {
  const { theme } = useTokens();
  const text = guessedCity
    ? `Du in ${guessedCity}? Bestätige deine Stadt und sammle für sie.`
    : 'Wähle deine Stadt und spiel mit deiner Region in der Liga.';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
        borderRadius: 14,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: theme.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons
          name="map-marker-radius"
          size={20}
          color={theme.primary}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 13,
            color: theme.text,
          }}
        >
          Spiel für deine Stadt
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            color: theme.textSub,
            marginTop: 2,
          }}
        >
          {text}
        </Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={18}
        color={theme.textMuted}
      />
    </Pressable>
  );
}

// ─── Period switcher (3 wide pills with subtitle) ───────────────────────

function PeriodSwitcher({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  // Same `ScopeCard` design as Outer-Scope (Overall/Regionenkampf)
  // and RegionGeoSwitch (Bundesländer/Städte). One selector, three
  // contexts — guarantees consistency across the page.
  const items: { key: Period; emoji: string; title: string; sub: string }[] = [
    { key: 'all', emoji: '👑', title: 'Legendär', sub: 'Aller Zeiten' },
    { key: 'month', emoji: '⭐', title: 'Rising Star', sub: 'Dieser Monat' },
    { key: 'week', emoji: '🔥', title: 'On Fire', sub: 'Diese Woche' },
  ];
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 20,
      }}
    >
      {items.map((it) => (
        <ScopeCard
          key={it.key}
          active={value === it.key}
          onPress={() => onChange(it.key)}
          icon={it.emoji}
          title={it.title}
          sub={it.sub}
        />
      ))}
    </View>
  );
}

// ─── Yellow hero banner ─────────────────────────────────────────────────

function HeroBanner({
  icon,
  title,
  subtitle,
  inlineSelector,
}: {
  /** Either an MDI icon name OR an emoji string. Emojis read more
   *  consistently with the rest of the page (period switcher,
   *  podium medals, etc.); MDI is kept for legacy callers. */
  icon: keyof typeof MaterialCommunityIcons.glyphMap | string;
  title: string;
  /** Optional one-liner under the title. Omit when the title +
   *  selector together already make the context clear (the
   *  selector labels say "Punkte / Ersparnisse" anyway). */
  subtitle?: string;
  /** Optional inline metric/geo selector rendered at the bottom of
   *  the hero — keeps the metric-switch in context without a third
   *  separate tab row. */
  inlineSelector?: React.ReactNode;
}) {
  return (
    <LinearGradient
      colors={['#ffd34a', '#f5a623']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        marginHorizontal: 20,
        marginTop: 10,
        borderRadius: 14,
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {/* Heuristic: short non-MDI strings are treated as emoji.
            All MDI glyph names contain a hyphen ("trophy-outline",
            "cash-multiple", "map-marker-radius", …) so anything
            without one is rendered as text. */}
        {typeof icon === 'string' && !icon.includes('-') && icon.length <= 4 ? (
          <Text style={{ fontSize: 18 }}>{icon}</Text>
        ) : (
          <MaterialCommunityIcons
            name={icon as keyof typeof MaterialCommunityIcons.glyphMap}
            size={20}
            color="#5a3500"
          />
        )}
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 14,
              color: '#1a1a1a',
              letterSpacing: -0.1,
            }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              numberOfLines={1}
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 11,
                color: '#3a3a3a',
                marginTop: 1,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {inlineSelector ? <View style={{ marginTop: 8 }}>{inlineSelector}</View> : null}
    </LinearGradient>
  );
}

// ─── Scope card (Overall / Regionenkampf top selector) ──────────────────

// Single selector card used by EVERY selector on the rewards
// screen (Outer scope: Overall/Regionenkampf, Period:
// Legendär/Rising Star/On Fire, Region geo: Bundesländer/Städte).
// Accepts either an MDI icon name (rendered in a coloured circle)
// or a short emoji string (rendered as plain text). One component
// → one design, no visual drift between selectors.
function ScopeCard({
  active,
  onPress,
  icon,
  title,
  sub,
}: {
  active: boolean;
  onPress: () => void;
  /** MDI glyph name (contains a hyphen, e.g. "map-marker-radius")
   *  → rendered in a coloured icon-circle. Otherwise treated as
   *  a literal emoji string (e.g. "👑", "🔥") → rendered as text. */
  icon: keyof typeof MaterialCommunityIcons.glyphMap | string;
  title: string;
  sub: string;
}) {
  const { theme, shadows } = useTokens();
  const isEmoji =
    typeof icon === 'string' && !icon.includes('-') && icon.length <= 4;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 50,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: active
          ? theme.primaryContainer ?? theme.surfaceAlt
          : theme.surface,
        borderWidth: active ? 1.5 : 1,
        borderColor: active ? theme.primary : theme.border,
        opacity: pressed ? 0.92 : 1,
        ...(active ? shadows.sm : {}),
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {isEmoji ? (
          <Text style={{ fontSize: 18 }}>{icon as string}</Text>
        ) : (
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: active ? theme.primary : theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MaterialCommunityIcons
              name={icon as keyof typeof MaterialCommunityIcons.glyphMap}
              size={14}
              color={active ? '#fff' : theme.primary}
            />
          </View>
        )}
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 13,
            color: theme.text,
            flex: 1,
          }}
        >
          {title}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 10,
          color: theme.textMuted,
          marginTop: 2,
        }}
      >
        {sub}
      </Text>
    </Pressable>
  );
}

// ─── Inline metric/geo toggle (lives inside the yellow hero) ────────────

function InlineToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (key: T) => void;
  options: readonly { key: T; label: string }[];
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: 'rgba(0,0,0,0.08)',
        borderRadius: 10,
        padding: 3,
        gap: 3,
      }}
    >
      {options.map((opt) => {
        const on = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            onPress={() => onChange(opt.key)}
            style={({ pressed }) => ({
              flex: 1,
              height: 30,
              borderRadius: 8,
              backgroundColor: on ? '#fff' : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 12,
                color: on ? '#1a1a1a' : '#3a3a3a',
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Coming-soon state for periods we don't have data for yet ───────────

function PeriodComingSoon({ period }: { period: Exclude<Period, 'all'> }) {
  const { theme } = useTokens();
  const COPY: Record<Exclude<Period, 'all'>, { icon: string; title: string; body: string }> = {
    month: {
      icon: '⭐',
      title: 'Rising-Star-Liga öffnet bald',
      body: 'Wer sammelt im laufenden Monat die meisten Punkte? Schalten wir sehr bald frei.',
    },
    week: {
      icon: '🔥',
      title: 'On-Fire-Liga öffnet bald',
      body: 'Wer ist diese Woche besonders aktiv? Wochenliga startet sehr bald.',
    },
  };
  const copy = COPY[period];
  return (
    <View
      style={{
        marginHorizontal: 20,
        marginTop: 18,
        padding: 22,
        backgroundColor: theme.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.border,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: 38, marginBottom: 10 }}>{copy.icon}</Text>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 16,
          color: theme.text,
          textAlign: 'center',
        }}
      >
        {copy.title}
      </Text>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 13,
          lineHeight: 18,
          color: theme.textMuted,
          textAlign: 'center',
          marginTop: 6,
        }}
      >
        {copy.body}
      </Text>
    </View>
  );
}

// ─── Refresh hint (best-practice motivation row) ────────────────────────

function RefreshHint({ updatedAt }: { updatedAt: Date | null }) {
  const { theme } = useTokens();
  const stand = updatedAt
    ? `${updatedAt.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
      })}, ${updatedAt.toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : 'gleich';
  return (
    <View
      style={{
        marginHorizontal: 20,
        marginTop: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <MaterialCommunityIcons
        name="autorenew"
        size={14}
        color={theme.textMuted}
      />
      <Text
        style={{
          flex: 1,
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 11,
          lineHeight: 16,
          color: theme.textMuted,
        }}
      >
        Wird täglich um 03:00 aktualisiert · Stand: {stand}. Komm morgen
        wieder rein und sammle Punkte!
      </Text>
    </View>
  );
}

// ─── User leaderboard board (Overall) ───────────────────────────────────

function UserBoard({
  users,
  metric,
  period,
  visibleCount,
  onLoadMore,
}: {
  users: LbUser[];
  metric: OverallMetric;
  period: Period;
  /** Total visible rows including the top-3 podium (so 10 means
   *  podium for #1–3 + list rows #4–10). */
  visibleCount: number;
  onLoadMore: () => void;
}) {
  const { theme } = useTokens();
  if (users.length === 0) {
    // For lifetime ('all') we treat empty as "still loading" — the
    // doc fetch in fetchSnapshot is in-flight. For period-windowed
    // lists, empty is a valid state (no activity in that window
    // for anyone) — say so honestly so the user doesn't think the
    // UI is broken.
    const periodLabels: Record<Period, string> = {
      all: 'Liga lädt …',
      month: 'Noch keine Aktivität in diesem Monat.',
      week: 'Noch keine Aktivität in dieser Woche.',
    };
    return (
      <View style={{ padding: 40, alignItems: 'center' }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 13,
            color: theme.textMuted,
            textAlign: 'center',
          }}
        >
          {periodLabels[period]}
        </Text>
      </View>
    );
  }
  const hasPodium = users.length >= 3;
  const top3 = hasPodium ? users.slice(0, 3) : [];
  const rest = hasPodium ? users.slice(3, visibleCount) : users.slice(0, visibleCount);
  const canLoadMore = visibleCount < users.length;
  const remaining = users.length - visibleCount;
  return (
    <>
      {hasPodium ? <Podium top3={top3} metric={metric} /> : null}
      <View
        style={{
          marginHorizontal: 20,
          marginTop: hasPodium ? 18 : 14,
          gap: 10,
        }}
      >
        {rest.map((u) => (
          <UserCard key={u.id} user={u} metric={metric} />
        ))}
      </View>
      {canLoadMore ? (
        <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
          <Pressable
            onPress={onLoadMore}
            style={({ pressed }) => ({
              height: 46,
              borderRadius: 12,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 13,
                color: theme.primary,
              }}
            >
              Mehr laden
            </Text>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 11,
                color: theme.textMuted,
              }}
            >
              · noch {remaining}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {/* "Deine Position" lives in the floating PositionStickyBar
          at the bottom of the page — see RewardsScreen render. */}
    </>
  );
}

// ─── Single user card ───────────────────────────────────────────────────

function UserCard({ user, metric }: { user: LbUser; metric: OverallMetric }) {
  const { theme, shadows } = useTokens();
  const isTop3 = user.rank <= 3;
  const value =
    metric === 'pts'
      ? `${user.pts.toLocaleString('de-DE')} Pkt`
      : `${user.eur.toFixed(2).replace('.', ',')} €`;
  const subValue =
    metric === 'pts'
      ? `${user.eur.toFixed(2).replace('.', ',')} € gespart`
      : `${user.pts.toLocaleString('de-DE')} Pkt`;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: user.isMe
          ? theme.primaryContainer ?? theme.surfaceAlt
          : theme.surface,
        borderRadius: 14,
        padding: 12,
        ...shadows.sm,
      }}
    >
      <RankBadge rank={user.rank} />
      <UserAvatar name={user.name} photoUrl={user.photoUrl} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 15,
            color: theme.text,
          }}
        >
          {user.name}
          {user.isMe ? (
            <Text style={{ color: theme.primary }}> · Du</Text>
          ) : null}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            color: theme.textMuted,
            marginTop: 2,
          }}
        >
          {user.level ? `Level ${user.level} · ` : ''}
          {subValue}
        </Text>
      </View>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 15,
          color: theme.primary,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function UserAvatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const { theme } = useTokens();
  if (photoUrl) {
    return (
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          overflow: 'hidden',
          backgroundColor: theme.surfaceAlt,
        }}
      >
        {/* eslint-disable-next-line @typescript-eslint/no-require-imports */}
        <RNImage source={{ uri: photoUrl }} style={{ width: '100%', height: '100%' }} />
      </View>
    );
  }
  const initial = name?.[0]?.toUpperCase() ?? '?';
  // Deterministic colour per first letter so the same user keeps the
  // same colour across renders.
  const palette = ['#0d8575', '#1f5e96', '#a32d6f', '#c2462b', '#7a4a9a', '#345a3a'];
  const idx = (initial.charCodeAt(0) || 0) % palette.length;
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: palette[idx],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 16,
          color: '#fff',
        }}
      >
        {initial}
      </Text>
    </View>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const { theme } = useTokens();
  if (rank <= 3) {
    // Medal style: gradient-tinted disc + ribbon-look notch on top.
    // Centred big number in white. Distinctly different from the
    // grey rank-N pill below.
    const tint = rank === 1 ? '#f5b301' : rank === 2 ? '#a3adb1' : '#c98a51';
    const tintDark = rank === 1 ? '#bf8636' : rank === 2 ? '#6f7a7e' : '#955f33';
    return (
      <View style={{ width: 38, alignItems: 'center' }}>
        {/* Ribbons (two angled stripes that peek above the medal) */}
        <View style={{ flexDirection: 'row', height: 8, marginBottom: -4, zIndex: 0 }}>
          <View
            style={{
              width: 8,
              height: 14,
              backgroundColor: '#dc3545',
              transform: [{ skewX: '-12deg' }],
              marginRight: 6,
            }}
          />
          <View
            style={{
              width: 8,
              height: 14,
              backgroundColor: '#0d6efd',
              transform: [{ skewX: '12deg' }],
            }}
          />
        </View>
        {/* Medal disc */}
        <LinearGradient
          colors={[tint, tintDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 13,
              color: '#fff',
            }}
          >
            {rank}
          </Text>
        </LinearGradient>
      </View>
    );
  }
  return (
    <View
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: theme.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 14,
          color: theme.textMuted,
        }}
      >
        {rank}
      </Text>
    </View>
  );
}

// ─── Region leaderboard ─────────────────────────────────────────────────

// Top-N region rows shown (incl. the 3 podium rows). Bundesländer
// max out at 16 anyway — the slice is a no-op for that scope.
const REGION_TOP_N = 20;

function RegionBoard({
  rows,
  metric,
  showBundesland,
  myRank,
  myLabel,
}: {
  rows: LbRow[];
  metric: OverallMetric;
  showBundesland?: boolean;
  myRank: number | null;
  myLabel: string | null;
}) {
  const { theme } = useTokens();
  if (rows.length === 0) {
    return (
      <View style={{ padding: 40, alignItems: 'center' }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 13,
            color: theme.textMuted,
          }}
        >
          Liga lädt …
        </Text>
      </View>
    );
  }
  const visible = rows.slice(0, REGION_TOP_N);
  const hasPodium = visible.length >= 3;
  const top3 = hasPodium ? visible.slice(0, 3) : [];
  const rest = hasPodium ? visible.slice(3) : visible;
  return (
    <>
      {hasPodium ? (
        <RegionPodium top3={top3} metric={metric} isCity={!!showBundesland} />
      ) : null}
      <View
        style={{
          marginHorizontal: 20,
          marginTop: hasPodium ? 18 : 14,
          gap: 10,
        }}
      >
        {rest.map((r) => (
          <RegionCard
            key={r.key}
            row={r}
            metric={metric}
            showBundesland={showBundesland}
          />
        ))}
      </View>
      <DeinePositionRegionCard
        rank={myRank}
        label={myLabel}
        total={rows.length}
      />
    </>
  );
}

// ─── Bundesländer | Städte primary switcher ─────────────────────────────
//
// Two equal-width pills at the top of the region tab. Visually
// distinct from the inline pts/eur toggle inside the HeroBanner so
// the user reads the hierarchy "first WHO is competing, then WHAT
// metric we're comparing".

function RegionGeoSwitch({
  value,
  onChange,
}: {
  value: RegionGeo;
  onChange: (v: RegionGeo) => void;
}) {
  // Same `ScopeCard` design as the other selectors on the page.
  const items: { key: RegionGeo; emoji: string; title: string; sub: string }[] =
    [
      {
        key: 'bundesland',
        emoji: '🗺️',
        title: 'Bundesländer',
        sub: '16 Bundesländer',
      },
      { key: 'stadt', emoji: '🏙️', title: 'Städte', sub: 'Top 20' },
    ];
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {items.map((it) => (
        <ScopeCard
          key={it.key}
          active={value === it.key}
          onPress={() => onChange(it.key)}
          icon={it.emoji}
          title={it.title}
          sub={it.sub}
        />
      ))}
    </View>
  );
}

// ─── Region podium (same look as user podium, but for cities/BL) ────────
//
// Same visual grammar as `Podium` (avatars row + pastel cards row),
// just adapted for region rows: the "avatar" is a coloured circle
// with the region's emoji/initial and a medal coin, the cards show
// pts + Detektive count instead of pts + €. Keeps the design
// language consistent across Overall and Regionenkampf.

function RegionPodium({
  top3,
  metric,
  isCity,
}: {
  top3: LbRow[];
  metric: OverallMetric;
  isCity?: boolean;
}) {
  if (top3.length < 3) return null;
  const r1 = top3[0];
  const r2 = top3[1];
  const r3 = top3[2];
  return (
    <View style={{ marginHorizontal: 20, marginTop: 18 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <RegionPodiumAvatar row={r2} medalRank={2} isCity={isCity} />
        <RegionPodiumAvatar row={r1} medalRank={1} isCity={isCity} />
        <RegionPodiumAvatar row={r3} medalRank={3} isCity={isCity} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        <RegionPodiumCard row={r2} medalRank={2} metric={metric} height={108} />
        <RegionPodiumCard row={r1} medalRank={1} metric={metric} height={134} />
        <RegionPodiumCard row={r3} medalRank={3} metric={metric} height={96} />
      </View>
    </View>
  );
}

function RegionPodiumAvatar({
  row,
  medalRank,
  isCity,
}: {
  row: LbRow;
  medalRank: 1 | 2 | 3;
  /** Cities use 🏙️, Bundesländer use 🗺️ — keeps the selector ↔
   *  podium ↔ row visual chain consistent. */
  isCity?: boolean;
}) {
  const ring =
    medalRank === 1 ? '#f5b301' : medalRank === 2 ? '#b9c2c6' : '#d99966';
  const size = medalRank === 1 ? 66 : 52;
  const lift = medalRank === 1 ? 0 : 10;
  const coin = medalRank === 1 ? '🥇' : medalRank === 2 ? '🥈' : '🥉';
  const emoji = isCity ? '🏙️' : '🗺️';
  return (
    <View
      style={{
        flex: medalRank === 1 ? 1.15 : 1,
        alignItems: 'center',
        marginTop: lift,
      }}
    >
      <View style={{ position: 'relative' }}>
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 3,
            borderColor: ring,
            padding: 2,
            backgroundColor: '#fff',
          }}
        >
          <View
            style={{
              width: size - 10,
              height: size - 10,
              borderRadius: (size - 10) / 2,
              backgroundColor: '#f4f6f7',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: Math.round((size - 10) * 0.55) }}>
              {emoji}
            </Text>
          </View>
        </View>
        <Text
          style={{
            position: 'absolute',
            right: -6,
            bottom: -2,
            fontSize: medalRank === 1 ? 22 : 18,
          }}
        >
          {coin}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: medalRank === 1 ? 13 : 12,
          color: '#191c1d',
          marginTop: 8,
          maxWidth: '100%',
          textAlign: 'center',
        }}
      >
        {row.label}
      </Text>
    </View>
  );
}

function RegionPodiumCard({
  row,
  medalRank,
  metric,
  height,
}: {
  row: LbRow;
  medalRank: 1 | 2 | 3;
  metric: OverallMetric;
  height: number;
}) {
  const bg =
    medalRank === 1 ? '#fff3c2' : medalRank === 2 ? '#e9edef' : '#fbe4d2';
  const border =
    medalRank === 1 ? '#f5b301' : medalRank === 2 ? '#cdd3d6' : '#e6b18c';
  // Headline + sub follow the chosen metric. We DROP the
  // "X Detektive" line entirely (per request) and instead show the
  // OTHER metric as the sub so both numbers stay visible.
  const headline =
    metric === 'pts'
      ? `${row.pts.toLocaleString('de-DE')} Pkt`
      : `${row.eur.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} €`;
  const sub =
    metric === 'pts'
      ? `${row.eur.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} € gespart`
      : `${row.pts.toLocaleString('de-DE')} Pkt`;
  return (
    <View
      style={{
        flex: medalRank === 1 ? 1.15 : 1,
        height,
        borderRadius: 16,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: 12,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: medalRank === 1 ? 28 : 22,
          color: '#191c1d',
          letterSpacing: -0.3,
          lineHeight: medalRank === 1 ? 32 : 26,
        }}
      >
        {medalRank}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: medalRank === 1 ? 14 : 13,
          color: '#191c1d',
          marginTop: 4,
        }}
      >
        {headline}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 10,
          color: '#666',
          marginTop: 2,
        }}
      >
        {sub}
      </Text>
    </View>
  );
}

function RegionCard({
  row,
  metric,
  showBundesland,
}: {
  row: LbRow;
  metric: OverallMetric;
  showBundesland?: boolean;
}) {
  const { theme, shadows } = useTokens();
  // Headline value follows the chosen metric. Sub-line shows the
  // OTHER value as a comparison (so the user always has both
  // numbers in view — that's the whole point of the metric switch).
  const headline =
    metric === 'pts'
      ? `${row.pts.toLocaleString('de-DE')} Pkt`
      : `${row.eur.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} €`;
  const sub =
    metric === 'pts'
      ? `${row.eur.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} € gespart`
      : `${row.pts.toLocaleString('de-DE')} Pkt`;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: row.isMe
          ? theme.primaryContainer ?? theme.surfaceAlt
          : theme.surface,
        borderRadius: 14,
        padding: 12,
        ...shadows.sm,
      }}
    >
      <RankBadge rank={row.rank} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 15,
            color: theme.text,
          }}
        >
          {row.label}
          {row.isMe ? (
            <Text style={{ color: theme.primary }}> · Du</Text>
          ) : null}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            color: theme.textMuted,
            marginTop: 2,
          }}
        >
          {showBundesland && row.bundesland ? `${row.bundesland} · ` : ''}
          {sub}
        </Text>
      </View>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 15,
          color: theme.primary,
        }}
      >
        {headline}
      </Text>
    </View>
  );
}


function DeinePositionRegionCard({
  rank,
  label,
  total,
}: {
  rank: number | null;
  label: string | null;
  total: number;
}) {
  if (!label) {
    return (
      <View style={{ paddingHorizontal: 20, marginTop: 12 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 12,
            color: '#666',
            textAlign: 'center',
          }}
        >
          Setze deine Stadt um in der Region-Liga mitzuspielen.
        </Text>
      </View>
    );
  }
  return (
    <LinearGradient
      colors={['#0d8575', '#10a18a']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        marginHorizontal: 20,
        marginTop: 16,
        borderRadius: 16,
        padding: 16,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          justifyContent: 'space-between',
        }}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 16,
            color: '#fff',
          }}
        >
          Deine Region
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 18,
            color: '#fff',
          }}
        >
          {rank !== null ? `Platz ${rank}` : 'außerhalb Top'}
          {rank !== null ? ` / ${total}` : ''}
        </Text>
      </View>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 13,
          color: '#fff',
          opacity: 0.95,
          marginTop: 4,
        }}
      >
        {label} — sammle Punkte und hilf deiner Region in der Liga!
      </Text>
    </LinearGradient>
  );
}

// ─── Status-Hero (own level / pts / streak) ─────────────────────────────
//
// Green-gradient card that anchors the Bestenliste page to the user's
// own context. All numbers come from the SAME sources the legacy
// /achievements screen uses, so the level / streak / freeze /
// progress numbers stay in sync between the two screens:
//   • level + streak + freezeTokens → useAchievements().userStats
//   • level NAME ("Möchtegern-Detektiv" / "Sparfuchs" / …) and the
//     pts/savings thresholds → achievementService.getAllLevels()
// We never invent thresholds — falling back gracefully when the
// levels list hasn't loaded yet (first paint / offline).

// Level-tinted gradient colours, matching the legacy /achievements
// screen exactly so the user sees the SAME card colour in both
// places. The base tone comes from `currentLevelInfo.color`
// (Firestore-defined, per level), the second stop is a hand-picked
// accent that gives each level a distinct visual identity:
//   1 = brown, 2 = orange, 3 = green, 4 = gold, 5 = red, 6+ = brown.
// Falls back to the original mark-detective green when no level
// info has loaded yet (first paint / offline).
function levelGradient(levelId: number, baseColor?: string): [string, string] {
  const fallback: [string, string] = ['#0a6f62', '#10a18a'];
  if (!baseColor) return fallback;
  switch (levelId) {
    case 1: return [baseColor, '#9E6B50']; // Braun
    case 2: return [baseColor, '#FF9800']; // Orange
    case 3: return [baseColor, '#4CAF50']; // Grün
    case 4: return [baseColor, '#FFC107']; // Gold
    case 5: return [baseColor, '#FF5252']; // Rot
    default: return [baseColor, '#9E6B50'];
  }
}

function StatusHero({
  name,
  photoUrl,
  userStats,
  userProfile,
  levels,
}: {
  name: string;
  photoUrl: string | null;
  userStats: { currentLevel?: number; currentStreak?: number; freezeTokens?: number; pointsTotal?: number } | null;
  userProfile: any;
  levels: Level[];
}) {
  // Resolve all values from the real data sources. Fallbacks mirror
  // the cascade used in app/achievements.tsx:
  //   userStats → userProfile.stats → userProfile.level → 1
  const level: number =
    userStats?.currentLevel ??
    userProfile?.stats?.currentLevel ??
    userProfile?.level ??
    1;
  const pts: number =
    userStats?.pointsTotal ??
    userProfile?.stats?.pointsTotal ??
    0;
  const eur: number =
    Number(userProfile?.totalSavings ?? userProfile?.stats?.savingsTotal ?? 0);
  // streak / freezeTokens are intentionally not surfaced in this
  // card anymore — they live on /achievements (the card is a
  // tap-target into that screen). Keeps the hero focused on the
  // single thing that matters here: progress to the next level.

  // Pull current + next level from the real Firestore-loaded list.
  const currentLevelInfo = levels.find((l) => l.id === level);
  const nextLevel = levels.find((l) => l.id === level + 1);

  // Progress numbers for the next level. From level 3 onwards the
  // legacy `/achievements` screen also requires savings (€) to
  // unlock — we mirror that here so the user sees BOTH gates.
  const requiredPts = nextLevel?.pointsRequired || 0;
  const requiredEur = nextLevel?.savingsRequired || 0;
  const ptsPct =
    requiredPts > 0
      ? Math.min(100, Math.max(0, Math.round((pts / requiredPts) * 100)))
      : 100;
  const eurPct =
    requiredEur > 0
      ? Math.min(100, Math.max(0, Math.round((eur / requiredEur) * 100)))
      : 100;
  const ptsRemaining = Math.max(0, requiredPts - pts);
  const eurRemaining = Math.max(0, requiredEur - eur);
  const levelName = currentLevelInfo?.name ?? '';
  // Gradient colours follow the user's CURRENT level — exact same
  // mapping as the legacy /achievements screen so the card colour
  // is consistent between the two screens. (Diagonal start/end
  // tweaked to match the legacy card too.)
  const gradient = levelGradient(level, currentLevelInfo?.color);

  // The whole card is the entry-point to the dedicated
  // /achievements screen — that's where Errungenschaften, full level
  // catalogue, lottie animations and progress live. Keeping that off
  // the Bestenliste avoids stacking two heavy sections on one screen.
  const onPress = () => safePush('/achievements' as any);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.92 : 1,
        borderRadius: 20,
      })}
    >
    <LinearGradient
      colors={gradient}
      start={{ x: -1, y: 0.34 }}
      end={{ x: 1, y: -0.34 }}
      style={{
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 12,
        overflow: 'hidden',
        // Locked to the same height as the Cashback hero on the
        // Einlösen tab — see HERO_HEIGHT for the rationale.
        height: HERO_HEIGHT,
      }}
    >
      <View style={{ flex: 1, justifyContent: 'space-between' }}>
      {/* Same alignment trick as the Cashback hero: stretch the
          row to the avatar's height, then space-between in each
          content column → both pills sit at the bottom of the
          row on the same baseline. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'stretch',
          gap: 12,
          minHeight: 52,
        }}
      >
        {/* Avatar */}
        {photoUrl ? (
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              overflow: 'hidden',
              borderWidth: 2,
              borderColor: 'rgba(255,255,255,0.55)',
            }}
          >
            <RNImage
              source={{ uri: photoUrl }}
              style={{ width: '100%', height: '100%' }}
            />
          </View>
        ) : (
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: 'rgba(255,255,255,0.22)',
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: 'rgba(255,255,255,0.55)',
            }}
          >
            <Text style={{ fontSize: 26 }}>🦉</Text>
          </View>
        )}
        <View
          style={{
            flex: 1,
            minWidth: 0,
            justifyContent: 'space-between',
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 17,
              color: '#fff',
              letterSpacing: -0.2,
            }}
          >
            {name}
          </Text>
          <HeroPill
            icon="star-circle"
            label={`Level ${level}${levelName ? ` · ${levelName}` : ''}`}
          />
        </View>
        <View
          style={{
            alignItems: 'flex-end',
            justifyContent: 'space-between',
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 24,
              lineHeight: 28,
              color: '#fff',
              letterSpacing: -0.4,
            }}
          >
            {pts.toLocaleString('de-DE')}
          </Text>
          <HeroPill icon="star-four-points" label="Detektiv-Punkte" />
        </View>
      </View>

      {/* Progress bars — Pkt always, € only when the next level
          actually requires savings (Level 3+). Two compact 21 px
          rows max. No extra "motivation banner" / chip row below
          on this card — the bars ARE the content. */}
      {nextLevel ? (
        <View style={{ marginTop: 12, gap: 7 }}>
          <ProgressBar
            icon="star-four-points"
            label={`Lv ${level + 1} · ${nextLevel.name}`}
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
      ) : null}

      {/* No dedicated "Errungenschaften & Level →" affordance row
          anymore — the whole card is a Pressable, the press
          feedback (opacity 0.92) signals tap-ability. */}
      </View>
    </LinearGradient>
    </Pressable>
  );
}

// ─── StatusHero progress bar + chip ─────────────────────────────────────
//
// `ProgressBar` is a single 18 px row: icon + label on the left,
// "current / required" counter on the right, thin 4 px fill bar
// below. Designed to be stackable so we can show both pts and €
// gates without doubling the StatusHero height.
//
// `Chip` is a tiny inline label with icon — used in the bottom row
// for Streak / Freezes / Gespart. No background, just icon + text,
// so the row reads as informational rather than another set of
// "buttons" the user has to parse.

// ─── HeroPill ──────────────────────────────────────────────────────────
//
// One pill, four use-sites: the level chip + the Detektiv-Punkte
// currency label on the StatusHero, and the status chip +
// Cashback-Taler currency label on the Cashback hero. Single
// component → all four pills are visually identical (same padding,
// radius, font-size, icon-size, gold accent). One source of truth
// for the "white-on-gradient hero pill" design.
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

function Chip({
  icon,
  iconColor,
  label,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconColor: string;
  label: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <MaterialCommunityIcons name={icon} size={12} color={iconColor} />
      <Text
        numberOfLines={1}
        style={{
          fontFamily,
          fontWeight: fontWeight.bold,
          fontSize: 11,
          color: '#fff',
        }}
      >
        {label}
      </Text>
    </View>
  );
}


// ─── Podium (top-3, prototype-aligned) ──────────────────────────────────
//
// Layout:
//   row 1 — three avatars in colored medal-rings, names underneath
//           (rank-2 left, rank-1 centre+higher, rank-3 right)
//   row 2 — three soft pastel cards, height-stepped:
//             rank 2 short (gray),
//             rank 1 tall  (gold),
//             rank 3 short (peach)
//           Each card shows: big rank number, points, € savings.
//
// No bold gradients on the cards — they're flat pastel surfaces so
// the avatars + names dominate visually.

function Podium({ top3, metric }: { top3: LbUser[]; metric: OverallMetric }) {
  if (top3.length < 3) return null;
  const r1 = top3[0];
  const r2 = top3[1];
  const r3 = top3[2];

  return (
    <View style={{ marginHorizontal: 20, marginTop: 18 }}>
      {/* Avatar row — rank-1 floats higher and bigger in the middle. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <PodiumAvatar user={r2} medalRank={2} />
        <PodiumAvatar user={r1} medalRank={1} />
        <PodiumAvatar user={r3} medalRank={3} />
      </View>

      {/* Card row — soft pastel, height-stepped. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 8,
        }}
      >
        <PodiumCard user={r2} medalRank={2} metric={metric} height={108} />
        <PodiumCard user={r1} medalRank={1} metric={metric} height={134} />
        <PodiumCard user={r3} medalRank={3} metric={metric} height={96} />
      </View>
    </View>
  );
}

function PodiumAvatar({
  user,
  medalRank,
}: {
  user: LbUser;
  medalRank: 1 | 2 | 3;
}) {
  // Ring colours per medal — matches the pastel cards below.
  const ring =
    medalRank === 1 ? '#f5b301' : medalRank === 2 ? '#b9c2c6' : '#d99966';
  // Rank-1 floats higher and is larger. The other two share a smaller
  // size so the centre dominates the row visually.
  const size = medalRank === 1 ? 66 : 52;
  const lift = medalRank === 1 ? 0 : 10;
  const coin = medalRank === 1 ? '🥇' : medalRank === 2 ? '🥈' : '🥉';
  return (
    <View
      style={{
        flex: medalRank === 1 ? 1.15 : 1,
        alignItems: 'center',
        marginTop: lift,
      }}
    >
      <View style={{ position: 'relative' }}>
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 3,
            borderColor: ring,
            padding: 2,
            backgroundColor: '#fff',
          }}
        >
          <PodiumAvatarInner
            name={user.name}
            photoUrl={user.photoUrl}
            size={size - 10}
          />
        </View>
        {/* Floating medal coin */}
        <Text
          style={{
            position: 'absolute',
            right: -6,
            bottom: -2,
            fontSize: medalRank === 1 ? 22 : 18,
          }}
        >
          {coin}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: medalRank === 1 ? 14 : 12,
          color: '#191c1d',
          marginTop: 8,
          maxWidth: '100%',
          textAlign: 'center',
        }}
      >
        {user.name}
      </Text>
    </View>
  );
}

function PodiumAvatarInner({
  name,
  photoUrl,
  size,
}: {
  name: string;
  photoUrl: string | null;
  size: number;
}) {
  if (photoUrl) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          backgroundColor: '#eee',
        }}
      >
        <RNImage
          source={{ uri: photoUrl }}
          style={{ width: '100%', height: '100%' }}
        />
      </View>
    );
  }
  const initial = name?.[0]?.toUpperCase() ?? '?';
  const palette = ['#0d8575', '#1f5e96', '#a32d6f', '#c2462b', '#7a4a9a', '#345a3a'];
  const idx = (initial.charCodeAt(0) || 0) % palette.length;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: palette[idx],
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: Math.round(size * 0.42),
          color: '#fff',
        }}
      >
        {initial}
      </Text>
    </View>
  );
}

function PodiumCard({
  user,
  medalRank,
  metric,
  height,
}: {
  user: LbUser;
  medalRank: 1 | 2 | 3;
  metric: OverallMetric;
  height: number;
}) {
  // Soft pastel surface colours — flat, NO gradient, to match the
  // prototype. Border is a slightly deeper version for definition.
  const bg =
    medalRank === 1 ? '#fff3c2' : medalRank === 2 ? '#e9edef' : '#fbe4d2';
  const border =
    medalRank === 1 ? '#f5b301' : medalRank === 2 ? '#cdd3d6' : '#e6b18c';
  const valueText =
    metric === 'pts'
      ? `${user.pts.toLocaleString('de-DE')} Pkt`
      : `${user.eur.toFixed(2).replace('.', ',')} €`;
  const subText =
    metric === 'pts'
      ? `${user.eur.toFixed(2).replace('.', ',')} € gespart`
      : `${user.pts.toLocaleString('de-DE')} Pkt`;
  return (
    <View
      style={{
        flex: medalRank === 1 ? 1.15 : 1,
        height,
        borderRadius: 16,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: 12,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: medalRank === 1 ? 28 : 22,
          color: '#191c1d',
          letterSpacing: -0.3,
          lineHeight: medalRank === 1 ? 32 : 26,
        }}
      >
        {medalRank}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: medalRank === 1 ? 14 : 13,
          color: '#191c1d',
          marginTop: 4,
        }}
      >
        {valueText}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 10,
          color: '#666',
          marginTop: 2,
        }}
      >
        {subText}
      </Text>
    </View>
  );
}

// ─── Floating "Deine Position" sticky bar ───────────────────────────────
//
// Compact, always-visible at the page's bottom edge so the user
// never has to scroll to see their standing.
//
// Two modes, driven by the same `outerScope` the user picked above:
//   • `outerScope === 'overall'` → user's individual percentile
//     ("Top 50! Greif ganz oben an", "Du gehörst zu den besten 5%",
//     "Besser als 50% aller Detektive", …) — see motivationalLine()
//     in the leaderboard service.
//   • `outerScope === 'region'`  → the user's OWN region's rank in
//     its league (e.g. "Bayern · Platz 3 — stark!"). Switches between
//     Bundesland and Stadt with the `geo` prop, mirroring the Region-
//     Tab toggle.
// Both modes share the same compact layout: badge + one-line message.

function PositionStickyBar({
  userProfile,
  outerScope,
  geo,
  userStats,
  levels,
}: {
  userProfile: any;
  outerScope: LbScopeOuter;
  geo: RegionGeo;
  userStats: ReturnType<typeof useAchievements>['userStats'];
  levels: Level[];
}) {
  const insets = useSafeAreaInsets();
  // Level-tinted gradient — same colour the user sees on the
  // StatusHero card above. Single source of truth: levelGradient().
  const userLevel: number =
    userStats?.currentLevel ??
    userProfile?.stats?.currentLevel ??
    userProfile?.level ??
    1;
  const userLevelInfo = levels.find((l) => l.id === userLevel);
  const gradient = levelGradient(userLevel, userLevelInfo?.color);

  // ── Overall mode — user's personal percentile / rank ──
  const userPts = Number(userProfile?.stats?.pointsTotal ?? 0);
  const userNick: string | null = userProfile?.display_name ?? null;
  const [position, setPosition] = useState<LbPosition | null>(null);
  useEffect(() => {
    if (outerScope !== 'overall') return;
    let alive = true;
    getUserPosition(userPts, userNick).then((p) => alive && setPosition(p));
    return () => {
      alive = false;
    };
  }, [outerScope, userPts, userNick]);

  // ── Region mode — find the user's OWN BL/Stadt in the league ──
  const userBL: string | null =
    (userProfile as any)?.bundesland ??
    (userProfile as any)?.guessedBundesland ??
    null;
  const userCity: string | null =
    (userProfile as any)?.city ??
    (userProfile as any)?.guessedCity ??
    null;
  const [regionRow, setRegionRow] = useState<LbRow | null>(null);
  const [regionTotal, setRegionTotal] = useState(0);
  useEffect(() => {
    if (outerScope !== 'region') return;
    let alive = true;
    const target = geo === 'bundesland' ? userBL : userCity;
    const fetcher =
      geo === 'bundesland'
        ? getBundeslandRanks(target, 'all', 'pts')
        : getCityRanks(target, 'all', 'pts');
    fetcher.then((rows) => {
      if (!alive) return;
      setRegionTotal(rows.length);
      // The list is already sorted+ranked by the service; the user's
      // row carries `isMe: true` thanks to the target arg above.
      setRegionRow(rows.find((r) => r.isMe) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [outerScope, geo, userBL, userCity]);

  // ── Render ──
  let badge: string;
  let message: string;
  if (outerScope === 'region') {
    const target = geo === 'bundesland' ? userBL : userCity;
    if (!target) {
      badge = geo === 'bundesland' ? 'Bundesland' : 'Stadt';
      message =
        geo === 'bundesland'
          ? '🗺️ Setze dein Bundesland um in der Liga mitzuspielen!'
          : '🏙️ Setze deine Stadt um in der Liga mitzuspielen!';
    } else if (!regionRow) {
      badge = target;
      message =
        geo === 'bundesland'
          ? '🗺️ Sammle Punkte für dein Bundesland!'
          : '🏙️ Sammle Punkte für deine Stadt!';
    } else {
      badge =
        regionRow.rank <= 3
          ? `Platz ${regionRow.rank}`
          : `Platz ${regionRow.rank}/${regionTotal}`;
      message = regionMessage(regionRow.rank, regionTotal, target, geo);
    }
  } else {
    if (!position) return null;
    if (position.rank !== null && position.rank <= 50) {
      badge = `Top ${position.rank}`;
    } else if (position.rank !== null) {
      badge = `Platz ${position.rank}`;
    } else if (position.approxRank) {
      badge = `Platz ~${position.approxRank.toLocaleString('de-DE')}`;
    } else if (userPts > 0) {
      badge = `${userPts.toLocaleString('de-DE')} Pkt`;
    } else {
      badge = 'Liga';
    }
    message = position.message;
  }

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        // Tab bar (~49 px) + safe-area + extra clearance for the
        // raised "Stöbern" floating button in the centre of our tab
        // bar (sits ~25 px above the bar baseline). Total offset:
        // safe-area + ~95 px — keeps the bar visible without
        // overlapping the elevated button.
        bottom: insets.bottom + 95,
        zIndex: 20,
      }}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: -1, y: 0.34 }}
        end={{ x: 1, y: -0.34 }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 14,
          shadowColor: '#000',
          shadowOpacity: 0.22,
          shadowOffset: { width: 0, height: 6 },
          shadowRadius: 12,
          elevation: 6,
        }}
      >
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 8,
            backgroundColor: 'rgba(255,255,255,0.22)',
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 12,
              color: '#fff',
              letterSpacing: 0.2,
            }}
          >
            {badge}
          </Text>
        </View>
        <Text
          numberOfLines={2}
          style={{
            flex: 1,
            fontFamily,
            fontWeight: fontWeight.semibold,
            fontSize: 11,
            lineHeight: 14,
            color: '#fff',
          }}
        >
          {message}
        </Text>
      </LinearGradient>
    </View>
  );
}

// Region-side motivational copy. Symmetric to motivationalLine()
// in the leaderboard service but tied to the user's BL/Stadt rank
// inside its own league (16 BLs / top-50 cities).
function regionMessage(
  rank: number,
  total: number,
  name: string,
  geo: RegionGeo,
): string {
  const noun = geo === 'bundesland' ? 'Bundesland' : 'Stadt';
  if (rank === 1) return `🥇 ${name} — auf Platz 1! Verteidige die Spitze!`;
  if (rank === 2) return `🥈 ${name} — Silber, der Thron ist nah!`;
  if (rank === 3) return `🥉 ${name} — auf dem Treppchen, stark!`;
  if (rank <= 5) return `🔥 ${name} ist Top 5 — sammle weiter Punkte!`;
  if (rank <= 10) return `💪 ${name} ist Top 10 — die Spitze ist in Sicht!`;
  // Out of top 10: include the position fraction so the user knows
  // how far they are from the front.
  return `🚀 Sammle Punkte und bring dein${
    geo === 'bundesland' ? '' : 'e'
  } ${noun} ${name} weiter nach oben!`;
}

// ─── Region setup sheet content (kept) ──────────────────────────────────

function RegionSetupContent({
  suggestion,
  onAccept,
  onPickOther,
}: {
  suggestion: { city: string | null; bundesland: string | null };
  onAccept: () => void;
  onPickOther: () => void;
}) {
  const { theme } = useTokens();
  const city = suggestion.city ?? '';
  const bl = suggestion.bundesland ?? '';
  return (
    <View>
      {city && bl ? (
        <>
          <View
            style={{
              alignSelf: 'center',
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
            }}
          >
            <MaterialCommunityIcons
              name="map-marker-radius"
              size={28}
              color={theme.primary}
            />
          </View>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 20,
              color: theme.text,
              textAlign: 'center',
              letterSpacing: -0.3,
            }}
          >
            Hilf {city} in der Liga
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 14,
              lineHeight: 20,
              color: theme.textSub,
              textAlign: 'center',
              marginTop: 6,
            }}
          >
            Wir glauben du wohnst in {city} ({bl}). Stimmt das?
          </Text>
          <Pressable
            onPress={onAccept}
            style={({ pressed }) => ({
              marginTop: 18,
              height: 50,
              borderRadius: 14,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 15,
                color: '#fff',
                letterSpacing: 0.2,
              }}
            >
              Ja, für {city} mitspielen
            </Text>
          </Pressable>
          <Pressable
            onPress={onPickOther}
            style={({ pressed }) => ({
              marginTop: 8,
              height: 50,
              borderRadius: 14,
              backgroundColor: theme.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 15,
                color: theme.text,
              }}
            >
              Nein, ich wohne woanders
            </Text>
          </Pressable>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 11,
              lineHeight: 16,
              color: theme.textMuted,
              marginTop: 14,
              textAlign: 'center',
            }}
          >
            Aggregiert anonym in die Stadt-Liga. Du tauchst nirgends einzeln auf.
          </Text>
        </>
      ) : (
        <>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 20,
              color: theme.text,
              textAlign: 'center',
            }}
          >
            Wähle deine Stadt
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 14,
              lineHeight: 20,
              color: theme.textSub,
              textAlign: 'center',
              marginTop: 6,
            }}
          >
            Damit deine Punkte für deine Region zählen.
          </Text>
        </>
      )}
    </View>
  );
}
