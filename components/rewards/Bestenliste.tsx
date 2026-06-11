import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  CITY_TO_BUNDESLAND,
  normalizeCityName,
} from '@/lib/data/city-to-bundesland';
import { LinearGradient } from 'expo-linear-gradient';
import { doc, updateDoc } from '@react-native-firebase/firestore';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Image as RNImage,
  Pressable,
  ScrollView,
  Text,
  View,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterSheet } from '@/components/design/FilterSheet';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { useAchievements } from '@/lib/hooks/useAchievements';
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
import { safePush } from '@/lib/utils/safeNav';
import type { Level } from '@/lib/types/achievements';

// ════════════════════════════════════════════════════════════════════════
// BESTENLISTE — extracted from app/(tabs)/rewards.tsx so the Achievements
// screen can host it under a "Bestenliste" tab. Exports the BestenlisteTab
// (top of page, takes outerScope/geo/etc as props) plus PositionStickyBar
// (the floating "Deine Position" overlay rendered as a screen-fixed sibling
// of the scroller). All sub-components stay private.
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

export function BestenlisteTab({
  userStats,
  levels,
}: {
  userStats: ReturnType<typeof useAchievements>['userStats'];
  levels: Level[];
}) {
  // Eine Seite, zwei Buehnen (User-Feedback Runde 4): Deine Liga oben,
  // Regionen-Kampf als eigene Arena-Sektion darunter — beides IMMER
  // sichtbar, kein Scope-Switch, kein Lifting mehr noetig.
  const [geo, setGeo] = useState<RegionGeo>('bundesland');
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



  // ─── Overall: period ──────────────────────────────────────────
  // ClickUp 86ca6qwb2: Die User-Bestenliste zeigt NUR Punkte —
  // oeffentliche Geld-Summen einzelner Nutzer sind raus. Die
  // Ersparnis-Metrik lebt weiter im Regionenkampf (regionMetric),
  // dort sind es Aggregate ohne Personenbezug.
  // Liga-Modell (ClickUp 86ca6qwb2, 2026-06-11): Standard = Monats-
  // Liga (lebender Wettbewerb, jeder hat eine Chance). Woche via
  // Zeitraum-Chip; 'all' ist als "Hall of Fame" inszeniert.
  const [overallPeriod, setOverallPeriod] = useState<Period>('month');
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);

  // ─── Regionenkampf: metric ────────────────────────────────────
  // No period switcher here — region duels are always lifetime
  // ("Aller Zeiten"). The two axes the user wants to compare are
  // BL vs City (lifted state) and Punkte vs Ersparnis (local).
  const [regionMetric, setRegionMetric] = useState<OverallMetric>('pts');
  // Liga-Header der User-Liga (Periode + Countdown).
  const leagueHeader = {
    title: `${PERIOD_META[overallPeriod].emoji} ${PERIOD_META[overallPeriod].name}`,
    sub: `${PERIOD_META[overallPeriod].klartext}${
      formatSeasonCountdown(overallPeriod)
        ? ` · ${formatSeasonCountdown(overallPeriod)}`
        : ''
    }`,
    chip: PERIOD_META[overallPeriod].chipLabel,
    gold: overallPeriod === 'all',
  };

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
  }, [overallPeriod]);

  useEffect(() => {
    let alive = true;
    getOverallUsers(userNick, overallPeriod, 'pts').then(
      (r) => alive && setOverallUsers(r),
    );
    return () => {
      alive = false;
    };
  }, [userNick, overallPeriod]);

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

      {/* ─── Liga-Header: das EINZIGE Steuerelement (keine Tabs mehr —
          User-Feedback 2026-06-11 'immer noch Tabs in Tabs'). Titel +
          Klartext links, Liga-Chip rechts öffnet das Sheet mit ALLEN
          fünf Ligen (Monat/Woche/Hall of Fame + Länder/Städte). ─── */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 17,
              letterSpacing: -0.2,
              color: leagueHeader.gold ? '#c98a00' : theme.text,
            }}
          >
            {leagueHeader.title}
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
            {leagueHeader.sub}
          </Text>
        </View>
        <Pressable
          onPress={() => setPeriodSheetOpen(true)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            height: 34,
            paddingLeft: 12,
            paddingRight: 8,
            borderRadius: 12,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 12,
              color: theme.text,
            }}
          >
            {leagueHeader.chip}
          </Text>
          <MaterialCommunityIcons
            name="chevron-down"
            size={16}
            color={theme.textMuted}
          />
        </Pressable>
      </View>


      {/* ─── Bühne 1: Deine Liga (Periode via Chip oben) ─── */}
      <UserBoard
        users={overallUsers}
        period={overallPeriod}
        visibleCount={visibleCount}
        onLoadMore={() =>
          setVisibleCount((c) =>
            Math.min(c + LOAD_MORE_STEP, overallUsers.length),
          )
        }
      />

      {/* ─── Bühne 2: Regionen-Kampf — IMMER sichtbar (User-Feedback
          Runde 4: 'nicht verstecken, das ist geiles Binding'). Eigene
          Arena-Sektion mit Geo- + Metrik-Toggle im Scroll-Flow. ─── */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 30,
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
            letterSpacing: -0.2,
            color: theme.text,
          }}
        >
          ⚔️ Regionen-Kampf
        </Text>
      </View>
      <Text
        style={{
          paddingHorizontal: 20,
          marginTop: 2,
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 11,
          color: theme.textMuted,
        }}
      >
        Dein Revier gegen den Rest — Punkte oder Ersparnis, du entscheidest.
      </Text>
      <View
        style={{
          paddingHorizontal: 20,
          paddingTop: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <View style={{ flex: 1 }}>
          <InlineToggle
            value={geo}
            onChange={setGeo}
            options={[
              { key: 'bundesland', label: '🗺️ Länder' },
              { key: 'stadt', label: '🏙️ Städte' },
            ]}
          />
        </View>
        <View style={{ width: 150 }}>
          <InlineToggle
            value={regionMetric}
            onChange={setRegionMetric}
            options={[
              { key: 'pts', label: 'Punkte' },
              { key: 'eur', label: 'Ersparnis' },
            ]}
          />
        </View>
      </View>
      {/* "Spiel für deine Stadt" — kontextuell im Städte-Kampf, wenn
          keine Stadt gesetzt ist. */}
      {geo === 'stadt' && !hasExplicitCity ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <SetupNudge
            guessedCity={userCity}
            onPress={() => setSetupOpen(true)}
          />
        </View>
      ) : null}
      <RegionBoard
        rows={geo === 'bundesland' ? blRows : cityRows}
        metric={regionMetric}
        showBundesland={geo === 'stadt'}
        myRank={geo === 'bundesland' ? userBLRank : userCityRank}
        myLabel={geo === 'bundesland' ? userBL : userCity}
      />

      {/* Errungenschaften leben jetzt komplett auf /achievements
          (erreichbar über den StatusHero oben). Hält die Bestenliste
          fokussiert auf die Liga und vermeidet eine zweite schwere
          Sektion mit Lottie-Loops auf demselben Screen. */}

      <RefreshHint updatedAt={updatedAt} />

      {/* ─── Liga-Sheet: Periode der User-Liga (Regionen-Kampf lebt
          sichtbar auf der Seite, braucht keinen Sheet-Eintrag). ─── */}
      <FilterSheet
        visible={periodSheetOpen}
        title="Liga wählen"
        onClose={() => setPeriodSheetOpen(false)}
      >
        <View style={{ gap: 8, paddingBottom: 8 }}>
          {(['month', 'week', 'all'] as Period[]).map((pKey) => {
            const meta = PERIOD_META[pKey];
            return (
              <LeagueOption
                key={pKey}
                emoji={meta.emoji}
                name={meta.name}
                klartext={meta.klartext}
                desc={meta.desc}
                gold={pKey === 'all'}
                active={overallPeriod === pKey}
                onPress={() => {
                  setOverallPeriod(pKey);
                  setPeriodSheetOpen(false);
                }}
              />
            );
          })}
        </View>
      </FilterSheet>

      {/* ─── Region-Setup-Sheet ─── */}
      <FilterSheet
        visible={setupOpen}
        title="Spiel für deine Stadt"
        onClose={() => setSetupOpen(false)}
      >
        <RegionSetupContent
          suggestion={{ city: userCity, bundesland: userBL }}
          mode={geo}
          onAccept={async () => {
            if (userBL && userCity) await saveRegion(userBL, userCity);
            setSetupOpen(false);
          }}
          onPickOther={() => setSetupOpen(false)}
          onPickBundesland={async (bl) => {
            // Save BL only — keep whatever city the profile already
            // had (or empty).
            await saveRegion(bl, userCity ?? '');
            setSetupOpen(false);
          }}
          onPickCity={async (pickedCity, pickedBl) => {
            // BL kommt aus Schritt 1 des Pickers — beide Ligen haben
            // ab sofort den DU-Highlight.
            await saveRegion(pickedBl, pickedCity);
            setSetupOpen(false);
          }}
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



// ─── Scope card (Overall / Regionenkampf top selector) ──────────────────

// Single selector card used by EVERY selector on the rewards
// screen (Outer scope: Overall/Regionenkampf, Period:
// Legendär/Rising Star/On Fire, Region geo: Bundesländer/Städte).
// Accepts either an MDI icon name (rendered in a coloured circle)
// or a short emoji string (rendered as plain text). One component
// → one design, no visual drift between selectors.
// ─── Liga-Option im Liga-Sheet ──────────────────────────────────────────
function LeagueOption({
  emoji,
  name,
  klartext,
  desc,
  active,
  gold,
  onPress,
}: {
  emoji: string;
  name: string;
  klartext: string;
  desc: string;
  active: boolean;
  gold?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTokens();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 14,
        backgroundColor: active
          ? theme.primaryContainer ?? theme.surfaceAlt
          : theme.surface,
        borderWidth: active ? 1.5 : 1,
        borderColor: active ? theme.primary : theme.border,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Text style={{ fontSize: 22 }}>{emoji}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 14,
            color: gold ? '#c98a00' : theme.text,
          }}
        >
          {name}
          <Text
            style={{ fontWeight: fontWeight.medium, color: theme.textMuted }}
          >
            {'  ·  '}
            {klartext}
          </Text>
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11.5,
            lineHeight: 16,
            color: theme.textSub,
            marginTop: 2,
          }}
        >
          {desc}
        </Text>
      </View>
      {active ? (
        <MaterialCommunityIcons
          name="check-circle"
          size={20}
          color={theme.primary}
        />
      ) : null}
    </Pressable>
  );
}

