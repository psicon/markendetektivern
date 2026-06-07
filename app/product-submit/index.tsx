/**
 * Product-photo submissions overview ("Produktbilder — voller Datensatz").
 * Purple theme to distinguish from cashback bons. Lists the user's
 * submitted products (same card UI as the bon history) with status; opens
 * the wizard via the CTA. Cashback only shown while a product-photo
 * campaign is running.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image as ExpoImage } from 'expo-image';
import { router, useNavigation } from 'expo-router';
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDownloadURL, ref as storageRef } from '@react-native-firebase/storage';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { FilterSheet } from '@/components/design/FilterSheet';
import { fontFamilyVariants, fontWeight, radii } from '@/constants/tokens';
import { storage } from '@/lib/firebase';
import { useTokens } from '@/hooks/useTokens';
import {
  PRODUCT_PHOTO_STEPS,
  getActiveProductCampaign,
  subscribeUserProductSubmissions,
  type ActiveProductCampaign,
  type ProductPhotoStep,
  type ProductSubmissionEntry,
} from '@/lib/services/productSubmit';

const PURPLE = '#5b4f9c';

function statusVisual(status?: string) {
  switch (status) {
    case 'approved':
      return { label: 'Bestätigt', color: '#2e7d32', bg: 'rgba(46,125,50,0.12)', icon: 'check-circle' };
    case 'rejected':
      return { label: 'Abgelehnt', color: '#d6603a', bg: 'rgba(214,96,58,0.12)', icon: 'close-circle' };
    default:
      return { label: 'In Prüfung', color: '#b08800', bg: 'rgba(176,136,0,0.12)', icon: 'progress-clock' };
  }
}

const STEP_LABEL: Record<ProductPhotoStep, string> = PRODUCT_PHOTO_STEPS.reduce(
  (acc, s) => {
    acc[s.key] = s.label;
    return acc;
  },
  {} as Record<ProductPhotoStep, string>,
);

/** Normalize a country code/name to a readable German label. */
function normalizeLand(land?: string | null): string | null {
  if (!land) return null;
  const map: { [k: string]: string } = {
    DE: 'Deutschland',
    Germany: 'Deutschland',
    Deutschland: 'Deutschland',
    AT: 'Österreich',
    Austria: 'Österreich',
    Österreich: 'Österreich',
    CH: 'Schweiz',
    Switzerland: 'Schweiz',
    Schweiz: 'Schweiz',
  };
  return map[land] || land;
}

