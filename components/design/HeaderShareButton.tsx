import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { Platform, Pressable } from 'react-native';

/**
 * Teilen-Button für den DetailHeader-`right`-Slot — 40×40 wie der
 * Back-Button. Plattform-korrekte Icons (User-Vorgabe 2026-06: iOS =
 * share-outline/SF-Stil, Android = share-variant/Material) — gleiche
 * Fork wie der Einkaufszettel-Header.
 */
export function HeaderShareButton({ onPress, color }: { onPress: () => void; color: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Teilen"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {Platform.OS === 'ios' ? (
        <Ionicons name="share-outline" size={22} color={color} />
      ) : (
        <MaterialCommunityIcons name="share-variant" size={20} color={color} />
      )}
    </Pressable>
  );
}
