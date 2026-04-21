import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RatingsSheet, type Rating, type SubmittedRating } from '@/components/design/RatingsSheet';
import { ProductDetailSkeleton } from '@/components/design/Skeletons';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useFavorites } from '@/lib/hooks/useFavorites';
import { FirestoreService } from '@/lib/services/firestore';
import {
  showCartAddedToast,
  showFavoriteAddedToast,
  showFavoriteRemovedToast,
  showInfoToast,
} from '@/lib/services/ui/toast';
import type { ProductWithDetails } from '@/lib/types/firestore';

// ────────────────────────────────────────────────────────────────────────

type Tab = 'ingredients' | 'nutrition';

const STUFE_INFO: Record<1 | 2, { label: string; line: string }> = {
  2: {
    label: 'Günstige Eigenmarke',
    line: 'Solides Preis-Leistungs-Verhältnis, vergleichbar mit Standardware.',
  },
  1: {
    label: 'Einfache Eigenmarke',
    line: 'Budget-Option mit Basis-Qualität — ideal für den kleinen Geldbeutel.',
  },
};

const parseStufe = (s: any): 1 | 2 | 3 | 4 | 5 => {
  const n = parseInt(String(s)) || 1;
  return Math.min(5, Math.max(1, n)) as 1 | 2 | 3 | 4 | 5;
};

const formatEur = (v?: number | null) =>
  v == null ? '—' : `${v.toFixed(2).replace('.', ',')}€`;

function formatPack(size?: number, unit?: string, price?: number): string | null {
  if (!size || !unit) return null;
  const u = unit.toLowerCase().replace(/\.$/, '');
  const isStk = u === 'stk' || u === 'stück';
  const sizeLabel = isStk ? `${size} ${unit}` : `${size}${unit}`;
  let unitPrice: string | null = null;
  if (price && price > 0) {
    if (u === 'g') unitPrice = `${((price / size) * 1000).toFixed(2).replace('.', ',')}€/kg`;
    else if (u === 'kg') unitPrice = `${(price / size).toFixed(2).replace('.', ',')}€/kg`;
    else if (u === 'ml') unitPrice = `${((price / size) * 1000).toFixed(2).replace('.', ',')}€/L`;
    else if (u === 'l') unitPrice = `${(price / size).toFixed(2).replace('.', ',')}€/L`;
    else if (isStk) unitPrice = `${(price / size).toFixed(2).replace('.', ',')}€/Stk.`;
  }
  return unitPrice ? `${sizeLabel} · ${unitPrice}` : sizeLabel;
}

// ────────────────────────────────────────────────────────────────────────
// Screen — Orphan NoName (no brand product linked) per prototype
// `ProductDetailOrphan`. Stufe 1 & 2 land here because they don't have a
// meaningful comparison target.
// ────────────────────────────────────────────────────────────────────────

