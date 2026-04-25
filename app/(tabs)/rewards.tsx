import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { doc, updateDoc } from 'firebase/firestore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterSheet } from '@/components/design/FilterSheet';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { db } from '@/lib/firebase';
import {
  BUNDESLAENDER,
  type Bundesland,
  getCityBattle,
  getLeaderboard,
  getUserContribution,
  type LbCityBattleRow,
  type LbPeriod,
  type LbScope,
  type LbUser,
  suggestRegionFromJourneys,
} from '@/lib/services/leaderboard';

// ─── Demo data ─────────────────────────────────────────────────────────
// Lifted directly from `markendetektive_newdesign/project/Rewards.jsx`
// so the screen renders something realistic in Phase 2. Wire-up to
// real services / Firestore comes when the backend exposes the
// Cashback-Taler model — until then this is hard-coded.
const CASHBACK_EUR = 12.4;
const PAYOUT_THRESHOLD = 15.0;

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
  const { user } = useAuth();

  const [tab, setTab] = useState<RewardsTab>('redeem');
  const pagerRef = useRef<PagerView | null>(null);

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
          onPress={() => {
            // RewardsHelp sheet wires up in Phase 4.
          }}
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
            router.push(user ? ('/profile' as any) : ('/auth/welcome' as any))
          }
          style={({ pressed }) => ({
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: theme.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <MaterialCommunityIcons
            name="account-outline"
            size={20}
            color={theme.textMuted}
          />
        </Pressable>
      </View>

      <SegmentedTabs
        tabs={[
          { key: 'redeem', label: 'Einlösen' },
          { key: 'ranks', label: 'Bestenliste' },
        ] as const}
        value={tab}
        onChange={onTabChange}
      />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Two pages, native swipe between them. The Bestenliste page is
          a placeholder until Phase 3. */}
      <PagerView
        ref={pagerRef}
        style={{ flex: 1 }}
        initialPage={0}
        onPageSelected={onPageSelected}
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

        <View key="ranks" style={{ flex: 1 }}>
          <ScrollView
            scrollsToTop={tab === 'ranks'}
            contentContainerStyle={{
              paddingTop: chromeHeight,
              paddingBottom: 120,
            }}
            showsVerticalScrollIndicator={false}
          >
            <RanksTab />
          </ScrollView>
        </View>
      </PagerView>

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
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
// EINLÖSEN TAB
// ────────────────────────────────────────────────────────────────────────

function RedeemTab() {
  const { theme } = useTokens();
  const pct = Math.min(
    100,
    Math.round((CASHBACK_EUR / PAYOUT_THRESHOLD) * 100),
  );
  const canRedeem = CASHBACK_EUR >= PAYOUT_THRESHOLD;
  const gapEur = (PAYOUT_THRESHOLD - CASHBACK_EUR)
    .toFixed(2)
    .replace('.', ',');

  return (
    <>
      {/* ── Hero: Cashback-Taler ── */}
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <LinearGradient
          colors={['#0a6f62', '#0d8575', '#10a18a']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: 20,
            padding: 18,
            paddingBottom: 20,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              alignSelf: 'flex-start',
              backgroundColor: 'rgba(255,255,255,0.18)',
              paddingVertical: 4,
              paddingHorizontal: 10,
              borderRadius: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <MaterialCommunityIcons
              name="treasure-chest"
              size={12}
              color="#ffd44b"
            />
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 10,
                color: '#fff',
                letterSpacing: 1,
                textTransform: 'uppercase',
              }}
            >
              Cashback-Taler
            </Text>
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              gap: 4,
              marginTop: 10,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 48,
                lineHeight: 50,
                letterSpacing: -1,
                color: '#fff',
              }}
            >
              {CASHBACK_EUR.toFixed(2).replace('.', ',')}
            </Text>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 22,
                color: '#fff',
                opacity: 0.95,
              }}
            >
              €
            </Text>
          </View>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 12,
              color: '#fff',
              opacity: 0.92,
              marginTop: 8,
            }}
          >
            {canRedeem ? (
              'Bereit zur Auszahlung'
            ) : (
              <>
                Noch{' '}
                <Text style={{ fontWeight: fontWeight.bold }}>{gapEur} €</Text>{' '}
                bis zur nächsten Auszahlung
              </>
            )}
          </Text>
          <View
            style={{
              height: 8,
              backgroundColor: 'rgba(255,255,255,0.22)',
              borderRadius: 4,
              overflow: 'hidden',
              marginTop: 10,
            }}
          >
            <View
              style={{
                width: `${pct}%`,
                height: '100%',
                backgroundColor: theme.surface,
                borderRadius: 4,
              }}
            />
          </View>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              marginTop: 6,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.semibold,
                fontSize: 10,
                color: '#fff',
                opacity: 0.85,
              }}
            >
              0 €
            </Text>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.semibold,
                fontSize: 10,
                color: '#fff',
                opacity: 0.85,
              }}
            >
              Schwelle 15 €
            </Text>
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
            <QuickActionTile key={a.k} action={a} />
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

