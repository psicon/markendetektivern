import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

const SWIPE_CLOSE_THRESHOLD = 110;
const SWIPE_CLOSE_VELOCITY = 500;
const AVATAR_COLORS = ['#0d8575', '#cc6610', '#7b53b8', '#1b6fc7', '#a83753'];

export type Rating = {
  id?: string;
  userID?: string;
  ratingOverall?: number;
  ratingPriceValue?: number;
  ratingTasteFunction?: number;
  ratingSimilarity?: number;
  ratingContent?: number;
  comment?: string;
  ratedate?: any;
  userInfo?: {
    displayName?: string;
    avatarUrl?: string;
    level?: number;
  };
};

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Product name shown in the sheet title. */
  productName: string;
  /** Loaded ratings array (already includes userInfo). */
  ratings: Rating[];
  /** Average across the overall rating — shown in the summary block. */
  averageOverall?: number | null;
  /** Total count of ratings. */
  totalCount?: number;
  /** Show the "Ähnlichkeit zur Marke" score row (NoName with brand link). */
  showSimilarity?: boolean;
  /** Tapped "Bewertung schreiben" — submit form not yet implemented. */
  onWriteRating?: () => void;
};

/**
 * Read-only ratings sheet. Pulls from Firestore productRatings with userInfo
 * populated. Summary block at top (avg stars + distribution bars), scrollable
 * list of review cards below, sticky "Bewertung schreiben" CTA at the bottom.
 */
