import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
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
  Easing,
  runOnJS,
  useAnimatedScrollHandler,
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
const SCREEN_HEIGHT = Dimensions.get('window').height;
const AVATAR_COLORS = ['#0d8575', '#cc6610', '#7b53b8', '#1b6fc7', '#a83753'];

const StyleAbsoluteFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

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
  /**
   * Bestehende Bewertung des aktuellen Users für dieses Produkt
   * (sofern vorhanden). Wenn gesetzt, wird das Submit-Formular mit
   * den Werten vorbefüllt und der CTA zeigt "Bewertung
   * aktualisieren" statt "Bewertung absenden". Verhindert dass der
   * User aus Versehen seine alte Bewertung "doppelt" abgibt.
   */
  existingRating?: Rating | null;
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
  existingRating,
  onSubmit,
}: Props) {
  const isEditing = !!existingRating;
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
    // Wenn der User bereits eine Bewertung hat, prefillen wir das
    // Formular mit deren Werten — sonst Reset auf 0.
    setOverall(existingRating?.ratingOverall ?? 0);
    setTaste(existingRating?.ratingTasteFunction ?? 0);
    setPriceVal(existingRating?.ratingPriceValue ?? 0);
    setContent(existingRating?.ratingContent ?? 0);
    setSimilarity(existingRating?.ratingSimilarity ?? 0);
    setComment(existingRating?.comment ?? '');
  };

  // Sync das Formular IMMER wenn `existingRating` sich ändert:
  //   • Late-Arrival vom Parent (Fetch landet nach dem Sheet-Open)
  //     → Formular füllt sich auf
  //   • Wechsel zwischen Produkten OHNE Schließen des Sheets (z.B.
  //     Alt-Card-Picker) → Formular reflektiert das neue Produkt
  //   • existingRating wechselt zu null (User hatte das alte
  //     Produkt bewertet, das neue noch nicht) → Formular auf 0
  // Dep-Key kombiniert .id mit einem "none"-Sentinel damit auch der
  // null-Übergang ein Re-Run triggert.
  useEffect(() => {
    setOverall(existingRating?.ratingOverall ?? 0);
    setTaste(existingRating?.ratingTasteFunction ?? 0);
    setPriceVal(existingRating?.ratingPriceValue ?? 0);
    setContent(existingRating?.ratingContent ?? 0);
    setSimilarity(existingRating?.ratingSimilarity ?? 0);
    setComment(existingRating?.comment ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingRating?.id ?? 'none']);

  // Slide-up + backdrop fade animation. Sheet stays mounted through the
  // out-animation so the close gesture is actually visible.
  const [mounted, setMounted] = useState(visible);
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setView('list');
      resetForm();
      requestAnimationFrame(() => {
        translateY.value = withSpring(0, {
          damping: 24,
          stiffness: 220,
          mass: 0.9,
        });
        backdropOpacity.value = withTiming(1, { duration: 220 });
      });
    } else {
      translateY.value = withTiming(SCREEN_HEIGHT, {
        duration: 260,
        easing: Easing.out(Easing.cubic),
      });
      backdropOpacity.value = withTiming(
        0,
        { duration: 220 },
        (finished) => {
          if (finished) runOnJS(setMounted)(false);
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Body ScrollView height cap (in PX, not %) — the trick that
  // makes both "size-to-content for short lists" AND "scroll past
  // cap for long lists" work reliably. Same pattern as FilterSheet.
  // Subtractions: paddingTop (10) + drag handle + margin (17) +
  // title row (~52) + footer (~61) + safe-area-bottom padding.
  const bodyMaxHeight =
    SCREEN_HEIGHT * 0.9 -
    (10 + 17 + 52 + 61 + Math.max(32, insets.bottom + 20));

  // ─── Scroll-to-dismiss wiring ───────────────────────────────────
  // Native iOS bottom sheets keep dismissing when the user keeps
  // pulling down past the top of the inner ScrollView. We mirror
  // that with three shared values and a Pan + Native gesture pair:
  //
  //   • `scrollY`     — current ScrollView contentOffset.y (UI thread).
  //   • `wasAtTop`    — whether `scrollY` was <= 0 at the previous
  //                     onUpdate tick. Used to detect the moment the
  //                     user transitions from in-list scrolling to
  //                     at-top-overscroll (so we can capture an
  //                     offset and avoid a visual jump).
  //   • `dragOffset`  — the absolute pan translationY at the moment
  //                     `wasAtTop` flipped to true. Subsequent sheet
  //                     translation = translationY − dragOffset, so
  //                     the sheet stays at 0 px when scroll first
  //                     reaches the top and only starts moving as
  //                     the user keeps pulling.
  const scrollY = useSharedValue(0);
  const wasAtTop = useSharedValue(true);
  const dragOffset = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  // Native gesture handle for the ScrollView's internal scroll. The
  // outer Pan gesture marks itself simultaneous with this so they
  // don't compete for touches — Pan handles sheet translation, the
  // native ScrollView handles list scrolling, and both run together.
  const nativeScroll = Gesture.Native();

  const panGesture = Gesture.Pan()
    // Activate only on DOWNWARD drags ≥ 5 px. Upward drags never
    // claim the gesture so the ScrollView always wins on a scroll-up.
    .activeOffsetY([-Number.MAX_SAFE_INTEGER, 5])
    .simultaneousWithExternalGesture(nativeScroll)
    .onStart(() => {
      'worklet';
      // Capture initial state so the first onUpdate tick has a clean
      // baseline. If the user starts the drag with the list already
      // at the top, no offset to subtract — the sheet starts panning
      // immediately.
      wasAtTop.value = scrollY.value <= 0;
      dragOffset.value = 0;
    })
    .onUpdate((e) => {
      'worklet';
      const atTop = scrollY.value <= 0;
      if (atTop) {
        if (!wasAtTop.value) {
          // The user just transitioned from scrolling-the-list to
          // overscrolling-from-the-top. Capture the current pan
          // translation so we don't jump the sheet to that value —
          // we want it to stay at 0 px and start moving from here.
          dragOffset.value = e.translationY;
          wasAtTop.value = true;
        }
        const sheetDelta = e.translationY - dragOffset.value;
        translateY.value = sheetDelta > 0 ? sheetDelta : 0;
      } else {
        // Mid-list — the ScrollView handles the gesture. Make sure
        // the sheet stays pinned (no leftover translateY from a
        // previous overscroll-then-scroll-back sequence).
        wasAtTop.value = false;
        translateY.value = 0;
      }
    })
    .onEnd((e) => {
      const close =
        translateY.value > SWIPE_CLOSE_THRESHOLD ||
        (scrollY.value <= 0 && e.velocityY > SWIPE_CLOSE_VELOCITY);
      if (close) {
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 240 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
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

  if (!mounted) return null;

  return (
    <Modal
      animationType="none"
      transparent
      visible={mounted}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Backdrop layers — Animated.View for the visual fade,
            Pressable as ABSOLUTE-FILL SIBLING for tap-to-dismiss.
            They are siblings of the sheet (NOT wrapping it) so the
            sheet's children — including the ScrollView — receive
            touches uninterrupted. Same pattern as FilterSheet. */}
        <Animated.View
          pointerEvents="none"
          style={[
            { ...StyleAbsoluteFill, backgroundColor: theme.overlay },
            backdropStyle,
          ]}
        />
        <Pressable onPress={onClose} style={StyleAbsoluteFill} />

        {/* Sheet anchor — `box-none` so taps in the empty area
            above the sheet pass through to the backdrop Pressable.
            The sheet itself catches its own touches. */}
        <View
          pointerEvents="box-none"
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <Animated.View
            style={[
              sheetStyle,
              {
                backgroundColor: theme.surface,
                borderTopLeftRadius: 22,
                borderTopRightRadius: 22,
                paddingTop: 10,
                paddingBottom: Math.max(32, insets.bottom + 20),
                // No maxHeight here — sheet sizes to content.
                // The ScrollView below carries the pixel cap so RN/
                // Yoga reliably bounds it.
              },
            ]}
          >
            {/* Pan gesture wraps the WHOLE sheet (chrome + body +
                footer). It runs simultaneously with the inner
                ScrollView's native scroll gesture (`nativeScroll`),
                so:
                  • Chrome / footer drags     → sheet pans down
                  • Body drag while mid-list  → ScrollView scrolls
                  • Body drag while at top    → sheet pans down
                The conditional logic in panGesture.onUpdate switches
                between "pan the sheet" and "let scroll happen"
                based on the live scroll offset. */}
            <GestureDetector gesture={panGesture}>
              <View>
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

                {/* View body — INSIDE the outer pan GestureDetector
                    so chrome+body share the pan. ScrollViews below
                    are wrapped in their own inner GestureDetector
                    with the `nativeScroll` gesture so the native
                    scroll cooperates simultaneously with the pan. */}
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
                <GestureDetector gesture={nativeScroll}>
                <Animated.ScrollView
                  style={{ maxHeight: bodyMaxHeight }}
                  contentContainerStyle={{
                    paddingHorizontal: 20,
                    paddingBottom: 20,
                  }}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  onScroll={scrollHandler}
                  scrollEventThrottle={1}
                  bounces={false}
                  overScrollMode="never"
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
                </Animated.ScrollView>
                </GestureDetector>
              ) : (
                <GestureDetector gesture={nativeScroll}>
                <Animated.ScrollView
                  style={{ maxHeight: bodyMaxHeight }}
                  contentContainerStyle={{
                    paddingHorizontal: 20,
                    paddingBottom: 20,
                  }}
                  showsVerticalScrollIndicator={false}
                  onScroll={scrollHandler}
                  scrollEventThrottle={1}
                  bounces={false}
                  overScrollMode="never"
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
                </Animated.ScrollView>
                </GestureDetector>
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
                        {isEditing
                          ? 'Bewertung aktualisieren'
                          : 'Bewertung schreiben'}
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
                          {submitting
                            ? 'Speichern …'
                            : isEditing
                              ? 'Aktualisieren'
                              : 'Absenden'}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              )}
              </View>
            </GestureDetector>
          </Animated.View>
        </View>
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
