/**
 * AuthMethodButtons — wiederverwendbare 3-Button-Reihe für die Auth-
 * Screens (Welcome, Register, Login).
 *
 * Best-Practice-Pattern aus 2026:
 *   • iOS  : Apple (primary, App-Store-Pflicht), Email, Facebook
 *   • Android: Google (primary), Email, Facebook
 *
 * Apple/Google sind die platform-native Primary-Buttons.
 * Email öffnet je nach Screen das Register- oder Login-Form.
 * Facebook ist UI-fertig — Handler zeigt aktuell Coming-Soon-Toast
 * (react-native-fbsdk-next ist nicht installiert; Setup als
 * separater EAS-Build-Task).
 *
 * Props:
 *   - mode: 'register' | 'login' — beeinflusst nur die Labels
 *     ("Mit Apple registrieren" vs "Mit Apple anmelden")
 *   - onApple, onGoogle, onEmail: Handler vom Eltern-Screen
 *   - busy: disabled all buttons during auth in flight
 *   - colorScheme: für Dark-Mode-Adaption (sonst light)
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { Colors } from '@/constants/Colors';
import { showInfoToast } from '@/lib/services/ui/toast';

type Mode = 'register' | 'login';

interface Props {
  mode: Mode;
  onApple: () => void;
  onGoogle: () => void;
  onEmail?: () => void;
  /** Optional: Email-Button ausblenden (z.B. auf dem Login-Screen
   *  wenn die Email-Form schon sichtbar ist — sonst redundant). */
  showEmailButton?: boolean;
  /** Optional: Trust-Hint ausblenden wenn er separat dargestellt
   *  wird oder im Layout-Flow nicht passt. */
  showTrustHint?: boolean;
  /** Identifier-First-Modus: zeigt BEIDE Plattform-Buttons (Apple +
   *  Google) als Alternative neben Facebook. Default false → nur der
   *  Plattform-Primary (Apple iOS / Google Android). */
  showAllProviders?: boolean;
  busy?: boolean;
  colorScheme: 'light' | 'dark' | null | undefined;
}

export function AuthMethodButtons({
  mode,
  onApple,
  onGoogle,
  onEmail,
  showEmailButton = true,
  showTrustHint = true,
  showAllProviders = false,
  busy = false,
  colorScheme,
}: Props) {
  const styles = createStyles(colorScheme);
  const isDark = colorScheme === 'dark';
  const verb = mode === 'register' ? 'registrieren' : 'anmelden';
  const emailVerb = mode === 'register' ? 'Mit E-Mail registrieren' : 'Mit E-Mail anmelden';

  // Apple-Button als JSX (in showAllProviders-Modus beide Plattform-
  // Primary-Buttons gleichzeitig nötig).
  const appleButton = (
    <Pressable
      onPress={onApple}
      disabled={busy}
      style={({ pressed }) => [
        styles.btnBase,
        styles.btnApple,
        (pressed || busy) && styles.btnPressed,
      ]}
    >
      <IconSymbol name="apple.logo" size={20} color="white" />
      <Text style={[styles.btnText, styles.btnTextWhite]}>
        Mit Apple {verb}
      </Text>
    </Pressable>
  );

  const googleButton = (
    <Pressable
      onPress={onGoogle}
      disabled={busy}
      style={({ pressed }) => [
        styles.btnBase,
        styles.btnGoogle,
        (pressed || busy) && styles.btnPressed,
      ]}
    >
      <View style={styles.googleIconWrapper}>
        <Text style={styles.googleG}>G</Text>
      </View>
      <Text style={[styles.btnText, styles.btnTextDark]}>
        Mit Google {verb}
      </Text>
    </Pressable>
  );

  // Facebook-Handler — UI fertig, Native-SDK fehlt.
  // TODO Folge-Task: react-native-fbsdk-next + FB-App-ID +
  // signInWithFacebook() im AuthContext implementieren.
  const onFacebookPlaceholder = () => {
    showInfoToast(
      'Facebook-Anmeldung kommt bald — bitte nutze Apple oder E-Mail.',
      'info',
      colorScheme ?? 'light',
    );
  };

  return (
    <View style={styles.container}>
      {/* Platform-Primary Button */}
      {Platform.OS === 'ios' ? appleButton : googleButton}

      {/* showAllProviders: zweiter Plattform-Button als gleichwertige
          Alternative (Identifier-First-Pattern wie TheFork/Uber/Linear). */}
      {showAllProviders && (Platform.OS === 'ios' ? googleButton : appleButton)}

      {/* E-Mail (primary brand color) — optional ausblendbar */}
      {showEmailButton && onEmail && (
        <Pressable
          onPress={onEmail}
          disabled={busy}
          style={({ pressed }) => [
            styles.btnBase,
            styles.btnEmail,
            (pressed || busy) && styles.btnPressed,
          ]}
        >
          <IconSymbol name="envelope" size={20} color="white" />
          <Text style={[styles.btnText, styles.btnTextWhite]}>{emailVerb}</Text>
        </Pressable>
      )}

      {/* Facebook — UI fertig, Handler placeholder */}
      <Pressable
        onPress={onFacebookPlaceholder}
        disabled={busy}
        style={({ pressed }) => [
          styles.btnBase,
          styles.btnFacebook,
          (pressed || busy) && styles.btnPressed,
        ]}
      >
        <Text style={[styles.fbF]}>f</Text>
        <Text style={[styles.btnText, styles.btnTextWhite]}>
          Mit Facebook {verb}
        </Text>
      </Pressable>

      {/* Trust-Hint — optional ausblendbar. */}
      {showTrustHint && (
        <View style={styles.trustRow}>
          <Text style={[styles.trustText, { color: isDark ? Colors.dark.text : '#fff' }]}>
            🔒 DSGVO-konform · Server in der EU · Jederzeit löschbar
          </Text>
        </View>
      )}
    </View>
  );
}

function createStyles(_colorScheme: 'light' | 'dark' | null | undefined) {
  return StyleSheet.create({
    container: {
      gap: 10,
    },
    btnBase: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 52,
      borderRadius: 14,
      gap: 12,
      paddingHorizontal: 16,
    },
    btnPressed: {
      opacity: 0.85,
    },
    btnApple: {
      backgroundColor: '#000',
    },
    btnGoogle: {
      backgroundColor: '#fff',
    },
    btnEmail: {
      backgroundColor: Colors.light.tint,
    },
    btnFacebook: {
      backgroundColor: '#1877F2',
    },
    btnText: {
      fontSize: 16,
      fontFamily: 'Nunito_600SemiBold',
      letterSpacing: -0.2,
    },
    btnTextWhite: {
      color: '#fff',
    },
    btnTextDark: {
      color: '#1c1c1e',
    },
    googleIconWrapper: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: '#fff',
      alignItems: 'center',
      justifyContent: 'center',
    },
    googleG: {
      fontSize: 16,
      fontFamily: 'Nunito_700Bold',
      color: '#4285F4',
    },
    fbF: {
      fontSize: 22,
      fontFamily: 'Nunito_700Bold',
      color: '#fff',
      width: 22,
      textAlign: 'center',
      lineHeight: 24,
    },
    trustRow: {
      marginTop: 6,
      paddingHorizontal: 4,
    },
    trustText: {
      fontSize: 11,
      fontFamily: 'Nunito_500Medium',
      textAlign: 'center',
      opacity: 0.7,
      lineHeight: 15,
    },
  });
}
