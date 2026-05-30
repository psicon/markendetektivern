/**
 * Cashback History — list of the user's submitted bons.
 *
 * Live subscription on /users/{uid}/cashback_status/* (the slim mirror
 * the Cloud Function maintains). One row per bon, status-coded chip,
 * cashback amount on the right, tap → /cashback/pending/{id} for
 * details.
 *
 * UI conventions: DetailHeader, theme tokens (theme.bg / text / textSub /
 * primary), card-list pattern matching profile/achievements screens,
 * no emojis in body text.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useNavigation } from 'expo-router';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DetailHeader,
  DETAIL_HEADER_ROW_HEIGHT,
} from '@/components/design/DetailHeader';
import { FilterSheet, OptionList } from '@/components/design/FilterSheet';
import { fontFamilyVariants, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useCashbackUserState } from '@/lib/hooks/useCashbackUserState';
import {
  getCashbackCount,
  subscribeUserCashbackHistoryPaged,
  type CashbackStatusEntry,
} from '@/lib/services/cashbackUpload';
import { formatCents } from '@/lib/types/cashback';

const PAGE_SIZE = 20;

// Zeitraum-Filter-Presets (Tage; 0 = alle).
const DATE_PRESETS: [string, string][] = [
  ['all', 'Alle'],
  ['7', 'Letzte 7 Tage'],
  ['30', 'Letzte 30 Tage'],
  ['90', 'Letzte 90 Tage'],
];

// ─── Status copy + colors ──────────────────────────────────────────

interface StatusVisual {
  label: string;
  color: string;
  bg: string;
  icon: string;
}

function statusVisual(s: string | undefined, primary: string): StatusVisual {
  switch (s) {
    case 'approved':
    case 'paid':
      return {
        label: s === 'paid' ? 'Ausgezahlt' : 'Gutgeschrieben',
        color: primary,
        bg: primary + '20',
        icon: 'check-circle-outline',
      };
    case 'no_reward':
      return {
        label: 'Ohne Vergütung',
        color: '#b08800',
        bg: 'rgba(241,196,15,0.18)',
        icon: 'information-outline',
      };
    case 'rejected':
      return {
        label: 'Abgelehnt',
        color: '#d6603a',
        bg: 'rgba(214,96,58,0.15)',
        icon: 'close-circle-outline',
      };
    case 'review':
      return {
        label: 'In Prüfung',
        color: '#b08800',
        bg: 'rgba(241,196,15,0.18)',
        icon: 'account-search-outline',
      };
    case 'uploading':
      return {
        label: 'Wird hochgeladen',
        color: primary,
        bg: primary + '15',
        icon: 'cloud-upload-outline',
      };
    case 'superseded':
      return {
        label: 'Doppelt — siehe Original',
        color: '#5c6769',
        bg: 'rgba(92,103,105,0.12)',
        icon: 'content-copy',
      };
    case 'ocr_pending':
    case 'ocr_done':
    case 'matched':
    default:
      return {
        label: 'Wird geprüft',
        color: '#5c6769',
        bg: 'rgba(92,103,105,0.12)',
        icon: 'progress-clock',
      };
  }
}

// ─── Date formatting ───────────────────────────────────────────────

function formatBonDate(iso?: string | null): string | null {
  if (!iso) return null;
  // ISO YYYY-MM-DD → DE
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function formatRelative(updatedAt: any): string {
  const ms = updatedAt?.toMillis?.() ?? 0;
  if (!ms) return '';
  const diffMin = Math.round((Date.now() - ms) / 60000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `vor ${diffD} Tagen`;
  // fall back to date
  const d = new Date(ms);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// ─── Screen ────────────────────────────────────────────────────────

export default function CashbackHistoryScreen() {
  const { theme, shadows } = useTokens();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user } = useAuth();

  const [entries, setEntries] = useState<CashbackStatusEntry[] | null>(null);
  const [pageLimit, setPageLimit] = useState(PAGE_SIZE);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [marketFilter, setMarketFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [showFilter, setShowFilter] = useState(false);

  const { lifetimeCents } = useCashbackUserState();

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Realtime + lazy: re-subscribe wenn pageLimit wächst. Bleibt live
  // (neue Bons + Status-Flips sofort), lädt aber nur pageLimit Docs.
  useEffect(() => {
    if (!user?.uid) {
      setEntries([]);
      return;
    }
    const unsub = subscribeUserCashbackHistoryPaged(pageLimit, (rows) =>
      // 'superseded' = Duplikat-Platzhalter → ausblenden.
      setEntries(rows.filter((r) => r.status !== 'superseded')),
    );
    return unsub;
  }, [user?.uid, pageLimit]);

  // Gesamtanzahl für den Header (1 günstiger Count-Read).
  useEffect(() => {
    if (!user?.uid) {
      setTotalCount(0);
      return;
    }
    getCashbackCount().then(setTotalCount).catch(() => setTotalCount(null));
  }, [user?.uid]);

  const headerOffset = insets.top + DETAIL_HEADER_ROW_HEIGHT;
  const primary = theme.primary ?? '#0d8575';

  // „Insgesamt verdient" aus dem User-Aggregat (realtime, korrekt auch
  // bei Pagination) statt aus der geladenen Teilmenge summiert.
  const totalEarned = lifetimeCents ?? 0;

  const merchantKey = (e: CashbackStatusEntry) =>
    String(e.merchantId || e.merchant || e.merchantName || '');

  // Distinct Märkte aus den geladenen Einträgen (Filter-Optionen).
  const marketOptions = useMemo<[string, string][]>(() => {
    const map = new Map<string, string>();
    (entries ?? []).forEach((e) => {
      const id = merchantKey(e);
      if (!id) return;
      if (!map.has(id)) {
        map.set(id, e.merchantDisplayName || e.merchantName || e.merchant || id);
      }
    });
    return [['all', 'Alle Märkte'], ...Array.from(map.entries())];
  }, [entries]);

  const dateCutoff = useMemo(() => {
    const days = parseInt(dateFilter, 10);
    return Number.isFinite(days) && days > 0 ? Date.now() - days * 86_400_000 : 0;
  }, [dateFilter]);

  // Client-seitige Filter über das Live-Fenster (kein Composite-Index).
  const filtered = useMemo(() => {
    let list = entries ?? [];
    if (marketFilter !== 'all') {
      list = list.filter((e) => merchantKey(e) === marketFilter);
    }
    if (dateCutoff > 0) {
      list = list.filter((e) => (e.updatedAt?.toMillis?.() ?? 0) >= dateCutoff);
    }
    return list;
  }, [entries, marketFilter, dateCutoff]);

  const hasMore = (entries?.length ?? 0) >= pageLimit;
  const activeFilterCount =
    (marketFilter !== 'all' ? 1 : 0) + (dateFilter !== 'all' ? 1 : 0);
  const loadMore = () => {
    if (hasMore) setPageLimit((p) => p + PAGE_SIZE);
  };

  const renderItem = ({ item }: { item: CashbackStatusEntry }) => {
    const v = statusVisual(item.status, primary);
    const bonDateStr = formatBonDate(item.bonDate);
    const merchant = item.merchantDisplayName || item.merchantName || item.merchant || item.merchantRaw || 'Unbekannte Filiale';
    const cashback = item.cashbackCents ? formatCents(item.cashbackCents) : null;

    return (
      <Pressable
        onPress={() =>
          router.push({
            pathname: '/cashback/pending/[id]' as any,
            params: { id: item.id },
          })
        }
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: theme.surface,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
          paddingHorizontal: 14,
          paddingVertical: 14,
          marginHorizontal: 16,
          marginBottom: 10,
          gap: 12,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        {/* Status icon block */}
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: v.bg,
          }}
        >
          <MaterialCommunityIcons name={v.icon as any} size={22} color={v.color} />
        </View>

        {/* Middle: merchant + date + status chip */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              color: theme.text,
              // Bold-Variante explizit (NUNITO_BOLD) — fontWeight allein
              // greift bei expliziter Font-Variante nicht (Android-Bug).
              // Matcht den Card-Titel-Stil im Rest der App.
              fontFamily: fontFamilyVariants.heading,
              fontWeight: fontWeight.extraBold as any,
              fontSize: 16,
              letterSpacing: -0.2,
            }}
          >
            {merchant}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <Text
              style={{
                color: v.color,
                backgroundColor: v.bg,
                // medium-Variante explizit (sonst greift fontWeight nicht).
                fontFamily: fontFamilyVariants.medium,
                fontWeight: fontWeight.medium as any,
                fontSize: 11,
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              {v.label}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                color: theme.textSub,
                fontFamily: fontFamilyVariants.body,
                fontSize: 12,
              }}
            >
              {bonDateStr ? `${bonDateStr} · ` : ''}
              {formatRelative(item.updatedAt)}
            </Text>
          </View>
        </View>

        {/* Right: cashback amount */}
        <View style={{ alignItems: 'flex-end' }}>
          {cashback ? (
            <Text
              style={{
                color: primary,
                fontFamily: fontFamilyVariants.heading,
                fontWeight: fontWeight.extraBold as any,
                fontSize: 16,
                letterSpacing: -0.2,
              }}
            >
              +{cashback}
            </Text>
          ) : (
            <Text
              style={{
                color: theme.textMuted ?? theme.textSub,
                fontFamily: fontFamilyVariants.body,
                fontSize: 13,
              }}
            >
              —
            </Text>
          )}
          <MaterialCommunityIcons
            name="chevron-right"
            size={18}
            color={theme.textMuted ?? theme.textSub}
            style={{ marginTop: 2 }}
          />
        </View>
      </Pressable>
    );
  };

  // Header card with the lifetime total
  const HeaderCard = () => (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 18,
        marginTop: 4,
        padding: 18,
        borderRadius: radii.lg,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        ...(shadows.md ?? {}),
      }}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: primary + '18',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <MaterialCommunityIcons name="cash-multiple" size={26} color={primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            color: theme.textSub,
            fontFamily: fontFamilyVariants.body,
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          Insgesamt verdient
        </Text>
        <Text
          style={{
            color: theme.text,
            fontFamily: fontFamilyVariants.heading,
            fontWeight: fontWeight.extraBold as any,
            fontSize: 24,
            letterSpacing: -0.4,
            marginTop: 2,
          }}
        >
          {formatCents(totalEarned)}
        </Text>
        <Text
          style={{
            color: theme.textSub,
            fontFamily: fontFamilyVariants.body,
            fontSize: 12,
            marginTop: 2,
          }}
        >
          {totalCount ?? entries?.length ?? 0} Bons eingereicht
        </Text>
      </View>
      <Pressable
        onPress={() => router.replace('/cashback/consent')}
        style={({ pressed }) => ({
          backgroundColor: primary,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <MaterialCommunityIcons name="camera-outline" size={16} color="#fff" />
        <Text
          style={{
            color: '#fff',
            fontFamily: fontFamilyVariants.body,
            fontWeight: fontWeight.bold as any,
            fontSize: 13,
          }}
        >
          Neuer Bon
        </Text>
      </Pressable>
    </View>
  );

  // Empty state
  const Empty = () => (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 24,
        padding: 28,
        borderRadius: radii.lg,
        backgroundColor: theme.surfaceAlt ?? theme.surface,
        borderWidth: 1,
        borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <MaterialCommunityIcons name="receipt-text-outline" size={48} color={theme.textMuted ?? theme.textSub} />
      <Text
        style={{
          color: theme.text,
          fontFamily: fontFamilyVariants.body,
          fontWeight: fontWeight.bold as any,
          fontSize: 16,
        }}
      >
        Noch keine Bons
      </Text>
      <Text
        style={{
          color: theme.textSub,
          fontFamily: fontFamilyVariants.body,
          fontSize: 13,
          textAlign: 'center',
          maxWidth: 260,
          lineHeight: 19,
        }}
      >
        Lade nach deinem nächsten Einkauf einen Kassenbon hoch und sammle Cashback.
      </Text>
      <Pressable
        onPress={() => router.replace('/cashback/consent')}
        style={({ pressed }) => ({
          marginTop: 8,
          backgroundColor: primary,
          paddingHorizontal: 18,
          paddingVertical: 12,
          borderRadius: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <MaterialCommunityIcons name="camera-outline" size={16} color="#fff" />
        <Text style={{ color: '#fff', fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 14 }}>
          Bon scannen
        </Text>
      </Pressable>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader
        title="Bons-Verlauf"
        onBack={() => router.back()}
        right={
          entries && entries.length > 0 ? (
            <Pressable
              onPress={() => setShowFilter(true)}
              hitSlop={6}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: theme.surfaceAlt ?? theme.surface,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <MaterialCommunityIcons name="tune-vertical" size={18} color={theme.textMuted} />
              {activeFilterCount > 0 ? (
                <View
                  style={{
                    position: 'absolute',
                    top: -2,
                    right: -2,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    paddingHorizontal: 4,
                    backgroundColor: primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    style={{
                      fontFamily: fontFamilyVariants.heading,
                      fontWeight: fontWeight.extraBold as any,
                      fontSize: 10,
                      color: '#fff',
                      lineHeight: 14,
                    }}
                  >
                    {activeFilterCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          ) : null
        }
      />
      {entries === null ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={primary} />
        </View>
      ) : entries.length === 0 ? (
        <View style={{ paddingTop: headerOffset + 12 }}>
          <Empty />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(e) => e.id}
          renderItem={renderItem}
          ListHeaderComponent={
            <View style={{ paddingTop: headerOffset + 8 }}>
              <HeaderCard />
            </View>
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 32, paddingHorizontal: 24 }}>
              <Text
                style={{
                  color: theme.textSub,
                  fontFamily: fontFamilyVariants.body,
                  fontSize: 14,
                  textAlign: 'center',
                }}
              >
                Keine Bons für diese Filter.
              </Text>
            </View>
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            hasMore ? (
              <View style={{ paddingVertical: 18 }}>
                <ActivityIndicator color={primary} />
              </View>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Filter: Zeitraum + Markt */}
      <FilterSheet
        visible={showFilter}
        title="Filter"
        onClose={() => setShowFilter(false)}
      >
        <View style={{ paddingBottom: 8 }}>
          <Text
            style={{
              fontFamily: fontFamilyVariants.heading,
              fontWeight: fontWeight.extraBold as any,
              fontSize: 13,
              color: theme.textMuted,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Zeitraum
          </Text>
          <OptionList value={dateFilter} options={DATE_PRESETS} onChange={setDateFilter} />

          {marketOptions.length > 1 ? (
            <View style={{ marginTop: 18 }}>
              <Text
                style={{
                  fontFamily: fontFamilyVariants.heading,
                  fontWeight: fontWeight.extraBold as any,
                  fontSize: 13,
                  color: theme.textMuted,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                Markt
              </Text>
              <OptionList value={marketFilter} options={marketOptions} onChange={setMarketFilter} />
            </View>
          ) : null}

          {activeFilterCount > 0 ? (
            <Pressable
              onPress={() => {
                setMarketFilter('all');
                setDateFilter('all');
              }}
              style={({ pressed }) => ({ marginTop: 18, opacity: pressed ? 0.6 : 1 })}
            >
              <Text
                style={{
                  fontFamily: fontFamilyVariants.medium,
                  fontWeight: fontWeight.medium as any,
                  fontSize: 13,
                  color: primary,
                  textAlign: 'center',
                }}
              >
                Filter zurücksetzen
              </Text>
            </Pressable>
          ) : null}
        </View>
      </FilterSheet>
    </View>
  );
}
