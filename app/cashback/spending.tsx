/**
 * Ausgaben — Spending-Statistik aus den eingereichten Bons.
 *
 * Quelle: /users/{uid}/cashback_status/* (der Mirror, den der Verlauf
 * eh nutzt). Gezählt werden NUR echte Käufe (approved + no_reward +
 * paid) über `bonTotalCents` — Duplikate / Nicht-Bons fließen NICHT ein,
 * also kein Doppelzählen. Aggregation client-seitig: Gesamtsumme,
 * pro Händler, Monatsverlauf, mit Zeitraum-Filter.
 *
 * Kategorie-Aufschlüsselung („für was") kommt später mit dem
 * Produkt-Matching — Roh-Artikelnamen lassen sich vorher nicht sauber
 * gruppieren. UI-Konventionen: DetailHeader, theme-Tokens, keine Emojis.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useNavigation } from 'expo-router';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { fetchAllCashbackEntries, type CashbackStatusEntry } from '@/lib/services/cashbackUpload';
import { formatCents } from '@/lib/types/cashback';

// Nur diese Status sind echte, abgeschlossene Käufe → zählen als Ausgabe.
const SPEND_STATUSES = new Set(['approved', 'no_reward', 'paid']);

// Zeitraum-Presets (Tage; 0 = alles).
const PERIODS: [string, string][] = [
  ['all', 'Alles'],
  ['365', '12 Monate'],
  ['90', '90 Tage'],
  ['30', '30 Tage'],
];

const MONTH_LABELS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function merchantLabel(e: CashbackStatusEntry): string {
  return e.merchantDisplayName || e.merchantName || e.merchant || 'Unbekannter Markt';
}

export default function SpendingScreen() {
  const { theme } = useTokens();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const [entries, setEntries] = useState<CashbackStatusEntry[] | null>(null);
  const [period, setPeriod] = useState<string>('all');

  useEffect(() => {
    let alive = true;
    fetchAllCashbackEntries()
      .then((rows) => {
        if (alive) setEntries(rows);
      })
      .catch(() => {
        if (alive) setEntries([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const headerOffset = insets.top + DETAIL_HEADER_ROW_HEIGHT;
  const primary = theme.primary ?? '#0d8575';

  // Nur Käufe mit bekanntem Datum + Betrag; nach Zeitraum gefiltert.
  const spend = useMemo(() => {
    const rows = (entries ?? []).filter(
      (e) =>
        SPEND_STATUSES.has(e.status ?? '') &&
        typeof e.bonTotalCents === 'number' &&
        e.bonTotalCents! > 0 &&
        typeof e.bonDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}/.test(e.bonDate!),
    );
    const days = parseInt(period, 10);
    if (Number.isFinite(days) && days > 0) {
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      return rows.filter((e) => (e.bonDate as string).slice(0, 10) >= cutoff);
    }
    return rows;
  }, [entries, period]);

  const totalCents = useMemo(() => spend.reduce((s, e) => s + (e.bonTotalCents ?? 0), 0), [spend]);

  // Pro Händler: Summe + Bon-Anzahl, absteigend nach Summe.
  const byMerchant = useMemo(() => {
    const map = new Map<string, { label: string; cents: number; count: number }>();
    for (const e of spend) {
      const label = merchantLabel(e);
      const key = e.merchantId || label;
      const cur = map.get(key) ?? { label, cents: 0, count: 0 };
      cur.cents += e.bonTotalCents ?? 0;
      cur.count += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.cents - a.cents);
  }, [spend]);

  // Monatsverlauf: letzte ≤12 Monate mit Daten, aufsteigend.
  const byMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of spend) {
      const m = (e.bonDate as string).slice(0, 7); // YYYY-MM
      map.set(m, (map.get(m) ?? 0) + (e.bonTotalCents ?? 0));
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12);
  }, [spend]);

  const maxMerchant = byMerchant[0]?.cents ?? 1;
  const maxMonth = byMonth.reduce((m, [, c]) => Math.max(m, c), 1);
  const loading = entries === null;
  const empty = !loading && spend.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Ausgaben" onBack={() => router.back()} />

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: headerOffset + 12, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Zeitraum-Pills */}
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20 }}>
            {PERIODS.map(([k, label]) => {
              const active = period === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => setPeriod(k)}
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
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.bold as any,
                      fontSize: 12,
                      color: active ? '#fff' : theme.textMuted,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Summen-Hero */}
          <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
            <View
              style={{
                borderRadius: 18,
                padding: 18,
                backgroundColor: theme.surface,
                borderWidth: 1,
                borderColor: theme.border,
              }}
            >
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.bold as any,
                  fontSize: 11,
                  letterSpacing: 0.6,
                  color: theme.textMuted,
                  textTransform: 'uppercase',
                }}
              >
                Gesamt ausgegeben
              </Text>
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 34,
                  letterSpacing: -0.8,
                  color: theme.text,
                  marginTop: 2,
                }}
              >
                {formatCents(totalCents)}
              </Text>
              <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
                aus {spend.length} {spend.length === 1 ? 'Bon' : 'Bons'}
              </Text>
            </View>
          </View>

          {empty ? (
            <View style={{ alignItems: 'center', paddingTop: 48, paddingHorizontal: 32 }}>
              <MaterialCommunityIcons name="chart-box-outline" size={44} color={theme.textMuted} />
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 13,
                  color: theme.textMuted,
                  textAlign: 'center',
                  marginTop: 12,
                  lineHeight: 19,
                }}
              >
                Noch keine Ausgaben im gewählten Zeitraum. Reiche Bons ein — sie zählen hier zur Übersicht.
              </Text>
            </View>
          ) : (
            <>
              {/* Monatsverlauf */}
              {byMonth.length > 1 ? (
                <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
                  <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 20, color: theme.text, letterSpacing: -0.2, marginBottom: 14 }}>
                    Monatsverlauf
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 110 }}>
                    {byMonth.map(([m, c]) => {
                      const h = Math.max(4, Math.round((c / maxMonth) * 84));
                      const monthIdx = parseInt(m.slice(5, 7), 10) - 1;
                      return (
                        <View key={m} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                          <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 8, color: theme.textMuted }}>
                            {Math.round(c / 100)}
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

              {/* Nach Händler */}
              <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
                <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 20, color: theme.text, letterSpacing: -0.2, marginBottom: 12 }}>
                  Nach Händler
                </Text>
                <View style={{ gap: 12 }}>
                  {byMerchant.map((m) => {
                    const pct = Math.max(4, Math.round((m.cents / maxMerchant) * 100));
                    return (
                      <View key={m.label}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                          <Text numberOfLines={1} style={{ flex: 1, fontFamily, fontWeight: fontWeight.bold as any, fontSize: 13, color: theme.text }}>
                            {m.label}
                          </Text>
                          <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 13, color: theme.text, marginLeft: 8 }}>
                            {formatCents(m.cents)}
                          </Text>
                        </View>
                        <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.surfaceAlt ?? theme.border, overflow: 'hidden' }}>
                          <View style={{ width: `${pct}%`, height: '100%', borderRadius: 4, backgroundColor: primary }} />
                        </View>
                        <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 11, color: theme.textMuted, marginTop: 3 }}>
                          {m.count} {m.count === 1 ? 'Bon' : 'Bons'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Hinweis: Kategorie-Aufschlüsselung folgt mit Produkt-Matching */}
              <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    padding: 14,
                    borderRadius: 16,
                    backgroundColor: theme.surface,
                    borderWidth: 1,
                    borderColor: theme.border,
                  }}
                >
                  <MaterialCommunityIcons name="shape-outline" size={20} color={theme.textMuted} />
                  <Text style={{ flex: 1, fontFamily, fontWeight: fontWeight.medium, fontSize: 12, color: theme.textMuted, lineHeight: 17 }}>
                    Eine Aufschlüsselung „wofür" (nach Produkt-Kategorie) kommt bald — sobald die erkannten Artikel zugeordnet sind.
                  </Text>
                </View>
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
