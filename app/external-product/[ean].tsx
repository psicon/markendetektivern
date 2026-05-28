// External-Product-Detail — Produkte aus REWE/Globus/OpenFood die
// NICHT in unserer kuratierten DB sind.
//
// Aufruf: barcode-scanner → Cascade-Lookup über ExternalProductService
//         → wenn Hit, replace zu /external-product/[ean]?source=…
//
// Anzeige:
//   • Hero zeigt ALLES was die Source liefert: Bild, Name,
//     Hersteller, Preis, Packungsgröße, Nährwerte, Allergene,
//     Ingredients, Scores (Nutri/Eco/NOVA). Kein Stufen-Badge.
//   • Hinweis-Banner: "Externe Daten aus {source}"
//   • Section "Alternative Eigenmarkenprodukte" via Algolia-Suche
//     auf den Produktnamen. Hinweis: "kein direkter Match —
//     hier sind ähnliche Vorschläge".
//   • TODO: bei vorhandenem manufacturerRef direct-match auf NoNames
//     mit derselben Hersteller-Ref → dann KEIN Hinweis (echter Match).

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image as RNImage,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import {
  AlgoliaService,
  type AlgoliaSearchResult,
} from '@/lib/services/algolia';
import ExternalProductService from '@/lib/services/externalProductService';
import { FirestoreService } from '@/lib/services/firestore';
import {
  matchManufacturer,
  type ManufacturerMatch,
} from '@/lib/services/manufacturerMatchService';
import type { ExternalProductDoc } from '@/lib/types/externalProduct';

const SOURCE_LABEL: Record<string, string> = {
  rewe: 'REWE',
  globus: 'Globus',
  metro: 'Metro',
  scraper: 'Online-Shop',
  openfood: 'OpenFoodFacts',
};

function formatPrice(eur?: number): string | null {
  if (typeof eur !== 'number') return null;
  return `${eur.toFixed(2).replace('.', ',')} €`;
}

function formatNum(v?: number, unit?: string): string | null {
  if (typeof v !== 'number') return null;
  const fixed = v % 1 === 0 ? v.toString() : v.toFixed(1).replace('.', ',');
  return `${fixed}${unit ? ` ${unit}` : ''}`;
}

