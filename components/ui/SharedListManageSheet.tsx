import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useMemo } from 'react';
import { Alert, Platform, Pressable, Share, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { FilterSheet } from '@/components/design/FilterSheet';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import {
  SharedListService,
  SHARED_LIST_MAX_MEMBERS,
  type SharedListDoc,
} from '@/lib/services/sharedListService';
import { showInfoToast } from '@/lib/services/ui/toast';

/**
 * Verwaltungs-Sheet einer geteilten Liste — lebt IM Einkaufszettel (kein
 * Screenwechsel, Stufe 5). Enthält: Einladen (QR + HTTPS-Link + System-Share),
 * Mitglieder (mit Entfernen für den Owner) und Verlassen.
 */
export function SharedListManageSheet({
  visible,
  onClose,
  list,
  myUid,
  onLeft,
}: {
  visible: boolean;
  onClose: () => void;
  list: SharedListDoc | null;
  myUid?: string;
  /** Nach Verlassen/Entfernt-werden — Parent schaltet zurück auf „Meine Liste". */
  onLeft: () => void;
}) {
  const { theme, brand } = useTokens();
  const isOwner = !!list && list.ownerId === myUid;
  const inviteLink = list?.inviteCode ? SharedListService.inviteLinkFor(list.inviteCode) : '';

  const memberEntries = useMemo(() => {
    if (!list) return [] as { uid: string; name: string; isOwner: boolean }[];
    return (list.memberIds || []).map((uid) => ({
      uid,
      name:
        list.memberNames?.[uid] ||
        (uid === list.ownerId ? list.ownerName || 'Ersteller' : 'Mitglied'),
      isOwner: uid === list.ownerId,
    }));
  }, [list]);

  const onShare = async () => {
    if (!inviteLink || !list) return;
    try {
      await Share.share({
        message: `Mach bei „${list.name}" mit — tritt meiner Einkaufsliste in MarkenDetektive bei:\n${inviteLink}`,
      });
    } catch {
      /* User hat abgebrochen */
    }
  };

  const onLeave = () => {
    if (!list) return;
    Alert.alert('Liste verlassen?', 'Du siehst die Liste danach nicht mehr.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Verlassen',
        style: 'destructive',
        onPress: async () => {
          try {
            await SharedListService.leaveList(list.id);
            onClose();
            onLeft();
          } catch {
            showInfoToast('Konnte die Liste nicht verlassen.', 'error');
          }
        },
      },
    ]);
  };

  const onRemoveMember = (uid: string, name: string) => {
    if (!list) return;
    Alert.alert(`${name} entfernen?`, undefined, [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Entfernen',
        style: 'destructive',
        onPress: () => {
          void SharedListService.removeMember(list.id, uid).catch(() =>
            showInfoToast('Konnte das Mitglied nicht entfernen.', 'error'),
          );
        },
      },
    ]);
  };

  return (
    <FilterSheet visible={visible} title={list?.name ?? 'Geteilte Liste'} onClose={onClose}>
      <View style={{ paddingBottom: 8, gap: 14 }}>
        {/* ── Einladen ── */}
        <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 13, lineHeight: 19, color: theme.textSub }}>
          Alle Mitglieder sehen und bearbeiten dieselbe Liste — in Echtzeit. Der
          Link ist 48 Stunden gültig (max. {SHARED_LIST_MAX_MEMBERS} Mitglieder).
        </Text>

        {inviteLink ? (
          <View style={{ alignItems: 'center' }}>
            {/* QR IMMER auf weißem Grund + dunkle Module — sonst nicht scanbar
                (v.a. im Dark-Mode). Inhalt ist die HTTPS-Join-Page (die iOS-
                Kamera öffnet keine Custom-Schemes aus QR-Codes). */}
            <View style={{ padding: 12, backgroundColor: '#fff', borderRadius: 16 }}>
              <QRCode value={inviteLink} size={148} backgroundColor="#ffffff" color="#191c1d" />
            </View>
            <Text style={{ fontFamily, fontWeight: fontWeight.semibold, fontSize: 12, color: theme.textMuted, marginTop: 8 }}>
              Mit der Kamera scannen, um beizutreten
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={onShare}
          style={({ pressed }) => ({
            backgroundColor: brand.primary,
            borderRadius: radii.md,
            paddingVertical: 13,
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

        {isOwner && list ? (
          <Pressable
            onPress={async () => {
              try {
                await SharedListService.rotateInvite(list.id);
                showInfoToast('Neuer Link erstellt.', 'success');
              } catch {
                showInfoToast('Konnte keinen neuen Link erstellen.', 'error');
              }
            }}
            style={{ alignItems: 'center', paddingVertical: 2 }}
          >
            <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 12, color: theme.textSub }}>
              Neuen Link erzeugen (alten ungültig machen)
            </Text>
          </Pressable>
        ) : null}

        {/* ── Mitglieder ── */}
        <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 2 }} />
        <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 12, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Mitglieder ({memberEntries.length})
        </Text>
        {memberEntries.map((m) => (
          <View key={m.uid} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}>
            <View
              style={{
                width: 34,
                height: 34,
                borderRadius: 17,
                backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 13, color: brand.primary }}>
                {(m.name || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 14, color: theme.text }}>
                {m.name}
                {m.uid === myUid ? ' (du)' : ''}
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
          style={({ pressed }) => ({ paddingVertical: 10, alignItems: 'center', opacity: pressed ? 0.7 : 1 })}
        >
          <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 14, color: '#e53935' }}>
            Liste verlassen
          </Text>
        </Pressable>
      </View>
    </FilterSheet>
  );
}
