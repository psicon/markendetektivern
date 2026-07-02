import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontFamily, fontWeight, radii } from '@/constants/tokens';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { SharedListService } from '@/lib/services/sharedListService';

/**
 * Deep-Link-Ziel für Einladungs-Links `markendetektive://join-list/<code>`
 * (Stufe 5). Ruft die joinSharedList-Callable, tritt der Liste bei und leitet
 * zur geteilten Liste weiter. Anonyme User werden zum Konto-Flow geführt
 * (Konto-Pflicht — kein anonymer Beitritt).
 */
export default function JoinListScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { theme, brand } = useTokens();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { user, userProfile, isAnonymous } = useAuth();

  // Nativen Stack-Header verstecken — sonst zeigt Expo-Router den rohen
  // Routen-Pfad „join-list/[code]" als Titel (User-Report 2026-07-02).
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const [state, setState] = useState<'joining' | 'need-account' | 'error'>('joining');
  const [errorMsg, setErrorMsg] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);
  const triedRef = useRef(false);

  useEffect(() => {
    const c = String(code || '').trim();
    if (!c) {
      setState('error');
      setErrorMsg('Dieser Einladungs-Link ist unvollständig.');
      return;
    }
    if (!user || isAnonymous) {
      setState('need-account');
      return;
    }
    if (triedRef.current) return;
    triedRef.current = true;
    setState('joining');
    (async () => {
      try {
        const myName =
          (userProfile as any)?.display_name || (user as any)?.displayName || '';
        const res = await SharedListService.joinViaCode(c, myName);
        if (res?.listId) {
          // Die geteilte Liste lebt IM Einkaufszettel (Stufe 5, kein
          // eigener Screen) — ?list= aktiviert sie dort direkt.
          router.replace(`/shopping-list?list=${res.listId}` as any);
        } else {
          setState('error');
          setErrorMsg('Der Beitritt hat nicht geklappt.');
        }
      } catch (e: any) {
        triedRef.current = false; // Retry erlauben
        setState('error');
        setErrorMsg(e?.message || 'Der Beitritt hat nicht geklappt.');
      }
    })();
  }, [code, user, isAnonymous, router, retryNonce]);

  const Center = ({ children }: { children: React.ReactNode }) => (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        paddingTop: insets.top + 32,
      }}
    >
      {children}
    </View>
  );

  const IconCircle = ({ name, color }: { name: any; color?: string }) => (
    <View
      style={{
        width: 76,
        height: 76,
        borderRadius: 38,
        backgroundColor: theme.primaryContainer ?? theme.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 18,
      }}
    >
      <MaterialCommunityIcons name={name} size={34} color={color ?? brand.primary} />
    </View>
  );

  const Title = ({ children }: { children: React.ReactNode }) => (
    <Text
      style={{
        fontFamily,
        fontWeight: fontWeight.extraBold,
        fontSize: 19,
        color: theme.text,
        textAlign: 'center',
        letterSpacing: -0.2,
      }}
    >
      {children}
    </Text>
  );

  const Sub = ({ children }: { children: React.ReactNode }) => (
    <Text
      style={{
        fontFamily,
        fontWeight: fontWeight.medium,
        fontSize: 14,
        lineHeight: 20,
        color: theme.textSub,
        textAlign: 'center',
        marginTop: 8,
        maxWidth: 320,
      }}
    >
      {children}
    </Text>
  );

  const PrimaryBtn = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        marginTop: 22,
        height: 48,
        minWidth: 200,
        paddingHorizontal: 26,
        borderRadius: radii.full,
        backgroundColor: brand.primary,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <Text style={{ fontFamily, fontWeight: fontWeight.extraBold, fontSize: 15, color: '#fff' }}>
        {label}
      </Text>
    </Pressable>
  );

  if (state === 'joining') {
    return (
      <Center>
        <IconCircle name="account-multiple-plus" />
        <Title>Du trittst der Liste bei …</Title>
        <ActivityIndicator style={{ marginTop: 18 }} color={brand.primary} />
      </Center>
    );
  }

  if (state === 'need-account') {
    return (
      <Center>
        <IconCircle name="account-plus" />
        <Title>Kurz ein Konto anlegen</Title>
        <Sub>
          Geteilte Listen brauchen ein kostenloses Konto — so weiß dein Haushalt,
          wer was hinzugefügt hat. Danach einfach den Einladungs-Link erneut öffnen.
        </Sub>
        <PrimaryBtn label="Konto anlegen" onPress={() => router.replace('/auth/welcome' as any)} />
        <Pressable onPress={() => router.replace('/(tabs)' as any)} style={{ marginTop: 10, padding: 10 }}>
          <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 14, color: theme.textSub }}>
            Später
          </Text>
        </Pressable>
      </Center>
    );
  }

  return (
    <Center>
      <IconCircle name="link-variant-off" color={theme.textMuted} />
      <Title>Beitritt nicht möglich</Title>
      <Sub>{errorMsg}</Sub>
      <PrimaryBtn
        label="Erneut versuchen"
        onPress={() => {
          triedRef.current = false;
          setState('joining');
          setRetryNonce((n) => n + 1);
        }}
      />
      <Pressable onPress={() => router.replace('/(tabs)' as any)} style={{ marginTop: 10, padding: 10 }}>
        <Text style={{ fontFamily, fontWeight: fontWeight.bold, fontSize: 14, color: theme.textSub }}>
          Zurück zur App
        </Text>
      </Pressable>
    </Center>
  );
}
