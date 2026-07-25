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
import { Image as ExpoImage } from 'expo-image';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { safeReplace } from '@/lib/utils/safeNav';
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

import { doc, getDoc, onSnapshot } from '@react-native-firebase/firestore';

import { AiHealthScale } from '@/components/design/AiHealthScale';
import { AiManufacturerCard } from '@/components/design/AiManufacturerCard';
import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { ProductCard } from '@/components/design/ProductCard';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { db } from '@/lib/firebase';
import {
  formatNum,
  formatPack,
  formatPrice,
  normalizeGrade,
} from '@/lib/utils/externalProductFormat';
import journeyTrackingService from '@/lib/services/journeyTrackingService';
import {
  AlgoliaService,
  type AlgoliaSearchResult,
} from '@/lib/services/algolia';
import {
  buildAlternativeQueries,
  filterExternalAlternatives,
  filterExternalByDomainOnly,
  hasKnownDomain,
  preFilterByNameSignal,
} from '@/lib/utils/externalAlternativeQuery';
import ExternalProductService from '@/lib/services/externalProductService';
import { FirestoreService } from '@/lib/services/firestore';
import {
  matchManufacturer,
  type ManufacturerMatch,
} from '@/lib/services/manufacturerMatchService';
import type { ExternalProductDoc } from '@/lib/types/externalProduct';
import type { AiHersteller } from '@/lib/types/firestore';

const SOURCE_LABEL: Record<string, string> = {
  rewe: 'REWE',
  globus: 'Globus',
  metro: 'Metro',
  scraper: 'Online-Shop',
  openfood: 'OpenFoodFacts',
};

// formatPrice / formatNum / formatPack / normalizeGrade → ausgelagert nach
// lib/utils/externalProductFormat.ts (pure + unit-testbar).

