/**
 * Cashback Pending / Detail Screen — Phase 2.
 *
 * Subscribes to /users/{uid}/cashback_status/{id} (the slim mirror).
 * The mirror now carries items + signed image URL + merchant + total
 * so we can render a full "this is what we saw" detail view, not just
 * a status spinner.
 *
 * Layout:
 *  - DetailHeader with back arrow
 *  - Status banner (icon + title + body)
 *  - When approved/rejected/review: bon image + parsed line items +
 *    bon total + (for approved) cashback breakdown
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image as ExpoImage } from 'expo-image';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
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
import { subscribeReceipt } from '@/lib/services/cashbackUpload';
import { formatCents } from '@/lib/types/cashback';

const { width: SCREEN_W } = Dimensions.get('window');

type ViewState = 'unknown' | 'pending' | 'review' | 'approved' | 'rejected' | 'not_found';

interface MirrorItem {
  name: string;
  qty?: number;
  priceCents: number;
  eligible?: boolean;
}

interface MirrorDoc {
  id: string;
  status?: string;
  cashbackCents?: number;
  tierApplied?: number;
  eligibleItemCount?: number;
  merchant?: string | null;
  bonDate?: string | null;
  bonTotalCents?: number | null;
  paymentMethod?: string | null;
  items?: MirrorItem[];
  imageUrl?: string | null;
  rejectReason?: string | null;
  updatedAt?: any;
}

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

function formatDate(iso?: string | null) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export default function CashbackPendingScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme, shadows } = useTokens();

  const [doc, setDoc] = useState<MirrorDoc | null>(null);
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
      setDoc(data as any);
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

  const primary = theme.primary ?? '#0d8575';
  const warn = '#d6603a';
  const yellow = '#b08800';
  const headerOffset = insets.top + DETAIL_HEADER_ROW_HEIGHT;

  // ─── Status banner content ────────────────────────────────────────

  const banner = useMemo(() => {
    if (state === 'unknown') return null;
    if (state === 'pending') {
      return {
        icon: <ActivityIndicator size="large" color={primary} />,
        bg: primary + '18',
        title: 'Bon wird geprüft',
        body:
          'Das kann einen Moment dauern. Du kannst die App ruhig schließen — den Status findest du jederzeit unter „Meine Bons".',
        cashback: null as string | null,
      };
    }
    if (state === 'review') {
      return {
        icon: <MaterialCommunityIcons name="account-search-outline" size={42} color={yellow} />,
        bg: '#f1c40f30',
        title: 'In Prüfung',
        body:
          'Wir konnten den Bon nicht eindeutig auswerten. Sobald geklärt — meistens innerhalb eines Tages — siehst du das Ergebnis hier.',
        cashback: null,
      };
    }
    if (state === 'approved') {
      return {
        icon: <MaterialCommunityIcons name="check-circle-outline" size={42} color={primary} />,
        bg: primary + '18',
        title: 'Cashback gutgeschrieben',
        body:
          doc?.eligibleItemCount && doc.eligibleItemCount > 0
            ? `${doc.eligibleItemCount} ${doc.eligibleItemCount === 1 ? 'Artikel' : 'Artikel'} erkannt.`
            : 'Bon erfolgreich verbucht.',
        cashback: doc?.cashbackCents ? `+${formatCents(doc.cashbackCents)}` : null,
      };
    }
    if (state === 'rejected') {
      const reason = (doc?.rejectReason as string) ?? '';
      const body =
        reason === 'below_min_items'
          ? 'Auf dem Bon konnten wir weniger als 4 Artikel erkennen — für Cashback brauchen wir mindestens 4.'
          : reason === 'reconciliation_delta'
          ? 'Endbetrag und Einzelartikel passen nicht ganz zusammen. Wir konnten den Bon nicht verifizieren.'
          : reason === 'process_error'
          ? 'Bei der Auswertung ist etwas schiefgegangen. Wir versuchen es neu — sonst nochmal aufnehmen mit besserem Licht.'
          : 'Bon konnte nicht verbucht werden.';
      return {
        icon: <MaterialCommunityIcons name="close-circle-outline" size={42} color={warn} />,
        bg: warn + '22',
        title: 'Bon abgelehnt',
        body,
        cashback: null,
      };
    }
    return null;
  }, [state, primary, doc]);

  const items = doc?.items ?? [];
  const sumItemsCents = items.reduce((acc, it) => acc + (it.priceCents || 0), 0);
  const total = doc?.bonTotalCents ?? null;
  const bonDate = formatDate(doc?.bonDate);

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Bon-Details" onBack={() => router.back()} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: headerOffset + 8, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Status banner ─── */}
        {banner ? (
          <View
            style={{
              marginHorizontal: 16,
              padding: 18,
              borderRadius: radii.lg,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
              alignItems: 'center',
              gap: 8,
              ...(shadows.md ?? {}),
            }}
          >
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: banner.bg,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 4,
              }}
            >
              {banner.icon}
            </View>
            <Text
              style={{
                color: theme.text,
                fontFamily: fontFamily.heading,
                fontWeight: fontWeight.bold as any,
                fontSize: 20,
                textAlign: 'center',
              }}
            >
              {banner.title}
            </Text>
            {banner.cashback ? (
              <Text
                style={{
                  color: primary,
                  fontFamily: fontFamily.heading,
                  fontWeight: fontWeight.extraBold as any,
                  fontSize: 38,
                  letterSpacing: -0.5,
                }}
              >
                {banner.cashback}
              </Text>
            ) : null}
            <Text
              style={{
                color: theme.textSub,
                fontFamily: fontFamily.body,
                fontSize: 14,
                lineHeight: 20,
                textAlign: 'center',
                maxWidth: 320,
              }}
            >
              {banner.body}
            </Text>
          </View>
        ) : state === 'unknown' ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 60 }}>
            <ActivityIndicator color={primary} />
          </View>
        ) : null}

        {/* ─── Bon image ─── */}
        {doc?.imageUrl ? (
          <View
            style={{
              marginHorizontal: 16,
              marginTop: 16,
              borderRadius: radii.lg,
              overflow: 'hidden',
              backgroundColor: '#0a0a0a',
              borderWidth: 1,
              borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
            }}
          >
            <ExpoImage
              source={{ uri: doc.imageUrl }}
              style={{ width: '100%', aspectRatio: 0.75 }}
              contentFit="contain"
            />
          </View>
        ) : null}

        {/* ─── Bon meta (merchant + date) ─── */}
        {(doc?.merchant || bonDate) && state !== 'pending' && state !== 'unknown' ? (
          <View style={{ marginHorizontal: 16, marginTop: 16 }}>
            <Text style={{ color: theme.textSub, fontFamily: fontFamily.body, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
              Bon-Info
            </Text>
            <View
              style={{
                flexDirection: 'row',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              {doc?.merchant ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: theme.surfaceAlt ?? 'rgba(0,0,0,0.05)',
                  }}
                >
                  <MaterialCommunityIcons name="storefront-outline" size={14} color={theme.textSub} />
                  <Text style={{ color: theme.text, fontFamily: fontFamily.body, fontSize: 12, fontWeight: fontWeight.medium as any }}>
                    {doc.merchant}
                  </Text>
                </View>
              ) : null}
              {bonDate ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: theme.surfaceAlt ?? 'rgba(0,0,0,0.05)',
                  }}
                >
                  <MaterialCommunityIcons name="calendar-outline" size={14} color={theme.textSub} />
                  <Text style={{ color: theme.text, fontFamily: fontFamily.body, fontSize: 12, fontWeight: fontWeight.medium as any }}>
                    {bonDate}
                  </Text>
                </View>
              ) : null}
              {doc?.paymentMethod ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: theme.surfaceAlt ?? 'rgba(0,0,0,0.05)',
                  }}
                >
                  <MaterialCommunityIcons name="credit-card-outline" size={14} color={theme.textSub} />
                  <Text style={{ color: theme.text, fontFamily: fontFamily.body, fontSize: 12, fontWeight: fontWeight.medium as any }}>
                    {doc.paymentMethod}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* ─── Items list ─── */}
        {items.length > 0 && state !== 'pending' && state !== 'unknown' ? (
          <View style={{ marginHorizontal: 16, marginTop: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={{ color: theme.textSub, fontFamily: fontFamily.body, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Erkannte Artikel ({items.length})
              </Text>
              {doc?.eligibleItemCount !== undefined ? (
                <Text style={{ color: theme.textSub, fontFamily: fontFamily.body, fontSize: 12 }}>
                  {doc.eligibleItemCount} zählen für Cashback
                </Text>
              ) : null}
            </View>
            <View
              style={{
                backgroundColor: theme.surface,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
                overflow: 'hidden',
              }}
            >
              {items.map((it, idx) => {
                const ok = it.eligible !== false;
                return (
                  <View
                    key={`${idx}-${it.name}`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      gap: 10,
                      borderTopWidth: idx === 0 ? 0 : 1,
                      borderTopColor: theme.border ?? 'rgba(0,0,0,0.06)',
                    }}
                  >
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: ok ? primary + '22' : theme.surfaceAlt ?? '#eee',
                      }}
                    >
                      <MaterialCommunityIcons
                        name={ok ? 'check' : 'minus'}
                        size={14}
                        color={ok ? primary : theme.textMuted ?? theme.textSub}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        numberOfLines={2}
                        style={{
                          color: theme.text,
                          fontFamily: fontFamily.body,
                          fontSize: 14,
                          fontWeight: fontWeight.medium as any,
                        }}
                      >
                        {it.name || '(unbekannt)'}
                      </Text>
                      {it.qty && it.qty !== 1 ? (
                        <Text style={{ color: theme.textSub, fontFamily: fontFamily.body, fontSize: 12, marginTop: 2 }}>
                          Menge: {it.qty}
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      style={{
                        color: theme.text,
                        fontFamily: fontFamily.body,
                        fontWeight: fontWeight.bold as any,
                        fontSize: 14,
                      }}
                    >
                      {formatCents(it.priceCents)}
                    </Text>
                  </View>
                );
              })}

              {/* Σ row */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  gap: 10,
                  borderTopWidth: 1,
                  borderTopColor: theme.border ?? 'rgba(0,0,0,0.06)',
                  backgroundColor: theme.surfaceAlt ?? 'rgba(0,0,0,0.03)',
                }}
              >
                <View style={{ width: 22 }} />
                <Text style={{ flex: 1, color: theme.textSub, fontFamily: fontFamily.body, fontSize: 13, fontWeight: fontWeight.medium as any }}>
                  Σ Artikel
                </Text>
                <Text style={{ color: theme.text, fontFamily: fontFamily.body, fontWeight: fontWeight.bold as any, fontSize: 14 }}>
                  {formatCents(sumItemsCents)}
                </Text>
              </View>

              {/* Total row */}
              {total != null ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    gap: 10,
                    borderTopWidth: 1,
                    borderTopColor: theme.border ?? 'rgba(0,0,0,0.06)',
                  }}
                >
                  <View style={{ width: 22 }} />
                  <Text style={{ flex: 1, color: theme.text, fontFamily: fontFamily.body, fontSize: 14, fontWeight: fontWeight.bold as any }}>
                    Bon-Endbetrag
                  </Text>
                  <Text style={{ color: theme.text, fontFamily: fontFamily.heading, fontWeight: fontWeight.extraBold as any, fontSize: 16 }}>
                    {formatCents(total)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* ─── Not-found state ─── */}
        {state === 'not_found' ? (
          <View
            style={{
              marginHorizontal: 16,
              padding: 24,
              borderRadius: radii.lg,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <MaterialCommunityIcons name="link-off" size={42} color={warn} />
            <Text style={{ color: theme.text, fontFamily: fontFamily.heading, fontWeight: fontWeight.bold as any, fontSize: 18 }}>
              Eintrag nicht gefunden
            </Text>
            <Text style={{ color: theme.textSub, fontFamily: fontFamily.body, fontSize: 13, textAlign: 'center' }}>
              Wir konnten diesen Bon-Eintrag nicht laden.
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* ─── Sticky footer CTAs ─── */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.bottom + 12,
          borderTopWidth: 1,
          borderTopColor: theme.border ?? 'rgba(0,0,0,0.06)',
          backgroundColor: theme.bg,
          flexDirection: 'row',
          gap: 10,
        }}
      >
        <Pressable
          onPress={() => router.replace('/cashback/history')}
          style={({ pressed }) => ({
            flex: 1,
            height: 50,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: primary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ color: primary, fontFamily: fontFamily.body, fontWeight: fontWeight.bold as any, fontSize: 14 }}>
            Meine Bons
          </Text>
        </Pressable>
        <Pressable
          onPress={() =>
            state === 'rejected' || state === 'not_found'
              ? router.replace('/cashback/capture')
              : router.replace('/(tabs)/rewards')
          }
          style={({ pressed }) => ({
            flex: 1.4,
            height: 50,
            borderRadius: 14,
            backgroundColor: primary,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 6,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <MaterialCommunityIcons
            name={state === 'rejected' || state === 'not_found' ? 'camera-outline' : 'check'}
            size={16}
            color="#fff"
          />
          <Text style={{ color: '#fff', fontFamily: fontFamily.body, fontWeight: fontWeight.bold as any, fontSize: 14 }}>
            {state === 'rejected' || state === 'not_found' ? 'Neuer Bon' : 'Fertig'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
