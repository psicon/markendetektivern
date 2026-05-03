// app/tipps-und-tricks.tsx
//
// Tipps & Tricks — neu im Design-System:
//   • DetailHeader (Back + Title "Tipps & Tricks")
//   • Hero-Section mit großer Headline + Sub-Copy
//   • "Wusstest du schon?"-Section: horizontal scrollbare Pill-Cards
//     mit Emoji + Tipp-Text (Standard-Card-Pattern, fixe Breite)
//   • Pro Kategorie: Surface-Card mit
//       - getöntem 44×44 Icon-Kreis + Title + Description (Header)
//       - Bullet-Liste (farbiger 6px-Dot + Text)
//   • CTA am Ende: Brand-getönte Card mit großer Pill-Highlight
//   • Theme-Tokens via useTokens, Icons MDI

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { router, useNavigation } from 'expo-router';
import React, { useLayoutEffect } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DETAIL_HEADER_ROW_HEIGHT,
  DetailHeader,
} from '@/components/design/DetailHeader';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const QUICK_TIP_WIDTH = Math.round(SCREEN_WIDTH * 0.78);

// ────────────────────────────────────────────────────────────────────
// Inhalt — Quick Tips (horizontal swipe) + ausführliche Tipp-
// Kategorien. Identisch zum Legacy-Datensatz, nur die Icon-Strings
// auf MaterialCommunityIcons umgestellt.
// ────────────────────────────────────────────────────────────────────

type QuickTip = { emoji: string; text: string };
type TipCategory = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  iconColor: string;
  title: string;
  description: string;
  tips: string[];
};

const QUICK_TIPS: QuickTip[] = [
  {
    emoji: '🛒',
    text: 'Füge Produkte dem Einkaufszettel hinzu und markiere sie als gekauft.',
  },
  {
    emoji: '🛒',
    text: 'Nur gekaufte NoName-Produkte werden in der Ersparnis berücksichtigt.',
  },
  {
    emoji: '💰',
    text: 'Spare bis zu 200 € pro Monat als 2-Personen-Haushalt.',
  },
  {
    emoji: '🔍',
    text: 'Entdecke über 50.000 Produkte beim Stöbern.',
  },
  {
    emoji: '⚡',
    text: 'Enttarne täglich neue NoName-Alternativen zu Markenprodukten.',
  },
  {
    emoji: '🎯',
    text: 'Stufe 5 = identisches Produkt zum deutlich günstigeren Preis.',
  },
  {
    emoji: '📱',
    text: 'Nutze Barcodescanner und Stöbern für maximale Spar-Power.',
  },
];