function QuickActionTile({ action }: { action: QuickAction }) {
  const fg = action.dark ? '#fff' : '#191c1d';
  return (
    <Pressable
      onPress={() => {
        if (action.k === 'receipt') router.push('/barcode-scanner' as any);
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
        if (action.k === 'receipt') router.push('/barcode-scanner' as any);
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


// ────────────────────────────────────────────────────────────────────────
// BESTENLISTE TAB (Phase 3)
// ────────────────────────────────────────────────────────────────────────
//
// Mirrors the prototype's leaderboard:
//   • Status hero (gradient card) at the top — user's avatar, level,
//     current rank in the active scope, Detektiv-Punkte progress to
//     the next level, streak chips.
//   • Scope SegmentedTabs: Deutschland / Mein Bundesland / Freunde
//     (Freunde is rendered but disabled — feature comes later).
//   • Period SegmentedTabs: Diesen Monat / All-Time
//   • Top-3 podium-style rows + remaining list rows
//   • Städte-Duell widget below — anonymous aggregate per city
//
// Region setup (city + Bundesland) is opt-in via the friendly
// suggestion sheet built on the standard `FilterSheet` so it shares
// the same backdrop / slide-up / swipe-down behaviour as every other
// bottom sheet in the app.

function RanksTab() {
  const { theme, shadows } = useTokens();
  const { user, userProfile, refreshUserProfile } = useAuth();

  const userBL = (userProfile as any)?.bundesland ?? null;
  const userCity = (userProfile as any)?.city ?? null;
  const userNick = userProfile?.display_name ?? null;
  const hasRegion = !!userBL;

  // Default scope: bundesland if set, else overall.
  const [scope, setScope] = useState<LbScope>(hasRegion ? 'bundesland' : 'overall');
  const [period, setPeriod] = useState<LbPeriod>('month');
  useEffect(() => {
    // When user picks a region for the first time, jump them to the
    // Bundesland-Liga since that's why they came.
    if (hasRegion && scope === 'overall') setScope('bundesland');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRegion]);

  const [rows, setRows] = useState<LbUser[]>([]);
  const [contribution, setContribution] = useState<{
    pts: number;
    eur: number;
    level: number;
    nextLevelInPts: number;
    pctToNext: number;
    streakDays: number;
    streakFreezes: number;
  } | null>(null);
  const [cityBattle, setCityBattle] = useState<LbCityBattleRow[]>([]);

  useEffect(() => {
    let alive = true;
    getLeaderboard(scope, period, userBL, userNick).then((r) => {
      if (alive) setRows(r);
    });
    getCityBattle(period).then((c) => {
      if (alive) setCityBattle(c);
    });
    getUserContribution(period, userBL, userCity).then((c) => {
      if (alive) setContribution(c);
    });
    return () => {
      alive = false;
    };
  }, [scope, period, userBL, userCity, userNick]);

  // Region setup sheet plumbing.
  const [setupOpen, setSetupOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    city: string | null;
    bundesland: Bundesland | null;
  }>({ city: null, bundesland: null });

  const openSetup = useCallback(async () => {
    if (user?.uid) {
      const s = await suggestRegionFromJourneys(user.uid);
      setSuggestion(s);
    }
    setSetupOpen(true);
  }, [user?.uid]);

  const saveRegion = useCallback(
    async (bundesland: string, city: string) => {
      if (!user?.uid) return;
      try {
        await updateDoc(doc(db, 'users', user.uid), { bundesland, city });
        await refreshUserProfile();
      } catch (e) {
        console.warn('Rewards: saveRegion failed', e);
      }
    },
    [user?.uid, refreshUserProfile],
  );

  // The user's own row in the active list (for the hero card).
  const meRow = rows.find((r) => r.isMe) ?? null;
  const scopeLabel =
    scope === 'overall'
      ? 'Deutschland'
      : scope === 'bundesland'
        ? userBL ?? 'Region'
        : 'Freunde';

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <>
      {/* ─── Status hero ─── */}
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        <StatusHero
          contribution={contribution}
          rank={meRow?.rank ?? null}
          totalInList={rows.length}
          scopeLabel={scopeLabel}
          userNick={userNick}
        />
      </View>

      {/* ─── Region setup nudge if user hasn't picked yet ─── */}
      {!hasRegion ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          <SetupNudge onPress={openSetup} />
        </View>
      ) : null}

      {/* ─── Scope tabs ─── */}
      <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
        <SegmentedTabs
          tabs={[
            { key: 'overall', label: 'Deutschland' },
            {
              key: 'bundesland',
              label: hasRegion ? userBL ?? 'Region' : 'Mein Bundesland',
            },
            { key: 'friends', label: 'Freunde' },
          ] as const}
          value={scope}
          onChange={(k) => {
            if (k === 'bundesland' && !hasRegion) {
              openSetup();
              return;
            }
            setScope(k);
          }}
        />
      </View>

      {/* ─── Period tabs ─── */}
      <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
        <SegmentedTabs
          tabs={[
            { key: 'month', label: 'Diesen Monat' },
            { key: 'all', label: 'All-Time' },
          ] as const}
          value={period}
          onChange={setPeriod}
        />
      </View>

      {/* ─── Top-3 + list ─── */}
      {scope === 'friends' ? (
        <FriendsEmptyState />
      ) : (
        <>
          {top3.length > 0 ? (
            <View style={{ paddingHorizontal: 20, paddingTop: 18 }}>
              <Podium top3={top3} />
            </View>
          ) : null}

          {rest.length > 0 ? (
            <View
              style={{
                marginHorizontal: 20,
                marginTop: 14,
                backgroundColor: theme.surface,
                borderRadius: 14,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: theme.border,
              }}
            >
              {rest.map((r, i) => (
                <UserRow
                  key={r.id}
                  row={r}
                  isLast={i === rest.length - 1}
                />
              ))}
            </View>
          ) : null}

          {rows.length > 0 ? (
            <Text
              style={{
                marginTop: 10,
                paddingHorizontal: 20,
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 11,
                color: theme.textMuted,
                textAlign: 'center',
              }}
            >
              Sortiert nach Detektiv-Punkten · Ersparnis als Zusatzinfo
            </Text>
          ) : null}
        </>
      )}

      {/* ─── Städte-Duell ─── */}
      <View style={{ paddingHorizontal: 20, paddingTop: 28 }}>
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
            Städte-Duell
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 12,
              color: theme.textMuted,
            }}
          >
            {period === 'month' ? 'Diesen Monat' : 'Gesamt'}
          </Text>
        </View>
        <View
          style={{
            marginTop: 10,
            backgroundColor: theme.surface,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: theme.border,
            padding: 14,
            paddingBottom: 12,
          }}
        >
          {cityBattle.map((c, i) => {
            const max = cityBattle[0]?.pts ?? 1;
            const pct = Math.round((c.pts / max) * 100);
            const mine = !!userCity && c.city === userCity;
            const up = c.delta.startsWith('+');
            return (
              <View
                key={c.city}
                style={{ marginBottom: i === cityBattle.length - 1 ? 0 : 10 }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                  }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.bold,
                        fontSize: 13,
                        color: mine ? theme.primary : theme.text,
                      }}
                    >
                      {c.city}
                    </Text>
                    {mine ? (
                      <View
                        style={{
                          backgroundColor: theme.primary,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                          borderRadius: 4,
                        }}
                      >
                        <Text
                          style={{
                            fontFamily,
                            fontWeight: fontWeight.extraBold,
                            fontSize: 9,
                            color: '#fff',
                            letterSpacing: 0.4,
                          }}
                        >
                          DU
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.medium,
                      fontSize: 11,
                      color: up ? '#16a34a' : '#dc2626',
                    }}
                  >
                    {c.delta}
                  </Text>
                </View>
                <View
                  style={{
                    height: 6,
                    backgroundColor: theme.border,
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      backgroundColor: mine ? theme.primary : theme.borderStrong,
                      borderRadius: 3,
                    }}
                  />
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* ─── Region setup sheet ─── */}
      <FilterSheet
        visible={setupOpen}
        title="Spiel für deine Stadt mit"
        onClose={() => setSetupOpen(false)}
      >
        <RegionSetupContent
          suggestion={suggestion}
          onAccept={async () => {
            if (suggestion.bundesland && suggestion.city) {
              await saveRegion(suggestion.bundesland, suggestion.city);
            }
            setSetupOpen(false);
          }}
          onPickOther={() => {
            setSetupOpen(false);
            setPickerOpen(true);
          }}
          onClose={() => setSetupOpen(false)}
        />
      </FilterSheet>

      {/* ─── Manual Bundesland picker ─── */}
      <FilterSheet
        visible={pickerOpen}
        title="Wähle dein Bundesland"
        onClose={() => setPickerOpen(false)}
      >
        {BUNDESLAENDER.map((bl, i) => (
          <Pressable
            key={bl}
            onPress={async () => {
              await saveRegion(bl, bl);
              setPickerOpen(false);
            }}
            style={({ pressed }) => ({
              paddingVertical: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: theme.border,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <MaterialCommunityIcons
              name="map-marker-outline"
              size={20}
              color={theme.primary}
            />
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.semibold,
                fontSize: 15,
                color: theme.text,
              }}
            >
              {bl}
            </Text>
          </Pressable>
        ))}
      </FilterSheet>
    </>
  );
}

// ─── Status Hero ────────────────────────────────────────────────────────
// Green-gradient card at the top — user's avatar, current rank in the
// active scope, Detektiv-Punkte + level progress, streak chips.

function StatusHero({
  contribution,
  rank,
  totalInList,
  scopeLabel,
  userNick,
}: {
  contribution: {
    pts: number;
    eur: number;
    level: number;
    nextLevelInPts: number;
    pctToNext: number;
    streakDays: number;
    streakFreezes: number;
  } | null;
  rank: number | null;
  totalInList: number;
  scopeLabel: string;
  userNick: string | null;
}) {
  return (
    <LinearGradient
      colors={['#0a6f62', '#0d8575', '#10a18a']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{
        borderRadius: 20,
        padding: 18,
        overflow: 'hidden',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 54,
            height: 54,
            borderRadius: 27,
            backgroundColor: '#fff',
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
          }}
        >
          <Text style={{ fontSize: 28 }}>🦉</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
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
            {userNick ?? 'Anonymer Detektiv'}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              marginTop: 2,
            }}
          >
            <MaterialCommunityIcons
              name="shield-star-outline"
              size={12}
              color="#ffd44b"
            />
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.semibold,
                fontSize: 11,
                color: '#fff',
                opacity: 0.92,
              }}
            >
              Level {contribution?.level ?? 1} · {scopeLabel}
            </Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              gap: 2,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 14,
                color: '#fff',
                opacity: 0.9,
              }}
            >
              #
            </Text>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 28,
                color: '#fff',
                letterSpacing: -0.6,
                lineHeight: 30,
              }}
            >
              {rank ?? '–'}
            </Text>
          </View>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.semibold,
              fontSize: 10,
              color: '#fff',
              opacity: 0.88,
              marginTop: 2,
            }}
          >
            {totalInList ? `von ${totalInList}` : scopeLabel}
          </Text>
        </View>
      </View>

      {/* Pts + progress to next level */}
      <View style={{ marginTop: 14 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'baseline',
          }}
        >
          <View
            style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 26,
                color: '#fff',
                letterSpacing: -0.5,
              }}
            >
              {(contribution?.pts ?? 0).toLocaleString('de-DE')}
            </Text>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 11,
                color: '#fff',
                opacity: 0.92,
              }}
            >
              Detektiv-Pkt
            </Text>
          </View>
          {contribution ? (
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.semibold,
                fontSize: 11,
                color: '#fff',
                opacity: 0.88,
              }}
            >
              {contribution.nextLevelInPts} bis Lv {contribution.level + 1}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            height: 7,
            backgroundColor: 'rgba(255,255,255,0.22)',
            borderRadius: 4,
            overflow: 'hidden',
            marginTop: 8,
          }}
        >
          <View
            style={{
              width: `${contribution?.pctToNext ?? 0}%`,
              height: '100%',
              backgroundColor: '#fff',
              borderRadius: 4,
            }}
          />
        </View>
      </View>

      {/* Ersparnis + Streak */}
      <View
        style={{
          flexDirection: 'row',
          gap: 8,
          marginTop: 12,
          flexWrap: 'wrap',
        }}
      >
        {contribution ? (
          <HeroChip
            icon="💶"
            label={`${contribution.eur.toFixed(2).replace('.', ',')} €`}
            sub="gespart"
          />
        ) : null}
        {contribution && contribution.streakDays > 0 ? (
          <HeroChip
            icon="🔥"
            label={`${contribution.streakDays} Tage`}
            sub="Streak"
          />
        ) : null}
        {contribution && contribution.streakFreezes > 0 ? (
          <HeroChip
            icon="❄️"
            label={`${contribution.streakFreezes}/2`}
            sub="Freezes"
          />
        ) : null}
      </View>
    </LinearGradient>
  );
}

