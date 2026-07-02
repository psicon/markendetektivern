import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';

import { DetailHeader, DETAIL_HEADER_ROW_HEIGHT } from '@/components/design/DetailHeader';
import { FilterSheet } from '@/components/design/FilterSheet';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import {
  SharedListService,
  SHARED_LIST_MAX_MEMBERS,
  type SharedListDoc,
  type SharedListItem,
} from '@/lib/services/sharedListService';
import { showInfoToast } from '@/lib/services/ui/toast';

function formatEur(v: number): string {
  return `${v.toFixed(2).replace('.', ',')} €`;
}

export default function SharedListScreen() {
  const { id, share } = useLocalSearchParams<{ id: string; share?: string }>();
  const listId = String(id || '');
  const { theme, brand } = useTokens();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { user, userProfile } = useAuth();

  const [list, setList] = useState<SharedListDoc | null>(null);
  const [items, setItems] = useState<SharedListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [sheet, setSheet] = useState<null | 'share' | 'members'>(null);
  const [newItem, setNewItem] = useState('');

  const myName =
    (userProfile as any)?.display_name || (user as any)?.displayName || 'Ich';

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    if (!listId) return;
    let gotList = false;
    const u1 = SharedListService.subscribeSharedList(listId, (l) => {
      gotList = true;
      setList(l);
      setLoading(false);
      // null trotz Callback = existiert nicht / kein Zugriff.
      if (!l) setDenied(true);
    });
    const u2 = SharedListService.subscribeSharedListItems(listId, setItems);
    // Falls der Listener gar nicht feuert (permission-denied wirft im Error-Cb
    // → subscribe gibt [] / null), nach kurzer Zeit als "kein Zugriff" werten.
    const t = setTimeout(() => {
      if (!gotList) {
        setLoading(false);
        setDenied(true);
      }
    }, 4000);
    return () => {
      u1();
      u2();
      clearTimeout(t);
    };
  }, [listId]);

  // Direkt nach dem Erstellen (?share=1) das Teilen-Sheet automatisch öffnen —
  // einmalig, sobald die Liste geladen ist (dann steht der Invite-Link/QR bereit).
  const sharePromptedRef = useRef(false);
  useEffect(() => {
    if (share === '1' && list && !sharePromptedRef.current) {
      sharePromptedRef.current = true;
      setSheet('share');
    }
  }, [share, list]);

  const isOwner = !!list && list.ownerId === user?.uid;
  const openItems = useMemo(() => items.filter((i) => !i.gekauft), [items]);
  const doneItems = useMemo(() => items.filter((i) => i.gekauft), [items]);
  const gemeinsamGespart = useMemo(
    () =>
      items.reduce(
        (s, i) => s + (i.gekauft ? (i.savings ?? 0) * (i.anzahl ?? 1) : 0),
        0,
      ),
    [items],
  );

  const memberEntries = useMemo(() => {
    if (!list) return [] as { uid: string; name: string; isOwner: boolean }[];
    return (list.memberIds || []).map((uid) => ({
      uid,
      name: list.memberNames?.[uid] || (uid === list.ownerId ? list.ownerName || 'Owner' : 'Mitglied'),
      isOwner: uid === list.ownerId,
    }));
  }, [list]);

  const inviteLink = list?.inviteCode ? SharedListService.inviteLinkFor(list.inviteCode) : '';

  const onShare = async () => {
    if (!inviteLink) return;
    try {
      await Share.share({
        message: `Mach bei „${list?.name ?? 'unserer Liste'}" mit — tritt meiner Einkaufsliste in MarkenDetektive bei:\n${inviteLink}`,
      });
    } catch {
      /* User hat abgebrochen */
    }
  };

  const onAddItem = () => {
    const name = newItem.trim();
    if (!name || !list) return;
    SharedListService.addItem(listId, { name, kind: 'noname', anzahl: 1 }, myName);
    setNewItem('');
  };

  const onLeave = () => {
    Alert.alert('Liste verlassen?', 'Du siehst die Liste danach nicht mehr.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Verlassen',
        style: 'destructive',
        onPress: async () => {
          try {
            await SharedListService.leaveList(listId);
            router.back();
          } catch {
            showInfoToast('Konnte die Liste nicht verlassen.', 'error');
          }
        },
      },
    ]);
  };

  const onRemoveMember = (uid: string, name: string) => {
    Alert.alert(`${name} entfernen?`, undefined, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Entfernen',
        style: 'destructive',
        onPress: () => {
          void SharedListService.removeMember(listId, uid).catch(() =>
            showInfoToast('Konnte das Mitglied nicht entfernen.', 'error'),
          );
        },
      },
    ]);
  };

  const chromeHeight = insets.top + DETAIL_HEADER_ROW_HEIGHT;

  // — Fehler-/Zugriffszustand —
  if (denied && !list) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <DetailHeader title="Geteilte Liste" onBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <MaterialCommunityIcons name="lock-outline" size={44} color={theme.textMuted} />
          <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 17, color: theme.text, marginTop: 14, textAlign: 'center' }}>
            Diese Liste ist nicht verfügbar
          </Text>
          <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 13, lineHeight: 19, color: theme.textSub, marginTop: 8, textAlign: 'center', maxWidth: 300 }}>
            Vielleicht wurdest du entfernt, oder die Liste gibt es nicht mehr.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: chromeHeight + 8,
          paddingBottom: insets.bottom + 32,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Mitglieder + Gemeinsam-gespart */}
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          {/* Klare Kennzeichnung, dass dies eine GETEILTE (nicht die eigene) Liste ist. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <MaterialCommunityIcons name="account-multiple" size={14} color={brand.primary} />
            <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 11, letterSpacing: 0.8, color: brand.primary, textTransform: 'uppercase' }}>
              Geteilte Liste
            </Text>
          </View>
          <Pressable
            onPress={() => setSheet('members')}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <View style={{ flexDirection: 'row' }}>
              {memberEntries.slice(0, 4).map((m, i) => (
                <View
                  key={m.uid}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginLeft: i > 0 ? -8 : 0,
                    borderWidth: 2,
                    borderColor: theme.bg,
                  }}
                >
                  <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 12, color: brand.primary }}>
                    {(m.name || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
            <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 13, color: theme.textSub, flex: 1 }}>
              {memberEntries.length} {memberEntries.length === 1 ? 'Mitglied' : 'Mitglieder'} · verwalten
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={20} color={theme.textMuted} />
          </Pressable>

          {gemeinsamGespart > 0 ? (
            <View
              style={{
                backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
                borderRadius: radii.lg,
                padding: 14,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <MaterialCommunityIcons name="hand-heart-outline" size={22} color={brand.primary} />
              <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 14, color: theme.text, flex: 1 }}>
                Gemeinsam gespart:{' '}
                <Text style={{ fontWeight: fontWeight.extraBold, color: brand.primary }}>
                  {formatEur(gemeinsamGespart)}
                </Text>
              </Text>
            </View>
          ) : null}
        </View>

        {/* Item hinzufügen */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, marginTop: 16 }}>
          <View
            style={{
              flex: 1,
              height: 44,
              borderRadius: 12,
              backgroundColor: theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
              paddingHorizontal: 14,
              justifyContent: 'center',
            }}
          >
            <TextInput
              value={newItem}
              onChangeText={setNewItem}
              placeholder="Etwas hinzufügen …"
              placeholderTextColor={theme.textMuted}
              onSubmitEditing={onAddItem}
              returnKeyType="done"
              style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 15, color: theme.text, paddingVertical: 0 }}
            />
          </View>
          <Pressable
            onPress={onAddItem}
            disabled={newItem.trim().length === 0}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: newItem.trim().length === 0 ? theme.borderStrong : brand.primary,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <MaterialCommunityIcons name="plus" size={22} color="#fff" />
          </Pressable>
        </View>

        {/* Offene Items */}
        <View style={{ marginTop: 18, gap: 8, paddingHorizontal: 20 }}>
          {loading ? (
            <Text style={{ fontFamily, fontSize: 13, color: theme.textMuted, textAlign: 'center', paddingVertical: 24 }}>
              Lädt …
            </Text>
          ) : openItems.length === 0 && doneItems.length === 0 ? (
            <Text style={{ fontFamily, fontSize: 13, color: theme.textMuted, textAlign: 'center', paddingVertical: 24 }}>
              Noch nichts auf der Liste — füg oben etwas hinzu.
            </Text>
          ) : null}

          {openItems.map((it) => (
            <ItemRow
              key={it.id}
              item={it}
              theme={theme}
              brand={brand}
              onToggle={() => SharedListService.markItemPurchased(listId, it.id, true)}
              onRemove={() => SharedListService.removeItem(listId, it.id)}
            />
          ))}
        </View>

        {/* Erledigt */}
        {doneItems.length > 0 ? (
          <View style={{ marginTop: 22, gap: 8, paddingHorizontal: 20 }}>
            <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 12, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Erledigt ({doneItems.length})
            </Text>
            {doneItems.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                theme={theme}
                brand={brand}
                done
                onToggle={() => SharedListService.markItemPurchased(listId, it.id, false)}
                onRemove={() => SharedListService.removeItem(listId, it.id)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* Chrome */}
      <DetailHeader
        title={list?.name ?? 'Geteilte Liste'}
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={() => setSheet('share')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Teilen"
            style={({ pressed }) => ({
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            {Platform.OS === 'ios' ? (
              <Ionicons name="share-outline" size={22} color={theme.text} />
            ) : (
              <MaterialCommunityIcons name="share-variant" size={20} color={theme.text} />
            )}
          </Pressable>
        }
      />

      {/* Teilen-Sheet */}
      <FilterSheet visible={sheet === 'share'} title="Liste teilen" onClose={() => setSheet(null)}>
        <View style={{ paddingBottom: 8, gap: 14 }}>
          <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 14, lineHeight: 20, color: theme.textSub }}>
            Schick den Link an deine Familie oder Freunde. Wer beitritt, sieht die
            Liste in Echtzeit. Der Link ist 48 Stunden gültig (max. {SHARED_LIST_MAX_MEMBERS} Mitglieder).
          </Text>
          {inviteLink ? (
            <View style={{ alignItems: 'center', paddingVertical: 2 }}>
              {/* QR IMMER auf weißem Grund + dunkle Module — sonst nicht scanbar
                  (v.a. im Dark-Mode). */}
              <View style={{ padding: 14, backgroundColor: '#fff', borderRadius: 18 }}>
                <QRCode value={inviteLink} size={172} backgroundColor="#ffffff" color="#191c1d" />
              </View>
              <Text style={{ fontFamily, fontWeight: fontWeight.semibold, fontSize: 12, color: theme.textMuted, marginTop: 10 }}>
                Zum Beitreten scannen
              </Text>
            </View>
          ) : null}
          <View style={{ backgroundColor: theme.surfaceAlt, borderRadius: 12, padding: 12 }}>
            <Text numberOfLines={1} style={{ fontFamily, fontSize: 13, color: theme.textSub }}>
              {inviteLink || '—'}
            </Text>
          </View>
          <Pressable
            onPress={onShare}
            style={({ pressed }) => ({
              backgroundColor: brand.primary,
              borderRadius: radii.md,
              paddingVertical: 14,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 8,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            {Platform.OS === 'ios' ? (
              <Ionicons name="share-outline" size={18} color="#fff" />
            ) : (
              <MaterialCommunityIcons name="share-variant" size={18} color="#fff" />
            )}
            <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 15, color: '#fff' }}>
              Einladungs-Link teilen
            </Text>
          </Pressable>
          {isOwner ? (
            <Pressable
              onPress={async () => {
                try {
                  await SharedListService.rotateInvite(listId);
                  showInfoToast('Neuer Link erstellt.', 'success');
                } catch {
                  showInfoToast('Konnte keinen neuen Link erstellen.', 'error');
                }
              }}
              style={{ alignItems: 'center', paddingVertical: 8 }}
            >
              <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 13, color: theme.textSub }}>
                Neuen Link erzeugen (alten ungültig machen)
              </Text>
            </Pressable>
          ) : null}
        </View>
      </FilterSheet>

      {/* Mitglieder-Sheet */}
      <FilterSheet visible={sheet === 'members'} title="Mitglieder" onClose={() => setSheet(null)}>
        <View style={{ paddingBottom: 8, gap: 6 }}>
          {memberEntries.map((m) => (
            <View
              key={m.uid}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 14, color: brand.primary }}>
                  {(m.name || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 15, color: theme.text }}>
                  {m.name}
                  {m.uid === user?.uid ? ' (du)' : ''}
                </Text>
                {m.isOwner ? (
                  <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 11, color: theme.textMuted }}>
                    Ersteller
                  </Text>
                ) : null}
              </View>
              {isOwner && !m.isOwner ? (
                <Pressable onPress={() => onRemoveMember(m.uid, m.name)} hitSlop={8} style={{ padding: 4 }}>
                  <MaterialCommunityIcons name="close-circle-outline" size={22} color={theme.textMuted} />
                </Pressable>
              ) : null}
            </View>
          ))}

          <Pressable
            onPress={onLeave}
            style={({ pressed }) => ({ marginTop: 8, paddingVertical: 12, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 14, color: '#e53935' }}>
              Liste verlassen
            </Text>
          </Pressable>
        </View>
      </FilterSheet>
    </View>
  );
}

