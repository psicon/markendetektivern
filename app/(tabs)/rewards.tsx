import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';

// ─── Demo data ─────────────────────────────────────────────────────────
// Lifted directly from `markendetektive_newdesign/project/Rewards.jsx`
// so the screen renders something realistic in Phase 2. Wire-up to
// real services / Firestore comes when the backend exposes the
// Cashback-Taler model — until then this is hard-coded.
const CASHBACK_EUR = 12.4;
const PAYOUT_THRESHOLD = 15.0;

type CashbackCatKey = 'all' | 'gift' | 'prepaid' | 'money' | 'charity';
type CashbackCat = {
  k: CashbackCatKey;
  l: string;
  i: keyof typeof MaterialCommunityIcons.glyphMap;
};
const CASHBACK_CATS: readonly CashbackCat[] = [
  { k: 'all', l: 'Alle', i: 'view-grid-outline' },
  { k: 'gift', l: 'Gutscheine', i: 'ticket-percent' },
  { k: 'prepaid', l: 'Prepaid', i: 'credit-card-outline' },
  { k: 'money', l: 'Auszahlung', i: 'cash-multiple' },
  { k: 'charity', l: 'Spenden', i: 'heart-outline' },
] as const;

type Reward = {
  id: string;
  cat: Exclude<CashbackCatKey, 'all'>;
  brand: string;
  value: string;
  tint: string;
  short: string;
  hot?: boolean;
};
const CASHBACK_REWARDS: readonly Reward[] = [
  { id: 'amazon-de', cat: 'gift', brand: 'Amazon.de', value: '15 €', tint: '#ff9900', short: 'a', hot: true },
  { id: 'rewe', cat: 'gift', brand: 'Rewe', value: '15 €', tint: '#cc071e', short: 'R' },
  { id: 'kaufland', cat: 'gift', brand: 'Kaufland', value: '15 €', tint: '#e10915', short: 'K' },
  { id: 'penny', cat: 'gift', brand: 'Penny', value: '15 €', tint: '#d40f14', short: 'P' },
  { id: 'rossmann', cat: 'gift', brand: 'Rossmann', value: '15 €', tint: '#e3001a', short: 'R' },
  { id: 'lieferando', cat: 'gift', brand: 'Lieferando', value: '15 €', tint: '#ff8000', short: 'L' },
  { id: 'amazon-com', cat: 'gift', brand: 'Amazon.com', value: '25 €', tint: '#232f3e', short: 'a' },
  { id: 'apple', cat: 'gift', brand: 'Apple', value: '25 €', tint: '#000', short: '' },
  { id: 'google', cat: 'gift', brand: 'Google Play', value: '15 €', tint: '#4285f4', short: 'G' },
  { id: 'visa-v', cat: 'prepaid', brand: 'Virtual Visa', value: '25 €', tint: '#1a1f71', short: 'VISA' },
  { id: 'visa-p', cat: 'prepaid', brand: 'Physical Visa', value: '50 €', tint: '#0e164d', short: 'VISA' },
  { id: 'paypal', cat: 'money', brand: 'PayPal', value: '15 €', tint: '#003087', short: 'P', hot: true },
  { id: 'msf', cat: 'charity', brand: 'Ärzte ohne Grenzen', value: '15 € Spende', tint: '#c0392b', short: '✚' },
  { id: 'irc', cat: 'charity', brand: 'Int. Rescue Committee', value: '15 € Spende', tint: '#d4231a', short: 'IRC' },
  { id: 'stc', cat: 'charity', brand: 'Save the Children', value: '15 € Spende', tint: '#e8384f', short: 'S' },
];

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
            <PlaceholderSection
              icon="trophy-outline"
              title="Bestenliste"
              body="Leaderboard für Freunde / Bundesland mit Monats- und All-Time-Wertung sowie City-Battle kommen in Phase 3."
            />
          </ScrollView>
        </View>
      </PagerView>

      {/* Chrome — absolute, content scrolls under */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          paddingTop: insets.top,
        }}
        pointerEvents="box-none"
      >
        {Platform.OS === 'ios' ? (
          <BlurView tint={scheme === 'dark' ? 'dark' : 'light'} intensity={80}>
            {ChromeContent}
          </BlurView>
        ) : (
          <View
            style={{
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
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
// EINLÖSEN TAB
// ────────────────────────────────────────────────────────────────────────

function RedeemTab() {
  const { theme } = useTokens();
  const [filter, setFilter] = useState<CashbackCatKey>('all');
  const items =
    filter === 'all'
      ? CASHBACK_REWARDS
      : CASHBACK_REWARDS.filter((r) => r.cat === filter);
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

      {/* ── Reward catalogue ── */}
      <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
        <SectionHeader
          title="Einlösen"
          sub={`${CASHBACK_REWARDS.length} Belohnungen`}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          scrollsToTop={false}
          contentContainerStyle={{ paddingVertical: 8, gap: 6 }}
          style={{ marginHorizontal: -20, paddingHorizontal: 20 }}
        >
          {CASHBACK_CATS.map((c) => (
            <CategoryChip
              key={c.k}
              cat={c}
              active={filter === c.k}
              onPress={() => setFilter(c.k)}
            />
          ))}
        </ScrollView>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 12,
            marginTop: 4,
          }}
        >
          {items.map((r) => (
            <RewardCard key={r.id} reward={r} canRedeem={canRedeem} />
          ))}
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

function CategoryChip({
  cat,
  active,
  onPress,
}: {
  cat: CashbackCat;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useTokens();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        height: 34,
        paddingHorizontal: 12,
        borderRadius: 17,
        backgroundColor: active ? theme.primary : theme.surface,
        borderWidth: active ? 0 : 1,
        borderColor: theme.borderStrong,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <MaterialCommunityIcons
        name={cat.i}
        size={14}
        color={active ? '#fff' : theme.primary}
      />
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.semibold,
          fontSize: 12,
          color: active ? '#fff' : theme.text,
        }}
      >
        {cat.l}
      </Text>
    </Pressable>
  );
}

function RewardCard({
  reward,
  canRedeem,
}: {
  reward: Reward;
  canRedeem: boolean;
}) {
  const { theme, shadows } = useTokens();
  return (
    <Pressable
      style={({ pressed }) => ({
        // Two columns on a 20-px-padded screen with a 12-px gap.
        // Width formula matches the Stöbern grid math.
        width: '48.5%',
        backgroundColor: theme.surface,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        overflow: 'hidden',
        opacity: pressed ? 0.94 : canRedeem ? 1 : 0.88,
        ...shadows.sm,
      })}
    >
      {reward.hot ? (
        <View
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 2,
            backgroundColor: '#ff3b30',
            paddingHorizontal: 7,
            paddingVertical: 3,
            borderRadius: 6,
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 9,
              letterSpacing: 0.8,
              color: '#fff',
              textTransform: 'uppercase',
            }}
          >
            Beliebt
          </Text>
        </View>
      ) : null}
      <View
        style={{
          height: 80,
          backgroundColor: reward.tint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 28,
            color: '#fff',
            letterSpacing: -0.5,
          }}
        >
          {reward.short}
        </Text>
      </View>
      <View style={{ padding: 12 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 13,
            color: theme.text,
          }}
        >
          {reward.brand}
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 16,
            color: theme.primary,
            marginTop: 2,
          }}
        >
          {reward.value}
        </Text>
      </View>
    </Pressable>
  );
}

function PlaceholderSection({
  icon,
  title,
  body,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  body: string;
}) {
  const { theme, shadows } = useTokens();
  return (
    <View
      style={{
        marginHorizontal: 20,
        marginTop: 24,
        padding: 20,
        backgroundColor: theme.surface,
        borderRadius: radii.lg,
        alignItems: 'center',
        ...shadows.sm,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 14,
        }}
      >
        <MaterialCommunityIcons name={icon} size={28} color={theme.primary} />
      </View>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 18,
          color: theme.text,
          marginBottom: 6,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 13,
          lineHeight: 19,
          color: theme.textMuted,
          textAlign: 'center',
        }}
      >
        {body}
      </Text>
    </View>
  );
}