function HeroChip({
  icon,
  label,
  sub,
}: {
  icon: string;
  label: string;
  sub?: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: 'rgba(255,255,255,0.16)',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
      }}
    >
      <Text style={{ fontSize: 14 }}>{icon}</Text>
      <View>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 11,
            color: '#fff',
          }}
        >
          {label}
        </Text>
        {sub ? (
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.semibold,
              fontSize: 9,
              color: '#fff',
              opacity: 0.8,
              marginTop: 1,
            }}
          >
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Top-3 Podium ────────────────────────────────────────────────────────

function Podium({ top3 }: { top3: LbUser[] }) {
  // Order on screen: 2 · 1 · 3 (so #1 stands tallest in the middle).
  const layout = [top3[1], top3[0], top3[2]].filter(Boolean) as LbUser[];
  const heights: Record<number, number> = { 1: 110, 2: 92, 3: 78 };
  const accents: Record<number, string> = {
    1: '#f5b301',
    2: '#9aa6ab',
    3: '#c98a51',
  };
  const { theme } = useTokens();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      {layout.map((u) => (
        <View key={u.id} style={{ flex: 1, alignItems: 'center' }}>
          {/* Avatar with rank badge */}
          <View style={{ position: 'relative', marginBottom: 6 }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 28,
                backgroundColor: theme.surface,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: u.isMe ? theme.primary : accents[u.rank],
              }}
            >
              <Text style={{ fontSize: 28 }}>{u.avatar}</Text>
            </View>
            <View
              style={{
                position: 'absolute',
                bottom: -4,
                right: -4,
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: accents[u.rank],
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 2,
                borderColor: theme.bg,
              }}
            >
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 11,
                  color: '#fff',
                }}
              >
                {u.rank}
              </Text>
            </View>
          </View>
          <Text
            numberOfLines={1}
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 12,
              color: u.isMe ? theme.primary : theme.text,
              maxWidth: '100%',
            }}
          >
            {u.name}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 11,
              color: theme.primary,
              marginTop: 2,
            }}
          >
            {u.pts.toLocaleString('de-DE')} Pkt
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 10,
              color: theme.textMuted,
              marginTop: 1,
            }}
          >
            {u.eur.toFixed(2).replace('.', ',')} €
          </Text>
          {/* Podium block */}
          <View
            style={{
              marginTop: 6,
              width: '100%',
              height: heights[u.rank],
              backgroundColor: u.isMe
                ? theme.primary
                : accents[u.rank] + '33',
              borderTopLeftRadius: 8,
              borderTopRightRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 18,
                color: u.isMe ? '#fff' : accents[u.rank],
              }}
            >
              {u.rank}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── User row (4+) ──────────────────────────────────────────────────────

