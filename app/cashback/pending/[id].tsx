/**
 * Cashback Pending Screen — Phase 1.5 stub.
 *
 * Phase 2 will replace the placeholder content with a live Firestore-
 * snapshot listener on `/cashbacks/{id}` and an animated "wird geprüft"
 * loop. For now this just confirms the upload submission and offers
 * a way back to the rewards tab.
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import React, { useLayoutEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

export default function CashbackPendingScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { theme } = useTokens();

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  return (
    <View style={[styles.root, { backgroundColor: theme.background, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.center}>
        <View style={[styles.iconBubble, { backgroundColor: (theme.brandPrimary ?? '#0d8575') + '20' }]}>
          <MaterialCommunityIcons
            name="progress-clock"
            size={42}
            color={theme.brandPrimary ?? '#0d8575'}
          />
        </View>
        <Text style={[styles.title, { color: theme.textPrimary }]}>Bon eingereicht</Text>
        <Text style={[styles.body, { color: theme.textSecondary }]}>
          In Phase 2 prüfen wir hier deinen Bon und schreiben dir Cashback gut. Aktuell siehst du
          nur die ID — kein echter Backend-Aufruf.
        </Text>
        <View style={[styles.idPill, { backgroundColor: theme.surfaceAlt ?? 'rgba(0,0,0,0.05)' }]}>
          <MaterialCommunityIcons name="identifier" size={14} color={theme.textSecondary} />
          <Text style={[styles.idText, { color: theme.textSecondary }]}>{params.id ?? '—'}</Text>
        </View>
      </View>

      <Pressable
        onPress={() => router.replace('/(tabs)/rewards')}
        style={[styles.cta, { backgroundColor: theme.brandPrimary ?? '#0d8575' }]}
      >
        <Text style={styles.ctaText}>Zurück zu Cashback</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: 'space-between',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  iconBubble: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontFamily: fontFamily.heading,
    fontWeight: fontWeight.bold as any,
    fontSize: 22,
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  idPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: 6,
  },
  idText: {
    fontFamily: fontFamily.body,
    fontSize: 12,
  },
  cta: {
    height: 52,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#fff',
    fontFamily: fontFamily.body,
    fontWeight: fontWeight.bold as any,
    fontSize: 15,
  },
});
