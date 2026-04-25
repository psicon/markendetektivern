import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
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

import { FilterSheet } from '@/components/design/FilterSheet';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { db } from '@/lib/firebase';
import {
  getAggregateUpdatedAt,
  getBundeslandRanks,
  getCityRanks,
  getOverallUsers,
  type LbRow,
  type LbUser,
  userContributionFromProfile,
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
type Period = 'all' | 'year' | 'month' | 'week';

function RanksTab() {
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

  // ─── Outer scope: Overall | Regionenkampf (PagerView) ──────────
  const [outerScope, setOuterScope] = useState<LbScopeOuter>('overall');
  const outerPagerRef = useRef<PagerView | null>(null);
  const onOuterChange = (next: LbScopeOuter) => {
    setOuterScope(next);
    outerPagerRef.current?.setPage(next === 'overall' ? 0 : 1);
  };
  const onOuterPagerSelected = (e: { nativeEvent: { position: number } }) => {
    const next: LbScopeOuter = e.nativeEvent.position === 0 ? 'overall' : 'region';
    setOuterScope((prev) => (prev === next ? prev : next));
  };

  // ─── Overall: metric + period ─────────────────────────────────
  const [metric, setMetric] = useState<OverallMetric>('pts');
  const [overallPeriod, setOverallPeriod] = useState<Period>('all');

  // ─── Regionenkampf: geo + period ──────────────────────────────
  const [geo, setGeo] = useState<RegionGeo>('bundesland');
  const [regionPeriod, setRegionPeriod] = useState<Period>('all');

  // ─── Data ─────────────────────────────────────────────────────
  const [overallUsers, setOverallUsers] = useState<LbUser[]>([]);
  const [blRows, setBlRows] = useState<LbRow[]>([]);
  const [cityRows, setCityRows] = useState<LbRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    if (overallPeriod === 'all') {
      getOverallUsers(userNick, 'all', metric).then(
        (r) => alive && setOverallUsers(r),
      );
    } else {
      setOverallUsers([]);
    }
    return () => {
      alive = false;
    };
  }, [userNick, metric, overallPeriod]);

  useEffect(() => {
    let alive = true;
    if (regionPeriod === 'all') {
      if (geo === 'bundesland') {
        getBundeslandRanks(userBL, 'all', 'pts').then(
          (r) => alive && setBlRows(r),
        );
      } else {
        getCityRanks(userCity, 'all', 'pts').then(
          (r) => alive && setCityRows(r),
        );
      }
    }
    return () => {
      alive = false;
    };
  }, [userBL, userCity, geo, regionPeriod]);

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

  // The user's rank within the active list — used by the
  // "Deine Position" card to show their global position even if
  // they're outside the top-50.
  const userOverallRank = overallUsers.find((u) => u.isMe)?.rank ?? null;
  const userBLRank = blRows.find((r) => r.isMe)?.rank ?? null;
  const userCityRank = cityRows.find((r) => r.isMe)?.rank ?? null;

  return (
    <>
      {/* ─── Outer scope: 2 SCOPE-CARDS (NOT pills) ───
          Card-style selector visually distinct from the parent
          "Einlösen | Bestenliste" pill, so we don't have stacked
          identical-looking tab rows. Same family as the period
          cards below. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
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
        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          <SetupNudge
            guessedCity={userCity}
            onPress={() => setSetupOpen(true)}
          />
        </View>
      ) : null}

      {/* ─── Outer pager (Overall / Regionenkampf) ─── */}
      <PagerView
        ref={outerPagerRef}
        style={{ height: 1100 }}
        initialPage={0}
        onPageSelected={onOuterPagerSelected}
      >
        {/* ════ PAGE 1 — Overall ════ */}
        <View key="overall">
          {/* Period cards (4 items, horizontal scroll) — same family
              as the scope cards above. */}
          <View style={{ paddingTop: 14 }}>
            <PeriodSwitcher value={overallPeriod} onChange={setOverallPeriod} />
          </View>

          <HeroBanner
            icon={metric === 'pts' ? 'trophy' : 'cash-multiple'}
            title={metric === 'pts' ? 'Punkte Bestenliste' : 'Ersparnis-Bestenliste'}
            subtitle={
              metric === 'pts'
                ? 'Wer sammelt die meisten Punkte?'
                : 'Wer hat am meisten gespart?'
            }
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

          {overallPeriod !== 'all' ? (
            <PeriodComingSoon period={overallPeriod} />
          ) : (
            <UserBoard
              users={overallUsers}
              metric={metric}
              userRank={userOverallRank}
              myEntry={
                userOverallRank !== null
                  ? overallUsers.find((u) => u.isMe) ?? null
                  : null
              }
              userMetricValue={metric === 'pts' ? contribution?.pts ?? 0 : contribution?.eur ?? 0}
              totalUsers={overallUsers.length}
            />
          )}

          <RefreshHint updatedAt={updatedAt} />
        </View>

        {/* ════ PAGE 2 — Regionenkampf ════ */}
        <View key="region">
          <View style={{ paddingTop: 14 }}>
            <PeriodSwitcher value={regionPeriod} onChange={setRegionPeriod} />
          </View>
          <HeroBanner
            icon={geo === 'bundesland' ? 'map' : 'city'}
            title={geo === 'bundesland' ? 'Bundesländer-Liga' : 'Städte-Liga'}
            inlineSelector={
              <InlineToggle
                value={geo}
                onChange={setGeo}
                options={[
                  { key: 'bundesland', label: 'Bundesländer' },
                  { key: 'stadt', label: 'Städte' },
                ]}
              />
            }
            subtitle={
              geo === 'bundesland'
                ? 'Welche Region sammelt am meisten Punkte?'
                : 'Welche Stadt liegt vorne?'
            }
          />

          {regionPeriod !== 'all' ? (
            <PeriodComingSoon period={regionPeriod} />
          ) : (
            <RegionBoard
              rows={geo === 'bundesland' ? blRows : cityRows}
              showBundesland={geo === 'stadt'}
              myRank={geo === 'bundesland' ? userBLRank : userCityRank}
              myLabel={geo === 'bundesland' ? userBL : userCity}
            />
          )}

          <RefreshHint updatedAt={updatedAt} />
        </View>
      </PagerView>

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
  const { theme, shadows } = useTokens();
  const items: {
    key: Period;
    icon: string;
    title: string;
    sub: string;
    iconColor: string;
    bg: string;
  }[] = [
    {
      key: 'all',
      icon: '👑',
      title: 'Legendär',
      sub: 'Aller Zeiten',
      iconColor: '#f5b301',
      bg: '#fff3c2',
    },
    {
      key: 'year',
      icon: '🏆',
      title: 'Champion',
      sub: 'Dieses Jahr',
      iconColor: '#bf8636',
      bg: '#fff0d0',
    },
    {
      key: 'month',
      icon: '⭐',
      title: 'Rising Star',
      sub: 'Dieser Monat',
      iconColor: '#f5b301',
      bg: '#fff7d8',
    },
    {
      key: 'week',
      icon: '🔥',
      title: 'On Fire',
      sub: 'Diese Woche',
      iconColor: '#e64f1f',
      bg: '#ffe3d6',
    },
  ];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollsToTop={false}
      contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
    >
      {items.map((it) => {
        const on = value === it.key;
        return (
          <Pressable
            key={it.key}
            onPress={() => onChange(it.key)}
            style={({ pressed }) => ({
              minWidth: 150,
              height: 64,
              borderRadius: 14,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: on ? it.bg : theme.surface,
              borderWidth: on ? 0 : 1,
              borderColor: theme.border,
              opacity: pressed ? 0.9 : 1,
              ...(on ? shadows.sm : {}),
            })}
          >
            <Text style={{ fontSize: 22 }}>{it.icon}</Text>
            <View>
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 14,
                  color: on ? '#191c1d' : theme.text,
                }}
              >
                {it.title}
              </Text>
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 11,
                  color: on ? '#6b6b6b' : theme.textMuted,
                  marginTop: 1,
                }}
              >
                {it.sub}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ─── Yellow hero banner ─────────────────────────────────────────────────

function HeroBanner({
  icon,
  title,
  subtitle,
  inlineSelector,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  subtitle: string;
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
        marginTop: 16,
        borderRadius: 16,
        paddingVertical: 16,
        paddingHorizontal: 16,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <MaterialCommunityIcons name={icon} size={28} color="#5a3500" />
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 17,
              color: '#1a1a1a',
              letterSpacing: -0.2,
            }}
          >
            {title}
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 12,
              color: '#3a3a3a',
              marginTop: 2,
            }}
          >
            {subtitle}
          </Text>
        </View>
      </View>
      {inlineSelector ? <View style={{ marginTop: 12 }}>{inlineSelector}</View> : null}
    </LinearGradient>
  );
}

