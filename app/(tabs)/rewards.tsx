import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { doc, updateDoc } from 'firebase/firestore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { db } from '@/lib/firebase';
import {
  BUNDESLAENDER,
  type Bundesland,
  getLeaderboard,
  getUserContribution,
  type LbPeriod,
  type LbRow,
  type LbScope,
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
// Collective scoring: each user's points are added anonymously to their
// city + Bundesland counters. Lists rank cities / Bundesländer; users
// never appear individually. The user's own region row is highlighted
// and a private "Dein Beitrag"-card shows their personal contribution.
//
// Region setup is opt-in via a friendly suggestion sheet — never
// silent. Picking a Bundesland writes it back to the userProfile and
// the lists update.

function RanksTab() {
  const { theme } = useTokens();
  const { user, userProfile, refreshUserProfile } = useAuth();

  const [scope, setScope] = useState<LbScope>('bundesland');
  const [period, setPeriod] = useState<LbPeriod>('month');

  const userBL = (userProfile as any)?.bundesland ?? null;
  const userCity = (userProfile as any)?.city ?? null;
  const hasRegion = !!userBL;

  const [rows, setRows] = useState<LbRow[]>([]);
  const [contribution, setContribution] = useState<{
    pts: number;
    city: string;
    bundesland: string;
  } | null>(null);

  // Region setup sheets
  const [setupOpen, setSetupOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    city: string | null;
    bundesland: Bundesland | null;
  }>({ city: null, bundesland: null });

  // Reload ranks whenever scope, period, or the user's region changes.
  useEffect(() => {
    let alive = true;
    getLeaderboard(scope, period, userBL, userCity).then((r) => {
      if (alive) setRows(r);
    });
    getUserContribution(period, userBL, userCity).then((c) => {
      if (alive) setContribution(c);
    });
    return () => {
      alive = false;
    };
  }, [scope, period, userBL, userCity]);

  // Open the suggestion sheet — load a guess from the journey lookup
  // first, then show. (Today: stub returns München / Bayern.)
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
        await updateDoc(doc(db, 'users', user.uid), {
          bundesland,
          city,
        });
        await refreshUserProfile();
      } catch (e) {
        console.warn('Rewards: saveRegion failed', e);
      }
    },
    [user?.uid, refreshUserProfile],
  );

  return (
    <>
      {/* Personal contribution card OR setup-nudge */}
      <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
        {hasRegion && contribution ? (
          <ContributionCard
            contribution={contribution}
            period={period}
            onChangeRegion={openSetup}
          />
        ) : (
          <SetupNudge onPress={openSetup} />
        )}
      </View>

      {/* Scope tabs (Bundesländer / Städte) — animated pill, but no
          inner PagerView swipe here: the parent already swipes between
          Einlösen and Bestenliste, and nesting a second horizontal
          swipe inside that creates gesture conflicts. The animated
          pill alone is enough for an inline filter-like switch. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
        <SegmentedTabs
          tabs={[
            { key: 'bundesland', label: 'Bundesländer' },
            { key: 'stadt', label: 'Städte' },
          ] as const}
          value={scope}
          onChange={setScope}
        />
      </View>

      {/* Period filter */}
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

      {/* Ranked list */}
      <View
        style={{
          marginHorizontal: 20,
          marginTop: 16,
          backgroundColor: theme.surface,
          borderRadius: 16,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: theme.border,
        }}
      >
        {rows.map((r, i) => (
          <RankRow key={r.key} row={r} isLast={i === rows.length - 1} />
        ))}
      </View>

      {/* Region setup suggestion sheet */}
      <RegionSetupSheet
        visible={setupOpen}
        suggestion={suggestion}
        onClose={() => setSetupOpen(false)}
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
      />

      {/* Manual Bundesland picker */}
      <RegionPickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={async (bundesland, city) => {
          await saveRegion(bundesland, city);
          setPickerOpen(false);
        }}
      />
    </>
  );
}

// ─── Sub-pieces of the RanksTab ─────────────────────────────────────────

function ContributionCard({
  contribution,
  period,
  onChangeRegion,
}: {
  contribution: { pts: number; city: string; bundesland: string };
  period: LbPeriod;
  onChangeRegion: () => void;
}) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
        borderRadius: 16,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: theme.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons
          name="star-four-points"
          size={22}
          color={theme.primary}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 14,
            color: theme.text,
          }}
        >
          {period === 'month' ? 'Dein Beitrag diesen Monat' : 'Dein Beitrag insgesamt'}
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 12,
            color: theme.textSub,
            marginTop: 2,
          }}
        >
          {contribution.pts.toLocaleString('de-DE')} Punkte für{' '}
          <Text style={{ fontWeight: fontWeight.bold, color: theme.text }}>
            {contribution.city}
          </Text>{' '}
          ({contribution.bundesland})
        </Text>
      </View>
      <Pressable onPress={onChangeRegion} hitSlop={8}>
        <MaterialCommunityIcons
          name="pencil-outline"
          size={18}
          color={theme.textMuted}
        />
      </Pressable>
    </View>
  );
}

