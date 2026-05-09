// Debug-Page: jeder Toast / Banner einzeln triggerbar zum Testen.
// Erreichbar via Profil → Entwickler · Debug → "Toast / Banner Tester".
//
// Aufbau: drei Sections:
//   1. Toasts — alle Helper aus lib/services/ui/toast.tsx, je mit
//      Demo-Werten. Für Action-Chip-Toasts (cart, retry) gibt's
//      Varianten mit/ohne Action.
//   2. Level-Banner — alle Levels die der achievementService kennt,
//      einzeln triggerbar. Zusätzlich: Variant mit fake-unlocked-
//      Category.
//   3. Achievement-Banner — alle Achievements aus dem Catalog,
//      einzeln triggerbar. Listet sie mit Name + Punkte.
//
// Implementations-Detail: Banner laufen über useGamification().
// showBanner — exakt derselbe Pfad den Auto-Trigger und Catalog-
// Previews nutzen, damit das Testing identisch zum Real-User-Erlebnis
// aussieht.

import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { DetailHeader } from '@/components/design/DetailHeader';
import {
  bannerDataFromAchievement,
  bannerDataFromLevelUp,
  useGamification,
} from '@/components/ui/GamificationProvider';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { achievementService } from '@/lib/services/achievementService';
import {
  showAlreadyInCartToast,
  showBulkConvertSuccessToast,
  showBulkPurchasedToast,
  showCartAddedToast,
  showConvertSuccessToast,
  showFavoriteAddedToast,
  showFavoriteRemovedToast,
  showInfoToast,
  showPointsToast,
  showPurchasedToast,
  showRatingToast,
  showRetryableErrorToast,
  showStreakToast,
} from '@/lib/services/ui/toast';
import { Achievement, Level } from '@/lib/types/achievements';

interface ButtonProps {
  label: string;
  sub?: string;
  onPress: () => void;
  tint?: string;
}

function DebugButton({ label, sub, onPress, tint }: ButtonProps) {
  const { theme, brand } = useTokens();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: theme.surface,
        borderRadius: radii.lg - 2,
        paddingHorizontal: 14,
        paddingVertical: 12,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: pressed ? 0.85 : 1,
        borderLeftWidth: 3,
        borderLeftColor: tint ?? brand.primary,
      })}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.semibold,
            fontSize: 14,
            color: theme.text,
          }}
        >
          {label}
        </Text>
        {sub ? (
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 11,
              color: theme.textMuted,
              marginTop: 2,
            }}
          >
            {sub}
          </Text>
        ) : null}
      </View>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 11,
          color: brand.primary,
          letterSpacing: 0.4,
        }}
      >
        FEUER
      </Text>
    </Pressable>
  );
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        paddingHorizontal: 20,
        marginBottom: 10,
        marginTop: 22,
      }}
    >
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 20,
          letterSpacing: -0.2,
          color: theme.text,
        }}
      >
        {title}
      </Text>
      {typeof count === 'number' ? (
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 12,
            color: theme.textMuted,
          }}
        >
          {count} {count === 1 ? 'Eintrag' : 'Einträge'}
        </Text>
      ) : null}
    </View>
  );
}

