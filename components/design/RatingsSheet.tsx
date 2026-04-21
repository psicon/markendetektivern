import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
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

export type SubmittedRating = {
  ratingOverall: number;
  ratingTasteFunction?: number | null;
  ratingPriceValue?: number | null;
  ratingContent?: number | null;
  ratingSimilarity?: number | null;
  comment?: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  productName: string;
  ratings: Rating[];
  averageOverall?: number | null;
  totalCount?: number;
  showSimilarity?: boolean;
  /** True while the parent is fetching ratings — renders skeleton cards. */
  loading?: boolean;
  /** Called when the user taps Submit in the write view. Resolved promise
   *  means the sheet switches back to the list; rejection keeps the form
   *  open so the user can retry. */
  onSubmit?: (r: SubmittedRating) => Promise<void> | void;
};

/**
 * Product-rating bottom sheet. Two internal views:
 *  - list: summary + review cards (read-only)
 *  - submit: star pickers + comment, sends to onSubmit
 * Swipe-down dismiss works in both views.
 */
export function RatingsSheet({
  visible,
  onClose,
  productName,
  ratings,
  averageOverall,
  totalCount,
  showSimilarity = false,
  loading = false,
  onSubmit,
}: Props) {
  const { theme, brand, shadows } = useTokens();
  const insets = useSafeAreaInsets();

  const [view, setView] = useState<'list' | 'submit' | 'submitted'>('list');
  const [overall, setOverall] = useState(0);
  const [taste, setTaste] = useState(0);
  const [priceVal, setPriceVal] = useState(0);
  const [content, setContent] = useState(0);
  const [similarity, setSimilarity] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setOverall(0);
    setTaste(0);
    setPriceVal(0);
    setContent(0);
    setSimilarity(0);
    setComment('');
  };

  const translateY = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      translateY.value = 0;
      setView('list');
      resetForm();
    }
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

  const canSubmit = overall > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !onSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        ratingOverall: overall,
        ratingTasteFunction: taste || null,
        ratingPriceValue: priceVal || null,
        ratingContent: content || null,
        ratingSimilarity: showSimilarity ? similarity || null : null,
        comment: comment.trim() || null,
      });
      setView('submitted');
      // Auto-return to list after a moment so the user sees the confirmation.
      setTimeout(() => {
        resetForm();
        setView('list');
      }, 1800);
    } catch {
      // Keep the form open so the user can retry — parent already toasted.
    } finally {
      setSubmitting(false);
    }
  };

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
                  maxHeight: '90%',
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
                    {view === 'submit' ? 'Deine Bewertung' : 'Bewertungen'}
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

              {/* View body */}
              {view === 'submitted' ? (
                <View
                  style={{
                    alignItems: 'center',
                    paddingVertical: 48,
                    paddingHorizontal: 32,
                  }}
                >
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 32,
                      backgroundColor: brand.primary,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 16,
                    }}
                  >
                    <MaterialCommunityIcons name="check" size={36} color="#fff" />
                  </View>
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.extraBold,
                      fontSize: 18,
                      color: theme.text,
                      textAlign: 'center',
                    }}
                  >
                    Danke!
                  </Text>
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.medium,
                      fontSize: 13,
                      color: theme.textMuted,
                      textAlign: 'center',
                      marginTop: 6,
                    }}
                  >
                    Deine Bewertung ist gespeichert.
                  </Text>
                </View>
              ) : view === 'submit' ? (
                <ScrollView
                  contentContainerStyle={{
                    paddingHorizontal: 20,
                    paddingBottom: 20,
                  }}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  <StarPicker
                    label="Gesamt"
                    value={overall}
                    onChange={setOverall}
                    required
                  />
                  <StarPicker
                    label="Geschmack / Wirkung"
                    value={taste}
                    onChange={setTaste}
                  />
                  <StarPicker
                    label="Preis / Leistung"
                    value={priceVal}
                    onChange={setPriceVal}
                  />
                  <StarPicker label="Inhaltsstoffe" value={content} onChange={setContent} />
                  {showSimilarity ? (
                    <StarPicker
                      label="Ähnlichkeit zur Marke"
                      value={similarity}
                      onChange={setSimilarity}
                    />
                  ) : null}

                  <View style={{ marginTop: 18 }}>
                    <Text
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.semibold,
                        fontSize: 12,
                        color: theme.textMuted,
                        marginBottom: 6,
                        letterSpacing: 0.4,
                        textTransform: 'uppercase',
                      }}
                    >
                      Dein Kommentar (optional)
                    </Text>
                    <TextInput
                      placeholder="Teile deine Erfahrung …"
                      placeholderTextColor={theme.textMuted}
                      value={comment}
                      onChangeText={setComment}
                      multiline
                      maxLength={600}
                      style={{
                        minHeight: 108,
                        backgroundColor: theme.surfaceAlt,
                        borderRadius: 12,
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                        fontFamily,
                        fontWeight: fontWeight.regular,
                        fontSize: 14,
                        lineHeight: 20,
                        color: theme.text,
                        textAlignVertical: 'top',
                      }}
                    />
                    <Text
                      style={{
                        fontFamily,
                        fontWeight: fontWeight.medium,
                        fontSize: 11,
                        color: theme.textMuted,
                        textAlign: 'right',
                        marginTop: 4,
                      }}
                    >
                      {comment.length}/600
                    </Text>
                  </View>
                </ScrollView>
              ) : (
                <ScrollView
                  contentContainerStyle={{
                    paddingHorizontal: 20,
                    paddingBottom: 20,
                  }}
                  showsVerticalScrollIndicator={false}
                >
                  {/* Loading skeletons */}
                  {loading ? (
                    <View style={{ paddingTop: 6 }}>
                      <SummarySkeleton />
                      <ReviewSkeleton />
                      <ReviewSkeleton />
                      <ReviewSkeleton />
                    </View>
                  ) : total > 0 ? (
                    <>
                      {/* Summary */}
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

                      {ratings.map((r, i) => (
                        <ReviewCard
                          key={r.id ?? String(i)}
                          rating={r}
                          showSimilarity={showSimilarity}
                        />
                      ))}
                    </>
                  ) : (
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
                  )}
                </ScrollView>
              )}

              {/* Footer CTA — only in list/submit views */}
              {view === 'submitted' ? null : (
                <View
                  style={{
                    paddingHorizontal: 20,
                    paddingTop: 12,
                    borderTopWidth: 1,
                    borderTopColor: theme.border,
                  }}
                >
                  {view === 'list' ? (
                    <Pressable
                      onPress={() => setView('submit')}
                      disabled={loading}
                      style={({ pressed }) => ({
                        height: 48,
                        borderRadius: 12,
                        backgroundColor: loading ? theme.borderStrong : brand.primary,
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
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <Pressable
                        onPress={() => {
                          resetForm();
                          setView('list');
                        }}
                        disabled={submitting}
                        style={({ pressed }) => ({
                          flex: 1,
                          height: 48,
                          borderRadius: 12,
                          backgroundColor: theme.surfaceAlt,
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: pressed ? 0.9 : 1,
                        })}
                      >
                        <Text
                          style={{
                            fontFamily,
                            fontWeight: fontWeight.bold,
                            fontSize: 14,
                            color: theme.text,
                          }}
                        >
                          Abbrechen
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={handleSubmit}
                        disabled={!canSubmit}
                        style={({ pressed }) => ({
                          flex: 1.4,
                          height: 48,
                          borderRadius: 12,
                          backgroundColor: canSubmit
                            ? brand.primary
                            : theme.borderStrong,
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: pressed && canSubmit ? 0.9 : 1,
                          ...(canSubmit ? shadows.sm : {}),
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
                          {submitting ? 'Speichern …' : 'Absenden'}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              )}
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

function StarPicker({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  required?: boolean;
}) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.semibold,
          fontSize: 13,
          color: theme.text,
          marginBottom: 8,
        }}
      >
        {label}
        {required ? <Text style={{ color: '#e53935' }}> *</Text> : null}
      </Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = n <= value;
          return (
            <Pressable
              key={n}
              onPress={() => onChange(value === n ? 0 : n)}
              hitSlop={4}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <MaterialCommunityIcons
                name={active ? 'star' : 'star-outline'}
                size={32}
                color={active ? '#f5b301' : theme.borderStrong}
              />
            </Pressable>
          );
        })}
      </View>
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

// Lightweight skeletons — shown while the parent fetches ratings so the
// sheet doesn't flash the empty state on every open.
function SummarySkeleton() {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
        marginBottom: 14,
      }}
    >
      <View style={{ width: 96, alignItems: 'center' }}>
        <View
          style={{
            width: 60,
            height: 36,
            borderRadius: 6,
            backgroundColor: theme.shimmer1,
            marginBottom: 6,
          }}
        />
        <View
          style={{
            width: 84,
            height: 12,
            borderRadius: 4,
            backgroundColor: theme.shimmer1,
          }}
        />
      </View>
      <View style={{ flex: 1, justifyContent: 'center', gap: 6 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <View
            key={i}
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: theme.shimmer1,
              width: `${100 - i * 12}%`,
            }}
          />
        ))}
      </View>
    </View>
  );
}

function ReviewSkeleton() {
  const { theme } = useTokens();
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: theme.shimmer1,
          }}
        />
        <View style={{ flex: 1, gap: 6 }}>
          <View
            style={{ height: 12, borderRadius: 3, backgroundColor: theme.shimmer1, width: '48%' }}
          />
          <View
            style={{ height: 10, borderRadius: 3, backgroundColor: theme.shimmer1, width: '32%' }}
          />
        </View>
        <View style={{ height: 14, width: 82, borderRadius: 3, backgroundColor: theme.shimmer1 }} />
      </View>
      <View style={{ gap: 6, marginBottom: 10 }}>
        <View style={{ height: 10, borderRadius: 3, backgroundColor: theme.shimmer1 }} />
        <View
          style={{ height: 10, borderRadius: 3, backgroundColor: theme.shimmer1, width: '85%' }}
        />
        <View
          style={{ height: 10, borderRadius: 3, backgroundColor: theme.shimmer1, width: '60%' }}
        />
      </View>
    </View>
  );
}