export default function ExternalProductScreen() {
  const { ean } = useLocalSearchParams<{ ean: string; source?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme, brand, shadows } = useTokens();

  const [product, setProduct] = useState<ExternalProductDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [alternatives, setAlternatives] = useState<AlgoliaSearchResult[]>([]);
  const [altLoading, setAltLoading] = useState(false);
  const [manufacturerMatch, setManufacturerMatch] = useState<ManufacturerMatch | null>(null);
  const [connectedBrands, setConnectedBrands] = useState<
    Array<{ id: string; name: string; bild: string | null; source: string }>
  >([]);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Daten laden — primär Cache, sonst Cascade.
  useEffect(() => {
    let alive = true;
    const e = String(ean ?? '');
    if (!e) {
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const result = await ExternalProductService.lookupByEAN(e);
        if (!alive) return;
        setProduct(result?.product ?? null);
      } catch (err) {
        console.warn('ExternalProductScreen load failed', err);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ean]);

  // T17.45: Hersteller-Match auf unsere hersteller_new-Collection.
  // External Source liefert manufacturerName als String → Levenshtein-
  // Match. Wenn confidence ≥ 0.75 → zeige Connected-Brands-Section
  // (gleiches Pattern wie Stufe 1/2 in noname-detail).
  useEffect(() => {
    let alive = true;
    const extName = product?.manufacturerName?.trim();
    if (!extName) {
      setManufacturerMatch(null);
      setConnectedBrands([]);
      return;
    }
    (async () => {
      try {
        const match = await matchManufacturer(extName);
        if (!alive) return;
        setManufacturerMatch(match);
        if (match) {
          const brands = await FirestoreService.getConnectedBrandsForHersteller(match.id);
          if (alive) setConnectedBrands(brands ?? []);
        } else {
          if (alive) setConnectedBrands([]);
        }
      } catch (e) {
        console.warn('manufacturer match flow failed', e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [product?.manufacturerName]);

  // Alternative-Eigenmarken via Algolia-Name-Search mit Fallback-
  // Kaskade: wenn primärer Search 0 Hits, versuche erstes Wort allein,
  // dann jede einzelne Brand-Komponente, dann Kategorie. So sehen
  // User IMMER irgendwelche Alternativen — "keine gefunden" ist
  // schlechtes UX-Verhalten.
  useEffect(() => {
    let alive = true;
    const name = product?.productName?.trim();
    if (!name) return;
    setAltLoading(true);

    const tryQuery = async (query: string): Promise<AlgoliaSearchResult[]> => {
      try {
        const result = await AlgoliaService.searchNoNameProducts(query, 0, 8);
        return result?.hits ?? [];
      } catch (e) {
        console.warn('algolia alt-query failed', query, e);
        return [];
      }
    };

    (async () => {
      // 1. Voller Produktname
      let hits = await tryQuery(name);
      if (!alive) return;

      // 2. Erstes Wort (oft die "Kategorie", z.B. "Cola Light")
      if (hits.length === 0) {
        const firstWord = name.split(/\s+/)[0];
        if (firstWord && firstWord.length >= 3 && firstWord.toLowerCase() !== name.toLowerCase()) {
          hits = await tryQuery(firstWord);
          if (!alive) return;
        }
      }

      // 3. Kategorie (wenn vorhanden)
      if (hits.length === 0 && product?.category) {
        // Kategorie kann lang sein ("Getränke > Erfrischungsgetränke …")
        // → letztes Segment nehmen, das ist meist das spezifischste
        const catParts = product.category.split(/[›>,]+/).map((s) => s.trim());
        const lastCat = catParts.filter(Boolean).pop();
        if (lastCat && lastCat.length >= 3) {
          hits = await tryQuery(lastCat);
          if (!alive) return;
        }
      }

      // 4. Brand-Name als letzte Hoffnung
      if (hits.length === 0 && product?.brandName) {
        const firstBrandWord = product.brandName.split(/[,\s]+/)[0];
        if (firstBrandWord && firstBrandWord.length >= 3) {
          hits = await tryQuery(firstBrandWord);
          if (!alive) return;
        }
      }

      if (alive) setAlternatives(hits);
      if (alive) setAltLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [product?.productName, product?.category, product?.brandName]);

  const sourceLabel = useMemo(() => {
    if (!product?.source) return null;
    return SOURCE_LABEL[product.source] ?? product.source;
  }, [product?.source]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <DetailHeader title="Produkt" onBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={brand.primary} />
        </View>
      </View>
    );
  }

  if (!product) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <DetailHeader title="Produkt" onBack={() => router.back()} />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
          }}
        >
          <MaterialCommunityIcons
            name="barcode-off"
            size={48}
            color={theme.textMuted}
          />
          <Text
            style={{
              marginTop: 12,
              fontFamily,
              fontWeight: fontWeight.bold as any,
              fontSize: 16,
              color: theme.text,
              textAlign: 'center',
            }}
          >
            Produkt nicht gefunden
          </Text>
          <Text
            style={{
              marginTop: 6,
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 13,
              color: theme.textSub,
              textAlign: 'center',
            }}
          >
            Wir konnten zu dem Barcode {String(ean)} keine Daten finden.
          </Text>
        </View>
      </View>
    );
  }

  // Helper für Nutrition-Row.
  const nutritionRows: { label: string; value: string | null }[] = [
    { label: 'Energie', value: formatNum(product.nutr_Energie_val, product.nutr_Energie_unit) },
    { label: 'Fett', value: formatNum(product.nutr_Fett_val, product.nutr_Fett_unit) },
    {
      label: 'davon gesättigt',
      value: formatNum(
        product.nutr_FettdavongesttigteFettsuren_val,
        product.nutr_FettdavongesttigteFettsuren_unit,
      ),
    },
    {
      label: 'Kohlenhydrate',
      value: formatNum(product.nutr_Kohlenhydrate_val, product.nutr_Kohlenhydrate_unit),
    },
    {
      label: 'davon Zucker',
      value: formatNum(
        product.nutr_KohlenhydratedavonZucker_val,
        product.nutr_KohlenhydratedavonZucker_unit,
      ),
    },
    {
      label: 'Ballaststoffe',
      value: formatNum(product.nutr_Ballaststoffe_val, product.nutr_Ballaststoffe_unit),
    },
    { label: 'Eiweiß', value: formatNum(product.nutr_Eiwei_val, product.nutr_Eiwei_unit) },
    { label: 'Salz', value: formatNum(product.nutr_Salz_val, product.nutr_Salz_unit) },
  ].filter((r) => r.value);

  const allergenList = [
    { key: 'gluten', label: 'Gluten', on: product.allergen_gluten },
    { key: 'milk', label: 'Milch', on: product.allergen_milk },
    { key: 'egg', label: 'Ei', on: product.allergen_egg },
    { key: 'nuts', label: 'Nüsse', on: product.allergen_nuts },
    { key: 'soy', label: 'Soja', on: product.allergen_soy },
  ].filter((a) => a.on === true);

  const lifestyleFlags = [
    { key: 'vegan', label: 'Vegan', on: product.isVegan },
    { key: 'vegetarian', label: 'Vegetarisch', on: product.isVegetarian },
    { key: 'glutenfree', label: 'Glutenfrei', on: product.isGlutenFree },
    { key: 'lactosefree', label: 'Laktosefrei', on: product.isLactoseFree },
  ].filter((f) => f.on === true);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Produkt" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{
          // T17.44: Header verdeckt Top — paddingTop muss die volle
          // Header-Höhe + Safe-Area mit einrechnen.
          paddingTop: insets.top + DETAIL_HEADER_ROW_HEIGHT + 12,
          paddingBottom: insets.bottom + 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* T17.44: Vorheriger Hinweis-Banner ("nicht in unserer
            Datenbank") raus — sorgte für Frustration beim User.
            Stattdessen wird die Quelle ganz unten kompakt erwähnt. */}

        {/* Hero-Card */}
        <View
          style={{
            marginHorizontal: 16,
            backgroundColor: theme.surface,
            borderRadius: radii.lg,
            padding: 14,
            ...shadows.sm,
          }}
        >
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
            {/* Bild */}
            <View
              style={{
                width: 96,
                height: 96,
                borderRadius: 12,
                backgroundColor: theme.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {product.imageUrl ? (
                <RNImage
                  source={{ uri: product.imageUrl }}
                  style={{ width: 96, height: 96 }}
                  resizeMode="contain"
                />
              ) : (
                <MaterialCommunityIcons
                  name="package-variant-closed"
                  size={32}
                  color={theme.textMuted}
                />
              )}
            </View>
            {/* Text-Block */}
            <View style={{ flex: 1, minWidth: 0 }}>
              {product.brandName ? (
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.bold as any,
                    fontSize: 11,
                    color: brand.primary,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                  }}
                >
                  {product.brandName}
                </Text>
              ) : null}
              <Text
                numberOfLines={3}
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 16,
                  color: theme.text,
                  lineHeight: 21,
                  letterSpacing: -0.2,
                  marginTop: 2,
                }}
              >
                {product.productName}
              </Text>
              {product.packSize ? (
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 12,
                    color: theme.textSub,
                    marginTop: 3,
                  }}
                >
                  {product.packSize}
                </Text>
              ) : null}
              {/* T17.45: Preis-Anzeige immer sichtbar — bei
                  vorhandenem Preis prominent (großer Bold-Text), sonst
                  schwacher "Preis nicht verfügbar"-Hinweis. So weiß
                  der User immer woran er ist. */}
              {formatPrice(product.price) ? (
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 18,
                    color: theme.text,
                    marginTop: 8,
                    letterSpacing: -0.3,
                  }}
                >
                  {formatPrice(product.price)}
                </Text>
              ) : (
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 12,
                    color: theme.textMuted,
                    marginTop: 8,
                    fontStyle: 'italic',
                  }}
                >
                  Preis nicht verfügbar
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* Lifestyle-Flags */}
        {lifestyleFlags.length > 0 ? (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 6,
              marginHorizontal: 16,
              marginTop: 10,
            }}
          >
            {lifestyleFlags.map((f) => (
              <View
                key={f.key}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: radii.full,
                  backgroundColor: brand.primaryContainer ?? theme.surfaceAlt,
                  borderWidth: 1,
                  borderColor: brand.primary + '40',
                }}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.bold as any,
                    fontSize: 11,
                    color: brand.primary,
                    letterSpacing: 0.2,
                  }}
                >
                  {f.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Scores (Nutri, Eco, NOVA) */}
        {(product.scoreNutri || product.scoreEco || product.scoreNova) ? (
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              marginHorizontal: 16,
              marginTop: 14,
            }}
          >
            {product.scoreNutri ? (
              <ScoreBadge label="Nutri-Score" value={product.scoreNutri.toUpperCase()} />
            ) : null}
            {product.scoreEco ? (
              <ScoreBadge label="Eco-Score" value={product.scoreEco.toUpperCase()} />
            ) : null}
            {product.scoreNova ? (
              <ScoreBadge label="NOVA" value={product.scoreNova} />
            ) : null}
          </View>
        ) : null}

        {/* Nutrition */}
        {nutritionRows.length > 0 ? (
          <Section title="Nährwerte (pro 100 g)">
            {nutritionRows.map((row, i) => (
              <View
                key={row.label}
                style={{
                  flexDirection: 'row',
                  paddingVertical: 8,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: theme.border,
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    fontFamily,
                    fontWeight: fontWeight.medium,
                    fontSize: 13,
                    color: theme.textSub,
                  }}
                >
                  {row.label}
                </Text>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.bold as any,
                    fontSize: 13,
                    color: theme.text,
                  }}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </Section>
        ) : null}

        {/* Allergene */}
        {allergenList.length > 0 ? (
          <Section title="Allergene">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {allergenList.map((a) => (
                <View
                  key={a.key}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: radii.full,
                    backgroundColor: '#fbe9e7',
                  }}
                >
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.bold as any,
                      fontSize: 11,
                      color: '#c0392b',
                    }}
                  >
                    {a.label}
                  </Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        {/* Zutaten */}
        {product.attr_ingredientStatement ? (
          <Section title="Zutaten">
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 13,
                color: theme.textSub,
                lineHeight: 19,
              }}
            >
              {product.attr_ingredientStatement}
            </Text>
          </Section>
        ) : null}

        {/* Beschreibung */}
        {product.productDescription ? (
          <Section title="Beschreibung">
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 13,
                color: theme.textSub,
                lineHeight: 19,
              }}
            >
              {product.productDescription}
            </Text>
          </Section>
        ) : null}

        {/* T17.45: Hersteller-Match-Section — wenn der externe
            manufacturer-Name konfident matched mit einem hersteller_new-
            Eintrag, zeige die mit ihm verbundenen Marken (gleiches
            Pattern wie noname-detail Stufe 2). User erkennt:
            "ah, das ist ja der gleiche Hersteller wie diese Marken
            hier — vielleicht ist eine Alternative dabei". */}
        {manufacturerMatch && connectedBrands.length > 0 ? (
          <Section title="Vom selben Hersteller">
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 12,
                color: theme.textMuted,
                marginBottom: 10,
                lineHeight: 16,
              }}
            >
              {manufacturerMatch.name} produziert auch{' '}
              {connectedBrands.length === 1 ? 'diese Marke' : 'diese Marken'}:
            </Text>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              {connectedBrands.map((b) => {
                const initial = (b.name || '?').trim().charAt(0).toUpperCase();
                return (
                  <View
                    key={b.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      paddingLeft: 4,
                      paddingRight: 12,
                      paddingVertical: 4,
                      borderRadius: radii.full,
                      backgroundColor: theme.surfaceAlt,
                      borderWidth: 1,
                      borderColor: theme.border,
                    }}
                  >
                    {b.bild ? (
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor: '#fff',
                          overflow: 'hidden',
                          borderWidth: 0.5,
                          borderColor: theme.border,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <RNImage
                          source={{ uri: b.bild }}
                          style={{ width: '90%', height: '90%' }}
                          resizeMode="contain"
                        />
                      </View>
                    ) : (
                      <View
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          backgroundColor: brand.primary + '22',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text
                          style={{
                            fontFamily,
                            fontWeight: fontWeight.extraBold,
                            fontSize: 11,
                            color: brand.primary,
                          }}
                        >
                          {initial}
                        </Text>
                      </View>
                    )}
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.bold as any,
                        fontSize: 13,
                        color: theme.text,
                      }}
                    >
                      {b.name}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Section>
        ) : null}

        {/* Alternative Eigenmarkenprodukte */}
        <View
          style={{
            marginHorizontal: 16,
            marginTop: 18,
            paddingHorizontal: 4,
            marginBottom: 10,
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 20,
              letterSpacing: -0.2,
              color: theme.text,
            }}
          >
            Alternative Eigenmarkenprodukte
          </Text>
        </View>

        {altLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 24 }}>
            <ActivityIndicator size="small" color={theme.textMuted} />
          </View>
        ) : alternatives.length === 0 ? (
          // Mit dem Fallback-Suchkaskaden-System fast nie der Fall.
          // Wenn doch: höflicher Hinweis ohne Frustration.
          <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 13,
                color: theme.textMuted,
                textAlign: 'center',
                paddingVertical: 16,
              }}
            >
              Stöbere in unserem Sortiment nach Alternativen.
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            {alternatives.map((alt) => (
              <Pressable
                key={alt.objectID}
                onPress={() => router.push(`/noname-detail/${alt.objectID}` as any)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  backgroundColor: theme.surface,
                  borderRadius: 12,
                  padding: 10,
                  borderWidth: 1,
                  borderColor: theme.border,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 10,
                    backgroundColor: theme.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {alt.bild ? (
                    <RNImage
                      source={{ uri: alt.bild }}
                      style={{ width: 56, height: 56 }}
                      resizeMode="contain"
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name="package-variant-closed"
                      size={22}
                      color={theme.textMuted}
                    />
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {alt.discounter?.name ? (
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.bold as any,
                        fontSize: 10,
                        color: brand.primary,
                        letterSpacing: 0.4,
                        textTransform: 'uppercase',
                      }}
                    >
                      {alt.discounter.name}
                    </Text>
                  ) : null}
                  <Text
                    numberOfLines={2}
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.bold as any,
                      fontSize: 14,
                      color: theme.text,
                      lineHeight: 18,
                    }}
                  >
                    {alt.name}
                  </Text>
                  {typeof alt.preis === 'number' ? (
                    <Text
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.extraBold,
                        fontSize: 13,
                        color: theme.text,
                        marginTop: 2,
                      }}
                    >
                      {formatPrice(alt.preis)}
                    </Text>
                  ) : null}
                </View>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={20}
                  color={theme.textMuted}
                />
              </Pressable>
            ))}
          </View>
        )}

        {/* T17.44: Quelle ganz unten als unaufdringlicher Footer.
            Ersetzt den frustrierenden Banner oben ("nicht in unserer
            Datenbank"). User erfährt die Source erst nach dem Lesen
            der Daten — neutraler Ton. */}
        {sourceLabel ? (
          <Text
            style={{
              marginTop: 20,
              marginHorizontal: 16,
              textAlign: 'center',
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 11,
              color: theme.textMuted,
              letterSpacing: 0.1,
            }}
          >
            Daten via {sourceLabel}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─── Reusable Sections ────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme, shadows } = useTokens();
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 14,
        backgroundColor: theme.surface,
        borderRadius: radii.lg,
        padding: 14,
        ...shadows.sm,
      }}
    >
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 14,
          color: theme.text,
          letterSpacing: -0.1,
          marginBottom: 10,
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function ScoreBadge({ label, value }: { label: string; value: string }) {
  const { theme } = useTokens();
  // Color-Map: a=grün, b=hellgrün, c=gelb, d=orange, e=rot.
  const colorMap: Record<string, string> = {
    A: '#00aa55',
    B: '#85bb2f',
    C: '#f1c40f',
    D: '#e67e22',
    E: '#e74c3c',
    '1': '#00aa55',
    '2': '#85bb2f',
    '3': '#e67e22',
    '4': '#e74c3c',
  };
  const color = colorMap[value] ?? theme.textMuted;
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: color + '18',
        borderWidth: 1,
        borderColor: color + '40',
      }}
    >
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.bold as any,
          fontSize: 10,
          color: theme.textMuted,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          marginBottom: 2,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 18,
          color,
        }}
      >
        {value}
      </Text>
    </View>
  );
}