// ─── Scope card (Overall / Regionenkampf top selector) ──────────────────

function ScopeCard({
  active,
  onPress,
  icon,
  title,
  sub,
}: {
  active: boolean;
  onPress: () => void;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  sub: string;
}) {
  const { theme, shadows } = useTokens();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 76,
        borderRadius: 14,
        padding: 12,
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
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: active ? theme.primary : theme.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons
            name={icon}
            size={18}
            color={active ? '#fff' : theme.primary}
          />
        </View>
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
          fontSize: 11,
          color: theme.textMuted,
          marginTop: 6,
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
    year: {
      icon: '🏆',
      title: 'Champion-Liga öffnet bald',
      body: 'Mit dem nächsten Jahres-Reset startet die Champion-Liga. Sammle ab jetzt Punkte fürs Jahresergebnis.',
    },
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
  userRank,
  myEntry,
  userMetricValue,
  totalUsers,
}: {
  users: LbUser[];
  metric: OverallMetric;
  userRank: number | null;
  myEntry: LbUser | null;
  userMetricValue: number;
  totalUsers: number;
}) {
  const { theme } = useTokens();
  if (users.length === 0) {
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
  return (
    <>
      <View
        style={{
          marginHorizontal: 20,
          marginTop: 14,
          gap: 10,
        }}
      >
        {users.map((u) => (
          <UserCard key={u.id} user={u} metric={metric} />
        ))}
      </View>
      <DeinePositionCard
        rank={userRank}
        totalUsers={totalUsers}
        metric={metric}
        myValue={userMetricValue}
        inList={!!myEntry}
      />
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

function RegionBoard({
  rows,
  showBundesland,
  myRank,
  myLabel,
}: {
  rows: LbRow[];
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
  return (
    <>
      <View
        style={{
          marginHorizontal: 20,
          marginTop: 14,
          gap: 10,
        }}
      >
        {rows.map((r) => (
          <RegionCard key={r.key} row={r} showBundesland={showBundesland} />
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

function RegionCard({
  row,
  showBundesland,
}: {
  row: LbRow;
  showBundesland?: boolean;
}) {
  const { theme, shadows } = useTokens();
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
          {row.users.toLocaleString('de-DE')} Detektive ·{' '}
          {row.eur.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} € gespart
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
        {row.pts.toLocaleString('de-DE')} Pkt
      </Text>
    </View>
  );
}

// ─── Deine Position card (sticky-ish at end of list) ────────────────────

function DeinePositionCard({
  rank,
  totalUsers,
  metric,
  myValue,
  inList,
}: {
  rank: number | null;
  totalUsers: number;
  metric: OverallMetric;
  myValue: number;
  inList: boolean;
}) {
  // Encouraging line — tiered by approximate percentile, since we
  // don't know the EXACT global rank for users outside the top-50.
  let tagline = 'Sammle Punkte und mach mit!';
  if (inList && rank !== null) {
    if (rank === 1) tagline = '🏆 Du bist die Nr. 1 — unfassbar!';
    else if (rank <= 3) tagline = '🥇 Auf dem Treppchen — stark!';
    else if (rank <= 10) tagline = '🔥 Top 10 — du jagst die Spitze!';
    else tagline = '💪 In den Top 50 — bleib dran!';
  } else if (myValue > 0) {
    tagline = '🚀 Sammle weiter — die Top 50 sind dein Ziel!';
  } else {
    tagline = '🎯 Erste Punkte sammeln und einsteigen!';
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
          Deine Position
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 18,
            color: '#fff',
          }}
        >
          {rank !== null ? `Platz ${rank}` : 'Außerhalb Top 50'}
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
        {tagline}
        {' · '}
        {metric === 'pts'
          ? `${myValue.toLocaleString('de-DE')} Pkt`
          : `${myValue.toFixed(2).replace('.', ',')} € gespart`}
      </Text>
    </LinearGradient>
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