export default function NoNameDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme, brand, shadows, stufen } = useTokens();
  const { user } = useAuth();
  const { toggleFavorite } = useFavorites();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<ProductWithDetails | null>(null);

  const [tab, setTab] = useState<Tab>('ingredients');
  const [isFav, setIsFav] = useState(false);
  const [inCart, setInCart] = useState(false);
  const [ratingsOpen, setRatingsOpen] = useState(false);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [ratingsLoading, setRatingsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await FirestoreService.getProductWithDetails(String(id));
        if (!data) {
          setError('Produkt nicht gefunden');
          return;
        }
        setProduct(data);
      } catch (e) {
        console.warn('NoNameDetail: load failed', e);
        setError('Fehler beim Laden');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top }}>
        <ProductDetailSkeleton />
      </View>
    );
  }

  if (error || !product) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <MaterialCommunityIcons name="alert-circle-outline" size={48} color={theme.textMuted} />
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 16,
            color: theme.text,
            marginTop: 12,
            textAlign: 'center',
          }}
        >
          {error ?? 'Produkt nicht verfügbar'}
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({
            marginTop: 20,
            height: 44,
            paddingHorizontal: 22,
            borderRadius: radii.full,
            backgroundColor: brand.primary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 14, color: '#fff' }}>
            Zurück
          </Text>
        </Pressable>
      </View>
    );
  }

  // ─── Derived data ─────────────────────────────────────────────────────
  const p = product as any;
  const stufe = parseStufe(p.stufe);
  const stufeColor = stufen[stufe];
  // Only stufes 1-2 have an orphan-specific one-liner; higher stufes
  // fall back to a generic line because they shouldn't really land here.
  const stufeInfo =
    stufe in STUFE_INFO
      ? STUFE_INFO[stufe as 1 | 2]
      : { label: 'Eigenmarke', line: 'Zu diesem Produkt ist aktuell kein Markenoriginal hinterlegt.' };

  const disc = p.discounter as
    | { name?: string; color?: string; bild?: string; land?: string }
    | undefined;
  const hm = p.handelsmarke as { bezeichnung?: string; name?: string } | undefined;
  const handelsmarkeName = hm?.bezeichnung ?? hm?.name ?? null;
  const herstellerName = p.hersteller?.name ?? p.hersteller?.herstellername ?? null;
  const categoryName = p.kategorie?.bezeichnung ?? p.kategorie?.name ?? null;

  const packInfo = formatPack(
    p.packSize,
    p.packTypInfo?.typKurz ?? p.packTypInfo?.typ,
    p.preis,
  );

  const rating = (p.averageRatingOverall as number | undefined)?.toFixed(1);

  // ─── Handlers ─────────────────────────────────────────────────────────
  const onFavPress = async () => {
    setIsFav((v) => !v);
    try {
      const now = await toggleFavorite(p.id, 'noname', p);
      if (now) showFavoriteAddedToast(p.name ?? 'Produkt');
      else showFavoriteRemovedToast(p.name ?? 'Produkt');
    } catch {
      setIsFav((v) => !v);
    }
  };
  const onCartPress = async () => {
    if (!user?.uid) {
      showInfoToast('Bitte anmelden');
      return;
    }
    if (inCart) {
      setInCart(false);
      showInfoToast('Aus Einkaufsliste entfernt');
      return;
    }
    setInCart(true);
    try {
      await FirestoreService.addToShoppingCart(
        user.uid,
        p.id,
        p.name ?? 'Produkt',
        false,
        'comparison',
        { screenName: 'noname-detail' },
        { price: p.preis ?? 0, savings: 0 },
      );
      showCartAddedToast(
        p.name ?? 'Produkt',
        () => router.push('/shopping-list' as any),
      );
    } catch {
      setInCart(false);
      showInfoToast('Fehler — bitte erneut versuchen');
    }
  };
  const onRatingsPress = async () => {
    setRatingsOpen(true);
    setRatingsLoading(true);
    setRatings([]);
    try {
      const data = await FirestoreService.getProductRatingsWithUserInfo(p.id, true);
      setRatings(data as any);
    } catch (e) {
      console.warn('NoNameDetail: ratings load failed', e);
    } finally {
      setRatingsLoading(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      {/* Sticky header — back + title. Default Stack header is hidden
          statically in app/_layout.tsx. */}
      <View style={{ paddingTop: insets.top, backgroundColor: theme.bg, zIndex: 5 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingTop: 10,
            paddingBottom: 8,
            gap: 8,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
            hitSlop={6}
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={theme.text} />
          </Pressable>
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 20,
              color: theme.text,
              letterSpacing: -0.2,
            }}
          >
            Produktdetails
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Eyebrow + Title ───────────────────────────────────── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.semibold,
              fontSize: 11,
              color: theme.textMuted,
              letterSpacing: 1.2,
              textTransform: 'uppercase',
            }}
          >
            Eigenmarke{disc?.name ? ` · ${disc.name}` : ''}
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 26,
              lineHeight: 30,
              color: theme.text,
              letterSpacing: -0.3,
              marginTop: 2,
            }}
          >
            {handelsmarkeName ? `${handelsmarkeName} ` : ''}
            {p.name}
          </Text>
        </View>

        {/* ─── Hero image with overlays ──────────────────────────── */}
        <View style={{ paddingHorizontal: 20 }}>
          <View
            style={{
              position: 'relative',
              borderRadius: 20,
              overflow: 'hidden',
              backgroundColor: theme.surfaceAlt,
              height: 240,
            }}
          >
            {p.bild ? (
              <Image source={{ uri: p.bild }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="package-variant" size={64} color={theme.textMuted} />
              </View>
            )}

            {/* Market chip top-left */}
            {disc?.name ? (
              <View
                style={{
                  position: 'absolute',
                  left: 12,
                  top: 12,
                  backgroundColor: disc.color ?? brand.primary,
                  paddingVertical: 8,
                  paddingHorizontal: 14,
                  borderRadius: 22,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  shadowColor: '#000',
                  shadowOpacity: 0.18,
                  shadowOffset: { width: 0, height: 4 },
                  shadowRadius: 10,
                  elevation: 3,
                }}
              >
                {disc.bild ? (
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 5,
                      backgroundColor: '#fff',
                      overflow: 'hidden',
                    }}
                  >
                    <Image
                      source={{ uri: disc.bild }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="contain"
                    />
                  </View>
                ) : (
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 5,
                      backgroundColor: 'rgba(255,255,255,0.25)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.extraBold,
                        fontSize: 10,
                        color: '#fff',
                      }}
                    >
                      {disc.name[0]?.toUpperCase() ?? '?'}
                    </Text>
                  </View>
                )}
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.bold,
                    fontSize: 13,
                    color: '#fff',
                  }}
                >
                  Exklusiv bei {disc.name}
                </Text>
              </View>
            ) : null}

            {/* Price pill bottom-left */}
            <View
              style={{
                position: 'absolute',
                left: 12,
                bottom: 12,
                backgroundColor: 'rgba(255,255,255,0.95)',
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: 14,
                shadowColor: '#000',
                shadowOpacity: 0.12,
                shadowOffset: { width: 0, height: 2 },
                shadowRadius: 8,
                elevation: 3,
              }}
            >
              {packInfo ? (
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 11,
                    color: '#5c6769',
                  }}
                >
                  {packInfo}
                </Text>
              ) : null}
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 22,
                  color: '#191c1d',
                  letterSpacing: -0.4,
                  marginTop: packInfo ? 4 : 0,
                }}
              >
                {formatEur(p.preis)}
              </Text>
            </View>

            {/* Action cluster bottom-right */}
            <View style={{ position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', gap: 8 }}>
              <ActionButton
                icon={isFav ? 'heart' : 'heart-outline'}
                iconColor={isFav ? '#e53935' : theme.text}
                onPress={onFavPress}
              />
              <ActionButton
                icon={inCart ? 'cart-check' : 'cart-plus'}
                iconColor={inCart ? '#fff' : theme.text}
                bg={inCart ? brand.primary : undefined}
                onPress={onCartPress}
              />
              <ActionButton
                icon="star"
                iconColor="#f5b301"
                subLabel={rating}
                onPress={onRatingsPress}
              />
            </View>
          </View>
        </View>

        {/* ─── Info card: Hersteller + Kategorie ─────────────────── */}
        <View
          style={{
            marginHorizontal: 20,
            marginTop: 24,
            backgroundColor: theme.surface,
            borderRadius: 16,
            padding: 16,
            ...shadows.sm,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: theme.border,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 13,
                color: theme.textMuted,
              }}
            >
              Hersteller
            </Text>
            <Text
              numberOfLines={1}
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 13,
                color: theme.text,
                maxWidth: '60%',
              }}
            >
              {herstellerName ?? '—'}
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 12,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 13,
                color: theme.textMuted,
              }}
            >
              Kategorie
            </Text>
            <Text
              numberOfLines={1}
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 13,
                color: theme.text,
                maxWidth: '60%',
              }}
            >
              {categoryName ?? '—'}
            </Text>
          </View>
        </View>

        {/* ─── Tabs: Inhaltsstoffe / Nährwerte ───────────────────── */}
        <View
          style={{
            marginHorizontal: 20,
            marginTop: 20,
            padding: 4,
            borderRadius: 999,
            backgroundColor: theme.surfaceAlt,
            flexDirection: 'row',
            gap: 4,
          }}
        >
          {(
            [
              ['ingredients', 'Inhaltsstoffe'],
              ['nutrition', 'Nährwerte'],
            ] as const
          ).map(([k, label]) => {
            const on = tab === k;
            return (
              <Pressable
                key={k}
                onPress={() => setTab(k)}
                style={({ pressed }) => ({
                  flex: 1,
                  height: 40,
                  borderRadius: 999,
                  backgroundColor: on ? theme.surface : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.92 : 1,
                  ...(on ? shadows.sm : {}),
                })}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.bold,
                    fontSize: 13,
                    color: on ? theme.text : theme.textMuted,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* ─── Single-column content ─────────────────────────────── */}
        <SingleInfoCard
          tab={tab}
          product={p}
          theme={theme}
          shadows={shadows}
        />

        {/* ─── Detektiv-Einordnung row ───────────────────────────── */}
        <View
          style={{
            marginHorizontal: 20,
            marginTop: 20,
            padding: 14,
            paddingHorizontal: 16,
            borderRadius: 14,
            backgroundColor: theme.surfaceAlt,
            flexDirection: 'row',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <View style={{ alignItems: 'center', marginTop: 1 }}>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 18,
                color: stufeColor,
                lineHeight: 18,
              }}
            >
              S{stufe}
            </Text>
            <View style={{ flexDirection: 'row', gap: 2, marginTop: 4 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <View
                  key={n}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: n <= stufe ? stufeColor : theme.borderStrong,
                  }}
                />
              ))}
            </View>
          </View>
          <Text
            style={{
              flex: 1,
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 12,
              lineHeight: 18,
              color: theme.textSub,
            }}
          >
            <Text style={{ fontWeight: fontWeight.bold, color: theme.text }}>
              Stufe {stufe} — {stufeInfo.label}:
            </Text>{' '}
            {stufeInfo.line} Kein direktes Markenprodukt zum Vergleich
            hinterlegt.
          </Text>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>

      <RatingsSheet
        visible={ratingsOpen}
        onClose={() => setRatingsOpen(false)}
        productName={p.name ?? 'Produkt'}
        ratings={ratings}
        loading={ratingsLoading}
        showSimilarity={false}
        onSubmit={async (r: SubmittedRating) => {
          if (!user?.uid) {
            showInfoToast('Bitte anmelden');
            throw new Error('not-authenticated');
          }
          const now = new Date();
          await FirestoreService.addProductRating({
            userID: user.uid,
            productID: p.id,
            brandProductID: null,
            ratingOverall: r.ratingOverall,
            ratingPriceValue: r.ratingPriceValue ?? null,
            ratingTasteFunction: r.ratingTasteFunction ?? null,
            ratingContent: r.ratingContent ?? null,
            ratingSimilarity: r.ratingSimilarity ?? null,
            comment: r.comment ?? null,
            ratedate: now,
            updatedate: now,
          });
          try {
            const refreshed =
              await FirestoreService.getProductRatingsWithUserInfo(p.id, true);
            setRatings(refreshed as any);
          } catch {
            /* non-fatal */
          }
        }}
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────