const TIP_CATEGORIES: TipCategory[] = [
  {
    icon: 'magnify',
    iconColor: '#007AFF',
    title: 'Stöbern & Entdecken',
    description: 'Finde versteckte Schätze beim Einkaufen',
    tips: [
      'Nutze "Stöbern" täglich: Neue Produkte werden ständig hinzugefügt — verpasse keine Deals.',
      'Filtere nach deinen Lieblings-Märkten: Sieh nur Produkte, die du auch wirklich in deinem Supermarkt kaufen kannst.',
      'Durchstöbere alle Kategorien: Oft findest du Alternativen, wo du sie nicht erwartest.',
      'Schaue regelmäßig vorbei: Die besten NoName-Funde sind oft zeitlich begrenzt.',
      'Nutze die Suchfunktion: Tippe einfach ein, was du suchst — wir finden die günstigsten Alternativen.',
    ],
  },
  {
    icon: 'camera',
    iconColor: '#34C759',
    title: 'Scanner wie ein Profi nutzen',
    description: 'Maximal sparen durch cleveres Scannen',
    tips: [
      'Scanne ALLES, was dich interessiert: Auch Produkte, bei denen du denkst "das gibt es sicher nicht" — oft wirst du überrascht.',
      'Scanne im Gang: Direkt beim Einkaufen sehen, ob es günstigere Alternativen gibt.',
      'Scanne zu Hause: Checke deine Vorräte — welche Markenprodukte kannst du ersetzen?',
      'Scanne mit Freunden: Gemeinsam entdeckt ihr mehr Spar-Möglichkeiten.',
      'Scanne täglich: Je mehr du scannst, desto mehr Punkte und Belohnungen erhältst du.',
    ],
  },
  {
    icon: 'currency-eur',
    iconColor: '#FF9500',
    title: 'Geld sparen ohne Verzicht',
    description: 'So sparst du richtig viel Geld',
    tips: [
      'Starte mit den Basics: Reis, Nudeln, Mehl — hier sparst du sofort 50–70 % ohne Qualitätsverlust.',
      'Teste systematisch: Ersetze 1–2 Markenprodukte pro Woche durch NoName-Alternativen.',
      'Nutze die Stufen: Stufe 4–5 bedeutet oft identisches Produkt zum halben Preis.',
      'Schaue nach Aktionen: Manche NoName-Produkte sind zeitlich begrenzt besonders günstig.',
      'Dokumentiere deine Ersparnis: Markiere Produkte als gekauft — du wirst staunen, wie schnell sich das summiert.',
    ],
  },
  {
    icon: 'heart',
    iconColor: '#FF3B30',
    title: 'Favoriten sammeln',
    description: 'Sammle deine besten Funde',
    tips: [
      'Speichere Top-Funde: Jedes Produkt, das dich überzeugt, gehört in deine Favoriten.',
      'Teile Favoriten: Freunde und Familie profitieren von deinen Entdeckungen.',
      'Organisiere nach Kategorien: Sortiere deine Favoriten für schnelleren Überblick.',
      'Checke Favoriten regelmäßig: Preise und Verfügbarkeit ändern sich.',
      'Baue deine Sammlung auf: Je mehr Favoriten, desto günstiger wird dein Einkauf.',
    ],
  },
  {
    icon: 'star',
    iconColor: '#30D158',
    title: 'Level Up dein Sparverhalten',
    description: 'Werde zum Spar-Champion',
    tips: [
      'Sammle täglich Punkte: Login, Scannen, Stöbern — jede Aktion bringt dich weiter.',
      'Erreiche höhere Level: Mit jedem Level schaltest du neue Features und Belohnungen frei.',
      'Halte deine Streak: Tägliche Nutzung verdoppelt deine Punkte.',
      'Teile deine Erfolge: Zeig Freunden, wie viel du schon gespart hast.',
      'Nutze alle Features: Einkaufszettel, Favoriten, Scanner — alles bringt Punkte und Ersparnis.',
    ],
  },
  {
    icon: 'target',
    iconColor: '#AF52DE',
    title: 'Der Weg zu 200 € Ersparnis',
    description: 'So schaffst du es garantiert',
    tips: [
      'Woche 1–2: Scanne 10 Produkte täglich und ersetze die 5 besten Funde.',
      'Woche 3–4: Stöbere durch alle Kategorien und baue deine Favoriten-Liste auf.',
      'Monat 2: Nutze die Einkaufszettel-Funktion für organisiertes Spar-Shopping.',
      'Monat 3: Du bist jetzt Profi — 200 € weniger Ausgaben bei gleichem Einkaufserlebnis.',
      'Dauerhaft: Halte die App aktuell — neue Produkte bedeuten neue Spar-Chancen.',
    ],
  },
];

// ────────────────────────────────────────────────────────────────────
// Screen
// ────────────────────────────────────────────────────────────────────

