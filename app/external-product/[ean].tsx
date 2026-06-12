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
import { safePush } from '@/lib/utils/safeNav';
import { backOrHome } from '@/lib/utils/nav';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
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
import { ProductCard } from '@/components/design/ProductCard';
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
  const loadProduct = useCallback(
    async (force: boolean) => {
      const e = String(ean ?? '');
      if (!e) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = force
          ? await ExternalProductService.forceLookupByEAN(e)
          : await ExternalProductService.lookupByEAN(e);
        setProduct(result?.product ?? null);
      } catch (err) {
        console.warn('ExternalProductScreen load failed', err);
      } finally {
        setLoading(false);
      }
    },
    [ean],
  );

  useEffect(() => {
    void loadProduct(false);
  }, [loadProduct]);

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

  // Alternative-Eigenmarken via Algolia-Name-Search.
  //
  // Wichtiger Insight: Brand-Namen (Alpro, Kerrygold, Coca-Cola, …)
  // tauchen in Eigenmarken-NoName-Namen praktisch NIE auf. NoNames
  // beschreiben die Produktart (z.B. "Soja-Joghurt Natur") ohne
  // Brand-Referenz. Daher MUSS der Brand-Name aus der Suche raus,
  // sonst kommen wir nie an die echten Alternativen.
  //
  // Cascade:
  //   1. Vollständiger Name OHNE Brand
  //   2. Signifikante Produkt-Wörter einzeln (Joghurt, Soja, Cola, …)
  //   3. Kategorie (last segment)
  //   4. Voller Original-Name (Last-Resort)
  useEffect(() => {
    let alive = true;
    const name = product?.productName?.trim();
    if (!name) return;
    setAltLoading(true);

    const tryQuery = async (query: string): Promise<AlgoliaSearchResult[]> => {
      try {
        const result = await AlgoliaService.searchNoNameProducts(query, 0, 6);
        const hits = result?.hits ?? [];
        console.log(`[external-alt] query="${query}" → ${hits.length} hits`);
        return hits;
      } catch (e) {
        console.warn('[external-alt] query failed', query, e);
        return [];
      }
    };

    // Generische Stop-Words die in Produktnamen ohne Inhalts-Bedeutung
    // vorkommen. Beim Zerlegen rausfiltern damit "vegan", "natur" etc.
    // nicht als Such-Token landen (zu generisch, würden 1000+ Hits
    // bringen).
    const STOPWORDS = new Set([
      'mit', 'ohne', 'und', 'oder', 'aus', 'für', 'fur', 'im', 'in', 'der', 'die', 'das',
      'vegan', 'vegetarisch', 'natur', 'classic', 'original', 'light', 'mini',
      'plus', 'extra', 'pur', 'pure', 'fein', 'feine', 'frisch', 'echt',
      'g', 'kg', 'ml', 'l', 'cl', 'stk', 'stück', 'st',
      'bio', 'eco', 'premium', 'soft', 'hart', 'cremig',
    ]);

    // Brand-Wörter aus dem Namen entfernen damit wir auf die Produktart
    // zoomen. Bei "Alpro Joghurtalternative Soja Natur mit Kokosnuss
    // vegan 400g" → wir wollen "joghurtalternative soja kokosnuss".
    function stripBrandFromName(raw: string, brand?: string | null): string {
      let s = raw.toLowerCase();
      if (brand) {
        const brandWords = brand.toLowerCase().split(/[,\s]+/).filter((w) => w.length >= 3);
        for (const bw of brandWords) {
          s = s.replace(new RegExp(`\\b${escapeRegex(bw)}\\b`, 'gi'), ' ');
        }
      }
      // Pack-Size-Suffixe ("400g", "1l", "6×0,5l") wegnehmen
      s = s.replace(/\b\d+\s*[×x]?\s*\d*\s*(g|kg|ml|l|cl|stk|stück|st)\b/gi, ' ');
      return s.replace(/\s+/g, ' ').trim();
    }

    function escapeRegex(s: string): string {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function significantWords(s: string): string[] {
      return s
        .toLowerCase()
        .split(/[\s,;:\-_/()]+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d/.test(w));
    }

    (async () => {
      const brandStripped = stripBrandFromName(name, product?.brandName);

      // 1. Brand-stripped name als ganzer Query
      let hits: AlgoliaSearchResult[] = [];
      if (brandStripped && brandStripped !== name.toLowerCase()) {
        hits = await tryQuery(brandStripped);
        if (!alive) return;
      }

      // 2. Einzelne signifikante Produktwörter, in Reihenfolge ihrer
      //    Position im Namen (erstes signifikantes Wort = meist
      //    Produktart, z.B. "Joghurtalternative").
      if (hits.length === 0) {
        const words = significantWords(brandStripped || name);
        for (const w of words) {
          hits = await tryQuery(w);
          if (!alive) return;
          if (hits.length > 0) break;
        }
      }

      // 3. Kategorie aus Source (falls vorhanden)
      if (hits.length === 0 && product?.category) {
        const catParts = product.category.split(/[›>,]+/).map((s) => s.trim());
        const lastCat = catParts.filter(Boolean).pop();
        if (lastCat && lastCat.length >= 3) {
          hits = await tryQuery(lastCat);
          if (!alive) return;
        }
      }

      // 4. Last-Resort: voller Original-Name (auch wenn vorher gefailt,
      //    Algolia kann mit removeWordsIfNoResults manchmal doch was).
      if (hits.length === 0) {
        hits = await tryQuery(name);
        if (!alive) return;
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
      <DetailHeader
        title="Produkt"
        onBack={backOrHome}
        // T17.46: Dev-only Reload-Button im rechten Header-Slot. Löscht
        // den external_products-Cache-Eintrag für diese EAN und fährt
        // die Cascade von vorne. Damit kann man testen ob neue Sources
        // jetzt Daten haben statt am alten OpenFood-Cache zu hängen.
        right={
          __DEV__ ? (
            <Pressable
              onPress={() => loadProduct(true)}
              accessibilityRole="button"
              accessibilityLabel="Cache leeren & neu suchen"
              style={({ pressed }) => ({
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: pressed ? brand.primaryContainer : theme.surfaceAlt,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
              })}
            >
              <MaterialCommunityIcons name="refresh" size={14} color={brand.primary} />
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.bold as any,
                  fontSize: 11,
                  color: brand.primary,
                  letterSpacing: 0.2,
                }}
              >
                Cache leeren
              </Text>
            </Pressable>
          ) : null
        }
      />

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

        {/* Hersteller-Section — wird IMMER angezeigt wenn die Source
            einen Hersteller-Namen liefert. Drei Zustände:
              (a) Match in unserer hersteller_new-DB + Connected-Brands
                  → Hersteller-Logo + Name + Confidence-Pill + Brand-Chips
              (b) Match aber keine Connected-Brands → nur Hersteller-Card
              (c) Kein Match (externer Hersteller unbekannt) → nur Name
                  als Text, ohne Brand-Section. */}
        {product.manufacturerName ? (
          <Section title="Hersteller">
            {manufacturerMatch ? (
              // Match vorhanden — Logo (wenn da) + Name + Confidence
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: connectedBrands.length > 0 ? 14 : 0,
                }}
              >
                {manufacturerMatch.bild ? (
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: '#fff',
                      overflow: 'hidden',
                      borderWidth: 0.5,
                      borderColor: theme.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <RNImage
                      source={{ uri: manufacturerMatch.bild }}
                      style={{ width: '90%', height: '90%' }}
                      resizeMode="contain"
                    />
                  </View>
                ) : (
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: brand.primary + '22',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MaterialCommunityIcons
                      name="factory"
                      size={22}
                      color={brand.primary}
                    />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.extraBold,
                      fontSize: 15,
                      color: theme.text,
                      letterSpacing: -0.1,
                    }}
                  >
                    {manufacturerMatch.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.medium,
                      fontSize: 11,
                      color: theme.textMuted,
                      marginTop: 2,
                    }}
                  >
                    laut {sourceLabel ?? 'Quelle'}: {product.manufacturerName}
                  </Text>
                </View>
              </View>
            ) : (
              // Kein Match — nur den rohen Source-Namen zeigen
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: theme.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons
                    name="factory"
                    size={22}
                    color={theme.textMuted}
                  />
                </View>
                <Text
                  numberOfLines={2}
                  style={{
                    flex: 1,
                    fontFamily,
                    fontWeight: fontWeight.bold as any,
                    fontSize: 14,
                    color: theme.text,
                    lineHeight: 19,
                  }}
                >
                  {product.manufacturerName}
                </Text>
              </View>
            )}

            {/* Connected-Brands sub-section — nur wenn Match + Brands */}
            {manufacturerMatch && connectedBrands.length > 0 ? (
              <>
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
                  Produziert auch{' '}
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
              </>
            ) : null}
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
          // 2-column grid mit Standard-ProductCard (gleicher Look wie
          // Stöbern-Grid / Home-Top-Rated). Max 6 Items (Algolia-Limit).
          // Algolia liefert nur Basisfelder — packSize/unitPrice können
          // wir hier nicht zeigen weil das ein Firestore-Enrich
          // bräuchte; für Alternativen-Übersicht ist Stufe + Markt +
          // Preis aussagekräftig genug.
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              paddingHorizontal: 10,
            }}
          >
            {alternatives.slice(0, 6).map((alt, index) => {
              const stufeNum =
                typeof alt.stufe === 'string'
                  ? parseInt(alt.stufe, 10) || undefined
                  : (alt.stufe as any);
              const eyebrow =
                alt.handelsmarke?.bezeichnung ?? alt.discounter?.name ?? null;
              const eyebrowLogo =
                alt.discounter?.bild ?? alt.handelsmarke?.bild ?? null;
              return (
                <View
                  key={alt.objectID}
                  style={{
                    width: '50%',
                    paddingHorizontal: 6,
                    paddingBottom: 12,
                    height: 290,
                  }}
                >
                  <ProductCard
                    title={alt.name ?? ''}
                    brand={eyebrow}
                    eyebrowLogoUri={eyebrowLogo}
                    hersteller={alt.hersteller?.name ?? null}
                    imageUri={alt.bild ?? null}
                    price={typeof alt.preis === 'number' ? alt.preis : 0}
                    stufe={stufeNum ?? null}
                    variant="grid"
                    height={278}
                    onPress={() => {
                      // Prefetch + navigate — gleicher Pattern wie
                      // Stöbern/Favoriten für instant-Reveal des Details.
                      try {
                        FirestoreService.prefetchProductDetails(alt.objectID);
                      } catch {}
                      // Via Resolver → richtige Detail-Seite je Stufe (statt
                      // blind noname-detail, was bei Stufe 3-5 falsch wäre).
                      safePush(`/product/${alt.objectID}` as any);
                    }}
                  />
                </View>
              );
            })}
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