type ActionButtonProps = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  iconColor: string;
  bg?: string;
  subLabel?: string;
  onPress?: () => void;
};

function ActionButton({ icon, iconColor, bg, subLabel, onPress }: ActionButtonProps) {
  const { theme } = useTokens();
  const filled = !!bg;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: 14,
        backgroundColor: bg ?? theme.surface,
        borderWidth: filled ? 0 : 1,
        borderColor: theme.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.88 : 1,
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 6,
        elevation: 2,
      })}
    >
      <MaterialCommunityIcons name={icon} size={subLabel ? 14 : 22} color={iconColor} />
      {subLabel ? (
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 12,
            lineHeight: 13,
            color: filled ? '#fff' : theme.text,
            marginTop: 2,
          }}
        >
          {subLabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

function SingleInfoCard({
  tab,
  product,
  theme,
  shadows,
}: {
  tab: Tab;
  product: any;
  theme: ReturnType<typeof useTokens>['theme'];
  shadows: ReturnType<typeof useTokens>['shadows'];
}) {
  if (tab === 'ingredients') {
    const zutaten = String(product.zutaten ?? product.moreInformation?.zutaten ?? '').trim();
    return (
      <View style={{ marginHorizontal: 20, marginTop: 18 }}>
        {zutaten ? (
          <View
            style={{
              backgroundColor: theme.surface,
              borderRadius: 14,
              padding: 16,
              ...shadows.sm,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.regular,
                fontSize: 13,
                lineHeight: 19,
                color: theme.text,
              }}
            >
              {zutaten}
            </Text>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: theme.surfaceAlt,
              borderRadius: 14,
              padding: 18,
              alignItems: 'center',
            }}
          >
            <MaterialCommunityIcons name="food-off-outline" size={28} color={theme.textMuted} />
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 13,
                color: theme.textMuted,
                marginTop: 8,
                textAlign: 'center',
              }}
            >
              Für dieses Produkt sind noch keine Zutaten hinterlegt.
            </Text>
          </View>
        )}
      </View>
    );
  }

  // Nutrition tab
  const n = product.naehrwerte ?? product.moreInformation ?? {};
  const rows: Array<[string, string]> = [];
  const pushRow = (label: string, value: any, suffix = '') => {
    if (value == null || value === '') return;
    rows.push([label, typeof value === 'number' ? `${value}${suffix}` : String(value)]);
  };
  pushRow('Energie', n.brennwertKcal ?? n.energie, ' kcal');
  pushRow('Fett', n.fett, ' g');
  pushRow('davon gesättigt', n.gesaettigteFettsaeuren ?? n.gesaettigt, ' g');
  pushRow('Kohlenhydrate', n.kohlenhydrate, ' g');
  pushRow('davon Zucker', n.zucker, ' g');
  pushRow('Eiweiß', n.eiweiss ?? n.eiweis, ' g');
  pushRow('Salz', n.salz, ' g');

  if (rows.length === 0) {
    return (
      <View style={{ marginHorizontal: 20, marginTop: 18 }}>
        <View
          style={{
            backgroundColor: theme.surfaceAlt,
            borderRadius: 14,
            padding: 18,
            alignItems: 'center',
          }}
        >
          <MaterialCommunityIcons name="nutrition" size={28} color={theme.textMuted} />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 13,
              color: theme.textMuted,
              marginTop: 8,
              textAlign: 'center',
            }}
          >
            Keine Nährwertangaben verfügbar.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={{
        marginHorizontal: 20,
        marginTop: 18,
        backgroundColor: theme.surface,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 4,
        ...shadows.sm,
      }}
    >
      {rows.map(([label, value], i) => (
        <View
          key={label}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingVertical: 10,
            borderBottomWidth: i < rows.length - 1 ? 1 : 0,
            borderBottomColor: theme.border,
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 13,
              color: theme.text,
            }}
          >
            {label}
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 13,
              color: theme.text,
            }}
          >
            {value}
          </Text>
        </View>
      ))}
      <View style={{ paddingVertical: 8 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            color: theme.textMuted,
          }}
        >
          Angaben pro 100 g
        </Text>
      </View>
    </View>
  );
}