// ─── Liga-Metadaten + Saison-Countdown (Liga-Modell, 86ca6qwb2) ─────────
// Marketing-Name IMMER mit Klartext kombiniert (User-Feedback: niemand
// weiß, was "Rising Star" ist). 'all' ist bewusst als Hall of Fame
// inszeniert — kein Zeitraum, sondern die Ehrenhalle.
const PERIOD_META: Record<
  Period,
  { emoji: string; name: string; klartext: string; chipLabel: string; desc: string }
> = {
  month: {
    emoji: '⭐',
    name: 'Rising Star',
    klartext: 'Monats-Liga',
    chipLabel: 'Monat',
    desc: 'Wer sammelt diesen Monat die meisten Punkte?',
  },
  week: {
    emoji: '🔥',
    name: 'On Fire',
    klartext: 'Wochen-Liga',
    chipLabel: 'Woche',
    desc: 'Die heißesten Detektive dieser Woche.',
  },
  all: {
    emoji: '👑',
    name: 'Hall of Fame',
    klartext: 'Aller Zeiten',
    chipLabel: 'Aller Zeiten',
    desc: 'Die Allzeit-Legenden — hier zählt das Lebenswerk.',
  },
};

/** "endet in 3 Tagen" / "endet in 14 Std." — null für Hall of Fame. */
function formatSeasonCountdown(period: Period): string | null {
  if (period === 'all') return null;
  const now = new Date();
  let end: Date;
  if (period === 'week') {
    // Saison-Ende: Montag 00:00 (Woche läuft Mo–So).
    const day = now.getDay(); // 0 = So
    const daysToMonday = day === 0 ? 1 : 8 - day;
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToMonday);
  } else {
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  }
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 48) return `endet in ${Math.floor(hours / 24)} Tagen`;
  if (hours >= 2) return `endet in ${hours} Std.`;
  return 'endet gleich';
}


