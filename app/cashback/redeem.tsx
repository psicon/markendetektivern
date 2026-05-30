/**
 * Cashback einlösen — dedizierte Einlöse-Seite.
 *
 * Vom Belohnungen-Tab via kompakter CTA erreichbar. Hält den Tab
 * schlank und gibt der eigentlichen Auszahlung eine eigene Bühne:
 *   • Konto-Hero (Guthaben + Auszahlungs-Schwelle als Progress)
 *   • Belohnungs-Optionen (Gutscheine / PayPal / Visa-Prepaid / Spende)
 *   • „Jetzt einlösen"-CTA (3rd-Party-Partner-Integration folgt)
 *
 * Auszahlungs-Schwelle kommt remote-konfigurierbar aus
 * cashback_config/v1 (payoutThresholdCents), Fallback 10 €.
 * UI-Konventionen: DetailHeader, theme-Tokens, keine Emojis im Body.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useNavigation } from 'expo-router';
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useCashbackUserState } from '@/lib/hooks/useCashbackUserState';
import { getCashbackConfig } from '@/lib/services/cashbackService';
import { showInfoToast } from '@/lib/services/ui/toast';

const PAYOUT_THRESHOLD_FALLBACK = 10.0;

interface RedeemMethod {
  k: string;
  icon: string;
  title: string;
  desc: string;
  tint: string;
}

const METHODS: RedeemMethod[] = [
  { k: 'giftcard', icon: 'gift-outline', title: 'Gutscheine', desc: 'Amazon, Rewe, Apple & mehr', tint: '#0d8575' },
  { k: 'paypal', icon: 'wallet-outline', title: 'PayPal', desc: 'Direkt aufs PayPal-Konto', tint: '#2563eb' },
  { k: 'visa', icon: 'credit-card-outline', title: 'Visa-Prepaid', desc: 'Virtuelle Prepaid-Karte', tint: '#7c3aed' },
  { k: 'donation', icon: 'heart-outline', title: 'Spende', desc: 'An einen guten Zweck', tint: '#e11d48' },
];

export default function RedeemScreen() {
  const { theme } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const cashback = useCashbackUserState();

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const [payoutThreshold, setPayoutThreshold] = useState(PAYOUT_THRESHOLD_FALLBACK);
  useEffect(() => {
    let alive = true;
    getCashbackConfig()
      .then((c) => {
        if (alive && typeof c.payoutThresholdCents === 'number') {
          setPayoutThreshold(c.payoutThresholdCents / 100);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const balanceEur = cashback.uid ? cashback.balanceCents / 100 : 0;
  const canRedeem = balanceEur >= payoutThreshold;
  const pct = Math.min(100, Math.round((balanceEur / payoutThreshold) * 100));
  const gapEur = (payoutThreshold - balanceEur).toFixed(2).replace('.', ',');
  const headerOffset = insets.top + DETAIL_HEADER_ROW_HEIGHT;

  const onRedeem = () => {
    if (!canRedeem) return;
    // 3rd-Party-Partner-Integration folgt hier.
    showInfoToast('Auszahlung wird bald über unseren Partner verfügbar sein.', 'info', scheme);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Cashback einlösen" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{ paddingTop: headerOffset + 12, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Konto-Hero: Guthaben + Auszahlungs-Schwelle ── */}
        <View style={{ paddingHorizontal: 20 }}>
          <LinearGradient
            colors={['#0a6f62', '#0d8575', '#10a18a']}
            start={{ x: -1, y: 0.34 }}
            end={{ x: 1, y: -0.34 }}
            style={{ borderRadius: 18, paddingHorizontal: 16, paddingVertical: 16, overflow: 'hidden' }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold as any,
                fontSize: 11,
                letterSpacing: 0.6,
                color: 'rgba(255,255,255,0.85)',
                textTransform: 'uppercase',
              }}
            >
              Dein Cashback-Guthaben
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginTop: 4 }}>
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 38,
                  lineHeight: 42,
                  letterSpacing: -0.8,
                  color: '#fff',
                }}
              >
                {balanceEur.toFixed(2).replace('.', ',')}
              </Text>
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 20,
                  lineHeight: 32,
                  color: '#fff',
                  marginBottom: 2,
                }}
              >
                €
              </Text>
            </View>

            {/* Progress zur Schwelle */}
            <View style={{ marginTop: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 12, color: 'rgba(255,255,255,0.9)' }}>
                  {canRedeem ? 'Bereit zur Auszahlung' : 'Auszahlungs-Schwelle'}
                </Text>
                <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 12, color: '#fff' }}>
                  {balanceEur.toFixed(2).replace('.', ',')} € / {payoutThreshold.toFixed(2).replace('.', ',')} €
                </Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' }}>
                <View style={{ width: `${pct}%`, height: '100%', borderRadius: 3, backgroundColor: '#fff' }} />
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* ── Belohnungs-Optionen ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 24 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 20,
              color: theme.text,
              letterSpacing: -0.2,
              marginBottom: 12,
            }}
          >
            Wähle deine Belohnung
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {METHODS.map((m) => (
              <Pressable
                key={m.k}
                onPress={onRedeem}
                style={({ pressed }) => ({
                  width: '47.8%',
                  flexGrow: 1,
                  padding: 14,
                  borderRadius: 16,
                  backgroundColor: theme.surface,
                  borderWidth: 1,
                  borderColor: theme.border,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: m.tint + '1c',
                    marginBottom: 10,
                  }}
                >
                  <MaterialCommunityIcons name={m.icon as any} size={20} color={m.tint} />
                </View>
                <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 15, color: theme.text, letterSpacing: -0.2 }}>
                  {m.title}
                </Text>
                <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 11, color: theme.textMuted, marginTop: 2 }}>
                  {m.desc}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Haupt-CTA ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
          <Pressable
            disabled={!canRedeem}
            onPress={onRedeem}
            style={({ pressed }) => ({
              height: 54,
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
                fontSize: 16,
                color: canRedeem ? '#fff' : theme.textMuted,
                letterSpacing: 0.2,
              }}
            >
              {canRedeem ? 'Jetzt einlösen' : `Noch ${gapEur} € sammeln`}
            </Text>
            {canRedeem ? <MaterialCommunityIcons name="arrow-right" size={18} color="#fff" /> : null}
          </Pressable>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 11,
              color: theme.textMuted,
              textAlign: 'center',
              marginTop: 10,
              lineHeight: 16,
            }}
          >
            {canRedeem
              ? 'Die Auswahl der Belohnung erfolgt extern bei unserem Partner.'
              : `Sobald du die ${payoutThreshold.toFixed(2).replace('.', ',')} €-Schwelle erreichst, kannst du deine Taler hier einlösen.`}
          </Text>
        </View>

        {/* ── Bon-Verlauf-Link ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Bons-Verlauf öffnen"
            onPress={() => router.push('/cashback/history')}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              backgroundColor: theme.surface,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: theme.border,
              paddingHorizontal: 14,
              paddingVertical: 12,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: (theme.primary ?? '#0d8575') + '18',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons name="clipboard-list-outline" size={20} color={theme.primary ?? '#0d8575'} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 14, color: theme.text }}>Meine Bons</Text>
              <Text style={{ fontFamily, fontSize: 12, color: theme.textSub, marginTop: 2 }} numberOfLines={1}>
                Verlauf, Status & Ausgabenübersicht
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={theme.textMuted} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
