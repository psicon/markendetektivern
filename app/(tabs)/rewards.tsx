import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SegmentedTabs } from '@/components/design/SegmentedTabs';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';

// ─── Sub-tabs inside the Rewards screen ────────────────────────────────
// Matches the prototype: "Einlösen" (cashback redeem catalogue + earn
// actions) and "Bestenliste" (leaderboard among friends / Bundesland +
// city battle). For Phase 1 the screens themselves are placeholders;
// the chrome (BlurView header, tab switch, profile button, "So geht's"
// pill) is what's wired up here so the navigation reads correctly
// from day one.
type RewardsTab = 'redeem' | 'ranks';

const HEADER_ROW_HEIGHT = 52;

export default function RewardsScreen() {
  const { theme } = useTokens();
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [tab, setTab] = useState<RewardsTab>('redeem');

  // Same blur-chrome pattern as Home / Stöbern: BlurView on iOS,
  // tinted opaque View on Android (BlurView quality is poor there).
  // Sits absolute on top so content scrolls under the Dynamic Island.
  const Chrome = (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 10,
        paddingTop: insets.top,
      }}
      pointerEvents="box-none"
    >
      {Platform.OS === 'ios' ? (
        <BlurView
          tint={scheme === 'dark' ? 'dark' : 'light'}
          intensity={80}
          style={{ ...Platform.select({ default: {} }) }}
        >
          <ChromeContent
            tab={tab}
            setTab={setTab}
            theme={theme}
            user={user}
          />
        </BlurView>
      ) : (
        <View
          style={{
            backgroundColor:
              scheme === 'dark'
                ? 'rgba(15,18,20,0.92)'
                : 'rgba(245,247,248,0.92)',
          }}
        >
          <ChromeContent
            tab={tab}
            setTab={setTab}
            theme={theme}
            user={user}
          />
        </View>
      )}
    </View>
  );

  // Total chrome height = safe-area + h1 row + segmented-tabs row + bottom padding
  // Used as ScrollView paddingTop so content starts just below the chrome.
  const chromeHeight = insets.top + HEADER_ROW_HEIGHT + 12 + 40 + 14;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: chromeHeight,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}
        scrollsToTop
      >
        {tab === 'redeem' ? (
          <PlaceholderSection
            icon="wallet-outline"
            title="Einlösen"
            body="Cashback-Taler, Quick-Actions, Belohnungs-Katalog (Gutscheine, Prepaid, PayPal, Spenden) und Verdienst-Aktionen kommen in Phase 2."
          />
        ) : (
          <PlaceholderSection
            icon="trophy-outline"
            title="Bestenliste"
            body="Leaderboard für Freunde / Bundesland mit Monats- und All-Time-Wertung sowie City-Battle kommen in Phase 3."
          />
        )}
      </ScrollView>

      {Chrome}
    </View>
  );
}

// ─── Chrome inner content — H1 row + sub-tabs ─────────────────────────
function ChromeContent({
  tab,
  setTab,
  theme,
  user,
}: {
  tab: RewardsTab;
  setTab: (t: RewardsTab) => void;
  theme: ReturnType<typeof useTokens>['theme'];
  user: ReturnType<typeof useAuth>['user'];
}) {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 }}>
      {/* Title row: H1 + "So geht's" help pill + profile avatar.
          Help and profile sit at fixed positions to the right of the
          flex:1 title — same layout the prototype uses. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: HEADER_ROW_HEIGHT,
        }}
      >
        <Text
          style={{
            flex: 1,
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 26,
            letterSpacing: -0.4,
            color: theme.text,
          }}
        >
          Belohnungen
        </Text>

        <Pressable
          onPress={() => {
            // RewardsHelp sheet wires up in Phase 4.
          }}
          style={({ pressed }) => ({
            height: 34,
            paddingHorizontal: 12,
            borderRadius: 17,
            backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            opacity: pressed ? 0.7 : 1,
          })}
          hitSlop={6}
        >
          <MaterialCommunityIcons
            name="help-circle-outline"
            size={15}
            color={theme.primary}
          />
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.bold,
              fontSize: 12,
              color: theme.primary,
            }}
          >
            So geht's
          </Text>
        </Pressable>

        <Pressable
          onPress={() =>
            router.push(user ? ('/profile' as any) : ('/auth/welcome' as any))
          }
          style={({ pressed }) => ({
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: theme.surfaceAlt,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <MaterialCommunityIcons
            name="account-outline"
            size={20}
            color={theme.textMuted}
          />
        </Pressable>
      </View>

      {/* Sub-tabs (Einlösen / Bestenliste) — uses the same pill-style
          SegmentedTabs as the rest of the design system. */}
      <SegmentedTabs
        tabs={[
          { key: 'redeem', label: 'Einlösen' },
          { key: 'ranks', label: 'Bestenliste' },
        ] as const}
        value={tab}
        onChange={setTab}
      />
    </View>
  );
}

// Placeholder card — shown for both internal tabs while Phase 2/3 are
// still pending. Communicates what's coming so the screen doesn't feel
// half-finished during rollout.
function PlaceholderSection({
  icon,
  title,
  body,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  body: string;
}) {
  const { theme, shadows } = useTokens();
  return (
    <View
      style={{
        marginHorizontal: 20,
        marginTop: 24,
        padding: 20,
        backgroundColor: theme.surface,
        borderRadius: radii.lg,
        alignItems: 'center',
        ...shadows.sm,
      }}
    >
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 14,
        }}
      >
        <MaterialCommunityIcons name={icon} size={28} color={theme.primary} />
      </View>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 18,
          color: theme.text,
          marginBottom: 6,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 13,
          lineHeight: 19,
          color: theme.textMuted,
          textAlign: 'center',
        }}
      >
        {body}
      </Text>
    </View>
  );
}