// ─── Inline metric toggle (Section-Header der Region-Liga) ──────────────

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
  period,
  visibleCount,
  onLoadMore,
}: {
  users: LbUser[];
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
      {hasPodium ? <Podium top3={top3} /> : null}
      <View
        style={{
          marginHorizontal: 20,
          marginTop: hasPodium ? 18 : 14,
          gap: 10,
        }}
      >
        {rest.map((u) => (
          <UserCard key={u.id} user={u} />
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

function UserCard({ user }: { user: LbUser }) {
  const { theme, shadows } = useTokens();
  const isTop3 = user.rank <= 3;
  // Nur Punkte — keine oeffentlichen Geld-Summen einzelner User
  // (ClickUp 86ca6qwb2).
  const value = `${user.pts.toLocaleString('de-DE')} Pkt`;
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
          {user.level ? `Level ${user.level}` : ''}
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
        {row.isMe ? <Text style={{ color: '#0d8575' }}> · Du</Text> : null}
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
        // Eigene Region klar markieren (User-Feedback 2026-06-11:
        // "seh nicht welche meine Region ist"): Primary-Ring + Pin.
        borderWidth: row.isMe ? 2 : 1,
        borderColor: row.isMe ? '#0d8575' : border,
        paddingVertical: 12,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {row.isMe ? (
        <View
          style={{
            position: 'absolute',
            top: -9,
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            backgroundColor: '#0d8575',
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: 8,
          }}
        >
          <MaterialCommunityIcons name="map-marker" size={9} color="#fff" />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 9,
              letterSpacing: 0.5,
              color: '#fff',
            }}
          >
            DU
          </Text>
        </View>
      ) : null}
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
  // Identity for the gradient colour only — the hero itself is now
  // exclusively about WHERE THE USER STANDS in the active leaderboard
  // selection. Level/points-total info lives on the Errungenschaften
  // tab one swipe away.
  const level: number =
    userStats?.currentLevel ??
    userProfile?.stats?.currentLevel ??
    userProfile?.level ??
    1;
  const currentLevelInfo = levels.find((l) => l.id === level);
  const gradient = levelGradient(level, currentLevelInfo?.color);

  // ── Position fetching (was on the floating PositionStickyBar) ──
  // Overall mode: percentile / rank from the aggregator service.
  const userPts = Number(userProfile?.stats?.pointsTotal ?? 0);
  const userNick: string | null = userProfile?.display_name ?? null;
  const [position, setPosition] = useState<LbPosition | null>(null);
  useEffect(() => {
    let alive = true;
    getUserPosition(userPts, userNick).then((p) => alive && setPosition(p));
    return () => {
      alive = false;
    };
  }, [userPts, userNick]);


  // ── Badge + Message: Stand des Users in der User-Liga ──
  let badge: string;
  let message: string;
  {
    if (position?.rank !== undefined && position?.rank !== null && position.rank <= 50) {
      badge = `Top ${position.rank}`;
    } else if (position?.rank !== undefined && position?.rank !== null) {
      badge = `Platz ${position.rank}`;
    } else if (position?.approxRank) {
      badge = `Platz ~${position.approxRank.toLocaleString('de-DE')}`;
    } else if (userPts > 0) {
      badge = `${userPts.toLocaleString('de-DE')} Pkt`;
    } else {
      badge = 'Liga';
    }
    message = position?.message ?? '🚀 Sammle Punkte und steige in der Liga auf!';
  }

  return (
    <LinearGradient
      colors={gradient}
      start={{ x: -1, y: 0.34 }}
      end={{ x: 1, y: -0.34 }}
      style={{
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 12,
        overflow: 'hidden',
      }}
    >
      {/* Avatar | name top, then a single row badge + message
          underneath. Hero is now position-only — no level pill,
          no total-points number. Both live on Errungenschaften. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
        }}
      >
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
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
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
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 8,
                backgroundColor: 'rgba(255,255,255,0.22)',
              }}
            >
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 11,
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
                opacity: 0.95,
              }}
            >
              {message}
            </Text>
          </View>
        </View>
      </View>
    </LinearGradient>
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

function Podium({ top3 }: { top3: LbUser[] }) {
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
        <PodiumCard user={r2} medalRank={2} height={108} />
        <PodiumCard user={r1} medalRank={1} height={134} />
        <PodiumCard user={r3} medalRank={3} height={96} />
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
  height,
}: {
  user: LbUser;
  medalRank: 1 | 2 | 3;
  height: number;
}) {
  // Soft pastel surface colours — flat, NO gradient, to match the
  // prototype. Border is a slightly deeper version for definition.
  const bg =
    medalRank === 1 ? '#fff3c2' : medalRank === 2 ? '#e9edef' : '#fbe4d2';
  const border =
    medalRank === 1 ? '#f5b301' : medalRank === 2 ? '#cdd3d6' : '#e6b18c';
  // Nur Punkte + Level — keine oeffentlichen Geld-Summen einzelner
  // User (ClickUp 86ca6qwb2).
  const valueText = `${user.pts.toLocaleString('de-DE')} Pkt`;
  const subText = user.level ? `Level ${user.level}` : '';
  return (
    <View
      style={{
        flex: medalRank === 1 ? 1.15 : 1,
        height,
        borderRadius: 16,
        backgroundColor: bg,
        // Eigene Region klar markieren (User-Feedback 2026-06-11:
        // "seh nicht welche meine Region ist"): Primary-Ring + Pin.
        borderWidth: user.isMe ? 2 : 1,
        borderColor: user.isMe ? '#0d8575' : border,
        paddingVertical: 12,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {user.isMe ? (
        <View
          style={{
            position: 'absolute',
            top: -9,
            alignSelf: 'center',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            backgroundColor: '#0d8575',
            paddingHorizontal: 7,
            paddingVertical: 2,
            borderRadius: 8,
          }}
        >
          <MaterialCommunityIcons name="map-marker" size={9} color="#fff" />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 9,
              letterSpacing: 0.5,
              color: '#fff',
            }}
          >
            DU
          </Text>
        </View>
      ) : null}
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


// Region-side motivational copy. Symmetric to motivationalLine()
// in the leaderboard service but tied to the user's BL/Stadt rank
// inside its own league (16 BLs / top-50 cities).

// ─── Region setup sheet content ──────────────────────────────────────
// Two modes:
//   • Suggestion mode — when we have a guessed city+bundesland, ask
//     "stimmt das?" with [Ja, mitspielen] / [Nein, anderes wählen].
//   • Picker mode — list of 16 Bundesländer to tap. Used when no
//     suggestion exists OR user clicked "Nein" in suggestion mode.
// City picker is a future TODO (1000s of cities → needs search) —
// for now BL alone gets the user into the Bundesländer-Liga, and
// the Städte-Liga shows "Sammle Punkte für deine Stadt!" until they
// set a city via a separate flow.

/** Alle gemappten Städte eines Bundeslands, A-Z, ohne die englischen
 *  Alias-Eintraege (Munich/Cologne/…) aus dem Geocoder-Mapping. */
function citiesForBundesland(bl: string): string[] {
  return Object.entries(CITY_TO_BUNDESLAND)
    .filter(([c, b]) => b === bl && normalizeCityName(c) === c)
    .map(([c]) => c)
    .sort((a, b) => a.localeCompare(b, 'de'));
}

const BUNDESLAENDER = [
  'Baden-Württemberg',
  'Bayern',
  'Berlin',
  'Brandenburg',
  'Bremen',
  'Hamburg',
  'Hessen',
  'Mecklenburg-Vorpommern',
  'Niedersachsen',
  'Nordrhein-Westfalen',
  'Rheinland-Pfalz',
  'Saarland',
  'Sachsen',
  'Sachsen-Anhalt',
  'Schleswig-Holstein',
  'Thüringen',
];

function RegionSetupContent({
  suggestion,
  mode,
  onAccept,
  onPickOther,
  onPickBundesland,
  onPickCity,
}: {
  suggestion: { city: string | null; bundesland: string | null };
  /** Aus welcher Liga das Sheet geöffnet wurde. Städte-Kampf =
   *  ZWEI Schritte: Bundesland → Stadt (A-Z + Suche, alle gemappten
   *  Städte — User-Vorgabe 2026-06-11). */
  mode: 'bundesland' | 'stadt';
  onAccept: () => void;
  onPickOther: () => void;
  onPickBundesland: (bl: string) => void;
  onPickCity: (city: string, bl: string) => void;
}) {
  const { theme } = useTokens();
  const city = suggestion.city ?? '';
  const bl = suggestion.bundesland ?? '';
  // Picker mode toggles when user clicks "Nein, woanders" — also the
  // default when no suggestion exists.
  const [picking, setPicking] = useState(false);
  const showPicker = picking || !(city && bl);
  const cityMode = mode === 'stadt';
  // Schritt-State des Stadt-Flows: erst Bundesland, dann Stadt.
  const [pickedBL, setPickedBL] = useState<string | null>(null);
  const [citySearch, setCitySearch] = useState('');
  const inCityStep = cityMode && pickedBL !== null;
  const cityList = inCityStep
    ? citiesForBundesland(pickedBL).filter((c) =>
        c.toLowerCase().includes(citySearch.trim().toLowerCase()),
      )
    : [];
  const pickerItems = inCityStep ? cityList : BUNDESLAENDER;

  if (showPicker) {
    return (
      <View>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 20,
            color: theme.text,
            textAlign: 'center',
          }}
        >
          {inCityStep ? 'Wähle deine Stadt' : 'Wähle dein Bundesland'}
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 13,
            lineHeight: 18,
            color: theme.textSub,
            textAlign: 'center',
            marginTop: 6,
            marginBottom: 14,
          }}
        >
          {inCityStep
            ? 'Tippe deine Stadt an — deine Punkte zählen dann für die Städte-Liga.'
            : cityMode
              ? 'Schritt 1 von 2 — erst dein Bundesland, dann deine Stadt.'
              : 'Tippe dein Bundesland an — deine Punkte zählen dann für die Bundesländer-Liga.'}
        </Text>
        {inCityStep ? (
          <>
            {/* Zurück zu Schritt 1 + Suchfeld (kanonischer Such-Stil). */}
            <Pressable
              onPress={() => {
                setPickedBL(null);
                setCitySearch('');
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                alignSelf: 'flex-start',
                paddingVertical: 4,
                paddingRight: 8,
                marginBottom: 8,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <MaterialCommunityIcons
                name="chevron-left"
                size={18}
                color={theme.primary}
              />
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.bold,
                  fontSize: 13,
                  color: theme.primary,
                }}
              >
                {pickedBL}
              </Text>
            </Pressable>
            <View
              style={{
                height: 38,
                borderRadius: 11,
                backgroundColor: theme.surface,
                borderWidth: 1,
                borderColor: theme.border,
                paddingHorizontal: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                marginBottom: 10,
              }}
            >
              <MaterialCommunityIcons
                name="magnify"
                size={16}
                color={theme.textMuted}
              />
              <TextInput
                value={citySearch}
                onChangeText={setCitySearch}
                placeholder="Stadt suchen …"
                placeholderTextColor={theme.textMuted}
                autoCorrect={false}
                style={{
                  flex: 1,
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 14,
                  color: theme.text,
                  paddingVertical: 0,
                }}
              />
              {citySearch.length > 0 ? (
                <Pressable onPress={() => setCitySearch('')} hitSlop={8}>
                  <MaterialCommunityIcons
                    name="close-circle"
                    size={16}
                    color={theme.textMuted}
                  />
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}
        <ScrollView
          style={{ maxHeight: inCityStep ? 300 : 360 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {inCityStep && cityList.length === 0 ? (
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 13,
                color: theme.textMuted,
                textAlign: 'center',
                paddingVertical: 24,
              }}
            >
              Keine Stadt gefunden — prüfe die Schreibweise.
            </Text>
          ) : null}
          <View
            style={{
              backgroundColor: theme.surface,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.border,
              overflow: 'hidden',
            }}
          >
            {pickerItems.map((b, i) => (
              <Pressable
                key={b}
                onPress={() =>
                  inCityStep
                    ? onPickCity(b, pickedBL as string)
                    : cityMode
                      ? setPickedBL(b)
                      : onPickBundesland(b)
                }
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 14,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: theme.border,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <MaterialCommunityIcons
                  name={inCityStep ? 'city-variant-outline' : 'map-marker-outline'}
                  size={18}
                  color={theme.textMuted}
                />
                <Text
                  style={{
                    flex: 1,
                    fontFamily,
                    fontWeight: fontWeight.bold,
                    fontSize: 14,
                    color: theme.text,
                  }}
                >
                  {b}
                </Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={18}
                  color={theme.textMuted}
                />
              </Pressable>
            ))}
          </View>
        </ScrollView>
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
          Wir aggregieren anonym — du tauchst nirgends einzeln auf.
        </Text>
      </View>
    );
  }

  // Avoid unused-variable warning while picker mode hides this branch.
  void onPickOther;
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
            onPress={() => setPicking(true)}
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
              Nein, anderes Bundesland wählen
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
          {/* Unreachable now — `showPicker` short-circuits at the top
              when no suggestion exists. Kept as a defensive fallback. */}
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 20,
              color: theme.text,
              textAlign: 'center',
            }}
          >
            Wähle dein Bundesland
          </Text>
        </>
      )}
    </View>
  );
}