function ItemRow({
  item,
  theme,
  brand,
  done,
  onToggle,
  onRemove,
}: {
  item: SharedListItem;
  theme: any;
  brand: any;
  done?: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: theme.surface,
        borderRadius: radii.lg,
        borderWidth: 1,
        borderColor: theme.border,
        paddingHorizontal: 14,
        paddingVertical: 12,
        opacity: done ? 0.6 : 1,
      }}
    >
      <Pressable onPress={onToggle} hitSlop={8}>
        <MaterialCommunityIcons
          name={done ? 'check-circle' : 'checkbox-blank-circle-outline'}
          size={24}
          color={done ? brand.primary : theme.textMuted}
        />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{
            fontFamily,
            fontWeight: fontWeight.semibold,
            fontSize: 15,
            color: theme.text,
            textDecorationLine: done ? 'line-through' : 'none',
          }}
        >
          {(item.anzahl ?? 1) > 1 ? `${item.anzahl}× ` : ''}
          {item.name}
        </Text>
        {item.addedByName ? (
          <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 11, color: theme.textMuted, marginTop: 1 }}>
            von {item.addedByName}
            {item.marketName ? ` · ${item.marketName}` : ''}
          </Text>
        ) : null}
      </View>
      <Pressable onPress={onRemove} hitSlop={8} style={{ padding: 2 }}>
        <MaterialCommunityIcons name="trash-can-outline" size={20} color={theme.textMuted} />
      </Pressable>
    </View>
  );
}
