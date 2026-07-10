import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, Share, Text, TextInput, View } from 'react-native';
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

  // ── Ablauf-Status des Einladungs-Links (User-Report 2026-07: das Sheet
  // zeigte den alten QR-Code auch nach Ablauf des 48h-Fensters weiter an —
  // Scans liefen dann in „Einladung abgelaufen"). inviteExpiresAt kommt als
  // Firestore-Timestamp (Subscription) oder Date (direkt nach lokalem Write)
  // — defensiv in Millis wandeln. Fehlender Wert = kein Ablauf, konsistent
  // mit der Join-CF (prüft expMs=0 nicht); betrifft nur Alt-Listen.
  const inviteExpMs = useMemo(() => {
    const v: any = list?.inviteExpiresAt;
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    return 0;
  }, [list?.inviteExpiresAt]);
  // Zur Render-Zeit bewertet — jedes Öffnen des Sheets rendert frisch. Für
  // den Randfall „Sheet offen, während der Link abläuft" prüft onShare
  // zusätzlich zur Tap-Zeit.
  const inviteExpired = !!inviteLink && inviteExpMs > 0 && inviteExpMs <= Date.now();
  const inviteHoursLeft =
    !inviteExpired && inviteExpMs > 0
      ? Math.max(1, Math.ceil((inviteExpMs - Date.now()) / 3_600_000))
      : null;

  // Neuen Code erzeugen (Owner) — gemeinsamer Handler für den prominenten
  // Abgelaufen-Button und den kleinen „Neuen Link erzeugen"-Link. Nach dem
  // Write liefert die Live-Subscription das Listen-Doc mit neuem Code +
  // Fenster → QR/Code aktualisieren sich von selbst.
  const [rotating, setRotating] = useState(false);
  const onRotate = async () => {
    if (!list || rotating) return;
    setRotating(true);
    try {
      await SharedListService.rotateInvite(list.id);
      showInfoToast('Neuer Link erstellt — 48 Stunden gültig.', 'success');
    } catch {
      showInfoToast('Konnte keinen neuen Link erstellen.', 'error');
    } finally {
      setRotating(false);
    }
  };

  // ─── Umbenennen (Owner) ───
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  useEffect(() => {
    // Draft zurücksetzen, wenn Sheet (neu) geöffnet oder Liste gewechselt wird.
    if (visible) {
      setEditingName(false);
      setNameDraft(list?.name ?? '');
    }
  }, [visible, list?.id, list?.name]);

  const onSaveName = async () => {
    if (!list) return;
    const next = nameDraft.trim();
    if (!next || next === list.name) {
      setEditingName(false);
      return;
    }
    try {
      await SharedListService.rename(list.id, next);
      setEditingName(false);
      showInfoToast('Liste umbenannt.', 'success');
    } catch {
      showInfoToast('Konnte die Liste nicht umbenennen.', 'error');
    }
  };

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
    // Tap-Zeit-Check: das Sheet kann offen bleiben, während das 48h-Fenster
    // abläuft — dann keinen toten Link mehr verschicken.
    if (inviteExpMs > 0 && inviteExpMs <= Date.now()) {
      showInfoToast(
        isOwner
          ? 'Der Link ist abgelaufen — erstelle unten einen neuen.'
          : 'Der Link ist abgelaufen — der Ersteller kann einen neuen erstellen.',
        'info',
      );
      return;
    }
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
        {/* ── Umbenennen (Owner) ── */}
        {isOwner ? (
          editingName ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
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
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  placeholder="Name der Liste"
                  placeholderTextColor={theme.textMuted}
                  autoFocus
                  maxLength={40}
                  onSubmitEditing={onSaveName}
                  returnKeyType="done"
                  style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 15, color: theme.text, paddingVertical: 0 }}
                />
              </View>
              <Pressable
                onPress={onSaveName}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: brand.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <MaterialCommunityIcons name="check" size={22} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => setEditingName(true)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <MaterialCommunityIcons name="pencil-outline" size={16} color={theme.textSub} />
              <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 13, color: theme.textSub }}>
                Liste umbenennen
              </Text>
            </Pressable>
          )
        ) : null}

        {/* ── Einladen ── */}
        <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 13, lineHeight: 19, color: theme.textSub }}>
          Alle Mitglieder sehen und bearbeiten dieselbe Liste — in Echtzeit. Der
          Link ist 48 Stunden gültig (max. {SHARED_LIST_MAX_MEMBERS} Mitglieder).
        </Text>

        {inviteLink && inviteExpired ? (
          // ── Link abgelaufen: KEIN toter QR mehr (User-Report 2026-07).
          // Neuer Link nur auf Anforderung — Owner per Button, Mitglieder
          // sehen, wen sie fragen können. Liste + Mitglieder bleiben
          // unberührt, nur der Einladungs-Code ist rotierbar.
          <View
            style={{
              alignItems: 'center',
              gap: 10,
              paddingVertical: 18,
              paddingHorizontal: 16,
              borderRadius: 16,
              backgroundColor: theme.surfaceAlt,
            }}
          >
            <MaterialCommunityIcons name="timer-off-outline" size={28} color={theme.textMuted} />
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.bold,
                fontSize: 14,
                color: theme.text,
                textAlign: 'center',
              }}
            >
              Der Einladungs-Link ist abgelaufen
            </Text>
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.medium,
                fontSize: 12,
                lineHeight: 18,
                color: theme.textSub,
                textAlign: 'center',
              }}
            >
              {isOwner
                ? 'Erstelle mit einem Tipp einen neuen — an der Liste und den Mitgliedern ändert sich nichts.'
                : `${list?.ownerName || 'Der Ersteller'} kann hier jederzeit einen neuen erstellen — an der Liste ändert sich nichts.`}
            </Text>
            {isOwner ? (
              <Pressable
                onPress={onRotate}
                disabled={rotating}
                style={({ pressed }) => ({
                  marginTop: 4,
                  backgroundColor: brand.primary,
                  borderRadius: radii.md,
                  paddingVertical: 12,
                  paddingHorizontal: 22,
                  alignItems: 'center',
                  flexDirection: 'row',
                  gap: 8,
                  opacity: pressed || rotating ? 0.85 : 1,
                })}
              >
                <MaterialCommunityIcons name="qrcode-plus" size={18} color="#fff" />
                <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 14, color: '#fff' }}>
                  {rotating ? 'Wird erstellt …' : 'Neuen Link erstellen'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {inviteLink && !inviteExpired ? (
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
            {/* Einladungs-Code zum Vorlesen/Weitergeben — Gegenstück zur
                Code-Eingabe im Beitreten-Scanner. Reine Anzeige (Teilen macht
                der Link-Button darunter). */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                marginTop: 8,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: radii.md,
                backgroundColor: theme.surfaceAlt,
              }}
            >
              <Text style={{ fontFamily, fontWeight: fontWeight.medium, fontSize: 12, color: theme.textMuted }}>
                Code:
              </Text>
              <Text
                selectable
                style={{
                  fontFamily,
                  fontWeight: fontWeight.extraBold,
                  fontSize: 14,
                  letterSpacing: 1.2,
                  color: theme.text,
                }}
              >
                {list?.inviteCode ?? ''}
              </Text>
            </View>
            {inviteHoursLeft !== null ? (
              <Text
                style={{
                  fontFamily,
                  fontWeight: fontWeight.medium,
                  fontSize: 11,
                  color: theme.textMuted,
                  marginTop: 6,
                }}
              >
                Noch ca. {inviteHoursLeft} Std. gültig
              </Text>
            ) : null}
          </View>
        ) : null}

        {!inviteExpired ? (
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
        ) : null}

        {isOwner && list && !inviteExpired ? (
          <Pressable onPress={onRotate} disabled={rotating} style={{ alignItems: 'center', paddingVertical: 2 }}>
            <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 12, color: theme.textSub }}>
              {rotating ? 'Neuer Link wird erstellt …' : 'Neuen Link erzeugen (alten ungültig machen)'}
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