export default function ExternalProductScreen() {
  const { ean } = useLocalSearchParams<{ ean: string; source?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme, brand, shadows } = useTokens();
  const { user } = useAuth();

  const [product, setProduct] = useState<ExternalProductDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [alternatives, setAlternatives] = useState<AlgoliaSearchResult[]>([]);
  const [altLoading, setAltLoading] = useState(false);
  const [manufacturerMatch, setManufacturerMatch] = useState<ManufacturerMatch | null>(null);
  const [connectedBrands, setConnectedBrands] = useState<
    Array<{ id: string; name: string; bild: string | null; source: string }>
  >([]);
  // Hero-Bild: wenn die (externe, oft OpenFood-)URL nicht lädt, zeigen
  // wir das Package-Icon statt einer grauen Box, die ewig hängt.
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  // KI-Hersteller-Einschätzung (aiHersteller vom gematchten
  // hersteller_new-Doc) → AiManufacturerCard, identisch zu noname-detail.
  const [manufacturerAi, setManufacturerAi] = useState<AiHersteller | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Bei Produktwechsel den Bild-Fehler-State zurücksetzen.
  useEffect(() => {
    setHeroImgFailed(false);
  }, [product?.imageUrl]);

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

  // Live-Subscription auf das external_products-Doc: die KI-Analyse
  // (aiAssessment) wird nach dem ersten Scan server-seitig berechnet
  // (cloud-functions/ai-product-comparison). Wir hören live mit, damit
  // die AiHealthScale erscheint sobald sie fertig ist — ohne Reload, ohne
  // erneutes Online-Nachladen. Überlagert NUR aiAssessment auf den
  // bestehenden Produkt-State (clobbert keine Cascade-Felder).
  useEffect(() => {
    const norm = String(ean ?? '').replace(/\D/g, '');
    if (!norm) return;
    const unsub = onSnapshot(
      doc(db, 'external_products', norm),
      (snap) => {
        if (!snap.exists()) return;
        const ai = (snap.data() as ExternalProductDoc | undefined)?.aiAssessment;
        if (!ai) return;
        setProduct((prev) => (prev ? { ...prev, aiAssessment: ai } : prev));
      },
      () => {
        /* offline / permission → ignorieren, Live-Update ist Best-Effort */
      },
    );
    return () => unsub();
  }, [ean]);

  // Journey-Tracking: den externen Produkt-View als viewedProducts-Eintrag
  // erfassen (productType 'external', productId = EAN) — analog zu
  // noname-detail. ensureProductTracked ist idempotent (no-op wenn das
  // Produkt schon in der Journey steht). Damit fehlt der externe View nicht
  // mehr in der Journey, und der Receipt-Matcher kann den Kauf später per
  // EAN schließen.
  useEffect(() => {
    const norm = String(ean ?? '').replace(/\D/g, '');
    if (!norm || !product?.productName) return;
    journeyTrackingService.ensureProductTracked(
      norm,
      'external',
      product.productName,
      user?.uid,
    );
  }, [ean, product?.productName, user?.uid]);

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
      setManufacturerAi(null);
      return;
    }
    (async () => {
      try {
        const match = await matchManufacturer(extName);
        if (!alive) return;
        setManufacturerMatch(match);
        if (match) {
          // Connected-Brands + die KI-Hersteller-Einschätzung (aiHersteller)
          // parallel laden. aiHersteller wird von ai-product-comparison pro
          // hersteller_new-Doc berechnet → identische Karte wie noname-detail.
          const [brands, herstellerSnap] = await Promise.all([
            FirestoreService.getConnectedBrandsForHersteller(match.id),
            getDoc(doc(db, 'hersteller_new', match.id)).catch(() => null),
          ]);
          if (!alive) return;
          setConnectedBrands(brands ?? []);
          const ai = (herstellerSnap?.data() as any)?.aiHersteller ?? null;
          setManufacturerAi(ai && typeof ai === 'object' ? (ai as AiHersteller) : null);
        } else {
          if (alive) {
            setConnectedBrands([]);
            setManufacturerAi(null);
          }
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
  // Kaskade + Guard leben in lib/utils/externalAlternativeQuery (dort
  // testbar). ENTSCHEIDENDE Aenderung 2026-07: ein Query "gewinnt"
  // nicht mehr, sobald er IRGENDWELCHE Treffer hat, sondern erst mit
  // PLAUSIBLEN. Vorher lieferte die Einzelwort-Stufe systematisch
  // Unsinn ("Garnier MINERAL Deo" -> 6x Mineralwasser), weil das erste
  // Wort mit Treffern gewann.
  useEffect(() => {
    let alive = true;
    const name = product?.productName?.trim();
    if (!name) return;
    setAltLoading(true);

    // Wenige, GUTE Alternativen statt einer langen Liste — und ein
    // hartes Read-Budget fuer die ganze Kaskade.
    //
    // Kosten-Einordnung: die Algolia-Trefferzahl ist gratis (Algolia
    // rechnet pro SUCHANFRAGE ab, nicht pro Treffer), teuer ist nur das
    // Anreichern — ein Firestore-Read pro Kandidat, gebraucht allein
    // fuer das catalogProfile des Domaenen-Checks. Deshalb: erst der
    // kostenlose Namens-Vorfilter, dann anreichern, und das Ganze
    // gedeckelt auf MAX_ENRICH_TOTAL Reads fuer ALLE Queries zusammen.
    const DISPLAY_LIMIT = 5;
    const HITS_PER_QUERY = 10;
    const MAX_ENRICH_TOTAL = 8;
    let enrichBudget = MAX_ENRICH_TOTAL;

    const source = {
      productName: name,
      brandName: product?.brandName ?? null,
      category: product?.category ?? null,
    };

    const tryQuery = async (query: string): Promise<AlgoliaSearchResult[]> => {
      try {
        // Etwas mehr anfordern als angezeigt wird — der Guard filtert
        // danach, es braucht also Reserve. Kostet bei Algolia nichts
        // extra (Abrechnung pro Anfrage, nicht pro Treffer).
        const result = await AlgoliaService.searchNoNameProducts(
          query,
          0,
          HITS_PER_QUERY,
        );
        const hits = result?.hits ?? [];
        console.log(`[external-alt] query="${query}" -> ${hits.length} hits`);
        return hits;
      } catch (e) {
        console.warn('[external-alt] query failed', query, e);
        return [];
      }
    };

    // Anreichern: Algolia liefert discounter/handelsmarke NUR als
    // Pfad-Strings ('discounter/abc'). getSearchCardData loest sie
    // (gecacht) zu echten Objekten auf + liefert bildClean + packSize +
    // packTypInfo — UND das catalogProfile, das der Guard braucht.
    const enrich = async (hits: AlgoliaSearchResult[]) =>
      Promise.all(
        hits.map(async (h) => {
          try {
            const fs: any = await FirestoreService.getSearchCardData(h.objectID, false);
            if (!fs) return h;
            return {
              ...h,
              // Guard-Basis — ohne das laeuft der Filter fail-open.
              ...(fs.catalogProfile ? { catalogProfile: fs.catalogProfile } : {}),
              ...(fs.bildClean ? { bildClean: fs.bildClean } : {}),
              ...(fs.bildThumb ? { bildThumb: fs.bildThumb } : {}),
              ...(fs.packSize != null ? { packSize: fs.packSize } : {}),
              ...(fs.packTypInfo && typeof fs.packTypInfo === 'object'
                ? { packTypInfo: fs.packTypInfo }
                : {}),
              ...(fs.discounter && typeof fs.discounter === 'object'
                ? { discounter: fs.discounter }
                : {}),
              ...(fs.handelsmarke && typeof fs.handelsmarke === 'object'
                ? { handelsmarke: fs.handelsmarke }
                : {}),
              ...(fs.hersteller && typeof fs.hersteller === 'object'
                ? { hersteller: fs.hersteller }
                : {}),
              ...(typeof fs.preis === 'number' ? { preis: fs.preis } : {}),
              ...(fs.stufe != null ? { stufe: fs.stufe } : {}),
            };
          } catch {
            return h;
          }
        }),
      );

    (async () => {
      const queries = buildAlternativeQueries(source);
      const seen = new Set<string>();
      let kept: AlgoliaSearchResult[] = [];

      const domainKnown = hasKnownDomain(source);

      for (const { q, kind } of queries) {
        // Die Kategorie-Stufe braucht eine bekannte Quell-Domaene —
        // sonst waere "nur Domaene pruefen" gleich "alles akzeptieren".
        if (kind === 'category' && !domainKnown) continue;

        const hits = (await tryQuery(q)).filter((h) => {
          if (!h?.objectID || seen.has(h.objectID)) return false;
          seen.add(h.objectID);
          return true;
        });
        if (!alive) return;
        if (hits.length === 0) continue;

        // NAME-Stufe: erst billig nach Namens-Signal vorfiltern (kein
        // Read), dann NUR die Ueberlebenden anreichern.
        // KATEGORIE-Stufe: der Query IST die Kategorie, ein
        // Namens-Signal waere hier die falsche Huerde (real gemessen:
        // "Zahnpasta" findet die Eigenmarken-"Zahncreme" sonst nie).
        const promising = (
          kind === 'name' ? preFilterByNameSignal(source, hits as any[]) : hits
        ).slice(0, enrichBudget);
        if (promising.length === 0) continue;
        enrichBudget -= promising.length;

        const enriched = await enrich(promising as AlgoliaSearchResult[]);
        if (!alive) return;

        const typed = enriched as unknown as (AlgoliaSearchResult & { name?: string })[];
        kept = (
          kind === 'name'
            ? filterExternalAlternatives(source, typed, DISPLAY_LIMIT)
            : filterExternalByDomainOnly(source, typed, DISPLAY_LIMIT)
        ) as AlgoliaSearchResult[];
        console.log(
          `[external-alt] query="${q}" (${kind}) -> ${hits.length} hits -> ${kept.length} plausibel`,
        );
        // Nur ein Query mit PLAUSIBLEN Treffern beendet die Kaskade.
        if (kept.length > 0) break;
        // Read-Budget aufgebraucht → aufhoeren, statt weiter zu suchen.
        if (enrichBudget <= 0) break;
      }

      if (!alive) return;
      setAlternatives(kept);
      setAltLoading(false);
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

  // Scores: nur echte Noten zeigen ('not-applicable'/'unknown' raus).
  const nutriGrade = normalizeGrade(product.scoreNutri, 'letter');
  const ecoGrade = normalizeGrade(product.scoreEco, 'letter');
  const novaGrade = normalizeGrade(product.scoreNova, 'nova');
  const hasAnyScore = !!(nutriGrade || ecoGrade || novaGrade);

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
              {product.imageUrl && !heroImgFailed ? (
                <ExpoImage
                  source={{ uri: product.imageUrl }}
                  style={{ width: 96, height: 96 }}
                  contentFit="contain"
                  transition={150}
                  cachePolicy="memory-disk"
                  onError={() => setHeroImgFailed(true)}
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

        {/* Scores (Nutri, Eco, NOVA) — in einer Section-Card wie alle
            anderen Datengruppen (vorher floateten die Badges nackt auf
            dem Hintergrund, als einziges Element ohne Surface). Es werden
            NUR valide Noten gerendert; 'not-applicable'/'unknown' fallen
            raus statt 'NOT-APPLICABLE' zu zeigen. */}
        {hasAnyScore ? (
          <Section title="Scores">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {nutriGrade ? (
                <ScoreBadge label="Nutri-Score" value={nutriGrade} />
              ) : null}
              {ecoGrade ? <ScoreBadge label="Eco-Score" value={ecoGrade} /> : null}
              {novaGrade ? <ScoreBadge label="NOVA" value={novaGrade} /> : null}
            </View>
          </Section>
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

        {/* KI-Inhaltsstoff-/Health-Analyse (Standalone, kategorie-relativ).
            Identisch zu noname-detail Stufe 1/2: dieselbe AiHealthScale-
            Komponente, gespeist aus product.aiAssessment (server-seitig von
            ai-product-comparison berechnet, live nachgeladen via onSnapshot).
            Rendert null solange keine Bewertung da ist → keine leere Karte. */}
        <AiHealthScale
          aiAssessment={product.aiAssessment ?? null}
          onExpand={() => {
            const norm = String(ean ?? '').replace(/\D/g, '');
            if (norm) {
              journeyTrackingService.trackQualityEngagement(
                norm,
                'ai_expanded',
                undefined,
                user?.uid,
              );
            }
          }}
        />

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

        {/* KI-Hersteller-Einschätzung (Info-Karte, kein Score) — identisch
            zu noname-detail. Quelle: aiHersteller vom gematchten
            hersteller_new-Doc. Rendert null wenn kein Match / keine Daten. */}
        <AiManufacturerCard
          aiHersteller={manufacturerAi}
          herstellerName={manufacturerMatch?.name ?? null}
          onExpand={() => {
            const norm = String(ean ?? '').replace(/\D/g, '');
            if (norm) {
              journeyTrackingService.trackQualityEngagement(
                norm,
                'manufacturer_origin',
                undefined,
                user?.uid,
              );
            }
          }}
        />

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
          // Stöbern-Grid / Home-Top-Rated). Max 6 Items. Die Hits sind
          // oben Firestore-enriched → Markt-Logo (discounter.bild) +
          // Eigenmarke (handelsmarke.bezeichnung) + Grundpreis sind da,
          // identisch zur Stöbern-Card.
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              paddingHorizontal: 10,
            }}
          >
            {alternatives.slice(0, 6).map((alt: any) => {
              const stufeNum =
                typeof alt.stufe === 'string'
                  ? parseInt(alt.stufe, 10) || undefined
                  : (alt.stufe as any);
              // Kanonisches NoName-Eyebrow (= Stöbern renderListCard):
              // Text = Eigenmarke (handelsmarke), Logo = Markt (discounter).
              const disc = alt.discounter as { name?: string; bild?: string } | undefined;
              const hm = alt.handelsmarke as
                | { bezeichnung?: string; name?: string; bild?: string }
                | undefined;
              const brandName = hm?.bezeichnung ?? hm?.name ?? disc?.name ?? null;
              const eyebrowLogo = disc?.bild ?? hm?.bild ?? null;
              const herstellerName =
                alt.hersteller?.herstellername ?? alt.hersteller?.name ?? null;
              const unit = alt.packTypInfo?.typKurz ?? alt.packTypInfo?.typ;
              const { sizeLabel, unitPriceLabel } = formatPack(
                alt.packSize,
                unit,
                typeof alt.preis === 'number' ? alt.preis : undefined,
              );
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
                    brand={brandName}
                    eyebrowLogoUri={eyebrowLogo}
                    hersteller={herstellerName}
                    product={alt}
                    price={typeof alt.preis === 'number' ? alt.preis : 0}
                    stufe={stufeNum ?? null}
                    sizeLabel={sizeLabel}
                    unitPriceLabel={unitPriceLabel}
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
                      // safeReplace (nicht push): die external-product-Seite
                      // wird durch die Alternative ERSETZT, damit Back von der
                      // Alternative auf das führt, was unter dem externen
                      // Produkt liegt (= Home im Scan-Flow, der mit
                      // router.replace auf /external-product kommt) — statt
                      // zurück aufs externe Produkt (User-Vorgabe 2026-06-14).
                      safeReplace(`/product/${alt.objectID}` as any);
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