export default function NotificationsDebugScreen() {
  const router = useRouter();
  const { theme } = useTokens();
  const { showBanner } = useGamification();

  const [levels, setLevels] = useState<Level[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [lv, ach] = await Promise.all([
          achievementService.getAllLevels(),
          achievementService.getAllAchievements(),
        ]);
        if (!alive) return;
        setLevels(lv);
        setAchievements(ach);
      } catch (e) {
        console.warn('NotificationsDebug: load failed', e);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <DetailHeader
        title="Toast / Banner Tester"
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={{
          paddingBottom: 80,
          paddingTop: 12,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Toasts ────────────────────────────────────────────── */}
        <SectionTitle title="Toasts" />
        <View style={{ paddingHorizontal: 20 }}>
          <DebugButton
            label="Punkte +5 · Produkt gescannt"
            sub="showPointsToast — gold, bottom"
            tint="#b45309"
            onPress={() => showPointsToast('📸 Produkt gescannt', 5)}
          />
          <DebugButton
            label="Punkte +10 · Favorit gespeichert"
            sub="showPointsToast"
            tint="#b45309"
            onPress={() => showPointsToast('💖 Favorit gespeichert', 10)}
          />
          <DebugButton
            label="Punkte +50 · Spar-Meilenstein"
            sub="showPointsToast"
            tint="#b45309"
            onPress={() => showPointsToast('💸 Spar-Meilenstein', 50)}
          />
          <DebugButton
            label="Streak (3 Tage)"
            sub="showStreakToast — orange, bottom"
            tint="#c2410c"
            onPress={() => showStreakToast(3, 25)}
          />
          <DebugButton
            label="Streak (7 Tage, ohne Bonus)"
            sub="showStreakToast"
            tint="#c2410c"
            onPress={() => showStreakToast(7)}
          />
          <DebugButton
            label="Cart Added"
            sub="showCartAddedToast — green, ohne Action-Chip"
            tint="#047857"
            onPress={() => showCartAddedToast('Bio-Hafermilch hinzugefügt')}
          />
          <DebugButton
            label="Already In Cart"
            sub="showAlreadyInCartToast — info, ohne Action-Chip"
            tint="#374151"
            onPress={() => showAlreadyInCartToast()}
          />
          <DebugButton
            label="Purchased"
            sub="showPurchasedToast — green"
            tint="#047857"
            onPress={() => showPurchasedToast('Gekauft! Du hast 2,40 € gespart.')}
          />
          <DebugButton
            label="Convert Single"
            sub="showConvertSuccessToast — savings 1,80 €"
            tint="#047857"
            onPress={() => showConvertSuccessToast(1.8)}
          />
          <DebugButton
            label="Bulk Convert (5 Items, 8,40 €)"
            sub="showBulkConvertSuccessToast"
            tint="#047857"
            onPress={() => showBulkConvertSuccessToast(8.4)}
          />
          <DebugButton
            label="Bulk Purchased — DB only"
            sub="showBulkPurchasedToast(7, 0, 12,30 €)"
            tint="#047857"
            onPress={() => showBulkPurchasedToast(7, 0, 12.3)}
          />
          <DebugButton
            label="Bulk Purchased — Mixed"
            sub="showBulkPurchasedToast(5, 3, 6,90 €)"
            tint="#047857"
            onPress={() => showBulkPurchasedToast(5, 3, 6.9)}
          />
          <DebugButton
            label="Bulk Purchased — Custom only"
            sub="showBulkPurchasedToast(0, 4, 0)"
            tint="#047857"
            onPress={() => showBulkPurchasedToast(0, 4, 0)}
          />
          <DebugButton
            label="Favorite Added"
            sub="showFavoriteAddedToast — pink"
            tint="#be185d"
            onPress={() => showFavoriteAddedToast('Bio-Hafermilch')}
          />
          <DebugButton
            label="Favorite Removed"
            sub="showFavoriteRemovedToast — pink"
            tint="#be185d"
            onPress={() => showFavoriteRemovedToast('Bio-Hafermilch')}
          />
          <DebugButton
            label="Rating Success"
            sub="showRatingToast — ⭐-Emoji, lila"
            tint="#6d28d9"
            onPress={() =>
              showRatingToast('⭐ Deine Bewertung wurde gespeichert!', 'success')
            }
          />
          <DebugButton
            label="Rating Error"
            sub="showRatingToast — ❌-Emoji, rot"
            tint="#b91c1c"
            onPress={() =>
              showRatingToast(
                '❌ Bewertung konnte nicht gespeichert werden',
                'error',
              )
            }
          />
          <DebugButton
            label="Info"
            sub="showInfoToast(msg, 'info')"
            tint="#374151"
            onPress={() => showInfoToast('Das ist eine neutrale Info.', 'info')}
          />
          <DebugButton
            label="Error (kein Retry)"
            sub="showInfoToast(msg, 'error')"
            tint="#b91c1c"
            onPress={() =>
              showInfoToast('Etwas lief schief — bitte erneut versuchen.', 'error')
            }
          />
          <DebugButton
            label="Retryable Error"
            sub="showRetryableErrorToast — mit Wiederholen-Action"
            tint="#b91c1c"
            onPress={() =>
              showRetryableErrorToast(
                'Verbindung verloren. Bitte Verbindung prüfen.',
                () => {
                  showInfoToast('Retry geklickt!', 'info');
                },
              )
            }
          />
        </View>

        {/* ── Level-Banner ──────────────────────────────────────── */}
        <SectionTitle title="Level-Banner" count={levels.length} />
        <View style={{ paddingHorizontal: 20 }}>
          {levels.length === 0 ? (
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 13,
                color: theme.textMuted,
                paddingVertical: 24,
                textAlign: 'center',
              }}
            >
              Levels werden geladen …
            </Text>
          ) : (
            <>
              {levels.map((lv) => (
                <DebugButton
                  key={`level-${lv.id}`}
                  label={`Level ${lv.id} · ${lv.name}`}
                  sub={lv.description ?? 'Banner anzeigen'}
                  tint={lv.color ?? undefined}
                  onPress={() => {
                    showBanner(
                      bannerDataFromLevelUp(lv.id, Math.max(0, lv.id - 1)),
                    );
                  }}
                />
              ))}
              {/* Variante mit fake-unlocked-Category — exemplarisch
                  mit Level 3, weil dort im Live-Game typischerweise
                  Drogerie unlocked wird. */}
              <DebugButton
                label="Level 3 + Kategorie-Unlock (Fake)"
                sub="bannerDataFromLevelUp mit unlockedCategory"
                tint="#F0A030"
                onPress={() => {
                  showBanner(
                    bannerDataFromLevelUp(3, 2, {
                      id: 'drogerie',
                      name: 'Drogerie',
                      imageUrl: '',
                    }),
                  );
                }}
              />
            </>
          )}
        </View>

        {/* ── Achievement-Banner ────────────────────────────────── */}
        <SectionTitle title="Achievement-Banner" count={achievements.length} />
        <View style={{ paddingHorizontal: 20 }}>
          {achievements.length === 0 ? (
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 13,
                color: theme.textMuted,
                paddingVertical: 24,
                textAlign: 'center',
              }}
            >
              Achievements werden geladen …
            </Text>
          ) : (
            achievements.map((a) => (
              <DebugButton
                key={`ach-${a.id}`}
                label={`${a.name} · +${a.points} Pkt`}
                sub={`${a.description}${a.trigger?.action ? ` — action: ${a.trigger.action}` : ''}`}
                tint={(a.color as string) || '#F0A030'}
                onPress={() => {
                  showBanner(bannerDataFromAchievement(a));
                }}
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
