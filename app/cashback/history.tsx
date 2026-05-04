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
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import {
  subscribeUserCashbackHistory,
  type CashbackStatusEntry,
} from '@/lib/services/cashbackUpload';
import { formatCents } from '@/lib/types/cashback';

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

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    if (!user?.uid) {
      setEntries([]);
      return;
    }
    const unsub = subscribeUserCashbackHistory((rows) => setEntries(rows));
    return unsub;
  }, [user?.uid]);

  const headerOffset = insets.top + DETAIL_HEADER_ROW_HEIGHT;
  const primary = theme.primary ?? '#0d8575';

  const totalEarned = useMemo(() => {
    if (!entries) return 0;
    return entries
      .filter((e) => e.status === 'approved' || e.status === 'paid')
      .reduce((acc, e) => acc + (e.cashbackCents ?? 0), 0);
  }, [entries]);

  const renderItem = ({ item }: { item: CashbackStatusEntry }) => {
    const v = statusVisual(item.status, primary);
    const bonDateStr = formatBonDate(item.bonDate);
    const merchant = item.merchant ?? 'Unbekannte Filiale';
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
              fontFamily: fontFamily.body,
              fontWeight: fontWeight.bold as any,
              fontSize: 15,
            }}
          >
            {merchant}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <Text
              style={{
                color: v.color,
                backgroundColor: v.bg,
                fontFamily: fontFamily.body,
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
                fontFamily: fontFamily.body,
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
                fontFamily: fontFamily.heading,
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
                fontFamily: fontFamily.body,
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
            fontFamily: fontFamily.body,
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
            fontFamily: fontFamily.heading,
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
            fontFamily: fontFamily.body,
            fontSize: 12,
            marginTop: 2,
          }}
        >
          {entries?.length ?? 0} Bons eingereicht
        </Text>
      </View>
      <Pressable
        onPress={() => router.push('/cashback/consent')}
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
            fontFamily: fontFamily.body,
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
          fontFamily: fontFamily.body,
          fontWeight: fontWeight.bold as any,
          fontSize: 16,
        }}
      >
        Noch keine Bons
      </Text>
      <Text
        style={{
          color: theme.textSub,
          fontFamily: fontFamily.body,
          fontSize: 13,
          textAlign: 'center',
          maxWidth: 260,
          lineHeight: 19,
        }}
      >
        Lade nach deinem nächsten Einkauf einen Kassenbon hoch und sammle Cashback.
      </Text>
      <Pressable
        onPress={() => router.push('/cashback/consent')}
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
        <Text style={{ color: '#fff', fontFamily: fontFamily.body, fontWeight: fontWeight.bold as any, fontSize: 14 }}>
          Bon scannen
        </Text>
      </Pressable>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Bons-Verlauf" onBack={() => router.back()} />
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
          data={entries}
          keyExtractor={(e) => e.id}
          renderItem={renderItem}
          ListHeaderComponent={
            <View style={{ paddingTop: headerOffset + 8 }}>
              <HeaderCard />
            </View>
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
