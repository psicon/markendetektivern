import { Shimmer } from '@/components/design/Skeletons';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAuth } from '@/lib/contexts/AuthContext';
import leaderboardService, { LeaderboardEntry, LeaderboardPeriod, LeaderboardType } from '@/lib/services/leaderboardService';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Image,
    RefreshControl,
    StyleSheet,
    Text,
    View
} from 'react-native';

interface LeaderboardListProps {
  type: LeaderboardType;
  period: LeaderboardPeriod;
}

const LeaderboardList: React.FC<LeaderboardListProps> = ({ type, period }) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useAuth();
  
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [userPosition, setUserPosition] = useState<{ rank: number; percentile: number; entry: LeaderboardEntry } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadLeaderboard = useCallback(async (refresh = false) => {
    try {
      if (refresh) {
        await leaderboardService.invalidateCache();
      }

      const [leaderboardData, userPos] = await Promise.all([
        leaderboardService.getLeaderboard(type, period, 50),
        user?.uid ? leaderboardService.getUserPosition(user.uid, type, period) : null
      ]);

      setEntries(leaderboardData);
      setUserPosition(userPos);
    } catch (error) {
      console.error('❌ Error loading leaderboard:', error);
      Alert.alert('Fehler', 'Bestenliste konnte nicht geladen werden');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [type, period, user?.uid]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadLeaderboard(true);
  }, [loadLeaderboard]);

  const loadMore = useCallback(async () => {
    if (loadingMore || entries.length < 50) return;
    
    setLoadingMore(true);
    try {
      const moreEntries = await leaderboardService.getLeaderboard(type, period, 100);
      setEntries(moreEntries);
    } catch (error) {
      console.error('❌ Error loading more entries:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [type, period, entries.length, loadingMore]);

  const formatValue = (entry: LeaderboardEntry): string => {
    const value = entry.stats[type][period];
    if (type === 'points') {
      return `${value.toLocaleString()} Pkt`;
    } else {
      return `€${value.toFixed(2)}`;
    }
  };

  const getRankEmoji = (rank: number): string => {
    switch (rank) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return '';
    }
  };

  const getRankColor = (rank: number): string => {
    switch (rank) {
      case 1: return '#FFD700'; // Gold
      case 2: return '#C0C0C0'; // Silver
      case 3: return '#CD7F32'; // Bronze
      default: return colors.text;
    }
  };

  const renderLeaderboardItem = ({ item, index }: { item: LeaderboardEntry; index: number }) => {
    const isCurrentUser = item.userId === user?.uid;
    const rank = item.rank || index + 1;
    
    return (
      <View style={[
        styles.listItem,
        { 
          backgroundColor: isCurrentUser ? colors.primary + '20' : colors.cardBackground,
          borderColor: isCurrentUser ? colors.primary : 'transparent'
        }
      ]}>
        <View style={styles.rankContainer}>
          {rank <= 3 ? (
            <Text style={styles.rankEmoji}>
              {getRankEmoji(rank)}
            </Text>
          ) : (
            <View style={[styles.rankNumberBadge, { backgroundColor: colors.primary + '20' }]}>
              <Text style={[styles.rankNumber, { color: colors.primary }]}>
                {rank}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.userInfo}>
          {item.photoUrl ? (
            <Image source={{ uri: item.photoUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: colors.primary }]}>
              <Text style={styles.avatarText}>
                {item.displayName?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          
          <View style={styles.userDetails}>
            <Text style={[styles.displayName, { color: colors.text }]}>
              {item.displayName || 'Anonymer Nutzer'}
              {isCurrentUser && (
                <Text style={[styles.youLabel, { color: colors.primary }]}> (Du)</Text>
              )}
            </Text>
            <Text style={[styles.userStats, { color: colors.text + '80' }]}>
              Level {Math.floor((item.stats.points.total || 0) / 100) + 1} • 
              ⭐ €{(item.stats.savings.total || 0).toFixed(2)} gespart
            </Text>
          </View>
        </View>

        <View style={styles.valueContainer}>
          <Text style={[styles.value, { color: colors.primary }]}>
            {formatValue(item)}
          </Text>
        </View>
      </View>
    );
  };

  const renderUserPosition = () => {
    if (!userPosition || !user) return null;

    return (
      <View style={[styles.userPositionCard, { backgroundColor: colors.primary, borderColor: colors.border }]}>
        <View style={styles.userPositionHeader}>
          <Text style={styles.userPositionTitle}>Deine Position</Text>
          <Text style={styles.userPositionRank}>
            Platz {userPosition.rank}
          </Text>
        </View>
        <Text style={styles.percentileMessage}>
          {leaderboardService.getPercentileMessage(userPosition.percentile, userPosition.rank)}
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (!loadingMore) return null;
    
    return (
      <View style={styles.loadingMore}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.text }]}>
          Lade weitere Einträge...
        </Text>
      </View>
    );
  };

  if (loading) {
    // Skeleton rows mirror the leaderboard list item layout
    // (rank badge + avatar + name + points). Replaces the
    // centered spinner so the eventual data swap doesn't shift
    // the layout.
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.listContent}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 16,
                paddingHorizontal: 16,
                marginBottom: 8,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border ?? 'rgba(0,0,0,0.06)',
                backgroundColor: colors.cardBackground,
              }}
            >
              <View style={{ width: 50, alignItems: 'center' }}>
                <Shimmer width={36} height={36} radius={18} />
              </View>
              <View style={{ marginLeft: 12, flex: 1, gap: 6 }}>
                <Shimmer width="55%" height={14} radius={4} />
                <Shimmer width="35%" height={11} radius={3} />
              </View>
              <Shimmer width={48} height={14} radius={4} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.userId}
        renderItem={renderLeaderboardItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={renderFooter}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
      />
      
      {renderUserPosition()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
    loadingText: {
      fontSize: 16,
      fontFamily: 'Nunito_500Medium',
    },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 100, // Space for user position card
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  rankContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 50,
  },
  rankEmoji: {
    fontSize: 28,
  },
  rankNumberBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rankNumber: {
    fontSize: 16,
    fontFamily: 'Nunito_700Bold',
  },
  userInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
    avatarText: {
      color: 'white',
      fontSize: 16,
      fontFamily: 'Nunito_700Bold',
    },
  userDetails: {
    flex: 1,
    marginLeft: 12,
  },
    displayName: {
      fontSize: 16,
      fontFamily: 'Nunito_600SemiBold',
      marginBottom: 4,
    },
    youLabel: {
      fontFamily: 'Nunito_700Bold',
    },
    userStats: {
      fontSize: 12,
      fontFamily: 'Nunito_400Regular',
      opacity: 0.7,
    },
  valueContainer: {
    alignItems: 'flex-end',
  },
    value: {
      fontSize: 16,
      fontFamily: 'Nunito_700Bold',
    },
  userPositionCard: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  userPositionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
    userPositionTitle: {
      color: 'white',
      fontSize: 16,
      fontFamily: 'Nunito_700Bold',
    },
    userPositionRank: {
      color: 'white',
      fontSize: 18,
      fontFamily: 'Nunito_700Bold',
    },
    percentileMessage: {
      color: 'white',
      fontSize: 14,
      fontFamily: 'Nunito_500Medium',
      opacity: 0.9,
    },
  loadingMore: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
});

export default LeaderboardList;
