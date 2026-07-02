import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRouter } from 'expo-router';
import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { FilterSheet } from '@/components/design/FilterSheet';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { SharedListService, type SharedListDoc } from '@/lib/services/sharedListService';
import { showInfoToast } from '@/lib/services/ui/toast';

/**
 * Übersicht der geteilten Einkaufszettel des Users (Stufe 5) — bewusst ein
 * eigener Screen, damit der persönliche shopping-list.tsx NICHT angefasst wird.
 */
export default function SharedListsScreen() {
  const { theme, brand } = useTokens();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { user, userProfile, isAnonymous } = useAuth();

  const [lists, setLists] = useState<SharedListDoc[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const myName = (userProfile as any)?.display_name || (user as any)?.displayName || 'Ich';

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    if (!user?.uid) {
      setLists([]);
      return;
    }
    const unsub = SharedListService.subscribeMySharedLists(user.uid, setLists);
    return unsub;
  }, [user?.uid]);

  const onStartCreate = () => {
    if (isAnonymous || !user) {
      showInfoToast('Für geteilte Listen brauchst du ein kostenloses Konto.', 'info');
      router.push('/auth/welcome' as any);
      return;
    }
    setNewName('');
    setCreateOpen(true);
  };

  const onCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const id = await SharedListService.createSharedList(newName, [], myName);
      setCreateOpen(false);
      router.push(`/shared-list/${id}` as any);
    } catch (e: any) {
      showInfoToast(e?.message === 'not-authenticated' ? 'Bitte zuerst anmelden.' : 'Konnte die Liste nicht erstellen.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const chromeHeight = insets.top + DETAIL_HEADER_ROW_HEIGHT;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: chromeHeight + 12,
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 32,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 13, lineHeight: 19, color: theme.textSub, marginBottom: 4 }}>
          Teile eine Liste mit Familie oder Freunden — alle sehen Änderungen in
          Echtzeit und ihr spart gemeinsam.
        </Text>

        <Pressable
          onPress={onStartCreate}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            backgroundColor: brand.primary,
            borderRadius: radii.lg,
            padding: 16,
            opacity: pressed ? 0.92 : 1,
          })}
        >
          <MaterialCommunityIcons name="plus-circle" size={22} color="#fff" />
          <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 15, color: '#fff' }}>
            Neue geteilte Liste
          </Text>
        </Pressable>

        {lists === null ? (
          <Text style={{ fontFamily, fontSize: 13, color: theme.textMuted, textAlign: 'center', paddingVertical: 24 }}>
            Lädt …
          </Text>
        ) : lists.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 40, gap: 8 }}>
            <MaterialCommunityIcons name="account-multiple-outline" size={44} color={theme.textMuted} />
            <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 15, color: theme.text }}>
              Noch keine geteilten Listen
            </Text>
            <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 13, color: theme.textMuted, textAlign: 'center', maxWidth: 280 }}>
              Erstelle eine oder tritt über einen Einladungs-Link bei.
            </Text>
          </View>
        ) : (
          lists.map((l) => (
            <Pressable
              key={l.id}
              onPress={() => router.push(`/shared-list/${l.id}` as any)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                backgroundColor: theme.surface,
                borderRadius: radii.lg,
                borderWidth: 1,
                borderColor: theme.border,
                padding: 14,
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
                <MaterialCommunityIcons name="cart-outline" size={22} color={brand.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 15, color: theme.text, letterSpacing: -0.2 }}>
                  {l.name}
                </Text>
                <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 12, color: theme.textMuted, marginTop: 2 }}>
                  {(l.memberIds?.length ?? 1)} {(l.memberIds?.length ?? 1) === 1 ? 'Mitglied' : 'Mitglieder'}
                  {l.ownerId === user?.uid ? ' · von dir' : l.ownerName ? ` · von ${l.ownerName}` : ''}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={theme.textMuted} />
            </Pressable>
          ))
        )}
      </ScrollView>

      <DetailHeader title="Geteilte Listen" onBack={() => router.back()} />

      <FilterSheet visible={createOpen} title="Neue Liste" onClose={() => setCreateOpen(false)}>
        <View style={{ paddingBottom: 8, gap: 14 }}>
          <View
            style={{
              height: 48,
              borderRadius: 12,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              paddingHorizontal: 14,
              justifyContent: 'center',
            }}
          >
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="z. B. Wocheneinkauf, WG, Familie …"
              placeholderTextColor={theme.textMuted}
              autoFocus
              onSubmitEditing={onCreate}
              returnKeyType="done"
              style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 15, color: theme.text, paddingVertical: 0 }}
            />
          </View>
          <Pressable
            onPress={onCreate}
            disabled={creating}
            style={({ pressed }) => ({
              backgroundColor: brand.primary,
              borderRadius: radii.md,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: pressed || creating ? 0.9 : 1,
            })}
          >
            <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 15, color: '#fff' }}>
              {creating ? 'Wird erstellt …' : 'Erstellen & teilen'}
            </Text>
          </Pressable>
        </View>
      </FilterSheet>
    </View>
  );
}
