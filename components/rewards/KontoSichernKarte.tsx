import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import React, { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { AuthRueckkehr } from '@/lib/services/authRueckkehr';

/**
 * „Erst einreichen, dann Konto" (Entscheidung 25.09.2026): Gäste sammeln
 * Belohnungen auf ihrer Gast-uid. Diese Karte lädt sie ein, ein Konto
 * anzulegen — ohne zu blockieren.
 *
 * Bewusst KEIN Modal (nie zwei Modals gleichzeitig, siehe sheetPresence.ts),
 * sondern eine Karte im Inhalt. Rendert nur für Gäste, sonst null.
 *
 * `ziel` = wohin es nach der Anmeldung zurückgeht (Whitelist in
 * AuthRueckkehr, anderes wird still ignoriert → dann wie bisher Home).
 */
export function KontoSichernKarte({ ziel }: { ziel: string }) {
  const { theme, shadows } = useTokens();
  const { isAnonymous } = useAuth();

  const kontoErstellen = useCallback(async () => {
    await AuthRueckkehr.merke(ziel);
    router.push('/auth/register');
  }, [ziel]);

  const anmelden = useCallback(async () => {
    await AuthRueckkehr.merke(ziel);
    router.push('/auth/login');
  }, [ziel]);

  if (!isAnonymous) return null;

  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: radii.lg - 2,
        borderWidth: 1,
        borderColor: theme.border,
        padding: 14,
        gap: 12,
        ...shadows.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: theme.primaryContainer,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <MaterialCommunityIcons name="shield-check-outline" size={22} color={theme.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold as any,
              fontSize: 15,
              letterSpacing: -0.2,
              color: theme.text,
            }}
          >
            Sichere dir deine Belohnung
          </Text>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium as any,
              fontSize: 12,
              lineHeight: 17,
              color: theme.textSub,
              marginTop: 2,
            }}
          >
            Mit einem kostenlosen Konto kannst du sie auszahlen – auch auf einem neuen Handy.
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Pressable
          accessibilityRole="button"
          onPress={kontoErstellen}
          style={({ pressed }) => ({
            height: 40,
            paddingHorizontal: 16,
            borderRadius: radii.md,
            backgroundColor: theme.primary,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Text
            style={{
              color: '#fff',
              fontFamily,
              fontWeight: fontWeight.bold as any,
              fontSize: 14,
            }}
          >
            Konto erstellen
          </Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={anmelden} hitSlop={8}>
          <Text
            style={{
              color: theme.primary,
              fontFamily,
              fontWeight: fontWeight.semibold as any,
              fontSize: 13,
            }}
          >
            Ich habe schon ein Konto
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
