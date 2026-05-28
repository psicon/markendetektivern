/**
 * PrePermissionSheet — Erklärt dem User VOR dem System-Permission-Dialog
 * was er von Push-Benachrichtigungen erwarten kann. iOS / Android zeigen
 * den nativen Dialog nur EINMAL — wenn der User dort "Nicht erlauben"
 * tippt, muss er manuell in die System-Settings um's umzudrehen.
 * Deshalb diese Pre-Sheet als "Soft-Gate": User soll ja sagen bevor
 * wir den nativen Sheet triggern.
 *
 * Best Practice (Apple HIG / Google Material): erkläre VOR dem Sheet
 * was du sendest und warum's nützlich ist. Erhöht Permission-Grant-
 * Rate dramatisch (typisch +30-50 %).
 */

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FilterSheet } from '@/components/design/FilterSheet';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** User hat zugestimmt → System-Permission-Dialog triggern */
  onAllow: () => void;
  /** User möchte nicht — Sheet schließen, KEIN System-Dialog */
  onDecline?: () => void;
}

export function PrePermissionSheet({ visible, onClose, onAllow, onDecline }: Props) {
  const { theme, brand } = useTokens();
  const insets = useSafeAreaInsets();

  return (
    <FilterSheet visible={visible} onClose={onClose} title="Benachrichtigungen aktivieren">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      >
        {/* Header-Icon + Intro */}
        <View
          style={{
            alignItems: 'center',
            paddingTop: 4,
            paddingBottom: 16,
          }}
        >
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: brand.primary + '22',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
            }}
          >
            <MaterialCommunityIcons name="bell-ring" size={32} color={brand.primary} />
          </View>
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.extraBold,
              fontSize: 18,
              color: theme.text,
              textAlign: 'center',
              letterSpacing: -0.2,
            }}
          >
            Verpasse keinen Vorteil
          </Text>
          <Text
            style={{
              marginTop: 6,
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 13,
              color: theme.textSub,
              textAlign: 'center',
              lineHeight: 19,
              maxWidth: 280,
            }}
          >
            Wir benachrichtigen dich nur bei wirklich wichtigen Dingen — du
            kannst die Themen jederzeit in den Einstellungen anpassen.
          </Text>
        </View>

        {/* Was bekommst du */}
        <View
          style={{
            backgroundColor: theme.surface,
            borderRadius: radii.lg,
            padding: 14,
            borderWidth: 1,
            borderColor: theme.border,
            marginBottom: 14,
          }}
        >
          <BulletRow
            icon="cash-multiple"
            color={brand.primary}
            title="Cashback & Bon-Status"
            body="Wenn dein Bon akzeptiert wurde oder du eine Auszahlung anfordern kannst."
          />
          <Divider color={theme.border} />
          <BulletRow
            icon="cart-outline"
            color="#fb8c00"
            title="Lifecycle-Erinnerungen"
            body="Wenn du Produkte auf dem Zettel hast oder eine Streak läuft."
          />
          <Divider color={theme.border} />
          <BulletRow
            icon="tag-outline"
            color="#43a047"
            title="Preis-Drops bei Favoriten"
            body="Wenn ein Lieblingsprodukt günstiger wird."
          />
          <Divider color={theme.border} />
          <BulletRow
            icon="bullhorn-outline"
            color="#7e57c2"
            title="Aktionen & App-Hinweise"
            body="Neue Cashback-Aktionen und wichtige App-Updates."
          />
        </View>

        {/* Trust-Line */}
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 11,
            color: theme.textMuted,
            textAlign: 'center',
            lineHeight: 15,
            marginBottom: 16,
            paddingHorizontal: 8,
          }}
        >
          Keine Werbe-Spam. Max. 3 Nachrichten pro Tag. Ruhezeiten sind in
          deinen Einstellungen frei wählbar.
        </Text>

        {/* CTAs */}
        <Pressable
          onPress={() => {
            onAllow();
            onClose();
          }}
          style={({ pressed }) => ({
            height: 48,
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
              letterSpacing: 0.1,
            }}
          >
            Benachrichtigungen aktivieren
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            onDecline?.();
            onClose();
          }}
          style={{
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 8,
          }}
        >
          <Text
            style={{
              fontFamily,
              fontWeight: fontWeight.medium,
              fontSize: 13,
              color: theme.textMuted,
            }}
          >
            Vielleicht später
          </Text>
        </Pressable>
      </ScrollView>
    </FilterSheet>
  );
}

function BulletRow({
  icon,
  color,
  title,
  body,
}: {
  icon: any;
  color: string;
  title: string;
  body: string;
}) {
  const { theme } = useTokens();
  return (
    <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 10 }}>
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: color + '22',
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 2,
        }}
      >
        <MaterialCommunityIcons name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.bold as any,
            fontSize: 13,
            color: theme.text,
            letterSpacing: -0.1,
          }}
        >
          {title}
        </Text>
        <Text
          style={{
            marginTop: 2,
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 12,
            lineHeight: 17,
            color: theme.textSub,
          }}
        >
          {body}
        </Text>
      </View>
    </View>
  );
}

function Divider({ color }: { color: string }) {
  return <View style={{ height: 1, backgroundColor: color, marginVertical: 2 }} />;
}

export default PrePermissionSheet;
