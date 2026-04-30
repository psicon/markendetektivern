// components/design/EnttarnteAlternativesList.tsx
//
// "Weitere enttarnte Produkte" — vertikale Liste aus NoName-Produkten
// (Stufe 3/4/5) aus derselben Kategorie. Wird unten auf den
// Produkt-Detail-Seiten verwendet:
//   • app/noname-detail/[id].tsx       (Stufe 1 & 2 NoNames)
//   • app/product-comparison/[id].tsx  (Stufe 3+ Vergleichs-Page)
//
// Layout pro Eintrag — entspricht dem alten Pattern aus dem
// Pre-Redesign:
//
//   ┌──────────────────────────────────────────────┐
//   │ ┌─────┐  HANDELSMARKE                        │
//   │ │     │  Produkt-Name (1 Zeile)              │
//   │ │ img │  ▢ MARKT (LAND)                      │
//   │ │ 60  │                          [S4]   ›    │
//   │ │     │                          0,79 €      │
//   │ └─────┘                                       │
//   └──────────────────────────────────────────────┘
//
// Design-System-Tokens überall, gleicher Card-Stil wie Favoriten /
// Kaufhistorie, damit das Listen-Pattern app-weit konsistent bleibt.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { StufenChips } from '@/components/design/StufenChips';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { getProductImage } from '@/lib/utils/productImage';

export type EnttarnteAlternative = {
  id: string;
  name: string;
  bild: string | null;
  preis: number | null;
  stufe: number;
  handelsmarkeName: string | null;
  handelsmarkeLogo: string | null;
  discounterName: string | null;
  discounterLogo: string | null;
  discounterLand: string | null;
};

function formatPrice(value: number | null): string {
  if (value == null || !isFinite(value)) return '—';
  return `${value.toFixed(2).replace('.', ',')} €`;
}

type RowProps = {
  item: EnttarnteAlternative;
  onPress: () => void;
};

function AlternativeRow({ item, onPress }: RowProps) {
  const { theme, brand, shadows } = useTokens();
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };
  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: 14,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.border,
        opacity: pressed ? 0.96 : 1,
        ...shadows.sm,
      })}
    >
      {/* Bild */}
      <View
        style={{
          width: 60,
          height: 60,
          borderRadius: 12,
          backgroundColor: '#ffffff',
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {getProductImage(item) ? (
          <Image
            source={{ uri: getProductImage(item) ?? undefined }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
          />
        ) : (
          <MaterialCommunityIcons
            name="package-variant-closed"
            size={26}
            color={theme.textMuted}
          />
        )}
      </View>

      {/* Text-Säule */}
      <View style={{ flex: 1, minWidth: 0 }}>
        {item.handelsmarkeName ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              marginBottom: 3,
            }}
          >
            {item.handelsmarkeLogo ? (
              <View
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  backgroundColor: '#fff',
                  overflow: 'hidden',
                  borderWidth: 0.5,
                  borderColor: theme.border,
                }}
              >
                <Image
                  source={{ uri: item.handelsmarkeLogo }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              </View>
            ) : null}
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 10,
                color: brand.primary,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
              }}
            >
              {item.handelsmarkeName}
            </Text>
          </View>
        ) : null}

        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.semibold,
            fontSize: 14,
            color: theme.text,
            lineHeight: 17,
            marginBottom: 4,
          }}
        >
          {item.name}
        </Text>

        {/* Markt-Zeile mit Logo + Name + (Land) */}
        {item.discounterName ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
            }}
          >
            {item.discounterLogo ? (
              <View
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  backgroundColor: '#fff',
                  overflow: 'hidden',
                  borderWidth: 0.5,
                  borderColor: theme.border,
                }}
              >
                <Image
                  source={{ uri: item.discounterLogo }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              </View>
            ) : null}
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 11,
                color: theme.textMuted,
              }}
            >
              {item.discounterName}
              {item.discounterLand ? ` (${item.discounterLand})` : ''}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Rechte Seite: Stufe-Chips + Preis + Chevron */}
      <View
        style={{
          alignItems: 'flex-end',
          flexShrink: 0,
          gap: 6,
        }}
      >
        <StufenChips stufe={item.stufe as any} size="sm" />
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 14,
            color: theme.text,
          }}
        >
          {formatPrice(item.preis)}
        </Text>
      </View>
      <MaterialCommunityIcons
        name="chevron-right"
        size={20}
        color={theme.textMuted}
        style={{ marginLeft: -4 }}
      />
    </Pressable>
  );
}

type ListProps = {
  items: EnttarnteAlternative[];
  /** Tap-Handler — bekommt die ID des angeklickten Produkts. */
  onItemPress: (id: string) => void;
  /** Optionale Title-Override. Default: "Weitere enttarnte Produkte". */
  title?: string;
  /** Optionale Sub-Copy. Default: "Entdecke andere Produkte mit Stufe 3, 4 oder 5". */
  subtitle?: string;
};

export function EnttarnteAlternativesList({
  items,
  onItemPress,
  title = 'Weitere enttarnte Produkte',
  subtitle = 'Entdecke andere Produkte mit Stufe 3, 4 oder 5',
}: ListProps) {
  const { theme } = useTokens();
  if (!items || items.length === 0) return null;
  return (
    <View style={{ marginTop: 28 }}>
      <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 20,
            color: theme.text,
            letterSpacing: -0.2,
            marginBottom: 4,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 13,
            color: theme.textMuted,
            lineHeight: 18,
          }}
        >
          {subtitle}
        </Text>
      </View>

      <View
        style={{
          paddingHorizontal: 20,
          gap: 10,
        }}
      >
        {items.map((item) => (
          <AlternativeRow
            key={item.id}
            item={item}
            onPress={() => onItemPress(item.id)}
          />
        ))}
      </View>
    </View>
  );
}