export default function TippsUndTricksScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { theme, brand, shadows } = useTokens();

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const chromeHeight = insets.top + DETAIL_HEADER_ROW_HEIGHT;

  const goExplore = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(tabs)/explore' as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: chromeHeight + 18,
          paddingBottom: insets.bottom + 32,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Hero ─────────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 26,
              lineHeight: 30,
              color: theme.text,
              letterSpacing: -0.4,
              textAlign: 'center',
            }}
          >
            Spare bis zu 200 € pro Monat
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 14,
              lineHeight: 19,
              color: theme.textMuted,
              textAlign: 'center',
              marginTop: 8,
            }}
          >
            Entdecke versteckte Schätze beim Einkaufen
          </Text>
        </View>

        {/* ─── Wusstest du schon? — horizontal Quick-Tips ───────── */}
        <SectionHeader title="Wusstest du schon?" emoji="💡" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={QUICK_TIP_WIDTH + 10}
          snapToAlignment="start"
          contentContainerStyle={{
            paddingHorizontal: 20,
            gap: 10,
            paddingBottom: 8,
          }}
          style={{ marginBottom: 18 }}
        >
          {QUICK_TIPS.map((tip, i) => (
            <View
              key={i}
              style={{
                width: QUICK_TIP_WIDTH,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                backgroundColor: theme.surface,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: theme.border,
                ...shadows.sm,
              }}
            >
              <Text style={{ fontSize: 22 }}>{tip.emoji}</Text>
              <Text
                style={{
                  flex: 1,
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 13,
                  lineHeight: 17,
                  color: theme.text,
                }}
              >
                {tip.text}
              </Text>
            </View>
          ))}
        </ScrollView>

        {/* ─── Tipp-Kategorien (Surface-Cards) ──────────────────── */}
        <View style={{ paddingHorizontal: 20, gap: 14 }}>
          {TIP_CATEGORIES.map((cat, i) => (
            <TipCategoryCard key={i} category={cat} />
          ))}
        </View>

        {/* ─── CTA ─────────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 20, marginTop: 22 }}>
          <View
            style={{
              borderRadius: 18,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: brand.primary + '33',
              backgroundColor: brand.primary + '10',
              padding: 18,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                marginBottom: 12,
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: brand.primary + '22',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MaterialCommunityIcons
                  name="magnify"
                  size={22}
                  color={brand.primary}
                />
              </View>
              <Text
                style={{
                  flex: 1,
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 17,
                  color: theme.text,
                  letterSpacing: -0.2,
                }}
              >
                Jetzt gleich stöbern!
              </Text>
            </View>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.regular,
                fontSize: 13,
                lineHeight: 19,
                color: theme.text,
                marginBottom: 14,
              }}
            >
              Geh in den "Stöbern"-Tab und entdecke tausende NoName-
              Alternativen. Jede Minute Stöbern spart dir beim nächsten
              Einkauf bares Geld. Füge Produkte zu deinem Einkaufszettel
              und markiere sie nach dem Kauf — nur dann fließt deine
              Ersparnis korrekt in die Auswertung.
            </Text>

            {/* Highlight-Pill mit gradient — primärer Aufruf zum
                Aktiv-Werden. Tap navigiert zum Stöbern-Tab. */}
            <Pressable
              onPress={goExplore}
              style={({ pressed }) => ({
                borderRadius: radii.full,
                overflow: 'hidden',
                opacity: pressed ? 0.9 : 1,
              })}
            >
              <LinearGradient
                colors={[brand.primary, brand.primaryDark ?? brand.primary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  paddingHorizontal: 18,
                  paddingVertical: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                <Text
                  style={{
                    fontFamily,
                    fontWeight: fontWeight.extraBold,
                    fontSize: 14,
                    color: '#fff',
                    textAlign: 'center',
                    letterSpacing: 0.2,
                  }}
                >
                  🎯 Ziel: 200 € pro Monat sparen mit 10 Min/Tag
                </Text>
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={16}
                  color="#fff"
                />
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <DetailHeader title="Tipps & Tricks" onBack={() => router.back()} />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// SectionHeader — gleicher Typo-Stil wie Belohnungen / Errungenschaften.
// ────────────────────────────────────────────────────────────────────

function SectionHeader({
  title,
  emoji,
}: {
  title: string;
  emoji?: string;
}) {
  const { theme } = useTokens();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        paddingHorizontal: 20,
        marginBottom: 10,
        gap: 6,
      }}
    >
      {emoji ? (
        <Text style={{ fontSize: 18 }}>{emoji}</Text>
      ) : null}
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 20,
          color: theme.text,
          letterSpacing: -0.2,
        }}
      >
        {title}
      </Text>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────
// TipCategoryCard — Surface-Card mit Header (Icon-Kreis + Title +
// Description) und Bullet-Liste darunter.
// ────────────────────────────────────────────────────────────────────

function TipCategoryCard({ category }: { category: TipCategory }) {
  const { theme, shadows } = useTokens();
  const tint = category.iconColor;
  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.border,
        padding: 16,
        ...shadows.sm,
      }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          marginBottom: 14,
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: tint + '1A',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <MaterialCommunityIcons
            name={category.icon}
            size={24}
            color={tint}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 16,
              color: theme.text,
              letterSpacing: -0.2,
            }}
          >
            {category.title}
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.regular,
              fontSize: 12,
              lineHeight: 16,
              color: theme.textMuted,
              marginTop: 2,
            }}
          >
            {category.description}
          </Text>
        </View>
      </View>

      {/* Bullet-Liste — kleiner farbiger Dot pro Zeile, gleicher
          Tint wie der Icon-Kreis. Subtile Trennlinie per gap, kein
          Divider — bleibt visuell ruhig. */}
      <View style={{ gap: 12 }}>
        {category.tips.map((tip, i) => (
          <View
            key={i}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: tint,
                marginTop: 7,
                flexShrink: 0,
              }}
            />
            <Text
              style={{
                flex: 1,
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 13,
                lineHeight: 19,
                color: theme.text,
              }}
            >
              {tip}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
