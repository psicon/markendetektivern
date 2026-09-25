import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FilterSheet } from '@/components/design/FilterSheet';
import { fontFamily, fontWeight } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTokens } from '@/hooks/useTokens';
import { useAuth } from '@/lib/contexts/AuthContext';
import { auth } from '@/lib/firebase';
import { AuthRueckkehr } from '@/lib/services/authRueckkehr';
import { whenSheetsIdle } from '@/lib/services/sheetPresence';
import { showInfoToast } from '@/lib/services/ui/toast';
import { erwarteterAuthFehler } from '@/lib/utils/authFehler';

/**
 * ClickUp 86cacp92p (1.19): Geführtes Facebook ↔ E-Mail/Passwort-Linking.
 *
 * Erscheint global, wenn der Facebook-Login auf ein bestehendes E-Mail/
 * Passwort-Konto trifft (gleiche E-Mail). Silent linking ist per Firebase
 * nicht möglich (das Bestandskonto muss re-authentifiziert werden), darum:
 * der User loggt sich EINMAL mit seinem Passwort ein → danach verknüpft der
 * Context das FB-Credential mit dem Konto, und künftige Facebook-Logins
 * funktionieren. Wird einmal global gerendert (siehe app/_layout.tsx).
 */
export function FacebookLinkSheet() {
  const { brand, theme } = useTokens();
  const scheme = useColorScheme();
  const { facebookLinkPrompt, completeFacebookLink, cancelFacebookLink } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const visible = !!facebookLinkPrompt;
  const email = facebookLinkPrompt?.email ?? '';

  // Passwortfeld leeren, sobald das Sheet auf-/zugeht (kein Rest zwischen Versuchen).
  useEffect(() => {
    if (!visible) setPassword('');
  }, [visible]);

  const handleSubmit = async () => {
    if (busy || password.length === 0) return;
    setBusy(true);
    const vorherUid = auth.currentUser?.uid ?? null;
    try {
      await completeFacebookLink(password);
      showInfoToast(
        'Facebook ist jetzt mit deinem Konto verbunden — du kannst dich künftig mit Facebook anmelden.',
        'info',
        scheme ?? undefined,
      );
      // facebookLinkPrompt wird vom Context auf null gesetzt → Sheet schließt.
      // Hat die Anmeldung das Konto gewechselt, gilt derselbe Abschluss wie
      // auf allen anderen Anmeldewegen (Ziel, Stapel aufräumen) — sonst blieb
      // man als Kontoinhaber auf dem Anmelde-Screen, und „Zurück" führte auf
      // eine Seite der alten uid (Nachprüfung Runde 2). Erst navigieren, wenn
      // das Sheet zu ist.
      if (auth.currentUser && auth.currentUser.uid !== vorherUid) {
        whenSheetsIdle(() => {
          void AuthRueckkehr.abschliessen(router).catch((err) =>
            console.warn('[FacebookLinkSheet] Rücksprung fehlgeschlagen:', err?.message),
          );
        });
      }
    } catch (e: any) {
      // Abbruch im Mitnahme-Dialog oder fehlende Verbindung beim Wechsel in
      // ein bestehendes Konto sind keine Fehler (lib/utils/authFehler.ts).
      if (erwarteterAuthFehler(e, scheme)) return;
      const code = e?.code;
      const msg =
        code === 'auth/wrong-password' || code === 'auth/invalid-credential'
          ? 'Passwort stimmt nicht. Bitte erneut versuchen.'
          : code === 'auth/too-many-requests'
            ? 'Zu viele Versuche. Bitte kurz warten und erneut probieren.'
            : 'Anmeldung hat nicht geklappt. Bitte erneut versuchen.';
      showInfoToast(msg, 'error', scheme ?? undefined);
    } finally {
      setBusy(false);
    }
  };

  const submitDisabled = busy || password.length === 0;

  return (
    <FilterSheet
      visible={visible}
      title="Kurz bestätigen, dass du das bist"
      onClose={cancelFacebookLink}
    >
      <View style={styles.body}>
        <Text style={[styles.intro, { color: theme.text }]}>
          Mit{' '}
          <Text style={{ fontFamily, fontWeight: fontWeight.bold }}>{email}</Text> gibt es schon
          ein Konto (Anmeldung über E-Mail &amp; Passwort). Melde dich einmal damit an — danach
          kannst du dich immer mit Facebook anmelden.
        </Text>

        <View
          style={[styles.inputRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <MaterialCommunityIcons name="lock-outline" size={18} color={theme.textMuted} />
          <TextInput
            style={[styles.input, { color: theme.text }]}
            placeholder="Dein Passwort"
            placeholderTextColor={theme.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            value={password}
            onChangeText={setPassword}
            editable={!busy}
            onSubmitEditing={handleSubmit}
            returnKeyType="go"
          />
        </View>

        <Pressable
          onPress={handleSubmit}
          disabled={submitDisabled}
          style={({ pressed }) => [
            styles.cta,
            {
              backgroundColor: submitDisabled ? theme.borderStrong : brand.primary,
              opacity: pressed ? 0.9 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.ctaText}>Verknüpfen &amp; anmelden</Text>
          )}
        </Pressable>
      </View>
    </FilterSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 4, paddingBottom: 8, gap: 16 },
  intro: { fontSize: 14, fontFamily, fontWeight: fontWeight.medium, lineHeight: 20 },
  inputRow: {
    height: 48,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: { flex: 1, fontSize: 15, fontFamily, fontWeight: fontWeight.medium },
  cta: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: '#ffffff', fontSize: 16, fontFamily, fontWeight: fontWeight.bold },
});