function formatAbsolute(ts?: any): string {
  const ms = ts?.toMillis?.() ?? 0;
  if (!ms) return '';
  return new Date(ms).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(ts?: any): string {
  const ms = ts?.toMillis?.() ?? 0;
  if (!ms) return '';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'gestern';
  if (d < 7) return `vor ${d} Tagen`;
  return new Date(ms).toLocaleDateString('de-DE');
}

export default function ProductSubmitOverview() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme, shadows } = useTokens();
  const [rows, setRows] = useState<ProductSubmissionEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [campaign, setCampaign] = useState<ActiveProductCampaign | null>(null);
  // Tapped submission → detail sheet. URLs are resolved lazily (Storage
  // paths → download URLs) only when a row is opened.
  const [detailRow, setDetailRow] = useState<ProductSubmissionEntry | null>(null);
  const [detailUrls, setDetailUrls] = useState<Partial<Record<ProductPhotoStep, string>>>({});

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    const unsub = subscribeUserProductSubmissions((r) => {
      setRows(r);
      setLoaded(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    let alive = true;
    getActiveProductCampaign().then((c) => {
      if (alive) setCampaign(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Resolve the selected submission's image paths to download URLs.
  useEffect(() => {
    if (!detailRow?.images) {
      setDetailUrls({});
      return;
    }
    let alive = true;
    setDetailUrls({});
    const entries = Object.entries(detailRow.images) as [ProductPhotoStep, string][];
    Promise.all(
      entries.map(async ([step, path]) => {
        try {
          const url = await getDownloadURL(storageRef(storage, path));
          return [step, url] as const;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      if (!alive) return;
      const next: Partial<Record<ProductPhotoStep, string>> = {};
      pairs.forEach((p) => {
        if (p) next[p[0]] = p[1];
      });
      setDetailUrls(next);
    });
    return () => {
      alive = false;
    };
  }, [detailRow]);

  const total = rows.length;
  const headerOffset = insets.top + DETAIL_HEADER_ROW_HEIGHT;
  const stepTotal = PRODUCT_PHOTO_STEPS.length;
  const rewardEur =
    campaign && campaign.rewardCents > 0
      ? (campaign.rewardCents / 100).toFixed(2).replace('.', ',')
      : null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Produktbilder" onBack={() => router.back()} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: headerOffset + 8, paddingBottom: insets.bottom + 110 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={{ marginHorizontal: 16 }}>
          <View style={{ borderRadius: radii.xl, backgroundColor: PURPLE, padding: 16, gap: 6, ...(shadows.md ?? {}) }}>
            <Text style={{ color: '#fff', fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.extraBold as any, fontSize: 18 }}>
              Vollen Datensatz einreichen
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontFamily: fontFamilyVariants.body, fontSize: 13, lineHeight: 19 }}>
              Fotografiere ein Produkt aus {stepTotal} Ansichten (Front, Rückseite, Hersteller, EAN, Nährwerte, Zutaten, Preis) und hilf, unsere Datenbank zu vervollständigen.
            </Text>
            {rewardEur ? (
              <Text style={{ color: '#ffd44b', fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 13, marginTop: 2 }}>
                Aktuell {rewardEur} € pro komplettem Datensatz
              </Text>
            ) : null}
          </View>
        </View>

        {/* CTA */}
        <View style={{ marginHorizontal: 16, marginTop: 12 }}>
          <Pressable
            onPress={() => router.push('/product-submit/wizard')}
            style={({ pressed }) => ({
              height: 52,
              borderRadius: 14,
              backgroundColor: PURPLE,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <MaterialCommunityIcons name="camera-plus-outline" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 15 }}>
              Produkt erfassen
            </Text>
          </Pressable>
        </View>

        {/* Section header */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 22, marginBottom: 10 }}>
          <Text style={{ color: theme.text, fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.extraBold as any, fontSize: 20, letterSpacing: -0.2 }}>
            Zuletzt eingereicht
          </Text>
          <Text style={{ color: theme.textMuted ?? theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 12 }}>
            {total}
          </Text>
        </View>

        {/* List */}
        {!loaded ? null : total === 0 ? (
          <View style={{ marginHorizontal: 16, padding: 28, borderRadius: radii.lg, backgroundColor: theme.surfaceAlt ?? theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="package-variant-closed" size={44} color={theme.textMuted ?? theme.textSub} />
            <Text style={{ color: theme.text, fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 15 }}>
              Noch keine Produkte
            </Text>
            <Text style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 13, textAlign: 'center', maxWidth: 260, lineHeight: 19 }}>
              Erfasse dein erstes Produkt und hilf, die Datenbank zu vervollständigen.
            </Text>
          </View>
        ) : (
          rows.slice(0, 20).map((r) => {
            const v = statusVisual(r.status);
            const title = r.productName || `Produkt ${r.productIndex ?? ''}`.trim();
            const land = normalizeLand(r.marketLand);
            const marketLine = r.marketName ? `${r.marketName}${land ? ` (${land})` : ''} · ` : '';
            return (
              <Pressable
                key={r.id}
                onPress={() => setDetailRow(r)}
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
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: v.bg }}>
                  <MaterialCommunityIcons name={v.icon as any} size={22} color={v.color} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ color: theme.text, fontFamily: fontFamilyVariants.heading, fontWeight: fontWeight.extraBold as any, fontSize: 16, letterSpacing: -0.2 }}>
                    {title}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <Text style={{ color: v.color, backgroundColor: v.bg, fontFamily: fontFamilyVariants.medium, fontWeight: fontWeight.medium as any, fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>
                      {v.label}
                    </Text>
                    <Text numberOfLines={1} style={{ flex: 1, color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 12 }}>
                      {marketLine}
                      {formatRelative(r.createdAt)}
                    </Text>
                  </View>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={24} color={theme.textMuted ?? theme.textSub} />
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* Submission detail sheet (tap a row) */}
      <FilterSheet
        visible={!!detailRow}
        title={detailRow ? detailRow.productName || `Produkt ${detailRow.productIndex ?? ''}`.trim() : ''}
        onClose={() => setDetailRow(null)}
      >
        {detailRow
          ? (() => {
              const v = statusVisual(detailRow.status);
              const land = normalizeLand(detailRow.marketLand);
              return (
                <View style={{ paddingBottom: 8, gap: 14 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <Text style={{ color: v.color, backgroundColor: v.bg, fontFamily: fontFamilyVariants.medium, fontWeight: fontWeight.medium as any, fontSize: 12, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' }}>
                      {v.label}
                    </Text>
                    {detailRow.marketName ? (
                      <Text style={{ color: theme.text, fontFamily: fontFamilyVariants.body, fontWeight: fontWeight.bold as any, fontSize: 14 }}>
                        {detailRow.marketName}
                        {land ? ` (${land})` : ''}
                      </Text>
                    ) : null}
                  </View>

                  {detailRow.status !== 'approved' && detailRow.status !== 'rejected' ? (
                    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: 'rgba(176,136,0,0.10)', borderRadius: 12, padding: 12 }}>
                      <MaterialCommunityIcons name="progress-clock" size={18} color="#b08800" style={{ marginTop: 1 }} />
                      <Text style={{ flex: 1, color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 13, lineHeight: 18 }}>
                        Deine Einreichung ist da und wird geprüft — das kann ein bisschen dauern. Danke für deine Geduld, du hilfst, den Katalog zu vervollständigen.
                      </Text>
                    </View>
                  ) : null}

                  <View style={{ gap: 3 }}>
                    {formatAbsolute(detailRow.createdAt) ? (
                      <Text style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 13 }}>
                        Eingereicht: {formatAbsolute(detailRow.createdAt)}
                      </Text>
                    ) : null}
                    {detailRow.ean ? (
                      <Text style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 13 }}>EAN: {detailRow.ean}</Text>
                    ) : null}
                    <Text style={{ color: theme.textSub, fontFamily: fontFamilyVariants.body, fontSize: 13 }}>
                      {detailRow.stepCount ?? Object.keys(detailRow.images ?? {}).length}/{stepTotal} Ansichten
                    </Text>
                  </View>

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {PRODUCT_PHOTO_STEPS.map((s) => {
                      const url = detailUrls[s.key];
                      const has = !!detailRow.images?.[s.key];
                      return (
                        <View
                          key={s.key}
                          style={[styles.detThumb, { borderColor: has ? PURPLE : theme.border, backgroundColor: theme.surfaceAlt ?? '#eee' }]}
                        >
                          {url ? (
                            <ExpoImage source={{ uri: url }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                          ) : (
                            <MaterialCommunityIcons name={(has ? 'image-outline' : s.icon) as any} size={24} color={theme.textMuted ?? theme.textSub} />
                          )}
                          <View style={styles.detThumbLabel}>
                            <Text numberOfLines={1} style={{ color: '#fff', fontFamily: fontFamilyVariants.body, fontSize: 10, fontWeight: fontWeight.bold as any }}>
                              {STEP_LABEL[s.key]}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              );
            })()
          : null}
      </FilterSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  detThumb: { width: '31%', aspectRatio: 0.8, borderRadius: 12, borderWidth: 1.5, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  detThumbLabel: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 6, paddingVertical: 3 },
});