function SetupNudge({ onPress }: { onPress: () => void }) {
  const { theme } = useTokens();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
        borderRadius: 16,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: theme.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons
          name="map-marker-radius"
          size={22}
          color={theme.primary}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 14,
            color: theme.text,
          }}
        >
          Spiel für deine Stadt mit
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 12,
            color: theme.textSub,
            marginTop: 2,
          }}
        >
          Verrate uns deine Region und sammle Punkte für deine Stadt
        </Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={theme.textMuted}
      />
    </Pressable>
  );
}

function RankRow({ row, isLast }: { row: LbRow; isLast: boolean }) {
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
      <View
        style={{
          width: 28,
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 14,
            color: row.rank <= 3 ? theme.primary : theme.textMuted,
          }}
        >
          {row.rank}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 14,
            color: theme.text,
          }}
        >
          {row.label}
          {row.isMe ? (
            <Text style={{ color: theme.primary }}> · Du</Text>
          ) : null}
        </Text>
        {row.bundesland ? (
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
            {row.bundesland}
          </Text>
        ) : null}
      </View>
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
    </View>
  );
}

// ─── Region setup sheet ─────────────────────────────────────────────────
// Friendly opt-in flow when the user hasn't set their region yet.
// Pre-fills the suggestion from journey IP-lookup (stubbed today).

function RegionSetupSheet({
  visible,
  suggestion,
  onClose,
  onAccept,
  onPickOther,
}: {
  visible: boolean;
  suggestion: { city: string | null; bundesland: Bundesland | null };
  onClose: () => void;
  onAccept: () => void;
  onPickOther: () => void;
}) {
  const { theme } = useTokens();
  const [showInfo, setShowInfo] = useState(false);

  const city = suggestion.city ?? '';
  const bl = suggestion.bundesland ?? '';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.4)',
          justifyContent: 'flex-end',
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingTop: 8,
            paddingBottom: 24,
          }}
        >
          {/* Drag handle */}
          <View
            style={{
              alignSelf: 'center',
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.borderStrong,
              marginBottom: 12,
            }}
          />

          <View style={{ paddingHorizontal: 22 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
              }}
            >
              <MaterialCommunityIcons
                name="map-marker-radius"
                size={18}
                color={theme.primary}
              />
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 22,
                  color: theme.text,
                  letterSpacing: -0.3,
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
                  marginTop: 4,
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
                  marginTop: 4,
                }}
              >
                Sag uns wo du wohnst, und deine Punkte zählen für deine Stadt
                und dein Bundesland.
              </Text>
            )}

            {/* CTAs */}
            {city && bl ? (
              <Pressable
                onPress={onAccept}
                style={({ pressed }) => ({
                  marginTop: 22,
                  height: 52,
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
                height: 52,
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

            {/* Footer line — Mehr Infos / Schließen */}
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
                Wir nutzen deine ungefähre Position aus der App-Nutzung
                anonym für Stadt- und Bundesland-Statistiken. Du persönlich
                tauchst dabei nirgends auf — nur Stadt- und Bundesland-Summen.
                Aggregierte Markt-Insights (z. B. Top-Marken pro Stadt) können
                wir an Händler weitergeben — auch hier ohne dich persönlich.
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Region picker sheet ───────────────────────────────────────────────
// Manual fallback — list of all 16 Bundesländer. City for now is the
// Bundesland's own name (most users → Bundesland-Liga only). A real
// city-picker is next iteration.

function RegionPickerSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (bundesland: string, city: string) => void;
}) {
  const { theme } = useTokens();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.4)',
          justifyContent: 'flex-end',
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingTop: 8,
            paddingBottom: 24,
            maxHeight: '80%',
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.borderStrong,
              marginBottom: 12,
            }}
          />
          <View style={{ paddingHorizontal: 22 }}>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 22,
                color: theme.text,
                letterSpacing: -0.3,
                marginBottom: 12,
              }}
            >
              Wähle dein Bundesland
            </Text>
          </View>
          <ScrollView style={{ maxHeight: 480 }}>
            {BUNDESLAENDER.map((bl) => (
              <Pressable
                key={bl}
                onPress={() => onPick(bl, bl)}
                style={({ pressed }) => ({
                  paddingHorizontal: 22,
                  paddingVertical: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
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
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