export function RatingsSheet({
  visible,
  onClose,
  productName,
  ratings,
  averageOverall,
  totalCount,
  showSimilarity = false,
  onWriteRating,
}: Props) {
  const { theme, brand, shadows } = useTokens();
  const insets = useSafeAreaInsets();

  const translateY = useSharedValue(0);
  useEffect(() => {
    if (visible) translateY.value = 0;
  }, [visible, translateY]);

  const panGesture = Gesture.Pan()
    .activeOffsetY(10)
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      const close =
        translateY.value > SWIPE_CLOSE_THRESHOLD || e.velocityY > SWIPE_CLOSE_VELOCITY;
      if (close) {
        translateY.value = withTiming(800, { duration: 180 });
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  // Derive average + distribution
  const avg = useMemo(() => {
    if (typeof averageOverall === 'number') return averageOverall;
    if (!ratings.length) return null;
    const sum = ratings.reduce((s, r) => s + (r.ratingOverall ?? 0), 0);
    return sum / ratings.length;
  }, [averageOverall, ratings]);

  const total = totalCount ?? ratings.length;

  const distribution = useMemo(() => {
    const buckets: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    ratings.forEach((r) => {
      const n = Math.round(r.ratingOverall ?? 0);
      if (n >= 1 && n <= 5) buckets[n as 1 | 2 | 3 | 4 | 5]++;
    });
    return buckets;
  }, [ratings]);

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable
          onPress={onClose}
          style={{
            flex: 1,
            backgroundColor: theme.overlay,
            justifyContent: 'flex-end',
          }}
        >
          <GestureDetector gesture={panGesture}>
            <Animated.View
              onStartShouldSetResponder={() => true}
              style={[
                sheetStyle,
                {
                  backgroundColor: theme.surface,
                  borderTopLeftRadius: 22,
                  borderTopRightRadius: 22,
                  paddingTop: 10,
                  paddingBottom: Math.max(32, insets.bottom + 20),
                  maxHeight: '88%',
                },
              ]}
            >
              {/* Drag handle */}
              <View
                style={{
                  width: 44,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: theme.borderStrong,
                  alignSelf: 'center',
                  marginBottom: 12,
                }}
              />

              {/* Title row */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingHorizontal: 20,
                  marginBottom: 10,
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.semibold,
                      fontSize: 11,
                      color: theme.textMuted,
                      letterSpacing: 1.2,
                      textTransform: 'uppercase',
                    }}
                  >
                    Bewertungen
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.extraBold,
                      fontSize: 18,
                      color: theme.text,
                      marginTop: 2,
                    }}
                  >
                    {productName}
                  </Text>
                </View>
                <Pressable onPress={onClose} hitSlop={8} style={{ marginLeft: 12 }}>
                  <MaterialCommunityIcons name="close" size={22} color={theme.textMuted} />
                </Pressable>
              </View>

              <ScrollView
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
                showsVerticalScrollIndicator={false}
              >
                {/* Summary block */}
                {total > 0 ? (
                  <View
                    style={{
                      flexDirection: 'row',
                      gap: 20,
                      paddingTop: 6,
                      paddingBottom: 16,
                      borderBottomWidth: 1,
                      borderBottomColor: theme.border,
                      marginBottom: 14,
                    }}
                  >
                    <View style={{ alignItems: 'center', justifyContent: 'center', width: 96 }}>
                      <Text
                        style={{
                          fontFamily,
                          fontWeight: fontWeight.extraBold,
                          fontSize: 34,
                          lineHeight: 38,
                          color: theme.text,
                        }}
                      >
                        {(avg ?? 0).toFixed(1)}
                      </Text>
                      <StarRow value={avg ?? 0} size={14} />
                      <Text
                        style={{
                          fontFamily,
                          fontWeight: fontWeight.medium,
                          fontSize: 11,
                          color: theme.textMuted,
                          marginTop: 4,
                        }}
                      >
                        {total} {total === 1 ? 'Bewertung' : 'Bewertungen'}
                      </Text>
                    </View>
                    <View style={{ flex: 1, justifyContent: 'center' }}>
                      {([5, 4, 3, 2, 1] as const).map((n) => {
                        const count = distribution[n];
                        const pct = total > 0 ? count / total : 0;
                        return (
                          <View
                            key={n}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 8,
                              paddingVertical: 2,
                            }}
                          >
                            <Text
                              style={{
                                fontFamily,
                                fontWeight: fontWeight.semibold,
                                fontSize: 11,
                                color: theme.textMuted,
                                width: 10,
                              }}
                            >
                              {n}
                            </Text>
                            <View
                              style={{
                                flex: 1,
                                height: 6,
                                backgroundColor: theme.surfaceAlt,
                                borderRadius: 3,
                                overflow: 'hidden',
                              }}
                            >
                              <View
                                style={{
                                  width: `${pct * 100}%`,
                                  height: '100%',
                                  backgroundColor: brand.primary,
                                }}
                              />
                            </View>
                            <Text
                              style={{
                                fontFamily,
                                fontWeight: fontWeight.medium,
                                fontSize: 11,
                                color: theme.textMuted,
                                minWidth: 20,
                                textAlign: 'right',
                              }}
                            >
                              {count}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {/* Review list */}
                {ratings.length === 0 ? (
                  <View
                    style={{
                      alignItems: 'center',
                      paddingVertical: 36,
                      paddingHorizontal: 12,
                    }}
                  >
                    <MaterialCommunityIcons
                      name="star-outline"
                      size={32}
                      color={theme.textMuted}
                    />
                    <Text
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.bold,
                        fontSize: 14,
                        color: theme.text,
                        marginTop: 10,
                        textAlign: 'center',
                      }}
                    >
                      Noch keine Bewertungen
                    </Text>
                    <Text
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.medium,
                        fontSize: 12,
                        color: theme.textMuted,
                        marginTop: 4,
                        textAlign: 'center',
                      }}
                    >
                      Sei der/die Erste und teile deine Erfahrung.
                    </Text>
                  </View>
                ) : (
                  ratings.map((r, i) => (
                    <ReviewCard
                      key={r.id ?? String(i)}
                      rating={r}
                      showSimilarity={showSimilarity}
                    />
                  ))
                )}
              </ScrollView>

              {/* Sticky footer CTA */}
              <View
                style={{
                  paddingHorizontal: 20,
                  paddingTop: 12,
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                }}
              >
                <Pressable
                  onPress={onWriteRating}
                  style={({ pressed }) => ({
                    height: 48,
                    borderRadius: 12,
                    backgroundColor: brand.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.9 : 1,
                    ...shadows.sm,
                  })}
                >
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.extraBold,
                      fontSize: 14,
                      color: '#fff',
                    }}
                  >
                    Bewertung schreiben
                  </Text>
                </Pressable>
              </View>
            </Animated.View>
          </GestureDetector>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────

