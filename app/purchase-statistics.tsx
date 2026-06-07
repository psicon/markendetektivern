/**
 * Kaufhistorie-Statistik (86ca5fjxk) — Ausgaben-Analyse aus den getätigten
 * Käufen, analog zur Bon-Ausgaben-Sicht (app/cashback/spending.tsx).
 *
 * Quelle: /users/{uid}/purchases/* (PurchasedProduct). Aggregation
 * clientseitig: Gesamtausgaben, Marken vs. Eigenmarken, „verpasstes
 * Sparpotenzial" (= Σ der beim Markenkauf gespeicherten savings = Differenz
 * zur günstigsten Eigenmarken-Alternative zum Kaufzeitpunkt), Monatsverlauf.
 * Segment Alle / Eigenmarken / Marken (wie Stöbern). UI-Konventionen:
 * DetailHeader, theme-Tokens, Charts aus reinen RN-Views.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useNavigation } from 'expo-router';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import purchaseHistoryService, {
  type PurchasedProduct,
} from '@/lib/services/purchaseHistoryService';

type Segment = 'all' | 'brand' | 'noname';

const SEGMENTS: [Segment, string][] = [
  ['all', 'Alle'],
  ['noname', 'Eigenmarken'],
  ['brand', 'Marken'],
];
const PERIODS: [string, string][] = [
  ['all', 'Alles'],
  ['365', '12 Monate'],
  ['90', '90 Tage'],
  ['30', '30 Tage'],
];
const MONTH_LABELS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MISSED = '#d6603a'; // Akzent für verpasstes Sparpotenzial

const formatEur = (n: number) => `${(n || 0).toFixed(2).replace('.', ',')} €`;

export default function PurchaseStatisticsScreen() {
  const { theme } = useTokens();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user } = useAuth();

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const [purchases, setPurchases] = useState<PurchasedProduct[] | null>(null);
  const [period, setPeriod] = useState('all');
  const [segment, setSegment] = useState<Segment>('all');

  useEffect(() => {
    if (!user?.uid) {
      setPurchases([]);
      return;
    }
    let alive = true;
    purchaseHistoryService
      .getUserPurchaseHistory(user.uid)
      .then((rows) => {
        if (alive) setPurchases(rows);
      })
      .catch(() => {
        if (alive) setPurchases([]);
      });
    return () => {
      alive = false;
    };
  }, [user?.uid]);

  const primary = theme.primary ?? '#0d8575';
  const headerOffset = insets.top + DETAIL_HEADER_ROW_HEIGHT;

  const periodFiltered = useMemo(() => {
    const all = purchases ?? [];
    const days = parseInt(period, 10);
    if (!Number.isFinite(days) || days <= 0) return all;
    const cutoff = Date.now() - days * 86_400_000;
    return all.filter((p) => p.purchasedAt instanceof Date && p.purchasedAt.getTime() >= cutoff);
  }, [purchases, period]);

  const filtered = useMemo(() => {
    if (segment === 'all') return periodFiltered;
    return periodFiltered.filter((p) =>
      segment === 'brand' ? p.type === 'markenprodukt' : p.type === 'noname',
    );
  }, [periodFiltered, segment]);

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
        // savings beim Markenkauf = Differenz zur günstigsten Eigenmarken-
        // Alternative (firestore.ts createPurchaseHistoryEntry) = das verpasste
        // Sparpotenzial.
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

  const sectionTitle = {
    fontFamily,
    fontWeight: fontWeight.extraBold,
    fontSize: 20,
    color: theme.text,
    letterSpacing: -0.2,
    marginBottom: 14,
  } as const;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Statistik" onBack={() => router.back()} />

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: headerOffset + 12, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Segment Alle / Eigenmarken / Marken */}
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
            {SEGMENTS.map(([k, label]) => {
              const active = segment === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => setSegment(k)}
                  style={{
                    flex: 1,
                    height: 34,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? primary : theme.surface,
                    borderWidth: 1,
                    borderColor: active ? primary : theme.border,
                  }}
                >
                  <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 12, color: active ? '#fff' : theme.textMuted }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Zeitraum-Pills */}
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 8 }}>
            {PERIODS.map(([k, label]) => {
              const active = period === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => setPeriod(k)}
                  style={{
                    flex: 1,
                    height: 30,
                    borderRadius: 9,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? theme.surfaceAlt ?? theme.surface : theme.surface,
                    borderWidth: 1,
                    borderColor: active ? theme.borderStrong ?? primary : theme.border,
                  }}
                >
                  <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 11, color: active ? theme.text : theme.textMuted }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Summen-Hero */}
          <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
            <View style={{ borderRadius: 18, padding: 18, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}>
              <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 11, letterSpacing: 0.6, color: theme.textMuted, textTransform: 'uppercase' }}>
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
              {/* Verpasstes Sparpotenzial (Marken-Käufe) */}
              {stats.missedEur > 0 && segment !== 'noname' ? (
                <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 16, borderRadius: 18, backgroundColor: `${MISSED}14`, borderWidth: 1, borderColor: `${MISSED}40` }}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: `${MISSED}22` }}>
                      <MaterialCommunityIcons name="piggy-bank-outline" size={24} color={MISSED} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 11, letterSpacing: 0.5, color: MISSED, textTransform: 'uppercase' }}>
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

              {/* Marken vs. Eigenmarken (nur im Alle-Segment sinnvoll) */}
              {segment === 'all' && stats.totalEur > 0 ? (
                <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
                  <Text style={sectionTitle}>Marken vs. Eigenmarken</Text>
                  <View style={{ gap: 14 }}>
                    {[
                      { label: 'Marken', eur: stats.brandEur, count: stats.brandCount, color: theme.text },
                      { label: 'Eigenmarken', eur: stats.nonameEur, count: stats.nonameCount, color: primary },
                    ].map((row) => {
                      const pct = Math.max(2, Math.round((row.eur / maxSplit) * 100));
                      const share = stats.totalEur > 0 ? Math.round((row.eur / stats.totalEur) * 100) : 0;
                      return (
                        <View key={row.label}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                            <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 13, color: theme.text }}>
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
                <View style={{ paddingHorizontal: 20, paddingTop: 26 }}>
                  <Text style={sectionTitle}>Monatsverlauf</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 110 }}>
                    {stats.byMonth.map(([m, c]) => {
                      const h = Math.max(4, Math.round((c / maxMonth) * 84));
                      const monthIdx = parseInt(m.slice(5, 7), 10) - 1;
                      return (
                        <View key={m} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                          <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 8, color: theme.textMuted }}>
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
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
