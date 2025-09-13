import { IconSymbol } from '@/components/ui/IconSymbol';
import LeaderboardList from '@/components/ui/LeaderboardList';
import { Colors } from '@/constants/Colors';
import { getStackScreenHeaderOptions } from '@/constants/HeaderConfig';
import { useColorScheme } from '@/hooks/useColorScheme';
import { LeaderboardPeriod, LeaderboardType } from '@/lib/services/leaderboardService';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import PagerView from 'react-native-pager-view';

const { width } = Dimensions.get('window');

const Leaderboard: React.FC = () => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const [selectedType, setSelectedType] = useState<LeaderboardType>('points');
  const [selectedPeriod, setSelectedPeriod] = useState<LeaderboardPeriod>('total');
  
  // Animation states
  const tabIndicatorPosition = useRef(new Animated.Value(0)).current;
  const periodFadeAnim = useRef(new Animated.Value(1)).current;
  const pagerRef = useRef<PagerView>(null);

  const typeOptions: { key: LeaderboardType; label: string; icon: any; gradient: string[]; description: string }[] = [
    { 
      key: 'points', 
      label: 'Punkte', 
      icon: 'trophy.fill',
      gradient: ['#FFD700', '#FFA500'],
      description: 'Wer sammelt die meisten Punkte?'
    },
    { 
      key: 'savings', 
      label: 'Ersparnisse', 
      icon: 'eurosign.circle.fill',
      gradient: ['#4CAF50', '#2E7D32'],
      description: 'Wer spart am meisten Geld?'
    }
  ];

  const periodOptions: { key: LeaderboardPeriod; label: string; subtitle: string; icon: string; gradient: string[]; textColor: string }[] = [
    { 
      key: 'total', 
      label: 'Legendär', 
      subtitle: 'Aller Zeiten',
      icon: '👑', 
      gradient: ['#FFD700', '#FFA500'],
      textColor: '#333333' // Dunkle Schrift auf goldenem Hintergrund
    },
    { 
      key: 'yearly', 
      label: 'Champion', 
      subtitle: 'Dieses Jahr',
      icon: '🏆', 
      gradient: ['#FF6B6B', '#FF8787'],
      textColor: 'white'
    },
    { 
      key: 'monthly', 
      label: 'Rising Star', 
      subtitle: 'Dieser Monat',
      icon: '🌟', 
      gradient: ['#4ECDC4', '#44A08D'],
      textColor: 'white'
    },
    { 
      key: 'weekly', 
      label: 'On Fire', 
      subtitle: 'Diese Woche',
      icon: '🔥', 
      gradient: ['#667eea', '#764ba2'],
      textColor: 'white'
    }
  ];

  const handleTypeChange = (type: LeaderboardType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const index = typeOptions.findIndex(opt => opt.key === type);
    
    // Animate tab indicator
    Animated.timing(tabIndicatorPosition, {
      toValue: index * (width / 2),
      duration: 200,
      useNativeDriver: true
    }).start();
    
    // Fade out and in for smooth transition
    Animated.sequence([
      Animated.timing(periodFadeAnim, {
        toValue: 0,
        duration: 100,
        useNativeDriver: true
      }),
      Animated.timing(periodFadeAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true
      })
    ]).start();
    
    setSelectedType(type);
    pagerRef.current?.setPage(index);
  };

  const handlePageSelected = (e: any) => {
    const position = e.nativeEvent.position;
    const newType = typeOptions[position].key;
    
    if (newType !== selectedType) {
      handleTypeChange(newType);
    }
  };

  const currentTypeOption = typeOptions.find(opt => opt.key === selectedType)!;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          ...getStackScreenHeaderOptions(colorScheme, 'Bestenlisten'),
          headerBackTitle: 'Zurück'
        }}
      />
      
      {/* Compact Summary Bar like Shopping List */}
      <LinearGradient
        colors={currentTypeOption.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.summaryBar}
      >
        <View style={styles.summaryContent}>
          <View style={styles.summaryLeft}>
            <View style={styles.summaryTitleRow}>
              <IconSymbol 
                name={currentTypeOption.icon} 
                size={20} 
                color={selectedType === 'points' ? '#333333' : 'white'} 
                style={{ marginRight: 8 }}
              />
              <Text style={[
                styles.summaryTitle,
                { color: selectedType === 'points' ? '#333333' : 'white' }
              ]}>
                {currentTypeOption.label} Bestenliste
              </Text>
            </View>
            <Text style={[
              styles.summarySubtitle,
              { color: selectedType === 'points' ? 'rgba(51,51,51,0.8)' : 'rgba(255,255,255,0.8)' }
            ]}>
              {currentTypeOption.description}
            </Text>
          </View>
        </View>
      </LinearGradient>

      {/* Type Tabs (Punkte/Ersparnisse) */}
      <View style={[styles.tabContainer, { backgroundColor: colors.cardBackground }]}>
        <View style={styles.tabButtons}>
          {typeOptions.map((option, index) => (
            <TouchableOpacity 
              key={option.key}
              style={styles.tab} 
              onPress={() => handleTypeChange(option.key)}
              activeOpacity={0.7}
            >
              <View style={styles.tabContent}>
                <IconSymbol 
                  name={option.icon} 
                  size={20} 
                  color={selectedType === option.key ? colors.primary : colors.icon} 
                />
                <Text style={[
                  styles.tabText, 
                  { 
                    color: selectedType === option.key ? colors.primary : colors.icon,
                    fontFamily: selectedType === option.key ? 'Nunito_700Bold' : 'Nunito_600SemiBold'
                  }
                ]}>
                  {option.label}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
          
          <Animated.View
            style={[
              styles.tabIndicator, 
              {
                backgroundColor: colors.primary,
                transform: [{ translateX: tabIndicatorPosition }]
              }
            ]}
          />
        </View>
      </View>

      {/* Period Selection with cool chips */}
      <Animated.View style={[styles.periodContainer, { opacity: periodFadeAnim }]}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.periodScroll}
        >
          {periodOptions.map((option) => {
            const isSelected = selectedPeriod === option.key;
            return (
              <TouchableOpacity
                key={option.key}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelectedPeriod(option.key);
                }}
                activeOpacity={0.7}
              >
                {isSelected ? (
                  <LinearGradient
                    colors={option.gradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.periodChip}
                  >
                    <Text style={styles.periodEmoji}>{option.icon}</Text>
                    <View>
                      <Text style={[styles.periodLabel, { color: option.textColor }]}>
                        {option.label}
                      </Text>
                      <Text style={[styles.periodSubtitle, { 
                        color: option.textColor === '#333333' 
                          ? 'rgba(51,51,51,0.8)' 
                          : 'rgba(255,255,255,0.8)' 
                      }]}>
                        {option.subtitle}
                      </Text>
                    </View>
                  </LinearGradient>
                ) : (
                  <View style={[
                    styles.periodChip,
                    { 
                      backgroundColor: colors.cardBackground,
                      borderColor: colors.border
                    }
                  ]}>
                    <Text style={[styles.periodEmoji, { opacity: 0.6 }]}>{option.icon}</Text>
                    <View>
                      <Text style={[styles.periodLabel, { color: colors.text }]}>
                        {option.label}
                      </Text>
                      <Text style={[styles.periodSubtitle, { color: colors.text + '80' }]}>
                        {option.subtitle}
                      </Text>
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </Animated.View>

      {/* Leaderboard List with PagerView */}
      <PagerView 
        ref={pagerRef}
        style={styles.pagerView} 
        initialPage={0}
        onPageSelected={handlePageSelected}
      >
        {typeOptions.map((typeOption) => (
          <View key={typeOption.key} style={styles.pageContainer}>
            <LeaderboardList type={typeOption.key} period={selectedPeriod} />
          </View>
        ))}
      </PagerView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  
  // Summary Bar (like Shopping List)
  summaryBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  summaryContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLeft: {
    flex: 1,
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  summaryTitle: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
  },
  summarySubtitle: {
    fontSize: 13,
    fontFamily: 'Nunito_400Regular',
  },
  
  // Tab Container
  tabContainer: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 3,
  },
  tabButtons: {
    flexDirection: 'row',
    height: 56,
    position: 'relative',
  },
  tab: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tabText: {
    fontSize: 16,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: 0,
    height: 3,
    width: width / 2,
  },
  
  // Period Selection
  periodContainer: {
    paddingVertical: 16,
  },
  periodScroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  periodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    minWidth: 120,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  periodEmoji: {
    fontSize: 20,
  },
  periodLabel: {
    fontSize: 14,
    fontFamily: 'Nunito_700Bold',
  },
  periodSubtitle: {
    fontSize: 11,
    fontFamily: 'Nunito_400Regular',
    marginTop: -2,
  },
  
  // PagerView
  pagerView: {
    flex: 1,
  },
  pageContainer: {
    flex: 1,
  },
});

export default Leaderboard;