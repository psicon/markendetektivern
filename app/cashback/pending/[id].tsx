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
import { getDownloadURL, ref as storageRef } from '@react-native-firebase/storage';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
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
import { useAuth } from '@/lib/contexts/AuthContext';
import { storage } from '@/lib/firebase';
import {
  deletePendingMirror,
  enqueueCashback,
  setPendingMirrorError,
  setPendingMirrorProgress,
  subscribeReceipt,
  uploadBonImage,
} from '@/lib/services/cashbackUpload';
import { formatCents } from '@/lib/types/cashback';
import { prepareForUpload } from '@/lib/utils/cashbackImage';
import journeyTrackingService from '@/lib/services/journeyTrackingService';

const { width: SCREEN_W } = Dimensions.get('window');

type ViewState = 'unknown' | 'uploading' | 'upload_failed' | 'pending' | 'review' | 'approved' | 'rejected' | 'not_found';

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
  // Set by the merchant matcher in the CF:
  merchantId?: string | null;
  merchantName?: string | null;
  merchantDisplayName?: string | null; // 'LiDL (DE)'
  merchantLogoUrl?: string | null;
  merchantLand?: string | null;
  merchantRaw?: string | null;
  bonCountry?: string | null;
  bonAgeDays?: number | null;
  // Legacy fallback (older mirror docs may still have `merchant`):
  merchant?: string | null;
  bonDate?: string | null;
  bonTotalCents?: number | null;
  items?: MirrorItem[];
  storageBucket?: string | null;
  storagePath?: string | null;
  reconciliationDeltaCents?: number | null;
  rejectReason?: string | null;
  // Client-side placeholder fields:
  isClientPlaceholder?: boolean;
  uploadProgress?: number; // 0–100
  uploadError?: string | null;
  updatedAt?: any;
}

