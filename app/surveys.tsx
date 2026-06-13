import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { useSurvey } from '@/components/survey/SurveyProvider';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { getGeneralSurveys } from '@/lib/services/surveyService';
import { formatCents } from '@/lib/types/cashback';
import type { Poll } from '@/lib/types/survey';

/**
 * Umfragen-Übersicht (ClickUp 86ca8fbpz) — die EINE Stelle, an der ein
 * User alle gerade verfügbaren ALLGEMEINEN Umfragen sieht und der Reihe
 * nach durchgehen kann. Action-getriggerte Umfragen erscheinen NICHT
 * hier (die kommen kontextuell als Popup nach einer Aktion).
 *
 * Tap auf eine Karte öffnet das app-weite Umfrage-Sheet (SurveyProvider).
 * Nach dem Beantworten bumpt activityNonce → Liste lädt neu, beantwortete
 * verschwinden (kein Re-Pop).
 */
export default function SurveysScreen() {
  const { theme, brand } = useTokens();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const router = useRouter();
  const { user } = useAuth();
  const { showSurvey, activityNonce } = useSurvey();

  const [surveys, setSurveys] = useState<Poll[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const load = useCallback(() => {
    if (!user?.uid) {
      setSurveys([]);
      return;
    }
    let alive = true;
    getGeneralSurveys(user.uid)
      .then((s) => alive && setSurveys(s))
      .catch(() => alive && setSurveys([]));
    return () => {
      alive = false;
    };
  }, [user?.uid]);

  // Initial + nach jeder Beantwortung (activityNonce) neu laden.
  useEffect(() => {
    const cleanup = load();
    return cleanup;
  }, [load, activityNonce]);

  // Pull-to-refresh: Poll-Cache busten + frisch laden (86ca8g6eh).
  const onRefresh = useCallback(async () => {
    if (!user?.uid) return;
    setRefreshing(true);
    try {
      const s = await getGeneralSurveys(user.uid, true);
      setSurveys(s);
    } catch {
      /* lokalen Stand behalten */
    } finally {
      setRefreshing(false);
    }
  }, [user?.uid]);

  const list = surveys ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader title="Umfragen" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + DETAIL_HEADER_ROW_HEIGHT + 12,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 24,
          gap: 12,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={brand.primary}
            colors={[brand.primary]}
          />
        }
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 13,
            color: theme.textSub,
            marginBottom: 4,
          }}
        >
          Kurze Umfragen — beantworte sie und sichere dir Cashback-Taler.
        </Text>

        {surveys === null ? null : list.length === 0 ? (
          <View
            style={{
              alignItems: 'center',
              paddingVertical: 48,
              gap: 12,
            }}
          >
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: theme.surfaceAlt ?? theme.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons name="poll" size={30} color={theme.textMuted} />
            </View>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 16,
                color: theme.text,
              }}
            >
              Gerade keine Umfragen
            </Text>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 13,
                color: theme.textSub,
                textAlign: 'center',
                maxWidth: 280,
              }}
            >
              Schau später wieder vorbei — neue Umfragen kommen regelmäßig dazu.
            </Text>
          </View>
        ) : (
          list.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => showSurvey(s)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 14,
                borderRadius: radii.lg,
                backgroundColor: theme.surface,
                borderWidth: 1,
                borderColor: theme.border,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialCommunityIcons name="poll" size={22} color={brand.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 15,
                    color: theme.text,
                    letterSpacing: -0.2,
                  }}
                  numberOfLines={1}
                >
                  {s.title}
                </Text>
                {s.description ? (
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.medium,
                      fontSize: 12,
                      color: theme.textSub,
                      marginTop: 2,
                    }}
                    numberOfLines={2}
                  >
                    {s.description}
                  </Text>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <Text
                    style={{
                      fontFamily,
                      fontWeight: fontWeight.bold,
                      fontSize: 11,
                      color: theme.textMuted,
                    }}
                  >
                    {(s.questions?.length ?? 0)} {(s.questions?.length ?? 0) === 1 ? 'Frage' : 'Fragen'}
                  </Text>
                  {typeof s.rewardCents === 'number' && s.rewardCents > 0 ? (
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 3,
                        borderRadius: 8,
                        backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily,
                          fontWeight: fontWeight.extraBold,
                          fontSize: 11,
                          color: brand.primary,
                        }}
                      >
                        +{formatCents(s.rewardCents)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={theme.textMuted} />
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}
