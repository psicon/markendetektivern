/**
 * Kaufhistorie-Statistik (86ca5fjxk) — Ausgaben-Analyse aus den getätigten
 * Käufen, im App-Design (DetailHeader + SegmentedTabs im Chrome, FilterSheet
 * für den Zeitraum, Karten mit shadows.sm + Token-Radii, Charts aus RN-Views).
 *
 * Quelle: /users/{uid}/purchases/* (PurchasedProduct), client-aggregiert:
 * Gesamtausgaben, Marken vs. Eigenmarken, „verpasstes Sparpotenzial" (Σ der
 * beim Markenkauf gespeicherten savings = Differenz zur günstigsten Eigenmarken-
 * Alternative), Monatsverlauf. Segment Alle / Eigenmarken / Marken (wie Stöbern).
 * Modul-Cache (stale-while-revalidate), Shimmer-Skeleton beim Erstladen.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useNavigation } from 'expo-router';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { FilterSheet, OptionList } from '@/components/design/FilterSheet';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { Shimmer } from '@/components/design/Skeletons';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { FirestoreService } from '@/lib/services/firestore';
import purchaseHistoryService, {
  type PurchasedProduct,
} from '@/lib/services/purchaseHistoryService';

type Segment = 'all' | 'brand' | 'noname';

const SEGMENT_TABS: readonly { key: Segment; label: string }[] = [
  { key: 'all', label: 'Alle' },
  { key: 'noname', label: 'Eigenmarken' },
  { key: 'brand', label: 'Marken' },
];
const PERIODS: readonly (readonly [string, string])[] = [
  ['all', 'Gesamter Zeitraum'],
  ['365', 'Letzte 12 Monate'],
  ['90', 'Letzte 90 Tage'],
  ['30', 'Letzte 30 Tage'],
];
const MONTH_LABELS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MISSED = '#d6603a';
const TABS_ROW_HEIGHT = 54;

const formatEur = (n: number) => `${(n || 0).toFixed(2).replace('.', ',')} €`;

// Modul-Cache: re-entry rendert sofort (Skeleton nur beim ersten Laden), danach
// Hintergrund-Revalidierung. RAM-only, TTL.
const CACHE_TTL_MS = 5 * 60_000;
let purchaseCache: { uid: string; data: PurchasedProduct[]; at: number } | null = null;
function cachedFor(uid?: string | null): PurchasedProduct[] | null {
  if (uid && purchaseCache && purchaseCache.uid === uid && Date.now() - purchaseCache.at < CACHE_TTL_MS) {
    return purchaseCache.data;
  }
  return null;
}

// Kategorien (id→name) — statisch, einmal pro App-Session geladen.
let katCache: Record<string, string> | null = null;

export default function PurchaseStatisticsScreen() {
  const { theme, shadows } = useTokens();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user } = useAuth();

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const [purchases, setPurchases] = useState<PurchasedProduct[] | null>(() => cachedFor(user?.uid));
  const [period, setPeriod] = useState('all');
  const [segment, setSegment] = useState<Segment>('all');
  const [marketId, setMarketId] = useState('all');
  const [categoryId, setCategoryId] = useState('all');
  const [katMap, setKatMap] = useState<Record<string, string>>(() => katCache ?? {});
  const [showFilter, setShowFilter] = useState(false);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      setPurchases([]);
      return;
    }
    const cached = cachedFor(uid);
    if (cached) setPurchases(cached);
    let alive = true;
    purchaseHistoryService
      .getUserPurchaseHistory(uid)
      .then((rows) => {
        purchaseCache = { uid, data: rows, at: Date.now() };
        if (alive) setPurchases(rows);
      })
      .catch(() => {
        if (alive && !cached) setPurchases([]);
      });
    return () => {
      alive = false;
    };
  }, [user?.uid]);

  // Kategorie-Namen für den Filter (einmal, gecacht).
  useEffect(() => {
    if (katCache) return;
    let alive = true;
    FirestoreService.getKategorien()
      .then((docs: any[]) => {
        const m: Record<string, string> = {};
        docs.forEach((d) => {
          if (d?.id) m[d.id] = d.bezeichnung || d.name || 'Kategorie';
        });
        katCache = m;
        if (alive) setKatMap(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const primary = theme.primary ?? '#0d8575';
  const chromeHeight = insets.top + DETAIL_HEADER_ROW_HEIGHT + TABS_ROW_HEIGHT;

  const periodFiltered = useMemo(() => {
    const all = purchases ?? [];
    const days = parseInt(period, 10);
    if (!Number.isFinite(days) || days <= 0) return all;
    const cutoff = Date.now() - days * 86_400_000;
    return all.filter((p) => p.purchasedAt instanceof Date && p.purchasedAt.getTime() >= cutoff);
  }, [purchases, period]);

  const filtered = useMemo(() => {
    let rows = periodFiltered;
    if (segment !== 'all') {
      rows = rows.filter((p) => (segment === 'brand' ? p.type === 'markenprodukt' : p.type === 'noname'));
    }
    if (marketId !== 'all') rows = rows.filter((p) => p.discounter?.id === marketId);
    if (categoryId !== 'all') rows = rows.filter((p) => p.kategorieId === categoryId);
    return rows;
  }, [periodFiltered, segment, marketId, categoryId]);

  // Filter-Optionen aus den geladenen Käufen (distinct) für die FilterSheet.
  const marketOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of purchases ?? []) {
      if (p.discounter?.id && p.discounter?.name) {
        m.set(p.discounter.id, `${p.discounter.name}${p.discounter.land ? ` (${p.discounter.land})` : ''}`);
      }
    }
    return [['all', 'Alle Märkte'], ...Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]))] as readonly (readonly [
      string,
      string,
    ])[];
  }, [purchases]);

  const categoryOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of purchases ?? []) {
      if (p.kategorieId) m.set(p.kategorieId, katMap[p.kategorieId] || 'Kategorie');
    }
    return [['all', 'Alle Kategorien'], ...Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]))] as readonly (readonly [
      string,
      string,
    ])[];
  }, [purchases, katMap]);

  const filtersActive = period !== 'all' || marketId !== 'all' || categoryId !== 'all';

  const stats = useMemo(() => {
    let totalEur = 0;
    let brandEur = 0;
    let nonameEur = 0;
    let brandCount = 0;
    let nonameCount = 0;
    let missedEur = 0;
    const monthMap = new Map<string, number>();
    for (const p of filtered) {
      const preis = typeof p.preis === 'number' ? p.preis : 0;
      totalEur += preis;
      if (p.type === 'markenprodukt') {
        brandEur += preis;
        brandCount += 1;
        missedEur += typeof p.savings === 'number' ? p.savings : 0;
      } else {
        nonameEur += preis;
        nonameCount += 1;
      }
      if (p.purchasedAt instanceof Date) {
        const m = `${p.purchasedAt.getFullYear()}-${String(p.purchasedAt.getMonth() + 1).padStart(2, '0')}`;
        monthMap.set(m, (monthMap.get(m) ?? 0) + preis);
      }
    }
    const byMonth = Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12);
    return { totalEur, brandEur, nonameEur, brandCount, nonameCount, missedEur, byMonth, count: filtered.length };
  }, [filtered]);

  const loading = purchases === null;
  const empty = !loading && filtered.length === 0;
  const maxMonth = stats.byMonth.reduce((m, [, c]) => Math.max(m, c), 1);
  const maxSplit = Math.max(stats.brandEur, stats.nonameEur, 0.01);

  const cardStyle = {
    backgroundColor: theme.surface,
    borderRadius: radii.xl,
    ...(shadows?.sm ?? {}),
  } as const;
  const sectionTitleStyle = {
    fontFamily,
    fontWeight: fontWeight.extraBold,
    fontSize: 20,
    color: theme.text,
    letterSpacing: -0.2,
  } as const;
  const eyebrowStyle = {
    fontFamily,
    fontWeight: fontWeight.bold,
    fontSize: 11,
    letterSpacing: 0.6,
    color: theme.textMuted,
    textTransform: 'uppercase',
  } as const;
  const filterLabelStyle = {
    fontFamily,
    fontWeight: fontWeight.extraBold,
    fontSize: 13,
    color: theme.textMuted,
    marginBottom: 8,
  } as const;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {loading ? (
        <ScrollView
          contentContainerStyle={{ paddingTop: chromeHeight + 12, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
          scrollEnabled={false}
        >
          <StatsSkeleton />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: chromeHeight + 12, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Summen-Hero */}
          <View style={{ paddingHorizontal: 20 }}>
            <View style={[cardStyle, { padding: 18 }]}>
              <Text style={eyebrowStyle}>
                Gesamt ausgegeben{segment === 'brand' ? ' · Marken' : segment === 'noname' ? ' · Eigenmarken' : ''}
              </Text>
              <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 34, letterSpacing: -0.8, color: theme.text, marginTop: 2 }}>
                {formatEur(stats.totalEur)}
              </Text>
              <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
                aus {stats.count} {stats.count === 1 ? 'Kauf' : 'Käufen'}
              </Text>
            </View>
          </View>

          {empty ? (
            <View style={{ alignItems: 'center', paddingTop: 48, paddingHorizontal: 32 }}>
              <MaterialCommunityIcons name="chart-box-outline" size={44} color={theme.textMuted} />
              <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 13, color: theme.textMuted, textAlign: 'center', marginTop: 12, lineHeight: 19 }}>
                Noch keine Käufe im gewählten Zeitraum. Hak Produkte auf dem Einkaufszettel als gekauft ab — sie zählen hier zur Auswertung.
              </Text>
            </View>
          ) : (
            <>
              {/* Verpasstes Sparpotenzial */}
              {stats.missedEur > 0 && segment !== 'noname' ? (
                <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
                  <View style={[cardStyle, { padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' }]}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: `${MISSED}1f` }}>
                      <MaterialCommunityIcons name="piggy-bank-outline" size={24} color={MISSED} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 11, letterSpacing: 0.5, color: MISSED, textTransform: 'uppercase' }}>
                        Verpasstes Sparpotenzial
                      </Text>
                      <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 26, letterSpacing: -0.5, color: theme.text, marginTop: 1 }}>
                        {formatEur(stats.missedEur)}
                      </Text>
                      <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 12, color: theme.textMuted, marginTop: 2, lineHeight: 17 }}>
                        So viel hättest du mit den günstigeren Eigenmarken-Alternativen gespart.
                      </Text>
                    </View>
                  </View>
                </View>
              ) : null}

              {/* Marken vs. Eigenmarken */}
              {segment === 'all' && stats.totalEur > 0 ? (
                <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
                  <View style={{ marginBottom: 12 }}>
                    <Text style={sectionTitleStyle}>Marken vs. Eigenmarken</Text>
                  </View>
                  <View style={[cardStyle, { padding: 16, gap: 14 }]}>
                    {[
                      { label: 'Marken', eur: stats.brandEur, count: stats.brandCount, color: theme.text },
                      { label: 'Eigenmarken', eur: stats.nonameEur, count: stats.nonameCount, color: primary },
                    ].map((row) => {
                      const pct = Math.max(2, Math.round((row.eur / maxSplit) * 100));
                      const share = stats.totalEur > 0 ? Math.round((row.eur / stats.totalEur) * 100) : 0;
                      return (
                        <View key={row.label}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                            <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 13, color: theme.text }}>
                              {row.label}
                            </Text>
                            <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 13, color: theme.text }}>
                              {formatEur(row.eur)}
                            </Text>
                          </View>
                          <View style={{ height: 10, borderRadius: 5, backgroundColor: theme.surfaceAlt ?? theme.border, overflow: 'hidden' }}>
                            <View style={{ width: `${pct}%`, height: '100%', borderRadius: 5, backgroundColor: row.color }} />
                          </View>
                          <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 11, color: theme.textMuted, marginTop: 3 }}>
                            {row.count} {row.count === 1 ? 'Kauf' : 'Käufe'} · {share}% der Ausgaben
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {/* Monatsverlauf */}
              {stats.byMonth.length > 1 ? (
                <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
                  <View style={{ marginBottom: 12 }}>
                    <Text style={sectionTitleStyle}>Monatsverlauf</Text>
                  </View>
                  <View style={[cardStyle, { padding: 16 }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 110 }}>
                      {stats.byMonth.map(([m, c]) => {
                        const h = Math.max(4, Math.round((c / maxMonth) * 84));
                        const monthIdx = parseInt(m.slice(5, 7), 10) - 1;
                        return (
                          <View key={m} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                            <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 8, color: theme.textMuted }}>
                              {Math.round(c)}
                            </Text>
                            <View style={{ width: '70%', height: h, borderRadius: 4, backgroundColor: primary }} />
                            <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 9, color: theme.textMuted }}>
                              {MONTH_LABELS[monthIdx] ?? ''}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      )}

      {/* Chrome: DetailHeader + SegmentedTabs (Alle/Eigenmarken/Marken) im below-Slot,
          Filter-Button (Zeitraum) im right-Slot. */}
      <DetailHeader
        title="Statistik"
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={() => setShowFilter(true)}
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
            <MaterialCommunityIcons name="tune-vertical" size={18} color={theme.textMuted} />
            {filtersActive ? (
              <View style={{ position: 'absolute', top: -1, right: -1, width: 10, height: 10, borderRadius: 5, backgroundColor: primary, borderWidth: 1.5, borderColor: theme.bg }} />
            ) : null}
          </Pressable>
        }
        below={
          <View style={{ height: TABS_ROW_HEIGHT, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, justifyContent: 'center' }}>
            <SegmentedTabs tabs={SEGMENT_TABS} value={segment} onChange={setSegment} />
          </View>
        }
      />

      <FilterSheet visible={showFilter} title="Filter" onClose={() => setShowFilter(false)}>
        <Text style={filterLabelStyle}>Zeitraum</Text>
        <OptionList value={period} options={PERIODS} onChange={(v) => setPeriod(v)} />
        {marketOptions.length > 1 ? (
          <>
            <Text style={[filterLabelStyle, { marginTop: 18 }]}>Markt</Text>
            <OptionList value={marketId} options={marketOptions} onChange={(v) => setMarketId(v)} />
          </>
        ) : null}
        {categoryOptions.length > 1 ? (
          <>
            <Text style={[filterLabelStyle, { marginTop: 18 }]}>Kategorie</Text>
            <OptionList value={categoryId} options={categoryOptions} onChange={(v) => setCategoryId(v)} />
          </>
        ) : null}
      </FilterSheet>
    </View>
  );
}

