/**
 * Auszahlung — Betrag wählen + anfragen.
 *
 * Eigene Seite (kein Bottom-Sheet): ein fokussierbares TextInput im
 * Reanimated/Modal-Sheet crasht auf New-Arch — Vollbild + KeyboardAvoiding
 * ist robust. Betrag frei eingebbar + −/+ (1€) + Min/Max, geclampt auf
 * [Schwelle, Guthaben]. Bei Bestätigung: requestPayout → auf den
 * Tremendous-Order-Trigger warten → Redemption-Link im In-App-Browser
 * öffnen (Mail-Backup gibt es nicht, der Link liegt unter „Meine
 * Auszahlungen").
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as WebBrowser from 'expo-web-browser';
import { router, useNavigation } from 'expo-router';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useCashbackUserState } from '@/lib/hooks/useCashbackUserState';
import { getCashbackConfig } from '@/lib/services/cashbackService';
import { requestPayout, subscribePayout } from '@/lib/services/cashbackUpload';
import { showInfoToast } from '@/lib/services/ui/toast';

const THRESHOLD_FALLBACK_CENTS = 1000;

const eurStr = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const parseEurToCents = (s: string): number => {
  const n = parseFloat(String(s).replace(/[^\d,.]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

export default function PayoutScreen() {
  const { theme } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { user } = useAuth();
  const cashback = useCashbackUserState();
  const primary = theme.primary ?? '#0d8575';

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const [thresholdCents, setThresholdCents] = useState(THRESHOLD_FALLBACK_CENTS);
  useEffect(() => {
    let alive = true;
    getCashbackConfig()
      .then((c) => {
        if (alive && typeof c.payoutThresholdCents === 'number') setThresholdCents(c.payoutThresholdCents);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const balanceCents = cashback.uid ? cashback.balanceCents : 0;
  const payoutEmail = user?.email ?? null;
  const clamp = (c: number) => Math.max(thresholdCents, Math.min(balanceCents, Math.round(c || 0)));

  const [amountText, setAmountText] = useState('');
  // Initialwert = ganze Balance, sobald bekannt (einmalig).
  const initRef = useRef(false);
  useEffect(() => {
    if (!initRef.current && balanceCents >= thresholdCents) {
      initRef.current = true;
      setAmountText(eurStr(balanceCents));
    }
  }, [balanceCents, thresholdCents]);

  const cents = clamp(parseEurToCents(amountText));
  const step = (delta: number) => setAmountText(eurStr(clamp(cents + delta)));

  const [busy, setBusy] = useState(false);
  const unsubRef = useRef<null | (() => void)>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanup = () => {
    unsubRef.current?.();
    unsubRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => cleanup, []);

  const headerOffset = insets.top + DETAIL_HEADER_ROW_HEIGHT;
  const canPay = !!payoutEmail && balanceCents >= thresholdCents && !busy;

  const onConfirm = async () => {
    if (busy) return;
    const amount = clamp(parseEurToCents(amountText));
    setBusy(true);
    try {
      const r = await requestPayout(amount);
      const payoutId = r.payoutId;
      if (!payoutId) throw new Error('no_payout_id');
      unsubRef.current = subscribePayout(payoutId, async (p) => {
        if (!p) return;
        if (p.status === 'sent') {
          cleanup();
          setBusy(false);
          if (p.redemptionLink) {
            try {
              await WebBrowser.openBrowserAsync(p.redemptionLink);
            } catch {}
          } else {
            showInfoToast('Auszahlung angefragt — du findest sie unter „Meine Auszahlungen".', 'info', scheme);
          }
          router.replace('/cashback/payouts');
        } else if (p.status === 'failed') {
          cleanup();
          setBusy(false);
          showInfoToast('Auszahlung fehlgeschlagen — dein Guthaben wurde zurückgebucht.', 'error', scheme);
        }
      });
      timerRef.current = setTimeout(() => {
        cleanup();
        setBusy(false);
        showInfoToast('Auszahlung läuft — Status unter „Meine Auszahlungen".', 'info', scheme);
        router.replace('/cashback/payouts');
      }, 20000);
    } catch (e: any) {
      cleanup();
      setBusy(false);
      const msg =
        e?.code === 'below_threshold' || e?.code === 'below_min_amount'
          ? 'Dein Guthaben reicht noch nicht für eine Auszahlung.'
          : 'Auszahlung konnte nicht angefragt werden. Bitte versuch es später nochmal.';
      showInfoToast(msg, 'error', scheme);
    }
  };

  const stepBtnStyle = (pressed: boolean) =>
    ({
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.surfaceAlt ?? theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: pressed ? 0.6 : 1,
    } as const);

  const chip = (label: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: primary + '18',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 13, color: primary }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Auszahlung" onBack={() => router.back()} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerOffset}
      >
        <ScrollView
          contentContainerStyle={{ paddingTop: headerOffset + 16, paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={{ fontFamily, fontWeight: fontWeight.bold as any, fontSize: 12, color: theme.textMuted, textAlign: 'center' }}>
            Verfügbar: {eurStr(balanceCents)} €
          </Text>

          {/* Betrag — − [Eingabe] + */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 18 }}>
            <Pressable onPress={() => step(-100)} hitSlop={6} style={({ pressed }) => stepBtnStyle(pressed)}>
              <MaterialCommunityIcons name="minus" size={22} color={theme.text} />
            </Pressable>

            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' }}>
              <TextInput
                value={amountText}
                onChangeText={setAmountText}
                onBlur={() => setAmountText(eurStr(cents))}
                keyboardType="decimal-pad"
                returnKeyType="done"
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold as any,
                  fontSize: 40,
                  letterSpacing: -1,
                  color: theme.text,
                  textAlign: 'right',
                  minWidth: 110,
                  padding: 0,
                }}
              />
              <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 26, color: theme.text, marginLeft: 4 }}>€</Text>
            </View>

            <Pressable onPress={() => step(100)} hitSlop={6} style={({ pressed }) => stepBtnStyle(pressed)}>
              <MaterialCommunityIcons name="plus" size={22} color={theme.text} />
            </Pressable>
          </View>

          {/* Min / Max */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 16 }}>
            {chip(`Min · ${eurStr(thresholdCents)} €`, () => setAmountText(eurStr(thresholdCents)))}
            {chip(`Max · ${eurStr(balanceCents)} €`, () => setAmountText(eurStr(balanceCents)))}
          </View>

          {/* Hinweis / fehlende E-Mail */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 8,
              marginTop: 24,
              padding: 14,
              borderRadius: 14,
              backgroundColor: payoutEmail ? theme.surface : '#f59e0b1c',
              borderWidth: 1,
              borderColor: payoutEmail ? theme.border : 'transparent',
            }}
          >
            <MaterialCommunityIcons
              name={payoutEmail ? 'information-outline' : 'alert-outline'}
              size={16}
              color={payoutEmail ? theme.textMuted : '#b8860b'}
              style={{ marginTop: 1 }}
            />
            <Text
              style={{
                flex: 1,
                fontFamily,
                fontWeight: payoutEmail ? fontWeight.medium : (fontWeight.bold as any),
                fontSize: 12,
                color: payoutEmail ? theme.textMuted : '#8a6d00',
                lineHeight: 17,
              }}
            >
              {payoutEmail
                ? 'Die Auszahlungsseite öffnet sich direkt hier — du findest sie auch jederzeit unter „Meine Auszahlungen". Dort wählst du die Auszahlungsart (Gutschein, PayPal, Überweisung u. a.).'
                : 'Du hast keine E-Mail hinterlegt. Füge zuerst in deinem Profil eine E-Mail hinzu, dann kannst du auszahlen.'}
            </Text>
          </View>
        </ScrollView>

        {/* Bestätigen */}
        <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 12, paddingTop: 8 }}>
          <Pressable
            disabled={!canPay}
            onPress={onConfirm}
            style={({ pressed }) => ({
              height: 54,
              borderRadius: 14,
              backgroundColor: primary,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              opacity: !canPay ? 0.6 : pressed ? 0.9 : 1,
            })}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 16, color: '#fff', letterSpacing: 0.2 }}>
                  {eurStr(cents)} € auszahlen
                </Text>
                <MaterialCommunityIcons name="arrow-right" size={18} color="#fff" />
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
