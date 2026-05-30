/**
 * Meine Auszahlungen — Status-Liste aller Payout-Anfragen.
 *
 * Quelle: /cashback_payouts (own read). Zeigt Betrag, Datum und Status
 * (angefragt / gesendet / fehlgeschlagen) und — sobald von Tremendous
 * gesynct — die eingelöste Form. Bei 'sent' kann der Redemption-Link
 * jederzeit erneut im In-App-Browser geöffnet werden.
 *
 * UI: DetailHeader, theme-Tokens, keine Emojis im Body.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as WebBrowser from 'expo-web-browser';
import { router, useNavigation } from 'expo-router';
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { subscribeUserPayouts, type PayoutDoc } from '@/lib/services/cashbackUpload';
import { formatCents } from '@/lib/types/cashback';

interface StatusVisual {
  label: string;
  color: string;
  bg: string;
  icon: string;
}

function statusVisual(p: PayoutDoc, primary: string): StatusVisual {
  if (p.redeemedForm) {
    return { label: `Eingelöst · ${p.redeemedForm}`, color: primary, bg: primary + '20', icon: 'check-decagram-outline' };
  }
  switch (p.status) {
    case 'sent':
    case 'delivered':
      return { label: 'Bereit zum Einlösen', color: primary, bg: primary + '18', icon: 'open-in-new' };
    case 'failed':
      return { label: 'Fehlgeschlagen — zurückgebucht', color: '#d6603a', bg: 'rgba(214,96,58,0.15)', icon: 'close-circle-outline' };
    case 'requested':
    default:
      return { label: 'Wird vorbereitet', color: '#5c6769', bg: 'rgba(92,103,105,0.12)', icon: 'progress-clock' };
  }
}

function formatWhen(ts: any): string {
  const ms = ts?.toMillis?.() ?? 0;
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function PayoutsScreen() {
  const { theme } = useTokens();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const primary = theme.primary ?? '#0d8575';

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const [rows, setRows] = useState<PayoutDoc[] | null>(null);
  const [displayLimit, setDisplayLimit] = useState(30);
  useEffect(() => subscribeUserPayouts(setRows), []);

  const headerOffset = insets.top + DETAIL_HEADER_ROW_HEIGHT;
  const loading = rows === null;
  const empty = !loading && rows.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Meine Auszahlungen" onBack={() => router.back()} />

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={primary} />
        </View>
      ) : empty ? (
        <View style={{ paddingTop: headerOffset + 48, alignItems: 'center', paddingHorizontal: 32 }}>
          <MaterialCommunityIcons name="cash-multiple" size={44} color={theme.textMuted} />
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
            Noch keine Auszahlungen. Sobald dein Guthaben die Schwelle erreicht, kannst du es im Belohnungen-Tab einlösen.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingTop: headerOffset + 12, paddingHorizontal: 20, paddingBottom: insets.bottom + 32, gap: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {rows!.slice(0, displayLimit).map((p) => {
            const v = statusVisual(p, primary);
            const canOpen = (p.status === 'sent' || p.status === 'delivered') && !!p.redemptionLink;
            return (
              <View
                key={p.id}
                style={{
                  padding: 14,
                  borderRadius: 16,
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.border,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: v.bg,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MaterialCommunityIcons name={v.icon as any} size={20} color={v.color} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 17, color: theme.text, letterSpacing: -0.3 }}>
                      {formatCents(p.amountCents ?? 0)}
                    </Text>
                    <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 11, color: theme.textMuted, marginTop: 1 }}>
                      {formatWhen(p.createdAt)}
                    </Text>
                  </View>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingHorizontal: 9,
                      paddingVertical: 5,
                      borderRadius: 999,
                      backgroundColor: v.bg,
                    }}
                  >
                    <MaterialCommunityIcons name={v.icon as any} size={12} color={v.color} />
                    <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 11, color: v.color }}>{v.label}</Text>
                  </View>
                </View>

                {canOpen ? (
                  <Pressable
                    onPress={() => WebBrowser.openBrowserAsync(p.redemptionLink as string).catch(() => {})}
                    style={({ pressed }) => ({
                      marginTop: 12,
                      height: 44,
                      borderRadius: 12,
                      backgroundColor: primary,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'row',
                      gap: 8,
                      opacity: pressed ? 0.9 : 1,
                    })}
                  >
                    <MaterialCommunityIcons name="open-in-new" size={17} color="#fff" />
                    <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 14, color: '#fff' }}>
                      Auszahlungsseite öffnen
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}

          {rows!.length > displayLimit ? (
            <Pressable
              onPress={() => setDisplayLimit((n) => n + 30)}
              style={({ pressed }) => ({
                marginTop: 4,
                height: 46,
                borderRadius: 14,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.surface,
                borderWidth: 1,
                borderColor: theme.border,
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 13, color: theme.text }}>
                Mehr anzeigen ({rows!.length - displayLimit})
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}