/** Shimmer-Skeleton, das das Stats-Layout (im Body) spiegelt. */
function StatsSkeleton() {
  const { theme, shadows } = useTokens();
  const card = {
    backgroundColor: theme.surface,
    borderRadius: radii.xl,
    ...(shadows?.sm ?? {}),
  } as const;
  return (
    <View>
      <View style={{ paddingHorizontal: 20 }}>
        <View style={[card, { padding: 18, gap: 9 }]}>
          <Shimmer width={120} height={10} />
          <Shimmer width={170} height={32} radius={7} />
          <Shimmer width={90} height={10} />
        </View>
      </View>
      <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
        <View style={[card, { padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' }]}>
          <Shimmer width={44} height={44} radius={22} />
          <View style={{ flex: 1, gap: 7 }}>
            <Shimmer width={150} height={10} />
            <Shimmer width={120} height={24} radius={6} />
            <Shimmer width="92%" height={10} />
          </View>
        </View>
      </View>
      <View style={{ paddingHorizontal: 20, paddingTop: 24, gap: 12 }}>
        <Shimmer width={190} height={18} radius={6} />
        <View style={[card, { padding: 16, gap: 14 }]}>
          {[0, 1].map((i) => (
            <View key={i} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Shimmer width={80} height={11} />
                <Shimmer width={60} height={11} />
              </View>
              <Shimmer height={10} radius={5} />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
