import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { NutritionFilters } from '@/lib/types/filters';
import Slider from '@react-native-community/slider';
import React from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

interface NutritionSliderFilterProps {
  nutritionFilters: NutritionFilters;
  onUpdateFilter: (filters: NutritionFilters) => void;
  onFilterChanged?: (filterType: string, filterValue: string, action: 'added' | 'removed') => void;
}

interface NutritionConfig {
  emoji: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultMin?: number;
  defaultMax?: number;
  type: 'min' | 'max' | 'range'; // min = "mindestens", max = "höchstens", range = "zwischen"
}

const NUTRITION_CONFIG: Record<string, NutritionConfig> = {
  nutrition_caloriesKcal: {
    emoji: '⚡',
    label: 'Kalorien',
    unit: 'kcal',
    min: 0,
    max: 500,
    step: 10,
    defaultMax: 200,
    type: 'max'
  },
  nutrition_saturatedFat: {
    emoji: '🧈',
    label: 'Gesättigte Fette',
    unit: 'g',
    min: 0,
    max: 20,
    step: 0.5,
    defaultMax: 5,
    type: 'max'
  },
  nutrition_sugar: {
    emoji: '🍯',
    label: 'Zucker',
    unit: 'g',
    min: 0,
    max: 50,
    step: 1,
    defaultMax: 10,
    type: 'max'
  },
  nutrition_protein: {
    emoji: '🥩',
    label: 'Protein',
    unit: 'g',
    min: 0,
    max: 30,
    step: 1,
    defaultMin: 5,
    type: 'min'
  },
  nutrition_totalCarbohydrates: {
    emoji: '🌾',
    label: 'Kohlenhydrate',
    unit: 'g',
    min: 0,
    max: 100,
    step: 2,
    defaultMax: 30,
    type: 'max'
  },
  nutrition_totalFat: {
    emoji: '🫒',
    label: 'Fett',
    unit: 'g',
    min: 0,
    max: 30,
    step: 1,
    defaultMax: 10,
    type: 'max'
  }
};

export function NutritionSliderFilter({ 
  nutritionFilters = {},
  onUpdateFilter,
  onFilterChanged
}: NutritionSliderFilterProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const renderNutritionSlider = (key: string) => {
    const config = NUTRITION_CONFIG[key];
    if (!config) return null;

    const currentFilter = nutritionFilters[key];
    const isActive = currentFilter && (currentFilter.min !== undefined || currentFilter.max !== undefined);
    
    // Aktuelle Werte oder Defaults
    const currentValue = config.type === 'min' 
      ? (currentFilter?.min ?? config.defaultMin ?? config.min)
      : (currentFilter?.max ?? config.defaultMax ?? config.max);

    const toggleFilter = () => {
      const newFilters = { ...nutritionFilters };
      
      if (isActive) {
        // Filter deaktivieren
        delete newFilters[key];
        onFilterChanged?.(key, `${config.label}`, 'removed');
      } else {
        // Filter aktivieren mit Default-Wert
        if (config.type === 'min') {
          newFilters[key] = { min: config.defaultMin ?? config.min };
        } else {
          newFilters[key] = { max: config.defaultMax ?? config.max };
        }
        onFilterChanged?.(key, `${config.label}: ${currentValue}${config.unit}`, 'added');
      }
      
      onUpdateFilter(newFilters);
    };

    const updateValue = (value: number) => {
      const newFilters = { ...nutritionFilters };
      
      if (config.type === 'min') {
        newFilters[key] = { min: value };
      } else {
        newFilters[key] = { max: value };
      }
      
      onUpdateFilter(newFilters);
      
      // ERWEITERTE Tracking-Daten mit Min/Max und Wert
      onFilterChanged?.(
        key, 
        `${config.label}: ${config.type === 'min' ? '≥' : '≤'}${value}${config.unit}`, 
        'added'
      );
    };

    return (
      <View key={key} style={styles.nutritionItem}>
        {/* Header mit Toggle */}
        <TouchableOpacity 
          style={[
            styles.nutritionHeader,
            { backgroundColor: isActive ? colors.primary : colors.cardBackground }
          ]}
          onPress={toggleFilter}
        >
          <View style={styles.nutritionLabelRow}>
            <ThemedText style={styles.nutritionEmoji}>{config.emoji}</ThemedText>
            <ThemedText style={[
              styles.nutritionLabel,
              { color: isActive ? 'white' : colors.text }
            ]}>
              {config.label}
            </ThemedText>
          </View>
          <ThemedText style={[
            styles.nutritionValue,
            { color: isActive ? 'white' : colors.text }
          ]}>
            {isActive 
              ? `${config.type === 'min' ? '≥' : '≤'} ${currentValue}${config.unit}`
              : 'Aus'
            }
          </ThemedText>
        </TouchableOpacity>

        {/* Schieberegler (nur wenn aktiv) */}
        {isActive && (
          <View style={styles.sliderContainer}>
            <View style={styles.sliderRow}>
              <ThemedText style={[styles.sliderLabel, { color: colors.text }]}>
                {config.type === 'min' ? 'Mindestens:' : 'Höchstens:'}
              </ThemedText>
              <TextInput
                style={[
                  styles.valueInput,
                  { 
                    backgroundColor: colors.cardBackground,
                    color: colors.text,
                    borderColor: colors.border
                  }
                ]}
                value={currentValue.toString()}
                onChangeText={(text) => {
                  const value = parseFloat(text) || 0;
                  if (value >= config.min && value <= config.max) {
                    updateValue(value);
                  }
                }}
                keyboardType="numeric"
                placeholder={`${config.min}-${config.max}`}
              />
              <ThemedText style={[styles.unitLabel, { color: colors.text }]}>
                {config.unit}
              </ThemedText>
            </View>
            
            <Slider
              style={styles.slider}
              minimumValue={config.min}
              maximumValue={config.max}
              step={config.step}
              value={currentValue}
              onValueChange={updateValue}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.border}
              thumbStyle={{ backgroundColor: colors.primary }}
            />
            
            <View style={styles.sliderLabels}>
              <ThemedText style={[styles.sliderMin, { color: colors.text }]}>
                {config.min}{config.unit}
              </ThemedText>
              <ThemedText style={[styles.sliderMax, { color: colors.text }]}>
                {config.max}{config.unit}
              </ThemedText>
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ThemedText style={[styles.sectionTitle, { color: colors.text }]}>
        📊 Nährwerte optimieren
      </ThemedText>
      
      {Object.keys(NUTRITION_CONFIG).map(renderNutritionSlider)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  nutritionItem: {
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  nutritionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  nutritionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nutritionEmoji: {
    fontSize: 20,
    marginRight: 8,
  },
  nutritionLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  nutritionValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  sliderContainer: {
    backgroundColor: 'rgba(0,0,0,0.02)',
    padding: 12,
    borderRadius: 8,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sliderLabel: {
    fontSize: 14,
    flex: 1,
  },
  valueInput: {
    width: 60,
    height: 32,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    textAlign: 'center',
    fontSize: 14,
    marginRight: 4,
  },
  unitLabel: {
    fontSize: 14,
    minWidth: 30,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -8,
  },
  sliderMin: {
    fontSize: 12,
    opacity: 0.7,
  },
  sliderMax: {
    fontSize: 12,
    opacity: 0.7,
  },
});
