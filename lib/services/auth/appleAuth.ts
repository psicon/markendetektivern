// Apple Sign-In via @invertase/react-native-apple-authentication.
//
// Diese Datei holt nur Credentials + initiale Profile-Daten von Apple
// — das eigentliche Firebase-Sign-In bzw. Anon-Linking macht der
// AuthContext (siehe linkOrSignIn dort).
//
// Apple-spezifischer Quirk: vollständige `fullName` + `email` kommen
// NUR beim ALLER-ERSTEN Sign-In durch (Apple Privacy). Wir reichen
// die hier durch, der AuthContext entscheidet ob's ein neuer User
// ist (über `userCredential.additionalUserInfo.isNewUser`) und legt
// ggf. das Firestore-Profil an.

import auth, {
  AppleAuthProvider,
  FirebaseAuthTypes,
} from '@react-native-firebase/auth';
import { Platform } from 'react-native';

export interface AppleCredentialBundle {
  /** Firebase-Credential, ready für linkOrSignIn. */
  credential: FirebaseAuthTypes.AuthCredential;
  /** Apple-Profil-Daten (NUR beim aller-ersten Sign-In gefüllt). */
  fullName?: {
    givenName?: string | null;
    familyName?: string | null;
  } | null;
  email?: string | null;
}

/**
 * Check if Apple Sign-In is available (iOS only, native module loaded).
 */
export const isAppleAuthAvailable = async (): Promise<boolean> => {
  try {
    if (Platform.OS !== 'ios') return false;
    const { appleAuth } = require('@invertase/react-native-apple-authentication');
    return await appleAuth.isSupported();
  } catch (error: any) {
    console.log('📱 Apple Auth check error:', error?.message);
    return false;
  }
};

/**
 * Hole eine Firebase AuthCredential + Apple-Profil-Daten von Apple.
 *
 * Macht KEINEN Firebase-Sign-In — das macht der AuthContext.
 * Returns null bei User-Cancel.
 */
export const getAppleCredential = async (): Promise<AppleCredentialBundle | null> => {
  if (Platform.OS !== 'ios') {
    throw new Error('Apple Sign-In ist nur auf iOS verfügbar');
  }

  const { appleAuth } = require('@invertase/react-native-apple-authentication');

  let response: any;
  try {
    response = await appleAuth.performRequest({
      requestedOperation: appleAuth.Operation.LOGIN,
      requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
    });
  } catch (error: any) {
    // Apple's native error-codes für Cancel/Failure.
    if (
      error?.code === appleAuth?.Error?.CANCELED ||
      error?.code === '1001' ||
      error?.message?.toLowerCase().includes('canceled')
    ) {
      return null;
    }
    throw error;
  }

  const { identityToken, nonce, fullName, email } = response;
  if (!identityToken) {
    throw new Error('Apple Sign-In failed — no identity token');
  }

  const credential = AppleAuthProvider.credential(identityToken, nonce);

  return {
    credential,
    fullName: fullName ?? null,
    email: email ?? null,
  };
};

/**
 * Sign out from Apple (no-op — Apple has no programmatic sign-out;
 * the actual Firebase sign-out happens in AuthContext.logout).
 */
export const signOutApple = async () => {
  console.log('✅ Apple Sign-Out (Firebase-only — Apple does not expose programmatic sign-out)');
};

/**
 * Build a display name from Apple's fullName payload.
 * Helper for the AuthContext when it creates the userProfile after
 * a new-user Apple sign-in.
 */
export function buildAppleDisplayName(
  fullName?: { givenName?: string | null; familyName?: string | null } | null,
): string {
  if (!fullName) return 'Apple User';
  const given = fullName.givenName?.trim() ?? '';
  const family = fullName.familyName?.trim() ?? '';
  const combined = `${given} ${family}`.trim();
  return combined || 'Apple User';
}

// Legacy helpers we keep no-op for now (referenced from older files);
// can be removed once verified unused.
export const getAppleCredentialState = async (_user: string) => 'unknown' as const;
export const onAppleCredentialRevoked = (_callback: () => void) => () => {};