function UserRow({ row, isLast }: { row: LbUser; isLast: boolean }) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: theme.border,
        backgroundColor: row.isMe
          ? theme.primaryContainer ?? theme.surfaceAlt
          : 'transparent',
      }}
    >
      <Text
        style={{
          width: 26,
          textAlign: 'center',
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 13,
          color: theme.textMuted,
        }}
      >
        {row.rank}
      </Text>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: theme.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: row.isMe ? 1.5 : 0,
          borderColor: row.isMe ? theme.primary : 'transparent',
        }}
      >
        <Text style={{ fontSize: 18 }}>{row.avatar}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 14,
            color: theme.text,
          }}
        >
          {row.name}
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
            marginTop: 1,
          }}
        >
          {row.city}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 14,
            color: theme.text,
          }}
        >
          {row.pts.toLocaleString('de-DE')}
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            color: theme.textMuted,
            marginTop: 1,
          }}
        >
          {row.eur.toFixed(2).replace('.', ',')} €
        </Text>
      </View>
    </View>
  );
}

// ─── Setup nudge / placeholders ─────────────────────────────────────────

function SetupNudge({ onPress }: { onPress: () => void }) {
  const { theme } = useTokens();
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
          Spiel für deine Stadt mit
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
          Verrate uns deine Region und sieh deine Bundesland-Liga
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

function FriendsEmptyState() {
  const { theme } = useTokens();
  return (
    <View
      style={{
        marginHorizontal: 20,
        marginTop: 24,
        padding: 24,
        backgroundColor: theme.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        alignItems: 'center',
      }}
    >
      <MaterialCommunityIcons
        name="account-group-outline"
        size={36}
        color={theme.textMuted}
      />
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 16,
          color: theme.text,
          marginTop: 10,
        }}
      >
        Demnächst — Freunde-Liga
      </Text>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 12,
          color: theme.textMuted,
          marginTop: 4,
          textAlign: 'center',
        }}
      >
        Lade deine Freunde ein und vergleicht euch direkt. In Kürze.
      </Text>
    </View>
  );
}