function viewStateFor(status?: string | null): ViewState {
  switch (status) {
    case 'uploading':
      return 'uploading';
    case 'upload_failed':
      return 'upload_failed';
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
    case 'superseded':
      return 'not_found';
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
  const params = useLocalSearchParams<{
    id: string;
    dup?: string;
    // Optimistic-submit handoff from review screen:
    uploadUri?: string;
    uploadHash?: string;
    uploadWidth?: string;
    uploadHeight?: string;
    uploadCapturedAt?: string;
    uploadSource?: string;
  }>();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme, shadows } = useTokens();
  const { user } = useAuth();

  const [doc, setDoc] = useState<MirrorDoc | null>(null);
  const [hasResponded, setHasResponded] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadStep, setUploadStep] = useState<
    'idle' | 'uploading' | 'enqueueing' | 'done' | 'error'
  >('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showDuplicate, setShowDuplicate] = useState<boolean>(params.dup === '1');

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Upload+enqueue runner — extracted so the retry button can call it.
  const runUpload = useCallback(async () => {
    const localId = String(params.id ?? '');
    if (!user?.uid || !params.uploadUri) return;

    setUploadStep('uploading');
    setUploadError(null);

    try {
      const prepared = await prepareForUpload(
        String(params.uploadUri),
        2000,
        Number(params.uploadWidth ?? 0),
        Number(params.uploadHeight ?? 0),
      );

      // Throttle progress writes to mirror — every 5% only.
      let lastWrittenPct = 0;
      const upload = await uploadBonImage(prepared.uri, user.uid, {
        onProgress: (pct) => {
          if (pct - lastWrittenPct >= 5 || pct === 100) {
            lastWrittenPct = pct;
            setPendingMirrorProgress(user.uid!, localId, pct).catch(() => {});
          }
        },
        timeoutMs: 60_000,
      });

      setUploadStep('enqueueing');

      // Journey snapshot (geohash, motivation, viewedProducts) for audit.
      let journey: any = null;
      try {
        const j = journeyTrackingService.getCurrentJourney?.();
        if (j) {
          journey = {
            journeyId: j.journeyId,
            discoveryMethod: j.discoveryMethod,
            startedAt: j.startTime,
            location: j.location ?? null,
            motivationSignals: j.motivationSignals ?? null,
            filterMetricsMotivation: j.filterMetrics?.motivation ?? null,
            viewedProductsCount: j.viewedProducts?.length ?? 0,
          };
        }
      } catch {}

      const result = await enqueueCashback({
        clientUploadId: localId,
        storagePath: upload.storagePath,
        bytesHash: String(params.uploadHash ?? ''),
        capturedAt: Number(params.uploadCapturedAt ?? Date.now()),
        source: (params.uploadSource as any) || 'live_camera',
        journey,
      });

      setUploadStep('done');
      if (result.duplicate && result.cashbackId !== localId) {
        await deletePendingMirror(user.uid!, localId).catch(() => {});
        router.replace({
          pathname: '/cashback/pending/[id]' as any,
          params: { id: result.cashbackId, dup: '1' } as any,
        });
      }
      // Otherwise: same id, CF updates the same mirror doc.
    } catch (e: any) {
      const code = e?.code as string | undefined;
      const message = e?.message as string | undefined;
      const human =
        code === 'upload_timeout'
          ? 'Der Upload braucht zu lange. Prüfe deine Verbindung und versuch es erneut.'
          : code === 'rate_limited'
          ? 'Du hast heute schon einen Bon eingereicht. Morgen geht es weiter.'
          : code === 'consent_missing'
          ? 'Bitte bestätige zuerst die Cashback-Einwilligung.'
          : code === 'unauthenticated' || code === 'not_authenticated'
          ? 'Bitte melde dich an, um Bons einzureichen.'
          : code?.startsWith('storage/')
          ? `Upload abgelehnt: ${code}${message ? ' — ' + message : ''}`
          : code?.startsWith('http_')
          ? `Backend antwortet nicht (${code}). Verbindung okay?`
          : `Einreichen fehlgeschlagen: ${code || message || 'unbekannter Fehler'}`;

      setUploadError(human);
      setUploadStep('error');
      // Persist failure to the mirror so the user sees it everywhere
      // (history, etc.) — and it doesn't show as "uploading forever".
      await setPendingMirrorError(user.uid!, localId, human).catch(() => {});
    }
  }, [
    params.id,
    params.uploadUri,
    params.uploadHash,
    params.uploadWidth,
    params.uploadHeight,
    params.uploadCapturedAt,
    params.uploadSource,
    user?.uid,
  ]);

  // Run the upload exactly once when we arrive with handoff params.
  const hasUploadHandoff = !!params.uploadUri && uploadStep === 'idle';
  useEffect(() => {
    if (!hasUploadHandoff) return;
    if (!user?.uid) {
      setUploadError('Bitte melde dich an, um Bons einzureichen.');
      setUploadStep('error');
      return;
    }
    runUpload();
  }, [hasUploadHandoff, user?.uid, runUpload]);

  // Live snapshot — the placeholder mirror exists from the moment the
  // user tapped "Einreichen", so subscribing immediately works for
  // both the placeholder ('uploading') AND the final state.
  useEffect(() => {
    const id = String(params.id ?? '');
    if (!id) {
      setHasResponded(true);
      return;
    }
    const unsub = subscribeReceipt(id, (data) => {
      setDoc(data as any);
      setHasResponded(true);
    });
    return unsub;
  }, [params.id]);

  // Resolve a download URL for the bon image whenever the storagePath
  // changes. Storage rules permit the owner to read; getDownloadURL
  // returns a long-lived token URL.
  useEffect(() => {
    let alive = true;
    const path = doc?.storagePath;
    if (!path) {
      setImageUrl(null);
      return;
    }
    (async () => {
      try {
        const url = await getDownloadURL(storageRef(storage, path));
        if (alive) setImageUrl(url);
      } catch (e: any) {
        console.warn('⚠️ getDownloadURL failed:', e?.message);
        if (alive) setImageUrl(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [doc?.storagePath]);

  const state: ViewState = useMemo(() => {
    if (uploadStep === 'error') return 'rejected';
    // Visual state is driven by the mirror doc's status. Upload-step is
    // only used to override copy / show the "Einreichen fehlgeschlagen"
    // banner — actual state comes from Firestore so the user gets the
    // truth even after closing the app.
    if (!hasResponded) return 'unknown';
    if (!doc) {
      // Placeholder might have been deleted (superseded after dedup) —
      // most likely the user is now on a different doc. If we're still
      // mid-upload, show 'uploading' (the mirror writes are eventually
      // consistent and may not have hit yet).
      return uploadStep === 'uploading' || uploadStep === 'enqueueing'
        ? 'uploading'
        : 'not_found';
    }
    return viewStateFor(doc.status);
  }, [doc, hasResponded, uploadStep]);

  const primary = theme.primary ?? '#0d8575';
  const warn = '#d6603a';
  const yellow = '#b08800';
  const headerOffset = insets.top + DETAIL_HEADER_ROW_HEIGHT;

  // ─── Status banner content ────────────────────────────────────────

  const banner = useMemo(() => {
    if (state === 'unknown') return null;
    if (state === 'uploading') {
      const pct =
        typeof doc?.uploadProgress === 'number' ? doc.uploadProgress : null;
      return {
        icon: <ActivityIndicator size="large" color={primary} />,
        bg: primary + '18',
        title: 'Bon wird hochgeladen',
        body:
          pct != null
            ? `Wir laden dein Foto hoch — ${pct} %.`
            : 'Wir laden dein Foto hoch — bleib einen Moment dran.',
        cashback: null as string | null,
      };
    }
    if (state === 'pending') {
      return {
        icon: <ActivityIndicator size="large" color={primary} />,
        bg: primary + '18',
        title: 'Bon wird geprüft',
        body:
          'Das dauert nur einen Moment. Du siehst das Ergebnis hier oder unter „Meine Bons", sobald wir fertig sind.',
        cashback: null,
      };
    }
    if (state === 'upload_failed') {
      return {
        icon: <MaterialCommunityIcons name="cloud-alert-outline" size={42} color={warn} />,
        bg: warn + '22',
        title: 'Upload fehlgeschlagen',
        body: doc?.uploadError || uploadError || 'Verbindung abgebrochen. Tippe auf „Erneut versuchen", um den Upload neu zu starten.',
        cashback: null,
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
          : reason === 'unknown_merchant'
          ? `Diesen Markt unterstützen wir aktuell noch nicht für Cashback.${doc?.merchantRaw ? ` Erkannt als: „${doc.merchantRaw}".` : ''}`
          : reason === 'bon_too_old'
          ? `Dieser Bon ist zu alt — wir nehmen nur Bons der letzten 5 Tage an.${typeof doc?.bonAgeDays === 'number' ? ` Dieser Bon ist ${doc.bonAgeDays} Tage alt.` : ''}`
          : reason === 'not_a_receipt'
          ? 'Das Foto sieht nicht nach einem Kassenbon aus. Bitte versuche es nochmal mit einem klar lesbaren Bon.'
          : reason === 'process_error'
          ? 'Bei der Auswertung ist etwas schiefgegangen. Versuche es nochmal mit einem schärferen Foto.'
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
        {/* ─── Duplicate-friendly banner ─── */}
        {showDuplicate ? (
          <View
            style={{
              marginHorizontal: 16,
              marginBottom: 8,
              padding: 12,
              borderRadius: radii.md ?? 12,
              backgroundColor: '#f1c40f22',
              borderWidth: 1,
              borderColor: '#f1c40f55',
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <MaterialCommunityIcons name="information-outline" size={18} color="#b08800" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ color: theme.text, fontFamily: fontFamily.body, fontWeight: fontWeight.bold as any, fontSize: 14 }}>
                Diesen Bon hattest du schon eingereicht
              </Text>
              <Text style={{ color: theme.textSub, fontFamily: fontFamily.body, fontSize: 13, marginTop: 2, lineHeight: 18 }}>
                Wir zeigen dir den ursprünglichen Eintrag — du wirst nicht doppelt belohnt, aber auch nicht doppelt belastet.
              </Text>
            </View>
            <Pressable onPress={() => setShowDuplicate(false)} hitSlop={8}>
              <MaterialCommunityIcons name="close" size={16} color={theme.textSub} />
            </Pressable>
          </View>
        ) : null}

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

            {/* Progress bar — only shown during 'uploading' */}
            {state === 'uploading' ? (
              <View
                style={{
                  width: '100%',
                  maxWidth: 280,
                  marginTop: 12,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: primary + '22',
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    width: `${typeof doc?.uploadProgress === 'number' ? Math.max(2, doc.uploadProgress) : 8}%`,
                    height: '100%',
                    backgroundColor: primary,
                  }}
                />
              </View>
            ) : null}

            {/* Retry button — only shown on upload_failed */}
            {state === 'upload_failed' ? (
              <Pressable
                onPress={runUpload}
                style={({ pressed }) => ({
                  marginTop: 14,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  borderRadius: 14,
                  backgroundColor: primary,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <MaterialCommunityIcons name="refresh" size={16} color="#fff" />
                <Text
                  style={{
                    color: '#fff',
                    fontFamily: fontFamily.body,
                    fontWeight: fontWeight.bold as any,
                    fontSize: 14,
                  }}
                >
                  Erneut versuchen
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : state === 'unknown' ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 60 }}>
            <ActivityIndicator color={primary} />
          </View>
        ) : null}

        {/* ─── Merchant hero — large logo + bold name + date below ─── */}
        {(doc?.merchantName || doc?.merchant) && (state === 'approved' || state === 'rejected' || state === 'review') ? (
          <View
            style={{
              marginHorizontal: 16,
              marginTop: 16,
              padding: 16,
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
            {doc?.merchantLogoUrl ? (
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 14,
                  backgroundColor: '#fff',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
                  overflow: 'hidden',
                }}
              >
                <ExpoImage
                  source={{ uri: doc.merchantLogoUrl }}
                  style={{ width: 56, height: 56 }}
                  contentFit="contain"
                />
              </View>
            ) : (
              <View
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 14,
                  backgroundColor: theme.surfaceAlt ?? 'rgba(0,0,0,0.06)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialCommunityIcons name="storefront-outline" size={32} color={theme.textSub} />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={2}
                style={{
                  color: theme.text,
                  fontFamily: fontFamily.heading,
                  fontWeight: fontWeight.extraBold as any,
                  fontSize: 22,
                  letterSpacing: -0.3,
                }}
              >
                {doc?.merchantDisplayName || doc?.merchantName || doc?.merchant}
              </Text>
              {bonDate ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <MaterialCommunityIcons name="calendar-outline" size={14} color={theme.textSub} />
                  <Text style={{ color: theme.textSub, fontFamily: fontFamily.body, fontSize: 13 }}>
                    {bonDate}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* ─── Items list ─── */}
        {items.length > 0 && (state === 'approved' || state === 'rejected' || state === 'review') ? (
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

        {/* ─── Bon image (below the parsed details) ─── */}
        {imageUrl && (state === 'approved' || state === 'rejected' || state === 'review') ? (
          <View style={{ marginHorizontal: 16, marginTop: 18 }}>
            <Text
              style={{
                color: theme.textSub,
                fontFamily: fontFamily.body,
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                marginBottom: 8,
              }}
            >
              Bon-Foto
            </Text>
            <View
              style={{
                borderRadius: radii.lg,
                overflow: 'hidden',
                backgroundColor: '#0a0a0a',
                borderWidth: 1,
                borderColor: theme.border ?? 'rgba(0,0,0,0.06)',
              }}
            >
              <ExpoImage
                source={{ uri: imageUrl }}
                style={{ width: '100%', aspectRatio: 0.7 }}
                contentFit="contain"
              />
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