function StarRow({ value, size = 18 }: { value: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <MaterialCommunityIcons
          key={n}
          name={n <= value ? 'star' : n - 0.5 <= value ? 'star-half-full' : 'star-outline'}
          size={size}
          color={n - 0.5 <= value ? '#f5b301' : 'rgba(25,28,29,0.22)'}
        />
      ))}
    </View>
  );
}

function ScoreBar({ label, value }: { label: string; value?: number }) {
  const { theme, brand } = useTokens();
  if (value == null || value === 0) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 4,
      }}
    >
      <Text
        style={{
          flex: 1,
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 12,
          color: theme.text,
        }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <View
            key={n}
            style={{
              width: 14,
              height: 5,
              borderRadius: 2,
              backgroundColor: n <= value ? brand.primary : theme.borderStrong,
            }}
          />
        ))}
      </View>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.bold,
          fontSize: 11,
          color: theme.textMuted,
          minWidth: 24,
          textAlign: 'right',
        }}
      >
        {value.toFixed(1)}
      </Text>
    </View>
  );
}

function formatDate(ts: any): string {
  if (!ts) return '';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const now = Date.now();
    const diff = (now - d.getTime()) / 1000;
    if (diff < 60) return 'gerade eben';
    if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
    if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
    if (diff < 86400 * 7) return `vor ${Math.floor(diff / 86400)} Tagen`;
    if (diff < 86400 * 30) return `vor ${Math.floor(diff / 86400 / 7)} Wochen`;
    if (diff < 86400 * 365) return `vor ${Math.floor(diff / 86400 / 30)} Monaten`;
    return `vor ${Math.floor(diff / 86400 / 365)} Jahren`;
  } catch {
    return '';
  }
}

function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function ReviewCard({
  rating,
  showSimilarity,
}: {
  rating: Rating;
  showSimilarity: boolean;
}) {
  const { theme } = useTokens();
  const name = rating.userInfo?.displayName ?? 'Community Mitglied';
  const date = formatDate(rating.ratedate);
  const avatarIdx = (rating.userID ?? rating.id ?? 'x').charCodeAt(0) % AVATAR_COLORS.length;

  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: 14,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: AVATAR_COLORS[avatarIdx],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 13,
              color: '#fff',
            }}
          >
            {initials(name)}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 14,
              color: theme.text,
            }}
          >
            {name}
          </Text>
          {date ? (
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 11,
                color: theme.textMuted,
              }}
            >
              {date}
            </Text>
          ) : null}
        </View>
        <StarRow value={rating.ratingOverall ?? 0} size={14} />
      </View>

      {rating.comment ? (
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.regular,
            fontSize: 13,
            lineHeight: 19,
            color: theme.textSub,
            marginBottom: 10,
          }}
        >
          {rating.comment}
        </Text>
      ) : null}

      <View style={{ paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.border }}>
        <ScoreBar label="Geschmack / Wirkung" value={rating.ratingTasteFunction} />
        <ScoreBar label="Preis / Leistung" value={rating.ratingPriceValue} />
        <ScoreBar label="Inhaltsstoffe" value={rating.ratingContent} />
        {showSimilarity ? (
          <ScoreBar label="Ähnlichkeit zur Marke" value={rating.ratingSimilarity} />
        ) : null}
      </View>
    </View>
  );
}