// ─── Region setup sheet content ─────────────────────────────────────────
// Renders inside the standard FilterSheet — same backdrop, slide and
// swipe-down-to-dismiss as every other bottom sheet in the app.

function RegionSetupContent({
  suggestion,
  onAccept,
  onPickOther,
  onClose,
}: {
  suggestion: { city: string | null; bundesland: Bundesland | null };
  onAccept: () => void;
  onPickOther: () => void;
  onClose: () => void;
}) {
  const { theme } = useTokens();
  const [showInfo, setShowInfo] = useState(false);

  const city = suggestion.city ?? '';
  const bl = suggestion.bundesland ?? '';

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <MaterialCommunityIcons
          name="map-marker-radius"
          size={18}
          color={theme.primary}
        />
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 18,
            color: theme.text,
            letterSpacing: -0.2,
          }}
        >
          Hilf {city || 'deiner Stadt'} in der Liga
        </Text>
      </View>
      {city && bl ? (
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
          {city} sammelt diesen Monat schon kräftig — und {bl} liegt vorne
          unter den Bundesländern. ⚡
        </Text>
      ) : (
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
          Sag uns wo du wohnst, und deine Punkte zählen für deine Stadt und
          dein Bundesland.
        </Text>
      )}

      {city && bl ? (
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
            Für {city} mitspielen
          </Text>
        </Pressable>
      ) : null}
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

      <View
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: theme.border,
          flexDirection: 'row',
          justifyContent: 'space-between',
        }}
      >
        <Pressable onPress={() => setShowInfo((v) => !v)} hitSlop={6}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.semibold,
              fontSize: 12,
              color: theme.textMuted,
            }}
          >
            ⓘ {showInfo ? 'Weniger anzeigen' : 'Mehr Infos'}
          </Text>
        </Pressable>
        <Pressable onPress={onClose} hitSlop={6}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.semibold,
              fontSize: 12,
              color: theme.textMuted,
            }}
          >
            Schließen
          </Text>
        </Pressable>
      </View>
      {showInfo ? (
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            lineHeight: 16,
            color: theme.textMuted,
            marginTop: 10,
          }}
        >
          Dein Display-Name + deine Stadt erscheinen auf der Bestenliste.
          Aggregierte Statistiken (z. B. Top-Marken pro Stadt) können wir an
          Händler weitergeben — dabei tauchst du nicht persönlich auf.
        </Text>
      ) : null}
    </View>
  );
}
