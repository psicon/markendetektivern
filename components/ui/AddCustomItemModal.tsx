// AddCustomItemModal — Freitext-Produkt zum Einkaufszettel hinzufügen.
//
// Im neuen Design-System (FilterSheet als Wrapper, Theme-Tokens via
// useTokens, SegmentedTabs für den Produkttyp). Erweitert um eine
// Icon-Auswahl (MaterialCommunityIcons), damit jedes Custom-Item
// auch mit einem visuellen Anker im Einkaufszettel landet — dann
// erkennt man Brot, Milch, Putzmittel etc. auf einen Blick statt
// nur einen generischen Star/Storefront-Platzhalter.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { FilterSheet } from '@/components/design/FilterSheet';
import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { FirestoreService } from '@/lib/services/firestore';

import { MarketSelector } from './MarketSelector';

// ─── Icon catalogue ────────────────────────────────────────────────
//
// Curated MaterialCommunityIcons that cover the typical
// supermarket/drugstore shelf taxonomy. The first entry is the
// fallback (used when the user doesn't pick one explicitly).

type IconChoice = { key: string; label: string };

const PRODUCT_ICONS: readonly IconChoice[] = [
  { key: 'cart-outline', label: 'Sonstiges' },
  { key: 'food-apple-outline', label: 'Obst' },
  { key: 'carrot', label: 'Gemüse' },
  { key: 'bread-slice-outline', label: 'Brot' },
  { key: 'baguette', label: 'Bäckerei' },
  { key: 'bottle-soda-outline', label: 'Getränke' },
  { key: 'bottle-wine-outline', label: 'Wein' },
  { key: 'beer-outline', label: 'Bier' },
  { key: 'coffee-outline', label: 'Kaffee' },
  { key: 'tea', label: 'Tee' },
  { key: 'glass-mug-variant', label: 'Saft' },
  { key: 'cup-water', label: 'Wasser' },
  { key: 'cheese', label: 'Käse' },
  { key: 'egg-outline', label: 'Eier' },
  { key: 'food-steak', label: 'Fleisch' },
  { key: 'fish', label: 'Fisch' },
  { key: 'pasta', label: 'Pasta' },
  { key: 'rice', label: 'Reis' },
  { key: 'food-croissant', label: 'Snacks' },
  { key: 'cupcake', label: 'Backware' },
  { key: 'ice-cream', label: 'Eis' },
  { key: 'cookie-outline', label: 'Kekse' },
  { key: 'candy-outline', label: 'Süßes' },
  { key: 'spray-bottle', label: 'Reiniger' },
  { key: 'lotion-outline', label: 'Pflege' },
  { key: 'toothbrush', label: 'Hygiene' },
  { key: 'paper-roll-outline', label: 'Papier' },
  { key: 'baby-bottle-outline', label: 'Baby' },
  { key: 'dog-side', label: 'Tier' },
  { key: 'flower-outline', label: 'Pflanze' },
  { key: 'pill', label: 'Medizin' },
  { key: 'bandage', label: 'Pflaster' },
] as const;

// ─── Props ──────────────────────────────────────────────────────────

interface AddCustomItemModalProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

// ─── Component ──────────────────────────────────────────────────────

