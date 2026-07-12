import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { FilterSheet } from '@/components/design/FilterSheet';
import { useSurvey } from '@/components/survey/SurveyProvider';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { useCashbackUserState } from '@/lib/hooks/useCashbackUserState';
import { consentService } from '@/lib/services/consentService';
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
  const { user, isAnonymous } = useAuth();
  const { showSurvey, activityNonce } = useSurvey();

  const [surveys, setSurveys] = useState<Poll[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 2.5 (Stufe 2): anonyme User können vergütete Umfragen (noch) nicht
  // auszahlen lassen (Reward braucht Konto + Cashback-Consent). Statt sie
  // NACH dem Beantworten zu enttäuschen, zeigen wir die Bedingung + ein
  // Konto-Angebot VORHER. `accountOffer` = die angetippte vergütete Umfrage.
  const [accountOffer, setAccountOffer] = useState<Poll | null>(null);
  // Kontext-isAnonymous statt user.isAnonymous: deckt auch per Custom-Token
  // gerettete Legacy-Gäste ab (Session-Rettung 5.x→6.0) — die brauchen fürs
  // Auszahlen genauso ein Konto.
  const isAnon = !!user && isAnonymous;
  // 86cagb5gh: vergütete Umfragen sind Cashback → registrierte User ohne
  // gültigen Consent sehen VOR der Umfrage den Consent (Umfragen-Variante),
  // statt erst nach dem Beantworten genudgt zu werden.
  const cashback = useCashbackUserState();

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
          Kurze Umfragen — beantworte sie und sichere dir Guthaben.
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
              onPress={() => {
                const rewarded = typeof s.rewardCents === 'number' && s.rewardCents > 0;
                // 2.5: Anonyme + vergütete Umfrage → erst Konto-Angebot.
                if (isAnon && rewarded) {
                  setAccountOffer(s);
                  return;
                }
                // 86cagb5gh: Registrierte ohne gültigen Cashback-Consent →
                // Consent VOR der vergüteten Umfrage (Umfragen-Variante).
                // `!isLoading`-Guard: während der Snapshot bootstrappt nicht
                // fälschlich gaten — dann greift wie bisher der Nudge danach.
                if (rewarded && !isAnon && !cashback.isLoading && !cashback.hasConsent) {
                  router.push('/cashback/consent?from=survey' as any);
                  return;
                }
                if (rewarded && cashback.hasConsent) {
                  // 86cagb57g: beim App-Start abgelehnten Tracking-Consent
                  // (UMP, Android) einmal pro Session erneut anbieten.
                  void consentService.ensureTrackingConsentAtCashback().finally(() => {
                    showSurvey(s);
                  });
                  return;
                }
                showSurvey(s);
              }}
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
                    <>
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
                      {/* 2.5: Bedingung ehrlich upfront statt Enttäuschung danach. */}
                      {isAnon ? (
                        <Text
                          style={{
                            fontFamily,
                            fontWeight: fontWeight.medium,
                            fontSize: 10,
                            color: theme.textMuted,
                          }}
                        >
                          mit Konto
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                </View>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={theme.textMuted} />
            </Pressable>
          ))
        )}
      </ScrollView>

      {/* 2.5 (Stufe 2): Konto-Angebot VOR einer vergüteten Umfrage für
          anonyme User — positiv gerahmt (kein "du kriegst nichts"). */}
      <FilterSheet
        visible={!!accountOffer}
        title="Guthaben sichern"
        onClose={() => setAccountOffer(null)}
      >
        <View style={{ paddingBottom: 8, gap: 14 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 14,
              lineHeight: 20,
              color: theme.textSub,
            }}
          >
            Für die Auszahlung deines Guthabens brauchst du ein kostenloses Konto.
            Leg in ein paar Sekunden eins an — oder mach jetzt schon mit: deine
            Antwort hilft uns trotzdem weiter.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setAccountOffer(null);
              router.push('/auth/welcome' as any);
            }}
            style={({ pressed }) => ({
              backgroundColor: brand.primary,
              borderRadius: radii.md,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 15, color: '#ffffff' }}>
              Konto anlegen
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              const s = accountOffer;
              setAccountOffer(null);
              if (s) showSurvey(s);
            }}
            style={({ pressed }) => ({
              paddingVertical: 12,
              alignItems: 'center',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 14, color: theme.textSub }}>
              Trotzdem beantworten
            </Text>
          </Pressable>
        </View>
      </FilterSheet>
    </View>
  );
}
