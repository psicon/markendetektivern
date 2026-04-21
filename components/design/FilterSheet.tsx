import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  children?: React.ReactNode;
  /** Max height as a fraction of the screen (0-1). Default 0.78. */
  maxHeightRatio?: number;
};

/**
 * Bottom sheet used for filter pickers in Stöbern. Simple native `Modal`-backed
 * sheet with backdrop tap-to-dismiss, drag handle, title row, and scrollable
 * content area. Not as fancy as @gorhom/bottom-sheet but far simpler and works
 * without deep integration into the gesture handler tree.
 */
export function FilterSheet({ visible, title, onClose, children, maxHeightRatio = 0.78 }: Props) {
  const { theme } = useTokens();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: theme.overlay,
          justifyContent: 'flex-end',
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: theme.surface,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingTop: 10,
            paddingBottom: Math.max(28, insets.bottom + 16),
            maxHeight: `${maxHeightRatio * 100}%` as any,
          }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: theme.border,
              alignSelf: 'center',
              marginBottom: 14,
            }}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 20,
              marginBottom: 14,
            }}
          >
            <Text
              style={{
                fontFamily,
                fontWeight: fontWeight.extraBold,
                fontSize: 18,
                color: theme.text,
              }}
            >
              {title}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <MaterialCommunityIcons name="close" size={20} color={theme.textMuted} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 20 }}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Option list — used inside FilterSheet for radio-style pickers ─────────
type OptionListProps<T extends string> = {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  renderLeading?: (key: T) => React.ReactNode;
};

export function OptionList<T extends string>({ value, options, onChange, renderLeading }: OptionListProps<T>) {
  const { theme, brand } = useTokens();

  return (
    <View>
      {options.map(([k, label], i) => {
        const on = value === k;
        const last = i === options.length - 1;
        return (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            style={({ pressed }) => ({
              height: 54,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 4,
              borderBottomWidth: last ? 0 : 1,
              borderBottomColor: theme.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            {renderLeading ? renderLeading(k) : null}
            <Text
              style={{
                flex: 1,
                fontFamily,
                fontWeight: on ? fontWeight.bold : fontWeight.medium,
                fontSize: 15,
                color: on ? brand.primary : theme.text,
              }}
              numberOfLines={1}
            >
              {label}
            </Text>
            {on ? (
              <MaterialCommunityIcons name="check-circle" size={22} color={brand.primary} />
            ) : (
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  borderWidth: 1.5,
                  borderColor: theme.borderStrong,
                }}
              />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
