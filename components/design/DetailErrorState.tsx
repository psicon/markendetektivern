import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

/**
 * Fehler-/Offline-State der Produktdetail-Screens (2026-06-12,
 * User-Feedback 'beide Screens sind hässlich'). Ein gemeinsames,
 * design-system-konformes Layout fuer noname-detail und
 * product-comparison: getoenter Icon-Kreis, Titel + freundlicher
 * Subtext, Primary-Retry-Pill, Ghost-Zurueck.
 */
export function DetailErrorState({
  variant,
  onRetry,
  onBack,
}: {
  /** offline = kein Empfang, notFound = Produkt existiert nicht,
   *  generic = Laden fehlgeschlagen/zu langsam. */
  variant: 'offline' | 'notFound' | 'generic';
  onRetry: () => void;
  onBack: () => void;
}) {
  const { theme, brand } = useTokens();

  const meta =
    variant === 'offline'
      ? {
          icon: 'wifi-off' as const,
          title: 'Gerade kein Empfang',
          sub: 'Die Produktdaten konnten nicht geladen werden. Sobald du wieder Netz hast, klappt es sofort.',
        }
      : variant === 'notFound'
        ? {
            icon: 'magnify-close' as const,
            title: 'Produkt nicht gefunden',
            sub: 'Dieses Produkt ist nicht (mehr) in unserer Datenbank — vielleicht wurde es gerade überarbeitet.',
          }
        : {
            icon: 'cloud-alert' as const,
            title: 'Das hat nicht geklappt',
            sub: 'Das Laden dauert gerade ungewöhnlich lange. Ein neuer Versuch hilft meistens.',
          };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <View
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
        }}
      >
        <MaterialCommunityIcons name={meta.icon} size={34} color={brand.primary} />
      </View>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.extraBold,
          fontSize: 18,
          letterSpacing: -0.2,
          color: theme.text,
          textAlign: 'center',
        }}
      >
        {meta.title}
      </Text>
      <Text
        style={{
          fontFamily,
          fontWeight: fontWeight.medium,
          fontSize: 13,
          lineHeight: 19,
          color: theme.textSub,
          textAlign: 'center',
          marginTop: 8,
          maxWidth: 300,
        }}
      >
        {meta.sub}
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => ({
          marginTop: 22,
          height: 48,
          minWidth: 200,
          paddingHorizontal: 26,
          borderRadius: radii.full,
          backgroundColor: brand.primary,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.9 : 1,
        })}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.extraBold,
            fontSize: 15,
            color: '#fff',
          }}
        >
          Erneut versuchen
        </Text>
      </Pressable>
      <Pressable
        onPress={onBack}
        style={({ pressed }) => ({
          marginTop: 10,
          height: 44,
          paddingHorizontal: 22,
          borderRadius: radii.full,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.bold,
            fontSize: 14,
            color: theme.textSub,
          }}
        >
          Zurück
        </Text>
      </Pressable>
    </View>
  );
}