export const AddCustomItemModal: React.FC<AddCustomItemModalProps> = ({
  visible,
  onClose,
  userId,
  onSuccess,
  onError,
}) => {
  const { theme, brand } = useTokens();

  const [itemName, setItemName] = useState('');
  const [itemType, setItemType] = useState<'brand' | 'noname'>('brand');
  const [iconKey, setIconKey] = useState<string>(PRODUCT_ICONS[0].key);
  const [selectedMarket, setSelectedMarket] = useState<any>(null);
  const [showMarketSelector, setShowMarketSelector] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // T17.38: Menge — wie viele soll ich kaufen? Default 1.
  const [quantity, setQuantity] = useState<number>(1);

  // Reset form on every (re-)open
  useEffect(() => {
    if (visible) {
      setItemName('');
      setItemType('brand');
      setIconKey(PRODUCT_ICONS[0].key);
      setSelectedMarket(null);
      setQuantity(1);
    }
  }, [visible]);

  const flagFor = (land?: string) => {
    if (!land) return '';
    const l = land.toLowerCase();
    if (l.startsWith('deutschland') || l === 'de') return '🇩🇪';
    if (l.startsWith('schweiz') || l === 'ch') return '🇨🇭';
    if (l.startsWith('österreich') || l === 'at') return '🇦🇹';
    return '';
  };

  const canSubmit =
    !!itemName.trim() &&
    !isSubmitting &&
    (itemType === 'brand' || !!selectedMarket);

  const handleSubmit = async () => {
    if (!itemName.trim()) {
      Alert.alert('Fehler', 'Bitte gib einen Produktnamen ein.');
      return;
    }
    if (itemType === 'noname' && !selectedMarket) {
      Alert.alert('Fehler', 'Bitte wähle einen Markt für NoName-Produkte aus.');
      return;
    }

    setIsSubmitting(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

      const customItem = {
        name: itemName.trim(),
        type: itemType,
        icon: iconKey,
        quantity: Math.max(1, Math.min(99, quantity)),
        ...(itemType === 'noname' && selectedMarket
          ? {
              marketId: selectedMarket.id,
              marketName: selectedMarket.name,
              marketLand: selectedMarket.land,
              marketBild: selectedMarket.bild,
            }
          : {}),
      };

      await FirestoreService.addCustomItemToShoppingCart(userId, customItem);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
      onSuccess(`📝 "${itemName.trim()}" wurde hinzugefügt!`);
      onClose();
    } catch (error) {
      console.error('Error adding custom item:', error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => {},
      );
      onError('Fehler beim Hinzufügen des Produkts');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FilterSheet visible={visible} title="Produkt hinzufügen (Freitext)" onClose={onClose}>
      <View style={{ paddingTop: 4, paddingBottom: 4 }}>
        {/* Produktname */}
        <Text style={[labelStyle(theme)]}>Produktname</Text>
        <View
          style={{
            backgroundColor: theme.surfaceAlt,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 4,
            marginBottom: 18,
          }}
        >
          <TextInput
            value={itemName}
            onChangeText={setItemName}
            placeholder="z.B. Butter, Brot, Milch …"
            placeholderTextColor={theme.textMuted}
            autoCapitalize="words"
            autoComplete="off"
            maxLength={50}
            returnKeyType="done"
            style={{
              fontFamily,
              fontWeight: fontWeight.semibold,
              fontSize: 16,
              color: theme.text,
              paddingVertical: 12,
            }}
          />
        </View>

        {/* Produkttyp */}
        <Text style={[labelStyle(theme)]}>Produkttyp</Text>
        <View style={{ marginBottom: 18 }}>
          <SegmentedTabs
            tabs={[
              { key: 'brand', label: 'Markenprodukt' },
              { key: 'noname', label: 'NoName-Produkt' },
            ] as const}
            value={itemType}
            onChange={(v) => setItemType(v)}
          />
        </View>

        {/* Markt — nur bei NoName */}
        {itemType === 'noname' ? (
          <>
            <Text style={[labelStyle(theme)]}>Markt</Text>
            <Pressable
              onPress={() => setShowMarketSelector(true)}
              style={({ pressed }) => ({
                backgroundColor: theme.surfaceAlt,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 14,
                marginBottom: 18,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <MaterialCommunityIcons
                name="storefront-outline"
                size={20}
                color={selectedMarket ? brand.primary : theme.textMuted}
              />
              <Text
                style={{
                  flex: 1,
                  fontFamily,
                  fontWeight: fontWeight.semibold,
                  fontSize: 15,
                  color: selectedMarket ? theme.text : theme.textMuted,
                }}
                numberOfLines={1}
              >
                {selectedMarket
                  ? `${flagFor(selectedMarket.land)} ${selectedMarket.name}`.trim()
                  : 'Markt auswählen …'}
              </Text>
              <MaterialCommunityIcons
                name="chevron-right"
                size={20}
                color={theme.textMuted}
              />
            </Pressable>
          </>
        ) : null}

        {/* Icon — T17.37: 5-Spalten-Grid. Fade-Overlay komplett raus
            (User-Feedback: sah aus wie Schatten). Last-Row-Alignment
            via unsichtbare Filler-Views damit space-between in der
            letzten Reihe nicht 2 Icons auseinander schießt. */}
        <Text style={[labelStyle(theme)]}>Icon</Text>
        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ maxHeight: 180, marginBottom: 18 }}
          contentContainerStyle={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            rowGap: 12,
            paddingVertical: 4,
            paddingBottom: 4,
          }}
        >
          {PRODUCT_ICONS.map((ic) => {
            const on = ic.key === iconKey;
            return (
              <Pressable
                key={ic.key}
                accessibilityLabel={ic.label}
                onPress={() => {
                  setIconKey(ic.key);
                  Haptics.selectionAsync().catch(() => {});
                }}
                style={({ pressed }) => ({
                  width: '18%',
                  alignItems: 'center',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: on ? brand.primary : theme.surfaceAlt,
                    borderWidth: on ? 0 : 1,
                    borderColor: theme.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons
                    name={ic.key as any}
                    size={26}
                    color={on ? '#fff' : theme.text}
                  />
                </View>
              </Pressable>
            );
          })}
          {/* Filler-Views füllen die letzte Reihe so dass die echten
              Icons links bleiben statt von justifyContent:space-between
              auseinandergezogen zu werden. */}
          {Array.from({
            length: (5 - (PRODUCT_ICONS.length % 5)) % 5,
          }).map((_, i) => (
            <View key={`filler-${i}`} style={{ width: '18%', height: 0 }} />
          ))}
        </ScrollView>

        {/* T17.39: Menge — gleicher Capsule-Look wie CompactQuantityPill
            auf DB-Produkt-Cards. Pill 46 hoch, runde Buttons, +-Button
            mit brand-primary Akzent. */}
        <Text style={[labelStyle(theme)]}>Menge</Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 18,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 23,
              paddingHorizontal: 3,
              height: 46,
            }}
          >
            <Pressable
              onPress={() => {
                setQuantity((q) => Math.max(1, q - 1));
                Haptics.selectionAsync().catch(() => {});
              }}
              disabled={quantity <= 1}
              accessibilityRole="button"
              accessibilityLabel="Menge verringern"
              hitSlop={8}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? theme.surfaceAlt : 'transparent',
                opacity: quantity <= 1 ? 0.4 : 1,
              })}
            >
              <MaterialCommunityIcons name="minus" size={18} color={theme.text} />
            </Pressable>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 16,
                color: theme.text,
                minWidth: 32,
                textAlign: 'center',
                letterSpacing: -0.2,
              }}
              accessibilityLabel={`Aktuelle Menge: ${quantity}`}
            >
              {quantity}
            </Text>
            <Pressable
              onPress={() => {
                setQuantity((q) => Math.min(99, q + 1));
                Haptics.selectionAsync().catch(() => {});
              }}
              disabled={quantity >= 99}
              accessibilityRole="button"
              accessibilityLabel="Menge erhöhen"
              hitSlop={8}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed
                  ? brand.primaryContainer ?? theme.surfaceAlt
                  : brand.primary,
                opacity: quantity >= 99 ? 0.4 : 1,
              })}
            >
              <MaterialCommunityIcons name="plus" size={18} color="#fff" />
            </Pressable>
          </View>
        </View>

        {/* Submit */}
        <Pressable
          onPress={handleSubmit}
          disabled={!canSubmit}
          style={({ pressed }) => ({
            marginTop: 6,
            backgroundColor: canSubmit ? brand.primary : theme.surfaceAlt,
            borderRadius: 14,
            height: 50,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: pressed && canSubmit ? 0.85 : 1,
          })}
        >
          {isSubmitting ? (
            <ActivityIndicator color={canSubmit ? '#fff' : theme.textMuted} />
          ) : (
            <>
              <MaterialCommunityIcons
                name="plus"
                size={20}
                color={canSubmit ? '#fff' : theme.textMuted}
              />
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 15,
                  color: canSubmit ? '#fff' : theme.textMuted,
                }}
              >
                Hinzufügen
              </Text>
            </>
          )}
        </Pressable>
      </View>

      {/* Market picker stays a separate modal — fires on top of the
          FilterSheet so the user can select without losing form
          state. The modal keeps its own backdrop. */}
      <MarketSelector
        visible={showMarketSelector}
        onClose={() => setShowMarketSelector(false)}
        onSelect={(market) => {
          setSelectedMarket(market);
          Haptics.selectionAsync().catch(() => {});
        }}
        selectedMarketId={selectedMarket?.id}
        title="Markt für dieses Produkt wählen"
      />
    </FilterSheet>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────

function labelStyle(theme: { text: string }) {
  return {
    fontFamily,
    fontWeight: fontWeight.extraBold as any,
    fontSize: 13,
    color: theme.text,
    letterSpacing: -0.1,
    marginBottom: 8,
  } as const;
}
