import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { NUTRITION_LABELS, NutritionFilters } from '@/lib/types/filters';
import React from 'react';
import { StyleSheet, Switch, TouchableOpacity, View } from 'react-native';

interface NutritionRangeFilterProps {
  nutritionFilters: NutritionFilters;
  onUpdateFilter: (filters: NutritionFilters) => void;
}

export function NutritionRangeFilter({ 
  nutritionFilters = {}, // Default to empty object
  onUpdateFilter 
}: NutritionRangeFilterProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const getNutritionEmoji = (key: string): string => {
    const emojiMap: Record<string, string> = {
      nutrition_caloriesKcal: '⚡',
      nutrition_saturatedFat: '🧈',
      nutrition_sugar: '🍯',
      nutrition_protein: '🥩',
      nutrition_totalCarbohydrates: '🌾',
      nutrition_totalFat: '🫒'
    };
    return emojiMap[key] || '📊';
  };

  const getNutritionConfig = (key: string): { isMax: boolean; description: string; defaultValue: number } => {
    const configMap: Record<string, { isMax: boolean; description: string; defaultValue: number }> = {
      nutrition_caloriesKcal: { isMax: true, description: 'Weniger Kalorien', defaultValue: 200 },
      nutrition_saturatedFat: { isMax: true, description: 'Weniger gesättigte Fette', defaultValue: 5 },
      nutrition_sugar: { isMax: true, description: 'Weniger Zucker', defaultValue: 10 },
      nutrition_protein: { isMax: false, description: 'Mehr Protein', defaultValue: 5 },
      nutrition_totalCarbohydrates: { isMax: true, description: 'Weniger Kohlenhydrate', defaultValue: 30 },
      nutrition_totalFat: { isMax: true, description: 'Weniger Fett', defaultValue: 10 }
    };
    return configMap[key] || { isMax: true, description: '', defaultValue: 10 };
  };

  const toggleNutritionFilter = (key: string) => {
    const config = getNutritionConfig(key);
    const currentFilter = nutritionFilters[key];
    
    let newFilter;
    if (currentFilter && (currentFilter.min !== undefined || currentFilter.max !== undefined)) {
      // Filter ist aktiv -> deaktivieren
      newFilter = { ...nutritionFilters };
      delete newFilter[key];
    } else {
      // Filter aktivieren mit sinnvollen Default-Werten
      newFilter = {
        ...nutritionFilters,
        [key]: config.isMax 
          ? { max: config.defaultValue } // Max-Wert setzen
          : { min: config.defaultValue }  // Min-Wert setzen
      };
    }
    
    onUpdateFilter(newFilter);
  };

  const isFilterActive = (key: string): boolean => {
    const filter = nutritionFilters[key];
    return filter !== undefined && (filter.min !== undefined || filter.max !== undefined);
  };

  const nutritionKeys = [
    'nutrition_caloriesKcal',
    'nutrition_saturatedFat', 
    'nutrition_sugar',
    'nutrition_protein',
    'nutrition_totalCarbohydrates',
    'nutrition_totalFat'
  ];

  return (
    <View style={styles.container}>
      <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>
        Nährwerte optimieren
      </ThemedText>
      
      {nutritionKeys.map((key) => {
        const isActive = isFilterActive(key);
        const config = getNutritionConfig(key);
        
        return (
          <TouchableOpacity
            key={key}
            style={styles.filterRow}
            onPress={() => toggleNutritionFilter(key)}
            activeOpacity={0.7}
          >
            <View style={styles.leftContent}>
              <ThemedText style={styles.emoji}>
                {getNutritionEmoji(key)}
              </ThemedText>
              <View style={styles.textContainer}>
                <ThemedText style={[styles.label, { color: colors.text }]}>
                  {NUTRITION_LABELS[key]}
                </ThemedText>
                <ThemedText style={[styles.description, { color: colors.textSecondary }]}>
                  {config.description}
                </ThemedText>
              </View>
            </View>
            
            <Switch
              value={isActive}
              onValueChange={() => toggleNutritionFilter(key)}
              trackColor={{ 
                false: colors.borderColor, 
                true: colors.tint + '80' 
              }}
              thumbColor={isActive ? colors.tint : '#f4f3f4'}
              ios_backgroundColor={colors.borderColor}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    paddingLeft: 4,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  leftContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  emoji: {
    fontSize: 24,
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
  },
  description: {
    fontSize: 13,
    marginTop: 2,
  },
});