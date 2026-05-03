import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { OptionList } from './FilterSheet';

type OptionsTuple<T extends string> = readonly [T, string];

type Props<T extends string> = {
  /** First option is always shown (e.g. the "Alle …" entry). */
  allOption: OptionsTuple<T>;
  /** Remaining options; will be filtered by the search query. */
  options: ReadonlyArray<OptionsTuple<T>>;
  value: T;
  onChange: (v: T) => void;
  renderLeading?: (k: T) => React.ReactNode;
  placeholder?: string;
  /** Maximum rows shown after the "all" option. Default 20. */
  maxVisible?: number;
};

/**
 * Long-list variant of OptionList with a built-in substring search and a
 * hard cap on visible rows. Used for the Marke / Handelsmarke pickers
 * where the full list can have hundreds of entries. Matching is
 * case-insensitive and locates the query anywhere in the label — so
 * "corn" and "orny" both find "Corny".
 */
export function SearchableOptionList<T extends string>({
  allOption,
  options,
  value,
  onChange,
  renderLeading,
  placeholder = 'Suchen …',
  maxVisible = 20,
}: Props<T>) {
  const { theme } = useTokens();
  const [query, setQuery] = useState('');

  const { visible, hiddenCount } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? options.filter(([, label]) => label.toLowerCase().includes(q))
      : options;
    const cap = filtered.slice(0, maxVisible);
    return {
      visible: cap,
      hiddenCount: Math.max(0, filtered.length - cap.length),
    };
  }, [options, query, maxVisible]);

  const combined: ReadonlyArray<OptionsTuple<T>> = useMemo(
    () => [allOption, ...visible] as ReadonlyArray<OptionsTuple<T>>,
    [allOption, visible],
  );

  return (
    <View>
      <View
        style={{
          height: 38,
          borderRadius: 11,
          backgroundColor: theme.surfaceAlt,
          borderWidth: 1,
          borderColor: theme.border,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <MaterialCommunityIcons name="magnify" size={16} color={theme.textMuted} />
        <TextInput
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          style={{
            flex: 1,
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 14,
            color: theme.text,
            paddingVertical: 0,
          }}
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={6}>
            <MaterialCommunityIcons name="close-circle" size={16} color={theme.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <OptionList
        value={value}
        options={combined}
        onChange={onChange}
        renderLeading={renderLeading}
      />

      {hiddenCount > 0 ? (
        <Text
          style={{
            fontFamily,
            fontWeight: fontWeight.medium,
            fontSize: 12,
            color: theme.textMuted,
            textAlign: 'center',
            marginTop: 14,
            marginBottom: 4,
          }}
        >
          +{hiddenCount} weitere — verfeinere die Suche
        </Text>
      ) : null}
    </View>
  );
}
