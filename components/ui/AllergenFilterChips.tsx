import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ALLERGEN_KEYS, ALLERGEN_LABELS, AllergenFilters } from '@/lib/types/filters';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface AllergenFilterChipsProps {
  selectedAllergens: Partial<AllergenFilters>;
  onToggleAllergen: (allergen: keyof AllergenFilters) => void;
}

export function AllergenFilterChips({ 
  selectedAllergens = {}, // Default to empty object 
  onToggleAllergen 
}: AllergenFilterChipsProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const getAllergenEmoji = (allergen: keyof AllergenFilters): string => {
    const emojiMap: Record<keyof AllergenFilters, string> = {
      allergens_egg: '🥚',
      allergens_fish: '🐟',
      allergens_gluten: '🌾',
      allergens_milk: '🥛',
      allergens_mustard: '🌭',
      allergens_nuts: '🌰',
      allergens_peanuts: '🥜',
      allergens_sesame: '🌰',
      allergens_sulfites: '🍇'
    };
    return emojiMap[allergen] || '⚠️';
  };

  return (
    <>
      <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>
        Allergene ausschließen
      </ThemedText>
      <View style={styles.chipsContainer}>
        {ALLERGEN_KEYS.map((allergen) => {
          const isSelected = selectedAllergens[allergen] === true;
          
          return (
            <TouchableOpacity
              key={allergen}
              style={[
                styles.filterChip,
                { 
                  backgroundColor: isSelected 
                    ? colors.error || '#FF3B30'
                    : colorScheme === 'dark' ? colors.cardBackground : '#FFFFFF',
                  borderColor: isSelected 
                    ? colors.error || '#FF3B30'
                    : colors.border
                }
              ]}
              onPress={() => onToggleAllergen(allergen)}
              activeOpacity={0.7}
            >
              <Text style={styles.chipEmoji}>
                {getAllergenEmoji(allergen)}
              </Text>
              <ThemedText 
                style={[
                  styles.chipText,
                  { 
                    color: isSelected ? 'white' : colors.text,
                    textDecorationLine: isSelected ? 'line-through' : 'none'
                  }
                ]}
              >
                {ALLERGEN_LABELS[allergen]}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Nunito_600SemiBold',
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    marginBottom: 8,
  },
  chipEmoji: {
    fontSize: 14,
  },
  chipText: {
    fontSize: 12,
    fontFamily: 'Nunito_500Medium',
  }
});