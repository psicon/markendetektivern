/**
 * Cashback Pending Screen — Phase 2.
 *
 * Listens to /receipts/{id} via subscribeReceipt() and renders one of:
 *   - 'ocr_pending' / 'ocr_done' / 'matched' / 'review' → animated waiting state
 *   - 'approved'  → success card with cashback amount + back-to-rewards CTA
 *   - 'rejected'  → reject card with reason + retry CTA
 *
 * No FCM push yet (Phase 2.1) — the snapshot listener does the work.
 * Once the user has the screen open they get the verdict in real time.
 *
 * Local-stub IDs (`local-…`) from earlier are also handled gracefully.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { subscribeReceipt } from '@/lib/services/cashbackUpload';
import { formatCents, type ReceiptDoc } from '@/lib/types/cashback';

type ViewState =
  | 'unknown'
  | 'pending'
  | 'review'
  | 'approved'
  | 'rejected'
  | 'not_found';

function viewStateFor(status?: string | null): ViewState {
  switch (status) {
    case 'ocr_pending':
    case 'ocr_done':
    case 'matched':
      return 'pending';
    case 'review':
      return 'review';
    case 'approved':
    case 'paid':
      return 'approved';
    case 'rejected':
      return 'rejected';
    default:
      return 'unknown';
  }
}

export default function CashbackPendingScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme, shadows } = useTokens();

  const [doc, setDoc] = useState<(Partial<ReceiptDoc> & { id: string }) | null>(null);
  const [hasResponded, setHasResponded] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    const id = String(params.id ?? '');
    if (!id || id.startsWith('local-')) {
      setHasResponded(true);
      return;
    }
    const unsub = subscribeReceipt(id, (data) => {
      setDoc(data);
      setHasResponded(true);
    });
    return unsub;
  }, [params.id]);

  const state: ViewState = useMemo(() => {
    if (!hasResponded) return 'unknown';
    if (!doc) {
      const id = String(params.id ?? '');
      return id.startsWith('local-') ? 'pending' : 'not_found';
    }
    return viewStateFor(doc.status);
  }, [doc, hasResponded, params.id]);

  const cashbackEur = doc?.cashbackCents ? formatCents(doc.cashbackCents) : null;
  const itemCount = Array.isArray(doc?.items) ? doc!.items!.length : 0;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flex: 1,
          backgroundColor: theme.bg,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 24,
          justifyContent: 'space-between',
        },
        center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
        iconBubble: {
          width: 84,
          height: 84,
          borderRadius: 42,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 8,
        },
        title: {
          color: theme.text,
          fontFamily: fontFamily.heading,
          fontWeight: fontWeight.bold as any,
          fontSize: 22,
          textAlign: 'center',
        },
        body: {
          color: theme.textSub,
          fontFamily: fontFamily.body,
          fontSize: 14,
          lineHeight: 20,
          textAlign: 'center',
          maxWidth: 320,
        },
        amount: {
          color: theme.primary ?? '#0d8575',
          fontFamily: fontFamily.heading,
          fontWeight: fontWeight.extraBold as any,
          fontSize: 38,
          letterSpacing: -0.5,
          marginTop: 4,
        },
        idPill: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 999,
          marginTop: 6,
          backgroundColor: theme.surfaceAlt ?? 'rgba(0,0,0,0.05)',
        },
        idText: { fontFamily: fontFamily.body, fontSize: 12, color: theme.textSub },
        cta: {
          height: 52,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          backgroundColor: theme.primary ?? '#0d8575',
        },
        ctaText: {
          color: '#fff',
          fontFamily: fontFamily.body,
          fontWeight: fontWeight.bold as any,
          fontSize: 15,
        },
        ctaSecondary: {
          height: 50,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: theme.primary ?? '#0d8575',
          marginTop: 10,
        },
        ctaSecondaryText: {
          color: theme.primary ?? '#0d8575',
          fontFamily: fontFamily.body,
          fontWeight: fontWeight.bold as any,
          fontSize: 14,
        },
      }),
    [theme, insets.top, insets.bottom],
  );

  const colorOk = theme.primary ?? '#0d8575';
  const colorWarn = '#d6603a';

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.center}>
          {state === 'unknown' ? (
            <>
              <ActivityIndicator color={colorOk} />
              <Text style={styles.body}>Hole Status…</Text>
            </>
          ) : null}

          {state === 'pending' ? (
            <>
              <View style={[styles.iconBubble, { backgroundColor: colorOk + '20' }]}>
                <ActivityIndicator color={colorOk} size="large" />
              </View>
              <Text style={styles.title}>Bon wird geprüft</Text>
              <Text style={styles.body}>
                Das kann einen Moment dauern. Du kannst die App ruhig schließen — den Status
                findest du jederzeit unter „Meine Bons".
              </Text>
            </>
          ) : null}

          {state === 'review' ? (
            <>
              <View style={[styles.iconBubble, { backgroundColor: '#f1c40f30' }]}>
                <MaterialCommunityIcons name="account-search-outline" size={42} color="#b08800" />
              </View>
              <Text style={styles.title}>In Prüfung</Text>
              <Text style={styles.body}>
                Wir konnten den Bon nicht eindeutig auswerten und schauen genauer hin. Sobald
                geklärt — meistens innerhalb eines Tages — siehst du das Ergebnis unter
                „Meine Bons".
              </Text>
            </>
          ) : null}

          {state === 'approved' ? (
            <>
              <View style={[styles.iconBubble, { backgroundColor: colorOk + '20' }]}>
                <MaterialCommunityIcons name="check-circle-outline" size={42} color={colorOk} />
              </View>
              <Text style={styles.title}>Cashback gutgeschrieben</Text>
              {cashbackEur ? <Text style={styles.amount}>+{cashbackEur}</Text> : null}
              {itemCount ? (
                <Text style={styles.body}>{itemCount} erkannte Artikel auf dem Bon.</Text>
              ) : null}
            </>
          ) : null}

          {state === 'rejected' ? (
            <>
              <View style={[styles.iconBubble, { backgroundColor: colorWarn + '22' }]}>
                <MaterialCommunityIcons name="close-circle-outline" size={42} color={colorWarn} />
              </View>
              <Text style={styles.title}>Bon abgelehnt</Text>
              <Text style={styles.body}>
                {(doc?.rejectReason as any) === 'below_min_items'
                  ? 'Auf dem Bon waren zu wenige erkennbare Artikel (mindestens 4 nötig).'
                  : (doc?.rejectReason as any) === 'reconciliation_delta'
                  ? 'Wir konnten Endbetrag und Einzelartikel nicht passend zuordnen.'
                  : 'Wir konnten den Bon nicht erfolgreich auswerten. Bitte versuch es mit einem schärferen Foto erneut.'}
              </Text>
            </>
          ) : null}

          {state === 'not_found' ? (
            <>
              <View style={[styles.iconBubble, { backgroundColor: colorWarn + '22' }]}>
                <MaterialCommunityIcons name="link-off" size={42} color={colorWarn} />
              </View>
              <Text style={styles.title}>Eintrag nicht gefunden</Text>
              <Text style={styles.body}>
                Wir konnten diesen Bon-Eintrag nicht laden. Möglicherweise wurde er gelöscht oder
                gehört zu einem anderen Konto.
              </Text>
            </>
          ) : null}

          <View style={styles.idPill}>
            <MaterialCommunityIcons name="identifier" size={14} color={theme.textSub} />
            <Text style={styles.idText}>{params.id ?? '—'}</Text>
          </View>
        </View>
      </ScrollView>

      <Pressable onPress={() => router.replace('/(tabs)/rewards')} style={styles.cta}>
        <Text style={styles.ctaText}>Zurück zu Cashback</Text>
      </Pressable>

      {state === 'rejected' || state === 'not_found' ? (
        <Pressable onPress={() => router.replace('/cashback/capture')} style={styles.ctaSecondary}>
          <Text style={styles.ctaSecondaryText}>Neuen Bon scannen</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
